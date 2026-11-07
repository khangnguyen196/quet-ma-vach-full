// Phần dùng chung cho các script gọi API ảnh (1c OCR.space, 4a Gemini) của đợt chup-mat-do.
//  - Đọc key từ test-ocr/.env lúc chạy: KHÔNG in, KHÔNG ghi key ra kết quả / log.
//  - Đếm lượt theo dịch vụ / tháng trong test-ocr/outputs/api_usage.json (không commit), cộng TRƯỚC mỗi lượt gọi,
//    giữ nguyên các khóa cũ.
import fs from "node:fs";
import path from "node:path";

export const ENV_FILE = "D:\\quet-ma-vach-full\\test-ocr\\.env";
export const USAGE_FILE = "D:\\quet-ma-vach-full\\test-ocr\\outputs\\api_usage.json";

/** Lấy giá trị biến đầu tiên có trong nội dung kiểu .env (KEY=giá trị, bỏ dòng #, bỏ nháy bao quanh). */
export function parseEnvKey(text, names) {
  const map = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    map[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  for (const n of names) if (map[n]) return { name: n, value: map[n] };
  return null;
}

/** Đọc key (biến môi trường trước, rồi file .env). Trả { name, value } hoặc null. Không in giá trị. */
export function readKey(names, envFile = ENV_FILE) {
  for (const n of names) if (process.env[n]) return { name: n, value: process.env[n] };
  if (!fs.existsSync(envFile)) return null;
  return parseEnvKey(fs.readFileSync(envFile, "utf8"), names);
}

/** Tháng dạng "2026-11". */
export const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Cộng 1 lượt (thuần): trả object mới, giữ khóa cũ. */
export function bumpUsage(usage, service, month) {
  const u = JSON.parse(JSON.stringify(usage || {}));
  u[service] = u[service] || {};
  u[service][month] = (u[service][month] || 0) + 1;
  return u;
}

export function readUsage(file = USAGE_FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

/** Cộng 1 lượt vào file và trả số lượt tháng sau khi cộng. Gọi TRƯỚC mỗi lượt gọi API. */
export function recordCall(service, month = monthOf(), file = USAGE_FILE) {
  const u = bumpUsage(readUsage(file), service, month);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(u, null, 2), "utf8");
  return u[service][month];
}

/** Bỏ mọi chỗ key xuất hiện trong chuỗi (phòng lỗi API lặp lại URL có key). */
export function redact(s, key) {
  const t = String(s ?? "");
  return key ? t.split(key).join("***") : t;
}
