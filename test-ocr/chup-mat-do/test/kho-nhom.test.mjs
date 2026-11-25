// Test phần thuần của kho-nhom-do.mjs (đợt kho-nhom vòng 1) bằng số giả: chọn T, recall, luật đưa nhóm lên đầu, cổng
// A/B, phán ĐẠT / KHÔNG ĐẠT, dựng ca từ vector giả; RULE_SHA256 đúng khối luật. Không đọc ảnh / vector đo ở D:\tmp.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  RULE_SHA256, ruleBlockOf, sha256Of, pickThreshold, recallAt, applyNhom, gateAB, judge, productScores, topProduct,
  buildCases, quantileNR, T_GRID, MARGIN, P2_TRANSFORMS, REAL_CORRECT, MODEL_SHA256, ID_TABLE_SHA256,
} from "../kho-nhom-do.mjs";

const self = fs.readFileSync(new URL("../kho-nhom-do.mjs", import.meta.url), "utf8");

test("RULE_SHA256 = sha256 khối luật của file hiện tại", () => {
  const block = ruleBlockOf(self);
  assert.ok(block && block.includes("LUẬT CHỐT TRƯỚC") && block.includes("HẾT KHỐI LUẬT"));
  assert.equal(sha256Of(block), RULE_SHA256);
  assert.match(RULE_SHA256, /^[0-9a-f]{64}$/);
  // sửa 1 ký tự trong khối → sha khác
  assert.notEqual(sha256Of(block.replace("0,03", "0,02")), RULE_SHA256);
  assert.equal(ruleBlockOf("không có dấu"), null);
});

test("hằng số luật", () => {
  assert.equal(T_GRID.length, 99);
  assert.equal(T_GRID[0], 0.5);
  assert.equal(T_GRID.at(-1), 0.99);
  assert.equal(MARGIN, 0.03);
  assert.equal(P2_TRANSFORMS.length, 9);
  assert.deepEqual([...REAL_CORRECT], [1, 3, 6, 7, 8, 9, 12, 13]);
  assert.match(MODEL_SHA256, /^[0-9a-f]{64}$/);
  assert.match(ID_TABLE_SHA256, /^[0-9a-f]{64}$/);
});

test("pickThreshold: T nhỏ nhất của lưới ≥ max s_neg + 0,03", () => {
  assert.equal(pickThreshold(0.7), 0.73);
  assert.equal(pickThreshold(0.701), 0.735);
  assert.equal(pickThreshold(0.705), 0.735);
  assert.equal(pickThreshold(0.2), 0.5); // dưới đáy lưới → 0,50
  assert.equal(pickThreshold(0.96), 0.99);
  assert.equal(pickThreshold(0.9601), null); // cần 0,9901 > 0,99
  assert.equal(pickThreshold(0.99), null);
  assert.equal(pickThreshold(NaN), null);
  assert.equal(pickThreshold(-Infinity), null);
  assert.equal(pickThreshold(undefined), null);
});

test("productScores / topProduct: điểm sản phẩm = max ảnh, bỏ ảnh / sản phẩm", () => {
  const row = [0.5, 0.9, 0.7, 0.9];
  const sp = ["b", "a", "b", "c"];
  assert.deepEqual(productScores(row, sp), [{ sp: "a", score: 0.9 }, { sp: "c", score: 0.9 }, { sp: "b", score: 0.7 }]);
  assert.deepEqual(topProduct(row, sp, { skipSp: new Set(["a"]) }), { sp: "c", score: 0.9 });
  assert.deepEqual(topProduct(row, sp, { skipIdx: new Set([1, 3]) }), { sp: "b", score: 0.7 });
  assert.equal(topProduct([], []), null);
});

test("recallAt: trúng = đúng sản phẩm VÀ điểm ≥ T", () => {
  const pos = [
    { sp: "a", top: { sp: "a", score: 0.8 } },
    { sp: "b", top: { sp: "a", score: 0.95 } }, // sai sản phẩm
    { sp: "c", top: { sp: "c", score: 0.7 } }, // dưới T
    { sp: "d", top: null },
  ];
  assert.deepEqual(recallAt(pos, 0.75), { n: 4, hit: 1, recall: 0.25 });
  assert.deepEqual(recallAt(pos, 0.7), { n: 4, hit: 2, recall: 0.5 });
  assert.deepEqual(recallAt(pos, null), { n: 4, hit: 0, recall: 0 });
  assert.deepEqual(recallAt([], 0.5), { n: 0, hit: 0, recall: 0 });
});

test("applyNhom: ≥ T thì món nhóm vào vị trí 1, < T / Infinity không đổi", () => {
  const m = ["1", "2", "3", "4", "5"].map((code) => ({ code }));
  assert.equal(applyNhom(m, { sp: "ma:9", code: "9", score: 0.7 }, 0.8), m);
  assert.equal(applyNhom(m, { sp: "ma:9", code: "9", score: 0.99 }, Infinity), m);
  assert.equal(applyNhom(m, null, 0.5), m);
  const r = applyNhom(m, { sp: "ma:9", code: "9", score: 0.8 }, 0.8);
  assert.deepEqual(r.map((x) => x.code), ["9", "1", "2", "3", "4"]);
  assert.equal(r[0].source, "nhom");
  // trùng mã: bỏ mục cũ
  assert.deepEqual(applyNhom(m, { sp: "ma:3", code: "3", score: 0.9 }, 0.8).map((x) => x.code), ["3", "1", "2", "4", "5"]);
  // món nhóm không mã
  assert.deepEqual(applyNhom(m, { sp: "nhin:x", code: null, score: 0.9 }, 0.8).map((x) => x.code), [null, "1", "2", "3", "4"]);
});

test("gateAB: ô mất vị trí 1 khi nền đúng mà nhóm chen lên", () => {
  const cells = [
    { id: "x", code: "1", base: ["1", "2"], nhom: { sp: "ma:9", code: "9", score: 0.9 } }, // mất
    { id: "y", code: "1", base: ["2", "1"], nhom: { sp: "ma:9", code: "9", score: 0.9 } }, // nền vốn sai: không tính
    { id: "z", code: "1", base: ["1"], nhom: { sp: "ma:9", code: "9", score: 0.5 } }, // dưới T
  ];
  assert.deepEqual(gateAB(cells, 0.8), { cells: 3, lost: ["x"], pass: false });
  assert.deepEqual(gateAB(cells, 0.95), { cells: 3, lost: [], pass: true });
  assert.deepEqual(gateAB(cells, Infinity), { cells: 3, lost: [], pass: true });
  assert.equal(gateAB([], 0.8).pass, false);
});

test("judge: ĐẠT / KHÔNG ĐẠT bằng số giả", () => {
  const gateOk = { cells: 136, lost: [], pass: true };
  const p2 = { n: 198, hit: 150, recall: 150 / 198 };
  // đạt
  let v = judge({ T: 0.8, p1: { n: 15, hit: 8, recall: 8 / 15 }, p2, gate: gateOk });
  assert.deepEqual(v, { pass: true, estimateOnly: false, threshold: 0.8, fails: [] });
  // recall P1 < 50 %
  v = judge({ T: 0.8, p1: { n: 15, hit: 7, recall: 7 / 15 }, p2, gate: gateOk });
  assert.equal(v.pass, false);
  assert.equal(v.threshold, Infinity);
  // không có T
  v = judge({ T: null, p1: { n: 15, hit: 15, recall: 1 }, p2, gate: gateOk });
  assert.equal(v.pass, false);
  assert.equal(v.threshold, Infinity);
  // n P1 < 4 → xét P2, chỉ ước lượng
  v = judge({ T: 0.8, p1: { n: 3, hit: 0, recall: 0 }, p2, gate: gateOk });
  assert.deepEqual(v, { pass: true, estimateOnly: true, threshold: 0.8, fails: [] });
  v = judge({ T: 0.8, p1: { n: 3, hit: 3, recall: 1 }, p2: { n: 10, hit: 6, recall: 0.6 }, gate: gateOk });
  assert.equal(v.pass, false);
  assert.equal(v.estimateOnly, true);
  // cổng A/B trượt
  v = judge({ T: 0.8, p1: { n: 15, hit: 15, recall: 1 }, p2, gate: { cells: 136, lost: ["B|1|i"], pass: false } });
  assert.equal(v.pass, false);
  assert.equal(v.threshold, Infinity);
  // biên: đúng 50 %
  v = judge({ T: 0.8, p1: { n: 4, hit: 2, recall: 0.5 }, p2, gate: gateOk });
  assert.equal(v.pass, true);
});

test("buildCases: ca âm bỏ cùng sản phẩm, P1 kho đủ, P2 so chính ảnh gốc khi sản phẩm chỉ có 1 ảnh", () => {
  const e = (k) => Array.from({ length: 4 }, (_, i) => (i === k ? 1 : 0));
  const mix = (a, b, t) => { const v = a.map((x, i) => x * (1 - t) + b[i] * t); const n = Math.hypot(...v); return v.map((x) => x / n); };
  const table = { images: [
    { id: "that-1", nhom: "that", sp: "ma:1" },
    { id: "that-2", nhom: "that", sp: "ma:2" },
    { id: "that-3", nhom: "that", sp: "nhin:x" },
    { id: "ab-1", nhom: "ab", sp: "ma:1" },
    { id: "ab-9", nhom: "ab", sp: "ma:9" },
    { id: "off-2", nhom: "off", sp: "ma:2" },
  ] };
  const vec = { "that-1": e(0), "that-2": e(1), "that-3": e(2), "ab-1": mix(e(0), e(1), 0.3), "ab-9": mix(e(2), e(3), 0.5), "off-2": mix(e(1), e(0), 0.2) };
  const p2 = Object.fromEntries(["that-1", "that-2", "that-3"].map((id) => [id, Object.fromEntries(P2_TRANSFORMS.map((t) => [t, vec[id]]))]));
  const cs = buildCases(table, vec, p2);
  assert.equal(cs.neg.length, 5); // 3 thật + 2 A/B
  const negAb1 = cs.neg.find((x) => x.id === "ab-1");
  assert.equal(negAb1.top.sp, "ma:2"); // ma:1 bị bỏ
  assert.notEqual(cs.neg.find((x) => x.id === "that-1").top.sp, "ma:1");
  assert.deepEqual(cs.p1.map((x) => x.id).sort(), ["ab-1", "off-2"]);
  assert.equal(cs.p1.find((x) => x.id === "ab-1").top.sp, "ma:1");
  assert.equal(cs.p2.length, 3 * P2_TRANSFORMS.length);
  assert.ok(cs.p2.every((x) => x.selfCompare && x.top.sp === x.sp && Math.abs(x.top.score - 1) < 1e-12));
  assert.deepEqual(cs.nhomOf("ab-1").sp, "ma:2");
  assert.equal(cs.nhomOf("ab-1").code, "2");
  assert.throws(() => buildCases(table, { ...vec, "that-2": undefined }, p2), /thiếu vector ảnh kho/);
  assert.throws(() => buildCases(table, vec, {}), /thiếu vector P2/);
});

test("quantileNR", () => {
  assert.equal(quantileNR([3, 1, 2, 4], 0.5), 2);
  assert.equal(quantileNR([3, 1, 2, 4], 0.9), 4);
  assert.equal(quantileNR([], 0.5), null);
});
