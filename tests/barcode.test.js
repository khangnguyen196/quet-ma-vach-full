// Test src/barcode.js: chọn mã từ kết quả zxing-wasm và ghép dòng lỗi "đã thử những gì" khi "Chụp ảnh mã" trượt.
// Không cần trình duyệt, không cần zxing-wasm: kết quả là object giả có dạng giống ReadResult của thư viện.
// Chạy: npm test
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import {
  pickCode, scanFailureText, raceTimeout, ZXING_FORMATS, ZXING_LOAD_TIMEOUT_MS, ZXING_TIMEOUT_MESSAGE
} from "../src/barcode.js";

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

  test("mã UPC-E: zxing-wasm trả 13 số (dạng UPC-A mở rộng) → lấy 8 số in trên bao bì như html5-qrcode (sua-cuoi vòng 2)", () => {
    // Đo thật bằng zxing-wasm 3.1.6 trên ảnh UPC-E tổng hợp: text "0012345000065", format "UPCE",
    // extra '{"UPCE":"01234565"}'; html5-qrcode đọc cùng ảnh ra "01234565".
    const upce = (text, extra) => ({ ...res(text, "UPCE"), extra });
    assert.equal(pickCode([upce("0012345000065", '{"UPCE":"01234565"}')]), "01234565");
    assert.equal(pickCode([upce("0042100005264", '{"UPCE":"04252614"}')]), "04252614");
    assert.equal(pickCode([upce("0123456000070", '{"UPCE":"12345670"}')]), "12345670");
    // extra là object (không phải chuỗi JSON) cũng nhận
    assert.equal(pickCode([upce("0012345000065", { UPCE: "01234565" })]), "01234565");
    // mã in trên bao bì không theo dạng chuẩn: tin extra (mã in thật), không tự nén lại
    assert.equal(pickCode([upce("0012000000003", '{"UPCE":"01200033"}')]), "01200033");
  });

  test("mã UPC-E không có / hỏng extra → tự nén 13 số về 8 số theo luật UPC-E chuẩn", () => {
    const upce = (text, extra) => ({ ...res(text, "UPCE"), extra });
    for (const [text, want] of [
      ["0012345000065", "01234565"], // số thứ 6 = 5–9
      ["0042100005264", "04252614"], // 0–2
      ["0012000003455", "01234505"], // 0–2
      ["0001000002346", "00123406"], // 0–2, hệ số 0
      ["0012300000451", "01234531"], // 3
      ["0012340000053", "01234543"], // 4
      ["0198760000054", "19876544"], // 4, hệ số 1
      ["0123456000070", "12345670"], // 5–9, hệ số 1
      ["0000400000099", "00040939"] // 3 (dạng chuẩn của mã này)
    ]) {
      for (const extra of [undefined, "", "không phải JSON", '{"UPCE":"123"}', "{}", null]) {
        assert.equal(pickCode([upce(text, extra)]), want, `${text} extra=${JSON.stringify(extra)}`);
      }
    }
  });

  test("mã UPC-E 13 số không nén được (không phải dạng mở rộng của UPC-E) → 12 số UPC-A như mã UPC-A", () => {
    assert.equal(pickCode([{ ...res("0036000291452", "UPCE") }]), "036000291452");
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

  test("đã thử thêm lượt xoay ±15° bằng zxing-wasm thì câu ghi rõ", () => {
    assert.equal(scanFailureText({ zxing: { status: "notfound", rotated: true }, html5 }),
      "zxing-wasm: không thấy mã (kể cả khi xoay ±15°); html5-qrcode: NotFoundException (đã thử 4 lần)");
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

  test("hết giờ tải wasm (status 'timeout'): 'chưa tải xong sau N giây (mạng chậm)', N lấy từ ZXING_LOAD_TIMEOUT_MS, bỏ qua detail", () => {
    const t = scanFailureText({ zxing: { status: "timeout", detail: ZXING_TIMEOUT_MESSAGE }, html5 });
    assert.equal(t, `zxing-wasm: chưa tải xong sau ${ZXING_LOAD_TIMEOUT_MS / 1000} giây (mạng chậm); html5-qrcode: NotFoundException (đã thử 4 lần)`);
    assert.ok(!t.includes("không tải được") && !t.includes("hết giờ"), t);
    assert.ok(!/\(.*\(/.test(t.split(";")[0]), t);
  });
});

describe("raceTimeout (giới hạn thời gian tải wasm, sua-cuoi vòng 3)", () => {
  const timeoutError = () => new Error("hết giờ");

  test("promise xong trước hạn → trả giá trị của promise", async () => {
    assert.equal(await raceTimeout(Promise.resolve(42), 1000, timeoutError), 42);
    const slow = new Promise((resolve) => setTimeout(() => resolve("xong"), 5));
    assert.equal(await raceTimeout(slow, 1000, timeoutError), "xong");
  });

  test("promise lỗi trước hạn → ném đúng lỗi gốc (không phải lỗi hết giờ)", async () => {
    const original = new TypeError("Failed to fetch");
    await assert.rejects(raceTimeout(Promise.reject(original), 1000, timeoutError), (e) => e === original);
  });

  test("quá hạn → ném lỗi do makeError tạo, promise gốc vẫn chạy tiếp", async () => {
    let resolveLater;
    const never = new Promise((resolve) => { resolveLater = resolve; });
    const err = new Error("Hết giờ");
    await assert.rejects(raceTimeout(never, 10, () => err), (e) => e === err);
    // promise gốc không bị đụng tới: vẫn xong được về sau, cho lần chụp sau dùng lại
    resolveLater("wasm đã tải");
    assert.equal(await never, "wasm đã tải");
  });

  test("xong trước hạn thì không còn timer treo: hết hạn sau đó không gọi makeError, clearTimeout đã gọi", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const clear = t.mock.method(globalThis, "clearTimeout");
    let made = 0;
    const make = () => { made++; return new Error("hết giờ"); };
    assert.equal(await raceTimeout(Promise.resolve("ok"), 10000, make), "ok");
    await assert.rejects(raceTimeout(Promise.reject(new Error("lỗi thật")), 10000, make), /lỗi thật/);
    t.mock.timers.tick(20000); // nếu timer còn treo thì lúc này makeError bị gọi
    assert.equal(made, 0);
    assert.equal(clear.mock.callCount(), 2);
  });

  test("hết hạn: makeError gọi đúng 1 lần, timer đã dọn", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let made = 0;
    const p = raceTimeout(new Promise(() => {}), 10000, () => { made++; return new Error("hết giờ"); });
    t.mock.timers.tick(9999);
    assert.equal(made, 0);
    t.mock.timers.tick(1);
    await assert.rejects(p, /hết giờ/);
    t.mock.timers.tick(20000);
    assert.equal(made, 1);
  });

  test("hằng ZXING_LOAD_TIMEOUT_MS = 10 giây", () => {
    assert.equal(ZXING_LOAD_TIMEOUT_MS, 10000);
  });

  test("dòng nhỏ khi zxing-wasm hết giờ tải và html5-qrcode cũng trượt: tiếng Việt, dễ hiểu, không ngoặc lồng", () => {
    const t = scanFailureText({
      zxing: { status: "timeout" },
      html5: { name: "NotFoundException", message: "", tries: 4 }
    });
    assert.equal(t, "zxing-wasm: chưa tải xong sau 10 giây (mạng chậm); html5-qrcode: NotFoundException (đã thử 4 lần)");
    assert.ok(!/\(.*\(/.test(t.split(";")[0]), t);
  });
});
