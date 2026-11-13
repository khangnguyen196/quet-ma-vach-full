// Test phần thuần của "Chụp mặt trước" (src/front-photo.js, đợt chup-mat): fitSize, hằng số, sendOcr với máy chủ giả.
// Máy chủ giả: node:http trên 127.0.0.1, cổng ngẫu nhiên; mỗi đường dẫn trả một kiểu (200 / 401 / 429 / 503 / 413 /
// 415 / body sai / chậm). Không gọi máy chủ thật nào.
// Chạy: npm test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// import động + catch: chưa có hàm thì từng test đỏ riêng (thử đỏ / xanh), không phải lỗi cả file
const mod = await import("../src/front-photo.js").catch(() => ({}));

const TOKEN = "token-gia-cho-test";
const ITEMS = [
  { text: "VISSAN", poly: [[270, 251], [692, 249], [693, 340], [271, 342]], score: 0.99996 },
  { text: "MAI QUÊ", poly: [[208, 659], [715, 600], [735, 777], [228, 836]], score: 0.97058 },
];

describe("hằng số + fitSize (giống server/imaging.py fit_size)", () => {
  test("hằng số của vòng 0", () => {
    assert.equal(mod.FRONT_MAX_SIDE, 1600);
    assert.equal(mod.FRONT_JPEG_QUALITY, 0.9);
    assert.equal(mod.OCR_TIMEOUT_MS, 45000);
    assert.equal(mod.OCR_SLOW_MS, 5000);
    assert.equal(mod.MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
  });

  test("thu cạnh dài về 1600, không phóng to (cùng số với server/tests/test_units.py)", () => {
    assert.deepEqual(mod.fitSize(2076, 3508), { width: 947, height: 1600 });
    assert.deepEqual(mod.fitSize(800, 600), { width: 800, height: 600 });
    assert.deepEqual(mod.fitSize(3201, 1), { width: 1600, height: 1 });
    assert.deepEqual(mod.fitSize(4000, 3000), { width: 1600, height: 1200 });
    assert.deepEqual(mod.fitSize(1600, 1600), { width: 1600, height: 1600 });
  });

  test("maxSide khác, cạnh 0 / sai → không ném lỗi, tối thiểu 1", () => {
    assert.deepEqual(mod.fitSize(1000, 500, 100), { width: 100, height: 50 });
    assert.deepEqual(mod.fitSize(0, 0), { width: 1, height: 1 });
    assert.deepEqual(mod.fitSize(NaN, 10), { width: 1, height: 1 });
  });
});

// ---- máy chủ giả ----
let server;
let base;
const seen = []; // { path, auth, contentType, hasImageField }

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("latin1");
      const path = req.url.replace(/\/ocr$/, "");
      seen.push({
        path, method: req.method, url: req.url, auth: req.headers.authorization || "",
        contentType: req.headers["content-type"] || "",
        hasImageField: /Content-Disposition: form-data; name="image"; filename="[^"]+"/.test(raw),
      });
      if (path === "/ok") return sendJson(res, 200, { items: ITEMS, width: 947, height: 1600, ms: 1200 });
      if (path === "/r401") return sendJson(res, 401, { error: "Token không hợp lệ hoặc đã hết hạn." });
      if (path === "/r429") return sendJson(res, 429, { error: "Gửi quá nhiều ảnh. Thử lại sau 30 giây." }, { "Retry-After": "30" });
      if (path === "/r429day") return sendJson(res, 429, { error: "Tài khoản này đã gửi đủ 200 ảnh hôm nay." }, { "Retry-After": "40000" });
      if (path === "/r429nohdr") return sendJson(res, 429, { error: "Gửi quá nhiều ảnh." });
      if (path === "/r503") return sendJson(res, 503, { error: "Máy chủ đang bận (hàng đợi đầy)." }, { "Retry-After": "5" });
      if (path === "/r413") return sendJson(res, 413, { error: "Ảnh quá lớn." });
      if (path === "/r415") return sendJson(res, 415, { error: "Không phải ảnh JPEG / PNG / HEIC." });
      if (path === "/r500") return sendJson(res, 500, { error: "Lỗi máy chủ, thử lại sau." });
      if (path === "/notjson") return sendJson(res, 200, "<html>không phải JSON</html>");
      if (path === "/noitems") return sendJson(res, 200, { items: "không phải mảng" });
      if (path === "/slow") return setTimeout(() => sendJson(res, 200, { items: ITEMS }), 250);
      if (path === "/hang") return setTimeout(() => { if (!res.destroyed) sendJson(res, 200, { items: ITEMS }); }, 3000);
      return sendJson(res, 404, { error: "Không có đường dẫn này." });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

const blob = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: "image/jpeg" });
const send = (path, extra = {}) => mod.sendOcr({ base: base + path, token: TOKEN, blob: blob(), ...extra });

describe("sendOcr: máy chủ giả", () => {
  test("200 + items → ok, items đúng, có ms; gửi Bearer token + multipart trường image tới <base>/ocr", async () => {
    const before = seen.length;
    const r = await send("/ok");
    assert.equal(r.ok, true);
    assert.deepEqual(r.items, ITEMS);
    assert.ok(Number.isFinite(r.ms) && r.ms >= 0);
    const req = seen[before];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/ok/ocr");
    assert.equal(req.auth, "Bearer " + TOKEN);
    assert.match(req.contentType, /^multipart\/form-data; boundary=/);
    assert.equal(req.hasImageField, true);
  });

  test("401 → auth, mời đăng nhập lại, kèm câu máy chủ", async () => {
    const r = await send("/r401");
    assert.equal(r.ok, false);
    assert.equal(r.kind, "auth");
    assert.match(r.message, /đăng nhập lại/);
    assert.equal(r.serverMessage, "Token không hợp lệ hoặc đã hết hạn.");
  });

  test("429 + Retry-After 30 → rate, chờ 30 giây", async () => {
    const r = await send("/r429");
    assert.equal(r.kind, "rate");
    assert.equal(r.retryAfter, 30);
    assert.match(r.message, /30 giây/);
    assert.match(r.serverMessage, /quá nhiều ảnh/);
  });

  test("429 + Retry-After 40000 (> 60 giây) → daily, hết lượt hôm nay", async () => {
    const r = await send("/r429day");
    assert.equal(r.kind, "daily");
    assert.equal(r.retryAfter, 40000);
    assert.match(r.message, /hết lượt hôm nay/);
  });

  test("429 không có Retry-After → rate, retryAfter null, câu không có số", async () => {
    const r = await send("/r429nohdr");
    assert.equal(r.kind, "rate");
    assert.equal(r.retryAfter, null);
    assert.doesNotMatch(r.message, /null|NaN|undefined/);
  });

  test("503 → busy (kèm retryAfter)", async () => {
    const r = await send("/r503");
    assert.equal(r.kind, "busy");
    assert.equal(r.retryAfter, 5);
    assert.match(r.message, /bận/);
  });

  test("413 → tooBig, 415 → badType, 500 → other", async () => {
    assert.equal((await send("/r413")).kind, "tooBig");
    assert.equal((await send("/r415")).kind, "badType");
    const r = await send("/r500");
    assert.equal(r.kind, "other");
    assert.match(r.message, /500/);
  });

  test("200 nhưng body không phải JSON / items không phải mảng → other", async () => {
    const a = await send("/notjson");
    assert.equal(a.ok, false);
    assert.equal(a.kind, "other");
    const b = await send("/noitems");
    assert.equal(b.ok, false);
    assert.equal(b.kind, "other");
  });

  test("chậm hơn timeoutMs → timeout (hủy bằng AbortController), không chờ máy chủ", async () => {
    const t0 = Date.now();
    const r = await send("/hang", { timeoutMs: 300, slowMs: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "timeout");
    assert.ok(Date.now() - t0 < 2500, "phải trả về ngay sau timeoutMs");
  });

  test("chậm hơn slowMs nhưng kịp → ok, onSlow gọi đúng 1 lần", async () => {
    let n = 0;
    const r = await send("/slow", { timeoutMs: 2000, slowMs: 50, onSlow: () => { n++; } });
    assert.equal(r.ok, true);
    assert.equal(n, 1);
    await new Promise((res) => setTimeout(res, 120)); // hẹn giờ đã hủy: không gọi thêm sau khi xong
    assert.equal(n, 1);
  });

  test("trả nhanh → onSlow không được gọi (kể cả sau khi xong)", async () => {
    let n = 0;
    const r = await send("/ok", { slowMs: 80, onSlow: () => { n++; } });
    assert.equal(r.ok, true);
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(n, 0);
  });

  test("lỗi trả về cũng hủy hẹn giờ onSlow", async () => {
    let n = 0;
    const r = await send("/r401", { slowMs: 80, onSlow: () => { n++; } });
    assert.equal(r.kind, "auth");
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(n, 0);
  });

  test("cổng đã đóng → network (câu gồm máy chủ bận hoặc mất mạng)", async () => {
    const tmp = http.createServer();
    await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
    const port = tmp.address().port;
    await new Promise((r) => tmp.close(r));
    const r = await mod.sendOcr({ base: `http://127.0.0.1:${port}`, token: TOKEN, blob: blob() });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "network");
    assert.match(r.message, /bận hoặc mất mạng/);
  });

  test("signal của người gọi hủy → aborted, không phải timeout", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const r = await send("/hang", { timeoutMs: 2000, signal: ctrl.signal });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "aborted");
  });

  test("token rỗng → auth, fetch KHÔNG được gọi", async () => {
    for (const token of ["", null, undefined, "   "]) {
      let called = 0;
      const r = await mod.sendOcr({ base, token, blob: blob(), fetchImpl: () => { called++; throw new Error("không được gọi"); } });
      assert.equal(r.ok, false);
      assert.equal(r.kind, "auth");
      assert.equal(called, 0);
    }
  });

  test("fetchImpl giả: nhận đúng URL, method, header", async () => {
    let got = null;
    const fake = async (url, init) => { got = { url, init }; return new Response(JSON.stringify({ items: [] }), { status: 200 }); };
    const r = await mod.sendOcr({ base: "https://may-chu.example", token: TOKEN, blob: blob(), fetchImpl: fake });
    assert.equal(r.ok, true);
    assert.deepEqual(r.items, []);
    assert.equal(got.url, "https://may-chu.example/ocr");
    assert.equal(got.init.method, "POST");
    assert.equal(got.init.headers.Authorization, "Bearer " + TOKEN);
    assert.ok(got.init.body instanceof FormData);
    assert.ok(got.init.body.get("image") instanceof Blob);
  });
});

describe("sendOcr: base / ảnh sai → other, KHÔNG gọi mạng (vòng 2, gợi ý code-reviewer)", () => {
  const noFetch = () => {
    const f = () => { f.called++; throw new Error("không được gọi"); };
    f.called = 0;
    return f;
  };

  for (const badBase of ["", undefined, null, "   ", "ftp://may-chu.example", "may-chu.example", "javascript:alert(1)", "https://"]) {
    test(`base ${JSON.stringify(badBase)} → kind other, fetch không được gọi`, async () => {
      const f = noFetch();
      const r = await mod.sendOcr({ base: badBase, token: TOKEN, blob: blob(), fetchImpl: f });
      assert.equal(r.ok, false);
      assert.equal(r.kind, "other");
      assert.equal(f.called, 0);
      assert.doesNotMatch(r.message, /undefined|null/);
    });
  }

  for (const [name, bad] of [["chuỗi", "khong-phai-blob"], ["object", { size: 3 }], ["số", 123]]) {
    test(`ảnh không phải Blob (${name}) → kind other, fetch không được gọi`, async () => {
      const f = noFetch();
      const r = await mod.sendOcr({ base: "https://may-chu.example", token: TOKEN, blob: bad, fetchImpl: f });
      assert.equal(r.ok, false);
      assert.equal(r.kind, "other");
      assert.equal(f.called, 0);
    });
  }

  test("base http://127.0.0.1:… (máy chủ trên máy) vẫn gửi được", async () => {
    let url = "";
    const fake = async (u) => { url = u; return new Response(JSON.stringify({ items: [] }), { status: 200 }); };
    const r = await mod.sendOcr({ base: "http://127.0.0.1:8765/", token: TOKEN, blob: blob(), fetchImpl: fake });
    assert.equal(r.ok, true);
    assert.equal(url, "http://127.0.0.1:8765/ocr");
  });
});

describe("429: ngưỡng hết lượt ngày = 60 giây (giới hạn theo phút của máy chủ chờ ≤ 60 giây)", () => {
  const r429 = (retry) => async () => new Response(JSON.stringify({ error: "x" }), { status: 429, headers: { "Retry-After": String(retry) } });
  const cases = [[1, "rate"], [60, "rate"], [61, "daily"], [120, "daily"], [301, "daily"], [40000, "daily"]];
  for (const [retry, kind] of cases) {
    test(`Retry-After ${retry} → ${kind}`, async () => {
      const r = await mod.sendOcr({ base: "https://may-chu.example", token: TOKEN, blob: blob(), fetchImpl: r429(retry) });
      assert.equal(r.kind, kind);
      assert.equal(r.retryAfter, retry);
    });
  }

  test("hằng DAILY_RETRY_MIN_S = 60", () => {
    assert.equal(mod.DAILY_RETRY_MIN_S, 60);
  });
});

describe("frontButtonState: nút Chụp mặt trước theo trạng thái đăng nhập (authState của main.js)", () => {
  const S = (patch) => ({ configured: true, loading: false, unavailable: false, session: null, error: "", busy: false, ...patch });

  test("không cấu hình đăng nhập → hidden (ẩn cả nút lẫn ghi chú)", () => {
    assert.equal(mod.frontButtonState(S({ configured: false })), "hidden");
    assert.equal(mod.frontButtonState(S({ configured: false, loading: true })), "hidden");
    assert.equal(mod.frontButtonState(S({ configured: false, session: { access_token: "x" } })), "hidden");
    assert.equal(mod.frontButtonState(undefined), "hidden");
    assert.equal(mod.frontButtonState(null), "hidden");
  });

  test("không tải được thư viện đăng nhập (unavailable) → hidden", () => {
    assert.equal(mod.frontButtonState(S({ unavailable: true })), "hidden");
  });

  test("đang kiểm phiên → loading", () => {
    assert.equal(mod.frontButtonState(S({ loading: true })), "loading");
  });

  test("chưa có phiên → login", () => {
    assert.equal(mod.frontButtonState(S({})), "login");
    assert.equal(mod.frontButtonState(S({ error: "Đăng nhập không thành công." })), "login");
  });

  test("có phiên → ready", () => {
    assert.equal(mod.frontButtonState(S({ session: { access_token: "x", user: { email: "a@b.c" } } })), "ready");
    assert.equal(mod.frontButtonState(S({ session: { access_token: "x" }, busy: true })), "ready");
  });
});

describe("frontErrorText: lỗi sendOcr → câu tiếng Việt cho giao diện", () => {
  const T = (kind, extra = {}) => mod.frontErrorText({ ok: false, kind, message: "câu cũ", retryAfter: null, serverMessage: "", ...extra });

  test("auth → mời đăng nhập lại", () => {
    assert.equal(T("auth"), "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.");
  });

  test("daily → giờ phút còn lại (làm tròn lên phút), lúc 7 giờ sáng, vẫn quét mã được; không dùng câu máy chủ", () => {
    assert.equal(T("daily", { retryAfter: 40000, serverMessage: "<b>câu máy chủ</b>" }),
      "Bạn đã dùng hết lượt chụp hôm nay. Thử lại sau 11 giờ 7 phút (lúc 7 giờ sáng). Vẫn quét mã vạch được.");
    assert.equal(T("daily", { retryAfter: 3601 }),
      "Bạn đã dùng hết lượt chụp hôm nay. Thử lại sau 1 giờ 1 phút (lúc 7 giờ sáng). Vẫn quét mã vạch được.");
    assert.equal(T("daily", { retryAfter: 3600 }),
      "Bạn đã dùng hết lượt chụp hôm nay. Thử lại sau 1 giờ 0 phút (lúc 7 giờ sáng). Vẫn quét mã vạch được.");
    assert.equal(T("daily", { retryAfter: 61 }),
      "Bạn đã dùng hết lượt chụp hôm nay. Thử lại sau 2 phút (lúc 7 giờ sáng). Vẫn quét mã vạch được.");
  });

  test("daily không có Retry-After → không có số, vẫn có 7 giờ sáng", () => {
    const s = T("daily");
    assert.match(s, /hết lượt chụp hôm nay/);
    assert.match(s, /7 giờ sáng/);
    assert.doesNotMatch(s, /null|NaN|undefined/);
  });

  test("rate → chờ N giây", () => {
    assert.equal(T("rate", { retryAfter: 42 }), "Gửi nhanh quá, chờ 42 giây rồi thử lại.");
    const s = T("rate");
    assert.match(s, /^Gửi nhanh quá, chờ/);
    assert.doesNotMatch(s, /null|NaN|undefined/);
  });

  test("busy / network / timeout / tooBig / badType / other / kind lạ → câu ngắn kèm gợi ý quét mã hoặc nhập số", () => {
    for (const kind of ["busy", "network", "timeout", "tooBig", "badType", "other", "la-lam", undefined]) {
      const s = T(kind, { serverMessage: "<script>x</script>" });
      assert.ok(s.length > 10, String(kind));
      assert.match(s, /quét mã vạch|nhập số/, String(kind));
      assert.doesNotMatch(s, /script/, String(kind));
    }
  });

  test("aborted → '' (không hiện); không phải lỗi → ''", () => {
    assert.equal(T("aborted"), "");
    assert.equal(mod.frontErrorText({ ok: true, items: [] }), "");
    assert.equal(mod.frontErrorText(null), "");
  });
});

describe("front-photo.js không gọi mạng lúc nạp", () => {
  test("import module không gọi fetch", async () => {
    const orig = globalThis.fetch;
    let called = 0;
    globalThis.fetch = () => { called++; return Promise.reject(new Error("không được gọi")); };
    try {
      await import("../src/front-photo.js?lan-nap-2");
    } finally {
      globalThis.fetch = orig;
    }
    assert.equal(called, 0);
  });
});
