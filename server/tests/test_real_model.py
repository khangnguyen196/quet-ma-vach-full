"""Test với RapidOCR THẬT (marker real_model): chạy riêng bằng `pytest -m real_model`. Thiếu model thì FAIL (không skip)."""
from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from conftest import multipart

pytestmark = pytest.mark.real_model


@pytest.fixture(scope="module")
def real_client():
    import app as app_module
    from settings import Settings

    app = app_module.create_app(Settings(ocr_threads=2, ocr_offline=True))  # engine=None -> nạp RapidOCR thật lúc khởi động
    with TestClient(app) as c:
        yield c


def _post(c, img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    body, ctype = multipart([("image", "anh.png", buf.getvalue())])
    return c.post("/ocr", content=body, headers={"content-type": ctype})


def test_model_that_doc_duoc_chu(real_client):
    assert real_client.get("/health").json()["modelLoaded"] is True
    img = Image.new("RGB", (900, 300), "white")
    ImageDraw.Draw(img).text((40, 90), "VISSAN 2026", fill="black", font=ImageFont.load_default(size=96))
    r = _post(real_client, img)
    assert r.status_code == 200, r.text
    j = r.json()
    texts = " ".join(it["text"] for it in j["items"]).upper()
    assert "VISSAN" in texts
    it = j["items"][0]
    assert len(it["poly"]) == 4 and 0 < it["score"] <= 1 and it["conf"] == it["score"]
    assert j["msOcr"] > 0 and (j["width"], j["height"]) == (900, 300)


def test_model_that_doc_duoc_anh_thu_cua_ci(real_client):
    """Ảnh CI dùng (tests/fixtures/chu.png, tự vẽ bằng tao_chu.py): OCR phải ra các chữ đã vẽ. Workflow server-image
    gửi đúng ảnh này vào container và kiểm cùng các chữ (CHU_PNG_WORDS)."""
    from fixtures.tao_chu import CHU_PNG, CHU_PNG_WORDS

    data = CHU_PNG.read_bytes()
    assert len(data) < 50 * 1024
    body, ctype = multipart([("image", "chu.png", data)])
    r = real_client.post("/ocr", content=body, headers={"content-type": ctype})
    assert r.status_code == 200, r.text
    texts = " ".join(it["text"] for it in r.json()["items"]).upper()
    for word in CHU_PNG_WORDS:
        assert word in texts, (word, texts)


def test_model_that_anh_trang_khong_loi(real_client):
    r = _post(real_client, Image.new("RGB", (640, 480), "white"))
    assert r.status_code == 200
    assert r.json()["items"] == []
