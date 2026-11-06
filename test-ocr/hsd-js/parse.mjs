// Hàm thuần để rút hạn sử dụng (HSD) từ chữ OCR và đọc đáp án trong truth.csv.
// Không import tesseract.js / jimp, để test bằng node:test chạy nhanh.
// Ngày trả về dạng 'YYYY-MM-DD' (chuỗi rỗng khi không rút được).

export const YEAR_MIN = 2000;
export const YEAR_MAX = 2100;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Ngày có thật trên lịch không: dựng Date UTC rồi so lại ngày / tháng / năm
// (30/02 thành 02/03 nên bị loại; 29/02 chỉ có ở năm nhuận).
export function isRealDate(d, m, y) {
  if (![d, m, y].every(Number.isInteger)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC đổi năm 0–99 thành 1900–1999, nên đặt lại năm cho chắc
  t.setUTCFullYear(y);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Đổi (ngày, tháng, năm dạng chữ số) thành 'YYYY-MM-DD'; năm 2 số thành 20yy;
// năm ngoài 2000–2100 hoặc ngày không có thật thì trả ''.
function toIso(dStr, mVal, yStr) {
  const d = Number(dStr);
  const m = typeof mVal === 'number' ? mVal : Number(mVal);
  let y = Number(yStr);
  if (String(yStr).length === 2) y = 2000 + y;
  if (y < YEAR_MIN || y > YEAR_MAX) return '';
  if (!isRealDate(d, m, y)) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function monthFromName(name) {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return i === -1 ? NaN : i + 1;
}

// Bỏ dấu tiếng Việt (để nhận nhãn khi OCR mất dấu hoặc có dấu)
function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// Mẫu ngày. Mỗi mẫu có (?<!\d) / (?!\d) để không cắt giữa một dãy số dài hơn.
const SEP = String.raw`\s*[\/.\-]\s*`;
// dd/mm/yy(yy), dd.mm.yy(yy), dd-mm-yy(yy), cho phép khoảng trắng quanh dấu
const RE_SEP = new RegExp(String.raw`(?<!\d)(\d{1,2})${SEP}(\d{1,2})${SEP}(\d{4}|\d{2})(?!\d)`, 'g');
// tháng viết tắt tiếng Anh: "05 / Oct / 2021", "05 Oct 2021", "05-Oct-21"
const RE_MON = new RegExp(
  String.raw`(?<!\d)(\d{1,2})\s*[\/.\-]?\s*(${MONTHS.join('|')})[a-z]*\.?\s*[\/.\-]?\s*(\d{4}|\d{2})(?!\d)`,
  'gi',
);
// 6 số liền ddmmyy
const RE_SIX = /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g;

// Nhãn đứng NGAY trước ngày (chỉ cách bằng khoảng trắng, ':', '.', '/', '-', ngoặc).
// Xét trên chữ đã bỏ dấu, không phân biệt hoa thường.
const GAP = String.raw`[\s:.\/\-()]*$`;
const RE_LABEL_HSD = new RegExp(String.raw`(?:\bhsd|\bexp|han su dung|\bbb|best before)${GAP}`, 'i');
const RE_LABEL_NSX = new RegExp(String.raw`(?:\bnsx|\bmfg|\bmfd|ngay san xuat|ngay sx)${GAP}`, 'i');

// Tìm mọi ứng viên ngày trong text, mỗi ứng viên có vị trí, kiểu và ngày (đã kiểm lịch, '' nếu không hợp lệ)
function findCandidates(text) {
  const out = [];
  for (const m of text.matchAll(RE_SEP)) out.push({ index: m.index, kind: 'sep', iso: toIso(m[1], m[2], m[3]) });
  for (const m of text.matchAll(RE_MON)) out.push({ index: m.index, kind: 'sep', iso: toIso(m[1], monthFromName(m[2]), m[3]) });
  for (const m of text.matchAll(RE_SIX)) out.push({ index: m.index, kind: 'six', iso: toIso(m[1], m[2], m[3]) });
  for (const c of out) {
    const before = stripAccents(text.slice(Math.max(0, c.index - 40), c.index));
    c.label = RE_LABEL_HSD.test(before) ? 'hsd' : RE_LABEL_NSX.test(before) ? 'nsx' : '';
  }
  return out;
}

// Rút HSD từ chữ OCR. Luật đặt trước, theo thứ tự ưu tiên:
//   1) ngày ngay sau nhãn HSD / EXP / Hạn sử dụng / BB / Best before;
//   2) ngày có dấu (/ . -) hoặc tháng viết tắt tiếng Anh;
//   3) 6 số liền ddmmyy.
// Ngày ngay sau nhãn NSX / MFG / MFD / Ngày sản xuất / Ngày SX thì bỏ.
// Ngày không có thật trên lịch hoặc năm ngoài 2000–2100 thì bỏ, xét ứng viên kế tiếp.
// Cùng mức có nhiều ngày hợp lệ thì lấy ngày MUỘN nhất (HSD luôn sau NSX).
export function parseExpiry(text) {
  if (typeof text !== 'string' || !text) return '';
  const cands = findCandidates(text).filter((c) => c.iso && c.label !== 'nsx');
  const levels = [
    cands.filter((c) => c.label === 'hsd'),
    cands.filter((c) => c.label === '' && c.kind === 'sep'),
    cands.filter((c) => c.label === '' && c.kind === 'six'),
  ];
  for (const level of levels) {
    if (level.length) return level.map((c) => c.iso).sort().at(-1);
  }
  return '';
}

// Đọc ô han_su_dung của truth.csv: 'ddmmyy', 'dd.mm.yy' (hoặc / -), 'dd / Mon / yyyy'.
// Cả ô phải khớp đúng một dạng; không khớp thì trả ''.
export function parseTruth(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  let m = t.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return toIso(m[1], m[2], m[3]);
  m = t.match(new RegExp(String.raw`^(\d{1,2})${SEP}(\d{1,2})${SEP}(\d{4}|\d{2})$`));
  if (m) return toIso(m[1], m[2], m[3]);
  m = t.match(new RegExp(String.raw`^(\d{1,2})\s*[\/.\-]?\s*(${MONTHS.join('|')})[a-z]*\.?\s*[\/.\-]?\s*(\d{4}|\d{2})$`, 'i'));
  if (m) return toIso(m[1], monthFromName(m[2]), m[3]);
  return '';
}
