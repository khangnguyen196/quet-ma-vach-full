// Test đợt ocr-mat P1.1 (không mạng, không đọc D:\tmp): bộ chấm T1 cho OCR bất kỳ (t1-ocr.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { boxToPoly, scaleConf, ocrLines, queryFromOcr, ocrProblem, scoreImages, compareWithT1, sampleCodes, summaryRow } from "../t1-ocr.mjs";
import { buildBm25, t1QueryFromLines } from "../vn-data.mjs";
import { rowLines } from "../../web-ocr/lib.mjs";

const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

// danh mục nhỏ (giả, không phải dữ liệu OFF)
const DOCS = [
  { code: "111", text: "Mì Omachi khoai tây xốt bò hầm Omachi" },
  { code: "222", text: "Sữa tươi tiệt trùng Vinamilk" },
  { code: "333", text: "Lạp xưởng mai quế Vissan" },
];
const INFO = new Map([["111", { name: "Mì Omachi khoai tây", brands: "Omachi" }], ["222", { name: "Sữa tươi Vinamilk", brands: "Vinamilk" }], ["333", { name: "Lạp xưởng mai quế", brands: "Vissan" }]]);
const TRUTH = new Map([["111", { code: "111", ten: "Mì khoai tây Omachi", thuong_hieu: "Omachi" }], ["222", { code: "222", ten: "Sữa tươi tiệt trùng", thuong_hieu: "Vinamilk" }], ["333", { code: "333", ten: "Lạp xưởng mai quế", thuong_hieu: "Vissan" }]]);

test("đọc định dạng có khung: các khung cùng hàng nối bằng rowLines, trái sang phải, hàng trên xuống", () => {
  const ocr = { items: [
    { text: "QUẾ", conf: 0.9, box: box(300, 102, 380, 150) },
    { text: "VISSAN", conf: 0.99, box: box(100, 10, 300, 60) },
    { text: "LẠP XƯỞNG", conf: 0.8, box: box(10, 100, 150, 148) },
    { text: "MAI", conf: 0.7, box: box(160, 98, 290, 146) },
  ] };
  const lines = ocrLines(ocr);
  assert.deepEqual(lines.map((l) => l.text), ["VISSAN", "LẠP XƯỞNG MAI QUẾ"]);
  // đúng hàm rowLines của web-ocr (cách 1a)
  const poly = ocr.items.map((it) => ({ text: it.text, poly: boxToPoly(it.box) }));
  assert.deepEqual(lines.map((l) => l.text), rowLines(poly));
  // độ tin hàng = trung bình độ tin các khung
  assert.equal(lines[0].conf, 0.99);
  assert.ok(Math.abs(lines[1].conf - (0.8 + 0.7 + 0.9) / 3) < 1e-12);
});

test("đọc định dạng có khung: conf null giữ null (dòng vẫn dùng được), khung hỏng bị bỏ", () => {
  const lines = ocrLines({ items: [{ text: "OMACHI", conf: null, box: box(0, 0, 100, 40) }, { text: "RÁC", conf: 0.9, box: { minX: 1 } }] });
  assert.deepEqual(lines, [{ text: "OMACHI", conf: null }]);
  assert.deepEqual(queryFromOcr({ items: [{ text: "OMACHI", conf: null, box: box(0, 0, 100, 40) }] }), ["omachi"]);
});

test("đọc định dạng không khung (lines) và dạng cũ chỉ có text: câu tìm = t1QueryFromLines trên dòng của công cụ", () => {
  const lines = [{ text: "VISSAN", h: 83, conf: 0.99 }, { text: "LAP XUN MAI QUÊ", h: 344, conf: 0.95 }];
  assert.deepEqual(queryFromOcr({ status: "ok", lines }), t1QueryFromLines(lines));
  assert.deepEqual(queryFromOcr({ status: "ok", text: "VISSAN\nLAP XUN MAI QUÊ" }), ["vissan", "lap", "xun", "mai", "que"]);
});

test("thang độ tin: tesseract.js 0–100 chia 100 (52 -> 0,52 giữ; 40 -> 0,40 bỏ vì < MIN_CONF 0,5)", () => {
  assert.equal(scaleConf(52, 100), 0.52);
  assert.equal(scaleConf(null, 100), null);
  assert.equal(scaleConf("x", 100), null);
  const ocr = { status: "ok", lines: [{ text: "OMACHI", conf: 52 }, { text: "VINAMILK", conf: 40 }] };
  assert.deepEqual(queryFromOcr(ocr, 100), ["omachi"]);
  // sai thang (để 1) thì 40 bị coi là 40 ≥ 0,5 -> giữ: chứng tỏ thang có tác dụng
  assert.deepEqual(queryFromOcr(ocr, 1), ["omachi", "vinamilk"]);
  // dạng { lines } thang 100 (như tesseractjs cũ): chia 100 rồi mới lọc MIN_CONF
  const linesOnly = { lines: [{ text: "VISSAN", conf: 91 }, { text: "LẠP XƯỞNG", conf: 30 }] };
  assert.deepEqual(ocrLines(linesOnly, 100), [{ text: "VISSAN", conf: 0.91 }, { text: "LẠP XƯỞNG", conf: 0.3 }]);
  assert.deepEqual(queryFromOcr(linesOnly, 100), ["vissan"]);
  // có khung: conf cũng chia thang
  assert.deepEqual(queryFromOcr({ items: [{ text: "OMACHI", conf: 40, box: box(0, 0, 10, 10) }] }, 100), []);
});

test("ảnh thiếu / lỗi tính sai, mẫu số luôn đủ số mã", () => {
  assert.equal(ocrProblem(undefined), "thiếu file OCR");
  assert.match(ocrProblem({ status: "error: timeout" }), /OCR lỗi/);
  assert.match(ocrProblem({ error: "sập" }), /OCR lỗi/);
  assert.match(ocrProblem({ foo: 1 }), /định dạng lạ/);
  assert.equal(ocrProblem({ items: [] }), null);
  const ocrByCode = new Map([
    ["111", { status: "ok", lines: [{ text: "Omachi khoai tây", conf: 0.9 }] }],
    // 222 thiếu file
    ["333", { status: "lỗi: sập" }],
  ]);
  const r = scoreImages({ codes: ["111", "222", "333"], ocrByCode, index: buildBm25(DOCS), info: INFO, truthByCode: TRUTH });
  assert.equal(r.summary.n, 3);
  assert.equal(r.summary.top1, 1);
  assert.equal(r.summary.top5, 1);
  assert.equal(r.summary.errors, 2);
  assert.equal(r.summary.nameOk, 1);
  assert.equal(r.summary.brandOk, 1);
  assert.equal(r.items[1].status, "thiếu file OCR");
  assert.equal(r.items[1].inTop5, false);
  assert.equal(r.items[2].top1, false);
  assert.equal(summaryRow("x", r.summary), "| x | 1/3 | 1/3 | 1/3 | 1/3 | 2 |");
});

test("sampleCodes: mẫu số = mã của truth.csv có front.jpg, giữ thứ tự", () => {
  assert.deepEqual(sampleCodes([{ code: "1" }, { code: "2" }, { code: "3" }], (c) => c !== "2"), ["1", "3"]);
});

test("compareWithT1: trùng khi câu tìm + top5 giống, báo lệch đúng ảnh, ảnh lỗi cả hai bên là trùng", () => {
  const items = [
    { ma: "111", status: "ok", query: "omachi", top5: ["111"] },
    { ma: "222", status: "ok", query: "vinamilk", top5: ["222"] },
    { ma: "333", status: "thiếu file OCR" },
  ];
  const old = [
    { ma: "111", status: "ok", query: "omachi", top5: ["111"] },
    { ma: "222", status: "ok", query: "vinamilk sua", top5: ["222"] },
    { ma: "333", status: "OCR lỗi: x" },
  ];
  const c = compareWithT1(items, old);
  assert.equal(c.same, 2);
  assert.equal(c.total, 3);
  assert.deepEqual(c.diffs.map((d) => d.ma), ["222"]);
  const c2 = compareWithT1(items, old.slice(0, 1));
  assert.deepEqual(c2.diffs.map((d) => d.ma), ["222", "333"]);
});
