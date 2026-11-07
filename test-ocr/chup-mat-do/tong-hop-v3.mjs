// Bảng kết quả vòng 3 (cách 2 + T1 + RRF), nối vào cuối D:\tmp\chup-mat-do\ket-qua\tong-hop-v3.md
// (phần đầu file – ghi chú + khối CHỐT – viết TRƯỚC khi chạy đo, script này không sửa phần đó).
//
//   node chup-mat-do/tong-hop-v3.mjs
//
// Chỉ đọc JSON kết quả (không gọi mạng). Phần cũ từ dòng "<!-- KẾT QUẢ -->" trở xuống được thay mới.
import fs from "node:fs";
import path from "node:path";
import { imageDownloadCounts, queryDownloadsText, fmtRank, fmtMs, unusableTestCount, downloadErrorsByStep } from "./tong-hop-lib.mjs";

const K = "D:\\tmp\\chup-mat-do\\ket-qua";
const C = "D:\\tmp\\chup-mat-do\\chi-muc";
const D = "D:\\tmp\\chup-mat-do\\du-lieu";
const rj = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const mb = (b) => (b == null ? "–" : (b / 1e6).toFixed(1));
const kb = (b) => (b == null ? "–" : (b / 1e3).toFixed(1));
const f2 = (x) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(2));
const L = [];
const p = (s = "") => L.push(s);

const vn = rj(path.join(D, "vn-stats.json"));
const dm = rj(path.join(C, "danh-muc-info.json"));
const chon = rj(path.join(C, "chon.json"));
const loo = rj(path.join(C, "loo.json"));
const cag = rj(path.join(K, "chong-an-gian.json"));
const SIDE_CODE = "8934572260543";
const nUnusable = cag ? unusableTestCount(cag, SIDE_CODE) : "–";
p("<!-- KẾT QUẢ -->");
p("## P1 – Dữ liệu");
if (vn) {
  p(`- Nguồn: cách a – bản xuất JSONL chính thức ${vn.url} (S3 openfoodfacts-ds), ${mb(vn.gzBytes)} MB nén, ${vn.lines} dòng, ${f2(vn.minutes)} phút (tải + lọc cùng lúc). Giấy phép: ODbL 1.0 (cơ sở dữ liệu), DbCL 1.0 (nội dung), ảnh CC BY-SA 3.0 (trang https://world.openfoodfacts.org/data).`);
  p(`- Sản phẩm VN (countries_tags có en:vietnam): ${vn.vnProducts}; có ảnh mặt trước đã chọn: ${vn.vnWithFront}; có unique_scans_n: ${vn.vnWithScans}; có ≥ 2 ảnh mặt trước khác imgid: ${vn.vnWithTwoFronts}.`);
}
if (dm) p(`- Danh mục chữ T1: ${dm.docs} sản phẩm, ${kb(dm.rawBytes)} KB thô, ${kb(dm.gzipBytes)} KB gzip; mã thử có trong danh mục ${dm.testCodesInCatalog}/31${dm.testCodesMissing.length ? ` (thiếu: ${dm.testCodesMissing.join(", ")})` : ""}.`);
if (chon) {
  const ds = chon.downloadStats || {};
  if (chon.n < 1000) p(`- Chốt "đúng 1.000 sản phẩm" không đạt được: bản xuất chỉ có ${chon.n} sản phẩm VN có ảnh mặt trước dùng được (sau khi bỏ ${nUnusable} mã thử không dùng được, đếm từ chong-an-gian.json) -> chỉ mục lấy hết ${chon.n}.`);
  p(`- Chỉ mục ảnh: chọn ${chon.n} sản phẩm (mã thử: ${chon.selected.filter((s) => s.test).map((s) => s.code).join(", ")}); ảnh 400 px có ${ds.ok ?? "–"}/${chon.n} (tải mới ${ds.downloads ?? "–"}, có sẵn ${ds.cached ?? "–"}, lỗi ${ds.errors ?? "–"}, 429/5xx ${ds.http429or5xx ?? "–"}, lỗi mạng ${ds.networkErrors ?? "–"}, cầu dao ${ds.breakerTrips ?? 0}${ds.stoppedByTime ? ", DỪNG VÌ HẾT GIỜ" : ""}; ${mb(ds.bytes)} MB). Nguồn ảnh: bucket AWS dữ liệu mở của OFF (openfoodfacts-images).`);
}
if (loo) {
  p(`- Bộ phụ leave-one-out: ${loo.candidates} ứng viên, đã kiểm ${loo.checked}, còn ${loo.pairs.length} cặp (> 24 bit), loại ${loo.dropped.length}; ảnh truy vấn không nằm trong chỉ mục: ${loo.queryNotInIndex ? "đúng" : "SAI"}.`);
  const dists = loo.pairs.map((x) => x.distance).filter(Number.isFinite);
  if (dists.length) p(`- ${loo.pairs.length} cặp bộ phụ ở ${Math.min(...dists)}–${Math.max(...dists)} bit (${dists.filter((d) => d <= 30).length} cặp ≤ 30 bit, sát ngưỡng): mã băm tính bằng sharp (Node), còn ngưỡng 24 chỉnh theo canvas Chromium (chong-an-gian.mjs).`);
}
p();

p("## P2 – Cách 2: tìm theo hình");
const nPairs = loo?.pairs?.length ?? "–";
p(`| Model | Giấy phép | Trình duyệt | Bộ chính (2 mã dùng được trên 31) | Dòng phụ xem tay (3 mã) | Bộ phụ (${nPairs} cặp) | Giây/ảnh trung vị / lớn nhất | Nạp model (giây, gồm tải mạng lúc cache trống + chỉ mục + 1 lần chạy nóng) | Tải lần đầu MB (thư viện + model + chỉ mục) | Chỉ mục MB thô / gzip | Bộ nhớ đỉnh WS MB | JS heap MB (*) | Backend | Khớp chỉ mục (cos nhỏ nhất) |`);
p("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const rankOfRow = (r) => { const i = (r.top5 || []).findIndex((c) => String(c).replace(/^0+/, "") === String(r.code).replace(/^0+/, "")); return i < 0 ? null : i + 1; };
const cach2 = {};
for (const m of ["clip", "dinov2"]) {
  const info = rj(path.join(C, m, "info.json"));
  for (const b of ["chromium", "webkit"]) {
    const r = rj(path.join(K, `cach2-${m}-${b}.json`))?.run;
    if (!r) continue;
    cach2[`${m}-${b}`] = r;
    const lic = m === "clip" ? "MIT" : "Apache-2.0";
    if (r.error && !r.results) { p(`| ${m} | ${lic} | ${b} | LỖI: ${r.error.slice(0, 160)} | | | | | | | | | | |`); continue; }
    const res = r.results || [];
    const set = (s) => res.filter((x) => s.includes(x.set));
    const cnt = (rows) => fmtRank(rows.filter((x) => rankOfRow(x) === 1).length, rows.filter((x) => rankOfRow(x) != null).length, rows.length);
    const secs = res.map((x) => x.seconds).filter(Number.isFinite).sort((a, b2) => a - b2);
    const med = secs.length ? secs[Math.floor(secs.length / 2)] : null;
    const fl = r.firstLoadBytes || {};
    const cosMin = r.check?.length ? Math.min(...r.check.map((c) => c.cos)) : null;
    p(`| ${m} | ${lic} | ${b === "webkit" && r.shimOffscreen ? "webkit (lớp thay OffscreenCanvas)" : b} | ${cnt(set(["chinh"]))} | ${cnt(set(["chinh", "phu-xem-tay"]))} | ${cnt(set(["bo-phu"]))} | ${f2(med)} / ${f2(secs.at(-1))} | ${f2(r.loadSeconds)} | ${mb(fl.library + fl.model + fl.index)} (${mb(fl.library)} + ${mb(fl.model)} + ${mb(fl.index)}) | ${mb(info?.rawBytes)} / ${mb(info?.gzipBytes)} | ${mb(r.memory?.wsPeak)} | ${r.memory?.jsHeapPeak ? mb(r.memory.jsHeapPeak) : "–"} | ${r.backend}${r.gpuAdapter ? " (có WebGPU adapter, không dùng)" : ""} | ${f2(cosMin)} |`);
  }
}
for (const m of ["clip", "dinov2"]) {
  const k = rj(path.join(K, "khop-node", `cach2-${m}-chromium.json`))?.run;
  const ib = rj(path.join(C, m, "info-trinh-duyet.json"));
  if (k?.check) p(`- Khớp Node – trình duyệt (${m}, 5 ảnh, Chromium so với vector Node int8): cosine ${f2(Math.min(...k.check.map((c) => c.cos)))}–${f2(Math.max(...k.check.map((c) => c.cos)))} (${k.check.map((c) => c.cos.toFixed(4)).join(", ")}). ${Math.min(...k.check.map((c) => c.cos)) < 0.99 ? "< 0,99 nên chỉ mục tính bằng trình duyệt (Chromium)" : "≥ 0,99"}${ib ? `: ${ib.n} ảnh, ${f2(ib.seconds)} giây` : ""}. Cột "Khớp" trong bảng = cosine vector truy vấn với vector chỉ mục trình duyệt (chỉ còn sai số int8).`);
}
for (const b of ["clip", "dinov2"]) {
  const w = cach2[`${b}-webkit`];
  if (w?.shimOffscreen) p(`- WebKit (${b}): Playwright WebKit trên Windows báo "OffscreenCanvas not supported by this environment" (lần chạy đầu, giữ ở cach2-${b}-webkit-loi.json); số WebKit trong bảng đo với lớp thay OffscreenCanvas bằng <canvas> thường (?shim=1). Safari 17+ trên iPhone có OffscreenCanvas thật: cần thử điện thoại thật.`);
}
if (cach2["clip-webkit"]?.shimOffscreen || cach2["dinov2-webkit"]?.shimOffscreen) p("- Độ chính xác WebKit = Chromium; chỉ giây và bộ nhớ là số riêng, có thể bị lớp thay ảnh hưởng.");
p(`- Mẫu số: bộ chính = 2 mã theo luật tự động (2/31); dòng phụ xem tay = 2 + ${SIDE_CODE} (3 mã, xem tay); bộ phụ = cặp leave-one-out. Vị trí 1 / 5 đầu đếm trên mẫu số đó.`);
p("- Bộ nhớ: working set (WS) cả cây tiến trình trình duyệt (đỉnh, gồm trình duyệt trống). (*) JS heap qua CDP, chỉ Chromium: chỉ vùng nhớ JS, KHÔNG gồm bộ nhớ wasm / model; xem cột WS.");
p();

const t1 = rj(path.join(K, "t1.json"));
p("## P3 – T1: tìm theo chữ trên danh mục VN cục bộ (BM25)");
if (t1) {
  p(`- Danh mục ${t1.catalog.docs} sản phẩm, tải về ${kb(t1.catalog.rawBytes)} KB thô / ${kb(t1.catalog.gzipBytes)} KB gzip; mã thử có trong danh mục ${t1.testCodesInCatalog}/31 (mã không có tính là sai).`);
  p("| Nguồn chữ | Vị trí 1 | Trong 5 đầu | Mẫu số |");
  p("|---|---|---|---|");
  const denom = { "1a-chromium": 30, "1a-webkit": 30, "1d": 30, "4a": 12 };
  for (const [k, v] of Object.entries(t1.tools)) p(`| ${k} | ${v.top1} | ${v.top5} | ${denom[k]} (có chữ: ${v.n}) |`);
  for (const [b, v] of Object.entries(t1.browser || {})) p(`- ${b}: ${v.error ? `LỖI ${v.error}` : `tải danh mục ${f2(v.fetchMs)} ms, dựng BM25 ${f2(v.buildMs)} ms, tìm 1 câu trung vị ${fmtMs(v.searchMsMedian)} / lớn nhất ${fmtMs(v.searchMsMax)} (${v.queries} câu)`}`);
}
const s = (f) => { const r = rj(path.join(K, f)); return r ? { top1: r.items.filter((i) => i.strategies?.S2?.top1).length, top5: r.items.filter((i) => i.strategies?.S2?.inTop5).length, err: r.items.filter((i) => i.strategies?.S2?.error).length } : null; };
const d1 = s("1d-v2.json"); const d2 = s("1d.json"); const g1 = s("4a-v2.json"); const g2 = s("4a.json");
if (d1 && d2) p(`- Tìm lại dòng "Lỗi OFF" qua search.pl S2: 1d lỗi ${d1.err} -> ${d2.err}, trong 5 đầu ${d1.top5}/30 -> ${d2.top5}/30 (vị trí 1 ${d1.top1} -> ${d2.top1}); 4a lỗi ${g1?.err} -> ${g2?.err}, trong 5 đầu ${g1?.top5}/12 -> ${g2?.top5}/12.`);
p();

const rr = rj(path.join(K, "rrf.json"));
p("## P4 – Kết hợp T1 + ảnh (RRF k = 60)");
if (rr) {
  p(`- Model ảnh: ${rr.model} (Chromium); ${rr.note}.`);
  p("| Bộ | T1 | Ảnh | T1 + ảnh |");
  p("|---|---|---|---|");
  for (const [k, v] of [[`Bộ phụ (${rr.boPhu.n} cặp)`, rr.boPhu], ["Bộ chính (2 mã dùng được trên 31)", rr.chinh], ["Dòng phụ xem tay (3 mã)", rr.phuXemTay]]) p(`| ${k} | ${fmtRank(v.t1.top1, v.t1.top5, v.n)} | ${fmtRank(v.img.top1, v.img.top5, v.n)} | ${fmtRank(v.rrf.top1, v.rrf.top5, v.n)} |`);
  p("- RRF hòa điểm thì T1 đứng trước (lib.mjs rrf: bằng điểm thì mã xuất hiện sớm hơn, danh sách T1 đưa vào trước).");
  p(`- n = ${rr.boPhu.n}, chênh ${rr.boPhu.img.top1} -> ${rr.boPhu.rrf.top1} (vị trí 1, ảnh -> T1 + ảnh) chưa đủ để kết luận.`);
  p(`- Chỉ mục ảnh bỏ ${nUnusable} mã thử, danh mục T1 đủ ${t1?.testCodesInCatalog ?? "–"}: hai phía RRF khác tập ứng viên.`);
  if (rr.boPhu.ocrOk != null) p(`- Bộ phụ: 1a đọc được chữ ${rr.boPhu.ocrOk}/${rr.boPhu.n} ảnh (ảnh không có chữ: T1 rỗng).`);
} else p("- Chưa chạy.");
const st = rj(path.join(K, "off-stats-v3-p3.json"))?.lastRun;
p(`- T2 (search.pl nhiều câu) KHÔNG chạy: OFF không ổn (P3.2: ${st ? `${st.networkErrors} lỗi mạng / ${st.search} lượt tìm` : "– (không có off-stats-v3-p3.json)"}, 503 không kèm CORS).`);
p();

p("## Lượt gọi Open Food Facts vòng 3");
if (st) p(`- search.pl (P3.2, qua Chromium): ${st.search} lượt tìm, ${st.cacheHits} lần trúng cache, ${st.networkErrors} lỗi mạng, ${st.http429or5xx} lỗi 429/5xx, ${st.retries} lần thử lại, ${st.failures} hỏng, cầu dao ${st.breakerTrips}.`);
if (vn) p(`- Bản xuất: 1 lượt tải (${vn.attempts} lần, ${vn.failures} hỏng) + đếm tay (không có file số): 5 lượt HEAD xem cỡ (curl, có / không theo chuyển hướng) + 1 lượt đọc trang /data (Chromium) + 2 lượt đọc thử 3 MB đầu file + 1 lượt đo tốc độ 50 MB.`);
const imgDl = imageDownloadCounts(chon, loo);
// vòng 5 (g1): số lỗi riêng từng bước (bộ đếm của loo có thể gồm cả phần của chon khi chạy chung tiến trình: không cộng).
const de = downloadErrorsByStep({ chon: chon?.downloadStats, loo: loo?.downloadStats }).map((e) => `${e.step}: ${e.http429or5xx} lỗi 429/5xx, ${e.networkErrors} lỗi mạng, cầu dao ${e.breakerTrips}`).join("; ");
if (chon?.downloadStats) p(`- Ảnh: ${imgDl.index} lượt tải ảnh chỉ mục + ${queryDownloadsText(imgDl.query)} lượt ảnh truy vấn bộ phụ (bucket AWS, giãn 1 giây); lỗi theo từng bước (không cộng, bộ đếm loo có thể gồm phần của chon): ${de}. Không gọi đọc sản phẩm (API product) ở vòng này.`);
p();

const file = path.join(K, "tong-hop-v3.md");
const head = fs.readFileSync(file, "utf8").split("<!-- KẾT QUẢ -->")[0].trimEnd();
fs.writeFileSync(file, `${head}\n\n${L.join("\n")}\n`, "utf8");
console.log(L.join("\n"));
