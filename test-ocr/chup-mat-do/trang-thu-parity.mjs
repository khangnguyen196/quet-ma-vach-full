// P5 vòng 5: so bản trình duyệt public/chup-mat-do/t1.mjs với bản Node (lib.mjs + vn-data.mjs) – như regex-parity.mjs.
//
//   node chup-mat-do/trang-thu-parity.mjs
//
// 30 ảnh 1a PaddleOCR.js Chromium đã lưu (D:\tmp\chup-mat-do\ocr\paddlejs-rows-chromium\<mã>__front.json, dòng kèm độ
// tin): câu tìm + top5 + điểm của t1.mjs (trên public/chup-mat-do/danh-muc-vn.json) phải trùng bản Node (trên
// D:\tmp\chup-mat-do\chi-muc\danh-muc-vn.json). Bản Node là chuẩn. Ra: ket-qua\trang-thu-parity.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, CONF_SCALE } from "./lib.mjs";
import * as node from "./vn-data.mjs";
import * as page from "../../public/chup-mat-do/t1.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** So một câu: trả { same, query, nodeTop, pageTop }. Điểm so tới 1e-9 (cùng phép tính, cùng thứ tự). */
export function compareOne(lines, nodeIndex, pageIndex) {
  const qn = node.t1QueryFromLines(lines);
  const qp = page.t1QueryFromLines(lines);
  const hn = node.bm25Search(nodeIndex, qn, 5).map((h) => ({ code: h.code, score: h.score }));
  const hp = page.bm25Search(pageIndex, qp, 5).map((h) => ({ code: h.code, score: h.score }));
  const same = qn.join(" ") === qp.join(" ") && hn.length === hp.length &&
    hn.every((h, i) => h.code === hp[i].code && Math.abs(h.score - hp[i].score) < 1e-9);
  return { same, query: qn.join(" "), pageQuery: qp.join(" "), nodeTop: hn, pageTop: hp };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
  const nodeDocs = JSON.parse(fs.readFileSync("D:\\tmp\\chup-mat-do\\chi-muc\\danh-muc-vn.json", "utf8"));
  const pageDocs = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "public", "chup-mat-do", "danh-muc-vn.json"), "utf8")).products;
  const nodeIndex = node.buildBm25(nodeDocs);
  const pageIndex = page.buildBm25(pageDocs);
  const rows = [];
  for (const t of truth) {
    const f = path.join("D:\\tmp\\chup-mat-do\\ocr\\paddlejs-rows-chromium", `${t.code}__front.json`);
    if (!fs.existsSync(f)) continue;
    const ocr = JSON.parse(fs.readFileSync(f, "utf8"));
    if (ocr.status !== "ok") continue;
    const lines = ocr.lines.map((l) => (l.conf == null ? l : { ...l, conf: Number(l.conf) / CONF_SCALE.paddlejs }));
    rows.push({ code: t.code, ...compareOne(lines, nodeIndex, pageIndex) });
  }
  const same = rows.filter((r) => r.same).length;
  const out = { at: new Date().toISOString(), catalogSame: nodeDocs.length === pageDocs.length && nodeDocs.every((d, i) => d.code === pageDocs[i].code && d.text === pageDocs[i].text), n: rows.length, same, rows };
  fs.writeFileSync("D:\\tmp\\chup-mat-do\\ket-qua\\trang-thu-parity.json", JSON.stringify(out, null, 1), "utf8");
  console.log(`Danh mục trùng (mã + text, cùng thứ tự): ${out.catalogSame}. Câu tìm + top5 + điểm trùng: ${same}/${rows.length}.`);
  for (const r of rows.filter((x) => !x.same)) console.log(`LỆCH ${r.code}: ${r.query} | ${r.pageQuery}`);
}
