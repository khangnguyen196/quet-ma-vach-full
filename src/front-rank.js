// "Chụp mặt trước" (đợt nang-t1): phần XẾP HẠNG gợi ý từ chữ đọc được, chỗ cắm các cách tìm mới.
// Thuần: không DOM, không import thư viện, không gọi mạng. Nhận module T1 (public/chup-mat-do/t1.mjs) làm tham số
// như src/front-search.js. Kết quả TRÙNG suggestFromItems / suggestFromText của front-search.js, kèm idfSum.
//
// Vòng 2 đã thử (a) chuẩn hóa co.op + sửa 1 ký tự, (c) thương hiệu nặng điểm, (b) n-gram 3 ký tự gộp BM25 trên
// 30 ảnh (lưới + luật chốt trước, test-ocr/chup-mat-do/nang-t1-do.mjs GRID / choosePoint): không cách nào đạt luật
// giữ, nên đã gỡ khỏi đây (mã + số đo nằm ở các commit "test(nang-t1): cách (a|c|b) — không giữ").
//
// Ví dụ:
//   const rIndex = buildRankIndex(t1, catalog.products);           // dựng chỉ mục một lần
//   const r = rankFromItems(t1, rIndex, items);                     // { lines, query, hits: [{ code, score, i }], idfSum }
// idfSum = tổng idf (BM25 theo từ) của các từ khác nhau trong câu tìm, trên CHÍNH chỉ mục này: điểm chuẩn hóa =
// hits[0].score / idfSum (dùng để chọn ngưỡng "không chắc").

/** Tùy chọn: hiện chưa có cách nào được giữ, nên chỉ nhận opts rỗng (tùy chọn lạ thì báo lỗi, không âm thầm bỏ qua). */
export const DEFAULT_OPTS = Object.freeze({});

function checkOpts(opts) {
  const on = Object.keys(opts || {}).filter((k) => opts[k] != null && opts[k] !== false);
  if (on.length) throw new Error(`front-rank: tùy chọn không hỗ trợ: ${on.join(", ")}`);
}

/** Dựng chỉ mục xếp hạng từ danh mục ([{ code, text, ... }], thứ tự giữ nguyên: i = vị trí trong products). */
export function buildRankIndex(t1, products, opts = DEFAULT_OPTS) {
  checkOpts(opts);
  const list = Array.isArray(products) ? products : [];
  const index = t1.buildBm25(list.map((p) => ({ code: p.code, text: p.text })));
  return { opts: { ...opts }, index };
}

/** Tổng idf của các từ khác nhau trong câu tìm có trong chỉ mục BM25. */
function idfSumOf(index, query) {
  let s = 0;
  for (const w of new Set(query)) s += index.idf.get(w) || 0;
  return s;
}

/** Tìm từ danh sách dòng { text, conf }: câu tìm T1 rồi BM25 (câu rỗng thì không tìm). */
function rankLines(t1, rIndex, lines, k, opts) {
  checkOpts(opts);
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
