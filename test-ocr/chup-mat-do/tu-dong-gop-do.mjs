// Đợt tu-dong (vòng 2, P4): đo GỘP xếp hạng T1 + Open Food Facts (src/front-merge.js), CHỈ đọc cache OFF đĩa
// (ghi bởi tu-dong-do.mjs), không gọi mạng.
//
//   node test-ocr/chup-mat-do/tu-dong-gop-do.mjs [--sets B,A] [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua]
//
// Cột (vị trí 1–5 của mã đúng, "-" = ngoài 5):
//   moc   T1 TRƯỚC đợt tu-dong (chỉ mục không bí danh, câu tìm không từ vựng) = mốc vòng 1;
//   p2    T1 sau luật tách chữ P2 (src/front-rank.js hiện tại) = mốc so sánh cho luật "không làm hại";
//   f1, f1-gap1, f1-gap2, f1-m2 (ứng viên OFF khớp ≥ 2 từ), f2 (RRF k = 60), f3 (T1 trước, OFF lấp chỗ trống).
// Luật giữ: bộ B không ảnh nào mất vị trí 1 / rơi khỏi 5 so với p2 (bộ A báo số).
// Bỏ-một-ra (bộ B): bỏ sản phẩm đúng khỏi danh mục (dựng lại chỉ mục T1 không có nó), câu OFF giữ như bản đủ danh mục
// (dùng chung cache, không tốn lượt), chạy từng cách → bao nhiêu ảnh sản phẩm đúng vẫn ở vị trí 1 / trong 5 nhờ OFF.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadApp, buildCases, makeDiskFetch, runOff, rank5, SETS, ROOT, LINES_7UP, TYPED_7UP } from "./tu-dong-do.mjs";
import { SALT_LINES, saltItems } from "./nang-t1-do.mjs";

export const METHODS = {
  f1: { method: "f1" },
  "f1-gap1": { method: "f1", offGap: 1 },
  "f1-gap2": { method: "f1", offGap: 2 },
  "f1-m2": { method: "f1", minMatch: 2 },
  f2: { method: "f2" },
  f3: { method: "f3" },
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const setNames = arg("--sets", "B,A").split(",").filter(Boolean);
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const fm = await import(pathToFileURL(path.join(ROOT, "src", "front-merge.js")).href);
  const products = catalog.products;
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = app.os.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });
  // mốc trước đợt: chỉ mục không bí danh, câu tìm không từ vựng
  const mocIndex = t1.buildBm25(products, { alias: false });

  const cases = buildCases(app, setNames);
  const rows = [];
  for (const c of cases) {
    const o = await runOff(off, c.queries);
    const offRes = { ok: o.ok && o.hits.length > 0, hits: o.hits };
    const row = { set: c.set, code: c.code, kind: c.kind, queries: c.queries, offPer: o.per, offCount: o.hits.length,
      offPos: c.code ? (o.hits.findIndex((h) => h.code === c.code) + 1 || null) : null, ranks: {}, top5: {} };
    const p2Codes = c.found ? c.found.hits.map((h) => h.code) : [];
    row.top5.p2 = p2Codes;
    row.ranks.p2 = c.code ? rank5(p2Codes, c.code) : null;
    for (const [name, opts] of Object.entries(METHODS)) {
      const got = c.found ? fm.mergeFront(t1, rIndex, products, c.found, offRes, opts) : [];
      row.top5[name] = got.map((x) => `${x.code}${x.source === "off" ? "*" : ""}`);
      row.ranks[name] = c.code ? rank5(got.map((x) => x.code), c.code) : null;
    }
    rows.push(row);
  }

  // cột moc: đường T1 cũ tính lại từ khung chữ gốc (cần độ tin của từng hàng, found.lines chỉ giữ chữ)
  for (const s of setNames) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const row of rows.filter((r) => r.set === s)) {
      const items = bundle.items?.[row.code]?.items;
      const lines = items ? t1.rowLineInfo(t1.ocrItems([{ items }])) : [];
      const q = t1.t1QueryFromLines(lines);
      const codes = q.length ? t1.bm25Search(mocIndex, q, 5).map((h) => h.code) : [];
      row.top5.moc = codes;
      row.ranks.moc = rank5(codes, row.code);
    }
  }
  for (const row of rows.filter((r) => r.set === "7up" || r.set === "muoi")) {
    const c = cases.find((x) => x.kind === row.kind);
    const lines = c.kind.includes("gõ") ? [{ text: TYPED_7UP, conf: null }]
      : t1.rowLineInfo(t1.ocrItems([{ items: c.set === "muoi" ? saltItems(SALT_LINES, 0.9) : saltItems(LINES_7UP, 0.95) }]));
    const q = t1.t1QueryFromLines(lines);
    const codes = q.length ? t1.bm25Search(mocIndex, q, 5).map((h) => h.code) : [];
    row.top5.moc = codes;
    row.ranks.moc = row.code ? rank5(codes, row.code) : null;
  }

  const cols = ["moc", "p2", ...Object.keys(METHODS)];
  const tally = (rs, col) => ({ top1: rs.filter((r) => r.ranks[col] === 1).length, top5: rs.filter((r) => r.ranks[col] != null).length });
  const bySet = {};
  for (const s of setNames) {
    const rs = rows.filter((r) => r.set === s);
    bySet[s] = {};
    for (const col of cols) {
      const lost = rs.filter((r) => (r.ranks.p2 === 1 && r.ranks[col] !== 1) || (r.ranks.p2 != null && r.ranks[col] == null)).map((r) => r.code);
      const changed = rs.filter((r) => r.ranks.p2 !== r.ranks[col]).map((r) => `${r.code}: ${r.ranks.p2 ?? "-"}→${r.ranks[col] ?? "-"}`);
      bySet[s][col] = { ...tally(rs, col), lostVsP2: lost, changedVsP2: changed };
    }
  }

  // bỏ-một-ra (bộ B)
  const loo = {};
  if (setNames.includes("B")) {
    const bRows = rows.filter((r) => r.set === "B");
    const bundle = JSON.parse(fs.readFileSync(SETS.B.file, "utf8"));
    const per = [];
    for (const row of bRows) {
      const c = cases.find((x) => x.set === "B" && x.code === row.code);
      if (!c?.found) continue;
      const keep = products.filter((p) => p.code !== row.code);
      if (keep.length === products.length) { per.push({ code: row.code, note: "không có trong danh mục" }); continue; }
      const rI = fr.buildRankIndex(t1, keep);
      const found = fr.rankFromItems(t1, rI, bundle.items[row.code].items);
      const o = await runOff(off, c.queries);
      const offRes = { ok: o.ok && o.hits.length > 0, hits: o.hits };
      const r = { code: row.code, offPos: o.hits.findIndex((h) => h.code === row.code) + 1 || null, ranks: {} };
      r.ranks.t1 = rank5(found.hits.map((h) => h.code), row.code);
      for (const [name, opts] of Object.entries(METHODS)) {
        const got = fm.mergeFront(t1, rI, keep, found, offRes, opts);
        r.ranks[name] = rank5(got.map((x) => x.code), row.code);
      }
      per.push(r);
    }
    const ok = per.filter((r) => r.ranks);
    loo.n = ok.length;
    loo.offHasCode = ok.filter((r) => r.offPos != null).length;
    loo.offHasCodeIn24 = ok.filter((r) => r.offPos != null).map((r) => `${r.code}@${r.offPos}`);
    loo.tally = Object.fromEntries(["t1", ...Object.keys(METHODS)].map((col) => [col, { top1: ok.filter((r) => r.ranks[col] === 1).length, top5: ok.filter((r) => r.ranks[col] != null).length }]));
    loo.rows = per;
  }

  const special = rows.filter((r) => r.set === "7up" || r.set === "muoi").map((r) => ({ kind: r.kind, queries: r.queries, offPer: r.offPer, offPos: r.offPos, ranks: r.ranks, top5: r.top5 }));
  const out = { at: new Date().toISOString(), cacheOnly: true, cacheStats: disk.stats, bySet, special, loo, rows };
  const outFile = path.join(outDir, `tu-dong-gop-do-${setNames.join("")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");

  // in bảng
  for (const s of setNames) {
    console.log(`== Bộ ${s}: vị trí 1 / trong 5`);
    for (const col of cols) {
      const b = bySet[s][col];
      console.log(`  ${col.padEnd(8)} ${b.top1}/${b.top5}  mất so p2: ${b.lostVsP2.join(",") || "0"}  đổi: ${b.changedVsP2.join("; ") || "0"}`);
    }
    console.log(`  từng ảnh (${cols.join(" / ")}):`);
    for (const r of rows.filter((x) => x.set === s)) console.log(`   ${r.code} ${cols.map((c) => r.ranks[c] ?? "-").join(" / ")}  offPos=${r.offPos ?? "-"} câu=${JSON.stringify(r.queries)}`);
  }
  for (const sp of special) console.log(`== ${sp.kind}: ${cols.map((c) => `${c}=${sp.ranks[c] ?? "-"}`).join(" ")} offPos=${sp.offPos ?? "-"}\n   top5: ${cols.map((c) => `${c}:${(sp.top5[c] || []).join(",")}`).join(" | ")}`);
  if (loo.n != null) console.log(`== Bỏ-một-ra bộ B (n=${loo.n}, OFF có mã đúng: ${loo.offHasCode} ${JSON.stringify(loo.offHasCodeIn24)}): ${Object.entries(loo.tally).map(([k, v]) => `${k} ${v.top1}/${v.top5}`).join(" | ")}`);
  console.log(`cache: ${JSON.stringify(disk.stats)}`);
  console.log(`Ghi: ${outFile}`);
}
