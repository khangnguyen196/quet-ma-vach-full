"""Trần điểm ảnh RIÊNG cho JPEG progressive (MAX_PIXELS_PROGRESSIVE, mặc định 40 MP).

Lý do (đo vòng 3, server/README.md mục "RAM ảnh lớn"): JPEG progressive buộc libjpeg giữ hệ số DCT của cả ảnh lúc giải
mã; JPEG CMYK progressive 50 MP lên bộ nhớ riêng ~936 MB (> 900 MB). Kiểm bằng cỡ đọc từ phần đầu file, TRƯỚC load().
"""
from __future__ import annotations

import io

import pytest
from PIL import Image, ImageFile

import imaging
from conftest import multipart
from settings import SettingsError, load_settings
from test_api import post
from test_imaging import pattern, reference_decode


def jpeg(w, h, mode="RGB", progressive=True, orientation=1) -> bytes:
    img = pattern("RGB", (w, h)).convert(mode)
    kw = {"quality": 90}
    if progressive:
        kw["progressive"] = True
    if orientation != 1:
        exif = Image.Exif()
        exif[0x0112] = orientation
        kw["exif"] = exif.tobytes()
    buf = io.BytesIO()
    img.save(buf, "JPEG", **kw)
    return buf.getvalue()


@pytest.fixture
def load_calls(monkeypatch):
    """Đếm số lần ImageFile.load (bước giải mã thật) được gọi."""
    calls = {"n": 0}
    orig = ImageFile.ImageFile.load

    def counting(self, *a, **kw):
        calls["n"] += 1
        return orig(self, *a, **kw)

    monkeypatch.setattr(ImageFile.ImageFile, "load", counting)
    return calls


def test_settings_tran_progressive_mac_dinh_40mp_va_kiem_gia_tri():
    assert load_settings({}).max_pixels_progressive == 40_000_000
    assert load_settings({"MAX_PIXELS_PROGRESSIVE": "30000000"}).max_pixels_progressive == 30_000_000
    for bad in ("0", "-5", "abc"):
        with pytest.raises(SettingsError):
            load_settings({"MAX_PIXELS_PROGRESSIVE": bad})


def test_anh_thu_dung_la_progressive_va_baseline():
    with Image.open(io.BytesIO(jpeg(120, 100))) as im:
        assert im.info.get("progressive")
    with Image.open(io.BytesIO(jpeg(120, 100, progressive=False))) as im:
        assert not im.info.get("progressive")


@pytest.mark.parametrize("mode", ["RGB", "CMYK"])
def test_progressive_qua_tran_rieng_413_truoc_load(load_calls, mode):
    data = jpeg(1200, 1000, mode=mode)  # 1,2 MP > trần riêng 1 MP, < trần chung
    with pytest.raises(imaging.ImageError) as e:
        imaging.decode(data, 10**8, max_pixels_progressive=1_000_000)
    assert e.value.status == 413
    assert "progressive" in e.value.message and "1.000.000" in e.value.message
    assert load_calls["n"] == 0  # chặn TRƯỚC khi giải mã


def test_baseline_cung_co_van_giai_ma(load_calls):
    data = jpeg(1200, 1000, progressive=False)
    out, orig = imaging.decode(data, 10**8, max_pixels_progressive=1_000_000)
    assert orig == (1200, 1000) and load_calls["n"] >= 1  # bộ đếm hoạt động


def test_progressive_duoi_tran_rieng_giong_tung_byte_chuoi_cu():
    data = jpeg(1900, 1100, mode="CMYK", orientation=6)
    out, orig = imaging.decode(data, 10**8, max_pixels_progressive=10**7)
    ref, ref_orig = reference_decode(data)
    assert orig == ref_orig == (1100, 1900)
    assert out.tobytes() == ref.tobytes()


def test_progressive_qua_tran_chung_van_dung_cau_chung():
    with pytest.raises(imaging.ImageError) as e:
        imaging.decode(jpeg(1200, 1000), 1_000_000, max_pixels_progressive=10**8)
    assert e.value.status == 413 and "progressive" not in e.value.message


def _post_jpeg(app, data):
    body, ctype = multipart([("image", "anh.jpg", data)])
    return post(app, body, ctype)


def test_api_tran_rieng_cau_hinh_duoc(make_app):
    app = make_app(max_pixels_progressive=1_000_000)
    r = _post_jpeg(app, jpeg(1200, 1000))
    assert r.status_code == 413 and "progressive" in r.json()["error"]
    assert _post_jpeg(app, jpeg(1200, 1000, mode="CMYK")).status_code == 413
    assert _post_jpeg(app, jpeg(1200, 1000, progressive=False)).status_code == 200  # baseline cùng cỡ vẫn qua
    assert _post_jpeg(app, jpeg(900, 1000)).status_code == 200  # progressive dưới trần riêng vẫn qua
