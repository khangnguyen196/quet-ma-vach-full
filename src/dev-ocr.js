// Khu thử máy chủ OCR (đợt dang-nhap): CHỈ nạp khi chạy dev (main.js: if (import.meta.env.DEV) import("./dev-ocr.js")),
// nên không có trong bản build / GitHub Pages. Chuỗi đánh dấu để kiểm dist: dev-ocr-khu-thu
// Người đã đăng nhập chọn 1 ảnh → POST <địa chỉ máy chủ>/ocr kèm token đăng nhập, hiện mã HTTP + chữ ghép từ items.
// Địa chỉ: ocrServerUrl của src/front-photo.js (đợt chup-mat): mặc định máy chủ trên Azure; VITE_OCR_SERVER_URL
// (dự phòng tên cũ VITE_OCR_DEV_URL) để đổi, vd máy chủ trên máy: VITE_OCR_SERVER_URL=http://127.0.0.1:8765.
// Không lưu gì (không localStorage, không giữ ảnh). Mọi chữ từ máy chủ đặt bằng textContent (không bao giờ thành HTML).
import { ocrServerUrl } from "./front-photo.js";

// Giữ tên cũ cho ai import từ đây (tests/dev-ocr.test.js kiểm 2 chỗ là cùng một hàm)
export { ocrServerUrl };

const MARKER = "dev-ocr-khu-thu";

/** Câu tiếng Việt cho mã HTTP của máy chủ OCR. */
function statusText(status, retryAfter) {
  const wait = retryAfter ? ` Chờ ${retryAfter} giây rồi thử lại.` : "";
  if (status === 200) return "Đọc xong.";
  if (status === 401) return "Máy chủ từ chối token đăng nhập (401): đăng xuất rồi đăng nhập lại, hoặc kiểm AUTH_MODE / SUPABASE_URL của máy chủ.";
  if (status === 429) return "Gửi quá nhiều ảnh (429)." + wait;
  if (status === 503) return "Máy chủ đang bận, chưa nạp xong model, hoặc chưa kiểm được đăng nhập vì Supabase không trả lời (503)." + wait;
  if (status === 413) return "Ảnh quá lớn cho máy chủ (413).";
  if (status === 415) return "Máy chủ không đọc được loại ảnh này (415).";
  return `Máy chủ trả lỗi (HTTP ${status}).`;
}

/**
 * Gắn khu thử vào trang, ngay sau anchor (khối tài khoản).
 * getAccessToken(): token đăng nhập hiện tại ("" nếu chưa); onAuthChange(fn): gọi fn(đã đăng nhập?) mỗi khi đổi.
 */
export function initDevOcr({ anchor, getAccessToken, onAuthChange }) {
  // chỉ đưa 2 biến cần dùng (không truyền cả object env)
  const picked = ocrServerUrl({
    VITE_OCR_SERVER_URL: import.meta.env.VITE_OCR_SERVER_URL,
    VITE_OCR_DEV_URL: import.meta.env.VITE_OCR_DEV_URL,
  });
  if (picked.warning) console.warn(picked.warning);
  const base = picked.url;
  const box = document.createElement("section");
  box.id = MARKER;
  box.className = "dev-ocr";
  box.hidden = true;
  box.setAttribute("aria-label", "Thử máy chủ OCR (chỉ khi chạy dev)");

  const title = document.createElement("h2");
  title.textContent = "Thử máy chủ OCR (chỉ khi chạy dev)";
  const help = document.createElement("p");
  help.textContent = `Chọn 1 ảnh, app gửi tới ${base}/ocr kèm token đăng nhập. Mặc định là máy chủ trên Azure; `
    + `muốn dùng máy chủ trên máy (server\\chay-thu.ps1) thì đặt VITE_OCR_SERVER_URL=http://127.0.0.1:8765 trong .env. Không lưu gì.`;
  const actions = document.createElement("div");
  actions.className = "actions";
  const label = document.createElement("label");
  label.className = "btn";
  label.textContent = "Chọn ảnh gửi máy chủ";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  label.append(input);
  actions.append(label);
  const msg = document.createElement("p");
  msg.className = "msg";
  msg.setAttribute("role", "status");
  const out = document.createElement("pre");
  out.hidden = true;
  box.append(title, help, actions, msg, out);
  anchor.after(box);

  const say = (text, warn = false) => { msg.textContent = text; msg.classList.toggle("warn", warn); };

  onAuthChange((signedIn) => {
    box.hidden = !signedIn;
    if (!signedIn) { say(""); out.hidden = true; out.textContent = ""; }
  });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    out.hidden = true;
    out.textContent = "";
    const token = await getAccessToken().catch(() => "");
    if (!token) { say("Cần đăng nhập trước.", true); return; }
    say(`Đang gửi ${file.name} (${Math.round(file.size / 1024)} KB)…`);
    input.disabled = true;
    const t0 = performance.now();
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(base + "/ocr", { method: "POST", headers: { Authorization: "Bearer " + token }, body: fd });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      const secs = ((performance.now() - t0) / 1000).toFixed(1).replace(".", ",");
      const head = `HTTP ${res.status} · ${secs} giây. ${statusText(res.status, res.headers.get("Retry-After"))}`;
      if (res.ok && Array.isArray(body?.items)) {
        say(`${head} ${body.items.length} khung chữ.`);
        out.textContent = body.items.map((it) => String(it?.text ?? "")).join("\n") || "(không có chữ)";
        out.hidden = false;
      } else {
        say(body?.error ? `${head} Máy chủ: ${body.error}` : head, true);
      }
    } catch (e) {
      console.error(e);
      say(`Không kết nối được máy chủ ở ${base} (máy chủ trên máy: đã chạy server\\chay-thu.ps1 chưa? máy chủ trên Azure: `
        + `ALLOWED_ORIGINS có https://localhost:5173 chưa? máy chủ đang ngủ thì lần đầu chậm, thử lại).`, true);
    } finally {
      input.disabled = false;
    }
  });
}
