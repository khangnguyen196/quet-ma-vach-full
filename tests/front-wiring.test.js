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
  // Hàm KHÔNG hiểu regex: main.js mà có regex chứa dấu nháy (vd /["']/) thì test có thể báo vỡ nhầm.
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

/** Thân sự kiện chọn ảnh "Chụp mặt trước" = handler "change" chứa lệnh gọi sendOcr(…). */
function pickHandlerBody() {
  const send = /\bsendOcr\s*\(/.exec(CODE);
  assert.ok(send, "main.js phải gọi sendOcr(…)");
  const handlers = [...CODE.matchAll(/addEventListener\(\s*["']change["']\s*,/g)].filter((m) => m.index < send.index);
  assert.ok(handlers.length, "không tìm thấy addEventListener(\"change\", …) trước sendOcr(");
  const h = handlers.at(-1);
  const [start, end] = blockAt(CODE, h.index + h[0].length);
  assert.ok(send.index > start && send.index < end, "sendOcr( phải nằm trong handler change của ô chọn ảnh");
  return CODE.slice(start, end);
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
    const body = pickHandlerBody();

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

  test("(4) sự kiện chọn ảnh nhớ manualSignOuts TRƯỚC khi chờ tắt camera (await stopCam(…))", () => {
    // Đợt cung-co vòng 2: bấm Đăng xuất đúng lúc camera đang tắt thì số nhớ đã gồm lần đăng xuất đó -> 401 vẫn làm mới
    // phiên. Số phải được nhớ trước mọi await của lượt chọn ảnh.
    const body = pickHandlerBody();
    const save = /(?<![=!<>])=\s*manualSignOuts\b/.exec(body);
    assert.ok(save, "handler chọn ảnh phải nhớ số manualSignOuts (… = manualSignOuts)");
    const stop = /\bawait\s+stopCam\s*\(/.exec(body);
    assert.ok(stop, "handler chọn ảnh phải có await stopCam(…)");
    assert.ok(save.index < stop.index,
      `nhớ manualSignOuts (dòng ${lineOf(body, save.index)} của handler) phải đứng trước await stopCam( (dòng ${lineOf(body, stop.index)})`);
  });

  // Đợt tu-dong vòng 4: nối "tự mở sản phẩm".
  test("(5) mọi lệnh gọi mergeFront(…) dùng lớp chặn mặc định: đúng 5 tham số, KHÔNG có tham số tùy chọn (kể cả qua biến)", () => {
    assert.deepEqual(rule5(CODE), []);
  });
  test("(5) luật bắt được chuỗi mẫu sai (vòng 5, gợi ý 4)", () => {
    for (const bad of [
      "mergeFront(a, b, c, d, e, opts);",
      "mergeFront(a, b, c, d, e, { lockTop: 0 });",
      "mergeFront(a, b, c, d, e, {});",
      "const o = { ...x }; mergeFront(s.t1, s.rIndex, s.products, found, off, o);",
      "mergeFront(a, b, c, d, f(x, y), g);",
    ]) assert.notDeepEqual(rule5(bad), [], bad);
    for (const ok of ["mergeFront(a, b, c, d, e);", "mergeFront(s.t1, s.rIndex, s.products, found, f(x, y));", "mergeFront(a, b, c, [1, 2], { ok: 1, hits: [] });"]) {
      assert.deepEqual(rule5(ok), [], ok);
    }
  });

  test("(6) MỘT bộ tìm Open Food Facts cho cả phiên: createOffSearch( gọi đúng 1 lần, không nằm trong handler chọn ảnh", () => {
    const calls = [...CODE.matchAll(/\bcreateOffSearch\s*\(/g)];
    assert.equal(calls.length, 1, `createOffSearch( xuất hiện ${calls.length} lần`);
    assert.doesNotMatch(pickHandlerBody(), /\bcreateOffSearch\s*\(/);
  });

  test("(7) lookup: tự mở từ ảnh (chưa xác nhận) KHÔNG lưu lịch sử: MỌI addHistory( nằm trong khối if (!photo) { … }", () => {
    assert.deepEqual(rule7(CODE), []);
  });
  test("(7) luật bắt được chuỗi mẫu sai (vòng 5, gợi ý 4)", () => {
    const wrap = (body) => `async function lookup(raw, { photo = null } = {}) {\n${body}\n}`;
    for (const bad of [
      "if (photo) x(); addHistory(code, name);",
      "if (!photo) { y(); }\naddHistory(code, name);",
      "if (photo) { addHistory(code, name); }",
      "if (!photo || z) { addHistory(code, name); }",
      "if (!photo) { a(); } else { addHistory(code, name); }",
      "addHistory(code, name);",
    ]) assert.notDeepEqual(rule7(wrap(bad)), [], bad);
    assert.deepEqual(rule7(wrap("if (!photo) {\n  try { renderHistory(addHistory(code, product.name)); } catch (e) { console.error(e); }\n}")), []);
  });

  // Vòng 5: NÊN SỬA 1 / 2 + gợi ý 1 / 3 của reviewer vòng 4.
  test("(8) sự kiện chọn ảnh: await showPhotoResult(…) nằm trong try, catch ghi console.error và báo 'Có lỗi khi tìm sản phẩm' khi lượt chưa cũ", () => {
    const body = pickHandlerBody();
    const call = /\bawait\s+showPhotoResult\s*\(/.exec(body);
    assert.ok(call, "handler chọn ảnh phải await showPhotoResult(…)");
    const tries = [...body.matchAll(/\btry\s*\{/g)].map((m) => [m.index, blockAt(body, m.index + m[0].length - 1)]);
    const own = tries.filter(([, [o, c]]) => call.index > o && call.index < c).at(-1);
    assert.ok(own, "await showPhotoResult( phải nằm trong một khối try { … }");
    const after = body.slice(own[1][1] + 1);
    const cm = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(after);
    assert.ok(cm, "khối try phải có catch ngay sau");
    const [co, cc] = blockAt(after, cm.index + cm[0].length - 1);
    const cat = after.slice(co, cc);
    assert.match(cat, /\bconsole\.error\s*\(/, "catch phải ghi console.error");
    assert.match(cat, /\bsayFront\s*\(\s*["']Có lỗi khi tìm sản phẩm\. Chọn ảnh lại\.["']\s*,\s*true\s*\)/, "catch phải báo câu lỗi (cảnh báo)");
    assert.match(cat, /\bfrontTurn\b/, "catch chỉ báo khi lượt chưa cũ (so với frontTurn)");
  });

  test("(9) showPhotoResult: kiểm stale() TRƯỚC khi gọi tìm Open Food Facts (.search( )", () => {
    const [start, end] = functionBody("showPhotoResult");
    const body = CODE.slice(start, end);
    const search = /\.search\s*\(/.exec(body);
    assert.ok(search, "showPhotoResult phải gọi .search(");
    const check = /\bif\s*\(\s*stale\s*\(\s*\)\s*\)/.exec(body);
    assert.ok(check && check.index < search.index, "phải có if (stale()) trước .search(");
  });

  test("(10) showPhotoResult: catch quanh mergeFront chỉ nuốt lỗi giá trị chặn (isGuardError), lỗi khác ném tiếp", () => {
    const [start, end] = functionBody("showPhotoResult");
    const body = CODE.slice(start, end);
    const mf = /\bmergeFront\s*\(/.exec(body);
    assert.ok(mf);
    const cm = /\bcatch\s*\(\s*(\w+)\s*\)\s*\{/g;
    cm.lastIndex = mf.index;
    const m = cm.exec(body);
    assert.ok(m, "phải có catch sau mergeFront(");
    const [o, c] = blockAt(body, m.index + m[0].length - 1);
    const cat = body.slice(o, c);
    assert.match(cat, new RegExp(`\\bisGuardError\\s*\\(\\s*${m[1]}\\s*\\)`), "catch phải hỏi isGuardError(lỗi)");
    assert.match(cat, new RegExp(`\\bthrow\\s+${m[1]}\\b`), "lỗi khác phải ném tiếp");
  });

  test("(11) #frontMsg không nói sai: lookup báo lượt tự mở lỗi + xóa câu khi tra không từ ảnh; confirmPhoto đổi câu", () => {
    const body = lookupBody(CODE);
    assert.match(body, /\bphotoFollowMessage\s*\(\s*["']openFailed["']\s*\)/, "lookup: lượt tự mở lỗi → photoFollowMessage(\"openFailed\")");
    assert.match(body, /\bphotoFollowMessage\s*\(\s*["']notPhoto["']\s*\)/, "lookup: tra không từ ảnh → photoFollowMessage(\"notPhoto\")");
    const [s, e] = functionBody("confirmPhoto");
    assert.match(CODE.slice(s, e), /\bphotoFollowMessage\s*\(\s*["']confirmed["']\s*\)/, "confirmPhoto → photoFollowMessage(\"confirmed\")");
  });
});

/** Thân hàm lookup (tính SAU danh sách tham số: tham số dạng { photo = null } = {} có dấu { trước thân). */
function lookupBody(code) {
  const m = /\bfunction\s+lookup\s*\(/.exec(code);
  if (!m) return null;
  let depth = 0, close = -1;
  for (let i = m.index + m[0].length - 1; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) { close = i; break; }
  }
  const [start, end] = blockAt(code, close);
  return code.slice(start, end + 1);
}

/** Tách tham số cấp cao nhất của lời gọi bắt đầu ở dấu "(" (bỏ qua ngoặc lồng (), [], {} và chuỗi). */
function topArgs(code, open) {
  const args = [];
  let depth = 0, quote = null, cur = "";
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (quote) { cur += c; if (c === "\\") { cur += code[++i] ?? ""; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; cur += c; continue; }
    if ("([{".includes(c)) { if (depth++ === 0) continue; }
    else if (")]}".includes(c)) { if (--depth === 0) { args.push(cur.trim()); return args.filter((a, k) => a || k < args.length - 1); } }
    else if (c === "," && depth === 1) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  throw new Error("lời gọi không đóng ngoặc");
}

/** Luật (5): mọi mergeFront( có đúng 5 tham số (t1, chỉ mục, danh mục, kết quả T1, kết quả OFF). Trả danh sách vi phạm. */
function rule5(code) {
  const out = [];
  const calls = [...code.matchAll(/\bmergeFront\s*\(/g)];
  if (!calls.length) return ["không gọi mergeFront("];
  for (const m of calls) {
    const args = topArgs(code, m.index + m[0].length - 1);
    if (args.length !== 5) out.push(`dòng ${lineOf(code, m.index)}: ${args.length} tham số (${args.join(" | ")})`);
  }
  return out;
}

/** Luật (7): trong thân lookup, mọi addHistory( nằm trong khối then của if (!photo) { … } (điều kiện đúng "!photo").
 *  Trả danh sách vi phạm. */
function rule7(code) {
  const body = lookupBody(code);
  if (!body) return ["không có function lookup(…)"];
  const adds = [...body.matchAll(/\baddHistory\s*\(/g)].map((m) => m.index);
  if (!adds.length) return ["lookup phải còn lưu lịch sử (tra bình thường)"];
  const guards = [...body.matchAll(/\bif\s*\(\s*!\s*photo\s*\)\s*\{/g)].map((m) => blockAt(body, m.index + m[0].length - 1));
  return adds.filter((i) => !guards.some(([o, c]) => i > o && i < c)).map((i) => `addHistory( ngoài if (!photo) { … } (dòng ${lineOf(body, i)} của lookup)`);
}
