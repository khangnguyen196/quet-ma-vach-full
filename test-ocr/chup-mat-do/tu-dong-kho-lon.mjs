// Đợt tu-dong vòng 5 (P1b): đọc luồng bản xuất JSONL 08/11/2026 MỘT lần (gunzip trong bộ nhớ, không giải nén ra đĩa,
// KHÔNG tải lại 13 GB), ra:
//   (1) số liệu chuẩn bị đợt "kho-lon": theo nhóm (bán ở VN, mã 893, Thái Lan, Hàn Quốc, Nhật, Malaysia, Indonesia,
//       Trung Quốc, Mỹ, toàn cầu) số sản phẩm có tên + ảnh mặt trước, cỡ danh mục gọn (đúng định dạng catalogJson của
//       xuat-danh-muc.mjs: thô + gzip level 9), ước bộ nhớ chỉ mục BM25 nếu đặt trên máy chủ (cách ước: MEM_NOTE);
//   (2) số sản phẩm VN / 893 có last_modified_t trong 7 / 30 ngày trước mốc (08/11/2026 00:00 UTC, và trước lần sửa mới
//       nhất trong bản xuất) để biết bản xuất cũ nhanh cỡ nào;
//   (3) bản ghi VN dựng lại đúng cách du-lieu-vn.mjs (isVn → vnRecord, theo thứ tự bản xuất) để dựng lại danh mục app
//       và so từng byte (bước --so-danh-muc, không đọc bản xuất).
//
//   node --max-old-space-size=3072 test-ocr/chup-mat-do/tu-dong-kho-lon.mjs [--gz <file>] [--out D:\tmp\tu-dong\ket-qua]
//   node test-ocr/chup-mat-do/tu-dong-kho-lon.mjs --so-danh-muc [--out D:\tmp\tu-dong\ket-qua]
//
// Ra (không commit, không ghi public/): <out>\kho-lon.json, <out>\vn-products-lam-moi.json,
// <out>\danh-muc-vn-lam-moi.json (+ kết quả so byte trong <out>\danh-muc-so-byte.json).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { isVn, vnRecord, docText, docTokens } from "./vn-data.mjs";
import { displayName, frontImg, catalogMeta, catalogJson } from "./xuat-danh-muc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** Nhóm đếm: tên → luật trên sản phẩm thô (đã JSON.parse). */
export const GROUPS = Object.freeze({
  vn: { ten: "Bán ở Việt Nam (en:vietnam)", is: (p) => isVn(p) },
  "893": { ten: "Mã 13 số đầu 893", is: (p) => /^893\d{10}$/.test(String(p?.code ?? "")) },
  thailand: { ten: "Thái Lan", is: (p) => hasCountry(p, "en:thailand") },
  korea: { ten: "Hàn Quốc", is: (p) => hasCountry(p, "en:south-korea") },
  japan: { ten: "Nhật", is: (p) => hasCountry(p, "en:japan") },
  malaysia: { ten: "Malaysia", is: (p) => hasCountry(p, "en:malaysia") },
  indonesia: { ten: "Indonesia", is: (p) => hasCountry(p, "en:indonesia") },
  china: { ten: "Trung Quốc", is: (p) => hasCountry(p, "en:china") },
  usa: { ten: "Mỹ", is: (p) => hasCountry(p, "en:united-states") },
  world: { ten: "Toàn cầu (mọi sản phẩm)", is: () => true },
});

function hasCountry(p, tag) {
  return Array.isArray(p?.countries_tags) && p.countries_tags.includes(tag);
}

/** Bản ghi (vnRecord) có tên không (ít nhất một product_name* khác rỗng). */
export function hasName(r) {
  return Object.values(r?.names || {}).some((v) => typeof v === "string" && v.trim() !== "");
}

/** Sản phẩm danh mục gọn (đúng dạng xuat-danh-muc.mjs / nang-t1-danh-muc.mjs catalogProduct) hoặc null khi thiếu tên
 *  hoặc thiếu ảnh mặt trước. */
export function compactProduct(r) {
  if (!r || !hasName(r)) return null;
  const img = frontImg(r.fronts);
  if (!img) return null;
  return { code: r.code, name: displayName(r.names), brand: r.brands || "", img, text: docText(r) };
}

/** Mốc "bản xuất 08/11/2026" (UTC, giây). */
export const EXPORT_REF_T = Date.UTC(2026, 10, 8) / 1000;
export const DAY_S = 86400;

/** Cách ước bộ nhớ chỉ mục BM25 trên máy chủ (một tiến trình, mảng kiểu cố định, không phải Map của JS). */
export const MEM_NOTE = "ước = mục ngược × 8 B (Int32 số tài liệu + Float32 tf) + từ vựng × 64 B (bảng băm + chữ ngắn) + tài liệu × 32 B (độ dài, vị trí, mã) + chữ hiển thị (cỡ thô danh mục). Từ đếm như buildBm25 (bm25Tokens + bí danh, mỗi từ khác nhau trong 1 tài liệu = 1 mục ngược); chữ không phải Latin (Thái, Hàn, Nhật, Trung) bị normalizeText bỏ nên nhóm châu Á có ít từ hơn thực tế.";
export function memEstimate({ postings, vocab, docs, raw }) {
  return postings * 8 + vocab * 64 + docs * 32 + raw;
}

// ---- HyperLogLog (ước số từ vựng nhóm "toàn cầu" mà không giữ hết từ trong bộ nhớ) ----
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
export function makeHll(p = 14) {
  const m = 1 << p;
  const reg = new Uint8Array(m);
  return {
    reg,
    /** Gộp thanh ghi của một HLL khác (cùng p). */
    merge(other) { for (let j = 0; j < m; j++) if (other[j] > reg[j]) reg[j] = other[j]; },
    add(s) {
      const h = hash32(s);
      const j = h >>> (32 - p);
      const w = (h << p) >>> 0;
      const rho = w === 0 ? 32 - p + 1 : Math.clz32(w) + 1;
      if (rho > reg[j]) reg[j] = rho;
    },
    count() {
      let sum = 0;
      let zeros = 0;
      for (let j = 0; j < m; j++) { sum += 2 ** -reg[j]; if (!reg[j]) zeros++; }
      const alpha = 0.7213 / (1 + 1.079 / m);
      let e = alpha * m * m / sum;
      if (e <= 2.5 * m && zeros) e = m * Math.log(m / zeros);
      return Math.round(e);
    },
  };
}

/** Bộ đếm một nhóm: số sp, số có tên + ảnh, cỡ thô / gzip (luồng gzip level 9 đúng thứ tự bản xuất), mục ngược, từ vựng. */
function makeGroup(name) {
  const g = { name, all: 0, nameFront: 0, raw: 0, gzip: 0, postings: 0, pend: [], pendBytes: 0, first: true };
  g.gz = zlib.createGzip({ level: 9 });
  g.gz.on("data", (d) => { g.gzip += d.length; });
  g.done = new Promise((r) => g.gz.on("end", r));
  return g;
}
async function flush(g) {
  if (!g.pend.length) return;
  const chunk = g.pend.join("");
  g.pend = [];
  g.pendBytes = 0;
  if (!g.gz.write(chunk)) await new Promise((r) => g.gz.once("drain", r));
}
function push(g, s) {
  g.pend.push(s);
  g.raw += Buffer.byteLength(s);
  g.pendBytes += s.length;
}

/** Nhóm có từ vựng đếm đúng (Set); nhóm lớn (Mỹ, toàn cầu) ước bằng HyperLogLog (sai số ≈ 1 %) cho đỡ bộ nhớ. */
const EXACT_VOCAB = (k) => k !== "world" && k !== "usa";
const freshZero = () => ({ vn7: 0, vn30: 0, b7: 0, b30: 0, vnAll: 0, b893All: 0, maxT: 0, vnMaxT: 0 });

/** Phần việc của MỘT luồng phụ (worker) trên một khúc dòng JSONL: trả chuỗi danh mục gọn theo nhóm + số đếm; từ vựng
 *  giữ ở state của luồng phụ (gộp ở cuối). seq: số khúc (để xếp bản ghi VN đúng thứ tự bản xuất). */
export function processChunk(text, seq, state) {
  const out = { seq, lines: 0, bad: 0, groups: {}, vn: [] };
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    out.lines++;
    let p;
    try { p = JSON.parse(line); } catch { out.bad++; continue; }
    const f = state.fresh;
    const t = Number(p.last_modified_t);
    if (Number.isFinite(t) && t > f.maxT) f.maxT = t;
    const vn = isVn(p);
    const rec = vnRecord(p);
    if (vn) {
      if (rec.code) out.vn.push([li, rec]);
      f.vnAll++;
      if (Number.isFinite(t)) {
        if (t > f.vnMaxT) f.vnMaxT = t;
        if (t >= EXPORT_REF_T - 7 * DAY_S) f.vn7++;
        if (t >= EXPORT_REF_T - 30 * DAY_S) f.vn30++;
      }
    }
    if (GROUPS["893"].is(p)) {
      f.b893All++;
      if (Number.isFinite(t)) {
        if (t >= EXPORT_REF_T - 7 * DAY_S) f.b7++;
        if (t >= EXPORT_REF_T - 30 * DAY_S) f.b30++;
      }
    }
    const member = Object.keys(GROUPS).filter((k) => GROUPS[k].is(p));
    const c = compactProduct(rec);
    const s = c ? JSON.stringify(c) : null;
    const toks = c ? [...new Set(docTokens(c.text))] : null;
    for (const k of member) {
      const g = (out.groups[k] ||= { all: 0, nameFront: 0, postings: 0, parts: [] });
      g.all++;
      if (!c) continue;
      g.nameFront++;
      g.postings += toks.length;
      g.parts.push(s);
      const v = (state.vocab[k] ||= EXACT_VOCAB(k) ? new Set() : makeHll());
      for (const w of toks) v.add(w);
    }
  }
  for (const g of Object.values(out.groups)) { g.text = g.parts.join(",\n"); delete g.parts; }
  return out;
}

async function scan(gzFile, outDir, { maxBytes = Infinity, workers: nW = 6 } = {}) {
  const t0 = Date.now();
  const groups = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, makeGroup(k)]));
  let lines = 0;
  let bad = 0;
  const vnParts = [];
  const pool = Array.from({ length: nW }, () => new Worker(new URL(import.meta.url)));
  const busy = new Map(); // worker → số khúc đang chờ
  const waiters = [];
  let pending = 0;
  let allDone = null;
  const onResult = async (r) => {
    lines += r.lines;
    bad += r.bad;
    for (const [li, rec] of r.vn) vnParts.push([r.seq, li, rec]);
    for (const [k, gr] of Object.entries(r.groups)) {
      const g = groups[k];
      g.all += gr.all;
      g.nameFront += gr.nameFront;
      g.postings += gr.postings;
      if (gr.text) { push(g, (g.first ? "" : ",\n") + gr.text); g.first = false; }
      if (g.pendBytes > (4 << 20)) await flush(g);
    }
  };
  for (const w of pool) {
    busy.set(w, 0);
    w.on("message", async (m) => {
      if (m.type !== "chunk") return;
      busy.set(w, busy.get(w) - 1);
      pending--;
      await onResult(m.r);
      const wake = waiters.shift();
      if (wake) wake();
      if (pending === 0 && allDone) allDone();
    });
  }
  const pick = () => [...busy.entries()].sort((a, b) => a[1] - b[1])[0];
  let seq = 0;
  let bytes = 0;
  let lastLog = Date.now();
  const send = async (buf) => {
    while (pick()[1] >= 2) await new Promise((r) => waiters.push(r));
    const [w] = pick();
    busy.set(w, busy.get(w) + 1);
    pending++;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    w.postMessage({ type: "chunk", seq: seq++, ab }, [ab]);
  };
  const src = fs.createReadStream(gzFile, { highWaterMark: 1 << 20 }).pipe(zlib.createGunzip({ chunkSize: 1 << 20 }));
  let acc = [];
  let accLen = 0;
  for await (const chunk of src) {
    acc.push(chunk);
    accLen += chunk.length;
    bytes += chunk.length;
    if (accLen >= (16 << 20)) {
      const all = Buffer.concat(acc, accLen);
      const cut = all.lastIndexOf(10);
      await send(all.subarray(0, cut + 1));
      const rest = all.subarray(cut + 1);
      acc = rest.length ? [Buffer.from(rest)] : [];
      accLen = rest.length;
    }
    if (Date.now() - lastLog > 60000) {
      lastLog = Date.now();
      console.log(`  ${(bytes / 1e9).toFixed(1)} GB chữ, ${lines} dòng xong, ${((Date.now() - t0) / 60000).toFixed(1)} phút, toàn cầu tên+ảnh ${groups.world.nameFront}, rss ${(process.memoryUsage().rss / 1e9).toFixed(2)} GB`);
    }
    if (bytes >= maxBytes) { src.destroy(); break; }
  }
  if (accLen) await send(Buffer.concat(acc, accLen));
  if (pending) await new Promise((r) => { allDone = r; });
  // gộp trạng thái các luồng phụ: từ vựng (Set hợp / HLL lấy max thanh ghi), số mới sửa
  const fresh = freshZero();
  const vocab = {};
  for (const w of pool) {
    const st = await new Promise((r) => { w.once("message", r); w.postMessage({ type: "final" }); });
    for (const k of ["vn7", "vn30", "b7", "b30", "vnAll", "b893All"]) fresh[k] += st.fresh[k];
    fresh.maxT = Math.max(fresh.maxT, st.fresh.maxT);
    fresh.vnMaxT = Math.max(fresh.vnMaxT, st.fresh.vnMaxT);
    for (const [k, v] of Object.entries(st.vocab)) {
      if (Array.isArray(v)) { vocab[k] ||= new Set(); for (const x of v) vocab[k].add(x); }
      else { vocab[k] ||= makeHll(); vocab[k].merge(v); }
    }
    await w.terminate();
  }
  vnParts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const vnRecords = vnParts.map((x) => x[2]);
  const out = { at: new Date().toISOString(), src: gzFile, lines, bad, gbChu: +(bytes / 1e9).toFixed(2), minutes: +((Date.now() - t0) / 60000).toFixed(1), workers: nW, memNote: MEM_NOTE, gzipNote: "gzip level 9 một luồng cho phần sản phẩm (thứ tự theo khúc xong trước) + gzip riêng phần meta đầu / đuôi: ước, lệch vài trăm byte so với file thật", groups: {} };
  for (const [k, g] of Object.entries(groups)) {
    const meta = catalogMeta({ withNameBrand: true, count: g.nameFront, date: "2026-11-08", nguon: `Open Food Facts (https://world.openfoodfacts.org), bản xuất JSONL chính thức 08/11/2026, nhóm ${GROUPS[k].ten}, có tên + ảnh mặt trước` });
    const head = `{"meta":${JSON.stringify(meta)},\n"products":[\n`;
    const tail = "\n]}\n";
    // gzip một luồng: phần đầu viết sau (đã mở luồng với sản phẩm) không đúng thứ tự → ước: cộng gzip riêng của head + tail
    await flush(g);
    g.gz.end();
    await g.done;
    const extraRaw = Buffer.byteLength(head) + Buffer.byteLength(tail);
    const extraGz = zlib.gzipSync(head + tail, { level: 9 }).length;
    const v = vocab[k];
    const nVocab = !v ? 0 : v instanceof Set ? v.size : v.count();
    const raw = g.raw + extraRaw;
    out.groups[k] = {
      ten: GROUPS[k].ten, tatCa: g.all, coTenAnh: g.nameFront, raw, gzip: g.gzip + extraGz,
      tuVung: nVocab, tuVungUoc: !EXACT_VOCAB(k), mucNguoc: g.postings, boNhoUoc: memEstimate({ postings: g.postings, vocab: nVocab, docs: g.nameFront, raw }),
    };
  }
  out.moiSua = {
    moc: "2026-11-08T00:00:00Z", lanSuaMoiNhat: fresh.maxT ? new Date(fresh.maxT * 1000).toISOString() : null,
    vnLanSuaMoiNhat: fresh.vnMaxT ? new Date(fresh.vnMaxT * 1000).toISOString() : null,
    vn: { tatCa: fresh.vnAll, sua7Ngay: fresh.vn7, sua30Ngay: fresh.vn30 },
    ma893: { tatCa: fresh.b893All, sua7Ngay: fresh.b7, sua30Ngay: fresh.b30 },
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "vn-products-lam-moi.json"), JSON.stringify(vnRecords), "utf8");
  fs.writeFileSync(path.join(outDir, "kho-lon.json"), JSON.stringify(out, null, 1), "utf8");
  console.log(JSON.stringify(out, null, 1));
  console.log(`Ghi: ${path.join(outDir, "kho-lon.json")} + vn-products-lam-moi.json (${vnRecords.length} bản ghi VN)`);
}

/** Dựng danh mục app từ bản ghi VN đúng cách cũ: chi-muc-anh.mjs (docs = { code, text: docText } bỏ text trống, thứ tự
 *  bản ghi) + xuat-danh-muc.mjs (name / brand / img / text, meta với ngày cho trước). Trả chuỗi file. */
export function rebuildCatalogText(records, date) {
  const docs = records.map((r) => ({ code: r.code, text: docText(r) })).filter((d) => d.text.trim());
  const byCode = new Map(records.map((r) => [r.code, r]));
  const products = docs.map((d) => {
    const r = byCode.get(d.code);
    const img = frontImg(r.fronts);
    return { code: d.code, name: displayName(r.names), brand: r.brands || "", ...(img ? { img } : {}), text: d.text };
  });
  return catalogJson(catalogMeta({ withNameBrand: true, count: products.length, date }), products);
}

function compareCatalog(outDir) {
  const appFile = path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json");
  const appBuf = fs.readFileSync(appFile);
  const app = JSON.parse(appBuf.toString("utf8"));
  const records = JSON.parse(fs.readFileSync(path.join(outDir, "vn-products-lam-moi.json"), "utf8"));
  // Ngày xuất của file app giữ nguyên (ngày chạy lệnh không phải dữ liệu); mọi byte khác phải trùng.
  const s = rebuildCatalogText(records, app.meta.ngayXuat);
  const outFile = path.join(outDir, "danh-muc-vn-lam-moi.json");
  fs.writeFileSync(outFile, s, "utf8");
  const buf = Buffer.from(s, "utf8");
  let firstDiff = -1;
  for (let i = 0; i < Math.max(buf.length, appBuf.length); i++) if (buf[i] !== appBuf[i]) { firstDiff = i; break; }
  const fresh = JSON.parse(s).products;
  const appCodes = new Set(app.products.map((p) => p.code));
  const freshCodes = new Set(fresh.map((p) => p.code));
  // Bản ghi VN cũ (vn-products.json, cùng bản xuất 08/11) cũng so để biết lệch ở bước nào nếu có
  let oldSame = null;
  try {
    const old = JSON.parse(fs.readFileSync("D:\\tmp\\chup-mat-do\\du-lieu\\vn-products.json", "utf8"));
    oldSame = JSON.stringify(old) === JSON.stringify(records);
  } catch { /* không có file cũ */ }
  const res = {
    at: new Date().toISOString(), appFile, appBytes: appBuf.length, freshBytes: buf.length, sameBytes: firstDiff < 0, firstDiff,
    appN: app.products.length, freshN: fresh.length, onlyApp: [...appCodes].filter((c) => !freshCodes.has(c)).length,
    onlyFresh: [...freshCodes].filter((c) => !appCodes.has(c)).length, vnRecords: records.length, vnRecordsSameAsOld: oldSame,
    appGzip: zlib.gzipSync(appBuf, { level: 9 }).length, freshGzip: zlib.gzipSync(buf, { level: 9 }).length,
  };
  fs.writeFileSync(path.join(outDir, "danh-muc-so-byte.json"), JSON.stringify(res, null, 1), "utf8");
  console.log(JSON.stringify(res, null, 1));
}

if (!isMainThread) {
  // Luồng phụ: nhận khúc dòng (ArrayBuffer chuyển quyền, không chép), trả kết quả; "final" → trạng thái từ vựng + số mới sửa.
  const state = { fresh: freshZero(), vocab: {} };
  const dec = new TextDecoder();
  parentPort.on("message", (m) => {
    if (m.type === "chunk") parentPort.postMessage({ type: "chunk", r: processChunk(dec.decode(new Uint8Array(m.ab)), m.seq, state) });
    else if (m.type === "final") {
      const vocab = Object.fromEntries(Object.entries(state.vocab).map(([k, v]) => [k, v instanceof Set ? [...v] : v.reg]));
      parentPort.postMessage({ type: "final", fresh: state.fresh, vocab });
    }
  });
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const outDir = opt("--out", "D:\\tmp\\tu-dong\\ket-qua");
  if (argv.includes("--so-danh-muc")) compareCatalog(outDir);
  else {
    const gzFile = opt("--gz", "D:\\tmp\\chup-mat-do\\du-lieu\\openfoodfacts-products.jsonl.gz");
    if (!fs.existsSync(gzFile)) throw new Error(`không có ${gzFile} (không tải lại)`);
    // --max-gb N: chỉ đọc N GB chữ đầu (chạy thử nhanh; số liệu khi đó KHÔNG dùng được); --luong N: số luồng phụ
    await scan(gzFile, outDir, { maxBytes: Number(opt("--max-gb", "Infinity")) * 1e9, workers: Number(opt("--luong", "6")) });
  }
}
