// Bọc html5-qrcode: bật/tắt camera, đọc mã từ ảnh.
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from "html5-qrcode";
import { errorText } from "./render.js";

// Đọc mã từ ảnh: thử lần lượt, đọc được thì dừng.
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
     * Thử theo SCAN_TRIES; hết lượt vẫn không đọc được thì ném lỗi của lần cuối, kèm số lần đã thử.
     */
    async scanImage(file) {
      await this.stop();
      const img = await loadImage(file);
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
      // Gói lỗi lần cuối thành Error mới có name + message (thư viện có khi ném chuỗi thay vì Error).
      // Tên lớp lỗi của ZXing bị rút gọn khi build (ví dụ "O"); getKind() trả tên thật, ví dụ "NotFoundException".
      const note = `đã thử ${count} lần`;
      const isError = lastError instanceof Error;
      const name = (typeof lastError?.getKind === "function" && lastError.getKind())
        || (isError && lastError.name) || "ScanError";
      const text = isError ? lastError.message : errorText(lastError);
      const e = namedError(name, text ? `${text} (${note})` : note);
      e.cause = lastError;
      throw e;
    }
  };
}
