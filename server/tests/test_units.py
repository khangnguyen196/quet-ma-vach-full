"""Test phần thuần: ảnh, đổi kết quả RapidOCR, giới hạn lượt, cấu hình, kiểm model."""
from __future__ import annotations

import io
import json

import numpy as np
import pytest
from PIL import Image

import imaging
import ocr_engine
from ratelimit import SlidingWindowLimiter
from settings import SettingsError, load_settings

from conftest import jpeg_bytes, png_bytes


# ---------------- imaging ----------------

def test_detect_format_theo_chu_ky_khong_theo_duoi():
    assert imaging.detect_format(jpeg_bytes()) == "jpeg"
    assert imaging.detect_format(png_bytes()) == "png"
    assert imaging.detect_format(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8) == "heic"
    assert imaging.detect_format(b"\x00\x00\x00\x18ftypmif1" + b"\x00" * 8) == "heic"
    assert imaging.detect_format(b"\x00\x00\x00\x18ftypavif" + b"\x00" * 8) is None
    assert imaging.detect_format(b"GIF89a....") is None
    assert imaging.detect_format(b"") is None
    # upload.read_image trả bytearray: mọi nhánh phải chạy với bytearray (lát cắt bytearray không băm được)
    assert imaging.detect_format(bytearray(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8)) == "heic"
    assert imaging.detect_format(bytearray(b"\x00\x00\x00\x18ftypavif" + b"\x00" * 8)) is None
    assert imaging.detect_format(bytearray(jpeg_bytes())) == "jpeg"
    assert imaging.detect_format(bytearray(png_bytes())) == "png"


def test_fit_size_nhu_ocr_mat():
    assert imaging.fit_size(2076, 3508) == (947, 1600)  # ảnh 8934572260543 của ocr-mat ra 947 × 1600
    assert imaging.fit_size(800, 600) == (800, 600)  # không phóng to
    assert imaging.fit_size(3201, 1) == (1600, 1)
    assert imaging.round_half_up(2.5) == 3 and imaging.round_half_up(3.5) == 4


def test_decode_xoay_theo_exif():
    img = Image.new("RGB", (40, 20), (255, 0, 0))
    exif = Image.Exif()
    exif[0x0112] = 6  # xoay 90°
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    out, orig = imaging.decode(buf.getvalue(), 10**6)
    assert out.size == (20, 40) and orig == (20, 40)
    assert out.mode == "RGB"


def test_decode_png_rgba_ve_rgb_va_thu_bicubic():
    img = Image.new("RGBA", (3200, 1000), (0, 0, 255, 128))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    out, orig = imaging.decode(buf.getvalue(), 10**8)
    assert out.mode == "RGB" and out.size == (1600, 500) and orig == (3200, 1000)
    ref = Image.open(io.BytesIO(buf.getvalue())).convert("RGB").resize((1600, 500), Image.Resampling.BICUBIC)
    assert out.tobytes() == ref.tobytes()


def test_heic_chua_ho_tro_415(monkeypatch):
    monkeypatch.setattr(imaging, "HEIC_SUPPORTED", False)
    with pytest.raises(imaging.ImageError) as e:
        imaging.decode(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 64, 10**6)
    assert e.value.status == 415 and "HEIC" in e.value.message


def test_heic_hong_415_khi_co_ho_tro(monkeypatch):
    monkeypatch.setattr(imaging, "HEIC_SUPPORTED", True)
    with pytest.raises(imaging.ImageError) as e:
        imaging.decode(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 64, 10**6)
    assert e.value.status == 415


def test_heic_dung_pi_heif_khong_dung_pillow_heif():
    import importlib.util

    assert imaging.HEIC_SUPPORTED is True
    assert importlib.util.find_spec("pi_heif") is not None
    assert importlib.util.find_spec("pillow_heif") is None


# ---------------- đổi kết quả RapidOCR ----------------

class _Res:
    def __init__(self, boxes, txts, scores):
        self.boxes, self.txts, self.scores = boxes, txts, scores


def test_rapid_items_anh_khong_chu_rong():
    assert ocr_engine.rapid_items(_Res(None, None, None)) == []
    assert ocr_engine.rapid_items(object()) == []
    assert ocr_engine.rapid_items(_Res(np.zeros((1, 4, 2)), None, None)) == []


def test_rapid_items_dung_dang_va_float_thuong():
    boxes = np.array([[[270, 251], [692, 249], [693, 340], [271, 342]], [[1, 1], [2, 1], [2, 2], [1, 2]]], dtype=np.float32)
    items = ocr_engine.rapid_items(_Res(boxes, ("  VISSAN ", "  "), (np.float32(0.99996), 0.7)))
    assert len(items) == 1  # chữ rỗng bị bỏ như make_item của ocr-mat
    it = items[0]
    assert it["text"] == "VISSAN"
    assert it["poly"] == [[270.0, 251.0], [692.0, 249.0], [693.0, 340.0], [271.0, 342.0]]
    assert it["box"] == {"minX": 270.0, "minY": 249.0, "maxX": 693.0, "maxY": 342.0}
    assert it["score"] == it["conf"] == pytest.approx(0.99996, abs=1e-6)
    assert all(type(v) is float for p in it["poly"] for v in p) and type(it["conf"]) is float
    json.dumps(items)  # không có số numpy


def test_norm_conf_va_poly_to_box():
    assert ocr_engine.norm_conf(None) is None
    assert ocr_engine.norm_conf(float("nan")) is None
    assert ocr_engine.norm_conf(-1) is None
    assert ocr_engine.norm_conf("x") is None
    assert ocr_engine.poly_to_box([]) is None
    assert ocr_engine.poly_to_box([[1, "a"]]) is None


def test_tham_so_y_het_r1_nocls():
    assert ocr_engine.r1_nocls_params(8) == {
        "Global.log_level": "warning",
        "EngineConfig.onnxruntime.intra_op_num_threads": 8,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "Global.use_cls": False,
    }


def test_thieu_model_offline_tu_choi_khoi_dong(monkeypatch, tmp_path):
    monkeypatch.setattr(ocr_engine, "models_dir", lambda: tmp_path)
    with pytest.raises(ocr_engine.ModelError) as e:
        ocr_engine.OcrEngine(1, offline=True)
    assert "thiếu" in str(e.value) and "OCR_OFFLINE=1" in str(e.value)


def test_model_sai_sha256_bi_bao(tmp_path):
    for name in ocr_engine.MODEL_SHA256:
        (tmp_path / name).write_bytes(b"gia")
    probs = ocr_engine.model_problems(tmp_path)
    assert len(probs) == 2 and all("sai sha256" in p for p in probs)


def test_model_trong_venv_dung_sha256():
    assert ocr_engine.model_problems(ocr_engine.models_dir()) == []


# ---------------- giới hạn lượt ----------------

class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_cua_so_truot_60_giay():
    clk = _Clock()
    lim = SlidingWindowLimiter(3, clock=clk)
    assert [lim.check("a")[0] for _ in range(3)] == [True] * 3
    ok, retry = lim.check("a")
    assert not ok and retry == 60
    clk.t += 30
    ok, retry = lim.check("a")
    assert not ok and retry == 30
    clk.t += 30  # lượt đầu hết hạn
    assert lim.check("a")[0] is True


def test_tran_so_ip_va_don_ip_het_han():
    clk = _Clock()
    lim = SlidingWindowLimiter(5, max_ips=3, clock=clk)
    for ip in "abc":
        lim.check(ip)
    clk.t += 61
    lim.check("d")  # đầy -> dọn a, b, c (hết hạn)
    assert len(lim) == 1
    for ip in "efg":
        lim.check(ip)
    assert len(lim) == 3  # đầy mà chưa hết hạn -> bỏ IP cũ nhất, không phình


# ---------------- cấu hình ----------------

def test_settings_mac_dinh_va_loi():
    s = load_settings({})
    assert (s.ocr_threads, s.max_bytes, s.max_pixels, s.rate_limit_per_min, s.max_concurrent, s.queue_max) == (8, 5 * 1024 * 1024, 50_000_000, 20, 1, 4)
    assert s.auth_mode == "off" and s.cors_allow_localhost is False and s.trust_proxy is False
    assert s.allowed_origins == ("https://khangnguyen196.github.io",)
    with pytest.raises(SettingsError):
        load_settings({"OCR_THREADS": "tam"})
    with pytest.raises(SettingsError):
        load_settings({"CORS_ALLOW_LOCALHOST": "co"})
    assert load_settings({"CORS_ALLOW_LOCALHOST": "1"}).cors_origin_regex is not None


def test_body_timeout_s_mac_dinh_30_va_kiem_gia_tri():
    assert load_settings({}).body_timeout_s == 30.0
    assert load_settings({"BODY_TIMEOUT_S": "0,5"}).body_timeout_s == 0.5
    assert load_settings({"BODY_TIMEOUT_S": "12"}).body_timeout_s == 12.0
    for bad in ("0", "-1", "abc", "nan", "inf"):
        with pytest.raises(SettingsError):
            load_settings({"BODY_TIMEOUT_S": bad})
