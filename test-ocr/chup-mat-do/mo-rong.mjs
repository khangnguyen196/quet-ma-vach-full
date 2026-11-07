// P3 vòng 4: bộ phụ mở rộng cho cách 2 + T1 + RRF (THAM KHẢO: chỉ mục có thêm sản phẩm ngoài VN, khác chỉ mục app).
// Luật CHỐT ở đầu D:\tmp\chup-mat-do\ket-qua\tong-hop-v4.md (vn-data.mjs extCandidate / extRankCompare / extPair).
//
//   node chup-mat-do/mo-rong.mjs --step scan        đọc lại bản xuất JSONL trên máy (luồng gzip, KHÔNG tải lại)
//   node chup-mat-do/mo-rong.mjs --step pairs       tải ảnh 400 px (bucket AWS, giãn ≥ 1 giây, cầu dao), kiểm cặp ≤ 24 bit
//   node chup-mat-do/mo-rong.mjs --step catalog     danh mục T1 mở rộng + chép ảnh truy vấn cho 1a + danh sách ảnh chỉ mục
//
// Ra (không commit): chi-muc\mo-rong\ung-vien.json, cap.json, danh-muc.json, loo-photos\<mã>\front.jpg.
// Chỉ mục ảnh mở rộng (vector CLIP) tính bằng do-trinh-duyet.mjs --ext (Chromium), không ghi đè chỉ mục vòng 3.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsv, cropHashSet, compareHashSets, HASH_SUSPECT } from "./lib.mjs";
import { extCandidateFromLine, extRankCompare, extPair, EXT_PRIORITY_COUNTRIES, docText, queryNotInIndex } from "./vn-data.mjs";
import { makeLimiter, BREAKER_FAILS, BREAKER_PAUSE_MS } from "./off-search.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const step = opt("--step", "scan");
const gzFile = "D:\\tmp\\chup-mat-do\\du-lieu\\openfoodfacts-products.jsonl.gz";
const idxDir = "D:\\tmp\\chup-mat-do\\chi-muc";
const outDir = path.join(idxDir, "mo-rong");
const imgDir = path.join(idxDir, "anh-mo-rong");
const PAIR_LIMIT = 100;
const CHECK_LIMIT = 300;
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(imgDir, { recursive: true });
const readJson = (p, d = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1), "utf8");
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}'] ${m}`);
const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const testCodes = new Set(truth.map((t) => t.code));

// ---- 1. đọc bản xuất ----
if (step === "scan") {
  if (!fs.existsSync(gzFile)) throw new Error(`không có ${gzFile} (không tải lại)`);
  // Lượt 1: chỉ dòng có nước ưu tiên. Nhóm còn lại chỉ đọc (lượt 2, --all) khi nhóm ưu tiên không đủ CHECK_LIMIT.
  const all = argv.includes("--all");
  const rl = readline.createInterface({ input: fs.createReadStream(gzFile).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const cands = [];
  let lines = 0;
  for await (const line of rl) {
    lines++;
    if (lines % 500000 === 0) log(`${lines} dòng, ${cands.length} ứng viên`);
    const c = extCandidateFromLine(line, testCodes, { priorityOnly: !all });
    if (c) cands.push(c);
  }
  cands.sort(extRankCompare);
  const byCountry = Object.fromEntries(EXT_PRIORITY_COUNTRIES.map((k) => [k, cands.filter((c) => c.priorityTags.includes(k)).length]));
  const stats = { lines, minutes: (Date.now() - t0) / 60000, mode: all ? "mọi dòng" : "chỉ dòng có nước ưu tiên", group0: cands.filter((c) => c.group === 0).length, group1: all ? cands.filter((c) => c.group === 1).length : null, byCountry };
  writeJson(path.join(outDir, "ung-vien.json"), { stats, candidates: cands });
  log(JSON.stringify(stats));
}

// ---- 2. tải ảnh + kiểm cặp ----
/** Thư mục ảnh của một mã trên máy chủ ảnh OFF (như chi-muc-anh.mjs imageFolder). */
function imageFolder(code) {
  let c = String(code);
  if (c.length < 9) c = c.padStart(13, "0");
  return c.length > 9 ? `${c.slice(0, 3)}/${c.slice(3, 6)}/${c.slice(6, 9)}/${c.slice(9)}` : c;
}
const imageUrl = (code, imgid) => `https://openfoodfacts-images.s3.eu-west-3.amazonaws.com/data/${imageFolder(code)}/${imgid}.400.jpg`;
const imageFile = (code, imgid) => path.join(imgDir, `${code}_${imgid}.400.jpg`);
const budgetMs = Number(opt("--budget-min", "30")) * 60000; // tổng chờ bucket ảnh ≤ 30 phút
const dl = { downloads: 0, cached: 0, errors: 0, http429or5xx: 0, networkErrors: 0, breakerTrips: 0, stoppedByBreaker: false, stoppedByTime: false, bytes: 0, sample: [] };
const limiter = makeLimiter(1000);
let streak = 0;
async function download(code, imgid) {
  const file = imageFile(code, imgid);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { dl.cached++; return true; }
  if (dl.stoppedByBreaker || dl.stoppedByTime) return false;
  if (Date.now() - t0 > budgetMs) { dl.stoppedByTime = true; log("dừng tải vì hết giờ"); return false; }
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
async function hashSet(T, file) {
  const img = await T.RawImage.read(file);
  const s = 256 / Math.max(img.width, img.height);
  const g = await img.grayscale().resize(Math.max(8, Math.round(img.width * s)), Math.max(8, Math.round(img.height * s)));
  return cropHashSet(Array.from(g.data), g.width, g.height);
}

if (step === "pairs") {
  const T = await import(pathToFileURL(path.join(HERE, "node_modules", "@huggingface", "transformers", "dist", "transformers.node.mjs")).href);
  T.env.cacheDir = "D:\\cache\\hf\\transformers-js";
  const { candidates } = readJson(path.join(outDir, "ung-vien.json"));
  const checked = []; // mọi ứng viên đã kiểm (đã thử tải)
  const pairs = [];
  const dropped = [];
  let queryDownloads = 0;
  for (const c of candidates) {
    if (pairs.length >= PAIR_LIMIT || checked.length >= CHECK_LIMIT || dl.stoppedByBreaker || dl.stoppedByTime) break;
    const p = extPair(c);
    if (!p) continue;
    checked.push({ ...p, group: c.group, priorityTags: c.priorityTags });
    const okIdx = await download(p.code, p.indexImgid);
    const before = dl.downloads;
    const okQ = okIdx ? await download(p.code, p.queryImgid) : false;
    queryDownloads += dl.downloads - before;
    const rec = checked.at(-1);
    rec.indexOk = okIdx;
    rec.queryOk = okQ;
    if (!okIdx || !okQ) { dropped.push({ ...p, reason: okIdx ? "không tải được ảnh truy vấn" : "không tải được ảnh chỉ mục" }); continue; }
    try {
      const cmp = compareHashSets(await hashSet(T, imageFile(p.code, p.indexImgid)), await hashSet(T, imageFile(p.code, p.queryImgid)));
      rec.distance = cmp.distance;
      if (cmp.distance <= HASH_SUSPECT) dropped.push({ ...p, distance: cmp.distance, reason: `gần trùng ${cmp.distance} bit` });
      else pairs.push({ ...p, distance: cmp.distance });
    } catch (e) {
      dropped.push({ ...p, reason: `mã băm lỗi: ${e.message || e}` });
    }
    if (checked.length % 25 === 0) log(`đã kiểm ${checked.length}, ${pairs.length} cặp`);
  }
  // chỉ mục mở rộng = 970 ảnh VN + ảnh chỉ mục của MỌI ứng viên đã tải (kể cả cặp bị loại)
  const chon = readJson(path.join(idxDir, "chon.json"));
  const extIndex = checked.filter((c) => c.indexOk).map((c) => ({ code: c.code, imgid: c.indexImgid }));
  const fullIndex = [...chon.selected.map((s) => ({ code: s.code, imgid: s.imgid })), ...extIndex];
  const out = {
    rule: `dừng khi ${PAIR_LIMIT} cặp hoặc đã kiểm ${CHECK_LIMIT} ứng viên; cặp ≤ ${HASH_SUSPECT} bit loại`,
    checked: checked.length, pairs, dropped, extIndex,
    queryNotInIndex: queryNotInIndex(pairs, fullIndex),
    downloadStats: { ...dl, sample: dl.sample.slice(0, 20) },
    queryDownloads,
    minutes: (Date.now() - t0) / 60000,
  };
  writeJson(path.join(outDir, "cap.json"), out);
  log(`cặp ${pairs.length}, loại ${dropped.length}, đã kiểm ${checked.length}; ảnh truy vấn không nằm trong chỉ mục: ${out.queryNotInIndex}; ${JSON.stringify({ ...dl, sample: undefined })}`);
}

// ---- 3. danh mục T1 mở rộng + ảnh truy vấn cho 1a ----
if (step === "catalog") {
  const cap = readJson(path.join(outDir, "cap.json"));
  const { candidates } = readJson(path.join(outDir, "ung-vien.json"));
  const byCode = new Map(candidates.map((c) => [c.code, c]));
  const vnDocs = readJson(path.join(idxDir, "danh-muc-vn.json"));
  const have = new Set(vnDocs.map((d) => d.code));
  // đúng các sản phẩm có ảnh trong chỉ mục mở rộng
  const extDocs = cap.extIndex.map((x) => byCode.get(x.code)).filter((r) => r && !have.has(r.code)).map((r) => ({ code: r.code, text: docText(r) })).filter((d) => d.text.trim());
  const docs = [...vnDocs, ...extDocs];
  writeJson(path.join(outDir, "danh-muc.json"), docs);
  const photos = path.join(outDir, "loo-photos");
  for (const p of cap.pairs) {
    fs.mkdirSync(path.join(photos, p.code), { recursive: true });
    fs.copyFileSync(imageFile(p.code, p.queryImgid), path.join(photos, p.code, "front.jpg"));
  }
  log(`danh mục mở rộng: ${vnDocs.length} VN + ${extDocs.length} ngoài VN = ${docs.length}; chép ${cap.pairs.length} ảnh truy vấn vào ${photos}`);
}

// ---- 4. T1 / ảnh / T1 + ảnh trên chỉ mục + danh mục mở rộng (RRF k = 60, hòa điểm T1 trước như rrf.mjs) ----
if (step === "rrf") {
  const { rrf, rankOf, CONF_SCALE } = await import("./lib.mjs");
  const { buildBm25, bm25Search, t1QueryFromLines } = await import("./vn-data.mjs");
  const cap = readJson(path.join(outDir, "cap.json"));
  const loo = readJson(path.join(idxDir, "loo.json"));
  const index = buildBm25(readJson(path.join(outDir, "danh-muc.json")));
  const ketQua = path.join(path.dirname(idxDir), "ket-qua");
  const ocrDir = path.join(path.dirname(idxDir), "ocr");
  const img = readJson(path.join(ketQua, "cach2-clip-chromium-mo-rong.json")).run;
  const imgTop = new Map((img.results || []).map((r) => [r.id, r.top5 || []]));
  const t1Top = (file) => {
    if (!fs.existsSync(file)) return null;
    const ocr = JSON.parse(fs.readFileSync(file, "utf8"));
    if (ocr.status !== "ok") return null;
    const lines = (ocr.lines || []).map((l) => (l.conf == null ? l : { ...l, conf: Number(l.conf) / CONF_SCALE.paddlejs }));
    return bm25Search(index, t1QueryFromLines(lines), 5).map((h) => h.code);
  };
  const row = (id, code, ocrFile, set) => {
    const t1 = t1Top(ocrFile);
    const im = imgTop.get(id) || [];
    const fused = rrf([t1 || [], im], 60).slice(0, 5).map((x) => x.code);
    return { id, set, code, ocrOk: t1 != null, imgOk: imgTop.has(id), t1: t1 || [], img: im, rrf: fused, t1Rank: rankOf(t1 || [], code), imgRank: rankOf(im, code), rrfRank: rankOf(fused, code) };
  };
  const rows = [
    ...loo.pairs.map((p) => row(`loo-${p.code}`, p.code, path.join(ocrDir, "loo-1a", "paddlejs-rows-chromium",`${p.code}__front.json`), "goc")),
    ...cap.pairs.map((p) => row(`ext-${p.code}`, p.code, path.join(ocrDir, "mo-rong-1a", "paddlejs-rows-chromium",`${p.code}__front.json`), "mo-rong")),
  ];
  const score = (rs) => {
    const c = (k, f) => rs.filter((r) => f(r[k])).length;
    return { n: rs.length, ocrOk: rs.filter((r) => r.ocrOk).length, imgOk: rs.filter((r) => r.imgOk).length,
      t1: { top1: c("t1Rank", (x) => x === 1), top5: c("t1Rank", (x) => x != null) },
      img: { top1: c("imgRank", (x) => x === 1), top5: c("imgRank", (x) => x != null) },
      rrf: { top1: c("rrfRank", (x) => x === 1), top5: c("rrfRank", (x) => x != null) } };
  };
  const out = { k: 60, note: "mỗi danh sách 5 kết quả đầu; T1 từ chữ 1a PaddleOCR.js Chromium trên danh mục mở rộng; ảnh CLIP Chromium trên chỉ mục mở rộng; RRF hòa điểm thì T1 đứng trước", catalogDocs: index.N, goc: score(rows.filter((r) => r.set === "goc")), moRong: score(rows.filter((r) => r.set === "mo-rong")), gop: score(rows), rows };
  writeJson(path.join(ketQua, "rrf-mo-rong.json"), out);
  log(JSON.stringify({ goc: out.goc, moRong: out.moRong, gop: out.gop }));
}
