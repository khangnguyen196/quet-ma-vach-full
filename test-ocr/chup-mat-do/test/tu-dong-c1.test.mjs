// Test phần thuần của tu-dong-c1-do.mjs (đợt tu-dong vòng 6, P5.3): phán theo điều kiện chốt trước của chủ dự án.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeC1, median, ACCEPTED_OUT5, MOC_V5 } from "../tu-dong-c1-do.mjs";

const none = { lostTop1: [], out5: [] };
const full = (over = {}) => {
  const t = {};
  for (const s of ["B", "A"]) for (const c of ["i", "ii"]) t[`${s}-${c}`] = { vsA: none, vsB: none };
  return { ...t, ...over };
};

test("danh sách chấp nhận + mốc vòng 5 đúng quyết định chủ dự án", () => {
  assert.deepEqual([...ACCEPTED_OUT5.B], ["8936012061321", "8936221043071"]);
  assert.deepEqual([...ACCEPTED_OUT5.A], ["8936012061321", "8936221043071", "8936045081310"]);
  assert.deepEqual({ ...MOC_V5 }, { lockTop: 3, offMax: 1, offGap: 1, offTopRule: null, offPromote: null, strangeFill: false });
});

test("judgeC1: không mất, rơi trong danh sách → đạt", () => {
  const t = full({ "B-i": { vsA: { lostTop1: [], out5: ["8936012061321"] }, vsB: { lostTop1: [], out5: ["8936221043071"] } },
    "A-ii": { vsA: none, vsB: { lostTop1: [], out5: ["8936045081310"] } } });
  assert.deepEqual(judgeC1(t), { ok: true, lostTop1: [], out5Bad: [] });
});

test("judgeC1: mất vị trí 1 (so (a) hoặc (b)) → không đạt; rơi ngoài danh sách (8936045081310 ở bộ B) → không đạt", () => {
  assert.equal(judgeC1(full({ "A-i": { vsA: none, vsB: { lostTop1: ["x"], out5: [] } } })).ok, false);
  const r = judgeC1(full({ "B-ii": { vsA: { lostTop1: [], out5: ["8936045081310"] }, vsB: none } }));
  assert.deepEqual(r, { ok: false, lostTop1: [], out5Bad: ["B-ii 8936045081310"] });
  assert.equal(judgeC1({}).ok, false, "thiếu số → không đạt");
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});
