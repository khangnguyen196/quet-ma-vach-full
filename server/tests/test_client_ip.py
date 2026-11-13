"""IP khách lấy từ X-Forwarded-For (TRUST_PROXY=1): bỏ phần ":cổng", sai dạng thì dùng IP socket (đợt may-chu-2 vòng 2).

Proxy có thể ghi "1.2.3.4:51234": nếu giữ nguyên thì mỗi yêu cầu (cổng nguồn khác) thành một "IP" mới, giới hạn lượt
theo IP mất tác dụng."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest

from conftest import jpeg_bytes, multipart
from ratelimit import client_ip

SOCK = "10.9.9.9"


def _req(xff: str | None, sock: str = SOCK):
    headers = {} if xff is None else {"x-forwarded-for": xff}
    return SimpleNamespace(client=SimpleNamespace(host=sock), headers=headers)


@pytest.mark.parametrize("xff, expected", [
    ("1.2.3.4:51234", "1.2.3.4"),
    ("[2001:db8::1]:443", "2001:db8::1"),
    ("[2001:db8::1]", "2001:db8::1"),
    ("2001:db8::1", "2001:db8::1"),  # IPv6 trần: không cắt sau dấu ":" cuối
    ("1.2.3.4", "1.2.3.4"),
    ("9.9.9.9, 1.2.3.4:51234", "1.2.3.4"),  # vẫn lấy phần tử phải nhất, chỉ bỏ cổng
])
def test_bo_cong_giu_ip(xff, expected):
    assert client_ip(_req(xff), trust_proxy=True, proxy_count=1) == expected


@pytest.mark.parametrize("xff", ["rac", "unknown", "1.2.3.4:abc", "[2001:db8::1", "999.1.1.1", "1.2.3.4:51234:9"])
def test_sai_dang_dung_ip_socket(xff):
    assert client_ip(_req(xff), trust_proxy=True, proxy_count=1) == SOCK


def test_proxy_count_2_chuan_hoa_phan_tu_duoc_chon():
    assert client_ip(_req("8.8.8.8, 1.2.3.4:5000, 10.0.0.1"), trust_proxy=True, proxy_count=2) == "1.2.3.4"


def test_trust_proxy_tat_bo_qua_header():
    assert client_ip(_req("1.2.3.4:51234"), trust_proxy=False) == SOCK


async def _apost(app, xff):
    body, ctype = multipart([("image", "a.jpg", jpeg_bytes())])
    transport = httpx.ASGITransport(app=app, client=(SOCK, 40000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/ocr", content=body, headers={"content-type": ctype, "x-forwarded-for": xff})
    return r.status_code


def test_cung_ip_khac_cong_bi_dem_chung_gioi_han_phut(make_app):
    app = make_app(rate_limit_per_min=1, trust_proxy=True)

    async def go():
        a = await _apost(app, "203.0.113.20:51234")
        b = await _apost(app, "203.0.113.20:51235")  # cùng IP, cổng khác -> vẫn là 1 IP -> 429
        c = await _apost(app, "203.0.113.21:51236")  # IP khác -> qua
        return a, b, c

    assert asyncio.run(go()) == (200, 429, 200)
