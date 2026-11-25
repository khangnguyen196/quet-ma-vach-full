// "Thêm vào kho nhóm" (đợt kho-nhom vòng 7), PHẦN THUẦN: điền sẵn form, kiểm form theo đúng CHECK của
// server/kho-nhom.sql, đường dẫn ảnh trong bucket. Không DOM, không import thư viện, không gọi mạng lúc nạp.
// HTML form ở src/render.js (renderNhomAddForm), gửi ảnh + ghi Supabase ở src/nhom-write.js, nối ở src/main.js.
// Luật dị ứng: chỉ lấy từ Open Food Facts (allergens_tags, KHÔNG lấy traces) hoặc người dùng tự tích; chữ đọc từ ảnh
// (mặt sau) chỉ điền ô thành phần, KHÔNG BAO GIỜ tự tích dị ứng.
import { NO_NAME, ALLERGEN_KEYS } from "./off.js";
import { NHOM_NUTRIENT_KEYS } from "./front-nhom.js";

/** Giới hạn độ dài (đếm theo ký tự Unicode như char_length của Postgres), trùng CHECK của server/kho-nhom.sql. */
export const NHOM_NAME_MAX = 200;
export const NHOM_INGREDIENTS_MAX = 5000;
/** Nguồn thông tin (cột nguon). */
export const NHOM_SOURCES = Object.freeze(["tay", "off", "ocr-mat-sau"]);

const CODE_RE = /^[0-9]{8,14}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const chars = (s) => [...s].length;
const cut = (s, max) => [...s].slice(0, max).join("");
const str = (v) => (typeof v === "string" ? v : "");

/** Mã dị ứng hợp lệ (14 mã của SQL = ALLERGEN_KEYS), bỏ trùng, theo thứ tự ALLERGEN_KEYS. */
function cleanAllergens(list) {
  const set = new Set(Array.isArray(list) ? list.filter((k) => typeof k === "string") : []);
  return ALLERGEN_KEYS.filter((k) => set.has(k));
}

/** Số dinh dưỡng → chuỗi hiển thị trong ô (dấu phẩy thập phân kiểu Việt Nam). */
const numText = (n) => String(n).replace(".", ",");

/**
 * Sản phẩm Open Food Facts ĐÃ normalize (src/off.js) + mã đã tra → giá trị điền sẵn của form (người dùng sửa được):
 * { ten, thuong_hieu, khoi_luong, ma_vach, thanh_phan, dinh_duong: { khóa: chuỗi số }, di_ung: [mã], nguon: "off" }.
 * Tên "Sản phẩm chưa có tên" (NO_NAME) → "". Chữ dài hơn giới hạn của SQL bị cắt. dinh_duong chỉ khóa của
 * NHOM_NUTRIENT_KEYS có số hữu hạn ≥ 0. di_ung = allergenKeys (dị ứng CHẮC CHẮN của OFF) lọc theo 14 mã; KHÔNG lấy
 * traceKeys ("có thể lẫn vết").
 * Ví dụ: nhomFormFromOff({ name: "Mì", brand: "A", allergenKeys: ["gluten"], traceKeys: ["milk"] }, "8934563163150")
 *   → { ten: "Mì", thuong_hieu: "A", …, ma_vach: "8934563163150", di_ung: ["gluten"], nguon: "off" }
 */
export function nhomFormFromOff(product, code) {
  const p = product && typeof product === "object" ? product : {};
  const name = str(p.name).trim();
  const ma = [code, p.code].find((c) => typeof c === "string" && CODE_RE.test(c)) || "";
  const nut = p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {};
  const dinh_duong = {};
  for (const k of NHOM_NUTRIENT_KEYS) {
    const v = nut[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) dinh_duong[k] = numText(v);
  }
  return {
    ten: name === NO_NAME ? "" : cut(name, NHOM_NAME_MAX),
    thuong_hieu: cut(str(p.brand).trim(), NHOM_NAME_MAX),
    khoi_luong: cut(str(p.quantity).trim(), NHOM_NAME_MAX),
    ma_vach: ma,
    thanh_phan: cut(str(p.ingredients).trim(), NHOM_INGREDIENTS_MAX),
    dinh_duong,
    di_ung: cleanAllergens(p.allergenKeys),
    nguon: "off"
  };
}

/**
 * Chữ máy chủ OCR đọc được trên ảnh MẶT SAU (items của /ocr: [{ text, … }]) → CHỈ ô thành phần:
 * { thanh_phan, nguon: "ocr-mat-sau" }. Mỗi khung chữ một dòng (bỏ khung rỗng), cắt ≤ 5.000 ký tự.
 * KHÔNG BAO GIỜ trả di_ung (máy đọc chữ có thể sai; dị ứng chỉ từ Open Food Facts hoặc người dùng tự tích).
 * Ví dụ: nhomFormFromBackText([{ text: "Thành phần: bột mì" }, { text: "muối" }])
 *   → { thanh_phan: "Thành phần: bột mì\nmuối", nguon: "ocr-mat-sau" }
 */
export function nhomFormFromBackText(items) {
  const lines = (Array.isArray(items) ? items : [])
    .map((it) => (it && typeof it.text === "string" ? it.text.trim() : ""))
    .filter(Boolean);
  return { thanh_phan: cut(lines.join("\n"), NHOM_INGREDIENTS_MAX), nguon: "ocr-mat-sau" };
}

/** Chữ một ô dinh dưỡng → số (≥ 0) | null (ô trống) | NaN (sai). Nhận dấu phẩy thập phân ("1,5" → 1.5). */
function parseNutrient(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : NaN;
  if (typeof v !== "string") return NaN;
  const s = v.trim();
  if (!s) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(s)) return NaN;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * Giá trị form → dòng để insert vào nhom_san_pham, kiểm ĐÚNG các CHECK của server/kho-nhom.sql:
 * { ok: true, row } hoặc { ok: false, errors: { <tên ô>: câu tiếng Việt } } (ô dinh dưỡng: tên ô = khóa, vd "fat_100g").
 * - ten: bỏ khoảng trắng hai đầu, 1–200 ký tự (bắt buộc).
 * - thuong_hieu / khoi_luong: ≤ 200 ký tự, rỗng → null. ma_vach: 8–14 chữ số hoặc rỗng → null.
 * - thanh_phan: ≤ 5.000 ký tự, rỗng → null.
 * - dinh_duong: chữ người gõ, nhận "1,5"; ô rỗng → bỏ khóa; âm / không phải số → lỗi ô đó; không còn khóa nào → null.
 * - di_ung: chỉ 14 mã, bỏ trùng (mã lạ bị bỏ). nguon: tay | off | ocr-mat-sau (khác → tay).
 * KHÔNG đặt id, nguoi_them (SQL tự lấy auth.uid()), tao_luc / sua_luc.
 * Ví dụ: nhomRowFromForm({ ten: " Bánh ", dinh_duong: { "fat_100g": "1,5" } })
 *   → { ok: true, row: { ten: "Bánh", thuong_hieu: null, …, dinh_duong: { "fat_100g": 1.5 }, di_ung: [], nguon: "tay" } }
 */
export function nhomRowFromForm(form) {
  const f = form && typeof form === "object" ? form : {};
  const errors = {};
  const ten = str(f.ten).trim();
  if (!ten) errors.ten = "Cần nhập tên sản phẩm.";
  else if (chars(ten) > NHOM_NAME_MAX) errors.ten = `Tên tối đa ${NHOM_NAME_MAX} ký tự.`;

  const short = (key, label) => {
    const v = str(f[key]).trim();
    if (!v) return null;
    if (chars(v) > NHOM_NAME_MAX) errors[key] = `${label} tối đa ${NHOM_NAME_MAX} ký tự.`;
    return v;
  };
  const thuong_hieu = short("thuong_hieu", "Thương hiệu");
  const khoi_luong = short("khoi_luong", "Khối lượng");

  let ma_vach = str(f.ma_vach).trim() || null;
  if (ma_vach && !CODE_RE.test(ma_vach)) errors.ma_vach = "Mã vạch cần 8–14 chữ số (hoặc để trống).";

  let thanh_phan = str(f.thanh_phan).trim() || null;
  if (thanh_phan && chars(thanh_phan) > NHOM_INGREDIENTS_MAX) {
    errors.thanh_phan = `Thành phần tối đa ${NHOM_INGREDIENTS_MAX.toLocaleString("vi-VN")} ký tự.`;
  }

  const dd = f.dinh_duong && typeof f.dinh_duong === "object" && !Array.isArray(f.dinh_duong) ? f.dinh_duong : {};
  let dinh_duong = {};
  for (const k of NHOM_NUTRIENT_KEYS) {
    if (!Object.hasOwn(dd, k)) continue;
    const n = parseNutrient(dd[k]);
    if (n === null) continue;
    if (Number.isNaN(n)) errors[k] = "Nhập số không âm (vd 1,5) hoặc để trống.";
    else dinh_duong[k] = n;
  }
  if (!Object.keys(dinh_duong).length) dinh_duong = null;

  const di_ung = cleanAllergens(f.di_ung);
  const nguon = NHOM_SOURCES.includes(f.nguon) ? f.nguon : "tay";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: { ten, thuong_hieu, khoi_luong, ma_vach, thanh_phan, dinh_duong, di_ung, nguon } };
}

/**
 * Đường dẫn ảnh trong bucket nhom-anh: "<uid>/<uuid>.jpg" (CHECK duong_dan của SQL + policy thư mục = uid). uid và
 * uuid phải đúng dạng uuid chữ thường; sai → ném lỗi (lỗi lập trình, không phải lỗi người dùng).
 * Ví dụ: nhomImagePath("0d0d…", "a1b2…") → "0d0d…/a1b2….jpg"
 */
export function nhomImagePath(uid, uuid) {
  if (typeof uid !== "string" || !UUID_RE.test(uid)) throw new TypeError("nhomImagePath: uid phải là uuid chữ thường");
  if (typeof uuid !== "string" || !UUID_RE.test(uuid)) throw new TypeError("nhomImagePath: uuid phải là uuid chữ thường");
  return `${uid}/${uuid}.jpg`;
}

/**
 * uuid v4 chữ thường mới. Dùng crypto.randomUUID; trình duyệt không có (Safari trước 15.4) thì tự tạo từ
 * crypto.getRandomValues (16 byte ngẫu nhiên, đặt bit phiên bản 4 + biến thể RFC 4122). c: chỉ test truyền.
 * Ví dụ: newUuid() → "3b241101-e2bb-4255-8caf-4136c566a962"
 */
export function newUuid(c = globalThis.crypto) {
  if (typeof c?.randomUUID === "function") return c.randomUUID().toLowerCase();
  if (typeof c?.getRandomValues !== "function") throw new Error("Trình duyệt không có bộ sinh số ngẫu nhiên an toàn (crypto).");
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // phiên bản 4
  b[8] = (b[8] & 0x3f) | 0x80; // biến thể RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
