// Test luật tách chữ T1 (đợt tu-dong vòng 2, P2): ca lon "Soda Chanh - Diet 7Up" (máy chủ đọc "Up" / "Soda chanh" /
// "Khong calo"; gõ "Soda chanh diet 7 up"). Ba luật, đo ở test-ocr/chup-mat-do/tu-dong-t1-thu.mjs (bộ B / A không ảnh
// nào đổi thứ hạng):
//   i   câu tìm: "7 up" → "7up" khi "7up" có trong từ vựng chỉ mục (không ghép "3 in", "24 lon");
//   ii  câu tìm: giữ dòng 2 chữ cái ("Up") khi mọi từ của dòng có trong từ vựng chỉ mục;
//   iii chỉ mục: từ "số + chữ" ("7up") lập thêm phần chữ ("up").
// Bản trình duyệt public/chup-mat-do/t1.mjs phải trùng bản Node (test-ocr/chup-mat-do/vn-data.mjs, chuẩn).
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as t1 from "../public/chup-mat-do/t1.mjs";
import * as node from "../test-ocr/chup-mat-do/vn-data.mjs";
import * as fr from "../src/front-rank.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../public/chup-mat-do/danh-muc-vn.json", import.meta.url), "utf8"));
const rIndex = fr.buildRankIndex(t1, catalog.products);
const vocab = rIndex.index.idf;
const SEVEN_UP_LEMON = "8934588022111"; // "7Up hương chanh"
const SEVEN_UP = "8934588023064"; // "7Up"
/** Khung chữ máy chủ dựng từ dòng (mỗi dòng một khung, không chồng lấn), như saltItems của nang-t1-do.mjs. */
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));

describe("luật i: ghép số + từ ngắn theo từ vựng", () => {
  test("'7 up' → '7up' khi có trong từ vựng; không có từ vựng thì như cũ (bỏ số)", () => {
    for (const m of [t1, node]) {
      assert.deepEqual(m.t1QueryFromLines([{ text: "Soda chanh diet 7 up" }], vocab), ["soda", "chanh", "diet", "7up"]);
      assert.deepEqual(m.t1QueryFromLines([{ text: "Soda chanh diet 7 up" }]), ["soda", "chanh", "diet", "up"]);
    }
  });

  test("không ghép khi từ ghép không có trong từ vựng, hoặc từ sau là từ nhiễu / 'in'", () => {
    const v = new Set(["3in", "24lon", "2tui", "ca", "phe", "bia"]);
    for (const m of [t1, node]) {
      assert.deepEqual(m.t1QueryFromLines([{ text: "Cà phê sữa 3 in 1" }], v), ["ca", "phe", "sua"]);
      assert.deepEqual(m.t1QueryFromLines([{ text: "Bia 24 lon" }], v), ["bia"]);
      assert.deepEqual(m.t1QueryFromLines([{ text: "Bánh 2 túi" }], v), ["banh"]);
      assert.deepEqual(m.t1QueryFromLines([{ text: "Mì 5 ga" }], v), ["mi", "ga"]);
    }
  });
});

describe("luật ii: dòng 2 chữ cái theo từ vựng", () => {
  test("dòng 'Up' giữ khi 'up' có trong từ vựng; không có từ vựng / từ lạ / độ tin thấp thì bỏ như cũ", () => {
    for (const m of [t1, node]) {
      assert.deepEqual(m.t1QueryFromLines([{ text: "Up", conf: 0.95 }, { text: "Soda chanh", conf: 0.95 }], vocab), ["up", "soda", "chanh"]);
      assert.deepEqual(m.t1QueryFromLines([{ text: "Up", conf: 0.95 }, { text: "Soda chanh", conf: 0.95 }]), ["soda", "chanh"]);
      assert.deepEqual(m.t1QueryFromLines([{ text: "Qx", conf: 0.95 }], new Set(["up"])), []);
      assert.deepEqual(m.t1QueryFromLines([{ text: "Up", conf: 0.3 }], new Set(["up"])), []);
      assert.deepEqual(m.t1QueryFromLines([{ text: "U", conf: 0.95 }], new Set(["u"])), []);
    }
  });
});

describe("luật iii: chỉ mục lập thêm phần chữ của từ 'số + chữ'", () => {
  test("'7up' → thêm 'up'; '500ml', '3in1', '24h' không thêm gì", () => {
    for (const m of [t1, node]) {
      assert.deepEqual(m.docTokens("7Up hương chanh"), ["7up", "huong", "chanh", "up"]);
      assert.deepEqual(m.docTokens("Sữa 500ml"), ["sua"]);
      assert.deepEqual(m.docTokens("Cà phê 3in1 24h"), ["ca", "phe", "3in1"]);
      assert.deepEqual(m.bm25Tokens("7Up hương chanh"), ["7up", "huong", "chanh"], "bm25Tokens (câu tìm) không đổi");
    }
  });

  test("chỉ mục: sản phẩm 7Up có từ 'up'; bản trình duyệt và bản Node cùng idf", () => {
    const a = t1.buildBm25(catalog.products);
    const b = node.buildBm25(catalog.products);
    const i = catalog.products.findIndex((p) => p.code === SEVEN_UP);
    assert.ok(a.tf[i].m.has("up") && a.tf[i].m.has("7up"));
    assert.equal(a.idf.get("up"), b.idf.get("up"));
    assert.equal(a.avgdl, b.avgdl);
  });
});

describe("ca 7Up qua front-rank (danh mục thật, chưa có 8934588752117)", () => {
  test("chữ máy chủ 'Up' / 'Soda chanh' / 'Khong calo' → 7Up hương chanh vị trí 1, 7Up trong 5", () => {
    const r = fr.rankFromItems(t1, rIndex, itemsOf(["Up", "Soda chanh", "Khong calo"]));
    const codes = r.hits.map((h) => h.code);
    assert.ok(r.query.includes("up"), r.query.join(" "));
    assert.equal(codes[0], SEVEN_UP_LEMON, codes.join(","));
    assert.ok(codes.includes(SEVEN_UP), codes.join(","));
  });

  test("gõ 'Soda chanh diet 7 up' → câu có '7up', 7Up hương chanh vị trí 1, 7Up trong 5", () => {
    const r = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");
    const codes = r.hits.map((h) => h.code);
    assert.ok(r.query.includes("7up"), r.query.join(" "));
    assert.equal(codes[0], SEVEN_UP_LEMON, codes.join(","));
    assert.ok(codes.includes(SEVEN_UP), codes.join(","));
  });

  test("bản Node cùng câu tìm + top 5 + điểm với bản trình duyệt (ca 7Up)", () => {
    const ni = node.buildBm25(catalog.products);
    const pi = t1.buildBm25(catalog.products);
    for (const lines of [
      t1.rowLineInfo(itemsOf(["Up", "Soda chanh", "Khong calo"])),
      [{ text: "Soda chanh diet 7 up", conf: null }],
    ]) {
      const qn = node.t1QueryFromLines(lines, ni.idf);
      const qp = t1.t1QueryFromLines(lines, pi.idf);
      assert.deepEqual(qp, qn);
      const hn = node.bm25Search(ni, qn, 5);
      const hp = t1.bm25Search(pi, qp, 5);
      assert.deepEqual(hp.map((h) => h.code), hn.map((h) => h.code));
      hp.forEach((h, k) => assert.ok(Math.abs(h.score - hn[k].score) < 1e-9));
    }
  });
});
