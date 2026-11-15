// Test phần thuần của kho-lon-xuat.mjs + kho-lon-do.mjs (đợt kho-lon vòng 1, P4): ghép mức danh mục, lọc dòng bản
// xuất, chọn ca dò theo seed, G3, phán / chọn cách / chọn mức theo luật chốt trước (số giả). Không đọc bản xuất.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleLevels, processLines, rowFromApp, levelText, foreignGroupOf, LEVELS, GROUP_ORDER } from "../kho-lon-xuat.mjs";
import {
  pickProbes, g3Merge, judgeMethod, judgeH4, pickMethod, pickLevel, methodGrid, tieRank, mulberry32, quantile,
  GZIP_MAX_BYTES, DOCKER_MAX_BYTES, SERVER_K, PROBE_SEED, PROBE_N, PROBE_GROUPS,
} from "../kho-lon-do.mjs";

const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

// ---------------- kho-lon-xuat.mjs ----------------
test("mức: (a) ⊂ (b) ⊂ (c), thứ tự mức → nhóm → mã, bỏ trùng mã đã có / mã trùng giữ dòng trước", () => {
  assert.deepEqual(LEVELS.a, ["vn", "893"]);
  assert.deepEqual(LEVELS.b, ["vn", "893", "th", "jp", "my", "id", "kr", "cn"]);
  assert.deepEqual(LEVELS.c, GROUP_ORDER);
  const a = [rowFromApp({ code: "2", name: "x", brand: "y", text: "x y" }, "vn"), rowFromApp({ code: "1", name: "k", brand: "", img: "front_vi.3", text: "k" }, "893")];
  assert.deepEqual(a[0], { code: "2", name: "x", brand: "y", img: "", text: "x y", grp: "vn" }, "thiếu ảnh → img rỗng");
  const fr = (grp, code, seq, li, tag = "") => ({ grp, code, seq, li, s: JSON.stringify({ code, grp, tag }) });
  const lv = assembleLevels(a, [
    fr("us", "05", 0, 1), fr("jp", "09", 0, 2), fr("th", "08", 3, 0, "sau"), fr("th", "08", 1, 5, "truoc"),
    fr("th", "1", 0, 3), fr("us", "09", 2, 0), fr("cn", "03", 0, 4),
  ]);
  assert.deepEqual(lv.a.map((s) => JSON.parse(s).code), ["2", "1"]);
  assert.deepEqual(lv.b.map((s) => JSON.parse(s).code), ["2", "1", "08", "09", "03"], "th trước jp trước cn; mã 1 đã có ở (a)");
  assert.equal(JSON.parse(lv.b[2]).tag, "truoc", "mã trùng: giữ dòng (seq, li) nhỏ hơn");
  assert.deepEqual(lv.c.map((s) => JSON.parse(s).code), ["2", "1", "08", "09", "03", "05"], "us 09 đã có ở jp");
  assert.equal(levelText(["{}", "{}"]), "{}\n{}\n");
  assert.equal(levelText([]), "");
});

test("processLines: lọc nước (nhóm đầu theo thứ tự), cần tên + ảnh mặt trước, bỏ dòng hỏng", () => {
  const p = (o) => JSON.stringify(o);
  const front = { selected_images: { front: { display: { en: "x" } } }, images: { front_en: { imgid: "1", rev: "4" } } };
  const text = [
    p({ code: "111", product_name: "Pocky Choco", brands: "Glico", countries_tags: ["en:japan", "en:thailand"], ...front }),
    p({ code: "222", product_name: "", countries_tags: ["en:japan"], ...front }),
    p({ code: "333", product_name: "Mì", countries_tags: ["en:vietnam"], ...front }),
    "{hỏng",
    p({ code: "444", product_name: "Oreo", countries_tags: ["en:united-states"] }),
    p({ code: "555", product_name: "Ramen", origins_tags: ["en:japan"], countries_tags: ["en:france"], ...front }),
  ].join("\n");
  const rows = processLines(text);
  assert.equal(foreignGroupOf({ countries_tags: ["en:japan", "en:thailand"] }), "th");
  assert.equal(foreignGroupOf({ countries_tags: ["en:south-korea"] }), "kr");
  assert.equal(foreignGroupOf({ countries_tags: ["en:france"] }), null);
  // 222 không tên, 333 chỉ VN, 444 không ảnh, 555 "en:japan" chỉ ở origins_tags; dòng hỏng bỏ
  assert.deepEqual(rows.map((r) => [r[0], r[1], r[2]]), [["th", "111", 0]]);
  const o = JSON.parse(rows[0][3]);
  assert.deepEqual(o, { code: "111", name: "Pocky Choco", brand: "Glico", img: "front_en.4", text: "Pocky Choco Glico", grp: "th" });
});

// ---------------- kho-lon-do.mjs ----------------
test("hằng luật chốt trước", () => {
  assert.equal(SERVER_K, 10);
  assert.equal(GZIP_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(DOCKER_MAX_BYTES, 1.5 * 1024 ** 3);
  assert.equal(PROBE_SEED, 20261115);
  assert.equal(PROBE_N, 10);
  assert.deepEqual([...PROBE_GROUPS], ["th", "jp", "my", "id", "kr", "cn", "us"]);
  assert.deepEqual(Object.keys(methodGrid()), ["G1", "G2-g3-w3", "G2-g3-w2", "G2-g2-w3", "G2-g2-w2", "G2-g1-w3", "G2-g1-w2", "G3"]);
});

test("pickProbes: cố định theo seed, đúng n mỗi nhóm, chỉ dòng ≥ 2 từ, không phụ thuộc thứ tự dòng vào", () => {
  const rows = [];
  for (const g of ["th", "jp", "us", "vn"]) for (let i = 0; i < 30; i++) rows.push({ code: `${g}${String(i).padStart(3, "0")}`, grp: g, name: i % 5 === 0 ? "x" : `ten ${g} ${i}`, brand: i % 5 === 0 ? "" : "hang" });
  const a = pickProbes(rows, { tokens, groups: ["th", "jp", "us"], n: 10, seed: 7 });
  const b = pickProbes([...rows].reverse(), { tokens, groups: ["th", "jp", "us"], n: 10, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 30);
  for (const g of ["th", "jp", "us"]) assert.equal(a.filter((p) => p.grp === g).length, 10);
  assert.ok(a.every((p) => !p.code.endsWith("000") && !p.code.endsWith("005")), "dòng 1 từ bị loại");
  assert.ok(a.every((p) => p.lines.length === 2));
  const c = pickProbes(rows, { tokens, groups: ["th", "jp", "us"], n: 10, seed: 8 });
  assert.notDeepEqual(a.map((p) => p.code), c.map((p) => p.code), "seed khác → mẫu khác");
  const small = pickProbes(rows.slice(0, 3), { tokens, groups: ["th"], n: 10, seed: 7 });
  assert.equal(small.length, 2, "nhóm ít hơn n thì lấy hết dòng hợp lệ");
  const r = mulberry32(1);
  const x = r();
  assert.ok(x >= 0 && x < 1);
  assert.equal(mulberry32(1)(), x);
});

test("g3Merge: giữ 3 đầu, chèn 1 mục máy chủ, mục ngoài danh mục ≤ 1, mục bị gạt chỉ lấp chỗ trống", () => {
  const cat = (code) => ({ code, source: "catalog" });
  const off = (code) => ({ code, source: "off" });
  const sv = (code) => ({ code, source: "server" });
  assert.deepEqual(g3Merge([cat("1"), cat("2"), cat("3"), cat("4"), cat("5")], [cat("2"), sv("9"), sv("8")]).map((x) => x.code), ["1", "2", "3", "9", "4"]);
  // mục OFF ở vị trí 4 bị gạt vì mục máy chủ ngoài danh mục đã dùng chỗ offMax
  assert.deepEqual(g3Merge([cat("1"), cat("2"), cat("3"), off("7"), cat("5")], [sv("9")]).map((x) => x.code), ["1", "2", "3", "9", "5"]);
  // mục máy chủ có trong danh mục không tính offMax
  assert.deepEqual(g3Merge([cat("1"), cat("2"), cat("3"), off("7"), cat("5")], [cat("6")]).map((x) => x.code), ["1", "2", "3", "6", "7"]);
  // thiếu chỗ → mục bị gạt lấp chỗ trống
  assert.deepEqual(g3Merge([cat("1"), off("7")], [sv("9")]).map((x) => x.code), ["1", "7", "9"]);
  // không có mục máy chủ → giống hệt merged0
  const m0 = [cat("1"), cat("2"), cat("3"), off("7"), cat("5")];
  assert.deepEqual(g3Merge(m0, []), m0);
  assert.deepEqual(g3Merge([], []), []);
});

test("judgeMethod: H1 / H5 / muối", () => {
  const none = { lostTop1: [], out5: [] };
  const good = () => ({ loss: { "B-i": none, "B-ii": none, "A-i": none, "A-ii": none }, saltTop1: { i: "1", ii: null } });
  assert.deepEqual(judgeMethod(good()), { pass: true, fails: [] });
  const a = good();
  a.loss["A-ii"] = { lostTop1: ["x"], out5: [] };
  assert.deepEqual(judgeMethod(a).fails, ["H1 A-ii: mất vị trí 1 x"]);
  const b = good();
  b.loss["B-i"] = { lostTop1: [], out5: ["y"] };
  assert.deepEqual(judgeMethod(b).fails, ["H5 B-i: rơi khỏi 5 y"]);
  const c = good();
  c.saltTop1.ii = "8934673218368";
  assert.equal(judgeMethod(c).pass, false);
  assert.equal(judgeMethod({}).pass, false, "thiếu số → trượt");
});

test("judgeH4: gzip ≤ 25 MiB và ảnh Docker ước ≤ 1,5 GiB", () => {
  assert.equal(judgeH4({ gzip: GZIP_MAX_BYTES, dockerEst: DOCKER_MAX_BYTES }).pass, true);
  assert.equal(judgeH4({ gzip: GZIP_MAX_BYTES + 1, dockerEst: 1 }).pass, false);
  assert.equal(judgeH4({ gzip: 1, dockerEst: DOCKER_MAX_BYTES + 1 }).pass, false);
  assert.equal(judgeH4({ gzip: NaN, dockerEst: 1 }).pass, false);
});

test("pickMethod: chỉ cách qua; 7Up vị trí 1 → trong 5 → ngoại → dò; hòa G1 → G2 gap lớn → minWords lớn → G3", () => {
  const m = (name, o = {}) => ({ name, pass: true, diet1: 0, diet5: 0, foreign5: 0, probe5: 0, ...o });
  assert.equal(pickMethod([m("G1"), m("G3", { diet1: 2 }), m("G2-g1-w2", { diet1: 3, pass: false })]), "G3");
  assert.equal(pickMethod([m("G1", { diet5: 1 }), m("G2-g1-w2", { diet5: 2 })]), "G2-g1-w2");
  assert.equal(pickMethod([m("G3", { diet1: 1, diet5: 1 }), m("G1", { diet1: 0, diet5: 4, foreign5: 9 })]), "G3", "vị trí 1 xét trước trong 5");
  assert.equal(pickMethod([m("G3", { diet5: 2, foreign5: 0 }), m("G1", { diet5: 1, foreign5: 9 })]), "G3", "trong 5 xét trước ca ngoại");
  assert.equal(pickMethod([m("G1", { foreign5: 1, probe5: 9 }), m("G3", { foreign5: 2 })]), "G3");
  assert.equal(pickMethod([m("G3"), m("G2-g1-w3"), m("G1")]), "G1");
  assert.equal(pickMethod([m("G3"), m("G2-g1-w3"), m("G2-g2-w2")]), "G2-g2-w2");
  assert.equal(pickMethod([m("G3"), m("G2-g2-w2"), m("G2-g2-w3")]), "G2-g2-w3");
  assert.equal(pickMethod([m("G1", { pass: false })]), null);
  assert.ok(tieRank("G1") < tieRank("G2-g3-w3") && tieRank("G2-g1-w2") < tieRank("G3"));
});

test("pickLevel: mức lớn nhất qua; (a) không cách nào → dừng hỏi; H2 / H3 chưa đo → tạm", () => {
  const L = (name, o = {}) => ({ name, method: "G1", h4: true, h2: null, h3: null, ...o });
  assert.deepEqual(pickLevel([L("a"), L("b"), L("c")]), { level: "c", stop: false, provisional: true });
  assert.deepEqual(pickLevel([L("a"), L("b"), L("c", { h4: false })]), { level: "b", stop: false, provisional: true });
  assert.deepEqual(pickLevel([L("a"), L("b", { method: null }), L("c", { method: null })]), { level: "a", stop: false, provisional: true });
  assert.deepEqual(pickLevel([L("a", { method: null }), L("b")]), { level: null, stop: true, provisional: false });
  assert.deepEqual(pickLevel([L("a", { h2: true, h3: true }), L("b", { h2: false, h3: true })]), { level: "a", stop: false, provisional: false });
});

test("quantile (nearest rank)", () => {
  assert.equal(quantile([3, 1, 2], 0.5), 2);
  assert.equal(quantile(Array.from({ length: 30 }, (_, i) => i + 1), 0.95), 29);
  assert.equal(quantile([], 0.95), null);
});
