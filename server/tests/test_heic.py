"""HEIC thật đi qua máy chủ (pi-heif): ảnh tự vẽ trong tests/fixtures (tạo bằng tao_heic.py, xem README mục Test).

xoay6.heic = cùng điểm ảnh với khong-xoay.heic + orientation 6 (hộp irot). Phải: đọc được cỡ đã xoay trước khi giải mã,
xoay ĐÚNG 1 lần (libheif xoay lúc đọc, EXIF orientation bị đặt về 1 nên exif_transpose không xoay lần 2).
"""
from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

import httpx
from PIL import Image, ImageChops

import imaging
from conftest import FakeEngine, multipart

FIX = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(FIX))
from heic_pattern import SIZE, heic_pattern  # noqa: E402

ROT = Image.Transpose.ROTATE_270  # orientation 6 = xoay 90° theo chiều kim đồng hồ


def max_diff(a: Image.Image, b: Image.Image) -> int:
    return max(hi for _, hi in ImageChops.difference(a, b).getextrema())


def test_hai_file_heic_nho_va_dung_chu_ky():
    for name in ("khong-xoay.heic", "xoay6.heic"):
        data = (FIX / name).read_bytes()
        assert len(data) < 50 * 1024
        assert imaging.detect_format(data) == "heic"


def test_decode_heic_khong_xoay_khop_hinh_ve():
    out, orig = imaging.decode((FIX / "khong-xoay.heic").read_bytes(), 10**6)
    assert out.mode == "RGB" and out.size == SIZE and orig == SIZE
    assert max_diff(out, heic_pattern()) <= 1  # lưu không mất dữ liệu; chỉ lệch ≤ 1 do đổi YCbCr <-> RGB


def test_decode_heic_xoay6_xoay_dung_mot_lan():
    data = (FIX / "xoay6.heic").read_bytes()
    with Image.open(io.BytesIO(data)) as im:
        assert im.size == (SIZE[1], SIZE[0])  # cỡ ĐÃ xoay đọc được trước khi giải mã (bước kiểm MAX_PIXELS)
    out, orig = imaging.decode(data, 10**6)
    assert out.size == (48, 64) and orig == (48, 64)
    plain, _ = imaging.decode((FIX / "khong-xoay.heic").read_bytes(), 10**6)
    assert out.tobytes() == plain.transpose(ROT).tobytes()  # đúng từng byte = bản không xoay xoay 1 lần
    ref = heic_pattern().transpose(ROT)
    assert max_diff(out, ref) <= 1
    # không xoay hoặc xoay 2 lần (180°) ra cỡ 64 × 48, đã bị loại bởi kiểm cỡ ở trên; xoay sai chiều thì khác hẳn
    assert heic_pattern().size == heic_pattern().transpose(Image.Transpose.ROTATE_180).size == (64, 48) != out.size
    assert max_diff(out, heic_pattern().transpose(Image.Transpose.ROTATE_90)) > 100


class _Capture(FakeEngine):
    def run(self, img):
        self.seen = img.copy()
        return super().run(img)


def test_post_ocr_heic_xoay6_200_dung_huong(make_app):
    eng = _Capture()
    app = make_app(engine=eng)
    body, ctype = multipart([("image", "IMG_0001.HEIC", (FIX / "xoay6.heic").read_bytes())])

    async def go():
        transport = httpx.ASGITransport(app=app, client=("198.51.100.70", 1))
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=10) as c:
            return await c.post("/ocr", content=body, headers={"content-type": ctype})

    r = asyncio.run(asyncio.wait_for(go(), 10))
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["width"], j["height"], j["origWidth"], j["origHeight"]) == (48, 64, 48, 64)
    plain, _ = imaging.decode((FIX / "khong-xoay.heic").read_bytes(), 10**6)
    assert eng.seen.tobytes() == plain.transpose(ROT).tobytes()  # engine nhận ảnh xoay đúng 1 lần
    assert app.state.gate.inside == 0
