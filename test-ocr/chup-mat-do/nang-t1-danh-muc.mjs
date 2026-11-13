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
import { displayName, frontImg, catalogMeta, catalogJson } from "./xuat-danh-muc.mjs";

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
export function catalogSize(products) {
  const s = catalogJson(catalogMeta({ withNameBrand: true, count: products.length, date: "2026-11-13" }), products);
  return { raw: Buffer.byteLength(s), gzip: zlib.gzipSync(s, { level: 9 }).length };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
