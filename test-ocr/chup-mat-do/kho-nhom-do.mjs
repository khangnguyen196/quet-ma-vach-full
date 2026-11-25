// Đợt kho-nhom: KHUNG ĐO NGƯỠNG ĐỘ GIỐNG ẢNH cho "kho sản phẩm của nhóm" (máy chủ so ảnh mặt trước bằng CLIP với ảnh
// trong kho nhóm; khớp đủ chắc thì món nhóm lên vị trí 1 và tự mở như hiện nay, vẫn có khung xác nhận).
// CHỈ đo trong Node, KHÔNG sửa src/ server/ public/. Dữ liệu ảnh thật / nhãn / bảng định danh / vector / kết quả đều
// NGOÀI git (D:\tmp\may-chu-loc, D:\tmp\kho-nhom); file này không chứa mã nhãn / tên ảnh thật.
// Vector ảnh tính bằng test-ocr/chup-mat-do/kho-nhom-vec.py (gọi server/clip_engine.py, đúng bộ tính của máy chủ).
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC — commit riêng "chore(kho-nhom): luật ngưỡng chốt trước đo" TRƯỚC mọi lần tính độ giống trên ảnh đo.
// Viết 2026-11-25 (giờ commit thật + sha ghi ở báo cáo vòng 1 / PLAN.md). Không sửa khối này sau khi thấy bất kỳ điểm độ
// giống nào; buộc phải sửa thì ghi "LỆCH LUẬT" ở PLAN.md và dừng báo. Lúc viết khối này CHƯA tính độ giống nào giữa
// các ảnh đo (chỉ đã xem 7 ảnh thật không mã bằng mắt để gán sản phẩm, và các số của đợt lens trên chỉ mục OFF).
// ===================================================================================================================
// Model: CLIP ViT-B/32 int8 = Xenova/clip-vit-base-patch32 @ 6b7c523703ae26e39be4b03774966f8571c7f523,
//   vision_model_quantized.onnx (89.117.001 B, sha256 MODEL_SHA256), MIT; onnxruntime CPU 1 luồng.
//   Tiền xử lý "cat" của test-ocr/chup-mat-do/lens-vec.py (thu cạnh ngắn về 224 bằng bicubic kiểu sharp affine, cắt
//   giữa 224 × 224, rescale 1/255, mean / std của preprocessor_config.json, CHW float32); vector image_embeds chuẩn hóa
//   L2. EXIF: xoay theo EXIF (ImageOps.exif_transpose) trước mọi bước.
//   Mọi ảnh (kho và ảnh hỏi, kể cả ảnh OFF và ảnh biến đổi) qua cùng bước như app trước khi tính vector: cạnh dài
//   ≤ 1.600 px (fitSize của src/front-photo.js, không phóng to; Pillow LANCZOS như lens-vec.py jpeg_1600), JPEG chất lượng
//   0,9 (Pillow quality 90), rồi giải mã lại.
// Điểm: điểm ảnh = tích vô hướng 2 vector đã chuẩn L2; điểm sản phẩm = max điểm các ảnh của sản phẩm đó trong kho;
//   sản phẩm nhóm đứng đầu = điểm sản phẩm cao nhất (hòa → id sản phẩm nhỏ hơn theo thứ tự chuỗi).
// Bảng định danh: D:\tmp\kho-nhom\dinh-danh.json (sha256 ID_TABLE_SHA256, ngoài git). Mỗi ảnh → id sản phẩm: có mã
//   (nhãn nhan.json / thư mục A/B / tên file ảnh OFF) → "ma:<mã>"; 7 ảnh thật không mã (6 nhãn "none" + 1 nhãn null)
//   gán bằng MẮT theo chữ trên bao bì → "nhin:<tên>" (7 sản phẩm khác nhau, khác mọi mã). Mã khác = sản phẩm khác, kể cả
//   cùng dòng (Milo 3 mã). Bảng: 22 ảnh thật (22 sp), 30 ảnh A/B, 14 ảnh OFF (mã 9931411110563 không có ảnh OFF).
// Kho đo = 22 ảnh thật (D:\tmp\may-chu-loc\anh), mỗi ảnh 1 sản phẩm (22 sp, mỗi sp 1 ảnh).
// Ca âm N (52 ảnh hỏi): 30 ảnh A/B + 22 ảnh thật theo kiểu bỏ-một-sản-phẩm (gồm 8 ảnh thật đang đúng #1 #3 #6 #7 #8
//   #9 #12 #13). Với mỗi ảnh hỏi, kho bỏ MỌI ảnh cùng sản phẩm với ảnh hỏi; s_neg = điểm sản phẩm cao nhất còn lại.
// Ca dương P1 (ảnh khác thật, cùng sản phẩm): ảnh A/B có sản phẩm trong kho (1 ảnh) + ảnh mặt trước OFF của các mã
//   trong kho (14 ảnh, D:\tmp\lens\anh); kho đủ 22. Trúng = sản phẩm nhóm đứng đầu đúng sản phẩm VÀ điểm ≥ T.
// Ca dương P2 (CHỈ ƯỚC LƯỢNG): 22 ảnh thật × P2_TRANSFORMS (danh sách cố định, seed P2_SEED; biến đổi làm trên ảnh gốc
//   đã xoay EXIF, rồi qua bước như app). Khi hỏi: kho bỏ chính ảnh gốc, chỉ giữ ảnh khác cùng sản phẩm nếu có; sản
//   phẩm chỉ có 1 ảnh (cả 22 sp ở kho đo này) thì P2 so với CHÍNH ảnh gốc (kho đủ 22) → ước lượng LẠC QUAN. Trúng như P1.
// Lưới T: 0,500 → 0,990 bước 0,005 (T_GRID). Chọn T = giá trị NHỎ NHẤT trong lưới thỏa T ≥ max(s_neg) + MARGIN (0,03),
//   so sánh theo phần nghìn (T × 1000 ≥ (max s_neg + 0,03) × 1000 − 1e-9). Không có giá trị nào → T = null.
// ĐẠT khi: T ≠ null (≤ 0,99) VÀ recall P1 tại T ≥ 50 % (khi n P1 ≥ 4; n P1 < 4 → xét recall P2 ≥ 70 % và ghi "chỉ ước
//   lượng") VÀ cổng A/B đạt (dưới).
// Cổng A/B: 30 ảnh A/B × 2 bộ chữ (A, B) × OFF (i)(ii) = 120 ô + 8 ảnh thật đang đúng × (i)(ii) = 16 ô. Kết quả app
//   nền = danh sách gộp đã lưu của khung đo khau-gop (D:\tmp\khau-gop\ket-qua\nen.json, perCase.may = serverMerge /
//   photoMerge của src, kiểm chéo allOk true), chỉ dùng khi git diff giữa NEN_SHA và HEAD trống ở NEN_PATHS (mã gộp
//   không đổi). Kho nhóm KHÔNG chứa sản phẩm của ảnh (như N). Luật đưa nhóm lên đầu (applyNhom): điểm sản phẩm nhóm
//   đứng đầu ≥ T → món nhóm vào vị trí 1, các mục cũ lùi (bỏ mục trùng mã), cắt 5; < T → không đổi. Đạt khi 0 ô mất vị
//   trí 1 (mục 1 nền đúng mã mà sau luật mục 1 khác).
// KHÔNG ĐẠT → NHOM_THRESHOLD = Infinity (món nhóm không bao giờ tự mở / chen vị trí 1, chỉ hiện trong "gợi ý khác"), báo
//   chủ dự án. ĐẠT → NHOM_THRESHOLD = T.
// Phải báo: n từng nhóm (N, P1, P2), max s_neg kèm ảnh hỏi (id) và sản phẩm gây ra, phân bố s_neg (min / p50 / p90 /
//   max + cả danh sách), điểm P1 / P2 (đúng sản phẩm hay không + điểm), recall P1 / P2 tại T (và tại T của lưới gần nhất
//   nếu T null: không tính), câu "n nhỏ: 22 ảnh kho, 52 ca âm, 15 ca P1, chỉ để tham khảo".
// Cờ: --kiem (mặc định: tự kiểm khối luật + bảng định danh, không tính điểm), --do (đọc vector của kho-nhom-vec.py, tính
//   mọi thứ → D:\tmp\kho-nhom\ket-qua\do.json; file ra đã có thì dừng, trừ --ghi-de; worktree bẩn / khối luật khác
//   RULE_SHA256 / bảng định danh khác ID_TABLE_SHA256 / vector khác model → thoát mã 3).
export const MODEL_SHA256 = "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299";
export const MODEL_REVISION = "6b7c523703ae26e39be4b03774966f8571c7f523";
export const ID_TABLE_SHA256 = "87ada1432007b7d0aa9b9f24c8672120bcdd17a4d8f6aa5fce0ce7dcef0e8dcf";
export const MARGIN = 0.03;
export const T_MIN_MILLI = 500;
export const T_MAX_MILLI = 990;
export const T_STEP_MILLI = 5;
export const T_GRID = Object.freeze(Array.from({ length: (T_MAX_MILLI - T_MIN_MILLI) / T_STEP_MILLI + 1 }, (_, k) => (T_MIN_MILLI + k * T_STEP_MILLI) / 1000));
export const P1_MIN_N = 4;
export const P1_MIN_RECALL = 0.5;
export const P2_MIN_RECALL = 0.7;
export const LONG_EDGE = 1600;
export const JPEG_QUALITY = 90;
export const P2_SEED = 20261125;
/** Biến đổi P2 (thứ tự cố định; tham số đọc ở kho-nhom-vec.py, không ngẫu nhiên). */
export const P2_TRANSFORMS = Object.freeze([
  "cat-giua-85", // cắt giữa 85 % mỗi cạnh
  "cat-lech-90", // cắt 90 % mỗi cạnh, lệch về góc dưới phải (bỏ 10 % trên + 10 % trái)
  "xoay+6", // xoay +6° (ngược kim đồng hồ), bicubic, giữ cỡ, nền xám 128
  "xoay-6", // xoay −6°
  "sang-0.7", // độ sáng × 0,7 (ImageEnhance.Brightness)
  "sang-1.3", // độ sáng × 1,3
  "tuong-phan-0.7", // tương phản × 0,7 (ImageEnhance.Contrast)
  "thu-50", // thu nhỏ 50 % mỗi cạnh (LANCZOS)
  "jpeg-40", // nén JPEG chất lượng 40 rồi giải mã
]);
/** 8 ảnh thật đang đúng vị trí 1 ở nền (PLAN.md đợt lens / khau-gop), số thứ tự theo nhan.json. */
export const REAL_CORRECT = Object.freeze([1, 3, 6, 7, 8, 9, 12, 13]);
export const NEN_FILE = "D:\\tmp\\khau-gop\\ket-qua\\nen.json";
export const NEN_SHA = "89bb4a5f812ee77e891ea5849c7ea3afc477598b";
export const NEN_PATHS = Object.freeze(["src/front-server.js", "src/front-merge.js", "src/front-extra.js", "src/front-photo.js", "src/front-rank.js", "src/off-search.js", "public/chup-mat-do"]);
export const CONDS = Object.freeze(["i", "ii"]);
export const AB_SETS = Object.freeze(["A", "B"]);
export const SMALL_N_NOTE = "n nhỏ: 22 ảnh kho, 52 ca âm, 15 ca P1, chỉ để tham khảo";

/** Điểm sản phẩm: row = điểm từng ảnh kho, khoSp = id sản phẩm từng ảnh kho; bỏ ảnh có chỉ số trong skipIdx hoặc sản
 * phẩm trong skipSp. Trả [{ sp, score }] giảm dần (hòa → sp nhỏ trước). */
export function productScores(row, khoSp, { skipIdx = new Set(), skipSp = new Set() } = {}) {
  const best = new Map();
  for (let i = 0; i < row.length; i++) {
    if (skipIdx.has(i) || skipSp.has(khoSp[i])) continue;
    const s = row[i];
    if (!best.has(khoSp[i]) || s > best.get(khoSp[i])) best.set(khoSp[i], s);
  }
  return [...best].map(([sp, score]) => ({ sp, score })).sort((a, b) => b.score - a.score || (a.sp < b.sp ? -1 : a.sp > b.sp ? 1 : 0));
}

/** Sản phẩm đứng đầu ({ sp, score }) hoặc null khi kho rỗng. */
export function topProduct(row, khoSp, opts) {
  return productScores(row, khoSp, opts)[0] ?? null;
}

/** T nhỏ nhất của lưới thỏa T ≥ maxNeg + MARGIN (so theo phần nghìn); không có → null. maxNeg không phải số hữu hạn → null. */
export function pickThreshold(maxNeg, margin = MARGIN) {
  if (typeof maxNeg !== "number" || !Number.isFinite(maxNeg)) return null;
  const need = (maxNeg + margin) * 1000 - 1e-9;
  for (let m = T_MIN_MILLI; m <= T_MAX_MILLI; m += T_STEP_MILLI) if (m >= need) return m / 1000;
  return null;
}

/** Recall: pos = [{ sp, top: { sp, score } | null }]; trúng = top đúng sp và điểm ≥ T. T null → 0 trúng. */
export function recallAt(pos, T) {
  const n = pos.length;
  const hit = T == null ? 0 : pos.filter((p) => p.top && p.top.sp === p.sp && p.top.score >= T).length;
  return { n, hit, recall: n ? hit / n : 0 };
}

/** Luật đưa nhóm lên đầu: nhom = { sp, code | null, score } (sản phẩm nhóm đứng đầu). score ≥ T → nhóm vào vị trí 1
 * (bỏ mục cũ trùng mã), cắt k; còn lại không đổi. T = Infinity → không bao giờ đổi. */
export function applyNhom(merged, nhom, T, k = 5) {
  const list = Array.isArray(merged) ? merged : [];
  if (!nhom || typeof nhom.score !== "number" || !(nhom.score >= T)) return list;
  const item = { code: nhom.code ?? null, sp: nhom.sp, source: "nhom", score: nhom.score };
  return [item, ...list.filter((x) => !item.code || x.code !== item.code)].slice(0, k);
}

/** Cổng A/B: cells = [{ id, code (mã đúng), base: [mã] (danh sách gộp nền), nhom: { sp, code, score } }]. Ô mất vị trí 1 =
 * nền mục 1 đúng mã mà sau applyNhom mục 1 không còn đúng mã. */
export function gateAB(cells, T) {
  const lost = [];
  for (const c of cells) {
    const before = c.base?.[0] ?? null;
    if (before !== c.code) continue;
    const after = applyNhom(c.base.map((code) => ({ code })), c.nhom, T)[0];
    if ((after?.code ?? null) !== c.code) lost.push(c.id);
  }
  return { cells: cells.length, lost, pass: cells.length > 0 && lost.length === 0 };
}

/** Phán: { T, p1: recallAt, p2: recallAt, gate: gateAB } → { pass, estimateOnly, threshold, fails }. */
export function judge({ T, p1, p2, gate }) {
  const fails = [];
  if (T == null) fails.push("không có T ≤ 0,99 thỏa T ≥ max(s_neg) + 0,03");
  let estimateOnly = false;
  if (p1 && p1.n >= P1_MIN_N) {
    if (!(p1.recall >= P1_MIN_RECALL)) fails.push(`recall P1 ${p1.hit}/${p1.n} < 50 %`);
  } else {
    estimateOnly = true;
    if (!(p2 && p2.recall >= P2_MIN_RECALL)) fails.push(`n P1 < 4 và recall P2 ${p2?.hit ?? 0}/${p2?.n ?? 0} < 70 %`);
  }
  if (!gate || !gate.pass) fails.push(`cổng A/B: ${gate ? `${gate.lost.length} ô mất vị trí 1` : "thiếu số"}`);
  const pass = fails.length === 0;
  return { pass, estimateOnly, threshold: pass ? T : Infinity, fails };
}
// ===================================================================================================================
// HẾT KHỐI LUẬT
// ===================================================================================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

/** Đường dẫn file này trong repo (so khối luật bằng git show sau khi commit). */
export const RULE_FILE = "test-ocr/chup-mat-do/kho-nhom-do.mjs";
/** sha256 (hex) của khối luật (từ dòng có dấu mở tới hết dòng có dấu đóng). Test + --do kiểm. */
export const RULE_SHA256 = "586b7fddde78b7f914ed3a5a45cae790e0c5123f0fda4057b78651cc1e5cc9f9";

export function sha256Of(text) {
  return crypto.createHash("sha256").update(typeof text === "string" ? Buffer.from(text, "utf8") : text).digest("hex");
}

/** Khối luật của một bản file (như g2-di-qua-do.mjs): từ ĐẦU dòng có dấu mở tới HẾT dòng có dấu đóng; thiếu → null. */
export function ruleBlockOf(text) {
  if (typeof text !== "string") return null;
  const open = ["LUẬT", "CHỐT", "TRƯỚC"].join(" ");
  const close = ["HẾT", "KHỐI", "LUẬT"].join(" ");
  const i = text.indexOf(open);
  if (i < 0) return null;
  const j = text.indexOf(close, i + open.length);
  if (j < 0) return null;
  const start = text.lastIndexOf("\n", i) + 1;
  const nl = text.indexOf("\n", j);
  return text.slice(start, nl < 0 ? text.length : nl + 1);
}

// ---------------- ghim thêm cho --do (vòng 2, review vòng 1 NÊN SỬA 4, 5, 6; NGOÀI khối luật) ----------------
/** Commit luật riêng (vòng 1): --do lấy khối luật từ commit này qua git show, so RULE_SHA256 và khối hiện tại. */
export const RULE_COMMIT = "62dca696d184575b000e95c02311a1cc011bd89b";
/** Mốc mã tính vector: vòng 1 là ce967ca; vòng 2 P3 sửa server/clip_engine.py (int32, bớt RAM, kết quả trùng từng số)
 * ở bfc32a0 nên mốc đổi sang bfc32a0 (TRƯỚC mọi lần tính độ giống). --do đòi 2 file không đổi từ mốc và sha256 trong
 * meta của vector trùng bản ở mốc. */
export const VEC_CODE_BASE = "bfc32a04ef0033c4684886e2ed53f39a8d42ea98";
export const VEC_CODE_FILES = Object.freeze({ vecPySha256: "test-ocr/chup-mat-do/kho-nhom-vec.py", clipEngineSha256: "server/clip_engine.py" });
/** sha256 của NEN_FILE (D:\tmp\khau-gop\ket-qua\nen.json), tính 2026-11-26 trước mọi lần tính độ giống. */
export const NEN_SHA256 = "88f17a8209b765dd6a6da12bc2f8452a706c73e2cf6fe6667e4c8e9cf8226f10";
/** Cổng A/B theo luật: 30 ảnh A/B × 2 bộ chữ × 2 điều kiện OFF = 120 ô + 8 ảnh thật × 2 = 16 ô. */
export const GATE_AB_CELLS = 120;
export const GATE_REAL_CELLS = 16;
export const GATE_CELLS = GATE_AB_CELLS + GATE_REAL_CELLS;
export const GATE_NOTE = "cổng đạt do cách dựng (điểm nhóm của ô = s_neg của ảnh đó, T ≥ max s_neg + 0,03), không phải phép kiểm độc lập";
export const EXIT_RULE = 3;

function deepEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** (b) Khối luật ở commit luật: committedText = nội dung RULE_FILE ở RULE_COMMIT (git show), currentText = file hiện tại.
 * Trả danh sách lỗi (rỗng = đạt). */
export function checkRuleAtCommit(committedText, currentText) {
  const errors = [];
  const old = ruleBlockOf(committedText);
  const cur = ruleBlockOf(currentText);
  if (old === null) errors.push(`không đọc được khối luật ở commit luật ${RULE_COMMIT.slice(0, 7)} (${RULE_FILE})`);
  else if (sha256Of(old) !== RULE_SHA256) errors.push(`khối luật ở commit luật ${RULE_COMMIT.slice(0, 7)} có sha256 ${sha256Of(old)} khác RULE_SHA256`);
  if (cur === null) errors.push("không đọc được khối luật của file hiện tại");
  else if (old !== null && old !== cur) errors.push(`khối luật hiện tại khác khối luật ở commit luật ${RULE_COMMIT.slice(0, 7)}`);
  return errors;
}

/** (a) Mã tính vector ghim: meta = V.meta của vec.json; pinned = { vecPySha256, clipEngineSha256 } của 2 file ở
 * VEC_CODE_BASE; diffEmpty = `git diff --quiet VEC_CODE_BASE HEAD -- <2 file>` trống; headIsAncestor = V.meta.gitHead là
 * tổ tiên của HEAD (git merge-base --is-ancestor). Trả danh sách lỗi. */
export function checkVecMeta(meta, { pinned, diffEmpty, headIsAncestor }) {
  const errors = [];
  const base = VEC_CODE_BASE.slice(0, 7);
  if (diffEmpty !== true) errors.push(`${Object.values(VEC_CODE_FILES).join(" / ")} đã đổi từ mốc ${base} (git diff không trống)`);
  for (const k of Object.keys(VEC_CODE_FILES)) {
    if (!pinned || typeof pinned[k] !== "string") errors.push(`không lấy được sha256 ${VEC_CODE_FILES[k]} ở mốc ${base}`);
    else if (meta?.[k] !== pinned[k]) errors.push(`vector tính bằng ${VEC_CODE_FILES[k]} khác bản ở mốc ${base} (meta.${k} ${meta?.[k] ?? "thiếu"})`);
  }
  if (!deepEqualJson(meta?.p2Transforms, [...P2_TRANSFORMS])) errors.push(`meta.p2Transforms khác P2_TRANSFORMS: ${JSON.stringify(meta?.p2Transforms ?? null)}`);
  if (typeof meta?.gitHead !== "string" || !/^[0-9a-f]{40}$/.test(meta.gitHead)) errors.push(`meta.gitHead sai dạng: ${JSON.stringify(meta?.gitHead ?? null)}`);
  else if (headIsAncestor !== true) errors.push(`meta.gitHead ${meta.gitHead.slice(0, 7)} không phải tổ tiên của HEAD`);
  return errors;
}

/** sha256 nền khau-gop: lỗi khi khác NEN_SHA256. */
export function checkNenSha(sha) {
  return sha === NEN_SHA256 ? [] : [`sha256 ${NEN_FILE} = ${sha ?? "không đọc được"}, khác NEN_SHA256 ${NEN_SHA256}`];
}

/** (c) Ô cổng A/B từ bảng định danh + nền khau-gop. Ô A/B không đọc được chữ (thiếu perCase / may[cond]) được ĐẾM vào
 * unreadable (không bỏ lặng lẽ); ảnh thật thiếu perCase là lỗi; tổng phải đúng GATE_CELLS (136), thiếu → lỗi.
 * nhomOf(id ảnh) → { sp, code, score } (chỉ gọi khi đã có vector). Trả { cells, unreadable, errors }. */
export function buildGateCells(table, nen, nhomOf) {
  const cells = [];
  const unreadable = [];
  const errors = [];
  const abImgs = (table?.images ?? []).filter((y) => y.nhom === "ab");
  for (const s of AB_SETS) for (const x of abImgs) {
    const code = x.sp.slice(3);
    const per = nen?.perCase?.[`${s}|${code}|anh`];
    for (const cond of CONDS) {
      const id = `${s}|${code}|${cond}`;
      if (!Array.isArray(per?.may?.[cond])) { unreadable.push(id); continue; }
      cells.push({ id, code, base: per.may[cond], nhom: nhomOf(x.id) });
    }
  }
  for (const n of REAL_CORRECT) {
    const x = (table?.images ?? []).find((y) => y.id === `that-${n}`);
    const per = nen?.perCase?.[`anh-${n}`];
    if (!x) { errors.push(`bảng định danh thiếu ảnh thật that-${n}`); continue; }
    for (const cond of CONDS) {
      if (!Array.isArray(per?.may?.[cond])) { errors.push(`nền khau-gop thiếu perCase ảnh thật anh-${n} (${cond})`); continue; }
      cells.push({ id: `that-${n}|${cond}`, code: x.sp.slice(3), base: per.may[cond], nhom: nhomOf(x.id) });
    }
  }
  if (cells.length !== GATE_CELLS) {
    errors.push(`cổng A/B có ${cells.length} ô, luật ghi ${GATE_CELLS} (${GATE_AB_CELLS} ô A/B + ${GATE_REAL_CELLS} ô ảnh thật); ${unreadable.length} ô A/B không đọc được chữ${unreadable.length ? `: ${unreadable.join(", ")}` : ""}`);
  }
  return { cells, unreadable, errors };
}

/** (d) Cặp file trùng sha256 giữa ảnh A/B và ảnh OFF trong bảng định danh (trùng → P1 đếm 2 lần). Trả danh sách
 * { ab: sp, off: sp } (chỉ mã sản phẩm, không tên ảnh); ảnh thiếu sha256 → lỗi. */
export function dupAbOff(table) {
  const imgs = table?.images ?? [];
  const errors = [];
  const ab = imgs.filter((x) => x.nhom === "ab");
  const off = imgs.filter((x) => x.nhom === "off");
  for (const x of [...ab, ...off]) if (typeof x.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(x.sha256)) errors.push(`ảnh ${x.nhom} của ${x.sp} thiếu sha256`);
  const pairs = [];
  for (const a of ab) for (const o of off) if (a.sha256 && a.sha256 === o.sha256) pairs.push({ ab: a.sp, off: o.sp });
  return { pairs, errors };
}

/** Phân vị nearest rank (p trong [0, 1]) của mảng số. */
export function quantileNR(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length - 1e-9) - 1))];
}

/** Dựng ca từ bảng định danh + vector: vec = { [id ảnh]: number[512] }, p2 = { [id ảnh thật]: { [biến đổi]: number[] } }. */
export function buildCases(table, vec, p2 = {}) {
  const imgs = table.images;
  const kho = imgs.filter((x) => x.nhom === "that");
  const khoSp = kho.map((x) => x.sp);
  const khoSet = new Set(khoSp);
  const K = kho.map((x) => vec[x.id]);
  if (K.some((v) => !Array.isArray(v))) throw new Error("thiếu vector ảnh kho");
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const rowOf = (q) => K.map((k) => dot(q, k));
  const neg = [];
  for (const x of imgs.filter((y) => y.nhom === "ab" || y.nhom === "that")) {
    const q = vec[x.id];
    if (!Array.isArray(q)) throw new Error(`thiếu vector ${x.id}`);
    const top = topProduct(rowOf(q), khoSp, { skipSp: new Set([x.sp]) });
    neg.push({ id: x.id, sp: x.sp, top });
  }
  const p1 = imgs.filter((x) => (x.nhom === "ab" || x.nhom === "off") && khoSet.has(x.sp)).map((x) => {
    const q = vec[x.id];
    if (!Array.isArray(q)) throw new Error(`thiếu vector ${x.id}`);
    return { id: x.id, sp: x.sp, top: topProduct(rowOf(q), khoSp) };
  });
  const p2Cases = [];
  kho.forEach((x, idx) => {
    for (const t of P2_TRANSFORMS) {
      const q = p2?.[x.id]?.[t];
      if (!Array.isArray(q)) throw new Error(`thiếu vector P2 ${x.id} ${t}`);
      const others = kho.some((y, j) => j !== idx && y.sp === x.sp);
      // có ảnh khác cùng sp → bỏ ảnh gốc; chỉ 1 ảnh → so với chính ảnh gốc (lạc quan)
      const top = topProduct(rowOf(q), khoSp, { skipIdx: others ? new Set([idx]) : new Set() });
      p2Cases.push({ id: `${x.id}|${t}`, sp: x.sp, top, selfCompare: !others });
    }
  });
  return { neg, p1, p2: p2Cases, khoSp, nhomOf: (id) => {
    const x = imgs.find((y) => y.id === id);
    const top = topProduct(rowOf(vec[id]), khoSp, { skipSp: new Set([x.sp]) });
    return top ? { sp: top.sp, code: top.sp.startsWith("ma:") ? top.sp.slice(3) : null, score: top.score } : null;
  } };
}

// ---------------- ghim chính khung đo (vòng 3, review vòng 2 NÊN SỬA 2 + GỢI Ý 4; NGOÀI khối luật) ----------------
/** File mốc (riêng, trong git): { doCodeBase: sha đầy đủ của commit cuối của khung đo }. Mốc không thể nằm trong chính file
 * này vì ghi sha vào file thì file đổi. --do đòi: file mốc có; git diff doCodeBase..HEAD của RULE_FILE trống; doCodeBase là
 * tổ tiên của HEAD. */
export const MOC_FILE = "test-ocr/chup-mat-do/kho-nhom-moc.json";

/** Đọc nội dung file mốc: null (không có file) → null; JSON hỏng → {} (sẽ báo sai dạng). */
export function parseMoc(text) {
  if (text == null) return null;
  try {
    const o = JSON.parse(typeof text === "string" ? text : text.toString("utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/** sha hợp lệ để đưa vào lệnh git (40 hex thường). */
export function isFullSha(x) {
  return typeof x === "string" && /^[0-9a-f]{40}$/.test(x);
}

/** (a) Mốc khung đo: moc = parseMoc(…); diffEmpty = git diff --quiet <doCodeBase> HEAD -- RULE_FILE trống; isAncestor =
 * doCodeBase là tổ tiên của HEAD. Trả danh sách lỗi (rỗng = đạt). */
export function checkDoCodeBase(moc, { diffEmpty, isAncestor } = {}) {
  if (moc == null) return [`thiếu file mốc ${MOC_FILE} (khóa doCodeBase = sha commit cuối của khung đo, tạo ở commit riêng ngay sau)`];
  if (!isFullSha(moc.doCodeBase)) return [`${MOC_FILE}: doCodeBase sai dạng ${JSON.stringify(moc.doCodeBase ?? null)} (cần sha 40 hex)`];
  const errors = [];
  const base = moc.doCodeBase.slice(0, 7);
  if (diffEmpty !== true) errors.push(`${RULE_FILE} đã đổi từ mốc doCodeBase ${base} (git diff ${base} HEAD không trống): khung đo phải đúng bản đã ghim`);
  if (isAncestor !== true) errors.push(`doCodeBase ${base} không phải tổ tiên của HEAD`);
  return errors;
}

/** (b) Chạy lại --do --ghi-de: vec.json đang đọc phải trùng sha256 đã ghi trong do.json cũ. prevOut null → không kiểm. */
export function checkPrevVec(prevOut, vecSha256) {
  if (prevOut == null) return [];
  if (prevOut.vecSha256 === vecSha256) return [];
  return [`vec.json đang đọc có sha256 ${vecSha256 ?? "không đọc được"}, khác vecSha256 đã ghi trong do.json cũ (${prevOut.vecSha256 ?? "thiếu"}): không ghi đè kết quả bằng vector khác`];
}

/** (c) Kiểm nền khau-gop + đủ ô cổng A/B (chỉ đếm ô, không tính điểm): chạy ở cả --kiem và --do. */
export function checkNenGate(nenSha, table, nen) {
  const gate = buildGateCells(table, nen, () => null);
  return { errors: [...checkNenSha(nenSha), ...gate.errors], cells: gate.cells.length, unreadable: gate.unreadable.length };
}

// ---------------- chạy ----------------
/** Chạy khung đo; trả mã thoát (0 đạt kiểm / đo xong, 2 đã có do.json mà thiếu --ghi-de, 3 sai luật / mốc / dữ liệu).
 * io (để test bằng dữ liệu giả): { root, selfText, git(lệnh) → Buffer | null (null = lệnh lỗi / thoát ≠ 0), exists(p),
 * read(p) → Buffer, write(p, text), mkdir(p), log(s), error(s) }. Mọi kiểm chạy TRƯỚC khi tính bất kỳ điểm độ giống nào;
 * kiểm gom đủ lỗi rồi mới dừng (một lần chạy báo hết các chỗ sai). */
export async function main(argv, io) {
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const mode = argv.includes("--do") ? "do" : "kiem";
  const tableFile = arg("--bang", "D:\\tmp\\kho-nhom\\dinh-danh.json");
  const vecFile = arg("--vec", "D:\\tmp\\kho-nhom\\vec\\vec.json");
  const outDir = arg("--out", "D:\\tmp\\kho-nhom\\ket-qua");
  const nenPath = arg("--nen", NEN_FILE);
  const gitText = (c) => io.git(c)?.toString() ?? null;
  const readOrNull = (p) => { try { return io.exists(p) ? io.read(p) : null; } catch { return null; } };
  const jsonOrNull = (buf) => { if (buf == null) return null; try { return JSON.parse(buf.toString("utf8")); } catch { return null; } };
  const stop = (errors) => { for (const e of errors) io.error(`DỪNG (mã ${EXIT_RULE}): ${e}`); return EXIT_RULE; };
  const errors = [];

  const block = ruleBlockOf(io.selfText);
  const blockSha = block === null ? null : sha256Of(block);
  const tableBuf = readOrNull(tableFile);
  const tableSha = tableBuf === null ? null : sha256Of(tableBuf);
  io.log(`Khối luật sha256 ${blockSha} ${blockSha === RULE_SHA256 ? "TRÙNG" : "KHÁC"} RULE_SHA256`);
  io.log(`Bảng định danh ${tableFile}: sha256 ${tableSha} ${tableSha === ID_TABLE_SHA256 ? "TRÙNG" : "KHÁC"} ID_TABLE_SHA256`);
  if (blockSha !== RULE_SHA256) errors.push(`khối luật sha256 ${blockSha} khác RULE_SHA256`);
  if (tableSha !== ID_TABLE_SHA256) errors.push(`bảng định danh sha256 ${tableSha ?? "không đọc được"} khác ID_TABLE_SHA256`);
  const table = jsonOrNull(tableBuf);
  if (tableBuf !== null && table === null) errors.push("bảng định danh không phải JSON");
  // (d) ảnh A/B và ảnh OFF trùng file (sha256 trong bảng định danh) → P1 đếm 2 lần
  const dup = dupAbOff(table);
  io.log(`Cặp file trùng sha256 giữa ảnh A/B và ảnh OFF: ${dup.pairs.length}`);
  errors.push(...dup.errors);
  if (dup.pairs.length > 0) errors.push(`${dup.pairs.length} cặp ảnh A/B trùng file ảnh OFF (mã A/B → mã OFF): ${dup.pairs.map((p) => `${p.ab} → ${p.off}`).join(", ")}`);
  // (c) nền khau-gop (sha256) + đủ 136 ô cổng A/B (chỉ đếm ô), ở cả --kiem và --do
  const nenBuf = readOrNull(nenPath);
  const nenSha = nenBuf === null ? null : sha256Of(nenBuf);
  const nen = jsonOrNull(nenBuf);
  const ng = checkNenGate(nenSha, table, nen);
  io.log(`Nền khau-gop ${nenPath}: sha256 ${nenSha} ${nenSha === NEN_SHA256 ? "TRÙNG" : "KHÁC"} NEN_SHA256; cổng A/B ${ng.cells} ô (${ng.unreadable} ô A/B không đọc được chữ), luật ghi ${GATE_CELLS}`);
  errors.push(...ng.errors);

  if (mode === "kiem") {
    if (errors.length) return stop(errors);
    const moc = parseMoc(readOrNull(path.join(io.root, MOC_FILE)));
    io.log(`Mốc khung đo ${MOC_FILE}: ${moc == null ? "chưa có (--do sẽ dừng)" : `doCodeBase ${isFullSha(moc.doCodeBase) ? moc.doCodeBase.slice(0, 7) : "sai dạng"}`}`);
    io.log("--kiem: không tính điểm. Đo bằng --do (cần vector của kho-nhom-vec.py).");
    return 0;
  }

  // ----- --do: mọi kiểm dưới đây chạy TRƯỚC khi tính bất kỳ điểm độ giống nào -----
  const porcelain = gitText("git status --porcelain");
  if (porcelain === null || porcelain.trim() !== "") errors.push("worktree chưa sạch: commit rồi chạy lại");
  const head = gitText("git rev-parse HEAD")?.trim() ?? null;
  // (b vòng 2) khối luật ở commit luật (git show) == RULE_SHA256 == khối hiện tại
  errors.push(...checkRuleAtCommit(gitText(`git show ${RULE_COMMIT}:${RULE_FILE}`), io.selfText));
  // (a vòng 3) khung đo đúng bản ghim ở file mốc
  const moc = parseMoc(readOrNull(path.join(io.root, MOC_FILE)));
  const base = isFullSha(moc?.doCodeBase) ? moc.doCodeBase : null;
  const diffEmpty = base !== null && io.git(`git diff --quiet ${base} HEAD -- ${RULE_FILE}`) !== null;
  const isAncestor = base !== null && io.git(`git merge-base --is-ancestor ${base} HEAD`) !== null;
  errors.push(...checkDoCodeBase(moc, { diffEmpty, isAncestor }));
  // vector + (b vòng 3) sha256 vec.json so do.json cũ
  const vecBuf = readOrNull(vecFile);
  const vecSha256 = vecBuf === null ? null : sha256Of(vecBuf);
  const V = jsonOrNull(vecBuf);
  if (V === null) errors.push(`không đọc được vector ${vecFile}`);
  const outFile = path.join(outDir, "do.json");
  const prevBuf = readOrNull(outFile);
  if (prevBuf !== null && !argv.includes("--ghi-de")) { io.error(`Đã có ${outFile}. Thêm --ghi-de nếu thật sự muốn ghi đè.`); return 2; }
  const prevOut = prevBuf === null ? null : (jsonOrNull(prevBuf) ?? {});
  errors.push(...checkPrevVec(prevOut, vecSha256));
  if (V?.meta?.modelSha256 !== MODEL_SHA256 || V?.meta?.pre !== "cat" || V?.meta?.idTableSha256 !== ID_TABLE_SHA256
    || V?.meta?.longEdge !== LONG_EDGE || V?.meta?.jpegQuality !== JPEG_QUALITY || V?.meta?.gitDirty !== false) {
    errors.push(`vector khác luật (model / tiền xử lý / bảng định danh / bước như app / worktree sạch): ${JSON.stringify(V?.meta ?? null)}`);
  }
  // (a vòng 2) mã tính vector ghim ở VEC_CODE_BASE; p2Transforms; gitHead là tổ tiên của HEAD
  const files = Object.values(VEC_CODE_FILES);
  const vecDiffEmpty = io.git(`git diff --quiet ${VEC_CODE_BASE} HEAD -- ${files.join(" ")}`) !== null;
  const pinned = Object.fromEntries(Object.entries(VEC_CODE_FILES).map(([k, f]) => {
    const b = io.git(`git show ${VEC_CODE_BASE}:${f}`);
    return [k, b === null ? null : sha256Of(b)];
  }));
  const gh = isFullSha(V?.meta?.gitHead) ? V.meta.gitHead : null;
  const headIsAncestor = gh !== null && io.git(`git merge-base --is-ancestor ${gh} HEAD`) !== null;
  errors.push(...checkVecMeta(V?.meta, { pinned, diffEmpty: vecDiffEmpty, headIsAncestor }));
  // cổng A/B: nền đã lưu của khau-gop (mã gộp không đổi từ NEN_SHA)
  const sameCode = io.git(`git diff --quiet ${NEN_SHA} HEAD -- ${NEN_PATHS.join(" ")}`) !== null;
  if (!sameCode || nen?.allOk !== true || nen?.sha !== NEN_SHA) errors.push(`nền A/B không dùng được: mã gộp đổi ${!sameCode}, allOk ${nen?.allOk}, sha ${nen?.sha}`);
  for (const n of REAL_CORRECT) {
    const rb = nen?.realBase?.[`anh-${n}`];
    if (!(rb?.i?.pos === 1 && rb?.ii?.pos === 1)) errors.push(`ảnh thật ${n} không đúng vị trí 1 ở nền khau-gop`);
  }
  if (errors.length) return stop(errors);
  io.log(`Khối luật ở commit luật ${RULE_COMMIT.slice(0, 7)} trùng; khung đo trùng mốc ${base.slice(0, 7)}; mã tính vector trùng mốc ${VEC_CODE_BASE.slice(0, 7)}; vec.json sha256 ${vecSha256}; nền khau-gop đúng; cổng A/B ${ng.cells} ô.`);

  const cs = buildCases(table, V.vec, V.p2);
  const sNeg = cs.neg.map((x) => x.top?.score ?? -Infinity);
  const maxNeg = Math.max(...sNeg);
  const worst = cs.neg[sNeg.indexOf(maxNeg)];
  const T = pickThreshold(maxNeg);
  const p1 = recallAt(cs.p1, T);
  const p2 = recallAt(cs.p2, T);

  const gateBuilt = buildGateCells(table, nen, cs.nhomOf);
  if (gateBuilt.errors.length) return stop(gateBuilt.errors);
  const gateCells = gateBuilt.cells;
  const gate = gateAB(gateCells, T ?? Infinity);
  const verdict = judge({ T, p1, p2, gate });
  const dist = (xs) => ({ n: xs.length, min: Math.min(...xs), p50: quantileNR(xs, 0.5), p90: quantileNR(xs, 0.9), max: Math.max(...xs) });
  const out = {
    at: new Date().toISOString(), head, doCodeBase: base, vecSha256, ruleSha256: RULE_SHA256, idTableSha256: ID_TABLE_SHA256, vecMeta: V.meta,
    n: { neg: cs.neg.length, p1: cs.p1.length, p2: cs.p2.length, gateCells: gateCells.length, gateUnreadable: gateBuilt.unreadable.length }, note: SMALL_N_NOTE,
    maxNeg, worst, T, p1, p2, gate, gateNote: GATE_NOTE, verdict, NHOM_THRESHOLD: verdict.threshold === Infinity ? "Infinity" : verdict.threshold,
    sNegDist: dist(sNeg), p1Dist: dist(cs.p1.map((x) => x.top.score)), p2Dist: dist(cs.p2.map((x) => x.top.score)),
    neg: cs.neg, p1Cases: cs.p1, p2Cases: cs.p2,
  };
  io.mkdir(outDir);
  io.write(outFile, JSON.stringify(out, null, 1));
  io.log(`N ${cs.neg.length}, P1 ${cs.p1.length}, P2 ${cs.p2.length} (${SMALL_N_NOTE})`);
  io.log(`max s_neg ${maxNeg.toFixed(4)} (ảnh hỏi ${worst.id}, sản phẩm ${worst.top?.sp}); s_neg ${JSON.stringify(out.sNegDist)}`);
  io.log(`T ${T}; recall P1 ${p1.hit}/${p1.n}, P2 ${p2.hit}/${p2.n} (chỉ ước lượng, lạc quan); cổng A/B ${gate.pass ? "ĐẠT" : "KHÔNG"} (${gate.lost.length}/${gate.cells} ô mất vị trí 1; ${GATE_NOTE})`);
  io.log(`${verdict.pass ? "ĐẠT" : "KHÔNG ĐẠT"}: NHOM_THRESHOLD = ${out.NHOM_THRESHOLD}${verdict.fails.length ? ` (${verdict.fails.join("; ")})` : ""}. Ghi ${outFile}`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cp = await import("node:child_process");
  const io = {
    root: ROOT,
    selfText: fs.readFileSync(new URL(import.meta.url), "utf8"),
    git: (c) => { try { return cp.execSync(c, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }); } catch { return null; } },
    exists: (p) => fs.existsSync(p),
    read: (p) => fs.readFileSync(p),
    write: (p, text) => fs.writeFileSync(p, text, "utf8"),
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
    log: (s) => console.log(s),
    error: (s) => console.error(s),
  };
  process.exit(await main(process.argv.slice(2), io));
}
