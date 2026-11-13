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

  // Vòng 3 nang-t1: ĐỔI KỲ VỌNG (không nới): câu cũ "Không tìm thấy sản phẩm khớp…" được thay bằng khối
  // "Không chắc chắn…" + 3 nút (Quét mã vạch / Nhập số mã / Góp sản phẩm), kể cả khi confident = true.
  test("không có gợi ý → khối 'Không chắc chắn…' + 3 nút (thay câu cũ), không có câu 'Kết quả gợi ý'", () => {
    for (const hits of [[], null, undefined]) {
      for (const confident of [undefined, false, true]) {
        const html = R({ lines: ["abc"], hits, confident });
        assert.match(text(html), /Không chắc chắn, có thể sản phẩm chưa có trong danh mục/);
        assert.doesNotMatch(text(html), /Không tìm thấy sản phẩm khớp/);
        assert.equal((html.match(/data-front-action=/g) || []).length, 2);
        assert.match(html, /<div class="front-hits"><div class="front-unsure"/);
      }
      const html = R({ lines: ["abc"], hits });
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

describe("frontHitsShown: đúng những gợi ý được vẽ (dòng trạng thái đếm bằng hàm này)", () => {
  const count = (html) => (html.match(/data-front-code=/g) || []).length;

  test("7 gợi ý, 1 mã sai → 5 (lọc mã rồi cắt FRONT_MAX_HITS), bằng số nút vẽ ra", () => {
    const hits = ["8934572260543", "abc", "8934588022111", "8934614031322", "8934673300759", "8934673818391", "8934803043891"].map((c) => hit(c));
    const shown = render.frontHitsShown(hits);
    assert.equal(shown.length, 5);
    assert.ok(shown.every((h) => /^\d{8,14}$/.test(h.code)));
    assert.equal(count(render.renderFrontHits(hits)), shown.length);
  });

  test("2 gợi ý, 1 mã sai → 1", () => {
    const hits = [hit("8934572260543"), hit("12<b>")];
    assert.equal(render.frontHitsShown(hits).length, 1);
    assert.equal(count(render.renderFrontHits(hits)), 1);
  });

  test("không phải mảng / rỗng → []", () => {
    assert.deepEqual(render.frontHitsShown(null), []);
    assert.deepEqual(render.frontHitsShown([]), []);
  });
});

describe("frontHitsText: câu dòng #frontMsg (vòng 4 nang-t1)", () => {
  test("không có gợi ý (hoặc chỉ mã sai) → câu cũ, không có '(không chắc chắn)'", () => {
    const want = "Không tìm thấy sản phẩm khớp. Hãy quét mã vạch hoặc nhập số dưới mã vạch.";
    assert.equal(render.FRONT_NO_HITS_TEXT, want);
    for (const [hits, c] of [[[], false], [[], true], [null, undefined], [[hit("abc")], false]]) {
      const s = render.frontHitsText(hits, c);
      assert.equal(s, want);
      assert.ok(!s.includes("không chắc chắn"));
    }
  });

  test("có gợi ý: đếm đúng số được vẽ; không chắc (false / không truyền) thêm '(không chắc chắn)'", () => {
    const hits = ["8934572260543", "abc", "8934588022111"].map((c) => hit(c));
    assert.equal(render.frontHitsText(hits, false), "Có 2 gợi ý bên dưới (không chắc chắn). Hãy chọn đúng sản phẩm.");
    assert.equal(render.frontHitsText(hits), "Có 2 gợi ý bên dưới (không chắc chắn). Hãy chọn đúng sản phẩm.");
    assert.equal(render.frontHitsText(hits, true), "Có 2 gợi ý bên dưới. Hãy chọn đúng sản phẩm.");
    const seven = Array.from({ length: 7 }, (_, i) => hit(String(8934572260543 + i)));
    assert.equal(render.frontHitsText(seven, false), "Có 5 gợi ý bên dưới (không chắc chắn). Hãy chọn đúng sản phẩm.");
  });
});

describe("renderFrontHits: chỉ danh sách gợi ý (vẽ lại khi bấm Tìm lại)", () => {
  test("cùng phần danh sách như renderFrontResult", () => {
    const hits = [hit("8934572260543")];
    assert.ok(R({ lines: ["a"], hits }).includes(render.renderFrontHits(hits)));
    for (const confident of [true, false]) {
      const inner = R({ lines: ["a"], hits, confident }).match(/<div class="front-hits">([\s\S]*?)<\/div>\n<p class="src/)[1];
      assert.equal(inner, render.renderFrontHits(hits, { confident }));
    }
  });
});

describe("khối 'Không chắc chắn…' (vòng 3 nang-t1: confidenceOf của src/front-rank.js)", () => {
  const UNSURE = /Không chắc chắn, có thể sản phẩm chưa có trong danh mục/;
  const hits5 = ["8934572260543", "8934588022111", "8934614031322", "8934673300759", "8934803043891"].map((c) => hit(c));

  test("confident false (hoặc không truyền) + có gợi ý → khối + vẫn 5 gợi ý + câu 'Kết quả gợi ý…'; khối đứng trước danh sách", () => {
    for (const html of [render.renderFrontHits(hits5, { confident: false }), render.renderFrontHits(hits5), R({ lines: ["a"], hits: hits5 })]) {
      assert.match(text(html), UNSURE);
      assert.match(text(html), /Kết quả gợi ý, hãy chọn đúng sản phẩm/);
      assert.equal((html.match(/data-front-code=/g) || []).length, 5);
      assert.ok(html.indexOf("front-unsure") < html.indexOf("front-list"));
    }
  });

  test("confident true + có gợi ý → không có khối (như trước), không có nút data-front-action", () => {
    const html = R({ lines: ["a"], hits: hits5, confident: true });
    assert.doesNotMatch(text(html), UNSURE);
    assert.doesNotMatch(html, /front-unsure|data-front-action/);
    assert.equal((html.match(/data-front-code=/g) || []).length, 5);
    // chỉ true thật mới tính (chuỗi "true", 1 → vẫn thận trọng)
    for (const confident of ["true", 1]) assert.match(text(render.renderFrontHits(hits5, { confident })), UNSURE);
  });

  test("3 nút: Quét mã vạch (scan), Nhập số mã (code) là button type=button; Góp sản phẩm là a.btn href=OFF_ADD_URL target=_blank rel=noopener", () => {
    const html = render.renderFrontHits([], { confident: false });
    const scan = html.match(/<button[^>]*data-front-action="scan"[^>]*>([^<]*)<\/button>/);
    const code = html.match(/<button[^>]*data-front-action="code"[^>]*>([^<]*)<\/button>/);
    assert.ok(scan && code);
    assert.equal(scan[1], "Quét mã vạch");
    assert.equal(code[1], "Nhập số mã");
    for (const b of [scan[0], code[0]]) assert.match(b, /type="button"/);
    const a = html.match(/<a ([^>]*)>([^<]*)<\/a>/);
    assert.ok(a);
    assert.equal(a[2], "Góp sản phẩm lên Open Food Facts");
    const href = render.OFF_ADD_URL.replace(/&/g, "&amp;");
    assert.ok(a[1].includes(`href="${href}"`), a[1]);
    assert.match(a[1], /class="btn"/);
    assert.match(a[1], /target="_blank"/);
    assert.match(a[1], /rel="noopener"/);
  });

  test("chữ trong khối qua esc(); tên / thương hiệu gợi ý vẫn escape khi không chắc", () => {
    assert.equal(render.esc(render.FRONT_UNSURE_TEXT), render.FRONT_UNSURE_TEXT); // câu tĩnh không có ký tự HTML
    const evil = '<script>alert(1)</script>"\'&';
    const html = render.renderFrontHits([hit("8934572260543", { name: evil, brand: evil })], { confident: false });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;&amp;/);
    assert.match(text(html), UNSURE);
  });
});
