// PWA (giai đoạn 3): đăng ký service worker (dist/sw.js, sinh lúc build) + thanh "Đã có bản mới".
// Chỉ chạy ở bản build (npm run build / preview / GitHub Pages); npm run dev không có sw.js nên bỏ qua.

/**
 * Đăng ký service worker. Lỗi chỉ ghi console.warn, app vẫn chạy bình thường.
 * Thanh bản mới (#updateBar) chỉ hiện khi trang đang được 1 service worker cũ điều khiển và có bản mới thay
 * (lần cài đầu tiên không hiện). Không tự tải lại trang để không mất chữ đang gõ: người dùng bấm "Tải lại".
 */
export function initPwa() {
  if (!import.meta.env?.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  const bar = document.getElementById("updateBar");
  const hadController = Boolean(sw.controller); // lúc mở trang đã có service worker điều khiển chưa
  let shown = false;

  sw.addEventListener("controllerchange", () => {
    if (!hadController || shown || !bar) return;
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
