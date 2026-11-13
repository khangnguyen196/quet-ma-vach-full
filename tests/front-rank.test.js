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

  test("opts rỗng / DEFAULT_OPTS / opts không bật gì đều ra cùng kết quả", () => {
    const a = fixture.anh[1];
    const want = mod.rankFromItems(t1, rIndex, a.items);
    for (const o of [{}, mod.DEFAULT_OPTS, { coop: false, fixWords: false }]) {
      assert.deepEqual(mod.rankFromItems(t1, mod.buildRankIndex(t1, catalog.products, o), a.items), want);
    }
  });

  test("i = vị trí trong products: hitProducts dùng được", () => {
    const r = mod.rankFromItems(t1, rIndex, fixture.anh[0].items);
    const shown = hitProducts(catalog.products, r.hits);
    assert.equal(shown.length, r.hits.length);
    assert.deepEqual(shown.map((p) => p.code), r.hits.map((h) => h.code));
  });
});

// Danh mục nhỏ tự viết cho các cách thử (không phụ thuộc số đo).
const MINI = [
  { code: "1", name: "Kem đánh răng", brand: "Co.op Select", text: "Kem đánh răng Co.op Select Co.op Select" },
  { code: "2", name: "Muối iốt", brand: "Bạc Liêu", text: "Muối iốt Bạc Liêu" },
  { code: "3", name: "Bánh quy bơ", brand: "Cosy", text: "Bánh quy bơ Cosy" },
];

describe("(b) n-gram 3 ký tự gộp BM25", () => {
  test("wordGrams / textGrams: đệm dấu cách hai đầu, giữ lặp", () => {
    assert.deepEqual(mod.wordGrams("muoi"), [" mu", "muo", "uoi", "oi "]);
    assert.deepEqual(mod.wordGrams("ab"), [" ab", "ab "]);
    assert.deepEqual(mod.textGrams(["ab", "ab"]), [" ab", "ab ", " ab", "ab "]);
  });

  test("fuseHits rrf: Σ 1/(k + hạng); sum: chuẩn hóa theo điểm lớn nhất mỗi bên + alpha", () => {
    const W = [{ code: "a", score: 10, i: 0 }, { code: "b", score: 5, i: 1 }];
    const G = [{ code: "b", score: 4, i: 1 }, { code: "c", score: 2, i: 2 }];
    const rrf = mod.fuseHits(W, G, { fuse: "rrf", k: 60 }, 5);
    assert.deepEqual(rrf.map((h) => h.code), ["b", "a", "c"]);
    assert.ok(Math.abs(rrf[0].score - (1 / 62 + 1 / 61)) < 1e-12);
    const sum = mod.fuseHits(W, G, { fuse: "sum", alpha: 0.5 }, 5);
    assert.deepEqual(sum.map((h) => [h.code, h.score]), [["a", 1], ["b", 1], ["c", 0.25]]); // a, b bằng điểm: i nhỏ trước
    assert.equal(mod.fuseHits(W, G, { fuse: "sum", alpha: 0.2 }, 1).length, 1);
    assert.throws(() => mod.fuseHits(W, G, { fuse: "x" }, 5));
  });

  test("ngram cứu từ đọc sai vài ký tự (BM25 theo từ không thấy); idfSum vẫn theo BM25 từ", () => {
    const off = mod.buildRankIndex(t1, MINI);
    const on = mod.buildRankIndex(t1, MINI, { ngram: { fuse: "sum", alpha: 0.3 } });
    assert.deepEqual(mod.rankFromText(t1, off, "Cozy").hits, []);
    const r = mod.rankFromText(t1, on, "Cozy");
    assert.equal(r.hits[0].code, "3");
    assert.equal(r.idfSum, 0); // "cozy" không có trong chỉ mục từ
    const q = mod.rankFromText(t1, on, "Cosy bánh");
    assert.equal(q.idfSum, mod.rankFromText(t1, off, "Cosy bánh").idfSum);
    // chỉ mục không có ngram mà tìm có ngram -> lỗi rõ
    assert.throws(() => mod.rankFromText(t1, off, "Cosy", 5, { ngram: { fuse: "rrf", k: 60 } }), /ngram/);
  });
});

describe("(c) thương hiệu nặng điểm", () => {
  test("f_eff = f_text + (h − 1)·f_brand, độ dài theo f_eff, idf không đổi", () => {
    const base = mod.buildRankIndex(t1, MINI);
    const c = mod.buildRankIndex(t1, MINI, { brandWeight: 2 });
    assert.deepEqual([...c.index.idf], [...base.index.idf]);
    // sp 1: text "kem danh rang op select op select", brand "op select" -> op 2+1, select 2+1
    assert.equal(c.index.tf[0].m.get("select"), 3);
    assert.equal(c.index.tf[0].m.get("op"), 3);
    assert.equal(c.index.tf[0].m.get("kem"), 1);
    assert.equal(c.index.tf[0].len, base.index.tf[0].len + 2);
    const h15 = mod.buildRankIndex(t1, MINI, { brandWeight: 1.5 });
    assert.equal(h15.index.tf[2].m.get("cosy"), 1.5);
    const lens = c.index.tf.map((t) => t.len);
    assert.equal(c.index.avgdl, lens.reduce((s, x) => s + x, 0) / lens.length);
    // h = 1 thì như mặc định
    assert.deepEqual(mod.buildRankIndex(t1, MINI, { brandWeight: 1 }).index, base.index);
  });

  test("từ thương hiệu được điểm cao hơn khi bật brandWeight", () => {
    const docs = [
      { code: "x", brand: "Cosy", text: "Bánh Cosy" },
      { code: "y", brand: "Kinh Đô", text: "Bánh cosy Kinh Đô" },
    ];
    const off = mod.rankFromText(t1, mod.buildRankIndex(t1, docs), "cosy");
    const on = mod.rankFromText(t1, mod.buildRankIndex(t1, docs, { brandWeight: 3 }), "cosy");
    assert.ok(on.hits[0].score > off.hits[0].score);
    assert.equal(on.hits[0].code, "x");
    assert.equal(on.idfSum, off.idfSum);
  });
});

describe("(a) chuẩn hóa hãng / cách viết", () => {
  test("coopNorm: Co.op / co-op / co op / CO. OP / COOP -> coop; không đụng từ khác", () => {
    assert.equal(mod.coopNorm("Co.op Select"), "coop Select");
    assert.equal(mod.coopNorm("co-op mart, CO. OP"), "coop mart, coop");
    assert.equal(mod.coopNorm("co op"), "coop");
    assert.equal(mod.coopNorm("COOP"), "coop");
    assert.equal(mod.coopNorm("taco op, cocoa, coopmart"), "taco op, cocoa, coopmart");
    assert.equal(mod.coopNorm(null), "");
  });

  test("a1: câu 'COOP' khớp sản phẩm 'Co.op Select' (không có a1 thì không)", () => {
    const off = mod.buildRankIndex(t1, MINI);
    assert.deepEqual(mod.rankFromText(t1, off, "COOP").hits, []);
    const on = mod.buildRankIndex(t1, MINI, { coop: true });
    const r = mod.rankFromText(t1, on, "COOP");
    assert.deepEqual(r.query, ["coop"]);
    assert.deepEqual(r.hits.map((h) => h.code), ["1"]);
    assert.ok(r.idfSum > 0);
  });

  test("fixWord: thử luật theo thứ tự, vị trí trái trước; có sẵn / không sửa được thì giữ nguyên", () => {
    const idx = { idf: new Map([["iot", 1], ["muoi", 1], ["lait", 1], ["maso", 1], ["cosy", 1]]) };
    assert.equal(mod.fixWord(idx, "lot"), "iot"); // l -> i
    assert.equal(mod.fixWord(idx, "mu0i"), "muoi"); // 0 -> o
    assert.equal(mod.fixWord(idx, "1ait"), "lait"); // 1 -> i không có, 1 -> l có
    assert.equal(mod.fixWord(idx, "rnaso"), "maso"); // rn -> m
    assert.equal(mod.fixWord(idx, "co5y"), "cosy"); // 5 -> s
    assert.equal(mod.fixWord(idx, "muoi"), "muoi");
    assert.equal(mod.fixWord(idx, "xyz"), "xyz");
    // l -> i thử trước i -> l: "liit" có thể thành "iiit" hoặc "llit", cả hai có trong chỉ mục -> "iiit"
    const idx2 = { idf: new Map([["llit", 1], ["iiit", 1]]) };
    assert.equal(mod.fixWord(idx2, "liit"), "iiit");
  });

  test("a2: sửa từ câu tìm trước khi tìm (chỉ khi bật fixWords)", () => {
    const a1 = mod.buildRankIndex(t1, MINI, { coop: true });
    assert.deepEqual(mod.rankFromText(t1, a1, "Mu0i").hits, []);
    const a2 = mod.buildRankIndex(t1, MINI, { coop: true, fixWords: true });
    const r = mod.rankFromText(t1, a2, "Mu0i");
    assert.deepEqual(r.query, ["muoi"]);
    assert.deepEqual(r.hits.map((h) => h.code), ["2"]);
  });
});
