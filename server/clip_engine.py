"""Vector ảnh CLIP cho "kho sản phẩm của nhóm" (đợt kho-nhom).

Model: CLIP ViT-B/32 int8 (Xenova/clip-vit-base-patch32 @ 6b7c523, vision_model_quantized.onnx, MIT), chạy bằng
onnxruntime CPU (đã có trong requirements.txt), không thêm thư viện. Ra vector float32 512 số đã chuẩn hóa L2.

Tiền xử lý = chế độ "cat" của test-ocr/chup-mat-do/lens-vec.py (đã đo khớp transformers.js từng điểm ảnh ở đợt lens):
thu cạnh ngắn về 224 bằng bicubic kiểu sharp affine (libvips, số nguyên cố định, KHÔNG khử răng cưa), cắt giữa
224 × 224, rescale 1/255, trừ mean / chia std, CHW float32. Ảnh vào đã xoay theo EXIF và là RGB.
Test (server/tests/test_clip_engine.py) so với lens-vec.py: cos ≥ 0,9999.

Nạp theo biến CLIP_MODEL_PATH (đặt rỗng / không đặt = tắt, engine_from_env trả None). 1 luồng ORT (máy chủ 1 vCPU);
nhiều yêu cầu cùng lúc thì lần chạy model nối nhau qua một khóa. Ảnh chỉ ở RAM; lỗi / log không chứa nội dung ảnh.
"""
from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path

import numpy as np

MODEL_SHA256 = "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299"
MODEL_INFO = {"name": "clip-vit-base-patch32", "repo": "Xenova/clip-vit-base-patch32",
              "revision": "6b7c523703ae26e39be4b03774966f8571c7f523", "file": "vision_model_quantized.onnx",
              "quant": "int8", "license": "MIT", "pre": "cat"}
MODEL_ID = "clip-vit-b32-int8-cat"  # ghi vào cột model của bảng nhom_anh
# Nguồn tải ghim theo revision (Dockerfile tải lúc build rồi sha256sum -c với MODEL_SHA256; test_dockerfile.py kiểm trùng)
MODEL_URL = ("https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/6b7c523703ae26e39be4b03774966f8571c7f523"
             "/onnx/vision_model_quantized.onnx")
MODEL_BYTES = 89_117_001
DIMS = 512
SIZE = 224  # shortest_edge = crop 224 (preprocessor_config.json)
MEAN = (0.48145466, 0.4578275, 0.40821073)
STD = (0.26862954, 0.26130258, 0.27577711)
RESCALE = 0.00392156862745098  # 1 / 255
OUTPUT = "image_embeds"
DEFAULT_MAX_PIXELS = 40_000_000
MAX_ASPECT = 20  # cạnh dài ≤ 20 × cạnh ngắn


class ClipModelError(RuntimeError):
    """Không nạp được model (thiếu file / sai sha256 / sai dạng)."""


class ClipImageError(ValueError):
    """Ảnh vào sai dạng (câu tiếng Việt, không chứa nội dung ảnh)."""


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ---------------- tiền xử lý "cat" (chép đúng lens-vec.py, phần sharp affine số nguyên cố định) ----------------
TRANSFORM_SCALE = 64  # VIPS_TRANSFORM_SCALE: vị trí lẻ lượng tử 1/64
INTERP_SHIFT = 12  # VIPS_INTERPOLATE_SHIFT: hệ số nguyên × 4096


def _catmull(x):
    dx = 1.0 - x
    return np.array([-0.5 * x * dx * dx, 1 + x * x * (1.5 * x - 2.5), 1 + dx * dx * (1.5 * dx - 2.5), -0.5 * x * x * dx])


def _fixed_tables(n_in, n_out):
    xs = np.arange(n_out, dtype=np.float64) / (n_out / n_in)
    ix = np.floor(xs).astype(np.int64)
    tx = np.floor((xs - ix) * TRANSFORM_SCALE + 0.5).astype(np.int64)
    cf = np.stack([_catmull(t / TRANSFORM_SCALE) for t in tx]) * (1 << INTERP_SHIFT)
    return ix, np.trunc(cf).astype(np.int64)


def _round_shift_(v):
    """Làm tròn rồi dịch phải INTERP_SHIFT bit, TẠI CHỖ (không tạo mảng mới); >> của numpy là dịch số học như int64."""
    v += 1 << (INTERP_SHIFT - 1)
    v >>= INTERP_SHIFT
    return v


INT32_MAX = (1 << 31) - 1


def int32_bounds():
    """Chứng minh resize_affine tính bằng int32 không tràn số, bằng giá trị lớn nhất có thể (không phụ thuộc ảnh):
    s = tổng |hệ số nguyên| lớn nhất của 1 điểm ra, xét MỌI vị trí lẻ t = 0..64 (bảng chỉ có 65 giá trị t);
    lượt 1 (theo hàng, điểm vào 0..255): |tổng| ≤ 255·s + 2048 = acc1;
    sau làm tròn |R| ≤ acc1 / 4096 + 1 = r_max (R chưa cắt về 0..255, có thể âm hoặc > 255);
    lượt 2 (theo cột, điểm vào là R): |tổng| ≤ r_max·s + 2048 = acc2. Cần acc2 < 2^31 − 1."""
    coef = [np.trunc(_catmull(t / TRANSFORM_SCALE) * (1 << INTERP_SHIFT)) for t in range(TRANSFORM_SCALE + 1)]
    s = max(int(np.abs(c).sum()) for c in coef)
    half = 1 << (INTERP_SHIFT - 1)
    acc1 = 255 * s + half
    r_max = acc1 // (1 << INTERP_SHIFT) + 1
    acc2 = r_max * s + half
    return {"s": s, "acc1": acc1, "r_max": r_max, "acc2": acc2, "int32_max": INT32_MAX}


_BOUNDS = int32_bounds()
if _BOUNDS["acc2"] >= INT32_MAX:  # không xảy ra với bảng Catmull-Rom × 4096 (s = 5.120, acc2 = 1.640.448); giữ để đổi bảng thì biết
    raise RuntimeError("resize_affine: int32 có thể tràn số, phải dùng int64.")


def _sum4(A, idx, coef, axis):
    """Σ_k coef[:, k] · A[idx + k − 1] theo trục axis, int32, cộng dồn tại chỗ; điểm ngoài biên = 0 (hệ số 0)."""
    n = A.shape[axis]
    shape = [1] * A.ndim
    shape[axis] = -1
    out = None
    for k in range(4):
        j = idx + k - 1
        c = np.where((j >= 0) & (j < n), coef[:, k], 0).astype(np.int32).reshape(shape)
        term = np.take(A, np.clip(j, 0, n - 1), axis=axis).astype(np.int32, copy=False)
        term *= c
        if out is None:
            out = term
        else:
            out += term
    return out


def resize_affine(arr, w, h):
    """uint8 HxWx3 -> uint8 hxwx3 giống từng điểm sharp affine bicubic (như lens-vec.py resize_affine, center False).

    Tính bằng int32 (không tràn: xem int32_bounds) và chỉ đổi kiểu phần đã lấy theo bảng, cộng dồn tại chỗ: không đổi cả
    ảnh sang int64 như lens-vec.py (ảnh 1600 × 1200 int64 ≈ 46 MB). Phép tính nguyên nên kết quả trùng từng số."""
    H, W = arr.shape[:2]
    if (W, H) == (w, h):
        return arr
    ix, cx = _fixed_tables(W, w)
    iy, cy = _fixed_tables(H, h)
    R = _round_shift_(_sum4(arr, ix, cx, 1))  # H × w × 3
    O = _round_shift_(_sum4(R, iy, cy, 0))  # h × w × 3
    del R
    np.clip(O, 0, 255, out=O)
    return O.astype(np.uint8)


def shortest_size(W, H, s=SIZE):
    """Như get_resize_output_image_size của transformers.js: floor(toFixed(2))."""
    r = max(s / W, s / H)
    return int(np.floor(float(f"{W * r:.2f}"))), int(np.floor(float(f"{H * r:.2f}")))


def center_crop(arr, cw=SIZE, ch=SIZE):
    H, W = arr.shape[:2]
    if (W, H) == (cw, ch):
        return arr
    x0 = int(np.floor((W - cw) / 2))
    y0 = int(np.floor((H - ch) / 2))
    return arr[y0:y0 + ch, x0:x0 + cw]


def to_tensor(arr):
    """uint8 HxWx3 -> float32 1x3xHxW, thứ tự làm tròn như transformers.js (như lens-vec.py to_tensor)."""
    x = (float(RESCALE) * arr.astype(np.float64)).astype(np.float32)
    x = ((x.astype(np.float64) - np.array(MEAN, dtype=np.float64)) / np.array(STD, dtype=np.float64)).astype(np.float32)
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])


def preprocess(arr):
    """Ảnh RGB uint8 HxWx3 (đã xoay EXIF) -> tensor 1x3x224x224 (chế độ "cat")."""
    if not isinstance(arr, np.ndarray) or arr.dtype != np.uint8 or arr.ndim != 3 or arr.shape[2] != 3:
        raise ClipImageError("Ảnh vào phải là mảng RGB uint8 cao × rộng × 3.")
    H, W = arr.shape[:2]
    if H < 1 or W < 1:
        raise ClipImageError("Ảnh rỗng.")
    # ảnh quá dài / quá hẹp: thu cạnh ngắn về 224 làm cạnh dài phình to (tốn RAM) -> từ chối trước khi thu
    if max(W, H) > MAX_ASPECT * min(W, H):
        raise ClipImageError("Ảnh quá hẹp để tính vector.")
    resized = resize_affine(arr, *shortest_size(W, H))
    if resized.shape[0] < SIZE or resized.shape[1] < SIZE:
        raise ClipImageError("Ảnh quá hẹp để tính vector.")
    return to_tensor(center_crop(resized))


def l2_normalize(v):
    v = np.asarray(v, dtype=np.float64).reshape(-1)
    n = float(np.linalg.norm(v))
    if not np.isfinite(n) or n == 0.0:
        raise ClipModelError("Vector ảnh không hợp lệ (chuẩn 0 hoặc không hữu hạn).")
    return (v / n).astype(np.float32)


class ClipEngine:
    """Nạp model một lần, tính vector cho nhiều ảnh. session: chỉ để test (bản giả không cần file model)."""

    def __init__(self, model_path=None, threads: int = 1, expected_sha256: str | None = MODEL_SHA256, session=None):
        self._lock = threading.Lock()
        if session is not None:
            self.session = session
            self.model_sha256 = None
            self.model_path = None
        else:
            if not model_path:
                raise ClipModelError("Chưa đặt đường dẫn model CLIP.")
            p = Path(model_path)
            if not p.is_file():
                raise ClipModelError(f"Không thấy file model CLIP: {p}")
            sha = sha256_file(p)
            if expected_sha256 is not None and sha != expected_sha256:
                raise ClipModelError(f"sha256 model CLIP khác bản ghim ({sha[:12]}…).")
            import onnxruntime as ort

            so = ort.SessionOptions()
            so.intra_op_num_threads = int(threads)
            so.inter_op_num_threads = 1
            so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            self.session = ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])
            self.model_sha256 = sha
            self.model_path = str(p)
        self._input = self.session.get_inputs()[0].name
        names = [o.name for o in self.session.get_outputs()]
        if OUTPUT not in names:
            raise ClipModelError(f"Model CLIP thiếu đầu ra {OUTPUT}.")
        self._out_index = names.index(OUTPUT)

    def embed_array(self, arr) -> np.ndarray:
        """Ảnh RGB uint8 HxWx3 (đã xoay EXIF) -> vector float32 (512,) chuẩn L2."""
        x = preprocess(arr)
        with self._lock:
            res = self.session.run(None, {self._input: x})
        v = np.asarray(res[self._out_index])
        if v.ndim != 2 or v.shape[0] != 1 or v.shape[1] != DIMS:
            raise ClipModelError(f"Đầu ra model CLIP sai dạng {tuple(v.shape)}.")
        return l2_normalize(v[0])

    def embed_image(self, img) -> np.ndarray:
        """Ảnh PIL (vd ảnh imaging.decode trả về: RGB, đã xoay EXIF, cạnh dài ≤ 1.600) -> vector."""
        if getattr(img, "mode", None) != "RGB":
            img = img.convert("RGB")
        return self.embed_array(np.asarray(img))

    def embed_bytes(self, data, max_pixels: int = DEFAULT_MAX_PIXELS) -> np.ndarray:
        """bytes JPEG / PNG / HEIC -> vector. Giải mã bằng imaging.decode của máy chủ (xoay EXIF, RGB, cạnh dài
        ≤ 1.600 BICUBIC); ảnh lỗi -> imaging.ImageError (mã HTTP + câu tiếng Việt, không chứa nội dung ảnh)."""
        if not isinstance(data, (bytes, bytearray)):
            raise ClipImageError("Dữ liệu ảnh phải là bytes.")
        import imaging

        img, _ = imaging.decode(data, max_pixels)
        return self.embed_image(img)


def engine_from_env(env=None, threads: int = 1):
    """CLIP_MODEL_PATH rỗng / không đặt -> None (tắt tính vector ảnh). Có -> ClipEngine (lỗi nạp -> ClipModelError)."""
    env = os.environ if env is None else env
    path = (env.get("CLIP_MODEL_PATH") or "").strip()
    if not path:
        return None
    return ClipEngine(path, threads=threads)
