// P5 vòng 5: xuất danh mục chữ VN cho trang thử (public/chup-mat-do/danh-muc-vn.json) từ dữ liệu VN trên máy.
//
//   node chup-mat-do/xuat-danh-muc.mjs [--no-name-brand]
//
// Đầu vào (không commit): D:\tmp\chup-mat-do\chi-muc\danh-muc-vn.json (1.452 sản phẩm {code, text}, thứ tự = thứ tự
// dựng BM25, giữ nguyên để bằng điểm thì xếp như bản Node) + D:\tmp\chup-mat-do\du-lieu\vn-products.json (tên,
// thương hiệu để hiển thị). Chỉ dữ liệu Open Food Facts (ODbL), không có đáp án / truth.csv.
// Ra: { meta, products: [{ code, name, brand, text }] } mỗi sản phẩm một dòng. Mục tiêu ≤ 60 KB gzip; quá thì
// --no-name-brand (bỏ name / brand riêng, trang hiển thị từ text).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const withNameBrand = !argv.includes("--no-name-brand");
const catalogFile = "D:\\tmp\\chup-mat-do\\chi-muc\\danh-muc-vn.json";
const productsFile = "D:\\tmp\\chup-mat-do\\du-lieu\\vn-products.json";
const outFile = path.join(HERE, "..", "..", "public", "chup-mat-do", "danh-muc-vn.json");
const GZIP_TARGET = 60 * 1024;

/** Tên hiển thị: product_name_vi, rồi product_name, rồi tên đầu tiên có. */
export function displayName(names) {
  const n = names || {};
  return n.product_name_vi || n.product_name || Object.values(n)[0] || "";
}

/** Chuỗi JSON: meta + mỗi sản phẩm một dòng. */
export function catalogJson(meta, products) {
  return `{"meta":${JSON.stringify(meta)},\n"products":[\n${products.map((p) => JSON.stringify(p)).join(",\n")}\n]}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const docs = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const byCode = new Map(JSON.parse(fs.readFileSync(productsFile, "utf8")).map((r) => [r.code, r]));
  const products = docs.map((d) => {
    const r = byCode.get(d.code);
    if (!r) throw new Error(`không thấy ${d.code} trong vn-products.json`);
    return withNameBrand ? { code: d.code, name: displayName(r.names), brand: r.brands || "", text: d.text } : { code: d.code, text: d.text };
  });
  const meta = {
    nguon: "Open Food Facts (https://world.openfoodfacts.org), bản xuất JSONL chính thức, sản phẩm có countries_tags en:vietnam",
    giayPhep: "ODbL 1.0 (dữ liệu) – © Open Food Facts contributors",
    ngayXuat: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }), // giờ VN
    soSanPham: products.length,
    truong: withNameBrand ? "code, name (tên hiển thị), brand, text (chữ tìm: product_name* + brands + generic_name*)" : "code, text",
  };
  const s = catalogJson(meta, products);
  fs.writeFileSync(outFile, s, "utf8");
  const raw = Buffer.byteLength(s);
  const gz = zlib.gzipSync(s, { level: 9 }).length;
  console.log(`Ghi ${outFile}: ${products.length} sản phẩm, ${(raw / 1024).toFixed(1)} KB thô, ${(gz / 1024).toFixed(1)} KB gzip${gz > GZIP_TARGET ? " – QUÁ 60 KB gzip, chạy lại với --no-name-brand" : ""}`);
  fs.writeFileSync("D:\\tmp\\chup-mat-do\\ket-qua\\danh-muc-trang-thu.json", JSON.stringify({ at: new Date().toISOString(), withNameBrand, products: products.length, rawBytes: raw, gzipBytes: gz, targetGzipBytes: GZIP_TARGET }, null, 1), "utf8");
}
