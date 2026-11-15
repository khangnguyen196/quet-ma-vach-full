// Đợt tu-dong (vòng 1, P3): đo lại CORS + chất lượng tìm theo chữ của các API tìm kiếm Open Food Facts, bằng fetch thật
// trong Playwright Chromium (Edge) + WebKit, từ một trang http://127.0.0.1:<cổng> (origin khác OFF). Bản mới của
// cors-check.mjs (bản cũ giữ nguyên để so cors.json cũ): danh sách lượt cố định (trình duyệt, kiểu, câu, lọc VN),
// tổng ≤ 12 lượt tìm, giãn ≥ 6 giây giữa 2 lượt, KHÔNG thử lại (để không vượt trần); thân trả về lưu đĩa.
//
//   node test-ocr/chup-mat-do/tu-dong-cors.mjs [--out D:\tmp\tu-dong\ket-qua\cors-tu-dong.json] [--cache D:\tmp\tu-dong\cache-off]
//
// Chỉ gọi world.openfoodfacts.org và search.openfoodfacts.org (API chính thức của OFF), có app_name / app_version như
// src/off.js, không thêm header. Đã có file thân trả về của một lượt (cùng trình duyệt + URL) thì không gọi lại.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { APP_NAME, APP_VERSION, SEARCH_GAP_MS } from "./off-search.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const out = arg("--out", "D:\\tmp\\tu-dong\\ket-qua\\cors-tu-dong.json");
const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
export const MAX_CALLS = 12;
export const TARGET_7UP = "8934588752117";
const FIELDS = "code,product_name,product_name_vi,product_name_en,brands,countries_tags,image_front_small_url";
const appParams = () => `app_name=${encodeURIComponent(APP_NAME)}&app_version=${encodeURIComponent(APP_VERSION)}`;
const VN_FILTER_PL = "&tagtype_0=countries&tag_contains_0=contains&tag_0=en%3Avietnam";

/** URL tìm theo chữ cho 3 API: searchalicious (search.openfoodfacts.org/search), searchpl (cgi/search.pl),
 *  apiv2 (/api/v2/search, thử xem có nhận search_terms không). */
export function urlOf(kind, terms, { vn = false, pageSize = 10 } = {}) {
  const t = String(terms ?? "").trim();
  if (kind === "searchalicious") {
    const q = vn ? `${t} countries_tags:"en:vietnam"` : t;
    return `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=${pageSize}&fields=${FIELDS}&langs=vi,en&${appParams()}`;
  }
  if (kind === "searchpl") {
    return `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(t)}&search_simple=1&action=process${vn ? VN_FILTER_PL : ""}&json=1&page_size=${pageSize}&fields=${FIELDS}&${appParams()}`;
  }
  if (kind === "apiv2") {
    return `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(t)}${vn ? "&countries_tags_en=vietnam" : ""}&page_size=${pageSize}&fields=${FIELDS}&${appParams()}`;
  }
  throw new Error(`Không biết kiểu tìm ${kind}`);
}

/** Danh sách sản phẩm trong thân trả về (searchalicious: hits; search.pl / v2: products). */
export function productsOf(kind, json) {
  const raw = kind === "searchalicious" ? json?.hits : json?.products;
  return Array.isArray(raw) ? raw : [];
}

// Lượt đo (thứ tự chạy). Câu muối = chữ OCR đã làm sạch tay của ca muối; "omachi xot bo ham" = sản phẩm 8936017368111
// trong 30 ảnh (mốc không có trong 5 gợi ý); "nissin mi" = 8936071070340 (mốc không có).
export const PLAN = [
  { browser: "chromium", kind: "searchalicious", terms: "7up soda chanh", vn: false },
  { browser: "chromium", kind: "searchpl", terms: "7up soda chanh", vn: true },
  { browser: "chromium", kind: "searchpl", terms: "7up soda chanh", vn: false },
  { browser: "chromium", kind: "apiv2", terms: "7up soda chanh", vn: false },
  { browser: "chromium", kind: "searchalicious", terms: "soda chanh", vn: false },
  { browser: "chromium", kind: "searchalicious", terms: "coop select muoi bien say i ot", vn: false },
  { browser: "chromium", kind: "searchalicious", terms: "omachi xot bo ham", vn: false },
  { browser: "chromium", kind: "searchalicious", terms: "7up soda chanh", vn: true },
  { browser: "webkit", kind: "searchalicious", terms: "7up soda chanh", vn: false },
  { browser: "webkit", kind: "searchpl", terms: "7up soda chanh", vn: true },
  { browser: "webkit", kind: "apiv2", terms: "7up soda chanh", vn: false },
  { browser: "webkit", kind: "searchalicious", terms: "nissin mi", vn: false },
];

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (PLAN.length > MAX_CALLS) throw new Error("quá trần lượt");
  fs.mkdirSync(cacheDir, { recursive: true });
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
  const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end("<!doctype html><title>cors</title><p>kiểm CORS</p>"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastCall = 0;
  let calls = 0;
  const results = [];
  for (const browserName of ["chromium", "webkit"]) {
    const rows = PLAN.filter((p) => p.browser === browserName);
    const browser = await pw[browserName].launch(browserName === "chromium" ? { headless: true, channel: "msedge" } : { headless: true });
    const page = await browser.newPage();
    const cdpSeen = new Map();
    if (browserName === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      const byId = new Map();
      cdp.on("Network.requestWillBeSent", (e) => byId.set(e.requestId, e.request.url));
      cdp.on("Network.responseReceivedExtraInfo", (e) => {
        const u = byId.get(e.requestId);
        const h = Object.fromEntries(Object.entries(e.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        if (u) cdpSeen.set(u, { ...(cdpSeen.get(u) || {}), status: e.statusCode, acao: h["access-control-allow-origin"] ?? null });
      });
      cdp.on("Network.loadingFailed", (e) => {
        const u = byId.get(e.requestId);
        if (u) cdpSeen.set(u, { ...(cdpSeen.get(u) || {}), failed: e.errorText, cors: e.corsErrorStatus?.corsError ?? null });
      });
    }
    await page.goto(origin + "/");
    for (const p of rows) {
      const url = urlOf(p.kind, p.terms, { vn: p.vn });
      const file = path.join(cacheDir, `cors-${browserName}-${crypto.createHash("sha1").update(url).digest("hex")}.json`);
      let row;
      if (fs.existsSync(file)) {
        row = { ...JSON.parse(fs.readFileSync(file, "utf8")).row, fromCache: true };
      } else {
        if (calls >= MAX_CALLS) throw new Error("chạm trần 12 lượt");
        const wait = lastCall + SEARCH_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastCall = Date.now();
        calls++;
        const respP = page.waitForResponse((r) => r.url() === url, { timeout: 25000 }).catch(() => null);
        const inPage = await page.evaluate(async (u) => {
          const t0 = performance.now();
          try {
            const r = await fetch(u);
            const text = await r.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* không phải JSON */ }
            return { ok: true, status: r.status, json, ms: performance.now() - t0, len: text.length };
          } catch (e) {
            return { ok: false, error: String(e && e.message || e), ms: performance.now() - t0 };
          }
        }, url);
        const resp = await respP;
        const headers = resp ? await resp.allHeaders().catch(() => ({})) : {};
        const seen = cdpSeen.get(url) || null;
        const prods = inPage.json ? productsOf(p.kind, inPage.json) : [];
        row = {
          ...p, browserVersion: browser.version(), url: url.replace(/&app_name=.*$/, "&app_name=…"),
          httpStatus: resp ? resp.status() : (seen?.status ?? null),
          acao: resp ? (headers["access-control-allow-origin"] ?? null) : (seen?.acao ?? null),
          cdp: seen, fetchOk: inPage.ok, fetchError: inPage.ok ? null : inPage.error, ms: Math.round(inPage.ms),
          count: inPage.json ? (inPage.json.count ?? inPage.json.total ?? null) : null,
          returned: prods.length,
          top5: prods.slice(0, 5).map((x) => ({ code: String(x.code ?? ""), name: x.product_name_vi || x.product_name || x.product_name_en || "", brands: Array.isArray(x.brands) ? x.brands.join(", ") : (x.brands ?? ""), vn: Array.isArray(x.countries_tags) && x.countries_tags.includes("en:vietnam") })),
          has7up: prods.findIndex((x) => String(x.code) === TARGET_7UP) + 1 || null,
        };
        fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), row, body: inPage.json }), "utf8");
      }
      results.push(row);
      console.log(`${browserName} ${p.kind}${p.vn ? " (lọc VN)" : ""} "${p.terms}": HTTP ${row.httpStatus}, ACAO=${row.acao}, fetch ${row.fetchOk ? "được" : "LỖI " + row.fetchError}${row.cdp?.cors ? " CORS " + row.cdp.cors : ""}, count ${row.count}, 7Up ${row.has7up ?? "-"}, ${row.ms} ms${row.fromCache ? " (cache)" : ""}`);
      for (const h of row.top5) console.log(`    ${h.code} ${h.name} | ${h.brands}${h.vn ? " [VN]" : ""}`);
    }
    await browser.close();
  }
  server.close();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), origin, callsThisRun: calls, maxCalls: MAX_CALLS, results }, null, 1), "utf8");
  console.log(`Lượt tìm gọi thật lần này: ${calls}. Ghi: ${out}`);
}
