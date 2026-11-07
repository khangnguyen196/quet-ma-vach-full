// Hàm thuần dùng chung cho harness (trong trình duyệt) và run-browser.mjs (Node).
// Không import gì của Node / DOM để chạy được ở cả hai nơi và test bằng node:test.

/** Tên file kết quả, giống run_ocr.py: <mã>__<tên ảnh không đuôi>.txt */
export function resultFileName(code, image) {
  return `${code}__${image}.txt`;
}

/** Tên công cụ trong outputs/ và times.csv, vd paddlejs + chromium -> "paddlejs-chromium". */
export function toolName(engine, browser) {
  return `${engine}-${browser}`;
}

/** Một ô CSV theo kiểu module csv của Python: có dấu phẩy, nháy kép hoặc xuống dòng thì bọc nháy kép. */
export function csvField(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Một dòng CSV (có \r\n cuối như csv.writer của Python). */
export function csvLine(fields) {
  return fields.map(csvField).join(",") + "\r\n";
}

/** Dòng times.csv: tool,code,image,seconds,status. Giây làm tròn 2 chữ số như run_ocr.py.
 *  Câu lỗi dài / nhiều dòng được gom về một dòng, tối đa 300 ký tự. */
export function timesRow(tool, code, image, seconds, status) {
  const secs = Math.round(Number(seconds) * 100) / 100;
  const st = String(status).replace(/\s+/g, " ").trim().slice(0, 300);
  return csvLine([tool, code, image, secs, st]);
}

/** Danh sách ảnh giống run_ocr.py: photos/<mã>/<ảnh>.(jpg|jpeg|png), chỉ đúng 2 cấp
 *  (không lấy photos/<mã>/hsd/...), sắp theo đường dẫn. Đầu vào: đường dẫn tương đối dùng "/". */
export function pickPhotos(relPaths) {
  return relPaths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => {
      const parts = p.split("/");
      return parts.length === 2 && /\.(jpe?g|png)$/i.test(parts[1]);
    })
    .sort()
    .map((p) => {
      const [code, file] = p.split("/");
      return { code, image: file.replace(/\.[^.]+$/, ""), rel: p };
    });
}

/** Khung bao của một đa giác [[x,y], ...]. */
function bbox(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Gom các khung chữ của PaddleOCR thành hàng theo thứ tự đọc.
 *  - Sắp các khung theo cạnh trên (minY).
 *  - Gom thành hàng: khung chồng chiều dọc với hàng đang xét ít nhất `minOverlap` (tính trên chiều cao
 *    nhỏ hơn giữa khung và hàng) thì cùng hàng; hàng nở theo khung mới.
 *  - Trong hàng, sắp trái sang phải (minX). Hàng sắp trên xuống.
 *  items: [{ poly: [[x,y]x4], text }]. Trả về mảng hàng, mỗi hàng là mảng chuỗi (bỏ khung chữ rỗng). */
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

/** Cách ghi chữ chính của Paddle (dùng cho chấm điểm): mỗi khung chữ 1 dòng, theo thứ tự của groupRows. */
export function orderLines(items, minOverlap = 0.5) {
  return groupRows(items, minOverlap).flat();
}

/** Cách ghi phụ (chỉ để thử, không vào bảng chính): các khung cùng hàng nối thành 1 dòng, cách nhau 1 dấu cách. */
export function rowLines(items, minOverlap = 0.5) {
  return groupRows(items, minOverlap).map((r) => r.join(" "));
}

/** Gom số đo bộ nhớ.
 *  samples: [{ phase: "baseline" | "run", procs: [{ pid, private, ws }] }] (byte).
 *  - baseline: trung vị của tổng private các mẫu "baseline" (trang trống).
 *  - peakProc: private lớn nhất của MỘT tiến trình ở mọi mẫu "run".
 *  - peakTotal: tổng private lớn nhất của cả cây ở mọi mẫu "run".
 *  - peakProcWs / peakTotalWs: như trên nhưng với working set.
 *  Không có mẫu -> null. */
export function summarizeMemory(samples) {
  const sum = (procs, key) => procs.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const maxOf = (procs, key) => procs.reduce((m, p) => Math.max(m, Number(p[key]) || 0), 0);
  const base = samples.filter((s) => s.phase === "baseline" && s.procs.length).map((s) => sum(s.procs, "private"));
  const run = samples.filter((s) => s.phase === "run" && s.procs.length);
  const median = (arr) => {
    if (!arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const peak = (fn) => (run.length ? Math.max(...run.map(fn)) : null);
  return {
    baseline: median(base),
    peakProc: peak((s) => maxOf(s.procs, "private")),
    peakTotal: peak((s) => sum(s.procs, "private")),
    peakProcWs: peak((s) => maxOf(s.procs, "ws")),
    peakTotalWs: peak((s) => sum(s.procs, "ws")),
    samples: run.length,
  };
}

/** Cộng byte tải. entries: [{ url, transfer, decoded }] (transfer = byte qua mạng, decoded = byte sau giải nén;
 *  -1 / null / NaN tính là 0). Trả { transfer, decoded, count, big } với big = các file > `bigLimit` byte
 *  (theo transfer hoặc decoded), sắp giảm dần theo decoded. */
export function sumBytes(entries, bigLimit = 100 * 1024) {
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  let transfer = 0;
  let decoded = 0;
  const big = [];
  for (const e of entries) {
    const t = num(e.transfer);
    const d = num(e.decoded);
    transfer += t;
    decoded += d;
    if (t > bigLimit || d > bigLimit) big.push({ url: e.url, transfer: t, decoded: d });
  }
  big.sort((a, b) => b.decoded - a.decoded || b.transfer - a.transfer);
  return { transfer, decoded, count: entries.length, big };
}

/** Byte -> MB (1 MB = 1.000.000 byte), 1 chữ số thập phân; null -> "". */
export function mb(bytes) {
  return bytes == null ? "" : (bytes / 1e6).toFixed(1);
}

/** Thống kê giây/ảnh: chỉ tính ảnh ok. Trả { ok, errors, mean, max }. */
export function timeStats(rows) {
  const ok = rows.filter((r) => r.status === "ok").map((r) => Number(r.seconds));
  const errors = rows.length - ok.length;
  const mean = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
  const max = ok.length ? Math.max(...ok) : null;
  return { ok: ok.length, errors, mean, max };
}

/** Danh sách ngôn ngữ cho tesseract.createWorker khi trang tự tải dữ liệu (để ghim bản @1.0.0).
 *  langs: [{ code: "vie", data: Uint8Array (.traineddata.gz) }]. Trả mảng object { code, data } cho createWorker.
 *
 *  Vì sao cần hàm này: tesseract.js 7.0.0 nhận [{ code, data }] ở bước nạp ngôn ngữ (loadLanguage dùng `data` là
 *  byte, tự giải nén gzip) NHƯNG bước khởi tạo (initialize trong src/worker-script/index.js) lại ghép tên ngôn ngữ
 *  bằng `l.data` thay vì `l.code`, nên truyền thẳng thì Tesseract đi tìm file "./31,139,8,…" và lỗi.
 *  createWorker gửi CÙNG mảng này sang worker 2 lần (nạp ngôn ngữ, rồi khởi tạo); mỗi lần gửi, trình duyệt sao chép
 *  object (structured clone) và đọc `data` đúng 1 lần. Nên `data` là getter: lần đọc đầu trả byte, các lần sau trả
 *  tên ngôn ngữ. Đã thử: tesseract.js 7.0.0, vie+eng, trong Node. */
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
