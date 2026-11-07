// Bản JavaScript của extract_regex trong test-ocr/run_extract.py (luật regex rút 11 ô từ chữ OCR).
// Dùng cho trang thử public/ocr-thu.html. BẢN PYTHON LÀ CHUẨN: sửa luật thì sửa run_extract.py trước rồi chép
// sang đây, chạy test-ocr/web-ocr/regex-parity.mjs (so với outputs/extract/<ocr>__regex) phải khớp 100%.
//
// Các mẫu regex giữ NGUYÊN VĂN chuỗi của Python (String.raw), rồi pyRegex() đổi cú pháp Python sang JavaScript,
// vì regex JS khác Python ở vài chỗ dù viết giống nhau:
//   - \d, \w, \b, \s của JS chỉ hiểu chữ / số ASCII (kể cả có cờ u); Python hiểu cả Unicode (vd "²", "ø", "٣").
//   - "." của JS không khớp \r, \u2028, \u2029; Python chỉ không khớp \n.
//   - "$" (chế độ nhiều dòng) của JS dừng ở cả \r; Python chỉ ở \n. Nhóm có tên (?P<x>) của Python là (?<x>) ở JS.
// Cần trình duyệt có lookbehind (?<=…) và \p{…}: Safari 16.4+, Chrome 62+.

const W = String.raw`\p{L}\p{N}_`; // \w của Python với chuỗi str: chữ, số (Unicode) và "_"
const S = String.raw`\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`; // \s, str.isspace()
const WB = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`; // \b của Python

/** Đổi một mẫu regex viết theo cú pháp Python (module re, chuỗi str) sang RegExp JavaScript cùng nghĩa.
 *  Chỉ hỗ trợ phần cú pháp run_extract.py dùng; gặp chỗ không hỗ trợ thì báo lỗi ngay (không đoán).
 *  flags: "i" (re.I), "m" (re.M), "g" (tìm mọi chỗ, như re.sub / re.findall). */
export function pyRegex(src, flags = "") {
  let out = "";
  let inClass = false;
  let classStart = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const n = src[++i];
      if (n === undefined) throw new Error("pyRegex: \\ ở cuối mẫu");
      if (n === "d") out += String.raw`\p{Nd}`;
      else if (n === "D") out += inClass ? bad("\\D trong []") : String.raw`\P{Nd}`;
      else if (n === "w") out += inClass ? W : `[${W}]`;
      else if (n === "W") out += inClass ? bad("\\W trong []") : `[^${W}]`;
      else if (n === "s") out += inClass ? S : `[${S}]`;
      else if (n === "S") out += inClass ? bad("\\S trong []") : `[^${S}]`;
      else if (n === "b") out += inClass ? bad("\\b trong []") : WB;
      else if (n === "-") out += inClass ? "\\-" : "-";
      else if (/[A-Za-z0-9]/.test(n) && !"ntrfv".includes(n)) bad(`\\${n}`);
      else out += "\\" + n;
      continue;
    }
    if (inClass) {
      if (c === "]" && (i === classStart + 1 || (i === classStart + 2 && src[classStart + 1] === "^"))) bad("] đứng đầu []");
      if (c === "]") inClass = false;
      else if (c === "[") bad("[ lồng trong []");
      out += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      classStart = i;
      out += c;
    } else if (c === ".") {
      out += String.raw`[^\n]`; // Python: mọi ký tự trừ \n
    } else if (c === "$") {
      // Python: re.M -> trước \n hoặc cuối chuỗi; không re.M -> cuối chuỗi hoặc trước \n cuối cùng
      out += flags.includes("m") ? String.raw`(?=\n|(?![\s\S]))` : String.raw`(?=\n?(?![\s\S]))`;
    } else if (c === "^") {
      bad("^ ngoài []");
    } else if (c === "(" && src.startsWith("(?P<", i)) {
      out += "(?<";
      i += 3;
    } else if (c === "(" && src.startsWith("(?P=", i)) {
      bad("(?P=");
    } else {
      out += c;
    }
  }
  if (inClass) bad("thiếu ]");
  return new RegExp(out, "u" + (flags.includes("i") ? "i" : "") + (flags.includes("g") ? "g" : ""));

  function bad(what) {
    throw new Error(`pyRegex: chưa hỗ trợ ${what} trong mẫu ${src}`);
  }
}

// ---------- tiện ích giống chuỗi Python ----------
const SPACE = new RegExp(`[${S}]`, "u");

/** str.strip() (không đối số: bỏ khoảng trắng Unicode như Python) hoặc str.strip(chars). */
export function pyStrip(s, chars) {
  const arr = Array.from(s);
  const drop = chars === undefined ? (ch) => SPACE.test(ch) : (ch) => chars.includes(ch);
  let a = 0;
  let b = arr.length;
  while (a < b && drop(arr[a])) a++;
  while (b > a && drop(arr[b - 1])) b--;
  return arr.slice(a, b).join("");
}

/** str.splitlines() của Python (ngắt ở \n, \r\n, \r, \v, \f, \x1c-\x1e, \x85, \u2028, \u2029). */
export function pySplitlines(s) {
  if (s === "") return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/u);
  if (/(?:\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029])$/u.test(s)) parts.pop();
  return parts;
}

/** Độ dài theo ký tự (code point) như len() của Python. */
const pyLen = (s) => Array.from(s).length;

/** Giá trị của 1 chữ số Unicode (loại Nd): các khối chữ số luôn là dãy 10 ký tự liền nhau từ 0 đến 9. */
function digitValue(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 48 && cp <= 57) return cp - 48;
  const isNd = (x) => /\p{Nd}/u.test(String.fromCodePoint(x));
  let start = cp;
  while (start > 0 && isNd(start - 1)) start--;
  return (cp - start) % 10;
}

/** Đổi mọi chữ số Unicode sang 0-9 (Python int() / float() nhận cả chữ số Unicode). */
const asciiDigits = (s) => s.replace(/\p{Nd}/gu, (d) => String(digitValue(d)));

/** strip_accents của Python: bỏ dấu tiếng Việt ("Thành phần" -> "Thanh phan"), đ -> d. */
export function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/\p{Mn}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

// ---------- luật: chép từ run_extract.py, giữ nguyên chuỗi mẫu ----------
export const FIELDS = ["ten", "thuong_hieu", "khoi_luong", "thanh_phan_dau", "nang_luong_kcal", "dam_g",
  "beo_g", "carb_g", "nha_san_xuat", "bao_quan", "han_su_dung"];

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const DATE = String.raw`(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{2,4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{4})`;

const cache = new Map();
/** pyRegex có nhớ (mẫu ghép từ nhãn được dùng lại nhiều lần). */
function rx(src, flags = "") {
  const key = flags + "\u0000" + src;
  if (!cache.has(key)) cache.set(key, pyRegex(src, flags));
  return cache.get(key);
}

/** re.search(pattern, t, re.I) -> group(n).strip(), không thấy -> "". */
function grab(pattern, t, group = 1) {
  const m = rx(pattern, "i").exec(t);
  return m ? pyStrip(m[group]) : "";
}

function findDate(t) {
  let d = grab(String.raw`(?:hsd|han su dung|han dung|exp(?:iry)?|best before|use by)\s*[:.\-]?\s*[^\d\n]{0,12}` + DATE, t);
  if (d) return d;
  d = grab(String.raw`(?:\bhsd|\bexp)[^\d]{0,12}(\d{6})(?!\d)`, t);
  if (d) {
    const ds = Array.from(asciiDigits(d));
    const dd = Number(ds.slice(0, 2).join(""));
    const mm = Number(ds.slice(2, 4).join(""));
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return d;
  }
  const all = [...t.matchAll(rx(DATE, "g"))].map((m) => m[1]);
  return all.length ? all[all.length - 1] : "";
}

function firstNumberAfter(labels, t, unit = String.raw`g\b`) {
  for (const lb of labels) {
    const v = grab("(?:" + lb + String.raw`)[^\d\n]{0,30}` + NUM + String.raw`\s*` + unit, t);
    if (v) return v;
  }
  return "";
}

const LB_NANG_LUONG = String.raw`nang ?[li1][uv][a-z]?ng`;
const LB_CALORIES = String.raw`[cg]alo[a-z]*(?![a-z])(?!\s*fr)`;
const ENERGY_LABELS = [LB_NANG_LUONG, "energy", LB_CALORIES];
const REF_INTAKE = String.raw`nhu ?cau ?` + LB_NANG_LUONG + String.raw`[^\d\n]{0,5}\d[\d .,]*k?cal`;
const NOT_GRAM = String.raw`(?![.,]?\d)(?!\s*(?:mg|mcg|ug|kcal|kj|ml|%))`;
const NOT_KCAL = String.raw`(?![.,]?\d)(?!\s*(?:mg|mcg|ug|kj|ml|%|g\b))`;

function looseNumberAfter(labels, t, notUnit) {
  for (const lb of labels) {
    const v = grab("(?:" + lb + String.raw`)[^\d\n%]{0,30}` + NUM + notUnit, t);
    if (v) return v;
  }
  return "";
}

/** re.fullmatch(pattern, s): cả chuỗi phải khớp. */
function fullmatch(pattern, s) {
  const key = "full\u0000" + pattern;
  if (!cache.has(key)) cache.set(key, new RegExp("^(?:" + pyRegex(pattern).source + ")$", "u"));
  return cache.get(key).test(s);
}

function unglueG(v) {
  return fullmatch(String.raw`\d+[.,]\d+9`, v) ? v.slice(0, -1) : v;
}

const GRAM_MAX = 100;
function gramMax(v) {
  const f = Number(asciiDigits(v).replaceAll(",", "."));
  if (v === "" || Number.isNaN(f)) return v; // float("") lỗi ValueError -> giữ nguyên
  return f > GRAM_MAX ? "" : v;
}

const LB_VI_HEAD = String.raw`(?:chat ?[bh][a-z]{0,2} ?(?:khong ?)?)?`;
const LB_VI_HEAD_STRICT = String.raw`chat ?[bh][a-z]{0,2} ?(?:khong ?)?`;
const LB_VI_TAIL = String.raw` ?h[a-z]{1,2}(?:l|(?![a-z]))`;
const LB_SAT_VI_END = String.raw`bao` + LB_VI_TAIL + String.raw`(?:\W{0,3}s[a-z]{2,12}\W{0,3}fats?(?![a-z]))?`;
const LB_TRANS_VI_END = String.raw`chuyen` + LB_VI_TAIL + String.raw`(?:\W{0,3}trans\W{0,3}fats?(?![a-z]))?`;
const LB_SAT_VI = LB_VI_HEAD + LB_SAT_VI_END;
const LB_TRANS_VI = LB_VI_HEAD + LB_TRANS_VI_END;
const LB_SAT_EN = String.raw`(?<![a-z])(?:un)?sat(?:[a-z]*|[a-z]{3,}\W{0,3}\d+)\W{0,3}fats?(?![a-z])`;
const LB_TRANS_EN = String.raw`(?<![a-z])trans\W{0,3}(?:\d+\W{0,3})?fats?(?![a-z])`;
const LB_SAT = "(?:" + LB_SAT_VI + "|" + LB_SAT_EN + ")";
const LB_TRANS = "(?:" + LB_TRANS_VI + "|" + LB_TRANS_EN + ")";
const LB_SAT_ANY = "(?:" + LB_SAT + "|" + LB_TRANS + ")";
const LB_SAT_ANY_STRICT = ("(?:" + LB_VI_HEAD_STRICT + "(?:" + LB_SAT_VI_END + "|" + LB_TRANS_VI_END + ")|"
  + LB_SAT_EN + "|" + LB_TRANS_EN + ")");
const LB_TOTAL = String.raw`(?<![a-z])(?:total ?fat(?![a-z])|tong ?chat ?beo|chat ?[bh][a-z]{0,2}|fat(?![a-z])|lipid(?![a-z]))`;
const UNIT_PAREN = String.raw`\([ \t]*m?g[ \t]*\)`;
const NEAR = String.raw`(?:[^\da-z\n]|` + UNIT_PAREN + String.raw`){0,8}`;
const COLUMN_NUMBERS = (String.raw`(?=(?:[^\da-z\n]|` + UNIT_PAREN + String.raw`)*\d+(?:[.,]\d+)?[ \t]*(?:mg|g|9)?[ \t|]+\d`
  + String.raw`(?![\d.,]*[ \t]*%))`);
const TOTAL_COLUMN = ("(?P<keep>" + LB_TOTAL + ")" + NEAR + LB_SAT_ANY_STRICT + "(?:" + NEAR + LB_SAT_ANY + ")*"
  + COLUMN_NUMBERS);
const SAT_COLUMN = "(?:" + LB_SAT + NEAR + LB_TRANS + "|" + LB_TRANS + NEAR + LB_SAT + ")(?:" + NEAR + LB_SAT_ANY + ")*";
const SAT_GAP = String.raw`[^\da-z\n]{0,12}(?:less ?than[^\da-z\n]{0,12})?`;
const SAT_FAT = TOTAL_COLUMN + "|" + SAT_COLUMN + "|" + LB_SAT_ANY + "(?:" + SAT_GAP + NUM + String.raw`[ \t]*(?:mg|g|9)?)?`;
const FROM_FAT = String.raw`from\s+fat`;

/** fat_text của Python: bỏ cụm béo bão hòa / chuyển hóa (kèm số) và "from fat"; bảng theo cột giữ nhãn béo tổng. */
export function fatText(t) {
  const noSat = t.replace(rx(SAT_FAT, "g"), (...a) => ((a[a.length - 1] && a[a.length - 1].keep) || "") + " ");
  return noSat.replace(rx(FROM_FAT, "g"), " ");
}

const LEADING_ZERO = String.raw`0\d+`;

function gramAfter(strictLabels, looseLabels, t) {
  let v = firstNumberAfter(strictLabels, t);
  if (!v) {
    v = unglueG(looseNumberAfter(looseLabels, t, NOT_GRAM));
    if (fullmatch(LEADING_ZERO, v)) v = "";
  }
  return gramMax(v);
}

const LB_KHOI_LUONG = String.raw`kh[a-z']{1,2} ?[li1]u[a-z]{0,2}ng ?t[a-z]nh|the tich thuc|net ?w(?:eigh)?t`;

function netWeight(t) {
  const m = rx("(?:" + LB_KHOI_LUONG + String.raw`)[^\d\n]{0,15}` + NUM + String.raw`(\s?)(g|gr|gam|ml|kg|l)\b`).exec(t);
  return m ? m[1] + m[2] + m[3] : "";
}

function splitIngredients(s, k = 3) {
  const parts = s.replace(rx(String.raw`\([^)]*\)`, "g"), "").split(rx("[,;]", "g"));
  return parts.filter((p) => pyLen(pyStrip(p)) >= 2).map((p) => pyStrip(p, " .:")).slice(0, k);
}

/** extract_regex(text) của run_extract.py: trả object 11 ô (thanh_phan_dau là mảng tối đa 3 chuỗi). */
export function extractRegex(text) {
  const t = stripAccents(text).toLowerCase();
  const lines = pySplitlines(t).map((l) => pyStrip(l)).filter((l) => l);
  const out = Object.fromEntries(FIELDS.map((f) => [f, ""]));
  out.ten = lines.slice(0, 10).find((l) => l.replace(/[^a-z]/gu, "").length >= 4 && !rx(String.raw`\d{3,}`).test(l)) ?? "";
  out.khoi_luong = netWeight(t);
  for (const l of lines.slice(0, 15)) {
    if (out.khoi_luong) break;
    const m = rx(String.raw`\b` + NUM + String.raw`\s?(g|gr|gam|ml|kg|l)\b`).exec(l);
    if (m) {
      out.khoi_luong = m[0];
      break;
    }
  }
  const m = rx(String.raw`thanh phan[^:\n]{0,20}[:\s]+(.{5,500}?)(?:\n\s*\n|\.\s|$)`, "im").exec(t);
  const tp = m ? pyStrip(m[1]) : "";
  out.thanh_phan_dau = splitIngredients(tp);
  const te = t.replace(rx(REF_INTAKE, "g"), " ");
  out.nang_luong_kcal = firstNumberAfter(["nang luong", "energy", "calo"], te, "k?cal")
    || grab(NUM + String.raw`\s*kcal`, te) || looseNumberAfter(ENERGY_LABELS, te, NOT_KCAL);
  out.dam_g = gramAfter(["chat dam", "dam", "protein"], ["chat dam", "protein"], t);
  out.beo_g = gramAfter(["chat beo", "beo", "fat", "lipid"], ["chat beo", "fat", "lipid"], fatText(t));
  out.carb_g = gramAfter([String.raw`carbohydrat\w*`, "carb", "hydrat cacbon", "duong bot", "tinh bot", "glucid"],
    [String.raw`carbohydrat\w*`, "hydrat cacbon", "glucid"], t);
  out.nha_san_xuat = grab(String.raw`(?:san xuat boi|nha san xuat|san xuat tai|manufactured by)\s*[:\-]?\s*([^\n]{5,120})`, t)
    || (lines.find((l) => rx(String.raw`\bcong ty\b|\btnhh\b|\bco phan\b`).test(l)) ?? "");
  out.bao_quan = grab(String.raw`(?:huong dan bao quan|cach bao quan|bao quan)\s*[:\-]?\s*([^\n]{5,120})`, t);
  out.han_su_dung = findDate(t);
  return out;
}
