// Test chọn địa chỉ máy chủ OCR từ biến môi trường: ocrServerUrl(env).
// Đợt chup-mat: hàm chuyển từ src/dev-ocr.js sang src/front-photo.js (app chính dùng), dev-ocr.js import lại từ đó.
// ĐỔI HÀNH VI CÓ CHỦ ĐÍCH (đợt chup-mat): mặc định không còn là http://127.0.0.1:8765 mà là địa chỉ máy chủ trên Azure;
// http:// chỉ nhận khi máy là localhost / 127.0.0.1 / [::1] (token đăng nhập đi kèm ảnh nên phải https).
// Chạy bằng node (không cần import.meta.env, không cần trình duyệt: hàm nhận object env). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// import động + catch: chưa có hàm thì từng test đỏ riêng (thử đỏ / xanh), không phải lỗi cả file
const mod = await import("../src/front-photo.js").catch(() => ({}));
const dev = await import("../src/dev-ocr.js").catch(() => ({}));
const pick = (env) => mod.ocrServerUrl(env);
const DEFAULT = "https://quet-ma-vach-ocr.jollyground-aaecba36.malaysiawest.azurecontainerapps.io";

describe("ocrServerUrl(env)", () => {
  test("hằng OCR_DEFAULT_URL là địa chỉ Azure; dev-ocr.js dùng chung đúng hàm này", () => {
    assert.equal(mod.OCR_DEFAULT_URL, DEFAULT);
    assert.equal(dev.ocrServerUrl, mod.ocrServerUrl);
  });

  test("không đặt biến nào / rỗng / chỉ khoảng trắng → mặc định Azure, không cảnh báo", () => {
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
    assert.deepEqual(pick({ VITE_OCR_SERVER_URL: "http://127.0.0.1:8765/" }), { url: "http://127.0.0.1:8765", warning: "" });
  });

  test("http:// nhận cho máy chủ trên máy: localhost, 127.0.0.1, [::1]", () => {
    for (const u of ["http://localhost:8765", "http://127.0.0.1:8765", "http://[::1]:8765", "http://LOCALHOST:8765"]) {
      const r = pick({ VITE_OCR_SERVER_URL: u });
      assert.equal(r.warning, "", u);
      assert.equal(r.url.toLowerCase(), u.toLowerCase(), u);
    }
  });

  for (const bad of ["http://a.example", "http://quet-ma-vach-ocr.example.azurecontainerapps.io", "http://192.168.1.5:8765",
    "http://127.0.0.2:8765", "http://localhost.example.com", "http://0.0.0.0:8765"]) {
    test(`http:// tới máy khác (${bad}) → mặc định + cảnh báo https`, () => {
      const r = pick({ VITE_OCR_SERVER_URL: bad });
      assert.equal(r.url, DEFAULT);
      assert.match(r.warning, /VITE_OCR_SERVER_URL/);
      assert.match(r.warning, /https/);
    });
  }

  // Các cách lách luật "http:// chỉ cho máy này" (gợi ý code-reviewer vòng 1): tên miền bắt đầu bằng 127.0.0.1 / localhost,
  // tên đăng nhập "localhost@", IPv6 ánh xạ IPv4, localhost có dấu chấm cuối. Đều phải ra mặc định + cảnh báo.
  for (const bad of ["http://127.0.0.1.evil.com", "http://localhost@evil.com", "http://[::ffff:127.0.0.1]:8765",
    "http://localhost.:8765"]) {
    test(`lách luật http:// (${bad}) → mặc định + cảnh báo`, () => {
      const r = pick({ VITE_OCR_SERVER_URL: bad });
      assert.equal(r.url, DEFAULT);
      assert.match(r.warning, /VITE_OCR_SERVER_URL/);
      assert.notEqual(r.warning, "");
    });
  }

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
