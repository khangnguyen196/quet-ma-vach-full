// Phần thuần của vòng 3 (chup-mat-do): đọc bản xuất JSONL của Open Food Facts, lọc sản phẩm bán ở Việt Nam,
// chọn sản phẩm cho chỉ mục ảnh, dựng bộ phụ leave-one-out, BM25 cho danh mục chữ (T1).
// Không gọi mạng, không DOM, không thư viện ngoài. Dùng được trong trình duyệt (t1.mjs đo BM25 trong trang):
// node:readline chỉ nạp động trong filterVnStream (chạy ở Node).
import { normalizeText, isNoiseWord, stripPhrases, usableLine, excludeTestImgids, frontImages } from "./lib.mjs";

// ---------------------------------------------------------------------------
// Lọc VN từ bản xuất JSONL
// ---------------------------------------------------------------------------

/** Ảnh mặt trước đã chọn của một sản phẩm, đọc được cả 2 kiểu dữ liệu ảnh của OFF:
 *  - kiểu cũ (API v2): images.front_xx = { imgid, rev };
 *  - kiểu mới (bản xuất 11/2026): images.selected.front.xx = { imgid, rev }.
 *  Trả [{ key: "front_xx", lang, imgid, rev }] theo thứ tự frontImages (vi, en, rồi theo tên). */
export function productFronts(product) {
  const images = product?.images || {};
  const legacy = {};
  for (const [k, v] of Object.entries(images)) if (/^front(_[a-z]{2,3})?$/.test(k)) legacy[k] = v;
  const sel = images?.selected?.front;
  if (sel && typeof sel === "object") {
    for (const [lang, v] of Object.entries(sel)) if (v && v.imgid != null && !legacy[`front_${lang}`]) legacy[`front_${lang}`] = v;
  }
  return frontImages({ images: legacy });
}

/** Mọi imgid ảnh gốc (đã tải lên) của sản phẩm, cả 2 kiểu dữ liệu. */
export function uploadedImgids(product) {
  const images = product?.images || {};
  const ids = new Set();
  for (const k of Object.keys(images)) if (/^\d+$/.test(k)) ids.add(k);
  for (const k of Object.keys(images?.uploaded || {})) if (/^\d+$/.test(k)) ids.add(k);
  return [...ids];
}

/** Sản phẩm có bán ở VN không (countries_tags chứa en:vietnam). */
export function isVn(product) {
  return Array.isArray(product?.countries_tags) && product.countries_tags.includes("en:vietnam");
}

/** Bản ghi gọn của một sản phẩm VN: mã, mọi product_name* / generic_name*, brands, unique_scans_n, completeness, ảnh mặt trước. */
export function vnRecord(product) {
  const names = {};
  const generic = {};
  for (const [k, v] of Object.entries(product || {})) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (/^product_name(_[a-z]{2,3})?$/.test(k)) names[k] = v.trim();
    else if (/^generic_name(_[a-z]{2,3})?$/.test(k)) generic[k] = v.trim();
  }
  const n = (x) => (Number.isFinite(Number(x)) && x !== null && x !== "" ? Number(x) : null);
  return {
    code: String(product?.code ?? ""),
    names,
    generic,
    brands: typeof product?.brands === "string" ? product.brands : Array.isArray(product?.brands) ? product.brands.join(", ") : "",
    unique_scans_n: n(product?.unique_scans_n),
    completeness: n(product?.completeness),
    fronts: productFronts(product).map((f) => ({ key: f.key, imgid: f.imgid, rev: f.rev })),
    uploaded: uploadedImgids(product).length,
  };
}

/** Một dòng JSONL -> bản ghi VN hoặc null (không phải VN / dòng hỏng). Lọc nhanh bằng chuỗi trước khi JSON.parse. */
export function vnRecordFromLine(line) {
  if (!line || !line.includes("en:vietnam")) return null;
  let p;
  try { p = JSON.parse(line); } catch { return null; }
  return isVn(p) ? vnRecord(p) : null;
}

/** Đọc luồng chữ JSONL (đã giải nén), trả { records, lines, bad }. onProgress(lines) gọi mỗi 500.000 dòng. */
export async function filterVnStream(stream, { onProgress = () => {} } = {}) {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const records = [];
  let lines = 0;
  for await (const line of rl) {
    lines++;
    if (lines % 500000 === 0) onProgress(lines);
    const r = vnRecordFromLine(line);
    if (r && r.code) records.push(r);
  }
  return { records, lines };
}

// ---------------------------------------------------------------------------
// Chọn sản phẩm cho chỉ mục ảnh (luật CHỐT vòng 3)
// ---------------------------------------------------------------------------

/** Thứ tự xếp hạng đã chốt: unique_scans_n giảm dần (không có = sau cùng), rồi completeness giảm dần, rồi mã tăng dần. */
export function rankCompare(a, b) {
  const sa = a.unique_scans_n ?? -1;
  const sb = b.unique_scans_n ?? -1;
  if (sa !== sb) return sb - sa;
  const ca = a.completeness ?? -1;
  const cb = b.completeness ?? -1;
  if (ca !== cb) return cb - ca;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/** Chọn sản phẩm + ảnh cho chỉ mục ảnh.
 *  records: bản ghi VN (vnRecord); testCodes: mọi mã thử (31); testImgids: { mã: imgid front.jpg };
 *  testUsable: { mã: imgid ảnh chỉ mục đã qua chống ăn gian } (2 + 1 phụ); n: tổng số sản phẩm (gồm mã thử dùng được).
 *  Mã thử chỉ dùng ảnh trong testUsable (không có thì không đưa vào); sản phẩm thường dùng front_xx đầu tiên
 *  (frontImages) sau khi bỏ mọi ảnh trùng imgid front.jpg của mã thử (excludeTestImgids).
 *  Trả [{ code, imgid, key, test: bool }]. */
export function selectIndexProducts(records, { testCodes = [], testImgids = {}, testUsable = {}, n = 1000 } = {}) {
  const tests = new Set(testCodes.map(String));
  const out = [];
  const byCode = new Map(records.map((r) => [r.code, r]));
  for (const [code, imgid] of Object.entries(testUsable)) {
    if (out.length >= n) break;
    const r = byCode.get(String(code));
    // ảnh chỉ mục của mã thử không được trùng imgid front.jpg (phòng nhầm dữ liệu đầu vào)
    const { kept } = excludeTestImgids([{ code: String(code), key: "chosen", imgid: String(imgid) }], testImgids);
    if (!kept.length) continue;
    out.push({ code: String(code), imgid: String(imgid), key: "chong-an-gian", test: true, inVnDump: !!r });
  }
  const rest = records.filter((r) => !tests.has(r.code) && r.fronts?.length).sort(rankCompare);
  for (const r of rest) {
    if (out.length >= n) break;
    const imgs = r.fronts.map((f) => ({ code: r.code, key: f.key, imgid: f.imgid }));
    const { kept } = excludeTestImgids(imgs, testImgids);
    if (!kept.length) continue;
    out.push({ code: r.code, imgid: kept[0].imgid, key: kept[0].key, test: false });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bộ phụ leave-one-out
// ---------------------------------------------------------------------------

/** Ứng viên cặp leave-one-out: sản phẩm thường trong chỉ mục có ≥ 2 ảnh front_xx khác imgid.
 *  Ảnh chỉ mục = front_xx đầu tiên (đúng ảnh đang ở chỉ mục), ảnh truy vấn = front_xx đầu tiên có imgid khác.
 *  Giữ thứ tự của `selected` (đã xếp hạng). Trả [{ code, indexImgid, queryImgid }]. */
export function looCandidates(selected, records, testCodes = []) {
  const tests = new Set(testCodes.map(String));
  const byCode = new Map(records.map((r) => [r.code, r]));
  const out = [];
  for (const s of selected) {
    if (s.test || tests.has(s.code)) continue;
    const r = byCode.get(s.code);
    if (!r) continue;
    const q = r.fronts.find((f) => String(f.imgid) !== String(s.imgid));
    if (!q) continue;
    out.push({ code: s.code, indexImgid: String(s.imgid), queryImgid: String(q.imgid) });
  }
  return out;
}

/** Lọc cặp theo khoảng cách ảnh (compareHashSets.distance): ≤ maxDup bit thì loại, còn lại dùng; tối đa limit cặp.
 *  distances: { [code]: number | null } (null = không tính được, loại). Trả { pairs, dropped }. */
export function filterLooPairs(cands, distances, { maxDup = 24, limit = 100 } = {}) {
  const pairs = [];
  const dropped = [];
  for (const c of cands) {
    const d = distances?.[c.code];
    if (d == null) { dropped.push({ ...c, reason: "không tính được mã băm" }); continue; }
    if (d <= maxDup) { dropped.push({ ...c, distance: d, reason: `gần trùng ${d} bit` }); continue; }
    if (pairs.length < limit) pairs.push({ ...c, distance: d });
  }
  return { pairs, dropped };
}

/** Kiểm cặp: ảnh truy vấn KHÔNG nằm trong chỉ mục (không có mục nào cùng mã + cùng imgid). */
export function queryNotInIndex(pairs, index) {
  const keys = new Set(index.map((x) => `${x.code}/${x.imgid}`));
  return pairs.every((p) => !keys.has(`${p.code}/${p.queryImgid}`));
}

// ---------------------------------------------------------------------------
// Bộ phụ mở rộng (vòng 4, luật CHỐT ở tong-hop-v4.md): sản phẩm ngoài VN có ≥ 2 ảnh mặt trước khác imgid
// ---------------------------------------------------------------------------

/** Nước ưu tiên (Đông Nam Á / Đông Á), đúng thứ tự CHỐT. */
export const EXT_PRIORITY_COUNTRIES = [
  "en:thailand", "en:indonesia", "en:malaysia", "en:philippines", "en:singapore", "en:cambodia", "en:laos",
  "en:myanmar", "en:japan", "en:south-korea", "en:china", "en:taiwan", "en:hong-kong",
];

/** Số imgid khác nhau trong các ảnh mặt trước của bản ghi (vnRecord). */
export function distinctFrontCount(r) {
  return new Set((r?.fronts || []).map((f) => String(f.imgid))).size;
}

/** Một sản phẩm (đã JSON.parse) -> ứng viên bộ phụ mở rộng hoặc null.
 *  Ứng viên: KHÔNG có en:vietnam, KHÔNG thuộc mã thử, có ≥ 2 ảnh front_xx khác imgid.
 *  Trả bản ghi vnRecord + { group: 0 (có nước ưu tiên) | 1 (nhóm còn lại), priorityTags: [...] }. */
export function extCandidate(product, testCodes = new Set()) {
  if (!product || isVn(product)) return null;
  const code = String(product.code ?? "");
  if (!code || testCodes.has(code)) return null;
  const r = vnRecord(product);
  if (distinctFrontCount(r) < 2) return null;
  const tags = Array.isArray(product.countries_tags) ? product.countries_tags : [];
  const priorityTags = EXT_PRIORITY_COUNTRIES.filter((c) => tags.includes(c));
  return { ...r, group: priorityTags.length ? 0 : 1, priorityTags };
}

/** Một dòng JSONL -> ứng viên hoặc null. priorityOnly: chỉ JSON.parse dòng có chuỗi một nước ưu tiên (lọc nhanh). */
export function extCandidateFromLine(line, testCodes = new Set(), { priorityOnly = true } = {}) {
  if (!line) return null;
  if (priorityOnly && !EXT_PRIORITY_COUNTRIES.some((c) => line.includes(`"${c}"`))) return null;
  let p;
  try { p = JSON.parse(line); } catch { return null; }
  const c = extCandidate(p, testCodes);
  if (!c || (priorityOnly && c.group !== 0)) return null;
  return c;
}

/** Thứ tự CHỐT: nhóm ưu tiên trước, trong nhóm như rankCompare (unique_scans_n, completeness giảm dần, mã tăng dần). */
export function extRankCompare(a, b) {
  return (a.group ?? 1) - (b.group ?? 1) || rankCompare(a, b);
}

/** Cặp của ứng viên: ảnh chỉ mục = front_xx đầu tiên, ảnh truy vấn = front_xx đầu tiên có imgid khác. */
export function extPair(r) {
  const fronts = r?.fronts || [];
  if (!fronts.length) return null;
  const idx = String(fronts[0].imgid);
  const q = fronts.find((f) => String(f.imgid) !== idx);
  return q ? { code: r.code, indexImgid: idx, queryImgid: String(q.imgid) } : null;
}

// ---------------------------------------------------------------------------
// BM25 (T1)
// ---------------------------------------------------------------------------

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/** Chữ của một sản phẩm cho T1: mọi product_name* + brands + mọi generic_name*. */
export function docText(r) {
  return [...Object.values(r.names || {}), r.brands || "", ...Object.values(r.generic || {})].join(" ");
}

/** Từ của tài liệu / câu tìm: chuẩn hóa không dấu (lib.mjs normalizeText), bỏ từ nhiễu (số, đơn vị, từ chung). */
export function bm25Tokens(s) {
  return normalizeText(s).split(" ").filter((w) => w && !isNoiseWord(w));
}

/** Dựng chỉ mục BM25. docs: [{ code, text }]. */
export function buildBm25(docs, { k1 = BM25_K1, b = BM25_B } = {}) {
  const tf = [];
  const df = new Map();
  let total = 0;
  for (const d of docs) {
    const m = new Map();
    for (const w of bm25Tokens(d.text)) m.set(w, (m.get(w) || 0) + 1);
    let len = 0;
    for (const c of m.values()) len += c;
    total += len;
    tf.push({ code: d.code, m, len });
    for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  const N = docs.length;
  const avgdl = N ? total / N : 0;
  const idf = new Map();
  for (const [w, n] of df) idf.set(w, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  // chỉ mục ngược: từ -> [vị trí tài liệu]
  const post = new Map();
  tf.forEach((t, i) => { for (const w of t.m.keys()) { if (!post.has(w)) post.set(w, []); post.get(w).push(i); } });
  return { tf, idf, post, avgdl, k1, b, N };
}

/** Tìm BM25: queryWords (mảng từ đã chuẩn hóa, trùng thì đếm 1 lần). Trả [{ code, score }] top k, điểm cao trước,
 *  bằng điểm thì tài liệu đứng trước trong danh mục trước. */
export function bm25Search(index, queryWords, k = 5) {
  const q = [...new Set(queryWords)];
  const score = new Map();
  for (const w of q) {
    const idf = index.idf.get(w);
    if (!idf) continue;
    for (const i of index.post.get(w)) {
      const t = index.tf[i];
      const f = t.m.get(w);
      const s = idf * (f * (index.k1 + 1)) / (f + index.k1 * (1 - index.b + index.b * (t.len / (index.avgdl || 1))));
      score.set(i, (score.get(i) || 0) + s);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([i, s]) => ({ code: index.tf[i].code, score: s }));
}

/** Câu tìm T1 từ dòng OCR (luật CHỐT): toàn bộ từ của các dòng qua usableLine (không cắt 3 từ), bỏ cụm chung
 *  + số / đơn vị / từ nhiễu như S2. Dòng phải có độ tin về 0–1 sẵn (như S2). */
export function t1QueryFromLines(lines) {
  const out = [];
  for (const l of (lines || []).filter((x) => usableLine(x))) {
    for (const w of stripPhrases(normalizeText(l.text)).split(" ")) if (w && !isNoiseWord(w)) out.push(w);
  }
  return out;
}

/** Câu tìm T1 cho 4a: [thương hiệu, tên, từ khóa] Gemini trả (JSON đã lưu: parsed.thuong_hieu, parsed.ten,
 *  parsed.tu_khoa là mảng hoặc chuỗi). */
export function t1QueryFromGemini(parsed) {
  const kw = parsed?.tu_khoa;
  const parts = [parsed?.thuong_hieu, parsed?.ten, ...(Array.isArray(kw) ? kw : [kw])];
  return t1QueryFromLines(parts.filter((x) => typeof x === "string" && x.trim()).map((text) => ({ text })));
}
