// Thay cho import "clipper-lib" (gói CommonJS): nạp clipper.js bằng thẻ <script> (đặt window.ClipperLib).
import { loadScript } from "./load-script.mjs";

await loadScript(globalThis.__OCR_ASSETS.clipper);
export default globalThis.ClipperLib;
