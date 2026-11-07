// Test phần thuần của "Bật camera" (src/camera.js, đợt nhay-hon P2): yêu cầu độ phân giải, vùng cắt để giải mã,
// đổi kết quả BarcodeDetector sang mã, nút đèn pin / phóng to theo khả năng camera (capabilities giả).
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CAMERA_IDEAL, cameraConstraints, cameraCrop, detectorCode, DETECTOR_FORMATS,
  cameraControls, nextZoom, zoomLabel, pickCameraCode, confirmCode, CONFIRM_WINDOW_MS
} from "../src/camera.js";

describe("cameraConstraints: camera sau, độ phân giải mong muốn 1280×720", () => {
  test("facingMode environment nằm TRONG video (html5-qrcode bỏ qua tham số đầu khi có videoConstraints)", () => {
    const c = cameraConstraints();
    assert.deepEqual(c, { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } });
    assert.deepEqual(CAMERA_IDEAL, { width: 1280, height: 720 });
  });
  test("mỗi lần gọi trả object mới (sửa không ảnh hưởng lần sau)", () => {
    const a = cameraConstraints();
    a.width.ideal = 1;
    assert.equal(cameraConstraints().width.ideal, 1280);
  });
});

describe("cameraCrop: vùng giữa phần NHÌN THẤY (object-fit: cover) để giải mã", () => {
  test("video 16:9 trong khung 4:3: cắt theo phần thấy được, 92% × 60% ở giữa", () => {
    const r = cameraCrop(1280, 720, 400, 300);
    // phần thấy được: cao 720, rộng 720 × 4/3 = 960, lệch trái (1280 − 960) / 2 = 160
    assert.equal(r.sw, Math.round(960 * 0.92));
    assert.equal(r.sh, Math.round(720 * 0.6));
    assert.equal(r.sx, Math.round(160 + (960 - r.sw) / 2));
    assert.equal(r.sy, Math.round((720 - r.sh) / 2));
    assert.equal(r.dw, r.sw); // không quá 1280 nên giữ nguyên cỡ
    assert.equal(r.dh, r.sh);
  });
  test("video 4:3 trong khung 4:3: cắt đúng 92% × 60% giữa ảnh", () => {
    const r = cameraCrop(640, 480, 400, 300);
    assert.deepEqual(r, { sx: 26, sy: 96, sw: 589, sh: 288, dw: 589, dh: 288 });
  });
  test("video dọc (iPhone cầm dọc, 720×1280) trong khung 4:3: phần thấy được rộng 720, cao 540", () => {
    const r = cameraCrop(720, 1280, 400, 300);
    assert.equal(r.sw, Math.round(720 * 0.92));
    assert.equal(r.sh, Math.round(540 * 0.6));
    assert.equal(r.sy, Math.round((1280 - 540) / 2 + (540 - r.sh) / 2));
  });
  test("video lớn (1920×1080): thu nhỏ để cạnh ngang vùng giải mã ≤ 1280 (giữ tỷ lệ)", () => {
    const r = cameraCrop(1920 * 2, 1080 * 2, 400, 300);
    assert.ok(r.dw <= 1280, JSON.stringify(r));
    assert.equal(r.dw, 1280);
    assert.equal(r.dh, Math.round(r.sh * 1280 / r.sw));
  });
  test("chưa có cỡ video (0, NaN) → null (bỏ khung này)", () => {
    for (const a of [[0, 480, 400, 300], [640, 0, 400, 300], [NaN, 480, 400, 300]]) {
      assert.equal(cameraCrop(...a), null, JSON.stringify(a));
    }
  });
  test("khung chưa đo được (thiếu, 0) nhưng có video → coi cả video là phần nhìn thấy", () => {
    const want = { sx: 26, sy: 96, sw: 589, sh: 288, dw: 589, dh: 288 };
    assert.deepEqual(cameraCrop(640, 480), want);
    assert.deepEqual(cameraCrop(640, 480, 0, 300), want);
  });
});

describe("detectorCode: kết quả BarcodeDetector → mã như zxing-wasm / html5-qrcode", () => {
  test("4 định dạng mã hàng", () => {
    assert.deepEqual(DETECTOR_FORMATS, ["ean_13", "ean_8", "upc_a", "upc_e"]);
  });
  test("ean_13 → 13 số; upc_a 13 số có 0 đầu → 12 số; upc_e 8 số giữ nguyên", () => {
    assert.equal(detectorCode([{ format: "ean_13", rawValue: "8934563163150" }]), "8934563163150");
    assert.equal(detectorCode([{ format: "upc_a", rawValue: "0036000291452" }]), "036000291452");
    assert.equal(detectorCode([{ format: "upc_a", rawValue: "036000291452" }]), "036000291452");
    assert.equal(detectorCode([{ format: "upc_e", rawValue: "01234565" }]), "01234565");
    assert.equal(detectorCode([{ format: "ean_8", rawValue: "96385074" }]), "96385074");
  });
  test("định dạng khác (qr_code), chữ không phải số, rỗng, không phải mảng → null; lấy kết quả hợp lệ đầu tiên", () => {
    assert.equal(detectorCode([{ format: "qr_code", rawValue: "8934563163150" }]), null);
    assert.equal(detectorCode([{ format: "ean_13", rawValue: "abc" }]), null);
    assert.equal(detectorCode([]), null);
    assert.equal(detectorCode(null), null);
    assert.equal(detectorCode([{ format: "qr_code", rawValue: "x" }, { format: "ean_13", rawValue: "8934563163150" }]), "8934563163150");
  });
});

describe("cameraControls: nút đèn pin / phóng to chỉ hiện khi camera hỗ trợ", () => {
  test("không có capabilities (Safari cũ, camera giả) → không nút nào", () => {
    for (const caps of [undefined, null, {}, "x"]) {
      assert.deepEqual(cameraControls(caps), { torch: false, zoom: null }, JSON.stringify(caps));
    }
  });
  test("torch: true (Chrome Android) → có nút đèn; torch [true, false] cũng nhận; torch false → không", () => {
    assert.equal(cameraControls({ torch: true }).torch, true);
    assert.equal(cameraControls({ torch: [false, true] }).torch, true);
    assert.equal(cameraControls({ torch: false }).torch, false);
    assert.equal(cameraControls({ torch: "true" }).torch, false);
  });
  test("zoom 1–8 bước 0.1 → các mức 1×, 2×, 3×; mức hiện tại lấy từ settings", () => {
    const z = cameraControls({ zoom: { min: 1, max: 8, step: 0.1 } }, { zoom: 1 }).zoom;
    assert.deepEqual(z, { levels: [1, 2, 3], current: 1 });
  });
  test("zoom 1–2.5 → mức 1×, 2×; zoom 0.5–10 (iPhone nhiều ống kính) → 1×, 2×, 3× (không lấy dưới 1×)", () => {
    assert.deepEqual(cameraControls({ zoom: { min: 1, max: 2.5, step: 0.5 } }).zoom.levels, [1, 2]);
    assert.deepEqual(cameraControls({ zoom: { min: 0.5, max: 10, step: 0.01 } }).zoom.levels, [1, 2, 3]);
  });
  test("zoom không phóng được (max < 1,5 lần min), thiếu số, max ≤ min → không nút phóng to", () => {
    for (const zoom of [{ min: 1, max: 1.2, step: 0.1 }, { min: 1 }, { min: 2, max: 2 }, { min: "1", max: "4" }, { min: 4, max: 1 }]) {
      assert.equal(cameraControls({ zoom }).zoom, null, JSON.stringify(zoom));
    }
  });
  test("mức hiện tại không có trong settings → mức nhỏ nhất", () => {
    assert.equal(cameraControls({ zoom: { min: 1, max: 4, step: 1 } }, {}).zoom.current, 1);
  });
});

describe("nextZoom / zoomLabel: bấm phóng to lần lượt 1× → 2× → 3× → 1×", () => {
  test("lấy mức kế tiếp, cuối thì quay về mức đầu; mức lạ thì về mức đầu", () => {
    assert.equal(nextZoom([1, 2, 3], 1), 2);
    assert.equal(nextZoom([1, 2, 3], 2), 3);
    assert.equal(nextZoom([1, 2, 3], 3), 1);
    assert.equal(nextZoom([1, 2, 3], 2.5), 3);
    assert.equal(nextZoom([1, 2], 7), 1);
  });
  test("nhãn nút ghi mức sẽ chuyển tới", () => {
    assert.equal(zoomLabel([1, 2, 3], 1), "Phóng to 2×");
    assert.equal(zoomLabel([1, 2, 3], 2), "Phóng to 3×");
    assert.equal(zoomLabel([1, 2, 3], 3), "Thu về 1×");
  });
});

describe("pickCameraCode / confirmCode: tránh đọc nhầm mã ngắn khi quét camera", () => {
  // Đo 07/11/2026 (nhay-hon): khung lon 7Up nghiêng 18° ở 1280×720, zxing-wasm đọc ra UPC-E giả "0193458000088"
  // (lineCount 2) cùng lúc với EAN-13 thật "8934588022111".
  const upceFake = { isValid: true, format: "UPCE", text: "0193458000088", extra: "" };
  const ean13 = { isValid: true, format: "EAN13", text: "8934588022111" };
  test("có cả mã dài (EAN-13 / UPC-A) và mã ngắn (UPC-E / EAN-8) trong 1 khung → lấy mã dài", () => {
    assert.equal(pickCameraCode([upceFake, ean13]), "8934588022111");
    assert.equal(pickCameraCode([{ isValid: true, format: "EAN8", text: "96385074" }, { isValid: true, format: "UPCA", text: "0036000291452" }]), "036000291452");
  });
  test("chỉ có mã ngắn → vẫn trả mã ngắn (8 số); rỗng / không hợp lệ → null", () => {
    assert.equal(pickCameraCode([upceFake]), "19345888");
    assert.equal(pickCameraCode([{ isValid: true, format: "EAN8", text: "96385074" }]), "96385074");
    assert.equal(pickCameraCode([]), null);
    assert.equal(pickCameraCode([{ ...ean13, isValid: false }]), null);
    assert.equal(pickCameraCode(null), null);
  });
  test("BarcodeDetector cũng ưu tiên mã dài", () => {
    assert.equal(detectorCode([{ format: "upc_e", rawValue: "01234565" }, { format: "ean_13", rawValue: "8934563163150" }]), "8934563163150");
  });
  // Tham số thứ 4 (frame) = số thứ tự khung đã giải mã trong decodeLoop (tăng 1 mỗi khung, kể cả khung không ra mã).
  test("mã 12–13 số nhận ngay; mã 8 số phải đọc ra 2 lần (không cần liền nhau) trong 1 giây mới nhận", () => {
    let s = confirmCode(null, "8934563163150", 0, 1);
    assert.equal(s.accept, "8934563163150");
    s = confirmCode(null, "96385074", 0, 1);
    assert.equal(s.accept, null); // mã 8 số đọc 1 lần: chưa nhận
    s = confirmCode(s.state, null, 120, 2); // khung không thấy mã: giữ mã chờ
    assert.equal(s.accept, null);
    s = confirmCode(s.state, "96385074", 240, 3);
    assert.equal(s.accept, "96385074");
  });
  test("mã 8 số khác lần trước → chờ lại từ đầu; mã dài tới thì nhận mã dài", () => {
    let s = confirmCode(null, "96385074", 0, 1);
    s = confirmCode(s.state, "19345888", 120, 2);
    assert.equal(s.accept, null);
    s = confirmCode(s.state, "96385074", 240, 3);
    assert.equal(s.accept, null);
    assert.equal(confirmCode(s.state, "8934588022111", 360, 4).accept, "8934588022111");
  });
});

describe("confirmCode: mã 8 số đang chờ hết hạn sau CONFIRM_WINDOW_MS (1 giây)", () => {
  // Lý do (code-reviewer, nhay-hon vòng 1): mảnh UPC-E giả "19345888" (lon 7Up nghiêng) được giữ mãi,
  // 15 giây sau gặp lại là nhận và tra sai sản phẩm.
  test("CONFIRM_WINDOW_MS = 1000", () => {
    assert.equal(CONFIRM_WINDOW_MS, 1000);
  });
  test("(a) đọc lần 2 sau 500 ms → nhận", () => {
    const s = confirmCode(null, "19345888", 10000, 1);
    assert.equal(s.accept, null);
    assert.equal(confirmCode(s.state, "19345888", 10500, 5).accept, "19345888");
  });
  test("(b) đọc lần 2 sau 1500 ms (cách 12 khung) → không nhận, mã chờ mới là lần này", () => {
    const s1 = confirmCode(null, "19345888", 10000, 1);
    const s2 = confirmCode(s1.state, "19345888", 11500, 13);
    assert.equal(s2.accept, null);
    assert.deepEqual(s2.state, { code: "19345888", at: 11500, frame: 13 });
  });
  test("(c) lần 3 trong 1 giây sau (b) → nhận", () => {
    const s1 = confirmCode(null, "19345888", 10000, 1);
    const s2 = confirmCode(s1.state, "19345888", 11500, 13);
    const s3 = confirmCode(s2.state, "19345888", 12300, 20);
    assert.equal(s3.accept, "19345888");
    assert.equal(s3.state, null);
  });
  test("(d) khung trống ở giữa không xóa mã chờ nhưng vẫn hết hạn theo giờ", () => {
    const s1 = confirmCode(null, "19345888", 0, 0);
    const blank = confirmCode(s1.state, null, 900, 8);
    assert.equal(blank.accept, null);
    assert.deepEqual(blank.state, { code: "19345888", at: 0, frame: 0 }); // giữ nguyên, không dời mốc giờ / khung
    assert.equal(confirmCode(blank.state, "19345888", 950, 9).accept, "19345888"); // còn trong 1 giây kể từ lần đầu
    const late = confirmCode(confirmCode(s1.state, null, 900, 8).state, "19345888", 15000, 120); // 15 giây sau
    assert.equal(late.accept, null);
    assert.deepEqual(late.state, { code: "19345888", at: 15000, frame: 120 });
  });
  test("(e) mã 13 số nhận ngay và xóa mã chờ", () => {
    const s1 = confirmCode(null, "19345888", 0, 1);
    const s2 = confirmCode(s1.state, "8934588022111", 100, 2);
    assert.equal(s2.accept, "8934588022111");
    assert.equal(s2.state, null);
  });
  test("(f) đúng biên 1000 ms → nhận; 1001 ms → không (cách 8 khung)", () => {
    const s1 = confirmCode(null, "96385074", 2000, 1);
    assert.equal(confirmCode(s1.state, "96385074", 3000, 9).accept, "96385074");
    assert.equal(confirmCode(s1.state, "96385074", 3001, 9).accept, null);
  });
});

describe("confirmCode: mã 8 số ở 2 khung giải mã liền nhau được nhận (máy chậm)", () => {
  // Lý do (code-reviewer, nhay-hon vòng 2): giờ lấy SAU khi giải mã xong + nghỉ 120 ms; máy chậm giải mã 1 khung
  // hơn ~880 ms thì 2 lần đọc luôn cách nhau quá 1 giây → mã EAN-8 không bao giờ được nhận.
  test("(g) frame 5 lúc 0 ms, đúng mã đó ở frame 6 lúc 1500 ms → nhận", () => {
    const s1 = confirmCode(null, "96385074", 0, 5);
    assert.equal(s1.accept, null);
    assert.deepEqual(s1.state, { code: "96385074", at: 0, frame: 5 });
    const s2 = confirmCode(s1.state, "96385074", 1500, 6);
    assert.equal(s2.accept, "96385074");
    assert.equal(s2.state, null);
  });
  test("(h) frame 5, frame 6 không có mã, frame 7 đúng mã lúc 1500 ms → không nhận, mã chờ mới là lần này", () => {
    const s1 = confirmCode(null, "96385074", 0, 5);
    const blank = confirmCode(s1.state, null, 750, 6);
    assert.equal(blank.accept, null);
    assert.deepEqual(blank.state, { code: "96385074", at: 0, frame: 5 });
    const s3 = confirmCode(blank.state, "96385074", 1500, 7);
    assert.equal(s3.accept, null);
    assert.deepEqual(s3.state, { code: "96385074", at: 1500, frame: 7 });
  });
  test("(i) frame 5 mã \"19345888\", frame 6 mã 8 số khác lúc 1500 ms → không nhận", () => {
    const s1 = confirmCode(null, "19345888", 0, 5);
    const s2 = confirmCode(s1.state, "96385074", 1500, 6);
    assert.equal(s2.accept, null);
    assert.deepEqual(s2.state, { code: "96385074", at: 1500, frame: 6 });
  });
});
