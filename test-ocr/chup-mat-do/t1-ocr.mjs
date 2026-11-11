// Đợt ocr-mat (P1.1): chấm T1 cho chữ của MỘT OCR bất kỳ, giữ nguyên luật chup-mat-do.
// Câu tìm = t1QueryFromLines (vn-data.mjs), T1 = buildBm25 + bm25Search, chấm = rankOf + scoreHits (lib.mjs).
// Không đổi luật nào của lib.mjs / vn-data.mjs / t1.mjs; không gọi mạng; không chạy OCR.
//
//   node chup-mat-do/t1-ocr.mjs --dir <thư mục OCR> --name <tên> [--tool paddlejs|tesseractjs|vietocr | --scale <số>]
//        [--so-t1 1a-chromium|1a-webkit|1d] [--out D:\tmp\ocr-mat\ket-qua]
//
// Vào: thư mục có mỗi ảnh một file <mã>__front.json, một trong các dạng:
//   - có khung:      { items: [{ text, conf (0–1 hoặc null), box: { minX, minY, maxX, maxY } }] }
//                    -> nối khung cùng hàng bằng ĐÚNG rowLines của web-ocr/lib.mjs (cách 1a) rồi mới tạo câu tìm;
//   - không có khung: { lines: [{ text, conf }] }  (định dạng cũ paddlejs-rows / tesseractjs / vietocr-1d cũng là dạng này);
//   - chỉ có chữ:    { text: "dòng 1\ndòng 2" }.
//   status khác "ok" hoặc có error -> ảnh lỗi. Độ tin chia cho thang (--scale, hoặc CONF_SCALE[--tool]; mặc định 1).
// Mẫu số: mọi mã của truth.csv có photos/<mã>/front.jpg (30); ảnh lỗi / thiếu file tính sai.
// Ra: <out>/<tên>.json (từng ảnh: câu tìm, top5, hạng, đúng tên / thương hiệu) + 1 dòng bảng ở màn hình.
// --so-t1 <bộ>: so câu tìm + top5 TỪNG ảnh với D:\tmp\chup-mat-do\ket-qua\t1.json (hồi quy); lệch thì mã thoát 1.
// --tool và --scale cùng có: --scale thắng (in cảnh báo).
//
// KHÁC t1.mjs ở 2 chỗ (cố ý; câu tìm / T1 / cách chấm giữ nguyên):
//   1. File OCR KHÔNG có trường status thì coi là ok (t1.mjs đòi status === "ok", thiếu status bị tính lỗi): file đổi
//      định dạng / file cũ có thể không ghi status (ocr-mat/chay_ocr.py luôn ghi).
//   2. Ảnh trong mẫu số mà THIẾU file OCR thì tính SAI, mẫu số vẫn 30 (t1.mjs bỏ qua ảnh thiếu file, mẫu số nhỏ lại).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, rankOf, CONF_SCALE, summarize, scoreHits, median, maxOf } from "./lib.mjs";
import { buildBm25, bm25Search, t1QueryFromLines } from "./vn-data.mjs";
import { displayName } from "./xuat-danh-muc.mjs";
import { rowLines, rowLineInfo } from "../web-ocr/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Khung { minX, minY, maxX, maxY } thành 4 góc (dạng poly của PaddleOCR.js) để đưa vào rowLines. */
export function boxToPoly(box) {
  const { minX, minY, maxX, maxY } = box || {};
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

/** Đổi độ tin về 0–1 theo thang của công cụ; không có / không phải số -> null. */
export function scaleConf(conf, scale = 1) {
  if (conf == null) return null;
  const c = Number(conf);
  return Number.isFinite(c) ? c / scale : null;
}

/** Dòng chữ (độ tin 0–1) của một file OCR.
 *  - items có khung: nối hàng bằng rowLines (chữ), độ tin của hàng = trung bình độ tin các khung (rowLineInfo, cùng
 *    cách gom hàng nên cùng thứ tự với rowLines); khung thiếu / hỏng bị bỏ (như rowLines bỏ khung không có poly).
 *  - lines / text: như queryOf của t1.mjs (conf chia thang, dòng không có conf giữ nguyên). */
export function ocrLines(ocr, scale = 1) {
  if (Array.isArray(ocr?.items)) {
    const items = ocr.items.map((it) => ({ text: typeof it?.text === "string" ? it.text : "", poly: boxToPoly(it?.box) || [], score: scaleConf(it?.conf, scale) }));
    const texts = rowLines(items);
    const info = rowLineInfo(items);
    if (info.length !== texts.length || info.some((x, i) => x.text !== texts[i])) throw new Error("rowLines và rowLineInfo lệch nhau");
    return texts.map((text, i) => ({ text, conf: info[i].conf }));
  }
  const raw = Array.isArray(ocr?.lines) ? ocr.lines : String(ocr?.text || "").split("\n").map((text) => ({ text }));
  return raw.map((l) => (l.conf == null ? l : { ...l, conf: Number(l.conf) / scale }));
}

/** Câu tìm T1 (mảng từ) của một file OCR. */
export function queryFromOcr(ocr, scale = 1) {
  return t1QueryFromLines(ocrLines(ocr, scale));
}

/** Trạng thái một file OCR: null = dùng được; chuỗi = lý do tính sai. */
export function ocrProblem(ocr) {
  if (ocr == null) return "thiếu file OCR";
  if (ocr.status != null && ocr.status !== "ok") return `OCR lỗi: ${ocr.status}`;
  if (ocr.error) return `OCR lỗi: ${String(ocr.error).slice(0, 200)}`;
  if (!Array.isArray(ocr.items) && !Array.isArray(ocr.lines) && typeof ocr.text !== "string") return "định dạng lạ (không có items / lines / text)";
  return null;
}

/** Chấm mọi ảnh. codes: mã trong mẫu số (thứ tự truth.csv); ocrByCode: Map mã -> JSON (thiếu = undefined);
 *  index: buildBm25(docs); info: Map mã -> { name, brands } (tên / thương hiệu để chấm vị trí 1); truthByCode: Map mã -> dòng truth. */
export function scoreImages({ codes, ocrByCode, index, info, truthByCode, scale = 1 }) {
  const items = [];
  for (const code of codes) {
    const ocr = ocrByCode.get(code);
    const truth = truthByCode.get(code) || { code };
    let problem = ocrProblem(ocr);
    let q = null;
    if (!problem) {
      try { q = queryFromOcr(ocr, scale); } catch (e) { problem = `đọc lỗi: ${e.message}`; }
    }
    if (problem) {
      items.push({ ma: code, status: problem, ...scoreHits([], truth), seconds: ocr?.seconds ?? null });
      continue;
    }
    const hits = bm25Search(index, q, 5);
    const full = hits.map((h) => ({ code: h.code, name: info.get(h.code)?.name ?? "", brands: info.get(h.code)?.brands ?? "" }));
    const s = scoreHits(full, truth);
    items.push({
      ma: code, status: "ok", query: q.join(" "), queryWords: q.length, top5: hits.map((h) => h.code), scores: hits.map((h) => +h.score.toFixed(3)),
      ...s, top1Name: full[0]?.name ?? null, top1Brands: full[0]?.brands ?? null, seconds: Number.isFinite(ocr.seconds) ? ocr.seconds : null,
    });
  }
  const sum = summarize(items);
  const secs = items.filter((x) => x.status === "ok" && x.seconds != null).map((x) => x.seconds);
  return {
    items,
    summary: { ...sum, errors: items.filter((x) => x.status !== "ok").length, secondsMedian: median(secs), secondsMax: maxOf(secs), secondsN: secs.length },
  };
}

/** So câu tìm + top5 từng ảnh với kết quả cũ (items của t1.json). Ảnh lỗi ở cả hai bên = trùng. */
export function compareWithT1(items, oldItems) {
  const old = new Map((oldItems || []).map((x) => [x.ma, x]));
  const diffs = [];
  for (const it of items) {
    const o = old.get(it.ma);
    const bothErr = it.status !== "ok" && o && o.status !== "ok";
    const same = bothErr || (o && it.status === "ok" && o.status === "ok" && it.query === o.query && JSON.stringify(it.top5) === JSON.stringify(o.top5));
    if (!same) diffs.push({ ma: it.ma, moi: { query: it.query ?? it.status, top5: it.top5 ?? [] }, cu: o ? { query: o.query ?? o.status, top5: o.top5 ?? [] } : "không có trong t1.json" });
  }
  const extra = [...old.keys()].filter((ma) => !items.some((it) => it.ma === ma));
  return { same: items.length - diffs.length, total: items.length, diffs, extra };
}

/** Một dòng bảng (mẫu số luôn số mã trong mẫu, ảnh lỗi tính sai). */
export function summaryRow(name, s) {
  const n = s.n;
  return `| ${name} | ${s.top1}/${n} | ${s.top5}/${n} | ${s.nameOk}/${n} | ${s.brandOk}/${n} | ${s.errors} |`;
}

/** Mã trong mẫu số: mã của truth.csv có ảnh front.jpg (hasFront(mã) -> true/false), giữ thứ tự truth.csv. */
export function sampleCodes(truth, hasFront) {
  return truth.map((t) => t.code).filter((c) => hasFront(c));
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = arg("dir");
  const name = arg("name");
  if (!dir || !name) {
    console.error("Cần --dir <thư mục OCR> và --name <tên kết quả>.");
    process.exit(2);
  }
  const tool = arg("tool");
  if (tool && !(tool in CONF_SCALE)) { console.error(`--tool không biết: ${tool} (có: ${Object.keys(CONF_SCALE).join(", ")})`); process.exit(2); }
  const scale = Number(arg("scale", tool ? CONF_SCALE[tool] : 1));
  if (tool && arg("scale") != null) console.warn(`Cảnh báo: có cả --tool ${tool} và --scale ${arg("scale")}: dùng --scale (${scale}), bỏ thang của --tool (${CONF_SCALE[tool]}).`);
  if (!(scale > 0)) { console.error("--scale phải là số > 0"); process.exit(2); }
  const outDir = arg("out", "D:\\tmp\\ocr-mat\\ket-qua");
  const photos = arg("photos", "D:\\quet-ma-vach-full\\test-ocr\\photos");
  const catalogFile = arg("catalog", "D:\\tmp\\chup-mat-do\\chi-muc\\danh-muc-vn.json");
  const productsFile = arg("products", "D:\\tmp\\chup-mat-do\\du-lieu\\vn-products.json");
  const t1File = arg("t1", "D:\\tmp\\chup-mat-do\\ket-qua\\t1.json");

  const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
  const codes = sampleCodes(truth, (c) => fs.existsSync(path.join(photos, c, "front.jpg")));
  const docs = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const index = buildBm25(docs);
  const info = new Map(JSON.parse(fs.readFileSync(productsFile, "utf8")).map((r) => [r.code, { name: displayName(r.names), brands: r.brands || "" }]));
  const ocrByCode = new Map();
  for (const c of codes) {
    const f = path.join(dir, `${c}__front.json`);
    if (!fs.existsSync(f)) continue;
    try { ocrByCode.set(c, JSON.parse(fs.readFileSync(f, "utf8"))); } catch (e) { ocrByCode.set(c, { status: `JSON hỏng: ${e.message}` }); }
  }
  const r = scoreImages({ codes, ocrByCode, index, info, truthByCode: new Map(truth.map((t) => [t.code, t])), scale });
  const out = { name, dir, scale, at: new Date().toISOString(), catalogDocs: docs.length, rule: "t1QueryFromLines + BM25 (vn-data.mjs) + rankOf / scoreHits (lib.mjs), giữ nguyên chup-mat-do", summary: r.summary, items: r.items };
  const soT1 = arg("so-t1");
  if (soT1) {
    const t1 = JSON.parse(fs.readFileSync(t1File, "utf8"));
    const old = t1.tools?.[soT1];
    if (!old) { console.error(`t1.json không có bộ ${soT1}`); process.exit(2); }
    out.soT1 = { bo: soT1, cu: { top1: old.top1, top5: old.top5, n: old.n }, ...compareWithT1(r.items, old.items) };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  const s = r.summary;
  console.log("| OCR | Vị trí 1 | Trong 5 đầu | Đúng tên | Đúng thương hiệu | Ảnh lỗi / thiếu |");
  console.log(summaryRow(name, s));
  if (s.secondsN) console.log(`Giây/ảnh (theo file OCR, ${s.secondsN} ảnh): trung vị ${s.secondsMedian.toFixed(2)}, lớn nhất ${s.secondsMax.toFixed(2)}`);
  if (out.soT1) {
    const c = out.soT1;
    console.log(`So t1.json (${soT1}): trùng câu tìm + top5 ${c.same}/${c.total}; t1.json cũ: vị trí 1 ${c.cu.top1}/${c.cu.n}, 5 đầu ${c.cu.top5}/${c.cu.n}`);
    for (const d of c.diffs) console.log(`  LỆCH ${d.ma}: mới "${d.moi.query}" ${JSON.stringify(d.moi.top5)} | cũ "${typeof d.cu === "string" ? d.cu : d.cu.query}" ${typeof d.cu === "string" ? "" : JSON.stringify(d.cu.top5)}`);
    if (c.extra.length) console.log(`  t1.json có thêm mã không chấm ở đây: ${c.extra.join(", ")}`);
    if (c.diffs.length || c.extra.length) process.exitCode = 1;
  }
  console.log(`Ghi: ${outFile}`);
}
