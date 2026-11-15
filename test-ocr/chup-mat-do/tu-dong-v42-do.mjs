// Đợt tu-dong vòng 6: đo P1 (V4-2, offPromote của src/front-merge.js) và P2 (hàng ngoại tên lạ, từ lạ X1 / X2 của
// src/off-search.js) cho "Chụp mặt trước". Chế độ đo CHỈ đọc cache OFF đĩa (ghi bởi tu-dong-do.mjs hoặc --goi-off).
//
//   node test-ocr/chup-mat-do/tu-dong-v42-do.mjs [--sets B,A] [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua]
//   node test-ocr/chup-mat-do/tu-dong-v42-do.mjs --chon-ca           (in 6 ca hàng ngoại dựng, không gọi mạng)
//   node test-ocr/chup-mat-do/tu-dong-v42-do.mjs --cau-thieu         (đếm câu thiếu cache theo nhóm, không gọi mạng)
//   node test-ocr/chup-mat-do/tu-dong-v42-do.mjs --goi-off --vong 6 [--max-calls 150]   (gọi OFF thật cho câu thiếu)
// --goi-off: chỉ câu chưa có cache, theo thứ tự ưu tiên: bộ B → 7Up + muối → bộ A → câu P2 (X1 / X2) → ca hàng ngoại;
// giãn ≥ 8 giây, trần lượt vòng ở D:\tmp\tu-dong\off-luot.json, cầu dao ngừng hẳn đợt khi 3 lỗi liền (stopOnTrip),
// cộng api_usage.json (makeDiskFetch của tu-dong-do.mjs, qua trang Chromium (Edge) 127.0.0.1).
//
// ===================================================================================================================
// LUẬT GIỮ — CHỐT TRƯỚC KHI CHẠY ĐO (commit riêng trước khi có kết quả; không đổi sau khi thấy số)
// ===================================================================================================================
// Mốc so sánh: DEFAULT_GUARD hiện tại (lockTop 3, offMax 1, offGap 1, offTopRule null, offPromote null), cùng dữ liệu.
// Điều kiện: (i) OFF lỗi (off = null); (ii) OFF thật từ cache (câu cleanQuery mặc định của app; câu thiếu cache = câu
// lỗi); (iii) OFF giả xấu nhất (worstOff của tu-dong-chan-do.mjs) — CHỈ BÁO, không là cổng.
// "Mất vị trí 1" = mốc vị trí 1, cách đo không vị trí 1; "rơi khỏi 5" = mốc trong 5, cách đo ngoài 5.
// "Ảnh đủ câu" (độ phủ) = mọi câu tìm OFF của ảnh có cache 200; ảnh không có câu tìm nào tính là đủ (app không gọi OFF).
//
// P1 (V4-2). Lưới: offPromote { gap ∈ {1, 2, 3} × minWords ∈ {2, 3} } trên DEFAULT_GUARD (6 cách, KHÔNG kho phụ),
//   cộng cách tham chiếu "ref-L0-M1-top" (vòng 3: lockTop 0, offMax 1, offGap 0, offTopRule { gap 1, minWords 2 }) — chỉ
//   để so, KHÔNG được chọn.
//   Một cách được GIỮ khi:
//   (1) ở (ii) CẢ bộ B và bộ A: 0 ảnh mất vị trí 1 và 0 ảnh rơi khỏi 5 so với mốc;
//   (2) ở (i): kết quả (5 mã, đúng thứ tự) GIỐNG HỆT mốc ở mọi ca (B, A, 7Up 2 kiểu, muối);
//   (3) độ phủ (ii) bộ B ≥ 24/30 ảnh đủ câu; thiếu → mọi cách "không giữ: thiếu dữ liệu";
//   (4) ca muối: không khẳng định — app luôn hiện khung "có thể nhầm" (CONFIDENCE_RULE = luôn không chắc, không đổi);
//       ghi top 5 kèm nguồn.
//   Trong các cách qua: chọn cách đưa 8934588752117 cao nhất ở ca chữ máy chủ (ii), rồi ca câu gõ (ii), rồi ít ảnh bộ
//   B mất vị trí 1 nhất ở (iii), rồi gap lớn hơn, rồi minWords lớn hơn. Không cách nào qua → giữ offPromote null.
//   Một cách qua bộ B nhưng trượt bộ A: ghi rõ, vẫn KHÔNG giữ.
//
// P2 (hàng ngoại tên lạ). Lớp chặn = cách P1 chọn (không cách nào → DEFAULT_GUARD). Biến thể: X1 (từ lạ thêm vào câu 1),
//   X2 (từ lạ thành câu riêng thay câu 2); cả hai bật strangeFill của mergeFront. Mốc = cùng lớp chặn, từ lạ tắt.
//   Ca hàng ngoại dựng (chọn CHỐT TRƯỚC bằng foreignCases, ca DỰNG nên lạc quan hơn ảnh thật): bản ghi của
//   D:\tmp\nang-t1\du-lieu\mo-rong.json KHÔNG có trong danh mục, có ảnh mặt trước, tên hiển thị (catalogProduct.name)
//   có ≥ 1 từ lạ (strangeWords với từ vựng = chỉ mục T1 của danh mục); sắp theo mã tăng dần, lấy 6 đầu tiên. Chữ OCR
//   dựng = [tên, hãng] (dòng trống bỏ), như ca 7Up dựng (saltItems, độ tin 0,95).
//   Một biến thể được GIỮ khi: ở CẢ bộ B và bộ A, CẢ (i) và (ii): 0 ảnh mất vị trí 1, 0 ảnh rơi khỏi 5 so với mốc; ca
//   7Up không tụt (vị trí 8934588752117 / 8934588022111 / 8934588023064 ở 2 ca 7Up, (i) và (ii), không kém mốc; ngoài 5
//   tính là 6); ca muối không khẳng định (như P1 (4)).
//   Trong các biến thể qua: nhiều ca hàng ngoại có mã đúng trong 5 nhất ((ii)), rồi ở vị trí 1, hòa thì X1. Không biến
//   thể nào qua → giữ tắt (STRANGE_MODE null).
// ===================================================================================================================
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadApp, buildCases, makeDiskFetch, runOff, rank5, ROOT, CODE_7UP, browserNet, roundKeyFromArgv } from "./tu-dong-do.mjs";
import { worstOff } from "./tu-dong-chan-do.mjs";
import { catalogProduct } from "./nang-t1-danh-muc.mjs";
import { saltItems } from "./nang-t1-do.mjs";

export const LEMON_7UP = "8934588022111";
export const PLAIN_7UP = "8934588023064";
export const FOREIGN_N = 6;
export const COVERAGE_MIN_B = 24;
export const MO_RONG = "D:\\tmp\\nang-t1\\du-lieu\\mo-rong.json";

/** Lưới P1: tên → opts mergeFront (trên DEFAULT_GUARD). */
export function p1Grid(DEFAULT_GUARD) {
  const g = { "mac-dinh": { ...DEFAULT_GUARD } };
  for (const gap of [1, 2, 3]) for (const minWords of [2, 3]) g[`p-g${gap}-w${minWords}`] = { ...DEFAULT_GUARD, offPromote: { gap, minWords } };
  g["ref-L0-M1-top"] = { method: "f1", lockTop: 0, offMax: 1, offGap: 0, offTopRule: { gap: 1, minWords: 2 }, offPromote: null };
  return g;
}

/** 6 ca hàng ngoại dựng (luật ở đầu file). records: mo-rong.json; catalogCodes: Set mã danh mục; idf: chỉ mục T1. */
export function foreignCases(records, catalogCodes, strangeWords, idf, n = FOREIGN_N) {
  const seen = new Set();
  const out = [];
  const sorted = [...(records || [])].filter((r) => r && typeof r.code === "string").sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const r of sorted) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    if (catalogCodes.has(r.code)) continue;
    const p = catalogProduct(r);
    if (!p.img || !p.name) continue;
    const sw = strangeWords([p.name], { idf });
    if (!sw.length) continue;
    out.push({ code: p.code, name: p.name, brand: p.brand, strange: sw, lines: [p.name, p.brand].map((s) => String(s || "").trim()).filter(Boolean) });
    if (out.length >= n) break;
  }
  return out;
}

/** Mất vị trí 1 / rơi khỏi 5 (dòng { code, base, got }). */
export function lossOf(rows) {
  return {
    lostTop1: rows.filter((r) => r.base === 1 && r.got !== 1).map((r) => r.code),
    out5: rows.filter((r) => r.base != null && r.got == null).map((r) => r.code),
  };
}

/** Vị trí so sánh (null = ngoài 5 → 6). */
export const pos6 = (x) => (x == null ? 6 : x);

/** Luật chọn P1 (luật ở đầu file). judge: [{ name, pass, may, go, fakeLostB, gap, minWords }] → tên hoặc null. */
export function pickP1(judge) {
  const ok = judge.filter((j) => j.pass);
  ok.sort((a, b) => pos6(a.may) - pos6(b.may) || pos6(a.go) - pos6(b.go) || a.fakeLostB - b.fakeLostB || b.gap - a.gap || b.minWords - a.minWords);
  return ok[0]?.name ?? null;
}

/** Luật chọn P2: [{ name: "x1" | "x2", pass, in5, top1 }] → tên hoặc null. */
export function pickP2(judge) {
  const ok = judge.filter((j) => j.pass);
  ok.sort((a, b) => b.in5 - a.in5 || b.top1 - a.top1 || (a.name === "x1" ? -1 : 1) - (b.name === "x1" ? -1 : 1));
  return ok[0]?.name ?? null;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const setNames = arg("--sets", "B,A").split(",").filter(Boolean);
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  fs.mkdirSync(outDir, { recursive: true });
  const app = await loadApp();
  const { t1, fr, catalog, rIndex, os } = app;
  const fm = await import(pathToFileURL(path.join(ROOT, "src", "front-merge.js")).href);
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const codes = new Set(products.map((p) => p.code));
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), codes, os.strangeWords, idf);
  if (argv.includes("--chon-ca")) {
    for (const f of foreign) console.log(`${f.code} | ${f.name} | ${f.brand} | từ lạ: ${f.strange.join(", ")}`);
    process.exit(0);
  }

  // ca: 7Up, muối, B, A (buildCases) + hàng ngoại dựng; câu tìm theo 3 chế độ từ lạ
  const cases = buildCases(app, setNames);
  for (const f of foreign) cases.push({ set: "ngoai", code: f.code, kind: "ngoai (ca dựng)", found: fr.rankFromItems(t1, rIndex, saltItems(f.lines, 0.95)), foreign: f });
  for (const c of cases) {
    c.q = { base: c.found ? os.cleanQuery(c.found.lines, { idf }) : [] };
    for (const m of ["x1", "x2"]) c.q[m] = c.found ? os.cleanQuery(c.found.lines, { idf, strange: m }) : [];
  }

  const cacheHas = (q) => {
    const url = os.searchUrl(q, { pageSize: os.SEARCH_PAGE_SIZE });
    const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
    return disk.fetch(url).then(() => true, () => false);
  };
  // thứ tự ưu tiên gọi OFF: B → 7Up + muối → A → P2 (X1 / X2 của B, 7Up, muối, A) → ca hàng ngoại (cả 3 chế độ)
  const groups = [
    ["B", cases.filter((c) => c.set === "B").flatMap((c) => c.q.base)],
    ["7up+muoi", cases.filter((c) => c.set === "7up" || c.set === "muoi").flatMap((c) => c.q.base)],
    ["A", cases.filter((c) => c.set === "A").flatMap((c) => c.q.base)],
    ["P2", ["B", "7up", "muoi", "A"].flatMap((s) => cases.filter((c) => c.set === s).flatMap((c) => [...c.q.x1, ...c.q.x2]))],
    ["ngoai", cases.filter((c) => c.set === "ngoai").flatMap((c) => [...c.q.base, ...c.q.x1, ...c.q.x2])],
  ];
  if (argv.includes("--cau-thieu") || argv.includes("--goi-off")) {
    const seen = new Set();
    const todo = [];
    const tally = {};
    for (const [g, qs] of groups) {
      tally[g] = { cau: 0, thieu: 0 };
      for (const q of qs) {
        const key = q.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        tally[g].cau++;
        if (!(await cacheHas(key))) { tally[g].thieu++; todo.push({ g, q: key }); }
      }
    }
    console.log(`Câu khác nhau / thiếu cache theo nhóm (nhóm trước giữ câu trùng): ${JSON.stringify(tally)}; tổng thiếu ${todo.length}`);
    if (argv.includes("--goi-off")) {
      const roundKey = roundKeyFromArgv(argv);
      let net = null;
      const disk = makeDiskFetch({ cacheDir, chiCache: false, cap: Number(arg("--max-calls", "150")), roundKey, stopOnTrip: true,
        netFetch: async (url) => { net ||= await browserNet(); return net.fetch(url); } });
      const off = os.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });
      const startedAt = new Date().toISOString();
      const log = [];
      for (const t of todo) {
        if (disk.stats.breakerOpen) break;
        const r = await off.search(t.q);
        log.push({ ...t, ok: r.ok, kind: r.ok ? null : r.kind, n: r.ok ? r.hits.length : null });
        console.log(`[${t.g}] "${t.q}" ${r.ok ? r.hits.length : "LỖI " + r.kind}`);
      }
      await net?.close();
      const res = { startedAt, endedAt: new Date().toISOString(), roundKey, stats: disk.stats, errorRate: disk.stats.calls ? +(disk.stats.failures / disk.stats.calls).toFixed(3) : null, log };
      const f = path.join(outDir, `tu-dong-v42-goi-off-${startedAt.replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(f, JSON.stringify(res, null, 1), "utf8");
      console.log(JSON.stringify({ ...res, log: undefined }, null, 1));
      console.log(`Ghi: ${f}`);
    }
    process.exit(0);
  }

  // ---- đo (chỉ cache) ----
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = os.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });
  for (const c of cases) {
    c.off = {};
    for (const m of ["base", "x1", "x2"]) {
      const o = await runOff(off, c.q[m]);
      c.off[m] = { res: o.ok && o.hits.length ? { ok: true, hits: o.hits } : null, per: o.per, allOk: o.per.every((p) => p.ok) };
    }
  }
  const covOf = (set, m = "base") => {
    const rs = cases.filter((c) => c.set === set);
    return { n: rs.length, du: rs.filter((c) => c.off[m].allOk).length, coCau: rs.filter((c) => c.q[m].length).length };
  };
  const cov = Object.fromEntries([...setNames, "7up", "muoi", "ngoai"].map((s) => [s, { base: covOf(s), x1: covOf(s, "x1"), x2: covOf(s, "x2") }]));
  const covOk = (cov.B?.base.du ?? 0) >= COVERAGE_MIN_B;

  const run = (c, opts, cond, mode = "base") => {
    if (!c.found) return [];
    const o = cond === "i" ? null : cond === "ii" ? c.off[mode].res : worstOff(c.found, products);
    return fm.mergeFront(t1, rIndex, products, c.found, o, opts);
  };
  const ranksOf = (list) => list.map((x) => x.code);
  const s7rank = (codes5) => ({ diet: rank5(codes5, CODE_7UP), lemon: rank5(codes5, LEMON_7UP), plain: rank5(codes5, PLAIN_7UP) });

  // ---------- P1 ----------
  const grid = p1Grid(fm.DEFAULT_GUARD);
  const p1 = {};
  for (const [name, opts] of Object.entries(grid)) {
    const t = { sets: {}, s7: {}, salt: {}, sameI: true, diffI: [] };
    for (const cond of ["i", "ii", "iii"]) {
      for (const s of setNames) {
        const rows = cases.filter((c) => c.set === s).map((c) => ({ code: c.code, base: rank5(ranksOf(run(c, grid["mac-dinh"], cond)), c.code), got: rank5(ranksOf(run(c, opts, cond)), c.code) }));
        t.sets[`${s}-${cond}`] = { top1: rows.filter((r) => r.got === 1).length, top5: rows.filter((r) => r.got != null).length, ...lossOf(rows),
          changed: rows.filter((r) => r.base !== r.got).map((r) => `${r.code}: ${r.base ?? "-"}→${r.got ?? "-"}`) };
      }
      if (cond !== "iii") {
        for (const c of cases.filter((x) => x.set === "7up")) t.s7[`${c.kind.includes("gõ") ? "go" : "may"}-${cond}`] = s7rank(ranksOf(run(c, opts, cond)));
        const salt = cases.find((x) => x.set === "muoi");
        if (salt) t.salt[cond] = run(salt, opts, cond).map((x) => `${x.code}(${x.source}) ${x.name}`);
      }
    }
    for (const c of cases.filter((x) => x.set !== "ngoai")) {
      const a = ranksOf(run(c, opts, "i")).join(",");
      const b = ranksOf(run(c, grid["mac-dinh"], "i")).join(",");
      if (a !== b) { t.sameI = false; t.diffI.push(`${c.set} ${c.code ?? c.kind}`); }
    }
    p1[name] = t;
  }
  const judge = Object.entries(grid).filter(([n]) => n.startsWith("p-")).map(([name, o]) => {
    const t = p1[name];
    const iiOk = setNames.every((s) => t.sets[`${s}-ii`].lostTop1.length === 0 && t.sets[`${s}-ii`].out5.length === 0);
    const bOk = t.sets["B-ii"] && t.sets["B-ii"].lostTop1.length === 0 && t.sets["B-ii"].out5.length === 0;
    const pass = covOk && iiOk && t.sameI && setNames.includes("A") && setNames.includes("B");
    return { name, pass, why: !covOk ? "không giữ: thiếu dữ liệu" : !t.sameI ? "(i) khác mốc" : !iiOk ? (bOk ? "qua B, trượt A" : "trượt (ii)") : "qua",
      may: t.s7["may-ii"]?.diet ?? null, go: t.s7["go-ii"]?.diet ?? null, fakeLostB: t.sets["B-iii"]?.lostTop1.length ?? 99, gap: o.offPromote.gap, minWords: o.offPromote.minWords };
  });
  const p1Pick = pickP1(judge);
  const guard = p1Pick ? grid[p1Pick] : grid["mac-dinh"];

  // ---------- P2 ----------
  const p2 = {};
  const p2Judge = [];
  const baseOpts = { ...guard, strangeFill: false };
  for (const m of ["x1", "x2"]) {
    const opts = { ...guard, strangeFill: true };
    const t = { sets: {}, s7: {}, salt: {}, ngoai: {} };
    let pass = true;
    for (const cond of ["i", "ii"]) {
      for (const s of setNames) {
        const rows = cases.filter((c) => c.set === s).map((c) => ({ code: c.code, base: rank5(ranksOf(run(c, baseOpts, cond, "base")), c.code), got: rank5(ranksOf(run(c, opts, cond, m)), c.code) }));
        const r = { top1: rows.filter((x) => x.got === 1).length, top5: rows.filter((x) => x.got != null).length, base: { top1: rows.filter((x) => x.base === 1).length, top5: rows.filter((x) => x.base != null).length }, ...lossOf(rows),
          changed: rows.filter((x) => x.base !== x.got).map((x) => `${x.code}: ${x.base ?? "-"}→${x.got ?? "-"}`) };
        t.sets[`${s}-${cond}`] = r;
        if (r.lostTop1.length || r.out5.length) pass = false;
      }
      for (const c of cases.filter((x) => x.set === "7up")) {
        const key = `${c.kind.includes("gõ") ? "go" : "may"}-${cond}`;
        const b = s7rank(ranksOf(run(c, baseOpts, cond, "base")));
        const g = s7rank(ranksOf(run(c, opts, cond, m)));
        t.s7[key] = { base: b, got: g };
        for (const k of ["diet", "lemon", "plain"]) if (pos6(g[k]) > pos6(b[k])) pass = false;
      }
      const salt = cases.find((x) => x.set === "muoi");
      if (salt) t.salt[cond] = run(salt, opts, cond, m).map((x) => `${x.code}(${x.source}) ${x.name}`);
      for (const c of cases.filter((x) => x.set === "ngoai")) {
        t.ngoai[`${c.code}-${cond}`] = { base: rank5(ranksOf(run(c, baseOpts, cond, "base")), c.code), got: rank5(ranksOf(run(c, opts, cond, m)), c.code), q: c.q[m], qBase: c.q.base };
      }
    }
    const fg = cases.filter((x) => x.set === "ngoai").map((c) => t.ngoai[`${c.code}-ii`].got);
    p2[m] = t;
    p2Judge.push({ name: m, pass, in5: fg.filter((x) => x != null).length, top1: fg.filter((x) => x === 1).length });
  }
  const p2Pick = pickP2(p2Judge);

  const out = { at: new Date().toISOString(), cacheOnly: true, sets: setNames, coverage: cov, covOk, foreign, grid, p1, judge, p1Pick, p2, p2Judge, p2Pick, cacheStats: disk.stats,
    queries: cases.map((c) => ({ set: c.set, code: c.code, kind: c.kind, q: c.q, per: Object.fromEntries(Object.entries(c.off).map(([k, v]) => [k, v.per])) })) };
  const outFile = path.join(outDir, `tu-dong-v42-do-${setNames.join("")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");

  console.log(`Độ phủ (ảnh đủ câu / ảnh / ảnh có câu): ${Object.entries(cov).map(([s, v]) => `${s} base ${v.base.du}/${v.base.n} (${v.base.coCau}) x1 ${v.x1.du}/${v.x1.n} x2 ${v.x2.du}/${v.x2.n}`).join(" | ")}; B ≥ ${COVERAGE_MIN_B}: ${covOk}`);
  console.log("== P1 (vị trí 1 / trong 5; mất v1 / rơi khỏi 5 so mốc)");
  for (const [name, t] of Object.entries(p1)) {
    console.log(`  ${name.padEnd(14)} ${Object.entries(t.sets).map(([k, v]) => `${k} ${v.top1}/${v.top5} (${v.lostTop1.length}${v.lostTop1.length ? ":" + v.lostTop1.join(",") : ""} / ${v.out5.length}${v.out5.length ? ":" + v.out5.join(",") : ""})`).join(" | ")}`);
    console.log(`  ${"".padEnd(14)} 7Up diet/lemon/plain: ${Object.entries(t.s7).map(([k, v]) => `${k} ${v.diet ?? "-"}/${v.lemon ?? "-"}/${v.plain ?? "-"}`).join(" | ")}; (i) giống mốc: ${t.sameI}${t.diffI.length ? " " + t.diffI.join(",") : ""}`);
  }
  console.log(`  judge: ${judge.map((j) => `${j.name} ${j.why} (7Up máy ${j.may ?? "-"}, gõ ${j.go ?? "-"}, (iii) B mất ${j.fakeLostB})`).join("; ")}`);
  console.log(`  P1 chọn: ${p1Pick ?? "KHÔNG cách nào (giữ offPromote null)"}`);
  console.log(`  muối (mặc định): (i) ${p1["mac-dinh"].salt.i.join(" ; ")}\n                   (ii) ${p1["mac-dinh"].salt.ii.join(" ; ")}`);
  console.log(`== P2 trên lớp chặn ${p1Pick ?? "mac-dinh"}`);
  for (const [m, t] of Object.entries(p2)) {
    console.log(`  ${m}: ${Object.entries(t.sets).map(([k, v]) => `${k} ${v.base.top1}/${v.base.top5}→${v.top1}/${v.top5} (${v.lostTop1.length} / ${v.out5.length}${v.out5.length ? ":" + v.out5.join(",") : ""})`).join(" | ")}`);
    console.log(`      7Up: ${Object.entries(t.s7).map(([k, v]) => `${k} ${v.base.diet ?? "-"}/${v.base.lemon ?? "-"}/${v.base.plain ?? "-"}→${v.got.diet ?? "-"}/${v.got.lemon ?? "-"}/${v.got.plain ?? "-"}`).join(" | ")}`);
    console.log(`      ngoại: ${Object.entries(t.ngoai).map(([k, v]) => `${k} ${v.base ?? "-"}→${v.got ?? "-"}`).join(" | ")}`);
    console.log(`      muối (ii): ${t.salt.ii.join(" ; ")}`);
  }
  console.log(`  judge: ${JSON.stringify(p2Judge)}; P2 chọn: ${p2Pick ?? "KHÔNG (giữ tắt)"}`);
  console.log(`cache: ${JSON.stringify(disk.stats)}`);
  console.log(`Ghi: ${outFile}`);
}
