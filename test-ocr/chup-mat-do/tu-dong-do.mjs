// Đợt tu-dong (vòng 1): khung đo bằng Node cho "Chụp mặt trước" tự tìm 2 nguồn (T1 danh mục + Open Food Facts).
// Đọc chữ OCR ĐÃ GHI (không chạy lại máy chủ OCR) + cache đĩa của các lượt tìm OFF; ra vị trí 1 / trong 5 theo từng
// ảnh cho 30 ảnh + ca 7Up + ca muối (2 ca dựng từ chữ máy chủ chủ dự án báo, không có ảnh thật).
//
//   node test-ocr/chup-mat-do/tu-dong-do.mjs [--set B|A|Bcu] [--ocr <file bộ chữ>] [--chi-cache] [--max-calls 96]
//                                            [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua]
//
// Bộ chữ (file gom ở D:\tmp\tu-dong\ocr\, dạng { items: { <mã>: { items: [{ text, poly, score }] } } }):
//   B   = bo-b-30.json (luồng app Chromium, dist-truoc 8ec74c2, tu-dong vòng 1; mốc 14/21)
//   A   = bo-a-30.json (chữ R1 máy chủ trên ảnh gốc của nang-t1, box → poly; mốc 13/22)
//   Bcu = bo-b-nang-t1-30.json (bộ B cũ của nang-t1; mốc 14/21)
// Cột "T1": đúng đường app (src/front-rank.js rankFromItems trên public/chup-mat-do/danh-muc-vn.json).
// Cột "OFF một mình": câu tìm = cleanQuery(dòng chữ T1)[0] của src/off-search.js, rồi searchVnThenAll (lọc VN, rồi không
// lọc; 2 lượt) — đúng URL app sẽ gọi. CHƯA gộp xếp hạng 2 nguồn (vòng 2).
// Gọi OFF: qua một trang Chromium (Edge) 127.0.0.1 (OFF trả 503 cho User-Agent "node", luật dự án không thêm header),
// giãn ≥ 6 giây giữa 2 lượt, cache đĩa theo URL (bỏ app_name / app_version), cầu dao: 5 lượt hỏng liền thì ngừng gọi,
// trần --max-calls lượt / lần chạy. --chi-cache: KHÔNG gọi mạng; lượt chưa có cache tính là lỗi "chưa có cache".
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALL_CODES, HOLDOUT, SALT_LINES, saltItems } from "./nang-t1-do.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
export const SETS = {
  B: { file: "D:\\tmp\\tu-dong\\ocr\\bo-b-30.json", baseline: { top1: 14, top5: 21 } },
  A: { file: "D:\\tmp\\tu-dong\\ocr\\bo-a-30.json", baseline: { top1: 13, top5: 22 } },
  Bcu: { file: "D:\\tmp\\tu-dong\\ocr\\bo-b-nang-t1-30.json", baseline: { top1: 14, top5: 21 } },
};
export const CODE_7UP = "8934588752117";
export const LINES_7UP = ["Up", "Soda chanh", "Khong calo"];
export const GAP_MS = 6000;
export const BREAKER_FAILS = 5;

/** Vị trí (1–5) của mã trong danh sách mã, không có trong 5 đầu → null. */
export function rank5(codes, code) {
  const i = (codes || []).slice(0, 5).indexOf(code);
  return i < 0 ? null : i + 1;
}

/** Khóa cache đĩa: URL bỏ app_name / app_version. */
export function cacheKey(url) {
  return String(url).replace(/[?&]app_name=[^&]*/, "").replace(/[?&]app_version=[^&]*/, "");
}

/** Gom bảng: { n, top1, top5 } theo cột rank. */
export function tallyBy(rows, key) {
  return { n: rows.length, top1: rows.filter((r) => r[key] === 1).length, top5: rows.filter((r) => r[key] != null).length };
}

/**
 * fetch cho off-search.js: đọc / ghi cache đĩa; chiCache → không gọi mạng (ném lỗi); còn lại gọi qua `netFetch`
 * (trả { status, text } hoặc ném), giãn ≥ gapMs, cầu dao, trần maxCalls. Trả hàm fetch + bộ đếm.
 */
export function makeDiskFetch({ cacheDir, chiCache, netFetch, maxCalls, gapMs = GAP_MS, breakerFails = BREAKER_FAILS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  const stats = { calls: 0, cacheHits: 0, notCached: 0, failures: 0, breakerOpen: false, overCap: 0 };
  let last = -Infinity;
  let streak = 0;
  async function f(url) {
    const key = cacheKey(url);
    const file = path.join(cacheDir, `tim-${crypto.createHash("sha1").update(key).digest("hex")}.json`);
    if (fs.existsSync(file)) {
      stats.cacheHits++;
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      return new Response(c.text, { status: c.status });
    }
    if (chiCache) { stats.notCached++; throw new TypeError("chưa có cache (chế độ chỉ cache)"); }
    if (stats.breakerOpen) throw new TypeError("cầu dao đã ngừng gọi OFF");
    if (stats.calls >= maxCalls) { stats.overCap++; throw new TypeError(`chạm trần ${maxCalls} lượt`); }
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    stats.calls++;
    let r;
    try {
      r = await netFetch(url);
    } catch (e) {
      stats.failures++;
      if (++streak >= breakerFails) stats.breakerOpen = true;
      throw e instanceof TypeError ? e : new TypeError(String(e?.message || e));
    }
    if (r.status === 429 || r.status >= 500) {
      stats.failures++;
      if (++streak >= breakerFails) stats.breakerOpen = true;
    } else {
      streak = 0;
      if (r.status === 200) fs.writeFileSync(file, JSON.stringify({ key, at: new Date().toISOString(), status: r.status, text: r.text }), "utf8");
    }
    return new Response(r.text, { status: r.status });
  }
  return { fetch: f, stats };
}

async function browserNet() {
  const { createRequire } = await import("node:module");
  const require = createRequire("D:/tmp/pw/package.json");
  const { chromium } = require("playwright");
  const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end("<!doctype html><title>off</title>"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  return {
    async fetch(url) {
      const r = await page.evaluate(async (u) => {
        try { const res = await fetch(u); return { status: res.status, text: await res.text() }; } catch (e) { return { error: String(e?.message || e) }; }
      }, url);
      if (r.error) throw new TypeError(`fetch trong trình duyệt lỗi (thường là OFF trả 503 không kèm CORS): ${r.error}`);
      return r;
    },
    async close() { await browser.close().catch(() => {}); server.close(); },
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const setName = arg("--set", "B");
  const set = SETS[setName];
  if (!set) throw new Error(`không biết bộ chữ ${setName}`);
  const ocrFile = arg("--ocr", set.file);
  const chiCache = argv.includes("--chi-cache");
  const maxCalls = Number(arg("--max-calls", "96"));
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const t1 = await import(pathToFileURL(path.join(ROOT, "public", "chup-mat-do", "t1.mjs")).href);
  const fr = await import(pathToFileURL(path.join(ROOT, "src", "front-rank.js")).href);
  const os = await import(pathToFileURL(path.join(ROOT, "src", "off-search.js")).href);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"), "utf8"));
  const rIndex = fr.buildRankIndex(t1, catalog.products);
  const bundle = JSON.parse(fs.readFileSync(ocrFile, "utf8"));

  let net = null;
  const disk = makeDiskFetch({
    cacheDir, chiCache, maxCalls,
    netFetch: async (url) => { net ||= await browserNet(); return net.fetch(url); },
  });
  // timeoutMs dài hơn app (7 giây) để đo chất lượng tìm, không đo tốc độ mạng; limit cao vì đã giãn 6 giây ở makeDiskFetch.
  const off = os.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1000 });

  const cases = [
    ...ALL_CODES.map((code) => ({ code, kind: "anh", items: bundle.items?.[code]?.items ?? null, holdout: HOLDOUT.includes(code) })),
    { code: CODE_7UP, kind: "7up (ca dựng)", items: saltItems(LINES_7UP, 0.95) },
    { code: null, kind: "muoi (ca dựng)", items: saltItems(SALT_LINES, 0.9) },
  ];
  const rows = [];
  for (const c of cases) {
    if (!c.items) { rows.push({ code: c.code, kind: c.kind, error: "thiếu chữ OCR", t1Rank: null, offRank: null }); continue; }
    const found = fr.rankFromItems(t1, rIndex, c.items);
    const t1Top5 = found.hits.map((h) => h.code);
    const queries = os.cleanQuery(found.lines);
    const q = queries[0] ?? "";
    const r = q ? await off.searchVnThenAll(q) : { ok: true, hits: [], cached: true };
    const offTop5 = r.ok ? r.hits.slice(0, 5) : [];
    const row = {
      code: c.code, kind: c.kind, holdout: !!c.holdout, lines: found.lines, t1Query: found.query.join(" "),
      t1Top5, t1Scores: found.hits.map((h) => +h.score.toFixed(3)), t1Rank: c.code ? rank5(t1Top5, c.code) : null,
      offQueries: queries, offQuery: q, offOk: r.ok, offKind: r.ok ? null : r.kind, offCount: r.ok ? r.hits.length : null,
      offTop5: offTop5.map((h) => ({ code: h.code, name: h.name, brand: h.brand, vn: h.vn })),
      offRank: c.code && r.ok ? rank5(offTop5.map((h) => h.code), c.code) : null,
      offAnyPos: c.code && r.ok ? (r.hits.findIndex((h) => h.code === c.code) + 1 || null) : null,
      inCatalog: c.code ? catalog.products.some((p) => p.code === c.code) : null,
    };
    rows.push(row);
    console.log(`${c.kind === "anh" ? c.code : c.kind}: T1 ${row.t1Rank ?? "-"} | OFF ${row.offOk ? (row.offRank ?? "-") : "LỖI " + row.offKind} (${row.offCount ?? "?"} kq) "${q}"`);
  }
  await net?.close();

  const photos = rows.filter((r) => r.kind === "anh");
  const summary = {
    set: setName, ocrFile, chiCache, baseline: set.baseline,
    t1: tallyBy(photos, "t1Rank"), t1MatchesBaseline: tallyBy(photos, "t1Rank").top1 === set.baseline.top1 && tallyBy(photos, "t1Rank").top5 === set.baseline.top5,
    off: tallyBy(photos, "offRank"), offErrors: photos.filter((r) => !r.offOk).length,
    offErrorKinds: Object.fromEntries([...new Set(photos.filter((r) => !r.offOk).map((r) => r.offKind))].map((k) => [k, photos.filter((r) => r.offKind === k).length])),
    t1OrOff: { top5: photos.filter((r) => r.t1Rank != null || r.offRank != null).length },
    offOnlyTop5: photos.filter((r) => r.t1Rank == null && r.offRank != null).map((r) => r.code),
    case7up: rows.find((r) => r.kind.startsWith("7up")),
    caseSalt: rows.find((r) => r.kind.startsWith("muoi")),
    offCalls: disk.stats,
  };
  const outFile = path.join(outDir, `tu-dong-do-${setName}${chiCache ? "-chi-cache" : ""}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 1), "utf8");
  console.log(JSON.stringify({ ...summary, case7up: { t1Rank: summary.case7up.t1Rank, offRank: summary.case7up.offRank, offQuery: summary.case7up.offQuery }, caseSalt: { offQuery: summary.caseSalt.offQuery, offTop5: summary.caseSalt.offTop5.map((h) => h.name) } }, null, 1));
  console.log(`Ghi: ${outFile}`);
}
