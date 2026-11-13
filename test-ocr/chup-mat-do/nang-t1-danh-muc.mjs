// Đợt nang-t1 vòng 1 (P1b): phân tích danh mục "Chụp mặt trước", CHƯA sinh file cho app (không ghi public/).
//
//   node test-ocr/chup-mat-do/nang-t1-danh-muc.mjs [--mo-rong D:\tmp\nang-t1\du-lieu\mo-rong.json] [--out D:\tmp\nang-t1\ket-qua]
//
// 1) Vì sao 1.699 sp en:vietnam (vn-products.json) chỉ còn 1.452 trong danh mục: đếm từng lý do theo luật dựng
//    danh mục của chi-muc-anh.mjs (docs = mọi bản ghi, bỏ bản ghi có docText trống).
// 2) Đếm theo tiêu chí trên tập mở rộng (mo-rong.json: en:vietnam HOẶC mã 13 số đầu 893, đọc từ bản xuất đầy đủ):
//    số sp, cỡ thô + gzip (level 9, đúng định dạng catalogJson của xuat-danh-muc.mjs), số sp có img.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { docText, rankCompare } from "./vn-data.mjs";
import { displayName, frontImg, catalogMeta, catalogJson, NGUON_VN, NGUON_VN_893 } from "./xuat-danh-muc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
export const GZIP_CAP = 300 * 1024;

const hasName = (r) => Object.values(r?.names || {}).some((v) => typeof v === "string" && v.trim());
const hasBrand = (r) => typeof r?.brands === "string" && r.brands.trim() !== "";
const is893 = (r) => /^893\d{10}$/.test(String(r?.code ?? ""));

/** Các tiêu chí chọn sản phẩm (r = bản ghi mo-rong.json: vnRecord + countries_tags + vn). */
export const CRITERIA = {
  "hien-tai (vn, docText khác rỗng)": (r) => r.vn && docText(r).trim() !== "",
  "(1) vn, có tên": (r) => r.vn && hasName(r),
  "(2) vn hoặc 893, có tên": (r) => (r.vn || is893(r)) && hasName(r),
  "(3) vn hoặc 893, có tên hoặc thương hiệu": (r) => (r.vn || is893(r)) && (hasName(r) || hasBrand(r)),
  "(3b) vn hoặc 893, có tên và thương hiệu": (r) => (r.vn || is893(r)) && hasName(r) && hasBrand(r),
};

/** Bản ghi -> sản phẩm danh mục { code, name, brand, img?, text } (đúng dạng xuat-danh-muc.mjs). */
export function catalogProduct(r) {
  const img = frontImg(r.fronts);
  return { code: r.code, name: displayName(r.names), brand: r.brands || "", ...(img ? { img } : {}), text: docText(r) };
}

/** Lý do một bản ghi VN không vào danh mục 1.452 (luật chi-muc-anh.mjs): docText trống. Trả mảng lý do chi tiết. */
export function dropReasons(r) {
  if (docText(r).trim() !== "") return [];
  const out = ["docText trống"];
  if (!hasName(r)) out.push("không tên");
  if (!hasBrand(r)) out.push("không thương hiệu");
  if (!Object.keys(r.generic || {}).length) out.push("không generic_name");
  return out;
}

/** Cỡ một danh mục: thô + gzip level 9 (đúng định dạng file của app). */
export function catalogSize(products, nguon = NGUON_VN) {
  const s = catalogJson(catalogMeta({ withNameBrand: true, count: products.length, date: "2026-11-13", nguon }), products);
  return { raw: Buffer.byteLength(s), gzip: zlib.gzipSync(s, { level: 9 }).length };
}

/**
 * Vòng 2 (P5): danh mục mở rộng THỬ. Luật chọn = luật danh mục cũ, chỉ nới nguồn: bản ghi (en:vietnam HOẶC mã 13 số
 * đầu 893) có docText khác rỗng. Luật thứ tự: sản phẩm của danh mục cũ trước, đúng thứ tự và đúng bản ghi cũ; sản phẩm
 * mới (mã chưa có) nối sau, xếp theo rankCompare. Mã trùng trong records: giữ bản đầu. Trả { products, added }.
 */
export function buildExtended(oldProducts, records) {
  const oldCodes = new Set(oldProducts.map((p) => p.code));
  if (oldCodes.size !== oldProducts.length) throw new Error("danh mục cũ có mã trùng");
  const seen = new Set();
  const fresh = [];
  for (const r of records || []) {
    if (!r || seen.has(r.code)) continue;
    seen.add(r.code);
    if (oldCodes.has(r.code)) continue;
    if (!(r.vn || is893(r))) continue;
    if (docText(r).trim() === "") continue;
    fresh.push(r);
  }
  fresh.sort(rankCompare);
  const products = [...oldProducts, ...fresh.map(catalogProduct)];
  if (new Set(products.map((p) => p.code)).size !== products.length) throw new Error("danh mục mở rộng có mã trùng");
  return { products, added: fresh.length };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

/** Dựng + ghi danh mục mở rộng thử (KHÔNG ghi public/). Trả số liệu. */
export function writeExtended({ appFile, extFile, outFile, date }) {
  const oldText = fs.readFileSync(appFile, "utf8");
  const old = JSON.parse(oldText).products;
  const ext = JSON.parse(fs.readFileSync(extFile, "utf8"));
  const { products, added } = buildExtended(old, ext);
  const s = catalogJson(catalogMeta({ withNameBrand: true, count: products.length, date, nguon: NGUON_VN_893 }), products);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, s, "utf8");
  // kiểm lại từ file đã ghi: 1.452 dòng đầu trùng từng trường với file cũ, không trùng mã
  const back = JSON.parse(fs.readFileSync(outFile, "utf8")).products;
  const sameHead = old.every((p, i) => JSON.stringify(p) === JSON.stringify(back[i]));
  if (!sameHead) throw new Error("phần đầu danh mục mở rộng lệch danh mục cũ");
  if (new Set(back.map((p) => p.code)).size !== back.length) throw new Error("danh mục mở rộng có mã trùng");
  return {
    n: back.length, old: old.length, added, sameHead, raw: Buffer.byteLength(s), gzip: zlib.gzipSync(s, { level: 9 }).length,
    withImg: back.filter((p) => p.img).length, overCap: zlib.gzipSync(s, { level: 9 }).length > GZIP_CAP,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--dung-mo-rong")) {
  //   node test-ocr/chup-mat-do/nang-t1-danh-muc.mjs --dung-mo-rong [--mo-rong <file>] [--ra <file>]
  const r = writeExtended({
    appFile: path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"),
    extFile: arg("mo-rong", "D:\\tmp\\nang-t1\\du-lieu\\mo-rong.json"),
    outFile: arg("ra", "D:\\tmp\\nang-t1\\du-lieu\\danh-muc-mo-rong.json"),
    date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }),
  });
  console.log(`Danh mục mở rộng thử: ${JSON.stringify(r)}`);
  if (r.overCap) { console.error("VƯỢT ≈ 300 KB gzip: DỪNG, không dùng."); process.exitCode = 1; }
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const vnFile = arg("vn", "D:\\tmp\\chup-mat-do\\du-lieu\\vn-products.json");
  const extFile = arg("mo-rong", "D:\\tmp\\nang-t1\\du-lieu\\mo-rong.json");
  const outDir = arg("out", "D:\\tmp\\nang-t1\\ket-qua");
  const appCat = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"), "utf8"));
  const appCodes = new Set(appCat.products.map((p) => p.code));
  const out = { at: new Date().toISOString() };

  // 1) 1.699 -> 1.452
  const vn = JSON.parse(fs.readFileSync(vnFile, "utf8"));
  const codes = vn.map((r) => r.code);
  const reasons = {};
  let dropped = 0;
  for (const r of vn) {
    const rs = dropReasons(r);
    if (!rs.length) continue;
    dropped++;
    const key = rs.join(" + ");
    reasons[key] = (reasons[key] || 0) + 1;
  }
  const kept = vn.filter((r) => !dropReasons(r).length);
  out.vnToCatalog = {
    vnProducts: vn.length, duplicateCodes: codes.length - new Set(codes).size, dropped, kept: kept.length, appCatalog: appCat.products.length,
    keptEqualsApp: kept.length === appCodes.size && kept.every((r) => appCodes.has(r.code)), reasons,
    droppedWithFront: vn.filter((r) => dropReasons(r).length && r.fronts?.length).length,
    droppedWithUploaded: vn.filter((r) => dropReasons(r).length && r.uploaded > 0).length,
  };
  console.log(`1.699 -> 1.452: ${JSON.stringify(out.vnToCatalog)}`);
  const appSize = { raw: Buffer.byteLength(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"))), gzip: zlib.gzipSync(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json")), { level: 9 }).length };
  out.appCatalogSize = appSize;
  console.log(`Danh mục app hiện tại: ${appCat.products.length} sp, thô ${appSize.raw} B, gzip ${appSize.gzip} B`);

  // 2) tiêu chí trên tập mở rộng
  if (fs.existsSync(extFile)) {
    const ext = JSON.parse(fs.readFileSync(extFile, "utf8"));
    const seen = new Set();
    const uniq = [];
    for (const r of ext) { if (!seen.has(r.code)) { seen.add(r.code); uniq.push(r); } }
    out.ext = { records: ext.length, unique: uniq.length, vn: uniq.filter((r) => r.vn).length, is893: uniq.filter(is893).length,
      vnAnd893: uniq.filter((r) => r.vn && is893(r)).length, only893: uniq.filter((r) => !r.vn && is893(r)).length };
    console.log(`Tập mở rộng: ${JSON.stringify(out.ext)}`);
    out.criteria = [];
    for (const [name, f] of Object.entries(CRITERIA)) {
      const recs = uniq.filter(f).sort(rankCompare);
      const products = recs.map(catalogProduct);
      const size = catalogSize(products);
      const row = { name, n: products.length, raw: size.raw, gzip: size.gzip, withImg: products.filter((p) => p.img).length,
        inAppCatalog: products.filter((p) => appCodes.has(p.code)).length, overCap: size.gzip > GZIP_CAP };
      out.criteria.push(row);
      console.log(`${name.padEnd(44)} ${String(row.n).padStart(6)} sp, thô ${(row.raw / 1024).toFixed(1)} KB, gzip ${(row.gzip / 1024).toFixed(1)} KB, có img ${row.withImg}, trong danh mục app ${row.inAppCatalog}${row.overCap ? " – VƯỢT 300 KB" : ""}`);
    }
  } else console.log(`Chưa có ${extFile}: bỏ phần tiêu chí.`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "danh-muc-phan-tich.json"), JSON.stringify(out, null, 1), "utf8");
  console.log(`Ghi ${path.join(outDir, "danh-muc-phan-tich.json")}`);
}
