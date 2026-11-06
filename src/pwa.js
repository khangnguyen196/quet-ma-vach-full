// PWA (giai đoạn 3): đăng ký service worker (dist/sw.js, sinh lúc build) + thanh "Đã có bản mới".
// Chỉ chạy ở bản build (npm run build / preview / GitHub Pages); npm run dev không có sw.js nên bỏ qua.

/**
 * Danh sách địa chỉ đầy đủ các file của trang đang mở: file JS của app (scriptUrl, thường là import.meta.url)
 * và mọi <link rel="stylesheet"> nằm trong assets/ (bỏ link ngoài như Google Fonts).
 * Hàm thuần: chỉ đọc doc được truyền vào (test bằng node với doc giả).
 * @param {string} scriptUrl
 * @param {{ querySelectorAll(selector: string): Iterable<{ href: string }> }} doc
 * @returns {string[]}
 */
export function pageAssetUrls(scriptUrl, doc) {
  const css = [];
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    try {
      if (new URL(link.href).pathname.includes("/assets/")) css.push(link.href);
    } catch { /* href hỏng thì bỏ qua */ }
  }
  return [scriptUrl, ...css];
}

/**
 * Trang đang mở có phải bản mới nhất không: true chỉ khi danh sách khác rỗng VÀ mọi địa chỉ đều có trong cache.
 * Bất kỳ lỗi nào → false (không kiểm được thì coi như trang cũ, vẫn hiện thanh "Đã có bản mới").
 * Ví dụ: isPageCurrent(["https://…/assets/index-abc.js"], caches) → true nếu file đó đã lưu trong cache bản mới.
 * @param {string[]} urls
 * @param {{ match(url: string): Promise<unknown> }} cacheStorage
 * @returns {Promise<boolean>}
 */
export async function isPageCurrent(urls, cacheStorage) {
  try {
    if (!Array.isArray(urls) || urls.length === 0) return false;
    for (const url of urls) {
      if (!url || !(await cacheStorage.match(url))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Chờ service worker xong bước kích hoạt (state "activated": bước activate, gồm xóa cache bản cũ, đã chạy xong)
 * hoặc bị bỏ ("redundant"). worker null / đã xong thì trả về ngay.
 * @param {{ state: string, addEventListener(type: string, fn: () => void): void,
 *           removeEventListener(type: string, fn: () => void): void } | null | undefined} worker
 * @returns {Promise<void>}
 */
export function whenActivated(worker) {
  const done = () => !worker || worker.state === "activated" || worker.state === "redundant";
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (!done()) return;
      worker.removeEventListener("statechange", onChange);
      resolve();
    };
    worker.addEventListener("statechange", onChange);
  });
}

/**
 * Đăng ký service worker. Lỗi chỉ ghi console.warn, app vẫn chạy bình thường.
 * Thanh bản mới (#updateBar) chỉ hiện khi trang đang được 1 service worker cũ điều khiển và có bản mới thay
 * (lần cài đầu tiên không hiện), và file JS / CSS của trang không còn trong cache bản mới (trang đã là bản mới
 * thì không hiện, xem isPageCurrent). Không tự tải lại trang để không mất chữ đang gõ: người dùng bấm "Tải lại".
 */
export function initPwa() {
  if (!import.meta.env?.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  const bar = document.getElementById("updateBar");
  const hadController = Boolean(sw.controller); // lúc mở trang đã có service worker điều khiển chưa
  let shown = false;

  sw.addEventListener("controllerchange", async () => {
    if (!hadController || shown || !bar) return;
    // Lần mở đầu sau deploy: service worker bản 1 hỏi mạng trước nên trang tải về đã là bản 2, rồi bản 2 cài xong,
    // nhận điều khiển → controllerchange. Lúc đó trang đã mới, không cần thanh. Cách phân biệt: bản mới xóa cache
    // của bản cũ ở bước activate, nên khi bản mới đã "activated" thì file JS / CSS của trang cũ không còn trong
    // cache nào; còn file của trang đang mở vẫn có trong cache (của bản mới) thì trang đã là bản mới.
    // Phải chờ "activated": với trang đang được bản cũ điều khiển, trình duyệt bắn controllerchange ngay khi bản mới
    // BẮT ĐẦU kích hoạt, lúc cache bản cũ chưa bị xóa (đã thử: Chromium thấy cả 2 cache lúc controllerchange).
    await whenActivated(sw.controller);
    if (await isPageCurrent(pageAssetUrls(import.meta.url, document), globalThis.caches)) return;
    if (shown) return; // trong lúc chờ kiểm cache có thể đã có 1 controllerchange khác hiện thanh
    shown = true;
    bar.hidden = false;
  });
  bar?.querySelector("#btnReload")?.addEventListener("click", () => location.reload());

  sw.register("./sw.js", { scope: "./", updateViaCache: "none" })
    .then((registration) => {
      // Mỗi lần quay lại tab (mở lại app từ màn hình chính, đổi tab) thì hỏi xem có sw.js mới không.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        registration.update().catch((e) => console.warn("Không kiểm được bản mới:", e));
      });
    })
    .catch((e) => console.warn("Không đăng ký được service worker (app vẫn chạy, chỉ không mở được khi mất mạng):", e));
}
