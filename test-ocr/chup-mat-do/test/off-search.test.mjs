import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createOffClient, searchUrl, productUrl, parseHits, makeLimiter, APP_NAME, APP_VERSION, DEFAULT_KIND,
} from "../off-search.mjs";

// Đồng hồ giả: sleep chỉ cộng thời gian, không chờ thật.
function fakeClock() {
  let t = 1_000_000;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps, advance: (ms) => { t += ms; } };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), "off-test-"));
}

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = responses.length ? responses.shift() : { status: 200, body: { products: [] } };
    if (r.throw) throw new Error(r.throw);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

test("URL có app_name / app_version giống src/off.js, lọc VN", () => {
  assert.equal(APP_NAME, "quet-ma-vach-full");
  assert.equal(APP_VERSION, "0.1.0");
  assert.equal(DEFAULT_KIND, "searchpl");
  const pl = searchUrl("searchpl", "omachi bo", { vn: true });
  assert.match(pl, /^https:\/\/world\.openfoodfacts\.org\/cgi\/search\.pl\?search_terms=omachi%20bo/);
  assert.match(pl, /tag_0=en%3Avietnam/);
  assert.match(pl, /json=1/);
  assert.match(pl, /page_size=5/);
  assert.match(pl, /app_name=quet-ma-vach-full&app_version=0\.1\.0$/);
  assert.doesNotMatch(searchUrl("searchpl", "omachi", { vn: false }), /tag_0/);
  assert.match(searchUrl("searchalicious", "omachi"), /countries_tags%3A%22en%3Avietnam%22/);
  assert.match(productUrl("123"), /\/api\/v2\/product\/123\.json\?fields=.*&app_name=/);
});

test("parseHits: search.pl (products) và search-a-licious (hits, brands là mảng)", () => {
  assert.deepEqual(parseHits("searchpl", { products: [{ code: "1", product_name: "A", brands: "B" }] }),
    [{ code: "1", name: "A", brands: "B" }]);
  assert.deepEqual(parseHits("searchalicious", { hits: [{ code: "2", product_name_vi: "Việt", product_name: "En", brands: ["X", "Y"] }] }),
    [{ code: "2", name: "Việt", brands: "X, Y" }]);
  assert.equal(parseHits("searchpl", { products: Array(9).fill({ code: "1" }) }).length, 5);
  assert.deepEqual(parseHits("searchpl", null), []);
});

test("makeLimiter: giãn đủ gapMs giữa 2 lần", async () => {
  const c = fakeClock();
  const l = makeLimiter(6000, c);
  await l.wait();
  await l.wait();
  c.advance(2000);
  await l.wait();
  assert.deepEqual(c.sleeps, [6000, 4000]);
});

test("tìm kiếm: ≤ 10 lượt / phút (giãn ≥ 6 giây), lượt lặp lấy từ cache, không gọi mạng", async () => {
  const c = fakeClock();
  const f = fakeFetch([
    { status: 200, body: { products: [{ code: "1", product_name: "A" }] } },
    { status: 200, body: { products: [{ code: "2", product_name: "B" }] } },
  ]);
  const off = createOffClient({ fetchImpl: f, cacheDir: tmpDir(), ...c });
  const t0 = c.now();
  const a = await off.search("omachi");
  const b = await off.search("vifon");
  const again = await off.search("omachi");
  assert.equal(f.calls.length, 2);
  assert.equal(a.hits[0].code, "1");
  assert.equal(b.hits[0].code, "2");
  assert.equal(again.cached, true);
  assert.equal(again.hits[0].code, "1");
  assert.ok(c.now() - t0 >= 6000, "lượt tìm thứ 2 phải chờ ≥ 6 giây");
  assert.equal(off.stats.search, 2);
  assert.equal(off.stats.cacheHits, 1);
});

test("đọc sản phẩm giãn ≥ 1 giây", async () => {
  const c = fakeClock();
  const f = fakeFetch([{ status: 200, body: { status: 1, product: { code: "1" } } }, { status: 200, body: { status: 1, product: { code: "2" } } }]);
  const off = createOffClient({ fetchImpl: f, cacheDir: tmpDir(), ...c });
  await off.product("1");
  await off.product("2");
  assert.deepEqual(c.sleeps, [1000]);
  assert.equal(off.stats.product, 2);
});

test("lọc VN ra 0 kết quả thì tìm 1 lần không lọc, ghi lại", async () => {
  const c = fakeClock();
  const f = fakeFetch([
    { status: 200, body: { products: [] } },
    { status: 200, body: { products: [{ code: "9" }] } },
  ]);
  const off = createOffClient({ fetchImpl: f, cacheDir: tmpDir(), ...c });
  const r = await off.search("abc");
  assert.equal(r.vnFallback, true);
  assert.equal(r.hits[0].code, "9");
  assert.match(f.calls[0], /tag_0=/);
  assert.doesNotMatch(f.calls[1], /tag_0=/);
  assert.equal(off.stats.vnFallback, 1);
});

test("429 / 5xx: thử lại đúng 1 lần sau ≥ 30 giây", async () => {
  const c = fakeClock();
  const f = fakeFetch([{ status: 503 }, { status: 200, body: { products: [{ code: "1" }] } }]);
  const off = createOffClient({ fetchImpl: f, cacheDir: tmpDir(), ...c });
  const r = await off.search("abc");
  assert.equal(r.hits[0].code, "1");
  assert.ok(c.sleeps.includes(30000));
  assert.equal(off.stats.retries, 1);
  assert.equal(off.stats.http429or5xx, 1);

  const f2 = fakeFetch([{ status: 429 }, { status: 429 }, { status: 200, body: {} }]);
  const off2 = createOffClient({ fetchImpl: f2, cacheDir: tmpDir(), ...fakeClock() });
  await assert.rejects(off2.search("abc"), /sau 1 lần thử lại/);
  assert.equal(f2.calls.length, 2, "không thử lần thứ 3");
});

test("lỗi không lưu cache; câu tìm trống không gọi mạng", async () => {
  const dir = tmpDir();
  const f = fakeFetch([{ status: 500 }, { status: 500 }]);
  const off = createOffClient({ fetchImpl: f, cacheDir: dir, ...fakeClock() });
  await assert.rejects(off.search("abc"));
  assert.equal(fs.readdirSync(dir).length, 0);
  const r = await off.search("   ");
  assert.deepEqual(r.hits, []);
  assert.equal(f.calls.length, 2);
});

test("khóa cache bỏ app_name / app_version", async () => {
  const dir = tmpDir();
  const f = fakeFetch([{ status: 200, body: { products: [{ code: "1" }] } }]);
  const off = createOffClient({ fetchImpl: f, cacheDir: dir, ...fakeClock() });
  await off.search("abc");
  const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8"));
  assert.doesNotMatch(saved.key, /app_name|app_version/);
});
