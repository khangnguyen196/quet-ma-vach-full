// Kiểm trang thử ocr-thu.html bằng Playwright (khổ điện thoại 390×844, DPR 3; Chromium thêm isMobile), trên bản build
// đang phục vụ ở --base (vd vite preview ở http://localhost:4173/, hoặc link GitHub Pages của app).
// Thư mục hiện tại là test-ocr (để lấy ảnh photos/ và chữ đã đo outputs/paddlejs-rows-<trình duyệt>/).
//
//   node web-ocr/ocr-thu-check.mjs --base http://localhost:4173/ --browser chromium --shots D:\tmp\ocr-c\shots
//
// Các bước (in kết quả từng bước, chụp màn hình <trình duyệt>-<bước>.png):
//  (f) mở index.html, chờ service worker điều khiển trang, rồi mở ocr-thu.html: phải vẫn là trang thử;
//  (a) crossOriginIsolated = false, backend / WebGPU hiện ra;
//  (b) chọn từng ảnh (--images), đọc bằng PaddleOCR: chữ không rỗng, 11 ô regex, giây tải / đọc; so chữ với outputs;
//  (c) đọc bằng tesseract.js: có chữ;
//  (d) bật "Chỉ dùng wasm" (trang tải lại với ?wasm=1), đọc lại ảnh đầu; đếm số lần gọi navigator.gpu.requestAdapter()
//      (init script bọc hàm thật; WebKit không có navigator.gpu thì tạo bản giả có requestAdapter đếm lần gọi):
//      sẵn sàng + đọc xong phải 0 lần gọi và navigator.gpu === undefined (trang đã giấu, SDK không gọi được);
//  (e) đặt cờ sessionStorage rồi tải lại: hiện câu "vừa bị đóng giữa chừng";
//  (f tiếp) Cache Storage không có URL nào của jsDelivr / HuggingFace;
//  (g) app chính (trình duyệt mới, chưa có service worker): giao diện chính hiện, không lỗi console;
//  (h) chỉ đọc, ngoài trình duyệt: Content-Type của ocr-thu.html (text/html), ocr-thu/regex.mjs, ocr-thu/text.mjs (có
//      "javascript"; sai thì trình duyệt không chạy module); HTML có disabled sẵn ở 2 ô chọn ảnh (mở lại khi trang sẵn sàng).
//      Lỗi mạng thì (h) = { ok: false, error }, script vẫn ghi ket-qua.json của (a)-(g).
// Trước khi trang sẵn sàng: nếu kịp thì chụp <trình duyệt>-a0.png và ghi độ mờ (opacity) của 2 nút chọn ảnh
// (report.beforeReady, chỉ để xem, không tính vào QUA).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** % giống nhau của 2 đoạn chữ: 1 - khoảng cách Levenshtein / độ dài chuỗi dài hơn (gom khoảng trắng trước). */
export function similarity(a, b) {
  const x = Array.from(a.replace(/\s+/g, " ").trim());
  const y = Array.from(b.replace(/\s+/g, " ").trim());
  if (!x.length && !y.length) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

/** Content-Type đúng loại: HTML cho trang, JavaScript cho module (sai thì trình duyệt không chạy module). */
export function contentTypeOk(file, type) {
  const t = String(type || "").toLowerCase();
  return file.endsWith(".html") ? t.startsWith("text/html") : t.includes("javascript");
}

/** HTML có thuộc tính disabled sẵn trên thẻ input của ô chọn ảnh id này không. */
export function inputDisabledInHtml(html, id) {
  const tag = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`));
  return !!tag && /\sdisabled(\s|>|=|\/)/.test(tag[0]);
}

/** (h) Tải 3 file của trang thử từ base (GET, chỉ đọc), kiểm Content-Type và ô chọn ảnh khóa sẵn. */
async function checkServed(base, fetchImpl) {
  const files = ["ocr-thu.html", "ocr-thu/regex.mjs", "ocr-thu/text.mjs"];
  const out = { contentTypes: {}, pickDisabledInHtml: null };
  let ok = true;
  for (const f of files) {
    const r = await fetchImpl(base + f, { cache: "no-store" });
    const type = r.headers.get("content-type");
    out.contentTypes[f] = `${r.status} ${type}`;
    ok = ok && r.ok && contentTypeOk(f, type);
    if (f === "ocr-thu.html") {
      const html = await r.text();
      out.pickDisabledInHtml = { pickCamera: inputDisabledInHtml(html, "pickCamera"), pickLibrary: inputDisabledInHtml(html, "pickLibrary") };
    } else {
      await r.arrayBuffer();
    }
  }
  out.ok = ok && out.pickDisabledInHtml.pickCamera && out.pickDisabledInHtml.pickLibrary;
  return out;
}

/** (h) như checkServed nhưng không ném: lỗi mạng (fetch ném) thì trả { ok: false, error } để script vẫn ghi
 *  ket-qua.json của (a)-(g) và kết luận CÓ BƯỚC KHÔNG QUA. fetchImpl: để test truyền fetch giả. */
export async function checkServedSafe(base, fetchImpl = globalThis.fetch) {
  try {
    return await checkServed(base, fetchImpl);
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

function parseArgs(argv) {
  const a = { base: "http://localhost:4173/", browser: "chromium", shots: "shots", images: "8934572260543/nutrition.jpg,8935049501503/nutrition.jpg", timeout: 900 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--base") a.base = v();
    else if (k === "--browser") a.browser = v();
    else if (k === "--shots") a.shots = v();
    else if (k === "--images") a.images = v();
    else if (k === "--timeout") a.timeout = Number(v());
    else throw new Error(`Không biết tham số ${k}`);
  }
  if (!a.base.endsWith("/")) a.base += "/";
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
  const type = args.browser === "chromium" ? pw.chromium : pw.webkit;
  const launch = { headless: true };
  if (args.browser === "chromium" && process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
  fs.mkdirSync(args.shots, { recursive: true });
  const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
  if (args.browser === "chromium") ctxOpts.isMobile = true;
  const report = { browser: args.browser, base: args.base, steps: {} };
  const shot = (page, name) => page.screenshot({ path: path.join(args.shots, `${args.browser}-${name}.png`), fullPage: true });
  const browser = await type.launch(launch);
  try {
    // ---------- (f) service worker, rồi (a)-(e) trong cùng trang do service worker điều khiển ----------
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
    await page.goto(args.base + "index.html");
    const swControlled = await page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 60000 })
      .then(() => true, () => false);
    await page.goto(args.base + "ocr-thu.html");
    // trước khi trang sẵn sàng (nếu kịp): 2 ô chọn ảnh khóa, nút chọn ảnh mờ (chỉ để xem, không tính vào QUA)
    report.beforeReady = await page.evaluate(() => ({
      readyAlready: !!(window.__ocrThu && "ready" in window.__ocrThu),
      pickDisabled: ["pickCamera", "pickLibrary"].map((id) => document.getElementById(id)?.disabled ?? null),
      labelOpacity: [...document.querySelectorAll("label.btn")].map((l) => getComputedStyle(l).opacity),
    }));
    if (!report.beforeReady.readyAlready) await shot(page, "a0");
    console.log("(a0) trước khi sẵn sàng:", JSON.stringify(report.beforeReady), report.beforeReady.readyAlready ? "– trang đã sẵn sàng, chưa chụp" : "– đã chụp a0");
    const viaSw = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
    const title = await page.title();
    const isTestPage = (await page.locator("#runPaddle").count()) === 1;
    report.steps.f = { swControlledIndex: swControlled, ocrThuControlledBySw: viaSw, title, isTestPage, ok: swControlled && isTestPage && title === "Thử OCR bao bì" };
    console.log("(f) service worker:", JSON.stringify(report.steps.f));

    const waitReady = () => page.waitForFunction(() => window.__ocrThu && "ready" in window.__ocrThu, null, { timeout: 60000 });
    await waitReady();
    const a = await page.evaluate(() => ({ ready: window.__ocrThu.ready, gpu: window.__ocrThu.gpu, coi: self.crossOriginIsolated, env: document.getElementById("env").textContent,
      pickEnabled: !document.getElementById("pickCamera").disabled && !document.getElementById("pickLibrary").disabled }));
    report.steps.a = { ...a, ok: a.ready === true && a.coi === false && !!a.env && a.pickEnabled };
    console.log("(a)", JSON.stringify(report.steps.a));
    await shot(page, "a");

    const runAndWait = async (button, engine) => {
      const before = await page.evaluate((e) => (window.__ocrThu.runs[e] ? window.__ocrThu.runs[e] : null), engine);
      await page.click(button);
      await page.waitForFunction(([e, prev]) => {
        const r = window.__ocrThu.runs[e];
        return r && r !== prev && !document.getElementById("runPaddle").disabled;
      }, [engine, before], { timeout: args.timeout * 1000, polling: 500 });
      // runs[e] là object trong trang: lấy bản sao để in
      return page.evaluate((e) => JSON.parse(JSON.stringify(window.__ocrThu.runs[e])), engine);
    };
    const pick = async (rel) => {
      await page.setInputFiles("#pickLibrary", path.join("photos", rel));
      await page.waitForFunction(() => /Ảnh sẵn sàng|Không mở được/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
      return page.evaluate(() => window.__ocrThu.info.scaled);
    };

    // ---------- (b) PaddleOCR trên từng ảnh ----------
    report.steps.b = [];
    const images = args.images.split(",");
    for (const [i, rel] of images.entries()) {
      const scaled = await pick(rel);
      const r = await runAndWait("#runPaddle", "PaddleOCR");
      const [code, file] = rel.split("/");
      const ref = path.join("outputs", `paddlejs-rows-${args.browser}`, `${code}__${file.replace(/\.[^.]+$/, "")}.txt`);
      const sim = fs.existsSync(ref) && r.text != null ? similarity(r.text, fs.readFileSync(ref, "utf8")) : null;
      const f = r.fields || {};
      const item = {
        image: rel, scaled, backend: r.backend, loadSeconds: r.loadSeconds, readSeconds: r.readSeconds, chars: r.text?.length ?? 0,
        error: r.error || null, kcal: f.nang_luong_kcal, dam: f.dam_g, beo: f.beo_g, carb: f.carb_g,
        similarityToOutputs: sim == null ? null : Math.round(sim * 1000) / 10,
      };
      item.ok = !r.error && item.chars > 0 && r.readSeconds > 0 && (i > 0 || r.loadSeconds > 0) &&
        (await page.locator("#res-paddle table").nth(1).locator("tr").count()) === 11;
      report.steps.b.push(item);
      console.log("(b)", JSON.stringify(item));
      await shot(page, `b${i + 1}`);
    }

    // ---------- (c) tesseract.js ----------
    const t = await runAndWait("#runTess", "tesseract.js");
    report.steps.c = { backend: t.backend, loadSeconds: t.loadSeconds, readSeconds: t.readSeconds, chars: t.text?.length ?? 0, error: t.error || null };
    report.steps.c.ok = !t.error && report.steps.c.chars > 0;
    console.log("(c)", JSON.stringify(report.steps.c));
    await shot(page, "c");

    // ---------- (d) Chỉ dùng wasm ----------
    // Từ lần tải trang sau: đếm số lần gọi navigator.gpu.requestAdapter() (của trang lẫn SDK PaddleOCR).
    await page.addInitScript(() => {
      window.__gpuCalls = 0;
      const gpu = navigator.gpu;
      if (gpu && gpu.requestAdapter) {
        const real = gpu.requestAdapter;
        gpu.requestAdapter = function (...args) { window.__gpuCalls++; return real.apply(this, args); };
        window.__gpuFake = false;
      } else {
        // WebKit không có WebGPU: tạo bản giả để biết có ai gọi không (trả null = không có adapter)
        Object.defineProperty(navigator, "gpu", { value: { requestAdapter() { window.__gpuCalls++; return Promise.resolve(null); } }, configurable: true });
        window.__gpuFake = true;
      }
    });
    const gpuState = () => page.evaluate(() => ({ calls: window.__gpuCalls, gpuUndefined: navigator.gpu === undefined, fake: window.__gpuFake }));
    await Promise.all([page.waitForURL(/[?&]wasm=1/), page.click("#wasmOnly")]);
    await waitReady();
    const gpuReady = await gpuState();
    await pick(images[0]);
    const d = await runAndWait("#runPaddle", "PaddleOCR");
    const gpuAfterRead = await gpuState();
    report.steps.d = { url: page.url(), gpu: await page.evaluate(() => window.__ocrThu.gpu), backend: d.backend, loadSeconds: d.loadSeconds, readSeconds: d.readSeconds, chars: d.text?.length ?? 0, error: d.error || null,
      fakeGpu: gpuAfterRead.fake, requestAdapterCallsReady: gpuReady.calls, requestAdapterCallsAfterRead: gpuAfterRead.calls,
      navigatorGpuUndefinedReady: gpuReady.gpuUndefined, navigatorGpuUndefinedAfterRead: gpuAfterRead.gpuUndefined };
    report.steps.d.ok = !d.error && report.steps.d.chars > 0 && report.steps.d.gpu.use === "wasm" &&
      gpuReady.calls === 0 && gpuAfterRead.calls === 0 && gpuReady.gpuUndefined && gpuAfterRead.gpuUndefined;
    console.log("(d)", JSON.stringify(report.steps.d));
    await shot(page, "d");

    // ---------- (e) cờ sessionStorage còn lại -> câu báo ----------
    await page.evaluate(() => sessionStorage.setItem("ocr-thu-dang-doc", "PaddleOCR, ảnh thử"));
    await page.reload();
    await waitReady();
    const warn = await page.evaluate(() => ({ hidden: document.getElementById("warn").hidden, text: document.getElementById("warn").textContent, flagLeft: sessionStorage.getItem("ocr-thu-dang-doc") }));
    report.steps.e = { ...warn, ok: !warn.hidden && /vừa bị đóng giữa chừng/.test(warn.text) && warn.flagLeft === null };
    console.log("(e)", JSON.stringify(report.steps.e));
    await shot(page, "e");

    // ---------- (f tiếp) Cache Storage ----------
    const cached = await page.evaluate(async () => {
      const out = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) out.push(req.url);
      }
      return out;
    });
    const foreign = cached.filter((u) => /jsdelivr|huggingface|hf\.co/.test(u));
    report.steps.f.cacheUrls = cached.length;
    report.steps.f.cachedOcrThu = cached.filter((u) => /ocr-thu/.test(u)).map((u) => u.replace(args.base, ""));
    report.steps.f.foreignInCache = foreign;
    report.steps.f.ok = report.steps.f.ok && foreign.length === 0;
    console.log("(f) cache:", cached.length, "URL; ngoài tên miền:", foreign.length, "; ocr-thu:", report.steps.f.cachedOcrThu.join(", "));
    report.consoleErrorsTestPage = errors;
    await ctx.close();

    // ---------- (g) app chính, trình duyệt sạch ----------
    const ctx2 = await browser.newContext(ctxOpts);
    const p2 = await ctx2.newPage();
    const errors2 = [];
    p2.on("console", (m) => { if (m.type() === "error") errors2.push(m.text().slice(0, 300)); });
    p2.on("pageerror", (e) => errors2.push(`pageerror: ${e.message}`.slice(0, 300)));
    await p2.goto(args.base + "index.html");
    await p2.waitForLoadState("networkidle").catch(() => {});
    const g = await p2.evaluate(() => ({ title: document.title, hasBody: document.body.innerText.trim().length > 0, buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 8) }));
    report.steps.g = { ...g, consoleErrors: errors2, ok: g.hasBody && errors2.length === 0 };
    console.log("(g)", JSON.stringify(report.steps.g));
    await shot(p2, "g");
    await ctx2.close();
  } finally {
    await browser.close();
  }

  // ---------- (h) Content-Type từ máy chủ + ô chọn ảnh khóa sẵn trong HTML (chỉ đọc) ----------
  report.steps.h = await checkServedSafe(args.base);
  console.log("(h)", JSON.stringify(report.steps.h));
  const file = path.join(args.shots, `${args.browser}-ket-qua.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  const okAll = ["a", "c", "d", "e", "f", "g", "h"].every((k) => report.steps[k]?.ok) && report.steps.b.every((x) => x.ok);
  console.log(`\n${args.browser}: ${okAll ? "QUA" : "CÓ BƯỚC KHÔNG QUA"} (a)-(h). Ghi ${file}`);
  process.exitCode = okAll ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
