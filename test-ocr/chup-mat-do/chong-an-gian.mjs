// Chuẩn bị chống ăn gian cho cách 2 (tìm theo hình): với mỗi mã thử, chọn ảnh chỉ mục là một ảnh MẶT TRƯỚC
// đã chọn trên Open Food Facts (images.front_xx) KHÁC front.jpg dùng để thử:
//   - khác imgid của front.jpg (imgid lấy từ URL trong photos/NGUON.csv), và
//   - không gần trùng front.jpg: dHash 64 bit cách > DHASH_NEAR bit (lib.mjs).
// Không có ảnh như vậy -> "loại khỏi cách 2".
//
//   node chup-mat-do/chong-an-gian.mjs [--photos D:\quet-ma-vach-full\test-ocr\photos]
//
// Gọi OFF: 31 lượt đọc sản phẩm (giãn ≥ 1 giây, có cache). Tải ảnh ứng viên cỡ 400 px từ images.openfoodfacts.org
// (giãn ≥ 1 giây, có rồi thì không tải lại) vào D:\tmp\chup-mat-do\anh-off\. Mã băm tính bằng canvas trong
// Playwright Chromium (không thêm thư viện đọc ảnh).
// Ra: D:\tmp\chup-mat-do\ket-qua\chong-an-gian.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsv, imgidFromUrl, frontImages, chooseIndexImage, dHashFromGray, DHASH_NEAR } from "./lib.mjs";
import { createOffClient, makeLimiter } from "./off-search.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const photosDir = opt("--photos", "D:\\quet-ma-vach-full\\test-ocr\\photos");
const imgDir = opt("--img-dir", "D:\\tmp\\chup-mat-do\\anh-off");
const outFile = opt("--out", "D:\\tmp\\chup-mat-do\\ket-qua\\chong-an-gian.json");
const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const nguon = parseCsv(fs.readFileSync(path.join(photosDir, "NGUON.csv"), "utf8"));
fs.mkdirSync(imgDir, { recursive: true });

const off = createOffClient({ log: (m) => console.log(m) });
const imgLimiter = makeLimiter(1000);
const stats = { downloads: 0, downloadCached: 0, downloadErrors: 0 };

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { stats.downloadCached++; return true; }
  await imgLimiter.wait();
  stats.downloads++;
  const res = await fetch(url);
  if (!res.ok) { stats.downloadErrors++; return false; }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

// Mã băm: vẽ ảnh xuống 9×8 trên canvas (làm mượt chất lượng cao), đổi sang xám, dHashFromGray.
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || "D:\\tmp\\pw\\node_modules\\playwright\\index.mjs").href);
const launch = { headless: true };
if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
const browser = await pw.chromium.launch(launch);
const page = await browser.newPage();
async function grayOf(file) {
  const b64 = fs.readFileSync(file).toString("base64");
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 9;
    c.height = 8;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const g = [];
    for (let i = 0; i < d.length; i += 4) g.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    return g;
  }, `data:image/jpeg;base64,${b64}`);
}
const hashOf = async (file) => dHashFromGray(await grayOf(file));

const items = [];
for (const t of truth) {
  const code = t.code;
  const src = nguon.find((r) => r.code === code && r.file === "front.jpg");
  const frontFile = path.join(photosDir, code, "front.jpg");
  if (!src || !fs.existsSync(frontFile)) {
    items.push({ code, usable: false, reason: "không có front.jpg để thử" });
    console.log(`${code}: không có front.jpg`);
    continue;
  }
  const testImgid = imgidFromUrl(src.url);
  let product = null;
  try {
    product = (await off.product(code, "code,product_name,brands,images,selected_images")).product;
  } catch (e) {
    items.push({ code, testImgid, usable: false, reason: `đọc OFF lỗi: ${e.message || e}` });
    continue;
  }
  const fronts = frontImages(product);
  const testHash = await hashOf(frontFile);
  const base = src.url.slice(0, src.url.lastIndexOf("/") + 1); // thư mục ảnh của mã trên images.openfoodfacts.org
  const hashes = {};
  const files = {};
  for (const f of fronts) {
    if (f.imgid === testImgid || hashes[f.imgid]) continue;
    const file = path.join(imgDir, `${code}_${f.imgid}.400.jpg`);
    const ok = await download(`${base}${f.imgid}.400.jpg`, file);
    if (ok) { hashes[f.imgid] = await hashOf(file); files[f.imgid] = file; }
  }
  const r = chooseIndexImage(fronts, testImgid, hashes, testHash, DHASH_NEAR);
  items.push({
    code, testImgid, testHash, fronts, hashes,
    usable: !!r.chosen,
    chosen: r.chosen ? { ...r.chosen, url: `${base}${r.chosen.imgid}.400.jpg`, file: files[r.chosen.imgid] } : null,
    rejected: r.rejected,
    reason: r.chosen ? null : (fronts.length ? "mọi ảnh mặt trước đều là front.jpg hoặc gần trùng" : "OFF không có ảnh mặt trước đã chọn"),
  });
  console.log(`${code}: front.jpg imgid ${testImgid}, ${fronts.length} ảnh mặt trước -> ${r.chosen ? `dùng imgid ${r.chosen.imgid} (cách ${r.chosen.distance} bit)` : "LOẠI khỏi cách 2"}`);
}
await browser.close();

const remaining = items.filter((i) => i.usable).length;
const report = {
  generatedAt: new Date().toISOString(),
  rule: "Ảnh chỉ mục = ảnh mặt trước đã chọn (images.front_xx) có imgid khác front.jpg và dHash cách front.jpg > threshold bit (trên 64).",
  hash: "dHash 64 bit: ảnh vẽ xuống 9×8 trên canvas Chromium (imageSmoothingQuality high), xám = 0,299R + 0,587G + 0,114B, bit = điểm trái sáng hơn điểm phải.",
  threshold: DHASH_NEAR,
  total: items.length,
  remaining,
  excluded: items.filter((i) => !i.usable).map((i) => ({ code: i.code, reason: i.reason })),
  off: off.stats,
  images: stats,
  items,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
console.log(`\nCòn ${remaining}/${items.length} mã cho cách 2. OFF: ${JSON.stringify(off.stats)}, ảnh: ${JSON.stringify(stats)}\nGhi: ${outFile}`);
