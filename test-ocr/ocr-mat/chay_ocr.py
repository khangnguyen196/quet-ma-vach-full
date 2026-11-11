"""Đợt ocr-mat (vòng 2, P2): chạy MỘT model OCR Python (CPU) trên 30 ảnh front.jpg, ghi file OCR chung cho t1-ocr.mjs.

Mỗi model một hàm adapter (cấu hình CHỐT trước trong test-ocr/README.md Phần F, "Chốt bổ sung (vòng 2)"):
  r1         RapidOCR 3.10.0, model mặc định của gói (PP-OCRv6 det small + rec small,
             cls ch_ppocr_mobile_v2.0_cls_mobile.onnx (nhãn PP-OCRv4 mobile trong config.yaml))
  r1-nocls   như r1 nhưng Global.use_cls false (vòng 3: đối chứng cho R1-trình-duyệt, không có cls)
  r2         RapidOCR 3.10.0 + đúng ONNX của 1a (PP-OCRv5 mobile det + latin_PP-OCRv5 mobile rec, HuggingFace PaddlePaddle)
  r3         RapidOCR 3.10.0 + PP-OCRv5 server det @dcf248c4 + latin_PP-OCRv5 mobile rec (2a(b) trên CPU)
  easyocr    EasyOCR 1.7.2, lang ['vi', 'en'], tham số mặc định, CPU
  tesseract  Tesseract 5.4.0 (UB Mannheim) qua pytesseract 0.3.13, vie+eng (tessdata @ced78752), psm mặc định
  onnxtr     OnnxTR 0.9.0: bộ dò khung mặc định + Felix92/onnxtr-parseq-multilingual-v1
  florence-large / got   (vòng 2–3, model nặng, { text })
  surya      Surya 0.23.0, OCR cả trang qua llama-server (CPU), GGUF datalab-to/surya-ocr-2.5-gguf (vòng 3)
  paddleocr-vl  PaddleOCR-VL 0.9B (transformers, trust_remote_code tại commit ghim), prompt "OCR:" (vòng 3)

    <venv>\\Scripts\\python chay_ocr.py --model r1 --out D:\\tmp\\ocr-mat\\ocr\\r1 [--limit 3] [--threads 8]

Ảnh vào: xoay theo EXIF rồi thu cạnh dài về 1.600 px (chỉ thu nhỏ, làm tròn như web-ocr/harness.mjs), RGB.
Ra mỗi ảnh <out>/<mã>__front.json:
  { code, model, status: "ok" | "loi", error?, items: [{ text, conf (0–1 hoặc null), box: {minX,minY,maxX,maxY} }],
    seconds (giây đọc chữ ảnh đó, không gồm nạp model), order (thứ tự chạy, từ 0), loadSeconds (chỉ ảnh đầu),
    width, height (ảnh đã thu) }
Thư mục --out phải mới (đã có *__front.json thì dừng). Chỉ để đo, không thuộc app, không gọi mạng ngoài việc thư viện
tự tải model lần đầu (nguồn ghi trong Chốt bổ sung).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import traceback
from pathlib import Path

MAX_SIDE = 1600
PHOTOS = r"D:\quet-ma-vach-full\test-ocr\photos"
TRUTH = Path(__file__).resolve().parent.parent / "truth.csv"
PADDLE_ONNX = Path(r"D:\cache\paddle-onnx")
KEYS_DIR = Path(r"D:\tmp\ocr-mat\keys")
TESSERACT_EXE = r"D:\tools\tesseract\tesseract.exe"
TESSDATA = r"D:\cache\tessdata\ced78752"
ONNXTR_REC = "Felix92/onnxtr-parseq-multilingual-v1"
ONNXTR_REC_REV = "7d7329948dbcff02637a3eb9c14ae0c4440c5ed0"


# ---------------- hàm thuần (có pytest) ----------------

def fit_size(w, h, max_side=MAX_SIDE):
    """Cỡ mới khi thu cạnh dài về max_side (chỉ thu nhỏ), làm tròn như harness.mjs (Math.round, ít nhất 1)."""
    scale = min(1.0, max_side / max(w, h))
    return max(1, round_half_up(w * scale)), max(1, round_half_up(h * scale))


def round_half_up(x):
    """Làm tròn như Math.round của JS (0,5 lên), khác round() của Python (làm tròn về số chẵn)."""
    import math

    return int(math.floor(x + 0.5))


def poly_to_box(points):
    """Khung nhiều góc [[x, y], ...] -> {minX, minY, maxX, maxY} (số thực). Rỗng / hỏng -> None."""
    try:
        xs = [float(p[0]) for p in points]
        ys = [float(p[1]) for p in points]
    except (TypeError, ValueError, IndexError):
        return None
    if not xs:
        return None
    return {"minX": min(xs), "minY": min(ys), "maxX": max(xs), "maxY": max(ys)}


def norm_conf(conf, scale=1.0):
    """Độ tin về 0–1 (chia thang); None / không phải số / âm (tesseract -1 = không phải từ) -> None."""
    if conf is None:
        return None
    try:
        c = float(conf)
    except (TypeError, ValueError):
        return None
    if c != c or c < 0:  # NaN hoặc âm
        return None
    return c / scale


def make_item(text, conf, points, scale=1.0):
    """Một khung chữ chuẩn; chữ rỗng / khung hỏng -> None."""
    text = str(text or "").strip()
    box = poly_to_box(points)
    if not text or box is None:
        return None
    return {"text": text, "conf": norm_conf(conf, scale), "box": box}


def rel_box_to_points(geom, w, h):
    """Khung tương đối ((xmin, ymin), (xmax, ymax)) của docTR / OnnxTR -> 4 góc theo pixel."""
    (x0, y0), (x1, y1) = geom
    return [[x0 * w, y0 * h], [x1 * w, y0 * h], [x1 * w, y1 * h], [x0 * w, y1 * h]]


def keys_from_yml(text):
    """Danh sách ký tự (character_dict) trong inference.yml của model nhận dạng PaddlePaddle (dạng `  - 'x'`)."""
    import yaml

    d = yaml.safe_load(text)
    chars = d["PostProcess"]["character_dict"]
    return [str(c) for c in chars]


def tesseract_items(d, scale=100.0):
    """Dict của pytesseract.image_to_data -> khung chữ mức từ (level 5). Từ có độ tin -1 (không phải từ) BỎ hẳn
    (đúng Chốt: "từ có độ tin -1 bỏ"), không giữ với conf null."""
    items = []
    for i, t in enumerate(d["text"]):
        if int(d["level"][i]) != 5:  # chỉ lấy mức từ
            continue
        try:
            conf = float(d["conf"][i])
        except (TypeError, ValueError):
            continue
        if conf < 0:
            continue
        x, y, w, h = (int(d[k][i]) for k in ("left", "top", "width", "height"))
        it = make_item(t, conf, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], scale=scale)
        if it:
            items.append(it)
    return items


def rapid_items(res):
    """Kết quả RapidOCR 3.10.0 -> khung chữ. RapidOCR không ném lỗi khi ảnh không có chữ: nó tự bắt và trả kết quả
    rỗng (RapidOCROutput() với boxes / txts None, hoặc TextDetOutput khi dò được khung mà nhận dạng rỗng).
    Trả list (bình thường / rỗng thật) hoặc { items: [], canhBao } khi có khung mà không có chữ."""
    boxes = getattr(res, "boxes", None)
    txts = getattr(res, "txts", None)
    if boxes is None and txts is None:
        return []  # ảnh không có chữ (kết quả rỗng của RapidOCR)
    if txts is None or boxes is None:
        return {"items": [], "canhBao": f"RapidOCR trả {type(res).__name__}: có khung nhưng không có chữ (hoặc ngược lại)"}
    scores = getattr(res, "scores", None) or [None] * len(txts)
    return [it for it in (make_item(t, s, b) for b, t, s in zip(boxes.tolist(), txts, scores)) if it]


def sample_codes(truth_rows, has_front):
    """Mã của truth.csv có front.jpg, giữ thứ tự truth.csv."""
    return [r["code"] for r in truth_rows if has_front(r["code"])]


# ---------------- ảnh ----------------

def load_image(path):
    """PIL RGB đã xoay theo EXIF + thu cạnh dài về 1.600 px (BICUBIC)."""
    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    size = fit_size(*img.size)
    if size != img.size:
        img = img.resize(size, Image.Resampling.BICUBIC)
    return img


# ---------------- adapter ----------------

def write_keys(rec_dir):
    """Ghi file ký tự (mỗi dòng 1 ký tự) từ inference.yml của model nhận dạng cho RapidOCR (rec_keys_path)."""
    yml = Path(rec_dir) / "inference.yml"
    chars = keys_from_yml(yml.read_text(encoding="utf-8"))
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    out = KEYS_DIR / (Path(rec_dir).name + ".txt")
    out.write_text("\n".join(chars) + "\n", encoding="utf-8", newline="\n")
    return out


def rapid_adapter(variant, threads):
    from rapidocr import RapidOCR

    params = {
        "Global.log_level": "warning",
        "EngineConfig.onnxruntime.intra_op_num_threads": threads,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    }
    if variant == "r1-nocls":  # vòng 3: đối chứng của R1-trình-duyệt (PaddleOCR.js không nạp được cls v2.0)
        params["Global.use_cls"] = False
    if variant in ("r2", "r3"):
        det = "PP-OCRv5_mobile_det_onnx" if variant == "r2" else "PP-OCRv5_server_det_onnx"
        rec_dir = PADDLE_ONNX / "latin_PP-OCRv5_mobile_rec_onnx"
        params.update({
            "Det.model_path": str(PADDLE_ONNX / det / "inference.onnx"),
            "Rec.model_path": str(rec_dir / "inference.onnx"),
            "Rec.rec_keys_path": str(write_keys(rec_dir)),
        })
    engine = RapidOCR(params=params)

    def run(img):
        # Không bắt lỗi theo câu chữ: lỗi thật ném ra -> main ghi status "loi". Ảnh không có chữ: rapid_items trả rỗng.
        return rapid_items(engine(img))

    return run


def easyocr_adapter(threads):
    import numpy as np
    import torch
    import easyocr

    torch.set_num_threads(threads)
    reader = easyocr.Reader(["vi", "en"], gpu=False)

    def run(img):
        out = reader.readtext(np.asarray(img))
        return [it for it in (make_item(t, c, b) for b, t, c in out) if it]

    return run


def tesseract_adapter(threads):
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = TESSERACT_EXE
    os.environ["OMP_THREAD_LIMIT"] = str(threads)
    # Không dùng --tessdata-dir "...": pytesseract tách tham số bằng shlex (kiểu POSIX) nên trên Windows dấu nháy bị
    # giữ lại trong đường dẫn -> Tesseract không mở được file (lỗi thật lần chạy đầu). Dùng biến môi trường.
    os.environ["TESSDATA_PREFIX"] = TESSDATA
    cfg = ""

    def run(img):
        d = pytesseract.image_to_data(img, lang="vie+eng", config=cfg, output_type=pytesseract.Output.DICT)
        return tesseract_items(d)

    return run


def onnxtr_adapter(threads):
    import numpy as np
    from onnxtr.models import EngineConfig, from_hub, ocr_predictor

    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    cfg = EngineConfig(providers=["CPUExecutionProvider"], session_options=so)
    reco = from_hub(ONNXTR_REC, revision=ONNXTR_REC_REV, engine_cfg=cfg)
    predictor = ocr_predictor(reco_arch=reco, det_engine_cfg=cfg, reco_engine_cfg=cfg, clf_engine_cfg=cfg)

    def run(img):
        w, h = img.size
        doc = predictor([np.asarray(img)])
        items = []
        for block in doc.pages[0].blocks:
            for line in block.lines:
                for word in line.words:
                    it = make_item(word.value, word.confidence, rel_box_to_points(word.geometry, w, h))
                    if it:
                        items.append(it)
        return items

    return run


FLORENCE = ("microsoft/Florence-2-large", "21a599d414c4d928c9032694c424fb94458e3594")
GOT = ("stepfun-ai/GOT-OCR-2.0-hf", "d3017ef2c2c1395888c8d635c5e0508bcb0ac78d")


def florence_adapter(threads):
    """Florence-2 large, task <OCR> (chỉ chữ, không khung) -> { text }."""
    from unittest.mock import patch

    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor
    from transformers.dynamic_module_utils import get_imports

    torch.set_num_threads(threads)
    repo, rev = FLORENCE

    def no_flash(filename):  # mã của repo đòi import flash_attn (chỉ có trên GPU) dù không dùng: bỏ khỏi danh sách import
        return [i for i in get_imports(filename) if i != "flash_attn"]

    with patch("transformers.dynamic_module_utils.get_imports", no_flash):
        model = AutoModelForCausalLM.from_pretrained(repo, revision=rev, trust_remote_code=True, torch_dtype=torch.float32).eval()
    processor = AutoProcessor.from_pretrained(repo, revision=rev, trust_remote_code=True)

    def run(img):
        inputs = processor(text="<OCR>", images=img, return_tensors="pt")
        with torch.inference_mode():
            ids = model.generate(input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"],
                                 max_new_tokens=1024, num_beams=3, do_sample=False)
        raw = processor.batch_decode(ids, skip_special_tokens=False)[0]
        text = processor.post_process_generation(raw, task="<OCR>", image_size=img.size)["<OCR>"]
        return {"text": str(text)}

    return run


def got_adapter(threads):
    """GOT-OCR2.0 (bản transformers chính thức), OCR thường -> { text }."""
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor

    torch.set_num_threads(threads)
    repo, rev = GOT
    model = AutoModelForImageTextToText.from_pretrained(repo, revision=rev, torch_dtype=torch.float32).eval()
    processor = AutoProcessor.from_pretrained(repo, revision=rev)

    def run(img):
        inputs = processor(img, return_tensors="pt")
        with torch.inference_mode():
            ids = model.generate(**inputs, do_sample=False, tokenizer=processor.tokenizer, stop_strings="<|im_end|>", max_new_tokens=4096)
        text = processor.decode(ids[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True)
        return {"text": str(text)}

    return run


PADDLEOCR_VL = ("PaddlePaddle/PaddleOCR-VL", "dae2996584399c9fb7eabfeecf8acd2c7cae95b7")


def paddleocr_vl_adapter(threads):
    """PaddleOCR-VL 0.9B qua transformers (mã của repo tại commit ghim, trust_remote_code), cả ảnh (không qua
    PP-DocLayoutV2), prompt "OCR:", max_new_tokens 1024, do_sample false, float32 (CPU) -> { text }."""
    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    torch.set_num_threads(threads)
    repo, rev = PADDLEOCR_VL
    model = AutoModelForCausalLM.from_pretrained(repo, revision=rev, trust_remote_code=True, torch_dtype=torch.float32).eval()
    processor = AutoProcessor.from_pretrained(repo, revision=rev, trust_remote_code=True)

    def run(img):
        messages = [{"role": "user", "content": [{"type": "image", "image": img}, {"type": "text", "text": "OCR:"}]}]
        inputs = processor.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors="pt")
        with torch.inference_mode():
            ids = model.generate(**inputs, max_new_tokens=1024, do_sample=False)
        text = processor.batch_decode(ids[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0]
        return {"text": str(text)}

    return run


SURYA_GGUF = ("datalab-to/surya-ocr-2.5-gguf", "eb78671ae9af9bdddfac2e25507c55337b6098e2")
LLAMA_SERVER = r"D:\tools\llama.cpp-b12284\llama-server.exe"


def html_to_text(html):
    """HTML của một khối Surya -> chữ, mỗi dòng / đoạn một dòng (bỏ thẻ, bỏ dòng trống)."""
    from html.parser import HTMLParser

    class _P(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.parts = []

        def handle_starttag(self, tag, attrs):
            if tag in ("br", "p", "div", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"):
                self.parts.append("\n")

        def handle_endtag(self, tag):
            self.handle_starttag(tag, [])

        def handle_data(self, data):
            self.parts.append(data)

    p = _P()
    p.feed(str(html or ""))
    p.close()
    return "\n".join(s.strip() for s in "".join(p.parts).splitlines() if s.strip())


def surya_text(blocks):
    """Khối Surya (polygon, html, reading_order, skipped) -> { text } theo thứ tự đọc của model."""
    keep = [b for b in blocks if not getattr(b, "skipped", False)]
    keep.sort(key=lambda b: getattr(b, "reading_order", 0))
    return "\n".join(t for t in (html_to_text(getattr(b, "html", "")) for b in keep) if t)


def surya_adapter(threads):
    """Surya OCR 0.23.0 (VLM surya-ocr-2.5): OCR cả trang (full_page, mặc định của lệnh surya_ocr) chạy CPU qua
    llama-server (llama.cpp, bản GGUF chính thức của tác giả, ghim commit). Máy có GPU NVIDIA nên ép backend llamacpp
    (tự dò sẽ chọn vllm / Docker). -> { text } (khối HTML -> chữ theo thứ tự đọc)."""
    from huggingface_hub import hf_hub_download

    repo, rev = SURYA_GGUF
    os.environ["SURYA_GGUF_LOCAL_MODEL_PATH"] = hf_hub_download(repo, "surya-2.5.gguf", revision=rev)
    os.environ["SURYA_GGUF_LOCAL_MMPROJ_PATH"] = hf_hub_download(repo, "surya-2.5-mmproj.gguf", revision=rev)
    os.environ["SURYA_INFERENCE_BACKEND"] = "llamacpp"
    os.environ["LLAMA_CPP_BINARY"] = LLAMA_SERVER
    os.environ["LLAMA_CPP_EXTRA_ARGS"] = f"--threads {threads}"
    os.environ.setdefault("TORCH_DEVICE", "cpu")
    from surya.inference import SuryaInferenceManager
    from surya.recognition import RecognitionPredictor

    manager = SuryaInferenceManager(lazy=False)  # bật llama-server + nạp model ngay (tính vào thời gian nạp)
    rec = RecognitionPredictor(manager)

    def run(img):
        page = rec([img], full_page=True)[0]
        return {"text": surya_text(page.blocks)}

    return run


ADAPTERS = {
    "surya": surya_adapter,
    "paddleocr-vl": paddleocr_vl_adapter,
    "florence-large": florence_adapter,
    "got": got_adapter,
    "r1": lambda t: rapid_adapter("r1", t),
    "r1-nocls": lambda t: rapid_adapter("r1-nocls", t),
    "r2": lambda t: rapid_adapter("r2", t),
    "r3": lambda t: rapid_adapter("r3", t),
    "easyocr": easyocr_adapter,
    "tesseract": tesseract_adapter,
    "onnxtr": onnxtr_adapter,
}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Chạy một model OCR Python trên 30 ảnh front.jpg.")
    ap.add_argument("--model", required=True, choices=sorted(ADAPTERS))
    ap.add_argument("--out", required=True)
    ap.add_argument("--photos", default=PHOTOS)
    ap.add_argument("--limit", type=int, default=0, help="chỉ chạy n ảnh đầu (0 = tất cả)")
    ap.add_argument("--threads", type=int, default=8)
    a = ap.parse_args(argv)
    for s in (sys.stdout, sys.stderr):  # Windows: màn hình cp1252 không in được chữ Việt
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")

    out = Path(a.out)
    if out.exists() and any(out.glob("*__front.json")):
        print(f"Thư mục {out} đã có file *__front.json: hãy dùng thư mục mới.", file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)
    with open(TRUTH, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    codes = sample_codes(rows, lambda c: (Path(a.photos) / c / "front.jpg").is_file())
    if a.limit:
        codes = codes[: a.limit]

    t = time.perf_counter()
    run = ADAPTERS[a.model](a.threads)
    load = time.perf_counter() - t
    print(f"{a.model}: nạp model {load:.1f} giây; {len(codes)} ảnh", flush=True)

    for order, code in enumerate(codes):
        rec = {"code": code, "model": a.model, "order": order}
        if order == 0:
            rec["loadSeconds"] = round(load, 3)
        try:
            img = load_image(Path(a.photos) / code / "front.jpg")
            rec["width"], rec["height"] = img.size
            t = time.perf_counter()
            res = run(img)
            rec["seconds"] = round(time.perf_counter() - t, 3)
            rec["status"] = "ok"
            if isinstance(res, dict):  # model không có khung: { text } hoặc { lines }
                rec.update(res)
            else:
                rec["items"] = res
        except Exception as e:  # ghi lỗi thật, chạy tiếp ảnh sau
            rec["status"] = "loi"
            rec["error"] = f"{type(e).__name__}: {e}"
            rec["trace"] = traceback.format_exc()[-2000:]
        (out / f"{code}__front.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        size = f"{len(rec['items'])} khung" if "items" in rec else f"{len(str(rec.get('text', '')))} ký tự"
        print(f"  {order + 1}/{len(codes)} {code}: {rec['status']} {rec.get('seconds', '')} giây, {size}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
