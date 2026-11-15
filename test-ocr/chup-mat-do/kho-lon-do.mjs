// Đợt kho-lon vòng 1 (P2 + P3): KHUNG ĐO chọn mức danh mục lớn cho máy chủ OCR, bằng T1 bản JS (bản mẫu; vòng 2 port
// Python phải khớp bản này). CHỈ đọc cache OFF đĩa (0 lượt OFF thật), không gọi Azure, không sửa src/.
//
//   node --max-old-space-size=6144 test-ocr/chup-mat-do/kho-lon-do.mjs [--muc a,b,c] [--danh-muc D:\tmp\kho-lon\danh-muc]
//        [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\kho-lon\ket-qua]
//
// Danh mục mức: kho-lon-xuat.mjs (D:\tmp\kho-lon\danh-muc\{a,b,c}.jsonl.gz). Chữ OCR: CÙNG file các khung đo tu-dong
// (bộ B = D:\tmp\tu-dong\ocr\bo-b-30.json chữ máy chủ đã ghi, bộ A = bo-a-30.json), không chạy lại OCR.
// Gọi đúng hàm src/: buildRankIndex / rankFromItems / rankFromText (front-rank.js), mergeFront / offDoc / joinOffResults
// (front-merge.js), joinExtra / photoMerge / buildExtraIndex (front-extra.js), photoOutcome (front-photo.js),
// cleanQuery / createOffSearch (off-search.js), frontImageUrl (front-search.js).
//
// ===================================================================================================================
// LUẬT CHỌN MỨC — CHỐT TRƯỚC (commit riêng "test(kho-lon): luật chọn mức chốt trước" TRƯỚC lần chạy đo đầu tiên;
// không đổi sau khi thấy số; thấy luật sai thì ghi lệch, không sửa)
// ===================================================================================================================
// Mốc M = app hiện tại ở cce0cea = cột (2) của tu-dong-cuoi-do.mjs: T1 trên danh mục 1.452 + kho phụ C1 (buildExtraIndex
//   trên kho-phu-893.json) qua photoMerge + OFF. Bộ A và bộ B; điều kiện (i) OFF lỗi (mọi câu lỗi mạng) và (ii) OFF từ
//   cache (câu thiếu cache = câu lỗi). Kiểm tra mốc (không là cổng): M phải ra B 14/19, A 13/19 ở cả (i) và (ii).
// Ứng viên máy chủ giả lập S(L) = top SERVER_K (10) của t1.bm25Search trên chỉ mục buildBm25 (qua buildRankIndex) của
//   danh mục mức L; câu tìm = t1QueryFromLines(rowLineInfo(items), idf, aliasDf của CHÍNH chỉ mục mức L) = rankFromItems
//   (câu gõ 7Up: rankFromText) trên chỉ mục mức L. Bộ B / A: items máy chủ đã ghi (như các khung đo tu-dong).
// Đường chính khi có ứng viên: T1 trên máy (1.452) + S(L) + OFF (như hiện tại); KHÔNG tải kho phụ 893 (mọi mức đã chứa).
// Cách gộp (đo ở mọi mức):
//   G1 = S(L) thay kho phụ trong đường photoMerge: joinExtra(off, S) rồi mergeFront mặc định (chấm lại F1 bằng chỉ mục
//        chính, DEFAULT_GUARD, dùng chung offMax với OFF); mục máy chủ mang extra: true nên KHÔNG được offPromote.
//   G2-g<gap>-w<minWords> = G1 + offPromote { gap ∈ {1,2,3}, minWords ∈ {2,3} } CHỈ cho mục máy chủ (như
//        tu-dong-v42-do.mjs): mục máy chủ không mang extra, mục OFF mang extra: true (để offPromote của mergeFront chỉ
//        xét mục máy chủ, không sửa src/).
//   G3 = mục máy chủ KHÔNG chấm lại, giữ thứ tự máy chủ: lấy kết quả mergeFront(T1 + OFF) mặc định (không máy chủ),
//        giữ nguyên 3 vị trí đầu (lockTop 3), chèn MỘT mục máy chủ (mục đầu tiên theo thứ tự máy chủ chưa có trong 3
//        vị trí đó) ngay sau, rồi phần còn lại của kết quả cũ; mục không có trong danh mục (mục máy chủ ngoài danh mục +
//        mục chỉ có trên OFF) tối đa offMax 1, mục bị gạt chỉ lấp chỗ trống; cắt 5 (g3Merge, chỉ nằm trong khung đo).
// Điều kiện cứng mỗi (mức, cách):
//   H1 so với M: 0 ảnh mất vị trí 1 (bộ A + B, (i) + (ii));
//   H5 so với M: 0 ảnh mới rơi khỏi 5 (bộ A + B, (i) + (ii));
//   Muối: mục 1 KHÔNG phải 8934673218368 ở (i) và (ii) (khung "có thể nhầm" luôn hiện: CONFIDENCE_RULE luôn không chắc);
//   H4 (theo mức): file mức nén gzip ≤ GZIP_MAX_BYTES (25 MiB) và ảnh Docker ước tăng ≤ DOCKER_MAX_BYTES (1,5 GiB),
//      ước = gzip + memEstimate của tu-dong-kho-lon.mjs (mục ngược × 8 + từ vựng × 64 + tài liệu × 32 + cỡ thô);
//   H2 RAM đỉnh cả tiến trình máy chủ (nạp danh mục + 30 ảnh + ảnh nặng nhất được nhận) ≤ 1.536 MiB và H3 thời gian tìm
//      p95 ≤ 1,0 s / ảnh trên 30 ảnh bộ B: đo ở vòng 3 bằng Python; vòng 1 ghi "chưa đo".
// Chọn cách trong một mức (pickMethod): trong các cách qua H1 + H5 + muối, xếp theo (lớn hơn trước):
//   (1) số ca 7Up Diet 8934588752117 ở vị trí 1 (2 ca: chữ máy chủ "Up / Soda chanh / Khong calo" + câu gõ "Soda chanh
//       diet 7 up", × (i) + (ii) = 4 ô); (2) số ô 7Up Diet trong 5 (cùng 4 ô); (3) số ô ca dựng hàng ngoại trong 5
//   (6 ca × (i) + (ii)); (4) số ô ca dò trong 5 (70 ca × (i) + (ii)); hòa → G1, rồi G2 gap lớn hơn, rồi minWords lớn
//   hơn, G3 sau cùng.
// Chọn mức (pickLevel): mức LỚN NHẤT qua H1–H5 với cách đã chọn (vòng 1: kết luận tạm theo H1 / H5 / muối / H4, chờ
//   H2 / H3). Mức (a) không có cách nào qua H1 + H5 + muối → "DỪNG HỎI CHỦ DỰ ÁN".
// Ca dò (CHỈ BÁO, không là cổng, vì dựng từ chính danh mục): PROBE_SEED cố định, PROBE_N (10) sp mỗi nhóm th / jp /
//   my / id / kr / cn / us của mức (c) có ≥ 2 từ sau bm25Tokens (của chữ dò), chữ dò = tên + hãng (2 dòng, như ca
//   dựng hàng ngoại: saltItems độ tin 0,95); báo vị trí trong 5 theo mức × cách.
// ===================================================================================================================
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { loadApp, makeDiskFetch, rank5, ROOT, SETS, CODE_7UP, LINES_7UP, TYPED_7UP } from "./tu-dong-do.mjs";
import { foreignCases, lossOf, MO_RONG, LEMON_7UP, PLAIN_7UP } from "./tu-dong-v42-do.mjs";
import { ALL_CODES, SALT_LINES, SALT_CODE, saltItems } from "./nang-t1-do.mjs";
import { memEstimate } from "./tu-dong-kho-lon.mjs";

export const LEVEL_NAMES = Object.freeze(["a", "b", "c"]);
export const SERVER_K = 10;
export const LOCK_TOP = 3;
export const OFF_MAX = 1;
export const GZIP_MAX_BYTES = 25 * 1024 * 1024;
export const DOCKER_MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
export const RAM_MAX_MIB = 1536;
export const SEARCH_P95_MAX_S = 1.0;
export const PROBE_SEED = 20261115;
export const PROBE_N = 10;
export const PROBE_GROUPS = Object.freeze(["th", "jp", "my", "id", "kr", "cn", "us"]);
export const PROBE_MIN_TOKENS = 2;
export const SETS_AB = Object.freeze(["B", "A"]);
export const CONDS = Object.freeze(["i", "ii"]);

/** Các cách gộp: tên → { kind: "g1" | "g2" | "g3", gap?, minWords? }, theo thứ tự ưu tiên khi hòa. */
export function methodGrid() {
  const g = { G1: { kind: "g1" } };
  for (const gap of [3, 2, 1]) for (const minWords of [3, 2]) g[`G2-g${gap}-w${minWords}`] = { kind: "g2", gap, minWords };
  g.G3 = { kind: "g3" };
  return g;
}

/** Thứ hạng khi hòa (nhỏ hơn = ưu tiên): G1, rồi G2 gap lớn hơn, minWords lớn hơn, G3 sau cùng. */
export function tieRank(name) {
  return Object.keys(methodGrid()).indexOf(name);
}

/** PRNG mulberry32 (seed số nguyên) → hàm trả số [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Chọn ca dò: rows = dòng danh mục ({ code, name, brand, grp }, thứ tự file), mỗi nhóm trong groups: lọc dòng có
 * ≥ minTokens từ (tokens(tên + " " + hãng)), xếp mã tăng dần, xáo Fisher–Yates bằng mulberry32(seed + chỉ số nhóm),
 * lấy n đầu. Trả [{ code, grp, name, brand, lines: [tên, hãng] (bỏ dòng trống) }] theo thứ tự nhóm.
 */
export function pickProbes(rows, { seed = PROBE_SEED, n = PROBE_N, groups = PROBE_GROUPS, minTokens = PROBE_MIN_TOKENS, tokens }) {
  const out = [];
  groups.forEach((g, gi) => {
    const pool = rows.filter((r) => r && r.grp === g && tokens(`${r.name ?? ""} ${r.brand ?? ""}`).length >= minTokens)
      .sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
    const rnd = mulberry32(seed + gi);
    const idx = pool.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (const i of idx.slice(0, n)) {
      const r = pool[i];
      out.push({ code: r.code, grp: g, name: r.name, brand: r.brand, lines: [r.name, r.brand].map((s) => String(s || "").trim()).filter(Boolean) });
    }
  });
  return out;
}

/**
 * G3 (chỉ trong khung đo): merged0 = mergeFront(T1 + OFF) mặc định; server = mục máy chủ theo thứ tự máy chủ, dạng mục
 * hiển thị có source "catalog" (mã có trong danh mục) hoặc "server". Giữ lockTop mục đầu của merged0, chèn MỘT mục máy
 * chủ (đầu tiên chưa có trong phần giữ), rồi phần còn lại của merged0; mục source khác "catalog" tối đa offMax (tính cả
 * phần giữ), mục bị gạt chỉ lấp chỗ trống. Cắt k.
 */
export function g3Merge(merged0, server, { k = 5, lockTop = LOCK_TOP, offMax = OFF_MAX } = {}) {
  const base = Array.isArray(merged0) ? merged0 : [];
  const lock = base.slice(0, lockTop);
  const have = new Set(lock.map((x) => x.code));
  const s = (Array.isArray(server) ? server : []).find((x) => x && !have.has(x.code));
  const ranked = [...(s ? [s] : []), ...base.slice(lockTop)];
  const out = [...lock];
  let offs = lock.filter((x) => x.source !== "catalog").length;
  const spare = [];
  for (const it of ranked) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    if (it.source !== "catalog" && offs >= offMax) { spare.push(it); continue; }
    if (it.source !== "catalog") offs++;
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

/**
 * Phán một (mức, cách): r = { loss: { "B-i": { lostTop1, out5 }, … } (so với M), saltTop1: { i, ii } }.
 * Trả { pass, fails: [câu] } theo H1, H5, muối.
 */
export function judgeMethod(r, { sets = SETS_AB, conds = CONDS, saltCode = SALT_CODE } = {}) {
  const fails = [];
  for (const s of sets) for (const c of conds) {
    const k = `${s}-${c}`;
    const l = r?.loss?.[k];
    if (!l) { fails.push(`${k}: thiếu số`); continue; }
    for (const code of l.lostTop1) fails.push(`H1 ${k}: mất vị trí 1 ${code}`);
    for (const code of l.out5) fails.push(`H5 ${k}: rơi khỏi 5 ${code}`);
  }
  for (const c of conds) {
    if (!r?.saltTop1 || !(c in r.saltTop1)) { fails.push(`muối ${c}: thiếu số`); continue; }
    if (r.saltTop1[c] === saltCode) fails.push(`muối ${c}: mục 1 là mã muối Co.op giả ${saltCode}`);
  }
  return { pass: fails.length === 0, fails };
}

/** H4 theo mức: { gzip, dockerEst } → { pass, fails }. */
export function judgeH4({ gzip, dockerEst }, { gzipMax = GZIP_MAX_BYTES, dockerMax = DOCKER_MAX_BYTES } = {}) {
  const fails = [];
  if (!(Number.isFinite(gzip) && gzip <= gzipMax)) fails.push(`H4 gzip ${gzip} > ${gzipMax}`);
  if (!(Number.isFinite(dockerEst) && dockerEst <= dockerMax)) fails.push(`H4 ảnh Docker ước tăng ${dockerEst} > ${dockerMax}`);
  return { pass: fails.length === 0, fails };
}

/**
 * Chọn cách trong một mức. list = [{ name, pass, diet1, diet5, foreign5, probe5 }] → tên hoặc null (không cách nào qua).
 */
export function pickMethod(list) {
  const ok = (list || []).filter((m) => m.pass);
  ok.sort((a, b) => b.diet1 - a.diet1 || b.diet5 - a.diet5 || b.foreign5 - a.foreign5 || b.probe5 - a.probe5 || tieRank(a.name) - tieRank(b.name));
  return ok[0]?.name ?? null;
}

/**
 * Chọn mức. levels = [{ name: "a" | "b" | "c", method: tên cách đã chọn | null, h4: bool, h2: bool | null, h3: bool | null }]
 * (h2 / h3 null = chưa đo: kết luận TẠM). Trả { level: tên | null, stop: bool (mức a không có cách nào qua),
 * provisional: bool (có mức được chọn với H2 / H3 chưa đo) }.
 */
export function pickLevel(levels) {
  const list = Array.isArray(levels) ? levels : [];
  const a = list.find((l) => l.name === "a");
  if (!a || !a.method) return { level: null, stop: true, provisional: false };
  const ok = list.filter((l) => l.method && l.h4 && l.h2 !== false && l.h3 !== false)
    .sort((x, y) => LEVEL_NAMES.indexOf(y.name) - LEVEL_NAMES.indexOf(x.name));
  const best = ok[0] ?? null;
  return { level: best ? best.name : null, stop: false, provisional: !!best && (best.h2 == null || best.h3 == null) };
}

/** Đọc danh mục mức (JSONL gzip) → { rows, raw, gzip }. */
export function readLevel(file) {
  const gz = fs.readFileSync(file);
  const text = zlib.gunzipSync(gz).toString("utf8");
  const rows = [];
  for (const line of text.split("\n")) if (line) rows.push(JSON.parse(line));
  return { rows, raw: Buffer.byteLength(text), gzip: gz.length };
}

/** p-phân vị (0–1) của mảng số (cách "nearest rank"). */
export function quantile(xs, p) {
  const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const levelNames = arg("--muc", LEVEL_NAMES.join(",")).split(",").filter(Boolean);
  const dmDir = arg("--danh-muc", "D:\\tmp\\kho-lon\\danh-muc");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\kho-lon\\ket-qua");
  fs.mkdirSync(outDir, { recursive: true });
  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const osx = app.os;
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, ...rel.split("/"))).href);
  const fm = await imp("src/front-merge.js");
  const fx = await imp("src/front-extra.js");
  const fp = await imp("src/front-photo.js");
  const fs2 = await imp("src/front-search.js");
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const catalogCodes = new Set(products.map((p) => p.code));
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json"), "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);

  // ---- ca đo: input = { items } | { text }; found = T1 trên máy (1.452) ----
  const cases = [
    { set: "7up", code: CODE_7UP, kind: "may", input: { items: saltItems(LINES_7UP, 0.95) } },
    { set: "7up", code: CODE_7UP, kind: "go", input: { text: TYPED_7UP } },
    { set: "muoi", code: null, kind: "muoi", input: { items: saltItems(SALT_LINES, 0.9) } },
  ];
  for (const s of SETS_AB) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const code of ALL_CODES) {
      const items = bundle.items?.[code]?.items ?? null;
      cases.push({ set: s, code, kind: "anh", input: items ? { items } : null });
    }
  }
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), catalogCodes, osx.strangeWords, idf);
  for (const f of foreign) cases.push({ set: "ngoai", code: f.code, kind: "ngoai", input: { items: saltItems(f.lines, 0.95) } });
  // ca dò: chọn từ mức (c) (chứa mọi nhóm); không có file (c) thì từ mức lớn nhất có
  const probeLevel = [...levelNames].reverse().find((l) => fs.existsSync(path.join(dmDir, `${l}.jsonl.gz`))) ?? null;
  let probes = [];
  if (probeLevel) {
    const { rows } = readLevel(path.join(dmDir, `${probeLevel}.jsonl.gz`));
    probes = pickProbes(rows, { tokens: t1.bm25Tokens });
  }
  for (const p of probes) cases.push({ set: "do", code: p.code, kind: `do-${p.grp}`, grp: p.grp, input: { items: saltItems(p.lines, 0.95) } });
  const rank = (ri, input, k) => (!input ? null : input.items ? fr.rankFromItems(t1, ri, input.items, k) : fr.rankFromText(t1, ri, input.text, k));
  for (const c of cases) c.found = rank(rIndex, c.input, 5);

  // ---- OFF: (i) lỗi, (ii) cache (cùng bộ tìm của app, fetch đọc cache đĩa; câu thiếu cache = lỗi; 0 lượt mạng) ----
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1e9 });
  for (const c of cases) {
    c.queries = c.found ? osx.cleanQuery(c.found.lines, { idf }) : [];
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.off = { i: c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" }, ii: fm.joinOffResults(per) };
    c.allOk = per.every((p) => p.ok === true);
  }

  // ---- mốc M ----
  const codesOf = (list) => list.map((x) => x.code);
  for (const c of cases) {
    c.M = {};
    for (const cond of CONDS) {
      if (!c.found) { c.M[cond] = []; continue; }
      c.M[cond] = fx.photoMerge({ t1, rIndex, products, xi }, c.found, c.off[cond], { called: c.queries.length > 0 }).merged;
    }
  }
  const tally = (rs, get) => ({ top1: rs.filter((c) => rank5(get(c), c.code) === 1).length, top5: rs.filter((c) => rank5(get(c), c.code) != null).length });
  const mCheck = {};
  for (const s of SETS_AB) for (const cond of CONDS) mCheck[`${s}-${cond}`] = tally(cases.filter((c) => c.set === s), (c) => codesOf(c.M[cond]));

  // ---- đo từng mức ----
  const grid = methodGrid();
  const levels = {};
  const perCase = {};
  for (const L of levelNames) {
    const file = path.join(dmDir, `${L}.jsonl.gz`);
    if (!fs.existsSync(file)) { console.log(`Bỏ mức ${L}: không có ${file}`); continue; }
    if (global.gc) global.gc();
    const heap0 = process.memoryUsage();
    const tRead = Date.now();
    const lv = readLevel(file);
    const readMs = Date.now() - tRead;
    const tBuild = Date.now();
    const rIL = fr.buildRankIndex(t1, lv.rows);
    const buildMs = Date.now() - tBuild;
    const heap1 = process.memoryUsage();
    let postings = 0;
    for (const t of rIL.index.tf) postings += t.m.size;
    const dockerEst = lv.gzip + memEstimate({ postings, vocab: rIL.index.idf.size, docs: rIL.index.N, raw: lv.raw });
    const h4 = judgeH4({ gzip: lv.gzip, dockerEst });
    const perGrp = {};
    for (const r of lv.rows) perGrp[r.grp] = (perGrp[r.grp] || 0) + 1;
    // ứng viên máy chủ S(L)
    const searchMs = { B: [], A: [], all: [] };
    for (const c of cases) {
      const t = process.hrtime.bigint();
      const sr = rank(rIL, c.input, SERVER_K);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      searchMs.all.push(ms);
      if (c.set === "B" || c.set === "A") searchMs[c.set].push(ms);
      c.S = (sr?.hits || []).map((h) => {
        const r = lv.rows[h.i];
        return { code: r.code, name: r.name, brand: r.brand, img: fs2.frontImageUrl(r.code, r.img), vn: r.grp === "vn", text: r.text, grp: r.grp, score: h.score };
      });
      c.Squery = sr?.query ?? [];
    }
    const heap2 = process.memoryUsage();
    // gộp theo cách
    const run = (c, mname, cond) => {
      if (!c.found) return [];
      const m = grid[mname];
      const o = c.off[cond];
      if (m.kind === "g1") return fm.mergeFront(t1, rIndex, products, c.found, fx.joinExtra(o, c.S.map((h) => ({ ...h, extra: true }))));
      if (m.kind === "g2") {
        const offMarked = o && o.ok === true ? { ...o, hits: o.hits.map((h) => ({ ...h, extra: true })) } : o;
        return fm.mergeFront(t1, rIndex, products, c.found, fx.joinExtra(offMarked, c.S.map(({ extra, ...h }) => h)), { offPromote: { gap: m.gap, minWords: m.minWords } });
      }
      const merged0 = fm.mergeFront(t1, rIndex, products, c.found, o);
      const server = c.S.map((h) => (catalogCodes.has(h.code)
        ? { code: h.code, name: h.name, brand: h.brand, img: h.img, source: "catalog", vn: true, score: h.score }
        : { code: h.code, name: h.name, brand: h.brand, img: h.img, source: "server", vn: h.vn, score: h.score }));
      return g3Merge(merged0, server);
    };
    const methods = {};
    for (const mname of Object.keys(grid)) {
      const res = {};
      for (const c of cases) res[`${c.set}|${c.code ?? c.kind}|${c.kind}`] = Object.fromEntries(CONDS.map((cond) => [cond, run(c, mname, cond)]));
      const key = (c) => `${c.set}|${c.code ?? c.kind}|${c.kind}`;
      const sets = {};
      const loss = {};
      for (const s of SETS_AB) for (const cond of CONDS) {
        const rs = cases.filter((c) => c.set === s);
        const rows = rs.map((c) => ({ code: c.code, base: rank5(codesOf(c.M[cond]), c.code), got: rank5(codesOf(res[key(c)][cond]), c.code) }));
        const l = lossOf(rows);
        loss[`${s}-${cond}`] = l;
        sets[`${s}-${cond}`] = { top1: rows.filter((r) => r.got === 1).length, top5: rows.filter((r) => r.got != null).length, ...l,
          gained: rows.filter((r) => r.base == null && r.got != null).map((r) => r.code), up1: rows.filter((r) => r.base !== 1 && r.got === 1).map((r) => r.code) };
      }
      const s7 = {};
      let diet1 = 0;
      let diet5 = 0;
      for (const c of cases.filter((x) => x.set === "7up")) for (const cond of CONDS) {
        const codes = codesOf(res[key(c)][cond]);
        const v = { diet: rank5(codes, CODE_7UP), lemon: rank5(codes, LEMON_7UP), plain: rank5(codes, PLAIN_7UP), kind: fp.photoOutcome(res[key(c)][cond]).kind };
        s7[`${c.kind}-${cond}`] = v;
        if (v.diet === 1) diet1++;
        if (v.diet != null) diet5++;
      }
      const saltCase = cases.find((x) => x.set === "muoi");
      const saltTop1 = {};
      const saltTop = {};
      for (const cond of CONDS) {
        const list = res[key(saltCase)][cond];
        saltTop1[cond] = fp.photoOutcome(list).top?.code ?? null;
        saltTop[cond] = list.map((x) => `${x.code}(${x.source}${x.source !== "catalog" ? "," + (lv.rows.find((r) => r.code === x.code)?.grp || "chỉ OFF") : ""}) ${x.name}`);
      }
      const ngoai = {};
      let foreign5 = 0;
      for (const c of cases.filter((x) => x.set === "ngoai")) {
        ngoai[c.code] = Object.fromEntries(CONDS.map((cond) => [cond, rank5(codesOf(res[key(c)][cond]), c.code)]));
        for (const cond of CONDS) if (ngoai[c.code][cond] != null) foreign5++;
      }
      const probe = {};
      let probe5 = 0;
      for (const c of cases.filter((x) => x.set === "do")) {
        const g = (probe[c.grp] ||= { n: 0, top1: { i: 0, ii: 0 }, top5: { i: 0, ii: 0 } });
        g.n++;
        for (const cond of CONDS) {
          const p = rank5(codesOf(res[key(c)][cond]), c.code);
          if (p === 1) g.top1[cond]++;
          if (p != null) { g.top5[cond]++; probe5++; }
        }
      }
      const verdict = judgeMethod({ loss, saltTop1 });
      methods[mname] = { sets, s7, saltTop1, saltTop, ngoai, probe, diet1, diet5, foreign5, probe5, verdict };
      perCase[`${L}|${mname}`] = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Object.fromEntries(CONDS.map((cond) => [cond, codesOf(v[cond])]))]));
    }
    const chosen = pickMethod(Object.entries(methods).map(([name, m]) => ({ name, pass: m.verdict.pass, diet1: m.diet1, diet5: m.diet5, foreign5: m.foreign5, probe5: m.probe5 })));
    const sInfo = {};
    for (const c of cases.filter((x) => x.set === "7up" || x.set === "muoi" || x.set === "ngoai")) sInfo[`${c.set}|${c.code ?? c.kind}|${c.kind}`] = { query: c.Squery, top: c.S.map((h) => `${h.code}(${h.grp}) ${+h.score.toFixed(3)}`) };
    levels[L] = {
      file, n: lv.rows.length, perGrp, raw: lv.raw, gzip: lv.gzip, postings, vocab: rIL.index.idf.size, dockerEst, h4,
      h2: null, h3: null, h2h3Note: "chưa đo (vòng 3, Python)",
      time: { readMs, buildMs, searchB: { p50: quantile(searchMs.B, 0.5), p95: quantile(searchMs.B, 0.95), max: quantile(searchMs.B, 1) }, searchA: { p50: quantile(searchMs.A, 0.5), p95: quantile(searchMs.A, 0.95), max: quantile(searchMs.A, 1) }, searchAll: { p95: quantile(searchMs.all, 0.95), max: quantile(searchMs.all, 1) } },
      heapMiB: { truoc: +(heap0.heapUsed / 1048576).toFixed(1), sauDung: +(heap1.heapUsed / 1048576).toFixed(1), sauTim: +(heap2.heapUsed / 1048576).toFixed(1), rssSauDung: +(heap1.rss / 1048576).toFixed(1) },
      methods, chosen, serverTop: sInfo,
    };
    // giải phóng chỉ mục mức này trước mức sau
    for (const c of cases) { delete c.S; delete c.Squery; }
  }
  const pick = pickLevel(Object.entries(levels).map(([name, l]) => ({ name, method: l.chosen, h4: l.h4.pass, h2: null, h3: null })));
  const conclusion = pick.stop ? "DỪNG HỎI CHỦ DỰ ÁN: mức (a) không có cách nào qua H1 + H5 + muối"
    : pick.level ? `TẠM: mức (${pick.level}) + cách ${levels[pick.level].chosen} (qua H1 / H5 / muối / H4; chờ H2 / H3 ở vòng 3)`
      : "Không mức nào qua H4 với cách đã chọn";
  const coverage = Object.fromEntries([...SETS_AB, "7up", "muoi", "ngoai", "do"].map((s) => {
    const rs = cases.filter((c) => c.set === s);
    return [s, { n: rs.length, coCau: rs.filter((c) => c.queries.length).length, duCau: rs.filter((c) => c.queries.length && c.allOk).length }];
  }));
  const out = {
    at: new Date().toISOString(), cacheOnly: true, offNetCalls: disk.stats.calls, azureCalls: 0, ocrRerun: false,
    guard: { ...fm.DEFAULT_GUARD }, serverK: SERVER_K, probeSeed: PROBE_SEED, probeLevel, probes, foreign,
    mCheck, coverage, levels, pick, conclusion, cacheStats: disk.stats,
  };
  const outFile = path.join(outDir, `v1-do-${levelNames.join("")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  fs.writeFileSync(path.join(outDir, `v1-tung-ca-${levelNames.join("")}.json`), JSON.stringify({ mCases: Object.fromEntries(cases.map((c) => [`${c.set}|${c.code ?? c.kind}|${c.kind}`, Object.fromEntries(CONDS.map((cond) => [cond, codesOf(c.M[cond])]))])), perCase }, null, 0), "utf8");

  // ---- in bảng ----
  const f = (v) => (v == null ? "-" : v);
  console.log(`Mốc M (phải B 14/19, A 13/19): ${Object.entries(mCheck).map(([k, v]) => `${k} ${v.top1}/${v.top5}`).join(" | ")}`);
  console.log(`Độ phủ cache (ca đủ câu / ca có câu / số ca): ${Object.entries(coverage).map(([s, v]) => `${s} ${v.duCau}/${v.coCau}/${v.n}`).join(" | ")}`);
  for (const [L, l] of Object.entries(levels)) {
    console.log(`== Mức (${L}): ${l.n} sp ${JSON.stringify(l.perGrp)}; thô ${l.raw} B, gzip ${l.gzip} B, ảnh Docker ước tăng ${l.dockerEst} B; H4 ${l.h4.pass ? "qua" : "TRƯỢT " + l.h4.fails.join("; ")}`);
    console.log(`   dựng ${l.time.buildMs} ms (đọc ${l.time.readMs} ms), tìm B p50/p95/max ${l.time.searchB.p50?.toFixed(1)}/${l.time.searchB.p95?.toFixed(1)}/${l.time.searchB.max?.toFixed(1)} ms; heap ${JSON.stringify(l.heapMiB)} MiB`);
    for (const [m, r] of Object.entries(l.methods)) {
      console.log(`   ${m.padEnd(10)} ${Object.entries(r.sets).map(([k, v]) => `${k} ${v.top1}/${v.top5} (mất ${v.lostTop1.length}${v.lostTop1.length ? ":" + v.lostTop1.join(",") : ""} rơi ${v.out5.length}${v.out5.length ? ":" + v.out5.join(",") : ""})`).join(" | ")}`);
      console.log(`   ${"".padEnd(10)} 7Up diet/chanh/thuong: ${Object.entries(r.s7).map(([k, v]) => `${k} ${f(v.diet)}/${f(v.lemon)}/${f(v.plain)}`).join(" | ")}; muối mục 1 ${JSON.stringify(r.saltTop1)}; ngoại trong 5 ${r.foreign5}/12; dò trong 5 ${r.probe5}/${2 * probes.length}; ${r.verdict.pass ? "QUA" : "TRƯỢT (" + r.verdict.fails.length + ")"}`);
    }
    console.log(`   chọn cách: ${l.chosen ?? "không cách nào qua"}`);
  }
  console.log(`== Kết luận: ${conclusion}`);
  console.log(`OFF: ${JSON.stringify(disk.stats)} (lượt mạng ${disk.stats.calls})`);
  console.log(`Ghi: ${outFile}`);
}
