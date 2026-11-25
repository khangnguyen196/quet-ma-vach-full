"""Supabase giả của khung đo do_kho_nhom.py (đợt kho-nhom vòng 6, review vòng 5 NÊN SỬA 1).

Máy chủ phân trang kho theo id (order=id, trang sau id=gt.<id cuối>) và DỪNG phân trang khi id cuối trang không phải uuid.
Supabase giả của khung đo phải cho id dạng uuid in thường (Postgres so uuid = so chuỗi hex thường) để kho lớn hơn 1 trang
nạp đủ; khóa ký sinh ngẫu nhiên lúc chạy, không in.
"""
from __future__ import annotations

import re
import secrets
import uuid

import do_kho_nhom
import kho_nhom

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def test_id_gia_la_uuid_in_thuong_tang_dan():
    rows = do_kho_nhom.fake_rows(secrets.token_bytes(32), n=1100)
    ids = [r["id"] for r in rows]
    assert all(UUID_RE.fullmatch(i) for i in ids)
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
    assert ids[0] == str(uuid.UUID(int=0)) and ids[1099] == str(uuid.UUID(int=1099))


def test_kho_gia_2500_dong_trang_1000_nap_du():
    key = secrets.token_bytes(32)
    rows = do_kho_nhom.fake_rows(key, n=2500)
    seen = []
    base = do_kho_nhom.fake_fetch(rows)

    def fetch(url, headers, timeout):
        seen.append(url)
        return base(url, headers, timeout)

    got = do_kho_nhom.count_loaded(do_kho_nhom.SB_URL, do_kho_nhom.PUB, key, fetch, page_size=1000)
    assert got == 2500
    assert len(seen) == 3 and "id=gt." not in seen[0] and all("id=gt." in u for u in seen[1:])
    assert kho_nhom.PAGE_SIZE == 1000


def test_kho_gia_n_kho_mac_dinh_nap_du():
    key = secrets.token_bytes(32)
    got = do_kho_nhom.count_loaded(do_kho_nhom.SB_URL, do_kho_nhom.PUB, key, do_kho_nhom.fake_fetch(do_kho_nhom.fake_rows(key)))
    assert got == do_kho_nhom.N_KHO
