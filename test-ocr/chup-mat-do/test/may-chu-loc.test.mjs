// Test phần thuần của may-chu-loc-do.mjs (đợt may-chu-loc vòng 2): phép chia lẻ / chẵn, phán C1–C6 (thử đỏ / xanh),
// lọc hết dòng → quay về mọi dòng, chiều cao theo KHUNG CHỮ chứ không theo h hàng, tự kiểm sha256 khối luật, không có
// mã nhãn / tên ảnh thật trong file. Dữ liệu giả (danh mục mini dựng tại chỗ); không gọi mạng.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import { buildRankIndex, rankFromItems } from "../../../src/front-rank.js";
import { ruleBlockOf, sha256Of } from "../g2-di-qua-do.mjs";
import { prominentRows, rowWeights, A_VARIANTS, methodGrid } from "../dong-noi-bat-do.mjs";
import {
  splitHalves, shortEdge, rowsWithBoxes, boxLines, serverRank, judge, targetOf, pickMethod, sampleSizes, selfCheck,
  fallbackRefOf, fallbackCheck, resultFile, RULE_SHA256, CODE_7UP_DIET, BULDAK_CODE, RUAYPUAN_CODE, SERVER_K,
} from "../may-chu-loc-do.mjs";
import { ALL_CODES } from "../nang-t1-do.mjs";

const SRC_FILE = new URL("../may-chu-loc-do.mjs", import.meta.url);
const SELF_FILE = new URL(import.meta.url);
const DOC_FILES = ["../../../PLAN.md", "../../README.md", "../../../CLAUDE.md"].map((p) => new URL(p, import.meta.url));

test("splitHalves: xếp theo tên (so chuỗi) trong từng thư mục, lẻ = giữ riêng, chẵn = chỉnh, bỏ null SAU khi chia", () => {
  const items = [
    { folder: "2", file: "b.jpg", code: "8930000000002" },
    { folder: "2", file: "a.jpg", code: null },
    { folder: "2", file: "c.jpg", code: "8930000000003" },
    { folder: "1", file: "10.jpg", code: "none" },
    { folder: "1", file: "9.jpg", code: "8930000000009" },
  ];
  const out = splitHalves(items);
  const g = Object.fromEntries(out.map((x) => [`${x.folder}/${x.file}`, `${x.pos}:${x.group}`]));
  // thư mục 2: a (null) vị trí 1 giữ riêng → bỏ sau khi chia; b vị trí 2 chỉnh; c vị trí 3 giữ riêng
  assert.deepEqual(g, { "2/b.jpg": "2:chinh", "2/c.jpg": "3:giu", "1/10.jpg": "1:giu", "1/9.jpg": "2:chinh" });
  assert.equal(out.some((x) => x.code == null), false);
});

test("shortEdge: cạnh ngắn của tứ giác, chữ xoay dọc lấy bề ngang khung", () => {
  assert.equal(shortEdge([[0, 0], [200, 0], [200, 40], [0, 40]]), 40);
  // khung dọc cao 700 rộng 90 (chữ xoay 90 độ): cỡ chữ = 90, không phải 700
  assert.equal(shortEdge([[0, 0], [90, 0], [90, 700], [0, 700]]), 90);
  assert.equal(shortEdge([[0, 0], [10, 5], [10, 30]]), 30);
  assert.equal(shortEdge(null), null);
});

const box = (text, x, y, w, h, score = 0.95) => ({ text, score, poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });

test("rowsWithBoxes: text / h / conf của hàng trùng t1.rowLineInfo; khung mang chiều cao cạnh ngắn", () => {
  const items = [
    box("Omachi", 0, 0, 300, 120, 0.99), box("suon ham", 320, 30, 200, 40, 0.9),
    box("Mi", 0, 200, 60, 30, 0.8), box("khoai tay", 80, 205, 200, 30, 0.7), { text: "  ", poly: [[0, 0]], score: 1 },
    { text: "x", poly: [], score: 1 }, box("THUONG HIEU", 600, 0, 90, 700, 0.96),
  ];
  const rows = rowsWithBoxes(items);
  assert.deepEqual(rows.map(({ text, h, conf }) => ({ text, h, conf })), t1.rowLineInfo(items));
  // khung dọc 90 × 700 gộp với "Omachi" thành một hàng có h hàng 700, nhưng chiều cao khung = 90
  const big = rows.find((r) => r.text.includes("THUONG"));
  assert.equal(big.h, 700);
  assert.equal(big.boxes.find((b) => b.text === "THUONG HIEU").h, 90);
  assert.equal(big.boxes.find((b) => b.text === "Omachi").h, 120);
});

const PRODUCTS = [
  { code: "8930000000001", text: "Mi Omachi suon ham" },
  { code: "8930000000002", text: "Mi Hao Hao tom chua cay" },
  { code: "8930000000003", text: "Thuong hieu tu tam banh trang" },
  { code: "8930000000004", text: "Banh quy bo Cosy" },
  { code: "8930000000005", text: "Tra xanh khong do" },
  { code: "8930000000006", text: "Omachi tom chua cay" },
];
const rI = buildRankIndex(t1, PRODUCTS);

test("serverRank nền = rankFromItems trên cùng chỉ mục (câu + mã)", () => {
  const items = [box("Omachi", 0, 0, 300, 120), box("tom chua cay", 0, 200, 200, 30)];
  const a = serverRank(t1, rI, rowsWithBoxes(items), {}, SERVER_K);
  const b = rankFromItems(t1, rI, items, SERVER_K);
  assert.deepEqual(a.query, b.query);
  assert.deepEqual(a.hits.map((h) => h.code), b.hits.map((h) => h.code));
});

test("(a) lọc hết dòng → quay về mọi dòng: S trùng nền", () => {
  // mọi hàng độ tin 0,6 < 0,7 → a-c70 bỏ hết → fellBack, dùng mọi hàng
  const items = [box("Omachi suon ham", 0, 0, 300, 40, 0.6), box("tom chua cay", 0, 100, 200, 40, 0.6)];
  const rows = rowsWithBoxes(items);
  const nen = serverRank(t1, rI, rows, {}, SERVER_K);
  for (const m of [{ a: A_VARIANTS["a-c70"] }, { a: A_VARIANTS["a-c70"], b: { sel: "h", k: 1 } }, { a: A_VARIANTS["a-c70"], c: { beta: 2 } }]) {
    const r = serverRank(t1, rI, rows, m, SERVER_K);
    assert.equal(r.fellBack, true);
    assert.deepEqual(r.query, nen.query);
    if (!m.b && !m.c) assert.deepEqual(r.hits.map((h) => h.code), nen.hits.map((h) => h.code));
  }
});

test("(b)(c) theo chiều cao KHUNG CHỮ, không theo h hàng", () => {
  // một hàng gộp: khung dọc cao 700 (chữ nhỏ, rộng 50) + khung "Omachi" chữ to 150; hàng khác chữ nhỏ 30
  const items = [box("Omachi", 0, 100, 500, 150), box("thuong hieu tu tam", 600, 0, 50, 700), box("tom chua cay", 0, 800, 200, 30)];
  const rows = rowsWithBoxes(items);
  const bl = boxLines(rows);
  const top = prominentRows(t1, bl, { sel: "h", k: 1 });
  assert.equal(top[0].text, "Omachi"); // theo h hàng thì cả hàng gộp (700) đứng đầu, theo khung thì "Omachi" (150)
  const w = rowWeights(t1, bl, rI.index.idf, rI.index.aliasDf, 1);
  assert.ok(w.get("omachi") > 1);
  assert.equal(w.get("thuong") ?? 1, 1); // khung dọc cạnh ngắn 50 < trung vị → không nặng hơn
  // câu gõ (không có khung) → (b)(c) như nền
  const typed = [{ text: "Omachi suon ham", conf: null }];
  const nen = serverRank(t1, rI, typed, {}, SERVER_K);
  for (const m of [{ b: { sel: "h", k: 2 } }, { c: { beta: 2 } }]) assert.deepEqual(serverRank(t1, rI, typed, m, SERVER_K).hits, nen.hits);
});

test("fallbackRefOf: cách ghép → cách (b)/(c) đúng tham số (không nhầm b-h với b-hoa, k, β); cách chỉ (a) → nền", () => {
  const grid = methodGrid();
  const names = Object.keys(grid);
  let combos = 0;
  for (const n of names) {
    const ref = fallbackRefOf(grid[n], grid);
    const m = grid[n];
    if (!m.a || (!m.b && !m.c)) { assert.equal(ref, null, n); continue; }
    combos++;
    assert.equal(grid[ref].a, undefined, n);
    assert.deepEqual(grid[ref].b ?? null, m.b ?? null, n);
    assert.deepEqual(grid[ref].c ?? null, m.c ?? null, n);
    // tên cách ghép = <a>+<ref> (chỉ để đối chiếu; hàm không dựa vào tên)
    assert.ok(n.endsWith(`+${ref}`), `${n} → ${ref}`);
  }
  assert.equal(combos, 72);
  assert.equal(fallbackRefOf(grid["a-c70+b-hoa2"], grid), "b-hoa2");
  assert.equal(fallbackRefOf(grid["a-url+b-h2"], grid), "b-h2");
  assert.equal(fallbackRefOf(grid["a-so+c-0.5"], grid), "c-0.5");
  assert.equal(fallbackRefOf(grid["c-2"], grid), null);
  assert.equal(fallbackRefOf({}, grid), null);
  assert.throws(() => fallbackRefOf({ a: A_VARIANTS["a-url"], c: { beta: 7 } }, grid), /có 0 cách/);
});

test("C4 mới (thử đỏ / xanh): ca quay về so S với cách (b)/(c) riêng (cách ghép) hoặc nền (cách chỉ (a))", () => {
  const grid = methodGrid();
  const base = { x: { S: ["1", "2"], fellBack: false }, y: { S: ["3"], fellBack: false } };
  const bOnly = { x: { S: ["2", "1"], fellBack: false }, y: { S: ["3"], fellBack: false } };
  const refFor = (name) => { const r = fallbackRefOf(grid[name], grid); return r ? { "b-h1": bOnly }[r] : base; };
  // 1) cách ghép quay về, S = S của (b) riêng (khác nền) → QUA C4
  const combo1 = { x: { S: ["2", "1"], fellBack: true }, y: { S: ["3"], fellBack: false } };
  assert.deepEqual(fallbackCheck(combo1, refFor("a-c70+b-h1")), { ok: true, diff: [] });
  // 2) cách ghép quay về, S khác (b) riêng (dù trùng nền) → TRƯỢT
  const combo2 = { x: { S: ["1", "2"], fellBack: true }, y: { S: ["3"], fellBack: false } };
  assert.deepEqual(fallbackCheck(combo2, refFor("a-c70+b-h1")), { ok: false, diff: ["x"] });
  // 3) cách chỉ (a) quay về, S khác nền → TRƯỢT
  const aOnly = { x: { S: ["2", "1"], fellBack: true }, y: { S: ["3"], fellBack: true } };
  assert.deepEqual(fallbackCheck(aOnly, refFor("a-c70")), { ok: false, diff: ["x"] });
  // ca không quay về không xét
  assert.equal(fallbackCheck({ x: { S: ["9"], fellBack: false } }, base).ok, true);
  // judge: fallbackOk từ fallbackCheck
  const r = green();
  r.fallbackOk = fallbackCheck(combo2, refFor("a-c70+b-h1")).ok;
  assert.equal(judge(r).gates.C4, false);
  r.fallbackOk = fallbackCheck(combo1, refFor("a-c70+b-h1")).ok;
  assert.equal(judge(r).gates.C4, true);
});

test("C4 trên serverRank thật: cách ghép quay về cho S trùng cách (b)/(c) riêng", () => {
  const items = [box("Omachi suon ham", 0, 0, 300, 90, 0.6), box("tom chua cay", 0, 100, 200, 30, 0.6)];
  const rows = rowsWithBoxes(items);
  for (const [combo, only] of [["a-c70+b-h1", "b-h1"], ["a-c70+c-2", "c-2"]]) {
    const g = methodGrid();
    const a = serverRank(t1, rI, rows, g[combo], SERVER_K);
    const b = serverRank(t1, rI, rows, g[only], SERVER_K);
    assert.equal(a.fellBack, true);
    assert.deepEqual(a.hits.map((h) => h.code), b.hits.map((h) => h.code));
  }
});

test("resultFile: kiểm chéo lệch → .loi.json + thoát 3, không phải file chính", () => {
  const ok = resultFile("D:\\x", true, true);
  assert.match(ok.file, /do\.json$/);
  assert.equal(ok.exitCode, 0);
  const bad = resultFile("D:\\x", true, false);
  assert.match(bad.file, /do\.loi\.json$/);
  assert.equal(bad.exitCode, 3);
  assert.match(resultFile("D:\\x", false, false).file, /nen\.loi\.json$/);
  assert.match(resultFile("D:\\x", false, true).file, /nen\.json$/);
  assert.notEqual(bad.file, ok.file);
});

const green = () => ({
  ab: [{ id: "A1|i", base: 1, got: 1 }, { id: "B1|i", base: 3, got: 2 }, { id: "B2|i", base: null, got: null }],
  real: [{ id: "r1|i", base: 1, got: 1 }, { id: "r2|ii", base: 4, got: 5 }, { id: "r3|i", base: null, got: null }],
  s7: { "may|i": 1, "may|ii": 1, "go|i": 1, "go|ii": 1 }, buldak: { i: BULDAK_CODE, ii: BULDAK_CODE },
  salt: { "may|i": "open", "may|ii": "open", "lui|i": "open", "lui|ii": "open" },
  foreign: { base: { top1: 0, top5: 4 }, got: { top1: 0, top5: 4 } }, sMax: 10, fallbackOk: true, srcSame: true,
  consts: { confidenceNull: true, strangeNull: true }, offSame: true, luiSame: true, h3Est: 25, h2Est: 835.3,
});

test("judge: xanh khi mọi cổng qua; đỏ khi 1 ảnh mất vị trí 1 (C1 / C2) hoặc rơi khỏi 5", () => {
  assert.equal(judge(green()).pass, true);
  const r1 = green();
  r1.ab[0].got = 2; // ảnh A mất vị trí 1
  const v1 = judge(r1);
  assert.equal(v1.pass, false);
  assert.equal(v1.gates.C1, false);
  assert.match(v1.fails.join(" "), /mất vị trí 1 \[A1\|i\]/);
  const r2 = green();
  r2.real[1].got = null; // ảnh thật nền trong 5 rơi khỏi 5
  assert.equal(judge(r2).gates.C2, false);
  const r2b = green();
  r2b.real[2].got = 3; // nền ngoài 5 → không xét ở C2 (lên được là tốt)
  assert.equal(judge(r2b).gates.C2, true);
});

test("judge: C3 / C4 / C5 / C6 đỏ đúng chỗ", () => {
  const r = green();
  r.s7["go|ii"] = 2;
  assert.equal(judge(r).gates.C3, false);
  const rb = green();
  rb.buldak.ii = "8930000000001";
  assert.equal(judge(rb).gates.C3, false);
  const rf = green();
  rf.foreign.got.top5 = 3;
  assert.equal(judge(rf).gates.C3, false);
  const rs = green();
  rs.salt["lui|i"] = "none";
  assert.equal(judge(rs).gates.C3, false);
  const r4 = green();
  r4.sMax = 11;
  assert.equal(judge(r4).gates.C4, false);
  const r4b = green();
  r4b.fallbackOk = false;
  assert.equal(judge(r4b).gates.C4, false);
  const r5 = green();
  r5.consts.strangeNull = false;
  assert.equal(judge(r5).gates.C5, false);
  const r5b = green();
  r5b.luiSame = false;
  assert.equal(judge(r5b).gates.C5, false);
  const r6 = green();
  r6.h3Est = 201;
  assert.equal(judge(r6).gates.C6, false);
  assert.equal(judge({}).pass, false);
});

test("targetOf / pickMethod: M1 > M2 > M3 > thứ tự đơn giản; M1 không hơn nền → không giữ", () => {
  const t = targetOf([{ pos: 3 }, { pos: 1 }, { pos: null }], [{ base: 1, pos: 1 }, { base: 2, pos: 2 }, { base: null, pos: null }]);
  assert.deepEqual(t, { M1: 2, M2: 1, M3: 1 });
  const order = Object.keys(methodGrid());
  assert.equal(order.length, 89);
  const base = { M1: 0, M2: 0, M3: 0 };
  const list = [
    { name: "a-url", pass: true, t: { M1: 1, M2: 0, M3: 5 } },
    { name: "c-1", pass: true, t: { M1: 1, M2: 1, M3: 0 } },
    { name: "b-h1", pass: false, t: { M1: 4, M2: 4, M3: 4 } },
  ];
  assert.deepEqual(pickMethod(list, base, order), { name: "c-1", improves: true });
  const tie = [{ name: "c-1", pass: true, t: { M1: 1, M2: 0, M3: 0 } }, { name: "a-so", pass: true, t: { M1: 1, M2: 0, M3: 0 } }];
  assert.equal(pickMethod(tie, base, order).name, "a-so");
  assert.equal(pickMethod(tie, { M1: 1, M2: 0, M3: 0 }, order).improves, false);
  assert.deepEqual(pickMethod([], base, order), { name: null, improves: false });
});

test("sampleSizes: bảng chốt trước p = 0,2 / 0,3 / 0,5 → 25 / 17 / 10; ±15 điểm % ở p = 0,5 → 43", () => {
  assert.deepEqual([0.2, 0.3, 0.5].map((p) => sampleSizes(p).sign), [25, 17, 10]);
  assert.equal(sampleSizes(0.5).margin, 43);
  assert.equal(sampleSizes(0).sign, null);
});

test("tự kiểm: khối luật hiện tại trùng RULE_SHA256; khối sửa / thiếu / worktree bẩn → thoát 3", () => {
  const block = ruleBlockOf(fs.readFileSync(SRC_FILE, "utf8"));
  assert.ok(block);
  assert.equal(sha256Of(block), RULE_SHA256);
  assert.equal(selfCheck({ now: block, old: block, dirty: false }).exitCode, 0);
  const bad = block.replace("C1 A + B", "C1 A");
  assert.equal(selfCheck({ now: bad, old: block, dirty: false }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: bad, dirty: false }).exitCode, 3);
  assert.equal(selfCheck({ now: null, old: block, dirty: false }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: block, dirty: true }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: block, dirty: null }).exitCode, 3);
});

test("không có mã nhãn / tên ảnh thật trong khung đo và file test", () => {
  const allowed = new Set([CODE_7UP_DIET, BULDAK_CODE, RUAYPUAN_CODE, ...PRODUCTS.map((p) => p.code), "8930000000009"]);
  for (const f of [SRC_FILE, SELF_FILE]) {
    const text = fs.readFileSync(f, "utf8");
    const runs = text.match(/\b\d{8,14}\b/g) || [];
    for (const r of runs) assert.ok(allowed.has(r), `dãy số lạ ${r} trong ${f.pathname}`);
    assert.doesNotMatch(text, /\d{13}_\d{10,}_g\d{10,}/); // dạng tên ảnh điện thoại
  }
  // tài liệu (PLAN.md, test-ocr/README.md, CLAUDE.md): không dạng tên ảnh điện thoại
  for (const f of DOC_FILES) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /\d{13}_\d{10,}_g\d{10,}/, f.pathname);
  // có nhãn thật trên máy (ngoài git) thì kiểm thêm: không mã / tên file nào xuất hiện. Ở tài liệu, mã công khai đã có
  // trong repo từ trước (bộ A / B: ALL_CODES, cũng ở truth.csv) được phép.
  const nhanFile = "D:\\tmp\\may-chu-loc\\nhan.json";
  if (fs.existsSync(nhanFile)) {
    const nhan = JSON.parse(fs.readFileSync(nhanFile, "utf8"));
    const docAllowed = new Set([...allowed, ...ALL_CODES]);
    for (const [files, ok] of [[[SRC_FILE, SELF_FILE], allowed], [DOC_FILES, docAllowed]]) for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const x of nhan.items) {
        if (x.code && x.code !== "none" && !ok.has(x.code)) assert.equal(text.includes(x.code), false, `mã nhãn trong ${f.pathname}`);
        assert.equal(text.includes(String(x.file).slice(0, 13)), false, `tên ảnh trong ${f.pathname}`);
      }
    }
  }
});
