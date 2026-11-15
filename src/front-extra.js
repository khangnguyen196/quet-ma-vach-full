// "Chụp mặt trước" (đợt tu-dong vòng 6, P5): KHO PHỤ 893 cách C1 — phần thuần, CHƯA nối vào app (nối ở vòng 7).
// Kho phụ = sản phẩm Open Food Facts mã 13 số đầu 893 có tên nhưng CHƯA có trong danh mục chính (danh-muc-vn.json),
// file riêng public/chup-mat-do/kho-phu-893.json (sinh bằng test-ocr/chup-mat-do/xuat-kho-phu.mjs, dữ liệu ODbL), tải
// lười, không vào danh sách lưu sẵn của service worker. Danh mục chính + chỉ mục T1 giữ nguyên.
// Cách C1 (quyết định chủ dự án 15/11/2026): tìm trong kho phụ bằng BM25 với idf / độ dài trung bình của chỉ mục CHÍNH
// (như ứng viên chỉ có trên OFF), rồi nối SAU kết quả OFF và đưa qua mergeFront: mục kho phụ dùng CHUNG chỗ offMax với
// OFF, không vào lockTop vị trí đầu, không bao giờ được offPromote đẩy lên vị trí 1 (cờ extra: true).
// Không DOM ở cấp module, không import thư viện, không gọi mạng lúc nạp.
//
// Ví dụ (vòng 7 nối):
//   const store = await loadExtra();                                    // { meta, products }
//   const xi = buildExtraIndex(t1, store.products);                      // một lần
//   const ex = searchExtra(rIndex.index, xi, found);                     // found = rankFromItems / rankFromText
//   mergeFront(t1, rIndex, products, found, joinExtra(off, ex));         // off = joinOffResults(…) hoặc lỗi
import { bm25DocScore, offDoc, mergeFront, isGuardError } from "./front-merge.js";
import { frontImageUrl } from "./front-search.js";

// Như front-search.js: viết thẳng import.meta.env.BASE_URL để Vite thay lúc build; node (test) không có → "/".
const APP_BASE = (typeof import.meta.env !== "undefined" && import.meta.env.BASE_URL) || "/";

/** Số ứng viên kho phụ tối đa đưa vào gộp (bằng page_size của câu tìm OFF trong app, như đo vòng 5). */
export const EXTRA_LIMIT = 24;

/** Địa chỉ kho phụ (theo cách catalogUrl). */
export function extraUrl(base = APP_BASE) {
  return base + "chup-mat-do/kho-phu-893.json";
}

const extraCache = new Map(); // địa chỉ → promise

/**
 * Tải kho phụ (lười: chỉ khi gọi), giữ promise cho các lần sau; lỗi thì xóa để lần sau tải lại (như loadCatalog).
 * Kiểm dạng: object có meta (object) + products (mảng). Trả { meta, products }.
 */
export function loadExtra(fetchImpl = globalThis.fetch, url = extraUrl()) {
  if (extraCache.has(url)) return extraCache.get(url);
  const p = (async () => {
    let res;
    try {
      res = await fetchImpl(url);
    } catch {
      throw new Error("Không tải được kho sản phẩm phụ (mất mạng?).");
    }
    if (!res || !res.ok) throw new Error(`Không tải được kho sản phẩm phụ (HTTP ${res?.status}).`);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error("Kho sản phẩm phụ không đúng dạng.");
    }
    const okShape = body && typeof body === "object" && !Array.isArray(body)
      && body.meta && typeof body.meta === "object" && Array.isArray(body.products);
    if (!okShape) throw new Error("Kho sản phẩm phụ không đúng dạng.");
    return { meta: body.meta, products: body.products };
  })();
  extraCache.set(url, p);
  p.catch(() => { if (extraCache.get(url) === p) extraCache.delete(url); });
  return p;
}

/**
 * Chỉ mục kho phụ: mỗi sản phẩm { doc: tài liệu BM25 tách từ như ứng viên OFF (offDoc), hit: mục ứng viên cho mergeFront
 * { code, name, brand, img (URL ảnh mặt trước, "" nếu không chắc), vn: false, text, extra: true } }. Tính một lần.
 * Mục hỏng (không có mã / chữ) bị bỏ.
 */
export function buildExtraIndex(t1, products) {
  const out = [];
  for (const p of Array.isArray(products) ? products : []) {
    if (!p || typeof p.code !== "string" || typeof p.text !== "string") continue;
    out.push({
      doc: offDoc(t1, p.text),
      hit: { code: p.code, name: String(p.name ?? ""), brand: String(p.brand ?? ""), img: frontImageUrl(p.code, p.img), vn: false, text: p.text, extra: true },
    });
  }
  return out;
}

/**
 * Tìm trong kho phụ cho một kết quả T1 (found: rankFromItems hoặc rankFromText — "Tìm lại" dùng được): chấm
 * bm25DocScore với chỉ mục CHÍNH (index = rIndex.index) theo câu tìm T1, giữ mục khớp ≥ 1 từ, điểm giảm dần (hòa: thứ
 * tự kho), tối đa limit. Trả bản sao các hit. Câu tìm rỗng → [].
 */
export function searchExtra(index, xi, found, limit = EXTRA_LIMIT) {
  const q = Array.isArray(found?.query) ? found.query : [];
  if (!q.length || !Array.isArray(xi) || !xi.length) return [];
  const sc = [];
  xi.forEach((x, i) => {
    const { score, matched } = bm25DocScore(index, x.doc, q);
    if (matched >= 1) sc.push({ i, score });
  });
  return sc.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((s) => ({ ...xi[s.i].hit }));
}

/**
 * Nối kết quả OFF (offResult: { ok, hits } hoặc lỗi / null) với hit kho phụ → offResult cho mergeFront: hits OFF trước,
 * kho phụ sau, bỏ mã trùng (giữ bản đầu). Kho phụ rỗng / chưa có → offResult nguyên vẹn (OFF lỗi → null): kết quả GIỐNG
 * HỆT khi chưa có kho phụ. OFF lỗi + kho phụ có → { ok: true, hits: kho phụ }.
 */
export function joinExtra(offResult, extraHits) {
  const ex = Array.isArray(extraHits) ? extraHits.filter((h) => h && typeof h.code === "string") : [];
  const offOk = !!(offResult && offResult.ok === true && Array.isArray(offResult.hits));
  if (!ex.length) return offOk ? offResult : null;
  const hits = [];
  const seen = new Set();
  for (const h of [...(offOk ? offResult.hits : []), ...ex]) {
    if (!h || typeof h.code !== "string" || seen.has(h.code)) continue;
    seen.add(h.code);
    hits.push(h);
  }
  return { ok: true, hits };
}

/**
 * Vòng 7 (P1): hàm gộp DÙNG CHUNG cho app (main.js showPhotoResult) và khung đo cuối (tu-dong-cuoi-do.mjs), để số đo
 * "qua luồng app" là số của chính code app.
 * ctx = { t1, rIndex, products, xi } (xi = buildExtraIndex(…) hoặc null / undefined khi kho phụ chưa tải / lỗi / chậm);
 * found = rankFromItems / rankFromText; off = joinOffResults(…) của các câu tìm OFF ({ ok: false, kind: "none" } khi
 * không có câu nào).
 * opts.called: đã gọi mạng tìm OFF chưa (main.js: queries.length > 0); không truyền thì suy từ off (null / kind "none"
 * = không gọi). opts.merge: CHỈ cho test (mặc định mergeFront; app không truyền).
 * Trả { merged: tối đa 5 mục (mergeFront, lớp chặn mặc định), offFailed: đã gọi OFF mà không câu nào trả được (tính
 * trên off GỐC, không trên kết quả đã nối kho phụ) }.
 * xi null → merged GIỐNG HỆT mergeFront(…, off). Lỗi giá trị chặn (GuardValueError) → console.error rồi mergeFront(…,
 * null) = đúng kết quả T1 (như main.js vòng 5–6); lỗi khác ném tiếp.
 * Ví dụ: const { merged, offFailed } = photoMerge({ t1, rIndex, products, xi }, found, off, { called: true });
 */
export function photoMerge({ t1, rIndex, products, xi }, found, off, { called, merge = mergeFront } = {}) {
  const ex = xi ? searchExtra(rIndex.index, xi, found) : [];
  const didCall = typeof called === "boolean" ? called : !!(off && typeof off === "object" && off.kind !== "none");
  const offFailed = didCall && !(off && off.ok === true);
  let merged;
  try {
    merged = merge(t1, rIndex, products, found, joinExtra(off, ex)); // lớp chặn mặc định (không truyền tùy chọn)
  } catch (e) {
    if (!isGuardError(e)) throw e;
    console.error(e);
    merged = merge(t1, rIndex, products, found, null); // = đúng kết quả T1
  }
  return { merged, offFailed };
}
