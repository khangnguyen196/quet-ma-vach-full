// Test phần thuần của tu-dong-kho-lon.mjs (đợt tu-dong vòng 6, gợi ý 2 reviewer vòng 5): bộ đếm khúc đang chờ của
// scan() chỉ giảm SAU khi onResult xong (trước đây giảm trước nên bước "chờ hết khúc" có thể đi tiếp khi khúc cuối
// còn đang ghi). Không đọc bản xuất, không dùng luồng phụ.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mod from "../tu-dong-kho-lon.mjs";

test("makeChunkCounter: wait() chỉ xong khi MỌI onResult đã chạy xong (kể cả onResult chậm)", async () => {
  assert.equal(typeof mod.makeChunkCounter, "function");
  const done = [];
  let release;
  const slow = new Promise((r) => { release = r; });
  const c = mod.makeChunkCounter(async (r) => { if (r === "a") await slow; done.push(r); });
  c.add();
  c.add();
  const pa = c.done("a"); // onResult của "a" còn chờ
  await c.done("b");
  let waited = false;
  const w = c.wait().then(() => { waited = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(waited, false, "wait() xong khi 'a' còn đang ghi");
  assert.equal(c.pending, 1);
  release();
  await pa;
  await w;
  assert.equal(waited, true);
  assert.deepEqual(done, ["b", "a"]);
  assert.equal(c.pending, 0);
});

test("makeChunkCounter: không có khúc nào → wait() xong ngay; onResult ném lỗi vẫn giảm bộ đếm", async () => {
  const c = mod.makeChunkCounter(async () => { throw new Error("hỏng"); });
  await c.wait();
  c.add();
  await assert.rejects(c.done("x"), /hỏng/);
  assert.equal(c.pending, 0);
  await c.wait();
});
