// Test nút "Chép mã" cạnh nút "Góp sản phẩm này lên Open Food Facts" (renderNotFound, đợt sua-cuoi).
// renderNotFound dùng chung cho màn tra cứu và cột "không tìm thấy" ở màn So sánh.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderNotFound, renderCompare } from "../src/render.js";

/** Thẻ <button> Chép mã trong html (hoặc null). */
const copyButton = (html) => html.match(/<button [^>]*class="[^"]*\bcopy-code\b[^"]*"[^>]*>[^<]*<\/button>/)?.[0] || null;

describe("renderNotFound: nút Chép mã", () => {
  test("có <button type=button> Chép mã, data-code là mã, kèm vùng báo aria-live gần nút", () => {
    const html = renderNotFound("8930000000002");
    const btn = copyButton(html);
    assert.ok(btn, html);
    assert.ok(btn.includes('type="button"'), btn);
    assert.ok(btn.includes('data-code="8930000000002"'), btn);
    assert.ok(btn.includes(">Chép mã</button>"), btn);
    assert.match(html, /<[a-z]+ class="copy-msg" role="status" aria-live="polite"><\/[a-z]+>/);
    // vùng báo đứng ngay sau khối chứa nút
    assert.ok(html.indexOf('class="copy-msg"') > html.indexOf("Chép mã</button>"));
  });

  test('mã chứa " < & được escape trong data-code, không thành thẻ HTML', () => {
    const html = renderNotFound('12"<b>&3');
    const btn = copyButton(html);
    assert.ok(btn, html);
    assert.ok(btn.includes('data-code="12&quot;&lt;b&gt;&amp;3"'), btn);
    assert.ok(!html.includes("<b>"), html);
  });

  test("vẫn giữ link góp cũ (1 link, trang Add a product chính thức, mở tab mới)", () => {
    const html = renderNotFound("8930000000002");
    assert.equal((html.match(/<a /g) || []).length, 1);
    assert.match(html, /<a class="btn" href="https:\/\/world\.openfoodfacts\.org\/cgi\/product\.pl\?type=search_or_add&amp;action=display" target="_blank" rel="noopener">Góp sản phẩm này lên Open Food Facts<\/a>/);
    assert.ok(html.includes("nhập mã 8930000000002"));
  });

  test("màn So sánh: mỗi cột không tìm thấy có nút Chép mã đúng mã của cột", () => {
    const html = renderCompare([{ code: "8930000000002", status: "notfound" }, { code: "8930000000019", status: "notfound" }]);
    const buttons = html.match(/<button [^>]*class="[^"]*\bcopy-code\b[^>]*>/g) || [];
    assert.equal(buttons.length, 2);
    assert.ok(buttons[0].includes('data-code="8930000000002"') && buttons[1].includes('data-code="8930000000019"'), buttons.join(" "));
  });
});
