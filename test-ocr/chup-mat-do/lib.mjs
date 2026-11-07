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

/** Ngưỡng trùng từ khi so tên / thương hiệu: số từ chung / số từ có nghĩa của ĐÁP ÁN ≥ NAME_OVERLAP. */
export const NAME_OVERLAP = 0.5;
/** Từ chung phải dài ít nhất bấy nhiêu chữ cái (a–z) thì mới tính là khớp có nghĩa. */
export const NAME_MIN_LETTERS = 3;
/** Từ / cụm chỉ loại hàng hoặc bao bì (đã chuẩn hóa không dấu), bỏ khỏi cả hai chuỗi trước khi so tên.
 *  Danh sách CỐ ĐỊNH (chốt vòng 2 trước khi chạy lại), không chỉnh theo kết quả. */
export const CATEGORY_WORDS = [
  "ca phe", "cafe", "mi", "banh", "sua", "nuoc", "keo", "snack", "vi", "tra", "hat",
  "goi", "hop", "chai", "lon", "tui", "thung",
];

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

/** Từ có nghĩa để so tên: chuẩn hóa (ký tự điều khiển / dấu câu thành dấu cách, bỏ dấu), bỏ cụm CATEGORY_WORDS,
 *  bỏ từ nhiễu (isNoiseWord: số, đơn vị, từ chung). Bỏ hết mà trống thì giữ các từ đã chuẩn hóa (vd "Sữa"). */
export function nameWords(s) {
  const n = normalizeText(s);
  if (!n) return [];
  let t = ` ${n} `;
  for (const c of CATEGORY_WORDS) t = t.split(` ${c} `).join(" ");
  for (const c of CATEGORY_WORDS) t = t.split(` ${c} `).join(" ");
  const kept = t.trim().split(/\s+/).filter((w) => w && !isNoiseWord(w));
  return [...new Set(kept.length ? kept : n.split(" "))];
}

const letterCount = (w) => w.replace(/[^a-z]/g, "").length;

/** Tên / thương hiệu `a` (kết quả tìm) có khớp ĐÁP ÁN `b` không (luật vòng 2):
 *  số từ chung / số từ có nghĩa của đáp án ≥ threshold, VÀ có ít nhất 1 từ chung dài ≥ NAME_MIN_LETTERS chữ cái.
 *  Riêng đáp án không có từ nào dài ≥ NAME_MIN_LETTERS chữ cái (vd "7UP", "TH") thì phải trùng hết từ của đáp án.
 *  Không còn luật "chứa nhau". Chuỗi trống -> null (không chấm được). */
export function textMatch(a, b, threshold = NAME_OVERLAP) {
  const wb = nameWords(b);
  // bên kết quả chỉ cần tập từ đã chuẩn hóa: từ chung luôn thuộc wb (đã bỏ loại hàng / nhiễu)
  const sa = new Set(words(a));
  if (!sa.size || !wb.length) return null;
  const common = wb.filter((w) => sa.has(w));
  if (!wb.some((w) => letterCount(w) >= NAME_MIN_LETTERS)) return common.length === wb.length;
  return common.length / wb.length >= threshold && common.some((w) => letterCount(w) >= NAME_MIN_LETTERS);
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

// ---- So ảnh ít phụ thuộc khung cắt (vòng 2) ----
// Lý do: vòng 1 so dHash của CẢ khung ảnh, nên cùng một tấm chụp nhưng OFF cắt khác (front_xx là bản cắt của ảnh
// gốc) có thể cách > 10 bit và lọt vào chỉ mục. Vòng 2: cắt vùng giữa 100 / 90 / 80 / 70 % của CẢ HAI ảnh, lấy
// khoảng cách nhỏ nhất của mọi cặp, cho cả dHash và pHash.

/** Tỉ lệ cắt vùng giữa dùng khi so. */
export const CROP_LEVELS = [1, 0.9, 0.8, 0.7];
/** ≤ HASH_DUP bit (trên 64): coi là cùng ảnh, loại tự động. */
export const HASH_DUP = 10;
/** HASH_DUP < khoảng cách ≤ HASH_SUSPECT: nghi ngờ, bắt buộc xem tay. */
export const HASH_SUSPECT = 24;

/** Thu ảnh xám (mảng w×h, hàng trên xuống) về outW×outH bằng trung bình vùng (area average), chỉ lấy vùng giữa
 *  tỉ lệ crop (0–1] theo mỗi chiều. Dùng chung cho dHash (9×8) và pHash (32×32). */
export function resizeGray(gray, w, h, outW, outH, crop = 1) {
  if (!gray || gray.length !== w * h) throw new Error("ảnh xám phải có đúng w×h điểm");
  const cw = w * crop;
  const ch = h * crop;
  const x0 = (w - cw) / 2;
  const y0 = (h - ch) / 2;
  const out = new Array(outW * outH);
  for (let oy = 0; oy < outH; oy++) {
    const ya = y0 + (oy * ch) / outH;
    const yb = y0 + ((oy + 1) * ch) / outH;
    for (let ox = 0; ox < outW; ox++) {
      const xa = x0 + (ox * cw) / outW;
      const xb = x0 + ((ox + 1) * cw) / outW;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        const wy = Math.min(yb, y + 1) - Math.max(ya, y);
        if (wy <= 0) continue;
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const wx = Math.min(xb, x + 1) - Math.max(xa, x);
          if (wx <= 0) continue;
          sum += gray[Math.min(h - 1, y) * w + Math.min(w - 1, x)] * wx * wy;
          area += wx * wy;
        }
      }
      out[oy * outW + ox] = area ? sum / area : 0;
    }
  }
  return out;
}

/** pHash 64 bit tự viết: ảnh xám 32×32 -> DCT-II 2 chiều -> 8×8 hệ số tần số thấp (góc trên trái) ->
 *  bit = hệ số lớn hơn trung vị của 64 hệ số. Trả 16 ký tự hex. */
export function pHashFromGray(gray) {
  const N = 32;
  if (!gray || gray.length !== N * N) throw new Error("pHash cần đúng 32×32 = 1024 điểm xám");
  const cos = [];
  for (let u = 0; u < 8; u++) {
    cos.push(Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))));
  }
  const coef = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) {
        const cy = cos[v][y];
        for (let x = 0; x < N; x++) s += gray[y * N + x] * cos[u][x] * cy;
      }
      coef.push(s);
    }
  }
  const med = median(coef);
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 1) | (coef[i + j] > med ? 1 : 0);
    hex += n.toString(16);
  }
  return hex;
}

/** Bộ mã băm của một ảnh xám w×h: với mỗi mức cắt CROP_LEVELS có { crop, d: dHash, p: pHash }. */
export function cropHashSet(gray, w, h, levels = CROP_LEVELS) {
  return levels.map((crop) => ({
    crop,
    d: dHashFromGray(resizeGray(gray, w, h, 9, 8, crop)),
    p: pHashFromGray(resizeGray(gray, w, h, 32, 32, crop)),
  }));
}

/** So 2 bộ mã băm: khoảng cách nhỏ nhất của mọi cặp mức cắt, riêng dHash (dMin) và pHash (pMin);
 *  distance = min(dMin, pMin). verdict: "trùng" (≤ dup) | "nghi ngờ" (≤ suspect, phải xem tay) | "khác". */
export function compareHashSets(a, b, { dup = HASH_DUP, suspect = HASH_SUSPECT } = {}) {
  let dMin = Infinity;
  let pMin = Infinity;
  let dPair = null;
  let pPair = null;
  for (const x of a || []) {
    for (const y of b || []) {
      const dd = hamming(x.d, y.d);
      const pp = hamming(x.p, y.p);
      if (dd < dMin) { dMin = dd; dPair = [x.crop, y.crop]; }
      if (pp < pMin) { pMin = pp; pPair = [x.crop, y.crop]; }
    }
  }
  if (!Number.isFinite(dMin)) return null;
  const distance = Math.min(dMin, pMin);
  const verdict = distance <= dup ? "trùng" : distance <= suspect ? "nghi ngờ" : "khác";
  return { dMin, pMin, dPair, pPair, distance, verdict };
}

/** Mọi ảnh của một sản phẩm OFF thành danh sách phẳng [{ code, key, imgid }]: ảnh gốc (khóa là số, imgid = khóa)
 *  và bản cắt đã chọn (front_xx, ingredients_xx…, imgid trỏ về ảnh gốc). */
export function productImageList(code, product) {
  const out = [];
  for (const [key, v] of Object.entries(product?.images || {})) {
    if (/^\d+$/.test(key)) out.push({ code: String(code), key, imgid: key });
    else if (v && v.imgid != null) out.push({ code: String(code), key, imgid: String(v.imgid) });
  }
  return out;
}

/** Bỏ mọi ảnh trùng imgid với front.jpg của mã thử (kể cả bản cắt front_xx trỏ về imgid đó).
 *  images: [{ code, key, imgid }]; testImgids: { [mã]: imgid | [imgid...] } (hoặc Map). Mã không có trong
 *  testImgids giữ nguyên. Trả { kept, removed }. Vòng 3 dùng để dựng chỉ mục. */
export function excludeTestImgids(images, testImgids) {
  const get = (c) => (testImgids instanceof Map ? testImgids.get(c) : testImgids?.[c]);
  const kept = [];
  const removed = [];
  for (const im of images || []) {
    const t = get(String(im.code));
    const list = (Array.isArray(t) ? t : t == null ? [] : [t]).map(String);
    if (list.includes(String(im.imgid))) removed.push(im);
    else kept.push(im);
  }
  return { kept, removed };
}

/** Luật chọn ảnh chỉ mục (vòng 2): như chooseIndexImage nhưng so bằng compareHashSets (nhiều mức cắt, dHash + pHash)
 *  và có kết quả xem tay.
 *  fronts: frontImages(product); testImgid; sets: { [imgid]: cropHashSet }; testSet: cropHashSet của front.jpg;
 *  manual: { [imgid]: { verdict: "trùng" | "khác", note } } (xem tay).
 *  Loại: "cùng imgid" | "gần trùng x bit" | "xem tay: cùng tấm chụp" | "nghi ngờ x bit, chưa xem tay" | "không có mã băm".
 *  Trả { chosen: { key, imgid, compare, manual } | null, rejected: [...] }. */
export function chooseIndexImageV2(fronts, testImgid, sets, testSet, manual = {}, opts = {}) {
  const rejected = [];
  const seen = new Set();
  for (const f of fronts || []) {
    if (testImgid != null && String(f.imgid) === String(testImgid)) {
      rejected.push({ key: f.key, imgid: f.imgid, reason: "cùng imgid" });
      continue;
    }
    if (seen.has(f.imgid)) { rejected.push({ key: f.key, imgid: f.imgid, reason: "trùng imgid với ứng viên trước" }); continue; }
    seen.add(f.imgid);
    const s = sets?.[f.imgid];
    if (!s || !testSet) { rejected.push({ key: f.key, imgid: f.imgid, reason: "không có mã băm" }); continue; }
    const compare = compareHashSets(s, testSet, opts);
    if (compare.verdict === "trùng") {
      rejected.push({ key: f.key, imgid: f.imgid, reason: `gần trùng ${compare.distance} bit`, compare });
      continue;
    }
    const m = manual?.[f.imgid];
    if (m?.verdict === "trùng") {
      rejected.push({ key: f.key, imgid: f.imgid, reason: "xem tay: cùng tấm chụp", compare, manual: m });
      continue;
    }
    if (compare.verdict === "nghi ngờ" && m?.verdict !== "khác") {
      rejected.push({ key: f.key, imgid: f.imgid, reason: `nghi ngờ ${compare.distance} bit, chưa xem tay`, compare });
      continue;
    }
    return { chosen: { key: f.key, imgid: f.imgid, compare, manual: m ?? null }, rejected };
  }
  return { chosen: null, rejected };
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
