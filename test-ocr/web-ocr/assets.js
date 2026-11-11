// Phiên bản cố định + đường dẫn mọi file thư viện / model mà trang đo tải.
// File này viết dạng script thường (không import / export) để dùng được cả bằng <script src> (trước khi
// có import map) lẫn bằng import trong Node (test): nó chỉ gán globalThis.OcrAssets.
// Phiên bản npm phải khớp package-lock.json (test/assets.test.mjs kiểm).
(function (root) {
  "use strict";
  var VERSIONS = {
    "@paddleocr/paddleocr-js": "0.4.2",
    "onnxruntime-web": "1.24.3",
    "@techstark/opencv-js": "4.10.0-release.1",
    "clipper-lib": "6.4.2",
    "js-yaml": "4.3.2",
    "tesseract.js": "7.0.0",
    "tesseract.js-core": "7.0.0",
    "@tesseract.js-data/vie": "1.0.0",
    "@tesseract.js-data/eng": "1.0.0",
  };

  // Model ONNX chính thức của PaddlePaddle trên HuggingFace, cố định theo mã commit.
  // Bản tải về máy để chạy 96 ảnh nằm ở D:\cache\paddle-onnx\<thư mục>\ (serve.mjs phục vụ ở /cache/paddle-onnx/).
  var MODELS = {
    det: {
      name: "PP-OCRv5_mobile_det",
      repo: "PaddlePaddle/PP-OCRv5_mobile_det_onnx",
      rev: "e6f4fa85f00e168c862bc462aebca69eef9b3d3d",
      dir: "PP-OCRv5_mobile_det_onnx",
      sha256: "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d",
    },
    rec: {
      name: "latin_PP-OCRv5_mobile_rec",
      repo: "PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx",
      rev: "89d3a50e2c27e2e7cceeab0e944c25c807d5db4f",
      dir: "latin_PP-OCRv5_mobile_rec_onnx",
      sha256: "7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498",
    },
  };

  // Đợt ocr-mat (2a): model khác để đo, chọn bằng tham số det / rec (mặc định = MODELS ở trên, số cũ giữ nguyên).
  // PP-OCRv5 server (ONNX chính thức của PaddlePaddle trên HuggingFace, Apache-2.0), ghim mã commit; sha256 theo
  // HuggingFace API (lfs.sha256, 11/11/2026). server_rec là bộ chữ Trung / Anh (18.383 ký tự, thiếu 48/67 chữ thường
  // có dấu tiếng Việt).
  var MODEL_VARIANTS = {
    det: {
      mobile: MODELS.det,
      server: {
        name: "PP-OCRv5_server_det",
        repo: "PaddlePaddle/PP-OCRv5_server_det_onnx",
        rev: "dcf248c4dcc064c6d030db241255f9e8fbc6733a",
        dir: "PP-OCRv5_server_det_onnx",
        sha256: "10803475a591f7dc623e24670fb5752ec94d39a1f8cf069aac1b6f0ce19cfc85",
      },
    },
    rec: {
      latin: MODELS.rec,
      server: {
        name: "PP-OCRv5_server_rec",
        repo: "PaddlePaddle/PP-OCRv5_server_rec_onnx",
        rev: "b70df217f4fd99d14f970bad092cebe7d74cc4d1",
        dir: "PP-OCRv5_server_rec_onnx",
        sha256: "d9dc333c9c7b042c6dffb8e33d72b6f65c9c1d463d0a3c2f78174fea55e94752",
      },
    },
  };

  /** Model theo tên biến thể (det: mobile | server; rec: latin | server); trống = mặc định; tên lạ -> lỗi. */
  function pickModel(kind, variant) {
    if (!variant) return MODELS[kind];
    var m = MODEL_VARIANTS[kind][variant];
    if (!m) throw new Error("Không có model " + kind + "=" + variant);
    return m;
  }

  // Ngôn ngữ tesseract.js: vie+eng giống run_ocr.py (Tesseract Python) để so cùng điều kiện.
  var TESS_LANGS = "vie+eng";

  /** mode "local": file từ node_modules + D:\cache qua serve.mjs (chạy 96 ảnh, không tải lại từ mạng).
   *  mode "cdn": đúng các file trên jsDelivr / HuggingFace (đo byte tải lần đầu, giống trang thử sẽ dùng).
   *  webgpu: true thì dùng bản onnxruntime-web có WebGPU (ort.min.mjs, wasm JSEP lớn hơn); false thì bản chỉ wasm. */
  function assetUrls(mode, opts) {
    var webgpu = !!(opts && opts.webgpu);
    var det = pickModel("det", opts && opts.det);
    var rec = pickModel("rec", opts && opts.rec);
    var npm = function (pkg, path) {
      return mode === "cdn"
        ? "https://cdn.jsdelivr.net/npm/" + pkg + "@" + VERSIONS[pkg] + "/" + path
        : "/node_modules/" + pkg + "/" + path;
    };
    var model = function (m, file) {
      return mode === "cdn"
        ? "https://huggingface.co/" + m.repo + "/resolve/" + m.rev + "/" + file
        : "/cache/paddle-onnx/" + m.dir + "/" + file;
    };
    var ortFile = webgpu ? "dist/ort.min.mjs" : "dist/ort.wasm.min.mjs";
    return {
      mode: mode,
      paddleSdk: npm("@paddleocr/paddleocr-js", "dist/index.mjs"),
      ort: npm("onnxruntime-web", ortFile),
      ortWasmDir: npm("onnxruntime-web", "dist/"),
      opencv: npm("@techstark/opencv-js", "dist/opencv.js"),
      clipper: npm("clipper-lib", "clipper.js"),
      jsYaml: npm("js-yaml", "dist/js-yaml.mjs"),
      detName: det.name,
      recName: rec.name,
      detOnnx: model(det, "inference.onnx"),
      detYml: model(det, "inference.yml"),
      recOnnx: model(rec, "inference.onnx"),
      recYml: model(rec, "inference.yml"),
      tesseract: npm("tesseract.js", "dist/tesseract.esm.min.js"),
      tesseractWorker: npm("tesseract.js", "dist/worker.min.js"),
      tesseractCore: mode === "cdn"
        ? "https://cdn.jsdelivr.net/npm/tesseract.js-core@" + VERSIONS["tesseract.js-core"]
        : "/node_modules/tesseract.js-core",
      // Dữ liệu ngôn ngữ tesseract.js (vie, eng ở 2 gói npm khác nhau).
      // local: langPath = D:\cache\web-ocr\tessdata (tesseract.js nối "/<lang>.traineddata.gz"; 2 file chép từ
      //   jsDelivr @1.0.0, sha256 giống hệt).
      // cdn: KHÔNG dùng langPath: một đường dẫn chung cho mọi ngôn ngữ thì không ghim được bản cho 2 gói, còn để
      //   trống thì tesseract.js tự lấy @tesseract.js-data/<lang>/4.0.0_best_int (bản mới nhất). Trang tự tải từng
      //   file ở tessLangs (ghim @1.0.0) rồi đưa byte cho createWorker (xem tessLangObjects trong lib.mjs).
      tessLangPath: mode === "cdn" ? null : "/cache/tessdata",
      tessLangs: mode === "cdn"
        ? TESS_LANGS.split("+").map(function (code) {
          var pkg = "@tesseract.js-data/" + code;
          return { code: code, url: "https://cdn.jsdelivr.net/npm/" + pkg + "@" + VERSIONS[pkg] + "/4.0.0_best_int/" + code + ".traineddata.gz" };
        })
        : null,
    };
  }

  root.OcrAssets = { VERSIONS: VERSIONS, MODELS: MODELS, MODEL_VARIANTS: MODEL_VARIANTS, TESS_LANGS: TESS_LANGS, assetUrls: assetUrls };
})(globalThis);
