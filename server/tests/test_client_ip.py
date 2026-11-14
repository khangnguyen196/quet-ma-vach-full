"""IP khách lấy từ X-Forwarded-For (TRUST_PROXY=1): bỏ phần ":cổng", sai dạng thì dùng IP socket (đợt may-chu-2 vòng 2).

Proxy có thể ghi "1.2.3.4:51234": nếu giữ nguyên thì mỗi yêu cầu (cổng nguồn khác) thành một "IP" mới, giới hạn lượt
theo IP mất tác dụng."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest

from starlette.datastructures import Headers

from conftest import jpeg_bytes, multipart
from ratelimit import clean_ip, client_ip

SOCK = "10.9.9.9"


def _req(xff: "str | list[str] | None", sock: str = SOCK):
    """Request giả; xff là list -> nhiều dòng header X-Forwarded-For (giữ đúng thứ tự gửi)."""
    lines = [] if xff is None else [xff] if isinstance(xff, str) else xff
    headers = Headers(raw=[(b"x-forwarded-for", v.encode("utf-8")) for v in lines])
    return SimpleNamespace(client=SimpleNamespace(host=sock), headers=headers)


@pytest.mark.parametrize("xff, expected", [
    ("1.2.3.4:51234", "1.2.3.4"),
    ("[2001:db8::1]:443", "2001:db8::1"),
    ("[2001:db8::1]", "2001:db8::1"),
    ("2001:db8::1", "2001:db8::1"),  # IPv6 trần: không cắt sau dấu ":" cuối
    ("1.2.3.4", "1.2.3.4"),
    ("9.9.9.9, 1.2.3.4:51234", "1.2.3.4"),  # vẫn lấy phần tử phải nhất, chỉ bỏ cổng
    # IPv4 gói trong IPv6 đếm chung với IPv4 (vòng 3)
    ("::ffff:1.2.3.4", "1.2.3.4"),
    ("[::ffff:1.2.3.4]:443", "1.2.3.4"),
])
def test_bo_cong_giu_ip(xff, expected):
    assert client_ip(_req(xff), trust_proxy=True, proxy_count=1) == expected


@pytest.mark.parametrize("xff", [
    "rac", "unknown", "1.2.3.4:abc", "[2001:db8::1", "999.1.1.1", "1.2.3.4:51234:9",
    # cổng quá dài: int() của Python 3.12 ném ValueError với chuỗi > 4300 chữ số -> phải kiểm độ dài trước (vòng 3)
    "1.2.3.4:" + "9" * 5000,
    "[2001:db8::1]:" + "9" * 5000,
    # IPv6 có zone id: khách qua ingress không bao giờ có, phần sau "%" dài tùy ý -> IP socket (vòng 3)
    "fe80::1%eth0",
    "[fe80::1%eth0]:443",
])
def test_sai_dang_dung_ip_socket(xff):
    assert client_ip(_req(xff), trust_proxy=True, proxy_count=1) == SOCK


# Ca giữ luật (đợt cung-co vòng 2, gợi ý reviewer vòng 3 may-chu-2): đều không phải IP hợp lệ
@pytest.mark.parametrize("value", [
    "1.2.3.4:١٢٣",  # cổng bằng chữ số Ả Rập: isdigit() đúng nhưng không phải ASCII
    "", "[]", "[[1.2.3.4]]:1", "[::1]:",
])
def test_ca_giu_luat_khong_phai_ip(value):
    assert clean_ip(value) is None
    # qua header: dùng IP socket (chuỗi rỗng = không có phần tử nào)
    raw = value.encode("utf-8").decode("latin-1")  # header HTTP là latin-1: byte UTF-8 tới app y như vậy
    assert client_ip(_req(raw), trust_proxy=True, proxy_count=1) == SOCK


@pytest.mark.parametrize("lines, count, expected", [
    # proxy ghi THÊM VÀO CUỐI: dòng sau nối vào cuối danh sách, phần tử phải nhất nằm ở dòng cuối
    (["9.9.9.9, 1.1.1.1", "2.2.2.2"], 1, "2.2.2.2"),
    (["9.9.9.9, 1.1.1.1", "2.2.2.2"], 2, "1.1.1.1"),
    (["9.9.9.9", "1.1.1.1, 2.2.2.2:443"], 1, "2.2.2.2"),
    (["9.9.9.9", ""], 1, "9.9.9.9"),  # dòng rỗng không tính là phần tử
    (["9.9.9.9", "2.2.2.2"], 3, SOCK),  # ngắn hơn PROXY_COUNT -> IP socket
])
def test_x_forwarded_for_nhieu_dong_header(lines, count, expected):
    assert client_ip(_req(lines), trust_proxy=True, proxy_count=count) == expected


def test_proxy_count_2_chuan_hoa_phan_tu_duoc_chon():
    assert client_ip(_req("8.8.8.8, 1.2.3.4:5000, 10.0.0.1"), trust_proxy=True, proxy_count=2) == "1.2.3.4"


def test_trust_proxy_tat_bo_qua_header():
    assert client_ip(_req("1.2.3.4:51234"), trust_proxy=False) == SOCK


async def _apost(app, xff, sock: str = SOCK):
    """xff: chuỗi (1 dòng header), list (nhiều dòng X-Forwarded-For) hoặc None (không gửi)."""
    body, ctype = multipart([("image", "a.jpg", jpeg_bytes())])
    lines = [] if xff is None else [xff] if isinstance(xff, str) else xff
    headers = [("content-type", ctype)] + [("x-forwarded-for", v) for v in lines]
    transport = httpx.ASGITransport(app=app, client=(sock, 40000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/ocr", content=body, headers=headers)
    return r.status_code


def test_cung_ip_khac_cong_bi_dem_chung_gioi_han_phut(make_app):
    app = make_app(rate_limit_per_min=1, trust_proxy=True)

    async def go():
        a = await _apost(app, "203.0.113.20:51234")
        b = await _apost(app, "203.0.113.20:51235")  # cùng IP, cổng khác -> vẫn là 1 IP -> 429
        c = await _apost(app, "203.0.113.21:51236")  # IP khác -> qua
        return a, b, c

    assert asyncio.run(go()) == (200, 429, 200)


def test_cong_qua_dai_qua_app_khong_loi_500(make_app):
    """X-Forwarded-For có cổng 5000 chữ số: dùng IP socket, trả 200 (không 500 vì ValueError)."""
    app = make_app(trust_proxy=True)
    assert asyncio.run(_apost(app, "203.0.113.20:" + "9" * 5000)) == 200


def test_hai_cong_qua_dai_khac_nhau_deu_dem_bang_ip_socket(make_app):
    """2 lần, 2 cổng dài khác nhau: cả hai dùng IP socket (cùng 1 khóa) -> lần 2 bị 429 (không thành 2 "IP" mới)."""
    app = make_app(rate_limit_per_min=1, trust_proxy=True)

    async def go():
        a = await _apost(app, "203.0.113.20:" + "9" * 5000)
        b = await _apost(app, "203.0.113.20:" + "8" * 5000)
        return a, b

    assert asyncio.run(go()) == (200, 429)


def test_ipv4_goi_trong_ipv6_dem_chung_voi_ipv4_qua_app(make_app):
    app = make_app(rate_limit_per_min=1, trust_proxy=True)

    async def go():
        return await _apost(app, "::ffff:203.0.113.20"), await _apost(app, "203.0.113.20")

    assert asyncio.run(go()) == (200, 429)


def test_x_forwarded_for_nhieu_dong_qua_app_lay_dong_cuoi(make_app):
    """2 dòng header X-Forwarded-For, PROXY_COUNT=1: lấy phần tử cuối của DÒNG CUỐI (IP proxy của mình ghi), không phải
    phần tử cuối của dòng đầu (khách tự ghi, đổi mỗi lần)."""
    app = make_app(rate_limit_per_min=1, trust_proxy=True)

    async def go():
        a = await _apost(app, ["198.51.100.1", "203.0.113.20"])
        b = await _apost(app, ["198.51.100.2", "203.0.113.20"])  # dòng đầu khác, dòng cuối như cũ -> cùng IP -> 429
        return a, b

    assert asyncio.run(go()) == (200, 429)
