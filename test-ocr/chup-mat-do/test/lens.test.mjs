// Test phần thuần của lens-do.mjs (đợt lens vòng 1): RRF có trọng số, tầng máy chủ S0–S3, tầng app A0–A2 (A1 vượt
// lockTop, tính vào offMax), ngưỡng "không chắc" U (phân vị không dùng nhãn), R1 tính "không chắc" = mất vị trí 1,
// ca không có ảnh (7Up) nhánh ảnh tắt = nền, chống ăn gian (cùng imgid / mã băm gần → loại), chọn model, cổng dừng sớm,
// mục tiêu M1–M3 + chỉ để tham khảo, đọc .npy, tự kiểm sha256 khối luật. Mỗi luật có chuỗi / mẫu sai chứng minh test bắt
// được. Dữ liệu giả + danh mục / kho phụ thật của app; không gọi mạng, không đọc dữ liệu đo ở D:\tmp.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as t1 from "../../../public/chup-mat-do/t1.mjs";
import * as fr from "../../../src/front-rank.js";
import { serverMerge, serverCandidates } from "../../../src/front-server.js";
import { ruleBlockOf, sha256Of } from "../g2-di-qua-do.mjs";
import { mergeLocal, BASE_PARAMS } from "../khau-gop-do.mjs";
import {
  rrfFuse, serverTier, imageRank, lensOf, isUnsureU, appTier, cellOf, judgeR, targetsM, achieves, pickMethod, pickModel,
  earlyGate, gateG2, chooseSubstitute, parseNpy, percentiles, methodGrid, selfCheck, modeOf, qidOf, indexBytesInt8,
  guardWant, checkIndexGuard, RULE_SHA256, RULE_SHA, RULE_FILE, METHOD_COUNT, GOOD_IMGS, BULDAK_CODE, R7_MAX_BYTES,
  HASH_OK_MIN, S_GRID, OLD_RULE_SHA, OLD_RULE_SHA256, G3_P_MIN, G3_SMALL, PREV_RULE_SHA, PREV_RULE_SHA256,
  rowView, simsFrom, VEC_VARIANTS, NO_VEC_VARIANTS, variantPlan, r6From, rowCheck,
} from "../lens-do.mjs";

/** Buffer .npy float32 (C order) trong bộ nhớ, cho test simsFrom không cần file. */
function npyOf(shape, values) {
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(", ")}), }`;
  const pad = 64 - ((10 + header.length + 1) % 64);
  const h = header + " ".repeat(pad) + "\n";
  const b = Buffer.alloc(10 + h.length + 4 * values.length);
  b.writeUInt8(0x93, 0);
  b.write("NUMPY", 1, "latin1");
  b.writeUInt8(1, 6);
  b.writeUInt8(0, 7);
  b.writeUInt16LE(h.length, 8);
  b.write(h, 10, "latin1");
  values.forEach((x, i) => b.writeFloatLE(x, 10 + h.length + 4 * i));
  return b;
}
import { execSync } from "node:child_process";

const SRC = fs.readFileSync(new URL("../lens-do.mjs", import.meta.url), "utf8");
const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const products = read("../../../public/chup-mat-do/danh-muc-vn.json").products;
const extra = read("../../../public/chup-mat-do/kho-phu-893.json").products;
const rIndex = fr.buildRankIndex(t1, products);
const xIndex = fr.buildRankIndex(t1, extra);
const ctx = { t1, rIndex, products };
const NET = { ok: false, kind: "network" };
const itemsOf = (lines, score = 0.95) => lines.map((text, k) => ({ text, poly: [[10, 10 + k * 60], [410, 10 + k * 60], [410, 50 + k * 60], [10, 50 + k * 60]], score }));
const codes = (l) => l.map((x) => x.code);
function serverS(lines) {
  const r = fr.rankFromItems(t1, xIndex, itemsOf(lines), 10);
  return serverCandidates({ candidates: r.hits.map((h) => { const p = extra[h.i]; return { code: p.code, name: p.name, brand: p.brand ?? "", img: p.img ?? "", text: p.text, grp: "893", score: h.score }; }) });
}
const caseOf = (lines) => ({ found: fr.rankFromItems(t1, rIndex, itemsOf(lines)), off: { i: NET, ii: NET }, called: true });

test("khối luật: sha256 trùng RULE_SHA256; đổi 1 ký tự → tự kiểm đỏ (thử đỏ / xanh)", () => {
  const block = ruleBlockOf(SRC);
  assert.ok(block && block.includes("LUẬT CHỐT TRƯỚC") && block.includes("HẾT KHỐI LUẬT"));
  assert.equal(sha256Of(block), RULE_SHA256);
  assert.equal(selfCheck({ now: block, old: null, dirty: false }, { ruleSha: null }).exitCode, 0);
  const bad = block.replace("R1 60 ảnh", "R1 61 ảnh");
  assert.notEqual(bad, block);
  assert.equal(selfCheck({ now: bad, old: null, dirty: false }, { ruleSha: null }).exitCode, 3);
  assert.equal(selfCheck({ now: block, old: null, dirty: true }, { ruleSha: null }).exitCode, 3, "worktree bẩn → không đo");
  assert.equal(selfCheck({ now: block, old: bad, dirty: false }, { ruleSha: "abc1234" }).exitCode, 3, "khác từng byte commit luật");
  assert.equal(selfCheck({ now: block, old: block, dirty: false }, { ruleSha: "abc1234" }).exitCode, 0);
  assert.equal(modeOf(["--do"]), "do");
  assert.equal(modeOf(["--do", "--cong"]), null);
});

/** Khối luật ở một commit (git show); không có git / không có commit → null. */
function blockAt(sha) {
  try {
    return ruleBlockOf(execSync(`git show ${sha}:${RULE_FILE}`, { cwd: new URL("../../..", import.meta.url), stdio: ["ignore", "pipe", "ignore"] }).toString("utf8"));
  } catch { return null; }
}

test("khối luật hiện tại trùng từng byte commit luật RULE_SHA (git show)", (t) => {
  // gợi ý 7 của code-reviewer trước đo: bỏ nhánh RULE_SHA === null (code chết từ khi RULE_SHA đã đặt)
  assert.match(RULE_SHA, /^[0-9a-f]{7}$/);
  const old = blockAt(RULE_SHA);
  // gợi ý 2 của code-reviewer vòng 1: không âm thầm bỏ qua; thiếu git / commit thì skip CÓ lý do (hiện trong kết quả test)
  if (old === null) { t.skip(`không chạy được git show ${RULE_SHA} (không có git hoặc thiếu commit)`); return; }
  assert.equal(old, ruleBlockOf(SRC), `khối luật khác commit ${RULE_SHA}`);
});

test("LỆCH LUẬT 1: khối GỐC ở 81d04e5 vẫn đúng sha256 cũ; khối mới khác khối gốc và ghi rõ lý do + sha khối cũ", (t) => {
  assert.equal(OLD_RULE_SHA, "81d04e5");
  assert.equal(OLD_RULE_SHA256, "d0d5a1ffa510a5dae2a411cdf76fdbd4a9f328d9e7f5c77208db830d72db165a");
  const now = ruleBlockOf(SRC);
  assert.notEqual(RULE_SHA256, OLD_RULE_SHA256);
  for (const s of ["LỆCH LUẬT 1", "BỘ P", "loo.json", "|P| < 10", "không đủ", "KHÔNG chặn", "nửa CHỈNH", "d0d5a1ffa510a5dae2a411cdf76fdbd4a9f328d9e7f5c77208db830d72db165a", "81d04e5"]) {
    assert.ok(now.includes(s), `khối mới thiếu ${s}`);
  }
  const old = blockAt(OLD_RULE_SHA);
  if (old === null) { t.skip(`không chạy được git show ${OLD_RULE_SHA} (không có git hoặc thiếu commit)`); return; }
  assert.equal(sha256Of(old), OLD_RULE_SHA256, "khối gốc ở 81d04e5 không đổi");
  assert.notEqual(old, now);
  // phần giữ nguyên: R1 cho cả 60 ảnh, lưới 9.512, G1, G2 (so từng dòng)
  for (const line of old.split("\n").filter((l) => /R1 60 ảnh|9\.512 cách|G1 trong 7 ảnh|G2 ≥ 2 \/ 6 ảnh/.test(l))) assert.ok(now.includes(line), `dòng gốc bị đổi: ${line}`);
});

// ---- So chặt từng byte giữa các bản khối luật (gợi ý 1 của code-reviewer trước đo): bỏ các dòng ĐƯỢC PHÉP đổi (liệt kê
// tường minh dưới đây) khỏi 2 khối rồi phần còn lại phải trùng từng byte, theo đúng thứ tự. ----
const lines = (s) => s.split("\n").filter((l) => l !== "");
/** 81d04e5 → 4424292 (LỆCH LUẬT 1): dòng bỏ khỏi khối cũ / dòng thêm vào khối mới. */
const L1_REMOVED = lines(String.raw`//     int8 + 2 byte thang / vector + mã ≤ 25.000.000 byte); (2) A / B top 5 chỉ ảnh: số mã A / B đo được (không bị loại,
//     có trong chỉ mục) có mã đúng trong 5 hạng ảnh đầu — lớn; (3) ảnh thật top 5 chỉ ảnh, nửa CHỈNH (ảnh có nhãn mã thư
//     mục 1 + 2) — lớn; (4) hòa → giấy phép Apache-2.0 trước, rồi model nhẹ hơn (cỡ file ONNX nhỏ), rồi "cat" trước "vien".
//   G3 A / B đo được: tỉ lệ mã có mã đúng trong 5 hạng ảnh đầu ≥ 50 %.
`);
const L1_ADDED = lines(String.raw`//   BỘ P (LỆCH LUẬT 1): P = mã A / B đo được (có ảnh thay hợp lệ, có trong chỉ mục (a); đếm 1 lần mỗi mã; ảnh truy vấn =
//     ảnh đo, ảnh chỉ mục = ảnh thay) ∪ cặp VN leave-one-out của D:\tmp\chup-mat-do\chi-muc\loo.json có mã trong danh mục
//     (a) và không trùng mã A / B. Ảnh truy vấn của cặp = ảnh queryImgid. Ảnh chỉ mục của mã đó: giữ khóa danh mục nếu
//     imgid KHÁC queryImgid và mã băm vùng giữa (cách của lens: sharp xám, cạnh 256, cropHashSet / compareHashSets) > 24
//     bit; không thì dùng ảnh indexImgid (override), cũng phải > 24 bit; không đạt thì bỏ cặp. Truy vấn P chỉ dùng cho G3
//     và chọn model, KHÔNG vào R1–R5 / M.
//     int8 + 2 byte thang / vector + mã ≤ 25.000.000 byte); (2) ảnh thật nửa CHỈNH có nhãn mã (thư mục 1 + 2) mà mã có
//     trong chỉ mục (a): số ảnh có mã đúng trong top 5 chỉ ảnh — lớn; (3) bộ P top 5 chỉ ảnh: số mã P có mã đúng trong 5
//     hạng ảnh đầu — lớn; (4) hòa → giấy phép Apache-2.0 trước, rồi model nhẹ hơn (cỡ file ONNX nhỏ), rồi "cat" trước
//     "vien".
//   G3 (LỆCH LUẬT 1) bộ P: |P| ≥ 10 → G3 = tỉ lệ mã P có mã đúng trong 5 hạng ảnh đầu ≥ 50 %. |P| < 10 → G3 = "không đủ
//      mẫu", KHÔNG chặn (cổng = G1 HOẶC G2), ghi rõ.
// ---- LỆCH LUẬT 1 (vòng 2, viết 2026-11-20 khoảng 23:4x +0700, TRƯỚC mọi phép tính độ giống ảnh trên ca có nhãn) ----
//   Lý do: chống ăn gian loại gần cả bộ A / B (ảnh mặt trước duy nhất trên OFF chính là ảnh đo; vài mã có ảnh khác nhưng
//   mã băm gần ảnh đo), nên G3 cũ ("≥ 50 % mã A / B đo được") và bước (2) chọn model cũ ("A / B top 5") chỉ còn dựa trên
//   1–2 mã. dieu-phoi quyết ở vòng 2 sửa đúng 3 điểm: (i) thêm BỘ P (mục "Chọn model"); (ii) G3 tính trên bộ P, |P| < 10
//   thì không chặn; (iii) thứ tự chọn model xét ảnh thật nửa chỉnh trước, bộ P sau. Mọi phần khác giữ nguyên (R1 cho cả
//   60 ảnh với sản phẩm bị loại xóa khỏi chỉ mục; τ / μ theo phân vị trên 60 ô A / B; G1, G2; lưới 9.512 cách). Khối
//   cũ: commit 81d04e5, sha256 d0d5a1ffa510a5dae2a411cdf76fdbd4a9f328d9e7f5c77208db830d72db165a.
export const G3_P_MIN = 10;
export const G3_SMALL = "khong-du-mau";
`);
/** 4424292 → LỆCH LUẬT 2: đúng 3 điểm (ẩn theo hàng + dòng τ / μ, R6 1.600 px, override bộ P chỉ mức a) + đoạn lý do. */
const L2_REMOVED = lines(String.raw`//     min của 2 mã băm) > 24 bit. Không có → mã "loại khỏi đo ảnh": sản phẩm BỊ XÓA khỏi chỉ mục ảnh (mọi mức), ca vẫn
//     lens.margin, tính trên 60 ô ảnh A / B (30 mã × 2 bộ; đã chống ăn gian; mã bị loại vẫn tính với chỉ mục đã xóa mã)
`);
const L2_ADDED = lines(String.raw`//     min của 2 mã băm) > 24 bit. Không có → mã "loại khỏi đo ảnh": sản phẩm bị ẨN trên hàng của chính truy vấn ab-<mã>
//     (mọi mức, mọi chỗ dùng độ giống: hạng ảnh toàn cục, lens, sim ứng viên, S1/S2/S3, τ/μ): trên hàng đó mã coi như
//     không có ảnh. Mọi truy vấn khác (ab khác, ảnh thật, buldak, ruaypuan, bộ P) thấy chỉ mục đầy đủ, mã dùng khóa ảnh
//     danh mục (LỆCH LUẬT 2). Ca vẫn
//     lens.margin, tính trên 60 ô ảnh A / B (30 mã × 2 bộ; đã chống ăn gian; mã bị loại vẫn tính với chỉ mục đã ẩn mã trên hàng đó)
//      Số R6 dùng cho bước chọn model (1) và cho cổng R6 (LỆCH LUẬT 2) = số đo trên ảnh truy vấn thu cạnh dài 1.600 px,
//      JPEG chất lượng 0,9 (như prepareImage), máy rảnh; thiếu số của biến thể → không chọn (thoát mã 3).
//     (LỆCH LUẬT 2) Ảnh chỉ mục riêng (override) của bộ P chỉ áp ở chỉ mục (a); override chống ăn gian của mã A / B
//     (8935049501503 → front_ru.17) áp mọi mức như cũ.
// ---- LỆCH LUẬT 2 (vòng 2 lượt 2b-1, viết 2026-11-21 khoảng 00:0x +0700, TRƯỚC mọi phép tính độ giống ảnh trên ca có
//   nhãn: D:\tmp\lens\vec chưa tồn tại) ----
//   Lý do: ảnh thật #1 (1 trong 8 ảnh đang đúng) có mã đúng thuộc 29 mã A / B bị loại; câu cũ "sản phẩm BỊ XÓA khỏi chỉ
//   mục ảnh (mọi mức)" mâu thuẫn với "Ảnh thật / buldak / ruaypuan: chỉ mục dùng ảnh OFF bình thường" (xóa thì #1 mất mã
//   đúng khỏi chỉ mục, đo trong tình huống app thật không gặp). dieu-phoi quyết sửa đúng 3 điểm: (i) mã bị loại chỉ bị ẨN
//   trên hàng của chính truy vấn ab-<mã>, truy vấn khác thấy chỉ mục đầy đủ (mục CHỐNG ĂN GIAN; dòng τ / μ đổi "đã xóa
//   mã" thành "đã ẩn mã trên hàng đó"; câu "R1 cho cả 60 ảnh với sản phẩm bị loại xóa khỏi chỉ mục" trong đoạn LỆCH LUẬT
//   1 giữ nguyên văn, từ nay đọc là "ẩn trên hàng ab-<mã>"); (ii) số R6 cho bước chọn model (1) và cổng R6 = số đo ảnh
//   1.600 px JPEG 0,9, máy rảnh, thiếu số → không chọn (thoát mã 3) (mục R6); (iii) override ảnh của bộ P chỉ ở mức (a),
//   override A / B mọi mức (mục BỘ P). Mọi phần khác giữ nguyên. Khối trước: commit 4424292, sha256
//   e4a6753fd856a9585ac040263a4c62de58e280d5e68773e91391b9d06a02211a.
`);

/**
 * So chặt (gợi ý 1 của code-reviewer trước đo lần 2): các dòng được phép (removed trong oldB, added trong newB) phải
 * xuất hiện ĐÚNG số lần như trong danh sách và ĐÚNG thứ tự danh sách (khớp lần lượt từ trên xuống); bỏ đúng các lần xuất
 * hiện đó đi thì phần còn lại trùng từng byte (cùng thứ tự). Dời dòng được phép sai thứ tự hoặc chép thêm một bản → lỗi.
 * Trả mảng lỗi (rỗng = đạt).
 */
function strictBlockDiff(oldB, newB, removed, added) {
  const errs = [];
  const take = (lines, allowed, what, where) => {
    const used = new Set();
    let from = 0;
    for (const l of allowed) {
      const i = lines.indexOf(l, from);
      if (i < 0) { errs.push(`${what} không có (hoặc sai thứ tự) trong ${where}: ${l}`); continue; }
      used.add(i);
      from = i + 1;
    }
    for (const l of new Set(allowed)) {
      const want = allowed.filter((x) => x === l).length;
      const got = lines.filter((x) => x === l).length;
      if (got !== want) errs.push(`${what} xuất hiện ${got} lần trong ${where} (phải ${want}): ${l}`);
    }
    return lines.filter((_, i) => !used.has(i)).join("\n");
  };
  const restO = take(oldB.split("\n"), removed, "dòng bỏ", "khối cũ");
  const restN = take(newB.split("\n"), added, "dòng thêm", "khối mới");
  if (restO !== restN) errs.push("phần còn lại khác từng byte");
  return errs;
}

test("LỆCH LUẬT 2: khối 4424292 đúng sha256 cũ; so chặt 4424292 → khối hiện tại và 81d04e5 → 4424292 (chỉ đổi dòng liệt kê)", (t) => {
  assert.equal(PREV_RULE_SHA, "4424292");
  assert.equal(PREV_RULE_SHA256, "e4a6753fd856a9585ac040263a4c62de58e280d5e68773e91391b9d06a02211a");
  const now = ruleBlockOf(SRC);
  assert.notEqual(RULE_SHA256, PREV_RULE_SHA256);
  const prev = blockAt(PREV_RULE_SHA);
  const old = blockAt(OLD_RULE_SHA);
  if (prev === null || old === null) { t.skip("không chạy được git show 4424292 / 81d04e5 (không có git hoặc thiếu commit)"); return; }
  assert.equal(sha256Of(prev), PREV_RULE_SHA256, "khối LỆCH LUẬT 1 ở 4424292 không đổi");
  assert.equal(sha256Of(old), OLD_RULE_SHA256, "khối gốc ở 81d04e5 không đổi");
  assert.deepEqual(strictBlockDiff(prev, now, L2_REMOVED, L2_ADDED), []);
  assert.deepEqual(strictBlockDiff(old, prev, L1_REMOVED, L1_ADDED), []);
  // thử đỏ: đổi 1 ký tự ở dòng KHÔNG được phép đổi (dòng R1) → đỏ
  const bad = now.replace("R1 60 ảnh A / B", "R1 60 ảnh A / C");
  assert.notEqual(bad, now);
  assert.deepEqual(strictBlockDiff(prev, bad, L2_REMOVED, L2_ADDED), ["phần còn lại khác từng byte"]);
  // đổi thứ tự 2 dòng không được phép đổi → đỏ
  const N = now.split("\n");
  const i = N.findIndex((l) => l.includes("R2 8 ảnh thật"));
  const swapped = [...N.slice(0, i), N[i + 1], N[i], ...N.slice(i + 2)].join("\n");
  assert.deepEqual(strictBlockDiff(prev, swapped, L2_REMOVED, L2_ADDED), ["phần còn lại khác từng byte"]);
  // đổi 1 ký tự ở dòng được phép đổi cũng bị bắt (dòng đó không còn khớp danh sách tường minh)
  assert.ok(strictBlockDiff(prev, now.replace("bị ẨN trên hàng", "bị ẨN trên hang"), L2_REMOVED, L2_ADDED).length > 0);
  // gợi ý 1 (lần 2): chép thêm một bản của dòng được phép → đỏ (code cũ bỏ mọi bản trùng nên lọt)
  const ia = N.indexOf(L2_ADDED[5]);
  assert.ok(ia > 0);
  const dup = [...N.slice(0, ia + 1), N[ia], ...N.slice(ia + 1)].join("\n");
  assert.ok(strictBlockDiff(prev, dup, L2_REMOVED, L2_ADDED).some((e) => /xuất hiện 2 lần/.test(e)), "chép thêm dòng được phép");
  // dời dòng được phép sang chỗ khác (lên đầu khối, sai thứ tự danh sách) → đỏ
  const moved = [N[ia], ...N.slice(0, ia), ...N.slice(ia + 1)].join("\n");
  assert.ok(strictBlockDiff(prev, moved, L2_REMOVED, L2_ADDED).some((e) => /sai thứ tự/.test(e)), "dời dòng được phép");
  // dời dòng được phép cũ trong khối cũ cũng bị bắt
  const O2 = prev.split("\n");
  const ir = O2.indexOf(L2_REMOVED[1]);
  const movedOld = [O2[ir], ...O2.slice(0, ir), ...O2.slice(ir + 1)].join("\n");
  assert.ok(strictBlockDiff(movedOld, now, L2_REMOVED, L2_ADDED).some((e) => /sai thứ tự/.test(e)), "dời dòng bỏ trong khối cũ");
  // khối mới ghi lý do + sha khối trước
  for (const s of ["LỆCH LUẬT 2", "ảnh thật #1", "ab-<mã>", "1.600 px", "e4a6753fd856a9585ac040263a4c62de58e280d5e68773e91391b9d06a02211a", "4424292"]) assert.ok(now.includes(s), `khối mới thiếu ${s}`);
});

test("khối luật đủ nội dung bắt buộc (P1e) và không chứa mã nhãn / tên file ảnh thật", () => {
  const block = ruleBlockOf(SRC);
  for (const s of ["S0", "S1", "S2-w", "S3-k", "A0", "A1-τ-μ", "A2-w", "U-sim", "U-gap", "U-simchu", "U-or", "R1", "R2", "R3", "R4", "R5", "R6", "R7",
    "M1", "M2", "M3", "G1", "G2", "G3", "9.512", "CLIP", "SigLIP", "DINOv2", "MobileCLIP", "cat", "vien", "int8", "chỉ để tham khảo", "n nhỏ"]) {
    assert.ok(block.includes(s), `thiếu ${s}`);
  }
  assert.doesNotMatch(SRC, /1795\d{9}/, "không có tên file ảnh thật");
  assert.equal(methodGrid([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]).length, METHOD_COUNT);
  assert.equal(METHOD_COUNT, 8 * 29 * 41);
  const g = methodGrid([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
  assert.equal(g[0].name, "S0|A0|U0", "nền đứng đầu");
  assert.deepEqual([...new Set(g.map((x) => x.s))], [...S_GRID]);
});

test("RRF có trọng số: điểm, hòa theo hạng danh sách 1 rồi 2; mẫu sai (bỏ trọng số) cho thứ tự khác", () => {
  assert.deepEqual(rrfFuse([{ codes: ["a", "b", "c"], w: 1 }, { codes: ["c", "d"], w: 1 }]), ["c", "a", "b", "d"]);
  assert.deepEqual(rrfFuse([{ codes: ["a", "b"], w: 1 }, { codes: ["b", "a"], w: 1 }]), ["a", "b"], "hòa → hạng danh sách 1");
  // c − a = (1/63 − 1/61) + w (1/61 − 1/62): âm khi w = 1, dương khi w = 2
  const w2 = rrfFuse([{ codes: ["a", "b", "c"], w: 1 }, { codes: ["c", "a"], w: 2 }]);
  assert.deepEqual(w2, ["c", "a", "b"]);
  const w1 = rrfFuse([{ codes: ["a", "b", "c"], w: 1 }, { codes: ["c", "a"], w: 1 }]);
  assert.deepEqual(w1, ["a", "c", "b"]);
  assert.notDeepEqual(w1, w2, "mẫu sai (bỏ trọng số) cho cùng thứ tự ở mọi w → bị bắt");
});

test("tầng máy chủ: S0 / S1 / S2-w / S3-k", () => {
  const s0 = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"];
  const im = ["i1", "t3", "i2", "i3", "t1", "i4", "i5", "i6", "i7", "i8", "i9"];
  assert.deepEqual(serverTier("S0", s0, im), s0);
  assert.deepEqual(serverTier("S1", s0, im), im.slice(0, 10));
  assert.deepEqual(serverTier("S3-1", s0, im), [...s0.slice(0, 9), "i1"]);
  assert.deepEqual(serverTier("S3-2", s0, im), [...s0.slice(0, 9), "i1"], "t3 đã có → chỉ thêm 1");
  assert.deepEqual(serverTier("S3-3", s0, im), [...s0.slice(0, 8), "i1", "i2"]);
  assert.deepEqual(serverTier("S3-2", ["t1", "t2"], im), ["t1", "t2", "i1", "t3"], "S0 ngắn → nối thêm");
  const s2 = serverTier("S2-1", s0, im);
  assert.equal(s2.length, 10);
  assert.deepEqual(s2.slice(0, 2), ["t3", "t1"]);
  assert.throws(() => serverTier("S9", s0, im));
});

test("hạng ảnh / lens / U: phân vị không dùng nhãn; ca không lens → không bao giờ 'không chắc'", () => {
  const cs = ["a", "b", "c", "d"];
  const sims = [0.2, 0.9, 0.9, 0.5];
  const ranked = imageRank(cs, sims);
  assert.deepEqual(ranked, ["b", "c", "d", "a"], "hòa → thứ tự codes");
  const L = lensOf(ranked, new Map(cs.map((c, i) => [c, sims[i]])));
  assert.equal(L.top1Code, "b");
  assert.equal(L.margin, 0);
  assert.deepEqual(percentiles([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]), [1, 3, 5, 8, 9]);
  const lens = { top1: 0.6, margin: 0.05 };
  assert.equal(isUnsureU({ id: "U-sim-0.7", kind: "U-sim", tau: 0.7 }, lens, 5), true);
  assert.equal(isUnsureU({ id: "U-sim-0.6", kind: "U-sim", tau: 0.6 }, lens, 5), false, "bằng ngưỡng = chắc");
  assert.equal(isUnsureU({ id: "U-gap-0.1", kind: "U-gap", mu: 0.1 }, lens, 5), true);
  assert.equal(isUnsureU({ id: "U-simchu-0.7", kind: "U-simchu", tau: 0.7 }, lens, 2), false, "khớp 2 từ → chắc");
  assert.equal(isUnsureU({ id: "U-simchu-0.7", kind: "U-simchu", tau: 0.7 }, lens, 1), true);
  assert.equal(isUnsureU({ id: "U-or-0.5-0.1", kind: "U-or", tau: 0.5, mu: 0.1 }, lens, 5), true);
  assert.equal(isUnsureU({ id: "U-or-0.5-0.01", kind: "U-or", tau: 0.5, mu: 0.01 }, lens, 0), false);
  for (const u of [{ id: "U-sim-9", kind: "U-sim", tau: 9 }, { id: "U-or-9-9", kind: "U-or", tau: 9, mu: 9 }]) assert.equal(isUnsureU(u, null, 0), false);
  assert.equal(qidOf({ set: "7up" }), null);
  assert.equal(qidOf({ set: "A", code: "1" }), qidOf({ set: "B", code: "1" }), "A và B cùng ảnh");
});

test("tầng app: A0 / A1 / A2 không lens = nền (7Up nhánh ảnh tắt; R5 x); A1 đẩy mã ảnh hạng 1 lên vị trí 1, vượt lockTop", () => {
  let pushed = 0;
  for (const lines of [["Up", "Soda chanh", "Khong calo"], ["Mi Hao Hao", "tom chua cay"], ["Banh quy", "Cosy"], ["Nuoc mam", "Nam Ngu"]]) {
    const c = caseOf(lines);
    const S = serverS(lines);
    const base0 = serverMerge(ctx, c.found, NET, S, { called: true }).merged;
    for (const a of [{ id: "A0" }, { id: "A1-0-0", kind: "A1", tau: 0, mu: 0 }, { id: "A2-1", kind: "A2", w: 1 }, { id: "A2-2", kind: "A2", w: 2 }]) {
      assert.deepEqual(appTier(ctx, c, S, "i", a, { lens: null, simOf: null, base0 }), base0, `${lines[0]} ${a.id} không lens`);
    }
    const target = S[S.length - 1].code;
    const lens = { top1Code: target, top1: 0.9, margin: 0.2 };
    const simOf = new Map(S.map((h, j) => [h.code, h.code === target ? 0.9 : 0.1 + j * 0.01]));
    const m1 = appTier(ctx, c, S, "i", { id: "A1-0.8-0.1", kind: "A1", tau: 0.8, mu: 0.1 }, { lens, simOf, base0 });
    assert.equal(m1[0].code, target);
    assert.equal(m1.length <= 5, true);
    assert.equal(new Set(codes(m1)).size, m1.length, "không trùng mã");
    const rest = mergeLocal(ctx, c.found, NET, S, { ...BASE_PARAMS, offMax: m1[0].source === "off" ? 0 : 1 }).filter((x) => x.code !== target).slice(0, 4);
    assert.deepEqual(m1.slice(1), base0[0]?.code === target ? base0.slice(1) : rest, "4 mục sau: offMax tính cả mục đẩy");
    if (base0[0]?.code !== target) pushed++;
    const notPushed = appTier(ctx, c, S, "i", { id: "A1-0.95-0.1", kind: "A1", tau: 0.95, mu: 0.1 }, { lens, simOf, base0 });
    assert.deepEqual(notPushed, base0, "dưới τ → nền");
    const notInS = appTier(ctx, c, S, "i", { id: "A1-0-0", kind: "A1", tau: 0, mu: 0 }, { lens: { ...lens, top1Code: "0000000000000" }, simOf, base0 });
    assert.deepEqual(notInS, base0, "mã ảnh hạng 1 không trong S → nền");
    const m2 = appTier(ctx, c, S, "i", { id: "A2-2", kind: "A2", w: 2 }, { lens, simOf, base0 });
    assert.equal(m2.length, Math.min(5, new Set([...codes(base0), ...codes(S)]).size));
    assert.ok(codes(m2).includes(target), "A2 w 2 đưa mã sim cao nhất vào 5");
  }
  assert.ok(pushed >= 2, "A1 thật sự đổi vị trí 1 ở ≥ 2 ca");
});

test("ô / R1: 'không chắc' mà nền đúng vị trí 1 = MẤT vị trí 1; rơi khỏi 5 = mất; mẫu sai (không tính U) bị bắt", () => {
  const m = [{ code: "1234567890123" }, { code: "2222222222222" }];
  const base = cellOf(m, "1234567890123", false);
  const unsure = cellOf(m, "1234567890123", true);
  assert.deepEqual([base.top1, base.pos, base.auto], [true, 1, true]);
  assert.deepEqual([unsure.top1, unsure.pos, unsure.auto], [false, 1, false], "vẫn trong 5 nhưng mất vị trí 1");
  const okRow = (got) => Array.from({ length: 120 }, (_, i) => ({ id: `x${i}`, base, got: i === 0 ? got : base }));
  const common = {
    good: GOOD_IMGS.flatMap((n) => ["i", "ii"].map((c) => ({ id: `${n}${c}`, got: base }))), s7: ["a", "b", "c", "d"].map((id) => ({ id, got: base })),
    buldak: [{ id: "i", top1Code: BULDAK_CODE, auto: true }, { id: "ii", top1Code: BULDAK_CODE, auto: true }], noImgSame: true, r5x: true, r5y: { pass: true },
    r6: { p95: 900, ramMiB: 1200 }, r7: { bytes: 20000000 },
  };
  assert.equal(judgeR({ ab: okRow(base), ...common }).pass, true);
  const v = judgeR({ ab: okRow(unsure), ...common });
  assert.equal(v.gates.R1, false);
  // mẫu sai gọi judgeR THẬT với ô tính kiểu "bỏ U" (cellOf không truyền cờ không chắc): cho qua R1 → khác hẳn ô đúng (bị
  // đánh "không chắc") ở trên, nên một bản cài quên U sẽ bị test này bắt.
  const ignoreU = cellOf(m, "1234567890123", false);
  assert.equal(judgeR({ ab: okRow(ignoreU), ...common }).gates.R1, true, "mẫu sai (bỏ U) cho qua");
  assert.notEqual(judgeR({ ab: okRow(ignoreU), ...common }).gates.R1, v.gates.R1);
  assert.equal(judgeR({ ab: okRow(cellOf([{ code: "2222222222222" }], "1234567890123", false)), ...common }).gates.R1, false, "rơi khỏi 5");
  assert.equal(judgeR({ ab: okRow(base).slice(1), ...common }).gates.R1, false, "thiếu ô");
  assert.equal(judgeR({ ab: okRow(base), ...common, noImgSame: false }).gates.R3, false, "7Up / ca không ảnh khác nền → trượt");
  assert.equal(judgeR({ ab: okRow(base), ...common, buldak: [{ id: "i", top1Code: BULDAK_CODE, auto: false }, common.buldak[1]] }).gates.R4, false);
  assert.equal(judgeR({ ab: okRow(base), ...common, r6: { p95: 1501, ramMiB: 1 } }).gates.R6, false);
  assert.equal(judgeR({ ab: okRow(base), ...common, r7: { bytes: R7_MAX_BYTES + 1 } }).gates.R7, false);
  assert.equal(judgeR({ ab: okRow(base), ...common, r5y: { pass: false } }).gates.R5, false);
});

test("mục tiêu M1–M3, nửa giữ riêng, chỉ để tham khảo; chọn cách", () => {
  const C = (top1, pos, auto = true) => ({ top1, pos, auto });
  const row = (img, group, folder, label, base, got, preset = false) => ({ id: `${img}${group}`, img, group, folder, label, preset, base, got });
  const baseRows = [
    row(1, "chinh", "1-ra-dung", "ma", C(false, 3), C(true, 1)), row(2, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 2)),
    row(3, "chinh", "3-khong-ra", "none", C(false, null), C(false, null, false)), row(4, "giu", "1-ra-dung", "ma", C(true, 1), C(true, 1)),
  ];
  const t = targetsM(baseRows);
  assert.deepEqual([t.M1, t.M2, t.M3, t.base.M1, t.base.M2, t.base.M3], [1, 2, 0, 0, 1, 1]);
  assert.equal(t.holdOk, true);
  assert.deepEqual(t.refOnly, []);
  const pass = { pass: true };
  assert.equal(achieves(pass, t), true);
  const lossHold = targetsM([...baseRows.slice(0, 3), row(4, "giu", "1-ra-dung", "ma", C(true, 1), C(false, 1, false))]);
  assert.equal(lossHold.holdOk, false);
  assert.equal(achieves(pass, lossHold), false);
  const one = targetsM([row(1, "chinh", "1-ra-dung", "ma", C(false, 3), C(true, 1))]);
  assert.deepEqual(one.refOnly, ["chỉ nhờ 1 ảnh"]);
  const f2 = targetsM([row(1, "chinh", "2-ma-vach-ra", "ma", C(false, 3), C(true, 1)), row(5, "chinh", "2-ma-vach-ra", "ma", C(false, null), C(false, 4))]);
  assert.ok(f2.refOnly.includes("chỉ nhờ ảnh thư mục 2"));
  const pre = targetsM([row(1, "chinh", "1-ra-dung", "ma", C(false, 3), C(true, 1), true), row(5, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 4), true)]);
  assert.ok(pre.refOnly.includes("chỉ nhờ ảnh preset"));
  const worse = targetsM([row(1, "chinh", "1-ra-dung", "ma", C(true, 1), C(false, 2)), row(2, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 2)), row(3, "chinh", "1-ra-dung", "ma", C(false, null), C(false, 3))]);
  assert.equal(achieves(pass, worse), false, "M1 kém nền → không đạt dù M2 hơn");
  const p = pickMethod([{ name: "S0|A0|U0", verdict: pass, t: targetsM(baseRows.map((r) => ({ ...r, got: r.base }))) }, { name: "x", verdict: pass, t: one }, { name: "y", verdict: { pass: false }, t }, { name: "z", verdict: pass, t }]);
  assert.equal(p.name, "z");
  assert.deepEqual(p.refOnly.map((x) => x.name), ["x"]);
});

test("chống ăn gian: cùng imgid / mã băm gần (≤ 24 bit) → loại; không còn ứng viên → loại khỏi đo ảnh", () => {
  assert.equal(HASH_OK_MIN, 25);
  const r = chooseSubstitute([{ key: "front_vi.3", imgid: "7", distance: 40 }, { key: "front_en.5", imgid: "9", distance: 24 }, { key: "front_fr.6", imgid: "10", distance: 25 }], "7");
  assert.equal(r.chosen.key, "front_fr.6");
  assert.deepEqual(r.rejected.map((x) => x.reason), ["cùng imgid", "gần ảnh đo 24 bit (≤ 24)"]);
  const none = chooseSubstitute([{ key: "front_vi.3", imgid: "7", distance: 60 }, { key: "front_en.4", imgid: "8", distance: 3 }, { key: "front_th.4", imgid: "8", distance: 60 }], "7");
  assert.equal(none.chosen, null);
  assert.equal(none.rejected[2].reason, "trùng imgid ứng viên trước");
  assert.equal(chooseSubstitute([{ key: "front_vi.3", imgid: "8", distance: null }], "7").chosen, null, "không có mã băm → không nhận");
  // mẫu sai gọi chooseSubstitute THẬT: cùng ứng viên, chỉ đổi mã băm 24 → 25 bit thì được nhận → hàm thật đúng là xét mã băm
  assert.equal(chooseSubstitute([{ key: "front_en.5", imgid: "9", distance: 24 }], "7").chosen, null);
  assert.equal(chooseSubstitute([{ key: "front_en.5", imgid: "9", distance: 25 }], "7").chosen?.key, "front_en.5");
});

test("chống ăn gian (NÊN SỬA 1): imgid ảnh đo HOẶC ứng viên không rõ → từ chối 'không biết imgid'", () => {
  const far = { key: "front_fr.6", imgid: "10", distance: 60 };
  for (const t of [null, undefined, "", "  "]) {
    const r = chooseSubstitute([far], t);
    assert.equal(r.chosen, null, `ảnh đo imgid ${JSON.stringify(t)}`);
    assert.deepEqual(r.rejected, [{ key: "front_fr.6", reason: "không biết imgid ảnh đo" }]);
  }
  for (const im of [null, undefined, ""]) {
    const r = chooseSubstitute([{ key: "front_vi.3", imgid: im, distance: 60 }, far], "7");
    assert.equal(r.rejected[0].reason, "không biết imgid", `ứng viên imgid ${JSON.stringify(im)}`);
    assert.equal(r.chosen.key, "front_fr.6", "ứng viên sau vẫn được xét");
  }
  // mẫu sai (bản vòng 1: chỉ loại khi c.imgid != null và trùng): hàm thật với imgid biết + xa thì nhận; với imgid null thì
  // KHÔNG nhận — nên bản cũ (nhận) bị test trên bắt
  assert.equal(chooseSubstitute([{ key: "front_vi.3", imgid: "8", distance: 60 }], "7").chosen?.key, "front_vi.3");
  assert.equal(chooseSubstitute([{ key: "front_vi.3", imgid: null, distance: 60 }], "7").chosen, null);
  assert.equal(chooseSubstitute([{ key: "front_vi.3", imgid: "8", distance: 60 }], null).chosen, null);
});

test("cổng G2 (NÊN SỬA 4): mọi top1 phải là số hữu hạn; null / NaN / thiếu ảnh → G2 false kèm lý do", () => {
  const good = GOOD_IMGS.map((img, i) => ({ img, top1: 0.8 + i * 0.01 }));
  const none3 = [17, 18, 19, 20, 21, 22].map((img, i) => ({ img, top1: i < 2 ? 0.7 : 0.9 }));
  assert.deepEqual(gateG2(good, none3), { G2: true, g2n: 2, minGood: 0.8, g2Why: null });
  const nullNone = none3.map((x, i) => (i === 2 ? { ...x, top1: null } : x));
  const r = gateG2(good, nullNone);
  assert.equal(r.G2, false);
  assert.match(r.g2Why, /top1 không phải số hữu hạn: #19/);
  // mẫu sai: trong JS null < 0,8 là đúng → cách đếm cũ đếm cả ảnh null, ra 3 ≥ 2 (cổng mở nhầm)
  assert.equal(nullNone.filter((x) => x.top1 < 0.8).length, 3);
  const nullGood = good.map((x, i) => (i === 0 ? { ...x, top1: null } : x));
  assert.equal(gateG2(nullGood, none3).G2, false, "ảnh đang đúng null (Math.min ra 0) → không đóng / mở nhầm");
  assert.equal(gateG2(good, none3.map((x) => (x.img === 17 ? { ...x, top1: NaN } : x))).G2, false);
  assert.match(gateG2(good.slice(1), none3).g2Why, /cần 8 ảnh đang đúng/);
  assert.match(gateG2(good, none3.slice(1)).g2Why, /cần 6 ảnh thư mục 3/);
  const wrong = [{ img: 2, inIndex: true, pos: 1 }, { img: 4, inIndex: true, pos: 2 }];
  const g = earlyGate({ p: Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}`, code: String(i), pos: 1 })), wrong: [], none3: nullNone, good });
  assert.equal(g.G2, false);
  assert.equal(g.pass, false, "G1 0 + G2 false → không qua");
  assert.match(g.detail.g2Why, /#19/);
  assert.equal(earlyGate({ p: Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}`, code: String(i), pos: 1 })), wrong, none3: nullNone, good }).pass, true, "G1 đủ vẫn qua");
});

test("lưới: tên cách mang chỉ số phân vị, 2 phân vị cùng giá trị không trùng tên (gợi ý 10)", () => {
  const g = methodGrid([0.5, 0.5, 0.6, 0.7, 0.8], [0.1, 0.1, 0.1, 0.2, 0.3]);
  assert.equal(g.length, METHOD_COUNT);
  assert.equal(new Set(g.map((x) => x.name)).size, METHOD_COUNT, "không tên trùng");
  assert.ok(g.some((x) => x.name === "S0|A1-τp25-μp50|U0"));
  assert.ok(g.some((x) => x.name === "S0|A0|U-or-τp10-μp90"));
  const a = g.find((x) => x.a.id === "A1-τp25-μp50").a;
  assert.deepEqual([a.tau, a.mu], [0.5, 0.1]);
  assert.throws(() => methodGrid([1, 2, 3], [1, 2, 3, 4, 5]));
});

test("chỉ mục đã áp chống ăn gian (NÊN SỬA 5 + LỆCH LUẬT 2): mã bị loại CÓ trong chỉ mục + ẩn đúng hàng ab-<mã>; ảnh truy vấn trong chỉ mục chỉ khi bị ẩn; mỗi mẫu sai một lỗi", () => {
  const ac = {
    items: [
      { code: "1111111111111", testImgid: "3", chosen: "front_en.9", candidates: [{ key: "front_en.9", imgid: "5" }] },
      { code: "2222222222222", testImgid: "1", chosen: null, catalogImg: "front_vi.4", candidates: [{ key: "front_vi.4", imgid: "1", fromCatalog: true }] },
    ],
    excluded: ["2222222222222"], override: { "1111111111111": "front_en.9" },
  };
  const bop = { items: [{ qid: "p-3333333333333", code: "3333333333333", query: { imgid: "4" }, index: { key: "imgid:7", imgid: "7" } }] };
  const acText = JSON.stringify(ac);
  const bopText = JSON.stringify(bop);
  const cat = { "1111111111111": "front_vi.1", "2222222222222": "front_vi.4", "3333333333333": "front_en.2", "4444444444444": "front_vi.2" };
  const want = guardWant(acText, bopText, { level: "a", catalogImg: cat });
  assert.deepEqual(want.override, { "1111111111111": "front_en.9", "3333333333333": "imgid:7" });
  assert.deepEqual(want.hideByRow, { "ab-2222222222222": ["2222222222222"] });
  assert.deepEqual(want.guard, [
    { code: "1111111111111", queryImgid: "3", qid: "ab-1111111111111" }, { code: "2222222222222", queryImgid: "1", qid: "ab-2222222222222" },
    { code: "3333333333333", queryImgid: "4", qid: "p-3333333333333" },
  ]);
  const codesOk = ["1111111111111", "2222222222222", "3333333333333", "4444444444444"];
  const metaOk = {
    level: "a", antiCheatSha256: want.antiCheatSha256, boPSha256: want.boPSha256, excluded: ["2222222222222"], override: { ...want.override },
    hideByRow: { "ab-2222222222222": ["2222222222222"] },
    indexKey: { "1111111111111": "front_en.9", "2222222222222": "front_vi.4", "3333333333333": "imgid:7", "4444444444444": "front_vi.2" },
    // mã bị loại: ảnh chỉ mục (khóa danh mục) CHÍNH LÀ ảnh truy vấn ab-2222… (cùng imgid 1) → chỉ hợp lệ vì bị ẩn trên hàng đó
    indexImgid: { "1111111111111": "5", "2222222222222": "1", "3333333333333": "7" },
    threadCheck: { pass: true }, queriesMissing: [], missingIndexFiles: 0, model: "clip-fp32", pre: "cat",
  };
  const expect = { model: "clip-fp32", pre: "cat", level: "a" };
  assert.deepEqual(checkIndexGuard(metaOk, codesOk, want, expect), []);
  // mẫu sai, mỗi mẫu một lỗi
  const bad = (patch, codes = codesOk, w = want) => checkIndexGuard({ ...metaOk, ...patch }, codes, w, expect);
  const one = (errs, re) => { assert.equal(errs.length >= 1, true); assert.ok(errs.some((e) => re.test(e)), `thiếu lỗi ${re}: ${errs.join(" | ")}`); };
  one(bad({ hideByRow: {} }), /\(i\) mã bị loại 2222222222222 không bị ẩn trên hàng ab-2222222222222/); // thiếu ẩn
  one(bad({ hideByRow: {} }), /\(iii\) ảnh truy vấn ab-2222222222222 nằm trong chỉ mục .* không bị ẩn/); // … nên ảnh truy vấn lộ
  one(bad({ hideByRow: { "ab-1111111111111": ["2222222222222"] } }), /\(i\) ẩn sai: mã 2222222222222 trên hàng ab-1111111111111/); // ẩn sai hàng
  one(bad({ hideByRow: { ...metaOk.hideByRow, "that-1": ["2222222222222"] } }), /\(i\) ẩn trên hàng không phải A \/ B: that-1/); // ẩn trên hàng ảnh thật
  one(bad({}, codesOk.filter((c) => c !== "2222222222222")), /\(i\) mã bị loại 2222222222222 vắng khỏi chỉ mục/); // mã loại vắng khỏi codes
  one(bad({ indexKey: { ...metaOk.indexKey, "2222222222222": "front_en.8" } }), /\(i\) mã bị loại 2222222222222 dùng ảnh front_en.8 thay vì khóa danh mục front_vi.4/);
  one(bad({ indexKey: { ...metaOk.indexKey, "1111111111111": "front_vi.1" } }), /\(ii\) 1111111111111 dùng ảnh front_vi.1/);
  one(bad({ indexImgid: { ...metaOk.indexImgid, "1111111111111": "3" } }), /\(iii\) ảnh truy vấn ab-1111111111111 nằm trong chỉ mục/);
  one(bad({ indexImgid: { "1111111111111": "5", "2222222222222": "1" } }), /\(iii\) không biết imgid ảnh chỉ mục của 3333333333333/);
  one(bad({ antiCheatSha256: "khac" }), /meta.antiCheatSha256/);
  one(bad({ boPSha256: null }), /meta.boPSha256/);
  one(bad({ excluded: [] }), /meta.excluded/);
  one(bad({}, codesOk.filter((c) => c !== "3333333333333")), /mã bộ P không có trong chỉ mục: 3333333333333/);
  one(checkIndexGuard(metaOk, codesOk, guardWant(JSON.stringify({ ...ac, override: {} }), bopText, { level: "a", catalogImg: cat }), expect), /meta.override/);
  // NÊN SỬA 2: bộ sim phải đạt kiểm luồng, đủ truy vấn, đủ ảnh, đúng thư mục
  one(bad({ threadCheck: { pass: false } }), /threadCheck.pass/);
  one(bad({ threadCheck: undefined }), /threadCheck.pass/);
  one(bad({ queriesMissing: ["that-3"] }), /queriesMissing/);
  one(bad({ queriesMissing: undefined }), /queriesMissing/);
  one(bad({ missingIndexFiles: 1 }), /missingIndexFiles = 1/);
  one(bad({ model: "clip-int8" }), /meta.model clip-int8 ≠ thư mục clip-fp32/);
  one(bad({ pre: "vien" }), /meta.pre vien ≠ thư mục cat/);
  one(bad({ level: "b" }), /meta.level b/);
  // NÊN SỬA 6: ở mức (b) override của bộ P KHÔNG áp (mã đó dùng khóa danh mục); A / B override vẫn áp
  // vòng 3 A': mức (b) kiểm thêm ảnh 404 (tai-tong-b.json + meta.unavailable404); ở đây không có mã 404
  const wantB = guardWant(acText, bopText, { level: "b", catalogImg: cat, tai404Text: JSON.stringify({ missing404: [] }) });
  assert.deepEqual(wantB.override, { "1111111111111": "front_en.9" });
  assert.deepEqual(wantB.mustHave, []);
  assert.ok(!wantB.guard.some((g) => g.qid.startsWith("p-")), "mức (b) không có truy vấn bộ P");
  const metaB = { ...metaOk, level: "b", override: { ...wantB.override }, indexKey: { ...metaOk.indexKey, "3333333333333": "front_en.2" }, indexImgid: { "1111111111111": "5", "2222222222222": "1" }, unavailable404: [], tai404Sha256: wantB.tai404Sha256 };
  const expB = { ...expect, level: "b" };
  assert.deepEqual(checkIndexGuard(metaB, codesOk, wantB, expB), []);
  const pAtB = checkIndexGuard({ ...metaB, override: { ...want.override } }, codesOk, wantB, expB);
  one(pAtB, /meta.override khác .*mức b/); // (b) có override P → lỗi
  assert.throws(() => guardWant(acText, bopText, { level: "c" }), /mức lạ/);
  // bộ P mâu thuẫn override A / B → lỗi
  const clash = guardWant(acText, JSON.stringify({ items: [{ qid: "ab-1111111111111", code: "1111111111111", query: { imgid: "3" }, index: { key: "front_fr.2", imgid: "8" } }] }), { level: "a", catalogImg: cat });
  one(checkIndexGuard(metaOk, codesOk, clash, expect), /override mâu thuẫn/);
});

test("ẩn theo hàng (LỆCH LUẬT 2 (i)): hàng ab-X không thấy X, hàng ảnh thật thấy X hạng 1; bỏ bước ẩn → khác (thử đỏ / xanh)", () => {
  const codes3 = ["8930000000001", "8930000000002", "8930000000003"];
  const X = codes3[0];
  const queries = [`ab-${X}`, "that-1", "p-8930000000003"];
  // hàng ab-X: X giống nhất (chính ảnh đo); hàng that-1: X cũng giống nhất
  const npy = npyOf([3, 3], [0.99, 0.6, 0.4, 0.95, 0.5, 0.7, 0.1, 0.2, 0.9]);
  const meta = { hideByRow: { [`ab-${X}`]: [X] } };
  const s = simsFrom({ meta, codes: codes3, queries, npy });
  const ab = s.rowOf(`ab-${X}`);
  assert.deepEqual(ab.ranked, ["8930000000002", "8930000000003"], "hàng ab-X không có X");
  assert.equal(ab.simOf.has(X), false, "sim ứng viên của X trên hàng ab-X = không có");
  assert.equal(ab.lens.top1Code, "8930000000002");
  assert.ok(Math.abs(ab.lens.top1 - 0.6) < 1e-6 && Math.abs(ab.lens.margin - 0.2) < 1e-6, "lens tính sau khi ẩn");
  const real = s.rowOf("that-1");
  assert.equal(real.ranked[0], X, "ảnh thật thấy X ở hạng 1");
  assert.equal(real.ranked.length, 3);
  assert.equal(s.rowOf("p-8930000000003").ranked[0], "8930000000003");
  assert.equal(s.rowOf("khong-co"), null);
  // A2 / S1 dùng simOf + ranked của rowOf nên cũng thấy bản đã ẩn: sim ứng viên X trên hàng ab-X không hữu hạn
  assert.equal(Number.isFinite(ab.simOf.get(X)), false);
  // mẫu sai: không áp hideByRow → hàng ab-X thấy chính X ở hạng 1 (ăn gian)
  const noHide = simsFrom({ meta: {}, codes: codes3, queries, npy }).rowOf(`ab-${X}`);
  assert.equal(noHide.ranked[0], X);
  assert.notDeepEqual(noHide.ranked, ab.ranked);
  assert.deepEqual(rowView(codes3, [0.99, 0.6, 0.4], []).ranked, imageRank(codes3, [0.99, 0.6, 0.4]), "không ẩn → như imageRank");
  assert.throws(() => simsFrom({ meta: { hideByRow: { [`ab-${X}`]: X } }, codes: codes3, queries, npy }), /phải là mảng/);
  assert.throws(() => simsFrom({ meta: { hideByRow: [] }, codes: codes3, queries, npy }), /phải là object/);
});

test("chỉ MỘT chỗ dùng hàng sims.npy (simsFrom / loadSims của lens-do.mjs); lens-chay.mjs không đọc sims.npy trực tiếp", () => {
  const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const CHAY = fs.readFileSync(new URL("../lens-chay.mjs", import.meta.url), "utf8");
  for (const re of [/sims\.npy/, /parseNpy/, /\.subarray\(/, /imageRank\(/, /lensOf\(/]) assert.doesNotMatch(code(CHAY), re, `lens-chay.mjs có ${re}`);
  const D = code(SRC);
  assert.equal((D.match(/"sims\.npy"/g) || []).length, 1, "lens-do.mjs chỉ đọc sims.npy ở loadSims");
  assert.equal((D.match(/parseNpy\(/g) || []).length, 2, "parseNpy: khai báo + 1 lời gọi trong simsFrom");
  assert.equal((D.match(/\.subarray\(/g) || []).length, 1, "chỉ simsFrom cắt hàng");
  const fnOf = (name) => { const i = D.indexOf(`export function ${name}(`); return D.slice(i, D.indexOf("\n}\n", i)); };
  assert.match(fnOf("loadSims"), /"sims\.npy"/);
  assert.match(fnOf("simsFrom"), /parseNpy\(npy\)/);
  assert.match(fnOf("simsFrom"), /rowView\(codes, sims, /, "simsFrom áp ẩn qua rowView");
});

test("6 biến thể cố định (NÊN SỬA 4): thiếu 1 → mã 3; SigLIP vào dropped với lý do R7 33,1 MB", () => {
  assert.deepEqual([...VEC_VARIANTS], ["clip-fp32|cat", "clip-fp32|vien", "clip-int8|cat", "clip-int8|vien", "dinov2-small|cat", "dinov2-small|vien"]);
  const all = variantPlan("D:\\v", "a", () => true);
  assert.equal(all.exitCode, 0);
  assert.equal(all.dirs.length, 6);
  assert.deepEqual(all.dirs[3], { variant: "clip-int8", pre: "vien", name: "clip-int8|vien", dir: "D:\\v\\clip-int8-vien\\a" });
  const miss = variantPlan("D:\\v", "a", (d) => !d.includes("dinov2-small-vien"));
  assert.deepEqual([miss.exitCode, miss.missing], [3, ["dinov2-small|vien"]]);
  assert.equal(miss.dirs.length, 5);
  assert.deepEqual(NO_VEC_VARIANTS.map((x) => x.name), ["siglip|cat", "siglip|vien"]);
  for (const x of NO_VEC_VARIANTS) assert.equal(x.why, "R7 ước 33,1 MB > 25 MB");
  assert.equal((indexBytesInt8(42208, 768) / 1e6).toFixed(1), "33.1", "lý do khớp ước R7 mức (b) 768 chiều");
});

test("R6 từ file đo 1.600 px (NÊN SỬA 5): đúng loại file, thiếu số biến thể → ném (người gọi thoát mã 3)", () => {
  const t = (p95) => ({ median: p95 - 50, p95, max: p95 + 20, n: 20 });
  const SHA = "a".repeat(64);
  const gio = {
    longEdge: 1600, jpegQuality: 0.9, threads: 1, at: "2026-11-21T01:00:00+0700", vecPySha256: "b".repeat(64), gitHead: "c".repeat(40), nSearch: 42208,
    models: { "clip-fp32": { sha256: SHA, onnxSha256: SHA, ramAddAfter20MiB: 120, peakWsMiB: 900, time: { cat: t(700), vien: t(710) } } },
  };
  assert.deepEqual(r6From(gio, "clip-fp32", "vien"), { p95: 710, median: 660, max: 730, n: 20, ramAddMiB: 120, peakMiB: 900, at: gio.at, vecPySha256: gio.vecPySha256, gitHead: gio.gitHead, nSearch: 42208, onnxSha256: SHA });
  assert.equal(r6From(gio, "clip-fp32", "cat", SHA).p95, 700, "sha ONNX trùng meta bộ sim");
  // NÊN SỬA 1 (lần 2): thiếu chứng cứ / ma trận nhỏ / sha ONNX lệch → ném
  assert.throws(() => r6From({ ...gio, at: undefined }, "clip-fp32", "cat"), /thiếu chứng cứ/);
  assert.throws(() => r6From({ ...gio, vecPySha256: undefined }, "clip-fp32", "cat"), /thiếu chứng cứ/);
  assert.throws(() => r6From({ ...gio, nSearch: 42207 }, "clip-fp32", "cat"), /42207 hàng < 42208/);
  assert.throws(() => r6From({ ...gio, nSearch: undefined }, "clip-fp32", "cat"), /ma trận tìm/);
  const m0 = gio.models["clip-fp32"];
  assert.throws(() => r6From({ ...gio, models: { "clip-fp32": { ...m0, onnxSha256: undefined } } }, "clip-fp32", "cat"), /sha256 ONNX đã đo/);
  assert.throws(() => r6From({ ...gio, models: { "clip-fp32": { ...m0, onnxSha256: "d".repeat(64) } } }, "clip-fp32", "cat"), /khác bản ghim/);
  assert.throws(() => r6From(gio, "clip-fp32", "cat", "e".repeat(64)), /khác meta bộ sim/);
  assert.throws(() => r6From(gio, "clip-int8", "cat"), /thiếu số R6 1.600 px của clip-int8\|cat/);
  assert.throws(() => r6From(null, "clip-fp32", "cat"), /không phải số đo 1600 px/);
  // mẫu sai: file giờ 400 px của vòng 1 (không có longEdge) → không dùng được
  assert.throws(() => r6From({ ...gio, longEdge: undefined }, "clip-fp32", "cat"), /không phải số đo/);
  assert.throws(() => r6From({ ...gio, threads: 4 }, "clip-fp32", "cat"), /không phải số đo/);
  assert.throws(() => r6From({ ...gio, models: { "clip-fp32": { ...gio.models["clip-fp32"], time: { cat: { ...t(700), n: 19 } } } } }, "clip-fp32", "cat"), /thiếu số/);
  assert.throws(() => r6From({ ...gio, models: { "clip-fp32": { ...gio.models["clip-fp32"], ramAddAfter20MiB: null } } }, "clip-fp32", "cat"), /RAM/);
});

test("trước mọi phán (NÊN SỬA 3): thiếu 1 hàng / ô A / B thiếu lens / không đủ 60 → mã 3", () => {
  const rows = new Map(["ab-1", "that-1", "buldak", "p-1"].map((q) => [q, { lens: { top1: 0.5, margin: 0.1 } }]));
  const rowOf = (q) => rows.get(q) ?? null;
  const ab60 = Array.from({ length: 60 }, () => "ab-1");
  const ok = rowCheck(rowOf, { qids: ["ab-1", "that-1", "buldak", "p-1"], abQids: ab60 });
  assert.deepEqual([ok.exitCode, ok.errs], [0, []]);
  assert.equal(ok.tops.length, 60);
  const m1 = rowCheck(rowOf, { qids: ["ab-1", "that-1", "ruaypuan", "p-1"] });
  assert.deepEqual([m1.exitCode, m1.errs], [3, ["thiếu hàng sim cho truy vấn: ruaypuan"]]);
  assert.equal(rowCheck(rowOf, { qids: [], abQids: ab60.slice(1) }).exitCode, 3, "59 ô A / B");
  rows.set("ab-2", { lens: null });
  assert.equal(rowCheck(rowOf, { qids: [], abQids: [...ab60.slice(1), "ab-2"] }).exitCode, 3, "ô A / B không có lens");
  // mẫu sai (code cũ: .filter(Boolean)) lặng lẽ ra 59 ô
  assert.equal([...ab60.slice(1), "ab-2"].map((q) => rowOf(q)?.lens).filter(Boolean).length, 59);
  // gợi ý 4 (lần 2): lens có top1 / margin không hữu hạn → mã 3 (ô A / B và truy vấn khác)
  rows.set("ab-3", { lens: { top1: NaN, margin: 0.1 } });
  const nanAb = rowCheck(rowOf, { qids: [], abQids: [...ab60.slice(1), "ab-3"] });
  assert.deepEqual([nanAb.exitCode, nanAb.errs], [3, ["lens.top1 / margin không hữu hạn: ab-3"]]);
  rows.set("that-2", { lens: { top1: 0.4, margin: null } });
  const nanQ = rowCheck(rowOf, { qids: ["that-2"] });
  assert.deepEqual([nanQ.exitCode, nanQ.errs], [3, ["lens.top1 / margin không hữu hạn: that-2"]]);
  rows.set("that-3", { lens: { top1: 0.4 } });
  assert.equal(rowCheck(rowOf, { qids: ["that-3"] }).exitCode, 3, "thiếu margin");
  rows.set("that-4", { lens: null });
  assert.equal(rowCheck(rowOf, { qids: ["that-4"] }).exitCode, 0, "hàng < 2 mục (lens null) ngoài A / B vẫn được");
});

test("kết quả đo ghi sha256 của lens-do.mjs, lens-chay.mjs, lens-vec.py (gợi ý 1)", async () => {
  const { codeSha256s, CODE_FILES } = await import("../lens-chay.mjs");
  assert.deepEqual([...CODE_FILES], ["lens-do.mjs", "lens-chay.mjs", "lens-vec.py"]);
  const s = codeSha256s();
  for (const f of CODE_FILES) assert.match(s[f], /^[0-9a-f]{64}$/, f);
  const want = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(new URL("../lens-do.mjs", import.meta.url))).digest("hex");
  assert.equal(s["lens-do.mjs"], want);
  assert.equal(codeSha256s("D:\\khong-co-thu-muc-nay")["lens-do.mjs"], null);
});

test("chọn model (LỆCH LUẬT 1 (iii)): R6 / R7 lọc, rồi ảnh thật nửa chỉnh top 5, rồi bộ P top 5, Apache-2.0, nhẹ hơn, 'cat' trước", () => {
  const v = (variant, pre, o) => ({ variant, pre, license: "MIT", onnxBytes: 100, p95: 500, r7Bytes: 20e6, realTop5: 3, pTop5: 10, ...o });
  assert.equal(pickModel([v("clip-fp32", "cat"), v("dinov2-small", "cat", { realTop5: 4 })]).name, "dinov2-small|cat", "ảnh thật trước");
  assert.equal(pickModel([v("clip-fp32", "cat", { pTop5: 11 }), v("dinov2-small", "cat")]).name, "clip-fp32|cat", "hòa ảnh thật → bộ P");
  // ảnh thật xếp TRƯỚC bộ P: bộ P hơn nhiều vẫn thua 1 ảnh thật (mẫu sai = thứ tự cũ / đảo sẽ chọn clip)
  assert.equal(pickModel([v("clip-fp32", "cat", { pTop5: 20, realTop5: 2 }), v("dinov2-small", "cat", { pTop5: 1, realTop5: 3 })]).name, "dinov2-small|cat");
  assert.equal(pickModel([v("clip-fp32", "cat"), v("siglip", "cat", { license: "Apache-2.0" })]).name, "siglip|cat");
  assert.equal(pickModel([v("clip-fp32", "cat", { onnxBytes: 300 }), v("clip-int8", "cat", { onnxBytes: 90 })]).name, "clip-int8|cat");
  assert.equal(pickModel([v("clip-fp32", "vien"), v("clip-fp32", "cat")]).name, "clip-fp32|cat");
  const d = pickModel([v("clip-fp32", "cat", { p95: 1501, realTop5: 99 }), v("siglip", "cat", { r7Bytes: 30e6, realTop5: 99 }), v("dinov2-small", "vien")]);
  assert.equal(d.name, "dinov2-small|vien");
  assert.equal(d.dropped.length, 2);
  assert.throws(() => pickModel([v("clip-fp32", "cat", { pTop5: undefined })]), /thiếu realTop5 \/ pTop5/, "thiếu số → không lặng lẽ xếp");
  assert.equal(indexBytesInt8(44092, 512), 44092 * 514 + 44092 * 14);
  assert.ok(indexBytesInt8(44092, 512) <= R7_MAX_BYTES);
  assert.ok(indexBytesInt8(44092, 768) > R7_MAX_BYTES, "768 chiều int8 ở mức (b) trượt R7");
});

test("cổng dừng sớm (LỆCH LUẬT 1 (ii)): G3 trên bộ P; |P| < 10 → 'không đủ mẫu', không chặn; cổng = G3 và (G1 hoặc G2)", () => {
  const P = (hit, n = 20) => Array.from({ length: n }, (_, i) => ({ id: `p-${i}`, code: String(i), pos: i < hit ? 3 : null }));
  const good = GOOD_IMGS.map((img, i) => ({ img, top1: 0.8 + i * 0.01 }));
  const wrong = [{ img: 2, inIndex: true, pos: 2 }, { img: 4, inIndex: true, pos: 5 }, { img: 5, inIndex: false, pos: null }];
  assert.equal(G3_P_MIN, 10);
  assert.equal(earlyGate({ p: P(10), wrong, none3: [], good }).pass, true, "G3 50 % + G1 2");
  assert.equal(earlyGate({ p: P(9), wrong, none3: [], good }).pass, false, "G3 45 %");
  assert.equal(earlyGate({ p: P(9), wrong, none3: [], good }).G3, false);
  assert.equal(earlyGate({ p: P(5, 10), wrong, none3: [], good }).G3, true, "|P| = 10, 50 %");
  const small = earlyGate({ p: P(0, 9), wrong, none3: [], good });
  assert.equal(small.G3, G3_SMALL, "|P| = 9 → không đủ mẫu");
  assert.equal(small.pass, true, "không đủ mẫu thì không chặn: G1 đủ → qua");
  assert.match(small.detail.g3Note, /\|P\| = 9 < 10/);
  assert.equal(earlyGate({ p: [], wrong, none3: [], good }).G3, G3_SMALL);
  const w1 = [{ img: 2, inIndex: true, pos: 6 }, { img: 4, inIndex: true, pos: 5 }];
  assert.equal(earlyGate({ p: P(0, 9), wrong: w1, none3: [], good }).pass, false, "không đủ mẫu + G1 1 + G2 0 → không qua");
  assert.equal(earlyGate({ p: P(10), wrong: w1, none3: [], good }).pass, false, "G1 chỉ 1, G2 0");
  const six = [{ img: 17, top1: 0.7 }, { img: 18, top1: 0.79 }, { img: 19, top1: 0.8 }, { img: 20, top1: 0.9 }, { img: 21, top1: 0.85 }, { img: 22, top1: 0.81 }];
  assert.equal(earlyGate({ p: P(10), wrong: w1, none3: six, good }).pass, true, "G2: 2 / 6 ảnh dưới min 0,8");
  assert.equal(earlyGate({ p: P(10), wrong: w1, none3: six.slice(0, 3), good }).pass, false, "G2 đòi đủ 6 ảnh thư mục 3");
  assert.throws(() => earlyGate({ p: [...P(10), { id: "p-x", code: "0", pos: 1 }], wrong, none3: [], good }), /mã trùng/, "mỗi mã đếm 1 lần");
  // mẫu sai (G3 cũ: |P| nhỏ vẫn chặn khi tỉ lệ < 50 %) → cổng đóng; hàm thật mở vì không đủ mẫu
  assert.equal(earlyGate({ p: P(0, 9), wrong, none3: [], good }).pass, true);
  assert.equal(P(0, 9).filter((x) => x.pos != null).length / 9 >= 0.5, false);
});

test("đọc .npy float32", () => {
  const header = "{'descr': '<f4', 'fortran_order': False, 'shape': (2, 3), }";
  const pad = 64 - ((10 + header.length + 1) % 64);
  const h = header + " ".repeat(pad) + "\n";
  const b = Buffer.alloc(10 + h.length + 24);
  b.writeUInt8(0x93, 0);
  b.write("NUMPY", 1, "latin1");
  b.writeUInt8(1, 6);
  b.writeUInt8(0, 7);
  b.writeUInt16LE(h.length, 8);
  b.write(h, 10, "latin1");
  [1, 2, 3, 4, 5, 6.5].forEach((x, i) => b.writeFloatLE(x, 10 + h.length + 4 * i));
  const r = parseNpy(b);
  assert.deepEqual(r.shape, [2, 3]);
  assert.deepEqual([...r.data], [1, 2, 3, 4, 5, 6.5]);
  assert.throws(() => parseNpy(Buffer.from(b.toString("latin1").replace("<f4", "<f8"), "latin1")));
});
