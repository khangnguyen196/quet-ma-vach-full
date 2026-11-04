"""
Chạy 4 công cụ OCR (tesseract, easyocr, google, azure) trên cùng bộ ảnh trong photos/<mã>/*.jpg
Kết quả: outputs/<công cụ>/<mã>__<tên ảnh>.txt  và  outputs/times.csv (thời gian từng ảnh)

Dùng:  python run_ocr.py
       python run_ocr.py --tools tesseract,easyocr

Công cụ "claude" (API Claude / Anthropic) đã bị gỡ: dự án không gọi API Claude / Anthropic
(không có mức miễn phí). --tools claude sẽ bị từ chối.
"""
import os, sys, time, csv, json, argparse, pathlib, traceback
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from PIL import Image, ImageOps

load_dotenv()
PHOTOS = pathlib.Path("photos")
WORK = pathlib.Path("work")       # ảnh đã thu nhỏ, dùng chung cho mọi công cụ
OUT = pathlib.Path("outputs")
MAX_SIDE = 1600                   # thu nhỏ ảnh để chạy nhanh và không vượt giới hạn API

# ---------- bộ đếm lượt gọi dịch vụ trả phí (chỉ dùng mức miễn phí, trần 80%) ----------
# Số lượt miễn phí mỗi tháng, chép từ trang giá chính thức. Không chắc thì để 0 (= không gọi).
FREE_PER_MONTH = {
    # Nguồn: https://cloud.google.com/vision/pricing (đọc ngày 05/11/2026), bảng giá, dòng Document Text Detection:
    # "Document Text Detection 0 count to 1,000 count $0.00 (Free)"
    "google": 1000,
    # Nguồn: https://azure.microsoft.com/pricing/details/cognitive-services/computer-vision/ (tự chuyển tới
    # https://azure.microsoft.com/en-us/pricing/details/computer-vision/; đọc ngày 05/11/2026), bảng Image Analysis:
    # "Free (F0) - Web/Container All 5,000 free transactions per month 20 transactions per minute"
    "azure": 5000,
}
CAP_RATIO = 0.8                   # chỉ dùng tới 80% mức miễn phí
USAGE = OUT / "api_usage.json"    # {"google": {"YYYY-MM": n}, "azure": {...}}, không commit
LOCK = OUT / "api_usage.lock"     # file khóa: chỉ 1 lần chạy được gọi google / azure tại một thời điểm, không commit
# Azure F0 giới hạn 20 lượt / phút (cùng nguồn trên): giữ khoảng cách 60/20 + 0,1 = 3,1 giây giữa 2 lần gọi
AZURE_PER_MINUTE = 20
AZURE_MIN_GAP = 60 / AZURE_PER_MINUTE + 0.1
# Không gọi google / azure trong 12 giờ đầu và 12 giờ cuối mỗi tháng (giờ UTC), xem near_month_edge()
EDGE_HOURS = 12
PAID_MAX_FAILS = 3               # google / azure lỗi 3 lần liên tiếp thì dừng gọi dịch vụ đó (lượt lỗi vẫn bị đếm)

def cap(service):
    """Trần lượt gọi mỗi tháng = 80% mức miễn phí (làm tròn xuống)."""
    return int(FREE_PER_MONTH.get(service, 0) * CAP_RATIO)

def month_key(now=None):
    """Tháng theo giờ UTC (mặc định: bây giờ), dạng YYYY-MM."""
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")

def load_usage():
    """Đọc bộ đếm. Chưa có file -> {}. File hỏng -> None (= không tin được: coi như mọi dịch vụ trả phí đã chạm trần)."""
    if not USAGE.exists():
        return {}
    try:
        data = json.loads(USAGE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("không phải object JSON")
        for svc, months in data.items():
            if not isinstance(months, dict) or not all(type(n) is int and n >= 0 for n in months.values()):
                raise ValueError(f"mục {svc!r} sai dạng")
        return data
    except Exception as e:
        print(f"CẢNH BÁO: không đọc được {USAGE} ({e}). Không gọi google / azure lần này. "
              f"File được giữ nguyên, hãy tự sửa lại cho đúng dạng.")
        return None

def save_usage(usage):
    """Ghi bộ đếm ra file tạm rồi thay file cũ, để không bao giờ còn file ghi dở."""
    tmp = USAGE.with_name(USAGE.name + ".tmp")
    tmp.write_text(json.dumps(usage, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, USAGE)

def acquire_lock():
    """Tạo file khóa LOCK (chỉ tạo được nếu chưa có). Tạo được: trả True. Đã có / không tạo được: in cảnh báo, trả False."""
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        print(f"CẢNH BÁO: đã có file khóa {LOCK}: đang có lần chạy khác hoặc lần trước bị tắt ngang. "
              f"Lần này KHÔNG gọi google / azure (tesseract / easyocr vẫn chạy). "
              f"Nếu chắc chắn không có lần chạy nào khác thì xóa file này rồi chạy lại.")
        return False
    except OSError as e:
        print(f"CẢNH BÁO: không tạo được file khóa {LOCK} ({e}). Lần này KHÔNG gọi google / azure.")
        return False
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(f"pid={os.getpid()} bat_dau={datetime.now(timezone.utc).isoformat(timespec='seconds')}\n")
    return True

def release_lock():
    """Xóa file khóa (chỉ gọi khi chính lần chạy này đã tạo nó)."""
    try:
        LOCK.unlink()
    except FileNotFoundError:
        pass

def near_month_edge(now):
    """True khi giờ UTC `now` nằm trong 12 giờ đầu hoặc 12 giờ cuối tháng.
    Khi đó các múi giờ tính tiền (UTC-12 tới UTC+12) có nơi đã sang tháng, có nơi chưa, nên không chắc
    Google / Azure tính lượt gọi vào tháng nào. Ngoài khoảng này mọi múi giờ đó đều ra cùng một tháng."""
    return (now.day == 1 and now.hour < EDGE_HOURS) or (now + timedelta(hours=EDGE_HOURS)).month != now.month

def take_paid_call(tool):
    """Gọi trước MỖI lần gọi dịch vụ trả phí. Ở ranh giới tháng: không gọi, trả False.
    Đọc lại bộ đếm từ file (không tin số cũ trong bộ nhớ).
    Còn dưới trần: tăng 1, ghi file ngay, trả True. Hết lượt / file hỏng: trả False."""
    now = datetime.now(timezone.utc)
    if near_month_edge(now):
        print(f"[{tool}] đang ở ranh giới tháng (giờ UTC {now:%Y-%m-%d %H:%M}, trong {EDGE_HOURS} giờ đầu hoặc "
              f"{EDGE_HOURS} giờ cuối tháng): không chắc lượt gọi bị tính vào tháng nào, không gọi dịch vụ này, bỏ qua. "
              f"Chạy lại từ 12:00 UTC ngày 1 (19:00 giờ Việt Nam).")
        return False
    month = month_key(now)
    usage = load_usage()
    if usage is None:
        print(f"[{tool}] bộ đếm {USAGE} không đọc được, coi như đã chạm trần, ngừng gọi dịch vụ này.")
        return False
    used, limit = usage.get(tool, {}).get(month, 0), cap(tool)
    if used >= limit:
        print(f"[{tool}] đã tới trần 80% mức miễn phí tháng {month} ({used}/{limit}), ngừng gọi dịch vụ này.")
        return False
    usage.setdefault(tool, {})[month] = used + 1
    save_usage(usage)   # đếm cả lần gọi bị lỗi (không chắc lỗi có bị tính tiền không)
    return True

_last_azure = None
def wait_for_azure():
    """Giữ khoảng cách tối thiểu AZURE_MIN_GAP giây giữa 2 lần gọi azure (tránh lỗi 429 quá giới hạn / phút)."""
    global _last_azure
    if _last_azure is not None:
        wait = AZURE_MIN_GAP - (time.monotonic() - _last_azure)
        if wait > 0:
            time.sleep(wait)
    _last_azure = time.monotonic()

# ---------- chuẩn bị ảnh ----------
def prepare(src: pathlib.Path) -> pathlib.Path:
    """Xoay đúng chiều theo EXIF, thu nhỏ cạnh dài về MAX_SIDE, lưu JPEG vào work/."""
    dst = WORK / src.parent.name / (src.stem + ".jpg")
    if dst.exists():
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    img.save(dst, "JPEG", quality=90)
    return dst

# ---------- 5 công cụ: mỗi hàm nhận đường dẫn ảnh, trả về chuỗi text ----------
def ocr_tesseract(path):
    import pytesseract
    cmd = os.environ.get("TESSERACT_CMD")
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
    return pytesseract.image_to_string(Image.open(path), lang="vie+eng")

_easy = None
def ocr_easyocr(path):
    global _easy
    import easyocr
    if _easy is None:
        _easy = easyocr.Reader(["vi", "en"], gpu=False)
    return "\n".join(_easy.readtext(str(path), detail=0, paragraph=True))

def ocr_google(path):
    from google.cloud import vision
    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=path.read_bytes())
    # retry=None: thư viện không tự gửi lại khi lỗi, để 1 lượt đếm = đúng 1 lần gửi (google-cloud-vision 3.16.0)
    resp = client.document_text_detection(image=image, image_context={"language_hints": ["vi"]}, retry=None)
    if resp.error.message:
        raise RuntimeError(resp.error.message)
    return resp.full_text_annotation.text

def ocr_azure(path):
    from azure.ai.vision.imageanalysis import ImageAnalysisClient
    from azure.ai.vision.imageanalysis.models import VisualFeatures
    from azure.core.credentials import AzureKeyCredential
    client = ImageAnalysisClient(
        endpoint=os.environ["AZURE_VISION_ENDPOINT"],
        credential=AzureKeyCredential(os.environ["AZURE_VISION_KEY"]),
        retry_total=0,   # tắt tự gửi lại của azure-core (mặc định retry_total=10), để 1 lượt đếm = đúng 1 lần gửi
    )
    result = client.analyze(image_data=path.read_bytes(), visual_features=[VisualFeatures.READ])
    lines = []
    if result.read is not None:
        for block in result.read.blocks:
            for line in block.lines:
                lines.append(line.text)
    return "\n".join(lines)

# tên công cụ -> (hàm, điều kiện có thể chạy)
TOOLS = {
    "tesseract": (ocr_tesseract, lambda: True),
    "easyocr":   (ocr_easyocr,   lambda: True),
    "google":    (ocr_google,    lambda: bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))),
    "azure":     (ocr_azure,     lambda: bool(os.environ.get("AZURE_VISION_ENDPOINT") and os.environ.get("AZURE_VISION_KEY"))),
}
DEFAULT_TOOLS = list(TOOLS)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tools", default=",".join(DEFAULT_TOOLS), help="danh sách công cụ, cách nhau bằng dấu phẩy")
    args = ap.parse_args()
    wanted = [t.strip() for t in args.tools.split(",") if t.strip()]

    photos = sorted(p for p in PHOTOS.glob("*/*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if not photos:
        sys.exit("Chưa có ảnh nào trong photos/<mã vạch>/. Xem README.md bước 2.")
    print(f"Có {len(photos)} ảnh của {len({p.parent.name for p in photos})} sản phẩm.")

    OUT.mkdir(exist_ok=True)
    # Dịch vụ trả phí sẽ chạy (có trong --tools và có key): giữ file khóa để 2 lần chạy cùng lúc không đếm thiếu
    paid = [t for t in wanted if t in FREE_PER_MONTH and t in TOOLS and TOOLS[t][1]()]
    locked = acquire_lock() if paid else False
    try:
        times_path = OUT / "times.csv"
        new_file = not times_path.exists()
        with open(times_path, "a", newline="", encoding="utf-8") as tf:
            tw = csv.writer(tf)
            if new_file:
                tw.writerow(["tool", "code", "image", "seconds", "status"])

            for tool in wanted:
                if tool == "claude":
                    print("[claude] không dùng (quy tắc dự án: không gọi API Claude / Anthropic), bỏ qua."); continue
                if tool not in TOOLS:
                    print(f"[{tool}] không biết công cụ này, bỏ qua."); continue
                fn, available = TOOLS[tool]
                if not available():
                    print(f"[{tool}] thiếu key trong .env, bỏ qua."); continue
                if tool in FREE_PER_MONTH and not locked:
                    print(f"[{tool}] không giữ được file khóa {LOCK}, bỏ qua (xem cảnh báo ở trên)."); continue
                out_dir = OUT / tool
                print(f"\n=== {tool} ===")
                fails = 0   # số lần lỗi liên tiếp của công cụ này
                for src in photos:
                    code, name = src.parent.name, src.stem
                    out_file = out_dir / f"{code}__{name}.txt"
                    if out_file.exists():
                        continue  # đã chạy rồi
                    img = prepare(src)
                    if tool in FREE_PER_MONTH:
                        # dịch vụ trả phí: hết lượt / ranh giới tháng / bộ đếm hỏng thì dừng hẳn công cụ này,
                        # ảnh còn lại không ghi gì (chạy lại sau sẽ làm tiếp)
                        if not take_paid_call(tool):
                            break
                        if tool == "azure":
                            wait_for_azure()
                    t0 = time.perf_counter()
                    try:
                        text = fn(img) or ""
                        status = "ok"
                    except Exception as e:
                        text, status = "", f"error: {e}"
                        traceback.print_exc(limit=1)
                    secs = round(time.perf_counter() - t0, 2)
                    if status == "ok":
                        out_dir.mkdir(exist_ok=True)
                        out_file.write_text(text, encoding="utf-8")
                        fails = 0
                    else:
                        fails += 1   # lỗi: KHÔNG ghi file kết quả, lần sau chạy lại sẽ thử lại ảnh này
                    tw.writerow([tool, code, name, secs, status]); tf.flush()
                    print(f"  {code}/{name}: {secs}s {status} ({len(text)} ký tự)")
                    if tool in FREE_PER_MONTH and fails >= PAID_MAX_FAILS:
                        print(f"[{tool}] lỗi {fails} lần liên tiếp (lần cuối: {status}), dừng gọi dịch vụ này để không "
                              f"tốn thêm lượt. Sửa lỗi (key, mạng, gói…) rồi chạy lại: ảnh chưa có kết quả sẽ được làm tiếp.")
                        break
    finally:
        if locked:
            release_lock()   # chỉ xóa khóa do chính lần chạy này tạo (kể cả khi lỗi / bấm Ctrl+C)

    usage, month = load_usage(), month_key()
    print(f"\nLượt gọi dịch vụ trả phí (bộ đếm {USAGE}, trần = 80% mức miễn phí):")
    print("  dịch vụ   tháng     đã dùng / trần")
    for svc in FREE_PER_MONTH:
        used = "không đọc được" if usage is None else usage.get(svc, {}).get(month, 0)
        print(f"  {svc:<9} {month}   {used} / {cap(svc)}")

    print("\nXong. Chạy tiếp:  python score.py")

if __name__ == "__main__":
    main()
