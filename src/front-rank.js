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
 *  ngram: { fuse: "rrf", k } | { fuse: "sum", alpha } – (b) gộp BM25 theo từ với BM25 trên 3-gram ký tự (fuseHits).
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
  const gram = o.ngram ? buildGramIndex(t1, list.map((p) => t1.bm25Tokens(norm(p.text))), list) : null;
  return { opts: o, index, gram };
}

// ---- (b) n-gram 3 ký tự gộp với BM25 theo từ ----
export const NGRAM_TOP = 50;

/** 3-gram ký tự của một từ, đệm " " hai đầu. Ví dụ: "muoi" -> [" mu", "muo", "uoi", "oi "]. */
export function wordGrams(w) {
  const s = ` ${w} `;
  const out = [];
  for (let j = 0; j + 3 <= s.length; j++) out.push(s.slice(j, j + 3));
  return out;
}

/** 3-gram của mọi từ (giữ lặp: đếm số lần trong tài liệu). */
export function textGrams(words) {
  return (words || []).flatMap(wordGrams);
}

/** Chỉ mục BM25 (k1 1,2; b 0,75; cùng công thức idf với T1) trên 3-gram, cùng dạng chỉ mục của t1.buildBm25 để
 *  dùng lại t1.bm25Search (bằng điểm thì đứng trước trong danh mục trước). */
function buildGramIndex(t1, wordLists, products) {
  const k1 = t1.BM25_K1;
  const b = t1.BM25_B;
  const tf = [];
  const df = new Map();
  let total = 0;
  wordLists.forEach((words, i) => {
    const m = new Map();
    for (const g of textGrams(words)) m.set(g, (m.get(g) || 0) + 1);
    let len = 0;
    for (const c of m.values()) len += c;
    total += len;
    tf.push({ code: products[i].code, m, len });
    for (const g of m.keys()) df.set(g, (df.get(g) || 0) + 1);
  });
  const N = wordLists.length;
  const idf = new Map();
  for (const [g, n] of df) idf.set(g, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  const post = new Map();
  tf.forEach((t, i) => { for (const g of t.m.keys()) { if (!post.has(g)) post.set(g, []); post.get(g).push(i); } });
  return { tf, idf, post, avgdl: N ? total / N : 0, k1, b, N };
}

/**
 * Gộp 2 danh sách (mỗi bên top NGRAM_TOP): BM25 theo từ (words) + BM25 n-gram (grams).
 *  fuse "rrf": điểm = Σ 1 / (k + hạng), hạng tính từ 1.
 *  fuse "sum": điểm = điểm từ / điểm từ lớn nhất + alpha · điểm n-gram / điểm n-gram lớn nhất (thiếu bên nào thì 0).
 * Bằng điểm thì đứng trước trong danh mục trước. Trả [{ code, score, i }] top k.
 */
export function fuseHits(words, grams, cfg, k) {
  const acc = new Map();
  const add = (h, s) => {
    const cur = acc.get(h.i);
    if (cur) cur.score += s;
    else acc.set(h.i, { code: h.code, score: s, i: h.i });
  };
  if (cfg?.fuse === "rrf") {
    const kk = Number(cfg.k);
    words.forEach((h, r) => add(h, 1 / (kk + r + 1)));
    grams.forEach((h, r) => add(h, 1 / (kk + r + 1)));
  } else if (cfg?.fuse === "sum") {
    const wMax = words[0]?.score || 0;
    const gMax = grams[0]?.score || 0;
    const alpha = Number(cfg.alpha);
    for (const h of words) add(h, wMax > 0 ? h.score / wMax : 0);
    for (const h of grams) add(h, gMax > 0 ? alpha * (h.score / gMax) : 0);
  } else {
    throw new Error(`ngram.fuse không hợp lệ: ${cfg?.fuse}`);
  }
  return [...acc.values()].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, k);
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
  if (opts.ngram) {
    if (!rIndex.gram) throw new Error("rankFromItems / rankFromText: opts.ngram cần chỉ mục dựng với ngram");
    const hits = query.length
      ? fuseHits(t1.bm25Search(rIndex.index, query, NGRAM_TOP), t1.bm25Search(rIndex.gram, textGrams(query), NGRAM_TOP), opts.ngram, k)
      : [];
    // idfSum vẫn là của BM25 theo từ (để điểm chuẩn hóa so được với cách khác; điểm gộp có thang khác)
    return { lines: lines.map((l) => l.text), query, hits, idfSum: idfSumOf(rIndex.index, query) };
  }
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
