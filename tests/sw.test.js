// Test service worker (tools/sw-build.mjs): chọn đường đi của request, ghép mã sw.js, mã phiên bản.
// Không cần trình duyệt: chạy mã sw.js trong node:vm với self / caches / fetch giả.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { routeFor, buildServiceWorker, versionOf } from "../tools/sw-build.mjs";
import * as swBuild from "../tools/sw-build.mjs"; // precacheList (thêm ở sua-cuoi): gọi qua swBuild để file vẫn chạy khi hàm chưa có

const SCOPE = "https://khangnguyen196.github.io/quet-ma-vach-full/";
const OFF_API = "https://world.openfoodfacts.org/api/v2/product/8934563163150.json?fields=product_name&app_name=quet-ma-vach-full&app_version=0.1.0";
const FILES = ["./", "./assets/index-abc.css", "./assets/index-abc.js", "./icons/icon-192.png", "./index.html", "./manifest.webmanifest"];

describe("routeFor", () => {
  test("khác tên miền → skip (Open Food Facts, ảnh sản phẩm, Google Fonts), kể cả khi mở trang", () => {
    for (const url of [
      OFF_API,
      "https://images.openfoodfacts.org/images/products/893/456/316/3150/front_vi.3.400.jpg",
      "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;900&display=swap",
      "https://fonts.gstatic.com/s/archivo/v19/abc.woff2"
    ]) {
      for (const mode of ["cors", "no-cors", "navigate"]) assert.equal(routeFor(url, SCOPE, mode), "skip", url + " " + mode);
    }
  });

  test("ngoài phạm vi → skip", () => {
    assert.equal(routeFor("https://khangnguyen196.github.io/repo-khac/assets/index-abc.js", SCOPE, "cors"), "skip");
    assert.equal(routeFor("https://khangnguyen196.github.io/quet-ma-vach-full", SCOPE, "navigate"), "skip");
    assert.equal(routeFor("http://khangnguyen196.github.io/quet-ma-vach-full/assets/a.js", SCOPE, "cors"), "skip");
  });

  test("mở trang trong phạm vi → navigate", () => {
    assert.equal(routeFor(SCOPE, SCOPE, "navigate"), "navigate");
    assert.equal(routeFor(SCOPE + "index.html?x=1", SCOPE, "navigate"), "navigate");
  });

  test("file trong assets/ → asset; sw.js, index.html (không phải mở trang) → skip", () => {
    assert.equal(routeFor(SCOPE + "assets/index-abc.js", SCOPE, "cors"), "asset");
    assert.equal(routeFor(SCOPE + "assets/index-abc.css", SCOPE, "no-cors"), "asset");
    for (const p of ["sw.js", "index.html", "assetsx/a.js"]) {
      assert.equal(routeFor(SCOPE + p, SCOPE, "cors"), "skip", p);
    }
  });

  test("manifest.webmanifest + icons/ → asset (lấy từ cache trước, không có thì mạng) (sua-cuoi, hoan-thien (d))", () => {
    for (const p of ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon-180.png"]) {
      for (const mode of ["cors", "no-cors"]) assert.equal(routeFor(SCOPE + p, SCOPE, mode), "asset", p + " " + mode);
    }
    // giống tên nhưng không phải: vẫn skip
    for (const p of ["manifest.webmanifest.bak", "iconsx/a.png", "icons", "x/manifest.webmanifest"]) {
      assert.equal(routeFor(SCOPE + p, SCOPE, "cors"), "skip", p);
    }
    // tên miền khác / ngoài phạm vi: vẫn skip
    assert.equal(routeFor("https://example.com/quet-ma-vach-full/manifest.webmanifest", SCOPE, "cors"), "skip");
    assert.equal(routeFor("https://khangnguyen196.github.io/repo-khac/icons/icon-192.png", SCOPE, "cors"), "skip");
  });

  test("địa chỉ hỏng → skip", () => {
    assert.equal(routeFor("không phải url", SCOPE, "cors"), "skip");
    assert.equal(routeFor(SCOPE + "assets/a.js", "", "cors"), "skip");
  });
});

describe("versionOf", () => {
  const files = [{ name: "index.html", content: "<html>1</html>" }, { name: "assets/a.js", content: Buffer.from("a") }];

  test("đổi nội dung 1 file → mã đổi; chỉ đổi thứ tự → mã giữ", () => {
    const v = versionOf(files);
    assert.match(v, /^[0-9a-f]{12}$/);
    assert.equal(versionOf([...files].reverse()), v);
    assert.notEqual(versionOf([files[0], { name: "assets/a.js", content: Buffer.from("b") }]), v);
    assert.notEqual(versionOf([files[0]]), v);
  });
});

/** Chạy mã sw.js trong vm với môi trường service worker giả; trả các listener + sổ ghi lời gọi. */
function loadSw(code, { cacheNames = [], fetchImpl, timers = [] } = {}) {
  const listeners = {};
  const log = { opened: [], put: [], fetched: [], deleted: [], skipWaiting: 0, claim: 0, matched: [] };
  const stores = new Map(cacheNames.map((n) => [n, new Map()]));
  const keyOf = (req) => (typeof req === "string" ? req : req.url);
  // Như trình duyệt: địa chỉ tương đối ("./index.html") được đổi ra địa chỉ đầy đủ theo phạm vi của service worker.
  const absKey = (req) => new URL(keyOf(req), SCOPE).href;
  const stripSearch = (url) => { const u = new URL(url); u.search = ""; return u.href; };
  const caches = {
    async open(name) {
      log.opened.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return { async put(req, res) { log.put.push(keyOf(req)); store.set(absKey(req), res); } };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { log.deleted.push(name); return stores.delete(name); },
    async match(req, opts = {}) {
      log.matched.push({ key: keyOf(req), opts: { ...opts } }); // chép sang object ngoài vm để deepEqual so được
      const store = stores.get(opts.cacheName);
      if (!store) return undefined;
      const key = absKey(req);
      if (!opts.ignoreSearch) return store.get(key);
      for (const [k, v] of store) if (stripSearch(k) === stripSearch(key)) return v;
      return undefined;
    }
  };
  class FakeRequest {
    constructor(url, init = {}) { this.url = url; this.cache = init.cache; }
  }
  const context = {
    URL,
    Request: FakeRequest,
    Response: { error: () => ({ type: "error" }) },
    caches,
    // Đồng hồ giả: chỉ ghi lại, test tự gọi fn() khi muốn "hết giờ".
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fetch: fetchImpl || (async (req, init) => {
      log.fetched.push({ url: keyOf(req), cache: init?.cache ?? req.cache });
      return { ok: true, status: 200, body: "mạng:" + keyOf(req) };
    }),
    self: {
      registration: { scope: SCOPE },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: async () => { log.skipWaiting++; },
      clients: { claim: async () => { log.claim++; } }
    }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { listeners, log, stores, context };
}

/** Phát 1 sự kiện fetch giả; trả lời respondWith (undefined nếu service worker không trả lời). */
function dispatchFetch(listeners, request) {
  let responded;
  listeners.fetch({ request, respondWith(p) { responded = p; } });
  return responded;
}

describe("buildServiceWorker", () => {
  const code = buildServiceWorker({ version: "v1abc", files: FILES });

  test("chuỗi có đúng version, đủ danh sách file, tên cache qmv-shell-, không nhắc Open Food Facts", () => {
    assert.ok(code.includes('const VERSION = "v1abc";'));
    assert.ok(code.includes('"qmv-shell-" + VERSION'));
    for (const f of FILES) assert.ok(code.includes(JSON.stringify(f)), f);
    assert.ok(!code.toLowerCase().includes("openfoodfacts"));
    assert.ok(code.includes(routeFor.toString()), "routeFor chép nguyên văn từ tools/sw-build.mjs");
  });

  test("routeFor trong sw.js cho cùng kết quả với bản export", () => {
    const { context } = loadSw(code);
    for (const [url, mode] of [[OFF_API, "cors"], [SCOPE, "navigate"], [SCOPE + "assets/a.js", "cors"], [SCOPE + "sw.js", "cors"]]) {
      assert.equal(context.routeFor(url, SCOPE, mode), routeFor(url, SCOPE, mode));
    }
  });

  test("install: mở cache qmv-shell-<version>, nạp đúng danh sách bằng cache: reload, rồi skipWaiting", async () => {
    const { listeners, log } = loadSw(code);
    let done;
    listeners.install({ waitUntil(p) { done = p; } });
    await done;
    assert.deepEqual(log.opened, ["qmv-shell-v1abc"]);
    assert.deepEqual(log.put, FILES);
    assert.deepEqual(log.fetched, FILES.map((url) => ({ url, cache: "reload" })));
    assert.equal(log.skipWaiting, 1);
  });

  test("install: 1 file lỗi HTTP → cài thất bại, không skipWaiting", async () => {
    const { listeners, log } = loadSw(code, { fetchImpl: async (req) => ({ ok: !req.url.endsWith(".css"), status: 404 }) });
    let done;
    listeners.install({ waitUntil(p) { done = p; } });
    await assert.rejects(done);
    assert.equal(log.skipWaiting, 0);
  });

  test("activate: xóa qmv-shell- của bản cũ, giữ bản hiện tại và cache tên khác, rồi clients.claim", async () => {
    const { listeners, log, stores } = loadSw(code, { cacheNames: ["qmv-shell-cu", "cache-khac", "qmv-shell-v1abc"] });
    let done;
    listeners.activate({ waitUntil(p) { done = p; } });
    await done;
    assert.deepEqual(log.deleted, ["qmv-shell-cu"]);
    assert.deepEqual([...stores.keys()], ["cache-khac", "qmv-shell-v1abc"]);
    assert.equal(log.claim, 1);
  });

  test("fetch: request khác tên miền (Open Food Facts, Google Fonts) và request không phải GET → không respondWith", () => {
    const { listeners, log } = loadSw(code);
    for (const url of [OFF_API, "https://fonts.googleapis.com/css2?family=Archivo", "https://images.openfoodfacts.org/x.jpg"]) {
      assert.equal(dispatchFetch(listeners, { method: "GET", url, mode: "cors" }), undefined, url);
    }
    assert.equal(dispatchFetch(listeners, { method: "POST", url: SCOPE + "assets/a.js", mode: "cors" }), undefined);
    assert.deepEqual(log.fetched, []);
    assert.deepEqual(log.matched, []);
  });

  test("fetch: file assets lấy từ cache trước, không có thì mạng (không ghi thêm vào cache)", async () => {
    const { listeners, log, stores } = loadSw(code, { cacheNames: ["qmv-shell-v1abc"] });
    stores.get("qmv-shell-v1abc").set(SCOPE + "assets/a.js", "đã lưu");
    assert.equal(await dispatchFetch(listeners, { method: "GET", url: SCOPE + "assets/a.js", mode: "cors" }), "đã lưu");
    const res = await dispatchFetch(listeners, { method: "GET", url: SCOPE + "assets/b.js", mode: "cors" });
    assert.equal(res.body, "mạng:" + SCOPE + "assets/b.js");
    assert.deepEqual(log.put, []);
  });

  test("fetch: mở trang → mạng trước với cache: no-cache; mất mạng → index.html đã lưu", async () => {
    const online = loadSw(code);
    const res = await dispatchFetch(online.listeners, { method: "GET", url: SCOPE, mode: "navigate" });
    assert.equal(res.body, "mạng:" + SCOPE);
    assert.deepEqual(online.log.fetched, [{ url: SCOPE, cache: "no-cache" }]);

    const offline = loadSw(code, { cacheNames: ["qmv-shell-v1abc"], fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    offline.stores.get("qmv-shell-v1abc").set(SCOPE + "index.html", "giao diện đã lưu");
    assert.equal(await dispatchFetch(offline.listeners, { method: "GET", url: SCOPE + "?a=1", mode: "navigate" }), "giao diện đã lưu");
    assert.deepEqual(offline.log.matched, [{ key: "./index.html", opts: { cacheName: "qmv-shell-v1abc", ignoreSearch: true } }]);
  });
});

/** Promise điều khiển được từ ngoài: d.resolve(v) / d.reject(e). */
function deferred() {
  const d = {};
  d.promise = new Promise((res, rej) => { d.resolve = res; d.reject = rej; });
  return d;
}
/** Promise đã xong chưa (sau vài vòng hàng đợi); trả { done, value }. */
async function peek(p) {
  const state = { done: false, value: undefined };
  p.then((v) => { state.done = true; state.value = v; }, (e) => { state.done = true; state.value = e; });
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return state;
}

describe("mở trang khi mạng chậm: chờ tối đa 3 giây rồi dùng bản đã lưu (sua-cuoi, hoan-thien (c))", () => {
  const code = buildServiceWorker({ version: "v1abc", files: FILES });
  const NAV = { method: "GET", url: SCOPE, mode: "navigate" };

  function slowSw({ withCache }) {
    const net = deferred();
    const fetched = [];
    const timers = [];
    const sw = loadSw(code, {
      cacheNames: ["qmv-shell-v1abc"], timers,
      fetchImpl: (req, init) => { fetched.push({ url: req.url ?? req, init, signal: init?.signal }); return net.promise; }
    });
    if (withCache) sw.stores.get("qmv-shell-v1abc").set(SCOPE + "index.html", "giao diện đã lưu");
    return { ...sw, net, fetched, timers };
  }

  test("sw.js có hằng NAV_TIMEOUT_MS = 3000 và hẹn giờ đúng 3000 ms khi mở trang", async () => {
    assert.ok(code.includes("const NAV_TIMEOUT_MS = 3000;"));
    const { listeners, timers } = slowSw({ withCache: true });
    dispatchFetch(listeners, NAV);
    await peek(Promise.resolve());
    assert.deepEqual(timers.map((t) => t.ms), [3000]);
  });

  test("3 giây chưa có phản hồi + có bản lưu → trả bản lưu; request mạng không bị hủy, không ghi cache", async () => {
    const { listeners, timers, net, fetched, log } = slowSw({ withCache: true });
    const res = dispatchFetch(listeners, NAV);
    assert.equal((await peek(res)).done, false, "chưa hết giờ thì còn chờ mạng");
    timers[0].fn();
    const got = await peek(res);
    assert.equal(got.done, true);
    assert.equal(got.value, "giao diện đã lưu");
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0].signal, undefined, "không gắn AbortSignal: request mạng chạy tiếp");
    net.resolve({ ok: true, status: 200, body: "mạng muộn" });
    await peek(Promise.resolve());
    assert.deepEqual(log.put, []);
  });

  test("3 giây chưa có phản hồi + KHÔNG có bản lưu → chờ mạng tiếp, ra bản mạng", async () => {
    const { listeners, timers, net } = slowSw({ withCache: false });
    const res = dispatchFetch(listeners, NAV);
    timers[0].fn();
    assert.equal((await peek(res)).done, false);
    net.resolve({ ok: true, status: 200, body: "mạng chậm" });
    const got = await peek(res);
    assert.equal(got.value.body, "mạng chậm");
  });

  test("mạng trả trước 3 giây → bản mạng, hẹn giờ được hủy", async () => {
    const { listeners, timers, net } = slowSw({ withCache: true });
    const res = dispatchFetch(listeners, NAV);
    net.resolve({ ok: true, status: 200, body: "mạng nhanh" });
    const got = await peek(res);
    assert.equal(got.value.body, "mạng nhanh");
    assert.equal(timers[0].cleared, true);
  });

  test("hết giờ mà không có bản lưu, rồi mạng lỗi → Response.error() (không treo)", async () => {
    const { listeners, timers, net } = slowSw({ withCache: false });
    const res = dispatchFetch(listeners, NAV);
    timers[0].fn();
    net.reject(new TypeError("Failed to fetch"));
    const got = await peek(res);
    assert.deepEqual(got.value, { type: "error" });
  });

  test("đã trả bản lưu rồi mạng mới lỗi → không có lỗi lọt ra ngoài (unhandled rejection)", async () => {
    const { listeners, timers, net } = slowSw({ withCache: true });
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const res = dispatchFetch(listeners, NAV);
      timers[0].fn();
      assert.equal((await peek(res)).value, "giao diện đã lưu");
      net.reject(new TypeError("Failed to fetch"));
      await peek(Promise.resolve());
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    assert.deepEqual(unhandled, []);
  });
});

describe("cache giả giống trình duyệt: khóa là địa chỉ đầy đủ theo phạm vi (sua-cuoi, hoan-thien (g))", () => {
  const code = buildServiceWorker({ version: "v1abc", files: FILES });

  test("index.html lưu dưới địa chỉ đầy đủ (như trình duyệt thật) → mất mạng vẫn trả bản đã lưu", async () => {
    const offline = loadSw(code, { cacheNames: ["qmv-shell-v1abc"], fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    offline.stores.get("qmv-shell-v1abc").set(SCOPE + "index.html", "giao diện đã lưu (địa chỉ đầy đủ)");
    assert.equal(await dispatchFetch(offline.listeners, { method: "GET", url: SCOPE + "?a=1", mode: "navigate" }), "giao diện đã lưu (địa chỉ đầy đủ)");
  });

  test("install lưu './index.html' thành địa chỉ đầy đủ theo phạm vi", async () => {
    const { listeners, stores } = loadSw(code);
    let done;
    listeners.install({ waitUntil(p) { done = p; } });
    await done;
    const keys = [...stores.get("qmv-shell-v1abc").keys()];
    assert.ok(keys.includes(SCOPE + "index.html"), keys.join(", "));
    assert.ok(keys.includes(SCOPE), keys.join(", "));
    assert.ok(keys.every((k) => k.startsWith(SCOPE)), keys.join(", "));
  });
});

describe("precacheList: danh sách lưu sẵn không có file .wasm (sua-cuoi)", () => {
  // Tên file như plugin trong vite.config.js thấy: file của bản build (có wasm của zxing-wasm) + file trong public/.
  const NAMES = [
    "index.html", "assets/index-abc.js", "assets/index-abc.css", "assets/zxing-reader-xyz.js",
    "assets/zxing_reader-BCjuyud6.wasm", "assets/khac.WASM", "icons/icon-192.png", "manifest.webmanifest"
  ];

  test("bỏ mọi file .wasm (kể cả chữ hoa), giữ chunk JS của zxing; './' đứng đầu, còn lại sắp theo tên", () => {
    assert.equal(typeof swBuild.precacheList, "function", "tools/sw-build.mjs phải export precacheList");
    assert.deepEqual(swBuild.precacheList(NAMES), [
      "./", "./assets/index-abc.css", "./assets/index-abc.js", "./assets/zxing-reader-xyz.js",
      "./icons/icon-192.png", "./index.html", "./manifest.webmanifest"
    ]);
  });

  test("PRECACHE của sw.js sinh ra không có '.wasm'; install không tải wasm", async () => {
    assert.equal(typeof swBuild.precacheList, "function", "tools/sw-build.mjs phải export precacheList");
    const code = buildServiceWorker({ version: "v2wasm", files: swBuild.precacheList(NAMES) });
    const precache = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(code)[1]);
    assert.ok(precache.length > 0);
    assert.ok(precache.every((f) => !f.toLowerCase().endsWith(".wasm")), precache.join(", "));
    assert.ok(!code.toLowerCase().includes(".wasm"), "sw.js không được nhắc tới file .wasm");
    const { listeners, log } = loadSw(code);
    let done;
    listeners.install({ waitUntil: (p) => { done = p; } });
    await done;
    assert.ok(log.fetched.length === precache.length, `đã tải ${log.fetched.length} file`);
    assert.ok(log.fetched.every((f) => !String(f.url).toLowerCase().includes(".wasm")), log.fetched.map((f) => f.url).join(", "));
  });
});

describe("đăng nhập Supabase: service worker không giữ gì của đăng nhập (dang-nhap)", () => {
  const SB = "https://abcdefgh.supabase.co";

  test("request tới supabase.co (auth, token, user) → skip, kể cả khi mở trang", () => {
    for (const url of [SB + "/auth/v1/token?grant_type=pkce", SB + "/auth/v1/user", SB + "/auth/v1/authorize?provider=google",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x"]) {
      for (const mode of ["cors", "no-cors", "navigate"]) assert.equal(routeFor(url, SCOPE, mode), "skip", url + " " + mode);
    }
  });

  test("mở trang quay về từ Google (/quet-ma-vach-full/?code=abc) → navigate; GET khác (không mở trang) cùng địa chỉ → skip", () => {
    assert.equal(routeFor(SCOPE + "?code=abc", SCOPE, "navigate"), "navigate");
    assert.equal(routeFor(SCOPE + "?code=abc", SCOPE, "cors"), "skip");
    assert.equal(routeFor(SCOPE + "?code=abc", SCOPE, "no-cors"), "skip");
    assert.equal(routeFor(SCOPE + "?error=access_denied&error_description=x", SCOPE, "same-origin"), "skip");
  });

  test("sw.js sinh ra: nhánh navigate không có cache.put (không lưu trang có ?code=)", () => {
    const code = buildServiceWorker({ version: "vAuth", files: FILES });
    const start = code.indexOf('if (route === "navigate")');
    const end = code.indexOf("return;", start);
    assert.ok(start > 0 && end > start);
    const navBranch = code.slice(start, end);
    assert.ok(!navBranch.includes("cache.put") && !navBranch.includes(".put("), navBranch);
    // put duy nhất của cả file nằm trong install (danh sách lưu sẵn)
    assert.equal(code.split(".put(").length - 1, 1);
    assert.ok(code.indexOf(".put(") < code.indexOf('addEventListener("activate"'));
  });

  test("mở trang ?code=abc chạy thật trong sw giả: lấy mạng, không ghi cache", async () => {
    const code = buildServiceWorker({ version: "vAuth", files: FILES });
    const { listeners, log } = loadSw(code, { cacheNames: ["qmv-shell-vAuth"] });
    const res = await dispatchFetch(listeners, { method: "GET", url: SCOPE + "?code=abc", mode: "navigate" });
    assert.equal(res.body, "mạng:" + SCOPE + "?code=abc");
    assert.deepEqual(log.put, []);
  });

  test("PRECACHE không có mục nào chứa 'code=' / 'supabase'", () => {
    const names = ["index.html", "assets/index-abc.js", "assets/index-abc.css", "assets/dist-xyz.js", "manifest.webmanifest", "icons/icon-192.png"];
    const code = buildServiceWorker({ version: "vAuth", files: swBuild.precacheList(names) });
    const precache = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(code)[1]);
    assert.ok(precache.length > 0);
    assert.ok(precache.every((f) => !f.includes("code=") && !f.toLowerCase().includes("supabase")), precache.join(", "));
    assert.ok(!code.toLowerCase().includes("supabase"));
  });
});

describe("precacheList: không lưu sẵn trang thử ocr-thu* / chup-mat-do* (chup-mat-do vòng 5)", () => {
  // Trang thử nằm trong public/ nên plugin gom vào danh sách; routeFor bỏ qua chúng ("skip") nên lưu sẵn là phí.
  const NAMES = [
    "index.html", "manifest.webmanifest", "icons/icon-192.png", "assets/index-abc.js",
    "assets/chup-mat-do-x.js", "assets/ocr-thu-y.js",
    "ocr-thu.html", "chup-mat-do.html", "ocr-thu/regex.mjs", "ocr-thu/text.mjs",
    "chup-mat-do/t1.mjs", "chup-mat-do/danh-muc-vn.json"
  ];

  test("bỏ ocr-thu.html, chup-mat-do.html, ocr-thu/…, chup-mat-do/… ở gốc; giữ assets/… có chữ giống", () => {
    assert.deepEqual(swBuild.precacheList(NAMES), [
      "./", "./assets/chup-mat-do-x.js", "./assets/index-abc.js", "./assets/ocr-thu-y.js",
      "./icons/icon-192.png", "./index.html", "./manifest.webmanifest"
    ]);
  });

  test("sw.js sinh từ danh sách đó không nhắc 'ocr-thu' / 'chup-mat-do' (trừ assets/ giữ lại)", () => {
    const names = NAMES.filter((n) => !n.startsWith("assets/chup-mat-do") && !n.startsWith("assets/ocr-thu"));
    const code = buildServiceWorker({ version: "v5", files: swBuild.precacheList(names) });
    assert.ok(!code.includes("ocr-thu"), "sw.js không được có 'ocr-thu'");
    assert.ok(!code.includes("chup-mat-do"), "sw.js không được có 'chup-mat-do'");
  });
});

describe("Chụp mặt trước (đợt chup-mat): service worker không đụng danh mục, T1, máy chủ OCR", () => {
  // App tải danh mục + T1 bằng fetch / import() (mode cors) chỉ khi người dùng dùng tính năng; máy chủ OCR khác tên miền.
  const OCR = "https://quet-ma-vach-ocr.jollyground-aaecba36.malaysiawest.azurecontainerapps.io";

  test("danh-muc-vn.json và t1.mjs (cùng tên miền, trong phạm vi) → skip, không lưu, không trả từ cache", () => {
    for (const p of ["chup-mat-do/danh-muc-vn.json", "chup-mat-do/t1.mjs"]) {
      for (const mode of ["cors", "no-cors", "same-origin"]) assert.equal(routeFor(SCOPE + p, SCOPE, mode), "skip", p + " " + mode);
    }
  });

  test("máy chủ OCR (khác tên miền): /ocr và /health → skip ở mọi mode", () => {
    for (const url of [OCR + "/ocr", OCR + "/health", "http://127.0.0.1:8765/ocr"]) {
      for (const mode of ["cors", "no-cors", "navigate"]) assert.equal(routeFor(url, SCOPE, mode), "skip", url + " " + mode);
    }
  });

  test("danh sách lưu sẵn từ file thật trong public/ không có chup-mat-do*, sw.js không nhắc máy chủ OCR", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const pub = fileURLToPath(new URL("../public/", import.meta.url));
    const list = (dir, prefix = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? list(path.join(dir, e.name), prefix + e.name + "/") : [prefix + e.name]);
    const names = [...list(pub), "index.html", "assets/index-abc.js", "assets/front-search-abc.js"];
    assert.ok(names.includes("chup-mat-do/danh-muc-vn.json") && names.includes("chup-mat-do/t1.mjs"), "public/ phải có 2 file này");
    const files = swBuild.precacheList(names);
    assert.ok(files.every((f) => !f.startsWith("./chup-mat-do")), files.join(" "));
    const code = buildServiceWorker({ version: "vcm", files });
    assert.ok(!code.includes("danh-muc-vn"), "sw.js không được có danh mục");
    assert.ok(!code.includes("t1.mjs"), "sw.js không được có t1.mjs");
    assert.ok(!code.includes("azurecontainerapps"), "sw.js không được nhắc máy chủ OCR");
  });
});
