// Cách 1 (đọc chữ rồi tìm trên Open Food Facts): từ chữ OCR của front.jpg -> từ khóa S1 / S2 / S3 -> tìm OFF
// (kiểu mặc định search.pl, có lọc VN) -> chấm điểm với truth.csv. Ghi 1 file JSON mỗi (cách × trình duyệt)
// và bảng tóm tắt.
//
//   node chup-mat-do/run-ocr-off.mjs                     # mặc định: 1a, 1b × chromium, webkit
//   node chup-mat-do/run-ocr-off.mjs --tools 1a-chromium  # chỉ 1 file
//   node chup-mat-do/run-ocr-off.mjs --tools 1d,1c,4a --stats off-stats-v2.json   # vòng 2: chỉ S2 (+ tham khảo)
//
// Vòng 2: 1d (vietocr-bridge.py), 1c (ocrspace.mjs), 4a (gemini.mjs) đọc chữ / JSON thô đã lưu, chỉ chạy S2.
// Cầu dao của off-search.mjs ngừng hẳn thì không gọi OFF nữa: các mã còn lại ghi "chưa tìm OFF (OFF chặn)",
// danh sách ở trường breaker.notSearched của file kết quả.
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
import { allStrategies, strategyS2, DEFAULT_STRATEGY, scoreHits, parseCsv, textMatch, CONF_SCALE } from "./lib.mjs";
import { createOffClient, DEFAULT_KIND } from "./off-search.mjs";
import { createBrowserFetch } from "./browser-fetch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dir: thư mục chữ OCR / JSON thô; scale: thang độ tin của công cụ (CONF_SCALE, không đoán);
// only: chỉ chạy các chiến lược này (vòng 2: 1c / 1d / 4a chỉ S2 để giảm lượt OFF); gemini: đầu vào là JSON Gemini.
const TOOLS = {
  "1a-chromium": { dir: "paddlejs-rows-chromium", scale: CONF_SCALE.paddlejs },
  "1a-webkit": { dir: "paddlejs-rows-webkit", scale: CONF_SCALE.paddlejs },
  "1b-chromium": { dir: "tesseractjs-chromium", scale: CONF_SCALE.tesseractjs },
  "1b-webkit": { dir: "tesseractjs-webkit", scale: CONF_SCALE.tesseractjs },
  "1d": { dir: "vietocr-1d", scale: CONF_SCALE.vietocr, only: ["S2"] },
  "1c": { dir: "ocrspace-1c", scale: CONF_SCALE.ocrspace, only: ["S2"] },
  "4a": { dir: "gemini-4a", gemini: true, only: ["S2"] },
};
const DEFAULT_TOOLS = ["1a-chromium", "1a-webkit", "1b-chromium", "1b-webkit"];

/** Dòng chữ của một ảnh, độ tin đổi về 0–1 theo thang của công cụ. 4a: các dòng [thuong_hieu, ten] của Gemini. */
function linesOf(ocr, tool) {
  if (tool.gemini) {
    const p = ocr.parsed || {};
    return [p.thuong_hieu, p.ten].filter((x) => typeof x === "string" && x.trim()).map((text) => ({ text }));
  }
  const raw = Array.isArray(ocr.lines) ? ocr.lines : String(ocr.text || "").split("\n").map((text) => ({ text }));
  return raw.map((l) => (l.conf == null ? l : { ...l, conf: Number(l.conf) / tool.scale }));
}

function parseArgs(argv) {
  const a = {
    ocrDir: "D:\\tmp\\chup-mat-do\\ocr",
    out: "D:\\tmp\\chup-mat-do\\ket-qua",
    truth: path.join(HERE, "..", "truth.csv"),
    tools: DEFAULT_TOOLS,
    stats: "off-stats-v1.json",
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
    else if (k === "--stats") a.stats = v();
    else throw new Error(`Không biết tham số ${k}`);
  }
  for (const t of a.tools) if (!TOOLS[t]) throw new Error(`Không biết ${t} (có: ${Object.keys(TOOLS).join(", ")})`);
  return a;
}

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);

let breakerOpen = null; // lỗi cầu dao ngừng hẳn: từ đó không gọi OFF nữa trong lần chạy này

async function searchScored(off, words, truth, kind) {
  const terms = words.join(" ");
  const t0 = Date.now();
  if (breakerOpen) {
    return {
      terms, ...scoreHits([], truth), top5: [], top1Name: null, top1Brands: null, vnFallback: null, cached: false,
      offSeconds: null, wallSeconds: 0, error: "chưa tìm OFF (OFF chặn)", notSearched: true,
    };
  }
  try {
    const r = await off.search(terms, { kind });
    const s = scoreHits(r.hits, truth);
    return {
      terms, ...s, top5: r.hits.map((h) => h.code), top1Name: r.hits[0]?.name ?? null, top1Brands: r.hits[0]?.brands ?? null, vnFallback: r.vnFallback, cached: r.cached, offSeconds: r.seconds, wallSeconds: (Date.now() - t0) / 1000, error: null,
    };
  } catch (e) {
    if (e.breakerOpen) breakerOpen = e;
    return {
      terms, ...scoreHits([], truth), top5: [], top1Name: null, top1Brands: null, vnFallback: null, cached: false,
      offSeconds: null, wallSeconds: (Date.now() - t0) / 1000, error: String(e.message || e), notSearched: !!e.breakerOpen,
    };
  }
}

const args = parseArgs(process.argv.slice(2));
const truthRows = parseCsv(fs.readFileSync(args.truth, "utf8"));
// Gọi OFF từ trang Chromium (xem browser-fetch.mjs: OFF trả 503 cho User-Agent "node").
const bf = await createBrowserFetch();
console.log(`Gọi OFF từ trình duyệt: ${bf.userAgent}`);
const off = createOffClient({ fetchImpl: bf.fetchImpl, log: (m) => console.log(m) });
// search-a-licious (chỉ tham khảo) không có CORS nên không gọi từ trang được: gọi bằng fetch của Node
// (máy chủ này trả 200 cho User-Agent "node"), dùng chung bộ giãn cách + bộ đếm + cầu dao với client trên.
const offNode = createOffClient({ log: (m) => console.log(m), shareWith: off });
fs.mkdirSync(args.out, { recursive: true });

let brands = [];
let brandsError = null;
let brandsSource = null;
if (args.tools.some((t) => !TOOLS[t].only || TOOLS[t].only.includes("S3"))) {
  try {
    ({ brands, source: brandsSource } = await off.vnBrands());
    console.log(`Danh sách thương hiệu VN: ${brands.length} tên (${brandsSource})`);
  } catch (e) {
    brandsError = String(e.message || e);
    if (e.breakerOpen) breakerOpen = e;
    console.log(`Không lấy được danh sách thương hiệu VN: ${brandsError} (S3 chạy như S2)`);
  }
}

try {
  for (const name of args.tools) {
    const tool = TOOLS[name];
    const dir = path.join(args.ocrDir, tool.dir);
    const items = [];
    console.log(`\n=== ${name} (${tool.dir})`);
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
      const lines = linesOf(ocr, tool);
      const strat = tool.only ? { S2: strategyS2(lines) } : allStrategies(lines, brands);
      const strategies = {};
      for (const [k, s] of Object.entries(strat)) {
        strategies[k] = { words: s.words, note: s.note, ...(await searchScored(off, s.words, truth, DEFAULT_KIND)) };
      }
      const reference = args.reference
        ? { kind: "searchalicious", strategy: DEFAULT_STRATEGY, ...(await searchScored(offNode, strat[DEFAULT_STRATEGY].words, truth, "searchalicious")) }
        : null;
      const d = strategies[DEFAULT_STRATEGY];
      const item = {
        ma: truth.code,
        status: "ok",
        top5: d.top5,
        tenTop1: d.top1Name,
        giayOcr: ocr.seconds,
        giayOff: d.offSeconds,
        offCached: d.cached,
        luotApi: ocr.apiCalls ?? (tool.gemini || name === "1c" ? 1 : 0),
        boNho: ocr.memory ?? null,
        soDong: lines.length,
        strategies,
        reference,
      };
      if (tool.gemini) {
        // cột tham khảo: tên / thương hiệu Gemini tự đọc so với đáp án (textMatch vòng 2)
        item.gemini = {
          ten: ocr.parsed?.ten ?? null,
          thuong_hieu: ocr.parsed?.thuong_hieu ?? null,
          nameOk: textMatch(ocr.parsed?.ten, truth.ten),
          brandOk: textMatch(ocr.parsed?.thuong_hieu, truth.thuong_hieu),
        };
      }
      items.push(item);
      const s = (k) => (strategies[k] ? `${k} ${strategies[k].rank ?? "-"}` : "");
      console.log(`${truth.code}: ${[s("S1"), `${s("S2")} [${d.terms}]${d.error ? " LỖI " + d.error : ""}`, s("S3")].filter(Boolean).join(" | ")} | tham khảo ${reference?.rank ?? "-"}${reference?.error ? " LỖI " + reference.error : ""}`);
    }
    const runLocal = readJson(path.join(args.ocrDir, "web-ocr", "runs", `${tool.dir}-local.json`));
    const runCdn = readJson(path.join(args.ocrDir, "web-ocr", "runs", `${tool.dir}-cdn.json`));
    const out = {
      name, tool: tool.dir, defaultStrategy: DEFAULT_STRATEGY, searchKind: DEFAULT_KIND, generatedAt: new Date().toISOString(),
      strategiesRun: tool.only ?? ["S1", "S2", "S3"],
      brandsCount: brands.length, brandsSource, brandsError,
      breaker: breakerOpen ? { open: true, message: String(breakerOpen.message), notSearched: items.filter((i) => i.strategies?.S2?.notSearched).map((i) => i.ma) } : { open: false },
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
} finally {
  await bf.close();
  const statsFile = path.join(args.out, args.stats);
  const prev = readJson(statsFile);
  fs.writeFileSync(statsFile, JSON.stringify({ lastRun: { at: new Date().toISOString(), tools: args.tools, breakerOpen: !!breakerOpen, ...off.stats }, previous: prev }, null, 2), "utf8");
  console.log(`\nLượt OFF lần này: ${JSON.stringify(off.stats)}${breakerOpen ? "\nCẦU DAO ĐÃ NGỪNG HẲN: " + breakerOpen.message : ""}`);
}
