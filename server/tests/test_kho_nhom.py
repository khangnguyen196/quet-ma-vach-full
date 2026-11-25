"""Kho sản phẩm của nhóm (đợt kho-nhom vòng 4): ký HMAC, POST /embed, nạp kho từ Supabase GIẢ, ứng viên "nhom" của /ocr.

Không gọi Supabase thật: KhoStore được thử với máy chủ HTTP giả trên 127.0.0.1 (http.server) và với hàm tải giả.
Khóa ký sinh ngẫu nhiên lúc chạy (secrets.token_hex), không phải khóa thật, không in ra.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import io
import json
import logging
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import httpx
import numpy as np
import pytest
from PIL import Image

import auth
import kho_nhom
from clip_engine import MODEL_ID
from conftest import FakeEngine, jpeg_bytes, make_settings, multipart
from test_auth import PUB_KEY, SB_URL, SUB, SUB_2, FakeSupabase, claims, es256

KEY_HEX = secrets.token_hex(32)
KEY = bytes.fromhex(KEY_HEX)
OTHER_UUID = "0a1b2c3d-0000-4000-8000-00000000c0de"


def rand_vec(rng) -> np.ndarray:
    v = rng.standard_normal(512)
    return (v / np.linalg.norm(v)).astype(np.float32)


def path_of(uid=SUB, img="11111111-2222-4333-8444-555555555555", ext="jpg"):
    return f"{uid}/{img}.{ext}"


def row(vec, duong_dan=None, pid="sp-1", ten="Bánh thử", ky=None, model=MODEL_ID, vec_json=None, **sp):
    duong_dan = duong_dan or path_of()
    return {"id": "a-" + duong_dan[-12:], "san_pham_id": pid, "duong_dan": duong_dan,
            "vec": kho_nhom.vec_to_json(vec) if vec_json is None else vec_json, "model": model,
            "ky": kho_nhom.sign(KEY, duong_dan, MODEL_ID, vec) if ky is None else ky,
            "nhom_san_pham": {"ten": ten, "thuong_hieu": sp.get("thuong_hieu", "Hãng A"), "ma_vach": sp.get("ma_vach")}}


# ---------------- khóa ----------------

def test_khoa_dung_64_hex():
    assert kho_nhom.parse_key(KEY_HEX) == KEY
    assert kho_nhom.parse_key("  " + KEY_HEX.upper() + "\n") == KEY  # chữ hoa / khoảng trắng hai đầu vẫn nhận
    for bad in (None, "", "   ", KEY_HEX[:-1], KEY_HEX + "0", "g" + KEY_HEX[1:], KEY_HEX[:32] + " " + KEY_HEX[33:],
                "0x" + KEY_HEX[2:]):
        assert kho_nhom.parse_key(bad) is None, bad
    assert kho_nhom.key_problem(KEY_HEX) is None


def test_khoa_thieu_sai_cau_ly_do_chi_co_ten_bien():
    assert kho_nhom.key_problem(None) == "thiếu biến KHO_NHOM_HMAC_KEY"
    assert kho_nhom.key_problem(" ") == "thiếu biến KHO_NHOM_HMAC_KEY"
    bad = KEY_HEX[:-2]
    msg = kho_nhom.key_problem(bad)
    assert msg == "biến KHO_NHOM_HMAC_KEY sai dạng (cần đúng 64 ký tự hex)" and bad not in msg


# ---------------- ký / kiểm ----------------

def test_ky_dung_cong_thuc_cua_kho_nhom_sql():
    v = rand_vec(np.random.default_rng(1))
    p = path_of()
    msg = b"kho-nhom-v1" + b"\x00" + p.encode("utf-8") + b"\x00" + MODEL_ID.encode("utf-8") + b"\x00" + v.astype("<f4").tobytes()
    want = hmac.new(KEY, msg, hashlib.sha256).hexdigest()
    assert kho_nhom.sign(KEY, p, MODEL_ID, v) == want
    assert len(want) == 64 and want == want.lower()
    assert len(msg) == 11 + 1 + len(p) + 1 + len(MODEL_ID) + 1 + 2048


def test_round_trip_json_float32_nhieu_vector():
    """ký -> JSON (như /embed trả) -> parse -> float32 -> kiểm ký đạt, 300 vector ngẫu nhiên."""
    rng = np.random.default_rng(20261126)
    for i in range(300):
        v = rand_vec(rng)
        p = path_of(img=f"{i:08x}-2222-4333-8444-555555555555")
        ky = kho_nhom.sign(KEY, p, MODEL_ID, v)
        body = json.dumps({"model": MODEL_ID, "vec": kho_nhom.vec_to_json(v), "ky": ky})
        back = json.loads(body)
        v2 = kho_nhom.vec_from_json(back["vec"])
        assert v2 is not None and np.array_equal(v2, v), i
        assert v2.tobytes() == v.tobytes()
        assert kho_nhom.verify(KEY, p, back["model"], v2, back["ky"]), i


def _pg_float4(x: np.float32) -> str:
    """Cách Postgres (≥ 12, extra_float_digits = 1) in real: số NGẮN NHẤT đọc lại đúng float4 (numpy str(float32) cũng là
    số ngắn nhất kiểu Dragon4), vd float32(0.1) -> "0.1"."""
    return str(np.float32(x))


def test_so_kieu_postgres_ngan_nhat_van_kiem_ky_dat():
    assert _pg_float4(np.float32(0.1)) == "0.1"
    rng = np.random.default_rng(7)
    for i in range(300):
        v = rand_vec(rng)
        if i == 0:
            v[0] = np.float32(0.1)  # có số 0.1 thật (chuẩn vẫn ≈ 1 sau khi chuẩn hóa lại)
            v = (v / np.linalg.norm(v.astype(np.float64))).astype(np.float32)
        p = path_of(img=f"{i:08x}-2222-4333-8444-555555555555")
        ky = kho_nhom.sign(KEY, p, MODEL_ID, v)
        text = "[" + ",".join(_pg_float4(x) for x in v) + "]"  # PostgREST trả real[] là mảng số JSON
        assert len(text) < len(json.dumps(kho_nhom.vec_to_json(v)))  # đúng là dạng ngắn hơn float64
        v2 = kho_nhom.vec_from_json(json.loads(text))
        assert v2 is not None and v2.tobytes() == v.tobytes(), i
        assert kho_nhom.verify(KEY, p, MODEL_ID, v2, ky), i
        # cách in float64 của float32 (vd app gửi lại nguyên số /embed trả) cũng đạt
        v3 = kho_nhom.vec_from_json(json.loads(json.dumps([float(x) for x in v])))
        assert kho_nhom.verify(KEY, p, MODEL_ID, v3, ky), i


def test_doi_1_bit_vec_duong_dan_model_thi_kiem_truot():
    rng = np.random.default_rng(3)
    for i in range(50):
        v = rand_vec(rng)
        p = path_of()
        ky = kho_nhom.sign(KEY, p, MODEL_ID, v)
        assert kho_nhom.verify(KEY, p, MODEL_ID, v, ky)
        bits = v.view(np.uint32).copy()
        j = int(rng.integers(512))
        bits[j] ^= np.uint32(1 << int(rng.integers(32)))
        assert not kho_nhom.verify(KEY, p, MODEL_ID, bits.view(np.float32), ky), i
        assert not kho_nhom.verify(KEY, path_of(img=OTHER_UUID), MODEL_ID, v, ky), i
        assert not kho_nhom.verify(KEY, path_of(ext="png"), MODEL_ID, v, ky), i
        assert not kho_nhom.verify(KEY, p, MODEL_ID + "x", v, ky), i
        assert not kho_nhom.verify(KEY, p, "clip-vit-b32-fp32-cat", v, ky), i
        assert not kho_nhom.verify(bytes(32), p, MODEL_ID, v, ky), i  # khóa khác
        flip = ky[:-1] + ("0" if ky[-1] != "0" else "1")
        assert not kho_nhom.verify(KEY, p, MODEL_ID, v, flip), i
    assert not kho_nhom.verify(KEY, p, MODEL_ID, v, ky.upper())  # chỉ nhận hex thường
    assert not kho_nhom.verify(KEY, p, MODEL_ID, v, None)


def test_chep_vec_ky_sang_duong_dan_khac_bi_bo():
    """Thử đỏ / xanh của vòng 4: chữ ký phủ duong_dan, chép cặp vec + ky của ảnh người khác sang đường dẫn của mình -> bỏ."""
    v = rand_vec(np.random.default_rng(11))
    goc = row(v, duong_dan=path_of(uid=SUB_2), pid="sp-cua-nguoi-khac")
    chep = dict(goc, duong_dan=path_of(uid=SUB, img=OTHER_UUID), san_pham_id="sp-cua-toi")
    kho = kho_nhom.build_kho([goc, chep], KEY)
    assert kho.n == 1 and kho.row_pid == ["sp-cua-nguoi-khac"]
    assert kho.dropped == {"ky": 1}


# ---------------- lọc dòng ----------------

def test_build_kho_bo_dong_sai_theo_ly_do():
    rng = np.random.default_rng(5)
    good = [row(rand_vec(rng), duong_dan=path_of(img=f"{i:08x}-2222-4333-8444-555555555555"), pid=f"sp-{i}")
            for i in range(3)]
    v = rand_vec(rng)
    vl = kho_nhom.vec_to_json(v)
    bad = [
        row(v, model="clip-vit-b32-fp32-cat"),                         # model khác
        row(v, vec_json=vl[:511]),                                     # 511 số
        row(v, vec_json=vl[:511] + [True]),                            # bool
        row(v, vec_json=vl[:511] + ["0.1"]),                           # chuỗi
        row(v, vec_json=vl[:511] + [None]),                            # null
        row(v, vec_json=[x * 2 for x in vl]),                          # chuẩn 2
        row(v, vec_json=vl[:511] + [1e39]),                            # tràn float32 -> vô cực
        row(v, vec_json="{" + ",".join(map(str, vl)) + "}"),            # chuỗi kiểu mảng Postgres: không nhận
        row(v, ky="A" * 64),                                           # ky chữ hoa
        row(v, ky="ab" * 31),                                          # ky 62 ký tự
        row(v, ky=kho_nhom.sign(bytes(32), path_of(), MODEL_ID, v)),   # ký bằng khóa khác
        row(v, duong_dan="../" + path_of()),                           # đường dẫn sai dạng
        dict(row(v), nhom_san_pham=None),                              # thiếu món
        dict(row(v), nhom_san_pham={"ten": "  "}),                     # tên rỗng
        dict(row(v), san_pham_id=None),
        "khong-phai-object",
    ]
    kho = kho_nhom.build_kho(good + bad, KEY)
    assert kho.n == 3 and kho.mat.shape == (3, 512) and kho.mat.dtype == np.float32
    assert kho.dropped == {"model": 1, "vec": 7, "ky": 4, "san_pham": 3, "dang": 1}


def test_vec_from_json_chuan_lech_1e3_bi_bo():
    v = rand_vec(np.random.default_rng(9)).astype(np.float64)
    assert kho_nhom.vec_from_json(list(v * 1.0009)) is not None
    assert kho_nhom.vec_from_json(list(v * 1.0011)) is None
    assert kho_nhom.vec_from_json([0] * 512) is None


def test_top_matches_moi_san_pham_lay_anh_giong_nhat_toi_da_3():
    rng = np.random.default_rng(13)
    q = rand_vec(rng)

    def near(t):  # vector có cos với q ≈ t
        r = rand_vec(rng).astype(np.float64)
        r -= np.dot(r, q) * q
        r /= np.linalg.norm(r)
        return (t * q + np.sqrt(1 - t * t) * r).astype(np.float32)

    sims = [("A", 0.31), ("B", 0.55), ("A", 0.92), ("C", 0.80), ("D", 0.10)]
    rows = [row(near(s), path_of(img=f"0000000{k}-2222-4333-8444-555555555555"), pid=pid, ten=f"Món {pid}",
                ma_vach="8934563163150" if pid == "C" else None, thuong_hieu=None)
            for k, (pid, s) in enumerate(sims)]
    kho = kho_nhom.build_kho(rows, KEY)
    out = kho_nhom.top_matches(kho, q)
    assert [m["san_pham_id"] for m in out] == ["A", "C", "B"]
    assert [m["diem"] for m in out] == [pytest.approx(0.92, abs=1e-4), pytest.approx(0.80, abs=1e-4),
                                        pytest.approx(0.55, abs=1e-4)]
    assert all(m["diem"] == round(m["diem"], 4) for m in out)
    assert set(out[0]) == {"san_pham_id", "ten", "thuong_hieu", "ma_vach", "diem"}
    assert out[1]["ma_vach"] == "8934563163150" and out[0]["ma_vach"] is None and out[0]["ten"] == "Món A"
    assert kho_nhom.top_matches(kho_nhom.empty_kho(), q) == []


# ---------------- KhoStore với máy chủ Supabase GIẢ (HTTP thật trên 127.0.0.1) ----------------

class FakeRest:
    """PostgREST giả: GET /rest/v1/nhom_anh?…&limit=&offset= -> trang của self.rows. mode: ok / 500 / 401 / slow /
    notlist."""

    def __init__(self, rows):
        self.rows = rows
        self.mode = "ok"
        self.calls = []
        self.slow_s = 2.0
        rest = self

        class H(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                u = urlsplit(self.path)
                q = parse_qs(u.query)
                rest.calls.append({"path": u.path, "q": q, "apikey": self.headers.get("apikey"),
                                   "auth": self.headers.get("authorization")})
                if rest.mode == "slow":
                    time.sleep(rest.slow_s)
                if rest.mode in ("500", "401"):
                    body, code = b'{"message":"loi"}', int(rest.mode)
                elif rest.mode == "notlist":
                    body, code = b'{"a":1}', 200
                else:
                    lim, off = int(q["limit"][0]), int(q["offset"][0])
                    body, code = json.dumps(rest.rows[off:off + lim]).encode(), 200
                try:
                    self.send_response(code)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except OSError:
                    pass

            def log_message(self, *a):
                pass

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.srv.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def rest():
    rng = np.random.default_rng(17)
    rows = [row(rand_vec(rng), path_of(img=f"{i:08x}-2222-4333-8444-555555555555"), pid=f"sp-{i % 3}")
            for i in range(5)]
    r = FakeRest(rows)
    yield r
    r.close()


TOKEN = "aaa.bbb.ccc"


def test_store_theo_trang_dung_url_header(rest):
    st = kho_nhom.KhoStore(rest.url, PUB_KEY, KEY, page_size=2)
    kho = st.get(TOKEN)
    assert kho.n == 5 and len(kho.products) == 3
    assert [c["q"]["offset"][0] for c in rest.calls] == ["0", "2", "4"]  # 2 + 2 + 1 dòng: dừng khi trang thiếu
    for c in rest.calls:
        assert c["path"] == "/rest/v1/nhom_anh"
        assert c["q"]["select"] == [kho_nhom.SELECT] and c["q"]["order"] == ["id"] and c["q"]["limit"] == ["2"]
        assert c["apikey"] == PUB_KEY and c["auth"] == "Bearer " + TOKEN
    assert kho_nhom.PAGE_SIZE == 1000 and kho_nhom.MAX_PAGES == 10 and kho_nhom.FETCH_TIMEOUT_S <= 3.0


def test_store_cham_tran_so_trang(rest, caplog):
    st = kho_nhom.KhoStore(rest.url, PUB_KEY, KEY, page_size=1, max_pages=3)
    with caplog.at_level(logging.WARNING, logger="ocr_server.kho_nhom"):
        kho = st.get(TOKEN)
    assert kho.n == 3 and len(rest.calls) == 3
    assert any("chạm trần 3 trang" in r.getMessage() for r in caplog.records)


def test_store_cache_60_giay_dung_chung(rest):
    clk = Clock()
    st = kho_nhom.KhoStore(rest.url, PUB_KEY, KEY, clock=clk)
    k1 = st.get(TOKEN)
    k2 = st.get("tok.cua.nguoi-khac")
    assert k1 is k2 and len(rest.calls) == 1 and kho_nhom.CACHE_TTL_S == 60.0
    clk.t += 59.9
    assert st.get(TOKEN) is k1 and len(rest.calls) == 1
    clk.t += 0.2
    assert st.get(TOKEN) is not k1 and len(rest.calls) == 2


@pytest.mark.parametrize("mode", ["500", "401", "notlist"])
def test_store_supabase_loi_tra_none_nho_loi_2_giay(rest, mode):
    clk = Clock()
    st = kho_nhom.KhoStore(rest.url, PUB_KEY, KEY, clock=clk)
    rest.mode = mode
    assert st.get(TOKEN) is None and len(rest.calls) == 1
    assert st.get(TOKEN) is None and len(rest.calls) == 1  # trong 2 giây: không gọi lại
    rest.mode = "ok"
    clk.t += kho_nhom.FAIL_TTL_S + 0.01
    assert st.get(TOKEN).n == 5 and len(rest.calls) == 2  # lỗi không bị nhớ lâu


def test_store_het_gio_tra_none_trong_han(rest):
    st = kho_nhom.KhoStore(rest.url, PUB_KEY, KEY, timeout=0.5)
    rest.mode = "slow"
    t = time.perf_counter()
    assert st.get(TOKEN) is None
    assert time.perf_counter() - t < 1.5


def test_store_may_chu_tat_tra_none():
    st = kho_nhom.KhoStore("http://127.0.0.1:9", PUB_KEY, KEY, timeout=1.0)
    assert st.get(TOKEN) is None


def test_store_log_khong_lo_token_khoa_du_lieu(rest, caplog):
    with caplog.at_level(logging.DEBUG):
        kho_nhom.KhoStore(rest.url, PUB_KEY, KEY).get(TOKEN)
        rest.mode = "500"
        kho_nhom.KhoStore(rest.url, PUB_KEY, KEY).get(TOKEN)
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "nạp 5 dòng (3 sản phẩm)" in text and "HTTP 500" in text
    for secret in (TOKEN, KEY_HEX, PUB_KEY, "Bánh thử", "2222-4333", rest.url):
        assert secret not in text


# ---------------- app: /health, /ocr, /embed ----------------

class FakeClip:
    """Vector giả theo màu trung bình của ảnh (ảnh cùng màu -> cùng vector). fail=True -> ném lỗi."""

    def __init__(self, fail=False):
        self.calls = 0
        self.fail = fail

    def embed_image(self, img):
        self.calls += 1
        if self.fail:
            raise RuntimeError("clip hỏng")
        m = np.asarray(img, dtype=np.float64).reshape(-1, 3).mean(axis=0) / 255.0
        v = np.zeros(512)
        v[:3] = m
        v[3] = 0.2
        return (v / np.linalg.norm(v)).astype(np.float32)


class FakeFetch:
    def __init__(self, rows=None, fail=None):
        self.rows = [] if rows is None else rows
        self.fail = fail
        self.calls = 0
        self.headers = []

    def __call__(self, url, headers, timeout):
        self.calls += 1
        self.headers.append(headers)
        if self.fail is not None:
            raise self.fail
        q = parse_qs(urlsplit(url).query)
        off, lim = int(q["offset"][0]), int(q["limit"][0])
        return 200, self.rows[off:off + lim]


def make_nhom_app(rows=None, key=KEY, auth_mode="supabase", clip="fake", fetch=None, parallel=False, **kw):
    import app as app_module

    fake = FakeSupabase()
    fetch = fetch or FakeFetch(rows)
    clip = FakeClip() if clip == "fake" else clip
    if auth_mode == "supabase":
        s = make_settings(auth_mode="supabase", supabase_url=SB_URL, supabase_publishable_key=PUB_KEY,
                          nhom_parallel=parallel, **kw)
        v = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=fake.fetch_jwks, fetch_user=fake.fetch_user)
    else:
        s = make_settings(nhom_parallel=parallel, **kw)
        v = None
    store = kho_nhom.KhoStore(SB_URL, PUB_KEY, key, fetch=fetch) if key else None
    a = app_module.create_app(s, engine=FakeEngine(), verifier=v, clip=clip, nhom_key=key, nhom_store=store)
    a.state.test_fetch = fetch
    return a


async def _areq(a, path, token=None, img=None, duong_dan=None, extra=None, method="POST"):
    headers = {}
    if token is not None:
        headers["authorization"] = "Bearer " + token
    transport = httpx.ASGITransport(app=a, client=("198.51.100.9", 40000))
    async with a.router.lifespan_context(a):
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            if method == "GET":
                return await c.get(path, headers=headers)
            fields = [("image", "anh.jpg", img if img is not None else jpeg_bytes())]
            if duong_dan is not None:
                fields.append(("duong_dan", None, duong_dan.encode("utf-8")))
            fields += extra or []
            body, ctype = multipart(fields)
            headers["content-type"] = ctype
            return await c.post(path, content=body, headers=headers)


def req(a, path, **kw):
    return asyncio.run(_areq(a, path, **kw))


def health(a):
    return req(a, "/health", method="GET").json()


def test_health_bat_chi_khi_du_3_dieu_kien():
    j = health(make_nhom_app())
    assert j["nhom"] == {"enabled": True} and j["clip"] == {"loaded": True, "model": MODEL_ID}
    assert health(make_nhom_app(key=None))["nhom"] == {"enabled": False}           # thiếu khóa
    assert health(make_nhom_app(auth_mode="off"))["nhom"] == {"enabled": False}    # AUTH_MODE=off
    j = health(make_nhom_app(clip=None))                                             # CLIP chưa nạp
    assert j["nhom"] == {"enabled": False} and j["clip"] == {"loaded": False, "model": None}


def test_khoa_tu_bien_moi_truong_thieu_sai_thi_tat_van_khoi_dong(monkeypatch, caplog):
    import app as app_module

    def mk():
        s = make_settings(auth_mode="supabase", supabase_url=SB_URL, supabase_publishable_key=PUB_KEY)
        fake = FakeSupabase()
        v = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=fake.fetch_jwks, fetch_user=fake.fetch_user)
        return app_module.create_app(s, engine=FakeEngine(), verifier=v, clip=FakeClip())

    bad = KEY_HEX[:-1] + "z"
    with caplog.at_level(logging.INFO):
        assert health(mk())["nhom"] == {"enabled": False}  # thiếu
        monkeypatch.setenv("KHO_NHOM_HMAC_KEY", bad)
        assert health(mk())["nhom"] == {"enabled": False}  # sai dạng
        monkeypatch.setenv("KHO_NHOM_HMAC_KEY", KEY_HEX)
        a = mk()
        assert health(a)["nhom"] == {"enabled": True}
        assert not hasattr(a.state, "nhom_key")
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "kho nhóm TẮT: thiếu biến KHO_NHOM_HMAC_KEY" in text
    assert "kho nhóm TẮT: biến KHO_NHOM_HMAC_KEY sai dạng (cần đúng 64 ký tự hex)" in text
    assert "kho nhóm BẬT" in text
    assert KEY_HEX not in text and bad not in text and KEY_HEX.upper() not in text


def test_ocr_tat_thi_y_het_truoc_khong_goi_supabase_khong_tinh_vector():
    for a in (make_nhom_app(key=None), make_nhom_app(clip=None), make_nhom_app(auth_mode="off")):
        r = req(a, "/ocr", token=es256())
        assert r.status_code == 200 and "nhom" not in r.json()
        assert a.state.test_fetch.calls == 0


@pytest.mark.parametrize("parallel", [False, True])
def test_ocr_kho_rong_khong_co_nhom_khong_tinh_vector(parallel):
    a = make_nhom_app(rows=[], parallel=parallel)
    r = req(a, "/ocr", token=es256())
    assert r.status_code == 200 and "nhom" not in r.json() and r.json()["items"]
    assert a.state.clip.calls == 0 and a.state.test_fetch.calls == 1


@pytest.mark.parametrize("parallel", [False, True])
def test_ocr_supabase_loi_van_tra_chu_nhu_cu(parallel):
    a = make_nhom_app(fetch=FakeFetch(fail=auth.UpstreamError("TimeoutError")), parallel=parallel)
    r = req(a, "/ocr", token=es256())
    assert r.status_code == 200 and "nhom" not in r.json() and r.json()["items"]
    assert a.state.clip.calls == 0


@pytest.mark.parametrize("parallel", [False, True])
def test_ocr_clip_loi_van_tra_chu_nhu_cu(parallel, caplog):
    rng = np.random.default_rng(1)
    a = make_nhom_app(rows=[row(rand_vec(rng))], clip=FakeClip(fail=True), parallel=parallel)
    with caplog.at_level(logging.ERROR):
        r = req(a, "/ocr", token=es256())
    assert r.status_code == 200 and "nhom" not in r.json() and r.json()["items"]
    assert any("lỗi khi so kho nhóm: RuntimeError" in x.getMessage() for x in caplog.records)


def test_ocr_supabase_treo_qua_3_giay_van_tra(monkeypatch):
    class Slow:
        calls = 0

        def __call__(self, url, headers, timeout):
            self.calls += 1
            time.sleep(timeout + 1.0)
            return 200, []

    a = make_nhom_app(fetch=Slow())
    a.state.nhom_store.timeout = 0.5
    t = time.perf_counter()
    r = req(a, "/ocr", token=es256())
    assert r.status_code == 200 and "nhom" not in r.json()
    assert time.perf_counter() - t < 1.4
    # luồng nạp bị bỏ (abandon) vẫn chạy tới hết: chờ nó xong để log của nó không rơi sau khi test đóng stderr
    assert a.state.nhom_store._lock.acquire(timeout=5)
    a.state.nhom_store._lock.release()


@pytest.mark.parametrize("parallel", [False, True])
def test_kho_bat_chi_lap_cache_sau_khi_token_hop_le(parallel):
    """Vòng 5 (review NÊN SỬA 3): kho BẬT (khóa thử, CLIP giả, Supabase giả có 1 dòng): /ocr không token / token sai -> 401,
    bị giới hạn IP -> 429; không ca nào gọi Supabase (nạp kho) hay tính vector."""
    rng = np.random.default_rng(29)
    a = make_nhom_app(rows=[row(rand_vec(rng))], parallel=parallel, rate_limit_per_min=2)
    assert health(a)["nhom"] == {"enabled": True}
    r = req(a, "/ocr")  # không token (lượt IP 1)
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
    r = req(a, "/ocr", token="khong.phai.token")  # token sai (lượt IP 2)
    assert r.status_code == 401
    r = req(a, "/ocr", token=es256())  # token đúng nhưng IP hết lượt -> 429 trước khi kiểm token
    assert r.status_code == 429 and "Retry-After" in r.headers
    assert a.state.test_fetch.calls == 0 and a.state.clip.calls == 0
    assert a.state.nhom_store.fetches == 0 and a.state.nhom_store._cache is None
    # đối chứng: app mới, token đúng -> nạp kho 1 lần, có nhom
    b = make_nhom_app(rows=[row(rand_vec(rng))], parallel=parallel)
    r = req(b, "/ocr", token=es256())
    assert r.status_code == 200 and "nhom" in r.json()
    assert b.state.test_fetch.calls == 1 and b.state.clip.calls == 1


def test_song_song_cho_kho_truoc_khi_giu_khoa_ocr(monkeypatch):
    """Vòng 5 (review NÊN SỬA 2): chế độ song song chờ nạp kho XONG rồi mới giữ khóa OCR (không giữ khóa trong lúc chờ
    Supabase). Supabase giả chậm (chờ tối đa 1 giây, dưới hết giờ 3 giây); Slot.acquire được bọc để ghi lúc giữ khóa thì
    nạp kho đã xong chưa, rồi thả Supabase giả ngay (thứ tự cũ: giữ khóa khi kho chưa xong -> ghi False, không phải chờ)."""
    import ratelimit

    seen = {}
    may_tra = threading.Event()
    xong = {"kho": False}
    holder = {}

    class SlowFetch:
        calls = 0

        def __call__(self, url, headers, timeout):
            self.calls += 1
            may_tra.wait(1.0)
            seen["khoa_ocr_khi_nap_xong"] = holder["a"].state.gate._sem.locked()
            xong["kho"] = True
            return 200, []

    orig = ratelimit.Slot.acquire

    async def acquire(self):
        seen.setdefault("kho_xong_khi_giu_khoa", xong["kho"])
        may_tra.set()
        await orig(self)

    monkeypatch.setattr(ratelimit.Slot, "acquire", acquire)
    a = make_nhom_app(fetch=SlowFetch(), parallel=True)
    holder["a"] = a
    r = req(a, "/ocr", token=es256())
    assert r.status_code == 200 and r.json()["items"]
    assert a.state.test_fetch.calls == 1
    assert seen["kho_xong_khi_giu_khoa"] is True       # giữ khóa OCR SAU khi kho đã nạp xong
    assert seen["khoa_ocr_khi_nap_xong"] is False      # suốt lúc chờ Supabase, khóa OCR chưa bị giữ
    assert a.state.gate.inside == 0 and not a.state.gate._sem.locked()  # trả chỗ + khóa đúng 1 lần


def test_noi_tiep_van_giu_khoa_ocr_trong_luc_nap_kho(monkeypatch):
    """Nhánh nối tiếp giữ như cũ: nạp kho chạy song song với OCR (khóa OCR giữ trong lúc kho đang nạp)."""
    import ratelimit

    seen = {}
    may_tra = threading.Event()
    xong = {"kho": False}

    def fetch(url, headers, timeout):
        may_tra.wait(1.0)
        xong["kho"] = True
        return 200, []

    orig = ratelimit.Slot.acquire

    async def acquire(self):
        seen.setdefault("kho_xong_khi_giu_khoa", xong["kho"])
        await orig(self)
        may_tra.set()

    monkeypatch.setattr(ratelimit.Slot, "acquire", acquire)
    a = make_nhom_app(fetch=fetch, parallel=False)
    r = req(a, "/ocr", token=es256())
    assert r.status_code == 200 and seen["kho_xong_khi_giu_khoa"] is False
    assert a.state.gate.inside == 0 and not a.state.gate._sem.locked()


@pytest.mark.parametrize("parallel", [False, True])
def test_embed_roi_ocr_ra_ung_vien_nhom(parallel):
    """/embed ảnh đỏ -> lưu (giả lập app ghi vào Supabase) -> /ocr ảnh đỏ ra đúng món, điểm 1.0."""
    a = make_nhom_app(rows=[], parallel=parallel)
    tok = es256()
    p_do = path_of()
    r = req(a, "/embed", token=tok, img=jpeg_bytes(color=(200, 30, 30)), duong_dan=p_do)
    assert r.status_code == 200, r.text
    j = r.json()
    assert set(j) == {"model", "vec", "ky"} and j["model"] == MODEL_ID and len(j["vec"]) == 512
    assert kho_nhom.verify(KEY, p_do, MODEL_ID, kho_nhom.vec_from_json(j["vec"]), j["ky"])
    p_xanh = path_of(img=OTHER_UUID)
    j2 = req(a, "/embed", token=tok, img=jpeg_bytes(color=(30, 30, 200)), duong_dan=p_xanh).json()
    a.state.test_fetch.rows = [
        {"id": "1", "san_pham_id": "sp-do", "duong_dan": p_do, "vec": j["vec"], "model": j["model"], "ky": j["ky"],
         "nhom_san_pham": {"ten": "Bánh đỏ", "thuong_hieu": None, "ma_vach": "8934563163150"}},
        {"id": "2", "san_pham_id": "sp-xanh", "duong_dan": p_xanh, "vec": j2["vec"], "model": j2["model"], "ky": j2["ky"],
         "nhom_san_pham": {"ten": "Bánh xanh", "thuong_hieu": "Hãng B", "ma_vach": None}},
    ]
    r = req(a, "/ocr", token=tok, img=jpeg_bytes(color=(200, 30, 30)))
    assert r.status_code == 200
    out = r.json()
    assert out["items"] and "nhom" in out
    nhom = out["nhom"]
    assert [m["san_pham_id"] for m in nhom] == ["sp-do", "sp-xanh"]
    assert nhom[0] == {"san_pham_id": "sp-do", "ten": "Bánh đỏ", "thuong_hieu": None, "ma_vach": "8934563163150",
                       "diem": 1.0}
    assert nhom[1]["diem"] < 1.0


def test_embed_tat_503_khong_doc_token():
    a = make_nhom_app(key=None)
    r = req(a, "/embed", duong_dan=path_of())
    assert r.status_code == 503 and r.json()["error"] == "Kho nhóm chưa bật trên máy chủ."
    r = req(make_nhom_app(auth_mode="off"), "/embed", duong_dan=path_of())
    assert r.status_code == 503


def test_embed_khong_token_401_token_sai_401():
    a = make_nhom_app()
    r = req(a, "/embed", duong_dan=path_of())
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
    r = req(a, "/embed", token="khong.phai.token", duong_dan=path_of())
    assert r.status_code == 401


def test_embed_sai_uid_403():
    r = req(make_nhom_app(), "/embed", token=es256(), duong_dan=path_of(uid=SUB_2))
    assert r.status_code == 403
    assert r.json()["error"] == "Đường dẫn ảnh phải nằm trong thư mục của chính tài khoản đang đăng nhập."
    # token của SUB_2 thì chính đường dẫn đó được
    r = req(make_nhom_app(), "/embed", token=es256(claims(sub=SUB_2)), duong_dan=path_of(uid=SUB_2))
    assert r.status_code == 200


@pytest.mark.parametrize("bad", [
    "", "abc", path_of(ext="gif"), path_of(ext="JPG"), path_of() + "\n", "/" + path_of(), path_of().upper(),
    SUB + "/" + OTHER_UUID + ".jpg/x.jpg", SUB + "//" + OTHER_UUID + ".jpg", SUB + "/../" + OTHER_UUID + ".jpg",
    path_of(ext="webp"), path_of(ext="jpeg"),
])
def test_embed_duong_dan_sai_dang_400(bad):
    r = req(make_nhom_app(), "/embed", token=es256(), duong_dan=bad)
    assert r.status_code == 400, bad
    assert r.json()["error"].startswith("Đường dẫn ảnh sai dạng")


def test_embed_thieu_duong_dan_hoac_qua_dai_hoac_2_lan_400():
    a = make_nhom_app()
    r = req(a, "/embed", token=es256())
    assert r.status_code == 400 and r.json()["error"] == "Thiếu trường 'duong_dan' (đường dẫn ảnh trong kho nhóm)."
    r = req(a, "/embed", token=es256(), duong_dan="x" * 300)
    assert r.status_code == 400 and "quá dài" in r.json()["error"]
    r = req(a, "/embed", token=es256(), duong_dan=path_of(), extra=[("duong_dan", None, path_of().encode())])
    assert r.status_code == 400 and "2 lần" in r.json()["error"]


def test_embed_anh_loi_415_khong_ky():
    r = req(make_nhom_app(), "/embed", token=es256(), duong_dan=path_of(), img=b"khong phai anh")
    assert r.status_code == 415 and "ky" not in r.json()


def test_embed_anh_qua_hep_400():
    buf = io.BytesIO()
    Image.new("RGB", (1000, 20), (1, 2, 3)).save(buf, "PNG")

    class ClipThat:  # tiền xử lý thật (ném ClipImageError) với session giả
        def embed_image(self, img):
            import clip_engine

            clip_engine.preprocess(np.asarray(img))
            raise AssertionError("không được tới đây")

    # vòng 5: ảnh PNG -> đường dẫn .png (đuôi phải khớp định dạng byte)
    r = req(make_nhom_app(clip=ClipThat()), "/embed", token=es256(), duong_dan=path_of(ext="png"), img=buf.getvalue())
    assert r.status_code == 400 and r.json()["error"] == "Ảnh quá hẹp để tính vector."


# ---------------- vòng 5: /embed khớp bucket nhom-anh (JPEG / PNG ≤ 2.097.152 B, đuôi khớp định dạng) ----------------

def _padded(data: bytes, size: int) -> bytes:
    """Ảnh hợp lệ + byte 0 sau phần kết thúc, đúng `size` byte (Pillow bỏ qua phần thừa sau EOI / IEND)."""
    assert len(data) <= size
    return data + b"\x00" * (size - len(data))


def test_embed_duong_dan_webp_400_khong_tinh_vector():
    a = make_nhom_app()
    r = req(a, "/embed", token=es256(), duong_dan=path_of(ext="webp"))
    assert r.status_code == 400
    assert r.json()["error"] == "Đường dẫn ảnh sai dạng (cần <mã tài khoản>/<mã ảnh>.jpg hoặc .png)."
    assert a.state.clip.calls == 0
    assert kho_nhom.path_uid(path_of(ext="webp")) is None and kho_nhom.path_format(path_of(ext="webp")) is None
    assert kho_nhom.path_format(path_of()) == "jpeg" and kho_nhom.path_format(path_of(ext="png")) == "png"


def test_embed_tran_2097152_byte():
    import app as app_module
    from conftest import png_bytes

    assert app_module.EMBED_MAX_BYTES == 2_097_152
    a = make_nhom_app()
    r = req(a, "/embed", token=es256(), duong_dan=path_of(), img=_padded(jpeg_bytes(), 2_097_152))
    assert r.status_code == 200, r.text
    assert "ky" in r.json()
    r = req(a, "/embed", token=es256(), duong_dan=path_of(ext="png"), img=_padded(png_bytes(), 2_097_152))
    assert r.status_code == 200, r.text
    calls = a.state.clip.calls
    r = req(a, "/embed", token=es256(), duong_dan=path_of(), img=_padded(jpeg_bytes(), 2_097_153))
    assert r.status_code == 413 and r.json()["error"] == "Ảnh quá lớn (tối đa 2 MB)."
    assert a.state.clip.calls == calls
    # /ocr KHÔNG đổi: vẫn nhận ảnh 2.097.153 B (trần 5 MB)
    r = req(a, "/ocr", token=es256(), img=_padded(jpeg_bytes(), 2_097_153))
    assert r.status_code == 200, r.text


def test_embed_byte_lech_duoi_400():
    from conftest import png_bytes

    a = make_nhom_app()
    r = req(a, "/embed", token=es256(), duong_dan=path_of(), img=png_bytes())  # byte PNG, đuôi .jpg
    assert r.status_code == 400
    assert r.json()["error"] == ("Ảnh là PNG nhưng đường dẫn không có đuôi .png: gửi đúng ảnh sẽ tải lên kho nhóm, với "
                                 "đuôi khớp định dạng ảnh.")
    r = req(a, "/embed", token=es256(), duong_dan=path_of(ext="png"), img=jpeg_bytes())  # byte JPEG, đuôi .png
    assert r.status_code == 400
    assert r.json()["error"] == ("Ảnh là JPEG nhưng đường dẫn không có đuôi .jpg: gửi đúng ảnh sẽ tải lên kho nhóm, với "
                                 "đuôi khớp định dạng ảnh.")
    assert a.state.clip.calls == 0
    assert req(a, "/embed", token=es256(), duong_dan=path_of(ext="png"), img=png_bytes()).status_code == 200


@pytest.mark.parametrize("ext", ["jpg", "png"])
def test_embed_heic_va_loai_khac_415(ext):
    a = make_nhom_app()
    heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64
    webp = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 64
    gif = b"GIF89a" + b"\x00" * 64
    for data in (heic, webp, gif):
        r = req(a, "/embed", token=es256(), duong_dan=path_of(ext=ext), img=data)
        assert r.status_code == 415 and r.json()["error"] == "Kho nhóm chỉ nhận ảnh JPEG hoặc PNG.", data[:12]
    assert a.state.clip.calls == 0
    # /ocr KHÔNG đổi: HEIC vẫn đi đường cũ (không bị câu 415 của kho nhóm)
    r = req(a, "/ocr", token=es256(), img=heic)
    assert r.json().get("error") != "Kho nhóm chỉ nhận ảnh JPEG hoặc PNG."


def test_dong_kho_webp_chu_ky_dung_cong_thuc_van_bi_bo():
    """SQL dòng 1–306 vẫn cho duong_dan .webp; máy chủ không ký .webp, và dòng .webp có chữ ký ĐÚNG công thức (vd ký bằng
    khóa thật ở nơi khác) vẫn bị bỏ khi nạp (lý do "ky")."""
    rng = np.random.default_rng(23)
    v = rand_vec(rng)
    p_webp = path_of(ext="webp")
    dong = row(v, duong_dan=p_webp, ky=kho_nhom.sign(KEY, p_webp, MODEL_ID, v))
    assert kho_nhom.verify(KEY, p_webp, MODEL_ID, v, dong["ky"])  # chữ ký đúng công thức
    tot = row(rand_vec(rng), duong_dan=path_of(img=OTHER_UUID), pid="sp-tot")
    kho = kho_nhom.build_kho([dong, tot], KEY)
    assert kho.n == 1 and kho.row_pid == ["sp-tot"] and kho.dropped == {"ky": 1}


def test_embed_tinh_vao_luot_ngay_va_phut_nhu_ocr():
    a = make_nhom_app(daily_limit_per_user=1)
    assert req(a, "/embed", token=es256(), duong_dan=path_of()).status_code == 200
    r = req(a, "/ocr", token=es256())
    assert r.status_code == 429 and "hôm nay" in r.json()["error"]
    b = make_nhom_app(rate_limit_user_per_min=1)
    assert req(b, "/ocr", token=es256()).status_code == 200
    assert req(b, "/embed", token=es256(), duong_dan=path_of()).status_code == 429


def test_log_khong_co_khoa_token_duong_dan(caplog):
    rng = np.random.default_rng(2)
    tok = es256()
    a = make_nhom_app(rows=[row(rand_vec(rng))])
    with caplog.at_level(logging.DEBUG):
        req(a, "/embed", token=tok, duong_dan=path_of(img=OTHER_UUID))
        req(a, "/embed", token=tok, duong_dan=path_of(uid=SUB_2))
        req(a, "/ocr", token=tok)
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "POST /embed 200" in text and "POST /embed 403" in text and "POST /ocr 200" in text
    for secret in (KEY_HEX, tok, OTHER_UUID, SUB, SUB_2, "Bánh thử"):
        assert secret not in text, secret


# ---------------- CLIP THẬT (model int8 ở D:\tmp\lens; CI không có thì skip có lý do, như test_clip_engine.py) ----------------

from test_clip_engine import MODEL as CLIP_MODEL  # noqa: E402

real_clip = pytest.mark.skipif(not CLIP_MODEL.is_file(), reason=f"không có model CLIP int8 ({CLIP_MODEL}) trên máy này")


@real_clip
@pytest.mark.parametrize("parallel", [False, True])
def test_that_clip_nap_tu_bien_embed_roi_ocr(monkeypatch, parallel):
    """CLIP_MODEL_PATH thật -> lifespan nạp model -> /embed ảnh -> lưu -> /ocr cùng ảnh ra đúng món, điểm ≈ 1."""
    import app as app_module

    monkeypatch.setenv("CLIP_MODEL_PATH", str(CLIP_MODEL))
    fake = FakeSupabase()
    fetch = FakeFetch([])
    s = make_settings(auth_mode="supabase", supabase_url=SB_URL, supabase_publishable_key=PUB_KEY, nhom_parallel=parallel)
    v = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=fake.fetch_jwks, fetch_user=fake.fetch_user)
    a = app_module.create_app(s, engine=FakeEngine(), verifier=v, nhom_key=KEY,
                              nhom_store=kho_nhom.KhoStore(SB_URL, PUB_KEY, KEY, fetch=fetch))
    rng = np.random.default_rng(4)
    imgs = []
    for i in range(2):
        arr = (rng.random((300, 400, 3)) * 255).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, "PNG")
        imgs.append(buf.getvalue())

    async def run():
        transport = httpx.ASGITransport(app=a, client=("198.51.100.9", 40000))
        async with a.router.lifespan_context(a):
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
                h = (await c.get("/health")).json()
                assert h["clip"] == {"loaded": True, "model": MODEL_ID} and h["nhom"] == {"enabled": True}
                tok = {"authorization": "Bearer " + es256()}
                outs = []
                for i, im in enumerate(imgs):
                    p = path_of(img=f"{i:08x}-2222-4333-8444-555555555555", ext="png")
                    body, ctype = multipart([("image", "a.png", im), ("duong_dan", None, p.encode())])
                    r = await c.post("/embed", content=body, headers={**tok, "content-type": ctype})
                    assert r.status_code == 200, r.text
                    outs.append((p, r.json()))
                fetch.rows = [row(kho_nhom.vec_from_json(j["vec"]), duong_dan=p, pid=f"sp-{i}", ky=j["ky"])
                              for i, (p, j) in enumerate(outs)]
                body, ctype = multipart([("image", "a.png", imgs[1])])
                r = await c.post("/ocr", content=body, headers={**tok, "content-type": ctype})
                return r.json()

    out = asyncio.run(run())
    assert out["nhom"][0]["san_pham_id"] == "sp-1" and out["nhom"][0]["diem"] >= 0.9999
    assert len(out["nhom"]) == 2 and out["nhom"][1]["diem"] < out["nhom"][0]["diem"]
