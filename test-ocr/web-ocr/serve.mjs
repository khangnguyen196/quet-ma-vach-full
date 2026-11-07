// Server tĩnh nhỏ cho trang đo, chỉ nghe ở 127.0.0.1.
// CỐ Ý KHÔNG gửi header COOP / COEP: GitHub Pages không đặt được 2 header này, nên trang đo phải chạy
// như trên Pages (crossOriginIsolated = false, không SharedArrayBuffer, wasm chỉ 1 luồng).
//
// Đường dẫn:
//   /                    -> thư mục web-ocr (harness.html, harness.mjs, assets.js, lib.mjs, shims/)
//   /node_modules/...    -> web-ocr/node_modules
//   /photos/...          -> thư mục ảnh (mặc định <thư mục hiện tại>/photos)
//   /cache/paddle-onnx/  -> model ONNX (mặc định D:\cache\paddle-onnx, đổi bằng PADDLE_ONNX_DIR)
//   /cache/tessdata/     -> dữ liệu ngôn ngữ tesseract.js (mặc định D:\cache\web-ocr\tessdata, đổi bằng TESSDATA_DIR)
//
// Chạy riêng (để mở bằng tay): node serve.mjs  (cổng PORT, mặc định 8787). Ctrl+C để tắt.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".yml": "text/yaml; charset=utf-8",
  ".gz": "application/octet-stream", // KHÔNG gửi Content-Encoding: tesseract.js tự giải nén .traineddata.gz
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

/** Ghép tiền tố URL -> thư mục; trả đường dẫn file trong thư mục gốc, hoặc null nếu ra ngoài thư mục (../). */
export function resolvePath(urlPath, mounts) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  // mount dài nhất khớp trước
  const keys = Object.keys(mounts).sort((a, b) => b.length - a.length);
  for (const prefix of keys) {
    if (decoded === prefix.replace(/\/$/, "") || decoded.startsWith(prefix)) {
      const root = path.resolve(mounts[prefix]);
      const rest = decoded.slice(prefix.length);
      const full = path.resolve(root, "." + path.sep + rest);
      if (full !== root && !full.startsWith(root + path.sep)) return null;
      return full;
    }
  }
  return null;
}

export function defaultMounts(cwd = process.cwd()) {
  return {
    "/node_modules/": path.join(HERE, "node_modules"),
    "/photos/": process.env.PHOTOS_DIR || path.join(cwd, "photos"),
    "/cache/paddle-onnx/": process.env.PADDLE_ONNX_DIR || "D:\\cache\\paddle-onnx",
    "/cache/tessdata/": process.env.TESSDATA_DIR || "D:\\cache\\web-ocr\\tessdata",
    "/": HERE,
  };
}

/** Bật server; port 0 = cổng ngẫu nhiên còn trống. Trả { port, close() }. */
export function startServer({ port = 0, mounts = defaultMounts() } = {}) {
  const server = http.createServer((req, res) => {
    let file = resolvePath(req.url === "/" ? "/harness.html" : req.url, mounts);
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("không có file");
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const size = fs.statSync(file).size;
    // Không có Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy (xem đầu file).
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Cache-Control": "no-cache" });
    if (req.method === "HEAD") return res.end();
    // file bị khóa / xóa giữa chừng: hủy kết nối này thay vì làm sập server giữa lần đo
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const sockets = new Set();
      server.on("connection", (s) => {
        sockets.add(s);
        s.on("close", () => sockets.delete(s));
      });
      resolve({
        port: server.address().port,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { port } = await startServer({ port: Number(process.env.PORT || 8787) });
  console.log(`Trang đo: http://localhost:${port}/harness.html (Ctrl+C để tắt)`);
}
