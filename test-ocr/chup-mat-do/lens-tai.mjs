// Đợt lens: BỘ TẢI ẢNH MẶT TRƯỚC Open Food Facts cho chỉ mục ảnh (chỉ để đo, không vào app / máy chủ).
// Danh sách: danh mục kho-lon mức (a) rồi (b) (D:\tmp\kho-lon\danh-muc\a.jsonl.gz, b.jsonl.gz), trường `img`
// (khóa ảnh mặt trước "front_xx.rev"); URL dựng như frontImageUrl của src/front-search.js, bản .400 (không có thì .200,
// ghi lại). CHỈ ảnh mặt trước OFF (images.openfoodfacts.org, CC BY-SA 3.0); không dữ liệu / ảnh nguồn khác.
// Lịch sự: User-Agent tên app + liên hệ chung (không thông tin cá nhân); ≤ 3 kết nối, mỗi kết nối cách lượt trước
// ≥ 1 giây (≤ 3 ảnh / giây tổng); thử lại có lùi; cầu dao: ≥ 5 lần 429 / 5xx LIÊN TIẾP thì dừng hẳn; tải nối (file đã
// có thì bỏ); nhật ký JSONL + tổng dung lượng. Mỗi lần chạy giới hạn thời gian (--phut, mặc định 7,5 < 8 phút), chạy
// nhiều lần nối nhau. Trước khi chạy: đo tổng D:\tmp\lens (ảnh + model + venv) + ước phần còn lại; dự kiến > 5 GB thì
// DỪNG (thoát mã 4).
//
//   node test-ocr/chup-mat-do/lens-tai.mjs [--muc a|b] [--phut 7.5] [--out D:\tmp\lens\anh] [--goc D:\tmp\lens]
//
// Phần thuần (export) có test ở test/lens-tai.test.mjs; phần chạy chỉ chạy khi gọi file này trực tiếp.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const USER_AGENT = "QuetMaVachLens/0.1 (student project, image similarity test; contact via project repository)";
export const SIZES = Object.freeze([400, 200]);
export const MAX_CONN = 3;
export const GAP_MS = 1000;
export const BREAKER_LIMIT = 5;
export const RETRIES = 3;
export const BUDGET_BYTES = 5 * 1024 ** 3;
export const DEFAULT_AVG_BYTES = 60 * 1024;
export const LEVEL_FILES = Object.freeze({ a: "D:\\tmp\\kho-lon\\danh-muc\\a.jsonl.gz", b: "D:\\tmp\\kho-lon\\danh-muc\\b.jsonl.gz" });

const CODE_RE = /^(\d{8}|\d{13})$/;
const IMG_RE = /^front_[a-z]{2,3}\.\d{1,6}$/;

/** URL ảnh mặt trước (giống frontImageUrl của src/front-search.js, cỡ 400 / 200). Sai dạng → "". */
export function imageUrl(code, img, size = 400) {
  if (typeof code !== "string" || !CODE_RE.test(code)) return "";
  if (typeof img !== "string" || !IMG_RE.test(img)) return "";
  if (!SIZES.includes(size)) return "";
  const p = code.padStart(13, "0");
  return `https://images.openfoodfacts.org/images/products/${p.slice(0, 3)}/${p.slice(3, 6)}/${p.slice(6, 9)}/${p.slice(9)}/${img}.${size}.jpg`;
}

/** Tên file ảnh trên đĩa: <mã>_<khóa ảnh>.<cỡ>.jpg (khóa ảnh gồm cả rev, đổi ảnh trên OFF thì tên đổi). */
export function fileNameOf(code, img, size) {
  return `${code}_${img}.${size}.jpg`;
}

/** Dòng danh mục (JSON) → danh sách tải [{ code, img }]: bỏ dòng không có / sai dạng img hoặc mã, bỏ mã trùng (giữ đầu). */
export function planList(rows) {
  const out = [];
  const seen = new Set();
  let noImg = 0;
  for (const r of rows || []) {
    if (!r || typeof r.code !== "string" || !CODE_RE.test(r.code) || seen.has(r.code)) continue;
    seen.add(r.code);
    if (typeof r.img !== "string" || !IMG_RE.test(r.img)) { noImg++; continue; }
    out.push({ code: r.code, img: r.img });
  }
  return { items: out, noImg, codes: seen.size };
}

/** File đã có (cỡ 400 hoặc 200, > 0 byte) trong danh sách tên file thư mục → { size, name } hoặc null. */
export function existingOf(names, code, img) {
  for (const s of SIZES) {
    const n = fileNameOf(code, img, s);
    if (names.has(n)) return { size: s, name: n };
  }
  return null;
}

/** Mã HTTP có thử lại không: 429 và 5xx (và lỗi mạng = status 0). 404 / 403… không thử lại. */
export function isRetryable(status) {
  return status === 0 || status === 429 || (status >= 500 && status <= 599);
}

/** Thời gian chờ trước lần thử lại thứ attempt (1, 2, …): 2^attempt giây (2, 4, 8 …), tối đa 30 giây. */
export function backoffMs(attempt) {
  return Math.min(30000, 1000 * 2 ** Math.max(1, attempt));
}

/** Cầu dao: đếm 429 / 5xx LIÊN TIẾP (mọi kết nối); ≥ limit thì mở (dừng). Lượt thành công / 404 đặt lại về 0. */
export function createBreaker(limit = BREAKER_LIMIT) {
  let run = 0;
  let open = false;
  return {
    record(status) {
      if (status === 429 || (status >= 500 && status <= 599)) { run++; if (run >= limit) open = true; } else run = 0;
      return open;
    },
    get open() { return open; },
    get run() { return run; },
  };
}

/** Bộ giãn cách của MỘT kết nối: lượt sau bắt đầu cách lượt trước ≥ gapMs. now / sleep truyền vào được (test). */
export function createGap(gapMs = GAP_MS, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -Infinity;
  return async () => {
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
}

/** Ước phần còn lại (byte): số ảnh còn lại × trung bình cỡ ảnh đã tải (chưa có thì DEFAULT_AVG_BYTES). */
export function estimateRemaining(remainingCount, doneCount, doneBytes) {
  const avg = doneCount > 0 ? doneBytes / doneCount : DEFAULT_AVG_BYTES;
  return Math.round(Math.max(0, remainingCount) * avg);
}

/** Cổng dung lượng: tổng hiện có + ước phần còn lại ≤ ngân sách. */
export function budgetOk(currentBytes, remainingBytes, budget = BUDGET_BYTES) {
  return currentBytes + remainingBytes <= budget;
}

/** Tổng byte của cả cây thư mục (bỏ qua lỗi đọc từng mục). */
export function dirBytes(dir) {
  let total = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += fs.statSync(p).size; files++; } catch { /* bỏ */ } }
    }
  }
  return { bytes: total, files };
}

/** Đọc danh mục .jsonl.gz → mảng dòng JSON. */
export function readCatalog(file) {
  return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Tải một ảnh: thử .400 rồi .200 (khi .400 trả 404). Mỗi cỡ thử lại tối đa RETRIES lần khi isRetryable, chờ backoffMs.
 * fetchImpl / gap / breaker / sleep truyền vào. Trả { ok, size, bytes, status, tries, buf } hoặc { ok: false, status, … }.
 * Cầu dao mở giữa chừng → { ok: false, breaker: true }.
 */
export async function fetchOne({ code, img }, { fetchImpl, gap, breaker, sleep, userAgent = USER_AGENT }) {
  let tries = 0;
  let lastStatus = null;
  for (const size of SIZES) {
    const url = imageUrl(code, img, size);
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (breaker.open) return { ok: false, status: lastStatus, tries, breaker: true };
      if (attempt > 0) await sleep(backoffMs(attempt));
      await gap();
      tries++;
      let status = 0;
      let buf = null;
      try {
        const res = await fetchImpl(url, { headers: { "User-Agent": userAgent } });
        status = res.status;
        if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      } catch {
        status = 0;
      }
      lastStatus = status;
      breaker.record(status);
      if (buf && buf.length > 0) return { ok: true, size, bytes: buf.length, status, tries, buf };
      if (status === 200) return { ok: false, status: "empty", tries };
      if (!isRetryable(status)) break; // 404 / 403 …: sang cỡ nhỏ hơn (404) hoặc thôi
    }
    if (lastStatus !== 404) return { ok: false, status: lastStatus, tries };
  }
  return { ok: false, status: lastStatus, tries };
}

// ---------------- chống ăn gian (chuẩn bị, KHÔNG tính độ giống ảnh) ----------------
export const APP_NAME = "quet-ma-vach-lens";

/** URL OFF API sản phẩm (chỉ trường code + images), có app_name. */
export function productUrl(code) {
  if (typeof code !== "string" || !CODE_RE.test(code)) return "";
  return `https://world.openfoodfacts.org/api/v2/product/${code}?fields=code,images&app_name=${APP_NAME}`;
}

/**
 * Ứng viên ảnh chỉ mục cho một mã A / B (thứ tự luật: khóa ảnh của danh mục trước, rồi các front_xx khác theo vi → en →
 * tên): [{ key ("front_xx.rev"), imgid | null, fromCatalog, note? }]. Khóa danh mục có rev khác rev hiện tại trên OFF →
 * không biết imgid (imgid null, ghi chú), sau đó vẫn thêm khóa hiện tại của front_xx đó như ứng viên thường.
 */
export function candidatesFrom(product, catalogImg) {
  const images = product?.images || {};
  const fronts = [];
  for (const [k, v] of Object.entries(images)) {
    const m = /^front_([a-z]{2,3})$/.exec(k);
    if (!m || !v || v.imgid == null || v.rev == null) continue;
    fronts.push({ k, lang: m[1], imgid: String(v.imgid), rev: String(v.rev) });
  }
  const pri = (l) => (l === "vi" ? 0 : l === "en" ? 1 : 2);
  fronts.sort((a, b) => pri(a.lang) - pri(b.lang) || a.k.localeCompare(b.k));
  const out = [];
  const cm = typeof catalogImg === "string" ? /^(front_[a-z]{2,3})\.(\d+)$/.exec(catalogImg) : null;
  if (cm) {
    const f = fronts.find((x) => x.k === cm[1]);
    if (f && f.rev === cm[2]) out.push({ key: catalogImg, imgid: f.imgid, fromCatalog: true });
    else out.push({ key: catalogImg, imgid: null, fromCatalog: true, note: f ? `rev danh mục ${cm[2]} ≠ rev hiện tại ${f.rev}` : "khóa danh mục không còn trên OFF" });
  }
  for (const f of fronts) {
    const key = `${f.k}.${f.rev}`;
    if (out.some((x) => x.key === key)) continue;
    out.push({ key, imgid: f.imgid, fromCatalog: false });
  }
  return out;
}

/** imgid ảnh đo từ URL ảnh gốc trong photos/NGUON.csv (…/<imgid>.jpg). */
export function imgidFromUrl(url) {
  const m = /\/(\d+)(?:\.\d+)?\.jpg(?:\?.*)?$/i.exec(String(url ?? ""));
  return m ? m[1] : null;
}

/** Đường dẫn chỉ ở ổ D (gợi ý 4 của code-reviewer vòng 1: mọi chế độ ghi đĩa đều kiểm). */
export function onDriveD(...dirs) {
  return dirs.every((d) => /^[dD]:/.test(path.resolve(String(d))));
}

/**
 * Hàm đọc OFF API sản phẩm (NÊN SỬA 3 của code-reviewer vòng 1): kiểm cầu dao TRƯỚC mỗi lượt gọi, ghi breaker.record(status)
 * cho MỌI lượt kể cả thành công (cầu dao đếm đúng "liên tiếp"); thử lại có lùi khi 429 / 5xx / lỗi mạng; trần maxCalls lượt
 * mạng mỗi lần chạy. cache = { get(code) → json | null, set(code, json) } (lượt từ cache không tính, không chạm cầu dao).
 * Trả { kind: "ok", json } | { kind: "khong-co", status: 404 } | { kind: "loi", status } | { kind: "cau-dao" } | { kind: "tran" }.
 */
export function makeGetProduct({ fetchImpl, gap, breaker, sleep, cache, stats, maxCalls, userAgent = USER_AGENT }) {
  return async (code) => {
    const hit = cache.get(code);
    if (hit) { stats.apiCached++; return { kind: "ok", json: hit }; }
    let status = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (breaker.open) return { kind: "cau-dao" };
      if (stats.apiCalls >= maxCalls) return { kind: "tran" };
      if (attempt) await sleep(backoffMs(attempt));
      await gap();
      if (breaker.open) return { kind: "cau-dao" };
      stats.apiCalls++;
      status = 0;
      let json = null;
      try {
        const res = await fetchImpl(productUrl(code), { headers: { "User-Agent": userAgent } });
        status = res.status;
        if (res.ok) json = await res.json();
      } catch { status = 0; json = null; }
      if (status === 200 && json == null) status = 0; // trả 200 mà không đọc được JSON: coi như lỗi mạng
      if (breaker.record(status)) return { kind: "cau-dao" };
      if (json) { cache.set(code, json); return { kind: "ok", json }; }
      if (status === 404) return { kind: "khong-co", status };
      if (!isRetryable(status)) return { kind: "loi", status };
    }
    return { kind: "loi", status };
  };
}

/**
 * Phán một mã A / B sau khi đã có ứng viên (NÊN SỬA 2 của code-reviewer vòng 1). cands = [{ key, imgid, distance,
 * fetchFail? ("tai-loi" | "cau-dao") }]; choose = chooseSubstitute của lens-do.mjs. Ứng viên đã xét mà tải ảnh lỗi →
 * "chua-xong" (KHÔNG phải loại); chỉ khi mọi ứng viên đã xét đủ mà không có ảnh khác hợp lệ mới là "loai".
 * Trả { status: "dung" | "loai" | "chua-xong", chosen, rejected, reason }.
 */
export function antiCheatVerdict(cands, testImgid, choose, { productFound = true } = {}) {
  const r = choose(cands || [], testImgid);
  const byKey = new Map((cands || []).map((c) => [c.key, c]));
  const failed = r.rejected.map((x) => byKey.get(x.key)).filter((c) => c?.fetchFail);
  if (failed.length) {
    return { status: "chua-xong", chosen: null, rejected: r.rejected, reason: failed.some((c) => c.fetchFail === "cau-dao") ? "cầu dao mở" : "tải ảnh lỗi" };
  }
  if (r.chosen) return { status: "dung", chosen: r.chosen, rejected: r.rejected, reason: null };
  const reason = (cands || []).length ? [...new Set(r.rejected.map((x) => x.reason))].join("; ") : productFound ? "OFF không có ảnh mặt trước" : "OFF không có sản phẩm";
  return { status: "loai", chosen: null, rejected: r.rejected, reason };
}

/** Ứng viên có cần tải ảnh để so mã băm (imgid ảnh đo và ứng viên đều biết, khác nhau). */
export function needsImage(c, testImgid, known) {
  return known(testImgid) && known(c.imgid) && String(c.imgid) !== String(testImgid);
}

/**
 * Tổng hợp chống ăn gian: items = [{ code, status, reason, chosen (khóa) }], expected = mọi mã A / B. Mã chưa có item =
 * "chưa xét". complete chỉ khi đủ mã và không mã nào "chua-xong". excluded = CHỈ mã "loai"; override = mã "dung" → khóa.
 */
export function summarizeAntiCheat(items, expected) {
  const by = new Map((items || []).map((x) => [x.code, x]));
  const incomplete = [];
  for (const c of expected || []) {
    const x = by.get(c);
    if (!x) incomplete.push({ code: c, reason: "chưa xét" });
    else if (x.status === "chua-xong") incomplete.push({ code: c, reason: x.reason });
    else if (x.status !== "dung" && x.status !== "loai") incomplete.push({ code: c, reason: `trạng thái lạ ${x.status}` });
  }
  const done = (items || []).filter((x) => (expected || []).includes(x.code));
  return {
    complete: incomplete.length === 0 && (expected || []).length > 0, incomplete,
    excluded: done.filter((x) => x.status === "loai").map((x) => x.code),
    override: Object.fromEntries(done.filter((x) => x.status === "dung").map((x) => [x.code, x.chosen])),
  };
}

// ---------------- bộ P (LỆCH LUẬT 1 của lens-do.mjs) ----------------
/** Khóa override dạng imgid (ảnh chỉ mục lấy theo imgid, không theo khóa front_xx.rev). */
export const IMGID_KEY_RE = /^imgid:(\d+)$/;

/** imgid của khóa danh mục "front_xx.rev" theo bản ghi xuất OFF (fronts [{ key "front_xx", imgid, rev }]); rev khác / không có → null. */
export function catalogImgidOf(fronts, catalogKey) {
  const m = typeof catalogKey === "string" ? /^(front_[a-z]{2,3})\.(\d+)$/.exec(catalogKey) : null;
  if (!m) return null;
  const f = (fronts || []).find((x) => x?.key === m[1] && String(x.rev) === m[2]);
  return f && f.imgid != null && String(f.imgid).trim() !== "" ? String(f.imgid) : null;
}

/**
 * Chọn ảnh chỉ mục cho một cặp loo của bộ P (luật LỆCH LUẬT 1 (i)): giữ khóa danh mục nếu imgid KHÁC queryImgid và mã
 * băm > 24 bit (dist ≥ okMin); không thì ảnh indexImgid (override "imgid:<n>") nếu imgid khác queryImgid và > 24 bit;
 * không thì bỏ cặp. imgid không rõ = không đạt. Trả { index: { key, imgid, source, distance } | null, reasons: [string] }.
 */
export function decidePIndex({ queryImgid, catalogKey, catalogImgid, catalogDist, indexImgid, indexDist }, { okMin, known }) {
  const reasons = [];
  if (!known(queryImgid)) return { index: null, reasons: ["không biết imgid ảnh truy vấn"] };
  const ok = (imgid, dist, what) => {
    if (!known(imgid)) { reasons.push(`${what}: không biết imgid`); return false; }
    if (String(imgid) === String(queryImgid)) { reasons.push(`${what}: cùng imgid ảnh truy vấn`); return false; }
    if (!Number.isFinite(dist)) { reasons.push(`${what}: không có mã băm`); return false; }
    if (dist < okMin) { reasons.push(`${what}: gần ảnh truy vấn ${dist} bit (≤ ${okMin - 1})`); return false; }
    return true;
  };
  if (catalogKey && ok(catalogImgid, catalogDist, "khóa danh mục")) return { index: { key: catalogKey, imgid: String(catalogImgid), source: "catalog", distance: catalogDist }, reasons };
  if (!catalogKey) reasons.push("không có khóa danh mục");
  if (ok(indexImgid, indexDist, "ảnh indexImgid")) return { index: { key: `imgid:${indexImgid}`, imgid: String(indexImgid), source: "override", distance: indexDist }, reasons };
  return { index: null, reasons };
}

/**
 * Danh sách đầu vào cho lens-vec.py (lệnh vec) — ẢNH CHỈ MỤC CHỌN TƯỜNG MINH, không quét thư mục. rows = dòng danh mục
 * (mức a / b); fileOf(code, key) → đường dẫn ảnh hoặc null; ac / bop = chong-an-gian.json / bo-p.json đã đọc (+ sha256);
 * queries = [{ qid, file }]. Mã bị loại không vào chỉ mục; mã có override dùng khóa override; mã có ảnh truy vấn (A / B
 * dùng được, bộ P) ghi imgid ảnh chỉ mục (meta.indexImgid). Trả { index: [{ code, key, file }], indexKey, indexImgid,
 * missing: [{ code, key }], queries }.
 */
export function buildVecInput({ rows, fileOf, ac, bop, queries }) {
  const excluded = new Set(ac.excluded || []);
  const override = { ...(ac.override || {}) };
  const imgidOf = {};
  for (const x of ac.items || []) if (x.chosen) {
    const c = (x.candidates || []).find((k) => k.key === x.chosen);
    imgidOf[x.code] = c?.imgid != null ? String(c.imgid) : null;
  }
  for (const p of bop?.items || []) {
    if (Object.hasOwn(override, p.code) && override[p.code] !== p.index.key) throw new Error(`override mâu thuẫn ${p.code}`);
    override[p.code] = p.index.key;
    imgidOf[p.code] = String(p.index.imgid);
  }
  const index = [];
  const indexKey = {};
  const indexImgid = {};
  const missing = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (!r || typeof r.code !== "string" || !CODE_RE.test(r.code) || seen.has(r.code)) continue;
    seen.add(r.code);
    if (excluded.has(r.code)) continue;
    const key = override[r.code] ?? (typeof r.img === "string" && IMG_RE.test(r.img) ? r.img : null);
    if (!key) continue;
    const file = fileOf(r.code, key);
    if (!file) { missing.push({ code: r.code, key }); continue; }
    index.push({ code: r.code, key, file });
    indexKey[r.code] = key;
    if (Object.hasOwn(imgidOf, r.code)) indexImgid[r.code] = imgidOf[r.code];
  }
  const qs = [...(queries || [])];
  for (const p of bop?.items || []) if (!qs.some((q) => q.qid === p.qid)) qs.push({ qid: p.qid, file: p.query.file });
  return { index, indexKey, indexImgid, missing, queries: qs };
}

// ---------------- chạy ----------------
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  if (argv.includes("--chong-an-gian")) {
    const done = await runAntiCheat(arg);
    process.exit(done ? 0 : 5);
  }
  if (argv.includes("--bo-p")) {
    const ok = await runBoP(arg);
    process.exit(ok ? 0 : 5);
  }
  if (argv.includes("--vao-vec")) {
    runVecInput(arg);
    process.exit(0);
  }
  const level = arg("--muc", "a");
  if (!Object.hasOwn(LEVEL_FILES, level)) { console.error(`--muc phải là a hoặc b (nhận ${level})`); process.exit(2); }
  const minutes = Number(arg("--phut", "7.5"));
  if (!(minutes > 0 && minutes < 8)) { console.error("--phut phải trong (0, 8)"); process.exit(2); }
  const outDir = arg("--out", "D:\\tmp\\lens\\anh");
  const rootDir = arg("--goc", "D:\\tmp\\lens");
  if (!onDriveD(outDir, rootDir)) { console.error("Chỉ ghi vào ổ D."); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const logFile = path.join(outDir, "tai-log.jsonl");
  const sumFile = path.join(outDir, `tai-tong-${level}.json`);

  const plan = planList(readCatalog(LEVEL_FILES[level]));
  const names = new Set(fs.readdirSync(outDir).filter((n) => { try { return fs.statSync(path.join(outDir, n)).size > 0; } catch { return false; } }));
  const prev = fs.existsSync(sumFile) ? JSON.parse(fs.readFileSync(sumFile, "utf8")) : null;
  const missing = new Set(prev?.missing404 ?? []);
  const todo = plan.items.filter((it) => !existingOf(names, it.code, it.img) && !missing.has(it.code));
  const have = plan.items.filter((it) => existingOf(names, it.code, it.img));
  let haveBytes = 0;
  for (const it of have) haveBytes += fs.statSync(path.join(outDir, existingOf(names, it.code, it.img).name)).size;
  const tree = dirBytes(rootDir);
  const est = estimateRemaining(todo.length, have.length, haveBytes);
  console.log(`Mức (${level}): ${plan.codes} mã, ${plan.items.length} có khóa ảnh (${plan.noImg} không có), đã có ${have.length} (${(haveBytes / 1048576).toFixed(1)} MB), 404 cả hai cỡ ${missing.size}, còn ${todo.length}.`);
  console.log(`Tổng ${rootDir}: ${(tree.bytes / 1048576).toFixed(1)} MB (${tree.files} file); ước phần còn lại ${(est / 1048576).toFixed(1)} MB; ngân sách ${(BUDGET_BYTES / 1048576).toFixed(0)} MB.`);
  if (!budgetOk(tree.bytes, est)) {
    console.error("DỰ KIẾN VƯỢT 5 GB: dừng, không tải.");
    process.exit(4);
  }
  if (!todo.length) { console.log("Không còn ảnh nào để tải."); process.exit(0); }

  const breaker = createBreaker();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + minutes * 60000;
  const stats = { ok: 0, bytes: 0, size400: 0, size200: 0, miss404: 0, fail: 0, r429: 0, r5xx: 0, tries: 0 };
  const newMissing = [];
  const fallback200 = [];
  let next = 0;
  const t0 = Date.now();
  const log = fs.openSync(logFile, "a");
  const worker = async () => {
    const gap = createGap(GAP_MS);
    while (!breaker.open && Date.now() < deadline) {
      const i = next++;
      if (i >= todo.length) return;
      const it = todo[i];
      const counting = (f) => async (...a) => {
        const res = await f(...a);
        if (res.status === 429) stats.r429++;
        else if (res.status >= 500) stats.r5xx++;
        return res;
      };
      const r = await fetchOne(it, { fetchImpl: counting(fetch), gap, breaker, sleep });
      stats.tries += r.tries;
      const rec = { at: new Date().toISOString(), level, code: it.code, img: it.img, ok: r.ok, status: r.status, tries: r.tries };
      if (r.ok) {
        const name = fileNameOf(it.code, it.img, r.size);
        fs.writeFileSync(path.join(outDir, name), r.buf);
        stats.ok++;
        stats.bytes += r.bytes;
        stats[`size${r.size}`]++;
        if (r.size === 200) fallback200.push(it.code);
        Object.assign(rec, { size: r.size, bytes: r.bytes });
      } else if (r.status === 404) { stats.miss404++; newMissing.push(it.code); } else stats.fail++;
      fs.writeSync(log, `${JSON.stringify(rec)}\n`);
    }
  };
  await Promise.all(Array.from({ length: MAX_CONN }, worker));
  fs.closeSync(log);
  const secs = (Date.now() - t0) / 1000;
  const doneAll = have.length + stats.ok;
  const sum = {
    at: new Date().toISOString(), level, catalog: LEVEL_FILES[level], codes: plan.codes, withImg: plan.items.length, noImg: plan.noImg,
    downloaded: doneAll, bytes: haveBytes + stats.bytes, missing404: [...missing, ...newMissing],
    fallback200: [...new Set([...(prev?.fallback200 ?? []), ...fallback200])],
    runs: [...(prev?.runs ?? []), { at: new Date().toISOString(), secs: Math.round(secs), ...stats, breakerOpen: breaker.open }],
    userAgent: USER_AGENT, maxConn: MAX_CONN, gapMs: GAP_MS,
  };
  fs.writeFileSync(sumFile, JSON.stringify(sum, null, 1), "utf8");
  console.log(`Lần này: ${stats.ok} ảnh (${(stats.bytes / 1048576).toFixed(1)} MB; .400 ${stats.size400}, .200 ${stats.size200}), 404 ${stats.miss404}, lỗi ${stats.fail}, 429 ${stats.r429}, 5xx ${stats.r5xx}, ${secs.toFixed(0)} giây (${(stats.tries / Math.max(1, secs)).toFixed(2)} lượt / giây).`);
  console.log(`Tổng mức (${level}): ${doneAll} / ${plan.items.length} ảnh, ${(sum.bytes / 1048576).toFixed(1)} MB, 404 ${sum.missing404.length}.${breaker.open ? " CẦU DAO MỞ: dừng." : ""}`);
  process.exit(breaker.open ? 5 : 0);
}

// ---------------- phần chạy chung của chống ăn gian / bộ P ----------------
/**
 * Bộ dụng cụ dùng chung (chỉ ở phần chạy): mã băm dHash / pHash vùng giữa (cropHashSet / compareHashSets của lib.mjs) trên
 * ảnh xám cạnh dài 256 px, xoay theo EXIF, bằng sharp. LƯU Ý (gợi ý 5 của code-reviewer vòng 1): sharp KHÔNG khai trong
 * test-ocr/chup-mat-do/package.json; nó có mặt nhờ @huggingface/transformers kéo theo (phụ thuộc gián tiếp). Không thêm vào
 * package.json (không thêm thư viện); đổi / bỏ transformers thì phần này gãy, cần xem lại.
 */
async function hashTools() {
  const { cropHashSet, compareHashSets } = await import("./lib.mjs");
  const sharp = (await import("sharp")).default;
  const hashOf = async (file) => {
    const { data, info } = await sharp(file).rotate().resize(256, 256, { fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const g = new Array(info.width * info.height);
    for (let i = 0; i < g.length; i++) g[i] = data[i * info.channels];
    return cropHashSet(g, info.width, info.height);
  };
  const distance = async (a, b) => compareHashSets(await hashOf(a), await hashOf(b))?.distance ?? null;
  return { hashOf, distance, compareHashSets };
}

/**
 * Chống ăn gian (cờ --chong-an-gian; KHÔNG tính độ giống ảnh): với mỗi mã A / B (truy vấn "ab-<mã>" của
 * D:\tmp\lens\ca.json): đọc ảnh mặt trước trên OFF API sản phẩm (cache D:\tmp\lens\off-sp, giãn ≥ 1 giây, ≤ 60 lượt mạng
 * mỗi lần chạy, cầu dao 5 lần 429 / 5xx liên tiếp, kiểm trước mỗi lượt), tải ảnh ứng viên (.400, lịch sự như trên), mã
 * băm vùng giữa, chọn ảnh thay theo luật (chooseSubstitute của lens-do.mjs). Lỗi tải / cầu dao / OFF API lỗi → mã "chưa
 * xong" (complete: false + incomplete), KHÔNG ghi thành LOẠI; chỉ "OFF không có ảnh khác hợp lệ" mới LOẠI. Ảnh thật: so
 * mã băm ảnh chụp với ảnh chỉ mục của mã đúng đã tải (≤ 10 bit → ghi chú). Ra D:\tmp\lens\chong-an-gian.json. Trả
 * complete.
 */
async function runAntiCheat(arg) {
  const lensDir = arg("--goc", "D:\\tmp\\lens");
  const outDir = arg("--out", "D:\\tmp\\lens\\anh");
  const photos = arg("--photos", "D:\\quet-ma-vach-full\\test-ocr\\photos");
  const nhanFile = arg("--nhan", "D:\\tmp\\may-chu-loc\\nhan.json");
  if (!onDriveD(lensDir, outDir)) { console.error("Chỉ ghi vào ổ D."); process.exit(2); }
  const spDir = path.join(lensDir, "off-sp");
  fs.mkdirSync(spDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const { parseCsv, HASH_DUP } = await import("./lib.mjs");
  const { chooseSubstitute, knownImgid, OFF_CALLS_MAX, REAL_DUP_MAX, BULDAK_CODE, RUAYPUAN_CODE } = await import("./lens-do.mjs");
  const { hashOf, compareHashSets } = await hashTools();
  const ca = JSON.parse(fs.readFileSync(path.join(lensDir, "ca.json"), "utf8"));
  const nguon = parseCsv(fs.readFileSync(path.join(photos, "NGUON.csv"), "utf8"));
  const catA = new Map(readCatalog(LEVEL_FILES.a).map((r) => [r.code, r]));
  const catB = new Map(readCatalog(LEVEL_FILES.b).map((r) => [r.code, r]));
  const gap = createGap(GAP_MS);
  const breaker = createBreaker();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stats = { apiCalls: 0, apiCached: 0, imgDownloads: 0, imgCached: 0, imgFail: 0 };
  const cache = {
    get: (code) => { const f = path.join(spDir, `${code}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; },
    set: (code, j) => fs.writeFileSync(path.join(spDir, `${code}.json`), JSON.stringify(j), "utf8"),
  };
  const getProduct = makeGetProduct({ fetchImpl: fetch, gap, breaker, sleep, cache, stats, maxCalls: OFF_CALLS_MAX });
  /** Ảnh ứng viên: { file } hoặc { fail: "cau-dao" | "tai-loi", status }. */
  const ensureImg = async (code, key) => {
    for (const s of SIZES) { const f = path.join(outDir, fileNameOf(code, key, s)); if (fs.existsSync(f) && fs.statSync(f).size > 0) { stats.imgCached++; return { file: f }; } }
    if (breaker.open) { stats.imgFail++; return { fail: "cau-dao" }; }
    const r = await fetchOne({ code, img: key }, { fetchImpl: fetch, gap, breaker, sleep });
    if (!r.ok) { stats.imgFail++; return { fail: r.breaker ? "cau-dao" : "tai-loi", status: r.status }; }
    stats.imgDownloads++;
    const f = path.join(outDir, fileNameOf(code, key, r.size));
    fs.writeFileSync(f, r.buf);
    return { file: f };
  };
  const items = [];
  const expected = ca.queries.filter((x) => x.qid.startsWith("ab-")).map((x) => x.qid.slice(3));
  for (const q of ca.queries.filter((x) => x.qid.startsWith("ab-"))) {
    const code = q.qid.slice(3);
    const src = nguon.find((r) => r.code === code && r.file === "front.jpg");
    const testImgid = imgidFromUrl(src?.url);
    const catalogImg = (catA.get(code) ?? catB.get(code))?.img || "";
    const base = { code, testImgid, catalogImg, catalogLevel: catA.has(code) ? "a" : catB.has(code) ? "b" : null };
    const prod = await getProduct(code);
    if (prod.kind !== "ok" && prod.kind !== "khong-co") {
      const reason = prod.kind === "cau-dao" ? "cầu dao mở" : prod.kind === "tran" ? `chạm trần ${OFF_CALLS_MAX} lượt OFF API` : `OFF API lỗi ${prod.status}`;
      items.push({ ...base, offStatus: prod.kind, candidates: [], chosen: null, rejected: [], status: "chua-xong", reason });
      console.log(`${code}: CHƯA XONG (${reason})`);
      continue;
    }
    const testSet = await hashOf(q.file);
    const cands = prod.kind === "ok" ? candidatesFrom(prod.json?.product, catalogImg) : [];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!needsImage(c, testImgid, knownImgid)) continue;
      const g = await ensureImg(code, c.key);
      if (g.fail) { c.distance = null; c.fetchFail = g.fail; continue; }
      c.distance = compareHashSets(await hashOf(g.file), testSet)?.distance ?? null;
      if (chooseSubstitute(cands.slice(0, i + 1), testImgid).chosen) break; // đã có ảnh thay: không tải thêm
    }
    const v = antiCheatVerdict(cands, testImgid, chooseSubstitute, { productFound: prod.kind === "ok" });
    items.push({
      ...base, offStatus: prod.kind === "ok" ? 200 : 404,
      candidates: cands.map(({ key, imgid, fromCatalog, note, distance, fetchFail }) => ({ key, imgid, fromCatalog, note: note ?? null, distance: distance ?? null, fetchFail: fetchFail ?? null })),
      chosen: v.chosen ? v.chosen.key : null, rejected: v.rejected, status: v.status, reason: v.reason,
    });
    const dd = v.chosen ? `DÙNG ${v.chosen.key} (imgid ${v.chosen.imgid}, ${v.chosen.distance} bit)` : v.status === "loai" ? `LOẠI (${v.reason})` : `CHƯA XONG (${v.reason})`;
    console.log(`${code}: ảnh đo imgid ${testImgid}, danh mục ${catalogImg || "(không ảnh)"}, ${cands.length} ứng viên → ${dd}`);
  }
  // ảnh thật (+ buldak, ruaypuan): mã băm ảnh chụp so ảnh chỉ mục của mã đúng (nếu đã tải); chỉ ghi chú, không loại
  const nhan = JSON.parse(fs.readFileSync(nhanFile, "utf8"));
  const real = [];
  for (const q of ca.queries.filter((x) => !x.qid.startsWith("ab-"))) {
    const cs = ca.cases.find((c) => c.qid === q.qid);
    let code = null;
    if (q.qid === "buldak") code = BULDAK_CODE;
    else if (q.qid === "ruaypuan") code = RUAYPUAN_CODE;
    else {
      const lab = nhan.items.find((x) => path.basename(q.file) === x.file && cs?.folder === x.folder);
      code = lab?.code && lab.code !== "none" ? lab.code : null;
    }
    if (!code) { real.push({ qid: q.qid, hasLabel: false }); continue; }
    const row = catA.get(code) ?? catB.get(code) ?? null;
    const level = catA.has(code) ? "a" : catB.has(code) ? "b" : null;
    const key = row?.img || "";
    let f = null;
    if (key) for (const s of SIZES) { const x = path.join(outDir, fileNameOf(code, key, s)); if (fs.existsSync(x)) { f = x; break; } }
    const dist = f ? compareHashSets(await hashOf(f), await hashOf(q.file))?.distance ?? null : null;
    real.push({ qid: q.qid, hasLabel: true, level, hasImgKey: !!key, indexImgDownloaded: !!f, distance: dist, note: dist != null && dist <= REAL_DUP_MAX ? "có thể trùng ảnh (≤ 10 bit)" : null });
  }
  const sum = summarizeAntiCheat(items, expected);
  const out = {
    at: new Date().toISOString(), rule: `ảnh thay: imgid ảnh đo và ứng viên đều biết, khác nhau, VÀ mã băm vùng giữa > 24 bit (HASH_DUP ${HASH_DUP}; cropHashSet / compareHashSets của lib.mjs, xám bằng sharp, xoay EXIF, cạnh dài 256 px); lỗi tải / cầu dao / OFF API lỗi = chưa xong, không phải loại`,
    userAgent: USER_AGENT, appName: APP_NAME, stats, breakerOpen: breaker.open, items, expected: expected.length,
    complete: sum.complete, incomplete: sum.incomplete, excluded: sum.excluded, override: sum.override, real,
  };
  fs.writeFileSync(path.join(lensDir, "chong-an-gian.json"), JSON.stringify(out, null, 1), "utf8");
  console.log(`A/B: ${items.length}/${expected.length} mã, dùng được ${Object.keys(sum.override).length}, LOẠI ${sum.excluded.length}, CHƯA XONG ${sum.incomplete.length} → complete ${sum.complete}. Ảnh thật có nhãn ${real.filter((x) => x.hasLabel).length}, ảnh chỉ mục đã tải ${real.filter((x) => x.indexImgDownloaded).length}, ghi chú trùng ${real.filter((x) => x.note).length}. OFF API ${stats.apiCalls} lượt mạng (cache ${stats.apiCached}), ảnh tải ${stats.imgDownloads} (có sẵn ${stats.imgCached}, lỗi ${stats.imgFail})${breaker.open ? "; CẦU DAO MỞ" : ""}.`);
  return sum.complete;
}

/**
 * Bộ P (cờ --bo-p; LỆCH LUẬT 1 của lens-do.mjs; KHÔNG tính độ giống ảnh): mã A / B dùng được có trong danh mục (a) (ảnh
 * truy vấn = ảnh đo, ảnh chỉ mục = ảnh thay) ∪ cặp VN leave-one-out của D:\tmp\chup-mat-do\chi-muc\loo.json có mã trong
 * danh mục (a), không trùng mã A / B (ảnh truy vấn = ảnh queryImgid; ảnh chỉ mục theo decidePIndex). imgid của khóa danh
 * mục lấy từ bản xuất OFF D:\tmp\chup-mat-do\du-lieu\vn-products.json (khóa front_xx.rev cố định một ảnh; rev khác = không
 * biết imgid). Ảnh dùng lại từ D:\tmp\chup-mat-do\chi-muc\anh và D:\tmp\lens\anh; thiếu thì tải bản .400 theo imgid
 * (giãn ≥ 1 giây, ≤ 40 ảnh). Ra D:\tmp\lens\bo-p.json. Trả true khi không có cặp nào dở vì tải lỗi.
 */
async function runBoP(arg) {
  const lensDir = arg("--goc", "D:\\tmp\\lens");
  const anhDir = arg("--out", "D:\\tmp\\lens\\anh");
  const looFile = arg("--loo", "D:\\tmp\\chup-mat-do\\chi-muc\\loo.json");
  const looAnh = arg("--loo-anh", "D:\\tmp\\chup-mat-do\\chi-muc\\anh");
  const vnFile = arg("--vn", "D:\\tmp\\chup-mat-do\\du-lieu\\vn-products.json");
  const photos = arg("--photos", "D:\\quet-ma-vach-full\\test-ocr\\photos");
  if (!onDriveD(lensDir, anhDir, looAnh)) { console.error("Chỉ ghi vào ổ D."); process.exit(2); }
  const { knownImgid, HASH_OK_MIN } = await import("./lens-do.mjs");
  const { distance } = await hashTools();
  const ac = JSON.parse(fs.readFileSync(path.join(lensDir, "chong-an-gian.json"), "utf8"));
  if (ac.complete !== true) { console.error("chong-an-gian.json chưa complete: dựng bộ P sau."); return false; }
  const catA = new Map(readCatalog(LEVEL_FILES.a).map((r) => [r.code, r]));
  const loo = JSON.parse(fs.readFileSync(looFile, "utf8"));
  const vn = new Map(JSON.parse(fs.readFileSync(vnFile, "utf8")).map((r) => [r.code, r]));
  const MAX_DL = 40;
  const gap = createGap(GAP_MS);
  const breaker = createBreaker();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dl = { downloads: 0, cached: 0, fail: 0 };
  const byImgid = (code, imgid) => path.join(looAnh, `${code}_${imgid}.400.jpg`);
  /** Ảnh theo imgid (chi-muc\anh): có sẵn → file; thiếu → tải .400 từ images.openfoodfacts.org (≤ 40 ảnh). */
  const ensureImgid = async (code, imgid) => {
    const f = byImgid(code, imgid);
    if (fs.existsSync(f) && fs.statSync(f).size > 0) { dl.cached++; return f; }
    if (dl.downloads >= MAX_DL || breaker.open) { dl.fail++; return null; }
    const p = code.padStart(13, "0");
    const url = `https://images.openfoodfacts.org/images/products/${p.slice(0, 3)}/${p.slice(3, 6)}/${p.slice(6, 9)}/${p.slice(9)}/${imgid}.400.jpg`;
    await gap();
    dl.downloads++;
    let status = 0;
    let b = null;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      status = res.status;
      if (res.ok) b = Buffer.from(await res.arrayBuffer());
    } catch { status = 0; b = null; }
    breaker.record(status);
    if (b && b.length) { fs.writeFileSync(f, b); return f; }
    dl.fail++;
    return null;
  };
  const anhFile = (code, key) => { for (const s of SIZES) { const f = path.join(anhDir, fileNameOf(code, key, s)); if (fs.existsSync(f) && fs.statSync(f).size > 0) return f; } return null; };
  const items = [];
  const dropped = [];
  let pending = 0;
  // (1) A / B dùng được, có trong danh mục (a)
  for (const it of ac.items) {
    if (it.status !== "dung") continue;
    if (!catA.has(it.code)) { dropped.push({ code: it.code, kind: "ab", reason: "mã không có trong danh mục (a)" }); continue; }
    const c = it.candidates.find((x) => x.key === it.chosen);
    const file = anhFile(it.code, it.chosen);
    if (!file) { dropped.push({ code: it.code, kind: "ab", reason: "chưa có file ảnh thay" }); pending++; continue; }
    items.push({
      qid: `ab-${it.code}`, code: it.code, kind: "ab",
      query: { file: path.join(photos, it.code, "front.jpg"), imgid: String(it.testImgid) },
      index: { key: it.chosen, imgid: String(c.imgid), source: "override", distance: c.distance, file },
    });
  }
  // (2) cặp leave-one-out VN
  const abSet = new Set(ac.items.map((x) => x.code));
  for (const pr of loo.pairs || []) {
    const code = String(pr.code);
    if (abSet.has(code)) { dropped.push({ code, kind: "loo", reason: "trùng mã A / B" }); continue; }
    const row = catA.get(code);
    if (!row) { dropped.push({ code, kind: "loo", reason: "mã không có trong danh mục (a)" }); continue; }
    const qf = await ensureImgid(code, pr.queryImgid);
    if (!qf) { dropped.push({ code, kind: "loo", reason: "chưa có ảnh truy vấn (tải lỗi)" }); pending++; continue; }
    const catalogKey = typeof row.img === "string" && IMG_RE.test(row.img) ? row.img : null;
    const catalogImgid = catalogKey ? catalogImgidOf(vn.get(code)?.fronts, catalogKey) : null;
    const cf = catalogKey ? anhFile(code, catalogKey) : null;
    const catalogDist = cf && knownImgid(catalogImgid) && String(catalogImgid) !== String(pr.queryImgid) ? await distance(cf, qf) : null;
    let indexDist = null;
    let xf = null;
    const needOverride = !(catalogKey && knownImgid(catalogImgid) && String(catalogImgid) !== String(pr.queryImgid) && Number.isFinite(catalogDist) && catalogDist >= HASH_OK_MIN);
    if (needOverride && knownImgid(pr.indexImgid) && String(pr.indexImgid) !== String(pr.queryImgid)) {
      xf = await ensureImgid(code, pr.indexImgid);
      indexDist = xf ? await distance(xf, qf) : null;
    }
    const d = decidePIndex({ queryImgid: String(pr.queryImgid), catalogKey, catalogImgid, catalogDist, indexImgid: pr.indexImgid, indexDist }, { okMin: HASH_OK_MIN, known: knownImgid });
    if (catalogKey && !cf) d.reasons.push("khóa danh mục: chưa có file ảnh");
    if (!d.index) { dropped.push({ code, kind: "loo", reason: d.reasons.join("; ") }); continue; }
    items.push({
      qid: `p-${code}`, code, kind: "loo",
      query: { file: qf, imgid: String(pr.queryImgid) },
      index: { ...d.index, file: d.index.source === "catalog" ? cf : xf }, notes: d.reasons,
    });
  }
  const out = {
    at: new Date().toISOString(),
    rule: "LỆCH LUẬT 1 (i): bộ P = mã A / B đo được (ảnh thay hợp lệ, có trong danh mục (a)) ∪ cặp VN leave-one-out (loo.json) có mã trong danh mục (a), không trùng mã A / B; ảnh chỉ mục: khóa danh mục nếu imgid khác queryImgid và mã băm > 24 bit, không thì ảnh indexImgid (> 24 bit), không thì bỏ cặp",
    hashMethod: "sharp xám, xoay EXIF, cạnh dài 256 px, cropHashSet / compareHashSets của lib.mjs",
    imgidSource: "khóa danh mục → imgid theo bản xuất OFF vn-products.json (front_xx.rev)",
    n: items.length, nAb: items.filter((x) => x.kind === "ab").length, nLoo: items.filter((x) => x.kind === "loo").length,
    looPairs: (loo.pairs || []).length, items, dropped, download: dl, userAgent: USER_AGENT,
  };
  fs.writeFileSync(path.join(lensDir, "bo-p.json"), JSON.stringify(out, null, 1), "utf8");
  console.log(`Bộ P: |P| = ${out.n} (A/B ${out.nAb}, loo ${out.nLoo}); cặp loo ${out.looPairs}, bỏ ${dropped.length}: ${dropped.map((x) => `${x.code} (${x.kind}: ${x.reason})`).join("; ")}. Ảnh tải ${dl.downloads}, có sẵn ${dl.cached}, lỗi ${dl.fail}.`);
  return pending === 0;
}

/**
 * Đầu vào lens-vec.py (cờ --vao-vec --muc a|b): danh sách ảnh chỉ mục TƯỜNG MINH (buildVecInput) + truy vấn (ca.json +
 * bộ P) + các trường meta chống ăn gian (sha256 chong-an-gian.json / bo-p.json, excluded, override). Ra
 * D:\tmp\lens\vec-vao-<mức>.json. Không đọc / tính ảnh.
 */
function runVecInput(arg) {
  const lensDir = arg("--goc", "D:\\tmp\\lens");
  const anhDir = arg("--out", "D:\\tmp\\lens\\anh");
  const level = arg("--muc", "a");
  if (!Object.hasOwn(LEVEL_FILES, level)) { console.error(`--muc phải là a hoặc b (nhận ${level})`); process.exit(2); }
  if (!onDriveD(lensDir, anhDir)) { console.error("Chỉ ghi vào ổ D."); process.exit(2); }
  const acText = fs.readFileSync(path.join(lensDir, "chong-an-gian.json"), "utf8");
  const bopText = fs.readFileSync(path.join(lensDir, "bo-p.json"), "utf8");
  const ac = JSON.parse(acText);
  const bop = JSON.parse(bopText);
  if (ac.complete !== true) { console.error("chong-an-gian.json chưa complete."); process.exit(3); }
  const ca = JSON.parse(fs.readFileSync(path.join(lensDir, "ca.json"), "utf8"));
  const pFile = new Map(bop.items.map((p) => [p.code, p.index]));
  const fileOf = (code, key) => {
    const m = IMGID_KEY_RE.exec(key);
    if (m) { const p = pFile.get(code); return p && p.key === key && p.file && fs.existsSync(p.file) ? p.file : null; }
    for (const s of SIZES) { const f = path.join(anhDir, fileNameOf(code, key, s)); if (fs.existsSync(f) && fs.statSync(f).size > 0) return f; }
    return null;
  };
  const v = buildVecInput({ rows: readCatalog(LEVEL_FILES[level]), fileOf, ac, bop, queries: ca.queries.map((q) => ({ qid: q.qid, file: q.file })) });
  const sha = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");
  const out = {
    at: new Date().toISOString(), level, antiCheatSha256: sha(acText), boPSha256: sha(bopText), excluded: ac.excluded,
    override: { ...ac.override, ...Object.fromEntries(bop.items.map((p) => [p.code, p.index.key])) },
    indexKey: v.indexKey, indexImgid: v.indexImgid, missing: v.missing, index: v.index, queries: v.queries,
  };
  const f = path.join(lensDir, `vec-vao-${level}.json`);
  fs.writeFileSync(f, JSON.stringify(out), "utf8");
  console.log(`Đầu vào lens-vec mức (${level}): ${v.index.length} ảnh chỉ mục (thiếu file ${v.missing.length}), ${v.queries.length} truy vấn, loại ${ac.excluded.length} mã, override ${Object.keys(out.override).length}. Ghi ${f}.`);
}
