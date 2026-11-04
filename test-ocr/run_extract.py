"""
Phần B: 5 cách rút thông tin (keyword extractor) từ text OCR -> 11 trường.
Chạy trên MỌI kết quả OCR đã có trong outputs/<ocr>/  =>  outputs/extract/<ocr>__<extractor>/<mã>.json

Dùng:  python run_extract.py
       python run_extract.py --extractors regex,dict,yake
       python run_extract.py --ocr google,claude --extractors llm
"""
import os, re, json, time, argparse, pathlib, unicodedata, traceback
from dotenv import load_dotenv

load_dotenv()
OUT = pathlib.Path("outputs")
EXT_DIR = OUT / "extract"
DICT = pathlib.Path("dict")
FIELDS = ["ten", "thuong_hieu", "khoi_luong", "thanh_phan_dau", "nang_luong_kcal", "dam_g",
          "beo_g", "carb_g", "nha_san_xuat", "bao_quan", "han_su_dung"]
IMAGE_ORDER = ["front", "back", "date"]   # ghép text theo thứ tự này

# ---------- tiện ích ----------
def strip_accents(s: str) -> str:
    """Bỏ dấu tiếng Việt: 'Thành phần' -> 'Thanh phan'. Dùng để luật chịu được OCR mất dấu."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D")

def read_lines(name):
    p = DICT / name
    return [l.strip() for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []

NUM = r"(\d+(?:[.,]\d+)?)"
DATE = r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{2,4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{4})"

def grab(pattern, t, group=1):
    m = re.search(pattern, t, re.I)
    return m.group(group).strip() if m else ""

def find_date(t):
    """Ưu tiên ngày đứng sau nhãn HSD/EXP; không có thì lấy ngày cuối cùng trong text (NSX thường in trước HSD)."""
    d = grab(r"(?:hsd|han su dung|han dung|exp(?:iry)?|best before|use by)\s*[:.\-]?\s*[^\d\n]{0,12}" + DATE, t)
    if d:
        return d
    all_dates = re.findall(DATE, t)
    return all_dates[-1] if all_dates else ""

def first_number_after(labels, t, unit=r"g\b"):
    """Số đầu tiên đứng sau một trong các nhãn (đã bỏ dấu), kèm đơn vị."""
    for lb in labels:
        v = grab(r"(?:" + lb + r")[^\d\n]{0,30}" + NUM + r"\s*" + unit, t)
        if v:
            return v
    return ""

def split_ingredients(s, k=3):
    parts = re.split(r"[,;]", re.sub(r"\([^)]*\)", "", s))
    parts = [p.strip(" .:") for p in parts if len(p.strip()) >= 2]
    return parts[:k]

# ---------- 1. Luật thuần (regex) ----------
def extract_regex(text):
    t = strip_accents(text).lower()
    lines = [l.strip() for l in t.splitlines() if l.strip()]
    out = {f: "" for f in FIELDS}
    out["ten"] = next((l for l in lines[:10] if len(re.sub(r"[^a-z]", "", l)) >= 4 and not re.search(r"\d{3,}", l)), "")
    for l in lines[:15]:
        m = re.search(r"\b" + NUM + r"\s?(g|gr|gam|ml|kg|l)\b", l)
        if m:
            out["khoi_luong"] = m.group(0); break
    m = re.search(r"thanh phan[^:\n]{0,20}[:\s]+(.{5,500}?)(?:\n\s*\n|\.\s|$)", t, re.I | re.M)
    tp = m.group(1).strip() if m else ""
    out["thanh_phan_dau"] = split_ingredients(tp)
    out["nang_luong_kcal"] = first_number_after(["nang luong", "energy", "calo"], t, r"k?cal") or grab(NUM + r"\s*kcal", t)
    out["dam_g"] = first_number_after(["chat dam", "dam", "protein"], t)
    out["beo_g"] = first_number_after(["chat beo", "beo", "fat", "lipid"], t)
    out["carb_g"] = first_number_after([r"carbohydrat\w*", "carb", "hydrat cacbon", "duong bot", "tinh bot", "glucid"], t)
    out["nha_san_xuat"] = grab(r"(?:san xuat boi|nha san xuat|san xuat tai|manufactured by)\s*[:\-]?\s*([^\n]{5,120})", t) \
        or next((l for l in lines if re.search(r"\bcong ty\b|\btnhh\b|\bco phan\b", l)), "")
    out["bao_quan"] = grab(r"(?:huong dan bao quan|cach bao quan|bao quan)\s*[:\-]?\s*([^\n]{5,120})", t)
    out["han_su_dung"] = find_date(t)
    return out

# ---------- 2. Từ điển + so khớp mờ (rapidfuzz) ----------
_brands = _ingr = _storage = None
def extract_dict(text):
    from rapidfuzz import fuzz
    global _brands, _ingr, _storage
    if _brands is None:
        _brands, _ingr, _storage = (read_lines("brands.txt"), read_lines("ingredients.txt"), read_lines("storage.txt"))
    t = strip_accents(text).lower()
    lines = [l.strip() for l in t.splitlines() if l.strip()]
    out = {f: "" for f in FIELDS}

    def best_in_text(cands, min_score=88, seg=None):
        """Tìm các mục từ điển có trong text: ưu tiên khớp đúng theo ranh giới từ; mục dài (>= 6 ký tự) cho phép khớp mờ."""
        seg = t if seg is None else seg
        hits = []
        for c in cands:
            c2 = strip_accents(c).lower()
            m = re.search(r"(?<![a-z0-9])" + re.escape(c2) + r"(?![a-z0-9])", seg)
            if m:
                hits.append((100, m.start(), c)); continue
            if len(c2) >= 6 and fuzz.partial_ratio(c2, seg) >= min_score:
                hits.append((fuzz.partial_ratio(c2, seg), 10**6, c))
        return hits

    brand_hits = best_in_text(_brands)
    if brand_hits:
        out["thuong_hieu"] = max(brand_hits, key=lambda h: (h[0], -h[1]))[2]
    head = [l for l in lines[:6] if ":" not in l and not re.search(r"\d|cong ty|tnhh", l)] or lines[:1]
    out["ten"] = max(head, key=lambda l: len(re.sub(r"[^a-z]", "", l)), default="")
    for l in lines[:15]:
        m = re.search(r"\b" + NUM + r"\s?(g|gr|gam|ml|kg|l)\b", l)
        if m:
            out["khoi_luong"] = m.group(0); break
    m = re.search(r"thanh phan.{0,600}", t, re.S)
    ingr_hits = sorted(best_in_text(_ingr, 92, seg=m.group(0) if m else t), key=lambda h: h[1])
    out["thanh_phan_dau"] = [h[2] for h in ingr_hits[:3]]

    def number_on_line(labels, unit=r"g\b"):
        for l in lines:
            if any(fuzz.partial_ratio(lb, l) >= 85 for lb in labels):
                m = re.search(NUM + r"\s*" + unit, l)
                if m:
                    return m.group(1)
        return ""
    out["nang_luong_kcal"] = number_on_line(["nang luong", "energy"], r"k?cal")
    out["dam_g"] = number_on_line(["chat dam", "protein"])
    out["beo_g"] = number_on_line(["chat beo", "fat"])
    out["carb_g"] = number_on_line(["carbohydrate", "duong bot", "tinh bot", "glucid"])
    out["nha_san_xuat"] = next((l for l in lines if any(fuzz.partial_ratio(k, l) >= 85 for k in ["cong ty", "tnhh", "co phan"])), "")
    st_hits = best_in_text(_storage, 85)
    out["bao_quan"] = max(st_hits, key=lambda h: h[0])[2] if st_hits else ""
    out["han_su_dung"] = find_date(t)
    return out

# ---------- 3. YAKE: keyword extractor thống kê, không hiểu trường ----------
def extract_yake(text):
    import yake
    try:
        kw = yake.KeywordExtractor(lan="vi", n=3, dedupLim=0.9, top=40)
    except Exception:
        kw = yake.KeywordExtractor(lan="en", n=3, dedupLim=0.9, top=40)
    phrases = [p for p, _ in kw.extract_keywords(text)]
    # YAKE chỉ trả về cụm từ nổi bật; score_combo.py sẽ kiểm tra giá trị đúng có nằm trong danh sách này không
    return {"_keywords": phrases}

# ---------- 4. underthesea: NLP tiếng Việt (NER tìm tên tổ chức) + luật cho số ----------
def extract_underthesea(text):
    from underthesea import ner
    out = extract_regex(text)          # dùng luật cho các số, rồi thay 2 trường bằng NER
    orgs = []
    for line in text.splitlines():
        line = line.strip()
        if not line or len(line) > 200:
            continue
        try:
            tags = ner(line)
        except Exception:
            continue
        cur = []
        for tok in tags:
            word, tag = tok[0], tok[-1]
            if tag == "B-ORG":
                if cur: orgs.append(" ".join(cur))
                cur = [word]
            elif tag == "I-ORG" and cur:
                cur.append(word)
            else:
                if cur: orgs.append(" ".join(cur)); cur = []
        if cur: orgs.append(" ".join(cur))
    orgs = [o.replace("_", " ") for o in orgs]
    if orgs:
        out["nha_san_xuat"] = max(orgs, key=len)
        out["thuong_hieu"] = min(orgs, key=len)
    return out

# ---------- 5. LLM (Claude API hoặc Ollama chạy máy) -> JSON ----------
LLM_PROMPT = """Dưới đây là chữ đọc được bằng OCR từ bao bì một sản phẩm thực phẩm Việt Nam (có thể sai chính tả, thiếu dấu).
Hãy rút ra thông tin và trả về DUY NHẤT một JSON với đúng các khóa sau (không có thì để chuỗi rỗng ""):
{"ten": "tên sản phẩm", "thuong_hieu": "thương hiệu", "khoi_luong": "khối lượng tịnh, ví dụ 75g",
 "thanh_phan_dau": ["3 thành phần đầu tiên"], "nang_luong_kcal": "số kcal trên 100g hoặc khẩu phần, chỉ số",
 "dam_g": "số gam đạm", "beo_g": "số gam chất béo", "carb_g": "số gam carbohydrate",
 "nha_san_xuat": "tên công ty sản xuất", "bao_quan": "hướng dẫn bảo quản ngắn", "han_su_dung": "hạn sử dụng đúng như in"}
Không bịa. Không giải thích.

TEXT OCR:
"""
def _parse_json(s):
    s = re.sub(r"^```(?:json)?|```$", "", s.strip(), flags=re.M).strip()
    start, end = s.find("{"), s.rfind("}")
    return json.loads(s[start:end + 1])

def extract_llm(text):
    provider = os.environ.get("LLM_PROVIDER", "claude").lower()
    if provider == "ollama":
        import requests
        r = requests.post("http://localhost:11434/api/generate", timeout=180,
                          json={"model": os.environ.get("OLLAMA_MODEL", "qwen2.5:7b"), "prompt": LLM_PROMPT + text,
                                "stream": False, "format": "json"})
        r.raise_for_status()
        return _parse_json(r.json()["response"])
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(model=os.environ.get("CLAUDE_MODEL", "claude-haiku-5-5"), max_tokens=800,
                                 messages=[{"role": "user", "content": LLM_PROMPT + text}])
    return _parse_json("".join(b.text for b in msg.content if b.type == "text"))

EXTRACTORS = {
    "regex": (extract_regex, lambda: True),
    "dict": (extract_dict, lambda: True),
    "yake": (extract_yake, lambda: True),
    "underthesea": (extract_underthesea, lambda: True),
    "llm": (extract_llm, lambda: os.environ.get("LLM_PROVIDER", "claude").lower() == "ollama" or bool(os.environ.get("ANTHROPIC_API_KEY"))),
}

def product_text(ocr_dir: pathlib.Path, code: str) -> str:
    files = list(ocr_dir.glob(f"{code}__*.txt"))
    key = lambda p: (IMAGE_ORDER.index(p.stem.split("__", 1)[1]) if p.stem.split("__", 1)[1] in IMAGE_ORDER else 99, p.name)
    return "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in sorted(files, key=key))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ocr", default="", help="chỉ dùng kết quả của các OCR này (mặc định: tất cả)")
    ap.add_argument("--extractors", default=",".join(EXTRACTORS))
    args = ap.parse_args()

    ocr_dirs = [d for d in sorted(OUT.iterdir()) if d.is_dir() and d.name != "extract"]
    if args.ocr:
        wanted = {x.strip() for x in args.ocr.split(",")}
        ocr_dirs = [d for d in ocr_dirs if d.name in wanted]
    if not ocr_dirs:
        raise SystemExit("Chưa có kết quả OCR trong outputs/. Chạy python run_ocr.py trước.")
    exts = [e.strip() for e in args.extractors.split(",") if e.strip()]

    for ocr_dir in ocr_dirs:
        codes = sorted({p.stem.split("__", 1)[0] for p in ocr_dir.glob("*__*.txt")})
        for ext in exts:
            if ext not in EXTRACTORS:
                print(f"[{ext}] không biết extractor này, bỏ qua."); continue
            fn, available = EXTRACTORS[ext]
            if not available():
                print(f"[{ext}] thiếu key (ANTHROPIC_API_KEY) hoặc LLM_PROVIDER, bỏ qua."); continue
            out_dir = EXT_DIR / f"{ocr_dir.name}__{ext}"
            out_dir.mkdir(parents=True, exist_ok=True)
            print(f"\n=== OCR {ocr_dir.name} + {ext} ===")
            for code in codes:
                out_file = out_dir / f"{code}.json"
                if out_file.exists():
                    continue
                text = product_text(ocr_dir, code)
                t0 = time.perf_counter()
                try:
                    data = fn(text) if text.strip() else {}
                    status = "ok"
                except Exception as e:
                    data, status = {}, f"error: {e}"
                    traceback.print_exc(limit=1)
                data["_seconds"] = round(time.perf_counter() - t0, 2)
                data["_status"] = status
                out_file.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
                print(f"  {code}: {data['_seconds']}s {status}")
    print("\nXong. Chạy tiếp:  python score_combo.py")

if __name__ == "__main__":
    main()
