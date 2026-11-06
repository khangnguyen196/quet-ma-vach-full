// Test so sánh 2 sản phẩm (src/compare.js + renderCompare) và nút góp sản phẩm (renderNotFound).
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalize } from "../src/off.js";
import { compareRows, COMPARE_ROWS } from "../src/compare.js";
import {
  renderCompare, renderNotFound, renderCompareButton, renderHistoryOptions,
  OFF_ADD_URL, ALLERGY_NO_DATA, ALLERGY_NEUTRAL, ALLERGY_ALERT_ID
} from "../src/render.js";

const FORBIDDEN = ["an toàn", "không có chất gây dị ứng", "Không ghi nhận chất gây dị ứng"];
function assertNoForbidden(html, where) {
  const low = html.toLowerCase();
  for (const f of FORBIDDEN) assert.ok(!low.includes(f.toLowerCase()), `${where} chứa "${f}"`);
}

/** Sản phẩm đã normalize từ dữ liệu thô tối thiểu. */
const prod = (code, extra = {}) => normalize({ code, product_name: "SP " + code, ...extra }, code);
const ok = (p) => ({ code: p.code, status: "ok", product: p });

const FULL = {
  "energy-kcal_100g": 452, sugars_100g: 3.25, salt_100g: 2.1, fat_100g: 18,
  "saturated-fat_100g": 8.04, proteins_100g: 9
};

describe("compareRows", () => {
  test("đủ 6 dòng đúng thứ tự, đúng nhãn / đơn vị", () => {
    const rows = compareRows(prod("11111111", { nutriments: FULL }), prod("22222222", { nutriments: {} }));
    assert.deepEqual(rows.map((r) => r.key), ["energy", "sugars", "salt", "fat", "saturatedFat", "proteins"]);
    assert.deepEqual(rows.map((r) => r.label), ["Năng lượng", "Đường", "Muối", "Chất béo", "Chất béo bão hòa", "Chất đạm"]);
    assert.deepEqual(rows.map((r) => r.unit), ["kcal", "g", "g", "g", "g", "g"]);
    assert.deepEqual(rows.map((r) => r.a), [452, 3.25, 2.1, 18, 8.04, 9]);
    assert.deepEqual(rows.map((r) => r.b), [null, null, null, null, null, null]);
    assert.equal(COMPARE_ROWS.length, 6);
  });

  test("sản phẩm null (không tìm thấy / lỗi) → mọi ô null", () => {
    const rows = compareRows(null, prod("22222222", { nutriments: FULL }));
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.a === null));
    assert.deepEqual(rows.map((r) => r.b), [452, 3.25, 2.1, 18, 8.04, 9]);
    assert.ok(compareRows(null, null).every((r) => r.a === null && r.b === null));
  });

  test("0 là số thật, không phải thiếu dữ liệu", () => {
    const rows = compareRows(prod("11111111", { nutriments: { sugars_100g: 0 } }), null);
    assert.equal(rows.find((r) => r.key === "sugars").a, 0);
  });

  test("chỉ có kJ (energy_100g) / natri (sodium_100g): không tự tính kcal / muối", () => {
    // Qua normalize: energy_100g và sodium_100g không được giữ.
    const viaNormalize = prod("11111111", { nutriments: { energy_100g: 1891, energy: 1891, sodium_100g: 0.84, sodium: 0.84 } });
    // Object dựng tay (phòng khi normalize đổi): có sẵn energy_100g / sodium_100g mà thiếu kcal / muối.
    const manual = { code: "22222222", name: "Thử", nutriments: { energy_100g: 1891, "energy-kj_100g": 1891, sodium_100g: 0.84 } };
    const rows = compareRows(viaNormalize, manual);
    for (const key of ["energy", "salt"]) {
      const r = rows.find((x) => x.key === key);
      assert.equal(r.a, null, `${key} bên A`);
      assert.equal(r.b, null, `${key} bên B`);
    }
    const html = renderCompare([ok(viaNormalize), { code: "22222222", status: "ok", product: { ...manual, allergenKeys: [], traceKeys: [], hasAllergenData: false } }]);
    const energyRow = html.match(/<tr><th scope="row">Năng lượng<\/th>.*?<\/tr>/)[0];
    const saltRow = html.match(/<tr><th scope="row">Muối<\/th>.*?<\/tr>/)[0];
    for (const row of [energyRow, saltRow]) {
      assert.equal((row.match(/chưa có dữ liệu/g) || []).length, 2, row);
      assert.ok(!/\d/.test(row.replace(/<[^>]+>/g, "")), row); // không có con số nào
    }
  });

  test("giá trị không phải số → null", () => {
    const manual = { nutriments: { "energy-kcal_100g": "452", sugars_100g: NaN, salt_100g: Infinity } };
    const rows = compareRows(manual, { nutriments: null });
    assert.ok(rows.every((r) => r.a === null && r.b === null));
  });
});

describe("renderCompare", () => {
  test("ô null ghi 'chưa có dữ liệu'; số định dạng vi-VN 1 chữ số thập phân", () => {
    const html = renderCompare([ok(prod("11111111", { nutriments: FULL })), ok(prod("22222222"))]);
    assert.equal((html.match(/<span class="empty">chưa có dữ liệu<\/span>/g) || []).length, 6);
    assert.ok(html.includes("452 kcal"));
    assert.ok(html.includes("3,3 g")); // 3,25 → 1 chữ số thập phân như bảng dinh dưỡng
    assert.ok(html.includes("8 g")); // 8,04 → 8
    assert.ok(html.includes("2,1 g"));
    assert.ok(html.includes("trên 100 g / 100 ml"));
  });

  test("không tô màu / in đậm bên nào hơn", () => {
    const html = renderCompare([
      ok(prod("11111111", { nutriments: FULL })),
      ok(prod("22222222", { nutriments: { ...FULL, sugars_100g: 30 } }))
    ]);
    const table = html.match(/<table class="cmp-table">[\s\S]*<\/table>/)[0];
    assert.ok(!/<(b|strong|em|mark)\b/.test(table), "bảng có thẻ in đậm");
    assert.ok(!/class="[^"]*(better|worse|higher|lower|win|more|less)/.test(table), "bảng có class so hơn kém");
    assert.ok(!/style=/.test(table));
  });

  test("tên / mã có <script> hay \" được escape", () => {
    const bad = prod("11111111", { product_name: '<script>alert("x")</script>', image_front_url: 'https://x/"onerror="alert(1)' });
    bad.code = '1"><script>alert(2)</script>';
    const html = renderCompare([ok(bad), { code: '2"><img src=x onerror=alert(3)>', status: "notfound" }]);
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
    assert.ok(html.includes("1&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"));
    assert.ok(html.includes('src="https://x/&quot;onerror=&quot;alert(1)"'));
  });

  test("không có id allergyAlert (id đó chỉ dành cho màn tra cứu)", () => {
    const p = prod("11111111", { allergens_tags: ["en:milk"] });
    for (const profile of [[], ["milk"], ["peanuts"]]) {
      const html = renderCompare([ok(p), ok(prod("22222222"))], profile);
      assert.ok(!html.includes(`id="${ALLERGY_ALERT_ID}"`));
      assert.ok(!html.includes("id="));
      assert.equal((html.match(/class="allergy-box cmp-allergy"/g) || []).length, 2);
    }
  });

  test("khung dị ứng mỗi cột: đỏ / vàng / thiếu dữ liệu / trung tính", () => {
    const red = prod("11111111", { allergens_tags: ["en:milk", "en:gluten"], traces_tags: ["en:peanuts"] });
    const nodata = prod("22222222", { traces_tags: ["en:peanuts"] });
    const html = renderCompare([ok(red), ok(nodata)], ["milk", "peanuts"]);
    const cols = html.split('<section class="cmp-col"').slice(1);
    assert.equal(cols.length, 2);
    // Cột A: đỏ Sữa + vàng Đậu phộng, không câu thiếu dữ liệu
    assert.ok(cols[0].includes('class="allergy-alert danger" role="alert"><strong>Cảnh báo dị ứng:</strong> có Sữa (nhóm trong hồ sơ của bạn)'));
    assert.ok(cols[0].includes("<strong>Có thể lẫn vết:</strong> Đậu phộng"));
    assert.ok(!cols[0].includes(ALLERGY_NO_DATA));
    // Cột B: thiếu dữ liệu (khung riêng) + vàng, không đỏ
    assert.ok(cols[1].includes(`<p class="allergy-alert nodata">${ALLERGY_NO_DATA}</p>`));
    assert.ok(cols[1].includes("<strong>Có thể lẫn vết:</strong> Đậu phộng"));
    assert.ok(!cols[1].includes("danger"));
    // Trung tính
    const neutral = renderCompare([ok(prod("33333333", { allergens_tags: ["en:gluten"] })), ok(nodata)], ["milk"]);
    assert.ok(neutral.split('<section class="cmp-col"')[1].includes(ALLERGY_NEUTRAL));
  });

  test("hồ sơ 0 nhóm → khung dị ứng rỗng", () => {
    const html = renderCompare([ok(prod("11111111", { allergens_tags: ["en:milk"] })), ok(prod("22222222"))], []);
    assert.equal((html.match(/<div class="allergy-box cmp-allergy"><\/div>/g) || []).length, 2);
  });

  test("cột không tìm thấy: câu + nút góp sản phẩm; cột lỗi: câu như renderError", () => {
    const html = renderCompare([
      { code: "8930000000002", status: "notfound" },
      { code: "8934563163150", status: "error", kind: "server", error: Object.assign(new Error("HTTP 503"), { status: 503 }) }
    ], ["milk"]);
    assert.ok(html.includes("Chưa có mã 8930000000002 trong Open Food Facts"));
    assert.ok(html.includes("Góp sản phẩm này lên Open Food Facts"));
    assert.ok(html.includes("Open Food Facts đang lỗi hoặc quá tải (HTTP 503), thử lại sau."));
    assert.ok(html.includes("Tra lại mã 8934563163150 sau ít giây."));
    const net = renderCompare([{ code: "11111111", status: "error", kind: "network", error: new TypeError("Load failed") }, ok(prod("22222222"))]);
    assert.ok(net.includes("Không kết nối được tới Open Food Facts"));
    assert.ok(!net.includes("Load failed")); // bản rút gọn: không có dòng lỗi kỹ thuật
    // Bảng vẫn đủ 6 dòng, bên lỗi / không tìm thấy là "chưa có dữ liệu"
    assert.equal((html.match(/<tr><th scope="row">/g) || []).length, 6);
    assert.equal((html.match(/chưa có dữ liệu/g) || []).length, 12);
  });

  test("không chứa chữ cấm (mọi tổ hợp)", () => {
    const tagSets = [undefined, [], ["en:milk"], ["fr:lait"], ["en:milk", "en:peanuts"]];
    const profiles = [[], ["milk"], ["peanuts", "gluten"]];
    for (const a of tagSets) for (const t of tagSets) for (const profile of profiles) {
      const p = prod("11111111", { allergens_tags: a, traces_tags: t });
      assertNoForbidden(renderCompare([ok(p), { code: "22222222", status: "notfound" }], profile), "renderCompare");
    }
  });
});

describe("renderNotFound: nút góp sản phẩm", () => {
  test("nút là <a class=btn> mở trang thêm sản phẩm chính thức, target=_blank, rel=noopener", () => {
    const html = renderNotFound("8930000000002");
    const a = html.match(/<a [^>]*>Góp sản phẩm này lên Open Food Facts<\/a>/);
    assert.ok(a, html);
    assert.ok(a[0].includes('class="btn"'));
    assert.ok(a[0].includes('target="_blank"'));
    assert.ok(a[0].includes('rel="noopener"'));
    assert.ok(a[0].includes('href="https://world.openfoodfacts.org/cgi/product.pl?type=search_or_add&amp;action=display"'));
    assert.equal(OFF_ADD_URL, "https://world.openfoodfacts.org/cgi/product.pl?type=search_or_add&action=display");
    // Chỉ 1 link trong khung (bỏ link chữ cũ), không còn link cũ type=add
    assert.equal((html.match(/<a /g) || []).length, 1);
    assert.ok(!html.includes("type=add&"));
    // Giữ câu giải thích: cần tài khoản, chụp bao bì, ghi mã để người dùng nhập
    assert.ok(html.includes("cần tài khoản Open Food Facts và chụp bao bì"));
    assert.ok(html.includes("nhập mã 8930000000002"));
  });

  test("mã lạ được escape", () => {
    const html = renderNotFound('1"><img src=x onerror=alert(1)>&');
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("1&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;"));
  });
});

describe("nút / ô chọn ở màn So sánh", () => {
  test("renderCompareButton escape mã", () => {
    const html = renderCompareButton('8934563163150"><x');
    assert.ok(html.includes('data-compare-code="8934563163150&quot;&gt;&lt;x"'));
    assert.ok(html.includes("So sánh với sản phẩm khác"));
  });

  test("renderHistoryOptions: lựa chọn đầu rỗng; tên / mã được escape", () => {
    assert.equal(renderHistoryOptions([]), '<option value="">Chưa quét sản phẩm nào</option>');
    const html = renderHistoryOptions([{ code: "8934563163150", name: "<b>Mì</b>" }, { code: '1"2', name: "A" }]);
    assert.ok(html.startsWith('<option value="">Chọn từ đã quét gần đây</option>'));
    assert.ok(html.includes('<option value="8934563163150">&lt;b&gt;Mì&lt;/b&gt; (8934563163150)</option>'));
    assert.ok(html.includes('value="1&quot;2"'));
  });
});
