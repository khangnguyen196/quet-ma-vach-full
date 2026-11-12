// Đợt thu-r1: bảng cấu hình các OCR của trang thử chup-mat-do.html + phần thuần (chọn theo ?ocr, nhận lỗi bộ nhớ).
// Module thuần cho trình duyệt (không import, không DOM). Test: test-ocr/chup-mat-do/test/trang-thu.test.mjs.
// URL + tên model + tham số: đúng test-ocr/web-ocr/assets.js chế độ cdn (1a = mặc định; R1 = det/rec/params "r1",
// như lần đo R1-trình-duyệt ở đợt ocr-mat). R1 không dùng mô hình xoay dòng của RapidOCR (PaddleOCR.js không nạp được).

/** Mỗi OCR: tên hiện, tên model det / rec của SDK, 4 file (onnx + yml), tham số trải vào PaddleOCR.create, giới hạn nạp. */
export const OCR_CONFIGS = {
  "1a": {
    key: "1a",
    label: "PaddleOCR.js mobile (1a, mặc định)",
    name: "PaddleOCR.js mobile (1a)",
    detName: "PP-OCRv5_mobile_det",
    recName: "latin_PP-OCRv5_mobile_rec",
    detOnnx: "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx",
    detYml: "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.yml",
    recOnnx: "https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/resolve/89d3a50e2c27e2e7cceeab0e944c25c807d5db4f/inference.onnx",
    recYml: "https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/resolve/89d3a50e2c27e2e7cceeab0e944c25c807d5db4f/inference.yml",
    params: {}, // mặc định SDK (như lúc đo 1a)
    loadTimeoutMs: 120000,
    sizeNote: "lần đầu ~18–20 MB",
  },
  r1: {
    key: "r1",
    label: "RapidOCR (R1, thử, tải thêm ~31 MB)",
    name: "RapidOCR PP-OCRv6 small (R1)",
    detName: "PP-OCRv6_small_det",
    recName: "PP-OCRv6_small_rec",
    // ONNX: RapidAI trên ModelScope, tag v3.10.0 (CORS kiểm thật từ github.io 12/11/2026); yml: PaddlePaddle trên HuggingFace
    detOnnx: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
    detYml: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.yml",
    recOnnx: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
    recYml: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.yml",
    // = PARAM_PRESETS.r1 của assets.js (mặc định config.yaml của RapidOCR 3.10.0)
    params: {
      textDetLimitSideLen: 736,
      textDetLimitType: "min",
      textDetThresh: 0.3,
      textDetBoxThresh: 0.5,
      textDetUnclipRatio: 1.6,
      textRecScoreThresh: 0.5,
    },
    loadTimeoutMs: 180000, // 31 MB model qua mạng điện thoại
    sizeNote: "thêm ~31 MB model",
  },
};

export const DEFAULT_OCR = "1a";

/** Chọn OCR theo chuỗi tìm của địa chỉ (location.search). Không có / trống -> 1a; giá trị lạ -> 1a, unknown = giá trị đó. */
export function pickOcr(search) {
  const raw = new URLSearchParams(search || "").get("ocr");
  if (raw == null || raw === "") return { key: DEFAULT_OCR, unknown: null };
  if (Object.prototype.hasOwnProperty.call(OCR_CONFIGS, raw)) return { key: raw, unknown: null };
  return { key: DEFAULT_OCR, unknown: raw };
}

/** Chuỗi tìm mới với ocr = key (giữ các tham số khác). */
export function ocrSearch(search, key) {
  const p = new URLSearchParams(search || "");
  p.set("ocr", key);
  return "?" + p.toString();
}

/** Lỗi có dấu hiệu thiếu bộ nhớ: RangeError, hoặc thông điệp có "alloc…", "out of memory", "OOM", "memory". */
export function isMemoryError(e) {
  if (e == null || e === "") return false;
  if (typeof RangeError !== "undefined" && e instanceof RangeError) return true;
  if (typeof e === "object" && e.name === "RangeError") return true;
  const text = typeof e === "object" ? String(e.message ?? "") + " " + String(e.name ?? "") : String(e);
  return /allocat|out of memory|\boom\b|memory/i.test(text);
}

/** Câu báo thiếu bộ nhớ (tiếng Việt). */
export function memoryMessage(key) {
  if (key === "r1") return "Máy không đủ bộ nhớ để chạy R1. Hãy chọn lại 1a (nhẹ hơn) hoặc đóng bớt tab rồi thử lại.";
  return "Máy không đủ bộ nhớ để chạy 1a. Hãy đóng bớt tab rồi thử lại.";
}
