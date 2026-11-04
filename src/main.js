// Nối các phần lại: sự kiện nút bấm → scanner / API → render.
import { createScanner } from "./scanner.js";
import { getProduct, normalize } from "./off.js";
import { renderProduct, renderNotFound, renderError, errorText, esc } from "./render.js";
import { getHistory, addHistory } from "./storage.js";

const $ = (s) => document.querySelector(s);
const reader = $("#reader"), btnCam = $("#btnCam"), fileInput = $("#file");
const form = $("#manual"), codeInput = $("#codeInput"), msg = $("#msg");
const result = $("#result"), historyList = $("#historyList");

if (import.meta.env.VITE_APP_NAME) {
  $("#appName").textContent = import.meta.env.VITE_APP_NAME;
  document.title = import.meta.env.VITE_APP_NAME;
}

/** Hiện thông báo; detail (nếu có) là dòng chữ nhỏ bên dưới. Gọi lại thì dòng nhỏ cũ mất. */
function setMsg(text = "", warn = false, detail = "") {
  msg.textContent = text; // xóa luôn dòng nhỏ cũ
  msg.classList.toggle("warn", warn);
  if (detail) {
    const small = document.createElement("small");
    small.className = "msg-detail";
    small.textContent = detail; // textContent: chuỗi lỗi không bao giờ thành HTML
    msg.append(small);
  }
}

function placeholder(text) {
  reader.innerHTML = `<div class="idle">
<svg viewBox="0 0 280 150" aria-hidden="true" fill="none" stroke="#D8D8D0" stroke-width="3">
<path d="M4 34V4h30M246 4h30v30M276 116v30h-30M34 146H4v-30"/>
<g stroke-width="4" opacity=".55"><path d="M60 40v70M72 40v70M80 40v70M96 40v70M104 40v70M116 40v70M132 40v70M140 40v70M156 40v70M164 40v70M176 40v70M192 40v70M200 40v70M212 40v70M220 40v70"/></g>
</svg><p>${esc(text || "Camera chưa bật. Bấm “Bật camera”, đưa mã vạch vào khung.")}</p></div>`;
}

// ---- Camera ----
const scanner = createScanner("reader");

// Khóa nút trong lúc bận (đang đọc ảnh, đang mở camera): 2 việc cùng dùng camera / vùng #reader
// sẽ giẫm lên nhau (thư viện báo lỗi, hình camera bị xóa). Input #file bị disabled thì bấm nhãn
// "Chụp ảnh mã" cũng không mở chọn ảnh.
let busy = false;
function setBusy(on) {
  busy = on;
  btnCam.disabled = on;
  fileInput.disabled = on;
}

async function stopCam() {
  await scanner.stop();
  btnCam.textContent = "Bật camera";
  btnCam.classList.remove("live");
  placeholder();
}

btnCam.addEventListener("click", async () => {
  if (busy) return; // phòng xa: sự kiện tới trước khi disabled kịp có hiệu lực
  // Camera đang chạy thì nút là "Tắt camera": không khóa, bấm là tắt.
  if (scanner.running) { await stopCam(); setMsg(); return; }
  reader.innerHTML = "";
  setMsg("Đang mở camera…");
  setBusy(true); // khóa từ lúc mở camera (có thể đang chờ người dùng cho quyền) tới khi xong hoặc lỗi
  try {
    await scanner.start(async (text) => {
      await stopCam();
      if (navigator.vibrate) navigator.vibrate(60);
      lookup(text);
    });
    btnCam.textContent = "Tắt camera";
    btnCam.classList.add("live");
    setMsg("Đưa mã vạch vào khung, giữ máy yên khoảng 1–2 giây.");
  } catch (e) {
    placeholder("Không mở được camera ở đây.");
    setMsg(`Không mở được camera (${errorText(e)}). Bấm “Chụp ảnh mã” hoặc nhập số bên dưới.`, true);
  } finally {
    setBusy(false);
  }
});

// ---- Chụp ảnh mã ----
fileInput.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (busy || !file) return;
  // Đang bật camera thì tắt hẳn trước (nút về "Bật camera"), rồi mới khóa nút và đọc ảnh.
  if (scanner.running) await stopCam();
  setBusy(true);
  setMsg("Đang đọc mã trong ảnh…");
  try {
    const text = await scanner.scanImage(file);
    placeholder();
    lookup(text);
  } catch (e) {
    console.error(e);
    placeholder();
    setMsg("Không đọc được mã vạch trong ảnh. Chụp gần hơn, đủ sáng, mã nằm ngang, hoặc nhập số.", true, errorText(e));
  } finally {
    setBusy(false); // mở lại nút dù đọc được hay lỗi
  }
});

// ---- Nhập tay ----
form.addEventListener("submit", (ev) => { ev.preventDefault(); lookup(codeInput.value); });
document.querySelectorAll(".try button[data-code]").forEach((b) =>
  b.addEventListener("click", () => lookup(b.dataset.code))
);

// ---- Tra cứu ----
let current = 0;
async function lookup(raw) {
  const code = String(raw || "").replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) { setMsg("Mã vạch cần 8–14 chữ số.", true); return; }
  const id = ++current;
  codeInput.value = code;
  setMsg(`Đang tra cứu mã ${code}…`);
  result.innerHTML = "";
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });

  // (a) Gọi API: lỗi ở đây là lỗi mạng / hết giờ / máy chủ (e.kind do getProduct gắn).
  let data;
  try {
    data = await getProduct(code);
  } catch (e) {
    console.error(e);
    if (id !== current) return;
    setMsg();
    // Lỗi không có kind (ví dụ lỗi lập trình) thì báo "bất thường", không đổ cho mạng.
    result.innerHTML = renderError(code, e?.kind || "unknown", e);
    return;
  }
  if (id !== current) return;
  setMsg();

  // (b) Đổi dữ liệu + hiển thị: lỗi ở đây là do dữ liệu, không phải do mạng.
  let product;
  try {
    if (!data) { result.innerHTML = renderNotFound(code); return; }
    product = normalize(data, code);
    result.innerHTML = renderProduct(product);
  } catch (e) {
    console.error(e);
    if (id !== current) return;
    result.innerHTML = renderError(code, "display", e);
    return;
  }

  // (c) Lưu lịch sử: lỗi chỉ ghi ra console, giữ nguyên kết quả đang hiện.
  try {
    renderHistory(addHistory(code, product.name));
  } catch (e) {
    console.error(e);
  }
}

// ---- Lịch sử ----
function renderHistory(list = getHistory()) {
  if (!list.length) { historyList.innerHTML = '<li><p class="empty">Chưa quét sản phẩm nào.</p></li>'; return; }
  historyList.innerHTML = list.map((x) =>
    `<li><button type="button" data-code="${esc(x.code)}"><span>${esc(x.name)}</span><span>${esc(x.code)}</span></button></li>`
  ).join("");
  historyList.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => lookup(b.dataset.code)));
}

placeholder();
renderHistory();
