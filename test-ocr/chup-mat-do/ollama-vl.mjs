// Cách 4b vòng 5: AI ảnh chạy trên máy qua Ollama (chỉ máy tính / máy chủ), luật CHỐT ở đầu tong-hop-v5.md.
//
//   node chup-mat-do/ollama-vl.mjs [--model qwen2.5vl:3b] [--limit N] [--no-json] [--deadline <ISO>] [--tag x]
//
// - Tự bật `ollama serve` chỉ nghe 127.0.0.1 (OLLAMA_HOST=127.0.0.1:11434, model ở OLLAMA_MODELS), log nối vào
//   D:\tmp\chup-mat-do\ollama.log; xong (hoặc lỗi) thì tắt serve để giải phóng RAM. Không key, không gọi mạng nào
//   ngoài 127.0.0.1 (model phải pull sẵn).
// - Đầu vào = đúng ảnh của 4a: ảnh nén D:\tmp\chup-mat-do\anh-nen\1024\<mã>.jpg (mặc định --img-dir của gemini.mjs),
//   30 ảnh theo thứ tự truth.csv. Câu hỏi = geminiPrompt(). /api/generate, format json, temperature 0, seed 0,
//   num_ctx 4096, stream false, 1 ảnh / lần, hết giờ 300 giây / ảnh.
// - Giây nạp lần đầu: 1 lệnh /api/generate không có prompt (Ollama chỉ nạp model) trước ảnh đầu.
// - Bộ nhớ: working set cả cây tiến trình của `ollama serve` (gồm tiến trình runner), lấy mẫu 250 ms (sampler.mjs).
// - Dừng: hết --deadline (90 phút của P3); ảnh đầu > 300 giây (-> dự phòng moondream, chạy lại với --model); sau 10
//   ảnh trung vị > 180 giây.
// Ra: D:\tmp\chup-mat-do\ocr\ollama-4b\<mã>__front.json (thô; model dự phòng: thư mục con <model>) + D:\tmp\chup-mat-do\ket-qua\4b-<model>.json.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { geminiPrompt } from "./api-parse.mjs";
import { parseCsv } from "./lib.mjs";
import { buildBm25 } from "./vn-data.mjs";
import { startSampler } from "./sampler.mjs";
import { ollamaBody, scoreOllama, slowStopReason, summarize4b } from "./ollama-parse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const MODEL = opt("--model", "qwen2.5vl:3b");
const JSON_MODE = !argv.includes("--no-json");
const limit = Number(opt("--limit", "0")) || Infinity;
const deadline = Date.parse(opt("--deadline", "")) || Date.now() + 90 * 60000;
const tag = opt("--tag", "");
const imgDir = "D:\\tmp\\chup-mat-do\\anh-nen\\1024";
const safe = MODEL.replace(/[^a-z0-9.]+/gi, "-");
const rawBase = "D:\\tmp\\chup-mat-do\\ocr\\ollama-4b";
const rawDir = MODEL === "qwen2.5vl:3b" ? rawBase : path.join(rawBase, safe); // model chính đúng đường dẫn CHỐT
const outFile = path.join("D:\\tmp\\chup-mat-do\\ket-qua", `4b-${safe}${tag ? `-${tag}` : ""}.json`);
const catalogFile = "D:\\tmp\\chup-mat-do\\chi-muc\\danh-muc-vn.json";
const OLLAMA_EXE = process.env.OLLAMA_EXE || "D:\\ollama\\app\\ollama.exe";
const HOST = "127.0.0.1:11434";
const BASE = `http://${HOST}`;
const PER_IMAGE_MS = 300000;
const PROMPT = geminiPrompt();
fs.mkdirSync(rawDir, { recursive: true });

const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const items = truth.filter((t) => fs.existsSync(path.join(imgDir, `${t.code}.jpg`))).slice(0, limit);
const index = buildBm25(JSON.parse(fs.readFileSync(catalogFile, "utf8")));

/** RAM trống / tổng (byte) từ Win32_OperatingSystem (đơn vị gốc KB). */
function ramFree() {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "$o = Get-CimInstance Win32_OperatingSystem; \"$($o.FreePhysicalMemory) $($o.TotalVisibleMemorySize)\""], { encoding: "utf8" });
  const [free, total] = out.trim().split(/\s+/).map(Number);
  return { freeBytes: free * 1024, totalBytes: total * 1024, at: new Date().toISOString() };
}

const run = {
  method: "4b", model: MODEL, jsonMode: JSON_MODE, input: `${imgDir}\\<mã>.jpg (ảnh nén cạnh dài ≤ 1024 px, như 4a)`,
  prompt: PROMPT, request: { endpoint: "/api/generate", ...ollamaBody(MODEL, "<geminiPrompt>", "<ảnh>", { json: JSON_MODE }), images: ["<1 ảnh base64>"] },
  perImageTimeoutS: PER_IMAGE_MS / 1000, planned: items.length, denominator: 30, deadline: new Date(deadline).toISOString(),
  startedAt: new Date().toISOString(), finishedAt: null, ollamaVersion: null, modelInfo: null,
  ramBefore: ramFree(), ramAfterRun: null, ramAfterStop: null, loadSeconds: null, memory: { wsPeak: 0 },
  results: [], stoppedReason: null, error: null, serveStopped: false,
};
const save = () => { summarize(); fs.writeFileSync(outFile, JSON.stringify({ run }, null, 1), "utf8"); };
function summarize() {
  run.summary = summarize4b(run.results, run.planned); // vòng 6: tách đã thử / chạy xong / dự kiến
}

// ---- bật serve (chỉ 127.0.0.1) + lấy mẫu bộ nhớ ----
const log = fs.openSync("D:\\tmp\\chup-mat-do\\ollama.log", "a");
fs.writeSync(log, `\n==== ollama-vl.mjs ${run.startedAt} model ${MODEL}\n`);
const serve = spawn(OLLAMA_EXE, ["serve"], { env: { ...process.env, OLLAMA_HOST: HOST }, stdio: ["ignore", log, log] });
const sampler = startSampler(serve.pid, (ws) => { if (ws > run.memory.wsPeak) run.memory.wsPeak = ws; });
async function stopServe() {
  if (run.serveStopped) return;
  try { execFileSync("taskkill", ["/PID", String(serve.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  sampler.kill();
  run.serveStopped = true;
  await new Promise((r) => setTimeout(r, 3000));
  run.ramAfterStop = ramFree();
}
process.on("SIGINT", async () => { run.stoppedReason = "bị ngắt (SIGINT)"; await stopServe(); save(); process.exit(1); });

async function post(p, body, ms) {
  const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 300) }; }
  return { status: res.status, json };
}

try {
  for (let i = 0; i < 60; i++) {
    try { run.ollamaVersion = (await (await fetch(`${BASE}/api/version`)).json()).version; break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!run.ollamaVersion) throw new Error("ollama serve không lên trong 30 giây");
  const tags = await (await fetch(`${BASE}/api/tags`)).json();
  const m = (tags.models || []).find((x) => x.name === MODEL || x.model === MODEL);
  if (!m) throw new Error(`chưa pull model ${MODEL}`);
  run.modelInfo = { name: m.name, digest: m.digest, sizeBytes: m.size, details: m.details, modifiedAt: m.modified_at };
  console.log(`Ollama ${run.ollamaVersion}, ${MODEL} ${m.digest.slice(0, 12)} ${(m.size / 1e9).toFixed(2)} GB; RAM trống ${(run.ramBefore.freeBytes / 1e9).toFixed(2)} GB`);

  const t0 = Date.now();
  const load = await post("/api/generate", { model: MODEL, keep_alive: "30m" }, PER_IMAGE_MS);
  run.loadSeconds = (Date.now() - t0) / 1000;
  if (load.status !== 200) throw new Error(`nạp model lỗi HTTP ${load.status}: ${JSON.stringify(load.json).slice(0, 300)}`);
  console.log(`nạp ${MODEL}: ${run.loadSeconds.toFixed(1)} giây`);
  save();

  for (const t of items) {
    if (Date.now() > deadline) { run.stoppedReason = `dừng vì hết giờ (${run.results.length}/${items.length})`; break; }
    const rawFile = path.join(rawDir, `${t.code}__front.json`);
    const b64 = fs.readFileSync(path.join(imgDir, `${t.code}.jpg`)).toString("base64");
    const a = Date.now();
    let row;
    try {
      const r = await post("/api/generate", ollamaBody(MODEL, PROMPT, b64, { json: JSON_MODE }), PER_IMAGE_MS);
      const seconds = (Date.now() - a) / 1000;
      if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
      const text = String(r.json.response ?? "");
      const stats = { total_duration: r.json.total_duration, load_duration: r.json.load_duration, prompt_eval_count: r.json.prompt_eval_count, eval_count: r.json.eval_count, eval_duration: r.json.eval_duration };
      fs.writeFileSync(rawFile, JSON.stringify({ code: t.code, model: MODEL, status: "ok", seconds, response: text, stats }), "utf8");
      row = { code: t.code, status: "ok", seconds, response: text.slice(0, 1500), ...scoreOllama(text, t, index) };
    } catch (e) {
      const seconds = (Date.now() - a) / 1000;
      const msg = e.name === "TimeoutError" ? `quá ${PER_IMAGE_MS / 1000} giây` : String(e.message || e).slice(0, 300);
      fs.writeFileSync(rawFile, JSON.stringify({ code: t.code, model: MODEL, status: `lỗi: ${msg}`, seconds }), "utf8");
      row = { code: t.code, status: `lỗi: ${msg}`, seconds, top1: false, inTop5: false };
    }
    run.results.push(row);
    save();
    console.log(`${t.code}: ${row.seconds.toFixed(1)} s ${row.status === "ok" ? `rank ${row.rank ?? "-"} [${row.parsed?.thuong_hieu ?? "-"} | ${row.parsed?.ten ?? "-"}]` : row.status}`);
    if (run.results.length === 1 && row.status !== "ok") { run.stoppedReason = `ảnh thử đầu không xong (${row.status}) -> theo CHỐT chuyển dự phòng`; break; }
    const slow = slowStopReason(run.results); // vòng 5: tính cả ảnh quá giờ (bản chạy đầu chỉ lấy ảnh ok)
    if (slow) { run.stoppedReason = slow; break; }
  }
  run.ramAfterRun = ramFree();
} catch (e) {
  run.error = String(e.message || e).slice(0, 400);
  console.log(`LỖI: ${run.error}`);
}
await stopServe();
run.finishedAt = new Date().toISOString();
save();
console.log(`Xong: ${JSON.stringify(run.summary)}; ${run.stoppedReason ?? ""}; serve đã dừng: ${run.serveStopped}. Ghi: ${outFile}`);
process.exit(0);
