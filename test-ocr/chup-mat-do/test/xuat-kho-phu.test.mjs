// Test xuat-kho-phu.mjs (đợt tu-dong vòng 6, P5): sinh public/chup-mat-do/kho-phu-893.json từ bản ghi mo-rong.json.
// Dữ liệu giả nhỏ, không đọc file lớn, không ghi public/.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mod from "../xuat-kho-phu.mjs";
import { ODBL_URL, NGUON_VN_893 } from "../xuat-danh-muc.mjs";

const rec = (code, name, extra = {}) => ({ code, names: name ? { product_name: name } : {}, generic: {}, brands: "Hãng", fronts: [{ key: "front_en", imgid: "1", rev: "7" }], ...extra });

test("buildKhoPhu: chỉ mã 13 số đầu 893 có tên, chưa có trong danh mục; định dạng như danh mục (meta ODbL)", () => {
  const records = [
    rec("8934588752117", "Soda Chanh - Diet 7Up"),
    rec("8930000000001", "Có trong danh mục"),
    rec("8930000000002", ""), // không tên
    rec("0052603065054", "Không phải 893"),
    rec("893000000003", "Mã 12 số"),
    rec("8934588752117", "Trùng mã (bỏ)"),
  ];
  const { products, json } = mod.buildKhoPhu(records, [{ code: "8930000000001" }]);
  assert.deepEqual(products.map((p) => p.code), ["8934588752117"]);
  assert.deepEqual(products[0], { code: "8934588752117", name: "Soda Chanh - Diet 7Up", brand: "Hãng", img: "front_en.7", text: "Soda Chanh - Diet 7Up Hãng" });
  const body = JSON.parse(json);
  assert.equal(body.meta.giayPhepUrl, ODBL_URL);
  assert.equal(body.meta.nguon, NGUON_VN_893);
  assert.equal(body.meta.soSanPham, 1);
  assert.equal(body.meta.ngayXuat, mod.KHO_PHU_DATE);
  assert.deepEqual(body.products, products);
  assert.ok(json.endsWith("\n]}\n"));
});

test("buildKhoPhu: chạy 2 lần trùng từng byte (ngày cố định, không phụ thuộc giờ máy)", () => {
  const records = [rec("8930000000009", "B"), rec("8930000000008", "A")];
  const a = mod.buildKhoPhu(records, []).json;
  const b = mod.buildKhoPhu(JSON.parse(JSON.stringify(records)), []).json;
  assert.equal(a, b);
  assert.equal(mod.KHO_PHU_DATE, "2026-11-15");
  assert.equal(mod.OUT_REL, "public/chup-mat-do/kho-phu-893.json");
});
