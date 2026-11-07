// Cách 3 (vòng 4): AI nhỏ trong trình duyệt qua transformers.js. Dùng chung cho trang đo (do-cach3.mjs nạp file này
// trong trình duyệt) và phần chấm ở Node. Không DOM, không gọi mạng ở phần thuần.
// CHỐT trước khi chạy (đầu D:\tmp\chup-mat-do\ket-qua\tong-hop-v4.md):
//   F = Florence-2 base: onnx-community/Florence-2-base-ft (bản ONNX cho transformers.js của microsoft/Florence-2-base-ft),
//       giấy phép MIT; task "<OCR>", max_new_tokens 256, tham lam (num_beams 1, do_sample false; generation_config
//       của model đặt num_beams 3 nên phải ghi đè).
//   S = SmolVLM-256M-Instruct: HuggingFaceTB/SmolVLM-256M-Instruct (có sẵn thư mục onnx/), giấy phép Apache-2.0;
//       câu hỏi cố định SMOL_QUESTION, max_new_tokens 32, tham lam.
//   dtype thử q4 -> q8 -> fp16, chọn kiểu ĐẦU TIÊN nạp + chạy được 1 ảnh trên Chromium (wasm).
import { normalizeText, textMatch, rankOf } from "./lib.mjs";
import { t1QueryFromLines, bm25Search } from "./vn-data.mjs";

export const CACH3_MODELS = {
  florence: {
    id: "onnx-community/Florence-2-base-ft",
    revision: "e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f",
    origin: "microsoft/Florence-2-base-ft (revision f6c1a25888ffc1d945ee8a1a77ac833c7303d46e); bản base microsoft/Florence-2-base (5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac)",
    license: "MIT",
    task: "<OCR>",
    maxNewTokens: 256,
  },
  smolvlm: {
    id: "HuggingFaceTB/SmolVLM-256M-Instruct",
    revision: "7e3e67edbbed1bf9888184d9df282b700a323964",
    origin: "HuggingFaceTB/SmolVLM-256M-Instruct (ONNX nằm cùng repo, thư mục onnx/)",
    license: "Apache-2.0",
    maxNewTokens: 32,
  },
};
export const DTYPE_ORDER = ["q4", "q8", "fp16"];
export const SMOL_QUESTION = "What is the brand and the product name printed on this package? Answer in one line: brand | product name";

/** Nạp model trong trình duyệt (T = thư viện transformers đã import). Trả hàm run(RawImage) -> chuỗi thô. */
export async function loadCach3(T, name, { dtype, device = "wasm" } = {}) {
  const m = CACH3_MODELS[name];
  const opts = { revision: m.revision, dtype, device };
  if (name === "florence") {
    const model = await T.Florence2ForConditionalGeneration.from_pretrained(m.id, opts);
    const processor = await T.AutoProcessor.from_pretrained(m.id, { revision: m.revision });
    const tokenizer = await T.AutoTokenizer.from_pretrained(m.id, { revision: m.revision });
    return async function run(image) {
      const prompts = processor.construct_prompts(m.task);
      const textInputs = tokenizer(prompts);
      const visionInputs = await processor(image);
      const ids = await model.generate({ ...textInputs, ...visionInputs, max_new_tokens: m.maxNewTokens, num_beams: 1, do_sample: false });
      const raw = tokenizer.batch_decode(ids, { skip_special_tokens: false })[0];
      const post = processor.post_process_generation(raw, m.task, image.size);
      return { raw, text: typeof post?.[m.task] === "string" ? post[m.task] : raw };
    };
  }
  const processor = await T.AutoProcessor.from_pretrained(m.id, { revision: m.revision });
  const model = await T.AutoModelForVision2Seq.from_pretrained(m.id, opts);
  return async function run(image) {
    const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: SMOL_QUESTION }] }];
    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(prompt, [image]);
    const ids = await model.generate({ ...inputs, max_new_tokens: m.maxNewTokens, do_sample: false });
    const n = inputs.input_ids.dims.at(-1);
    const text = processor.batch_decode(ids.slice(null, [n, null]), { skip_special_tokens: true })[0];
    return { raw: text, text };
  };
}

/** Dòng chữ từ câu trả lời của F: tách theo xuống dòng; Florence <OCR> thường trả một chuỗi liền -> một dòng.
 *  Bỏ thẻ đặc biệt dạng <s>, </s>, <pad>. Không có độ tin (usableLine chỉ xét số chữ cái). */
export function florenceLines(text) {
  return String(text ?? "").replace(/<\/?(s|pad|unk)>/g, " ").split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t }));
}

/** Câu tìm T1 của cách 3. F: dòng qua usableLine (như 1a). S: toàn bộ từ của câu trả lời, bỏ "|" (số / đơn vị bỏ
 *  bằng isNoiseWord như S2). */
export function cach3Query(name, text) {
  if (name === "florence") return t1QueryFromLines(florenceLines(text));
  return t1QueryFromLines([{ text: String(text ?? "").replace(/\|/g, " ") }]);
}

/** Chấm một ảnh: T1 (BM25 trên danh mục) + với S: đúng tên / thương hiệu (textMatch câu trả lời đầy đủ với đáp án). */
export function scoreCach3(name, text, truth, index) {
  const q = cach3Query(name, text);
  const hits = q.length ? bm25Search(index, q, 5) : [];
  const top5 = hits.map((h) => h.code);
  const rank = rankOf(top5, truth.code);
  const out = { query: q.join(" "), queryWords: q.length, top5, rank, top1: rank === 1, inTop5: rank != null };
  if (name === "smolvlm") {
    out.nameOk = normalizeText(text) ? textMatch(text, truth.ten) : false;
    out.brandOk = normalizeText(text) ? textMatch(text, truth.thuong_hieu) : false;
  }
  return out;
}
