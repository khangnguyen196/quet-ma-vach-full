// Lịch sử quét, tủ đồ và hồ sơ dị ứng, lưu trong localStorage (chỉ trên máy này).
import { isEntryDate, toQty, isValidItem, cleanItem, NAME_MAX, QTY_MAX, YEAR_MIN, YEAR_MAX } from "./pantry.js";
import { cleanAllergyProfile } from "./off.js";
import { mergePantry, mergeProfile } from "./backup.js";

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

// ---- Hồ sơ dị ứng (giai đoạn 3): danh sách khóa nhóm, vd ["milk", "peanuts"] ----
const ALLERGY_KEY = "qmv-allergy-profile";

/** Đọc hồ sơ dị ứng; dữ liệu hỏng (không phải JSON, không phải mảng, khóa lạ) → chỉ giữ phần hợp lệ hoặc []. */
export function getAllergyProfile() {
  return cleanAllergyProfile(read(ALLERGY_KEY, []));
}

/**
 * Lưu hồ sơ dị ứng (bản đã làm sạch). Trả true khi ghi được, false khi localStorage ném lỗi
 * (bộ nhớ đầy, bị chặn). Không dùng write() vì write() nuốt lỗi, giao diện cần biết để báo "chưa lưu được".
 */
export function setAllergyProfile(keys) {
  try {
    localStorage.setItem(ALLERGY_KEY, JSON.stringify(cleanAllergyProfile(keys)));
    return true;
  } catch {
    return false;
  }
}

// ---- Tủ đồ (giai đoạn 2): mỗi món có hạn sử dụng ----
// Món trong tủ: { id, code, name, brand, expiresOn: "YYYY-MM-DD", qty, addedAt }. Không lưu ảnh.
// Tính số ngày còn hạn, sắp xếp… nằm ở pantry.js; file này chỉ đọc / ghi.
const PANTRY_KEY = "qmv-pantry";
const PANTRY_BACKUP_KEY = "qmv-pantry-backup";

// Chuỗi gốc khi đọc thấy dữ liệu tủ đồ hỏng (hoặc phải sửa lại). Trước lần ghi kế tiếp sẽ chép sang
// khóa backup để không mất dữ liệu cũ (người dùng / người sửa app còn lấy lại được). Xem backupBroken().
let brokenRaw = null;

/** Lỗi do người dùng nhập sai hoặc không lưu được: message là câu tiếng Việt để hiện ra màn hình. */
function pantryError(message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.name = "PantryError";
  return err;
}

// isValidItem / cleanItem (kiểm 1 món) nằm ở pantry.js, dùng chung với phần nhập file (backup.js).

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

/** Đã có bản backup giống hệt raw chưa: xét khóa PANTRY_BACKUP_KEY và mọi khóa "qmv-pantry-backup-…". */
function hasBackup(raw) {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key == null) continue;
    if (key !== PANTRY_BACKUP_KEY && !key.startsWith(`${PANTRY_BACKUP_KEY}-`)) continue;
    if (localStorage.getItem(key) === raw) return true;
  }
  return false;
}

/**
 * Chép chuỗi hỏng sang khóa backup, không bao giờ ghi đè backup cũ:
 * - đã có bản giống hệt ở PANTRY_BACKUP_KEY hoặc bất kỳ khóa "qmv-pantry-backup-…" nào → thôi
 *   (không chép 2 lần cùng một bản);
 * - chưa có PANTRY_BACKUP_KEY → ghi vào đó;
 * - đã có PANTRY_BACKUP_KEY (khác) → ghi vào khóa mới "qmv-pantry-backup-<thời điểm>".
 * Lỗi khi đọc / ghi (bộ nhớ đầy…) thì ném ra cho savePantry xử lý.
 */
function backupBroken(raw) {
  if (hasBackup(raw)) return;
  const first = localStorage.getItem(PANTRY_BACKUP_KEY);
  if (first == null) { localStorage.setItem(PANTRY_BACKUP_KEY, raw); return; }
  const key = newBackupKey();
  localStorage.setItem(key, raw);
  console.warn(`Tủ đồ: đã có bản backup cũ, bản hỏng lần này lưu ở khóa ${key}.`);
}

/** Khóa backup mới chưa dùng: "qmv-pantry-backup-<thời điểm>" (trùng mili giây thì thêm "-1", "-2"…). */
function newBackupKey() {
  const t = Date.now();
  let key = `${PANTRY_BACKUP_KEY}-${t}`;
  for (let i = 1; localStorage.getItem(key) != null; i++) key = `${PANTRY_BACKUP_KEY}-${t}-${i}`;
  return key;
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

// ---- Nhập tủ đồ từ file (giai đoạn 4, chuyển giữa các máy) ----

/**
 * Trước khi "Thay toàn bộ": chép chuỗi tủ đồ hiện tại sang khóa mới "qmv-pantry-backup-<thời điểm>".
 * Không có tủ (chưa có khóa, chuỗi rỗng, hoặc danh sách rỗng "[]") thì không cần chép.
 * Đã có bản giống hệt ở bất kỳ khóa backup nào thì thôi; không bao giờ ghi đè backup cũ.
 * Đọc / ghi lỗi thì ném ra (nơi gọi dừng, không ghi gì). Trả khóa đã ghi (hoặc null).
 */
function backupBeforeReplace() {
  const raw = localStorage.getItem(PANTRY_KEY);
  if (raw == null || raw.trim() === "" || raw.trim() === "[]") return null;
  if (hasBackup(raw)) return null;
  const key = newBackupKey();
  localStorage.setItem(key, raw);
  return key;
}

/**
 * Ghi dữ liệu đã đọc từ file (kết quả parseImport của backup.js: { pantry, allergyProfile }).
 * mode "merge" (Gộp): thêm món có id chưa có, id trùng giữ món trên máy; hồ sơ = hợp 2 bên.
 * mode "replace" (Thay toàn bộ): chép tủ cũ sang khóa backup TRƯỚC, chép lỗi thì dừng, không ghi gì;
 *   rồi thay tủ đồ và hồ sơ bằng dữ liệu trong file.
 * localProfile: hồ sơ đang dùng trên máy (mặc định đọc từ localStorage).
 * Ghi tủ đồ trước (lỗi → ném PantryError, hồ sơ chưa đụng tới), rồi hồ sơ.
 * Trả { pantry, added, kept, allergyProfile, profileSaved, backupKey }; profileSaved false = tủ đồ đã ghi
 * nhưng hồ sơ chưa lưu được.
 */
export function importPantryData(data, mode, localProfile = getAllergyProfile()) {
  let list, added, kept = 0, profile, backupKey = null;
  if (mode === "merge") {
    const r = mergePantry(getPantry(), data.pantry.filter(isValidItem).map(cleanItem));
    list = r.pantry;
    added = r.added;
    kept = r.kept;
    profile = mergeProfile(localProfile, data.allergyProfile);
  } else if (mode === "replace") {
    try {
      backupKey = backupBeforeReplace();
    } catch (e) {
      throw pantryError("Không lưu được bản dự phòng của tủ đồ hiện tại (bộ nhớ trình duyệt đầy hoặc bị chặn), chưa thay gì.", e);
    }
    list = data.pantry.filter(isValidItem).map(cleanItem);
    added = list.length;
    profile = cleanAllergyProfile(data.allergyProfile);
  } else {
    throw new Error(`Cách nhập không hợp lệ: ${mode}`);
  }
  savePantry(list);
  const profileSaved = setAllergyProfile(profile);
  return { pantry: list, added, kept, allergyProfile: profile, profileSaved, backupKey };
}
