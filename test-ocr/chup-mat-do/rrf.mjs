// P4.1 vòng 3: kết hợp T1 (chữ, BM25 danh mục VN) + ảnh (cách 2, model tốt nhất) bằng RRF k = 60 (lib.mjs rrf).
//
//   node chup-mat-do/rrf.mjs --model clip|dinov2 [--prepare]
//
// --prepare: chép ảnh truy vấn của bộ phụ thành D:\tmp\chup-mat-do\loo-photos\<mã>\front.jpg để chạy 1a
//   (web-ocr/run-browser.mjs --engine paddlejs --join rows --only front --lines --browser chromium, như vòng 1).
// Không --prepare: đọc chữ 1a của bộ phụ (ocr\loo-1a\paddlejs-rows-chromium) + chữ 1a của mã thử
//   (ocr\paddlejs-rows-chromium), kết quả ảnh Chromium (ket-qua\cach2-<model>-chromium.json), tính T1, ảnh, T1 + ảnh.
// Mỗi danh sách đưa vào RRF là 5 kết quả đầu của nó (ảnh chỉ lưu 5 đầu). Không gọi mạng.
// Ra: ket-qua\rrf.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rrf, rankOf, CONF_SCALE } from "./lib.mjs";
import { buildBm25, bm25Search, t1QueryFromLines } from "./vn-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const model = opt("--model", "clip");
const idxDir = "D:\\tmp\\chup-mat-do\\chi-muc";
const looPhotos = "D:\\tmp\\chup-mat-do\\loo-photos";
const loo = JSON.parse(fs.readFileSync(path.join(idxDir, "loo.json"), "utf8"));

if (argv.includes("--prepare")) {
  for (const p of loo.pairs) {
    fs.mkdirSync(path.join(looPhotos, p.code), { recursive: true });
    fs.copyFileSync(path.join(idxDir, "anh", `${p.code}_${p.queryImgid}.400.jpg`), path.join(looPhotos, p.code, "front.jpg"));
  }
  console.log(`Chép ${loo.pairs.length} ảnh truy vấn vào ${looPhotos}`);
  process.exit(0);
}

const docs = JSON.parse(fs.readFileSync(path.join(idxDir, "danh-muc-vn.json"), "utf8"));
const index = buildBm25(docs);
const cach2 = JSON.parse(fs.readFileSync(`D:\\tmp\\chup-mat-do\\ket-qua\\cach2-${model}-chromium.json`, "utf8")).run;
const imgTop = new Map(cach2.results.map((r) => [r.id, r.top5 || []]));

function t1Top(file) {
  if (!fs.existsSync(file)) return null;
  const ocr = JSON.parse(fs.readFileSync(file, "utf8"));
  if (ocr.status !== "ok") return null;
  const lines = (ocr.lines || []).map((l) => (l.conf == null ? l : { ...l, conf: Number(l.conf) / CONF_SCALE.paddlejs }));
  return bm25Search(index, t1QueryFromLines(lines), 5).map((h) => h.code);
}

function scoreSet(rows) {
  const c = (k, f) => rows.filter((r) => f(r[k])).length;
  return {
    n: rows.length,
    t1: { top1: c("t1Rank", (x) => x === 1), top5: c("t1Rank", (x) => x != null) },
    img: { top1: c("imgRank", (x) => x === 1), top5: c("imgRank", (x) => x != null) },
    rrf: { top1: c("rrfRank", (x) => x === 1), top5: c("rrfRank", (x) => x != null) },
  };
}

function row(id, code, ocrFile) {
  const t1 = t1Top(ocrFile);
  const img = imgTop.get(id) || [];
  const fused = rrf([t1 || [], img], 60).slice(0, 5).map((x) => x.code);
  return { id, code, ocrOk: t1 != null, t1: t1 || [], img, rrf: fused, t1Rank: rankOf(t1 || [], code), imgRank: rankOf(img, code), rrfRank: rankOf(fused, code) };
}

const looRows = loo.pairs.map((p) => row(`loo-${p.code}`, p.code, path.join("D:\\tmp\\chup-mat-do\\ocr\\loo-1a\\paddlejs-rows-chromium", `${p.code}__front.json`)));
const testRows = cach2.results.filter((r) => r.set !== "bo-phu").map((r) => ({ set: r.set, ...row(r.id, r.code, path.join("D:\\tmp\\chup-mat-do\\ocr\\paddlejs-rows-chromium", `${r.code}__front.json`)) }));
const out = {
  model, k: 60, note: "mỗi danh sách 5 kết quả đầu; T1 từ chữ 1a PaddleOCR.js Chromium",
  boPhu: { ...scoreSet(looRows), ocrOk: looRows.filter((r) => r.ocrOk).length },
  chinh: scoreSet(testRows.filter((r) => r.set === "chinh")),
  phuXemTay: scoreSet(testRows),
  rows: { boPhu: looRows, test: testRows },
};
fs.writeFileSync("D:\\tmp\\chup-mat-do\\ket-qua\\rrf.json", JSON.stringify(out, null, 1), "utf8");
console.log(JSON.stringify({ boPhu: out.boPhu, chinh: out.chinh, phuXemTay: out.phuXemTay }, null, 1));
