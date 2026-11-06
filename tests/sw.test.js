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

  test("file trong assets/ → asset; manifest, icon, sw.js, index.html (không phải mở trang) → skip", () => {
    assert.equal(routeFor(SCOPE + "assets/index-abc.js", SCOPE, "cors"), "asset");
    assert.equal(routeFor(SCOPE + "assets/index-abc.css", SCOPE, "no-cors"), "asset");
    for (const p of ["manifest.webmanifest", "sw.js", "icons/icon-192.png", "index.html", "assetsx/a.js"]) {
      assert.equal(routeFor(SCOPE + p, SCOPE, "cors"), "skip", p);
    }
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
function loadSw(code, { cacheNames = [], fetchImpl } = {}) {
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
