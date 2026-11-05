// Logic tủ đồ: số ngày còn hạn, trạng thái, sắp xếp, định dạng ngày.
// File này không đụng giao diện (DOM) và không đụng localStorage, nên chạy thử được bằng node.

/** Ngày dạng "YYYY-MM-DD" (giá trị của ô chọn ngày input type=date). */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Số ngày coi là "sắp hết hạn": còn 0..7 ngày thì tô vàng. */
export const SOON_DAYS = 7;

const MS_PER_DAY = 86400000;

/**
 * Đổi "YYYY-MM-DD" thành Date lúc 0 giờ theo giờ địa phương (không theo UTC).
 * Ngày không có thật (vd "2026-02-31") hoặc sai dạng thì trả null.
 */
export function parseDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d); // tháng trong Date đếm từ 0
  // new Date(2026, 1, 31) tự nhảy sang 03/03: kiểm lại để bắt ngày không có thật
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * Số ngày còn lại tới hạn; 0 = hạn cuối là hôm nay; âm = đã hết hạn.
 * today mặc định là lúc gọi hàm; truyền vào để test với ngày cố định.
 * Dùng Math.round vì ngày đổi giờ mùa hè dài 23 hoặc 25 giờ (chia 24 giờ ra số lẻ).
 */
export function daysLeft(expiresOn, today = new Date()) {
  const exp = parseDate(expiresOn);
  if (!exp) return NaN;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // 0 giờ hôm nay
  return Math.round((exp - start) / MS_PER_DAY);
}

/** Trạng thái theo số ngày còn lại: "expired" (đỏ), "soon" (vàng), "ok" (bình thường). */
export function expiryStatus(n) {
  if (n < 0) return "expired";
  if (n <= SOON_DAYS) return "soon";
  return "ok";
}

/** Chữ trạng thái, để màu không phải cách duy nhất phân biệt. */
export function expiryText(n) {
  if (n < 0) return `Đã hết hạn ${-n} ngày`;
  if (n === 0) return "Hạn cuối là hôm nay";
  return `Còn ${n} ngày`;
}

/** Sắp theo ngày hết hạn tăng dần (hết hạn trước lên đầu); trùng ngày thì theo tên. Không sửa mảng gốc. */
export function sortPantry(list) {
  return [...list].sort((a, b) =>
    String(a.expiresOn).localeCompare(String(b.expiresOn))
    || String(a.name ?? "").localeCompare(String(b.name ?? ""), "vi")
  );
}

/** "2026-11-05" → "05/11/2026" (tách chuỗi, không phụ thuộc cài đặt ngôn ngữ của máy). */
export function formatDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return String(s ?? "");
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

/** Số lượng hợp lệ là số nguyên ≥ 1; không hợp lệ thì trả null. */
export function toQty(v) {
  // Chỉ nhận số hoặc chuỗi (từ ô nhập); true/false, mảng… đều không hợp lệ
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === "")) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
