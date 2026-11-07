// P3.1 vòng 3: T1 = tìm theo chữ trên danh mục VN cục bộ (BM25, luật CHỐT ở tong-hop-v3.md), dùng chữ ĐÃ LƯU
// (không chạy lại OCR / Gemini, không gọi mạng). Đo thêm thời gian dựng chỉ mục + tìm 30 câu trong trình duyệt
// (Playwright Chromium + WebKit, trang nạp vn-data.mjs + lib.mjs + danh-muc-vn.json từ máy chủ local).
//
//   node chup-mat-do/t1.mjs [--no-browser]
//
// Ra: D:\tmp\chup-mat-do\ket-qua\t1.json (+ dòng xếp hạng T1 cho từng ảnh, rrf.mjs dùng lại).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsv, rankOf, CONF_SCALE, summarize } from "./lib.mjs";
import { buildBm25, bm25Search, t1QueryFromLines, t1QueryFromGemini } from "./vn-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const ocrDir = "D:\\tmp\\chup-mat-do\\ocr";
const outDir = "D:\\tmp\\chup-mat-do\\ket-qua";
const catalogFile = "D:\\tmp\\chup-mat-do\\chi-muc\\danh-muc-vn.json";
const TOOLS = {
  "1a-chromium": { dir: "paddlejs-rows-chromium", scale: CONF_SCALE.paddlejs },
  "1a-webkit": { dir: "paddlejs-rows-webkit", scale: CONF_SCALE.paddlejs },
  "1d": { dir: "vietocr-1d", scale: CONF_SCALE.vietocr },
  "4a": { dir: "gemini-4a", gemini: true },
};
const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const catalogRaw = fs.readFileSync(catalogFile, "utf8");
const docs = JSON.parse(catalogRaw);
const codes = new Set(docs.map((d) => d.code));
const tb = Date.now();
const index = buildBm25(docs);
const buildMsNode = Date.now() - tb;

/** Câu tìm T1 của một ảnh từ JSON đã lưu (độ tin đổi về 0–1 theo thang của công cụ, như run-ocr-off.mjs). */
export function queryOf(ocr, tool) {
  if (tool.gemini) return t1QueryFromGemini(ocr.parsed || {});
  const raw = Array.isArray(ocr.lines) ? ocr.lines : String(ocr.text || "").split("\n").map((text) => ({ text }));
  return t1QueryFromLines(raw.map((l) => (l.conf == null ? l : { ...l, conf: Number(l.conf) / tool.scale })));
}

const result = { rule: "BM25 k1 = 1,2, b = 0,75; product_name* + brands + generic_name*; câu tìm = mọi từ của dòng qua usableLine, bỏ số / đơn vị / từ nhiễu; top5", catalog: { docs: docs.length, rawBytes: Buffer.byteLength(catalogRaw), gzipBytes: zlib.gzipSync(catalogRaw, { level: 9 }).length, buildMsNode }, tools: {}, browser: {} };
result.testCodesInCatalog = truth.filter((t) => codes.has(t.code)).length;
result.testCodesMissing = truth.filter((t) => !codes.has(t.code)).map((t) => t.code);
const browserQueries = [];
for (const [name, tool] of Object.entries(TOOLS)) {
  const items = [];
  for (const t of truth) {
    const f = path.join(ocrDir, tool.dir, `${t.code}__front.json`);
    if (!fs.existsSync(f)) continue;
    const ocr = JSON.parse(fs.readFileSync(f, "utf8"));
    if (ocr.status !== "ok") { items.push({ ma: t.code, status: `OCR lỗi: ${ocr.status}`, top1: false, inTop5: false }); continue; }
    const q = queryOf(ocr, tool);
    const hits = bm25Search(index, q, 5);
    const top5 = hits.map((h) => h.code);
    const rank = rankOf(top5, t.code);
    items.push({ ma: t.code, status: "ok", query: q.join(" "), queryWords: q.length, top5, scores: hits.map((h) => +h.score.toFixed(3)), rank, top1: rank === 1, inTop5: rank != null, inCatalog: codes.has(t.code) });
    if (name === "1a-chromium") browserQueries.push(q);
  }
  const s = summarize(items);
  result.tools[name] = { n: items.length, top1: s.top1, top5: s.top5, items };
  console.log(`${name}: vị trí 1 ${s.top1}/${items.length}, trong 5 đầu ${s.top5}/${items.length}`);
}

// ---- thời gian trong trình duyệt ----
if (!argv.includes("--no-browser")) {
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
  const page0 = `<!doctype html><meta charset="utf-8"><script type="module">
import { buildBm25, bm25Search } from "/vn-data.mjs";
window.runT1 = async (queries) => {
  const t0 = performance.now();
  const docs = await fetch("/danh-muc-vn.json").then((r) => r.json());
  const t1 = performance.now();
  const idx = buildBm25(docs);
  const t2 = performance.now();
  const times = [];
  for (const q of queries) { const a = performance.now(); bm25Search(idx, q, 5); times.push(performance.now() - a); }
  return { fetchMs: t1 - t0, buildMs: t2 - t1, searchMs: times };
};
window.ready = true;
</script>`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x").pathname;
    const map = { "/vn-data.mjs": path.join(HERE, "vn-data.mjs"), "/lib.mjs": path.join(HERE, "lib.mjs"), "/danh-muc-vn.json": catalogFile };
    if (u === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(page0); return; }
    if (!map[u]) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": u.endsWith(".json") ? "application/json" : "text/javascript" });
    fs.createReadStream(map[u]).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  for (const b of ["chromium", "webkit"]) {
    const launch = { headless: true };
    if (b === "chromium" && process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
    let browser;
    try {
      browser = await pw[b].launch(launch);
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
      const r = await page.evaluate((q) => window.runT1(q), browserQueries);
      const sorted = [...r.searchMs].sort((x, y) => x - y);
      result.browser[b] = { queries: r.searchMs.length, fetchMs: r.fetchMs, buildMs: r.buildMs, searchMsMedian: sorted[Math.floor(sorted.length / 2)], searchMsMax: sorted.at(-1) };
      console.log(`${b}: ${JSON.stringify(result.browser[b])}`);
    } catch (e) {
      result.browser[b] = { error: String(e.message || e).slice(0, 400) };
      console.log(`${b} lỗi: ${result.browser[b].error}`);
    } finally {
      await browser?.close().catch(() => {});
    }
  }
  server.close();
}
fs.writeFileSync(path.join(outDir, "t1.json"), JSON.stringify(result, null, 1), "utf8");
console.log(`Danh mục: ${docs.length} sản phẩm, mã thử có trong danh mục ${result.testCodesInCatalog}/31. Ghi: ${path.join(outDir, "t1.json")}`);
