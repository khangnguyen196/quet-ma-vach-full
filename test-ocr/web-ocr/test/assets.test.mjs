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
