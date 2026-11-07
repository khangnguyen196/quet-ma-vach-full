import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { parseHttpCode, resumeOk, isComplete, pipeWithBackpressure } from "../tai-noi.mjs";

test("parseHttpCode: lấy mã HTTP cuối cùng curl in ra stderr (-w)", () => {
  assert.equal(parseHttpCode("abc\nHTTP_CODE=302\nHTTP_CODE=206\n"), 206);
  assert.equal(parseHttpCode("curl: (28) timeout"), null);
});

test("resumeOk: tải từ đầu cần 200, tải nối cần 206 (server bỏ qua Range -> phải tải lại từ đầu)", () => {
  assert.equal(resumeOk(0, 200), true);
  assert.equal(resumeOk(1000, 206), true);
  assert.equal(resumeOk(1000, 200), false);
  assert.equal(resumeOk(1000, null), false);
});

test("isComplete: số byte cuối phải bằng Content-Length (không biết Content-Length -> không kết luận đủ)", () => {
  assert.equal(isComplete(100, 100), true);
  assert.equal(isComplete(99, 100), false);
  assert.equal(isComplete(100, null), false);
});

test("pipeWithBackpressure: nguồn dừng khi đích đầy, chạy tiếp khi 'drain', đủ dữ liệu", async () => {
  const chunks = Array.from({ length: 20 }, (_, i) => Buffer.alloc(64, i));
  const src = Readable.from(chunks, { objectMode: false });
  let pauses = 0;
  const origPause = src.pause.bind(src);
  src.pause = () => { pauses++; return origPause(); };
  const got = [];
  const slow = new Writable({ highWaterMark: 64, write(c, _e, cb) { got.push(c); setTimeout(cb, 1); } });
  const fast = [];
  const quick = new Writable({ write(c, _e, cb) { fast.push(c); cb(); } });
  let total = 0;
  await pipeWithBackpressure(src, [slow, quick], (c) => { total += c.length; });
  assert.equal(total, 20 * 64);
  assert.equal(Buffer.concat(got).length, 20 * 64);
  assert.equal(Buffer.concat(fast).length, 20 * 64);
  assert.ok(pauses > 0, "phải dừng nguồn ít nhất 1 lần khi đích chậm");
});
