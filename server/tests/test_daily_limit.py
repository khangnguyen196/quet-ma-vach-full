"""Giới hạn số ảnh mỗi người mỗi NGÀY UTC (DAILY_LIMIT_PER_USER, đợt may-chu-2): trong RAM, theo user id, chỉ khi
AUTH_MODE=supabase, cộng thêm với giới hạn phút theo IP + theo người. Đồng hồ giả để thử qua ngày."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from conftest import ORIGIN, FakeEngine, jpeg_bytes, make_settings, multipart
from settings import SettingsError, load_settings
from test_auth import SUB, SUB_2, claims, es256, make_sb_app

import ratelimit

DAY = 86400
# 2026-11-13 23:59:00 UTC (giờ thật dạng epoch, để chắc đổi ngày đúng lúc 00:00 UTC)
T_2359 = 1794614340.0


class WallClock:
    def __init__(self, t=T_2359 - 3600):
        self.t = t

    def __call__(self):
        return self.t


def test_settings_mac_dinh_200_va_0_la_tat():
    assert load_settings({}).daily_limit_per_user == 200
    assert load_settings({"DAILY_LIMIT_PER_USER": "0"}).daily_limit_per_user == 0
    assert load_settings({"DAILY_LIMIT_PER_USER": " 15 "}).daily_limit_per_user == 15
    for bad in ("-1", "abc", "1.5"):
        with pytest.raises(SettingsError):
            load_settings({"DAILY_LIMIT_PER_USER": bad})


def test_daily_limiter_qua_ngay_utc_va_retry_after_toi_0h():
    clk = WallClock(T_2359)
    lim = ratelimit.DailyLimiter(2, max_users=10, clock=clk)
    assert lim.check("u1") == (True, 0)
    assert lim.check("u1") == (True, 0)
    ok, retry = lim.check("u1")
    assert not ok and retry == 60  # 23:59:00 -> 00:00:00 UTC
    assert lim.check("u2") == (True, 0)  # người khác không ảnh hưởng
    clk.t += 59.5
    ok, retry = lim.check("u1")
    assert not ok and retry == 1  # còn 0,5 giây: làm tròn lên, tối thiểu 1
    clk.t += 0.5  # đúng 00:00:00 UTC ngày mới
    assert lim.check("u1") == (True, 0)
    assert lim.check("u1") == (True, 0)
    assert lim.check("u1")[0] is False


def test_daily_limiter_0_la_tat_khong_giu_gi():
    lim = ratelimit.DailyLimiter(0, max_users=10, clock=WallClock())
    for _ in range(500):
        assert lim.check("u1") == (True, 0)
    assert len(lim) == 0


def test_daily_limiter_tran_so_nguoi_bo_nguoi_it_dung_gan_nhat():
    clk = WallClock()
    lim = ratelimit.DailyLimiter(5, max_users=3, clock=clk)
    for u in ("a", "b", "c"):
        lim.check(u)
    lim.check("a")  # a vừa dùng -> b là người ít dùng gần nhất
    lim.check("d")
    assert len(lim) == 3
    assert set(lim._users) == {"a", "c", "d"}
    clk.t += DAY  # sang ngày khác: đầy thì dọn hết người của ngày cũ trước
    lim.check("e")
    assert set(lim._users) == {"e"}


# ---------------- qua app (AUTH_MODE=supabase) ----------------

async def _many(app, token, n, ip="198.51.100.7", origin=None):
    body, ctype = multipart([("image", "anh.jpg", jpeg_bytes())])
    headers = {"content-type": ctype, "authorization": "Bearer " + token}
    if origin:
        headers["origin"] = origin
    transport = httpx.ASGITransport(app=app, client=(ip, 40000))
    out = []
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        for _ in range(n):
            out.append(await c.post("/ocr", content=body, headers=headers))
    return out


def many(app, token, n, **kw):
    return asyncio.run(_many(app, token, n, **kw))


NO_MINUTE_LIMIT = {"rate_limit_per_min": 100_000, "rate_limit_user_per_min": 100_000}


def test_luot_201_bi_429_retry_after_toi_0h_utc_co_cors():
    app = make_sb_app(**NO_MINUTE_LIMIT)
    assert app.state.settings.daily_limit_per_user == 200
    app.state.daily_limiter.clock = WallClock(T_2359 - 3600)  # 22:59:00 UTC
    rs = many(app, es256(), 201, origin=ORIGIN)
    assert [r.status_code for r in rs[:200]] == [200] * 200
    r = rs[200]
    assert r.status_code == 429
    assert r.headers["retry-after"] == str(3600 + 60)
    assert r.headers.get("access-control-allow-origin") == ORIGIN
    msg = r.json()["error"]
    assert "200" in msg and "hôm nay" in msg and "UTC" in msg
    # người khác vẫn qua
    assert many(app, es256(claims(sub=SUB_2)), 1)[0].status_code == 200


def test_sang_ngay_utc_moi_thi_qua_lai():
    app = make_sb_app(daily_limit_per_user=3, **NO_MINUTE_LIMIT)
    clk = WallClock(T_2359)
    app.state.daily_limiter.clock = clk
    assert [r.status_code for r in many(app, es256(), 4)] == [200, 200, 200, 429]
    clk.t += 60  # 00:00:00 UTC ngày mới
    assert [r.status_code for r in many(app, es256(), 4)] == [200, 200, 200, 429]


def test_0_la_tat():
    app = make_sb_app(daily_limit_per_user=0, **NO_MINUTE_LIMIT)
    assert all(r.status_code == 200 for r in many(app, es256(), 30))


def test_auth_off_khong_dem():
    import app as app_module

    app = app_module.create_app(make_settings(daily_limit_per_user=2, rate_limit_per_min=100_000), engine=FakeEngine())
    assert all(r.status_code == 200 for r in many(app, "rac.rac.rac", 10))
    assert len(app.state.daily_limiter) == 0


def test_cong_them_voi_gioi_han_phut():
    """Giới hạn phút theo người vẫn chạy trước; lượt bị 429 vì phút không trừ vào lượt ngày."""
    app = make_sb_app(daily_limit_per_user=3, rate_limit_user_per_min=2, rate_limit_per_min=100_000)
    app.state.daily_limiter.clock = WallClock()
    rs = many(app, es256(), 3)
    assert [r.status_code for r in rs] == [200, 200, 429]
    assert "mỗi phút" in rs[2].json()["error"]
    assert app.state.daily_limiter._users[SUB][1] == 2
