// Gom kết quả vòng 1 thành bảng tóm tắt D:\tmp\chup-mat-do\ket-qua\tong-hop-v1.md
// (đọc 1a/1b-<trình duyệt>.json, cors.json, chong-an-gian.json, off-stats-v1.json nếu có).
//
//   node chup-mat-do/tong-hop.mjs [--dir D:\tmp\chup-mat-do\ket-qua]
import fs from "node:fs";
import path from "node:path";
import { summarize, median, maxOf, MAX_WORDS, NAME_OVERLAP, DHASH_NEAR } from "./lib.mjs";

const argv = process.argv.slice(2);
const dir = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : "D:\\tmp\\chup-mat-do\\ket-qua";
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const mb = (b) => (b == null ? "–" : (b / 1024 / 1024).toFixed(0));
const sec = (x) => (x == null ? "–" : x.toFixed(1));
const pct = (a, n) => (n ? `${a}/${n} (${Math.round((100 * a) / n)}%)` : "–");

const names = ["1a-chromium", "1a-webkit", "1b-chromium", "1b-webkit"];
const md = ["# Tổng hợp vòng 1 – đợt chup-mat-do", "", `Tạo lúc ${new Date().toISOString()}.`, ""];
md.push(
  "Cách đo: chữ OCR của front.jpg -> từ khóa -> tìm Open Food Facts (cgi/search.pl, lọc Việt Nam, 5 kết quả đầu; 0 kết quả thì tìm 1 lần không lọc) -> so với test-ocr/truth.csv.",
  `S2 là chiến lược MẶC ĐỊNH (chốt trước khi chạy): dòng ≥ 3 chữ cái, bỏ số / đơn vị / cụm chung, tối đa ${MAX_WORDS} từ theo thứ tự đọc. S1: dòng chữ cao nhất trước. S3: như S2, thương hiệu (danh sách lấy từ OFF) đứng đầu.`,
  `Đúng tên / thương hiệu: so tên + thương hiệu của kết quả đầu với truth (bỏ dấu; chứa nhau hoặc trùng từ ≥ ${NAME_OVERLAP * 100}% số từ của chuỗi ngắn).`,
  "Mẫu số = số ảnh đọc được (OCR chạy xong). 31 mã trong truth.csv, 30 mã có front.jpg (8934673818391 không có).",
  "",
);

const head = "| Cách | Trình duyệt | Ảnh chạy được | Chiến lược | Đúng mã vị trí 1 | Trong 5 đầu | Đúng tên | Đúng thương hiệu | Lỗi OFF | Phải bỏ lọc VN |";
const rows = [head, "|---|---|---|---|---|---|---|---|---|---|"];
const perf = ["| Cách | Trình duyệt | Nạp (s) | Giây OCR / ảnh trung vị | lớn nhất | Giây tìm OFF trung vị (S2, không cache) | lớn nhất | Bộ nhớ đỉnh (working set cả cây, MB) | JS heap đỉnh (MB) | Byte tải lần đầu (MB qua mạng) | Giải nén (MB) |",
  "|---|---|---|---|---|---|---|---|---|---|---|"];
for (const name of names) {
  const r = readJson(path.join(dir, `${name}.json`));
  const [cach, br] = name.split("-");
  if (!r) { rows.push(`| ${cach} | ${br} | chưa chạy | | | | | | | |`); continue; }
  const ok = r.items.filter((i) => i.status === "ok");
  const label = (k) => (k === r.defaultStrategy ? `**${k} (mặc định)**` : k);
  for (const k of ["S1", "S2", "S3"]) {
    const sc = ok.map((i) => i.strategies[k]);
    const s = summarize(sc);
    rows.push(`| ${cach} | ${br} | ${ok.length}/${r.items.length} | ${label(k)} | ${pct(s.top1, s.n)} | ${pct(s.top5, s.n)} | ${pct(s.nameOk, s.nameN)} | ${pct(s.brandOk, s.brandN)} | ${sc.filter((x) => x.error).length} | ${sc.filter((x) => x.vnFallback).length} |`);
  }
  const ref = ok.map((i) => i.reference).filter(Boolean);
  if (ref.length) {
    const s = summarize(ref);
    rows.push(`| ${cach} | ${br} | ${ok.length}/${r.items.length} | S2 + search-a-licious (tham khảo, không CORS) | ${pct(s.top1, s.n)} | ${pct(s.top5, s.n)} | ${pct(s.nameOk, s.nameN)} | ${pct(s.brandOk, s.brandN)} | ${ref.filter((x) => x.error).length} | ${ref.filter((x) => x.vnFallback).length} |`);
  }
  const ocrS = ok.map((i) => i.giayOcr);
  const offS = ok.map((i) => i.strategies[r.defaultStrategy]).filter((x) => !x.cached && x.offSeconds != null).map((x) => x.offSeconds);
  const memImg = ok.map((i) => i.boNho?.peakTotalWs).filter((x) => x != null);
  const memPeak = Math.max(r.run?.memory?.peakTotalWs ?? 0, ...memImg) || null;
  perf.push(`| ${cach} | ${br} | ${sec(r.run?.loadSeconds)} | ${sec(median(ocrS))} | ${sec(maxOf(ocrS))} | ${offS.length ? sec(median(offS)) : "– (toàn cache)"} | ${offS.length ? sec(maxOf(offS)) : "–"} | ${mb(memPeak)} | ${br === "chromium" ? mb(r.run?.jsHeapPeak) : "không đo được (WebKit không có CDP)"} | ${r.firstLoad ? (r.firstLoad.transfer / 1e6).toFixed(1) : "chưa đo"} | ${r.firstLoad ? (r.firstLoad.decoded / 1e6).toFixed(1) : "–"} |`);
}
md.push("## Độ đúng", "", ...rows, "", "## Tốc độ, bộ nhớ, dung lượng", "", ...perf, "",
  "- Bộ nhớ: đỉnh working set (phần đang nằm trong RAM) của cả cây tiến trình trình duyệt, lấy mẫu mỗi 250 ms bằng PowerShell (Windows). WebKit Windows có tiến trình Playwright.exe nền khoảng 0,8 GB; số trên điện thoại sẽ khác.",
  "- Byte tải lần đầu: chạy lại ở chế độ cdn (jsDelivr / HuggingFace, bộ nhớ đệm trống), 1 ảnh, cộng byte qua mạng (Playwright request.sizes()).",
  "- Giây tìm OFF: thời gian mạng của lượt tìm mặc định (không tính lúc chờ giãn cách 6 giây); lượt lấy từ cache không tính.",
  "");

const stats = readJson(path.join(dir, "off-stats-v1.json"));
if (stats) {
  const all = [];
  for (let s = stats; s; s = s.previous) if (s.lastRun) all.push(s.lastRun);
  md.push("## Số lượt gọi Open Food Facts", "", "| Lần chạy | Tìm | Đọc sản phẩm | Khác (thương hiệu) | Lấy từ cache | Lỗi 429 / 5xx | Thử lại | Hỏng hẳn | Bỏ lọc VN |", "|---|---|---|---|---|---|---|---|---|");
  for (const s of all.reverse()) md.push(`| ${s.at} (${(s.tools || []).join(", ")}) | ${s.search} | ${s.product} | ${s.other} | ${s.cacheHits} | ${s.http429or5xx} | ${s.retries} | ${s.failures} | ${s.vnFallback} |`);
  md.push("");
}

const cors = readJson(path.join(dir, "cors.json"));
if (cors) {
  md.push("## CORS (gọi thẳng từ trình duyệt)", "", `Kiểu mặc định đã chọn: **${cors.chosen ?? "không có"}**. ${cors.rule}`, "", "| Kiểu | Trình duyệt | Lần | HTTP | access-control-allow-origin | fetch trong trang |", "|---|---|---|---|---|---|");
  for (const r of cors.results) md.push(`| ${r.kind} | ${r.browser} | ${r.attempt ?? 1} | ${r.httpStatus ?? "không đọc được"} | ${r.accessControlAllowOrigin ?? "không có"} | ${r.fetchOkInPage ? "được" : "lỗi: " + r.fetchError} |`);
  md.push("", cors.noteErrors ?? "", cors.note ?? "", "");
}

const cg = readJson(path.join(dir, "chong-an-gian.json"));
if (cg) {
  md.push("## Chống ăn gian cho cách 2", "", `Còn **${cg.remaining}/${cg.total}** mã có ảnh mặt trước khác front.jpg (khác imgid và dHash cách > ${cg.threshold ?? DHASH_NEAR}/64 bit).`, "");
}
fs.writeFileSync(path.join(dir, "tong-hop-v1.md"), md.join("\n"), "utf8");
console.log(md.join("\n"));
