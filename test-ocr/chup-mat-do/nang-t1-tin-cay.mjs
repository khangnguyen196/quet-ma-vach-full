// Đợt nang-t1 vòng 3 (cách e): chọn ngưỡng "chắc chắn" cho gợi ý "Chụp mặt trước" theo luật CHỐT TRƯỚC khi đo.
// Không thuộc app; chỉ đọc kết quả đo mốc (D:\tmp\nang-t1\ket-qua\v2-moc-A.json, v2-moc-B.json) + app (t1.mjs,
// danh mục, src/front-rank.js cho ca muối). Ghi D:\tmp\nang-t1\ket-qua\v3-tin-cay.json.
//
//   node test-ocr/chup-mat-do/nang-t1-tin-cay.mjs [--in <thư mục v2-moc>] [--out <thư mục>]
//
// Luật (chốt trước, KHÔNG đổi sau khi thấy số):
//  - Đặc trưng (thứ tự ưu tiên khi bằng): F1 top1, F2 gap = top1 − top2 (1 gợi ý thì top2 = 0), F3 norm = top1 / idfSum,
//    F4 rel = gap / top1. Chỉ dùng MỘT đặc trưng. confident = giá trị ≥ ngưỡng.
//  - Ngưỡng ứng viên = điểm giữa các cặp giá trị liên tiếp khác nhau của đặc trưng trên NHÓM CHỈNH (bộ A + B = 40 dòng).
//  - "chắc đúng" = confident và vị trí 1; precision = chắc đúng / số confident; recall = chắc đúng / số dòng vị trí 1.
//  - Chỉ xét ngưỡng có số confident ≥ 1 và precision ≥ 0,9; lấy recall lớn nhất; bằng thì precision lớn hơn; bằng nữa
//    thì ngưỡng lớn hơn; giữa các đặc trưng: recall lớn nhất, bằng thì theo thứ tự F1 → F4.
//  - Recall tốt nhất < 6/21 (MIN_RECALL_COUNT trên 21 dòng vị trí 1) hoặc không ngưỡng nào đạt precision 0,9
//    ⇒ "không tách được": luật = luôn không chắc.
//  - Nhóm giữ riêng và ca muối KHÔNG dùng để chọn, chỉ báo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HOLDOUT, T1_FILE, CATALOG_FILE, RANK_FILE, saltItems, SALT_LINES } from "./nang-t1-do.mjs";

export const FEATURES = ["top1", "gap", "norm", "rel"];
export const MIN_PRECISION = { num: 9, den: 10 }; // precision ≥ 0,9 (so bằng số nguyên: đúng · 10 ≥ 9 · confident)
export const MIN_RECALL_COUNT = 6; // recall ≥ 6 / (số dòng vị trí 1 của nhóm chỉnh = 21)

/** Ngưỡng ứng viên: điểm giữa các cặp giá trị liên tiếp khác nhau (bỏ giá trị không phải số). */
export function candidateThresholds(values) {
  const v = [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < v.length; i++) out.push((v[i] + v[i + 1]) / 2);
  return out;
}

/**
 * Đếm một ngưỡng trên các dòng { value, rank } (value null = không có gợi ý → không bao giờ confident).
 * Trả { threshold, confident, correct, precision, recall, ok } với ok = confident ≥ 1 và precision ≥ 0,9.
 */
export function evalThreshold(rows, threshold) {
  const top1 = rows.filter((r) => r.rank === 1).length;
  const conf = rows.filter((r) => Number.isFinite(r.value) && r.value >= threshold);
  const correct = conf.filter((r) => r.rank === 1).length;
  const ok = conf.length >= 1 && correct * MIN_PRECISION.den >= MIN_PRECISION.num * conf.length;
  return {
    threshold, confident: conf.length, correct, top1,
    precision: conf.length ? correct / conf.length : null, recall: top1 ? correct / top1 : null, ok,
  };
}

/** So 2 ngưỡng đạt: recall (đếm) lớn hơn, rồi precision lớn hơn, rồi ngưỡng lớn hơn. Trả true nếu a tốt hơn b. */
export function betterThreshold(a, b) {
  if (!b) return true;
  if (a.correct !== b.correct) return a.correct > b.correct; // cùng mẫu số (số dòng vị trí 1) → so số đúng = so recall
  const pa = a.correct * b.confident;
  const pb = b.correct * a.confident;
  if (pa !== pb) return pa > pb; // precision a > b ⇔ ca/na > cb/nb
  return a.threshold > b.threshold;
}

/**
 * Chọn luật trên nhóm chỉnh. rows: [{ rank, values: { top1, gap, norm, rel } | null }].
 * Trả { rule: { feature, threshold } (feature null = luôn không chắc), separable, best: { [đặc trưng]: ngưỡng tốt nhất | null },
 *       tables: { [đặc trưng]: [evalThreshold…] }, top1Count, reason }.
 */
export function chooseRule(rows, { features = FEATURES, minRecallCount = MIN_RECALL_COUNT } = {}) {
  const tables = {};
  const best = {};
  let pick = null;
  const top1Count = rows.filter((r) => r.rank === 1).length;
  for (const f of features) {
    const fr = rows.map((r) => ({ rank: r.rank, value: r.values ? r.values[f] : null }));
    tables[f] = candidateThresholds(fr.map((r) => r.value)).map((t) => evalThreshold(fr, t));
    let b = null;
    for (const row of tables[f]) if (row.ok && betterThreshold(row, b)) b = row;
    best[f] = b;
    // giữa các đặc trưng: recall lớn nhất, bằng thì đặc trưng đứng trước (F1 → F4) → chỉ thay khi recall lớn hơn hẳn
    if (b && (!pick || b.correct > pick.row.correct)) pick = { feature: f, row: b };
  }
  if (!pick) return { rule: { feature: null, threshold: null }, separable: false, best, tables, top1Count, reason: "không tách được: không ngưỡng nào đạt precision ≥ 0,9" };
  if (pick.row.correct < minRecallCount) {
    return { rule: { feature: null, threshold: null }, separable: false, best, tables, top1Count,
      reason: `không tách được: recall tốt nhất ${pick.row.correct}/${top1Count} (${pick.feature}) < ${minRecallCount}/${top1Count}` };
  }
  return { rule: { feature: pick.feature, threshold: pick.row.threshold }, separable: true, best, tables, top1Count,
    reason: `${pick.feature} ≥ ${pick.row.threshold}: recall ${pick.row.correct}/${top1Count}, precision ${pick.row.correct}/${pick.row.confident}` };
}

/** Báo một luật trên các dòng (không dùng để chọn): số confident, chắc đúng, precision, recall. */
export function reportRule(rows, rule) {
  if (!rule.feature) {
    const top1 = rows.filter((r) => r.rank === 1).length;
    return { confident: 0, correct: 0, top1, precision: null, recall: top1 ? 0 : null, n: rows.length };
  }
  const fr = rows.map((r) => ({ rank: r.rank, value: r.values ? r.values[rule.feature] : null }));
  const e = evalThreshold(fr, rule.threshold);
  return { confident: e.confident, correct: e.correct, top1: e.top1, precision: e.precision, recall: e.recall, n: rows.length };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inDir = arg("in", "D:\\tmp\\nang-t1\\ket-qua");
  const outDir = arg("out", "D:\\tmp\\nang-t1\\ket-qua");
  const fr = await import(pathToFileURL(RANK_FILE).href);
  if (JSON.stringify(fr.CONFIDENCE_FEATURES) !== JSON.stringify(FEATURES)) throw new Error("Thứ tự đặc trưng lệch src/front-rank.js");
  const hold = new Set(HOLDOUT);
  const all = [];
  const sources = {};
  for (const s of ["A", "B"]) {
    const file = path.join(inDir, `v2-moc-${s}.json`);
    sources[s] = { file, mtime: fs.statSync(file).mtime.toISOString() };
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j.rows.length !== 30) throw new Error(`${file}: ${j.rows.length} dòng ≠ 30`);
    for (const r of j.rows) {
      if (r.top1Score != null && Math.abs(r.top1Score - r.scores[0]) > 1e-12) throw new Error(`${r.code}: top1Score lệch scores[0]`);
      if ((hold.has(r.code) ? "giu-rieng" : "chinh") !== r.group) throw new Error(`${r.code}: nhóm lệch HOLDOUT`);
      const values = r.top1Score == null ? null : fr.confidenceValues({ top1: r.top1Score, top2: r.top2Score, idfSum: r.idfSum });
      all.push({ set: s, code: r.code, group: r.group, rank: r.rank, values });
    }
  }
  const tune = all.filter((r) => r.group === "chinh");
  const holdRows = all.filter((r) => r.group === "giu-rieng");
  if (tune.length !== 40) throw new Error(`nhóm chỉnh ${tune.length} dòng ≠ 40`);
  const choice = chooseRule(tune);
  if (choice.top1Count !== 21) throw new Error(`nhóm chỉnh có ${choice.top1Count} dòng vị trí 1 ≠ 21 (mốc A 10 + B 11)`);

  // Ca muối (chỉ báo): chạy thật trên danh mục app qua src/front-rank.js
  const t1 = await import(pathToFileURL(T1_FILE).href);
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  const rIndex = fr.buildRankIndex(t1, catalog.products);
  const saltOne = (res) => {
    const c = fr.confidenceOf(res, choice.rule);
    const vals = res.hits.length ? fr.confidenceValues({ top1: res.hits[0].score, top2: res.hits[1]?.score, idfSum: res.idfSum }) : null;
    return { query: res.query.join(" "), top5: res.hits.map((h) => ({ code: h.code, name: catalog.products[h.i]?.name, score: h.score })), idfSum: res.idfSum, values: vals, confidence: c };
  };
  const salt = { m1: saltOne(fr.rankFromItems(t1, rIndex, saltItems())), m2: saltOne(fr.rankFromText(t1, rIndex, SALT_LINES.join("\n"))) };

  const perSet = (rows) => ({ A: reportRule(rows.filter((r) => r.set === "A"), choice.rule), B: reportRule(rows.filter((r) => r.set === "B"), choice.rule), all: reportRule(rows, choice.rule) });
  const confidentList = (rows) => rows.filter((r) => choice.rule.feature && r.values && r.values[choice.rule.feature] >= choice.rule.threshold).map((r) => `${r.set}:${r.code}:${r.rank ?? "-"}`);
  const out = {
    at: new Date().toISOString(), sources,
    luat: "chốt trước (prompt vòng 3 P2): 1 đặc trưng; ngưỡng = điểm giữa trên nhóm chỉnh 40 dòng; precision ≥ 0,9; recall max; bằng → precision max → ngưỡng lớn; F1→F4; recall < 6/21 → luôn không chắc",
    rule: choice.rule, separable: choice.separable, reason: choice.reason,
    bestPerFeature: choice.best,
    chinh: perSet(tune), giuRieng: perSet(holdRows),
    confidentChinh: confidentList(tune), confidentGiuRieng: confidentList(holdRows),
    salt,
    perImage: all.map((r) => ({ set: r.set, code: r.code, group: r.group, rank: r.rank, values: r.values,
      confident: !!(choice.rule.feature && r.values && r.values[choice.rule.feature] >= choice.rule.threshold) })),
    tables: choice.tables,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "v3-tin-cay.json");
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");

  const pct = (x) => (x == null ? "-" : x.toFixed(3));
  console.log(`Nguồn: ${sources.A.file} (${sources.A.mtime}), ${sources.B.file} (${sources.B.mtime})`);
  console.log("Tốt nhất mỗi đặc trưng (nhóm chỉnh, 40 dòng, 21 vị trí 1):");
  for (const f of FEATURES) {
    const b = choice.best[f];
    const n = choice.tables[f].length;
    const okN = choice.tables[f].filter((r) => r.ok).length;
    console.log(`  ${f.padEnd(5)} ${b ? `ngưỡng ${b.threshold}, confident ${b.confident}, chắc đúng ${b.correct}, precision ${pct(b.precision)}, recall ${pct(b.recall)}` : "không ngưỡng nào đạt precision ≥ 0,9"} (${okN}/${n} ngưỡng đạt)`);
  }
  console.log(`Chọn: ${choice.separable ? "" : "LUÔN KHÔNG CHẮC – "}${choice.reason}`);
  for (const [name, g] of [["Nhóm chỉnh", out.chinh], ["Nhóm giữ riêng", out.giuRieng]]) {
    for (const k of ["A", "B", "all"]) {
      const x = g[k];
      console.log(`  ${name} ${k}: confident ${x.confident}/${x.n}, chắc đúng ${x.correct}, vị trí 1 ${x.top1}, precision ${pct(x.precision)}, recall ${pct(x.recall)}`);
    }
  }
  for (const m of ["m1", "m2"]) {
    const s = salt[m];
    console.log(`Ca muối ${m}: "${s.query}" confident ${s.confidence.confident}; top1 ${pct(s.values?.top1)}, gap ${pct(s.values?.gap)}, norm ${pct(s.values?.norm)}, rel ${pct(s.values?.rel)}`);
  }
  console.log(`Ghi ${outFile}`);
}
