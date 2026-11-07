// Bật/tắt camera và đọc mã từ ảnh. Cả 2 đọc bằng zxing-wasm trước, html5-qrcode dự phòng:
// - "Bật camera" (từ đợt nhay-hon): tự mở camera (getUserMedia) + <video>, mỗi ~120 ms cắt vùng giữa khung hình
//   ở độ phân giải thật của camera rồi giải mã bằng BarcodeDetector (nếu trình duyệt có) và zxing-wasm;
//   hình camera hiện ngay, chờ tải zxing-wasm sau (chữ "Đang tải bộ đọc mã…" trong khung);
//   không tải được zxing-wasm trong ZXING_LOAD_TIMEOUT_MS thì tắt camera tự mở, bật lại bằng html5-qrcode như cũ.
// - "Chụp ảnh mã": zxing-wasm trước, html5-qrcode dự phòng (đợt sua-cuoi).
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from "html5-qrcode";
import { errorText } from "./render.js";
import {
  pickCode, scanFailureText, isZxingTimeout, raceTimeout, ZXING_LOAD_TIMEOUT_MS, makeZxingTimeoutError
} from "./barcode.js";
import { cameraConstraints, cameraCrop, detectorCode, pickCameraCode, confirmCode, DETECTOR_FORMATS } from "./camera.js";

// "Bật camera" bằng zxing-wasm: nghỉ chừng này mili giây giữa 2 lượt giải mã (mỗi lượt chạy trên luồng chính,
// nghỉ để trang vẫn mượt trên điện thoại).
const FRAME_GAP_MS = 120;

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

/** Dừng mọi track của luồng camera (đèn camera tắt, trình duyệt thôi báo đang dùng camera). */
function stopTracks(stream) {
  for (const t of stream?.getTracks?.() || []) {
    try { t.stop(); } catch { /* đã dừng */ }
  }
}

/** BarcodeDetector có sẵn của trình duyệt (Chrome Android) nếu đọc được EAN-13; không có thì null. */
async function makeDetector() {
  if (typeof BarcodeDetector === "undefined") return null;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    if (!supported.includes("ean_13")) return null;
    return new BarcodeDetector({ formats: DETECTOR_FORMATS.filter((f) => supported.includes(f)) });
  } catch {
    return null;
  }
}

/**
 * Tải zxing-reader.js + file wasm cho "Bật camera", chờ tối đa ZXING_LOAD_TIMEOUT_MS (tính cả lúc tải file JS).
 * Trả module, hoặc ném lỗi (scanner bật camera bằng html5-qrcode). Hết giờ thì lần tải dở vẫn chạy tiếp.
 */
function loadCameraReader() {
  const load = import("./zxing-reader.js").then(async (mod) => { await mod.prepareReader(); return mod; });
  load.catch(() => {}); // lỗi xử lý ở nơi chờ; tránh "unhandled rejection" khi đã hết giờ
  return raceTimeout(load, ZXING_LOAD_TIMEOUT_MS, makeZxingTimeoutError);
}

export function createScanner(elementId) {
  const scanner = new Html5Qrcode(elementId, {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
    verbose: false,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  });
  let running = false;
  // Đếm lượt bật camera: tắt camera (hoặc bật lượt mới) thì tăng; lượt cũ đang chờ / đang giải mã thấy số khác
  // thì tự dừng, KHÔNG gọi onCode. Ví dụ: tắt camera đúng lúc zxing-wasm đang đọc 1 khung → kết quả bị bỏ.
  let session = 0;
  let mode = null; // "zxing" (tự giải mã) | "html5" (html5-qrcode) | null (đang tắt)
  let cam = null; // { stream, video, guide, wait, timer } khi mode === "zxing"

  /** Dọn camera tự mở: dừng vòng lặp, dừng mọi track, gỡ video (gọi lần 2 không sao: cam đã null). */
  function closeOwnCamera() {
    if (!cam) return;
    clearTimeout(cam.timer);
    stopTracks(cam.stream);
    try { cam.video.pause(); } catch { /* bỏ qua */ }
    cam.video.srcObject = null;
    cam.video.remove();
    cam.guide.remove();
    cam.wait.remove();
    cam = null;
  }

  /** Bật camera bằng html5-qrcode (cách cũ, dùng khi không có zxing-wasm). */
  async function startHtml5(onCode, my) {
    await scanner.start(
      { facingMode: "environment" }, // html5-qrcode bỏ qua tham số này khi có videoConstraints (camera sau nằm trong đó)
      {
        // fps 15 (trước là 10): đo 07/11/2026 (nhay-hon) cùng tỷ lệ ra mã, trung vị thời gian ra mã giảm 38%.
        fps: 15,
        aspectRatio: 4 / 3,
        videoConstraints: cameraConstraints(),
        qrbox: (w, h) => ({ width: Math.min(Math.round(w * 0.82), 340), height: Math.min(Math.round(h * 0.45), 170) })
      },
      (text) => { if (my === session) onCode(text); },
      () => {} // mỗi khung hình chưa thấy mã thì bỏ qua
    );
    if (my !== session) { // đã tắt trong lúc đang mở
      try { await scanner.stop(); } catch { /* đã dừng */ }
      return;
    }
    mode = "html5";
    running = true;
  }

  /**
   * Vòng giải mã khung hình camera tự mở (BarcodeDetector trước nếu có, rồi zxing-wasm).
   * BarcodeDetector ném lỗi (vd Chrome Android báo hỗ trợ ean_13 mà detect() ném "Barcode detection service
   * unavailable") thì bỏ hẳn nó, đọc bằng zxing-wasm ngay trong khung đó và các khung sau.
   */
  async function decodeLoop(onCode, my, mod) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let detector = await makeDetector();
    let warned = false;
    let pending = null; // mã 8 số đang chờ đọc lần 2 ({ code, at, frame }, confirmCode)
    // Số khung đã cắt + giải mã (kể cả khung không ra mã); lượt bỏ qua vì video chưa sẵn sàng thì không tăng.
    let frame = 0;
    const tick = async () => {
      if (my !== session || !cam) return;
      const { video } = cam;
      let code = null;
      try {
        const r = video.readyState >= 2
          ? cameraCrop(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight) : null;
        if (r) {
          frame++;
          if (canvas.width !== r.dw || canvas.height !== r.dh) { canvas.width = r.dw; canvas.height = r.dh; }
          ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, r.dw, r.dh);
          if (detector) {
            try {
              code = detectorCode(await detector.detect(canvas));
            } catch (e) {
              console.warn("BarcodeDetector lỗi, từ giờ chỉ đọc bằng zxing-wasm:", e);
              detector = null; // không gọi lại (lỗi kiểu này thường lặp ở mọi khung)
            }
          }
          // Không có mã, hoặc BarcodeDetector chỉ ra mã 8 số (có thể là mảnh của mã dài): vẫn đọc bằng zxing-wasm;
          // zxing-wasm ra mã dài hơn thì lấy, không thì giữ mã 8 số cho confirmCode.
          if ((!code || code.length === 8) && my === session) {
            const z = pickCameraCode(await mod.readCameraCodes(ctx.getImageData(0, 0, r.dw, r.dh)));
            if (z && (!code || z.length > code.length)) code = z;
          }
        }
      } catch (e) {
        if (!warned) { console.warn("Lỗi khi giải mã khung hình camera:", e); warned = true; }
      }
      if (my !== session || !cam) return; // đã tắt trong lúc giải mã: bỏ kết quả, không gọi onCode
      // mã 8 số phải đọc ra lần nữa trong CONFIRM_WINDOW_MS (1 giây) hoặc ở khung ngay sau mới nhận (tránh mảnh đọc nhầm)
      const c = confirmCode(pending, code, performance.now(), frame);
      pending = c.state;
      if (c.accept) { onCode(c.accept); return; }
      cam.timer = setTimeout(tick, FRAME_GAP_MS);
    };
    if (my === session && cam) tick();
  }

  return {
    get running() { return running; },

    /**
     * Bật camera sau; gọi onCode(text) khi đọc được mã. Ném lỗi nếu không mở được camera.
     * Tải zxing-wasm cùng lúc với mở camera; hình camera hiện ngay (chữ "Đang tải bộ đọc mã…" trong lúc chờ wasm).
     * Không có zxing-wasm (mất mạng, hết giờ) thì tắt camera tự mở và bật lại bằng html5-qrcode.
     * Chỉ trả về khi đã biết dùng đường nào (main.js khóa nút tới lúc đó).
     */
    async start(onCode) {
      if (running) return;
      const my = ++session;
      const el = document.getElementById(elementId);
      if (!navigator.mediaDevices?.getUserMedia || !el) return startHtml5(onCode, my);
      const reader = loadCameraReader();
      reader.catch(() => {}); // lỗi xử lý bên dưới (kể cả khi getUserMedia ném trước)
      const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(), audio: false });
      if (my !== session) { stopTracks(stream); return; }
      // Hiện hình ngay (lý do: code-reviewer nhay-hon vòng 1: chờ wasm trước thì mạng chậm thấy khung đen tới 10 giây
      // trong khi đèn camera đã sáng; bản html5-qrcode cũ hiện hình ngay).
      const video = document.createElement("video");
      video.setAttribute("playsinline", ""); // iPhone: phát ngay trong trang, không bật toàn màn hình
      video.setAttribute("muted", "");
      video.muted = true;
      video.autoplay = true;
      video.srcObject = stream;
      const guide = document.createElement("div");
      guide.className = "scan-guide"; // khung vẽ đúng vùng giải mã (cameraCrop: 92% × 60% giữa khung)
      guide.setAttribute("aria-hidden", "true");
      const wait = document.createElement("p");
      wait.className = "scan-wait";
      wait.setAttribute("role", "status");
      wait.textContent = "Đang tải bộ đọc mã…";
      el.replaceChildren(video, guide, wait);
      cam = { stream, video, guide, wait, timer: 0 };
      mode = "zxing";
      running = true;
      try {
        await video.play();
      } catch (e) {
        // Tắt ngay sau khi bật: play() bị ngắt (AbortError), không phải lỗi.
        if (my !== session) return;
        if (e?.name !== "AbortError") { closeOwnCamera(); running = false; mode = null; throw e; }
      }
      if (my !== session) return;
      let mod;
      try {
        mod = await reader;
      } catch (e) {
        // Đã tắt trong lúc chờ: stop() đã dọn camera (mode "zxing"), không dọn lần 2, không bật html5-qrcode.
        if (my !== session) return;
        console.warn("Không có zxing-wasm cho camera, dùng html5-qrcode:", e);
        closeOwnCamera(); // trả camera trước khi html5-qrcode xin lại
        running = false;
        mode = null;
        return startHtml5(onCode, my);
      }
      if (my !== session || !cam) return;
      cam.wait.remove(); // đã có bộ đọc: gỡ chữ chờ
      decodeLoop(onCode, my, mod);
    },

    async stop() {
      session++; // lượt đang chạy (đang mở camera / đang giải mã) không gọi onCode nữa
      if (!running) return;
      if (mode === "zxing") closeOwnCamera();
      else {
        try { await scanner.stop(); } catch { /* đã dừng */ }
      }
      running = false;
      mode = null;
    },

    /** Khả năng + cài đặt của camera đang chạy ({ caps, settings }; null nếu không đọc được) cho nút đèn / phóng to. */
    trackInfo() {
      try {
        if (mode === "zxing" && cam) {
          const t = cam.stream.getVideoTracks()[0];
          return { caps: t?.getCapabilities?.() ?? null, settings: t?.getSettings?.() ?? null };
        }
        if (mode === "html5") {
          return { caps: scanner.getRunningTrackCapabilities(), settings: scanner.getRunningTrackSettings() };
        }
      } catch { /* trình duyệt không có getCapabilities (Safari cũ) */ }
      return { caps: null, settings: null };
    },

    /** Đổi 1 cài đặt của camera đang chạy, ví dụ { torch: true } hoặc { zoom: 2 }. Ném lỗi nếu máy không nhận. */
    async applyTrack(setting) {
      if (mode === "zxing" && cam) return cam.stream.getVideoTracks()[0].applyConstraints({ advanced: [setting] });
      if (mode === "html5") return scanner.applyVideoConstraints({ advanced: [setting] });
      throw new Error("Camera chưa bật");
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
        // Hết giờ tải wasm: zxing-reader.js ném lỗi của makeZxingTimeoutError() (ZxingLoadError có cờ timeout).
        if (isZxingTimeout(e)) zxing = { status: "timeout" };
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
