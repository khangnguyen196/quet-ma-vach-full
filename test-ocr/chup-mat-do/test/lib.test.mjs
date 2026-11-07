import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText, isNoiseWord, lineKeywords, usableLine, strategyS1, strategyS2, strategyS3, findBrands,
  allStrategies, DEFAULT_STRATEGY, MAX_WORDS, sameCode, rankOf, textMatch, brandMatch, scoreHits, summarize, rrf,
  median, maxOf, imgidFromUrl, frontImages, dHashFromGray, hamming, chooseIndexImage, DHASH_NEAR, parseCsv, confOf, CONF_SCALE,
} from "../lib.mjs";

test("normalizeText: bỏ dấu, đ -> d, viết thường, gộp khoảng trắng", () => {
  assert.equal(normalizeText("  Mì  Khoai-Tây ĐẬU  "), "mi khoai tay dau");
  assert.equal(normalizeText("Nước mắm (500ml)"), "nuoc mam 500ml");
  assert.equal(normalizeText(null), "");
});

test("isNoiseWord: số, số + đơn vị, từ chung, rác không nguyên âm", () => {
  for (const w of ["80", "80g", "500ml", "g", "ml", "va", "rrr", "x", "nsx"]) assert.equal(isNoiseWord(w), true, w);
  for (const w of ["omachi", "mi", "bo", "ham", "7up", "cafe"]) assert.equal(isNoiseWord(w), false, w);
});

test("lineKeywords: bỏ cụm 'khối lượng tịnh', đơn vị, số", () => {
  assert.deepEqual(lineKeywords("Khối lượng tịnh: 80g"), []);
  assert.deepEqual(lineKeywords("Mì khoai tây OMACHI 80 g"), ["mi", "khoai", "tay", "omachi"]);
  assert.deepEqual(lineKeywords("Sản xuất tại Việt Nam"), []);
});

// Vòng 2: thang độ tin truyền theo công cụ (CONF_SCALE), không đoán từ giá trị nữa.
test("usableLine: đủ 3 chữ cái, độ tin ≥ 0,5 theo thang của công cụ", () => {
  assert.equal(usableLine({ text: "ab" }), false);
  assert.equal(usableLine({ text: "abc" }), true);
  assert.equal(usableLine({ text: "omachi", conf: 0.4 }, CONF_SCALE.paddlejs), false);
  assert.equal(usableLine({ text: "omachi", conf: 40 }, CONF_SCALE.tesseractjs), false);
  assert.equal(usableLine({ text: "omachi", conf: 91 }, CONF_SCALE.tesseractjs), true);
  assert.ok(Math.abs(confOf({ conf: 0.9 }, 100) - 0.009) < 1e-12, "thang 0–100 không đoán theo giá trị");
  assert.equal(confOf({ text: "x" }), null);
});

const LINES = [
  { text: "Khối lượng tịnh 80g", h: 10 },
  { text: "Mì khoai tây", h: 30 },
  { text: "OMACHI", h: 80 },
  { text: "xốt bò hầm", h: 25 },
];

test("S1: dòng chữ cao nhất trước", () => {
  assert.deepEqual(strategyS1(LINES, 3).words, ["omachi", "mi", "khoai"]);
});

test("S1: không có chiều cao thì giữ thứ tự đọc và ghi chú", () => {
  const r = strategyS1(LINES.map(({ text }) => ({ text })), 3);
  assert.deepEqual(r.words, ["mi", "khoai", "tay"]);
  assert.match(r.note, /không có chiều cao/);
});

test("S2 (mặc định): thứ tự đọc, lọc nhiễu, tối đa MAX_WORDS, bỏ trùng", () => {
  assert.equal(DEFAULT_STRATEGY, "S2");
  assert.deepEqual(strategyS2(LINES).words, ["mi", "khoai", "tay"].slice(0, MAX_WORDS));
  assert.deepEqual(strategyS2([{ text: "mi mi mi" }, { text: "bò hầm" }, { text: "bo" }], 5).words, ["mi", "bo", "ham"]);
});

test("findBrands + S3: thương hiệu từ danh sách OFF đứng đầu", () => {
  const brands = ["Omachi", "Vifon", "Bò", "A"];
  assert.deepEqual(findBrands(LINES, brands), ["omachi"]);
  const r = strategyS3(LINES, brands, 3);
  assert.deepEqual(r.words, ["omachi", "mi", "khoai"]);
  assert.match(r.note, /omachi/);
  assert.match(strategyS3(LINES, ["Vifon"], 3).note, /không thấy/);
});

test("findBrands: thương hiệu phải khớp nguyên từ", () => {
  assert.deepEqual(findBrands([{ text: "Omachilicious" }], ["Omachi"]), []);
});

test("allStrategies trả đủ S1, S2, S3", () => {
  assert.deepEqual(Object.keys(allStrategies(LINES, [])), ["S1", "S2", "S3"]);
});

test("sameCode / rankOf: bỏ số 0 đầu, chỉ xét 5 đầu", () => {
  assert.equal(sameCode("08936017368111", "8936017368111"), true);
  assert.equal(sameCode("", ""), false);
  assert.equal(rankOf(["1", "2", "8936017368111"], "8936017368111"), 3);
  assert.equal(rankOf(["1", "2", "3", "4", "5", "8936017368111"], "8936017368111"), null);
  assert.equal(rankOf([], "1"), null);
});

// Luật vòng 2 (chặt hơn vòng 1): mẫu số là số từ có nghĩa của ĐÁP ÁN (tham số thứ 2), bỏ từ chỉ loại hàng,
// cần ≥ 1 từ chung dài ≥ 3 chữ cái, bỏ luật "chứa nhau".
test("textMatch: tỉ lệ trên từ có nghĩa của đáp án ≥ 0,5 và có từ chung ≥ 3 chữ cái", () => {
  assert.equal(textMatch("Mì Omachi xốt bò hầm 80g", "Omachi xốt bò hầm"), true);
  // vòng 1 coi là đúng (chứa nhau); vòng 2: 1/6 từ có nghĩa của đáp án -> sai
  assert.equal(textMatch("Omachi", "Mì khoai tây Omachi xốt Bò hầm"), false);
  // "mì" là từ chỉ loại hàng: đáp án "Mì Koreno" còn 1 từ "koreno" -> trùng 1/1
  assert.equal(textMatch("Koreno vị ngon nguyên bản", "Mì Koreno"), true);
  // vòng 1 coi là đúng (1/2 từ của chuỗi ngắn); vòng 2: 1/4 từ có nghĩa của đáp án -> sai
  assert.equal(textMatch("Mì Koreno", "Koreno vị ngon nguyên bản"), false);
  assert.equal(textMatch("Hảo Hảo tôm chua cay", "Omachi xốt bò hầm"), false);
  assert.equal(textMatch("Omachilicious", "Omachi"), false);
  assert.equal(textMatch("", "abc"), null);
});

test("textMatch: 3 ca phải SAI (review vòng 1)", () => {
  // (1) như prompt ghi: tên rác có ký tự điều khiển so với tên Omachi
  assert.equal(textMatch("\u001aCA \u001aCA", "Mì khoai tây Omachi xốt Bò hầm"), false);
  // (1b) ca thật trong 1b-webkit (tham khảo): cùng tên rác, đáp án 8936017367107 -> vòng 1 chấm ĐÚNG nhờ từ "ca"
  assert.equal(textMatch("\u001aCA \u001aCA", "Tam Thái Tử Nhất Ca"), false);
  // (2) chỉ có từ chỉ loại hàng + 2/6 từ có nghĩa
  assert.equal(textMatch("Mi khoai Tay", "Mì khoai tây Omachi xốt Bò hầm"), false);
  // (3) chỉ chung từ chỉ loại hàng "mì"
  assert.equal(textMatch("Mì Hảo Hảo", "Mì Koreno"), false);
});

test("textMatch: đáp án không có từ ≥ 3 chữ cái thì phải trùng hết từ của đáp án", () => {
  assert.equal(textMatch("7UP chanh", "7UP"), true);
  assert.equal(textMatch("TH true MILK", "TH"), true);
  assert.equal(textMatch("Nước uống có gaz 7UP", "Nước uống có gaz 7UP"), true);
});

test("brandMatch: OFF có nhiều thương hiệu cách dấu phẩy; đáp án trống -> null", () => {
  assert.equal(brandMatch("Masan, Omachi", "Omachi"), true);
  assert.equal(brandMatch("Acecook", "Omachi"), false);
  assert.equal(brandMatch("", "Omachi"), false);
  assert.equal(brandMatch("Omachi", ""), null);
});

test("scoreHits: vị trí, top1, top5, tên + thương hiệu của kết quả đầu", () => {
  const truth = { code: "8936017368111", ten: "Mì khoai tây Omachi xốt Bò hầm", thuong_hieu: "Omachi" };
  const hits = [
    { code: "1", name: "Omachi xốt bò hầm", brands: "Omachi" },
    { code: "8936017368111", name: "x", brands: "y" },
  ];
  assert.deepEqual(scoreHits(hits, truth), { rank: 2, top1: false, inTop5: true, nameOk: true, brandOk: true });
  assert.deepEqual(scoreHits([], truth), { rank: null, top1: false, inTop5: false, nameOk: false, brandOk: false });
  assert.equal(scoreHits([], { code: "1", ten: "", thuong_hieu: "" }).brandOk, null);
});

test("summarize: đếm đúng, chỉ đếm ảnh chấm được tên / thương hiệu", () => {
  const s = summarize([
    { top1: true, inTop5: true, nameOk: true, brandOk: null },
    { top1: false, inTop5: true, nameOk: false, brandOk: true },
    { top1: false, inTop5: false, nameOk: null, brandOk: false },
  ]);
  assert.deepEqual(s, { n: 3, top1: 1, top5: 2, nameOk: 1, nameN: 2, brandOk: 1, brandN: 2 });
});

test("rrf: cộng 1/(k+vị trí), mã có ở nhiều danh sách lên đầu", () => {
  const r = rrf([["a", "b", "c"], ["b", "d"]], 60);
  assert.equal(r[0].code, "b");
  assert.ok(Math.abs(r[0].score - (1 / 62 + 1 / 61)) < 1e-12);
  assert.deepEqual(r.map((x) => x.code), ["b", "a", "d", "c"]);
  assert.deepEqual(rrf([]), []);
});

test("median / maxOf", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(maxOf([1, 5, 2]), 5);
  assert.equal(maxOf([]), null);
});

test("imgidFromUrl: ảnh gốc OFF", () => {
  assert.equal(imgidFromUrl("https://images.openfoodfacts.org/images/products/893/457/226/0543/3.jpg"), "3");
  assert.equal(imgidFromUrl("https://images.openfoodfacts.org/images/products/893/457/226/0543/12.400.jpg"), "12");
  assert.equal(imgidFromUrl("https://images.openfoodfacts.org/images/products/893/457/226/0543/front_vi.5.400.jpg"), null);
});

test("frontImages: chỉ front / front_xx có imgid, vi rồi en trước", () => {
  const p = { images: { 1: {}, front_en: { imgid: "2", rev: "7" }, front_vi: { imgid: 3, rev: 9 }, front_fr: { imgid: "4" }, ingredients_vi: { imgid: "5" }, front_xx: {} } };
  assert.deepEqual(frontImages(p).map((f) => [f.key, f.imgid]), [["front_vi", "3"], ["front_en", "2"], ["front_fr", "4"]]);
  assert.deepEqual(frontImages({}), []);
});

test("dHashFromGray + hamming", () => {
  const up = Array.from({ length: 72 }, (_, i) => i % 9); // tăng dần trái -> phải: mọi bit 0
  const down = Array.from({ length: 72 }, (_, i) => 8 - (i % 9)); // giảm dần: mọi bit 1
  assert.equal(dHashFromGray(up), "0000000000000000");
  assert.equal(dHashFromGray(down), "ffffffffffffffff");
  assert.equal(hamming("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(hamming("000000000000000f", "0000000000000000"), 4);
  assert.throws(() => dHashFromGray([1, 2]));
});

test("chooseIndexImage: bỏ cùng imgid, bỏ gần trùng (≤ ngưỡng), lấy ứng viên đầu còn lại", () => {
  const fronts = [
    { key: "front_vi", imgid: "3" },
    { key: "front_en", imgid: "7" },
    { key: "front_fr", imgid: "9" },
  ];
  const test0 = "0000000000000000";
  const hashes = { 7: "00000000000003ff" /* cách 10 bit */, 9: "0000000000000fff" /* cách 12 bit */ };
  const r = chooseIndexImage(fronts, "3", hashes, test0);
  assert.equal(DHASH_NEAR, 10);
  assert.deepEqual(r.chosen, { key: "front_fr", imgid: "9", distance: 12 });
  assert.deepEqual(r.rejected.map((x) => x.reason), ["cùng imgid với front.jpg", "gần trùng front.jpg"]);
  assert.equal(chooseIndexImage([{ key: "front_vi", imgid: "3" }], "3", {}, test0).chosen, null);
  assert.equal(chooseIndexImage([{ key: "front_vi", imgid: "8" }], "3", {}, test0).rejected[0].reason, "không có mã băm");
});

test("parseCsv: nháy kép, dấu phẩy trong ô, CRLF, BOM", () => {
  const rows = parseCsv('\uFEFFcode,ten,bao_quan\r\n1,"Mì ""A""","khô, mát"\r\n\r\n2,B,\n');
  assert.deepEqual(rows, [
    { code: "1", ten: 'Mì "A"', bao_quan: "khô, mát" },
    { code: "2", ten: "B", bao_quan: "" },
  ]);
  assert.deepEqual(parseCsv(""), []);
});

test("chooseIndexImage: front_xx khác ngôn ngữ cùng imgid với front.jpg đều ghi lý do 'cùng imgid'", () => {
  const r = chooseIndexImage([{ key: "front_vi", imgid: "1" }, { key: "front_en", imgid: "1" }], "1", {}, "0000000000000000");
  assert.equal(r.chosen, null);
  assert.deepEqual(r.rejected.map((x) => x.reason), ["cùng imgid với front.jpg", "cùng imgid với front.jpg"]);
});
