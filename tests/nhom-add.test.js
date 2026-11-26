// "Thêm vào kho nhóm", phần thuần (đợt kho-nhom vòng 7, src/nhom-add.js): điền sẵn từ Open Food Facts / chữ mặt sau,
// kiểm form đúng CHECK của server/kho-nhom.sql, đường dẫn ảnh, uuid.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nhomFormFromOff, nhomFormFromBackText, nhomRowFromForm, nhomImagePath, newUuid, NHOM_NAME_MAX, NHOM_INGREDIENTS_MAX
} from "../src/nhom-add.js";
import * as nhomAdd from "../src/nhom-add.js";
import { normalize, NO_NAME, ALLERGEN_KEYS } from "../src/off.js";
import { NHOM_NUTRIENT_KEYS } from "../src/front-nhom.js";

const UID = "0d0d0d0d-1111-4222-8333-444444444444";
const U2 = "a1b2c3d4-0000-4000-8000-000000000001";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const RAW = {
  code: "8934563163150", product_name_vi: "Mì <img src=x onerror=alert(1)>", brands: "Hảo Hảo", quantity: "75 g",
  ingredients_text_vi: "Bột mì, dầu cọ", allergens_tags: ["en:gluten", "en:soybeans", "en:abc"],
  traces_tags: ["en:milk", "en:eggs"],
  nutriments: { "energy-kcal_100g": 450, fat_100g: "17.5", proteins_100g: 0, salt_100g: -1, sugars_100g: null, la_100g: 5 }
};

describe("nhomFormFromOff", () => {
  test("điền sẵn từ sản phẩm đã normalize; dị ứng = allergens (KHÔNG traces); dinh dưỡng chỉ số ≥ 0", () => {
    const p = normalize(RAW, "8934563163150");
    assert.deepEqual(p.traceKeys, ["milk", "eggs"]); // OFF có traces…
    const f = nhomFormFromOff(p, "8934563163150");
    assert.deepEqual(f, {
      ten: "Mì <img src=x onerror=alert(1)>", thuong_hieu: "Hảo Hảo", khoi_luong: "75 g", ma_vach: "8934563163150",
      thanh_phan: "Bột mì, dầu cọ",
      dinh_duong: { "energy-kcal_100g": "450", fat_100g: "17,5", proteins_100g: "0" },
      di_ung: ["gluten", "soybeans"], nguon: "off"
    });
    assert.ok(!f.di_ung.includes("milk") && !f.di_ung.includes("eggs")); // …nhưng traces không vào di_ung
  });
  test("không tên (NO_NAME) → ten rỗng; mã sai → lấy p.code nếu đúng, không thì rỗng; đầu vào xấu không ném", () => {
    const p = normalize({ code: "12345678" }, "12345678");
    assert.equal(p.name, NO_NAME);
    assert.equal(nhomFormFromOff(p, "12345678").ten, "");
    assert.equal(nhomFormFromOff({ code: "87654321" }, "abc").ma_vach, "87654321");
    assert.equal(nhomFormFromOff({}, "123").ma_vach, "");
    for (const bad of [null, undefined, 5, "x", []]) {
      const f = nhomFormFromOff(bad, null);
      assert.deepEqual(f, { ten: "", thuong_hieu: "", khoi_luong: "", ma_vach: "", thanh_phan: "", dinh_duong: {}, di_ung: [], nguon: "off" });
    }
    assert.deepEqual(nhomFormFromOff({ allergenKeys: ["milk", "milk", "toString", 5, "gluten"] }).di_ung, ["gluten", "milk"]);
  });
  test("chữ dài hơn giới hạn SQL bị cắt đúng biên (đếm theo ký tự Unicode)", () => {
    const f = nhomFormFromOff({ name: "ă".repeat(250), brand: "😀".repeat(201), ingredients: "x".repeat(6000) }, "");
    assert.equal([...f.ten].length, NHOM_NAME_MAX);
    assert.equal([...f.thuong_hieu].length, NHOM_NAME_MAX);
    assert.equal(f.thanh_phan.length, NHOM_INGREDIENTS_MAX);
    assert.equal(nhomRowFromForm(f).ok, true);
  });
});

describe("nhomFormFromBackText", () => {
  test("chỉ thành phần + nguon ocr-mat-sau, KHÔNG BAO GIỜ có di_ung", () => {
    const items = [{ text: "Thành phần: bột mì, sữa, trứng" }, { text: "  " }, { text: "Có thể chứa đậu phộng" }, null, { text: 5 }];
    const f = nhomFormFromBackText(items);
    assert.deepEqual(f, { thanh_phan: "Thành phần: bột mì, sữa, trứng\nCó thể chứa đậu phộng", nguon: "ocr-mat-sau" });
    assert.deepEqual(Object.keys(f).sort(), ["nguon", "thanh_phan"]);
    for (const x of [[], null, "milk", [{ text: "milk gluten eggs" }], [{ text: "x", di_ung: ["milk"] }]]) {
      const r = nhomFormFromBackText(x);
      assert.ok(!Object.hasOwn(r, "di_ung"), JSON.stringify(x));
      assert.deepEqual(nhomRowFromForm({ ten: "A", ...r }).row.di_ung, []);
    }
  });
  test("cắt ≤ 5.000 ký tự", () => {
    const f = nhomFormFromBackText([{ text: "a".repeat(4000) }, { text: "b".repeat(4000) }]);
    assert.equal(f.thanh_phan.length, 5000);
    assert.ok(f.thanh_phan.startsWith("a".repeat(4000) + "\n"));
  });
});

describe("nhomRowFromForm (khớp CHECK của server/kho-nhom.sql)", () => {
  test("form tối thiểu → rỗng thành null, nguon mặc định tay, không có id / nguoi_them", () => {
    const r = nhomRowFromForm({ ten: "  Bánh  " });
    assert.deepEqual(r, { ok: true, row: { ten: "Bánh", thuong_hieu: null, khoi_luong: null, ma_vach: null, thanh_phan: null, dinh_duong: null, di_ung: [], nguon: "tay" } });
    assert.ok(!("id" in r.row) && !("nguoi_them" in r.row) && !("tao_luc" in r.row));
  });
  test("tên: bắt buộc, 200 qua / 201 lỗi", () => {
    for (const bad of ["", "   ", undefined, null, 5]) assert.deepEqual(Object.keys(nhomRowFromForm({ ten: bad }).errors), ["ten"]);
    assert.equal(nhomRowFromForm({ ten: "x".repeat(200) }).ok, true);
    assert.equal(nhomRowFromForm({ ten: "ồ".repeat(200) }).ok, true);
    assert.equal(nhomRowFromForm({ ten: "😀".repeat(200) }).ok, true); // 200 ký tự Unicode (400 đơn vị UTF-16)
    assert.match(nhomRowFromForm({ ten: "x".repeat(201) }).errors.ten, /200/);
    assert.equal(nhomRowFromForm({ ten: "  " + "x".repeat(200) + "  " }).ok, true); // bỏ khoảng trắng hai đầu trước khi đếm
  });
  test("thương hiệu / khối lượng: 200 qua, 201 lỗi, rỗng → null", () => {
    for (const k of ["thuong_hieu", "khoi_luong"]) {
      assert.equal(nhomRowFromForm({ ten: "A", [k]: "y".repeat(200) }).row[k], "y".repeat(200));
      assert.ok(nhomRowFromForm({ ten: "A", [k]: "y".repeat(201) }).errors[k]);
      assert.equal(nhomRowFromForm({ ten: "A", [k]: "   " }).row[k], null);
    }
  });
  test("mã vạch 8–14 chữ số hoặc rỗng", () => {
    // vòng 9: mã 8 / 14 số phải đúng số kiểm tra (12345678 / 12345678901234 sai số cuối → đổi sang mã đúng)
    for (const ok of ["96385074", "08934563163150", " 8934563163150 "]) assert.equal(nhomRowFromForm({ ten: "A", ma_vach: ok }).row.ma_vach, ok.trim());
    for (const bad of ["1234567", "123456789012345", "12345678a", "1234 567", "-12345678", "١٢٣٤٥٦٧٨"]) {
      assert.ok(nhomRowFromForm({ ten: "A", ma_vach: bad }).errors.ma_vach, bad);
    }
    assert.equal(nhomRowFromForm({ ten: "A", ma_vach: "" }).row.ma_vach, null);
    assert.equal(nhomRowFromForm({ ten: "A", ma_vach: " \t " }).row.ma_vach, null);
  });
  test("vòng 8 (gợi ý 4): mã vạch bỏ MỌI khoảng trắng trước khi kiểm (gõ / dán '8 934563 163150')", () => {
    for (const [inp, out] of [["8 934563 163150", "8934563163150"], ["9638 5074", "96385074"],["8934 563\t163150\n", "8934563163150"]]) {
      assert.equal(nhomRowFromForm({ ten: "A", ma_vach: inp }).row.ma_vach, out, inp);
    }
  });
  test("vòng 9 (NÊN SỬA 1): mã 8 / 12 / 13 / 14 số phải đúng số kiểm tra GTIN; mã 9–11 số giữ luật cũ", () => {
    const CHECK = "Mã vạch sai số cuối (số kiểm tra), xem lại từng số (hoặc để trống).";
    // dán "8 934563 163150" (15 ký tự) → đủ 13 số, không bị cắt
    assert.equal(nhomRowFromForm({ ten: "A", ma_vach: "8 934563 163150" }).row.ma_vach, "8934563163150");
    // bị maxlength cũ cắt còn "8 934563 16315" → "893456316315" (12 số) → lỗi số cuối, không lưu mã sai
    assert.deepEqual(nhomRowFromForm({ ten: "A", ma_vach: "8 934563 16315" }), { ok: false, errors: { ma_vach: CHECK } });
    const { gtinCheckOk } = nhomAdd;
    assert.equal(typeof gtinCheckOk, "function", "nhom-add.js phải export gtinCheckOk");
    assert.equal(nhomRowFromForm({ ten: "A", ma_vach: "893456316315" }).errors?.ma_vach, CHECK);
    for (const ok of ["96385074", "9638 5074", "8934563163150", "8993175532457", "036000291452", "08934563163150", "10012345678902"]) {
      const r = nhomRowFromForm({ ten: "A", ma_vach: ok });
      assert.equal(r.ok, true, ok);
      assert.equal(r.row.ma_vach, ok.replace(/\s+/g, ""), ok);
      assert.equal(gtinCheckOk(ok.replace(/\s+/g, "")), true, ok);
    }
    // đổi số cuối của mỗi mã đúng → lỗi số cuối (cả 9 số cuối khác)
    for (const good of ["96385074", "036000291452", "8934563163150", "8993175532457", "08934563163150"]) {
      for (let d = 0; d <= 9; d++) {
        const c = good.slice(0, -1) + d;
        if (c === good) continue;
        assert.equal(gtinCheckOk(c), false, c);
        assert.equal(nhomRowFromForm({ ten: "A", ma_vach: c }).errors?.ma_vach, CHECK, c);
      }
    }
    for (const bad of ["12345678", "12345678901234", "8934563163151", "8993175532450"]) {
      assert.equal(nhomRowFromForm({ ten: "A", ma_vach: bad }).errors?.ma_vach, CHECK, bad);
    }
    // 9–11 số: không có số kiểm tra chuẩn → luật cũ (chỉ cần chữ số)
    for (const ok of ["1234567890", "0000000001", "123456789", "12345678901"]) {
      assert.equal(gtinCheckOk(ok), true, ok);
      assert.equal(nhomRowFromForm({ ten: "A", ma_vach: ok }).row.ma_vach, ok, ok);
    }
    // sai độ dài / không phải chữ số → câu cũ, gtinCheckOk false
    for (const bad of ["1234567", "123456789012345", "9638507a", "١٢٣٤٥٦٧٨"]) {
      assert.equal(nhomRowFromForm({ ten: "A", ma_vach: bad }).errors.ma_vach, "Mã vạch cần 8–14 chữ số (hoặc để trống).", bad);
      assert.equal(gtinCheckOk(bad), false, bad);
    }
    for (const x of [null, undefined, 96385074, "", " 96385074"]) assert.equal(gtinCheckOk(x), false, String(x));
  });
  test("vòng 8 (gợi ý 5): số dinh dưỡng rất nhỏ / rất lớn không ra dạng 1e-7 / 1e21 (bỏ ô đó)", () => {
    const f = nhomFormFromOff({ nutriments: { fat_100g: 1e-7, sugars_100g: 1e21, proteins_100g: 0.000001, salt_100g: 2.5 } }, "");
    for (const v of Object.values(f.dinh_duong)) assert.doesNotMatch(v, /e/i, v);
    assert.deepEqual(f.dinh_duong, { proteins_100g: "0,000001", salt_100g: "2,5" });
    assert.equal(nhomRowFromForm({ ...f, ten: "A" }).ok, true);
  });
  test("thành phần: 5.000 qua, 5.001 lỗi, rỗng → null", () => {
    assert.equal(nhomRowFromForm({ ten: "A", thanh_phan: "z".repeat(5000) }).ok, true);
    assert.ok(nhomRowFromForm({ ten: "A", thanh_phan: "z".repeat(5001) }).errors.thanh_phan);
    assert.equal(nhomRowFromForm({ ten: "A", thanh_phan: "\n " }).row.thanh_phan, null);
  });
  test("dinh dưỡng: dấu phẩy thập phân, ô rỗng bỏ khóa, âm / chữ → lỗi ô đó, khóa lạ bỏ, hết khóa → null", () => {
    const r = nhomRowFromForm({ ten: "A", dinh_duong: { "energy-kcal_100g": "450", fat_100g: "1,5", sugars_100g: "", salt_100g: " 0.25 ", la_100g: "9", proteins_100g: 0 } });
    assert.deepEqual(r.row.dinh_duong, { "energy-kcal_100g": 450, fat_100g: 1.5, proteins_100g: 0, salt_100g: 0.25 });
    const bad = nhomRowFromForm({ ten: "A", dinh_duong: { fat_100g: "-1", salt_100g: "abc", fiber_100g: "1,2,3", proteins_100g: -2, sugars_100g: "1e3", "energy-kcal_100g": "9".repeat(400) } });
    assert.deepEqual(Object.keys(bad.errors).sort(), ["energy-kcal_100g", "fat_100g", "fiber_100g", "proteins_100g", "salt_100g", "sugars_100g"].sort());
    assert.equal(nhomRowFromForm({ ten: "A", dinh_duong: { fat_100g: "", la: "5" } }).row.dinh_duong, null);
    for (const x of [null, [], "x", 5]) assert.equal(nhomRowFromForm({ ten: "A", dinh_duong: x }).row.dinh_duong, null);
    assert.equal(nhomRowFromForm({ ten: "A", dinh_duong: { fat_100g: NaN } }).ok, false);
    assert.equal(nhomRowFromForm({ ten: "A", dinh_duong: { fat_100g: Infinity } }).ok, false);
    // mọi khóa đều thuộc NHOM_NUTRIENT_KEYS
    const all = Object.fromEntries(NHOM_NUTRIENT_KEYS.map((k) => [k, "1"]));
    assert.deepEqual(Object.keys(nhomRowFromForm({ ten: "A", dinh_duong: all }).row.dinh_duong), NHOM_NUTRIENT_KEYS);
  });
  test("dị ứng: chỉ 14 mã, bỏ trùng, mã lạ bỏ; nguon chỉ 3 giá trị", () => {
    const r = nhomRowFromForm({ ten: "A", di_ung: ["milk", "milk", "en:gluten", "constructor", "eggs", null, "traces"], nguon: "off" });
    assert.deepEqual(r.row.di_ung, ["milk", "eggs"]);
    assert.equal(r.row.nguon, "off");
    assert.deepEqual(nhomRowFromForm({ ten: "A", di_ung: [...ALLERGEN_KEYS].reverse() }).row.di_ung, ALLERGEN_KEYS);
    assert.deepEqual(nhomRowFromForm({ ten: "A", di_ung: "milk" }).row.di_ung, []);
    for (const n of ["ocr-mat-sau", "tay"]) assert.equal(nhomRowFromForm({ ten: "A", nguon: n }).row.nguon, n);
    for (const n of ["OFF", "khac", null, 1]) assert.equal(nhomRowFromForm({ ten: "A", nguon: n }).row.nguon, "tay");
  });
  test("nhiều lỗi cùng lúc → mọi ô đều có câu tiếng Việt, không có row", () => {
    const r = nhomRowFromForm({ ten: "", ma_vach: "1", thanh_phan: "x".repeat(5001), dinh_duong: { fat_100g: "x" } });
    assert.equal(r.ok, false);
    assert.equal(r.row, undefined);
    assert.deepEqual(Object.keys(r.errors).sort(), ["fat_100g", "ma_vach", "ten", "thanh_phan"]);
    for (const v of Object.values(r.errors)) assert.match(v, /[a-zà-ỹ]/i);
    for (const bad of [null, undefined, "x", 5]) assert.equal(nhomRowFromForm(bad).ok, false);
  });
});

describe("nhomImagePath / newUuid", () => {
  test("đường dẫn <uid>/<uuid>.jpg khớp CHECK duong_dan của SQL; sai dạng → ném", () => {
    const p = nhomImagePath(UID, U2);
    assert.equal(p, `${UID}/${U2}.jpg`);
    assert.match(p, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/);
    for (const [a, b] of [[UID.toUpperCase(), U2], [UID, U2.toUpperCase()], ["x", U2], [UID, ""], [null, U2], [UID, "../" + U2.slice(3)], [UID + "/", U2]]) {
      assert.throws(() => nhomImagePath(a, b), TypeError);
    }
  });
  test("newUuid: randomUUID nếu có; không có thì v4 từ getRandomValues; không có crypto → ném", () => {
    assert.match(newUuid(), UUID_RE);
    assert.equal(newUuid({ randomUUID: () => "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE" }), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    const fake = { getRandomValues: (a) => { a.fill(0xff); return a; } };
    assert.equal(newUuid(fake), "ffffffff-ffff-4fff-bfff-ffffffffffff");
    const zero = { getRandomValues: (a) => a };
    assert.equal(newUuid(zero), "00000000-0000-4000-8000-000000000000");
    const real = { getRandomValues: (a) => globalThis.crypto.getRandomValues(a) };
    const seen = new Set();
    for (let i = 0; i < 200; i++) { const u = newUuid(real); assert.match(u, UUID_RE); seen.add(u); }
    assert.equal(seen.size, 200);
    assert.throws(() => newUuid({}), /crypto/);
    assert.throws(() => newUuid(null), /crypto/);
  });
});
