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
import { fileURLToPath, pathToFileURL } from "node:url";
import { TRANSFORMERS_CDN } from "./embed-models.mjs";
import { startSampler } from "./sampler.mjs";

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
// --index node | trinh-duyet: chỉ mục tính bằng Node (index.*) hay bằng trình duyệt (index-trinh-duyet.*, tạo bằng
// --build-index trong Chromium). Mặc định: trình duyệt nếu đã có, vì vector Node lệch (cosine < 0,99, xem tong-hop-v3.md).
const buildIndex = argv.includes("--build-index");
// --ext (vòng 4, P3): bộ phụ mở rộng. Chỉ mục = index-mo-rong.* (970 ảnh VN của index-trinh-duyet + ảnh chỉ mục của
// mọi ứng viên đã tải, chi-muc\mo-rong\cap.json extIndex); --build-index chỉ tính vector ảnh mới rồi ghép, không ghi đè
// chỉ mục vòng 3. Truy vấn = 15 cặp bộ phụ gốc + cặp mở rộng. Ra cach2-<model>-<trình duyệt>-mo-rong.json.
const ext = argv.includes("--ext");
const cap = ext ? JSON.parse(fs.readFileSync(path.join(idxDir, "mo-rong", "cap.json"), "utf8")) : null;
const idxKind = ext ? "mo-rong" : opt("--index", fs.existsSync(path.join(idxDir, model, "index-trinh-duyet.json")) ? "trinh-duyet" : "node");
const idxName = (e) => (idxKind === "mo-rong" ? `index-mo-rong.${e}` : idxKind === "trinh-duyet" ? `index-trinh-duyet.${e}` : `index.${e}`);
const meta = buildIndex ? { items: [] } : JSON.parse(fs.readFileSync(path.join(idxDir, model, idxName("json")), "utf8"));
const SIDE_CODE = "8934572260543";

// truy vấn: { id, set: "chinh" | "phu-xem-tay" | "bo-phu", code (đáp án), url }
const queries = [];
for (const s of ext ? [] : chon.selected.filter((x) => x.test)) {
  queries.push({ id: `test-${s.code}`, set: s.code === SIDE_CODE ? "phu-xem-tay" : "chinh", code: s.code, url: `/photos/${s.code}/front.jpg` });
}
for (const p of loo.pairs) queries.push({ id: `loo-${p.code}`, set: "bo-phu", code: p.code, url: `/anh/${p.code}_${p.queryImgid}.400.jpg` });
for (const p of cap?.pairs || []) queries.push({ id: `ext-${p.code}`, set: "mo-rong", code: p.code, url: `/anh-mo-rong/${p.code}_${p.queryImgid}.400.jpg` });
const checkItems = meta.items.slice(0, 5).map((it, i) => ({ i, url: `/anh/${it.code}_${it.imgid}.400.jpg` }));
const extImgFile = (c) => path.join(idxDir, "anh-mo-rong", `${c.code}_${c.imgid}.400.jpg`);

const HARNESS = `<!doctype html><meta charset="utf-8"><title>cach-2</title><body><script type="module">
import { loadEmbedder, topK, dot, l2norm } from "/embed-models.mjs";
// WebKit của Playwright trên Windows không có OffscreenCanvas (transformers.js cần để đọc / thu nhỏ ảnh).
// ?shim=1: thay bằng <canvas> thường (chỉ để đo trên máy tính; Safari 17+ trên iPhone có OffscreenCanvas thật).
window.shimOffscreen = false;
if (typeof OffscreenCanvas === "undefined" && new URL(location.href).searchParams.has("shim")) {
  window.OffscreenCanvas = class { constructor(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; } };
  window.shimOffscreen = true;
}
window.runAll = async ({ model, queries, checkItems }) => {
  const out = { gpuAdapter: null, results: [], check: [] };
  try { out.gpuAdapter = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { out.gpuAdapter = false; }
  const t0 = performance.now();
  // transformers.min.js: bản gói sẵn onnxruntime-web (transformers.web.min.js còn import trần "onnxruntime-web/webgpu",
  // trình duyệt không tự tìm được)
  const T = await import("${TRANSFORMERS_CDN}/dist/transformers.min.js");
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
// Tính vector chỉ mục trong trình duyệt (dùng khi vector Node lệch: cosine < 0,99). Trả int8 (v × 127).
window.buildIndex = async ({ model, items }) => {
  const T = await import("${TRANSFORMERS_CDN}/dist/transformers.min.js");
  T.env.allowLocalModels = false;
  const embed = await loadEmbedder(T, model, { device: "wasm" });
  const out = [];
  for (const it of items) {
    try {
      const v = await embed(await T.RawImage.fromURL(it.url));
      out.push({ code: it.code, imgid: it.imgid, q: Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127)))) });
    } catch (e) { out.push({ code: it.code, imgid: it.imgid, error: String(e && e.message || e) }); }
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
    else if (u.startsWith("/idx/")) file = path.join(idxDir, model, idxName(path.extname(u).slice(1)));
    else if (u.startsWith("/anh/")) file = path.join(idxDir, "anh", path.basename(u));
    else if (u.startsWith("/anh-mo-rong/")) file = path.join(idxDir, "anh-mo-rong", path.basename(u));
    else if (u.startsWith("/photos/")) file = path.join(photosDir, ...u.slice(8).split("/").map((s) => path.basename(s)));
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
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
  await page.goto(`${base}/harness.html${argv.includes("--shim-offscreen") ? "?shim=1" : ""}`);
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
  if (buildIndex && ext) {
    const items = cap.extIndex.filter((c) => fs.existsSync(extImgFile(c))).map((c) => ({ code: c.code, imgid: c.imgid, url: `/anh-mo-rong/${c.code}_${c.imgid}.400.jpg` }));
    const tb = Date.now();
    const built = await page.evaluate((a) => window.buildIndex(a), { model, items });
    const ok = built.filter((b) => b.q);
    const baseMeta = JSON.parse(fs.readFileSync(path.join(idxDir, model, "index-trinh-duyet.json"), "utf8"));
    const baseBin = fs.readFileSync(path.join(idxDir, model, "index-trinh-duyet.bin"));
    const bin = Buffer.concat([baseBin, Buffer.from(Int8Array.from(ok.flatMap((b) => b.q)).buffer)]);
    fs.writeFileSync(path.join(idxDir, model, "index-mo-rong.bin"), bin);
    const metaRaw = JSON.stringify({ ...baseMeta, builtIn: `${baseMeta.builtIn}; ảnh mở rộng ${browserName} ${run.browserVersion}`, items: [...baseMeta.items, ...ok.map((b) => ({ code: b.code, imgid: b.imgid, ext: true }))] });
    fs.writeFileSync(path.join(idxDir, model, "index-mo-rong.json"), metaRaw, "utf8");
    const info = { n: baseMeta.items.length + ok.length, vn: baseMeta.items.length, ext: ok.length, errors: built.length - ok.length, seconds: (Date.now() - tb) / 1000 };
    fs.writeFileSync(path.join(idxDir, model, "info-mo-rong.json"), JSON.stringify(info, null, 1), "utf8");
    console.log(`Chỉ mục mở rộng ${model}: ${JSON.stringify(info)}`);
    throw new Error("BUILD_DONE");
  }
  if (buildIndex) {
    const items = chon.selected.filter((s) => fs.existsSync(path.join(idxDir, "anh", `${s.code}_${s.imgid}.400.jpg`)))
      .map((s) => ({ code: s.code, imgid: s.imgid, url: `/anh/${s.code}_${s.imgid}.400.jpg` }));
    const tb = Date.now();
    const built = await page.evaluate((a) => window.buildIndex(a), { model, items });
    const ok = built.filter((b) => b.q);
    const dims = ok[0].q.length;
    const bin = Buffer.from(Int8Array.from(ok.flatMap((b) => b.q)).buffer);
    fs.writeFileSync(path.join(idxDir, model, "index-trinh-duyet.bin"), bin);
    const metaRaw = JSON.stringify({ model, dims, quant: "int8 (v × 127, làm tròn)", builtIn: `${browserName} ${run.browserVersion}`, items: ok.map((b) => ({ code: b.code, imgid: b.imgid })) });
    fs.writeFileSync(path.join(idxDir, model, "index-trinh-duyet.json"), metaRaw, "utf8");
    const zlib = await import("node:zlib");
    const info = { n: ok.length, errors: built.length - ok.length, dims, seconds: (Date.now() - tb) / 1000, rawBytes: bin.length + Buffer.byteLength(metaRaw), gzipBytes: zlib.gzipSync(bin, { level: 9 }).length + zlib.gzipSync(metaRaw, { level: 9 }).length };
    fs.writeFileSync(path.join(idxDir, model, "info-trinh-duyet.json"), JSON.stringify(info, null, 1), "utf8");
    console.log(`Chỉ mục trình duyệt ${model}: ${JSON.stringify(info)}`);
    throw new Error("BUILD_DONE");
  }
  run.shimOffscreen = await page.evaluate(() => window.shimOffscreen);
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
if (buildIndex) process.exit(run.error === "BUILD_DONE" ? 0 : 1);
run.index = idxKind;

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
const file = path.join(outDir, `cach2-${model}-${browserName}${ext ? "-mo-rong" : ""}.json`);
fs.writeFileSync(file, JSON.stringify({ run, net: net.filter((e) => !e.url.includes("/anh/")) }, null, 1), "utf8");
console.log(JSON.stringify({ ...run, results: run.results?.length, consoleErrors: run.consoleErrors?.slice(0, 3) }, null, 1));
console.log(`Ghi: ${file}`);
// thoát hẳn: kết nối giữ sống của máy chủ local / tiến trình lấy mẫu có khi giữ Node chạy tiếp sau khi đã ghi xong
process.exit(0);
