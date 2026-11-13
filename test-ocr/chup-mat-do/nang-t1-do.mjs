// Đợt nang-t1: khung đo T1 của "Chụp mặt trước" (app) trên 30 ảnh front.jpg + ca muối của chủ dự án.
// Chỉ ĐỌC app (public/chup-mat-do/t1.mjs, src/front-search.js, public/chup-mat-do/danh-muc-vn.json). Không thuộc app.
//
//   node test-ocr/chup-mat-do/nang-t1-do.mjs [--set A|B] [--dir <thư mục chữ OCR>] [--poly box|auto] [--name <tên>] [--out <thư mục>]
//
// --poly: "box" = luôn dựng poly từ box (mặc định bộ A), "auto" = dùng poly có sẵn, thiếu thì dựng từ box (mặc định bộ B).
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
//   fromItems(state, items, k) -> { query, hits, idfSum }, fromText(state, text, k) -> { query, hits, idfSum } };
//   hits = [{ code, score, i }]; idfSum = tổng idf câu tìm trên CHÍNH chỉ mục ranker dùng (thiếu thì measure báo lỗi).
//
// Vòng 2: "giảm" = regressions(), gộp 2 bộ chữ = judge(), luật giữ một cách = choosePoint() (chốt trước khi chạy).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rankOf } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
export const T1_FILE = path.join(ROOT, "public", "chup-mat-do", "t1.mjs");
export const CATALOG_FILE = path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json");
export const SEARCH_FILE = path.join(ROOT, "src", "front-search.js");
export const RANK_FILE = path.join(ROOT, "src", "front-rank.js");
// Ảnh thử không commit (test-ocr/photos nằm ngoài git): worktree không có thư mục này, nên thử trong repo đang chạy
// trước, không có thì dùng thư mục chính của dự án.
const PHOTOS_IN_ROOT = path.join(ROOT, "test-ocr", "photos");
export const PHOTOS = fs.existsSync(PHOTOS_IN_ROOT) ? PHOTOS_IN_ROOT : "D:\\quet-ma-vach-full\\test-ocr\\photos";
export const SETS = {
  A: { dir: "D:\\tmp\\may-chu-1\\ocr\\may-chu-t8-v3", baseline: { top1: 13, top5: 22 } },
  B: { dir: "D:\\tmp\\nang-t1\\ocr-app", baseline: { top1: 14, top5: 21 } },
};

/** Nhóm GIỮ RIÊNG đã chốt ở vòng 1 (tính lại bằng splitGroups và so khớp). */
export const HOLDOUT = [
  "8934614031322", "8934804025766", "8935001214274", "8935049511021", "8936017367107",
  "8936028641487", "8936036027099", "8936071070340", "8936221043071", "8938501141477",
];

/** 30 mã có test-ocr/photos/<mã>/front.jpg (tăng dần); measure so danh sách thư mục ảnh với hằng này. */
export const ALL_CODES = [
  "8934572260543", "8934588022111", "8934614031322", "8934673300759", "8934803043891", "8934804025766",
  "8934840000130", "8934988020021", "8935001214274", "8935039511024", "8935049501503", "8935049511021",
  "8936012061321", "8936016140060", "8936017367107", "8936017368111", "8936025773181", "8936028641487",
  "8936036020977", "8936036023633", "8936036027099", "8936036029819", "8936045081310", "8936071070340",
  "8936079120276", "8936134361040", "8936221043071", "8936221044160", "8938501141040", "8938501141477",
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

/** Tổng idf của các từ (khác nhau) trong câu tìm có trong chỉ mục BM25. Chỉ mục không có idf kiểu Map -> lỗi
 *  (không âm thầm ra 0). */
export function queryIdf(index, query) {
  if (!(index?.idf instanceof Map)) throw new Error("queryIdf: chỉ mục không có idf (Map) – ranker phải tự trả idfSum");
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

// ---- "Giảm" / "tăng" (vòng 2; định nghĩa chốt ở vòng 1, viết TRƯỚC mọi phép thử) ----

/**
 * So kết quả mới với kết quả nền, theo mã (rows: [{ code, rank }], rank 1–5 hoặc null = ngoài 5 đầu).
 *  lostTop1: 1 -> >1 hoặc null; droppedTop5: ≤5 -> null; movedDown: tụt bên trong 2–5 (vd 2 -> 4);
 *  gained: null -> ≤5 hoặc >1 -> 1. ok = không lostTop1 và không droppedTop5; strict thì thêm không movedDown.
 */
export function regressions(baseRows, newRows, { strict = false } = {}) {
  const byCode = new Map((newRows || []).map((r) => [r.code, r]));
  if (byCode.size !== (baseRows || []).length) throw new Error(`regressions: số mã lệch (${(baseRows || []).length} / ${byCode.size})`);
  const lostTop1 = [];
  const droppedTop5 = [];
  const movedDown = [];
  const gained = [];
  for (const b of baseRows) {
    const n = byCode.get(b.code);
    if (!n) throw new Error(`regressions: kết quả mới thiếu mã ${b.code}`);
    const br = b.rank ?? null;
    const nr = n.rank ?? null;
    if (br === 1 && nr !== 1) lostTop1.push(b.code);
    if (br != null && nr == null) droppedTop5.push(b.code);
    if (br != null && br >= 2 && nr != null && nr > br) movedDown.push(b.code);
    if ((br == null && nr != null) || (br != null && br > 1 && nr === 1)) gained.push(b.code);
  }
  const ok = lostTop1.length === 0 && droppedTop5.length === 0 && (!strict || movedDown.length === 0);
  return { lostTop1, droppedTop5, movedDown, gained, ok };
}

const GAIN_EPS = 1e-9;

/** "Tăng thật": ở vị trí mới, điểm của đáp án lớn hơn hẳn điểm gợi ý ngay sau (row.scores = điểm top 6, theo thứ tự).
 *  Không có gợi ý sau thì tính là hơn. Bằng điểm (chỉ nhờ thứ tự trong danh mục) thì không tính. */
export function realGain(row) {
  if (!row || row.rank == null) return false;
  const s = row.scores || [];
  const mine = s[row.rank - 1];
  if (!Number.isFinite(mine)) return false;
  const next = s[row.rank];
  return next == null || mine - next > GAIN_EPS;
}

const rowsOf = (x) => (Array.isArray(x) ? x : x?.rows || []);

/**
 * Gộp bộ A + bộ B. base / cand: { A, B } (mỗi cái = kết quả measure hoặc mảng rows).
 * chinhOk = regressions (thường) trên 20 mã CHỈNH ok ở cả A và B; giuRiengOk = regressions strict trên 10 mã GIỮ RIÊNG
 * ok ở cả A và B; gainChinh = số cặp (bộ, mã) CHỈNH có trong gained VÀ tăng thật.
 */
export function judge({ base, cand }) {
  const hold = new Set(HOLDOUT);
  const sets = {};
  let chinhOk = true;
  let giuRiengOk = true;
  let gainChinh = 0;
  for (const s of ["A", "B"]) {
    const b = rowsOf(base?.[s]);
    const c = rowsOf(cand?.[s]);
    if (!b.length || !c.length) throw new Error(`judge: thiếu bộ ${s}`);
    const cByCode = new Map(c.map((r) => [r.code, r]));
    const pick = (rows, inHold) => rows.filter((r) => hold.has(r.code) === inHold);
    const chinh = regressions(pick(b, false), pick(c, false));
    const giuRieng = regressions(pick(b, true), pick(c, true), { strict: true });
    const realGains = chinh.gained.filter((code) => realGain(cByCode.get(code)));
    sets[s] = { chinh, giuRieng, realGains };
    chinhOk &&= chinh.ok;
    giuRiengOk &&= giuRieng.ok;
    gainChinh += realGains.length;
  }
  return { chinhOk, giuRiengOk, gainChinh, sets };
}

/**
 * Luật giữ một cách (chốt TRƯỚC khi chạy, không đổi sau khi thấy số).
 * points: [{ name, vsBase: judge(nền, điểm), vsMoc: judge(mốc, điểm) }] theo đúng thứ tự ưu tiên của lưới.
 *  1) Chỉ xét điểm chinhOk ở cả vsBase và vsMoc; chọn gainChinh (so với nền) lớn nhất, bằng nhau thì điểm đứng trước.
 *     Không điểm nào gainChinh ≥ 1 -> không giữ.
 *  2) Điểm đã chọn phải giuRiengOk ở cả vsBase và vsMoc; không đạt -> không giữ (không quay lại chọn điểm khác).
 * Ca muối không tham gia. Trả { kept, chosen (tên điểm hoặc null), reason }.
 */
export function choosePoint(points) {
  let best = null;
  for (const p of points || []) {
    if (!(p.vsBase.chinhOk && p.vsMoc.chinhOk)) continue;
    if (!best || p.vsBase.gainChinh > best.vsBase.gainChinh) best = p;
  }
  if (!best || best.vsBase.gainChinh < 1) return { kept: false, chosen: null, reason: "không điểm nào vừa chinhOk vừa có gainChinh ≥ 1" };
  if (!(best.vsBase.giuRiengOk && best.vsMoc.giuRiengOk)) {
    return { kept: false, chosen: best.name, reason: `điểm ${best.name} (gainChinh ${best.vsBase.gainChinh}) không đạt giuRiengOk` };
  }
  return { kept: true, chosen: best.name, reason: `điểm ${best.name}: gainChinh ${best.vsBase.gainChinh}, chinhOk + giuRiengOk` };
}

/**
 * Lưới tham số vòng 2 (chốt TRƯỚC khi chạy; thứ tự trong mỗi mảng = thứ tự ưu tiên khi bằng gainChinh).
 * Tên opts là của src/front-rank.js: coop (a1: gộp co.op/co-op/co op -> coop trên chữ OCR và chữ danh mục),
 * fixWords (a2: sửa 1 ký tự cho từ không có trong chỉ mục), brandWeight (c: hệ số h), ngram (b: gộp BM25 n-gram 3 ký tự).
 * Thứ tự thử: (a) -> (c) -> (b); mỗi cách đo trên nền = cấu hình đã giữ trước đó.
 */
export const METHOD_ORDER = ["a", "c", "b"];
export const GRID = {
  a: [
    { name: "a1", opts: { coop: true } },
    { name: "a2", opts: { coop: true, fixWords: true } },
  ],
  c: [
    { name: "h1.5", opts: { brandWeight: 1.5 } },
    { name: "h2", opts: { brandWeight: 2 } },
    { name: "h3", opts: { brandWeight: 3 } },
  ],
  b: [
    { name: "b3", opts: { ngram: { fuse: "sum", alpha: 0.2 } } },
    { name: "b4", opts: { ngram: { fuse: "sum", alpha: 0.3 } } },
    { name: "b5", opts: { ngram: { fuse: "sum", alpha: 0.5 } } },
    { name: "b1", opts: { ngram: { fuse: "rrf", k: 60 } } },
    { name: "b2", opts: { ngram: { fuse: "rrf", k: 10 } } },
  ],
};

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
  const withIdf = (st, res) => ({ ...res, idfSum: queryIdf(st.index, res.query) });
  return {
    name: "t1-hien-tai",
    prepare: (t1, catalog) => ({ t1, index: t1.buildBm25(catalog.products) }),
    fromItems: (st, items, k) => withIdf(st, search.suggestFromItems(st.t1, st.index, items, k)),
    fromText: (st, text, k) => withIdf(st, search.suggestFromText(st.t1, st.index, text, k)),
  };
}

/** Cách tìm qua src/front-rank.js với opts (opts rỗng = mặc định, phải trùng t1-hien-tai). idfSum do front-rank trả. */
export async function frontRankRanker(opts = {}, name = "front-rank mặc định") {
  const fr = await import(pathToFileURL(RANK_FILE).href);
  return {
    name,
    opts,
    prepare: (t1, catalog) => ({ t1, rIndex: fr.buildRankIndex(t1, catalog.products, opts) }),
    fromItems: (st, items, k) => fr.rankFromItems(st.t1, st.rIndex, items, k),
    fromText: (st, text, k) => fr.rankFromText(st.t1, st.rIndex, text, k),
  };
}

/** idfSum ranker trả; thiếu / không phải số -> lỗi rõ (G1). */
export function idfOf(r, res) {
  if (!Number.isFinite(res?.idfSum)) throw new Error(`Ranker "${r.name}" không trả idfSum (tổng idf câu tìm trên chỉ mục của nó)`);
  return res.idfSum;
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
  const codes = fs.readdirSync(photos).filter((d) => fs.existsSync(path.join(photos, d, "front.jpg"))).sort();
  if (JSON.stringify(codes) !== JSON.stringify(ALL_CODES)) throw new Error(`Danh sách ảnh front.jpg lệch ALL_CODES (thấy ${codes.length} mã)`);
  const groups = splitGroups(codes);
  if (JSON.stringify(groups.holdout) !== JSON.stringify(HOLDOUT)) throw new Error(`Nhóm giữ riêng lệch: ${groups.holdout.join(", ")}`);
  const hold = new Set(groups.holdout);
  const rows = [];
  for (const code of codes) {
    const file = path.join(ocrDir, `${code}__front.json`);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const items = toPolyItems(j.items, polyMode);
    // k = 6: top 5 để chấm + điểm gợi ý thứ 6 để biết "tăng thật" ở vị trí 5 (không đổi top 5)
    const res = r.fromItems(st, items, 6);
    const hits6 = res.hits || [];
    const hits = hits6.slice(0, 5);
    const idfSum = idfOf(r, res);
    const top1 = hits[0]?.score ?? null;
    rows.push({
      code, group: hold.has(code) ? "giu-rieng" : "chinh", rank: rankOf(hits.map((h) => h.code), code),
      top1Score: top1, top2Score: hits[1]?.score ?? null, idfSum, norm: normScore(top1, idfSum),
      query: (res.query || []).join(" "), top5: hits.map((h) => h.code), scores: hits6.map((h) => h.score),
    });
  }
  const m1 = r.fromItems(st, saltItems(), 5);
  const m2 = r.fromText(st, SALT_LINES.join("\n"), 5);
  const saltOne = (res) => {
    const hits = res.hits || [];
    const top = hitRows(hits, catalog.products);
    const idfSum = idfOf(r, res);
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
