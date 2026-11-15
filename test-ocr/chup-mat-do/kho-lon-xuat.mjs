// Đợt kho-lon vòng 1 (P1): dựng DANH MỤC LỚN theo mức cho máy chủ OCR (ngoài repo, KHÔNG ghi vào repo).
//
//   node --max-old-space-size=4096 test-ocr/chup-mat-do/kho-lon-xuat.mjs [--gz <bản xuất>] [--out D:\tmp\kho-lon\danh-muc]
//        [--luong 6] [--max-gb N (chạy thử: chỉ N GB chữ đầu)]
//
// Mức (thứ tự dòng trong file: mức trước, rồi theo nhóm GROUP_ORDER, rồi mã tăng dần):
//   (a) = ĐÚNG dữ liệu app đang có: public/chup-mat-do/danh-muc-vn.json (1.452 sp, kể cả sp không ảnh, grp "vn") rồi
//         public/chup-mat-do/kho-phu-893.json (5.478 sp, grp "893"), lấy NGUYÊN từ 2 file (không dựng lại), giữ thứ tự
//         của file (danh mục trước, kho phụ sau);
//   (b) = (a) + sản phẩm có tên + ảnh mặt trước (compactProduct của tu-dong-kho-lon.mjs: vnRecord → docText, frontImg,
//         displayName — KHÔNG viết lại luật) thuộc Thái Lan, Nhật, Malaysia, Indonesia, Hàn Quốc, Trung Quốc
//         (countries_tags như GROUPS của tu-dong-kho-lon.mjs), bỏ mã đã có;
//   (c) = (b) + Mỹ (cùng luật).
// Một sản phẩm thuộc nhiều nước → nhóm ĐẦU TIÊN theo GROUP_ORDER (th, jp, my, id, kr, cn, us). Mã trùng trong bản xuất
// → giữ dòng xuất hiện trước trong bản xuất. Dòng: { code, name, brand, img, text, grp } (img "" khi không có ảnh,
// chỉ xảy ra ở mức (a)). File: JSONL nén gzip level 9 (zlib.gzipSync, đầu gzip không có giờ → chạy lại trùng từng byte).
// Ra: <out>\a.jsonl.gz, b.jsonl.gz, c.jsonl.gz + <out>\kho-lon-xuat.json (số sp mỗi nhóm / mức, cỡ thô / gzip, sha256,
// có mặt của các mã cần theo dõi). Đọc bản xuất nhiều luồng như tu-dong-kho-lon.mjs (gunzip trong bộ nhớ).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GROUPS as KL_GROUPS, compactProduct } from "./tu-dong-kho-lon.mjs";
import { vnRecord } from "./vn-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** Nhóm nước thêm ở (b) / (c), theo thứ tự ưu tiên + thứ tự trong file; giá trị = khóa GROUPS của tu-dong-kho-lon.mjs. */
export const FOREIGN_GROUPS = Object.freeze({ th: "thailand", jp: "japan", my: "malaysia", id: "indonesia", kr: "korea", cn: "china", us: "usa" });
export const GROUP_ORDER = Object.freeze(["vn", "893", ...Object.keys(FOREIGN_GROUPS)]);
/** Nhóm của từng mức (mức sau chứa mức trước). */
export const LEVELS = Object.freeze({ a: ["vn", "893"], b: ["vn", "893", "th", "jp", "my", "id", "kr", "cn"], c: GROUP_ORDER.slice() });
/** Chuỗi lọc nhanh trước JSON.parse: tag "en:<nước>" phải có mặt nguyên văn trong dòng (điều kiện cần của countries_tags). */
export const COUNTRY_TAGS = Object.freeze({ th: "en:thailand", jp: "en:japan", my: "en:malaysia", id: "en:indonesia", kr: "en:south-korea", cn: "en:china", us: "en:united-states" });

/** Nhóm nước (theo GROUP_ORDER) của một sản phẩm thô, hoặc null. Dùng đúng luật GROUPS của tu-dong-kho-lon.mjs. */
export function foreignGroupOf(p) {
  for (const [g, k] of Object.entries(FOREIGN_GROUPS)) if (KL_GROUPS[k].is(p)) return g;
  return null;
}

/** Dòng danh mục mức (a) từ sản phẩm của file app (giữ nguyên giá trị; img thiếu → ""). */
export function rowFromApp(p, grp) {
  return { code: String(p.code), name: String(p.name ?? ""), brand: String(p.brand ?? ""), img: String(p.img ?? ""), text: String(p.text ?? ""), grp };
}

/** Một khúc dòng JSONL → [[grp, code, li, chuỗi JSON dòng]] cho các sp nước ngoài có tên + ảnh. */
export function processLines(text) {
  const out = [];
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    let hit = false;
    for (const tag of Object.values(COUNTRY_TAGS)) if (line.includes(`"${tag}"`)) { hit = true; break; }
    if (!hit) continue;
    let p;
    try { p = JSON.parse(line); } catch { continue; }
    const grp = foreignGroupOf(p);
    if (!grp) continue;
    const c = compactProduct(vnRecord(p));
    if (!c || !c.code) continue;
    out.push([grp, c.code, li, JSON.stringify({ code: c.code, name: c.name, brand: c.brand, img: c.img, text: c.text, grp })]);
  }
  return out;
}

/**
 * Ghép các mức từ dòng mức (a) + dòng nước ngoài [{ grp, code, seq, li, s }] (s = chuỗi JSON).
 * Thứ tự: (a) giữ nguyên; nước ngoài theo GROUP_ORDER, trong nhóm mã tăng dần (so chuỗi), mã trùng giữ (seq, li) nhỏ
 * nhất; bỏ mã đã có ở nhóm trước / mức (a). Trả { a: [chuỗi], b: [...], c: [...] } (mảng chuỗi JSON từng dòng).
 */
export function assembleLevels(aRows, foreign) {
  const seen = new Set();
  const a = [];
  for (const r of aRows) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    a.push(JSON.stringify(r));
  }
  const byGrp = new Map();
  for (const f of foreign) {
    if (!byGrp.has(f.grp)) byGrp.set(f.grp, []);
    byGrp.get(f.grp).push(f);
  }
  const addGroups = (groups) => {
    const out = [];
    for (const g of groups) {
      const list = (byGrp.get(g) || []).slice().sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : x.seq - y.seq || x.li - y.li));
      for (const f of list) {
        if (seen.has(f.code)) continue;
        seen.add(f.code);
        out.push(f.s);
      }
    }
    return out;
  };
  const bOnly = addGroups(LEVELS.b.filter((g) => !LEVELS.a.includes(g)));
  const cOnly = addGroups(LEVELS.c.filter((g) => !LEVELS.b.includes(g)));
  const b = [...a, ...bOnly];
  return { a, b, c: [...b, ...cOnly] };
}

/** Chuỗi JSONL của một mức (mỗi dòng một sp, kết thúc bằng "\n"). */
export function levelText(lines) {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Mã cần báo có mặt ở mỗi mức (điền ở main: 30 mã ảnh, 7Up Diet, 6 ca dựng, muối giả). */
async function watchCodes() {
  const { ALL_CODES, SALT_CODE } = await import("./nang-t1-do.mjs");
  const { foreignCases, MO_RONG } = await import("./tu-dong-v42-do.mjs");
  const t1 = await import(pathToFileURL(path.join(ROOT, "public", "chup-mat-do", "t1.mjs")).href);
  const fr = await import(pathToFileURL(path.join(ROOT, "src", "front-rank.js")).href);
  const os = await import(pathToFileURL(path.join(ROOT, "src", "off-search.js")).href);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"), "utf8"));
  const rIndex = fr.buildRankIndex(t1, catalog.products);
  const foreign = foreignCases(JSON.parse(fs.readFileSync(MO_RONG, "utf8")), new Set(catalog.products.map((p) => p.code)), os.strangeWords, rIndex.index.idf);
  return { anh30: ALL_CODES, diet7up: ["8934588752117"], caDung6: foreign.map((f) => f.code), muoiGia: [SALT_CODE] };
}

async function scanForeign(gzFile, nW, maxBytes = Infinity) {
  const t0 = Date.now();
  const foreign = [];
  let lines = 0;
  const pool = Array.from({ length: nW }, () => new Worker(new URL(import.meta.url)));
  const busy = new Map();
  const waiters = [];
  let pending = 0;
  let idle = null;
  for (const w of pool) {
    busy.set(w, 0);
    w.on("message", (m) => {
      if (m.type !== "klx-chunk") return;
      busy.set(w, busy.get(w) - 1);
      lines += m.lines;
      for (const [grp, code, li, s] of m.rows) foreign.push({ grp, code, seq: m.seq, li, s });
      pending--;
      const wake = waiters.shift();
      if (wake) wake();
      if (pending === 0 && idle) { const f = idle; idle = null; f(); }
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
    w.postMessage({ type: "klx-chunk", seq: seq++, ab }, [ab]);
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
      console.log(`  ${(bytes / 1e9).toFixed(1)} GB chữ, ${lines} dòng xong, ${((Date.now() - t0) / 60000).toFixed(1)} phút, ${foreign.length} sp nước ngoài, rss ${(process.memoryUsage().rss / 1e9).toFixed(2)} GB`);
    }
    if (bytes >= maxBytes) { src.destroy(); break; }
  }
  if (accLen) await send(Buffer.concat(acc, accLen));
  if (pending > 0) await new Promise((r) => { idle = r; });
  for (const w of pool) await w.terminate();
  return { foreign, lines, gbChu: +(bytes / 1e9).toFixed(2), minutes: +((Date.now() - t0) / 60000).toFixed(1) };
}

if (!isMainThread) {
  // Lưu ý: tu-dong-kho-lon.mjs (import ở trên) cũng gắn bộ nghe ở luồng phụ cho type "chunk" / "final"; ở đây dùng
  // type "klx-chunk" nên hai bộ nghe không lẫn nhau.
  const dec = new TextDecoder();
  parentPort.on("message", (m) => {
    if (m.type !== "klx-chunk") return;
    const text = dec.decode(new Uint8Array(m.ab));
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    parentPort.postMessage({ type: "klx-chunk", seq: m.seq, lines: n, rows: processLines(text) });
  });
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const outDir = opt("--out", "D:\\tmp\\kho-lon\\danh-muc");
  const gzFile = opt("--gz", "D:\\tmp\\chup-mat-do\\du-lieu\\openfoodfacts-products.jsonl.gz");
  if (!fs.existsSync(gzFile)) throw new Error(`không có ${gzFile} (không tải lại)`);
  const resolvedOut = path.resolve(outDir).toLowerCase();
  if (resolvedOut.startsWith(ROOT.toLowerCase())) throw new Error(`--out không được nằm trong repo (${outDir})`);
  fs.mkdirSync(outDir, { recursive: true });
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", f), "utf8"));
  const aRows = [...read("danh-muc-vn.json").products.map((p) => rowFromApp(p, "vn")), ...read("kho-phu-893.json").products.map((p) => rowFromApp(p, "893"))];
  // --max-gb N: chỉ đọc N GB chữ đầu (chạy thử nhanh; file ra khi đó KHÔNG dùng được để đo)
  const scan = await scanForeign(gzFile, Number(opt("--luong", "6")), Number(opt("--max-gb", "Infinity")) * 1e9);
  const lv = assembleLevels(aRows, scan.foreign);
  const watch = await watchCodes();
  const res = { at: new Date().toISOString(), src: gzFile, lines: scan.lines, gbChu: scan.gbChu, minutes: scan.minutes, levels: {} };
  for (const [name, list] of Object.entries(lv)) {
    const text = levelText(list);
    const buf = zlib.gzipSync(Buffer.from(text, "utf8"), { level: 9 });
    const file = path.join(outDir, `${name}.jsonl.gz`);
    fs.writeFileSync(file, buf);
    const perGrp = {};
    const codes = new Set();
    for (const s of list) {
      const r = JSON.parse(s);
      perGrp[r.grp] = (perGrp[r.grp] || 0) + 1;
      codes.add(r.code);
    }
    const coMat = Object.fromEntries(Object.entries(watch).map(([k, cs]) => [k, { co: cs.filter((c) => codes.has(c)).length, n: cs.length, thieu: cs.filter((c) => !codes.has(c)) }]));
    res.levels[name] = { file, n: list.length, perGrp, raw: Buffer.byteLength(text), gzip: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), coMat };
  }
  // số sp có tên + ảnh mỗi nhóm nước ngoài trước khi bỏ trùng (để đối chiếu kho-lon.json của tu-dong)
  res.foreignRaw = {};
  for (const f of scan.foreign) res.foreignRaw[f.grp] = (res.foreignRaw[f.grp] || 0) + 1;
  const outFile = path.join(outDir, "kho-lon-xuat.json");
  fs.writeFileSync(outFile, JSON.stringify(res, null, 1), "utf8");
  console.log(JSON.stringify(res, null, 1));
  console.log(`Ghi: ${outFile}`);
}
