// Vẽ icon PWA (4 file PNG trong public/icons/). Chạy MỘT lần khi đổi hình: node tools/make-icons.mjs
// Chỉ dùng module có sẵn của Node (không cài thêm gói): tự mã hóa PNG (IHDR / IDAT / IEND, RGBA 8 bit).
// Hình tự vẽ: nền xanh của app + mấy vạch mã vạch dọc + một dấu tích. Không dùng logo / hình của ai.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Màu lấy từ biến :root (bản sáng) trong src/style.css
const GREEN = [0x1f, 0x7a, 0x4d]; // --accent  #1F7A4D (màu chủ đạo, nền icon)
const PAPER = [0xfa, 0xfa, 0xf6]; // --paper   #FAFAF6 (vạch mã vạch)
const YELLOW = [0xf2, 0xc9, 0x4c]; // --soon-line bản tối #F2C94C (dấu tích, nổi trên nền xanh)

// ---- PNG ----
// CRC32 của chunk PNG: dùng zlib.crc32 (Node 22.2+), máy cũ hơn thì tự tính bằng bảng.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf);
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array dài size*size*4 → file PNG (Buffer). */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // rộng
  ihdr.writeUInt32BE(size, 4); // cao
  ihdr[8] = 8; // 8 bit mỗi kênh
  ihdr[9] = 6; // kiểu màu 6 = RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // nén / lọc / không xen dòng
  // Mỗi dòng ảnh bắt đầu bằng 1 byte "kiểu lọc" (0 = không lọc)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---- Hình ----
// Tọa độ tính theo tỉ lệ cạnh ảnh (0..1), tâm ảnh là (0.5, 0.5).
// Mọi nét nằm trong vòng tròn bán kính 0.4 quanh tâm (vùng an toàn của icon maskable).
const BARS = [ // [x trái, độ rộng] của các vạch mã vạch
  [0.30, 0.030], [0.345, 0.015], [0.375, 0.040], [0.430, 0.015], [0.460, 0.030],
  [0.505, 0.015], [0.535, 0.040], [0.590, 0.015], [0.620, 0.030], [0.665, 0.015]
];
const BAR_TOP = 0.28, BAR_BOTTOM = 0.58;
const CHECK = [[0.39, 0.68], [0.46, 0.75], [0.62, 0.645]]; // dấu tích dưới mã vạch
const CHECK_HALF_WIDTH = 0.032;

/** Khoảng cách từ điểm (px, py) tới đoạn thẳng a–b. */
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Màu tại 1 điểm (x, y theo tỉ lệ). rounded: góc nền bo tròn (ngoài góc trong suốt). null = trong suốt. */
function colorAt(x, y, rounded) {
  if (rounded) {
    const r = 0.18; // bán kính bo góc
    const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    if (Math.hypot(x - cx, y - cy) > r) return null;
  }
  for (let i = 0; i < CHECK.length - 1; i++) {
    if (distToSegment(x, y, CHECK[i], CHECK[i + 1]) <= CHECK_HALF_WIDTH) return YELLOW;
  }
  if (y >= BAR_TOP && y <= BAR_BOTTOM && BARS.some(([left, w]) => x >= left && x <= left + w)) return PAPER;
  return GREEN;
}

/** Vẽ ảnh size×size; mỗi điểm ảnh lấy trung bình 4×4 điểm con để mép nét mịn (khử răng cưa). */
function draw(size, rounded) {
  const N = 4;
  const rgba = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = colorAt((px + (sx + 0.5) / N) / size, (py + (sy + 0.5) / N) / size, rounded);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = (py * size + px) * 4;
      if (a) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
      }
      rgba[o + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return rgba;
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

// rounded: true = góc bo trong suốt (icon thường); false = nền phủ kín (maskable, iPhone tô đen chỗ trong suốt)
const OUTPUTS = [
  { file: "icon-192.png", size: 192, rounded: true },
  { file: "icon-512.png", size: 512, rounded: true },
  { file: "icon-maskable-512.png", size: 512, rounded: false },
  { file: "apple-touch-icon-180.png", size: 180, rounded: false }
];
for (const { file, size, rounded } of OUTPUTS) {
  const png = encodePng(size, draw(size, rounded));
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`${file}: ${size}×${size}, ${png.length} byte`);
}
