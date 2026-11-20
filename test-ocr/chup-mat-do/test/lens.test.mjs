// Test phần thuần của lens-do.mjs (đợt lens vòng 1): RRF có trọng số, tầng máy chủ S0–S3, tầng app A0–A2 (A1 vượt
// lockTop, tính vào offMax), ngưỡng "không chắc" U (phân vị không dùng nhãn), R1 tính "không chắc" = mất vị trí 1,
// ca không có ảnh (7Up) nhánh ảnh tắt = nền, chống ăn gian (cùng imgid / mã băm gần → loại), chọn model, cổng dừng sớm,
// mục tiêu M1–M3 + chỉ để tham khảo, đọc .npy, tự kiểm sha256 khối luật. Mỗi luật có chuỗi / mẫu sai chứng minh test bắt
// được. Dữ liệu giả + danh mục / kho phụ thật của app; không gọi mạng, không đọc dữ liệu đo ở D:\tmp.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import * as fr from "../../../src/front-rank.js";
import { serverMerge, serverCandidates } from "../../../src/front-server.js";
import { ruleBlockOf, sha256Of } from "../g2-di-qua-do.mjs";
import { mergeLocal, BASE_PARAMS } from "../khau-gop-do.mjs";
import {
  rrfFuse, serverTier, imageRank, lensOf, isUnsureU, appTier, cellOf, judgeR, targetsM, achieves, pickMethod, pickModel,
  earlyGate, chooseSubstitute, parseNpy, percentiles, methodGrid, selfCheck, modeOf, qidOf, indexBytesInt8,
  RULE_SHA256, RULE_SHA, RULE_FILE, METHOD_COUNT, GOOD_IMGS, BULDAK_CODE, R7_MAX_BYTES, HASH_OK_MIN, S_GRID,
} from "../lens-do.mjs";
import { execSync } from "node:child_process";

const SRC = fs.readFileSync(new URL("../lens-do.mjs", import.meta.url), "utf8");
const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const products = read("../../../public/chup-mat-do/danh-muc-vn.json").products;
const extra = read("../../../public/chup-mat-do/kho-phu-893.json").products;
const rIndex = fr.buildRankIndex(t1, products);
const xIndex = fr.buildRankIndex(t1, extra);
const ctx = { t1, rIndex, products };
const NET = { ok: false, kind: "network" };
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));
const codes = (l) => l.map((x) => x.code);
function serverS(lines) {
  const r = fr.rankFromItems(t1, xIndex, itemsOf(lines), 10);
  return serverCandidates({ candidates: r.hits.map((h) => { const p = extra[h.i]; return { code: p.code, name: p.name, brand: p.brand ?? "", img: p.img ?? "", text: p.text, grp: "893", score: h.score }; }) });
}
const caseOf = (lines) => ({ found: fr.rankFromItems(t1, rIndex, itemsOf(lines)), off: { i: NET, ii: NET }, called: true });

test("khối luật: sha256 trùng RULE_SHA256; đổi 1 ký tự → tự kiểm đỏ (thử đỏ / xanh)", () => {
  const block = ruleBlockOf(SRC);
  assert.ok(block && block.includes("LUẬT CHỐT TRƯỚC") && block.includes("HẾT KHỐI LUẬT"));
  assert.equal(sha256Of(block), RULE_SHA256);
  assert.equal(selfCheck({ now: block, old: null, dirty: false }, { ruleSha: null }).exitCode, 0);
  const bad = block.replace("R1 60 ảnh", "R1 61 ảnh");
  assert.notEqual(bad, block);
  assert.equal(selfCheck({ now: bad, old: null, dirty: false }, { ruleSha: null }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: null, dirty: true }, { ruleSha: null }).exitCode, 3, "worktree bẩn → không đo");
  assert.equal(selfCheck({ now: block, old: bad, dirty: false }, { ruleSha: "abc1234" }).exitCode, 3, "khác từng byte commit luật");
  assert.equal(selfCheck({ now: block, old: block, dirty: false }, { ruleSha: "abc1234" }).exitCode, 0);
  // khối luật hiện tại trùng từng byte commit luật (git show; không có git thì bỏ qua phần này)
  let old = null;
  try { old = ruleBlockOf(execSync(`git show ${RULE_SHA}:${RULE_FILE}`, { cwd: new URL("../../..", import.meta.url), stdio: ["ignore", "pipe", "ignore"] }).toString("utf8")); } catch { old = null; }
  if (old !== null) assert.equal(old, block, `khối luật khác commit ${RULE_SHA}`);
  assert.equal(modeOf(["--do"]), "do");
  assert.equal(modeOf(["--do", "--cong"]), null);
});

test("khối luật đủ nội dung bắt buộc (P1e) và không chứa mã nhãn / tên file ảnh thật", () => {
  const block = ruleBlockOf(SRC);
  for (const s of ["S0", "S1", "S2-w", "S3-k", "A0", "A1-τ-μ", "A2-w", "U-sim", "U-gap", "U-simchu", "U-or", "R1", "R2", "R3", "R4", "R5", "R6", "R7",
    "M1", "M2", "M3", "G1", "G2", "G3", "9.512", "CLIP", "SigLIP", "DINOv2", "MobileCLIP", "cat", "vien", "int8", "chỉ để tham khảo", "n nhỏ"]) {
    assert.ok(block.includes(s), `thiếu ${s}`);
  }
  assert.doesNotMatch(SRC, /1795\d{9}/, "không có tên file ảnh thật");
  assert.equal(methodGrid([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]).length, METHOD_COUNT);
  assert.equal(METHOD_COUNT, 8 * 29 * 41);
  const g = methodGrid([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
  assert.equal(g[0].name, "S0|A0|U0", "nền đứng đầu");
  assert.deepEqual([...new Set(g.map((x) => x.s))], [...S_GRID]);
});

test("RRF có trọng số: điểm, hòa theo hạng danh sách 1 rồi 2; mẫu sai (bỏ trọng số) cho thứ tự khác", () => {
  assert.deepEqual(rrfFuse([{ codes: ["a", "b", "c"], w: 1 }, { codes: ["c", "d"], w: 1 }]), ["c", "a", "b", "d"]);
  assert.deepEqual(rrfFuse([{ codes: ["a", "b"], w: 1 }, { codes: ["b", "a"], w: 1 }]), ["a", "b"], "hòa → hạng danh sách 1");
  // c − a = (1/63 − 1/61) + w (1/61 − 1/62): âm khi w = 1, dương khi w = 2
  const w2 = rrfFuse([{ codes: ["a", "b", "c"], w: 1 }, { codes: ["c", "a"], w: 2 }]);
  assert.deepEqual(w2, ["c", "a", "b"]);
  const w1 = rrfFuse([{ codes: ["a", "b", "c"], w: 1 }, { codes: ["c", "a"], w: 1 }]);
  assert.deepEqual(w1, ["a", "c", "b"]);
  assert.notDeepEqual(w1, w2, "mẫu sai (bỏ trọng số) cho cùng thứ tự ở mọi w → bị bắt");
});

test("tầng máy chủ: S0 / S1 / S2-w / S3-k", () => {
  const s0 = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"];
  const im = ["i1", "t3", "i2", "i3", "t1", "i4", "i5", "i6", "i7", "i8", "i9"];
  assert.deepEqual(serverTier("S0", s0, im), s0);
  assert.deepEqual(serverTier("S1", s0, im), im.slice(0, 10));
  assert.deepEqual(serverTier("S3-1", s0, im), [...s0.slice(0, 9), "i1"]);
  assert.deepEqual(serverTier("S3-2", s0, im), [...s0.slice(0, 9), "i1"], "t3 đã có → chỉ thêm 1");
  assert.deepEqual(serverTier("S3-3", s0, im), [...s0.slice(0, 8), "i1", "i2"]);
  assert.deepEqual(serverTier("S3-2", ["t1", "t2"], im), ["t1", "t2", "i1", "t3"], "S0 ngắn → nối thêm");
  const s2 = serverTier("S2-1", s0, im);
  assert.equal(s2.length, 10);
  assert.deepEqual(s2.slice(0, 2), ["t3", "t1"]);
  assert.throws(() => serverTier("S9", s0, im));
});

test("hạng ảnh / lens / U: phân vị không dùng nhãn; ca không lens → không bao giờ 'không chắc'", () => {
  const cs = ["a", "b", "c", "d"];
  const sims = [0.2, 0.9, 0.9, 0.5];
  const ranked = imageRank(cs, sims);
  assert.deepEqual(ranked, ["b", "c", "d", "a"], "hòa → thứ tự codes");
  const L = lensOf(ranked, new Map(cs.map((c, i) => [c, sims[i]])));
  assert.equal(L.top1Code, "b");
  assert.equal(L.margin, 0);
  assert.deepEqual(percentiles([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]), [1, 3, 5, 8, 9]);
  const lens = { top1: 0.6, margin: 0.05 };
  assert.equal(isUnsureU({ id: "U-sim-0.7", kind: "U-sim", tau: 0.7 }, lens, 5), true);
  assert.equal(isUnsureU({ id: "U-sim-0.6", kind: "U-sim", tau: 0.6 }, lens, 5), false, "bằng ngưỡng = chắc");
  assert.equal(isUnsureU({ id: "U-gap-0.1", kind: "U-gap", mu: 0.1 }, lens, 5), true);
  assert.equal(isUnsureU({ id: "U-simchu-0.7", kind: "U-simchu", tau: 0.7 }, lens, 2), false, "khớp 2 từ → chắc");
  assert.equal(isUnsureU({ id: "U-simchu-0.7", kind: "U-simchu", tau: 0.7 }, lens, 1), true);
  assert.equal(isUnsureU({ id: "U-or-0.5-0.1", kind: "U-or", tau: 0.5, mu: 0.1 }, lens, 5), true);
  assert.equal(isUnsureU({ id: "U-or-0.5-0.01", kind: "U-or", tau: 0.5, mu: 0.01 }, lens, 0), false);
  for (const u of [{ id: "U-sim-9", kind: "U-sim", tau: 9 }, { id: "U-or-9-9", kind: "U-or", tau: 9, mu: 9 }]) assert.equal(isUnsureU(u, null, 0), false);
  assert.equal(qidOf({ set: "7up" }), null);
  assert.equal(qidOf({ set: "A", code: "1" }), qidOf({ set: "B", code: "1" }), "A và B cùng ảnh");
});

test("tầng app: A0 / A1 / A2 không lens = nền (7Up nhánh ảnh tắt; R5 x); A1 đẩy mã ảnh hạng 1 lên vị trí 1, vượt lockTop", () => {
  let pushed = 0;
  for (const lines of [["Up", "Soda chanh", "Khong calo"], ["Mi Hao Hao", "tom chua cay"], ["Banh quy", "Cosy"], ["Nuoc mam", "Nam Ngu"]]) {
    const c = caseOf(lines);
    const S = serverS(lines);
    const base0 = serverMerge(ctx, c.found, NET, S, { called: true }).merged;
    for (const a of [{ id: "A0" }, { id: "A1-0-0", kind: "A1", tau: 0, mu: 0 }, { id: "A2-1", kind: "A2", w: 1 }, { id: "A2-2", kind: "A2", w: 2 }]) {
      assert.deepEqual(appTier(ctx, c, S, "i", a, { lens: null, simOf: null, base0 }), base0, `${lines[0]} ${a.id} không lens`);
    }
    const target = S[S.length - 1].code;
    const lens = { top1Code: target, top1: 0.9, margin: 0.2 };
    const simOf = new Map(S.map((h, j) => [h.code, h.code === target ? 0.9 : 0.1 + j * 0.01]));
    const m1 = appTier(ctx, c, S, "i", { id: "A1-0.8-0.1", kind: "A1", tau: 0.8, mu: 0.1 }, { lens, simOf, base0 });
    assert.equal(m1[0].code, target);
    assert.equal(m1.length <= 5, true);
    assert.equal(new Set(codes(m1)).size, m1.length, "không trùng mã");
    const rest = mergeLocal(ctx, c.found, NET, S, { ...BASE_PARAMS, offMax: m1[0].source === "off" ? 0 : 1 }).filter((x) => x.code !== target).slice(0, 4);
    assert.deepEqual(m1.slice(1), base0[0]?.code === target ? base0.slice(1) : rest, "4 mục sau: offMax tính cả mục đẩy");    if (base0[0]?.code !== target) pushed++;
    const notPushed = appTier(ctx, c, S, "i", { id: "A1-0.95-0.1", kind: "A1", tau: 0.95, mu: 0.1 }, { lens, simOf, base0 });
    assert.deepEqual(notPushed, base0, "dưới τ → nền");
    const notInS = appTier(ctx, c, S, "i", { id: "A1-0-0", kind: "A1", tau: 0, mu: 0 }, { lens: { ...lens, top1Code: "0000000000000" }, simOf, base0 });
    assert.deepEqual(notInS, base0, "mã ảnh hạng 1 không trong S → nền");
    const m2 = appTier(ctx, c, S, "i", { id: "A2-2", kind: "A2", w: 2 }, { lens, simOf, base0 });
    assert.equal(m2.length, Math.min(5, new Set([...codes(base0), ...codes(S)]).size));
    assert.ok(codes(m2).includes(target), "A2 w 2 đưa mã sim cao nhất vào 5");
  }
  assert.ok(pushed >= 2, "A1 thật sự đổi vị trí 1 ở ≥ 2 ca");
});

test("ô / R1: 'không chắc' mà nền đúng vị trí 1 = MẤT vị trí 1; rơi khỏi 5 = mất; mẫu sai (không tính U) bị bắt", () => {
  const m = [{ code: "1234567890123" }, { code: "2222222222222" }];
  const base = cellOf(m, "1234567890123", false);
  const unsure = cellOf(m, "1234567890123", true);
  assert.deepEqual([base.top1, base.pos, base.auto], [true, 1, true]);
  assert.deepEqual([unsure.top1, unsure.pos, unsure.auto], [false, 1, false], "vẫn trong 5 nhưng mất vị trí 1");
  const okRow = (got) => Array.from({ length: 120 }, (_, i) => ({ id: `x${i}`, base, got: i === 0 ? got : base }));
  const common = {
    good: GOOD_IMGS.flatMap((n) => ["i", "ii"].map((c) => ({ id: `${n}${c}`, got: base }))), s7: ["a", "b", "c", "d"].map((id) => ({ id, got: base })),
    buldak: [{ id: "i", top1Code: BULDAK_CODE, auto: true }, { id: "ii", top1Code: BULDAK_CODE, auto: true }], noImgSame: true, r5x: true, r5y: { pass: true },
    r6: { p95: 900, ramMiB: 1200 }, r7: { bytes: 20000000 },
  };
  assert.equal(judgeR({ ab: okRow(base), ...common }).pass, true);
  const v = judgeR({ ab: okRow(unsure), ...common });
  assert.equal(v.gates.R1, false);
  const wrongJudge = (rows) => rows.every((r) => r.got.pos === 1 || r.base.pos !== 1); // mẫu sai: chỉ nhìn vị trí, bỏ U
  assert.equal(wrongJudge(okRow(unsure)), true, "mẫu sai cho qua → test bắt được");
  assert.equal(judgeR({ ab: okRow(cellOf([{ code: "2222222222222" }], "1234567890123", false)), ...common }).gates.R1, false, "rơi khỏi 5");
  assert.equal(judgeR({ ab: okRow(base).slice(1), ...common }).gates.R1, false, "thiếu ô");
  assert.equal(judgeR({ ab: okRow(base), ...common, noImgSame: false }).gates.R3, false, "7Up / ca không ảnh khác nền → trượt");
  assert.equal(judgeR({ ab: okRow(base), ...common, buldak: [{ id: "i", top1Code: BULDAK_CODE, auto: false }, common.buldak[1]] }).gates.R4, false);
  assert.equal(judgeR({ ab: okRow(base), ...common, r6: { p95: 1501, ramMiB: 1 } }).gates.R6, false);
  assert.equal(judgeR({ ab: okRow(base), ...common, r7: { bytes: R7_MAX_BYTES + 1 } }).gates.R7, false);
  assert.equal(judgeR({ ab: okRow(base), ...common, r5y: { pass: false } }).gates.R5, false);
});

test("mục tiêu M1–M3, nửa giữ riêng, chỉ để tham khảo; chọn cách", () => {
  const C = (top1, pos, auto = true) => ({ top1, pos, auto });
  const row = (img, group, folder, label, base, got, preset = false) => ({ id: `${img}${group}`, img, group, folder, label, preset, base, got });
  const baseRows = [
    row(1, "chinh", "1-ra-dung", "ma", C(false, 3), C(true, 1)), row(2, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 2)),
    row(3, "chinh", "3-khong-ra", "none", C(false, null), C(false, null, false)), row(4, "giu", "1-ra-dung", "ma", C(true, 1), C(true, 1)),
  ];
  const t = targetsM(baseRows);
  assert.deepEqual([t.M1, t.M2, t.M3, t.base.M1, t.base.M2, t.base.M3], [1, 2, 0, 0, 1, 1]);
  assert.equal(t.holdOk, true);
  assert.deepEqual(t.refOnly, []);
  const pass = { pass: true };
  assert.equal(achieves(pass, t), true);
  const lossHold = targetsM([...baseRows.slice(0, 3), row(4, "giu", "1-ra-dung", "ma", C(true, 1), C(false, 1, false))]);
  assert.equal(lossHold.holdOk, false);
  assert.equal(achieves(pass, lossHold), false);
  const one = targetsM([row(1, "chinh", "1-ra-dung", "ma", C(false, 3), C(true, 1))]);
  assert.deepEqual(one.refOnly, ["chỉ nhờ 1 ảnh"]);
  const f2 = targetsM([row(1, "chinh", "2-ma-vach-ra", "ma", C(false, 3), C(true, 1)), row(5, "chinh", "2-ma-vach-ra", "ma", C(false, null), C(false, 4))]);
  assert.ok(f2.refOnly.includes("chỉ nhờ ảnh thư mục 2"));
  const pre = targetsM([row(1, "chinh", "1-ra-dung", "ma", C(false, 3), C(true, 1), true), row(5, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 4), true)]);
  assert.ok(pre.refOnly.includes("chỉ nhờ ảnh preset"));
  const worse = targetsM([row(1, "chinh", "1-ra-dung", "ma", C(true, 1), C(false, 2)), row(2, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 2)), row(3, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 3))]);
  assert.equal(achieves(pass, worse), false, "M1 kém nền → không đạt dù M2 hơn");
  const p = pickMethod([{ name: "S0|A0|U0", verdict: pass, t: targetsM(baseRows.map((r) => ({ ...r, got: r.base }))) }, { name: "x", verdict: pass, t: one }, { name: "y", verdict: { pass: false }, t }, { name: "z", verdict: pass, t }]);
  assert.equal(p.name, "z");
  assert.deepEqual(p.refOnly.map((x) => x.name), ["x"]);
});

test("chống ăn gian: cùng imgid / mã băm gần (≤ 24 bit) → loại; không còn ứng viên → loại khỏi đo ảnh", () => {
  assert.equal(HASH_OK_MIN, 25);
  const r = chooseSubstitute([{ key: "front_vi.3", imgid: "7", distance: 40 }, { key: "front_en.5", imgid: "9", distance: 24 }, { key: "front_fr.6", imgid: "10", distance: 25 }], "7");
  assert.equal(r.chosen.key, "front_fr.6");
  assert.deepEqual(r.rejected.map((x) => x.reason), ["cùng imgid", "gần ảnh đo 24 bit (≤ 24)"]);
  const none = chooseSubstitute([{ key: "front_vi.3", imgid: "7", distance: 60 }, { key: "front_en.4", imgid: "8", distance: 3 }, { key: "front_th.4", imgid: "8", distance: 60 }], "7");
  assert.equal(none.chosen, null);
  assert.equal(none.rejected[2].reason, "trùng imgid ứng viên trước");
  assert.equal(chooseSubstitute([{ key: "front_vi.3", imgid: "8", distance: null }], "7").chosen, null, "không có mã băm → không nhận");
  // mẫu sai: chỉ so imgid (bỏ mã băm) sẽ nhận front_en.5 (24 bit)
  const wrong = [{ key: "front_en.5", imgid: "9", distance: 24 }].find((c) => c.imgid !== "7");
  assert.equal(wrong.key, "front_en.5");
  assert.equal(chooseSubstitute([{ key: "front_en.5", imgid: "9", distance: 24 }], "7").chosen, null);
});

test("chọn model: R6 / R7 lọc, rồi A/B top 5, ảnh thật top 5, Apache-2.0, nhẹ hơn, 'cat' trước", () => {
  const v = (variant, pre, o) => ({ variant, pre, license: "MIT", onnxBytes: 100, p95: 500, r7Bytes: 20e6, abTop5: 10, realTop5: 3, ...o });
  assert.equal(pickModel([v("clip-fp32", "cat"), v("dinov2-small", "cat", { abTop5: 11 })]).name, "dinov2-small|cat");
  assert.equal(pickModel([v("clip-fp32", "cat", { realTop5: 4 }), v("dinov2-small", "cat")]).name, "clip-fp32|cat");
  assert.equal(pickModel([v("clip-fp32", "cat"), v("siglip", "cat", { license: "Apache-2.0" })]).name, "siglip|cat");
  assert.equal(pickModel([v("clip-fp32", "cat", { onnxBytes: 300 }), v("clip-int8", "cat", { onnxBytes: 90 })]).name, "clip-int8|cat");
  assert.equal(pickModel([v("clip-fp32", "vien"), v("clip-fp32", "cat")]).name, "clip-fp32|cat");
  const d = pickModel([v("clip-fp32", "cat", { p95: 1501, abTop5: 99 }), v("siglip", "cat", { r7Bytes: 30e6, abTop5: 99 }), v("dinov2-small", "vien")]);
  assert.equal(d.name, "dinov2-small|vien");
  assert.equal(d.dropped.length, 2);
  assert.equal(indexBytesInt8(44092, 512), 44092 * 514 + 44092 * 14);
  assert.ok(indexBytesInt8(44092, 512) <= R7_MAX_BYTES);
  assert.ok(indexBytesInt8(44092, 768) > R7_MAX_BYTES, "768 chiều int8 ở mức (b) trượt R7");
});

test("cổng dừng sớm: G3 và (G1 hoặc G2)", () => {
  const ab = (hit, meas = 20) => Array.from({ length: meas }, (_, i) => ({ code: String(i), measurable: true, pos: i < hit ? 3 : null }));
  const good = GOOD_IMGS.map((img, i) => ({ img, top1: 0.8 + i * 0.01 }));
  const wrong = [{ img: 2, inIndex: true, pos: 2 }, { img: 4, inIndex: true, pos: 5 }, { img: 5, inIndex: false, pos: null }];
  assert.equal(earlyGate({ ab: ab(10), wrong, none3: [], good }).pass, true, "G3 50 % + G1 2");
  assert.equal(earlyGate({ ab: ab(9), wrong, none3: [], good }).pass, false, "G3 45 %");
  const w1 = [{ img: 2, inIndex: true, pos: 6 }, { img: 4, inIndex: true, pos: 5 }];
  assert.equal(earlyGate({ ab: ab(10), wrong: w1, none3: [], good }).pass, false, "G1 chỉ 1, G2 0");
  assert.equal(earlyGate({ ab: ab(10), wrong: w1, none3: [{ img: 17, top1: 0.7 }, { img: 18, top1: 0.79 }, { img: 19, top1: 0.8 }], good }).pass, true, "G2: 2 ảnh dưới min 0,8");
  const notMeas = [...ab(10), ...Array.from({ length: 5 }, () => ({ measurable: false, pos: null }))];
  assert.equal(earlyGate({ ab: notMeas, wrong, none3: [], good }).detail.abMeasurable, 20, "mã bị loại không vào mẫu số");
});

test("đọc .npy float32", () => {
  const header = "{'descr': '<f4', 'fortran_order': False, 'shape': (2, 3), }";
  const pad = 64 - ((10 + header.length + 1) % 64);
  const h = header + " ".repeat(pad) + "\n";
  const b = Buffer.alloc(10 + h.length + 24);
  b.writeUInt8(0x93, 0);
  b.write("NUMPY", 1, "latin1");
  b.writeUInt8(1, 6);
  b.writeUInt8(0, 7);
  b.writeUInt16LE(h.length, 8);
  b.write(h, 10, "latin1");
  [1, 2, 3, 4, 5, 6.5].forEach((x, i) => b.writeFloatLE(x, 10 + h.length + 4 * i));
  const r = parseNpy(b);
  assert.deepEqual(r.shape, [2, 3]);
  assert.deepEqual([...r.data], [1, 2, 3, 4, 5, 6.5]);
  assert.throws(() => parseNpy(Buffer.from(b.toString("latin1").replace("<f4", "<f8"), "latin1")));
});
