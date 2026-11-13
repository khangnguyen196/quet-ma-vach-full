// "Chụp mặt trước" (đợt nang-t1): phần XẾP HẠNG gợi ý từ chữ đọc được, có thêm tùy chọn để thử cách tìm mới.
// Thuần: không DOM, không import thư viện, không gọi mạng. Nhận module T1 (public/chup-mat-do/t1.mjs) làm tham số
// như src/front-search.js. opts rỗng (mặc định) => kết quả TRÙNG suggestFromItems / suggestFromText của front-search.js.
//
// Ví dụ:
//   const rIndex = buildRankIndex(t1, catalog.products);           // dựng chỉ mục một lần
//   const r = rankFromItems(t1, rIndex, items);                     // { lines, query, hits: [{ code, score, i }], idfSum }
// idfSum = tổng idf (BM25 theo từ) của các từ khác nhau trong câu tìm, trên CHÍNH chỉ mục này: điểm chuẩn hóa =
// hits[0].score / idfSum (dùng để chọn ngưỡng "không chắc").

/**
 * Tùy chọn (mặc định tắt hết):
 *  coop: true     – (a1) gộp "Co.op" / "co-op" / "co op" thành "coop" trên chữ gốc, cả chữ OCR lẫn chữ danh mục,
 *                   TRƯỚC khi tách từ (STOP_WORDS của T1 có "co", nên "Co.op" thành "op" còn "COOP" thành "coop").
 *  fixWords: true – (a2) từ của câu tìm không có trong chỉ mục: thử thay MỘT chỗ theo FIX_RULES (đúng thứ tự, từ trái
 *                   sang), nhận biến thể đầu tiên có trong chỉ mục; không có thì giữ nguyên.
 *  brandWeight: h – (c) từ thuộc trường brand nặng điểm hơn (xem weightBrand); 1 = như cũ.
 */
export const DEFAULT_OPTS = Object.freeze({});

/** (a1) "Co.op Select" -> "coop Select"; "COOP" giữ nguyên (tách từ sẽ thường hóa). */
export function coopNorm(s) {
  return String(s ?? "").replace(/\bco\s*[.\-]?\s*op\b/gi, "coop");
}

/** (a2) Bảng sửa một chỗ, theo đúng thứ tự thử: [từ, thành]. */
export const FIX_RULES = Object.freeze([["l", "i"], ["i", "l"], ["0", "o"], ["o", "0"], ["1", "i"], ["1", "l"], ["5", "s"], ["rn", "m"]]);

/** (a2) Sửa một từ không có trong chỉ mục: luật trước, vị trí trái trước; không biến thể nào có thì giữ nguyên.
 *  Ví dụ (chỉ mục có "iot"): fixWord(idx, "lot") -> "iot". */
export function fixWord(index, w) {
  if (index.idf.has(w)) return w;
  for (const [from, to] of FIX_RULES) {
    for (let p = w.indexOf(from); p >= 0; p = w.indexOf(from, p + 1)) {
      const v = w.slice(0, p) + to + w.slice(p + from.length);
      if (index.idf.has(v)) return v;
    }
  }
  return w;
}

/**
 * Dựng chỉ mục xếp hạng từ danh mục ([{ code, text, brand?, ... }], thứ tự giữ nguyên: i = vị trí trong products).
 */
export function buildRankIndex(t1, products, opts = DEFAULT_OPTS) {
  const list = Array.isArray(products) ? products : [];
  const o = { ...opts };
  const norm = (s) => (o.coop ? coopNorm(s) : s);
  let index = t1.buildBm25(list.map((p) => ({ code: p.code, text: norm(p.text) })));
  if (Number.isFinite(o.brandWeight) && o.brandWeight !== 1) index = weightBrand(t1, index, list, o.brandWeight, norm);
  return { opts: o, index };
}

/**
 * (c) Thương hiệu nặng điểm: f_eff(w) = f_text(w) + (h − 1) · f_brand(w), f_brand = số lần w có trong trường brand
 * (qua bm25Tokens). Độ dài tài liệu + độ dài trung bình tính lại theo f_eff; idf (và danh sách tài liệu chứa từ) không đổi.
 * Chữ tìm (text) đã gồm brand nên từ thương hiệu luôn có trong tài liệu; từ không có trong text thì bỏ qua.
 * Ví dụ h = 2, text "Kem Co.op Select Co.op Select", brand "Co.op Select": f(select) = 2 + 1·1 = 3.
 */
function weightBrand(t1, index, products, h, norm) {
  let total = 0;
  const tf = index.tf.map((t, i) => {
    const m = new Map(t.m);
    const fb = new Map();
    for (const w of t1.bm25Tokens(norm(String(products[i]?.brand ?? "")))) fb.set(w, (fb.get(w) || 0) + 1);
    for (const [w, c] of fb) if (m.has(w)) m.set(w, m.get(w) + (h - 1) * c);
    let len = 0;
    for (const c of m.values()) len += c;
    total += len;
    return { code: t.code, m, len };
  });
  return { ...index, tf, avgdl: index.N ? total / index.N : 0 };
}

/** Tổng idf của các từ khác nhau trong câu tìm có trong chỉ mục BM25. */
function idfSumOf(index, query) {
  let s = 0;
  for (const w of new Set(query)) s += index.idf.get(w) || 0;
  return s;
}

/** Tìm từ danh sách dòng { text, conf }: câu tìm T1 rồi BM25 (câu rỗng thì không tìm).
 *  opts = tùy chọn phía câu tìm (mặc định = opts lúc dựng chỉ mục); tùy chọn phía danh mục luôn theo chỉ mục. */
function rankLines(t1, rIndex, lines, k, opts = {}) {
  const qLines = opts.coop ? lines.map((l) => ({ ...l, text: coopNorm(l.text) })) : lines;
  let query = t1.t1QueryFromLines(qLines);
  if (opts.fixWords) query = query.map((w) => fixWord(rIndex.index, w));
  const hits = query.length ? t1.bm25Search(rIndex.index, query, k) : [];
  return { lines: lines.map((l) => l.text), query, hits, idfSum: idfSumOf(rIndex.index, query) };
}

/** Khung chữ máy chủ OCR (items: [{ text, poly, score }]) → gợi ý; ghép hàng như front-search.js (đường B). */
export function rankFromItems(t1, rIndex, items, k = 5, opts = rIndex.opts) {
  const rows = t1.rowLineInfo(t1.ocrItems([{ items: Array.isArray(items) ? items : [] }]));
  return rankLines(t1, rIndex, rows, k, opts);
}

/** Chữ người dùng sửa trong ô → gợi ý: mỗi dòng không trống = 1 dòng { text, conf: null } (như front-search.js). */
export function rankFromText(t1, rIndex, text, k = 5, opts = rIndex.opts) {
  const lines = (typeof text === "string" ? text : "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ text: s, conf: null }));
  return rankLines(t1, rIndex, lines, k, opts);
}
