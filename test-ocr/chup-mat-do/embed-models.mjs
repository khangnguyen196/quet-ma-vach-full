// Model ảnh của cách 2 (vòng 3), dùng chung cho Node (tính vector chỉ mục) và trình duyệt (do-trinh-duyet.mjs nạp
// cùng cấu hình). CHỐT trước khi chạy (xem tong-hop-v3.md):
//   M1 CLIP ViT-B/32 lượng tử hóa: Xenova/clip-vit-base-patch32, chỉ phần vision (onnx/vision_model_quantized.onnx),
//      giấy phép MIT (thẻ model HuggingFace; bản gốc openai/clip-vit-base-patch32 MIT trên GitHub openai/CLIP).
//   M2 MobileCLIP-S0 BỊ BỎ: Xenova/mobileclip_s0 ghi "license: other", bản gốc apple/MobileCLIP-S0 dùng
//      "Apple Machine Learning Research Model License" – chỉ cho "Research Purposes", loại trừ "product development
//      or use in any commercial product or service" -> không chắc được dùng cho trang thử công khai của app, nên thay
//      bằng DINOv2-small: Xenova/dinov2-small (onnx/model_quantized.onnx), bản gốc facebook/dinov2-small Apache-2.0.
// Vector: CLIP = image_embeds (512); DINOv2 = token CLS của last_hidden_state (384). Chuẩn hóa L2, so cosine.
export const TRANSFORMERS_VERSION = "4.3.1"; // ghim, giống test-ocr/chup-mat-do/package.json
export const TRANSFORMERS_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;

export const MODELS = {
  clip: {
    id: "Xenova/clip-vit-base-patch32",
    revision: "6b7c523703ae26e39be4b03774966f8571c7f523",
    kind: "clip",
    dtype: "q8", // onnx/vision_model_quantized.onnx
    license: "MIT",
    dims: 512,
  },
  dinov2: {
    id: "Xenova/dinov2-small",
    revision: "c2bb04a51fab207c420665f1946016107bffc701",
    kind: "dinov2",
    dtype: "q8", // onnx/model_quantized.onnx
    license: "Apache-2.0 (bản gốc facebook/dinov2-small)",
    dims: 384,
  },
};

/** Chuẩn hóa L2 (mảng số -> Float32Array). */
export function l2norm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / n);
}

/** Cosine của 2 vector đã chuẩn hóa. */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** top k mục gần nhất: index = [{ code, vec }] (vec đã chuẩn hóa). Trả [{ code, score }]. Một mã có nhiều ảnh thì
 *  lấy điểm cao nhất của mã đó. */
export function topK(index, q, k = 5) {
  const best = new Map();
  for (const it of index) {
    const s = dot(it.vec, q);
    if (!best.has(it.code) || s > best.get(it.code)) best.set(it.code, s);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([code, score]) => ({ code, score }));
}

/** Nạp model bằng thư viện transformers đã import (T). Trả hàm embed(RawImage | url) -> Float32Array chuẩn hóa. */
export async function loadEmbedder(T, name, { device } = {}) {
  const m = MODELS[name];
  const opts = { revision: m.revision, dtype: m.dtype };
  if (device) opts.device = device;
  const processor = await T.AutoProcessor.from_pretrained(m.id, { revision: m.revision });
  let model;
  if (m.kind === "clip") model = await T.CLIPVisionModelWithProjection.from_pretrained(m.id, opts);
  else model = await T.AutoModel.from_pretrained(m.id, opts);
  return async function embed(image) {
    const img = typeof image === "string" ? await T.RawImage.read(image) : image;
    const inputs = await processor(img);
    const out = await model(inputs);
    if (m.kind === "clip") return l2norm(out.image_embeds.data);
    const h = out.last_hidden_state; // [1, tokens, dims]
    return l2norm(h.data.slice(0, h.dims[2]));
  };
}
