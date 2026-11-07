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

  // Ngôn ngữ tesseract.js: vie+eng giống run_ocr.py (Tesseract Python) để so cùng điều kiện.
  var TESS_LANGS = "vie+eng";

  /** mode "local": file từ node_modules + D:\cache qua serve.mjs (chạy 96 ảnh, không tải lại từ mạng).
   *  mode "cdn": đúng các file trên jsDelivr / HuggingFace (đo byte tải lần đầu, giống trang thử sẽ dùng).
   *  webgpu: true thì dùng bản onnxruntime-web có WebGPU (ort.min.mjs, wasm JSEP lớn hơn); false thì bản chỉ wasm. */
  function assetUrls(mode, opts) {
    var webgpu = !!(opts && opts.webgpu);
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
      detOnnx: model(MODELS.det, "inference.onnx"),
      detYml: model(MODELS.det, "inference.yml"),
      recOnnx: model(MODELS.rec, "inference.onnx"),
      recYml: model(MODELS.rec, "inference.yml"),
      tesseract: npm("tesseract.js", "dist/tesseract.esm.min.js"),
      tesseractWorker: npm("tesseract.js", "dist/worker.min.js"),
      tesseractCore: mode === "cdn"
        ? "https://cdn.jsdelivr.net/npm/tesseract.js-core@" + VERSIONS["tesseract.js-core"]
        : "/node_modules/tesseract.js-core",
      // tesseract.js nối thêm "/<lang>.traineddata.gz" vào langPath (một đường dẫn cho mọi ngôn ngữ).
      // cdn: để trống -> tesseract.js tự lấy https://cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int
      // (vie và eng ở 2 gói khác nhau nên không cố định được bản; hiện là 1.0.0 = VERSIONS ở trên).
      // local: D:\cache\web-ocr\tessdata (chép đúng 2 file đó từ jsDelivr @1.0.0).
      tessLangPath: mode === "cdn" ? null : "/cache/tessdata",
    };
  }

  root.OcrAssets = { VERSIONS: VERSIONS, MODELS: MODELS, TESS_LANGS: TESS_LANGS, assetUrls: assetUrls };
})(globalThis);
