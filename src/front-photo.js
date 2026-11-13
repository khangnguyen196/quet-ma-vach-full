// "Chụp mặt trước" (đợt chup-mat): chuẩn bị ảnh và gửi máy chủ OCR. Không DOM ở cấp module, không import thư viện,
// không gọi mạng lúc nạp (chỉ gọi khi người dùng đã đăng nhập và chọn ảnh).
// - ocrServerUrl(env): chọn địa chỉ máy chủ OCR (mặc định máy chủ trên Azure).
// - fitSize / prepareImage: thu cạnh dài về 1600 px, mã hóa lại JPEG 0,9 (bỏ EXIF / GPS).
// - sendOcr: POST <máy chủ>/ocr kèm token đăng nhập, hết giờ 45 giây, báo "chậm" sau 5 giây, đổi mã HTTP thành
//   { kind, message } tiếng Việt. Chữ từ máy chủ (serverMessage, items) giao diện phải đặt bằng textContent.

/** Địa chỉ máy chủ OCR mặc định (công khai, không phải bí mật). Đổi bằng VITE_OCR_SERVER_URL. */
export const OCR_DEFAULT_URL = "https://quet-ma-vach-ocr.jollyground-aaecba36.malaysiawest.azurecontainerapps.io";

export const FRONT_MAX_SIDE = 1600;         // như lúc đo + máy chủ (server/imaging.py MAX_SIDE)
export const FRONT_JPEG_QUALITY = 0.9;
export const OCR_TIMEOUT_MS = 45000;        // máy chủ ngủ dậy đo được ~14 giây; 45 giây là trần
export const OCR_SLOW_MS = 5000;            // quá chừng này thì giao diện báo "máy chủ đang khởi động"
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** 429 có Retry-After lớn hơn chừng này (giây) = hết lượt trong ngày (giới hạn theo phút chỉ chờ ≤ 60 giây). */
export const DAILY_RETRY_MIN_S = 300;

// Máy được gửi token qua http:// (không mã hóa) chỉ khi là chính máy này.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Chọn địa chỉ máy chủ OCR từ object biến môi trường (thuần, test bằng node).
 * VITE_OCR_SERVER_URL || VITE_OCR_DEV_URL (tên cũ) || OCR_DEFAULT_URL; bỏ khoảng trắng và "/" cuối.
 * Chỉ nhận https://… (hoặc http:// tới localhost / 127.0.0.1 / [::1]) không có tên đăng nhập, ?, #;
 * sai → mặc định + warning (câu tiếng Việt, chỉ nêu tên biến).
 * Ví dụ: ocrServerUrl({ VITE_OCR_SERVER_URL: "http://127.0.0.1:8765/" }) → { url: "http://127.0.0.1:8765", warning: "" }
 */
export function ocrServerUrl(env) {
  const e = env || {};
  let name = "";
  let raw = "";
  for (const key of ["VITE_OCR_SERVER_URL", "VITE_OCR_DEV_URL"]) {
    const v = String(e[key] ?? "").trim();
    if (v) { name = key; raw = v; break; }
  }
  if (!raw) return { url: OCR_DEFAULT_URL, warning: "" };
  const url = raw.replace(/\/+$/, "");
  let u = null;
  try {
    u = new URL(url);
  } catch {
    u = null;
  }
  const shapeOk = Boolean(u) && (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname)
    && !u.username && !u.password && !u.search && !u.hash && !url.includes("?") && !url.includes("#");
  if (!shapeOk) {
    return { url: OCR_DEFAULT_URL, warning: `Biến ${name} không phải địa chỉ http(s)://… hợp lệ; app dùng máy chủ mặc định ${OCR_DEFAULT_URL}.` };
  }
  if (u.protocol === "http:" && !LOCAL_HOSTS.includes(u.hostname)) {
    return {
      url: OCR_DEFAULT_URL,
      warning: `Biến ${name} phải là https://… (token đăng nhập đi kèm ảnh; http:// chỉ cho localhost / 127.0.0.1 / [::1]); app dùng máy chủ mặc định ${OCR_DEFAULT_URL}.`,
    };
  }
  return { url, warning: "" };
}

/**
 * Cỡ mới khi thu cạnh dài về maxSide (chỉ thu nhỏ, không phóng to), giống server/imaging.py fit_size.
 * Ví dụ: fitSize(2076, 3508) → { width: 947, height: 1600 }; fitSize(800, 600) → { width: 800, height: 600 }.
 */
export function fitSize(w, h, maxSide = FRONT_MAX_SIDE) {
  const W = Number(w);
  const H = Number(h);
  if (!(W > 0) || !(H > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, maxSide / Math.max(W, H));
  // Math.floor(x + 0.5) = làm tròn nửa lên như round_half_up của máy chủ (số dương)
  return { width: Math.max(1, Math.floor(W * scale + 0.5)), height: Math.max(1, Math.floor(H * scale + 0.5)) };
}

/**
 * (Cần trình duyệt, không test bằng node.) Ảnh người dùng chọn → { ok: true, blob, width, height, reencoded }
 * hoặc { ok: false, message }. Giải mã bằng <img>.decode() (trình duyệt tự xoay theo EXIF), vẽ canvas theo fitSize,
 * mã hóa lại JPEG 0,9 → luôn bỏ EXIF / GPS. Không giải mã được (vd HEIC trên máy tính) → gửi file gốc nếu ≤ 5 MB
 * (máy chủ đọc được HEIC), không thì báo lỗi tiếng Việt.
 */
export async function prepareImage(file) {
  if (!file) return { ok: false, message: "Chưa chọn ảnh." };
  let url = "";
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const { width, height } = fitSize(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", FRONT_JPEG_QUALITY));
    canvas.width = 0; // trả bộ nhớ canvas sớm (điện thoại yếu)
    if (!blob) throw new Error("toBlob trả rỗng");
    return { ok: true, blob, width, height, reencoded: true };
  } catch {
    if (file.size > 0 && file.size <= MAX_UPLOAD_BYTES) return { ok: true, blob: file, width: null, height: null, reencoded: false };
    return { ok: false, message: "Không đọc được ảnh này trên máy và ảnh lớn hơn 5 MB. Hãy chụp lại hoặc chọn ảnh JPEG / PNG khác." };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/** Số giây trong header Retry-After (chỉ dạng số nguyên); không có / sai → null. */
function parseRetryAfter(value) {
  const s = String(value ?? "").trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}

/** Câu lỗi của máy chủ (body.error) nếu là chuỗi; cắt ngắn để giao diện không bị tràn. */
function serverMessageOf(body) {
  const e = body && typeof body.error === "string" ? body.error.trim() : "";
  return e.length > 300 ? e.slice(0, 300) + "…" : e;
}

function fail(kind, message, { retryAfter = null, serverMessage = "", status = null } = {}) {
  return { ok: false, kind, message, retryAfter, serverMessage, status };
}

/** Đổi mã HTTP lỗi của máy chủ OCR thành { kind, message } (server/app.py: 401 / 413 / 415 / 429 / 503…). */
function failFromStatus(status, retryAfter, serverMessage) {
  const extra = { retryAfter, serverMessage, status };
  if (status === 401) return fail("auth", "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy đăng nhập lại rồi thử lại.", extra);
  if (status === 429) {
    if (retryAfter != null && retryAfter > DAILY_RETRY_MIN_S) {
      return fail("daily", "Bạn đã hết lượt hôm nay cho tính năng đọc chữ trên ảnh. Trong lúc chờ, hãy quét mã vạch hoặc nhập số mã.", extra);
    }
    const wait = retryAfter != null ? `chờ ${retryAfter} giây` : "chờ ít giây";
    return fail("rate", `Gửi ảnh hơi nhiều, ${wait} rồi thử lại.`, extra);
  }
  if (status === 503) {
    const wait = retryAfter != null ? ` sau ${retryAfter} giây` : " sau ít giây";
    return fail("busy", `Máy chủ đang bận hoặc chưa sẵn sàng, thử lại${wait}.`, extra);
  }
  if (status === 413) return fail("tooBig", "Ảnh quá lớn cho máy chủ. Hãy chụp lại hoặc chọn ảnh nhỏ hơn.", extra);
  if (status === 415) return fail("badType", "Máy chủ không đọc được loại ảnh này. Hãy chọn ảnh JPEG hoặc PNG.", extra);
  return fail("other", `Máy chủ trả lỗi (HTTP ${status}). Thử lại sau.`, extra);
}

/**
 * Gửi ảnh tới <base>/ocr kèm token đăng nhập.
 * Trả { ok: true, items, ms } hoặc { ok: false, kind, message, retryAfter, serverMessage, status }.
 * kind: auth | daily | rate | busy | tooBig | badType | timeout | network | aborted | other.
 * - Token rỗng: kind auth, KHÔNG gọi mạng.
 * - Hết timeoutMs (kể cả lúc đọc body): hủy bằng AbortController, kind timeout.
 * - onSlow(): gọi đúng 1 lần nếu quá slowMs mà chưa xong; mọi đường ra đều hủy 2 hẹn giờ.
 * - signal: người gọi hủy (vd đóng màn hình) → kind aborted.
 * - Lỗi mạng gồm cả 503 do quá tải không có header CORS (trình duyệt chỉ thấy lỗi mạng): kind network.
 * Ví dụ: await sendOcr({ base, token, blob }) → { ok: true, items: [{ text, poly, score }, …], ms: 1234 }
 */
export async function sendOcr({
  base, token, blob, filename = "front.jpg", fetchImpl = globalThis.fetch,
  timeoutMs = OCR_TIMEOUT_MS, slowMs = OCR_SLOW_MS, onSlow, signal,
} = {}) {
  const tok = typeof token === "string" ? token.trim() : "";
  if (!tok) return fail("auth", "Cần đăng nhập để đọc chữ trên ảnh.");
  if (!blob) return fail("other", "Chưa có ảnh để gửi.");
  if (signal?.aborted) return fail("aborted", "Đã hủy.");

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const slowTimer = typeof onSlow === "function" ? setTimeout(() => { try { onSlow(); } catch { /* lỗi giao diện không làm hỏng lượt gửi */ } }, slowMs) : null;
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const t0 = Date.now();
  try {
    const fd = new FormData();
    fd.append("image", blob, filename);
    const res = await fetchImpl(String(base).replace(/\/+$/, "") + "/ocr", {
      method: "POST",
      headers: { Authorization: "Bearer " + tok },
      body: fd,
      signal: ctrl.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      if (ctrl.signal.aborted) throw e; // hết giờ / hủy lúc đang đọc body: xử lý ở catch ngoài
      body = null;
    }
    const retryAfter = parseRetryAfter(res.headers?.get?.("Retry-After"));
    const serverMessage = serverMessageOf(body);
    if (res.status === 200) {
      if (body && Array.isArray(body.items)) return { ok: true, items: body.items, ms: Date.now() - t0 };
      return fail("other", "Máy chủ trả dữ liệu không đúng dạng. Thử lại sau.", { status: 200 });
    }
    return failFromStatus(res.status, retryAfter, serverMessage);
  } catch {
    if (timedOut) return fail("timeout", `Máy chủ không trả lời sau ${Math.round(timeoutMs / 1000)} giây. Kiểm tra mạng rồi thử lại.`);
    if (signal?.aborted) return fail("aborted", "Đã hủy.");
    return fail("network", "Không kết nối được máy chủ (máy chủ bận hoặc mất mạng), thử lại.");
  } finally {
    clearTimeout(timer);
    if (slowTimer) clearTimeout(slowTimer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}
