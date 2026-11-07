// Cách 1 (đọc chữ rồi tìm trên Open Food Facts): từ chữ OCR của front.jpg -> từ khóa S1 / S2 / S3 -> tìm OFF
// (kiểu mặc định search.pl, có lọc VN) -> chấm điểm với truth.csv. Ghi 1 file JSON mỗi (cách × trình duyệt)
// và bảng tóm tắt.
//
//   node chup-mat-do/run-ocr-off.mjs                     # mặc định: 1a, 1b × chromium, webkit
//   node chup-mat-do/run-ocr-off.mjs --tools 1a-chromium  # chỉ 1 file
//
// Đầu vào: D:\tmp\chup-mat-do\ocr\<công cụ>\<mã>__front.json (web-ocr/run-browser.mjs --only front --lines)
//          D:\tmp\chup-mat-do\ocr\web-ocr\runs\<công cụ>-local.json / -cdn.json (thời gian nạp, bộ nhớ, byte tải)
// Ra:      D:\tmp\chup-mat-do\ket-qua\<1a|1b>-<trình duyệt>.json, off-stats-v1.json
// Bảng tóm tắt tong-hop-v1.md do tong-hop.mjs gom.
//
// Chữ OCR của Chromium và WebKit giống nhau thì câu tìm giống nhau -> lấy từ cache, không gọi lại.
// Ngoài kiểu mặc định, S2 được tìm thêm bằng search-a-licious để THAM KHẢO (không có CORS, chỉ máy chủ gọi được).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allStrategies, DEFAULT_STRATEGY, scoreHits, parseCsv } from "./lib.mjs";
import { createOffClient, DEFAULT_KIND } from "./off-search.mjs";
import { createBrowserFetch } from "./browser-fetch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = {
  "1a-chromium": "paddlejs-rows-chromium",
  "1a-webkit": "paddlejs-rows-webkit",
  "1b-chromium": "tesseractjs-chromium",
  "1b-webkit": "tesseractjs-webkit",
};

function parseArgs(argv) {
  const a = {
    ocrDir: "D:\\tmp\\chup-mat-do\\ocr",
    out: "D:\\tmp\\chup-mat-do\\ket-qua",
    truth: path.join(HERE, "..", "truth.csv"),
    tools: Object.keys(TOOLS),
    reference: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--ocr-dir") a.ocrDir = v();
    else if (k === "--out") a.out = v();
    else if (k === "--truth") a.truth = v();
    else if (k === "--tools") a.tools = v().split(",");
    else if (k === "--no-reference") a.reference = false;
    else throw new Error(`Không biết tham số ${k}`);
  }
  for (const t of a.tools) if (!TOOLS[t]) throw new Error(`Không biết ${t} (có: ${Object.keys(TOOLS).join(", ")})`);
  return a;
}

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);

async function searchScored(off, words, truth, kind) {
  const terms = words.join(" ");
  const t0 = Date.now();
  try {
    const r = await off.search(terms, { kind });
    const s = scoreHits(r.hits, truth);
    return {
      terms, top5: r.hits.map((h) => h.code), top1Name: r.hits[0]?.name ?? null, top1Brands: r.hits[0]?.brands ?? null,
      ...s, vnFallback: r.vnFallback, cached: r.cached, offSeconds: r.seconds, wallSeconds: (Date.now() - t0) / 1000, error: null,
    };
  } catch (e) {
    return {
      terms, top5: [], top1Name: null, top1Brands: null, ...scoreHits([], truth), vnFallback: null, cached: false,
      offSeconds: null, wallSeconds: (Date.now() - t0) / 1000, error: String(e.message || e),
    };
  }
}

const args = parseArgs(process.argv.slice(2));
const truthRows = parseCsv(fs.readFileSync(args.truth, "utf8"));
// Gọi OFF từ trang Chromium (xem browser-fetch.mjs: OFF trả 503 cho User-Agent "node").
const bf = await createBrowserFetch();
console.log(`Gọi OFF từ trình duyệt: ${bf.userAgent}`);
const off = createOffClient({ fetchImpl: bf.fetchImpl, log: (m) => console.log(m) });
fs.mkdirSync(args.out, { recursive: true });

let brands = [];
let brandsError = null;
let brandsSource = null;
try {
  ({ brands, source: brandsSource } = await off.vnBrands());
  console.log(`Danh sách thương hiệu VN: ${brands.length} tên (${brandsSource})`);
} catch (e) {
  brandsError = String(e.message || e);
  console.log(`Không lấy được danh sách thương hiệu VN: ${brandsError} (S3 chạy như S2)`);
}

for (const name of args.tools) {
  const tool = TOOLS[name];
  const dir = path.join(args.ocrDir, tool);
  const items = [];
  console.log(`\n=== ${name} (${tool})`);
  for (const truth of truthRows) {
    const ocr = readJson(path.join(dir, `${truth.code}__front.json`));
    if (!ocr) {
      items.push({ ma: truth.code, status: "không có front.jpg hoặc chưa đọc" });
      continue;
    }
    if (ocr.status !== "ok") {
      items.push({ ma: truth.code, status: `OCR lỗi: ${ocr.status}`, giayOcr: ocr.seconds ?? null });
      continue;
    }
    const lines = Array.isArray(ocr.lines) ? ocr.lines : String(ocr.text || "").split("\n").map((text) => ({ text }));
    const strat = allStrategies(lines, brands);
    const strategies = {};
    for (const [k, s] of Object.entries(strat)) {
      strategies[k] = { words: s.words, note: s.note, ...(await searchScored(off, s.words, truth, DEFAULT_KIND)) };
    }
    const reference = args.reference
      ? { kind: "searchalicious", strategy: DEFAULT_STRATEGY, ...(await searchScored(off, strat[DEFAULT_STRATEGY].words, truth, "searchalicious")) }
      : null;
    const d = strategies[DEFAULT_STRATEGY];
    const item = {
      ma: truth.code,
      status: "ok",
      top5: d.top5,
      tenTop1: d.top1Name,
      giayOcr: ocr.seconds,
      giayOff: d.offSeconds,
      boNho: ocr.memory ?? null,
      soDong: lines.length,
      strategies,
      reference,
    };
    items.push(item);
    console.log(`${truth.code}: S1 ${strategies.S1.rank ?? "-"} | S2 ${d.rank ?? "-"} [${d.terms}]${d.error ? " LỖI " + d.error : ""} | S3 ${strategies.S3.rank ?? "-"} | tham khảo ${reference?.rank ?? "-"}`);
  }
  const runLocal = readJson(path.join(args.ocrDir, "web-ocr", "runs", `${tool}-local.json`));
  const runCdn = readJson(path.join(args.ocrDir, "web-ocr", "runs", `${tool}-cdn.json`));
  const out = {
    name, tool, defaultStrategy: DEFAULT_STRATEGY, searchKind: DEFAULT_KIND, generatedAt: new Date().toISOString(),
    brandsCount: brands.length, brandsSource, brandsError,
    run: runLocal ? {
      browserVersion: runLocal.browserVersion, loadSeconds: runLocal.loadSeconds, backend: runLocal.init?.backend ?? null,
      ok: runLocal.ok, errors: runLocal.errors, crashes: runLocal.crashes, initError: runLocal.initError,
      memory: runLocal.memory, jsHeapPeak: runLocal.jsHeapPeak,
    } : null,
    firstLoad: runCdn ? { transfer: runCdn.network?.transfer ?? null, decoded: runCdn.network?.decoded ?? null, count: runCdn.network?.count ?? null, loadSeconds: runCdn.loadSeconds, initError: runCdn.initError } : null,
    items,
  };
  const file = path.join(args.out, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
  console.log(`Ghi: ${file}`);
}

await bf.close();
const statsFile = path.join(args.out, "off-stats-v1.json");
const prev = readJson(statsFile);
fs.writeFileSync(statsFile, JSON.stringify({ lastRun: { at: new Date().toISOString(), tools: args.tools, ...off.stats }, previous: prev }, null, 2), "utf8");
console.log(`\nLượt OFF lần này: ${JSON.stringify(off.stats)}`);
