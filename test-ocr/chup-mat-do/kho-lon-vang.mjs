// Đợt kho-lon vòng 2 (P3): sinh FILE VÀNG để bản Python server/catalog_search.py khớp T1 bản JS. Gọi ĐÚNG
// public/chup-mat-do/t1.mjs + src/front-rank.js (buildRankIndex / rankFromItems / rankFromText), không viết lại luật.
//
//   node --max-old-space-size=6144 test-ocr/chup-mat-do/kho-lon-vang.mjs [--danh-muc D:\tmp\kho-lon\danh-muc]
//        [--out D:\tmp\kho-lon\vang] [--chi-mini]
//
// Ra:
//   (i) TRONG repo: server/tests/fixtures/catalog-mini.jsonl.gz (dòng lấy từ danh mục mức (c), giữ thứ tự (c): 7Up 3 mã,
//       muối 8934673218368, 6 ca dựng, 30 mã ảnh, 20 gợi ý đầu trên mức (c) của mỗi câu vàng, + MINI_PER_GROUP dòng
//       mỗi nhóm theo seed cố định; ≤ 300 KB) + server/tests/fixtures/t1-golden.json (các câu: 7Up chữ máy chủ + câu gõ,
//       muối, 6 ca dựng, 30 ảnh bộ B, mẫu ca dò, câu tự dựng có dấu / đ / số / "7 up" / dòng 2 chữ cái / rỗng / khung lạ;
//       đáp án = query + 10 gợi ý { code, score, i } tính trên CHỈ MỤC CỦA CHÍNH danh mục mini).
//   (ii) NGOÀI repo: <out>\{a,b,c}.json: chữ 30 ảnh bộ A + B, 7Up (2), muối, 6 ca dựng, 70 ca dò, đáp án trên từng mức
//       thật (server/do_khop_t1.py so).
// Chạy lại ra trùng từng byte (không ghi giờ vào file trong repo; gzip level 9 không có giờ).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { loadApp, ROOT, SETS, CODE_7UP, LINES_7UP, TYPED_7UP } from "./tu-dong-do.mjs";
import { foreignCases, MO_RONG, LEMON_7UP, PLAIN_7UP } from "./tu-dong-v42-do.mjs";
import { ALL_CODES, SALT_LINES, SALT_CODE, saltItems } from "./nang-t1-do.mjs";
import { readLevel, pickProbes, mulberry32, LEVEL_NAMES } from "./kho-lon-do.mjs";

export const GOLD_K = 10;
export const MINI_SEED = 20261116;
export const MINI_PER_GROUP = 120;
export const MINI_TOP = 20;
export const MINI_MAX_BYTES = 300 * 1024;
export const MINI_GROUPS = Object.freeze(["vn", "893", "th", "jp", "my", "id", "kr", "cn", "us"]);

const box = (minX, minY, maxX, maxY) => [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];

/** Câu tự dựng (khung chữ hoặc chữ gõ) để thử các chỗ dễ lệch giữa JS và Python. */
export function craftedQueries() {
  const it = (text, poly, score = 0.9) => ({ text, poly, score });
  return [
    { id: "dung-dau-d", input: { text: "Sữa đặc Ông Thọ\nĐƯỜNG ĐEN Biên Hòa" } },
    { id: "dung-7-up-go", input: { text: "7 up chanh" } },
    { id: "dung-7up-lien", input: { text: "7Up Revive" } },
    { id: "dung-so-don-vi", input: { text: "Coca-Cola 330ml\nPEPSI 1.5L x 24" } },
    { id: "dung-cum-chung", input: { text: "Khối lượng tịnh 500g\nThành phần: muối, đường\nMì Hảo Hảo tôm chua cay" } },
    { id: "dung-rong-chu", input: { text: "" } },
    { id: "dung-chi-cach", input: { text: "  \n \t \n" } },
    { id: "dung-rong-khung", input: { items: [] } },
    { id: "dung-up-mot-dong", input: { items: [it("Up", box(10, 10, 60, 50), 0.95), it("Soda chanh", box(10, 70, 300, 110), 0.95)] } },
    { id: "dung-up-tin-thap", input: { items: [it("Up", box(10, 10, 60, 50), 0.4), it("Soda chanh", box(10, 70, 300, 110), 0.95)] } },
    { id: "dung-ab-khong-bi-danh", input: { items: [it("Ga", box(10, 10, 60, 50), 0.95), it("Mi tom", box(10, 70, 300, 110), 0.95)] } },
    // 2 khung cùng hàng đảo thứ tự, khung chữ trống, khung thiếu poly, score dạng chuỗi (không phải số -> bỏ)
    { id: "dung-khung-la", input: { items: [
      it("chanh", box(200, 12, 320, 48), 0.8), it("Soda", box(10, 10, 180, 50), 0.6), it("   ", box(10, 60, 100, 90)),
      { text: "Nestle", score: 0.9 }, { text: "Milo", poly: box(10, 100, 120, 140), score: "0.9" },
      it("\ufeffNESCAFÉ\u00a0Café sữa", box(10, 160, 400, 200), 0.85),
    ] } },
    { id: "dung-unicode", input: { text: "Straße İstanbul Ｃａｆé ñandú\u00a0Kẹo dẻo Ⅻ ½ 𝐌𝐢𝐥𝐨" } },
    { id: "dung-dong-chong", input: { items: [
      it("Bánh quy", box(10, 10, 200, 60), 0.9), it("bơ sữa", box(210, 30, 400, 80), 0.9), it("Danisa", box(10, 90, 200, 130), 0.3),
    ] } },
    { id: "dung-so-thuc", input: { items: [
      it("Trà xanh", box(10.25, 10.5, 200.75, 60.125), 0.91234567), it("không độ", box(205.5, 11.5, 380.25, 59.75), 0.87654321),
    ] } },
  ];
}

/** Kết quả T1 trên một chỉ mục: { query, hits: [{ code, score, i }] } (rankFromItems / rankFromText, k = GOLD_K). */
export function goldOf(t1, fr, rIndex, input, k = GOLD_K) {
  const r = input.items ? fr.rankFromItems(t1, rIndex, input.items, k) : fr.rankFromText(t1, rIndex, input.text, k);
  return { query: r.query, hits: r.hits.map((h) => ({ code: h.code, score: h.score, i: h.i })) };
}

/** Chọn dòng mini: tập mã bắt buộc + mẫu theo seed mỗi nhóm (xếp mã, xáo mulberry32(seed + chỉ số nhóm)); giữ thứ tự rows. */
export function pickMini(rows, mustCodes, { seed = MINI_SEED, perGroup = MINI_PER_GROUP, groups = MINI_GROUPS } = {}) {
  const want = new Set(mustCodes);
  groups.forEach((g, gi) => {
    const pool = rows.filter((r) => r.grp === g).map((r) => r.code).sort();
    const rnd = mulberry32(seed + gi);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const c of pool.slice(0, perGroup)) want.add(c);
  });
  return rows.filter((r) => want.has(r.code));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const dmDir = arg("--danh-muc", "D:\\tmp\\kho-lon\\danh-muc");
  const outDir = arg("--out", "D:\\tmp\\kho-lon\\vang");
  const onlyMini = argv.includes("--chi-mini");
  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const catalogCodes = new Set(catalog.products.map((p) => p.code));
  const foreign = foreignCases(JSON.parse(fs.readFileSync(MO_RONG, "utf8")), catalogCodes, app.os.strangeWords, rIndex.index.idf);
  const bundles = Object.fromEntries(["B", "A"].map((s) => [s, JSON.parse(fs.readFileSync(SETS[s].file, "utf8"))]));
  const lvC = readLevel(path.join(dmDir, "c.jsonl.gz"));
  const probes = pickProbes(lvC.rows, { tokens: t1.bm25Tokens });

  // ---- câu chung ----
  const base = [
    { id: "7up-may", input: { items: saltItems(LINES_7UP, 0.95) } },
    { id: "7up-go", input: { text: TYPED_7UP } },
    { id: "muoi", input: { items: saltItems(SALT_LINES, 0.9) } },
    ...foreign.map((f) => ({ id: `ngoai-${f.code}`, input: { items: saltItems(f.lines, 0.95) } })),
  ];
  const photo = (s) => ALL_CODES.filter((c) => bundles[s].items?.[c]?.items).map((c) => ({ id: `${s}-${c}`, input: { items: bundles[s].items[c].items } }));
  const probeQ = probes.map((p) => ({ id: `do-${p.grp}-${p.code}`, input: { items: saltItems(p.lines, 0.95) } }));

  // ---- (i) mini trong repo ----
  const miniQueries = [...base, ...photo("B"), ...probeQ.filter((_, i) => i % 7 === 0), ...craftedQueries()];
  const rIC = fr.buildRankIndex(t1, lvC.rows);
  const must = new Set([CODE_7UP, LEMON_7UP, PLAIN_7UP, SALT_CODE, ...foreign.map((f) => f.code), ...ALL_CODES]);
  for (const q of miniQueries) for (const h of goldOf(t1, fr, rIC, q.input, MINI_TOP).hits) must.add(h.code);
  const miniRows = pickMini(lvC.rows, must);
  const miniText = miniRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const miniGz = zlib.gzipSync(Buffer.from(miniText, "utf8"), { level: 9 });
  if (miniGz.length > MINI_MAX_BYTES) throw new Error(`catalog-mini quá lớn: ${miniGz.length} B > ${MINI_MAX_BYTES}`);
  const fixDir = path.join(ROOT, "server", "tests", "fixtures");
  fs.writeFileSync(path.join(fixDir, "catalog-mini.jsonl.gz"), miniGz);
  const rIM = fr.buildRankIndex(t1, miniRows);
  const golden = {
    meta: {
      gen: "test-ocr/chup-mat-do/kho-lon-vang.mjs", k: GOLD_K, catalog: "catalog-mini.jsonl.gz", n: miniRows.length,
      vocab: rIM.index.idf.size, avgdl: rIM.index.avgdl, nguon: "danh mục mức (c) đợt kho-lon (dữ liệu Open Food Facts, ODbL)",
    },
    queries: miniQueries.map((q) => ({ id: q.id, ...q.input, ...goldOf(t1, fr, rIM, q.input) })),
  };
  fs.writeFileSync(path.join(fixDir, "t1-golden.json"), JSON.stringify(golden, null, 1) + "\n", "utf8");
  console.log(`mini: ${miniRows.length} dòng, gzip ${miniGz.length} B; vàng ${golden.queries.length} câu (có gợi ý: ${golden.queries.filter((q) => q.hits.length).length})`);

  // ---- (ii) ngoài repo: từng mức thật ----
  if (!onlyMini) {
    fs.mkdirSync(outDir, { recursive: true });
    const outQueries = [...photo("B"), ...photo("A"), ...base, ...probeQ];
    for (const L of LEVEL_NAMES) {
      const lv = L === "c" ? lvC : readLevel(path.join(dmDir, `${L}.jsonl.gz`));
      const rI = L === "c" ? rIC : fr.buildRankIndex(t1, lv.rows);
      const doc = {
        meta: { gen: "test-ocr/chup-mat-do/kho-lon-vang.mjs", k: GOLD_K, level: L, catalog: path.join(dmDir, `${L}.jsonl.gz`), n: lv.rows.length, at: new Date().toISOString() },
        queries: outQueries.map((q) => ({ id: q.id, ...q.input, ...goldOf(t1, fr, rI, q.input) })),
      };
      const f = path.join(outDir, `${L}.json`);
      fs.writeFileSync(f, JSON.stringify(doc), "utf8");
      console.log(`mức ${L}: ${doc.queries.length} câu -> ${f}`);
    }
  }
}
