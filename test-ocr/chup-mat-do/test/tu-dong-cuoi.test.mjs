// Test phần thuần của tu-dong-cuoi-do.mjs (đợt tu-dong vòng 7, P2): phán theo luật chốt trước của khung đo cuối.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeFinal, V6_COL2, MAIN_COL0 } from "../tu-dong-cuoi-do.mjs";

const none = { lostTop1: [], out5: [] };
const good = (over = {}) => {
  const loss = {};
  const counts = {};
  for (const s of ["B", "A"]) for (const c of ["i", "ii"]) { loss[`${s}-${c}`] = none; counts[`${s}-${c}`] = { ...V6_COL2[s] }; }
  return {
    loss, counts,
    s7: { "may-i": 4, "may-ii": 4, "go-i": 4, "go-ii": 4 },
    salt: { i: { top1: "4018077712999", kind: "open", confirmBox: true }, ii: { top1: null, kind: "none", confirmBox: false } },
    ...over,
  };
};

test("hằng: số vòng 6 cột (2) và mốc main 8ec74c2", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(V6_COL2)), { B: { top1: 14, top5: 19 }, A: { top1: 13, top5: 19 } });
  assert.deepEqual(JSON.parse(JSON.stringify(MAIN_COL0)), { B: { top1: 14, top5: 21 }, A: { top1: 13, top5: 22 } });
});

test("đủ luật → đạt", () => {
  assert.deepEqual(judgeFinal(good()), { ok: true, fails: [] });
  const r = good();
  r.loss["B-i"] = { lostTop1: [], out5: ["8936012061321", "8936221043071"] };
  r.loss["A-ii"] = { lostTop1: [], out5: ["8936045081310"] };
  assert.equal(judgeFinal(r).ok, true, "rơi khỏi 5 trong danh sách chấp nhận");
});

test("L1 mất vị trí 1 / L2 rơi ngoài danh sách (8936045081310 ở bộ B) → không đạt", () => {
  const a = good();
  a.loss["A-i"] = { lostTop1: ["x"], out5: [] };
  assert.equal(judgeFinal(a).ok, false);
  const b = good();
  b.loss["B-ii"] = { lostTop1: [], out5: ["8936045081310"] };
  assert.deepEqual(judgeFinal(b).fails, ["L2 B-ii: rơi khỏi 5 ngoài danh sách 8936045081310"]);
});

test("L3 7Up Diet ngoài 5 ở 1 ca → không đạt", () => {
  for (const k of ["may-i", "may-ii", "go-i", "go-ii"]) {
    const r = good();
    r.s7 = { ...r.s7, [k]: null };
    assert.equal(judgeFinal(r).ok, false, k);
  }
});

test("L4 muối: mục 1 là mã muối giả, hoặc 'open' không khung xác nhận → không đạt", () => {
  const a = good();
  a.salt.i = { top1: "8934673218368", kind: "open", confirmBox: true };
  assert.equal(judgeFinal(a).ok, false);
  const b = good();
  b.salt.ii = { top1: "1", kind: "open", confirmBox: false };
  assert.equal(judgeFinal(b).ok, false);
});

test("L5 số cột (2) lệch vòng 6 hoặc thiếu số → không đạt", () => {
  const a = good();
  a.counts["B-i"] = { top1: 14, top5: 20 };
  assert.equal(judgeFinal(a).ok, false);
  assert.equal(judgeFinal({}).ok, false);
});
