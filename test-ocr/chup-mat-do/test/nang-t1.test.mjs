// Test phần thuần của khung đo nang-t1 (không mạng, không đọc D:\tmp).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as page from "../../../public/chup-mat-do/t1.mjs";
import {
  boxToPoly, toPolyItems, splitGroups, HOLDOUT, saltItems, SALT_LINES, queryIdf, normScore, tally, seenMatch, compareSeen, SALT_SEEN,
} from "../nang-t1-do.mjs";
import { CRITERIA, catalogProduct, dropReasons, catalogSize } from "../nang-t1-danh-muc.mjs";

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
  assert.equal(normScore(10, 5), 2);
  assert.equal(normScore(null, 5), 0);
  assert.equal(normScore(3, 0), 0);
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
  const s = catalogSize([catalogProduct(r)]);
  assert.ok(s.raw > 0 && s.gzip > 0);
});
