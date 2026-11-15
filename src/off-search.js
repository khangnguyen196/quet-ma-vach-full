// "Chụp mặt trước" (đợt tu-dong): tìm sản phẩm theo CHỮ trên toàn bộ Open Food Facts, gọi thẳng từ trình duyệt.
// Thuần: không DOM, không import thư viện, không gọi mạng lúc nạp. fetch, đồng hồ (now) và bộ lưu (localStorage)
// truyền vào được để test bằng máy chủ giả.
//
// Chọn API (đo 15/11/2026, test-ocr/chup-mat-do/tu-dong-cors.mjs, Playwright Chromium + WebKit từ trang 127.0.0.1):
// - cgi/search.pl (world.openfoodfacts.org): trả 200 thì có "Access-Control-Allow-Origin: *" (Chromium 15/11,
//   WebKit dựa lần đo 07/11/2026), tìm theo chữ; tìm "7up soda chanh" không lọc VN thì 8934588752117 đứng vị trí 1.
//   Khi OFF quá tải nó trả 503 KHÔNG kèm header CORS → trong trình duyệt thành lỗi mạng (TypeError), không đọc được mã 503.
// - search-a-licious (search.openfoodfacts.org): trả 200 nhưng KHÔNG có header CORS → trình duyệt chặn (cả 2).
// - /api/v2/search: không tìm theo chữ (chỉ lọc nhãn), hôm đo còn trả 503.
//
// Ví dụ (vòng 2: mỗi ảnh tối đa 2 câu = 2 lượt, KHÔNG lọc VN; ưu tiên VN xét tại chỗ bằng cờ vn):
//   const off = createOffSearch();                         // một bộ cho cả app (giới hạn lượt tính chung)
//   const qs = cleanQuery(["Up", "Soda chanh", "Khong calo"], { idf: index.idf });  // ["soda chanh", "calo up"]
//   const r = await off.search(qs[0], { signal });         // { ok: true, hits: [{ code, name, brand, img, vn, text }] }
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
export const SEARCH_PAGE_SIZE = 24;
// product_name* + brands + generic_name*: để chữ ứng viên OFF giống trường text của danh mục (docText của
// test-ocr/chup-mat-do/vn-data.mjs: MỌI product_name*, brands, MỌI generic_name*) khi chấm BM25. Không xin được "mọi
// ngôn ngữ" nên chọn theo 1.699 bản ghi VN của bản xuất 08/11/2026: product_name 1.404, _en 928, _vi 358, _fr 191,
// _de 19, _es 16, _it 10 (các ngôn ngữ khác ≤ 10 mỗi thứ, cộng 64); generic_name 27, _vi 20, _en 12, _fr 5.
export const SEARCH_FIELDS = "code,product_name,product_name_vi,product_name_en,product_name_fr,product_name_de,product_name_es,product_name_it,"
  + "generic_name,generic_name_vi,generic_name_en,generic_name_fr,brands,image_front_small_url,countries_tags";
/** Độ dài tối đa chữ chấm điểm (text) của một ứng viên. */
export const HIT_TEXT_MAX = 400;
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
/** Số câu tìm tối đa mỗi ảnh (= số lượt tìm tối đa), số từ tối thiểu / tối đa mỗi câu, độ dài tối đa (ký tự). */
export const QUERY_MAX = 2;
export const QUERY_WORDS_MIN = 2;
export const QUERY_WORDS_MAX = 3;
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

// Âm tiết tiếng Việt hợp lệ khi đã bỏ dấu (luật thuần, không thư viện): âm đầu? + vần.
// Vần "mở" (nhận âm cuối c / ch / m / n / ng / nh / p / t hoặc không) và vần "đóng" (kết thúc bằng bán nguyên âm i / y / o /
// u, không có âm cuối). Bỏ dấu nên ơ / ư / â… gộp vào a / o / u. Ví dụ: "chanh", "nghieng", "khuyen", "huong" hợp lệ;
// rác OCR "lugng", "sog", "vibttef" không hợp lệ.
const ONSET = "(?:ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdghklmnprstvx])?";
const OPEN_NUCLEI = ["uya", "uye", "ia", "ie", "oa", "oe", "oo", "ua", "ue", "uo", "uy", "ya", "ye", "a", "e", "i", "o", "u", "y"];
const CLOSED_NUCLEI = ["ieu", "yeu", "oai", "oay", "oeo", "uoi", "uou", "uay", "uyu", "ai", "ao", "au", "ay", "eo", "eu", "iu", "oi", "ui", "uu"];
const CODA = "(?:ch|ng|nh|[cmnpt])?";
const SYLLABLE = new RegExp(`^${ONSET}(?:(?:${OPEN_NUCLEI.join("|")})${CODA}|(?:${CLOSED_NUCLEI.join("|")}))$`);

/** w (chữ thường, không dấu) có phải âm tiết tiếng Việt hợp lệ không. */
export function isVietSyllable(w) {
  return typeof w === "string" && w.length <= 7 && SYLLABLE.test(w);
}

/**
 * idf cho từ KHÔNG có trong chỉ mục (âm tiết hợp lệ nhưng danh mục không có) khi xếp dòng / chọn từ: 0 = không cộng điểm,
 * chỉ dùng để lấp câu khi dòng thiếu từ danh mục. Vòng 2 dùng trung vị idf của chỉ mục, nhưng trong danh mục 1.452 sản
 * phẩm 1.296 / 2.116 từ chỉ có ở 1 sản phẩm nên trung vị = idf lớn nhất (6,876): từ lạ thành "hiếm nhất", dòng rác dài
 * ("Mui Bin Tinh Sấy", "khoi lung tinh") đứng đầu. Đo vòng 3 (câu tìm 30 ảnh, thước đo: câu 1 có ≥ 2 từ của sản phẩm
 * đúng; D:\tmp\tu-dong\ket-qua\v3-unknown-idf.json): trung vị 6/30 (B), 8/30 (A); phân vị 25% (6,029) 6 / 8; phân vị
 * 10% (5,41) 6 / 8; idf nhỏ nhất (2,798) 7 / 9; 0: 8 / 9, và chỉ 0 cho câu ca muối có "coop" → chọn 0.
 */
export const UNKNOWN_IDF = 0;

/** Ghép từ thành câu, tối đa QUERY_CHARS_MAX ký tự. */
function joinCapped(words) {
  const out = [];
  for (const w of words) {
    if ([...out, w].join(" ").length > QUERY_CHARS_MAX) break;
    out.push(w);
  }
  return out.join(" ");
}

/** Chọn tối đa n từ có idf cao nhất (bằng nhau: đứng trước), giữ thứ tự trong dòng. */
function topWords(words, n, idfOf) {
  const keep = new Set(words.map((w, k) => ({ w, k, s: idfOf(w) })).sort((a, b) => b.s - a.s || a.k - b.k).slice(0, n).map((x) => x.k));
  return words.filter((_, k) => keep.has(k));
}

/**
 * Chữ OCR (mảng dòng, mảng { text }, hoặc chuỗi nhiều dòng) → tối đa QUERY_MAX (2) câu tìm, mỗi câu 2–3 từ (không dấu).
 * - Chỉ giữ từ "đáng tin": có trong từ vựng danh mục (vocab / idf) HOẶC là âm tiết tiếng Việt hợp lệ (isVietSyllable).
 * - Xếp dòng theo tổng idf các từ (từ hiếm trước; từ không có trong chỉ mục: UNKNOWN_IDF = 0), không theo độ dài.
 * - Câu 1 = dòng điểm cao nhất (dòng > 3 từ: lấy 3 từ hiếm nhất; dòng 1 từ: ghép từ hiếm nhất của dòng khác);
 *   câu 2 = dòng điểm cao thứ hai (cùng cách), không có thì 2–3 từ hiếm tiếp theo của dòng 1.
 * - Câu 1 từ chỉ được khi không còn từ nào để ghép và từ đó ≥ 5 chữ cái.
 * opts: idf (Map từ → idf của chỉ mục T1, cũng dùng làm từ vựng), vocab (từ vựng riêng nếu khác idf), unknownIdf (số:
 * thay UNKNOWN_IDF, chỉ để đo).
 * Không có từ đáng tin → [].
 */
export function cleanQuery(input, { vocab = null, idf = null, unknownIdf: unk = null } = {}) {
  const vb = vocab || idf;
  const hasIdf = !!(idf && typeof idf.get === "function");
  // không có chỉ mục: mọi từ 1 điểm (dòng nhiều từ trước, như vòng 2); có chỉ mục: từ lạ UNKNOWN_IDF (unknownIdf để đo)
  const dflt = Number.isFinite(unk) ? unk : hasIdf ? UNKNOWN_IDF : 1;
  const idfOf = (w) => (hasIdf && Number.isFinite(idf.get(w)) ? idf.get(w) : dflt);
  const lines = [];
  const seen = new Set();
  toLines(input).forEach((text, i) => {
    const words = [...new Set(lineWords(text, vb).filter((w) => inVocab(vb, w) || isVietSyllable(w)))];
    const key = words.join(" ");
    if (!words.length || seen.has(key)) return;
    seen.add(key);
    lines.push({ i, words, score: words.reduce((s, w) => s + idfOf(w), 0) });
  });
  if (!lines.length) return [];
  const ranked = [...lines].sort((a, b) => b.score - a.score || a.i - b.i);
  // mọi từ, từ hiếm trước (để ghép cho dòng chỉ 1 từ)
  const allWords = [...new Set(ranked.flatMap((l) => l.words))].sort((a, b) => idfOf(b) - idfOf(a));

  const out = [];
  const used = new Set();
  const fromWords = (words) => {
    let ws = topWords(words, QUERY_WORDS_MAX, idfOf);
    if (ws.length < QUERY_WORDS_MIN) {
      const partner = allWords.find((w) => !ws.includes(w));
      if (partner) ws = [...ws, partner];
    }
    const q = joinCapped(ws);
    const key = [...ws].sort().join(" ");
    if (q && okQuery(q) && !used.has(key)) { used.add(key); out.push(q); }
  };
  fromWords(ranked[0].words);
  if (ranked[1]) fromWords(ranked[1].words);
  if (out.length < QUERY_MAX) {
    const first = new Set(topWords(ranked[0].words, QUERY_WORDS_MAX, idfOf));
    const rest = ranked[0].words.filter((w) => !first.has(w));
    if (rest.length >= QUERY_WORDS_MIN) fromWords(rest);
  }
  return out.slice(0, QUERY_MAX);
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

const str = (x) => (typeof x === "string" ? x.trim() : "");

/**
 * Thân JSON của search.pl → [{ code, name, brand, img, vn, text }]; thân sai dạng (không có mảng products) → null.
 * Bỏ mã không phải 8–14 chữ số (như gợi ý danh mục), bỏ mã trùng; img chỉ nhận URL images.openfoodfacts.org.
 * text = mọi product_name* + brands + mọi generic_name* (chuỗi khác rỗng, theo thứ tự khóa trong JSON, KHÔNG bỏ trùng),
 * y như docText của danh mục, tối đa HIT_TEXT_MAX ký tự: chữ để chấm điểm BM25 khi gộp với T1 (không hiển thị).
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
    const names = [p.product_name_vi, p.product_name, p.product_name_en].map(str);
    const name = names.find(Boolean) || "";
    const brand = Array.isArray(p.brands) ? p.brands.map(str).filter(Boolean).join(", ") : str(p.brands);
    const img = typeof p.image_front_small_url === "string" && p.image_front_small_url.startsWith(IMG_PREFIX) ? p.image_front_small_url : "";
    const vn = Array.isArray(p.countries_tags) && p.countries_tags.includes("en:vietnam");
    // như vnRecord + docText (vn-data.mjs): giữ trùng, cùng thứ tự trường
    const allNames = [];
    const generic = [];
    for (const [k, v] of Object.entries(p)) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (/^product_name(_[a-z]{2,3})?$/.test(k)) allNames.push(v.trim());
      else if (/^generic_name(_[a-z]{2,3})?$/.test(k)) generic.push(v.trim());
    }
    const text = [...allNames, brand, ...generic].join(" ").slice(0, HIT_TEXT_MAX);
    out.push({ code, name, brand, img, vn, text });
  }
  return out;
}

/**
 * Lọc lại các mục đọc từ localStorage theo đúng luật parseSearch: mã 8–14 chữ số (bỏ mục hỏng, bỏ trùng),
 * name / brand / text phải là chuỗi (không thì ""), img chỉ URL images.openfoodfacts.org (không thì ""), vn chỉ true / false.
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
      text: typeof h.text === "string" ? h.text.trim().slice(0, HIT_TEXT_MAX) : "",
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
   * Vòng 2 (đợt tu-dong): luồng tìm KHÔNG dùng hàm này nữa (mỗi câu 1 lượt search() không lọc, ưu tiên VN xét tại chỗ
   * bằng cờ vn): lượt lọc VN tốn gấp đôi lượt và lọc mất hàng có countries_tags rỗng (7Up Diet 8934588752117).
   * Giữ lại (có test) phòng khi cần lại; chưa nối vào app.
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
