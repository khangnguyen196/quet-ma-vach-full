// Test cache tra cứu trong bộ nhớ (src/off.js) với fetch giả, không gọi mạng thật.
// Chạy: npm test
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  getProduct, isProductCached, clearProductCache, setCacheClock, CACHE_MAX, CACHE_TTL_MS
} from "../src/off.js";

describe("getProduct: cache trong bộ nhớ", () => {
  let original, calls, handler, now;

  before(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    // fetch giả: ghi lại URL đã gọi, trả lời theo handler của từng test.
    Object.defineProperty(globalThis, "fetch", {
      configurable: true, writable: true,
      value: async (url) => { calls.push(String(url)); return handler(String(url)); }
    });
    setCacheClock(() => now);
  });
  after(() => {
    if (original) Object.defineProperty(globalThis, "fetch", original);
    else delete globalThis.fetch;
    setCacheClock();
    clearProductCache();
  });
  beforeEach(() => {
    clearProductCache();
    calls = [];
    now = 1_000_000;
    handler = okProduct;
  });

  /** Trả lời giống Open Food Facts: tìm thấy (status 1). */
  function okProduct(url) {
    const code = url.match(/\/product\/(\d+)\.json/)[1];
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ status: 1, product: { code, product_name: "SP " + code } }) };
  }
  const notFound = () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ status: 0 }) });
  const server503 = () => ({ ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) });

  test("tra lại cùng mã không gọi fetch lần 2", async () => {
    const a = await getProduct("8934563163150");
    const b = await getProduct("8934563163150");
    assert.equal(calls.length, 1);
    assert.equal(a.product_name, "SP 8934563163150");
    assert.deepEqual(b, a);
    assert.equal(isProductCached("8934563163150"), true);
  });

  test("không tìm thấy (null) cũng được cache", async () => {
    handler = notFound;
    assert.equal(await getProduct("0000000000000"), null);
    assert.equal(await getProduct("0000000000000"), null);
    assert.equal(calls.length, 1);
  });

  test("lỗi network không cache: lần sau gọi lại", async () => {
    handler = () => { throw new TypeError("Load failed"); };
    await assert.rejects(getProduct("12345678"), (e) => e.kind === "network");
    assert.equal(isProductCached("12345678"), false);
    handler = okProduct;
    const p = await getProduct("12345678");
    assert.equal(p.code, "12345678");
    assert.equal(calls.length, 2);
  });

  test("lỗi máy chủ (503) không cache: lần sau gọi lại", async () => {
    handler = server503;
    await assert.rejects(getProduct("12345678"), (e) => e.kind === "server" && e.status === 503);
    handler = okProduct;
    await getProduct("12345678");
    await getProduct("12345678");
    assert.equal(calls.length, 2);
  });

  test("hết 10 phút thì gọi lại", async () => {
    await getProduct("12345678");
    now += CACHE_TTL_MS; // đúng 10 phút: vẫn dùng cache
    await getProduct("12345678");
    assert.equal(calls.length, 1);
    now += 1; // quá 10 phút
    assert.equal(isProductCached("12345678"), false);
    await getProduct("12345678");
    assert.equal(calls.length, 2);
    assert.equal(CACHE_TTL_MS, 10 * 60 * 1000);
  });

  test("quá 30 mã thì mã cũ nhất bị bỏ", async () => {
    assert.equal(CACHE_MAX, 30);
    const codes = Array.from({ length: CACHE_MAX + 1 }, (_, i) => String(10000000 + i));
    for (const c of codes) await getProduct(c);
    assert.equal(calls.length, 31);
    assert.equal(isProductCached(codes[0]), false); // mã đầu tiên bị bỏ
    assert.equal(isProductCached(codes[1]), true);
    assert.equal(isProductCached(codes[30]), true);
    await getProduct(codes[30]);
    assert.equal(calls.length, 31); // mã mới nhất vẫn trong cache
    await getProduct(codes[0]);
    assert.equal(calls.length, 32); // mã bị bỏ phải gọi lại
  });

  test("2 lượt cùng mã cùng lúc chỉ 1 lần fetch", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    handler = async (url) => { await gate; return okProduct(url); };
    const p1 = getProduct("8993175532457");
    const p2 = getProduct("8993175532457");
    assert.equal(isProductCached("8993175532457"), true); // đang tra cũng tính là có
    release();
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(calls.length, 1);
    assert.equal(a, b);
  });

  test("2 lượt cùng lúc mà lỗi: cả 2 nhận lỗi, sau đó gọi lại được", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    handler = async () => { await gate; return server503(); };
    const p1 = getProduct("12345678");
    const p2 = getProduct("12345678");
    release();
    await assert.rejects(p1, (e) => e.kind === "server");
    await assert.rejects(p2, (e) => e.kind === "server");
    assert.equal(calls.length, 1);
    handler = okProduct;
    await getProduct("12345678");
    assert.equal(calls.length, 2);
  });

  test("URL vẫn có fields=… và app_name / app_version", async () => {
    await getProduct("8934563163150");
    const url = calls[0];
    assert.ok(url.startsWith("https://world.openfoodfacts.org/api/v2/product/8934563163150.json?fields="), url);
    assert.ok(url.includes("fields=code,product_name,"), url);
    assert.ok(url.includes("nutriments"), url);
    assert.ok(url.includes("&app_name=quet-ma-vach-full&app_version=0.1.0"), url);
  });
});
