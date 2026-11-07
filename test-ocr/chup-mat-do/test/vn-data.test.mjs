// Test vòng 3 (không gọi mạng): đọc luồng / lọc VN, chọn chỉ mục, cặp leave-one-out, BM25, câu tìm T1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import {
  productFronts, vnRecordFromLine, filterVnStream, selectIndexProducts, rankCompare, looCandidates, filterLooPairs,
  queryNotInIndex, buildBm25, bm25Search, bm25Tokens, docText, t1QueryFromLines, t1QueryFromGemini,
} from "../vn-data.mjs";
import { rrf } from "../lib.mjs";
import { topK, l2norm } from "../embed-models.mjs";

const newStyle = (code, countries, fronts, extra = {}) => ({
  code,
  countries_tags: countries,
  product_name: `Sản phẩm ${code}`,
  images: {
    uploaded: Object.fromEntries(fronts.map(([, id]) => [id, { sizes: {} }])),
    selected: { front: Object.fromEntries(fronts.map(([lang, id]) => [lang, { imgid: id, rev: "2" }])) },
  },
  ...extra,
});

test("productFronts đọc cả kiểu ảnh cũ (front_xx) và mới (selected.front.xx), vi trước", () => {
  const f = productFronts(newStyle("1", [], [["fr", "1"], ["vi", "3"]]));
  assert.deepEqual(f.map((x) => [x.key, x.imgid]), [["front_vi", "3"], ["front_fr", "1"]]);
  const old = productFronts({ images: { front_en: { imgid: 5, rev: 1 }, 5: {} } });
  assert.deepEqual(old.map((x) => [x.key, x.imgid]), [["front_en", "5"]]);
});

test("vnRecordFromLine chỉ giữ sản phẩm có en:vietnam, giữ mọi product_name* / generic_name*", () => {
  assert.equal(vnRecordFromLine(JSON.stringify(newStyle("1", ["en:france"], []))), null);
  // chuỗi en:vietnam nằm ở trường khác (không phải countries_tags) -> không nhận
  assert.equal(vnRecordFromLine(JSON.stringify({ code: "2", countries_tags: ["en:laos"], origins: "en:vietnam" })), null);
  assert.equal(vnRecordFromLine("{hỏng en:vietnam"), null);
  const r = vnRecordFromLine(JSON.stringify(newStyle("3", ["en:vietnam"], [["vi", "2"]], { product_name_vi: "Mì gói", generic_name_en: "Noodles", unique_scans_n: 7, completeness: 0.5, brands: "Acecook" })));
  assert.equal(r.code, "3");
  assert.deepEqual(r.names, { product_name: "Sản phẩm 3", product_name_vi: "Mì gói" });
  assert.deepEqual(r.generic, { generic_name_en: "Noodles" });
  assert.equal(r.unique_scans_n, 7);
  assert.deepEqual(r.fronts.map((f) => f.imgid), ["2"]);
});

test("filterVnStream đọc luồng JSONL nén gzip (đoạn giả), lọc VN", async () => {
  const lines = [
    newStyle("1", ["en:vietnam"], [["vi", "1"]]),
    newStyle("2", ["en:france"], [["fr", "1"]]),
    newStyle("3", ["en:vietnam", "en:japan"], []),
  ].map((p) => JSON.stringify(p)).join("\n") + "\n";
  const gz = zlib.gzipSync(lines);
  const { records, lines: n } = await filterVnStream(Readable.from([gz]).pipe(zlib.createGunzip()));
  assert.equal(n, 3);
  assert.deepEqual(records.map((r) => r.code), ["1", "3"]);
});

const rec = (code, scans, fronts, completeness = 0.5) => ({ code, unique_scans_n: scans, completeness, names: { product_name: code }, generic: {}, brands: "", fronts: fronts.map(([key, imgid]) => ({ key, imgid })) });

test("rankCompare: unique_scans_n giảm dần, không có thì sau; rồi completeness, rồi mã", () => {
  const a = [rec("c", null, [], 0.9), rec("b", 5, []), rec("a", 5, [], 0.9), rec("d", 10, [])];
  assert.deepEqual(a.sort(rankCompare).map((r) => r.code), ["d", "a", "b", "c"]);
});

test("selectIndexProducts: có mã thử dùng được, không ảnh trùng imgid front.jpg của mã thử, đủ n", () => {
  const records = [
    rec("T1", 100, [["front_vi", "1"], ["front_en", "2"]]), // mã thử dùng được: chỉ dùng ảnh trong testUsable
    rec("T2", 90, [["front_vi", "4"]]), // mã thử không dùng được: không vào chỉ mục
    rec("P1", 50, [["front_vi", "1"]]),
    rec("P2", 40, []), // không có ảnh mặt trước
    rec("P3", 30, [["front_vi", "2"]]),
    rec("P4", 20, [["front_vi", "1"]]),
  ];
  const sel = selectIndexProducts(records, {
    testCodes: ["T1", "T2"], testImgids: { T1: "1", T2: "4" }, testUsable: { T1: "2" }, n: 3,
  });
  assert.deepEqual(sel.map((s) => [s.code, s.imgid, s.test]), [["T1", "2", true], ["P1", "1", false], ["P3", "2", false]]);
  // mã thử có ảnh "dùng được" trùng imgid front.jpg (dữ liệu sai) -> bị bỏ
  const bad = selectIndexProducts(records, { testCodes: ["T1"], testImgids: { T1: "1" }, testUsable: { T1: "1" }, n: 5 });
  assert.ok(!bad.some((s) => s.code === "T1"));
});

test("looCandidates + filterLooPairs: ảnh truy vấn khác imgid, không nằm trong chỉ mục, loại cặp ≤ 24 bit", () => {
  const records = [rec("A", 9, [["front_vi", "1"], ["front_en", "3"]]), rec("B", 8, [["front_vi", "2"]]), rec("C", 7, [["front_vi", "5"], ["front_fr", "5"], ["front_en", "6"]]), rec("T", 6, [["front_vi", "1"], ["front_en", "2"]])];
  const selected = [{ code: "A", imgid: "1" }, { code: "B", imgid: "2" }, { code: "C", imgid: "5" }, { code: "T", imgid: "2", test: true }];
  const cands = looCandidates(selected, records, ["T"]);
  assert.deepEqual(cands, [{ code: "A", indexImgid: "1", queryImgid: "3" }, { code: "C", indexImgid: "5", queryImgid: "6" }]);
  const { pairs, dropped } = filterLooPairs(cands, { A: 24, C: 25 });
  assert.deepEqual(pairs.map((p) => p.code), ["C"]);
  assert.equal(dropped[0].reason, "gần trùng 24 bit");
  assert.equal(queryNotInIndex(pairs, selected), true);
  assert.equal(queryNotInIndex([{ code: "A", queryImgid: "1" }], selected), false);
  assert.equal(filterLooPairs(cands, { A: 30, C: 30 }, { limit: 1 }).pairs.length, 1);
});

test("BM25 trên danh mục giả nhỏ: từ hiếm thắng, không dấu, top k", () => {
  const docs = [
    { code: "1", text: "Mì Omachi khoai tây Omachi" },
    { code: "2", text: "Mì Hảo Hảo tôm chua cay" },
    { code: "3", text: "Bánh Oishi Pillows sô cô la" },
    { code: "4", text: "Mì Kokomi" },
  ];
  const idx = buildBm25(docs);
  // "mi" có ở 3 tài liệu: tài liệu 4 ngắn nhất nên đứng thứ 2 (b = 0,75)
  assert.deepEqual(bm25Search(idx, bm25Tokens("OMACHI mì"), 2).map((h) => h.code), ["1", "4"]);
  assert.equal(bm25Search(idx, ["pillows"], 5)[0].code, "3");
  assert.deepEqual(bm25Search(idx, ["khongco"], 5), []);
  // tf bão hòa: k1 = 1,2; tài liệu ngắn hơn được điểm cao hơn khi cùng tf (b = 0,75)
  const s = bm25Search(idx, ["mi"], 5);
  assert.equal(s[0].code, "4");
});

test("docText gộp mọi tên + thương hiệu + generic", () => {
  assert.equal(docText({ names: { product_name: "A", product_name_vi: "B" }, brands: "C", generic: { generic_name_en: "D" } }), "A B C D");
});

test("t1QueryFromLines: mọi dòng dùng được, không cắt 3 từ, bỏ số / đơn vị / cụm chung", () => {
  const lines = [{ text: "MÌ OMACHI", conf: 0.9 }, { text: "khoai tây hầm 80g", conf: 0.8 }, { text: "rác", conf: 0.2 }, { text: "Khối lượng tịnh 500 ml" }];
  assert.deepEqual(t1QueryFromLines(lines), ["mi", "omachi", "khoai", "tay", "ham"]);
  assert.deepEqual(t1QueryFromGemini({ thuong_hieu: "Oishi", ten: "Pillows", tu_khoa: ["snack", "sôcôla"] }), ["oishi", "pillows", "snack", "socola"]);
});

test("topK cosine lấy điểm cao nhất mỗi mã; RRF k = 60 gộp T1 + ảnh", () => {
  const idx = [{ code: "a", vec: l2norm([1, 0]) }, { code: "b", vec: l2norm([0, 1]) }, { code: "a", vec: l2norm([0.7, 0.7]) }];
  assert.deepEqual(topK(idx, l2norm([0.6, 0.8]), 2).map((x) => x.code), ["a", "b"]);
  assert.deepEqual(rrf([["x", "y"], ["y", "z"]]).map((x) => x.code), ["y", "x", "z"]);
});
