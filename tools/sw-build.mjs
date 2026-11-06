// Ghép mã service worker (sw.js) lúc build. Thuần, không DOM: vite.config.js gọi khi build, tests/sw.test.js gọi khi test.
// Service worker chỉ giữ GIAO DIỆN (index.html + file trong assets/) để mở nhanh và mở được khi mất mạng.
// Không bao giờ giữ request khác tên miền (Open Food Facts, ảnh sản phẩm, Google Fonts): để thẳng mạng lo.
import { createHash } from "node:crypto";

/**
 * Chọn cách xử lý 1 request trong service worker.
 * urlString: địa chỉ request; scopeString: phạm vi của service worker (vd https://x.github.io/quet-ma-vach-full/);
 * mode: request.mode ("navigate" khi mở trang).
 * Trả: "navigate" (mạng trước, mất mạng thì index.html đã lưu), "asset" (đã lưu trước, không có thì mạng),
 * "skip" (không đụng: khác tên miền, ngoài phạm vi, manifest, icon, sw.js…).
 * Hàm này được chép nguyên văn vào sw.js bằng routeFor.toString(): KHÔNG dùng biến / hàm bên ngoài nó.
 */
export function routeFor(urlString, scopeString, mode) {
  let url, scope;
  try {
    url = new URL(urlString);
    scope = new URL(scopeString);
  } catch {
    return "skip";
  }
  if (url.origin !== scope.origin) return "skip";
  if (!url.pathname.startsWith(scope.pathname)) return "skip";
  if (mode === "navigate") return "navigate";
  if (url.pathname.startsWith(scope.pathname + "assets/")) return "asset";
  return "skip";
}

/**
 * Mã phiên bản ngắn theo NỘI DUNG các file build: file nào đổi thì mã đổi (trình duyệt thấy sw.js mới).
 * files: [{ name, content }] (content là chuỗi hoặc Buffer). Sắp theo tên trước khi băm nên thứ tự không quan trọng.
 */
export function versionOf(files) {
  const hash = createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    hash.update(f.name);
    hash.update("\0");
    hash.update(f.content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * Danh sách file lưu sẵn (PRECACHE) của sw.js từ tên file của bản build + public/ (vd "assets/index-abc.js").
 * Trả "./" đầu tiên rồi "./<tên>" sắp theo tên. Bỏ mọi file .wasm: wasm của zxing-wasm (~0,9 MB) chỉ tải khi
 * người dùng chọn ảnh ("Chụp ảnh mã"), không tải sẵn lúc cài; mất mạng thì app đọc ảnh bằng html5-qrcode.
 */
export function precacheList(names) {
  const kept = names.filter((name) => !name.toLowerCase().endsWith(".wasm"));
  return ["./", ...kept.map((name) => "./" + name).sort()];
}

/**
 * Trả chuỗi mã sw.js.
 * version: mã phiên bản (versionOf); files: đường dẫn tương đối theo phạm vi ("./", "./index.html", "./assets/…").
 */
export function buildServiceWorker({ version, files }) {
  return `// sw.js: sinh lúc build bởi tools/sw-build.mjs (plugin trong vite.config.js). KHÔNG sửa tay.
// Chỉ giữ giao diện app; request khác tên miền (dữ liệu sản phẩm, font) không bao giờ vào cache.
const VERSION = ${JSON.stringify(String(version))};
const CACHE = "qmv-shell-" + VERSION;
const PRECACHE = ${JSON.stringify(files, null, 2)};

${routeFor.toString()}

// Cài: nạp từng file giao diện thẳng từ mạng (bỏ qua bộ nhớ đệm HTTP) vào cache của bản này.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of PRECACHE) {
      const req = new Request(url, { cache: "reload" });
      const res = await fetch(req);
      if (!res.ok) throw new Error("Không tải được " + url + " (HTTP " + res.status + ")");
      await cache.put(req, res);
    }
    await self.skipWaiting();
  })());
});

// Kích hoạt: xóa cache giao diện của các bản cũ (chỉ tên bắt đầu "qmv-shell-"), rồi nhận điều khiển các tab đang mở.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("qmv-shell-") && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const route = routeFor(req.url, self.registration.scope, req.mode);
  if (route === "skip") return; // không respondWith: trình duyệt tự đi mạng như không có service worker
  if (route === "navigate") {
    // Mở trang: mạng trước, bỏ qua bộ nhớ đệm HTTP để bản mới hiện ngay; mất mạng thì dùng index.html đã lưu.
    event.respondWith(fetch(req, { cache: "no-cache" }).catch(async () => {
      const cached = await caches.match("./index.html", { cacheName: CACHE, ignoreSearch: true });
      return cached || Response.error();
    }));
    return;
  }
  // File trong assets/ (tên có mã băm, không đổi nội dung): đã lưu trước, không có thì mạng (không ghi thêm vào cache).
  event.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
});
`;
}
