// Gọi Open Food Facts và đổi dữ liệu thô sang object tiếng Việt sạch.

const BASE = import.meta.env.VITE_OFF_API || "https://world.openfoodfacts.org/api/v2";

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

/** Danh sách *_tags: chỉ nhận mảng, lấy phần tử là chuỗi. */
const tags = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

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
      res = await fetch(`${BASE}/product/${code}.json?fields=${FIELDS}`, { signal: ctrl.signal });
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

/** Đổi dữ liệu thô của Open Food Facts sang dạng app dùng. */
export function normalize(p, code) {
  const n = p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {};
  const cats = str(p.categories).split(",").map((s) => s.trim()).filter(Boolean);
  const nutriments = {};
  for (const [key] of NUTRIENT_ROWS) nutriments[key] = num(n[key]);

  return {
    code: str(p.code) || code,
    name: str(p.product_name_vi) || str(p.product_name) || str(p.product_name_en) || "Sản phẩm chưa có tên",
    brand: str(p.brands),
    quantity: str(p.quantity),
    category: cats.length ? cats[cats.length - 1] : "",
    image: str(p.image_front_url),
    nutriscore: grade(p.nutriscore_grade),
    nova: num(p.nova_group),
    ecoscore: grade(p.ecoscore_grade),
    ingredients: str(p.ingredients_text_vi) || str(p.ingredients_text) || str(p.ingredients_text_en),
    allergens: tags(p.allergens_tags).map(tag).map((a) => ALLERGEN_VI[a] || a),
    traces: tags(p.traces_tags).map(tag).map((a) => ALLERGEN_VI[a] || a),
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
