"""Test kiểm token Supabase của máy chủ (AUTH_MODE=supabase), đợt dang-nhap.

Khóa thử tự sinh bằng cryptography (cặp ES256, RS256), JWKS giả, /auth/v1/user giả, đồng hồ giả. Không test nào gọi
Internet thật: 2 test urllib thật dùng http.server cục bộ trên 127.0.0.1.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import http.server
import json
import logging
import threading
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

import auth
from conftest import FakeEngine, jpeg_bytes, make_settings, multipart
from settings import SettingsError, load_settings

SB_URL = "https://duanthu-abcdefgh.supabase.co"
ISS = SB_URL + "/auth/v1"
PUB_KEY = "sb_publishable_KHOA-CONG-KHAI-THU"
SUB = "8f0c1d2e-1111-4000-8000-0000000000aa"
SUB_2 = "8f0c1d2e-2222-4000-8000-0000000000bb"
EMAIL = "nguoi.thu.bi.mat@example.com"
DROP = object()  # đánh dấu "bỏ trường này khỏi payload"
# getattr: file vẫn thu thập được trên auth.py cũ (thử đỏ / xanh: từng test đỏ riêng, không phải lỗi thu thập)
UPSTREAM = getattr(auth, "UpstreamError", RuntimeError)

EC_PRIV = ec.generate_private_key(ec.SECP256R1())
EC_OTHER = ec.generate_private_key(ec.SECP256R1())  # khóa lạ, không có trong JWKS
RSA_PRIV = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def jwk_of(pub, kid, alg):
    to_jwk = ECAlgorithm.to_jwk if isinstance(pub, ec.EllipticCurvePublicKey) else RSAAlgorithm.to_jwk
    d = json.loads(to_jwk(pub))
    d.update({"kid": kid, "alg": alg, "use": "sig"})
    return d


JWKS = {"keys": [jwk_of(EC_PRIV.public_key(), "ec-1", "ES256"), jwk_of(RSA_PRIV.public_key(), "rsa-1", "RS256")]}


def claims(**kw):
    now = int(time.time())
    c = {"sub": SUB, "aud": "authenticated", "iss": ISS, "exp": now + 3600, "iat": now, "email": EMAIL,
         "role": "authenticated", "is_anonymous": False}
    c.update(kw)
    return {k: v for k, v in c.items() if v is not DROP}


def es256(payload=None, kid="ec-1", key=EC_PRIV):
    return jwt.encode(claims() if payload is None else payload, key, algorithm="ES256", headers={"kid": kid})


def rs256(payload=None, kid="rsa-1"):
    return jwt.encode(claims() if payload is None else payload, RSA_PRIV, algorithm="RS256", headers={"kid": kid})


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def hand_token(header: dict, payload: dict, sig: bytes | None = None, secret: bytes | None = None) -> str:
    """Ghép token bằng tay (PyJWT từ chối ký HS256 bằng khóa công khai, và không tạo alg lạ)."""
    head = b64(json.dumps(header).encode()) + "." + b64(json.dumps(payload).encode())
    if secret is not None:
        sig = hmac.new(secret, head.encode(), hashlib.sha256).digest()
    return head + "." + b64(sig if sig is not None else b"chu-ky-gia")


def hs256(payload=None, secret=b"khoa-bi-mat-gia-cua-test"):
    return hand_token({"alg": "HS256", "typ": "JWT"}, claims() if payload is None else payload, secret=secret)


class FakeSupabase:
    """JWKS + /auth/v1/user giả: đếm lần gọi; jwks / user là giá trị trả về (status, body) hoặc lỗi để ném."""

    def __init__(self, jwks=None, user=None):
        self.jwks = (200, JWKS) if jwks is None else jwks
        self.user = (200, {"id": SUB, "email": EMAIL, "is_anonymous": False}) if user is None else user
        self.jwks_calls = 0
        self.user_calls = 0
        self.urls = []
        self.user_args = []

    def fetch_jwks(self, url):
        self.jwks_calls += 1
        self.urls.append(url)
        if isinstance(self.jwks, BaseException):
            raise self.jwks
        return self.jwks

    def fetch_user(self, url, apikey, token):
        self.user_calls += 1
        self.urls.append(url)
        self.user_args.append((apikey, token))
        if isinstance(self.user, BaseException):
            raise self.user
        return self.user


class Clock:
    """Đồng hồ giả: mono (time.monotonic) và wall (time.time) cùng tiến."""

    def __init__(self):
        self.t = 1000.0
        self.base = time.time()

    def mono(self):
        return self.t

    def wall(self):
        return self.base + (self.t - 1000.0)


def make_sb_app(fake=None, clock=None, **kw):
    import app as app_module

    fake = fake or FakeSupabase()
    s = make_settings(auth_mode="supabase", supabase_url=SB_URL, supabase_publishable_key=PUB_KEY, **kw)
    extra = {"clock": clock.mono, "wall": clock.wall} if clock else {}
    v = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=fake.fetch_jwks, fetch_user=fake.fetch_user, **extra)
    return app_module.create_app(s, engine=FakeEngine(), verifier=v)


async def _apost(app, token=None, ip="198.51.100.7", raw_auth=None, origin=None):
    body, ctype = multipart([("image", "anh.jpg", jpeg_bytes())])
    headers = {"content-type": ctype}
    if origin is not None:
        headers["origin"] = origin
    if raw_auth is not None:
        headers["authorization"] = raw_auth
    elif token is not None:
        headers["authorization"] = "Bearer " + token
    transport = httpx.ASGITransport(app=app, client=(ip, 40000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        return await c.post("/ocr", content=body, headers=headers)


def post(app, token=None, **kw):
    return asyncio.run(_apost(app, token, **kw))


def assert_401(r):
    assert r.status_code == 401, r.text
    assert r.headers["www-authenticate"].startswith("Bearer")
    assert "error" in r.json()


# ---------------- hợp lệ ----------------

def test_es256_hop_le_200_va_goi_dung_url_jwks():
    fake = FakeSupabase()
    r = post(make_sb_app(fake), es256())
    assert r.status_code == 200, r.text
    assert fake.urls == [SB_URL + "/auth/v1/.well-known/jwks.json"]
    assert fake.user_calls == 0


def test_rs256_hop_le_200():
    assert post(make_sb_app(), rs256()).status_code == 200


def test_jwks_luu_trong_ram_10_phut():
    clk = Clock()
    fake = FakeSupabase()
    app = make_sb_app(fake, clk)
    for _ in range(3):
        assert post(app, es256()).status_code == 200
    assert fake.jwks_calls == 1
    clk.t += 599
    assert post(app, es256()).status_code == 200
    assert fake.jwks_calls == 1
    clk.t += 2  # quá 10 phút -> tải lại
    assert post(app, es256()).status_code == 200
    assert fake.jwks_calls == 2


# ---------------- token sai ----------------

def test_sai_chu_ky_401():
    assert_401(post(make_sb_app(), es256(key=EC_OTHER)))


@pytest.mark.parametrize("exp_delta", [-3600, -60])
def test_het_han_401(exp_delta):
    assert_401(post(make_sb_app(), es256(claims(exp=int(time.time()) + exp_delta))))


def test_het_han_trong_leeway_30_giay_van_qua():
    assert post(make_sb_app(), es256(claims(exp=int(time.time()) - 10))).status_code == 200


def test_thieu_header_401_khong_goi_supabase():
    fake = FakeSupabase()
    r = post(make_sb_app(fake))
    assert_401(r)
    assert (fake.jwks_calls, fake.user_calls) == (0, 0)


@pytest.mark.parametrize("raw", ["Basic dXNlcjpwYXNz", "Bearer", "Bearer ", "Token abc.def.ghi", "abc.def.ghi",
                                 "Bearer abc", "Bearer a.b", "Bearer a.b.c.d", "Bearer a..c", "Bearer a.b.c d"])
def test_header_sai_dang_401(raw):
    fake = FakeSupabase()
    assert_401(post(make_sb_app(fake), raw_auth=raw))
    assert (fake.jwks_calls, fake.user_calls) == (0, 0)


def test_token_2_phan_401():
    parts = es256().split(".")
    assert_401(post(make_sb_app(), parts[0] + "." + parts[1]))


def test_header_qua_dai_401_khong_goi_supabase():
    fake = FakeSupabase()
    long_token = es256(claims(pad="x" * 5000))
    assert len(long_token) > 4096
    assert_401(post(make_sb_app(fake), long_token))
    assert (fake.jwks_calls, fake.user_calls) == (0, 0)


@pytest.mark.parametrize("alg", ["none", "None", "HS384", "HS512", "PS256", "ES384", "EdDSA", "RS512", "la-lung"])
def test_alg_khong_nhan_401_khong_goi_supabase(alg):
    fake = FakeSupabase()
    tok = hand_token({"alg": alg, "typ": "JWT", "kid": "ec-1"}, claims())
    assert_401(post(make_sb_app(fake), tok))
    assert (fake.jwks_calls, fake.user_calls) == (0, 0)


def test_alg_none_chu_ky_rong_401():
    tok = hand_token({"alg": "none", "typ": "JWT"}, claims(), sig=b"")
    assert tok.endswith(".")
    assert_401(post(make_sb_app(), tok))


def test_es256_thieu_kid_401():
    tok = jwt.encode(claims(), EC_PRIV, algorithm="ES256")
    assert_401(post(make_sb_app(), tok))


def test_hs256_ky_bang_khoa_cong_khai_khong_duoc_200():
    """Tấn công nhầm thuật toán: HS256 với 'bí mật' = khóa công khai PEM. Không bao giờ đi đường JWKS."""
    pem = EC_PRIV.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    fake = FakeSupabase(user=(401, None))  # Supabase thật sẽ từ chối token giả
    tok = hand_token({"alg": "HS256", "typ": "JWT", "kid": "ec-1"}, claims(), secret=pem)
    r = post(make_sb_app(fake), tok)
    assert r.status_code != 200
    assert_401(r)
    assert fake.jwks_calls == 0 and fake.user_calls == 1


def test_es256_ky_nhung_jwk_la_rs256_401():
    """Token ES256 nhưng kid trỏ tới khóa RSA: thuật toán theo khóa phải trùng alg của token."""
    tok = es256(kid="rsa-1")
    assert_401(post(make_sb_app(), tok))


def test_jwk_oct_khong_bao_gio_duoc_dung():
    secret = b"khoa-doi-xung-trong-jwks"
    jwks = {"keys": [{"kty": "oct", "kid": "oct-1", "k": b64(secret)}, *JWKS["keys"]]}
    fake = FakeSupabase(jwks=(200, jwks))
    tok = hand_token({"alg": "ES256", "typ": "JWT", "kid": "oct-1"}, claims(), secret=secret)
    assert_401(post(make_sb_app(fake), tok))
    # bắt lỗi thật: khóa oct không bao giờ lọt vào bảng khóa (token ES256 ở trên 401 cả khi oct lọt, vì alg không trùng)
    keys = auth.parse_jwks(jwks)
    assert "oct-1" not in keys
    assert set(keys) == {"ec-1", "rsa-1"}
    assert "oct-1" not in auth.parse_jwks({"keys": [{"kty": "oct", "kid": "oct-1", "k": b64(secret), "alg": "HS256"}]})


@pytest.mark.parametrize("bad", [
    {"iss": "https://khac.supabase.co/auth/v1"},
    {"iss": SB_URL},
    {"iss": DROP},
    {"aud": "anon"},
    {"aud": DROP},
    {"sub": DROP},
    {"sub": ""},
    {"exp": DROP},
    {"is_anonymous": True},
], ids=["iss-khac", "iss-thieu-auth-v1", "iss-thieu", "aud-anon", "aud-thieu", "sub-thieu", "sub-rong", "exp-thieu",
        "an-danh"])
def test_claim_sai_401(bad):
    assert_401(post(make_sb_app(), es256(claims(**bad))))


# ---------------- JWKS: kid lạ, lỗi mạng ----------------

def test_kid_la_tai_lai_1_lan_roi_401_lan_2_trong_60_giay_khong_tai_lai():
    clk = Clock()
    fake = FakeSupabase()
    app = make_sb_app(fake, clk)
    assert post(app, es256()).status_code == 200
    assert fake.jwks_calls == 1
    assert_401(post(app, es256(kid="kid-la")))
    assert fake.jwks_calls == 2  # tải lại đúng 1 lần
    clk.t += 30
    assert_401(post(app, es256(kid="kid-la-2")))
    assert fake.jwks_calls == 2  # trong 60 giây: không tải lại
    clk.t += 31
    assert_401(post(app, es256(kid="kid-la-3")))
    assert fake.jwks_calls == 3  # qua 60 giây: được tải lại 1 lần nữa


def test_doi_khoa_kid_moi_tai_lai_roi_qua():
    clk = Clock()
    fake = FakeSupabase()
    app = make_sb_app(fake, clk)
    assert post(app, es256()).status_code == 200
    fake.jwks = (200, {"keys": [*JWKS["keys"], jwk_of(EC_OTHER.public_key(), "ec-2", "ES256")]})
    assert post(app, es256(kid="ec-2", key=EC_OTHER)).status_code == 200
    assert fake.jwks_calls == 2


def test_nhieu_yeu_cau_cung_luc_kid_la_chi_tai_1_lan():
    clk = Clock()
    fake = FakeSupabase()
    v = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=fake.fetch_jwks, fetch_user=fake.fetch_user, clock=clk.mono, wall=clk.wall)
    v.verify(es256())
    gate = threading.Event()
    real = fake.fetch_jwks

    def slow(url):
        gate.wait(5)
        return real(url)

    v._fetch_jwks = slow
    errs = []

    def worker():
        try:
            v.verify(es256(kid="kid-la"))
        except auth.AuthError as e:
            errs.append(e.status)

    ts = [threading.Thread(target=worker) for _ in range(8)]
    for t in ts:
        t.start()
    time.sleep(0.2)
    gate.set()
    for t in ts:
        t.join(10)
    assert errs == [401] * 8
    assert fake.jwks_calls == 2


@pytest.mark.parametrize("fail", [OSError("mat mang"), TimeoutError("het gio"), UPSTREAM("loi"),
                                  (500, None), (502, {"x": 1}), (200, None), (200, {"keys": "khong-phai-list"}),
                                  (200, ["mang"]), (404, None)],
                         ids=["oserror", "timeout", "upstream", "500", "502", "json-hong", "keys-sai", "khong-phai-object", "404"])
def test_jwks_loi_503_khong_cho_qua(fail):
    r = post(make_sb_app(FakeSupabase(jwks=fail)), es256())
    assert r.status_code == 503, r.text
    assert int(r.headers["retry-after"]) > 0
    assert "error" in r.json()


# ---------------- đường /auth/v1/user (HS256) ----------------

def test_user_200_qua_va_goi_dung_url_header():
    fake = FakeSupabase()
    tok = hs256()
    assert post(make_sb_app(fake), tok).status_code == 200
    assert fake.urls == [SB_URL + "/auth/v1/user"]
    assert fake.user_args == [(PUB_KEY, tok)]
    assert fake.jwks_calls == 0


@pytest.mark.parametrize("user, code", [
    ((401, None), 401), ((403, {"msg": "bad_jwt"}), 401),
    ((500, None), 503), ((502, None), 503), ((429, None), 503), ((404, None), 503),
    (TimeoutError("het gio"), 503), (OSError("mat mang"), 503), (UPSTREAM("loi"), 503),
    ((200, None), 503), ((200, {"email": EMAIL}), 503), ((200, {"id": ""}), 503),
    ((200, {"id": SUB, "is_anonymous": True}), 401),
], ids=["401", "403", "500", "502", "429", "404", "timeout", "oserror", "upstream", "json-hong", "thieu-id", "id-rong", "an-danh"])
def test_user_ket_qua_doi_ra_ma_dung(user, code):
    r = post(make_sb_app(FakeSupabase(user=user)), hs256())
    assert r.status_code == code, r.text
    if code == 401:
        assert_401(r)
    else:
        assert int(r.headers["retry-after"]) > 0


def test_user_id_lay_tu_phan_hoi_khong_tu_than_token():
    fake = FakeSupabase(user=(200, {"id": SUB_2}))
    app = make_sb_app(fake)
    assert post(app, hs256(claims(sub="sub-trong-token-khong-tin"))).status_code == 200
    assert list(app.state.user_limiter._hits) == [SUB_2]


def test_user_luu_tam_60_giay():
    clk = Clock()
    fake = FakeSupabase()
    app = make_sb_app(fake, clk)
    tok = hs256()
    assert post(app, tok).status_code == 200
    clk.t += 59
    assert post(app, tok).status_code == 200
    assert fake.user_calls == 1
    clk.t += 2
    assert post(app, tok).status_code == 200
    assert fake.user_calls == 2


def test_user_luu_tam_khong_qua_exp_cua_token():
    clk = Clock()
    fake = FakeSupabase()
    app = make_sb_app(fake, clk)
    tok = hs256(claims(exp=int(clk.wall()) + 20))
    assert post(app, tok).status_code == 200
    clk.t += 10
    assert post(app, tok).status_code == 200
    assert fake.user_calls == 1
    clk.t += 15  # quá exp: hết lưu tạm, hỏi lại Supabase
    post(app, tok)
    assert fake.user_calls == 2


def test_user_ket_qua_sai_khong_luu():
    clk = Clock()
    fake = FakeSupabase(user=(401, None))
    app = make_sb_app(fake, clk)
    tok = hs256()
    assert_401(post(app, tok))
    assert_401(post(app, tok))
    assert fake.user_calls == 2
    fake.user = (500, None)
    assert post(app, tok).status_code == 503
    fake.user = (200, {"id": SUB})
    assert post(app, tok).status_code == 200
    assert post(app, tok).status_code == 200
    assert fake.user_calls == 4


def test_user_luu_tam_tran_1000_muc():
    clk = Clock()
    fake = FakeSupabase()
    v = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=fake.fetch_jwks, fetch_user=fake.fetch_user, clock=clk.mono, wall=clk.wall)
    for i in range(1200):
        v.verify(hs256(claims(jti=str(i))))
    assert len(v._user_cache) == 1000
    assert fake.user_calls == 1200


# ---------------- thứ tự kiểm + giới hạn lượt ----------------

def test_ip_bi_gioi_han_thi_khong_kiem_token():
    fake = FakeSupabase()
    app = make_sb_app(fake, rate_limit_per_min=1)
    assert post(app, hs256()).status_code == 200
    assert fake.user_calls == 1
    r = post(app, hs256(claims(jti="khac")))
    assert r.status_code == 429
    assert fake.user_calls == 1  # không gọi kiểm token
    r = post(app)  # thiếu token mà IP đã hết lượt: vẫn 429 trước
    assert r.status_code == 429


def test_gioi_han_user_429_doc_lap_voi_ip():
    app = make_sb_app(rate_limit_user_per_min=2)
    codes = [post(app, es256(), ip=f"203.0.113.{i}").status_code for i in (1, 2, 3)]
    assert codes == [200, 200, 429]
    r = post(app, es256(), ip="203.0.113.9")
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) > 0
    assert "tài khoản" in r.json()["error"].lower()
    # người khác từ cùng IP vẫn qua
    assert post(app, rs256(claims(sub=SUB_2)), ip="203.0.113.1").status_code == 200


def test_token_sai_khong_tinh_luot_user():
    app = make_sb_app(rate_limit_user_per_min=1)
    assert_401(post(app, es256(key=EC_OTHER), ip="203.0.113.1"))
    assert post(app, es256(), ip="203.0.113.2").status_code == 200


def test_auth_off_khong_doc_token():
    import app as app_module

    a = app_module.create_app(make_settings(auth_mode="off"), engine=FakeEngine())
    assert post(a).status_code == 200
    assert post(a, raw_auth="Bearer rac.rac.rac").status_code == 200


class _BoomVerifier:
    """Bộ kiểm ném lỗi lạ (không phải AuthError), câu lỗi có cả token: log không được chép câu này."""

    def __init__(self):
        self.calls = 0

    def verify(self, token):
        self.calls += 1
        raise ValueError("loi la khi kiem " + token + " " + EMAIL)


def test_loi_la_khi_kiem_token_500_co_cors_log_khong_co_token(caplog):
    import app as app_module

    caplog.set_level(logging.DEBUG)
    boom = _BoomVerifier()
    s = make_settings(auth_mode="supabase", supabase_url=SB_URL, supabase_publishable_key=PUB_KEY)
    a = app_module.create_app(s, engine=FakeEngine(), verifier=boom)
    tok = es256()
    origin = "https://khangnguyen196.github.io"
    r = post(a, tok, origin=origin)
    assert boom.calls == 1
    assert r.status_code == 500, r.text
    assert r.json() == {"error": "Lỗi khi kiểm đăng nhập trên máy chủ."}
    assert r.headers.get("access-control-allow-origin") == origin
    assert "ValueError" in caplog.text
    for secret in (tok, EMAIL, SUB, "loi la khi kiem"):
        assert secret not in caplog.text
        assert secret not in r.text


# ---------------- log ----------------

def test_log_khong_co_token_sub_email(caplog):
    caplog.set_level(logging.DEBUG)
    fake = FakeSupabase()
    app = make_sb_app(fake)
    toks = [es256(), es256(key=EC_OTHER), rs256(), hs256(), es256(kid="kid-la"), "rac.rac.rac"]
    for t in toks:
        post(app, t)
    fake.user = OSError("mat mang " + EMAIL)
    post(app, hs256(claims(jti="x")))
    fake.jwks = TimeoutError("het gio")
    app2 = make_sb_app(fake)
    post(app2, es256())
    text = caplog.text
    assert text  # có log
    for secret in [*toks, SUB, EMAIL, PUB_KEY]:
        assert secret not in text


def test_khoi_dong_tai_jwks_1_lan_log_so_khoa_khong_url(caplog):
    caplog.set_level(logging.INFO)
    fake = FakeSupabase()
    with TestClient(make_sb_app(fake)) as c:
        assert c.get("/health").status_code == 200
    assert fake.jwks_calls == 1
    lines = [r.getMessage() for r in caplog.records if "JWKS" in r.getMessage()]
    assert lines == ["JWKS: 2 khóa (ES256, RS256)"]
    assert SB_URL not in caplog.text and "supabase.co" not in caplog.text


def test_khoi_dong_tai_jwks_loi_van_chay_yeu_cau_sau_503(caplog):
    caplog.set_level(logging.INFO)
    fake = FakeSupabase(jwks=OSError("mat mang"))
    app = make_sb_app(fake)
    with TestClient(app) as c:
        assert c.get("/health").status_code == 200
    assert any("JWKS" in r.getMessage() for r in caplog.records)
    assert post(app, es256()).status_code == 503


# ---------------- cấu hình ----------------

def test_settings_mac_dinh_moi():
    s = load_settings({})
    assert (s.supabase_url, s.supabase_publishable_key, s.rate_limit_user_per_min, s.rate_limit_max_users) == ("", "", 10, 10_000)
    assert load_settings({"RATE_LIMIT_USER_PER_MIN": "3"}).rate_limit_user_per_min == 3
    for bad in ("0", "-1", "abc"):
        with pytest.raises(SettingsError):
            load_settings({"RATE_LIMIT_USER_PER_MIN": bad})
    with pytest.raises(SettingsError):
        load_settings({"RATE_LIMIT_MAX_USERS": "0"})


@pytest.mark.parametrize("env, names", [
    ({}, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]),
    ({"SUPABASE_URL": SB_URL}, ["SUPABASE_PUBLISHABLE_KEY"]),
    ({"SUPABASE_PUBLISHABLE_KEY": PUB_KEY}, ["SUPABASE_URL"]),
    ({"SUPABASE_URL": "  ", "SUPABASE_PUBLISHABLE_KEY": PUB_KEY}, ["SUPABASE_URL"]),
    ({"SUPABASE_URL": "http://duanthu-abcdefgh.supabase.co", "SUPABASE_PUBLISHABLE_KEY": PUB_KEY}, ["SUPABASE_URL", "https://"]),
    ({"SUPABASE_URL": "duanthu-abcdefgh.supabase.co", "SUPABASE_PUBLISHABLE_KEY": PUB_KEY}, ["SUPABASE_URL", "https://"]),
    ({"SUPABASE_URL": "https://", "SUPABASE_PUBLISHABLE_KEY": PUB_KEY}, ["SUPABASE_URL"]),
], ids=["thieu-ca-2", "thieu-key", "thieu-url", "url-trang", "url-http", "url-khong-scheme", "url-khong-host"])
def test_supabase_thieu_bien_khong_khoi_dong_cau_loi_khong_co_gia_tri(env, names):
    import app as app_module

    full = {"AUTH_MODE": "supabase", **env}
    with pytest.raises(SettingsError) as e:
        load_settings(full)
    msg = str(e.value)
    for n in names:
        assert n in msg
    for value in env.values():
        if value.strip() and value.strip() != "https://":
            assert value.strip() not in msg
    assert "duanthu-abcdefgh" not in msg and PUB_KEY not in msg
    # bỏ qua load_settings (Settings dựng tay) -> create_app vẫn từ chối
    s = make_settings(auth_mode="supabase", supabase_url=env.get("SUPABASE_URL", ""),
                      supabase_publishable_key=env.get("SUPABASE_PUBLISHABLE_KEY", ""))
    with pytest.raises(auth.AuthConfigError) as e2:
        app_module.create_app(s, engine=FakeEngine())
    assert "duanthu-abcdefgh" not in str(e2.value) and PUB_KEY not in str(e2.value)


def test_supabase_du_bien_khoi_dong_duoc_url_bo_gach_cuoi():
    s = load_settings({"AUTH_MODE": "supabase", "SUPABASE_URL": SB_URL + "/", "SUPABASE_PUBLISHABLE_KEY": PUB_KEY})
    assert s.supabase_url == SB_URL and s.supabase_publishable_key == PUB_KEY
    v = auth.SupabaseVerifier(s.supabase_url + "/", PUB_KEY)
    assert v.issuer == ISS
    assert v.jwks_url == SB_URL + "/auth/v1/.well-known/jwks.json"
    assert v.user_url == SB_URL + "/auth/v1/user"


SECRET_KEYS = [
    "sb_secret_KHOA-BI-MAT-GIA-cua-test",
    "  sb_secret_co-khoang-trang  ",
    hand_token({"alg": "HS256", "typ": "JWT"}, {"iss": "supabase", "ref": "duanthu-abcdefgh", "role": "service_role"}),
]


@pytest.mark.parametrize("key", SECRET_KEYS, ids=["sb-secret", "sb-secret-khoang-trang", "jwt-service-role"])
def test_supabase_nham_khoa_bi_mat_khong_khoi_dong_cau_loi_khong_co_gia_tri(key):
    import app as app_module

    with pytest.raises(SettingsError) as e:
        load_settings({"AUTH_MODE": "supabase", "SUPABASE_URL": SB_URL, "SUPABASE_PUBLISHABLE_KEY": key})
    msg = str(e.value)
    assert "SUPABASE_PUBLISHABLE_KEY" in msg
    assert key.strip() not in msg and "sb_secret_KHOA" not in msg and "duanthu-abcdefgh" not in msg
    # bỏ qua load_settings (Settings dựng tay) -> create_app vẫn từ chối
    s = make_settings(auth_mode="supabase", supabase_url=SB_URL, supabase_publishable_key=key)
    with pytest.raises(auth.AuthConfigError) as e2:
        app_module.create_app(s, engine=FakeEngine())
    assert key.strip() not in str(e2.value)


@pytest.mark.parametrize("key", [
    PUB_KEY,
    hand_token({"alg": "HS256", "typ": "JWT"}, {"iss": "supabase", "ref": "duanthu-abcdefgh", "role": "anon"}),
    "a.b.c",  # 3 phần nhưng không giải được: không coi là JWT
    "sb_secretX",  # không đúng tiền tố "sb_secret_"
], ids=["publishable", "jwt-anon-cu", "3-phan-hong", "gan-giong-tien-to"])
def test_supabase_khoa_cong_khai_van_khoi_dong(key):
    s = load_settings({"AUTH_MODE": "supabase", "SUPABASE_URL": SB_URL, "SUPABASE_PUBLISHABLE_KEY": key})
    assert s.supabase_publishable_key == key


def test_settings_khong_doc_jwt_secret_hay_service_role():
    import inspect

    import settings as settings_module

    import re

    src = inspect.getsource(settings_module) + inspect.getsource(auth)
    names = re.findall(r'\(\s*env\s*,\s*"([A-Z_]+)"|env\.get\(\s*"([A-Z_]+)"', src)
    read = {a or b for a, b in names}
    assert "SUPABASE_URL" in read and "SUPABASE_PUBLISHABLE_KEY" in read
    assert not [n for n in read if "SECRET" in n or "SERVICE" in n or "JWT" in n], read
    assert "os.environ" not in inspect.getsource(auth) and "getenv" not in inspect.getsource(auth)


# ---------------- urllib thật với http.server cục bộ ----------------

REDIRECT_TARGET = "/jwks-chuyen-huong.json"


class _Handler(http.server.BaseHTTPRequestHandler):
    delay = 0.0
    seen = []
    jwks_mode = "ok"  # ok | redirect (302 tới JWKS hợp lệ ở đường khác) | big (JWKS hợp lệ nhưng > 64 KB)

    def do_GET(self):  # noqa: N802
        type(self).seen.append((self.path, self.headers.get("apikey"), self.headers.get("authorization")))
        if self.delay:
            time.sleep(self.delay)
        if self.path == "/auth/v1/.well-known/jwks.json" and self.jwks_mode == "redirect":
            self.send_response(302)
            self.send_header("Location", REDIRECT_TARGET)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/auth/v1/.well-known/jwks.json" and self.jwks_mode == "big":
            body = json.dumps({**JWKS, "dem": "x" * (auth.JWKS_MAX_BYTES + 1024)}).encode()
        elif self.path in ("/auth/v1/.well-known/jwks.json", REDIRECT_TARGET):
            body = json.dumps(JWKS).encode()
        elif self.path == "/auth/v1/user":
            body = json.dumps({"id": SUB}).encode()
        else:
            self.send_response(404)
            self.end_headers()
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *a):
        pass


def _local_server(delay=0.0, jwks_mode="ok"):
    handler = type("H", (_Handler,), {"delay": delay, "seen": [], "jwks_mode": jwks_mode})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, handler


def test_urllib_that_tai_jwks_va_goi_user_qua_http_server_cuc_bo():
    srv, handler = _local_server()
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        v = auth.SupabaseVerifier(base, PUB_KEY)  # hàm tải mặc định (urllib)
        tok = es256(claims(iss=base + "/auth/v1"))
        assert v.verify(tok) == SUB
        assert v.warm_up() == ["ES256", "RS256"]
        tok_hs = hs256()
        assert v.verify(tok_hs) == SUB
    finally:
        srv.shutdown()
        srv.server_close()
    paths = [p for p, _, _ in handler.seen]
    assert paths == ["/auth/v1/.well-known/jwks.json", "/auth/v1/.well-known/jwks.json", "/auth/v1/user"]
    assert handler.seen[2][1] == PUB_KEY and handler.seen[2][2] == "Bearer " + tok_hs


def test_urllib_that_het_gio_503():
    srv, _ = _local_server(delay=2.0)
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        v = auth.SupabaseVerifier(base, PUB_KEY, timeout=0.3)
        t0 = time.perf_counter()
        with pytest.raises(auth.AuthError) as e:
            v.verify(es256(claims(iss=base + "/auth/v1")))
        assert e.value.status == 503
        with pytest.raises(auth.AuthError) as e2:
            v.verify(hs256())
        assert e2.value.status == 503
        assert time.perf_counter() - t0 < 1.9
    finally:
        srv.shutdown()
        srv.server_close()


def test_urllib_that_jwks_chuyen_huong_302_khong_theo_503():
    """JWKS trả 302 tới một JWKS hợp lệ ở đường khác: KHÔNG đi theo (chỉ nói chuyện với đúng địa chỉ đã cấu hình)."""
    srv, handler = _local_server(jwks_mode="redirect")
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        v = auth.SupabaseVerifier(base, PUB_KEY)
        with pytest.raises(UPSTREAM):
            v.warm_up()
        v2 = auth.SupabaseVerifier(base, PUB_KEY)
        with pytest.raises(auth.AuthError) as e:
            v2.verify(es256(claims(iss=base + "/auth/v1")))
        assert e.value.status == 503
    finally:
        srv.shutdown()
        srv.server_close()
    paths = [p for p, _, _ in handler.seen]
    assert REDIRECT_TARGET not in paths
    assert paths == ["/auth/v1/.well-known/jwks.json", "/auth/v1/.well-known/jwks.json"]


def test_urllib_that_jwks_qua_64_kb_503():
    """JWKS hợp lệ nhưng thân > 64 KB: dừng đọc, coi như lỗi (không phân tích phần đã đọc)."""
    srv, handler = _local_server(jwks_mode="big")
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        with pytest.raises(UPSTREAM):
            auth.default_fetch_jwks(base + "/auth/v1/.well-known/jwks.json")
        v = auth.SupabaseVerifier(base, PUB_KEY)
        with pytest.raises(UPSTREAM):
            v.warm_up()
        v2 = auth.SupabaseVerifier(base, PUB_KEY)
        with pytest.raises(auth.AuthError) as e:
            v2.verify(es256(claims(iss=base + "/auth/v1")))
        assert e.value.status == 503
    finally:
        srv.shutdown()
        srv.server_close()
    assert len(handler.seen) == 3
