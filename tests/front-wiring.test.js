// Đợt cung-co (việc để sau (b) của chup-mat-gon): vài luật quan trọng của phần nối "Chụp mặt trước" trong src/main.js,
// kiểm bằng cách ĐỌC NGUỒN (main.js cần DOM thật nên không import được trong node; không thêm jsdom / happy-dom).
// Chỉ khẳng định luật, không khẳng định cách viết: đổi tên biến cục bộ / xuống dòng bình thường không làm test vỡ.
// Hành vi DOM thật (cuộn, nút, đăng xuất) vẫn chỉ kiểm bằng Playwright ngoài repo.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

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
// Vòng 7: phần gộp của showPhotoResult chuyển sang photoMerge (src/front-extra.js, thuần, dùng chung với khung đo).
const FX = stripComments(readFileSync(new URL("../src/front-extra.js", import.meta.url), "utf8"));
// Kho-lon vòng 4: gộp đường máy chủ ở src/front-server.js; luật (5) quét MỌI file src/*.js (đã bỏ comment).
const FS = stripComments(readFileSync(new URL("../src/front-server.js", import.meta.url), "utf8"));
const SRC_ALL = Object.fromEntries(readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".js"))
  .map((f) => [f, stripComments(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"))]));

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
  test("(5) mọi lệnh gọi mergeFront(…) trong src/ đúng 5 tham số (lớp chặn mặc định), TRỪ đúng MỘT chỗ ở front-server.js truyền tham số 6 = SERVER_MERGE_OPTS; main.js không gọi mergeFront(", () => {
    // Kho-lon vòng 4: quét mọi file src/*.js; chỗ duy nhất có tùy chọn là serverMerge (G2-g3-w3, hằng đóng băng).
    assert.ok(Object.keys(SRC_ALL).includes("main.js") && Object.keys(SRC_ALL).includes("front-server.js"));
    assert.deepEqual(rule5all(SRC_ALL), []);
    // photoMerge (front-extra.js): merge mặc định = mergeFront, mọi lời gọi merge(…) đúng 5 tham số
    assert.deepEqual(rule5fx(FX), []);
    // main.js gọi photoMerge(ctx, found, off, { called: … }) / serverMerge(ctx, found, off, server, { called: … }): không
    // truyền merge / tùy chọn khác
    assert.deepEqual(rule5main(CODE), []);
    assert.deepEqual(rule5server(CODE), []);
  });
  test("(5) kho-lon vòng 4: luật mergeFront toàn src/ + serverMerge bắt được chuỗi mẫu sai", () => {
    const fs1 = "export const SERVER_MERGE_OPTS = Object.freeze({ offPromote: Object.freeze({ gap: 3, minWords: 3 }) });\n"
      + "export function serverMerge(c, f, o, S) { try { m = mergeFront(a, b, c, f, j, SERVER_MERGE_OPTS); } catch (e) { m = mergeFront(a, b, c, f, null); } }";
    const good = { "main.js": "const x = photoMerge(ctx, f, o, { called: true });", "front-server.js": fs1, "front-merge.js": "export function mergeFront(t1, r, p, f, o, opts = {}) {}" };
    assert.deepEqual(rule5all(good), []);
    for (const [label, files] of [
      ["main.js gọi mergeFront( 5 tham số", { ...good, "main.js": "mergeFront(a, b, c, d, e);" }],
      ["main.js gọi mergeFront( có offPromote", { ...good, "main.js": "mergeFront(a, b, c, d, e, { offPromote: { gap: 3, minWords: 3 } });" }],
      ["main.js gọi mergeFront( với SERVER_MERGE_OPTS", { ...good, "main.js": "mergeFront(a, b, c, d, e, SERVER_MERGE_OPTS);" }],
      ["front-server.js truyền object thay hằng", { ...good, "front-server.js": fs1.replace("j, SERVER_MERGE_OPTS)", "j, { offPromote: { gap: 3, minWords: 3 } })") }],
      ["front-server.js 2 chỗ có tùy chọn", { ...good, "front-server.js": fs1.replace("f, null)", "f, null, SERVER_MERGE_OPTS)") }],
      ["front-server.js không có chỗ nào", { ...good, "front-server.js": fs1.replace("j, SERVER_MERGE_OPTS)", "j)") }],
      ["file khác dùng SERVER_MERGE_OPTS", { ...good, "front-extra.js": "m = mergeFront(a, b, c, d, e, SERVER_MERGE_OPTS);" }],
      ["file khác 6 tham số", { ...good, "front-extra.js": "m = mergeFront(a, b, c, d, e, opts);" }],
      ["SERVER_MERGE_OPTS không đóng băng", { ...good, "front-server.js": fs1.replace("Object.freeze({ offPromote", "({ offPromote") }],
    ]) assert.notDeepEqual(rule5all(files), [], label);
    const main = (call) => `async function showPhotoResult({ id }) {\n  const r = ${call};\n}`;
    assert.deepEqual(rule5server(main("serverMerge(ctx, found, off, server, { called: queries.length > 0 })")), []);
    for (const bad of [
      "serverMerge(ctx, found, off, server)",
      "serverMerge(ctx, found, off, server, { called: true, merge: f })",
      "serverMerge(ctx, found, off, server, opts)",
      "serverMerge(ctx, found, off, { called: true })",
      "serverMerge(ctx, found, off, server, { called: true }, SERVER_MERGE_OPTS)",
    ]) assert.notDeepEqual(rule5server(main(bad)), [], bad);
    assert.notDeepEqual(rule5server("function x() {}"), [], "không gọi serverMerge");
  });
  test("(5) vòng 7: luật photoMerge bắt được chuỗi mẫu sai", () => {
    const fx = (body, params = "{ called, merge = mergeFront } = {}") => `export function photoMerge(ctx, found, off, ${params}) {\n${body}\n}`;
    assert.deepEqual(rule5fx(fx("try { m = merge(a, b, c, d, e); } catch (x) { m = merge(a, b, c, d, null); }")), []);
    for (const bad of [
      fx("m = merge(a, b, c, d, e, opts);"),
      fx("m = merge(a, b, c, d, e, { lockTop: 0 });"),
      fx("m = merge(a, b, c, d, e);", "{ called, merge = (...x) => mergeFront(...x, o) } = {}"),
      fx("m = mergeFront(a, b, c, d, e, {});"),
      fx("m = x;"),
    ]) assert.notDeepEqual(rule5fx(bad), [], bad);
    const main = (call) => `async function showPhotoResult({ id }) {\n  const r = ${call};\n}`;
    assert.deepEqual(rule5main(main("photoMerge(ctx, found, off, { called: queries.length > 0 })")), []);
    for (const bad of [
      "photoMerge(ctx, found, off)",
      "photoMerge(ctx, found, off, { called: true, merge: f })",
      "photoMerge(ctx, found, off, opts)",
      "photoMerge(ctx, found, off, { called: true }, x)",
      "photoMerge(ctx, found, off, { merge })",
    ]) assert.notDeepEqual(rule5main(main(bad)), [], bad);
    assert.notDeepEqual(rule5main("function x() {}"), [], "không gọi photoMerge");
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
    const body = bodyAfterParams(CODE, "showPhotoResult");
    assert.ok(body, "main.js phải có function showPhotoResult(…)");
    const search = /\.search\s*\(/.exec(body);
    assert.ok(search, "showPhotoResult phải gọi .search(");
    const check = /\bif\s*\(\s*stale\s*\(\s*\)\s*\)/.exec(body);
    assert.ok(check && check.index < search.index, "phải có if (stale()) trước .search(");
  });

  test("(10) photoMerge (front-extra.js, vòng 7 thay showPhotoResult): catch quanh merge chỉ nuốt lỗi giá trị chặn (isGuardError), lỗi khác ném tiếp", () => {
    assert.deepEqual(rule10(FX, "photoMerge", "merge"), []);
    // kho-lon vòng 4: serverMerge (front-server.js) cũng vậy
    assert.deepEqual(rule10(FS, "serverMerge", "mergeFront"), []);
  });
  test("(10) luật bắt được chuỗi mẫu sai (vòng 6, gợi ý 3 vòng 5)", () => {
    const wrap = (cat) => `async function showPhotoResult({ id }) {\n  let merged;\n  try { merged = mergeFront(a, b, c, d, e); } catch (e) {\n${cat}\n  }\n}`;
    for (const bad of [
      "if (isGuardError(e)) throw e;\nconsole.error(e);",
      "console.error(e);",
      "if (!isGuardError(e)) console.log(e);\nthrow e;",
      "if (!isGuardError(e)) { console.error(e); }",
    ]) assert.notDeepEqual(rule10(wrap(bad)), [], bad);
    for (const ok of ["if (!isGuardError(e)) throw e;\nconsole.error(e);", "if (!isGuardError(e)) { throw e; }\nconsole.error(e);"]) {
      assert.deepEqual(rule10(wrap(ok)), [], ok);
    }
  });

  // Vòng 6: NÊN SỬA 3 + gợi ý 4 của reviewer vòng 5.
  test("(12) confirmPhoto: hỏi confirmAction; cancelRetry → frontAbort?.abort() + ++frontTurn; câu 'confirmed' chỉ khi setMsg; 'Tìm lại' nhớ retryTurn", () => {
    assert.deepEqual(rule12(CODE), []);
  });
  test("(12) luật bắt được chuỗi mẫu sai", () => {
    const fn = (body) => `function confirmPhoto() {\n  const p = photoPending;\n  if (!p) return;\n${body}\n}\nfunction onFrontClick(ev) {\n  frontAbort?.abort();\n  const id = ++frontTurn;\n  retryTurn = id;\n}`;
    // Vòng 7 (NÊN SỬA 1 vòng 6): khối cancelRetry gọi sayFront() (xóa câu tiến độ của lượt "Tìm lại" vừa hủy) và đứng
    // trước MỌI return của confirmPhoto (trừ if (!p) return;), để nhánh trả sớm lookup(p.code) không để #frontMsg kẹt.
    const ask = "const act = confirmAction({ retryRunning: retryTurn !== 0 && retryTurn === frontTurn, msgIsResult: frontMsgIsResult });\n";
    const cancel = "if (act.cancelRetry) { frontAbort?.abort(); ++frontTurn; retryTurn = 0; sayFront(); }\n";
    const early = "if (!shownProduct) { lookup(p.code); return; }\n";
    const setMsg = "if (act.setMsg) { const m = photoFollowMessage(\"confirmed\"); sayFront(m.text, m.warn); }";
    const good = ask + cancel + early + setMsg;
    assert.deepEqual(rule12(fn(good)), []);
    for (const bad of [
      // câu "confirmed" ghi không điều kiện (xóa câu tiến độ của lượt ảnh mới)
      ask + cancel + early + "const m = photoFollowMessage(\"confirmed\"); sayFront(m.text, m.warn);",
      // không hủy lượt "Tìm lại"
      ask + early + setMsg,
      // hủy mà không tăng frontTurn
      ask + "if (act.cancelRetry) { frontAbort?.abort(); sayFront(); }\n" + early + setMsg,
      // không hỏi confirmAction
      "const m = photoFollowMessage(\"confirmed\"); sayFront(m.text, m.warn);",
      // vòng 7: khối cancelRetry không xóa câu tiến độ
      ask + "if (act.cancelRetry) { frontAbort?.abort(); ++frontTurn; }\n" + early + setMsg,
      // vòng 7: khối cancelRetry đứng SAU nhánh trả sớm
      ask + early + cancel + setMsg,
      // vòng 7: return khác trước khối cancelRetry
      ask + "if (x) return;\n" + cancel + early + setMsg,
      // vòng 7: retryRunning không so retryTurn === frontTurn
      "const act = confirmAction({ retryRunning: retryTurn !== 0, msgIsResult: frontMsgIsResult });\n" + cancel + early + setMsg,
    ]) assert.notDeepEqual(rule12(fn(bad)), [], bad);
    assert.notDeepEqual(rule12(fn(good).replace("retryTurn = id;", "")), [], "'Tìm lại' phải nhớ retryTurn");
  });

  test("(13) showPhotoResult nhánh 'Chưa tìm thấy' (renderPhotoNone) đặt shownLookupId = 0 như clearPhotoResult", () => {
    assert.deepEqual(rule13(CODE), []);
  });
  test("(13) luật bắt được chuỗi mẫu sai", () => {
    const fn = (els) => `async function showPhotoResult({ id }) {\n  if (x) { lookup(1); } else {\n${els}\n  }\n}`;
    assert.deepEqual(rule13(fn("shownProduct = null;\nshownLookupId = 0;\nresult.innerHTML = renderPhotoNone({ lines });")), []);
    assert.notDeepEqual(rule13(fn("shownProduct = null;\nresult.innerHTML = renderPhotoNone({ lines });")), []);
    assert.notDeepEqual(rule13(fn("shownProduct = null;\nshownLookupId === 0;\nresult.innerHTML = renderPhotoNone({ lines });")), []);
  });

  // Vòng 7 (P3): nối kho phụ
  test("(14) showPhotoResult gộp qua photoMerge( (đường cũ) hoặc serverMerge( (đường máy chủ), KHÔNG gọi mergeFront trực tiếp; main.js không import mergeFront", () => {
    assert.deepEqual(rule14(CODE), []);
  });
  test("(14) luật bắt được chuỗi mẫu sai", () => {
    const fn = (body) => `async function showPhotoResult({ id }) {\n${body}\n}`;
    const both = "const { merged, offFailed } = useServer ? serverMerge(ctx, found, off, server, { called: true }) : photoMerge(ctx, found, off, { called: true });";
    assert.deepEqual(rule14(fn(both)), []);
    for (const bad of [
      fn("let merged = mergeFront(a, b, c, d, e);"),
      fn("const r = photoMerge(ctx, found, off, { called: true });\nmerged = mergeFront(a, b, c, d, null);"),
      fn("const r = 1;"),
      "import { mergeFront } from \"./front-merge.js\";\n" + fn(both),
      // kho-lon vòng 4: bỏ mất đường cũ (photoMerge) hoặc đường máy chủ (serverMerge)
      fn("const r = serverMerge(ctx, found, off, server, { called: true });"),
      fn("const r = photoMerge(ctx, found, off, { called: true });"),
      fn(both + "\nmerged = mergeFront(a, b, c, d, e, SERVER_MERGE_OPTS);"),
      "import { mergeFront, joinOffResults } from \"./front-merge.js\";\n" + fn(both),
    ]) assert.notDeepEqual(rule14(bad), [], bad);
  });

  test("(15) kho phụ chỉ tải trong luồng chọn ảnh (SAU await sendOcr(, nhánh không có ứng viên máy chủ) / Tìm lại: loadExtra( / loadFrontExtra( không ở cấp module hay lúc khởi động", () => {
    assert.deepEqual(rule15(CODE), []);
  });
  test("(15) luật bắt được chuỗi mẫu sai", () => {
    // Kho-lon vòng 4: trong handler chọn ảnh, loadFrontExtra( chỉ SAU await sendOcr( và trong nhánh KHÔNG có ứng viên
    // máy chủ (if (!S.length) { … } với S lấy từ r.candidates).
    const before = "const s = loadFrontSearch();";
    const afterOk = "const S = Array.isArray(r.candidates) ? r.candidates : [];\nlet extraP = null;\nif (!S.length) {\nextraP = loadFrontExtra();\nextraP.catch(() => {});\n}";
    const base = (extra = "", pick = before, after = afterOk) => [
      "// ghi chú nhắc tên loadFrontExtra trong comment không tính",
      "function loadFrontExtra() { return loadExtra().then((x) => x); }",
      "async function showPhotoResult({ id, extraP }) { const xi = await extraP; }",
      "function onFrontClick(ev) { const extraP = loadFrontExtra(); }",
      "function updateFrontButton() { }",
      `frontFile.addEventListener("change", async (ev) => {\nif (!confirm("x")) return;\n${pick}\nconst r = await sendOcr({});\nif (!r.ok) return;\n${after}\n});`,
      extra,
    ].join("\n");
    assert.deepEqual(rule15(base()), []);
    for (const bad of [
      base("loadFrontExtra();"),
      base("updateFrontButton(); loadExtra();"),
      base().replace("function updateFrontButton() { }", "function updateFrontButton() { loadFrontExtra(); }"),
      base("initAuth().then(() => loadFrontExtra());"),
      base("", "loadFrontExtra().catch(() => {});\nconst s = loadFrontSearch();", "const S = r.candidates;"), // trước loadFrontSearch
      base("", before, "const S = r.candidates;"), // chọn ảnh không bắt đầu tải (kể cả khi S rỗng)
      // Vòng 8 (NÊN SỬA 2 vòng 7): showPhotoResult tự tải kho phụ = lỗi "tải 2 lần mỗi lượt" (sửa ở 5b9cefe) quay lại
      base().replace("const xi = await extraP;", "const xi = await (extraP || loadFrontExtra());"),
      // Vòng 8 (gợi ý 2 vòng 7): tên hàm dùng làm tham chiếu, kể cả trong chỗ được phép
      base("", before + "\ns.then(loadFrontExtra);"),
      base().replace("const extraP = loadFrontExtra(); }", "const f = loadFrontExtra; f(); }"),
      base("const f = loadFrontExtra;"),
      // Kho-lon vòng 4: tải song song như vòng 7 (trước await sendOcr()
      base("", before + "\nconst extraP0 = loadFrontExtra();"),
      // sau sendOcr nhưng không theo điều kiện (tải cả khi có ứng viên máy chủ)
      base("", before, "const S = r.candidates;\nconst extraP = loadFrontExtra();"),
      base("", before, afterOk + "\nloadFrontExtra();"),
      // điều kiện ngược (tải khi CÓ ứng viên)
      base("", before, afterOk.replace("if (!S.length)", "if (S.length)")),
      // không lấy ứng viên máy chủ
      base("", before, "const S = [];\nlet extraP = null;\nif (!S.length) {\nextraP = loadFrontExtra();\n}"),
      // sendOcr không await (bắt đầu tải trước khi máy chủ trả)
      base().replace("const r = await sendOcr({});", "const rp = sendOcr({}); const r = {};"),
    ]) assert.notDeepEqual(rule15(bad), [], bad);
  });

  test("(16) câu chờ kho phụ: showPhotoResult gọi extraWaitMessage({ … stale: stale() … }) SAU khi OFF xong, TRƯỚC await kho phụ", () => {
    assert.deepEqual(rule16(CODE), []);
  });
  test("(16) luật bắt được chuỗi mẫu sai", () => {
    const fn = (wait, { off = "off = joinOffResults(await Promise.all(x));" } = {}) =>
      `async function showPhotoResult({ id }) {\nif (queries.length) {\n${off}\n}\n${wait}\nconst xi = await extraReady;\n}`;
    const ok = "const w = extraWaitMessage({ extraDone, stale: stale() });\nif (w) sayFront(w);";
    assert.deepEqual(rule16(fn(ok)), []);
    for (const bad of [
      fn(""), // không có câu chờ
      fn("sayFront(EXTRA_WAIT_TEXT);"), // nói thẳng hằng, không qua hàm chọn câu (không kiểm stale)
      fn("const w = extraWaitMessage({ extraDone, stale: false });\nif (w) sayFront(w);"), // không kiểm stale()
      fn(ok).replace("const xi = await extraReady;\n", "").replace("async function showPhotoResult({ id }) {\n", "async function showPhotoResult({ id }) {\nconst xi = await extraReady;\n"), // trước OFF
      fn("const xi0 = await extraReady;\n" + ok), // sau khi đã chờ kho phụ
      fn(ok, { off: "off = 1;" }), // không có bước chờ OFF
    ]) assert.notDeepEqual(rule16(bad), [], bad);
  });

  // Kho-lon vòng 4: ứng viên máy chủ
  test("(17) chọn ảnh dùng r.candidates TRƯỚC mọi loadFrontExtra( và truyền server: cho showPhotoResult; showPhotoResult gọi serverMerge( chỉ khi server có phần tử", () => {
    assert.deepEqual(rule17(CODE), []);
  });
  test("(17) luật bắt được chuỗi mẫu sai", () => {
    const sp = (guard = "const useServer = Array.isArray(server) && server.length > 0;", merge = "useServer ? serverMerge(ctx, found, off, server, { called: true }) : photoMerge(ctx, found, off, { called: true })") =>
      `async function showPhotoResult({ id, extraP = null, server = null }) {\n${guard}\nconst { merged } = ${merge};\n}`;
    const pick = (after = "const S = Array.isArray(r.candidates) ? r.candidates : [];\nlet extraP = null;\nif (!S.length) { extraP = loadFrontExtra(); }\nawait showPhotoResult({ id, extraP, server: S });") =>
      `frontFile.addEventListener("change", async (ev) => {\nconst r = await sendOcr({});\n${after}\n});`;
    const good = sp() + "\n" + pick();
    assert.deepEqual(rule17(good), []);
    assert.deepEqual(rule17(sp("const useServer = Array.isArray(server) && server.length > 0;", "photoMerge(ctx, found, off, { called: true });\nif (useServer) { merged = serverMerge(ctx, found, off, server, { called: true }); }") + "\n" + pick()), []);
    for (const [label, code] of [
      ["serverMerge( khi S rỗng (không điều kiện)", sp(undefined, "serverMerge(ctx, found, off, server, { called: true })") + "\n" + pick()],
      ["điều kiện không xét số phần tử", sp("const useServer = Array.isArray(server);") + "\n" + pick()],
      ["điều kiện >= 0 (S rỗng vẫn qua)", sp("const useServer = Array.isArray(server) && server.length >= 0;") + "\n" + pick()],
      ["ternary ngược", sp(undefined, "!useServer ? photoMerge(ctx, found, off, { called: true }) : serverMerge(ctx, found, off, server, { called: true })") + "\n" + pick()],
      ["if ngược", sp(undefined, "photoMerge(ctx, found, off, { called: true });\nif (!useServer) { merged = serverMerge(ctx, found, off, server, { called: true }); }") + "\n" + pick()],
      ["không gọi serverMerge", sp(undefined, "photoMerge(ctx, found, off, { called: true })") + "\n" + pick()],
      ["serverMerge ngoài showPhotoResult", good + "\nfunction x() { serverMerge(a, b, c, d, { called: true }); }"],
      ["loadFrontExtra( trước r.candidates", sp() + "\n" + pick("let extraP = loadFrontExtra();\nconst S = r.candidates;\nawait showPhotoResult({ id, extraP, server: S });")],
      ["không dùng r.candidates", sp() + "\n" + pick("const S = [];\nawait showPhotoResult({ id, server: S });")],
      ["không truyền server: cho showPhotoResult", sp() + "\n" + pick("const S = r.candidates;\nawait showPhotoResult({ id });")],
    ]) assert.notDeepEqual(rule17(code), [], label);
  });

  // Đợt kho-nhom vòng 6: kho sản phẩm của nhóm
  test("(18) ngưỡng món nhóm chỉ ở src/front-nhom.js (main.js không truyền / không chứa ngưỡng); nhomCandidates( chỉ trong front-photo.js; HTML món nhóm chỉ qua render.js", () => {
    assert.deepEqual(rule18(SRC_ALL), []);
  });
  test("(18) luật bắt được chuỗi mẫu sai", () => {
    const fn = "export const NHOM_THRESHOLD = Infinity;\nexport function nhomCandidates(body) { return []; }\nexport function nhomOutcome(o, n, { threshold = NHOM_THRESHOLD } = {}) { return o; }";
    const fp = "export async function sendOcr() { return { ok: true, nhom: nhomCandidates(body) }; }";
    const sn = (body = "  out.innerHTML = renderNhomError();\n  out.innerHTML = renderNhomProduct(view, { imgUrl });") =>
      `async function showNhom(nhomId, { photo = null } = {}) {\n  result.innerHTML = renderNhomShell(photo.nhomTop);\n${body}\n}`;
    const main = (extra = "", call = "const outcome = nhomOutcome(photoOutcome(merged), nhom);") =>
      `async function showPhotoResult({ nhom = [] }) {\n  ${call}\n}\n${sn()}\n${extra}`;
    const good = { "front-nhom.js": fn, "front-photo.js": fp, "main.js": main(), "render.js": "export function renderNhomHits(n) { return `<div class=\"nhom-hits\">Do nhóm thêm</div>`; }" };
    assert.deepEqual(rule18(good), []);
    for (const [label, files] of [
      ["main.js truyền threshold", { ...good, "main.js": main("", "const outcome = nhomOutcome(photoOutcome(merged), nhom, { threshold: 0.8 });") }],
      ["main.js truyền tham số 3 qua biến", { ...good, "main.js": main("", "const outcome = nhomOutcome(photoOutcome(merged), nhom, opts);") }],
      ["main.js chứa chữ threshold", { ...good, "main.js": main("const threshold = 0.8;") }],
      ["main.js gán NHOM_THRESHOLD", { ...good, "main.js": main("NHOM_THRESHOLD = 0.8;") }],
      ["main.js nhắc NHOM_THRESHOLD", { ...good, "main.js": main("console.log(NHOM_THRESHOLD);") }],
      ["main.js không gọi nhomOutcome", { ...good, "main.js": main("", "const outcome = photoOutcome(merged);") }],
      ["file khác gán NHOM_THRESHOLD", { ...good, "front-extra.js": "export const NHOM_THRESHOLD = 0.8;" }],
      ["front-nhom.js gán 2 lần", { ...good, "front-nhom.js": fn + "\nlet NHOM_THRESHOLD = 0.5;" }],
      ["front-nhom.js không có", { ...good, "front-nhom.js": fn.replace("export const NHOM_THRESHOLD = Infinity;", "") }],
      ["nhomCandidates( trong main.js", { ...good, "main.js": main("const nh = nhomCandidates(body);") }],
      ["nhomCandidates( ngoài front-photo.js", { ...good, "front-server.js": "const x = nhomCandidates(b);" }],
      ["front-photo.js không gọi nhomCandidates(", { ...good, "front-photo.js": "export async function sendOcr() {}" }],
      ["main.js ghép HTML món nhóm (chuỗi)", { ...good, "main.js": main("result.innerHTML = `<p class=\"nhom-note\">x</p>`;") }],
      ["main.js ghép HTML có chữ Do nhóm thêm", { ...good, "main.js": main("el.innerHTML = '<b>' + 'Do nhóm thêm' + '</b>';") }],
      ["showNhom gán innerHTML không qua renderNhom*", { ...good, "main.js": main().replace("out.innerHTML = renderNhomError();", "out.innerHTML = \"<p>\" + esc(view.name) + \"</p>\";") }],
      ["không có showNhom", { ...good, "main.js": main().replace("async function showNhom", "async function moMon") }],
      // vòng 7 (gợi ý 3 vòng 6): import "as" / tên dùng làm tham chiếu
      ["import nhomOutcome as", { ...good, "main.js": 'import { nhomOutcome as pick } from "./front-nhom.js";\n' + main("", "const outcome = pick(photoOutcome(merged), nhom, 0.8);\nnhomOutcome(a, b);") }],
      ["import x as nhomOutcome", { ...good, "main.js": 'import { other as nhomOutcome } from "./front-nhom.js";\n' + main() }],
      ["gán tên vào biến", { ...good, "main.js": main("const f = nhomOutcome;") }],
      ["truyền làm tham chiếu", { ...good, "main.js": main("const xs = list.map(nhomOutcome);") }],
      ["gọi qua .call", { ...good, "main.js": main("const o = nhomOutcome.call(null, a, b, 0.8);") }],
    ]) assert.notDeepEqual(rule18(files), [], label);
    // import thường (không "as") vẫn qua
    assert.deepEqual(rule18({ ...good, "main.js": 'import { nhomOutcome, nhomProductView } from "./front-nhom.js";\n' + main() }), []);
  });

  // Đợt kho-nhom vòng 7: phần GHI kho nhóm
  test("(19) ghi kho nhóm: .upload( chỉ ở nhom-write.js kèm upsert: false; không upsert / update trên nhom_*; \"/embed\" chỉ ở nhom-write.js; main.js không .from(\"nhom_…\"), không ghép HTML form; nhomFormFromBackText không có di_ung", () => {
    assert.deepEqual(rule19(SRC_ALL), []);
  });
  test("(19) luật bắt được chuỗi mẫu sai", () => {
    const nw = (up = 'await client.storage.from(NHOM_BUCKET).upload(paths[i], list[i].blob, { contentType: "image/jpeg", upsert: false });') =>
      `export async function sendEmbed() { const u = base + "/embed"; }\nexport async function saveNhomProduct() {\n${up}\nawait client.from("nhom_san_pham").insert(row).select("id").single();\n}`;
    const na = (body = 'return { thanh_phan: lines.join("\\n"), nguon: "ocr-mat-sau" };') => `export function nhomFormFromBackText(items) {\n${body}\n}`;
    const mj = (extra = "") => `function redrawNhomAdd(v, e) {\n  nhomAddBox.innerHTML = renderNhomAddForm(v, e);\n}\nfunction closeNhomAdd() { nhomAddBox.innerHTML = ""; }\n${extra}`;
    const good = { "nhom-write.js": nw(), "nhom-add.js": na(), "main.js": mj(), "nhom-data.js": 'await client.from("nhom_san_pham").select(NHOM_COLUMNS).eq("id", id).maybeSingle();' };
    assert.deepEqual(rule19(good), []);
    for (const [label, files] of [
      ["upload upsert: true (chèn tạm)", { ...good, "nhom-write.js": nw('await client.storage.from(NHOM_BUCKET).upload(p, b, { contentType: "image/jpeg", upsert: true });') }],
      ["upload thiếu upsert", { ...good, "nhom-write.js": nw('await client.storage.from(NHOM_BUCKET).upload(p, b, { contentType: "image/jpeg" });') }],
      ["upload truyền tùy chọn qua biến", { ...good, "nhom-write.js": nw("await client.storage.from(NHOM_BUCKET).upload(p, b, opts);") }],
      ["upload ngoài nhom-write.js", { ...good, "main.js": mj('await authClient.storage.from("nhom-anh").upload(p, b, { upsert: false });') }],
      ["không có upload", { ...good, "nhom-write.js": nw("") }],
      [".upsert( trên bảng", { ...good, "nhom-write.js": nw() + '\nawait client.from("nhom_anh").upsert(row);' }],
      [".update( trên nhom_san_pham", { ...good, "nhom-data.js": 'await client.from("nhom_san_pham").update({ ten: "x" }).eq("id", id);' }],
      [".update( trong nhom-write.js", { ...good, "nhom-write.js": nw() + "\nawait q.update({ a: 1 });" }],
      ["upsert: true ở file khác", { ...good, "front-extra.js": "const o = { upsert: true };" }],
      ["\"/embed\" ngoài nhom-write.js", { ...good, "main.js": mj('const u = ocrPick.url + "/embed";') }],
      ["main.js .from(\"nhom_\"", { ...good, "main.js": mj('const { data } = await authClient.from("nhom_san_pham").select("id");') }],
      ["main.js .from('nhom-anh')", { ...good, "main.js": mj("await authClient.storage.from('nhom-anh').remove([p]);") }],
      ["main.js ghép HTML form (chuỗi <input)", { ...good, "main.js": mj('el.innerHTML = `<input name="ten" value="${esc(v)}">`;') }],
      ["main.js gán innerHTML form không qua render", { ...good, "main.js": mj('nhomAddBox.innerHTML = "<p>" + x + "</p>";') }],
      ["main.js không gọi renderNhomAddForm", { ...good, "main.js": "function closeNhomAdd() { nhomAddBox.innerHTML = \"\"; }" }],
      ["nhomFormFromBackText có di_ung", { ...good, "nhom-add.js": na('return { thanh_phan: t, nguon: "ocr-mat-sau", di_ung: [] };') }],
      ["không có nhomFormFromBackText", { ...good, "nhom-add.js": "export function docMatSau(items) { return {}; }" }],
    ]) assert.notDeepEqual(rule19(files), [], label);
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
  return bodyAfterParams(code, "lookup");
}

/** Thân `function <name>(…) { … }` tính SAU danh sách tham số (tham số có thể là { … }). Không có → null. */
function bodyAfterParams(code, name) {
  const m = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(code);
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

/** Luật (5): mọi mergeFront( có đúng 5 tham số (t1, chỉ mục, danh mục, kết quả T1, kết quả OFF). Trả danh sách vi phạm.
 *  allowNone (vòng 7): main.js gộp qua photoMerge nên được phép không còn lời gọi nào. */
function rule5(code, { allowNone = false } = {}) {
  const out = [];
  const calls = [...code.matchAll(/\bmergeFront\s*\(/g)];
  if (!calls.length) return allowNone ? [] : ["không gọi mergeFront("];
  for (const m of calls) {
    const args = topArgs(code, m.index + m[0].length - 1);
    if (args.length !== 5) out.push(`dòng ${lineOf(code, m.index)}: ${args.length} tham số (${args.join(" | ")})`);
  }
  return out;
}

/** Luật (5) phần photoMerge (vòng 7, front-extra.js): tham số merge mặc định = mergeFront (không bọc thêm tùy chọn);
 *  thân hàm có ≥ 1 lời gọi merge(…), mọi lời gọi merge( / mergeFront( đúng 5 tham số. */
function rule5fx(code) {
  const m = /\bfunction\s+photoMerge\s*\(/.exec(code);
  if (!m) return ["front-extra.js không có function photoMerge(…)"];
  const params = topArgs(code, m.index + m[0].length - 1).join(",");
  const out = [];
  if (!/\bmerge\s*=\s*mergeFront\s*\}/.test(params)) out.push("tham số merge phải mặc định đúng = mergeFront");
  const body = bodyAfterParams(code, "photoMerge");
  const calls = [...body.matchAll(/\b(?:merge|mergeFront)\s*\(/g)];
  if (!calls.some((c) => /^merge\b/.test(c[0]))) out.push("photoMerge phải gọi merge(…)");
  for (const c of calls) {
    const args = topArgs(body, c.index + c[0].length - 1);
    if (args.length !== 5) out.push(`${c[0]} ${args.length} tham số (${args.join(" | ")})`);
  }
  return out;
}

/** Luật (5) phần main.js (vòng 7): có ≥ 1 lời gọi photoMerge(…); mọi lời gọi đúng 4 tham số, tham số 4 đúng dạng
 *  { called: … } (không truyền merge hay tùy chọn khác). */
function rule5main(code) {
  const calls = [...code.matchAll(/\bphotoMerge\s*\(/g)];
  if (!calls.length) return ["main.js không gọi photoMerge("];
  const out = [];
  for (const c of calls) {
    const args = topArgs(code, c.index + c[0].length - 1);
    if (args.length !== 4) { out.push(`dòng ${lineOf(code, c.index)}: ${args.length} tham số`); continue; }
    if (!/^\{\s*called\s*:[^,{}]+\}$/.test(args[3])) out.push(`dòng ${lineOf(code, c.index)}: tham số 4 phải là { called: … } (nhận ${args[3]})`);
  }
  return out;
}

/** Luật (5) kho-lon vòng 4: files = { tên file: mã đã bỏ comment } (mọi src/*.js). Mọi lời gọi mergeFront( (trừ dòng
 *  khai báo function) đúng 5 tham số, TRỪ đúng MỘT lời gọi trong front-server.js có tham số 6 đúng tên hằng
 *  SERVER_MERGE_OPTS (khai báo export const … = Object.freeze(…)); main.js không gọi mergeFront( nào. */
function rule5all(files) {
  const out = [];
  let six = 0;
  for (const [name, code] of Object.entries(files)) {
    for (const m of code.matchAll(/\bmergeFront\s*\(/g)) {
      if (/\bfunction\s+$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue; // khai báo
      if (name === "main.js") { out.push(`main.js dòng ${lineOf(code, m.index)}: main.js không được gọi mergeFront( (gộp qua photoMerge / serverMerge)`); continue; }
      const args = topArgs(code, m.index + m[0].length - 1);
      if (args.length === 5) continue;
      if (name === "front-server.js" && args.length === 6 && args[5] === "SERVER_MERGE_OPTS") { six++; continue; }
      out.push(`${name} dòng ${lineOf(code, m.index)}: ${args.length} tham số (${args.join(" | ")})`);
    }
  }
  if (six !== 1) out.push(`front-server.js phải có đúng 1 lời gọi mergeFront(…, SERVER_MERGE_OPTS) (có ${six})`);
  if (!/\bexport\s+const\s+SERVER_MERGE_OPTS\s*=\s*Object\.freeze\s*\(/.test(files["front-server.js"] || "")) {
    out.push("front-server.js phải khai báo export const SERVER_MERGE_OPTS = Object.freeze(…)");
  }
  return out;
}

/** Luật (5) phần serverMerge của main.js (kho-lon vòng 4): có ≥ 1 lời gọi serverMerge(…); mọi lời gọi đúng 5 tham số,
 *  tham số 5 đúng dạng { called: … } (không truyền merge / tùy chọn gộp khác). */
function rule5server(code) {
  const calls = [...code.matchAll(/\bserverMerge\s*\(/g)];
  if (!calls.length) return ["main.js không gọi serverMerge("];
  const out = [];
  for (const c of calls) {
    const args = topArgs(code, c.index + c[0].length - 1);
    if (args.length !== 5) { out.push(`dòng ${lineOf(code, c.index)}: serverMerge ${args.length} tham số`); continue; }
    if (!/^\{\s*called\s*:[^,{}]+\}$/.test(args[4])) out.push(`dòng ${lineOf(code, c.index)}: tham số 5 phải là { called: … } (nhận ${args[4]})`);
  }
  return out;
}

/** Luật (17) kho-lon vòng 4: handler chọn ảnh dùng <r>.candidates TRƯỚC mọi loadFrontExtra( và truyền server: cho
 *  showPhotoResult; trong showPhotoResult có const <v> = Array.isArray(server) && server.length > 0; và MỌI serverMerge(
 *  nằm trong nhánh đúng của <v> (<v> ? serverMerge(…) hoặc if (<v>) { … serverMerge(… }); ngoài showPhotoResult không có
 *  serverMerge(. */
function rule17(code) {
  code = stripComments(code);
  const out = [];
  const pick = pickBody(code);
  if (!pick) out.push("không tìm thấy handler chọn ảnh");
  else {
    const body = code.slice(pick[0], pick[1]);
    const cand = /\b\w+\.candidates\b/.exec(body);
    if (!cand) out.push("handler chọn ảnh phải dùng ứng viên máy chủ (r.candidates)");
    else for (const m of body.matchAll(/\bloadFrontExtra\s*\(/g)) if (m.index < cand.index) out.push("loadFrontExtra( đứng trước r.candidates");
    const call = /\bshowPhotoResult\s*\(/.exec(body);
    if (!call || !/\bserver\s*:/.test(topArgs(body, call.index + call[0].length - 1).join(","))) out.push("handler chọn ảnh phải truyền server: <ứng viên> cho showPhotoResult");
  }
  const sp = bodyAfterParams(code, "showPhotoResult");
  if (!sp) return [...out, "không có function showPhotoResult(…)"];
  const g = /\bconst\s+(\w+)\s*=\s*Array\.isArray\(\s*server\s*\)\s*&&\s*server\.length\s*>\s*0\s*;/.exec(sp);
  if (!g) out.push("showPhotoResult phải có const <v> = Array.isArray(server) && server.length > 0;");
  const calls = [...sp.matchAll(/\bserverMerge\s*\(/g)];
  if (!calls.length) out.push("showPhotoResult phải gọi serverMerge(");
  if (g) {
    const ifs = [...sp.matchAll(new RegExp(`\\bif\\s*\\(\\s*${g[1]}\\s*\\)\\s*\\{`, "g"))].map((m) => blockAt(sp, m.index + m[0].length - 1));
    for (const c of calls) {
      if (c.index < g.index) { out.push("serverMerge( đứng trước điều kiện có ứng viên"); continue; }
      const tern = new RegExp(`(?<![!\\w.])${g[1]}\\s*\\?\\s*$`).test(sp.slice(0, c.index));
      if (!tern && !ifs.some(([o, e]) => c.index > o && c.index < e)) out.push(`serverMerge( ngoài nhánh ${g[1]} (có ứng viên máy chủ)`);
    }
  }
  const at = code.indexOf(sp);
  for (const m of code.matchAll(/\bserverMerge\s*\(/g)) {
    if (m.index < at || m.index > at + sp.length) out.push(`dòng ${lineOf(code, m.index)}: serverMerge( ngoài showPhotoResult`);
  }
  return out;
}

/** Các chuỗi ('…', "…", `…`) trong code (đã bỏ comment), như stripComments (không hiểu regex). */
function stringLiterals(code) {
  const out = [];
  let i = 0;
  while (i < code.length) {
    const q = code[i];
    if (q !== "'" && q !== '"' && q !== "`") { i++; continue; }
    let j = i + 1;
    while (j < code.length && code[j] !== q) j += code[j] === "\\" ? 2 : 1;
    out.push(code.slice(i + 1, j));
    i = j + 1;
  }
  return out;
}

/** Luật (18) (đợt kho-nhom vòng 6): files = { tên file: mã đã bỏ comment } (mọi src/*.js).
 *  - NHOM_THRESHOLD chỉ được gán đúng 1 lần, ở front-nhom.js (export const NHOM_THRESHOLD = …).
 *  - main.js: không nhắc NHOM_THRESHOLD, không có chữ threshold; có ≥ 1 lời gọi nhomOutcome(, mọi lời gọi đúng 2 tham số
 *    (ngưỡng luôn là mặc định của front-nhom.js).
 *  - nhomCandidates( (trừ khai báo) chỉ ở front-photo.js, ≥ 1 lần.
 *  - main.js không ghép HTML món nhóm: không chuỗi nào vừa có "<" vừa có "nhom" / "nhóm"; mọi phép gán .innerHTML trong
 *    showNhom đi qua renderNhom…( của render.js. */
function rule18(files) {
  const out = [];
  const assigns = [];
  const isDecl = (code, i) => /\bfunction\s+$/.test(code.slice(Math.max(0, i - 20), i));
  let cands = 0;
  for (const [name, code] of Object.entries(files)) {
    for (const m of code.matchAll(/\bNHOM_THRESHOLD\s*=(?!=)/g)) assigns.push([name, code.slice(Math.max(0, m.index - 20), m.index)]);
    for (const m of code.matchAll(/\bnhomCandidates\s*\(/g)) {
      if (isDecl(code, m.index)) continue;
      if (name !== "front-photo.js") out.push(`${name} dòng ${lineOf(code, m.index)}: nhomCandidates( ngoài front-photo.js`);
      else cands++;
    }
  }
  if (assigns.length !== 1 || assigns[0][0] !== "front-nhom.js" || !/\bexport\s+const\s+$/.test(assigns[0][1])) {
    out.push(`NHOM_THRESHOLD phải được gán đúng 1 lần ở front-nhom.js (export const); thấy: ${assigns.map((a) => a[0]).join(", ") || "không có"}`);
  }
  if (!cands) out.push("front-photo.js phải gọi nhomCandidates(");
  const main = files["main.js"] || "";
  if (/\bNHOM_THRESHOLD\b/.test(main)) out.push("main.js nhắc NHOM_THRESHOLD");
  if (/threshold/i.test(main)) out.push("main.js có chữ threshold (không được truyền / chứa ngưỡng)");
  // Vòng 7 (gợi ý 3 vòng 6): không import nhomOutcome kiểu "as" (đổi tên thì luật đếm lời gọi bị lách); mọi lần xuất hiện
  // tên nhomOutcome ngoài comment / câu import phải là lời gọi "nhomOutcome(" (không truyền làm tham chiếu như luật 15).
  const imports = [...main.matchAll(/\bimport\s*\{[^}]*\}\s*from\s*["'][^"']*["']/g)].map((m) => [m.index, m.index + m[0].length]);
  for (const [s, e] of imports) {
    const imp = main.slice(s, e);
    if (/\bnhomOutcome\s+as\b|\bas\s+nhomOutcome\b/.test(imp)) out.push(`main.js dòng ${lineOf(main, s)}: import nhomOutcome kiểu "as"`);
  }
  for (const m of main.matchAll(/\bnhomOutcome\b/g)) {
    if (imports.some(([s, e]) => m.index >= s && m.index < e)) continue;
    if (!/^\s*\(/.test(main.slice(m.index + m[0].length))) {
      out.push(`main.js dòng ${lineOf(main, m.index)}: nhomOutcome dùng làm tham chiếu, không phải lời gọi nhomOutcome(`);
    }
  }
  const calls = [...main.matchAll(/\bnhomOutcome\s*\(/g)];
  if (!calls.length) out.push("main.js phải gọi nhomOutcome(");
  for (const c of calls) {
    const args = topArgs(main, c.index + c[0].length - 1);
    if (args.length !== 2) out.push(`main.js dòng ${lineOf(main, c.index)}: nhomOutcome( ${args.length} tham số (chỉ được 2)`);
  }
  for (const s of stringLiterals(main)) {
    if (s.includes("<") && /nh(o|ó)m/i.test(s)) out.push(`main.js ghép HTML món nhóm: ${s.slice(0, 60)}`);
  }
  for (const s of stringLiterals(main)) if (/Do nhóm thêm/.test(s)) out.push("main.js có chữ 'Do nhóm thêm' (phải ở render.js)");
  const body = bodyAfterParams(main, "showNhom");
  if (!body) out.push("main.js phải có function showNhom(…)");
  else {
    for (const m of body.matchAll(/\.innerHTML\s*=(?!=)\s*/g)) {
      const rhs = body.slice(m.index + m[0].length);
      if (!/^renderNhom\w*\s*\(/.test(rhs)) out.push(`showNhom gán innerHTML không qua renderNhom…( (${rhs.slice(0, 40)})`);
    }
  }
  return out;
}

/** Luật (19) (đợt kho-nhom vòng 7, phần GHI kho nhóm): files = { tên file: mã đã bỏ comment } (mọi src/*.js).
 *  - ".upload(" chỉ ở nhom-write.js (≥ 1 lần), tham số luôn có chữ "upsert: false" (không truyền qua biến).
 *  - Không file nào có "upsert: true" hay ".upsert("; nhom-write.js không có ".update("; câu lệnh nào có
 *    .from("nhom_…") / .from("nhom-anh") cũng không có ".update(".
 *  - Chuỗi chứa "/embed" chỉ ở nhom-write.js.
 *  - main.js không gọi .from("nhom_…") / .from("nhom-anh") (đọc qua nhom-data.js, ghi qua nhom-write.js).
 *  - main.js không ghép HTML form: không chuỗi nào có thẻ <form / <input / <textarea / <select / <label / <fieldset; có gọi
 *    renderNhomAddForm(; mọi phép gán X.innerHTML với X có chữ "nhomAdd" là renderNhomAddForm(…) hoặc "".
 *  - Thân nhomFormFromBackText (nhom-add.js) không có chữ "di_ung". */
function rule19(files) {
  const out = [];
  let uploads = 0;
  for (const [name, code] of Object.entries(files)) {
    for (const m of code.matchAll(/\.upload\s*\(/g)) {
      if (name !== "nhom-write.js") { out.push(`${name} dòng ${lineOf(code, m.index)}: .upload( ngoài nhom-write.js`); continue; }
      uploads++;
      const args = topArgs(code, m.index + m[0].length - 1).join(",");
      if (!/\bupsert\s*:\s*false\b/.test(args)) out.push(`${name} dòng ${lineOf(code, m.index)}: .upload( thiếu "upsert: false"`);
    }
    if (/\bupsert\s*:\s*true\b/.test(code)) out.push(`${name}: có "upsert: true"`);
    if (/\.upsert\s*\(/.test(code)) out.push(`${name}: có ".upsert("`);
    if (name === "nhom-write.js" && /\.update\s*\(/.test(code)) out.push("nhom-write.js: có \".update(\"");
    for (const m of code.matchAll(/\.from\s*\(\s*["'`](nhom_[a-z_]*|nhom-anh)["'`]\s*\)/g)) {
      const end = code.indexOf(";", m.index);
      const stmt = code.slice(m.index, end < 0 ? code.length : end);
      if (/\.update\s*\(/.test(stmt)) out.push(`${name} dòng ${lineOf(code, m.index)}: .update( trên ${m[1]}`);
      if (name === "main.js") out.push(`main.js dòng ${lineOf(code, m.index)}: gọi .from("${m[1]}") trực tiếp`);
    }
    for (const s of stringLiterals(code)) if (s.includes("/embed") && name !== "nhom-write.js") out.push(`${name}: chuỗi "/embed" ngoài nhom-write.js`);
  }
  if (!uploads) out.push("nhom-write.js phải tải ảnh lên bằng .upload(");
  const main = files["main.js"] || "";
  for (const s of stringLiterals(main)) {
    if (/<\s*(form|input|textarea|select|label|fieldset)\b/i.test(s)) out.push(`main.js ghép HTML form: ${s.slice(0, 60)}`);
  }
  if (!/\brenderNhomAddForm\s*\(/.test(main)) out.push("main.js phải vẽ form qua renderNhomAddForm(");
  for (const m of main.matchAll(/([\w.$]*nhomAdd[\w.$]*)\.innerHTML\s*=(?!=)\s*/gi)) {
    const rhs = main.slice(m.index + m[0].length);
    if (!/^renderNhomAddForm\s*\(/.test(rhs) && !/^(""|''|``)\s*;/.test(rhs)) out.push(`main.js gán ${m[1]}.innerHTML không qua renderNhomAddForm( (${rhs.slice(0, 40)})`);
  }
  const back = bodyAfterParams(files["nhom-add.js"] || "", "nhomFormFromBackText");
  if (!back) out.push("nhom-add.js phải có function nhomFormFromBackText(…)");
  else if (/di_ung/.test(back)) out.push("nhomFormFromBackText có chữ di_ung (chữ mặt sau không được tự tích dị ứng)");
  return out;
}

/** Luật (14): showPhotoResult có photoMerge( (đường cũ) VÀ serverMerge( (đường máy chủ, kho-lon vòng 4), KHÔNG có
 *  mergeFront(; main.js không import mergeFront. */
function rule14(code) {
  const body = bodyAfterParams(code, "showPhotoResult");
  if (!body) return ["không có function showPhotoResult(…)"];
  const out = [];
  if (!/\bphotoMerge\s*\(/.test(body)) out.push("showPhotoResult phải gộp qua photoMerge( (đường cũ)");
  if (!/\bserverMerge\s*\(/.test(body)) out.push("showPhotoResult phải gộp qua serverMerge( (đường máy chủ)");
  if (/\bmergeFront\s*\(/.test(body)) out.push("showPhotoResult gọi mergeFront( trực tiếp");
  if (/\bimport\s*\{[^}]*\bmergeFront\b[^}]*\}/.test(code)) out.push("main.js import mergeFront");
  return out;
}

/** Thân handler "change" (ô chọn ảnh) = handler "change" có lời gọi sendOcr( trong code; không có → null. */
function pickBody(code) {
  const send = /\bsendOcr\s*\(/.exec(code);
  if (!send) return null;
  const h = [...code.matchAll(/addEventListener\(\s*["']change["']\s*,/g)].filter((m) => m.index < send.index).at(-1);
  if (!h) return null;
  return blockAt(code, h.index + h[0].length);
}

/** Luật (15): mọi lời gọi loadExtra( (không tính dòng khai báo function) nằm trong thân loadFrontExtra. Vòng 8 (NÊN SỬA 2
 *  + gợi ý 2 vòng 7): MỌI lần xuất hiện tên loadFrontExtra ngoài comment (trừ dòng khai báo function) phải là lời gọi
 *  "loadFrontExtra(" (không truyền tên hàm làm tham chiếu: .then(loadFrontExtra), const f = loadFrontExtra) và chỉ nằm
 *  trong handler chọn ảnh hoặc onFrontClick ("Tìm lại"); showPhotoResult KHÔNG được gọi (chỉ nhận extraP), để mỗi lượt
 *  thử tải kho phụ nhiều nhất 1 lần. Handler chọn ảnh có loadFrontExtra( SAU loadFrontSearch( và sau câu hỏi gửi
 *  nguyên bản (confirm(). */
function rule15(code) {
  code = stripComments(code); // CODE đã bỏ comment; chuỗi mẫu sai thì chưa
  const out = [];
  const spans = {};
  for (const name of ["loadFrontExtra", "onFrontClick"]) {
    const m = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(code);
    if (!m) continue;
    let depth = 0, close = -1;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")" && --depth === 0) { close = i; break; }
    }
    spans[name] = blockAt(code, close);
  }
  const pick = pickBody(code);
  if (!pick) out.push("không tìm thấy handler chọn ảnh");
  else spans.pick = pick;
  const inside = (i, names) => names.some((n) => spans[n] && i > spans[n][0] && i < spans[n][1]);
  const isDecl = (i) => /\bfunction\s+$/.test(code.slice(Math.max(0, i - 20), i));
  for (const m of code.matchAll(/\bloadExtra\s*\(/g)) {
    if (isDecl(m.index)) continue;
    if (!inside(m.index, ["loadFrontExtra"])) out.push(`dòng ${lineOf(code, m.index)}: loadExtra( ngoài loadFrontExtra`);
  }
  for (const m of code.matchAll(/\bloadFrontExtra\b/g)) {
    if (isDecl(m.index)) continue; // khai báo
    if (!/^\s*\(/.test(code.slice(m.index + m[0].length))) {
      out.push(`dòng ${lineOf(code, m.index)}: loadFrontExtra dùng làm tham chiếu, không phải lời gọi loadFrontExtra(`);
      continue;
    }
    if (!inside(m.index, ["pick", "onFrontClick"])) out.push(`dòng ${lineOf(code, m.index)}: loadFrontExtra( ngoài handler chọn ảnh / onFrontClick`);
  }
  if (pick) {
    const body = code.slice(pick[0], pick[1]);
    const lxs = [...body.matchAll(/\bloadFrontExtra\s*\(/g)];
    const ls = /\bloadFrontSearch\s*\(/.exec(body);
    const cf = /\bconfirm\s*\(/.exec(body);
    const send = /\bawait\s+sendOcr\s*\(/.exec(body);
    if (!lxs.length) out.push("handler chọn ảnh phải bắt đầu tải kho phụ (loadFrontExtra() ở nhánh không có ứng viên máy chủ");
    // Kho-lon vòng 4: chỉ tải SAU khi máy chủ trả (await sendOcr() và trong nhánh if (!<S>.length) { … }, S = …r.candidates…
    const sv = /\bconst\s+(\w+)\s*=[^;]*\b\w+\.candidates\b[^;]*;/.exec(body);
    const guard = sv ? new RegExp(`\\bif\\s*\\(\\s*!\\s*${sv[1]}\\.length\\s*\\)\\s*\\{`).exec(body) : null;
    const span = guard ? blockAt(body, guard.index + guard[0].length - 1) : null;
    if (!sv) out.push("handler chọn ảnh phải lấy ứng viên máy chủ (const S = … r.candidates …)");
    else if (!guard) out.push(`handler chọn ảnh thiếu nhánh if (!${sv[1]}.length) { … } (không có ứng viên máy chủ)`);
    for (const lx of lxs) {
      if (!ls || lx.index < ls.index) out.push("loadFrontExtra( phải đứng sau loadFrontSearch( trong handler chọn ảnh");
      if (!cf || lx.index < cf.index) out.push("loadFrontExtra( phải đứng sau câu hỏi gửi nguyên bản (confirm()");
      if (!send || lx.index < send.index) out.push("loadFrontExtra( phải đứng sau await sendOcr( (máy chủ đã trả)");
      if (span && !(lx.index > span[0] && lx.index < span[1])) out.push("loadFrontExtra( ngoài nhánh không có ứng viên máy chủ");
    }
  }
  return out;
}

/** Luật (16) (vòng 8, gợi ý 1 vòng 7): câu chờ kho phụ chỉ nói qua extraWaitMessage( của front-photo.js (không dùng thẳng
 *  EXTRA_WAIT_TEXT), tham số có stale: stale() (lượt cũ thì không nói), đứng SAU bước chờ OFF (joinOffResults() và
 *  TRƯỚC await extraReady, rồi đưa vào sayFront(. Không đổi thời gian chờ hay thứ tự xử lý. */
function rule16(code) {
  code = stripComments(code);
  if (/\bEXTRA_WAIT_TEXT\b/.test(code)) return ["dùng thẳng EXTRA_WAIT_TEXT (phải qua extraWaitMessage()"];
  const body = bodyAfterParams(code, "showPhotoResult");
  if (!body) return ["không có function showPhotoResult(…)"];
  const out = [];
  const off = /\bjoinOffResults\s*\(/.exec(body);
  const awaitX = /\bawait\s+extraReady\b/.exec(body);
  const w = /\bextraWaitMessage\s*\(/.exec(body);
  if (!off) out.push("showPhotoResult không chờ OFF (joinOffResults()");
  if (!awaitX) out.push("showPhotoResult không có await extraReady");
  if (!w) return [...out, "showPhotoResult không gọi extraWaitMessage("];
  const args = topArgs(body, w.index + w[0].length - 1).join(",");
  if (!/\bstale\s*:\s*stale\s*\(\s*\)/.test(args)) out.push("extraWaitMessage( phải nhận stale: stale()");
  if (off && w.index < off.index) out.push("extraWaitMessage( đứng trước bước chờ OFF");
  if (awaitX && w.index > awaitX.index) out.push("extraWaitMessage( đứng sau await extraReady");
  if (!/\bsayFront\s*\(/.test(body.slice(w.index, awaitX ? awaitX.index : body.length))) out.push("câu chờ kho phụ không được nói (sayFront()");
  return out;
}

/** Luật (10): trong hàm fn, catch đầu tiên sau callee( có `if (!isGuardError(<lỗi>)) throw <lỗi>` (ném tiếp lỗi KHÁC lỗi
 *  giá trị chặn). Mặc định showPhotoResult / mergeFront (mẫu sai); vòng 7: photoMerge / merge của front-extra.js.
 *  Trả danh sách vi phạm. */
function rule10(code, fn = "showPhotoResult", callee = "mergeFront") {
  const body = bodyAfterParams(code, fn);
  if (!body) return [`không có function ${fn}(…)`];
  const mf = new RegExp(`\\b${callee}\\s*\\(`).exec(body);
  if (!mf) return [`${fn} không gọi ${callee}(`];
  const cm = /\bcatch\s*\(\s*(\w+)\s*\)\s*\{/g;
  cm.lastIndex = mf.index;
  const m = cm.exec(body);
  if (!m) return ["không có catch sau mergeFront("];
  const [o, c] = blockAt(body, m.index + m[0].length - 1);
  const cat = body.slice(o, c + 1);
  const e = m[1];
  // Vòng 6 (gợi ý 3 vòng 5): phải đúng dạng "if (!isGuardError(e)) throw e" — "if (isGuardError(e)) throw e" (ngược
  // điều kiện) hay "throw e" ở chỗ khác không còn qua.
  const ok = new RegExp(`\\bif\\s*\\(\\s*!\\s*isGuardError\\s*\\(\\s*${e}\\s*\\)\\s*\\)\\s*(?:\\{\\s*)?throw\\s+${e}\\b`).test(cat);
  return ok ? [] : [`catch phải có if (!isGuardError(${e})) throw ${e}`];
}

/** Luật (12): confirmPhoto hỏi confirmAction(…); trong khối if (….cancelRetry) có frontAbort?.abort() và ++frontTurn;
 *  photoFollowMessage("confirmed") chỉ nằm trong khối if (….setMsg); handler "Tìm lại" (onFrontClick) gán retryTurn. */
function rule12(code) {
  const out = [];
  const m = /\bfunction\s+confirmPhoto\s*\(/.exec(code);
  if (!m) return ["không có function confirmPhoto(…)"];
  const [s, e] = blockAt(code, m.index + m[0].length);
  const body = code.slice(s, e + 1);
  const ca = /\b(\w+)\s*=\s*confirmAction\s*\(/.exec(body);
  if (!ca) return ["confirmPhoto phải gọi confirmAction(…) và giữ kết quả"];
  const v = ca[1];
  const ifBlock = (field) => {
    const r = new RegExp(`\\bif\\s*\\(\\s*${v}\\.${field}\\s*\\)\\s*\\{`).exec(body);
    return r ? body.slice(...blockAt(body, r.index + r[0].length - 1)) : null;
  };
  const cancel = ifBlock("cancelRetry");
  if (!cancel) out.push(`thiếu if (${v}.cancelRetry) { … }`);
  else {
    if (!/\bfrontAbort\s*\?\.\s*abort\s*\(\s*\)/.test(cancel)) out.push("khối cancelRetry phải gọi frontAbort?.abort()");
    if (!/\+\+\s*frontTurn\b|\bfrontTurn\s*\+\+|\bfrontTurn\s*\+=\s*1\b/.test(cancel)) out.push("khối cancelRetry phải tăng frontTurn");
    // Vòng 7 (NÊN SỬA 1 vòng 6): xóa câu tiến độ của lượt "Tìm lại" vừa hủy, và đứng trước MỌI return (trừ if (!p) return;)
    if (!/\bsayFront\s*\(\s*\)/.test(cancel)) out.push("khối cancelRetry phải gọi sayFront() (xóa câu tiến độ của lượt Tìm lại bị hủy)");
    const at = body.indexOf(cancel);
    const guard = /\bif\s*\(\s*!\s*\w+\s*\)\s*return\s*;/.exec(body);
    for (const r of body.matchAll(/\breturn\b/g)) {
      if (guard && r.index >= guard.index && r.index < guard.index + guard[0].length) continue;
      if (r.index < at) out.push(`return đứng trước khối cancelRetry (dòng ${lineOf(body, r.index)} của confirmPhoto)`);
    }
  }
  const caCall = topArgs(body, ca.index + ca[0].length - 1).join(",");
  if (!/\bretryRunning\s*:[^,]*\bretryTurn\s*===\s*frontTurn\b/.test(caCall)) out.push("confirmAction phải nhận retryRunning có retryTurn === frontTurn");
  const msg = ifBlock("setMsg");
  const confirmed = [...body.matchAll(/\bphotoFollowMessage\s*\(\s*["']confirmed["']\s*\)/g)];
  if (!confirmed.length) out.push("confirmPhoto phải dùng photoFollowMessage(\"confirmed\")");
  if (!msg) out.push(`thiếu if (${v}.setMsg) { … }`);
  else {
    const [mo] = [body.indexOf(msg)];
    for (const c of confirmed) if (c.index < mo || c.index > mo + msg.length) out.push("photoFollowMessage(\"confirmed\") nằm ngoài khối setMsg");
  }
  const click = /\bfunction\s+onFrontClick\s*\(/.exec(code);
  const cb = click ? code.slice(...blockAt(code, click.index + click[0].length)) : "";
  if (!/\bretryTurn\s*=(?!=)/.test(cb)) out.push("onFrontClick (\"Tìm lại\") phải gán retryTurn = lượt mới");
  return out;
}

/** Luật (13): trong showPhotoResult, khối có renderPhotoNone( cũng gán shownLookupId = 0. */
function rule13(code) {
  const body = bodyAfterParams(code, "showPhotoResult");
  if (!body) return ["không có function showPhotoResult(…)"];
  const none = /\brenderPhotoNone\s*\(/.exec(body);
  if (!none) return ["showPhotoResult không gọi renderPhotoNone("];
  // khối { … } nhỏ nhất chứa renderPhotoNone(
  let best = null;
  for (const b of body.matchAll(/\{/g)) {
    let blk;
    try { blk = blockAt(body, b.index); } catch { continue; }
    if (blk[0] < none.index && blk[1] > none.index && (!best || blk[1] - blk[0] < best[1] - best[0])) best = blk;
  }
  const blk = best ? body.slice(best[0], best[1]) : "";
  return /\bshownLookupId\s*=(?!=)\s*0\b/.test(blk) ? [] : ["nhánh renderPhotoNone phải đặt shownLookupId = 0"];
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
