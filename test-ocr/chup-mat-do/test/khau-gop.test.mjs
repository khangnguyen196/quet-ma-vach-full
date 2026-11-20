// Test phần thuần của khau-gop-do.mjs (đợt khau-gop vòng 1): gộp tham số mergeLocal (tham số nền trùng serverMerge của
// src từng mục; từng cách của lưới bước 3 làm đúng việc đã chốt), phán bước 3 (G1–G5, thử đỏ / xanh), mục tiêu M1 > M2 >
// M3 + nửa giữ riêng, luật bước 4 (phân vị, chiều "chưa chắc", cổng, nửa giữ riêng), tự kiểm sha256 khối luật, file
// .loi.json, không có mã nhãn / tên ảnh thật. Vòng 2 (luật sửa 55fc738): pickStep3 không chọn cách chỉ để tham khảo,
// bảng mã WeakMap, c-rrf đổi vị trí 4–5, b-lock0 qua paramsOf, judge4 ô rỗng / không open, kiểm 120 giá trị A/B. Dữ liệu giả (danh mục mini + danh mục / kho phụ thật của app); không gọi
// mạng, không đọc dữ liệu đo ở D:\tmp (trừ nhan.json nếu có, chỉ để kiểm không lộ mã nhãn).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import * as fr from "../../../src/front-rank.js";
import { parseSearch } from "../../../src/off-search.js";
import { serverMerge, serverCandidates } from "../../../src/front-server.js";
import { ruleBlockOf, sha256Of } from "../g2-di-qua-do.mjs";
import { ALL_CODES } from "../nang-t1-do.mjs";
import {
  mergeLocal, applyGuardLocal, paramsOf, judge3, target3, pickStep3, featuresOf, quantileNR, step4Rules, isUnsure, judge4,
  pickStep4, selfCheck, resultFile, modeOf, timeCells, codeIndexOf, checkStep4Values, BASE_PARAMS, STEP3_GRID, STEP4_FEATURES,
  RULE_SHA256, RULE_SHA, RULE_SHA_GOC, RULE_SHA256_GOC, RULE_FILE, CODE_7UP_DIET, BULDAK_CODE, RUAYPUAN_CODE, SERVER_K,
} from "../khau-gop-do.mjs";
import { execSync } from "node:child_process";

const SRC_FILE = new URL("../khau-gop-do.mjs", import.meta.url);
const SELF_FILE = new URL(import.meta.url);
const DOC_FILES = ["../../../PLAN.md", "../../README.md", "../../../CLAUDE.md"].map((p) => new URL(p, import.meta.url));
const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const products = read("../../../public/chup-mat-do/danh-muc-vn.json").products;
const extra = read("../../../public/chup-mat-do/kho-phu-893.json").products;
const offReal = { ok: true, hits: parseSearch(read("../../../tests/fixtures/off-7up-ngoai.json")) };
const rIndex = fr.buildRankIndex(t1, products);
const xIndex = fr.buildRankIndex(t1, extra);
const ctx = { t1, rIndex, products };
const NET = { ok: false, kind: "network" };
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));
const codes = (l) => l.map((x) => x.code);

/** S giả: 10 mục đầu tìm trên kho phụ 893 (+ withCatalog mục danh mục chen vào đầu), qua serverCandidates như app. */
function serverS(lines, { withCatalog = 0 } = {}) {
  const r = fr.rankFromItems(t1, xIndex, itemsOf(lines), 10);
  const raw = r.hits.map((h) => { const p = extra[h.i]; return { code: p.code, name: p.name, brand: p.brand ?? "", img: p.img ?? "", text: p.text, grp: "893", score: h.score }; });
  const cat = withCatalog ? fr.rankFromItems(t1, rIndex, itemsOf(lines), withCatalog).hits.map((h) => { const p = products[h.i]; return { code: p.code, name: p.name, brand: p.brand ?? "", img: p.img ?? "", text: p.text, grp: "vn", score: h.score + 100 }; }) : [];
  return serverCandidates({ candidates: [...cat, ...raw] }).slice(0, SERVER_K);
}
const LINES = [
  ["Up", "Soda chanh", "Khong calo"], ["Mi Hao Hao", "tom chua cay"], ["Sua tuoi", "Vinamilk", "khong duong"], ["Ca phe", "G7", "hoa tan"],
  ["Banh quy", "Cosy"], ["Tra xanh", "khong do"], ["Nuoc mam", "Nam Ngu"], ["Ruaypuan", "Hanami", "prawn crackers"], ["Pepsi"], ["Hat nem", "Knorr"],
  ["Keo", "Alpenliebe"], ["Snack", "Oishi", "tom"], ["COOP", "Select", "Mui Bin Tinh Say", "IODIZES REFINED SEA SALT"], ["xyzzy qwerty"],
];

test("mergeLocal tham số nền trùng serverMerge của src từng mục (S rỗng / kho phụ / có mục danh mục; OFF lỗi / có / rỗng)", () => {
  let n = 0;
  let promoted = 0;
  for (const lines of LINES) {
    const found = fr.rankFromItems(t1, rIndex, itemsOf(lines));
    for (const S of [[], serverS(lines), serverS(lines, { withCatalog: 2 })]) {
      for (const off of [NET, { ok: false, kind: "none" }, offReal, { ok: true, hits: [] }]) {
        const want = serverMerge(ctx, found, off, S, { called: true }).merged;
        assert.deepEqual(mergeLocal(ctx, found, off, S, BASE_PARAMS), want, `${lines.join("/")} S ${S.length} off ${off.ok}`);
        assert.deepEqual(mergeLocal(ctx, found, off, S, paramsOf(null)), want);
        if (want[0]?.source === "off" && found.hits[0] && want[0].code !== found.hits[0].code) promoted++;
        n++;
      }
    }
  }
  assert.equal(n, LINES.length * 12);
  assert.ok(promoted > 0, "có ca offPromote đẩy mục máy chủ lên vị trí 1");
  // câu gõ (rankFromText)
  const typed = fr.rankFromText(t1, rIndex, "Soda chanh diet 7 up");
  assert.deepEqual(mergeLocal(ctx, typed, offReal, serverS(["Soda chanh diet 7 up"]), BASE_PARAMS), serverMerge(ctx, typed, offReal, serverS(["Soda chanh diet 7 up"]), { called: true }).merged);
});

// ---- dữ liệu mini cho từng cách ----
const MINI = [["8930000000001", "Mi tom chua cay Hao Hao"], ["8930000000002", "Mi tom Omachi"], ["8930000000003", "Mi tom Kokomi"],
  ["8930000000004", "Mi tom Gau do"], ["8930000000005", "Mi tom Vifon"], ["8930000000006", "Mi tom Miliket"], ["8930000000007", "Sua tuoi"]]
  .map(([code, text]) => ({ code, name: text, brand: "", text }));
const mI = fr.buildRankIndex(t1, MINI);
const mctx = { t1, rIndex: mI, products: MINI };
const sv = (code, text, score = 1) => ({ code, name: text, brand: "", img: "", vn: false, text, grp: "th", score });
const fMi = fr.rankFromItems(t1, mI, itemsOf(["Mi tom chua cay", "Hanami Ruaypuan"]));
// mục máy chủ ngoài danh mục mini: khớp nhiều từ (điểm cao) / ít từ
const P1 = sv("8850000000001", "Mi tom chua cay Hanami Ruaypuan");
const P2 = sv("8850000000002", "Mi tom chua cay Hanami");
const P3 = sv("8850000000003", "Ruaypuan");
const run = (name, S, off = NET, found = fMi) => mergeLocal(mctx, found, off, S, paramsOf(name));

test("lưới bước 3: đủ tên, tham số lạ báo lỗi, mọi cách chạy được", () => {
  assert.equal(Object.keys(STEP3_GRID).length, 21);
  assert.throws(() => paramsOf("x"), /cách không có/);
  for (const name of Object.keys(STEP3_GRID)) for (const S of [[], [P1, P2, P3]]) assert.ok(run(name, S).length <= 5, name);
});

test("nền: 3 vị trí khóa T1, mục máy chủ điểm cao nhất lấy chỗ offMax 1, mục thứ hai bị gạt; offPromote cần hơn 3 điểm", () => {
  const b = run(null, [P1, P2, P3]);
  assert.deepEqual(codes(b).slice(0, 3), codes(fMi.hits).slice(0, 3));
  assert.equal(b[3].code, P1.code);
  assert.equal(b.length, 5);
  assert.ok(!codes(b).includes(P2.code));
  // d-srv-max: mục máy chủ không tính offMax → P2 vào 5 (sau P1)
  const d = run("d-srv-max", [P1, P2, P3]);
  assert.ok(codes(d).includes(P2.code));
  assert.deepEqual(codes(d).slice(0, 4), codes(b).slice(0, 4));
  // P1 điểm 5,44 < điểm T1 mục 1 (2,88) + 3 → nền không đẩy; b-gap1 (gap 1) đẩy lên vị trí 1
  assert.ok(b[3].score < fMi.hits[0].score + 3 && b[3].score >= fMi.hits[0].score + 1);
  assert.equal(run("b-gap1", [P1, P2, P3])[0].code, P1.code);
  assert.equal(run("b-gap0", [P1, P2, P3])[0].code, P1.code);
});

test("b-lock0: không khóa T1 → mục máy chủ thứ hai (offMax 2 thì) lên trên mục T1 điểm thấp; b-max2 cho 2 mục máy chủ", () => {
  const m2 = run("b-max2", [P1, P2, P3]);
  assert.ok(codes(m2).includes(P2.code));
  assert.ok(!codes(run(null, [P1, P2, P3])).includes(P2.code));
  const l0 = mergeLocal(mctx, fMi, NET, [P1, P2], { ...BASE_PARAMS, lockTop: 0, offMax: 2 });
  assert.deepEqual(codes(l0).slice(0, 2), [P1.code, P2.code]);
  const l3 = mergeLocal(mctx, fMi, NET, [P1, P2], { ...BASE_PARAMS, offMax: 2 });
  assert.deepEqual(codes(l3).slice(0, 3), codes(fMi.hits).slice(0, 3)); // lockTop 3: 3 vị trí đầu giữ cho T1
});

test("b-gap / b-mw: offPromote nới gap / minWords (minWords 1 khung đo cho phép)", () => {
  // P3 khớp 1 từ: nền và b-mw2 không đẩy, b-mw1 đẩy nếu đủ gap; P3 điểm thấp → gap 0 không đủ vì điểm < T1 mục 1
  assert.notEqual(run(null, [P3])[0].code, P3.code);
  assert.notEqual(run("b-mw2", [P3])[0].code, P3.code);
  const big = sv("8850000000009", "Ruaypuan Ruaypuan Ruaypuan Hanami");
  const okMw1 = mergeLocal(mctx, fMi, NET, [big], { ...BASE_PARAMS, promoteMinWords: 1, promoteGap: 0 });
  const noMw = mergeLocal(mctx, fMi, NET, [big], { ...BASE_PARAMS, promoteMinWords: 3, promoteGap: 0 });
  assert.equal(okMw1[0].code, big.code);
  assert.notEqual(noMw[0].code, big.code);
});

test("a-top k: k vị trí đầu = S[0..k−1] theo thứ tự S (kể cả mục danh mục / khớp 0 từ), phần sau = gộp nền", () => {
  const Z = sv("8850000000005", "Zzz qqq");
  const r1 = run("a-top1", [Z, P1]);
  assert.equal(r1[0].code, Z.code);
  assert.equal(r1[0].score, 0); // khớp 0 từ → điểm 0
  const base = run(null, [Z, P1]);
  assert.deepEqual(codes(r1).slice(1), codes(base).filter((c) => c !== Z.code).slice(0, 4));
  const r3 = run("a-top3", [P3, Z, MINI[6]].map((p) => (p.grp ? p : sv(p.code, p.text))));
  assert.deepEqual(codes(r3).slice(0, 3), [P3.code, Z.code, MINI[6].code]);
  assert.equal(r3[2].source, "catalog"); // mã trong danh mục hiện bản danh mục
  assert.equal(r3.length, 5);
});

test("c-idf×: idf từ lạ đổi điểm mục máy chủ (×0,5 thấp hơn, ×1,25 cao hơn nền)", () => {
  const s = (name) => run(name, [P1]).find((x) => x.code === P1.code).score;
  assert.ok(s("c-idf0.5") < s(null));
  assert.ok(s("c-idf1.25") > s(null));
});

test("c-rrf: xếp lại phần sau lớp chặn theo RRF hạng trước chặn + hạng S; lớp chặn giữ", () => {
  const r = run("c-rrf", [P3, P2, P1]);
  assert.equal(r.length, 5);
  assert.deepEqual(codes(r).slice(0, 3), codes(run(null, [P3, P2, P1])).slice(0, 3)); // 3 vị trí khóa T1 giữ
  // W khớp 1 từ, điểm dưới các mục T1 còn lại: nền không vào 5; RRF cộng hạng S → lên vị trí 4, vị trí 4–5 KHÁC nền
  const W = sv("8850000000004", "Mi");
  const base = run(null, [W]);
  const rr = run("c-rrf", [W]);
  assert.deepEqual(codes(rr).slice(0, 3), codes(base).slice(0, 3));
  assert.deepEqual(codes(rr).slice(0, 3), codes(fMi.hits).slice(0, 3));
  assert.ok(!codes(base).includes(W.code));
  assert.equal(rr[3].code, W.code);
  assert.notDeepEqual(codes(rr).slice(3, 5), codes(base).slice(3, 5));
  assert.equal(rr[4].code, base[3].code);
});

test("b-lock0 qua paramsOf: không khóa T1 → mục máy chủ điểm cao lên vị trí 1 (nền giữ T1 ở vị trí 1)", () => {
  assert.deepEqual(paramsOf("b-lock0"), { ...BASE_PARAMS, lockTop: 0 });
  const l0 = run("b-lock0", [P1]);
  assert.equal(l0[0].code, P1.code);
  assert.equal(run(null, [P1])[0].code, fMi.hits[0].code);
  assert.deepEqual(codes(l0).slice(1), codes(fMi.hits).slice(0, 4));
});

test("codeIndexOf: bảng mã dựng một lần cho mỗi mảng products (WeakMap), mã đầu tiên thắng", () => {
  assert.equal(codeIndexOf(MINI), codeIndexOf(MINI));
  assert.equal(codeIndexOf(MINI).get("8930000000007"), 6);
  const dup = [{ code: "x" }, { code: "x" }, null, { code: 5 }];
  assert.deepEqual([...codeIndexOf(dup)], [["x", 0]]);
  assert.equal(codeIndexOf(null).size, 0);
});

test("d-lock-diem: T1 điểm dưới mục máy chủ tốt nhất (khớp ≥ 2 từ) mất khóa; d-s1-w2: S hạng 1 lên vị trí 1", () => {
  const lowFound = fr.rankFromItems(t1, mI, itemsOf(["Sua", "Mi tom chua cay Hanami Ruaypuan"]));
  const base = run(null, [P2, P1], NET, lowFound);
  const lk = run("d-lock-diem", [P2, P1], NET, lowFound);
  assert.equal(lk.length, 5);
  assert.notDeepEqual(codes(lk), codes(base));
  assert.equal(base[0].code, lowFound.hits[0].code); // nền: T1 mục 1 điểm thấp vẫn khóa vị trí 1
  assert.equal(lk[0].code, P1.code); // mất khóa: mục máy chủ điểm cao nhất lên đầu
  // S hạng 1 = P2 (khớp ≥ 2 từ, điểm ≥ T1 mục 1) → vị trí 1; nền không đẩy (thiếu gap 3)
  const s1 = run("d-s1-w2", [P2, P1]);
  assert.equal(s1[0].code, P2.code);
  assert.equal(run(null, [P2, P1])[0].code, fMi.hits[0].code);
  // S hạng 1 khớp 1 từ → như nền
  assert.deepEqual(run("d-s1-w2", [P3, P1]), run(null, [P3, P1]));
  // ghép
  assert.ok(run("g-max-s1", [P2, P1]).length === 5 && run("g-max-lock", [P2, P1]).length === 5);
});

test("applyGuardLocal: free không tính offMax", () => {
  const base = [{ code: "1", source: "catalog" }];
  const ranked = [{ code: "a", source: "off" }, { code: "b", source: "off" }, { code: "2", source: "catalog" }];
  assert.deepEqual(codes(applyGuardLocal(ranked, base, { k: 3, lockTop: 1, offMax: 1 })), ["1", "a", "2"]);
  assert.deepEqual(codes(applyGuardLocal(ranked, base, { k: 3, lockTop: 1, offMax: 1, free: new Set(["a"]) })), ["1", "a", "b"]);
});

// ---- phán bước 3 (thử đỏ / xanh) ----
const okR = () => ({
  ab: [{ id: "A|x|i", base: 1, got: 1 }, { id: "B|y|i", base: 4, got: 2 }, { id: "B|z|i", base: null, got: null }],
  good: [{ id: "anh-1|i", base: 1, got: 1 }],
  s7: { "may|i": 1, "may|ii": 1, "go|i": 1, "go|ii": 1 }, buldak: { i: BULDAK_CODE, ii: BULDAK_CODE },
  salt: { "may|i": "open", "may|ii": "open", "lui|i": "open", "lui|ii": "open" },
  foreign: { base: { top1: 10, top5: 12 }, got: { top1: 10, top5: 12 } }, time: { p95: 1, baseP95: 0.8 },
  srcSame: true, consts: { a: true }, offSame: true, luiSame: true,
});

test("judge3: xanh khi mọi cổng qua; đỏ đúng cổng (G1 mất vị trí 1 / rơi khỏi 5, G2, G3, G4, G5)", () => {
  assert.equal(judge3(okR()).pass, true);
  const bad = (fn, gate) => { const r = okR(); fn(r); const v = judge3(r); assert.equal(v.pass, false, gate); assert.equal(v.gates[gate], false, gate); };
  bad((r) => { r.ab[0].got = 2; }, "G1");
  bad((r) => { r.ab[1].got = null; }, "G1");
  bad((r) => { r.luiSame = false; }, "G1");
  bad((r) => { r.good[0].got = 3; }, "G2");
  bad((r) => { r.good = []; }, "G2");
  bad((r) => { r.s7["go|ii"] = 2; }, "G3");
  bad((r) => { r.buldak.i = "x"; }, "G3");
  bad((r) => { r.salt["lui|i"] = "none"; }, "G3");
  bad((r) => { r.foreign.got.top5 = 11; }, "G3");
  bad((r) => { r.time = { p95: 51, baseP95: 40 }; }, "G4");
  bad((r) => { r.time = { p95: 1.7, baseP95: 0.8 }; }, "G4");
  bad((r) => { r.time = { p95: null, baseP95: 0.8 }; }, "G4");
  bad((r) => { r.srcSame = false; }, "G5");
  bad((r) => { r.consts.b = false; }, "G5");
  bad((r) => { r.offSame = false; }, "G5");
  // A / B: ô nền ngoài 5 lên trong 5 không phải mất
  const r = okR();
  r.ab[2].got = 3;
  assert.equal(judge3(r).pass, true);
});

const row = (img, group, base, got, folder = "1-ra-dung", preset = false, cond = "i") => ({ id: `anh-${img}|${cond}`, img, group, folder, preset, base, got });

test("target3 / pickStep3: M1 chỉ đếm ô xếp hạng sai ở nửa chỉnh; giữ riêng mất ô → không giữ; M1 > M2 > M3 > thứ tự lưới", () => {
  const rows = [row(1, "chinh", 3, 1), row(1, "chinh", 3, 1, "1-ra-dung", false, "ii"), row(2, "chinh", null, 4), row(3, "chinh", 1, 1), row(4, "giu", 1, 1), row(5, "giu", 2, 2)];
  const t = target3(rows);
  assert.deepEqual([t.M1, t.M2, t.M3, t.holdOk], [2, 3, 3, true]);
  assert.deepEqual(t.refOnly, ["chỉ nhờ 1 ảnh"]);
  assert.equal(target3([...rows.slice(0, 5), row(5, "giu", 2, null)]).holdOk, false);
  assert.equal(target3([...rows.slice(0, 5), row(4, "giu", 1, 2, "1-ra-dung", false, "ii")]).holdOk, false);
  // thư mục 2 / preset
  assert.deepEqual(target3([row(9, "chinh", 2, 1, "2-ma-vach-ra")]).refOnly, ["chỉ nhờ 1 ảnh", "chỉ nhờ ảnh thư mục 2"]);
  assert.ok(target3([row(9, "chinh", 2, 1, "1-ra-dung", true)]).refOnly.includes("chỉ nhờ ảnh preset"));
  // giữ riêng không tính vào M
  assert.equal(target3([row(7, "giu", 4, 1)]).M1, 0);
  const T = (M1, M2, M3, holdOk = true) => ({ M1, M2, M3, holdOk, refOnly: [] });
  assert.deepEqual(pickStep3([{ name: "b-lock0", pass: true, t: T(2, 2, 5) }, { name: "b-lock2", pass: true, t: T(2, 2, 5) }, { name: "a-top1", pass: true, t: T(2, 3, 1) }]).name, "a-top1");
  assert.equal(pickStep3([{ name: "b-lock0", pass: true, t: T(2, 2, 5) }, { name: "b-lock2", pass: true, t: T(2, 2, 5) }]).name, "b-lock2");
  assert.equal(pickStep3([{ name: "b-lock2", pass: false, t: T(4, 4, 4) }]).name, null);
  assert.equal(pickStep3([{ name: "b-lock2", pass: true, t: T(0, 4, 4) }]).name, null); // M1 không hơn nền
  assert.equal(pickStep3([{ name: "b-lock2", pass: true, t: T(2, 4, 4, false) }]).name, null); // giữ riêng mất
  assert.equal(pickStep3([{ name: "khac", pass: true, t: T(9, 9, 9) }]).name, null);
});

test("pickStep3 (luật sửa vòng 2): cách chỉ để tham khảo KHÔNG được chọn, vẫn ghi tên / lý do / M1 M2 M3", () => {
  const T = (M1, M2, M3, refOnly = []) => ({ M1, M2, M3, holdOk: true, refOnly });
  // chỉ một cách được giữ và nó chỉ để tham khảo → không chọn
  const only = pickStep3([{ name: "b-gap1", pass: true, t: T(2, 2, 6, ["chỉ nhờ 1 ảnh"]) }, { name: "b-lock2", pass: false, t: T(4, 4, 4) }]);
  assert.equal(only.name, null);
  assert.deepEqual(only.kept, ["b-gap1"]);
  assert.deepEqual(only.refOnly, [{ name: "b-gap1", reasons: ["chỉ nhờ 1 ảnh"], M1: 2, M2: 2, M3: 6 }]);
  // có cách thường → chọn cách thường dù M1 thấp hơn cách tham khảo
  const mix = pickStep3([
    { name: "b-lock2", pass: true, t: T(6, 6, 8, ["chỉ nhờ ảnh thư mục 2"]) },
    { name: "a-top1", pass: true, t: T(2, 3, 7) },
    { name: "c-rrf", pass: true, t: T(4, 4, 8, ["chỉ nhờ ảnh preset", "chỉ nhờ 1 ảnh"]) },
  ]);
  assert.equal(mix.name, "a-top1");
  assert.deepEqual(mix.kept, ["b-lock2", "c-rrf", "a-top1"]);
  assert.deepEqual(mix.refOnly.map((x) => x.name), ["b-lock2", "c-rrf"]);
  // nối với target3: M1 chỉ nhờ 1 ảnh → refOnly → không chọn
  const t = target3([row(1, "chinh", 3, 1), row(1, "chinh", 3, 1, "1-ra-dung", false, "ii"), row(4, "giu", 1, 1)]);
  assert.deepEqual(t.refOnly, ["chỉ nhờ 1 ảnh"]);
  assert.equal(pickStep3([{ name: "b-lock1", pass: true, t }]).name, null);
  const t2 = target3([row(1, "chinh", 3, 1), row(2, "chinh", 2, 1), row(4, "giu", 1, 1)]);
  assert.deepEqual(t2.refOnly, []);
  assert.equal(pickStep3([{ name: "b-lock1", pass: true, t: t2 }]).name, "b-lock1");
});

test("checkStep4Values: mỗi đặc trưng đúng 120 giá trị A/B; thiếu / thừa / không có → lệch (đỏ)", () => {
  const full = Object.fromEntries(STEP4_FEATURES.map((f) => [f, Array.from({ length: 120 }, (_, i) => i)]));
  const ok = checkStep4Values(full);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.bad, []);
  assert.equal(checkStep4Values({ ...full, diem: full.diem.slice(1) }).ok, false);
  assert.deepEqual(checkStep4Values({ ...full, diem: full.diem.slice(1) }).bad, ["diem"]);
  assert.deepEqual(checkStep4Values({ ...full, "ty-le": [...full["ty-le"], 1] }).bad, ["ty-le"]);
  const { "hang-may-chu": _drop, ...miss } = full;
  assert.deepEqual(checkStep4Values(miss).bad, ["hang-may-chu"]);
  assert.equal(checkStep4Values(null).ok, false);
});

// ---- bước 4 ----
test("featuresOf: 5 đặc trưng, mục 2 thiếu / điểm 0 → tỷ lệ +∞, hạng không có = 11", () => {
  const f = featuresOf([{ code: "a", score: 12 }, { code: "b", score: 4 }], { matched: 2, queryN: 4, sCodes: ["x", "a"] });
  assert.deepEqual(f, { diem: 12, "ty-le": 3, "khoang-cach": 8, "ty-le-tu": 0.5, "hang-may-chu": 2 });
  const g = featuresOf([{ code: "a", score: 7 }], { matched: 0, queryN: 0, sCodes: [] });
  assert.deepEqual(g, { diem: 7, "ty-le": Infinity, "khoang-cach": 7, "ty-le-tu": 0, "hang-may-chu": SERVER_K + 1 });
  assert.equal(featuresOf([], { matched: 0, queryN: 1, sCodes: [] }), null);
  assert.deepEqual(Object.keys(f), [...STEP4_FEATURES]);
});

test("quantileNR + step4Rules: phân vị nearest rank; f1–f4 '< ngưỡng', f5 phân vị 100 − p và '> ngưỡng'", () => {
  const xs = Array.from({ length: 120 }, (_, i) => i + 1);
  assert.equal(quantileNR(xs, 0.1), 12);
  assert.equal(quantileNR(xs, 0.5), 60);
  assert.equal(quantileNR(xs, 0.9), 108);
  assert.equal(quantileNR([3, Infinity, 1], 1), Infinity);
  assert.equal(quantileNR([], 0.5), null);
  const vals = Object.fromEntries(STEP4_FEATURES.map((f) => [f, xs]));
  const rules = step4Rules(vals);
  assert.equal(rules.length, 25);
  const d10 = rules.find((r) => r.name === "diem-p10");
  assert.deepEqual([d10.thr, d10.dir], [12, "lt"]);
  const h10 = rules.find((r) => r.name === "hang-may-chu-p10");
  assert.deepEqual([h10.thr, h10.dir], [108, "gt"]);
  assert.equal(isUnsure(d10, { diem: 11.9 }), true);
  assert.equal(isUnsure(d10, { diem: 12 }), false); // bằng ngưỡng = chắc
  assert.equal(isUnsure(h10, { "hang-may-chu": 109 }), true);
  assert.equal(isUnsure(h10, { "hang-may-chu": 108 }), false);
  assert.equal(isUnsure(d10, null), false);
});

test("judge4 / pickStep4 (thử đỏ / xanh): cổng giữ tự mở, mục tiêu thư mục 3 theo ảnh (cả (i) và (ii)), nửa giữ riêng ≥ 1", () => {
  const rule = { name: "diem-p10", feature: "diem", thr: 10, dir: "lt" };
  const cell = (id, o) => ({ id, set: "that", cond: "i", feats: { diem: 20 }, ...o });
  const cells = [
    cell("A1", { set: "A", good: true, feats: { diem: 15 } }), cell("A2", { set: "A", wrongAB: true, feats: { diem: 5 } }),
    cell("n1i", { none3: true, group: "chinh", img: 17, feats: { diem: 5 } }), cell("n1ii", { none3: true, group: "chinh", img: 17, cond: "ii", feats: { diem: 6 } }),
    cell("n2i", { none3: true, group: "chinh", img: 18, feats: { diem: 5 } }), cell("n2ii", { none3: true, group: "chinh", img: 18, cond: "ii", feats: { diem: 50 } }),
    cell("n3i", { none3: true, group: "giu", img: 19, feats: { diem: 1 } }), cell("n3ii", { none3: true, group: "giu", img: 19, cond: "ii", feats: { diem: 2 } }),
    cell("m", { set: "muoi", salt: true, feats: { diem: 3 } }),
  ];
  const r = judge4(rule, cells);
  assert.deepEqual([r.pass, r.tChinh, r.tGiu, r.abUnsure, r.abWrongUnsure, r.saltUnsure], [true, 1, 1, 1, 1, 1]);
  // đỏ: một ô đang đúng (good) bị chuyển → trượt cổng
  const red = judge4(rule, [...cells, cell("7up", { set: "7up", good: true, feats: { diem: 9 } })]);
  assert.equal(red.pass, false);
  assert.deepEqual(red.gateFails, ["7up"]);
  // muối (ca âm) không phải cổng
  assert.equal(judge4(rule, cells.filter((c) => c.id !== "A2")).pass, true);
  const list = [
    { name: "diem-p10", r: { pass: true, tChinh: 1, tGiu: 1, abUnsure: 5 } },
    { name: "diem-p20", r: { pass: true, tChinh: 1, tGiu: 1, abUnsure: 3 } },
    { name: "ty-le-p10", r: { pass: true, tChinh: 2, tGiu: 0, abUnsure: 1 } },
    { name: "ty-le-p20", r: { pass: false, tChinh: 3, tGiu: 3, abUnsure: 1 } },
  ];
  assert.deepEqual(pickStep4(list), { name: "diem-p20", kept: ["diem-p20", "diem-p10"] });
  assert.equal(pickStep4([list[2], list[3]]).name, null); // giữ riêng 0 / trượt cổng
});

test("judge4: ô thư mục 3 có danh sách gộp rỗng (feats null) hoặc kind khác open → 'không tự mở' (thử đỏ / xanh)", () => {
  const rule = { name: "diem-p10", feature: "diem", thr: 10, dir: "lt" };
  const cell = (id, o) => ({ id, set: "that", cond: "i", none3: true, open: true, ...o });
  // ảnh 17 (chỉnh): (i) danh sách rỗng, (ii) điểm thấp → không tự mở cả hai ô
  // ảnh 19 (giữ): (i) kind "none" (open false) dù điểm cao, (ii) điểm thấp → không tự mở cả hai ô
  // ảnh 18 (chỉnh): (i) rỗng, (ii) open + điểm cao → vẫn tự mở ở (ii) → không tính
  const cells = [
    cell("17i", { group: "chinh", img: 17, feats: null, open: false }), cell("17ii", { group: "chinh", img: 17, cond: "ii", feats: { diem: 3 } }),
    cell("19i", { group: "giu", img: 19, feats: { diem: 30 }, open: false }), cell("19ii", { group: "giu", img: 19, cond: "ii", feats: { diem: 3 } }),
    cell("18i", { group: "chinh", img: 18, feats: null }), cell("18ii", { group: "chinh", img: 18, cond: "ii", feats: { diem: 30 } }),
  ];
  const r = judge4(rule, cells);
  assert.equal(r.tChinh, 1);
  assert.equal(r.tGiu, 1);
  // feats null mà không có cờ open (ô cũ) cũng tính không tự mở
  assert.equal(judge4(rule, [cell("a", { group: "giu", img: 20, feats: null, open: undefined })]).tGiu, 1);
  // ô open + điểm cao → tự mở → không tính
  assert.equal(judge4(rule, [cell("b", { group: "giu", img: 21, feats: { diem: 30 } })]).tGiu, 0);
});

test("timeCells: p50 / p95 của thời gian trung bình mỗi ô", () => {
  const t = timeCells([1, 2, 3], () => {}, { repeat: 2, warm: 1 });
  assert.equal(t.n, 3);
  assert.ok(Number.isFinite(t.p95) && t.p95 >= t.p50);
});

test("modeOf / resultFile: đúng một cờ; kiểm chéo lệch → .loi.json + thoát 3, không phải file chính", () => {
  assert.equal(modeOf(["--chi-nen"]), "nen");
  assert.equal(modeOf(["--do-cach", "--ghi-de"]), "do");
  assert.equal(modeOf(["--do-nguong"]), "nguong");
  assert.equal(modeOf([]), null);
  assert.equal(modeOf(["--chi-nen", "--do-cach"]), null);
  const ok = resultFile("D:\\x", "nen", true);
  const bad = resultFile("D:\\x", "nen", false);
  assert.match(ok.file, /nen\.json$/);
  assert.equal(ok.exitCode, 0);
  assert.match(bad.file, /nen\.loi\.json$/);
  assert.equal(bad.exitCode, 3);
  assert.match(resultFile("D:\\x", "nguong", false).file, /nguong\.loi\.json$/);
});

test("tự kiểm: khối luật hiện tại trùng RULE_SHA256; khối sửa / thiếu / worktree bẩn → thoát 3", () => {
  const block = ruleBlockOf(fs.readFileSync(SRC_FILE, "utf8"));
  assert.ok(block);
  assert.equal(sha256Of(block), RULE_SHA256);
  assert.equal(selfCheck({ now: block, old: block, dirty: false }).exitCode, 0);
  const bad = block.replace("G1 A + B 60 ảnh", "G1 A + B 59 ảnh");
  assert.notEqual(bad, block);
  assert.equal(selfCheck({ now: bad, old: block, dirty: false }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: bad, dirty: false }).exitCode, 3);
  assert.equal(selfCheck({ now: null, old: block, dirty: false }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: null, dirty: false }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: block, dirty: true }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: block, dirty: null }).exitCode, 3);
});

test("luật sửa vòng 2: khối ở RULE_SHA trùng từng byte khối hiện tại; khối luật gốc khác, sha256 gốc giữ", () => {
  assert.equal(RULE_SHA, "55fc738");
  assert.equal(RULE_SHA_GOC, "b954513");
  const cwd = new URL("../../../", import.meta.url);
  const atRule = execSync(`git show ${RULE_SHA}:${RULE_FILE}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();
  const atGoc = execSync(`git show ${RULE_SHA_GOC}:${RULE_FILE}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();
  const block = ruleBlockOf(fs.readFileSync(SRC_FILE, "utf8"));
  assert.equal(ruleBlockOf(atRule), block);
  assert.equal(selfCheck({ now: block, old: ruleBlockOf(atRule), dirty: false }).exitCode, 0);
  const goc = ruleBlockOf(atGoc);
  assert.equal(sha256Of(goc), RULE_SHA256_GOC);
  assert.notEqual(goc, block);
  assert.equal(selfCheck({ now: block, old: goc, dirty: false }).exitCode, 3);
  assert.match(block, /Sửa luật 2026-11-20 vòng 2 \(LỆCH LUẬT/);
  assert.match(block, /KHÔNG được chọn/);
  assert.match(block, /nền đo bằng mergeLocal tham số nền \(BASE_PARAMS\)/);
});

test("không có mã nhãn / tên ảnh thật trong khung đo, file test và tài liệu", () => {
  const allowed = new Set([CODE_7UP_DIET, BULDAK_CODE, RUAYPUAN_CODE, ...MINI.map((p) => p.code), P1.code, P2.code, P3.code, "8850000000004", "8850000000005", "8850000000009"]);
  for (const f of [SRC_FILE, SELF_FILE]) {
    const runs = fs.readFileSync(f, "utf8").match(/\b\d{8,14}\b/g) || [];
    for (const r of runs) assert.ok(allowed.has(r), `dãy số lạ ${r} trong ${f.pathname}`);
  }
  // tên ảnh điện thoại: 13 số _ ≥ 10 số _ (g)? ≥ 10 số (mẫu dựng lúc chạy)
  const NAME_RE = /\d{13}_\d{10,}_g?\d{10,}/;
  assert.match(`${"1".repeat(13)}_${"2".repeat(19)}_g${"3".repeat(19)}`, NAME_RE);
  for (const f of [SRC_FILE, SELF_FILE, ...DOC_FILES]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), NAME_RE, f.pathname);
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
