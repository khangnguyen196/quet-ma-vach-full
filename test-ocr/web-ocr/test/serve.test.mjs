import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePath, startServer } from "../serve.mjs";

test("resolvePath: mount dài nhất thắng, chặn ../", () => {
  const mounts = { "/": "C:\\a", "/photos/": "C:\\p" };
  assert.equal(resolvePath("/photos/893/front.jpg", mounts), path.resolve("C:\\p", "893", "front.jpg"));
  assert.equal(resolvePath("/harness.html?x=1", mounts), path.resolve("C:\\a", "harness.html"));
  assert.equal(resolvePath("/photos/../../secret", mounts), null);
  assert.equal(resolvePath("/%2e%2e/%2e%2e/x", mounts), null);
  assert.equal(resolvePath("/photos/..%5C..%5Csecret", mounts), null); // dấu \ mã hóa (Windows)
  assert.equal(resolvePath("/..%5Csecret", mounts), null);
});

test("server: phục vụ file, KHÔNG gửi COOP / COEP, 404 khi thiếu", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-ocr-"));
  fs.writeFileSync(path.join(dir, "a.wasm"), "x");
  const srv = await startServer({ port: 0, mounts: { "/": dir } });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.port}/a.wasm`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/wasm");
    assert.equal(r.headers.get("cross-origin-opener-policy"), null);
    assert.equal(r.headers.get("cross-origin-embedder-policy"), null);
    await r.arrayBuffer();
    const miss = await fetch(`http://127.0.0.1:${srv.port}/khong-co`);
    assert.equal(miss.status, 404);
    await miss.arrayBuffer();
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
