// "Chụp mặt trước" (đợt tu-dong vòng 2): GỘP xếp hạng 2 nguồn — T1 (BM25 trên danh mục VN tĩnh) và kết quả tìm theo
// chữ trên Open Food Facts (src/off-search.js) — thành tối đa 5 sản phẩm.
// Thuần: không DOM, không gọi mạng; nhận module T1 (public/chup-mat-do/t1.mjs) làm tham số như src/front-rank.js.
//
// Ba cách (đo ở test-ocr/chup-mat-do/tu-dong-gop-do.mjs):
//   f1  (mặc định): ứng viên OFF chưa có trong danh mục được chấm bằng CÙNG BM25 của T1, dùng idf + độ dài trung bình
//       của chỉ mục danh mục (không dựng lại chỉ mục), rồi xếp chung với kết quả T1; mã OFF đã có trong danh mục dùng
//       bản danh mục (điểm BM25 của chính tài liệu đó). Hòa điểm: hàng bán ở VN trước, rồi T1 trước OFF.
//       Tùy chọn: offGap (ứng viên OFF bị trừ một khoảng điểm trước khi xếp), minMatch (ứng viên OFF phải khớp ít nhất
//       bấy nhiêu từ khác nhau của câu tìm T1, mặc định 1).
//   f2: RRF (k = 60) giữa 5 kết quả đầu của T1 và 5 kết quả đầu của OFF (hòa: T1 trước).
//   f3: T1 trước, OFF chỉ lấp chỗ trống (VN trước, giữ thứ tự OFF).
// OFF lỗi / rỗng / bị hủy (offResult không ok) → kết quả GIỐNG HỆT T1 (cùng thứ tự, cùng mã).
//
// LỚP CHẶN (vòng 3, mọi cách gộp; luật "không làm hại" của chủ dự án được code bảo đảm, không chỉ dựa vào số đo):
//   lockTop L : L gợi ý đầu của T1 giữ nguyên vị trí 1..L, không ứng viên nào chen lên trên;
//   offMax M  : trong k chỗ, ứng viên CHỈ CÓ trên OFF (mã không có trong danh mục) chiếm tối đa M chỗ; chỉ được quá M
//               để lấp chỗ TRỐNG (T1 + mã OFF có trong danh mục không đủ k). Mã OFF có trong danh mục dùng bản danh
//               mục, không bị M giới hạn;
//   offTopRule { gap, minWords } (chỉ f1): ứng viên chỉ có trên OFF chỉ được xếp trên mục danh mục khi điểm ≥ điểm mục
//               đó + gap VÀ khớp ≥ minWords từ khác nhau của câu tìm T1; không đạt thì xếp sau mọi mục danh mục.
//   Mặc định DEFAULT_GUARD (chọn ở vòng 3 theo luật P3e, xem comment ở đó); { lockTop: 0, offMax: k } = không chặn.
//
// Ví dụ:
//   const r = rankFromItems(t1, rIndex, items);                         // T1 (src/front-rank.js)
//   const off = await offSearch.search(q);                               // { ok, hits: [{ code, name, brand, img, vn, text }] }
//   mergeFront(t1, rIndex, catalog.products, r, off)                     // [{ code, name, brand, img, source, vn, score }]
import { frontImageUrl } from "./front-search.js";

export const MERGE_K = 5;
export const MERGE_METHODS = Object.freeze(["f1", "f2", "f3"]);
/** Lớp chặn mặc định (vòng 3). */
export const DEFAULT_GUARD = Object.freeze({ lockTop: 1, offMax: 2, offTopRule: null });
export const RRF_K = 60;
/** Số kết quả đầu của mỗi nguồn đưa vào RRF (f2). */
export const RRF_DEPTH = 5;

/** Mục hiển thị từ sản phẩm danh mục. */
function catalogItem(p, score = null) {
  return { code: p.code, name: String(p.name ?? ""), brand: String(p.brand ?? ""), img: frontImageUrl(p.code, p.img), source: "catalog", vn: true, score };
}

/** Mục hiển thị từ ứng viên OFF (đã lọc ở parseSearch: mã 8–14 số, ảnh images.openfoodfacts.org). */
function offItem(h, score = null) {
  return { code: h.code, name: String(h.name ?? ""), brand: String(h.brand ?? ""), img: String(h.img ?? ""), source: "off", vn: h.vn === true, score };
}

/** Điểm BM25 của một tài liệu (m: từ → số lần, len) cho câu tìm, dùng idf / avgdl / k1 / b của chỉ mục. Cùng công thức
 *  t1.bm25Search. Trả { score, matched: số từ khác nhau của câu tìm có trong tài liệu (và trong chỉ mục) }. */
export function bm25DocScore(index, doc, queryWords) {
  let score = 0;
  let matched = 0;
  for (const w of new Set(queryWords || [])) {
    const idf = index.idf.get(w);
    const f = doc.m.get(w);
    if (!idf || !f) continue;
    matched++;
    score += idf * (f * (index.k1 + 1)) / (f + index.k1 * (1 - index.b + index.b * (doc.len / (index.avgdl || 1))));
  }
  return { score, matched };
}

/** Tài liệu BM25 từ chữ ứng viên OFF, tách từ như chỉ mục (t1.bm25Tokens + bí danh t1.aliasTokens nếu có). */
export function offDoc(t1, text) {
  const base = t1.bm25Tokens(String(text ?? ""));
  const m = new Map();
  for (const w of base) m.set(w, (m.get(w) || 0) + 1);
  if (typeof t1.aliasTokens === "function") for (const w of new Set(t1.aliasTokens(base))) m.set(w, (m.get(w) || 0) + 1);
  return { m, len: base.length };
}

function okOff(offResult) {
  return !!(offResult && offResult.ok === true && Array.isArray(offResult.hits) && offResult.hits.length);
}

/** Danh sách T1 → mục hiển thị (bỏ hit không khớp danh mục), giữ thứ tự. */
function t1Items(products, t1Result, k) {
  const out = [];
  for (const h of t1Result?.hits || []) {
    const p = products[h?.i];
    if (!p || p.code !== h.code) continue;
    out.push(catalogItem(p, Number.isFinite(h.score) ? h.score : null));
    if (out.length >= k) break;
  }
  return out;
}

/**
 * Lớp chặn trên danh sách đã xếp ĐỦ (chưa cắt k): lockTop mục đầu của T1 (base) đứng đầu, giữ thứ tự; rồi theo thứ tự
 * đã xếp, mục chỉ có trên OFF (source "off") tối đa offMax; còn chỗ trống thì lấp bằng mục OFF bị gạt (thứ tự cũ).
 */
function applyGuard(ranked, base, { k, lockTop, offMax }) {
  const lock = base.slice(0, Math.max(0, Math.min(lockTop | 0, base.length)));
  const out = [...lock];
  const have = new Set(lock.map((x) => x.code));
  const spare = [];
  let offs = 0;
  for (const it of ranked) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    if (it.source === "off" && offs >= offMax) { spare.push(it); continue; }
    if (it.source === "off") offs++;
    have.add(it.code);
    out.push(it);
  }
  for (const it of spare) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    have.add(it.code);
    out.push(it);
  }
  return out.slice(0, k);
}

/**
 * Gộp T1 + OFF → tối đa k mục { code, name, brand, img, source: "catalog" | "off", vn, score }.
 * t1Result: kết quả rankFromItems / rankFromText ({ query, hits: [{ code, score, i }] }); products: danh mục (cùng thứ
 * tự với chỉ mục rIndex); offResult: kết quả off-search search() hoặc gộp nhiều câu ({ ok, hits }).
 * opts: { method: "f1" | "f2" | "f3", k, offGap, minMatch, rrfK, rrfDepth, lockTop, offMax, offTopRule }
 * (lockTop / offMax / offTopRule thiếu thì lấy DEFAULT_GUARD).
 */
export function mergeFront(t1, rIndex, products, t1Result, offResult, opts = {}) {
  const {
    method = "f1", k = MERGE_K, offGap = 0, minMatch = 1, rrfK = RRF_K, rrfDepth = RRF_DEPTH,
    lockTop = DEFAULT_GUARD.lockTop, offMax = DEFAULT_GUARD.offMax, offTopRule = DEFAULT_GUARD.offTopRule,
  } = opts;
  if (!MERGE_METHODS.includes(method)) throw new Error(`front-merge: cách gộp không hỗ trợ: ${method}`);
  const list = Array.isArray(products) ? products : [];
  const base = t1Items(list, t1Result, k);
  if (!okOff(offResult)) return base;
  const guard = (ranked) => applyGuard(ranked, base, { k, lockTop, offMax: Number.isFinite(offMax) ? offMax : k });

  const index = rIndex.index;
  const byCode = new Map();
  list.forEach((p, i) => { if (p && typeof p.code === "string" && !byCode.has(p.code)) byCode.set(p.code, i); });
  // ứng viên OFF: bỏ trùng; mã đã có trong danh mục → bản danh mục
  const offs = [];
  const seenOff = new Set();
  for (const h of offResult.hits) {
    if (!h || typeof h.code !== "string" || seenOff.has(h.code)) continue;
    seenOff.add(h.code);
    offs.push(byCode.has(h.code) ? { inCatalog: true, i: byCode.get(h.code), h } : { inCatalog: false, h });
  }

  if (method === "f3") {
    const out = [...base];
    const have = new Set(out.map((x) => x.code));
    const fill = [...offs.filter((o) => (o.inCatalog || o.h.vn === true)), ...offs.filter((o) => !(o.inCatalog || o.h.vn === true))];
    for (const o of fill) {
      const item = o.inCatalog ? catalogItem(list[o.i]) : offItem(o.h);
      if (have.has(item.code)) continue;
      have.add(item.code);
      out.push(item);
    }
    return guard(out);
  }

  if (method === "f2") {
    const score = new Map(); // code → { s, item, firstT1, order }
    let order = 0;
    const add = (item, rank, fromT1) => {
      const cur = score.get(item.code);
      const s = 1 / (rrfK + rank);
      if (cur) { cur.s += s; cur.fromT1 = cur.fromT1 || fromT1; return; }
      score.set(item.code, { s, item, fromT1, order: order++ });
    };
    base.slice(0, rrfDepth).forEach((it, r) => add(it, r + 1, true));
    offs.slice(0, rrfDepth).forEach((o, r) => add(o.inCatalog ? catalogItem(list[o.i]) : offItem(o.h), r + 1, false));
    return guard([...score.values()]
      .sort((a, b) => b.s - a.s || (b.fromT1 - a.fromT1) || a.order - b.order)
      .map((x) => ({ ...x.item, score: x.s })));
  }

  // f1: chấm chung một thang BM25
  const query = Array.isArray(t1Result?.query) ? t1Result.query : [];
  const cands = new Map(); // code → { item, score, rankScore, tier, vn, src: 0 T1 / 1 OFF, order }
  let order = 0;
  for (const it of base) cands.set(it.code, { item: it, score: it.score ?? 0, rankScore: it.score ?? 0, tier: 0, vn: true, src: 0, order: order++ });
  for (const o of offs) {
    if (o.inCatalog) {
      const p = list[o.i];
      if (cands.has(p.code)) continue;
      const doc = index.tf[o.i];
      const { score, matched } = doc && doc.code === p.code ? bm25DocScore(index, doc, query) : { score: 0, matched: 0 };
      if (matched < Math.max(1, minMatch)) continue;
      cands.set(p.code, { item: catalogItem(p, score), score, rankScore: score, tier: 0, vn: true, src: 0, order: order++ });
    } else {
      if (cands.has(o.h.code)) continue;
      const { score, matched } = bm25DocScore(index, offDoc(t1, o.h.text || `${o.h.name ?? ""} ${o.h.brand ?? ""}`), query);
      if (matched < Math.max(1, minMatch)) continue;
      // offTopRule: không đạt (khớp < minWords) → hạng 1 (sau mọi mục danh mục); đạt → trừ gap rồi xếp chung
      const rule = offTopRule && typeof offTopRule === "object" ? offTopRule : null;
      const tier = rule && matched < (rule.minWords ?? 2) ? 1 : 0;
      const gap = rule ? (Number.isFinite(rule.gap) ? rule.gap : 0) : offGap;
      cands.set(o.h.code, { item: offItem(o.h, score), score, rankScore: score - gap, tier, vn: o.h.vn === true, src: 1, order: order++ });
    }
  }
  return guard([...cands.values()]
    .sort((a, b) => a.tier - b.tier || b.rankScore - a.rankScore || (b.vn - a.vn) || a.src - b.src || a.order - b.order)
    .map((x) => ({ ...x.item, score: x.score })));
}
