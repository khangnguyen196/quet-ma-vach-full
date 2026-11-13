// Test src/front-rank.js (đợt nang-t1): xếp hạng gợi ý "Chụp mặt trước" có tùy chọn thử cách tìm mới.
// opts tắt hết (mặc định) phải TRÙNG suggestFromItems / suggestFromText của src/front-search.js trên danh mục thật
// và fixture tests/fixtures/front-ocr-3.json (chữ máy chủ OCR thật của 3 ảnh). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import { suggestFromItems, suggestFromText, hitProducts } from "../src/front-search.js";

const mod = await import("../src/front-rank.js").catch(() => ({}));

const catalogPath = fileURLToPath(new URL("../public/chup-mat-do/danh-muc-vn.json", import.meta.url));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const index = t1.buildBm25(catalog.products);
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/front-ocr-3.json", import.meta.url), "utf8"));
const SALT = "COOP\nSelect\nMui Bin Tinh Sấy l-t\nIODIZES REFINED SEA SALT";

/** Tổng idf các từ khác nhau của câu tìm (để so idfSum). */
const idfSum = (q) => [...new Set(q)].reduce((s, w) => s + (index.idf.get(w) || 0), 0);

describe("front-rank mặc định = front-search (đường B / ô sửa chữ)", () => {
  const rIndex = mod.buildRankIndex?.(t1, catalog.products);

  for (const a of fixture.anh) {
    test(`${a.code}: lines + query + hits (mã, điểm, i) trùng suggestFromItems, idfSum đúng`, () => {
      for (const k of [5, 6, 1]) {
        const want = suggestFromItems(t1, index, a.items, k);
        const got = mod.rankFromItems(t1, rIndex, a.items, k);
        assert.deepEqual(got.lines, want.lines);
        assert.deepEqual(got.query, want.query);
        assert.deepEqual(got.hits, want.hits);
        assert.equal(got.idfSum, idfSum(want.query));
      }
      // vẫn trùng bản đã đo của fixture
      assert.deepEqual(mod.rankFromItems(t1, rIndex, a.items).hits.map((h) => h.code), a.top5);
    });
  }

  test("ô sửa chữ (ca muối + chữ 1 ảnh) trùng suggestFromText", () => {
    for (const text of [SALT, fixture.anh[0].items.map((it) => it.text).join("\n"), "", "  \n "]) {
      const want = suggestFromText(t1, index, text);
      const got = mod.rankFromText(t1, rIndex, text);
      assert.deepEqual({ lines: got.lines, query: got.query, hits: got.hits }, want);
      assert.equal(got.idfSum, idfSum(want.query));
    }
  });

  test("không có chữ / items sai → không gợi ý, idfSum 0, không lỗi", () => {
    for (const items of [[], null, undefined, "x", [{ text: "" }]]) {
      const r = mod.rankFromItems(t1, rIndex, items);
      assert.deepEqual(r.hits, []);
      assert.deepEqual(r.query, []);
      assert.equal(r.idfSum, 0);
    }
  });

  test("i = vị trí trong products: hitProducts dùng được", () => {
    const r = mod.rankFromItems(t1, rIndex, fixture.anh[0].items);
    const shown = hitProducts(catalog.products, r.hits);
    assert.equal(shown.length, r.hits.length);
    assert.deepEqual(shown.map((p) => p.code), r.hits.map((h) => h.code));
  });
});
