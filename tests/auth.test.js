// Test phần thuần của đăng nhập (src/auth.js, đợt dang-nhap): đọc biến môi trường, địa chỉ quay về sau Google,
// xóa mã đăng nhập khỏi địa chỉ, trạng thái hiển thị. Chạy bằng node, không cần import.meta.env hay trình duyệt.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// import động + catch: chưa có src/auth.js thì từng test đỏ riêng (thử đỏ / xanh), không phải lỗi cả file
const auth = await import("../src/auth.js").catch(() => ({}));

const URL_OK = "https://abcdefgh.supabase.co";
const KEY_OK = "sb_publishable_khoa-cong-khai-thu";
const PAGES = "https://khangnguyen196.github.io/quet-ma-vach-full/";

describe("authConfig(env)", () => {
  test("đủ 2 biến https → { url, key } (bỏ khoảng trắng, bỏ / cuối)", () => {
    assert.deepEqual(auth.authConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }), { url: URL_OK, key: KEY_OK });
    assert.deepEqual(auth.authConfig({ VITE_SUPABASE_URL: ` ${URL_OK}/ `, VITE_SUPABASE_PUBLISHABLE_KEY: ` ${KEY_OK} ` }), { url: URL_OK, key: KEY_OK });
  });

  test("thiếu 1 / cả 2 biến, rỗng, chỉ khoảng trắng → null", () => {
    for (const env of [
      {}, { VITE_SUPABASE_URL: URL_OK }, { VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK },
      { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
      { VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: "" },
      { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK },
      { VITE_SUPABASE_URL: "   ", VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK },
      { VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: "  " }
    ]) {
      assert.equal(auth.authConfig(env), null, JSON.stringify(env));
    }
    assert.equal(auth.authConfig(undefined), null);
    assert.equal(auth.authConfig(null), null);
  });

  test("URL không phải https (http, không có giao thức, hỏng) → null", () => {
    for (const url of ["http://abcdefgh.supabase.co", "abcdefgh.supabase.co", "không phải url", "https://", "javascript:alert(1)", "ftp://x.supabase.co"]) {
      assert.equal(auth.authConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }), null, url);
    }
  });
});

describe("redirectUrl(location)", () => {
  test("trang Pages: giữ nguyên, có / cuối", () => {
    assert.equal(auth.redirectUrl(new URL(PAGES)), PAGES);
  });

  test("…/index.html → bỏ index.html, giữ / cuối", () => {
    assert.equal(auth.redirectUrl(new URL(PAGES + "index.html")), PAGES);
  });

  test("https://localhost:5173/ → https://localhost:5173/", () => {
    assert.equal(auth.redirectUrl(new URL("https://localhost:5173/")), "https://localhost:5173/");
    assert.equal(auth.redirectUrl(new URL("https://localhost:5173/index.html")), "https://localhost:5173/");
  });

  test("bỏ query và # (không gửi ?code= cũ, không gửi dữ liệu trang)", () => {
    assert.equal(auth.redirectUrl(new URL(PAGES + "?code=abc&x=1#tu-do")), PAGES);
  });

  test("nhận object kiểu window.location ({ origin, pathname })", () => {
    assert.equal(auth.redirectUrl({ origin: "https://khangnguyen196.github.io", pathname: "/quet-ma-vach-full/index.html" }), PAGES);
  });
});

describe("cleanAuthParams(url)", () => {
  test("bỏ code / error / error_description, giữ tham số khác và #", () => {
    assert.equal(auth.cleanAuthParams(PAGES + "?code=abc"), PAGES);
    assert.equal(auth.cleanAuthParams(PAGES + "?x=1&code=abc&y=2#h"), PAGES + "?x=1&y=2#h");
    assert.equal(
      auth.cleanAuthParams(PAGES + "?error=access_denied&error_description=Huy+dang+nhap&keep=ok"),
      PAGES + "?keep=ok"
    );
  });

  test("không có tham số đăng nhập → giữ nguyên", () => {
    assert.equal(auth.cleanAuthParams(PAGES), PAGES);
    assert.equal(auth.cleanAuthParams(PAGES + "?a=1"), PAGES + "?a=1");
    assert.equal(auth.cleanAuthParams("https://localhost:5173/?codex=1"), "https://localhost:5173/?codex=1");
  });

  test("nhận URL object", () => {
    assert.equal(auth.cleanAuthParams(new URL("https://localhost:5173/?code=z&q=2")), "https://localhost:5173/?q=2");
  });
});

describe("authErrorFromUrl(url)", () => {
  test("có error → câu tiếng Việt ngắn; không có → rỗng", () => {
    assert.equal(auth.authErrorFromUrl(PAGES), "");
    assert.equal(auth.authErrorFromUrl(PAGES + "?code=abc"), "");
    const msg = auth.authErrorFromUrl(PAGES + "?error=access_denied&error_description=User+cancelled");
    assert.match(msg, /hủy|danh sách/i);
    assert.ok(!msg.includes("User cancelled"), "không chép nguyên câu tiếng Anh từ địa chỉ");
    assert.ok(auth.authErrorFromUrl(PAGES + "?error=server_error").length > 0);
  });
});

describe("emailOf(session)", () => {
  test("có email → email; null / thiếu user / thiếu email / không phải chuỗi → rỗng", () => {
    assert.equal(auth.emailOf({ user: { email: "ai@example.com" } }), "ai@example.com");
    for (const s of [null, undefined, {}, { user: null }, { user: {} }, { user: { email: 123 } }, "chuoi"]) {
      assert.equal(auth.emailOf(s), "", JSON.stringify(s));
    }
  });
});

describe("authView(state)", () => {
  test("chưa cấu hình → ẩn", () => {
    assert.deepEqual(auth.authView({ configured: false }), { visible: false, mode: "hidden", email: "", error: "", busy: false });
  });

  test("đang tải / chưa đăng nhập / đã đăng nhập / không tải được", () => {
    assert.equal(auth.authView({ configured: true, loading: true }).mode, "loading");
    assert.equal(auth.authView({ configured: true, session: null }).mode, "signedOut");
    const v = auth.authView({ configured: true, session: { user: { email: "ai@example.com" } } });
    assert.deepEqual([v.visible, v.mode, v.email], [true, "signedIn", "ai@example.com"]);
    assert.equal(auth.authView({ configured: true, unavailable: true, error: "mất mạng" }).mode, "unavailable");
  });

  test("giữ câu lỗi và cờ bận", () => {
    const v = auth.authView({ configured: true, session: null, error: "Đã hủy", busy: true });
    assert.deepEqual([v.mode, v.error, v.busy], ["signedOut", "Đã hủy", true]);
  });
});
