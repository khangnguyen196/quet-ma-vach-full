// Test vòng 5 (không mạng, không đọc D:\tmp): trang thử public/chup-mat-do.html + chup-mat-do/t1.mjs, tar.mjs,
// danh-muc-vn.json, xuat-danh-muc.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../../web-ocr/assets.js"; // globalThis.OcrAssets
import * as webLib from "../../web-ocr/lib.mjs";
import * as node from "../vn-data.mjs";
import * as page from "../../../public/chup-mat-do/t1.mjs";
import * as tar from "../../../public/chup-mat-do/tar.mjs";
import { compareOne } from "../trang-thu-parity.mjs";
import { displayName, catalogJson } from "../xuat-danh-muc.mjs";

const PUBLIC = new URL("../../../public/", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, PUBLIC), "utf8");
const readOpt = (rel) => (fs.existsSync(new URL(rel, PUBLIC)) ? read(rel) : "");
// Đợt thu-r1: cấu hình OCR (1a / R1) + phần thuần (chọn theo ?ocr, nhận lỗi bộ nhớ) ở chup-mat-do/ocr-chon.mjs.
// Import động để file test vẫn chạy (các test cũ vẫn chấm) khi module chưa có.
const chon = await import("../../../public/chup-mat-do/ocr-chon.mjs").catch(() => ({}));
/** Mã của trang = chup-mat-do.html + các module JS của trang (t1.mjs, tar.mjs, ocr-chon.mjs). */
const pageSources = () => read("chup-mat-do.html") + readOpt("chup-mat-do/ocr-chon.mjs");

// ---------- bản trình duyệt trùng bản Node ----------
const DOCS = [
  { code: "8936017368111", text: "Mì khoai tây Omachi xốt Bò hầm Omachi Mì khoai tây" },
  { code: "8934563163150", text: "Mì Hảo Hảo tôm chua cay Acecook Việt Nam" },
  { code: "8935049500544", text: "Nước giải khát Sting dâu Sting" },
  { code: "8934588012112", text: "Trà xanh Không Độ C2 URC" },
  { code: "0001", text: "Omachi Omachi Omachi 80g" },
  { code: "0002", text: "Sữa tươi TH true MILK ít đường 180 ml" },
];
const LINES = [
  [{ text: "OMACHI", conf: 0.95 }, { text: "Mì khoai tây xốt bò hầm", conf: 0.8 }, { text: "80g", conf: 0.99 }],
  [{ text: "Hảo Hảo", conf: 0.4 }, { text: "TÔM CHUA CAY", conf: 0.9 }, { text: "Khối lượng tịnh 75g" }],
  [{ text: "Sting" }, { text: "hương dâu tây đỏ" }, { text: "rrr" }],
  [{ text: "TH true MILK", conf: 0.7 }, { text: "SỮA TƯƠI TIỆT TRÙNG ÍT ĐƯỜNG" }],
  [{ text: "Đ" }, { text: "12345" }],
  [],
];

test("t1.mjs: câu tìm + top5 + điểm trùng bản Node (lib.mjs + vn-data.mjs) trên dữ liệu mẫu", () => {
  const ni = node.buildBm25(DOCS);
  const pi = page.buildBm25(DOCS);
  for (const lines of LINES) {
    const r = compareOne(lines, ni, pi);
    assert.equal(r.same, true, JSON.stringify(r));
  }
  // từng hàm cùng kết quả trên chuỗi khó (dấu, đ, cụm chung, đơn vị)
  for (const s of ["Mì  Khoai-Tây ĐẬU", "Khối lượng tịnh: 80 g – Sản xuất tại Việt Nam", "7UP 330ml x2", ""]) {
    assert.deepEqual(page.bm25Tokens(s), node.bm25Tokens(s));
    assert.deepEqual(page.t1QueryFromLines([{ text: s }]), node.t1QueryFromLines([{ text: s }]));
  }
  assert.equal(page.BM25_K1, 1.2);
  assert.equal(page.BM25_B, 0.75);
});

test("t1.mjs rowLineInfo và tar.mjs makeTar trùng test-ocr/web-ocr/lib.mjs", () => {
  const box = (x, y, w, h, text, score) => ({ poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text, score });
  const items = [box(0, 0, 50, 40, "OMACHI", 0.9), box(60, 5, 30, 30, "MÌ", 0.7), box(0, 100, 80, 12, "80 g", 0.5), box(5, 200, 10, 10, " ")];
  assert.deepEqual(page.rowLineInfo(items), webLib.rowLineInfo(items));
  assert.deepEqual(page.rowLineInfo([]), webLib.rowLineInfo([]));
  const files = [{ name: "inference.yml", data: new TextEncoder().encode("x: 1\n") }, { name: "inference.onnx", data: new Uint8Array(700).fill(7) }];
  assert.deepEqual(tar.makeTar(files), webLib.makeTar(files));
});

test("t1.mjs, tar.mjs, ocr-chon.mjs không import gì (module thuần cho trình duyệt)", () => {
  for (const f of ["chup-mat-do/t1.mjs", "chup-mat-do/tar.mjs", "chup-mat-do/ocr-chon.mjs"]) assert.doesNotMatch(read(f), /^\s*import\b|\bimport\(/m, f);
});

// ---------- trang ----------
test("chup-mat-do.html (+ ocr-chon.mjs): URL CDN = HỢP bộ 1a (cdn, wasm) và bộ R1 của assets.js, đúng hệt; ngoài CDN chỉ có link OFF + link giấy phép ODbL", () => {
  const { VERSIONS, MODEL_VARIANTS, assetUrls } = globalThis.OcrAssets;
  const src = pageSources();
  const urls = [...new Set(src.match(/https?:\/\/[^\s"'`)<>]+/g))];
  const cdn = urls.filter((u) => /^https:\/\/(cdn\.jsdelivr\.net|huggingface\.co|www\.modelscope\.cn)\//.test(u));
  const hfModels = [...Object.values(MODEL_VARIANTS.det), ...Object.values(MODEL_VARIANTS.rec)];
  const r1Onnx = [MODEL_VARIANTS.det.r1.onnxUrl, MODEL_VARIANTS.rec.r1.onnxUrl];
  for (const u of cdn) {
    const url = new URL(u);
    if (url.hostname === "cdn.jsdelivr.net") {
      const m = url.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)(\/|$)/);
      assert.ok(m, `jsDelivr không có số bản: ${u}`);
      assert.equal(m[2], VERSIONS[m[1]], `${m[1]}`);
    } else if (url.hostname === "www.modelscope.cn") {
      // ModelScope: đúng onnxUrl ghim tag v3.10.0 của R1_MODELS
      assert.ok(r1Onnx.includes(u), `ModelScope không phải onnxUrl đã ghim: ${u}`);
      assert.match(url.pathname, /^\/models\/RapidAI\/RapidOCR\/resolve\/v3\.10\.0\//);
    } else {
      const m = url.pathname.match(/^\/([^/]+\/[^/]+)\/resolve\/([0-9a-f]{40})\//);
      const model = m && hfModels.find((x) => x.repo === m[1]);
      assert.ok(model && m[2] === model.rev, `HuggingFace không theo repo + mã commit đã ghim: ${u}`);
    }
  }
  const a = assetUrls("cdn", { webgpu: false });
  const r = assetUrls("cdn", { det: "r1", rec: "r1" });
  const want = [...new Set([a.paddleSdk, a.ort, a.ortWasmDir, a.opencv, a.clipper, a.jsYaml, a.detOnnx, a.detYml, a.recOnnx, a.recYml,
    r.detOnnx, r.detYml, r.recOnnx, r.recYml])];
  assert.equal(want.length, 14);
  assert.deepEqual([...cdn].sort(), [...want].sort());
  const other = urls.filter((u) => !cdn.includes(u));
  assert.deepEqual(other.sort(), ["https://opendatacommons.org/licenses/odbl/1-0/", "https://world.openfoodfacts.org", "https://world.openfoodfacts.org/product/"]);
});

test("ocr-chon.mjs: bảng cấu hình 1a / R1 (tên model, URL, tham số, giới hạn thời gian nạp) đúng assets.js; không dùng cls", () => {
  const { MODELS, MODEL_VARIANTS, PARAM_PRESETS, assetUrls } = globalThis.OcrAssets;
  assert.equal(typeof chon.OCR_CONFIGS, "object", "chưa có OCR_CONFIGS trong chup-mat-do/ocr-chon.mjs");
  assert.deepEqual(Object.keys(chon.OCR_CONFIGS), ["1a", "r1"]);
  assert.equal(chon.DEFAULT_OCR, "1a");
  const c1 = chon.OCR_CONFIGS["1a"];
  const a = assetUrls("cdn", { webgpu: false });
  assert.equal(c1.label, "PaddleOCR.js mobile (1a, mặc định)");
  assert.equal(c1.detName, MODELS.det.name);
  assert.equal(c1.recName, MODELS.rec.name);
  assert.deepEqual([c1.detOnnx, c1.detYml, c1.recOnnx, c1.recYml], [a.detOnnx, a.detYml, a.recOnnx, a.recYml]);
  assert.deepEqual(c1.params, {});
  assert.equal(c1.loadTimeoutMs, 120000);
  const cr = chon.OCR_CONFIGS.r1;
  const r = assetUrls("cdn", { det: "r1", rec: "r1", params: "r1" });
  assert.equal(cr.label, "RapidOCR (R1, thử, tải thêm ~31 MB)");
  assert.equal(cr.detName, "PP-OCRv6_small_det");
  assert.equal(cr.recName, "PP-OCRv6_small_rec");
  assert.equal(cr.detName, MODEL_VARIANTS.det.r1.name);
  assert.equal(cr.recName, MODEL_VARIANTS.rec.r1.name);
  assert.deepEqual([cr.detOnnx, cr.detYml, cr.recOnnx, cr.recYml], [r.detOnnx, r.detYml, r.recOnnx, r.recYml]);
  assert.deepEqual(cr.params, PARAM_PRESETS.r1);
  assert.deepEqual(cr.params, r.runtimeParams);
  assert.equal(cr.loadTimeoutMs, 180000);
  // trang trải tham số vào PaddleOCR.create như harness.mjs (...runtimeParams); tên model lấy từ bảng
  const html = read("chup-mat-do.html");
  assert.match(html, /textDetectionModelName: cfg\.detName,/);
  assert.match(html, /textRecognitionModelName: cfg\.recName,/);
  assert.match(html, /\.\.\.cfg\.params/);
  // không cls / không bước xoay dòng
  assert.doesNotMatch(pageSources(), /\bcls\b|textline|orientation/i);
});

test("ocr-chon.mjs: chọn OCR theo ?ocr (mặc định 1a; giá trị lạ -> 1a có báo), cập nhật tham số URL", () => {
  assert.equal(typeof chon.pickOcr, "function", "chưa có pickOcr");
  assert.deepEqual(chon.pickOcr(""), { key: "1a", unknown: null });
  assert.deepEqual(chon.pickOcr("?x=1"), { key: "1a", unknown: null });
  assert.deepEqual(chon.pickOcr("?ocr="), { key: "1a", unknown: null });
  assert.deepEqual(chon.pickOcr("?ocr=1a"), { key: "1a", unknown: null });
  assert.deepEqual(chon.pickOcr("?ocr=r1"), { key: "r1", unknown: null });
  assert.deepEqual(chon.pickOcr("?ocr=zz"), { key: "1a", unknown: "zz" });
  assert.deepEqual(chon.pickOcr("?ocr=R1"), { key: "1a", unknown: "R1" });
  assert.deepEqual(chon.pickOcr("?ocr=r1x"), { key: "1a", unknown: "r1x" });
  assert.equal(chon.ocrSearch("", "r1"), "?ocr=r1");
  assert.equal(chon.ocrSearch("?ocr=r1", "1a"), "?ocr=1a");
  assert.equal(chon.ocrSearch("?a=1&ocr=zz", "r1"), "?a=1&ocr=r1");
});

test("ocr-chon.mjs: nhận lỗi thiếu bộ nhớ; câu báo tiếng Việt", () => {
  assert.equal(typeof chon.isMemoryError, "function", "chưa có isMemoryError");
  const yes = [new RangeError("Array buffer allocation failed"), new Error("Aborted(OOM)"), new Error("Out of memory"),
    new Error("failed to allocate a buffer of size 123"), new Error("WebAssembly.Memory(): could not allocate memory"),
    new Error("memory access out of bounds"), "OOM", { name: "RangeError", message: "x" }];
  for (const e of yes) assert.equal(chon.isMemoryError(e), true, String(e && e.message ? e.message : e));
  const no = [new Error("Tải https://x lỗi HTTP 404"), new TypeError("Failed to fetch"), new Error("opencv.js không khởi động sau 120 giây"), null, undefined, 12345, ""];
  for (const e of no) assert.equal(chon.isMemoryError(e), false, String(e && e.message ? e.message : e));
  assert.equal(chon.memoryMessage("r1"), "Máy không đủ bộ nhớ để chạy R1. Hãy chọn lại 1a (nhẹ hơn) hoặc đóng bớt tab rồi thử lại.");
  assert.match(chon.memoryMessage("1a"), /^Máy không đủ bộ nhớ để chạy 1a\./);
});

test("chup-mat-do.html: ô chọn OCR 2 lựa chọn, đổi thì replaceState; chỉ 1 OCR trong bộ nhớ (dispose); giới hạn thời gian nạp có hủy tải; dấu R1 trong sessionStorage bọc try/catch", () => {
  const html = read("chup-mat-do.html");
  assert.match(html, /<select id="ocrPick"[^>]*>\s*<option value="1a">PaddleOCR\.js mobile \(1a, mặc định\)<\/option>\s*<option value="r1">RapidOCR \(R1, thử, tải thêm ~31 MB\)<\/option>\s*<\/select>/);
  assert.match(html, /history\.replaceState\(/);
  assert.match(html, /\.dispose\(\)/);
  assert.match(html, /new AbortController\(\)/);
  assert.match(html, /cfg\.loadTimeoutMs/);
  assert.match(html, /Lần trước trang có thể đã bị đóng vì hết bộ nhớ khi chạy R1/);
  // mọi chỗ dùng sessionStorage nằm trong try { ... }
  const uses = html.match(/[^\n]*sessionStorage[^\n]*/g) || [];
  assert.ok(uses.length >= 2, "có ghi + xóa dấu");
  for (const line of uses) assert.match(line, /try \{/, line.trim());
  assert.match(html, /OCR đang dùng: /);
  // chân trang: giấy phép model R1 cạnh dòng của 1a
  assert.match(html, /PP-OCRv6_small_det và PP-OCRv6_small_rec[^<]*RapidOCR[^<]*Apache-2\.0/);
});

test("chup-mat-do.html: noindex, không gọi API Open Food Facts, không innerHTML, link sản phẩm mở tab mới an toàn", () => {
  const html = read("chup-mat-do.html");
  const js = read("chup-mat-do/t1.mjs") + read("chup-mat-do/tar.mjs") + readOpt("chup-mat-do/ocr-chon.mjs");
  assert.match(html, /<meta name="robots" content="noindex/);
  for (const s of [html, js]) {
    assert.ok(!s.includes("openfoodfacts.org/api"), "không gọi API OFF");
    assert.ok(!s.includes("cgi/search"), "không gọi search.pl");
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(s), "chữ gán bằng textContent");
  }
  // PRODUCT_PAGE chỉ dùng làm href của thẻ a (không fetch)
  assert.match(html, /a\.href = PRODUCT_PAGE \+ encodeURIComponent\(p\.code\);/);
  assert.equal((html.match(/PRODUCT_PAGE/g) || []).length, 2);
  assert.match(html, /a\.target = "_blank";\s*a\.rel = "noopener";/);
  assert.match(html, /App sẽ mở theo mã này/);
  assert.match(html, /id="pickCamera" accept="image\/\*" capture="environment"/);
  assert.match(html, /backend: "wasm", wasmPaths: CDN\.ortWasmDir, numThreads: 1/);
  assert.match(html, /ODbL 1\.0/);
  assert.doesNotMatch(html, /localStorage|method:\s*"POST"/);
  assert.doesNotMatch(js, /localStorage|method:\s*"POST"/);
});

test("chup-mat-do.html (thu-r1 vòng 2): rời / tải lại trang thì xóa dấu R1 (pagehide), quay lại từ bộ nhớ đệm mà còn bận R1 thì ghi lại dấu; dispose muộn có .catch", () => {
  const html = read("chup-mat-do.html");
  assert.match(html, /addEventListener\("pagehide", function \([^)]*\) \{[^}]*markClear\(\)/, "pagehide gọi markClear");
  assert.match(html, /addEventListener\("pageshow", function \((\w+)\) \{[^}]*\1\.persisted[^}]*markSet\(\)/, "pageshow persisted ghi lại dấu");
  assert.match(html, /Promise\.resolve\(\)\.then\(function \(\) \{ return late\.dispose\(\); \}\)\.catch\(/, "dispose muộn có .catch");
});

// ---------- danh mục ----------
test("danh-muc-vn.json: meta nguồn + giấy phép, 1.452 sản phẩm, chỉ code / name / brand / text", () => {
  const cat = JSON.parse(read("chup-mat-do/danh-muc-vn.json"));
  assert.match(cat.meta.giayPhep, /ODbL 1\.0/);
  assert.match(cat.meta.nguon, /Open Food Facts/);
  assert.match(cat.meta.ngayXuat, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(cat.meta.soSanPham, cat.products.length);
  assert.equal(cat.products.length, 1452);
  for (const p of cat.products) {
    assert.deepEqual(Object.keys(p).sort(), ["brand", "code", "name", "text"]);
    assert.match(p.code, /^\d+$/);
    assert.ok(p.text.trim());
  }
  assert.equal(new Set(cat.products.map((p) => p.code)).size, 1452);
});

test("xuat-danh-muc: displayName ưu tiên tên tiếng Việt; catalogJson đọc lại được", () => {
  assert.equal(displayName({ product_name: "Noodles", product_name_vi: "Mì" }), "Mì");
  assert.equal(displayName({ product_name_en: "X" }), "X");
  assert.equal(displayName({}), "");
  const s = catalogJson({ a: 1 }, [{ code: "1", text: "x" }, { code: "2", text: "y" }]);
  assert.deepEqual(JSON.parse(s), { meta: { a: 1 }, products: [{ code: "1", text: "x" }, { code: "2", text: "y" }] });
  assert.equal(s.split("\n").length, 6);
});

// ---------- trang-thu-check.mjs (phần thuần) ----------
import * as check from "../trang-thu-check.mjs";
const { allowedHost, requestSummary } = check;

test("trang-thu-check: chỉ cùng tên miền + jsDelivr / HuggingFace; bắt POST và request tới openfoodfacts.org", () => {
  assert.equal(allowedHost("127.0.0.1", "127.0.0.1"), true);
  assert.equal(allowedHost("cdn.jsdelivr.net", "127.0.0.1"), true);
  assert.equal(allowedHost("cas-bridge.xethub.hf.co", "127.0.0.1"), true);
  assert.equal(allowedHost("cdn-lfs.huggingface.co", "127.0.0.1"), true);
  assert.equal(allowedHost("evilhuggingface.co", "127.0.0.1"), false);
  assert.equal(allowedHost("world.openfoodfacts.org", "127.0.0.1"), false);
  const s = requestSummary([
    { url: "http://127.0.0.1/x", method: "GET", host: "127.0.0.1" },
    { url: "https://world.openfoodfacts.org/api/v2/product/1", method: "GET", host: "world.openfoodfacts.org" },
    { url: "https://example.com/p", method: "POST", host: "example.com" },
  ], "127.0.0.1");
  assert.equal(s.total, 3);
  assert.deepEqual(s.post, ["POST https://example.com/p"]);
  assert.equal(s.openfoodfacts.length, 1);
  assert.deepEqual(s.foreign, ["example.com", "world.openfoodfacts.org"]);
});

test("trang-thu-check (thu-r1): ModelScope R1 được phép (www.modelscope.cn + máy chủ tải file cdn-lfs-*.modelscope.cn đo ở P1.0), so đuôi an toàn", () => {
  assert.equal(allowedHost("www.modelscope.cn", "127.0.0.1"), true);
  assert.equal(allowedHost("cdn-lfs-cn-1.modelscope.cn", "127.0.0.1"), true);
  for (const h of ["evilmodelscope.cn", "modelscope.cn.evil.com", "www.modelscope.cn.evil.com", "cdn-lfs-cn-1.modelscope.cn.evil.com",
    "xcdn-lfs-cn-1.modelscope.cn", "modelscope.com", "evil.com"]) assert.equal(allowedHost(h, "127.0.0.1"), false, h);
});

test("trang-thu-check (thu-r1): --ocr 1a|r1 mở trang với ?ocr=…; không có --ocr thì trang mặc định; request tới R1", () => {
  assert.equal(typeof check.pageUrl, "function", "chưa có pageUrl");
  assert.equal(check.parseCheckArgs([]).ocr, null);
  assert.equal(check.parseCheckArgs(["--ocr", "r1"]).ocr, "r1");
  assert.equal(check.parseCheckArgs(["--ocr", "1a"]).ocr, "1a");
  assert.throws(() => check.parseCheckArgs(["--ocr", "zz"]), /--ocr/);
  assert.match(check.parseCheckArgs(["--all", "--ocr", "r1"]).out, /trang-thu-local-30-r1\.json$/);
  assert.match(check.parseCheckArgs(["--all"]).out, /trang-thu-local-30\.json$/);
  assert.equal(check.pageUrl("http://127.0.0.1:1/", null), "http://127.0.0.1:1/chup-mat-do.html");
  assert.equal(check.pageUrl("http://127.0.0.1:1/", "r1"), "http://127.0.0.1:1/chup-mat-do.html?ocr=r1");
  const reqs = [
    { url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx", host: "www.modelscope.cn", method: "GET" },
    { url: "https://cdn-lfs-cn-1.modelscope.cn/prod/x", host: "cdn-lfs-cn-1.modelscope.cn", method: "GET" },
    { url: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.yml", host: "huggingface.co", method: "GET" },
    { url: "https://huggingface.co/api/resolve-cache/models/PaddlePaddle/PP-OCRv6_small_det_onnx/28fe/inference.yml", host: "huggingface.co", method: "GET" },
    { url: "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4/inference.onnx", host: "huggingface.co", method: "GET" },
    { url: "http://127.0.0.1:1/chup-mat-do.html", host: "127.0.0.1", method: "GET" },
  ];
  assert.equal(check.r1Requests(reqs).length, 4);
  assert.equal(requestSummary(reqs, "127.0.0.1").r1.length, 4);
});

test("trang-thu-check (thu-r1 vòng 2): chờ mỗi ảnh = giới hạn nạp của OCR + thời gian đọc; lấy kết quả theo chỉ số, không runs.at(-1)", () => {
  assert.equal(typeof check.imageWaitMs, "function", "chưa có imageWaitMs");
  assert.ok(check.imageWaitMs("r1") >= chon.OCR_CONFIGS.r1.loadTimeoutMs + 30000, `r1: ${check.imageWaitMs("r1")}`);
  assert.ok(check.imageWaitMs("1a") >= chon.OCR_CONFIGS["1a"].loadTimeoutMs + 30000, `1a: ${check.imageWaitMs("1a")}`);
  assert.ok(check.imageWaitMs(null) >= chon.OCR_CONFIGS["1a"].loadTimeoutMs + 30000, `null: ${check.imageWaitMs(null)}`);
  const src = fs.readFileSync(new URL("../trang-thu-check.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /runs\.at\(-1\)/, "còn runs.at(-1)");
  assert.doesNotMatch(src, /\b90000\b/, "còn hằng 90000");
});

test("trang-thu-check (thu-r1 vòng 3): ảnh bị bỏ vì trang vẫn bận ghi seconds: null, không kéo trung vị / lớn nhất", () => {
  const busy = "trang vẫn bận sau ảnh X";
  const s = check.runStats([{ seconds: 10 }, { seconds: 20 }, { seconds: null, error: busy }, { seconds: null, error: busy }]);
  assert.equal(s.restMedianSeconds, 20);
  assert.equal(s.restMaxSeconds, 20);
  assert.equal(s.errors, 2);
  assert.equal(typeof check.busyRows, "function", "chưa có busyRows");
  // vòng 4: ghép 2 bước (busyRows thật -> runStats), không viết tay dòng bị bỏ
  const joined = check.runStats([{ seconds: 10 }, { seconds: 20 }, ...check.busyRows([{ code: "a" }], "X")]);
  assert.equal(joined.restMedianSeconds, 20, "busyRows + runStats: trung vị");
  assert.equal(joined.restMaxSeconds, 20, "busyRows + runStats: lớn nhất");
  assert.deepEqual(check.busyRows([{ code: "a" }, { code: "b" }], "X"), [
    { code: "a", seconds: null, error: busy, top1: false, inTop5: false },
    { code: "b", seconds: null, error: busy, top1: false, inTop5: false },
  ]);
  assert.deepEqual(check.busyRows([{ code: "a" }], "X", "trang đã đóng"), [
    { code: "a", seconds: null, error: "trang đã đóng sau ảnh X", top1: false, inTop5: false },
  ]);
  const src = fs.readFileSync(new URL("../trang-thu-check.mjs", import.meta.url), "utf8");
  // (a) không còn dòng bị bỏ ghi seconds: 0 (viết tay hay qua ${reason})
  assert.doesNotMatch(src, /seconds:\s*0\s*,\s*error:\s*`(trang vẫn bận|\$\{reason\})/, "dòng ảnh bị bỏ còn seconds: 0");
  // (b) mọi chỗ ghi ảnh bị bỏ đi qua busyRows: có out.runs.push(...busyRows( ; ngoài thân busyRows không tự viết "sau ảnh ${"
  assert.match(src, /out\.runs\.push\(\.\.\.busyRows\(/, "chỗ trang vẫn bận không đi qua busyRows");
  const body = src.match(/export function busyRows\([^)]*\) \{\n[\s\S]*?\n\}\n/);
  assert.ok(body, "không tìm thấy thân busyRows");
  assert.ok(!src.replace(body[0], "").includes("sau ảnh ${"), "còn chỗ tự viết \"sau ảnh ${\" ngoài busyRows");
});

test("trang-thu-check (thu-r1 vòng 2): --ref-dir (mặc định D:\\tmp\\ocr-mat\\ket-qua); file tham chiếu hỏng -> lỗi tiếng Việt, không ném", () => {
  assert.equal(check.parseCheckArgs([]).refDir, "D:\\tmp\\ocr-mat\\ket-qua");
  assert.equal(check.parseCheckArgs(["--ocr", "r1", "--ref-dir", "D:\\khac\\ket-qua"]).refDir, "D:\\khac\\ket-qua");
  assert.equal(typeof check.parseRefJson, "function", "chưa có parseRefJson");
  assert.deepEqual(check.parseRefJson('{"items":[{"ma":"1","top5":[]}]}', "r1.json"), { data: { items: [{ ma: "1", top5: [] }] } });
  const bad = check.parseRefJson("{hỏng", "D:/x/r1-trinh-duyet-webkit.json");
  assert.deepEqual(Object.keys(bad), ["error"]);
  assert.match(bad.error, /^Không đọc được file tham chiếu D:\/x\/r1-trinh-duyet-webkit\.json \(JSON hỏng: .+\), bỏ qua phần so top5\.$/);
  assert.equal(check.readRefFile("D:/khong-co/khong-co-file-nay.json"), null);
});
