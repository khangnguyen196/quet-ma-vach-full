// Bật/tắt camera (html5-qrcode) và đọc mã từ ảnh ("Chụp ảnh mã": zxing-wasm trước, html5-qrcode dự phòng).
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from "html5-qrcode";
import { errorText } from "./render.js";
import { pickCode, scanFailureText, ZXING_TIMEOUT_MESSAGE } from "./barcode.js";

// "Chụp ảnh mã" đọc bằng zxing-wasm trước (đọc được bao bì thật nhăn / xoay dọc mà html5-qrcode trượt).
// zxing-wasm chỉ được tải khi chọn ảnh (import động); tải không được, ném lỗi hoặc không thấy mã thì
// thử tiếp html5-qrcode theo SCAN_TRIES dưới đây, y như trước khi có zxing-wasm.
// Cạnh dài ảnh đưa vào zxing-wasm (thư viện tự thử thêm bản thu nhỏ và xoay 90°/180°/270°).
const ZXING_MAX_SIDE = 1600;
// Lượt cuối (chỉ khi zxing-wasm và html5-qrcode đều trượt): xoay ảnh ±15° rồi đọc lại bằng zxing-wasm.
// Đo 06/11/2026 (sua-cuoi): đọc thêm được 2/55 ảnh tổng hợp nghiêng 15° + mờ + lóa mà các lượt khác trượt.
const ZXING_EXTRA_ANGLES = [15, -15];

// html5-qrcode đọc mã từ ảnh: thử lần lượt, đọc được thì dừng.
// Vì sao thu nhỏ: thư viện vẽ ảnh gốc lên canvas cỡ ảnh + 200 px; ảnh 24–48 MP của điện thoại
// vượt giới hạn canvas của iPhone (khoảng 16,7 triệu điểm) nên không đọc được. Mã vạch cần
// vài trăm px là đủ, nên thu cạnh dài về 1600 px rồi 1000 px.
// Vì sao xoay: thư viện chỉ dò các hàng ngang ở giữa ảnh, không tự xoay; chụp mã dọc
// (vạch nằm ngang) thì phải xoay ảnh 90° mới đọc được.
const SCAN_TRIES = [
  { maxSide: 1600, rotate: false },
  { maxSide: 1000, rotate: false },
  { maxSide: 1600, rotate: true },
  { maxSide: 1000, rotate: true }
];

function namedError(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

/** Mở file ảnh thành <img> (thu hồi URL tạm khi xong). */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(namedError("ImageLoadError", "Không mở được file ảnh (file hỏng hoặc không phải ảnh)."));
    };
    img.src = url;
  });
}

/** Cỡ ảnh sau khi thu nhỏ cho cạnh dài ≤ maxSide (ảnh nhỏ hơn thì giữ nguyên, không phóng to). */
function fitSize(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  return { w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) };
}

/** Vẽ ảnh lên canvas mới (thu nhỏ, có thể xoay 90°) rồi trả về File PNG. */
async function drawToFile(img, { w, h }, rotate) {
  const canvas = document.createElement("canvas");
  canvas.width = rotate ? h : w;
  canvas.height = rotate ? w : h;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw namedError("CanvasError", `Không tạo được vùng vẽ ${canvas.width}×${canvas.height} để đọc ảnh.`);
    if (rotate) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); } // xoay 90° theo chiều kim đồng hồ
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw namedError("CanvasError", "Không chuyển được ảnh đã thu nhỏ sang PNG.");
    return new File([blob], "anh.png", { type: "image/png" });
  } finally {
    canvas.width = canvas.height = 0; // trả bộ nhớ canvas ngay, iPhone giới hạn tổng bộ nhớ canvas
  }
}

/**
 * Đọc bằng zxing-wasm. Trả mã (chuỗi) hoặc null nếu không thấy mã.
 * angle: số độ xoay ảnh trước khi đọc (0 = không xoay; ±15 ở lượt cuối), vùng vẽ nới ra cho vừa ảnh đã xoay.
 * Ném lỗi (name "ZxingLoadError" nếu không tải được thư viện / file wasm) để scanImage chuyển sang html5-qrcode.
 */
async function readWithZxing(img, angle = 0) {
  const { w, h } = fitSize(img, ZXING_MAX_SIDE); // ≤ 1600 × 1600 = 2,56 triệu điểm, dưới giới hạn canvas iPhone
  const rad = angle * Math.PI / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const cw = Math.ceil(w * cos + h * sin), ch = Math.ceil(w * sin + h * cos); // xoay 15°: ≤ 1960 × 1960 ≈ 3,8 triệu điểm
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  let imageData;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw namedError("CanvasError", `Không tạo được vùng vẽ ${cw}×${ch} để đọc ảnh.`);
    if (angle) {
      ctx.fillStyle = "#fff"; // góc trống sau khi xoay tô trắng
      ctx.fillRect(0, 0, cw, ch);
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }
    imageData = ctx.getImageData(0, 0, cw, ch);
  } finally {
    canvas.width = canvas.height = 0; // trả bộ nhớ canvas ngay
  }
  let mod;
  try {
    mod = await import("./zxing-reader.js");
  } catch (e) {
    throw namedError("ZxingLoadError", errorText(e)); // mất mạng: không tải được file JS của zxing-wasm
  }
  return pickCode(await mod.readCodes(imageData));
}

export function createScanner(elementId) {
  const scanner = new Html5Qrcode(elementId, {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
    verbose: false,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  });
  let running = false;

  return {
    get running() { return running; },

    /** Bật camera sau; gọi onCode(text) khi đọc được mã. Ném lỗi nếu không mở được camera. */
    async start(onCode) {
      if (running) return;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          aspectRatio: 4 / 3,
          qrbox: (w, h) => ({ width: Math.min(Math.round(w * 0.82), 340), height: Math.min(Math.round(h * 0.45), 170) })
        },
        (text) => onCode(text),
        () => {} // mỗi khung hình chưa thấy mã thì bỏ qua
      );
      running = true;
    },

    async stop() {
      if (!running) return;
      try { await scanner.stop(); } catch { /* đã dừng */ }
      running = false;
    },

    /**
     * Đọc mã vạch từ 1 file ảnh (File từ input type=file).
     * zxing-wasm trước; không được thì html5-qrcode theo SCAN_TRIES. Cả 2 trượt thì ném lỗi có dòng
     * "đã thử những gì" (scanFailureText), lỗi gốc của html5-qrcode ở e.cause.
     */
    async scanImage(file) {
      await this.stop();
      const img = await loadImage(file);

      let zxing;
      try {
        const code = await readWithZxing(img);
        if (code) return code;
        zxing = { status: "notfound" };
      } catch (e) {
        console.warn("zxing-wasm không đọc được, chuyển sang html5-qrcode:", e);
        const load = e?.name === "ZxingLoadError";
        // Hết giờ tải wasm: zxing-reader.js ném ZxingLoadError với đúng câu ZXING_TIMEOUT_MESSAGE.
        if (load && e.message === ZXING_TIMEOUT_MESSAGE) zxing = { status: "timeout" };
        else zxing = { status: load ? "load" : "error", detail: load ? e.message : errorText(e) };
      }

      const seen = new Set();
      let lastError = null, count = 0;
      for (const { maxSide, rotate } of SCAN_TRIES) {
        const size = fitSize(img, maxSide);
        const key = `${size.w}x${size.h}-${rotate}`;
        if (seen.has(key)) continue; // ảnh nhỏ: 1600 và 1000 ra cùng cỡ, bỏ lần trùng
        seen.add(key);
        count++;
        try {
          return await scanner.scanFile(await drawToFile(img, size, rotate), false);
        } catch (e) {
          lastError = e;
        }
      }
      // Lượt cuối: zxing-wasm đã chạy được mà không thấy mã → xoay ảnh ±15° rồi đọc lại.
      if (zxing.status === "notfound") {
        zxing.rotated = true;
        for (const angle of ZXING_EXTRA_ANGLES) {
          try {
            const code = await readWithZxing(img, angle);
            if (code) return code;
          } catch (e) {
            console.warn(`zxing-wasm lỗi ở lượt xoay ${angle}°:`, e);
          }
        }
      }
      // Gói lỗi lần cuối thành Error mới có name + message (thư viện có khi ném chuỗi thay vì Error).
      // Tên lớp lỗi của ZXing bị rút gọn khi build (ví dụ "O"); getKind() trả tên thật, ví dụ "NotFoundException".
      const isError = lastError instanceof Error;
      const name = (typeof lastError?.getKind === "function" && lastError.getKind())
        || (isError && lastError.name) || "ScanError";
      const text = isError ? lastError.message : errorText(lastError);
      const e = namedError("ScanError", scanFailureText({ zxing, html5: { name, message: text, tries: count } }));
      e.cause = lastError;
      throw e;
    }
  };
}
