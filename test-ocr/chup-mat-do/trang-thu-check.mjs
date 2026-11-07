// P5 vòng 5: kiểm trang thử chup-mat-do.html trên bản build chạy trên máy (Playwright Chromium + WebKit).
//
//   node chup-mat-do/trang-thu-check.mjs [--no-build] [--browsers chromium,webkit]
//
// - npm run build (trong worktree), phục vụ dist/ bằng máy chủ tĩnh 127.0.0.1 (cổng ngẫu nhiên).
// - Mỗi trình duyệt (ngữ cảnh mới, cache trống): mở chup-mat-do.html, chọn lần lượt front.jpg của 3 mã ĐẦU TIÊN trong
//   truth.csv có ảnh (chốt trước, không chọn theo kết quả), bấm "Nhận ra sản phẩm", chờ ≤ 90 giây / ảnh (ảnh đầu gồm
//   cả tải PaddleOCR); ghi top5, mã đúng có trong 5 đầu không, giây.
// - Ghi mọi request: không có request tới openfoodfacts.org; không có POST; chỉ cùng tên miền + jsDelivr / HuggingFace
//   (gồm máy chủ tải file của HuggingFace *.hf.co / *.huggingface.co).
// - index.html của app vẫn mở được (ngữ cảnh mới, không lỗi trang).
// - WebKit trên Windows: chạy thẳng, không lớp thay; lỗi thì ghi lỗi thật.
// Ra: D:\tmp\chup-mat-do\ket-qua\trang-thu-local.json. Không chạy trên Pages.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsv, rankOf } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const DIST = path.join(ROOT, "dist");
const PHOTOS = "D:\\quet-ma-vach-full\\test-ocr\\photos";
const OUT = "D:\\tmp\\chup-mat-do\\ket-qua\\trang-thu-local.json";
const PER_IMAGE_MS = 90000;
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const browsers = opt("--browsers", "chromium,webkit").split(",");

/** Host được phép: cùng tên miền (127.0.0.1), jsDelivr, HuggingFace (cả máy chủ tải file). */
export function allowedHost(host, own) {
  return host === own || host === "cdn.jsdelivr.net" || host === "huggingface.co" || /(^|\.)huggingface\.co$/.test(host) || /(^|\.)hf\.co$/.test(host);
}

/** Tóm tắt request: số request, POST, request tới openfoodfacts.org, host lạ. */
export function requestSummary(reqs, own) {
  const hosts = [...new Set(reqs.map((r) => r.host))].sort();
  return {
    total: reqs.length, hosts,
    post: reqs.filter((r) => r.method !== "GET" && r.method !== "HEAD").map((r) => `${r.method} ${r.url}`),
    openfoodfacts: reqs.filter((r) => /openfoodfacts\.org$/.test(r.host)).map((r) => r.url),
    foreign: hosts.filter((h) => !allowedHost(h, own)),
  };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".ico": "image/x-icon" };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = { startedAt: new Date().toISOString(), finishedAt: null, build: null, images: [], browsers: {} };
  if (!argv.includes("--no-build")) {
    const t0 = Date.now();
    const b = spawnSync("npm run build", { cwd: ROOT, shell: true, encoding: "utf8" });
    report.build = { status: b.status, seconds: (Date.now() - t0) / 1000, tail: (b.stdout + b.stderr).trim().split("\n").slice(-4) };
    if (b.status !== 0) { fs.writeFileSync(OUT, JSON.stringify(report, null, 1)); throw new Error("build lỗi"); }
  }
  const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
  const items = truth.filter((t) => fs.existsSync(path.join(PHOTOS, t.code, "front.jpg"))).slice(0, 3);
  report.images = items.map((t) => t.code);

  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.join(DIST, path.normalize(u === "/" ? "/index.html" : u));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const own = "127.0.0.1";
  const base = `http://${own}:${server.address().port}/`;
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);

  for (const name of browsers) {
    const out = { startedAt: new Date().toISOString(), runs: [], requests: null, app: null, error: null, consoleErrors: [] };
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
      await page.goto(base + "chup-mat-do.html");
      await page.waitForFunction(() => window.__chupMatDo && "ready" in window.__chupMatDo, null, { timeout: 60000 });
      out.ready = await page.evaluate(() => ({ ready: window.__chupMatDo.ready, error: window.__chupMatDo.error || null, title: document.title }));
      for (const t of items) {
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
          Object.assign(row, { seconds: (Date.now() - a) / 1000, ocrSeconds: r.ocrSeconds ?? null, loadSeconds: r.loadSeconds ?? null, searchMs: r.searchMs ?? null, lines: r.lines ?? null, top5: r.top5 || [], rank, inTop5: rank != null, error: r.error || null, shownHits: await page.locator("#hits li").count() });
        } catch (e) {
          Object.assign(row, { seconds: (Date.now() - a) / 1000, error: String(e.message || e).slice(0, 300), inTop5: false });
        }
        out.runs.push(row);
        console.log(`${name} ${t.code}: ${row.error ? `LỖI ${row.error}` : `${row.seconds.toFixed(1)} s (đọc ${row.ocrSeconds?.toFixed(1)} s${row.loadSeconds != null ? `, tải ${row.loadSeconds.toFixed(1)} s` : ""}), rank ${row.rank ?? "-"}, ${row.lines} dòng`}`);
        if (row.error && /closed|crash/i.test(row.error)) break;
      }
      out.requests = requestSummary(reqs, own);
      await ctx.close();
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
    console.log(`${name}: requests ${JSON.stringify(out.requests)}; app ${JSON.stringify(out.app)}`);
  }
  server.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1), "utf8");
  console.log(`Ghi ${OUT}`);
}
