// Đợt nang-t1: khung đo T1 của "Chụp mặt trước" (app) trên 30 ảnh front.jpg + ca muối của chủ dự án.
// Chỉ ĐỌC app (public/chup-mat-do/t1.mjs, src/front-search.js, public/chup-mat-do/danh-muc-vn.json). Không thuộc app.
//
//   node test-ocr/chup-mat-do/nang-t1-do.mjs [--set A|B] [--dir <thư mục chữ OCR>] [--name <tên>] [--out <thư mục>]
//
// Bộ chữ A = chữ R1 máy chủ đã lưu (D:\tmp\may-chu-1\ocr\may-chu-t8-v3\<mã>__front.json, items { text, conf, box }):
//   đổi box -> poly 4 điểm, conf -> score rồi đi ĐÚNG đường B của app (suggestFromItems). Mốc: 13 / 22.
// Bộ chữ B = chữ máy chủ trả về khi chạy qua luồng app (ảnh nén 1.600 px trong trình duyệt), D:\tmp\nang-t1\ocr-app\:
//   items có sẵn poly / score. Mốc: 14 / 21.
// Ca muối (13/11/2026): 4 dòng chữ máy chủ đọc từ gói muối Co.op Select; m1 = 4 khung xếp chồng qua suggestFromItems,
//   m2 = 4 dòng nối "\n" qua suggestFromText. Mã 8934673218368 trong danh mục là creamer Vinamilk, nên kết quả đúng của
//   ca muối là "không chắc" (không có gợi ý nào được khẳng định).
// Chia nhóm cố định (không theo kết quả): xếp 30 mã tăng dần, vị trí 3, 6, …, 30 = GIỮ RIÊNG (10), còn lại = CHỈNH (20).
//
// Cắm cách tìm khác (vòng 2–3): measure({ ranker }) với ranker = { name, prepare(t1, catalog) -> state,
//   fromItems(state, items, k) -> { query, hits }, fromText(state, text, k) -> { query, hits } }; hits = [{ code, score, i }].
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rankOf } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
export const T1_FILE = path.join(ROOT, "public", "chup-mat-do", "t1.mjs");
export const CATALOG_FILE = path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json");
export const SEARCH_FILE = path.join(ROOT, "src", "front-search.js");
export const PHOTOS = "D:\\quet-ma-vach-full\\test-ocr\\photos";
export const SETS = {
  A: { dir: "D:\\tmp\\may-chu-1\\ocr\\may-chu-t8-v3", baseline: { top1: 13, top5: 22 } },
  B: { dir: "D:\\tmp\\nang-t1\\ocr-app", baseline: { top1: 14, top5: 21 } },
};

/** Nhóm GIỮ RIÊNG đã chốt ở vòng 1 (tính lại bằng splitGroups và so khớp). */
export const HOLDOUT = [
  "8934614031322", "8934804025766", "8935001214274", "8935049511021", "8936017367107",
  "8936028641487", "8936036027099", "8936071070340", "8936221043071", "8938501141477",
];

/** Chia nhóm: xếp mã tăng dần, vị trí (tính từ 1) chia hết cho `every` = giữ riêng, còn lại = chỉnh. */
export function splitGroups(codes, every = 3) {
  const sorted = [...new Set((codes || []).map(String))].sort();
  const holdout = sorted.filter((_, i) => (i + 1) % every === 0);
  const tune = sorted.filter((_, i) => (i + 1) % every !== 0);
  return { tune, holdout };
}

/** Khung chữ nhật { minX, minY, maxX, maxY } -> poly 4 điểm theo chiều kim đồng hồ từ góc trên trái. */
export function boxToPoly(box) {
  const { minX, minY, maxX, maxY } = box || {};
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

/** Khung chữ đã lưu -> { text, poly, score } cho đường B. mode "box": luôn dựng poly từ box (bộ A);
 *  "auto": dùng poly có sẵn, không có thì dựng từ box. conf / score thiếu -> score null. Khung hỏng thì bỏ. */
export function toPolyItems(items, mode = "box") {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.text !== "string") continue;
    const poly = mode === "auto" && Array.isArray(it.poly) && it.poly.length ? it.poly : boxToPoly(it.box);
    if (!poly) continue;
    const s = Number.isFinite(it.score) ? it.score : Number.isFinite(it.conf) ? it.conf : null;
    out.push({ text: it.text, poly, score: s });
  }
  return out;
}

/** Ca muối: đúng 4 dòng máy chủ đọc (giữ nguyên ký tự). */
export const SALT_LINES = ["COOP", "Select", "Mui Bin Tinh Sấy l-t", "IODIZES REFINED SEA SALT"];
export const SALT_CODE = "8934673218368";
/** 5 gợi ý sai chủ dự án thấy trên điện thoại (theo thứ tự hiện). */
export const SALT_SEEN = ["Lorenz naturals", "Cơm Sấy Minh Châu", "Argeta Salt", "Ham Select", "Kem đánh răng Freshmint Co.op Select"];

/** m1: mỗi dòng một khung riêng, xếp chồng không chồng lấn (cao 40, cách 20), score 0,9. */
export function saltItems(lines = SALT_LINES, score = 0.9) {
  return lines.map((text, k) => ({ text, poly: boxToPoly({ minX: 10, minY: 10 + k * 60, maxX: 410, maxY: 50 + k * 60 }), score }));
}

/** Tổng idf của các từ (khác nhau) trong câu tìm có trong chỉ mục BM25. */
export function queryIdf(index, query) {
  let s = 0;
  for (const w of new Set(query || [])) s += index?.idf?.get(w) || 0;
  return s;
}

/** Điểm chuẩn hóa = điểm top1 / tổng idf câu tìm (0 nếu không có). */
export function normScore(top1, idfSum) {
  return top1 != null && idfSum > 0 ? top1 / idfSum : 0;
}

/** Gộp bảng: số ảnh, vị trí 1, trong 5 đầu. */
export function tally(rows) {
  return { n: rows.length, top1: rows.filter((r) => r.rank === 1).length, top5: rows.filter((r) => r.rank != null).length };
}

/** Bỏ dấu + thường hóa để so tên gợi ý với tên chủ dự án thấy. */
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();

/** Gợi ý { name, brand } khớp một tên chủ dự án thấy: mọi từ của tên thấy nằm trong tên + thương hiệu
 *  (điện thoại hiện tên kèm thương hiệu, vd "Cơm Sấy" + "Minh Châu" = "Cơm Sấy Minh Châu"). */
export function seenMatch(hit, seenName) {
  const have = new Set(fold(`${hit?.name ?? ""} ${hit?.brand ?? ""}`).split(/[^a-z0-9.]+/).filter(Boolean));
  const want = fold(seenName).split(/[^a-z0-9.]+/).filter(Boolean);
  return want.length > 0 && want.every((w) => have.has(w));
}

/** So top5 ({ name, brand }) với SALT_SEEN: số tên thấy có trong top5 + có cùng thứ tự từng vị trí không. */
export function compareSeen(hits, seen = SALT_SEEN) {
  const common = seen.filter((s) => hits.some((h) => seenMatch(h, s)));
  const sameOrder = hits.length === seen.length && hits.every((h, i) => seenMatch(h, seen[i]));
  return { common: common.length, of: seen.length, sameOrder };
}

/** Cách tìm mặc định = T1 hiện tại của app (đường B / ô sửa chữ). */
export async function baselineRanker() {
  const search = await import(pathToFileURL(SEARCH_FILE).href);
  return {
    name: "t1-hien-tai",
    prepare: (t1, catalog) => ({ t1, index: t1.buildBm25(catalog.products) }),
    fromItems: (st, items, k) => search.suggestFromItems(st.t1, st.index, items, k),
    fromText: (st, text, k) => search.suggestFromText(st.t1, st.index, text, k),
  };
}

function hitRows(hits, products) {
  return hits.map((h) => ({ code: h.code, name: products[h.i]?.name ?? "", brand: products[h.i]?.brand ?? "", score: +h.score.toFixed(4) }));
}

/**
 * Đo một cách tìm trên một bộ chữ. Trả { ranker, set, groups, rows, salt }.
 * ocrDir: thư mục <mã>__front.json; polyMode: "box" (bộ A) | "auto" (bộ B).
 */
export async function measure({ ranker, set = "A", ocrDir = SETS[set]?.dir, polyMode = set === "A" ? "box" : "auto", photos = PHOTOS, t1File = T1_FILE, catalogFile = CATALOG_FILE } = {}) {
  const t1 = await import(pathToFileURL(t1File).href);
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const r = ranker || (await baselineRanker());
  const st = r.prepare(t1, catalog);
  const index = st.index || t1.buildBm25(catalog.products);
  const codes = fs.readdirSync(photos).filter((d) => fs.existsSync(path.join(photos, d, "front.jpg"))).sort();
  if (codes.length !== 30) throw new Error(`Cần 30 ảnh front.jpg, thấy ${codes.length}`);
  const groups = splitGroups(codes);
  if (JSON.stringify(groups.holdout) !== JSON.stringify(HOLDOUT)) throw new Error(`Nhóm giữ riêng lệch: ${groups.holdout.join(", ")}`);
  const hold = new Set(groups.holdout);
  const rows = [];
  for (const code of codes) {
    const file = path.join(ocrDir, `${code}__front.json`);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const items = toPolyItems(j.items, polyMode);
    const res = r.fromItems(st, items, 5);
    const hits = res.hits || [];
    const idfSum = queryIdf(index, res.query);
    const top1 = hits[0]?.score ?? null;
    rows.push({
      code, group: hold.has(code) ? "giu-rieng" : "chinh", rank: rankOf(hits.map((h) => h.code), code),
      top1Score: top1, top2Score: hits[1]?.score ?? null, idfSum, norm: normScore(top1, idfSum),
      query: (res.query || []).join(" "), top5: hits.map((h) => h.code),
    });
  }
  const m1 = r.fromItems(st, saltItems(), 5);
  const m2 = r.fromText(st, SALT_LINES.join("\n"), 5);
  const saltOne = (res) => {
    const hits = res.hits || [];
    const top = hitRows(hits, catalog.products);
    const idfSum = queryIdf(index, res.query);
    return { query: (res.query || []).join(" "), top5: top, rankOfCode: rankOf(hits.map((h) => h.code), SALT_CODE), idfSum, norm: normScore(hits[0]?.score ?? null, idfSum), seen: compareSeen(top) };
  };
  const salt = { code: SALT_CODE, catalogEntry: catalog.products.find((p) => p.code === SALT_CODE) || null, m1: saltOne(m1), m2: saltOne(m2) };
  return {
    ranker: r.name, set, ocrDir, polyMode, catalogSize: catalog.products.length, groups,
    summary: { all: tally(rows), chinh: tally(rows.filter((x) => x.group === "chinh")), giuRieng: tally(rows.filter((x) => x.group === "giu-rieng")) },
    rows, salt,
  };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const set = arg("set", "A");
  const dir = arg("dir", SETS[set]?.dir);
  const outDir = arg("out", "D:\\tmp\\nang-t1\\ket-qua");
  const name = arg("name", `moc-${set}`);
  const res = await measure({ set, ocrDir: dir, polyMode: arg("poly", set === "A" ? "box" : "auto") });
  const f = (x) => (x == null ? "-" : x.toFixed(3));
  console.log(`Bộ ${set} (${dir}), cách tìm ${res.ranker}, danh mục ${res.catalogSize} sp`);
  for (const [k, v] of Object.entries(res.summary)) console.log(`  ${k.padEnd(9)} vị trí 1 ${v.top1}/${v.n}, trong 5 ${v.top5}/${v.n}`);
  console.log("Từng ảnh (nhóm, vị trí, top1, top2, chuẩn hóa):");
  for (const r of res.rows) console.log(`  ${r.code} ${r.group.padEnd(9)} ${String(r.rank ?? "-").padStart(2)} ${f(r.top1Score)} ${f(r.top2Score)} ${f(r.norm)}`);
  for (const m of ["m1", "m2"]) {
    const s = res.salt[m];
    console.log(`Ca muối ${m}: câu tìm "${s.query}", mã muối ở vị trí ${s.rankOfCode ?? "-"}, chuẩn hóa ${f(s.norm)}, trùng gợi ý chủ dự án thấy ${s.seen.common}/${s.seen.of}${s.seen.sameOrder ? " (cùng thứ tự)" : ""}`);
    for (const h of s.top5) console.log(`    ${h.code} ${h.score} ${h.name} | ${h.brand}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${name}.json`);
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ...res }, null, 1), "utf8");
  console.log(`Ghi ${out}`);
  const base = SETS[set]?.baseline;
  if (base && dir === SETS[set].dir && (res.summary.all.top1 !== base.top1 || res.summary.all.top5 !== base.top5)) {
    console.error(`LỆCH MỐC: ${res.summary.all.top1}/${res.summary.all.top5} ≠ ${base.top1}/${base.top5}`);
    process.exitCode = 1;
  }
}
