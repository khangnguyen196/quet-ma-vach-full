// P2 vòng 4: đo cách 3 (AI nhỏ trong trình duyệt) bằng Playwright, như do-trinh-duyet.mjs.
//
//   node chup-mat-do/do-cach3.mjs --model florence|smolvlm --browser chromium|webkit --dtype q4|q8|fp16
//        [--limit N] [--shim-offscreen] [--timeout-min 45] [--tag thu1] [--score-only]
//
// Trang thử (máy chủ 127.0.0.1) nạp @huggingface/transformers bản ghim (embed-models.mjs TRANSFORMERS_CDN, jsDelivr),
// model từ HuggingFace (revision ghim, cach3.mjs). Ngữ cảnh trình duyệt mới mỗi lần chạy (thư mục hồ sơ tạm của
// Playwright nằm trong TEMP = D:\tmp), cache trống nên byte qua mạng = tải lần đầu. Không gọi Open Food Facts.
// Ảnh: front.jpg của các mã thử có ảnh (test-ocr/photos), thứ tự truth.csv. Mỗi ảnh 1 lần page.evaluate, ghi file
// sau mỗi ảnh (dừng giữa chừng vẫn còn số). Một ảnh > 120 giây -> dừng (luật P2.3a).
// Chấm (Node): T1 trên danh mục VN (chi-muc\danh-muc-vn.json), xem cach3.mjs scoreCach3.
// Ra: D:\tmp\chup-mat-do\ket-qua\cach3-<model>-<trình duyệt>[-<tag>].json
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TRANSFORMERS_CDN, TRANSFORMERS_VERSION } from "./embed-models.mjs";
import { CACH3_MODELS, scoreCach3 } from "./cach3.mjs";
import { parseCsv, median, maxOf } from "./lib.mjs";
import { buildBm25 } from "./vn-data.mjs";
import { startSampler } from "./sampler.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const model = opt("--model", "florence");
const browserName = opt("--browser", "chromium");
const dtype = opt("--dtype", "q4");
const limit = Number(opt("--limit", "0")) || Infinity;
const tag = opt("--tag", "");
const outDir = "D:\\tmp\\chup-mat-do\\ket-qua";
const photosDir = "D:\\quet-ma-vach-full\\test-ocr\\photos";
const catalogFile = "D:\\tmp\\chup-mat-do\\chi-muc\\danh-muc-vn.json";
const TIMEOUT_MS = Number(opt("--timeout-min", "45")) * 60000;
const PER_IMAGE_MS = 120000;
const LOAD_MS = 15 * 60000; // thử 1 ảnh ≤ 15 phút kể cả tải model
const file = path.join(outDir, `cach3-${model}-${browserName}${tag ? `-${tag}` : ""}.json`);
if (!CACH3_MODELS[model]) throw new Error(`model lạ: ${model}`);

const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const items = truth.filter((t) => fs.existsSync(path.join(photosDir, t.code, "front.jpg"))).slice(0, limit);
const index = buildBm25(JSON.parse(fs.readFileSync(catalogFile, "utf8")));

/** Chấm lại mọi ảnh đã có chữ + tóm tắt. */
function summarizeRun(run) {
  const rows = run.results || [];
  for (const r of rows) {
    const t = truth.find((x) => x.code === r.code);
    if (r.error || r.text == null) { Object.assign(r, { top1: false, inTop5: false }); continue; }
    Object.assign(r, scoreCach3(model, r.text, t, index));
  }
  const secs = rows.map((r) => r.seconds).filter(Number.isFinite);
  run.summary = {
    n: rows.length, ok: rows.filter((r) => !r.error).length,
    top1: rows.filter((r) => r.top1).length, top5: rows.filter((r) => r.inTop5).length,
    secondsMedian: median(secs), secondsMax: maxOf(secs),
  };
  if (model === "smolvlm") Object.assign(run.summary, { nameOk: rows.filter((r) => r.nameOk === true).length, brandOk: rows.filter((r) => r.brandOk === true).length });
}

if (argv.includes("--score-only")) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  summarizeRun(data.run);
  fs.writeFileSync(file, JSON.stringify(data, null, 1), "utf8");
  console.log(JSON.stringify(data.run.summary));
  process.exit(0);
}

const HARNESS = `<!doctype html><meta charset="utf-8"><title>cach-3</title><body><script type="module">
import { loadCach3 } from "/cach3.mjs";
// WebKit của Playwright trên Windows không có OffscreenCanvas (transformers.js cần để đọc / thu nhỏ ảnh).
// ?shim=1: thay bằng <canvas> thường (chỉ để đo trên máy tính; Safari 17+ trên iPhone có OffscreenCanvas thật).
window.shimOffscreen = false;
if (typeof OffscreenCanvas === "undefined" && new URL(location.href).searchParams.has("shim")) {
  window.OffscreenCanvas = class { constructor(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; } };
  window.shimOffscreen = true;
}
let T = null; let run = null;
window.load = async ({ model, dtype }) => {
  let gpuAdapter = null;
  try { gpuAdapter = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { gpuAdapter = false; }
  const t0 = performance.now();
  T = await import("${TRANSFORMERS_CDN}/dist/transformers.min.js");
  T.env.allowLocalModels = false;
  run = await loadCach3(T, model, { dtype, device: "wasm" });
  return { gpuAdapter, loadSeconds: (performance.now() - t0) / 1000 };
};
window.runOne = async (url) => {
  const t = performance.now();
  const img = await T.RawImage.fromURL(url);
  const r = await run(img);
  return { ...r, seconds: (performance.now() - t) / 1000, width: img.width, height: img.height };
};
window.ready = true;
</script>`;

function startServer() {
  const types = { ".mjs": "text/javascript", ".jpg": "image/jpeg", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = null;
    if (u === "/" || u === "/harness.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(HARNESS); return; }
    if (["/cach3.mjs", "/lib.mjs", "/vn-data.mjs"].includes(u)) f = path.join(HERE, u.slice(1));
    else if (u.startsWith("/photos/")) f = path.join(photosDir, ...u.slice(8).split("/").map((s) => path.basename(s)));
    if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const type = browserName === "chromium" ? pw.chromium : pw.webkit;
const launch = { headless: true };
if (browserName === "chromium" && process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
const m = CACH3_MODELS[model];
const run = { model, modelId: m.id, revision: m.revision, origin: m.origin, license: m.license, library: `@huggingface/transformers ${TRANSFORMERS_VERSION} (transformers.min.js, jsDelivr)`, dtype, backend: "wasm", browser: browserName, startedAt: new Date().toISOString(), planned: items.length, error: null, stoppedReason: null, results: [] };
const net = [];
const pending = [];
let wsPeak = 0; let wsBase = null; let heapPeak = 0;
let bs; let browser; let sampler; let heapTimer;
const tWall = Date.now();

function save() {
  run.wallSeconds = (Date.now() - tWall) / 1000;
  run.memory = { wsBaseline: wsBase, wsPeak: wsPeak || null, jsHeapPeak: browserName === "chromium" ? heapPeak || null : null, note: "WS = working set cả cây tiến trình trình duyệt (gồm trình duyệt trống); JS heap chỉ vùng nhớ JS, KHÔNG gồm bộ nhớ wasm / model" };
  const byFile = {};
  for (const e of net) {
    if (!/huggingface|hf\.co|xethub|jsdelivr/.test(e.host)) continue;
    const k = e.file;
    byFile[k] = (byFile[k] || 0) + (e.bytes || 0);
  }
  const sum = (f) => net.filter(f).reduce((s, e) => s + (e.bytes || 0), 0);
  run.firstLoadBytes = { total: sum(() => true), library: sum((e) => e.host === "cdn.jsdelivr.net"), model: sum((e) => /huggingface|hf\.co|xethub/.test(e.host)), photos: sum((e) => e.url.includes("/photos/")), byFile, requests: net.length };
  summarizeRun(run);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ run }, null, 1), "utf8");
}

try {
  bs = await type.launchServer(launch);
  browser = await type.connect(bs.wsEndpoint());
  run.browserVersion = browser.version();
  if (bs.process()?.pid) sampler = startSampler(bs.process().pid, (ws) => { if (wsBase == null) wsBase = ws; wsPeak = Math.max(wsPeak, ws); });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on("requestfinished", (req) => pending.push((async () => {
    let first = req;
    while (first.redirectedFrom()) first = first.redirectedFrom();
    const u = new URL(first.url());
    const e = { url: first.url().slice(0, 200), host: new URL(req.url()).hostname, file: u.hostname.includes("jsdelivr") ? `jsdelivr:${path.posix.basename(u.pathname)}` : u.pathname.split("/").slice(-2).join("/"), bytes: null };
    net.push(e);
    try { e.bytes = (await req.sizes()).responseBodySize; } catch (err) { e.note = String(err.message || err).slice(0, 120); }
  })()));
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message || e).slice(0, 300)}`));
  page.on("crash", () => consoleErrors.push("TRANG BỊ SẬP (crash)"));
  run.consoleErrors = consoleErrors;
  await page.goto(`${base}/harness.html${argv.includes("--shim-offscreen") ? "?shim=1" : ""}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  run.shimOffscreen = await page.evaluate(() => window.shimOffscreen);
  if (browserName === "chromium") {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    heapTimer = setInterval(async () => {
      try {
        const { metrics } = await cdp.send("Performance.getMetrics");
        heapPeak = Math.max(heapPeak, metrics.find((x) => x.name === "JSHeapUsedSize")?.value || 0);
      } catch { /* bận */ }
    }, 250);
  }
  const ld = await withTimeout(page.evaluate((a) => window.load(a), { model, dtype }), LOAD_MS, "nạp model quá 15 phút");
  run.gpuAdapter = ld.gpuAdapter;
  run.loadSeconds = ld.loadSeconds;
  run.loadNote = "giây nạp model = import thư viện + tải model qua mạng (cache trống) + tạo phiên onnxruntime-web; KHÔNG gồm lần chạy ảnh nào";
  console.log(`nạp ${model} ${dtype} ${browserName}: ${ld.loadSeconds.toFixed(1)} giây`);
  save();
  for (const t of items) {
    if (Date.now() - tWall > TIMEOUT_MS) { run.stoppedReason = `dừng vì hết giờ (${run.results.length}/${items.length})`; break; }
    try {
      const r = await withTimeout(page.evaluate((u) => window.runOne(u), `/photos/${t.code}/front.jpg`), PER_IMAGE_MS, "một ảnh quá 120 giây");
      run.results.push({ code: t.code, ...r });
      console.log(`${t.code}: ${r.seconds.toFixed(1)} s | ${String(r.text).slice(0, 100).replace(/\n/g, " / ")}`);
    } catch (e) {
      run.results.push({ code: t.code, error: String(e.message || e).slice(0, 400) });
      console.log(`${t.code}: LỖI ${String(e.message || e).slice(0, 200)}`);
      run.stoppedReason = `dừng: ${String(e.message || e).slice(0, 200)}`;
      save();
      break;
    }
    save();
  }
} catch (e) {
  run.error = String(e.message || e).slice(0, 800);
  console.log(`LỖI: ${run.error}`);
} finally {
  clearInterval(heapTimer);
  await Promise.allSettled(pending);
  await browser?.close().catch(() => {});
  await bs?.close().catch(() => {});
  sampler?.kill();
  server.close();
}
save();
console.log(JSON.stringify({ summary: run.summary, loadSeconds: run.loadSeconds, wsPeakMB: run.memory.wsPeak / 1e6, heapMB: run.memory.jsHeapPeak / 1e6, firstLoadMB: run.firstLoadBytes.total / 1e6, error: run.error, stopped: run.stoppedReason, consoleErrors: run.consoleErrors?.slice(0, 3) }, null, 1));
console.log(`Ghi: ${file}`);
process.exit(0);
