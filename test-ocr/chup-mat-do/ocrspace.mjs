// Cách 1c: OCR.space gói miễn phí (không tạo tài khoản, không nâng gói) đọc front.jpg đã nén -> lưu dòng + khung chữ.
// Tìm OFF làm sau bằng run-ocr-off.mjs --tools 1c (đọc file đã lưu, không gọi lại OCR.space).
//
//   node chup-mat-do/ocrspace.mjs [--img-dir D:\tmp\chup-mat-do\anh-nen\1600] [--out D:\tmp\chup-mat-do\ocr\ocrspace-1c]
//
// Nguồn giới hạn (đọc 08/11/2026, https://ocr.space/ocrapi): gói Free 25.000 lượt / tháng, 500 lượt / ngày / IP,
// file ≤ 1 MB. Cấu hình CỐ ĐỊNH (chọn trước khi chạy, không chỉnh theo ảnh):
//   OCREngine=2 (Engine 1 đã bỏ, tự chuyển sang 2; trang ghi Engine 2 hỗ trợ "Vietnamese"; Engine 3 không ghi rõ),
//   language=auto (mã ngôn ngữ đã "deprecated", Engine 2 mặc định auto), isOverlayRequired=true (có khung chữ),
//   scale=true (phóng nội bộ, giúp chữ nhỏ), detectOrientation=true (ảnh xoay), filetype=JPG.
// Luật chi phí: ≤ 40 lượt lần chạy, ≤ 60 lượt cả đợt (tính bằng tổng tháng trong api_usage.json, khóa "ocrspace"),
// ngừng khi tổng tháng chạm 80% mức miễn phí; giãn ≥ 3 giây; cộng lượt TRƯỚC mỗi lượt gọi; 429 / hết hạn mức /
// đòi trả tiền thì ngừng hẳn. Key: OCRSPACE_API_KEY hoặc OCR_SPACE_API_KEY trong test-ocr/.env (không in, không ghi).
import fs from "node:fs";
import path from "node:path";
import { readKey, recordCall, readUsage, monthOf, redact } from "./api-common.mjs";
import { parseOcrSpace } from "./api-parse.mjs";
import { makeLimiter } from "./off-search.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const imgDir = opt("--img-dir", "D:\\tmp\\chup-mat-do\\anh-nen\\1600");
const outDir = opt("--out", "D:\\tmp\\chup-mat-do\\ocr\\ocrspace-1c");
const MAX_RUN = 40;
const MAX_DOT = 60;
const FREE_MONTH = 25000;
const GAP_MS = 3000;
const MAX_MINUTES = Number(opt("--max-minutes", "45"));
const ENDPOINT = "https://api.ocr.space/parse/image";
const CONFIG = { OCREngine: "2", language: "auto", isOverlayRequired: "true", scale: "true", detectOrientation: "true", filetype: "JPG" };

fs.mkdirSync(outDir, { recursive: true });
const key = readKey(["OCRSPACE_API_KEY", "OCR_SPACE_API_KEY"]);
const summaryFile = path.join(outDir, "_lan-chay.json");
const summary = { at: new Date().toISOString(), config: CONFIG, endpoint: ENDPOINT, calls: 0, ok: 0, errors: [], stop: null, keyName: key?.name ?? null };
if (!key) {
  summary.stop = "không có key (OCRSPACE_API_KEY / OCR_SPACE_API_KEY trong test-ocr/.env)";
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
  console.log(summary.stop);
  process.exit(0);
}

const limiter = makeLimiter(GAP_MS);
const start = Date.now();
const files = fs.readdirSync(imgDir).filter((f) => f.endsWith(".jpg")).sort();
for (const f of files) {
  const code = f.replace(/\.jpg$/, "");
  const out = path.join(outDir, `${code}__front.json`);
  if (fs.existsSync(out)) continue;
  if ((Date.now() - start) / 60000 > MAX_MINUTES) { summary.stop = `dừng vì hết giờ (${summary.ok}/${files.length} ảnh)`; break; }
  if (summary.calls >= MAX_RUN) { summary.stop = `đủ trần ${MAX_RUN} lượt lần chạy`; break; }
  const month = readUsage().ocrspace?.[monthOf()] ?? 0;
  if (month >= MAX_DOT) { summary.stop = `đủ trần ${MAX_DOT} lượt cả đợt (tháng ${month})`; break; }
  if (month >= 0.8 * FREE_MONTH) { summary.stop = `tổng tháng ${month} chạm 80% mức miễn phí`; break; }
  const bytes = fs.readFileSync(path.join(imgDir, f));
  if (bytes.length > 1_000_000) { summary.errors.push(`${code}: file ${bytes.length} byte > 1 MB, bỏ`); continue; }
  await limiter.wait();
  const n = recordCall("ocrspace"); // cộng TRƯỚC khi gọi
  summary.calls++;
  const form = new FormData();
  for (const [k, v] of Object.entries(CONFIG)) form.append(k, v);
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), `${code}.jpg`);
  const t0 = Date.now();
  let status = 0;
  let json = null;
  let err = null;
  try {
    const res = await fetch(ENDPOINT, { method: "POST", headers: { apikey: key.value }, body: form });
    status = res.status;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { err = redact(`HTTP ${status}: ${text.slice(0, 200)}`, key.value); }
  } catch (e) {
    err = redact(`lỗi mạng: ${e.message || e}`, key.value);
  }
  const seconds = (Date.now() - t0) / 1000;
  if (status === 429 || status === 402 || status === 403) {
    summary.stop = `HTTP ${status}: ngừng hẳn (${err ?? redact(JSON.stringify(json?.ErrorMessage ?? ""), key.value)})`;
    console.log(summary.stop);
    break;
  }
  const p = json ? parseOcrSpace(json) : { ok: false, lines: [], error: err, quota: false };
  if (p.quota) { summary.stop = `hết hạn mức: ${redact(p.error, key.value)}`; console.log(summary.stop); break; }
  if (!p.ok) {
    summary.errors.push(`${code}: ${redact(p.error, key.value)}`);
    console.log(`${code}: lỗi ${redact(p.error, key.value)} (lượt tháng ${n})`);
    continue;
  }
  summary.ok++;
  fs.writeFileSync(out, JSON.stringify({
    code, status: "ok", seconds, apiCalls: 1, config: CONFIG,
    processingMs: json.ProcessingTimeInMilliseconds ?? null, lines: p.lines,
  }), "utf8");
  console.log(`${code}: ${seconds.toFixed(1)} s, ${p.lines.length} dòng (lượt tháng ${n})`);
}
summary.monthTotal = readUsage().ocrspace?.[monthOf()] ?? 0;
summary.minutes = (Date.now() - start) / 60000;
fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
console.log(`Xong: ${summary.ok} ảnh, ${summary.calls} lượt lần này, tổng tháng ${summary.monthTotal}. ${summary.stop ?? ""}`);
