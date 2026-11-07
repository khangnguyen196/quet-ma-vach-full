// Phần thuần của "Bật camera" (không DOM, không import thư viện): yêu cầu độ phân giải, vùng cắt để giải mã,
// đổi kết quả BarcodeDetector sang mã, nút đèn pin / phóng to theo khả năng camera.
// scanner.js và main.js gọi; tests/camera.test.js test bằng node (đợt nhay-hon).
import { pickCode } from "./barcode.js";

/**
 * Độ phân giải camera xin trình duyệt (chỉ là "mong muốn", máy không có thì trình duyệt chọn mức gần nhất).
 * Đo 07/11/2026 (nhay-hon, camera giả Chromium, cùng cảnh): video 1280×720 ra mã nhiều hơn rõ video 640×480
 * (mặc định của trình duyệt khi không xin độ phân giải).
 */
export const CAMERA_IDEAL = { width: 1280, height: 720 };

/**
 * Điều kiện video cho getUserMedia / videoConstraints của html5-qrcode: camera sau + 1280×720.
 * facingMode phải nằm TRONG object này: có videoConstraints thì html5-qrcode bỏ qua tham số camera đầu tiên.
 * Ví dụ: navigator.mediaDevices.getUserMedia({ video: cameraConstraints(), audio: false }).
 */
export function cameraConstraints() {
  return { facingMode: "environment", width: { ideal: CAMERA_IDEAL.width }, height: { ideal: CAMERA_IDEAL.height } };
}

// Vùng giải mã: 92% bề ngang × 60% bề cao của phần video NHÌN THẤY trong khung (khung vẽ trên màn hình đúng vùng này).
export const CROP_WIDTH = 0.92;
export const CROP_HEIGHT = 0.6;
// Cạnh ngang tối đa của ảnh đưa vào bộ giải mã (video lớn hơn thì thu nhỏ, đỡ chậm trên điện thoại).
export const DECODE_MAX_WIDTH = 1280;

const pos = (n) => Number.isFinite(n) && n > 0;

/**
 * Vùng cắt từ khung hình video để giải mã: { sx, sy, sw, sh } (pixel của video) + { dw, dh } (cỡ ảnh đưa vào bộ giải mã).
 * video: videoW × videoH; khung trên trang: boxW × boxH (video hiện kiểu object-fit: cover nên 2 bên hoặc trên dưới bị
 * khuất). Chỉ cắt trong phần nhìn thấy, để mã người dùng thấy trong khung là mã được đọc.
 * Chưa có cỡ video → null. Chưa đo được khung (0, thiếu) → coi cả video là phần nhìn thấy.
 * Ví dụ: cameraCrop(640, 480, 400, 300) → { sx: 26, sy: 96, sw: 589, sh: 288, dw: 589, dh: 288 }.
 */
export function cameraCrop(videoW, videoH, boxW, boxH) {
  if (!pos(videoW) || !pos(videoH)) return null;
  let visW = videoW, visH = videoH;
  if (pos(boxW) && pos(boxH)) {
    const box = boxW / boxH;
    if (videoW / videoH > box) visW = videoH * box; // video rộng hơn khung: 2 bên bị khuất
    else visH = videoW / box; // video cao hơn khung: trên dưới bị khuất
  }
  const sw = Math.round(visW * CROP_WIDTH);
  const sh = Math.round(visH * CROP_HEIGHT);
  const sx = Math.round((videoW - visW) / 2 + (visW - sw) / 2);
  const sy = Math.round((videoH - visH) / 2 + (visH - sh) / 2);
  const scale = Math.min(1, DECODE_MAX_WIDTH / sw);
  return { sx, sy, sw, sh, dw: Math.round(sw * scale), dh: Math.round(sh * scale) };
}

// Thứ tự ưu tiên khi 1 khung hình ra nhiều mã: mã dài trước. Mã ngắn (UPC-E, EAN-8) đọc được cùng lúc với
// mã dài thường là mảnh của chính mã dài đó. Đo 07/11/2026 (nhay-hon): lon 7Up nghiêng 18° ở 1280×720,
// zxing-wasm ra UPC-E giả "0193458000088" cùng với EAN-13 thật "8934588022111".
const FORMAT_PRIORITY = ["EAN13", "UPCA", "EAN8", "UPCE"];

/**
 * Mã từ kết quả zxing-wasm của 1 khung hình camera: như pickCode (barcode.js) nhưng xét mã dài trước
 * (EAN-13, UPC-A rồi mới tới EAN-8, UPC-E). Không có mã hợp lệ → null.
 * Ví dụ: pickCameraCode([{ isValid: true, format: "UPCE", text: "0193458000088" },
 *   { isValid: true, format: "EAN13", text: "8934588022111" }]) → "8934588022111".
 */
export function pickCameraCode(results) {
  if (!Array.isArray(results)) return null;
  const rank = (r) => { const i = FORMAT_PRIORITY.indexOf(r?.format); return i < 0 ? FORMAT_PRIORITY.length : i; };
  return pickCode([...results].sort((a, b) => rank(a) - rank(b))); // sort giữ thứ tự cũ khi cùng hạng
}

// Mã 8 số đang chờ chỉ giữ chừng này mili giây: đọc lại trong khoảng này mới nhận. Lý do (code-reviewer, nhay-hon
// vòng 1): mảnh UPC-E giả (vd "19345888" từ lon 7Up nghiêng) giữ mãi thì 15 giây sau gặp lại là nhận, tra sai sản phẩm.
export const CONFIRM_WINDOW_MS = 1000;

/**
 * Xác nhận mã trước khi tra: mã 12–13 số nhận ngay; mã 8 số (EAN-8, UPC-E: dễ là mảnh đọc nhầm của mã dài)
 * phải đọc ra lần nữa trong CONFIRM_WINDOW_MS (không cần 2 khung liền nhau) mới nhận.
 * state: mã 8 số đang chờ { code, at } (at = lúc đọc lần đầu, mili giây) hoặc null; now: giờ hiện tại (mili giây,
 * vd performance.now()). Quá hạn thì lần này coi như lần đầu. Khung không có mã giữ nguyên state (vẫn hết hạn theo giờ).
 * Trả { accept: mã được nhận hoặc null, state: trạng thái mới }.
 * Ví dụ: let s = confirmCode(null, "96385074", 0) → accept null, state { code: "96385074", at: 0 };
 *   confirmCode(s.state, "96385074", 500) → accept "96385074"; confirmCode(s.state, "96385074", 1500) → accept null,
 *   state { code: "96385074", at: 1500 }.
 */
export function confirmCode(state, code, now) {
  if (!code) return { accept: null, state };
  if (code.length !== 8) return { accept: code, state: null };
  if (state && state.code === code && now - state.at <= CONFIRM_WINDOW_MS) return { accept: code, state: null };
  return { accept: null, state: { code, at: now } };
}

/** 4 định dạng mã hàng theo tên của BarcodeDetector (giống formatsToSupport của html5-qrcode). */
export const DETECTOR_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const DETECTOR_TO_ZXING = { ean_13: "EAN13", ean_8: "EAN8", upc_a: "UPCA", upc_e: "UPCE" };

/**
 * Mã từ kết quả BarcodeDetector.detect() ([{ format, rawValue }]), chọn giống pickCameraCode
 * (mã dài trước; UPC-A 13 số có 0 đầu → 12 số). Không có mã hàng hợp lệ → null.
 */
export function detectorCode(results) {
  if (!Array.isArray(results)) return null;
  return pickCameraCode(results
    .filter((r) => r && Object.hasOwn(DETECTOR_TO_ZXING, r.format) && typeof r.rawValue === "string")
    .map((r) => ({ isValid: true, format: DETECTOR_TO_ZXING[r.format], text: r.rawValue })));
}

/**
 * Nút nào hiện theo khả năng của camera (track.getCapabilities()) và cài đặt hiện tại (track.getSettings()).
 * Trả { torch: true/false, zoom: null | { levels: [1, 2, 3…], current } }.
 * - torch: chỉ khi camera báo có đèn (true, hoặc mảng có true).
 * - zoom: các mức 1×, 2×, 3× nằm trong [min, max] (không lấy dưới 1×, iPhone nhiều ống kính có min 0,5);
 *   max phải ≥ 1,5 lần mức đầu, không thì không có nút phóng to. current: settings.zoom, không có thì mức đầu.
 * Ví dụ: cameraControls({ zoom: { min: 1, max: 8, step: 0.1 } }, { zoom: 1 }) → { torch: false, zoom: { levels: [1, 2, 3], current: 1 } }.
 */
export function cameraControls(caps, settings) {
  const out = { torch: false, zoom: null };
  if (!caps || typeof caps !== "object") return out;
  out.torch = caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true));
  const z = caps.zoom;
  if (z && typeof z === "object" && Number.isFinite(z.min) && Number.isFinite(z.max) && z.max > z.min) {
    const first = Math.max(1, z.min);
    const levels = [first, 2, 3].filter((v, i) => i === 0 || (v > first && v <= z.max));
    if (z.max >= first * 1.5 && levels.length >= 2) {
      const cur = settings && Number.isFinite(settings.zoom) ? settings.zoom : first;
      out.zoom = { levels, current: cur };
    }
  }
  return out;
}

/** Mức phóng to kế tiếp: mức đầu tiên lớn hơn mức hiện tại; hết thì quay về mức đầu. */
export function nextZoom(levels, current) {
  return levels.find((v) => v > current + 1e-6) ?? levels[0];
}

/** Chữ trên nút phóng to: mức sẽ chuyển tới ("Phóng to 2×"), về mức đầu thì "Thu về 1×". */
export function zoomLabel(levels, current) {
  const next = nextZoom(levels, current);
  const text = String(next).replace(".", ",");
  return next > current ? `Phóng to ${text}×` : `Thu về ${text}×`;
}
