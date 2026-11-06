// Xuất / nhập tủ đồ bằng file JSON (giai đoạn 4): chuyển tủ đồ + hồ sơ dị ứng giữa các máy, không cần máy chủ.
// File này không đụng giao diện (DOM) và không đụng localStorage, nên chạy thử được bằng node.
import { isValidItem, cleanItem, NAME_MAX } from "./pantry.js";
import { cleanAllergyProfile } from "./off.js";

export const EXPORT_APP = "quet-ma-vach-full";
export const EXPORT_KIND = "pantry-export";
export const EXPORT_VERSION = 1;
/** Giới hạn khi nhập: số ký tự của file và số món. */
export const IMPORT_MAX_CHARS = 1_000_000;
export const IMPORT_MAX_ITEMS = 1000;
/** Kiểm cỡ file (byte) trước khi đọc: 1 MB. */
export const IMPORT_MAX_BYTES = 1024 * 1024;

/** Lỗi khi đọc file nhập: message là câu tiếng Việt để hiện ra màn hình. */
function importError(message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.name = "ImportError";
  return err;
}

/**
 * Nội dung file xuất: { app, kind, version, exportedAt (ISO), pantry, allergyProfile }.
 * now: thời điểm xuất (truyền vào để test).
 */
export function buildExport(pantry, profile, now = new Date()) {
  return {
    app: EXPORT_APP,
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    pantry: (Array.isArray(pantry) ? pantry : []).filter(isValidItem).map(cleanItem),
    allergyProfile: cleanAllergyProfile(profile)
  };
}

/** Tên file xuất "tu-do-YYYY-MM-DD.json", ngày theo giờ máy (không theo UTC). */
export function exportFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `tu-do-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/**
 * Đọc chữ trong file nhập. Trả { pantry, allergyProfile, skipped } hoặc ném lỗi (name "ImportError")
 * có câu tiếng Việt. Món hỏng (thiếu id, sai ngày) và món trùng id (giữ món đầu) bị bỏ, đếm vào skipped.
 */
export function parseImport(text) {
  if (typeof text !== "string") throw importError("File không phải JSON hợp lệ.");
  if (text.length > IMPORT_MAX_CHARS) throw importError("File quá lớn (tối đa 1 MB).");
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw importError("File không phải JSON hợp lệ.", e);
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)
    || data.app !== EXPORT_APP || data.kind !== EXPORT_KIND) {
    throw importError("File này không phải file xuất tủ đồ của app Quét mã vạch đồ ăn.");
  }
  if (data.version !== EXPORT_VERSION) {
    throw importError(`Phiên bản file không được hỗ trợ (app chỉ đọc phiên bản ${EXPORT_VERSION}).`);
  }
  if (!Array.isArray(data.pantry)) throw importError("File hỏng: không có danh sách tủ đồ.");
  if (data.pantry.length > IMPORT_MAX_ITEMS) {
    throw importError(`File có quá nhiều món (tối đa ${IMPORT_MAX_ITEMS.toLocaleString("vi-VN")} món).`);
  }

  const seen = new Set();
  const pantry = [];
  let skipped = 0;
  for (const x of data.pantry) {
    if (!isValidItem(x) || seen.has(x.id)) { skipped++; continue; }
    seen.add(x.id);
    const item = cleanItem(x);
    item.name = item.name.slice(0, NAME_MAX);
    pantry.push(item);
  }
  return { pantry, allergyProfile: cleanAllergyProfile(data.allergyProfile), skipped };
}

/**
 * Gộp: thêm món có id chưa có trên máy; id trùng thì giữ món trên máy (không ghi đè).
 * Không sửa 2 mảng gốc. Trả { pantry, added, kept } (added = số món thêm, kept = số món trùng id giữ nguyên).
 */
export function mergePantry(local, incoming) {
  const ids = new Set(local.map((x) => x.id));
  const add = incoming.filter((x) => !ids.has(x.id));
  return { pantry: [...local, ...add], added: add.length, kept: incoming.length - add.length };
}

/** Hồ sơ dị ứng khi gộp: hợp 2 bên, làm sạch và xếp theo thứ tự 14 nhóm. */
export function mergeProfile(local, incoming) {
  return cleanAllergyProfile([...cleanAllergyProfile(local), ...cleanAllergyProfile(incoming)]);
}
