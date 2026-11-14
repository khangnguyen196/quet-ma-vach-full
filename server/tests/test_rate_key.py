"""Khóa đếm lượt theo IP (đợt cung-co vòng 2): IPv6 gộp theo mạng /64.

Một máy (một nhà mạng cấp) thường có cả mạng /64 và tự đổi 64 bit cuối tùy ý (địa chỉ tạm thời), nên nếu đếm theo từng
địa chỉ IPv6 thì lách được giới hạn theo IP. IPv4 và chuỗi không phải IP ("unknown") giữ nguyên."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from conftest import jpeg_bytes, multipart
import ratelimit
from ratelimit import client_ip


@pytest.mark.parametrize("ip, expected", [
    ("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"),
    ("2001:db8:1:2::1", "2001:db8:1:2::/64"),
    ("2001:DB8:1:2::1", "2001:db8:1:2::/64"),  # chữ hoa / viết gọn khác nhau vẫn cùng khóa
    ("::1", "::/64"),
    ("1.2.3.4", "1.2.3.4"),
    ("::ffff:1.2.3.4", "1.2.3.4"),  # IP socket dạng IPv4 gói trong IPv6: đếm như IPv4 (không gộp cả /64 ::ffff:0:0)
    ("unknown", "unknown"),
    ("testclient", "testclient"),
    ("", ""),
])
def test_rate_key(ip, expected):
    assert ratelimit.rate_key(ip) == expected  # (lấy qua module: code cũ chưa có hàm thì chỉ test này đỏ)


def test_client_ip_giu_nghia_cu_khong_gop_64():
    """client_ip vẫn trả đúng 1 địa chỉ (không phải mạng /64); chỉ CHỖ ĐẾM LƯỢT gộp."""
    from types import SimpleNamespace

    from starlette.datastructures import Headers

    req = SimpleNamespace(client=SimpleNamespace(host="2001:db8:1:2::9"),
                          headers=Headers(raw=[(b"x-forwarded-for", b"[2001:db8:5:6::7]:443")]))
    assert client_ip(req, trust_proxy=False) == "2001:db8:1:2::9"
    assert client_ip(req, trust_proxy=True) == "2001:db8:5:6::7"


async def _apost(app, sock: str, xff: str | None = None):
    body, ctype = multipart([("image", "a.jpg", jpeg_bytes())])
    headers = {"content-type": ctype}
    if xff is not None:
        headers["x-forwarded-for"] = xff
    transport = httpx.ASGITransport(app=app, client=(sock, 40000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/ocr", content=body, headers=headers)
    return r.status_code


def _two(app, a: dict, b: dict):
    async def go():
        return await _apost(app, **a), await _apost(app, **b)

    return asyncio.run(go())


def test_ipv6_socket_cung_64_bi_dem_chung(make_app):
    app = make_app(rate_limit_per_min=1)
    assert _two(app, {"sock": "2001:db8:1:2::a"}, {"sock": "2001:db8:1:2:ffff::b"}) == (200, 429)


def test_ipv6_socket_khac_64_dem_rieng(make_app):
    app = make_app(rate_limit_per_min=1)
    assert _two(app, {"sock": "2001:db8:1:2::a"}, {"sock": "2001:db8:1:3::a"}) == (200, 200)


def test_ipv6_tu_x_forwarded_for_cung_64_bi_dem_chung(make_app):
    app = make_app(rate_limit_per_min=1, trust_proxy=True)
    a = {"sock": "10.9.9.9", "xff": "[2001:db8:1:2::a]:443"}
    b = {"sock": "10.9.9.9", "xff": "2001:db8:1:2:1234:5678:9abc:def0"}
    assert _two(app, a, b) == (200, 429)


def test_ipv6_tu_x_forwarded_for_khac_64_dem_rieng(make_app):
    app = make_app(rate_limit_per_min=1, trust_proxy=True)
    a = {"sock": "10.9.9.9", "xff": "2001:db8:1:2::a"}
    b = {"sock": "10.9.9.9", "xff": "2001:db8:1:3::a"}
    assert _two(app, a, b) == (200, 200)


def test_ipv4_nhu_cu(make_app):
    app = make_app(rate_limit_per_min=1)
    assert _two(app, {"sock": "203.0.113.20"}, {"sock": "203.0.113.21"}) == (200, 200)
    app = make_app(rate_limit_per_min=1)
    assert _two(app, {"sock": "203.0.113.20"}, {"sock": "203.0.113.20"}) == (200, 429)
