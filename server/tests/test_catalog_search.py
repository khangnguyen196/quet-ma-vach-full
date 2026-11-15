"""catalog_search.py (bản Python của phần tìm T1) phải khớp T1 bản JS trên file vàng trong repo (đợt kho-lon vòng 2).

File vàng: tests/fixtures/t1-golden.json + catalog-mini.jsonl.gz, sinh bằng test-ocr/chup-mat-do/kho-lon-vang.mjs (gọi
đúng public/chup-mat-do/t1.mjs + src/front-rank.js). Trùng = câu tìm trùng từng từ, mã + chỉ số + thứ tự 10 gợi ý trùng,
điểm lệch tương đối <= 1e-9 (log của V8 và Python có thể lệch 1 ulp).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

import catalog_search as cs

FIX = Path(__file__).resolve().parent / "fixtures"
GOLD = json.loads((FIX / "t1-golden.json").read_text(encoding="utf-8"))
REL_TOL = 1e-9


@pytest.fixture(scope="module")
def cat():
    return cs.CatalogIndex.load(FIX / "catalog-mini.jsonl.gz")


def _lines(q):
    return cs.row_line_info(q["items"]) if "items" in q else cs.lines_from_text(q.get("text"))


def test_golden_file_shape():
    assert GOLD["meta"]["k"] == 10
    assert len(GOLD["queries"]) >= 40
    ids = [q["id"] for q in GOLD["queries"]]
    assert len(ids) == len(set(ids))
    for must in ("7up-may", "7up-go", "muoi", "dung-dau-d", "dung-7-up-go", "dung-up-mot-dong", "dung-rong-chu"):
        assert must in ids
    assert sum(1 for i in ids if i.startswith("ngoai-")) == 6
    assert sum(1 for i in ids if i.startswith("B-")) == 30
    assert (FIX / "catalog-mini.jsonl.gz").stat().st_size <= 300 * 1024


def test_index_matches_js(cat):
    assert cat.N == GOLD["meta"]["n"]
    assert len(cat.vocab) == GOLD["meta"]["vocab"]
    assert math.isclose(cat.avgdl, GOLD["meta"]["avgdl"], rel_tol=0, abs_tol=0)


@pytest.mark.parametrize("q", GOLD["queries"], ids=[q["id"] for q in GOLD["queries"]])
def test_golden_query(cat, q):
    r = cat.rank_lines(_lines(q), GOLD["meta"]["k"])
    assert r["query"] == q["query"], "câu tìm khác bản JS"
    got = [(cat.row(i)["code"], i) for i, _ in r["hits"]]
    want = [(h["code"], h["i"]) for h in q["hits"]]
    assert got == want, "mã / thứ tự 10 gợi ý khác bản JS"
    for (i, s), h in zip(r["hits"], q["hits"]):
        assert math.isclose(s, h["score"], rel_tol=REL_TOL, abs_tol=0.0), f"điểm {h['code']}: py {s!r} / js {h['score']!r}"


def test_search_output_shape(cat):
    q = next(x for x in GOLD["queries"] if x["id"] == "7up-may")
    out = cat.search(q["items"])
    assert [o["code"] for o in out] == [h["code"] for h in q["hits"]]
    assert all(set(o) == {"code", "name", "brand", "img", "text", "grp", "score"} for o in out)
    assert all(isinstance(o["score"], float) for o in out)
    typed = next(x for x in GOLD["queries"] if x["id"] == "7up-go")
    assert [o["code"] for o in cat.search_text(typed["text"])] == [h["code"] for h in typed["hits"]]
    assert cat.search([]) == [] and cat.search(None) == [] and cat.search_text("") == []
    assert len(cat.search(q["items"], k=3)) == 3


def test_normalize_order_matches_t1():
    # NFD -> bỏ dấu kết hợp -> đ/Đ -> viết thường -> ký tự khác a-z0-9 thành cách
    assert cs.normalize_text("Mì Khoai-Tây") == "mi khoai tay"
    assert cs.normalize_text("ĐƯỜNG đen") == "duong den"
    assert cs.normalize_text("İstanbul Straße") == "istanbul stra e"
    assert cs.normalize_text(None) == ""
    assert cs.js_trim("﻿ a  ") == "a"
    assert cs.js_trim("\x1cA\x85") == "\x1cA\x85", "String.prototype.trim không bỏ U+001C / U+0085"


def test_query_rules():
    vocab = {"7up": 0, "up": 1, "soda": 2}
    assert cs.merge_digit_words("soda 7 up", vocab) == "soda 7up"
    assert cs.merge_digit_words("soda 7 up", None) == "soda 7 up"
    assert cs.merge_digit_words("7 in", {"7in": 0}) == "7 in"
    assert cs.short_line_ok({"text": "Up", "conf": 0.9}, vocab, {"up": 2})
    assert not cs.short_line_ok({"text": "Up", "conf": 0.9}, vocab, {"up": 1})
    assert not cs.short_line_ok({"text": "Up", "conf": 0.4}, vocab, {"up": 2})
    assert cs.is_noise_word("500g") and cs.is_noise_word("xx") and cs.is_noise_word("cua")
    assert not cs.is_noise_word("milo")
    assert cs.bm25_tokens("Khối lượng tịnh 500g Milo") == ["khoi", "luong", "tinh", "milo"]
    assert cs.alias_tokens(["7up", "100g", "abc"]) == ["up"]


def test_row_line_info_conf_is_sequential_sum():
    # 3 độ tin mà sum() bù sai số của Python 3.12 cho kết quả khác cộng tuần tự
    items = [{"text": t, "poly": [[x, 0], [x + 5, 0], [x + 5, 10], [x, 10]], "score": s}
             for t, x, s in (("a", 0, 0.1), ("b", 10, 0.2), ("c", 20, 0.3))]
    (row,) = cs.row_line_info(items)
    assert row["text"] == "a b c"
    assert row["conf"] == ((0 + 0.1) + 0.2 + 0.3) / 3
