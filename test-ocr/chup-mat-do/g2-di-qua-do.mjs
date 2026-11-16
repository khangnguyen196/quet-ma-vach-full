// Đợt g2-di-qua vòng 1: KHUNG ĐO "cho ứng viên máy chủ khớp 0 từ với danh mục 1.452 đi qua G2" (Việc để sau (i) của
// dong-noi-bat). CHỈ đo trong Node, KHÔNG sửa src/ server/ public/: các cách cài trong file này, chỉ đổi phần gộp của
// ĐƯỜNG MÁY CHỦ (serverMerge); đường lùi (photoMerge + kho phụ 893) và "Tìm lại" không đổi.
// Gọi đúng hàm src/: serverMerge / serverCandidates (front-server.js), photoMerge / buildExtraIndex / joinExtra
// (front-extra.js), mergeFront / bm25DocScore / offDoc / joinOffResults (front-merge.js), photoOutcome (front-photo.js),
// cleanQuery / createOffSearch / strangeWords (off-search.js), rankFromItems / rankFromText (front-rank.js).
// OFF CHỈ đọc cache đĩa (0 lượt OFF thật), 0 lượt Azure, không chạy lại OCR (bộ A / B, ruaypuan, buldak).
//
//   node --max-old-space-size=6144 test-ocr/chup-mat-do/g2-di-qua-do.mjs --chi-nen [--out D:\tmp\g2-di-qua\ket-qua]
//        [--cache D:\tmp\tu-dong\cache-off] [--ocr D:\tmp\dong-noi-bat\ocr] [--danh-muc <c.jsonl.gz>] [--ghi-de]
//
// Vòng 1 P2: chỉ có NỀN (cờ --chi-nen) + kiểm chéo (1)–(4); luật chốt trước và các cách thêm ở commit sau.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bm25DocScore, offDoc } from "../../src/front-merge.js";
import { joinExtra } from "../../src/front-extra.js";
import { frontImageUrl } from "../../src/front-search.js";

// ---------------- hằng số ----------------
export const SERVER_K = 10;
export const MERGE_K = 5;
export const LOCK_TOP = 3;
export const OFF_MAX = 1;
export const OFF_GAP = 1;
/** offPromote của G2-g3-w3 (SERVER_MERGE_OPTS của src/front-server.js). */
export const PROMOTE = Object.freeze({ gap: 3, minWords: 3 });
export const BASE_SHA = "b588ed8";
export const CODE_7UP_DIET = "8934588752117";
export const RUAYPUAN_CODE = "8852052150101";
export const BULDAK_CODE = "8801073250574";
export const SALT_CODE = "8934673218368";
/** 6 ca hàng ngoại dựng (như kho-lon-do.mjs, foreignCases của tu-dong-v42-do.mjs). */
export const FOREIGN_CODES = Object.freeze(["8930000721020", "8930017095664", "8930053151010", "8930070035980", "8930080005003", "8930279103831"]);
export const CONDS = Object.freeze(["i", "ii"]);
export const PATHS = Object.freeze(["may", "lui"]);

/** Khóa ca (có kind, như kho-lon-do.mjs và keyOf đã sửa của dong-noi-bat-do.mjs). */
export function keyOf(c) {
  return `${c.set}|${c.code ?? c.kind}|${c.kind}`;
}

/** Vị trí (1–n) của mã trong danh sách mã, không có → null. */
export function rankIn(codes, code, n = MERGE_K) {
  const i = (codes || []).slice(0, n).indexOf(code);
  return i < 0 ? null : i + 1;
}

// ---------------- G2 bản sao trong khung đo (để các cách c-* đổi được điểm mục máy chủ) ----------------
// g2Local(…) với serverScore = null PHẢI trùng serverMerge(…).merged của src/ từng ca (kiểm chéo (1), test + lúc chạy).
// Chép đúng nhánh f1 của mergeFront với SERVER_MERGE_OPTS: lockTop 3, offMax 1, offGap 1, minMatch 1, offTopRule null,
// offPromote { gap 3, minWords 3 }, strangeFill false (STRANGE_MODE null).

function catalogItem(p, score = null) {
  return { code: p.code, name: String(p.name ?? ""), brand: String(p.brand ?? ""), img: frontImageUrl(p.code, p.img), source: "catalog", vn: true, score };
}

function offItem(h, score = null) {
  const it = { code: h.code, name: String(h.name ?? ""), brand: String(h.brand ?? ""), img: String(h.img ?? ""), source: "off", vn: h.vn === true, score };
  if (h.extra === true) it.extra = true;
  return it;
}

function t1Items(products, t1Result, k) {
  const out = [];
  for (const h of t1Result?.hits || []) {
    const p = products[h?.i];
    if (!p || p.code !== h.code) continue;
    out.push(catalogItem(p, Number.isFinite(h.score) ? h.score : null));
    if (out.length >= k) break;
  }
  return out;
}

/** Lớp chặn (bản sao applyGuard của front-merge.js). */
export function applyGuard(ranked, base, { k = MERGE_K, lockTop = LOCK_TOP, offMax = OFF_MAX } = {}) {
  const lock = base.slice(0, Math.min(lockTop, base.length));
  const out = [...lock];
  const have = new Set(lock.map((x) => x.code));
  const spare = [];
  let offs = 0;
  for (const it of ranked) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    if (it.source === "off" && offs >= offMax) { spare.push(it); continue; }
    if (it.source === "off") offs++;
    have.add(it.code);
    out.push(it);
  }
  for (const it of spare) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    have.add(it.code);
    out.push(it);
  }
  return out.slice(0, k);
}

/** Đánh dấu như serverMerge: mục OFF có mã KHÔNG trong S mang extra; S bỏ extra; joinExtra(OFF, S). */
export function joinServer(off, S) {
  const server = Array.isArray(S) ? S : [];
  const sCodes = new Set(server.map((h) => h.code));
  const offMarked = off && off.ok === true && Array.isArray(off.hits)
    ? { ...off, hits: off.hits.map((h) => { const { extra, ...rest } = h; return sCodes.has(h.code) ? rest : { ...rest, extra: true }; }) }
    : off;
  return { joined: joinExtra(offMarked, server.map(({ extra, ...h }) => h)), sCodes };
}

/**
 * G2 bản sao. ctx = { t1, rIndex, products }; serverScore (tùy chọn) = (h, { doc, index, query, ref, m1452 }) →
 * { score, matched } thay điểm / số từ khớp của mục máy chủ KHÔNG có trong danh mục (mã trong S); null = như G2.
 * Trả ≤ 5 mục (dạng mergeFront).
 */
export function g2Local({ t1, rIndex, products }, found, off, S, { serverScore = null } = {}) {
  const { joined, sCodes } = joinServer(off, S);
  const list = Array.isArray(products) ? products : [];
  const k = MERGE_K;
  const base = t1Items(list, found, k);
  if (!(joined && joined.ok === true && Array.isArray(joined.hits) && joined.hits.length)) return base;
  const index = rIndex.index;
  const byCode = new Map();
  list.forEach((p, i) => { if (p && typeof p.code === "string" && !byCode.has(p.code)) byCode.set(p.code, i); });
  const offs = [];
  const seenOff = new Set();
  for (const h of joined.hits) {
    if (!h || typeof h.code !== "string" || seenOff.has(h.code)) continue;
    seenOff.add(h.code);
    offs.push(byCode.has(h.code) ? { inCatalog: true, i: byCode.get(h.code), h } : { inCatalog: false, h });
  }
  const query = Array.isArray(found?.query) ? found.query : [];
  const cands = new Map();
  let order = 0;
  for (const it of base) cands.set(it.code, { item: it, score: it.score ?? 0, rankScore: it.score ?? 0, tier: 0, vn: true, src: 0, order: order++ });
  const ref = base.length ? (cands.get(base[0].code)?.score ?? 0) : 0;
  for (const o of offs) {
    if (o.inCatalog) {
      const p = list[o.i];
      if (cands.has(p.code)) continue;
      const doc = index.tf[o.i];
      const { score, matched } = doc && doc.code === p.code ? bm25DocScore(index, doc, query) : { score: 0, matched: 0 };
      if (matched < 1) continue;
      cands.set(p.code, { item: catalogItem(p, score), score, rankScore: score, tier: 0, vn: true, src: 0, order: order++ });
    } else {
      if (cands.has(o.h.code)) continue;
      const extra = o.h.extra === true;
      const doc = offDoc(t1, o.h.text || `${o.h.name ?? ""} ${o.h.brand ?? ""}`);
      let { score, matched } = bm25DocScore(index, doc, query);
      if (serverScore && sCodes.has(o.h.code)) ({ score, matched } = serverScore(o.h, { doc, index, query, ref, m1452: matched }));
      if (matched < 1) continue;
      cands.set(o.h.code, { item: offItem(o.h, score), score, rankScore: score - OFF_GAP, tier: 0, vn: o.h.vn === true, src: 1, order: order++, matched, extra });
    }
  }
  const sorted = [...cands.values()]
    .sort((a, b) => a.tier - b.tier || b.rankScore - a.rankScore || (b.vn - a.vn) || a.src - b.src || a.order - b.order);
  const toItem = (x) => ({ ...x.item, score: x.score });
  let best = null;
  for (const c of sorted) if (c.src === 1 && !c.extra && c.matched >= PROMOTE.minWords && (!best || c.score > best.score)) best = c;
  if (best && best.score >= ref + PROMOTE.gap) {
    const rest = applyGuard(sorted.filter((c) => c !== best).map(toItem), base, { k: k - 1, lockTop: LOCK_TOP, offMax: OFF_MAX - 1 });
    return [toItem(best), ...rest].slice(0, k);
  }
  return applyGuard(sorted.map(toItem), base, { k, lockTop: LOCK_TOP, offMax: OFF_MAX });
}

/**
 * Mục máy chủ "đi qua" được: mục của S khớp 0 từ với chỉ mục 1.452 (bm25DocScore(…).matched === 0, cùng tài liệu
 * mergeFront dùng: mã trong danh mục → tài liệu danh mục, còn lại offDoc(text)) — G2 bỏ những mục này.
 * Trả [{ h, j (vị trí trong S, 0-), item (dạng mục hiển thị, score 0), inCatalog, rawMatched (số từ khác nhau của câu tìm
 * T1 có trong tài liệu, kể cả từ ngoài từ vựng 1.452) }] theo thứ tự S.
 */
export function passThrough({ t1, rIndex, products }, found, S) {
  const list = Array.isArray(products) ? products : [];
  const index = rIndex.index;
  const query = Array.isArray(found?.query) ? found.query : [];
  const byCode = new Map();
  list.forEach((p, i) => { if (p && typeof p.code === "string" && !byCode.has(p.code)) byCode.set(p.code, i); });
  const out = [];
  (Array.isArray(S) ? S : []).forEach((h, j) => {
    if (!h || typeof h.code !== "string") return;
    const ci = byCode.get(h.code);
    const inCatalog = ci !== undefined;
    const doc = inCatalog ? index.tf[ci] : offDoc(t1, h.text || `${h.name ?? ""} ${h.brand ?? ""}`);
    if (!doc) return;
    const { matched } = bm25DocScore(index, doc, query);
    if (matched !== 0) return;
    const rawMatched = new Set(query.filter((w) => doc.m.has(w))).size;
    const item = inCatalog ? catalogItem(list[ci], 0) : offItem({ ...h, extra: undefined }, 0);
    out.push({ h, j, item, inCatalog, rawMatched });
  });
  return out;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const onlyBase = argv.includes("--chi-nen");
  if (!onlyBase) {
    console.error("Vòng 1 P2: chỉ chạy được --chi-nen (chưa có cách nào).");
    process.exit(2);
  }
  const outDir = arg("--out", "D:\\tmp\\g2-di-qua\\ket-qua");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const ocrDir = arg("--ocr", "D:\\tmp\\dong-noi-bat\\ocr");
  const khoLonCase = arg("--kho-lon", "D:\\tmp\\kho-lon\\ket-qua\\v2-tung-ca-abc.json");
  const dnbNen = arg("--dong-noi-bat", "D:\\tmp\\dong-noi-bat\\ket-qua\\v1-nen.json");
  const { loadApp, makeDiskFetch, ROOT, SETS, LINES_7UP, TYPED_7UP } = await import("./tu-dong-do.mjs");
  const { foreignCases, MO_RONG } = await import("./tu-dong-v42-do.mjs");
  const { ALL_CODES, SALT_LINES, saltItems } = await import("./nang-t1-do.mjs");
  const { readLevel, pickProbes, mergeByMethod } = await import("./kho-lon-do.mjs");
  const dnb = await import("./dong-noi-bat-do.mjs");
  const dmFile = arg("--danh-muc", path.join(ROOT, "server", "catalog", "c.jsonl.gz"));
  const outFile = path.join(outDir, "nen.json");
  if (fs.existsSync(outFile) && !argv.includes("--ghi-de")) {
    console.error(`Đã có ${outFile}. Thêm --ghi-de nếu thật sự muốn ghi đè.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const cp = await import("node:child_process");
  const git = (c) => { try { return cp.execSync(c, { cwd: ROOT }).toString().trim(); } catch { return null; } };
  const sha = git("git rev-parse HEAD");
  const dirty = git("git status --porcelain") !== "";
  let srcSame = false;
  try { cp.execSync(`git diff --quiet ${BASE_SHA} -- src server public package.json package-lock.json`, { cwd: ROOT }); srcSame = true; } catch { srcSame = false; }

  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const osx = app.os;
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, ...rel.split("/"))).href);
  const fm = await imp("src/front-merge.js");
  const fx = await imp("src/front-extra.js");
  const fp = await imp("src/front-photo.js");
  const fsv = await imp("src/front-server.js");
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const catalogCodes = new Set(products.map((p) => p.code));
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json"), "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);
  const ctx = { t1, rIndex, products };
  const consts = {
    confidenceNull: fr.CONFIDENCE_RULE.feature === null && fr.CONFIDENCE_RULE.threshold === null,
    strangeNull: osx.STRANGE_MODE === null, serverK: fsv.SERVER_MAX === SERVER_K,
    mergeOpts: JSON.stringify(fsv.SERVER_MERGE_OPTS) === JSON.stringify({ offPromote: PROMOTE }),
    guard: fm.DEFAULT_GUARD.lockTop === LOCK_TOP && fm.DEFAULT_GUARD.offMax === OFF_MAX && fm.DEFAULT_GUARD.offGap === OFF_GAP,
  };

  // ---- danh mục (c) ----
  const t0 = Date.now();
  const lv = readLevel(dmFile);
  const rIC = fr.buildRankIndex(t1, lv.rows);
  console.log(`Danh mục (c): ${lv.rows.length} sp, dựng ${Date.now() - t0} ms (${dmFile})`);

  // ---- ca ----
  const cases = [
    { set: "7up", kind: "may", code: CODE_7UP_DIET, input: { items: saltItems(LINES_7UP, 0.95) } },
    { set: "7up", kind: "go", code: CODE_7UP_DIET, input: { text: TYPED_7UP } },
    { set: "muoi", kind: "muoi", code: null, input: { items: saltItems(SALT_LINES, 0.9) } },
  ];
  const shots = {};
  for (const [name, code] of [["ruaypuan", RUAYPUAN_CODE], ["buldak", null]]) {
    const f = path.join(ocrDir, `${name}.json`);
    const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
    shots[name] = j;
    cases.push({ set: name, kind: "man-hinh", code, input: j?.items ? { items: j.items } : null });
  }
  for (const s of ["B", "A"]) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const code of ALL_CODES) {
      const items = bundle.items?.[code]?.items ?? null;
      cases.push({ set: s, kind: "anh", code, input: items ? { items } : null });
    }
  }
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), catalogCodes, osx.strangeWords, idf);
  for (const f of foreign) cases.push({ set: "ngoai", kind: "ngoai", code: f.code, input: { items: saltItems(f.lines, 0.95) } });
  const probes = pickProbes(lv.rows, { tokens: t1.bm25Tokens });
  for (const p of probes) cases.push({ set: "do", kind: `do-${p.grp}`, grp: p.grp, code: p.code, input: { items: saltItems(p.lines, 0.95) } });
  const keys = new Set(cases.map(keyOf));
  if (keys.size !== cases.length) throw new Error(`khóa ca trùng: ${cases.length - keys.size}`);

  // ---- found (T1 1.452), câu OFF, OFF (i)/(ii), S (10 ứng viên trên (c)) ----
  const rank = (ri, input, k) => (!input ? null : input.items ? fr.rankFromItems(t1, ri, input.items, k) : fr.rankFromText(t1, ri, input.text, k));
  const toS = (res) => fsv.serverCandidates({
    candidates: (res?.hits || []).map((h) => {
      const r = lv.rows[h.i];
      const v = (x) => (x == null ? "" : x);
      return { code: v(r.code), name: v(r.name), brand: v(r.brand), img: v(r.img), text: v(r.text), grp: v(r.grp), score: h.score };
    }),
  });
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1e9 });
  for (const c of cases) {
    c.found = rank(rIndex, c.input, MERGE_K);
    c.queries = c.found ? osx.cleanQuery(c.found.lines, { idf }) : [];
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.off = { i: c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" }, ii: fm.joinOffResults(per) };
    c.allOk = per.every((p) => p.ok === true);
    c.sRes = rank(rIC, c.input, SERVER_K);
    c.S = toS(c.sRes);
  }

  // ---- NỀN: MÁY = serverMerge của src/; LÙI = photoMerge của src/ ----
  const codesOf = (list) => list.map((x) => x.code);
  const check1 = { mayCells: 0, mayLocalSame: 0, mayKhoLonFnSame: 0, luiCells: 0, luiSame: 0, mayLocalDiff: [], mayKhoLonFnDiff: [], luiDiff: [] };
  for (const c of cases) {
    c.may = {};
    c.lui = {};
    c.kind2 = {};
    for (const cond of CONDS) {
      if (!c.found) { c.may[cond] = []; c.lui[cond] = []; continue; }
      const called = c.queries.length > 0;
      const mm = fsv.serverMerge(ctx, c.found, c.off[cond], c.S, { called }).merged;
      const ml = fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called }).merged;
      c.may[cond] = mm;
      c.lui[cond] = ml;
      c.kind2[`may|${cond}`] = fp.photoOutcome(mm).kind;
      c.kind2[`lui|${cond}`] = fp.photoOutcome(ml).kind;
      // kiểm chéo (1): bản sao G2 của khung đo (g2Local) trùng serverMerge (cả mục, không chỉ mã); mergeByMethod
      // G2-g3-w3 của kho-lon-do.mjs trùng; LÙI gọi lại photoMerge độc lập trùng.
      check1.mayCells++;
      if (JSON.stringify(g2Local(ctx, c.found, c.off[cond], c.S)) === JSON.stringify(mm)) check1.mayLocalSame++;
      else check1.mayLocalDiff.push(`${keyOf(c)}|${cond}`);
      const kl = mergeByMethod({ t1, rIndex, products, found: c.found, off: c.off[cond], S: c.S, method: "G2-g3-w3", catalogCodes });
      if (JSON.stringify(codesOf(kl)) === JSON.stringify(codesOf(mm))) check1.mayKhoLonFnSame++;
      else check1.mayKhoLonFnDiff.push(`${keyOf(c)}|${cond}`);
      check1.luiCells++;
      const ml2 = fx.photoMerge({ t1, rIndex, products, xi }, c.found, c.off[cond], { called }).merged;
      if (JSON.stringify(ml2) === JSON.stringify(ml)) check1.luiSame++;
      else check1.luiDiff.push(`${keyOf(c)}|${cond}`);
    }
  }
  const pos = (c, p, cond, code = c.code) => (code ? rankIn(codesOf(c[p][cond]), code) : null);
  const tally = (set, p, cond) => {
    const rs = cases.filter((c) => c.set === set);
    return { top1: rs.filter((c) => pos(c, p, cond) === 1).length, top5: rs.filter((c) => pos(c, p, cond) != null).length, n: rs.length };
  };
  const sum = {};
  for (const s of ["B", "A", "ngoai", "do"]) for (const p of PATHS) for (const cond of CONDS) sum[`${p}|${s}|${cond}`] = tally(s, p, cond);

  // ---- kiểm chéo (2): bộ A / B trùng v1-nen của dong-noi-bat (tổng + từng ca, từng ô) ----
  const check2 = { sums: {}, sumsOk: true, perCase: { cells: 0, same: 0, diff: [] }, file: dnbNen };
  for (const [s, top1, top5] of [["B", 14, 19], ["A", 13, 19]]) for (const p of PATHS) for (const cond of CONDS) {
    const v = sum[`${p}|${s}|${cond}`];
    check2.sums[`${p}|${s}|${cond}`] = `${v.top1}/${v.top5}`;
    if (v.top1 !== top1 || v.top5 !== top5) check2.sumsOk = false;
  }
  const dnbBase = fs.existsSync(dnbNen) ? JSON.parse(fs.readFileSync(dnbNen, "utf8")) : null;
  if (dnbBase) {
    for (const c of cases.filter((x) => ["B", "A", "muoi", "ruaypuan", "buldak"].includes(x.set) || (x.set === "7up" && x.kind === "go"))) {
      const old = dnbBase.baseTable[`${c.set}|${c.code ?? c.kind}`];
      if (!old) continue;
      for (const p of PATHS) for (const cond of CONDS) {
        check2.perCase.cells++;
        const a = JSON.stringify(old.none ? [] : old[`${p}|${cond}`]?.top5);
        const b = JSON.stringify(codesOf(c[p][cond]));
        if (a === b) check2.perCase.same++;
        else check2.perCase.diff.push(`${keyOf(c)}|${p}|${cond}`);
      }
    }
  }

  // ---- kiểm chéo (3): 6 ca ngoại MÁY trùng kho-lon G2-g3-w3 mức (c) (file từng ca v2), 4/12 trong 5 ----
  const check3 = { foreignCodesOk: JSON.stringify(foreign.map((f) => f.code)) === JSON.stringify(FOREIGN_CODES), foreignSame: 0, foreignCells: 0, foreignDiff: [], otherCells: 0, otherSame: 0, otherDiff: [], file: khoLonCase };
  const kl = fs.existsSync(khoLonCase) ? JSON.parse(fs.readFileSync(khoLonCase, "utf8")).perCase?.["c|G2-g3-w3"] : null;
  if (kl) {
    for (const c of cases) {
      const old = kl[keyOf(c)];
      if (!old) continue;
      for (const cond of CONDS) {
        const same = JSON.stringify(old[cond]) === JSON.stringify(codesOf(c.may[cond]));
        if (c.set === "ngoai") { check3.foreignCells++; if (same) check3.foreignSame++; else check3.foreignDiff.push(`${keyOf(c)}|${cond}`); }
        else { check3.otherCells++; if (same) check3.otherSame++; else check3.otherDiff.push(`${keyOf(c)}|${cond}`); }
      }
    }
  }
  const f5 = CONDS.reduce((n, cond) => n + sum[`may|ngoai|${cond}`].top5, 0);
  check3.foreignIn5 = f5;
  check3.ok = check3.foreignCodesOk && check3.foreignCells === 12 && check3.foreignSame === 12 && f5 === 4;

  // ---- kiểm chéo (4): buldak MÁY vị trí 1 = 8801073250574 ----
  const bu = cases.find((c) => c.set === "buldak");
  const ru = cases.find((c) => c.set === "ruaypuan");
  const check4 = { i: bu.may.i[0]?.code ?? null, ii: bu.may.ii[0]?.code ?? null };
  check4.ok = check4.i === BULDAK_CODE && check4.ii === BULDAK_CODE;

  // ---- S Node trùng candidates máy chủ thật (2 ảnh chụp màn hình) ----
  const serverMatch = {};
  for (const [name, c] of [["ruaypuan", ru], ["buldak", bu]]) {
    const cand = shots[name]?.candidates;
    serverMatch[name] = Array.isArray(cand) ? JSON.stringify(cand.map((x) => x.code)) === JSON.stringify(codesOf(c.S)) : null;
  }

  // ---- ruaypuan: hạng trong 10 ứng viên, sâu 100; chỉ báo "ruaypuan giả định" (ứng viên a-c80+c-2 của dong-noi-bat) ----
  const ruDeep = ru.input ? fr.rankFromItems(t1, rIC, ru.input.items, 100) : null;
  const ruRows = dnb.rowsOf(t1, ru.input);
  const hypoRes = dnb.methodRank(t1, rIC, ruRows, { a: dnb.A_VARIANTS["a-c80"], c: { beta: 2 } }, SERVER_K);
  const hypoS = toS(hypoRes);
  const ruHypo = {
    note: "ỨNG VIÊN GIẢ ĐỊNH (a-c80+c-2 của dong-noi-bat), máy chủ thật KHÔNG trả như vậy; chỉ báo, không dùng để chọn",
    sRank: rankIn(codesOf(hypoS), RUAYPUAN_CODE, SERVER_K), S: codesOf(hypoS),
    may: Object.fromEntries(CONDS.map((cond) => {
      const m = fsv.serverMerge(ctx, ru.found, ru.off[cond], hypoS, { called: ru.queries.length > 0 }).merged;
      return [cond, { rank: rankIn(codesOf(m), RUAYPUAN_CODE), top5: codesOf(m) }];
    })),
    passThrough: passThrough(ctx, ru.found, hypoS).map((x) => ({ j: x.j + 1, code: x.h.code, rawMatched: x.rawMatched })),
  };
  const ruInfo = {
    queryWords: ru.found?.query.length ?? null, sRank: rankIn(codesOf(ru.S), RUAYPUAN_CODE, SERVER_K),
    rankDeep100: ruDeep ? rankIn(ruDeep.hits.map((h) => h.code), RUAYPUAN_CODE, 100) : null,
    passThrough: passThrough(ctx, ru.found, ru.S).map((x) => ({ j: x.j + 1, code: x.h.code, rawMatched: x.rawMatched })),
  };

  // ---- bảng nền ----
  const cellOf = (c) => Object.fromEntries(PATHS.flatMap((p) => CONDS.map((cond) => [`${p}|${cond}`, {
    rank: c.code ? pos(c, p, cond) : null, top1: c[p][cond][0]?.code ?? null, kind: c.kind2[`${p}|${cond}`], top5: codesOf(c[p][cond]),
  }])));
  const special = {};
  for (const c of cases.filter((x) => ["7up", "muoi", "ruaypuan", "buldak", "ngoai"].includes(x.set))) {
    special[keyOf(c)] = { sRank: c.code ? rankIn(codesOf(c.S), c.code, SERVER_K) : null, S: codesOf(c.S), queries: c.queries, ...cellOf(c),
      passThrough: c.found ? passThrough(ctx, c.found, c.S).map((x) => ({ j: x.j + 1, code: x.h.code, rawMatched: x.rawMatched })) : [] };
  }
  // số ca có mục đi qua được (chỉ báo cấu trúc: G2 đang bỏ bao nhiêu mục khớp 0 từ)
  const ptStats = {};
  for (const s of ["B", "A", "7up", "muoi", "ruaypuan", "buldak", "ngoai", "do"]) {
    const rs = cases.filter((c) => c.set === s && c.found);
    ptStats[s] = { n: rs.length, s0: rs.filter((c) => passThrough(ctx, c.found, c.S).some((x) => x.j === 0)).length, any: rs.filter((c) => passThrough(ctx, c.found, c.S).length > 0).length };
  }
  const coverage = Object.fromEntries(["B", "A", "7up", "muoi", "ruaypuan", "buldak", "ngoai", "do"].map((s) => {
    const rs = cases.filter((c) => c.set === s);
    return [s, { n: rs.length, coCau: rs.filter((c) => c.queries.length).length, duCau: rs.filter((c) => c.queries.length && c.allOk).length }];
  }));
  const check1ok = check1.mayLocalSame === check1.mayCells && check1.mayKhoLonFnSame === check1.mayCells && check1.luiSame === check1.luiCells;
  const check2ok = check2.sumsOk && !!dnbBase && check2.perCase.same === check2.perCase.cells;
  const checks = { "1": { ok: check1ok, ...check1 }, "2": { ok: check2ok, ...check2 }, "3": check3, "4": check4 };
  const allOk = check1ok && check2ok && check3.ok && check4.ok;
  const perCase = Object.fromEntries(cases.map((c) => [keyOf(c), {
    queries: c.queries, S: codesOf(c.S), found: c.found ? c.found.hits.map((h) => h.code) : null,
    may: Object.fromEntries(CONDS.map((cond) => [cond, codesOf(c.may[cond])])), lui: Object.fromEntries(CONDS.map((cond) => [cond, codesOf(c.lui[cond])])),
  }]));
  const out = {
    at: new Date().toISOString(), sha, dirty, srcSame, baseSha: BASE_SHA, consts, cacheOnly: true, offNetCalls: disk.stats.calls, azureCalls: 0, ocrRerun: false,
    catalogFile: dmFile, catalogN: lv.rows.length, foreign: foreign.map((f) => ({ code: f.code, lines: f.lines })), probesN: probes.length,
    coverage, sum, special, ruInfo, ruHypo, serverMatch, ptStats, checks, allOk, perCase, offStats: disk.stats,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");

  // ---- in ----
  const f = (v) => (v == null ? "-" : v);
  console.log(`sha ${sha} dirty ${dirty}; src/server/public trùng ${BASE_SHA}: ${srcSame}; hằng số ${JSON.stringify(consts)}`);
  console.log(`Độ phủ (đủ câu / có câu / số ca): ${Object.entries(coverage).map(([s, v]) => `${s} ${v.duCau}/${v.coCau}/${v.n}`).join(" | ")}`);
  console.log(`NỀN: ${Object.entries(sum).map(([k, v]) => `${k} ${v.top1}/${v.top5}`).join(" | ")}`);
  for (const [k, v] of Object.entries(special)) {
    console.log(`  ${k}: S hạng ${f(v.sRank)}; ${["may|i", "may|ii", "lui|i", "lui|ii"].map((x) => `${x} v1 ${f(v[x].top1)} hạng ${f(v[x].rank)} ${v[x].kind}`).join("; ")}; đi qua được ${JSON.stringify(v.passThrough)}`);
  }
  console.log(`ruaypuan: ${JSON.stringify(ruInfo)}`);
  console.log(`ruaypuan GIẢ ĐỊNH: hạng ${f(ruHypo.sRank)} trong 10; MÁY nền với ứng viên giả định ${CONDS.map((cond) => `${cond} ${f(ruHypo.may[cond].rank)}`).join(", ")}; đi qua được ${JSON.stringify(ruHypo.passThrough)}`);
  console.log(`S Node trùng candidates máy chủ: ${JSON.stringify(serverMatch)}; mục đi qua được (ca có S[0] / ca có ≥ 1): ${JSON.stringify(ptStats)}`);
  console.log(`Kiểm chéo (1) ${check1ok ? "ĐẠT" : "LỆCH"}: g2Local = serverMerge ${check1.mayLocalSame}/${check1.mayCells}, mergeByMethod G2-g3-w3 = serverMerge ${check1.mayKhoLonFnSame}/${check1.mayCells}, LÙI photoMerge gọi lại ${check1.luiSame}/${check1.luiCells} ${[...check1.mayLocalDiff, ...check1.mayKhoLonFnDiff, ...check1.luiDiff].slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (2) ${check2ok ? "ĐẠT" : "LỆCH"}: ${JSON.stringify(check2.sums)}; từng ca so v1-nen ${check2.perCase.same}/${check2.perCase.cells} ${check2.perCase.diff.slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (3) ${check3.ok ? "ĐẠT" : "LỆCH"}: mã 6 ca ${check3.foreignCodesOk}; ngoại trùng kho-lon ${check3.foreignSame}/${check3.foreignCells}, trong 5 ${f5}/12; ca khác trùng kho-lon ${check3.otherSame}/${check3.otherCells} ${[...check3.foreignDiff, ...check3.otherDiff].slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (4) ${check4.ok ? "ĐẠT" : "LỆCH"}: buldak MÁY vị trí 1 ${JSON.stringify({ i: check4.i, ii: check4.ii })}`);
  console.log(`OFF: ${JSON.stringify(disk.stats)}; Ghi: ${outFile}`);
  if (!allOk) { console.error("KIỂM CHÉO LỆCH: dừng báo, không sửa src/."); process.exit(3); }
}
