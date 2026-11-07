// Bảng kết quả vòng 4 (cách 3 + bộ phụ mở rộng), nối vào cuối D:\tmp\chup-mat-do\ket-qua\tong-hop-v4.md
// (phần đầu file – ghi chú + khối CHỐT – viết TRƯỚC khi chạy đo, script này không sửa phần đó).
//
//   node chup-mat-do/tong-hop-v4.mjs
//
// Chỉ đọc JSON kết quả (không gọi mạng). Phần cũ từ dòng "<!-- KẾT QUẢ -->" trở xuống được thay mới.
import fs from "node:fs";
import path from "node:path";
import { fmtRank, queryDownloadsText, rankCell, nameBrandCell, bitRange, runTimeText } from "./tong-hop-lib.mjs";

const K = "D:\\tmp\\chup-mat-do\\ket-qua";
const C = "D:\\tmp\\chup-mat-do\\chi-muc";
const rj = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const mb = (b) => (b == null ? "–" : (b / 1e6).toFixed(1));
const f1 = (x) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(1));
const L = [];
/** Giờ của bước P3 (mo-rong.mjs): file vòng 4 không có trường giờ. */
function uvTimes() {
  const st = rj(path.join(C, "mo-rong", "ung-vien.json"))?.stats;
  return st?.startedAt ? `chạy ${runTimeText({ startedAt: st.startedAt, wallSeconds: st.minutes * 60 })}` : "(không có giờ, chạy trước khi thêm trường)";
}
const p = (s = "") => L.push(s);

p("<!-- KẾT QUẢ -->");
p("## P2 – Cách 3: AI nhỏ trong trình duyệt (transformers.js 4.3.1, wasm)");
const runs = [];
for (const m of ["florence", "smolvlm"]) {
  for (const f of fs.readdirSync(K).filter((x) => x.startsWith(`cach3-${m}-`) && x.endsWith(".json")).sort()) {
    const r = rj(path.join(K, f))?.run;
    if (r) runs.push({ file: f, ...r });
  }
}
const first = (m) => runs.find((r) => r.model === m);
for (const m of ["florence", "smolvlm"]) {
  const r = first(m);
  if (r) p(`- ${m}: ${r.modelId} @ ${r.revision} (gốc: ${r.origin}); giấy phép ${r.license}.`);
}
p("");
p("| Lượt (file) | Model | Trình duyệt | dtype | Giờ chạy (UTC) | Ảnh chạy / dự kiến | T1 (mẫu số = số ảnh đã chạy) | T1 trên mẫu số 30 | Đúng tên / thương hiệu (S) | Giây/ảnh trung vị / lớn nhất | Nạp model (giây) (**) | Tải lần đầu MB (thư viện + model) | Bộ nhớ đỉnh WS MB | JS heap MB (*) | WebGPU adapter | Dừng / lỗi |");
p("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of runs) {
  const s = r.summary || {};
  const fl = r.firstLoadBytes || {};
  const br = r.browser === "webkit" && r.shimOffscreen ? "webkit (lớp thay OffscreenCanvas)" : r.browser;
  const smol = r.model === "smolvlm" ? nameBrandCell(s) : "–"; // vòng 5 (g2): lượt chưa chạy được ảnh nào -> "–"
  const stop = [r.error && `LỖI: ${r.error.slice(0, 160)}`, r.stoppedReason].filter(Boolean).join("; ") || "–";
  p(`| ${r.file.replace(/^cach3-|\.json$/g, "")} | ${r.model} | ${br} | ${r.dtype} | ${runTimeText(r)} | ${s.ok ?? 0} / ${r.planned} | ${rankCell(s)} | ${fmtRank(s.top1 ?? 0, s.top5 ?? 0, 30)} | ${smol} | ${f1(s.secondsMedian)} / ${f1(s.secondsMax)} | ${f1(r.loadSeconds)} | ${mb(fl.library + fl.model)} (${mb(fl.library)} + ${mb(fl.model)}) | ${mb(r.memory?.wsPeak)} | ${r.memory?.jsHeapPeak ? mb(r.memory.jsHeapPeak) : "–"} | ${r.gpuAdapter == null ? "–" : r.gpuAdapter ? "có (không dùng)" : "không"} | ${stop} |`);
}
p("- (*) JS heap qua CDP, chỉ Chromium: chỉ vùng nhớ JS, KHÔNG gồm bộ nhớ wasm / model; xem cột WS (working set cả cây tiến trình trình duyệt, gồm trình duyệt trống).");
p("- (**) Nạp model = import thư viện + tải model qua mạng (cache trống, ngữ cảnh trình duyệt mới) + tạo phiên onnxruntime-web; KHÔNG gồm lần chạy ảnh nào (ảnh đầu tính vào giây/ảnh).");
p("- Câu tìm: F -> dòng chữ qua usableLine (Florence <OCR> trả một chuỗi liền -> một dòng) -> T1 BM25 danh mục VN 1.452 sản phẩm; S -> mọi từ câu trả lời, bỏ \"|\", bỏ số / đơn vị -> T1. Đúng tên / thương hiệu (S): textMatch(câu trả lời đầy đủ, đáp án truth.csv).");
p("- Không gọi search.pl cho cách 3: vòng 2–3 search.pl gần như không ra kết quả, OFF không ổn.");
const smolRuns = runs.filter((r) => r.model === "smolvlm");
if (smolRuns.length && smolRuns.every((r) => !(r.summary?.ok > 0))) {
  // vòng 5 (g4): lời kể lấy từ file kết quả (dtype, giờ, lý do dừng), không viết cứng.
  p(`- SmolVLM-256M DỪNG (luật P2.3a): mọi kiểu số đã thử (${[...new Set(smolRuns.map((r) => r.dtype))].join(", ")}) không có câu trả lời cho ảnh đầu trên Chromium wasm. Từng lượt: ${smolRuns.map((r) => `${r.file.replace(/^cach3-|\.json$/g, "")} (${r.dtype}; ${runTimeText(r)}; nạp ${f1(r.loadSeconds)} giây; ${r.stoppedReason || r.error || "không ghi lý do"})`).join("; ")}. Không đo WebKit / 30 ảnh.`);
}
const fw = runs.filter((r) => r.model === "florence" && r.browser === "webkit");
if (fw.length && fw.every((r) => !(r.summary?.ok > 0))) {
  const how = (r) => (r.loadSeconds == null ? "sập khi đang nạp model" : `nạp xong (${f1(r.loadSeconds)} giây) rồi sập ở ảnh đầu`);
  p(`- Florence WebKit (Playwright WebKit trên Windows, lớp thay OffscreenCanvas): ${fw.length} lần, không có ảnh nào chạy xong. Từng lượt: ${fw.map((r) => `${r.file.replace(/^cach3-|\.json$/g, "")} (${runTimeText(r)}; ${how(r)}; lỗi trang "${r.consoleErrors?.[0] ?? "–"}"; WS đỉnh ${mb(r.memory?.wsPeak)} MB)`).join("; ")}. Không có số WebKit: chỉ đo được trên điện thoại thật.`);
}
p("- Florence: generation_config.json của model đặt num_beams 3, no_repeat_ngram_size 3; đo ghi đè num_beams 1, do_sample false (tham lam theo CHỐT), giữ no_repeat_ngram_size. Kiểu q4 chỉ lượng tử hóa MatMul, nên embed_tokens_q4.onnx vẫn ~158 MB.");
p(`- Chạy cùng lúc với việc khác: giờ từng lượt cách 3 ở cột "Giờ chạy"; bước đọc bản xuất / tải ảnh P3 (mo-rong.mjs) ${uvTimes()} nên không so được giờ bằng file. Lượt có hậu tố "-ranh" chạy khi máy rảnh (theo tên file).`);
p("- transformers.js 4.3.1 tải main/tokenizer_config.json không theo revision ghim (các file model khác theo revision ghi ở trên).");
p("- Đề xuất ngoài CHỐT (chưa đo): SmolVLM có thể chậm do processor chia ảnh thành nhiều ô (do_image_splitting); Florence <OCR_WITH_REGION> có thể tách dòng tốt hơn – chưa đo.");
for (const r of runs) {
  const by = r.firstLoadBytes?.byFile || {};
  const big = Object.entries(by).filter(([, v]) => v > 1e6).map(([k, v]) => `${k} ${mb(v)}`).join(", ");
  if (big) p(`- Tải lần đầu theo file (${r.file.replace(/^cach3-|\.json$/g, "")}): ${big}.`);
}
p();

const cap = rj(path.join(C, "mo-rong", "cap.json"));
const uv = rj(path.join(C, "mo-rong", "ung-vien.json"))?.stats;
const rr = rj(path.join(K, "rrf-mo-rong.json"));
const info = rj(path.join(C, "clip", "info-mo-rong.json"));
p("## P3 – Bộ phụ mở rộng (THAM KHẢO: chỉ mục có thêm sản phẩm ngoài VN, khác chỉ mục app)");
if (uv) {
  p(`- Đọc lại bản xuất trên máy (không tải lại): ${uv.lines} dòng, ${f1(uv.minutes)} phút, chế độ ${uv.mode}. Ứng viên nhóm ưu tiên: ${uv.group0}${uv.group1 != null ? `; nhóm còn lại: ${uv.group1}` : "; nhóm còn lại: không đọc (nhóm ưu tiên đủ)"}.`);
  p(`- Theo nước (một sản phẩm có thể thuộc nhiều nước): ${Object.entries(uv.byCountry).map(([k, v]) => `${k.replace("en:", "")} ${v}`).join(", ")}.`);
}
if (cap) {
  const ds = cap.downloadStats || {};
  p(`- Đã kiểm ${cap.checked} ứng viên; cặp dùng được ${cap.pairs.length}, loại ${cap.dropped.length} (gần trùng ≤ 24 bit: ${cap.dropped.filter((d) => /gần trùng/.test(d.reason)).length}, không tải được: ${cap.dropped.filter((d) => /không tải/.test(d.reason)).length}, khác: ${cap.dropped.filter((d) => !/gần trùng|không tải/.test(d.reason)).length}); ảnh truy vấn không nằm trong chỉ mục (kiểm bằng code): ${cap.queryNotInIndex ? "đúng" : "SAI"}.`);
  p(`- Ảnh (bucket AWS dữ liệu mở của OFF, 400 px, giãn ≥ 1 giây): tải ${ds.downloads} lượt (ảnh truy vấn ${queryDownloadsText(cap.queryDownloads)}), có sẵn ${ds.cached}, lỗi ${ds.errors}, 429/5xx ${ds.http429or5xx}, lỗi mạng ${ds.networkErrors}, cầu dao ${ds.breakerTrips}${ds.stoppedByBreaker ? " (NGỪNG HẲN)" : ""}${ds.stoppedByTime ? ", DỪNG VÌ HẾT GIỜ" : ""}; ${mb(ds.bytes)} MB; ${f1(cap.minutes)} phút.`);
}
if (cap) {
  const br = bitRange(cap.pairs);
  if (br) p(`- ${br.n} cặp bộ phụ mở rộng ở ${br.min}–${br.max} bit (${br.le30} cặp ≤ 30 bit, sát ngưỡng 24): mã băm tính bằng sharp (Node), ngưỡng 24 chỉnh theo canvas Chromium (như vòng 3).`);
}
const dmInfo = rj(path.join(C, "danh-muc-info.json"));
const rrX = rj(path.join(K, "rrf-mo-rong.json"));
if (rrX && dmInfo) p(`- Đáp án luôn có trong danh mục / chỉ mục (như bộ chính); đối thủ ngoài VN chỉ ${rrX.catalogDocs - dmInfo.docs} sản phẩm trong danh mục T1 (${rrX.catalogDocs} − ${dmInfo.docs})${info ? ` và ${info.ext} ảnh trong chỉ mục ảnh` : ""}, nhiều hàng chữ Latin; không so trực tiếp với bộ gốc.`);
const xt = rj(path.join(K, "xem-tay-mo-rong.json"));
if (xt) {
  const cnt = {};
  for (const x of xt.pairs) cnt[x.verdict ?? "chưa xem"] = (cnt[x.verdict ?? "chưa xem"] || 0) + 1;
  p(`- Xem tay ${xt.pairs.length} cặp (${xt.rule}): ${["cùng tấm chụp", "cùng mặt, khác lần chụp", "khác hẳn", "chưa xem"].filter((k) => cnt[k]).map((k) => `${k} ${cnt[k]}`).join(", ")}; khoảng bit các cặp xem: ${xt.pairs.map((x) => x.distance).join(", ")}. Chi tiết + ghi chú từng cặp: xem-tay-mo-rong.json.`);
}
if (info) p(`- Chỉ mục CLIP mở rộng (Chromium): ${info.n} ảnh = ${info.vn} VN + ${info.ext} ngoài VN (lỗi ${info.errors}), tính ${f1(info.seconds)} giây; không ghi đè chỉ mục vòng 3.`);
if (rr) {
  p(`- Danh mục T1 mở rộng: ${rr.catalogDocs} sản phẩm. ${rr.note}.`);
  p("| Bộ | T1 | Ảnh | T1 + ảnh | 1a có chữ |");
  p("|---|---|---|---|---|");
  for (const [k, v] of [[`Bộ phụ gốc (${rr.goc.n} cặp VN)`, rr.goc], [`Bộ phụ mở rộng (${rr.moRong.n} cặp)`, rr.moRong], [`Gộp (${rr.gop.n})`, rr.gop]]) {
    p(`| ${k} | ${fmtRank(v.t1.top1, v.t1.top5, v.n)} | ${fmtRank(v.img.top1, v.img.top5, v.n)} | ${fmtRank(v.rrf.top1, v.rrf.top5, v.n)} | ${v.ocrOk}/${v.n} |`);
  }
  const v3 = rj(path.join(K, "rrf.json"))?.boPhu;
  if (v3) p(`- So sánh: bộ phụ gốc trên chỉ mục / danh mục VN (vòng 3): T1 ${fmtRank(v3.t1.top1, v3.t1.top5, v3.n)}, ảnh ${fmtRank(v3.img.top1, v3.img.top5, v3.n)}, T1 + ảnh ${fmtRank(v3.rrf.top1, v3.rrf.top5, v3.n)}.`);
  p("- RRF hòa điểm thì T1 đứng trước. Ảnh truy vấn là ảnh mặt trước KHÁC do người dùng OFF tải lên (không cắt / xoay / làm mờ ảnh chỉ mục).");
} else p("- Chưa có bảng (xem lý do ở báo cáo).");
p();

const file = path.join(K, "tong-hop-v4.md");
const head = fs.readFileSync(file, "utf8").split("<!-- KẾT QUẢ -->")[0].trimEnd();
fs.writeFileSync(file, `${head}\n\n${L.join("\n")}\n`, "utf8");
console.log(L.join("\n"));
