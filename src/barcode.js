// Phần thuần của "Chụp ảnh mã" (không DOM, không import thư viện): chọn mã từ kết quả zxing-wasm và
// ghép dòng lỗi nhỏ ghi đã thử những gì. scanner.js gọi; tests/barcode.test.js test bằng node.

/** Định dạng app nhận, viết theo tên của zxing-wasm (EAN-13, EAN-8, UPC-A, UPC-E), giống formatsToSupport của "Bật camera". */
export const ZXING_FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE"];

/**
 * Chọn mã từ mảng kết quả của zxing-wasm (readBarcodes): lấy kết quả đầu tiên hợp lệ (isValid),
 * đúng định dạng app nhận và là 8–14 chữ số. Mã UPC-A trả 12 số (bỏ số 0 đầu zxing-wasm thêm vào).
 * Không có thì trả null (không ném lỗi).
 */
export function pickCode(results) {
  if (!Array.isArray(results)) return null;
  for (const r of results) {
    if (!r || r.isValid !== true || !ZXING_FORMATS.includes(r.format) || typeof r.text !== "string") continue;
    const text = r.text.trim();
    if (!/^\d{8,14}$/.test(text)) continue;
    // Mã UPC-A (12 số): zxing-wasm trả dạng EAN-13 có số 0 đầu ("0036000291452"); html5-qrcode (camera,
    // cách đọc ảnh cũ) trả 12 số. Bỏ số 0 đầu để cùng 1 sản phẩm luôn ra cùng 1 mã (lịch sử, tủ đồ không bị trùng).
    if ((r.format === "EAN13" || r.format === "UPCA") && text.length === 13 && text[0] === "0") return text.slice(1);
    return text;
  }
  return null;
}

/**
 * Dòng lỗi nhỏ khi cả 2 cách đều không đọc được mã, ví dụ
 * "zxing-wasm: không thấy mã; html5-qrcode: NotFoundException (đã thử 4 lần)".
 * zxing: { status: "notfound" } | { status: "load", detail } (không tải được) | { status: "error", detail } (ném lỗi khi đọc);
 * html5: { name, message, tries } của lần thử cuối của html5-qrcode.
 */
export function scanFailureText({ zxing = {}, html5 = {} } = {}) {
  const why = (label) => (zxing.detail ? `${label} (${zxing.detail})` : label);
  const z = zxing.status === "load" ? why("không tải được")
    : zxing.status === "error" ? why("lỗi khi đọc")
    : "không thấy mã";
  const name = html5.name || "ScanError";
  const h = html5.message ? `${name}: ${html5.message}` : name;
  return `zxing-wasm: ${z}; html5-qrcode: ${h} (đã thử ${Number(html5.tries) || 0} lần)`;
}
