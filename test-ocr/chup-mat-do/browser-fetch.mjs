// fetch chạy TRONG một trang Playwright Chromium (origin http://127.0.0.1:<cổng>), dùng thay fetch của Node
// cho off-search.mjs.
//
// Lý do (kiểm 07/11/2026): OFF trả 503 cho request có User-Agent "node" (fetch của Node), còn User-Agent của
// trình duyệt / curl thì 200. Luật dự án không cho thêm header, nên gọi từ trình duyệt thật: giống hệt điều
// kiện của app / trang thử (có CORS, User-Agent trình duyệt, chỉ tham số app_name / app_version trên URL).
// Lỗi CORS (OFF trả 503 không kèm header CORS) hiện thành lỗi mạng -> off-search.mjs thử lại 1 lần sau 30 giây.
import http from "node:http";
import { pathToFileURL } from "node:url";

export async function createBrowserFetch() {
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>off</title>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const launch = { headless: true };
  if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
  const browser = await pw.chromium.launch(launch);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);

  async function fetchImpl(url) {
    const r = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u);
        return { status: res.status, text: await res.text() };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    }, url);
    if (r.error) throw new Error(`fetch trong trình duyệt lỗi (thường là OFF trả lỗi không kèm CORS): ${r.error}`);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.text) };
  }

  /** Tải file nhị phân (ảnh) từ trang. Trả { status, ok, bytes: Buffer } hoặc ném lỗi mạng / CORS. */
  async function fetchBytes(url) {
    const r = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u);
        const buf = new Uint8Array(await res.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return { status: res.status, b64: btoa(s) };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    }, url);
    if (r.error) throw new Error(`tải trong trình duyệt lỗi: ${r.error}`);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, bytes: Buffer.from(r.b64, "base64") };
  }

  return {
    fetchImpl,
    fetchBytes,
    page,
    userAgent: await page.evaluate(() => navigator.userAgent),
    async close() {
      await browser.close().catch(() => {});
      server.close();
    },
  };
}
