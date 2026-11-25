// Kho sản phẩm của nhóm, phần thuần (đợt kho-nhom vòng 6): src/front-nhom.js + src/nhom-data.js (client supabase GIẢ).
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NHOM_THRESHOLD, nhomCandidates, nhomOutcome, nhomNutrition, NHOM_NUTRIENT_KEYS, nhomProductView, isNhomId
} from "../src/front-nhom.js";
import { fetchNhomProduct, nhomImageUrl, NHOM_COLUMNS, NHOM_SIGN_SECONDS } from "../src/nhom-data.js";
import { photoOutcome, photoMessage, afterResultScroll } from "../src/front-photo.js";
import { NUTRIENT_ROWS, ALLERGEN_KEYS, matchAllergies } from "../src/off.js";

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M = (n, extra = {}) => ({ san_pham_id: ID(n), ten: `Món ${n}`, thuong_hieu: "Hãng A", ma_vach: null, diem: 0.5, ...extra });
const OFF = (code) => ({ code, name: `SP ${code}`, brand: "B", img: "", source: "t1", vn: true, score: 1 });

describe("NHOM_THRESHOLD + nhomOutcome", () => {
  const open = photoOutcome([OFF("8934563163150"), OFF("8934563651138"), OFF("8993175532457")]);
  const none = photoOutcome([]);

  test("NHOM_THRESHOLD = Infinity (đo vòng 5 KHÔNG ĐẠT)", () => {
    assert.equal(NHOM_THRESHOLD, Infinity);
  });

  test("Infinity: không bao giờ ra openNhom, kể cả diem 1", () => {
    for (const o of [open, none]) {
      for (const d of [1, 0.9999, 0.5, -1]) {
        const r = nhomOutcome(o, [M(1, { diem: d })]);
        assert.equal(r.kind, o.kind);
        assert.equal(r.nhomTop, null);
        assert.deepEqual(r.nhom, [M(1, { diem: d })]);
      }
    }
    assert.equal(nhomOutcome(open, [M(1, { diem: 1 })], { threshold: Infinity }).kind, "open");
  });

  test("threshold 0,8: diem 0,9 → openNhom (mục 1 OFF xuống gợi ý khác, ≤ 4); diem 0,79 → giữ kind cũ", () => {
    const nhom = [M(1, { diem: 0.9 }), M(2, { diem: 0.85 }), M(3, { diem: 0.2 })];
    const r = nhomOutcome(open, nhom, { threshold: 0.8 });
    assert.deepEqual(r, { kind: "openNhom", top: null, nhomTop: nhom[0], others: [open.top, ...open.others].slice(0, 4), nhom: nhom.slice(1) });
    assert.equal(r.others[0].code, "8934563163150");
    const r2 = nhomOutcome(none, nhom, { threshold: 0.8 });
    assert.equal(r2.kind, "openNhom");
    assert.deepEqual(r2.others, []);
    const five = photoOutcome([1, 2, 3, 4, 5].map((i) => OFF(`893456316315${i}`)));
    assert.equal(nhomOutcome(five, nhom, { threshold: 0.8 }).others.length, 4);
    // bằng ngưỡng: tự mở; dưới ngưỡng: giữ
    assert.equal(nhomOutcome(open, [M(1, { diem: 0.8 })], { threshold: 0.8 }).kind, "openNhom");
    const keep = nhomOutcome(open, [M(1, { diem: 0.79 })], { threshold: 0.8 });
    assert.equal(keep.kind, "open");
    assert.equal(keep.top, open.top);
  });

  test("nhom rỗng / không phải mảng → outcome GIỐNG HỆT đầu vào + nhom: [], nhomTop: null", () => {
    for (const o of [open, none]) {
      for (const n of [[], undefined, null, "x", { a: 1 }]) {
        assert.deepEqual(nhomOutcome(o, n), { ...o, nhom: [], nhomTop: null });
      }
    }
    // không sửa đầu vào
    const copy = structuredClone(open);
    nhomOutcome(open, [M(1)], { threshold: 0 });
    assert.deepEqual(open, copy);
  });

  test("> 3 món → chỉ xét 3 đầu", () => {
    const r = nhomOutcome(open, [M(1), M(2), M(3), M(4)]);
    assert.equal(r.nhom.length, 3);
  });

  test("không bỏ trùng món nhóm với mục OFF cùng mã", () => {
    const r = nhomOutcome(open, [M(1, { ma_vach: "8934563163150" })]);
    assert.equal(r.top.code, "8934563163150");
    assert.equal(r.nhom[0].ma_vach, "8934563163150");
  });

  test("threshold không phải số → ném lỗi nêu tên tham số; Infinity hợp lệ", () => {
    for (const bad of [NaN, "0.8", null, {}, true]) {
      assert.throws(() => nhomOutcome(open, [M(1)], { threshold: bad }), /threshold/);
    }
    assert.doesNotThrow(() => nhomOutcome(open, [M(1)], { threshold: Infinity }));
  });

  test("photoMessage / afterResultScroll nhận kind openNhom như open", () => {
    assert.deepEqual(photoMessage({ kind: "openNhom" }), photoMessage({ kind: "open" }));
    assert.equal(afterResultScroll({ kind: "openNhom" }), "confirm");
    assert.equal(afterResultScroll({ kind: "openNhom", fromRetry: true }), null);
  });
});

describe("nhomCandidates", () => {
  test("hợp lệ: cắt khoảng trắng, thuong_hieu rỗng → null, ma_vach sai → null, sắp diem giảm dần (bằng điểm giữ thứ tự)", () => {
    const r = nhomCandidates({ nhom: [
      M(1, { diem: 0.5, ten: "  Bánh  ", thuong_hieu: "  " }),
      M(2, { diem: 0.9, ma_vach: "12345" }),
      M(3, { diem: 0.5, ma_vach: "8934563163150" }),
    ] });
    assert.deepEqual(r, [
      { san_pham_id: ID(2), ten: "Món 2", thuong_hieu: "Hãng A", ma_vach: null, diem: 0.9 },
      { san_pham_id: ID(1), ten: "Bánh", thuong_hieu: null, ma_vach: null, diem: 0.5 },
      { san_pham_id: ID(3), ten: "Món 3", thuong_hieu: "Hãng A", ma_vach: "8934563163150", diem: 0.5 },
    ]);
  });

  test("không có khóa / không phải mảng / body lạ → []", () => {
    for (const b of [undefined, null, "x", 5, {}, { nhom: null }, { nhom: {} }, { nhom: "abc" }, []]) {
      assert.deepEqual(nhomCandidates(b), []);
    }
  });

  test("mục xấu bị bỏ đúng", () => {
    const bad = [
      null, "x", 3, [M(1)],
      M(1, { san_pham_id: "khong-phai-uuid" }),
      M(1, { san_pham_id: "A" + ID(1).slice(1) }),
      M(1, { san_pham_id: 5 }),
      { ten: "Thiếu id", diem: 0.5 },
      M(1, { ten: undefined }),
      M(1, { ten: "" }),
      M(1, { ten: "   " }),
      M(1, { ten: "a".repeat(201) }),
      M(1, { ten: 12 }),
      M(1, { thuong_hieu: 7 }),
      M(1, { thuong_hieu: "b".repeat(201) }),
      M(1, { diem: NaN }),
      M(1, { diem: 2 }),
      M(1, { diem: -1.0001 }),
      M(1, { diem: "0.9" }),
      M(1, { diem: Infinity }),
      M(1, { diem: undefined }),
    ];
    for (const b of bad) assert.deepEqual(nhomCandidates({ nhom: [b] }), [], JSON.stringify(b));
    // 200 ký tự (đếm theo ký tự, có dấu) vẫn nhận; biên -1 / 1 nhận
    const ten200 = "ệ".repeat(200);
    assert.equal(nhomCandidates({ nhom: [M(1, { ten: ten200 })] })[0].ten, ten200);
    assert.equal(nhomCandidates({ nhom: [M(1, { diem: 1 }), M(2, { diem: -1 })] }).length, 2);
  });

  test("> 3 mục → chỉ xét 3 phần tử ĐẦU (mục xấu trong 3 đầu không được bù bằng mục 4)", () => {
    assert.deepEqual(nhomCandidates({ nhom: [M(1), M(2), M(3), M(4)] }).map((x) => x.san_pham_id), [ID(1), ID(2), ID(3)]);
    assert.deepEqual(nhomCandidates({ nhom: [M(1), M(2, { diem: "x" }), M(3), M(4)] }).map((x) => x.san_pham_id), [ID(1), ID(3)]);
  });

  test("trùng san_pham_id → giữ mục đầu", () => {
    const r = nhomCandidates({ nhom: [M(1, { ten: "Đầu", diem: 0.4 }), M(1, { ten: "Sau", diem: 0.9 })] });
    assert.deepEqual(r.map((x) => x.ten), ["Đầu"]);
  });

  test("isNhomId", () => {
    assert.equal(isNhomId(ID(1)), true);
    for (const v of ["", "A" + ID(1).slice(1), ID(1) + "0", null, 1]) assert.equal(isNhomId(v), false);
  });
});

describe("dinh_duong + nhomProductView", () => {
  test("NHOM_NUTRIENT_KEYS = đúng khóa NUTRIENT_ROWS của off.js", () => {
    assert.deepEqual([...NHOM_NUTRIENT_KEYS], NUTRIENT_ROWS.map((r) => r[0]));
  });

  test("nhomNutrition: chỉ khóa biết, số hữu hạn ≥ 0; khóa lạ / giá trị sai bị bỏ", () => {
    assert.deepEqual(nhomNutrition({
      "energy-kcal_100g": 450, fat_100g: 0, proteins_100g: 7.5, salt_100g: "0.9", sugars_100g: -1, fiber_100g: NaN,
      carbohydrates_100g: null, "saturated-fat_100g": Infinity, "energy-kj_100g": 1800, __proto__x: 1, toString: 3
    }), { "energy-kcal_100g": 450, fat_100g: 0, proteins_100g: 7.5 });
    for (const v of [null, undefined, "x", 5, [1, 2]]) assert.deepEqual(nhomNutrition(v), {});
  });

  test("nhomProductView: làm sạch, trường trống → \"\", dị ứng 14 giá trị (không 'en:'), lạ bị bỏ", () => {
    const v = nhomProductView({
      id: ID(7), ten: "  Bánh quy  ", thuong_hieu: "", khoi_luong: "200 g", ma_vach: "12ab", thanh_phan: null,
      dinh_duong: { proteins_100g: 6, bad: 1 }, di_ung: ["milk", "en:gluten", "abc", "gluten", 5, "constructor", "milk"],
      nguon: "off", tao_luc: "2026-11-25T20:00:00+00:00"
    });
    assert.equal(v.id, ID(7));
    assert.equal(v.name, "Bánh quy");
    assert.equal(v.brand, "");
    assert.equal(v.quantity, "200 g");
    assert.equal(v.code, "");
    assert.equal(v.ingredients, "");
    assert.deepEqual(v.nutriments, { proteins_100g: 6 });
    assert.equal(v.hasNutriments, true);
    assert.deepEqual(v.allergenKeys, ["gluten", "milk"]);
    assert.deepEqual(v.allergens, ["Gluten", "Sữa"]);
    assert.deepEqual(v.traceKeys, []);
    assert.equal(v.hasAllergenData, true);
    assert.equal(v.source, "Lấy từ Open Food Facts lúc thêm");
    assert.equal(v.createdAt, "26/11/2026"); // 20:00 UTC = 3:00 sáng hôm sau giờ Việt Nam
    assert.equal(v.nhom, true);
    // so được với hồ sơ dị ứng như sản phẩm OFF
    assert.deepEqual(matchAllergies(v, ["milk", "eggs"]), { danger: ["milk"], traces: [], noData: false });
  });

  test("nhomProductView: dòng rỗng / lạ → mọi trường trống, không ném", () => {
    for (const row of [null, undefined, {}, "x", { di_ung: "milk", dinh_duong: "x", nguon: "la", tao_luc: "hôm qua" }]) {
      const v = nhomProductView(row);
      assert.equal(v.name, "");
      assert.deepEqual(v.allergenKeys, []);
      assert.equal(v.hasAllergenData, false);
      assert.equal(v.hasNutriments, false);
      assert.equal(v.source, "");
      assert.equal(v.createdAt, "");
    }
    // đủ 14 nhóm của CHECK SQL đều nhận
    assert.deepEqual(nhomProductView({ di_ung: [...ALLERGEN_KEYS].reverse() }).allergenKeys, ALLERGEN_KEYS);
  });
});

// ---- src/nhom-data.js với client supabase GIẢ ----
function fakeClient({ product, productError, images, imagesError, sign, throwAt } = {}) {
  const calls = [];
  const query = (table) => {
    const q = { table, ops: [] };
    calls.push(q);
    const chain = {
      select(cols) { q.ops.push(["select", cols]); if (throwAt === "select") throw new Error("hỏng"); return chain; },
      eq(c, v) { q.ops.push(["eq", c, v]); return chain; },
      order(c, o) { q.ops.push(["order", c, o]); return chain; },
      limit(n) {
        q.ops.push(["limit", n]);
        return Promise.resolve(imagesError ? { data: null, error: imagesError } : { data: images ?? [], error: null });
      },
      maybeSingle() {
        q.ops.push(["maybeSingle"]);
        if (throwAt === "maybeSingle") return Promise.reject(new Error("mạng"));
        return Promise.resolve(productError ? { data: null, error: productError } : { data: product ?? null, error: null });
      },
    };
    return chain;
  };
  return {
    calls,
    from: query,
    storage: {
      from(bucket) {
        return {
          createSignedUrl(path, sec) {
            calls.push({ bucket, sign: [path, sec] });
            if (throwAt === "sign") return Promise.reject(new Error("x"));
            return Promise.resolve(sign ?? { data: { signedUrl: `https://abc.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null });
          }
        };
      }
    }
  };
}

describe("nhom-data.js (client giả, chỉ đọc)", () => {
  const ROW = { id: ID(1), ten: "Bánh", di_ung: [] };
  const PATH = `${ID(9)}/${ID(10)}.jpg`;

  test("fetchNhomProduct: select đúng cột, eq id, maybeSingle → { ok, row }", async () => {
    const c = fakeClient({ product: ROW });
    assert.deepEqual(await fetchNhomProduct(c, ID(1)), { ok: true, row: ROW });
    assert.deepEqual(c.calls[0], { table: "nhom_san_pham", ops: [["select", NHOM_COLUMNS], ["eq", "id", ID(1)], ["maybeSingle"]] });
    assert.doesNotMatch(NHOM_COLUMNS, /nguoi_them/);
  });

  test("fetchNhomProduct: lỗi / không có dòng / id sai / client hỏng → { ok: false }, không ném", async () => {
    assert.deepEqual(await fetchNhomProduct(fakeClient({ productError: { message: "500" } }), ID(1)), { ok: false });
    assert.deepEqual(await fetchNhomProduct(fakeClient({ product: null }), ID(1)), { ok: false });
    assert.deepEqual(await fetchNhomProduct(fakeClient({ product: { ...ROW, id: ID(2) } }), ID(1)), { ok: false });
    assert.deepEqual(await fetchNhomProduct(fakeClient({ product: [ROW] }), ID(1)), { ok: false });
    assert.deepEqual(await fetchNhomProduct(fakeClient({ throwAt: "maybeSingle" }), ID(1)), { ok: false });
    assert.deepEqual(await fetchNhomProduct(fakeClient({ throwAt: "select" }), ID(1)), { ok: false });
    assert.deepEqual(await fetchNhomProduct(null, ID(1)), { ok: false });
    const c = fakeClient({ product: ROW });
    assert.deepEqual(await fetchNhomProduct(c, "x' or 1=1"), { ok: false });
    assert.equal(c.calls.length, 0); // id sai: không gọi
  });

  test("nhomImageUrl: ảnh đầu (tao_luc tăng dần, limit 1) → URL ký 600 giây", async () => {
    const c = fakeClient({ images: [{ duong_dan: PATH }] });
    const url = await nhomImageUrl(c, ID(1));
    assert.equal(url, `https://abc.supabase.co/storage/v1/object/sign/nhom-anh/${PATH}?token=t`);
    assert.deepEqual(c.calls[0], { table: "nhom_anh", ops: [["select", "duong_dan"], ["eq", "san_pham_id", ID(1)], ["order", "tao_luc", { ascending: true }], ["limit", 1]] });
    assert.deepEqual(c.calls[1], { bucket: "nhom-anh", sign: [PATH, 600] });
    assert.equal(NHOM_SIGN_SECONDS, 600);
  });

  test("nhomImageUrl: không ảnh / lỗi / đường dẫn lạ / ký lỗi → null", async () => {
    assert.equal(await nhomImageUrl(fakeClient({ images: [] }), ID(1)), null);
    assert.equal(await nhomImageUrl(fakeClient({ imagesError: { message: "x" } }), ID(1)), null);
    assert.equal(await nhomImageUrl(fakeClient({ images: [{ duong_dan: "../../x.jpg" }] }), ID(1)), null);
    assert.equal(await nhomImageUrl(fakeClient({ images: [{ duong_dan: PATH }], sign: { data: null, error: { message: "x" } } }), ID(1)), null);
    assert.equal(await nhomImageUrl(fakeClient({ images: [{ duong_dan: PATH }], throwAt: "sign" }), ID(1)), null);
    assert.equal(await nhomImageUrl(fakeClient({ images: [{ duong_dan: PATH }] }), "x"), null);
    assert.equal(await nhomImageUrl({}, ID(1)), null);
  });

  test("nhom-data.js chỉ đọc: không có insert / update / upsert / delete / upload / remove", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/nhom-data.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /\.(insert|update|upsert|delete|upload|remove|rpc)\s*\(/);
  });
});
