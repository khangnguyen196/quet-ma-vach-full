// Test src/front-server.js (đợt kho-lon vòng 4): kiểm dạng ứng viên máy chủ (serverCandidates) và phép gộp G2-g3-w3
// (serverMerge) TRÙNG mergeByMethod của khung đo test-ocr/chup-mat-do/kho-lon-do.mjs (hàm đã dùng để chọn cách ở vòng
// 1–3). Dữ liệu: danh mục 1.452 + kho phụ 893 của app (public/chup-mat-do), fixture OFF 7Up thật (19 sp, đọc bằng
// parseSearch thật), 3 ảnh fixture OCR. Không gọi mạng.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import * as fr from "../src/front-rank.js";
import { mergeFront } from "../src/front-merge.js";
import { parseSearch } from "../src/off-search.js";
import { photoMerge } from "../src/front-extra.js";
// import động + catch: chưa có module thì từng test đỏ riêng
const mod = await import("../src/front-server.js").catch(() => ({}));
// Khung đo (hàm mergeByMethod thuần; khối main của file chỉ chạy khi gọi thẳng bằng node, không chạy khi import)
import { mergeByMethod, methodGrid } from "../test-ocr/chup-mat-do/kho-lon-do.mjs";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const products = read("../public/chup-mat-do/danh-muc-vn.json").products;
const extra = read("../public/chup-mat-do/kho-phu-893.json").products;
const rIndex = fr.buildRankIndex(t1, products);
const catalogCodes = new Set(products.map((p) => p.code));
const ocr3 = read("./fixtures/front-ocr-3.json");
const offReal = { ok: true, hits: parseSearch(read("./fixtures/off-7up-ngoai.json")) };
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));

const DIET = "8934588752117"; // 7Up Diet: có trong kho phụ 893 + fixture OFF, KHÔNG có trong danh mục 1.452
const LEMON = "8934588022111"; // 7Up hương chanh: có trong danh mục 1.452
const IMG_DIET = "https://images.openfoodfacts.org/images/products/893/458/875/2117/front_en.7.200.jpg";

/** Mục máy chủ THÔ (như /ocr trả: img là khóa ảnh) lấy từ danh mục / kho phụ / fixture OFF. */
function raw(code, grp, score) {
  const p = products.find((x) => x.code === code) || extra.find((x) => x.code === code);
  if (p) return { code: p.code, name: p.name, brand: p.brand ?? "", img: p.img ?? "", text: p.text, grp, score };
  const h = offReal.hits.find((x) => x.code === code);
  assert.ok(h, `không có mã ${code} trong dữ liệu test`);
  return { code: h.code, name: h.name, brand: h.brand, img: "front_en.1", text: h.text, grp, score };
}

// ---------------------------------------------------------------------------------------------------------------------
describe("serverCandidates: kiểm dạng", () => {
  const ok = (extra = {}) => ({ code: DIET, name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: "front_en.7", text: "Soda Chanh - Diet 7Up PepsiCo", grp: "893", score: 21.37, ...extra });

  test("mục hợp lệ → dạng { code, name, brand, img (URL tự dựng), vn, text, grp, score } của khung đo", () => {
    assert.deepEqual(mod.serverCandidates({ candidates: [ok(), ok({ code: LEMON, img: "front_vi.23", grp: "vn", score: 3 })] }), [
      { code: DIET, name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: IMG_DIET, vn: false, text: "Soda Chanh - Diet 7Up PepsiCo", grp: "893", score: 21.37 },
      { code: LEMON, name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: "https://images.openfoodfacts.org/images/products/893/458/802/2111/front_vi.23.200.jpg", vn: true, text: "Soda Chanh - Diet 7Up PepsiCo", grp: "vn", score: 3 },
    ]);
    // khóa thừa của máy chủ bị bỏ
    assert.deepEqual(Object.keys(mod.serverCandidates({ candidates: [ok({ url: "x", extra: true })] })[0]), ["code", "name", "brand", "img", "vn", "text", "grp", "score"]);
  });

  test("thân / khóa sai → [] (luôn là mảng)", () => {
    for (const body of [undefined, null, "x", 7, [], {}, { candidates: null }, { candidates: {} }, { candidates: "[]" }, { candidates: 3 }]) {
      assert.deepEqual(mod.serverCandidates(body), [], JSON.stringify(body));
    }
  });

  test("mã phải là chuỗi 8–14 chữ số", () => {
    const bad = [1234567890123, "1234567", "123456789012345", "89345887521a7", " 8934588752117", "8934588752117\n", "", null];
    for (const code of bad) assert.deepEqual(mod.serverCandidates({ candidates: [ok({ code })] }), [], String(code));
    for (const code of ["12345678", "12345678901234", "0000000000000"]) {
      assert.equal(mod.serverCandidates({ candidates: [ok({ code })] }).length, 1, code);
    }
  });

  test("name / brand / text / grp phải là chuỗi, score số hữu hạn; sai → bỏ mục", () => {
    const bads = [{ name: 1 }, { name: null }, { brand: undefined }, { brand: ["x"] }, { text: {} }, { text: undefined },
      { grp: 1 }, { grp: null }, { score: "21" }, { score: NaN }, { score: Infinity }, { score: -Infinity }, { score: null }, { score: undefined }];
    for (const b of bads) assert.deepEqual(mod.serverCandidates({ candidates: [ok(b)] }), [], JSON.stringify(b));
    assert.deepEqual(mod.serverCandidates({ candidates: [null, 1, "x", [ok()], ok({ score: 0 }), ok({ score: -2.5, code: LEMON })] }).map((c) => [c.code, c.score]),
      [[DIET, 0], [LEMON, -2.5]]);
  });

  test("chỉ xét 10 phần tử đầu; trùng mã giữ mục đầu", () => {
    const many = Array.from({ length: 15 }, (_, i) => ok({ code: String(8934588000000 + i), score: i }));
    const got = mod.serverCandidates({ candidates: many });
    assert.equal(mod.SERVER_MAX, 10);
    assert.deepEqual(got.map((c) => c.score), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // mục hỏng trong 10 phần tử đầu vẫn chiếm chỗ (không kéo mục thứ 11 vào)
    const withBad = [null, ...many];
    assert.equal(mod.serverCandidates({ candidates: withBad }).length, 9);
    const dup = mod.serverCandidates({ candidates: [ok({ name: "đầu" }), ok({ name: "sau" }), ok({ code: LEMON })] });
    assert.deepEqual(dup.map((c) => [c.code, c.name]), [[DIET, "đầu"], [LEMON, "Soda Chanh - Diet 7Up"]]);
  });

  test("img: chỉ khóa ảnh hợp lệ thành URL images.openfoodfacts.org; URL / đường dẫn / sai kiểu → \"\"", () => {
    for (const img of ["https://evil.example/a.jpg", "//images.openfoodfacts.org/x.jpg", "../front_en.7", "front_en.7.200.jpg", "FRONT_EN.7", "", null, 7, undefined]) {
      assert.equal(mod.serverCandidates({ candidates: [ok({ img })] })[0].img, "", String(img));
    }
    // mã 12 số: frontImageUrl chưa đối chiếu → "" dù khóa đúng
    assert.equal(mod.serverCandidates({ candidates: [ok({ code: "123456789012" })] })[0].img, "");
  });

  // Kho-lon vòng 5: danh mục (c) có name dài nhất 213, text dài nhất 2.240 ký tự (4 mục từng bị cắt ở 200 / 2.000) →
  // nâng giới hạn lên 250 / 2.500 (server/tests/test_catalog_lengths.py giữ: giới hạn ≥ độ dài lớn nhất của danh mục).
  test("cắt text ≤ 2.500, name / brand ≤ 250 ký tự (không cắt đôi ký tự ngoài BMP)", () => {
    assert.equal(mod.SERVER_TEXT_MAX, 2500);
    assert.equal(mod.SERVER_NAME_MAX, 250);
    const long = "a".repeat(3000);
    const emo = "😀".repeat(300); // 300 ký tự, 600 đơn vị UTF-16
    const [c] = mod.serverCandidates({ candidates: [ok({ text: long, name: emo, brand: "b".repeat(350) })] });
    assert.equal(c.text.length, 2500);
    assert.equal(Array.from(c.name).length, 250);
    assert.equal(c.name, "😀".repeat(250));
    assert.equal(c.brand, "b".repeat(250));
    const [d] = mod.serverCandidates({ candidates: [ok({ text: "x".repeat(2500), name: "n".repeat(250) })] });
    assert.equal(d.text.length, 2500);
    assert.equal(d.name.length, 250);
    // độ dài lớn nhất đo được trên danh mục (c) đi qua nguyên vẹn
    const [e] = mod.serverCandidates({ candidates: [ok({ text: "t".repeat(2240), name: "n".repeat(213), brand: "b".repeat(133) })] });
    assert.equal(e.text.length, 2240);
    assert.equal(e.name.length, 213);
    assert.equal(e.brand.length, 133);
  });

  test("vn chỉ khi grp đúng \"vn\"", () => {
    const got = mod.serverCandidates({ candidates: ["vn", "VN", "893", "us", ""].map((grp, i) => ok({ grp, code: String(8934588000000 + i) })) });
    assert.deepEqual(got.map((c) => c.vn), [true, false, false, false, false]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("serverMerge trùng mergeByMethod G2-g3-w3 của khung đo", () => {
  test("SERVER_MERGE_OPTS = offPromote { gap 3, minWords 3 } (đúng cách G2-g3-w3 đã chốt), đóng băng", () => {
    const g = methodGrid()["G2-g3-w3"];
    assert.deepEqual(g, { kind: "g2", gap: 3, minWords: 3 });
    assert.deepEqual(mod.SERVER_MERGE_OPTS, { offPromote: { gap: g.gap, minWords: g.minWords } });
    assert.ok(Object.isFrozen(mod.SERVER_MERGE_OPTS) && Object.isFrozen(mod.SERVER_MERGE_OPTS.offPromote));
  });

  const offOnly = offReal.hits.filter((h) => !catalogCodes.has(h.code) && h.code !== DIET).map((h) => h.code);
  const S_CASES = {
    "7up (kho phụ + danh mục + OFF + muối)": [raw(DIET, "893", 30.1), raw(LEMON, "vn", 22), raw(offOnly[0], "us", 18.5), raw("8936071331106", "893", 4.2)],
    "1 mục": [raw(DIET, "893", 30.1)],
    "trùng danh mục 1.452": [raw(LEMON, "vn", 22), raw(ocr3.anh[0].code, "vn", 15), raw(products[0].code, "vn", 3)],
    "trùng OFF": [raw(offOnly[1], "us", 12), raw(offOnly[2], "th", 11), raw(DIET, "893", 9)],
    "toàn ngoài danh mục": offOnly.slice(3, 8).map((c, i) => raw(c, "us", 10 - i)),
  };
  const FOUND = {
    "7up chữ máy chủ": fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"])),
    "7up câu gõ": fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up"),
    muối: fr.rankFromText(t1, rIndex, "COOP\nSelect\nMui Bin Tinh Sấy l-t\nIODIZES REFINED SEA SALT"),
    ...Object.fromEntries(ocr3.anh.map((a) => [`ảnh ${a.code}`, fr.rankFromItems(t1, rIndex, a.items)])),
  };
  const OFFS = {
    "OFF fixture 7Up (19 sp)": offReal,
    "OFF lỗi": { ok: false, kind: "network" },
    "OFF rỗng": { ok: true, hits: [] },
    "không câu OFF": { ok: false, kind: "none" },
    "OFF null": null,
    "OFF có Diet + chanh": { ok: true, hits: offReal.hits.filter((h) => h.code === DIET).concat([{ code: LEMON, name: "7Up hương chanh", brand: "7UP", img: "", vn: true, text: "7Up hương chanh 7UP" }]) },
  };

  const rows = [];
  for (const [sName, rawS] of Object.entries(S_CASES)) {
    const S = mod.serverCandidates ? mod.serverCandidates({ candidates: rawS }) : [];
    for (const [fName, found] of Object.entries(FOUND)) for (const [oName, off] of Object.entries(OFFS)) rows.push({ sName, S, fName, found, oName, off });
  }

  test(`${rows.length} ca (${Object.keys(S_CASES).length} S × ${Object.keys(FOUND).length} chữ × ${Object.keys(OFFS).length} OFF): merged trùng từng trường, 0 lệch`, () => {
    let diff = 0;
    for (const r of rows) {
      assert.equal(r.S.length, S_CASES[r.sName].length, `S ${r.sName} giữ đủ mục`);
      const want = mergeByMethod({ t1, rIndex, products, found: r.found, off: r.off, S: r.S, method: "G2-g3-w3" });
      const got = mod.serverMerge({ t1, rIndex, products }, r.found, r.off, r.S, { called: true }).merged;
      try { assert.deepStrictEqual(got, want); } catch { diff++; console.error(`lệch: ${r.sName} | ${r.fName} | ${r.oName}`); }
    }
    assert.equal(diff, 0);
  });

  test("có nghĩa: 7Up Diet (chỉ có ở máy chủ / OFF) lên vị trí 1 ở ca 7Up; khác mergeFront mặc định (tùy chọn có tác dụng)", () => {
    const S = mod.serverCandidates({ candidates: S_CASES["7up (kho phụ + danh mục + OFF + muối)"] });
    for (const found of [FOUND["7up chữ máy chủ"], FOUND["7up câu gõ"]]) {
      for (const off of [offReal, OFFS["OFF lỗi"]]) {
        const got = mod.serverMerge({ t1, rIndex, products }, found, off, S, { called: true }).merged;
        assert.equal(got[0].code, DIET, got.map((x) => x.code).join(","));
        // OFF lỗi: mục lấy từ máy chủ (ảnh tự dựng từ khóa); OFF có cùng mã: giữ bản OFF (joinExtra: OFF trước), như khung đo
        if (off !== offReal) assert.equal(got[0].img, IMG_DIET);
      }
    }
    let differs = 0;
    for (const r of rows) {
      const plain = photoMerge({ t1, rIndex, products, xi: null }, r.found, r.off, { called: true }).merged;
      if (JSON.stringify(mod.serverMerge({ t1, rIndex, products }, r.found, r.off, r.S, { called: true }).merged) !== JSON.stringify(plain)) differs++;
    }
    assert.ok(differs > 0, "serverMerge phải khác đường cũ ở ít nhất 1 ca");
  });

  test("mục OFF không trùng mã máy chủ không được đẩy lên vị trí 1 (mang extra); mục máy chủ không mang khóa extra", () => {
    const S = mod.serverCandidates({ candidates: S_CASES["1 mục"] });
    for (const r of rows.filter((x) => x.sName === "1 mục")) {
      const got = mod.serverMerge({ t1, rIndex, products }, r.found, r.off, S, { called: true }).merged;
      if (got[0] && !catalogCodes.has(got[0].code)) assert.equal(got[0].code, DIET, `${r.fName} | ${r.oName}`);
      for (const x of got) if (x.code === DIET) assert.ok(!("extra" in x));
    }
  });

  test("offFailed tính trên OFF GỐC (như photoMerge), không trên kết quả đã nối ứng viên máy chủ", () => {
    const S = mod.serverCandidates({ candidates: S_CASES["1 mục"] });
    const f = FOUND["7up câu gõ"];
    const of = (off, opts) => mod.serverMerge({ t1, rIndex, products }, f, off, S, opts).offFailed;
    assert.equal(of({ ok: false, kind: "network" }, { called: true }), true);
    assert.equal(of(null, { called: true }), true);
    assert.equal(of(offReal, { called: true }), false);
    assert.equal(of({ ok: true, hits: [] }, { called: true }), false);
    assert.equal(of({ ok: false, kind: "none" }, { called: false }), false);
    // không truyền called: suy từ off như photoMerge
    assert.equal(of({ ok: false, kind: "none" }), false);
    assert.equal(of({ ok: false, kind: "timeout" }), true);
    for (const off of Object.values(OFFS)) for (const called of [true, false, undefined]) {
      assert.equal(of(off, { called }), photoMerge({ t1, rIndex, products, xi: null }, f, off, { called }).offFailed);
    }
  });

  test("không đổi dữ liệu đầu vào (off, S)", () => {
    const S = mod.serverCandidates({ candidates: S_CASES["trùng OFF"] });
    const off = structuredClone(offReal);
    const s0 = structuredClone(S), o0 = structuredClone(off);
    mod.serverMerge({ t1, rIndex, products }, FOUND["7up câu gõ"], off, S, { called: true });
    assert.deepEqual(S, s0);
    assert.deepEqual(off, o0);
  });

  test("S rỗng: kết quả = mergeFront có tùy chọn trên OFF đã đánh dấu (main.js không gọi, đi đường cũ)", () => {
    const f = FOUND["7up câu gõ"];
    const got = mod.serverMerge({ t1, rIndex, products }, f, OFFS["OFF lỗi"], [], { called: true }).merged;
    assert.deepEqual(got, mergeFront(t1, rIndex, products, f, null));
  });
});
