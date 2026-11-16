// Đợt g2-di-qua vòng 1: KHUNG ĐO "cho ứng viên máy chủ khớp 0 từ với danh mục 1.452 đi qua G2" (Việc để sau (i) của
// dong-noi-bat). CHỈ đo trong Node, KHÔNG sửa src/ server/ public/: các cách cài trong file này, chỉ đổi phần gộp của
// ĐƯỜNG MÁY CHỦ (serverMerge); đường lùi (photoMerge + kho phụ 893) và "Tìm lại" không đổi.
// Gọi đúng hàm src/: serverMerge / serverCandidates (front-server.js), photoMerge / buildExtraIndex / joinExtra
// (front-extra.js), mergeFront / bm25DocScore / offDoc / joinOffResults (front-merge.js), photoOutcome (front-photo.js),
// cleanQuery / createOffSearch / strangeWords (off-search.js), rankFromItems / rankFromText (front-rank.js).
// OFF CHỈ đọc cache đĩa (0 lượt OFF thật), 0 lượt Azure, không chạy lại OCR (bộ A / B, ruaypuan, buldak).
//
//   node --max-old-space-size=6144 test-ocr/chup-mat-do/g2-di-qua-do.mjs (--chi-nen | --do-cach) [--out <thư mục>] [--cache <thư mục>]
//        [--ocr <thư mục>] [--danh-muc <c.jsonl.gz>] [--kho-lon <json>] [--dong-noi-bat <json>] [--mo-rong <json>] [--ghi-de]
//   --chi-nen       chỉ nền + kiểm chéo (1)–(4) → <out>/nen.json.
//   --do-cach       nền + kiểm chéo, rồi đo MỌI cách theo luật → <out>/do.json (cần <out>/nen.json). Trước khi đo tự kiểm:
//                   khối luật so từng byte với commit 1d56860 (git show), worktree sạch, mục tiêu nền MÁY = BASE_TARGET;
//                   lệch / thiếu git → thoát mã 3. Phải có đúng một trong hai cờ (không cờ → thoát mã 2).
//   --out           thư mục ra (mặc định D:\tmp\g2-di-qua\ket-qua). --cache: cache OFF đĩa (D:\tmp\tu-dong\cache-off).
//   --ocr           chữ OCR 2 ảnh chụp màn hình (D:\tmp\dong-noi-bat\ocr). --danh-muc: danh mục (c) (server/catalog/c.jsonl.gz).
//   --kho-lon       file từng ca kho-lon v2 (kiểm chéo 3). --dong-noi-bat: v1-nen.json của dong-noi-bat (kiểm chéo 2).
//   --mo-rong       bản mở rộng OFF dựng 6 ca ngoại (MO_RONG của tu-dong-v42-do.mjs). --ghi-de: cho ghi đè file ra đã có.
//
// Vòng 1 P2: chỉ có NỀN (cờ --chi-nen) + kiểm chéo (1)–(4). P3: khối luật dưới. P4: các cách (cờ --do-cach).
// Vòng 2: sửa code cho đúng luật (ngoài khối luật): c-srv / c-idf chấm mục máy chủ trùng mã OFF theo bản máy chủ,
// passThrough của các cách dùng tài liệu như mergeFront (S' chữ OFF khi trùng mã); tự kiểm trước khi đo; in none → open.
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC — commit riêng "test(g2-di-qua): luật đo chốt trước", SAU khi đo nền (P2, chưa có cách nào; nền ghi ở
// PLAN.md mục 8) và TRƯỚC mọi lần chạy một cách trên ca thật. Viết lúc 2026-11-16 08:36 +0700 (giờ commit thật ghi ở
// PLAN.md mục 8, đợt g2-di-qua). Không sửa khối này sau khi thấy số của bất kỳ cách nào; buộc phải sửa thì ghi
// "LỆCH LUẬT" ở PLAN.md và dừng báo.
// ===================================================================================================================
// Nền = mã ở b588ed8 (không cách nào): MÁY = serverMerge (G2-g3-w3) của src/front-server.js; LÙI = photoMerge + kho
//   phụ 893 của src/front-extra.js. Ca, ứng viên máy chủ S (chỉ mục JS mức (c), SERVER_K 10, qua serverCandidates),
//   câu OFF (cleanQuery của dòng T1), OFF (i) lỗi / (ii) cache đĩa: như phần nền của khung đo này (P2).
// Mọi cách CHỈ đổi đường MÁY; found (T1 1.452), câu OFF, OFF, S giữ như nền; LÙI luôn gọi photoMerge của src/.
// Định nghĩa:
//   g2 = serverMerge(…).merged của ca / điều kiện đó (nền MÁY).
//   "Đi qua được" = mục của S khớp 0 từ với chỉ mục 1.452 (bm25DocScore(chỉ mục 1.452, tài liệu, found.query).matched
//     === 0; tài liệu = tài liệu danh mục nếu mã có trong 1.452, còn lại offDoc(text) — đúng tài liệu mergeFront dùng);
//     G2 bỏ những mục này. PT = danh sách mục đi qua được theo thứ tự S (passThrough). Mục chèn: mã trong 1.452 →
//     mục danh mục (source "catalog"); còn lại → mục OFF (source "off", không có cờ extra); điểm 0.
//   rawMatched(mục) = số từ khác nhau của found.query có trong tài liệu của mục (kể cả từ ngoài từ vựng 1.452).
//   Chèn sau phần khóa (insertAfterLock(g2, ins)): giữ LOCK_TOP (3) mục đầu của g2; rồi các mục ins (thứ tự S, bỏ mã đã
//     có), rồi phần còn lại của g2; mục source "off" tối đa OFF_MAX (1) tính cả phần giữ; mục vượt (cả mục ins lẫn mục
//     OFF của g2) chuyển sang "phần thừa", chỉ lấp chỗ TRỐNG sau cùng theo thứ tự gặp (mục ins trước, rồi đuôi g2); cắt 5.
//     Nhiều mục cùng tranh 1 chỗ offMax: mục đứng trước trong S thắng. ins rỗng → g2 nguyên vẹn.
// Lưới cách (chỉnh so với đề xuất của điều phối, lý do ghi kèm):
//   a-lap : S[0] ∈ PT và g2 < 5 mục → g2 + [S[0]] (lấp chỗ trống, không xét offMax: như phần thừa của lớp chặn); còn lại g2.
//   a-off : S[0] ∈ PT → insertAfterLock(g2, [S[0]]) (= g3Merge của kho-lon-do.mjs với một mục máy chủ); còn lại g2.
//   a-top : S[0] ∈ PT và rawMatched(S[0]) ≥ 1 → [S[0], …phần còn lại] với phần còn lại = g2 bỏ S[0], giữ thứ tự, mục
//           "off" tối đa OFF_MAX − (S[0] là mục "off" ? 1 : 0), mục vượt chỉ lấp chỗ trống, cắt 4 (như offPromote của
//           mergeFront); S[0] ∈ PT nhưng rawMatched 0 → như a-off (chỉnh: đề xuất không nói nhánh này; chọn a-off để
//           a-top chỉ khác a-off ở ca có từ khớp); còn lại g2.
//   b2 / b3: ins = mục PT có vị trí trong S < 2 / < 3 (thứ tự S) → insertAfterLock(g2, ins) (chung 1 chỗ offMax, xem trên).
//   c-srv : G2 bản sao g2Local với điểm mục máy chủ NGOÀI danh mục 1.452 = ref × (score máy chủ / score S[0]) (ref = điểm
//           gợi ý 1 của T1, 0 nếu không có; score S[0] ≤ 0 → 0); matched = max(1, số từ khớp 1.452) (không mục nào bị bỏ
//           vì khớp 0 từ); còn lại như G2 (offGap 1, lockTop 3, offMax 1, offPromote gap 3 / minWords 3 — mục máy chủ
//           có điểm ≤ ref nên không bao giờ được đẩy; hòa: điểm trừ offGap giảm dần, hàng VN trước, T1 trước OFF, thứ
//           tự vào). Mục máy chủ CÓ trong 1.452 chấm như G2. Chỉnh: nhân ref (đề xuất chỉ ghi "score / score S[0]")
//           vì điểm chuẩn hóa ∈ [0, 1] còn điểm T1 BM25 cỡ 5–30, không nhân thì mọi mục máy chủ luôn đứng sau mọi mục
//           danh mục và cách này trùng một dạng a-off.
//   c-idf : g2Local với điểm mục máy chủ NGOÀI 1.452 = BM25 trên chính text ứng viên (offDoc) với found.query; từ không
//           có trong từ vựng 1.452 dùng idf = idf lớn nhất của 1.452; k1, b, độ dài trung bình của chỉ mục 1.452;
//           matched = số từ khác nhau khớp theo cách này; còn lại như G2 (bỏ mục matched 0, offGap 1, offMax 1, lockTop 3,
//           offPromote gap 3 / minWords 3 với điểm / matched mới; hòa như G2). Mục máy chủ CÓ trong 1.452 chấm như G2.
//   G3    : mergeByMethod(…, "G3") của kho-lon-do.mjs (CHỈ để so, không được chọn).
// Cổng (từng ô; "nền" = nền của CHÍNH đường đó, cùng ca, cùng điều kiện, tính trong cùng lần chạy):
//   L1a MÁY, bộ A + B, (i) + (ii): so vị trí mã đúng với nền MÁY: 0 ảnh mất vị trí 1, 0 ảnh rơi khỏi 5 (lossOf).
//   L1b LÙI: danh sách 5 mã GIỐNG HỆT nền LÙI ở MỌI ca (mọi bộ), MỌI điều kiện.
//   L2  7Up Diet 8934588752117 ở vị trí 1 ở 4 ô MÁY (chữ máy (i)(ii), câu gõ (i)(ii)), mỗi ca đo riêng (khóa có kind);
//       (nền: 1 ở cả 4 ô). LÙI: theo L1b.
//   L3  buldak.jpg: 8801073250574 ở vị trí 1 ở MÁY (i) và (ii) (nền: có).
//   L4  muối Co.op: photoOutcome kind "open" ở cả 4 ô (MÁY / LÙI × (i)(ii)) và CONFIDENCE_RULE vẫn
//       { feature: null, threshold: null } (luôn không chắc → luôn có khung "có thể nhầm"); mục 1 chỉ ghi tham khảo.
//   L5  6 ca ngoại, MÁY, từng ô (6 ca × (i)(ii)): nền vị trí 1 → vẫn vị trí 1; nền trong 5 → vẫn trong 5 (so nền MÁY).
//   L6  Câu tìm OFF (cleanQuery) và 10 ứng viên S (mã, theo thứ tự) của MỌI ca, tính lại khi chạy cách, TRÙNG nền từng ca
//       (so mảng thật, với nền cùng lần chạy và với perCase của nen.json).
//   L7  Không đổi danh mục / kho phụ / dependency / server / src: `git diff --quiet b588ed8 -- src server public
//       package.json package-lock.json`; lúc chạy: CONFIDENCE_RULE null, STRANGE_MODE null, SERVER_MAX = SERVER_K = 10,
//       SERVER_MERGE_OPTS và DEFAULT_GUARD như nền.
// Mục tiêu (chỉ xét cách qua MỌI cổng, trừ G3), thứ tự ưu tiên (lớn hơn trước):
//   (1) số ô ngoại MÁY trong 5 (12 ô = 6 ca × (i)(ii)); (2) số ô ngoại MÁY vị trí 1; (3) ruaypuan.jpg 8852052150101 MÁY
//   (số ô vị trí 1, rồi số ô trong 5, trên (i)(ii)); hòa → cách đơn giản hơn: a-lap < a-off < a-top < b2 < b3 < c-srv <
//   c-idf. Cách được chọn mà KHÔNG hơn nền ở ít nhất một trong (1), (2), (3) (nền: 4 / 12, 0 / 12, (0, 0)) → không
//   giữ gì ("không cách nào cải thiện").
// Chỉ báo (không là cổng, không dùng để chọn): 70 ca dò (MÁY vị trí 1 / trong 5); "ruaypuan giả định" (S = ứng viên
//   a-c80+c-2 của dong-noi-bat-do.mjs, máy chủ thật không trả như vậy); bộ A / B: số ô đổi vị trí trong 5, số ô đổi mục 1,
//   số ô kind "none" → "open" (ảnh đúng mã không có trong 5 mà nay mở một sản phẩm khác).
// Cảnh báo: 6 ca ngoại và 70 ca dò dựng từ chính chữ danh mục (c) (tên + hãng) nên các cách chấm bằng text ứng viên (c-*)
//   và mọi cách cho S[0] đi qua được lợi sẵn (S[0] đúng mã ở cả 6 ca ngoại); ở nền ruaypuan KHÔNG có trong 10 ứng viên
//   (hạng 44) nên (3) gần như chắc = (0, 0) với mọi cách; chỉ 2 ảnh chụp màn hình thật (ruaypuan, buldak).
// ===================================================================================================================
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bm25DocScore, offDoc } from "../../src/front-merge.js";
import { joinExtra } from "../../src/front-extra.js";
import { frontImageUrl } from "../../src/front-search.js";

// ---------------- hằng số ----------------
export const SERVER_K = 10;
export const MERGE_K = 5;
export const LOCK_TOP = 3;
export const OFF_MAX = 1;
export const OFF_GAP = 1;
/** offPromote của G2-g3-w3 (SERVER_MERGE_OPTS của src/front-server.js). */
export const PROMOTE = Object.freeze({ gap: 3, minWords: 3 });
export const BASE_SHA = "b588ed8";
export const CODE_7UP_DIET = "8934588752117";
export const RUAYPUAN_CODE = "8852052150101";
export const BULDAK_CODE = "8801073250574";
export const SALT_CODE = "8934673218368";
/** 6 ca hàng ngoại dựng (như kho-lon-do.mjs, foreignCases của tu-dong-v42-do.mjs). */
export const FOREIGN_CODES = Object.freeze(["8930000721020", "8930017095664", "8930053151010", "8930070035980", "8930080005003", "8930279103831"]);
export const CONDS = Object.freeze(["i", "ii"]);
export const PATHS = Object.freeze(["may", "lui"]);

/** Khóa ca (có kind, như kho-lon-do.mjs và keyOf đã sửa của dong-noi-bat-do.mjs). */
export function keyOf(c) {
  return `${c.set}|${c.code ?? c.kind}|${c.kind}`;
}

/** Vị trí (1–n) của mã trong danh sách mã, không có → null. */
export function rankIn(codes, code, n = MERGE_K) {
  const i = (codes || []).slice(0, n).indexOf(code);
  return i < 0 ? null : i + 1;
}

// ---------------- G2 bản sao trong khung đo (để các cách c-* đổi được điểm mục máy chủ) ----------------
// g2Local(…) với serverScore = null PHẢI trùng serverMerge(…).merged của src/ từng ca (kiểm chéo (1), test + lúc chạy).
// Chép đúng nhánh f1 của mergeFront với SERVER_MERGE_OPTS: lockTop 3, offMax 1, offGap 1, minMatch 1, offTopRule null,
// offPromote { gap 3, minWords 3 }, strangeFill false (STRANGE_MODE null).

function catalogItem(p, score = null) {
  return { code: p.code, name: String(p.name ?? ""), brand: String(p.brand ?? ""), img: frontImageUrl(p.code, p.img), source: "catalog", vn: true, score };
}

function offItem(h, score = null) {
  const it = { code: h.code, name: String(h.name ?? ""), brand: String(h.brand ?? ""), img: String(h.img ?? ""), source: "off", vn: h.vn === true, score };
  if (h.extra === true) it.extra = true;
  return it;
}

function t1Items(products, t1Result, k) {
  const out = [];
  for (const h of t1Result?.hits || []) {
    const p = products[h?.i];
    if (!p || p.code !== h.code) continue;
    out.push(catalogItem(p, Number.isFinite(h.score) ? h.score : null));
    if (out.length >= k) break;
  }
  return out;
}

/** Lớp chặn (bản sao applyGuard của front-merge.js). */
export function applyGuard(ranked, base, { k = MERGE_K, lockTop = LOCK_TOP, offMax = OFF_MAX } = {}) {
  const lock = base.slice(0, Math.min(lockTop, base.length));
  const out = [...lock];
  const have = new Set(lock.map((x) => x.code));
  const spare = [];
  let offs = 0;
  for (const it of ranked) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    if (it.source === "off" && offs >= offMax) { spare.push(it); continue; }
    if (it.source === "off") offs++;
    have.add(it.code);
    out.push(it);
  }
  for (const it of spare) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    have.add(it.code);
    out.push(it);
  }
  return out.slice(0, k);
}

/** Đánh dấu như serverMerge: mục OFF có mã KHÔNG trong S mang extra; S bỏ extra; joinExtra(OFF, S). */
export function joinServer(off, S) {
  const server = Array.isArray(S) ? S : [];
  const sCodes = new Set(server.map((h) => h.code));
  const offMarked = off && off.ok === true && Array.isArray(off.hits)
    ? { ...off, hits: off.hits.map((h) => { const { extra, ...rest } = h; return sCodes.has(h.code) ? rest : { ...rest, extra: true }; }) }
    : off;
  return { joined: joinExtra(offMarked, server.map(({ extra, ...h }) => h)), sCodes };
}

/**
 * G2 bản sao. ctx = { t1, rIndex, products }; serverScore (tùy chọn) = (h, { doc, index, query, ref, m1452 }) →
 * { score, matched } thay điểm / số từ khớp của mục máy chủ KHÔNG có trong danh mục (mã trong S); null = như G2.
 * Trả ≤ 5 mục (dạng mergeFront).
 */
export function g2Local({ t1, rIndex, products }, found, off, S, { serverScore = null } = {}) {
  const { joined, sCodes } = joinServer(off, S);
  const list = Array.isArray(products) ? products : [];
  const k = MERGE_K;
  const base = t1Items(list, found, k);
  if (!(joined && joined.ok === true && Array.isArray(joined.hits) && joined.hits.length)) return base;
  const index = rIndex.index;
  const byCode = new Map();
  list.forEach((p, i) => { if (p && typeof p.code === "string" && !byCode.has(p.code)) byCode.set(p.code, i); });
  const offs = [];
  const seenOff = new Set();
  for (const h of joined.hits) {
    if (!h || typeof h.code !== "string" || seenOff.has(h.code)) continue;
    seenOff.add(h.code);
    offs.push(byCode.has(h.code) ? { inCatalog: true, i: byCode.get(h.code), h } : { inCatalog: false, h });
  }
  const query = Array.isArray(found?.query) ? found.query : [];
  const cands = new Map();
  let order = 0;
  for (const it of base) cands.set(it.code, { item: it, score: it.score ?? 0, rankScore: it.score ?? 0, tier: 0, vn: true, src: 0, order: order++ });
  const ref = base.length ? (cands.get(base[0].code)?.score ?? 0) : 0;
  for (const o of offs) {
    if (o.inCatalog) {
      const p = list[o.i];
      if (cands.has(p.code)) continue;
      const doc = index.tf[o.i];
      const { score, matched } = doc && doc.code === p.code ? bm25DocScore(index, doc, query) : { score: 0, matched: 0 };
      if (matched < 1) continue;
      cands.set(p.code, { item: catalogItem(p, score), score, rankScore: score, tier: 0, vn: true, src: 0, order: order++ });
    } else {
      if (cands.has(o.h.code)) continue;
      const extra = o.h.extra === true;
      const doc = offDoc(t1, o.h.text || `${o.h.name ?? ""} ${o.h.brand ?? ""}`);
      let { score, matched } = bm25DocScore(index, doc, query);
      if (serverScore && sCodes.has(o.h.code)) ({ score, matched } = serverScore(o.h, { doc, index, query, ref, m1452: matched }));
      if (matched < 1) continue;
      cands.set(o.h.code, { item: offItem(o.h, score), score, rankScore: score - OFF_GAP, tier: 0, vn: o.h.vn === true, src: 1, order: order++, matched, extra });
    }
  }
  const sorted = [...cands.values()]
    .sort((a, b) => a.tier - b.tier || b.rankScore - a.rankScore || (b.vn - a.vn) || a.src - b.src || a.order - b.order);
  const toItem = (x) => ({ ...x.item, score: x.score });
  let best = null;
  for (const c of sorted) if (c.src === 1 && !c.extra && c.matched >= PROMOTE.minWords && (!best || c.score > best.score)) best = c;
  if (best && best.score >= ref + PROMOTE.gap) {
    const rest = applyGuard(sorted.filter((c) => c !== best).map(toItem), base, { k: k - 1, lockTop: LOCK_TOP, offMax: OFF_MAX - 1 });
    return [toItem(best), ...rest].slice(0, k);
  }
  return applyGuard(sorted.map(toItem), base, { k, lockTop: LOCK_TOP, offMax: OFF_MAX });
}

/**
 * Mục máy chủ "đi qua" được: mục của S khớp 0 từ với chỉ mục 1.452 (bm25DocScore(…).matched === 0, cùng tài liệu
 * mergeFront dùng: mã trong danh mục → tài liệu danh mục, còn lại offDoc(text)) — G2 bỏ những mục này.
 * Trả [{ h, j (vị trí trong S, 0-), item (dạng mục hiển thị, score 0), inCatalog, rawMatched (số từ khác nhau của câu tìm
 * T1 có trong tài liệu, kể cả từ ngoài từ vựng 1.452) }] theo thứ tự S.
 */
export function passThrough({ t1, rIndex, products }, found, S) {
  const list = Array.isArray(products) ? products : [];
  const index = rIndex.index;
  const query = Array.isArray(found?.query) ? found.query : [];
  const byCode = new Map();
  list.forEach((p, i) => { if (p && typeof p.code === "string" && !byCode.has(p.code)) byCode.set(p.code, i); });
  const out = [];
  (Array.isArray(S) ? S : []).forEach((h, j) => {
    if (!h || typeof h.code !== "string") return;
    const ci = byCode.get(h.code);
    const inCatalog = ci !== undefined;
    const doc = inCatalog ? index.tf[ci] : offDoc(t1, h.text || `${h.name ?? ""} ${h.brand ?? ""}`);
    if (!doc) return;
    const { matched } = bm25DocScore(index, doc, query);
    if (matched !== 0) return;
    const rawMatched = new Set(query.filter((w) => doc.m.has(w))).size;
    const item = inCatalog ? catalogItem(list[ci], 0) : offItem({ ...h, extra: undefined }, 0);
    out.push({ h, j, item, inCatalog, rawMatched });
  });
  return out;
}

// ---------------- khối luật: tên cách, phán, chọn ----------------
/** Cách được chọn, theo thứ tự ưu tiên khi hòa (đơn giản trước). */
export const METHOD_ORDER = Object.freeze(["a-lap", "a-off", "a-top", "b2", "b3", "c-srv", "c-idf"]);
/** Mọi cách được đo (G3 chỉ để so, không được chọn). */
export const METHOD_NAMES = Object.freeze([...METHOD_ORDER, "G3"]);
/** Nền ở mục tiêu (ghi ở PLAN.md, nền P2): ô ngoại MÁY trong 5 / vị trí 1, ruaypuan MÁY (vị trí 1, trong 5). */
export const BASE_TARGET = Object.freeze({ f5: 4, f1: 0, ru1: 0, ru5: 0 });

/**
 * Phán một cách. r = {
 *   loss: { "B|i": { lostTop1: [mã], out5: [mã] }, … "A|ii" } (MÁY so nền MÁY),
 *   luiDiff: [khóa ca|đk] (ô LÙI khác nền LÙI), s7: { "may|i": vị trí | null, "may|ii", "go|i", "go|ii" } (MÁY),
 *   buldak: { i: mã mục 1 | null, ii }, salt: { "may|i": kind, "may|ii", "lui|i", "lui|ii" }, confidenceNull: bool,
 *   foreign: { [mã]: { i: { base, got }, ii: { base, got } } } (vị trí MÁY, null = ngoài 5),
 *   qsDiff: [khóa ca] (câu OFF hoặc S khác nền), l7: bool }.
 * Trả { gates: { L1a … L7 }: bool, fails: [câu], pass }.
 */
export function judge(r) {
  const fails = [];
  const g = {};
  let ok = true;
  for (const s of ["B", "A"]) for (const c of CONDS) {
    const l = r?.loss?.[`${s}|${c}`];
    if (!l) { ok = false; fails.push(`L1a ${s}-${c}: thiếu số`); continue; }
    for (const code of l.lostTop1 || []) { ok = false; fails.push(`L1a ${s}-${c}: mất vị trí 1 ${code}`); }
    for (const code of l.out5 || []) { ok = false; fails.push(`L1a ${s}-${c}: rơi khỏi 5 ${code}`); }
  }
  g.L1a = ok;
  g.L1b = Array.isArray(r?.luiDiff) && r.luiDiff.length === 0;
  if (!g.L1b) fails.push(`L1b LÙI khác nền: ${Array.isArray(r?.luiDiff) ? r.luiDiff.slice(0, 5).join(", ") : "thiếu số"}`);
  g.L2 = true;
  for (const k of ["may|i", "may|ii", "go|i", "go|ii"]) {
    if (r?.s7?.[k] !== 1) { g.L2 = false; fails.push(`L2 7Up ${k}: vị trí ${r?.s7?.[k] ?? "ngoài 5"}`); }
  }
  g.L3 = true;
  for (const c of CONDS) if (r?.buldak?.[c] !== BULDAK_CODE) { g.L3 = false; fails.push(`L3 buldak ${c}: mục 1 ${r?.buldak?.[c] ?? "rỗng"}`); }
  g.L4 = r?.confidenceNull === true;
  if (!g.L4) fails.push("L4: CONFIDENCE_RULE đã đổi");
  for (const k of ["may|i", "may|ii", "lui|i", "lui|ii"]) {
    if (r?.salt?.[k] !== "open") { g.L4 = false; fails.push(`L4 muối ${k}: kind ${r?.salt?.[k]}`); }
  }
  g.L5 = true;
  for (const code of FOREIGN_CODES) for (const c of CONDS) {
    const v = r?.foreign?.[code]?.[c];
    if (!v) { g.L5 = false; fails.push(`L5 ${code} ${c}: thiếu số`); continue; }
    if (v.base === 1 && v.got !== 1) { g.L5 = false; fails.push(`L5 ${code} ${c}: mất vị trí 1`); }
    if (v.base != null && v.got == null) { g.L5 = false; fails.push(`L5 ${code} ${c}: rơi khỏi 5`); }
  }
  g.L6 = Array.isArray(r?.qsDiff) && r.qsDiff.length === 0;
  if (!g.L6) fails.push(`L6 câu OFF / ứng viên khác nền: ${Array.isArray(r?.qsDiff) ? r.qsDiff.slice(0, 5).join(", ") : "thiếu số"}`);
  g.L7 = r?.l7 === true;
  if (!g.L7) fails.push("L7: src / server / public / dependency hoặc hằng số đã đổi");
  return { gates: g, fails, pass: Object.values(g).every(Boolean) };
}

/** Mục tiêu từ vị trí MÁY: foreign { [mã]: { i, ii } }, ru { i, ii } → { f5, f1, ru1, ru5 }. */
export function targetOf(foreign, ru) {
  const f = Object.values(foreign || {}).flatMap((v) => CONDS.map((c) => v?.[c] ?? null));
  const r = CONDS.map((c) => ru?.[c] ?? null);
  return { f5: f.filter((x) => x != null).length, f1: f.filter((x) => x === 1).length, ru1: r.filter((x) => x === 1).length, ru5: r.filter((x) => x != null).length };
}

/** Hơn nền ở ít nhất một trong (1) f5, (2) f1, (3) ru (vị trí 1, rồi trong 5). */
export function improvesOver(t, base = BASE_TARGET) {
  return t.f5 > base.f5 || t.f1 > base.f1 || t.ru1 > base.ru1 || t.ru5 > base.ru5;
}

/**
 * Chọn: list = [{ name, pass, t: { f5, f1, ru1, ru5 } }] → { name | null, improves }. Chỉ cách trong METHOD_ORDER và
 * qua mọi cổng; xếp f5, f1, ru1, ru5 giảm dần, hòa → METHOD_ORDER. Không hơn nền → improves false (không giữ gì).
 */
export function pickMethod(list, base = BASE_TARGET) {
  const ok = (list || []).filter((m) => m.pass && METHOD_ORDER.includes(m.name));
  ok.sort((a, b) => b.t.f5 - a.t.f5 || b.t.f1 - a.t.f1 || b.t.ru1 - a.t.ru1 || b.t.ru5 - a.t.ru5 || METHOD_ORDER.indexOf(a.name) - METHOD_ORDER.indexOf(b.name));
  const best = ok[0] ?? null;
  return { name: best?.name ?? null, improves: !!best && improvesOver(best.t, base) };
}
// ===================================================================================================================
// HẾT KHỐI LUẬT
// ===================================================================================================================

// Vòng 2: 2 dòng import của các cách (c384282 đặt nhầm trong khối luật, ngay sau các import cũ) dời ra đây để khối
// luật trùng từng byte commit 1d56860; import ES được nâng lên đầu module nên chạy không đổi.
import { serverMerge } from "../../src/front-server.js";
import { mergeByMethod } from "./kho-lon-do.mjs";

// ---------------- tự kiểm khối luật (vòng 2) ----------------
/** Commit luật và đường dẫn file (so từng byte khối luật trước khi đo các cách). */
export const RULE_SHA = "1d56860";
export const RULE_FILE = "test-ocr/chup-mat-do/g2-di-qua-do.mjs";

/**
 * Khối luật của một bản file: từ ĐẦU dòng có dấu mở (lần gặp đầu tiên) đến HẾT dòng có dấu đóng (lần gặp đầu tiên sau
 * dấu mở), kể cả ký tự xuống dòng. Không có một trong hai dấu → null. Dấu ghép từ mảnh để chính hàm này (nằm sau khối)
 * không chứa nguyên văn hai dấu.
 */
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

// ---------------- các cách (P4, viết SAU commit luật; cài đúng định nghĩa trong khối luật) ----------------
/**
 * Chèn sau phần khóa: giữ lockTop mục đầu của base, rồi ins (bỏ mã đã có), rồi base[lockTop..]; mục source "off" tối đa
 * offMax (tính cả phần giữ); mục vượt → phần thừa, chỉ lấp chỗ trống theo thứ tự gặp; cắt k. ins rỗng → base nguyên vẹn.
 */
export function insertAfterLock(base, ins, { k = MERGE_K, lockTop = LOCK_TOP, offMax = OFF_MAX } = {}) {
  const list = Array.isArray(base) ? base : [];
  const add = (Array.isArray(ins) ? ins : []).filter((x) => x && !list.some((b) => b.code === x.code));
  if (!add.length) return list;
  const lock = list.slice(0, lockTop);
  const out = [...lock];
  const have = new Set(lock.map((x) => x.code));
  let offs = lock.filter((x) => x.source === "off").length;
  const spare = [];
  for (const it of [...add, ...list.slice(lockTop)]) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    if (it.source === "off" && offs >= offMax) { spare.push(it); continue; }
    if (it.source === "off") offs++;
    have.add(it.code);
    out.push(it);
  }
  for (const it of spare) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    have.add(it.code);
    out.push(it);
  }
  return out.slice(0, k);
}

/** Giữ thứ tự list, mục "off" tối đa offMax, mục vượt chỉ lấp chỗ trống; cắt k. */
export function capList(list, { k, offMax }) {
  const out = [];
  const spare = [];
  let offs = 0;
  for (const it of Array.isArray(list) ? list : []) {
    if (out.length >= k) break;
    if (it.source === "off" && offs >= offMax) { spare.push(it); continue; }
    if (it.source === "off") offs++;
    out.push(it);
  }
  for (const it of spare) { if (out.length >= k) break; out.push(it); }
  return out.slice(0, k);
}

/**
 * Điểm c-idf cho mục máy chủ: BM25 trên tài liệu của mục, từ ngoài từ vựng dùng idf lớn nhất của chỉ mục.
 * Vòng 2 (NÊN SỬA 1 của reviewer vòng 1): có t1 + S thì tài liệu = offDoc(t1, chữ của BẢN S cùng mã) (S không có text →
 * name + brand như g2Local), bỏ qua doc truyền vào — g2Local truyền bản OFF khi mã có ở cả OFF và S (joinExtra xếp OFF
 * trước), còn luật ghi "BM25 trên chính text ứng viên". Không có t1 / S hoặc mã không có trong S → dùng doc truyền vào.
 */
export function idfScorer(index, t1 = null, S = null) {
  let maxIdf = 0;
  for (const v of index.idf.values()) if (v > maxIdf) maxIdf = v;
  const sByCode = new Map();
  for (const h of Array.isArray(S) ? S : []) if (h && typeof h.code === "string" && !sByCode.has(h.code)) sByCode.set(h.code, h);
  return (h, { doc: docIn, query }) => {
    const s = t1 ? sByCode.get(h?.code) : undefined;
    const doc = s ? offDoc(t1, s.text || `${s.name ?? ""} ${s.brand ?? ""}`) : docIn;
    let score = 0;
    let matched = 0;
    for (const w of new Set(query || [])) {
      const f = doc.m.get(w);
      if (!f) continue;
      const known = index.idf.get(w);
      const idf = known === undefined ? maxIdf : known;
      if (!idf) continue;
      matched++;
      score += idf * (f * (index.k1 + 1)) / (f + index.k1 * (1 - index.b + index.b * (doc.len / (index.avgdl || 1))));
    }
    return { score, matched };
  };
}

/**
 * Điểm c-srv: ref × score / score S[0] (score S[0] ≤ 0 hoặc không số → 0); matched = max(1, số từ khớp 1.452).
 * Vòng 2 (NÊN SỬA 1): score tra THEO MÃ trong S (Map mã → score), không lấy từ mục truyền vào — khi mã có ở cả OFF và S,
 * g2Local truyền bản OFF (không có score). Mã không có trong S / score không phải số → 0.
 */
export function srvScorer(S) {
  const list = Array.isArray(S) ? S : [];
  const s0 = list.length && Number.isFinite(list[0]?.score) ? list[0].score : 0;
  const byCode = new Map();
  for (const h of list) if (h && typeof h.code === "string" && !byCode.has(h.code)) byCode.set(h.code, h.score);
  return (h, { ref, m1452 }) => {
    const sc = byCode.get(h?.code);
    return { score: s0 > 0 && Number.isFinite(sc) ? ref * (sc / s0) : 0, matched: Math.max(1, m1452) };
  };
}

/**
 * S' cho passThrough (vòng 2, NÊN SỬA 1): mục S có mã trùng một mục OFF (off.ok, off.hits; lấy mục OFF đầu tiên cùng
 * mã) thì text / name / brand lấy theo bản OFF — luật ghi "đúng tài liệu mergeFront dùng", mà mergeFront dùng bản OFF
 * khi trùng mã (joinExtra xếp OFF trước). Giữ thứ tự / vị trí j theo S; các trường khác giữ của S.
 */
export function sWithOffText(S, off) {
  const list = Array.isArray(S) ? S : [];
  if (!(off && off.ok === true && Array.isArray(off.hits) && off.hits.length)) return list;
  const offBy = new Map();
  for (const h of off.hits) if (h && typeof h.code === "string" && !offBy.has(h.code)) offBy.set(h.code, h);
  return list.map((h) => {
    const o = h && offBy.get(h.code);
    return o ? { ...h, text: o.text, name: o.name, brand: o.brand } : h;
  });
}

/**
 * Gộp MÁY theo cách name (METHOD_NAMES). ctx = { t1, rIndex, products, catalogCodes? }; g2 (tùy chọn) = serverMerge(…)
 * .merged đã tính (không truyền thì tính bằng serverMerge của src/). found null → [].
 */
export function methodMerge(name, ctx, found, off, S, { g2 = null, called } = {}) {
  if (!METHOD_NAMES.includes(name)) throw new Error(`g2-di-qua: cách không có: ${name}`);
  if (!found) return [];
  const base = g2 ?? serverMerge(ctx, found, off, S, { called }).merged;
  if (name === "c-srv") return g2Local(ctx, found, off, S, { serverScore: srvScorer(S) });
  if (name === "c-idf") return g2Local(ctx, found, off, S, { serverScore: idfScorer(ctx.rIndex.index, ctx.t1, S) });
  if (name === "G3") {
    const catalogCodes = ctx.catalogCodes instanceof Set ? ctx.catalogCodes : new Set((ctx.products || []).map((p) => p.code));
    return mergeByMethod({ t1: ctx.t1, rIndex: ctx.rIndex, products: ctx.products, found, off, S, method: "G3", catalogCodes });
  }
  const pt = passThrough(ctx, found, sWithOffText(S, off));
  const p0 = pt.find((x) => x.j === 0) ?? null;
  if (name === "a-lap") return p0 && base.length < MERGE_K && !base.some((x) => x.code === p0.item.code) ? [...base, p0.item] : base;
  if (name === "a-off") return p0 ? insertAfterLock(base, [p0.item]) : base;
  if (name === "a-top") {
    if (!p0) return base;
    if (p0.rawMatched < 1) return insertAfterLock(base, [p0.item]);
    const rest = capList(base.filter((x) => x.code !== p0.item.code), { k: MERGE_K - 1, offMax: OFF_MAX - (p0.item.source === "off" ? 1 : 0) });
    return [p0.item, ...rest];
  }
  const n = name === "b2" ? 2 : 3;
  return insertAfterLock(base, pt.filter((x) => x.j < n).map((x) => x.item));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  // --chi-nen: chỉ nền + kiểm chéo → nen.json. --do-cach: nền + kiểm chéo, rồi đo MỌI cách theo luật → do.json (cần
  // nen.json để so L6). Phải có đúng một cờ (không cờ → không chạy gì, tránh lỡ đo cách).
  const onlyBase = argv.includes("--chi-nen");
  const runMethods = argv.includes("--do-cach");
  if (onlyBase === runMethods) {
    console.error("Cần đúng một cờ: --chi-nen (chỉ nền) hoặc --do-cach (đo các cách theo luật chốt trước).");
    process.exit(2);
  }
  const outDir = arg("--out", "D:\\tmp\\g2-di-qua\\ket-qua");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const ocrDir = arg("--ocr", "D:\\tmp\\dong-noi-bat\\ocr");
  const khoLonCase = arg("--kho-lon", "D:\\tmp\\kho-lon\\ket-qua\\v2-tung-ca-abc.json");
  const dnbNen = arg("--dong-noi-bat", "D:\\tmp\\dong-noi-bat\\ket-qua\\v1-nen.json");
  const { loadApp, makeDiskFetch, ROOT, SETS, LINES_7UP, TYPED_7UP } = await import("./tu-dong-do.mjs");
  const { foreignCases, MO_RONG } = await import("./tu-dong-v42-do.mjs");
  const { ALL_CODES, SALT_LINES, saltItems } = await import("./nang-t1-do.mjs");
  const { readLevel, pickProbes } = await import("./kho-lon-do.mjs");
  const dnb = await import("./dong-noi-bat-do.mjs");
  const dmFile = arg("--danh-muc", path.join(ROOT, "server", "catalog", "c.jsonl.gz"));
  // ---- vòng 2: tự kiểm TRƯỚC khi đo (--do-cach): khối luật trùng từng byte commit luật; worktree sạch ----
  const startedAt = new Date().toISOString();
  const cp = await import("node:child_process");
  const git = (c) => { try { return cp.execSync(c, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); } catch { return null; } };
  const sha = git("git rev-parse HEAD");
  const porcelain = git("git status --porcelain");
  const dirty = porcelain === null ? null : porcelain !== "";
  let ruleCheck = null;
  if (runMethods) {
    let now = null;
    let old = null;
    try { now = ruleBlockOf(fs.readFileSync(new URL(import.meta.url), "utf8")); } catch (e) { console.error(`Tự kiểm: không đọc được file khung đo: ${e.message}`); process.exit(3); }
    try {
      old = ruleBlockOf(cp.execSync(`git show ${RULE_SHA}:${RULE_FILE}`, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString("utf8"));
    } catch (e) { console.error(`Tự kiểm: không đọc được khối luật ở commit ${RULE_SHA} (thiếu git?): ${e.message}`); process.exit(3); }
    if (!now || !old) { console.error(`Tự kiểm: không tìm thấy khối luật (file hiện tại ${!!now}, commit ${RULE_SHA} ${!!old}).`); process.exit(3); }
    if (now !== old) {
      const a = now.split("\n");
      const b = old.split("\n");
      let k = 0;
      while (k < Math.min(a.length, b.length) && a[k] === b[k]) k++;
      console.error(`Tự kiểm: KHỐI LUẬT ĐÃ ĐỔI so với ${RULE_SHA} (dòng ${k + 1} của khối):\n  ${RULE_SHA}: ${JSON.stringify(b[k] ?? "(hết)")}\n  hiện tại: ${JSON.stringify(a[k] ?? "(hết)")}`);
      process.exit(3);
    }
    ruleCheck = { sha: RULE_SHA, same: true, bytes: Buffer.byteLength(now, "utf8"), lines: now.split("\n").length - 1 };
    if (!sha || dirty === null) { console.error("Tự kiểm: không đọc được sha / trạng thái git."); process.exit(3); }
    if (dirty) { console.error(`Tự kiểm: worktree KHÔNG sạch (dirty), không đo:\n${porcelain}`); process.exit(3); }
    console.log(`Tự kiểm: khối luật trùng từng byte ${RULE_SHA} (${ruleCheck.bytes} B, ${ruleCheck.lines} dòng); sha ${sha} dirty ${dirty}; bắt đầu ${startedAt}`);
  }
  const nenFile = path.join(outDir, "nen.json");
  const outFile = runMethods ? path.join(outDir, "do.json") : nenFile;
  const nenSaved = runMethods ? (fs.existsSync(nenFile) ? JSON.parse(fs.readFileSync(nenFile, "utf8")) : null) : null;
  if (runMethods && !nenSaved) {
    console.error(`--do-cach cần ${nenFile} (chạy --chi-nen trước).`);
    process.exit(2);
  }
  if (fs.existsSync(outFile) && !argv.includes("--ghi-de")) {
    console.error(`Đã có ${outFile}. Thêm --ghi-de nếu thật sự muốn ghi đè.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let srcSame = false;
  try { cp.execSync(`git diff --quiet ${BASE_SHA} -- src server public package.json package-lock.json`, { cwd: ROOT }); srcSame = true; } catch { srcSame = false; }

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
    strangeNull: osx.STRANGE_MODE === null, serverK: fsv.SERVER_MAX === SERVER_K,
    mergeOpts: JSON.stringify(fsv.SERVER_MERGE_OPTS) === JSON.stringify({ offPromote: PROMOTE }),
    guard: fm.DEFAULT_GUARD.lockTop === LOCK_TOP && fm.DEFAULT_GUARD.offMax === OFF_MAX && fm.DEFAULT_GUARD.offGap === OFF_GAP,
  };

  // ---- danh mục (c) ----
  const t0 = Date.now();
  const lv = readLevel(dmFile);
  const rIC = fr.buildRankIndex(t1, lv.rows);
  console.log(`Danh mục (c): ${lv.rows.length} sp, dựng ${Date.now() - t0} ms (${dmFile})`);

  // ---- ca ----
  const cases = [
    { set: "7up", kind: "may", code: CODE_7UP_DIET, input: { items: saltItems(LINES_7UP, 0.95) } },
    { set: "7up", kind: "go", code: CODE_7UP_DIET, input: { text: TYPED_7UP } },
    { set: "muoi", kind: "muoi", code: null, input: { items: saltItems(SALT_LINES, 0.9) } },
  ];
  const shots = {};
  for (const [name, code] of [["ruaypuan", RUAYPUAN_CODE], ["buldak", null]]) {
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
    }
  }
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), catalogCodes, osx.strangeWords, idf);
  for (const f of foreign) cases.push({ set: "ngoai", kind: "ngoai", code: f.code, input: { items: saltItems(f.lines, 0.95) } });
  const probes = pickProbes(lv.rows, { tokens: t1.bm25Tokens });
  for (const p of probes) cases.push({ set: "do", kind: `do-${p.grp}`, grp: p.grp, code: p.code, input: { items: saltItems(p.lines, 0.95) } });
  const keys = new Set(cases.map(keyOf));
  if (keys.size !== cases.length) throw new Error(`khóa ca trùng: ${cases.length - keys.size}`);

  // ---- found (T1 1.452), câu OFF, OFF (i)/(ii), S (10 ứng viên trên (c)) ----
  const rank = (ri, input, k) => (!input ? null : input.items ? fr.rankFromItems(t1, ri, input.items, k) : fr.rankFromText(t1, ri, input.text, k));
  const toS = (res) => fsv.serverCandidates({
    candidates: (res?.hits || []).map((h) => {
      const r = lv.rows[h.i];
      const v = (x) => (x == null ? "" : x);
      return { code: v(r.code), name: v(r.name), brand: v(r.brand), img: v(r.img), text: v(r.text), grp: v(r.grp), score: h.score };
    }),
  });
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1e9 });
  for (const c of cases) {
    c.found = rank(rIndex, c.input, MERGE_K);
    c.queries = c.found ? osx.cleanQuery(c.found.lines, { idf }) : [];
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.off = { i: c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" }, ii: fm.joinOffResults(per) };
    c.allOk = per.every((p) => p.ok === true);
    c.sRes = rank(rIC, c.input, SERVER_K);
    c.S = toS(c.sRes);
  }

  // ---- NỀN: MÁY = serverMerge của src/; LÙI = photoMerge của src/ ----
  const codesOf = (list) => list.map((x) => x.code);
  const check1 = { mayCells: 0, mayLocalSame: 0, mayKhoLonFnSame: 0, luiCells: 0, luiSame: 0, mayLocalDiff: [], mayKhoLonFnDiff: [], luiDiff: [] };
  for (const c of cases) {
    c.may = {};
    c.lui = {};
    c.kind2 = {};
    for (const cond of CONDS) {
      if (!c.found) { c.may[cond] = []; c.lui[cond] = []; continue; }
      const called = c.queries.length > 0;
      const mm = fsv.serverMerge(ctx, c.found, c.off[cond], c.S, { called }).merged;
      const ml = fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called }).merged;
      c.may[cond] = mm;
      c.lui[cond] = ml;
      c.kind2[`may|${cond}`] = fp.photoOutcome(mm).kind;
      c.kind2[`lui|${cond}`] = fp.photoOutcome(ml).kind;
      // kiểm chéo (1): bản sao G2 của khung đo (g2Local) trùng serverMerge (cả mục, không chỉ mã); mergeByMethod
      // G2-g3-w3 của kho-lon-do.mjs trùng; LÙI gọi lại photoMerge độc lập trùng.
      check1.mayCells++;
      if (JSON.stringify(g2Local(ctx, c.found, c.off[cond], c.S)) === JSON.stringify(mm)) check1.mayLocalSame++;
      else check1.mayLocalDiff.push(`${keyOf(c)}|${cond}`);
      const kl = mergeByMethod({ t1, rIndex, products, found: c.found, off: c.off[cond], S: c.S, method: "G2-g3-w3", catalogCodes });
      if (JSON.stringify(codesOf(kl)) === JSON.stringify(codesOf(mm))) check1.mayKhoLonFnSame++;
      else check1.mayKhoLonFnDiff.push(`${keyOf(c)}|${cond}`);
      check1.luiCells++;
      const ml2 = fx.photoMerge({ t1, rIndex, products, xi }, c.found, c.off[cond], { called }).merged;
      if (JSON.stringify(ml2) === JSON.stringify(ml)) check1.luiSame++;
      else check1.luiDiff.push(`${keyOf(c)}|${cond}`);
    }
  }
  const pos = (c, p, cond, code = c.code) => (code ? rankIn(codesOf(c[p][cond]), code) : null);
  const tally = (set, p, cond) => {
    const rs = cases.filter((c) => c.set === set);
    return { top1: rs.filter((c) => pos(c, p, cond) === 1).length, top5: rs.filter((c) => pos(c, p, cond) != null).length, n: rs.length };
  };
  const sum = {};
  for (const s of ["B", "A", "ngoai", "do"]) for (const p of PATHS) for (const cond of CONDS) sum[`${p}|${s}|${cond}`] = tally(s, p, cond);

  // ---- kiểm chéo (2): bộ A / B trùng v1-nen của dong-noi-bat (tổng + từng ca, từng ô) ----
  const check2 = { sums: {}, sumsOk: true, perCase: { cells: 0, same: 0, diff: [] }, file: dnbNen };
  for (const [s, top1, top5] of [["B", 14, 19], ["A", 13, 19]]) for (const p of PATHS) for (const cond of CONDS) {
    const v = sum[`${p}|${s}|${cond}`];
    check2.sums[`${p}|${s}|${cond}`] = `${v.top1}/${v.top5}`;
    if (v.top1 !== top1 || v.top5 !== top5) check2.sumsOk = false;
  }
  const dnbBase = fs.existsSync(dnbNen) ? JSON.parse(fs.readFileSync(dnbNen, "utf8")) : null;
  if (dnbBase) {
    for (const c of cases.filter((x) => ["B", "A", "muoi", "ruaypuan", "buldak"].includes(x.set) || (x.set === "7up" && x.kind === "go"))) {
      const old = dnbBase.baseTable[`${c.set}|${c.code ?? c.kind}`];
      if (!old) continue;
      for (const p of PATHS) for (const cond of CONDS) {
        check2.perCase.cells++;
        const a = JSON.stringify(old.none ? [] : old[`${p}|${cond}`]?.top5);
        const b = JSON.stringify(codesOf(c[p][cond]));
        if (a === b) check2.perCase.same++;
        else check2.perCase.diff.push(`${keyOf(c)}|${p}|${cond}`);
      }
    }
  }

  // ---- kiểm chéo (3): 6 ca ngoại MÁY trùng kho-lon G2-g3-w3 mức (c) (file từng ca v2), 4/12 trong 5 ----
  const check3 = { foreignCodesOk: JSON.stringify(foreign.map((f) => f.code)) === JSON.stringify(FOREIGN_CODES), foreignSame: 0, foreignCells: 0, foreignDiff: [], otherCells: 0, otherSame: 0, otherDiff: [], file: khoLonCase };
  const kl = fs.existsSync(khoLonCase) ? JSON.parse(fs.readFileSync(khoLonCase, "utf8")).perCase?.["c|G2-g3-w3"] : null;
  if (kl) {
    for (const c of cases) {
      const old = kl[keyOf(c)];
      if (!old) continue;
      for (const cond of CONDS) {
        const same = JSON.stringify(old[cond]) === JSON.stringify(codesOf(c.may[cond]));
        if (c.set === "ngoai") { check3.foreignCells++; if (same) check3.foreignSame++; else check3.foreignDiff.push(`${keyOf(c)}|${cond}`); }
        else { check3.otherCells++; if (same) check3.otherSame++; else check3.otherDiff.push(`${keyOf(c)}|${cond}`); }
      }
    }
  }
  const f5 = CONDS.reduce((n, cond) => n + sum[`may|ngoai|${cond}`].top5, 0);
  check3.foreignIn5 = f5;
  check3.ok = check3.foreignCodesOk && check3.foreignCells === 12 && check3.foreignSame === 12 && f5 === 4;

  // ---- kiểm chéo (4): buldak MÁY vị trí 1 = 8801073250574 ----
  const bu = cases.find((c) => c.set === "buldak");
  const ru = cases.find((c) => c.set === "ruaypuan");
  const check4 = { i: bu.may.i[0]?.code ?? null, ii: bu.may.ii[0]?.code ?? null };
  check4.ok = check4.i === BULDAK_CODE && check4.ii === BULDAK_CODE;

  // ---- S Node trùng candidates máy chủ thật (2 ảnh chụp màn hình) ----
  const serverMatch = {};
  for (const [name, c] of [["ruaypuan", ru], ["buldak", bu]]) {
    const cand = shots[name]?.candidates;
    serverMatch[name] = Array.isArray(cand) ? JSON.stringify(cand.map((x) => x.code)) === JSON.stringify(codesOf(c.S)) : null;
  }

  // ---- ruaypuan: hạng trong 10 ứng viên, sâu 100; chỉ báo "ruaypuan giả định" (ứng viên a-c80+c-2 của dong-noi-bat) ----
  const ruDeep = ru.input ? fr.rankFromItems(t1, rIC, ru.input.items, 100) : null;
  const ruRows = dnb.rowsOf(t1, ru.input);
  const hypoRes = dnb.methodRank(t1, rIC, ruRows, { a: dnb.A_VARIANTS["a-c80"], c: { beta: 2 } }, SERVER_K);
  const hypoS = toS(hypoRes);
  const ruHypo = {
    note: "ỨNG VIÊN GIẢ ĐỊNH (a-c80+c-2 của dong-noi-bat), máy chủ thật KHÔNG trả như vậy; chỉ báo, không dùng để chọn",
    sRank: rankIn(codesOf(hypoS), RUAYPUAN_CODE, SERVER_K), S: codesOf(hypoS),
    may: Object.fromEntries(CONDS.map((cond) => {
      const m = fsv.serverMerge(ctx, ru.found, ru.off[cond], hypoS, { called: ru.queries.length > 0 }).merged;
      return [cond, { rank: rankIn(codesOf(m), RUAYPUAN_CODE), top5: codesOf(m) }];
    })),
    passThrough: passThrough(ctx, ru.found, hypoS).map((x) => ({ j: x.j + 1, code: x.h.code, rawMatched: x.rawMatched })),
  };
  const ruInfo = {
    queryWords: ru.found?.query.length ?? null, sRank: rankIn(codesOf(ru.S), RUAYPUAN_CODE, SERVER_K),
    rankDeep100: ruDeep ? rankIn(ruDeep.hits.map((h) => h.code), RUAYPUAN_CODE, 100) : null,
    passThrough: passThrough(ctx, ru.found, ru.S).map((x) => ({ j: x.j + 1, code: x.h.code, rawMatched: x.rawMatched })),
  };

  // ---- bảng nền ----
  const cellOf = (c) => Object.fromEntries(PATHS.flatMap((p) => CONDS.map((cond) => [`${p}|${cond}`, {
    rank: c.code ? pos(c, p, cond) : null, top1: c[p][cond][0]?.code ?? null, kind: c.kind2[`${p}|${cond}`], top5: codesOf(c[p][cond]),
  }])));
  const special = {};
  for (const c of cases.filter((x) => ["7up", "muoi", "ruaypuan", "buldak", "ngoai"].includes(x.set))) {
    special[keyOf(c)] = { sRank: c.code ? rankIn(codesOf(c.S), c.code, SERVER_K) : null, S: codesOf(c.S), queries: c.queries, ...cellOf(c),
      passThrough: c.found ? passThrough(ctx, c.found, c.S).map((x) => ({ j: x.j + 1, code: x.h.code, rawMatched: x.rawMatched })) : [] };
  }
  // số ca có mục đi qua được (chỉ báo cấu trúc: G2 đang bỏ bao nhiêu mục khớp 0 từ)
  const ptStats = {};
  for (const s of ["B", "A", "7up", "muoi", "ruaypuan", "buldak", "ngoai", "do"]) {
    const rs = cases.filter((c) => c.set === s && c.found);
    ptStats[s] = { n: rs.length, s0: rs.filter((c) => passThrough(ctx, c.found, c.S).some((x) => x.j === 0)).length, any: rs.filter((c) => passThrough(ctx, c.found, c.S).length > 0).length };
  }
  const coverage = Object.fromEntries(["B", "A", "7up", "muoi", "ruaypuan", "buldak", "ngoai", "do"].map((s) => {
    const rs = cases.filter((c) => c.set === s);
    return [s, { n: rs.length, coCau: rs.filter((c) => c.queries.length).length, duCau: rs.filter((c) => c.queries.length && c.allOk).length }];
  }));
  const check1ok = check1.mayLocalSame === check1.mayCells && check1.mayKhoLonFnSame === check1.mayCells && check1.luiSame === check1.luiCells;
  const check2ok = check2.sumsOk && !!dnbBase && check2.perCase.same === check2.perCase.cells;
  const checks = { "1": { ok: check1ok, ...check1 }, "2": { ok: check2ok, ...check2 }, "3": check3, "4": check4 };
  const allOk = check1ok && check2ok && check3.ok && check4.ok;
  const perCase = Object.fromEntries(cases.map((c) => [keyOf(c), {
    queries: c.queries, S: codesOf(c.S), found: c.found ? c.found.hits.map((h) => h.code) : null,
    may: Object.fromEntries(CONDS.map((cond) => [cond, codesOf(c.may[cond])])), lui: Object.fromEntries(CONDS.map((cond) => [cond, codesOf(c.lui[cond])])),
  }]));
  const out = {
    at: new Date().toISOString(), sha, dirty, srcSame, baseSha: BASE_SHA, consts, cacheOnly: true, offNetCalls: disk.stats.calls, azureCalls: 0, ocrRerun: false,
    catalogFile: dmFile, catalogN: lv.rows.length, foreign: foreign.map((f) => ({ code: f.code, lines: f.lines })), probesN: probes.length,
    coverage, sum, special, ruInfo, ruHypo, serverMatch, ptStats, checks, allOk, perCase, offStats: disk.stats,
  };
  if (!runMethods) fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");

  // ---- in ----
  const f = (v) => (v == null ? "-" : v);
  console.log(`sha ${sha} dirty ${dirty}; bắt đầu ${startedAt}; src/server/public trùng ${BASE_SHA}: ${srcSame}; hằng số ${JSON.stringify(consts)}`);
  console.log(`Độ phủ (đủ câu / có câu / số ca): ${Object.entries(coverage).map(([s, v]) => `${s} ${v.duCau}/${v.coCau}/${v.n}`).join(" | ")}`);
  console.log(`NỀN: ${Object.entries(sum).map(([k, v]) => `${k} ${v.top1}/${v.top5}`).join(" | ")}`);
  for (const [k, v] of Object.entries(special)) {
    console.log(`  ${k}: S hạng ${f(v.sRank)}; ${["may|i", "may|ii", "lui|i", "lui|ii"].map((x) => `${x} v1 ${f(v[x].top1)} hạng ${f(v[x].rank)} ${v[x].kind}`).join("; ")}; đi qua được ${JSON.stringify(v.passThrough)}`);
  }
  console.log(`ruaypuan: ${JSON.stringify(ruInfo)}`);
  console.log(`ruaypuan GIẢ ĐỊNH: hạng ${f(ruHypo.sRank)} trong 10; MÁY nền với ứng viên giả định ${CONDS.map((cond) => `${cond} ${f(ruHypo.may[cond].rank)}`).join(", ")}; đi qua được ${JSON.stringify(ruHypo.passThrough)}`);
  console.log(`S Node trùng candidates máy chủ: ${JSON.stringify(serverMatch)}; mục đi qua được (ca có S[0] / ca có ≥ 1): ${JSON.stringify(ptStats)}`);
  console.log(`Kiểm chéo (1) ${check1ok ? "ĐẠT" : "LỆCH"}: g2Local = serverMerge ${check1.mayLocalSame}/${check1.mayCells}, mergeByMethod G2-g3-w3 = serverMerge ${check1.mayKhoLonFnSame}/${check1.mayCells}, LÙI photoMerge gọi lại ${check1.luiSame}/${check1.luiCells} ${[...check1.mayLocalDiff, ...check1.mayKhoLonFnDiff, ...check1.luiDiff].slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (2) ${check2ok ? "ĐẠT" : "LỆCH"}: ${JSON.stringify(check2.sums)}; từng ca so v1-nen ${check2.perCase.same}/${check2.perCase.cells} ${check2.perCase.diff.slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (3) ${check3.ok ? "ĐẠT" : "LỆCH"}: mã 6 ca ${check3.foreignCodesOk}; ngoại trùng kho-lon ${check3.foreignSame}/${check3.foreignCells}, trong 5 ${f5}/12; ca khác trùng kho-lon ${check3.otherSame}/${check3.otherCells} ${[...check3.foreignDiff, ...check3.otherDiff].slice(0, 10).join(" ")}`);
  console.log(`Kiểm chéo (4) ${check4.ok ? "ĐẠT" : "LỆCH"}: buldak MÁY vị trí 1 ${JSON.stringify({ i: check4.i, ii: check4.ii })}`);
  console.log(`OFF: ${JSON.stringify(disk.stats)}${runMethods ? "" : `; Ghi: ${outFile}`}`);
  if (!allOk) { console.error("KIỂM CHÉO LỆCH: dừng báo, không sửa src/."); process.exit(3); }

  // ---- vòng 2: mục tiêu của NỀN MÁY tính trong cùng lần chạy, so BASE_TARGET (không đổi BASE_TARGET) ----
  const baseTarget = targetOf(
    Object.fromEntries(cases.filter((x) => x.set === "ngoai").map((c) => [c.code, Object.fromEntries(CONDS.map((cond) => [cond, pos(c, "may", cond)]))])),
    Object.fromEntries(CONDS.map((cond) => [cond, pos(ru, "may", cond, RUAYPUAN_CODE)])),
  );
  const baseTargetOk = JSON.stringify(baseTarget) === JSON.stringify(BASE_TARGET);
  console.log(`Mục tiêu nền MÁY (cùng lần chạy) ${JSON.stringify(baseTarget)} ${baseTargetOk ? "TRÙNG" : "LỆCH"} BASE_TARGET ${JSON.stringify(BASE_TARGET)}`);
  Object.assign(out, { startedAt, ruleCheck, baseTarget, baseTargetOk });
  if (runMethods && !baseTargetOk) { console.error("Tự kiểm: mục tiêu nền lệch BASE_TARGET: dừng báo, không đo."); process.exit(3); }

  // ---- ĐO CÁC CÁCH (chỉ --do-cach; sau commit luật; phán đúng khối luật) ----
  if (runMethods) {
    const l7 = srcSame && Object.values(consts).every(Boolean);
    const ctxM = { ...ctx, catalogCodes };
    const sameArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const methods = {};
    for (const name of METHOD_NAMES) {
      const res = {};
      const qsDiff = [];
      const luiDiff = [];
      for (const c of cases) {
        const key = keyOf(c);
        // L6: câu OFF + S tính lại thật, so nền cùng lần chạy và nen.json
        const found = rank(rIndex, c.input, MERGE_K);
        const queries = found ? osx.cleanQuery(found.lines, { idf }) : [];
        const S = toS(rank(rIC, c.input, SERVER_K));
        const saved = nenSaved.perCase?.[key];
        if (!sameArr(queries, c.queries) || !sameArr(codesOf(S), codesOf(c.S)) || !saved || !sameArr(queries, saved.queries) || !sameArr(codesOf(S), saved.S)) qsDiff.push(key);
        const r = { may: {}, lui: {}, kind: {} };
        for (const cond of CONDS) {
          if (!found) { r.may[cond] = []; r.lui[cond] = []; continue; }
          const called = queries.length > 0;
          const mm = methodMerge(name, ctxM, found, c.off[cond], S, { called });
          const ml = fx.photoMerge({ ...ctx, xi }, found, c.off[cond], { called }).merged;
          r.may[cond] = codesOf(mm);
          r.lui[cond] = codesOf(ml);
          r.kind[`may|${cond}`] = fp.photoOutcome(mm).kind;
          r.kind[`lui|${cond}`] = fp.photoOutcome(ml).kind;
          if (!sameArr(r.lui[cond], codesOf(c.lui[cond]))) luiDiff.push(`${key}|${cond}`);
        }
        res[key] = r;
      }
      if (ruHypo && ru.found) {
        res.__ruHypo = Object.fromEntries(CONDS.map((cond) => [cond, rankIn(codesOf(methodMerge(name, ctxM, ru.found, ru.off[cond], hypoS, { called: ru.queries.length > 0 })), RUAYPUAN_CODE)]));
      }
      const posM = (c, cond, code = c.code) => (code ? rankIn(res[keyOf(c)].may[cond], code) : null);
      const loss = {};
      const abInfo = { moved5: 0, top1Changed: 0, noneToOpen: 0 };
      const noneToOpen = {};
      for (const s of ["B", "A"]) for (const cond of CONDS) {
        noneToOpen[`${s}|${cond}`] = [];
        const rs = cases.filter((c) => c.set === s);
        const rows = rs.map((c) => ({ code: c.code, base: pos(c, "may", cond), got: posM(c, cond) }));
        loss[`${s}|${cond}`] = { lostTop1: rows.filter((x) => x.base === 1 && x.got !== 1).map((x) => x.code), out5: rows.filter((x) => x.base != null && x.got == null).map((x) => x.code) };
        for (const c of rs) {
          const b = pos(c, "may", cond);
          const g = posM(c, cond);
          if (b != null && g != null && b !== g) abInfo.moved5++;
          if ((c.may[cond][0]?.code ?? null) !== (res[keyOf(c)].may[cond][0] ?? null)) abInfo.top1Changed++;
          if (c.kind2[`may|${cond}`] === "none" && res[keyOf(c)].kind[`may|${cond}`] === "open") {
            abInfo.noneToOpen++;
            noneToOpen[`${s}|${cond}`].push({ code: c.code, top1: res[keyOf(c)].may[cond][0] ?? null, rank: posM(c, cond) });
          }
        }
      }
      const s7 = {};
      for (const c of cases.filter((x) => x.set === "7up")) for (const cond of CONDS) s7[`${c.kind}|${cond}`] = posM(c, cond, CODE_7UP_DIET);
      const buldak = Object.fromEntries(CONDS.map((cond) => [cond, res[keyOf(bu)].may[cond][0] ?? null]));
      const sc = cases.find((x) => x.set === "muoi");
      const salt = res[keyOf(sc)].kind;
      const saltTop1 = Object.fromEntries(PATHS.flatMap((p) => CONDS.map((cond) => [`${p}|${cond}`, res[keyOf(sc)][p][cond][0] ?? null])));
      const foreignPos = {};
      const foreignJ = {};
      for (const c of cases.filter((x) => x.set === "ngoai")) {
        foreignPos[c.code] = Object.fromEntries(CONDS.map((cond) => [cond, posM(c, cond)]));
        foreignJ[c.code] = Object.fromEntries(CONDS.map((cond) => [cond, { base: pos(c, "may", cond), got: posM(c, cond) }]));
      }
      const ruPos = Object.fromEntries(CONDS.map((cond) => [cond, posM(ru, cond, RUAYPUAN_CODE)]));
      const probe = { top1: {}, top5: {} };
      for (const cond of CONDS) {
        const rs = cases.filter((c) => c.set === "do");
        probe.top1[cond] = rs.filter((c) => posM(c, cond) === 1).length;
        probe.top5[cond] = rs.filter((c) => posM(c, cond) != null).length;
      }
      const sums = {};
      const sumsLui = {};
      const s7lui = {};
      for (const s of ["B", "A"]) for (const cond of CONDS) {
        const rs = cases.filter((c) => c.set === s);
        sums[`${s}|${cond}`] = { top1: rs.filter((c) => posM(c, cond) === 1).length, top5: rs.filter((c) => posM(c, cond) != null).length };
        const posL = (c) => rankIn(res[keyOf(c)].lui[cond], c.code);
        sumsLui[`${s}|${cond}`] = { top1: rs.filter((c) => posL(c) === 1).length, top5: rs.filter((c) => posL(c) != null).length };
      }
      for (const c of cases.filter((x) => x.set === "7up")) for (const cond of CONDS) s7lui[`${c.kind}|${cond}`] = rankIn(res[keyOf(c)].lui[cond], CODE_7UP_DIET);
      const verdict = judge({ loss, luiDiff, s7, buldak, salt, confidenceNull: consts.confidenceNull, foreign: foreignJ, qsDiff, l7 });
      const t = targetOf(foreignPos, ruPos);
      methods[name] = { sums, sumsLui, s7lui, loss, s7, buldak, salt, saltTop1, foreignPos, ruPos, ruHypo: res.__ruHypo ?? null, probe, abInfo, noneToOpen, t, verdict, luiDiffN: luiDiff.length, qsDiffN: qsDiff.length };
      process.stdout.write(".");
    }
    console.log("");
    const pick = pickMethod(Object.entries(methods).map(([name, v]) => ({ name, pass: v.verdict.pass, t: v.t })));
    const conclusion = !pick.name ? "KHÔNG CÁCH NÀO ĐẠT: không giữ gì"
      : pick.improves ? `CHỌN ${pick.name} (qua cổng, mục tiêu ${JSON.stringify(methods[pick.name].t)} hơn nền ${JSON.stringify(BASE_TARGET)})`
        : `KHÔNG CÁCH NÀO CẢI THIỆN: cách qua cổng tốt nhất ${pick.name} có mục tiêu ${JSON.stringify(methods[pick.name].t)} không hơn nền; không giữ gì`;
    Object.assign(out, { at: new Date().toISOString(), methods, pick, conclusion, offStats: disk.stats, offNetCalls: disk.stats.calls });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
    for (const [name, v] of Object.entries(methods)) {
      const s = (k) => `${v.sums[k].top1}/${v.sums[k].top5}`;
      const sl = (k) => `${v.sumsLui[k].top1}/${v.sumsLui[k].top5}`;
      console.log(`${name.padEnd(6)} LÙI B ${sl("B|i")} ${sl("B|ii")} A ${sl("A|i")} ${sl("A|ii")} | 7Up LÙI ${["may|i", "may|ii", "go|i", "go|ii"].map((k) => f(v.s7lui[k])).join("")} | muối mục 1 ${JSON.stringify(v.saltTop1)} | ngoại MÁY ${JSON.stringify(v.foreignPos)}`);
      console.log(`${name.padEnd(6)} MÁY B ${s("B|i")} ${s("B|ii")} A ${s("A|i")} ${s("A|ii")} | 7Up ${["may|i", "may|ii", "go|i", "go|ii"].map((k) => f(v.s7[k])).join("")} | buldak ${CONDS.map((c) => (v.buldak[c] === BULDAK_CODE ? "=" : "≠")).join("")} | muối ${JSON.stringify(v.salt)} | ngoại trong 5 ${v.t.f5}/12 vị trí 1 ${v.t.f1}/12 | ruaypuan ${f(v.ruPos.i)}/${f(v.ruPos.ii)} (giả định ${f(v.ruHypo?.i)}/${f(v.ruHypo?.ii)}) | dò ${v.probe.top1.i}/${v.probe.top5.i} ${v.probe.top1.ii}/${v.probe.top5.ii} | A/B đổi ${JSON.stringify(v.abInfo)} | ${v.verdict.pass ? "QUA" : "TRƯỢT " + Object.entries(v.verdict.gates).filter(([, ok]) => !ok).map(([g]) => g).join(",")}`);
    }
    // chỉ báo none → open (không là cổng): ảnh nền MÁY "none" (5 rỗng) nay tự mở một sản phẩm
    console.log("none → open (chỉ báo; ảnh: mã đúng → mục 1 mới, vị trí mã đúng):");
    for (const [name, v] of Object.entries(methods)) {
      console.log(`  ${name.padEnd(6)} ${Object.entries(v.noneToOpen).map(([k, l]) => `${k} ${l.length}${l.length ? ` [${l.map((x) => `${x.code}→${x.top1}${x.rank ? ` (đúng ở ${x.rank})` : ""}`).join(", ")}]` : ""}`).join(" | ")}`);
    }
    for (const [name, v] of Object.entries(methods)) if (v.verdict.fails.length) console.log(`  ${name} trượt: ${v.verdict.fails.join("; ")}`);
    console.log(`pickMethod: ${JSON.stringify(pick)}`);
    console.log(`== Kết luận: ${conclusion}`);
    console.log(`OFF: ${JSON.stringify(disk.stats)}; Ghi: ${outFile}`);
  }
}
