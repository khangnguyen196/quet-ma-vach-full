// Test phần thuần của kho-lon-xuat.mjs + kho-lon-do.mjs (đợt kho-lon vòng 1, P4): ghép mức danh mục, lọc dòng bản
// xuất, chọn ca dò theo seed, G3, phán / chọn cách / chọn mức theo luật chốt trước (số giả). Không đọc bản xuất.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { assembleLevels, processLines, rowFromApp, levelText, foreignGroupOf, LEVELS, GROUP_ORDER, isInside, FORBIDDEN_OUT_ROOTS } from "../kho-lon-xuat.mjs";
import {
  pickProbes, g3Merge, judgeMethod, judgeH4, pickMethod, pickLevel, methodGrid, tieRank, mulberry32, quantile,
  GZIP_MAX_BYTES, DOCKER_MAX_BYTES, SERVER_K, PROBE_SEED, PROBE_N, PROBE_GROUPS, mergeByMethod,
} from "../kho-lon-do.mjs";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import { buildRankIndex, rankFromText } from "../../../src/front-rank.js";

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

test("isInside (vòng 2): so bằng path.relative, không so tiền tố chuỗi; chặn cả worktree lẫn thư mục chính", () => {
  const w = path.win32;
  assert.equal(isInside("D:\\quet-ma-vach-full\\x", "D:\\quet-ma-vach-full", w), true);
  assert.equal(isInside("d:\\QUET-MA-VACH-FULL\\x\\y", "D:\\quet-ma-vach-full", w), true, "không phân biệt hoa thường");
  assert.equal(isInside("D:\\quet-ma-vach-full", "D:\\quet-ma-vach-full", w), true);
  assert.equal(isInside("D:\\quet-ma-vach-full-khac\\x", "D:\\quet-ma-vach-full", w), false, "tiền tố chuỗi trùng nhưng là thư mục khác");
  assert.equal(isInside("D:\\tmp\\kho-lon\\danh-muc", "D:\\quet-ma-vach-full", w), false);
  assert.equal(isInside("C:\\quet-ma-vach-full\\x", "D:\\quet-ma-vach-full", w), false, "khác ổ");
  assert.equal(isInside("D:\\quet-ma-vach-full\\..\\tmp", "D:\\quet-ma-vach-full", w), false);
  assert.ok(FORBIDDEN_OUT_ROOTS.includes("D:\\quet-ma-vach-full") && FORBIDDEN_OUT_ROOTS.length === 2);
});

test("kho-lon-vang (vòng 2): pickMini giữ mã bắt buộc + mẫu theo seed, giữ thứ tự dòng; câu tự dựng đủ loại", async () => {
  const { pickMini, craftedQueries, goldOf } = await import("../kho-lon-vang.mjs");
  const rows = [];
  for (const g of ["vn", "th", "us"]) for (let i = 0; i < 20; i++) rows.push({ code: `${g}${String(i).padStart(2, "0")}`, grp: g, text: `x ${g}` });
  const a = pickMini(rows, ["us19", "th03"], { seed: 5, perGroup: 4, groups: ["vn", "th", "us"] });
  const b = pickMini(rows, ["us19", "th03"], { seed: 5, perGroup: 4, groups: ["vn", "th", "us"] });
  assert.deepEqual(a, b);
  assert.ok(a.some((r) => r.code === "us19") && a.some((r) => r.code === "th03"));
  assert.ok(a.length >= 12 && a.length <= 14);
  assert.deepEqual(a.map((r) => rows.indexOf(r)), a.map((r) => rows.indexOf(r)).slice().sort((x, y) => x - y), "giữ thứ tự dòng gốc");
  const q = craftedQueries();
  assert.equal(new Set(q.map((x) => x.id)).size, q.length);
  assert.ok(q.some((x) => x.input.text === "") && q.some((x) => Array.isArray(x.input.items) && !x.input.items.length));
  const products = [{ code: "1", text: "Soda chanh 7Up" }, { code: "2", text: "7Up Revive" }, { code: "3", text: "banh quy" }];
  const ri = buildRankIndex(t1, products);
  const g = goldOf(t1, { rankFromItems: () => { throw new Error("không dùng"); }, rankFromText }, ri, { text: "soda 7 up" });
  assert.deepEqual(g.query, ["soda", "7up"]);
  assert.deepEqual(g.hits.map((h) => h.code), ["1", "2"]);
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
  // vòng 2 (gợi ý reviewer): mọi dòng i % 5 === 0 (tên "x", 1 từ) bị loại, không chỉ 000 / 005
  assert.ok(a.every((p) => Number(p.code.slice(2)) % 5 !== 0), "dòng 1 từ (i % 5 === 0) bị loại");
  assert.equal(a.filter((p) => Number(p.code.slice(2)) % 5 === 0).length, 0);
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

// Vòng 2 (P1): dữ liệu giả nhỏ cho mergeByMethod. Danh mục: "soda chanh" (mã c0) + 1 sp "diet" + 18 sp độn (idf lớn).
// Câu "soda chanh diet": T1 mục 1 = c0 (khớp 2 từ). Mục "9" (soda chanh diet, khớp 3 từ, điểm cao hơn c0 rõ) có CẢ
// trên OFF lẫn máy chủ (S).
function g2Fixture() {
  const products = [{ code: "c0", text: "soda chanh" }, { code: "c1", text: "nuoc diet" }];
  for (let i = 0; i < 18; i++) products.push({ code: `f${i}`, text: `banh${String.fromCharCode(97 + i)} quy` });
  const rIndex = buildRankIndex(t1, products);
  const found = rankFromText(t1, rIndex, "soda chanh diet");
  const hit9 = { code: "9", name: "Soda chanh diet", brand: "", img: "", vn: false, text: "soda chanh diet" };
  const off = { ok: true, hits: [hit9] };
  const S = [{ ...hit9, grp: "893", score: 9 }];
  return { products, rIndex, found, off, S };
}

test("mergeByMethod G2: mục trùng mã OFF + máy chủ được offPromote đẩy lên vị trí 1", () => {
  const { products, rIndex, found, off, S } = g2Fixture();
  assert.equal(found.hits[0].code, "c0");
  const got = mergeByMethod({ t1, rIndex, products, found, off, S, method: "G2-g1-w3" });
  assert.equal(got[0].code, "9", `nhận ${got.map((x) => x.code).join(",")}`);
  assert.ok(!got[0].extra, "mục máy chủ không mang extra");
  // mục chỉ có trên OFF (mã không có trong S) vẫn mang extra → không được đẩy
  const onlyOff = mergeByMethod({ t1, rIndex, products, found, off, S: [], method: "G2-g1-w3" });
  assert.equal(onlyOff[0].code, "c0");
});

test("mergeByMethod G1: giữ hành vi cũ (mục máy chủ không được đẩy lên vị trí 1)", () => {
  const { products, rIndex, found, off, S } = g2Fixture();
  const got = mergeByMethod({ t1, rIndex, products, found, off, S, method: "G1" });
  assert.equal(got[0].code, "c0");
  assert.ok(got.some((x) => x.code === "9"));
  assert.deepEqual(mergeByMethod({ t1, rIndex, products, found: null, off, S, method: "G1" }), []);
  assert.throws(() => mergeByMethod({ t1, rIndex, products, found, off, S, method: "G9" }));
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

// ---------------- vòng 3: không ghi đè số đã có, luồng phụ thoát mã ≠ 0 ----------------
test("kho-lon-do --ban: file ra đã có thì chặn, trừ khi có --ghi-de", async () => {
  const { outFiles, overwriteBlocked, parseArgs } = await import("../kho-lon-do.mjs");
  const files = outFiles("ket-qua", "v3", ["a", "b", "c"]);
  assert.deepEqual(files, [path.join("ket-qua", "v3-do-abc.json"), path.join("ket-qua", "v3-tung-ca-abc.json")]);
  const has = (f) => f.endsWith("v3-do-abc.json");
  assert.deepEqual(overwriteBlocked(files, { exists: has }), [files[0]]);
  assert.deepEqual(overwriteBlocked(files, { exists: has, overwrite: true }), []);
  assert.deepEqual(overwriteBlocked(files, { exists: () => false }), []);
  const p = parseArgs(["--ban", "v3", "--ghi-de", "--muc", "c"]);
  assert.equal(p.ban, "v3");
  assert.equal(p.overwrite, true);
  assert.deepEqual(p.levelNames, ["c"]);
  assert.equal(parseArgs([]).overwrite, false);
  assert.equal(parseArgs([]).ban, "v2");
});

test("kho-lon-do chạy thật với --ban trùng file đã có: dừng mã 2, không ghi", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kld-"));
  const f = path.join(dir, "v9-do-a.json");
  fs.writeFileSync(f, "cu");
  const script = path.resolve(import.meta.dirname, "..", "kho-lon-do.mjs");
  const r = spawnSync(process.execPath, [script, "--ban", "v9", "--muc", "a", "--out", dir], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--ghi-de/);
  assert.equal(fs.readFileSync(f, "utf8"), "cu");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("kho-lon-xuat: luồng phụ thoát mã ≠ 0 khi chưa xong → lỗi; sau terminate thì không", async () => {
  const { workerExitFails } = await import("../kho-lon-xuat.mjs");
  assert.equal(workerExitFails(1, false), true);
  assert.equal(workerExitFails(134, false), true);
  assert.equal(workerExitFails(0, false), false);
  assert.equal(workerExitFails(1, true), false);
});
