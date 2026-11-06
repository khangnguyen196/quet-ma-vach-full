// Test src/barcode.js: chọn mã từ kết quả zxing-wasm và ghép dòng lỗi "đã thử những gì" khi "Chụp ảnh mã" trượt.
// Không cần trình duyệt, không cần zxing-wasm: kết quả là object giả có dạng giống ReadResult của thư viện.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pickCode, scanFailureText, ZXING_FORMATS } from "../src/barcode.js";

/** 1 kết quả giả của zxing-wasm (chỉ các trường app đọc). */
const res = (text, format = "EAN13", isValid = true) => ({ text, format, isValid });

describe("ZXING_FORMATS", () => {
  test("đúng 4 định dạng app nhận, viết theo tên của zxing-wasm", () => {
    assert.deepEqual(ZXING_FORMATS, ["EAN13", "EAN8", "UPCA", "UPCE"]);
  });
});

describe("pickCode", () => {
  test("lấy mã của kết quả hợp lệ đầu tiên", () => {
    assert.equal(pickCode([res("8936079121822")]), "8936079121822");
    assert.equal(pickCode([res("8934563163150"), res("8993175532457")]), "8934563163150");
  });

  test("nhận EAN-8, UPC-A, UPC-E", () => {
    assert.equal(pickCode([res("96385074", "EAN8")]), "96385074");
    assert.equal(pickCode([res("036000291452", "UPCA")]), "036000291452");
    assert.equal(pickCode([res("04252614", "UPCE")]), "04252614");
  });

  test("mã UPC-A: zxing-wasm trả 13 số có số 0 đầu → đổi về 12 số như html5-qrcode (camera, cách đọc ảnh cũ)", () => {
    // zxing-wasm 3.1.6 đọc mã UPC-A 036000291452 ra "0036000291452" (định dạng EAN13, hoặc UPCA nếu chỉ bật UPCA).
    assert.equal(pickCode([res("0036000291452", "EAN13")]), "036000291452");
    assert.equal(pickCode([res("0036000291452", "UPCA")]), "036000291452");
    // EAN-13 không bắt đầu bằng 0 giữ nguyên; EAN-8 bắt đầu bằng 0 giữ nguyên
    assert.equal(pickCode([res("8934563163150", "EAN13")]), "8934563163150");
    assert.equal(pickCode([res("04210009", "EAN8")]), "04210009");
  });

  test("bỏ kết quả không hợp lệ (isValid false), lấy kết quả hợp lệ sau nó", () => {
    assert.equal(pickCode([res("8936079121823", "EAN13", false), res("8936079121822")]), "8936079121822");
    assert.equal(pickCode([res("8936079121823", "EAN13", false)]), null);
  });

  test("bỏ định dạng app không nhận (QR, Code 128, EAN-5…)", () => {
    assert.equal(pickCode([res("https://x.vn", "QRCode"), res("12345678", "Code128"), res("52495", "EAN5")]), null);
    assert.equal(pickCode([res("12345678", "Code128"), res("8934563163150")]), "8934563163150");
  });

  test("bỏ chữ không phải 8–14 chữ số", () => {
    assert.equal(pickCode([res("8934563"),res("893456316315012"), res("8934 563163150"), res("")]), null);
    assert.equal(pickCode([res(" 8934563163150 ")]), "8934563163150"); // khoảng trắng hai đầu thì cắt
  });

  test("đầu vào lạ → null, không ném lỗi", () => {
    for (const x of [undefined, null, [], "8934563163150", {}, [null], [{}], [{ text: 8934563163150, format: "EAN13", isValid: true }]]) {
      assert.equal(pickCode(x), null, JSON.stringify(x));
    }
  });
});

describe("scanFailureText", () => {
  const html5 = { name: "NotFoundException", message: "", tries: 4 };

  test("zxing-wasm không thấy mã + html5-qrcode trượt", () => {
    assert.equal(scanFailureText({ zxing: { status: "notfound" }, html5 }),
      "zxing-wasm: không thấy mã; html5-qrcode: NotFoundException (đã thử 4 lần)");
  });

  test("zxing-wasm không tải được: kèm lý do", () => {
    assert.equal(scanFailureText({ zxing: { status: "load", detail: "TypeError: Failed to fetch" }, html5 }),
      "zxing-wasm: không tải được (TypeError: Failed to fetch); html5-qrcode: NotFoundException (đã thử 4 lần)");
  });

  test("zxing-wasm ném lỗi khi đọc: kèm lý do", () => {
    assert.equal(scanFailureText({ zxing: { status: "error", detail: "RangeError: x" }, html5 }),
      "zxing-wasm: lỗi khi đọc (RangeError: x); html5-qrcode: NotFoundException (đã thử 4 lần)");
  });

  test("html5-qrcode có câu lỗi thì ghi kèm; 1 lần thử", () => {
    assert.equal(scanFailureText({ zxing: { status: "notfound" }, html5: { name: "Error", message: "No barcode", tries: 1 } }),
      "zxing-wasm: không thấy mã; html5-qrcode: Error: No barcode (đã thử 1 lần)");
  });

  test("thiếu thông tin vẫn ra câu đọc được (không có 'undefined')", () => {
    const t = scanFailureText({});
    assert.ok(!t.includes("undefined"), t);
    assert.ok(t.startsWith("zxing-wasm: "), t);
    assert.ok(t.includes("html5-qrcode: "), t);
    const t2 = scanFailureText({ zxing: { status: "load" }, html5: { tries: 0 } });
    assert.ok(!t2.includes("undefined") && !t2.includes("()"), t2);
  });
});
