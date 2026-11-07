// Chạy trang đo (harness.html) bằng Playwright trên Chromium / WebKit, khổ điện thoại 390×844, deviceScaleFactor 3.
// Thư mục hiện tại phải là test-ocr (nơi có photos/ và outputs/), giống run_ocr.py.
//
//   node web-ocr/run-browser.mjs --engine paddlejs --browser chromium            # 96 ảnh, file từ máy
//   node web-ocr/run-browser.mjs --engine tesseractjs --browser webkit --mode cdn --limit 1   # đo byte tải lần đầu
//   node web-ocr/run-browser.mjs --report                                        # gom outputs/web-ocr/metrics.csv
//
// Kết quả (mode local): outputs/<engine>-<browser>/<mã>__<ảnh>.txt + dòng outputs/times.csv (tool,code,image,seconds,status).
// Mỗi lần chạy ghi thêm outputs/web-ocr/runs/<tool>-<mode>.json (thời gian nạp, backend, bộ nhớ, byte tải).
// Mode cdn không ghi .txt / times.csv (chỉ đo tải), chỉ ghi file json.
//
// Biến môi trường: PLAYWRIGHT_MODULE (mặc định D:\tmp\pw\node_modules\playwright\index.mjs),
// PW_CHROMIUM (file chrome-headless-shell.exe), PLAYWRIGHT_BROWSERS_PATH (nơi có WebKit).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { startServer } from "./serve.mjs";
import { resultFileName, toolName, timesRow, pickPhotos, summarizeMemory, sumBytes, timeStats, mb, csvLine } from "./lib.mjs";

function parseArgs(argv) {
  const a = { engine: "paddlejs", browser: "chromium", mode: "local", limit: 0, out: "outputs", photos: "photos", timeout: 300, report: false, join: "" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--engine") a.engine = v();
    else if (k === "--browser") a.browser = v();
    else if (k === "--mode") a.mode = v();
    else if (k === "--limit") a.limit = Number(v());
    else if (k === "--out") a.out = v();
    else if (k === "--photos") a.photos = v();
    else if (k === "--timeout") a.timeout = Number(v());
    else if (k === "--report") a.report = true;
    else if (k === "--join") a.join = v(); // "rows": chỉ để thử (khung cùng hàng nối 1 dòng), ghi vào --out riêng
    else throw new Error(`Không biết tham số ${k}`);
  }
  if (!["paddlejs", "tesseractjs"].includes(a.engine)) throw new Error("--engine phải là paddlejs hoặc tesseractjs");
  if (!["chromium", "webkit"].includes(a.browser)) throw new Error("--browser phải là chromium hoặc webkit");
  if (!["local", "cdn"].includes(a.mode)) throw new Error("--mode phải là local hoặc cdn");
  if (a.join && path.resolve(a.out) === path.resolve("outputs")) throw new Error("--join chỉ để thử: phải kèm --out thư mục khác outputs/");
  return a;
}

function listPhotos(dir) {
  const rel = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(dir, d.name), { withFileTypes: true })) {
      if (f.isFile()) rel.push(`${d.name}/${f.name}`);
    }
  }
  return pickPhotos(rel);
}

/** MỘT tiến trình PowerShell chạy suốt lần chạy: mỗi 250 ms lấy PrivateMemorySize64 + WorkingSet64 của cả cây
 *  tiến trình con từ rootPid (cây tính lại mỗi 2 giây bằng Win32_Process). Mỗi mẫu là 1 dòng:
 *  "<ms> pid:private:ws:tên pid:private:ws:tên ...". */
function startSampler(rootPid, onSample) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$root = ${Number(rootPid)}
$ids = @($root); $lastTree = [DateTime]::MinValue
while ($true) {
  if (((Get-Date) - $lastTree).TotalMilliseconds -ge 2000) {
    $all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId
    $kids = @{}
    foreach ($p in $all) { $pp = [int]$p.ParentProcessId; if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.ArrayList }; [void]$kids[$pp].Add([int]$p.ProcessId) }
    $ids = New-Object System.Collections.ArrayList; $queue = New-Object System.Collections.Queue; $queue.Enqueue($root)
    while ($queue.Count -gt 0) { $id = $queue.Dequeue(); if ($ids.Contains($id)) { continue }; [void]$ids.Add($id); if ($kids.ContainsKey($id)) { foreach ($c in $kids[$id]) { $queue.Enqueue($c) } } }
    $lastTree = Get-Date
  }
  $parts = New-Object System.Collections.ArrayList
  foreach ($id in $ids) { try { $p = [System.Diagnostics.Process]::GetProcessById($id); [void]$parts.Add("$($id):$($p.PrivateMemorySize64):$($p.WorkingSet64):$($p.ProcessName)") } catch {} }
  if ($parts.Count -eq 0) { break }
  [Console]::Out.WriteLine("$([DateTimeOffset]::Now.ToUnixTimeMilliseconds()) $($parts -join ' ')")
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 250
}`;
  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  ps.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const [, ...procs] = line.split(" ");
      onSample(
        procs.map((p) => {
          const [pid, priv, ws, name] = p.split(":");
          return { pid: Number(pid), private: Number(priv), ws: Number(ws), name };
        }),
      );
    }
  });
  return ps;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: quá ${ms / 1000} giây`)), ms);
    }),
  ]);
}

async function loadPlaywright() {
  const p = process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs";
  return import(pathToFileURL(p).href);
}

async function runOnce(args) {
  const pw = await loadPlaywright();
  const tool = toolName(args.engine, args.browser);
  const photos = listPhotos(args.photos);
  const todo = args.limit > 0 ? photos.slice(0, args.limit) : photos;
  const outDir = path.join(args.out, tool);
  const timesPath = path.join(args.out, "times.csv");
  const runsDir = path.join(args.out, "web-ocr", "runs");
  fs.mkdirSync(runsDir, { recursive: true });

  const server = await startServer({ port: 0 });
  const base = `http://localhost:${server.port}`;
  const launchOpts = { headless: true };
  if (args.browser === "chromium" && process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
  const browserType = args.browser === "chromium" ? pw.chromium : pw.webkit;

  const run = {
    tool, engine: args.engine, browser: args.browser, mode: args.mode, startedAt: new Date().toISOString(),
    images: todo.length, ok: 0, errors: 0, skippedExisting: 0, crashes: 0, initError: null, init: null, errorsSample: [],
  };
  const samples = [];
  let phase = "baseline";
  let jsHeapPeak = 0;
  const net = [];
  const netFailed = [];
  let browser;
  let browserServer;
  let sampler;
  let heapTimer;
  try {
    // launchServer để biết số tiến trình (pid) của trình duyệt, rồi nối vào bằng connect()
    browserServer = await browserType.launchServer(launchOpts);
    browser = await browserType.connect(browserServer.wsEndpoint());
    run.browserVersion = browser.version();
    const rootPid = browserServer.process()?.pid;
    run.rootPid = rootPid;
    if (rootPid) sampler = startSampler(rootPid, (procs) => samples.push({ phase, t: Date.now(), procs }));
    const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
    if (args.browser === "chromium") ctxOpts.isMobile = true; // WebKit trên Windows: chỉ đặt khổ + DPR
    const context = await browser.newContext(ctxOpts);
    context.on("requestfinished", async (req) => {
      const entry = { url: req.url(), transfer: null, decoded: null, status: null };
      net.push(entry);
      try {
        const sizes = await req.sizes();
        entry.transfer = sizes.responseBodySize;
        const resp = await req.response();
        entry.status = resp ? resp.status() : null;
        if (resp) entry.decoded = (await resp.body()).length;
      } catch (e) {
        entry.note = String(e.message || e).slice(0, 200);
      }
    });
    context.on("requestfailed", (req) => netFailed.push({ url: req.url(), error: req.failure()?.errorText }));

    let page = await context.newPage();
    const consoleErrors = [];
    const hookPage = (pg) => {
      pg.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
      pg.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message || e).slice(0, 300)}`));
    };
    hookPage(page);
    // mức nền: trang trống 3 giây
    await page.goto("about:blank");
    await new Promise((r) => setTimeout(r, 3000));
    phase = "run";

    let cdp = null;
    const startHeap = async (pg) => {
      if (args.browser !== "chromium") return;
      cdp = await context.newCDPSession(pg);
      await cdp.send("Performance.enable");
      let busy = false;
      heapTimer = setInterval(async () => {
        if (busy || !cdp) return;
        busy = true;
        try {
          const { metrics } = await cdp.send("Performance.getMetrics");
          const used = metrics.find((m) => m.name === "JSHeapUsedSize")?.value || 0;
          jsHeapPeak = Math.max(jsHeapPeak, used);
        } catch { /* trang đang bận / đã đóng */ }
        busy = false;
      }, 250);
    };

    const openAndInit = async () => {
      const url = `${base}/harness.html?engine=${args.engine}&mode=${args.mode}${args.join ? `&join=${args.join}` : ""}`;
      await page.goto(url);
      await page.waitForFunction(() => window.harnessReady === true, null, { timeout: 120000 });
      return withTimeout(page.evaluate(() => window.harness.init()), 900000, "init");
    };

    await startHeap(page);
    try {
      run.init = await openAndInit();
      run.loadSeconds = run.init.loadSeconds;
    } catch (e) {
      run.initError = String(e.message || e);
      run.featuresAtError = await page.evaluate(() => window.harness?.features?.() ?? null).catch(() => null);
    }

    if (!run.initError) {
      for (const ph of todo) {
        const outFile = path.join(outDir, resultFileName(ph.code, ph.image));
        if (args.mode === "local" && fs.existsSync(outFile)) { run.skippedExisting++; continue; }
        let status = "ok";
        let text = "";
        let secs = 0;
        try {
          const r = await withTimeout(
            page.evaluate((u) => window.harness.run(u), `${base}/photos/${encodeURI(ph.rel)}`),
            args.timeout * 1000,
            "đọc ảnh",
          );
          text = r.text;
          secs = r.seconds;
          run.lastImage = { width: r.width, height: r.height, srcWidth: r.srcWidth, srcHeight: r.srcHeight };
        } catch (e) {
          status = `error: ${String(e.message || e)}`;
          if (run.errorsSample.length < 5) run.errorsSample.push(`${ph.rel}: ${status}`);
          // trang bị treo / sập (vd hết bộ nhớ): mở trang mới, nạp lại, đọc tiếp ảnh sau
          const crashed = page.isClosed() || /crash|closed|quá/i.test(status);
          if (crashed) {
            run.crashes++;
            try { await page.close(); } catch { /* đã đóng */ }
            page = await context.newPage();
            hookPage(page);
            if (heapTimer) clearInterval(heapTimer);
            await startHeap(page);
            try { await openAndInit(); } catch (e2) { run.initError = `nạp lại sau lỗi: ${e2.message || e2}`; }
          }
        }
        if (status === "ok") run.ok++; else run.errors++;
        if (args.mode === "local") {
          if (status === "ok") {
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(outFile, text, "utf8");
          }
          if (!fs.existsSync(timesPath)) fs.writeFileSync(timesPath, csvLine(["tool", "code", "image", "seconds", "status"]), "utf8");
          fs.appendFileSync(timesPath, timesRow(tool, ph.code, ph.image, secs, status), "utf8");
        }
        console.log(`  ${ph.rel}: ${secs.toFixed(2)}s ${status} (${text.length} ký tự)`);
        if (run.initError) break;
      }
    }
    run.consoleErrors = consoleErrors.slice(0, 20);
  } finally {
    if (heapTimer) clearInterval(heapTimer);
    if (browser) await browser.close().catch(() => {});
    if (browserServer) await browserServer.close().catch(() => {});
    if (sampler) sampler.kill();
    await server.close();
  }
  run.finishedAt = new Date().toISOString();
  run.memory = summarizeMemory(samples);
  run.jsHeapPeak = args.browser === "chromium" ? jsHeapPeak : null;
  const bytes = sumBytes(net.filter((e) => !e.url.startsWith("data:")));
  run.network = { ...bytes, failed: netFailed };
  run.processNames = [...new Set(samples.flatMap((s) => s.procs.map((p) => p.name)))];
  const file = path.join(runsDir, `${tool}-${args.mode}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2), "utf8");
  console.log(`\n${tool} (${args.mode}): ok ${run.ok}, lỗi ${run.errors}, bỏ qua (đã có) ${run.skippedExisting}, sập ${run.crashes}` +
    (run.initError ? `\nLỖI NẠP: ${run.initError}` : "") +
    `\nnạp ${run.loadSeconds?.toFixed?.(1) ?? "?"} s, backend ${run.init?.backend ?? "?"}, crossOriginIsolated ${run.init?.features?.crossOriginIsolated}` +
    `\nbộ nhớ: nền ${mb(run.memory.baseline)} MB, đỉnh 1 tiến trình ${mb(run.memory.peakProc)} MB, đỉnh tổng ${mb(run.memory.peakTotal)} MB` +
    `\nmạng: ${mb(bytes.transfer)} MB qua mạng, ${mb(bytes.decoded)} MB giải nén, ${bytes.count} request\nGhi: ${file}`);
  return run;
}

/** Đọc times.csv (dạng csv đơn giản của Python), giữ dòng cuối mỗi ảnh như score.py. */
function readTimes(p) {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
  const parse = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const [head, ...rows] = lines.map(parse);
  const last = new Map();
  for (const r of rows) {
    const o = Object.fromEntries(head.map((h, i) => [h, r[i]]));
    last.set(`${o.tool}|${o.code}|${o.image}`, o);
  }
  return [...last.values()];
}

function report(args) {
  const runsDir = path.join(args.out, "web-ocr", "runs");
  const runs = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(runsDir, f), "utf8")))
    : [];
  const times = readTimes(path.join(args.out, "times.csv"));
  const head = ["tool", "browser", "backend", "crossOriginIsolated", "load_s_local", "load_s_cdn", "sec_per_image_mean", "sec_per_image_max",
    "mem_baseline_mb", "mem_peak_proc_mb", "mem_peak_total_mb", "ws_peak_proc_mb", "ws_peak_total_mb", "js_heap_peak_mb",
    "net_mb_first_load", "decoded_mb_first_load", "images_ok", "images_error", "note"];
  let csv = csvLine(head);
  const tools = [...new Set(runs.map((r) => r.tool))].sort();
  const dl = ["# Byte tải lần đầu (mode cdn, cache trống, 1 ảnh)", ""];
  for (const tool of tools) {
    const local = runs.find((r) => r.tool === tool && r.mode === "local");
    const cdn = runs.find((r) => r.tool === tool && r.mode === "cdn");
    const st = timeStats(times.filter((r) => r.tool === tool));
    const r = local || cdn;
    const notes = [];
    if (local?.initError) notes.push(`lỗi nạp (local): ${local.initError}`);
    if (cdn?.initError) notes.push(`lỗi nạp (cdn): ${cdn.initError}`);
    if (local?.crashes) notes.push(`trang sập / quá giờ ${local.crashes} lần`);
    if (cdn?.network?.failed?.length) notes.push(`cdn: ${cdn.network.failed.length} request lỗi`);
    csv += csvLine([
      tool, r.browser, r.init?.backend ?? "", r.init?.features?.crossOriginIsolated ?? r.featuresAtError?.crossOriginIsolated ?? "",
      local?.loadSeconds?.toFixed(1) ?? "", cdn?.loadSeconds?.toFixed(1) ?? "",
      st.mean == null ? "" : st.mean.toFixed(2), st.max == null ? "" : st.max.toFixed(2),
      mb(local?.memory?.baseline), mb(local?.memory?.peakProc), mb(local?.memory?.peakTotal),
      mb(local?.memory?.peakProcWs), mb(local?.memory?.peakTotalWs), local?.jsHeapPeak ? mb(local.jsHeapPeak) : "",
      mb(cdn?.network?.transfer), mb(cdn?.network?.decoded), st.ok, st.errors, notes.join("; "),
    ]);
    if (cdn) {
      dl.push(`## ${tool}`, "", `Tổng: ${mb(cdn.network.transfer)} MB qua mạng, ${mb(cdn.network.decoded)} MB sau giải nén, ${cdn.network.count} request.`, "",
        "| File (> 100 kB) | qua mạng (kB) | giải nén (kB) |", "|---|---|---|");
      for (const b of cdn.network.big) dl.push(`| ${b.url} | ${(b.transfer / 1000).toFixed(0)} | ${(b.decoded / 1000).toFixed(0)} |`);
      if (cdn.network.failed.length) dl.push("", "Request lỗi: " + cdn.network.failed.map((f) => `${f.url} (${f.error})`).join("; "));
      dl.push("");
    }
  }
  const metricsPath = path.join(args.out, "web-ocr", "metrics.csv");
  fs.writeFileSync(metricsPath, csv, "utf8");
  fs.writeFileSync(path.join(args.out, "web-ocr", "tai-lan-dau.md"), dl.join("\n"), "utf8");
  console.log(csv);
  console.log(`Ghi: ${metricsPath}, ${path.join(args.out, "web-ocr", "tai-lan-dau.md")}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.report) report(args);
else await runOnce(args);
