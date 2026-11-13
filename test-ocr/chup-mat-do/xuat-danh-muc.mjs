// P5 vòng 5: xuất danh mục chữ VN cho trang thử (public/chup-mat-do/danh-muc-vn.json) từ dữ liệu VN trên máy.
//
//   node chup-mat-do/xuat-danh-muc.mjs [--no-name-brand]
//
// Đầu vào (không commit): D:\tmp\chup-mat-do\chi-muc\danh-muc-vn.json (1.452 sản phẩm {code, text}, thứ tự = thứ tự
// dựng BM25, giữ nguyên để bằng điểm thì xếp như bản Node) + D:\tmp\chup-mat-do\du-lieu\vn-products.json (tên,
// thương hiệu để hiển thị). Chỉ dữ liệu Open Food Facts (ODbL), không có đáp án / truth.csv.
// Ra: { meta, products: [{ code, name, brand, img?, text }] } mỗi sản phẩm một dòng. Mục tiêu ≤ 60 KB gzip; quá thì
// --no-name-brand (bỏ name / brand riêng, trang hiển thị từ text).
// Đợt chup-mat: img = ảnh mặt trước đã chọn trên Open Food Facts, dạng "khóa.rev" (vd "front_vi.10"), app ghép thành
// https://images.openfoodfacts.org/images/products/<đường theo mã>/<img>.200.jpg; không có ảnh thì bỏ trường.
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

/**
 * Ảnh mặt trước cho gợi ý (đợt chup-mat): fronts của vn-products.json ([{ key, imgid, rev }]) → "khóa.rev".
 * Ưu tiên front_vi, rồi front_en, rồi ảnh front_<ngôn ngữ> đầu tiên. Khóa "front" trần (kiểu cũ) bỏ qua: Open Food Facts
 * không còn trả nó trong selected_images (đối chiếu 8301011307914, 13/11/2026). Không có → "".
 */
export function frontImg(fronts) {
  const list = (Array.isArray(fronts) ? fronts : [])
    .filter((f) => f && /^front_[a-z]{2,3}$/.test(f.key) && /^\d{1,6}$/.test(String(f.rev ?? "")));
  const f = list.find((x) => x.key === "front_vi") || list.find((x) => x.key === "front_en") || list[0];
  return f ? `${f.key}.${f.rev}` : "";
}

export const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";

/** Khối meta của danh mục: nguồn, giấy phép (vòng 6: thêm link ODbL 1.0 + câu cơ sở dữ liệu phái sinh), ngày xuất. */
export function catalogMeta({ withNameBrand, count, date }) {
  return {
    nguon: "Open Food Facts (https://world.openfoodfacts.org), bản xuất JSONL chính thức, sản phẩm có countries_tags en:vietnam",
    giayPhep: "ODbL 1.0 (dữ liệu) – © Open Food Facts contributors",
    ngayXuat: date,
    soSanPham: count,
    truong: withNameBrand
      ? "code, name (tên hiển thị), brand, img (ảnh mặt trước: khóa.rev, không có thì bỏ), text (chữ tìm: product_name* + brands + generic_name*)"
      : "code, img (ảnh mặt trước: khóa.rev, không có thì bỏ), text",
    giayPhepUrl: ODBL_URL,
    ghiChuGiayPhep: "Cơ sở dữ liệu phái sinh từ Open Food Facts, phát hành theo ODbL 1.0",
  };
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
    const img = frontImg(r.fronts);
    const extra = img ? { img } : {};
    return withNameBrand ? { code: d.code, name: displayName(r.names), brand: r.brands || "", ...extra, text: d.text } : { code: d.code, ...extra, text: d.text };
  });
  const meta = catalogMeta({ withNameBrand, count: products.length, date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }) }); // ngày giờ VN
  const s = catalogJson(meta, products);
  fs.writeFileSync(outFile, s, "utf8");
  const raw = Buffer.byteLength(s);
  const gz = zlib.gzipSync(s, { level: 9 }).length;
  console.log(`Ghi ${outFile}: ${products.length} sản phẩm, ${(raw / 1024).toFixed(1)} KB thô, ${(gz / 1024).toFixed(1)} KB gzip${gz > GZIP_TARGET ? " – QUÁ 60 KB gzip, chạy lại với --no-name-brand" : ""}`);
  fs.writeFileSync("D:\\tmp\\chup-mat-do\\ket-qua\\danh-muc-trang-thu.json", JSON.stringify({ at: new Date().toISOString(), withNameBrand, products: products.length, rawBytes: raw, gzipBytes: gz, targetGzipBytes: GZIP_TARGET }, null, 1), "utf8");
}
