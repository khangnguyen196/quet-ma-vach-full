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
//   offPromote { gap, minWords } | null (vòng 6, V4-2, chỉ f1): SAU lớp chặn, ứng viên chỉ có trên OFF (không phải mục
//               kho phụ extra: true) điểm cao nhất trong những ứng viên khớp ≥ minWords từ khác nhau; điểm ≥ điểm gợi ý 1
//               của T1 + gap → vị trí 1 (tính vào offMax), các mục khác lùi giữ thứ tự. null = tắt (mặc định).
//   strangeFill (vòng 6, P2, chỉ f1; mặc định theo STRANGE_MODE của off-search.js = tắt): ứng viên OFF khớp 0 từ câu
//               tìm T1 nhưng chứa từ lạ của ảnh (strangeWords) → hạng 2 (sau mọi mục danh mục, chỉ lấp chỗ trống).
//   Mặc định DEFAULT_GUARD (chọn ở vòng 3 theo luật P3e, xem comment ở đó); { lockTop: 0, offMax: k, offGap: 0 } = không chặn.
//   Giá trị sai (null, NaN, Infinity, số âm / lẻ, chuỗi) → báo lỗi (vòng 4), không bao giờ lặng lẽ tắt lớp chặn.
//
// Ví dụ:
//   const r = rankFromItems(t1, rIndex, items);                         // T1 (src/front-rank.js)
//   const off = await offSearch.search(q);                               // { ok, hits: [{ code, name, brand, img, vn, text }] }
//   mergeFront(t1, rIndex, catalog.products, r, off)                     // [{ code, name, brand, img, source, vn, score }]
import { frontImageUrl } from "./front-search.js";
import { STRANGE_MODE, strangeWords } from "./off-search.js";

export const MERGE_K = 5;
export const MERGE_METHODS = Object.freeze(["f1", "f2", "f3"]);
/**
 * Lớp chặn mặc định (vòng 3, chọn theo luật P3e chốt trước, test-ocr/chup-mat-do/tu-dong-chan-do.mjs, chỉ cache OFF):
 * lockTop 3 + offMax 1 + offGap 1 (f1). Số đo (bộ B, 30 ảnh): OFF thật 14/21 như T1, 0 ảnh mất (F1 không chặn mất
 * 8936017367107: 3 → ngoài 5); OFF giả xấu nhất 0 ảnh mất vị trí 1, 1 ảnh rơi khỏi 5 (F1 không chặn: 14 / 18);
 * 7Up chữ máy chủ + câu gõ: 8934588752117 vị trí 4, 7Up hương chanh vị trí 1, câu gõ 7Up vị trí 2; bỏ-một-ra 0/0 ở mọi
 * cách (OFF không trả sản phẩm đúng cho ảnh nào). OFF chỉ trả được ~1/2 số câu hôm đo nên số đo còn mỏng.
 * offPromote null (vòng 6, V4-2, test-ocr/chup-mat-do/tu-dong-v42-do.mjs, luật chốt trước): 6 cách gap {1,2,3} ×
 * minWords {2,3} đều 0 ảnh mất / rơi ở bộ B và A, (i) giống hệt mốc, đưa 8934588752117 lên vị trí 1 ở 2 ca 7Up khi OFF
 * trả được, nhưng KHÔNG giữ vì độ phủ cache bộ B chỉ 21/30 ảnh đủ câu (< 24, OFF lỗi 58,8 % lượt vòng 6); OFF giả xấu
 * nhất (chỉ báo) bộ B mất vị trí 1 ở 10–11 / 14 ảnh.
 */
export const DEFAULT_GUARD = Object.freeze({ lockTop: 3, offMax: 1, offGap: 1, offTopRule: null, offPromote: null });
export const RRF_K = 60;

/** Lỗi "giá trị chặn sai" (vòng 5, gợi ý 3 vòng 4): main.js chỉ quay về kết quả T1 với đúng loại lỗi này, lỗi khác
 *  (lỗi lập trình thật) ném tiếp. */
export class GuardValueError extends Error {
  constructor(message) {
    super(message);
    this.name = "GuardValueError";
  }
}
/** e có phải lỗi giá trị chặn sai của mergeFront không. Ví dụ: try { mergeFront(…) } catch (e) { if (!isGuardError(e)) throw e; } */
export function isGuardError(e) {
  return e instanceof GuardValueError;
}
/** Số kết quả đầu của mỗi nguồn đưa vào RRF (f2). */
export const RRF_DEPTH = 5;

/** Mục hiển thị từ sản phẩm danh mục. */
function catalogItem(p, score = null) {
  return { code: p.code, name: String(p.name ?? ""), brand: String(p.brand ?? ""), img: frontImageUrl(p.code, p.img), source: "catalog", vn: true, score };
}

/** Mục hiển thị từ ứng viên OFF (đã lọc ở parseSearch: mã 8–14 số, ảnh images.openfoodfacts.org). Mục kho phụ
 *  (src/front-extra.js, hit.extra === true) giữ cờ extra: true (vòng 7); mục OFF thường KHÔNG có khóa extra (dạng cũ). */
function offItem(h, score = null) {
  const it = { code: h.code, name: String(h.name ?? ""), brand: String(h.brand ?? ""), img: String(h.img ?? ""), source: "off", vn: h.vn === true, score };
  if (h.extra === true) it.extra = true;
  return it;
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

/**
 * Gộp kết quả các câu tìm OFF của MỘT ảnh (mỗi câu 1 lượt search(), vòng 4 tu-dong: như runOff của khung đo
 * test-ocr/chup-mat-do/tu-dong-do.mjs): nối hits theo thứ tự câu, bỏ mã trùng. ≥ 1 câu trả được → { ok: true, hits };
 * mọi câu lỗi → { ok: false, kind của câu lỗi đầu }; không có câu nào → { ok: false, kind: "none" } (không gọi mạng).
 */
export function joinOffResults(results) {
  const list = Array.isArray(results) ? results.filter((r) => r && typeof r === "object") : [];
  if (!list.length) return { ok: false, kind: "none" };
  const oks = list.filter((r) => r.ok === true);
  if (!oks.length) return { ok: false, kind: String(list[0].kind ?? "network") };
  const hits = [];
  const seen = new Set();
  for (const r of oks) for (const h of Array.isArray(r.hits) ? r.hits : []) {
    if (!h || typeof h.code !== "string" || seen.has(h.code)) continue;
    seen.add(h.code);
    hits.push(h);
  }
  return { ok: true, hits };
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
  const lock = base.slice(0, Math.min(lockTop, base.length));
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
 * opts: { method: "f1" | "f2" | "f3", k, offGap, minMatch, rrfK, rrfDepth, lockTop, offMax, offTopRule, offPromote, strangeFill }
 * (offPromote / strangeFill sai → GuardValueError; f2 / f3 bỏ qua offPromote / strangeFill)
 * Mục ra từ kho phụ (hit.extra === true) có thêm extra: true (vòng 7); giao diện vẽ như mục OFF.
 * (lockTop / offMax / offGap / offTopRule thiếu thì lấy DEFAULT_GUARD; lockTop / offMax / offGap không phải số nguyên
 * ≥ 0 thì báo lỗi, không tự tắt lớp chặn).
 */
export function mergeFront(t1, rIndex, products, t1Result, offResult, opts = {}) {
  const {
    method = "f1", k = MERGE_K, offGap = DEFAULT_GUARD.offGap, minMatch = 1, rrfK = RRF_K, rrfDepth = RRF_DEPTH,
    lockTop = DEFAULT_GUARD.lockTop, offMax = DEFAULT_GUARD.offMax, offTopRule = DEFAULT_GUARD.offTopRule,
    offPromote = DEFAULT_GUARD.offPromote, strangeFill = STRANGE_MODE !== null,
  } = opts;
  if (!MERGE_METHODS.includes(method)) throw new Error(`front-merge: cách gộp không hỗ trợ: ${method}`);
  const promote = checkPromote(offPromote);
  // Vòng 7 (gợi ý 3 reviewer vòng 6): strangeFill phải đúng boolean (như offPromote: sai → GuardValueError, không tự
  // hiểu "x1" / 1 là bật hay null là tắt).
  if (typeof strangeFill !== "boolean") {
    throw new GuardValueError(`front-merge: strangeFill phải là true hoặc false (nhận ${typeof strangeFill === "string" ? JSON.stringify(strangeFill) : String(strangeFill)})`);
  }
  // Vòng 4: giá trị chặn sai (null, NaN, Infinity, số âm, số lẻ, chuỗi…) → báo lỗi ngay, kể cả khi OFF lỗi. Trước đây
  // null / NaN làm lớp chặn tự TẮT (lockTop | 0 = 0, offMax null = không giới hạn). Chọn báo lỗi thay vì lặng lẽ dùng
  // mặc định: truyền sai là lỗi lập trình, test phải thấy ngay; app gọi không truyền (undefined = DEFAULT_GUARD).
  for (const [name, v] of [["lockTop", lockTop], ["offMax", offMax], ["offGap", offGap]]) {
    if (!Number.isInteger(v) || v < 0) throw new GuardValueError(`front-merge: ${name} phải là số nguyên ≥ 0 (nhận ${typeof v === "string" ? JSON.stringify(v) : String(v)})`);
  }
  const list = Array.isArray(products) ? products : [];
  const base = t1Items(list, t1Result, k);
  if (!okOff(offResult)) return base;
  const guard = (ranked) => applyGuard(ranked, base, { k, lockTop, offMax });

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
  // vòng 6 (P2): từ lạ của ảnh (chỉ khi strangeFill bật)
  const strange = strangeFill ? strangeWords(Array.isArray(t1Result?.lines) ? t1Result.lines : [], { idf: index.idf }) : [];
  // code → { item, score, rankScore, tier, vn, src: 0 T1 / 1 OFF, order, matched, extra }
  const cands = new Map();
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
      const extra = o.h.extra === true; // mục kho phụ (src/front-extra.js): không offPromote, không luật từ lạ
      const doc = offDoc(t1, o.h.text || `${o.h.name ?? ""} ${o.h.brand ?? ""}`);
      const { score, matched } = bm25DocScore(index, doc, query);
      if (matched < Math.max(1, minMatch)) {
        // P2: khớp 0 từ câu tìm T1 nhưng chứa từ lạ → hạng 2 (sau mọi mục danh mục, chỉ lấp chỗ trống, vẫn qua offMax)
        if (matched === 0 && !extra && strange.some((w) => doc.m.has(w))) {
          cands.set(o.h.code, { item: offItem(o.h, 0), score: 0, rankScore: 0, tier: 2, vn: o.h.vn === true, src: 1, order: order++, matched: 0, extra });
        }
        continue;
      }
      // offTopRule: không đạt (khớp < minWords) → hạng 1 (sau mọi mục danh mục); đạt → trừ gap rồi xếp chung
      const rule = offTopRule && typeof offTopRule === "object" ? offTopRule : null;
      const tier = rule && matched < (rule.minWords ?? 2) ? 1 : 0;
      const gap = rule ? (Number.isFinite(rule.gap) ? rule.gap : 0) : offGap;
      cands.set(o.h.code, { item: offItem(o.h, score), score, rankScore: score - gap, tier, vn: o.h.vn === true, src: 1, order: order++, matched, extra });
    }
  }
  const sorted = [...cands.values()]
    .sort((a, b) => a.tier - b.tier || b.rankScore - a.rankScore || (b.vn - a.vn) || a.src - b.src || a.order - b.order);
  const toItem = (x) => ({ ...x.item, score: x.score });

  // vòng 6 (P1, V4-2): offPromote — SAU lớp chặn: ứng viên chỉ có trên OFF (không phải kho phụ) điểm F1 cao nhất trong
  // những ứng viên khớp ≥ minWords từ khác nhau; điểm ≥ điểm gợi ý 1 của T1 + gap → vị trí 1, phần còn lại = lớp chặn
  // trên k − 1 chỗ với offMax − 1 (mục được đẩy tính vào offMax), các mục khác lùi giữ thứ tự.
  if (promote && offMax >= 1 && k >= 1) {
    const ref = base.length ? (cands.get(base[0].code)?.score ?? 0) : 0;
    let best = null;
    for (const c of sorted) if (c.src === 1 && !c.extra && c.matched >= promote.minWords && (!best || c.score > best.score)) best = c;
    if (best && best.score >= ref + promote.gap) {
      const rest = applyGuard(sorted.filter((c) => c !== best).map(toItem), base, { k: k - 1, lockTop, offMax: offMax - 1 });
      return [toItem(best), ...rest].slice(0, k);
    }
  }
  return guard(sorted.map(toItem));
}

/** offPromote hợp lệ: null, hoặc { gap: số hữu hạn ≥ 0, minWords: số nguyên ≥ 2 }; sai → GuardValueError. */
function checkPromote(p) {
  if (p === null) return null;
  const ok = p && typeof p === "object" && !Array.isArray(p)
    && typeof p.gap === "number" && Number.isFinite(p.gap) && p.gap >= 0
    && Number.isInteger(p.minWords) && p.minWords >= 2;
  if (!ok) {
    let shown;
    try { shown = typeof p === "object" && p ? JSON.stringify(p, (_, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v)) : String(p); } catch { shown = String(p); }
    throw new GuardValueError(`front-merge: offPromote phải là null hoặc { gap: số ≥ 0, minWords: số nguyên ≥ 2 } (nhận ${shown})`);
  }
  return { gap: p.gap, minWords: p.minWords };
}
