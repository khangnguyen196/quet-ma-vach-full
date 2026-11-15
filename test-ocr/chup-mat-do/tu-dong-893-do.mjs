// Đợt tu-dong vòng 5 (P1, yêu cầu chủ dự án V4-1): đo đưa sản phẩm mã 893 (Open Food Facts, trường nước bán có thể
// trống) vào "Chụp mặt trước". CHỈ đọc cache OFF đĩa (ghi bởi tu-dong-do.mjs), không gọi mạng.
//
//   node test-ocr/chup-mat-do/tu-dong-893-do.mjs [--sets B,A] [--mo-rong D:\tmp\nang-t1\du-lieu\mo-rong.json]
//        [--cache D:\tmp\tu-dong\cache-off] [--out D:\tmp\tu-dong\ket-qua] [--cau-thieu <file>]
//
// Kho 893 = bản ghi của mo-rong.json (bản xuất 08/11/2026) có mã 13 số đầu 893, có tên (ít nhất một product_name*),
// CHƯA có trong danh mục app (public/chup-mat-do/danh-muc-vn.json). Sản phẩm dạng danh mục (catalogProduct của
// nang-t1-danh-muc.mjs), xếp theo rankCompare.
// Các cách:
//   hien-tai : danh mục 1.452 + mergeFront mặc định (DEFAULT_GUARD) — MỐC của luật giữ.
//   A        : gộp thẳng: danh mục = 1.452 + mọi sp kho 893 (nối sau, rankCompare); chỉ mục / idf dựng lại.
//   B        : gộp thẳng hẹp: như A nhưng sp 893 phải có tên + hãng + ảnh mặt trước.
//   C1 / C2  : ứng viên phụ: danh mục + chỉ mục + idf GIỮ NGUYÊN; tìm trong kho 893 bằng BM25 với idf / avgdl của
//              danh mục chính (từ lạ idf 0, như ứng viên chỉ-OFF: bm25DocScore + offDoc của src/front-merge.js), lấy
//              tối đa EXTRA_LIMIT ứng viên khớp ≥ 1 từ, rồi gộp như ứng viên ngoài danh mục qua lớp chặn DEFAULT_GUARD:
//              C1 = dùng CHUNG chỗ offMax với OFF (nối sau hits OFF rồi gọi mergeFront thật);
//              C2 = kho phụ có RIÊNG 1 chỗ (lockTop 3 giữ nguyên; bản sao f1 + lớp chặn của mergeFront ở mergeF1Extra,
//              kiểm khi kho phụ rỗng phải trùng mergeFront thật ở mọi ca).
// Hai điều kiện: (i) OFF lỗi (off = null → chỉ danh mục / kho phụ); (ii) OFF từ cache (câu cleanQuery theo idf của
// từng cách; câu chưa có cache → "thiếu cache", tính như câu lỗi).
//
// LUẬT GIỮ (CHỐT TRƯỚC khi chạy, không đổi sau khi thấy số; prompt vòng 5):
//   một cách được GIỮ khi ở CẢ bộ B và bộ A, CẢ (i) và (ii): 0 ảnh mất vị trí 1 và 0 ảnh rơi khỏi 5 so với hien-tai
//   cùng điều kiện; ca muối: không sản phẩm nào được khẳng định (app luôn hiện khung "có thể nhầm":
//   CONFIDENCE_RULE = luôn không chắc, không đổi ở vòng này) → ghi top 5 để xem.
//   Trong các cách qua luật: chọn cách đưa 8934588752117 lên cao nhất ở (i) — ca chữ máy chủ ("Up" / "Soda chanh" /
//   "Khong calo") trước, rồi ca câu gõ; hòa → cỡ tải thêm (gzip) nhỏ hơn. Không cách nào qua → giữ danh mục hiện tại.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { loadApp, buildCases, makeDiskFetch, runOff, rank5, ROOT, CODE_7UP } from "./tu-dong-do.mjs";
import { catalogProduct } from "./nang-t1-danh-muc.mjs";
import { rankCompare } from "./vn-data.mjs";
import { catalogMeta, catalogJson, NGUON_VN, NGUON_VN_893 } from "./xuat-danh-muc.mjs";

export const LEMON_7UP = "8934588022111";
export const PLAIN_7UP = "8934588023064";
/** Số ứng viên kho phụ tối đa đưa vào gộp (bằng page_size của câu tìm OFF trong app). */
export const EXTRA_LIMIT = 24;

const hasName = (r) => Object.values(r?.names || {}).some((v) => typeof v === "string" && v.trim());
const hasBrand = (r) => typeof r?.brands === "string" && r.brands.trim() !== "";
const is893 = (r) => /^893\d{10}$/.test(String(r?.code ?? ""));

/** Kho 893: bản ghi (mo-rong.json) mã 893 có tên, chưa có trong danh mục; narrow → thêm có hãng + có ảnh mặt trước.
 *  Mã trùng giữ bản đầu. Trả sản phẩm dạng danh mục, xếp rankCompare. */
export function store893(records, catalogCodes, { narrow = false } = {}) {
  const seen = new Set();
  const keep = [];
  for (const r of records || []) {
    if (!r || seen.has(r.code)) continue;
    seen.add(r.code);
    if (!is893(r) || catalogCodes.has(r.code) || !hasName(r)) continue;
    const p = catalogProduct(r);
    if (narrow && (!hasBrand(r) || !p.img)) continue;
    keep.push(r);
  }
  return keep.sort(rankCompare).map(catalogProduct);
}

/** Cỡ file danh mục (thô, gzip level 9) đúng định dạng catalogJson. */
export function sizeOf(products, nguon) {
  const s = catalogJson(catalogMeta({ withNameBrand: true, count: products.length, date: "2026-11-15", nguon }), products);
  return { raw: Buffer.byteLength(s), gzip: zlib.gzipSync(s, { level: 9 }).length };
}

// Vòng 6 (P5): chỉ mục + tìm kho phụ dùng src/front-extra.js (buildExtraIndex, searchExtra, joinExtra) — bỏ bản sao
// extraIndex / searchExtra của vòng 5 trong script này.

/** C2: bản sao f1 + lớp chặn của mergeFront (offTopRule null), thêm kho phụ (source "extra") có riêng `own` chỗ. */
export function mergeF1Extra(fm, t1, rIndex, products, t1Result, offResult, extraHits, { own = 1, k = 5, lockTop = 3, offMax = 1, offGap = 1 } = {}) {
  const base = [];
  for (const h of t1Result?.hits || []) {
    const p = products[h?.i];
    if (!p || p.code !== h.code) continue;
    base.push({ code: p.code, source: "catalog", vn: true, score: Number.isFinite(h.score) ? h.score : null });
    if (base.length >= k) break;
  }
  const offOk = !!(offResult && offResult.ok === true && Array.isArray(offResult.hits) && offResult.hits.length);
  const ex = Array.isArray(extraHits) ? extraHits : [];
  if (!offOk && !ex.length) return base;
  const index = rIndex.index;
  const byCode = new Map();
  products.forEach((p, i) => { if (p && typeof p.code === "string" && !byCode.has(p.code)) byCode.set(p.code, i); });
  const query = Array.isArray(t1Result?.query) ? t1Result.query : [];
  const cands = new Map();
  let order = 0;
  for (const it of base) cands.set(it.code, { item: it, rankScore: it.score ?? 0, vn: true, src: 0, order: order++ });
  const seen = new Set();
  const offs = offOk ? offResult.hits.filter((h) => h && typeof h.code === "string" && !seen.has(h.code) && seen.add(h.code)) : [];
  for (const h of offs) {
    if (byCode.has(h.code)) {
      const i = byCode.get(h.code);
      const p = products[i];
      if (cands.has(p.code)) continue;
      const doc = index.tf[i];
      const { score, matched } = doc && doc.code === p.code ? fm.bm25DocScore(index, doc, query) : { score: 0, matched: 0 };
      if (matched < 1) continue;
      cands.set(p.code, { item: { code: p.code, source: "catalog", vn: true, score }, rankScore: score, vn: true, src: 0, order: order++ });
    } else {
      if (cands.has(h.code)) continue;
      const { score, matched } = fm.bm25DocScore(index, fm.offDoc(t1, h.text || `${h.name ?? ""} ${h.brand ?? ""}`), query);
      if (matched < 1) continue;
      cands.set(h.code, { item: { code: h.code, source: "off", vn: h.vn === true, score }, rankScore: score - offGap, vn: h.vn === true, src: 1, order: order++ });
    }
  }
  for (const h of ex) {
    if (cands.has(h.code) || byCode.has(h.code)) continue;
    const { score, matched } = fm.bm25DocScore(index, fm.offDoc(t1, h.text), query);
    if (matched < 1) continue;
    cands.set(h.code, { item: { code: h.code, source: "extra", vn: false, score }, rankScore: score - offGap, vn: false, src: 2, order: order++ });
  }
  const ranked = [...cands.values()].sort((a, b) => b.rankScore - a.rankScore || (b.vn - a.vn) || a.src - b.src || a.order - b.order).map((x) => x.item);
  const lock = base.slice(0, Math.min(lockTop, base.length));
  const out = [...lock];
  const have = new Set(lock.map((x) => x.code));
  const spare = [];
  let offs1 = 0;
  let exs = 0;
  for (const it of ranked) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    if (it.source === "off" && offs1 >= offMax) { spare.push(it); continue; }
    if (it.source === "extra" && exs >= own) { spare.push(it); continue; }
    if (it.source === "off") offs1++;
    if (it.source === "extra") exs++;
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

/** Mất vị trí 1 / rơi khỏi 5 so với mốc (mảng dòng { code, base, got } vị trí 1–5 hoặc null). */
export function lossOf(rows) {
  return {
    lostTop1: rows.filter((r) => r.base === 1 && r.got !== 1).map((r) => r.code),
    out5: rows.filter((r) => r.base != null && r.got == null).map((r) => r.code),
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const setNames = arg("--sets", "B,A").split(",").filter(Boolean);
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const outDir = arg("--out", "D:\\tmp\\tu-dong\\ket-qua");
  const moRong = arg("--mo-rong", "D:\\tmp\\nang-t1\\du-lieu\\mo-rong.json");
  fs.mkdirSync(outDir, { recursive: true });
  const app = await loadApp();
  const { t1, fr, catalog } = app;
  const fm = await import(pathToFileURL(path.join(ROOT, "src", "front-merge.js")).href);
  const fx = await import(pathToFileURL(path.join(ROOT, "src", "front-extra.js")).href);
  const products = catalog.products;
  const codes = new Set(products.map((p) => p.code));
  const records = JSON.parse(fs.readFileSync(moRong, "utf8"));
  const wide = store893(records, codes);
  const narrow = store893(records, codes, { narrow: true });
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = app.os.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 100000 });

  const baseSize = { raw: fs.statSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json")).size, gzip: zlib.gzipSync(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json")), { level: 9 }).length };
  const variantApp = (ps) => ({ ...app, catalog: { ...catalog, products: ps }, rIndex: fr.buildRankIndex(t1, ps) });
  const appA = variantApp([...products, ...wide]);
  const appB = variantApp([...products, ...narrow]);
  const sizeA = sizeOf(appA.catalog.products, NGUON_VN_893);
  const sizeB = sizeOf(appB.catalog.products, NGUON_VN_893);
  const sizeC = sizeOf(wide, NGUON_VN_893);
  const sizeNow = sizeOf(products, NGUON_VN);
  const xi = fx.buildExtraIndex(t1, wide);

  // ca theo từng cách (A / B dựng câu tìm T1 + câu OFF lại theo idf mới)
  const casesNow = buildCases(app, setNames);
  const casesA = buildCases(appA, setNames);
  const casesB = buildCases(appB, setNames);
  const missing = { now: new Set(), A: new Set(), B: new Set() };
  const offFor = async (c, tag) => {
    const o = await runOff(off, c.queries);
    for (const p of o.per) if (!p.ok) missing[tag].add(p.q);
    return { ok: o.ok && o.hits.length > 0, hits: o.hits, per: o.per };
  };

  const METHODS = ["hien-tai", "A", "B", "C1", "C2"];
  const rows = []; // { set, code, kind, cond, m: { method: { top5, src } } }
  let c2Check = 0;
  for (let i = 0; i < casesNow.length; i++) {
    const cN = casesNow[i], cA = casesA[i], cB = casesB[i];
    if (cN.code !== cA.code || cN.set !== cA.set || cN.code !== cB.code) throw new Error("thứ tự ca lệch");
    const offN = await offFor(cN, "now");
    const offA = await offFor(cA, "A");
    const offB = await offFor(cB, "B");
    const extraHits = cN.found ? fx.searchExtra(app.rIndex.index, xi, cN.found, EXTRA_LIMIT) : [];
    for (const cond of ["i", "ii"]) {
      const row = { set: cN.set, code: cN.code, kind: cN.kind, cond, holdout: !!cN.holdout, m: {} };
      const put = (name, list) => { row.m[name] = { top5: list.map((x) => x.code), src: list.map((x) => x.source) }; };
      const oN = cond === "i" ? null : offN;
      if (!cN.found) { for (const n of METHODS) put(n, []); rows.push(row); continue; }
      put("hien-tai", fm.mergeFront(t1, app.rIndex, products, cN.found, oN));
      put("A", fm.mergeFront(t1, appA.rIndex, appA.catalog.products, cA.found, cond === "i" ? null : offA));
      put("B", fm.mergeFront(t1, appB.rIndex, appB.catalog.products, cB.found, cond === "i" ? null : offB));
      // C1: kho phụ nối sau hits OFF (bỏ mã trùng), dùng chung offMax; mergeFront thật (vòng 6: joinExtra của
      // src/front-extra.js thay bản sao vòng 5)
      put("C1", fm.mergeFront(t1, app.rIndex, products, cN.found, fx.joinExtra(oN, extraHits)));
      put("C2", mergeF1Extra(fm, t1, app.rIndex, products, cN.found, oN, extraHits));
      // kiểm bản sao: kho phụ rỗng → trùng mergeFront thật
      const same = mergeF1Extra(fm, t1, app.rIndex, products, cN.found, oN, []).map((x) => x.code).join(",");
      if (same !== row.m["hien-tai"].top5.join(",")) throw new Error(`mergeF1Extra lệch mergeFront ở ${cN.set} ${cN.code} (${cond})`);
      c2Check++;
      row.extraTop = extraHits.slice(0, 3).map((h) => `${h.code} ${h.name}`);
      rows.push(row);
    }
  }

  // bảng
  const table = {};
  for (const n of METHODS) {
    table[n] = {};
    for (const s of setNames) for (const cond of ["i", "ii"]) {
      const rs = rows.filter((r) => r.set === s && r.cond === cond);
      const rk = rs.map((r) => ({ code: r.code, base: rank5(r.m["hien-tai"].top5, r.code), got: rank5(r.m[n].top5, r.code) }));
      table[n][`${s}-${cond}`] = { top1: rk.filter((r) => r.got === 1).length, top5: rk.filter((r) => r.got != null).length, ...lossOf(rk),
        changed: rk.filter((r) => r.base !== r.got).map((r) => `${r.code}: ${r.base ?? "-"}→${r.got ?? "-"}`) };
    }
  }
  const s7 = {};
  for (const n of METHODS) for (const cond of ["i", "ii"]) for (const r of rows.filter((x) => x.set === "7up" && x.cond === cond)) {
    (s7[n] ||= {})[`${r.kind.includes("gõ") ? "go" : "may"}-${cond}`] = { diet: rank5(r.m[n].top5, CODE_7UP), lemon: rank5(r.m[n].top5, LEMON_7UP), plain: rank5(r.m[n].top5, PLAIN_7UP) };
  }
  const salt = {};
  for (const n of METHODS) for (const r of rows.filter((x) => x.set === "muoi")) salt[`${n}-${r.cond}`] = r.m[n].top5.map((c, k) => `${c}(${r.m[n].src[k]})`);
  const sizes = { "hien-tai": { n: products.length, ...baseSize, them: { raw: 0, gzip: 0 } },
    A: { n: appA.catalog.products.length, ...sizeA, them: { raw: sizeA.raw - baseSize.raw, gzip: sizeA.gzip - baseSize.gzip } },
    B: { n: appB.catalog.products.length, ...sizeB, them: { raw: sizeB.raw - baseSize.raw, gzip: sizeB.gzip - baseSize.gzip } },
    C1: { n: wide.length, fileRieng: sizeC, them: sizeC }, C2: { n: wide.length, fileRieng: sizeC, them: sizeC }, nowRebuilt: sizeNow };
  const pass = METHODS.filter((n) => n !== "hien-tai").filter((n) => Object.values(table[n]).every((t) => t.lostTop1.length === 0 && t.out5.length === 0));
  const r7 = (n, key) => s7[n]?.[key]?.diet ?? 6;
  const chosen = [...pass].sort((a, b) => r7(a, "may-i") - r7(b, "may-i") || r7(a, "go-i") - r7(b, "go-i") || sizes[a].them.gzip - sizes[b].them.gzip)[0] || null;
  const out = { at: new Date().toISOString(), cacheOnly: true, sets: setNames, store: { wide: wide.length, narrow: narrow.length, has7upDiet: wide.some((p) => p.code === CODE_7UP), narrowHas7upDiet: narrow.some((p) => p.code === CODE_7UP) },
    sizes, table, s7, salt, pass, chosen, c2Check, missingCache: Object.fromEntries(Object.entries(missing).map(([k, v]) => [k, [...v]])), cacheStats: disk.stats, rows };
  const outFile = path.join(outDir, `tu-dong-893-do-${setNames.join("")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  if (argv.includes("--cau-thieu")) fs.writeFileSync(arg("--cau-thieu"), JSON.stringify({ A: [...missing.A], B: [...missing.B], now: [...missing.now] }, null, 1), "utf8");

  console.log(`Kho 893 (tên, chưa có trong danh mục): ${wide.length} sp (có 7Up Diet: ${out.store.has7upDiet}); hẹp (tên + hãng + ảnh): ${narrow.length} sp (7Up Diet: ${out.store.narrowHas7upDiet})`);
  console.log(`Cỡ: hiện tại ${JSON.stringify(sizes["hien-tai"])}; A ${JSON.stringify(sizes.A)}; B ${JSON.stringify(sizes.B)}; C (file riêng) ${JSON.stringify(sizeC)}`);
  console.log(`Câu thiếu cache: hiện tại ${missing.now.size}, A ${missing.A.size}, B ${missing.B.size}`);
  for (const n of METHODS) {
    console.log(`== ${n}: ${Object.entries(table[n]).map(([k, t]) => `${k} ${t.top1}/${t.top5} (mất v1 ${t.lostTop1.length}${t.lostTop1.length ? " " + t.lostTop1.join(",") : ""}; rơi ${t.out5.length}${t.out5.length ? " " + t.out5.join(",") : ""})`).join(" | ")}`);
    console.log(`   7Up (diet/lemon/plain): ${Object.entries(s7[n] || {}).map(([k, v]) => `${k} ${v.diet ?? "-"}/${v.lemon ?? "-"}/${v.plain ?? "-"}`).join(" | ")}`);
    console.log(`   muối (i): ${salt[`${n}-i`].join(", ")}`);
    console.log(`   muối (ii): ${salt[`${n}-ii`].join(", ")}`);
  }
  console.log(`== Qua luật: ${pass.join(", ") || "KHÔNG cách nào"}; chọn: ${chosen || "giữ danh mục hiện tại"} (kiểm bản sao C2 = mergeFront khi kho rỗng: ${c2Check} lần)`);
  console.log(`cache: ${JSON.stringify(disk.stats)}`);
  console.log(`Ghi: ${outFile}`);
}
