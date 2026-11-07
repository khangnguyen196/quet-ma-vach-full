// Phần thuần của việc tải bản xuất (du-lieu-vn.mjs): kiểm mã HTTP khi tải nối (Range), kiểm đủ byte, ghi có chống
// nghẽn (chờ 'drain'). Không gọi mạng.

/** Mã HTTP cuối cùng curl in ra stderr nhờ `-w "%{stderr}HTTP_CODE=%{http_code}\n"` (có chuyển hướng thì lấy mã cuối). */
export function parseHttpCode(stderrText) {
  const m = [...String(stderrText ?? "").matchAll(/HTTP_CODE=(\d{3})/g)];
  return m.length ? Number(m.at(-1)[1]) : null;
}

/** Lần tải có dùng được không: tải từ đầu (from = 0) cần 200; tải nối (from > 0, Range) cần 206 – server trả 200 là đã
 *  gửi lại cả file từ byte 0, nối vào sẽ hỏng file -> phải tải lại từ đầu. */
export function resumeOk(from, httpCode) {
  return from > 0 ? httpCode === 206 : httpCode === 200;
}

/** Đủ byte: số byte cuối bằng Content-Length. Không biết Content-Length thì không kết luận được là đủ. */
export function isComplete(bytes, expected) {
  return Number.isFinite(expected) && expected > 0 && bytes === expected;
}

/** Đọc `src` (luồng đọc, vd curl stdout), ghi từng khúc vào mọi luồng `dests`. Một đích trả false (đầy) thì dừng
 *  nguồn tới khi mọi đích đầy đã 'drain'. onChunk(khúc) gọi cho mỗi khúc. Trả Promise xong khi nguồn hết. */
export function pipeWithBackpressure(src, dests, onChunk = () => {}) {
  return new Promise((resolve, reject) => {
    let waiting = 0;
    src.on("data", (chunk) => {
      onChunk(chunk);
      for (const d of dests) {
        if (!d.write(chunk)) {
          waiting++;
          d.once("drain", () => { if (--waiting === 0) src.resume(); });
        }
      }
      if (waiting > 0) src.pause();
    });
    src.on("end", resolve);
    src.on("error", reject);
  });
}
