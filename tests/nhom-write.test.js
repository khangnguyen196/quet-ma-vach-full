// "Thêm vào kho nhóm": gửi /embed + ghi Supabase (đợt kho-nhom vòng 7, src/nhom-write.js) bằng client giả + fetch giả.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sendEmbed, saveNhomProduct, encodeWithLimit, nhomSaveText, NHOM_IMAGE_MAX_BYTES, NHOM_MODEL, EMBED_TIMEOUT_MS
} from "../src/nhom-write.js";
import { frontErrorText } from "../src/front-photo.js";

const UID = "0d0d0d0d-1111-4222-8333-444444444444";
const PID = "99999999-9999-4999-8999-999999999999";
const PATH = `${UID}/a1b2c3d4-0000-4000-8000-000000000001.jpg`;
const BASE = "https://may-chu.example";
const VEC = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
const KY = "ab".repeat(32);
const GOOD = { model: NHOM_MODEL, vec: VEC, ky: KY };
const jpeg = (n = 100) => new Blob([new Uint8Array(n)], { type: "image/jpeg" });
let idn = 0;
const ids = () => `a1b2c3d4-0000-4000-8000-${String(++idn).padStart(12, "0")}`;

/** fetch giả: trả status / body / headers; ghi lại các lần gọi. */
function fakeFetch({ status = 200, body = GOOD, headers = {}, throws = null, hang = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw throws;
    if (hang) {
      await new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    }
    return {
      status,
      headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
      json: async () => { if (body === "xau") throw new SyntaxError("x"); return body; }
    };
  };
  fn.calls = calls;
  return fn;
}

describe("sendEmbed", () => {
  test("200 đúng dạng → { ok, model, vec, ky }; multipart image + duong_dan, Bearer, POST <base>/embed", async () => {
    const f = fakeFetch();
    const blob = jpeg();
    const r = await sendEmbed({ baseUrl: BASE + "/", token: " tok ", blob, path: PATH, fetch: f });
    assert.deepEqual(r, { ok: true, model: NHOM_MODEL, vec: VEC, ky: KY });
    assert.equal(f.calls.length, 1);
    const { url, init } = f.calls[0];
    assert.equal(url, BASE + "/embed");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer tok");
    assert.equal(init.body.get("duong_dan"), PATH);
    const img = init.body.get("image");
    assert.equal(img.size, blob.size);
    assert.equal(img.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await img.arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
  });
  test("phản hồi 200 xấu → other", async () => {
    for (const body of [
      { ...GOOD, model: "khac" }, { ...GOOD, vec: VEC.slice(1) }, { ...GOOD, vec: [...VEC.slice(1), NaN] },
      { ...GOOD, vec: [...VEC.slice(1), "1"] }, { ...GOOD, ky: KY.toUpperCase() }, { ...GOOD, ky: "ab" }, null, "xau", [], { vec: VEC }
    ]) {
      const r = await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: fakeFetch({ body }) });
      assert.equal(r.ok, false);
      assert.equal(r.kind, "other", JSON.stringify(body)?.slice(0, 40));
    }
  });
  test("mã HTTP → kind: 404 / 503 chưa bật → notReady; 503 khác → busy; 401 auth; 429 rate / daily; 413; 415; 400 / 403 bad", async () => {
    const cases = [
      [{ status: 404, body: { detail: "Not Found" } }, "notReady"],
      [{ status: 503, body: { error: "Kho nhóm chưa bật trên máy chủ." } }, "notReady"],
      [{ status: 503, body: { error: "Máy chủ đang bận (hàng đợi đầy). Thử lại sau ít giây." }, headers: { "Retry-After": "3" } }, "busy"],
      [{ status: 503, body: "xau", headers: { "Retry-After": "3" } }, "busy"],
      [{ status: 401, body: { error: "x" } }, "auth"],
      [{ status: 429, headers: { "Retry-After": "42" } }, "rate"],
      [{ status: 429, headers: { "Retry-After": "60" } }, "rate"],
      [{ status: 429, headers: { "Retry-After": "61" } }, "daily"],
      [{ status: 429 }, "rate"],
      [{ status: 413 }, "tooBig"],
      [{ status: 415 }, "badType"],
      [{ status: 400 }, "bad"],
      [{ status: 403 }, "bad"],
      [{ status: 500 }, "other"],
    ];
    for (const [opt, kind] of cases) {
      const r = await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: fakeFetch(opt) });
      assert.equal(r.kind, kind, JSON.stringify(opt));
      assert.equal(r.ok, false);
    }
    const r = await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: fakeFetch({ status: 429, headers: { "Retry-After": "42" } }) });
    assert.equal(r.retryAfter, 42);
  });
  test("vòng 8: 503 'chưa bật' nhận bằng THIẾU Retry-After hoặc câu 'chưa bật'; 503 có Retry-After + câu khác → busy", async () => {
    const cases = [
      [{ status: 503, body: { error: "Service Unavailable" } }, "notReady"],
      [{ status: 503, body: { detail: "bất kỳ" } }, "notReady"],
      [{ status: 503, body: "xau" }, "notReady"],
      [{ status: 503, body: { error: "Hàng đợi đầy" }, headers: { "Retry-After": "5" } }, "busy"],
      [{ status: 503, body: { error: "bất kỳ" }, headers: { "Retry-After": "abc" } }, "notReady"], // Retry-After sai dạng = không có
      [{ status: 503, body: { error: "Kho nhóm chưa bật trên máy chủ." }, headers: { "Retry-After": "5" } }, "notReady"],
      [{ status: 404, body: { detail: "Not Found" } }, "notReady"],
    ];
    for (const [opt, kind] of cases) {
      const r = await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: fakeFetch(opt) });
      assert.equal(r.kind, kind, JSON.stringify(opt));
    }
  });
  test("không gọi mạng khi token rỗng (auth) / địa chỉ, ảnh, đường dẫn sai (other) / đã hủy (aborted)", async () => {
    const f = fakeFetch();
    assert.equal((await sendEmbed({ baseUrl: BASE, token: " ", blob: jpeg(), path: PATH, fetch: f })).kind, "auth");
    for (const baseUrl of ["", "ftp://x", "khong-phai-url", null]) {
      assert.equal((await sendEmbed({ baseUrl, token: "t", blob: jpeg(), path: PATH, fetch: f })).kind, "other");
    }
    assert.equal((await sendEmbed({ baseUrl: BASE, token: "t", blob: "x", path: PATH, fetch: f })).kind, "other");
    for (const path of ["", `${UID}/x.jpg`, PATH.replace(".jpg", ".png"), "../" + PATH, PATH.toUpperCase()]) {
      assert.equal((await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path, fetch: f })).kind, "other", path);
    }
    const c = new AbortController();
    c.abort();
    assert.equal((await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: f, signal: c.signal })).kind, "aborted");
    assert.equal(f.calls.length, 0);
  });
  test("lỗi mạng → network; hết giờ → timeout; người gọi hủy giữa chừng → aborted", async () => {
    assert.equal((await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: fakeFetch({ throws: new TypeError("Load failed") }) })).kind, "network");
    assert.equal((await sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: fakeFetch({ hang: true }), timeoutMs: 20 })).kind, "timeout");
    const c = new AbortController();
    const p = sendEmbed({ baseUrl: BASE, token: "t", blob: jpeg(), path: PATH, fetch: fakeFetch({ hang: true }), signal: c.signal });
    setTimeout(() => c.abort(), 10);
    assert.equal((await p).kind, "aborted");
    assert.equal(EMBED_TIMEOUT_MS, 45000);
  });
});

/**
 * Client supabase-js giả: ghi mọi lệnh theo thứ tự vào log. fail = {
 *   product (error của insert sản phẩm), productThrows, upload: [số ảnh trả error], uploadThrows: [số ảnh ném lỗi],
 *   uploadLanded: [số ảnh trả error / ném nhưng file VẪN lên bucket (mất phản hồi)], uploadError (error trả về),
 *   image: [số ảnh], imageError, remove (error của remove), removeDrops: [đường dẫn remove "quên" không trả về],
 *   del (error của delete), delThrows, delRows (số dòng delete trả về, mặc định 1) }.
 * remove trả như storage-js 2.119.0: data = mảng đối tượng ĐÃ XÓA (trường name = đường dẫn trong bucket); đường dẫn
 * không có trên bucket thì không có trong data, KHÔNG báo lỗi.
 */
function fakeClient(fail = {}) {
  const log = [];
  const bucket = new Set(); // file đang có trên bucket giả
  let up = 0, img = 0;
  const client = {
    log,
    bucket,
    from(table) {
      return {
        insert(row) {
          if (table === "nhom_san_pham") {
            log.push({ op: "insert", table, row });
            return {
              select(cols) {
                return {
                  single: async () => {
                    log.push({ op: "select", table, cols });
                    if (fail.productThrows) throw new TypeError("Load failed");
                    if (fail.product) return { data: null, error: fail.product };
                    return { data: { id: PID }, error: null };
                  }
                };
              }
            };
          }
          img++;
          log.push({ op: "insert", table, row });
          return Promise.resolve(fail.image?.includes(img) ? { data: null, error: fail.imageError || { code: "42501", message: "x" } } : { data: null, error: null });
        },
        delete() {
          return {
            eq(col, val) {
              log.push({ op: "delete", table, col, val });
              return {
                select: async (cols) => {
                  log.push({ op: "deleteSelect", table, cols });
                  if (fail.delThrows) throw new Error("mạng");
                  if (fail.del) return { data: null, error: fail.del };
                  return { data: Array.from({ length: fail.delRows ?? 1 }, () => ({ id: val })), error: null };
                }
              };
            }
          };
        },
        update() { log.push({ op: "update", table }); throw new Error("không được update"); },
        upsert() { log.push({ op: "upsert", table }); throw new Error("không được upsert"); }
      };
    },
    storage: {
      from(bucketId) {
        return {
          upload: async (path, blob, opts) => {
            up++;
            log.push({ op: "upload", bucket: bucketId, path, blob, opts });
            if (fail.uploadLanded?.includes(up)) bucket.add(path);
            if (fail.uploadThrows?.includes(up)) throw new TypeError("Load failed");
            if (fail.upload?.includes(up)) return { data: null, error: fail.uploadError || { message: "x", status: 400, statusCode: "500" } };
            bucket.add(path);
            return { data: { path }, error: null };
          },
          remove: async (paths) => {
            log.push({ op: "remove", bucket: bucketId, paths });
            if (fail.remove) return { data: null, error: fail.remove };
            const gone = paths.filter((p) => bucket.has(p) && !fail.removeDrops?.includes(p));
            for (const p of gone) bucket.delete(p);
            return { data: gone.map((name) => ({ name, bucket_id: bucketId, id: "x" })), error: null };
          }
        };
      }
    }
  };
  return client;
}

/** embed giả: ghi lại blob / path; fail = số ảnh lỗi → kind. */
function fakeEmbed(log, { failAt = 0, kind = "notReady" } = {}) {
  let n = 0;
  return async ({ blob, path }) => {
    n++;
    log.push({ op: "embed", blob, path });
    if (n === failAt) return { ok: false, kind };
    return { ok: true, model: NHOM_MODEL, vec: VEC.map((x) => x + n * 0), ky: String(n).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a") };
  };
}

const ROW = { ten: "Bánh", thuong_hieu: null, khoi_luong: null, ma_vach: null, thanh_phan: null, dinh_duong: null, di_ung: ["milk"], nguon: "tay" };
const WRITES = new Set(["insert", "upload", "remove", "delete", "update", "upsert"]);

describe("saveNhomProduct", () => {
  test("thứ tự: MỌI /embed trước MỌI ghi; insert sản phẩm → (upload + insert nhom_anh) × n; cùng Blob; upsert: false", async () => {
    const c = fakeClient();
    const images = [{ blob: jpeg(10) }, { blob: jpeg(20) }, { blob: jpeg(30) }];
    const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images, embed: fakeEmbed(c.log), newId: ids });
    assert.deepEqual(r, { ok: true, id: PID });
    const ops = c.log.map((x) => `${x.op}${x.table ? ":" + x.table : ""}`);
    assert.deepEqual(ops, [
      "embed", "embed", "embed", "insert:nhom_san_pham", "select:nhom_san_pham",
      "upload", "insert:nhom_anh", "upload", "insert:nhom_anh", "upload", "insert:nhom_anh"
    ]);
    const embeds = c.log.filter((x) => x.op === "embed");
    const uploads = c.log.filter((x) => x.op === "upload");
    const rows = c.log.filter((x) => x.op === "insert" && x.table === "nhom_anh").map((x) => x.row);
    for (let i = 0; i < 3; i++) {
      assert.equal(uploads[i].blob, embeds[i].blob, "cùng Blob (===) cho /embed và tải lên");
      assert.equal(uploads[i].blob, images[i].blob);
      assert.equal(uploads[i].path, embeds[i].path);
      assert.equal(uploads[i].bucket, "nhom-anh");
      assert.deepEqual(uploads[i].opts, { contentType: "image/jpeg", upsert: false });
      assert.ok(uploads[i].path.startsWith(UID + "/"), "đường dẫn có uid của phiên");
      assert.match(uploads[i].path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
      assert.deepEqual(Object.keys(rows[i]).sort(), ["duong_dan", "ky", "model", "san_pham_id", "vec"]);
      assert.equal(rows[i].san_pham_id, PID);
      assert.equal(rows[i].duong_dan, uploads[i].path);
      assert.equal(rows[i].model, NHOM_MODEL);
    }
    assert.equal(new Set(uploads.map((u) => u.path)).size, 3);
    assert.deepEqual(c.log.find((x) => x.table === "nhom_san_pham" && x.op === "insert").row, ROW);
    assert.equal(c.log.find((x) => x.op === "select").cols, "id");
    assert.ok(!c.log.some((x) => x.op === "update" || x.op === "upsert"));
  });
  test("/embed lỗi ở ảnh 2 → 0 lần ghi Supabase, kind của /embed, cleaned true", async () => {
    for (const kind of ["notReady", "auth", "rate", "network", "timeout"]) {
      const c = fakeClient();
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log, { failAt: 2, kind }), newId: ids });
      assert.deepEqual({ ok: r.ok, kind: r.kind, step: r.step, cleaned: r.cleaned }, { ok: false, kind, step: "embed", cleaned: true });
      assert.equal(c.log.filter((x) => WRITES.has(x.op)).length, 0, kind);
      assert.equal(c.log.filter((x) => x.op === "embed").length, 2);
    }
    // embed ném lỗi → other, không ghi
    const c = fakeClient();
    const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }], embed: async () => { throw new Error("x"); }, newId: ids });
    assert.equal(r.kind, "other");
    assert.equal(c.log.filter((x) => WRITES.has(x.op)).length, 0);
  });
  test("ảnh sai (0 / 4 ảnh, không phải JPEG, > 2 MB, không phải Blob) hoặc uid sai → không gọi gì", async () => {
    const big = new Blob([new Uint8Array(NHOM_IMAGE_MAX_BYTES + 1)], { type: "image/jpeg" });
    const edge = new Blob([new Uint8Array(NHOM_IMAGE_MAX_BYTES)], { type: "image/jpeg" });
    for (const images of [[], null, [1, 2, 3, 4].map(() => ({ blob: jpeg() })), [{ blob: new Blob([new Uint8Array(5)], { type: "image/png" }) }],
      [{ blob: big }], [{ blob: "x" }], [null], [{ blob: new Blob([], { type: "image/jpeg" }) }]]) {
      const c = fakeClient();
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images, embed: fakeEmbed(c.log), newId: ids });
      assert.equal(r.kind, "badImages");
      assert.equal(c.log.length, 0);
    }
    const c = fakeClient();
    assert.equal((await saveNhomProduct({ client: c, uid: "KHONG-PHAI-UUID", row: ROW, images: [{ blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids })).kind, "badInput");
    assert.equal(c.log.length, 0);
    const c2 = fakeClient();
    assert.equal((await saveNhomProduct({ client: c2, uid: UID, row: ROW, images: [{ blob: edge }], embed: fakeEmbed(c2.log), newId: ids })).ok, true); // đúng 2 MB qua
  });
  test("insert sản phẩm lỗi → không tải ảnh, không cần dọn; mã 23514 → limit (không đọc câu lỗi)", async () => {
    for (const [error, kind] of [[{ code: "23514", message: "bất kỳ" }, "limit"], [{ code: "check_violation" }, "limit"], [{ code: "42501", message: "Mỗi người chỉ được thêm tối đa 300 món" }, "db"]]) {
      const c = fakeClient({ product: error });
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.deepEqual({ kind: r.kind, step: r.step, cleaned: r.cleaned }, { kind, step: "product", cleaned: true });
      assert.ok(!c.log.some((x) => x.op === "upload" || x.op === "remove" || x.op === "delete"));
    }
  });
  test("vòng 8: insert sản phẩm MẤT PHẢN HỒI (error không có mã Postgres / ném lỗi) → db, cleaned: false (dòng có thể đã ghi)", async () => {
    for (const f of [{ product: { message: "TypeError: Load failed", code: "" } }, { product: { message: "x" } }, { productThrows: true }]) {
      const c = fakeClient(f);
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.deepEqual({ ok: r.ok, kind: r.kind, step: r.step, cleaned: r.cleaned }, { ok: false, kind: "db", step: "product", cleaned: false }, JSON.stringify(f));
      assert.ok(!c.log.some((x) => x.op === "upload" || x.op === "remove" || x.op === "delete"), "không có id thì không dọn được");
      assert.ok(!("id" in c.log.find((x) => x.op === "insert").row), "app không gửi id");
      assert.match(nhomSaveText(r), /lưu dở/);
    }
    // có mã Postgres (vd 42501) → server đã từ chối rõ ràng → cleaned: true như cũ
    const c = fakeClient({ product: { code: "42501", message: "x" } });
    const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
    assert.deepEqual({ kind: r.kind, cleaned: r.cleaned }, { kind: "db", cleaned: true });
  });
  test("tải ảnh 2 lỗi → xóa file 1 VÀ file 2 (có thể đã lên) + xóa dòng sản phẩm (file trước, dòng sau)", async () => {
    for (const f of [{ upload: [2] }, { uploadThrows: [2] }]) {
      const c = fakeClient(f);
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.deepEqual({ ok: r.ok, kind: r.kind, step: r.step, cleaned: r.cleaned }, { ok: false, kind: "upload", step: "upload", cleaned: true }, JSON.stringify(f));
      const [up1, up2] = c.log.filter((x) => x.op === "upload").map((x) => x.path);
      const tail = c.log.slice(-3);
      assert.deepEqual(tail.map((x) => x.op), ["remove", "delete", "deleteSelect"]);
      assert.deepEqual(tail[0].paths, [up1, up2], "remove gồm ảnh 1 (đã lên) và ảnh 2 (upload lỗi: có thể đã lên)");
      assert.equal(tail[0].bucket, "nhom-anh");
      assert.deepEqual([tail[1].table, tail[1].col, tail[1].val], ["nhom_san_pham", "id", PID]);
      assert.equal(tail[2].cols, "id");
      assert.equal(c.log.filter((x) => x.op === "insert" && x.table === "nhom_anh").length, 1);
      assert.equal(c.bucket.size, 0);
    }
  });
  test("vòng 8: upload ảnh 2 báo lỗi nhưng file đã lên (mất phản hồi) → vẫn bị xóa, không còn file mồ côi", async () => {
    for (const f of [{ upload: [2], uploadLanded: [2] }, { uploadThrows: [2], uploadLanded: [2] }]) {
      const c = fakeClient(f);
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.equal(r.cleaned, true);
      assert.equal(c.bucket.size, 0, "bucket giả không còn file nào");
    }
  });
  test("tải ảnh 1 lỗi → xóa đường dẫn ảnh 1 (có thể đã lên) + dòng sản phẩm; file không có trên bucket không làm dọn lỗi", async () => {
    const c = fakeClient({ upload: [1] });
    const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
    assert.deepEqual({ kind: r.kind, cleaned: r.cleaned }, { kind: "upload", cleaned: true });
    const p1 = c.log.find((x) => x.op === "upload").path;
    assert.deepEqual(c.log.find((x) => x.op === "remove").paths, [p1]);
    assert.equal(c.log.at(-1).op, "deleteSelect");
  });
  test("vòng 8: dọn kiểm KẾT QUẢ THẬT: delete trả 0 dòng / 2 dòng → cleaned false; remove thiếu file chắc chắn đã lên → false; đủ → true", async () => {
    for (const [f, want] of [
      [{ upload: [2], delRows: 0 }, false],
      [{ upload: [2], delRows: 2 }, false],
      [{ upload: [2], removeDrops: "ANH1" }, false],
      [{ upload: [2] }, true],
    ]) {
      const c = fakeClient(f);
      if (f.removeDrops === "ANH1") {
        // "quên" ảnh 1 (chắc chắn đã lên): đường dẫn ảnh 1 = đường dẫn đầu tiên được tải
        const rm = c.storage.from;
        c.storage.from = (b) => { const o = rm(b); const r0 = o.remove; o.remove = async (paths) => { const res = await r0(paths); return { ...res, data: res.data.slice(1) }; }; return o; };
      }
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.equal(r.cleaned, want, JSON.stringify(f));
    }
  });
  test("insert nhom_anh lỗi (ảnh 2) → xóa CẢ 2 file đã tải + dòng sản phẩm; 23514 → limit", async () => {
    for (const [imageError, kind] of [[{ code: "23514" }, "limit"], [{ code: "42501" }, "db"]]) {
      const c = fakeClient({ image: [2], imageError });
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.deepEqual({ kind: r.kind, step: r.step, cleaned: r.cleaned }, { kind, step: "image", cleaned: true });
      const ups = c.log.filter((x) => x.op === "upload").map((x) => x.path);
      assert.equal(ups.length, 2);
      assert.deepEqual(c.log.find((x) => x.op === "remove").paths, ups);
      assert.equal(c.log.at(-1).op, "deleteSelect");
    }
  });
  test("dọn lỗi (remove lỗi / delete lỗi / ném) → cleaned: false", async () => {
    for (const f of [{ upload: [2], remove: { message: "x" } }, { upload: [2], del: { message: "x" } }, { upload: [2], delThrows: true }]) {
      const c = fakeClient(f);
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.equal(r.cleaned, false, JSON.stringify(f));
      assert.match(nhomSaveText(r), /lưu dở/);
    }
  });
  test("hủy (đăng xuất) giữa chừng: trước khi ghi → không ghi gì; sau khi đã ghi → dọn", async () => {
    let stop = false;
    const c = fakeClient();
    const emb = fakeEmbed(c.log);
    const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: async (x) => { const o = await emb(x); stop = true; return o; }, cancelled: () => stop, newId: ids });
    assert.deepEqual({ kind: r.kind, cleaned: r.cleaned }, { kind: "cancelled", cleaned: true });
    assert.equal(c.log.filter((x) => x.op === "embed").length, 1);
    assert.equal(c.log.filter((x) => WRITES.has(x.op)).length, 0);
    // hủy sau khi đã tải ảnh 1
    let ups = 0;
    const c2 = fakeClient();
    const up = c2.storage.from;
    c2.storage.from = (b) => { const o = up(b); const u = o.upload; o.upload = async (...a) => { ups++; return u(...a); }; return o; };
    const r2 = await saveNhomProduct({ client: c2, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c2.log), cancelled: () => ups >= 1, newId: ids });
    assert.deepEqual({ kind: r2.kind, cleaned: r2.cleaned }, { kind: "cancelled", cleaned: true });
    assert.equal(ups, 1);
    assert.deepEqual(c2.log.slice(-3).map((x) => x.op), ["remove", "delete", "deleteSelect"]);
  });
  test("vòng 8: hủy sau khi đã ghi mà dọn không xong (delete 0 dòng) → cancelled, cleaned: false (báo thật)", async () => {
    let ups = 0;
    const c = fakeClient({ delRows: 0 });
    const up = c.storage.from;
    c.storage.from = (b) => { const o = up(b); const u = o.upload; o.upload = async (...a) => { ups++; return u(...a); }; return o; };
    const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }, { blob: jpeg() }], embed: fakeEmbed(c.log), cancelled: () => ups >= 1, newId: ids });
    assert.deepEqual({ kind: r.kind, cleaned: r.cleaned }, { kind: "cancelled", cleaned: false });
    assert.match(nhomSaveText(r), /lưu dở/);
  });
  test("vòng 8 (gợi ý 1): upload bị từ chối 403 (giới hạn 300 ảnh / quyền) → câu nhắc có thể đã đủ 300 ảnh", async () => {
    for (const uploadError of [{ message: "new row violates row-level security policy", status: 400, statusCode: "403" }, { message: "x", status: 403, statusCode: "403" }]) {
      const c = fakeClient({ upload: [1], uploadError });
      const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
      assert.equal(r.kind, "upload");
      assert.match(nhomSaveText(r), /có thể đã đủ 300 ảnh của bạn, hoặc thử lại sau\./);
    }
    const c = fakeClient({ upload: [1] }); // lỗi khác 403 → câu cũ
    const r = await saveNhomProduct({ client: c, uid: UID, row: ROW, images: [{ blob: jpeg() }], embed: fakeEmbed(c.log), newId: ids });
    assert.doesNotMatch(nhomSaveText(r), /300 ảnh/);
  });
});

describe("encodeWithLimit / nhomSaveText", () => {
  test("0,9 vừa → dùng; quá 2 MB → 0,8; vẫn quá → lỗi; không giải mã được → lỗi (không gửi file gốc)", async () => {
    const sizes = { 0.9: 100, 0.8: 50 };
    const enc = (s) => async (q) => ({ size: s[q] });
    assert.deepEqual(await encodeWithLimit(enc(sizes)), { ok: true, blob: { size: 100 }, quality: 0.9 });
    const r = await encodeWithLimit(enc({ 0.9: NHOM_IMAGE_MAX_BYTES + 1, 0.8: NHOM_IMAGE_MAX_BYTES }));
    assert.equal(r.quality, 0.8);
    const tried = [];
    const r2 = await encodeWithLimit(async (q) => { tried.push(q); return { size: NHOM_IMAGE_MAX_BYTES + 1 }; });
    assert.equal(r2.ok, false);
    assert.match(r2.message, /2 MB/);
    assert.deepEqual(tried, [0.9, 0.8]);
    for (const e of [async () => null, async () => { throw new Error("x"); }]) {
      const r3 = await encodeWithLimit(e);
      assert.equal(r3.ok, false);
      assert.match(r3.message, /không đọc được/);
    }
  });
  test("câu theo kind", () => {
    assert.equal(nhomSaveText({ ok: true }), "Đã thêm vào kho nhóm.");
    assert.equal(nhomSaveText({ ok: false, kind: "notReady", cleaned: true }), "Máy chủ chưa bật kho nhóm, chưa lưu gì. Thử lại sau.");
    assert.equal(nhomSaveText({ ok: false, kind: "limit", cleaned: true }), "Đã chạm giới hạn kho nhóm (300 món, 300 ảnh mỗi người, 3 ảnh mỗi món).");
    assert.match(nhomSaveText({ ok: false, kind: "auth", cleaned: true }), /đăng nhập lại/);
    assert.match(nhomSaveText({ ok: false, kind: "rate", retryAfter: 7, cleaned: true }), /7 giây/);
    assert.match(nhomSaveText({ ok: false, kind: "db", cleaned: false }), /lưu dở/);
    assert.doesNotMatch(nhomSaveText({ ok: false, kind: "db", cleaned: true }), /lưu dở/);
    // vòng 8 (gợi ý 9): hết lượt ngày dùng chung câu với frontErrorText (một chỗ nói giờ đổi ngày), thêm "Chưa lưu gì."
    assert.equal(nhomSaveText({ ok: false, kind: "daily", retryAfter: 3600, cleaned: true }),
      frontErrorText({ ok: false, kind: "daily", retryAfter: 3600 }) + " Chưa lưu gì.");
    assert.equal(nhomSaveText({ ok: false, kind: "daily", cleaned: true }), frontErrorText({ ok: false, kind: "daily" }) + " Chưa lưu gì.");
    for (const k of ["busy", "tooBig", "badType", "timeout", "network", "badImages", "upload", "cancelled", "other", "xyz"]) {
      assert.ok(nhomSaveText({ ok: false, kind: k, cleaned: true }).length > 10, k);
    }
  });
});
