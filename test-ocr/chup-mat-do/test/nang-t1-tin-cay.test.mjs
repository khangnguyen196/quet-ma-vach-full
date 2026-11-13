// Test luật chọn ngưỡng "chắc chắn" (vòng 3, cách e) của nang-t1-tin-cay.mjs: dữ liệu dựng tay, không đọc D:\tmp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateThresholds, evalThreshold, betterThreshold, chooseRule, reportRule, FEATURES } from "../nang-t1-tin-cay.mjs";
import { CONFIDENCE_FEATURES, confidenceValues } from "../../../src/front-rank.js";

/** Dòng có cùng một giá trị cho mọi đặc trưng (trừ khi ghi đè). */
const row = (rank, v, over = {}) => ({ rank, values: { top1: v, gap: v, norm: v, rel: v, ...over } });

test("FEATURES trùng thứ tự CONFIDENCE_FEATURES của src/front-rank.js (F1 top1, F2 gap, F3 norm, F4 rel)", () => {
  assert.deepEqual(FEATURES, [...CONFIDENCE_FEATURES]);
  assert.deepEqual(FEATURES, ["top1", "gap", "norm", "rel"]);
});

test("confidenceValues: gap = top1 − top2 (thiếu top2 = 0), norm = top1 / idfSum, rel = gap / top1", () => {
  assert.deepEqual(confidenceValues({ top1: 10, top2: 4, idfSum: 20 }), { top1: 10, gap: 6, norm: 0.5, rel: 0.6 });
  assert.deepEqual(confidenceValues({ top1: 8, top2: null, idfSum: 0 }), { top1: 8, gap: 8, norm: 0, rel: 1 });
});

test("candidateThresholds: điểm giữa các cặp giá trị liên tiếp khác nhau (bỏ trùng, bỏ null)", () => {
  assert.deepEqual(candidateThresholds([3, 1, 3, null, 2, NaN]), [1.5, 2.5]);
  assert.deepEqual(candidateThresholds([5, 5]), []);
});

test("evalThreshold: confident = giá trị ≥ ngưỡng; precision 0,9 so đúng (9/10 đạt, 8/9 không)", () => {
  const rows = [...Array(9)].map(() => ({ rank: 1, value: 10 })).concat([{ rank: 2, value: 10 }, { rank: null, value: null }]);
  const e = evalThreshold(rows, 5);
  assert.deepEqual({ c: e.confident, k: e.correct, ok: e.ok, top1: e.top1 }, { c: 10, k: 9, ok: true, top1: 9 });
  const r2 = [...Array(8)].map(() => ({ rank: 1, value: 10 })).concat([{ rank: 3, value: 10 }]);
  assert.equal(evalThreshold(r2, 5).ok, false);
  assert.equal(evalThreshold(r2, 50).ok, false); // không có confident
});

test("chooseRule: chọn đúng (recall lớn nhất; bằng recall thì precision lớn hơn)", () => {
  // 10 dòng đúng giá trị 10..19, 5 dòng sai giá trị 1..5
  const rows = [...Array(10)].map((_, i) => row(1, 10 + i)).concat([1, 2, 3, 4, 5].map((v) => row(null, v)));
  const c = chooseRule(rows, { minRecallCount: 6 });
  assert.equal(c.separable, true);
  assert.deepEqual(c.rule, { feature: "top1", threshold: 7.5 }); // 4,5 cũng đạt (10/11) nhưng precision thấp hơn
  assert.equal(c.best.top1.correct, 10);
  assert.equal(c.best.top1.confident, 10);
});

test("chooseRule: giữa các đặc trưng lấy recall lớn hơn; bằng recall thì đặc trưng đứng trước (F1 → F4)", () => {
  // gap tách được 8 ca đúng, top1 chỉ 7 (1 ca đúng có top1 thấp)
  const rows = [
    ...[...Array(7)].map((_, i) => row(1, 10 + i)),
    row(1, 2, { gap: 12, norm: 12, rel: 12 }),
    ...[1, 3, 4].map((v) => row(2, v)),
  ];
  const c = chooseRule(rows, { minRecallCount: 6 });
  assert.equal(c.rule.feature, "gap"); // gap và norm, rel cùng recall 8 → gap (đứng trước)
  assert.equal(c.best.top1.correct, 7);
  assert.equal(c.best.gap.correct, 8);
  // mọi đặc trưng như nhau → top1
  const same = [...Array(7)].map((_, i) => row(1, 10 + i)).concat([row(2, 1)]);
  assert.equal(chooseRule(same, { minRecallCount: 6 }).rule.feature, "top1");
});

test("betterThreshold: recall → precision → ngưỡng lớn hơn khi bằng cả hai", () => {
  const T = (threshold, correct, confident) => ({ threshold, correct, confident });
  assert.equal(betterThreshold(T(1, 8, 9), T(2, 7, 7)), true); // recall hơn
  assert.equal(betterThreshold(T(1, 8, 9), T(2, 8, 8)), false); // cùng recall, precision thấp hơn
  assert.equal(betterThreshold(T(3, 8, 8), T(2, 8, 8)), true); // bằng cả hai → ngưỡng lớn hơn
  assert.equal(betterThreshold(T(2, 8, 8), T(3, 8, 8)), false);
  assert.equal(betterThreshold(T(2, 8, 8), null), true);
});

test("chooseRule: không tách được → luôn không chắc (recall < 6, hoặc không ngưỡng nào đạt precision 0,9)", () => {
  // tách sạch nhưng chỉ 5 ca đúng
  const few = [...Array(5)].map((_, i) => row(1, 10 + i)).concat([row(2, 1), row(2, 2)]);
  const a = chooseRule(few, { minRecallCount: 6 });
  assert.equal(a.separable, false);
  assert.deepEqual(a.rule, { feature: null, threshold: null });
  assert.match(a.reason, /không tách được.*5\/5/);
  // xen kẽ đúng / sai: không ngưỡng nào precision ≥ 0,9
  const mixed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => row(v % 2 ? 1 : 3, v));
  const b = chooseRule(mixed, { minRecallCount: 1 });
  assert.equal(b.separable, false);
  assert.equal(b.rule.feature, null);
  // reportRule với luật luôn không chắc: 0 confident
  assert.deepEqual(reportRule(mixed, b.rule), { confident: 0, correct: 0, top1: 5, precision: null, recall: 0, n: 10 });
});
