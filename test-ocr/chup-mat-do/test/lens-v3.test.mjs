// Test vòng 3 đợt lens (theo review sau cổng): chứng cứ vector (A1), sha ONNX bắt buộc khi gọi từ lens-chay (A2), kiểm bộ
// int8 trước --do (A4), chỉ báo cổng (A5). Gọi hàm THẬT của lens-do.mjs; dữ liệu giả (mã giả 1111…), không đọc ảnh thật.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  r6From, vecMetaErrors, int8MetaErrors, doInputCheck, INT8_QUANT, INT8_LOSS_KEYS, indexBytesInt8, tieInfo, rowView, modeOf,
  MODES, G1_IMGS,
} from "../lens-do.mjs";

const H = (ch) => ch.repeat(64);
const CUR = H("a");

/** meta bộ (b) fp32 hợp lệ (như lens-vec.py vec ghi từ vòng 3). */
const bMeta = () => ({ model: "clip-fp32", pre: "cat", level: "b", sha256: H("e"), vaoSha256: H("f"), nIndex: 3, dims: 4, vecPySha256: CUR, gitHead: "c".repeat(40), gitDirty: false });
const loss = () => ({ n: 2, fp32: { top1: 1, top5: 2, top10: 2 }, int8: { top1: 1, top5: 2, top10: 2 }, changed: { top1: 0, top5: 0, top10: 0 }, top10OverlapMean: 1, maxAbsSimDiff: 0.0004 });
const i8Meta = () => ({ ...bMeta(), quant: INT8_QUANT, fp32Sha256: H("d"), indexBytes: indexBytesInt8(3, 4), int8Loss: loss() });

test("A1 vecMetaErrors: thiếu vecPySha256 / sha lệch lens-vec.py hiện tại / gitDirty true hoặc thiếu → lỗi (lens-chay thoát mã 3)", () => {
  assert.deepEqual(vecMetaErrors(bMeta(), { vecPySha256: CUR, what: "b" }), []);
  const { vecPySha256: _, ...noSha } = bMeta();
  assert.equal(vecMetaErrors(noSha, { vecPySha256: CUR, what: "b" }).length, 1, "thiếu vecPySha256");
  assert.match(vecMetaErrors({ ...bMeta(), vecPySha256: H("b") }, { vecPySha256: CUR, what: "b" })[0], /khác lens-vec\.py hiện tại/);
  assert.match(vecMetaErrors({ ...bMeta(), gitDirty: true }, { vecPySha256: CUR, what: "b" })[0], /gitDirty/);
  assert.match(vecMetaErrors({ ...bMeta(), gitDirty: undefined }, { vecPySha256: CUR, what: "b" })[0], /gitDirty/);
  assert.match(vecMetaErrors({ ...bMeta(), gitDirty: null }, { vecPySha256: CUR, what: "b" })[0], /gitDirty/);
  assert.throws(() => vecMetaErrors(bMeta(), { vecPySha256: "xyz", what: "b" }), /64 hex/, "sha hiện tại sai dạng → ném");
  assert.equal(vecMetaErrors(null, { vecPySha256: CUR, what: "b" }).length, 2);
});

test("A1 + A4 doInputCheck: bộ (b) và bộ int8 đúng bản code, int8 đủ khóa → 0; mỗi mẫu sai → mã 3", () => {
  const ok = doInputCheck({ bMeta: bMeta(), int8Meta: i8Meta(), fp32Sha256: H("d"), vecPySha256: CUR });
  assert.deepEqual([ok.exitCode, ok.errs], [0, []]);
  const bad = (o) => doInputCheck({ bMeta: bMeta(), int8Meta: i8Meta(), fp32Sha256: H("d"), vecPySha256: CUR, ...o });
  const del = (k) => { const m = i8Meta(); delete m[k]; return m; };
  const cases = {
    "bộ (b) gitDirty true": { bMeta: { ...bMeta(), gitDirty: true } },
    "bộ (b) thiếu vecPySha256": { bMeta: { ...bMeta(), vecPySha256: undefined } },
    "bộ int8 sha lệch": { int8Meta: { ...i8Meta(), vecPySha256: H("b") } },
    "bộ int8 gitDirty true": { int8Meta: { ...i8Meta(), gitDirty: true } },
    "thiếu indexBytes": { int8Meta: del("indexBytes") },
    "indexBytes sai": { int8Meta: { ...i8Meta(), indexBytes: indexBytesInt8(3, 4) + 1 } },
    "indexBytes fp32": { int8Meta: { ...i8Meta(), indexBytes: 3 * 4 * 4 } },
    "thiếu int8Loss": { int8Meta: del("int8Loss") },
    "int8Loss thiếu khóa": { int8Meta: { ...i8Meta(), int8Loss: { ...loss(), changed: undefined } } },
    "int8Loss số không hữu hạn": { int8Meta: { ...i8Meta(), int8Loss: { ...loss(), maxAbsSimDiff: NaN } } },
    "quant khác": { int8Meta: { ...i8Meta(), quant: "int8-sym-perVector-scaleF32" } },
    "thiếu quant": { int8Meta: del("quant") },
    "fp32Sha256 lệch index.npy": { fp32Sha256: H("9") },
    "thiếu fp32Sha256 thật": { fp32Sha256: null },
    "int8 khác vaoSha256 của (b)": { int8Meta: { ...i8Meta(), vaoSha256: H("0") } },
    "int8 khác nIndex của (b)": { int8Meta: { ...i8Meta(), nIndex: 4, indexBytes: indexBytesInt8(4, 4) } },
    "int8 khác model": { int8Meta: { ...i8Meta(), model: "clip-int8" } },
    "int8 level khác": { int8Meta: { ...i8Meta(), level: "a" } },
  };
  for (const [why, o] of Object.entries(cases)) {
    const r = bad(o);
    assert.equal(r.exitCode, 3, why);
    assert.ok(r.errs.length >= 1, why);
  }
  assert.deepEqual([...INT8_LOSS_KEYS], ["n", "fp32", "int8", "changed", "top10OverlapMean", "maxAbsSimDiff"]);
  assert.equal(INT8_QUANT, "int8-sym-perVector-scaleF16-invNorm");
  assert.equal(indexBytesInt8(42208, 512), 42208 * 528, "R7 = nIndex × 528 byte");
});

test("A4 lens-chay --do: không còn '?? Infinity' / 'int8Loss ?? null'; kiểm doInputCheck trước khi phán", () => {
  const src = fs.readFileSync(new URL("../lens-chay.mjs", import.meta.url), "utf8");
  const d = src.slice(src.indexOf('if (mode === "do")'), src.indexOf("out.offStats"));
  assert.doesNotMatch(d, /\?\? Infinity/);
  assert.doesNotMatch(d, /int8Loss \?\? null/);
  assert.match(d, /doInputCheck\(\{ bMeta, int8Meta: sims\.meta, fp32Sha256, vecPySha256: vecPySha \}\)/);
  assert.ok(d.indexOf("doInputCheck(") < d.indexOf("percentiles("), "kiểm trước τ / μ");
  assert.match(d, /if \(dc\.exitCode\) stop\(/);
  assert.match(d, /r6Of\(vname, pre, meta\.sha256, \{ requireOnnx: true, vecPySha256: vecPySha, requireClean: true \}\)/);
});

test("A1 + A2 r6From: gọi từ lens-chay đòi sha ONNX 64 hex; từ --do đòi sha lens-vec.py hiện tại + gitDirty false", () => {
  const t = (p95) => ({ median: p95 - 50, p95, max: p95 + 20, n: 20 });
  const gio = {
    longEdge: 1600, jpegQuality: 0.9, threads: 1, at: "2026-11-21T01:00:00+0700", vecPySha256: CUR, gitHead: "c".repeat(40), gitDirty: false, nSearch: 42208,
    models: { "clip-fp32": { sha256: H("e"), onnxSha256: H("e"), ramAddAfter20MiB: 120, time: { cat: t(700) } } },
  };
  const strict = { requireOnnx: true, vecPySha256: CUR, requireClean: true };
  assert.equal(r6From(gio, "clip-fp32", "cat", H("e"), strict).p95, 700);
  // A2: undefined / sai dạng → lỗi (trước đây bỏ qua lặng lẽ)
  assert.equal(r6From(gio, "clip-fp32", "cat", undefined).p95, 700, "không đòi (test cũ / gọi tay) thì vẫn như cũ");
  assert.throws(() => r6From(gio, "clip-fp32", "cat", undefined, { requireOnnx: true }), /không phải chuỗi 64 hex/);
  assert.throws(() => r6From(gio, "clip-fp32", "cat", "E".repeat(64), { requireOnnx: true }), /không phải chuỗi 64 hex/);
  assert.throws(() => r6From(gio, "clip-fp32", "cat", H("e").slice(1), { requireOnnx: true }), /không phải chuỗi 64 hex/);
  // A1: sha lens-vec.py lệch / gitDirty true / thiếu → lỗi
  assert.throws(() => r6From({ ...gio, vecPySha256: H("b") }, "clip-fp32", "cat", H("e"), strict), /khác lens-vec\.py hiện tại/);
  assert.throws(() => r6From({ ...gio, gitDirty: true }, "clip-fp32", "cat", H("e"), strict), /gitDirty/);
  assert.throws(() => r6From({ ...gio, gitDirty: undefined }, "clip-fp32", "cat", H("e"), strict), /gitDirty/);
  assert.throws(() => r6From(gio, "clip-fp32", "cat", H("e"), { ...strict, vecPySha256: "abc" }), /64 hex/);
  const src = fs.readFileSync(new URL("../lens-chay.mjs", import.meta.url), "utf8");
  assert.match(src, /r6Of\(vd\.variant, vd\.pre, m\.sha256, \{ requireOnnx: true \}\)/, "--chon-model: chỉ đòi sha ONNX (không áp kiểm mới cho bộ (a))");
});

test("A5 tieInfo: hạng, sim hạng 5 / 6, số mã hòa, khoảng hạng; vượt mốc 5 → ghi chú phụ thuộc thứ tự hòa", () => {
  const codes = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
  const sims = [0.9, 0.8, 0.7, 0.6, 0.5, 0.5, 0.5, 0.1];
  const row = rowView(codes, sims, []);
  assert.deepEqual(tieInfo(row, "c1"), { rank: 1, sim: 0.9, sim5: 0.5, sim6: 0.5, ties: 0, rankMin: 1, rankMax: 1, tieCrosses5: false, note: null });
  const c5 = tieInfo(row, "c5");
  assert.deepEqual([c5.rank, c5.ties, c5.rankMin, c5.rankMax, c5.tieCrosses5], [5, 2, 5, 7, true]);
  assert.match(c5.note, /cổng phụ thuộc thứ tự hòa \(luật cho phép: hòa theo codes\.json\)/);
  const c7 = tieInfo(row, "c7");
  assert.deepEqual([c7.rank, c7.rankMin, c7.rankMax, c7.tieCrosses5], [7, 5, 7, true], "hạng 7 nhưng hòa → có thể vào 5");
  assert.equal(tieInfo(row, "c4").tieCrosses5, false);
  assert.deepEqual(tieInfo(row, "zz"), { rank: null, sim: null, sim5: 0.5, sim6: 0.5, ties: null, rankMin: null, rankMax: null, tieCrosses5: false, note: "mã đúng không có trên hàng (không có trong chỉ mục / bị ẩn)" });
  // mã bị ẩn trên hàng → như không có
  const hid = rowView(codes, sims, ["c1"]);
  assert.equal(tieInfo(hid, "c1").rank, null);
  assert.equal(tieInfo(hid, "c2").rank, 1);
  // mẫu sai: chỉ đếm hạng (không xét hòa) thì c7 coi là ngoài 5, bỏ sót
  assert.equal(row.ranked.indexOf("c7") + 1 <= 5, false);
});

test("A5 --cong-chi-bao: cờ riêng, đọc sims qua loadChecked / rowView, KHÔNG gọi earlyGate, không sửa cong.json", () => {
  assert.equal(MODES["--cong-chi-bao"], "cong-chi-bao");
  assert.equal(modeOf(["--cong-chi-bao"]), "cong-chi-bao");
  assert.equal(modeOf(["--cong"]), "cong");
  assert.equal(modeOf(["--cong", "--cong-chi-bao"]), null);
  assert.deepEqual([...G1_IMGS], [2, 4, 5, 10, 15]);
  const src = fs.readFileSync(new URL("../lens-chay.mjs", import.meta.url), "utf8");
  const i = src.indexOf('if (mode === "cong-chi-bao")');
  assert.ok(i > 0);
  const b = src.slice(i, src.indexOf('if (mode === "do")'));
  assert.doesNotMatch(b, /earlyGate\(/);
  assert.doesNotMatch(b, /cong\.json"\), JSON/);
  assert.doesNotMatch(b, /writeFileSync/);
  assert.match(b, /loadChecked\(/);
  assert.match(b, /tieInfo\(/);
  assert.match(b, /sims\.rowOf\(/);
});
