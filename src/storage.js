// Lịch sử quét và tủ đồ, lưu trong localStorage (chỉ trên máy này).

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* đầy bộ nhớ hoặc bị chặn – bỏ qua */ }
}

// ---- Lịch sử: 10 mã gần nhất ----
const HISTORY_KEY = "qmv-history";

export function getHistory() { return read(HISTORY_KEY, []); }

export function addHistory(code, name) {
  const list = getHistory().filter((x) => x.code !== code);
  list.unshift({ code, name, at: Date.now() });
  const recent = list.slice(0, 10);
  write(HISTORY_KEY, recent);
  return recent;
}

// ---- Tủ đồ (giai đoạn 2): mỗi món có hạn sử dụng ----
const PANTRY_KEY = "qmv-pantry";

export function getPantry() { return read(PANTRY_KEY, []); }

/** expiresOn dạng "YYYY-MM-DD" (giá trị của input type=date). */
export function addToPantry({ code, name, expiresOn, qty = 1 }) {
  const list = getPantry();
  list.push({ id: Date.now().toString(36), code, name, expiresOn, qty });
  list.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  write(PANTRY_KEY, list);
  return list;
}

export function removeFromPantry(id) {
  const list = getPantry().filter((x) => x.id !== id);
  write(PANTRY_KEY, list);
  return list;
}

/** Số ngày còn lại tới hạn; âm nếu đã hết hạn. */
export function daysLeft(expiresOn) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiresOn + "T00:00:00");
  return Math.round((exp - today) / 86400000);
}
