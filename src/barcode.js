// Phần thuần của "Chụp ảnh mã" (không DOM, không import thư viện): chọn mã từ kết quả zxing-wasm và
// ghép dòng lỗi nhỏ ghi đã thử những gì. scanner.js gọi; tests/barcode.test.js test bằng node.

/** Định dạng app nhận, viết theo tên của zxing-wasm (EAN-13, EAN-8, UPC-A, UPC-E), giống formatsToSupport của "Bật camera". */
export const ZXING_FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE"];

// Chờ tải file wasm của zxing-wasm tối đa 10 giây. File wasm nén khoảng 412 kB, mạng 3G chậm mất khoảng 7–8 giây.
// Hết giờ thì "Chụp ảnh mã" đọc bằng html5-qrcode như trước khi có zxing-wasm (nút không bị khóa mãi khi sóng yếu);
// lần tải wasm dở vẫn chạy tiếp, lần chụp sau dùng lại được.
export const ZXING_LOAD_TIMEOUT_MS = 10000;

/**
 * Câu lỗi khi hết giờ tải wasm (message của ZxingLoadError, in ở console). scanner.js so message với câu này để
 * biết là hết giờ (status "timeout"); dòng nhỏ trên trang khi đó ghi "chưa tải xong sau 10 giây (mạng chậm)".
 */
export const ZXING_TIMEOUT_MESSAGE = `hết giờ chờ tải bộ đọc ảnh sau ${ZXING_LOAD_TIMEOUT_MS / 1000} giây, mạng chậm`;

/**
 * Chạy đua promise với đồng hồ ms mili giây: promise xong trước thì trả kết quả / ném đúng lỗi của nó;
 * hết giờ trước thì ném makeError(). Xong kiểu nào cũng dọn đồng hồ (không để timer treo).
 * Không đụng tới promise gốc: hết giờ thì promise gốc vẫn chạy tiếp.
 * Ví dụ: await raceTimeout(fetch(url), 10000, () => new Error("Hết giờ")).
 */
export function raceTimeout(promise, ms, makeError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Nén mã UPC-A 12 số về UPC-E 8 số theo luật chuẩn (số 0 bị lược), trả null nếu mã không nén được.
 * UPC-A = hệ số (0/1) + 5 số nhà sản xuất (m) + 5 số sản phẩm (p) + số kiểm. Ví dụ "012345000065" → "01234565".
 */
function upcaToUpce(upca) {
  if (!/^[01]\d{11}$/.test(upca)) return null;
  const ns = upca[0], m = upca.slice(1, 6), p = upca.slice(6, 11), c = upca[11];
  let body = null;
  if ("012".includes(m[2]) && m.slice(3) === "00" && p.startsWith("00")) body = m.slice(0, 2) + p.slice(2) + m[2];
  else if (m.slice(3) === "00" && p.startsWith("000")) body = m.slice(0, 3) + p.slice(3) + "3";
  else if (m[4] === "0" && p.startsWith("0000")) body = m.slice(0, 4) + p[4] + "4";
  else if (p.startsWith("0000") && "56789".includes(p[4])) body = m + p[4];
  return body ? ns + body + c : null;
}

/** Mã 8 số in trên bao bì zxing-wasm ghi trong extra ('{"UPCE":"01234565"}' hoặc object); không có / hỏng → null. */
function upceFromExtra(extra) {
  let data = extra;
  if (typeof extra === "string") {
    try { data = JSON.parse(extra); } catch { return null; }
  }
  const v = data && typeof data === "object" ? data.UPCE : null;
  return typeof v === "string" && /^\d{8}$/.test(v) ? v : null;
}

/**
 * Chọn mã từ mảng kết quả của zxing-wasm (readBarcodes): lấy kết quả đầu tiên hợp lệ (isValid),
 * đúng định dạng app nhận và là 8–14 chữ số. Mã UPC-A trả 12 số (bỏ số 0 đầu zxing-wasm thêm vào).
 * Mã UPC-E trả 8 số như html5-qrcode (zxing-wasm trả 13 số dạng mở rộng: lấy mã 8 số trong extra, không có thì
 * tự nén lại; không nén được thì 12 số như UPC-A).
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
    // Mã UPC-E: html5-qrcode trả 8 số in trên bao bì ("01234565"), zxing-wasm 3.1.6 trả 13 số ("0012345000065").
    if (r.format === "UPCE" && text.length === 13 && text[0] === "0") {
      return upceFromExtra(r.extra) || upcaToUpce(text.slice(1)) || text.slice(1);
    }
    return text;
  }
  return null;
}

/**
 * Dòng lỗi nhỏ khi cả 2 cách đều không đọc được mã, ví dụ
 * "zxing-wasm: không thấy mã; html5-qrcode: NotFoundException (đã thử 4 lần)".
 * zxing: { status: "notfound", rotated } | { status: "timeout" } (hết ZXING_LOAD_TIMEOUT_MS mà wasm chưa tải xong)
 *   | { status: "load", detail } (không tải được) | { status: "error", detail } (ném lỗi khi đọc);
 * rotated: true nếu đã thử thêm lượt xoay ±15°;
 * html5: { name, message, tries } của lần thử cuối của html5-qrcode.
 */
export function scanFailureText({ zxing = {}, html5 = {} } = {}) {
  const why = (label) => (zxing.detail ? `${label} (${zxing.detail})` : label);
  const z = zxing.status === "timeout" ? `chưa tải xong sau ${ZXING_LOAD_TIMEOUT_MS / 1000} giây (mạng chậm)`
    : zxing.status === "load" ? why("không tải được")
    : zxing.status === "error" ? why("lỗi khi đọc")
    : zxing.rotated ? "không thấy mã (kể cả khi xoay ±15°)" : "không thấy mã";
  const name = html5.name || "ScanError";
  const h = html5.message ? `${name}: ${html5.message}` : name;
  return `zxing-wasm: ${z}; html5-qrcode: ${h} (đã thử ${Number(html5.tries) || 0} lần)`;
}
