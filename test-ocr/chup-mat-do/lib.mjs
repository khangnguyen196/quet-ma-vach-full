// Phần thuần của đợt chup-mat-do (chụp mặt trước sản phẩm -> nhận ra sản phẩm).
// Không gọi mạng, không DOM, không import thư viện: dùng được trong Node (test) và trong trình duyệt (vòng 6).
//
// Đầu vào chung của các chiến lược từ khóa: danh sách dòng chữ OCR
//   [{ text: "MÌ OMACHI", h: 42, conf: 0.93 }, ...]
// h = chiều cao khung chữ (px, có thì dùng cho S1), conf = độ tin (0–1 hoặc 0–100, có thì dùng để lọc).

// ---------------------------------------------------------------------------
// Chuẩn hóa chữ
// ---------------------------------------------------------------------------

/** Bỏ dấu, viết thường, đ -> d, ký tự không phải chữ / số thành dấu cách, gộp khoảng trắng.
 *  Ví dụ: "Mì  Khoai-Tây ĐẬU" -> "mi khoai tay dau". */
export function normalizeText(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Các từ (đã chuẩn hóa) của một chuỗi. */
export function words(s) {
  const n = normalizeText(s);
  return n ? n.split(" ") : [];
}

// ---------------------------------------------------------------------------
// Chiến lược từ khóa S1 / S2 / S3
// ---------------------------------------------------------------------------

/** Số từ tối đa của một câu tìm (cả S1, S2, S3). CHỐT trước khi chạy đủ bộ ảnh, không chỉnh theo ảnh.
 *  Lý do chọn 3: kiểu tìm mặc định (cgi/search.pl, xem cors-check.mjs) đòi MỌI từ đều khớp: khi kiểm CORS,
 *  "omachi" ra 18 kết quả ở VN, "omachi mi khoai tay" ra 0. Chữ OCR có lẫn từ thừa, nên câu dài hay ra 0. */
export const MAX_WORDS = 3;
/** Dòng có độ tin thấp hơn mức này bị bỏ (chỉ khi OCR có trả độ tin). */
export const MIN_CONF = 0.5;
/** Dòng phải có ít nhất bấy nhiêu ký tự chữ (a–z sau chuẩn hóa). */
export const MIN_LETTERS = 3;

// Cụm từ chung trên bao bì, bỏ trước khi tách từ (đã chuẩn hóa không dấu).
export const STOP_PHRASES = [
  "khoi luong tinh", "khoi luong", "trong luong tinh", "trong luong", "the tich thuc", "the tich",
  "thanh phan", "net weight", "net wt", "net vol", "nha san xuat", "san xuat tai", "san xuat boi", "san xuat",
  "phan phoi boi", "phan phoi", "han su dung", "ngay san xuat", "xuat xu", "huong dan su dung", "huong dan",
  "bao quan", "made in", "viet nam", "vietnam", "san pham cua", "cong ty", "tnhh", "co phan", "thuc pham",
  "gia tri dinh duong", "nang luong", "khong chat bao quan", "hinh anh chi mang tinh chat minh hoa",
  "hinh anh minh hoa", "chi mang tinh chat minh hoa", "minh hoa",
];

// Từ đơn chung / đơn vị (đã chuẩn hóa).
export const STOP_WORDS = new Set([
  "va", "cua", "cho", "voi", "tai", "tu", "co", "la", "mot", "cac", "nhung", "trong", "khong", "duoc", "hon",
  "the", "and", "of", "with", "for", "in", "new", "moi", "net", "wt", "vol", "approx",
  "g", "gr", "gam", "gram", "grams", "kg", "mg", "ml", "l", "lit", "cl", "oz", "kcal", "kj", "x",
  "nsx", "hsd", "exp", "mfg", "date", "lot", "www", "com", "vn", "http", "https",
  "goi", "hop", "chai", "lon", "tui", "thung", "pack", "sp",
]);

const VOWEL = /[aeiouy]/;

/** Một từ có phải nhiễu không: số / số + đơn vị ("80g", "1,5l"), ít hơn 2 ký tự chữ, không có nguyên âm
 *  (rác OCR kiểu "rrr"), hoặc nằm trong STOP_WORDS. */
export function isNoiseWord(w) {
  if (!w) return true;
  if (STOP_WORDS.has(w)) return true;
  if (/^\d+$/.test(w)) return true;
  if (/^\d+(g|gr|gam|kg|mg|ml|l|lit|cl|oz|kcal|kj|x|goi|hop)$/.test(w)) return true; // 80g, 500ml, 2x (không bỏ "7up")
  const letters = w.replace(/[^a-z]/g, "");
  if (letters.length < 2) return true;
  if (!VOWEL.test(letters)) return true;
  return false;
}

/** Độ tin về khoảng 0–1 (tesseract trả 0–100). Không có -> null. */
export function confOf(line) {
  const c = Number(line?.conf);
  if (!Number.isFinite(c)) return null;
  return c > 1 ? c / 100 : c;
}

/** Bỏ các cụm STOP_PHRASES (khớp nguyên từ) khỏi chuỗi đã chuẩn hóa. */
export function stripPhrases(norm) {
  let s = ` ${norm} `;
  for (const p of STOP_PHRASES) s = s.split(` ${p} `).join(" ");
  // tách 2 lần để bắt cụm liền nhau dùng chung dấu cách
  for (const p of STOP_PHRASES) s = s.split(` ${p} `).join(" ");
  return s.replace(/\s+/g, " ").trim();
}

/** Các từ có nghĩa của một dòng (đã chuẩn hóa, bỏ cụm chung, bỏ từ nhiễu), giữ thứ tự. */
export function lineKeywords(text) {
  return stripPhrases(normalizeText(text)).split(" ").filter((w) => w && !isNoiseWord(w));
}

/** Dòng dùng được: đủ MIN_LETTERS ký tự chữ, độ tin (nếu có) ≥ MIN_CONF. */
export function usableLine(line) {
  const letters = normalizeText(line?.text).replace(/[^a-z]/g, "");
  if (letters.length < MIN_LETTERS) return false;
  const c = confOf(line);
  if (c != null && c < MIN_CONF) return false;
  return true;
}

/** Gom từ của các dòng theo thứ tự cho trước, bỏ trùng, tối đa max từ. */
function collect(lines, max) {
  const out = [];
  for (const l of lines) {
    for (const w of lineKeywords(l.text)) {
      if (!out.includes(w)) out.push(w);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** S1: các dòng có chữ cao nhất trước (h lớn -> nhỏ, bằng nhau giữ thứ tự đọc).
 *  OCR không có h (vd không có khung) thì giữ thứ tự đọc và ghi note. */
export function strategyS1(lines, max = MAX_WORDS) {
  const usable = lines.map((l, i) => ({ ...l, i })).filter(usableLine);
  const hasH = usable.some((l) => Number.isFinite(Number(l.h)) && Number(l.h) > 0);
  const sorted = hasH
    ? [...usable].sort((a, b) => (Number(b.h) || 0) - (Number(a.h) || 0) || a.i - b.i)
    : usable;
  return { words: collect(sorted, max), note: hasH ? "" : "không có chiều cao chữ, giữ thứ tự đọc" };
}

/** S2 (MẶC ĐỊNH): dòng dùng được theo thứ tự đọc, lọc nhiễu, tối đa max từ. */
export function strategyS2(lines, max = MAX_WORDS) {
  return { words: collect(lines.filter(usableLine), max), note: "" };
}

/** Thương hiệu nào (trong danh sách lấy từ Open Food Facts) xuất hiện nguyên từ trong chữ OCR.
 *  brands: mảng tên thương hiệu (chưa chuẩn hóa). Bỏ thương hiệu sau chuẩn hóa ngắn hơn 3 ký tự chữ
 *  hoặc chỉ gồm từ nhiễu. Trả danh sách đã chuẩn hóa, thương hiệu dài (nhiều ký tự) trước. */
export function findBrands(lines, brands) {
  const text = ` ${lines.filter(usableLine).map((l) => normalizeText(l.text)).join(" ")} `;
  const found = [];
  for (const b of brands || []) {
    const nb = normalizeText(b);
    if (nb.replace(/[^a-z]/g, "").length < 3) continue;
    if (nb.split(" ").every((w) => isNoiseWord(w))) continue;
    if (text.includes(` ${nb} `) && !found.includes(nb)) found.push(nb);
  }
  return found.sort((a, b) => b.length - a.length);
}

/** S3: như S2 nhưng từ của thương hiệu tìm thấy (findBrands) đứng đầu. */
export function strategyS3(lines, brands, max = MAX_WORDS) {
  const found = findBrands(lines, brands);
  const out = [];
  for (const b of found) {
    for (const w of b.split(" ")) {
      if (!isNoiseWord(w) && !out.includes(w) && out.length < max) out.push(w);
    }
  }
  for (const w of strategyS2(lines, Infinity).words) {
    if (out.length >= max) break;
    if (!out.includes(w)) out.push(w);
  }
  return { words: out, note: found.length ? `thương hiệu: ${found.join(", ")}` : "không thấy thương hiệu nào" };
}

/** Chạy cả 3 chiến lược. S2 là mặc định. */
export function allStrategies(lines, brands, max = MAX_WORDS) {
  return { S1: strategyS1(lines, max), S2: strategyS2(lines, max), S3: strategyS3(lines, brands, max) };
}
export const DEFAULT_STRATEGY = "S2";

// ---------------------------------------------------------------------------
// Chấm điểm
// ---------------------------------------------------------------------------

/** Ngưỡng trùng từ khi so tên / thương hiệu: số từ chung / số từ của chuỗi NGẮN hơn ≥ NAME_OVERLAP. */
export const NAME_OVERLAP = 0.5;

/** So mã vạch: chỉ chữ số, bỏ số 0 ở đầu (OFF có khi thêm 0 ở đầu mã). */
export function sameCode(a, b) {
  const n = (x) => String(x ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return n(a) !== "" && n(a) === n(b);
}

/** Vị trí (1..) của mã đúng trong danh sách mã, chỉ xét 5 đầu; không có -> null. */
export function rankOf(codes, truthCode, top = 5) {
  const i = (codes || []).slice(0, top).findIndex((c) => sameCode(c, truthCode));
  return i < 0 ? null : i + 1;
}

/** Hai chuỗi có "cùng tên" không: sau chuẩn hóa, chuỗi này chứa chuỗi kia (nguyên từ), hoặc số từ chung /
 *  số từ của chuỗi ngắn hơn ≥ NAME_OVERLAP. Chuỗi trống -> null (không chấm được). */
export function textMatch(a, b, threshold = NAME_OVERLAP) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return null;
  if (` ${na} `.includes(` ${nb} `) || ` ${nb} `.includes(` ${na} `)) return true;
  const wa = [...new Set(na.split(" "))];
  const wb = new Set(nb.split(" "));
  const common = wa.filter((w) => wb.has(w)).length;
  return common / Math.min(wa.length, wb.size) >= threshold;
}

/** Thương hiệu: OFF ghi nhiều thương hiệu cách nhau dấu phẩy; khớp một cái là đúng. */
export function brandMatch(offBrands, truthBrand) {
  if (!normalizeText(truthBrand)) return null;
  const list = String(offBrands ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return false;
  return list.some((b) => textMatch(b, truthBrand) === true);
}

/** Chấm một ảnh. hits: [{ code, name, brands }] (5 kết quả đầu), truth: { code, ten, thuong_hieu }. */
export function scoreHits(hits, truth) {
  const list = hits || [];
  const rank = rankOf(list.map((h) => h.code), truth.code);
  const top = list[0];
  return {
    rank,
    top1: rank === 1,
    inTop5: rank != null,
    nameOk: top ? textMatch(top.name, truth.ten) : (normalizeText(truth.ten) ? false : null),
    brandOk: top ? brandMatch(top.brands, truth.thuong_hieu) : (normalizeText(truth.thuong_hieu) ? false : null),
  };
}

/** Gộp điểm nhiều ảnh: số ảnh, đúng vị trí 1, trong 5 đầu, đúng tên / thương hiệu (chỉ đếm ảnh chấm được). */
export function summarize(scores) {
  const n = scores.length;
  const count = (f) => scores.filter(f).length;
  return {
    n,
    top1: count((s) => s.top1),
    top5: count((s) => s.inTop5),
    nameOk: count((s) => s.nameOk === true),
    nameN: count((s) => s.nameOk != null),
    brandOk: count((s) => s.brandOk === true),
    brandN: count((s) => s.brandOk != null),
  };
}

// ---------------------------------------------------------------------------
// Gộp xếp hạng RRF (vòng 3)
// ---------------------------------------------------------------------------

/** Reciprocal Rank Fusion: mỗi danh sách cộng 1 / (k + vị trí) cho từng mã (vị trí tính từ 1).
 *  lists: [[mã, ...], ...]. Trả [{ code, score }] điểm cao trước; bằng điểm thì mã xuất hiện sớm hơn trước. */
export function rrf(lists, k = 60) {
  const score = new Map();
  const first = new Map();
  let order = 0;
  for (const list of lists || []) {
    (list || []).forEach((code, i) => {
      const key = String(code);
      score.set(key, (score.get(key) || 0) + 1 / (k + i + 1));
      if (!first.has(key)) first.set(key, order++);
    });
  }
  return [...score.entries()]
    .map(([code, s]) => ({ code, score: s }))
    .sort((a, b) => b.score - a.score || first.get(a.code) - first.get(b.code));
}

// ---------------------------------------------------------------------------
// Thống kê nhỏ
// ---------------------------------------------------------------------------

export function median(arr) {
  const a = (arr || []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function maxOf(arr) {
  const a = (arr || []).filter((x) => Number.isFinite(x));
  return a.length ? Math.max(...a) : null;
}

// ---------------------------------------------------------------------------
// Chống ăn gian cho cách 2 (tìm theo hình)
// ---------------------------------------------------------------------------

/** Số ảnh (imgid) từ URL ảnh gốc OFF, vd ".../0543/3.jpg" -> "3". Không phải ảnh gốc -> null. */
export function imgidFromUrl(url) {
  const m = /\/(\d+)(?:\.\d+)?\.jpg(?:\?.*)?$/i.exec(String(url ?? ""));
  return m ? m[1] : null;
}

/** Các ảnh mặt trước đã chọn của sản phẩm (product.images["front_xx"]), ngôn ngữ vi trước, rồi en, rồi theo tên.
 *  Trả [{ key, lang, imgid, rev }]. */
export function frontImages(product) {
  const images = product?.images || {};
  const out = [];
  for (const [key, v] of Object.entries(images)) {
    const m = /^front(?:_([a-z]{2,3}))?$/.exec(key);
    if (!m || !v || v.imgid == null) continue;
    out.push({ key, lang: m[1] || "", imgid: String(v.imgid), rev: v.rev != null ? String(v.rev) : null });
  }
  const pri = (l) => (l === "vi" ? 0 : l === "en" ? 1 : 2);
  return out.sort((a, b) => pri(a.lang) - pri(b.lang) || a.key.localeCompare(b.key));
}

/** Ngưỡng gần trùng: khoảng cách Hamming của dHash 64 bit ≤ DHASH_NEAR thì coi là cùng một ảnh. */
export const DHASH_NEAR = 10;

/** dHash 64 bit từ ảnh xám 9×8 (mảng 72 số, hàng trên xuống, trái sang phải): bit = điểm trái sáng hơn điểm phải.
 *  Trả chuỗi 16 ký tự hex. */
export function dHashFromGray(gray) {
  if (!gray || gray.length !== 72) throw new Error("dHash cần đúng 9×8 = 72 điểm xám");
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? "1" : "0";
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Khoảng cách Hamming giữa 2 mã băm hex cùng độ dài. */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) throw new Error("hai mã băm phải cùng độ dài");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Luật chọn ảnh chỉ mục cho một mã thử.
 *  fronts: frontImages(product); testImgid: imgid của front.jpg; hashes: { [imgid]: dHash hex } của ảnh ứng viên;
 *  testHash: dHash của front.jpg.
 *  Ứng viên bị loại nếu: cùng imgid với front.jpg, chưa có mã băm, hoặc Hamming ≤ threshold (gần trùng).
 *  Trả { chosen: { key, imgid, distance } | null, rejected: [{ key, imgid, reason, distance? }] }. */
export function chooseIndexImage(fronts, testImgid, hashes, testHash, threshold = DHASH_NEAR) {
  const rejected = [];
  const seen = new Set();
  for (const f of fronts || []) {
    if (testImgid != null && String(f.imgid) === String(testImgid)) {
      rejected.push({ key: f.key, imgid: f.imgid, reason: "cùng imgid với front.jpg" });
      continue;
    }
    if (seen.has(f.imgid)) { rejected.push({ key: f.key, imgid: f.imgid, reason: "trùng imgid với ứng viên trước" }); continue; }
    seen.add(f.imgid);
    const h = hashes?.[f.imgid];
    if (!h || !testHash) { rejected.push({ key: f.key, imgid: f.imgid, reason: "không có mã băm" }); continue; }
    const distance = hamming(h, testHash);
    if (distance <= threshold) { rejected.push({ key: f.key, imgid: f.imgid, reason: "gần trùng front.jpg", distance }); continue; }
    return { chosen: { key: f.key, imgid: f.imgid, distance }, rejected };
  }
  return { chosen: null, rejected };
}

// ---------------------------------------------------------------------------
// CSV (đọc truth.csv, NGUON.csv)
// ---------------------------------------------------------------------------

/** Đọc CSV kiểu module csv của Python (ô có dấu phẩy / xuống dòng bọc nháy kép, "" là 1 nháy).
 *  Trả mảng object theo dòng tiêu đề. Bỏ BOM đầu file và dòng trống. */
export function parseCsv(text) {
  const s = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== "")) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
