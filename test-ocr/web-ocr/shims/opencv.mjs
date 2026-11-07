// Thay cho import "@techstark/opencv-js" (gói chỉ có bản UMD, không có bản ES module):
// nạp opencv.js bằng thẻ <script> (đặt globalThis.cv), chờ wasm bên trong khởi động xong (cv.Mat có),
// rồi trả cv. Đường dẫn lấy từ globalThis.__OCR_ASSETS.opencv (harness đặt trước khi import SDK).
import { loadScript } from "./load-script.mjs";

await loadScript(globalThis.__OCR_ASSETS.opencv);
const started = Date.now();
while (!(globalThis.cv && globalThis.cv.Mat)) {
  if (Date.now() - started > 120000) throw new Error("opencv.js không khởi động sau 120 giây");
  await new Promise((r) => setTimeout(r, 20));
}
export default globalThis.cv;
