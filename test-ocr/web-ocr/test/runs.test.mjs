import test from "node:test";
import assert from "node:assert/strict";
import * as lib from "../lib.mjs";

test("shouldWriteRun: không ghi đè runs/<công cụ>-<mode>.json bằng lần chạy không đọc ảnh nào vì ảnh đã có hết", () => {
  assert.equal(typeof lib.shouldWriteRun, "function", "lib.mjs chưa có shouldWriteRun");
  assert.equal(lib.shouldWriteRun({ ok: 0, skippedExisting: 96, errors: 0 }), false);
  assert.equal(lib.shouldWriteRun({ ok: 96, skippedExisting: 0, errors: 0 }), true);
  assert.equal(lib.shouldWriteRun({ ok: 3, skippedExisting: 93, errors: 0 }), true); // có đọc ảnh: vẫn ghi, report() ghi chú
  assert.equal(lib.shouldWriteRun({ ok: 0, skippedExisting: 0, errors: 1, initError: "x" }), true); // lỗi nạp: ghi để biết
  assert.equal(lib.shouldWriteRun({ ok: 1, skippedExisting: 0, errors: 0 }), true); // mode cdn --limit 1
});

test("metricsNotes: ghi chú khi lần chạy được dùng có ảnh bị bỏ qua (số bộ nhớ / giây nạp chỉ của phần đọc lần đó)", () => {
  assert.equal(typeof lib.metricsNotes, "function", "lib.mjs chưa có metricsNotes");
  const notes = lib.metricsNotes({ local: { ok: 3, skippedExisting: 93, crashes: 0 }, cdn: null });
  assert.match(notes, /bỏ qua 93 ảnh đã có/);
  assert.equal(lib.metricsNotes({ local: { ok: 96, skippedExisting: 0, crashes: 0 }, cdn: { network: { failed: [] } } }), "");
});
