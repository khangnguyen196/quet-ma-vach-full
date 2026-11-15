"""So bản Python (catalog_search.py) với file vàng của T1 bản JS trên danh mục mức thật (đợt kho-lon vòng 2, P3).

File vàng: test-ocr/chup-mat-do/kho-lon-vang.mjs sinh ở D:\\tmp\\kho-lon\\vang\\{a,b,c}.json (chữ 30 ảnh bộ A + B, 7Up,
muối, 6 ca dựng, 70 ca dò, đáp án trên từng mức). Danh mục mức: D:\\tmp\\kho-lon\\danh-muc\\{a,b,c}.jsonl.gz (KHÔNG ở
trong repo). Mỗi mức chạy trong MỘT tiến trình riêng (để RSS sau nạp không lẫn mức trước):

    python server/do_khop_t1.py --muc c [--vang D:\\tmp\\kho-lon\\vang] [--danh-muc D:\\tmp\\kho-lon\\danh-muc]

Trùng hoàn toàn = câu tìm trùng từng từ + mã, chỉ số i, thứ tự 10 gợi ý trùng + điểm lệch tương đối <= 1e-9.
Lệch thì in ca; sửa bản Python, KHÔNG sửa JS. In thêm: thời gian nạp + dựng, RSS sau nạp / sau tìm (psutil của
requirements-dev.txt, chỉ báo; H2 chính thức đo ở vòng 3), thời gian tìm p50 / p95 / max. Thoát mã 1 nếu có lệch.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from catalog_search import CatalogIndex, lines_from_text, row_line_info  # noqa: E402

REL_TOL = 1e-9


def rss_mib():
    try:
        import psutil
    except ImportError:
        return None
    return round(psutil.Process().memory_info().rss / 1048576, 1)


def compare(cat: CatalogIndex, q: dict) -> tuple[bool, str, float]:
    """Một câu vàng -> (trùng?, mô tả lệch, ms tìm)."""
    t = time.perf_counter()
    lines = row_line_info(q["items"]) if "items" in q else lines_from_text(q.get("text"))
    r = cat.rank_lines(lines, len(q["hits"]) if q["hits"] else 10)
    ms = (time.perf_counter() - t) * 1000
    if r["query"] != q["query"]:
        return False, f"câu tìm khác: py {r['query']} / js {q['query']}", ms
    got = [(cat.row(i)["code"], i, s) for i, s in r["hits"]]
    want = [(h["code"], h["i"], h["score"]) for h in q["hits"]]
    if len(got) != len(want):
        return False, f"số gợi ý khác: py {len(got)} / js {len(want)}", ms
    for k, (g, w) in enumerate(zip(got, want)):
        if g[0] != w[0] or g[1] != w[1]:
            return False, f"vị trí {k + 1}: py {g[0]} (i {g[1]}, {g[2]!r}) / js {w[0]} (i {w[1]}, {w[2]!r})", ms
        if not math.isclose(g[2], w[2], rel_tol=REL_TOL, abs_tol=0.0):
            return False, f"vị trí {k + 1} {g[0]}: điểm py {g[2]!r} / js {w[2]!r}", ms
    return True, "", ms


def quantile(xs, p):
    s = sorted(xs)
    if not s:
        return None
    return s[min(len(s) - 1, max(0, math.ceil(p * len(s)) - 1))]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--muc", required=True, choices=["a", "b", "c"])
    ap.add_argument("--vang", default=r"D:\tmp\kho-lon\vang")
    ap.add_argument("--danh-muc", default=r"D:\tmp\kho-lon\danh-muc")
    a = ap.parse_args(argv)
    gold = json.loads(Path(a.vang, f"{a.muc}.json").read_text(encoding="utf-8"))
    rss0 = rss_mib()
    t = time.perf_counter()
    cat = CatalogIndex.load(Path(a.danh_muc, f"{a.muc}.jsonl.gz"))
    load_s = time.perf_counter() - t
    rss1 = rss_mib()
    if cat.N != gold["meta"]["n"]:
        print(f"Số sp khác: py {cat.N} / js {gold['meta']['n']}")
        return 1
    same, diff, times = 0, [], []
    exact_scores = 0
    for q in gold["queries"]:
        ok, why, ms = compare(cat, q)
        times.append(ms)
        if ok:
            same += 1
            lines = row_line_info(q["items"]) if "items" in q else lines_from_text(q.get("text"))
            r = cat.rank_lines(lines, 10)
            if all(s == h["score"] for (_, s), h in zip(r["hits"], q["hits"])):
                exact_scores += 1
        else:
            diff.append((q["id"], why))
    rss2 = rss_mib()
    res = {
        "muc": a.muc, "n": cat.N, "vocab": len(cat.vocab), "postings": cat.postings, "cau": len(gold["queries"]),
        "trung": same, "lech": len(diff), "diemBangTuyetDoi": exact_scores, "napGiay": round(load_s, 2),
        "rssMiB": {"truocNap": rss0, "sauNap": rss1, "sauTim": rss2},
        "timMs": {"p50": round(quantile(times, 0.5), 2), "p95": round(quantile(times, 0.95), 2), "max": round(max(times), 2)},
    }
    print(json.dumps(res, ensure_ascii=False))
    for i, why in diff:
        print(f"LỆCH {i}: {why}")
    return 1 if diff else 0


if __name__ == "__main__":
    sys.exit(main())
