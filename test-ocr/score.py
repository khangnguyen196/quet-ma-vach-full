"""
Chấm điểm: so text OCR (outputs/<công cụ>/<mã>__*.txt) với đáp án trong truth.csv.
Mỗi trường 1 điểm nếu giá trị đúng có trong text OCR (số: khớp chính xác; chữ: khớp mờ ≥ 85/100).
Trường thanh_phan_dau: tỷ lệ số thành phần tìm thấy (0–1).
Ra: outputs/results.csv (chi tiết) và outputs/summary.md (tổng hợp).
"""
import csv, re, unicodedata, pathlib, statistics
from collections import defaultdict
from rapidfuzz import fuzz

OUT = pathlib.Path("outputs")
FIELDS = ["ten", "thuong_hieu", "khoi_luong", "thanh_phan_dau", "nang_luong_kcal", "dam_g",
          "beo_g", "carb_g", "nha_san_xuat", "bao_quan", "han_su_dung"]
FUZZ_MIN = 85
# run_ocr.py ghi chuỗi này vào cột status khi không gọi dịch vụ vì chạm trần (phải giống hệt run_ocr.SKIP_STATUS)
SKIP_STATUS = "bỏ qua theo luật chi phí"

def read_times(path):
    """Đọc outputs/times.csv -> (times, errors): tool -> [giây], tool -> số ảnh lỗi.
    Dòng SKIP_STATUS (ảnh chưa chạy vì luật chi phí) không tính là lỗi, không vào thời gian trung bình.
    Chưa có file -> 2 bảng rỗng."""
    times, errors = defaultdict(list), defaultdict(int)
    if path.exists():
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["status"] == SKIP_STATUS:
                    continue
                times[r["tool"]].append(float(r["seconds"]))
                if r["status"] != "ok":
                    errors[r["tool"]] += 1
    return times, errors

def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s or "").lower()
    s = s.replace(",", ".")               # 8,7 và 8.7 coi như nhau
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def is_number(s: str) -> bool:
    return re.fullmatch(r"[\d.]+", s) is not None

def found(value: str, text: str) -> float:
    """1.0 nếu value có trong text, 0.0 nếu không."""
    v, t = norm(value), norm(text)
    if not v:
        return 0.0
    if is_number(v):
        # Chỉ cắt số 0 cuối ở số thập phân (7.0 -> 7); ngày như 19.09.20 giữ nguyên. Không để thành chuỗi rỗng.
        if re.fullmatch(r"\d+\.\d+", v):
            v = v.rstrip("0").rstrip(".") or "0"
        pattern = r"(?<![\d.])" + re.escape(v) + r"(?:[.,]0+)?(?![\d])"
        return 1.0 if re.search(pattern, t) else 0.0
    return 1.0 if fuzz.partial_ratio(v, t) >= FUZZ_MIN else 0.0

def score_field(field: str, value: str, text: str) -> float:
    if field == "thanh_phan_dau":
        parts = [p for p in value.split(";") if p.strip()]
        if not parts:
            return 0.0
        return sum(found(p, text) for p in parts) / len(parts)
    return found(value, text)

def main():
    truth = {}
    with open("truth.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("code", "").strip():
                truth[row["code"].strip()] = row
    if not truth:
        raise SystemExit("truth.csv chưa có dòng nào.")

    tools = sorted(d.name for d in OUT.iterdir() if d.is_dir())
    if not tools:
        raise SystemExit("Chưa có kết quả OCR. Chạy python run_ocr.py trước.")

    times, errors = read_times(OUT / "times.csv")

    rows = []
    total = defaultdict(float)                   # tool -> tổng điểm
    per_field = defaultdict(lambda: defaultdict(list))  # tool -> field -> [điểm]
    max_per_tool = 0
    for code, t in truth.items():
        checked = [f for f in FIELDS if t.get(f, "").strip()]
        max_per_tool += len(checked)
        for tool in tools:
            text = "\n".join(p.read_text(encoding="utf-8", errors="ignore")
                             for p in (OUT / tool).glob(f"{code}__*.txt"))
            for f in checked:
                s = score_field(f, t[f], text)
                rows.append([tool, code, f, t[f], round(s, 2)])
                total[tool] += s
                per_field[tool][f].append(s)

    with open(OUT / "results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tool", "code", "field", "expected", "score"])
        w.writerows(rows)

    ranking = sorted(tools, key=lambda x: -total[x])
    lines = ["# Kết quả so sánh OCR", "",
             f"Sản phẩm: {len(truth)} · Điểm tối đa mỗi công cụ: {max_per_tool}", "",
             "| Hạng | Công cụ | Điểm | % đầy đủ | Giây/ảnh (TB) | Ảnh lỗi |", "|---|---|---|---|---|---|"]
    for i, tool in enumerate(ranking, 1):
        avg = f"{statistics.mean(times[tool]):.1f}" if times[tool] else "?"
        pct = 100 * total[tool] / max_per_tool if max_per_tool else 0
        lines.append(f"| {i} | {tool} | {total[tool]:.1f} | {pct:.0f}% | {avg} | {errors[tool]} |")

    lines += ["", "## Tỷ lệ đúng theo trường (%)", "",
              "| Trường | " + " | ".join(ranking) + " |", "|---|" + "---|" * len(ranking)]
    for f in FIELDS:
        cells = []
        for tool in ranking:
            v = per_field[tool][f]
            cells.append(f"{100 * sum(v) / len(v):.0f}" if v else "–")
        lines.append(f"| {f} | " + " | ".join(cells) + " |")
    lines += ["", "Cách chấm: số phải khớp chính xác; chữ khớp mờ ≥ 85/100; thành phần tính tỷ lệ tìm thấy. "
              "Ô trống trong truth.csv không chấm."]
    (OUT / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\nChi tiết: {OUT / 'results.csv'}")

if __name__ == "__main__":
    main()
