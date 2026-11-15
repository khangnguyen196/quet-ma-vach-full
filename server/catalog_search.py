"""Tìm sản phẩm trong danh mục lớn theo chữ OCR (đợt kho-lon vòng 2): bản Python của phần TÌM của T1.

Phải KHỚP bản JS (chuẩn): public/chup-mat-do/t1.mjs (rowLineInfo, normalizeText, isNoiseWord, stripPhrases,
mergeDigitWords, shortLineOk, t1QueryFromLines, bm25Tokens, aliasTokens, buildBm25, bm25Search) và src/front-rank.js
(rankFromItems / rankFromText: từ vựng + bí danh của CHÍNH chỉ mục đang nạp -> luật tách chữ i "7 up" -> "7up", ii giữ
dòng 2 chữ cái là bí danh ở >= 2 tài liệu). Khớp kiểm bằng file vàng do test-ocr/chup-mat-do/kho-lon-vang.mjs sinh
(gọi đúng t1.mjs + front-rank.js): server/tests/test_catalog_search.py (fixture nhỏ trong repo) và server/do_khop_t1.py
(3 mức thật ngoài repo). Sửa luật ở JS trước, rồi sửa ở đây cho khớp; KHÔNG sửa JS để khớp Python.

Chỉ dùng thư viện chuẩn + numpy (đã ghim trong requirements.txt). Chỉ mục BM25 dạng mảng gọn (kiểu CSR):
  indptr[t]..indptr[t+1] = các tài liệu có từ t (chỉ số tăng dần), tf cùng chỗ; lens = độ dài tài liệu (chỉ bm25Tokens,
  không tính bí danh); dòng danh mục giữ ở dạng byte JSONL thô + vị trí đầu dòng, chỉ giải mã dòng của kết quả.

Những chỗ dễ lệch với JS (đã xử lý):
  (1) chuẩn hóa chữ đúng thứ tự NFD -> bỏ U+0300–U+036F -> đ/Đ -> d/D -> viết thường -> ký tự khác a-z0-9 thành cách;
  (2) từ vựng / aliasDf / idf / avgdl tính trên chính danh mục đã nạp;
  (3) điểm cộng theo thứ tự xuất hiện ĐẦU TIÊN của từ trong câu (dict giữ thứ tự, không dùng set), mỗi từ cộng vào
      mảng điểm bằng cùng công thức, cùng thứ tự phép tính như bm25Search;
  (4) idf bằng math.log từng từ (không np.log); log của V8 và Python có thể lệch 1 ulp: so điểm có dung sai 1e-9;
  (5) rowLineInfo: sắp xếp ổn định theo (minY, minX), tổng độ tin cộng TUẦN TỰ (không dùng sum(): Python 3.12 cộng
      bù sai số nên khác JS), trim theo đúng tập ký tự trắng của String.prototype.trim.

Vòng 3: chỉ mục DỰNG SẴN lúc build ảnh Docker (build_index_dir -> thư mục .npy + meta.json + lines.jsonl), lúc chạy
CatalogIndex.load_dir nạp bằng np.load(mmap_mode="r") + mmap (không dựng lại: thức dậy nhanh, trang chỉ vào RAM khi
đọc). CatalogIndex.load nhận cả thư mục (mmap) lẫn file .jsonl / .jsonl.gz (dựng trong RAM, cho test / thử).

    python catalog_search.py build  D:/tmp/kho-lon/danh-muc/c.jsonl.gz D:/tmp/kho-lon/chi-muc/c
    python catalog_search.py verify D:/tmp/kho-lon/chi-muc/c D:/tmp/kho-lon/danh-muc/c.jsonl.gz   (mã 1 nếu sai)

Ví dụ:
    cat = CatalogIndex.load("D:/tmp/kho-lon/danh-muc/c.jsonl.gz")
    cat.search(items, k=10)   # [{code, name, brand, img, text, grp, score}] (items = khung chữ của /ocr)
    cat.search_text("Soda chanh diet 7 up")
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import mmap
import re
import sys
import time
import unicodedata
from array import array
from pathlib import Path

import numpy as np

# ---- hằng số, CHÉP NGUYÊN từ t1.mjs ----
BM25_K1 = 1.2
BM25_B = 0.75
MIN_CONF = 0.5
MIN_LETTERS = 3
SHORT_ALIAS_MIN_DF = 2
MIN_OVERLAP = 0.5
DEFAULT_K = 10

STOP_PHRASES = [
    "khoi luong tinh", "khoi luong", "trong luong tinh", "trong luong", "the tich thuc", "the tich",
    "thanh phan", "net weight", "net wt", "net vol", "nha san xuat", "san xuat tai", "san xuat boi", "san xuat",
    "phan phoi boi", "phan phoi", "han su dung", "ngay san xuat", "xuat xu", "huong dan su dung", "huong dan",
    "bao quan", "made in", "viet nam", "vietnam", "san pham cua", "cong ty", "tnhh", "co phan", "thuc pham",
    "gia tri dinh duong", "nang luong", "khong chat bao quan", "hinh anh chi mang tinh chat minh hoa",
    "hinh anh minh hoa", "chi mang tinh chat minh hoa", "minh hoa",
]

STOP_WORDS = frozenset([
    "va", "cua", "cho", "voi", "tai", "tu", "co", "la", "mot", "cac", "nhung", "trong", "khong", "duoc", "hon",
    "the", "and", "of", "with", "for", "in", "new", "moi", "net", "wt", "vol", "approx",
    "g", "gr", "gam", "gram", "grams", "kg", "mg", "ml", "l", "lit", "cl", "oz", "kcal", "kj", "x",
    "nsx", "hsd", "exp", "mfg", "date", "lot", "www", "com", "vn", "http", "https",
    "goi", "hop", "chai", "lon", "tui", "thung", "pack", "sp",
])

# Ký tự trắng của String.prototype.trim (WhiteSpace + LineTerminator của ECMAScript). KHÁC str.strip() của Python
# (Python bỏ cả U+001C–U+001F, U+0085 nhưng không bỏ U+FEFF).
JS_WHITESPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" \
                "\u2028\u2029\u202f\u205f\u3000\ufeff"

_COMBINING = re.compile("[\u0300-\u036f]")
_NON_ALNUM = re.compile("[^a-z0-9]+")
_NOT_LETTER = re.compile("[^a-z]")
_DIGITS = re.compile("[0-9]+")
_DIGIT_UNIT = re.compile("[0-9]+(?:g|gr|gam|kg|mg|ml|l|lit|cl|oz|kcal|kj|x|goi|hop)")
_VOWEL = re.compile("[aeiouy]")
_MERGE = re.compile(" ([0-9]{1,2}) ([a-z]{1,3})(?= )")
_ALIAS = re.compile("[0-9]+([a-z]+)")
_SPACES = re.compile(" +")


def js_trim(s: str) -> str:
    return s.strip(JS_WHITESPACE)


def _is_number(v) -> bool:
    """Number.isFinite của JS: chỉ số (không bool), hữu hạn."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _to_str(s) -> str:
    """String(s ?? "") của JS cho các kiểu gặp trong danh mục / OCR (chuỗi, None, số nguyên, bool)."""
    if s is None:
        return ""
    if isinstance(s, str):
        return s
    if isinstance(s, bool):
        return "true" if s else "false"
    if isinstance(s, int):
        return str(s)
    return str(s)


# ---- ghép khung chữ thành hàng (rowLineInfo) ----
def _bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), max(xs), min(ys), max(ys)


def _group_row_boxes(items, min_overlap=MIN_OVERLAP):
    boxes = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        text = it.get("text")
        poly = it.get("poly")
        if not isinstance(text, str) or js_trim(text) == "" or not isinstance(poly, list) or not poly:
            continue
        min_x, max_x, min_y, max_y = _bbox(poly)
        score = it.get("score")
        boxes.append({"minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y, "text": js_trim(text),
                      "score": score if _is_number(score) else None})
    boxes.sort(key=lambda b: (b["minY"], b["minX"]))  # ổn định như Array.prototype.sort
    rows = []
    for b in boxes:
        if rows:
            row = rows[-1]
            overlap = min(b["maxY"], row["maxY"]) - max(b["minY"], row["minY"])
            h = min(b["maxY"] - b["minY"], row["maxY"] - row["minY"])
            if h > 0 and overlap / h >= min_overlap:
                row["boxes"].append(b)
                row["minY"] = min(row["minY"], b["minY"])
                row["maxY"] = max(row["maxY"], b["maxY"])
                continue
        rows.append({"minY": b["minY"], "maxY": b["maxY"], "boxes": [b]})
    return [sorted(r["boxes"], key=lambda b: b["minX"]) for r in rows]


def row_line_info(items, min_overlap=MIN_OVERLAP):
    """Mỗi hàng khung chữ -> {text, h, conf} (conf = trung bình score cộng tuần tự như reduce của JS)."""
    out = []
    for r in _group_row_boxes(items, min_overlap):
        scores = [b["score"] for b in r if b["score"] is not None]
        conf = None
        if scores:
            s = 0
            for x in scores:
                s = s + x
            conf = s / len(scores)
        out.append({"text": " ".join(b["text"] for b in r), "h": max(b["maxY"] - b["minY"] for b in r), "conf": conf})
    return out


# ---- chuẩn hóa chữ, từ nhiễu ----
def normalize_text(s) -> str:
    """Bỏ dấu, viết thường, đ -> d, ký tự không phải chữ / số thành dấu cách. "Mì Khoai-Tây" -> "mi khoai tay"."""
    s = unicodedata.normalize("NFD", _to_str(s))
    s = _COMBINING.sub("", s)
    s = s.replace("đ", "d").replace("Đ", "D")
    s = s.lower()
    s = _NON_ALNUM.sub(" ", s)
    return js_trim(s)


def is_noise_word(w: str) -> bool:
    if not w:
        return True
    if w in STOP_WORDS:
        return True
    if _DIGITS.fullmatch(w):
        return True
    if _DIGIT_UNIT.fullmatch(w):
        return True
    letters = _NOT_LETTER.sub("", w)
    if len(letters) < 2:
        return True
    if not _VOWEL.search(letters):
        return True
    return False


def strip_phrases(norm: str) -> str:
    s = f" {norm} "
    for _ in range(2):
        for p in STOP_PHRASES:
            s = " ".join(s.split(f" {p} "))
    return js_trim(_SPACES.sub(" ", s))


def _conf_low(line) -> bool:
    # Ghi chú: khác JS khi conf là CHUỖI ("0.3": JS so "0.3" < 0.5 -> true do ép kiểu, ở đây _is_number -> false).
    # Không ảnh hưởng máy chủ: conf luôn do row_line_info sinh (số hoặc None); chỉ dữ liệu gõ tay mới có chuỗi.
    c = line.get("conf") if isinstance(line, dict) else None
    return c is not None and _is_number(c) and c < MIN_CONF


def usable_line(line) -> bool:
    letters = _NOT_LETTER.sub("", normalize_text(line.get("text") if isinstance(line, dict) else None))
    if len(letters) < MIN_LETTERS:
        return False
    return not _conf_low(line)


def merge_digit_words(norm: str, vocab) -> str:
    """Luật i: "7 up" -> "7up" CHỈ khi từ ghép có trong từ vựng; từ sau là từ nhiễu / "in" thì không ghép."""
    if vocab is None:
        return norm

    def rep(m):
        d, w = m.group(1), m.group(2)
        if w in STOP_WORDS or w == "in" or (d + w) not in vocab:
            return m.group(0)
        return f" {d}{w}"

    return js_trim(_MERGE.sub(rep, f" {norm} "))


def short_line_ok(line, vocab, alias_df) -> bool:
    """Luật ii: dòng chỉ 2 chữ cái dùng được khi độ tin đạt và mọi từ là bí danh có ở >= SHORT_ALIAS_MIN_DF tài liệu."""
    if vocab is None or alias_df is None:
        return False
    letters = _NOT_LETTER.sub("", normalize_text(line.get("text") if isinstance(line, dict) else None))
    if len(letters) < 2 or len(letters) >= MIN_LETTERS:
        return False
    if _conf_low(line):
        return False
    ws = [w for w in strip_phrases(normalize_text(line.get("text"))).split(" ") if w and not is_noise_word(w)]
    return len(ws) > 0 and all(w in vocab and alias_df.get(w, 0) >= SHORT_ALIAS_MIN_DF for w in ws)


def t1_query_from_lines(lines, vocab=None, alias_df=None) -> list[str]:
    out = []
    for line in lines or []:
        if not (usable_line(line) or short_line_ok(line, vocab, alias_df)):
            continue
        for w in strip_phrases(merge_digit_words(normalize_text(line.get("text")), vocab)).split(" "):
            if w and not is_noise_word(w):
                out.append(w)
    return out


def bm25_tokens(s) -> list[str]:
    return [w for w in normalize_text(s).split(" ") if w and not is_noise_word(w)]


def alias_tokens(tokens) -> list[str]:
    out = []
    for w in tokens:
        m = _ALIAS.fullmatch(w)
        if m and not is_noise_word(m.group(1)):
            out.append(m.group(1))
    return out


def lines_from_text(text) -> list[dict]:
    """Chữ người dùng sửa -> dòng (như rankFromText): mỗi dòng không trống (trim) = {text, conf: None}."""
    if not isinstance(text, str):
        return []
    out = []
    for s in re.split(r"\r?\n", text):
        s = js_trim(s)
        if s:
            out.append({"text": s, "conf": None})
    return out


ROW_KEYS = ("code", "name", "brand", "img", "text", "grp")

# ---- thư mục chỉ mục dựng sẵn (vòng 3): build_index_dir ghi, CatalogIndex.load_dir nạp bằng mmap ----
INDEX_FORMAT = 1
INDEX_META = "meta.json"
INDEX_LINES = "lines.jsonl"
INDEX_ARRAYS = ("indices", "tf", "indptr", "idf", "lens", "starts", "ends")


def read_source(path) -> tuple[bytes, str]:
    """Đọc danh mục .jsonl / .jsonl.gz -> (byte JSONL chưa nén, sha256 của FILE nguồn như trên đĩa)."""
    data = Path(path).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if Path(path).suffix == ".gz" or data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data, sha


def build_index_dir(src, out_dir) -> dict:
    """Dựng chỉ mục của danh mục src (.jsonl / .jsonl.gz) rồi ghi ra THƯ MỤC out_dir (dùng lúc build ảnh Docker):
    indices / tf / indptr / idf / lens / starts / ends .npy (np.save), meta.json (từ vựng theo thứ tự id, aliasDf, N,
    avgdl, k1, b, sha256 nguồn) và lines.jsonl (dòng thô chưa nén, starts / ends trỏ vào). Trả meta."""
    raw, sha = read_source(src)
    cat = CatalogIndex(raw)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    arrays = {"indices": cat.indices, "tf": cat.tf, "indptr": cat.indptr, "idf": cat.idf, "lens": cat.lens,
              "starts": cat._starts, "ends": cat._ends}
    for name in INDEX_ARRAYS:
        np.save(out / f"{name}.npy", np.ascontiguousarray(arrays[name]), allow_pickle=False)
    (out / INDEX_LINES).write_bytes(raw)
    vocab = [None] * len(cat.vocab)
    for w, t in cat.vocab.items():
        vocab[t] = w
    meta = {"format": INDEX_FORMAT, "N": cat.N, "avgdl": cat.avgdl, "k1": cat.k1, "b": cat.b,
            "postings": cat.postings, "source": Path(src).name, "sha256Source": sha,
            "sha256Raw": hashlib.sha256(raw).hexdigest(), "rawBytes": len(raw), "vocab": vocab, "aliasDf": cat.alias_df}
    # json dump số thực bằng repr: avgdl đọc lại trùng từng bit
    (out / INDEX_META).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def count_lines(raw: bytes) -> int:
    """Số dòng không rỗng (như CatalogIndex / readLevel của JS)."""
    return sum(1 for ln in raw.split(b"\n") if ln)


def verify_index_dir(out_dir, src) -> list[str]:
    """Kiểm thư mục chỉ mục với nguồn: nạp được bằng load_dir, N == số dòng nguồn, sha256 nguồn trong meta trùng.
    Trả danh sách lỗi (rỗng = đạt)."""
    raw, sha = read_source(src)
    probs = []
    try:
        cat = CatalogIndex.load_dir(out_dir)
    except Exception as e:  # noqa: BLE001
        return [f"load_dir lỗi: {type(e).__name__}: {e}"]
    try:
        n = count_lines(raw)
        if cat.N != n:
            probs.append(f"N {cat.N} khác số dòng nguồn {n}")
        if cat.meta.get("sha256Source") != sha:
            probs.append(f"sha256 nguồn trong meta {cat.meta.get('sha256Source')} khác {sha}")
        if cat.N and not cat.row(cat.N - 1).get("code"):
            probs.append("dòng cuối không đọc được mã")
    finally:
        cat.close()
    return probs


def main(argv=None) -> int:
    """python catalog_search.py build <src.jsonl.gz> <out_dir> | verify <out_dir> <src.jsonl.gz>"""
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) == 3 and args[0] == "build":
        t = time.perf_counter()
        meta = build_index_dir(args[1], args[2])
        size = sum(f.stat().st_size for f in Path(args[2]).iterdir() if f.is_file())
        print(f"chỉ mục: {meta['N']} sản phẩm, {len(meta['vocab'])} từ, {meta['postings']} mục, "
              f"{size} B, dựng {time.perf_counter() - t:.1f}s, sha256 nguồn {meta['sha256Source']}")
        return 0
    if len(args) == 3 and args[0] == "verify":
        probs = verify_index_dir(args[1], args[2])
        for p in probs:
            print(f"LỖI chỉ mục: {p}")
        if not probs:
            print("chỉ mục khớp nguồn (load_dir, N, sha256)")
        return 1 if probs else 0
    print(main.__doc__)
    return 2


class CatalogIndex:
    """Chỉ mục BM25 của một danh mục JSONL ({code, name, brand, img, text, grp} mỗi dòng), thứ tự dòng = chỉ số i."""

    def __init__(self, raw: bytes, k1: float = BM25_K1, b: float = BM25_B):
        self.k1 = k1
        self.b = b
        self._raw = raw
        nl = np.flatnonzero(np.frombuffer(raw, dtype=np.uint8) == 10)
        starts = np.concatenate(([0], nl + 1)).astype(np.int64)
        ends = np.concatenate((nl, [len(raw)])).astype(np.int64)
        keep = ends > starts  # bỏ dòng rỗng như readLevel của JS
        self._starts = starts[keep]
        self._ends = ends[keep]
        del nl, starts, ends, keep
        n = len(self._starts)
        vocab: dict[str, int] = {}
        df = array("q")
        alias_df: dict[str, int] = {}
        t_ids = array("i")
        d_ids = array("i")
        tfs = array("i")
        lens = np.zeros(n, dtype=np.int64)
        total = 0
        for i in range(n):
            row = json.loads(raw[self._starts[i]:self._ends[i]])
            base = bm25_tokens(row.get("text") if isinstance(row, dict) else None)
            m: dict[str, int] = {}
            for w in base:
                m[w] = m.get(w, 0) + 1
            for w in dict.fromkeys(alias_tokens(base)):  # mỗi bí danh 1 lần / tài liệu
                m[w] = m.get(w, 0) + 1
                alias_df[w] = alias_df.get(w, 0) + 1
            ln = len(base)
            lens[i] = ln
            total += ln
            for w, c in m.items():
                t = vocab.get(w)
                if t is None:
                    t = len(vocab)
                    vocab[w] = t
                    df.append(0)
                df[t] += 1
                t_ids.append(t)
                d_ids.append(i)
                tfs.append(c)
        self.N = n
        self.avgdl = total / n if n else 0
        self.vocab = vocab
        self.alias_df = alias_df
        # idf từng từ bằng math.log (như Math.log của JS, không dùng np.log)
        self.idf = np.array([math.log(1 + (n - d + 0.5) / (d + 0.5)) for d in df], dtype=np.float64)
        # CSR: sắp ổn định theo từ -> trong mỗi từ, tài liệu giữ thứ tự tăng dần như post của JS
        t_arr = np.frombuffer(t_ids, dtype=np.int32)
        order = np.argsort(t_arr, kind="stable")
        self.indices = np.frombuffer(d_ids, dtype=np.int32)[order].copy()
        self.tf = np.frombuffer(tfs, dtype=np.int32)[order].astype(np.float64)
        counts = np.bincount(t_arr, minlength=len(vocab))
        self.indptr = np.zeros(len(vocab) + 1, dtype=np.int64)
        np.cumsum(counts, out=self.indptr[1:])
        del order, t_arr, counts, t_ids, d_ids, tfs, df
        self.lens = lens.astype(np.float64)
        self.postings = int(self.indptr[-1])

    mmapped = False

    # ---- nạp ----
    @classmethod
    def load(cls, path, **kw) -> "CatalogIndex":
        """Thư mục chỉ mục dựng sẵn -> load_dir (mmap); file .jsonl / .jsonl.gz -> dựng trong RAM (test / thử)."""
        p = Path(path)
        if p.is_dir():
            return cls.load_dir(p)
        return cls(read_source(p)[0], **kw)

    @classmethod
    def load_dir(cls, path) -> "CatalogIndex":
        """Nạp thư mục do build_index_dir ghi: mảng bằng np.load(mmap_mode="r"), dòng thô bằng mmap (chỉ đọc). Không
        dựng lại gì: thời gian nạp ~ đọc meta JSON (từ vựng). Gọi close() trước khi xóa thư mục (Windows giữ file)."""
        p = Path(path)
        if not p.is_dir():
            raise FileNotFoundError(f"không có thư mục chỉ mục: {p}")
        meta = json.loads((p / INDEX_META).read_text(encoding="utf-8"))
        if meta.get("format") != INDEX_FORMAT:
            raise ValueError(f"định dạng chỉ mục {meta.get('format')!r}, cần {INDEX_FORMAT}")
        arrs = {}
        for name in INDEX_ARRAYS:
            f = p / f"{name}.npy"
            if not f.is_file():
                raise FileNotFoundError(f"thiếu {f.name} trong thư mục chỉ mục")
            arrs[name] = np.load(f, mmap_mode="r", allow_pickle=False)
        self = cls.__new__(cls)
        self.k1 = float(meta["k1"])
        self.b = float(meta["b"])
        self.N = int(meta["N"])
        self.avgdl = meta["avgdl"]
        self.vocab = {w: t for t, w in enumerate(meta["vocab"])}
        self.alias_df = dict(meta["aliasDf"])
        self.indices, self.tf, self.indptr = arrs["indices"], arrs["tf"], arrs["indptr"]
        self.idf, self.lens = arrs["idf"], arrs["lens"]
        self._starts, self._ends = arrs["starts"], arrs["ends"]
        self.postings = int(meta["postings"])
        if len(self.vocab) != len(self.idf) or len(self.indptr) != len(self.vocab) + 1 or len(self.lens) != self.N \
                or len(self._starts) != self.N or len(self._ends) != self.N or len(self.indices) != self.postings:
            raise ValueError("thư mục chỉ mục không khớp meta (số từ / số tài liệu / số mục)")
        lines = p / INDEX_LINES
        self._file = open(lines, "rb")  # noqa: SIM115 - giữ mở tới close()
        size = lines.stat().st_size
        self._raw = mmap.mmap(self._file.fileno(), 0, access=mmap.ACCESS_READ) if size else b""
        self.mmapped = True
        self.meta = {k: v for k, v in meta.items() if k not in ("vocab", "aliasDf")}
        return self

    def close(self):
        """Nhả mmap + file + mảng (Windows: phải gọi trước khi xóa thư mục chỉ mục). Bản RAM: không làm gì."""
        if not self.mmapped:
            return
        raw = self._raw
        self._raw = b""
        if isinstance(raw, mmap.mmap):
            raw.close()
        f = getattr(self, "_file", None)
        if f is not None:
            f.close()
            self._file = None
        for name in ("indices", "tf", "indptr", "idf", "lens", "_starts", "_ends"):
            setattr(self, name, None)
        self.mmapped = False

    # ---- tìm ----
    def row(self, i: int) -> dict:
        r = json.loads(self._raw[int(self._starts[i]):int(self._ends[i])])
        out = {}
        for k in ROW_KEYS:
            v = r.get(k)
            out[k] = "" if v is None else v  # null trong danh mục -> "" (như thiếu khóa)
        return out

    def bm25_search(self, query_words, k: int = DEFAULT_K) -> list[tuple[int, float]]:
        """Như bm25Search của t1.mjs: [(i, điểm)] top k, điểm cao trước, bằng điểm thì i nhỏ trước."""
        if k <= 0 or not self.N:
            return []
        scores = np.zeros(self.N, dtype=np.float64)
        touched = np.zeros(self.N, dtype=bool)
        avgdl = self.avgdl or 1
        k1, b = self.k1, self.b
        for w in dict.fromkeys(query_words):  # thứ tự xuất hiện đầu tiên, như [...new Set(q)]
            t = self.vocab.get(w)
            if t is None:
                continue
            idf = float(self.idf[t])
            if not idf:
                continue
            s, e = self.indptr[t], self.indptr[t + 1]
            docs = self.indices[s:e]
            f = self.tf[s:e]
            # CÙNG thứ tự phép tính với JS: idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avgdl)))
            contrib = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (self.lens[docs] / avgdl)))
            scores[docs] += contrib
            touched[docs] = True
        idx = np.flatnonzero(touched)
        if not len(idx):
            return []
        vals = scores[idx]
        if len(idx) > k:
            kth = np.partition(vals, len(vals) - k)[len(vals) - k]  # điểm lớn thứ k: giữ mọi mục >= (kể cả hòa)
            sel = vals >= kth
            idx, vals = idx[sel], vals[sel]
        order = np.lexsort((idx, -vals))  # khóa chính: điểm giảm dần; hòa: i tăng dần
        return [(int(idx[j]), float(vals[j])) for j in order[:k]]

    def query_from_lines(self, lines) -> list[str]:
        return t1_query_from_lines(lines, self.vocab, self.alias_df)

    def rank_lines(self, lines, k: int = DEFAULT_K) -> dict:
        query = self.query_from_lines(lines)
        hits = self.bm25_search(query, k) if query else []
        return {"query": query, "hits": hits}

    def _out(self, hits) -> list[dict]:
        out = []
        for i, s in hits:
            r = self.row(i)
            r["score"] = s
            out.append(r)
        return out

    def search(self, items, k: int = DEFAULT_K) -> list[dict]:
        """Khung chữ OCR ([{text, poly, score}]) -> [{code, name, brand, img, text, grp, score}] (như rankFromItems)."""
        lines = row_line_info(items if isinstance(items, list) else [])
        return self._out(self.rank_lines(lines, k)["hits"])

    def search_text(self, text, k: int = DEFAULT_K) -> list[dict]:
        """Chữ người dùng gõ / sửa -> ứng viên (như rankFromText)."""
        return self._out(self.rank_lines(lines_from_text(text), k)["hits"])


if __name__ == "__main__":
    sys.exit(main())
