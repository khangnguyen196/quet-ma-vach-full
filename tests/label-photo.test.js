// Test khi Open Food Facts thiếu thông tin (đợt nhay-hon P3): ảnh nhãn (thành phần, bảng dinh dưỡng) khi chưa có chữ,
// khối "Bổ sung trên Open Food Facts" khi thiếu tên / số dinh dưỡng / thành phần.
// Chạy: npm test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { normalize, getProduct, clearProductCache, NO_NAME } from "../src/off.js";
import { renderProduct, renderNotFound, labelImageUrl } from "../src/render.js";

const ING = "https://images.openfoodfacts.org/images/products/893/458/801/3133/ingredients_vi.5.400.jpg";
const NUT = "https://images.openfoodfacts.org/images/products/893/458/801/3133/nutrition_vi.7.400.jpg";

/** Sản phẩm thô đủ tên, số dinh dưỡng, thành phần; extra ghi đè. */
const full = (extra = {}) => ({
  code: "8934588013133", product_name: "Pepsi", ingredients_text: "nước, đường",
  nutriments: { "energy-kcal_100g": 42 }, ...extra
});
const html = (extra) => renderProduct(normalize(full(extra), "8934588013133"));
/** Khối Bổ sung (div có class contribute-box) hoặc null. */
const box = (h) => h.match(/<div class="[^"]*\bcontribute-box\b[^"]*"[\s\S]*?<\/div>/)?.[0] || null;

describe("off.js: trường ảnh nhãn", () => {
  test("normalize có ảnh → imageIngredients / imageNutrition (bỏ khoảng trắng 2 đầu)", () => {
    const p = normalize(full({ image_ingredients_url: ` ${ING} `, image_nutrition_url: NUT }), "1");
    assert.equal(p.imageIngredients, ING);
    assert.equal(p.imageNutrition, NUT);
  });

  test("normalize không có ảnh (thiếu, null, số, mảng rỗng) → chuỗi rỗng", () => {
    for (const bad of [undefined, null, {}, []]) {
      const p = normalize(full({ image_ingredients_url: bad, image_nutrition_url: bad }), "1");
      assert.equal(p.imageIngredients, "", JSON.stringify(bad));
      assert.equal(p.imageNutrition, "", JSON.stringify(bad));
    }
  });

  describe("lệnh gọi lấy thêm 2 trường ảnh, giữ app_name / app_version", () => {
    let original, url;
    before(() => {
      original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
      Object.defineProperty(globalThis, "fetch", {
        configurable: true, writable: true,
        value: async (u) => { url = String(u); return { ok: true, status: 200, json: async () => ({ status: 0 }) }; }
      });
      clearProductCache();
    });
    after(() => {
      if (original) Object.defineProperty(globalThis, "fetch", original);
      else delete globalThis.fetch;
      clearProductCache();
    });
    test("fields có image_ingredients_url, image_nutrition_url (và các trường cũ)", async () => {
      await getProduct("8934588013133");
      const fields = new URL(url).searchParams.get("fields").split(",");
      for (const f of ["image_ingredients_url", "image_nutrition_url", "image_front_url", "ingredients_text", "nutriments"]) {
        assert.ok(fields.includes(f), f);
      }
      assert.equal(new URL(url).searchParams.get("app_name"), "quet-ma-vach-full");
      assert.equal(new URL(url).searchParams.get("app_version"), "0.1.0");
    });
  });
});

describe("render.js: labelImageUrl (lọc địa chỉ ảnh nhãn)", () => {
  test("https + images.openfoodfacts.org / static.openfoodfacts.org → nhận", () => {
    assert.equal(labelImageUrl(ING), ING);
    assert.equal(labelImageUrl("https://static.openfoodfacts.org/images/x.jpg"), "https://static.openfoodfacts.org/images/x.jpg");
    assert.equal(labelImageUrl("https://IMAGES.openfoodfacts.org/a.jpg"), "https://images.openfoodfacts.org/a.jpg");
  });

  test("http://, tên miền lạ, javascript:, chuỗi hỏng, không phải chuỗi → rỗng", () => {
    for (const bad of [
      "http://images.openfoodfacts.org/a.jpg", "https://evil.example/a.jpg", "javascript:alert(1)",
      "https://images.openfoodfacts.org.evil.example/a.jpg", "https://evilimages.openfoodfacts.org/a.jpg",
      "https://images.openfoodfacts.org@evil.example/a.jpg", "https://world.openfoodfacts.org/a.jpg",
      "data:image/png;base64,AAAA", "//images.openfoodfacts.org/a.jpg", "không phải url", "", null, undefined, 42, {}
    ]) assert.equal(labelImageUrl(bad), "", String(bad));
  });
});

describe("renderProduct: ảnh nhãn khi chưa có chữ", () => {
  test("thiếu thành phần + có ảnh thành phần → câu + link mở tab mới bọc <img lazy>", () => {
    const h = html({ ingredients_text: "", image_ingredients_url: ING });
    assert.ok(h.includes("Chưa ai nhập chữ, xem ảnh nhãn"), h);
    const a = h.match(/<a [^>]*href="([^"]+)"[^>]*>\s*<img [^>]*alt="Ảnh thành phần trên bao bì"[^>]*>/);
    assert.ok(a, h);
    assert.equal(a[1], ING);
    assert.match(a[0], /target="_blank"/);
    assert.match(a[0], /rel="noopener"/);
    assert.match(a[0], new RegExp(`<img [^>]*src="${ING.replace(/[.]/g, "\\.")}"`));
    assert.match(a[0], /loading="lazy"/);
    assert.match(a[0], /onerror="/); // ảnh lỗi thì ẩn
  });

  test("thiếu số dinh dưỡng + có ảnh bảng dinh dưỡng → ảnh alt 'Ảnh bảng dinh dưỡng trên bao bì'", () => {
    const h = html({ nutriments: {}, image_nutrition_url: NUT });
    assert.ok(h.includes("Chưa ai nhập chữ, xem ảnh nhãn"), h);
    assert.match(h, new RegExp(`<a [^>]*href="${NUT.replace(/[.]/g, "\\.")}"[^>]*target="_blank"[^>]*>\\s*<img [^>]*alt="Ảnh bảng dinh dưỡng trên bao bì"`));
  });

  test("có chữ thì KHÔNG hiện ảnh nhãn (dù có ảnh)", () => {
    const h = html({ image_ingredients_url: ING, image_nutrition_url: NUT });
    assert.ok(!h.includes("Chưa ai nhập chữ"), h);
    assert.ok(!h.includes(ING) && !h.includes(NUT), h);
  });

  test("ảnh http://, tên miền lạ, javascript: → không hiện ảnh, không hiện câu", () => {
    for (const bad of ["http://images.openfoodfacts.org/a.jpg", "https://evil.example/a.jpg", "javascript:alert(1)"]) {
      const h = html({ ingredients_text: "", nutriments: {}, image_ingredients_url: bad, image_nutrition_url: bad });
      assert.ok(!h.includes("Chưa ai nhập chữ"), bad);
      assert.ok(!h.includes(bad), bad);
      assert.ok(!/<img [^>]*alt="Ảnh (thành phần|bảng dinh dưỡng) trên bao bì"/.test(h), bad);
      assert.ok(h.includes("Chưa có dữ liệu thành phần."), bad);
    }
  });

  test('địa chỉ ảnh có " < > \' không phá thẻ HTML (escape)', () => {
    const evil = `https://images.openfoodfacts.org/a"onerror="alert(1)'<b>x</b>.jpg?q="<i>'`;
    const h = html({ ingredients_text: "", image_ingredients_url: evil });
    assert.ok(!h.includes("<b>") && !h.includes("<i>"), h);
    assert.ok(!h.includes('"onerror="alert'), h);
    assert.ok(!/'<|alert\(1\)'/.test(h), h);
  });
});

describe("renderProduct: khối Bổ sung trên Open Food Facts", () => {
  const LINK = "https://world.openfoodfacts.org/product/8934588013133";

  for (const [what, extra, word] of [
    ["thiếu tên", { product_name: "" }, "tên sản phẩm"],
    ["thiếu số dinh dưỡng", { nutriments: {} }, "số dinh dưỡng"],
    ["thiếu thành phần", { ingredients_text: "" }, "thành phần"]
  ]) {
    test(`${what} → có khối: nói rõ thiếu gì, link trang sản phẩm (tab mới), nút Chép mã + vùng báo`, () => {
      const b = box(html(extra));
      assert.ok(b, html(extra));
      assert.ok(b.includes("Bổ sung trên Open Food Facts"), b);
      assert.ok(b.includes(word), b);
      assert.match(b, new RegExp(`<a [^>]*href="${LINK.replace(/[./]/g, "\\$&")}"[^>]*target="_blank"[^>]*rel="noopener"`));
      assert.match(b, /<button type="button" class="btn copy-code" data-code="8934588013133">Chép mã<\/button>/);
      assert.match(b, /<p class="copy-msg" role="status" aria-live="polite"><\/p>/);
      assert.ok(b.indexOf("copy-msg") > b.indexOf("Chép mã</button>"));
    });
  }

  test("thiếu cả 3 → khối liệt kê cả 3", () => {
    const b = box(html({ product_name: "", nutriments: {}, ingredients_text: "" }));
    assert.ok(b);
    for (const w of ["tên sản phẩm", "số dinh dưỡng", "thành phần"]) assert.ok(b.includes(w), w);
  });

  test("đủ cả 3 → không có khối, không có nút Chép mã", () => {
    const h = html();
    assert.equal(box(h), null);
    assert.ok(!h.includes("copy-code"), h);
    assert.ok(!h.includes("Bổ sung trên Open Food Facts"), h);
  });

  test("tên là NO_NAME (normalize tự đặt) cũng tính là thiếu tên", () => {
    const p = normalize(full({ product_name: "" }), "8934588013133");
    assert.equal(p.name, NO_NAME);
    assert.ok(box(renderProduct(p)).includes("tên sản phẩm"));
  });

  test("mã có ký tự lạ: link dùng encodeURIComponent, data-code escape", () => {
    const p = { ...normalize(full({ product_name: "" }), "x"), code: '12"<b>&3' };
    const b = box(renderProduct(p));
    assert.ok(b.includes('href="https://world.openfoodfacts.org/product/12%22%3Cb%3E%263"'), b);
    assert.ok(b.includes('data-code="12&quot;&lt;b&gt;&amp;3"'), b);
    assert.ok(!b.includes("<b>"), b);
  });

  test("khối Bổ sung và khung không tìm thấy có chung class copy-area (main.js tìm .copy-msg trong .copy-area)", () => {
    assert.match(box(html({ product_name: "" })), /^<div class="[^"]*\bcopy-area\b/);
    assert.match(renderNotFound("8930000000002"), /^<div class="[^"]*\bcopy-area\b/);
  });
});

describe("main.js: nút Chép mã tìm vùng báo trong .copy-area", () => {
  // Test node không có DOM (không chạy được main.js) nên kiểm thẳng mã nguồn: dò đúng chuỗi dưới đây.
  // Đổi cách viết dòng đó trong main.js (mà vẫn đúng ý) thì sửa chuỗi trong test cho khớp.
  test("listener dùng closest(\".copy-area\") (chạy cho màn không tìm thấy, cột So sánh và khối Bổ sung)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(src.includes('btn.closest(".copy-area")?.querySelector(".copy-msg")'), "main.js chưa tìm .copy-msg trong .copy-area");
  });
});
