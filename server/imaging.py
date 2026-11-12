"""Giải mã + thu nhỏ ảnh cho OCR, ĐÚNG cách của test-ocr/ocr-mat/chay_ocr.py (load_image + fit_size):
Image.open -> ImageOps.exif_transpose -> convert("RGB") -> thu cạnh dài về 1.600 px bằng BICUBIC (chỉ thu nhỏ,
làm tròn như Math.round của JS). Không dùng draft / thumbnail / reducing_gap (đổi điểm ảnh -> đổi chữ OCR).

Định dạng nhận theo CHỮ KÝ NỘI DUNG (vài byte đầu), không theo đuôi file hay Content-Type.
Ảnh chỉ nằm trong RAM, không ghi ra đĩa.
"""
from __future__ import annotations

import io
import math
import warnings

from PIL import Image, ImageOps

MAX_SIDE = 1600

# Nhãn ftyp của HEIF/HEIC (ISO/IEC 23008-12). "avif" không nằm đây (pi-heif không đọc AVIF).
HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs", b"mif1", b"msf1"}

# pi-heif (chỉ đọc, libheif + libde265 LGPL, KHÔNG kèm x265 GPL như pillow-heif). Không có thì HEIC -> 415.
try:  # pragma: no cover - tùy máy có cài hay không
    import pi_heif

    pi_heif.register_heif_opener()
    HEIC_SUPPORTED = True
except Exception:  # noqa: BLE001 - thiếu gói / thiếu thư viện hệ thống đều coi là chưa hỗ trợ
    HEIC_SUPPORTED = False


class ImageError(Exception):
    """Lỗi ảnh có mã HTTP + câu tiếng Việt cho người dùng."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def round_half_up(x: float) -> int:
    """Làm tròn như Math.round của JS (0,5 lên), khác round() của Python (làm tròn về số chẵn)."""
    return int(math.floor(x + 0.5))


def fit_size(w: int, h: int, max_side: int = MAX_SIDE):
    """Cỡ mới khi thu cạnh dài về max_side (chỉ thu nhỏ), như fit_size của chay_ocr.py."""
    scale = min(1.0, max_side / max(w, h))
    return max(1, round_half_up(w * scale)), max(1, round_half_up(h * scale))


def detect_format(data):
    """'jpeg' | 'png' | 'heic' | None, chỉ theo vài byte đầu."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in HEIF_BRANDS:
        return "heic"
    return None


_PIL_FORMATS = {"jpeg": ["JPEG"], "png": ["PNG"], "heic": ["HEIF"]}


def decode(data: bytes, max_pixels: int):
    """bytes -> (ảnh PIL RGB đã thu nhỏ, (rộng gốc, cao gốc) sau khi xoay theo EXIF).

    Ném ImageError: 415 (không phải ảnh / chưa hỗ trợ HEIC / ảnh hỏng), 413 (quá nhiều điểm ảnh)."""
    kind = detect_format(data)
    if kind is None:
        raise ImageError(415, "Không phải ảnh JPEG / PNG / HEIC.")
    if kind == "heic" and not HEIC_SUPPORTED:
        raise ImageError(415, "Máy chủ chưa hỗ trợ HEIC. Hãy gửi ảnh JPEG hoặc PNG.")
    too_big = ImageError(413, f"Ảnh quá nhiều điểm ảnh (tối đa {max_pixels:,} điểm). Hãy chụp nhỏ hơn.".replace(",", "."))
    try:
        # Cảnh báo "bom điểm ảnh" của Pillow coi như lỗi. Kiểm cỡ của chính mình TRƯỚC khi giải mã (chỉ đọc phần đầu).
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data), formats=_PIL_FORMATS[kind])
            w, h = img.size
            if w <= 0 or h <= 0 or w * h > max_pixels:
                raise too_big
            img = ImageOps.exif_transpose(img).convert("RGB")
    except ImageError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise too_big from None
    except Exception:  # noqa: BLE001 - ảnh hỏng / cắt cụt: không lộ chi tiết thư viện
        raise ImageError(415, "Ảnh bị hỏng hoặc không đọc được.") from None
    orig = img.size
    size = fit_size(*orig)
    if size != orig:
        img = img.resize(size, Image.Resampling.BICUBIC)
    return img, orig
