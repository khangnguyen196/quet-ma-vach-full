// P5 vòng 5 (+ vòng 6): kiểm trang thử chup-mat-do.html bằng Playwright (Chromium + WebKit).
//
//   node chup-mat-do/trang-thu-check.mjs [--no-build] [--browsers chromium,webkit | --browser webkit] [--all] [--gap <giây>]
//                                         [--base <url>] [--out <file.json>] [--ocr 1a|r1]
//
// - Đợt thu-r1: --ocr 1a|r1 mở chup-mat-do.html?ocr=<…> (không có --ocr = trang mặc định, không tham số). Ghi request tới
//   R1 (ModelScope / repo PP-OCRv6 trên HuggingFace) lúc mở trang (trước lần bấm đầu: phải 0) và cả lượt (--ocr 1a hoặc
//   mặc định: phải 0). Top5 so với kết quả đã đo: 1a / mặc định -> t1.json; r1 -> D:\tmp\ocr-mat\ket-qua\
//   r1-trinh-duyet-<trình duyệt>.json (R1-trình-duyệt của đợt ocr-mat).
// - Mặc định: npm run build (trong worktree), phục vụ dist/ bằng máy chủ tĩnh 127.0.0.1 (cổng ngẫu nhiên).
//   Vòng 6: --base <url> (vd https://khangnguyen196.github.io/quet-ma-vach-full/) thì KHÔNG build, KHÔNG dựng server,
//   mở thẳng địa chỉ đó.
// - Mỗi trình duyệt (ngữ cảnh mới, cache trống): mở chup-mat-do.html, chọn lần lượt front.jpg theo thứ tự truth.csv
//   (mặc định 3 mã ĐẦU TIÊN có ảnh, chốt trước; vòng 6: --all = mọi mã có ảnh), bấm "Nhận ra sản phẩm", chờ ≤ 90 giây /
//   ảnh (ảnh đầu gồm cả tải PaddleOCR); ghi top5, mã đúng ở vị trí 1 / trong 5 đầu, giây. --gap <giây>: giãn giữa 2 ảnh
//   (mặc định 0; Pages dùng 5).
// - Ghi mọi request: không có request tới openfoodfacts.org; không có POST; chỉ cùng tên miền + jsDelivr / HuggingFace
//   (gồm máy chủ tải file của HuggingFace *.hf.co / *.huggingface.co).
// - Vòng 6, bước service worker (ngữ cảnh mới): mở index.html, chờ service worker điều khiển trang, mở chup-mat-do.html,
//   tải lại -> phải vẫn là trang thử (có nút #run, tiêu đề "Thử nhận ra sản phẩm", không phải index.html); Cache Storage
//   không có URL chứa "chup-mat-do", "ocr-thu", không có URL khác tên miền.
// - index.html của app vẫn mở được (ngữ cảnh mới, không lỗi trang).
// - WebKit trên Windows: chạy thẳng, không lớp thay; lỗi thì ghi lỗi thật.
// Ra (mặc định): D:\tmp\chup-mat-do\ket-qua\trang-thu-local.json (3 ảnh), trang-thu-local-30.json (--all),
//   trang-thu-pages.json (--base). Kèm so top5 với T1 của 1a đã đo (t1.json) nếu có.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsv, rankOf, median, maxOf } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const DIST = path.join(ROOT, "dist");
const PHOTOS = "D:\\quet-ma-vach-full\\test-ocr\\photos";
const K = "D:\\tmp\\chup-mat-do\\ket-qua";
const PER_IMAGE_MS = 90000;
const TEST_TITLE = "Thử nhận ra sản phẩm";

/** Đọc tùy chọn dòng lệnh. --base có thì không build (và không dựng server). */
export function parseCheckArgs(argv) {
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  let base = opt("--base", null);
  if (base != null) {
    if (!/^https?:\/\//.test(base)) throw new Error(`--base phải là địa chỉ http(s): ${base}`);
    if (!base.endsWith("/")) base += "/";
  }
  const gapSeconds = Number(opt("--gap", "0"));
  if (!Number.isFinite(gapSeconds) || gapSeconds < 0) throw new Error(`--gap phải là số giây ≥ 0: ${opt("--gap")}`);
  const all = argv.includes("--all");
  const browsers = (argv.includes("--browser") ? opt("--browser") : opt("--browsers", "chromium,webkit")).split(",").filter(Boolean);
  const ocr = opt("--ocr", null);
  if (ocr != null && ocr !== "1a" && ocr !== "r1") throw new Error(`--ocr phải là 1a hoặc r1: ${ocr}`);
  const defOut = (base ? "trang-thu-pages" : all ? "trang-thu-local-30" : "trang-thu-local") + (ocr ? `-${ocr}` : "") + ".json";
  return { base, build: !base && !argv.includes("--no-build"), all, gapSeconds, browsers, ocr, out: opt("--out", path.join(K, defOut)) };
}

/** Địa chỉ trang thử: có ocr thì thêm ?ocr=<…>, không có thì trang mặc định (không tham số). */
export function pageUrl(base, ocr) {
  return base + "chup-mat-do.html" + (ocr ? `?ocr=${encodeURIComponent(ocr)}` : "");
}

/** Ảnh thử theo thứ tự truth.csv, bỏ mã không có ảnh; mặc định 3 ảnh đầu, all = mọi ảnh. */
export function pickImages(truth, hasPhoto, all) {
  const items = truth.filter((t) => hasPhoto(t.code));
  return all ? items : items.slice(0, 3);
}

/** Thống kê một trình duyệt: x/n vị trí 1 và 5 đầu (ảnh lỗi tính sai), giây ảnh đầu (gồm tải PaddleOCR) tách riêng,
 *  trung vị / lớn nhất các ảnh sau (ảnh lỗi tính giây thật). */
export function runStats(runs) {
  const n = runs.length;
  const ok = runs.filter((r) => !r.error);
  const rest = runs.slice(1).map((r) => r.seconds);
  return {
    top1: `${ok.filter((r) => r.rank === 1).length}/${n}`, top5: `${ok.filter((r) => r.inTop5).length}/${n}`, errors: n - ok.length,
    firstSeconds: runs[0]?.seconds ?? null, restMedianSeconds: median(rest), restMaxSeconds: maxOf(rest),
  };
}

/** So top5 của trang với top5 T1 đã đo (t1.json tools["1a-<trình duyệt>"].items, khóa `ma`). Ảnh lỗi / không có = lệch. */
export function compareTop5(runs, refItems) {
  const diff = [];
  let same = 0;
  for (const r of runs) {
    const i = (refItems || []).find((x) => x.ma === r.code);
    if (i && !r.error && i.top5.join(",") === (r.top5 || []).join(",")) same++;
    else diff.push(r.code);
  }
  return { same, n: runs.length, diff };
}

/** Kiểm Cache Storage: không có URL chứa chup-mat-do / ocr-thu, không có URL khác tên miền (ngoài `base`). */
export function cacheCheck(urls, base) {
  const own = new URL(base).origin;
  const rel = (u) => (u.startsWith(base) ? u.slice(base.length) : u);
  const chupMatDo = urls.filter((u) => /chup-mat-do/.test(u)).map(rel);
  const ocrThu = urls.filter((u) => /ocr-thu/.test(u)).map(rel);
  const foreign = urls.filter((u) => new URL(u).origin !== own);
  return { total: urls.length, chupMatDo, ocrThu, foreign, ok: !chupMatDo.length && !ocrThu.length && !foreign.length };
}

/** Host được phép: cùng tên miền (127.0.0.1), jsDelivr, HuggingFace (cả máy chủ tải file), ModelScope của R1: đúng
 *  www.modelscope.cn + máy chủ tải file cdn-lfs-*.modelscope.cn (đo ở thu-r1 P1.0: www.modelscope.cn trả 302 sang
 *  cdn-lfs-cn-1.modelscope.cn). So cả tên miền (neo đầu + cuối), không so chuỗi con. */
export function allowedHost(host, own) {
  return host === own || host === "cdn.jsdelivr.net" || host === "huggingface.co" || /(^|\.)huggingface\.co$/.test(host) || /(^|\.)hf\.co$/.test(host) ||
    host === "www.modelscope.cn" || /^cdn-lfs(-[a-z0-9]+)*\.modelscope\.cn$/.test(host);
}

/** Request tới R1: ModelScope hoặc repo PP-OCRv6 trên HuggingFace. */
export function r1Requests(reqs) {
  return reqs.filter((r) => /(^|\.)modelscope\.cn$/.test(r.host) || /PP-OCRv6/.test(r.url));
}

/** Tóm tắt request: số request, POST, request tới openfoodfacts.org, host lạ. */
export function requestSummary(reqs, own) {
  const hosts = [...new Set(reqs.map((r) => r.host))].sort();
  return {
    total: reqs.length, hosts,
    post: reqs.filter((r) => r.method !== "GET" && r.method !== "HEAD").map((r) => `${r.method} ${r.url}`),
    openfoodfacts: reqs.filter((r) => /openfoodfacts\.org$/.test(r.host)).map((r) => r.url),
    foreign: hosts.filter((h) => !allowedHost(h, own)),
    r1: r1Requests(reqs).map((r) => r.url),
  };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".ico": "image/x-icon" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bước service worker trong ngữ cảnh mới. */
async function swStep(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const out = { swControlledIndex: false, testPageControlledBySw: null, title: null, isTestPage: false, reloadIsTestPage: false, cache: null, ok: false, error: null };
  try {
    const page = await ctx.newPage();
    await page.goto(base + "index.html");
    out.swControlledIndex = await page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 60000 }).then(() => true, () => false);
    await page.goto(base + "chup-mat-do.html");
    await page.waitForFunction(() => window.__chupMatDo && "ready" in window.__chupMatDo, null, { timeout: 60000 }).catch(() => {});
    out.testPageControlledBySw = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
    out.isTestPage = (await page.locator("#run").count()) === 1 && (await page.title()) === TEST_TITLE;
    await page.reload();
    await page.waitForFunction(() => window.__chupMatDo && "ready" in window.__chupMatDo, null, { timeout: 60000 }).catch(() => {});
    out.title = await page.title();
    out.reloadIsTestPage = (await page.locator("#run").count()) === 1 && out.title === TEST_TITLE;
    out.reloadReady = await page.evaluate(() => (window.__chupMatDo ? window.__chupMatDo.ready : null));
    const urls = await page.evaluate(async () => {
      const list = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) list.push(req.url);
      }
      return list;
    });
    out.cache = cacheCheck(urls, base);
    out.ok = out.swControlledIndex && out.isTestPage && out.reloadIsTestPage && out.cache.ok;
  } catch (e) {
    out.error = String(e.message || e).slice(0, 300);
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseCheckArgs(process.argv.slice(2));
  const report = { startedAt: new Date().toISOString(), finishedAt: null, args, build: null, images: [], browsers: {} };
  if (args.build) {
    const t0 = Date.now();
    const b = spawnSync("npm run build", { cwd: ROOT, shell: true, encoding: "utf8" });
    report.build = { status: b.status, seconds: (Date.now() - t0) / 1000, tail: (b.stdout + b.stderr).trim().split("\n").slice(-4) };
    if (b.status !== 0) { fs.writeFileSync(args.out, JSON.stringify(report, null, 1)); throw new Error("build lỗi"); }
  }
  const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
  const items = pickImages(truth, (c) => fs.existsSync(path.join(PHOTOS, c, "front.jpg")), args.all);
  report.images = items.map((t) => t.code);

  let server = null;
  let base = args.base;
  if (!base) {
    server = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const f = path.join(DIST, path.normalize(u === "/" ? "/index.html" : u));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  report.base = base;
  const own = new URL(base).hostname;
  const t1ref = fs.existsSync(path.join(K, "t1.json")) ? JSON.parse(fs.readFileSync(path.join(K, "t1.json"), "utf8")) : null;
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);

  for (const name of args.browsers) {
    const out = { startedAt: new Date().toISOString(), runs: [], requests: null, app: null, sw: null, error: null, consoleErrors: [] };
    report.browsers[name] = out;
    const launch = { headless: true };
    if (name === "chromium" && process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
    let browser;
    try {
      browser = await pw[name].launch(launch);
      out.browserVersion = browser.version();
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      const reqs = [];
      page.on("request", (r) => {
        const u = r.url();
        if (!/^https?:/.test(u)) return; // blob: / data:
        reqs.push({ url: u.slice(0, 300), method: r.method(), host: new URL(u).hostname });
      });
      page.on("console", (m) => { if (m.type() === "error") out.consoleErrors.push(m.text().slice(0, 300)); });
      page.on("pageerror", (e) => out.consoleErrors.push(`pageerror: ${e.message}`.slice(0, 300)));
      out.url = pageUrl(base, args.ocr);
      await page.goto(out.url);
      await page.waitForFunction(() => window.__chupMatDo && "ready" in window.__chupMatDo, null, { timeout: 60000 });
      await sleep(1000);
      out.ready = await page.evaluate(() => ({ ready: window.__chupMatDo.ready, error: window.__chupMatDo.error || null, title: document.title, ocr: window.__chupMatDo.ocr ?? null, select: document.getElementById("ocrPick")?.value ?? null, notice: document.getElementById("notice")?.textContent || "" }));
      out.r1RequestsOnOpen = r1Requests(reqs).length; // trước lần bấm đầu: phải 0 (kể cả ?ocr=r1)
      for (const [k, t] of items.entries()) {
        if (k > 0 && args.gapSeconds > 0) await sleep(args.gapSeconds * 1000);
        const row = { code: t.code };
        const a = Date.now();
        try {
          const before = await page.evaluate(() => window.__chupMatDo.runs.length);
          await page.setInputFiles("#pickLibrary", path.join(PHOTOS, t.code, "front.jpg"));
          await page.waitForFunction(() => /Ảnh sẵn sàng|Không mở được/.test(document.getElementById("status").textContent), null, { timeout: 30000 });
          await page.click("#run");
          await page.waitForFunction((n) => window.__chupMatDo.runs.length > n, before, { timeout: PER_IMAGE_MS, polling: 250 });
          const r = await page.evaluate(() => JSON.parse(JSON.stringify(window.__chupMatDo.runs.at(-1))));
          const rank = rankOf(r.top5 || [], t.code);
          Object.assign(row, { ocr: r.ocr ?? null, modelLoadSeconds: r.modelLoadSeconds ?? null, timing: await page.locator("#timing").textContent().catch(() => null), seconds: (Date.now() - a) / 1000, ocrSeconds: r.ocrSeconds ?? null, loadSeconds: r.loadSeconds ?? null, searchMs: r.searchMs ?? null, lines: r.lines ?? null, top5: r.top5 || [], rank, top1: rank === 1, inTop5: rank != null, error: r.error || null, shownHits: await page.locator("#hits li").count() });
        } catch (e) {
          Object.assign(row, { seconds: (Date.now() - a) / 1000, error: String(e.message || e).slice(0, 300), top1: false, inTop5: false });
        }
        out.runs.push(row);
        console.log(`${name} ${t.code}: ${row.error ? `LỖI ${row.error}` : `${row.seconds.toFixed(1)} s (đọc ${row.ocrSeconds?.toFixed(1)} s${row.loadSeconds != null ? `, tải ${row.loadSeconds.toFixed(1)} s` : ""}), rank ${row.rank ?? "-"}, ${row.lines} dòng`}`);
        if (row.error && /closed|crash/i.test(row.error)) break;
      }
      out.requests = requestSummary(reqs, own);
      out.stats = runStats(out.runs);
      if (args.ocr === "r1") {
        const f = path.join("D:\\tmp\\ocr-mat\\ket-qua", `r1-trinh-duyet-${name}.json`);
        const ref = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).items : null;
        if (ref) out.vsRef = { ref: f, ...compareTop5(out.runs, ref) };
      } else {
        const ref = t1ref?.tools?.[`1a-${name}`]?.items;
        if (ref) out.vs1a = { ref: `t1.json tools["1a-${name}"]`, ...compareTop5(out.runs, ref) };
      }
      await ctx.close();
      out.sw = await swStep(browser, base);
      console.log(`${name} service worker: ${JSON.stringify(out.sw)}`);
      // app chính vẫn mở được
      const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p2 = await ctx2.newPage();
      const errs = [];
      p2.on("pageerror", (e) => errs.push(e.message.slice(0, 300)));
      const resp = await p2.goto(base + "index.html");
      await p2.waitForLoadState("load");
      out.app = { status: resp?.status() ?? null, title: await p2.title(), hasBody: (await p2.evaluate(() => document.body.innerText.trim().length)) > 0, pageErrors: errs };
      await ctx2.close();
    } catch (e) {
      out.error = String(e.message || e).slice(0, 400);
      console.log(`${name} LỖI: ${out.error}`);
    } finally {
      await browser?.close().catch(() => {});
      out.finishedAt = new Date().toISOString();
    }
    console.log(`${name}: url ${out.url}; ready ${JSON.stringify(out.ready)}; R1 request lúc mở trang ${out.r1RequestsOnOpen}; stats ${JSON.stringify(out.stats)}; vs1a ${JSON.stringify(out.vs1a)}; vsRef ${JSON.stringify(out.vsRef)}; requests ${JSON.stringify(out.requests)}; app ${JSON.stringify(out.app)}`);
  }
  server?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(args.out, JSON.stringify(report, null, 1), "utf8");
  console.log(`Ghi ${args.out}`);
}
