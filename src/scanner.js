// Bọc html5-qrcode: bật/tắt camera, đọc mã từ ảnh.
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from "html5-qrcode";

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

    /** Đọc mã vạch từ 1 file ảnh (File từ input type=file). */
    async scanImage(file) {
      await this.stop();
      return scanner.scanFile(file, false);
    }
  };
}
