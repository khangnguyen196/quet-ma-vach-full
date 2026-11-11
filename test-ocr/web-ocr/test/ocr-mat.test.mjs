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

// ---------------- vòng 3: R1-trình-duyệt (chỉ THÊM, mặc định giữ nguyên) ----------------

test("R1: det / rec = r1 lấy ONNX của RapidOCR (ModelScope, cdn) + yml PaddlePaddle (HuggingFace, ghim commit)", () => {
  const c = assetUrls("cdn", { det: "r1", rec: "r1", params: "r1" });
  assert.equal(c.detName, "PP-OCRv6_small_det");
  assert.equal(c.recName, "PP-OCRv6_small_rec");
  assert.equal(c.detOnnx, "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx");
  assert.equal(c.recOnnx, "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx");
  assert.equal(c.detYml, "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.yml");
  assert.equal(c.recYml, "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.yml");
  const l = assetUrls("local", { det: "r1", rec: "r1" });
  assert.equal(l.detOnnx, "/cache/paddle-onnx/rapidocr-PP-OCRv6_small_det/inference.onnx");
  assert.equal(l.recYml, "/cache/paddle-onnx/rapidocr-PP-OCRv6_small_rec/inference.yml");
  assert.equal(MODEL_VARIANTS.det.r1.sha256, "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f");
  assert.equal(MODEL_VARIANTS.rec.r1.sha256, "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884");
});

test("params: trống = {} (mặc định SDK như 1a); r1 = tham số RapidOCR 3.10.0; tên lạ -> lỗi", () => {
  assert.deepEqual(assetUrls("local", {}).runtimeParams, {});
  assert.deepEqual(assetUrls("cdn", { det: "server" }).runtimeParams, {});
  assert.deepEqual(assetUrls("local", { params: "r1" }).runtimeParams, {
    textDetLimitSideLen: 736, textDetLimitType: "min", textDetThresh: 0.3, textDetBoxThresh: 0.5, textDetUnclipRatio: 1.6, textRecScoreThresh: 0.5,
  });
  assert.throws(() => assetUrls("local", { params: "r9" }), /params=r9/);
  // không sửa được bộ tham số gốc qua kết quả trả về
  assetUrls("local", { params: "r1" }).runtimeParams.textDetThresh = 9;
  assert.equal(globalThis.OcrAssets.PARAM_PRESETS.r1.textDetThresh, 0.3);
});

test("--params: cần --tag, chỉ paddlejs, giá trị lạ -> lỗi; harnessQuery nối params sau cùng", () => {
  assert.doesNotThrow(() => checkExtraOptions({ ...base, det: "r1", rec: "r1", params: "r1", tag: "r1" }));
  assert.throws(() => checkExtraOptions({ ...base, params: "r1" }), /--tag/);
  assert.throws(() => checkExtraOptions({ ...base, params: "x", tag: "x" }), /--params/);
  assert.throws(() => checkExtraOptions({ ...base, engine: "tesseractjs", params: "r1", tag: "x" }), /paddlejs/);
  assert.equal(harnessQuery({ ...base, det: "r1", rec: "r1", params: "r1" }), "engine=paddlejs&mode=local&join=rows&lines=1&det=r1&rec=r1&params=r1");
  assert.equal(harnessQuery({ ...base, params: "" }), "engine=paddlejs&mode=local&join=rows&lines=1");
});

test("harness.mjs trải runtimeParams vào PaddleOCR.create; harness.html truyền params", () => {
  const mjs = fs.readFileSync(new URL("../harness.mjs", import.meta.url), "utf8");
  assert.match(mjs, /\.\.\.\(A\.runtimeParams \|\| \{\}\)/);
  const html = fs.readFileSync(new URL("../harness.html", import.meta.url), "utf8");
  assert.match(html, /params: q\.get\("params"\) \|\| ""/);
});
