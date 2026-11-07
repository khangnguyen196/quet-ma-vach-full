// So luật regex bản JavaScript (public/ocr-thu/regex.mjs, dùng trong trang thử ocr-thu.html) với bản Python chuẩn
// (extract_regex trong run_extract.py) trên MỌI kết quả đã có: outputs/extract/<ocr>__regex/<mã>.json.
// Chữ của từng sản phẩm ghép đúng như product_text của run_extract.py (thứ tự ảnh IMAGE_ORDER).
// Phải khớp 100% (từng ô của từng sản phẩm); lệch thì in ra và thoát mã 1.
//
// Chạy trong thư mục test-ocr (nơi có outputs/):  node web-ocr/regex-parity.mjs [--ocr easyocr,tesseract,...]
// Không có --ocr: mọi thư mục outputs/extract/*__regex có thư mục OCR tương ứng.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractRegex, FIELDS, pyStrip } from "../../public/ocr-thu/regex.mjs";

export const IMAGE_ORDER = ["front", "ingredients", "nutrition", "back", "date"];

/** Đọc file như pathlib.read_text(encoding="utf-8", errors="ignore"): bỏ byte UTF-8 hỏng, \r\n và \r thành \n. */
export function readTextLikePython(file) {
  const buf = fs.readFileSync(file);
  let s;
  try {
    s = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    // errors="ignore": bỏ ký tự hỏng (TextDecoder thường thay bằng U+FFFD nên bỏ U+FFFD mới sinh)
    s = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf).replace(/[\uFFFD]/g, "");
  }
  return s.replace(/\r\n?/g, "\n");
}

/** product_text của run_extract.py: các file <mã>__<ảnh>.txt sắp theo (vị trí ảnh trong IMAGE_ORDER, không có là 99;
 *  tên file), nối bằng "\n". files: tên file trong thư mục OCR; read(name) trả nội dung. */
export function productText(files, code, read) {
  const mine = files.filter((f) => f.startsWith(`${code}__`) && f.endsWith(".txt"));
  const image = (f) => f.slice(0, -4).split("__").slice(1).join("__");
  const key = (f) => (IMAGE_ORDER.includes(image(f)) ? IMAGE_ORDER.indexOf(image(f)) : 99);
  mine.sort((a, b) => key(a) - key(b) || (a < b ? -1 : a > b ? 1 : 0));
  return mine.map(read).join("\n");
}

/** So 1 sản phẩm: trả mảng ô lệch [{ field, py, js }]. pyData là json đã lưu (có _status, _seconds). */
export function compareProduct(text, pyData) {
  // run_extract.main: chữ trống (sau strip) thì không chạy extractor, json chỉ có _seconds / _status
  const js = pyStrip(text) ? extractRegex(text) : {};
  const diffs = [];
  for (const f of FIELDS) {
    const a = JSON.stringify(pyData[f] ?? null);
    const b = JSON.stringify(js[f] ?? null);
    if (a !== b) diffs.push({ field: f, py: pyData[f], js: js[f] });
  }
  return diffs;
}

function main() {
  const out = "outputs";
  const argOcr = process.argv.indexOf("--ocr");
  let ocrs = fs.readdirSync(path.join(out, "extract"))
    .filter((d) => d.endsWith("__regex"))
    .map((d) => d.slice(0, -"__regex".length))
    .filter((o) => fs.existsSync(path.join(out, o)))
    .sort();
  if (argOcr > 0) {
    const want = process.argv[argOcr + 1].split(",").map((s) => s.trim());
    ocrs = ocrs.filter((o) => want.includes(o));
    for (const w of want) if (!ocrs.includes(w)) console.log(`(không có kết quả regex của ${w})`);
  }
  let products = 0;
  let fields = 0;
  let bad = 0;
  let skipped = 0;
  const rows = [];
  for (const ocr of ocrs) {
    const dir = path.join(out, ocr);
    const files = fs.readdirSync(dir);
    const extDir = path.join(out, "extract", `${ocr}__regex`);
    let n = 0;
    let nBad = 0;
    for (const j of fs.readdirSync(extDir).filter((f) => f.endsWith(".json")).sort()) {
      const code = j.slice(0, -5);
      const pyData = JSON.parse(fs.readFileSync(path.join(extDir, j), "utf8"));
      if (pyData._status !== "ok") {
        skipped++;
        continue;
      }
      const text = productText(files, code, (f) => readTextLikePython(path.join(dir, f)));
      const diffs = compareProduct(text, pyData);
      n++;
      fields += FIELDS.length;
      if (diffs.length) {
        nBad++;
        bad += diffs.length;
        for (const d of diffs) console.log(`LỆCH ${ocr} ${code} ${d.field}: python=${JSON.stringify(d.py)} js=${JSON.stringify(d.js)}`);
      }
    }
    products += n;
    rows.push(`${ocr}: ${n} sản phẩm, ${nBad} sản phẩm lệch`);
  }
  console.log(rows.join("\n"));
  console.log(`\nTổng: ${ocrs.length} OCR, ${products} lượt (sản phẩm × OCR), ${fields} ô; lệch ${bad} ô. Bỏ qua ${skipped} file lỗi.`);
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
