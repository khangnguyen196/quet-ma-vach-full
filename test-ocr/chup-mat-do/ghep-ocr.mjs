// Đợt ocr-mat vòng 4: GHÉP chữ của 2 OCR rồi để t1-ocr.mjs chấm (luật: test-ocr/README.md Phần F, Chốt bổ sung vòng 4).
// Chỉ import, không sửa lib.mjs / vn-data.mjs / t1.mjs / t1-ocr.mjs; không gọi mạng; không chạy OCR.
//
//   node chup-mat-do/ghep-ocr.mjs --x <tên kết quả> --y <tên kết quả> --name <tên ghép>
//        [--ket-qua D:\tmp\ocr-mat\ket-qua] [--out-root D:\tmp\ocr-mat\ocr]
//   rồi: node chup-mat-do/t1-ocr.mjs --dir D:\tmp\ocr-mat\ocr\ghep-<tên ghép> --name ghep-<tên ghép>
//
// <tên kết quả> = file <ket-qua>/<tên>.json do t1-ocr.mjs ghi (lấy thư mục OCR thô `dir`, thang độ tin `scale`, `summary`).
// Luật:
//   - Cụm = dòng do ocrLines() (t1-ocr.mjs) trả cho từng OCR, đúng thang của từng OCR (khung -> nối hàng rowLines).
//   - A = bên có "trong 5 đầu" cao hơn (hòa: vị trí 1 cao hơn, rồi secondsMedian nhỏ hơn, rồi bên --x), B = bên kia.
//   - Giữ mọi dòng của A theo thứ tự; thêm dòng của B nếu khóa (normalizeText của lib.mjs) chưa có; khóa rỗng của B bỏ.
//   - Một bên lỗi / thiếu -> dùng bên kia; cả hai lỗi -> status "loi" (t1-ocr tính sai).
//   - Giây = tổng giây 2 bên (các số có), không đo mới.
// Ra: <out-root>/ghep-<tên>/<mã>__front.json dạng { code, status, lines: [{ text, conf }], seconds, a, b, nguon } + _ghep.json.
// Thư mục ra phải mới (đã có *__front.json thì dừng, mã 2).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText } from "./lib.mjs";
import { ocrLines, ocrProblem } from "./t1-ocr.mjs";

/** Khóa so trùng của một dòng: chữ chuẩn hóa không dấu (normalizeText của lib.mjs). */
export function lineKey(text) {
  return normalizeText(text);
}

/** Bỏ conf khi không có độ tin (null / undefined / không phải số). */
function cleanLine(l) {
  const text = typeof l?.text === "string" ? l.text : String(l?.text ?? "");
  const conf = l?.conf;
  return conf == null || !Number.isFinite(Number(conf)) ? { text } : { text, conf: Number(conf) };
}

/** Ghép 2 danh sách dòng (độ tin đã quy 0–1): mọi dòng của A theo thứ tự, rồi dòng của B có khóa chưa có. */
export function mergeLines(linesA, linesB) {
  const out = (linesA || []).map(cleanLine);
  const seen = new Set(out.map((l) => lineKey(l.text)));
  for (const raw of linesB || []) {
    const l = cleanLine(raw);
    const k = lineKey(l.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** Chọn A / B từ 2 thành phần { name, summary: { top5, top1, secondsMedian } }. Hòa cả 3 -> A = x. */
export function pickOrder(x, y) {
  const sx = x.summary || {};
  const sy = y.summary || {};
  const num = (v, def) => (Number.isFinite(v) ? v : def);
  let yFirst = false;
  if (num(sy.top5, -1) !== num(sx.top5, -1)) yFirst = num(sy.top5, -1) > num(sx.top5, -1);
  else if (num(sy.top1, -1) !== num(sx.top1, -1)) yFirst = num(sy.top1, -1) > num(sx.top1, -1);
  else if (num(sy.secondsMedian, Infinity) !== num(sx.secondsMedian, Infinity)) yFirst = num(sy.secondsMedian, Infinity) < num(sx.secondsMedian, Infinity);
  return yFirst ? { a: y, b: x } : { a: x, b: y };
}

/** Ghép file OCR của một ảnh. ocrA / ocrB: JSON file OCR (thiếu = undefined); thang độ tin từng bên. */
export function mergeOcr(ocrA, ocrB, { scaleA = 1, scaleB = 1 } = {}) {
  const secs = [ocrA?.seconds, ocrB?.seconds].filter(Number.isFinite);
  const seconds = secs.length ? secs.reduce((s, v) => s + v, 0) : null;
  const read = (ocr, scale) => {
    const problem = ocrProblem(ocr);
    if (problem) return { problem };
    try { return { lines: ocrLines(ocr, scale) }; } catch (e) { return { problem: `đọc lỗi: ${e.message}` }; }
  };
  const ra = read(ocrA, scaleA);
  const rb = read(ocrB, scaleB);
  if (ra.problem && rb.problem) return { status: "loi", error: `cả hai bên lỗi: A ${ra.problem}; B ${rb.problem}`, seconds };
  if (ra.problem) return { status: "ok", lines: mergeLines(rb.lines, []), seconds, nguon: "b" };
  if (rb.problem) return { status: "ok", lines: mergeLines(ra.lines, []), seconds, nguon: "a" };
  return { status: "ok", lines: mergeLines(ra.lines, rb.lines), seconds, nguon: "ca-hai" };
}

/** Đọc JSON của một file kết quả; hỏng -> Error tiếng Việt có tên file, exitCode 2 (dòng lệnh thoát mã 2). */
export function parseResultJson(text, file) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error(`File kết quả ${file} không đọc được (JSON hỏng: ${e.message}). Chạy lại t1-ocr.mjs cho bộ đó rồi ghép lại.`);
    err.exitCode = 2;
    throw err;
  }
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

function readOcr(dir, code) {
  const f = path.join(dir, `${code}__front.json`);
  if (!fs.existsSync(f)) return undefined;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return { status: `JSON hỏng: ${e.message}` }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const xName = arg("x");
  const yName = arg("y");
  const name = arg("name");
  if (!xName || !yName || !name) {
    console.error("Cần --x <tên kết quả> --y <tên kết quả> --name <tên ghép>.");
    process.exit(2);
  }
  const ketQua = arg("ket-qua", "D:\\tmp\\ocr-mat\\ket-qua");
  const outRoot = arg("out-root", "D:\\tmp\\ocr-mat\\ocr");
  const load = (n) => {
    const f = path.join(ketQua, `${n}.json`);
    if (!fs.existsSync(f)) { console.error(`Không có file kết quả ${f}`); process.exit(2); }
    let j;
    try { j = parseResultJson(fs.readFileSync(f, "utf8"), f); } catch (e) { console.error(e.message); process.exit(e.exitCode || 2); }
    return { name: n, dir: j.dir, scale: Number(j.scale) > 0 ? Number(j.scale) : 1, summary: j.summary, codes: (j.items || []).map((it) => it.ma) };
  };
  const x = load(xName);
  const y = load(yName);
  const { a, b } = pickOrder(x, y);
  const outDir = path.join(outRoot, `ghep-${name}`);
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).some((f) => f.endsWith("__front.json"))) {
    console.error(`Thư mục ${outDir} đã có file ghép: dùng tên khác (không ghi đè).`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const codes = [...new Set([...x.codes, ...y.codes])];
  const dem = { "ca-hai": 0, a: 0, b: 0, loi: 0 };
  for (const code of codes) {
    const r = mergeOcr(readOcr(a.dir, code), readOcr(b.dir, code), { scaleA: a.scale, scaleB: b.scale });
    dem[r.status === "ok" ? r.nguon : "loi"]++;
    fs.writeFileSync(path.join(outDir, `${code}__front.json`), JSON.stringify({ code, ...r, a: a.name, b: b.name }, null, 1), "utf8");
  }
  const meta = { name, at: new Date().toISOString(), a: { name: a.name, dir: a.dir, scale: a.scale, summary: a.summary }, b: { name: b.name, dir: b.dir, scale: b.scale, summary: b.summary }, images: codes.length, nguon: dem };
  fs.writeFileSync(path.join(outDir, "_ghep.json"), JSON.stringify(meta, null, 1), "utf8");
  console.log(`Ghép ${name}: A = ${a.name} (5 đầu ${a.summary?.top5}, vị trí 1 ${a.summary?.top1}), B = ${b.name} (5 đầu ${b.summary?.top5}, vị trí 1 ${b.summary?.top1}); ${codes.length} ảnh: cả hai ${dem["ca-hai"]}, chỉ A ${dem.a}, chỉ B ${dem.b}, lỗi ${dem.loi}`);
  console.log(`Ghi: ${outDir}`);
}
