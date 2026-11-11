// Trang đo chạy TRONG trình duyệt. run-browser.mjs (Playwright) gọi:
//   await harness.init()          -> nạp thư viện + model, trả số giây nạp, backend, tính năng trình duyệt
//   await harness.run(url)        -> đọc 1 ảnh, trả { text, seconds, ... }
// Tham số và đường dẫn do harness.html đặt sẵn ở window.__OCR_PARAMS / window.__OCR_ASSETS.
import { orderLines, rowLines, rowLineInfo, tessLineInfo, makeTar, tessLangObjects } from "./lib.mjs";

const P = window.__OCR_PARAMS;
const A = window.__OCR_ASSETS;
const MAX_SIDE = 1600; // giống run_ocr.py: thu cạnh dài về 1600 px

let engine = null; // { recognize(canvas) -> text, info }

/** Phép thử tính năng nhỏ, để phân biệt "bản WebKit Windows thiếu tính năng" với "lỗi của công cụ". */
function features() {
  // module wasm nhỏ nhất có lệnh SIMD (giống wasm-feature-detect)
  const simdBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  let simd = false;
  try { simd = WebAssembly.validate(simdBytes); } catch { simd = false; }
  return {
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    wasm: typeof WebAssembly === "object",
    wasmSimd: simd,
    webgpuApi: !!navigator.gpu,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    devicePixelRatio: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Tải ${url} lỗi HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Đọc ảnh như trình duyệt hiển thị (đã xoay theo EXIF), thu cạnh dài về 1600 px (chỉ thu nhỏ), vẽ ra canvas. */
async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, cw, ch);
  return { canvas, width: cw, height: ch, srcWidth: w, srcHeight: h };
}

async function initPaddle() {
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
  // SDK chỉ nhận model dạng 1 file .tar (inference.onnx + inference.yml). HuggingFace có 2 file rời,
  // nên fetch riêng của SDK tải 2 file rồi gói thành tar ngay trong trình duyệt.
  const tarFetch = async (url) => {
    if (url === "tar:det" || url === "tar:rec") {
      const k = url.slice(4);
      const [onnx, yml] = await Promise.all([fetchBytes(A[`${k}Onnx`]), fetchBytes(A[`${k}Yml`])]);
      return new Response(makeTar([{ name: "inference.onnx", data: onnx }, { name: "inference.yml", data: yml }]));
    }
    return fetch(url);
  };
  const ocr = await PaddleOCR.create({
    // tên model theo assets.js (mặc định PP-OCRv5_mobile_det + latin_PP-OCRv5_mobile_rec như 1a; det / rec đổi được)
    textDetectionModelName: A.detName || "PP-OCRv5_mobile_det",
    textDetectionModelAsset: { url: "tar:det" },
    textRecognitionModelName: A.recName || "latin_PP-OCRv5_mobile_rec",
    textRecognitionModelAsset: { url: "tar:rec" },
    ortOptions: {
      // WebGPU chỉ khi harness.html dò thấy (navigator.gpu + requestAdapter() thành công); "auto" của SDK
      // thử webgpu rồi lùi về wasm. Không thấy WebGPU thì ép wasm.
      backend: P.ort === "webgpu" ? "auto" : "wasm",
      wasmPaths: A.ortWasmDir,
      numThreads: 1, // không cross-origin isolation -> wasm 1 luồng
      proxy: false,
    },
    fetch: tarFetch,
    // params=r1 (vòng 3): tham số dò khung / ngưỡng chữ bám RapidOCR (assets.js PARAM_PRESETS); trống = {} = mặc định SDK
    ...(A.runtimeParams || {}),
  });
  const summary = ocr.getInitializationSummary();
  return {
    info: {
      backend: summary && summary.detProvider === summary.recProvider ? summary.detProvider : `${summary?.detProvider}/${summary?.recProvider}`,
      requestedBackend: summary?.backend,
      webgpuAvailable: summary?.webgpuAvailable,
      gpuReason: P.gpuReason,
      ortBuild: A.ort.split("/").pop(),
      detModel: A.detName,
      recModel: A.recName,
      runtimeParams: A.runtimeParams,
      modelBytes: summary?.assets?.map((a) => a.bytes),
    },
    async recognize(canvas) {
      const [res] = await ocr.predict(canvas);
      // join=rows (cách chính từ vòng 2, công cụ paddlejs-rows-*): khung cùng hàng nối thành 1 dòng;
      // không join: mỗi khung 1 dòng (paddlejs-chromium / -webkit, giữ để so)
      const lines = P.join === "rows" ? rowLines(res.items) : orderLines(res.items);
      // lines=1 (đợt chup-mat-do): trả thêm từng hàng kèm chiều cao chữ + độ tin
      const info = P.lines ? rowLineInfo(res.items) : undefined;
      return { text: lines.join("\n"), boxes: res.items.length, metrics: res.metrics, lines: info };
    },
  };
}

async function initTesseract() {
  const mod = await import(A.tesseract);
  const Tesseract = mod.default || mod;
  const opts = { workerPath: A.tesseractWorker, corePath: A.tesseractCore };
  let langs = window.OcrAssets.TESS_LANGS;
  if (A.tessLangs) {
    // cdn: tự tải dữ liệu ngôn ngữ đã ghim bản (@1.0.0), đưa byte cho tesseract.js
    const datas = await Promise.all(A.tessLangs.map((l) => fetchBytes(l.url)));
    langs = tessLangObjects(A.tessLangs.map((l, i) => ({ code: l.code, data: datas[i] })));
  } else if (A.tessLangPath) {
    opts.langPath = A.tessLangPath;
  }
  const worker = await Tesseract.createWorker(langs, 1, opts); // OEM 1 = LSTM
  // PSM 3 (tự chia trang) giống lệnh tesseract / pytesseract mặc định trong run_ocr.py
  await worker.setParameters({ tessedit_pageseg_mode: "3" });
  return {
    info: { backend: "wasm (tesseract.js-core)", langs: window.OcrAssets.TESS_LANGS, psm: 3 },
    async recognize(canvas) {
      // lines=1 (đợt chup-mat-do): xin thêm blocks để có khung + độ tin từng dòng (chữ text giữ nguyên)
      const { data } = P.lines ? await worker.recognize(canvas, {}, { text: true, blocks: true }) : await worker.recognize(canvas);
      return { text: data.text || "", lines: P.lines ? tessLineInfo(data.blocks) : undefined };
    },
  };
}

window.harness = {
  features,
  async init() {
    const t0 = performance.now();
    engine = P.engine === "tesseractjs" ? await initTesseract() : await initPaddle();
    return { loadSeconds: (performance.now() - t0) / 1000, ...engine.info, params: P, features: features() };
  },
  async run(url) {
    if (!engine) throw new Error("chưa init");
    const tPre = performance.now();
    const img = await loadImage(url);
    const t0 = performance.now();
    const r = await engine.recognize(img.canvas);
    const seconds = (performance.now() - t0) / 1000;
    img.canvas.width = 0; // trả bộ nhớ canvas sớm
    return {
      text: r.text,
      seconds,
      prepSeconds: (t0 - tPre) / 1000,
      width: img.width,
      height: img.height,
      srcWidth: img.srcWidth,
      srcHeight: img.srcHeight,
      boxes: r.boxes ?? null,
      lines: r.lines,
    };
  },
};
window.harnessReady = true;
document.getElementById("status").textContent = `Sẵn sàng: ${P.engine} (${P.mode}${P.ort ? ", ort=" + P.ort : ""})`;
