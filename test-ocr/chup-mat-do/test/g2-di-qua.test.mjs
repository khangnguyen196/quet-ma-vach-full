// Test phần thuần của g2-di-qua-do.mjs (đợt g2-di-qua vòng 1): bản sao G2 (g2Local) trùng serverMerge của src/ từng
// ca (danh mục 1.452 + kho phụ 893 thật làm ứng viên máy chủ, fixture OFF 7Up thật), mục "đi qua được" (khớp 0 từ với
// 1.452), khóa ca. Không gọi mạng, không đọc dữ liệu đo ở D:\tmp.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import * as fr from "../../../src/front-rank.js";
import { parseSearch } from "../../../src/off-search.js";
import { serverMerge, serverCandidates } from "../../../src/front-server.js";
import { bm25DocScore } from "../../../src/front-merge.js";
import {
  g2Local, passThrough, keyOf, applyGuard, rankIn, joinServer, judge, pickMethod, targetOf, improvesOver, METHOD_ORDER,
  METHOD_NAMES, BASE_TARGET, FOREIGN_CODES, BULDAK_CODE,
} from "../g2-di-qua-do.mjs";

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
  // L5: nền ngoài 5 → được bất kỳ; nền 4 → 3 vẫn trong 5 (không đòi giữ đúng vị trí, chỉ vị trí 1 / trong 5)
  assert.equal(judge(goodR()).gates.L5, true);
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

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const products = read("../../../public/chup-mat-do/danh-muc-vn.json").products;
const extra = read("../../../public/chup-mat-do/kho-phu-893.json").products;
const offReal = { ok: true, hits: parseSearch(read("../../../tests/fixtures/off-7up-ngoai.json")) };
const rIndex = fr.buildRankIndex(t1, products);
const xIndex = fr.buildRankIndex(t1, extra);
const ctx = { t1, rIndex, products };
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));
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

test("g2Local (S rỗng, OFF lỗi / có, S có, S có mục danh mục) trùng serverMerge của src/ từng mục", () => {
  let n = 0;
  let promoted = 0;
  for (const lines of LINES) {
    const found = fr.rankFromItems(t1, rIndex, itemsOf(lines));
    for (const S of [[], serverS(lines), serverS(lines, { withCatalog: 2 })]) {
      for (const off of [{ ok: false, kind: "network" }, { ok: false, kind: "none" }, offReal, { ok: true, hits: [] }]) {
        const want = serverMerge(ctx, found, off, S, { called: true }).merged;
        assert.deepEqual(g2Local(ctx, found, off, S), want, `${lines.join("/")} S ${S.length} off ${off.ok}`);
        if (want[0] && want[0].source === "off" && found.hits[0] && want[0].code !== found.hits[0].code) promoted++;
        n++;
      }
    }
  }
  assert.equal(n, LINES.length * 12);
  assert.ok(promoted > 0, "có ít nhất một ca offPromote đẩy mục máy chủ lên vị trí 1 (ca 7Up)");
});

test("g2Local: serverScore chỉ áp cho mục máy chủ ngoài danh mục; trả nguyên điểm thì trùng G2", () => {
  const lines = ["Up", "Soda chanh", "Khong calo"];
  const found = fr.rankFromItems(t1, rIndex, itemsOf(lines));
  const S = serverS(lines);
  const seen = [];
  const same = g2Local(ctx, found, offReal, S, { serverScore: (h, { m1452, doc, index, query }) => { seen.push(h.code); return { score: bm25DocScore(index, doc, query).score, matched: m1452 }; } });
  assert.deepEqual(same, serverMerge(ctx, found, offReal, S, { called: true }).merged);
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
  const g2 = serverMerge(ctx, found, { ok: false, kind: "network" }, S, { called: true }).merged;
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
