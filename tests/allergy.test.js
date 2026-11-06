// Test hồ sơ dị ứng (giai đoạn 3) bằng node:test có sẵn trong Node, không cần thư viện.
// Chạy: npm test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { normalize, cleanAllergyProfile, matchAllergies, ALLERGEN_KEYS, ALLERGEN_VI } from "../src/off.js";
import {
  renderAllergyAlert, renderAllergyBox, renderAllergyOptions, renderProduct,
  ALLERGY_NO_DATA, ALLERGY_NEUTRAL, ALLERGY_ALERT_ID
} from "../src/render.js";
import { getAllergyProfile, setAllergyProfile } from "../src/storage.js";
import * as storageMod from "../src/storage.js"; // isAllergyProfileKey (thêm ở sua-cuoi): gọi qua storageMod để file vẫn chạy khi hàm chưa có

// Chữ không bao giờ được xuất hiện (thiếu dữ liệu không có nghĩa là an toàn).
const FORBIDDEN = ["an toàn", "không có chất gây dị ứng", "Không ghi nhận chất gây dị ứng"];
function assertNoForbidden(html, where) {
  const low = html.toLowerCase();
  for (const f of FORBIDDEN) assert.ok(!low.includes(f.toLowerCase()), `${where} chứa "${f}"`);
}

/** Sản phẩm thô tối thiểu (dạng API trả về). */
const raw = (extra = {}) => ({ code: "123", product_name: "Thử", ...extra });

describe("normalize: allergenKeys / traceKeys / hasAllergenData", () => {
  test("chỉ nhận tag 'en:' có trong 14 nhóm", () => {
    const p = normalize(raw({
      // "fr:gluten": khóa có thật nhưng không phải "en:" → không tính
      allergens_tags: ["en:milk", "fr:lait", "fr:gluten", "en:constructor", "en:abc", "en:soybeans"],
      traces_tags: ["en:peanuts", "fr:arachides", "en:toString"]
    }), "123");
    assert.deepEqual(p.allergenKeys, ["milk", "soybeans"]);
    assert.deepEqual(p.traceKeys, ["peanuts"]);
    assert.equal(p.hasAllergenData, true);
  });

  test("bỏ trùng, xếp theo thứ tự ALLERGEN_KEYS", () => {
    const p = normalize(raw({ allergens_tags: ["en:soybeans", "en:milk", "en:milk", "en:gluten"] }), "123");
    assert.deepEqual(p.allergenKeys, ["gluten", "milk", "soybeans"]);
  });

  test("mảng hỏng / không phải mảng → []", () => {
    for (const bad of [undefined, null, "en:milk", 5, { 0: "en:milk" }, [1, null, {}, ["en:milk"]]]) {
      const p = normalize(raw({ allergens_tags: bad, traces_tags: bad }), "123");
      assert.deepEqual(p.allergenKeys, [], `allergens_tags = ${JSON.stringify(bad)}`);
      assert.deepEqual(p.traceKeys, []);
      assert.equal(p.hasAllergenData, false);
    }
  });

  test("hasAllergenData: có tag (dù không phải 'en:') là có dữ liệu", () => {
    const p = normalize(raw({ allergens_tags: ["fr:lait"] }), "123");
    assert.equal(p.hasAllergenData, true);
    assert.deepEqual(p.allergenKeys, []);
    assert.deepEqual(normalize(raw({ allergens_tags: [] }), "123").hasAllergenData, false);
  });

  test("tag rỗng / chỉ khoảng trắng không tính là có dữ liệu", () => {
    for (const bad of [[""], ["  "], ["", " "]]) {
      const p = normalize(raw({ allergens_tags: bad, traces_tags: bad, additives_tags: bad }), "123");
      assert.equal(p.hasAllergenData, false, JSON.stringify(bad));
      assert.deepEqual(p.allergens, []);
      assert.deepEqual(p.allergenKeys, []);
      assert.deepEqual(p.traces, []);
      assert.deepEqual(p.additives, []);
    }
    const mixed = normalize(raw({ allergens_tags: ["", "en:milk"] }), "123");
    assert.equal(mixed.hasAllergenData, true);
    assert.deepEqual(mixed.allergenKeys, ["milk"]);
    assert.deepEqual(mixed.allergens, ["Sữa"]);
    assert.deepEqual(normalize(raw({ additives_tags: [""] }), "123").additives, []);
  });

  test("tag có khoảng trắng hai đầu → bỏ khoảng trắng rồi mới so (sua-cuoi, gd3-a (3))", () => {
    const p = normalize(raw({ allergens_tags: [" en:milk ", "	en:gluten"], traces_tags: ["en:peanuts  "], additives_tags: [" en:e621 "] }), "123");
    assert.deepEqual(p.allergenKeys, ["gluten", "milk"]);
    assert.deepEqual(p.allergens, ["Sữa", ALLERGEN_VI.gluten]); // giữ thứ tự gốc, không còn khoảng trắng
    assert.deepEqual(p.traceKeys, ["peanuts"]);
    assert.deepEqual(p.traces, ["Đậu phộng"]);
    assert.deepEqual(p.additives, ["E621"]);
    assert.equal(p.hasAllergenData, true);
  });

  test("tag chỉ có tiền tố ngôn ngữ ('en:', ' fr: ') → bỏ, không tính là có dữ liệu (sua-cuoi, gd3-a (3))", () => {
    for (const bad of [["en:"], [" en: "], ["fr:"], ["en:", " "]]) {
      const p = normalize(raw({ allergens_tags: bad, traces_tags: bad, additives_tags: bad }), "123");
      assert.equal(p.hasAllergenData, false, JSON.stringify(bad));
      assert.deepEqual(p.allergens, [], JSON.stringify(bad));
      assert.deepEqual(p.traces, []);
      assert.deepEqual(p.additives, []);
    }
  });

  test("tag 'none' (en:none, fr:none, none) → bỏ, không hiện chip 'none' (sua-cuoi, gd3-a (6))", () => {
    for (const bad of [["en:none"], ["fr:none"], ["none"], [" en:none "], ["en:NONE"]]) {
      const p = normalize(raw({ allergens_tags: bad, traces_tags: bad, additives_tags: bad }), "123");
      assert.equal(p.hasAllergenData, false, JSON.stringify(bad));
      assert.deepEqual(p.allergens, [], JSON.stringify(bad));
      assert.deepEqual(p.traces, []);
      assert.deepEqual(p.additives, []);
      assert.ok(!renderProduct(p).toLowerCase().includes(">none<"), JSON.stringify(bad));
    }
    const mixed = normalize(raw({ allergens_tags: ["en:none", "en:milk"], traces_tags: ["en:none"] }), "123");
    assert.deepEqual(mixed.allergenKeys, ["milk"]);
    assert.deepEqual(mixed.allergens, ["Sữa"]);
    assert.deepEqual(mixed.traces, []);
    assert.equal(mixed.hasAllergenData, true);
  });

  test("giữ nguyên allergens / traces cũ", () => {
    const p = normalize(raw({ allergens_tags: ["en:milk", "fr:lait"], traces_tags: ["en:peanuts"] }), "123");
    assert.deepEqual(p.allergens, ["Sữa", "lait"]);
    assert.deepEqual(p.traces, ["Đậu phộng"]);
  });
});

describe("cleanAllergyProfile", () => {
  test("không phải mảng → []", () => {
    for (const v of [null, undefined, "milk", '["milk"]', { milk: true }, 1]) {
      assert.deepEqual(cleanAllergyProfile(v), [], JSON.stringify(v));
    }
  });
  test("bỏ khóa lạ, 'constructor', không phải chuỗi, trùng; xếp theo thứ tự", () => {
    assert.deepEqual(
      cleanAllergyProfile(["peanuts", "constructor", "milk", "abc", 1, null, "milk", "en:milk", "gluten", "__proto__"]),
      ["gluten", "milk", "peanuts"]
    );
  });
  test("đủ 14 nhóm giữ nguyên thứ tự ALLERGEN_KEYS", () => {
    assert.equal(ALLERGEN_KEYS.length, 14);
    assert.deepEqual(cleanAllergyProfile([...ALLERGEN_KEYS].reverse()), ALLERGEN_KEYS);
  });
});

describe("matchAllergies", () => {
  const prod = (a, t) => normalize(raw({ allergens_tags: a, traces_tags: t }), "123");

  test("đỏ: nhóm trong hồ sơ có trong allergens", () => {
    assert.deepEqual(matchAllergies(prod(["en:milk", "en:soybeans"], []), ["milk", "eggs"]),
      { danger: ["milk"], traces: [], noData: false });
  });
  test("vàng: nhóm trong hồ sơ có trong traces", () => {
    assert.deepEqual(matchAllergies(prod(["en:gluten"], ["en:peanuts"]), ["peanuts"]),
      { danger: [], traces: ["peanuts"], noData: false });
  });
  test("milk ở cả 2 bên → chỉ đỏ", () => {
    assert.deepEqual(matchAllergies(prod(["en:milk", "en:soybeans"], ["en:peanuts", "en:milk"]), ["milk", "peanuts"]),
      { danger: ["milk"], traces: ["peanuts"], noData: false });
  });
  test("allergens rỗng + traces trùng → noData true và traces có", () => {
    assert.deepEqual(matchAllergies(prod([], ["en:peanuts"]), ["peanuts"]),
      { danger: [], traces: ["peanuts"], noData: true });
  });
  test("hồ sơ rỗng → không đỏ, không vàng", () => {
    assert.deepEqual(matchAllergies(prod(["en:milk"], ["en:peanuts"]), []),
      { danger: [], traces: [], noData: false });
  });
  test("hồ sơ hỏng được làm sạch trước khi so", () => {
    assert.deepEqual(matchAllergies(prod(["en:milk"], []), ["constructor", "milk", "milk"]).danger, ["milk"]);
  });
});

describe("renderAllergyAlert / renderProduct", () => {
  const prod = (a, t) => normalize(raw({ allergens_tags: a, traces_tags: t }), "123");
  const alertFor = (p, profile) => renderAllergyAlert(matchAllergies(p, profile), cleanAllergyProfile(profile).length);

  test("hồ sơ 0 nhóm → rỗng", () => {
    assert.equal(alertFor(prod(["en:milk"], []), []), "");
    assert.equal(alertFor(prod([], []), []), "");
  });

  test("đỏ: role=alert, chữ đúng, Sữa không nằm trong vàng", () => {
    const html = alertFor(prod(["en:milk", "en:soybeans"], ["en:peanuts", "en:milk"]), ["milk", "soybeans", "peanuts"]);
    assert.match(html, /class="allergy-alert danger" role="alert"/);
    assert.ok(html.includes("<strong>Cảnh báo dị ứng:</strong> có Sữa, Đậu nành (nhóm trong hồ sơ của bạn)"));
    assert.ok(html.includes("<strong>Có thể lẫn vết:</strong> Đậu phộng (nhóm trong hồ sơ của bạn)"));
    const traces = html.match(/<p class="allergy-alert traces">.*?<\/p>/)[0];
    assert.ok(!traces.includes("Sữa"));
    assert.ok(!html.includes(ALLERGY_NEUTRAL));
    assert.ok(!html.includes(ALLERGY_NO_DATA));
  });

  test("vàng + thiếu dữ liệu: allergens rỗng, traces trùng", () => {
    const html = alertFor(prod([], ["en:peanuts"]), ["peanuts"]);
    assert.ok(html.includes("Có thể lẫn vết:</strong> Đậu phộng (nhóm trong hồ sơ của bạn)"));
    assert.ok(html.includes(ALLERGY_NO_DATA));
    assert.ok(!html.includes(ALLERGY_NEUTRAL));
    assert.ok(!html.includes("danger"));
  });

  test("thiếu dữ liệu: không có allergens_tags", () => {
    const html = alertFor(normalize(raw(), "123"), ["milk"]);
    // Vòng 3: câu thiếu dữ liệu nằm trong khung riêng "allergy-alert nodata" (không role="alert").
    assert.equal(html, `<p class="allergy-alert nodata">${ALLERGY_NO_DATA}</p>`);
  });

  test("thiếu dữ liệu ra class 'nodata', không phải dòng chữ nhỏ 'allergy-note', không role=alert", () => {
    const html = alertFor(prod([], ["en:peanuts"]), ["peanuts", "milk"]);
    assert.ok(html.includes(`<p class="allergy-alert nodata">${ALLERGY_NO_DATA}</p>`));
    assert.ok(!html.includes("allergy-note"));
    const nodata = html.match(/<p class="allergy-alert nodata"[^>]*>/)[0];
    assert.ok(!nodata.includes("role="));
  });

  test("allergens_tags chỉ có tag rỗng + hồ sơ Sữa → câu thiếu dữ liệu, không dòng trung tính", () => {
    const p = prod([""], []);
    assert.deepEqual(matchAllergies(p, ["milk"]), { danger: [], traces: [], noData: true });
    const html = alertFor(p, ["milk"]);
    assert.equal(html, `<p class="allergy-alert nodata">${ALLERGY_NO_DATA}</p>`);
    assert.ok(!html.includes(ALLERGY_NEUTRAL));
    // Mục "Chất gây dị ứng" cũng ra câu thiếu dữ liệu, không chip trống.
    const card = renderProduct(p);
    assert.ok(card.includes(`<p class="empty">${ALLERGY_NO_DATA}</p>`));
    assert.ok(!card.includes('<span class="chip "></span>'));
  });

  test("trung tính: có dữ liệu, không trùng hồ sơ", () => {
    const html = alertFor(prod(["en:gluten"], []), ["milk"]);
    assert.equal(html, `<p class="allergy-note">${ALLERGY_NEUTRAL}</p>`);
    assert.ok(!html.includes("allergy-alert"));
    assert.ok(!html.includes("nodata"));
  });

  test("câu đúng nguyên văn", () => {
    assert.equal(ALLERGY_NO_DATA, "Open Food Facts chưa có dữ liệu dị ứng cho sản phẩm này, hãy đọc nhãn trên bao bì.");
    assert.equal(ALLERGY_NEUTRAL, "Dữ liệu Open Food Facts không ghi nhóm nào trong hồ sơ của bạn. "
      + "Dữ liệu có thể thiếu hoặc ghi khác tên, hãy đọc nhãn trên bao bì.");
  });

  test("renderAllergyBox có id riêng", () => {
    const html = renderAllergyBox({ danger: [], traces: [], noData: true }, 0);
    assert.equal(html, `<div id="${ALLERGY_ALERT_ID}" class="allergy-box"></div>`);
  });

  test("mục 'Chất gây dị ứng': thiếu dữ liệu thì có câu thiếu dữ liệu (cả khi hồ sơ rỗng)", () => {
    const html = renderProduct(normalize(raw(), "123"));
    assert.ok(html.includes(`<p class="empty">${ALLERGY_NO_DATA}</p>`));
    const withTraces = renderProduct(prod([], ["en:peanuts"]));
    assert.ok(withTraces.includes(ALLERGY_NO_DATA));
    assert.ok(withTraces.includes("Có thể lẫn vết: Đậu phộng"));
    const withData = renderProduct(prod(["en:milk"], []));
    assert.ok(!withData.includes(ALLERGY_NO_DATA));
    assert.ok(withData.includes('<span class="chip ">Sữa</span>'));
  });

  test("không bao giờ có 'an toàn' / 'không có chất gây dị ứng' (mọi tổ hợp)", () => {
    // [""], ["  "], ["", "en:milk"]: tag rỗng (sua-cuoi, gd3-a (1)) cũng không bao giờ ra chữ "an toàn"
    const tagSets = [undefined, [], ["en:milk"], ["en:gluten"], ["fr:lait"], ["en:milk", "en:peanuts"], [""], ["  "], ["", "en:milk"]];
    const profiles = [[], ["milk"], ["peanuts"], ["gluten", "milk", "peanuts"], [...ALLERGEN_KEYS]];
    let n = 0;
    for (const a of tagSets) for (const t of tagSets) {
      const p = normalize(raw({ allergens_tags: a, traces_tags: t }), "123");
      assertNoForbidden(renderProduct(p), `renderProduct(${JSON.stringify(a)}, ${JSON.stringify(t)})`);
      for (const prof of profiles) {
        assertNoForbidden(alertFor(p, prof), `alert(${JSON.stringify(a)}, ${JSON.stringify(t)}, ${prof})`);
        n++;
      }
    }
    assert.equal(n, tagSets.length * tagSets.length * profiles.length);
    assertNoForbidden(renderAllergyOptions(ALLERGEN_KEYS), "renderAllergyOptions");
  });

  test("tag độc được escape", () => {
    const bad = "fr:<img src=x onerror=alert(1)>";
    const p = normalize(raw({ product_name: "<img src=x onerror=alert(1)>", allergens_tags: [bad], traces_tags: [bad] }), "123");
    const html = renderProduct(p) + alertFor(p, ["milk"]);
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });

  test("renderAllergyOptions: 14 ô tick có label, tick đúng ô đã chọn", () => {
    const html = renderAllergyOptions(["milk", "peanuts"]);
    assert.equal((html.match(/<label class="allergy-option"><input type="checkbox" name="allergy"/g) || []).length, 14);
    assert.equal((html.match(/ checked>/g) || []).length, 2);
    assert.ok(html.includes('value="milk" checked> Sữa</label>'));
    assert.ok(html.includes('value="peanuts" checked> Đậu phộng</label>'));
    for (const k of ALLERGEN_KEYS) assert.ok(html.includes(`value="${k}"`) && html.includes(`> ${ALLERGEN_VI[k]}</label>`), k);
  });
});

describe("storage: get/setAllergyProfile với localStorage giả", () => {
  const KEY = "qmv-allergy-profile";
  let store, throwOnSet, original;

  before(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    // localStorage giả tự viết (object thường), gắn vào globalThis; configurable để gỡ lại sau test.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k) => (Object.hasOwn(store, k) ? store[k] : null),
        setItem: (k, v) => { if (throwOnSet) throw new Error("QuotaExceededError"); store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      }
    });
  });
  after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });

  const reset = (init = {}) => { store = { ...init }; throwOnSet = false; };

  test("chưa có gì → []", () => {
    reset();
    assert.deepEqual(getAllergyProfile(), []);
  });

  test("dữ liệu hỏng → [] hoặc phần hợp lệ", () => {
    for (const [v, want] of [
      ["không phải json", []], ['{"x":1}', []], ["null", []], ['"milk"', []], ["5", []],
      ['["milk","constructor","milk"]', ["milk"]], ['["peanuts","milk",2]', ["milk", "peanuts"]]
    ]) {
      reset({ [KEY]: v });
      assert.deepEqual(getAllergyProfile(), want, v);
    }
  });

  test("ghi được → true, lưu bản đã làm sạch", () => {
    reset();
    assert.equal(setAllergyProfile(["peanuts", "milk", "constructor", "milk"]), true);
    assert.equal(store[KEY], '["milk","peanuts"]');
    assert.deepEqual(getAllergyProfile(), ["milk", "peanuts"]);
  });

  test("setItem ném lỗi → false, không ném ra ngoài", () => {
    reset({ [KEY]: '["gluten"]' });
    throwOnSet = true;
    assert.equal(setAllergyProfile(["milk"]), false);
    assert.equal(store[KEY], '["gluten"]');
  });
});

describe("isAllergyProfileKey: sự kiện storage của tab khác có đụng hồ sơ dị ứng không (sua-cuoi, gd3-a (5))", () => {
  const isKey = (k) => {
    assert.equal(typeof storageMod.isAllergyProfileKey, "function", "src/storage.js phải export isAllergyProfileKey");
    return storageMod.isAllergyProfileKey(k);
  };
  test("đúng khóa hồ sơ → true", () => assert.equal(isKey("qmv-allergy-profile"), true));
  test("null (tab kia xóa sạch localStorage) → true", () => assert.equal(isKey(null), true));
  test("khóa khác (tủ đồ, lịch sử, backup, gần giống) → false", () => {
    for (const k of ["qmv-pantry", "qmv-history", "qmv-pantry-backup", "qmv-allergy-profile-x", "", undefined]) assert.equal(isKey(k), false, String(k));
  });
});

describe("tag(): bỏ tiền tố ngôn ngữ giống tags() (2–3 chữ, không phân biệt hoa thường; sua-cuoi vòng 3)", () => {
  test("allergens_tags / traces_tags 'EN:milk' → chip giống 'en:milk' (Sữa), không hiện 'EN:milk'", () => {
    const upper = normalize(raw({ allergens_tags: ["EN:milk"], traces_tags: ["EN:peanuts"] }), "123");
    const lower = normalize(raw({ allergens_tags: ["en:milk"], traces_tags: ["en:peanuts"] }), "123");
    assert.deepEqual(upper.allergens, lower.allergens);
    assert.deepEqual(upper.traces, lower.traces);
    assert.deepEqual(upper.allergens, [ALLERGEN_VI.milk]);
    const html = renderProduct(upper);
    assert.ok(html.includes(ALLERGEN_VI.milk), "chip phải hiện tên tiếng Việt");
    assert.ok(!html.includes("EN:milk") && !html.includes("EN:peanuts"), "không hiện tiền tố EN:");
  });

  test("tiền tố 3 chữ và phụ gia viết hoa cũng bỏ tiền tố", () => {
    const p = normalize(raw({ allergens_tags: ["fil:milk"], additives_tags: ["EN:e330"] }), "123");
    assert.deepEqual(p.allergens, [ALLERGEN_VI.milk]);
    assert.deepEqual(p.additives, ["E330"]);
  });
});
