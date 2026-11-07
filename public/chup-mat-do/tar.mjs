// Trang thử chup-mat-do.html: gói tar cho PaddleOCR.js (chép nguyên makeTar của public/ocr-thu/text.mjs; test so với
// test-ocr/web-ocr/lib.mjs). ES module thuần, không import gì.

/** Gói các file thành 1 file tar (ustar, không nén) mà PaddleOCR.js đọc được (cần inference.onnx + inference.yml).
 *  files: [{ name, data: Uint8Array }]. Trả Uint8Array. */
export function makeTar(files) {
  const enc = new TextEncoder();
  const blocks = [];
  let total = 0;
  const writeStr = (buf, off, len, str) => {
    const b = enc.encode(str);
    buf.set(b.subarray(0, len), off);
  };
  for (const f of files) {
    const name = enc.encode(f.name);
    if (name.length > 100) throw new Error(`Tên file quá dài cho tar: ${f.name}`);
    const h = new Uint8Array(512);
    writeStr(h, 0, 100, f.name);
    writeStr(h, 100, 8, "0000644\0");
    writeStr(h, 108, 8, "0000000\0");
    writeStr(h, 116, 8, "0000000\0");
    writeStr(h, 124, 12, f.data.length.toString(8).padStart(11, "0") + "\0");
    writeStr(h, 136, 12, "00000000000\0");
    h.fill(0x20, 148, 156); // ô checksum tính như 8 dấu cách
    h[156] = 0x30; // '0' = file thường
    writeStr(h, 257, 6, "ustar\0");
    writeStr(h, 263, 2, "00");
    let sum = 0;
    for (const v of h) sum += v;
    writeStr(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
    blocks.push(h);
    blocks.push(f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
    total += 512 + f.data.length + pad;
  }
  blocks.push(new Uint8Array(1024)); // 2 khối trống cuối
  total += 1024;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

