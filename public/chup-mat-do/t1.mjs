// Trang thử chup-mat-do.html: bản JS cho trình duyệt của T1 (tìm theo chữ trên danh mục VN tĩnh, BM25).
// ES module thuần, không import gì. Cùng luật với test-ocr/chup-mat-do/lib.mjs + vn-data.mjs (bản Node là chuẩn;
// test-ocr/chup-mat-do/trang-thu-parity.mjs và test node so 2 bản). Ghép dòng chữ PaddleOCR theo hàng (rowLineInfo)
// chép từ test-ocr/web-ocr/lib.mjs (cách "rows" của 1a).

// ---- Ghép khung chữ PaddleOCR thành hàng (như web-ocr/lib.mjs) ----
function bbox(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function groupRowBoxes(items, minOverlap = 0.5) {
  const boxes = (items || [])
    .filter((it) => it && typeof it.text === "string" && it.text.trim() !== "" && Array.isArray(it.poly) && it.poly.length)
    .map((it) => ({ ...bbox(it.poly), text: it.text.trim(), score: Number.isFinite(it.score) ? it.score : null }))
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  const rows = [];
  for (const b of boxes) {
    const row = rows[rows.length - 1];
    if (row) {
      const overlap = Math.min(b.maxY, row.maxY) - Math.max(b.minY, row.minY);
      const h = Math.min(b.maxY - b.minY, row.maxY - row.minY);
      if (h > 0 && overlap / h >= minOverlap) {
        row.boxes.push(b);
        row.minY = Math.min(row.minY, b.minY);
        row.maxY = Math.max(row.maxY, b.maxY);
        continue;
      }
    }
    rows.push({ minY: b.minY, maxY: b.maxY, boxes: [b] });
  }
  return rows.map((r) => r.boxes.sort((a, b) => a.minX - b.minX));
}

/** Vòng 6 (g1): danh sách khung chữ từ kết quả ocr.predict(...) (mảng, phần tử đầu có items); rỗng / thiếu items -> []
 *  để trang báo "Không đọc được chữ nào trong ảnh." thay vì lỗi JS. Không thuộc luật T1. */
export function ocrItems(result) {
  const first = Array.isArray(result) ? result[0] : null;
  return first && Array.isArray(first.items) ? first.items : [];
}

/** Mỗi hàng khung chữ -> { text, h, conf } (h = khung cao nhất, conf = trung bình score, thang 0–1). */
export function rowLineInfo(items, minOverlap = 0.5) {
  return groupRowBoxes(items, minOverlap).map((r) => {
    const scores = r.map((b) => b.score).filter((s) => s != null);
    return {
      text: r.map((b) => b.text).join(" "),
      h: Math.max(...r.map((b) => b.maxY - b.minY)),
      conf: scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null,
    };
  });
}

// ---- Chuẩn hóa chữ, từ nhiễu (như lib.mjs) ----
/** Bỏ dấu, viết thường, đ -> d, ký tự không phải chữ / số thành dấu cách. "Mì Khoai-Tây" -> "mi khoai tay". */
export function normalizeText(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const MIN_CONF = 0.5;
export const MIN_LETTERS = 3;

export const STOP_PHRASES = [
  "khoi luong tinh", "khoi luong", "trong luong tinh", "trong luong", "the tich thuc", "the tich",
  "thanh phan", "net weight", "net wt", "net vol", "nha san xuat", "san xuat tai", "san xuat boi", "san xuat",
  "phan phoi boi", "phan phoi", "han su dung", "ngay san xuat", "xuat xu", "huong dan su dung", "huong dan",
  "bao quan", "made in", "viet nam", "vietnam", "san pham cua", "cong ty", "tnhh", "co phan", "thuc pham",
  "gia tri dinh duong", "nang luong", "khong chat bao quan", "hinh anh chi mang tinh chat minh hoa",
  "hinh anh minh hoa", "chi mang tinh chat minh hoa", "minh hoa",
];

export const STOP_WORDS = new Set([
  "va", "cua", "cho", "voi", "tai", "tu", "co", "la", "mot", "cac", "nhung", "trong", "khong", "duoc", "hon",
  "the", "and", "of", "with", "for", "in", "new", "moi", "net", "wt", "vol", "approx",
  "g", "gr", "gam", "gram", "grams", "kg", "mg", "ml", "l", "lit", "cl", "oz", "kcal", "kj", "x",
  "nsx", "hsd", "exp", "mfg", "date", "lot", "www", "com", "vn", "http", "https",
  "goi", "hop", "chai", "lon", "tui", "thung", "pack", "sp",
]);

const VOWEL = /[aeiouy]/;

/** Từ nhiễu: số / số + đơn vị, ít hơn 2 chữ cái, không có nguyên âm, hoặc nằm trong STOP_WORDS. */
export function isNoiseWord(w) {
  if (!w) return true;
  if (STOP_WORDS.has(w)) return true;
  if (/^\d+$/.test(w)) return true;
  if (/^\d+(g|gr|gam|kg|mg|ml|l|lit|cl|oz|kcal|kj|x|goi|hop)$/.test(w)) return true;
  const letters = w.replace(/[^a-z]/g, "");
  if (letters.length < 2) return true;
  if (!VOWEL.test(letters)) return true;
  return false;
}

/** Bỏ các cụm STOP_PHRASES (khớp nguyên từ) khỏi chuỗi đã chuẩn hóa (2 lượt, như lib.mjs). */
export function stripPhrases(norm) {
  let s = ` ${norm} `;
  for (const p of STOP_PHRASES) s = s.split(` ${p} `).join(" ");
  for (const p of STOP_PHRASES) s = s.split(` ${p} `).join(" ");
  return s.replace(/\s+/g, " ").trim();
}

/** Dòng dùng được: đủ MIN_LETTERS chữ cái, độ tin (nếu có, thang 0–1) ≥ MIN_CONF. */
export function usableLine(line) {
  const letters = normalizeText(line?.text).replace(/[^a-z]/g, "");
  if (letters.length < MIN_LETTERS) return false;
  const c = Number(line?.conf);
  if (line?.conf != null && Number.isFinite(c) && c < MIN_CONF) return false;
  return true;
}

/** Câu tìm T1: mọi từ của các dòng dùng được, bỏ cụm chung + từ nhiễu. */
export function t1QueryFromLines(lines) {
  const out = [];
  for (const l of (lines || []).filter((x) => usableLine(x))) {
    for (const w of stripPhrases(normalizeText(l.text)).split(" ")) if (w && !isNoiseWord(w)) out.push(w);
  }
  return out;
}

// ---- BM25 (như vn-data.mjs) ----
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export function bm25Tokens(s) {
  return normalizeText(s).split(" ").filter((w) => w && !isNoiseWord(w));
}

/** Dựng chỉ mục BM25. docs: [{ code, text, ... }]. */
export function buildBm25(docs, { k1 = BM25_K1, b = BM25_B } = {}) {
  const tf = [];
  const df = new Map();
  let total = 0;
  for (const d of docs) {
    const m = new Map();
    for (const w of bm25Tokens(d.text)) m.set(w, (m.get(w) || 0) + 1);
    let len = 0;
    for (const c of m.values()) len += c;
    total += len;
    tf.push({ code: d.code, m, len });
    for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  const N = docs.length;
  const avgdl = N ? total / N : 0;
  const idf = new Map();
  for (const [w, n] of df) idf.set(w, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  const post = new Map();
  tf.forEach((t, i) => { for (const w of t.m.keys()) { if (!post.has(w)) post.set(w, []); post.get(w).push(i); } });
  return { tf, idf, post, avgdl, k1, b, N };
}

/** Tìm BM25: trả [{ code, score, i }] top k (i = vị trí trong danh mục), điểm cao trước, bằng điểm thì đứng trước
 *  trong danh mục trước. */
export function bm25Search(index, queryWords, k = 5) {
  const q = [...new Set(queryWords)];
  const score = new Map();
  for (const w of q) {
    const idf = index.idf.get(w);
    if (!idf) continue;
    for (const i of index.post.get(w)) {
      const t = index.tf[i];
      const f = t.m.get(w);
      const s = idf * (f * (index.k1 + 1)) / (f + index.k1 * (1 - index.b + index.b * (t.len / (index.avgdl || 1))));
      score.set(i, (score.get(i) || 0) + s);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([i, s]) => ({ code: index.tf[i].code, score: s, i }));
}
