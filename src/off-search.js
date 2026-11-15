// "Chụp mặt trước" (đợt tu-dong): tìm sản phẩm theo CHỮ trên toàn bộ Open Food Facts, gọi thẳng từ trình duyệt.
// Thuần: không DOM, không import thư viện, không gọi mạng lúc nạp. fetch, đồng hồ (now) và bộ lưu (localStorage)
// truyền vào được để test bằng máy chủ giả.
//
// Chọn API (đo 15/11/2026, test-ocr/chup-mat-do/tu-dong-cors.mjs, Playwright Chromium + WebKit từ trang 127.0.0.1):
// - cgi/search.pl (world.openfoodfacts.org): trả 200 thì có "Access-Control-Allow-Origin: *" (Chromium 15/11,
//   WebKit 07/11/2026), tìm theo chữ, "7up soda chanh" không lọc ra đúng 8934588752117 ở vị trí 1. Khi OFF quá tải
//   nó trả 503 KHÔNG kèm header CORS → trong trình duyệt thành lỗi mạng (TypeError), không đọc được mã 503.
// - search-a-licious (search.openfoodfacts.org): trả 200 nhưng KHÔNG có header CORS → trình duyệt chặn (cả 2).
// - /api/v2/search: không tìm theo chữ (chỉ lọc nhãn), hôm đo còn trả 503.
//
// Ví dụ:
//   const off = createOffSearch();                         // một bộ cho cả app (giới hạn lượt tính chung)
//   const qs = cleanQuery(["Up", "Soda chanh", "Khong calo"]);   // ["soda chanh", "up soda chanh"]
//   const r = await off.searchVnThenAll(qs[0], { signal });       // { ok: true, hits: [{ code, name, brand, img, vn }] }
//   if (!r.ok) { /* r.kind: network | timeout | rate | server | badJson | aborted | limited → dùng kết quả danh mục */ }

// Một nguồn với src/off.js (APP_NAME là tên repo; APP_VERSION khớp package.json).
import { APP_NAME, APP_VERSION } from "./off.js";

export const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";

/** Hết giờ một lượt tìm (ms): ngắn, vì đây là nguồn phụ; quá thì dùng kết quả danh mục. */
export const SEARCH_TIMEOUT_MS = 7000;
/** Tối đa 10 lượt gọi mạng trong 60 giây cho CẢ app (lượt lấy từ bộ nhớ đệm không tính). */
export const SEARCH_LIMIT_PER_MIN = 10;
export const SEARCH_WINDOW_MS = 60000;
/** Bộ nhớ đệm: giữ 1 ngày, tối đa 30 câu tìm (chỉ lưu mã, tên, thương hiệu, ảnh, cờ VN). */
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const SEARCH_CACHE_MAX = 30;
export const SEARCH_CACHE_KEY = "qmv-off-search";
export const SEARCH_PAGE_SIZE = 10;
export const SEARCH_FIELDS = "code,product_name,product_name_vi,product_name_en,brands,image_front_small_url,countries_tags";
const IMG_PREFIX = "https://images.openfoodfacts.org/";
const VN_FILTER = "&tagtype_0=countries&tag_contains_0=contains&tag_0=en%3Avietnam";

// ---------------------------------------------------------------------------
// Làm sạch chữ OCR → câu tìm
// ---------------------------------------------------------------------------

// Cụm chữ chung trên bao bì (đã bỏ dấu), không giúp tìm tên sản phẩm. Giống ý STOP_PHRASES của T1 (public/chup-mat-do/t1.mjs).
const STOP_PHRASES = [
  "khoi luong tinh", "khoi luong", "trong luong tinh", "trong luong", "the tich thuc", "the tich",
  "thanh phan", "net weight", "net wt", "net vol", "nha san xuat", "san xuat tai", "san xuat boi", "san xuat",
  "phan phoi boi", "phan phoi", "han su dung", "ngay san xuat", "xuat xu", "huong dan su dung", "huong dan",
  "bao quan", "made in", "viet nam", "vietnam", "san pham cua", "cong ty", "tnhh", "co phan", "thuc pham",
  "gia tri dinh duong", "nang luong", "khong chat bao quan", "hinh anh chi mang tinh chat minh hoa",
  "hinh anh minh hoa", "chi mang tinh chat minh hoa", "minh hoa",
];
const STOP_WORDS = new Set([
  "va", "cua", "cho", "voi", "tai", "tu", "co", "la", "mot", "cac", "nhung", "trong", "khong", "duoc", "hon",
  "the", "and", "of", "with", "for", "in", "new", "moi", "net", "wt", "vol", "approx",
  "g", "gr", "gam", "gram", "grams", "kg", "mg", "ml", "l", "lit", "cl", "oz", "kcal", "kj", "x",
  "nsx", "hsd", "exp", "mfg", "date", "lot", "www", "com", "vn", "http", "https",
  "goi", "hop", "chai", "lon", "tui", "thung", "pack", "sp",
]);
const UNIT = "(?:g|gr|gam|kg|mg|ml|l|lit|cl|oz|kcal|kj|x|goi|hop|cm|mm|m)";
const UNIT_WORD = new RegExp(`^${UNIT}$`);
const NUM_UNIT = new RegExp(`^\\d+${UNIT}$`);
/** Số câu tìm tối đa, số từ tối đa mỗi câu, độ dài tối đa (ký tự). */
export const QUERY_MAX = 3;
export const QUERY_WORDS_MAX = 4;
export const QUERY_CHARS_MAX = 60;

/** Bỏ dấu, viết thường, đ → d, ký tự không phải chữ / số thành dấu cách. */
function fold(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Từ vựng có từ w không (Set / Map / bất kỳ có has(); không có từ vựng → false). */
function inVocab(vocab, w) {
  try { return !!(vocab && typeof vocab.has === "function" && vocab.has(w)); } catch { return false; }
}

/**
 * Một dòng chữ → danh sách từ dùng được (đã bỏ dấu, bỏ cụm chung, số, đơn vị, từ nhiễu).
 * vocab (từ vựng danh mục, vd chỉ mục T1): "7 up" → "7up" CHỈ khi "7up" có trong vocab (không ghép "3 in", "24 lon",
 * "2 tui": từ sau là từ nhiễu / "in" thì không bao giờ ghép); từ toàn phụ âm (vd hãng "th") giữ khi có trong vocab.
 */
function lineWords(text, vocab) {
  let s = ` ${fold(text)} `;
  s = s.replace(/ co op /g, " coop ");
  s = s.replace(/ (\d{1,2}) ([a-z]{1,3})(?= )/g, (m, d, w) => (
    UNIT_WORD.test(w) || STOP_WORDS.has(w) || w === "in" || !inVocab(vocab, `${d}${w}`) ? m : ` ${d}${w}`
  ));
  for (let pass = 0; pass < 2; pass++) for (const p of STOP_PHRASES) s = s.split(` ${p} `).join(" ");
  return s.split(" ").filter((w) => {
    if (!w || STOP_WORDS.has(w)) return false;
    if (/^\d+$/.test(w) || NUM_UNIT.test(w)) return false;
    const letters = w.replace(/[^a-z]/g, "");
    if (letters.length < 2) return false;
    return /[aeiouy]/.test(letters) || /\d/.test(w) || inVocab(vocab, w);
  });
}

/** Câu tìm dùng được: không phải 1 từ dưới 5 chữ cái (vd "ca" khớp hàng nghìn sản phẩm, "7up" một mình). */
function okQuery(q) {
  const w = q.split(" ").filter(Boolean);
  return w.length > 1 || (w.length === 1 && w[0].replace(/[^a-z]/g, "").length >= 5);
}

function toLines(input) {
  if (typeof input === "string") return input.split(/\r?\n/);
  if (!Array.isArray(input)) return [];
  return input.map((x) => (typeof x === "string" ? x : x && typeof x.text === "string" ? x.text : ""));
}

function capWords(words) {
  const out = [];
  for (const w of words.slice(0, QUERY_WORDS_MAX)) {
    if ([...out, w].join(" ").length > QUERY_CHARS_MAX) break;
    out.push(w);
  }
  return out.join(" ");
}

/**
 * Chữ OCR (mảng dòng, mảng { text }, hoặc chuỗi nhiều dòng) → 1–3 câu tìm ngắn (không dấu, ≤ 4 từ), theo thứ tự thử:
 * 1. dòng dài nhất (nhiều chữ cái nhất) — thường là tên sản phẩm;
 * 2. từ "giống tên hãng" (dòng đầu tiên chỉ có 1–2 từ, khác dòng 1, giữ cả từ ngắn như "up") + 2 từ đầu của câu 1;
 * 3. dòng dài thứ hai (≥ 5 chữ cái);
 * 4. (nếu còn chỗ) 2 từ đầu của câu 1 khi câu 1 dài hơn 2 từ — câu rộng hơn, vì search.pl cần khớp MỌI từ.
 * Không có dòng dùng được → []. Câu chỉ 1 từ dưới 5 chữ cái bị bỏ. vocab: xem lineWords.
 */
export function cleanQuery(input, { vocab = null } = {}) {
  const lines = [];
  const seen = new Set();
  toLines(input).forEach((text, i) => {
    const words = lineWords(text, vocab);
    const key = words.join(" ");
    if (!words.length || seen.has(key)) return;
    seen.add(key);
    lines.push({ i, words, letters: words.join("").replace(/[^a-z]/g, "").length });
  });
  if (!lines.length) return [];
  const byLen = [...lines].sort((a, b) => b.letters - a.letters || a.i - b.i);
  const main = byLen[0];
  const cands = [capWords(main.words)];
  const brand = lines.find((l) => l !== main && l.words.length <= 2);
  if (brand) cands.push(capWords([...brand.words, ...main.words.slice(0, 2)]));
  const second = byLen.find((l) => l !== main && l !== brand && l.letters >= 5);
  if (second) cands.push(capWords(second.words));
  if (main.words.length > 2) cands.push(main.words.slice(0, 2).join(" "));
  return [...new Set(cands.filter((q) => q && okQuery(q)))].slice(0, QUERY_MAX);
}

// ---------------------------------------------------------------------------
// URL + đọc kết quả
// ---------------------------------------------------------------------------

/** URL tìm của cgi/search.pl. vn: chỉ sản phẩm có countries_tags en:vietnam. base đổi được (máy chủ giả khi test). */
export function searchUrl(terms, { vn = false, pageSize = SEARCH_PAGE_SIZE, base = OFF_SEARCH_URL } = {}) {
  const t = String(terms ?? "").trim();
  return `${base}?search_terms=${encodeURIComponent(t)}&search_simple=1&action=process${vn ? VN_FILTER : ""}`
    + `&json=1&page_size=${pageSize}&fields=${SEARCH_FIELDS}`
    + `&app_name=${encodeURIComponent(APP_NAME)}&app_version=${encodeURIComponent(APP_VERSION)}`;
}

/**
 * Thân JSON của search.pl → [{ code, name, brand, img, vn }]; thân sai dạng (không có mảng products) → null.
 * Bỏ mã không phải 8–14 chữ số (như gợi ý danh mục), bỏ mã trùng; img chỉ nhận URL images.openfoodfacts.org.
 */
export function parseSearch(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.products)) return null;
  const out = [];
  const seen = new Set();
  for (const p of json.products) {
    if (!p || typeof p !== "object") continue;
    const code = String(p.code ?? "").trim();
    if (!/^\d{8,14}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    const name = [p.product_name_vi, p.product_name, p.product_name_en].find((x) => typeof x === "string" && x.trim()) || "";
    const brand = Array.isArray(p.brands) ? p.brands.filter((b) => typeof b === "string" && b.trim()).map((b) => b.trim()).join(", ")
      : typeof p.brands === "string" ? p.brands.trim() : "";
    const img = typeof p.image_front_small_url === "string" && p.image_front_small_url.startsWith(IMG_PREFIX) ? p.image_front_small_url : "";
    const vn = Array.isArray(p.countries_tags) && p.countries_tags.includes("en:vietnam");
    out.push({ code, name: name.trim(), brand, img, vn });
  }
  return out;
}

/**
 * Lọc lại các mục đọc từ localStorage theo đúng luật parseSearch: mã 8–14 chữ số (bỏ mục hỏng, bỏ trùng),
 * name / brand phải là chuỗi (không thì ""), img chỉ URL images.openfoodfacts.org (không thì ""), vn chỉ true / false.
 * Không phải mảng → null.
 */
function cleanCachedHits(hits) {
  if (!Array.isArray(hits)) return null;
  const out = [];
  const seen = new Set();
  for (const h of hits) {
    if (!h || typeof h !== "object" || typeof h.code !== "string") continue;
    const code = h.code.trim();
    if (!/^\d{8,14}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      name: typeof h.name === "string" ? h.name.trim() : "",
      brand: typeof h.brand === "string" ? h.brand.trim() : "",
      img: typeof h.img === "string" && h.img.startsWith(IMG_PREFIX) ? h.img : "",
      vn: h.vn === true,
    });
  }
  return out;
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Bộ tìm (một bộ cho cả app)
// ---------------------------------------------------------------------------

/**
 * Tạo bộ tìm. Mọi tham số có mặc định; test truyền fetchImpl / now / storage / base / timeoutMs / maxEntries.
 * search(terms, { vn, signal }) và searchVnThenAll(terms, { signal }) KHÔNG BAO GIỜ ném:
 *   { ok: true, hits, cached } hoặc { ok: false, kind, status? } với kind:
 *   network (mất mạng, hoặc 503 không kèm CORS trong trình duyệt), timeout, rate (429), server (5xx / HTTP lỗi khác),
 *   badJson, aborted (người gọi hủy), limited (quá 10 lượt / phút, không gọi mạng).
 */
export function createOffSearch({
  fetchImpl = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  storage = defaultStorage(),
  base = OFF_SEARCH_URL,
  timeoutMs = SEARCH_TIMEOUT_MS,
  limit = SEARCH_LIMIT_PER_MIN,
  windowMs = SEARCH_WINDOW_MS,
  ttlMs = SEARCH_CACHE_TTL_MS,
  maxEntries = SEARCH_CACHE_MAX,
  pageSize = SEARCH_PAGE_SIZE,
} = {}) {
  const cache = new Map(); // khóa → { t, hits }; thứ tự chèn = cũ trước
  let loaded = false;
  const stamps = []; // thời điểm các lượt gọi mạng trong cửa sổ
  let calls = 0;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = storage?.getItem(SEARCH_CACHE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.v !== 1 || !Array.isArray(data.e)) return;
      for (const item of data.e) {
        if (!Array.isArray(item) || typeof item[0] !== "string") continue;
        const v = item[1];
        const hits = v && Number.isFinite(v.t) ? cleanCachedHits(v.hits) : null;
        if (hits) cache.set(item[0], { t: v.t, hits });
      }
    } catch { /* bộ lưu lỗi / dữ liệu hỏng: bỏ qua, dùng bộ nhớ trong RAM */ }
  }

  function prune() {
    const t = now();
    // quá hạn, hoặc thời điểm ở tương lai (đồng hồ chỉnh lùi: không bao giờ hết hạn) → bỏ
    for (const [k, v] of cache) if (t - v.t > ttlMs || v.t > t) cache.delete(k);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function save() {
    try { storage?.setItem(SEARCH_CACHE_KEY, JSON.stringify({ v: 1, e: [...cache.entries()] })); } catch { /* đầy / bị chặn: bỏ qua */ }
  }

  function takeSlot() {
    const t = now();
    while (stamps.length && stamps[0] <= t - windowMs) stamps.shift();
    if (stamps.length >= limit) return false;
    stamps.push(t);
    return true;
  }

  async function search(terms, { vn = false, signal } = {}) {
    const t = String(terms ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!t) return { ok: true, hits: [], cached: false };
    if (signal?.aborted) return { ok: false, kind: "aborted" };
    load();
    prune();
    const key = `${vn ? "vn" : "all"}|${t}`;
    const hit = cache.get(key);
    if (hit) return { ok: true, hits: hit.hits.map((h) => ({ ...h })), cached: true };
    if (!takeSlot()) return { ok: false, kind: "limited" };
    calls++;

    const ctrl = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => { callerAborted = true; ctrl.abort(); };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const failKind = () => (callerAborted ? "aborted" : timedOut ? "timeout" : "network");
    try {
      let res;
      try {
        res = await fetchImpl(searchUrl(t, { vn, pageSize, base }), { signal: ctrl.signal });
      } catch {
        return { ok: false, kind: failKind() };
      }
      // fetchImpl trả thứ không phải Response (undefined, {}, status không phải số): coi là lỗi mạng, không ném
      if (!res || typeof res !== "object" || typeof res.status !== "number") return { ok: false, kind: "network" };
      if (res.status === 429) return { ok: false, kind: "rate", status: 429 };
      if (!res.ok) return { ok: false, kind: "server", status: res.status };
      let text;
      try {
        text = await res.text();
      } catch {
        return { ok: false, kind: failKind() };
      }
      let json;
      try { json = JSON.parse(text); } catch { return { ok: false, kind: "badJson" }; }
      const hits = parseSearch(json);
      if (!hits) return { ok: false, kind: "badJson" };
      cache.delete(key);
      cache.set(key, { t: now(), hits });
      prune();
      save();
      return { ok: true, hits: hits.map((h) => ({ ...h })), cached: false };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  /**
   * Ưu tiên hàng bán ở Việt Nam nhưng không loại hàng nước ngoài: tìm có lọc VN, rồi tìm không lọc (2 lượt), gộp
   * (kết quả VN trước, bỏ trùng). Một lượt lỗi vẫn trả lượt kia; cả 2 lỗi → lỗi của lượt không lọc.
   */
  async function searchVnThenAll(terms, { signal } = {}) {
    const a = await search(terms, { vn: true, signal });
    if (!a.ok && a.kind === "aborted") return a;
    const b = await search(terms, { vn: false, signal });
    if (!a.ok && !b.ok) return b;
    if (!b.ok && b.kind === "aborted") return b;
    const hits = [];
    const seen = new Set();
    for (const h of [...(a.ok ? a.hits : []), ...(b.ok ? b.hits : [])]) if (!seen.has(h.code)) { seen.add(h.code); hits.push(h); }
    return { ok: true, hits, cached: (a.ok ? a.cached : true) && (b.ok ? b.cached : true) };
  }

  return { search, searchVnThenAll, calls: () => calls };
}
