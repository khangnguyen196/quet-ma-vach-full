// Kiểm tham số lọc Việt Nam của cgi/search.pl (review vòng 1: 26–28/30 câu của 1a phải bỏ lọc VN).
// 2 câu đối chứng = 2 thương hiệu đầu tiên trong danh sách thương hiệu VN đã tải từ OFF (off.vnBrands, có cache)
// mà KHÔNG xuất hiện trong truth.csv (tên, thương hiệu, nhà sản xuất), ≥ 4 chữ cái.
// Mỗi câu: tìm có lọc VN kiểu đang dùng (tag_0=en:vietnam); ra 0 thì thử 1 cách lọc khác theo tài liệu OFF
// (tag_0=vietnam, không có tiền tố en:). KHÔNG đổi luật đang chạy; chỉ ghi kết quả.
//
//   node chup-mat-do/vn-filter-check.mjs  -> D:\tmp\chup-mat-do\ket-qua\vn-filter.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, normalizeText } from "./lib.mjs";
import { createOffClient, searchUrl, parseHits } from "./off-search.mjs";
import { createBrowserFetch } from "./browser-fetch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = "D:\\tmp\\chup-mat-do\\ket-qua\\vn-filter.json";
const truth = parseCsv(fs.readFileSync(path.join(HERE, "..", "truth.csv"), "utf8"));
const truthText = ` ${truth.map((t) => normalizeText(`${t.ten} ${t.thuong_hieu} ${t.nha_san_xuat}`)).join(" ")} `;

const bf = await createBrowserFetch();
const off = createOffClient({ fetchImpl: bf.fetchImpl, log: (m) => console.log(m) });
const result = { at: new Date().toISOString(), queries: [], note: "" };
try {
  const { brands, source } = await off.vnBrands();
  result.brandsSource = source;
  result.brandsCount = brands.length;
  const picked = [];
  for (const b of brands) {
    const n = normalizeText(b);
    if (n.replace(/[^a-z]/g, "").length < 4) continue;
    if (n.split(" ").some((w) => w.length >= 3 && truthText.includes(` ${w} `))) continue; // không dính đáp án
    if (!picked.includes(n)) picked.push(n);
    if (picked.length === 2) break;
  }
  for (const q of picked) {
    const row = { terms: q };
    const a = await off.cachedGet(searchUrl("searchpl", q, { vn: true }), "search");
    row.vnEnPrefix = { filter: "tagtype_0=countries&tag_contains_0=contains&tag_0=en:vietnam", count: a.data?.count ?? null, hits: parseHits("searchpl", a.data).length, top: parseHits("searchpl", a.data).slice(0, 3) };
    if (!row.vnEnPrefix.hits) {
      const alt = searchUrl("searchpl", q, { vn: false }) + "&tagtype_0=countries&tag_contains_0=contains&tag_0=vietnam";
      const b2 = await off.cachedGet(alt, "search");
      row.vnPlain = { filter: "tagtype_0=countries&tag_contains_0=contains&tag_0=vietnam", count: b2.data?.count ?? null, hits: parseHits("searchpl", b2.data).length, top: parseHits("searchpl", b2.data).slice(0, 3) };
    }
    result.queries.push(row);
    console.log(JSON.stringify(row));
  }
} catch (e) {
  result.error = String(e.message || e);
  console.log(result.error);
} finally {
  await bf.close();
}
result.off = off.stats;
fs.writeFileSync(out, JSON.stringify(result, null, 2), "utf8");
console.log(`Ghi ${out}`);
