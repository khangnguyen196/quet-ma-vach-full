"""
PaddleOCR PP-OCRv5 mobile det (phát hiện dòng chữ, file ONNX chính thức, chạy bằng onnxruntime CPU)
+ VietOCR vgg_transformer (nhận dạng chữ tiếng Việt, PyTorch CPU).
Chỉ để biết mức tốt nhất khi có máy chủ (không chạy trong trình duyệt). Đợt ocr-c.

Chạy trong thư mục test-ocr (nơi có photos/, outputs/), bằng venv riêng vietocr/.venv:
    vietocr\\.venv\\Scripts\\python vietocr\\run_vietocr.py            (Windows)
    vietocr/.venv/bin/python vietocr/run_vietocr.py                  (macOS / Linux)
Kết quả: outputs/paddle-vietocr/<mã>__<ảnh>.txt + dòng outputs/times.csv (tool,code,image,seconds,status),
cùng định dạng run_ocr.py. Ảnh đã có file kết quả thì bỏ qua (chạy lại không mất công).

Tiền xử lý giống run_ocr.py: xoay theo EXIF, thu cạnh dài về 1600 px.
Phát hiện chữ: cùng file ONNX và cùng tham số mặc định với PaddleOCR.js (web-ocr): limit_side_len 64 (min),
max_side_limit 4000, thresh 0.3, box_thresh 0.6, unclip_ratio 1.5, cắt khung bằng biến đổi phối cảnh,
khung cao gấp >= 1,5 lần rộng thì xoay 90°. Mỗi khung chữ 1 dòng, xếp theo thứ tự đọc như web-ocr/lib.mjs orderLines.

Biến môi trường:
    PADDLE_DET_ONNX  file inference.onnx của PP-OCRv5_mobile_det (mặc định D:\\cache\\paddle-onnx\\PP-OCRv5_mobile_det_onnx\\inference.onnx)
    VIETOCR_DIR      thư mục có base.yml, vgg-transformer.yml, vgg_transformer.pth (mặc định D:\\cache\\vietocr; tải ở https://vocr.vn/data/vietocr/)
"""
import argparse
import csv
import os
import pathlib
import sys
import time
import traceback

import cv2
import numpy as np
import onnxruntime as ort
import pyclipper
import torch
import yaml
from PIL import Image, ImageOps

TOOL = "paddle-vietocr"
MAX_SIDE = 1600
PHOTOS = pathlib.Path("photos")
OUT = pathlib.Path("outputs")
DET_ONNX = os.environ.get("PADDLE_DET_ONNX", r"D:\cache\paddle-onnx\PP-OCRv5_mobile_det_onnx\inference.onnx")
VIETOCR_DIR = pathlib.Path(os.environ.get("VIETOCR_DIR", r"D:\cache\vietocr"))

# Tham số phát hiện chữ: mặc định pipeline OCR của PaddleOCR / PaddleOCR.js 0.4.2
DET = dict(limit_side_len=64, limit_type="min", max_side_limit=4000, thresh=0.3, box_thresh=0.6,
           unclip_ratio=1.5, max_candidates=1000, min_size=3)
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


# ---------- chuẩn bị ảnh (giống run_ocr.prepare, nhưng không ghi file) ----------
def prepare(src):
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    return img


# ---------- phát hiện chữ (DB) ----------
def det_resize(h, w):
    """Cỡ đưa vào model: bội số của 32 (giống PaddleOCR.js preprocessSample)."""
    scale = 1.0
    if DET["limit_type"] == "max":
        if max(w, h) > DET["limit_side_len"]:
            scale = DET["limit_side_len"] / max(1, w, h)
    elif min(w, h) < DET["limit_side_len"]:
        scale = DET["limit_side_len"] / max(1, min(w, h))
    dw = max(32, round(w * scale / 32) * 32)
    dh = max(32, round(h * scale / 32) * 32)
    if max(dw, dh) > DET["max_side_limit"]:
        s = DET["max_side_limit"] / max(dw, dh)
        dw, dh = max(32, int(dw * s)), max(32, int(dh * s))
    dw = max(32, round(min(max(dw, 32), DET["max_side_limit"]) / 32) * 32)
    dh = max(32, round(min(max(dh, 32), DET["max_side_limit"]) / 32) * 32)
    return dh, dw


def order_quad(pts):
    """4 đỉnh theo thứ tự: trên trái, trên phải, dưới phải, dưới trái."""
    pts = sorted(pts, key=lambda p: p[0])
    left, right = pts[:2], pts[2:]
    tl, bl = sorted(left, key=lambda p: p[1])
    tr, br = sorted(right, key=lambda p: p[1])
    return np.array([tl, tr, br, bl], dtype=np.float32)


def mini_box(contour):
    rect = cv2.minAreaRect(contour)
    box = order_quad(cv2.boxPoints(rect).tolist())
    return box, min(rect[1])


def box_score_fast(pred, box):
    h, w = pred.shape
    xmin = int(np.clip(np.floor(box[:, 0].min()), 0, w - 1))
    xmax = int(np.clip(np.ceil(box[:, 0].max()), 0, w - 1))
    ymin = int(np.clip(np.floor(box[:, 1].min()), 0, h - 1))
    ymax = int(np.clip(np.ceil(box[:, 1].max()), 0, h - 1))
    mask = np.zeros((ymax - ymin + 1, xmax - xmin + 1), dtype=np.uint8)
    b = box.copy()
    b[:, 0] -= xmin
    b[:, 1] -= ymin
    cv2.fillPoly(mask, b.reshape(1, -1, 2).astype(np.int32), 1)
    return cv2.mean(pred[ymin:ymax + 1, xmin:xmax + 1], mask)[0]


def unclip(box, ratio):
    poly = box.astype(np.float64)
    area = abs(cv2.contourArea(poly.astype(np.float32)))
    length = cv2.arcLength(poly.astype(np.float32), True)
    if length <= 0:
        return None
    distance = area * ratio / length
    off = pyclipper.PyclipperOffset()
    off.AddPath([tuple(map(int, p)) for p in poly], pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    paths = off.Execute(distance)
    if not paths:
        return None
    best = max(paths, key=lambda p: abs(cv2.contourArea(np.array(p, dtype=np.float32))))
    return np.array(best, dtype=np.float32).reshape(-1, 1, 2)


class Detector:
    def __init__(self, path):
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name

    def __call__(self, rgb):
        """rgb: ảnh numpy HxWx3 (RGB). Trả danh sách khung 4 đỉnh (toạ độ ảnh gốc)."""
        h, w = rgb.shape[:2]
        dh, dw = det_resize(h, w)
        bgr = cv2.cvtColor(cv2.resize(rgb, (dw, dh), interpolation=cv2.INTER_LINEAR), cv2.COLOR_RGB2BGR)
        x = (bgr.astype(np.float32) / 255.0 - MEAN) / STD
        x = x.transpose(2, 0, 1)[None]
        pred = self.sess.run(None, {self.inp: x})[0][0, 0]
        ph, pw = pred.shape
        bitmap = (pred > DET["thresh"]).astype(np.uint8) * 255
        contours, _ = cv2.findContours(bitmap, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for c in contours[: DET["max_candidates"]]:
            if len(c) < 4:
                continue
            box, side = mini_box(c.reshape(-1, 2).astype(np.float32))
            if side < DET["min_size"]:
                continue
            if box_score_fast(pred, box) < DET["box_thresh"]:
                continue
            exp = unclip(box, DET["unclip_ratio"])
            if exp is None or len(exp) < 4:
                continue
            box2, side2 = mini_box(exp.reshape(-1, 2))
            if side2 < DET["min_size"] + 2:
                continue
            box2[:, 0] = np.clip(np.round(box2[:, 0] * w / pw), 0, w)
            box2[:, 1] = np.clip(np.round(box2[:, 1] * h / ph), 0, h)
            boxes.append(box2)
        return boxes


def crop(rgb, box):
    """Cắt khung chữ bằng biến đổi phối cảnh; khung cao >= 1,5 lần rộng thì xoay 90° ngược chiều kim đồng hồ."""
    w = int(max(np.linalg.norm(box[0] - box[1]), np.linalg.norm(box[2] - box[3])))
    h = int(max(np.linalg.norm(box[0] - box[3]), np.linalg.norm(box[1] - box[2])))
    w, h = max(1, w), max(1, h)
    m = cv2.getPerspectiveTransform(box.astype(np.float32), np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
    out = cv2.warpPerspective(rgb, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    if out.shape[0] / max(1, out.shape[1]) >= 1.5:
        out = cv2.rotate(out, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return out


def order_lines(items, min_overlap=0.5):
    """Giống web-ocr/lib.mjs orderLines: gom hàng theo độ chồng chiều dọc, trên xuống, trái sang. items: [(box, text)]."""
    boxes = []
    for box, text in items:
        if not text or not text.strip():
            continue
        boxes.append(dict(minX=float(box[:, 0].min()), minY=float(box[:, 1].min()),
                          maxY=float(box[:, 1].max()), text=text.strip()))
    boxes.sort(key=lambda b: (b["minY"], b["minX"]))
    rows = []
    for b in boxes:
        if rows:
            row = rows[-1]
            overlap = min(b["maxY"], row["maxY"]) - max(b["minY"], row["minY"])
            hh = min(b["maxY"] - b["minY"], row["maxY"] - row["minY"])
            if hh > 0 and overlap / hh >= min_overlap:
                row["boxes"].append(b)
                row["minY"] = min(row["minY"], b["minY"])
                row["maxY"] = max(row["maxY"], b["maxY"])
                continue
        rows.append(dict(minY=b["minY"], maxY=b["maxY"], boxes=[b]))
    return [b["text"] for r in rows for b in sorted(r["boxes"], key=lambda b: b["minX"])]


# ---------- VietOCR ----------
def load_vietocr():
    from vietocr.tool.config import Cfg
    from vietocr.tool.predictor import Predictor
    cfg = {}
    for name in ("base.yml", "vgg-transformer.yml"):   # giống Cfg.load_config_from_name, nhưng đọc file đã tải
        with open(VIETOCR_DIR / name, encoding="utf-8") as f:
            cfg.update(yaml.safe_load(f))
    cfg = Cfg(cfg)
    cfg["weights"] = str(VIETOCR_DIR / "vgg_transformer.pth")
    cfg["cnn"]["pretrained"] = False   # không tải trọng số ImageNet: trọng số lấy hết từ vgg_transformer.pth
    cfg["device"] = "cpu"
    cfg["predictor"]["beamsearch"] = False
    return Predictor(cfg)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="chỉ chạy N ảnh đầu (thử)")
    args = ap.parse_args()

    photos = sorted(p for p in PHOTOS.glob("*/*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if args.limit:
        photos = photos[: args.limit]
    print(f"Có {len(photos)} ảnh. torch {torch.__version__}, {torch.get_num_threads()} luồng CPU, onnxruntime {ort.__version__}")
    t0 = time.perf_counter()
    det = Detector(DET_ONNX)
    rec = load_vietocr()
    print(f"Nạp model: {time.perf_counter() - t0:.1f} giây")

    out_dir = OUT / TOOL
    OUT.mkdir(exist_ok=True)
    times_path = OUT / "times.csv"
    new_file = not times_path.exists()
    with open(times_path, "a", newline="", encoding="utf-8") as tf:
        tw = csv.writer(tf)
        if new_file:
            tw.writerow(["tool", "code", "image", "seconds", "status"])
        for src in photos:
            code, name = src.parent.name, src.stem
            out_file = out_dir / f"{code}__{name}.txt"
            if out_file.exists():
                continue
            t = time.perf_counter()
            try:
                # ảnh hỏng / không mở được: ghi dòng error: vào times.csv rồi chạy tiếp, không dừng cả lần chạy
                rgb = np.array(prepare(src))
                t = time.perf_counter()   # giây/ảnh chỉ tính bước đọc (không tính chuẩn bị ảnh), như trước
                boxes = det(rgb)
                crops = [Image.fromarray(crop(rgb, b)) for b in boxes]
                texts = rec.predict_batch(crops) if crops else []
                text = "\n".join(order_lines(list(zip(boxes, texts))))
                status = "ok"
            except Exception as e:   # ghi lỗi, chạy tiếp ảnh sau (như run_ocr.py)
                text, status = "", f"error: {e}"
                traceback.print_exc(limit=1)
            secs = round(time.perf_counter() - t, 2)
            if status == "ok":
                out_dir.mkdir(exist_ok=True)
                out_file.write_text(text, encoding="utf-8")
            tw.writerow([TOOL, code, name, secs, status])
            tf.flush()
            print(f"  {code}/{name}: {secs}s {status} ({len(text)} ký tự)")


if __name__ == "__main__":
    main()
