// Test phần HTML của "Chụp mặt trước" (src/render.js renderFrontResult / renderFrontHits, đợt chup-mat vòng 2):
// ô sửa chữ + nút Tìm lại, tối đa 5 gợi ý (ảnh, tên, thương hiệu, mã), câu "Kết quả gợi ý…", không gợi ý thì mời quét mã,
// dòng nguồn ODbL. Mọi chữ từ máy chủ / danh mục qua esc(). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as render from "../src/render.js";

const IMG = "https://images.openfoodfacts.org/images/products/893/457/226/0543/front_vi.10.200.jpg";
const hit = (code, extra = {}) => ({ code, name: "Lạp xưởng " + code, brand: "Vissan", image: "", ...extra });
const R = (args) => render.renderFrontResult(args);
// bỏ thẻ HTML để kiểm chữ người dùng thấy
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("renderFrontResult: ô chữ + nút Tìm lại + gợi ý + nguồn", () => {
  test("có textarea (giá trị = các dòng nối xuống dòng), có label, nút Tìm lại", () => {
    const html = R({ lines: ["VISSAN", "LẠP XƯỞNG MAI QUẾ LỘ"], hits: [hit("8934572260543")] });
    const m = html.match(/<textarea[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/);
    assert.ok(m, "phải có textarea có id");
    assert.equal(m[2], "VISSAN\nLẠP XƯỞNG MAI QUẾ LỘ");
    assert.match(html, new RegExp(`<label[^>]*for="${m[1]}"`));
    assert.match(html, /<button[^>]*type="button"[^>]*data-front-retry[^>]*>Tìm lại<\/button>/);
  });

  test("có câu 'Kết quả gợi ý, hãy chọn đúng sản phẩm' và dòng nguồn ODbL có link", () => {
    const html = R({ lines: ["a"], hits: [hit("8934572260543")] });
    assert.match(text(html), /Kết quả gợi ý, hãy chọn đúng sản phẩm/);
    assert.match(text(html), /Gợi ý từ danh mục dữ liệu Open Food Facts \( ?ODbL ?\)/);
    assert.match(html, /<a [^>]*href="https:\/\/opendatacommons\.org\/licenses\/odbl\/[^"]*"/);
  });

  test("escape: <script> trong chữ đọc được, tên, thương hiệu", () => {
    const evil = '<script>alert(1)</script>"\'&';
    const html = R({ lines: [evil], hits: [hit("8934572260543", { name: evil, brand: evil })] });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;&amp;/);
  });

  test("tối đa 5 gợi ý", () => {
    const hits = ["8934572260543", "8934572260544", "8934572260545", "8934572260546", "8934572260547", "8934572260548", "8934572260549"]
      .map((c) => hit(c));
    const html = R({ lines: ["a"], hits });
    assert.equal((html.match(/data-front-code=/g) || []).length, 5);
  });

  test("mỗi gợi ý là <button type=button data-front-code=mã> có tên, thương hiệu, mã", () => {
    const html = R({ lines: ["a"], hits: [hit("8934572260543", { name: "Lạp xưởng mai quế lộ", brand: "Vissan" })] });
    const b = html.match(/<button[^>]*data-front-code="8934572260543"[^>]*>([\s\S]*?)<\/button>/);
    assert.ok(b);
    assert.match(b[0], /type="button"/);
    assert.match(text(b[1]), /Lạp xưởng mai quế lộ/);
    assert.match(text(b[1]), /Vissan/);
    assert.match(text(b[1]), /8934572260543/);
  });

  test("thương hiệu / tên trống → 'chưa có dữ liệu' (không đoán)", () => {
    const html = R({ lines: ["a"], hits: [hit("8934572260543", { name: "", brand: "" })] });
    assert.equal((text(html).match(/chưa có dữ liệu/g) || []).length, 2);
  });

  test("ảnh hợp lệ (images.openfoodfacts.org) → <img> có width/height, loading=lazy, alt; không ảnh → 'chưa có ảnh'", () => {
    const withImg = R({ lines: ["a"], hits: [hit("8934572260543", { image: IMG })] });
    const img = withImg.match(/<img [^>]*>/);
    assert.ok(img);
    assert.match(img[0], new RegExp(`src="${IMG.replace(/[.]/g, "\\.")}"`));
    assert.match(img[0], /width="\d+"/);
    assert.match(img[0], /height="\d+"/);
    assert.match(img[0], /loading="lazy"/);
    assert.match(img[0], /alt="[^"]*"/);
    assert.doesNotMatch(img[0], /onerror/i);
    const noImg = R({ lines: ["a"], hits: [hit("8934572260543", { image: "" })] });
    assert.doesNotMatch(noImg, /<img /);
    assert.match(text(noImg), /chưa có ảnh/);
  });

  test("URL ảnh lạ (http, tên miền khác, javascript:) bị chặn → 'chưa có ảnh'", () => {
    for (const image of ["http://images.openfoodfacts.org/a.jpg", "https://evil.example/a.jpg", "javascript:alert(1)",
      "https://images.openfoodfacts.org.evil.example/a.jpg", '"><script>x</script>']) {
      const html = R({ lines: ["a"], hits: [hit("8934572260543", { image })] });
      assert.doesNotMatch(html, /<img /, image);
      assert.match(text(html), /chưa có ảnh/, image);
    }
  });

  test("mã chỉ là chữ số (8–14) trong data-front-code; mã lạ thì bỏ gợi ý đó", () => {
    const html = R({ lines: ["a"], hits: [hit('123"><script>'), hit("12ab5678"), hit("1234567"), hit("8934572260543")] });
    const codes = [...html.matchAll(/data-front-code="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(codes, ["8934572260543"]);
    assert.doesNotMatch(html, /<script>/);
  });

  test("không có gợi ý → mời quét mã vạch hoặc nhập số, không có câu 'Kết quả gợi ý'", () => {
    for (const hits of [[], null, undefined]) {
      const html = R({ lines: ["abc"], hits });
      assert.match(text(html), /Không tìm thấy sản phẩm khớp\. Hãy quét mã vạch hoặc nhập số dưới mã vạch\./);
      assert.doesNotMatch(html, /Kết quả gợi ý/);
      assert.doesNotMatch(html, /data-front-code/);
      assert.match(html, /<textarea/); // vẫn cho sửa chữ rồi tìm lại
    }
  });

  test("reencoded false → có câu ảnh gửi nguyên bản; true / không truyền → không có", () => {
    assert.match(text(R({ lines: ["a"], hits: [], reencoded: false })), /nguyên bản/);
    assert.doesNotMatch(text(R({ lines: ["a"], hits: [], reencoded: true })), /nguyên bản/);
    assert.doesNotMatch(text(R({ lines: ["a"], hits: [] })), /nguyên bản/);
  });

  test("lines rỗng / không phải mảng → textarea rỗng, không lỗi", () => {
    for (const lines of [[], null, undefined]) {
      const html = R({ lines, hits: [] });
      assert.match(html, /<textarea[^>]*><\/textarea>/);
    }
  });
});

describe("renderFrontHits: chỉ danh sách gợi ý (vẽ lại khi bấm Tìm lại)", () => {
  test("cùng phần danh sách như renderFrontResult", () => {
    const hits = [hit("8934572260543")];
    assert.ok(R({ lines: ["a"], hits }).includes(render.renderFrontHits(hits)));
  });
});
