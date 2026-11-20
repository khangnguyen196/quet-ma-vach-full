// Test phần thuần của lens-tai.mjs (đợt lens): URL giống frontImageUrl của src, danh sách tải, tải nối, thử lại có lùi,
// cầu dao 429 / 5xx liên tiếp, giãn cách mỗi kết nối, cổng 5 GB. Không gọi mạng (fetch giả).
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontImageUrl } from "../../../src/front-search.js";
import {
  imageUrl, fileNameOf, planList, existingOf, isRetryable, backoffMs, createBreaker, createGap, estimateRemaining, budgetOk,
  fetchOne, USER_AGENT, BUDGET_BYTES, DEFAULT_AVG_BYTES, MAX_CONN, GAP_MS, BREAKER_LIMIT, productUrl, candidatesFrom, imgidFromUrl, APP_NAME,
} from "../lens-tai.mjs";

test("imageUrl trùng frontImageUrl của src (400 / 200), sai dạng → rỗng", () => {
  for (const [code, img] of [["8934588752117", "front_vi.12"], ["12345678", "front_en.3"], ["0052603065054", "front_fr.100"]]) {
    for (const s of [400, 200]) assert.equal(imageUrl(code, img, s), frontImageUrl(code, img, s));
  }
  assert.equal(imageUrl("8934588752117", "front_vi.12", 100), "");
  assert.equal(imageUrl("893458875211", "front_vi.12"), "");
  assert.equal(imageUrl("8934588752117", "ingredients_vi.2"), "");
  assert.equal(imageUrl("8934588752117", "front_vi.12/../x"), "");
  assert.equal(imageUrl("8934588752117", ""), "");
});

test("planList bỏ dòng thiếu / sai img, bỏ mã trùng; existingOf nhận cả .400 và .200", () => {
  const p = planList([
    { code: "8934588752117", img: "front_vi.12" }, { code: "8934588752117", img: "front_vi.13" }, { code: "1234567890123", img: "" },
    { code: "abc", img: "front_vi.1" }, { code: "12345678", img: "front_en.3" }, null,
  ]);
  assert.deepEqual(p.items, [{ code: "8934588752117", img: "front_vi.12" }, { code: "12345678", img: "front_en.3" }]);
  assert.equal(p.noImg, 1);
  assert.equal(p.codes, 3);
  const names = new Set([fileNameOf("12345678", "front_en.3", 200)]);
  assert.deepEqual(existingOf(names, "12345678", "front_en.3"), { size: 200, name: "12345678_front_en.3.200.jpg" });
  assert.equal(existingOf(names, "8934588752117", "front_vi.12"), null);
  assert.equal(existingOf(new Set([fileNameOf("12345678", "front_en.2", 400)]), "12345678", "front_en.3"), null, "rev khác → tải lại");
});

test("thử lại: 429 / 5xx / lỗi mạng; không thử lại 404 / 403; lùi 2, 4, 8 giây, trần 30", () => {
  for (const s of [0, 429, 500, 503, 599]) assert.equal(isRetryable(s), true, String(s));
  for (const s of [200, 403, 404, 410]) assert.equal(isRetryable(s), false, String(s));
  assert.deepEqual([1, 2, 3, 10].map(backoffMs), [2000, 4000, 8000, 30000]);
});

test("cầu dao mở khi ≥ 5 lần 429 / 5xx LIÊN TIẾP, thành công / 404 đặt lại", () => {
  const b = createBreaker();
  assert.equal(BREAKER_LIMIT, 5);
  for (const s of [429, 503, 500, 429]) assert.equal(b.record(s), false);
  assert.equal(b.record(200), false);
  assert.equal(b.run, 0);
  for (const s of [429, 503, 500, 429]) b.record(s);
  b.record(404);
  assert.equal(b.run, 0);
  for (let i = 0; i < 4; i++) assert.equal(b.record(503), false);
  assert.equal(b.record(429), true);
  assert.equal(b.open, true);
  assert.equal(b.record(200), true, "đã mở thì giữ mở");
  // mẫu sai: cầu dao đếm tổng (không liên tiếp) sẽ mở ở đây; bản đúng không mở
  const c = createBreaker();
  for (let i = 0; i < 10; i++) { c.record(503); c.record(200); }
  assert.equal(c.open, false);
});

test("giãn cách mỗi kết nối ≥ 1 giây; ≤ 3 kết nối", async () => {
  assert.equal(MAX_CONN, 3);
  assert.equal(GAP_MS, 1000);
  let t = 0;
  const waits = [];
  const gap = createGap(1000, { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await gap();
  t += 300;
  await gap();
  t += 1500;
  await gap();
  assert.deepEqual(waits, [700]);
});

test("fetchOne: .400 lỗi 404 → .200; 503 thử lại có lùi rồi được; cầu dao mở → dừng; User-Agent không có thông tin cá nhân", async () => {
  const calls = [];
  const resp = (status, body = "") => ({ status, ok: status >= 200 && status < 300, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
  const sleeps = [];
  const deps = (script) => ({
    fetchImpl: async (url, opt) => { calls.push({ url, ua: opt.headers["User-Agent"] }); const s = script.shift(); if (s === "throw") throw new Error("net"); return resp(s, s === 200 ? "jpg" : ""); },
    gap: async () => {}, breaker: createBreaker(), sleep: async (ms) => { sleeps.push(ms); },
  });
  let r = await fetchOne({ code: "12345678", img: "front_en.3" }, deps([404, 200]));
  assert.equal(r.ok, true);
  assert.equal(r.size, 200);
  assert.match(calls[0].url, /front_en\.3\.400\.jpg$/);
  assert.match(calls[1].url, /front_en\.3\.200\.jpg$/);
  assert.equal(calls[0].ua, USER_AGENT);
  assert.doesNotMatch(USER_AGENT, /@|khang|nguyen|gmail/i);
  calls.length = 0;
  r = await fetchOne({ code: "12345678", img: "front_en.3" }, deps([503, "throw", 200]));
  assert.equal(r.ok, true);
  assert.equal(r.size, 400);
  assert.equal(r.tries, 3);
  assert.deepEqual(sleeps, [2000, 4000]);
  r = await fetchOne({ code: "12345678", img: "front_en.3" }, deps([404, 404]));
  assert.deepEqual([r.ok, r.status], [false, 404]);
  r = await fetchOne({ code: "12345678", img: "front_en.3" }, deps([403]));
  assert.deepEqual([r.ok, r.status, r.tries], [false, 403, 1], "403 không thử .200, không thử lại");
  const d = deps([503, 503, 503, 503, 503, 503, 503, 503]);
  r = await fetchOne({ code: "12345678", img: "front_en.3" }, d);
  assert.equal(r.ok, false);
  assert.equal(d.breaker.open, false, "4 lượt 503 của 1 ảnh chưa đủ 5");
  r = await fetchOne({ code: "12345678", img: "front_en.4" }, d);
  assert.equal(r.breaker, true);
  assert.equal(d.breaker.open, true);
});

test("chống ăn gian (chuẩn bị): URL API có app_name; ứng viên = khóa danh mục trước, rồi front_xx (vi → en → tên); rev lệch → không biết imgid", () => {
  assert.equal(productUrl("8934588752117"), "https://world.openfoodfacts.org/api/v2/product/8934588752117?fields=code,images&app_name=quet-ma-vach-lens");
  assert.equal(productUrl("x"), "");
  assert.equal(APP_NAME, "quet-ma-vach-lens");
  const product = { images: { 1: { uploaded_t: 1 }, front_en: { imgid: "2", rev: "9" }, front_vi: { imgid: "3", rev: "12" }, front_th: { imgid: "5", rev: "20" }, ingredients_vi: { imgid: "4", rev: "7" }, front: { imgid: "8", rev: "1" } } };
  assert.deepEqual(candidatesFrom(product, "front_en.9"), [
    { key: "front_en.9", imgid: "2", fromCatalog: true }, { key: "front_vi.12", imgid: "3", fromCatalog: false }, { key: "front_th.20", imgid: "5", fromCatalog: false },
  ]);
  const lag = candidatesFrom(product, "front_vi.10");
  assert.equal(lag[0].imgid, null);
  assert.match(lag[0].note, /rev danh mục 10/);
  assert.deepEqual(lag.slice(1).map((x) => x.key), ["front_vi.12", "front_en.9", "front_th.20"]);
  assert.equal(candidatesFrom(product, "front_fr.3")[0].note, "khóa danh mục không còn trên OFF");
  assert.deepEqual(candidatesFrom(null, ""), []);
  assert.equal(imgidFromUrl("https://images.openfoodfacts.org/images/products/893/457/226/0543/3.jpg"), "3");
  assert.equal(imgidFromUrl("https://x/front_vi.3.400.jpg"), null);
});

test("cổng 5 GB: hiện có + ước còn lại", () => {
  assert.equal(BUDGET_BYTES, 5 * 1024 ** 3);
  assert.equal(estimateRemaining(10, 0, 0), 10 * DEFAULT_AVG_BYTES);
  assert.equal(estimateRemaining(10, 4, 400), 1000);
  assert.equal(budgetOk(4 * 1024 ** 3, 1024 ** 3), true);
  assert.equal(budgetOk(4 * 1024 ** 3, 1024 ** 3 + 1), false);
});
