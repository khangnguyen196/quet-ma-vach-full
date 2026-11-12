"""Test API máy chủ OCR với engine giả (không nạp model): định dạng, giới hạn, CORS, giới hạn lượt, hàng đợi,
đăng nhập, không file tạm, log không lộ dữ liệu."""
from __future__ import annotations

import asyncio
import logging
import os
import struct
import tempfile
import threading
import zlib

import httpx
import pytest
from fastapi.testclient import TestClient

import auth
from conftest import FAKE_TEXT, ORIGIN, FakeEngine, jpeg_bytes, multipart, noise_png, png_bytes

MB = 1024 * 1024


# ---------------- tiện ích ----------------

async def _apost(app, body, ctype, ip="198.51.100.1", headers=None, path="/ocr"):
    transport = httpx.ASGITransport(app=app, client=(ip, 40000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        h = {"content-type": ctype}
        h.update(headers or {})
        return await c.post(path, content=body, headers=h)


def post(app, body, ctype, **kw):
    return asyncio.run(_apost(app, body, ctype, **kw))


def post_image(app, data, name="image", filename="anh.jpg", **kw):
    body, ctype = multipart([(name, filename, data)])
    return post(app, body, ctype, **kw)


def png_header_only(w, h) -> bytes:
    """PNG chỉ có IHDR (cỡ giả lớn) + 1 IDAT nhỏ: Pillow đọc được cỡ mà không phải giải mã."""
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00" * 16)) + chunk(b"IEND", b"")


# ---------------- ảnh hợp lệ ----------------

@pytest.mark.parametrize("data", [jpeg_bytes(), png_bytes()], ids=["jpg", "png"])
def test_anh_hop_le_tra_dung_khung_json(make_app, data):
    r = post_image(make_app(), data)
    assert r.status_code == 200, r.text
    j = r.json()
    assert set(j) == {"items", "width", "height", "origWidth", "origHeight", "ms", "msOcr", "engine"}
    assert (j["width"], j["height"], j["origWidth"], j["origHeight"]) == (64, 48, 64, 48)
    assert isinstance(j["ms"], float) and isinstance(j["msOcr"], float) and j["ms"] >= j["msOcr"] >= 0
    assert j["engine"] == {"name": "rapidocr", "version": "3.10.0", "model": "PP-OCRv6 small det+rec, no cls"}
    it = j["items"][0]
    assert set(it) == {"text", "poly", "score", "box", "conf"}
    assert len(it["poly"]) == 4 and all(len(p) == 2 for p in it["poly"])
    assert set(it["box"]) == {"minX", "minY", "maxX", "maxY"}
    assert 0 <= it["score"] <= 1 and 0 <= it["conf"] <= 1


def test_anh_lon_duoc_thu_ve_1600_toa_do_theo_anh_da_thu(make_app):
    r = post_image(make_app(), png_bytes(3200, 100))
    j = r.json()
    assert r.status_code == 200
    assert (j["width"], j["height"], j["origWidth"], j["origHeight"]) == (1600, 50, 3200, 100)
    assert j["items"][0]["box"]["maxX"] == 1599.0  # engine giả nhận ảnh đã thu


def test_ten_truong_khac_trong_form_bi_bo_qua(make_app):
    body, ctype = multipart([("ghi_chu", None, b"xin chao"), ("image", "a.jpg", jpeg_bytes())])
    assert post(make_app(), body, ctype).status_code == 200


# ---------------- quá lớn ----------------

def test_qua_5mb_co_content_length_413(make_app):
    data = b"\xff\xd8\xff" + os.urandom(6 * MB)
    r = post_image(make_app(), data)
    assert r.status_code == 413
    assert "quá lớn" in r.json()["error"]


def test_qua_5mb_content_length_khai_sai_van_413(make_app):
    data = b"\xff\xd8\xff" + os.urandom(6 * MB)
    body, ctype = multipart([("image", "a.jpg", data)])
    r = post(make_app(), body, ctype, headers={"content-length": "1000"})
    assert r.status_code == 413


def test_anh_vua_qua_max_bytes_413_du_than_duoi_tran(make_app):
    # thân < MAX_BYTES + phần đầu multipart, nhưng phần ảnh > MAX_BYTES -> vẫn 413
    app = make_app(max_bytes=1000)
    r = post_image(app, b"\xff\xd8\xff" + b"x" * 1001)
    assert r.status_code == 413


def test_413_khi_stream_vuot_dung_doc_som_khong_content_length(make_app):
    """Thân gửi theo khúc (chunked, KHÔNG có Content-Length), 50 MB: máy chủ phải dừng đọc ngay khi vượt trần."""
    app = make_app()
    sent = {"bytes": 0}
    head, _ = multipart([("image", "a.jpg", b"")])
    head = head.split(b"\r\n\r\n", 1)[0] + b"\r\n\r\n"  # chỉ phần đầu, ảnh để trống rồi đổ dữ liệu vào
    chunk = b"\xff\xd8\xff" + b"z" * (64 * 1024 - 3)

    async def gen():
        sent["bytes"] += len(head)
        yield head
        for _ in range(800):  # 800 × 64 KB = 50 MB
            sent["bytes"] += len(chunk)
            yield chunk

    async def go():
        transport = httpx.ASGITransport(app=app, client=("198.51.100.9", 1))
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await c.post("/ocr", content=gen(), headers={"content-type": "multipart/form-data; boundary=----bienranhgioi7MA4YWxk"})

    r = asyncio.run(go())
    assert r.status_code == 413
    assert sent["bytes"] <= 5 * MB + 64 * 1024 + 2 * len(chunk), f"máy chủ đọc tới {sent['bytes']} byte mới dừng"


def test_bom_diem_anh_413(make_app):
    r = post_image(make_app(), png_header_only(10000, 10000))  # 100 MP > 60 MP
    assert r.status_code == 413
    assert "điểm ảnh" in r.json()["error"]


def test_bom_diem_anh_cua_pillow_cung_413(make_app):
    # tắt trần của mình (rất lớn) -> Pillow tự ném DecompressionBombError (400 MP > 2 × MAX_IMAGE_PIXELS)
    r = post_image(make_app(max_pixels=10**12), png_header_only(20000, 20000))
    assert r.status_code == 413


def test_max_pixels_cau_hinh_duoc(make_app):
    assert post_image(make_app(max_pixels=1000), png_bytes(100, 100)).status_code == 413
    assert post_image(make_app(max_pixels=10000), png_bytes(100, 100)).status_code == 200


# ---------------- sai định dạng / thiếu / thừa ----------------

def test_file_chu_duoi_jpg_415(make_app):
    r = post_image(make_app(), "Đây là chữ, không phải ảnh".encode(), filename="anh.jpg")
    assert r.status_code == 415
    assert r.json() == {"error": "Không phải ảnh JPEG / PNG / HEIC."}


def test_anh_hong_415(make_app):
    r = post_image(make_app(), jpeg_bytes()[:40])
    assert r.status_code == 415


def test_anh_rong_400(make_app):
    r = post_image(make_app(), b"")
    assert r.status_code == 400
    assert "rỗng" in r.json()["error"]


def test_thieu_truong_image_400(make_app):
    body, ctype = multipart([("anh", "a.jpg", jpeg_bytes())])
    r = post(make_app(), body, ctype)
    assert r.status_code == 400
    assert "image" in r.json()["error"]


def test_khong_phai_multipart_400(make_app):
    r = post(make_app(), jpeg_bytes(), "image/jpeg")
    assert r.status_code == 400


def test_multipart_chua_tron_400(make_app):
    body, ctype = multipart([("image", "a.jpg", jpeg_bytes())])
    r = post(make_app(), body[:-20], ctype)
    assert r.status_code == 400


@pytest.mark.parametrize("fields", [
    [("image", "a.jpg", None), ("image", "b.jpg", None)],
    [("image", "a.jpg", None), ("khac", "b.jpg", None)],
], ids=["2-anh-image", "image-va-file-khac"])
def test_hai_file_400(make_app, fields):
    body, ctype = multipart([(n, f, jpeg_bytes()) for n, f, _ in fields])
    r = post(make_app(), body, ctype)
    assert r.status_code == 400
    assert "1 ảnh" in r.json()["error"]


def test_loi_la_json_khong_traceback(make_app):
    with TestClient(make_app()) as c:
        r = c.get("/khong-co")
        assert r.status_code == 404 and r.json() == {"error": "Không có đường dẫn này."}
        r = c.get("/ocr")
        assert r.status_code == 405 and set(r.json()) == {"error"}
    r = post_image(make_app(), b"garbage")
    assert "Traceback" not in r.text


def test_loi_engine_tra_500_json_khong_lo_chi_tiet(make_app):
    class Broken(FakeEngine):
        def run(self, img):
            raise RuntimeError("chi tiet noi bo /duong/dan/bi-mat")

    with TestClient(make_app(engine=Broken()), raise_server_exceptions=False) as c:
        body, ctype = multipart([("image", "a.jpg", jpeg_bytes())])
        r = c.post("/ocr", content=body, headers={"content-type": ctype})
    assert r.status_code == 500
    assert r.json() == {"error": "Lỗi máy chủ, thử lại sau."}


# ---------------- CORS ----------------

def test_cors_github_io_co_header(make_app):
    with TestClient(make_app()) as c:
        r = c.get("/health", headers={"Origin": ORIGIN})
    assert r.headers.get("access-control-allow-origin") == ORIGIN
    assert "access-control-allow-credentials" not in r.headers


def test_cors_loi_413_van_co_header_cho_github_io(make_app):
    data = b"\xff\xd8\xff" + os.urandom(6 * MB)
    r = post_image(make_app(), data, headers={"Origin": ORIGIN})
    assert r.status_code == 413 and r.headers.get("access-control-allow-origin") == ORIGIN


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "https://khangnguyen196.github.io.evil.example",
                                    "http://khangnguyen196.github.io", "http://localhost:5173"])
def test_cors_origin_la_khong_co_header(make_app, origin):
    with TestClient(make_app()) as c:
        r = c.get("/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in r.headers


def test_cors_preflight_github_io(make_app):
    with TestClient(make_app()) as c:
        r = c.options("/ocr", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST",
                                       "Access-Control-Request-Headers": "content-type, authorization"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == ORIGIN
    methods = {m.strip() for m in r.headers["access-control-allow-methods"].split(",")}
    assert methods == {"GET", "POST", "OPTIONS"}
    assert "content-type" in r.headers["access-control-allow-headers"].lower()
    assert "authorization" in r.headers["access-control-allow-headers"].lower()


def test_cors_preflight_origin_la_bi_tu_choi(make_app):
    with TestClient(make_app()) as c:
        r = c.options("/ocr", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers


@pytest.mark.parametrize("origin", ["http://localhost:5173", "https://127.0.0.1:8443", "http://localhost"])
def test_cors_localhost_chi_khi_bat(make_app, origin):
    with TestClient(make_app()) as c:
        assert "access-control-allow-origin" not in c.get("/health", headers={"Origin": origin}).headers
    with TestClient(make_app(cors_allow_localhost=True)) as c:
        assert c.get("/health", headers={"Origin": origin}).headers.get("access-control-allow-origin") == origin
        assert "access-control-allow-origin" not in c.get("/health", headers={"Origin": "http://localhost.evil.example"}).headers
        assert c.get("/health", headers={"Origin": ORIGIN}).headers.get("access-control-allow-origin") == ORIGIN


# ---------------- giới hạn lượt ----------------

def test_rate_limit_luot_21_bi_429_ip_khac_khong_anh_huong(make_app):
    app = make_app()
    img = jpeg_bytes()

    async def go():
        codes = [(await _apost(app, *multipart([("image", "a.jpg", img)]), ip="203.0.113.5")).status_code for _ in range(20)]
        r21 = await _apost(app, *multipart([("image", "a.jpg", img)]), ip="203.0.113.5")
        other = await _apost(app, *multipart([("image", "a.jpg", img)]), ip="203.0.113.6")
        return codes, r21, other

    codes, r21, other = asyncio.run(go())
    assert codes == [200] * 20
    assert r21.status_code == 429
    assert 1 <= int(r21.headers["retry-after"]) <= 60
    assert "error" in r21.json()
    assert other.status_code == 200


def test_x_forwarded_for_bi_bo_qua_khi_trust_proxy_tat(make_app):
    app = make_app(rate_limit_per_min=2)
    img = jpeg_bytes()

    async def go():
        out = []
        for i in range(3):
            out.append((await _apost(app, *multipart([("image", "a.jpg", img)]), ip="203.0.113.7",
                                     headers={"x-forwarded-for": f"10.0.0.{i}"})).status_code)
        return out

    assert asyncio.run(go()) == [200, 200, 429]


def test_x_forwarded_for_dung_khi_trust_proxy_bat_lay_phan_tu_phai(make_app):
    app = make_app(rate_limit_per_min=1, trust_proxy=True)
    img = jpeg_bytes()

    async def go():
        a = await _apost(app, *multipart([("image", "a.jpg", img)]), ip="10.9.9.9", headers={"x-forwarded-for": "1.1.1.1, 203.0.113.20"})
        # khách tự ghi IP giả ở bên trái: vẫn là 203.0.113.20 (phần tử phải nhất) -> bị chặn
        b = await _apost(app, *multipart([("image", "a.jpg", img)]), ip="10.9.9.9", headers={"x-forwarded-for": "9.9.9.9, 203.0.113.20"})
        c = await _apost(app, *multipart([("image", "a.jpg", img)]), ip="10.9.9.9", headers={"x-forwarded-for": "203.0.113.21"})
        return a.status_code, b.status_code, c.status_code

    assert asyncio.run(go()) == (200, 429, 200)


# ---------------- hàng đợi / đồng thời ----------------

def test_hang_doi_day_503_va_health_van_tra_loi(make_app):
    block = threading.Event()
    eng = FakeEngine(block=block)
    app = make_app(engine=eng, max_concurrent=1, queue_max=4)
    img = jpeg_bytes()

    async def go():
        transport = httpx.ASGITransport(app=app, client=("198.51.100.50", 1))
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
            body, ctype = multipart([("image", "a.jpg", img)])
            first = [asyncio.create_task(c.post("/ocr", content=body, headers={"content-type": ctype})) for _ in range(5)]
            # chờ ảnh đầu đang chạy trong threadpool (engine bị chặn)
            await asyncio.to_thread(eng.started.acquire, True, 10)
            for _ in range(50):
                if app.state.gate.inside == 5:
                    break
                await asyncio.sleep(0.02)
            health = await c.get("/health")  # vòng sự kiện không bị chặn khi đang OCR
            sixth = await c.post("/ocr", content=body, headers={"content-type": ctype})
            block.set()
            rest = await asyncio.gather(*first)
            return health, sixth, rest

    health, sixth, rest = asyncio.run(go())
    assert health.status_code == 200 and health.json()["modelLoaded"] is True
    assert sixth.status_code == 503
    assert int(sixth.headers["retry-after"]) > 0
    assert [r.status_code for r in rest] == [200] * 5
    assert eng.calls == 5


def test_chua_nap_model_503(make_app):
    eng = FakeEngine()
    eng.loaded = False
    r = post_image(make_app(engine=eng), jpeg_bytes())
    assert r.status_code == 503


# ---------------- đăng nhập ----------------

def test_auth_off_cho_qua(make_app):
    assert post_image(make_app(auth_mode="off"), jpeg_bytes()).status_code == 200


@pytest.mark.parametrize("mode", ["supabase", "Supabase", "on", "none", "OFF "])
def test_auth_khac_off_tu_choi_khoi_dong(make_app, mode):
    with pytest.raises(auth.AuthConfigError) as e:
        make_app(auth_mode=mode)
    if mode == "supabase":
        assert "chưa cài đặt, làm ở đợt dang-nhap" in str(e.value)


def test_auth_supabase_neu_lot_vao_ham_kiem_thi_501(make_app):
    app = make_app()
    from dataclasses import replace

    app.state.settings = replace(app.state.settings, auth_mode="supabase")  # giả như lọt qua bước khởi động
    r = post_image(app, jpeg_bytes())
    assert r.status_code == 501
    assert "dang-nhap" in r.json()["error"]


def test_auth_bien_moi_truong_supabase_lam_app_khong_tao_duoc(monkeypatch):
    import app as app_module
    from settings import load_settings

    monkeypatch.setenv("AUTH_MODE", "supabase")
    with pytest.raises(auth.AuthConfigError):
        app_module.create_app(load_settings())


# ---------------- health ----------------

def test_health_khong_lo_bien_moi_truong(make_app, monkeypatch):
    monkeypatch.setenv("BIEN_BI_MAT_THU", "khong-duoc-lo")
    with TestClient(make_app()) as c:
        j = c.get("/health").json()
    assert set(j) == {"ok", "modelLoaded", "engine", "version"}
    assert j["ok"] is True and j["modelLoaded"] is True
    assert "khong-duoc-lo" not in str(j)


# ---------------- không file tạm ----------------

def test_khong_sinh_file_tam_khi_gui_anh_4mb(make_app, monkeypatch, tmp_path):
    import starlette.formparsers as fp

    calls = []

    def spy(name, real):
        def f(*a, **k):
            calls.append(name)
            return real(*a, **k)
        return f

    tmpdir = tmp_path / "temp"
    tmpdir.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(tmpdir))
    for name in ("TemporaryFile", "NamedTemporaryFile", "SpooledTemporaryFile", "mkstemp", "mkdtemp"):
        monkeypatch.setattr(tempfile, name, spy(name, getattr(tempfile, name)))
    monkeypatch.setattr(fp, "SpooledTemporaryFile", spy("starlette.SpooledTemporaryFile", fp.SpooledTemporaryFile))

    data = noise_png(4 * MB)
    assert 3.9 * MB < len(data) < 5 * MB
    before = sorted(os.listdir(tmpdir))
    r = post_image(make_app(max_pixels=10**8), data)
    after = sorted(os.listdir(tmpdir))
    assert r.status_code == 200, r.text
    assert calls == [], f"có gọi tạo file tạm: {calls}"
    assert before == after == []


# ---------------- log ----------------

def test_log_khong_chua_chu_ocr_ten_file_ip(make_app, caplog):
    caplog.set_level(logging.INFO, logger="ocr_server")
    app = make_app()
    r = post_image(app, jpeg_bytes(), filename="ten-file-bi-mat.jpg", ip="203.0.113.77")
    assert r.status_code == 200 and r.json()["items"][0]["text"] == FAKE_TEXT
    text = "\n".join(rec.getMessage() for rec in caplog.records)
    assert "POST /ocr 200" in text and "1 khung" in text
    for secret in (FAKE_TEXT, "ten-file-bi-mat", "203.0.113.77"):
        assert secret not in text
    assert logging.getLogger("uvicorn.access").disabled is True
