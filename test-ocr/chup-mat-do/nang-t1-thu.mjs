// Đợt nang-t1 vòng 2: thử các cách xếp hạng của src/front-rank.js theo lưới GRID (nang-t1-do.mjs), luật choosePoint.
// Không thuộc app; chỉ đọc app + chữ OCR đã lưu, ghi kết quả ra D:\tmp\nang-t1\ket-qua\.
//
//   node test-ocr/chup-mat-do/nang-t1-thu.mjs --buoc moc            front-rank mặc định phải trùng mốc từng ảnh (A 13/22, B 14/21)
//   node test-ocr/chup-mat-do/nang-t1-thu.mjs --buoc a|c|b          đo mọi điểm lưới của một cách trên nền, chọn theo luật
//   [--out <thư mục>] [--catalog <file danh mục>]
//
// Vòng 2: (a), (c), (b) đều KHÔNG giữ nên đã gỡ khỏi src/front-rank.js; muốn chạy lại --buoc a|c|b thì dùng
// src/front-rank.js của commit "test(nang-t1): cách (b) — không giữ" (có đủ 3 cách). --buoc moc vẫn chạy được.
// Nền = cấu hình đã giữ trước đó, lưu ở <out>\v2-nen.json ({ opts, kept: [{ cach, diem }] }); chưa có thì nền = mốc (opts {}).
// Mỗi điểm lưới: <out>\v2-<cách>-<điểm>-<A|B>.json; tổng hợp một cách: <out>\v2-<cách>-tong.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measure, frontRankRanker, judge, choosePoint, GRID, METHOD_ORDER, tally } from "./nang-t1-do.mjs";

const SETS = ["A", "B"];

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

/** So từng ảnh với file mốc vòng 1 (rank, query, top5, điểm top1 / top2). Trả danh sách lệch. */
export function diffBaseline(rows, mocRows, eps = 1e-9) {
  const byCode = new Map(mocRows.map((r) => [r.code, r]));
  const out = [];
  for (const r of rows) {
    const m = byCode.get(r.code);
    const close = (x, y) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < eps);
    if (!m || m.rank !== r.rank || m.query !== r.query || JSON.stringify(m.top5) !== JSON.stringify(r.top5)
      || !close(m.top1Score, r.top1Score) || !close(m.top2Score, r.top2Score)) out.push(r.code);
  }
  if (rows.length !== mocRows.length) out.push(`số dòng ${rows.length} ≠ ${mocRows.length}`);
  return out;
}

async function measureBoth(opts, name, catalogFile) {
  const ranker = await frontRankRanker(opts, name);
  const res = {};
  for (const s of SETS) res[s] = await measure({ ranker, set: s, ...(catalogFile ? { catalogFile } : {}) });
  return res;
}

const groupTally = (rows, g) => tally(rows.filter((r) => r.group === g));
const saltLine = (m) => ({ query: m.query, norm: +m.norm.toFixed(4), top5: m.top5.map((h) => `${h.code} ${h.name}|${h.brand} ${h.score}`) });

/** Một dòng bảng cho một điểm (kết quả 2 bộ + judge so với nền + so với mốc). */
export function pointSummary(name, res, vsBase, vsMoc) {
  const sets = {};
  for (const s of SETS) {
    const rows = res[s].rows;
    sets[s] = {
      chinh: groupTally(rows, "chinh"), giuRieng: groupTally(rows, "giu-rieng"), all: tally(rows),
      vsBase: { chinh: vsBase.sets[s].chinh, giuRieng: vsBase.sets[s].giuRieng, realGains: vsBase.sets[s].realGains },
      vsMoc: { chinh: vsMoc.sets[s].chinh, giuRieng: vsMoc.sets[s].giuRieng, realGains: vsMoc.sets[s].realGains },
      salt: { m1: saltLine(res[s].salt.m1), m2: saltLine(res[s].salt.m2) },
    };
  }
  return {
    name,
    vsBase: { chinhOk: vsBase.chinhOk, giuRiengOk: vsBase.giuRiengOk, gainChinh: vsBase.gainChinh },
    vsMoc: { chinhOk: vsMoc.chinhOk, giuRiengOk: vsMoc.giuRiengOk, gainChinh: vsMoc.gainChinh },
    sets,
  };
}

/** Bảng chữ (cho thân commit / báo cáo). */
export function tableText(points) {
  const L = [];
  const n = (x) => x.length;
  L.push("điểm | bộ | chỉnh v1/tr5 | giữ riêng v1/tr5 | lostTop1 droppedTop5 movedDown gain(thật) chỉnh [so nền] | giữ riêng lost/drop/down | chinhOk giuRiengOk gainChinh (nền; mốc)");
  for (const p of points) {
    for (const s of SETS) {
      const x = p.sets[s];
      const c = x.vsBase.chinh;
      const g = x.vsBase.giuRieng;
      L.push(`${p.name} | ${s} | ${x.chinh.top1}/${x.chinh.top5} | ${x.giuRieng.top1}/${x.giuRieng.top5} | ${n(c.lostTop1)} ${n(c.droppedTop5)} ${n(c.movedDown)} ${n(c.gained)}(${n(x.vsBase.realGains)}) | ${n(g.lostTop1)}/${n(g.droppedTop5)}/${n(g.movedDown)}`
        + (s === "A" ? ` | ${p.vsBase.chinhOk} ${p.vsBase.giuRiengOk} ${p.vsBase.gainChinh}; ${p.vsMoc.chinhOk} ${p.vsMoc.giuRiengOk} ${p.vsMoc.gainChinh}` : ""));
    }
  }
  return L.join("\n");
}

function saltText(p) {
  const L = [];
  for (const s of SETS) {
    const m = p.sets[s].salt.m1;
    const same = JSON.stringify(m) === JSON.stringify(p.sets[s].salt.m2);
    L.push(`  muối ${p.name} ${s} (m1${same ? " = m2" : ", m2 khác"}): "${m.query}" chuẩn hóa ${m.norm}`);
    for (const h of m.top5) L.push(`    ${h}`);
  }
  return L.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const step = arg("buoc", "moc");
  const outDir = arg("out", "D:\\tmp\\nang-t1\\ket-qua");
  const catalogFile = arg("catalog", null);
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, obj) => fs.writeFileSync(path.join(outDir, name), JSON.stringify({ at: new Date().toISOString(), ...obj }, null, 1), "utf8");

  const moc = await measureBoth({}, "front-rank mặc định", catalogFile);
  if (step === "moc") {
    let bad = 0;
    for (const s of SETS) {
      const old = JSON.parse(fs.readFileSync(path.join(outDir, `moc-${s}.json`), "utf8"));
      const diff = diffBaseline(moc[s].rows, old.rows);
      const t = moc[s].summary;
      console.log(`Bộ ${s}: front-rank mặc định ${t.all.top1}/${t.all.top5} (chỉnh ${t.chinh.top1}/${t.chinh.top5}, giữ riêng ${t.giuRieng.top1}/${t.giuRieng.top5}); lệch mốc vòng 1 từng ảnh: ${diff.length ? diff.join(", ") : "không"}`);
      bad += diff.length;
      write(`v2-moc-${s}.json`, moc[s]);
    }
    if (bad) process.exitCode = 1;
  } else if (METHOD_ORDER.includes(step)) {
    const nenFile = path.join(outDir, "v2-nen.json");
    const nen = fs.existsSync(nenFile) ? JSON.parse(fs.readFileSync(nenFile, "utf8")) : { opts: {}, kept: [] };
    const base = Object.keys(nen.opts).length ? await measureBoth(nen.opts, "nền", catalogFile) : moc;
    const points = [];
    const all = [];
    for (const g of GRID[step]) {
      const opts = { ...nen.opts, ...g.opts };
      const res = await measureBoth(opts, `${step}-${g.name}`, catalogFile);
      for (const s of SETS) write(`v2-${step}-${g.name}-${s}.json`, { opts, ...res[s] });
      const vsBase = judge({ base, cand: res });
      const vsMoc = judge({ base: moc, cand: res });
      points.push({ name: g.name, vsBase, vsMoc });
      all.push(pointSummary(g.name, res, vsBase, vsMoc));
    }
    const choice = choosePoint(points);
    const baseSum = pointSummary("nền", base, judge({ base, cand: base }), judge({ base: moc, cand: base }));
    const mocSum = pointSummary("mốc", moc, judge({ base: moc, cand: moc }), judge({ base: moc, cand: moc }));
    console.log(`Cách (${step}), nền opts ${JSON.stringify(nen.opts)}`);
    console.log(tableText([mocSum, baseSum, ...all]));
    for (const p of [mocSum, ...all]) console.log(saltText(p));
    console.log(`Luật chọn: ${choice.kept ? "GIỮ" : "KHÔNG GIỮ"} – ${choice.reason}`);
    const chosenOpts = choice.chosen ? { ...nen.opts, ...GRID[step].find((g) => g.name === choice.chosen).opts } : null;
    write(`v2-${step}-tong.json`, { nen, choice, chosenOpts, moc: mocSum, base: baseSum, points: all });
    if (choice.kept) write("v2-nen.json", { opts: chosenOpts, kept: [...nen.kept, { cach: step, diem: choice.chosen }] });
    else if (!fs.existsSync(nenFile)) write("v2-nen.json", nen);
  } else if (step === "mo-rong") {
    // P5: đo trên danh mục mở rộng thử (--catalog), mốc + cấu hình đã giữ (v2-nen.json), so với mốc trên danh mục CŨ.
    if (!catalogFile) throw new Error("--buoc mo-rong cần --catalog <danh mục mở rộng>");
    const mocOld = await measureBoth({}, "front-rank mặc định (danh mục cũ)", null);
    const nen = JSON.parse(fs.readFileSync(path.join(outDir, "v2-nen.json"), "utf8"));
    const cfgs = [{ name: "moc", opts: {} }];
    if (Object.keys(nen.opts).length) cfgs.push({ name: "giu", opts: nen.opts });
    const all = [];
    for (const c of cfgs) {
      const res = c.name === "moc" ? moc : await measureBoth(c.opts, c.name, catalogFile);
      for (const s of SETS) write(`v2-mo-rong-${c.name}-${s}.json`, { opts: c.opts, ...res[s] });
      const vsMocOld = judge({ base: mocOld, cand: res });
      all.push(pointSummary(`${c.name} (danh mục mở rộng)`, res, vsMocOld, vsMocOld));
    }
    const mocSum = pointSummary("mốc (danh mục cũ)", mocOld, judge({ base: mocOld, cand: mocOld }), judge({ base: mocOld, cand: mocOld }));
    console.log(`Danh mục ${catalogFile}; cấu hình đã giữ: ${JSON.stringify(nen.opts)}${cfgs.length === 1 ? " (= mốc)" : ""}`);
    console.log(tableText([mocSum, ...all]));
    for (const p of [mocSum, ...all]) console.log(saltText(p));
    write("v2-mo-rong-tong.json", { catalogFile, nen, mocOld: mocSum, points: all });
  } else {
    console.error(`--buoc phải là moc, mo-rong hoặc một trong ${METHOD_ORDER.join(", ")}`);
    process.exitCode = 1;
  }
}
