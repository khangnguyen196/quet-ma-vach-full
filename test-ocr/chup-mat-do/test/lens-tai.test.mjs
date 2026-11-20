// Test phần thuần của lens-tai.mjs (đợt lens): URL giống frontImageUrl của src, danh sách tải, tải nối, thử lại có lùi,
// cầu dao 429 / 5xx liên tiếp, giãn cách mỗi kết nối, cổng 5 GB. Không gọi mạng (fetch giả).
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontImageUrl } from "../../../src/front-search.js";
import {
  imageUrl, fileNameOf, planList, existingOf, isRetryable, backoffMs, createBreaker, createGap, estimateRemaining, budgetOk,
  fetchOne, USER_AGENT, BUDGET_BYTES, DEFAULT_AVG_BYTES, MAX_CONN, GAP_MS, BREAKER_LIMIT, productUrl, candidatesFrom, imgidFromUrl, APP_NAME,
  makeGetProduct, antiCheatVerdict, summarizeAntiCheat, needsImage, onDriveD, catalogImgidOf, decidePIndex, buildVecInput, IMGID_KEY_RE,
  imgidFilePlan,
} from "../lens-tai.mjs";
import { chooseSubstitute } from "../lens-do.mjs";

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

// ---------------- vòng 2: cầu dao OFF API, chống ăn gian "chưa xong" ≠ "loại", bộ P, đầu vào lens-vec ----------------
const jsonResp = (status) => ({ status, ok: status >= 200 && status < 300, json: async () => ({ code: "x", product: { images: {} } }) });
function apiDeps(script) {
  const calls = [];
  const cacheMap = new Map();
  const stats = { apiCalls: 0, apiCached: 0 };
  const breaker = createBreaker();
  const getProduct = makeGetProduct({
    fetchImpl: async (url) => { calls.push(url); const s = script.shift(); if (s === undefined) throw new Error("gọi quá kịch bản"); if (s === "throw") throw new Error("net"); return jsonResp(s); },
    gap: async () => {}, breaker, sleep: async () => {}, cache: { get: (c) => cacheMap.get(c) ?? null, set: (c, j) => cacheMap.set(c, j) }, stats, maxCalls: 60,
  });
  return { calls, cacheMap, stats, breaker, getProduct };
}
const knownT = (x) => x != null && String(x).trim() !== "";

test("OFF API (NÊN SỬA 3): 429, 200, 429… KHÔNG mở cầu dao; 5 lần 429 liền thì mở và không gọi thêm", async () => {
  // xen kẽ: mỗi mã 429 rồi 200 (thử lại được) → thành công ghi record(200) nên chuỗi liên tiếp về 0
  const d = apiDeps([429, 200, 429, 200, 429, 200, 429, 200, 429, 200, 429, 200]);
  for (const c of ["11111111", "22222222", "33333333", "44444444", "55555555", "66666666"]) assert.equal((await d.getProduct(c)).kind, "ok", c);
  assert.equal(d.breaker.open, false, "lượt thành công đặt lại chuỗi");
  assert.equal(d.breaker.run, 0);
  assert.equal(d.calls.length, 12);
  assert.match(d.calls[0], /app_name=quet-ma-vach-lens/);
  // lượt từ cache không gọi mạng, không chạm cầu dao
  assert.equal((await d.getProduct("11111111")).kind, "ok");
  assert.equal(d.stats.apiCached, 1);
  assert.equal(d.calls.length, 12);
  // 5 lần 429 liền: mã 1 hết 4 lượt (RETRIES 3) → lỗi; mã 2 lượt 1 = lần thứ 5 → mở; mã 3 không gọi
  const e = apiDeps([429, 429, 429, 429, 429]);
  assert.deepEqual(await e.getProduct("11111111"), { kind: "loi", status: 429 });
  assert.deepEqual(await e.getProduct("22222222"), { kind: "cau-dao" });
  assert.equal(e.breaker.open, true);
  assert.deepEqual(await e.getProduct("33333333"), { kind: "cau-dao" });
  assert.equal(e.calls.length, 5, "cầu dao mở thì không gọi thêm lượt nào");
  // 404 → khong-co; 403 → loi không thử lại; trần lượt
  assert.deepEqual(await apiDeps([404]).getProduct("12345678"), { kind: "khong-co", status: 404 });
  const f = apiDeps([403]);
  assert.deepEqual(await f.getProduct("12345678"), { kind: "loi", status: 403 });
  assert.equal(f.calls.length, 1);
  const g = apiDeps([200]);
  g.stats.apiCalls = 60;
  assert.deepEqual(await g.getProduct("12345678"), { kind: "tran" });
  assert.equal(g.calls.length, 0);
});

test("chống ăn gian (NÊN SỬA 2): tải ảnh lỗi / cầu dao → 'chua-xong' (không LOẠI); complete false + incomplete", () => {
  const C = (key, imgid, distance, fetchFail) => ({ key, imgid, distance, fetchFail });
  assert.equal(antiCheatVerdict([C("front_vi.3", "8", 40)], "7", chooseSubstitute).status, "dung");
  const tl = antiCheatVerdict([C("front_vi.3", "8", null, "tai-loi")], "7", chooseSubstitute);
  assert.deepEqual([tl.status, tl.reason], ["chua-xong", "tải ảnh lỗi"]);
  const cd = antiCheatVerdict([C("front_vi.3", "8", null, "cau-dao")], "7", chooseSubstitute);
  assert.deepEqual([cd.status, cd.reason], ["chua-xong", "cầu dao mở"]);
  assert.equal(antiCheatVerdict([C("front_vi.3", "8", null, "tai-loi"), C("front_en.4", "9", 40)], "7", chooseSubstitute).status, "chua-xong", "ứng viên đứng trước tải lỗi → chưa biết luật chọn ai");
  assert.equal(antiCheatVerdict([C("front_en.4", "9", 40), C("front_vi.3", "8", null, "tai-loi")], "7", chooseSubstitute).status, "dung", "ứng viên lỗi đứng sau ảnh đã chọn → không ảnh hưởng");
  const lo = antiCheatVerdict([C("front_vi.3", "7", null), C("front_en.4", "9", 3)], "7", chooseSubstitute);
  assert.deepEqual([lo.status, lo.reason], ["loai", "cùng imgid; gần ảnh đo 3 bit (≤ 24)"]);
  assert.deepEqual(antiCheatVerdict([], "7", chooseSubstitute).reason, "OFF không có ảnh mặt trước");
  assert.deepEqual(antiCheatVerdict([], "7", chooseSubstitute, { productFound: false }).reason, "OFF không có sản phẩm");
  // mẫu sai (bản vòng 1): ảnh lỗi → distance null → chooseSubstitute thật trả "không có mã băm" (sẽ bị ghi LOẠI)
  assert.equal(chooseSubstitute([C("front_vi.3", "8", null)], "7").rejected[0].reason, "không có mã băm");
  const s = summarizeAntiCheat([
    { code: "1", status: "dung", chosen: "front_vi.3" }, { code: "2", status: "loai" }, { code: "3", status: "chua-xong", reason: "tải ảnh lỗi" },
  ], ["1", "2", "3", "4"]);
  assert.equal(s.complete, false);
  assert.deepEqual(s.incomplete, [{ code: "3", reason: "tải ảnh lỗi" }, { code: "4", reason: "chưa xét" }]);
  assert.deepEqual(s.excluded, ["2"], "chỉ LOẠI thật mới vào excluded");
  assert.deepEqual(s.override, { 1: "front_vi.3" });
  assert.equal(summarizeAntiCheat([{ code: "1", status: "dung", chosen: "k" }, { code: "2", status: "loai" }], ["1", "2"]).complete, true);
  assert.equal(summarizeAntiCheat([], []).complete, false);
  assert.equal(needsImage({ imgid: "8" }, "7", knownT), true);
  assert.equal(needsImage({ imgid: "7" }, "7", knownT), false);
  assert.equal(needsImage({ imgid: null }, "7", knownT), false);
  assert.equal(needsImage({ imgid: "8" }, null, knownT), false);
});

test("chỉ ghi ổ D (gợi ý 4)", () => {
  assert.equal(onDriveD("D:\\tmp\\lens", "d:/tmp/lens/anh"), true);
  assert.equal(onDriveD("D:\\tmp\\lens", "C:\\Users\\x"), false);
});

test("bộ P: imgid khóa danh mục theo bản xuất; giữ khóa danh mục / dùng indexImgid / bỏ cặp (LỆCH LUẬT 1 (i))", () => {
  const fronts = [{ key: "front_en", imgid: "35", rev: "177" }, { key: "front_fr", imgid: "24", rev: "115" }];
  assert.equal(catalogImgidOf(fronts, "front_en.177"), "35");
  assert.equal(catalogImgidOf(fronts, "front_en.178"), null, "rev khác → không biết imgid");
  assert.equal(catalogImgidOf(fronts, "front_vi.1"), null);
  assert.equal(catalogImgidOf(undefined, "front_en.177"), null);
  const opt = { okMin: 25, known: knownT };
  const base = { queryImgid: "24", catalogKey: "front_en.177", catalogImgid: "35", catalogDist: 28, indexImgid: "35", indexDist: 28 };
  assert.deepEqual(decidePIndex(base, opt).index, { key: "front_en.177", imgid: "35", source: "catalog", distance: 28 });
  const ov = decidePIndex({ ...base, catalogImgid: "24" }, opt);
  assert.deepEqual(ov.index, { key: "imgid:35", imgid: "35", source: "override", distance: 28 }, "khóa danh mục cùng imgid ảnh truy vấn → indexImgid");
  assert.match(ov.reasons[0], /cùng imgid ảnh truy vấn/);
  assert.equal(decidePIndex({ ...base, catalogImgid: null }, opt).index.source, "override", "không biết imgid khóa danh mục");
  assert.equal(decidePIndex({ ...base, catalogDist: 24 }, opt).index.source, "override", "khóa danh mục gần (≤ 24 bit)");
  assert.equal(decidePIndex({ ...base, catalogDist: 24, indexDist: 24 }, opt).index, null, "cả hai gần → bỏ cặp");
  assert.equal(decidePIndex({ ...base, catalogDist: null, indexDist: null }, opt).index, null);
  assert.equal(decidePIndex({ ...base, catalogKey: null, catalogImgid: null }, opt).index.source, "override");
  assert.equal(decidePIndex({ ...base, queryImgid: null }, opt).index, null);
  assert.equal(decidePIndex({ ...base, catalogImgid: "24", indexImgid: "24" }, opt).index, null, "indexImgid cùng ảnh truy vấn → bỏ");
});

test("đầu vào lens-vec (LỆCH LUẬT 2): mã bị loại VÀO chỉ mục với khóa danh mục + ẩn trên hàng ab-<mã>; override A / B mọi mức, bộ P chỉ mức a", () => {
  const rows = [
    { code: "1111111111111", img: "front_vi.3" }, { code: "2222222222222", img: "front_vi.4" }, { code: "3333333333333", img: "front_en.5" },
    { code: "4444444444444", img: "front_th.6" }, { code: "5555555555555", img: "" }, { code: "1111111111111", img: "front_vi.9" },
  ];
  const ac = {
    items: [
      { code: "1111111111111", chosen: "front_fr.7", candidates: [{ key: "front_fr.7", imgid: "12" }] },
      { code: "2222222222222", chosen: null, catalogImg: "front_vi.4", candidates: [{ key: "front_vi.4", imgid: "9", fromCatalog: true }] },
    ],
    excluded: ["2222222222222"], override: { "1111111111111": "front_fr.7" },
  };
  const bop = { items: [{ qid: "p-3333333333333", code: "3333333333333", query: { file: "D:\\q3.jpg", imgid: "1" }, index: { key: "imgid:4", imgid: "4", file: "D:\\i3.jpg" } }] };
  const files = { "1111111111111|front_fr.7": "D:\\a1.jpg", "3333333333333|imgid:4": "D:\\i3.jpg", "3333333333333|front_en.5": "D:\\c3.jpg", "2222222222222|front_vi.4": "D:\\a2.jpg" };
  const fileOf = (c, k) => files[`${c}|${k}`] ?? null;
  const qs = [{ qid: "ab-1111111111111", file: "D:\\f1.jpg" }, { qid: "ab-2222222222222", file: "D:\\f2.jpg" }];
  const v = buildVecInput({ level: "a", rows, fileOf, ac, bop, queries: qs });
  assert.deepEqual(v.index, [
    { code: "1111111111111", key: "front_fr.7", file: "D:\\a1.jpg" }, { code: "2222222222222", key: "front_vi.4", file: "D:\\a2.jpg" },
    { code: "3333333333333", key: "imgid:4", file: "D:\\i3.jpg" },
  ]);
  assert.deepEqual(v.hideByRow, { "ab-2222222222222": ["2222222222222"] }, "mã bị loại bị ẩn trên đúng hàng của nó");
  assert.deepEqual(v.indexImgid, { "1111111111111": "12", "2222222222222": "9", "3333333333333": "4" });
  assert.deepEqual(v.override, { "1111111111111": "front_fr.7", "3333333333333": "imgid:4" });
  assert.deepEqual(v.missing, [{ code: "4444444444444", key: "front_th.6" }]);
  assert.deepEqual(v.queries.map((q) => q.qid), ["ab-1111111111111", "ab-2222222222222", "p-3333333333333"]);
  // mức (b): override bộ P không áp (khóa danh mục), không có truy vấn P; override A / B vẫn áp; mã bị loại vẫn ẩn theo hàng
  const b = buildVecInput({ level: "b", rows, fileOf, ac, bop, queries: qs });
  assert.deepEqual(b.index.map((x) => `${x.code}|${x.key}`), ["1111111111111|front_fr.7", "2222222222222|front_vi.4", "3333333333333|front_en.5"]);
  assert.deepEqual(b.override, { "1111111111111": "front_fr.7" });
  assert.deepEqual(b.queries.map((q) => q.qid), ["ab-1111111111111", "ab-2222222222222"]);
  assert.equal(Object.hasOwn(b.indexImgid, "3333333333333"), false, "khóa danh mục khác khóa bộ P → không ghi imgid của ảnh bộ P");
  assert.deepEqual(b.hideByRow, v.hideByRow);
  assert.equal(IMGID_KEY_RE.exec("imgid:4")[1], "4");
  assert.throws(() => buildVecInput({ level: "a", rows, fileOf: () => "x", ac, bop: { items: [{ ...bop.items[0], code: "1111111111111", index: { key: "front_xx.1", imgid: "1" } }] }, queries: [] }), /mâu thuẫn/);
  assert.throws(() => buildVecInput({ rows, fileOf, ac, bop, queries: [] }), /mức lạ/, "phải nói rõ mức");
});

test("bộ P tải ảnh theo imgid CHỈ ghi vào D:\\tmp\\lens (gợi ý 4); đọc lại ảnh có sẵn ở thư mục đợt cũ", async () => {
  const p = imgidFilePlan("8935049501558", "1", { readDirs: ["D:\\tmp\\chup-mat-do\\chi-muc\\anh"], writeDir: "D:\\tmp\\lens\\anh-p" });
  assert.equal(p.write, "D:\\tmp\\lens\\anh-p\\8935049501558_1.400.jpg");
  assert.deepEqual(p.read, ["D:\\tmp\\chup-mat-do\\chi-muc\\anh\\8935049501558_1.400.jpg", "D:\\tmp\\lens\\anh-p\\8935049501558_1.400.jpg"]);
  assert.ok(!p.write.includes("chup-mat-do"));
  const src = (await import("node:fs")).readFileSync(new URL("../lens-tai.mjs", import.meta.url), "utf8");
  const bo = src.slice(src.indexOf("async function runBoP("), src.indexOf("function runVecInput("));
  assert.match(bo, /imgidFilePlan\(code, imgid, \{ readDirs: \[looAnh\], writeDir: pDir \}\)/);
  assert.match(bo, /const pDir = path\.join\(lensDir, "anh-p"\)/);
  assert.doesNotMatch(bo, /writeFileSync\(path\.join\(looAnh/, "không ghi vào thư mục chup-mat-do");
});
