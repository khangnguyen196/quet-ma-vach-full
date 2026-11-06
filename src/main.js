// Nối các phần lại: sự kiện nút bấm → scanner / API → render.
import { createScanner } from "./scanner.js";
import { getProduct, isProductCached, normalize, cleanAllergyProfile, matchAllergies } from "./off.js";
import {
  renderProduct, renderNotFound, renderError, renderAddForm, renderPantry, errorText, esc,
  renderAllergyOptions, renderAllergyAlert, renderAllergyBox, ALLERGY_ALERT_ID,
  renderCompare, renderCompareButton, renderHistoryOptions, renderImportSummary, profileNames
} from "./render.js";
import {
  getHistory, addHistory, getPantry, addToPantry, updatePantryItem, removeFromPantry,
  getAllergyProfile, setAllergyProfile, importPantryData
} from "./storage.js";
import { buildExport, exportFileName, parseImport, IMPORT_MAX_BYTES } from "./backup.js";
import { compareWaitMs } from "./compare.js";
import { initPwa } from "./pwa.js";

initPwa(); // service worker + thanh "Đã có bản mới" (chỉ ở bản build)

const $ = (s) => document.querySelector(s);
const reader = $("#reader"), btnCam = $("#btnCam"), fileInput = $("#file");
const form = $("#manual"), codeInput = $("#codeInput"), msg = $("#msg");
const result = $("#result"), historyList = $("#historyList");
const screenLookup = $("#screenLookup"), screenPantry = $("#screenPantry");
const btnPantry = $("#btnPantry"), btnBack = $("#btnBack"), pantryCount = $("#pantryCount");
const pantryTitle = $("#pantryTitle"), pantryList = $("#pantryList"), pantryMsg = $("#pantryMsg");
const allergyProfileEl = $("#allergyProfile"), allergyOptions = $("#allergyOptions");
const allergyCount = $("#allergyCount"), allergyMsg = $("#allergyMsg");
const screenCompare = $("#screenCompare"), btnCompare = $("#btnCompare"), btnCompareBack = $("#btnCompareBack");
const compareTitle = $("#compareTitle"), compareForm = $("#compareForm"), compareMsg = $("#compareMsg");
const compareResult = $("#compareResult");
const compareCode = [$("#compareCodeA"), $("#compareCodeB")], compareHist = [$("#compareHistA"), $("#compareHistB")];
const btnExport = $("#btnExport"), importFile = $("#importFile"), importBox = $("#importBox");

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
    setMsg("Không đọc được mã vạch trong ảnh. Giữ máy cách mã 15–20 cm (gần quá iPhone không lấy nét), để mã nằm ngang và chiếm khoảng nửa khung, tránh lóa đèn. Hoặc bấm “Bật camera”, hoặc nhập số bên dưới.", true, errorText(e));
  } finally {
    setBusy(false); // mở lại nút dù đọc được hay lỗi
  }
});

// ---- Chép mã (nút cạnh "Góp sản phẩm này lên Open Food Facts", màn tra cứu và cột So sánh) ----
// Trang thêm sản phẩm của Open Food Facts không điền sẵn mã, nên cho chép mã để dán vào đó.
/** Chép bằng cách cũ: chọn chữ trong ô rồi execCommand("copy"). Trả true nếu trình duyệt báo đã chép. */
function copyBySelection(input) {
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length); // iPhone cần chọn bằng setSelectionRange
  try { return document.execCommand("copy"); } catch { return false; }
}

// Ủy quyền sự kiện: 1 listener trên <main> bắt nút Chép mã ở cả #result và #compareResult (nút được vẽ lại mỗi lần tra).
document.querySelector("main").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button.copy-code[data-code]");
  if (!btn) return;
  const code = btn.dataset.code;
  const out = btn.closest(".notfound")?.querySelector(".copy-msg");
  if (!out) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Trình duyệt không có navigator.clipboard");
    await navigator.clipboard.writeText(code);
    say(out, "Đã chép");
    return;
  } catch (e) {
    console.warn("Không chép được bằng navigator.clipboard:", e);
  }
  // Dự phòng: hiện mã trong ô chỉ đọc, chọn sẵn để người dùng tự chép (và thử execCommand("copy")).
  out.textContent = "";
  const input = document.createElement("input");
  input.className = "copy-box";
  input.readOnly = true;
  input.value = code; // gán value: mã không bao giờ thành HTML
  input.setAttribute("aria-label", "Mã vạch để chép");
  out.append(input);
  if (copyBySelection(input)) { out.textContent = ""; say(out, "Đã chép"); btn.focus(); return; }
  const note = document.createElement("span");
  note.textContent = `Không chép được, hãy tự chép mã ${code}`;
  out.prepend(note);
  out.classList.add("warn");
});

// ---- Nhập tay ----
form.addEventListener("submit", (ev) => { ev.preventDefault(); lookup(codeInput.value); });
document.querySelectorAll(".try button[data-code]").forEach((b) =>
  b.addEventListener("click", () => lookup(b.dataset.code))
);

// ---- Hồ sơ dị ứng ----
// Lựa chọn đang dùng để cảnh báo. Lưu lỗi thì vẫn giữ ở đây (cảnh báo vẫn chạy tới khi tải lại trang).
let allergyProfile = getAllergyProfile();
// Sản phẩm (đã normalize) đang hiện trong #result; null khi đang tra, không tìm thấy hoặc lỗi.
let shownProduct = null;

/** Vẽ lại CHỈ khung cảnh báo đầu kết quả (không vẽ lại cả kết quả: giữ chữ đang gõ trong form tủ đồ). */
function redrawAllergyAlert() {
  const box = document.getElementById(ALLERGY_ALERT_ID);
  if (!shownProduct || !box) return;
  box.innerHTML = renderAllergyAlert(matchAllergies(shownProduct, allergyProfile), allergyProfile.length);
}

/** Vẽ ô tick + số nhóm của khung "Hồ sơ dị ứng" theo biến allergyProfile. */
function showAllergyProfile() {
  allergyOptions.innerHTML = renderAllergyOptions(allergyProfile);
  allergyCount.textContent = String(allergyProfile.length);
}
showAllergyProfile();

// Ủy quyền sự kiện: 1 listener "change" trên cả khung bắt mọi ô tick. Tick là lưu ngay.
allergyProfileEl.addEventListener("change", (ev) => {
  if (!ev.target.matches('input[name="allergy"]')) return;
  const picked = [...allergyOptions.querySelectorAll('input[name="allergy"]:checked')].map((i) => i.value);
  allergyProfile = cleanAllergyProfile(picked);
  const n = allergyProfile.length;
  allergyCount.textContent = String(n);
  if (setAllergyProfile(allergyProfile)) {
    say(allergyMsg, `Đã lưu hồ sơ (${n} nhóm)`);
  } else {
    say(allergyMsg, "Chưa lưu được hồ sơ (bộ nhớ trình duyệt đầy hoặc bị chặn). "
      + "Cảnh báo vẫn theo lựa chọn này cho tới khi tải lại trang; tải lại trang sẽ mất lựa chọn.", true);
  }
  redrawAllergyAlert();
});

// ---- Tra cứu ----
/** Bỏ ký tự không phải số; trả null nếu không đủ 8–14 chữ số (dùng chung cho Tra cứu và So sánh). */
function cleanCode(raw) {
  const code = String(raw || "").replace(/\D/g, "");
  return code.length < 8 || code.length > 14 ? null : code;
}

let current = 0;
async function lookup(raw) {
  const code = cleanCode(raw);
  if (!code) { setMsg("Mã vạch cần 8–14 chữ số.", true); return; }
  const id = ++current;
  codeInput.value = code;
  setMsg(`Đang tra cứu mã ${code}…`);
  shownProduct = null; // kết quả cũ bị xóa ngay dưới đây: đổi hồ sơ lúc này không vẽ gì
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
    // Khung cảnh báo dị ứng ngay đầu kết quả (trước <article>); hồ sơ 0 nhóm thì khung rỗng.
    result.innerHTML = renderAllergyBox(matchAllergies(product, allergyProfile), allergyProfile.length)
      + renderProduct(product) + renderCompareButton(product.code) + renderAddForm(product);
    shownProduct = product;
  } catch (e) {
    console.error(e);
    if (id !== current) return;
    shownProduct = null;
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

// ---- Đổi màn (Tra cứu / Tủ đồ / So sánh) ----
// name: tên màn trong câu báo; title: chỗ đặt focus; onShow: vẽ lại màn ngay trước khi hiện.
const SCREENS = {
  lookup: { el: screenLookup, name: "Tra cứu" },
  pantry: { el: screenPantry, name: "Tủ đồ", title: pantryTitle, onShow: () => { say(pantryMsg); hideImport(); showPantryList(); } },
  compare: { el: screenCompare, name: "So sánh", title: compareTitle, onShow: () => showCompareScreen() }
};

/**
 * Chuyển sang 1 màn. focusEl: chỗ đặt focus sau khi chuyển (mặc định là tiêu đề của màn).
 * Trả false nếu không chuyển được (đang mở camera / đọc ảnh).
 */
async function showScreen(key, focusEl) {
  const target = SCREENS[key];
  // Đang ở màn đó rồi: chỉ đưa focus về tiêu đề, không vẽ lại (giữ form sửa đang mở và số đang gõ)
  if (!target.el.hidden) { (focusEl || target.title)?.focus(); return true; }
  if (busy) { setMsg(`Đợi mở camera hoặc đọc ảnh xong rồi hãy mở ${target.name}.`, true); return false; }
  if (scanner.running) { await stopCam(); setMsg(); } // không để camera chạy ngầm khi đang ở màn khác
  editingId = null; // đóng form sửa tủ đồ
  target.onShow?.();
  for (const s of Object.values(SCREENS)) s.el.hidden = s !== target;
  (focusEl || target.title)?.focus();
  return true;
}

btnPantry.addEventListener("click", () => showScreen("pantry"));
btnBack.addEventListener("click", () => showScreen("lookup", btnPantry));

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

// ---- Xuất / nhập tủ đồ (file JSON, chuyển giữa các máy; không gửi dữ liệu đi đâu) ----
btnExport.addEventListener("click", () => {
  const now = new Date();
  const data = buildExport(getPantry(), allergyProfile, now);
  const name = exportFileName(now);
  // Blob + thẻ <a download>: trình duyệt tải file về máy (iPhone mở bảng để lưu vào Tệp).
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Thu hồi địa chỉ tạm sau khi bấm; chờ một lúc để trình duyệt (nhất là Safari) kịp đọc file.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  say(pantryMsg, `Đã tạo file ${name}: ${data.pantry.length} món, ${data.allergyProfile.length} nhóm dị ứng.`);
});

let pendingImport = null; // dữ liệu file vừa đọc, chờ chọn Gộp / Thay toàn bộ / Hủy

function hideImport() {
  pendingImport = null;
  importBox.hidden = true;
  importBox.innerHTML = "";
}

importFile.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = ""; // chọn lại đúng file đó lần sau vẫn có sự kiện change
  if (!file) return;
  hideImport();
  if (file.size > IMPORT_MAX_BYTES) { say(pantryMsg, "File quá lớn (tối đa 1 MB).", true); return; }
  let text;
  try {
    text = await file.text();
  } catch (e) {
    console.error(e);
    say(pantryMsg, `Không đọc được file (${errorText(e)}).`, true);
    return;
  }
  try {
    pendingImport = parseImport(text);
  } catch (e) {
    if (e?.name !== "ImportError") console.error(e);
    say(pantryMsg, e?.name === "ImportError" ? e.message : `Không đọc được file (${errorText(e)}).`, true);
    return;
  }
  importBox.innerHTML = renderImportSummary(pendingImport);
  importBox.hidden = false;
  say(pantryMsg, "Chọn cách nhập: gộp vào tủ hiện tại hoặc thay toàn bộ.");
  importBox.querySelector("button")?.focus();
});

importBox.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-import]");
  if (!btn || !pendingImport) return;
  const mode = btn.dataset.import;
  if (mode === "cancel") { hideImport(); say(pantryMsg, "Đã hủy nhập."); btnExport.focus(); return; }
  const data = pendingImport;
  if (mode === "replace") {
    const count = getPantry().length;
    const ok = confirm(`Thay toàn bộ tủ đồ? Tủ hiện có ${count} món sẽ bị thay bằng ${data.pantry.length} món trong file `
      + `(tủ cũ được chép bản dự phòng trên máy này trước khi thay). `
      + `Hồ sơ dị ứng sẽ thành: ${profileNames(data.allergyProfile)}.`);
    if (!ok) return;
  }
  let r;
  try {
    r = importPantryData(data, mode, allergyProfile);
  } catch (e) {
    say(pantryMsg, pantryErrorText(e), true); // không ghi được: không báo thành công
    return;
  }
  hideImport();
  // Vẽ lại mọi chỗ dùng tủ đồ / hồ sơ: danh sách, số ở nút Tủ đồ, ô tick + số nhóm, khung cảnh báo màn tra cứu.
  allergyProfile = r.allergyProfile; // lưu hồ sơ lỗi vẫn dùng trong phiên này (như khi tick)
  showAllergyProfile();
  redrawAllergyAlert();
  editingId = null;
  showPantryList(r.pantry);
  let text = mode === "merge"
    ? `Đã gộp: thêm ${r.added} món, ${r.kept} món đã có nên giữ nguyên. Hồ sơ dị ứng: ${r.allergyProfile.length} nhóm.`
    : `Đã thay tủ đồ: ${r.pantry.length} món${r.backupKey ? " (tủ cũ đã chép bản dự phòng)" : ""}. Hồ sơ dị ứng: ${r.allergyProfile.length} nhóm.`;
  if (!r.profileSaved) text = "Đã nhập tủ đồ nhưng chưa lưu được hồ sơ dị ứng (bộ nhớ trình duyệt đầy hoặc bị chặn). " + text;
  say(pantryMsg, text, !r.profileSaved);
  pantryTitle.focus();
});

// ---- So sánh 2 sản phẩm ----
// Kết quả lần so sánh gần nhất: [bên A, bên B] (sản phẩm đã normalize, hoặc "không tìm thấy" / lỗi).
// Mỗi lần mở màn So sánh thì vẽ lại từ đây theo hồ sơ dị ứng hiện tại (không gọi mạng).
let lastCompare = null;
let compareTurn = 0; // số thứ tự lượt so sánh, như biến current của lookup(): lượt cũ về muộn thì bỏ

function drawCompare() {
  compareResult.innerHTML = lastCompare ? renderCompare(lastCompare, allergyProfile) : "";
}

/** Vẽ lại màn So sánh khi mở: danh sách "đã quét gần đây" mới nhất + kết quả cũ theo hồ sơ hiện tại. */
function showCompareScreen() {
  let list = [];
  try { list = getHistory(); } catch (e) { console.error(e); }
  for (const sel of compareHist) {
    sel.innerHTML = renderHistoryOptions(list);
    sel.disabled = !list.length;
  }
  drawCompare();
}

btnCompare.addEventListener("click", () => showScreen("compare"));
btnCompareBack.addEventListener("click", () => showScreen("lookup", btnCompare));

// Nút "So sánh với sản phẩm khác" dưới kết quả tra: mở màn So sánh, điền sẵn mã vào bên A.
result.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-compare-code]");
  if (!btn) return;
  const code = btn.dataset.compareCode;
  if (await showScreen("compare", compareCode[1])) {
    compareCode[0].value = code;
    // Ô A đã là mã mới: bỏ kết quả so sánh cũ (và lượt so sánh đang chạy dở) để người dùng không tưởng là của mã mới.
    ++compareTurn;
    lastCompare = null;
    compareResult.innerHTML = "";
    say(compareMsg);
  }
});

// Chọn từ "đã quét gần đây" thì điền mã vào ô của bên đó, rồi đưa ô chọn về dòng đầu.
compareHist.forEach((sel, i) => sel.addEventListener("change", () => {
  if (!sel.value) return;
  compareCode[i].value = sel.value;
  sel.value = "";
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Màn So sánh gọi Open Food Facts cách nhau ít nhất 1 giây, kể cả 2 lượt khác nhau (bấm So sánh liên tiếp).
// Lần lấy từ cache trong bộ nhớ (isProductCached) không gọi mạng nên không tính.
const COMPARE_GAP_MS = 1000;
let lastCompareCallAt = null; // thời điểm (Date.now) lần gọi mạng gần nhất của màn So sánh

/**
 * Tra 1 bên cho lượt so sánh id: cần gọi mạng thì chờ đủ khoảng giãn trước; trong lúc chờ mà lượt đã đổi
 * (người dùng bấm So sánh lần nữa) thì thôi, KHÔNG gọi mạng, trả null.
 */
async function fetchSideSpaced(code, id) {
  if (!isProductCached(code)) {
    for (let wait = compareWaitMs(lastCompareCallAt, Date.now(), COMPARE_GAP_MS); wait > 0;
      wait = compareWaitMs(lastCompareCallAt, Date.now(), COMPARE_GAP_MS)) {
      await sleep(wait);
      if (id !== compareTurn) return null;
    }
    if (id !== compareTurn) return null;
    if (!isProductCached(code)) lastCompareCallAt = Date.now();
  }
  return fetchSide(code);
}

/** Tra 1 bên để so sánh (KHÔNG thêm vào lịch sử). Không ném lỗi: lỗi trả về dạng { status: "error" }. */
async function fetchSide(code) {
  let data;
  try {
    data = await getProduct(code);
  } catch (e) {
    console.error(e);
    return { code, status: "error", kind: e?.kind || "unknown", error: e };
  }
  if (!data) return { code, status: "notfound" };
  try {
    return { code, status: "ok", product: normalize(data, code) };
  } catch (e) {
    console.error(e);
    return { code, status: "error", kind: "display", error: e };
  }
}

compareForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const codes = compareCode.map((input) => cleanCode(input.value));
  const bad = codes.findIndex((c) => !c);
  if (bad !== -1) {
    say(compareMsg, `Mã vạch sản phẩm ${bad ? "B" : "A"} cần 8–14 chữ số.`, true);
    compareCode[bad].focus();
    return;
  }
  if (codes[0] === codes[1]) { say(compareMsg, "Hai mã giống nhau, nhập mã khác cho một bên.", true); return; }
  codes.forEach((c, i) => { compareCode[i].value = c; });

  const id = ++compareTurn;
  lastCompare = null;
  compareResult.innerHTML = "";
  // Tra LẦN LƯỢT (không song song). 2 lần gọi mạng của màn So sánh luôn cách nhau >= 1 giây (fetchSideSpaced),
  // lượt cũ đã bị thay thì không gọi tiếp.
  say(compareMsg, `Đang tra cứu mã ${codes[0]}…`);
  const sideA = await fetchSideSpaced(codes[0], id);
  if (!sideA || id !== compareTurn) return;
  say(compareMsg, `Đang tra cứu mã ${codes[1]}…`);
  const sideB = await fetchSideSpaced(codes[1], id);
  if (!sideB || id !== compareTurn) return;

  lastCompare = [sideA, sideB];
  say(compareMsg);
  drawCompare();
});
