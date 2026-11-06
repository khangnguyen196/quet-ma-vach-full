// Bọc zxing-wasm (bản WebAssembly của zxing-cpp) cho nút "Chụp ảnh mã".
// CHỈ được import động (await import("./zxing-reader.js")) khi người dùng chọn ảnh: mở trang không tải file này
// và không tải file wasm (khoảng 0,9 MB).
// File wasm do Vite chép vào dist/assets (đuôi "?url" trả địa chỉ file của app). Thư viện mặc định tải wasm từ
// CDN jsDelivr nên PHẢI ghi đè locateFile: wasm luôn lấy từ chính app (cùng tên miền, không CDN).
import { prepareZXingModule, purgeZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { ZXING_FORMATS, ZXING_LOAD_TIMEOUT_MS, ZXING_TIMEOUT_MESSAGE, raceTimeout } from "./barcode.js";

// Tùy chọn đọc (tên lấy từ readerOptions.d.ts của zxing-wasm 3.1.6):
// tryHarder: dò kỹ hơn (chậm hơn, đúng hơn); tryRotate: tự thử xoay 90 / 180 / 270°;
// tryInvert: thử mã in ngược màu; tryDownscale: thử thêm bản thu nhỏ của ảnh; maxNumberOfSymbols: 1 thì thấy 1 mã là dừng.
const READER_OPTIONS = {
  formats: ZXING_FORMATS,
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1
};

const OVERRIDES = {
  locateFile: (path, prefix) => (path.endsWith(".wasm") ? new URL(wasmUrl, document.baseURI).href : prefix + path)
};

function namedError(name, message, cause) {
  const e = new Error(message);
  e.name = name;
  if (cause !== undefined) e.cause = cause;
  return e;
}

// Lời hứa (promise) tải wasm đã gắn .catch xóa bản hỏng. prepareZXingModule gọi lại với CÙNG object OVERRIDES thì
// trả lại đúng lời hứa đang chạy (zxing-wasm 3.1.6), nên mỗi lời hứa chỉ gắn 1 lần.
const watched = new WeakSet();

/**
 * Nạp wasm (lần đầu thì tải file, các lần sau dùng lại). Chờ tối đa ZXING_LOAD_TIMEOUT_MS (10 giây):
 * - hết giờ: ném ZxingLoadError "hết giờ…" để scanner.js đọc bằng html5-qrcode; KHÔNG xóa lời hứa đang tải,
 *   lần tải dở vẫn chạy tiếp và lần chụp sau dùng lại (không tải lại từ đầu);
 * - tải lỗi thật (mất mạng, file hỏng): ném ZxingLoadError (cause = lỗi gốc); lời hứa lỗi bị xóa (purge) để
 *   lần sau tải lại. Không xóa thì thư viện giữ lời hứa đã lỗi, có mạng lại vẫn hỏng tới khi tải lại trang.
 */
async function ready() {
  const p = prepareZXingModule({ overrides: OVERRIDES, fireImmediately: true });
  if (!watched.has(p)) {
    watched.add(p);
    // Xóa khi lỗi thật, kể cả lỗi tới sau khi đã hết giờ; .catch này cũng tránh lỗi "unhandled rejection".
    p.catch(() => purgeZXingModule());
  }
  let timeoutError = null;
  try {
    await raceTimeout(p, ZXING_LOAD_TIMEOUT_MS, () => (timeoutError = namedError("ZxingLoadError", ZXING_TIMEOUT_MESSAGE)));
  } catch (e) {
    if (e === timeoutError) throw e; // hết giờ: không purge
    const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw namedError("ZxingLoadError", text, e);
  }
}

/** Đọc mã vạch từ ImageData. Trả mảng kết quả của zxing-wasm (có thể rỗng). */
export async function readCodes(imageData) {
  await ready();
  return readBarcodes(imageData, READER_OPTIONS);
}
