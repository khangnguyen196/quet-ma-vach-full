// Đợt tu-dong vòng 6 (P5, quyết định chủ dự án V4-1 = cách C1): sinh KHO PHỤ 893 cho "Chụp mặt trước".
//
//   node test-ocr/chup-mat-do/xuat-kho-phu.mjs [--mo-rong D:\tmp\nang-t1\du-lieu\mo-rong.json]
//
// Đọc bản ghi đã có (mo-rong.json, bản xuất JSONL 08/11/2026 của đợt nang-t1; KHÔNG tải lại bản xuất) + danh mục app
// (public/chup-mat-do/danh-muc-vn.json, không sửa), ghi FILE MỚI public/chup-mat-do/kho-phu-893.json: sản phẩm mã 13 số
// đầu 893 có tên, chưa có trong danh mục (store893 của tu-dong-893-do.mjs, xếp rankCompare), cùng định dạng danh mục
// (catalogMeta + catalogJson của xuat-danh-muc.mjs, meta có giayPhepUrl ODbL 1.0, câu nguồn NGUON_VN_893), ngày cố định
// KHO_PHU_DATE để chạy lại trùng từng byte. In sha256, cỡ thô / gzip level 9, số sản phẩm, có 7Up Diet không.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { store893 } from "./tu-dong-893-do.mjs";
import { catalogMeta, catalogJson, NGUON_VN_893 } from "./xuat-danh-muc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
/** Ngày ghi trong meta (cố định: chạy lại trùng từng byte; là ngày đo vòng 5 nên cỡ file trùng số vòng 5). */
export const KHO_PHU_DATE = "2026-11-15";
export const OUT_REL = "public/chup-mat-do/kho-phu-893.json";
export const MO_RONG = "D:\\tmp\\nang-t1\\du-lieu\\mo-rong.json";

/** records (mo-rong.json) + sản phẩm danh mục → { products, json } của kho phụ. */
export function buildKhoPhu(records, catalogProducts) {
  const codes = new Set((catalogProducts || []).map((p) => p.code));
  const products = store893(records, codes);
  const json = catalogJson(catalogMeta({ withNameBrand: true, count: products.length, date: KHO_PHU_DATE, nguon: NGUON_VN_893 }), products);
  return { products, json };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const moRong = argv.includes("--mo-rong") ? argv[argv.indexOf("--mo-rong") + 1] : MO_RONG;
  const records = JSON.parse(fs.readFileSync(moRong, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"), "utf8"));
  const { products, json } = buildKhoPhu(records, catalog.products);
  const out = path.join(ROOT, ...OUT_REL.split("/"));
  fs.writeFileSync(out, json, "utf8");
  const raw = Buffer.byteLength(json);
  const gzip = zlib.gzipSync(json, { level: 9 }).length;
  const sha256 = crypto.createHash("sha256").update(json).digest("hex");
  console.log(JSON.stringify({ file: out, products: products.length, raw, gzip, sha256, has7upDiet: products.some((p) => p.code === "8934588752117") }, null, 1));
}
