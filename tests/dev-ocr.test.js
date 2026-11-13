// Test phần thuần của khu thử máy chủ OCR (src/dev-ocr.js, đợt may-chu-2): chọn địa chỉ máy chủ từ biến môi trường.
// Chạy bằng node (không cần import.meta.env, không cần trình duyệt: hàm nhận object env).
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// import động + catch: chưa có hàm thì từng test đỏ riêng (thử đỏ / xanh), không phải lỗi cả file
const mod = await import("../src/dev-ocr.js").catch(() => ({}));
const pick = (env) => mod.ocrServerUrl(env);
const DEFAULT = "http://127.0.0.1:8765";

describe("ocrServerUrl(env)", () => {
  test("không đặt biến nào / rỗng / chỉ khoảng trắng → mặc định 127.0.0.1:8765, không cảnh báo", () => {
    assert.deepEqual(pick({}), { url: DEFAULT, warning: "" });
    assert.deepEqual(pick({ VITE_OCR_SERVER_URL: "", VITE_OCR_DEV_URL: "  " }), { url: DEFAULT, warning: "" });
    assert.deepEqual(pick(undefined), { url: DEFAULT, warning: "" });
  });

  test("VITE_OCR_SERVER_URL trước, tên cũ VITE_OCR_DEV_URL dự phòng", () => {
    const az = "https://ocr-thu.example.azurecontainerapps.io";
    assert.equal(pick({ VITE_OCR_SERVER_URL: az, VITE_OCR_DEV_URL: "http://127.0.0.1:9000" }).url, az);
    assert.equal(pick({ VITE_OCR_DEV_URL: "http://127.0.0.1:9000" }).url, "http://127.0.0.1:9000");
    assert.equal(pick({ VITE_OCR_SERVER_URL: " ", VITE_OCR_DEV_URL: "http://127.0.0.1:9000" }).url, "http://127.0.0.1:9000");
  });

  test("bỏ khoảng trắng và mọi / cuối", () => {
    assert.deepEqual(pick({ VITE_OCR_SERVER_URL: " https://a.example/// " }), { url: "https://a.example", warning: "" });
    assert.equal(pick({ VITE_OCR_SERVER_URL: "http://127.0.0.1:8765/" }).url, DEFAULT);
  });

  for (const bad of ["ftp://a.example", "javascript:alert(1)", "a.example", "https://", "khong phai url",
    "https://user:pw@a.example", "https://a.example/?q=1", "https://a.example#x"]) {
    test(`sai dạng (${bad}) → mặc định + câu cảnh báo tiếng Việt`, () => {
      const r = pick({ VITE_OCR_SERVER_URL: bad });
      assert.equal(r.url, DEFAULT);
      assert.match(r.warning, /VITE_OCR_SERVER_URL/);
      assert.match(r.warning, /http/);
    });
  }

  test("tên cũ sai dạng thì cảnh báo nêu tên cũ", () => {
    const r = pick({ VITE_OCR_DEV_URL: "ftp://a" });
    assert.equal(r.url, DEFAULT);
    assert.match(r.warning, /VITE_OCR_DEV_URL/);
  });
});
