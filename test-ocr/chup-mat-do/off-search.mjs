// Gọi Open Food Facts (OFF) cho đợt chup-mat-do: tìm theo chữ, đọc sản phẩm, lấy danh sách thương hiệu VN.
// Chạy trong Node (vòng 6 dùng lại logic dựng URL / đọc kết quả cho trang thử).
//
// Luật lịch sự (prompt vòng 1):
//  - app_name / app_version giống src/off.js, KHÔNG thêm header.
//  - Cache đĩa theo khóa truy vấn (mặc định D:\tmp\chup-mat-do\cache-off), không gọi lặp truy vấn đã có.
//  - Tìm kiếm ≤ 10 lượt / phút (giãn ≥ 6 giây giữa 2 lượt tìm). Đọc sản phẩm giãn ≥ 1 giây.
//  - Lỗi 429 / 5xx (hoặc lỗi mạng): thử lại tối đa 1 lần sau ≥ 30 giây.
//  - Lọc Việt Nam, lấy 5 kết quả đầu; có lọc mà 0 kết quả thì tìm 1 lần không lọc (ghi lại).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const APP_NAME = "quet-ma-vach-full"; // giống src/off.js
export const APP_VERSION = "0.1.0"; // giống src/off.js
export const DEFAULT_CACHE_DIR = "D:\\tmp\\chup-mat-do\\cache-off";
export const SEARCH_GAP_MS = 6000; // 60 giây / 10 lượt
export const PRODUCT_GAP_MS = 1000;
export const RETRY_WAIT_MS = 30000;
export const PAGE_SIZE = 5;
// Cầu dao: BREAKER_FAILS lần hỏng liền nhau (lỗi mạng / 429 / 5xx) thì nghỉ BREAKER_PAUSE_MS; sau khi nghỉ mà lại
// hỏng BREAKER_FAILS lần liền thì ngừng hẳn (lỗi có cờ breakerOpen), script ghi trạng thái + các mã chưa tìm.
export const BREAKER_FAILS = 5;
export const BREAKER_PAUSE_MS = 10 * 60 * 1000;

/** Lỗi khi cầu dao đã ngừng hẳn. */
export function breakerError(detail) {
  const e = new Error(`OFF hỏng ${BREAKER_FAILS} lần liền nhau sau khi đã nghỉ: ngừng gọi OFF (${detail})`);
  e.breakerOpen = true;
  return e;
}
// Kiểu tìm mặc định: cgi/search.pl (có CORS khi trả 200, lọc VN được, tìm theo chữ). search-a-licious không có
// header CORS cho trang ngoài OFF (kiểm 07/11/2026, xem cors-check.mjs), chỉ dùng tham khảo trong Node.
export const DEFAULT_KIND = "searchpl";
const FIELDS = "code,product_name,product_name_vi,brands";

const appParams = () => `app_name=${encodeURIComponent(APP_NAME)}&app_version=${encodeURIComponent(APP_VERSION)}`;

/** URL tìm theo chữ. kind:
 *  - "searchalicious": search.openfoodfacts.org/search (Elasticsearch), lọc VN bằng countries_tags trong q.
 *  - "searchpl": world.openfoodfacts.org/cgi/search.pl (search_terms, json=1), lọc VN bằng tagtype_0.
 *  - "apiv2": /api/v2/search — CHỈ lọc nhãn, không tìm chữ (terms bị bỏ qua), chỉ để kiểm CORS. */
export function searchUrl(kind, terms, { vn = true, pageSize = PAGE_SIZE } = {}) {
  const t = String(terms ?? "").trim();
  if (kind === "searchalicious") {
    const q = vn ? `${t} countries_tags:"en:vietnam"`.trim() : t;
    return `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=${pageSize}` +
      `&fields=${FIELDS}&langs=vi,en&${appParams()}`;
  }
  if (kind === "searchpl") {
    const filter = vn ? "&tagtype_0=countries&tag_contains_0=contains&tag_0=en%3Avietnam" : "";
    return `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(t)}&search_simple=1&action=process` +
      `${filter}&json=1&page_size=${pageSize}&fields=${FIELDS}&${appParams()}`;
  }
  if (kind === "apiv2") {
    return `https://world.openfoodfacts.org/api/v2/search?${vn ? "countries_tags_en=vietnam&" : ""}page_size=${pageSize}` +
      `&fields=${FIELDS}&${appParams()}`;
  }
  throw new Error(`Không biết kiểu tìm ${kind}`);
}

/** URL đọc một sản phẩm (API v2), chỉ lấy các trường cần. */
export function productUrl(code, fields = "code,product_name,product_name_vi,brands,images,selected_images,image_front_url") {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}&${appParams()}`;
}

/** URL danh sách thương hiệu của sản phẩm bán ở Việt Nam (facet của OFF, JSON). */
export function vnBrandsUrl() {
  return `https://world.openfoodfacts.org/facets/countries/vietnam/brands.json?${appParams()}`;
}

/** Trang `page` (100 sản phẩm) của /api/v2/search lọc VN, chỉ trường brands (lấy danh sách thương hiệu cho S3). */
export function vnBrandsSearchUrl(page) {
  return `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=vietnam&fields=brands&page_size=100&page=${page}&${appParams()}`;
}

function brandsString(b) {
  if (Array.isArray(b)) return b.join(", ");
  return b == null ? "" : String(b);
}

/** Đọc kết quả tìm về dạng chung [{ code, name, brands }], tối đa pageSize. */
export function parseHits(kind, json, pageSize = PAGE_SIZE) {
  const raw = kind === "searchalicious" ? json?.hits : json?.products;
  return (Array.isArray(raw) ? raw : []).slice(0, pageSize).map((p) => ({
    code: String(p.code ?? ""),
    name: p.product_name_vi || p.product_name || "",
    brands: brandsString(p.brands),
  }));
}

/** Tên file cache cho một khóa. */
export function cacheFile(dir, key) {
  return path.join(dir, crypto.createHash("sha1").update(key).digest("hex") + ".json");
}

/** Bộ giãn cách: mỗi lần wait() chờ cho đủ gapMs kể từ lần trước. now / sleep đưa vào để test được. */
export function makeLimiter(gapMs, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -Infinity;
  return {
    async wait() {
      const due = last + gapMs - now();
      if (due > 0) await sleep(due);
      last = now();
    },
  };
}

/** Tạo client. fetchImpl / now / sleep đưa vào được để test không gọi mạng. */
export function createOffClient({
  fetchImpl = globalThis.fetch,
  cacheDir = DEFAULT_CACHE_DIR,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  searchGapMs = SEARCH_GAP_MS,
  productGapMs = PRODUCT_GAP_MS,
  retryWaitMs = RETRY_WAIT_MS,
  breakerFails = BREAKER_FAILS,
  breakerPauseMs = BREAKER_PAUSE_MS,
  log = () => {},
  // dùng chung bộ giãn cách + bộ đếm với client khác (vd 1 client gọi từ trình duyệt, 1 client gọi từ Node):
  // tổng lượt tìm của cả 2 vẫn ≤ 10 / phút
  shareWith = null,
} = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const limiters = shareWith ? shareWith.limiters : {
    search: makeLimiter(searchGapMs, { now, sleep }),
    product: makeLimiter(productGapMs, { now, sleep }),
  };
  const stats = shareWith ? shareWith.stats : {
    search: 0, product: 0, other: 0, cacheHits: 0, http429or5xx: 0, networkErrors: 0, retries: 0, failures: 0, vnFallback: 0,
    breakerTrips: 0,
  };
  // trạng thái cầu dao (dùng chung khi shareWith)
  const breaker = shareWith ? shareWith.breaker : { streak: 0, open: false, last: "" };

  /** Ghi một lần hỏng (lỗi mạng / 429 / 5xx); đủ breakerFails lần liền thì nghỉ, lần thứ 2 thì ngừng hẳn. */
  async function noteFailure(msg) {
    breaker.streak++;
    breaker.last = msg;
    if (breaker.streak < breakerFails) return;
    stats.breakerTrips++;
    breaker.streak = 0;
    if (stats.breakerTrips >= 2) {
      breaker.open = true;
      log(`  CẦU DAO NGỪNG HẲN: ${msg}`);
      throw breakerError(msg);
    }
    log(`  cầu dao: ${breakerFails} lần hỏng liền nhau (${msg}), nghỉ ${breakerPauseMs / 60000} phút`);
    await sleep(breakerPauseMs);
  }

  /** GET có cache. cls: "search" | "product" | "other" (other dùng bộ giãn của search). */
  async function cachedGet(url, cls) {
    // khóa cache: URL bỏ app_name / app_version (đổi phiên bản không làm mất cache)
    const key = url.replace(/[?&]app_name=[^&]*/, "").replace(/[?&]app_version=[^&]*/, "");
    const file = cacheFile(cacheDir, key);
    if (fs.existsSync(file)) {
      stats.cacheHits++;
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      // seconds = thời gian mạng của lần gọi thật lúc lưu cache (cache cũ không có -> null)
      return { data: c.data, cached: true, seconds: c.seconds ?? null };
    }
    const limiter = cls === "product" ? limiters.product : limiters.search;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (breaker.open) throw breakerError(breaker.last);
      if (attempt === 1) {
        stats.retries++;
        log(`  thử lại sau ${retryWaitMs / 1000} giây: ${lastErr}`);
        await sleep(retryWaitMs);
      }
      await limiter.wait();
      stats[cls]++;
      const t0 = now();
      let res;
      try {
        res = await fetchImpl(url);
      } catch (e) {
        stats.networkErrors++;
        lastErr = `lỗi mạng: ${e?.message || e}`;
        await noteFailure(lastErr);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        stats.http429or5xx++;
        lastErr = `HTTP ${res.status}`;
        await noteFailure(lastErr);
        continue;
      }
      breaker.streak = 0;
      if (!res.ok && res.status !== 404) {
        stats.failures++;
        throw new Error(`OFF trả HTTP ${res.status} cho ${key}`);
      }
      const data = res.status === 404 ? null : await res.json();
      const seconds = (now() - t0) / 1000;
      fs.writeFileSync(file, JSON.stringify({ key, status: res.status, at: new Date(now()).toISOString(), seconds, data }), "utf8");
      return { data, cached: false, seconds };
    }
    stats.failures++;
    throw new Error(`OFF lỗi sau 1 lần thử lại (${lastErr}): ${key}`);
  }

  /** Tìm theo chữ, lọc VN; 0 kết quả thì tìm 1 lần không lọc.
   *  Trả { hits, vnFallback, cached, seconds (thời gian mạng, không tính lúc chờ giãn cách), queries }. */
  async function search(terms, { kind = DEFAULT_KIND } = {}) {
    const t = String(terms ?? "").trim();
    if (!t) return { hits: [], vnFallback: false, cached: true, seconds: 0, queries: [] };
    const queries = [];
    const a = await cachedGet(searchUrl(kind, t, { vn: true }), "search");
    queries.push({ vn: true, cached: a.cached });
    let hits = parseHits(kind, a.data);
    let seconds = a.seconds;
    let cached = a.cached;
    let vnFallback = false;
    if (!hits.length) {
      vnFallback = true;
      stats.vnFallback++;
      const b = await cachedGet(searchUrl(kind, t, { vn: false }), "search");
      queries.push({ vn: false, cached: b.cached });
      hits = parseHits(kind, b.data);
      seconds = seconds == null || b.seconds == null ? null : seconds + b.seconds;
      cached = cached && b.cached;
    }
    return { hits, vnFallback, cached, seconds, queries };
  }

  async function product(code, fields) {
    const r = await cachedGet(productUrl(code, fields), "product");
    return { product: r.data?.product ?? null, status: r.data?.status ?? null, cached: r.cached };
  }

  /** Danh sách tên thương hiệu của sản phẩm bán ở VN (có cache).
   *  Cách 1: facet brands (1 lượt). Facet lỗi (07/11/2026 OFF trả 503 liên tục) thì cách 2: /api/v2/search lọc VN,
   *  chỉ lấy trường brands, tối đa `pages` trang × 100 sản phẩm (không dùng truth.csv). Trả { brands, source }. */
  async function vnBrands({ pages = 3 } = {}) {
    try {
      const r = await cachedGet(vnBrandsUrl(), "other");
      const tags = Array.isArray(r.data?.tags) ? r.data.tags : [];
      const brands = tags.map((t) => t.name).filter(Boolean);
      if (brands.length) return { brands, source: "facet brands" };
    } catch (e) {
      log(`  facet thương hiệu lỗi: ${e.message || e}; lấy từ /api/v2/search`);
    }
    const set = new Set();
    let got = 0;
    for (let page = 1; page <= pages; page++) {
      let r;
      try {
        r = await cachedGet(vnBrandsSearchUrl(page), "search");
      } catch (e) {
        // trang sau lỗi: giữ các trang đã đọc được; chưa đọc được trang nào thì báo lỗi
        if (!got) throw e;
        log(`  trang ${page} lỗi, dùng ${got} trang đã có: ${e.message || e}`);
        return { brands: [...set], source: `/api/v2/search lọc VN, ${got} trang × 100 (trang ${page} lỗi)` };
      }
      got++;
      const products = Array.isArray(r.data?.products) ? r.data.products : [];
      for (const p of products) for (const b of String(p.brands ?? "").split(",")) if (b.trim()) set.add(b.trim());
      if (products.length < 100) break;
    }
    return { brands: [...set], source: `/api/v2/search lọc VN, ${pages} trang × 100` };
  }

  return { search, product, vnBrands, cachedGet, stats, limiters, breaker };
}
