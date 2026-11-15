// Test src/front-merge.js (đợt tu-dong vòng 2): gộp T1 (danh mục) + Open Food Facts thành tối đa 5 sản phẩm.
// Danh mục thật public/chup-mat-do/danh-muc-vn.json, OFF là dữ liệu giả (không gọi mạng). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import * as fr from "../src/front-rank.js";
import * as mod from "../src/front-merge.js"; // import lỗi thì cả file đỏ

const catalog = JSON.parse(fs.readFileSync(new URL("../public/chup-mat-do/danh-muc-vn.json", import.meta.url), "utf8"));
const products = catalog.products;
const rIndex = fr.buildRankIndex(t1, products);
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/front-ocr-3.json", import.meta.url), "utf8"));
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));
const DIET = { code: "8934588752117", name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: "https://images.openfoodfacts.org/images/products/893/458/875/2117/front_en.7.200.jpg", vn: false, text: "Soda Chanh - Diet 7Up PepsiCo" };
const LEMON = { code: "8934588022111", name: "7Up hương chanh", brand: "7UP", img: "", vn: true, text: "7Up hương chanh 7UP" };
const FOREIGN = (n) => ({ code: String(9000000000000 + n), name: `Foreign soda ${n}`, brand: "X", img: "", vn: false, text: `Foreign soda ${n} X` });

describe("OFF lỗi / rỗng / bị hủy → GIỐNG HỆT T1", () => {
  const cases = [
    ...fixture.anh.map((a) => fr.rankFromItems(t1, rIndex, a.items)),
    fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"])),
    fr.rankFromText(t1, rIndex, "COOP\nSelect\nMui Bin Tinh Sấy l-t\nIODIZES REFINED SEA SALT"),
  ];
  const offs = [null, undefined, { ok: false, kind: "network" }, { ok: false, kind: "aborted" }, { ok: false, kind: "limited" }, { ok: true, hits: [] }, { ok: true }];
  for (const method of mod.MERGE_METHODS) {
    test(`${method}: cùng mã, cùng thứ tự, nguồn danh mục`, () => {
      for (const r of cases) {
        for (const off of offs) {
          const got = mod.mergeFront(t1, rIndex, products, r, off, { method });
          assert.deepEqual(got.map((x) => x.code), r.hits.map((h) => h.code), JSON.stringify(off));
          assert.ok(got.every((x) => x.source === "catalog" && x.vn === true));
        }
      }
    });
  }

  test("không có chữ (T1 rỗng) + OFF lỗi → []", () => {
    const r = fr.rankFromItems(t1, rIndex, []);
    assert.deepEqual(mod.mergeFront(t1, rIndex, products, r, { ok: false, kind: "network" }), []);
  });
});

describe("gộp: mã trùng một lần, tối đa 5, dạng mục", () => {
  const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
  const off = { ok: true, hits: [DIET, DIET, LEMON, ...Array.from({ length: 12 }, (_, n) => FOREIGN(n))] };

  for (const method of mod.MERGE_METHODS) {
    test(`${method}: không trùng mã, ≤ 5 mục, có đủ trường`, () => {
      const got = mod.mergeFront(t1, rIndex, products, r, off, { method });
      assert.ok(got.length <= mod.MERGE_K && got.length > 0);
      assert.equal(new Set(got.map((x) => x.code)).size, got.length);
      for (const x of got) {
        assert.deepEqual(Object.keys(x).sort(), ["brand", "code", "img", "name", "score", "source", "vn"]);
        assert.ok(x.source === "catalog" || x.source === "off");
      }
      const lemon = got.find((x) => x.code === LEMON.code);
      if (lemon) assert.equal(lemon.source, "catalog", "mã OFF đã có trong danh mục → dùng bản danh mục");
    });
  }

  test("k nhỏ hơn: cắt đúng k", () => {
    assert.equal(mod.mergeFront(t1, rIndex, products, r, off, { k: 2 }).length, 2);
  });

  test("cách gộp lạ → báo lỗi", () => {
    assert.throws(() => mod.mergeFront(t1, rIndex, products, r, off, { method: "x" }), /không hỗ trợ/);
  });
});

describe("ca 7Up (OFF giả có 8934588752117, chưa có trong danh mục)", () => {
  test("f1: chữ máy chủ 'Up' / 'Soda chanh' / 'Khong calo' → 8934588752117 vị trí 1, nguồn OFF", () => {
    const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    const got = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: [DIET, LEMON] });
    assert.equal(got[0].code, DIET.code, got.map((x) => x.code).join(","));
    assert.equal(got[0].source, "off");
    assert.equal(got[0].vn, false);
    assert.equal(got[0].name, DIET.name);
    assert.match(got[0].img, /^https:\/\/images\.openfoodfacts\.org\//);
  });

  test("f1: câu gõ 'Soda chanh diet 7 up' → 8934588752117 vị trí 1", () => {
    const r = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");
    const got = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: [LEMON, DIET] });
    assert.equal(got[0].code, DIET.code, got.map((x) => x.code).join(","));
  });

  test("f1 minMatch 2: ứng viên OFF chỉ khớp 1 từ câu tìm bị bỏ", () => {
    const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    const one = { code: "9100000000001", name: "Calo", brand: "", img: "", vn: false, text: "Calo" };
    const a = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: [one] }, { minMatch: 2 });
    assert.ok(!a.some((x) => x.code === one.code));
  });

  test("bm25DocScore trùng t1.bm25Search trên tài liệu danh mục", () => {
    const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    for (const h of r.hits) {
      const s = mod.bm25DocScore(rIndex.index, rIndex.index.tf[h.i], r.query).score;
      assert.ok(Math.abs(s - h.score) < 1e-9, `${h.code}: ${s} vs ${h.score}`);
    }
  });
});

describe("f3: T1 trước, OFF lấp chỗ trống", () => {
  test("T1 đủ 5 → không có mục OFF; T1 ít hơn 5 → OFF lấp (VN trước)", () => {
    const full = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    const got = mod.mergeFront(t1, rIndex, products, full, { ok: true, hits: [DIET] }, { method: "f3" });
    assert.deepEqual(got.map((x) => x.code), full.hits.map((h) => h.code));
    const empty = fr.rankFromItems(t1, rIndex, []);
    const g2 = mod.mergeFront(t1, rIndex, products, empty, { ok: true, hits: [FOREIGN(1), { ...FOREIGN(2), vn: true }, DIET] }, { method: "f3" });
    assert.deepEqual(g2.map((x) => x.code), [FOREIGN(2).code, FOREIGN(1).code, DIET.code]);
  });
});
