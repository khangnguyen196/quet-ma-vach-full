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
 * Dựng chỉ mục xếp hạng từ danh mục ([{ code, text, brand?, ... }], thứ tự giữ nguyên: i = vị trí trong products).
 * opts (mặc định tắt hết): xem DEFAULT_OPTS.
 */
export const DEFAULT_OPTS = Object.freeze({});

export function buildRankIndex(t1, products, opts = DEFAULT_OPTS) {
  const list = Array.isArray(products) ? products : [];
  const o = { ...opts };
  const index = t1.buildBm25(list.map((p) => ({ code: p.code, text: p.text })));
  return { opts: o, index };
}

/** Tổng idf của các từ khác nhau trong câu tìm có trong chỉ mục BM25. */
function idfSumOf(index, query) {
  let s = 0;
  for (const w of new Set(query)) s += index.idf.get(w) || 0;
  return s;
}

/** Tìm từ danh sách dòng { text, conf }: câu tìm T1 rồi BM25 (câu rỗng thì không tìm).
 *  opts = tùy chọn phía câu tìm (mặc định = opts lúc dựng chỉ mục); tùy chọn phía danh mục luôn theo chỉ mục. */
function rankLines(t1, rIndex, lines, k, opts) {
  const query = t1.t1QueryFromLines(lines);
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
