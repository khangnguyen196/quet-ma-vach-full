import test from "node:test";
import assert from "node:assert/strict";
import { mdRows, parseSummaryA, parseSummaryB, parseCsv, buildTable, secCell, judge, thresholdSection } from "../so-sanh.mjs";

const SUMMARY_A = `# Kết quả so sánh OCR

| Hạng | Công cụ | Điểm | % đầy đủ | Giây/ảnh (TB) | Ảnh lỗi | Ảnh bỏ qua (luật chi phí) |
|---|---|---|---|---|---|---|
| 1 | easyocr | 108.0 | 45% | 13.7 | 0 | 0 |
| 2 | paddlejs-webkit | 90.5 | 38% | 5.0 | 0 | 0 |

## Tỷ lệ đúng theo trường (%)

| Trường | easyocr | paddlejs-webkit |
|---|---|---|
| ten | 50 | 40 |`;

const SUMMARY_B = `| OCR \\ extractor | dict | llm | regex |
|---|---|---|---|
| easyocr | 22% | 37% | 31% |
| paddlejs-webkit | 20% | – | 25% |

| extractor | % đúng TB | giây/sản phẩm |
|---|---|---|
| dict | 17% | 0.01 |`;

test("đọc bảng phần A: chỉ bảng xếp hạng 7 cột", () => {
  assert.deepEqual(parseSummaryA(SUMMARY_A), { easyocr: { points: 108, pct: 45 }, "paddlejs-webkit": { points: 90.5, pct: 38 } });
  assert.equal(mdRows("| a | b |\n|---|---|\n| 1 | 2 |").length, 2);
});

test("đọc ma trận phần B: ô '–' là null, dừng ở bảng sau", () => {
  assert.deepEqual(parseSummaryB(SUMMARY_B), {
    easyocr: { dict: 22, llm: 37, regex: 31 },
    "paddlejs-webkit": { dict: 20, llm: null, regex: 25 },
  });
  assert.deepEqual(parseSummaryB("không có bảng"), {});
});

test("CSV có nháy kép", () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"x, ""y"""\r\n'), [{ a: "1", b: 'x, "y"' }]);
});

test("bảng so sánh: công cụ trình duyệt ghép Chromium / WebKit; công cụ máy chủ ghi 'không chạy trong trình duyệt'", () => {
  const A = { "p-c": { pct: 38 }, "p-w": { pct: 38 }, easyocr: { pct: 45 } };
  const B = { "p-c": { regex: 25, dict: 20 }, "p-w": { regex: 26, dict: 20 }, easyocr: { regex: 31, dict: 22 } };
  const metrics = [
    { tool: "p-c", sec_per_image_mean: "4.00", mem_peak_proc_mb: "650", ws_peak_proc_mb: "700", net_mb_first_load: "12.0", backend: "wasm", images_ok: "96", images_error: "0" },
    { tool: "p-w", sec_per_image_mean: "5.00", mem_peak_proc_mb: "5000", ws_peak_proc_mb: "800", net_mb_first_load: "12.1", backend: "wasm", images_ok: "0", images_error: "0" },
  ];
  const t = buildTable({ A, B, metrics, engines: [{ name: "P", tools: { chromium: "p-c", webkit: "p-w" } }],
    others: [{ name: "E", tool: "easyocr", secs: "13.7", backend: "CPU" }] }).split("\n");
  assert.equal(t[2], "| P | 38% | 25% / 26% | 20% | 4.00 | 5.00 | 650 / 700; 5000 / 800 | 12.0 / 12.1 | wasm | Chromium: có (96 ok, 0 lỗi); WebKit: không |");
  assert.match(t[3], /^\| E \| 45% \| 31% \| 22% \| 13\.7 \(máy tính, không chạy trong trình duyệt\) \| không chạy trong trình duyệt \|/);
});

test("ô giây/ảnh: TB (trung vị, p90) khi có, chỉ TB khi metrics cũ thiếu 2 cột", () => {
  assert.equal(secCell({ sec_per_image_mean: "6.92", sec_per_image_median: "5.10", sec_per_image_p90: "12.30" }), "6.92 (TV 5.10, p90 12.30)");
  assert.equal(secCell({ sec_per_image_mean: "6.92" }), "6.92");
  assert.equal(secCell({}), "–");
});

test("judge: đạt / sát ngưỡng (cách <= 15%) / không đạt / thiếu số, trên cả 2 trình duyệt", () => {
  assert.deepEqual(judge([36, 37], 30, "min"), { status: "đạt", near: [] });
  assert.deepEqual(judge([19, 31], 30, "min"), { status: "không đạt", near: ["Chromium"] });
  assert.deepEqual(judge([5.8, 9.2], 10, "max"), { status: "sát ngưỡng", near: ["WebKit"] });
  assert.deepEqual(judge([5.8, 11.7], 10, "max"), { status: "không đạt", near: ["WebKit"] });
  assert.deepEqual(judge([10, 8.4], 10, "max"), { status: "sát ngưỡng", near: ["Chromium"] }); // đúng bằng ngưỡng vẫn đạt
  assert.deepEqual(judge([18.1, null], 20, "max"), { status: "thiếu số", near: [] });
});

test("đoạn đánh giá theo ngưỡng sinh từ số liệu", () => {
  const md = thresholdSection([
    { name: "P rows", bRegex: [36, 37], secs: ["5.80", "9.20"], mb: ["18.1", "17.4"] },
    { name: "P", bRegex: [19, 20], secs: ["6.92", "11.70"], mb: ["18.1", "17.4"] },
    { name: "T", bRegex: [10, 10], secs: ["1.54", "2.47"], mb: ["5.8", "5.8"] },
  ]).split("\n");
  assert.match(md[0], /^## Đánh giá theo ngưỡng/);
  assert.equal(md[6], "| P rows | 36% / 37%: đạt | 5.8 / 9.2: sát ngưỡng (WebKit) | 18.1 / 17.4: sát ngưỡng (Chromium, WebKit) | đạt, sát ngưỡng: giây/ảnh WebKit; tải lần đầu Chromium, WebKit |");
  assert.equal(md[7], "| P | 19% / 20%: không đạt (Chromium, WebKit) | 6.92 / 11.7: không đạt (WebKit) | 18.1 / 17.4: sát ngưỡng (Chromium, WebKit) | không đạt (B regex, giây/ảnh) |");
  assert.equal(md[8], "| T | 10% / 10%: không đạt (Chromium, WebKit) | 1.54 / 2.47: đạt | 5.8 / 5.8: đạt | không đạt (B regex) |");
});
