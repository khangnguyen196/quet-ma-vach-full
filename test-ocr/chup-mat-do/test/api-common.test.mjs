import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvKey, bumpUsage, monthOf, redact } from "../api-common.mjs";
import { parseOcrSpace, geminiPrompt, parseGeminiJson, classifyGeminiError } from "../api-parse.mjs";

test("parseEnvKey: lấy tên đầu tiên có giá trị, bỏ comment và nháy", () => {
  const t = "# GEMINI_API_KEY=x\nOCR_SPACE_API_KEY='abc'\nGEMINI_API_KEY=\nOTHER=1";
  assert.deepEqual(parseEnvKey(t, ["OCRSPACE_API_KEY", "OCR_SPACE_API_KEY"]), { name: "OCR_SPACE_API_KEY", value: "abc" });
  assert.equal(parseEnvKey(t, ["GEMINI_API_KEY"]), null);
});

test("bumpUsage: giữ khóa cũ, cộng đúng dịch vụ / tháng", () => {
  const u = { upcitemdb: { "2026-11": 36 } };
  const a = bumpUsage(u, "gemini", "2026-11");
  assert.deepEqual(a, { upcitemdb: { "2026-11": 36 }, gemini: { "2026-11": 1 } });
  assert.equal(bumpUsage(a, "gemini", "2026-11").gemini["2026-11"], 2);
  assert.deepEqual(u, { upcitemdb: { "2026-11": 36 } }, "không sửa object gốc");
  assert.equal(monthOf(new Date(2026, 10, 8)), "2026-11");
});

test("redact: bỏ key khỏi chuỗi lỗi", () => {
  assert.equal(redact("lỗi ?key=SECRET123 x", "SECRET123"), "lỗi ?key=*** x");
});

test("parseOcrSpace: dòng + chiều cao khung từ TextOverlay", () => {
  const j = {
    OCRExitCode: 1, IsErroredOnProcessing: false,
    ParsedResults: [{ ParsedText: "OMACHI\r\nMì", TextOverlay: { Lines: [
      { LineText: "OMACHI", MaxHeight: 80, MinTop: 10, Words: [{ WordText: "OMACHI", Left: 5, Top: 10, Height: 80, Width: 200 }] },
      { LineText: "Mì", MaxHeight: 20, MinTop: 100, Words: [{ WordText: "Mì", Left: 5, Top: 100, Height: 20, Width: 30 }] },
    ] } }],
  };
  const r = parseOcrSpace(j);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines.map((l) => [l.text, l.h]), [["OMACHI", 80], ["Mì", 20]]);
  assert.deepEqual(r.lines[0].box, [5, 10, 205, 90]);
  const bad = parseOcrSpace({ OCRExitCode: 99, IsErroredOnProcessing: true, ErrorMessage: ["You may only perform this action upto maximum 500 number of times within 86400 seconds"] });
  assert.equal(bad.ok, false);
  assert.equal(bad.quota, true);
});

test("geminiPrompt: cố định, không gợi ý tên sản phẩm nào trong truth.csv", () => {
  const p = geminiPrompt();
  for (const w of ["omachi", "koreno", "vissan", "coca", "pillows", "oishi", "orion", "masan", "vinamilk"]) {
    assert.doesNotMatch(p.toLowerCase(), new RegExp(w));
  }
  assert.match(p, /thuong_hieu/);
  assert.match(p, /tu_khoa/);
});

test("parseGeminiJson: đọc JSON (có hoặc không có ```), thiếu trường thì null", () => {
  const r = parseGeminiJson({ candidates: [{ content: { parts: [{ text: '```json\n{"ten":"A","thuong_hieu":"B","loai":"mì","dung_tich_khoi_luong":"80 g","tu_khoa":["a","b"]}\n```' }] } }] });
  assert.deepEqual(r, { ten: "A", thuong_hieu: "B", loai: "mì", dung_tich_khoi_luong: "80 g", tu_khoa: ["a", "b"] });
  assert.equal(parseGeminiJson({ candidates: [] }), null);
  assert.equal(parseGeminiJson({ candidates: [{ content: { parts: [{ text: "không phải json" }] } }] }), null);
});

test("classifyGeminiError: 429 thường / hết hạn mức ngày / đòi thanh toán", () => {
  assert.equal(classifyGeminiError(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 10 per minute" } }), "rate");
  assert.equal(classifyGeminiError(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier" } }), "daily");
  assert.equal(classifyGeminiError(400, { error: { status: "FAILED_PRECONDITION", message: "User location is not supported" } }), "billing");
  assert.equal(classifyGeminiError(403, { error: { status: "PERMISSION_DENIED", message: "This API method requires billing to be enabled" } }), "billing");
  assert.equal(classifyGeminiError(500, { error: { status: "INTERNAL" } }), "other");
});
