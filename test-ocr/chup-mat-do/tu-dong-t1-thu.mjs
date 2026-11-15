// Đợt tu-dong (vòng 2, P2): thử từng luật tách chữ của T1 cho ca "7Up" (số dính chữ, từ ngắn), đo RIÊNG từng luật.
// Không gọi mạng, không sửa public/: đọc chữ OCR đã ghi (D:\tmp\tu-dong\ocr\) + danh mục hiện tại.
//
//   node test-ocr/chup-mat-do/tu-dong-t1-thu.mjs [--out D:\tmp\tu-dong\ket-qua\p2-t1-thu.json]
//
// Luật (đều dùng TỪ VỰNG CHỈ MỤC = các từ có idf trong chỉ mục BM25 dựng từ danh mục):
//   i   câu tìm: "7 up" → "7up" (số 1–2 chữ số + từ 1–3 chữ cái) CHỈ khi "7up" có trong từ vựng; từ sau là từ nhiễu
//       hoặc "in" thì không ghép;
//   ii  câu tìm: giữ dòng chỉ 2 chữ cái (vd "Up") nếu mọi từ không nhiễu của dòng có trong từ vựng;
//   iii chỉ mục: từ dạng số + chữ ("7up") lập thêm phần chữ ("up") nếu phần chữ không phải từ nhiễu.
// Mỗi luật chạy riêng, thêm vài tổ hợp (ii cần iii mới có ích cho ca "Up"). Bộ chữ: B (bo-b-30.json, mốc 14/21),
// A (bo-a-30.json, mốc 13/22); ca 7Up: chữ máy chủ ["Up", "Soda chanh", "Khong calo"] và câu gõ "Soda chanh diet 7 up";
// vị trí (tới 50) của 8934588022111 "7Up hương chanh" và 8934588023064 "7Up"; thêm danh mục THỬ có 8934588752117
// (D:\tmp\tu-dong\ket-qua\danh-muc-thu-7up.json, vòng 1) nếu có file.
// Luật giữ: không ảnh nào ở bộ B mất vị trí 1 hay rơi khỏi 5 so với mốc (bộ A chỉ báo số).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALL_CODES, saltItems } from "./nang-t1-do.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const t1 = await import(pathToFileURL(path.join(ROOT, "public", "chup-mat-do", "t1.mjs")).href);

export const CODE_7UP_DIET = "8934588752117";
export const CODES_7UP = ["8934588022111", "8934588023064"];
export const LINES_7UP = ["Up", "Soda chanh", "Khong calo"];
export const TYPED_7UP = "Soda chanh diet 7 up";

// ---- các luật thử (bản riêng của script, chạy trên hàm thuần của t1.mjs) ----

/** i: ghép "số + từ ngắn" khi từ ghép có trong từ vựng. */
export function mergeDigitWords(norm, vocab) {
  return ` ${norm} `.replace(/ (\d{1,2}) ([a-z]{1,3})(?= )/g, (m, d, w) => (
    t1.STOP_WORDS.has(w) || w === "in" || !vocab.has(`${d}${w}`) ? m : ` ${d}${w}`
  )).trim();
}

/** ii: dòng ngắn (2 chữ cái) dùng được khi mọi từ không nhiễu có trong từ vựng. */
function shortLineOk(line, vocab) {
  const letters = t1.normalizeText(line?.text).replace(/[^a-z]/g, "");
  if (letters.length < 2 || letters.length >= t1.MIN_LETTERS) return false;
  const c = Number(line?.conf);
  if (line?.conf != null && Number.isFinite(c) && c < t1.MIN_CONF) return false;
  const ws = t1.stripPhrases(t1.normalizeText(line.text)).split(" ").filter((w) => w && !t1.isNoiseWord(w));
  return ws.length > 0 && ws.every((w) => vocab.has(w));
}

export function queryFromLines(lines, vocab, rules) {
  const out = [];
  for (const l of lines || []) {
    if (!t1.usableLine(l) && !(rules.ii && shortLineOk(l, vocab))) continue;
    let norm = t1.normalizeText(l.text);
    if (rules.i) norm = mergeDigitWords(norm, vocab);
    for (const w of t1.stripPhrases(norm).split(" ")) if (w && !t1.isNoiseWord(w)) out.push(w);
  }
  return out;
}

/** iii: chữ tài liệu → thêm phần chữ của từ "số + chữ". */
export function indexText(text, rules) {
  if (!rules.iii) return text;
  const extra = [];
  for (const w of t1.normalizeText(text).split(" ")) {
    const m = /^\d+([a-z]+)$/.exec(w);
    if (m && !t1.isNoiseWord(w) && !t1.isNoiseWord(m[1])) extra.push(m[1]);
  }
  return extra.length ? `${text} ${extra.join(" ")}` : text;
}

export function buildIndex(products, rules) {
  return t1.buildBm25(products.map((p) => ({ code: p.code, text: indexText(p.text, rules) })));
}

function rankOf(hits, code) {
  const i = hits.findIndex((h) => h.code === code);
  return i < 0 ? null : i + 1;
}

export const VARIANTS = {
  moc: {},
  i: { i: true },
  ii: { ii: true },
  iii: { iii: true },
  "i+iii": { i: true, iii: true },
  "ii+iii": { ii: true, iii: true },
  "i+ii+iii": { i: true, ii: true, iii: true },
};

function runSet(bundle, index, rules) {
  const vocab = index.idf;
  const rows = {};
  for (const code of ALL_CODES) {
    const items = bundle.items?.[code]?.items;
    if (!items) { rows[code] = { rank: null, error: "thiếu chữ" }; continue; }
    const lines = t1.rowLineInfo(t1.ocrItems([{ items }]));
    const q = queryFromLines(lines, vocab, rules);
    const hits = q.length ? t1.bm25Search(index, q, 5) : [];
    rows[code] = { rank: rankOf(hits, code), query: q.join(" "), top5: hits.map((h) => h.code) };
  }
  const v = Object.values(rows);
  return { top1: v.filter((r) => r.rank === 1).length, top5: v.filter((r) => r.rank != null).length, rows };
}

function run7up(index, rules, extraCodes = []) {
  const vocab = index.idf;
  const cases = {
    may: t1.rowLineInfo(t1.ocrItems([{ items: saltItems(LINES_7UP, 0.95) }])),
    go: TYPED_7UP.split(/\r?\n/).map((s) => ({ text: s.trim(), conf: null })),
  };
  const out = {};
  for (const [k, lines] of Object.entries(cases)) {
    const q = queryFromLines(lines, vocab, rules);
    const hits = q.length ? t1.bm25Search(index, q, 50) : [];
    out[k] = { query: q.join(" "), top5: hits.slice(0, 5).map((h) => ({ code: h.code, score: +h.score.toFixed(2) })) };
    for (const c of [...CODES_7UP, ...extraCodes]) out[k][c] = rankOf(hits, c);
  }
  return out;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const outFile = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "D:\\tmp\\tu-dong\\ket-qua\\p2-t1-thu.json";
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "danh-muc-vn.json"), "utf8")).products;
  const thuFile = "D:\\tmp\\tu-dong\\ket-qua\\danh-muc-thu-7up.json";
  const thu = fs.existsSync(thuFile) ? JSON.parse(fs.readFileSync(thuFile, "utf8")) : null;
  const thuProducts = thu ? (Array.isArray(thu) ? thu : thu.products) : null;
  const sets = {
    B: JSON.parse(fs.readFileSync("D:\\tmp\\tu-dong\\ocr\\bo-b-30.json", "utf8")),
    A: JSON.parse(fs.readFileSync("D:\\tmp\\tu-dong\\ocr\\bo-a-30.json", "utf8")),
  };
  const result = {};
  let base = null;
  for (const [name, rules] of Object.entries(VARIANTS)) {
    const index = buildIndex(catalog, rules);
    const r = { rules, sets: {}, case7up: run7up(index, rules) };
    if (thuProducts) r.case7upThu = run7up(buildIndex(thuProducts, rules), rules, [CODE_7UP_DIET]);
    for (const [s, bundle] of Object.entries(sets)) r.sets[s] = runSet(bundle, index, rules);
    if (!base) base = r;
    for (const s of Object.keys(sets)) {
      const lost = [];
      const changed = [];
      for (const code of ALL_CODES) {
        const a = base.sets[s].rows[code].rank;
        const b = r.sets[s].rows[code].rank;
        if (a !== b) changed.push(`${code}: ${a ?? "-"}→${b ?? "-"}`);
        if ((a === 1 && b !== 1) || (a != null && b == null)) lost.push(code);
      }
      r.sets[s].lost = lost;
      r.sets[s].changed = changed;
    }
    r.keepOk = r.sets.B.lost.length === 0;
    result[name] = r;
    const c = r.case7up;
    const ct = r.case7upThu;
    console.log(`${name.padEnd(9)} B ${r.sets.B.top1}/${r.sets.B.top5} (mất ${r.sets.B.lost.length}; đổi ${r.sets.B.changed.join(", ") || "0"}) | A ${r.sets.A.top1}/${r.sets.A.top5} (mất ${r.sets.A.lost.join(",") || 0}; đổi ${r.sets.A.changed.join(", ") || "0"})`);
    console.log(`          7Up máy "${c.may.query}": 022111=${c.may["8934588022111"] ?? "-"} 023064=${c.may["8934588023064"] ?? "-"} | gõ "${c.go.query}": 022111=${c.go["8934588022111"] ?? "-"} 023064=${c.go["8934588023064"] ?? "-"}${ct ? ` | thử: máy 752117=${ct.may[CODE_7UP_DIET] ?? "-"} gõ 752117=${ct.go[CODE_7UP_DIET] ?? "-"}` : ""}`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), result }, null, 1), "utf8");
  console.log(`Ghi: ${outFile}`);
}
