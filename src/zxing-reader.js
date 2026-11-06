// Bọc zxing-wasm (bản WebAssembly của zxing-cpp) cho nút "Chụp ảnh mã".
// CHỈ được import động (await import("./zxing-reader.js")) khi người dùng chọn ảnh: mở trang không tải file này
// và không tải file wasm (khoảng 0,9 MB).
// File wasm do Vite chép vào dist/assets (đuôi "?url" trả địa chỉ file của app). Thư viện mặc định tải wasm từ
// CDN jsDelivr nên PHẢI ghi đè locateFile: wasm luôn lấy từ chính app (cùng tên miền, không CDN).
import { prepareZXingModule, purgeZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { ZXING_FORMATS } from "./barcode.js";

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

/** Nạp wasm (lần đầu thì tải file, các lần sau dùng lại). Lỗi thì ném ZxingLoadError và xóa bản hỏng để lần sau thử tải lại. */
async function ready() {
  try {
    await prepareZXingModule({ overrides: OVERRIDES, fireImmediately: true });
  } catch (e) {
    purgeZXingModule(); // không xóa thì thư viện giữ lời hứa (promise) đã lỗi, có mạng lại vẫn hỏng tới khi tải lại trang
    const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw namedError("ZxingLoadError", text, e);
  }
}

/** Đọc mã vạch từ ImageData. Trả mảng kết quả của zxing-wasm (có thể rỗng). */
export async function readCodes(imageData) {
  await ready();
  return readBarcodes(imageData, READER_OPTIONS);
}
