// Phần thuần của đăng nhập Google qua Supabase (đợt dang-nhap): không DOM, không import thư viện, không đọc
// import.meta.env (main.js truyền vào). Test: tests/auth.test.js (chạy bằng node).
// Đăng nhập KHÔNG bắt buộc: quét mã, tủ đồ, dị ứng, so sánh, xuất / nhập chạy như cũ khi chưa đăng nhập.

/** Tham số Supabase gắn vào địa chỉ khi quay về từ Google (đổi mã xong thì xóa khỏi thanh địa chỉ). */
const AUTH_PARAMS = ["code", "error", "error_description", "error_code"];
/** Khóa có thể nằm sau dấu # (lỗi, hoặc token của luồng implicit): xóa khỏi thanh địa chỉ, không để lại token. */
const HASH_PARAMS = [
  ...AUTH_PARAMS, "access_token", "refresh_token", "token_type", "expires_in", "expires_at",
  "provider_token", "provider_refresh_token"
];

/** Phần sau # dạng a=1&b=2 → URLSearchParams (không có # thì rỗng). */
function hashParams(u) {
  return new URLSearchParams(u.hash.replace(/^#/, ""));
}

/** Giải phần giữa của JWT (base64url → JSON); lỗi gì cũng trả null (coi như không phải JWT). */
function jwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const data = JSON.parse(json);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/**
 * Khóa BÍ MẬT dán nhầm vào chỗ publishable key: tiền tố "sb_secret_", hoặc JWT có role service_role.
 * Repo công khai và bản build gửi biến VITE_* cho mọi trình duyệt, nên: build (vite.config.js, secretEnvNames) dừng
 * với lỗi nếu biến VITE_* chứa khóa bí mật; app cũng bỏ qua khóa này nếu lọt (authConfig); máy chủ không khởi động.
 */
export function isSecretKey(key) {
  const k = String(key ?? "").trim();
  if (k.startsWith("sb_secret_")) return true;
  return jwtPayload(k)?.role === "service_role";
}

/**
 * TÊN các biến bắt đầu "VITE_" (Vite chép nguyên giá trị vào JS) đang chứa khóa bí mật (isSecretKey), sắp theo tên.
 * Chỉ trả tên, KHÔNG BAO GIỜ trả giá trị (vite.config.js đưa tên vào câu lỗi). env rỗng / undefined → [].
 */
export function secretEnvNames(env) {
  if (!env || typeof env !== "object") return [];
  return Object.keys(env)
    .filter((name) => name.startsWith("VITE_") && isSecretKey(env[name]))
    .sort();
}

/**
 * Đọc cấu hình từ biến môi trường của Vite.
 * env: object kiểu import.meta.env. Trả { url, key } khi đủ VITE_SUPABASE_URL (https) + VITE_SUPABASE_PUBLISHABLE_KEY,
 * thiếu / rỗng / không phải https thì null (app ẩn khối tài khoản, không tải thư viện).
 * Publishable key là khóa CÔNG KHAI (được phép nằm trong app), không phải secret / service_role: dán nhầm khóa bí
 * mật (isSecretKey) cũng trả null, app chạy như chưa cấu hình.
 */
export function authConfig(env) {
  const url = String(env?.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = String(env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!url || !key) return null;
  if (isSecretKey(key)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) return null;
  return { url, key };
}

/**
 * Địa chỉ Google / Supabase quay về sau khi đăng nhập: origin + pathname, bỏ "index.html" cuối, bỏ query và #.
 * Vd https://khangnguyen196.github.io/quet-ma-vach-full/ , https://localhost:5173/ (phải có trong Redirect URLs của Supabase).
 */
export function redirectUrl(location) {
  const pathname = String(location?.pathname ?? "/").replace(/index\.html$/, "");
  return String(location?.origin ?? "") + pathname;
}

/**
 * Bỏ code / error / error_description (+ error_code) khỏi ?…, và các khóa đó + token (access_token…) khỏi #…;
 * giữ tham số khác. Phần # không có khóa đăng nhập thì giữ nguyên từng ký tự; # còn rỗng thì bỏ hẳn dấu #. Trả chuỗi.
 */
export function cleanAuthParams(url) {
  const u = new URL(String(url));
  for (const name of AUTH_PARAMS) u.searchParams.delete(name);
  // searchParams rỗng thì URL tự bỏ dấu "?"
  if (![...u.searchParams.keys()].length) u.search = "";
  const hp = hashParams(u);
  if (HASH_PARAMS.some((name) => hp.has(name))) {
    for (const name of HASH_PARAMS) hp.delete(name);
    const rest = hp.toString();
    u.hash = rest; // gán "" thì URL bỏ hẳn dấu "#"
  }
  return u.href;
}

/** Địa chỉ có tham số đăng nhập (code / error… ở ?, hoặc lỗi / token ở #) không. */
export function hasAuthParams(url) {
  const u = new URL(String(url));
  const hp = hashParams(u);
  return AUTH_PARAMS.some((name) => u.searchParams.has(name)) || HASH_PARAMS.some((name) => hp.has(name));
}

/**
 * Câu tiếng Việt khi quay về từ Google với lỗi (?error=… hoặc #error=…): hủy, hoặc email chưa có trong danh sách thử.
 * Không chép nguyên câu tiếng Anh trong địa chỉ (ai cũng sửa được địa chỉ). Không có lỗi → "".
 */
export function authErrorFromUrl(url) {
  let error;
  try {
    const u = new URL(String(url));
    const hp = hashParams(u);
    error = u.searchParams.get("error") || u.searchParams.get("error_description")
      || hp.get("error") || hp.get("error_description");
  } catch {
    return "";
  }
  if (!error) return "";
  if (error === "access_denied") {
    return "Chưa đăng nhập: đã hủy, hoặc email này chưa có trong danh sách thử của app.";
  }
  return "Đăng nhập không thành công. Thử lại sau.";
}

/** Email trong phiên đăng nhập; không có thì "". */
export function emailOf(session) {
  const email = session?.user?.email;
  return typeof email === "string" ? email : "";
}

/**
 * Chữ cho phần tử thông báo cố định #authMsg (luôn hiện, không dùng hidden, để trình đọc màn hình đọc được khi chữ
 * đổi; main.js chỉ đổi textContent, không thay phần tử). Trả chuỗi; không có lỗi / khối ẩn → "".
 */
export function authMessage(view) {
  return view?.visible ? String(view.error || "") : "";
}

/** Câu lỗi chung khi không lấy được phiên đăng nhập. */
const AUTH_FAILED = "Đăng nhập không thành công. Thử lại sau.";

/**
 * Câu lỗi sau khi hỏi phiên (getSession) xong. urlError: câu từ authErrorFromUrl (quay về từ Google với lỗi);
 * hasSession: đang có phiên; failed: getSession báo lỗi / ném lỗi.
 * Câu lỗi từ địa chỉ chỉ hiện khi CHƯA có phiên (đã đăng nhập thì không ghi "Chưa đăng nhập: …"); không có thì
 * getSession lỗi → câu lỗi chung; còn lại "".
 */
export function authErrorAfterSession({ urlError = "", hasSession = false, failed = false } = {}) {
  return (hasSession ? "" : String(urlError || "")) || (failed ? AUTH_FAILED : "");
}

/**
 * Trạng thái hiển thị của khối tài khoản.
 * state: { configured, loading, unavailable, session, error, busy }.
 * mode: "hidden" (chưa cấu hình) | "loading" | "unavailable" (không tải được thư viện) | "signedOut" | "signedIn".
 */
export function authView(state = {}) {
  const base = { visible: false, mode: "hidden", email: "", error: "", busy: false };
  if (!state?.configured) return base;
  const view = { ...base, visible: true, error: String(state.error || ""), busy: !!state.busy };
  if (state.loading) return { ...view, mode: "loading" };
  if (state.unavailable) return { ...view, mode: "unavailable" };
  if (state.session) return { ...view, mode: "signedIn", email: emailOf(state.session) };
  return { ...view, mode: "signedOut" };
}
