// Đợt chup-mat (vòng 1): trường ảnh mặt trước "img" của danh mục (xuat-danh-muc.mjs frontImg + danh-muc-vn.json).
// Chạy: cd test-ocr/chup-mat-do && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const mod = await import("../xuat-danh-muc.mjs");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const catalogFile = path.join(HERE, "..", "..", "..", "public", "chup-mat-do", "danh-muc-vn.json");

test("frontImg: ưu tiên front_vi, rồi front_en, rồi ảnh front_<ngôn ngữ> đầu tiên; giá trị = khóa.rev", () => {
  assert.equal(typeof mod.frontImg, "function", "xuat-danh-muc.mjs phải export frontImg");
  const f = mod.frontImg;
  assert.equal(f([{ key: "front_fr", imgid: "1", rev: "4" }, { key: "front_vi", imgid: "3", rev: "10" }]), "front_vi.10");
  assert.equal(f([{ key: "front_fr", imgid: "1", rev: "4" }, { key: "front_en", imgid: "3", rev: "8" }]), "front_en.8");
  assert.equal(f([{ key: "front_fr", imgid: "1", rev: "3" }, { key: "front_de", imgid: "2", rev: "9" }]), "front_fr.3");
  // khóa "front" trần (kiểu cũ): Open Food Facts không còn trong selected_images (đối chiếu 8301011307914) → bỏ qua
  assert.equal(f([{ key: "front", imgid: "1", rev: "3" }, { key: "front_pt", imgid: "1", rev: "3" }]), "front_pt.3");
  assert.equal(f([{ key: "front", imgid: "1", rev: "3" }]), "");
});

test("frontImg: không có ảnh / dữ liệu lạ → '' (bỏ trường)", () => {
  const f = mod.frontImg;
  for (const x of [undefined, null, [], "x", [{}], [{ key: "front_vi" }], [{ key: "front_vi", rev: "1a" }],
    [{ key: "front_vi.3", rev: "3" }], [{ key: "ingredients_vi", rev: "3" }], [null]]) {
    assert.equal(f(x), "", JSON.stringify(x));
  }
});

test("danh-muc-vn.json: trường img (nếu có) đúng dạng khóa.rev, phần lớn sản phẩm có ảnh, gzip ≤ 60 KB", () => {
  const raw = fs.readFileSync(catalogFile);
  const cat = JSON.parse(raw.toString("utf8"));
  const withImg = cat.products.filter((p) => "img" in p);
  for (const p of withImg) assert.match(p.img, /^front_[a-z]{2,3}\.\d{1,6}$/, p.code);
  assert.ok(withImg.length >= 700, `có ảnh: ${withImg.length}`);
  assert.match(cat.meta.truong, /img/);
  assert.ok(zlib.gzipSync(raw, { level: 9 }).length <= 60 * 1024);
});
