// Gom kết quả thành bảng tóm tắt D:\tmp\chup-mat-do\ket-qua\tong-hop-v2.md
// (đọc 1a/1b-<trình duyệt>.json, 1c/1d/4a.json, cors.json, chong-an-gian.json, vn-filter.json, off-stats-v*.json nếu có).
//
//   node chup-mat-do/tong-hop.mjs [--dir D:\tmp\chup-mat-do\ket-qua] [--out tong-hop-v2.md]
//
// Vòng 2: "đúng tên / thương hiệu" CHẤM LẠI từ tên + thương hiệu kết quả đầu đã lưu (top1Name / top1Brands) bằng
// textMatch mới, không gọi lại OFF. Cột "cũ" là số đã lưu lúc chạy vòng 1 (luật cũ).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, median, maxOf, MAX_WORDS, NAME_OVERLAP, NAME_MIN_LETTERS, CATEGORY_WORDS, textMatch, brandMatch, parseCsv } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dir = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : "D:\\tmp\\chup-mat-do\\ket-qua";
const outName = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "tong-hop-v2.md";
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const truthBy = Object.fromEntries(parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8")).map((t) => [t.code, t]));
const MB = (b) => (b == null ? "–" : (b / 1e6).toFixed(0)); // MB = 10^6 byte
const sec = (x) => (x == null ? "–" : x.toFixed(1));
const pct = (a, n) => (n ? `${a}/${n} (${Math.round((100 * a) / n)}%)` : "–");

/** Chấm lại tên / thương hiệu của một kết quả đã lưu bằng luật mới. */
function rescore(s, code) {
  const t = truthBy[code] || {};
  const hasTop = s.top5 && s.top5.length;
  const nameOk = hasTop ? textMatch(s.top1Name, t.ten) : (t.ten ? false : null);
  const brandOk = hasTop ? brandMatch(s.top1Brands, t.thuong_hieu) : (t.thuong_hieu ? false : null);
  return { ...s, nameOkOld: s.nameOk, brandOkOld: s.brandOk, nameOk, brandOk };
}

const LABELS = {
  "1a-chromium": ["1a PaddleOCR.js", "Chromium"], "1a-webkit": ["1a PaddleOCR.js", "WebKit"],
  "1b-chromium": ["1b tesseract.js", "Chromium"], "1b-webkit": ["1b tesseract.js", "WebKit"],
  "1d": ["1d PP-OCRv5 det + VietOCR", "máy tính (CPU)"], "1c": ["1c OCR.space", "máy chủ OCR.space"], "4a": ["4a Gemini", "máy chủ Google"],
};
const names = Object.keys(LABELS);
const md = ["# Tổng hợp vòng 2 – đợt chup-mat-do", "", `Tạo lúc ${new Date().toISOString()}.`, ""];
md.push(
  "## Quyết định điều phối vòng 2 (để vòng 6 chép vào PLAN.md mục 8)", "",
  "- 08/11/2026: gọi OFF qua trang Chromium, không thêm User-Agent (OFF chặn UA 'node'); search-a-licious chỉ tham khảo.",
  "- 08/11/2026: cách 2 đo trên các mã còn lại sau kiểm trùng chặt (mẫu nhỏ, tham khảo) + bộ thử phụ leave-one-out ≤ 100 cặp ảnh mặt trước khác imgid từ chỉ mục VN (vòng 3).",
  "- 08/11/2026: trần mỗi lần chạy: Gemini ≤ 40 lượt, OCR.space ≤ 40 (≤ 60 cả đợt).",
  "- 08/11/2026: luật 'đúng tên' mới: tỉ lệ trên từ có nghĩa của đáp án ≥ 0,5 + ≥ 1 từ chung ≥ 3 chữ cái, bỏ từ chỉ loại hàng, bỏ luật chứa nhau.",
  "",
  "## Cách đo", "",
  "Chữ OCR / JSON của front.jpg -> từ khóa -> tìm Open Food Facts (cgi/search.pl, lọc Việt Nam, 5 kết quả đầu; 0 kết quả thì tìm 1 lần không lọc) -> so với test-ocr/truth.csv.",
  `S2 là chiến lược MẶC ĐỊNH (chốt vòng 1): dòng ≥ 3 chữ cái, bỏ số / đơn vị / cụm chung, tối đa ${MAX_WORDS} từ theo thứ tự đọc. Vòng 2 (1c / 1d / 4a) chỉ chạy S2 (+ search-a-licious tham khảo). 4a: S2 trên 2 dòng [thương hiệu, tên] Gemini trả.`,
  `Đúng tên / thương hiệu (luật vòng 2): so tên + thương hiệu kết quả đầu với đáp án; bỏ dấu, bỏ ký tự điều khiển, bỏ từ chỉ loại hàng (${CATEGORY_WORDS.join(", ")}); đúng khi số từ chung / số từ có nghĩa của ĐÁP ÁN ≥ ${NAME_OVERLAP} và có ≥ 1 từ chung dài ≥ ${NAME_MIN_LETTERS} chữ cái (đáp án toàn từ ngắn như "7UP" thì phải trùng hết). Bỏ luật "chứa nhau". Cột "(cũ)" là số theo luật vòng 1.`,
  "Mẫu số = số ảnh đọc được. 31 mã trong truth.csv, 30 mã có front.jpg (8934673818391 không có).",
  "",
);

const head = "| Cách | Chạy ở | Ảnh chạy được | Chiến lược | Đúng mã vị trí 1 | Trong 5 đầu | Đúng tên (mới) | Đúng tên (cũ) | Đúng thương hiệu (mới) | Thương hiệu (cũ) | Lỗi OFF | Chưa tìm (OFF chặn) | Phải bỏ lọc VN |";
const rows = [head, "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
const perf = ["| Cách | Chạy ở | Nạp (s) | Giây OCR / ảnh trung vị | lớn nhất | Giây tìm OFF trung vị (S2, mạng thật) | lớn nhất | Bộ nhớ đỉnh (working set cả cây, MB) | JS heap (không gồm wasm), đỉnh, MB | Tải lần đầu (MB qua mạng) | Giải nén (MB) | Lượt API | Chi phí |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
const gem = [];
const notes = [];
const RUN_NOTES = {
  "1c": "D:\\tmp\\chup-mat-do\\ocr\\ocrspace-1c\\_lan-chay.json",
  "4a": "D:\\tmp\\chup-mat-do\\ocr\\gemini-4a\\_lan-chay.json",
};
for (const name of names) {
  const r = readJson(path.join(dir, `${name}.json`));
  const [cach, br] = LABELS[name];
  if (!r) { rows.push(`| ${cach} | ${br} | chưa chạy | | | | | | | | | | |`); continue; }
  const ok = r.items.filter((i) => i.status === "ok");
  const run = RUN_NOTES[name] ? readJson(RUN_NOTES[name]) : null;
  if (run?.stop) notes.push(`- ${cach}: ${ok.length}/30 ảnh có kết quả; lần gọi API dừng vì: ${run.stop.split("\n")[0].slice(0, 300)} (lượt lần này ${run.calls}, tổng tháng ${run.monthTotal ?? "–"}${run.model ? `, model ${run.model}` : ""}).`);
  if (!ok.length) { rows.push(`| ${cach} | ${br} | 0/${r.items.length} | bỏ: ${run?.stop ?? "chưa có chữ OCR"} | | | | | | | | | |`); continue; }
  const label = (k) => (k === r.defaultStrategy ? `**${k} (mặc định)**` : k);
  for (const k of ["S1", "S2", "S3"]) {
    const sc = ok.map((i) => i.strategies[k]).filter(Boolean);
    if (!sc.length) continue;
    const re = ok.filter((i) => i.strategies[k]).map((i) => rescore(i.strategies[k], i.ma));
    const s = summarize(re);
    const old = summarize(re.map((x) => ({ ...x, nameOk: x.nameOkOld, brandOk: x.brandOkOld })));
    const fresh = name.startsWith("1a") || name.startsWith("1b");
    rows.push(`| ${cach} | ${br} | ${ok.length}/${r.items.length} | ${label(k)} | ${pct(s.top1, s.n)} | ${pct(s.top5, s.n)} | ${pct(s.nameOk, s.nameN)} | ${fresh ? pct(old.nameOk, old.nameN) : "–"} | ${pct(s.brandOk, s.brandN)} | ${fresh ? pct(old.brandOk, old.brandN) : "–"} | ${sc.filter((x) => x.error && !x.notSearched).length} | ${sc.filter((x) => x.notSearched).length} | ${sc.filter((x) => x.vnFallback).length} |`);
  }
  const ref = ok.map((i) => (i.reference ? rescore(i.reference, i.ma) : null)).filter(Boolean);
  if (ref.length) {
    const s = summarize(ref);
    const old = summarize(ref.map((x) => ({ ...x, nameOk: x.nameOkOld, brandOk: x.brandOkOld })));
    const fresh = name.startsWith("1a") || name.startsWith("1b");
    rows.push(`| ${cach} | ${br} | ${ok.length}/${r.items.length} | S2 + search-a-licious (tham khảo, không CORS) | ${pct(s.top1, s.n)} | ${pct(s.top5, s.n)} | ${pct(s.nameOk, s.nameN)} | ${fresh ? pct(old.nameOk, old.nameN) : "–"} | ${pct(s.brandOk, s.brandN)} | ${fresh ? pct(old.brandOk, old.brandN) : "–"} | ${ref.filter((x) => x.error && !x.notSearched).length} | ${ref.filter((x) => x.notSearched).length} | ${ref.filter((x) => x.vnFallback).length} |`);
  }
  const ocrS = ok.map((i) => i.giayOcr);
  const d = ok.map((i) => i.strategies[r.defaultStrategy]).filter((x) => x && x.terms && x.offSeconds != null);
  // số giây mạng của lần gọi THẬT (cache lưu lại số đó lúc gọi; lượt lấy từ cache không đo lại thời gian đọc đĩa)
  const offS = d.map((x) => x.offSeconds);
  const memImg = ok.map((i) => i.boNho?.peakTotalWs).filter((x) => x != null);
  const memPeak = Math.max(r.run?.memory?.peakTotalWs ?? 0, ...memImg) || null;
  const browser = name.includes("-");
  const api = run?.calls ?? ok.reduce((a, i) => a + (i.luotApi || 0), 0); // gồm cả lượt lỗi (503) vẫn bị tính
  perf.push(`| ${cach} | ${br} | ${sec(r.run?.loadSeconds)} | ${sec(median(ocrS))} | ${sec(maxOf(ocrS))} | ${offS.length ? `${sec(median(offS))} (${offS.length} lượt)` : "– (không có số)"} | ${offS.length ? sec(maxOf(offS)) : "–"} | ${browser ? MB(memPeak) : "–"} | ${br === "Chromium" ? MB(r.run?.jsHeapPeak) : browser ? "không đo được (WebKit không có CDP)" : "–"} | ${r.firstLoad ? (r.firstLoad.transfer / 1e6).toFixed(1) : browser ? "chưa đo" : "–"} | ${r.firstLoad ? (r.firstLoad.decoded / 1e6).toFixed(1) : "–"} | ${api || (browser || name === "1d" ? 0 : "–")} | 0 |`);
  if (name === "4a") {
    const g = ok.map((i) => i.gemini).filter(Boolean);
    gem.push(`Tên Gemini tự đọc khớp đáp án (textMatch mới): ${pct(g.filter((x) => x.nameOk === true).length, g.filter((x) => x.nameOk != null).length)}; thương hiệu: ${pct(g.filter((x) => x.brandOk === true).length, g.filter((x) => x.brandOk != null).length)} (cột tham khảo, không qua OFF).`);
  }
}
md.push("## Độ đúng", "", ...rows, "", ...(gem.length ? ["- 4a: " + gem.join(" ")] : []), ...notes, "",
  "## Tốc độ, bộ nhớ, dung lượng", "", ...perf, "",
  "- MB = 10^6 byte trong cả bảng.",
  "- Bộ nhớ: đỉnh working set (phần đang nằm trong RAM) của cả cây tiến trình trình duyệt, lấy mẫu mỗi 250 ms bằng PowerShell (Windows). WebKit Windows có tiến trình Playwright.exe nền khoảng 0,8 GB; số trên điện thoại sẽ khác.",
  "- JS heap (không gồm wasm): CDP Performance.getMetrics của Chromium; bộ nhớ wasm của model không nằm trong số này.",
  "- Byte tải lần đầu: chạy lại ở chế độ cdn (jsDelivr / HuggingFace, bộ nhớ đệm trống), 1 ảnh, cộng byte qua mạng (Playwright request.sizes()).",
  "- Giây tìm OFF: thời gian mạng của lượt tìm mặc định (không tính lúc chờ giãn cách 6 giây). lấy từ số giây lưu trong cache lúc gọi thật (không phải thời gian đọc cache); lượt gọi trước khi cache lưu số giây thì không có số.",
  "- Giây OCR: 1d trên CPU máy tính (i7-6820HQ, 8 luồng); 1c / 4a gồm cả thời gian mạng tới máy chủ API.",
  "");

const statFiles = ["off-stats-v1.json", "off-stats-v2.json"];
const all = [];
for (const f of statFiles) {
  for (let s = readJson(path.join(dir, f)); s; s = s.previous) if (s.lastRun) all.push({ file: f, ...s.lastRun });
}
if (all.length) {
  md.push("## Số lượt gọi Open Food Facts", "", "| Lần chạy | Tìm | Đọc sản phẩm | Khác (thương hiệu) | Lấy từ cache | Lỗi 429 / 5xx | Lỗi mạng | Thử lại | Hỏng hẳn | Bỏ lọc VN | Cầu dao bật |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of all.sort((a, b) => a.at.localeCompare(b.at))) md.push(`| ${s.at} (${(s.tools || []).join(", ")}) | ${s.search} | ${s.product} | ${s.other} | ${s.cacheHits} | ${s.http429or5xx} | ${s.networkErrors ?? "– (chưa đếm)"} | ${s.retries} | ${s.failures} | ${s.vnFallback} | ${s.breakerTrips ?? "–"} |`);
  md.push("");
}

const vn = readJson(path.join(dir, "vn-filter.json"));
if (vn) {
  md.push("## Kiểm lọc Việt Nam (search.pl)", "", `Danh sách thương hiệu: ${vn.brandsSource ?? "–"} (${vn.brandsCount ?? "–"} tên).${vn.error ? " Lỗi: " + vn.error : ""}`, "",
    "| Câu đối chứng (không có trong truth.csv) | tag_0=en:vietnam: count / số kết quả | tag_0=vietnam: count / số kết quả |", "|---|---|---|");
  for (const q of vn.queries || []) md.push(`| ${q.terms} | ${q.vnEnPrefix ? `${q.vnEnPrefix.count} / ${q.vnEnPrefix.hits}` : "lỗi"} | ${q.vnPlain ? `${q.vnPlain.count} / ${q.vnPlain.hits}` : "không cần thử"} |`);
  md.push("");
}

const cors = readJson(path.join(dir, "cors.json"));
if (cors) {
  md.push("## CORS (gọi thẳng từ trình duyệt, vòng 1)", "", `Kiểu mặc định đã chọn: **${cors.chosen ?? "không có"}**. ${cors.rule}`, "", "| Kiểu | Trình duyệt | Lần | HTTP | access-control-allow-origin | fetch trong trang |", "|---|---|---|---|---|---|");
  for (const r of cors.results) md.push(`| ${r.kind} | ${r.browser} | ${r.attempt ?? 1} | ${r.httpStatus ?? "không đọc được"} | ${r.accessControlAllowOrigin ?? "không có"} | ${r.fetchOkInPage ? "được" : "lỗi: " + r.fetchError} |`);
  md.push("", "Lưu ý: câu thử CORS vòng 1 \"omachi mi khoai tay\" là tên một sản phẩm có trong truth.csv.", "");
}

const cg = readJson(path.join(dir, "chong-an-gian.json"));
if (cg) {
  md.push("## Chống ăn gian cho cách 2", "", `Còn **${cg.remaining}/${cg.total}** mã (${cg.rule})`, "",
    "| Mã | Ảnh vòng 1 chọn (dHash cả khung, bit) | Vòng 2: dHash nhỏ nhất | pHash nhỏ nhất | Kết luận tự động | Xem tay | Dùng được |", "|---|---|---|---|---|---|---|");
  for (const i of cg.items.filter((x) => x.v1?.chosen || x.usable)) {
    const id = i.v1?.chosen?.imgid ?? i.chosen?.imgid;
    const c = i.compares?.[id];
    const m = i.chosen?.imgid === id ? i.manualCheck : i.rejected?.find((x) => x.imgid === id)?.manual;
    md.push(`| ${i.code} | imgid ${id} (${i.v1?.chosen?.distance ?? "–"}) | ${c?.dMin ?? "–"} | ${c?.pMin ?? "–"} | ${c?.verdict ?? "–"} | ${m ? `${m.verdict}: ${m.note ?? ""}` : "–"} | ${i.usable && i.manualCheck?.verdict === "khác" ? `có (imgid ${i.chosen.imgid})` : "không: " + (i.reason ?? "")} |`);
  }
  md.push("");
}
fs.writeFileSync(path.join(dir, outName), md.join("\n"), "utf8");
console.log(md.join("\n"));
