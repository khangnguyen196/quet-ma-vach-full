// Đo đọc hạn sử dụng (HSD) bằng tesseract.js trên ảnh cắt sẵn (thí nghiệm, CHƯA đưa vào app).
// Chạy với thư mục hiện tại là test-ocr (thư mục có photos/, truth.csv, outputs/), sau khi chạy crop.mjs:
//   node <đường dẫn>/hsd-js/hsd.mjs [--photos photos] [--truth truth.csv] [--out outputs/hsd-js]
//                                   [--crops <hsd-js>/crops.csv] [--cache D:\cache\tesseract-js]
// So 2 cách:
//   (a) đọc thẳng: ảnh cắt nguyên, lang vie+eng, PSM mặc định, không whitelist;
//   (b) xám + normalize + contrast, phóng 3 lần (2 lần nếu cạnh dài sau khi phóng 3 lần > 3000 px),
//       lang eng, PSM 7 (một dòng), chỉ nhận 0123456789/.-
// Cả 2 cách rút ngày bằng cùng một hàm parseExpiry (parse.mjs). truth.csv chỉ đọc.
// Ghi outputs/hsd-js/results.csv và summary.md (không commit).
import { createWorker, PSM } from 'tesseract.js';
import { Jimp } from 'jimp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExpiry, parseTruth } from './parse.mjs';
import { parseArgs, readCrops, cropPath } from './crop.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const B_CONTRAST = 0.3; // mức tăng tương phản của cách (b), đặt trước khi chạy, không chỉnh theo kết quả
const B_MAX_SIDE = 3000;

// Đọc truth.csv (có thể có ô trong ngoặc kép chứa dấu phẩy); chỉ lấy code + han_su_dung
function readTruth(file) {
  const rows = [];
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let field = '';
  let row = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  const header = rows.shift();
  const iCode = header.indexOf('code');
  const iHsd = header.indexOf('han_su_dung');
  const map = new Map();
  for (const r of rows) if (r[iHsd]?.trim()) map.set(r[iCode], r[iHsd].trim());
  return map;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pkgVersion(name) {
  return require(`${name}/package.json`).version;
}

async function prepareB(file) {
  const img = await Jimp.read(file);
  const long = Math.max(img.width, img.height);
  const factor = long * 3 > B_MAX_SIDE ? 2 : 3;
  img.greyscale().normalize().contrast(B_CONTRAST);
  img.resize({ w: img.width * factor, h: img.height * factor });
  return { buf: await img.getBuffer('image/png'), factor };
}

const METHODS = [
  {
    id: 'a',
    name: '(a) đọc thẳng: vie+eng, PSM mặc định, không whitelist',
    langs: ['vie', 'eng'],
    params: {},
    prepare: async (file) => ({ buf: await readFile(file), factor: 1 }),
  },
  {
    id: 'b',
    name: `(b) xám + normalize + contrast ${B_CONTRAST}, phóng 3 lần (2 lần nếu > ${B_MAX_SIDE} px), eng, PSM 7, chỉ 0123456789/.-`,
    langs: ['eng'],
    params: { tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789/.-' },
    prepare: prepareB,
  },
];

// Lý do sai (tự động, thô); chi tiết hơn ghi tay trong README / PLAN sau khi xem text
function reason(row, ghiChu) {
  if (row.khung === null) return 'không tìm thấy vùng HSD (không có khung cắt)';
  const t = row.text.trim();
  const hint = /in dọc/.test(ghiChu ?? '') ? '; chữ in dọc, ảnh cắt không xoay' : '';
  if (!t) return 'không ra chữ' + hint;
  const runs = t.match(/\d+/g) ?? [];
  if (!runs.length) return 'không ra chữ số (chỉ ra chữ / ký hiệu rác)' + hint;
  if (row.ngay) return `rút được ${row.ngay} khác đáp án (đọc sai số hoặc lấy nhầm ngày khác)` + hint;
  if (row.cach === 'b' && /[a-z]/i.test(row.dap_an_goc)) return `tháng in bằng chữ, whitelist (b) bỏ mất chữ (ra "${t}")` + hint;
  const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
  if (longest.length >= 6) return `đọc sai số: có dãy "${longest}" nhưng không thành ngày hợp lệ` + hint;
  const n = runs.join('').length;
  return `chỉ ra ${n} chữ số rời rạc, không thành ngày (đọc sai / mất số)` + hint;
}

function fmtMs(n) {
  return Math.round(n).toLocaleString('vi-VN');
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    photos: 'photos',
    truth: 'truth.csv',
    out: path.join('outputs', 'hsd-js'),
    crops: path.join(HERE, 'crops.csv'),
    cache: 'D:\\cache\\tesseract-js',
  });
  const truth = readTruth(args.truth);
  const crops = await readCrops(args.crops);
  const byCode = new Map(crops.map((c) => [c.code, c]));
  const codes = [...truth.keys()];
  await mkdir(args.out, { recursive: true });
  await mkdir(args.cache, { recursive: true });

  const results = [];
  const workerMs = {};
  for (const m of METHODS) {
    const t0 = performance.now();
    const worker = await createWorker(m.langs, 1, { cachePath: args.cache });
    if (Object.keys(m.params).length) await worker.setParameters(m.params);
    workerMs[m.id] = performance.now() - t0;
    console.log(`${m.name}: tạo worker ${fmtMs(workerMs[m.id])} ms`);
    try {
      for (const code of codes) {
        const dap_an = parseTruth(truth.get(code));
        const c = byCode.get(code);
        const file = cropPath(args.photos, code);
        const row = { code, cach: m.id, text: '', ngay: '', dap_an, dap_an_goc: truth.get(code), ms: '', khung: c?.box ?? null };
        if (c?.box && existsSync(file)) {
          const t1 = performance.now();
          const { buf } = await m.prepare(file);
          const { data } = await worker.recognize(buf);
          row.ms = performance.now() - t1;
          row.text = data.text ?? '';
          row.ngay = parseExpiry(row.text);
        } else if (c?.box) {
          throw new Error(`${code}: chưa có ${file}, chạy crop.mjs trước`);
        }
        row.dung = Boolean(row.ngay) && row.ngay === dap_an;
        results.push(row);
        console.log(`  ${code} ${m.id}: ${JSON.stringify(row.text.trim())} → ${row.ngay || '(rỗng)'} | đáp án ${dap_an} | ${row.dung ? 'ĐÚNG' : 'sai'} | ${row.ms === '' ? '-' : fmtMs(row.ms)} ms`);
      }
    } finally {
      await worker.terminate();
    }
  }

  // results.csv
  const head = 'code,cach,text_ocr_tho,ngay_rut,dap_an,dung,ms';
  const lines = results.map((r) =>
    [r.code, r.cach, r.text.replace(/\r?\n/g, ' | ').trim(), r.ngay, r.dap_an_goc, r.dung ? 1 : 0, r.ms === '' ? '' : Math.round(r.ms)]
      .map(csvCell)
      .join(','),
  );
  await writeFile(path.join(args.out, 'results.csv'), '\uFEFF' + [head, ...lines].join('\n') + '\n', 'utf8');

  // summary.md
  const cpu = os.cpus();
  const md = [];
  md.push('# Đo đọc HSD bằng tesseract.js', '');
  md.push(`- Ngày chạy: ${new Date().toISOString()}`);
  md.push(`- Máy đo: ${cpu[0]?.model?.trim()} (${cpu.length} luồng), RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} GB, ${os.type()} ${os.release()}`);
  md.push(`- Node ${process.version}, tesseract.js ${pkgVersion('tesseract.js')}, tesseract.js-core ${pkgVersion('tesseract.js-core')}, jimp ${pkgVersion('jimp')}`);
  md.push(`- Dữ liệu ngôn ngữ: ${args.cache} (tải từ CDN mặc định của tesseract.js lần đầu, sau đó đọc cache)`);
  md.push(`- ${codes.length} ô han_su_dung trong truth.csv; ảnh cắt theo crops.csv (photos/<mã>/hsd/crop.jpg)`);
  md.push('- Điện thoại sẽ chậm hơn máy này (CPU yếu hơn, tesseract.js chạy WebAssembly trong trình duyệt); số ms chỉ để so 2 cách với nhau.');
  md.push('- (b) chỉ nhận chữ số và / . -, nên không đọc được nhãn chữ (HSD, EXP…) và tháng bằng chữ: ô "05 / Oct / 2021" gần như chắc trượt ở (b).', '');
  md.push('| Cách | Đúng | Tạo worker (ms) | ms / ảnh TB | ms / ảnh lớn nhất |');
  md.push('|---|---|---|---|---|');
  for (const m of METHODS) {
    const rs = results.filter((r) => r.cach === m.id);
    const ms = rs.map((r) => r.ms).filter((v) => v !== '');
    const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
    const max = ms.length ? Math.max(...ms) : 0;
    md.push(`| ${m.name} | ${rs.filter((r) => r.dung).length}/${codes.length} | ${fmtMs(workerMs[m.id])} | ${fmtMs(avg)} | ${fmtMs(max)} |`);
  }
  md.push('', 'ms / ảnh = tiền xử lý (đọc file; (b) thêm xám, tương phản, phóng, mã hóa PNG) + recognize. Tạo worker tính 1 lần mỗi cách.', '');
  md.push('## Từng ô', '');
  md.push('| Mã | Cách | Text OCR thô | Ngày rút | Đáp án | Đúng | ms |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const t = r.text.replace(/\r?\n/g, ' ⏎ ').replace(/\|/g, '\\|').trim();
    md.push(`| ${r.code} | ${r.cach} | ${t.length > 60 ? t.slice(0, 60) + '…' : t || '(rỗng)'} | ${r.ngay || '(rỗng)'} | ${r.dap_an_goc} | ${r.dung ? 'đúng' : 'sai'} | ${r.ms === '' ? '-' : fmtMs(r.ms)} |`);
  }
  md.push('', '## Mã sai và lý do (tự động, thô)', '');
  for (const r of results.filter((x) => !x.dung)) md.push(`- ${r.code} (${r.cach}): ${reason(r, byCode.get(r.code)?.ghi_chu)}`);
  md.push('');
  await writeFile(path.join(args.out, 'summary.md'), md.join('\n'), 'utf8');
  console.log(`Đã ghi ${path.join(args.out, 'results.csv')} và summary.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
