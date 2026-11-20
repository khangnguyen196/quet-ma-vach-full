// Đợt may-chu-loc vòng 2: KHUNG ĐO "máy chủ ghép câu tìm tốt hơn" (bỏ dòng rác / dòng nổi bật / từ ở chữ to nặng điểm
// hơn) cho 10 ứng viên máy chủ của Chụp mặt trước. CHỈ đo trong Node, KHÔNG sửa src/ server/ public/ tests/.
// Commit đầu tiên của file này CHỈ có khối luật (comment) + hằng số; code đo viết SAU commit đó.
//
//   node --max-old-space-size=6144 test-ocr/chup-mat-do/may-chu-loc-do.mjs (--chi-nen | --do-cach) [--out <thư mục>]
//        [--goc <ket-qua-goc.json>] [--nhan <nhan.json>] [--cache <thư mục>] [--ocr <thư mục>] [--danh-muc <c.jsonl.gz>]
//        [--g2 <thư mục ket-qua-v4 của g2-di-qua>] [--mo-rong <json>] [--ghi-de]
//   --chi-nen  chỉ NỀN + kiểm chéo (0)–(4) → <out>/nen.json.
//   --do-cach  nền + kiểm chéo (0)–(4), rồi đo 89 cách theo luật → <out>/do.json.
//   Kiểm chéo (0)–(4) lệch → ghi <out>/nen.loi.json hoặc do.loi.json (KHÔNG ghi nen.json / do.json), thoát mã 3.
//   Cả hai: tự kiểm trước (khối luật trùng sha256 RULE_SHA256 và trùng từng byte commit RULE_SHA; worktree sạch),
//   lệch → thoát mã 3. Phải có đúng một cờ (không cờ / hai cờ → thoát mã 2). File ra đã có → dừng (trừ --ghi-de).
//   Dữ liệu ảnh thật / nhãn / kết quả đều NGOÀI git (D:\tmp\may-chu-loc); file này không chứa mã nhãn / tên ảnh thật.
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC — commit riêng "test(may-chu-loc): luật đo chốt trước" TRƯỚC mọi dòng code đo và TRƯỚC mọi lần chạy
// một cách trên ca thật. Viết lúc 2026-11-20 (giờ commit thật + sha ghi ở PLAN.md mục đợt may-chu-loc). Không sửa khối
// này sau khi thấy số của bất kỳ cách nào; buộc phải sửa thì ghi "LỆCH LUẬT" ở PLAN.md và dừng báo.
// Lúc viết khối này ĐÃ thấy: chẩn đoán 22 ảnh thật (nguyên nhân, hạng mã nhãn ở nền), CHƯA thấy số của cách nào.
// ===================================================================================================================
// Nền = mã ở da1ca3b (BASE_SHA): app gộp đường máy chủ bằng serverMerge = G2 + c-idf (serverIdf true).
// Hai đường (OFF cùng câu như nền):
//   MÁY: found = T1 trên danh mục 1.452 của app (rankFromItems / rankFromText, KHÔNG đổi, k 5); S = 10 ứng viên trên
//     danh mục mức (c) (server/catalog/c.jsonl.gz, chỉ mục JS buildRankIndex = catalog_search.py, khớp Python) theo
//     cách đang đo, qua serverCandidates; S có ≥ 1 mục → serverMerge của src (G2 + c-idf), S rỗng → photoMerge + kho
//     phụ 893 (như app); rồi photoOutcome. Cách CHỈ đổi câu tìm / cách tìm 10 ứng viên của máy chủ (S).
//   LÙI: photoMerge + kho phụ 893 của src (không đổi): chỉ kiểm giống hệt nền từng ô.
// Điều kiện OFF: (i) lỗi (mọi câu lỗi mạng); (ii) cache đĩa D:\tmp\tu-dong\cache-off (câu thiếu cache = lỗi).
//   0 lượt OFF thật, 0 lượt Azure, không chạy lại OCR.
// Câu tìm nền của máy chủ = t1QueryFromLines(rowLineInfo(items), từ vựng + bí danh của (c)) (= row_line_info /
//   usable_line / t1_query_from_lines của server/catalog_search.py).
//
// Lưới chốt sẵn = ĐÚNG lưới 89 cách của dong-noi-bat-do.mjs (methodGrid / METHOD_ORDER), chỉ áp cho S:
//   (a) bỏ dòng rác (filterRows trên hàng rowLineInfo): a-c70, a-c80, a-url, a-so, a-ui, a-tong, a-tong-c70,
//       a-tong-c80 (tiêu chí như dong-noi-bat). Lọc làm câu tìm rỗng → dùng mọi hàng (giống nền từng ca).
//   (b) dòng nổi bật: b-h1..3, b-hoa1..3; RRF hằng số 60 với danh sách tìm cả câu (sâu 10), như dong-noi-bat.
//   (c) từ ở chữ to nặng điểm hơn: c-0.5, c-1, c-2 (trọng số 1 + β × max(0, cao / m − 1), m = trung vị dưới).
//   (a)+(b), (a)+(c): mọi biến thể (a) × mọi ô (b) / (c) (lọc hàng trước, rồi (b) / (c) trên khung của hàng còn lại;
//     lọc rỗng → mọi hàng).
//   Không thêm cách sau khi thấy số.
// "CHIỀU CAO" ở (b) và (c) = CHIỀU CAO KHUNG CHỮ (item box), KHÔNG phải h của hàng rowLineInfo (h hàng = khung cao
//   nhất của hàng; chẩn đoán thấy nhiều khung chữ dọc / chữ to làm cả ảnh thành 1 hàng cao 660–697 px):
//   cao(khung) = cạnh ngắn của tứ giác poly = min((|p0p1| + |p2p3|) / 2, (|p1p2| + |p3p0|) / 2) (không phụ thuộc chữ
//     xoay dọc); poly không đủ 4 điểm → maxY − minY.
//   Đơn vị xét là TỪNG KHUNG (không phải hàng): mỗi khung của các hàng dùng (sau (a)) là một "dòng" { text: chữ khung,
//     h: cao(khung), conf: score khung }; (b) xếp các khung này (usableLine, câu tìm riêng khác rỗng; "hoa" thêm điều
//     kiện in hoa + 1–3 từ) theo cao giảm dần, hòa → khung đứng trước theo thứ tự hàng rồi minX; lấy k khung, mỗi khung
//     tìm riêng; (c) trọng số từ = lớn nhất trên các khung có từ đó trong câu tìm riêng của khung, m = trung vị dưới cao
//     của các khung có câu tìm riêng khác rỗng; từ không nằm trong khung nào → trọng số 1.
//   Không có khung (câu gõ) → (b)(c) như nền.
//   Điểm gắn vào S: (a) BM25 câu đã lọc; (b) BM25 câu đầy đủ của tài liệu; (c) BM25 không trọng số (như dong-noi-bat).
//
// Ca (ô = ca × điều kiện OFF (i)(ii)):
//   A / B: 60 ảnh bộ A / B (D:\tmp\tu-dong\ocr\bo-a-30.json, bo-b-30.json; mã đúng như cũ).
//   22 ảnh thật (D:\tmp\may-chu-loc\ket-qua-goc.json, nhãn D:\tmp\may-chu-loc\nhan.json, NGOÀI git): chia theo luật
//     vòng 0: trong mỗi thư mục xếp MỌI file (kể cả nhãn null) theo tên tăng dần (so chuỗi), vị trí lẻ (1, 3, 5…) = GIỮ
//     RIÊNG, chẵn = CHỈNH; sau khi chia mới bỏ ảnh nhãn null. Nhãn "none" = không có dữ liệu. Ảnh nhãn chọn sẵn (preset)
//     tính như ảnh có nhãn (ghi "chưa xác nhận"). Khung đo tính lại phép chia từ nhan.json lúc chạy.
//   7Up chữ máy + câu gõ (khóa ca có kind); muối Co.op; buldak.jpg; ruaypuan.jpg (D:\tmp\dong-noi-bat\ocr\); 6 ca ngoại
//     dựng (foreignCases như g2-di-qua); ca tổng hợp chèn rác (injectJunk trên A / B; CHỈ BÁO); 70 ca dò (pickProbes;
//     CHỈ BÁO).
//
// Cổng (MÁY, (i) và (ii); "nền" = nền cùng ca, cùng điều kiện, cùng lần chạy):
//   C1 A + B: 0 ảnh mất vị trí 1, 0 ảnh mới rơi khỏi 5 so với nền (lossOf).
//   C2 22 ảnh thật có nhãn mã (cả CHỈNH và GIỮ RIÊNG, kể cả preset): 0 ô mà nền có nhãn ở vị trí 1 bị mất vị trí 1; 0 ô
//      mà nền có nhãn trong 5 bị rơi khỏi 5. Ảnh nền ngoài 5 không xét ở C2. Ảnh "none": chỉ báo (kind không đổi vì
//      CONFIDENCE_RULE luôn không chắc).
//   C3 7Up Diet 8934588752117 vị trí 1 ở 4 ô (chữ máy / câu gõ × (i)(ii)); buldak 8801073250574 vị trí 1 ở (i)(ii);
//      muối Co.op photoOutcome kind "open" ở MÁY (i)(ii) và LÙI (i)(ii); 6 ca ngoại: tổng số ô vị trí 1 và tổng số ô
//      trong 5 (trên 12 ô) không giảm so với nền.
//   C4 S ≤ 10 mục ở mọi ca; (a) lọc hết dòng → quay về mọi dòng. Ở ca quay về: cách chỉ có (a) → S trùng nền; cách
//      (a)+(b) / (a)+(c) → S trùng S của cách (b) / (c) cùng tham số không có (a) (cùng ca, cùng lần chạy). found luôn
//      trùng nền.
//   C5 Không đổi src/, server/, public/, package.json, package-lock.json so với da1ca3b (git diff --quiet); lúc chạy:
//      CONFIDENCE_RULE { feature: null, threshold: null }, STRANGE_MODE null, SERVER_MERGE_OPTS / DEFAULT_GUARD như nền
//      (G2 / c-idf, danh mục, kho phụ, dependency không đổi); câu OFF (cleanQuery) từng ca trùng nền; danh sách 5 mã LÙI
//      từng ô trùng nền.
//   C6 H3 ước p95 ≤ 200 ms: H3 ước = 23,5 ms × p95_Node(cách) / p95_Node(nền) (p95 nearest rank thời gian tạo S trên 30
//      ảnh bộ B, như dong-noi-bat); H2 ước = 835,3 MiB ≤ 1.536 MiB (không cách nào thêm cấu trúc dữ liệu lớn).
// Mục tiêu (chỉ xét cách qua MỌI cổng), thứ tự ưu tiên (lớn hơn trước):
//   M1 = số ô MÁY trong 5 của tập T = {ruaypuan 8852052150101} ∪ {ảnh thư mục 2 GIỮ RIÊNG có nhãn mã} ((i)(ii));
//   M2 = số ô MÁY vị trí 1 của cùng tập T;
//   M3 (hòa) = số ô MÁY trong 5 của ảnh nhóm CHỈNH thư mục 1 + 2 có nhãn mã, chỉ tính ô mà nền chưa ở vị trí 1;
//   hòa nữa → cách đơn giản hơn theo METHOD_ORDER của dong-noi-bat (a < c < b < (a)+(c) < (a)+(b), trong nhóm theo thứ
//   tự liệt kê). Cách được chọn mà M1 KHÔNG hơn M1 nền → không giữ gì ("không cách nào đạt").
//   Mọi số thư mục 2 ghi "chỉ để tham khảo (n ≤ 2)".
// Không cách nào đạt → đề xuất số ảnh cần thêm loại thư mục 2 ("quét sản phẩm không ra nhưng quét mã vạch ra"):
//   (1) phép thử dấu một phía (McNemar chính xác), α = 0,05, 0 ảnh hỏng: cần ≥ 5 ảnh được cách sửa (0,5^5 = 0,031 ≤
//       0,05) ⇒ số ảnh ≈ ⌈5 / p⌉, p = tỷ lệ ảnh loại 2 mà cách tốt nhất sửa được (ước từ nhóm chỉnh + chẩn đoán); không
//       ước được → bảng p = 0,2 / 0,3 / 0,5 → 25 / 17 / 10 ảnh;
//   (2) ước tỷ lệ ±15 điểm % ở độ tin 95%: n ≈ ⌈1,96² · p(1 − p) / 0,15²⌉ (p = 0,5 → 43). Ghi cả hai.
// Vòng 3 (2026-11-20): sửa C4 trước khi chạy --do-cach, LỆCH LUẬT so với 2206809, chưa có số cách nào; lý do: cách
//   ghép trượt C4 vì cấu trúc.
// Tự kiểm: khối luật kiểm bằng sha256 (RULE_SHA256, đặt ngoài khối sau commit luật) và so từng byte với commit luật
//   (git show); đo chỉ chạy khi worktree sạch và khối luật trùng; lệch → thoát mã 3.
// ===================================================================================================================
export const BASE_SHA = "da1ca3b";
export const SERVER_K = 10;
export const FOUND_K = 5;
export const MERGE_K = 5;
export const CONDS = Object.freeze(["i", "ii"]);
export const FOLDERS = Object.freeze(["1-ra-dung", "2-ma-vach-ra", "3-khong-ra"]);
export const CODE_7UP_DIET = "8934588752117";
export const BULDAK_CODE = "8801073250574";
export const RUAYPUAN_CODE = "8852052150101";
export const H3_PY_BASE_MS = 23.5;
export const H3_MAX_MS = 200;
export const H2_EST_MIB = 835.3;
export const H2_MAX_MIB = 1536;
export const SIGN_MIN_FIXED = 5;
export const P_TABLE = Object.freeze([0.2, 0.3, 0.5]);
export const Z95 = 1.96;
export const MARGIN = 0.15;
// ===================================================================================================================
// HẾT KHỐI LUẬT
// ===================================================================================================================

// ---------------- code đo (viết SAU commit luật 2206809; cài đúng định nghĩa trong khối luật) ----------------
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bm25DocScore } from "../../src/front-merge.js";
import {
  filterRows, prominentRows, rrfFuse, rowWeights, weightedSearch, rowsOf, injectJunk, methodGrid, METHOD_ORDER, p95, LIST_DEPTH,
} from "./dong-noi-bat-do.mjs";
import { keyOf, rankIn, ruleBlockOf, sha256Of } from "./g2-di-qua-do.mjs";

/** Commit luật và file (tự kiểm từng byte bằng git show). */
export const RULE_SHA = "78fc07e";
export const RULE_FILE = "test-ocr/chup-mat-do/may-chu-loc-do.mjs";
/** sha256 (hex) của khối luật ở commit RULE_SHA. */
export const RULE_SHA256 = "a4df1c16536a175ccef3083c5c52160b8981a9d45c05dfce25275c83bbb7aee5";

/**
 * Phán tự kiểm (thuần): khối luật hiện tại (now) và ở commit luật (old), worktree dirty.
 * Trả { exitCode: 0 | 3, lines }. Khối không tìm thấy / sha256 khác RULE_SHA256 / khác từng byte commit / dirty → 3.
 */
export function selfCheck({ now, old, dirty }) {
  const lines = [];
  if (typeof now !== "string") lines.push("Tự kiểm: không tìm thấy khối luật trong file hiện tại.");
  else if (sha256Of(now) !== RULE_SHA256) lines.push(`Tự kiểm: khối luật sha256 ${sha256Of(now)} ≠ RULE_SHA256 ${RULE_SHA256}.`);
  if (typeof old !== "string") lines.push(`Tự kiểm: không đọc được khối luật ở commit ${RULE_SHA}.`);
  else if (typeof now === "string" && now !== old) lines.push(`Tự kiểm: khối luật khác từng byte commit ${RULE_SHA}.`);
  if (dirty !== false) lines.push(`Tự kiểm: worktree ${dirty === null ? "không đọc được trạng thái git" : "KHÔNG sạch"}, không đo.`);
  return lines.length ? { exitCode: 3, lines } : { exitCode: 0, lines: ["Tự kiểm: khối luật trùng, worktree sạch."] };
}

// ---------------- phép chia lẻ / chẵn (luật vòng 0) ----------------
/**
 * items = [{ folder, file, code }] (nhan.json). Trong mỗi thư mục xếp MỌI file (kể cả code null) theo tên tăng dần (so
 * chuỗi), vị trí 1-based lẻ = "giu", chẵn = "chinh"; SAU khi chia mới bỏ code null. Trả [{ folder, file, code, pos, group }].
 */
export function splitHalves(items) {
  const out = [];
  const folders = [...new Set((items || []).map((x) => x.folder))];
  for (const f of folders) {
    const xs = items.filter((x) => x.folder === f).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    xs.forEach((x, i) => out.push({ ...x, pos: i + 1, group: (i + 1) % 2 === 1 ? "giu" : "chinh" }));
  }
  return out.filter((x) => x.code != null);
}

// ---------------- chiều cao khung chữ ----------------
/** Cạnh ngắn của tứ giác poly (trung bình 2 cạnh đối); poly không đủ 4 điểm → maxY − minY; không có poly → null. */
export function shortEdge(poly) {
  if (!Array.isArray(poly) || !poly.length) return null;
  if (poly.length !== 4) {
    const ys = poly.map((p) => p[1]);
    return Math.max(...ys) - Math.min(...ys);
  }
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (d(poly[0], poly[1]) + d(poly[2], poly[3])) / 2;
  const h = (d(poly[1], poly[2]) + d(poly[3], poly[0])) / 2;
  return Math.min(w, h);
}

function bbox(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Hàng như t1.rowLineInfo (ghép giống hệt groupRowBoxes của t1.mjs) KÈM khung của hàng:
 * [{ text, h, conf, boxes: [{ text, h: cạnh ngắn, conf }] }]. text / h / conf của hàng PHẢI trùng rowLineInfo (khung đo
 * kiểm mọi ca). Khung trong hàng theo minX như t1.
 */
export function rowsWithBoxes(items, minOverlap = 0.5) {
  const boxes = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.text === "string" && it.text.trim() !== "" && Array.isArray(it.poly) && it.poly.length)
    .map((it) => ({ ...bbox(it.poly), text: it.text.trim(), score: Number.isFinite(it.score) ? it.score : null, hBox: shortEdge(it.poly) }))
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  const rows = [];
  for (const b of boxes) {
    const row = rows[rows.length - 1];
    if (row) {
      const overlap = Math.min(b.maxY, row.maxY) - Math.max(b.minY, row.minY);
      const h = Math.min(b.maxY - b.minY, row.maxY - row.minY);
      if (h > 0 && overlap / h >= minOverlap) {
        row.boxes.push(b);
        row.minY = Math.min(row.minY, b.minY);
        row.maxY = Math.max(row.maxY, b.maxY);
        continue;
      }
    }
    rows.push({ minY: b.minY, maxY: b.maxY, boxes: [b] });
  }
  return rows.map((r) => {
    const bs = r.boxes.sort((a, b) => a.minX - b.minX);
    const scores = bs.map((b) => b.score).filter((s) => s != null);
    return {
      text: bs.map((b) => b.text).join(" "),
      h: Math.max(...bs.map((b) => b.maxY - b.minY)),
      conf: scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null,
      boxes: bs.map((b) => ({ text: b.text, h: b.hBox, conf: b.score })),
    };
  });
}

/** Khung của các hàng (thứ tự hàng rồi minX) thành "dòng" { text, h: cạnh ngắn, conf }; hàng không có khung → bỏ. */
export function boxLines(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((r) => (Array.isArray(r?.boxes) ? r.boxes : []))
    .filter((b) => Number.isFinite(b.h) && b.h > 0).map((b) => ({ text: b.text, h: b.h, conf: b.conf }));
}

/**
 * 10 ứng viên máy chủ theo cách m ({ a?, b?, c? }; {} = nền) trên chỉ mục rIC. rows = rowsWithBoxes (hoặc dòng câu gõ,
 * không có boxes). search thay t1.bm25Search (nhớ kết quả). Trả { query, hits, fellBack, dropped, lists, boxes }.
 * (b) / (c) dùng khung của hàng còn lại sau (a); không có khung nổi bật / không có trọng số → tìm như nền.
 */
export function serverRank(t1, rIC, rows, m, k = SERVER_K, search = t1.bm25Search) {
  const index = rIC.index;
  const vocab = index.idf;
  const alias = index.aliasDf;
  const f = filterRows(t1, Array.isArray(rows) ? rows : [], m?.a);
  const use = f.rows;
  const query = t1.t1QueryFromLines(use, vocab, alias);
  const base = { query, fellBack: f.fellBack, dropped: f.dropped, lists: 1, boxes: 0 };
  if (!query.length) return { ...base, hits: [] };
  const bl = boxLines(use);
  if (m?.c) {
    const w = rowWeights(t1, bl, vocab, alias, m.c.beta);
    if (!w.size) return { ...base, hits: search(index, query, k) };
    return { ...base, boxes: bl.length, hits: weightedSearch(index, query, w, k) };
  }
  if (m?.b) {
    const prom = prominentRows(t1, bl, m.b);
    if (!prom.length) return { ...base, hits: search(index, query, k) };
    const lists = [search(index, query, LIST_DEPTH)];
    for (const r of prom) {
      const q = t1.t1QueryFromLines([r], vocab, alias);
      if (q.length) lists.push(search(index, q, LIST_DEPTH));
    }
    const hits = rrfFuse(lists, k).map((x) => ({ code: index.tf[x.i].code, score: bm25DocScore(index, index.tf[x.i], query).score, i: x.i, rrf: x.s }));
    return { ...base, boxes: bl.length, hits, lists: lists.length };
  }
  return { ...base, hits: search(index, query, k) };
}

// ---------------- phán (đúng khối luật) ----------------
/** Mất vị trí 1 / rơi khỏi 5 (rows [{ id, base, got }]). */
export function lossRows(rows) {
  return {
    lostTop1: rows.filter((r) => r.base === 1 && r.got !== 1).map((r) => r.id),
    out5: rows.filter((r) => r.base != null && r.got == null).map((r) => r.id),
  };
}

/**
 * r = {
 *   ab: [{ id, cond, base, got }] (A + B, MÁY), real: [{ id, cond, base, got }] (22 ảnh có nhãn mã, MÁY),
 *   s7: { "may|i": vị trí, "may|ii", "go|i", "go|ii" }, buldak: { i: mã mục 1, ii }, salt: { "may|i": kind, "may|ii",
 *   "lui|i", "lui|ii" }, foreign: { base: { top1, top5 }, got: { top1, top5 } }, sMax, fallbackOk, srcSame, consts: {…: bool},
 *   offSame, luiSame, h3Est, h2Est }.
 * Trả { gates: { C1…C6 }, fails, pass }.
 */
export function judge(r) {
  const fails = [];
  const g = {};
  const ab = lossRows(r?.ab || []);
  g.C1 = Array.isArray(r?.ab) && r.ab.length > 0 && !ab.lostTop1.length && !ab.out5.length;
  if (!g.C1) fails.push(`C1 A+B: mất vị trí 1 [${ab.lostTop1.join(", ")}], rơi khỏi 5 [${ab.out5.join(", ")}]${r?.ab?.length ? "" : " (thiếu số)"}`);
  const re = lossRows(r?.real || []);
  g.C2 = Array.isArray(r?.real) && r.real.length > 0 && !re.lostTop1.length && !re.out5.length;
  if (!g.C2) fails.push(`C2 ảnh thật: mất vị trí 1 [${re.lostTop1.join(", ")}], rơi khỏi 5 [${re.out5.join(", ")}]${r?.real?.length ? "" : " (thiếu số)"}`);
  let c3 = true;
  for (const k of ["may|i", "may|ii", "go|i", "go|ii"]) if (r?.s7?.[k] !== 1) { c3 = false; fails.push(`C3 7Up ${k}: vị trí ${r?.s7?.[k] ?? "ngoài 5"}`); }
  for (const c of CONDS) if (r?.buldak?.[c] !== BULDAK_CODE) { c3 = false; fails.push(`C3 buldak ${c}: mục 1 ${r?.buldak?.[c] ?? "rỗng"}`); }
  for (const k of ["may|i", "may|ii", "lui|i", "lui|ii"]) if (r?.salt?.[k] !== "open") { c3 = false; fails.push(`C3 muối ${k}: ${r?.salt?.[k]}`); }
  const fb = r?.foreign?.base;
  const fg = r?.foreign?.got;
  if (!fb || !fg || fg.top1 < fb.top1 || fg.top5 < fb.top5) { c3 = false; fails.push(`C3 ngoại: ${JSON.stringify(fg)} < nền ${JSON.stringify(fb)}`); }
  g.C3 = c3;
  g.C4 = Number.isInteger(r?.sMax) && r.sMax <= SERVER_K && r?.fallbackOk === true;
  if (!g.C4) fails.push(`C4: S tối đa ${r?.sMax}, quay về mọi dòng ${r?.fallbackOk ? "đúng" : "SAI"}`);
  g.C5 = r?.srcSame === true && !!r?.consts && Object.values(r.consts).length > 0 && Object.values(r.consts).every((v) => v === true)
    && r?.offSame === true && r?.luiSame === true;
  if (!g.C5) fails.push(`C5: src ${r?.srcSame}, hằng số ${JSON.stringify(r?.consts)}, câu OFF ${r?.offSame}, LÙI ${r?.luiSame}`);
  g.C6 = Number.isFinite(r?.h3Est) && r.h3Est <= H3_MAX_MS && Number.isFinite(r?.h2Est) && r.h2Est <= H2_MAX_MIB;
  if (!g.C6) fails.push(`C6: H3 ước ${r?.h3Est} ms, H2 ước ${r?.h2Est} MiB`);
  return { gates: g, fails, pass: Object.values(g).every(Boolean) };
}

/**
 * Mục tiêu từ vị trí MÁY: t = [{ id, cond, pos }] (tập T: ruaypuan + thư mục 2 giữ riêng có nhãn), c = [{ id, cond, base,
 * pos }] (nhóm chỉnh thư mục 1 + 2 có nhãn) → { M1, M2, M3 } (M3 chỉ tính ô nền ≠ 1).
 */
export function targetOf(t, c) {
  const T = Array.isArray(t) ? t : [];
  const C = (Array.isArray(c) ? c : []).filter((x) => x.base !== 1);
  return { M1: T.filter((x) => x.pos != null).length, M2: T.filter((x) => x.pos === 1).length, M3: C.filter((x) => x.pos != null).length };
}

/** Chọn: list = [{ name, pass, t: { M1, M2, M3 } }] → { name | null, improves } (improves = M1 hơn M1 nền). */
export function pickMethod(list, base, order = METHOD_ORDER) {
  const ok = (list || []).filter((m) => m.pass && order.includes(m.name));
  ok.sort((a, b) => b.t.M1 - a.t.M1 || b.t.M2 - a.t.M2 || b.t.M3 - a.t.M3 || order.indexOf(a.name) - order.indexOf(b.name));
  const best = ok[0] ?? null;
  return { name: best?.name ?? null, improves: !!best && best.t.M1 > (base?.M1 ?? 0) };
}

/**
 * C4 (luật sửa ở 78fc07e): cách tham chiếu ở ca (a) quay về mọi dòng. Cách không có (b) / (c) (chỉ (a)) → null (so với
 * nền); cách (a)+(b) / (a)+(c) → tên DUY NHẤT trong grid không có (a) mà tham số (b) / (c) trùng hệt (so theo tham số,
 * không đoán theo tên); không có / nhiều hơn một → ném lỗi.
 */
export function fallbackRefOf(m, grid = methodGrid()) {
  if (!m?.a || (!m.b && !m.c)) return null;  const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const hit = Object.entries(grid).filter(([, g]) => !g.a && same(g.b, m.b) && same(g.c, m.c)).map(([n]) => n);
  if (hit.length !== 1) throw new Error(`C4: cách (b)/(c) tương ứng của ${JSON.stringify(m)} có ${hit.length} cách`);
  return hit[0];
}

/**
 * C4 phần quay về: res / ref = { khóa ca: { S, fellBack } } (ref = kết quả nền khi cách chỉ có (a), = kết quả cách (b) /
 * (c) tương ứng khi cách ghép). Mọi ca fellBack phải có S trùng ref cùng ca. found không đổi theo cách (khung đo tính
 * found một lần mỗi ca), nên luôn trùng nền theo cách dựng. Trả { ok, diff: [khóa ca] }.
 */
export function fallbackCheck(res, ref) {
  const diff = [];
  for (const [key, r] of Object.entries(res || {})) {
    if (!r?.fellBack) continue;
    if (JSON.stringify(r.S) !== JSON.stringify(ref?.[key]?.S)) diff.push(key);
  }
  return { ok: diff.length === 0, diff };
}

/** File ra: kiểm chéo (0)–(4) đạt → nen.json / do.json, thoát 0; lệch → nen.loi.json / do.loi.json, thoát 3. */
export function resultFile(outDir, runMethods, allOk) {
  const stem = runMethods ? "do" : "nen";
  return allOk ? { file: path.join(outDir, `${stem}.json`), exitCode: 0 } : { file: path.join(outDir, `${stem}.loi.json`), exitCode: 3 };
}

/** Số ảnh cần thêm loại thư mục 2 theo p: (1) ⌈5 / p⌉ (dấu một phía, 0 ảnh hỏng); (2) ⌈1,96² p(1−p) / 0,15²⌉. */
export function sampleSizes(p) {
  if (!(p > 0 && p <= 1)) return { p, sign: null, margin: null };
  return { p, sign: Math.ceil(SIGN_MIN_FIXED / p - 1e-9), margin: Math.ceil((Z95 * Z95 * p * (1 - p)) / (MARGIN * MARGIN) - 1e-9) };
}

// ---------------- chạy ----------------
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const onlyBase = argv.includes("--chi-nen");
  const runMethods = argv.includes("--do-cach");
  if ([onlyBase, runMethods].filter(Boolean).length !== 1) {
    console.error("Cần đúng một cờ: --chi-nen (chỉ nền) hoặc --do-cach (đo 89 cách theo luật chốt trước).");
    process.exit(2);
  }
  const outDir = arg("--out", "D:\\tmp\\may-chu-loc\\ket-qua");
  const gocFile = arg("--goc", "D:\\tmp\\may-chu-loc\\ket-qua-goc.json");
  const nhanFile = arg("--nhan", "D:\\tmp\\may-chu-loc\\nhan.json");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const ocrDir = arg("--ocr", "D:\\tmp\\dong-noi-bat\\ocr");
  const g2Dir = arg("--g2", "D:\\tmp\\g2-di-qua\\ket-qua-v4");
  const { loadApp, makeDiskFetch, ROOT, SETS, LINES_7UP, TYPED_7UP } = await import("./tu-dong-do.mjs");
  const { foreignCases, MO_RONG } = await import("./tu-dong-v42-do.mjs");
  const { ALL_CODES, SALT_LINES, saltItems } = await import("./nang-t1-do.mjs");
  const { readLevel, pickProbes } = await import("./kho-lon-do.mjs");
  const dmFile = arg("--danh-muc", path.join(ROOT, "server", "catalog", "c.jsonl.gz"));

  // ---- tự kiểm ----
  const startedAt = new Date().toISOString();
  const cp = await import("node:child_process");
  const git = (c) => { try { return cp.execSync(c, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString(); } catch { return null; } };
  const sha = git("git rev-parse HEAD")?.trim() ?? null;
  const porcelain = git("git status --porcelain");
  const dirty = porcelain === null ? null : porcelain.trim() !== "";
  const now = ruleBlockOf(fs.readFileSync(new URL(import.meta.url), "utf8"));
  const oldText = git(`git show ${RULE_SHA}:${RULE_FILE}`);
  const sc = selfCheck({ now, old: oldText === null ? null : ruleBlockOf(oldText), dirty });
  for (const l of sc.lines) (sc.exitCode ? console.error : console.log)(l);
  if (sc.exitCode) process.exit(sc.exitCode);
  const outFile = resultFile(outDir, runMethods, true).file;
  if (fs.existsSync(outFile) && !argv.includes("--ghi-de")) {
    console.error(`Đã có ${outFile}. Thêm --ghi-de nếu thật sự muốn ghi đè.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const srcSame = git(`git diff --quiet ${BASE_SHA} -- src server public package.json package-lock.json`) !== null;

  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const osx = app.os;
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, ...rel.split("/"))).href);
  const fm = await imp("src/front-merge.js");
  const fx = await imp("src/front-extra.js");
  const fp = await imp("src/front-photo.js");
  const fsv = await imp("src/front-server.js");
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const catalogCodes = new Set(products.map((p) => p.code));
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json"), "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);
  const ctx = { t1, rIndex, products };
  const consts = {
    confidenceNull: fr.CONFIDENCE_RULE.feature === null && fr.CONFIDENCE_RULE.threshold === null,
    strangeNull: osx.STRANGE_MODE === null,
    serverK: fsv.SERVER_MAX === SERVER_K,
    mergeOpts: JSON.stringify(fsv.SERVER_MERGE_OPTS) === JSON.stringify({ offPromote: { gap: 3, minWords: 3 }, serverIdf: true }),
    guard: fm.DEFAULT_GUARD.lockTop === 3 && fm.DEFAULT_GUARD.offMax === 1 && fm.DEFAULT_GUARD.offGap === 1
      && fm.DEFAULT_GUARD.offTopRule === null && fm.DEFAULT_GUARD.offPromote === null,
  };

  // ---- danh mục (c) ----
  const t0 = Date.now();
  const lv = readLevel(dmFile);
  const rIC = fr.buildRankIndex(t1, lv.rows);
  console.log(`Danh mục (c): ${lv.rows.length} sp, dựng ${Date.now() - t0} ms (${dmFile})`);

  // ---- ca ----
  const goc = JSON.parse(fs.readFileSync(gocFile, "utf8"));
  const nhan = JSON.parse(fs.readFileSync(nhanFile, "utf8"));
  const halves = splitHalves(nhan.items);
  const labelOf = new Map(nhan.items.map((x) => [`${x.folder}/${x.file}`, x]));
  const halfOf = new Map(halves.map((x) => [`${x.folder}/${x.file}`, x]));
  const cases = [
    { set: "7up", kind: "may", code: CODE_7UP_DIET, input: { items: saltItems(LINES_7UP, 0.95) } },
    { set: "7up", kind: "go", code: CODE_7UP_DIET, input: { text: TYPED_7UP } },
    { set: "muoi", kind: "muoi", code: null, input: { items: saltItems(SALT_LINES, 0.9) } },
  ];
  const shots = {};
  for (const [name, code] of [["ruaypuan", RUAYPUAN_CODE], ["buldak", BULDAK_CODE]]) {
    const f = path.join(ocrDir, `${name}.json`);
    const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
    shots[name] = j;
    cases.push({ set: name, kind: "man-hinh", code, input: j?.items ? { items: j.items } : null });
  }
  for (const s of ["B", "A"]) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const code of ALL_CODES) {
      const items = bundle.items?.[code]?.items ?? null;
      cases.push({ set: s, kind: "anh", code, input: items ? { items } : null });
      if (items) cases.push({ set: `tong-${s}`, kind: "tong-hop", code, input: { items: injectJunk(items) } });
    }
  }
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), catalogCodes, osx.strangeWords, idf);
  for (const f of foreign) cases.push({ set: "ngoai", kind: "ngoai", code: f.code, input: { items: saltItems(f.lines, 0.95) } });
  const probes = pickProbes(lv.rows, { tokens: t1.bm25Tokens });
  for (const p of probes) cases.push({ set: "do", kind: `do-${p.grp}`, code: p.code, input: { items: saltItems(p.lines, 0.95) } });
  goc.items.forEach((it, n) => {
    const lab = labelOf.get(`${it.folder}/${it.file}`);
    if (!lab) throw new Error(`thiếu nhãn cho ảnh thật số ${n + 1}`);
    const half = halfOf.get(`${it.folder}/${it.file}`) ?? null;
    const code = lab.code && lab.code !== "none" ? lab.code : null;
    cases.push({ set: "that", kind: `that-${n + 1}`, code, label: lab.code ?? null, preset: lab.preset === true, folder: it.folder, group: half?.group ?? null, goc: it, input: { items: it.items } });
  });
  const keys = new Set(cases.map(keyOf));
  if (keys.size !== cases.length) throw new Error(`khóa ca trùng: ${cases.length - keys.size}`);

  // ---- found, câu OFF, OFF (i)(ii), hàng có khung ----
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1e9 });
  let rowMismatch = 0;
  for (const c of cases) {
    if (!c.input) { c.rows = null; c.found = null; c.queries = []; continue; }
    c.found = c.input.items ? fr.rankFromItems(t1, rIndex, c.input.items, FOUND_K) : fr.rankFromText(t1, rIndex, c.input.text, FOUND_K);
    if (c.input.items) {
      c.rows = rowsWithBoxes(t1.ocrItems([{ items: c.input.items }]));
      const ref = t1.rowLineInfo(t1.ocrItems([{ items: c.input.items }]));
      if (JSON.stringify(ref) !== JSON.stringify(c.rows.map(({ text, h, conf }) => ({ text, h, conf })))) rowMismatch++;
    } else c.rows = rowsOf(t1, c.input);
    c.queries = osx.cleanQuery(c.found.lines, { idf });
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.off = { i: c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" }, ii: fm.joinOffResults(per) };
    c.allOk = per.every((p) => p.ok === true);
  }
  if (rowMismatch) { console.error(`rowsWithBoxes lệch t1.rowLineInfo ở ${rowMismatch} ca`); process.exit(3); }

  const memo = new Map();
  const searchC = (index, q, k) => {
    const key = `${k}|${q.join(" ")}`;
    if (!memo.has(key)) memo.set(key, t1.bm25Search(index, q, k));
    return memo.get(key);
  };
  const toS = (res) => fsv.serverCandidates({
    candidates: (res?.hits || []).map((h) => {
      const r = lv.rows[h.i];
      const v = (x) => (x == null ? "" : x);
      return { code: v(r.code), name: v(r.name), brand: v(r.brand), img: v(r.img), text: v(r.text), grp: v(r.grp), score: h.score };
    }),
  });
  const codesOf = (list) => list.map((x) => x.code);
  const sameArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** Chạy một cách (S theo m; found / OFF / LÙI giữ) trên mọi ca. */
  const runMethod = (m) => {
    const out = {};
    for (const c of cases) {
      const key = keyOf(c);
      if (!c.found) { out[key] = { none: true, S: [], sRaw: 0, query: [], may: { i: [], ii: [] }, lui: { i: [], ii: [] }, shown: { i: [], ii: [] }, kind: {}, fellBack: false }; continue; }
      const sRes = serverRank(t1, rIC, c.rows, m, SERVER_K, searchC);
      const S = toS(sRes);
      const called = c.queries.length > 0;
      const r = { S: codesOf(S), sRaw: sRes.hits.length, query: sRes.query, fellBack: sRes.fellBack, dropped: sRes.dropped, lists: sRes.lists, may: {}, lui: {}, kind: {}, shown: {} };
      for (const cond of CONDS) {
        const mm = S.length ? fsv.serverMerge(ctx, c.found, c.off[cond], S, { called }).merged : fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called }).merged;
        const ml = fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called }).merged;
        r.may[cond] = codesOf(mm);
        r.lui[cond] = codesOf(ml);
        const om = fp.photoOutcome(mm);
        r.kind[`may|${cond}`] = om.kind;
        r.kind[`lui|${cond}`] = fp.photoOutcome(ml).kind;
        r.shown[cond] = om.kind === "open" ? [om.top, ...om.others].map((x) => x.code) : [];
      }
      out[key] = r;
    }
    return out;
  };

  // ---- H3 (Node): thời gian tạo S trên 30 ảnh bộ B, không nhớ ----
  const h3Node = (m) => {
    const ms = [];
    for (const c of cases.filter((x) => x.set === "B" && x.rows)) {
      const t = process.hrtime.bigint();
      serverRank(t1, rIC, c.rows, m, SERVER_K);
      ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    return p95(ms);
  };
  for (let w = 0; w < 2; w++) h3Node({});
  const h3Base = h3Node({});

  const base = runMethod({});
  const posOf = (res, c, p, cond, n = MERGE_K) => (c.code ? rankIn(res[keyOf(c)][p][cond], c.code, n) : null);

  // ---- kiểm chéo ----
  // (0) S nền của khung đo (serverRank {}) = rankFromItems / rankFromText trên (c) (k 10)
  let sDiff0 = 0;
  for (const c of cases) {
    if (!c.found) continue;
    const ref = c.input.items ? fr.rankFromItems(t1, rIC, c.input.items, SERVER_K) : fr.rankFromText(t1, rIC, c.input.text, SERVER_K);
    if (!sameArr(ref.hits.map((h) => h.code), base[keyOf(c)].S) || !sameArr(ref.query, base[keyOf(c)].query)) sDiff0++;
  }
  // (1) 22 ảnh thật: câu tìm + 10 ứng viên Node = Python; app top 5 + món tự mở = ket-qua-goc (OFF (ii) = cache)
  const real = cases.filter((c) => c.set === "that");
  const check1 = { n: real.length, query: 0, S: 0, top5: 0, autoOpen: 0, kind: 0, diff: [] };
  for (const c of real) {
    const r = base[keyOf(c)];
    const g = c.goc;
    if (sameArr(r.query, g.serverQuery)) check1.query++; else check1.diff.push(`${c.kind} câu`);
    if (sameArr(r.S, g.candidates.map((x) => x.code))) check1.S++; else check1.diff.push(`${c.kind} S`);
    if (sameArr(r.shown.ii, g.app.top5.map((x) => x.code))) check1.top5++; else check1.diff.push(`${c.kind} top5`);
    const auto = r.kind["may|ii"] === "open" ? r.shown.ii[0] : null;
    if ((g.app.autoOpen?.code ?? null) === auto) check1.autoOpen++; else check1.diff.push(`${c.kind} tự mở`);
    if (g.app.kind === r.kind["may|ii"]) check1.kind++; else check1.diff.push(`${c.kind} kind`);
  }
  check1.ok = real.length === 22 && check1.query === 22 && check1.S === 22 && check1.top5 === 22 && check1.autoOpen === 22 && check1.kind === 22;
  // (2) A / B MÁY nền = app (serverMerge c-idf) của g2-di-qua vòng 4: nen.json perCase (G2) + nenDiff của kiem-app.json
  //     (các ô app khác G2; kiem-app.json không giữ perCase, nên dựng lại từng ô từ 2 file); LÙI = lui của nen.json.
  const check2 = { file: g2Dir, cells: 0, may: 0, lui: 0, diff: [], note: "kiem-app.json không có perCase: ô app = nenDiff.list (nếu có) hoặc nen.json perCase.may" };
  const g2Nen = fs.existsSync(path.join(g2Dir, "nen.json")) ? JSON.parse(fs.readFileSync(path.join(g2Dir, "nen.json"), "utf8")) : null;
  const g2App = fs.existsSync(path.join(g2Dir, "kiem-app.json")) ? JSON.parse(fs.readFileSync(path.join(g2Dir, "kiem-app.json"), "utf8")) : null;
  if (g2Nen && g2App) {
    const over = new Map((g2App.nenDiff?.list || []).map((d) => [`${d.set}|${d.code}|${d.cond}`, d.app]));
    for (const c of cases.filter((x) => x.set === "A" || x.set === "B")) for (const cond of CONDS) {
      check2.cells++;
      const saved = g2Nen.perCase?.[keyOf(c)];
      const want = over.get(`${c.set}|${c.code}|${cond}`) ?? saved?.may?.[cond] ?? null;
      if (sameArr(want, base[keyOf(c)].may[cond])) check2.may++; else check2.diff.push(`${keyOf(c)}|${cond} MÁY`);
      if (sameArr(saved?.lui?.[cond] ?? null, base[keyOf(c)].lui[cond])) check2.lui++; else check2.diff.push(`${keyOf(c)}|${cond} LÙI`);
    }
  }
  check2.ok = check2.cells === 120 && check2.may === 120 && check2.lui === 120 && g2App?.ok === true;
  // (3) ruaypuan / buldak: S Node = candidates Python đã lưu; buldak MÁY vị trí 1
  const ru = cases.find((c) => c.set === "ruaypuan");
  const bu = cases.find((c) => c.set === "buldak");
  const check3 = {
    ruaypuan: Array.isArray(shots.ruaypuan?.candidates) && sameArr(shots.ruaypuan.candidates.map((x) => x.code), base[keyOf(ru)].S),
    buldak: Array.isArray(shots.buldak?.candidates) && sameArr(shots.buldak.candidates.map((x) => x.code), base[keyOf(bu)].S),
    buldakTop1: Object.fromEntries(CONDS.map((cond) => [cond, base[keyOf(bu)].may[cond][0] ?? null])),
  };
  check3.ok = check3.ruaypuan && check3.buldak && CONDS.every((cond) => check3.buldakTop1[cond] === BULDAK_CODE);
  // (4) LÙI giống hệt photoMerge của src (gọi lại độc lập, cả mục)
  const check4 = { cells: 0, same: 0, diff: [] };
  for (const c of cases) {
    if (!c.found) continue;
    for (const cond of CONDS) {
      check4.cells++;
      const a = fx.photoMerge({ t1, rIndex, products, xi }, c.found, c.off[cond], { called: c.queries.length > 0 }).merged;
      if (sameArr(codesOf(a), base[keyOf(c)].lui[cond])) check4.same++; else check4.diff.push(`${keyOf(c)}|${cond}`);
    }
  }
  check4.ok = check4.cells > 0 && check4.same === check4.cells;
  const checks = { "0": { ok: sDiff0 === 0, diff: sDiff0 }, "1": check1, "2": check2, "3": check3, "4": check4 };
  const allOk = Object.values(checks).every((x) => x.ok);

  // ---- bảng nền ----
  const groups = {
    A: (c) => c.set === "A", B: (c) => c.set === "B",
    "that1-chinh": (c) => c.set === "that" && c.folder === "1-ra-dung" && c.group === "chinh" && c.code,
    "that1-giu": (c) => c.set === "that" && c.folder === "1-ra-dung" && c.group === "giu" && c.code,
    "that2-chinh (chỉ để tham khảo, n ≤ 2)": (c) => c.set === "that" && c.folder === "2-ma-vach-ra" && c.group === "chinh" && c.code,
    "that2-giu (chỉ để tham khảo, n ≤ 2)": (c) => c.set === "that" && c.folder === "2-ma-vach-ra" && c.group === "giu" && c.code,
    "7up": (c) => c.set === "7up", buldak: (c) => c.set === "buldak", ruaypuan: (c) => c.set === "ruaypuan",
    ngoai: (c) => c.set === "ngoai", "tong-B (chỉ báo)": (c) => c.set === "tong-B", "tong-A (chỉ báo)": (c) => c.set === "tong-A",
    "do (chỉ báo)": (c) => c.set === "do",
  };
  const tableOf = (res) => Object.fromEntries(Object.entries(groups).map(([name, fn]) => {
    const rs = cases.filter(fn);
    const row = { n: rs.length, in10: rs.filter((c) => c.code && rankIn(res[keyOf(c)].S, c.code, SERVER_K) != null).length };
    for (const cond of CONDS) row[cond] = { top1: rs.filter((c) => posOf(res, c, "may", cond) === 1).length, top5: rs.filter((c) => posOf(res, c, "may", cond) != null).length };
    return [name, row];
  }));
  const none3 = (res) => Object.fromEntries(cases.filter((c) => c.set === "that" && c.label === "none").map((c) => [c.kind, { thuMuc: c.folder, nhom: c.group, ...Object.fromEntries(CONDS.map((cond) => [cond, res[keyOf(c)].kind[`may|${cond}`]])) }]));
  const salt = cases.find((c) => c.set === "muoi");
  const tSet = cases.filter((c) => c.set === "ruaypuan" || (c.set === "that" && c.folder === "2-ma-vach-ra" && c.group === "giu" && c.code));
  const cSet = cases.filter((c) => c.set === "that" && (c.folder === "1-ra-dung" || c.folder === "2-ma-vach-ra") && c.group === "chinh" && c.code);
  const targetFor = (res) => targetOf(
    tSet.flatMap((c) => CONDS.map((cond) => ({ id: keyOf(c), cond, pos: posOf(res, c, "may", cond) }))),
    cSet.flatMap((c) => CONDS.map((cond) => ({ id: keyOf(c), cond, base: posOf(base, c, "may", cond), pos: posOf(res, c, "may", cond) }))),
  );
  const baseTarget = targetFor(base);
  const realBase = Object.fromEntries(real.map((c) => [c.kind, {
    thuMuc: c.folder, nhom: c.group, nhan: c.label === "none" ? "none" : c.code ? "mã" : "null", preset: c.preset,
    sRank: c.code ? rankIn(base[keyOf(c)].S, c.code, SERVER_K) : null,
    ...Object.fromEntries(CONDS.map((cond) => [cond, { pos: posOf(base, c, "may", cond), kind: base[keyOf(c)].kind[`may|${cond}`] }])),
  }]));
  const splitCount = {};
  for (const f of FOLDERS) splitCount[f] = { giu: halves.filter((x) => x.folder === f && x.group === "giu").length, chinh: halves.filter((x) => x.folder === f && x.group === "chinh").length };
  const coverage = Object.fromEntries(["B", "A", "that", "7up", "muoi", "ruaypuan", "buldak", "ngoai"].map((s) => {
    const rs = cases.filter((c) => c.set === s);
    return [s, { n: rs.length, coCau: rs.filter((c) => c.queries.length).length, duCau: rs.filter((c) => c.queries.length && c.allOk).length }];
  }));
  const out = {
    at: new Date().toISOString(), startedAt, mode: runMethods ? "do-cach" : "chi-nen", sha, dirty, srcSame, baseSha: BASE_SHA,
    ruleSha: RULE_SHA, ruleSha256: RULE_SHA256, consts, cacheOnly: true, offNetCalls: disk.stats.calls, azureCalls: 0, ocrRerun: false,
    catalogFile: dmFile, catalogN: lv.rows.length, probesN: probes.length, splitCount, coverage, checks, allOk,
    baseTable: tableOf(base), baseTarget, realBase, noneKinds: none3(base),
    salt: base[keyOf(salt)].kind, h3: { baseNodeP95: h3Base },
    perCase: Object.fromEntries(cases.map((c) => [keyOf(c), { S: base[keyOf(c)].S, may: base[keyOf(c)].may, lui: base[keyOf(c)].lui, queries: c.queries }])),
    offStats: disk.stats,
  };

  const f = (v) => (v == null ? "-" : v);
  console.log(`sha ${sha} dirty ${dirty}; src/server/public trùng ${BASE_SHA}: ${srcSame}; hằng số ${JSON.stringify(consts)}`);
  console.log(`Chia nửa (có nhãn sau khi bỏ null): ${JSON.stringify(splitCount)}`);
  console.log(`Độ phủ OFF (đủ câu / có câu / số ca): ${Object.entries(coverage).map(([s, v]) => `${s} ${v.duCau}/${v.coCau}/${v.n}`).join(" | ")}`);
  console.log(`Kiểm chéo (0) ${checks["0"].ok ? "ĐẠT" : "LỆCH"}: S nền khung đo = rankFrom* trên (c), lệch ${sDiff0} ca`);
  console.log(`Kiểm chéo (1) ${check1.ok ? "ĐẠT" : "LỆCH"}: 22 ảnh thật câu ${check1.query}/22, S ${check1.S}/22, top5 ${check1.top5}/22, tự mở ${check1.autoOpen}/22, kind ${check1.kind}/22 ${check1.diff.slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (2) ${check2.ok ? "ĐẠT" : "LỆCH"}: A/B MÁY = app g2-di-qua v4 ${check2.may}/${check2.cells}, LÙI ${check2.lui}/${check2.cells} ${check2.diff.slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (3) ${check3.ok ? "ĐẠT" : "LỆCH"}: S = candidates Python ruaypuan ${check3.ruaypuan}, buldak ${check3.buldak}; buldak MÁY mục 1 ${JSON.stringify(check3.buldakTop1)}`);
  console.log(`Kiểm chéo (4) ${check4.ok ? "ĐẠT" : "LỆCH"}: LÙI = photoMerge src ${check4.same}/${check4.cells}`);
  console.log("NỀN (MÁY; vị trí 1 / trong 5 theo (i) | (ii); trong 10 ứng viên):");
  for (const [k, v] of Object.entries(out.baseTable)) console.log(`  ${k.padEnd(40)} n ${v.n}: (i) ${v.i.top1}/${v.i.top5} | (ii) ${v.ii.top1}/${v.ii.top5} | trong 10 ${v.in10}`);
  console.log(`  muối kind ${JSON.stringify(out.salt)}; ảnh none kind ${JSON.stringify(out.noneKinds)}`);
  console.log(`  ruaypuan S hạng ${f(rankIn(base[keyOf(ru)].S, RUAYPUAN_CODE, SERVER_K))}; mục tiêu nền ${JSON.stringify(baseTarget)} (T ${tSet.length} ca, nhóm chỉnh ${cSet.length} ca); H3 Node nền p95 ${h3Base?.toFixed(2)} ms`);
  if (!allOk) {
    const bad = resultFile(outDir, runMethods, false);
    fs.writeFileSync(bad.file, JSON.stringify(out, null, 1), "utf8");
    console.error(`KIỂM CHÉO LỆCH: dừng báo, không đo cách. Ghi ${bad.file} (không ghi ${outFile}).`);
    process.exit(bad.exitCode);
  }

  if (runMethods) {
    const l = srcSame;
    const baseForeign = { top1: 0, top5: 0 };
    const foreignOf = (res) => {
      const t = { top1: 0, top5: 0 };
      for (const c of cases.filter((x) => x.set === "ngoai")) for (const cond of CONDS) {
        const p = posOf(res, c, "may", cond);
        if (p === 1) t.top1++;
        if (p != null) t.top5++;
      }
      return t;
    };
    Object.assign(baseForeign, foreignOf(base));
    const methods = {};
    const grid = methodGrid();
    const plain = {}; // kết quả các cách không có (a) (c-*, b-*), chạy trước cách ghép theo thứ tự grid: tham chiếu C4
    for (const [name, m] of Object.entries(grid)) {
      const res = runMethod(m);
      if (!m.a) plain[name] = res;
      const refName = fallbackRefOf(m, grid);
      if (refName && !plain[refName]) throw new Error(`C4: chưa có kết quả cách ${refName} cho ${name}`);
      const fb = fallbackCheck(res, refName ? plain[refName] : base);
      const ab = [];
      const realRows = [];
      for (const c of cases) for (const cond of CONDS) {
        if (c.set === "A" || c.set === "B") ab.push({ id: `${keyOf(c)}|${cond}`, cond, base: posOf(base, c, "may", cond), got: posOf(res, c, "may", cond) });
        if (c.set === "that" && c.code) realRows.push({ id: `${c.kind}|${cond}`, cond, base: posOf(base, c, "may", cond), got: posOf(res, c, "may", cond) });
      }
      const s7 = {};
      for (const c of cases.filter((x) => x.set === "7up")) for (const cond of CONDS) s7[`${c.kind}|${cond}`] = posOf(res, c, "may", cond);
      const buldak = Object.fromEntries(CONDS.map((cond) => [cond, res[keyOf(bu)].may[cond][0] ?? null]));
      let sMax = 0;
      const fallbackOk = fb.ok;
      // offSame / luiSame: kiểm chắc chắn qua theo cách dựng (found, câu OFF và LÙI không phụ thuộc cách); giữ để bắt
      // lỗi code khung đo.
      let offSame = true;
      let luiSame = true;
      for (const c of cases) {
        const r = res[keyOf(c)];
        const b = base[keyOf(c)];
        if (r.none) continue;
        sMax = Math.max(sMax, r.S.length, r.sRaw);
        if (!sameArr(osx.cleanQuery(c.found.lines, { idf }), c.queries)) offSame = false;
        for (const cond of CONDS) if (!sameArr(r.lui[cond], b.lui[cond])) luiSame = false;
      }
      const h3n = h3Node(m);
      const h3Est = +(H3_PY_BASE_MS * (h3n / h3Base)).toFixed(1);
      const verdict = judge({ ab, real: realRows, s7, buldak, salt: res[keyOf(salt)].kind, foreign: { base: baseForeign, got: foreignOf(res) }, sMax, fallbackOk, srcSame: l, consts, offSame, luiSame, h3Est, h2Est: H2_EST_MIB });
      const nFell = Object.values(res).filter((x) => x.fellBack).length;
      methods[name] = { table: tableOf(res), t: targetFor(res), verdict, h3Est, noneKinds: none3(res), c4: { ref: refName ?? "nền", fellBack: nFell, diff: fb.diff } };
      process.stdout.write(".");
    }
    console.log("");
    const pick = pickMethod(Object.entries(methods).map(([name, v]) => ({ name, pass: v.verdict.pass, t: v.t })), baseTarget);
    const conclusion = !pick.name ? "KHÔNG CÁCH NÀO ĐẠT (không cách nào qua cổng): không giữ gì"
      : pick.improves ? `CHỌN ${pick.name} (qua cổng, ${JSON.stringify(methods[pick.name].t)} hơn nền ${JSON.stringify(baseTarget)})`
        : `KHÔNG CÁCH NÀO ĐẠT: cách qua cổng tốt nhất ${pick.name} có M1 ${methods[pick.name].t.M1} không hơn nền ${baseTarget.M1}; không giữ gì`;
    Object.assign(out, { methods, pick, conclusion, sampleSizes: P_TABLE.map(sampleSizes), offStats: disk.stats, offNetCalls: disk.stats.calls });
    for (const [name, v] of Object.entries(methods)) console.log(`${name.padEnd(22)} ${JSON.stringify(v.t)} H3 ${v.h3Est} | ${v.verdict.pass ? "QUA" : "TRƯỢT " + Object.entries(v.verdict.gates).filter(([, ok]) => !ok).map(([g]) => g).join(",")}`);
    const all = Object.entries(methods);
    const gateFails = Object.fromEntries(["C1", "C2", "C3", "C4", "C5", "C6"].map((g) => [g, all.filter(([, v]) => !v.verdict.gates[g]).length]));
    const c4Combo = all.filter(([n, v]) => !v.verdict.gates.C4 && grid[n].a && (grid[n].b || grid[n].c)).length;
    out.summary = { pass: all.filter(([, v]) => v.verdict.pass).length, total: all.length, gateFails, c4ComboFails: c4Combo };
    console.log(`Qua mọi cổng: ${out.summary.pass}/${out.summary.total}; trượt theo cổng ${JSON.stringify(gateFails)}; C4 trượt ở cách ghép: ${c4Combo}`);
    console.log(`== Kết luận: ${conclusion}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  console.log(`OFF: ${JSON.stringify(disk.stats)}; Ghi: ${outFile}`);
}
