import test from "node:test";
import assert from "node:assert/strict";
import {
  resultFileName, toolName, csvField, timesRow, pickPhotos, orderLines, rowLines, summarizeMemory, sumBytes, mb, timeStats, makeTar, tessLangObjects,
} from "../lib.mjs";

test("tên file kết quả và tên công cụ giống run_ocr.py", () => {
  assert.equal(resultFileName("8934572260543", "front"), "8934572260543__front.txt");
  assert.equal(toolName("paddlejs", "webkit"), "paddlejs-webkit");
});

test("ô CSV: bọc nháy kép khi có dấu phẩy / nháy / xuống dòng", () => {
  assert.equal(csvField("ok"), "ok");
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('nói "x"'), '"nói ""x"""');
  assert.equal(csvField(null), "");
});

test("dòng times.csv: 5 cột, giây làm tròn 2 số, lỗi nhiều dòng gom 1 dòng, CRLF như csv.writer", () => {
  assert.equal(timesRow("paddlejs-chromium", "893", "front", 4.6349, "ok"), "paddlejs-chromium,893,front,4.63,ok\r\n");
  const row = timesRow("tesseractjs-webkit", "893", "back", 0, "error: a,\n  b");
  assert.equal(row, 'tesseractjs-webkit,893,back,0,"error: a, b"\r\n');
  assert.ok(timesRow("t", "c", "i", 1, "x".repeat(500)).length < 330);
});

test("chọn ảnh: chỉ photos/<mã>/<ảnh>.jpg|jpeg|png, bỏ thư mục con hsd/, sắp theo đường dẫn", () => {
  const got = pickPhotos(["893/nutrition.jpg", "893/hsd/crop.jpg", "NGUON.csv", "893/front.JPG", "111/a.png", "893\\back.jpeg", "893/x.txt"]);
  assert.deepEqual(got.map((p) => p.rel), ["111/a.png", "893/back.jpeg", "893/front.JPG", "893/nutrition.jpg"]);
  assert.deepEqual(got[2], { code: "893", image: "front", rel: "893/front.JPG" });
});

const box = (x, y, w, h, text) => ({ poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text });

test("thứ tự dòng Paddle: trên xuống, cùng hàng trái sang phải", () => {
  const items = [
    box(300, 12, 100, 30, "Phải"),
    box(10, 10, 100, 30, "Trái"),
    box(10, 100, 200, 30, "Dòng 2"),
    box(10, 55, 50, 30, "Giữa"),
  ];
  assert.deepEqual(orderLines(items), ["Trái", "Phải", "Giữa", "Dòng 2"]);
});

test("thứ tự dòng Paddle: chồng dọc < 50% thì khác hàng; bỏ khung rỗng", () => {
  // khung B lệch xuống 20/30 -> chồng 10/30 < 0.5 -> hàng mới, dù nằm bên trái
  const items = [box(200, 0, 100, 30, "A"), box(0, 20, 100, 30, "B"), box(0, 200, 10, 10, "  ")];
  assert.deepEqual(orderLines(items), ["A", "B"]);
  // lệch 10/30 -> chồng 20/30 >= 0.5 -> cùng hàng, B bên trái đứng trước
  assert.deepEqual(orderLines([box(200, 0, 100, 30, "A"), box(0, 10, 100, 30, "B")]), ["B", "A"]);
  assert.deepEqual(orderLines([]), []);
});

test("cách ghi phụ rowLines: khung cùng hàng nối 1 dòng (chỉ để thử)", () => {
  const items = [box(300, 12, 100, 30, "17,14g"), box(10, 10, 100, 30, "Protein"), box(10, 100, 200, 30, "Calories")];
  assert.deepEqual(rowLines(items), ["Protein 17,14g", "Calories"]);
  assert.deepEqual(orderLines(items), ["Protein", "17,14g", "Calories"]);
});

test("gom bộ nhớ: nền = trung vị tổng private lúc trang trống; đỉnh 1 tiến trình và đỉnh tổng lúc chạy", () => {
  const s = (phase, ...procs) => ({ phase, procs: procs.map(([p, w]) => ({ pid: 1, private: p, ws: w })) });
  const m = summarizeMemory([
    s("baseline", [10, 5], [20, 5]), // tổng 30
    s("baseline", [10, 5], [30, 5]), // tổng 40
    s("baseline", [10, 5], [40, 5]), // tổng 50
    s("run", [100, 60], [50, 70]), // tổng 150, max 100; ws tổng 130, max 70
    s("run", [80, 90], [90, 10]), // tổng 170, max 90; ws tổng 100, max 90
  ]);
  assert.deepEqual(m, { baseline: 40, peakProc: 100, peakTotal: 170, peakProcWs: 90, peakTotalWs: 130, samples: 2 });
  assert.deepEqual(summarizeMemory([]), { baseline: null, peakProc: null, peakTotal: null, peakProcWs: null, peakTotalWs: null, samples: 0 });
});

test("cộng byte tải: tổng qua mạng / giải nén, file > 100 kB sắp giảm dần, -1 tính 0", () => {
  const r = sumBytes([
    { url: "a.wasm", transfer: 3_000_000, decoded: 12_000_000 },
    { url: "b.js", transfer: 50_000, decoded: 90_000 },
    { url: "c.onnx", transfer: 8_000_000, decoded: 8_000_000 },
    { url: "d", transfer: -1, decoded: null },
  ]);
  assert.equal(r.transfer, 11_050_000);
  assert.equal(r.decoded, 20_090_000);
  assert.equal(r.count, 4);
  assert.deepEqual(r.big.map((b) => b.url), ["a.wasm", "c.onnx"]);
  assert.equal(mb(r.transfer), "11.1");
  assert.equal(mb(null), "");
});

test("thống kê giây/ảnh chỉ tính ảnh ok", () => {
  assert.deepEqual(timeStats([{ status: "ok", seconds: "2" }, { status: "ok", seconds: "4" }, { status: "error: x", seconds: "9" }]),
    { ok: 2, errors: 1, mean: 3, max: 4 });
  assert.deepEqual(timeStats([]), { ok: 0, errors: 0, mean: null, max: null });
});

test("makeTar: tar ustar đọc lại được tên, cỡ, nội dung; checksum đúng", () => {
  const a = new TextEncoder().encode("Global:\n  model_name: x\n");
  const b = new Uint8Array(1000).map((_, i) => i % 251);
  const tar = makeTar([{ name: "inference.yml", data: a }, { name: "inference.onnx", data: b }]);
  assert.equal(tar.length % 512, 0);
  const dec = (u8) => new TextDecoder().decode(u8);
  const read = (off) => {
    const h = tar.subarray(off, off + 512);
    const name = dec(h.subarray(0, 100)).split("\0")[0];
    const size = parseInt(dec(h.subarray(124, 136)).split("\0")[0], 8);
    const stored = parseInt(dec(h.subarray(148, 156)).split("\0")[0], 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    assert.equal(stored, sum);
    assert.equal(dec(h.subarray(257, 262)), "ustar");
    return { name, size, data: tar.subarray(off + 512, off + 512 + size) };
  };
  const f1 = read(0);
  assert.equal(f1.name, "inference.yml");
  assert.deepEqual(f1.data, a);
  const f2 = read(1024); // 512 header + 512 (dữ liệu 25 byte làm tròn lên 1 khối)
  assert.equal(f2.name, "inference.onnx");
  assert.equal(f2.size, 1000);
  assert.deepEqual(f2.data, b);
  assert.ok(tar.subarray(tar.length - 1024).every((v) => v === 0));
});

test("tessLangObjects: lần sao chép đầu (nạp ngôn ngữ) mang byte, lần sau (khởi tạo) mang tên ngôn ngữ", () => {
  const vie = new Uint8Array([31, 139, 1]);
  const eng = new Uint8Array([31, 139, 2]);
  const langs = tessLangObjects([{ code: "vie", data: vie }, { code: "eng", data: eng }]);
  const load = structuredClone(langs); // createWorker gửi việc loadLanguage
  assert.deepEqual(load.map((l) => l.code), ["vie", "eng"]);
  assert.deepEqual(load[0].data, vie);
  assert.deepEqual(load[1].data, eng);
  const init = structuredClone(langs); // rồi gửi việc initialize: tesseract.js 7.0.0 ghép tên bằng l.data
  assert.equal(init.map((l) => l.data).join("+"), "vie+eng");
});
