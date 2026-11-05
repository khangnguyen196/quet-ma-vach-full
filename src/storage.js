// Lịch sử quét và tủ đồ, lưu trong localStorage (chỉ trên máy này).
import { parseDate, isEntryDate, toQty, QTY_MAX, YEAR_MIN, YEAR_MAX } from "./pantry.js";

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
// Món trong tủ: { id, code, name, brand, expiresOn: "YYYY-MM-DD", qty, addedAt }. Không lưu ảnh.
// Tính số ngày còn hạn, sắp xếp… nằm ở pantry.js; file này chỉ đọc / ghi.
const PANTRY_KEY = "qmv-pantry";
const PANTRY_BACKUP_KEY = "qmv-pantry-backup";
const NAME_MAX = 120;

// Chuỗi gốc khi đọc thấy dữ liệu tủ đồ hỏng (hoặc phải sửa lại). Trước lần ghi kế tiếp sẽ chép sang
// khóa backup để không mất dữ liệu cũ (người dùng / người sửa app còn lấy lại được). Xem backupBroken().
let brokenRaw = null;

/** Lỗi do người dùng nhập sai hoặc không lưu được: message là câu tiếng Việt để hiện ra màn hình. */
function pantryError(message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.name = "PantryError";
  return err;
}

/** Món hợp lệ: có id (chuỗi) và expiresOn là ngày có thật dạng "YYYY-MM-DD". */
function isValidItem(x) {
  return x != null && typeof x === "object"
    && typeof x.id === "string" && x.id !== ""
    && parseDate(x.expiresOn) != null;
}

/** Chỉ giữ các trường app dùng, đúng kiểu (dữ liệu cũ / sửa tay có thể sai kiểu). */
function cleanItem(x) {
  const text = (v) => (typeof v === "string" ? v : "");
  return {
    id: x.id,
    code: text(x.code),
    name: text(x.name),
    brand: text(x.brand),
    expiresOn: x.expiresOn,
    qty: toQty(x.qty) ?? 1,
    addedAt: typeof x.addedAt === "number" ? x.addedAt : null
  };
}

/**
 * cleanItem có làm đổi món này không: một khóa có trong món gốc bị bỏ, hoặc khóa có ở cả 2 bên mà giá trị khác.
 * Khóa THIẾU ở món gốc (vd dạng cũ chưa có brand, addedAt) không tính là đổi.
 * Không so bằng JSON.stringify cả object: kết quả phụ thuộc thứ tự khóa, và dạng cũ sẽ bị coi là hỏng.
 */
function isChanged(orig, clean) {
  return Object.keys(orig).some((k) => !Object.hasOwn(clean, k) || orig[k] !== clean[k]);
}

/** Đọc tủ đồ. Dữ liệu hỏng thì không báo lỗi: trả phần đọc được (hoặc []) và ghi cảnh báo ra console. */
export function getPantry() {
  let raw;
  try { raw = localStorage.getItem(PANTRY_KEY); } catch { return []; } // localStorage bị chặn
  if (raw == null) return [];

  let data;
  try { data = JSON.parse(raw); } catch { data = undefined; }
  if (!Array.isArray(data)) {
    console.warn("Tủ đồ: dữ liệu đã lưu không phải danh sách, tạm coi như tủ trống.");
    brokenRaw = raw;
    return [];
  }
  const valid = data.filter(isValidItem);
  const items = valid.map(cleanItem);
  const dropped = data.length - items.length;
  const changed = valid.filter((x, i) => isChanged(x, items[i])).length;
  if (dropped) console.warn(`Tủ đồ: bỏ qua ${dropped} món hỏng (thiếu id hoặc sai ngày).`);
  if (changed) console.warn(`Tủ đồ: sửa lại ${changed} món có trường sai kiểu hoặc thừa.`);
  if (dropped || changed) brokenRaw = raw; // lần lưu tới sẽ backup chuỗi gốc
  return items;
}

/**
 * Chép chuỗi hỏng sang khóa backup, không bao giờ ghi đè backup cũ:
 * - chưa có PANTRY_BACKUP_KEY → ghi vào đó;
 * - đã có và giống hệt → thôi (không chép 2 lần cùng một bản);
 * - đã có và khác → ghi vào khóa mới "qmv-pantry-backup-<thời điểm>".
 * Lỗi khi ghi (bộ nhớ đầy…) thì ném ra cho savePantry xử lý.
 */
function backupBroken(raw) {
  const first = localStorage.getItem(PANTRY_BACKUP_KEY);
  if (first == null) { localStorage.setItem(PANTRY_BACKUP_KEY, raw); return; }
  if (first === raw) return;
  const t = Date.now();
  let key = `${PANTRY_BACKUP_KEY}-${t}`;
  for (let i = 1; localStorage.getItem(key) != null; i++) key = `${PANTRY_BACKUP_KEY}-${t}-${i}`; // trùng mili giây
  localStorage.setItem(key, raw);
  console.warn(`Tủ đồ: đã có bản backup cũ, bản hỏng lần này lưu ở khóa ${key}.`);
}

/** Ghi tủ đồ; không ghi được (bộ nhớ đầy, bị chặn) thì ném PantryError. */
function savePantry(list) {
  try {
    // Backup lỗi thì dừng luôn (nhảy xuống catch), KHÔNG ghi đè dữ liệu gốc
    if (brokenRaw != null) backupBroken(brokenRaw);
    localStorage.setItem(PANTRY_KEY, JSON.stringify(list));
    brokenRaw = null;
  } catch (e) {
    throw pantryError("Không lưu được tủ đồ (bộ nhớ trình duyệt đầy hoặc bị chặn).", e);
  }
}

/** Kiểm hạn và số lượng người dùng nhập; sai thì ném PantryError. Trả số lượng đã đổi sang số. */
function checkDateQty(expiresOn, qty) {
  if (expiresOn == null || String(expiresOn).trim() === "") throw pantryError("Cần chọn hạn sử dụng.");
  if (!isEntryDate(expiresOn)) {
    throw pantryError(`Hạn sử dụng không hợp lệ (năm cần 4 chữ số, từ ${YEAR_MIN} đến ${YEAR_MAX}).`);
  }
  const n = toQty(qty);
  if (n == null) throw pantryError(`Số lượng phải là số nguyên từ 1 đến ${QTY_MAX}.`);
  return n;
}

/** id ngắn, gần như không trùng: thời điểm (cơ số 36) + 4 ký tự ngẫu nhiên. */
function newId(list) {
  let id;
  do {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  } while (list.some((x) => x.id === id));
  return id;
}

/** Thêm 1 món. expiresOn dạng "YYYY-MM-DD" (giá trị của input type=date). Trả danh sách mới. */
export function addToPantry({ code, name, brand, expiresOn, qty = 1 }) {
  const cleanName = String(name ?? "").trim().slice(0, NAME_MAX);
  if (!cleanName) throw pantryError("Cần nhập tên món.");
  const n = checkDateQty(expiresOn, qty);
  const list = getPantry();
  list.push({
    id: newId(list),
    code: String(code ?? ""),
    name: cleanName,
    brand: String(brand ?? "").trim(),
    expiresOn,
    qty: n,
    addedAt: Date.now()
  });
  savePantry(list);
  return list;
}

/** Sửa hạn và số lượng của 1 món. Trả danh sách mới. */
export function updatePantryItem(id, { expiresOn, qty }) {
  const n = checkDateQty(expiresOn, qty);
  const list = getPantry();
  const item = list.find((x) => x.id === id);
  if (!item) throw pantryError("Không tìm thấy món này (có thể đã bị xóa).");
  item.expiresOn = expiresOn;
  item.qty = n;
  savePantry(list);
  return list;
}

/** Xóa 1 món. Trả danh sách mới. */
export function removeFromPantry(id) {
  const list = getPantry().filter((x) => x.id !== id);
  savePantry(list);
  return list;
}
