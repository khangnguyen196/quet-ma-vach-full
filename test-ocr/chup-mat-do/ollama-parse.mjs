// Phần thuần (không mạng) của 4b Ollama: dựng body /api/generate theo CHỐT vòng 5, đọc câu trả lời như 4a,
// câu tìm T1, chấm (rankOf mẫu số 30, đúng tên / thương hiệu bằng textMatch như 4a).
import { parseGeminiJson } from "./api-parse.mjs";
import { t1QueryFromGemini, t1QueryFromLines, bm25Search } from "./vn-data.mjs";
import { rankOf, textMatch, median } from "./lib.mjs";

/** Body /api/generate: 1 ảnh (base64), format "json" (bỏ khi json = false: model không theo), temperature 0, seed 0,
 *  num_ctx 4096, stream false. keep_alive giữ model trong bộ nhớ giữa các ảnh (không ảnh hưởng câu trả lời). */
export function ollamaBody(model, prompt, imageB64, { json = true, keepAlive = "30m" } = {}) {
  const b = { model, prompt, images: [imageB64], stream: false, options: { temperature: 0, seed: 0, num_ctx: 4096 }, keep_alive: keepAlive };
  if (json) b.format = "json";
  return b;
}

/** Chuỗi trả lời -> object như parseGeminiJson (ten, thuong_hieu, loai, dung_tich_khoi_luong, tu_khoa); hỏng -> null. */
export function parseOllamaText(text) {
  if (!text) return null;
  return parseGeminiJson({ candidates: [{ content: { parts: [{ text: String(text) }] } }] });
}

/** Câu tìm T1: JSON đọc được -> t1QueryFromGemini (như 4a); JSON hỏng -> mọi từ của chuỗi (bỏ số / đơn vị như S2). */
export function ollamaQuery(text) {
  const parsed = parseOllamaText(text);
  if (parsed) return t1QueryFromGemini(parsed);
  return t1QueryFromLines([{ text: String(text ?? "") }]);
}

/** Chấm một ảnh: T1 BM25 top5 -> rankOf; đúng tên / thương hiệu = textMatch(trường model đọc, đáp án) như 4a
 *  (JSON hỏng -> null: không chấm được). */
export function scoreOllama(text, truth, index) {
  const parsed = parseOllamaText(text);
  const q = ollamaQuery(text);
  const hits = q.length ? bm25Search(index, q, 5) : [];
  const top5 = hits.map((h) => h.code);
  const rank = rankOf(top5, truth.code);
  return {
    parsedOk: parsed != null, parsed, query: q.join(" "), queryWords: q.length, top5,
    scores: hits.map((h) => +h.score.toFixed(3)), rank, top1: rank === 1, inTop5: rank != null,
    nameOk: parsed ? textMatch(parsed.ten, truth.ten) : null,
    brandOk: parsed ? textMatch(parsed.thuong_hieu, truth.thuong_hieu) : null,
  };
}

/** Luật dừng P3: sau 10 ảnh, trung vị giây/ảnh > 180 -> dừng ở 10. */
export function shouldStopSlow(seconds) {
  return seconds.length >= 10 && median(seconds) > 180;
}
