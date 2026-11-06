// Gọi Open Food Facts và đổi dữ liệu thô sang object tiếng Việt sạch.

// import.meta.env?. (có dấu ?.): chạy test bằng node (không qua Vite) thì import.meta.env không có, không bị lỗi.
const BASE = import.meta.env?.VITE_OFF_API || "https://world.openfoodfacts.org/api/v2";

// Tên và phiên bản app gửi kèm mỗi lần tra, để Open Food Facts biết lượt gọi đến từ app nào.
// APP_VERSION khớp "version" trong package.json: đổi phiên bản thì đổi cả 2 chỗ cùng lúc.
// APP_NAME là tên repo (quet-ma-vach-full), không phải "name" trong package.json.
const APP_NAME = "quet-ma-vach-full";
const APP_VERSION = "0.1.0";

const FIELDS = [
  "code", "product_name", "product_name_vi", "product_name_en", "brands", "quantity", "categories",
  "image_front_url", "nutriscore_grade", "nova_group", "ecoscore_grade",
  "ingredients_text", "ingredients_text_vi", "ingredients_text_en",
  "allergens_tags", "traces_tags", "additives_tags", "nutriments",
  "origins", "manufacturing_places", "countries", "conservation_conditions", "preparation", "labels", "packaging"
].join(",");

export const ALLERGEN_VI = {
  gluten: "Gluten", milk: "Sữa", eggs: "Trứng", nuts: "Các loại hạt", peanuts: "Đậu phộng",
  soybeans: "Đậu nành", fish: "Cá", crustaceans: "Tôm, cua (giáp xác)", molluscs: "Nhuyễn thể",
  celery: "Cần tây", mustard: "Mù tạt", "sesame-seeds": "Mè", lupin: "Đậu lupin",
  "sulphur-dioxide-and-sulphites": "Sulfite"
};

/** 14 nhóm dị ứng theo thứ tự hiển thị (ô tick trong hồ sơ, tên trong khung cảnh báo). */
export const ALLERGEN_KEYS = Object.keys(ALLERGEN_VI);

export const NOVA_VI = {
  1: "Chưa hoặc ít chế biến",
  2: "Nguyên liệu nấu ăn đã chế biến",
  3: "Thực phẩm chế biến",
  4: "Siêu chế biến (nhiều phụ gia)"
};

// Thứ tự dòng trong bảng dinh dưỡng: [khóa API, nhãn, đơn vị, kiểu dòng]
export const NUTRIENT_ROWS = [
  ["energy-kcal_100g", "Năng lượng", "kcal", "energy"],
  ["fat_100g", "Chất béo", "g", ""],
  ["saturated-fat_100g", "trong đó béo bão hòa", "g", "sub"],
  ["carbohydrates_100g", "Tinh bột, đường (carbohydrate)", "g", ""],
  ["sugars_100g", "trong đó đường", "g", "sub"],
  ["fiber_100g", "Chất xơ", "g", ""],
  ["proteins_100g", "Chất đạm", "g", ""],
  ["salt_100g", "Muối", "g", "salt"]
];

const num = (v) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
const tag = (t) => String(t).replace(/^[a-z]{2}:/, "");
const grade = (g) => (/^[a-e]$/.test(String(g || "").toLowerCase()) ? String(g).toLowerCase() : null);

/** Đổi giá trị API sang chuỗi: chuỗi → bỏ khoảng trắng 2 đầu; số → chuỗi; mảng → nối ", "; còn lại → "". */
const str = (v) => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    return v.filter((x) => typeof x === "string" || typeof x === "number")
      .map((x) => String(x).trim()).filter(Boolean).join(", ");
  }
  return "";
};

/** Danh sách *_tags: chỉ nhận mảng, lấy phần tử là chuỗi khác rỗng ("" hay "  " không tính là có dữ liệu). */
const tags = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "") : []);

// Chờ tối đa 9 giây. Đo trên máy tính (11/2026): mỗi lần gọi khoảng 0,7–0,9 giây.
const TIMEOUT_MS = 9000;

/**
 * Gắn loại lỗi vào lỗi gốc (giữ nguyên name, message) để giao diện chọn câu báo.
 * kind: "network" (không gọi được), "timeout" (hết giờ), "server" (Open Food Facts lỗi / quá tải).
 */
function withKind(e, kind, status) {
  const err = e && typeof e === "object" ? e : new Error(String(e));
  err.kind = kind;
  if (status) err.status = status;
  return err;
}

/**
 * Tra 1 sản phẩm theo mã vạch.
 * Trả về dữ liệu thô `product` của Open Food Facts (chưa normalize),
 * hoặc null nếu Open Food Facts không có mã này (HTTP 404, hoặc status khác 1).
 * Ném lỗi có `kind` = "network" | "timeout" | "server" (và `status` = mã HTTP khi máy chủ trả mã lỗi như 503, 429).
 */
export async function getProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      // Định danh app bằng app_name / app_version trên URL.
      // Nguồn: https://openfoodfacts.github.io/openfoodfacts-server/api/ (mục Authentication), nguyên văn:
      //   "READ operations (getting info about a product, etc...) do not require authentication other than the custom User-Agent."
      //   "We however ask that you send the app_name, app_version and app_uuid parameters in your write queries."
      // Trình duyệt không cho đặt User-Agent, nên app gửi app_name / app_version bằng tham số URL trên lệnh đọc này.
      // Đây là suy rộng từ hướng dẫn cho lệnh ghi (tài liệu không nói riêng cho app chạy trong trình duyệt).
      // Không thêm header (để vẫn là GET đơn giản, không gây CORS preflight); không gửi app_uuid.
      const url = `${BASE}/product/${code}.json?fields=${FIELDS}`
        + `&app_name=${encodeURIComponent(APP_NAME)}&app_version=${encodeURIComponent(APP_VERSION)}`;
      res = await fetch(url, { signal: ctrl.signal });
    } catch (e) {
      // Hết giờ thì fetch ném AbortError; còn lại (mất mạng, bị chặn, CORS…) Safari ném TypeError "Load failed".
      throw withKind(e, ctrl.signal.aborted ? "timeout" : "network");
    }

    // 404 = mã không có (Open Food Facts trả kèm {status: 0}). Lỗi khác (5xx, 429…) là máy chủ lỗi / quá tải.
    if (!res.ok && res.status !== 404) {
      const err = new Error(`HTTP ${res.status}${res.statusText ? " " + res.statusText : ""}`);
      err.name = "HttpError";
      throw withKind(err, "server", res.status);
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      if (ctrl.signal.aborted) throw withKind(e, "timeout");
      if (res.status === 404) return null; // 404 mà nội dung không phải JSON: vẫn là không tìm thấy
      // Tới đây res.ok (200…): JSON hỏng. Không gắn status để câu báo không hiện "(HTTP 200)" gây hiểu lầm.
      throw withKind(e, "server");
    }
    if (!data || data.status !== 1 || !data.product) return null;
    return data.product;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tên dị ứng tiếng Việt. Dùng Object.hasOwn để mã lạ như "constructor", "toString"
 * không trúng thuộc tính có sẵn của object (sẽ ra một hàm thay vì chữ).
 */
const allergenVi = (a) => (Object.hasOwn(ALLERGEN_VI, a) ? ALLERGEN_VI[a] : a);

/**
 * Khóa nhóm dị ứng (vd "milk") từ danh sách tag: chỉ nhận tag "en:<khóa>" có trong ALLERGEN_VI
 * ("fr:lait", "en:constructor", "en:abc" không tính). Bỏ trùng, xếp theo thứ tự ALLERGEN_KEYS.
 */
const allergenKeysOf = (v) => {
  const found = new Set(tags(v)
    .filter((t) => t.startsWith("en:"))
    .map((t) => t.slice(3))
    .filter((k) => Object.hasOwn(ALLERGEN_VI, k)));
  return ALLERGEN_KEYS.filter((k) => found.has(k));
};

/**
 * Làm sạch hồ sơ dị ứng (đọc từ localStorage hoặc từ ô tick): không phải mảng → [];
 * chỉ giữ chuỗi là khóa của ALLERGEN_VI; bỏ trùng; xếp theo thứ tự ALLERGEN_KEYS.
 */
export function cleanAllergyProfile(v) {
  if (!Array.isArray(v)) return [];
  const keep = new Set(v.filter((k) => typeof k === "string" && Object.hasOwn(ALLERGEN_VI, k)));
  return ALLERGEN_KEYS.filter((k) => keep.has(k));
}

/**
 * So sản phẩm (đã normalize) với hồ sơ dị ứng.
 * danger: nhóm trong hồ sơ mà sản phẩm có (allergens_tags) → khung đỏ.
 * traces: nhóm trong hồ sơ mà sản phẩm "có thể lẫn vết" (traces_tags), trừ nhóm đã ở danger → khung vàng.
 * noData: Open Food Facts chưa có dữ liệu dị ứng (allergens_tags rỗng / thiếu), dù traces có hay không.
 */
export function matchAllergies(product, profile) {
  const mine = new Set(cleanAllergyProfile(profile));
  const danger = (product.allergenKeys || []).filter((k) => mine.has(k));
  const traces = (product.traceKeys || []).filter((k) => mine.has(k) && !danger.includes(k));
  return { danger, traces, noData: !product.hasAllergenData };
}

/** Tên đặt cho sản phẩm khi API không có tên (render.js dùng để biết không điền sẵn vào form tủ đồ). */
export const NO_NAME = "Sản phẩm chưa có tên";

/** Đổi dữ liệu thô của Open Food Facts sang dạng app dùng. */
export function normalize(p, code) {
  const n = p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {};
  const cats = str(p.categories).split(",").map((s) => s.trim()).filter(Boolean);
  const nutriments = {};
  for (const [key] of NUTRIENT_ROWS) nutriments[key] = num(n[key]);

  return {
    code: str(p.code) || code,
    name: str(p.product_name_vi) || str(p.product_name) || str(p.product_name_en) || NO_NAME,
    brand: str(p.brands),
    quantity: str(p.quantity),
    category: cats.length ? cats[cats.length - 1] : "",
    image: str(p.image_front_url),
    nutriscore: grade(p.nutriscore_grade),
    nova: num(p.nova_group),
    ecoscore: grade(p.ecoscore_grade),
    ingredients: str(p.ingredients_text_vi) || str(p.ingredients_text) || str(p.ingredients_text_en),
    allergens: tags(p.allergens_tags).map(tag).map(allergenVi),
    traces: tags(p.traces_tags).map(tag).map(allergenVi),
    // Hồ sơ dị ứng (giai đoạn 3): khóa nhóm để so với hồ sơ; hasAllergenData = allergens_tags có ít nhất 1 tag
    allergenKeys: allergenKeysOf(p.allergens_tags),
    traceKeys: allergenKeysOf(p.traces_tags),
    hasAllergenData: tags(p.allergens_tags).length > 0,
    additives: tags(p.additives_tags).map((t) => tag(t).toUpperCase()),
    nutriments,
    hasNutriments: Object.values(nutriments).some((v) => v != null),
    // Giai đoạn 2: xuất xứ, sản xuất, bảo quản
    origins: str(p.origins),
    manufacturingPlaces: str(p.manufacturing_places),
    countries: str(p.countries),
    storage: str(p.conservation_conditions),
    preparation: str(p.preparation),
    labels: str(p.labels),
    packaging: str(p.packaging)
  };
}
