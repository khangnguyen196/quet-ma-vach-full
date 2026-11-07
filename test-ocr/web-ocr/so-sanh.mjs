// Gom bảng so sánh outputs/web-ocr/so-sanh.md từ:
//   outputs/summary.md (phần A), outputs/summary_combo.md (phần B), outputs/web-ocr/metrics.csv (số đo trình duyệt),
//   outputs/times.csv (giây/ảnh của công cụ không chạy trong trình duyệt).
// Chạy trong thư mục test-ocr:  node web-ocr/so-sanh.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Bảng markdown -> mảng dòng, mỗi dòng là mảng ô (bỏ dòng ---). */
export function mdRows(md) {
  return md
    .split(/\r?\n/)
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}

/** summary.md -> { tool: { points, pct } } (bảng xếp hạng 7 cột: Hạng | Công cụ | Điểm | % đầy đủ | …). */
export function parseSummaryA(md) {
  const out = {};
  for (const r of mdRows(md)) {
    if (r.length === 7 && /^\d+$/.test(r[0])) out[r[1]] = { points: Number(r[2]), pct: Number(r[3].replace("%", "")) };
  }
  return out;
}

/** summary_combo.md -> { ocr: { extractor: pct } } (ma trận đầu tiên). */
export function parseSummaryB(md) {
  const rows = mdRows(md);
  const head = rows.find((r) => r[0].startsWith("OCR"));
  if (!head) return {};
  const out = {};
  for (const r of rows.slice(rows.indexOf(head) + 1)) {
    if (r.length !== head.length) break;
    out[r[0]] = Object.fromEntries(head.slice(1).map((e, i) => [e, r[i + 1] === "–" ? null : Number(r[i + 1].replace("%", ""))]));
  }
  return out;
}

/** CSV đơn giản (có nháy kép) -> mảng object. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const parse = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  if (!lines.length) return [];
  const head = parse(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(parse(l).map((v, i) => [head[i], v])));
}

const pct = (v) => (v == null || Number.isNaN(v) ? "–" : `${v}%`);
const both = (a, b) => (a === b ? a : `${a} / ${b}`);

/** Dựng bảng so sánh. engines: [{ name, tools: { chromium, webkit } }] cho công cụ trình duyệt;
 *  others: [{ name, tool, secs }] cho công cụ không chạy trong trình duyệt. */
export function buildTable({ A, B, metrics, engines, others }) {
  const m = Object.fromEntries(metrics.map((r) => [r.tool, r]));
  const lines = [
    "| Công cụ | % A | % B regex | % B dict | giây/ảnh Chromium | giây/ảnh WebKit | bộ nhớ đỉnh 1 tiến trình (MB, private / working set) Chromium; WebKit | MB tải lần đầu (qua mạng) Chromium / WebKit | backend | chạy được cả 2 trình duyệt? |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const e of engines) {
    const c = m[e.tools.chromium] || {};
    const w = m[e.tools.webkit] || {};
    const okBoth = Number(c.images_ok) > 0 && Number(w.images_ok) > 0 && !Number(c.images_error) && !Number(w.images_error);
    const runs = (r) => (Number(r.images_ok) > 0 ? `có (${r.images_ok} ok, ${r.images_error} lỗi)` : "không");
    lines.push(`| ${e.name} | ${both(pct(A[e.tools.chromium]?.pct), pct(A[e.tools.webkit]?.pct))}` +
      ` | ${both(pct(B[e.tools.chromium]?.regex), pct(B[e.tools.webkit]?.regex))}` +
      ` | ${both(pct(B[e.tools.chromium]?.dict), pct(B[e.tools.webkit]?.dict))}` +
      ` | ${c.sec_per_image_mean || "–"} | ${w.sec_per_image_mean || "–"}` +
      ` | ${c.mem_peak_proc_mb || "–"} / ${c.ws_peak_proc_mb || "–"}; ${w.mem_peak_proc_mb || "–"} / ${w.ws_peak_proc_mb || "–"}` +
      ` | ${c.net_mb_first_load || "–"} / ${w.net_mb_first_load || "–"}` +
      ` | ${both(c.backend || "–", w.backend || "–")}` +
      ` | ${okBoth ? "có" : `Chromium: ${runs(c)}; WebKit: ${runs(w)}`} |`);
  }
  for (const o of others) {
    lines.push(`| ${o.name} | ${pct(A[o.tool]?.pct)} | ${pct(B[o.tool]?.regex)} | ${pct(B[o.tool]?.dict)}` +
      ` | ${o.secs} (máy tính, không chạy trong trình duyệt) | không chạy trong trình duyệt | – | – | ${o.backend} | không chạy trong trình duyệt |`);
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const out = "outputs";
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
  const A = parseSummaryA(read(path.join(out, "summary.md")));
  const B = parseSummaryB(read(path.join(out, "summary_combo.md")));
  const metrics = parseCsv(read(path.join(out, "web-ocr", "metrics.csv")));
  const times = parseCsv(read(path.join(out, "times.csv")));
  const last = new Map(times.map((r) => [`${r.tool}|${r.code}|${r.image}`, r]));
  const secs = (tool) => {
    const ok = [...last.values()].filter((r) => r.tool === tool && r.status === "ok").map((r) => Number(r.seconds));
    return ok.length ? (ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(2) : "–";
  };
  const table = buildTable({
    A, B, metrics,
    engines: [
      { name: "PaddleOCR.js (PP-OCRv5 mobile det + latin rec)", tools: { chromium: "paddlejs-chromium", webkit: "paddlejs-webkit" } },
      { name: "tesseract.js 7 (vie+eng)", tools: { chromium: "tesseractjs-chromium", webkit: "tesseractjs-webkit" } },
    ],
    others: [
      { name: "PP-OCRv5 det + VietOCR (Python, máy chủ)", tool: "paddle-vietocr", secs: secs("paddle-vietocr"), backend: "onnxruntime CPU + PyTorch CPU" },
      { name: "EasyOCR (Python, ocr-a)", tool: "easyocr", secs: secs("easyocr"), backend: "PyTorch CPU" },
      { name: "Tesseract (Python, ocr-a)", tool: "tesseract", secs: secs("tesseract"), backend: "Tesseract 5 CPU" },
    ],
  });
  const md = ["# So sánh OCR trong trình duyệt (đợt ocr-c)", "",
    "% A: OCR có chứa thông tin (score.py). % B: extractor rút ra đúng (score_combo.py). Giây/ảnh: chỉ ảnh ok, chỉ bước đọc (không tính nạp model).",
    "Bộ nhớ đỉnh: số lớn nhất của MỘT tiến trình trong cây tiến trình trình duyệt (thường là tiến trình chạy trang), mẫu mỗi 250 ms: private (PrivateMemorySize64, bộ nhớ đã cam kết riêng) / working set (WorkingSet64, đang nằm trong RAM). Đo trên Windows, chỉ là ước lượng; private của WebKit tính cả vùng nhớ ảo JavaScriptCore giữ sẵn cho wasm nên rất lớn, nên so working set.",
    "MB tải lần đầu: tổng byte qua mạng (đã nén) khi mở trang lần đầu với cache trống, từ CDN (jsDelivr + HuggingFace).", "", table, ""].join("\n");
  fs.mkdirSync(path.join(out, "web-ocr"), { recursive: true });
  fs.writeFileSync(path.join(out, "web-ocr", "so-sanh.md"), md, "utf8");
  console.log(md);
}
