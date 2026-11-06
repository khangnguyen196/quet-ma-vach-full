"""
Phần B: 5 cách rút thông tin (keyword extractor) từ text OCR -> 11 trường.
Chạy trên MỌI kết quả OCR đã có trong outputs/<ocr>/  =>  outputs/extract/<ocr>__<extractor>/<mã>.json

Dùng:  python run_extract.py
       python run_extract.py --extractors regex,dict,yake
       python run_extract.py --ocr tesseract,easyocr --extractors llm

Chạy lại không mất công: file <mã>.json đã ok thì bỏ qua; file lỗi (_status khác "ok") thì chạy lại.

Extractor "llm" chỉ chạy bằng Ollama trên máy (LLM_PROVIDER=ollama, mặc định, miễn phí).
Model: OLLAMA_MODEL (mặc định qwen2.5:3b). Thời gian chờ mỗi sản phẩm: OLLAMA_TIMEOUT giây (mặc định 180).
Dự án KHÔNG dùng API Claude / Anthropic: LLM_PROVIDER khác "ollama" thì llm bị bỏ qua.
"""
import os, re, sys, json, math, time, argparse, pathlib, unicodedata, traceback
from dotenv import load_dotenv

load_dotenv()
OUT = pathlib.Path("outputs")
EXT_DIR = OUT / "extract"
DICT = pathlib.Path("dict")
FIELDS = ["ten", "thuong_hieu", "khoi_luong", "thanh_phan_dau", "nang_luong_kcal", "dam_g",
          "beo_g", "carb_g", "nha_san_xuat", "bao_quan", "han_su_dung"]
IMAGE_ORDER = ["front", "ingredients", "nutrition", "back", "date"]   # ghép text theo thứ tự này
OLLAMA_TIMEOUT_DEFAULT = 180   # giây, khi OLLAMA_TIMEOUT không đặt / rỗng / không phải số / <= 0 / quá trần
OLLAMA_TIMEOUT_MAX = 86400     # trần 1 ngày

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
    """Ưu tiên ngày đứng sau nhãn HSD/EXP; rồi 6 số liền (ddmmyy) sau nhãn HSD/EXP, chỉ kiểm khoảng ngày 01-31,
    tháng 01-12 (không kiểm lịch: 30/02 vẫn nhận; năm không kiểm; chỉ xét chuỗi 6 số đầu tiên sau nhãn; ngoài
    khoảng thì coi như chưa có); không có thì lấy ngày cuối cùng trong text (NSX thường in trước HSD)."""
    d = grab(r"(?:hsd|han su dung|han dung|exp(?:iry)?|best before|use by)\s*[:.\-]?\s*[^\d\n]{0,12}" + DATE, t)
    if d:
        return d
    # Lỗi OCR / cách in lặp lại: hạn in liền 6 số, có khi xuống dòng (vd "hsd:071026", "hsd / exp:\n200223")
    d = grab(r"(?:\bhsd|\bexp)[^\d]{0,12}(\d{6})(?!\d)", t)
    if d and 1 <= int(d[:2]) <= 31 and 1 <= int(d[2:4]) <= 12:
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

# ---- Luật chịu lỗi OCR lặp lại (đợt ocr-b; mỗi luật có ở text OCR thật của >= 2 sản phẩm;
#      đã bỏ nhãn "dam (g)" và "g đọc thành 9" sau khối lượng tịnh vì chỉ thấy ở 1 sản phẩm) ----
# Nhãn "năng lượng" đọc sai: "nang iuong", "nang ivong", "nang luqng", "nang iugng", "nang luang".
LB_NANG_LUONG = r"nang ?[li1][uv][a-z]?ng"
# Nhãn "calories" đọc sai: "galories", "calorios", "galones"; bỏ "calories from fat" (năng lượng từ chất béo).
LB_CALORIES = r"[cg]alo[a-z]*(?![a-z])(?!\s*fr)"
ENERGY_LABELS = [LB_NANG_LUONG, "energy", LB_CALORIES]
# "% giá trị ... tính trên nhu cầu năng lượng 2000 kcal" là mức tham chiếu, không phải năng lượng của sản phẩm.
REF_INTAKE = re.compile(r"nhu ?cau ?" + LB_NANG_LUONG + r"[^\d\n]{0,5}\d[\d .,]*k?cal")
# Đơn vị theo sau số không phải gam / kcal thì không lấy (mg, %, ml, kJ...).
NOT_GRAM = r"(?![.,]?\d)(?!\s*(?:mg|mcg|ug|kcal|kj|ml|%))"
NOT_KCAL = r"(?![.,]?\d)(?!\s*(?:mg|mcg|ug|kj|ml|%|g\b))"

def loose_number_after(labels, t, not_unit):
    """Dự phòng khi đơn vị bị OCR đọc sai / mất / in trước số: số đầu tiên sau nhãn (cùng dòng, không qua dấu %),
    miễn số đó không kèm đơn vị khác (not_unit)."""
    for lb in labels:
        v = grab(r"(?:" + lb + r")[^\d\n%]{0,30}" + NUM + not_unit, t)
        if v:
            return v
    return ""

def unglue_g(v):
    """'g' dính sau số thập phân bị đọc thành '9' (vd '7,09' là 7,0 g): bỏ số 9 cuối. Chỉ dùng khi không có đơn vị g.
    Rủi ro: số thật có 2 chữ số thập phân tận cùng 9 mà mất chữ g thì bị cắt (vd '18,49' thành '18,4')."""
    return v[:-1] if re.fullmatch(r"\d+[.,]\d+9", v) else v

# ---- Luật đợt sua-nho cho đạm / béo / carb (mỗi luật có ở text OCR thật của >= 2 sản phẩm;
#      thà để trống còn hơn ra số sai) ----
# (a) Đạm / béo / carb trên 100 g là vô lý: để trống, không thử luật khác. Thấy ở: "1449" (8936017368111),
#     "569" / "1199" (8936028641487, mất dấu phẩy, g đọc thành 9), "466" (8936025773181), "471" (8936071070340),
#     "1809" / "8898" (8936221043071), "4129" / "669" (8936221044160), "3009" / "729" (8938501141040),
#     "1622" (8936012061321), "555584" (8935049501503, dict).
# (d) "569" là 5,6 g bị mất dấu phẩy và g đọc thành 9: KHÔNG chèn lại dấu phẩy (ô đạm "1449" của 8936017368111 sẽ
#     thành 14,4 trong khi đáp án là 7,0). Số nguyên >= 3 chữ số không bắt đầu bằng 0 mà tận cùng 9 thì >= 109,
#     nên (a) đã để trống, không cần luật riêng.
GRAM_MAX = 100

def gram_max(v):
    """Giá trị gam > 100 (đúng "> 100", không phải >=) thì trả "", còn lại giữ nguyên."""
    try:
        return "" if float(v.replace(",", ".")) > GRAM_MAX else v
    except ValueError:
        return v

# (b) Nhãn béo không lấy số của "chất béo bão hòa / chuyển hóa", "saturated fat", "trans fat", kể cả khi OCR đọc sai:
#     bỏ khỏi text CẢ cụm nhãn lẫn số đi kèm trước khi chạy luật béo (như REF_INTAKE với năng lượng).
#     Thấy ở: "chat beo bao hoa 0,3 g" (8934614031322), "chat beo bao hoa] saturated fat 240 mg" (8936079120276),
#     "chatbeobaohoalsaturated fat 1809" (8936221043071), "chat beo bao hoal saturated| fat 5,6g" và
#     "chatheobaohda/sauated fat 589" (8936221044160), "trans fats 1,9 mg saturated fat 9120,7 mg" (8936016140060),
#     "saturatec 496  fat 00" (8938501141477), "sat fat less than 209" (8938501141040).
#     Chỉ bắt cụm có "bao hoa" / "chuyen hoa" hoặc "sat... fat" / "trans fat", nên "Total Fat" / "Chất béo" đứng trước
#     vẫn giữ nguyên.
#     Vòng 2 (review): - khoảng giữa nhãn và số không được vượt qua nhãn béo khác (fat, beo, chat b.., trans, sat,
#     total, lipid), nếu không thì "Saturated Fat Total Fat 10g" sẽ ăn số 10 của Total Fat;
#     - nhãn VI bão hòa nối liền nhãn EN bão hòa (kể cả đọc sai "sauated") là MỘT nhãn song ngữ, vẫn bỏ kèm số;
#     - bảng đọc theo cột: nhãn bão hòa và nhãn chuyển hóa đứng liền nhau, không có số giữa ("Total Fat Saturated Fat
#       Trans Fat 10g 3g 0g") thì chỉ bỏ các nhãn, KHÔNG bỏ số nào (số đầu là của Total Fat);
#     - "sat" phải đứng đầu từ ("Sắt 2 Fat 5 g": sắt là iron, không phải saturated); số chen giữa "sat... <số> fat"
#       chỉ nhận khi sau "sat" có >= 3 chữ ("saturatec 496  fat"); "unsaturated" vẫn bỏ;
#     - "chất béo không bão hòa" bỏ trọn (cả "chat beo khong");
#     - số và đơn vị không vượt qua dòng mới.
LB_VI_HEAD = r"(?:chat ?[bh][a-z]{0,2} ?(?:khong ?)?)?"       # "chat beo ", "chatheo", "chat beo khong "
LB_VI_TAIL = r" ?h[a-z]{1,2}(?:l|(?![a-z]))"                  # "hoa", "hda", "hoal"
LB_SAT_VI = LB_VI_HEAD + r"bao" + LB_VI_TAIL + r"(?:\W{0,3}s[a-z]{2,12}\W{0,3}fats?(?![a-z]))?"  # + "/sauated fat"
LB_TRANS_VI = LB_VI_HEAD + r"chuyen" + LB_VI_TAIL + r"(?:\W{0,3}trans\W{0,3}fats?(?![a-z]))?"
LB_SAT_EN = r"(?<![a-z])(?:un)?sat(?:[a-z]*|[a-z]{3,}\W{0,3}\d+)\W{0,3}fats?(?![a-z])"  # "saturated| fat", "saturatec 496  fat"
LB_TRANS_EN = r"(?<![a-z])trans\W{0,3}(?:\d+\W{0,3})?fats?(?![a-z])"
LB_SAT = r"(?:" + LB_SAT_VI + r"|" + LB_SAT_EN + r")"
LB_TRANS = r"(?:" + LB_TRANS_VI + r"|" + LB_TRANS_EN + r")"
LB_SAT_ANY = r"(?:" + LB_SAT + r"|" + LB_TRANS + r")"
NEAR = r"[^\da-z\n]{0,5}"                                       # giữa 2 nhãn liền nhau: chỉ dấu cách / dấu câu
SAT_COLUMN = r"(?:" + LB_SAT + NEAR + LB_TRANS + r"|" + LB_TRANS + NEAR + LB_SAT + r")(?:" + NEAR + LB_SAT_ANY + r")*"
SAT_GAP = r"(?:(?!fat|beo|chat ?[bh]|trans|sat|total|lipid)[^\d\n]){0,25}"
SAT_FAT = re.compile(SAT_COLUMN + r"|" + LB_SAT_ANY + r"(?:" + SAT_GAP + NUM + r"[ \t]*(?:mg|g|9)?)?")
# "calories from fat" (năng lượng từ chất béo) không phải gam béo; bỏ cả khi có nhiều dấu cách giữa "from" và "fat".
FROM_FAT = re.compile(r"from\s+fat")

def fat_text(t):
    """Text dùng cho luật béo (regex và dict): đã bỏ cụm béo bão hòa / chuyển hóa (kèm số) và "from fat"."""
    return FROM_FAT.sub(" ", SAT_FAT.sub(" ", t))

# (c) Luật dự phòng (không có đơn vị g): số nguyên >= 2 chữ số bắt đầu bằng 0 ("09", "00") là "0 g" đọc sai nhưng
#     không chắc là 0: để trống. Thấy ở: "Protein 09", "Fat 09" (8935001214274), "Fat 00" (8938501141477).
#     "00" của 8938501141477 cũng bị luật (b) bỏ, nên riêng (c) chỉ đổi ô của 8935001214274. Bằng chứng >= 2 sản phẩm
#     vẫn đạt.
LEADING_ZERO = re.compile(r"0\d+")

def gram_after(strict_labels, loose_labels, t):
    """Số gam sau nhãn: luật cũ (số + g) trước; không có thì luật dự phòng chịu lỗi OCR.
    Giá trị cuối > 100 thì để trống (luật a), không thử luật khác."""
    v = first_number_after(strict_labels, t)
    if not v:
        v = unglue_g(loose_number_after(loose_labels, t, NOT_GRAM))
        if LEADING_ZERO.fullmatch(v):
            v = ""
    return gram_max(v)

# Nhãn "khối lượng tịnh" đọc sai: "khol luong tinh", "khoi iuong tinh", "kho' luong tinh", "khei luong tinh", "tjnh".
LB_KHOI_LUONG = r"kh[a-z']{1,2} ?[li1]u[a-z]{0,2}ng ?t[a-z]nh|the tich thuc|net ?w(?:eigh)?t"

def net_weight(t):
    """Khối lượng sau nhãn 'khối lượng tịnh' (chịu nhãn đọc sai). Trả về '' nếu không có."""
    m = re.search(r"(?:" + LB_KHOI_LUONG + r")[^\d\n]{0,15}" + NUM + r"(\s?)(g|gr|gam|ml|kg|l)\b", t)
    return m.group(1) + m.group(2) + m.group(3) if m else ""

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
    out["khoi_luong"] = net_weight(t)
    for l in lines[:15]:
        if out["khoi_luong"]:
            break
        m = re.search(r"\b" + NUM + r"\s?(g|gr|gam|ml|kg|l)\b", l)
        if m:
            out["khoi_luong"] = m.group(0); break
    m = re.search(r"thanh phan[^:\n]{0,20}[:\s]+(.{5,500}?)(?:\n\s*\n|\.\s|$)", t, re.I | re.M)
    tp = m.group(1).strip() if m else ""
    out["thanh_phan_dau"] = split_ingredients(tp)
    te = REF_INTAKE.sub(" ", t)
    out["nang_luong_kcal"] = first_number_after(["nang luong", "energy", "calo"], te, r"k?cal") \
        or grab(NUM + r"\s*kcal", te) or loose_number_after(ENERGY_LABELS, te, NOT_KCAL)
    # Luật dự phòng chỉ dùng nhãn rõ ràng (không dùng "dam", "beo", "tinh bot"... vì hay gặp trong phần thành phần).
    out["dam_g"] = gram_after(["chat dam", "dam", "protein"], ["chat dam", "protein"], t)
    # Luật béo chạy trên fat_text: đã bỏ "calories from fat" và cụm béo bão hòa / chuyển hóa (luật b).
    out["beo_g"] = gram_after(["chat beo", "beo", "fat", "lipid"], ["chat beo", "fat", "lipid"], fat_text(t))
    out["carb_g"] = gram_after([r"carbohydrat\w*", "carb", "hydrat cacbon", "duong bot", "tinh bot", "glucid"],
                               [r"carbohydrat\w*", "hydrat cacbon", "glucid"], t)
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

    def number_on_line(labels, unit=r"g\b", src=None):
        for l in (lines if src is None else src):
            if any(fuzz.partial_ratio(lb, l) >= 85 for lb in labels):
                m = re.search(NUM + r"\s*" + unit, l)
                if m:
                    return m.group(1)
        return ""
    out["nang_luong_kcal"] = number_on_line(["nang luong", "energy"], r"k?cal")
    # Đạm / béo / carb > 100 thì để trống (luật a); béo đọc trên text đã bỏ cụm béo bão hòa / chuyển hóa (luật b).
    fat_lines = [l.strip() for l in fat_text(t).splitlines() if l.strip()]
    out["dam_g"] = gram_max(number_on_line(["chat dam", "protein"]))
    out["beo_g"] = gram_max(number_on_line(["chat beo", "fat"], src=fat_lines))
    out["carb_g"] = gram_max(number_on_line(["carbohydrate", "duong bot", "tinh bot", "glucid"]))
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

# ---------- 5. LLM (chỉ Ollama chạy trên máy, không gọi API trả phí) -> JSON ----------
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

def llm_provider():
    """Giá trị LLM_PROVIDER đã bỏ khoảng trắng và đổi về chữ thường (" Ollama " -> "ollama")."""
    return os.environ.get("LLM_PROVIDER", "ollama").strip().lower()

def ollama_timeout():
    """Số giây chờ Ollama trả lời, đọc từ OLLAMA_TIMEOUT.
    Không đặt, rỗng, không phải số, <= 0 hoặc quá 1 ngày (86400) -> 180."""
    try:
        v = float(os.environ.get("OLLAMA_TIMEOUT", "").strip())
    except ValueError:
        return OLLAMA_TIMEOUT_DEFAULT
    # "nan", "inf", số âm, 0; số quá lớn (vd 1e308) làm requests lỗi tràn số
    if not math.isfinite(v) or v <= 0 or v > OLLAMA_TIMEOUT_MAX:
        return OLLAMA_TIMEOUT_DEFAULT
    return int(v) if v.is_integer() else v

def extract_llm(text):
    if llm_provider() != "ollama":
        raise RuntimeError("Dự án chỉ chạy llm bằng Ollama (LLM_PROVIDER=ollama), không gọi API Claude / Anthropic.")
    import requests
    r = requests.post("http://localhost:11434/api/generate", timeout=ollama_timeout(),
                      json={"model": os.environ.get("OLLAMA_MODEL", "qwen2.5:3b"), "prompt": LLM_PROMPT + text,
                            "stream": False, "format": "json"})
    r.raise_for_status()
    return _parse_json(r.json()["response"])

EXTRACTORS = {
    "regex": (extract_regex, lambda: True),
    "dict": (extract_dict, lambda: True),
    "yake": (extract_yake, lambda: True),
    "underthesea": (extract_underthesea, lambda: True),
    "llm": (extract_llm, lambda: llm_provider() == "ollama"),
}
# Câu báo khi một extractor không chạy được (hiện chỉ llm có điều kiện, các extractor khác luôn chạy)
SKIP_MSG = {
    "llm": "LLM_PROVIDER không phải ollama, bỏ qua (dự án chỉ chạy llm bằng Ollama).",
}

def product_text(ocr_dir: pathlib.Path, code: str) -> str:
    files = list(ocr_dir.glob(f"{code}__*.txt"))
    key = lambda p: (IMAGE_ORDER.index(p.stem.split("__", 1)[1]) if p.stem.split("__", 1)[1] in IMAGE_ORDER else 99, p.name)
    return "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in sorted(files, key=key))

def needs_run(out_file: pathlib.Path) -> bool:
    """Có cần chạy (lại) sản phẩm này không: chưa có file, file không đọc được, hoặc _status khác "ok" (lần trước lỗi)."""
    if not out_file.exists():
        return True
    try:
        return json.loads(out_file.read_text(encoding="utf-8")).get("_status") != "ok"
    except (OSError, ValueError, AttributeError):
        return True

def main():
    # In tiếng Việt được cả khi đưa kết quả ra file / pipe (Windows mặc định cp1252 -> UnicodeEncodeError).
    # Chỉ đổi khi luồng có reconfigure (test thay stdout bằng StringIO không có hàm này).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
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
                print(f"[{ext}] {SKIP_MSG.get(ext, 'không chạy được, bỏ qua.')}"); continue
            out_dir = EXT_DIR / f"{ocr_dir.name}__{ext}"
            out_dir.mkdir(parents=True, exist_ok=True)
            print(f"\n=== OCR {ocr_dir.name} + {ext} ===")
            for code in codes:
                out_file = out_dir / f"{code}.json"
                if not needs_run(out_file):   # file ok giữ nguyên; file lỗi / hỏng thì chạy lại
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
