// P2.3–P2.4 vòng 3: đo cách 2 (tìm theo hình) trong trình duyệt bằng Playwright (Chromium + WebKit), như web-ocr.
//
//   node chup-mat-do/do-trinh-duyet.mjs --model clip|dinov2 --browser chromium|webkit [--out D:\tmp\chup-mat-do\ket-qua]
//
// Trang thử (máy chủ 127.0.0.1 của script) nạp @huggingface/transformers bản ghim TRANSFORMERS_VERSION từ jsDelivr,
// model từ HuggingFace (bản revision ghim, embed-models.mjs), chỉ mục (int8) từ máy chủ local. Ngữ cảnh trình duyệt
// mới mỗi lần chạy (cache trống) nên byte qua mạng = tải lần đầu. Không gọi Open Food Facts.
// Truy vấn: front.jpg của mã thử dùng được (2 + 1 phụ) + ảnh truy vấn của bộ phụ (chi-muc\loo.json).
// Kiểm khớp Node – trình duyệt: 5 ảnh chỉ mục đầu, cosine vector trình duyệt với vector Node (int8 đã giải lượng tử).
// Bộ nhớ: working set cả cây tiến trình trình duyệt (PowerShell lấy mẫu 250 ms, như web-ocr/run-browser.mjs);
// JS heap qua CDP (chỉ Chromium). Backend: wasm (onnxruntime-web; WebGPU chỉ ghi có / không có adapter).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TRANSFORMERS_CDN } from "./embed-models.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const model = opt("--model", "clip");
const browserName = opt("--browser", "chromium");
const outDir = opt("--out", "D:\\tmp\\chup-mat-do\\ket-qua");
const idxDir = "D:\\tmp\\chup-mat-do\\chi-muc";
const photosDir = "D:\\quet-ma-vach-full\\test-ocr\\photos";
const TIMEOUT_MS = Number(opt("--timeout-min", "35")) * 60000; // GIỚI HẠN THỜI GIAN mỗi model ≤ 40 phút

const chon = JSON.parse(fs.readFileSync(path.join(idxDir, "chon.json"), "utf8"));
const loo = JSON.parse(fs.readFileSync(path.join(idxDir, "loo.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(idxDir, model, "index.json"), "utf8"));
const SIDE_CODE = "8934572260543";

// truy vấn: { id, set: "chinh" | "phu-xem-tay" | "bo-phu", code (đáp án), url }
const queries = [];
for (const s of chon.selected.filter((x) => x.test)) {
  queries.push({ id: `test-${s.code}`, set: s.code === SIDE_CODE ? "phu-xem-tay" : "chinh", code: s.code, url: `/photos/${s.code}/front.jpg` });
}
for (const p of loo.pairs) queries.push({ id: `loo-${p.code}`, set: "bo-phu", code: p.code, url: `/anh/${p.code}_${p.queryImgid}.400.jpg` });
const checkItems = meta.items.slice(0, 5).map((it, i) => ({ i, url: `/anh/${it.code}_${it.imgid}.400.jpg` }));

const HARNESS = `<!doctype html><meta charset="utf-8"><title>cach-2</title><body><script type="module">
import { loadEmbedder, topK, dot, l2norm } from "/embed-models.mjs";
window.runAll = async ({ model, queries, checkItems }) => {
  const out = { gpuAdapter: null, results: [], check: [] };
  try { out.gpuAdapter = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { out.gpuAdapter = false; }
  const t0 = performance.now();
  const T = await import("${TRANSFORMERS_CDN}/dist/transformers.web.min.js");
  T.env.allowLocalModels = false;
  const embed = await loadEmbedder(T, model, { device: "wasm" });
  // làm nóng không tính: nạp model xong là phiên đã sẵn, lần chạy đầu tính vào giây nạp model
  const [bin, info] = await Promise.all([fetch("/idx/index.bin").then((r) => r.arrayBuffer()), fetch("/idx/index.json").then((r) => r.json())]);
  const q8 = new Int8Array(bin);
  const index = info.items.map((it, i) => ({ code: it.code, vec: l2norm(Array.from(q8.subarray(i * info.dims, (i + 1) * info.dims), (x) => x / 127)) }));
  await embed(await T.RawImage.fromURL(checkItems[0].url));
  out.loadSeconds = (performance.now() - t0) / 1000;
  for (const c of checkItems) {
    const v = await embed(await T.RawImage.fromURL(c.url));
    out.check.push({ i: c.i, cos: dot(v, index[c.i].vec) });
  }
  for (const q of queries) {
    const t = performance.now();
    try {
      const v = await embed(await T.RawImage.fromURL(q.url));
      const top = topK(index, v, 5);
      out.results.push({ id: q.id, seconds: (performance.now() - t) / 1000, top5: top.map((x) => x.code), scores: top.map((x) => +x.score.toFixed(4)) });
    } catch (e) {
      out.results.push({ id: q.id, error: String(e && e.message || e) });
    }
  }
  return out;
};
window.ready = true;
</script>`;

function startServer() {
  const types = { ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".bin": "application/octet-stream", ".html": "text/html" };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = null;
    if (u === "/" || u === "/harness.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(HARNESS); return; }
    if (u === "/embed-models.mjs") file = path.join(HERE, "embed-models.mjs");
    else if (u.startsWith("/idx/")) file = path.join(idxDir, model, path.basename(u));
    else if (u.startsWith("/anh/")) file = path.join(idxDir, "anh", path.basename(u));
    else if (u.startsWith("/photos/")) file = path.join(photosDir, ...u.slice(8).split("/").map((s) => path.basename(s)));
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

// Lấy mẫu bộ nhớ cả cây tiến trình (chép từ web-ocr/run-browser.mjs startSampler, cùng cách đo vòng 1).
function startSampler(rootPid, onSample) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$root = ${Number(rootPid)}
$ids = @($root); $lastTree = [DateTime]::MinValue
while ($true) {
  if (((Get-Date) - $lastTree).TotalMilliseconds -ge 2000) {
    $all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId
    $kids = @{}
    foreach ($p in $all) { $pp = [int]$p.ParentProcessId; if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.ArrayList }; [void]$kids[$pp].Add([int]$p.ProcessId) }
    $ids = New-Object System.Collections.ArrayList; $queue = New-Object System.Collections.Queue; $queue.Enqueue($root)
    while ($queue.Count -gt 0) { $id = $queue.Dequeue(); if ($ids.Contains($id)) { continue }; [void]$ids.Add($id); if ($kids.ContainsKey($id)) { foreach ($c in $kids[$id]) { $queue.Enqueue($c) } } }
    $lastTree = Get-Date
  }
  $total = 0; $n = 0
  foreach ($id in $ids) { try { $p = [System.Diagnostics.Process]::GetProcessById($id); $total += $p.WorkingSet64; $n++ } catch {} }
  if ($n -eq 0) { break }
  [Console]::Out.WriteLine("$total")
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 250
}`;
  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  ps.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onSample(Number(line));
    }
  });
  return ps;
}

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const type = browserName === "chromium" ? pw.chromium : pw.webkit;
const launch = { headless: true };
if (browserName === "chromium" && process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
const run = { model, browser: browserName, startedAt: new Date().toISOString(), queries: queries.length, error: null };
const net = [];
const pending = [];
let wsPeak = 0;
let wsBase = null;
let heapPeak = 0;
let bs;
let browser;
let sampler;
let heapTimer;
let res = null;
const tWall = Date.now();
try {
  bs = await type.launchServer(launch);
  browser = await type.connect(bs.wsEndpoint());
  run.browserVersion = browser.version();
  if (bs.process()?.pid) sampler = startSampler(bs.process().pid, (ws) => { if (wsBase == null) wsBase = ws; wsPeak = Math.max(wsPeak, ws); });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on("requestfinished", (req) => pending.push((async () => {
    let first = req;
    while (first.redirectedFrom()) first = first.redirectedFrom();
    const host = new URL(first.url()).hostname;
    const e = { url: first.url().slice(0, 160), host, bytes: null };
    net.push(e);
    try { e.bytes = (await req.sizes()).responseBodySize; } catch (err) { e.note = String(err.message || err).slice(0, 120); }
  })()));
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message || e).slice(0, 300)}`));
  run.consoleErrors = consoleErrors;
  await page.goto(`${base}/harness.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  if (browserName === "chromium") {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    heapTimer = setInterval(async () => {
      try {
        const { metrics } = await cdp.send("Performance.getMetrics");
        heapPeak = Math.max(heapPeak, metrics.find((m) => m.name === "JSHeapUsedSize")?.value || 0);
      } catch { /* bận */ }
    }, 250);
  }
  res = await Promise.race([
    page.evaluate((a) => window.runAll(a), { model, queries, checkItems }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`quá ${TIMEOUT_MS / 60000} phút (dừng vì hết giờ)`)), TIMEOUT_MS)),
  ]);
} catch (e) {
  run.error = String(e.message || e).slice(0, 600);
} finally {
  clearInterval(heapTimer);
  await Promise.allSettled(pending);
  await browser?.close().catch(() => {});
  await bs?.close().catch(() => {});
  sampler?.kill();
  server.close();
}

run.wallSeconds = (Date.now() - tWall) / 1000;
run.memory = { wsBaseline: wsBase, wsPeak: wsPeak || null, jsHeapPeak: browserName === "chromium" ? heapPeak || null : null };
const sum = (f) => net.filter(f).reduce((s, e) => s + (e.bytes || 0), 0);
run.firstLoadBytes = {
  total: sum(() => true),
  library: sum((e) => e.host === "cdn.jsdelivr.net"),
  model: sum((e) => /huggingface|hf\.co|xethub/.test(e.host)),
  index: sum((e) => e.url.includes("/idx/")),
  queryImages: sum((e) => e.url.includes("/photos/") || e.url.includes("/anh/")),
  requests: net.length,
};
run.backend = "wasm";
if (res) {
  run.gpuAdapter = res.gpuAdapter;
  run.loadSeconds = res.loadSeconds;
  run.check = res.check;
  run.results = res.results.map((r) => ({ ...r, ...queries.find((q) => q.id === r.id) }));
}
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `cach2-${model}-${browserName}.json`);
fs.writeFileSync(file, JSON.stringify({ run, net: net.filter((e) => !e.url.includes("/anh/")) }, null, 1), "utf8");
console.log(JSON.stringify({ ...run, results: run.results?.length, consoleErrors: run.consoleErrors?.slice(0, 3) }, null, 1));
console.log(`Ghi: ${file}`);
