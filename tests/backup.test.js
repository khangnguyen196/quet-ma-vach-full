// Test xuất / nhập tủ đồ (src/backup.js + importPantryData của storage.js) với localStorage giả.
// Chạy: npm test
import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  buildExport, exportFileName, parseImport, mergePantry, mergeProfile,
  IMPORT_MAX_CHARS, IMPORT_MAX_ITEMS
} from "../src/backup.js";
import { importPantryData, getPantry, getAllergyProfile, addToPantry } from "../src/storage.js";
import { NAME_MAX } from "../src/pantry.js";
import { renderPantry, renderImportSummary } from "../src/render.js";

const item = (id, extra = {}) => ({
  id, code: "8934563163150", name: "Mì " + id, brand: "Acecook", expiresOn: "2026-12-01", qty: 2, addedAt: 1762400000000, ...extra
});
const fileOf = (extra = {}) => JSON.stringify({
  app: "quet-ma-vach-full", kind: "pantry-export", version: 1, exportedAt: "2026-11-06T00:00:00.000Z",
  pantry: [item("a1")], allergyProfile: ["milk"], ...extra
});

/** parseImport phải ném ImportError có đúng câu tiếng Việt. */
function assertImportError(text, message) {
  assert.throws(() => parseImport(text), (e) => {
    assert.equal(e.name, "ImportError");
    assert.equal(e.message, message);
    return true;
  });
}

describe("buildExport / exportFileName", () => {
  test("đúng khung file, giờ ISO, làm sạch tủ đồ và hồ sơ", () => {
    const now = new Date("2026-11-06T08:30:00.000Z");
    const out = buildExport([item("a1"), { id: "", expiresOn: "x" }], ["peanuts", "milk", "abc"], now);
    assert.equal(out.app, "quet-ma-vach-full");
    assert.equal(out.kind, "pantry-export");
    assert.equal(out.version, 1);
    assert.equal(out.exportedAt, "2026-11-06T08:30:00.000Z");
    assert.deepEqual(out.pantry, [item("a1")]);
    assert.deepEqual(out.allergyProfile, ["milk", "peanuts"]);
  });

  test("tên file theo ngày giờ máy", () => {
    assert.equal(exportFileName(new Date(2026, 0, 5, 23, 59)), "tu-do-2026-01-05.json");
    assert.equal(exportFileName(new Date(2026, 10, 6)), "tu-do-2026-11-06.json");
  });
});

describe("parseImport", () => {
  test("xuất rồi nhập ra giống (tủ đồ + hồ sơ)", () => {
    const pantry = [item("a1"), item("b2", { name: "Sữa", code: "", brand: "", qty: 1, addedAt: null })];
    const text = JSON.stringify(buildExport(pantry, ["gluten", "milk"], new Date()));
    const r = parseImport(text);
    assert.deepEqual(r.pantry, pantry);
    assert.deepEqual(r.allergyProfile, ["gluten", "milk"]);
    assert.equal(r.skipped, 0);
  });

  test("không phải JSON / sai app / sai kind / sai version → lỗi tiếng Việt", () => {
    assertImportError("không phải json", "File không phải JSON hợp lệ.");
    assertImportError("", "File không phải JSON hợp lệ.");
    assertImportError(undefined, "File không phải JSON hợp lệ.");
    const notApp = "File này không phải file xuất tủ đồ của app Quét mã vạch đồ ăn.";
    assertImportError("null", notApp);
    assertImportError("[]", notApp);
    assertImportError('"chuỗi"', notApp);
    assertImportError(fileOf({ app: "app-khac" }), notApp);
    assertImportError(fileOf({ app: undefined }), notApp);
    assertImportError(fileOf({ kind: "history-export" }), notApp);
    const badVersion = "Phiên bản file không được hỗ trợ (app chỉ đọc phiên bản 1).";
    assertImportError(fileOf({ version: 2 }), badVersion);
    assertImportError(fileOf({ version: "1" }), badVersion);
    assertImportError(fileOf({ version: undefined }), badVersion);
    assertImportError(fileOf({ pantry: { a: 1 } }), "File hỏng: không có danh sách tủ đồ.");
  });

  test("quá 1.000.000 ký tự → 'File quá lớn'", () => {
    assert.equal(IMPORT_MAX_CHARS, 1_000_000);
    const base = fileOf();
    const pad = " ".repeat(IMPORT_MAX_CHARS - base.length);
    assert.equal(parseImport(base + pad).pantry.length, 1); // đúng 1.000.000 ký tự: vẫn nhận
    assertImportError(base + pad + " ", "File quá lớn (tối đa 1 MB).");
  });

  test("quá 1.000 món → lỗi; đúng 1.000 món vẫn nhận", () => {
    assert.equal(IMPORT_MAX_ITEMS, 1000);
    const many = (n) => Array.from({ length: n }, (_, i) => item("id" + i));
    assert.equal(parseImport(fileOf({ pantry: many(1000) })).pantry.length, 1000);
    assertImportError(fileOf({ pantry: many(1001) }), "File có quá nhiều món (tối đa 1.000 món).");
  });

  test("món hỏng bị bỏ và đếm đúng; trường sai kiểu được làm sạch", () => {
    const r = parseImport(fileOf({
      pantry: [
        item("ok1"),
        null, 5, "chuỗi", [],
        { ...item("x"), id: "" },
        { ...item("x"), id: 7 },
        { ...item("x"), expiresOn: "2026-02-31" },
        { ...item("x"), expiresOn: "06/11/2026" },
        { ...item("x"), expiresOn: undefined },
        item("ok2", { qty: "abc", name: 5, extra: "thừa" })
      ]
    }));
    assert.equal(r.skipped, 9);
    assert.deepEqual(r.pantry.map((x) => x.id), ["ok1", "ok2"]);
    assert.deepEqual(r.pantry[1], { ...item("ok2"), qty: 1, name: "" });
  });

  test("id trùng trong file: giữ món đầu, món sau tính là bỏ", () => {
    const r = parseImport(fileOf({ pantry: [item("a", { name: "Đầu" }), item("b"), item("a", { name: "Sau" })] }));
    assert.deepEqual(r.pantry.map((x) => x.name), ["Đầu", "Mì b"]);
    assert.equal(r.skipped, 1);
  });

  test("câu tóm tắt trước khi nhập đếm cả món hỏng lẫn món trùng", () => {
    const r = parseImport(fileOf({ pantry: [item("a"), item("a"), null, item("b")], allergyProfile: ["milk", "gluten"] }));
    const html = renderImportSummary(r);
    assert.ok(html.includes('<p class="import-summary">File có 2 món, 2 nhóm dị ứng, bỏ 2 món hỏng hoặc trùng.</p>'));
    for (const mode of ["merge", "replace", "cancel"]) assert.ok(html.includes(`data-import="${mode}"`));
  });

  test("tên quá dài cắt về NAME_MAX; hồ sơ hỏng được làm sạch", () => {
    const r = parseImport(fileOf({ pantry: [item("a", { name: "x".repeat(500) })], allergyProfile: ["milk", "constructor", 1, "milk", "eggs"] }));
    assert.equal(r.pantry[0].name.length, NAME_MAX);
    assert.deepEqual(r.allergyProfile, ["milk", "eggs"]);
    assert.deepEqual(parseImport(fileOf({ allergyProfile: "milk" })).allergyProfile, []);
    assert.deepEqual(parseImport(fileOf({ allergyProfile: undefined })).allergyProfile, []);
  });
});

describe("mergePantry / mergeProfile", () => {
  test("gộp: id trùng giữ món trên máy, thêm món mới, đếm đúng, không sửa mảng gốc", () => {
    const local = [item("a", { name: "Trên máy", qty: 9 }), item("b")];
    const incoming = [item("a", { name: "Trong file", qty: 1 }), item("c")];
    const r = mergePantry(local, incoming);
    assert.deepEqual(r.pantry.map((x) => [x.id, x.name]), [["a", "Trên máy"], ["b", "Mì b"], ["c", "Mì c"]]);
    assert.equal(r.pantry[0].qty, 9);
    assert.equal(r.added, 1);
    assert.equal(r.kept, 1);
    assert.equal(local.length, 2);
    assert.equal(incoming.length, 2);
  });

  test("hồ sơ khi gộp = hợp 2 bên, làm sạch, đúng thứ tự", () => {
    assert.deepEqual(mergeProfile(["peanuts", "milk"], ["milk", "gluten", "abc"]), ["gluten", "milk", "peanuts"]);
    assert.deepEqual(mergeProfile([], []), []);
    assert.deepEqual(mergeProfile(null, ["eggs"]), ["eggs"]);
  });
});

describe("importPantryData với localStorage giả", () => {
  const PANTRY = "qmv-pantry", PROFILE = "qmv-allergy-profile";
  let store, throwOn, original;

  before(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    // localStorage giả: có length / key(i) vì phần backup duyệt mọi khóa; throwOn(khóa) = true thì setItem ném lỗi.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k) => (Object.hasOwn(store, k) ? store[k] : null),
        setItem: (k, v) => { if (throwOn(k)) throw new Error("QuotaExceededError"); store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        key: (i) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; }
      }
    });
  });
  after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
  beforeEach(() => { store = {}; throwOn = () => false; });

  const backupKeys = () => Object.keys(store).filter((k) => k.startsWith("qmv-pantry-backup")).sort();

  test("gộp: giữ món trên máy khi trùng id, hồ sơ = hợp, ghi vào localStorage", () => {
    store[PANTRY] = JSON.stringify([item("a", { name: "Trên máy" }), item("b")]);
    store[PROFILE] = '["milk"]';
    const data = parseImport(fileOf({ pantry: [item("a", { name: "Trong file" }), item("c")], allergyProfile: ["peanuts"] }));
    const r = importPantryData(data, "merge", getAllergyProfile());
    assert.equal(r.added, 1);
    assert.equal(r.kept, 1);
    assert.equal(r.profileSaved, true);
    assert.deepEqual(getPantry().map((x) => [x.id, x.name]), [["a", "Trên máy"], ["b", "Mì b"], ["c", "Mì c"]]);
    assert.deepEqual(getAllergyProfile(), ["milk", "peanuts"]);
    assert.deepEqual(backupKeys(), []); // gộp không cần backup
  });

  test("thay: tạo khóa qmv-pantry-backup-… chứa đúng chuỗi cũ, không ghi đè backup cũ", () => {
    const oldRaw = JSON.stringify([item("cu1"), item("cu2")]);
    store[PANTRY] = oldRaw;
    store[PROFILE] = '["milk","peanuts"]';
    store["qmv-pantry-backup"] = "backup rất cũ";
    store["qmv-pantry-backup-123"] = "backup cũ 2";
    const data = parseImport(fileOf({ pantry: [item("moi")], allergyProfile: [] }));
    const r = importPantryData(data, "replace", ["milk", "peanuts"]);
    const keys = backupKeys();
    assert.equal(keys.length, 3);
    const added = keys.filter((k) => !["qmv-pantry-backup", "qmv-pantry-backup-123"].includes(k));
    assert.equal(added.length, 1);
    assert.match(added[0], /^qmv-pantry-backup-\d+(-\d+)?$/);
    assert.equal(store[added[0]], oldRaw);
    assert.equal(r.backupKey, added[0]);
    assert.equal(store["qmv-pantry-backup"], "backup rất cũ");
    assert.equal(store["qmv-pantry-backup-123"], "backup cũ 2");
    assert.deepEqual(getPantry().map((x) => x.id), ["moi"]);
    assert.deepEqual(getAllergyProfile(), []); // hồ sơ thành đúng hồ sơ trong file (0 nhóm)
    assert.equal(r.profileSaved, true);
  });

  test("thay 2 lần cùng tủ cũ: bản giống hệt đã có thì không chép thêm", () => {
    const oldRaw = JSON.stringify([item("cu")]);
    store[PANTRY] = oldRaw;
    store["qmv-pantry-backup-1"] = oldRaw;
    importPantryData(parseImport(fileOf()), "replace", []);
    assert.deepEqual(backupKeys(), ["qmv-pantry-backup-1"]);
  });

  test("thay khi chưa có tủ / tủ rỗng: không tạo backup", () => {
    importPantryData(parseImport(fileOf()), "replace", []); // chưa có khóa qmv-pantry
    assert.deepEqual(backupKeys(), []);
    for (const empty of ["", "[]", " [] "]) {
      store[PANTRY] = empty;
      importPantryData(parseImport(fileOf()), "replace", []);
      assert.deepEqual(backupKeys(), [], JSON.stringify(empty));
    }
  });

  test("chép backup lỗi (setItem ném) → qmv-pantry và hồ sơ không đổi, báo 'Không lưu được…'", () => {
    const oldRaw = JSON.stringify([item("cu")]);
    store[PANTRY] = oldRaw;
    store[PROFILE] = '["milk"]';
    throwOn = (k) => k.startsWith("qmv-pantry-backup");
    assert.throws(() => importPantryData(parseImport(fileOf({ pantry: [item("moi")], allergyProfile: ["eggs"] })), "replace", ["milk"]),
      (e) => e.name === "PantryError" && e.message.startsWith("Không lưu được"));
    assert.equal(store[PANTRY], oldRaw);
    assert.equal(store[PROFILE], '["milk"]');
    assert.deepEqual(backupKeys(), []);
  });

  test("ghi tủ đồ lỗi → ném PantryError, hồ sơ chưa đụng tới", () => {
    store[PROFILE] = '["milk"]';
    throwOn = (k) => k === PANTRY;
    assert.throws(() => importPantryData(parseImport(fileOf({ allergyProfile: ["eggs"] })), "merge", ["milk"]),
      (e) => e.name === "PantryError" && e.message.startsWith("Không lưu được"));
    assert.equal(store[PROFILE], '["milk"]');
  });

  test("ghi hồ sơ lỗi → tủ đồ đã ghi, profileSaved false", () => {
    throwOn = (k) => k === PROFILE;
    const r = importPantryData(parseImport(fileOf({ allergyProfile: ["eggs"] })), "replace", []);
    assert.equal(r.profileSaved, false);
    assert.deepEqual(r.allergyProfile, ["eggs"]);
    assert.deepEqual(getPantry().map((x) => x.id), ["a1"]);
    assert.equal(store[PROFILE], undefined);
  });

  test("7 lần Thay toàn bộ (tủ khác nhau) → còn 5 khóa có thời điểm mới nhất + khóa gốc (sua-cuoi, hoan-thien (e))", () => {
    store["qmv-pantry-backup"] = "backup gốc";
    store["qmv-pantry-backup-abc"] = "khóa không đúng dạng <thời điểm>, không đụng";
    let now = 1762400000000;
    const t = mock.method(Date, "now", () => now);
    try {
      for (let i = 1; i <= 7; i++) {
        store[PANTRY] = JSON.stringify([item("lan" + i)]);
        now += 1000;
        importPantryData(parseImport(fileOf({ pantry: [item("moi" + i)] })), "replace", []);
      }
    } finally {
      t.mock.restore();
    }
    const stamped = backupKeys().filter((k) => /^qmv-pantry-backup-\d+(-\d+)?$/.test(k));
    assert.deepEqual(stamped, [3, 4, 5, 6, 7].map((i) => `qmv-pantry-backup-${1762400000000 + i * 1000}`));
    for (const i of [3, 4, 5, 6, 7]) assert.equal(store[`qmv-pantry-backup-${1762400000000 + i * 1000}`], JSON.stringify([item("lan" + i)]));
    assert.equal(store["qmv-pantry-backup"], "backup gốc");
    assert.equal(store["qmv-pantry-backup-abc"], "khóa không đúng dạng <thời điểm>, không đụng");
  });

  test("cùng mili giây (khóa có -1, -2): vẫn giữ 5 bản mới nhất theo thứ tự ghi", () => {
    const t = mock.method(Date, "now", () => 1762400000000);
    try {
      for (let i = 1; i <= 7; i++) {
        store[PANTRY] = JSON.stringify([item("lan" + i)]);
        importPantryData(parseImport(fileOf({ pantry: [item("moi" + i)] })), "replace", []);
      }
    } finally {
      t.mock.restore();
    }
    const keys = backupKeys();
    assert.equal(keys.length, 5, keys.join(", "));
    const kept = keys.map((k) => JSON.parse(store[k])[0].id).sort();
    assert.deepEqual(kept, ["lan3", "lan4", "lan5", "lan6", "lan7"]);
  });

  test("ghi bản backup mới lỗi → không xóa khóa backup nào", () => {
    store["qmv-pantry-backup"] = "backup gốc";
    for (let i = 1; i <= 6; i++) store[`qmv-pantry-backup-${1000 + i}`] = "cũ " + i;
    const before = { ...store };
    store[PANTRY] = JSON.stringify([item("cu")]);
    throwOn = (k) => k.startsWith("qmv-pantry-backup-");
    assert.throws(() => importPantryData(parseImport(fileOf()), "replace", []), (e) => e.name === "PantryError");
    for (const k of Object.keys(before)) assert.equal(store[k], before[k], k);
  });

  test("backup dữ liệu hỏng (bản thứ 2 trở đi) cũng giữ tối đa 5 khóa có thời điểm, không xóa khóa gốc", () => {
    store["qmv-pantry-backup"] = "backup gốc";
    for (let i = 1; i <= 5; i++) store[`qmv-pantry-backup-${1000 + i}`] = "cũ " + i;
    store[PANTRY] = "không phải JSON";
    assert.deepEqual(getPantry(), []);
    addToPantry({ code: "1", name: "Mới", expiresOn: "2026-12-01", qty: 1 });
    const stamped = backupKeys().filter((k) => k !== "qmv-pantry-backup");
    assert.equal(stamped.length, 5, stamped.join(", "));
    assert.ok(!stamped.includes("qmv-pantry-backup-1001"), "bản cũ nhất bị xóa");
    assert.ok(stamped.some((k) => store[k] === "không phải JSON"), "bản hỏng vừa chép vẫn còn");
    assert.equal(store["qmv-pantry-backup"], "backup gốc");
  });

  test("tên chứa <img onerror> giữ nguyên là chữ, renderPantry escape", () => {
    const evil = '<img src=x onerror=alert(1)>"';
    const data = parseImport(fileOf({ pantry: [item("x", { name: evil, code: '<b>"' })] }));
    assert.equal(data.pantry[0].name, evil);
    importPantryData(data, "replace", []);
    const list = getPantry();
    assert.equal(list[0].name, evil);
    const html = renderPantry(list, { today: new Date(2026, 10, 6) });
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes("<b>"));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;&quot;"));
  });
});
