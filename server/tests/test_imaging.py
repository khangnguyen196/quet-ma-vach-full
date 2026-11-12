"""imaging.decode mới (đổi màu trước, xoay EXIF tại chỗ) phải cho ĐÚNG TỪNG BYTE như chuỗi cũ
exif_transpose(img).convert("RGB") rồi thu BICUBIC về 1.600 px, ở mọi mode và mọi hướng EXIF 1..8."""
from __future__ import annotations

import io

import pytest
from PIL import Image, ImageDraw, ImageOps

import imaging

from test_api import png_header_only


def reference_decode(data: bytes):
    """Chuỗi CŨ (d14346d, = load_image + fit_size của ocr-mat): exif_transpose -> convert("RGB") -> BICUBIC 1.600."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    orig = img.size
    size = imaging.fit_size(*orig)
    if size != orig:
        img = img.resize(size, Image.Resampling.BICUBIC)
    return img, orig


def pattern(mode: str, size=(37, 23)) -> Image.Image:
    """Hoa văn KHÔNG đối xứng (dải màu + khối ở góc trên trái + vạch chéo) để mọi phép xoay / lật đều khác nhau."""
    w, h = size
    base = Image.new("RGB", size)
    px = base.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x * 255) // max(1, w - 1), (y * 255) // max(1, h - 1), (x * 7 + y * 13) % 256)
    d = ImageDraw.Draw(base)
    d.rectangle([1, 1, w // 3, h // 4], fill=(250, 20, 40))
    d.line([(0, h - 1), (w // 2, h // 2)], fill=(10, 240, 10), width=2)
    if mode == "RGBA":
        img = base.convert("RGBA")
        img.putalpha(Image.linear_gradient("L").resize(size))
        return img
    if mode == "P":
        return base.convert("P", palette=Image.Palette.ADAPTIVE, colors=64)
    return base.convert(mode)


def encode(img: Image.Image, fmt: str, orientation: int) -> bytes:
    exif = Image.Exif()
    if orientation != 1:
        exif[0x0112] = orientation
    buf = io.BytesIO()
    kw = {"exif": exif.tobytes()} if orientation != 1 else {}
    if fmt == "JPEG":
        kw["quality"] = 92
    img.save(buf, fmt, **kw)
    return buf.getvalue()


CASES = [("JPEG", "RGB"), ("JPEG", "L"), ("JPEG", "CMYK"), ("PNG", "RGB"), ("PNG", "RGBA"), ("PNG", "L"), ("PNG", "P")]


@pytest.mark.parametrize("orientation", range(1, 9))
@pytest.mark.parametrize("fmt,mode", CASES, ids=[f"{f}-{m}" for f, m in CASES])
def test_decode_moi_giong_tung_byte_chuoi_cu(fmt, mode, orientation):
    data = encode(pattern(mode), fmt, orientation)
    with Image.open(io.BytesIO(data)) as im:
        assert im.mode == mode  # đúng mode đang thử (không bị đổi lúc lưu)
        assert im.getexif().get(0x0112, 1) == orientation
    out, orig = imaging.decode(data, 10**6)
    ref, ref_orig = reference_decode(data)
    assert out.mode == "RGB"
    assert orig == ref_orig and out.size == ref.size
    assert out.tobytes() == ref.tobytes()
    if orientation in (5, 6, 7, 8):
        assert orig == (23, 37)  # xoay 90° -> đổi rộng / cao
    else:
        assert orig == (37, 23)


@pytest.mark.parametrize("fmt,mode,orientation", [("JPEG", "RGB", 6), ("JPEG", "CMYK", 8), ("PNG", "RGBA", 3), ("PNG", "P", 5)])
def test_decode_moi_giong_chuoi_cu_khi_phai_thu_nho(fmt, mode, orientation):
    data = encode(pattern(mode, (1900, 1100)), fmt, orientation)
    out, orig = imaging.decode(data, 10**8)
    ref, ref_orig = reference_decode(data)
    assert max(out.size) == 1600 and orig == ref_orig
    assert out.tobytes() == ref.tobytes()


def test_decode_nhan_bytearray():
    data = encode(pattern("RGB"), "JPEG", 6)
    a, oa = imaging.decode(bytearray(data), 10**6)
    b, ob = imaging.decode(data, 10**6)
    assert oa == ob and a.tobytes() == b.tobytes()


def test_max_pixels_mac_dinh_50mp_cau_loi_dung_so():
    from settings import load_settings

    mp = load_settings({}).max_pixels
    assert mp == 50_000_000
    with pytest.raises(imaging.ImageError) as e:
        imaging.decode(png_header_only(8000, 6251), mp)  # 50.008.000 điểm, vừa quá trần
    assert e.value.status == 413 and "50.000.000" in e.value.message
    with pytest.raises(imaging.ImageError) as e:
        imaging.decode(png_header_only(8000, 6250), mp)  # đúng 50 MP: qua bước kiểm cỡ (ảnh giả nên hỏng -> 415)
    assert e.value.status == 415


def test_bom_diem_anh_cua_pillow_canh_bao_cung_413():
    """GỢI Ý 11: 100 MP nằm giữa MAX_IMAGE_PIXELS (~89 MP, Pillow CẢNH BÁO) và 2 lần mức đó (Pillow ném lỗi).
    Nới trần của mình (10**12) để chỉ còn cảnh báo của Pillow -> phải coi như lỗi -> 413."""
    assert Image.MAX_IMAGE_PIXELS < 10000 * 10000 < 2 * Image.MAX_IMAGE_PIXELS
    with pytest.raises(imaging.ImageError) as e:
        imaging.decode(png_header_only(10000, 10000), 10**12)
    assert e.value.status == 413
