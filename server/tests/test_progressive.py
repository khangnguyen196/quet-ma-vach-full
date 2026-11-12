"""Trần điểm ảnh RIÊNG cho JPEG progressive (MAX_PIXELS_PROGRESSIVE, mặc định 40 MP).

Lý do (đo vòng 3, server/README.md mục "RAM ảnh lớn"): JPEG progressive buộc libjpeg giữ hệ số DCT của cả ảnh lúc giải
mã; JPEG CMYK progressive 50 MP lên bộ nhớ riêng ~936 MB (> 900 MB). Kiểm bằng cỡ đọc từ phần đầu file, TRƯỚC load().
Vòng 4: trần này áp cho mọi JPEG "nhiều lượt quét" (progressive, hoặc lượt quét đầu ít màu hơn ảnh), câu lỗi mới
"Ảnh này quá nhiều điểm ảnh cho máy chủ (loại JPEG này tối đa … điểm)…".
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
    assert "loại JPEG này" in e.value.message and "1.000.000" in e.value.message
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
    assert e.value.status == 413 and "loại JPEG này" not in e.value.message


def _post_jpeg(app, data):
    body, ctype = multipart([("image", "anh.jpg", data)])
    return post(app, body, ctype)


def test_api_tran_rieng_cau_hinh_duoc(make_app):
    app = make_app(max_pixels_progressive=1_000_000)
    r = _post_jpeg(app, jpeg(1200, 1000))
    assert r.status_code == 413 and "loại JPEG này" in r.json()["error"]
    assert _post_jpeg(app, jpeg(1200, 1000, mode="CMYK")).status_code == 413
    assert _post_jpeg(app, jpeg(1200, 1000, progressive=False)).status_code == 200  # baseline cùng cỡ vẫn qua
    assert _post_jpeg(app, jpeg(900, 1000)).status_code == 200  # progressive dưới trần riêng vẫn qua


# ---------------- JPEG nhiều lượt quét KHÔNG progressive (vòng 4) ----------------
# SOF0 / SOF1 mà lượt quét đầu (SOS) chứa ít màu hơn ảnh (Ns < Nf, "non-interleaved"): libjpeg cũng coi là nhiều lượt
# quét (has_multiple_scans) và giữ hệ số DCT của cả ảnh như progressive, nhưng Pillow không đặt cờ progressive.
# Ảnh bị chặn TRƯỚC load() nên chỉ cần phần đầu tự ghép (SOI + SOF + SOS), không cần dữ liệu ảnh thật.

def _seg(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + (len(payload) + 2).to_bytes(2, "big") + payload


def _sof(w: int, h: int, nf: int, marker: int = 0xC0) -> bytes:
    comps = b"".join(bytes([i + 1, 0x11, 0]) for i in range(nf))
    return _seg(marker, bytes([8]) + h.to_bytes(2, "big") + w.to_bytes(2, "big") + bytes([nf]) + comps)


def _sos(ns: int) -> bytes:
    comps = b"".join(bytes([i + 1, 0x00]) for i in range(ns))
    return _seg(0xDA, bytes([ns]) + comps + bytes([0, 63, 0]))


def header_jpeg(w=8000, h=6250, nf=3, ns=1, sof=0xC0, before_sos=b"") -> bytes:
    """Phần đầu JPEG tự ghép: SOI + SOF(nf màu) + [đoạn thêm] + SOS(ns màu) + vài byte + EOI (không giải mã được)."""
    return b"\xff\xd8" + _sof(w, h, nf, sof) + before_sos + _sos(ns) + b"\x00" * 16 + b"\xff\xd9"


def _decode_default(data):
    """Như cấu hình mặc định của máy chủ: MAX_PIXELS 50 MP, MAX_PIXELS_PROGRESSIVE 40 MP."""
    return imaging.decode(data, 50_000_000, max_pixels_progressive=40_000_000)


@pytest.mark.parametrize("sof,nf,ns", [
    (0xC0, 3, 1),  # SOF0 RGB, lượt đầu 1 màu
    (0xC1, 3, 1),  # SOF1 (extended sequential)
    (0xC0, 3, 2),
    (0xC0, 4, 1),  # CMYK
    (0xC0, 4, 2),
    (0xC1, 4, 1),
])
def test_nhieu_luot_quet_khong_progressive_50mp_413_truoc_load(load_calls, sof, nf, ns):
    data = header_jpeg(nf=nf, ns=ns, sof=sof)
    with Image.open(io.BytesIO(data)) as im:  # đúng là loại Pillow KHÔNG đặt cờ progressive
        assert im.size == (8000, 6250) and im.layers == nf and not im.info.get("progressive")
    with pytest.raises(imaging.ImageError) as e:
        _decode_default(data)
    assert e.value.status == 413
    assert "loại JPEG này" in e.value.message and "40.000.000" in e.value.message
    assert load_calls["n"] == 0  # chặn TRƯỚC khi giải mã


def test_anh_xam_1_mau_ns1_50mp_khong_bi_luat_moi_chan(load_calls):
    # 1 màu, lượt đầu 1 màu = 1 lượt quét: không bị trần riêng. Không có dữ liệu ảnh nên load() báo hỏng -> 415
    # (không phải 413); load() đã được gọi nghĩa là đã qua bước chặn.
    with pytest.raises(imaging.ImageError) as e:
        _decode_default(header_jpeg(nf=1, ns=1))
    assert e.value.status == 415
    assert load_calls["n"] >= 1


def test_anh_xam_that_qua_tran_rieng_van_giai_ma(load_calls):
    img = pattern("RGB", (1200, 1000)).convert("L")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    out, orig = imaging.decode(buf.getvalue(), 10**8, max_pixels_progressive=1_000_000)
    assert orig == (1200, 1000) and load_calls["n"] >= 1


def test_interleaved_ns_bang_so_mau_50mp_khong_bi_tran_rieng(load_calls):
    for nf in (3, 4):
        with pytest.raises(imaging.ImageError) as e:
            _decode_default(header_jpeg(nf=nf, ns=nf))
        assert e.value.status == 415  # qua bước chặn, chỉ hỏng vì không có dữ liệu ảnh
    assert load_calls["n"] >= 2


def test_ns1_duoi_hoac_bang_tran_rieng_khong_413(load_calls):
    for w, h in ((1000, 1000), (999, 1000)):  # đúng bằng trần và dưới trần
        with pytest.raises(imaging.ImageError) as e:
            imaging.decode(header_jpeg(w=w, h=h, nf=3, ns=1), 10**8, max_pixels_progressive=1_000_000)
        assert e.value.status == 415
    assert load_calls["n"] >= 2


def test_cat_cut_truoc_sos_50mp_413_an_toan_truoc(load_calls):
    data = b"\xff\xd8" + _sof(8000, 6250, 3)  # hết file trước SOS: Pillow vẫn mở được (đã có cỡ)
    with Image.open(io.BytesIO(data)) as im:
        assert im.size == (8000, 6250)
    with pytest.raises(imaging.ImageError) as e:
        _decode_default(data)
    assert e.value.status == 413 and "loại JPEG này" in e.value.message
    assert load_calls["n"] == 0


def test_sos_do_dai_sai_50mp_413_an_toan_truoc(load_calls):
    # SOS khai độ dài 1 (< 2): Pillow bỏ qua được, hàm dò trả None -> coi như nhiều lượt quét
    data = b"\xff\xd8" + _sof(8000, 6250, 3) + b"\xff\xda\x00\x01" + b"\x03\x01\x00\x02\x00\x03\x00\x00\x3f\x00"
    with Image.open(io.BytesIO(data)) as im:
        assert im.size == (8000, 6250)
    with pytest.raises(imaging.ImageError) as e:
        _decode_default(data)
    assert e.value.status == 413
    assert load_calls["n"] == 0


def test_api_nhieu_luot_quet_mac_dinh_413(make_app):
    app = make_app()  # cấu hình mặc định: 50 MP / 40 MP
    r = _post_jpeg(app, header_jpeg(nf=4, ns=1))
    assert r.status_code == 413 and "loại JPEG này" in r.json()["error"]


# ---------------- hàm dò số màu của lượt quét đầu ----------------

def test_do_ns_co_ban():
    f = imaging._jpeg_first_scan_components
    assert f(header_jpeg(nf=3, ns=1)) == 1
    assert f(header_jpeg(nf=3, ns=3)) == 3
    assert f(bytearray(header_jpeg(nf=4, ns=2))) == 2  # upload.read_image trả bytearray
    assert f(jpeg(64, 48, progressive=False)) == 3  # JPEG thường của Pillow: interleaved
    assert f(jpeg(64, 48)) in (1, 3)  # progressive: lượt đầu (DC) tùy bộ mã hoá


def test_do_ns_bo_ff_dem_appn_dai_rst_tem():
    extra = (
        b"\xff\xff\xff" + _seg(0xE1, b"Exif\x00\x00" + b"\xab" * 60000)  # byte 0xFF đệm + APP1 dài
        + _seg(0xFE, b"\xff\xda\x00\x08\x01 gia")  # COM chứa byte giống SOS: phải nhảy qua theo độ dài
        + b"\xff\xd0"  # RST0 (không có độ dài)
        + b"\xff\x01"  # TEM (không có độ dài)
        + b"\xff\xff" + _seg(0xDB, bytes(65))  # đệm + DQT
    )
    assert imaging._jpeg_first_scan_components(header_jpeg(nf=3, ns=2, before_sos=extra)) == 2


def test_do_ns_loi_tra_none():
    f = imaging._jpeg_first_scan_components
    full = header_jpeg(nf=3, ns=1)
    sos_at = full.index(b"\xff\xda")
    assert f(full[:sos_at]) is None  # cắt cụt trước SOS
    assert f(full[:sos_at + 3]) is None  # cắt giữa độ dài SOS
    assert f(full[:sos_at + 4]) is None  # có độ dài nhưng thiếu byte Ns
    assert f(b"\xff\xd8" + b"\xff\xe0\x00\x01" + _sos(1)) is None  # độ dài < 2
    assert f(b"\xff\xd8" + b"\xff\xe0\xff\xf0" + _sos(1)) is None  # độ dài vượt quá dữ liệu
    assert f(b"\xff\xd8") is None
    assert f(b"") is None
