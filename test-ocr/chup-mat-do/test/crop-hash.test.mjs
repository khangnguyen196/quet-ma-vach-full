// So ảnh ít phụ thuộc khung cắt (vòng 2, review vòng 1): cùng một ảnh, khác khung cắt, phải bị coi là trùng.
import test from "node:test";
import assert from "node:assert/strict";
import {
  dHashFromGray, hamming, resizeGray, pHashFromGray, cropHashSet, compareHashSets, excludeTestImgids,
  productImageList, chooseIndexImageV2, HASH_DUP, HASH_SUSPECT, CROP_LEVELS,
} from "../lib.mjs";

// Ảnh tổng hợp nhỏ (không cần file ảnh): vài vệt sáng tối + sóng, giống ảnh bao bì có mảng màu.
function synth(w, h, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 12 }, () => ({ x: rnd() * w, y: rnd() * h, r: (0.05 + rnd() * 0.25) * w, v: rnd() * 255 - 128 }));
  const g = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 128 + 30 * Math.sin(x / 9) * Math.cos(y / 13);
      for (const b of blobs) v += b.v * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r * b.r));
      g[y * w + x] = Math.max(0, Math.min(255, v));
    }
  }
  return g;
}

/** Cắt vùng giữa tỉ lệ p của ảnh xám (như OFF cắt front_xx từ ảnh gốc). */
function cropCenter(g, w, h, p) {
  const cw = Math.round(w * p);
  const ch = Math.round(h * p);
  const x0 = Math.round((w - cw) / 2);
  const y0 = Math.round((h - ch) / 2);
  const out = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out.push(g[(y0 + y) * w + x0 + x]);
  return { g: out, w: cw, h: ch };
}

const W = 240;
const H = 200;
const A = synth(W, H, 7);
const B = cropCenter(A, W, H, 0.8);
const OTHER = synth(W, H, 99);

test("cùng ảnh khác khung cắt (cắt 80%): cách so vòng 1 (dHash cả khung) KHÔNG bắt được, cách mới coi là trùng", () => {
  // cách vòng 1: dHash 9×8 của cả khung
  const oldDist = hamming(dHashFromGray(resizeGray(A, W, H, 9, 8)), dHashFromGray(resizeGray(B.g, B.w, B.h, 9, 8)));
  assert.ok(oldDist > HASH_DUP, `vòng 1 lọt: cách ${oldDist} bit > ${HASH_DUP}`);
  // cách vòng 2: nhiều mức cắt, dHash + pHash, lấy nhỏ nhất
  const r = compareHashSets(cropHashSet(A, W, H), cropHashSet(B.g, B.w, B.h));
  assert.equal(r.verdict, "trùng", JSON.stringify(r));
  assert.ok(r.distance <= HASH_DUP);
});

test("ảnh khác hẳn không bị coi là trùng", () => {
  const r = compareHashSets(cropHashSet(A, W, H), cropHashSet(OTHER, W, H));
  assert.notEqual(r.verdict, "trùng", JSON.stringify(r));
  assert.ok(r.distance > HASH_DUP);
});

test("pHash: cùng ảnh -> 0 bit; cần đúng 32×32 điểm", () => {
  const g = resizeGray(A, W, H, 32, 32);
  assert.equal(hamming(pHashFromGray(g), pHashFromGray(g)), 0);
  assert.match(pHashFromGray(g), /^[0-9a-f]{16}$/);
  assert.throws(() => pHashFromGray([1, 2, 3]));
});

test("resizeGray: trung bình vùng, cắt vùng giữa", () => {
  // ảnh 4×2: trái 0, phải 100 -> thu về 2×1 = [0, 100]; cắt 50% giữa -> [0, 100] của 2 cột giữa
  const g = [0, 0, 100, 100, 0, 0, 100, 100];
  assert.deepEqual(resizeGray(g, 4, 2, 2, 1), [0, 100]);
  assert.deepEqual(resizeGray(g, 4, 2, 1, 1), [50]);
  assert.deepEqual(resizeGray(g, 4, 2, 2, 1, 0.5), [0, 100]);
  assert.throws(() => resizeGray([1], 4, 2, 1, 1));
});

test("compareHashSets: ngưỡng trùng / nghi ngờ / khác", () => {
  assert.equal(HASH_DUP, 10);
  assert.equal(HASH_SUSPECT, 24);
  assert.deepEqual(CROP_LEVELS, [1, 0.9, 0.8, 0.7]);
  const z = "0000000000000000";
  const set = (d, p) => [{ crop: 1, d, p }];
  assert.equal(compareHashSets(set(z, z), set("00000000000003ff", "ffffffffffffffff")).verdict, "trùng"); // d 10
  assert.equal(compareHashSets(set(z, z), set("0000000000000fff", "ffffffffffffffff")).verdict, "nghi ngờ"); // d 12
  assert.equal(compareHashSets(set(z, z), set("00000001ffffffff", "ffffffffffffffff")).verdict, "khác"); // d 33
  assert.equal(compareHashSets([], set(z, z)), null);
});

test("excludeTestImgids: bỏ ảnh gốc và mọi bản cắt front_xx trỏ về imgid của front.jpg", () => {
  const product = { images: { 1: {}, 3: {}, 4: {}, front_vi: { imgid: "3" }, front_en: { imgid: 3 }, front_fr: { imgid: "4" }, ingredients_vi: { imgid: "1" } } };
  const images = [...productImageList("8934572260543", product), { code: "999", key: "3", imgid: "3" }];
  const { kept, removed } = excludeTestImgids(images, { 8934572260543: "3" });
  assert.deepEqual(removed.map((x) => x.key).sort(), ["3", "front_en", "front_vi"]);
  assert.ok(kept.some((x) => x.code === "999" && x.imgid === "3"), "mã khác cùng số imgid vẫn giữ");
  assert.ok(kept.some((x) => x.key === "front_fr"));
  // Map + nhiều imgid
  assert.equal(excludeTestImgids(images, new Map([["8934572260543", ["3", "4"]]])).removed.length, 5);
});

test("chooseIndexImageV2: lý do loại đúng từng loại, nghi ngờ phải xem tay", () => {
  const z = "0000000000000000";
  const f = "ffffffffffffffff";
  const set = (d) => [{ crop: 1, d, p: f }];
  const testSet = [{ crop: 1, d: z, p: z }];
  const fronts = [
    { key: "front_vi", imgid: "3" },
    { key: "front_en", imgid: "5" },
    { key: "front_fr", imgid: "6" },
    { key: "front_de", imgid: "7" },
  ];
  const sets = { 5: set("00000000000000ff") /* 8 bit */, 6: set("00000000000fffff") /* 20 bit */, 7: set("0000000fffffffff") /* 36 */ };
  const r = chooseIndexImageV2(fronts, "3", sets, testSet);
  assert.deepEqual(r.rejected.map((x) => x.reason), ["cùng imgid", "gần trùng 8 bit", "nghi ngờ 20 bit, chưa xem tay"]);
  assert.equal(r.chosen.imgid, "7");
  const r2 = chooseIndexImageV2(fronts, "3", sets, testSet, { 6: { verdict: "trùng", note: "cùng vệt bóng" } });
  assert.equal(r2.rejected[2].reason, "xem tay: cùng tấm chụp");
  const r3 = chooseIndexImageV2(fronts, "3", sets, testSet, { 6: { verdict: "khác", note: "góc chụp khác" } });
  assert.equal(r3.chosen.imgid, "6");
  assert.equal(r3.chosen.manual.verdict, "khác");
});
