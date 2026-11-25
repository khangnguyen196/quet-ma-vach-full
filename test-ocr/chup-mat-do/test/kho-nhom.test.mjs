// Test phần thuần của kho-nhom-do.mjs (đợt kho-nhom vòng 1) bằng số giả: chọn T, recall, luật đưa nhóm lên đầu, cổng
// A/B, phán ĐẠT / KHÔNG ĐẠT, dựng ca từ vector giả; RULE_SHA256 đúng khối luật. Không đọc ảnh / vector đo ở D:\tmp.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  RULE_SHA256, ruleBlockOf, sha256Of, pickThreshold, recallAt, applyNhom, gateAB, judge, productScores, topProduct,
  buildCases, quantileNR, T_GRID, MARGIN, P2_TRANSFORMS, REAL_CORRECT, MODEL_SHA256, ID_TABLE_SHA256,
  RULE_COMMIT, RULE_FILE, VEC_CODE_BASE, VEC_CODE_FILES, NEN_SHA256, GATE_CELLS, GATE_NOTE, EXIT_RULE,
  checkRuleAtCommit, checkVecMeta, checkNenSha, buildGateCells, dupAbOff,
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

// ---------------- vòng 2: ghim thêm cho --do (dữ liệu giả) ----------------
test("hằng ghim vòng 2", () => {
  assert.match(RULE_COMMIT, /^62dca69[0-9a-f]{33}$/);
  assert.equal(RULE_FILE, "test-ocr/chup-mat-do/kho-nhom-do.mjs");
  assert.match(VEC_CODE_BASE, /^[0-9a-f]{40}$/);
  assert.deepEqual({ ...VEC_CODE_FILES }, { vecPySha256: "test-ocr/chup-mat-do/kho-nhom-vec.py", clipEngineSha256: "server/clip_engine.py" });
  assert.match(NEN_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(GATE_CELLS, 136);
  assert.equal(EXIT_RULE, 3);
  assert.match(GATE_NOTE, /cổng đạt do cách dựng/);
});

test("(b) checkRuleAtCommit: khối luật ở commit luật khác → lỗi (thoát 3)", () => {
  assert.deepEqual(checkRuleAtCommit(self, self), []);
  // commit luật có khối khác (sửa 1 số) → sha khác RULE_SHA256 và khác khối hiện tại
  const errs = checkRuleAtCommit(self.replace("0,03", "0,02"), self);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /khác RULE_SHA256/);
  assert.match(errs[1], /khối luật hiện tại khác/);
  // khối hiện tại bị sửa (cùng lúc sửa hằng thì test cũ vẫn xanh; ở đây commit luật vẫn bắt)
  assert.match(checkRuleAtCommit(self, self.replace("0,03", "0,02")).join(), /khối luật hiện tại khác/);
  // git show lỗi (null) / không có khối
  assert.match(checkRuleAtCommit(null, self).join(), /không đọc được khối luật ở commit luật/);
  assert.match(checkRuleAtCommit("không có khối", self).join(), /không đọc được/);
});

test("(a) checkVecMeta: mã tính vector, p2Transforms, gitHead", () => {
  const pinned = { vecPySha256: "a".repeat(64), clipEngineSha256: "b".repeat(64) };
  const meta = { vecPySha256: pinned.vecPySha256, clipEngineSha256: pinned.clipEngineSha256, p2Transforms: [...P2_TRANSFORMS], gitHead: "c".repeat(40) };
  assert.deepEqual(checkVecMeta(meta, { pinned, diffEmpty: true, headIsAncestor: true }), []);
  assert.match(checkVecMeta(meta, { pinned, diffEmpty: false, headIsAncestor: true }).join(), /đã đổi từ mốc/);
  assert.match(checkVecMeta({ ...meta, clipEngineSha256: "d".repeat(64) }, { pinned, diffEmpty: true, headIsAncestor: true }).join(), /server\/clip_engine\.py khác bản ở mốc/);
  assert.match(checkVecMeta({ ...meta, vecPySha256: undefined }, { pinned, diffEmpty: true, headIsAncestor: true }).join(), /kho-nhom-vec\.py khác bản ở mốc/);
  assert.match(checkVecMeta(meta, { pinned: { ...pinned, clipEngineSha256: null }, diffEmpty: true, headIsAncestor: true }).join(), /không lấy được sha256/);
  assert.match(checkVecMeta({ ...meta, p2Transforms: [...P2_TRANSFORMS].reverse() }, { pinned, diffEmpty: true, headIsAncestor: true }).join(), /p2Transforms khác/);
  assert.match(checkVecMeta({ ...meta, p2Transforms: undefined }, { pinned, diffEmpty: true, headIsAncestor: true }).join(), /p2Transforms khác/);
  assert.match(checkVecMeta(meta, { pinned, diffEmpty: true, headIsAncestor: false }).join(), /không phải tổ tiên/);
  assert.match(checkVecMeta({ ...meta, gitHead: "HEAD; rm -rf" }, { pinned, diffEmpty: true, headIsAncestor: true }).join(), /gitHead sai dạng/);
  assert.deepEqual(checkNenSha(NEN_SHA256), []);
  assert.match(checkNenSha("0".repeat(64)).join(), /khác NEN_SHA256/);
  assert.match(checkNenSha(null).join(), /không đọc được/);
});

test("(b) khối luật ở commit luật thật (git show) trùng RULE_SHA256 và khối hiện tại", async (t) => {
  const cp = await import("node:child_process");
  let committed = null;
  try {
    committed = cp.execSync(`git show ${RULE_COMMIT}:${RULE_FILE}`, { cwd: new URL("../../..", import.meta.url), stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    t.skip("không có lịch sử git chứa commit luật (bản clone nông)");
    return;
  }
  assert.deepEqual(checkRuleAtCommit(committed, self), []);
});

/** Bảng + nền giả đủ 136 ô: 30 ảnh A/B (mã 1000…1029) + 8 ảnh thật REAL_CORRECT. */
function fakeGate() {
  const images = [];
  const perCase = {};
  for (let k = 0; k < 30; k++) {
    const code = String(1000 + k);
    images.push({ id: `ab-${code}`, nhom: "ab", sp: `ma:${code}`, sha256: sha256Of(`ab${k}`) });
    for (const s of ["A", "B"]) perCase[`${s}|${code}|anh`] = { may: { i: [code], ii: [code, "9"] } };
  }
  for (const n of REAL_CORRECT) {
    const code = String(5000 + n);
    images.push({ id: `that-${n}`, nhom: "that", sp: `ma:${code}` });
    perCase[`anh-${n}`] = { may: { i: [code], ii: [code] } };
  }
  for (let k = 0; k < 3; k++) images.push({ id: `off-${k}`, nhom: "off", sp: `ma:${7000 + k}`, sha256: sha256Of(`off${k}`) });
  return { table: { images }, nen: { perCase } };
}

test("(c) buildGateCells: đủ 136 ô; thiếu ô A/B → đếm + lỗi; thiếu perCase ảnh thật → lỗi, không TypeError", () => {
  const nhomOf = (id) => ({ sp: `nhom-${id}`, code: null, score: 0.1 });
  const { table, nen } = fakeGate();
  const ok = buildGateCells(table, nen, nhomOf);
  assert.equal(ok.cells.length, 136);
  assert.deepEqual(ok.unreadable, []);
  assert.deepEqual(ok.errors, []);
  assert.equal(gateAB(ok.cells, 0.5).pass, true);
  // 1 ảnh A/B không đọc được chữ ở bộ B → 2 ô thiếu, được đếm và báo
  const nen2 = structuredClone(nen);
  delete nen2.perCase["B|1003|anh"];
  const r2 = buildGateCells(table, nen2, nhomOf);
  assert.equal(r2.cells.length, 134);
  assert.deepEqual(r2.unreadable, ["B|1003|i", "B|1003|ii"]);
  assert.equal(r2.errors.length, 1);
  assert.match(r2.errors[0], /134 ô, luật ghi 136 .*2 ô A\/B không đọc được chữ: B\|1003\|i, B\|1003\|ii/);
  // thiếu 1 điều kiện của 1 ô
  const nen3 = structuredClone(nen);
  delete nen3.perCase["A|1000|anh"].may.ii;
  assert.deepEqual(buildGateCells(table, nen3, nhomOf).unreadable, ["A|1000|ii"]);
  // ảnh thật thiếu perCase → lỗi rõ, không văng TypeError
  const nen4 = structuredClone(nen);
  delete nen4.perCase["anh-7"];
  const r4 = buildGateCells(table, nen4, nhomOf);
  assert.ok(r4.errors.some((e) => /thiếu perCase ảnh thật anh-7 \(i\)/.test(e)));
  assert.ok(r4.errors.some((e) => /134 ô/.test(e)));
  // nền rỗng / null
  assert.match(buildGateCells(table, null, nhomOf).errors.join(), /16 ô|0 ô/);
  // bảng thiếu ảnh thật
  const t5 = { images: table.images.filter((x) => x.id !== "that-1") };
  assert.match(buildGateCells(t5, nen, nhomOf).errors.join(), /thiếu ảnh thật that-1/);
});

test("(d) dupAbOff: cặp file A/B trùng file OFF → danh sách mã", () => {
  const { table } = fakeGate();
  assert.deepEqual(dupAbOff(table), { pairs: [], errors: [] });
  const t2 = structuredClone(table);
  t2.images.find((x) => x.id === "off-1").sha256 = t2.images.find((x) => x.id === "ab-1004").sha256;
  assert.deepEqual(dupAbOff(t2).pairs, [{ ab: "ma:1004", off: "ma:7001" }]);
  const t3 = structuredClone(table);
  delete t3.images.find((x) => x.id === "off-0").sha256;
  assert.match(dupAbOff(t3).errors.join(), /ảnh off của ma:7000 thiếu sha256/);
});

test("quantileNR", () => {
  assert.equal(quantileNR([3, 1, 2, 4], 0.5), 2);
  assert.equal(quantileNR([3, 1, 2, 4], 0.9), 4);
  assert.equal(quantileNR([], 0.5), null);
});
