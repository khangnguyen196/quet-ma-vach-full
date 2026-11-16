// Test phần thuần của g2-di-qua-do.mjs (đợt g2-di-qua vòng 1): bản sao G2 (g2Local) trùng G2 của src/ từng ca (danh
// mục 1.452 + kho phụ 893 thật làm ứng viên máy chủ, fixture OFF 7Up thật), mục "đi qua được" (khớp 0 từ với 1.452),
// khóa ca. Không gọi mạng, không đọc dữ liệu đo ở D:\tmp.
// Vòng 3: src đã cài c-idf (serverMerge = G2 + c-idf), nên "G2 nền" của các test = g2Local (không phụ thuộc src); g2Local
// so với G2 của src = mergeFront TẮT serverIdf trên serverJoin; serverMerge mới so methodMerge("c-idf").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import * as fr from "../../../src/front-rank.js";
import { parseSearch } from "../../../src/off-search.js";
import { serverMerge, serverCandidates, serverJoin, SERVER_MERGE_OPTS } from "../../../src/front-server.js";
import { bm25DocScore, offDoc, mergeFront } from "../../../src/front-merge.js";
import {
  g2Local, passThrough, keyOf, applyGuard, rankIn, joinServer, judge, pickMethod, targetOf, improvesOver, METHOD_ORDER,
  METHOD_NAMES, BASE_TARGET, FOREIGN_CODES, BULDAK_CODE, methodMerge, insertAfterLock, capList, idfScorer, srvScorer,
  ruleBlockOf, RULE_SHA, RULE_SHA256, sha256Of,
} from "../g2-di-qua-do.mjs";
import { mergeByMethod } from "../kho-lon-do.mjs";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const products = read("../../../public/chup-mat-do/danh-muc-vn.json").products;
const extra = read("../../../public/chup-mat-do/kho-phu-893.json").products;
const offReal = { ok: true, hits: parseSearch(read("../../../tests/fixtures/off-7up-ngoai.json")) };
const rIndex = fr.buildRankIndex(t1, products);
const xIndex = fr.buildRankIndex(t1, extra);
const ctx = { t1, rIndex, products };
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));

// ---- dữ liệu giả cho các cách (P4): danh mục mini 7 sp, ứng viên máy chủ tự dựng ----
const MINI = [["8930000000001", "Mi tom chua cay Hao Hao"], ["8930000000002", "Mi tom Omachi"], ["8930000000003", "Mi tom Kokomi"],
  ["8930000000004", "Mi tom Gau do"], ["8930000000005", "Mi tom Vifon"], ["8930000000006", "Mi tom Miliket"], ["8930000000007", "Sua tuoi"]]
  .map(([code, text]) => ({ code, name: text, brand: "", text }));
const mI = fr.buildRankIndex(t1, MINI);
const mctx = { t1, rIndex: mI, products: MINI };
const sv = (code, text, score, vn = false) => ({ code, name: text, brand: "", img: "", vn, text, grp: vn ? "vn" : "th", score });
const RU = sv("8852052150101", "Hanami Ruaypuan", 30);
const ZZ = sv("8850000000002", "Zzz qqq", 20);
const MT = sv("8850000000003", "Mi tom Thai", 10);
const NET = { ok: false, kind: "network" };
const fMi = fr.rankFromItems(t1, mI, itemsOf(["Mi tom chua cay", "Ruaypuan Hanami"])); // T1 đủ 5 mục
const fSua = fr.rankFromItems(t1, mI, itemsOf(["Sua tuoi", "Ruaypuan Hanami"])); // T1 1 mục
// G2 nền (vòng 3: g2Local, không phụ thuộc serverMerge của src đã cài c-idf)
const g2Of = (found, S, off = NET) => g2Local(mctx, found, off, S);
/** G2 của src không qua serverMerge: mergeFront TẮT serverIdf trên serverJoin (= serverMerge ở b588ed8). */
const g2Src = (c, found, off, S) => mergeFront(c.t1, c.rIndex, c.products, found, serverJoin(off, S), { ...SERVER_MERGE_OPTS, serverIdf: false });
const run = (name, found, S, off = NET) => methodMerge(name, mctx, found, off, S, { called: true });
const codes = (l) => l.map((x) => x.code);
const offCount = (l) => l.filter((x) => x.source === "off").length;

test("các cách: S rỗng / không mục nào đi qua được → giống hệt G2 nền (trừ G3)", () => {
  for (const name of METHOD_ORDER) {
    for (const found of [fMi, fSua]) {
      for (const off of [NET, offReal]) {
        assert.deepEqual(run(name, found, [], off), g2Of(found, [], off), `${name} S rỗng`);
      }
    }
  }
  // S chỉ có mục khớp ≥ 1 từ 1.452 → a-* / b* không đổi
  for (const name of ["a-lap", "a-off", "a-top", "b2", "b3"]) assert.deepEqual(run(name, fMi, [MT]), g2Of(fMi, [MT]), name);
  assert.deepEqual(run("a-off", null, [RU]), []);
  assert.throws(() => run("x", fMi, [RU]), /cách không có/);
});

test("a-lap: S[0] đi qua được chỉ lấp chỗ trống", () => {
  assert.equal(g2Of(fMi, [RU]).length, 5);
  assert.deepEqual(run("a-lap", fMi, [RU]), g2Of(fMi, [RU]));
  assert.deepEqual(codes(run("a-lap", fSua, [RU, ZZ])), ["8930000000007", RU.code]);
  // S[0] không đi qua được (khớp 1.452) → không lấp dù S[1] đi qua được
  const SU = sv("8850000000004", "Sua tuoi Thai", 40);
  assert.equal(passThrough(mctx, fSua, [SU]).length, 0);
  assert.deepEqual(run("a-lap", fSua, [SU, RU]), g2Of(fSua, [SU, RU]));
});

test("a-off: S[0] chèn sau 3 vị trí khóa, dùng chỗ offMax; = g3Merge một mục", () => {
  const g2 = g2Of(fMi, [RU]);
  const got = run("a-off", fMi, [RU]);
  assert.deepEqual(codes(got.slice(0, 3)), codes(g2.slice(0, 3)));
  assert.equal(got[3].code, RU.code);
  assert.equal(got[3].source, "off");
  assert.equal(got.length, 5);
  assert.deepEqual(codes(got), codes(insertAfterLock(g2, [got[3]])));
  // mục OFF của g2 ở vị trí 4–5 nhường chỗ offMax cho S[0], chỉ lấp chỗ trống
  const offItem = { code: "9999999999999", source: "off" };
  const base = [...g2.slice(0, 4), offItem];
  assert.deepEqual(codes(insertAfterLock(base, [{ code: RU.code, source: "off" }])), [...codes(g2.slice(0, 3)), RU.code, g2[3].code]);
  // ít hơn 3 mục: chèn ngay sau
  assert.deepEqual(codes(run("a-off", fSua, [RU])), ["8930000000007", RU.code]);
});

test("a-top: S[0] có từ của câu tìm → vị trí 1, phần còn lại giữ thứ tự, mục OFF khác chỉ lấp chỗ trống; không có từ → như a-off", () => {
  const g2 = g2Of(fMi, [RU]);
  const got = run("a-top", fMi, [RU]);
  assert.equal(got[0].code, RU.code);
  assert.deepEqual(codes(got.slice(1)), codes(g2.slice(0, 4)));
  // S[0] đi qua được nhưng không có từ nào của câu tìm (rawMatched 0) → như a-off
  assert.deepEqual(run("a-top", fMi, [ZZ]), run("a-off", fMi, [ZZ]));
  assert.notEqual(run("a-top", fMi, [ZZ])[0].code, ZZ.code);
  assert.deepEqual(capList([{ code: "1", source: "off" }, { code: "2", source: "catalog" }, { code: "3", source: "off" }], { k: 2, offMax: 0 }).map((x) => x.code), ["2", "1"]);
});

test("b2 / b3: các mục đi qua được trong 2 / 3 mục đầu của S tranh 1 chỗ offMax: mục trước thắng, mục sau chỉ lấp chỗ trống", () => {
  // đủ 5 mục: chỉ S[0] vào (chỗ offMax), S[1] không còn chỗ trống
  assert.deepEqual(codes(run("b2", fMi, [RU, ZZ])), codes(run("a-off", fMi, [RU])));
  // T1 1 mục: S[0] lấy chỗ offMax, S[1] lấp chỗ trống; b3 thêm S[2] (khớp 0 từ với câu sua / tuoi)
  assert.deepEqual(codes(run("b2", fSua, [RU, ZZ, MT])), ["8930000000007", RU.code, ZZ.code]);
  assert.deepEqual(codes(run("b3", fSua, [RU, ZZ, MT])), ["8930000000007", RU.code, ZZ.code, MT.code]);
  assert.ok(offCount(run("b3", fSua, [RU, ZZ, MT])) === 3);
  // S[0] khớp 1.452, S[1] đi qua được → b2 vẫn chèn S[1] (a-off thì không)
  assert.deepEqual(codes(run("b2", fMi, [MT, RU])).slice(3, 4), [RU.code]);
  assert.deepEqual(run("a-off", fMi, [MT, RU]), g2Of(fMi, [MT, RU]));
});

test("c-srv: điểm mục máy chủ ngoài 1.452 = điểm gợi ý 1 × score / score S[0]; không bỏ mục khớp 0 từ; giữ 3 vị trí khóa", () => {
  const MT40 = { ...MT, score: 40 };
  const g2 = g2Of(fMi, [MT40, RU]);
  const got = run("c-srv", fMi, [MT40, RU]);
  assert.deepEqual(codes(got.slice(0, 3)), codes(g2.slice(0, 3)));
  assert.equal(got[3].code, MT.code); // S[0] (khớp 1.452 nhưng điểm thấp ở G2) lên chỗ offMax nhờ điểm máy chủ
  assert.notEqual(g2[3]?.code, MT.code);
  // S[0] đi qua được (khớp 0 từ) cũng không bị bỏ
  assert.equal(run("c-srv", fMi, [RU, MT])[3].code, RU.code);
  const sc = srvScorer([MT40, RU]);
  assert.deepEqual(sc(RU, { ref: 8, m1452: 0 }), { score: 8 * 30 / 40, matched: 1 });
  assert.deepEqual(sc(MT40, { ref: 8, m1452: 2 }), { score: 8, matched: 2 });
  assert.deepEqual(srvScorer([{ ...MT, score: 0 }])(MT, { ref: 6, m1452: 0 }), { score: 0, matched: 1 });
  // hòa điểm: cùng score máy chủ → hàng VN trước (như G2), rồi thứ tự vào
  const A1 = sv("8850000000011", "Aaa bbb", 10);
  const A2 = sv("8850000000012", "Ccc ddd", 10, true);
  assert.deepEqual(codes(run("c-srv", fSua, [A1, A2])), ["8930000000007", A2.code, A1.code]);
});

test("c-idf: BM25 trên text ứng viên, từ ngoài từ vựng 1.452 dùng idf lớn nhất; đủ 3 từ + điểm đủ → offPromote lên vị trí 1", () => {
  let maxIdf = 0;
  for (const v of mI.index.idf.values()) maxIdf = Math.max(maxIdf, v);
  const doc = { m: new Map([["ruaypuan", 1], ["mi", 1]]), len: 2 };
  const { score, matched } = idfScorer(mI.index)(RU, { doc, query: ["ruaypuan", "mi", "khac"] });
  assert.equal(matched, 2);
  const tf = (1 * (mI.index.k1 + 1)) / (1 + mI.index.k1 * (1 - mI.index.b + mI.index.b * (2 / mI.index.avgdl)));
  assert.ok(Math.abs(score - (maxIdf + mI.index.idf.get("mi")) * tf) < 1e-9);
  // 2 từ lạ: không đủ minWords 3 → chỗ offMax sau 3 vị trí khóa
  const got = run("c-idf", fMi, [RU]);
  assert.deepEqual(codes(got.slice(0, 3)), codes(g2Of(fMi, [RU]).slice(0, 3)));
  assert.equal(got[3].code, RU.code);
  // 3 từ khớp → được đẩy lên vị trí 1 (offPromote của G2 với điểm mới)
  const f3 = fr.rankFromItems(t1, mI, itemsOf(["Mi tom", "Ruaypuan Hanami Prawn"]));
  const RU3 = sv("8852052150101", "Hanami Ruaypuan Prawn crackers", 30);
  assert.equal(run("c-idf", f3, [RU3])[0].code, RU3.code);
  // mục khớp 0 từ kể cả từ lạ → vẫn bị bỏ
  assert.deepEqual(run("c-idf", fMi, [ZZ]), g2Of(fMi, [ZZ]));
});

// ---- vòng 2 (NÊN SỬA 1): mã có ở cả OFF và S → c-srv / c-idf chấm theo bản MÁY CHỦ, passThrough theo tài liệu như mergeFront ----
const offHit = (code, text) => ({ code, name: text, brand: "", img: "", vn: false, text });
const offDup = (...hits) => ({ ok: true, hits });

test("c-srv: mục máy chủ trùng mã OFF vẫn ra điểm gợi ý 1 × score / score S[0] (bản OFF không có score), không ra 0", () => {
  const S = [{ ...MT, score: 40 }, RU];
  const off = offDup(offHit(RU.code, "Ruaypuan khac"));
  const got = run("c-srv", fSua, S, off);
  const ref = fSua.hits[0].score;
  const it = got.find((x) => x.code === RU.code);
  assert.ok(it, "mục trùng có trong kết quả");
  assert.ok(Math.abs(it.score - ref * (30 / 40)) < 1e-9, `điểm ${it.score} ≠ ${ref * 0.75}`);
  assert.ok(it.score > 0);
  // trực tiếp: tra score theo mã, không theo bản truyền vào
  assert.deepEqual(srvScorer(S)(offHit(RU.code, "x"), { ref: 8, m1452: 0 }), { score: 6, matched: 1 });
  assert.deepEqual(srvScorer(S)(offHit("8850000009999", "x"), { ref: 8, m1452: 0 }), { score: 0, matched: 1 });
});

test("c-idf: mục máy chủ trùng mã OFF chấm BM25 trên chữ của bản máy chủ, không trên chữ của OFF", () => {
  const S = [RU]; // chữ máy chủ "Hanami Ruaypuan": khớp ruaypuan + hanami
  const off = offDup(offHit(RU.code, "Ruaypuan Xyz")); // chữ OFF: chỉ khớp ruaypuan
  const want = idfScorer(mI.index)(RU, { doc: offDoc(t1, RU.text), query: fSua.query });
  const fromOff = idfScorer(mI.index)(RU, { doc: offDoc(t1, "Ruaypuan Xyz"), query: fSua.query });
  assert.equal(want.matched, 2);
  assert.equal(fromOff.matched, 1);
  assert.notEqual(want.score, fromOff.score);
  const it = run("c-idf", fSua, S, off).find((x) => x.code === RU.code);
  assert.ok(it, "mục trùng có trong kết quả");
  assert.ok(Math.abs(it.score - want.score) < 1e-9, `điểm ${it.score} ≠ ${want.score} (chữ OFF cho ${fromOff.score})`);
  // trực tiếp: có t1 + S thì bỏ qua doc truyền vào, dùng chữ bản S cùng mã
  const sc = idfScorer(mI.index, t1, S);
  assert.deepEqual(sc(offHit(RU.code, "khac"), { doc: offDoc(t1, "Ruaypuan Xyz"), query: fSua.query }), want);
});

test("passThrough qua methodMerge: mã trùng OFF dùng chữ của OFF (tài liệu mergeFront dùng), vị trí theo S", () => {
  const SU = sv("8850000000005", "Sua tuoi Thai", 40); // chữ máy chủ khớp sua / tuoi của 1.452
  const off = offDup(offHit(SU.code, "Zzz qqq")); // chữ OFF khớp 0 từ → G2 bỏ
  const g2 = g2Of(fSua, [SU, RU], off);
  assert.equal(g2.some((x) => x.code === SU.code), false, "G2 bỏ mục (chấm theo chữ OFF)");
  assert.equal(passThrough(mctx, fSua, [SU]).length, 0, "theo chữ máy chủ thì không đi qua");
  const got = run("a-off", fSua, [SU, RU], off);
  assert.equal(got[1]?.code, SU.code, "S[0] đi qua được theo chữ OFF → a-off chèn");
  assert.equal(got[1].name, "Zzz qqq");
  // không trùng mã → như cũ (chữ máy chủ)
  assert.deepEqual(run("a-off", fSua, [SU, RU], NET), g2Of(fSua, [SU, RU], NET));
});

test("G3 = mergeByMethod G3 của kho-lon-do.mjs", () => {
  for (const S of [[RU], [MT, RU], []]) {
    assert.deepEqual(run("G3", fMi, S), mergeByMethod({ t1, rIndex: mI, products: MINI, found: fMi, off: NET, S, method: "G3" }));
  }
});

function goodR() {
  const loss = {};
  for (const s of ["B", "A"]) for (const c of ["i", "ii"]) loss[`${s}|${c}`] = { lostTop1: [], out5: [] };
  const foreign = Object.fromEntries(FOREIGN_CODES.map((code, j) => [code, { i: { base: j === 0 ? 4 : null, got: j === 0 ? 4 : 1 }, ii: { base: j === 0 ? 4 : null, got: j === 0 ? 3 : null } }]));
  return {
    loss, luiDiff: [], s7: { "may|i": 1, "may|ii": 1, "go|i": 1, "go|ii": 1 }, buldak: { i: BULDAK_CODE, ii: BULDAK_CODE },
    salt: { "may|i": "open", "may|ii": "open", "lui|i": "open", "lui|ii": "open" }, confidenceNull: true, foreign, qsDiff: [], l7: true,
  };
}

test("luật: đủ cổng → qua; từng cổng hỏng → trượt đúng cổng", () => {
  assert.equal(judge(goodR()).pass, true);
  const cases = [
    ["L1a", (r) => { r.loss["A|ii"].lostTop1 = ["x"]; }],
    ["L1a", (r) => { r.loss["B|i"].out5 = ["x"]; }],
    ["L1a", (r) => { delete r.loss["B|ii"]; }],
    ["L1b", (r) => { r.luiDiff = ["B|1|anh|i"]; }],
    ["L1b", (r) => { r.luiDiff = undefined; }],
    ["L2", (r) => { r.s7["may|ii"] = 2; }],
    ["L2", (r) => { r.s7["go|i"] = null; }],
    ["L3", (r) => { r.buldak.ii = "8801073115378"; }],
    ["L4", (r) => { r.confidenceNull = false; }],
    ["L4", (r) => { r.salt["lui|ii"] = "none"; }],
    ["L5", (r) => { r.foreign[FOREIGN_CODES[0]].i.got = null; }],
    ["L5", (r) => { r.foreign[FOREIGN_CODES[1]].i = { base: 1, got: 2 }; }],
    ["L5", (r) => { delete r.foreign[FOREIGN_CODES[2]]; }],
    ["L6", (r) => { r.qsDiff = ["7up|x|may"]; }],
    ["L7", (r) => { r.l7 = false; }],
  ];
  for (const [gate, mut] of cases) {
    const r = goodR();
    mut(r);
    const v = judge(r);
    assert.equal(v.pass, false, gate);
    assert.equal(v.gates[gate], false, gate);
    assert.equal(Object.values(v.gates).filter((x) => !x).length, 1, gate);
  }
  // hai cổng hỏng cùng lúc (L2 + L6) → đúng hai cổng false, câu lỗi nêu từng cổng (vòng 2: thay dòng lặp lại test đầu)
  const r2 = goodR();
  r2.s7["go|ii"] = 3;
  r2.qsDiff = ["B|8934563163150|anh"];
  const v2 = judge(r2);
  assert.equal(v2.pass, false);
  assert.deepEqual(Object.entries(v2.gates).filter(([, ok]) => !ok).map(([g]) => g), ["L2", "L6"]);
  assert.ok(v2.fails.includes("L2 7Up go|ii: vị trí 3"), v2.fails.join("; "));
  assert.ok(v2.fails.some((s) => s.startsWith("L6 ") && s.includes("B|8934563163150|anh")), v2.fails.join("; "));
  assert.equal(v2.fails.length, 2);
});

test("ruleBlockOf: lấy khối từ đầu dòng dấu mở đến hết dòng dấu đóng; thiếu dấu → null; đổi một ký tự → khác", () => {
  const open = ["LUẬT", "CHỐT", "TRƯỚC"].join(" ");
  const close = ["HẾT", "KHỐI", "LUẬT"].join(" ");
  const txt = `a\n// ${open} x\nb\n// ${close}\nc\n// ${close}\n`;
  assert.equal(ruleBlockOf(txt), `// ${open} x\nb\n// ${close}\n`);
  assert.equal(ruleBlockOf("a\nb\n"), null);
  assert.equal(ruleBlockOf(`// ${open}\n`), null);
  assert.equal(ruleBlockOf(null), null);
  assert.notEqual(ruleBlockOf(txt.replace("b\n", "B\n")), ruleBlockOf(txt));
  // file khung đo hiện tại có khối luật, mở ở dòng đầu khối (không phải trong hàm này)
  const self = ruleBlockOf(fs.readFileSync(new URL("../g2-di-qua-do.mjs", import.meta.url), "utf8"));
  assert.ok(self && self.startsWith("// LU") && self.includes("export function pickMethod"));
  assert.equal(RULE_SHA, "1d56860");
  // vòng 3: khối luật hiện tại trùng từng byte khối ở 1d56860 (sha256 ghi cứng); sửa một ký tự → khác
  assert.equal(sha256Of(self), RULE_SHA256);
  assert.notEqual(sha256Of(self.replace("L1a", "L1A")), RULE_SHA256);
});

test("luật: mục tiêu, chọn (f5 > f1 > ruaypuan > thứ tự), G3 không được chọn, không hơn nền → không giữ", () => {
  assert.deepEqual(targetOf({ a: { i: 1, ii: 4 }, b: { i: null, ii: 2 } }, { i: 3, ii: null }), { f5: 3, f1: 1, ru1: 0, ru5: 1 });
  assert.deepEqual(BASE_TARGET, { f5: 4, f1: 0, ru1: 0, ru5: 0 });
  assert.deepEqual(METHOD_ORDER, ["a-lap", "a-off", "a-top", "b2", "b3", "c-srv", "c-idf"]);
  assert.equal(METHOD_NAMES.at(-1), "G3");
  const t = (f5, f1, ru1 = 0, ru5 = 0) => ({ f5, f1, ru1, ru5 });
  const list = [
    { name: "c-idf", pass: true, t: t(8, 4) },
    { name: "b2", pass: true, t: t(8, 4) },
    { name: "a-top", pass: true, t: t(8, 3, 1, 1) },
    { name: "G3", pass: true, t: t(12, 6) },
    { name: "a-lap", pass: false, t: t(12, 6) },
  ];
  assert.deepEqual(pickMethod(list), { name: "b2", improves: true });
  assert.deepEqual(pickMethod([{ name: "a-top", pass: true, t: t(8, 4, 0, 1) }, { name: "a-off", pass: true, t: t(8, 4, 0, 0) }]), { name: "a-top", improves: true });
  assert.deepEqual(pickMethod([{ name: "a-off", pass: true, t: t(4, 0) }]), { name: "a-off", improves: false });
  assert.deepEqual(pickMethod([{ name: "G3", pass: true, t: t(12, 12) }]), { name: null, improves: false });
  assert.equal(improvesOver(t(4, 0, 0, 1)), true);
  assert.equal(improvesOver(t(4, 0, 0, 0)), false);
});

/** S giả: 10 mục đầu tìm trên kho phụ 893 (+ mục danh mục chen vào đầu nếu có), qua serverCandidates như app. */
function serverS(lines, { withCatalog = 0 } = {}) {
  const r = fr.rankFromItems(t1, xIndex, itemsOf(lines), 10);
  const raw = r.hits.map((h) => { const p = extra[h.i]; return { code: p.code, name: p.name, brand: p.brand ?? "", img: p.img ?? "", text: p.text, grp: "893", score: h.score }; });
  const cat = fr.rankFromItems(t1, rIndex, itemsOf(lines), withCatalog).hits.map((h) => { const p = products[h.i]; return { code: p.code, name: p.name, brand: p.brand ?? "", img: p.img ?? "", text: p.text, grp: "vn", score: h.score + 100 }; });
  return serverCandidates({ candidates: [...cat, ...raw] });
}

const LINES = [
  ["Up", "Soda chanh", "Khong calo"], ["Mi Hao Hao", "tom chua cay"], ["Sua tuoi", "Vinamilk", "khong duong"], ["Ca phe", "G7", "hoa tan"],
  ["Banh quy", "Cosy"], ["Tra xanh", "khong do"], ["Nuoc mam", "Nam Ngu"], ["Ruaypuan", "Hanami", "prawn crackers"], ["Pepsi"], ["Hat nem", "Knorr"],
  ["Keo", "Alpenliebe"], ["Snack", "Oishi", "tom"], ["COOP", "Select", "Mui Bin Tinh Say", "IODIZES REFINED SEA SALT"], ["xyzzy qwerty"],
];

test("g2Local (S rỗng, OFF lỗi / có, S có, S có mục danh mục) trùng G2 của src/ (mergeFront tắt serverIdf) từng mục", () => {
  let n = 0;
  let promoted = 0;
  for (const lines of LINES) {
    const found = fr.rankFromItems(t1, rIndex, itemsOf(lines));
    for (const S of [[], serverS(lines), serverS(lines, { withCatalog: 2 })]) {
      for (const off of [{ ok: false, kind: "network" }, { ok: false, kind: "none" }, offReal, { ok: true, hits: [] }]) {
        const want = g2Src(ctx, found, off, S);
        assert.deepEqual(g2Local(ctx, found, off, S), want, `${lines.join("/")} S ${S.length} off ${off.ok}`);
        if (want[0] && want[0].source === "off" && found.hits[0] && want[0].code !== found.hits[0].code) promoted++;
        n++;
      }
    }
  }
  assert.equal(n, LINES.length * 12);
  assert.ok(promoted > 0, "có ít nhất một ca offPromote đẩy mục máy chủ lên vị trí 1 (ca 7Up)");
});

// Vòng 3: app đã cài c-idf → serverMerge của src = methodMerge("c-idf") của khung đo từng mục (cùng ca trên + mini).
test("serverMerge của src (c-idf) trùng methodMerge(\"c-idf\") của khung đo từng mục; khác G2 nền ở ≥ 1 ca", () => {
  let n = 0;
  let differs = 0;
  const check = (c, found, off, S, label) => {
    const want = methodMerge("c-idf", c, found, off, S, { called: true });
    const got = serverMerge(c, found, off, S, { called: true }).merged;
    assert.deepEqual(got, want, label);
    if (JSON.stringify(got) !== JSON.stringify(g2Local(c, found, off, S))) differs++;
    n++;
  };
  for (const lines of LINES) {
    const found = fr.rankFromItems(t1, rIndex, itemsOf(lines));
    for (const S of [[], serverS(lines), serverS(lines, { withCatalog: 2 })]) {
      for (const off of [NET, { ok: false, kind: "none" }, offReal, { ok: true, hits: [] }]) check(ctx, found, off, S, `${lines.join("/")} S ${S.length} off ${off.ok}`);
    }
  }
  const RU3 = sv("8852052150101", "Hanami Ruaypuan Prawn crackers", 30);
  const f3 = fr.rankFromItems(t1, mI, itemsOf(["Mi tom", "Ruaypuan Hanami Prawn"]));
  for (const S of [[RU], [RU3], [MT, RU3, ZZ], [RU3, RU]]) for (const found of [fMi, fSua, f3]) {
    for (const off of [NET, offDup(offHit(RU.code, "Ruaypuan Xyz")), offReal]) check(mctx, found, off, S, `mini ${S.map((h) => h.code).join(",")}`);
  }
  assert.equal(n, LINES.length * 12 + 4 * 3 * 3);
  assert.ok(differs > 0, `c-idf phải khác G2 nền ở ≥ 1 ca (khác ${differs}/${n})`);
});

test("g2Local: serverScore chỉ áp cho mục máy chủ ngoài danh mục; trả nguyên điểm thì trùng G2", () => {
  const lines = ["Up", "Soda chanh", "Khong calo"];
  const found = fr.rankFromItems(t1, rIndex, itemsOf(lines));
  const S = serverS(lines);
  const seen = [];
  const same = g2Local(ctx, found, offReal, S, { serverScore: (h, { m1452, doc, index, query }) => { seen.push(h.code); return { score: bm25DocScore(index, doc, query).score, matched: m1452 }; } });
  assert.deepEqual(same, g2Src(ctx, found, offReal, S));
  const sCodes = new Set(S.map((h) => h.code));
  assert.ok(seen.length > 0 && seen.every((c) => sCodes.has(c)));
  assert.ok(seen.every((c) => !products.some((p) => p.code === c)));
});

test("passThrough: chỉ mục S khớp 0 từ với 1.452 (G2 bỏ), giữ thứ tự S, rawMatched đếm cả từ ngoài từ vựng", () => {
  const lines = ["Ruaypuan", "Hanami"];
  const found = fr.rankFromItems(t1, rIndex, itemsOf(lines));
  assert.ok(found.query.includes("ruaypuan"));
  assert.equal(rIndex.index.idf.has("ruaypuan"), false);
  const S = [
    { code: "8852052150101", name: "Hanami", brand: "Ruaypuan", img: "", vn: false, text: "Hanami Ruaypuan", grp: "th", score: 30 },
    { code: "8850000000002", name: "Something else", brand: "", img: "", vn: false, text: "Something else", grp: "th", score: 20 },
    { code: products[0].code, name: products[0].name, brand: "", img: "", vn: true, text: products[0].text, grp: "vn", score: 10 },
  ];
  const pt = passThrough(ctx, found, S);
  assert.deepEqual(pt.map((x) => [x.j, x.h.code, x.rawMatched]), [[0, "8852052150101", 2], [1, "8850000000002", 0], [2, products[0].code, 0]]);
  assert.equal(pt[0].item.source, "off");
  assert.equal(pt[2].item.source, "catalog");
  assert.equal("extra" in pt[0].item, false);
  // G2 bỏ cả 3 (khớp 0 từ) → nền không có mục nào của S
  const g2 = g2Local(ctx, found, { ok: false, kind: "network" }, S);
  assert.equal(g2.some((x) => S.some((h) => h.code === x.code)), false);
  // mục khớp ≥ 1 từ với 1.452 không đi qua
  const found2 = fr.rankFromItems(t1, rIndex, itemsOf(["Soda chanh", "Up"]));
  const S2 = serverS(["Soda chanh", "Up"]);
  assert.ok(S2.some((h) => h.code === "8934588752117"));
  assert.equal(passThrough(ctx, found2, S2).some((x) => x.h.code === "8934588752117"), false);
});

test("keyOf có kind; rankIn; applyGuard / joinServer như src", () => {
  assert.notEqual(keyOf({ set: "7up", kind: "may", code: "1" }), keyOf({ set: "7up", kind: "go", code: "1" }));
  assert.equal(keyOf({ set: "muoi", kind: "muoi", code: null }), "muoi|muoi|muoi");
  assert.equal(rankIn(["a", "b", "c"], "c"), 3);
  assert.equal(rankIn(["a", "b", "c", "d", "e", "f"], "f"), null);
  const c = (code) => ({ code, source: "catalog" });
  const o = (code) => ({ code, source: "off" });
  assert.deepEqual(applyGuard([c("1"), o("x"), o("y"), c("2"), c("3"), c("4")], [c("1")]).map((x) => x.code), ["1", "x", "2", "3", "4"]);
  assert.deepEqual(applyGuard([c("1"), o("x"), o("y")], [c("1")]).map((x) => x.code), ["1", "x", "y"]);
  const { joined, sCodes } = joinServer({ ok: true, hits: [{ code: "1" }, { code: "2", extra: true }] }, [{ code: "2", extra: true }, { code: "3" }]);
  assert.deepEqual(joined.hits, [{ code: "1", extra: true }, { code: "2" }, { code: "3" }]);
  assert.deepEqual([...sCodes], ["2", "3"]);
  assert.equal(joinServer({ ok: false, kind: "network" }, []).joined, null);
});
