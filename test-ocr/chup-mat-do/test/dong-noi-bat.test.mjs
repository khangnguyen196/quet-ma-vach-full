// Test phần thuần của dong-noi-bat-do.mjs (đợt dong-noi-bat vòng 1): tiêu chí dòng rác (a), dòng nổi bật + RRF (b),
// BM25 có trọng số (c), nền trùng rankFromItems / rankFromText, phán / chọn theo luật chốt trước (số giả).
// Không đọc dữ liệu đo (danh mục mini dựng tại chỗ).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import { buildRankIndex, rankFromItems, rankFromText } from "../../../src/front-rank.js";
import {
  isUrlLine, isOddLine, isUiLine, isCapsLine, filterRows, prominentRows, rrfFuse, rowWeights, weightedSearch, methodRank,
  rowsOf, injectJunk, judge, pickMethod, l4Score, methodGrid, METHOD_ORDER, A_VARIANTS, JUNK_LINES, SERVER_K,
} from "../dong-noi-bat-do.mjs";

const PRODUCTS = [
  { code: "8850000000001", text: "Ruaypuan rice noodle tom yum Thailand" },
  { code: "8930000000002", text: "Mi Hao Hao tom chua cay Acecook" },
  { code: "8930000000003", text: "Mi Omachi suon ham" },
  { code: "8930000000004", text: "Google tea snack" },
  { code: "8930000000005", text: "Banh quy bo Cosy" },
  { code: "8930000000006", text: "Tra xanh khong do" },
];
const rI = buildRankIndex(t1, PRODUCTS);
const box = (text, y, h, score = 0.95) => ({ text, score, poly: [[0, y], [200, y], [200, y + h], [0, y + h]] });

test("(a) url / ký tự lạ / chữ giao diện / in hoa", () => {
  assert.equal(isUrlLine("https://www.google.com/search?q=mi"), true);
  assert.equal(isUrlLine("shopee.vn"), true);
  assert.equal(isUrlLine("C:\\Users\\a"), true);
  assert.equal(isUrlLine("a/b/c"), true);
  assert.equal(isUrlLine("Co.op Select"), false);
  assert.equal(isUrlLine("100g/gói"), false);
  assert.equal(isOddLine("12:45 15/11/2026"), true);
  assert.equal(isOddLine("★★★★☆ 4.5 (2,341)"), true);
  assert.equal(isOddLine("Mì 3 Miền 65g"), false);
  assert.equal(isOddLine(""), false);
  assert.equal(isUiLine(t1, "File Edit View History Bookmarks Tools Help"), true);
  assert.equal(isUiLine(t1, "Tìm kiếm trên Google hoặc nhập URL"), true);
  assert.equal(isUiLine(t1, "Đăng nhập"), true);
  assert.equal(isUiLine(t1, "Mì Hảo Hảo tôm chua cay"), false);
  assert.equal(isUiLine(t1, "Google tea"), false);
  assert.equal(isUiLine(t1, "500g"), false);
  assert.equal(isCapsLine("RUAYPUAN"), true);
  assert.equal(isCapsLine("Ruaypuan"), false);
  assert.equal(isCapsLine("7UP"), false);
  assert.equal(isCapsLine("MÌ"), false);
  assert.equal(isCapsLine("HẢO HẢO"), true);
});

test("(a) lọc dòng, ngưỡng độ tin, lọc hết thì quay về mọi dòng", () => {
  const rows = [{ text: "https://x.com/a", conf: 0.99 }, { text: "Ruaypuan", conf: 0.6 }, { text: "New Tab", conf: 0.9 }];
  assert.deepEqual(filterRows(t1, rows, { url: true }).rows.map((r) => r.text), ["Ruaypuan", "New Tab"]);
  assert.deepEqual(filterRows(t1, rows, { ui: true, url: true }).rows.map((r) => r.text), ["Ruaypuan"]);
  assert.deepEqual(filterRows(t1, rows, { conf: 0.7 }).rows.map((r) => r.text), ["https://x.com/a", "New Tab"]);
  const all = filterRows(t1, [{ text: "Đăng nhập", conf: 0.9 }, { text: "Downloads", conf: 0.9 }], A_VARIANTS["a-tong"]);
  assert.equal(all.fellBack, true);
  assert.equal(all.rows.length, 2);
  assert.equal(filterRows(t1, rows, null).rows, rows);
});

test("nền ({}) trùng rankFromItems / rankFromText", () => {
  const items = [box("Google Chrome", 0, 12), box("RUAYPUAN", 40, 60), box("tom yum noodle", 120, 20)];
  const ref = rankFromItems(t1, rI, items);
  const mine = methodRank(t1, rI, rowsOf(t1, { items }), {}, 5);
  assert.deepEqual(mine.hits, ref.hits);
  assert.deepEqual(mine.lines, ref.lines);
  const refT = rankFromText(t1, rI, "Mi Hao Hao\ntom chua cay");
  assert.deepEqual(methodRank(t1, rI, rowsOf(t1, { text: "Mi Hao Hao\ntom chua cay" }), {}, 5).hits, refT.hits);
});

test("(c) β = 0 / không có h → trùng nền; β > 0 ưu tiên dòng to; điểm gắn là BM25 không trọng số", () => {
  const items = [box("Google tea snack", 0, 10), box("Ruaypuan", 30, 50), box("tom", 100, 10)];
  const rows = rowsOf(t1, { items });
  assert.equal(rowWeights(t1, rows, rI.index.idf, rI.index.aliasDf, 0).size, 0);
  assert.deepEqual(weightedSearch(rI.index, ["mi", "tom"], new Map(), 5), t1.bm25Search(rI.index, ["mi", "tom"], 5).map((h) => ({ ...h, wscore: h.score })));
  const base = methodRank(t1, rI, rows, {}, 5);
  const c = methodRank(t1, rI, rows, { c: { beta: 2 } }, 5);
  assert.equal(c.hits[0].code, "8850000000001");
  const w = rowWeights(t1, rows, rI.index.idf, rI.index.aliasDf, 1);
  assert.equal(w.get("ruaypuan"), 5); // trung vị dưới 10 → 1 + 1 × (50 / 10 − 1)
  for (const h of c.hits) assert.equal(h.score, base.hits.find((x) => x.code === h.code)?.score ?? h.score);
  const textRows = rowsOf(t1, { text: "Google tea\nRuaypuan" });
  assert.deepEqual(methodRank(t1, rI, textRows, { c: { beta: 2 } }, 5).hits.map((h) => h.code), methodRank(t1, rI, textRows, {}, 5).hits.map((h) => h.code));
});

test("(b) dòng nổi bật theo h / in hoa, RRF hằng số 60, không có dòng nổi bật → như nền", () => {
  const rows = [{ text: "Google tea snack", h: 10, conf: 0.9 }, { text: "RUAYPUAN", h: 50, conf: 0.9 }, { text: "Tom yum", h: 30, conf: 0.9 }, { text: "MI HAO HAO TOM CHUA", h: 80, conf: 0.9 }];
  assert.deepEqual(prominentRows(t1, rows, { sel: "h", k: 2 }).map((r) => r.text), ["MI HAO HAO TOM CHUA", "RUAYPUAN"]);
  assert.deepEqual(prominentRows(t1, rows, { sel: "hoa", k: 3 }).map((r) => r.text), ["RUAYPUAN"]);
  const f = rrfFuse([[{ i: 1 }, { i: 2 }], [{ i: 2 }, { i: 3 }]], 10);
  assert.deepEqual(f.map((x) => x.i), [2, 1, 3]);
  assert.ok(Math.abs(f[0].s - (1 / 62 + 1 / 61)) < 1e-12);
  const tie = rrfFuse([[{ i: 5 }], [{ i: 4 }]], 10);
  assert.deepEqual(tie.map((x) => x.i), [5, 4]);
  const b = methodRank(t1, rI, rows, { b: { sel: "hoa", k: 1 } }, 5);
  assert.equal(b.lists, 2);
  assert.ok(b.hits.length <= 5);
  const noH = rowsOf(t1, { text: "Google tea\nRUAYPUAN" });
  assert.deepEqual(methodRank(t1, rI, noH, { b: { sel: "h", k: 3 } }, 5).hits.map((h) => h.code), methodRank(t1, rI, noH, {}, 5).hits.map((h) => h.code));
  assert.ok(methodRank(t1, rI, rows, { b: { sel: "h", k: 3 } }, SERVER_K).hits.length <= SERVER_K);
});

test("ca tổng hợp: chèn dòng rác phía trên, chữ thật dời xuống", () => {
  const items = [box("Mi Hao Hao", 5, 30)];
  const out = injectJunk(items);
  assert.equal(out.length, JUNK_LINES.length + 1);
  const rows = rowsOf(t1, { items: out });
  assert.equal(rows[rows.length - 1].text, "Mi Hao Hao");
  assert.equal(rows.length, JUNK_LINES.length + 1);
});

test("lưới cách + thứ tự ưu tiên (a < c < b < (a)+(c) < (a)+(b))", () => {
  const g = methodGrid();
  assert.equal(Object.keys(g).length, 8 + 3 + 6 + 24 + 48);
  assert.equal(METHOD_ORDER[0], "a-c70");
  assert.ok(METHOD_ORDER.indexOf("a-tong-c80") < METHOD_ORDER.indexOf("c-0.5"));
  assert.ok(METHOD_ORDER.indexOf("c-2") < METHOD_ORDER.indexOf("b-h1"));
  assert.ok(METHOD_ORDER.indexOf("b-hoa3") < METHOD_ORDER.indexOf("a-c70+c-0.5"));
  assert.ok(METHOD_ORDER.indexOf("a-tong-c80+c-2") < METHOD_ORDER.indexOf("a-c70+b-h1"));
});

function goodR() {
  const loss = {};
  for (const p of ["may", "lui"]) for (const s of ["B", "A"]) for (const c of ["i", "ii"]) loss[`${p}|${s}|${c}`] = { lostTop1: [], out5: [] };
  return {
    loss,
    s7: { "may|may|i": 1, "may|may|ii": 1, "may|go|i": 1, "may|go|ii": 1 },
    s7lui: { "may|i": { base: 2, got: 2 }, "may|ii": { base: 2, got: 3 }, "go|i": { base: null, got: null }, "go|ii": { base: 1, got: 1 } },
    buldak: { i: { base: "1", got: "1" }, ii: { base: "1", got: "1" } },
    salt: { "may|i": "open", "may|ii": "open", "lui|i": "open", "lui|ii": "none" },
    confidenceNull: true, sMax: 10, fallbackOk: true, l7: true, h3Est: 50, h2Est: 835.3, offSame: true,
  };
}

test("phán: đủ cổng → qua; từng cổng hỏng → trượt đúng cổng", () => {
  assert.equal(judge(goodR()).pass, true);
  const cases = [
    ["L1a", (r) => { r.loss["may|A|ii"].lostTop1 = ["x"]; }],
    ["L1b", (r) => { r.loss["lui|B|i"].out5 = ["x"]; }],
    ["L2", (r) => { r.s7["may|go|ii"] = 2; }],
    ["L2", (r) => { r.s7lui["go|ii"].got = 2; }],
    ["L3", (r) => { r.buldak.ii.got = "2"; }],
    ["L5", (r) => { r.confidenceNull = false; }],
    ["L6", (r) => { r.sMax = 11; }],
    ["L6", (r) => { r.fallbackOk = false; }],
    ["L7", (r) => { r.l7 = false; }],
    ["L8", (r) => { r.h3Est = 201; }],
    ["L9", (r) => { r.offSame = false; }],
  ];
  for (const [gate, mut] of cases) {
    const r = goodR();
    mut(r);
    const v = judge(r);
    assert.equal(v.pass, false, gate);
    assert.equal(v.gates[gate], false, gate);
  }
  const r = goodR();
  r.buldak.i = { base: null, got: "9" };
  assert.equal(judge(r).gates.L3, true);
});

test("chọn: qua cổng, L4 vị trí 1 > trong 5 > thứ tự; không hơn nền → improves false", () => {
  assert.deepEqual(l4Score({ i: 1, ii: 4 }), { top1: 1, top5: 2 });
  const list = [
    { name: "a-ui", pass: true, l4: { top1: 0, top5: 2 } },
    { name: "b-h1", pass: true, l4: { top1: 1, top5: 1 } },
    { name: "c-1", pass: false, l4: { top1: 2, top5: 2 } },
    { name: "a-url", pass: true, l4: { top1: 1, top5: 1 } },
  ];
  assert.deepEqual(pickMethod(list), { name: "a-url", improves: true });
  assert.deepEqual(pickMethod([{ name: "c-1", pass: true, l4: { top1: 0, top5: 0 } }]), { name: "c-1", improves: false });
  assert.deepEqual(pickMethod([{ name: "c-1", pass: false, l4: { top1: 2, top5: 2 } }]), { name: null, improves: false });
});
