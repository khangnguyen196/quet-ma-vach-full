// "Chụp mặt trước" (đợt chup-mat): tìm sản phẩm từ chữ đọc được bằng T1 (BM25 trên danh mục VN tĩnh).
// Không DOM, không import thư viện, không gọi mạng lúc nạp: T1 và danh mục chỉ tải khi người dùng dùng tính năng.
// MỘT bản T1 cho cả app và trang thử: public/chup-mat-do/t1.mjs, import động lúc chạy (Vite không gói vào bundle).
// MỘT bản danh mục: public/chup-mat-do/danh-muc-vn.json (dữ liệu Open Food Facts, ODbL).
// Các hàm tìm nhận module T1 (t1) làm tham số để test node truyền thẳng file public/chup-mat-do/t1.mjs.

// Viết thẳng import.meta.env.BASE_URL (không dùng ?.) để Vite chắc chắn thay bằng chuỗi base lúc build ("./" ở bản
// build, "/" khi dev). Chạy test bằng node (không qua Vite) thì không có import.meta.env → typeof kiểm trước → "/".
const APP_BASE = (typeof import.meta.env !== "undefined" && import.meta.env.BASE_URL) || "/";

/** Địa chỉ module T1 trong bản build / dev (vd "/quet-ma-vach-full/chup-mat-do/t1.mjs"). */
export function t1ModuleUrl(base = APP_BASE) {
  return base + "chup-mat-do/t1.mjs";
}

/** Địa chỉ danh mục sản phẩm VN tĩnh. */
export function catalogUrl(base = APP_BASE) {
  return base + "chup-mat-do/danh-muc-vn.json";
}

/**
 * Địa chỉ đầy đủ tính theo TRANG (page = document.baseURI). Cần vì bản build có base "./" (BASE_URL = "./"):
 * fetch() tính đường tương đối theo trang, nhưng import() tính theo file JS đang chạy (assets/…), nên
 * import("./chup-mat-do/t1.mjs") sẽ thành assets/chup-mat-do/t1.mjs (không có). Không có trang (node) → giữ nguyên.
 * Ví dụ: pageUrl("./chup-mat-do/t1.mjs", "https://x.github.io/app/") → "https://x.github.io/app/chup-mat-do/t1.mjs"
 */
export function pageUrl(url, page) {
  if (!page) return url;
  try {
    return new URL(url, page).href;
  } catch {
    return url;
  }
}

/** Nạp module T1 (import động, Vite không đụng vào), địa chỉ tính theo trang. Trình duyệt tự giữ module đã nạp. */
export function loadT1(url = t1ModuleUrl()) {
  return import(/* @vite-ignore */ pageUrl(url, globalThis.document?.baseURI));
}

const catalogCache = new Map(); // địa chỉ → promise

/**
 * Tải danh mục (lười: chỉ khi gọi lần đầu), giữ promise cho các lần sau; lỗi thì xóa để lần sau tải lại.
 * Kiểm dạng: object có meta (object) + products (mảng). Trả { meta, products }.
 */
export function loadCatalog(fetchImpl = globalThis.fetch, url = catalogUrl()) {
  if (catalogCache.has(url)) return catalogCache.get(url);
  const p = (async () => {
    let res;
    try {
      res = await fetchImpl(url);
    } catch {
      throw new Error("Không tải được danh mục sản phẩm (mất mạng?). Thử lại.");
    }
    if (!res.ok) throw new Error(`Không tải được danh mục sản phẩm (HTTP ${res.status}). Thử lại.`);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error("Danh mục sản phẩm không đúng dạng.");
    }
    const okShape = body && typeof body === "object" && !Array.isArray(body)
      && body.meta && typeof body.meta === "object" && Array.isArray(body.products);
    if (!okShape) throw new Error("Danh mục sản phẩm không đúng dạng.");
    return { meta: body.meta, products: body.products };
  })();
  catalogCache.set(url, p);
  p.catch(() => { if (catalogCache.get(url) === p) catalogCache.delete(url); });
  return p;
}

/** Tìm từ danh sách dòng { text, conf }: câu tìm T1 rồi BM25 (câu rỗng thì không tìm). */
function searchLines(t1, index, lines, k) {
  const query = t1.t1QueryFromLines(lines);
  const hits = query.length ? t1.bm25Search(index, query, k) : [];
  return { lines: lines.map((l) => l.text), query, hits };
}

/**
 * Khung chữ máy chủ OCR (items: [{ text, poly, score }]) → gợi ý. ĐÚNG đường (B) của server/do-30-anh.mjs:
 * ocrItems([{ items }]) → rowLineInfo → t1QueryFromLines → bm25Search.
 * Trả { lines: chữ từng hàng (hiện trong ô cho người dùng sửa), query: các từ tìm, hits: [{ code, score, i }] }.
 */
export function suggestFromItems(t1, index, items, k = 5) {
  const rows = t1.rowLineInfo(t1.ocrItems([{ items: Array.isArray(items) ? items : [] }]));
  return searchLines(t1, index, rows, k);
}

/**
 * Chữ người dùng sửa trong ô → gợi ý: mỗi dòng không trống = 1 dòng { text, conf: null } (không còn độ tin của OCR,
 * nên dòng OCR kém tin mà người dùng giữ lại cũng được tìm).
 */
export function suggestFromText(t1, index, text, k = 5) {
  const lines = (typeof text === "string" ? text : "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ text: s, conf: null }));
  return searchLines(t1, index, lines, k);
}

const IMAGE_SIZES = [100, 200, 400];

/**
 * Ảnh mặt trước nhỏ trên Open Food Facts từ mã + trường img của danh mục (vd "front_vi.10" = khóa ảnh.rev).
 * Đường theo mã: đệm 0 cho đủ 13 số rồi chia 3/3/3/4 (đã đối chiếu image_front_small_url thật với mã 8 số và
 * mã 13 số, kể cả mã bắt đầu bằng 0). Mã dài khác (9–12, 14 số) chưa đối chiếu → "".
 * Không chắc → "" (giao diện hiện "chưa có ảnh"). Ví dụ:
 * frontImageUrl("31698085", "front_fr.3") → "https://images.openfoodfacts.org/images/products/000/003/169/8085/front_fr.3.200.jpg"
 */
export function frontImageUrl(code, img, size = 200) {
  if (typeof code !== "string" || !/^(\d{8}|\d{13})$/.test(code)) return "";
  if (typeof img !== "string" || !/^front_[a-z]{2,3}\.\d{1,6}$/.test(img)) return "";
  if (!IMAGE_SIZES.includes(size)) return "";
  const p = code.padStart(13, "0");
  return `https://images.openfoodfacts.org/images/products/${p.slice(0, 3)}/${p.slice(3, 6)}/${p.slice(6, 9)}/${p.slice(9)}/${img}.${size}.jpg`;
}

/**
 * Gợi ý (hits của bm25Search) → [{ code, name, brand, image }] để hiển thị, theo vị trí i trong danh mục.
 * Hit không khớp danh mục (i sai, mã khác) thì bỏ. image "" = chưa có ảnh. Chữ phải đặt bằng textContent / esc().
 */
export function hitProducts(products, hits) {
  const out = [];
  for (const h of hits || []) {
    const p = Array.isArray(products) ? products[h?.i] : null;
    if (!p || p.code !== h.code) continue;
    out.push({ code: p.code, name: String(p.name ?? ""), brand: String(p.brand ?? ""), image: frontImageUrl(p.code, p.img) });
  }
  return out;
}
