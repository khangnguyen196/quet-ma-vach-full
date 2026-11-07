// Test cho trang thử public/ocr-thu.html và 2 module của nó (public/ocr-thu/regex.mjs, text.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../assets.js"; // globalThis.OcrAssets
import * as lib from "../lib.mjs";
import * as page from "../../../public/ocr-thu/text.mjs";
import { extractRegex, pyRegex, pyStrip, pySplitlines, FIELDS } from "../../../public/ocr-thu/regex.mjs";
import { productText } from "../regex-parity.mjs";

const PUBLIC = new URL("../../../public/", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, PUBLIC), "utf8");

// ---------- bản chép trong trang cho cùng kết quả với lib.mjs (dùng lúc đo) ----------
const box = (x, y, w, h, text) => ({ poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text });

test("rowLines / groupRows của trang giống hệt lib.mjs (các ca cố định + 200 ca ngẫu nhiên có hạt giống)", () => {
  const fixed = [
    [box(300, 12, 100, 30, "17,14g"), box(10, 10, 100, 30, "Protein"), box(10, 100, 200, 30, "Calories")],
    [box(200, 0, 100, 30, "A"), box(0, 20, 100, 30, "B"), box(0, 200, 10, 10, "  ")],
    [box(200, 0, 100, 30, "A"), box(0, 10, 100, 30, "B")],
    [],
  ];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const random = Array.from({ length: 200 }, () =>
    Array.from({ length: Math.floor(rnd() * 25) }, (_, i) =>
      box(Math.round(rnd() * 1200), Math.round(rnd() * 1600), 20 + Math.round(rnd() * 300), 8 + Math.round(rnd() * 40), rnd() < 0.05 ? " " : `t${i}`)));
  for (const items of [...fixed, ...random]) {
    assert.deepEqual(page.groupRows(items), lib.groupRows(items));
    assert.deepEqual(page.rowLines(items), lib.rowLines(items));
  }
  assert.deepEqual(page.rowLines(fixed[0]), ["Protein 17,14g", "Calories"]);
});

test("tessLangObjects / makeTar của trang giống lib.mjs", () => {
  const langs = [{ code: "vie", data: new Uint8Array([31, 139, 1]) }];
  assert.deepEqual(structuredClone(page.tessLangObjects(langs)), structuredClone(lib.tessLangObjects(langs)));
  const a = page.tessLangObjects(langs);
  structuredClone(a);
  assert.equal(structuredClone(a)[0].data, "vie");
  const files = [{ name: "inference.yml", data: new TextEncoder().encode("x: 1\n") }, { name: "inference.onnx", data: new Uint8Array(700).fill(7) }];
  assert.deepEqual(page.makeTar(files), lib.makeTar(files));
});

// ---------- thiếu bộ nhớ ----------
test("isMemoryError: RangeError, câu lỗi có memory / OOM / allocate; lỗi khác thì không", () => {
  assert.equal(page.isMemoryError(new RangeError("Array buffer allocation failed")), true);
  assert.equal(page.isMemoryError(new Error("WebAssembly.Memory.grow(): Maximum memory size exceeded")), true);
  assert.equal(page.isMemoryError(new Error("Aborted(OOM)")), true);
  assert.equal(page.isMemoryError("RuntimeError: Aborted(Cannot enlarge memory arrays)"), true);
  assert.equal(page.isMemoryError(new Error("failed to allocate a buffer of size 123")), true);
  assert.equal(page.isMemoryError(new Error("std::bad_alloc")), true);
  assert.equal(page.isMemoryError(new Error("Tải https://x lỗi HTTP 404")), false);
  assert.equal(page.isMemoryError(new TypeError("x is not a function")), false);
  assert.equal(page.isMemoryError(null), false);
});

test("isMemoryError: RangeError chỉ tính là thiếu bộ nhớ khi câu lỗi có alloc / memory / buffer", () => {
  assert.equal(page.isMemoryError(new RangeError("Array buffer allocation failed")), true);
  assert.equal(page.isMemoryError(new RangeError("WebAssembly.Memory.grow(): Maximum memory size exceeded")), true);
  assert.equal(page.isMemoryError(new RangeError("Out of memory: Cannot allocate Wasm memory for new instance")), true);
  assert.equal(page.isMemoryError(new RangeError("Invalid typed array length: 99999999999 (buffer)")), true);
  assert.equal(page.isMemoryError(new RangeError("Maximum call stack size exceeded")), false);
  assert.equal(page.isMemoryError(new RangeError("Invalid array length")), false);
  assert.equal(page.isMemoryError(new RangeError("toFixed() digits argument must be between 0 and 100")), false);
});

test("sumResourceBytes: byte qua mạng, file lấy từ bộ nhớ đệm, file không đo được (thiếu Timing-Allow-Origin)", () => {
  const r = page.sumResourceBytes([
    { transferSize: 1000, decodedBodySize: 4000 },
    { transferSize: 0, decodedBodySize: 500 },
    { transferSize: 0, decodedBodySize: 0 },
  ]);
  assert.deepEqual(r, { transfer: 1000, measured: 1, cached: 1, unknown: 1, count: 3 });
});

test("buildSummary: có trình duyệt, backend, giây tải / đọc, 11 ô (trống ghi 'chưa đọc được'), lỗi", () => {
  const s = page.buildSummary(
    { time: "t", userAgent: "UA", crossOriginIsolated: false, gpu: "wasm (x)", wasmOnly: true, image: "4032×3024", scaled: "1600×1200", bytes: "18.1 MB" },
    [{ engine: "PaddleOCR", backend: "wasm", loadSeconds: 12.34, readSeconds: 5.67, fields: { dam_g: "17,14", thanh_phan_dau: ["a", "b"] }, text: "Protein 17,14g" },
      { engine: "tesseract.js", backend: "wasm", error: "Trang thiếu bộ nhớ" }]);
  for (const part of ["UA", "crossOriginIsolated: false", "Chỉ dùng wasm: có", "1600×1200", "[PaddleOCR] backend: wasm; giây tải model: 12.3; giây đọc: 5.7",
    "Đạm (g): 17,14", "3 thành phần đầu: a, b", "Năng lượng (kcal): chưa đọc được", "Protein 17,14g", "LỖI: Trang thiếu bộ nhớ", "18.1 MB"]) {
    assert.ok(s.includes(part), part);
  }
  assert.equal(page.fieldText(""), "chưa đọc được");
  assert.equal(page.fieldText([]), "chưa đọc được");
});

// ---------- URL CDN của trang: có số bản, khớp assets.js (chế độ cdn) ----------
test("mọi URL CDN trong trang có số bản và đúng bằng bộ URL chế độ cdn của assets.js", () => {
  const { VERSIONS, MODELS, assetUrls } = globalThis.OcrAssets;
  const src = ["ocr-thu.html", "ocr-thu/text.mjs", "ocr-thu/regex.mjs"].map(read).join("\n");
  const urls = new Set(src.match(/https?:\/\/[^\s"'`)<>]+/g));
  assert.ok(urls.size > 10);
  for (const u of urls) {
    const url = new URL(u);
    if (url.hostname === "cdn.jsdelivr.net") {
      const m = url.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)(\/|$)/);
      assert.ok(m, `jsDelivr không có số bản: ${u}`);
      assert.equal(m[2], VERSIONS[m[1]], `${m[1]}: trang ${m[2]}, assets.js ${VERSIONS[m[1]]}`);
    } else if (url.hostname === "huggingface.co") {
      const m = url.pathname.match(/^\/([^/]+\/[^/]+)\/resolve\/([0-9a-f]{40})\//);
      assert.ok(m, `HuggingFace không theo mã commit: ${u}`);
      const model = Object.values(MODELS).find((x) => x.repo === m[1]);
      assert.ok(model, `repo lạ: ${m[1]}`);
      assert.equal(m[2], model.rev);
    } else {
      assert.fail(`URL ngoài jsDelivr / HuggingFace: ${u}`);
    }
  }
  // đúng bộ file mà công cụ đã đo dùng (chế độ cdn, cả bản wasm lẫn bản WebGPU của onnxruntime-web)
  const want = new Set();
  for (const set of [assetUrls("cdn", { webgpu: false }), assetUrls("cdn", { webgpu: true })]) {
    for (const v of Object.values(set)) if (typeof v === "string" && v.startsWith("http")) want.add(v);
    for (const l of set.tessLangs) want.add(l.url);
  }
  assert.deepEqual([...urls].sort(), [...want].sort());
});

test("trang: noindex, chỉ wasm 1 luồng, WebGPU có giới hạn 3 giây, 2 nút chọn ảnh, cờ sessionStorage, không localStorage", () => {
  const html = read("ocr-thu.html");
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /numThreads: 1/);
  assert.match(html, /GPU_TIMEOUT_MS = 3000/);
  assert.match(html, /id="pickCamera" accept="image\/\*" capture="environment"/);
  assert.match(html, /id="pickLibrary" accept="image\/\*" hidden/);
  // 2 ô chọn ảnh khóa sẵn trong HTML, setBusy(false) cuối main() mới mở (main lỗi thì vẫn khóa)
  assert.match(html, /<input type="file" id="pickCamera"[^>]* disabled[ >]/);
  assert.match(html, /<input type="file" id="pickLibrary"[^>]* disabled[ >]/);
  assert.match(html, /\$\("pickCamera"\)\.disabled = b;/);
  assert.match(html, /\$\("pickLibrary"\)\.disabled = b;/);
  assert.match(html, /"ocr-thu-dang-doc"/);
  assert.match(html, /Trang vừa bị đóng giữa chừng, có thể do thiếu bộ nhớ/);
  assert.doesNotMatch(html, /localStorage/);
});

test("trang: không dùng WebGPU thì giấu navigator.gpu trước khi nạp SDK (SDK luôn gọi requestAdapter() không giới hạn giờ)", () => {
  const html = read("ocr-thu.html");
  // hàm giấu: đè navigator.gpu = undefined, có try/catch
  assert.match(html, /function hideGpu\(\) \{\s*try \{ Object\.defineProperty\(navigator, "gpu", \{ value: undefined, configurable: true \}\); \} catch/);
  // nhánh "Chỉ dùng wasm" gọi hideGpu() trước khi trả về, không gọi requestAdapter()
  assert.match(html, /if \(wasmOnly\) \{\s*hideGpu\(\);\s*return \{ use: "wasm"/);
  // nhánh quá 3 giây cũng giấu
  assert.match(html, /if \(timedOut\) \{[^}]*hideGpu\(\);\s*return \{ use: "wasm"/);
  // chỉ khi có adapter (dùng WebGPU) thì không giấu
  assert.match(html, /if \(adapter\) return \{ use: "webgpu"/);
  // dò WebGPU (và giấu) xong mới thêm import map / import SDK
  const main = html.slice(html.indexOf("async function main()"));
  assert.ok(main.indexOf("await detectGpu()") >= 0 && main.indexOf("await detectGpu()") < main.indexOf("addImportMap("));
});

test("trang: ô Thương hiệu ghi rõ luật regex không rút ô này", () => {
  assert.equal(page.FIELD_LABELS.thuong_hieu, "Thương hiệu (luật regex không rút ô này)");
  assert.equal(extractRegex("Thương hiệu: Vina Acecook\nMì ăn liền").thuong_hieu, "");
});

test("app không có link nào tới trang thử", () => {
  const index = fs.readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(index, /ocr-thu/);
  for (const f of fs.readdirSync(new URL("../../../src/", import.meta.url))) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../../../src/${f}`, import.meta.url), "utf8"), /ocr-thu/, f);
  }
});

// ---------- luật regex bản JS: vài ca giống test_run_extract.py (kết quả lấy từ bản Python) ----------
test("regex JS: text sạch ra đủ 11 ô như test_p5h của Python", () => {
  const text = "Mì ăn liền vị bò\nKhối lượng tịnh: 75g\nThành phần: bột mì, dầu thực vật, muối.\n"
    + "Giá trị dinh dưỡng trong 100 g: Năng lượng 450 kcal, Chất đạm 9,5 g, Chất béo 18,49 g, "
    + "Carbohydrat 62 g.\nCalories from fat 160 kcal\n"
    + "Hướng dẫn bảo quản: nơi khô ráo, thoáng mát.\nSản xuất bởi: Công ty TNHH Thực phẩm ABC\n"
    + "NSX: 01/02/2025 HSD: 01/08/2025";
  assert.deepEqual(extractRegex(text), {
    ten: "mi an lien vi bo", thuong_hieu: "", khoi_luong: "75g",
    thanh_phan_dau: ["bot mi", "dau thuc vat", "muoi"], nang_luong_kcal: "450",
    dam_g: "9,5", beo_g: "18,49", carb_g: "62",
    nha_san_xuat: "cong ty tnhh thuc pham abc", bao_quan: "noi kho rao, thoang mat.",
    han_su_dung: "01/08/2025" });
});

test("regex JS: luật chịu lỗi OCR như test_p5a..p5o, s1a..s1h của Python", () => {
  const rx = extractRegex;
  assert.equal(rx("Năng lượng / Energy 75,3kca] Chất đạm 1,2").nang_luong_kcal, "75,3");
  assert.equal(rx("Nang iuong (kcal) 63,6 dam").nang_luong_kcal, "63,6");
  assert.equal(rx("170 kcal\nPhần trăm giá trị dinh dưỡng tính trên nhu cầu năng lượng 2000 kcal").nang_luong_kcal, "170");
  assert.equal(rx("Calories from fat: 50").nang_luong_kcal, "");
  const o = rx("Protein 7,09 Lipid 14,49 Carbohydrate 47,29 Năng lượng 346,4 kcal");
  assert.deepEqual([o.dam_g, o.beo_g, o.carb_g], ["7,0", "14,4", "47,2"]);
  assert.equal(rx("HSD:071026 L 20:17-07").han_su_dung, "071026");
  assert.equal(rx("NSX 01/02/2025\nHSD / EXP:\n200223 08:33 NSX / PRD:").han_su_dung, "200223");
  assert.equal(rx("HSD: 848224").han_su_dung, "");
  assert.equal(rx("HSD: 311226").han_su_dung, "311226");
  assert.equal(rx("Giá trị dinh dưỡng trong 90 g\nKhol luong tinh: 108 g").khoi_luong, "108 g");
  assert.equal(rx("Calories from Fat: 20 Total Fat 2,5").beo_g, "2,5");
  assert.equal(rx("Carbohydrate 18,79 g").carb_g, "18,79");
  assert.equal(rx("Chất béo 3,5 Chất đạm 2,6 2 Carbohydrat 17 Can-xi 106 mg").carb_g, "17");
  assert.equal(rx("Protein 09 Fat 09").dam_g, "");
  assert.equal(rx("Chất đạm 144 g").dam_g, ""); // > 100 g: để trống
  assert.equal(rx("Saturated Fat Total Fat 10g\nCalories from   fat 9").beo_g, "10");
  assert.equal(rx("Chất béo Chất béo bão hòa 10g 3g").beo_g, "10");
  assert.equal(rx("Chất béo bão hòa 2 g").beo_g, "");
});

test("regex JS: chỗ regex JS khác Python (Unicode \\w \\b \\d, '.', splitlines) cho kết quả như Python 3", () => {
  // kết quả mong đợi lấy bằng cách chạy extract_regex của run_extract.py trên đúng các chuỗi này
  const r0 = extractRegex("Protein² 5 g\nChất béo 3,5g");
  assert.deepEqual([r0.ten, r0.khoi_luong, r0.dam_g, r0.beo_g], ["protein² 5 g", "5 g", "5", "3,5"]);
  const r1 = extractRegex("Đạm 12g\u2028Béo 4 g\rCarb 30g");
  assert.deepEqual([r1.ten, r1.khoi_luong, r1.dam_g, r1.beo_g, r1.carb_g], ["dam 12g", "12g", "12", "4", "30"]);
  assert.equal(extractRegex("HSD: ٠٧١٠٢٦").han_su_dung, "٠٧١٠٢٦"); // chữ số Ả Rập là \d trong Python
  const r3 = extractRegex("Khối lượng tịnh: 500gø\nNet wt 2ſ0 g");
  assert.deepEqual([r3.ten, r3.khoi_luong], ["net wt 2ſ0 g", ""]); // ø là chữ: không có \b sau "g"
  assert.deepEqual(extractRegex("Thành phần: bột mì, đường\u2028muối, dầu.\nX").thanh_phan_dau, ["bot mi", "duong\u2028muoi", "dau"]);
  const r5 = extractRegex("\u00a0Mì ăn liền\u00a0\n\x1cKhối lượng 75g");
  assert.deepEqual([r5.ten, r5.khoi_luong], ["mi an lien", "75g"]);
});

test("pyRegex: đổi \\d \\w \\b \\s '.' '$' (?P<…>) theo nghĩa Python; cú pháp chưa hỗ trợ thì báo lỗi", () => {
  assert.ok(pyRegex(String.raw`\d+`).test("٣"));
  assert.ok(!pyRegex(String.raw`a\b`).test("aø"));
  assert.ok(pyRegex(String.raw`a.b`).test("a\rb"));
  assert.ok(!pyRegex(String.raw`a.b`).test("a\nb"));
  assert.equal(pyRegex(String.raw`(?P<x>a)`).exec("a").groups.x, "a");
  assert.ok(pyRegex("x$", "m").test("x\ny"));
  assert.ok(!pyRegex("x$", "m").test("x\ry"));
  assert.throws(() => pyRegex("^a"));
  assert.throws(() => pyRegex(String.raw`[\b]`));
  assert.equal(pyStrip("\u00a0 a.: ", undefined), "a.:");
  assert.equal(pyStrip(" .a: ", " .:"), "a");
  assert.deepEqual(pySplitlines("a\r\nb\u2028c\n"), ["a", "b", "c"]);
  assert.equal(FIELDS.length, 11);
});

test("regex-parity: ghép chữ sản phẩm theo IMAGE_ORDER như product_text", () => {
  const files = ["1__date.txt", "1__nutrition.txt", "1__front.txt", "1__zzz.txt", "1__ingredients.txt", "1__back.txt", "2__front.txt", "1__front.png"];
  const got = productText(files, "1", (f) => f.split("__")[1].replace(".txt", "").toUpperCase());
  assert.equal(got, "FRONT\nINGREDIENTS\nNUTRITION\nBACK\nDATE\nZZZ");
});

test("ocr-thu-check: % giống chữ (Levenshtein, gom khoảng trắng)", async () => {
  const { similarity } = await import("../ocr-thu-check.mjs");
  assert.equal(similarity("Protein 17,14g", "Protein  17,14g\n"), 1);
  assert.equal(similarity("", ""), 1);
  assert.equal(similarity("abcd", "abcx"), 0.75);
  assert.equal(similarity("abc", ""), 0);
});

test("ocr-thu-check (h): Content-Type đúng loại, đọc thuộc tính disabled của ô chọn ảnh", async () => {
  const { contentTypeOk, inputDisabledInHtml } = await import("../ocr-thu-check.mjs");
  assert.equal(contentTypeOk("ocr-thu.html", "text/html; charset=utf-8"), true);
  assert.equal(contentTypeOk("ocr-thu.html", "application/octet-stream"), false);
  assert.equal(contentTypeOk("ocr-thu/text.mjs", "application/javascript; charset=utf-8"), true);
  assert.equal(contentTypeOk("ocr-thu/text.mjs", "text/javascript"), true);
  assert.equal(contentTypeOk("ocr-thu/regex.mjs", "application/octet-stream"), false);
  assert.equal(contentTypeOk("ocr-thu/regex.mjs", null), false);
  assert.equal(inputDisabledInHtml('<input type="file" id="pickCamera" accept="image/*" hidden disabled>', "pickCamera"), true);
  assert.equal(inputDisabledInHtml('<input type="file" id="pickCamera" accept="image/*" hidden>', "pickCamera"), false);
  assert.equal(inputDisabledInHtml('<input type="file" id="pickLibrary" disabled hidden>', "pickCamera"), false);
  // trang thật (sau khi sửa): cả 2 ô khóa sẵn
  const html = read("ocr-thu.html");
  assert.equal(inputDisabledInHtml(html, "pickCamera"), true);
  assert.equal(inputDisabledInHtml(html, "pickLibrary"), true);
});
