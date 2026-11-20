// Đợt lens: file THAM CHIẾU cho kiểm tiền xử lý của lens-vec.py: 10 ảnh catalog ngẫu nhiên (seed cố định, từ ảnh đã tải
// ở D:\tmp\lens\anh — ảnh danh mục, KHÔNG phải ca có nhãn) qua AutoImageProcessor của @huggingface/transformers 4.3.1
// (Node, sharp) → pixel_values; rồi chạy CÙNG file ONNX bằng onnxruntime-node (gói đi kèm transformers.js) → vector chuẩn
// hóa L2. Ghi D:\tmp\lens\ref\<model>-px.npy, <model>-vec.npy, ref.json. Không gọi mạng (allowRemoteModels = false).
//
//   node test-ocr/chup-mat-do/lens-js-ref.mjs [--model-dir D:\tmp\lens\model] [--anh D:\tmp\lens\anh] [--out D:\tmp\lens\ref]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Model của lens-vec.py: thư mục, file ONNX, đầu ra (image_embeds / pooler_output / cls = token đầu last_hidden_state). */
export const REF_MODELS = Object.freeze({
  "clip-fp32": { dir: "clip", onnx: "vision_model.onnx", out: "image_embeds" },
  "clip-int8": { dir: "clip", onnx: "vision_model_quantized.onnx", out: "image_embeds" },
  siglip: { dir: "siglip", onnx: "vision_model.onnx", out: "pooler_output" },
  "dinov2-small": { dir: "dinov2-small", onnx: "model.onnx", out: "cls" },
});

/** Chọn n file ngẫu nhiên có seed (LCG, cố định) từ danh sách đã sắp xếp. */
export function seededPick(list, n, seed = 20261120) {
  const a = [...list].sort();
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

/** Mảng float32 + shape → Buffer .npy (v1.0, '<f4', C order). */
export function toNpy(data, shape) {
  const header0 = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(", ")}${shape.length === 1 ? "," : ""}), }`;
  const pad = 64 - ((10 + header0.length + 1) % 64);
  const header = header0 + " ".repeat(pad === 64 ? 0 : pad) + "\n";
  const b = Buffer.alloc(10 + header.length + data.length * 4);
  b.writeUInt8(0x93, 0);
  b.write("NUMPY", 1, "latin1");
  b.writeUInt8(1, 6);
  b.writeUInt8(0, 7);
  b.writeUInt16LE(header.length, 8);
  b.write(header, 10, "latin1");
  for (let i = 0; i < data.length; i++) b.writeFloatLE(data[i], 10 + header.length + 4 * i);
  return b;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const modelDir = arg("--model-dir", "D:\\tmp\\lens\\model");
  const anhDir = arg("--anh", "D:\\tmp\\lens\\anh");
  const outDir = arg("--out", "D:\\tmp\\lens\\ref");
  fs.mkdirSync(outDir, { recursive: true });
  const T = await import("@huggingface/transformers");
  const ort = await import("onnxruntime-node");
  T.env.allowRemoteModels = false;
  T.env.localModelPath = modelDir.endsWith(path.sep) ? modelDir : modelDir + path.sep;
  const files = seededPick(fs.readdirSync(anhDir).filter((n) => /\.400\.jpg$/.test(n)), 10).map((n) => path.join(anhDir, n));
  const ref = { at: new Date().toISOString(), transformers: T.env.version, files, models: {} };
  for (const [name, m] of Object.entries(REF_MODELS)) {
    const proc = await T.AutoImageProcessor.from_pretrained(m.dir);
    const sess = await ort.InferenceSession.create(path.join(modelDir, m.dir, m.onnx), { intraOpNumThreads: 1, interOpNumThreads: 1 });
    const px = [];
    const vecs = [];
    let shape = null;
    for (const f of files) {
      const img = await T.RawImage.read(f);
      const { pixel_values: pv } = await proc(img);
      shape = pv.dims;
      for (const x of pv.data) px.push(x);
      const r = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", Float32Array.from(pv.data), pv.dims) });
      let v;
      if (m.out === "cls") { const h = r.last_hidden_state; v = h.data.slice(0, h.dims[2]); } else v = r[m.out].data;
      let s = 0;
      for (const x of v) s += x * x;
      const n = Math.sqrt(s) || 1;
      for (const x of v) vecs.push(x / n);
    }
    const d = vecs.length / files.length;
    fs.writeFileSync(path.join(outDir, `${name}-px.npy`), toNpy(px, [files.length, ...shape.slice(1)]));
    fs.writeFileSync(path.join(outDir, `${name}-vec.npy`), toNpy(vecs, [files.length, d]));
    ref.models[name] = { dims: d, pxShape: shape };
    console.log(`${name}: ${files.length} ảnh, ${d} chiều, pixel_values ${JSON.stringify(shape)}`);
  }
  fs.writeFileSync(path.join(outDir, "ref.json"), JSON.stringify(ref, null, 1), "utf8");
  console.log(`Ghi ${outDir}`);
}
