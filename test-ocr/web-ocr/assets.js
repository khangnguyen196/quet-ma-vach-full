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

  // Đợt ocr-mat vòng 3 (R1-trình-duyệt): đúng 2 file ONNX của R1 (gói PyPI rapidocr 3.10.0, nguồn chính thức RapidAI
  // trên ModelScope, ghim tag v3.10.0; sha256 trùng default_models.yaml của gói và ETag của ModelScope).
  // inference.yml (tên model + tiền xử lý + bộ ký tự) lấy từ ONNX chính thức của PaddlePaddle trên HuggingFace (ghim
  // mã commit): character_dict trùng hệt metadata "character" của file ONNX RapidOCR (18.708 ký tự). File ONNX của
  // HuggingFace khác sha256 nên không dùng. sha256 dưới là của file ONNX (file yml: ymlSha256).
  var R1_MODELS = {
    det: {
      name: "PP-OCRv6_small_det",
      repo: "PaddlePaddle/PP-OCRv6_small_det_onnx",
      rev: "28fe5895c24fd108c19eb3e8479f4ab385fbfc62",
      onnxUrl: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
      dir: "rapidocr-PP-OCRv6_small_det",
      sha256: "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
      ymlSha256: "193f435274bf9f0b5f71a929bbfbcf148282df7e633b34e7c373e8f44741b516",
    },
    rec: {
      name: "PP-OCRv6_small_rec",
      repo: "PaddlePaddle/PP-OCRv6_small_rec_onnx",
      rev: "b8f84f0b80c529de40b4fbb3544b84fa7233a513",
      onnxUrl: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
      dir: "rapidocr-PP-OCRv6_small_rec",
      sha256: "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
      ymlSha256: "ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1",
    },
  };
  MODEL_VARIANTS.det.r1 = R1_MODELS.det;
  MODEL_VARIANTS.rec.r1 = R1_MODELS.rec;

  // Tham số chạy của PaddleOCR.js (truyền vào PaddleOCR.create), chọn bằng tham số params; trống = mặc định SDK (như 1a).
  // r1: mặc định config.yaml của RapidOCR 3.10.0 (Det limit_side_len 736 kiểu min, thresh 0,3, box_thresh 0,5,
  // unclip_ratio 1,6; Global text_score 0,5). Không có cls (PaddleOCR.js không nạp được cls v2.0 của RapidOCR).
  var PARAM_PRESETS = {
    r1: {
      textDetLimitSideLen: 736,
      textDetLimitType: "min",
      textDetThresh: 0.3,
      textDetBoxThresh: 0.5,
      textDetUnclipRatio: 1.6,
      textRecScoreThresh: 0.5,
    },
  };

  /** Tham số chạy theo tên (trống = {} = mặc định SDK); tên lạ -> lỗi. */
  function pickParams(name) {
    if (!name) return {};
    var p = PARAM_PRESETS[name];
    if (!p) throw new Error("Không có bộ tham số params=" + name);
    return Object.assign({}, p);
  }

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
      if (mode === "cdn" && file === "inference.onnx" && m.onnxUrl) return m.onnxUrl; // r1: ONNX từ RapidAI (ModelScope)
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
      runtimeParams: pickParams(opts && opts.params),
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

  root.OcrAssets = { VERSIONS: VERSIONS, MODELS: MODELS, MODEL_VARIANTS: MODEL_VARIANTS, PARAM_PRESETS: PARAM_PRESETS, TESS_LANGS: TESS_LANGS, assetUrls: assetUrls };
})(globalThis);
