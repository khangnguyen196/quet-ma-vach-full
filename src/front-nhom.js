// "Chụp mặt trước": KHO SẢN PHẨM CỦA NHÓM, phần thuần (đợt kho-nhom vòng 6). Không DOM, không import thư viện, không gọi
// mạng lúc nạp. Máy chủ OCR trả thêm khóa "nhom" (≤ 3 món nhóm có ảnh giống ảnh vừa chụp nhất, kèm điểm diem = cos của
// 2 vector CLIP; server/README.md mục "Hợp đồng API kho nhóm"). Module này: làm sạch danh sách đó (nhomCandidates), quyết
// định có TỰ MỞ món nhóm không (nhomOutcome + NHOM_THRESHOLD), làm sạch một dòng nhom_san_pham đọc từ Supabase để vẽ
// (nhomProductView, nhomNutrition). HTML ở src/render.js, đọc Supabase ở src/nhom-data.js, nối ở src/main.js.
import { NUTRIENT_ROWS, ALLERGEN_VI, ALLERGEN_KEYS } from "./off.js";

/**
 * Ngưỡng độ giống ảnh để TỰ MỞ món nhóm. ĐÂY LÀ CHỖ DUY NHẤT đặt ngưỡng (main.js không truyền ngưỡng; test
 * tests/front-wiring.test.js luật (18) giữ điều này).
 * Kết quả đo vòng 5 (luật chốt trước ở commit 62dca69, khung đo test-ocr/chup-mat-do/kho-nhom-do.mjs): KHÔNG ĐẠT —
 * recall P1 (ảnh khác của cùng sản phẩm) chỉ 1/15 tại T = 0,855 (T phải ≥ điểm cao nhất của ca âm 0,8205 + 0,03), nên
 * Infinity: món nhóm KHÔNG BAO GIỜ tự mở, chỉ vào "gợi ý khác" / trang "Chưa tìm thấy…".
 * Muốn đổi: phải đo lại theo một luật MỚI commit trước khi đo (ảnh điện thoại so với ảnh điện thoại…), rồi mới sửa số này.
 */
export const NHOM_THRESHOLD = Infinity;

/** Số món nhóm tối đa máy chủ trả / app xét. */
export const NHOM_MAX = 3;
/** Độ dài tối đa tên / thương hiệu (trùng CHECK của server/kho-nhom.sql). */
export const NHOM_TEXT_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RE = /^\d{8,14}$/;

/** id dạng uuid in thường (như Postgres trả). */
export const isNhomId = (v) => typeof v === "string" && UUID_RE.test(v);

/** Số ký tự (đếm theo ký tự Unicode như char_length của Postgres, không theo UTF-16). */
const chars = (s) => [...s].length;

/**
 * Khóa "nhom" của phản hồi /ocr → danh sách đã kiểm dạng, LUÔN là mảng (không có khóa / không phải mảng → []).
 * Xét ≤ 3 phần tử đầu. Mỗi mục: san_pham_id uuid in thường; ten chuỗi, bỏ khoảng trắng hai đầu còn 1–200 ký tự;
 * thuong_hieu chuỗi ≤ 200 ký tự (rỗng → null) hoặc null / thiếu; ma_vach chuỗi 8–14 chữ số, sai → null (không bỏ mục);
 * diem số hữu hạn trong [-1, 1]. Mục sai → bỏ. Trùng san_pham_id → giữ mục đầu. Sắp diem giảm dần (bằng điểm giữ thứ tự).
 * Ví dụ: nhomCandidates({ nhom: [{ san_pham_id: "…uuid…", ten: " Bánh ", diem: 0.9 }] })
 *        → [{ san_pham_id: "…uuid…", ten: "Bánh", thuong_hieu: null, ma_vach: null, diem: 0.9 }]
 */
export function nhomCandidates(body) {
  const raw = body && typeof body === "object" && Array.isArray(body.nhom) ? body.nhom.slice(0, NHOM_MAX) : [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    if (!isNhomId(x.san_pham_id) || seen.has(x.san_pham_id)) continue;
    if (typeof x.ten !== "string") continue;
    const ten = x.ten.trim();
    if (!ten || chars(ten) > NHOM_TEXT_MAX) continue;
    let brand = null;
    if (x.thuong_hieu != null) {
      if (typeof x.thuong_hieu !== "string" || chars(x.thuong_hieu) > NHOM_TEXT_MAX) continue;
      brand = x.thuong_hieu.trim() || null;
    }
    if (typeof x.diem !== "number" || !Number.isFinite(x.diem) || x.diem < -1 || x.diem > 1) continue;
    seen.add(x.san_pham_id);
    out.push({
      san_pham_id: x.san_pham_id,
      ten,
      thuong_hieu: brand,
      ma_vach: typeof x.ma_vach === "string" && CODE_RE.test(x.ma_vach) ? x.ma_vach : null,
      diem: x.diem
    });
  }
  return out.sort((a, b) => b.diem - a.diem); // sort của JS giữ thứ tự cũ khi bằng điểm
}

/**
 * Kết quả photoOutcome (src/front-photo.js) + danh sách món nhóm (nhomCandidates) → việc giao diện làm.
 * - nhom[0].diem ≥ threshold → { kind: "openNhom", top: null, nhomTop: nhom[0], others: (mục OFF / danh mục, kể cả mục 1
 *   của photoOutcome) ≤ 4, nhom: các món nhóm còn lại }: tự mở món nhóm (khung xác nhận như tự mở hiện nay).
 * - Còn lại → giữ nguyên kind / top / others của outcome, thêm nhom: cả danh sách (≤ 3), nhomTop: null. nhom rỗng →
 *   GIỐNG HỆT outcome đầu vào, chỉ thêm nhom: [] và nhomTop: null.
 * KHÔNG bỏ trùng giữa món nhóm và mục Open Food Facts cùng mã vạch: hai nguồn dữ liệu khác nhau (nhóm tự nhập / OFF),
 * người dùng thấy cả hai và tự chọn.
 * threshold (chỉ test truyền; app dùng mặc định NHOM_THRESHOLD): phải là số, không NaN (Infinity hợp lệ); sai → ném lỗi.
 * Ví dụ: nhomOutcome({ kind: "none", top: null, others: [] }, []) → { kind: "none", top: null, others: [], nhom: [], nhomTop: null }
 */
export function nhomOutcome(outcome, nhom, { threshold = NHOM_THRESHOLD } = {}) {
  if (typeof threshold !== "number" || Number.isNaN(threshold)) {
    throw new TypeError(`nhomOutcome: tham số threshold phải là số (nhận ${String(threshold)})`);
  }
  const list = Array.isArray(nhom) ? nhom.slice(0, NHOM_MAX) : [];
  if (list.length && typeof list[0]?.diem === "number" && list[0].diem >= threshold) {
    const others = outcome?.top ? [outcome.top, ...(outcome.others || [])].slice(0, 4) : (outcome?.others || []);
    return { kind: "openNhom", top: null, nhomTop: list[0], others, nhom: list.slice(1) };
  }
  return { ...outcome, nhom: list, nhomTop: null };
}

// ---- Một món nhóm đọc từ Supabase (bảng nhom_san_pham) ----

/**
 * ĐỊNH DẠNG cột dinh_duong (chốt ở vòng 6; vòng 7 ghi theo đúng dạng này): object JSON, khóa = tên khóa dinh dưỡng / 100 g
 * mà normalize() của src/off.js đang dùng (NUTRIENT_ROWS: "energy-kcal_100g", "fat_100g", "saturated-fat_100g",
 * "carbohydrates_100g", "sugars_100g", "fiber_100g", "proteins_100g", "salt_100g"), giá trị = số hữu hạn ≥ 0 (kcal cho
 * năng lượng, g cho phần còn lại, trên 100 g / 100 ml). Khóa thiếu = chưa có dữ liệu. Khóa lạ / giá trị sai (chuỗi, âm,
 * NaN, null) bị bỏ khi hiển thị.
 * Ví dụ: { "energy-kcal_100g": 450, "proteins_100g": 7.5, "salt_100g": 0.9 }
 */
export const NHOM_NUTRIENT_KEYS = Object.freeze(NUTRIENT_ROWS.map(([key]) => key));

/** dinh_duong → object chỉ gồm khóa của NHOM_NUTRIENT_KEYS có giá trị số hữu hạn ≥ 0 (không phải object → {}). */
export function nhomNutrition(obj) {
  const out = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const k of NHOM_NUTRIENT_KEYS) {
    if (!Object.hasOwn(obj, k)) continue;
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

/** Tên nguồn thông tin (cột nguon của kho-nhom.sql). */
export const NHOM_SOURCE_VI = Object.freeze({
  tay: "Người trong nhóm tự nhập",
  off: "Lấy từ Open Food Facts lúc thêm",
  "ocr-mat-sau": "Máy đọc chữ mặt sau, người thêm đã kiểm lại"
});

const text = (v, max) => (typeof v === "string" && v.trim() && chars(v.trim()) <= max ? v.trim() : "");

/** Ngày tạo (timestamptz của Postgres) → "dd/mm/yyyy" theo giờ Việt Nam; sai dạng → "". */
function dateVi(v) {
  if (typeof v !== "string" || !v) return "";
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 7 * 3600 * 1000); // giờ Việt Nam (UTC+7, không đổi giờ mùa hè)
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * Một dòng nhom_san_pham (fetchNhomProduct của src/nhom-data.js) → object đã làm sạch để render (renderNhomProduct).
 * Trường trống / sai dạng → "" (render hiện "chưa có dữ liệu"). di_ung: tên nhóm KHÔNG có tiền tố "en:" (vd "milk"),
 * chỉ nhận 14 giá trị trong CHECK của SQL (= khóa ALLERGEN_VI của off.js), đổi sang cùng dạng app dùng cho dị ứng:
 * allergenKeys (khóa, thứ tự ALLERGEN_KEYS) + allergens (tên tiếng Việt). Món nhóm không có "có thể lẫn vết": traceKeys [].
 * Có thêm các trường matchAllergies() của off.js cần (allergenKeys, traceKeys, hasAllergenData).
 */
export function nhomProductView(row) {
  const r = row && typeof row === "object" ? row : {};
  const nutriments = nhomNutrition(r.dinh_duong);
  const di = new Set(Array.isArray(r.di_ung) ? r.di_ung.filter((k) => typeof k === "string" && Object.hasOwn(ALLERGEN_VI, k)) : []);
  const allergenKeys = ALLERGEN_KEYS.filter((k) => di.has(k));
  return {
    id: isNhomId(r.id) ? r.id : "",
    name: text(r.ten, NHOM_TEXT_MAX),
    brand: text(r.thuong_hieu, NHOM_TEXT_MAX),
    quantity: text(r.khoi_luong, NHOM_TEXT_MAX),
    code: typeof r.ma_vach === "string" && CODE_RE.test(r.ma_vach) ? r.ma_vach : "",
    ingredients: text(r.thanh_phan, 5000),
    nutriments,
    hasNutriments: Object.keys(nutriments).length > 0,
    allergenKeys,
    allergens: allergenKeys.map((k) => ALLERGEN_VI[k]),
    traceKeys: [],
    // Mảng di_ung rỗng: không phân biệt "không có chất gây dị ứng" với "chưa nhập" → coi như chưa có dữ liệu (chiều an toàn).
    hasAllergenData: allergenKeys.length > 0,
    source: typeof r.nguon === "string" && Object.hasOwn(NHOM_SOURCE_VI, r.nguon) ? NHOM_SOURCE_VI[r.nguon] : "",
    createdAt: dateVi(r.tao_luc),
    nhom: true
  };
}

/** Câu khi tải món nhóm lỗi (không cảnh báo đỏ). */
export const NHOM_LOAD_FAIL_TEXT = "Không tải được món của nhóm. Thử lại sau.";
/** Câu trong khung sau khi bấm "Đúng" ở món nhóm tự mở: lịch sử tra cứu chỉ giữ mã Open Food Facts. */
export const NHOM_CONFIRM_STATUS = "Đã xác nhận. Món của nhóm không lưu vào lịch sử tra cứu.";
