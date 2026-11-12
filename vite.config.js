import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import path from "node:path";
import { buildServiceWorker, precacheList, versionOf } from "./tools/sw-build.mjs";
import { secretEnvNames } from "./src/auth.js";

/** Mọi file trong thư mục public/ (đường dẫn dạng "icons/icon-192.png"), đọc thẳng từ đĩa. */
function listPublicFiles(dir, prefix = "") {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix + entry.name;
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listPublicFiles(full, rel + "/") : [{ name: rel, content: fs.readFileSync(full) }];
  });
}

/**
 * Plugin nhỏ (chỉ chạy khi build): sinh dist/sw.js giữ giao diện app để mở nhanh và mở được khi mất mạng.
 * Danh sách file = file của bản build (index.html, assets/…) + file trong public/ (manifest, icons), trừ file .wasm
 * (wasm của zxing-wasm chỉ tải khi chọn ảnh, xem precacheList trong tools/sw-build.mjs).
 * Mã phiên bản tính theo nội dung mọi file (kể cả .wasm): deploy bản mới là sw.js đổi, trình duyệt cài bản mới.
 */
function serviceWorkerPlugin() {
  let publicDir = "";
  return {
    name: "qmv-service-worker",
    apply: "build",
    enforce: "post", // chạy sau plugin HTML của Vite để index.html đã có trong bundle
    configResolved(config) { publicDir = config.publicDir; },
    generateBundle(_, bundle) {
      const built = Object.values(bundle)
        .filter((f) => f.fileName !== "sw.js" && !f.fileName.endsWith(".map"))
        .map((f) => ({ name: f.fileName, content: f.type === "chunk" ? f.code : f.source }));
      const pub = listPublicFiles(publicDir).filter((f) => f.name !== "sw.js");
      const all = [...built, ...pub];
      const files = precacheList(all.map((f) => f.name));
      const source = buildServiceWorker({ version: versionOf(all), files });
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    }
  };
}

/**
 * Plugin chặn khóa BÍ MẬT (đợt dang-nhap): Vite chép nguyên giá trị biến VITE_* vào JS, repo công khai và bản build lên
 * GitHub Pages. Dán nhầm sb_secret_… / JWT service_role vào .env hay GitHub Variables thì dev / build / preview DỪNG,
 * câu lỗi chỉ nêu TÊN biến, không bao giờ in giá trị. Không đặt apply: chạy cả dev, build, preview.
 */
function blockSecretKeysPlugin() {
  return {
    name: "qmv-chan-khoa-bi-mat",
    configResolved(config) {
      const bad = secretEnvNames(config.env);
      if (bad.length) {
        throw new Error("Biến " + bad.join(", ") + " đang chứa khóa BÍ MẬT của Supabase (sb_secret_… hoặc service_role). "
          + "Chỉ dùng publishable key. Đổi khóa bí mật này trên Supabase rồi sửa biến.");
      }
    }
  };
}

// basicSsl tạo chứng chỉ HTTPS tự ký để mở camera khi test trên điện thoại.
// host: true để điện thoại cùng Wi-Fi vào được bằng IP máy tính.
// base: "./" để file build dùng đường dẫn tương đối, chạy được ở GitHub Pages (https://<tên>.github.io/<repo>/).
export default defineConfig({
  base: "./",
  plugins: [blockSecretKeysPlugin(), basicSsl(), serviceWorkerPlugin()],
  server: { host: true, port: 5173 }
});
