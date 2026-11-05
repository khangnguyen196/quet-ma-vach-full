"""
Chấm điểm tổ hợp OCR x extractor từ outputs/extract/<ocr>__<extractor>/<mã>.json so với truth.csv.
Khác score.py: ở đây extractor phải TỰ ĐƯA RA giá trị (không chỉ "có trong text").
Ra: outputs/results_combo.csv và outputs/summary_combo.md (ma trận OCR x extractor).
"""
import csv, re, sys, json, pathlib, unicodedata, statistics
from collections import defaultdict
from rapidfuzz import fuzz

OUT = pathlib.Path("outputs")
EXT_DIR = OUT / "extract"
FIELDS = ["ten", "thuong_hieu", "khoi_luong", "thanh_phan_dau", "nang_luong_kcal", "dam_g",
          "beo_g", "carb_g", "nha_san_xuat", "bao_quan", "han_su_dung"]
FUZZ_MIN = 85

def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).lower()
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("đ", "d")
    return re.sub(r"\s+", " ", s.replace(",", ".")).strip()

def num_of(s):
    m = re.search(r"\d+(?:\.\d+)?", norm(s))
    return float(m.group(0)) if m else None

def match(field, truth, got) -> float:
    """1.0 nếu giá trị rút ra đúng với đáp án."""
    t, g = norm(truth), norm(got)
    if not t or not g:
        return 0.0
    if field in ("nang_luong_kcal", "dam_g", "beo_g", "carb_g"):
        a, b = num_of(t), num_of(g)
        return 1.0 if a is not None and b is not None and abs(a - b) < 0.05 else 0.0
    if field == "han_su_dung":
        return 1.0 if re.sub(r"[^\d]", "", t) == re.sub(r"[^\d]", "", g) else 0.0
    if len(g) > 3 * len(t) + 20:          # rút ra cả đoạn dài -> không tính là "đưa ra được"
        return 1.0 if fuzz.ratio(t, g) >= FUZZ_MIN else 0.0
    return 1.0 if fuzz.partial_ratio(t, g) >= FUZZ_MIN else 0.0

def score_product(truth_row, data):
    checked = [f for f in FIELDS if truth_row.get(f, "").strip()]
    scores = {}
    kws = data.get("_keywords")
    for f in checked:
        tv = truth_row[f]
        if kws is not None:                                   # extractor kiểu YAKE: danh sách cụm từ
            if f == "thanh_phan_dau":
                parts = [p for p in tv.split(";") if p.strip()]
                scores[f] = sum(max((match("ten", p, k) for k in kws), default=0) for p in parts) / max(len(parts), 1)
            else:
                scores[f] = max((match(f, tv, k) for k in kws), default=0.0)
        elif f == "thanh_phan_dau":
            parts = [p for p in tv.split(";") if p.strip()]
            got = data.get(f) or []
            got = got if isinstance(got, list) else re.split(r"[,;]", str(got))
            scores[f] = sum(max((match("ten", p, g) for g in got), default=0) for p in parts) / max(len(parts), 1)
        else:
            scores[f] = match(f, tv, data.get(f, ""))
    return scores

def main():
    # In tiếng Việt được cả khi đưa kết quả ra file / pipe (Windows mặc định cp1252 -> UnicodeEncodeError).
    # Chỉ đổi khi luồng có reconfigure (test thay stdout bằng StringIO không có hàm này).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    truth = {}
    with open("truth.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("code", "").strip():
                truth[row["code"].strip()] = row
    combos = [d for d in sorted(EXT_DIR.iterdir()) if d.is_dir()] if EXT_DIR.exists() else []
    if not combos:
        raise SystemExit("Chưa có kết quả rút trích. Chạy python run_extract.py trước.")
    max_points = sum(len([f for f in FIELDS if r.get(f, "").strip()]) for r in truth.values())

    rows, total, per_field, secs = [], {}, defaultdict(lambda: defaultdict(list)), defaultdict(list)
    for d in combos:
        ocr, ext = d.name.split("__", 1)
        tot = 0.0
        for code, trow in truth.items():
            p = d / f"{code}.json"
            data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
            if "_seconds" in data: secs[d.name].append(data["_seconds"])
            for f, s in score_product(trow, data).items():
                rows.append([ocr, ext, code, f, trow[f], data.get(f, "") if not isinstance(data.get(f), list) else ";".join(data.get(f)), round(s, 2)])
                tot += s; per_field[d.name][f].append(s)
        total[d.name] = tot

    with open(OUT / "results_combo.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["ocr", "extractor", "code", "field", "expected", "got", "score"]); w.writerows(rows)

    ocrs = sorted({c.name.split("__")[0] for c in combos})
    exts = sorted({c.name.split("__")[1] for c in combos})
    pct = lambda name: 100 * total.get(name, 0) / max_points if max_points else 0
    lines = ["# Kết quả tổ hợp OCR x extractor", "",
             f"Sản phẩm: {len(truth)} · Điểm tối đa: {max_points} · Ô = % thông tin rút ra đúng", "",
             "| OCR \\ extractor | " + " | ".join(exts) + " |", "|---|" + "---|" * len(exts)]
    for o in ocrs:
        lines.append(f"| {o} | " + " | ".join(f"{pct(f'{o}__{e}'):.0f}%" if f"{o}__{e}" in total else "–" for e in exts) + " |")

    best = max(total, key=total.get)
    bo, be = best.split("__", 1)
    lines += ["", f"**Tổ hợp tốt nhất: OCR `{bo}` + extractor `{be}` = {pct(best):.0f}%**", "",
              "## Trung bình theo extractor (gộp mọi OCR)", "", "| extractor | % đúng TB | giây/sản phẩm |", "|---|---|---|"]
    for e in exts:
        names = [n for n in total if n.endswith("__" + e)]
        avg = statistics.mean(pct(n) for n in names) if names else 0
        tm = [x for n in names for x in secs[n]]
        lines.append(f"| {e} | {avg:.0f}% | {statistics.mean(tm):.2f} |" if tm else f"| {e} | {avg:.0f}% | ? |")
    lines += ["", f"## Tỷ lệ đúng theo trường của tổ hợp tốt nhất ({bo} + {be})", "", "| trường | % |", "|---|---|"]
    for f in FIELDS:
        v = per_field[best][f]
        lines.append(f"| {f} | {100 * sum(v) / len(v):.0f} |" if v else f"| {f} | – |")
    lines += ["", "So với outputs/summary.md (OCR có chứa thông tin hay không): chênh lệch giữa hai bảng chính là phần thông tin "
              "bị mất ở bước rút trích, không phải do OCR."]
    (OUT / "summary_combo.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))

if __name__ == "__main__":
    main()
