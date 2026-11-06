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

/**
 * Màn So sánh: phải chờ thêm bao nhiêu ms trước khi gọi Open Food Facts lần nữa, để 2 lần gọi mạng cách nhau
 * ít nhất gapMs (kể cả 2 lượt so sánh khác nhau). lastCallAt: thời điểm (ms) lần gọi mạng trước, null / undefined /
 * -Infinity = chưa gọi lần nào. Đồng hồ lùi hoặc số hỏng → chờ đủ gapMs (không bao giờ chờ quá gapMs).
 * Ví dụ: compareWaitMs(10000, 10300) → 700; compareWaitMs(10000, 11500) → 0.
 */
export function compareWaitMs(lastCallAt, now, gapMs = 1000) {
  if (lastCallAt == null || lastCallAt === -Infinity) return 0;
  const wait = lastCallAt + gapMs - now;
  if (!Number.isFinite(wait) || now < lastCallAt) return gapMs;
  return Math.min(gapMs, Math.max(0, wait));
}
