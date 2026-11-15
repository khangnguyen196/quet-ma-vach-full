// Test src/front-extra.js (đợt tu-dong vòng 6, P5): kho phụ 893 cách C1 (phần thuần, CHƯA nối vào app).
// Danh mục thật public/chup-mat-do/danh-muc-vn.json; kho phụ là dữ liệu giả nhỏ (không đọc file kho phụ lớn, không
// gọi mạng). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import * as fr from "../src/front-rank.js";
import * as fm from "../src/front-merge.js";
import * as swBuild from "../tools/sw-build.mjs";
// import động + catch: chưa có module thì từng test đỏ riêng
const mod = await import("../src/front-extra.js").catch(() => ({}));

const catalog = JSON.parse(fs.readFileSync(new URL("../public/chup-mat-do/danh-muc-vn.json", import.meta.url), "utf8"));
const products = catalog.products;
const rIndex = fr.buildRankIndex(t1, products);
const catalogCodes = new Set(products.map((p) => p.code));
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/front-ocr-3.json", import.meta.url), "utf8"));
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));

const DIET = { code: "8934588752117", name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: "front_en.7", text: "Soda Chanh - Diet 7Up Soda Chanh - Diet 7Up PepsiCo" };
const STORE = [
  DIET,
  { code: "8930000000001", name: "Soda chanh muối", brand: "X", img: "front_vi.3", text: "Soda chanh muối X" },
  { code: "8930000000002", name: "Bánh quy bơ", brand: "Y", text: "Bánh quy bơ Y" },
  { code: "8930000000003", name: "Nước chanh", brand: "Z", img: "front_vi.1", text: "Nước chanh Z" },
  { code: "8930000000004", name: "Nước chanh", brand: "Z", img: "front_vi.1", text: "Nước chanh Z" }, // cùng điểm với mục trên
];
const machine = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
const typed = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");

/** fetch giả: trả lần lượt các phản hồi trong list ({ status, body } hoặc Error để ném). */
function fakeFetch(list) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const r = list[Math.min(calls.length - 1, list.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => (typeof r.body === "string" ? JSON.parse(r.body) : r.body) };
  };
  f.calls = calls;
  return f;
}

describe("địa chỉ + tải lười", () => {
  test("extraUrl: base + chup-mat-do/kho-phu-893.json (như catalogUrl); EXTRA_LIMIT 24", () => {
    assert.equal(mod.extraUrl("./"), "./chup-mat-do/kho-phu-893.json");
    assert.equal(mod.extraUrl("/quet-ma-vach-full/"), "/quet-ma-vach-full/chup-mat-do/kho-phu-893.json");
    assert.equal(mod.extraUrl(), "/chup-mat-do/kho-phu-893.json");
    assert.equal(mod.EXTRA_LIMIT, 24);
  });

  test("loadExtra: đúng dạng → { meta, products }; gọi lại dùng chung promise (1 lượt mạng)", async () => {
    const f = fakeFetch([{ status: 200, body: { meta: { soSanPham: 1 }, products: [DIET] } }]);
    const url = "test://kho-phu-1.json";
    const a = await mod.loadExtra(f, url);
    const b = await mod.loadExtra(f, url);
    assert.deepEqual(a.products, [DIET]);
    assert.equal(a, b);
    assert.equal(f.calls.length, 1);
  });

  test("loadExtra: lỗi mạng / HTTP lỗi / sai dạng → báo lỗi; lần sau tải lại", async () => {
    for (const [i, bad] of [new TypeError("mất mạng"), { status: 404, body: {} }, { status: 200, body: { products: [] } }, { status: 200, body: { meta: {}, products: {} } }, { status: 200, body: [] }, { status: 200, body: "{x" }].entries()) {
      const f = fakeFetch([bad, { status: 200, body: { meta: {}, products: [DIET] } }]);
      const url = `test://kho-phu-loi-${i}.json`;
      await assert.rejects(mod.loadExtra(f, url));
      const ok = await mod.loadExtra(f, url);
      assert.deepEqual(ok.products, [DIET], `lần 2 tải lại (${i})`);
      assert.equal(f.calls.length, 2);
    }
  });

  test("front-extra.js không gọi mạng lúc nạp", async () => {
    const orig = globalThis.fetch;
    let called = 0;
    globalThis.fetch = () => { called++; return Promise.reject(new Error("không được gọi")); };
    try { await import("../src/front-extra.js?lan-nap-2"); } finally { globalThis.fetch = orig; }
    assert.equal(called, 0);
  });
});

describe("chỉ mục + tìm trong kho phụ", () => {
  const xi = mod.buildExtraIndex?.(t1, STORE) ?? [];

  test("buildExtraIndex: hit có cờ extra: true, vn: false, img = frontImageUrl (không có ảnh → \"\"), doc = offDoc", () => {
    assert.equal(xi.length, STORE.length);
    const d = xi[0];
    assert.deepEqual(d.hit, { code: DIET.code, name: DIET.name, brand: DIET.brand, img: "https://images.openfoodfacts.org/images/products/893/458/875/2117/front_en.7.200.jpg", vn: false, text: DIET.text, extra: true });
    assert.equal(xi[2].hit.img, "");
    assert.deepEqual([...d.doc.m.entries()], [...fm.offDoc(t1, DIET.text).m.entries()]);
    assert.equal(d.doc.len, fm.offDoc(t1, DIET.text).len);
  });

  test("searchExtra: khớp ≥ 1 từ, điểm bm25DocScore (chỉ mục CHÍNH) giảm dần, hòa theo thứ tự kho, tối đa limit", () => {
    const got = mod.searchExtra(rIndex.index, xi, typed);
    const scores = got.map((h) => fm.bm25DocScore(rIndex.index, fm.offDoc(t1, h.text), typed.query).score);
    assert.equal(got[0].code, DIET.code);
    for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] >= scores[i]);
    assert.ok(!got.some((h) => h.code === "8930000000002"), "bánh quy không khớp từ nào");
    const i3 = got.findIndex((h) => h.code === "8930000000003");
    const i4 = got.findIndex((h) => h.code === "8930000000004");
    assert.ok(i3 >= 0 && i4 === i3 + 1, "hòa điểm: thứ tự kho");
    assert.equal(mod.searchExtra(rIndex.index, xi, typed, 1).length, 1);
    assert.ok(got.every((h) => h.extra === true));
    got[0].name = "đổi"; // trả bản sao: sửa không làm hỏng chỉ mục
    assert.equal(mod.searchExtra(rIndex.index, xi, typed)[0].name, DIET.name);
  });

  test("searchExtra: câu tìm rỗng / chỉ mục kho rỗng → []; nhận cả kết quả rankFromText (Tìm lại)", () => {
    assert.deepEqual(mod.searchExtra(rIndex.index, xi, fr.rankFromItems(t1, rIndex, [])), []);
    assert.deepEqual(mod.searchExtra(rIndex.index, [], typed), []);
    assert.deepEqual(mod.searchExtra(rIndex.index, xi, null), []);
    assert.ok(mod.searchExtra(rIndex.index, xi, machine).length >= 1);
  });
});

describe("joinExtra + mergeFront (C1: dùng chung 1 chỗ offMax với OFF)", () => {
  const xi = mod.buildExtraIndex?.(t1, STORE) ?? [];
  const OFFHIT = { code: "9000000000001", name: "Foreign soda", brand: "X", img: "", vn: false, text: "soda chanh foreign" };

  test("joinExtra: OFF trước, kho phụ sau, bỏ mã trùng; OFF lỗi + kho rỗng → null; OFF lỗi + kho có → { ok: true, hits }", () => {
    const ex = mod.searchExtra(rIndex.index, xi, typed);
    const j = mod.joinExtra({ ok: true, hits: [OFFHIT, { ...DIET, img: "", vn: false, text: DIET.text }] }, ex);
    assert.equal(j.ok, true);
    assert.equal(j.hits[0].code, OFFHIT.code);
    assert.equal(j.hits[1].code, DIET.code);
    assert.equal(j.hits[1].extra, undefined, "mã trùng: giữ bản OFF");
    assert.equal(new Set(j.hits.map((h) => h.code)).size, j.hits.length);
    assert.equal(mod.joinExtra({ ok: false, kind: "network" }, []), null);
    assert.equal(mod.joinExtra(null, []), null);
    assert.deepEqual(mod.joinExtra(null, ex), { ok: true, hits: ex });
    assert.deepEqual(mod.joinExtra({ ok: false, kind: "timeout" }, ex), { ok: true, hits: ex });
  });

  test("kho phụ rỗng / chưa tải / lỗi → mergeFront GIỐNG HỆT hiện tại", () => {
    const cases = [...fixture.anh.map((a) => fr.rankFromItems(t1, rIndex, a.items)), machine, typed];
    const offs = [null, { ok: false, kind: "network" }, { ok: true, hits: [] }, { ok: true, hits: [OFFHIT] }, { ok: true, hits: [OFFHIT, { ...DIET, img: "", vn: false }] }];
    for (const r of cases) for (const off of offs) for (const ex of [[], null, undefined]) {
      assert.deepEqual(fm.mergeFront(t1, rIndex, products, r, mod.joinExtra(off, ex)), fm.mergeFront(t1, rIndex, products, r, off));
    }
  });

  test("mục kho phụ không vào 3 vị trí khóa, dùng chung 1 chỗ offMax với OFF", () => {
    for (const r of [...fixture.anh.map((a) => fr.rankFromItems(t1, rIndex, a.items)), machine, typed]) {
      // kho phụ giả xấu nhất: chữ = đúng các từ câu tìm T1, lặp 3 lần
      const loud = Array.from({ length: 6 }, (_, j) => ({ code: String(8930000001000 + j), name: "x", brand: "", text: Array(3).fill(r.query.join(" ")).join(" ") }));
      const ex = mod.searchExtra(rIndex.index, mod.buildExtraIndex(t1, loud), r);
      for (const off of [null, { ok: true, hits: [OFFHIT] }]) {
        const got = fm.mergeFront(t1, rIndex, products, r, mod.joinExtra(off, ex));
        const lock = r.hits.slice(0, fm.DEFAULT_GUARD.lockTop).map((h) => h.code);
        assert.deepEqual(got.slice(0, lock.length).map((x) => x.code), lock);
        const outside = got.filter((x) => !catalogCodes.has(x.code));
        assert.ok(outside.length <= fm.DEFAULT_GUARD.offMax, `${outside.length} mục ngoài danh mục`);
      }
    }
  });

  test("offPromote bật cũng KHÔNG đẩy mục kho phụ lên vị trí 1", () => {
    const ex = mod.searchExtra(rIndex.index, xi, typed);
    assert.equal(ex[0].code, DIET.code);
    for (const off of [null, { ok: true, hits: [] }]) {
      const got = fm.mergeFront(t1, rIndex, products, typed, mod.joinExtra(off, ex), { offPromote: { gap: 0, minWords: 2 } });
      assert.equal(got[0].code, typed.hits[0].code);
    }
  });

  test("ca 7Up khi OFF lỗi: kho phụ đưa 8934588752117 vào 5 (chữ máy chủ + câu gõ)", () => {
    for (const r of [machine, typed]) {
      const got = fm.mergeFront(t1, rIndex, products, r, mod.joinExtra(null, mod.searchExtra(rIndex.index, xi, r))).map((x) => x.code);
      assert.ok(got.includes(DIET.code), got.join(","));
    }
  });
});

// ---------------------------------------------------------------------------
// Vòng 7 (P1): photoMerge — hàm gộp thuần DÙNG CHUNG cho app (main.js showPhotoResult) và khung đo cuối
// ---------------------------------------------------------------------------

describe("photoMerge (vòng 7, P1)", () => {
  const xi = mod.buildExtraIndex?.(t1, STORE) ?? [];
  const ngoai = JSON.parse(fs.readFileSync(new URL("./fixtures/off-7up-ngoai.json", import.meta.url), "utf8"));
  const LEMON = { code: "8934588022111", name: "7Up hương chanh", brand: "7UP", img: "", vn: true, text: "7Up hương chanh 7UP" };
  const DIET_OFF = { code: DIET.code, name: DIET.name, brand: DIET.brand, img: "", vn: false, text: DIET.text };
  const salt = fr.rankFromText(t1, rIndex, "COOP\nSelect\nMui Bin Tinh Sấy l-t\nIODIZES REFINED SEA SALT");
  // mọi ca của tests/front-merge.test.js (3 ảnh fixture, 7Up chữ máy chủ + câu gõ, muối, ca từ lạ Haribo, T1 rỗng)
  const allCases = [
    ...fixture.anh.map((a) => fr.rankFromItems(t1, rIndex, a.items)), machine, typed, salt,
    fr.rankFromText(t1, rIndex, "Haribo\nGoldbears"), fr.rankFromText(t1, rIndex, "Goldbears"), fr.rankFromItems(t1, rIndex, []),
  ];
  /** OFF giả xấu nhất (như worstOff của front-merge.test.js). */
  const worst = (r) => {
    const q = [...new Set(r.query)];
    return { ok: true, hits: Array.from({ length: 24 }, (_, j) => ({ code: String(9990000000000 + j), name: q.join(" "), brand: "X", img: "", vn: false, text: `${q.join(" ")} X` })) };
  };
  const offsFor = async (r) => {
    const { parseSearch } = await import("../src/off-search.js");
    return [null, undefined, { ok: false, kind: "none" }, { ok: false, kind: "network" }, { ok: false, kind: "aborted" }, { ok: false, kind: "limited" },
      { ok: true, hits: [] }, { ok: true }, { ok: true, hits: [DIET_OFF, LEMON] }, { ok: true, hits: [LEMON, DIET_OFF] }, { ok: true, hits: parseSearch(ngoai) }, worst(r)];
  };
  const ctx = (x) => ({ t1, rIndex, products, xi: x });

  test("xi null / undefined (kho phụ chưa tải / lỗi) → merged GIỐNG HỆT mergeFront(…, off) trên mọi ca cũ, cả off null", async () => {
    assert.equal(typeof mod.photoMerge, "function");
    for (const r of allCases) for (const off of await offsFor(r)) for (const x of [null, undefined]) {
      const got = mod.photoMerge(ctx(x), r, off, { called: true });
      assert.deepEqual(got.merged, fm.mergeFront(t1, rIndex, products, r, off), JSON.stringify(off)?.slice(0, 80));
    }
  });

  test("có kho phụ → merged = mergeFront(…, joinExtra(off, searchExtra(…)))", async () => {
    for (const r of allCases) for (const off of await offsFor(r)) {
      const got = mod.photoMerge(ctx(xi), r, off, { called: true });
      assert.deepEqual(got.merged, fm.mergeFront(t1, rIndex, products, r, mod.joinExtra(off, mod.searchExtra(rIndex.index, xi, r))));
    }
  });

  test("off 'none' (có câu tìm T1 nhưng không có câu OFF, không gọi mạng) → kho phụ vẫn chạy", () => {
    const got = mod.photoMerge(ctx(xi), typed, { ok: false, kind: "none" }, { called: false });
    assert.ok(got.merged.some((x) => x.code === DIET.code), got.merged.map((x) => x.code).join(","));
    assert.equal(got.offFailed, false);
  });

  test("offFailed tính từ off GỐC + cờ 'có gọi' (như main.js: queries.length > 0 && !off.ok), không từ kết quả đã nối", () => {
    const fail = { ok: false, kind: "network" };
    // OFF lỗi nhưng kho phụ trả được: kết quả đã nối ok, offFailed vẫn true
    assert.equal(mod.photoMerge(ctx(xi), typed, fail, { called: true }).offFailed, true);
    assert.equal(mod.photoMerge(ctx(null), typed, fail, { called: true }).offFailed, true);
    assert.equal(mod.photoMerge(ctx(xi), typed, { ok: true, hits: [] }, { called: true }).offFailed, false);
    assert.equal(mod.photoMerge(ctx(xi), typed, { ok: true, hits: [LEMON] }, { called: true }).offFailed, false);
    // không gọi mạng (không có câu OFF) → không báo lỗi OFF
    assert.equal(mod.photoMerge(ctx(xi), typed, { ok: false, kind: "none" }, { called: false }).offFailed, false);
    assert.equal(mod.photoMerge(ctx(xi), typed, fail, { called: false }).offFailed, false);
    // không truyền cờ: suy từ off (kind "none" / null = không gọi)
    assert.equal(mod.photoMerge(ctx(xi), typed, { ok: false, kind: "none" }).offFailed, false);
    assert.equal(mod.photoMerge(ctx(xi), typed, null).offFailed, false);
    assert.equal(mod.photoMerge(ctx(xi), typed, fail).offFailed, true);
  });

  test("lỗi giá trị chặn (GuardValueError) → console.error rồi mergeFront(…, null) = đúng kết quả T1; lỗi khác ném tiếp", () => {
    const calls = [];
    const merge = (...a) => {
      calls.push(a);
      if (calls.length === 1) throw new fm.GuardValueError("front-merge: lockTop phải là số nguyên ≥ 0 (nhận x)");
      return fm.mergeFront(...a);
    };
    const origErr = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a);
    let got;
    try { got = mod.photoMerge(ctx(xi), typed, { ok: true, hits: [LEMON] }, { called: true, merge }); } finally { console.error = origErr; }
    assert.equal(calls.length, 2);
    assert.equal(calls[1].length, 5);
    assert.equal(calls[1][4], null);
    assert.deepEqual(got.merged, fm.mergeFront(t1, rIndex, products, typed, null));
    assert.equal(logged.length, 1);
    assert.ok(fm.isGuardError(logged[0][0]));
    const boom = () => { throw new TypeError("lỗi lập trình"); };
    assert.throws(() => mod.photoMerge(ctx(xi), typed, null, { called: false, merge: boom }), TypeError);
  });

  test("mục ra: mục kho phụ có cờ extra: true; mục OFF trùng mã với mục kho phụ giữ bản OFF, không có cờ extra", () => {
    const fromExtra = mod.photoMerge(ctx(xi), typed, null, { called: false }).merged.find((x) => x.code === DIET.code);
    assert.ok(fromExtra, "7Up Diet từ kho phụ");
    assert.equal(fromExtra.extra, true);
    assert.equal(fromExtra.source, "off");
    const fromOff = mod.photoMerge(ctx(xi), typed, { ok: true, hits: [DIET_OFF] }, { called: true }).merged.find((x) => x.code === DIET.code);
    assert.ok(fromOff, "7Up Diet từ OFF");
    assert.ok(!("extra" in fromOff) || fromOff.extra === false, JSON.stringify(fromOff));
    assert.equal(fromOff.img, "", "bản OFF (img rỗng), không phải bản kho phụ");
  });
});

describe("không lưu sẵn (precache)", () => {
  test("precacheList (tools/sw-build.mjs) KHÔNG chứa chup-mat-do/kho-phu-893.json", () => {
    const list = swBuild.precacheList(["index.html", "assets/app.js", "chup-mat-do/kho-phu-893.json", "chup-mat-do/danh-muc-vn.json"]);
    assert.ok(!list.some((x) => x.includes("kho-phu-893")), JSON.stringify(list));
    assert.ok(list.includes("./index.html"));
  });
});
