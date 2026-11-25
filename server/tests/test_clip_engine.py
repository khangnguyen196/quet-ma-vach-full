"""Test server/clip_engine.py (đợt kho-nhom).

(i) Bản thật: model CLIP int8 ở D:\\tmp\\lens\\model\\clip + 3 ảnh tham chiếu của D:\\tmp\\lens\\ref\\ref.json (ảnh catalog
    OFF, KHÔNG phải ảnh đo): so với test-ocr/chup-mat-do/lens-vec.py (tiền xử lý "cat"): tensor trùng từng số, cos ≥ 0,9999,
    |chuẩn L2 − 1| < 1e-4. Thiếu model / ảnh tham chiếu (CI) -> skip có lý do (đường dẫn đổi bằng biến KHO_NHOM_CLIP_DIR /
    KHO_NHOM_REF_JSON).
(ii) Bản giả (không model): dạng / kích thước vector, ảnh lỗi -> lỗi rõ, không log / không lộ nội dung ảnh, khóa luồng.
"""
from __future__ import annotations

import importlib.util
import io
import json
import logging
import os
import threading
import time
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import clip_engine
import imaging
from clip_engine import ClipEngine, ClipImageError, ClipModelError

ROOT = Path(__file__).resolve().parents[2]
LENS_VEC = ROOT / "test-ocr" / "chup-mat-do" / "lens-vec.py"
CLIP_DIR = Path(os.environ.get("KHO_NHOM_CLIP_DIR", r"D:\tmp\lens\model\clip"))
REF_JSON = Path(os.environ.get("KHO_NHOM_REF_JSON", r"D:\tmp\lens\ref\ref.json"))
MODEL = CLIP_DIR / "vision_model_quantized.onnx"


# ---------------- (i) bản thật ----------------
def _ref_files():
    if not REF_JSON.is_file():
        return []
    files = json.loads(REF_JSON.read_text(encoding="utf-8"))["files"][:3]
    return [f for f in files if Path(f).is_file()]


real = pytest.mark.skipif(not MODEL.is_file() or len(_ref_files()) < 3,
                          reason=f"không có model CLIP int8 ({MODEL}) hoặc 3 ảnh tham chiếu ({REF_JSON}) trên máy này (CI)")


@pytest.fixture(scope="module")
def lens():
    spec = importlib.util.spec_from_file_location("lens_vec", LENS_VEC)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def engine():
    return ClipEngine(MODEL, threads=1)


@real
def test_that_khop_lens_vec(lens, engine):
    assert engine.model_sha256 == clip_engine.MODEL_SHA256 == lens.MODELS["clip-int8"]["sha256"]
    cfg = lens.load_cfg(str(CLIP_DIR.parent), "clip-int8")
    assert cfg["image_mean"] == list(clip_engine.MEAN) and cfg["image_std"] == list(clip_engine.STD)
    assert cfg["crop_size"] == {"height": clip_engine.SIZE, "width": clip_engine.SIZE}
    assert cfg["size"] == {"shortest_edge": clip_engine.SIZE}
    sess = lens.session(str(CLIP_DIR.parent), "clip-int8", threads=1)
    for f in _ref_files():
        arr = lens.read_rgb(f)
        x_lens = lens.preprocess(arr, cfg, "cat")
        assert np.array_equal(clip_engine.preprocess(arr), x_lens), f
        v_lens = lens.embed(sess, "clip-int8", x_lens)
        v = engine.embed_array(arr)
        assert v.dtype == np.float32 and v.shape == (512,)
        assert abs(float(np.linalg.norm(v)) - 1.0) < 1e-4
        assert float(np.dot(v, v_lens)) >= 0.9999, f


@real
def test_that_embed_bytes_nhu_anh_da_giai_ma(engine):
    f = _ref_files()[0]
    data = Path(f).read_bytes()
    img, _ = imaging.decode(data, 40_000_000)
    a = engine.embed_bytes(data)
    b = engine.embed_image(img)
    assert float(np.dot(a, b)) >= 0.99999


def test_that_tu_engine_from_env(monkeypatch):
    assert clip_engine.engine_from_env({}) is None
    assert clip_engine.engine_from_env({"CLIP_MODEL_PATH": ""}) is None
    assert clip_engine.engine_from_env({"CLIP_MODEL_PATH": "   "}) is None
    with pytest.raises(ClipModelError, match="Không thấy file model CLIP"):
        clip_engine.engine_from_env({"CLIP_MODEL_PATH": r"D:\khong-co\model.onnx"})


def test_sai_sha256_bi_tu_choi(tmp_path):
    p = tmp_path / "gia.onnx"
    p.write_bytes(b"khong phai model")
    with pytest.raises(ClipModelError, match="sha256 model CLIP khác bản ghim"):
        ClipEngine(p)
    with pytest.raises(ClipModelError, match="Chưa đặt đường dẫn"):
        ClipEngine(None)


# ---------------- (ii) bản giả ----------------
class _Node:
    def __init__(self, name):
        self.name = name


class FakeSession:
    """Session giả: trả vector cố định (chưa chuẩn hóa) theo tổng điểm ảnh; đếm số lần chạy cùng lúc."""

    def __init__(self, dims=512, outputs=("image_embeds", "last_hidden_state"), delay=0.0):
        self.dims = dims
        self.outputs = outputs
        self.delay = delay
        self.active = 0
        self.max_active = 0
        self.calls = 0
        self.shapes = []
        self._g = threading.Lock()

    def get_inputs(self):
        return [_Node("pixel_values")]

    def get_outputs(self):
        return [_Node(n) for n in self.outputs]

    def run(self, _names, feed):
        with self._g:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            self.calls += 1
        x = feed["pixel_values"]
        self.shapes.append(x.shape)
        time.sleep(self.delay)
        v = np.arange(1, self.dims + 1, dtype=np.float32)[None] * (1.0 + float(np.abs(x).mean()))
        with self._g:
            self.active -= 1
        return [v, np.zeros((1, 50, 768), np.float32)]


def _jpeg(w=640, h=480, color=(200, 30, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_gia_dang_vector():
    s = FakeSession()
    eng = ClipEngine(session=s)
    v = eng.embed_bytes(_jpeg())
    assert v.dtype == np.float32 and v.shape == (512,)
    assert abs(float(np.linalg.norm(v)) - 1.0) < 1e-6
    assert s.shapes == [(1, 3, 224, 224)]
    # ảnh dọc / ngang / PNG / ảnh PIL chế độ L đều ra 1x3x224x224
    buf = io.BytesIO()
    Image.new("RGBA", (300, 900), (1, 2, 3, 4)).save(buf, format="PNG")
    eng.embed_bytes(buf.getvalue())
    eng.embed_image(Image.new("L", (500, 260), 7))
    assert s.shapes[1:] == [(1, 3, 224, 224), (1, 3, 224, 224)]


def test_gia_tien_xu_ly_dung_kich_thuoc_cat():
    arr = np.zeros((1600, 1200, 3), np.uint8)
    assert clip_engine.shortest_size(1200, 1600) == (224, 298)
    x = clip_engine.preprocess(arr)
    assert x.shape == (1, 3, 224, 224) and x.dtype == np.float32
    # điểm đen -> (0 - mean) / std
    assert np.allclose(x[0, :, 100, 100], [-m / s for m, s in zip(clip_engine.MEAN, clip_engine.STD)], atol=1e-6)


def test_gia_dau_ra_sai_dang():
    with pytest.raises(ClipModelError, match="thiếu đầu ra image_embeds"):
        ClipEngine(session=FakeSession(outputs=("pooler_output",)))
    eng = ClipEngine(session=FakeSession(dims=511))
    with pytest.raises(ClipModelError, match=r"sai dạng \(1, 511\)"):
        eng.embed_bytes(_jpeg())


def test_gia_anh_loi_ro_rang_khong_lo_noi_dung(caplog):
    eng = ClipEngine(session=FakeSession())
    secret = b"NOI-DUNG-ANH-BI-MAT-" * 50
    caplog.set_level(logging.DEBUG)
    with pytest.raises(imaging.ImageError) as ei:
        eng.embed_bytes(secret)
    assert ei.value.status == 415 and "JPEG / PNG / HEIC" in ei.value.message
    assert "NOI-DUNG" not in str(ei.value)
    broken = _jpeg()[:200]
    with pytest.raises(imaging.ImageError) as ei2:
        eng.embed_bytes(broken)
    assert ei2.value.status == 415 and "hỏng" in ei2.value.message
    with pytest.raises(imaging.ImageError) as ei3:
        eng.embed_bytes(_jpeg(400, 300), max_pixels=1000)
    assert ei3.value.status == 413
    with pytest.raises(ClipImageError, match="bytes"):
        eng.embed_bytes("chuoi")
    with pytest.raises(ClipImageError, match="RGB uint8"):
        eng.embed_array(np.zeros((10, 10), np.uint8))
    with pytest.raises(ClipImageError, match="RGB uint8"):
        eng.embed_array(np.zeros((10, 10, 3), np.float32))
    with pytest.raises(ClipImageError, match="quá hẹp"):
        eng.embed_array(np.zeros((1, 5000, 3), np.uint8))
    with pytest.raises(ClipImageError, match="quá hẹp"):
        eng.embed_array(np.zeros((3000, 100, 3), np.uint8))
    eng.embed_array(np.zeros((2000, 100, 3), np.uint8))  # đúng 20 lần: vẫn tính
    assert all("NOI-DUNG" not in r.getMessage() for r in caplog.records)


def test_gia_khoa_luong():
    s = FakeSession(delay=0.02)
    eng = ClipEngine(session=s)
    data = _jpeg(320, 240)
    out, errs = [], []

    def work():
        try:
            out.append(eng.embed_bytes(data))
        except Exception as e:  # noqa: BLE001
            errs.append(e)

    ts = [threading.Thread(target=work) for _ in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errs and len(out) == 8 and s.calls == 8
    assert s.max_active == 1  # model chạy nối nhau qua khóa
    assert all(np.array_equal(out[0], o) for o in out)


def test_gia_vector_chuan_0_bao_loi():
    class Zero(FakeSession):
        def run(self, _n, feed):
            return [np.zeros((1, 512), np.float32)]

    with pytest.raises(ClipModelError, match="chuẩn 0"):
        ClipEngine(session=Zero()).embed_bytes(_jpeg())
