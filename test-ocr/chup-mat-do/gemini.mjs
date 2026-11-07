// Cách 4a: Gemini API gói miễn phí (project không gắn thanh toán, chỉ máy tính) đọc front.jpg đã thu ≤ 1024 px,
// trả JSON {ten, thuong_hieu, loai, dung_tich_khoi_luong, tu_khoa[]} -> lưu. Tìm OFF làm sau bằng
// run-ocr-off.mjs --tools 4a (dòng [thuong_hieu, ten] qua đúng hàm S2, cùng MAX_WORDS).
//
//   node chup-mat-do/gemini.mjs [--model gemini-3.6-flash] [--rpm 5]
//
// Nguồn (đọc 08/11/2026): https://ai.google.dev/gemini-api/docs/pricing (chuyển tới aistudio.google.com/docs/pricing):
// các model Flash / Flash-Lite đều "Free of charge" ở gói Free (Standard); dữ liệu gói Free được dùng để cải thiện
// sản phẩm. https://ai.google.dev/gemini-api/docs/rate-limits (chuyển tới aistudio.google.com/docs/rate-limits):
// KHÔNG ghi số RPM / RPD của gói Free, chỉ trỏ tới trang AI Studio cần đăng nhập (không đăng nhập). Vì không biết
// RPM, lấy mức thận trọng RPM = 5 -> giãn = max(7 giây, 60 / 5 + 1) = 13 giây. RPD: không biết; trần lần chạy 40 lượt.
// Lỗi 429 thường: chờ 60 giây thử lại 1 lần, lại 429 thì ngừng. Hết hạn mức ngày / đòi thanh toán / FAILED_PRECONDITION:
// ngừng ngay. KHÔNG bật billing. Cộng lượt vào api_usage.json khóa "gemini" TRƯỚC mỗi lượt gọi.
// Key: GEMINI_API_KEY trong test-ocr/.env, gửi qua header x-goog-api-key (không in, không ghi ra file).
import fs from "node:fs";
import path from "node:path";
import { readKey, recordCall, readUsage, monthOf, redact } from "./api-common.mjs";
import { geminiPrompt, parseGeminiJson, classifyGeminiError } from "./api-parse.mjs";
import { makeLimiter } from "./off-search.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const imgDir = opt("--img-dir", "D:\\tmp\\chup-mat-do\\anh-nen\\1024");
const outDir = opt("--out", "D:\\tmp\\chup-mat-do\\ocr\\gemini-4a");
const MODEL = opt("--model", "gemini-3.6-flash");
const RPM = Number(opt("--rpm", "5"));
const GAP_MS = Math.max(7000, (60 / RPM + 1) * 1000);
const MAX_RUN = 40;
const MAX_MINUTES = Number(opt("--max-minutes", "45"));
const PROMPT = geminiPrompt();

fs.mkdirSync(outDir, { recursive: true });
const key = readKey(["GEMINI_API_KEY"]);
const summaryFile = path.join(outDir, "_lan-chay.json");
const summary = { at: new Date().toISOString(), model: MODEL, rpmAssumed: RPM, gapMs: GAP_MS, prompt: PROMPT, calls: 0, ok: 0, retries: 0, errors: [], stop: null };
if (!key) {
  summary.stop = "không có key GEMINI_API_KEY";
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
  console.log(summary.stop);
  process.exit(0);
}
const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limiter = makeLimiter(GAP_MS);

async function callOnce(b64) {
  await limiter.wait();
  const n = recordCall("gemini"); // cộng TRƯỚC khi gọi
  summary.calls++;
  const t0 = Date.now();
  const body = {
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: b64 } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  let status = 0;
  let json = null;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key.value }, body: JSON.stringify(body) });
    status = res.status;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = { error: { message: text.slice(0, 300) } }; }
  } catch (e) {
    json = { error: { message: `lỗi mạng: ${e.message || e}` } };
  }
  return { status, json, seconds: (Date.now() - t0) / 1000, month: n };
}

const start = Date.now();
const files = fs.readdirSync(imgDir).filter((f) => f.endsWith(".jpg")).sort();
outer: for (const f of files) {
  const code = f.replace(/\.jpg$/, "");
  const out = path.join(outDir, `${code}__front.json`);
  if (fs.existsSync(out)) continue;
  if ((Date.now() - start) / 60000 > MAX_MINUTES) { summary.stop = `dừng vì hết giờ (${summary.ok}/${files.length} ảnh)`; break; }
  if (summary.calls >= MAX_RUN) { summary.stop = `đủ trần ${MAX_RUN} lượt lần chạy`; break; }
  const b64 = fs.readFileSync(path.join(imgDir, f)).toString("base64");
  let r = await callOnce(b64);
  let calls = 1;
  for (;;) {
    if (r.status === 200) break;
    const kind = classifyGeminiError(r.status, r.json);
    const msg = redact(`HTTP ${r.status} ${r.json?.error?.status ?? ""}: ${r.json?.error?.message ?? ""}`.slice(0, 400), key.value);
    if (kind === "billing" || kind === "daily") { summary.stop = `ngừng ngay (${kind}): ${msg}`; console.log(summary.stop); break outer; }
    if (kind === "rate" && calls === 1 && summary.calls < MAX_RUN) {
      console.log(`${code}: 429, chờ 60 giây thử lại 1 lần`);
      summary.retries++;
      await sleep(60000);
      r = await callOnce(b64);
      calls++;
      continue;
    }
    if (kind === "rate") { summary.stop = `ngừng: lại 429 sau khi chờ: ${msg}`; console.log(summary.stop); break outer; }
    summary.errors.push(`${code}: ${msg}`);
    console.log(`${code}: lỗi ${msg}`);
    if (r.status === 404) { summary.stop = `model không có: ${msg}`; break outer; }
    continue outer;
  }
  const parsed = parseGeminiJson(r.json);
  summary.ok++;
  fs.writeFileSync(out, JSON.stringify({
    code, status: parsed ? "ok" : "json lỗi", seconds: r.seconds, apiCalls: calls, model: MODEL,
    modelVersion: r.json?.modelVersion ?? null, usage: r.json?.usageMetadata ?? null, parsed,
    rawText: (r.json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").slice(0, 2000),
  }), "utf8");
  console.log(`${code}: ${r.seconds.toFixed(1)} s ${parsed ? `[${parsed.thuong_hieu ?? "-"} | ${parsed.ten ?? "-"}]` : "JSON lỗi"} (lượt tháng ${r.month})`);
}
summary.monthTotal = readUsage().gemini?.[monthOf()] ?? 0;
summary.minutes = (Date.now() - start) / 60000;
fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
console.log(`Xong: ${summary.ok} ảnh, ${summary.calls} lượt lần này, tổng tháng ${summary.monthTotal}. ${summary.stop ?? ""}`);
