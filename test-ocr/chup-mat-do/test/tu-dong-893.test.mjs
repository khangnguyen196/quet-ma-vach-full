// Test phần thuần của khung đo tu-dong-893-do.mjs (vòng 5, V4-1) và tu-dong-kho-lon.mjs (P1b). Không gọi mạng, không
// đọc bản xuất 13 GB (dữ liệu giả nhỏ + danh mục thật của app).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { store893, mergeF1Extra, lossOf } from "../tu-dong-893-do.mjs";
import { compactProduct, makeHll, processChunk, rebuildCatalogText, GROUPS } from "../tu-dong-kho-lon.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const t1 = await import(pathToFileURL(path.join(ROOT, "public", "chup-mat-do", "t1.mjs")).href);
const fr = await import(pathToFileURL(path.join(ROOT, "src", "front-rank.js")).href);
const fm = await import(pathToFileURL(path.join(ROOT, "src", "front-merge.js")).href);
// Vòng 6: chỉ mục + tìm kho phụ chuyển sang src/front-extra.js (script bỏ bản sao); 2 test dưới gọi bản của app.
const fx = await import(pathToFileURL(path.join(ROOT, "src", "front-extra.js")).href);
const extraIndex = (_fm, t, extra) => fx.buildExtraIndex(t, extra);
const searchExtra = (_fm, index, xi, found, limit) => fx.searchExtra(index, xi, found, limit);
const appText = fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"), "utf8");
const products = JSON.parse(appText).products;
const rIndex = fr.buildRankIndex(t1, products);
const rec = (code, name, extra = {}) => ({ code, names: name ? { product_name: name } : {}, generic: {}, brands: "", unique_scans_n: null, completeness: null, fronts: [], uploaded: 0, countries_tags: [], vn: false, ...extra });
const DIET = rec("8934588752117", "Soda Chanh - Diet 7Up", { brands: "PepsiCo", fronts: [{ key: "front_en", imgid: "2", rev: "7" }] });

test("store893: chỉ mã 13 số đầu 893, có tên, chưa có trong danh mục; hẹp = thêm hãng + ảnh; mã trùng giữ bản đầu", () => {
  const codes = new Set(products.map((p) => p.code));
  const inCat = products.find((p) => p.code.startsWith("893")).code;
  const rs = [DIET, DIET, rec("8930000000001", ""), rec("8930000000002", "Bánh"), rec("4930000000003", "Nhật"), rec(inCat, "Đã có"), rec("893123", "Ngắn")];
  assert.deepEqual(store893(rs, codes).map((p) => p.code).sort(), ["8930000000002", "8934588752117"]);
  assert.deepEqual(store893(rs, codes, { narrow: true }).map((p) => p.code), ["8934588752117"]);
  assert.equal(store893(rs, codes).find((p) => p.code === DIET.code).text, "Soda Chanh - Diet 7Up PepsiCo");
});

test("searchExtra: chấm bằng chỉ mục CHÍNH (từ lạ không cộng điểm), khớp ≥ 1 từ, tối đa limit", () => {
  const extra = store893([DIET, rec("8930000000009", "Zzqxy Wvut"), rec("8930000000010", "Soda chanh khác", { brands: "X" })], new Set());
  const xi = extraIndex(fm, t1, extra);
  const found = fr.rankFromItems(t1, rIndex, ["Up", "Soda chanh", "Khong calo"].map((text, k) => ({ text, poly: [[0, k * 60], [400, k * 60], [400, 40 + k * 60], [0, 40 + k * 60]], score: 0.95 })));
  const hits = searchExtra(fm, rIndex.index, xi, found);
  assert.ok(hits.some((h) => h.code === DIET.code));
  assert.ok(!hits.some((h) => h.code === "8930000000009"), "chỉ từ lạ → không khớp");
  assert.equal(searchExtra(fm, rIndex.index, xi, found, 1).length, 1);
  assert.deepEqual(searchExtra(fm, rIndex.index, xi, { query: [] }), []);
  assert.match(hits[0].img, /^https:\/\/images\.openfoodfacts\.org\//);
});

test("mergeF1Extra: kho phụ rỗng → trùng mergeFront thật (OFF lỗi và OFF giả); có kho phụ → tối đa own chỗ, 3 mục đầu T1 giữ", () => {
  const found = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");
  const offs = [null, { ok: true, hits: [{ code: "9990000000001", name: "Soda chanh", brand: "", img: "", vn: false, text: "soda chanh diet up" }] }];
  for (const off of offs) {
    assert.deepEqual(mergeF1Extra(fm, t1, rIndex, products, found, off, []).map((x) => x.code), fm.mergeFront(t1, rIndex, products, found, off).map((x) => x.code));
  }
  const xi = extraIndex(fm, t1, store893([DIET], new Set()));
  const got = mergeF1Extra(fm, t1, rIndex, products, found, null, searchExtra(fm, rIndex.index, xi, found));
  assert.deepEqual(got.slice(0, 3).map((x) => x.code), found.hits.slice(0, 3).map((h) => h.code));
  assert.equal(got.filter((x) => x.source === "extra").length, 1);
});

test("lossOf: mất vị trí 1 / rơi khỏi 5 so với mốc", () => {
  const r = lossOf([{ code: "a", base: 1, got: 2 }, { code: "b", base: 4, got: null }, { code: "c", base: null, got: 1 }, { code: "d", base: 1, got: 1 }]);
  assert.deepEqual(r, { lostTop1: ["a"], out5: ["b"] });
});

test("kho-lon compactProduct: cần tên + ảnh mặt trước; đúng dạng danh mục", () => {
  assert.equal(compactProduct(rec("1", "Tên")), null, "không ảnh");
  assert.equal(compactProduct(rec("1", "", { fronts: [{ key: "front_en", imgid: "1", rev: "3" }] })), null, "không tên");
  assert.deepEqual(compactProduct(DIET), { code: DIET.code, name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: "front_en.7", text: "Soda Chanh - Diet 7Up PepsiCo" });
});

test("kho-lon makeHll: ước số phần tử khác nhau sai ≤ 3 %, gộp 2 bộ = hợp", () => {
  const a = makeHll();
  const b = makeHll();
  for (let i = 0; i < 50000; i++) a.add(`w${i}`);
  for (let i = 25000; i < 80000; i++) b.add(`w${i}`);
  assert.ok(Math.abs(a.count() - 50000) / 50000 < 0.03, String(a.count()));
  a.merge(b.reg);
  assert.ok(Math.abs(a.count() - 80000) / 80000 < 0.03, String(a.count()));
});

test("kho-lon processChunk: nhóm, đếm, bản ghi VN giữ thứ tự dòng, dòng hỏng đếm riêng", () => {
  const p1 = { code: "8930000000001", product_name: "Bánh", countries_tags: ["en:vietnam"], images: { selected: { front: { vi: { imgid: "1", rev: "4" } } } }, last_modified_t: Date.UTC(2026, 10, 5) / 1000 };
  const p2 = { code: "0001", product_name: "Thai snack", countries_tags: ["en:thailand", "en:united-states"] };
  const state = { fresh: { vn7: 0, vn30: 0, b7: 0, b30: 0, vnAll: 0, b893All: 0, maxT: 0, vnMaxT: 0 }, vocab: {} };
  const r = processChunk([JSON.stringify(p1), "{hỏng", JSON.stringify(p2), ""].join("\n"), 3, state);
  assert.equal(r.lines, 3);
  assert.equal(r.bad, 1);
  assert.equal(r.vn.length, 1);
  assert.equal(r.vn[0][1].code, p1.code);
  assert.equal(r.groups.vn.nameFront, 1);
  assert.equal(r.groups["893"].all, 1);
  assert.equal(r.groups.thailand.all, 1);
  assert.equal(r.groups.thailand.nameFront, 0, "không ảnh mặt trước");
  assert.equal(r.groups.world.all, 2);
  assert.deepEqual(JSON.parse(r.groups.vn.text), { code: p1.code, name: "Bánh", brand: "", img: "front_vi.4", text: "Bánh " });
  assert.equal(state.fresh.vn7, 1);
  assert.equal(state.fresh.b30, 1);
  assert.ok(Object.keys(GROUPS).length === 10);
});

test("kho-lon rebuildCatalogText: dựng lại từ bản ghi VN cũ (vn-products.json) trùng từng byte file app (khi có dữ liệu trên máy)", (t) => {
  const f = "D:\\tmp\\chup-mat-do\\du-lieu\\vn-products.json";
  if (!fs.existsSync(f)) { t.skip("không có vn-products.json trên máy"); return; }
  const app = JSON.parse(appText);
  assert.equal(rebuildCatalogText(JSON.parse(fs.readFileSync(f, "utf8")), app.meta.ngayXuat), appText);
});
