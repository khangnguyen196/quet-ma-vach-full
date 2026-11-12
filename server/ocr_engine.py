"""RapidOCR R1 không cls, ĐÚNG cấu hình rapid_adapter("r1-nocls") của test-ocr/ocr-mat/chay_ocr.py:
rapidocr 3.10.0 + onnxruntime, model mặc định của gói (PP-OCRv6 small det + rec), Global.use_cls False,
Global.log_level warning, inter_op 1, intra_op = OCR_THREADS.

Nạp MỘT lần lúc khởi động. Model phải có sẵn trong thư mục models của gói rapidocr (wheel 3.10.0 đã kèm) và đúng
sha256 đã đo; OCR_OFFLINE=1 mà thiếu / sai thì từ chối khởi động (không tải lúc chạy).
"""
from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path

log = logging.getLogger("ocr_server")

ENGINE_INFO = {"name": "rapidocr", "version": "3.10.0", "model": "PP-OCRv6 small det+rec, no cls"}

# sha256 của 2 file đã đo ở ocr-mat (venv-rapid) — trùng bản trong wheel rapidocr 3.10.0 (server/README.md).
MODEL_SHA256 = {
    "PP-OCRv6_det_small.onnx": "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    "PP-OCRv6_rec_small.onnx": "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
}


class ModelError(RuntimeError):
    """Thiếu / sai model: máy chủ không khởi động."""


def r1_nocls_params(threads: int) -> dict:
    """Tham số y hệt rapid_adapter("r1-nocls", threads) của chay_ocr.py."""
    return {
        "Global.log_level": "warning",
        "EngineConfig.onnxruntime.intra_op_num_threads": threads,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "Global.use_cls": False,
    }


def models_dir() -> Path:
    import rapidocr

    return Path(rapidocr.__file__).resolve().parent / "models"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def model_problems(folder: Path) -> list:
    """Danh sách lỗi model (rỗng = đủ và đúng sha256)."""
    out = []
    for name, want in MODEL_SHA256.items():
        p = folder / name
        if not p.is_file():
            out.append(f"thiếu {p}")
        elif sha256_file(p) != want:
            out.append(f"{p} sai sha256 (cần {want})")
    return out


# ---------------- đổi kết quả RapidOCR -> khung chữ (như rapid_items / make_item của chay_ocr.py) ----------------

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
    """Độ tin về 0–1; None / không phải số / NaN / âm -> None."""
    if conf is None:
        return None
    try:
        c = float(conf)
    except (TypeError, ValueError):
        return None
    if c != c or c < 0:
        return None
    return c / scale


def make_item(text, score, points):
    """Một khung chữ trả về API: dạng items của PaddleOCR.js (text, poly, score) + box, conf của ocr-mat.
    Chữ rỗng / khung hỏng -> None (như make_item của chay_ocr.py). Số là float thường của Python."""
    text = str(text or "").strip()
    box = poly_to_box(points)
    if not text or box is None:
        return None
    poly = [[float(p[0]), float(p[1])] for p in points]
    conf = norm_conf(score)
    return {"text": text, "poly": poly, "score": conf, "box": box, "conf": conf}


def rapid_items(res) -> list:
    """Kết quả RapidOCR 3.10.0 -> danh sách khung. Ảnh không có chữ (boxes / txts None) -> [] (không lỗi).
    Có khung mà không có chữ (hoặc ngược lại) cũng -> [] (ocr-mat ghi cảnh báo; máy chủ coi là không đọc được chữ)."""
    boxes = getattr(res, "boxes", None)
    txts = getattr(res, "txts", None)
    if boxes is None or txts is None:
        return []
    scores = getattr(res, "scores", None)
    scores = scores if scores is not None else [None] * len(txts)  # không dùng `or`: mảng numpy
    return [it for it in (make_item(t, s, b) for b, t, s in zip(boxes.tolist(), txts, scores)) if it]


class OcrEngine:
    """Bọc RapidOCR: nạp 1 lần, run(img PIL RGB) -> danh sách khung."""

    info = ENGINE_INFO

    def __init__(self, threads: int, offline: bool):
        folder = models_dir()
        problems = model_problems(folder)
        if problems and offline:
            raise ModelError("Không khởi động: thiếu hoặc sai model OCR (OCR_OFFLINE=1 nên không tải): " + "; ".join(problems))
        t = time.perf_counter()
        from rapidocr import RapidOCR  # import nặng (onnxruntime, cv2): chỉ khi nạp thật

        self._engine = RapidOCR(params=r1_nocls_params(threads))
        problems = model_problems(folder)  # lần đầu không offline: RapidOCR có thể vừa tải xong lúc khởi động
        if problems:
            raise ModelError("Không khởi động: model OCR sau khi nạp vẫn thiếu / sai: " + "; ".join(problems))
        self.load_seconds = time.perf_counter() - t
        self.loaded = True
        log.info("nạp model %.2f giây (intra_op %d, inter_op 1, không cls)", self.load_seconds, threads)

    def run(self, img) -> list:
        return rapid_items(self._engine(img))
