// Test đợt ocr-mat: tùy chọn THÊM của run-browser.mjs / assets.js (mặc định giữ nguyên như Phần D / E).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../assets.js";
import { taggedToolName, checkExtraOptions, harnessQuery, toolName } from "../lib.mjs";

const { assetUrls, MODELS, MODEL_VARIANTS } = globalThis.OcrAssets;
const base = { engine: "paddlejs", browser: "chromium", mode: "local", join: "rows", lines: true, det: "", rec: "", ort: "", channel: "", tag: "" };

test("taggedToolName: không tag -> đúng toolName cũ; có tag -> thêm hậu tố", () => {
  assert.equal(taggedToolName("paddlejs", "chromium", "rows"), toolName("paddlejs", "chromium", "rows"));
  assert.equal(taggedToolName("paddlejs", "chromium", "rows", "webgpu"), "paddlejs-rows-chromium-webgpu");
  assert.equal(taggedToolName("paddlejs", "webkit", "rows", "server-det-server-rec"), "paddlejs-rows-webkit-server-det-server-rec");
});

test("harnessQuery: mặc định đúng chuỗi cũ; tùy chọn thêm nối sau", () => {
  assert.equal(harnessQuery(base), "engine=paddlejs&mode=local&join=rows&lines=1");
  assert.equal(harnessQuery({ ...base, join: "", lines: false, engine: "tesseractjs" }), "engine=tesseractjs&mode=local");
  assert.equal(harnessQuery({ ...base, ort: "webgpu" }), "engine=paddlejs&mode=local&join=rows&lines=1&ort=webgpu");
  assert.equal(harnessQuery({ ...base, det: "server", rec: "server" }), "engine=paddlejs&mode=local&join=rows&lines=1&det=server&rec=server");
});

test("checkExtraOptions: giá trị lạ, sai engine / trình duyệt, thiếu --tag -> lỗi; mặc định không lỗi", () => {
  assert.doesNotThrow(() => checkExtraOptions(base));
  assert.doesNotThrow(() => checkExtraOptions({ ...base, det: "server", tag: "server-det" }));
  assert.doesNotThrow(() => checkExtraOptions({ ...base, ort: "webgpu", channel: "chrome", tag: "webgpu" }));
  assert.throws(() => checkExtraOptions({ ...base, det: "server" }), /--tag/);
  assert.throws(() => checkExtraOptions({ ...base, channel: "chrome" }), /--tag/);
  assert.throws(() => checkExtraOptions({ ...base, det: "big", tag: "x" }), /--det/);
  assert.throws(() => checkExtraOptions({ ...base, rec: "vi", tag: "x" }), /--rec/);
  assert.throws(() => checkExtraOptions({ ...base, ort: "gpu", tag: "x" }), /--ort/);
  assert.throws(() => checkExtraOptions({ ...base, engine: "tesseractjs", det: "server", tag: "x" }), /paddlejs/);
  assert.throws(() => checkExtraOptions({ ...base, browser: "webkit", channel: "chrome", tag: "x" }), /chromium/);
  assert.throws(() => checkExtraOptions({ ...base, det: "server", tag: "Server Det" }), /--tag/);
});

test("assetUrls: mặc định giữ model 1a; det / rec = server lấy repo server ghim mã commit", () => {
  const d = assetUrls("cdn", {});
  assert.equal(d.detName, "PP-OCRv5_mobile_det");
  assert.equal(d.recName, "latin_PP-OCRv5_mobile_rec");
  assert.equal(d.detOnnx, `https://huggingface.co/${MODELS.det.repo}/resolve/${MODELS.det.rev}/inference.onnx`);
  const s = assetUrls("cdn", { det: "server", rec: "server" });
  assert.equal(s.detName, "PP-OCRv5_server_det");
  assert.equal(s.recName, "PP-OCRv5_server_rec");
  assert.equal(s.detOnnx, "https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det_onnx/resolve/dcf248c4dcc064c6d030db241255f9e8fbc6733a/inference.onnx");
  assert.equal(s.recYml, "https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec_onnx/resolve/b70df217f4fd99d14f970bad092cebe7d74cc4d1/inference.yml");
  const b = assetUrls("local", { det: "server" });
  assert.equal(b.detOnnx, "/cache/paddle-onnx/PP-OCRv5_server_det_onnx/inference.onnx");
  assert.equal(b.recOnnx, "/cache/paddle-onnx/latin_PP-OCRv5_mobile_rec_onnx/inference.onnx");
  assert.throws(() => assetUrls("cdn", { det: "tiny" }), /det=tiny/);
  for (const kind of ["det", "rec"]) {
    for (const m of Object.values(MODEL_VARIANTS[kind])) {
      assert.match(m.rev, /^[0-9a-f]{40}$/);
      assert.match(m.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test("harness.mjs lấy tên model từ assets (detName / recName), harness.html truyền det / rec", () => {
  const mjs = fs.readFileSync(new URL("../harness.mjs", import.meta.url), "utf8");
  assert.match(mjs, /textDetectionModelName: A\.detName \|\| "PP-OCRv5_mobile_det"/);
  assert.match(mjs, /textRecognitionModelName: A\.recName \|\| "latin_PP-OCRv5_mobile_rec"/);
  const html = fs.readFileSync(new URL("../harness.html", import.meta.url), "utf8");
  assert.match(html, /det: q\.get\("det"\) \|\| ""/);
});
