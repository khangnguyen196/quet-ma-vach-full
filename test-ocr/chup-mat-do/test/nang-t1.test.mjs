// Test phần thuần của khung đo nang-t1 (không mạng, không đọc D:\tmp).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as page from "../../../public/chup-mat-do/t1.mjs";
import zlib from "node:zlib";
import {
  boxToPoly, toPolyItems, splitGroups, HOLDOUT, ALL_CODES, saltItems, SALT_LINES, queryIdf, normScore, tally, seenMatch, compareSeen, SALT_SEEN,
  regressions, realGain, judge, choosePoint, idfOf,
} from "../nang-t1-do.mjs";
import { CRITERIA, catalogProduct, dropReasons, catalogSize, buildExtended, writeExtended } from "../nang-t1-danh-muc.mjs";
import { diffBaseline, loadNen } from "../nang-t1-thu.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catalogJson, catalogMeta, NGUON_VN, NGUON_VN_893 } from "../xuat-danh-muc.mjs";

test("boxToPoly: 4 góc theo chiều kim đồng hồ từ trên trái; box hỏng -> null", () => {
  assert.deepEqual(boxToPoly({ minX: 1, minY: 2, maxX: 30, maxY: 40 }), [[1, 2], [30, 2], [30, 40], [1, 40]]);
  assert.equal(boxToPoly({ minX: 1, minY: 2, maxX: 30 }), null);
  assert.equal(boxToPoly(null), null);
});

test("toPolyItems: bộ A dựng poly từ box, conf -> score; auto giữ poly có sẵn; khung hỏng bị bỏ", () => {
  const items = [
    { text: "Quinasoy", conf: 0.9, box: { minX: 452, minY: 8, maxX: 765, maxY: 101 }, poly: [[454, 8], [765, 16], [763, 101], [452, 93]] },
    { text: "x", conf: 0.5 },
    { conf: 0.5, box: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
  ];
  assert.deepEqual(toPolyItems(items, "box"), [{ text: "Quinasoy", poly: [[452, 8], [765, 8], [765, 101], [452, 101]], score: 0.9 }]);
  assert.deepEqual(toPolyItems(items, "auto")[0].poly, [[454, 8], [765, 16], [763, 101], [452, 93]]);
  assert.equal(toPolyItems([{ text: "a", score: 0.7, poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }], "auto")[0].score, 0.7);
  assert.equal(toPolyItems([{ text: "a", box: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }])[0].score, null);
  assert.deepEqual(toPolyItems(null), []);
});

test("splitGroups: xếp tăng dần, vị trí 3, 6, 9… là giữ riêng; không phụ thuộc thứ tự đầu vào", () => {
  const codes = ["9", "1", "5", "3", "7", "2", "8", "4", "6"];
  assert.deepEqual(splitGroups(codes), { tune: ["1", "2", "4", "5", "7", "8"], holdout: ["3", "6", "9"] });
  assert.deepEqual(splitGroups([...codes].reverse()), splitGroups(codes));
});

test("HOLDOUT: 10 mã, tăng dần, không trùng", () => {
  assert.equal(HOLDOUT.length, 10);
  assert.deepEqual([...HOLDOUT].sort(), HOLDOUT);
  assert.equal(new Set(HOLDOUT).size, 10);
});

test("ALL_CODES: 30 mã tăng dần; luật chia nhóm trên ALL_CODES ra đúng HOLDOUT", () => {
  assert.equal(ALL_CODES.length, 30);
  assert.equal(new Set(ALL_CODES).size, 30);
  assert.deepEqual([...ALL_CODES].sort(), ALL_CODES);
  const g = splitGroups(ALL_CODES);
  assert.deepEqual(g.holdout, HOLDOUT);
  assert.equal(g.tune.length, 20);
});

// ---- hàm giảm / judge / luật chọn (vòng 2) ----
const R = (code, rank, scores) => ({ code, rank, ...(scores ? { scores } : {}) });

test("regressions: 1→2 là lostTop1 (không ok)", () => {
  const r = regressions([R("a", 1)], [R("a", 2)]);
  assert.deepEqual(r.lostTop1, ["a"]);
  assert.deepEqual(r.droppedTop5, []);
  assert.equal(r.ok, false);
});

test("regressions: 3→null là droppedTop5 (không ok); 1→null vừa lostTop1 vừa droppedTop5", () => {
  const r = regressions([R("a", 3), R("b", 1)], [R("a", null), R("b", null)]);
  assert.deepEqual(r.droppedTop5, ["a", "b"]);
  assert.deepEqual(r.lostTop1, ["b"]);
  assert.equal(r.ok, false);
});

test("regressions: 2→4 là movedDown; ok khi không strict, không ok khi strict", () => {
  const r = regressions([R("a", 2)], [R("a", 4)]);
  assert.deepEqual(r.movedDown, ["a"]);
  assert.equal(r.ok, true);
  assert.equal(regressions([R("a", 2)], [R("a", 4)], { strict: true }).ok, false);
  // lên trong 2–5 thì không phải movedDown
  assert.deepEqual(regressions([R("a", 4)], [R("a", 2)], { strict: true }), { lostTop1: [], droppedTop5: [], movedDown: [], gained: [], ok: true });
});

test("regressions: null→3 và 3→1 là gained (ok); thiếu mã thì lỗi", () => {
  const r = regressions([R("a", null), R("b", 3), R("c", 1)], [R("a", 3), R("b", 1), R("c", 1)], { strict: true });
  assert.deepEqual(r.gained, ["a", "b"]);
  assert.equal(r.ok, true);
  assert.throws(() => regressions([R("a", 1)], [R("b", 1)]));
});

test("realGain: hơn hẳn gợi ý ngay sau mới tính; bằng điểm thì không", () => {
  assert.equal(realGain(R("a", 1, [5, 5, 3])), false); // 2→1 nhờ bằng điểm
  assert.equal(realGain(R("a", 1, [5.1, 5, 3])), true);
  assert.equal(realGain(R("a", 5, [9, 8, 7, 6, 5, 5])), false); // vị trí 5 bằng gợi ý thứ 6
  assert.equal(realGain(R("a", 3, [9, 8, 7])), true); // không có gợi ý sau
  assert.equal(realGain(R("a", null, [9])), false);
});

test("realGain: dòng có hạng mà không có scores -> lỗi rõ (không âm thầm false)", () => {
  assert.throws(() => realGain(R("a", 1)), /a.*không có scores/);
  assert.throws(() => realGain({ code: "b", rank: 2, scores: "1,2" }), /không có scores/);
  // judge trên rows vòng 1 (không scores) có mã tăng -> lỗi, không ra gainChinh 0
  const base = ALL_CODES.map((code) => ({ code, rank: 2 }));
  const cand = ALL_CODES.map((code) => ({ code, rank: 1 }));
  assert.throws(() => judge({ base: { A: base, B: base }, cand: { A: cand, B: cand } }), /không có scores/);
});

/** Dựng 30 dòng (theo ALL_CODES) với hạng mặc định 1, điểm hơn hẳn; ghi đè vài mã. */
function rows30(over = {}) {
  return ALL_CODES.map((code) => ({ code, rank: 1, scores: [10, 5, 4, 3, 2, 1], ...(over[code] || {}) }));
}
const TUNE0 = ALL_CODES.find((c) => !HOLDOUT.includes(c));
const TUNE1 = ALL_CODES.filter((c) => !HOLDOUT.includes(c))[1];

test("judge: 2→1 bằng điểm không tính tăng thật; 2→1 hơn hẳn thì tính, đếm theo cặp bộ/mã", () => {
  const base = rows30({ [TUNE0]: { rank: 2 } });
  const tie = rows30({ [TUNE0]: { rank: 1, scores: [5, 5, 4, 3, 2, 1] } });
  const j1 = judge({ base: { A: base, B: base }, cand: { A: tie, B: tie } });
  assert.equal(j1.chinhOk, true);
  assert.equal(j1.gainChinh, 0);
  assert.deepEqual(j1.sets.A.chinh.gained, [TUNE0]);
  const good = rows30({ [TUNE0]: { rank: 1, scores: [6, 5, 4, 3, 2, 1] } });
  const j2 = judge({ base: { A: base, B: base }, cand: { A: good, B: tie } });
  assert.equal(j2.gainChinh, 1);
  assert.deepEqual(j2.sets.A.realGains, [TUNE0]);
});

test("judge: giảm ở nhóm chỉnh (bộ B) -> chinhOk false; nhóm giữ riêng xét strict", () => {
  const base = rows30({ [HOLDOUT[0]]: { rank: 2 } });
  const lost = rows30({ [TUNE1]: { rank: 3 } });
  const jl = judge({ base: { A: base, B: base }, cand: { A: base, B: lost } });
  assert.equal(jl.chinhOk, false);
  assert.deepEqual(jl.sets.B.chinh.lostTop1, [TUNE1]);
  const down = rows30({ [HOLDOUT[0]]: { rank: 4 } });
  const jd = judge({ base: { A: base, B: base }, cand: { A: down, B: base } });
  assert.equal(jd.chinhOk, true);
  assert.equal(jd.giuRiengOk, false);
  assert.deepEqual(jd.sets.A.giuRieng.movedDown, [HOLDOUT[0]]);
});

test("choosePoint: chỉ điểm chinhOk; gain lớn nhất, bằng thì điểm trước; giữ riêng không đạt thì không giữ (không chọn lại)", () => {
  const J = (chinhOk, giuRiengOk, gainChinh) => ({ chinhOk, giuRiengOk, gainChinh });
  const p = (name, base, moc = base) => ({ name, vsBase: base, vsMoc: moc });
  assert.deepEqual(choosePoint([p("x1", J(true, true, 2)), p("x2", J(true, true, 2)), p("x3", J(false, true, 5))]).chosen, "x1");
  assert.equal(choosePoint([p("x1", J(true, true, 1), J(false, true, 1)), p("x2", J(true, true, 1))]).chosen, "x2");
  assert.equal(choosePoint([p("x1", J(true, true, 0))]).kept, false);
  const r = choosePoint([p("x1", J(true, false, 3)), p("x2", J(true, true, 1))]);
  assert.equal(r.kept, false);
  assert.equal(r.chosen, "x1");
  assert.equal(choosePoint([p("x1", J(true, true, 1), J(true, false, 1))]).kept, false);
});

test("saltItems: 4 khung không chồng lấn -> 4 hàng riêng qua rowLineInfo, giữ nguyên chữ", () => {
  const items = saltItems();
  assert.equal(items.length, 4);
  const rows = page.rowLineInfo(page.ocrItems([{ items }]));
  assert.deepEqual(rows.map((r) => r.text), SALT_LINES);
  assert.ok(rows.every((r) => Math.abs(r.conf - 0.9) < 1e-9));
});

test("queryIdf / normScore: chỉ cộng từ có trong chỉ mục, mỗi từ một lần", () => {
  const idx = { idf: new Map([["a", 2], ["b", 3]]) };
  assert.equal(queryIdf(idx, ["a", "b", "a", "z"]), 5);
  // chỉ mục không có idf kiểu Map (vd n-gram) -> lỗi rõ, không âm thầm ra 0
  assert.throws(() => queryIdf({ grams: new Map() }, ["a"]), /idf/);
  assert.throws(() => queryIdf(undefined, ["a"]), /idf/);
  assert.equal(normScore(10, 5), 2);
  assert.equal(normScore(null, 5), 0);
  assert.equal(normScore(3, 0), 0);
});

test("idfOf (G1): measure dùng idfSum ranker trả; ranker không trả -> lỗi rõ kèm tên ranker", () => {
  assert.equal(idfOf({ name: "x" }, { query: ["a"], hits: [], idfSum: 3.5 }), 3.5);
  assert.equal(idfOf({ name: "x" }, { query: [], hits: [], idfSum: 0 }), 0);
  assert.throws(() => idfOf({ name: "ngram-thu" }, { query: ["a"], hits: [] }), /ngram-thu.*idfSum/);
  assert.throws(() => idfOf({ name: "x" }, { query: ["a"], hits: [], idfSum: NaN }), /idfSum/);
});

test("tally: đếm vị trí 1 và trong 5", () => {
  assert.deepEqual(tally([{ rank: 1 }, { rank: 3 }, { rank: null }]), { n: 3, top1: 1, top5: 2 });
});

test("seenMatch / compareSeen: tên thấy = tên + thương hiệu, bỏ dấu", () => {
  assert.ok(seenMatch({ name: "Cơm Sấy", brand: "Minh Châu" }, "Cơm Sấy Minh Châu"));
  assert.ok(seenMatch({ name: "Kem đánh răng Freshmint bạc hà Co.op Select 100g", brand: "Co.op Select" }, "Kem đánh răng Freshmint Co.op Select"));
  assert.ok(!seenMatch({ name: "Ham", brand: "" }, "Ham Select"));
  const hits = [
    { name: "Lorenz naturals", brand: "Lorenz" }, { name: "Cơm Sấy", brand: "Minh Châu" }, { name: "Argeta Salt", brand: "GHL" },
    { name: "Ham", brand: "Select" }, { name: "Kem đánh răng Freshmint bạc hà Co.op Select 100g", brand: "Co.op Select" },
  ];
  assert.deepEqual(compareSeen(hits, SALT_SEEN), { common: 5, of: 5, sameOrder: true });
  assert.deepEqual(compareSeen([hits[1], hits[0]], SALT_SEEN), { common: 2, of: 5, sameOrder: false });
});

test("dropReasons: chỉ bản ghi docText trống bị bỏ, ghi đủ lý do", () => {
  assert.deepEqual(dropReasons({ names: { product_name: "Bánh" }, brands: "", generic: {} }), []);
  assert.deepEqual(dropReasons({ names: {}, brands: "Vinamilk", generic: {} }), []);
  assert.deepEqual(dropReasons({ names: {}, brands: "", generic: {} }), ["docText trống", "không tên", "không thương hiệu", "không generic_name"]);
});

test("CRITERIA: vn / đầu 893 / tên / thương hiệu", () => {
  const vnName = { code: "1234567890123", vn: true, names: { product_name: "A" }, brands: "", generic: {} };
  const n893Brand = { code: "8930000000001", vn: false, names: {}, brands: "B", generic: {} };
  const n893Short = { code: "893000", vn: false, names: { product_name: "C" }, brands: "", generic: {} };
  const pick = (k) => [vnName, n893Brand, n893Short].filter(CRITERIA[k]).map((r) => r.code);
  assert.deepEqual(pick("(1) vn, có tên"), ["1234567890123"]);
  assert.deepEqual(pick("(2) vn hoặc 893, có tên"), ["1234567890123"]);
  assert.deepEqual(pick("(3) vn hoặc 893, có tên hoặc thương hiệu"), ["1234567890123", "8930000000001"]);
  assert.deepEqual(pick("(3b) vn hoặc 893, có tên và thương hiệu"), []);
});

test("catalogProduct: đúng dạng danh mục app (img chỉ khi có ảnh front_xx); catalogSize đo thô + gzip", () => {
  const r = { code: "8930000000001", names: { product_name_vi: "Muối", product_name: "Salt" }, brands: "Co.op", generic: {}, fronts: [{ key: "front_vi", imgid: "1", rev: "4" }] };
  assert.deepEqual(catalogProduct(r), { code: "8930000000001", name: "Muối", brand: "Co.op", img: "front_vi.4", text: "Muối Salt Co.op" });
  assert.equal("img" in catalogProduct({ ...r, fronts: [] }), false);
  const products = [catalogProduct(r)];
  const s = catalogSize(products);
  const json = catalogJson(catalogMeta({ withNameBrand: true, count: 1, date: "2026-11-13" }), products);
  assert.equal(s.raw, Buffer.byteLength(json));
  assert.equal(s.gzip, zlib.gzipSync(json, { level: 9 }).length);
});

test("catalogMeta: nguon mặc định = câu cũ; danh mục app sinh lại trùng từng byte", () => {
  assert.equal(catalogMeta({ withNameBrand: true, count: 1, date: "x" }).nguon, NGUON_VN);
  assert.equal(catalogMeta({ withNameBrand: true, count: 1, date: "x", nguon: NGUON_VN_893 }).nguon, NGUON_VN_893);
  assert.match(NGUON_VN_893, /en:vietnam hoặc mã vạch 13 số bắt đầu bằng 893$/);
  const file = new URL("../../../public/chup-mat-do/danh-muc-vn.json", import.meta.url);
  const text = fs.readFileSync(file, "utf8");
  const { meta, products } = JSON.parse(text);
  const again = catalogJson(catalogMeta({ withNameBrand: true, count: products.length, date: meta.ngayXuat }), products);
  assert.equal(again, text);
});

test("buildExtended: danh mục cũ trước (nguyên bản ghi, nguyên thứ tự), sp mới nối sau theo rankCompare; luật chọn như cũ", () => {
  const old = [{ code: "2", name: "B", brand: "", text: "B cũ" }, { code: "1", name: "A", brand: "", text: "A cũ" }];
  const rec = (code, extra) => ({ code, names: { product_name: `sp ${code}` }, brands: "", generic: {}, fronts: [], vn: false, ...extra });
  const records = [
    rec("1", { vn: true, names: { product_name: "A mới" } }), // đã có trong danh mục cũ: giữ bản cũ
    rec("8930000000003", { unique_scans_n: 1 }),
    rec("8930000000004", { unique_scans_n: 5 }),
    rec("8930000000004", { unique_scans_n: 9 }), // mã trùng: giữ bản đầu
    rec("5000000000005", { vn: true, completeness: 0.9 }),
    rec("5000000000006"), // không vn, không 893
    rec("893000000007"), // 12 số: không tính là đầu 893
    rec("8930000000008", { names: {} }), // chữ tìm rỗng
  ];
  const { products, added } = buildExtended(old, records);
  assert.equal(added, 3);
  assert.deepEqual(products.slice(0, 2), old);
  assert.deepEqual(products.slice(2).map((p) => p.code), ["8930000000004", "8930000000003", "5000000000005"]);
  assert.deepEqual(products[2], { code: "8930000000004", name: "sp 8930000000004", brand: "", text: "sp 8930000000004 " }); // docText nối cả brand rỗng (như danh mục cũ)
  assert.throws(() => buildExtended([old[0], old[0]], []), /trùng/);
});

// ---- gợi ý reviewer vòng 2 (vòng 3 P1) ----
// Thư mục tạm: NANG_T1_TMP hoặc TEMP (đợt này đặt ở ổ D, không ghi vào ổ C), không có thì os.tmpdir().
const mkTmp = () => fs.mkdtempSync(path.join(process.env.NANG_T1_TMP || process.env.TEMP || os.tmpdir(), "nang-t1-test-"));

test("writeExtended: gzip tính một lần, kiểm trần TRƯỚC khi ghi (vượt trần -> không ghi file)", () => {
  const dir = mkTmp();
  try {
    const appFile = path.join(dir, "app.json");
    const extFile = path.join(dir, "ext.json");
    const old = [{ code: "1", name: "A", brand: "", text: "A cũ" }];
    fs.writeFileSync(appFile, catalogJson(catalogMeta({ withNameBrand: true, count: 1, date: "x" }), old), "utf8");
    const recs = [{ code: "8930000000003", names: { product_name: "Muối" }, brands: "Co.op", generic: {}, fronts: [], vn: false }];
    fs.writeFileSync(extFile, JSON.stringify(recs), "utf8");
    const over = path.join(dir, "over.json");
    const r1 = writeExtended({ appFile, extFile, outFile: over, date: "x", cap: 10 });
    assert.equal(r1.overCap, true);
    assert.equal(r1.written, false);
    assert.equal(fs.existsSync(over), false, "vượt trần thì không được ghi file");
    const ok = path.join(dir, "ok.json");
    const r2 = writeExtended({ appFile, extFile, outFile: ok, date: "x" });
    assert.equal(r2.overCap, false);
    assert.equal(r2.written, true);
    assert.equal(r2.sameHead, true);
    assert.equal(r2.n, 2);
    const s = fs.readFileSync(ok, "utf8");
    assert.equal(r2.raw, Buffer.byteLength(s));
    assert.equal(r2.gzip, zlib.gzipSync(s, { level: 9 }).length);
    assert.equal(r1.gzip, r2.gzip); // cùng nội dung -> cùng số, dù không ghi
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("diffBaseline: so vị trí, câu tìm, top5, mọi điểm scores (cả vị trí 3–6), idfSum, norm", () => {
  const row = (over = {}) => ({ code: "a", rank: 1, query: "q", top5: ["a", "b"], top1Score: 9, top2Score: 5, idfSum: 10, norm: 0.9, scores: [9, 5, 4, 3, 2, 1], ...over });
  assert.deepEqual(diffBaseline([row()], [row()]), []);
  assert.deepEqual(diffBaseline([row({ scores: [9, 5, 4, 3, 2, 1.5] })], [row()]), ["a"]); // điểm vị trí 6
  assert.deepEqual(diffBaseline([row({ scores: [9, 5, 4.2, 3, 2, 1] })], [row()]), ["a"]); // điểm vị trí 3
  assert.deepEqual(diffBaseline([row({ scores: [9, 5, 4, 3, 2] })], [row()]), ["a"]); // thiếu điểm
  assert.deepEqual(diffBaseline([row({ idfSum: 10.5 })], [row()]), ["a"]);
  assert.deepEqual(diffBaseline([row({ norm: 0.8 })], [row()]), ["a"]);
  assert.deepEqual(diffBaseline([row({ query: "x" })], [row()]), ["a"]);
  assert.deepEqual(diffBaseline([row({ rank: 2 })], [row()]), ["a"]);
  assert.deepEqual(diffBaseline([row({ top5: ["b", "a"] })], [row()]), ["a"]);
  // mốc vòng 1 không có scores: bỏ qua phần scores, trừ khi requireScores
  const { scores, ...old } = row();
  assert.equal(scores.length, 6);
  assert.deepEqual(diffBaseline([row()], [old]), []);
  assert.deepEqual(diffBaseline([row()], [old], { requireScores: true }), ["a"]);
  assert.deepEqual(diffBaseline([row(), row({ code: "b" })], [row()]), ["b", "số dòng 2 ≠ 1"]);
});

test("loadNen: chưa có file nền -> lỗi (không tự tạo); --nen-moi -> ghi nền mới từ mốc; có file -> đọc + thời gian", () => {
  const dir = mkTmp();
  try {
    const file = path.join(dir, "v2-nen.json");
    assert.throws(() => loadNen(file), /--nen-moi/);
    assert.equal(fs.existsSync(file), false, "không được tự tạo file nền");
    const writes = [];
    const fresh = loadNen(file, { nenMoi: true, write: (n) => { writes.push(n); fs.writeFileSync(file, JSON.stringify(n), "utf8"); } });
    assert.deepEqual(fresh.nen, { opts: {}, kept: [] });
    assert.equal(fresh.fresh, true);
    assert.equal(fresh.stamp, null);
    assert.equal(writes.length, 1);
    fs.writeFileSync(file, JSON.stringify({ opts: { x: 1 }, kept: [{ cach: "a", diem: "a1" }] }), "utf8");
    const got = loadNen(file);
    assert.deepEqual(got.nen.opts, { x: 1 });
    assert.equal(got.fresh, false);
    assert.match(got.stamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(got.file, file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
