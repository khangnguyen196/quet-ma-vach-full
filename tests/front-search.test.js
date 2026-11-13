// Test phần tìm sản phẩm của "Chụp mặt trước" (src/front-search.js, đợt chup-mat): T1 (BM25) trên danh mục VN tĩnh.
// Dùng MỘT bản T1: public/chup-mat-do/t1.mjs (app import động lúc chạy, test import thẳng file đó).
// Fixture tests/fixtures/front-ocr-3.json: chữ máy chủ OCR thật của 3 ảnh + câu tìm / top5 đường (B) của
// server/do-30-anh.mjs đã ghi lúc đo (may-chu-t8-v3, 12/11/2026). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import { labelImageUrl } from "../src/render.js";

// import động + catch: chưa có hàm thì từng test đỏ riêng (thử đỏ / xanh), không phải lỗi cả file
const mod = await import("../src/front-search.js").catch(() => ({}));

const catalogPath = fileURLToPath(new URL("../public/chup-mat-do/danh-muc-vn.json", import.meta.url));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const index = t1.buildBm25(catalog.products);
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/front-ocr-3.json", import.meta.url), "utf8"));

describe("suggestFromItems: đúng đường (B) của server/do-30-anh.mjs", () => {
  for (const a of fixture.anh) {
    test(`${a.code}: câu tìm + top5 trùng bản đã đo (vị trí đúng ${a.rank ?? "không có"})`, () => {
      const r = mod.suggestFromItems(t1, index, a.items);
      assert.equal(r.query.join(" "), a.query);
      assert.deepEqual(r.hits.map((h) => h.code), a.top5);
      assert.ok(r.lines.length > 0 && r.lines.every((s) => typeof s === "string"));
    });
  }

  test("ghép khung chữ theo hàng: 2 khung cùng hàng thành 1 dòng, trái sang phải", () => {
    const items = [
      { text: "MAI", poly: [[300, 0], [400, 0], [400, 50], [300, 50]], score: 0.9 },
      { text: "LẠP XƯỞNG", poly: [[0, 5], [250, 5], [250, 55], [0, 55]], score: 0.9 },
      { text: "VISSAN", poly: [[0, 200], [200, 200], [200, 260], [0, 260]], score: 0.99 },
    ];
    const r = mod.suggestFromItems(t1, index, items);
    assert.deepEqual(r.lines, ["LẠP XƯỞNG MAI", "VISSAN"]);
  });

  test("k: tối đa k gợi ý; mặc định 5", () => {
    const a = fixture.anh[0];
    assert.equal(mod.suggestFromItems(t1, index, a.items, 2).hits.length, 2);
    assert.ok(mod.suggestFromItems(t1, index, a.items).hits.length <= 5);
  });

  test("không có chữ / items sai → không gợi ý, không lỗi", () => {
    for (const items of [[], null, undefined, "x", [{ text: "" }], [{ text: "ab", poly: [[0, 0], [1, 0], [1, 1], [0, 1]], score: 0.9 }]]) {
      const r = mod.suggestFromItems(t1, index, items);
      assert.deepEqual(r.hits, []);
      assert.deepEqual(r.query, []);
    }
  });
});

describe("suggestFromText: chữ người dùng sửa trong ô", () => {
  test("mỗi dòng = 1 dòng (conf null) → cùng câu tìm / gợi ý như t1QueryFromLines + bm25Search", () => {
    const text = "VISSAN\nLAP XUÓNG MAI QUÊ\n\n  Khoi lugng tinh: sg  ";
    const r = mod.suggestFromText(t1, index, text);
    const lines = ["VISSAN", "LAP XUÓNG MAI QUÊ", "Khoi lugng tinh: sg"].map((s) => ({ text: s, conf: null }));
    const q = t1.t1QueryFromLines(lines);
    assert.deepEqual(r.query, q);
    assert.deepEqual(r.hits, t1.bm25Search(index, q, 5));
    assert.deepEqual(r.lines, ["VISSAN", "LAP XUÓNG MAI QUÊ", "Khoi lugng tinh: sg"]);
    assert.equal(r.hits[0].code, "8934572260543");
  });

  test("dòng chữ của ảnh đưa lại vào ô (không sửa) → cùng gợi ý như suggestFromItems khi mọi khung đủ tin", () => {
    const a = fixture.anh[0]; // 8934572260543: mọi khung score ≥ 0,5
    const fromItems = mod.suggestFromItems(t1, index, a.items);
    const fromText = mod.suggestFromText(t1, index, fromItems.lines.join("\n"));
    assert.deepEqual(fromText.hits.map((h) => h.code), fromItems.hits.map((h) => h.code));
  });

  test("ô trống / chỉ khoảng trắng / không phải chuỗi → không gợi ý", () => {
    for (const text of ["", "   \n  ", null, undefined]) {
      const r = mod.suggestFromText(t1, index, text);
      assert.deepEqual(r.hits, []);
      assert.deepEqual(r.lines, []);
    }
  });
});

describe("loadCatalog: tải lười, giữ promise, lỗi thì lần sau tải lại", () => {
  const ok = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  test("2 lần gọi cùng địa chỉ → chỉ tải 1 lần, cùng kết quả", async () => {
    let n = 0;
    const body = { meta: { soSanPham: 1 }, products: [{ code: "1", text: "a" }] };
    const f = async (...a) => { n++; return ok(body)(...a); };
    const url = "https://x.example/danh-muc-1.json";
    const [a, b] = await Promise.all([mod.loadCatalog(f, url), mod.loadCatalog(f, url)]);
    const c = await mod.loadCatalog(f, url);
    assert.equal(n, 1);
    assert.equal(a, b);
    assert.equal(a, c);
    assert.deepEqual(a.products, body.products);
    assert.deepEqual(a.meta, body.meta);
  });

  test("lỗi mạng lần đầu → lần sau tải lại được", async () => {
    let n = 0;
    const url = "https://x.example/danh-muc-2.json";
    const f = async (...a) => { n++; if (n === 1) throw new TypeError("mất mạng"); return ok({ meta: {}, products: [] })(...a); };
    await assert.rejects(mod.loadCatalog(f, url));
    const r = await mod.loadCatalog(f, url);
    assert.equal(n, 2);
    assert.deepEqual(r.products, []);
  });

  test("HTTP lỗi / sai dạng → từ chối, câu lỗi tiếng Việt, lần sau tải lại", async () => {
    const bad = [
      async () => new Response("không có", { status: 404 }),
      ok({ products: [] }),                  // thiếu meta
      ok({ meta: {}, products: "x" }),       // products không phải mảng
      ok({ meta: null, products: [] }),
      ok([1, 2]),
      async () => new Response("<html>", { status: 200 }),
    ];
    for (const [i, f] of bad.entries()) {
      const url = `https://x.example/danh-muc-bad-${i}.json`;
      await assert.rejects(mod.loadCatalog(f, url), (e) => /danh mục/i.test(e.message), String(i));
      const r = await mod.loadCatalog(ok({ meta: {}, products: [] }), url);
      assert.deepEqual(r.products, [], String(i));
    }
  });

  test("danh mục thật của repo (đọc file) qua được kiểm dạng", async () => {
    const f = async () => new Response(fs.readFileSync(catalogPath), { status: 200 });
    const r = await mod.loadCatalog(f, "https://x.example/danh-muc-that.json");
    assert.equal(r.products.length, 1452);
  });
});

describe("địa chỉ T1 / danh mục theo BASE_URL, loadT1", () => {
  test("t1ModuleUrl / catalogUrl ghép đúng với base của app", () => {
    assert.equal(mod.t1ModuleUrl("/quet-ma-vach-full/"), "/quet-ma-vach-full/chup-mat-do/t1.mjs");
    assert.equal(mod.catalogUrl("/quet-ma-vach-full/"), "/quet-ma-vach-full/chup-mat-do/danh-muc-vn.json");
    assert.equal(mod.t1ModuleUrl("/"), "/chup-mat-do/t1.mjs");
    assert.equal(mod.catalogUrl(), "/chup-mat-do/danh-muc-vn.json"); // node: không có import.meta.env → "/"
  });

  test("pageUrl: base tương đối của bản build ('./') tính theo TRANG, không theo file JS trong assets/", () => {
    const page = "https://khangnguyen196.github.io/quet-ma-vach-full/";
    assert.equal(mod.pageUrl("./chup-mat-do/t1.mjs", page), "https://khangnguyen196.github.io/quet-ma-vach-full/chup-mat-do/t1.mjs");
    assert.equal(mod.pageUrl("./chup-mat-do/t1.mjs", page + "index.html?x=1#y"),
      "https://khangnguyen196.github.io/quet-ma-vach-full/chup-mat-do/t1.mjs");
    assert.equal(mod.pageUrl("/chup-mat-do/t1.mjs", "https://localhost:5173/"), "https://localhost:5173/chup-mat-do/t1.mjs");
    assert.equal(mod.pageUrl("file:///x/t1.mjs", page), "file:///x/t1.mjs");
    assert.equal(mod.pageUrl("./a.mjs", ""), "./a.mjs"); // không có trang (node) → giữ nguyên
  });

  test("loadT1 với base './' như bản build: tính theo document.baseURI (trang), nạp đúng public/chup-mat-do/t1.mjs", async () => {
    const publicDir = pathToFileURL(fileURLToPath(new URL("../public/", import.meta.url))).href;
    const had = "document" in globalThis;
    const old = globalThis.document;
    globalThis.document = { baseURI: publicDir + "index.html" };
    try {
      const m = await mod.loadT1("./chup-mat-do/t1.mjs");
      assert.equal(m.bm25Search, t1.bm25Search);
    } finally {
      if (had) globalThis.document = old; else delete globalThis.document;
    }
  });

  test("loadT1 import động đúng file public/chup-mat-do/t1.mjs (cùng một bản T1)", async () => {
    const url = pathToFileURL(fileURLToPath(new URL("../public/chup-mat-do/t1.mjs", import.meta.url))).href;
    const m = await mod.loadT1(url);
    for (const fn of ["ocrItems", "rowLineInfo", "t1QueryFromLines", "bm25Search", "buildBm25"]) assert.equal(typeof m[fn], "function", fn);
    assert.equal(m.bm25Search, t1.bm25Search);
  });
});

// Đối chiếu bằng image_front_small_url thật (Open Food Facts API v2, 13/11/2026, 5 lượt đọc có app_name).
const REAL = [
  ["31698085", "front_fr.3", "https://images.openfoodfacts.org/images/products/000/003/169/8085/front_fr.3.200.jpg"],
  ["80001928", "front_en.16", "https://images.openfoodfacts.org/images/products/000/008/000/1928/front_en.16.200.jpg"],
  ["8934572260543", "front_vi.10", "https://images.openfoodfacts.org/images/products/893/457/226/0543/front_vi.10.200.jpg"],
  ["0052603065054", "front_en.8", "https://images.openfoodfacts.org/images/products/005/260/306/5054/front_en.8.200.jpg"],
  ["8301011307914", "front_pt.3", "https://images.openfoodfacts.org/images/products/830/101/130/7914/front_pt.3.200.jpg"],
];

describe("frontImageUrl: đường ảnh theo mã (đã đối chiếu ảnh thật)", () => {
  for (const [code, img, url] of REAL) {
    test(`${code} ${img} → URL thật của Open Food Facts, lọt qua labelImageUrl`, () => {
      assert.equal(mod.frontImageUrl(code, img), url);
      assert.equal(labelImageUrl(mod.frontImageUrl(code, img)), url);
    });
  }

  test("cỡ 100 / 400 được, cỡ khác → ''", () => {
    assert.equal(mod.frontImageUrl("8934572260543", "front_vi.10", 400),
      "https://images.openfoodfacts.org/images/products/893/457/226/0543/front_vi.10.400.jpg");
    assert.match(mod.frontImageUrl("8934572260543", "front_vi.10", 100), /front_vi\.10\.100\.jpg$/);
    assert.equal(mod.frontImageUrl("8934572260543", "front_vi.10", 999), "");
  });

  test("không chắc → '' (giao diện hiện 'chưa có ảnh')", () => {
    for (const [code, img] of [
      ["8934572260543", ""], ["8934572260543", undefined], ["8934572260543", "front.3"], ["8934572260543", "front_vi"],
      ["8934572260543", "../x"], ["8934572260543", "front_vi.3.jpg"], ["8934572260543", "front_vi.3?x=1"],
      ["23228857001235", "front_en.3"],      // 14 số: chưa đối chiếu
      ["123456789012", "front_en.3"],        // 12 số: chưa đối chiếu
      ["1234567", "front_en.3"], ["", "front_en.3"], ["89345722605a3", "front_en.3"], [null, "front_en.3"],
    ]) {
      assert.equal(mod.frontImageUrl(code, img), "", `${code} ${img}`);
    }
  });
});

describe("hitProducts: gợi ý → thông tin hiển thị", () => {
  test("lấy tên / thương hiệu / ảnh theo vị trí i của hit, ảnh theo frontImageUrl", () => {
    const products = [
      { code: "8934572260543", name: "Lạp xưởng", brand: "Vissan", text: "x", img: "front_vi.10" },
      { code: "31698085", name: "Top Ramen", brand: "Nissin", text: "y" },
    ];
    const v = mod.hitProducts(products, [{ code: "31698085", score: 2, i: 1 }, { code: "8934572260543", score: 1, i: 0 }]);
    assert.deepEqual(v, [
      { code: "31698085", name: "Top Ramen", brand: "Nissin", image: "" },
      { code: "8934572260543", name: "Lạp xưởng", brand: "Vissan", image: REAL[2][2] },
    ]);
  });

  test("hit lệch danh mục (i sai / mã khác) → bỏ, không bịa", () => {
    const products = [{ code: "1", name: "a", brand: "", text: "a" }];
    assert.deepEqual(mod.hitProducts(products, [{ code: "2", score: 1, i: 0 }, { code: "1", score: 1, i: 5 }]), []);
  });
});
