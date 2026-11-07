// Kiểm CORS (trang web gọi thẳng được hay không) của 3 kiểu tìm Open Food Facts, bằng fetch thật trong
// Playwright Chromium + WebKit, từ một trang ở http://127.0.0.1:<cổng> (origin khác OFF).
// Mỗi kiểu 1 lượt / trình duyệt (tổng 6 lượt tìm), giãn ≥ 6 giây giữa 2 lượt (≤ 10 lượt / phút).
//
//   node chup-mat-do/cors-check.mjs [--out D:\tmp\chup-mat-do\ket-qua\cors.json]
//
// Ghi: kiểu, trình duyệt, mã HTTP, header access-control-allow-origin (đọc bằng Playwright, vì JS trang không
// đọc được header này), fetch trong trang có thành công không, số kết quả, 5 mã đầu.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { searchUrl, parseHits, SEARCH_GAP_MS } from "./off-search.mjs";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "D:\\tmp\\chup-mat-do\\ket-qua\\cors.json";
// Câu tìm thử: chữ thường thấy trên một gói mì (không lấy từ đáp án theo ảnh nào cụ thể)
const TERMS = "omachi mi khoai tay";
const KINDS = ["searchpl", "apiv2", "searchalicious"];

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>cors</title><p>kiểm CORS</p>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
const results = [];
for (const browserName of ["chromium", "webkit"]) {
  const opts = { headless: true };
  if (browserName === "chromium" && process.env.PW_CHROMIUM) opts.executablePath = process.env.PW_CHROMIUM;
  const browser = await pw[browserName].launch(opts);
  const page = await browser.newPage();
  // Chromium: đọc mã HTTP + header qua CDP, kể cả khi CORS chặn (lúc đó Playwright không báo "response").
  // WebKit không có CDP: chỉ có kết quả fetch trong trang + sự kiện response của Playwright.
  const cdpSeen = new Map();
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    const byId = new Map();
    cdp.on("Network.requestWillBeSent", (e) => byId.set(e.requestId, e.request.url));
    cdp.on("Network.responseReceived", (e) => {
      const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
      cdpSeen.set(e.response.url, { status: e.response.status, acao: h["access-control-allow-origin"] ?? null });
    });
    // responseReceivedExtraInfo có cả khi CORS chặn (responseReceived thì không)
    cdp.on("Network.responseReceivedExtraInfo", (e) => {
      const u = byId.get(e.requestId);
      const h = Object.fromEntries(Object.entries(e.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      if (u) cdpSeen.set(u, { ...(cdpSeen.get(u) || {}), status: e.statusCode, acao: h["access-control-allow-origin"] ?? null, contentType: h["content-type"] ?? null });
    });
    cdp.on("Network.loadingFailed", (e) => {
      const u = byId.get(e.requestId);
      if (u) cdpSeen.set(u, { ...(cdpSeen.get(u) || {}), failed: e.errorText, cors: e.corsErrorStatus?.corsError ?? null });
    });
  }
  await page.goto(origin + "/");
  for (const kind of KINDS) {
   const url = searchUrl(kind, TERMS, { vn: true });
   // lỗi (thường là OFF giới hạn tần suất, trả lỗi không kèm header CORS) thì thử lại 1 lần sau 30 giây
   for (let attempt = 1; attempt <= 2; attempt++) {
    const wait = lastCall + (attempt === 2 ? 30000 : SEARCH_GAP_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    cdpSeen.delete(url);
    const respP = page.waitForResponse((r) => r.url().startsWith(url.split("?")[0]), { timeout: 20000 }).catch(() => null);
    const inPage = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u);
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* không phải JSON */ }
        return { ok: true, status: r.status, json };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }, url);
    const resp = await respP;
    const headers = resp ? await resp.allHeaders().catch(() => ({})) : {};
    const hits = inPage.ok && inPage.json ? parseHits(kind, inPage.json) : [];
    const seen = cdpSeen.get(url) || null;
    const row = {
      kind, browser: browserName, browserVersion: browser.version(), origin, url: url.replace(/&app_name=.*$/, "&app_name=…"),
      attempt,
      httpStatus: resp ? resp.status() : (seen?.status ?? null),
      accessControlAllowOrigin: resp ? (headers["access-control-allow-origin"] ?? null) : (seen?.acao ?? null),
      cdp: seen,
      fetchOkInPage: inPage.ok,
      fetchError: inPage.ok ? null : inPage.error,
      count: inPage.json ? (inPage.json.count ?? inPage.json.hits?.length ?? inPage.json.products?.length ?? null) : null,
      top5: hits.map((h) => h.code),
      top5Names: hits.map((h) => h.name),
    };
    results.push(row);
    console.log(`${browserName} ${kind} (lần ${attempt}): HTTP ${row.httpStatus}, ACAO=${row.accessControlAllowOrigin}, fetch ${row.fetchOkInPage ? "được" : "LỖI " + row.fetchError}${seen?.cors ? ", CORS: " + seen.cors : ""}, ${row.top5.length} kết quả`);
    if (row.fetchOkInPage) break;
   }
  }
  await browser.close();
}
server.close();

// Kiểu mặc định: tìm được theo CHỮ (apiv2 không), có lọc VN, fetch trong trang thành công ở CẢ 2 trình duyệt.
// Ưu tiên searchalicious (Elasticsearch, xếp hạng theo độ liên quan) rồi searchpl.
const textKinds = ["searchalicious", "searchpl"];
const okKinds = textKinds.filter((k) => ["chromium", "webkit"].every((b) =>
  results.some((r) => r.kind === k && r.browser === b && r.fetchOkInPage && r.httpStatus === 200)));
const chosen = okKinds[0] ?? null;
const summary = Object.fromEntries(KINDS.map((k) => {
  const rows = results.filter((r) => r.kind === k);
  return [k, {
    fetchOk: rows.filter((r) => r.fetchOkInPage).map((r) => `${r.browser} lần ${r.attempt}`),
    httpStatuses: [...new Set(rows.map((r) => r.httpStatus).filter((s) => s != null))],
    acaoSeen: [...new Set(rows.map((r) => r.accessControlAllowOrigin).filter(Boolean))],
  }];
}));
const report = {
  checkedAt: new Date().toISOString(),
  summary,
  noteErrors: "Lỗi 503 của OFF (trang HTML, không kèm header CORS) hiện trong trình duyệt thành lỗi CORS " +
    "(Chromium: MissingAllowOriginHeader, WebKit: Load failed). Mã HTTP khi bị chặn chỉ đọc được ở Chromium (CDP).",
  terms: TERMS,
  note: "apiv2 (/api/v2/search) chỉ lọc theo nhãn, không tìm theo chữ: không chọn làm kiểu tìm dù có CORS.",
  rule: "Chọn kiểu tìm theo chữ, có lọc VN, fetch trong trang thành công ở cả Chromium và WebKit; ưu tiên searchalicious rồi searchpl.",
  chosen,
  results,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log(`Kiểu mặc định: ${chosen ?? "KHÔNG CÓ"}\nGhi: ${out}`);
