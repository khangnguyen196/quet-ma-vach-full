"""Độ dài chữ ứng viên (đợt kho-lon vòng 5): app cắt name / brand ≤ SERVER_NAME_MAX và text ≤ SERVER_TEXT_MAX ký tự
(src/front-server.js, cut() theo Array.from = ký tự Unicode). Giới hạn phải ≥ độ dài lớn nhất trên danh mục máy chủ
(server/catalog/c.jsonl.gz) để app không cắt chữ mà khung đo (không cắt) vẫn dùng: cắt text làm lệch điểm BM25 so với
khung đo. Đọc đúng các trường máy chủ trả trong candidates (CatalogIndex.row: null -> ""). Chạy ~4 giây (đo vòng 6:
pytest báo 3,6–3,8 giây cho file này; cả lệnh kể khởi động Python 4,7–5,6 giây).
Đổi server/catalog/c.jsonl.gz thì phải chạy pytest server: CI (server-image.yml, deploy.yml) KHÔNG chạy pytest.
"""
from __future__ import annotations

import gzip
import json
import re

from conftest import SERVER

REPO = SERVER.parent
CATALOG = SERVER / "catalog" / "c.jsonl.gz"
FRONT_SERVER = REPO / "src" / "front-server.js"


def read_limits(src: str) -> dict:
    """Đọc 2 hằng số trong nguồn front-server.js: {"name": SERVER_NAME_MAX, "text": SERVER_TEXT_MAX}."""
    out = {}
    for key, const in (("name", "SERVER_NAME_MAX"), ("text", "SERVER_TEXT_MAX")):
        m = re.findall(rf"^export const {const} = (\d+);$", src, re.M)
        assert len(m) == 1, f"không đọc được đúng 1 dòng {const} trong src/front-server.js"
        out[key] = int(m[0])
    return out


def catalog_max() -> dict:
    """Độ dài lớn nhất (ký tự Unicode) của name / brand / text trên danh mục máy chủ, + số trường không phải chuỗi."""
    mx = {"name": 0, "brand": 0, "text": 0}
    non_str = 0
    n = 0
    with gzip.open(CATALOG, "rb") as f:
        for ln in f:
            if not ln.strip():
                continue
            r = json.loads(ln)
            n += 1
            for k in mx:
                v = r.get(k)
                v = "" if v is None else v
                if not isinstance(v, str):
                    non_str += 1
                    continue
                mx[k] = max(mx[k], len(v))
    return {"n": n, "max": mx, "nonStr": non_str}


def test_doc_duoc_hang_so():
    lim = read_limits(FRONT_SERVER.read_text(encoding="utf-8"))
    assert lim["name"] > 0 and lim["text"] > 0
    # bộ đọc không nhận dòng sai dạng (chặn đọc nhầm)
    try:
        read_limits("export const SERVER_NAME_MAX = 1;\n")
    except AssertionError:
        pass
    else:
        raise AssertionError("read_limits phải báo lỗi khi thiếu SERVER_TEXT_MAX")


def test_gioi_han_app_khong_cat_chu_danh_muc():
    lim = read_limits(FRONT_SERVER.read_text(encoding="utf-8"))
    got = catalog_max()
    assert got["n"] > 0
    assert got["nonStr"] == 0, "danh mục có name / brand / text không phải chuỗi (app bỏ cả mục)"
    mx = got["max"]
    assert mx["name"] <= lim["name"], f"name dài nhất {mx['name']} > SERVER_NAME_MAX {lim['name']}"
    assert mx["brand"] <= lim["name"], f"brand dài nhất {mx['brand']} > SERVER_NAME_MAX {lim['name']}"
    assert mx["text"] <= lim["text"], f"text dài nhất {mx['text']} > SERVER_TEXT_MAX {lim['text']}"
