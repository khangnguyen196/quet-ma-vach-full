// Đợt tu-dong vòng 7 (P2): KHUNG ĐO CUỐI "qua luồng app" — gọi ĐÚNG photoMerge (src/front-extra.js) + photoOutcome
// (src/front-photo.js) + cleanQuery / joinOffResults của src/ (không chép logic), CHỈ đọc cache OFF đĩa (0 lượt OFF thật).
//
//   node test-ocr/chup-mat-do/tu-dong-cuoi-do.mjs [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua]
//
// Dữ liệu: bộ B = chữ máy chủ OCR qua luồng app (ảnh nén 1.600 px), bộ A = chữ trên ảnh gốc — CÙNG file đã dùng ở vòng
// 3–6 (D:\tmp\tu-dong\ocr\bo-b-30.json, bo-a-30.json). Máy chủ OCR (server/) không đổi từ vòng 1 nên KHÔNG chạy lại OCR.
// Ca dựng: 7Up (chữ máy chủ "Up" / "Soda chanh" / "Khong calo" + câu gõ "Soda chanh diet 7 up"), muối Co.op (4 dòng
// chủ dự án báo), 6 ca hàng ngoại dựng của vòng 6 (foreignCases của tu-dong-v42-do.mjs).
// Điều kiện: (i) OFF lỗi (mọi câu lỗi mạng: off = { ok: false, kind: "network" }, có câu thì "có gọi"); (ii) OFF từ
// cache (câu thiếu cache = câu lỗi, như app khi OFF lỗi một câu).
// Cột:
//   (0) main 8ec74c2: T1 cũ, 5 gợi ý, không tự mở. Tổng lấy từ số đo đã có (PLAN.md vòng 1: 30 ảnh qua app Chromium bộ
//       B 14/21; khung đo node tu-dong-do.mjs bộ B 14/21, bộ A 13/22). Vị trí từng ảnh lấy từ T1 hiện tại (found.hits):
//       vòng 2 đo "luật tách chữ T1 không làm ảnh nào đổi thứ hạng" ở bộ B và A, nên bằng main ở 60 ảnh này; 7Up / muối
//       thì KHÁC main (vòng 2 sửa tách chữ "7 up" / "Up"), cột (0) của 7Up ghi theo PLAN vòng 1–2: 8934588752117 không
//       có trong danh mục → ngoài 5 ở cả 2 ca.
//   (1) app không kho phụ: photoMerge({ …, xi: null }, found, off, { called });
//   (2) app có kho phụ:   photoMerge({ …, xi }, found, off, { called }) (xi = buildExtraIndex trên kho-phu-893.json).
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC (prompt vòng 7 P2; commit riêng TRƯỚC khi chạy; không đổi sau khi thấy số)
// ===================================================================================================================
//   (L1) cột (2) so với cột (1) cùng điều kiện, cả bộ B và A, cả (i) và (ii): 0 ảnh mất vị trí 1;
//   (L2) ảnh rơi khỏi 5 (cột (2) so với cột (1)) chỉ trong B {8936012061321, 8936221043071},
//        A {8936012061321, 8936221043071, 8936045081310};
//   (L3) 7Up Diet 8934588752117 trong 5 ở cột (2) ở cả 4 ca (chữ máy chủ / câu gõ × (i) / (ii));
//   (L4) muối, cột (2), cả (i) và (ii): mục 1 KHÔNG phải mã muối Co.op giả 8934673218368 (SALT_CODE), và kết quả là
//        "open" có khung xác nhận (CONFIDENCE_RULE của front-rank.js = luôn không chắc → app luôn hiện khung "có thể
//        nhầm") hoặc "none" (không khẳng định);
//   (L5) số cột (2) phải trùng số vòng 6 (D:\tmp\tu-dong\ket-qua\v6-c1-do.log): B 14/19, A 13/19 ở cả (i) và (ii).
// Đạt hết → "ĐẠT: nối kho phụ vào app (P3)". Không đạt → "KHÔNG ĐẠT: KHÔNG nối main.js, cần chủ dự án quyết" kèm danh
// sách ảnh; KHÔNG đổi luật.
// ===================================================================================================================
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadApp, buildCases, makeDiskFetch, rank5, ROOT, CODE_7UP } from "./tu-dong-do.mjs";
import { foreignCases, lossOf, MO_RONG, LEMON_7UP, PLAIN_7UP } from "./tu-dong-v42-do.mjs";
import { saltItems, SALT_CODE } from "./nang-t1-do.mjs";
import { ACCEPTED_OUT5 } from "./tu-dong-c1-do.mjs";

/** Số cột (2) đo ở vòng 6 (v6-c1-do.log, cột "cuoi+kho"). */
export const V6_COL2 = Object.freeze({ B: Object.freeze({ top1: 14, top5: 19 }), A: Object.freeze({ top1: 13, top5: 19 }) });
/** Cột (0) main 8ec74c2 (nguồn: PLAN.md vòng 1 + SETS.baseline của tu-dong-do.mjs). */
export const MAIN_COL0 = Object.freeze({ B: Object.freeze({ top1: 14, top5: 21 }), A: Object.freeze({ top1: 13, top5: 22 }) });

/**
 * Phán theo luật chốt trước. r = {
 *   loss: { "B-i": lossOf(col1 → col2), … }, counts: { "B-i": { top1, top5 } (cột 2), … },
 *   s7: { "may-i": vị trí 8934588752117 cột 2 | null, "may-ii", "go-i", "go-ii" },
 *   salt: { i: { top1: mã | null, kind: "open" | "none", confirmBox: bool }, ii: … } }.
 * Trả { ok, fails: [câu] }.
 */
export function judgeFinal(r, { sets = ["B", "A"], conds = ["i", "ii"], accepted = ACCEPTED_OUT5, v6 = V6_COL2, saltCode = SALT_CODE } = {}) {
  const fails = [];
  for (const s of sets) for (const c of conds) {
    const k = `${s}-${c}`;
    const l = r?.loss?.[k];
    if (!l) { fails.push(`${k}: thiếu số`); continue; }
    for (const code of l.lostTop1) fails.push(`L1 ${k}: mất vị trí 1 ${code}`);
    for (const code of l.out5) if (!(accepted[s] || []).includes(code)) fails.push(`L2 ${k}: rơi khỏi 5 ngoài danh sách ${code}`);
    const n = r?.counts?.[k];
    if (!n || n.top1 !== v6[s]?.top1 || n.top5 !== v6[s]?.top5) fails.push(`L5 ${k}: cột (2) ${n ? `${n.top1}/${n.top5}` : "thiếu"} ≠ vòng 6 ${v6[s]?.top1}/${v6[s]?.top5}`);
  }
  for (const k of ["may-i", "may-ii", "go-i", "go-ii"]) {
    const p = r?.s7?.[k];
    if (!(Number.isInteger(p) && p >= 1 && p <= 5)) fails.push(`L3 7Up ${k}: 8934588752117 ngoài 5`);
  }
  for (const c of conds) {
    const s = r?.salt?.[c];
    if (!s) { fails.push(`L4 muối ${c}: thiếu số`); continue; }
    if (s.top1 === saltCode) fails.push(`L4 muối ${c}: mục 1 là mã muối Co.op giả ${saltCode}`);
    if (!((s.kind === "open" && s.confirmBox === true) || s.kind === "none")) fails.push(`L4 muối ${c}: kết quả ${s.kind} không có khung xác nhận`);
  }
  return { ok: fails.length === 0, fails };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  fs.mkdirSync(outDir, { recursive: true });
  const SETS = ["B", "A"];
  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const osx = app.os;
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, ...rel.split("/"))).href);
  const fm = await imp("src/front-merge.js");
  const fx = await imp("src/front-extra.js");
  const fp = await imp("src/front-photo.js");
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const extraFile = path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json");
  const store = JSON.parse(fs.readFileSync(extraFile, "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);
  const confirmBox = fr.CONFIDENCE_RULE.feature === null; // luôn không chắc → app luôn hiện khung xác nhận khi "open"

  const codes = new Set(products.map((p) => p.code));
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), codes, osx.strangeWords, idf);
  const cases = buildCases(app, SETS);
  for (const f of foreign) cases.push({ set: "ngoai", code: f.code, kind: "ngoai (ca dựng)", found: fr.rankFromItems(t1, rIndex, saltItems(f.lines, 0.95)) });

  // OFF từ cache: CÙNG bộ tìm của app (createOffSearch) với fetch đọc cache đĩa; câu thiếu cache = lỗi.
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });
  for (const c of cases) {
    // như showPhotoResult: câu tìm = cleanQuery(found.lines, { idf }); kết quả = joinOffResults(Promise.all(search))
    c.queries = c.found ? osx.cleanQuery(c.found.lines, { idf }) : [];
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.offCache = fm.joinOffResults(per);
    c.offFail = c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" };
    c.allOk = per.every((p) => p.ok === true);
  }
  const extraCodes = new Set(store.products.map((p) => p.code));
  const srcOf = (x) => (x.source === "catalog" ? "catalog" : x.extra === true ? "extra" : extraCodes.has(x.code) ? "off(có trong kho phụ)" : "off");
  const run = (c, col, cond) => {
    if (!c.found) return { codes: [], src: [], kind: "none", offFailed: false };
    if (col === "0") {
      const list = c.found.hits.slice(0, 5).map((h) => h.code);
      return { codes: list, src: list.map(() => "catalog"), kind: "goi-y", offFailed: false };
    }
    const off = cond === "i" ? c.offFail : c.offCache;
    const { merged, offFailed } = fx.photoMerge({ t1, rIndex, products, xi: col === "2" ? xi : null }, c.found, off, { called: c.queries.length > 0 });
    const o = fp.photoOutcome(merged);
    return { codes: merged.map((x) => x.code), src: merged.map(srcOf), kind: o.kind, top1: o.top?.code ?? null, offFailed };
  };
  const COLS = ["0", "1", "2"];
  const res = {};
  const keyOf = (c) => `${c.set}|${c.code ?? c.kind}|${c.kind}`;
  for (const c of cases) res[keyOf(c)] = Object.fromEntries(["i", "ii"].map((cond) => [cond, Object.fromEntries(COLS.map((col) => [col, run(c, col, cond)]))]));

  const table = {};
  const loss = {};
  const counts = {};
  for (const s of SETS) for (const cond of ["i", "ii"]) {
    const rs = cases.filter((c) => c.set === s);
    const rk = (c, col) => rank5(res[keyOf(c)][cond][col].codes, c.code);
    const row = (col) => ({ top1: rs.filter((c) => rk(c, col) === 1).length, top5: rs.filter((c) => rk(c, col) != null).length });
    const l21 = lossOf(rs.map((c) => ({ code: c.code, base: rk(c, "1"), got: rk(c, "2") })));
    const l10 = lossOf(rs.map((c) => ({ code: c.code, base: rk(c, "0"), got: rk(c, "1") })));
    const l20 = lossOf(rs.map((c) => ({ code: c.code, base: rk(c, "0"), got: rk(c, "2") })));
    const k = `${s}-${cond}`;
    table[k] = {
      col0: row("0"), col0Plan: MAIN_COL0[s], col1: row("1"), col2: row("2"),
      "2vs1": { ...l21, gained: rs.filter((c) => rk(c, "1") == null && rk(c, "2") != null).map((c) => c.code), up1: rs.filter((c) => rk(c, "1") !== 1 && rk(c, "2") === 1).map((c) => c.code) },
      "1vs0": { ...l10, gained: rs.filter((c) => rk(c, "0") == null && rk(c, "1") != null).map((c) => c.code) },
      "2vs0": { ...l20, gained: rs.filter((c) => rk(c, "0") == null && rk(c, "2") != null).map((c) => c.code) },
      autoOpen: { col1: rs.filter((c) => res[keyOf(c)][cond]["1"].kind === "open").length, col2: rs.filter((c) => res[keyOf(c)][cond]["2"].kind === "open").length, n: rs.length },
    };
    loss[k] = l21;
    counts[k] = row("2");
  }
  const s7 = {};
  const s7all = {};
  const salt = {};
  const saltTop = {};
  const ngoai = {};
  for (const c of cases) {
    const r = res[keyOf(c)];
    for (const cond of ["i", "ii"]) {
      if (c.set === "7up") {
        const k = `${c.kind.includes("gõ") ? "go" : "may"}-${cond}`;
        s7[k] = rank5(r[cond]["2"].codes, CODE_7UP);
        s7all[k] = Object.fromEntries(COLS.map((col) => [col, { diet: rank5(r[cond][col].codes, CODE_7UP), lemon: rank5(r[cond][col].codes, LEMON_7UP), plain: rank5(r[cond][col].codes, PLAIN_7UP), kind: r[cond][col].kind, top5: r[cond][col].codes.map((x, j) => `${x}(${r[cond][col].src[j]})`) }]));
      }
      if (c.set === "muoi") {
        salt[cond] = { top1: r[cond]["2"].top1, kind: r[cond]["2"].kind, confirmBox: r[cond]["2"].kind === "open" ? confirmBox : false };
        for (const col of COLS) saltTop[`${cond}-${col}`] = r[cond][col].codes.map((x, j) => `${x}(${r[cond][col].src[j]})`);
      }
      if (c.set === "ngoai") (ngoai[c.code] ||= {})[cond] = Object.fromEntries(COLS.map((col) => [col, rank5(r[cond][col].codes, c.code)]));
    }
  }
  const verdict = judgeFinal({ loss, counts, s7, salt });
  const coverage = Object.fromEntries([...SETS, "7up", "muoi", "ngoai"].map((s) => {
    const rs = cases.filter((c) => c.set === s);
    return [s, { n: rs.length, duCau: rs.filter((c) => c.allOk && c.queries.length).length, coCau: rs.filter((c) => c.queries.length).length }];
  }));
  const conclusion = verdict.ok ? "ĐẠT: nối kho phụ vào app (P3)" : "KHÔNG ĐẠT: KHÔNG nối main.js, cần chủ dự án quyết";
  const out = {
    at: new Date().toISOString(), cacheOnly: true, ocrRerun: false, guard: { ...fm.DEFAULT_GUARD }, strangeMode: osx.STRANGE_MODE,
    confidenceRule: { ...fr.CONFIDENCE_RULE }, extra: { n: store.products.length }, coverage, table, s7: s7all, salt, saltTop, ngoai, foreign, verdict, conclusion, cacheStats: disk.stats, res,
  };
  const outFile = path.join(outDir, "tu-dong-cuoi-do-BA.json");
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  const f = (v) => (v == null ? "-" : v);
  console.log(`Lớp chặn ${JSON.stringify(out.guard)}, STRANGE_MODE ${JSON.stringify(out.strangeMode)}, CONFIDENCE_RULE ${JSON.stringify(out.confidenceRule)}; kho phụ ${store.products.length} sp; OCR không chạy lại (cùng file vòng 3–6)`);
  console.log(`Độ phủ cache (ca đủ câu / ca có câu / số ca): ${Object.entries(coverage).map(([s, v]) => `${s} ${v.duCau}/${v.coCau}/${v.n}`).join(" | ")}`);
  for (const [k, v] of Object.entries(table)) {
    console.log(`  ${k}: (0) T1 ${v.col0.top1}/${v.col0.top5} [PLAN main ${v.col0Plan.top1}/${v.col0Plan.top5}] | (1) ${v.col1.top1}/${v.col1.top5} | (2) ${v.col2.top1}/${v.col2.top5} | tự mở (1) ${v.autoOpen.col1}/${v.autoOpen.n} (2) ${v.autoOpen.col2}/${v.autoOpen.n}`);
    console.log(`     (2) so (1): mất v1 [${v["2vs1"].lostTop1}] rơi [${v["2vs1"].out5}] thêm vào 5 [${v["2vs1"].gained}] lên v1 [${v["2vs1"].up1}]`);
    console.log(`     (1) so (0): mất v1 [${v["1vs0"].lostTop1}] rơi [${v["1vs0"].out5}] thêm [${v["1vs0"].gained}] | (2) so (0): mất v1 [${v["2vs0"].lostTop1}] rơi [${v["2vs0"].out5}] thêm [${v["2vs0"].gained}]`);
  }
  for (const [k, v] of Object.entries(s7all)) console.log(`  7Up ${k} (Diet/hương chanh/thường): ${COLS.map((col) => `(${col}) ${f(v[col].diet)}/${f(v[col].lemon)}/${f(v[col].plain)} ${v[col].kind}`).join(" | ")}`);
  for (const [k, v] of Object.entries(saltTop)) console.log(`  muối ${k}: ${v.join(", ")}`);
  console.log(`  muối kết quả cột (2): ${JSON.stringify(salt)}`);
  for (const [code, v] of Object.entries(ngoai)) console.log(`  ngoại ${code}: ${["i", "ii"].map((cond) => COLS.map((col) => `${cond}(${col}) ${f(v[cond][col])}`).join(" ")).join(" | ")}`);
  console.log(`== Phán: ${JSON.stringify(verdict)} → ${conclusion}`);
  console.log(`cache: ${JSON.stringify(disk.stats)}`);
  console.log(`Ghi: ${outFile}`);
}
