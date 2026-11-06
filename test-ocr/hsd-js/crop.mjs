// Cắt vùng in hạn sử dụng theo crops.csv (giả lập người dùng chụp riêng vùng HSD).
// Chạy với thư mục hiện tại là test-ocr (thư mục có photos/):
//   node <đường dẫn>/hsd-js/crop.mjs [--photos photos] [--crops <hsd-js>/crops.csv]
// Ảnh cắt ghi ra photos/<mã>/hsd/crop.jpg. Đặt trong THƯ MỤC CON hsd/ chứ không đặt thẳng
// trong photos/<mã>/, vì run_ocr.py đọc mọi photos/*/*.jpg: ảnh cắt sẽ lẫn vào bộ OCR.
// Tọa độ trong crops.csv là tọa độ ảnh sau khi jimp xoay theo EXIF (giống trình duyệt hiển thị).
import { Jimp } from 'jimp';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`Tham số lạ: ${k}`);
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`Thiếu giá trị cho ${k}`);
    out[k.slice(2)] = v;
    i++;
  }
  return out;
}

// Đọc crops.csv: code,file_nguon,x,y,w,h,ghi_chu (ghi_chu không chứa dấu phẩy).
// Dòng "không tìm thấy" có x/y/w/h trống: box = null.
export async function readCrops(file) {
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split(',');
  if (header.slice(0, 6).join(',') !== 'code,file_nguon,x,y,w,h') throw new Error(`Sai tiêu đề ${file}`);
  return lines.map((line) => {
    const p = line.split(',');
    const [code, file_nguon, x, y, w, h] = p;
    const ghi_chu = p.slice(6).join(',');
    const nums = [x, y, w, h].map((s) => (s?.trim() ? Number(s) : NaN));
    const box = nums.every(Number.isInteger) ? { x: nums[0], y: nums[1], w: nums[2], h: nums[3] } : null;
    return { code, file_nguon, box, ghi_chu };
  });
}

export function cropPath(photos, code) {
  return path.join(photos, code, 'hsd', 'crop.jpg');
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { photos: 'photos', crops: path.join(HERE, 'crops.csv') });
  const rows = await readCrops(args.crops);
  for (const r of rows) {
    if (!r.box) {
      console.log(`${r.code}: không tìm thấy vùng HSD, bỏ qua`);
      continue;
    }
    const src = path.join(args.photos, r.code, r.file_nguon);
    const img = await Jimp.read(src);
    const { x, y, w, h } = r.box;
    // Khung vượt ảnh thì dừng hẳn (không tự co khung), để sửa crops.csv có lý do rõ ràng
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > img.width || y + h > img.height) {
      throw new Error(`${r.code}: khung ${x},${y},${w},${h} vượt ảnh ${img.width}x${img.height}`);
    }
    img.crop({ x, y, w, h });
    const out = cropPath(args.photos, r.code);
    await mkdir(path.dirname(out), { recursive: true });
    await img.write(out, { quality: 95 });
    console.log(`${r.code}: ${r.file_nguon} ${img.width}x${img.height} → ${out}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
