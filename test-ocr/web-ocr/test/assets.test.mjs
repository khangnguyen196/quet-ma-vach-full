import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../assets.js"; // gán globalThis.OcrAssets

const { VERSIONS, assetUrls, MODELS } = globalThis.OcrAssets;
const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("phiên bản npm trong assets.js khớp package-lock.json", () => {
  for (const pkg of ["@paddleocr/paddleocr-js", "onnxruntime-web", "@techstark/opencv-js", "clipper-lib", "js-yaml", "tesseract.js", "tesseract.js-core"]) {
    assert.equal(lock.packages[`node_modules/${pkg}`]?.version, VERSIONS[pkg], pkg);
  }
});

test("mode cdn: jsDelivr bản cố định, model HuggingFace theo mã commit; mode local: node_modules + /cache", () => {
  const c = assetUrls("cdn", { webgpu: false });
  assert.equal(c.ort, "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.wasm.min.mjs");
  assert.equal(c.ortWasmDir, "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/");
  assert.equal(c.recOnnx, `https://huggingface.co/${MODELS.rec.repo}/resolve/${MODELS.rec.rev}/inference.onnx`);
  assert.equal(c.tessLangPath, null);
  assert.equal(assetUrls("cdn", { webgpu: true }).ort, "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.min.mjs");
  const l = assetUrls("local", {});
  assert.equal(l.paddleSdk, "/node_modules/@paddleocr/paddleocr-js/dist/index.mjs");
  assert.equal(l.detOnnx, "/cache/paddle-onnx/PP-OCRv5_mobile_det_onnx/inference.onnx");
  assert.equal(l.tessLangPath, "/cache/tessdata");
  // mọi URL CDN đều có bản cố định (@x.y.z) hoặc mã commit 40 ký tự
  for (const v of Object.values(c)) {
    if (typeof v === "string" && v.startsWith("http")) assert.match(v, /@\d|\/resolve\/[0-9a-f]{40}\//);
  }
});

/** URL dữ liệu ngôn ngữ mà tesseract.js THẬT SỰ tải khi trang đo dùng bộ đường dẫn `urls`:
 *  - có urls.tessLangs ([{ code, url }]): trang tự tải đúng các URL đó rồi đưa byte cho tesseract.js;
 *  - không thì tesseract.js tự ghép `<langPath>/<lang>.traineddata.gz`; langPath trống thì dùng đường mặc định
 *    của tesseract.js 7 với OEM 1 (LSTM): https://cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int
 *    (node_modules/tesseract.js/src/worker-script/index.js, hàm loadAndGunzipFile). */
function effectiveTessLangUrls(urls, langs) {
  if (Array.isArray(urls.tessLangs)) return urls.tessLangs.map((l) => l.url);
  return langs.split("+").map((lang) => {
    const base = urls.tessLangPath || `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int`;
    return `${base.replace(/\/$/, "")}/${lang}.traineddata.gz`;
  });
}

test("mode cdn: dữ liệu ngôn ngữ tesseract.js mà trang tải đều ghim bản @1.0.0 (vie, eng)", () => {
  // đường mặc định trong effectiveTessLangUrls đúng là đường của tesseract.js đang cài
  const worker = fs.readFileSync(new URL("../node_modules/tesseract.js/src/worker-script/index.js", import.meta.url), "utf8");
  assert.ok(worker.includes("https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int"));
  const got = effectiveTessLangUrls(assetUrls("cdn", {}), globalThis.OcrAssets.TESS_LANGS);
  assert.deepEqual(got, [
    "https://cdn.jsdelivr.net/npm/@tesseract.js-data/vie@1.0.0/4.0.0_best_int/vie.traineddata.gz",
    "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz",
  ]);
  for (const u of got) assert.match(u, /@1\.0\.0\//, u);
});
