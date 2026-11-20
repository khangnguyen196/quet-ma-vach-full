// Test phần thuần của lens-js-ref.mjs (đợt lens): chọn ngẫu nhiên có seed (cố định, không phụ thuộc thứ tự vào), ghi
// .npy đọc lại được bằng parseNpy của lens-do.mjs. Không gọi mạng, không nạp model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seededPick, toNpy, REF_MODELS } from "../lens-js-ref.mjs";
import { parseNpy } from "../lens-do.mjs";

test("seededPick: cố định theo seed, không phụ thuộc thứ tự danh sách, không trùng", () => {
  const list = Array.from({ length: 50 }, (_, i) => `f${i}.400.jpg`);
  const a = seededPick(list, 10);
  assert.deepEqual(a, seededPick([...list].reverse(), 10));
  assert.equal(new Set(a).size, 10);
  assert.notDeepEqual(a, seededPick(list, 10, 1));
});

test("toNpy → parseNpy giữ nguyên số và shape (1 chiều / 2 chiều)", () => {
  for (const shape of [[3], [2, 3], [1, 3, 2, 2]]) {
    const n = shape.reduce((x, y) => x * y, 1);
    const data = Array.from({ length: n }, (_, i) => i / 7 - 1);
    const r = parseNpy(toNpy(data, shape));
    assert.deepEqual(r.shape, shape);
    assert.deepEqual([...r.data], data.map((x) => Math.fround(x)));
  }
  assert.deepEqual(Object.keys(REF_MODELS), ["clip-fp32", "clip-int8", "siglip", "dinov2-small"]);
});
