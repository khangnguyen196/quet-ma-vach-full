// Hàm thuần cho trang thử public/ocr-thu.html (không DOM, test bằng node:test trong test-ocr/web-ocr/test).
// groupRows / rowLines / tessLangObjects / makeTar CHÉP NGUYÊN từ test-ocr/web-ocr/lib.mjs (trang chạy trên GitHub Pages không
// lấy được file trong test-ocr/); test ocr-thu.test.mjs kiểm 2 bản cho cùng kết quả.

/** Khung bao của một đa giác [[x,y], ...]. */
function bbox(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Gom các khung chữ của PaddleOCR thành hàng theo thứ tự đọc (giống lib.mjs). */
export function groupRows(items, minOverlap = 0.5) {
  const boxes = items
    .filter((it) => it && typeof it.text === "string" && it.text.trim() !== "" && Array.isArray(it.poly) && it.poly.length)
    .map((it) => ({ ...bbox(it.poly), text: it.text.trim() }))
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  const rows = [];
  for (const b of boxes) {
    const row = rows[rows.length - 1];
    if (row) {
      const overlap = Math.min(b.maxY, row.maxY) - Math.max(b.minY, row.minY);
      const h = Math.min(b.maxY - b.minY, row.maxY - row.minY);
      if (h > 0 && overlap / h >= minOverlap) {
        row.boxes.push(b);
        row.minY = Math.min(row.minY, b.minY);
        row.maxY = Math.max(row.maxY, b.maxY);
        continue;
      }
    }
    rows.push({ minY: b.minY, maxY: b.maxY, boxes: [b] });
  }
  return rows.map((r) => r.boxes.sort((a, b) => a.minX - b.minX).map((b) => b.text));
}

/** Khung cùng hàng nối thành 1 dòng (cách paddlejs-rows-* đã đo): nhãn và số bảng dinh dưỡng cùng dòng. */
export function rowLines(items, minOverlap = 0.5) {
  return groupRows(items, minOverlap).map((r) => r.join(" "));
}

/** Ngôn ngữ cho tesseract.createWorker khi trang tự tải dữ liệu đã ghim bản (xem giải thích ở lib.mjs):
 *  tesseract.js 7.0.0 ghép tên ngôn ngữ ở bước khởi tạo bằng l.data, nên data là getter: lần đọc đầu trả byte,
 *  các lần sau trả tên. */
export function tessLangObjects(langs) {
  return langs.map(({ code, data }) => {
    let reads = 0;
    return {
      code,
      get data() {
        reads += 1;
        return reads === 1 ? data : code;
      },
    };
  });
}

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

/** Lỗi có phải do thiếu bộ nhớ không: RangeError khi câu lỗi có "alloc" / "memory" / "buffer" (cấp phát ArrayBuffer /
 *  WebAssembly.Memory; RangeError khác như "Maximum call stack size exceeded", "Invalid array length" thì không), hoặc
 *  câu lỗi có "memory", "OOM", "allocate"/"allocation", "bad_alloc" (onnxruntime, Emscripten, tesseract gửi lỗi dạng chuỗi).
 *  RangeError lỗi vị trí ("... outside the bounds of the buffer", "Length out of range of buffer") KHÔNG tính là thiếu bộ
 *  nhớ: nếu tính, nhánh WebGPU của trang sẽ không lùi về wasm và báo sai là thiếu bộ nhớ. */
export function isMemoryError(err) {
  if (err == null) return false;
  if (typeof RangeError !== "undefined" && err instanceof RangeError) {
    const m = err.message || "";
    if (/bounds|out of range/i.test(m)) return false;
    return /alloc|memory|buffer/i.test(m);
  }
  const text = typeof err === "string" ? err : `${err.name || ""} ${err.message || ""} ${String(err)}`;
  return /memory|\boom\b|allocat|bad_alloc/i.test(text);
}

/** Cộng byte tải từ các mục PerformanceResourceTiming (chỉ mục từ CDN, trang đã lọc).
 *  transferSize > 0: byte qua mạng (đã nén). transferSize 0 mà decodedBodySize > 0: lấy từ bộ nhớ đệm.
 *  Cả 2 bằng 0: máy chủ không gửi Timing-Allow-Origin nên trình duyệt không cho đo. */
export function sumResourceBytes(entries) {
  let transfer = 0;
  let measured = 0;
  let cached = 0;
  let unknown = 0;
  for (const e of entries) {
    if (e.transferSize > 0) {
      transfer += e.transferSize;
      measured++;
    } else if (e.decodedBodySize > 0) cached++;
    else unknown++;
  }
  return { transfer, measured, cached, unknown, count: entries.length };
}

/** Tên tiếng Việt của 11 ô (thứ tự FIELDS của regex.mjs). */
export const FIELD_LABELS = {
  ten: "Tên sản phẩm",
  thuong_hieu: "Thương hiệu (luật regex không rút ô này)",
  khoi_luong: "Khối lượng",
  thanh_phan_dau: "3 thành phần đầu",
  nang_luong_kcal: "Năng lượng (kcal)",
  dam_g: "Đạm (g)",
  beo_g: "Béo (g)",
  carb_g: "Carbohydrate (g)",
  nha_san_xuat: "Nhà sản xuất",
  bao_quan: "Bảo quản",
  han_su_dung: "Hạn sử dụng",
};

/** Giá trị 1 ô để hiện: trống -> "chưa đọc được"; mảng nối bằng ", ". */
export function fieldText(v) {
  const s = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  return s.trim() === "" ? "chưa đọc được" : s;
}

const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? "–" : Number(x).toFixed(d));

/** Đoạn tóm tắt để chủ dự án chép, dán lại. info: thông tin chung; runs: kết quả từng công cụ. */
export function buildSummary(info, runs) {
  const lines = [
    `Thử OCR bao bì (ocr-thu.html) – ${info.time}`,
    `Trình duyệt: ${info.userAgent}`,
    `crossOriginIsolated: ${info.crossOriginIsolated}; WebGPU: ${info.gpu}; Chỉ dùng wasm: ${info.wasmOnly ? "có" : "không"}`,
    `Ảnh: gốc ${info.image || "–"}; sau thu nhỏ ${info.scaled || "–"}`,
  ];
  for (const r of runs) {
    lines.push("", `[${r.engine}] backend: ${r.backend || "–"}; giây tải model: ${fmt(r.loadSeconds)}; giây đọc: ${fmt(r.readSeconds)}` +
      (r.note ? `; ghi chú: ${r.note}` : ""));
    if (r.error) lines.push(`LỖI: ${r.error}`);
    if (r.fields) {
      lines.push(Object.keys(FIELD_LABELS).map((k) => `${FIELD_LABELS[k]}: ${fieldText(r.fields[k])}`).join(" | "));
    }
    if (r.text != null) {
      const t = r.text.replace(/\s+/g, " ").trim();
      lines.push(`Chữ (${r.text.length} ký tự): ${t.length > 600 ? t.slice(0, 600) + "…" : t}`);
    }
  }
  if (info.bytes) lines.push("", `Byte đã tải: ${info.bytes}`);
  return lines.join("\n");
}
