"""
Chạy 4 công cụ OCR (tesseract, easyocr, google, azure) trên cùng bộ ảnh trong photos/<mã>/*.jpg
Kết quả: outputs/<công cụ>/<mã>__<tên ảnh>.txt  và  outputs/times.csv (thời gian từng ảnh)

Dùng:  python run_ocr.py
       python run_ocr.py --tools tesseract,easyocr

Công cụ "claude" (API Claude / Anthropic) đã bị gỡ: dự án không gọi API Claude / Anthropic
(không có mức miễn phí). --tools claude sẽ bị từ chối.
"""
import os, sys, time, csv, argparse, pathlib, traceback
from dotenv import load_dotenv
from PIL import Image, ImageOps

load_dotenv()
PHOTOS = pathlib.Path("photos")
WORK = pathlib.Path("work")       # ảnh đã thu nhỏ, dùng chung cho mọi công cụ
OUT = pathlib.Path("outputs")
MAX_SIDE = 1600                   # thu nhỏ ảnh để chạy nhanh và không vượt giới hạn API

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
    resp = client.document_text_detection(image=image, image_context={"language_hints": ["vi"]})
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
            out_dir = OUT / tool
            out_dir.mkdir(exist_ok=True)
            print(f"\n=== {tool} ===")
            for src in photos:
                code, name = src.parent.name, src.stem
                out_file = out_dir / f"{code}__{name}.txt"
                if out_file.exists():
                    continue  # đã chạy rồi
                img = prepare(src)
                t0 = time.perf_counter()
                try:
                    text = fn(img) or ""
                    status = "ok"
                except Exception as e:
                    text, status = "", f"error: {e}"
                    traceback.print_exc(limit=1)
                secs = round(time.perf_counter() - t0, 2)
                out_file.write_text(text, encoding="utf-8")
                tw.writerow([tool, code, name, secs, status]); tf.flush()
                print(f"  {code}/{name}: {secs}s {status} ({len(text)} ký tự)")

    print("\nXong. Chạy tiếp:  python score.py")

if __name__ == "__main__":
    main()
