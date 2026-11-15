// Test src/off-search.js (đợt tu-dong vòng 1): tìm theo chữ trên Open Food Facts (cgi/search.pl) từ trình duyệt.
// Máy chủ giả: node:http trên 127.0.0.1, cổng ngẫu nhiên; mỗi đường dẫn trả một kiểu (200 / 429 / 503 / 500 / chậm /
// JSON hỏng / thiếu products). Không gọi Open Food Facts thật. Đồng hồ (now) và fetch truyền vào được.
// Chạy: npm test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

// import lỗi (thiếu file / lỗi cú pháp) thì cả file đỏ, như tests/front-rank.test.js
const mod = await import("../src/off-search.js");
const offMod = await import("../src/off.js");
const PKG = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const PRODUCTS = [
  { code: "8934588752117", product_name: "Soda Chanh - Diet 7Up", product_name_en: "Soda Chanh - Diet 7Up", brands: "PepsiCo", countries_tags: [], image_front_small_url: "https://images.openfoodfacts.org/images/products/893/458/875/2117/front_en.7.200.jpg" },
  { code: "8934588022111", product_name: "7Up hương chanh", product_name_vi: "7Up hương chanh", brands: "7UP", countries_tags: ["en:vietnam"], image_front_small_url: "https://evil.example.com/x.jpg" },
  { code: "abc123", product_name: "Mã không phải số" },
  { code: "8934588023064", product_name: "", product_name_vi: "", brands: ["7up", "Pepsi"] },
];

// ---- máy chủ giả ----
let server;
let base;
const seen = []; // { path, query: URLSearchParams, headers }

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    seen.push({ path: u.pathname, query: u.searchParams, headers: req.headers });
    const json = (status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (u.pathname === "/ok") return json(200, { count: PRODUCTS.length, products: PRODUCTS });
    if (u.pathname === "/vn") return json(200, { count: 1, products: [PRODUCTS[1]] });
    if (u.pathname === "/empty") return json(200, { count: 0, products: [] });
    if (u.pathname === "/429") return json(429, { error: "too many" }, { "Retry-After": "60" });
    if (u.pathname === "/503") { res.writeHead(503, { "Content-Type": "text/html" }); return res.end("<html>503</html>"); }
    if (u.pathname === "/500") return json(500, { error: "x" });
    if (u.pathname === "/badjson") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{khong phai json"); }
    if (u.pathname === "/noproducts") return json(200, { count: 3 });
    if (u.pathname === "/slow") { const t = setTimeout(() => json(200, { products: PRODUCTS }), 1500); res.on("close", () => clearTimeout(t)); return; }
    json(404, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

/** fetch ghi lại (url, init) rồi gọi fetch thật. */
function spyFetch() {
  const calls = [];
  const f = (url, init) => { calls.push({ url: String(url), init }); return fetch(url, init); };
  f.calls = calls;
  return f;
}
/** Bộ nhớ kiểu localStorage trong RAM. */
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const okResponse = (products = PRODUCTS) => new Response(JSON.stringify({ products }), { status: 200, headers: { "Content-Type": "application/json" } });

describe("hằng số + URL", () => {
  test("hằng số: search.pl của world.openfoodfacts.org, hết giờ 6–8 giây, ≤ 10 lượt / phút", () => {
    assert.equal(mod.OFF_SEARCH_URL, "https://world.openfoodfacts.org/cgi/search.pl");
    assert.ok(mod.SEARCH_TIMEOUT_MS >= 6000 && mod.SEARCH_TIMEOUT_MS <= 8000);
    assert.equal(mod.SEARCH_LIMIT_PER_MIN, 10);
    assert.equal(mod.SEARCH_WINDOW_MS, 60000);
    assert.ok(mod.SEARCH_CACHE_TTL_MS > 0 && mod.SEARCH_CACHE_MAX > 0);
  });

  test("searchUrl: search_terms, json=1, app_name / app_version như src/off.js, không lọc thì không có tag", () => {
    const u = new URL(mod.searchUrl("7up soda chanh"));
    assert.equal(u.origin + u.pathname, "https://world.openfoodfacts.org/cgi/search.pl");
    assert.equal(u.searchParams.get("search_terms"), "7up soda chanh");
    assert.equal(u.searchParams.get("json"), "1");
    assert.equal(u.searchParams.get("app_name"), "quet-ma-vach-full");
    assert.equal(u.searchParams.get("app_version"), "0.1.0");
    assert.ok(u.searchParams.get("fields").split(",").includes("code"));
    assert.equal(u.searchParams.get("tag_0"), null);
  });

  test("vòng 2: page_size 24; fields có generic_name, generic_name_vi, generic_name_en; mặc định không lọc VN", () => {
    const u = new URL(mod.searchUrl("soda chanh"));
    assert.equal(u.searchParams.get("page_size"), "24");
    const f = u.searchParams.get("fields").split(",");
    for (const k of ["generic_name", "generic_name_vi", "generic_name_en", "countries_tags", "brands"]) assert.ok(f.includes(k), k);
    assert.equal(u.searchParams.get("tagtype_0"), null);
  });

  test("APP_NAME / APP_VERSION một nguồn: src/off.js export, khớp package.json; off-search dùng lại", () => {
    assert.equal(offMod.APP_NAME, "quet-ma-vach-full");
    assert.equal(offMod.APP_VERSION, PKG.version);
    const u = new URL(mod.searchUrl("soda"));
    assert.equal(u.searchParams.get("app_name"), offMod.APP_NAME);
    assert.equal(u.searchParams.get("app_version"), offMod.APP_VERSION);
    const src = fs.readFileSync(new URL("../src/off-search.js", import.meta.url), "utf8");
    assert.match(src, /import\s*\{[^}]*APP_NAME[^}]*\}\s*from\s*"\.\/off\.js"/);
    assert.doesNotMatch(src, /const APP_VERSION\s*=/, "không ghi cứng phiên bản lần 2");
  });

  test("searchUrl mã hóa ký tự đặc biệt & # % + trong câu tìm (không lọt tham số khác)", () => {
    const q = "a&b=c #d 50% e+f";
    const u = new URL(mod.searchUrl(q));
    assert.equal(u.searchParams.get("search_terms"), q);
    assert.equal(u.searchParams.get("b"), null);
    assert.equal(u.hash, "");
    assert.equal(u.searchParams.get("json"), "1");
  });

  test("searchUrl lọc Việt Nam: tagtype_0=countries, tag_0=en:vietnam; base đổi được (máy chủ giả)", () => {
    const u = new URL(mod.searchUrl("muoi", { vn: true, base: "http://127.0.0.1:1/ok" }));
    assert.equal(u.origin + u.pathname, "http://127.0.0.1:1/ok");
    assert.equal(u.searchParams.get("tagtype_0"), "countries");
    assert.equal(u.searchParams.get("tag_contains_0"), "contains");
    assert.equal(u.searchParams.get("tag_0"), "en:vietnam");
  });
});

describe("parseSearch", () => {
  test("→ { code, name, brand, img, vn }; bỏ mã không phải số; ảnh chỉ images.openfoodfacts.org", () => {
    const hits = mod.parseSearch({ products: PRODUCTS });
    assert.deepEqual(hits.map((h) => h.code), ["8934588752117", "8934588022111", "8934588023064"]);
    assert.equal(hits[0].name, "Soda Chanh - Diet 7Up");
    assert.equal(hits[0].brand, "PepsiCo");
    assert.match(hits[0].img, /^https:\/\/images\.openfoodfacts\.org\//);
    assert.equal(hits[0].vn, false);
    assert.equal(hits[1].name, "7Up hương chanh");
    assert.equal(hits[1].img, "", "ảnh khác tên miền bị bỏ");
    assert.equal(hits[1].vn, true);
    assert.equal(hits[2].brand, "7up, Pepsi");
  });

  test("text = tên các ngôn ngữ + hãng + tên chung (generic_name*), KHÔNG bỏ trùng (như docText), không quá HIT_TEXT_MAX", () => {
    // Vòng 3 ĐỔI KỲ VỌNG (code-reviewer vòng 2 mục 3): vòng 2 bỏ trùng ("Soda Chanh - Diet 7Up" 1 lần) nên chữ OFF ngắn
    // hơn tài liệu danh mục cùng nội dung → BM25 cộng điểm cho tên OFF ngắn. Nay dựng y như docText của danh mục.
    const [h] = mod.parseSearch({ products: [{
      code: "8934588752117", product_name: "Soda Chanh - Diet 7Up", product_name_en: "Soda Chanh - Diet 7Up", product_name_vi: "",
      brands: "PepsiCo", generic_name_vi: "Nước giải khát có ga", generic_name: 42, generic_name_en: "Soft drink",
    }] });
    assert.equal(h.text, "Soda Chanh - Diet 7Up Soda Chanh - Diet 7Up PepsiCo Nước giải khát có ga Soft drink");
    const [long] = mod.parseSearch({ products: [{ code: "12345678", product_name: "x".repeat(1000) }] });
    assert.equal(long.text.length, mod.HIT_TEXT_MAX);
  });

  test("vòng 3: chữ ứng viên OFF = tài liệu danh mục cùng nội dung (cùng bảng đếm từ + độ dài BM25)", async () => {
    const t1 = await import("../public/chup-mat-do/t1.mjs");
    const node = await import("../test-ocr/chup-mat-do/vn-data.mjs");
    const { offDoc } = await import("../src/front-merge.js");
    const fields = mod.SEARCH_FIELDS.split(",");
    const samples = [
      { code: "8934588022111", product_name: "7Up hương chanh", product_name_vi: "7Up hương chanh", brands: "7Up" },
      { code: "3250391232192", product_name: "Frites au four allumettes", product_name_fr: "Frites au four allumettes", product_name_en: "Oven fries", brands: "Saint Eloi", generic_name_fr: "Frites surgelées" },
      { code: "8934588752117", product_name: "Soda Chanh - Diet 7Up", product_name_en: "Soda Chanh - Diet 7Up", brands: "PepsiCo", generic_name_vi: "Nước giải khát có ga", generic_name_en: "Soft drink" },
      { code: "4000000000017", product_name: "Apfelsaft", product_name_de: "Apfelsaft", product_name_es: "Zumo de manzana", product_name_it: "Succo di mela", brands: "X, Y" },
    ];
    for (const p of samples) {
      for (const k of Object.keys(p)) if (/^(product|generic)_name/.test(k)) assert.ok(fields.includes(k), `SEARCH_FIELDS thiếu ${k}`);
      const [h] = mod.parseSearch({ products: [p] });
      const catDoc = t1.buildBm25([{ code: p.code, text: node.docText(node.vnRecord(p)) }]).tf[0];
      const od = offDoc(t1, h.text);
      assert.equal(od.len, catDoc.len, p.code);
      assert.deepEqual([...od.m.entries()].sort(), [...catDoc.m.entries()].sort(), p.code);
    }
  });

  test("trùng mã chỉ giữ lần đầu; thân sai dạng → null", () => {
    assert.equal(mod.parseSearch({ products: [PRODUCTS[0], PRODUCTS[0]] }).length, 1);
    assert.equal(mod.parseSearch(null), null);
    assert.equal(mod.parseSearch({ count: 1 }), null);
    assert.deepEqual(mod.parseSearch({ products: [] }), []);
  });
});

describe("createOffSearch với máy chủ giả", () => {
  test("200 → { ok: true, hits }; fetch không thêm header nào", async () => {
    const f = spyFetch();
    const s = mod.createOffSearch({ fetchImpl: f, base: `${base}/ok`, storage: null });
    const r = await s.search("7up soda chanh");
    assert.equal(r.ok, true);
    assert.equal(r.cached, false);
    assert.equal(r.hits[0].code, "8934588752117");
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init?.headers, undefined, "không thêm header");
    assert.ok(f.calls[0].init?.signal, "có AbortSignal (hết giờ)");
  });

  test("429 → rate; 503 (trang HTML) → server; 500 → server; có status", async () => {
    const s429 = await mod.createOffSearch({ base: `${base}/429`, storage: null }).search("a b");
    assert.deepEqual([s429.ok, s429.kind, s429.status], [false, "rate", 429]);
    const s503 = await mod.createOffSearch({ base: `${base}/503`, storage: null }).search("a b");
    assert.deepEqual([s503.ok, s503.kind, s503.status], [false, "server", 503]);
    const s500 = await mod.createOffSearch({ base: `${base}/500`, storage: null }).search("a b");
    assert.deepEqual([s500.ok, s500.kind], [false, "server"]);
  });

  test("JSON hỏng / thiếu products → badJson", async () => {
    const a = await mod.createOffSearch({ base: `${base}/badjson`, storage: null }).search("a b");
    assert.deepEqual([a.ok, a.kind], [false, "badJson"]);
    const b = await mod.createOffSearch({ base: `${base}/noproducts`, storage: null }).search("a b");
    assert.deepEqual([b.ok, b.kind], [false, "badJson"]);
  });

  test("hết giờ (máy chủ chậm hơn timeoutMs) → timeout", async () => {
    const r = await mod.createOffSearch({ base: `${base}/slow`, storage: null, timeoutMs: 100 }).search("a b");
    assert.deepEqual([r.ok, r.kind], [false, "timeout"]);
  });

  test("lỗi mạng (fetch ném TypeError / Promise bị từ chối, gồm 503 thiếu CORS trong trình duyệt) → network", async () => {
    const thrown = await mod.createOffSearch({ fetchImpl: () => { throw new TypeError("Load failed"); }, storage: null }).search("a b");
    assert.deepEqual([thrown.ok, thrown.kind], [false, "network"]);
    const rejected = await mod.createOffSearch({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); }, storage: null }).search("a b");
    assert.deepEqual([rejected.ok, rejected.kind], [false, "network"]);
  });

  test("fetchImpl trả thứ không phải Response (undefined, {}, status không phải số) → network, không ném", async () => {
    for (const bad of [undefined, null, {}, { status: "200", ok: true }]) {
      const r = await mod.createOffSearch({ fetchImpl: async () => bad, storage: null }).search("a b");
      assert.deepEqual([r.ok, r.kind], [false, "network"], JSON.stringify(bad));
    }
  });

  test("listener abort trên signal của người gọi được gỡ sau khi xong (thành công / lỗi)", async () => {
    const added = [];
    const removed = [];
    const signal = {
      aborted: false,
      addEventListener: (type, fn) => added.push([type, fn]),
      removeEventListener: (type, fn) => removed.push([type, fn]),
    };
    await mod.createOffSearch({ fetchImpl: async () => okResponse(), storage: null }).search("soda", { signal });
    await mod.createOffSearch({ fetchImpl: async () => new Response("x", { status: 503 }), storage: null }).search("soda", { signal });
    assert.equal(added.length, 2);
    assert.equal(removed.length, 2);
    assert.deepEqual(removed.map(([t, fn]) => [t, fn]), added.map(([t, fn]) => [t, fn]), "gỡ đúng hàm đã gắn");
  });

  test("signal của người gọi: hủy giữa chừng → aborted; đã hủy trước → aborted, không gọi mạng", async () => {
    const ac = new AbortController();
    const p = mod.createOffSearch({ base: `${base}/slow`, storage: null }).search("a b", { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const r = await p;
    assert.deepEqual([r.ok, r.kind], [false, "aborted"]);
    const f = spyFetch();
    const pre = new AbortController();
    pre.abort();
    const r2 = await mod.createOffSearch({ fetchImpl: f, base: `${base}/ok`, storage: null }).search("a b", { signal: pre.signal });
    assert.deepEqual([r2.ok, r2.kind], [false, "aborted"]);
    assert.equal(f.calls.length, 0);
  });

  test("không bao giờ ném: câu rỗng → { ok: true, hits: [] }, không gọi mạng", async () => {
    const f = spyFetch();
    const s = mod.createOffSearch({ fetchImpl: f, storage: null });
    assert.deepEqual(await s.search("   "), { ok: true, hits: [], cached: false });
    assert.equal(f.calls.length, 0);
  });
});

describe("giới hạn ≤ 10 lượt / phút cho cả app", () => {
  test("lượt 11 trong 60 giây → limited, không gọi mạng; qua 60 giây thì gọi lại được", async () => {
    let t = 1_000_000;
    let n = 0;
    const s = mod.createOffSearch({ fetchImpl: async () => { n++; return okResponse(); }, now: () => t, storage: null });
    for (let i = 0; i < 10; i++) {
      const r = await s.search(`cau ${i}`);
      assert.equal(r.ok, true, `lượt ${i + 1}`);
      t += 1000;
    }
    const r11 = await s.search("cau 11");
    assert.deepEqual([r11.ok, r11.kind], [false, "limited"]);
    assert.equal(n, 10);
    t += 60_000;
    const r12 = await s.search("cau 12");
    assert.equal(r12.ok, true);
    assert.equal(n, 11);
  });

  test("lượt lỗi (503 / mạng) và lượt bị hủy giữa chừng vẫn bị tính vào 10 lượt", async () => {
    let t = 5_000_000;
    let n = 0;
    const s = mod.createOffSearch({
      fetchImpl: async (u, init) => {
        n++;
        if (n % 3 === 0) throw new TypeError("Load failed");
        if (n % 3 === 1) return new Response("x", { status: 503 });
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      },
      now: () => t,
      storage: null,
    });
    for (let i = 0; i < 10; i++) {
      const ac = new AbortController();
      const p = s.search(`loi ${i}`, { signal: ac.signal });
      ac.abort();
      const r = await p;
      assert.equal(r.ok, false, `lượt ${i + 1}`);
    }
    assert.equal(n, 10);
    const r11 = await s.search("loi 11");
    assert.deepEqual([r11.ok, r11.kind], [false, "limited"]);
    assert.equal(n, 10, "không gọi mạng lần 11");
  });

  test("lượt lấy từ bộ nhớ đệm không tính vào giới hạn", async () => {
    let n = 0;
    const s = mod.createOffSearch({ fetchImpl: async () => { n++; return okResponse(); }, storage: null });
    for (let i = 0; i < 25; i++) assert.equal((await s.search("cung mot cau")).ok, true);
    assert.equal(n, 1);
  });
});

describe("bộ nhớ đệm (bộ nhớ + localStorage)", () => {
  test("cùng câu → cached, không gọi lại; lỗi không giữ", async () => {
    let n = 0;
    let fail = true;
    const s = mod.createOffSearch({ fetchImpl: async () => { n++; return fail ? new Response("x", { status: 503 }) : okResponse(); }, storage: null });
    assert.equal((await s.search("soda chanh")).kind, "server");
    fail = false;
    const a = await s.search("soda chanh");
    const b = await s.search("soda chanh");
    assert.deepEqual([a.ok, a.cached, b.ok, b.cached], [true, false, true, true]);
    assert.equal(n, 2);
  });

  test("lọc VN và không lọc là 2 khóa khác nhau", async () => {
    let n = 0;
    const s = mod.createOffSearch({ fetchImpl: async () => { n++; return okResponse(); }, storage: null });
    await s.search("soda", { vn: true });
    await s.search("soda", { vn: false });
    assert.equal(n, 2);
  });

  test("có hạn: quá SEARCH_CACHE_TTL_MS thì gọi lại", async () => {
    let t = 0;
    let n = 0;
    const s = mod.createOffSearch({ fetchImpl: async () => { n++; return okResponse(); }, now: () => t, storage: null });
    await s.search("soda");
    t += mod.SEARCH_CACHE_TTL_MS + 1;
    const r = await s.search("soda");
    assert.equal(r.cached, false);
    assert.equal(n, 2);
  });

  test("giới hạn số mục: giữ tối đa maxEntries, bỏ mục cũ nhất", async () => {
    let t = 0;
    let n = 0;
    const s = mod.createOffSearch({ fetchImpl: async () => { n++; return okResponse(); }, now: () => (t += 7000), storage: null, maxEntries: 3 });
    for (const q of ["a1", "a2", "a3", "a4"]) await s.search(q);
    assert.equal(n, 4);
    assert.equal((await s.search("a4")).cached, true);
    assert.equal((await s.search("a1")).cached, false, "a1 đã bị bỏ");
  });

  test("localStorage: phiên mới đọc lại được; chỉ lưu code / name / brand / img / vn", async () => {
    const storage = memStorage();
    let n = 0;
    const fetchImpl = async () => { n++; return okResponse(); };
    await mod.createOffSearch({ fetchImpl, storage }).search("soda chanh");
    const raw = storage.getItem(mod.SEARCH_CACHE_KEY);
    assert.ok(raw && raw.length < 5000);
    assert.ok(!raw.includes("countries_tags") && !raw.includes("evil.example.com"));
    const r = await mod.createOffSearch({ fetchImpl, storage }).search("soda chanh");
    assert.deepEqual([r.ok, r.cached, n], [true, true, 1]);
  });

  test("localStorage lỗi (getItem / setItem ném) hoặc dữ liệu hỏng → vẫn chạy, không ném", async () => {
    const bad = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
    const s = mod.createOffSearch({ fetchImpl: async () => okResponse(), storage: bad });
    assert.equal((await s.search("soda")).ok, true);
    assert.equal((await s.search("soda")).cached, true, "vẫn có bộ nhớ trong RAM");
    const junk = memStorage();
    junk.setItem(mod.SEARCH_CACHE_KEY, "{hong");
    assert.equal((await mod.createOffSearch({ fetchImpl: async () => okResponse(), storage: junk }).search("soda")).ok, true);
    const wrong = memStorage();
    wrong.setItem(mod.SEARCH_CACHE_KEY, JSON.stringify({ v: 2, e: [["all|24|soda", { t: Date.now(), hits: "khong phai mang" }]] }));
    const r = await mod.createOffSearch({ fetchImpl: async () => okResponse(), storage: wrong }).search("soda");
    assert.deepEqual([r.ok, r.cached], [true, false]);
  });

  test("localStorage: mỗi mục đọc lên lọc lại như parseSearch (mã 8–14 số, chuỗi, ảnh images.openfoodfacts.org, vn boolean)", async () => {
    const st = memStorage();
    const t = 1_000_000;
    st.setItem(mod.SEARCH_CACHE_KEY, JSON.stringify({ v: 2, e: [["all|24|soda", { t, hits: [
      { code: "8934588752117", name: 5, brand: { x: 1 }, img: "https://evil.example.com/a.jpg", vn: "yes" },
      { code: "abc123", name: "mã hỏng" },
      null,
      { code: "8934588022111", name: "7Up hương chanh", brand: "7UP", img: "https://images.openfoodfacts.org/images/x.jpg", vn: true },
      { code: "8934588022111", name: "trùng" },
    ] }]] }));
    let n = 0;
    const r = await mod.createOffSearch({ fetchImpl: async () => { n++; return okResponse(); }, storage: st, now: () => t + 1000 }).search("soda");
    assert.deepEqual([r.ok, r.cached, n], [true, true, 0]);
    assert.deepEqual(r.hits, [
      { code: "8934588752117", name: "", brand: "", img: "", vn: false, text: "" },
      { code: "8934588022111", name: "7Up hương chanh", brand: "7UP", img: "https://images.openfoodfacts.org/images/x.jpg", vn: true, text: "" },
    ]);
  });

  test("localStorage: mục có thời điểm ở tương lai (đồng hồ chỉnh lùi) coi là hỏng → gọi lại", async () => {
    const st = memStorage();
    const t = 1_000_000;
    st.setItem(mod.SEARCH_CACHE_KEY, JSON.stringify({ v: 2, e: [["all|24|soda", { t: t + 3_600_000, hits: [{ code: "8934588752117", name: "x", brand: "", img: "", vn: false }] }]] }));
    let n = 0;
    const r = await mod.createOffSearch({ fetchImpl: async () => { n++; return okResponse(); }, storage: st, now: () => t }).search("soda");
    assert.deepEqual([r.ok, r.cached, n], [true, false, 1]);
  });

  test("localStorage: mục quá hạn ở phiên mới → gọi lại", async () => {
    const st = memStorage();
    let t = 2_000_000;
    let n = 0;
    const fetchImpl = async () => { n++; return okResponse(); };
    await mod.createOffSearch({ fetchImpl, storage: st, now: () => t }).search("soda chanh");
    t += mod.SEARCH_CACHE_TTL_MS + 1;
    const r = await mod.createOffSearch({ fetchImpl, storage: st, now: () => t }).search("soda chanh");
    assert.deepEqual([r.ok, r.cached, n], [true, false, 2]);
  });

  test("vòng 3: dạng lưu v: 2, khóa có page_size; mục v: 1 cũ (dạng vòng 1, không có text) bị bỏ qua → gọi lại", async () => {
    const t = 3_000_000;
    const old = memStorage();
    old.setItem(mod.SEARCH_CACHE_KEY, JSON.stringify({ v: 1, e: [["all|soda", { t, hits: [{ code: "8934588752117", name: "x", brand: "", img: "", vn: false }] }]] }));
    let n = 0;
    const fetchImpl = async () => { n++; return okResponse(); };
    const r = await mod.createOffSearch({ fetchImpl, storage: old, now: () => t + 1000 }).search("soda");
    assert.deepEqual([r.ok, r.cached, n], [true, false, 1]);
    const saved = JSON.parse(old.getItem(mod.SEARCH_CACHE_KEY));
    assert.equal(saved.v, 2);
    assert.deepEqual(saved.e.map((x) => x[0]), [`all|${mod.SEARCH_PAGE_SIZE}|soda`]);
    // cỡ trang khác → khóa khác (không dùng lẫn)
    const r2 = await mod.createOffSearch({ fetchImpl, storage: old, now: () => t + 2000, pageSize: 10 }).search("soda");
    assert.deepEqual([r2.cached, n], [false, 2]);
    const r3 = await mod.createOffSearch({ fetchImpl, storage: old, now: () => t + 3000 }).search("soda");
    assert.deepEqual([r3.cached, n], [true, 2]);
  });
});

describe("searchVnThenAll: ưu tiên Việt Nam rồi không lọc (không loại hàng ngoại)", () => {
  test("gộp: kết quả lọc VN trước, rồi kết quả không lọc (bỏ trùng); 2 lượt", async () => {
    const urls = [];
    const s = mod.createOffSearch({ fetchImpl: async (u) => { urls.push(String(u)); return String(u).includes("tag_0=") ? okResponse([PRODUCTS[1]]) : okResponse(); }, storage: null });
    const r = await s.searchVnThenAll("7up soda chanh");
    assert.equal(r.ok, true);
    assert.deepEqual(r.hits.map((h) => h.code), ["8934588022111", "8934588752117", "8934588023064"]);
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes("tag_0=en%3Avietnam"));
  });

  test("lượt VN lỗi (503) vẫn trả kết quả không lọc; cả 2 lỗi → { ok: false, kind } của lượt sau", async () => {
    const s = mod.createOffSearch({ fetchImpl: async (u) => (String(u).includes("tag_0=") ? new Response("x", { status: 503 }) : okResponse()), storage: null });
    const r = await s.searchVnThenAll("soda");
    assert.equal(r.ok, true);
    assert.equal(r.hits[0].code, "8934588752117");
    const both = mod.createOffSearch({ fetchImpl: async () => new Response("x", { status: 429 }), storage: null });
    const r2 = await both.searchVnThenAll("soda");
    assert.deepEqual([r2.ok, r2.kind], [false, "rate"]);
  });
});

describe("cleanQuery: chữ OCR → tối đa 2 câu tìm, mỗi câu 2–3 từ", () => {
  // idf giả kiểu chỉ mục T1 (từ hiếm = idf cao); cũng là từ vựng danh mục
  const IDF = new Map(Object.entries({
    "7up": 6.4, up: 6.4, soda: 5.5, chanh: 4.2, diet: 5.8, calo: 3.9, coop: 6.5, select: 5.9, mui: 4.5, sea: 5.2, salt: 4.4,
    vissan: 7.1, lap: 6.2, xuong: 6.0, mai: 4.0, que: 5.1, khoi: 2.0, tinh: 1.5, ca: 1.2, phe: 3.0, sua: 1.1,
  }));
  const ok = (qs) => {
    assert.ok(Array.isArray(qs) && qs.length >= 1 && qs.length <= mod.QUERY_MAX, JSON.stringify(qs));
    for (const q of qs) {
      const n = q.split(" ").length;
      assert.ok(n <= mod.QUERY_WORDS_MAX, `câu dài: ${q}`);
      assert.ok(n >= mod.QUERY_WORDS_MIN || q.replace(/[^a-z]/g, "").length >= 5, `câu 1 từ ngắn: ${q}`);
      assert.match(q, /^[a-z0-9 ]+$/, `còn dấu / ký tự lạ: ${q}`);
    }
    assert.equal(new Set(qs).size, qs.length, "không trùng");
  };

  test("hằng số: tối đa 2 câu / ảnh (2 lượt tìm), mỗi câu 2–3 từ", () => {
    assert.equal(mod.QUERY_MAX, 2);
    assert.equal(mod.QUERY_WORDS_MIN, 2);
    assert.equal(mod.QUERY_WORDS_MAX, 3);
  });

  test("ca 7Up (chữ máy chủ đọc): có câu 'soda chanh'", () => {
    const qs = mod.cleanQuery(["Up", "Soda chanh", "Khong calo"], { idf: IDF });
    ok(qs);
    assert.ok(qs.includes("soda chanh"), JSON.stringify(qs));
  });

  test("ca 7Up gõ tay: '7 up' ghép thành '7up' khi '7up' có trong từ vựng danh mục", () => {
    const qs = mod.cleanQuery("Soda chanh diet 7 up", { idf: IDF });
    ok(qs);
    assert.ok(qs.some((q) => q.split(" ").includes("7up")), JSON.stringify(qs));
    assert.ok(qs.some((q) => q.includes("soda")), JSON.stringify(qs));
  });

  test("isVietSyllable: âm tiết tiếng Việt không dấu hợp lệ; rác OCR thì không", () => {
    for (const w of ["chanh", "nghieng", "khuyen", "huong", "truong", "khoai", "tay", "mui", "tinh", "que", "gia", "up", "oai", "nuoc", "khoang"]) {
      assert.equal(mod.isVietSyllable(w), true, w);
    }
    for (const w of ["lugng", "sog", "vibttef", "mewyork", "soda", "salt", "7up", "th", "", "chanhh", "xyz"]) {
      assert.equal(mod.isVietSyllable(w), false, w);
    }
  });

  test("chỉ giữ từ đáng tin (trong từ vựng hoặc âm tiết hợp lệ); xếp dòng theo tổng idf, không theo độ dài", () => {
    const qs = mod.cleanQuery(["VISSAN", "khoi lugng tinh sog vibttef", "Lạp xưởng Mai Quế"], { idf: IDF });
    ok(qs);
    const all = qs.join(" ").split(" ");
    for (const bad of ["lugng", "sog", "vibttef"]) assert.ok(!all.includes(bad), `còn rác '${bad}': ${JSON.stringify(qs)}`);
    assert.ok(!qs[0].split(" ").includes("khoi"), `câu 1 chọn dòng rác: ${JSON.stringify(qs)}`);
    assert.equal(qs[0], "lap xuong que", "dòng 4 từ → 3 từ hiếm nhất, giữ thứ tự");
    assert.ok(all.includes("vissan"), JSON.stringify(qs));
  });

  test("tối đa 2 câu dù nhiều dòng; dòng 1 từ được ghép với từ hiếm nhất của dòng khác", () => {
    const qs = mod.cleanQuery(["COOP", "Select", "Mui Bin Tinh Sấy l-t", "IODIZES REFINED SEA SALT"], { idf: IDF });
    ok(qs);
    assert.equal(qs.length, 2);
    for (const q of qs) assert.ok(q.split(" ").length >= 2, q);
    assert.deepEqual(mod.cleanQuery(["VISSAN", "Lạp xưởng"], { idf: IDF }), ["lap xuong", "vissan lap"]);
  });

  test("ghép số + từ chỉ khi từ ghép có trong từ vựng; không ghép '3 in', '24 lon', '2 túi'", () => {
    const vocab = new Set(["7up", "ca", "phe", "sua", "bia"]);
    for (const v of [undefined, vocab]) {
      const a = mod.cleanQuery("Cà phê sữa 3 in 1", { vocab: v }).join(" ").split(" ");
      assert.ok(!a.includes("3in"), JSON.stringify(a));
      const b = mod.cleanQuery(["Bia 24 lon"], { vocab: v }).join(" ").split(" ");
      assert.ok(!b.includes("24lon"), JSON.stringify(b));
      const c = mod.cleanQuery(["Bánh quy 2 túi"], { vocab: v }).join(" ").split(" ");
      assert.ok(!c.includes("2tui"), JSON.stringify(c));
    }
    const noVocab = mod.cleanQuery("Soda chanh diet 7 up").join(" ").split(" ");
    assert.ok(!noVocab.includes("7up"), "không có từ vựng thì không ghép");
  });

  test("từ toàn phụ âm (tên hãng 'TH') giữ khi có trong từ vựng, bỏ khi không", () => {
    const withV = mod.cleanQuery(["TH", "true MILK sữa tươi"], { vocab: new Set(["th", "true", "milk", "sua", "tuoi"]) }).join(" ").split(" ");
    assert.ok(withV.includes("th"), JSON.stringify(withV));
    const noV = mod.cleanQuery(["TH", "true MILK sữa tươi"]).join(" ").split(" ");
    assert.ok(!noV.includes("th"), JSON.stringify(noV));
  });

  test("không có câu chỉ 1 từ dưới 5 chữ cái (ca 'ca' khớp hàng nghìn sản phẩm)", () => {
    assert.deepEqual(mod.cleanQuery(["Cá"]), []);
    assert.deepEqual(mod.cleanQuery("7UP"), []);
    for (const input of [["Cá", "Ngon"], ["CA", "khoi lugng tinh sog"], ["Up", "Soda chanh", "Khong calo"]]) {
      for (const q of mod.cleanQuery(input)) {
        const w = q.split(" ");
        assert.ok(w.length > 1 || w[0].replace(/[^a-z]/g, "").length >= 5, `câu 1 từ ngắn: ${q}`);
      }
    }
  });

  test("ca muối Co.op: bỏ dấu, có thương hiệu 'coop' (vòng 3: đưa lại phép kiểm 'coop')", () => {
    // Vòng 2 phép kiểm "coop" bị thay bằng "mui" vì từ lạ ("bin", "say") lấy idf trung vị (gần idf lớn nhất) nên dòng
    // "Mui Bin Tinh Sấy" chiếm cả 2 câu; vòng 3 từ lạ không cộng điểm (UNKNOWN_IDF) nên "coop" trở lại.
    const qs = mod.cleanQuery(["COOP", "Select", "Mui Bin Tinh Sấy l-t", "IODIZES REFINED SEA SALT"], { idf: IDF });
    ok(qs);
    const all = qs.join(" ");
    assert.ok(all.split(" ").includes("coop") && !all.includes("sấy"), JSON.stringify(qs));
    assert.ok(!all.includes("iodizes") && !all.includes("refined"), "từ lạ không trong từ vựng, không phải âm tiết → bỏ");
  });

  test("vòng 3: từ không có trong từ vựng (âm tiết hợp lệ) không cộng điểm khi xếp dòng / chọn từ", () => {
    assert.equal(mod.UNKNOWN_IDF, 0);
    // dòng 4 âm tiết lạ không được đứng trước dòng có từ danh mục chỉ vì dài
    const qs = mod.cleanQuery(["bin tinh ba bon", "Soda chanh"], { idf: IDF });
    assert.equal(qs[0], "soda chanh", JSON.stringify(qs));
    // trong một dòng: từ danh mục được chọn trước từ lạ
    assert.equal(mod.cleanQuery(["bin ba soda chanh bon"], { idf: IDF })[0], "bin soda chanh", "2 từ danh mục + 1 từ lạ đứng đầu dòng");
    // không có chỉ mục (không truyền idf): như cũ, mỗi từ 1 điểm (dòng nhiều từ trước)
    assert.equal(mod.cleanQuery(["Ngon", "bin tinh ba"])[0], "bin tinh ba");
  });

  test("bỏ dòng số liệu / khối lượng / nhiễu", () => {
    const qs = mod.cleanQuery(["Năng lượng 150 kcal", "Khối lượng tịnh: 500g", "12,5%", "NSX 01/2026", "VISSAN", "Lạp xưởng Mai Quế"], { idf: IDF });
    ok(qs);
    const all = qs.join(" ");
    for (const bad of ["kcal", "500g", "500", "150", "luong", "nsx", "2026"]) assert.ok(!all.split(" ").includes(bad), `còn '${bad}': ${JSON.stringify(qs)}`);
    assert.ok(all.includes("lap xuong que"), JSON.stringify(qs));
    assert.ok(all.includes("vissan"), JSON.stringify(qs));
  });

  // Vòng 6 (P2): từ lạ = từ Latin ≥ 5 chữ cái, không dấu, không có trong từ vựng, không phải âm tiết tiếng Việt;
  // tối đa 2 từ / ảnh (dài nhất trước, hòa theo thứ tự dòng).
  test("strangeWords: ca muối → iodizes, refined; bỏ từ trong từ vựng, âm tiết, < 5 chữ, có dấu, có số; tối đa 2", () => {
    assert.equal(mod.STRANGE_MAX, 2);
    assert.deepEqual(mod.strangeWords(["COOP", "Select", "Mui Bin Tinh Sấy l-t", "IODIZES REFINED SEA SALT"], { idf: IDF }), ["iodizes", "refined"]);
    assert.deepEqual(mod.strangeWords(["Haribo Goldbears", "Fruchtgummi"], { idf: IDF }), ["fruchtgummi", "goldbears"]);
    assert.deepEqual(mod.strangeWords(["Soda chanh diet 7 up"], { idf: IDF }), []);
    assert.deepEqual(mod.strangeWords(["Up", "Soda chanh", "Khong calo"], { idf: IDF }), []);
    assert.deepEqual(mod.strangeWords(["Bánh Crème Brûlée", "abc12de", "nghieng khuyen"], { idf: IDF }), []);
    // cụm chung / từ nhiễu bị bỏ như cleanQuery ("made in", "vietnam", "net weight", "grams")
    assert.deepEqual(mod.strangeWords(["Made in Vietnam", "Net weight 500 grams"], { idf: IDF }), []);
    assert.deepEqual(mod.strangeWords(["Charl", "Alpha Bravo"], { idf: IDF }), ["charl", "alpha"], "hòa độ dài: theo thứ tự dòng");
    assert.deepEqual(mod.strangeWords(null), []);
  });

  test("cleanQuery strange: mặc định STRANGE_MODE (null = tắt) như cũ; x1 thêm từ lạ vào câu 1; x2 từ lạ thành câu riêng thay câu 2", () => {
    assert.equal(mod.STRANGE_MODE, null);
    const salt = ["COOP", "Select", "Mui Bin Tinh Sấy l-t", "IODIZES REFINED SEA SALT"];
    const base = mod.cleanQuery(salt, { idf: IDF });
    assert.deepEqual(mod.cleanQuery(salt, { idf: IDF, strange: null }), base);
    const x1 = mod.cleanQuery(salt, { idf: IDF, strange: "x1" });
    assert.equal(x1.length, base.length);
    assert.equal(x1[0], `${base[0]} iodizes refined`);
    assert.equal(x1[1], base[1]);
    const x2 = mod.cleanQuery(salt, { idf: IDF, strange: "x2" });
    assert.deepEqual(x2, [base[0], "iodizes refined"]);
    // không có từ lạ → x1 / x2 giống hệt mặc định (ca 7Up)
    for (const input of [["Up", "Soda chanh", "Khong calo"], "Soda chanh diet 7 up"]) {
      for (const strange of ["x1", "x2"]) assert.deepEqual(mod.cleanQuery(input, { idf: IDF, strange }), mod.cleanQuery(input, { idf: IDF }));
    }
    // chỉ có từ lạ (không từ đáng tin) → x1 / x2 vẫn có câu từ lạ
    assert.deepEqual(mod.cleanQuery(["Haribo Goldbears"], { idf: IDF, strange: "x1" }), ["goldbears haribo"]);
    assert.deepEqual(mod.cleanQuery(["Haribo Goldbears"], { idf: IDF, strange: "x2" }), ["goldbears haribo"]);
    assert.ok(mod.cleanQuery(salt, { idf: IDF, strange: "x1" }).every((q) => q.length <= mod.QUERY_CHARS_MAX));
    assert.throws(() => mod.cleanQuery(salt, { idf: IDF, strange: "x3" }), /strange/);
  });

  test("nhận cả mảng { text }; rỗng / toàn số → []", () => {
    assert.deepEqual(mod.cleanQuery([{ text: "Soda chanh" }], { idf: IDF }), ["soda chanh"]);
    assert.deepEqual(mod.cleanQuery([]), []);
    assert.deepEqual(mod.cleanQuery(""), []);
    assert.deepEqual(mod.cleanQuery(["123", "45 g", "%"]), []);
    assert.deepEqual(mod.cleanQuery(null), []);
  });
});
