// P1 vòng 3: tải bản xuất JSONL chính thức của Open Food Facts MỘT lần, đọc luồng (zlib của Node), giữ sản phẩm VN.
//
//   node chup-mat-do/du-lieu-vn.mjs [--dir D:\tmp\chup-mat-do\du-lieu]
//
// Nguồn: https://world.openfoodfacts.org/data -> https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
// (chuyển hướng sang bucket S3 openfoodfacts-ds). Giấy phép: cơ sở dữ liệu ODbL 1.0, nội dung DbCL 1.0, ảnh CC BY-SA 3.0.
// Tải bằng curl (không thêm header nào, như luật dự án) vừa ghi ra đĩa vừa giải nén + lọc cùng lúc, nên khi tải xong
// là có danh sách VN. File đã tải đủ thì chỉ đọc lại từ đĩa, không tải lại.
// Cầu dao như createOffClient: tải hỏng thì thử lại 1 lần (nối tiếp từ byte đã có) sau 30 giây; hỏng lần 2 thì dừng.
// Ra: <dir>\vn-products.json (bản ghi gọn, xem vn-data.mjs vnRecord) + <dir>\vn-stats.json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { filterVnStream } from "./vn-data.mjs";

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

/** Một lần tải (từ byte `from`), đẩy dữ liệu vào `sink` (ghi file + giải nén). Trả mã thoát của curl. */
function curlOnce(from, onData) {
  return new Promise((resolve) => {
    const args = ["-sSL", "--fail", "-o", "-"];
    if (from > 0) args.push("-r", `${from}-`);
    args.push(URL);
    const p = spawn("curl", args);
    p.stdout.on("data", onData);
    p.stderr.on("data", (d) => process.stderr.write(d));
    p.on("close", (code) => resolve(code));
  });
}

const total = await headSize();
stats.expectedBytes = total;
const have = fs.existsSync(gzFile) ? fs.statSync(gzFile).size : 0;
let result;
if (total && have === total) {
  stats.fromDisk = true;
  console.log(`Đã có ${gzFile} (${(have / 1e9).toFixed(2)} GB), chỉ đọc lại`);
  result = await filterVnStream(fs.createReadStream(gzFile).pipe(zlib.createGunzip()), {
    onProgress: (n) => console.log(`  ${n} dòng, ${((Date.now() - t0) / 60000).toFixed(1)} phút`),
  });
} else {
  if (have) fs.rmSync(gzFile); // tải dở từ lần trước: tải lại từ đầu để luồng giải nén liền mạch
  const out = fs.createWriteStream(gzFile);
  const pass = new PassThrough({ highWaterMark: 1 << 24 });
  const gunzip = zlib.createGunzip();
  const filtering = filterVnStream(pass.pipe(gunzip), {
    onProgress: (n) => console.log(`  ${n} dòng, ${(stats.bytes / 1e9).toFixed(2)} GB, ${((Date.now() - t0) / 60000).toFixed(1)} phút`),
  });
  let code = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) {
      console.log("  tải hỏng, thử lại sau 30 giây (nối tiếp)");
      await new Promise((r) => setTimeout(r, 30000));
    }
    stats.attempts++;
    code = await curlOnce(stats.bytes, (d) => {
      stats.bytes += d.length;
      out.write(d);
      if (!pass.write(d)) { /* luồng giải nén chậm hơn mạng: bộ đệm lớn, để Node tự giữ */ }
    });
    if (code === 0 && (!total || stats.bytes === total)) break;
    stats.failures++;
  }
  pass.end();
  await new Promise((r) => out.end(r));
  if (code !== 0) {
    stats.error = `curl thoát mã ${code} sau ${stats.attempts} lần (cầu dao: ngừng)`;
    fs.writeFileSync(path.join(dir, "vn-stats.json"), JSON.stringify(stats, null, 2));
    console.error(stats.error);
    process.exit(1);
  }
  result = await filtering;
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
