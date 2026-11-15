// Test src/off-search.js (đợt tu-dong vòng 1): tìm theo chữ trên Open Food Facts (cgi/search.pl) từ trình duyệt.
// Máy chủ giả: node:http trên 127.0.0.1, cổng ngẫu nhiên; mỗi đường dẫn trả một kiểu (200 / 429 / 503 / 500 / chậm /
// JSON hỏng / thiếu products). Không gọi Open Food Facts thật. Đồng hồ (now) và fetch truyền vào được.
// Chạy: npm test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// import động + catch: chưa có module thì từng test đỏ riêng (thử đỏ / xanh), không phải lỗi cả file
const mod = await import("../src/off-search.js").catch(() => ({}));

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

  test("lỗi mạng (cổng đóng / fetch ném TypeError, gồm 503 thiếu CORS trong trình duyệt) → network", async () => {
    const closed = await mod.createOffSearch({ base: "http://127.0.0.1:1/x", storage: null }).search("a b");
    assert.deepEqual([closed.ok, closed.kind], [false, "network"]);
    const thrown = await mod.createOffSearch({ fetchImpl: () => { throw new TypeError("Load failed"); }, storage: null }).search("a b");
    assert.deepEqual([thrown.ok, thrown.kind], [false, "network"]);
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
    wrong.setItem(mod.SEARCH_CACHE_KEY, JSON.stringify({ v: 1, e: [["all|soda", { t: Date.now(), hits: "khong phai mang" }]] }));
    const r = await mod.createOffSearch({ fetchImpl: async () => okResponse(), storage: wrong }).search("soda");
    assert.deepEqual([r.ok, r.cached], [true, false]);
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

describe("cleanQuery: chữ OCR → 1–3 câu tìm ngắn", () => {
  const ok = (qs) => {
    assert.ok(Array.isArray(qs) && qs.length >= 1 && qs.length <= 3, JSON.stringify(qs));
    for (const q of qs) {
      assert.ok(q.split(" ").length <= 5, `câu dài: ${q}`);
      assert.match(q, /^[a-z0-9 ]+$/, `còn dấu / ký tự lạ: ${q}`);
    }
    assert.equal(new Set(qs).size, qs.length, "không trùng");
  };

  test("ca 7Up (chữ máy chủ đọc): có câu 'soda chanh'", () => {
    const qs = mod.cleanQuery(["Up", "Soda chanh", "Khong calo"]);
    ok(qs);
    assert.ok(qs.includes("soda chanh"), JSON.stringify(qs));
  });

  test("ca 7Up gõ tay: '7 up' ghép thành '7up', giữ từ ngắn", () => {
    const qs = mod.cleanQuery("Soda chanh diet 7 up");
    ok(qs);
    assert.ok(qs[0].includes("7up") && qs[0].includes("soda chanh"), JSON.stringify(qs));
    assert.deepEqual(mod.cleanQuery("7UP"), ["7up"]);
  });

  test("ca muối Co.op: bỏ dấu, có từ của tên + thương hiệu", () => {
    const qs = mod.cleanQuery(["COOP", "Select", "Mui Bin Tinh Sấy l-t", "IODIZES REFINED SEA SALT"]);
    ok(qs);
    const all = qs.join(" ");
    assert.ok(all.includes("coop"), JSON.stringify(qs));
    assert.ok(all.includes("say") && !all.includes("sấy"), JSON.stringify(qs));
  });

  test("bỏ dòng số liệu / khối lượng / nhiễu", () => {
    const qs = mod.cleanQuery(["Năng lượng 150 kcal", "Khối lượng tịnh: 500g", "12,5%", "NSX 01/2026", "VISSAN", "Lạp xưởng Mai Quế"]);
    ok(qs);
    const all = qs.join(" ");
    for (const bad of ["kcal", "500g", "500", "150", "luong", "nsx", "2026"]) assert.ok(!all.split(" ").includes(bad), `còn '${bad}': ${JSON.stringify(qs)}`);
    assert.ok(all.includes("lap xuong mai que"), JSON.stringify(qs));
    assert.ok(all.includes("vissan"), JSON.stringify(qs));
  });

  test("nhận cả mảng { text }; rỗng / toàn số → []", () => {
    assert.deepEqual(mod.cleanQuery([{ text: "Soda chanh" }]), ["soda chanh"]);
    assert.deepEqual(mod.cleanQuery([]), []);
    assert.deepEqual(mod.cleanQuery(""), []);
    assert.deepEqual(mod.cleanQuery(["123", "45 g", "%"]), []);
    assert.deepEqual(mod.cleanQuery(null), []);
  });
});
