// P1.2–P1.5 + P2.3 vòng 3: danh mục chữ T1, chọn 1.000 sản phẩm cho chỉ mục ảnh (luật CHỐT, tong-hop-v3.md),
// tải ảnh mặt trước 400 px, dựng bộ phụ leave-one-out, tính vector chỉ mục bằng Node.
//
//   node chup-mat-do/chi-muc-anh.mjs [--step catalog,select,download,loo,embed] [--models clip,dinov2]
//
// Đầu vào: D:\tmp\chup-mat-do\du-lieu\vn-products.json (du-lieu-vn.mjs), ket-qua\chong-an-gian.json,
// test-ocr/photos/NGUON.csv (imgid của front.jpg), test-ocr/truth.csv (chỉ để biết 31 mã thử).
// Ảnh: bucket dữ liệu mở chính thức của OFF trên AWS (tài liệu "how-to-download-images" của OFF:
// https://openfoodfacts-images.s3.eu-west-3.amazonaws.com/data/<thư mục mã>/<imgid>.400.jpg), giãn ≥ 1 giây mỗi ảnh,
// cache D:\tmp\chup-mat-do\chi-muc\anh\, try/catch. Cầu dao như createOffClient: 5 lần hỏng liền nghỉ 10 phút,
// lần 2 ngừng hẳn.
// Mã băm ảnh (bộ phụ): ảnh xám cạnh dài 256 px bằng RawImage của transformers.js (Node dùng sharp bên trong), rồi
// cropHashSet / compareHashSets của lib.mjs (khác chong-an-gian.mjs: ở đó ảnh xám lấy bằng canvas Chromium).
// Ra (không commit): chi-muc\danh-muc-vn.json, chi-muc\chon.json, chi-muc\loo.json, chi-muc\<model>\index.bin + index.json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsv, imgidFromUrl, cropHashSet, compareHashSets, HASH_SUSPECT } from "./lib.mjs";
import { selectIndexProducts, looCandidates, filterLooPairs, queryNotInIndex, docText } from "./vn-data.mjs";
import { makeLimiter, BREAKER_FAILS, BREAKER_PAUSE_MS } from "./off-search.mjs";
import { MODELS, loadEmbedder } from "./embed-models.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const steps = opt("--step", "catalog,select,download,loo,embed").split(",");
const models = opt("--models", "clip,dinov2").split(",");
const N_INDEX = 1000;
const LOO_LIMIT = 100;
const dataDir = "D:\\tmp\\chup-mat-do\\du-lieu";
const outDir = "D:\\tmp\\chup-mat-do\\chi-muc";
const imgDir = path.join(outDir, "anh");
const photosDir = "D:\\quet-ma-vach-full\\test-ocr\\photos";
const downloadBudgetMs = Number(opt("--budget-min", "40")) * 60000; // GIỚI HẠN THỜI GIAN: tải ảnh ≤ 40 phút
fs.mkdirSync(imgDir, { recursive: true });

const readJson = (p, d = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1), "utf8");
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}'] ${m}`);

const records = readJson(path.join(dataDir, "vn-products.json"), []);
const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const nguon = parseCsv(fs.readFileSync(path.join(photosDir, "NGUON.csv"), "utf8"));
const testCodes = truth.map((t) => t.code);
const testImgids = {};
for (const t of truth) {
  const src = nguon.find((r) => r.code === t.code && r.file === "front.jpg");
  if (src) testImgids[t.code] = imgidFromUrl(src.url);
}
const cag = readJson("D:\\tmp\\chup-mat-do\\ket-qua\\chong-an-gian.json");
// mã thử dùng được: 2 mã theo luật tự động + 1 mã dòng phụ (xem tay: khác tấm chụp, điều phối quyết vòng 2)
const SIDE_CODE = "8934572260543";
const SIDE_IMGID = "1";
const testUsable = {};
for (const i of cag.items) if (i.usable && i.manualCheck?.verdict === "khác") testUsable[i.code] = i.chosen.imgid;
testUsable[SIDE_CODE] = SIDE_IMGID;

/** Thư mục ảnh của một mã trên máy chủ ảnh OFF: mã ≥ 9 số tách 3/3/3/phần còn lại, mã ngắn hơn đệm 0 tới 13 số. */
export function imageFolder(code) {
  let c = String(code);
  if (c.length < 9) c = c.padStart(13, "0");
  return c.length > 9 ? `${c.slice(0, 3)}/${c.slice(3, 6)}/${c.slice(6, 9)}/${c.slice(9)}` : c;
}
const imageUrl = (code, imgid) => `https://openfoodfacts-images.s3.eu-west-3.amazonaws.com/data/${imageFolder(code)}/${imgid}.400.jpg`;
const imageFile = (code, imgid) => path.join(imgDir, `${code}_${imgid}.400.jpg`);

// ---- tải ảnh (giãn ≥ 1 giây, cầu dao) ----
const dl = { downloads: 0, cached: 0, errors: 0, http429or5xx: 0, networkErrors: 0, breakerTrips: 0, stoppedByBreaker: false, stoppedByTime: false, bytes: 0, sample: [] };
const limiter = makeLimiter(1000);
let streak = 0;
async function download(code, imgid) {
  const file = imageFile(code, imgid);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { dl.cached++; return true; }
  // ảnh thử dùng được đã tải ở vòng 2 (anh-off): chép, không tải lại
  const prev = path.join("D:\\tmp\\chup-mat-do\\anh-off", `${code}_${imgid}.400.jpg`);
  if (fs.existsSync(prev)) { fs.copyFileSync(prev, file); dl.cached++; return true; }
  if (dl.stoppedByBreaker || dl.stoppedByTime) return false;
  if (Date.now() - t0 > downloadBudgetMs) { dl.stoppedByTime = true; log("dừng tải vì hết giờ"); return false; }
  await limiter.wait();
  dl.downloads++;
  let failMsg = null;
  try {
    const res = await fetch(imageUrl(code, imgid));
    if (res.status === 429 || res.status >= 500) { dl.http429or5xx++; failMsg = `HTTP ${res.status}`; }
    else if (!res.ok) { dl.errors++; dl.sample.push(`${code}/${imgid}: HTTP ${res.status}`); streak = 0; return false; }
    else {
      const b = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, b);
      dl.bytes += b.length;
      streak = 0;
      return true;
    }
  } catch (e) {
    dl.networkErrors++;
    failMsg = `lỗi mạng: ${e.message || e}`;
  }
  dl.errors++;
  dl.sample.push(`${code}/${imgid}: ${failMsg}`);
  if (++streak >= BREAKER_FAILS) {
    streak = 0;
    dl.breakerTrips++;
    if (dl.breakerTrips >= 2) { dl.stoppedByBreaker = true; log(`CẦU DAO NGỪNG HẲN: ${failMsg}`); }
    else { log(`cầu dao: ${BREAKER_FAILS} lần hỏng liền, nghỉ 10 phút`); await new Promise((r) => setTimeout(r, BREAKER_PAUSE_MS)); }
  }
  return false;
}

// ---- 1. danh mục chữ T1 ----
if (steps.includes("catalog")) {
  const docs = records.map((r) => ({ code: r.code, text: docText(r) })).filter((d) => d.text.trim());
  const file = path.join(outDir, "danh-muc-vn.json");
  const raw = JSON.stringify(docs);
  fs.writeFileSync(file, raw, "utf8");
  const gz = zlib.gzipSync(raw, { level: 9 }).length;
  const testIn = testCodes.filter((c) => docs.some((d) => d.code === c));
  const info = { docs: docs.length, rawBytes: Buffer.byteLength(raw), gzipBytes: gz, testCodesInCatalog: testIn.length, testCodesMissing: testCodes.filter((c) => !testIn.includes(c)) };
  writeJson(path.join(outDir, "danh-muc-info.json"), info);
  log(`danh mục: ${JSON.stringify(info)}`);
}

// ---- 2. chọn 1.000 sản phẩm ----
let chon = readJson(path.join(outDir, "chon.json"));
if (steps.includes("select")) {
  const selected = selectIndexProducts(records, { testCodes, testImgids, testUsable, n: N_INDEX });
  chon = { rule: "mã thử dùng được (2 + 1 phụ) + sản phẩm VN có ảnh mặt trước, unique_scans_n giảm dần, completeness giảm dần, mã tăng dần; bỏ ảnh trùng imgid front.jpg của 31 mã", testUsable, testImgids, n: selected.length, selected };
  writeJson(path.join(outDir, "chon.json"), chon);
  log(`chọn ${selected.length} sản phẩm (mã thử: ${selected.filter((s) => s.test).map((s) => s.code).join(", ")})`);
}

// ---- 3. tải ảnh chỉ mục ----
if (steps.includes("download")) {
  let ok = 0;
  for (const [i, s] of chon.selected.entries()) {
    if (await download(s.code, s.imgid)) ok++;
    if (i % 100 === 99) log(`ảnh chỉ mục ${i + 1}/${chon.selected.length}, có ${ok}`);
  }
  chon.downloadStats = { ...dl, ok };
  writeJson(path.join(outDir, "chon.json"), chon);
  log(`ảnh chỉ mục: có ${ok}/${chon.selected.length}; ${JSON.stringify({ ...dl, sample: dl.sample.slice(0, 5) })}`);
}

// ---- 4. bộ phụ leave-one-out ----
async function hashSet(T, file) {
  const img = await T.RawImage.read(file);
  const s = 256 / Math.max(img.width, img.height);
  const g = await img.grayscale().resize(Math.max(8, Math.round(img.width * s)), Math.max(8, Math.round(img.height * s)));
  return cropHashSet(Array.from(g.data), g.width, g.height);
}
let T = null;
async function transformers() {
  if (T) return T;
  T = await import(pathToFileURL(path.join(HERE, "node_modules", "@huggingface", "transformers", "dist", "transformers.node.mjs")).href);
  T.env.cacheDir = "D:\\cache\\hf\\transformers-js";
  return T;
}
if (steps.includes("loo")) {
  await transformers();
  const cands = looCandidates(chon.selected, records, testCodes);
  log(`ứng viên leave-one-out: ${cands.length}`);
  const distances = {};
  const usedCands = [];
  let kept = 0;
  let queryDownloads = 0; // lượt tải ảnh truy vấn (ghi riêng, tổng hợp không trừ chon − loo)
  for (const c of cands) {
    if (kept >= LOO_LIMIT) break;
    const a = imageFile(c.code, c.indexImgid);
    if (!fs.existsSync(a)) continue; // ảnh chỉ mục chưa tải được
    usedCands.push(c);
    const before = dl.downloads;
    const okQ = await download(c.code, c.queryImgid);
    queryDownloads += dl.downloads - before;
    if (!okQ) { distances[c.code] = null; continue; }
    try {
      const cmp = compareHashSets(await hashSet(T, a), await hashSet(T, imageFile(c.code, c.queryImgid)));
      distances[c.code] = cmp.distance;
      if (cmp.distance > HASH_SUSPECT) kept++;
    } catch (e) {
      distances[c.code] = null;
      log(`  mã băm lỗi ${c.code}: ${e.message || e}`);
    }
  }
  const { pairs, dropped } = filterLooPairs(usedCands, distances, { maxDup: HASH_SUSPECT, limit: LOO_LIMIT });
  const index = chon.selected.map((s) => ({ code: s.code, imgid: s.imgid }));
  const loo = { candidates: cands.length, checked: usedCands.length, pairs, dropped, queryNotInIndex: queryNotInIndex(pairs, index), queryDownloads, downloadStats: { ...dl } };
  writeJson(path.join(outDir, "loo.json"), loo);
  log(`bộ phụ: ${pairs.length} cặp (loại ${dropped.length}); ảnh truy vấn không nằm trong chỉ mục: ${loo.queryNotInIndex}`);
}

// ---- 5. vector chỉ mục (Node) ----
if (steps.includes("embed")) {
  await transformers();
  for (const name of models) {
    const dir = path.join(outDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const tl = Date.now();
    const embed = await loadEmbedder(T, name);
    const loadMs = Date.now() - tl;
    const items = chon.selected.filter((s) => fs.existsSync(imageFile(s.code, s.imgid)));
    const dims = MODELS[name].dims;
    const buf = new Int8Array(items.length * dims);
    const meta = [];
    const te = Date.now();
    for (const [i, s] of items.entries()) {
      try {
        const v = await embed(imageFile(s.code, s.imgid));
        for (let j = 0; j < dims; j++) buf[meta.length * dims + j] = Math.max(-127, Math.min(127, Math.round(v[j] * 127)));
        meta.push({ code: s.code, imgid: s.imgid });
      } catch (e) {
        log(`  vector lỗi ${s.code}/${s.imgid}: ${e.message || e}`);
      }
      if (i % 200 === 199) log(`${name}: ${i + 1}/${items.length}`);
    }
    const bin = Buffer.from(buf.buffer, 0, meta.length * dims);
    fs.writeFileSync(path.join(dir, "index.bin"), bin);
    const metaRaw = JSON.stringify({ model: MODELS[name], dims, quant: "int8 (v × 127, làm tròn)", items: meta });
    fs.writeFileSync(path.join(dir, "index.json"), metaRaw, "utf8");
    const info = {
      n: meta.length, dims, loadMs, embedSecondsMedianish: (Date.now() - te) / 1000 / Math.max(1, meta.length),
      rawBytes: bin.length + Buffer.byteLength(metaRaw), gzipBytes: zlib.gzipSync(bin, { level: 9 }).length + zlib.gzipSync(metaRaw, { level: 9 }).length,
    };
    writeJson(path.join(dir, "info.json"), info);
    log(`${name}: ${JSON.stringify(info)}`);
  }
}
