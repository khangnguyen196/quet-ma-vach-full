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

test("t1.mjs, tar.mjs không import gì (module thuần cho trình duyệt)", () => {
  for (const f of ["chup-mat-do/t1.mjs", "chup-mat-do/tar.mjs"]) assert.doesNotMatch(read(f), /^\s*import\b|\bimport\(/m, f);
});

// ---------- trang ----------
test("chup-mat-do.html: URL CDN có số bản, đúng bộ chế độ cdn (wasm) của assets.js; ngoài CDN chỉ có link OFF + link giấy phép ODbL", () => {
  const { VERSIONS, MODELS, assetUrls } = globalThis.OcrAssets;
  const html = read("chup-mat-do.html");
  const urls = [...new Set(html.match(/https?:\/\/[^\s"'`)<>]+/g))];
  const cdn = urls.filter((u) => /^https:\/\/(cdn\.jsdelivr\.net|huggingface\.co)\//.test(u));
  for (const u of cdn) {
    const url = new URL(u);
    if (url.hostname === "cdn.jsdelivr.net") {
      const m = url.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)(\/|$)/);
      assert.ok(m, `jsDelivr không có số bản: ${u}`);
      assert.equal(m[2], VERSIONS[m[1]], `${m[1]}`);
    } else {
      const m = url.pathname.match(/^\/([^/]+\/[^/]+)\/resolve\/([0-9a-f]{40})\//);
      const model = m && Object.values(MODELS).find((x) => x.repo === m[1]);
      assert.ok(model && m[2] === model.rev, `HuggingFace không theo mã commit đã ghim: ${u}`);
    }
  }
  const a = assetUrls("cdn", { webgpu: false });
  const want = [a.paddleSdk, a.ort, a.ortWasmDir, a.opencv, a.clipper, a.jsYaml, a.detOnnx, a.detYml, a.recOnnx, a.recYml];
  assert.deepEqual([...cdn].sort(), [...want].sort());
  const other = urls.filter((u) => !cdn.includes(u));
  assert.deepEqual(other.sort(), ["https://opendatacommons.org/licenses/odbl/1-0/", "https://world.openfoodfacts.org", "https://world.openfoodfacts.org/product/"]);
});

test("chup-mat-do.html: noindex, không gọi API Open Food Facts, không innerHTML, link sản phẩm mở tab mới an toàn", () => {
  const html = read("chup-mat-do.html");
  const js = read("chup-mat-do/t1.mjs") + read("chup-mat-do/tar.mjs");
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
import { allowedHost, requestSummary } from "../trang-thu-check.mjs";

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
