// Test thanh "Đã có bản mới" (src/pwa.js): lấy danh sách file JS / CSS của trang và kiểm chúng có trong cache bản mới chưa.
// Không cần trình duyệt: cacheStorage và document đều là đồ giả.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pageAssetUrls, isPageCurrent } from "../src/pwa.js";

const BASE = "https://khangnguyen196.github.io/quet-ma-vach-full/";
const JS = BASE + "assets/index-CpU82utc.js";
const CSS = BASE + "assets/index-7_e-qWk0.css";

/** cacheStorage giả: match(url) trả 1 "Response" nếu url có trong danh sách, không thì undefined (như CacheStorage thật). */
function fakeCaches(urls) {
  const set = new Set(urls);
  const asked = [];
  return {
    asked,
    async match(url) {
      asked.push(url);
      return set.has(url) ? { ok: true, url } : undefined;
    }
  };
}

/** document giả: querySelectorAll trả danh sách { href } (href đã là địa chỉ đầy đủ như trình duyệt). */
const fakeDoc = (hrefs) => ({
  selectors: [],
  querySelectorAll(selector) {
    this.selectors.push(selector);
    return hrefs.map((href) => ({ href }));
  }
});

describe("isPageCurrent", () => {
  test("đủ JS + CSS trong cache → true (trang đã là bản mới, không hiện thanh)", async () => {
    assert.equal(await isPageCurrent([JS, CSS], fakeCaches([JS, CSS, BASE + "index.html"])), true);
  });

  test("thiếu CSS → false", async () => {
    assert.equal(await isPageCurrent([JS, CSS], fakeCaches([JS])), false);
  });

  test("thiếu JS → false", async () => {
    assert.equal(await isPageCurrent([JS, CSS], fakeCaches([CSS])), false);
  });

  test("match ném lỗi (đồng bộ hoặc Promise bị từ chối) → false", async () => {
    const throwsSync = { match() { throw new Error("SecurityError"); } };
    const rejects = { match: async () => { throw new Error("cache hỏng"); } };
    assert.equal(await isPageCurrent([JS, CSS], throwsSync), false);
    assert.equal(await isPageCurrent([JS, CSS], rejects), false);
  });

  test("danh sách rỗng → false (không có gì để kiểm thì vẫn hiện thanh)", async () => {
    const c = fakeCaches([JS, CSS]);
    assert.equal(await isPageCurrent([], c), false);
    assert.equal(c.asked.length, 0);
  });

  test("cacheStorage không có (undefined) → false, không ném lỗi", async () => {
    assert.equal(await isPageCurrent([JS], undefined), false);
  });
});

describe("pageAssetUrls", () => {
  test("lấy JS của app + CSS trong assets/, bỏ link ngoài (Google Fonts)", () => {
    const doc = fakeDoc([
      "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;900&display=swap",
      CSS
    ]);
    assert.deepEqual(pageAssetUrls(JS, doc), [JS, CSS]);
    assert.deepEqual(doc.selectors, ['link[rel="stylesheet"]']);
  });

  test("không có CSS trong assets/ → chỉ còn JS; href hỏng / rỗng bị bỏ", () => {
    const doc = fakeDoc(["https://fonts.googleapis.com/css2?family=Archivo", "", "không phải địa chỉ", BASE + "style.css"]);
    assert.deepEqual(pageAssetUrls(JS, doc), [JS]);
  });

  test("nhiều CSS trong assets/ → giữ đúng thứ tự", () => {
    const css2 = BASE + "assets/other-abc.css";
    assert.deepEqual(pageAssetUrls(JS, fakeDoc([CSS, css2])), [JS, CSS, css2]);
  });

  test("kết hợp: trang bản cũ (JS cũ) với cache bản mới → false", async () => {
    const urls = pageAssetUrls(BASE + "assets/index-OLD.js", fakeDoc([CSS]));
    assert.equal(await isPageCurrent(urls, fakeCaches([JS, CSS])), false);
  });
});
