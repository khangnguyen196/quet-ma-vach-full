// Test vòng 5 (không gọi mạng): phần thuần của 4b Ollama (dựng body request, câu trả lời -> câu tìm T1, chấm).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ollamaBody, parseOllamaText, ollamaQuery, scoreOllama, shouldStopSlow } from "../ollama-parse.mjs";
import { buildBm25 } from "../vn-data.mjs";
import { geminiPrompt } from "../api-parse.mjs";

test("ollamaBody: đúng CHỐT (format json, temperature 0, seed 0, num_ctx 4096, stream false, 1 ảnh)", () => {
  const b = ollamaBody("qwen2.5vl:3b", geminiPrompt(), "QUJD");
  assert.equal(b.model, "qwen2.5vl:3b");
  assert.equal(b.prompt, geminiPrompt());
  assert.deepEqual(b.images, ["QUJD"]);
  assert.equal(b.format, "json");
  assert.equal(b.stream, false);
  assert.deepEqual(b.options, { temperature: 0, seed: 0, num_ctx: 4096 });
  assert.equal("format" in ollamaBody("moondream", "p", "x", { json: false }), false);
});

test("parseOllamaText: chuỗi JSON (có / không có ```), JSON hỏng -> null", () => {
  const p = parseOllamaText('```json\n{"ten": "Mì Omachi", "thuong_hieu": "Omachi", "tu_khoa": ["mì", " "]}\n```');
  assert.equal(p.ten, "Mì Omachi");
  assert.equal(p.thuong_hieu, "Omachi");
  assert.deepEqual(p.tu_khoa, ["mì"]);
  assert.equal(parseOllamaText('{"ten": "Mì'), null);
  assert.equal(parseOllamaText(""), null);
});

test("ollamaQuery: JSON tốt -> [thương hiệu, tên, từ khóa]; JSON hỏng -> mọi từ của chuỗi (bỏ số / đơn vị)", () => {
  assert.deepEqual(ollamaQuery('{"ten": "Mì khoai tây", "thuong_hieu": "Omachi", "tu_khoa": []}'), ["omachi", "mi", "khoai", "tay"]);
  assert.deepEqual(ollamaQuery('{"ten": "Omachi mì 80g'), ["ten", "omachi", "mi"]);
});

test("scoreOllama: T1 trên danh mục + đúng tên / thương hiệu (textMatch như 4a)", () => {
  const index = buildBm25([{ code: "1", text: "Omachi mì khoai tây xốt bò hầm" }, { code: "2", text: "Hảo Hảo tôm chua cay" }]);
  const truth = { code: "1", ten: "Mì khoai tây Omachi xốt Bò hầm", thuong_hieu: "Omachi" };
  const s = scoreOllama('{"ten": "Mì khoai tây Omachi xốt bò hầm", "thuong_hieu": "Omachi", "tu_khoa": []}', truth, index);
  assert.equal(s.parsedOk, true);
  assert.equal(s.rank, 1);
  assert.equal(s.top1, true);
  assert.equal(s.nameOk, true);
  assert.equal(s.brandOk, true);
  const bad = scoreOllama("", truth, index);
  assert.equal(bad.inTop5, false);
  assert.equal(bad.parsedOk, false);
  assert.equal(bad.nameOk, null);
});

test("shouldStopSlow: dừng ở 10 ảnh khi trung vị > 180 giây", () => {
  assert.equal(shouldStopSlow(Array(9).fill(200)), false);
  assert.equal(shouldStopSlow(Array(10).fill(200)), true);
  assert.equal(shouldStopSlow([...Array(6).fill(100), ...Array(4).fill(300)]), false);
});
