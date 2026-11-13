// Test src/front-rank.js (đợt nang-t1): xếp hạng gợi ý "Chụp mặt trước" có tùy chọn thử cách tìm mới.
// opts tắt hết (mặc định) phải TRÙNG suggestFromItems / suggestFromText của src/front-search.js trên danh mục thật
// và fixture tests/fixtures/front-ocr-3.json (chữ máy chủ OCR thật của 3 ảnh). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import { suggestFromItems, suggestFromText, hitProducts } from "../src/front-search.js";

import * as mod from "../src/front-rank.js"; // import lỗi thì cả file test đỏ (không nuốt lỗi)

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

  test("opts rỗng / DEFAULT_OPTS / opts không bật gì đều ra cùng kết quả", () => {
    const a = fixture.anh[1];
    const want = mod.rankFromItems(t1, rIndex, a.items);
    for (const o of [{}, mod.DEFAULT_OPTS, { coop: false, ngram: null }]) {
      assert.deepEqual(mod.rankFromItems(t1, mod.buildRankIndex(t1, catalog.products, o), a.items), want);
    }
  });

  test("cách đã gỡ (không giữ ở vòng 2) -> báo lỗi, không âm thầm chạy như mặc định", () => {
    for (const o of [{ coop: true }, { brandWeight: 2 }, { ngram: { fuse: "rrf", k: 60 } }]) {
      assert.throws(() => mod.buildRankIndex(t1, catalog.products, o), /không hỗ trợ/);
      assert.throws(() => mod.rankFromText(t1, rIndex, "VISSAN", 5, o), /không hỗ trợ/);
    }
  });

  test("confidenceOf: ca muối trên danh mục thật (m1 khung chữ, m2 ô chữ) → kết quả thật: confident, rel 0,3325", () => {
    // Ghi kết quả THẬT của luật đã chọn (không phải kết quả mong muốn): ca muối không có trong danh mục, đúng ra là
    // "không chắc", nhưng luật rel ≥ 0,2468 (chọn trên nhóm chỉnh, không chỉnh theo ca muối) cho ra confident.
    const lines = SALT.split("\n");
    const items = lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score: 0.9 }));
    for (const r of [mod.rankFromItems(t1, rIndex, items), mod.rankFromText(t1, rIndex, SALT)]) {
      assert.equal(r.hits[0].code, "4018077712999"); // Lorenz naturals
      const c = mod.confidenceOf(r);
      assert.equal(c.feature, "rel");
      assert.equal(c.threshold, mod.CONFIDENCE_RULE.threshold);
      assert.ok(Math.abs(c.value - 0.3324803517241829) < 1e-9, String(c.value));
      assert.equal(c.confident, true);
      const v = mod.confidenceValues({ top1: r.hits[0].score, top2: r.hits[1].score, idfSum: r.idfSum });
      assert.ok(Math.abs(v.norm - 0.43866114381745464) < 1e-9);
      assert.ok(Math.abs(v.gap - 4.422650357212021) < 1e-9);
    }
  });

  test("i = vị trí trong products: hitProducts dùng được", () => {
    const r = mod.rankFromItems(t1, rIndex, fixture.anh[0].items);
    const shown = hitProducts(catalog.products, r.hits);
    assert.equal(shown.length, r.hits.length);
    assert.deepEqual(shown.map((p) => p.code), r.hits.map((h) => h.code));
  });
});

describe("confidenceOf: điểm tin cậy (vòng 3, luật chốt trước)", () => {
  const H = (...scores) => scores.map((score, i) => ({ code: String(8930000000000 + i), score, i }));
  const res = (hits, idfSum = 20, query = ["a"]) => ({ query, hits, idfSum });

  test("CONFIDENCE_RULE: rel, ngưỡng = điểm giữa 2 giá trị rel của nhóm chỉnh; không sửa được", () => {
    assert.equal(mod.CONFIDENCE_RULE.feature, "rel");
    assert.equal(mod.CONFIDENCE_RULE.threshold, (0.21616184197410665 + 0.2774309394601073) / 2);
    assert.ok(Object.isFrozen(mod.CONFIDENCE_RULE));
    assert.deepEqual([...mod.CONFIDENCE_FEATURES], ["top1", "gap", "norm", "rel"]);
  });

  test("không có gợi ý / câu tìm rỗng / kết quả hỏng → không chắc, value null", () => {
    for (const r of [res([]), res(H(9, 1), 20, []), null, undefined, {}, res(H(NaN))]) {
      const c = mod.confidenceOf(r);
      assert.equal(c.confident, false);
      assert.equal(c.value, null);
    }
    // kết quả thật: câu rỗng
    assert.equal(mod.confidenceOf(mod.rankFromText(t1, mod.buildRankIndex(t1, catalog.products), "")).confident, false);
  });

  test("1 gợi ý: top2 = 0 → gap = top1, rel = 1 (chắc chắn với luật rel)", () => {
    const c = mod.confidenceOf(res(H(7)));
    assert.equal(c.value, 1);
    assert.equal(c.confident, true);
    assert.equal(mod.confidenceOf(res(H(7)), { feature: "gap", threshold: 7 }).value, 7);
  });

  test("ngưỡng biên: bằng ngưỡng → chắc; dưới một chút → không", () => {
    const rule = { feature: "gap", threshold: 3 };
    assert.equal(mod.confidenceOf(res(H(10, 7)), rule).confident, true); // gap 3 = ngưỡng
    assert.equal(mod.confidenceOf(res(H(10, 7.000001)), rule).confident, false);
    const t = mod.CONFIDENCE_RULE.threshold;
    // rel = (top1 − top2) / top1: top2 = top1 · (1 − rel)
    assert.equal(mod.confidenceOf(res(H(10, 10 * (1 - t) - 1e-9))).confident, true);
    assert.equal(mod.confidenceOf(res(H(10, 10 * (1 - t) + 1e-9))).confident, false);
    assert.equal(mod.confidenceOf(res(H(10, 4)), { feature: "norm", threshold: 0.5 }).value, 0.5);
    assert.equal(mod.confidenceOf(res(H(10, 4)), { feature: "top1", threshold: 10 }).confident, true);
  });

  test("luật 'luôn không chắc' (feature null) hoặc luật lạ → không chắc", () => {
    for (const rule of [{ feature: null, threshold: null }, { feature: "xyz", threshold: 0 }, { feature: "rel", threshold: NaN }]) {
      assert.equal(mod.confidenceOf(res(H(30, 1)), rule).confident, false);
    }
  });
});
