// Nối các phần lại: sự kiện nút bấm → scanner / API → render.
import { createScanner } from "./scanner.js";
import { getProduct, normalize } from "./off.js";
import { renderProduct, renderNotFound, renderError, renderAddForm, renderPantry, errorText, esc } from "./render.js";
import { getHistory, addHistory, getPantry, addToPantry, updatePantryItem, removeFromPantry } from "./storage.js";

const $ = (s) => document.querySelector(s);
const reader = $("#reader"), btnCam = $("#btnCam"), fileInput = $("#file");
const form = $("#manual"), codeInput = $("#codeInput"), msg = $("#msg");
const result = $("#result"), historyList = $("#historyList");
const screenLookup = $("#screenLookup"), screenPantry = $("#screenPantry");
const btnPantry = $("#btnPantry"), btnBack = $("#btnBack"), pantryCount = $("#pantryCount");
const pantryTitle = $("#pantryTitle"), pantryList = $("#pantryList"), pantryMsg = $("#pantryMsg");

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
    // Không tìm thấy vẫn cho thêm vào tủ đồ, tên để trống bắt buộc nhập (lỗi mạng / máy chủ thì không có form)
    if (!data) { result.innerHTML = renderNotFound(code) + renderAddForm({ code }); return; }
    product = normalize(data, code);
    result.innerHTML = renderProduct(product) + renderAddForm(product);
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

// ---- Tủ đồ ----
let editingId = null; // id món đang mở form sửa (null = không sửa món nào)

/** Hiện câu báo ở 1 ô (form-msg trong form, hoặc #pantryMsg); warn = tô màu cảnh báo. */
function say(el, text = "", warn = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("warn", warn);
}

/** Câu báo cho lỗi khi thêm / sửa / xóa: lỗi do nhập sai hoặc không lưu được thì có câu riêng. */
function pantryErrorText(e) {
  if (e?.name === "PantryError") {
    if (e.cause) console.error(e.cause); // lỗi gốc (vd bộ nhớ đầy) để người sửa app xem trong console
    return e.message;
  }
  console.error(e);
  return `Có lỗi bất thường, thử lại (${errorText(e)}).`;
}

function updatePantryCount(list = getPantry()) {
  pantryCount.textContent = String(list.length);
}

function showPantryList(list = getPantry()) {
  pantryList.innerHTML = renderPantry(list, { editingId });
  updatePantryCount(list);
}

/** Tìm ô của 1 món theo id (CSS.escape: id lạ có ký tự đặc biệt vẫn không làm hỏng bộ chọn). */
const itemEl = (id) => pantryList.querySelector(`li[data-id="${CSS.escape(id)}"]`);

btnPantry.addEventListener("click", async () => {
  // Đang ở màn Tủ đồ rồi: chỉ đưa focus về tiêu đề, không vẽ lại (giữ form sửa đang mở và số đang gõ)
  if (!screenPantry.hidden) { pantryTitle.focus(); return; }
  if (busy) { setMsg("Đợi mở camera hoặc đọc ảnh xong rồi hãy mở Tủ đồ.", true); return; }
  if (scanner.running) { await stopCam(); setMsg(); } // không để camera chạy ngầm khi đang xem tủ
  editingId = null;
  say(pantryMsg);
  showPantryList();
  screenLookup.hidden = true;
  screenPantry.hidden = false;
  pantryTitle.focus();
});

btnBack.addEventListener("click", () => {
  editingId = null;
  screenPantry.hidden = true;
  screenLookup.hidden = false;
  btnPantry.focus();
});

// Ủy quyền sự kiện (event delegation): 1 listener trên #result bắt submit của form "Thêm vào tủ đồ",
// vì form được tạo lại mỗi lần tra (gắn listener vào từng form thì phải gắn lại mỗi lần).
result.addEventListener("submit", (ev) => {
  const addForm = ev.target.closest("form.add-pantry");
  if (!addForm) return;
  ev.preventDefault();
  const out = addForm.querySelector(".form-msg");
  const fd = new FormData(addForm);
  try {
    const list = addToPantry({
      code: addForm.dataset.code,
      brand: addForm.dataset.brand,
      name: fd.get("name"),
      expiresOn: fd.get("expiresOn"),
      qty: fd.get("qty")
    });
    updatePantryCount(list);
    // Xóa ô hạn: chạm đúp nút sẽ không thêm 2 món giống hệt (ô hạn có required nên lần bấm sau bị
    // trình duyệt chặn; nếu bị lách thì checkDateQty vẫn chặn). Giữ tên và số lượng để thêm lô khác.
    addForm.elements.expiresOn.value = "";
    say(out, "Đã thêm vào tủ đồ. Muốn thêm lô khác thì chọn hạn mới.");
  } catch (e) {
    say(out, pantryErrorText(e), true);
  }
});

// Ủy quyền sự kiện trên danh sách tủ đồ: nút Sửa / Xóa / Hủy (click) và form sửa (submit).
pantryList.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-action]");
  const li = btn?.closest("li[data-id]");
  if (!li) return;
  const id = li.dataset.id;
  const name = li.querySelector(".pi-name")?.textContent || "món này";

  if (btn.dataset.action === "edit") {
    editingId = id;
    say(pantryMsg);
    showPantryList();
    // Đặt con trỏ vào ô số lượng, không vào ô ngày: iPhone tự bật bảng chọn ngày khi ô ngày được focus.
    itemEl(id)?.querySelector('input[name="qty"]')?.focus();
  } else if (btn.dataset.action === "cancel") {
    editingId = null;
    showPantryList();
    itemEl(id)?.querySelector('[data-action="edit"]')?.focus();
  } else if (btn.dataset.action === "delete") {
    if (!confirm(`Xóa "${name}" khỏi tủ đồ?`)) return;
    try {
      const list = removeFromPantry(id);
      if (editingId === id) editingId = null;
      showPantryList(list);
      say(pantryMsg, `Đã xóa "${name}".`);
      pantryTitle.focus();
    } catch (e) {
      say(pantryMsg, pantryErrorText(e), true);
    }
  }
});

pantryList.addEventListener("submit", (ev) => {
  const editForm = ev.target.closest("form.pantry-edit");
  if (!editForm) return;
  ev.preventDefault();
  const id = editForm.dataset.id;
  const fd = new FormData(editForm);
  try {
    const list = updatePantryItem(id, { expiresOn: fd.get("expiresOn"), qty: fd.get("qty") });
    editingId = null;
    showPantryList(list);
    say(pantryMsg, "Đã lưu thay đổi.");
    itemEl(id)?.querySelector('[data-action="edit"]')?.focus();
  } catch (e) {
    say(editForm.querySelector(".form-msg"), pantryErrorText(e), true);
  }
});

updatePantryCount();
