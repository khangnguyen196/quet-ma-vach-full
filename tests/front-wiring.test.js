// Đợt cung-co (việc để sau (b) của chup-mat-gon): vài luật quan trọng của phần nối "Chụp mặt trước" trong src/main.js,
// kiểm bằng cách ĐỌC NGUỒN (main.js cần DOM thật nên không import được trong node; không thêm jsdom / happy-dom).
// Chỉ khẳng định luật, không khẳng định cách viết: đổi tên biến cục bộ / xuống dòng bình thường không làm test vỡ.
// Hành vi DOM thật (cuộn, nút, đăng xuất) vẫn chỉ kiểm bằng Playwright ngoài repo.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

/** Bỏ comment (khối /* *\/ và dòng //) nhưng giữ nguyên độ dài + xuống dòng, để vị trí / số dòng không đổi. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null; // ' " ` đang mở
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    out += c;
    i++;
  }
  return out;
}

const CODE = stripComments(SRC);

/** Từ vị trí `from`, tìm "{" đầu tiên và trả [vị trí "{", vị trí "}" khớp]. Bỏ qua ngoặc trong chuỗi. */
function blockAt(code, from) {
  const open = code.indexOf("{", from);
  assert.ok(open >= 0, "không tìm thấy dấu {");
  let depth = 0;
  let quote = null;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return [open, i];
  }
  throw new Error("dấu { không có dấu } khớp");
}

const lineOf = (code, idx) => code.slice(0, idx).split("\n").length;

/** Thân hàm khai báo `function <name>(…) { … }`: [đầu, cuối] trong CODE. */
function functionBody(name) {
  const m = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(CODE);
  assert.ok(m, `main.js phải có function ${name}(…)`);
  return blockAt(CODE, m.index + m[0].length);
}

describe("main.js: luật nối Chụp mặt trước (đọc nguồn)", () => {
  test("(1) mọi lệnh cuộn đi qua scrollToEl: không có scrollIntoView( nào ngoài thân hàm scrollToEl", () => {
    const [start, end] = functionBody("scrollToEl");
    const calls = [...CODE.matchAll(/\bscrollIntoView\s*\(/g)].map((m) => m.index);
    const inside = calls.filter((i) => i > start && i < end);
    const outside = calls.filter((i) => i < start || i > end);
    assert.ok(inside.length >= 1, "scrollToEl phải gọi scrollIntoView");
    assert.deepEqual(outside.map((i) => `dòng ${lineOf(CODE, i)}`), [], "scrollIntoView( ngoài scrollToEl (bỏ qua giảm chuyển động)");
  });

  test("(2) sự kiện chọn ảnh kiểm 'đang đăng xuất' (frontPickBlock với authBusy = ….busy) TRƯỚC khi gửi / làm mới phiên / tải T1", () => {
    // Sự kiện chọn ảnh = handler "change" chứa lệnh gọi sendOcr(…)
    const send = /\bsendOcr\s*\(/.exec(CODE);
    assert.ok(send, "main.js phải gọi sendOcr(…)");
    const handlers = [...CODE.matchAll(/addEventListener\(\s*["']change["']\s*,/g)].filter((m) => m.index < send.index);
    assert.ok(handlers.length, "không tìm thấy addEventListener(\"change\", …) trước sendOcr(");
    const h = handlers.at(-1);
    const [start, end] = blockAt(CODE, h.index + h[0].length);
    assert.ok(send.index > start && send.index < end, "sendOcr( phải nằm trong handler change của ô chọn ảnh");
    const body = CODE.slice(start, end);

    const call = /\bfrontPickBlock\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(body);
    assert.ok(call, "handler chọn ảnh phải gọi frontPickBlock({ … })");
    assert.match(call[1], /\bauthBusy\s*:\s*[\w$.]*\.busy\b/, "frontPickBlock phải nhận authBusy = <trạng thái đăng nhập>.busy");
    assert.match(body, /["']authBusy["']\s*\)\s*\{[^}]*\breturn\b/, "nhánh \"authBusy\" phải return (không gửi)");

    for (const later of [/\bsendOcr\s*\(/, /\brefreshSession\s*\(/, /\bloadFrontSearch\s*\(/, /\bprepareImage\s*\(/]) {
      const m = later.exec(body);
      assert.ok(m, `không thấy ${later} trong handler`);
      assert.ok(call.index < m.index, `frontPickBlock phải đứng trước ${later}`);
    }
  });

  test("(3) updateFrontButton không ẩn nút 'Tới phần đăng nhập' khi trạng thái ready (TOKEN_REFRESHED gọi lại hàm này)", () => {
    const decl = /(\w+)\s*=\s*(?:\$\(\s*["']#frontRelogin["']\s*\)|document\.getElementById\(\s*["']frontRelogin["']\s*\))/.exec(CODE);
    assert.ok(decl, "main.js phải lấy phần tử #frontRelogin");
    const name = decl[1];
    const [start, end] = functionBody("updateFrontButton");
    let body = CODE.slice(start + 1, end);
    // Bỏ các khối if chỉ chạy khi thành "hidden" / "login" (được phép dọn: sayFront() ẩn nút ở đó).
    for (const m of [...body.matchAll(/\bif\s*\(([^)]*)\)\s*\{/g)].reverse()) {
      if (!/["'](hidden|login)["']/.test(m[1]) || /["']ready["']/.test(m[1])) continue;
      const [o, c] = blockAt(body, m.index + m[0].length - 1);
      body = body.slice(0, o) + " ".repeat(c - o + 1) + body.slice(c + 1);
    }
    assert.doesNotMatch(body, new RegExp(`\\b${name}\\.hidden\\s*=(?!=)`), `updateFrontButton gán ${name}.hidden ngoài nhánh hidden / login`);
    assert.doesNotMatch(body, /\bsayFront\s*\(/, "updateFrontButton gọi sayFront( (ẩn nút) ngoài nhánh hidden / login");
  });
});
