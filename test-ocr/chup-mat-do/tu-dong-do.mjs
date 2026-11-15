// Đợt tu-dong: khung đo bằng Node cho "Chụp mặt trước" tự tìm 2 nguồn (T1 danh mục + Open Food Facts).
// Đọc chữ OCR ĐÃ GHI (không chạy lại máy chủ OCR) + cache đĩa của các lượt tìm OFF; ra vị trí 1 / trong 5 theo từng
// ảnh cho 30 ảnh + ca 7Up (chữ máy chủ + câu gõ) + ca muối (ca dựng từ chữ máy chủ chủ dự án báo, không có ảnh thật).
//
//   node test-ocr/chup-mat-do/tu-dong-do.mjs [--sets B,A] [--loo] [--chi-cache] [--max-calls 120] [--run-cap N]
//        [--mot-luot] [--tag dot1] [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua]
//        [--luot D:\tmp\tu-dong\off-luot.json] [--vong 6]
// Vòng 4: --vong N chọn khóa đếm lượt "vongN" của file --luot (mặc định vong3, sổ cũ vẫn đọc được), tên file ra theo vòng.
// Vòng 3: trần --max-calls tính trên khóa "vong3" của file --luot; --run-cap chia trần cho từng đợt lấy; --loo thêm câu
// OFF của bỏ-một-ra không rò bộ B (looCases: chỉ mục + từ vựng không có sản phẩm đúng); ra độ phủ từng bộ (coverage).
//
// Bộ chữ (file gom ở D:\tmp\tu-dong\ocr\, dạng { items: { <mã>: { items: [{ text, poly, score }] } } }):
//   B   = bo-b-30.json (luồng app Chromium, dist-truoc 8ec74c2, tu-dong vòng 1; mốc 14/21)
//   A   = bo-a-30.json (chữ R1 máy chủ trên ảnh gốc của nang-t1, box → poly; mốc 13/22)
//   Bcu = bo-b-nang-t1-30.json (bộ B cũ của nang-t1; mốc 14/21)
// Cột "T1": đúng đường app (src/front-rank.js rankFromItems trên public/chup-mat-do/danh-muc-vn.json).
// Cột "OFF" (vòng 2): câu = cleanQuery(dòng chữ, { idf: chỉ mục T1 }) của src/off-search.js (≤ 2 câu), mỗi câu 1 lượt
// search() KHÔNG lọc VN (page_size 24) — đúng URL app sẽ gọi; kết quả các câu nối lại (bỏ trùng, theo thứ tự câu).
// Gộp xếp hạng 2 nguồn: tu-dong-gop-do.mjs (chỉ cache).
// Gọi OFF: qua một trang Chromium (Edge) 127.0.0.1 (OFF trả 503 cho User-Agent "node", luật dự án không thêm header),
// giãn ≥ 8 giây, cache đĩa theo URL (bỏ app_name / app_version). Trần lượt cả vòng đếm DỒN ở file --luot
// ({ batDau, vong2, vong3, tong }; chạm --max-calls lượt của vòng đang chạy thì ngừng gọi). Cầu dao: 3 lỗi liền nhau →
// nghỉ 2 phút, thử lại 1 lượt, vẫn lỗi thì ngừng gọi, phần còn lại chỉ cache. Câu lỗi được thử lại tối đa 1 lần ở lượt
// quét sau. Mỗi lượt gọi mạng cộng vào test-ocr/outputs/api_usage.json ("openfoodfacts", theo tháng; thư mục đã
// gitignore) ở CẢ worktree đang chạy và thư mục chính D:\quet-ma-vach-full (MAIN_ROOT).
// --chi-cache: KHÔNG gọi mạng; câu chưa có cache tính là lỗi "chưa có cache".
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALL_CODES, HOLDOUT, SALT_LINES, saltItems } from "./nang-t1-do.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
export const SETS = {
  B: { file: "D:\\tmp\\tu-dong\\ocr\\bo-b-30.json", baseline: { top1: 14, top5: 21 } },
  A: { file: "D:\\tmp\\tu-dong\\ocr\\bo-a-30.json", baseline: { top1: 13, top5: 22 } },
  Bcu: { file: "D:\\tmp\\tu-dong\\ocr\\bo-b-nang-t1-30.json", baseline: { top1: 14, top5: 21 } },
};
export const CODE_7UP = "8934588752117";
export const LINES_7UP = ["Up", "Soda chanh", "Khong calo"];
export const TYPED_7UP = "Soda chanh diet 7 up";
export const GAP_MS = 8000;
export const BREAKER_FAILS = 3;
export const BREAKER_PAUSE_MS = 120000;
/** Trần lượt tìm của vòng đang chạy (vòng 3: 120; vòng 2 là 150). */
export const DEFAULT_CAP = 120;
export const LUOT_FILE = "D:\\tmp\\tu-dong\\off-luot.json";
export const LUOT_START = 76;
/** Khóa đếm lượt mặc định trong file --luot (vòng 3); vòng khác truyền --vong N (roundKeyOf). */
export const ROUND_KEY = "vong3";

/** Tham số --vong N → khóa "vongN" (N 1–99); không truyền → ROUND_KEY (sổ cũ vẫn đọc được); sai → báo lỗi. */
export function roundKeyOf(arg) {
  if (arg === undefined || arg === null) return ROUND_KEY;
  const s = String(arg);
  if (!/^[1-9]\d?$/.test(s)) throw new Error(`--vong phải là số vòng 1–99 (nhận "${s}")`);
  return `vong${s}`;
}

/** Vòng 5 (gợi ý 9 reviewer vòng 4): đọc --vong từ argv. Không có cờ → ROUND_KEY; có cờ mà thiếu số (cuối argv hoặc
 *  theo sau là cờ "--…") → báo lỗi, không lặng lẽ dùng vong3; số sai → lỗi của roundKeyOf. */
export function roundKeyFromArgv(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const i = list.indexOf("--vong");
  if (i < 0) return ROUND_KEY;
  const v = list[i + 1];
  if (v === undefined || String(v).startsWith("--")) throw new Error("--vong cần số vòng ngay sau (vd --vong 5)");
  return roundKeyOf(v);
}
/** Nơi cộng lượt OFF (test-ocr/outputs/api_usage.json, đã gitignore): worktree đang chạy VÀ thư mục chính của repo
 *  (hồ sơ dự án đếm ở thư mục chính; vòng 1–2 chỉ ghi worktree). */
export const MAIN_ROOT = "D:\\quet-ma-vach-full";

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

/** Đọc / ghi bộ đếm lượt dồn ({ batDau, vong2, vong3, …, tong }; tong = batDau + mọi khóa vongN). Chưa có file →
 *  bắt đầu từ LUOT_START. */
export function readLuot(file) {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* chưa có file */ }
  const out = { batDau: Number.isFinite(j?.batDau) ? j.batDau : LUOT_START };
  for (const [k, v] of Object.entries(j || {})) if (/^vong\d+$/.test(k) && Number.isFinite(v)) out[k] = v;
  out.tong = out.batDau + Object.entries(out).filter(([k]) => /^vong\d+$/.test(k)).reduce((s, [, v]) => s + v, 0);
  return out;
}
function writeLuot(file, c) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { tong, ...rest } = c;
  const tot = rest.batDau + Object.entries(rest).filter(([k]) => /^vong\d+$/.test(k)).reduce((s, [, v]) => s + v, 0);
  fs.writeFileSync(file, JSON.stringify({ ...rest, tong: tot, capNhat: new Date().toISOString() }, null, 1), "utf8");
}

/** Cộng n lượt OFF vào test-ocr/outputs/api_usage.json (theo tháng) của từng thư mục trong roots (mặc định: worktree
 *  đang chạy + thư mục chính MAIN_ROOT, bỏ trùng). */
export function addUsage(n, now = new Date(), roots = [ROOT, MAIN_ROOT]) {
  // Vòng 4: Windows không phân biệt hoa / thường ("d:\x" và "D:\X" là một) → bỏ trùng theo chữ thường.
  const seen = new Set();
  const uniq = [];
  for (const r of roots.map((x) => path.resolve(x))) {
    const k = process.platform === "win32" ? r.toLowerCase() : r;
    if (!seen.has(k)) { seen.add(k); uniq.push(r); }
  }
  for (const root of uniq) {
    const file = path.join(root, "test-ocr", "outputs", "api_usage.json");
    let j = {};
    try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* chưa có */ }
    const m = now.toISOString().slice(0, 7);
    j.openfoodfacts = j.openfoodfacts || {};
    j.openfoodfacts[m] = (j.openfoodfacts[m] || 0) + n;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(j, null, 2), "utf8");
  }
}

/**
 * fetch cho off-search.js: đọc / ghi cache đĩa; chiCache → không gọi mạng (ném lỗi); còn lại gọi qua `netFetch`
 * (trả { status, text } hoặc ném), giãn ≥ gapMs, trần cap lượt của vòng roundKey (đếm dồn ở luotFile), trần runCap
 * lượt của lần chạy này, cầu dao (breakerFails lỗi liền → nghỉ pauseMs, thử lại 1 lượt, vẫn lỗi thì ngừng).
 * Trả hàm fetch + bộ đếm.
 */
export function makeDiskFetch({
  cacheDir, chiCache, netFetch, cap = DEFAULT_CAP, runCap = Infinity, roundKey = ROUND_KEY, luotFile = LUOT_FILE, gapMs = GAP_MS,
  breakerFails = BREAKER_FAILS, pauseMs = BREAKER_PAUSE_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, usage = true,
}) {
  const stats = { calls: 0, ok: 0, cacheHits: 0, notCached: 0, failures: 0, failKinds: {}, breakerOpen: false, breakerPauses: 0, overCap: 0, overRunCap: 0 };
  let last = -Infinity;
  let streak = 0;
  let pauseNext = false;
  let probing = false;
  const fail = (kind) => {
    stats.failures++;
    stats.failKinds[kind] = (stats.failKinds[kind] || 0) + 1;
    if (probing) { stats.breakerOpen = true; return; }
    if (++streak >= breakerFails) pauseNext = true;
  };
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
    const luot = readLuot(luotFile);
    if ((luot[roundKey] || 0) >= cap) { stats.overCap++; throw new TypeError(`chạm trần ${cap} lượt ${roundKey}`); }
    if (stats.calls >= runCap) { stats.overRunCap++; throw new TypeError(`chạm trần ${runCap} lượt của lần chạy này`); }
    probing = false;
    if (pauseNext) {
      pauseNext = false;
      stats.breakerPauses++;
      console.log(`  cầu dao: ${breakerFails} lỗi liền, nghỉ ${pauseMs / 1000} giây rồi thử lại 1 lượt`);
      await sleep(pauseMs);
      probing = true;
    }
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    stats.calls++;
    writeLuot(luotFile, { ...readLuot(luotFile), [roundKey]: (readLuot(luotFile)[roundKey] || 0) + 1 });
    if (usage) addUsage(1);
    let r;
    try {
      r = await netFetch(url);
    } catch (e) {
      fail("network");
      throw e instanceof TypeError ? e : new TypeError(String(e?.message || e));
    }
    if (r.status === 429 || r.status >= 500) {
      fail(String(r.status));
    } else {
      streak = 0;
      probing = false;
      if (r.status === 200) { stats.ok++; fs.writeFileSync(file, JSON.stringify({ key, at: new Date().toISOString(), status: r.status, text: r.text }), "utf8"); }
    }
    return new Response(r.text, { status: r.status });
  }
  return { fetch: f, stats };
}

export async function browserNet() {
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

/** Nạp module app + danh mục + chỉ mục (một lần). */
export async function loadApp() {
  const t1 = await import(pathToFileURL(path.join(ROOT, "public", "chup-mat-do", "t1.mjs")).href);
  const fr = await import(pathToFileURL(path.join(ROOT, "src", "front-rank.js")).href);
  const os = await import(pathToFileURL(path.join(ROOT, "src", "off-search.js")).href);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"), "utf8"));
  const rIndex = fr.buildRankIndex(t1, catalog.products);
  return { t1, fr, os, catalog, rIndex };
}

/** Các ca đo: 7Up (máy + gõ), muối, rồi 30 ảnh của mỗi bộ chữ. found = kết quả T1 (rankFromItems / rankFromText). */
export function buildCases(app, setNames) {
  const { t1, fr, rIndex } = app;
  const cases = [
    { set: "7up", code: CODE_7UP, kind: "7up máy (ca dựng)", found: fr.rankFromItems(t1, rIndex, saltItems(LINES_7UP, 0.95)) },
    { set: "7up", code: CODE_7UP, kind: "7up gõ (ca dựng)", found: fr.rankFromText(t1, rIndex, TYPED_7UP) },
    { set: "muoi", code: null, kind: "muoi (ca dựng)", found: fr.rankFromItems(t1, rIndex, saltItems(SALT_LINES, 0.9)) },
  ];
  for (const s of setNames) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const code of ALL_CODES) {
      const items = bundle.items?.[code]?.items ?? null;
      cases.push({ set: s, code, kind: "anh", holdout: HOLDOUT.includes(code), found: items ? fr.rankFromItems(t1, rIndex, items) : null });
    }
  }
  for (const c of cases) c.queries = c.found ? app.os.cleanQuery(c.found.lines, { idf: rIndex.index.idf }) : [];
  return cases;
}

/**
 * Bỏ-một-ra KHÔNG rò (vòng 3): với mỗi ảnh của bộ chữ s, dựng lại chỉ mục T1 + từ vựng KHÔNG có sản phẩm đúng; câu tìm
 * T1 và câu OFF đều dựng từ từ vựng mới. Trả [{ set: "loo"+s, code, keep, rI, found, queries, note? }].
 */
export function looCases(app, s = "B") {
  const { t1, fr, catalog } = app;
  const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
  const out = [];
  for (const code of ALL_CODES) {
    const items = bundle.items?.[code]?.items ?? null;
    const keep = catalog.products.filter((p) => p.code !== code);
    if (!items) { out.push({ set: `loo${s}`, code, kind: "loo", note: "không có chữ OCR", queries: [] }); continue; }
    if (keep.length === catalog.products.length) { out.push({ set: `loo${s}`, code, kind: "loo", note: "không có trong danh mục", queries: [] }); continue; }
    const rI = fr.buildRankIndex(t1, keep);
    const found = fr.rankFromItems(t1, rI, items);
    out.push({ set: `loo${s}`, code, kind: "loo", keep, rI, found, queries: app.os.cleanQuery(found.lines, { idf: rI.index.idf }) });
  }
  return out;
}

/** Độ phủ dữ liệu OFF của các dòng kết quả một bộ: số ảnh có ≥ 1 câu trả được, đủ mọi câu, có kết quả khác 0. */
export function coverage(rows) {
  const withQ = rows.filter((r) => (r.offPer || []).length);
  return {
    n: rows.length,
    coCau: withQ.length,
    itNhat1Cau: withQ.filter((r) => r.offPer.some((p) => p.ok)).length,
    duCau: withQ.filter((r) => r.offPer.every((p) => p.ok)).length,
    khac0: rows.filter((r) => (r.offCount || 0) > 0).length,
  };
}

/** Chạy các câu của một ca qua off.search (mỗi câu 1 lượt, không lọc VN). Trả { hits (nối, bỏ trùng), per: [{ q, ok, kind, n }] }. */
export async function runOff(off, queries) {
  const per = [];
  const hits = [];
  const seen = new Set();
  for (const q of queries) {
    const r = await off.search(q);
    per.push({ q, ok: r.ok, kind: r.ok ? null : r.kind, n: r.ok ? r.hits.length : null });
    if (r.ok) for (const h of r.hits) if (!seen.has(h.code)) { seen.add(h.code); hits.push(h); }
  }
  return { hits, per, ok: per.length ? per.some((p) => p.ok) : true, allOk: per.every((p) => p.ok) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const startedAt = new Date().toISOString();
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const setNames = arg("--sets", "B,A").split(",").filter(Boolean);
  for (const s of setNames) if (!SETS[s]) throw new Error(`không biết bộ chữ ${s}`);
  const chiCache = argv.includes("--chi-cache");
  const cap = Number(arg("--max-calls", String(DEFAULT_CAP)));
  // --run-cap N: trần lượt gọi mạng của LẦN CHẠY này (chia trần vòng cho ≥ 2 đợt lấy)
  const runCap = Number(arg("--run-cap", "Infinity"));
  // --loo: thêm câu OFF của bỏ-một-ra không rò bộ B (ưu tiên thấp nhất, chạy sau cùng)
  const withLoo = argv.includes("--loo");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  const luotFile = arg("--luot", LUOT_FILE);
  const tag = arg("--tag", "");
  // --vong N (vòng 4): lượt của lần chạy này đếm vào khóa vongN của file --luot (mặc định vong3 như cũ)
  const roundKey = roundKeyFromArgv(argv);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(luotFile)) writeLuot(luotFile, { batDau: LUOT_START });
  const luotBefore = readLuot(luotFile);

  const app = await loadApp();
  let net = null;
  const disk = makeDiskFetch({
    cacheDir, chiCache, cap, runCap, luotFile, roundKey,
    netFetch: async (url) => { net ||= await browserNet(); return net.fetch(url); },
  });
  // timeoutMs dài hơn app (7 giây) để đo chất lượng tìm, không đo tốc độ mạng; limit cao vì đã giãn 8 giây ở makeDiskFetch.
  const off = app.os.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });
  const cases = [...buildCases(app, setNames), ...(withLoo && setNames.includes("B") ? looCases(app, "B") : [])];

  // lượt quét 1, rồi thử lại tối đa 1 lần các ca có câu lỗi
  const results = new Map();
  // --mot-luot: chỉ 1 lượt quét (dùng khi chạy lại để thử các câu lỗi của lần chạy trước đúng 1 lần nữa)
  const passes = argv.includes("--mot-luot") ? 1 : 2;
  for (let pass = 1; pass <= passes; pass++) {
    for (const c of cases) {
      const prev = results.get(c);
      if (pass === 2 && (!prev || prev.allOk)) continue;
      if (pass === 2 && disk.stats.breakerOpen) break;
      const r = await runOff(off, c.queries);
      results.set(c, { ...r, pass });
      const label = c.kind === "anh" || c.kind === "loo" ? `${c.set} ${c.code}` : c.kind;
      console.log(`[${pass}] ${label}: ${r.per.map((p) => `"${p.q}" ${p.ok ? p.n : "LỖI " + p.kind}`).join(" | ") || "(không câu)"}`);
    }
  }
  await net?.close();

  const rows = cases.map((c) => {
    const r = results.get(c);
    const t1Top5 = c.found ? c.found.hits.map((h) => h.code) : [];
    return {
      set: c.set, code: c.code, kind: c.kind, holdout: !!c.holdout, lines: c.found?.lines ?? null, note: c.note ?? null,
      t1Query: c.found ? c.found.query.join(" ") : null, t1Top5, t1Rank: c.code ? rank5(t1Top5, c.code) : null,
      offQueries: c.queries, offPer: r.per, offOk: r.ok, offAllOk: r.allOk, offCount: r.hits.length,
      offTop5: r.hits.slice(0, 5).map((h) => ({ code: h.code, name: h.name, brand: h.brand, vn: h.vn })),
      offRank: c.code ? rank5(r.hits.map((h) => h.code), c.code) : null,
      offAnyPos: c.code ? (r.hits.findIndex((h) => h.code === c.code) + 1 || null) : null,
      inCatalog: c.code ? app.catalog.products.some((p) => p.code === c.code) : null,
    };
  });
  const per = rows.flatMap((r) => r.offPer);
  const allSets = [...new Set(rows.map((r) => r.set))];
  const summary = {
    startedAt, endedAt: new Date().toISOString(), sets: setNames, withLoo, chiCache, cap, roundKey, runCap: Number.isFinite(runCap) ? runCap : null,
    bySet: Object.fromEntries(allSets.map((s) => {
      const p = rows.filter((r) => r.set === s);
      return [s, { baseline: SETS[s]?.baseline ?? null, t1: tallyBy(p, "t1Rank"), off: tallyBy(p, "offRank"), offAny: p.filter((r) => r.offAnyPos != null).length, caseErr: p.filter((r) => !r.offAllOk).length, coverage: coverage(p) }];
    })),
    queries: { total: per.length, ok: per.filter((p) => p.ok).length, kinds: Object.fromEntries([...new Set(per.filter((p) => !p.ok).map((p) => p.kind))].map((k) => [k, per.filter((p) => p.kind === k).length])) },
    case7up: rows.filter((r) => r.set === "7up").map((r) => ({ kind: r.kind, queries: r.offQueries, per: r.offPer, offAnyPos: r.offAnyPos })),
    caseSalt: rows.filter((r) => r.set === "muoi").map((r) => ({ queries: r.offQueries, per: r.offPer, top5: r.offTop5 })),
    offCalls: disk.stats,
    errorRate: disk.stats.calls ? +(disk.stats.failures / disk.stats.calls).toFixed(3) : null,
    luotBefore,
    luot: readLuot(luotFile),
  };
  const stamp = startedAt.replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `tu-dong-do-${roundKey.replace("vong", "v")}-${setNames.join("")}${withLoo ? "-loo" : ""}${chiCache ? "-chi-cache" : ""}${tag ? "-" + tag : ""}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 1), "utf8");
  console.log(JSON.stringify({ ...summary, case7up: summary.case7up.map((c) => ({ kind: c.kind, offAnyPos: c.offAnyPos, queries: c.queries })), caseSalt: summary.caseSalt.map((c) => ({ queries: c.queries, top5: c.top5.map((h) => h.name) })) }, null, 1));
  console.log(`Ghi: ${outFile}`);
}
