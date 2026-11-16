// Test src/front-merge.js (đợt tu-dong vòng 2): gộp T1 (danh mục) + Open Food Facts thành tối đa 5 sản phẩm.
// Danh mục thật public/chup-mat-do/danh-muc-vn.json, OFF là dữ liệu giả (không gọi mạng). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import * as fr from "../src/front-rank.js";
import * as mod from "../src/front-merge.js"; // import lỗi thì cả file đỏ
import { parseSearch } from "../src/off-search.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../public/chup-mat-do/danh-muc-vn.json", import.meta.url), "utf8"));
const products = catalog.products;
const rIndex = fr.buildRankIndex(t1, products);
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/front-ocr-3.json", import.meta.url), "utf8"));
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));
const DIET = { code: "8934588752117", name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: "https://images.openfoodfacts.org/images/products/893/458/875/2117/front_en.7.200.jpg", vn: false, text: "Soda Chanh - Diet 7Up PepsiCo" };
const LEMON = { code: "8934588022111", name: "7Up hương chanh", brand: "7UP", img: "", vn: true, text: "7Up hương chanh 7UP" };
const FOREIGN = (n) => ({ code: String(9000000000000 + n), name: `Foreign soda ${n}`, brand: "X", img: "", vn: false, text: `Foreign soda ${n} X` });
/** Tắt lớp chặn (vòng 3): đo F1 / F2 / F3 thô. */
const NO_GUARD = Object.freeze({ lockTop: 0, offMax: 5, offGap: 0, offTopRule: null });

describe("OFF lỗi / rỗng / bị hủy → GIỐNG HỆT T1", () => {
  const cases = [
    ...fixture.anh.map((a) => fr.rankFromItems(t1, rIndex, a.items)),
    fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"])),
    fr.rankFromText(t1, rIndex, "COOP\nSelect\nMui Bin Tinh Sấy l-t\nIODIZES REFINED SEA SALT"),
  ];
  const offs = [null, undefined, { ok: false, kind: "network" }, { ok: false, kind: "aborted" }, { ok: false, kind: "limited" }, { ok: true, hits: [] }, { ok: true }];
  for (const method of mod.MERGE_METHODS) {
    test(`${method}: cùng mã, cùng thứ tự, nguồn danh mục`, () => {
      for (const r of cases) {
        for (const off of offs) {
          const got = mod.mergeFront(t1, rIndex, products, r, off, { method });
          assert.deepEqual(got.map((x) => x.code), r.hits.map((h) => h.code), JSON.stringify(off));
          assert.ok(got.every((x) => x.source === "catalog" && x.vn === true));
        }
      }
    });
  }

  test("không có chữ (T1 rỗng) + OFF lỗi → []", () => {
    const r = fr.rankFromItems(t1, rIndex, []);
    assert.deepEqual(mod.mergeFront(t1, rIndex, products, r, { ok: false, kind: "network" }), []);
  });
});

describe("gộp: mã trùng một lần, tối đa 5, dạng mục", () => {
  const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
  const off = { ok: true, hits: [DIET, DIET, LEMON, ...Array.from({ length: 12 }, (_, n) => FOREIGN(n))] };

  for (const method of mod.MERGE_METHODS) {
    test(`${method}: không trùng mã, ≤ 5 mục, có đủ trường`, () => {
      const got = mod.mergeFront(t1, rIndex, products, r, off, { method });
      assert.ok(got.length <= mod.MERGE_K && got.length > 0);
      assert.equal(new Set(got.map((x) => x.code)).size, got.length);
      for (const x of got) {
        assert.deepEqual(Object.keys(x).sort(), ["brand", "code", "img", "name", "score", "source", "vn"]);
        assert.ok(x.source === "catalog" || x.source === "off");
      }
      const lemon = got.find((x) => x.code === LEMON.code);
      if (lemon) assert.equal(lemon.source, "catalog", "mã OFF đã có trong danh mục → dùng bản danh mục");
    });
  }

  test("k nhỏ hơn: cắt đúng k", () => {
    assert.equal(mod.mergeFront(t1, rIndex, products, r, off, { k: 2 }).length, 2);
  });

  test("cách gộp lạ → báo lỗi", () => {
    assert.throws(() => mod.mergeFront(t1, rIndex, products, r, off, { method: "x" }), /không hỗ trợ/);
  });
});

describe("ca 7Up (OFF giả có 8934588752117, chưa có trong danh mục)", () => {
  // Vòng 3: 2 test vị trí 1 dưới đây đo F1 KHÔNG CHẶN (truyền NO_GUARD); lớp chặn mặc định có test riêng ở cuối file.
  test("f1 không chặn: chữ máy chủ 'Up' / 'Soda chanh' / 'Khong calo' → 8934588752117 vị trí 1, nguồn OFF", () => {
    const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    const got = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: [DIET, LEMON] }, NO_GUARD);
    assert.equal(got[0].code, DIET.code, got.map((x) => x.code).join(","));
    assert.equal(got[0].source, "off");
    assert.equal(got[0].vn, false);
    assert.equal(got[0].name, DIET.name);
    assert.match(got[0].img, /^https:\/\/images\.openfoodfacts\.org\//);
  });

  test("f1 không chặn: câu gõ 'Soda chanh diet 7 up' → 8934588752117 vị trí 1", () => {
    const r = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");
    const got = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: [LEMON, DIET] }, NO_GUARD);
    assert.equal(got[0].code, DIET.code, got.map((x) => x.code).join(","));
  });

  test("f1 minMatch 2: ứng viên OFF chỉ khớp 1 từ câu tìm bị bỏ", () => {
    const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    const one = { code: "9100000000001", name: "Calo", brand: "", img: "", vn: false, text: "Calo" };
    const a = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: [one] }, { minMatch: 2 });
    assert.ok(!a.some((x) => x.code === one.code));
  });

  test("bm25DocScore trùng t1.bm25Search trên tài liệu danh mục", () => {
    const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    for (const h of r.hits) {
      const s = mod.bm25DocScore(rIndex.index, rIndex.index.tf[h.i], r.query).score;
      assert.ok(Math.abs(s - h.score) < 1e-9, `${h.code}: ${s} vs ${h.score}`);
    }
  });
});

describe("f3: T1 trước, OFF lấp chỗ trống", () => {
  test("T1 đủ 5 → không có mục OFF; T1 ít hơn 5 → OFF lấp (VN trước)", () => {
    const full = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    const got = mod.mergeFront(t1, rIndex, products, full, { ok: true, hits: [DIET] }, { method: "f3" });
    assert.deepEqual(got.map((x) => x.code), full.hits.map((h) => h.code));
    const empty = fr.rankFromItems(t1, rIndex, []);
    const g2 = mod.mergeFront(t1, rIndex, products, empty, { ok: true, hits: [FOREIGN(1), { ...FOREIGN(2), vn: true }, DIET] }, { method: "f3", ...NO_GUARD });
    assert.deepEqual(g2.map((x) => x.code), [FOREIGN(2).code, FOREIGN(1).code, DIET.code]);
  });
});

// ---------------------------------------------------------------------------
// Vòng 3 (P1): LỚP CHẶN — OFF giả "xấu nhất" không được đẩy gợi ý 1 của T1
// ---------------------------------------------------------------------------

/** OFF giả xấu nhất cho một kết quả T1: n (24) hàng ngoại vn:false, mã giả 13 số không có trong danh mục, chữ chứa đúng
 *  các từ câu tìm T1 (đủ từ / thiếu 1 từ / lặp), cùng hãng với gợi ý 1 của T1. */
function worstOff(r, n = 24) {
  const q = [...new Set(r.query)];
  const brand = products[r.hits[0]?.i]?.brand || "X";
  const hits = [];
  for (let j = 0; j < n; j++) {
    const words = j % 3 === 1 && q.length > 1 ? q.filter((_, x) => x !== j % q.length) : j % 3 === 2 ? [...q, ...q] : q;
    const code = String(9990000000000 + j);
    hits.push({ code, name: words.join(" "), brand, img: "", vn: false, text: `${words.join(" ")} ${brand}` });
  }
  return { ok: true, hits };
}
const catalogCodes = new Set(products.map((p) => p.code));
const offOnly = (got) => got.filter((x) => x.source === "off" && !catalogCodes.has(x.code)).length;

describe("lớp chặn: OFF giả xấu nhất (3 ảnh fixture + ca muối)", () => {
  const cases = [
    ...fixture.anh.map((a) => [a.code, fr.rankFromItems(t1, rIndex, a.items)]),
    ["muoi", fr.rankFromText(t1, rIndex, "COOP\nSelect\nMui Bin Tinh Sấy l-t\nIODIZES REFINED SEA SALT")],
  ];

  test("DEFAULT_GUARD có lockTop ≥ 1 và offMax < 5 (luật 'không làm hại' nằm trong code)", () => {
    assert.ok(mod.DEFAULT_GUARD.lockTop >= 1, JSON.stringify(mod.DEFAULT_GUARD));
    assert.ok(mod.DEFAULT_GUARD.offMax >= 1 && mod.DEFAULT_GUARD.offMax < mod.MERGE_K, JSON.stringify(mod.DEFAULT_GUARD));
    assert.ok(Object.isFrozen(mod.DEFAULT_GUARD));
  });

  test("DEFAULT_GUARD = lớp chặn chọn theo luật P3e vòng 3 (f1-L3-M1-g1: lockTop 3, offMax 1, offGap 1)", () => {
    // test-ocr/chup-mat-do/tu-dong-chan-do.mjs (chỉ cache, D:\tmp\tu-dong\ket-qua\tu-dong-chan-do-BA.json): 32 cách qua
    // (1)–(3); cách này qua (4), ít ảnh bộ B rơi khỏi 5 nhất ở OFF giả (1), bỏ-một-ra 0/0 ở mọi cách.
    // Vòng 6 (P1, V4-2): thêm khóa offPromote (mặc định null = tắt, kết quả như cũ); đổi expected chỉ vì thêm khóa.
    assert.deepEqual({ ...mod.DEFAULT_GUARD }, { lockTop: 3, offMax: 1, offGap: 1, offTopRule: null, offPromote: null });
  });

  test("không chặn: OFF giả xấu nhất ĐẨY được gợi ý 1 của T1 (lý do cần lớp chặn)", () => {
    const pushed = cases.filter(([, r]) => mod.mergeFront(t1, rIndex, products, r, worstOff(r), NO_GUARD)[0].code !== r.hits[0].code);
    assert.ok(pushed.length >= 1, "OFF giả không đủ xấu để thử lớp chặn");
  });

  for (const method of mod.MERGE_METHODS) {
    test(`${method} mặc định: gợi ý 1 của T1 vẫn vị trí 1, ${"lockTop"} đầu giữ thứ tự, mục chỉ có trên OFF ≤ offMax`, () => {
      for (const [name, r] of cases) {
        const got = mod.mergeFront(t1, rIndex, products, r, worstOff(r), { method });
        const { lockTop, offMax } = mod.DEFAULT_GUARD;
        assert.equal(got[0].code, r.hits[0].code, name);
        assert.deepEqual(got.slice(0, lockTop).map((x) => x.code), r.hits.slice(0, lockTop).map((h) => h.code), name);
        assert.ok(offOnly(got) <= offMax, `${name}: ${offOnly(got)} mục OFF`);
        assert.equal(got.length, mod.MERGE_K);
      }
    });
  }

  test("mọi tổ hợp lockTop 1–3 × offMax 1, 2, 3, 5 (f1, có / không offTopRule): T1 top lockTop giữ thứ tự, OFF ≤ offMax", () => {
    for (const [name, r] of cases) {
      for (const lockTop of [1, 2, 3]) for (const offMax of [1, 2, 3, 5]) for (const offTopRule of [null, { gap: 1, minWords: 2 }]) {
        const got = mod.mergeFront(t1, rIndex, products, r, worstOff(r), { lockTop, offMax, offTopRule });
        const tag = `${name} lockTop ${lockTop} offMax ${offMax} rule ${JSON.stringify(offTopRule)}`;
        assert.deepEqual(got.slice(0, lockTop).map((x) => x.code), r.hits.slice(0, lockTop).map((h) => h.code), tag);
        assert.ok(offOnly(got) <= offMax, tag);
        assert.equal(new Set(got.map((x) => x.code)).size, got.length, tag);
      }
    }
  });

  test("offTopRule: ứng viên OFF khớp < minWords từ không bao giờ đứng trên mục danh mục", () => {
    const r = fr.rankFromItems(t1, rIndex, fixture.anh[0].items);
    const one = r.query[0];
    const weak = Array.from({ length: 6 }, (_, j) => ({ code: String(9980000000000 + j), name: one, brand: "", img: "", vn: false, text: `${one} ${one} ${one}` }));
    const got = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: weak }, { lockTop: 0, offMax: 5, offTopRule: { gap: 0, minWords: 2 } });
    const firstOff = got.findIndex((x) => x.source === "off");
    assert.ok(firstOff === -1 || got.slice(firstOff).every((x) => x.source === "off"), got.map((x) => x.source).join(","));
  });

  // Vòng 6 (P2, NÊN SỬA 3 vòng 3): tên + nội dung đúng hành vi: f1 không có từ lạ → bỏ mục OFF khớp 0 từ; có từ lạ
  // (strangeFill) → mục OFF chứa từ lạ lấp chỗ trống như mục OFF khác (offMax chỉ giới hạn khi có mục danh mục để giữ).
  test("T1 rỗng, không có từ lạ: f1 không lấy mục OFF khớp 0 từ; f2 / f3 lấp đủ chỗ trống (offMax chỉ giới hạn khi có mục danh mục để giữ)", () => {
    const empty = fr.rankFromItems(t1, rIndex, []);
    const hits = Array.from({ length: 7 }, (_, j) => FOREIGN(j));
    for (const method of mod.MERGE_METHODS) {
      for (const strangeFill of [false, true]) {
        const got = mod.mergeFront(t1, rIndex, products, empty, { ok: true, hits }, { method, strangeFill });
        // f1 chấm theo câu tìm T1 (rỗng, ảnh không có chữ nên không có từ lạ → không lấy); f2 / f3 lấp theo thứ tự OFF
        if (method === "f1") assert.deepEqual(got, [], `strangeFill ${strangeFill}`);
        else assert.equal(got.length, mod.MERGE_K, method);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Vòng 4 (P1, NÊN SỬA 1 của reviewer vòng 3): giá trị chặn sai KHÔNG được tự tắt lớp chặn → báo lỗi rõ
// ---------------------------------------------------------------------------

describe("lớp chặn: giá trị sai → báo lỗi (không tự tắt)", () => {
  const r = fr.rankFromItems(t1, rIndex, fixture.anh[0].items);
  const off = worstOff(r);
  const BAD = [null, NaN, Infinity, -Infinity, -1, 1.5, "3", true, {}, []];

  for (const key of ["lockTop", "offMax", "offGap"]) {
    for (const method of mod.MERGE_METHODS) {
      test(`${method}: ${key} sai (null, NaN, Infinity, -1, 1.5, "3"…) → báo lỗi nêu tên ${key}`, () => {
        for (const bad of BAD) {
          assert.throws(() => mod.mergeFront(t1, rIndex, products, r, off, { method, [key]: bad }),
            (e) => e instanceof Error && e.message.includes(key), `${key} = ${String(bad)}`);
        }
      });
    }
    test(`${key} sai cũng báo lỗi khi OFF lỗi (không đợi có kết quả OFF mới phát hiện)`, () => {
      assert.throws(() => mod.mergeFront(t1, rIndex, products, r, { ok: false, kind: "network" }, { [key]: null }), new RegExp(key));
    });
  }

  test("undefined (không truyền) vẫn = DEFAULT_GUARD", () => {
    const a = mod.mergeFront(t1, rIndex, products, r, off, { lockTop: undefined, offMax: undefined, offGap: undefined });
    const b = mod.mergeFront(t1, rIndex, products, r, off, { ...mod.DEFAULT_GUARD });
    const c = mod.mergeFront(t1, rIndex, products, r, off);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
  });

  test("vòng 5 (gợi ý 3 vòng 4): lỗi giá trị chặn sai được đánh dấu (isGuardError, name GuardValueError); lỗi khác thì không", () => {
    assert.equal(typeof mod.isGuardError, "function");
    for (const key of ["lockTop", "offMax", "offGap"]) {
      let err = null;
      try { mod.mergeFront(t1, rIndex, products, r, off, { [key]: -1 }); } catch (e) { err = e; }
      assert.ok(err, key);
      assert.equal(err.name, "GuardValueError");
      assert.equal(mod.isGuardError(err), true, key);
    }
    let other = null;
    try { mod.mergeFront(t1, rIndex, products, r, off, { method: "x" }); } catch (e) { other = e; }
    assert.equal(mod.isGuardError(other), false, "cách gộp lạ không phải lỗi giá trị chặn");
    for (const x of [new Error("lockTop"), new TypeError("x"), null, undefined, "GuardValueError", { name: "GuardValueError" }]) {
      assert.equal(mod.isGuardError(x), false, String(x));
    }
  });

  test("'không chặn' tường minh { lockTop: 0, offMax: k, offGap: 0 } vẫn dùng được", () => {
    const got = mod.mergeFront(t1, rIndex, products, r, off, { lockTop: 0, offMax: mod.MERGE_K, offGap: 0 });
    assert.equal(got.length, mod.MERGE_K);
    // OFF giả xấu nhất: không chặn thì mục chỉ có trên OFF chiếm nhiều hơn offMax mặc định
    assert.ok(offOnly(got) > mod.DEFAULT_GUARD.offMax, `${offOnly(got)} mục OFF`);
  });
});

describe("lớp chặn mặc định: ca 7Up", () => {
  const ngoai = JSON.parse(fs.readFileSync(new URL("./fixtures/off-7up-ngoai.json", import.meta.url), "utf8"));
  // Vòng 4 (gợi ý 1 của reviewer vòng 3): đọc fixture bằng parseSearch THẬT của src/off-search.js (đúng đường app).
  const offReal = { ok: true, hits: parseSearch(ngoai) };

  test("fixture: 19 sản phẩm thật của câu 'soda diet 7up', có 8934588752117, hàng ngoại 7UP chưa có trong danh mục", () => {
    assert.equal(offReal.hits.length, 19);
    assert.ok(offReal.hits.some((h) => h.code === DIET.code));
    assert.ok(offReal.hits.filter((h) => /7 ?up|seven up/i.test(h.text) && !catalogCodes.has(h.code)).length >= 10);
  });

  test("chữ máy chủ + câu gõ, OFF giả có 8934588752117 → 8934588752117 trong 5 (lớp chặn mặc định)", () => {
    for (const r of [fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"])), fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up")]) {
      for (const off of [{ ok: true, hits: [DIET, LEMON] }, { ok: true, hits: [LEMON, DIET] }, offReal]) {
        const got = mod.mergeFront(t1, rIndex, products, r, off);
        assert.ok(got.slice(0, 5).some((x) => x.code === DIET.code), got.map((x) => x.code).join(","));
        assert.equal(got[0].code, r.hits[0].code, "gợi ý 1 của T1 giữ vị trí 1");
      }
    }
  });

  test("câu gõ + 19 sản phẩm thật (nhiều 7UP nước ngoài): 8934588022111 và 8934588023064 vẫn trong 5", () => {
    const r = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");
    const got = mod.mergeFront(t1, rIndex, products, r, offReal);
    const codes = got.map((x) => x.code);
    assert.ok(codes.includes("8934588022111"), codes.join(","));
    assert.ok(codes.includes("8934588023064"), codes.join(","));
    // không chặn thì hàng ngoại đẩy được 7Up của danh mục ra ngoài 5 (lý do cần lớp chặn)
    const raw = mod.mergeFront(t1, rIndex, products, r, offReal, NO_GUARD).map((x) => x.code);
    assert.ok(!raw.includes("8934588022111") || !raw.includes("8934588023064"), raw.join(","));
  });
});

// ---------------------------------------------------------------------------
// Vòng 6 (P1, V4-2): offPromote — sản phẩm chỉ có trên OFF lên vị trí 1 khi điểm hơn rõ và khớp ≥ minWords từ
// ---------------------------------------------------------------------------

describe("offPromote (V4-2)", () => {
  const ngoai = JSON.parse(fs.readFileSync(new URL("./fixtures/off-7up-ngoai.json", import.meta.url), "utf8"));
  const offReal = { ok: true, hits: parseSearch(ngoai) };
  const typed = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");
  const machine = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
  const salt = fr.rankFromText(t1, rIndex, "COOP\nSelect\nMui Bin Tinh Sấy l-t\nIODIZES REFINED SEA SALT");
  const allCases = [...fixture.anh.map((a) => fr.rankFromItems(t1, rIndex, a.items)), typed, machine, salt];
  const offsFor = (r) => [null, { ok: false, kind: "network" }, { ok: true, hits: [] }, { ok: true, hits: [DIET, LEMON] }, { ok: true, hits: [LEMON, DIET] }, offReal, worstOff(r)];
  // điểm DIET theo câu gõ cao hơn gợi ý 1 của T1 (7Up hương chanh) — chứng minh để các test dưới có nghĩa
  const dietScore = mod.bm25DocScore(rIndex.index, mod.offDoc(t1, DIET.text), typed.query);

  test("DEFAULT_GUARD.offPromote = null; không truyền / undefined / null → GIỐNG HỆT kết quả cũ trên mọi ca (cả OFF giả xấu nhất)", () => {
    assert.equal(mod.DEFAULT_GUARD.offPromote, null);
    for (const r of allCases) for (const off of offsFor(r)) for (const method of mod.MERGE_METHODS) {
      const a = mod.mergeFront(t1, rIndex, products, r, off, { method });
      assert.deepEqual(mod.mergeFront(t1, rIndex, products, r, off, { method, offPromote: undefined }), a);
      assert.deepEqual(mod.mergeFront(t1, rIndex, products, r, off, { method, offPromote: null }), a);
    }
  });

  test("bật { gap: 0, minWords: 2 }: câu gõ 7Up + OFF có 8934588752117 → 8934588752117 vị trí 1, các mục khác lùi giữ thứ tự", () => {
    assert.ok(dietScore.score >= typed.hits[0].score && dietScore.matched >= 2, JSON.stringify(dietScore));
    for (const off of [{ ok: true, hits: [LEMON, DIET] }, { ok: true, hits: [DIET, LEMON] }]) {
      const before = mod.mergeFront(t1, rIndex, products, typed, off).map((x) => x.code);
      const got = mod.mergeFront(t1, rIndex, products, typed, off, { offPromote: { gap: 0, minWords: 2 } });
      assert.equal(got[0].code, DIET.code, got.map((x) => x.code).join(","));
      assert.equal(got[0].source, "off");
      assert.deepEqual(got.slice(1).map((x) => x.code), before.filter((c) => c !== DIET.code).slice(0, mod.MERGE_K - 1));
      assert.equal(got.length, mod.MERGE_K);
    }
  });

  test("điểm chưa hơn gợi ý 1 đủ gap → không đẩy (giống hệt mặc định)", () => {
    const off = { ok: true, hits: [LEMON, DIET] };
    const gap = Math.ceil(dietScore.score - typed.hits[0].score) + 1;
    assert.deepEqual(mod.mergeFront(t1, rIndex, products, typed, off, { offPromote: { gap, minWords: 2 } }), mod.mergeFront(t1, rIndex, products, typed, off));
  });

  test("khớp < minWords từ khác nhau → không đẩy dù điểm rất cao", () => {
    const one = typed.query.find((w) => rIndex.index.idf.has(w));
    const loud = { code: "9100000000009", name: one, brand: "", img: "", vn: false, text: Array(30).fill(one).join(" ") };
    const off = { ok: true, hits: [loud] };
    const got = mod.mergeFront(t1, rIndex, products, typed, off, { offPromote: { gap: 0, minWords: 2 } });
    assert.notEqual(got[0].code, loud.code);
    assert.deepEqual(got, mod.mergeFront(t1, rIndex, products, typed, off));
  });

  test("mục được đẩy tính vào offMax: tổng mục chỉ có trên OFF ≤ offMax; lockTop mục T1 đứng ngay sau, giữ thứ tự", () => {
    for (const r of allCases) for (const offMax of [1, 2, 3]) {
      const off = worstOff(r);
      const got = mod.mergeFront(t1, rIndex, products, r, off, { offMax, offPromote: { gap: 0, minWords: 2 } });
      assert.ok(offOnly(got) <= offMax, `${offOnly(got)} > ${offMax}`);
      const lock = r.hits.slice(0, mod.DEFAULT_GUARD.lockTop).map((h) => h.code);
      const rest = got[0].source === "off" ? got.slice(1) : got;
      assert.deepEqual(rest.slice(0, lock.length).map((x) => x.code), lock);
      assert.equal(new Set(got.map((x) => x.code)).size, got.length);
    }
  });

  test("OFF lỗi / rỗng / bị hủy + offPromote bật → đúng kết quả T1", () => {
    for (const r of allCases) for (const off of [null, undefined, { ok: false, kind: "network" }, { ok: false, kind: "aborted" }, { ok: true, hits: [] }]) {
      const got = mod.mergeFront(t1, rIndex, products, r, off, { offPromote: { gap: 0, minWords: 2 } });
      assert.deepEqual(got.map((x) => x.code), r.hits.map((h) => h.code));
    }
  });

  test("mục kho phụ (hit.extra === true) KHÔNG BAO GIỜ được offPromote đẩy lên vị trí 1, dù điểm rất cao", () => {
    const extraDiet = { ...DIET, extra: true, text: `${DIET.text} ${DIET.text} ${DIET.text}` };
    for (const off of [{ ok: true, hits: [extraDiet] }, { ok: true, hits: [LEMON, extraDiet] }]) {
      const got = mod.mergeFront(t1, rIndex, products, typed, off, { offPromote: { gap: 0, minWords: 2 } });
      assert.equal(got[0].code, typed.hits[0].code, got.map((x) => x.code).join(","));
      assert.deepEqual(got, mod.mergeFront(t1, rIndex, products, typed, off));
    }
  });

  // Vòng 7 (gợi ý 2 reviewer vòng 6): mục kho phụ giữ cờ extra ở mục ra; mục OFF thường không có khóa extra
  test("mục ra: hit extra: true → mục có extra: true; hit OFF thường → không có khóa extra (dạng mục cũ)", () => {
    const extraDiet = { ...DIET, extra: true };
    const got = mod.mergeFront(t1, rIndex, products, typed, { ok: true, hits: [extraDiet] });
    const d = got.find((x) => x.code === DIET.code);
    assert.ok(d, got.map((x) => x.code).join(","));
    assert.equal(d.extra, true);
    const plain = mod.mergeFront(t1, rIndex, products, typed, { ok: true, hits: [{ ...DIET, extra: false }] }).find((x) => x.code === DIET.code);
    assert.ok(plain && !("extra" in plain), JSON.stringify(plain));
    const plain2 = mod.mergeFront(t1, rIndex, products, typed, { ok: true, hits: [DIET] }).find((x) => x.code === DIET.code);
    assert.deepEqual(Object.keys(plain2).sort(), ["brand", "code", "img", "name", "score", "source", "vn"]);
    for (const x of got) if (x.source === "catalog") assert.ok(!("extra" in x));
  });

  test("giá trị offPromote sai → GuardValueError (kể cả khi OFF lỗi); null hợp lệ", () => {
    const BAD = ["x", 1, true, [], { gap: -1, minWords: 2 }, { gap: NaN, minWords: 2 }, { gap: Infinity, minWords: 2 }, { gap: "1", minWords: 2 },
      { minWords: 2 }, { gap: 1 }, { gap: 1, minWords: 1 }, { gap: 1, minWords: 2.5 }, { gap: 1, minWords: "2" }, { gap: 1, minWords: 0 }, { gap: null, minWords: 2 }];
    for (const bad of BAD) for (const off of [offReal, { ok: false, kind: "network" }]) {
      assert.throws(() => mod.mergeFront(t1, rIndex, products, typed, off, { offPromote: bad }),
        (e) => mod.isGuardError(e) && e.message.includes("offPromote"), JSON.stringify(bad));
    }
    assert.doesNotThrow(() => mod.mergeFront(t1, rIndex, products, typed, offReal, { offPromote: null }));
  });
});

// ---------------------------------------------------------------------------
// Vòng 6 (P2): hàng ngoại tên lạ — mục OFF khớp 0 từ câu tìm T1 nhưng chứa từ lạ chỉ lấp chỗ trống
// ---------------------------------------------------------------------------

describe("từ lạ (strangeFill, P2)", () => {
  const found = fr.rankFromText(t1, rIndex, "Haribo\nGoldbears"); // T1: 1 gợi ý (Chamallows, hãng Haribo)
  const GOLD = { code: "9200000000001", name: "Goldbears", brand: "", img: "", vn: false, text: "Goldbears fruit gum" };
  const GOLD2 = { code: "9200000000002", name: "Goldbears sour", brand: "", img: "", vn: false, text: "Goldbears sour" };
  const OTHER = { code: "9200000000003", name: "Something else", brand: "", img: "", vn: false, text: "Something else entirely" };

  test("ca dựng: T1 có 1 gợi ý; mục OFF chỉ chứa từ lạ 'goldbears' khớp 0 từ", () => {
    assert.equal(found.hits.length, 1);
    assert.equal(mod.bm25DocScore(rIndex.index, mod.offDoc(t1, GOLD.text), found.query).matched, 0);
  });

  test("tắt (mặc định hiện tại): bỏ mục OFF khớp 0 từ như cũ", () => {
    const got = mod.mergeFront(t1, rIndex, products, found, { ok: true, hits: [GOLD, OTHER] }, { strangeFill: false });
    assert.deepEqual(got.map((x) => x.code), found.hits.map((h) => h.code));
  });

  test("bật: mục OFF chứa từ lạ xếp SAU mọi mục danh mục, mục không chứa từ lạ vẫn bị bỏ, vẫn theo offMax / chỗ trống", () => {
    const got = mod.mergeFront(t1, rIndex, products, found, { ok: true, hits: [OTHER, GOLD, GOLD2] }, { strangeFill: true });
    const codes = got.map((x) => x.code);
    assert.equal(codes[0], found.hits[0].code);
    assert.ok(codes.includes(GOLD.code), codes.join(","));
    assert.ok(!codes.includes(OTHER.code), codes.join(","));
    assert.ok(codes.indexOf(GOLD.code) > codes.lastIndexOf(found.hits[found.hits.length - 1].code));
  });

  test("bật, T1 đủ 5 mục danh mục: mục từ lạ không chen vào (chỉ lấp chỗ trống)", () => {
    const r = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up\nFruchtgummi");
    const strange = { code: "9200000000004", name: "Fruchtgummi", brand: "", img: "", vn: false, text: "Fruchtgummi" };
    const got = mod.mergeFront(t1, rIndex, products, r, { ok: true, hits: [strange] }, { strangeFill: true });
    assert.ok(!got.some((x) => x.code === strange.code));
  });

  test("mục kho phụ (extra) không dùng luật từ lạ", () => {
    const got = mod.mergeFront(t1, rIndex, products, found, { ok: true, hits: [{ ...GOLD, extra: true }] }, { strangeFill: true });
    assert.deepEqual(got.map((x) => x.code), found.hits.map((h) => h.code));
  });

  // Vòng 7 (gợi ý 4 reviewer vòng 6)
  test("T1 rỗng nhưng có từ lạ, strangeFill: true → mục OFF chứa từ lạ lấp chỗ trống (mục không chứa từ lạ vẫn bỏ)", () => {
    const only = fr.rankFromText(t1, rIndex, "Goldbears");
    assert.equal(only.hits.length, 0, "ca dựng: T1 rỗng");
    const got = mod.mergeFront(t1, rIndex, products, only, { ok: true, hits: [OTHER, GOLD, GOLD2] }, { strangeFill: true });
    assert.deepEqual(got.map((x) => x.code), [GOLD.code, GOLD2.code]);
    assert.ok(got.every((x) => x.source === "off"));
    assert.deepEqual(mod.mergeFront(t1, rIndex, products, only, { ok: true, hits: [OTHER, GOLD, GOLD2] }, { strangeFill: false }), []);
  });

  // Vòng 7 (gợi ý 3 reviewer vòng 6)
  test("strangeFill không phải boolean → GuardValueError (kể cả khi OFF lỗi); true / false / không truyền hợp lệ", () => {
    for (const bad of ["x1", 1, 0, null, "true", {}, []]) for (const off of [{ ok: true, hits: [GOLD] }, { ok: false, kind: "network" }, null]) {
      assert.throws(() => mod.mergeFront(t1, rIndex, products, found, off, { strangeFill: bad }),
        (e) => mod.isGuardError(e) && e.message.includes("strangeFill"), JSON.stringify(bad));
    }
    for (const okv of [true, false, undefined]) assert.doesNotThrow(() => mod.mergeFront(t1, rIndex, products, found, { ok: true, hits: [GOLD] }, { strangeFill: okv }));
  });

  test("mặc định strangeFill theo STRANGE_MODE của off-search.js (null = tắt)", async () => {
    const os = await import("../src/off-search.js");
    const a = mod.mergeFront(t1, rIndex, products, found, { ok: true, hits: [GOLD] });
    const b = mod.mergeFront(t1, rIndex, products, found, { ok: true, hits: [GOLD] }, { strangeFill: os.STRANGE_MODE !== null });
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Đợt g2-di-qua vòng 3 (P1): serverIdf (cách c-idf của khung đo test-ocr/chup-mat-do/g2-di-qua-do.mjs). Mục có
// serverText (serverMerge gắn cho mục mã có trong ứng viên máy chủ) KHÔNG có trong danh mục: điểm BM25 trên chữ
// serverText, từ ngoài từ vựng danh mục nhận idf lớn nhất của chỉ mục. Hiển thị vẫn theo mục (bản OFF khi trùng mã).
// ---------------------------------------------------------------------------

describe("serverIdf (c-idf, g2-di-qua vòng 3)", () => {
  // danh mục mini 7 sp (như test-ocr/chup-mat-do/test/g2-di-qua.test.mjs): "mi" / "tom" ở 6 tài liệu nên idf thấp
  const MINI = [["8930000000001", "Mi tom chua cay Hao Hao"], ["8930000000002", "Mi tom Omachi"], ["8930000000003", "Mi tom Kokomi"],
    ["8930000000004", "Mi tom Gau do"], ["8930000000005", "Mi tom Vifon"], ["8930000000006", "Mi tom Miliket"], ["8930000000007", "Sua tuoi"]]
    .map(([code, text]) => ({ code, name: text, brand: "", text }));
  const mI = fr.buildRankIndex(t1, MINI);
  const f3 = fr.rankFromItems(t1, mI, itemsOf(["Mi tom", "Ruaypuan Hanami Prawn"])); // T1 đủ 5 mục, 3 từ lạ
  const SRV_TEXT = "Hanami Ruaypuan Prawn crackers";
  const RU = { code: "8852052150101", name: "Hanami OFF", brand: "Ruaypuan", img: "https://images.openfoodfacts.org/x.jpg", vn: false, text: "Zzz", serverText: SRV_TEXT };
  const PROMOTE = { offPromote: { gap: 3, minWords: 3 } };
  let maxIdf = 0;
  for (const v of mI.index.idf.values()) maxIdf = Math.max(maxIdf, v);

  test("ca dựng: 3 từ lạ (ruaypuan, hanami, prawn) không có trong từ vựng danh mục; chữ OFF của mục khớp 0 từ", () => {
    for (const w of ["ruaypuan", "hanami", "prawn"]) { assert.ok(f3.query.includes(w), w); assert.equal(mI.index.idf.has(w), false, w); }
    assert.equal(f3.hits.length, 5);
    assert.equal(mod.bm25DocScore(mI.index, mod.offDoc(t1, RU.text), f3.query).matched, 0);
  });

  test("tắt (mặc định / false): serverText bị bỏ qua, kết quả như cũ (mục khớp 0 từ bị bỏ)", () => {
    const base = mod.mergeFront(t1, mI, MINI, f3, null);
    for (const opts of [PROMOTE, { ...PROMOTE, serverIdf: false }, { ...PROMOTE, serverIdf: undefined }]) {
      assert.deepEqual(mod.mergeFront(t1, mI, MINI, f3, { ok: true, hits: [RU] }, opts), base, JSON.stringify(opts));
    }
    // không có serverText: như mục OFF thường dù bật
    const { serverText, ...plain } = RU;
    assert.deepEqual(mod.mergeFront(t1, mI, MINI, f3, { ok: true, hits: [plain] }, { ...PROMOTE, serverIdf: true }), base);
  });

  test("bật: mục máy chủ ngoài danh mục có 3 từ lạ → điểm idf lớn nhất, offPromote đẩy lên vị trí 1; hiển thị theo mục, không lộ serverText", () => {
    const got = mod.mergeFront(t1, mI, MINI, f3, { ok: true, hits: [RU] }, { ...PROMOTE, serverIdf: true });
    assert.equal(got[0].code, RU.code, got.map((x) => x.code).join(","));
    assert.deepEqual(got.slice(1).map((x) => x.code), f3.hits.slice(0, 4).map((h) => h.code));
    const doc = mod.offDoc(t1, SRV_TEXT);
    const tf = (1 * (mI.index.k1 + 1)) / (1 + mI.index.k1 * (1 - mI.index.b + mI.index.b * (doc.len / mI.index.avgdl)));
    assert.ok(Math.abs(got[0].score - 3 * maxIdf * tf) < 1e-9, `điểm ${got[0].score}`);
    assert.deepEqual(got[0], { code: RU.code, name: "Hanami OFF", brand: "Ruaypuan", img: RU.img, source: "off", vn: false, score: got[0].score });
    // không offPromote: vẫn qua lớp chặn (sau 3 vị trí khóa, chỗ offMax)
    const g2 = mod.mergeFront(t1, mI, MINI, f3, { ok: true, hits: [RU] }, { serverIdf: true });
    assert.equal(g2[3].code, RU.code);
  });

  test("serverDocScore: từ có trong từ vựng dùng idf của chỉ mục, từ lạ dùng idf lớn nhất; đếm matched", () => {
    const doc = { m: new Map([["ruaypuan", 1], ["mi", 1]]), len: 2 };
    const { score, matched } = mod.serverDocScore(mI.index, doc, ["ruaypuan", "mi", "khac", "mi"], mod.maxIdfOf(mI.index));
    assert.equal(mod.maxIdfOf(mI.index), maxIdf);
    assert.equal(matched, 2);
    const tf = (1 * (mI.index.k1 + 1)) / (1 + mI.index.k1 * (1 - mI.index.b + mI.index.b * (2 / mI.index.avgdl)));
    assert.ok(Math.abs(score - (maxIdf + mI.index.idf.get("mi")) * tf) < 1e-9);
  });

  test("serverIdf không phải boolean → GuardValueError nêu tên (kể cả khi OFF lỗi); true / false / không truyền hợp lệ", () => {
    for (const bad of [null, "x", 1, 0, "true", {}, []]) for (const off of [{ ok: true, hits: [RU] }, { ok: false, kind: "network" }, null]) {
      assert.throws(() => mod.mergeFront(t1, mI, MINI, f3, off, { serverIdf: bad }),
        (e) => mod.isGuardError(e) && e.message.includes("serverIdf"), JSON.stringify(bad));
    }
    for (const okv of [true, false, undefined]) assert.doesNotThrow(() => mod.mergeFront(t1, mI, MINI, f3, { ok: true, hits: [RU] }, { serverIdf: okv }));
  });
});
