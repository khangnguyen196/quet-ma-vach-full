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

// ---- Điểm tin cậy (vòng 3, cách e): kết quả có "chắc chắn" không ----
// Luật chọn ngưỡng CHỐT TRƯỚC khi đo (test-ocr/chup-mat-do/nang-t1-tin-cay.mjs chooseRule): chỉ MỘT đặc trưng,
// ngưỡng = điểm giữa 2 giá trị liên tiếp trên nhóm CHỈNH (bộ A + B = 40 ảnh); precision ≥ 0,9, recall lớn nhất.
// Đặc trưng (thứ tự ưu tiên khi bằng): top1 = điểm BM25 gợi ý 1; gap = top1 − top2 (1 gợi ý thì top2 = 0);
// norm = top1 / idfSum; rel = gap / top1.
// Ví dụ: confidenceOf({ query: ["vissan"], hits: [{ score: 9 }, { score: 4 }], idfSum: 10 }, { feature: "gap", threshold: 3 })
//   → { confident: true, feature: "gap", value: 5, threshold: 3 }

/** Tên các đặc trưng, theo thứ tự ưu tiên F1 → F4. */
export const CONFIDENCE_FEATURES = Object.freeze(["top1", "gap", "norm", "rel"]);

/** Giá trị 4 đặc trưng từ { top1, top2, idfSum } (top2 thiếu = 0; idfSum ≤ 0 → norm 0; top1 ≤ 0 → rel 0). */
export function confidenceValues({ top1, top2, idfSum }) {
  const t2 = Number.isFinite(top2) ? top2 : 0;
  const gap = top1 - t2;
  return { top1, gap, norm: idfSum > 0 ? top1 / idfSum : 0, rel: top1 > 0 ? gap / top1 : 0 };
}

/**
 * Luật đang dùng: { feature, threshold }; feature null = "luôn không chắc" (khi không tách được ca đúng / sai).
 * Nguồn số đo (13/11/2026, test-ocr/chup-mat-do/nang-t1-tin-cay.mjs trên D:\tmp\nang-t1\ket-qua\v2-moc-A.json +
 * v2-moc-B.json, kết quả v3-tin-cay.json): nhóm chỉnh 40 ảnh (21 ảnh đúng ở vị trí 1), tốt nhất mỗi đặc trưng:
 *   top1 ≥ 24,40: 11 confident, 11 đúng (precision 1,00, recall 11/21); gap ≥ 4,87: 13 / 12 (0,92, 12/21);
 *   norm: không ngưỡng nào đạt precision 0,9; rel ≥ 0,2468: 15 / 14 (0,93, 14/21) → CHỌN rel (recall lớn nhất).
 * Ngưỡng = điểm giữa 0,21616… và 0,27743… (2 giá trị rel liên tiếp của nhóm chỉnh).
 * Chỉ báo, KHÔNG dùng để chọn: nhóm giữ riêng 20 ảnh: 10 confident, 4 đúng (precision 0,40, recall 4/6);
 * ca muối (4 dòng Co.op Select, không có trong danh mục): rel 0,332 → confident (sai: kết quả đúng là "không chắc").
 */
export const CONFIDENCE_RULE = Object.freeze({ feature: "rel", threshold: 0.24679639071710696 });

/**
 * Kết quả rankFromItems / rankFromText ({ query, hits: [{ score }], idfSum }) có "chắc chắn" không.
 * Không có gợi ý hoặc câu tìm rỗng → confident false (value null). Luật "luôn không chắc" → confident false.
 * Trả { confident, feature, value, threshold }.
 */
export function confidenceOf(result, rule = CONFIDENCE_RULE) {
  const feature = rule?.feature ?? null;
  const threshold = rule?.threshold ?? null;
  const hits = Array.isArray(result?.hits) ? result.hits : [];
  const query = Array.isArray(result?.query) ? result.query : [];
  if (!hits.length || !query.length || !Number.isFinite(hits[0]?.score)) return { confident: false, feature, value: null, threshold };
  if (!CONFIDENCE_FEATURES.includes(feature) || !Number.isFinite(threshold)) return { confident: false, feature, value: null, threshold };
  const value = confidenceValues({ top1: hits[0].score, top2: hits[1]?.score, idfSum: result.idfSum })[feature];
  return { confident: Number.isFinite(value) && value >= threshold, feature, value, threshold };
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
