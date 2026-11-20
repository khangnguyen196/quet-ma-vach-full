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

// ---------------- chạy ----------------
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const level = arg("--muc", "a");
  if (!Object.hasOwn(LEVEL_FILES, level)) { console.error(`--muc phải là a hoặc b (nhận ${level})`); process.exit(2); }
  const minutes = Number(arg("--phut", "7.5"));
  if (!(minutes > 0 && minutes < 8)) { console.error("--phut phải trong (0, 8)"); process.exit(2); }
  const outDir = arg("--out", "D:\\tmp\\lens\\anh");
  const rootDir = arg("--goc", "D:\\tmp\\lens");
  if (!/^[dD]:/.test(path.resolve(outDir)) || !/^[dD]:/.test(path.resolve(rootDir))) { console.error("Chỉ ghi vào ổ D."); process.exit(2); }
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
