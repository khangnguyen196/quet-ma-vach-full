// Test phần thuần của khung đo tu-dong-v42-do.mjs (đợt tu-dong vòng 6): lưới P1, luật chọn P1 / P2, chọn ca hàng
// ngoại dựng. Không gọi mạng, không đọc file lớn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { p1Grid, pickP1, pickP2, foreignCases, lossOf, pos6 } from "../tu-dong-v42-do.mjs";
import { strangeWords } from "../../../src/off-search.js";

const DG = Object.freeze({ lockTop: 3, offMax: 1, offGap: 1, offTopRule: null, offPromote: null });

test("p1Grid: mốc + 6 cách gap {1,2,3} × minWords {2,3} trên DEFAULT_GUARD + tham chiếu f1-L0-M1-top", () => {
  const g = p1Grid(DG);
  assert.deepEqual(Object.keys(g), ["mac-dinh", "p-g1-w2", "p-g1-w3", "p-g2-w2", "p-g2-w3", "p-g3-w2", "p-g3-w3", "ref-L0-M1-top"]);
  assert.deepEqual(g["p-g2-w3"], { ...DG, offPromote: { gap: 2, minWords: 3 } });
  assert.deepEqual(g["ref-L0-M1-top"], { method: "f1", lockTop: 0, offMax: 1, offGap: 0, offTopRule: { gap: 1, minWords: 2 }, offPromote: null });
});

test("pickP1: chỉ cách qua; 7Up máy cao hơn, rồi gõ, rồi ít mất (iii), rồi gap lớn, rồi minWords lớn; không cách nào → null", () => {
  const j = (name, o) => ({ name, pass: true, may: 4, go: 4, fakeLostB: 0, gap: 1, minWords: 2, ...o });
  assert.equal(pickP1([j("a", { pass: false, may: 1 }), j("b", { may: 2 })]), "b");
  assert.equal(pickP1([j("a", { may: null }), j("b", { may: 5 })]), "b");
  assert.equal(pickP1([j("a", { go: 3 }), j("b", { go: 2 })]), "b");
  assert.equal(pickP1([j("a", { fakeLostB: 2 }), j("b", { fakeLostB: 1 })]), "b");
  assert.equal(pickP1([j("a", { gap: 1 }), j("b", { gap: 3 })]), "b");
  assert.equal(pickP1([j("a", { minWords: 2 }), j("b", { minWords: 3 })]), "b");
  assert.equal(pickP1([j("a", { pass: false })]), null);
});

test("pickP2: nhiều ca ngoại trong 5 nhất, rồi vị trí 1, hòa thì x1; không qua → null", () => {
  assert.equal(pickP2([{ name: "x1", pass: true, in5: 2, top1: 1 }, { name: "x2", pass: true, in5: 3, top1: 0 }]), "x2");
  assert.equal(pickP2([{ name: "x1", pass: true, in5: 2, top1: 0 }, { name: "x2", pass: true, in5: 2, top1: 1 }]), "x2");
  assert.equal(pickP2([{ name: "x2", pass: true, in5: 2, top1: 1 }, { name: "x1", pass: true, in5: 2, top1: 1 }]), "x1");
  assert.equal(pickP2([{ name: "x1", pass: false, in5: 6, top1: 6 }, { name: "x2", pass: false, in5: 0, top1: 0 }]), null);
});

test("foreignCases: không trong danh mục, có ảnh mặt trước, tên có từ lạ; sắp mã tăng dần; lấy n đầu", () => {
  const rec = (code, name, brand = "B", front = true) => ({ code, names: { product_name: name }, generic: {}, brands: brand, fronts: front ? [{ key: "front_en", imgid: "1", rev: "2" }] : [] });
  const idf = new Map([["soda", 1], ["chanh", 1]]);
  const records = [
    rec("0000000000009", "Goldbears gummy"),
    rec("0000000000001", "Soda chanh"), // không có từ lạ
    rec("0000000000002", "Haribo Starmix", "Haribo", false), // không ảnh
    rec("0000000000003", "Fruchtgummi"), // trong danh mục
    rec("0000000000004", "Pringles Original", "Pringles"),
    rec("0000000000004", "Pringles Original dup"),
  ];
  const got = foreignCases(records, new Set(["0000000000003"]), strangeWords, idf, 6);
  assert.deepEqual(got.map((x) => x.code), ["0000000000004", "0000000000009"]);
  assert.deepEqual(got[0].lines, ["Pringles Original", "Pringles"]);
  assert.deepEqual(got[0].strange, ["pringles", "original"]); // cùng 8 chữ: theo thứ tự
  assert.equal(foreignCases(records, new Set(), strangeWords, idf, 1).length, 1);
});

test("lossOf / pos6", () => {
  assert.deepEqual(lossOf([{ code: "a", base: 1, got: 2 }, { code: "b", base: 3, got: null }, { code: "c", base: null, got: 1 }]), { lostTop1: ["a"], out5: ["b"] });
  assert.equal(pos6(null), 6);
  assert.equal(pos6(2), 2);
});
