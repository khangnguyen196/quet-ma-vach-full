// Chuẩn bị chống ăn gian cho cách 2 (tìm theo hình): với mỗi mã thử, chọn ảnh chỉ mục là một ảnh MẶT TRƯỚC
// đã chọn trên Open Food Facts (images.front_xx) KHÁC front.jpg dùng để thử (luật vòng 2, lib.mjs chooseIndexImageV2):
//   - khác imgid của front.jpg (imgid lấy từ URL trong photos/NGUON.csv; front_xx nào trỏ về imgid đó cũng bỏ);
//   - so ít phụ thuộc khung cắt: vùng giữa 100 / 90 / 80 / 70 % của cả hai ảnh, dHash + pHash, lấy khoảng cách
//     nhỏ nhất: ≤ 10 bit là trùng (loại tự động), 11–24 bit nghi ngờ (bắt buộc xem tay, kết quả ở xem-tay.mjs);
//   - mọi ảnh được chọn đều phải có kết quả xem tay (manualCheck), chưa xem thì ghi "chưa xem tay".
// Không có ảnh như vậy -> "loại khỏi cách 2" kèm lý do từng ứng viên.
//
//   node chup-mat-do/chong-an-gian.mjs [--photos D:\quet-ma-vach-full\test-ocr\photos]
//
// Gọi OFF qua trang Chromium (browser-fetch.mjs, như run-ocr-off.mjs: OFF trả 503 cho User-Agent "node"):
// 31 lượt đọc sản phẩm (giãn ≥ 1 giây, có cache). Ảnh ứng viên cỡ 400 px từ images.openfoodfacts.org (giãn ≥ 1 giây,
// có rồi thì không tải lại, có try/catch) vào D:\tmp\chup-mat-do\anh-off\. Ảnh to (--big <mã>) tải qua trang Chromium.
// Ảnh xám tính bằng canvas trong Chromium (cạnh dài 256 px), mã băm tính bằng lib.mjs (không thêm thư viện).
// Ra: D:\tmp\chup-mat-do\ket-qua\chong-an-gian.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCsv, imgidFromUrl, frontImages, chooseIndexImageV2, cropHashSet, compareHashSets, HASH_DUP, HASH_SUSPECT, CROP_LEVELS,
} from "./lib.mjs";
import { createOffClient, makeLimiter } from "./off-search.mjs";
import { createBrowserFetch } from "./browser-fetch.mjs";
import { MANUAL } from "./xem-tay.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const photosDir = opt("--photos", process.env.PHOTOS_DIR || "D:\\quet-ma-vach-full\\test-ocr\\photos");
const imgDir = opt("--img-dir", "D:\\tmp\\chup-mat-do\\anh-off");
const outFile = opt("--out", "D:\\tmp\\chup-mat-do\\ket-qua\\chong-an-gian.json");
// mã cần tải thêm ảnh to (cỡ gốc) của ứng viên để xem tay kỹ hơn, cách nhau dấu phẩy
const bigCodes = (opt("--big", "8934572260543") || "").split(",").filter(Boolean);
const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const nguon = parseCsv(fs.readFileSync(path.join(photosDir, "NGUON.csv"), "utf8"));
fs.mkdirSync(imgDir, { recursive: true });
const prevReport = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : null;

const bf = await createBrowserFetch();
const off = createOffClient({ fetchImpl: bf.fetchImpl, log: (m) => console.log(m) });
const imgLimiter = makeLimiter(1000);
const stats = { downloads: 0, downloadCached: 0, downloadErrors: 0, errors: [] };

/** Tải ảnh (có cache đĩa). viaBrowser: tải trong trang Chromium. Lỗi -> false, ghi lại, không dừng. */
async function download(url, file, { viaBrowser = false } = {}) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { stats.downloadCached++; return true; }
  await imgLimiter.wait();
  stats.downloads++;
  try {
    let bytes;
    if (viaBrowser) {
      const r = await bf.fetchBytes(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      bytes = r.bytes;
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
    }
    fs.writeFileSync(file, bytes);
    return true;
  } catch (e) {
    stats.downloadErrors++;
    stats.errors.push(`${url}: ${e.message || e}`);
    console.log(`  tải lỗi ${url}: ${e.message || e}`);
    return false;
  }
}

// Ảnh xám cạnh dài 256 px (canvas, làm mượt chất lượng cao) -> cropHashSet (lib.mjs).
async function grayOf(file) {
  const b64 = fs.readFileSync(file).toString("base64");
  return bf.page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const s = 256 / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(8, Math.round(img.naturalWidth * s));
    const h = Math.max(8, Math.round(img.naturalHeight * s));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = [];
    for (let i = 0; i < d.length; i += 4) g.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    return { w, h, g, natural: [img.naturalWidth, img.naturalHeight] };
  }, `data:image/jpeg;base64,${b64}`);
}
async function setOf(file) {
  const { w, h, g, natural } = await grayOf(file);
  return { set: cropHashSet(g, w, h), natural };
}

const items = [];
try {
  for (const t of truth) {
    const code = t.code;
    const src = nguon.find((r) => r.code === code && r.file === "front.jpg");
    const frontFile = path.join(photosDir, code, "front.jpg");
    if (!src || !fs.existsSync(frontFile)) {
      items.push({ code, usable: false, reason: "không có front.jpg" });
      console.log(`${code}: không có front.jpg`);
      continue;
    }
    const testImgid = imgidFromUrl(src.url);
    let product = null;
    try {
      product = (await off.product(code, "code,product_name,brands,images,selected_images")).product;
    } catch (e) {
      items.push({ code, testImgid, usable: false, reason: `đọc OFF lỗi: ${e.message || e}` });
      if (e.breakerOpen) throw e;
      continue;
    }
    const fronts = frontImages(product);
    const test = await setOf(frontFile);
    const base = src.url.slice(0, src.url.lastIndexOf("/") + 1); // thư mục ảnh của mã trên images.openfoodfacts.org
    const sets = {};
    const files = {};
    const compares = {};
    for (const f of fronts) {
      if (f.imgid === testImgid || sets[f.imgid]) continue;
      const file = path.join(imgDir, `${code}_${f.imgid}.400.jpg`);
      if (await download(`${base}${f.imgid}.400.jpg`, file)) {
        sets[f.imgid] = (await setOf(file)).set;
        files[f.imgid] = file;
        compares[f.imgid] = compareHashSets(sets[f.imgid], test.set);
      }
      if (bigCodes.includes(code)) {
        const big = path.join(imgDir, `${code}_${f.imgid}.full.jpg`);
        if (await download(`${base}${f.imgid}.jpg`, big, { viaBrowser: true })) {
          const bs = await setOf(big);
          compares[`${f.imgid}.full`] = { ...compareHashSets(bs.set, test.set), natural: bs.natural, file: big };
        }
      }
    }
    const manual = MANUAL[code] || {};
    const r = chooseIndexImageV2(fronts, testImgid, sets, test.set, manual);
    const prev = prevReport?.items?.find((i) => i.code === code);
    const chosenManual = r.chosen ? (manual[r.chosen.imgid] ?? null) : null;
    items.push({
      code, testImgid, fronts, compares,
      usable: !!r.chosen,
      chosen: r.chosen ? { key: r.chosen.key, imgid: r.chosen.imgid, compare: r.chosen.compare, url: `${base}${r.chosen.imgid}.400.jpg`, file: files[r.chosen.imgid] } : null,
      manualCheck: r.chosen ? (chosenManual ? { verdict: chosenManual.verdict, note: chosenManual.note } : { verdict: "chưa xem tay" }) : null,
      rejected: r.rejected.map((x) => ({ key: x.key, imgid: x.imgid, reason: x.reason, distance: x.compare?.distance, manual: x.manual })),
      v1: prev?.v1 ?? (prev ? { usable: prev.usable, chosen: prev.chosen ? { imgid: prev.chosen.imgid, distance: prev.chosen.distance } : null } : null),
      reason: r.chosen ? null : (fronts.length ? [...new Set(r.rejected.map((x) => x.reason))].join("; ") : "OFF không có ảnh mặt trước đã chọn"),
    });
    const c = r.chosen?.compare;
    console.log(`${code}: front.jpg imgid ${testImgid}, ${fronts.length} ảnh mặt trước -> ${r.chosen ? `dùng imgid ${r.chosen.imgid} (dHash ${c.dMin}, pHash ${c.pMin} bit, ${c.verdict}; xem tay: ${chosenManual?.verdict ?? "chưa"})` : `LOẠI (${items.at(-1).reason})`}`);
  }
} finally {
  await bf.close();
}

const remaining = items.filter((i) => i.usable && i.manualCheck?.verdict === "khác").length;
const report = {
  generatedAt: new Date().toISOString(),
  rule: "Ảnh chỉ mục = ảnh mặt trước đã chọn (images.front_xx) có imgid khác front.jpg; so vùng giữa " +
    `${CROP_LEVELS.map((x) => x * 100).join(" / ")} % của cả hai ảnh, khoảng cách nhỏ nhất của dHash và pHash (64 bit): ` +
    `≤ ${HASH_DUP} bit là trùng (loại), ${HASH_DUP + 1}–${HASH_SUSPECT} bit nghi ngờ (bắt buộc xem tay); mọi ảnh được chọn đều xem tay.`,
  hash: "Ảnh xám cạnh dài 256 px (canvas Chromium, imageSmoothingQuality high, xám = 0,299R + 0,587G + 0,114B); cắt + thu nhỏ bằng trung bình vùng (lib.mjs resizeGray); dHash 9×8, pHash DCT 32×32 tự viết.",
  thresholds: { dup: HASH_DUP, suspect: HASH_SUSPECT },
  total: items.length,
  remaining,
  remainingNote: "chỉ đếm mã có ảnh được chọn VÀ xem tay ghi 'khác'",
  excluded: items.filter((i) => !(i.usable && i.manualCheck?.verdict === "khác")).map((i) => ({ code: i.code, reason: i.reason ?? `xem tay: ${i.manualCheck?.verdict}` })),
  off: off.stats,
  images: stats,
  items,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
console.log(`\nCòn ${remaining}/${items.length} mã cho cách 2. OFF: ${JSON.stringify(off.stats)}, ảnh: ${JSON.stringify({ ...stats, errors: stats.errors.length })}\nGhi: ${outFile}`);
