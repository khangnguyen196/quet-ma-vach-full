// "Chụp mặt trước" (đợt kho-lon vòng 4): ỨNG VIÊN MÁY CHỦ — phần thuần. Máy chủ OCR (server/app.py, danh mục mức (c)
// 532.732 sản phẩm Open Food Facts) trả thêm "candidates" (≤ 10 mục) cùng chữ đọc được; app dùng làm nguồn chính.
// Không DOM, không import thư viện, không gọi mạng (main.js và sendOcr của front-photo.js gọi các hàm dưới).
//
// Ví dụ (như main.js):
//   const S = r.candidates;                       // sendOcr đã làm sạch bằng serverCandidates(body)
//   if (S.length) {
//     const { merged, offFailed } = serverMerge({ t1, rIndex, products }, found, off, S, { called: true });
//   } // S rỗng: đường cũ (photoMerge + kho phụ 893 + OFF)
import { mergeFront, isGuardError } from "./front-merge.js";
import { frontImageUrl } from "./front-search.js";
import { joinExtra } from "./front-extra.js";

/** Số ứng viên máy chủ tối đa app nhận (bằng SERVER_K của khung đo / máy chủ). */
export const SERVER_MAX = 10;
export const SERVER_TEXT_MAX = 2000;
export const SERVER_NAME_MAX = 200;

/**
 * Tùy chọn gộp G2-g3-w3 (đã chốt ở đợt kho-lon vòng 3, luật chọn trong test-ocr/chup-mat-do/kho-lon-do.mjs): lớp chặn
 * mặc định + offPromote { gap: 3, minWords: 3 } chỉ cho mục máy chủ (mục OFF không trùng mã máy chủ mang extra: true nên
 * không bao giờ được đẩy). Đây là chỗ DUY NHẤT trong app truyền tùy chọn cho mergeFront (luật đọc nguồn (5)).
 */
export const SERVER_MERGE_OPTS = Object.freeze({ offPromote: Object.freeze({ gap: 3, minWords: 3 }) });

const CODE_RE = /^\d{8,14}$/;

/** Cắt chuỗi tối đa n ký tự (theo ký tự Unicode, không cắt đôi cặp surrogate). */
function cut(s, n) {
  if (s.length <= n) return s;
  return Array.from(s).slice(0, n).join("");
}

/**
 * body (JSON của /ocr) → mảng ứng viên sạch, hoặc [] (không có khóa / không phải mảng / máy chủ cũ / tìm lỗi).
 * Chỉ xét tối đa SERVER_MAX phần tử đầu. Mỗi mục phải có: code chuỗi 8–14 chữ số; name, brand, text, grp là chuỗi; score
 * là số hữu hạn. Sai dạng → bỏ mục; trùng mã → giữ mục đầu. Cắt text ≤ 2.000, name / brand ≤ 200 ký tự.
 * Ra { code, name, brand, img, vn, text, grp, score } (dạng mục máy chủ của khung đo kho-lon-do.mjs).
 * img: CHỈ là khóa ảnh của danh mục (vd "front_vi.3"), app tự dựng URL images.openfoodfacts.org bằng frontImageUrl;
 * khóa sai / URL bất kỳ → "" (không bao giờ nhận URL ảnh từ máy chủ).
 * Ví dụ: serverCandidates({ candidates: [{ code: "8934588752117", name: "7Up", brand: "", img: "front_vi.3", text: "7Up",
 *   grp: "893", score: 21.4 }] }) → [{ code: "8934588752117", …, img: "https://images.openfoodfacts.org/…", vn: false }]
 */
export function serverCandidates(body) {
  const list = body && typeof body === "object" ? body.candidates : null;
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const c of list.slice(0, SERVER_MAX)) {
    if (!c || typeof c !== "object") continue;
    const { code, name, brand, text, grp, score, img } = c;
    if (typeof code !== "string" || !CODE_RE.test(code)) continue;
    if (typeof name !== "string" || typeof brand !== "string" || typeof text !== "string" || typeof grp !== "string") continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      name: cut(name, SERVER_NAME_MAX),
      brand: cut(brand, SERVER_NAME_MAX),
      img: frontImageUrl(code, img),
      vn: grp === "vn",
      text: cut(text, SERVER_TEXT_MAX),
      grp,
      score,
    });
  }
  return out;
}

/**
 * Gộp T1 (danh mục 1.452 trong app) + ứng viên máy chủ S + OFF theo cách G2-g3-w3 = ĐÚNG phép gộp kind "g2" của
 * mergeByMethod (test-ocr/chup-mat-do/kho-lon-do.mjs; test so trùng ở tests/front-server.test.js):
 * mục OFF có mã KHÔNG nằm trong S mang extra: true (không được offPromote đẩy); mục có mã trong S (kể cả trùng OFF) là
 * mục máy chủ (không extra); joinExtra(OFF đã đánh dấu, S) rồi mergeFront(…, SERVER_MERGE_OPTS).
 * ctx = { t1, rIndex, products }; found = rankFromItems; off = joinOffResults(…) ({ ok: false, kind: "none" } khi không
 * có câu tìm); S = serverCandidates(…) có ≥ 1 mục (S rỗng thì main.js KHÔNG gọi hàm này mà đi đường cũ photoMerge).
 * opts.called: đã gọi mạng tìm OFF chưa (như photoMerge).
 * Trả { merged (≤ 5 mục, mục máy chủ / OFF có source "off"), offFailed (tính trên off GỐC như photoMerge) }.
 * Lỗi giá trị chặn (GuardValueError) → console.error rồi kết quả T1; lỗi khác ném tiếp.
 */
export function serverMerge({ t1, rIndex, products }, found, off, S, { called } = {}) {
  const server = Array.isArray(S) ? S : [];
  const sCodes = new Set(server.map((h) => h.code));
  const offMarked = off && off.ok === true && Array.isArray(off.hits)
    ? { ...off, hits: off.hits.map((h) => { const { extra, ...rest } = h; return sCodes.has(h.code) ? rest : { ...rest, extra: true }; }) }
    : off;
  const joined = joinExtra(offMarked, server.map(({ extra, ...h }) => h));
  const didCall = typeof called === "boolean" ? called : !!(off && typeof off === "object" && off.kind !== "none");
  const offFailed = didCall && !(off && off.ok === true);
  let merged;
  try {
    merged = mergeFront(t1, rIndex, products, found, joined, SERVER_MERGE_OPTS);
  } catch (e) {
    if (!isGuardError(e)) throw e;
    console.error(e);
    merged = mergeFront(t1, rIndex, products, found, null); // = đúng kết quả T1
  }
  return { merged, offFailed };
}
