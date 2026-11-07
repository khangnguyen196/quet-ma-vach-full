// Bảng kết quả vòng 5 (SmolVLM đo lại, 4b Ollama, precache, trang thử), nối vào cuối
// D:\tmp\chup-mat-do\ket-qua\tong-hop-v5.md (phần đầu – ghi chú + khối CHỐT – viết TRƯỚC khi đo, script này không sửa).
//
//   node chup-mat-do/tong-hop-v5.mjs
//
// Chỉ đọc file (JSON kết quả, dist/sw.js của worktree); không gọi mạng. Phần từ "<!-- KẾT QUẢ -->" trở xuống thay mới.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fmtRank, rankCell, runTimeText } from "./tong-hop-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const K = "D:\\tmp\\chup-mat-do\\ket-qua";
const DIST = path.join(HERE, "..", "..", "dist");
const rj = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const mb = (b) => (b == null ? "–" : (b / 1e6).toFixed(1));
const gb = (b) => (b == null ? "–" : (b / 1e9).toFixed(2));
const kb = (b) => (b == null ? "–" : (b / 1024).toFixed(1));
const f1 = (x) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(1));
const L = [];
const p = (s = "") => L.push(s);

p("<!-- KẾT QUẢ -->");
// ---- P1 ----
p("## P1 – Sửa theo code-reviewer vòng 4");
const xt = rj(path.join(K, "xem-tay-mo-rong.json"));
if (xt) {
  const cnt = {};
  for (const x of xt.pairs) cnt[x.verdict ?? "chưa xem"] = (cnt[x.verdict ?? "chưa xem"] || 0) + 1;
  p(`- Xem tay ${xt.pairs.length} cặp bộ phụ mở rộng (${xt.rule}; chọn lúc ${xt.chonLuc}, xem lúc ${xt.xemLuc ?? "–"}): ${Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  for (const x of xt.pairs) p(`  - cặp ${x.thuTu} (${x.code}, ${x.distance} bit): ${x.verdict}${x.ghiChu ? ` – ${x.ghiChu}` : ""}`);
}
p("- tong-hop-v3.md / tong-hop-v4.md chạy lại (khoảng bit, câu đối thủ, giờ chạy, ô \"–\", lỗi tải theo bước); số đúng / sai không đổi.");
p();

// ---- P2 ----
p("## P2 – SmolVLM-256M đo lại lúc máy rảnh (Chromium wasm, 1 ảnh)");
p("| Lượt | dtype | Giờ chạy (UTC) | Nạp model (giây) | Ảnh chạy xong | Dừng | WS đỉnh MB |");
p("|---|---|---|---|---|---|---|");
const smol = ["cach3-smolvlm-chromium-thu1-q4-ranh.json", "cach3-smolvlm-chromium-thu1-q8-ranh.json", "cach3-smolvlm-chromium-thu1-fp16-ranh.json"];
const smolRuns = smol.map((f) => ({ f, r: rj(path.join(K, f))?.run })).filter((x) => x.r);
for (const { f, r } of smolRuns) p(`| ${f.replace(/^cach3-|\.json$/g, "")} | ${r.dtype} | ${runTimeText(r)} | ${f1(r.loadSeconds)} | ${r.summary?.ok ?? 0}/${r.planned} | ${r.stoppedReason || r.error || "–"} | ${mb(r.memory?.wsPeak)} |`);
const allSlow = smolRuns.length === 3 && smolRuns.every(({ r }) => !(r.summary?.ok > 0) && /120 giây/.test(r.stoppedReason || ""));
p(allSlow ? "- Kết luận: q4, q8, fp16 đều > 120 giây/ảnh khi máy rảnh (giờ chạy ở bảng; q4 từ vòng 4) -> theo CHỐT không có kiểu nào chạy được 1 ảnh ≤ 120 giây: không đo 30 ảnh / WebKit." : "- Kết luận: xem bảng (có kiểu chạy được ≤ 120 giây).");
p();

// ---- P3 ----
p("## P3 – 4b: AI ảnh trên máy qua Ollama (chỉ máy tính / máy chủ)");
const runs4b = fs.readdirSync(K).filter((f) => /^4b-.*\.json$/.test(f)).sort().map((f) => ({ f, r: rj(path.join(K, f))?.run })).filter((x) => x.r);
p("- Nguồn + giấy phép (đọc 08/11/2026): qwen2.5vl:3b từ thư viện Ollama chính thức (https://ollama.com/library/qwen2.5vl, cần Ollama ≥ 0.7.0); trang thư viện không ghi giấy phép, lớp license trong manifest Ollama là văn bản Apache License 2.0; model gốc Qwen/Qwen2.5-VL-3B-Instruct trên HuggingFace ghi license_name \"qwen-research\" – file LICENSE \"Qwen RESEARCH LICENSE AGREEMENT\" (chỉ dùng nghiên cứu / phi thương mại). Chỉ dùng đo trên máy, không đưa vào app.");
p("- Dự phòng moondream (https://ollama.com/library/moondream; gốc vikhyatk/moondream2 Apache-2.0): chỉ chạy nếu qwen2.5vl:3b không nạp / ảnh đầu > 300 giây. Vintern-1B-v3_5: không có bản Ollama chính thức, không dựng thêm môi trường.");
p("| Model (digest) | Ollama | Ảnh chạy / dự kiến | JSON đọc được | T1 vị trí 1 (mẫu số 30) | T1 5 đầu (mẫu số 30) | T1 (mẫu số = số ảnh chạy) | Đúng tên / thương hiệu | Giây/ảnh trung vị / lớn nhất | Nạp lần đầu (giây) | Dung lượng model GB | Bộ nhớ đỉnh WS ollama* MB | RAM trống trước / sau chạy / sau tắt GB | Giờ chạy | Dừng / lỗi |");
p("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const { f, r } of runs4b) {
  const s = r.summary || {};
  p(`| ${r.model} (${r.modelInfo?.digest?.slice(0, 12) ?? "–"}) | ${r.ollamaVersion ?? "–"} | ${s.ok ?? 0} / ${r.planned} | ${s.parsedOk ?? 0}/${s.ok ?? 0} | ${s.top1Of30 ?? "–"} | ${s.top5Of30 ?? "–"} | ${rankCell(s)} | ${s.ok > 0 ? `tên ${s.nameOk}/${s.ok} · thương hiệu ${s.brandOk}/${s.ok}` : "–"} | ${f1(s.secondsMedian)} / ${f1(s.secondsMax)} | ${f1(r.loadSeconds)} | ${gb(r.modelInfo?.sizeBytes)} | ${mb(r.memory?.wsPeak)} | ${gb(r.ramBefore?.freeBytes)} / ${gb(r.ramAfterRun?.freeBytes)} / ${gb(r.ramAfterStop?.freeBytes)} (tổng ${gb(r.ramBefore?.totalBytes)}) | ${runTimeText({ startedAt: r.startedAt, wallSeconds: r.finishedAt ? (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000 : undefined })} | ${[r.error && `LỖI: ${r.error}`, r.stoppedReason].filter(Boolean).join("; ") || "–"} |`);
  p(`- ${f}: đầu vào ${r.input}; câu hỏi = geminiPrompt(); /api/generate format ${r.jsonMode ? "json" : "(không)"}, temperature 0, seed 0, num_ctx 4096, stream false, hết giờ ${r.perImageTimeoutS} giây/ảnh; serve đã dừng: ${r.serveStopped ? "có" : "KHÔNG"}. Chi tiết: model ${JSON.stringify(r.modelInfo?.details ?? {})}.`);
}
if (!runs4b.length) p("- Chưa có kết quả (xem báo cáo).");
p("- Máy: Intel i7-6820HQ (4 nhân / 8 luồng), RAM 8 GB, GPU Quadro M1000M 2 GB: Ollama (Vulkan) đặt 0/37 lớp lên GPU và tắt offload phần ảnh (\"limited-vram\") -> chạy CPU (ollama.log). Chi phí 0 (chạy trên máy).");
p("- T1 mẫu số 30 (như 4a): ảnh không chạy / lỗi tính là sai. Đúng tên / thương hiệu: textMatch(trường model đọc, đáp án truth.csv) như 4a.");
p();

// ---- P4 ----
p("## P4 – Danh sách lưu sẵn (precache) của service worker");
const sw = fs.existsSync(path.join(DIST, "sw.js")) ? fs.readFileSync(path.join(DIST, "sw.js"), "utf8") : null;
if (sw) {
  const pre = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)[1]);
  const distTest = ["ocr-thu.html", "chup-mat-do.html"].filter((f) => fs.existsSync(path.join(DIST, f)));
  const distMjs = ["ocr-thu", "chup-mat-do"].flatMap((d) => (fs.existsSync(path.join(DIST, d)) ? fs.readdirSync(path.join(DIST, d)).map((x) => `${d}/${x}`) : []));
  p(`- dist/sw.js (${new Date(fs.statSync(path.join(DIST, "sw.js")).mtimeMs).toISOString()}): PRECACHE ${pre.length} file; có chữ "ocr-thu": ${sw.includes("ocr-thu") ? "CÓ" : "không"}, "chup-mat-do": ${sw.includes("chup-mat-do") ? "CÓ" : "không"}, "wasm": ${sw.includes("wasm") ? "CÓ" : "không"}.`);
  p(`- dist/ vẫn có trang thử: ${distTest.join(", ") || "KHÔNG"}; ${distMjs.join(", ") || "không có thư mục module"}.`);
} else p("- Chưa build (không có dist/sw.js).");
p("- Bỏ khỏi precache: ocr-thu.html, chup-mat-do.html, mọi tên bắt đầu ocr-thu/ hoặc chup-mat-do/ (chỉ ở gốc; assets/… giữ). Giới hạn còn lại: sửa trang thử vẫn đổi VERSION app (versionOf băm mọi file) -> hiện thanh \"Đã có bản mới\".");
p();

// ---- P5 ----
p("## P5 – Trang thử public/chup-mat-do.html (PaddleOCR.js + T1, không CLIP)");
const dm = rj(path.join(K, "danh-muc-trang-thu.json"));
if (dm) p(`- Danh mục public/chup-mat-do/danh-muc-vn.json: ${dm.products} sản phẩm, ${kb(dm.rawBytes)} KB thô / ${kb(dm.gzipBytes)} KB gzip (mục tiêu ≤ ${kb(dm.targetGzipBytes)} KB gzip; ${dm.withNameBrand ? "có name / brand riêng" : "bỏ name / brand"}).`);
const par = rj(path.join(K, "trang-thu-parity.json"));
if (par) p(`- So khớp t1.mjs với bản Node (30 câu tìm 1a Chromium đã lưu): danh mục trùng ${par.catalogSame ? "đúng" : "SAI"}; câu tìm + top5 + điểm trùng ${par.same}/${par.n}.`);
const tc = rj(path.join(K, "trang-thu-local.json"));
if (tc) {
  p(`- trang-thu-check (bản build trên máy, ${tc.startedAt} → ${tc.finishedAt}; build ${tc.build ? `${tc.build.status === 0 ? "sạch" : "LỖI"} ${f1(tc.build.seconds)} giây` : "không chạy (--no-build)"}); 3 ảnh chốt trước = 3 mã đầu truth.csv có front.jpg: ${tc.images.join(", ")}.`);
  p("| Trình duyệt | Ảnh | Đúng mã trong 5 đầu (vị trí) | Giây (bấm → xong) | Đọc chữ (giây) | Tải PaddleOCR lần đầu (giây) | Tìm (ms) | Số dòng | Lỗi |");
  p("|---|---|---|---|---|---|---|---|---|");
  for (const [b, o] of Object.entries(tc.browsers)) {
    if (!o.runs.length) p(`| ${b} ${o.browserVersion ?? ""} | – | – | – | – | – | – | – | ${o.error ?? "không chạy ảnh nào"} |`);
    for (const r of o.runs) p(`| ${b} ${o.browserVersion ?? ""} | ${r.code} | ${r.error ? "–" : r.inTop5 ? `có (${r.rank})` : "không"} | ${f1(r.seconds)} | ${f1(r.ocrSeconds)} | ${f1(r.loadSeconds)} | ${f1(r.searchMs)} | ${r.lines ?? "–"} | ${r.error ?? "–"} |`);
  }
  for (const [b, o] of Object.entries(tc.browsers)) {
    const q = o.requests;
    p(`- ${b}: ${q ? `${q.total} request, host: ${q.hosts.join(", ")}; POST: ${q.post.length}; tới openfoodfacts.org: ${q.openfoodfacts.length}; host ngoài cùng tên miền + jsDelivr / HuggingFace: ${q.foreign.length ? q.foreign.join(", ") : "không"}` : "không có số request"}; index.html của app: ${o.app ? `HTTP ${o.app.status}, tiêu đề "${o.app.title}", ${o.app.hasBody ? "có nội dung" : "TRỐNG"}, lỗi trang ${o.app.pageErrors.length}` : "–"}${o.error ? `; LỖI: ${o.error}` : ""}${o.consoleErrors?.length ? `; lỗi console trang thử: ${o.consoleErrors.slice(0, 3).join(" | ")}` : ""}.`);
  }
  const t1 = rj(path.join(K, "t1.json"));
  if (t1) {
    for (const [b, o] of Object.entries(tc.browsers)) {
      const ref = t1.tools[`1a-${b}`]?.items || [];
      const same = o.runs.filter((r) => { const i = ref.find((x) => x.ma === r.code); return i && !r.error && i.top5.join(",") === (r.top5 || []).join(","); }).length;
      p(`- ${b}: top5 của trang trùng top5 T1 của 1a-${b} đã đo (t1.json) ở ${same}/${o.runs.length} ảnh.`);
    }
  }
  p("- WebKit = Playwright WebKit trên Windows, không lớp thay; Safari iPhone thật cần thử tay (vòng 6–7 trên Pages).");
} else p("- Chưa chạy trang-thu-check.");
p();

const file = path.join(K, "tong-hop-v5.md");
// dấu chỉ tính khi đứng riêng một dòng; phần đầu phải còn khối CHỐT (không thì dừng, không ghi đè)
const head = fs.readFileSync(file, "utf8").split(/^<!-- KẾT QUẢ -->$/m)[0].trimEnd();
if (!head.includes("CHỐT TRƯỚC KHI CHẠY")) throw new Error("phần đầu tong-hop-v5.md không còn khối CHỐT: dừng, không ghi");
fs.writeFileSync(file, `${head}\n\n${L.join("\n")}\n`, "utf8");
console.log(L.join("\n"));
