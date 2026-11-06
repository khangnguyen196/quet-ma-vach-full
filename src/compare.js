// So sánh 2 sản phẩm (giai đoạn 3): chỉ lấy số có sẵn, không đụng giao diện (DOM) và localStorage.
// Không tự tính: không đổi kJ ra kcal, không đổi natri ra muối, không lấy trường khác thay.

/** 6 dòng so sánh theo thứ tự hiển thị: [khóa, nhãn, đơn vị, khóa trong nutriments của normalize()]. */
export const COMPARE_ROWS = [
  ["energy", "Năng lượng", "kcal", "energy-kcal_100g"],
  ["sugars", "Đường", "g", "sugars_100g"],
  ["salt", "Muối", "g", "salt_100g"],
  ["fat", "Chất béo", "g", "fat_100g"],
  ["saturatedFat", "Chất béo bão hòa", "g", "saturated-fat_100g"],
  ["proteins", "Chất đạm", "g", "proteins_100g"]
];

/** Giá trị 1 trường của 1 sản phẩm: chỉ nhận số hữu hạn có sẵn, còn lại (thiếu, null, chữ) là null. */
function valueOf(product, field) {
  const n = product && product.nutriments && typeof product.nutriments === "object" ? product.nutriments : null;
  const v = n ? n[field] : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Bảng so sánh 2 sản phẩm đã normalize (hoặc null khi không có / không tìm thấy).
 * Trả 6 dòng { key, label, unit, a, b }; giá trị thiếu giữ null (giao diện ghi "chưa có dữ liệu").
 */
export function compareRows(a, b) {
  return COMPARE_ROWS.map(([key, label, unit, field]) => ({
    key, label, unit, a: valueOf(a, field), b: valueOf(b, field)
  }));
}
