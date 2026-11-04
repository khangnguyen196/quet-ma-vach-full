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

/**
 * Tra 1 sản phẩm theo mã vạch.
 * Trả về object đã normalize, hoặc null nếu Open Food Facts không có mã này.
 * Ném lỗi nếu mất mạng / API lỗi.
 */
export async function getProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${BASE}/product/${code}.json?fields=${FIELDS}`, { signal: ctrl.signal });
    const data = await res.json();
    if (!data || data.status !== 1 || !data.product) return null;
    return normalize(data.product, code);
  } finally {
    clearTimeout(timer);
  }
}

/** Đổi dữ liệu thô của Open Food Facts sang dạng app dùng. */
export function normalize(p, code) {
  const n = p.nutriments || {};
  const cats = (p.categories || "").split(",").map((s) => s.trim()).filter(Boolean);
  const nutriments = {};
  for (const [key] of NUTRIENT_ROWS) nutriments[key] = num(n[key]);

  return {
    code: p.code || code,
    name: p.product_name_vi || p.product_name || p.product_name_en || "Sản phẩm chưa có tên",
    brand: p.brands || "",
    quantity: p.quantity || "",
    category: cats.length ? cats[cats.length - 1] : "",
    image: p.image_front_url || "",
    nutriscore: grade(p.nutriscore_grade),
    nova: num(p.nova_group),
    ecoscore: grade(p.ecoscore_grade),
    ingredients: p.ingredients_text_vi || p.ingredients_text || p.ingredients_text_en || "",
    allergens: (p.allergens_tags || []).map(tag).map((a) => ALLERGEN_VI[a] || a),
    traces: (p.traces_tags || []).map(tag).map((a) => ALLERGEN_VI[a] || a),
    additives: (p.additives_tags || []).map((t) => tag(t).toUpperCase()),
    nutriments,
    hasNutriments: Object.values(nutriments).some((v) => v != null),
    // Giai đoạn 2: xuất xứ, sản xuất, bảo quản
    origins: p.origins || "",
    manufacturingPlaces: p.manufacturing_places || "",
    countries: p.countries || "",
    storage: p.conservation_conditions || "",
    preparation: p.preparation || "",
    labels: p.labels || "",
    packaging: p.packaging || ""
  };
}
