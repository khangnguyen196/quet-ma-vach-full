import test from "node:test";
import assert from "node:assert/strict";
import { mdRows, parseSummaryA, parseSummaryB, parseCsv, buildTable } from "../so-sanh.mjs";

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
    { tool: "p-c", sec_per_image_mean: "4.00", ws_peak_proc_mb: "700", net_mb_first_load: "12.0", backend: "wasm", images_ok: "96", images_error: "0" },
    { tool: "p-w", sec_per_image_mean: "5.00", ws_peak_proc_mb: "800", net_mb_first_load: "12.1", backend: "wasm", images_ok: "0", images_error: "0" },
  ];
  const t = buildTable({ A, B, metrics, engines: [{ name: "P", tools: { chromium: "p-c", webkit: "p-w" } }],
    others: [{ name: "E", tool: "easyocr", secs: "13.7", backend: "CPU" }] }).split("\n");
  assert.equal(t[2], "| P | 38% | 25% / 26% | 20% | 4.00 | 5.00 | 700 / 800 | 12.0 / 12.1 | wasm | Chromium: có (96 ok, 0 lỗi); WebKit: không |");
  assert.match(t[3], /^\| E \| 45% \| 31% \| 22% \| 13\.7 \(máy tính, không chạy trong trình duyệt\) \| không chạy trong trình duyệt \|/);
});
