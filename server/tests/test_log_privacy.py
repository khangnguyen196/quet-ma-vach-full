"""Log không chứa token, email, header Authorization ("Bearer"), tên file, chữ OCR (đợt may-chu-2), qua đủ các
đường 200 / 401 / 429 / 503 / 500 với AUTH_MODE=supabase. Token giả có email giả trong payload."""
from __future__ import annotations

import asyncio
import logging

import httpx

import app as app_module
from conftest import FAKE_TEXT, ORIGIN, FakeEngine, jpeg_bytes, make_settings, multipart
from test_auth import EC_OTHER, EMAIL, PUB_KEY, SB_URL, SUB, FakeSupabase, claims, es256, hs256, make_sb_app

FILENAME = "anh-rieng-tu-cua-nguoi-dung.jpg"


async def _apost(app, token, ip="198.51.100.21"):
    body, ctype = multipart([("image", FILENAME, jpeg_bytes())])
    transport = httpx.ASGITransport(app=app, client=(ip, 40000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        return await c.post("/ocr", content=body, headers={"content-type": ctype, "authorization": "Bearer " + token,
                                                           "origin": ORIGIN})


def post(app, token, **kw):
    return asyncio.run(_apost(app, token, **kw))


class _BrokenEngine(FakeEngine):
    """Engine ném lỗi lạ có cả token + email trong câu lỗi: log chỉ được ghi tên lỗi."""

    def __init__(self, token):
        super().__init__()
        self.token = token

    def run(self, img):
        raise RuntimeError("hong " + self.token + " " + EMAIL)


class _BoomVerifier:
    def __init__(self):
        self.calls = 0

    def verify(self, token):
        self.calls += 1
        raise ValueError("Bearer " + token + " " + EMAIL)


def test_log_khong_co_token_email_bearer_qua_moi_duong(caplog):
    caplog.set_level(logging.DEBUG)
    tok = es256(claims(email=EMAIL))
    toks = [tok]
    codes = []

    # 200 + 429 (giới hạn ngày) + 429 (giới hạn phút theo người)
    app = make_sb_app(daily_limit_per_user=1, rate_limit_per_min=100)
    codes.append(post(app, tok).status_code)
    codes.append(post(app, tok).status_code)
    app2 = make_sb_app(rate_limit_user_per_min=1, rate_limit_per_min=100)
    codes.append(post(app2, tok).status_code)
    codes.append(post(app2, tok).status_code)
    # 401: chữ ký sai
    bad = es256(claims(email=EMAIL), key=EC_OTHER)
    toks.append(bad)
    codes.append(post(app2, bad).status_code)
    # 503: JWKS lỗi mạng (câu lỗi có email), /user lỗi mạng
    fake = FakeSupabase(jwks=OSError("mat mang " + EMAIL), user=OSError("mat mang " + EMAIL))
    app3 = make_sb_app(fake)
    codes.append(post(app3, tok).status_code)
    hs = hs256(claims(email=EMAIL, jti="hs"))
    toks.append(hs)
    codes.append(post(app3, hs).status_code)
    # 503: model chưa nạp
    eng = FakeEngine()
    eng.loaded = False
    s = make_settings(auth_mode="supabase", supabase_url=SB_URL, supabase_publishable_key=PUB_KEY)
    import auth

    v = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=FakeSupabase().fetch_jwks, fetch_user=FakeSupabase().fetch_user)
    codes.append(post(app_module.create_app(s, engine=eng, verifier=v), tok).status_code)
    # 500: engine ném lỗi lạ; bộ kiểm token ném lỗi lạ
    v2 = auth.SupabaseVerifier(SB_URL, PUB_KEY, fetch_jwks=FakeSupabase().fetch_jwks, fetch_user=FakeSupabase().fetch_user)
    codes.append(post(app_module.create_app(s, engine=_BrokenEngine(tok), verifier=v2), tok).status_code)
    boom = _BoomVerifier()
    codes.append(post(app_module.create_app(s, engine=FakeEngine(), verifier=boom), tok).status_code)

    assert codes == [200, 429, 200, 429, 401, 503, 503, 503, 500, 500]
    text = caplog.text
    assert "/ocr 200" in text and "/ocr 500" in text and "RuntimeError" in text and "ValueError" in text
    for secret in [*toks, EMAIL, SUB, PUB_KEY, "Bearer", "bearer", "authorization", "Authorization", FILENAME, FAKE_TEXT,
                   "198.51.100.21", "mat mang", "hong "]:
        assert secret not in text, f"log có {secret[:20]!r}"
    assert not any(rec.exc_info for rec in caplog.records)
