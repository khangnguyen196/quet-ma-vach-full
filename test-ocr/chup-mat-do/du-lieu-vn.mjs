// P1 vòng 3: tải bản xuất JSONL chính thức của Open Food Facts MỘT lần, đọc luồng (zlib của Node), giữ sản phẩm VN.
//
//   node chup-mat-do/du-lieu-vn.mjs [--dir D:\tmp\chup-mat-do\du-lieu]
//
// Nguồn: https://world.openfoodfacts.org/data -> https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
// (chuyển hướng sang bucket S3 openfoodfacts-ds). Giấy phép: cơ sở dữ liệu ODbL 1.0, nội dung DbCL 1.0, ảnh CC BY-SA 3.0.
// Tải bằng curl (không thêm header nào, như luật dự án) vừa ghi ra đĩa vừa giải nén + lọc cùng lúc, nên khi tải xong
// là có danh sách VN. File đã tải đủ thì chỉ đọc lại từ đĩa, không tải lại.
// Cầu dao như createOffClient: tải hỏng thì thử lại 1 lần (nối tiếp từ byte đã có, Range) sau 30 giây; hỏng lần 2 thì dừng.
// Vòng 4: tải nối phải nhận 206 (không thì tải lại từ đầu), số byte cuối phải bằng Content-Length, ghi chờ 'drain'.
// Vòng 5: trước khi nối thăm dò 1 byte (tai-noi.mjs probeArgs); resumePlan: chỉ nối khi ra 206, không thì xóa file dở,
// tải lại từ đầu (gunzip mới). Chưa chạy thật (không tải lại 13 GB).
// Ra: <dir>\vn-products.json (bản ghi gọn, xem vn-data.mjs vnRecord) + <dir>\vn-stats.json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { filterVnStream } from "./vn-data.mjs";
import { parseHttpCode, resumeOk, isComplete, pipeWithBackpressure, probeArgs, resumePlan } from "./tai-noi.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const dir = opt("--dir", "D:\\tmp\\chup-mat-do\\du-lieu");
const URL = "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz";
const gzFile = path.join(dir, "openfoodfacts-products.jsonl.gz");
fs.mkdirSync(dir, { recursive: true });

const t0 = Date.now();
const stats = { url: URL, attempts: 0, failures: 0, bytes: 0, fromDisk: false };

async function headSize() {
  return new Promise((resolve) => {
    const p = spawn("curl", ["-sSIL", "--max-time", "60", URL]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      const m = [...out.matchAll(/content-length:\s*(\d+)/gi)].map((x) => Number(x[1]));
      resolve(m.length ? m[m.length - 1] : null);
    });
  });
}

/** Một lần tải (từ byte `from`): ghi vào mọi luồng `dests` có chống nghẽn (chờ 'drain', tai-noi.mjs).
 *  Trả { code: mã thoát curl, http: mã HTTP cuối (curl -w ra stderr) }. */
function curlOnce(from, dests, onChunk) {
  return new Promise((resolve) => {
    const args = ["-sSL", "--fail", "-o", "-", "-w", "%{stderr}HTTP_CODE=%{http_code}\\n"];
    if (from > 0) args.push("-r", `${from}-`);
    args.push(URL);
    const p = spawn("curl", args);
    let err = "";
    const piping = pipeWithBackpressure(p.stdout, dests, onChunk);
    p.stderr.on("data", (d) => { err += d; if (!/HTTP_CODE=/.test(String(d))) process.stderr.write(d); });
    p.on("close", async (code) => { await piping.catch(() => {}); resolve({ code, http: parseHttpCode(err) }); });
  });
}

/** Thăm dò 1 byte ở vị trí `n` (curl -s -o NUL -r n-n -w "%{http_code}"), trả mã HTTP (số) hoặc null. */
function probeOnce(n) {
  return new Promise((resolve) => {
    const p = spawn("curl", probeArgs(URL, n, process.platform === "win32" ? "NUL" : "/dev/null"));
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => { const m = /(\d{3})\s*$/.exec(out); resolve(m ? Number(m[1]) : null); });
    p.on("error", () => resolve(null));
  });
}

/** Tải từ đầu + lọc cùng lúc. Tải hỏng thì thử nối 1 lần (Range) sau 30 giây; server không trả 206 khi nối -> trả
 *  { restart: true } để tải lại từ đầu (luồng giải nén mới). */
async function downloadAndFilter() {
  if (fs.existsSync(gzFile)) fs.rmSync(gzFile); // tải dở: tải lại từ đầu để luồng giải nén liền mạch
  stats.bytes = 0;
  const out = fs.createWriteStream(gzFile);
  const pass = new PassThrough({ highWaterMark: 1 << 24 });
  const gunzip = zlib.createGunzip();
  const filtering = filterVnStream(pass.pipe(gunzip), {
    onProgress: (n) => console.log(`  ${n} dòng, ${(stats.bytes / 1e9).toFixed(2)} GB, ${((Date.now() - t0) / 60000).toFixed(1)} phút`),
  });
  let r = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) {
      console.log("  tải hỏng, thử lại sau 30 giây (nối tiếp)");
      await new Promise((res) => setTimeout(res, 30000));
    }
    const from = stats.bytes;
    if (from > 0) {
      // Vòng 5: thăm dò 1 byte TRƯỚC khi nối; resumePlan quyết nối hay tải lại từ đầu.
      const probe = await probeOnce(from);
      const plan = resumePlan(probe, from);
      stats.notes = [...(stats.notes || []), `thăm dò 1 byte ở ${from}: HTTP ${probe} -> ${plan}`];
      if (plan === "tu-dau") {
        stats.failures++;
        pass.destroy(); gunzip.destroy();
        await new Promise((res) => out.end(res));
        return { restart: true };
      }
    }
    stats.attempts++;
    r = await curlOnce(from, [out, pass], (d) => { stats.bytes += d.length; });
    if (!resumeOk(from, r.http)) {
      stats.failures++;
      if (from > 0) {
        stats.notes = [...(stats.notes || []), `tải nối từ byte ${from}: server trả HTTP ${r.http}, không phải 206 -> tải lại từ đầu`];
        pass.destroy(); gunzip.destroy();
        await new Promise((res) => out.end(res));
        return { restart: true };
      }
      continue;
    }
    if (r.code === 0 && (!total || isComplete(stats.bytes, total))) break;
    stats.failures++;
  }
  pass.end();
  await new Promise((res) => out.end(res));
  const size = fs.statSync(gzFile).size;
  if (r.code !== 0 || (total && !isComplete(size, total))) {
    stats.error = `curl thoát mã ${r.code} (HTTP ${r.http}), ${size}/${total ?? "?"} byte sau ${stats.attempts} lần (cầu dao: ngừng)`;
    fs.writeFileSync(path.join(dir, "vn-stats.json"), JSON.stringify(stats, null, 2));
    console.error(stats.error);
    process.exit(1);
  }
  return filtering;
}

const total = await headSize();
stats.expectedBytes = total;
const have = fs.existsSync(gzFile) ? fs.statSync(gzFile).size : 0;
let result;
if (isComplete(have, total)) {
  stats.fromDisk = true;
  console.log(`Đã có ${gzFile} (${(have / 1e9).toFixed(2)} GB), chỉ đọc lại`);
  result = await filterVnStream(fs.createReadStream(gzFile).pipe(zlib.createGunzip()), {
    onProgress: (n) => console.log(`  ${n} dòng, ${((Date.now() - t0) / 60000).toFixed(1)} phút`),
  });
} else {
  result = await downloadAndFilter();
  if (result?.restart) result = await downloadAndFilter(); // một lần tải lại từ đầu; hỏng nữa thì dừng (exit 1)
  if (result?.restart) { console.error("server vẫn không trả 206, dừng"); process.exit(1); }
}

const { records, lines } = result;
const withFront = records.filter((r) => r.fronts.length).length;
Object.assign(stats, {
  minutes: (Date.now() - t0) / 60000,
  lines,
  vnProducts: records.length,
  vnWithFront: withFront,
  vnWithScans: records.filter((r) => r.unique_scans_n != null).length,
  vnWithTwoFronts: records.filter((r) => new Set(r.fronts.map((f) => f.imgid)).size >= 2).length,
  gzBytes: fs.statSync(gzFile).size,
});
fs.writeFileSync(path.join(dir, "vn-products.json"), JSON.stringify(records), "utf8");
fs.writeFileSync(path.join(dir, "vn-stats.json"), JSON.stringify(stats, null, 2), "utf8");
console.log(JSON.stringify(stats, null, 2));
