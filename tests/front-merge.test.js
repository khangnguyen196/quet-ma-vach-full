// Test src/front-merge.js (đợt tu-dong vòng 2): gộp T1 (danh mục) + Open Food Facts thành tối đa 5 sản phẩm.
// Danh mục thật public/chup-mat-do/danh-muc-vn.json, OFF là dữ liệu giả (không gọi mạng). Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import * as fr from "../src/front-rank.js";
import * as mod from "../src/front-merge.js"; // import lỗi thì cả file đỏ

const catalog = JSON.parse(fs.readFileSync(new URL("../public/chup-mat-do/danh-muc-vn.json", import.meta.url), "utf8"));
const products = catalog.products;
const rIndex = fr.buildRankIndex(t1, products);
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/front-ocr-3.json", import.meta.url), "utf8"));
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));
const DIET = { code: "8934588752117", name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: "https://images.openfoodfacts.org/images/products/893/458/875/2117/front_en.7.200.jpg", vn: false, text: "Soda Chanh - Diet 7Up PepsiCo" };
const LEMON = { code: "8934588022111", name: "7Up hương chanh", brand: "7UP", img: "", vn: true, text: "7Up hương chanh 7UP" };
const FOREIGN = (n) => ({ code: String(9000000000000 + n), name: `Foreign soda ${n}`, brand: "X", img: "", vn: false, text: `Foreign soda ${n} X` });
/** Tắt lớp chặn (vòng 3): đo F1 / F2 / F3 thô. */
const NO_GUARD = Object.freeze({ lockTop: 0, offMax: 5, offTopRule: null });

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
    assert.deepEqual({ ...mod.DEFAULT_GUARD }, { lockTop: 3, offMax: 1, offGap: 1, offTopRule: null });
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

  test("offMax chỉ giới hạn khi có mục danh mục để giữ: T1 rỗng thì mục OFF lấp đủ chỗ trống", () => {
    const empty = fr.rankFromItems(t1, rIndex, []);
    const hits = Array.from({ length: 7 }, (_, j) => FOREIGN(j));
    for (const method of mod.MERGE_METHODS) {
      const got = mod.mergeFront(t1, rIndex, products, empty, { ok: true, hits }, { method });
      // f1 chấm theo câu tìm T1 (rỗng → không khớp từ nào → không lấy); f2 / f3 lấp theo thứ tự OFF
      if (method === "f1") assert.deepEqual(got, []);
      else assert.equal(got.length, mod.MERGE_K, method);
    }
  });
});

describe("lớp chặn mặc định: ca 7Up", () => {
  const ngoai = JSON.parse(fs.readFileSync(new URL("./fixtures/off-7up-ngoai.json", import.meta.url), "utf8"));
  const parse = (ps) => ps.map((p) => {
    const names = Object.entries(p).filter(([k, v]) => /^product_name/.test(k) && typeof v === "string" && v.trim()).map(([, v]) => v.trim());
    const generic = Object.entries(p).filter(([k, v]) => /^generic_name/.test(k) && typeof v === "string" && v.trim()).map(([, v]) => v.trim());
    const brand = typeof p.brands === "string" ? p.brands : "";
    return { code: p.code, name: names[0] || "", brand, img: "", vn: (p.countries_tags || []).includes("en:vietnam"), text: [...names, brand, ...generic].join(" ") };
  });
  const offReal = { ok: true, hits: parse(ngoai.products) };

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
