// Đo máy chủ OCR (server/) trên 30 ảnh front.jpg: bật uvicorn trên 127.0.0.1, gửi tuần tự, chấm T1 2 đường, so chữ
// với R1 Python của ocr-mat (r1-nocls-v4), đo giây + RAM đỉnh, rồi TẮT máy chủ (kể cả khi lỗi). Không thuộc app.
// Chỉ ĐỌC test-ocr/ và public/chup-mat-do/ (không sửa luật nào).
//
//   node server/do-30-anh.mjs --threads 8 --name may-chu-t8 [--venv D:\tmp\may-chu-1\venv] [--out D:\tmp\may-chu-1\ket-qua]
//
// Chấm:
//   (A) như ocr-mat: { items: [{ text, conf, box }] } -> scoreImages của test-ocr/chup-mat-do/t1-ocr.mjs
//       (ocrLines -> t1QueryFromLines -> buildBm25 / bm25Search -> rankOf), cùng danh mục VN như t1-ocr.mjs.
//   (B) như trang thử: items poly / score -> ocrItems / rowLineInfo / t1QueryFromLines / bm25Search của
//       public/chup-mat-do/t1.mjs trên danh mục public/chup-mat-do/danh-muc-vn.json (đúng đường của chup-mat-do.html).
// So chữ: từng khung với D:\tmp\ocr-mat\ocr\r1-nocls-v4\<mã>__front.json (text trùng, box lệch ≤ 0,5 px, conf lệch ≤ 1e-4);
//   câu tìm + top5 đường (A) với D:\tmp\ocr-mat\ket-qua\r1-nocls-v4.json. Không nới ngưỡng.
// Giới hạn lượt của máy chủ đặt RATE_LIMIT_PER_MIN=1000 CHỈ trong lượt đo (30 ảnh tuần tự < 1 phút sẽ chạm 20/phút).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, rankOf, scoreHits, summarize, median, maxOf } from "../test-ocr/chup-mat-do/lib.mjs";
import { buildBm25 as buildBm25A } from "../test-ocr/chup-mat-do/vn-data.mjs";
import { displayName } from "../test-ocr/chup-mat-do/xuat-danh-muc.mjs";
import { scoreImages, compareWithT1, sampleCodes } from "../test-ocr/chup-mat-do/t1-ocr.mjs";
import * as pageT1 from "../public/chup-mat-do/t1.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}`;
const BOX_TOL = 0.5;
const CONF_TOL = 1e-4;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

const threads = Number(arg("threads", "8"));
const name = arg("name", `may-chu-t${threads}`);
const venv = arg("venv", "D:\\tmp\\may-chu-1\\venv");
const outDir = arg("out", "D:\\tmp\\may-chu-1\\ket-qua");
const ocrOut = arg("ocr-out", path.join("D:\\tmp\\may-chu-1\\ocr", name));
const photos = arg("photos", "D:\\quet-ma-vach-full\\test-ocr\\photos");
const refDir = arg("ref", "D:\\tmp\\ocr-mat\\ocr\\r1-nocls-v4");
const refResult = arg("ref-result", "D:\\tmp\\ocr-mat\\ket-qua\\r1-nocls-v4.json");
const catalogFile = arg("catalog", "D:\\tmp\\chup-mat-do\\chi-muc\\danh-muc-vn.json");
const productsFile = arg("products", "D:\\tmp\\chup-mat-do\\du-lieu\\vn-products.json");
const pageCatalogFile = path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json");
if (!(threads >= 1)) { console.error("--threads phải ≥ 1"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portOpen() {
  try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; }
}

/** So khung chữ máy chủ với file R1 Python; trả danh sách lệch (rỗng = trùng). */
export function compareItems(got, ref) {
  const diffs = [];
  if (got.length !== ref.length) diffs.push(`số khung ${got.length} ≠ ${ref.length}`);
  for (let i = 0; i < Math.min(got.length, ref.length); i++) {
    const g = got[i], r = ref[i];
    if (g.text !== r.text) diffs.push(`khung ${i}: chữ "${g.text}" ≠ "${r.text}"`);
    for (const k of ["minX", "minY", "maxX", "maxY"]) {
      if (!(Math.abs(g.box[k] - r.box[k]) <= BOX_TOL)) diffs.push(`khung ${i}: box.${k} ${g.box[k]} ≠ ${r.box[k]}`);
    }
    if (!(Math.abs(g.conf - r.conf) <= CONF_TOL)) diffs.push(`khung ${i}: conf ${g.conf} ≠ ${r.conf}`);
  }
  return diffs;
}

async function main() {
  if (await portOpen()) throw new Error(`Cổng ${PORT} đang có máy chủ khác: tắt nó trước khi đo.`);
  const truth = parseCsv(fs.readFileSync(path.join(ROOT, "test-ocr", "truth.csv"), "utf8"));
  const codes = sampleCodes(truth, (c) => fs.existsSync(path.join(photos, c, "front.jpg")));
  if (codes.length !== 30) throw new Error(`Cần 30 ảnh, thấy ${codes.length}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(ocrOut, { recursive: true });
  const rssFile = path.join(outDir, `${name}-rss.json`);
  const logFile = path.join(outDir, `${name}-server.log`);
  try { fs.unlinkSync(rssFile); } catch { /* chưa có */ }

  const D = "D:\\tmp\\may-chu-1";
  const env = {
    ...process.env, TEMP: `${D}\\tmp`, TMP: `${D}\\tmp`, PIP_CACHE_DIR: `${D}\\pip-cache`, HF_HOME: `${D}\\hf`, MODELSCOPE_CACHE: `${D}\\ms`,
    PYTHONDONTWRITEBYTECODE: "1", PYTHONUTF8: "1", OCR_THREADS: String(threads), OCR_OFFLINE: "1", CORS_ALLOW_LOCALHOST: "1", AUTH_MODE: "off",
    RATE_LIMIT_PER_MIN: "1000",
  };
  const py = path.join(venv, "Scripts", "python.exe");
  const t0 = performance.now();
  const server = spawn(py, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(PORT), "--workers", "1", "--no-access-log"],
    { cwd: HERE, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const logStream = fs.createWriteStream(logFile);
  let serverLog = "";
  const onData = (b) => { const s = b.toString("utf8"); serverLog += s; logStream.write(s); };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  let exited = false;
  server.on("exit", () => { exited = true; });
  const rss = spawn(py, [path.join(HERE, "do_rss.py"), "--pid", String(server.pid), "--out", rssFile, "--interval", "0.2"],
    { env, stdio: "ignore", windowsHide: true });
  const rssDone = new Promise((r) => rss.on("exit", r));

  const rows = [];
  let loadWall = null;
  try {
    for (let i = 0; i < 1200 && !exited; i++) {  // chờ tối đa 120 giây
      try {
        const h = await (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) })).json();
        if (h.modelLoaded) { loadWall = (performance.now() - t0) / 1000; break; }
      } catch { /* chưa lên */ }
      await sleep(100);
    }
    if (loadWall == null) throw new Error(`Máy chủ không lên được. Log:\n${serverLog.slice(-2000)}`);
    console.log(`Máy chủ lên sau ${loadWall.toFixed(2)} giây (OCR_THREADS=${threads}).`);

    for (const [k, code] of codes.entries()) {
      const buf = fs.readFileSync(path.join(photos, code, "front.jpg"));
      const fd = new FormData();
      fd.append("image", new Blob([buf], { type: "image/jpeg" }), "front.jpg");
      const c0 = performance.now();
      const res = await fetch(`${BASE}/ocr`, { method: "POST", body: fd, signal: AbortSignal.timeout(120000) });
      const j = await res.json();
      const client = (performance.now() - c0) / 1000;
      if (res.status !== 200) throw new Error(`${code}: HTTP ${res.status} ${JSON.stringify(j)}`);
      const file = { code, model: "may-chu r1-nocls", order: k + 1, width: j.width, height: j.height, seconds: client, status: "ok",
        ms: j.ms, msOcr: j.msOcr, items: j.items.map((it) => ({ text: it.text, conf: it.conf, box: it.box })), raw: j.items };
      fs.writeFileSync(path.join(ocrOut, `${code}__front.json`), JSON.stringify(file), "utf8");
      rows.push({ code, client, ms: j.ms, msOcr: j.msOcr, width: j.width, height: j.height, origWidth: j.origWidth, origHeight: j.origHeight, json: j });
      console.log(`${String(k + 1).padStart(2)}/30 ${code} ${j.items.length} khung, khách ${client.toFixed(2)} s, máy chủ ${(j.ms / 1000).toFixed(2)} s (OCR ${(j.msOcr / 1000).toFixed(2)} s)`);
    }
  } finally {
    if (!exited) server.kill();
    for (let i = 0; i < 100 && !exited; i++) await sleep(100);
    await Promise.race([rssDone, sleep(5000)]);
    logStream.end();
    console.log(`Máy chủ đã tắt: ${exited ? "có" : "KHÔNG (kiểm tay)"}; cổng ${PORT} còn nghe: ${(await portOpen()) ? "CÓ" : "không"}.`);
  }

  // ---- (A) như ocr-mat ----
  const docs = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const indexA = buildBm25A(docs);
  const info = new Map(JSON.parse(fs.readFileSync(productsFile, "utf8")).map((r) => [r.code, { name: displayName(r.names), brands: r.brands || "" }]));
  const truthByCode = new Map(truth.map((t) => [t.code, t]));
  const ocrByCode = new Map(rows.map((r) => [r.code, { status: "ok", seconds: r.client, items: r.json.items.map((it) => ({ text: it.text, conf: it.conf, box: it.box })) }]));
  const A = scoreImages({ codes, ocrByCode, index: indexA, info, truthByCode });
  const ref = JSON.parse(fs.readFileSync(refResult, "utf8"));
  const cmpA = compareWithT1(A.items, ref.items);

  // ---- (B) như trang thử ----
  const pageCat = JSON.parse(fs.readFileSync(pageCatalogFile, "utf8"));
  const indexB = pageT1.buildBm25(pageCat.products);
  const B = rows.map((r) => {
    const items = pageT1.ocrItems([{ items: r.json.items }]);
    const lines = pageT1.rowLineInfo(items);
    const q = pageT1.t1QueryFromLines(lines);
    const hits = q.length ? pageT1.bm25Search(indexB, q, 5) : [];
    const full = hits.map((h) => ({ code: h.code, name: info.get(h.code)?.name ?? "", brands: info.get(h.code)?.brands ?? "" }));
    return { ma: r.code, query: q.join(" "), top5: hits.map((h) => h.code), ...scoreHits(full, truthByCode.get(r.code) || { code: r.code }) };
  });
  const sumB = summarize(B);
  const sameAB = B.filter((b, i) => b.query === A.items[i].query && JSON.stringify(b.top5) === JSON.stringify(A.items[i].top5)).length;

  // ---- so chữ với R1 Python ----
  const textCmp = rows.map((r) => {
    const refFile = path.join(refDir, `${r.code}__front.json`);
    const refJ = JSON.parse(fs.readFileSync(refFile, "utf8"));
    const sizeOk = refJ.width === r.width && refJ.height === r.height;
    const diffs = compareItems(r.json.items, refJ.items);
    if (!sizeOk) diffs.unshift(`cỡ ảnh ${r.width}×${r.height} ≠ ${refJ.width}×${refJ.height}`);
    return { ma: r.code, same: diffs.length === 0, diffs };
  });
  const textSame = textCmp.filter((x) => x.same).length;

  const client = rows.map((r) => r.client), srv = rows.map((r) => r.ms / 1000), ocr = rows.map((r) => r.msOcr / 1000);
  let rssJ = null;
  try { rssJ = JSON.parse(fs.readFileSync(rssFile, "utf8")); } catch { /* do_rss chưa ghi */ }
  const loadLog = /nạp model ([\d.]+) giây/.exec(serverLog);
  const out = {
    name, threads, at: new Date().toISOString(), loadWallSeconds: loadWall, loadModelSeconds: loadLog ? Number(loadLog[1]) : null,
    rssPeakMB: rssJ?.peakMB ?? null, rssSamples: rssJ?.samples ?? null,
    seconds: {
      client: { median: median(client), max: maxOf(client) }, server: { median: median(srv), max: maxOf(srv) }, ocr: { median: median(ocr), max: maxOf(ocr) },
    },
    A: { summary: A.summary, soR1Python: { same: cmpA.same, total: cmpA.total, diffs: cmpA.diffs }, items: A.items },
    B: { summary: sumB, sameAsA: sameAB, items: B },
    text: { same: textSame, total: rows.length, boxTol: BOX_TOL, confTol: CONF_TOL, diffs: textCmp.filter((x) => !x.same) },
    perImage: rows.map((r) => ({ ma: r.code, client: +r.client.toFixed(3), ms: r.ms, msOcr: r.msOcr, width: r.width, height: r.height, origWidth: r.origWidth, origHeight: r.origHeight, boxes: r.json.items.length })),
  };
  const outFile = path.join(outDir, `${name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");

  const f = (x) => (x == null ? "?" : x.toFixed(2));
  console.log(`(A) như ocr-mat: vị trí 1 ${A.summary.top1}/30, 5 đầu ${A.summary.top5}/30 (đích 13 / 22); câu tìm + top5 trùng r1-nocls-v4 ${cmpA.same}/${cmpA.total}`);
  for (const d of cmpA.diffs) console.log(`  LỆCH (A) ${d.ma}: mới "${d.moi.query}" | cũ "${d.cu.query ?? d.cu}"`);
  console.log(`(B) như trang thử: vị trí 1 ${sumB.top1}/30, 5 đầu ${sumB.top5}/30; trùng (A) câu tìm + top5 ${sameAB}/30`);
  console.log(`Chữ trùng R1 Python (box ≤ ${BOX_TOL} px, conf ≤ ${CONF_TOL}): ${textSame}/30`);
  for (const x of textCmp.filter((y) => !y.same)) console.log(`  LỆCH chữ ${x.ma}: ${x.diffs.slice(0, 5).join("; ")}`);
  console.log(`Giây/ảnh khách: trung vị ${f(out.seconds.client.median)}, lớn nhất ${f(out.seconds.client.max)}; máy chủ (ms): ${f(out.seconds.server.median)} / ${f(out.seconds.server.max)}; OCR: ${f(out.seconds.ocr.median)} / ${f(out.seconds.ocr.max)}`);
  console.log(`Nạp: lên sau ${f(loadWall)} s (model ${f(out.loadModelSeconds)} s); RSS đỉnh ${rssJ?.peakMB ?? "?"} MB (${rssJ?.samples ?? 0} mẫu / 0,2 s)`);
  console.log(`Ghi: ${outFile}`);
  const okAll = A.summary.top1 === 13 && A.summary.top5 === 22 && textSame === 30 && cmpA.same === 30 && rssJ && rssJ.peakMB < 900;
  if (!okAll) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`LỖI: ${e.message}`); process.exitCode = 1; });
}
