// Đợt dong-noi-bat vòng 1: KHUNG ĐO "bỏ dòng rác / ưu tiên dòng nổi bật" cho Chụp mặt trước khi ảnh có nhiều chữ thừa
// (chụp màn hình có chữ trình duyệt / Windows). CHỈ đo trong Node, KHÔNG sửa src/ server/ public/: các cách (a)(b)(c)
// cài trong file này; phần gộp gọi ĐÚNG hàm src/ (serverMerge của front-server.js = G2-g3-w3 + c-idf (từ đợt
// g2-di-qua; dòng "G2-g3-w3" trong khối luật dưới giữ nguyên chữ lúc chốt, không sửa), photoMerge của
// front-extra.js, photoOutcome của front-photo.js, cleanQuery / createOffSearch của off-search.js, serverCandidates).
// OFF CHỈ đọc cache đĩa (0 lượt OFF thật), không gọi Azure thật, không chạy lại OCR bộ A / B.
//
//   node --max-old-space-size=4096 test-ocr/chup-mat-do/dong-noi-bat-do.mjs [--chi-nen] [--out D:\tmp\dong-noi-bat\ket-qua]
//        [--cache D:\tmp\tu-dong\cache-off] [--ocr D:\tmp\dong-noi-bat\ocr] [--danh-muc <c.jsonl.gz>] [--ban v1] [--ghi-de]
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC — commit riêng "test(dong-noi-bat): luật đo chốt trước" TRƯỚC mọi lần đo (kể cả chạy OCR 2 ảnh chụp
// màn hình). Viết lúc 2026-11-15 23:59 +0700 (giờ commit thật ghi ở PLAN.md mục 8, đợt dong-noi-bat). Không sửa khối
// này sau khi thấy số; buộc phải sửa thì ghi "LỆCH LUẬT" ở PLAN.md và dừng báo.
// ===================================================================================================================
// Nền = mã ở 6fd073e (không cách nào): T1 câu tìm = mọi dòng (rankFromItems / rankFromText).
// Dữ liệu: bộ B = D:\tmp\tu-dong\ocr\bo-b-30.json, bộ A = bo-a-30.json (items máy chủ đã ghi, không chạy lại OCR);
//   ca 7Up (chữ máy chủ "Up / Soda chanh / Khong calo" saltItems 0,95 + câu gõ "Soda chanh diet 7 up"), muối Co.op
//   (SALT_LINES, saltItems 0,9), 2 ảnh chụp màn hình thật ruaypuan.jpg / buldak.jpg (items máy chủ trên máy, P2, ghi ở
//   D:\tmp\dong-noi-bat\ocr\). CHỈ CÓ 2 ẢNH CHỤP MÀN HÌNH THẬT → bằng chứng yếu, không tuyên bố tổng quát.
// Hai đường (cùng found + S của cách đang đo; OFF cùng câu như nền, xem L9):
//   MÁY = đường máy chủ: found = T1 trên danh mục 1.452 theo cách đang đo (k 5); S = 10 ứng viên trên danh mục mức (c)
//     (server/catalog/c.jsonl.gz, chỉ mục JS buildRankIndex như kho-lon-do.mjs) theo cách đang đo, qua serverCandidates;
//     gộp serverMerge (G2-g3-w3) rồi photoOutcome.
//   LÙI = đường lùi: found như trên; photoMerge({ …, xi: kho phụ 893 }) rồi photoOutcome.
// Điều kiện OFF: (i) lỗi (mọi câu lỗi mạng); (ii) từ cache (câu thiếu cache = câu lỗi).
// Điểm gắn vào hit để gộp: (a) = BM25 câu đã lọc; (b)(c) = BM25 câu đầy đủ (của các dòng dùng) của chính tài liệu đó
//   (bm25DocScore), cách chỉ đổi TẬP + THỨ TỰ hit; serverMerge / photoMerge chấm lại ứng viên bằng found.query như cũ.
//
// Luật (cổng: L1a, L1b, L2, L3, L5–L9; L4 là mục tiêu để chọn):
//   L1a MÁY, bộ A + B, (i) + (ii): 0 ảnh mất vị trí 1, 0 ảnh mới rơi khỏi 5 so với nền (lossOf).
//   L1b LÙI, bộ A + B, (i) + (ii): như L1a.
//   L2  7Up Diet 8934588752117 ở vị trí 1 ở 4 ô MÁY (chữ máy / câu gõ × (i) / (ii)), như cách đo kho-lon-do.mjs;
//       thêm: ở LÙI không mất vị trí 1 / không rơi khỏi 5 so với nền (4 ô).
//   L3  buldak.jpg: mã ở vị trí 1 của nền ở MÁY (i) và (ii) (ghi ở P2) vẫn ở vị trí 1 (từng ô; nền ô đó rỗng → không xét).
//       LÙI chỉ báo.
//   L4  (mục tiêu) ruaypuan.jpg: 8852052150101 ở MÁY (i) + (ii): điểm = (số ô vị trí 1, số ô trong 5).
//   L5  Muối Co.op: CONFIDENCE_RULE vẫn { feature: null, threshold: null } (luôn không chắc → kết quả "open" luôn có
//       khung "có thể nhầm") → L5 ĐẠT vì luật tin cậy không đổi; kèm kiểm photoOutcome kind ∈ {open, none} ở 4 ô; mục 1
//       chỉ báo.
//   L6  S ≤ 10 mục ở mọi ca; (a) lọc hết dòng (câu tìm không từ vựng rỗng) → quay về mọi dòng = S và found trùng nền.
//   L7  Không đổi G2 (src/front-server.js), danh mục, kho phụ, dependency, CONFIDENCE_RULE, STRANGE_MODE: kiểm
//       `git diff --quiet 6fd073e -- src server public package.json package-lock.json` + 2 hằng số lúc chạy.
//   L8  H3 p95 ≤ 200 ms, H2 ≤ 1.536 MiB. Vòng 1 (Node) chỉ ƯỚC: H3 ước = 23,5 ms (H3 p95 Python mức (c), bộ đệm ấm,
//       kho-lon vòng 3) × p95_Node(cách) / p95_Node(nền) (p95 nearest rank thời gian tạo S trên 30 ảnh bộ B, không
//       cache); H2 ước = 835,3 MiB cho mọi cách (không thêm cấu trúc dữ liệu). Số Python đo ở vòng cài đặt.
//   L9  Câu OFF = cleanQuery(dòng CHƯA lọc của nền, { idf 1.452 }) cho mọi cách (khung đo dựng sẵn một lần / ca);
//       kiểm câu từng ca trùng nền. Cách nào buộc đổi câu OFF: câu thiếu cache = lỗi, ghi độ phủ.
// Luật chọn: chỉ xét cách qua L1a, L1b, L2, L3, L5–L9; chọn L4 tốt nhất (số ô vị trí 1 > số ô trong 5); hòa → cách
//   đứng trước trong METHOD_ORDER (a < c < b < tổ hợp; trong nhóm theo thứ tự liệt kê). Không cách nào qua → không giữ gì.
//   Cách được chọn mà L4 KHÔNG hơn nền (theo (vị trí 1, trong 5)) thì không đáng cài: kết luận ghi "không cách nào cải
//   thiện L4" và không giữ gì.
//
// (a) bỏ dòng rác (áp vào dòng trước khi dựng câu tìm T1, cả 1.452 và (c)); mỗi tiêu chí đo riêng + tổ hợp:
//   url  : dòng khớp URL_RE (http(s)://, www., tên miền có đuôi trong URL_TLDS, ổ đĩa "C:\", đường dẫn "x/y/").
//   so   : dòng toàn số / ký tự lạ: tỉ lệ chữ cái Latin trên ký tự không trắng < ODD_MIN_LATIN (0,5).
//   ui   : dòng chữ giao diện: sau khi bỏ UI_PHRASES (khớp nguyên từ, chữ đã chuẩn hóa), MỌI từ không nhiễu còn lại nằm
//          trong UI_WORDS (dòng có ≥ 1 từ không nhiễu trước khi bỏ).
//   c70 / c80 : độ tin hàng (trung bình score) < 0,7 / < 0,8 (đang có MIN_CONF 0,5 trong T1); độ tin null thì giữ.
//   Tên: a-c70, a-c80, a-url, a-so, a-ui, a-tong (url + so + ui), a-tong-c70, a-tong-c80.
//   Lọc làm câu tìm (không từ vựng) rỗng trong khi câu mọi dòng không rỗng → dùng mọi dòng (như nền).
// (b) dòng nổi bật: ứng viên = dòng usableLine có câu tìm (không từ vựng) khác rỗng và h hữu hạn; "h" = xếp theo chiều
//   cao khung chữ (h của rowLineInfo) giảm dần, hòa → dòng trước; "hoa" = chỉ dòng in hoa đứng riêng (mọi chữ cái Latin
//   in hoa, ≥ 3 chữ cái, câu tìm 1–3 từ), xếp như "h". Lấy k ∈ {1, 2, 3} dòng; mỗi dòng tìm riêng (top LIST_DEPTH 10);
//   gộp RRF hằng số 60 với danh sách tìm cả câu (top 10): điểm = Σ 1 / (60 + hạng); hòa → hạng trong danh sách cả câu
//   (không có = ∞), rồi chỉ số tài liệu nhỏ trước; lấy 10 (S) / 5 (found). Không có dòng nổi bật → như nền.
//   Tên: b-h1, b-h2, b-h3, b-hoa1, b-hoa2, b-hoa3.
// (c) từ ở dòng chữ to nặng điểm hơn: trung vị dưới m của h trên các dòng có từ trong câu tìm; trọng số dòng =
//   1 + β × max(0, h / m − 1); trọng số từ = lớn nhất trên các dòng chứa từ; BM25 có trọng số (cùng phép tính bm25Search,
//   nhân trọng số); β ∈ {0,5; 1; 2}; β = 0 (tắt) / không có h → trùng nền từng ca. Tên: c-0.5, c-1, c-2.
// Tổ hợp: (a)+(b) và (a)+(c) với MỌI biến thể (a) × MỌI ô lưới (b) / (c) (lọc trước, rồi (b) / (c) trên dòng còn lại).
// Ca tổng hợp (CHỈ BÁO CÁO, không là cổng): mỗi ảnh bộ A / B chèn JUNK_LINES (khung cao 14 px, độ tin 0,95) phía trên
//   chữ thật (chữ thật dời xuống); báo số vị trí 1 / trong 5 ở MÁY và LÙI so với nền trên ảnh gốc.
// Danh sách chữ giao diện (UI_WORDS, UI_PHRASES, JUNK_LINES) viết từ hiểu biết chung về giao diện trình duyệt / Windows,
//   KHÔNG chép từ chữ OCR của ruaypuan / buldak (chưa xem chữ OCR 2 ảnh này lúc viết).
// ===================================================================================================================
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bm25DocScore } from "../../src/front-merge.js";

// ---------------- khối luật: hằng số ----------------
export const RRF_K = 60;
export const LIST_DEPTH = 10;
export const SERVER_K = 10;
export const FOUND_K = 5;
export const ODD_MIN_LATIN = 0.5;
export const HOA_MAX_WORDS = 3;
export const MIN_CAPS_LETTERS = 3;
export const B_KS = Object.freeze([1, 2, 3]);
export const B_SELS = Object.freeze(["h", "hoa"]);
export const C_BETAS = Object.freeze([0.5, 1, 2]);
export const H3_PY_BASE_MS = 23.5;
export const H3_MAX_MS = 200;
export const H2_EST_MIB = 835.3;
export const H2_MAX_MIB = 1536;
export const RUAYPUAN_CODE = "8852052150101";
export const CODE_7UP_DIET = "8934588752117";
export const BASE_SHA = "6fd073e";

export const URL_TLDS = Object.freeze(["com", "net", "org", "vn", "io", "co", "gov", "edu", "info", "html", "htm", "php", "asp", "aspx"]);
export const URL_RE = new RegExp(
  String.raw`(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(?:${URL_TLDS.join("|")})\b|\b[a-z]:\\|[a-z0-9_-]\/[a-z0-9_-]+\/)`, "i");

/** Từ giao diện trình duyệt / Windows (đã chuẩn hóa: thường, không dấu). */
export const UI_WORDS = Object.freeze(new Set([
  "file", "edit", "view", "history", "bookmarks", "bookmark", "tools", "tool", "help", "window", "windows", "tab", "tabs",
  "close", "search", "google", "bing", "chrome", "edge", "firefox", "safari", "opera", "browser", "microsoft", "settings",
  "setting", "menu", "back", "forward", "reload", "refresh", "home", "share", "download", "downloads", "upload", "print",
  "zoom", "copy", "paste", "save", "open", "sign", "login", "logout", "account", "profile", "extensions", "extension",
  "favorites", "favourites", "address", "url", "http", "https", "www", "com", "net", "org", "html", "php", "images",
  "image", "videos", "video", "news", "shopping", "maps", "more", "all", "filter", "filters", "results", "result", "page",
  "next", "previous", "translate", "sponsored", "ads", "privacy", "terms", "cookies", "accept", "reject", "cancel", "ok",
  "minimize", "maximize", "restore", "type", "here", "to", "or", "on", "start", "taskbar", "desktop", "explorer", "folder",
  "documents", "pictures", "photos", "photo", "screenshot", "notifications", "notification", "wifi", "battery", "volume",
  "eng", "vie", "lens", "incognito", "private", "guest", "sync", "reading", "list", "sidebar",
]));

/** Cụm giao diện tiếng Việt (đã chuẩn hóa), bỏ khỏi dòng trước khi xét UI_WORDS. */
export const UI_PHRASES = Object.freeze([
  "tim kiem", "trang chu", "dang nhap", "dang xuat", "cai dat", "tai xuong", "tai len", "chia se", "sao chep", "lich su",
  "dau trang", "cua so", "tab moi", "the moi", "hinh anh", "tin tuc", "mua sam", "ban do", "tat ca", "cong cu",
  "tro giup", "quay lai", "lam moi", "thong bao", "ket qua", "trang tiep", "dich trang", "thu muc", "tai lieu",
  "may tinh", "chup man hinh", "man hinh", "tai khoan", "mat khau", "thanh tac vu", "tren google", "nhap url",
  "nhap dia chi", "hoac", "xem them", "an danh", "che do", "phong to", "thu nho",
]);

/** Dòng rác cố định cho ca tổng hợp (chữ giao diện chung, không lấy từ ảnh nào). */
export const JUNK_LINES = Object.freeze([
  "https://www.google.com/search?q=snack",
  "File Edit View History Bookmarks Tools Help",
  "Tìm kiếm trên Google hoặc nhập URL",
  "Tất cả Hình ảnh Video Tin tức Mua sắm Bản đồ",
  "All Images Videos News Shopping Maps More",
  "Đăng nhập",
  "Cài đặt Công cụ",
  "New Tab",
  "Downloads",
  "ENG 10:45 15/11/2026",
  "Type here to search",
  "★★★★☆ 4.5 (2,341)",
]);

/** Biến thể (a): tên → tiêu chí. */
export const A_VARIANTS = Object.freeze({
  "a-c70": { conf: 0.7 },
  "a-c80": { conf: 0.8 },
  "a-url": { url: true },
  "a-so": { so: true },
  "a-ui": { ui: true },
  "a-tong": { url: true, so: true, ui: true },
  "a-tong-c70": { url: true, so: true, ui: true, conf: 0.7 },
  "a-tong-c80": { url: true, so: true, ui: true, conf: 0.8 },
});

/** Mọi cách (trừ nền) theo thứ tự ưu tiên khi hòa: (a) < (c) < (b) < (a)+(c) < (a)+(b). */
export function methodGrid() {
  const g = {};
  for (const [n, a] of Object.entries(A_VARIANTS)) g[n] = { a };
  for (const beta of C_BETAS) g[`c-${beta}`] = { c: { beta } };
  for (const sel of B_SELS) for (const k of B_KS) g[`b-${sel}${k}`] = { b: { sel, k } };
  for (const [n, a] of Object.entries(A_VARIANTS)) for (const beta of C_BETAS) g[`${n}+c-${beta}`] = { a, c: { beta } };
  for (const [n, a] of Object.entries(A_VARIANTS)) for (const sel of B_SELS) for (const k of B_KS) g[`${n}+b-${sel}${k}`] = { a, b: { sel, k } };
  return g;
}
export const METHOD_ORDER = Object.freeze(Object.keys(methodGrid()));

// ---------------- khối luật: tiêu chí dòng ----------------
const LATIN = /\p{Script=Latin}/u;

/** Từ không nhiễu của chữ (chuẩn hóa như T1). */
export function normWords(t1, text) {
  return t1.normalizeText(text).split(" ").filter((w) => w && !t1.isNoiseWord(w));
}

export function isUrlLine(text) {
  return URL_RE.test(String(text ?? ""));
}

/** Toàn số / ký tự lạ: tỉ lệ chữ cái Latin trên ký tự không trắng < ODD_MIN_LATIN (dòng rỗng → false). */
export function isOddLine(text) {
  const chars = [...String(text ?? "")].filter((c) => !/\s/u.test(c));
  if (!chars.length) return false;
  const latin = chars.filter((c) => LATIN.test(c)).length;
  return latin / chars.length < ODD_MIN_LATIN;
}

/** Bỏ UI_PHRASES (khớp nguyên từ, 2 lượt) khỏi chuỗi đã chuẩn hóa. */
export function stripUiPhrases(norm) {
  let s = ` ${norm} `;
  for (let pass = 0; pass < 2; pass++) for (const p of UI_PHRASES) s = s.split(` ${p} `).join(" ");
  return s.replace(/\s+/g, " ").trim();
}

/** Dòng chữ giao diện: có ≥ 1 từ không nhiễu, và sau khi bỏ UI_PHRASES mọi từ không nhiễu còn lại thuộc UI_WORDS. */
export function isUiLine(t1, text) {
  const norm = t1.normalizeText(text);
  if (!normWords(t1, norm).length) return false;
  return normWords(t1, stripUiPhrases(norm)).every((w) => UI_WORDS.has(w));
}

/** Dòng in hoa: mọi chữ cái Latin in hoa, ≥ MIN_CAPS_LETTERS chữ cái Latin. */
export function isCapsLine(text) {
  const letters = [...String(text ?? "")].filter((c) => LATIN.test(c) && /\p{L}/u.test(c));
  return letters.length >= MIN_CAPS_LETTERS && letters.every((c) => /\p{Lu}/u.test(c));
}

/** (a): lọc dòng { text, h, conf } theo tiêu chí; lọc làm câu tìm rỗng → mọi dòng (fellBack true). */
export function filterRows(t1, rows, a) {
  const list = Array.isArray(rows) ? rows : [];
  if (!a) return { rows: list, fellBack: false, dropped: 0 };
  const kept = list.filter((r) => {
    const t = r?.text;
    if (a.url && isUrlLine(t)) return false;
    if (a.so && isOddLine(t)) return false;
    if (a.ui && isUiLine(t1, t)) return false;
    const c = Number(r?.conf);
    if (a.conf != null && r?.conf != null && Number.isFinite(c) && c < a.conf) return false;
    return true;
  });
  if (!t1.t1QueryFromLines(kept).length && t1.t1QueryFromLines(list).length) return { rows: list, fellBack: true, dropped: 0 };
  return { rows: kept, fellBack: false, dropped: list.length - kept.length };
}

/** (b): dòng nổi bật theo { sel: "h" | "hoa", k }. Trả các dòng (thứ tự nổi bật). */
export function prominentRows(t1, rows, b) {
  const cands = (Array.isArray(rows) ? rows : []).map((r, j) => ({ r, j }))
    .filter((x) => Number.isFinite(x.r?.h) && t1.usableLine(x.r) && t1.t1QueryFromLines([x.r]).length > 0)
    .filter((x) => b.sel !== "hoa" || (isCapsLine(x.r.text) && t1.t1QueryFromLines([x.r]).length <= HOA_MAX_WORDS));
  cands.sort((x, y) => y.r.h - x.r.h || x.j - y.j);
  return cands.slice(0, b.k).map((x) => x.r);
}

/** Gộp RRF: lists[0] = danh sách cả câu; mỗi list = [{ i }] theo hạng. Trả [{ i, s }] top k. */
export function rrfFuse(lists, k, rrfK = RRF_K) {
  const m = new Map();
  lists.forEach((list, li) => list.forEach((h, r) => {
    const cur = m.get(h.i) || { i: h.i, s: 0, w: Infinity };
    cur.s += 1 / (rrfK + r + 1);
    if (li === 0) cur.w = Math.min(cur.w, r + 1);
    m.set(h.i, cur);
  }));
  return [...m.values()].sort((x, y) => y.s - x.s || x.w - y.w || x.i - y.i).slice(0, k);
}

/** (c): trọng số từ theo chiều cao dòng. Không có h / β = 0 → Map rỗng (mọi trọng số 1). */
export function rowWeights(t1, rows, vocab, aliasDf, beta) {
  const out = new Map();
  if (!(beta > 0)) return out;
  const contrib = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ r, q: t1.t1QueryFromLines([r], vocab, aliasDf) }))
    .filter((x) => x.q.length && Number.isFinite(x.r?.h) && x.r.h > 0);
  if (!contrib.length) return out;
  const hs = contrib.map((x) => x.r.h).sort((a, b) => a - b);
  const med = hs[Math.floor((hs.length - 1) / 2)];
  for (const { r, q } of contrib) {
    const w = 1 + beta * Math.max(0, r.h / med - 1);
    for (const word of q) out.set(word, Math.max(out.get(word) ?? 1, w));
  }
  return out;
}

/** BM25 có trọng số (cùng phép tính bm25Search của t1.mjs, nhân trọng số); trả [{ code, score (không trọng số), wscore, i }]. */
export function weightedSearch(index, words, weights, k) {
  const q = [...new Set(words)];
  const score = new Map();
  const plain = new Map();
  for (const w of q) {
    const idf = index.idf.get(w);
    if (!idf) continue;
    const wt = weights.get(w) ?? 1;
    for (const i of index.post.get(w)) {
      const t = index.tf[i];
      const f = t.m.get(w);
      const s = idf * (f * (index.k1 + 1)) / (f + index.k1 * (1 - index.b + index.b * (t.len / (index.avgdl || 1))));
      score.set(i, (score.get(i) || 0) + wt * s);
      plain.set(i, (plain.get(i) || 0) + s);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k)
    .map(([i, s]) => ({ code: index.tf[i].code, score: plain.get(i), wscore: s, i }));
}

/**
 * Xếp hạng theo cách m ({ a?, b?, c? }; {} = nền) trên chỉ mục rIndex (buildRankIndex). rows = dòng { text, h, conf }.
 * search (tùy chọn) thay t1.bm25Search (để nhớ kết quả). Trả { lines (mọi dòng, chưa lọc), query, hits, fellBack, dropped, lists }.
 */
export function methodRank(t1, rIndex, rows, m, k, search = t1.bm25Search) {
  const index = rIndex.index;
  const vocab = index.idf;
  const alias = index.aliasDf;
  const all = Array.isArray(rows) ? rows : [];
  const f = filterRows(t1, all, m?.a);
  const use = f.rows;
  const query = t1.t1QueryFromLines(use, vocab, alias);
  const base = { lines: all.map((r) => r.text), query, fellBack: f.fellBack, dropped: f.dropped, lists: 1 };
  if (!query.length) return { ...base, hits: [] };
  if (m?.c) return { ...base, hits: weightedSearch(index, query, rowWeights(t1, use, vocab, alias, m.c.beta), k) };
  if (m?.b) {
    const lists = [search(index, query, LIST_DEPTH)];
    for (const r of prominentRows(t1, use, m.b)) {
      const q = t1.t1QueryFromLines([r], vocab, alias);
      if (q.length) lists.push(search(index, q, LIST_DEPTH));
    }
    const hits = rrfFuse(lists, k).map((x) => ({ code: index.tf[x.i].code, score: bm25DocScore(index, index.tf[x.i], query).score, i: x.i, rrf: x.s }));
    return { ...base, hits, lists: lists.length };
  }
  return { ...base, hits: search(index, query, k) };
}

/** Dòng từ items máy chủ ({ text, poly, score }) như rankFromItems; từ chữ gõ như rankFromText (conf null, không h). */
export function rowsOf(t1, input) {
  if (!input) return null;
  if (input.items) return t1.rowLineInfo(t1.ocrItems([{ items: Array.isArray(input.items) ? input.items : [] }]));
  return String(input.text ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => ({ text: s, conf: null }));
}

/** Ca tổng hợp: chèn JUNK_LINES (cao 14 px, độ tin 0,95) phía trên items thật (items thật dời xuống). */
export function injectJunk(items, junk = JUNK_LINES) {
  const list = Array.isArray(items) ? items : [];
  const ys = list.flatMap((it) => (Array.isArray(it?.poly) ? it.poly.map((p) => p[1]) : []));
  const minY = ys.length ? Math.min(...ys) : 0;
  const shift = junk.length * 20 + 10 - minY;
  const moved = list.map((it) => ({ ...it, poly: Array.isArray(it?.poly) ? it.poly.map(([x, y]) => [x, y + shift]) : it?.poly }));
  const added = junk.map((text, j) => ({ text, score: 0.95, poly: [[0, j * 20], [300, j * 20], [300, j * 20 + 14], [0, j * 20 + 14]] }));
  return [...added, ...moved];
}

// ---------------- khối luật: phán + chọn ----------------
/**
 * Phán một cách. r = {
 *   loss: { "may|B|i": { lostTop1, out5 }, … "lui|A|ii" } (so với nền),
 *   s7: { "may|may|i": vị trí Diet | null, … "may|go|ii" }, s7lui: { "may|i": { base, got }, … "go|ii" },
 *   buldak: { i: { base: mã | null, got: mã | null }, ii }, salt: { "may|i": kind, … }, confidenceNull: bool,
 *   sMax: số mục S lớn nhất, fallbackOk: bool, l7: bool, h3Est: ms, h2Est: MiB, offSame: bool }.
 * Trả { gates: { L1a, L1b, L2, L3, L5, L6, L7, L8, L9 }: bool, fails: [câu], pass }.
 */
export function judge(r) {
  const fails = [];
  const g = {};
  for (const [name, path] of [["L1a", "may"], ["L1b", "lui"]]) {
    let ok = true;
    for (const s of ["B", "A"]) for (const c of ["i", "ii"]) {
      const l = r?.loss?.[`${path}|${s}|${c}`];
      if (!l) { ok = false; fails.push(`${name} ${s}-${c}: thiếu số`); continue; }
      for (const code of l.lostTop1) { ok = false; fails.push(`${name} ${s}-${c}: mất vị trí 1 ${code}`); }
      for (const code of l.out5) { ok = false; fails.push(`${name} ${s}-${c}: rơi khỏi 5 ${code}`); }
    }
    g[name] = ok;
  }
  let l2 = true;
  for (const kind of ["may", "go"]) for (const c of ["i", "ii"]) {
    if (r?.s7?.[`may|${kind}|${c}`] !== 1) { l2 = false; fails.push(`L2 MÁY 7Up ${kind}-${c}: vị trí ${r?.s7?.[`may|${kind}|${c}`] ?? "ngoài 5"}`); }
    const lui = r?.s7lui?.[`${kind}|${c}`];
    if (!lui) { l2 = false; fails.push(`L2 LÙI 7Up ${kind}-${c}: thiếu số`); continue; }
    if (lui.base === 1 && lui.got !== 1) { l2 = false; fails.push(`L2 LÙI 7Up ${kind}-${c}: mất vị trí 1`); }
    if (lui.base != null && lui.got == null) { l2 = false; fails.push(`L2 LÙI 7Up ${kind}-${c}: rơi khỏi 5`); }
  }
  g.L2 = l2;
  let l3 = true;
  for (const c of ["i", "ii"]) {
    const b = r?.buldak?.[c];
    if (!b) { l3 = false; fails.push(`L3 buldak ${c}: thiếu số`); continue; }
    if (b.base != null && b.got !== b.base) { l3 = false; fails.push(`L3 buldak ${c}: vị trí 1 ${b.got ?? "rỗng"} ≠ nền ${b.base}`); }
  }
  g.L3 = l3;
  let l5 = r?.confidenceNull === true;
  if (!l5) fails.push("L5: CONFIDENCE_RULE đã đổi");
  for (const k of ["may|i", "may|ii", "lui|i", "lui|ii"]) {
    const kind = r?.salt?.[k];
    if (kind !== "open" && kind !== "none") { l5 = false; fails.push(`L5 muối ${k}: kết quả ${kind}`); }
  }
  g.L5 = l5;
  g.L6 = Number.isInteger(r?.sMax) && r.sMax <= SERVER_K && r?.fallbackOk === true;
  if (!g.L6) fails.push(`L6: S tối đa ${r?.sMax}, quay về mọi dòng ${r?.fallbackOk ? "đúng" : "SAI"}`);
  g.L7 = r?.l7 === true;
  if (!g.L7) fails.push("L7: src / server / public / dependency hoặc hằng số đã đổi");
  g.L8 = Number.isFinite(r?.h3Est) && r.h3Est <= H3_MAX_MS && Number.isFinite(r?.h2Est) && r.h2Est <= H2_MAX_MIB;
  if (!g.L8) fails.push(`L8: H3 ước ${r?.h3Est} ms, H2 ước ${r?.h2Est} MiB`);
  g.L9 = r?.offSame === true;
  if (!g.L9) fails.push("L9: câu OFF khác nền");
  return { gates: g, fails, pass: Object.values(g).every(Boolean) };
}

/** Điểm L4 từ vị trí ruaypuan ở MÁY (i), (ii): { top1, top5 }. */
export function l4Score(ranks) {
  const xs = [ranks?.i ?? null, ranks?.ii ?? null];
  return { top1: xs.filter((x) => x === 1).length, top5: xs.filter((x) => x != null).length };
}

/**
 * Chọn: list = [{ name, pass, l4: { top1, top5 } }], base = L4 của nền → { name | null, improves: bool }
 * (improves = L4 của cách được chọn hơn nền theo (top1, top5); không hơn → không giữ gì).
 */
export function pickMethod(list, base = { top1: 0, top5: 0 }, order = METHOD_ORDER) {
  const ok = (list || []).filter((m) => m.pass);
  ok.sort((a, b) => b.l4.top1 - a.l4.top1 || b.l4.top5 - a.l4.top5 || order.indexOf(a.name) - order.indexOf(b.name));
  const best = ok[0] ?? null;
  const improves = !!best && (best.l4.top1 > base.top1 || (best.l4.top1 === base.top1 && best.l4.top5 > base.top5));
  return { name: best?.name ?? null, improves };
}
// ===================================================================================================================
// HẾT KHỐI LUẬT
// ===================================================================================================================

// ---------------- chạy đo (KHÔNG thuộc khối luật) ----------------
/** p95 nearest rank (như quantile của kho-lon-do.mjs). */
export function p95(xs) {
  const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.95 * s.length) - 1))] : null;
}

/** Vị trí (1–n) của mã trong danh sách mã, không có → null. */
export function rankIn(codes, code, n = 5) {
  const i = (codes || []).slice(0, n).indexOf(code);
  return i < 0 ? null : i + 1;
}

/**
 * Khóa một ca trong kết quả (đợt g2-di-qua vòng 1, Việc để sau (v) của dong-noi-bat): có kind như kho-lon-do.mjs, để 2
 * ca 7Up (chữ máy "may", câu gõ "go") cùng mã không ghi đè nhau. Trước: `${set}|${code ?? kind}` (trùng khóa).
 */
export function keyOf(c) {
  return `${c.set}|${c.code ?? c.kind}|${c.kind}`;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const onlyBase = argv.includes("--chi-nen");
  const outDir = arg("--out", "D:\\tmp\\dong-noi-bat\\ket-qua");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const ocrDir = arg("--ocr", "D:\\tmp\\dong-noi-bat\\ocr");
  const ban = arg("--ban", "v1");
  const { loadApp, makeDiskFetch, ROOT, SETS, LINES_7UP, TYPED_7UP } = await import("./tu-dong-do.mjs");
  const { lossOf } = await import("./tu-dong-v42-do.mjs");
  const { ALL_CODES, SALT_LINES, saltItems } = await import("./nang-t1-do.mjs");
  const { readLevel } = await import("./kho-lon-do.mjs");
  const dmFile = arg("--danh-muc", path.join(ROOT, "server", "catalog", "c.jsonl.gz"));
  const outFile = path.join(outDir, `${ban}-${onlyBase ? "nen" : "do"}.json`);
  if (fs.existsSync(outFile) && !argv.includes("--ghi-de")) {
    console.error(`Đã có ${outFile}. Đổi --ban hoặc thêm --ghi-de.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const cp = await import("node:child_process");
  const git = (c) => { try { return cp.execSync(c, { cwd: ROOT }).toString().trim(); } catch { return null; } };
  const sha = git("git rev-parse HEAD");
  const dirty = git("git status --porcelain") !== "";
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
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json"), "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);
  const confidenceNull = fr.CONFIDENCE_RULE.feature === null && fr.CONFIDENCE_RULE.threshold === null;
  const l7 = srcSame && confidenceNull && osx.STRANGE_MODE === null;

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
  for (const [name, code] of [["ruaypuan", RUAYPUAN_CODE], ["buldak", null]]) {
    const f = path.join(ocrDir, `${name}.json`);
    const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
    cases.push({ set: name, kind: "man-hinh", code, input: j?.items ? { items: j.items } : null, serverCandidates: j?.candidates ?? null });
  }
  for (const s of ["B", "A"]) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const code of ALL_CODES) {
      const items = bundle.items?.[code]?.items ?? null;
      cases.push({ set: s, kind: "anh", code, input: items ? { items } : null });
      if (items) cases.push({ set: `tong-${s}`, kind: "tong-hop", code, input: { items: injectJunk(items) } });
    }
  }
  for (const c of cases) c.rows = rowsOf(t1, c.input);

  // ---- nền: found + câu OFF (L9: câu OFF dựng MỘT lần từ dòng chưa lọc của nền) ----
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1e9 });
  let baseMismatch = 0;
  for (const c of cases) {
    if (!c.rows) { c.queries = []; c.off = { i: { ok: false, kind: "none" }, ii: { ok: false, kind: "none" } }; continue; }
    const ref = c.input.items ? fr.rankFromItems(t1, rIndex, c.input.items) : fr.rankFromText(t1, rIndex, c.input.text);
    const mine = methodRank(t1, rIndex, c.rows, {}, FOUND_K);
    if (JSON.stringify(ref.hits) !== JSON.stringify(mine.hits) || JSON.stringify(ref.lines) !== JSON.stringify(mine.lines)) baseMismatch++;
    c.queries = osx.cleanQuery(ref.lines, { idf });
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.off = { i: c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" }, ii: fm.joinOffResults(per) };
    c.allOk = per.every((p) => p.ok === true);
  }
  if (baseMismatch) throw new Error(`methodRank nền lệch rankFromItems / rankFromText ở ${baseMismatch} ca`);

  // nhớ kết quả bm25Search trên (c) theo câu (cách khác nhau dùng chung câu)
  const memo = new Map();
  const searchC = (index, q, k) => {
    const key = `${k}|${q.join(" ")}`;
    if (!memo.has(key)) memo.set(key, t1.bm25Search(index, q, k));
    return memo.get(key);
  };
  const toS = (res) => fsv.serverCandidates({
    candidates: res.hits.map((h) => {
      const r = lv.rows[h.i];
      const v = (x) => (x == null ? "" : x);
      return { code: v(r.code), name: v(r.name), brand: v(r.brand), img: v(r.img), text: v(r.text), grp: v(r.grp), score: h.score };
    }),
  });
  const codesOf = (list) => list.map((x) => x.code);

  /** Chạy một cách trên mọi ca → { [caKey]: { foundCodes, S, may: { i, ii }, lui: { i, ii }, kind } }. */
  const runMethod = (m) => {
    const out = {};
    for (const c of cases) {
      const key = keyOf(c);
      if (!c.rows) { out[key] = { none: true, S: [], foundCodes: [], may: { i: [], ii: [] }, lui: { i: [], ii: [] }, kind: {} }; continue; }
      const found = methodRank(t1, rIndex, c.rows, m, FOUND_K);
      const sRes = methodRank(t1, rIC, c.rows, m, SERVER_K, searchC);
      const S = toS(sRes);
      const called = c.queries.length > 0;
      const r = {
        foundCodes: found.hits.map((h) => h.code), query: found.query.length, fellBack: found.fellBack || sRes.fellBack, dropped: sRes.dropped,
        lists: sRes.lists, S: codesOf(S), sRaw: sRes.hits.length, may: {}, lui: {}, kind: {},
      };
      for (const cond of ["i", "ii"]) {
        const mm = fsv.serverMerge({ t1, rIndex, products }, found, c.off[cond], S, { called }).merged;
        const ml = fx.photoMerge({ t1, rIndex, products, xi }, found, c.off[cond], { called }).merged;
        r.may[cond] = codesOf(mm);
        r.lui[cond] = codesOf(ml);
        r.kind[`may|${cond}`] = fp.photoOutcome(mm).kind;
        r.kind[`lui|${cond}`] = fp.photoOutcome(ml).kind;
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
      methodRank(t1, rIC, c.rows, m, SERVER_K);
      ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    return p95(ms);
  };
  for (let w = 0; w < 2; w++) h3Node({}); // làm ấm
  const h3Base = h3Node({});

  const base = runMethod({});
  // ---- bảng nền ----
  const baseTable = {};
  for (const c of cases.filter((x) => ["B", "A", "7up", "muoi", "ruaypuan", "buldak"].includes(x.set))) {
    const r = base[keyOf(c)];
    baseTable[keyOf(c)] = r.none ? { none: true } : {
      sRank: c.code ? rankIn(r.S, c.code, SERVER_K) : null, foundRank: c.code ? rankIn(r.foundCodes, c.code) : null, S: r.S,
      ...Object.fromEntries(["may", "lui"].flatMap((p) => ["i", "ii"].map((cond) => [`${p}|${cond}`, { top1: r[p][cond][0] ?? null, rank: c.code ? rankIn(r[p][cond], c.code) : null, kind: r.kind[`${p}|${cond}`], top5: r[p][cond] }]))),
    };
  }
  const tally = (res, set, p, cond) => {
    const rs = cases.filter((c) => c.set === set);
    return { top1: rs.filter((c) => rankIn(res[keyOf(c)][p][cond], c.code) === 1).length, top5: rs.filter((c) => rankIn(res[keyOf(c)][p][cond], c.code) != null).length, n: rs.length };
  };
  const baseSum = {};
  for (const s of ["B", "A", "tong-B", "tong-A"]) for (const p of ["may", "lui"]) for (const cond of ["i", "ii"]) baseSum[`${p}|${s}|${cond}`] = tally(base, s, p, cond);
  // ruaypuan: hạng trong danh sách cả câu trên (c) (sâu 100) để đối chiếu bối cảnh "hạng 31"
  const ru = cases.find((c) => c.set === "ruaypuan");
  const bu = cases.find((c) => c.set === "buldak");
  const ruDeep = ru?.rows ? methodRank(t1, rIC, ru.rows, {}, 100) : null;
  const ruInfo = ru?.rows ? {
    rows: ru.rows.length, queryWords: ruDeep.query.length, rankDeep100: rankIn(ruDeep.hits.map((h) => h.code), RUAYPUAN_CODE, 100),
    serverCandidatesRank: Array.isArray(ru.serverCandidates) ? rankIn(ru.serverCandidates.map((x) => x.code), RUAYPUAN_CODE, SERVER_K) : null,
  } : null;
  const serverMatch = {};
  for (const c of [ru, bu]) if (c?.rows && Array.isArray(c.serverCandidates)) serverMatch[c.set] = JSON.stringify(c.serverCandidates.map((x) => x.code)) === JSON.stringify(base[keyOf(c)].S);
  const coverage = Object.fromEntries(["B", "A", "7up", "muoi", "ruaypuan", "buldak", "tong-B", "tong-A"].map((s) => {
    const rs = cases.filter((c) => c.set === s);
    return [s, { n: rs.length, coCau: rs.filter((c) => c.queries.length).length, duCau: rs.filter((c) => c.queries.length && c.allOk).length }];
  }));
  const l4Base = l4Score({ i: rankIn(base[keyOf(ru)]?.may?.i, RUAYPUAN_CODE), ii: rankIn(base[keyOf(ru)]?.may?.ii, RUAYPUAN_CODE) });
  const buldakBase = { i: base[keyOf(bu)]?.may?.i?.[0] ?? null, ii: base[keyOf(bu)]?.may?.ii?.[0] ?? null };

  const out = {
    at: new Date().toISOString(), ban, sha, dirty, srcSame, cacheOnly: true, azureCalls: 0, ocrRerunAB: false, catalogFile: dmFile, catalogN: lv.rows.length,
    confidenceRule: { ...fr.CONFIDENCE_RULE }, strangeMode: osx.STRANGE_MODE, coverage, baseSum, baseTable, ruInfo, serverMatch, buldakBase, l4Base,
    h3: { baseNodeP95: h3Base }, offStats: disk.stats,
  };
  const f = (v) => (v == null ? "-" : v);
  console.log(`sha ${sha} dirty ${dirty}; src/server/public trùng ${BASE_SHA}: ${srcSame}; OFF chỉ cache; độ phủ (đủ câu / có câu / số ca): ${Object.entries(coverage).map(([s, v]) => `${s} ${v.duCau}/${v.coCau}/${v.n}`).join(" | ")}`);
  console.log(`NỀN: ${Object.entries(baseSum).map(([k, v]) => `${k} ${v.top1}/${v.top5}`).join(" | ")}`);
  for (const [k, v] of Object.entries(baseTable)) {
    if (!k.startsWith("B|") && !k.startsWith("A|")) console.log(`  nền ${k}: S hạng ${f(v.sRank)}, T1 hạng ${f(v.foundRank)}; ${["may|i", "may|ii", "lui|i", "lui|ii"].map((x) => `${x} v1 ${f(v[x]?.top1)} hạng ${f(v[x]?.rank)} ${v[x]?.kind}`).join("; ")}`);
  }
  console.log(`  ruaypuan: ${JSON.stringify(ruInfo)}; S Node trùng candidates máy chủ: ${JSON.stringify(serverMatch)}; buldak nền vị trí 1 MÁY: ${JSON.stringify(buldakBase)}; H3 Node nền p95 ${h3Base?.toFixed(2)} ms`);

  if (!onlyBase) {
    const grid = methodGrid();
    const methods = {};
    for (const [name, m] of Object.entries(grid)) {
      const res = runMethod(m);
      const loss = {};
      const sums = {};
      const changed = {};
      for (const p of ["may", "lui"]) for (const s of ["B", "A"]) for (const cond of ["i", "ii"]) {
        const rs = cases.filter((c) => c.set === s);
        const rows = rs.map((c) => ({ code: c.code, base: rankIn(base[keyOf(c)][p][cond], c.code), got: rankIn(res[keyOf(c)][p][cond], c.code) }));
        loss[`${p}|${s}|${cond}`] = lossOf(rows);
        sums[`${p}|${s}|${cond}`] = { top1: rows.filter((r) => r.got === 1).length, top5: rows.filter((r) => r.got != null).length };
        changed[`${p}|${s}|${cond}`] = rows.filter((r) => r.base !== r.got).map((r) => `${r.code}:${f(r.base)}→${f(r.got)}`);
      }
      for (const s of ["tong-B", "tong-A"]) for (const p of ["may", "lui"]) for (const cond of ["i", "ii"]) sums[`${p}|${s}|${cond}`] = tally(res, s, p, cond);
      const s7 = {};
      const s7lui = {};
      for (const c of cases.filter((x) => x.set === "7up")) for (const cond of ["i", "ii"]) {
        s7[`may|${c.kind}|${cond}`] = rankIn(res[keyOf(c)].may[cond], CODE_7UP_DIET);
        s7lui[`${c.kind}|${cond}`] = { base: rankIn(base[keyOf(c)].lui[cond], CODE_7UP_DIET), got: rankIn(res[keyOf(c)].lui[cond], CODE_7UP_DIET) };
      }
      const rr = res[keyOf(bu)];
      const buldak = { i: { base: buldakBase.i, got: rr?.may?.i?.[0] ?? null }, ii: { base: buldakBase.ii, got: rr?.may?.ii?.[0] ?? null } };
      const buldakLui = { i: rr?.lui?.i?.[0] ?? null, ii: rr?.lui?.ii?.[0] ?? null };
      const rq = res[keyOf(ru)];
      const ruRanks = { i: rankIn(rq?.may?.i, RUAYPUAN_CODE), ii: rankIn(rq?.may?.ii, RUAYPUAN_CODE), S: rankIn(rq?.S, RUAYPUAN_CODE, SERVER_K), luiI: rankIn(rq?.lui?.i, RUAYPUAN_CODE), top5I: rq?.may?.i };
      const sc = res[keyOf(cases.find((x) => x.set === "muoi"))];
      const salt = sc.kind;
      const saltTop1 = { "may|i": sc.may.i[0] ?? null, "may|ii": sc.may.ii[0] ?? null, "lui|i": sc.lui.i[0] ?? null, "lui|ii": sc.lui.ii[0] ?? null };
      let sMax = 0;
      let fallbackOk = true;
      let fellBackN = 0;
      for (const c of cases) {
        const r = res[keyOf(c)];
        if (r.none) continue;
        sMax = Math.max(sMax, r.S.length, r.sRaw);
        if (r.fellBack) {
          fellBackN++;
          const b = base[keyOf(c)];
          if (JSON.stringify(r.S) !== JSON.stringify(b.S) || JSON.stringify(r.foundCodes) !== JSON.stringify(b.foundCodes)) fallbackOk = false;
        }
      }
      const h3n = h3Node(m);
      const h3Est = +(H3_PY_BASE_MS * (h3n / h3Base)).toFixed(1);
      const verdict = judge({ loss, s7, s7lui, buldak, salt, confidenceNull, sMax, fallbackOk, l7, h3Est, h2Est: H2_EST_MIB, offSame: true });
      const l4 = l4Score(ruRanks);
      methods[name] = { sums, changed, s7, s7lui, buldak, buldakLui, ruRanks, l4, saltTop1, salt, sMax, fellBackN, h3NodeP95: h3n, h3Est, verdict };
      process.stdout.write(".");
    }
    console.log("");
    const pick = pickMethod(Object.entries(methods).map(([name, v]) => ({ name, pass: v.verdict.pass, l4: v.l4 })), l4Base);
    const conclusion = !pick.name ? "KHÔNG CÁCH NÀO ĐẠT: không giữ gì"
      : pick.improves ? `CHỌN ${pick.name} (qua cổng, L4 ${JSON.stringify(methods[pick.name].l4)} hơn nền ${JSON.stringify(l4Base)})`
        : `KHÔNG CÁCH NÀO CẢI THIỆN L4: cách qua cổng tốt nhất ${pick.name} có L4 ${JSON.stringify(methods[pick.name].l4)} không hơn nền; không giữ gì`;
    Object.assign(out, { methods, pick, conclusion, memoSize: memo.size, offStats: disk.stats });
    for (const [name, v] of Object.entries(methods)) {
      const s = (k) => `${v.sums[k].top1}/${v.sums[k].top5}`;
      console.log(`${name.padEnd(22)} MÁY B ${s("may|B|i")} ${s("may|B|ii")} A ${s("may|A|i")} ${s("may|A|ii")} | LÙI B ${s("lui|B|i")} ${s("lui|B|ii")} A ${s("lui|A|i")} ${s("lui|A|ii")} | 7Up ${["may|may|i", "may|may|ii", "may|go|i", "may|go|ii"].map((k) => f(v.s7[k])).join("")} | buldak ${v.buldak.i.got === v.buldak.i.base ? "=" : "≠"}${v.buldak.ii.got === v.buldak.ii.base ? "=" : "≠"} | ruaypuan v ${f(v.ruRanks.i)}/${f(v.ruRanks.ii)} S ${f(v.ruRanks.S)} | tổng hợp MÁY ${s("may|tong-B|i")} ${s("may|tong-A|i")} | H3 ước ${v.h3Est} | ${v.verdict.pass ? "QUA" : "TRƯỢT " + Object.entries(v.verdict.gates).filter(([, ok]) => !ok).map(([g]) => g).join(",")}`);
    }
    console.log(`== Kết luận: ${conclusion}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  console.log(`OFF: ${JSON.stringify(disk.stats)}; Ghi: ${outFile}`);
}
