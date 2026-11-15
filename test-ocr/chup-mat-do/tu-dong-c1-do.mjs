// Đợt tu-dong vòng 6 (P5.3–P5.4): đo lại KHO PHỤ 893 cách C1 (src/front-extra.js) trên LỚP CHẶN CUỐI (DEFAULT_GUARD +
// STRANGE_MODE hiện tại của src/, tức sau quyết định P1 + P2), CHỈ đọc cache OFF đĩa; và đo thời gian trong Node.
//
//   node test-ocr/chup-mat-do/tu-dong-c1-do.mjs [--sets B,A] [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua]
//   node test-ocr/chup-mat-do/tu-dong-c1-do.mjs --thoi-gian      (đo thời gian: đọc + parse, buildExtraIndex, searchExtra)
//
// ===================================================================================================================
// ĐIỀU KIỆN CHỐT TRƯỚC (quyết định chủ dự án 15/11/2026; commit riêng trước khi có kết quả; không đổi sau khi thấy số)
// ===================================================================================================================
// Điều kiện đo: (i) OFF lỗi (off = null); (ii) OFF thật từ cache (câu cleanQuery mặc định hiện tại; câu thiếu cache =
// câu lỗi). Ca: bộ B, bộ A, 7Up 2 kiểu (chữ máy chủ + câu gõ), muối, 6 ca hàng ngoại dựng của P2 (foreignCases của
// tu-dong-v42-do.mjs).
// Ba cột: "cuoi+kho" = lớp chặn cuối + kho phụ (mergeFront mặc định, offResult = joinExtra(off, searchExtra(…)));
//         (a) "cuoi" = lớp chặn cuối KHÔNG kho phụ; (b) "moc-v5" = mốc DEFAULT_GUARD vòng 5 (lockTop 3, offMax 1,
//         offGap 1, offTopRule null, offPromote null, từ lạ tắt: câu cleanQuery strange null + strangeFill false).
// BẮT BUỘC (cả B và A, cả (i) và (ii)):
//   (1) 0 ảnh mất vị trí 1 của "cuoi+kho" so với CẢ (a) và (b) cùng điều kiện;
//   (2) ảnh rơi khỏi 5 (so với (a) và với (b)) chỉ được nằm trong danh sách chủ dự án đã chấp nhận:
//       B {8936012061321, 8936221043071}; A {8936012061321, 8936221043071, 8936045081310};
//   (3) ca muối không khẳng định (app luôn hiện khung "có thể nhầm": CONFIDENCE_RULE = luôn không chắc) → ghi top 5 kèm
//       nguồn (catalog / off / extra).
// Đạt hết → "C1 đủ điều kiện nối vào app ở vòng 7". Có ảnh mất vị trí 1 HOẶC rơi khỏi 5 ngoài danh sách → "KHÔNG nối,
// cần chủ dự án quyết" kèm danh sách ảnh; KHÔNG tự đổi luật, KHÔNG tự nối.
// ===================================================================================================================
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { loadApp, buildCases, makeDiskFetch, runOff, rank5, ROOT, CODE_7UP } from "./tu-dong-do.mjs";
import { foreignCases, lossOf, MO_RONG, LEMON_7UP, PLAIN_7UP } from "./tu-dong-v42-do.mjs";
import { saltItems } from "./nang-t1-do.mjs";

/** Ảnh chủ dự án đã chấp nhận rơi khỏi 5 (đo vòng 5). */
export const ACCEPTED_OUT5 = Object.freeze({
  B: Object.freeze(["8936012061321", "8936221043071"]),
  A: Object.freeze(["8936012061321", "8936221043071", "8936045081310"]),
});
/** Mốc vòng 5 (DEFAULT_GUARD trước vòng 6, từ lạ tắt). */
export const MOC_V5 = Object.freeze({ lockTop: 3, offMax: 1, offGap: 1, offTopRule: null, offPromote: null, strangeFill: false });

/** Phán theo điều kiện chốt trước. table[`${set}-${cond}`] = { vsA: lossOf, vsB: lossOf }. Trả { ok, lostTop1, out5Bad }. */
export function judgeC1(table, sets = ["B", "A"], conds = ["i", "ii"], accepted = ACCEPTED_OUT5) {
  const lostTop1 = [];
  const out5Bad = [];
  for (const s of sets) for (const c of conds) {
    const t = table[`${s}-${c}`];
    if (!t) { lostTop1.push(`${s}-${c}: thiếu số`); continue; }
    for (const v of [t.vsA, t.vsB]) {
      for (const code of v.lostTop1) lostTop1.push(`${s}-${c} ${code}`);
      for (const code of v.out5) if (!(accepted[s] || []).includes(code)) out5Bad.push(`${s}-${c} ${code}`);
    }
  }
  const uniq = (a) => [...new Set(a)];
  return { ok: !lostTop1.length && !out5Bad.length, lostTop1: uniq(lostTop1), out5Bad: uniq(out5Bad) };
}

/** Trung vị của mảng số. */
export function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const setNames = arg("--sets", "B,A").split(",").filter(Boolean);
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  fs.mkdirSync(outDir, { recursive: true });
  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const osx = app.os;
  const fm = await import(pathToFileURL(path.join(ROOT, "src", "front-merge.js")).href);
  const fx = await import(pathToFileURL(path.join(ROOT, "src", "front-extra.js")).href);
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const extraFile = path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json");

  if (argv.includes("--thoi-gian")) {
    const runs = [];
    let store = null;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      store = JSON.parse(fs.readFileSync(extraFile, "utf8"));
      const t1a = performance.now();
      const xi = fx.buildExtraIndex(t1, store.products);
      const t2 = performance.now();
      runs.push({ readParse: t1a - t0, build: t2 - t1a, xi });
    }
    const xi = runs.at(-1).xi;
    const casesB = buildCases(app, ["B"]).filter((c) => c.set === "B" && c.found);
    const per = [];
    for (const c of casesB) {
      const t0 = performance.now();
      fx.searchExtra(rIndex.index, xi, c.found);
      per.push(performance.now() - t0);
    }
    const raw = fs.statSync(extraFile).size;
    const gzip = zlib.gzipSync(fs.readFileSync(extraFile), { level: 9 }).length;
    const res = {
      at: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, cpus: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), platform: `${os.platform()} ${os.release()}`,
      file: { raw, gzip, products: store.products.length },
      readParseMs: { median: +median(runs.map((r) => r.readParse)).toFixed(1), all: runs.map((r) => +r.readParse.toFixed(1)) },
      buildExtraIndexMs: { median: +median(runs.map((r) => r.build)).toFixed(1), all: runs.map((r) => +r.build.toFixed(1)) },
      searchExtraMsPerImage: { median: +median(per).toFixed(2), max: +Math.max(...per).toFixed(2), n: per.length },
    };
    fs.writeFileSync(path.join(outDir, "tu-dong-c1-thoi-gian.json"), JSON.stringify(res, null, 1), "utf8");
    console.log(JSON.stringify(res, null, 1));
    process.exit(0);
  }

  const store = JSON.parse(fs.readFileSync(extraFile, "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);
  const codes = new Set(products.map((p) => p.code));
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), codes, osx.strangeWords, idf);
  const cases = buildCases(app, setNames);
  for (const f of foreign) cases.push({ set: "ngoai", code: f.code, kind: "ngoai (ca dựng)", found: fr.rankFromItems(t1, rIndex, saltItems(f.lines, 0.95)) });

  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });
  for (const c of cases) {
    c.qNow = c.found ? osx.cleanQuery(c.found.lines, { idf }) : [];
    c.qV5 = c.found ? osx.cleanQuery(c.found.lines, { idf, strange: null }) : [];
    const a = await runOff(off, c.qNow);
    const b = await runOff(off, c.qV5);
    c.offNow = a.ok && a.hits.length ? { ok: true, hits: a.hits } : null;
    c.offV5 = b.ok && b.hits.length ? { ok: true, hits: b.hits } : null;
    c.allOk = a.per.every((p) => p.ok);
    c.per = a.per;
    c.ex = c.found ? fx.searchExtra(rIndex.index, xi, c.found) : [];
  }
  const extraCodes = new Set(store.products.map((p) => p.code));
  const runCol = (c, col, cond) => {
    if (!c.found) return [];
    if (col === "cuoi+kho") return fm.mergeFront(t1, rIndex, products, c.found, fx.joinExtra(cond === "i" ? null : c.offNow, c.ex));
    if (col === "cuoi") return fm.mergeFront(t1, rIndex, products, c.found, cond === "i" ? null : c.offNow);
    return fm.mergeFront(t1, rIndex, products, c.found, cond === "i" ? null : c.offV5, MOC_V5);
  };
  const srcOf = (x) => (x.source === "catalog" ? "catalog" : extraCodes.has(x.code) ? "extra" : "off");
  const COLS = ["cuoi+kho", "cuoi", "moc-v5"];
  const res = {};
  for (const c of cases) {
    res[`${c.set}|${c.code ?? c.kind}|${c.kind}`] = Object.fromEntries(["i", "ii"].map((cond) => [cond, Object.fromEntries(COLS.map((col) => {
      const list = runCol(c, col, cond);
      return [col, { codes: list.map((x) => x.code), src: list.map(srcOf) }];
    }))]));
  }
  const table = {};
  for (const s of setNames) for (const cond of ["i", "ii"]) {
    const rs = cases.filter((c) => c.set === s);
    const rk = (c, col) => rank5(res[`${c.set}|${c.code}|${c.kind}`][cond][col].codes, c.code);
    const row = (col) => ({ top1: rs.filter((c) => rk(c, col) === 1).length, top5: rs.filter((c) => rk(c, col) != null).length });
    table[`${s}-${cond}`] = {
      "cuoi+kho": row("cuoi+kho"), cuoi: row("cuoi"), "moc-v5": row("moc-v5"),
      vsA: lossOf(rs.map((c) => ({ code: c.code, base: rk(c, "cuoi"), got: rk(c, "cuoi+kho") }))),
      vsB: lossOf(rs.map((c) => ({ code: c.code, base: rk(c, "moc-v5"), got: rk(c, "cuoi+kho") }))),
      gained: rs.filter((c) => rk(c, "cuoi") == null && rk(c, "cuoi+kho") != null).map((c) => c.code),
    };
  }
  const verdict = judgeC1(table, setNames);
  const s7 = {};
  const salt = {};
  const ngoai = {};
  for (const c of cases) {
    const r = res[`${c.set}|${c.code ?? c.kind}|${c.kind}`];
    for (const cond of ["i", "ii"]) for (const col of COLS) {
      if (c.set === "7up") (s7[`${c.kind.includes("gõ") ? "go" : "may"}-${cond}`] ||= {})[col] = { diet: rank5(r[cond][col].codes, CODE_7UP), lemon: rank5(r[cond][col].codes, LEMON_7UP), plain: rank5(r[cond][col].codes, PLAIN_7UP) };
      if (c.set === "muoi") salt[`${cond}-${col}`] = r[cond][col].codes.map((x, k) => `${x}(${r[cond][col].src[k]})`);
      if (c.set === "ngoai") (ngoai[c.code] ||= {})[`${cond}-${col}`] = rank5(r[cond][col].codes, c.code);
    }
  }
  const coverage = Object.fromEntries([...setNames, "7up", "muoi", "ngoai"].map((s) => {
    const rs = cases.filter((c) => c.set === s);
    return [s, { n: rs.length, du: rs.filter((c) => c.allOk).length }];
  }));
  const conclusion = verdict.ok ? "C1 đủ điều kiện nối vào app ở vòng 7" : "KHÔNG nối, cần chủ dự án quyết";
  const out = { at: new Date().toISOString(), cacheOnly: true, guard: { ...fm.DEFAULT_GUARD }, strangeMode: osx.STRANGE_MODE, extra: { n: store.products.length }, coverage, table, verdict, conclusion, s7, salt, ngoai, foreign, cacheStats: disk.stats, res };
  const outFile = path.join(outDir, `tu-dong-c1-do-${setNames.join("")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  console.log(`Lớp chặn cuối: ${JSON.stringify(out.guard)}, STRANGE_MODE ${JSON.stringify(out.strangeMode)}; kho phụ ${store.products.length} sp`);
  console.log(`Độ phủ (ảnh đủ câu): ${Object.entries(coverage).map(([s, v]) => `${s} ${v.du}/${v.n}`).join(" | ")}`);
  for (const [k, v] of Object.entries(table)) {
    console.log(`  ${k}: cuoi+kho ${v["cuoi+kho"].top1}/${v["cuoi+kho"].top5} | cuoi ${v.cuoi.top1}/${v.cuoi.top5} | moc-v5 ${v["moc-v5"].top1}/${v["moc-v5"].top5} | so (a): mất v1 [${v.vsA.lostTop1}] rơi [${v.vsA.out5}] | so (b): mất v1 [${v.vsB.lostTop1}] rơi [${v.vsB.out5}] | thêm vào 5 [${v.gained}]`);
  }
  for (const [k, v] of Object.entries(s7)) console.log(`  7Up ${k}: ${COLS.map((col) => `${col} ${v[col].diet ?? "-"}/${v[col].lemon ?? "-"}/${v[col].plain ?? "-"}`).join(" | ")}`);
  for (const [k, v] of Object.entries(salt)) console.log(`  muối ${k}: ${v.join(", ")}`);
  for (const [code, v] of Object.entries(ngoai)) console.log(`  ngoại ${code}: ${Object.entries(v).map(([k, x]) => `${k} ${x ?? "-"}`).join(" | ")}`);
  console.log(`== Phán: ${JSON.stringify(verdict)} → ${conclusion}`);
  console.log(`cache: ${JSON.stringify(disk.stats)}`);
  console.log(`Ghi: ${outFile}`);
}
