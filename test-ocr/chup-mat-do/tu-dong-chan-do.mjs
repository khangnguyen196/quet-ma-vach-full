// Đợt tu-dong (vòng 3, P3d–e): đo LỚP CHẶN khi gộp T1 + Open Food Facts (src/front-merge.js), CHỈ đọc cache OFF đĩa
// (ghi bởi tu-dong-do.mjs), không gọi mạng.
//
//   node test-ocr/chup-mat-do/tu-dong-chan-do.mjs [--sets B,A] [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua]
//
// Cột (vị trí 1–5 của mã đúng, "-" = ngoài 5): p2 = T1 sau P2 (src/front-rank.js hiện tại, mốc của luật "không làm
// hại"); f1 (không chặn), f1 + lớp chặn (lockTop 0–3 × offMax 1, 2, 3, 5 × luật: không / g1 = offGap 1 / m2 =
// minMatch 2 / top = offTopRule { gap 1, minWords 2 }), f2 / f3 (không chặn, và lockTop 1–2 × offMax 1–3).
// Phép đo:
//   (a) OFF THẬT (cache): bộ B / A vị trí 1 / trong 5, ảnh mất vị trí 1 / rơi khỏi 5 so với p2;
//   (b) OFF GIẢ XẤU NHẤT (không gọi mạng): mỗi ảnh 24 hàng ngoại vn:false, mã giả 13 số (999…) không có trong danh mục,
//       chữ chứa đúng các từ câu tìm T1 của ảnh (mức: đủ từ / đủ từ + hãng gợi ý 1 / thiếu 1 từ + hãng) → số ảnh mất
//       vị trí 1 / rơi khỏi 5 so với p2 (trần rủi ro của từng lớp chặn);
//   (c) 2 ca 7Up (chữ máy chủ + câu gõ, OFF thật): vị trí 8934588752117, 8934588022111, 8934588023064;
//   (d) ca muối: top 5 + nguồn;
//   (e) bỏ-một-ra bộ B KHÔNG rò (tu-dong-do.mjs looCases: chỉ mục + từ vựng T1 không có sản phẩm đúng, câu OFF dựng
//       từ từ vựng mới; câu chưa có cache → "thiếu cache"): số ảnh sản phẩm đúng vào vị trí 1 / trong 5 nhờ OFF.
// Chọn lớp chặn (luật P3e, CHỐT TRƯỚC khi đo): (1) OFF thật: bộ B 0 ảnh mất vị trí 1 / rơi khỏi 5; (2) OFF giả: bộ B
// 0 ảnh mất vị trí 1; (3) 2 ca 7Up: 8934588752117 trong 5; (4) câu gõ 7Up: 022111 và 023064 trong 5; (5) ít ảnh rơi
// khỏi 5 nhất ở OFF giả (bộ B); (6) nhiều ảnh nhất ở bỏ-một-ra (trong 5, rồi vị trí 1). Bằng nhau: an toàn hơn trước
// (lockTop lớn hơn, offMax nhỏ hơn, luật "không" trước g1 trước m2 trước top, f1 trước f2 trước f3). Không cách nào thỏa
// (1)–(3) → KHÔNG chọn, giữ mặc định an toàn nhất { lockTop 1, offMax 2 }.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadApp, buildCases, looCases, makeDiskFetch, runOff, rank5, SETS, ROOT, CODE_7UP } from "./tu-dong-do.mjs";

export const LEMON_7UP = "8934588022111";
export const PLAIN_7UP = "8934588023064";
const NO = { lockTop: 0, offMax: 5, offGap: 0, offTopRule: null };

/** Lưới cách gộp: tên → opts của mergeFront. */
export function methodGrid() {
  const g = { f1: { method: "f1", ...NO } };
  for (const lockTop of [0, 1, 2, 3]) {
    for (const offMax of [1, 2, 3, 5]) {
      for (const rule of ["-", "g1", "m2", "top"]) {
        if (lockTop === 0 && offMax === 5 && rule === "-") continue; // = f1
        const o = { method: "f1", lockTop, offMax, offGap: 0, offTopRule: null };
        if (rule === "g1") o.offGap = 1;
        if (rule === "m2") o.minMatch = 2;
        if (rule === "top") o.offTopRule = { gap: 1, minWords: 2 };
        g[`f1-L${lockTop}-M${offMax}-${rule}`] = o;
      }
    }
  }
  g.f2 = { method: "f2", ...NO };
  g.f3 = { method: "f3", ...NO };
  for (const lockTop of [1, 2]) for (const offMax of [1, 2, 3]) {
    g[`f2-L${lockTop}-M${offMax}`] = { method: "f2", lockTop, offMax };
    g[`f3-L${lockTop}-M${offMax}`] = { method: "f3", lockTop, offMax };
  }
  return g;
}

/** Khóa so "an toàn hơn" khi bằng điểm (nhỏ trước). */
function safetyKey(name, o) {
  const m = { f1: 0, f2: 1, f3: 2 }[o.method] ?? 3;
  const rule = o.offTopRule ? 3 : o.minMatch === 2 ? 2 : o.offGap ? 1 : 0;
  const lock = o.lockTop ?? 0;
  const max = o.offMax ?? 5;
  return [-lock, max, rule, m];
}

/** OFF giả xấu nhất cho một kết quả T1 (xem đầu file). */
export function worstOff(found, products, n = 24) {
  const q = [...new Set(found?.query || [])];
  const brand = products[found?.hits?.[0]?.i]?.brand || "";
  const hits = [];
  for (let j = 0; j < n; j++) {
    const lvl = j % 3;
    const words = lvl === 2 && q.length > 1 ? q.filter((_, x) => x !== (j >> 1) % q.length) : q;
    const text = `${words.join(" ")}${lvl >= 1 && brand ? " " + brand : ""}`;
    hits.push({ code: String(9990000000000 + j), name: words.join(" "), brand: lvl >= 1 ? brand : "", img: "", vn: false, text });
  }
  return { ok: true, hits };
}

function lostVs(rows, base, col) {
  return rows.filter((r) => (r.ranks[base] === 1 && r.ranks[col] !== 1) || (r.ranks[base] != null && r.ranks[col] == null)).map((r) => r.code);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const setNames = arg("--sets", "B,A").split(",").filter(Boolean);
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  fs.mkdirSync(outDir, { recursive: true });
  const app = await loadApp();
  const { t1, catalog, rIndex } = app;
  const fm = await import(pathToFileURL(path.join(ROOT, "src", "front-merge.js")).href);
  const products = catalog.products;
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = app.os.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });
  const grid = methodGrid();
  const names = Object.keys(grid);
  const cols = ["p2", ...names];

  // (a) + (b) + (c) + (d)
  const cases = buildCases(app, setNames);
  const rows = [];
  for (const c of cases) {
    const o = await runOff(off, c.queries);
    const offRes = { ok: o.ok && o.hits.length > 0, hits: o.hits };
    const p2 = c.found ? c.found.hits.map((h) => h.code) : [];
    const row = { set: c.set, code: c.code, kind: c.kind, queries: c.queries, offPer: o.per, offCount: o.hits.length,
      offPos: c.code ? (o.hits.findIndex((h) => h.code === c.code) + 1 || null) : null,
      ranks: { p2: c.code ? rank5(p2, c.code) : null }, top5: { p2 }, fake: { p2: c.code ? rank5(p2, c.code) : null }, src: {} };
    const fake = c.found ? worstOff(c.found, products) : null;
    for (const n of names) {
      const got = c.found ? fm.mergeFront(t1, rIndex, products, c.found, offRes, grid[n]) : [];
      row.top5[n] = got.map((x) => x.code);
      row.src[n] = got.map((x) => (x.source === "off" ? "off" : "dm"));
      row.ranks[n] = c.code ? rank5(row.top5[n], c.code) : null;
      if (c.set === "7up") row.ranks[n] = { diet: rank5(row.top5[n], CODE_7UP), lemon: rank5(row.top5[n], LEMON_7UP), plain: rank5(row.top5[n], PLAIN_7UP) };
      if (fake && c.code && c.set !== "7up") row.fake[n] = rank5(fm.mergeFront(t1, rIndex, products, c.found, fake, grid[n]).map((x) => x.code), c.code);
    }
    if (c.set === "7up") row.ranks.p2 = { diet: rank5(p2, CODE_7UP), lemon: rank5(p2, LEMON_7UP), plain: rank5(p2, PLAIN_7UP) };
    rows.push(row);
  }

  // (e) bỏ-một-ra không rò (bộ B)
  const loo = { n: 0, missingCache: [], notInCatalog: [], rows: [] };
  if (setNames.includes("B")) {
    for (const c of looCases(app, "B")) {
      if (!c.found) { loo.notInCatalog.push(`${c.code}: ${c.note}`); continue; }
      const o = await runOff(off, c.queries);
      const missing = o.per.filter((p) => !p.ok).map((p) => `${p.q} (${p.kind})`);
      const offRes = { ok: o.ok && o.hits.length > 0, hits: o.hits };
      const r = { code: c.code, queries: c.queries, missing, offPos: o.hits.findIndex((h) => h.code === c.code) + 1 || null, ranks: { p2: rank5(c.found.hits.map((h) => h.code), c.code) } };
      for (const n of names) r.ranks[n] = rank5(fm.mergeFront(t1, c.rI, c.keep, c.found, offRes, grid[n]).map((x) => x.code), c.code);
      if (missing.length) loo.missingCache.push(`${c.code}: ${missing.join(", ")}`);
      loo.rows.push(r);
    }
    loo.n = loo.rows.length;
    loo.offHasCode = loo.rows.filter((r) => r.offPos != null).map((r) => `${r.code}@${r.offPos}`);
  }

  // bảng tổng
  const bySet = {};
  for (const s of setNames) {
    const rs = rows.filter((r) => r.set === s);
    bySet[s] = {};
    for (const col of cols) {
      bySet[s][col] = {
        real: { top1: rs.filter((r) => r.ranks[col] === 1).length, top5: rs.filter((r) => r.ranks[col] != null).length, lost: lostVs(rs, "p2", col),
          changed: rs.filter((r) => r.ranks.p2 !== r.ranks[col]).map((r) => `${r.code}: ${r.ranks.p2 ?? "-"}→${r.ranks[col] ?? "-"}`) },
        fake: { top1: rs.filter((r) => r.fake[col] === 1).length, top5: rs.filter((r) => r.fake[col] != null).length,
          lostTop1: rs.filter((r) => r.ranks.p2 === 1 && r.fake[col] !== 1).map((r) => r.code),
          out5: rs.filter((r) => r.ranks.p2 != null && r.fake[col] == null).map((r) => r.code) },
      };
    }
  }
  const s7 = rows.filter((r) => r.set === "7up");
  const salt = rows.find((r) => r.set === "muoi");
  const looTally = Object.fromEntries(cols.map((col) => [col, { top1: loo.rows.filter((r) => r.ranks[col] === 1).length, top5: loo.rows.filter((r) => r.ranks[col] != null).length }]));

  // chọn theo luật P3e
  const judge = names.map((n) => {
    const b = bySet.B?.[n];
    const c1 = b ? b.real.lost.length === 0 : false;
    const c2 = b ? b.fake.lostTop1.length === 0 : false;
    const c3 = s7.every((r) => r.ranks[n].diet != null);
    const typed = s7.find((r) => r.kind.includes("gõ"));
    const c4 = typed ? typed.ranks[n].lemon != null && typed.ranks[n].plain != null : false;
    return { name: n, c1, c2, c3, c4, out5: b ? b.fake.out5.length : 99, looTop5: looTally[n].top5, looTop1: looTally[n].top1, key: safetyKey(n, grid[n]) };
  });
  const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const pass13 = judge.filter((j) => j.c1 && j.c2 && j.c3);
  const ranked = [...pass13].sort((a, b) => (b.c4 - a.c4) || a.out5 - b.out5 || b.looTop5 - a.looTop5 || b.looTop1 - a.looTop1 || cmpKey(a.key, b.key));
  const chosen = ranked[0] || null;

  const out = { at: new Date().toISOString(), cacheOnly: true, cacheStats: disk.stats, grid, bySet, special: { s7, salt }, loo: { ...loo, tally: looTally }, judge, pass13: pass13.map((j) => j.name), chosen, rows };
  const outFile = path.join(outDir, `tu-dong-chan-do-${setNames.join("")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");

  // in
  const show = ["p2", "f1", ...names.filter((n) => /^f1-L[0-3]-M[1235]-/.test(n)), "f2", "f3", ...names.filter((n) => /^f[23]-L/.test(n))];
  for (const s of setNames) {
    console.log(`== Bộ ${s}: OFF thật v1/trong5 (mất so p2) | OFF giả v1/trong5 (mất v1 / rơi khỏi 5)`);
    for (const col of show) {
      const b = bySet[s][col];
      console.log(`  ${col.padEnd(14)} ${b.real.top1}/${b.real.top5} (${b.real.lost.length}) | ${b.fake.top1}/${b.fake.top5} (${b.fake.lostTop1.length} / ${b.fake.out5.length})`);
    }
  }
  for (const r of s7) console.log(`== ${r.kind}: câu ${JSON.stringify(r.queries)} OFF ${JSON.stringify(r.offPer.map((p) => [p.q, p.ok ? p.n : p.kind]))}\n   ${show.map((c) => `${c}=${r.ranks[c] ? `${r.ranks[c].diet ?? "-"}/${r.ranks[c].lemon ?? "-"}/${r.ranks[c].plain ?? "-"}` : "?"}`).join(" ")}`);
  if (salt) console.log(`== muối: câu ${JSON.stringify(salt.queries)} OFF ${JSON.stringify(salt.offPer.map((p) => [p.q, p.ok ? p.n : p.kind]))}\n   p2: ${salt.top5.p2.join(",")}\n   f1: ${salt.top5.f1.map((c, i) => `${c}(${salt.src.f1[i]})`).join(",")}`);
  console.log(`== Bỏ-một-ra B (n=${loo.n}, thiếu cache ${loo.missingCache.length}, OFF có mã đúng: ${JSON.stringify(loo.offHasCode)}): ${show.map((c) => `${c} ${looTally[c].top1}/${looTally[c].top5}`).join(" | ")}`);
  console.log(`== Qua (1)–(3): ${pass13.length} cách. Chọn: ${chosen ? JSON.stringify(chosen) : "KHÔNG (giữ mặc định an toàn nhất)"}`);
  const pick = chosen ? chosen.name : "f1-L1-M2--";
  console.log(`== Top 10 theo luật: ${ranked.slice(0, 10).map((j) => `${j.name} (c4 ${j.c4}, rơi ${j.out5}, loo ${j.looTop1}/${j.looTop5})`).join("; ")}`);
  for (const s of setNames) {
    console.log(`== Từng ảnh bộ ${s} (OFF thật: p2 / f1 / ${pick} / f2 / f3 | OFF giả: f1 / ${pick} | câu OFF: số kết quả)`);
    for (const r of rows.filter((x) => x.set === s)) {
      const v = (o, c) => o[c] ?? "-";
      console.log(`   ${r.code} ${["p2", "f1", pick, "f2", "f3"].map((c) => v(r.ranks, c)).join(" / ")} | ${v(r.fake, "f1")} / ${v(r.fake, pick)} | ${r.offPer.map((p) => `${p.q}: ${p.ok ? p.n : p.kind}`).join("; ") || "(không câu)"}`);
    }
  }
  console.log(`cache: ${JSON.stringify(disk.stats)}`);
  console.log(`Ghi: ${outFile}`);
}
