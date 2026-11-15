// Nối các phần lại: sự kiện nút bấm → scanner / API → render.
import { createScanner } from "./scanner.js";
import { getProduct, isProductCached, normalize, cleanAllergyProfile, matchAllergies } from "./off.js";
import {
  renderProduct, renderNotFound, renderError, renderAddForm, renderPantry, errorText, esc,
  renderAllergyOptions, renderAllergyAlert, renderAllergyBox, ALLERGY_ALERT_ID,
  renderCompare, renderCompareButton, renderHistoryOptions, renderImportSummary, profileNames, renderAuthBox,
  FRONT_TEXT_ID, renderPhotoShell, renderPhotoDone, renderPhotoOthers, renderPhotoNone, renderFrontEdit,
  PHOTO_CONFIRM_ID, PHOTO_NONE_ID
} from "./render.js";
import {
  ocrServerUrl, prepareImage, sendOcr, frontButtonState, after401View, frontErrorView, afterResultScroll, frontPickBlock,
  photoOutcome, photoMessage, photoFollowMessage, isUnconfirmed, confirmStatusText, confirmAction, OFF_WAIT_TEXT
} from "./front-photo.js";
import { loadT1, loadCatalog, t1ModuleUrl } from "./front-search.js";
import { buildRankIndex, rankFromItems, rankFromText } from "./front-rank.js";
import { mergeFront, joinOffResults, isGuardError } from "./front-merge.js";
import { createOffSearch, cleanQuery } from "./off-search.js";
import { authConfig, redirectUrl, cleanAuthParams, hasAuthParams, authErrorFromUrl, authView, authMessage, authErrorAfterSession } from "./auth.js";
import {
  getHistory, addHistory, getPantry, addToPantry, updatePantryItem, removeFromPantry,
  getAllergyProfile, setAllergyProfile, importPantryData, isAllergyProfileKey
} from "./storage.js";
import { buildExport, exportFileName, parseImport, IMPORT_MAX_BYTES } from "./backup.js";
import { compareWaitMs } from "./compare.js";
import { initPwa } from "./pwa.js";
import { cameraControls, nextZoom, zoomLabel } from "./camera.js";

initPwa(); // service worker + thanh "Đã có bản mới" (chỉ ở bản build)

const $ = (s) => document.querySelector(s);
const reader = $("#reader"), btnCam = $("#btnCam"), fileInput = $("#file");
const camTools = $("#camTools"), btnTorch = $("#btnTorch"), btnZoom = $("#btnZoom");
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

// ---- Đèn pin / phóng to (đợt nhay-hon): chỉ hiện khi máy hỗ trợ (cameraControls trong src/camera.js) ----
let torchOn = false;
let zoomState = null; // { levels, current } khi có nút phóng to

/** Đọc khả năng của camera đang chạy rồi hiện nút đèn / phóng to (máy không hỗ trợ thì không hiện gì). */
function showCamTools() {
  const { caps, settings } = scanner.trackInfo();
  const c = cameraControls(caps, settings);
  torchOn = false;
  zoomState = c.zoom;
  btnTorch.hidden = !c.torch;
  btnTorch.textContent = "Bật đèn";
  btnTorch.setAttribute("aria-pressed", "false");
  btnZoom.hidden = !c.zoom;
  if (c.zoom) btnZoom.textContent = zoomLabel(c.zoom.levels, c.zoom.current);
  camTools.hidden = !c.torch && !c.zoom;
}

function hideCamTools() {
  camTools.hidden = true;
  btnTorch.hidden = true;
  btnZoom.hidden = true;
  torchOn = false;
  zoomState = null;
}

btnTorch.addEventListener("click", async () => {
  if (!scanner.running) return;
  const want = !torchOn;
  try {
    await scanner.applyTrack({ torch: want });
    torchOn = want;
    btnTorch.textContent = want ? "Tắt đèn" : "Bật đèn";
    btnTorch.setAttribute("aria-pressed", String(want));
  } catch (e) {
    setMsg(`Máy không đổi được đèn pin (${errorText(e)}).`, true);
  }
});

btnZoom.addEventListener("click", async () => {
  if (!scanner.running || !zoomState) return;
  const next = nextZoom(zoomState.levels, zoomState.current);
  try {
    await scanner.applyTrack({ zoom: next });
    zoomState.current = next;
    btnZoom.textContent = zoomLabel(zoomState.levels, next);
  } catch (e) {
    setMsg(`Máy không phóng to được (${errorText(e)}).`, true);
  }
});

async function stopCam() {
  hideCamTools();
  await scanner.stop();
  btnCam.textContent = "Bật camera";
  btnCam.classList.remove("live");
  placeholder();
}

btnCam.addEventListener("click", async () => {
  if (busy) return; // phòng xa: sự kiện tới trước khi disabled kịp có hiệu lực
  // Camera đang chạy thì nút là "Tắt camera": không khóa, bấm là tắt.
  if (scanner.running) { await stopCam(); setMsg(); return; }
  await startCam();
});

/**
 * Bật camera (nút "Bật camera" và nút "Quét mã vạch" của "Chụp mặt trước" cùng gọi hàm này). Phải gọi NGAY trong sự kiện
 * bấm (getUserMedia chạy trước lần chờ đầu tiên), để trình duyệt (nhất là iPhone) cho mở camera.
 */
async function startCam() {
  reader.innerHTML = "";
  setMsg("Đang mở camera…");
  setBusy(true); // khóa từ lúc mở camera (có thể đang chờ người dùng cho quyền) tới khi xong hoặc lỗi
  try {
    await scanner.start(async (text) => {
      await stopCam();
      if (navigator.vibrate) navigator.vibrate(60);
      lookup(text);
    });
    // start() có thể trả về mà camera không chạy (vd đã ra mã ngay khung đầu, onCode đã tắt camera): khi đó nút giữ
    // "Bật camera" và khung về như lúc tắt, không ghi đè lời nhắn đang có.
    if (scanner.running) {
      btnCam.textContent = "Tắt camera";
      btnCam.classList.add("live");
      showCamTools();
      setMsg("Đưa mã vạch vào khung, giữ máy yên khoảng 1–2 giây.");
    } else {
      placeholder();
    }
  } catch (e) {
    placeholder("Không mở được camera ở đây.");
    setMsg(`Không mở được camera (${errorText(e)}). Bấm “Chụp ảnh mã” hoặc nhập số bên dưới.`, true);
  } finally {
    setBusy(false);
  }
}

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

// ---- Chép mã (nút cạnh "Góp sản phẩm này lên Open Food Facts" ở màn tra cứu và cột So sánh, nút cạnh
// "Bổ sung trên Open Food Facts" dưới sản phẩm thiếu thông tin) ----
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
  // .copy-area: khung không tìm thấy (renderNotFound) và khối Bổ sung (renderProduct) đều có class này
  const out = btn.closest(".copy-area")?.querySelector(".copy-msg");
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
// Sản phẩm TỰ MỞ từ ảnh đang chờ bấm "Đúng" (đợt tu-dong vòng 4): { code, lookupId, top, others } hoặc null.
// Đặt khi lookup(…, { photo }); xóa khi bấm "Đúng", khi tra mã khác không từ ảnh, khi chọn ảnh mới, khi đăng xuất.
let photoPending = null;
// Số lượt lookup đã vẽ sản phẩm đang hiện (shownProduct); 0 khi không có. Cờ "chưa xác nhận" so lượt này với
// photoPending.lookupId (vòng 5, gợi ý 2 vòng 4: không so mã).
let shownLookupId = 0;
// #frontMsg đang là câu KẾT QUẢ của "Chụp mặt trước" (sau khi tìm xong) chứ không phải câu tiến độ / lỗi gửi ảnh.
let frontMsgIsResult = false;

/** Vẽ lại CHỈ khung cảnh báo đầu kết quả (không vẽ lại cả kết quả: giữ chữ đang gõ trong form tủ đồ).
 *  Còn "chưa xác nhận" thì giữ dòng nhắc (đổi hồ sơ / đổi ở tab khác cũng vậy). */
function redrawAllergyAlert() {
  const box = document.getElementById(ALLERGY_ALERT_ID);
  if (!shownProduct || !box) return;
  box.innerHTML = renderAllergyAlert(matchAllergies(shownProduct, allergyProfile), allergyProfile.length,
    { unconfirmed: isUnconfirmed(photoPending, shownLookupId) });
}

/** Mã sản phẩm đang hiện mà còn "chưa xác nhận" (tự mở từ ảnh), không thì null: màn So sánh thêm dòng nhắc cho mã này. */
function unconfirmedShownCode() {
  return shownProduct && isUnconfirmed(photoPending, shownLookupId) ? shownProduct.code : null;
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

// Mở app ở 2 tab: tab kia đổi hồ sơ → tab này đọc lại, vẽ lại ô tick + khung cảnh báo của kết quả đang hiện
// (và màn So sánh nếu đang mở). Không gọi mạng, không vẽ lại cả kết quả (giữ chữ đang gõ).
// Sự kiện "storage" chỉ bắn ở tab KHÁC tab vừa ghi.
window.addEventListener("storage", (ev) => {
  try {
    if (ev.storageArea && ev.storageArea !== localStorage) return; // sessionStorage: không liên quan
    if (!isAllergyProfileKey(ev.key)) return;
    allergyProfile = getAllergyProfile();
    showAllergyProfile();
    say(allergyMsg, `Hồ sơ đã đổi ở tab khác (${allergyProfile.length} nhóm)`);
    redrawAllergyAlert();
    if (!screenCompare.hidden) drawCompare();
  } catch (e) {
    console.warn("Không cập nhật được hồ sơ dị ứng từ tab khác:", e);
  }
});

// ---- Tra cứu ----
/** Bỏ ký tự không phải số; trả null nếu không đủ 8–14 chữ số (dùng chung cho Tra cứu và So sánh). */
function cleanCode(raw) {
  const code = String(raw || "").replace(/\D/g, "");
  return code.length < 8 || code.length > 14 ? null : code;
}

/**
 * Cuộn tới el (đợt chup-mat-gon vòng 2): cuộn mượt, trừ khi máy bật "giảm chuyển động" (prefers-reduced-motion) thì
 * nhảy thẳng. scrollIntoView do code gọi không tự theo cài đặt đó. Không có matchMedia thì cuộn mượt như cũ.
 * Ví dụ: scrollToEl(result, "nearest").
 */
function scrollToEl(el, block) {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}

let current = 0;
/**
 * Tra một mã trên Open Food Facts rồi vẽ trang sản phẩm vào #result.
 * opts.photo (đợt tu-dong vòng 4): { top, others } của photoOutcome khi "Chụp mặt trước" TỰ MỞ mục 1: #result có khung
 * "Nhận ra tự động từ ảnh, có thể nhầm…" ở đầu (vẽ ngay, trước khi gọi mạng), trang sản phẩm vẽ vào .photo-body, khối
 * dị ứng kèm dòng "chưa xác nhận", KHÔNG lưu lịch sử (bấm "Đúng" mới lưu), không tự cuộn (người gọi cuộn tới khung).
 * Không có opts.photo (quét / nhập mã / lịch sử / gợi ý khác): như cũ, và xóa trạng thái "chưa xác nhận".
 */
async function lookup(raw, { photo = null } = {}) {
  const code = cleanCode(raw);
  if (!code) { setMsg("Mã vạch cần 8–14 chữ số.", true); return; }
  const id = ++current;
  photoPending = photo ? { code, lookupId: id, top: photo.top, others: photo.others || [] } : null;
  // Tra không từ ảnh (quét / nhập mã / lịch sử / mã mẫu / gợi ý khác): câu kết quả "Chụp mặt trước" không còn nói về
  // trang đang hiện → xóa (vòng 5, NÊN SỬA 1 vòng 4). Câu tiến độ của lượt ảnh đang chạy (vd "Đang gửi ảnh…") giữ.
  if (!photo && frontMsgIsResult) {
    const m = photoFollowMessage("notPhoto");
    sayFront(m.text, m.warn);
  }
  codeInput.value = code;
  setMsg(`Đang tra cứu mã ${code}…`);
  shownProduct = null; // kết quả cũ bị xóa ngay dưới đây: đổi hồ sơ lúc này không vẽ gì
  shownLookupId = 0;
  // Lượt tự mở lấy trang lỗi / không có trên OFF → #frontMsg báo đúng (không để câu "Đã tìm xong…" một mình).
  const openFailed = () => {
    if (!photo || photoPending?.lookupId !== id) return;
    const m = photoFollowMessage("openFailed");
    sayFront(m.text, m.warn, true);
  };
  let out = result; // nơi vẽ trang sản phẩm / lỗi
  if (photo) {
    result.innerHTML = renderPhotoShell(photo.top);
    bindFrontImages(result);
    out = result.querySelector(".photo-body") || result;
  } else {
    result.innerHTML = "";
    scrollToEl(result, "nearest");
  }

  // (a) Gọi API: lỗi ở đây là lỗi mạng / hết giờ / máy chủ (e.kind do getProduct gắn).
  let data;
  try {
    data = await getProduct(code);
  } catch (e) {
    console.error(e);
    if (id !== current) return;
    setMsg();
    // Lỗi không có kind (ví dụ lỗi lập trình) thì báo "bất thường", không đổ cho mạng.
    // Tự mở từ ảnh: khung (tên / ảnh từ kết quả gộp) vẫn ở trên, "Không, xem gợi ý khác" vẫn dùng được.
    out.innerHTML = renderError(code, e?.kind || "unknown", e);
    openFailed();
    return;
  }
  if (id !== current) return;
  setMsg();

  // (b) Đổi dữ liệu + hiển thị: lỗi ở đây là do dữ liệu, không phải do mạng.
  let product;
  try {
    // Không tìm thấy vẫn cho thêm vào tủ đồ, tên để trống bắt buộc nhập (lỗi mạng / máy chủ thì không có form)
    if (!data) { out.innerHTML = renderNotFound(code) + renderAddForm({ code }); openFailed(); return; }
    product = normalize(data, code);
    // OFF có thể trả mã viết khác mã đã tra (vd thêm / bỏ số 0 đầu): giữ mã của sản phẩm đang hiện (màn So sánh dùng).
    if (photo && photoPending?.lookupId === id) photoPending.code = product.code;
    // Khung cảnh báo dị ứng ngay đầu kết quả (trước <article>); hồ sơ 0 nhóm thì khung rỗng (trừ khi chưa xác nhận).
    // Cờ "chưa xác nhận" theo LƯỢT tra (id), không theo mã (vòng 5).
    out.innerHTML = renderAllergyBox(matchAllergies(product, allergyProfile), allergyProfile.length,
      { unconfirmed: isUnconfirmed(photoPending, id) })
      + renderProduct(product) + renderCompareButton(product.code) + renderAddForm(product);
    shownProduct = product;
    shownLookupId = id;
  } catch (e) {
    console.error(e);
    if (id !== current) return;
    shownProduct = null;
    shownLookupId = 0;
    out.innerHTML = renderError(code, "display", e);
    openFailed();
    return;
  }

  // (c) Lưu lịch sử: lỗi chỉ ghi ra console, giữ nguyên kết quả đang hiện.
  // Tự mở từ ảnh (chưa xác nhận): KHÔNG lưu, bấm "Đúng" mới lưu (confirmPhoto).
  if (!photo) {
    try {
      renderHistory(addHistory(code, product.name));
    } catch (e) {
      console.error(e);
    }
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
  // Sản phẩm tự mở từ ảnh còn chưa xác nhận: khối dị ứng ở So sánh cũng có dòng nhắc (vòng 5, gợi ý 6 vòng 4).
  compareResult.innerHTML = lastCompare ? renderCompare(lastCompare, allergyProfile, { unconfirmedCode: unconfirmedShownCode() }) : "";
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
let lastCompareCallAt = null; // thời điểm (performance.now) lần gọi mạng gần nhất của màn So sánh

/**
 * Tra 1 bên cho lượt so sánh id: cần gọi mạng thì chờ đủ khoảng giãn trước; trong lúc chờ mà lượt đã đổi
 * (người dùng bấm So sánh lần nữa) thì thôi, KHÔNG gọi mạng, trả null.
 */
async function fetchSideSpaced(code, id) {
  if (isProductCached(code)) return fetchSide(code);
  for (let wait = compareWaitMs(lastCompareCallAt, performance.now(), COMPARE_GAP_MS); wait > 0;
    wait = compareWaitMs(lastCompareCallAt, performance.now(), COMPARE_GAP_MS)) {
    await sleep(wait);
    if (id !== compareTurn) return null;
  }
  if (id !== compareTurn) return null;
  const needsNetwork = !isProductCached(code);
  const pending = fetchSide(code); // fetch() được gọi ngay (đồng bộ) bên trong fetchSide → getProduct
  // Ghi thời điểm SAU khi request đã đi: lần gọi kế chắc chắn cách request này >= 1 giây (Playwright đo được 999 ms
  // khi ghi trước lúc gọi).
  if (needsNetwork) lastCompareCallAt = performance.now();
  return pending;
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

// ---- Tài khoản: đăng nhập Google qua Supabase (đợt dang-nhap) ----
// KHÔNG bắt buộc: mọi tính năng ở trên chạy như cũ khi chưa đăng nhập / không tải được thư viện.
// Thiếu biến VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY → không hiện khối, không tải thư viện.
// Thư viện @supabase/supabase-js chỉ import động khi có biến; chỉ dùng phần auth.
const authBox = $("#authBox");
const authBody = $("#authBody"); // vẽ lại theo trạng thái
const authMsg = $("#authMsg"); // dòng thông báo cố định, luôn hiện (không hidden): chỉ đổi chữ, không bao giờ thay phần tử
// Vite thay 2 biến này bằng chuỗi cố định lúc build: thiếu biến thì điều kiện luôn sai và Rollup bỏ hẳn
// import("@supabase/supabase-js") (bản build không có file thư viện nào). authConfig() vẫn kiểm kỹ (https…) lúc chạy.
const loadSupabase = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  ? () => import("@supabase/supabase-js")
  : null;
// main.js không truyền cả object env; plugin build chặn mọi biến VITE_* chứa khóa bí mật.
const authCfg = loadSupabase
  ? authConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  })
  : null;
if (loadSupabase && !authCfg) {
  // có biến nhưng sai (URL không https, hoặc dán nhầm khóa BÍ MẬT sb_secret_ / service_role): không bật đăng nhập
  console.warn("Đăng nhập: biến VITE_SUPABASE_* không hợp lệ (cần URL https và publishable key, không phải khóa bí mật). Bỏ qua đăng nhập.");
}
let authClient = null;
let authState = { configured: !!authCfg, loading: true, unavailable: false, session: null, error: "", busy: false };
const authListeners = new Set(); // khu thử dev (dev-ocr.js) nghe đăng nhập / đăng xuất

function setAuth(patch) {
  authState = { ...authState, ...patch };
  const view = authView(authState);
  authBody.innerHTML = renderAuthBox(view);
  const msg = authMessage(view);
  if (authMsg.textContent !== msg) authMsg.textContent = msg; // chữ không đổi thì không đọc lại
  authBox.hidden = !authCfg;
  for (const fn of authListeners) {
    try { fn(!!authState.session); } catch (e) { console.error(e); }
  }
  updateFrontButton(); // nút "Chụp mặt trước" theo trạng thái đăng nhập
}

async function initAuth() {
  if (!authCfg) { authBox.hidden = true; return; }
  const urlError = authErrorFromUrl(location.href); // quay về từ Google với lỗi (hủy, email không trong danh sách thử)
  setAuth({});
  let createClient;
  try {
    ({ createClient } = await loadSupabase());
  } catch (e) {
    console.error(e);
    setAuth({ loading: false, unavailable: true, error: "Không tải được phần đăng nhập (kiểm tra mạng rồi tải lại trang)." });
    // Không đổi được mã nữa: vẫn xóa ?code= / ?error= / #access_token… khỏi thanh địa chỉ.
    if (hasAuthParams(location.href)) history.replaceState(history.state, "", cleanAuthParams(location.href));
    return;
  }
  try {
    authClient = createClient(authCfg.url, authCfg.key, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
    });
    // Không gọi hàm supabase khác bên trong callback này (thư viện khuyên vậy để tránh kẹt khóa).
    // Vừa đăng nhập xong / mở trang đã có phiên thì xóa câu lỗi cũ (vd lần trước hủy đăng nhập). Sự kiện khác
    // (TOKEN_REFRESHED…) giữ câu lỗi (vd "Chưa đăng xuất được").
    authClient.auth.onAuthStateChange((event, session) => {
      const clearError = session && (event === "SIGNED_IN" || event === "INITIAL_SESSION");
      setAuth(clearError ? { loading: false, session, error: "" } : { loading: false, session });
    });
    // getSession() chờ thư viện đổi ?code= lấy phiên (detectSessionInUrl) xong mới trả về.
    // Thứ tự với INITIAL_SESSION không chắc, nhưng kết quả như nhau: có phiên thì không có câu lỗi;
    // chưa có phiên thì sự kiện không xóa câu lỗi (điều kiện clearError ở trên), câu lỗi do
    // authErrorAfterSession đặt.
    const { data, error } = await authClient.auth.getSession();
    if (error) console.warn("Đăng nhập:", error);
    const session = data?.session ?? null;
    setAuth({
      loading: false,
      session,
      error: authErrorAfterSession({ urlError, hasSession: !!session, failed: !!error })
    });
  } catch (e) {
    console.error(e);
    setAuth({ loading: false, session: null, error: authErrorAfterSession({ urlError, hasSession: false, failed: true }) });
  } finally {
    // Đổi mã xong (thành công hay lỗi) mới xóa ?code= / ?error= khỏi thanh địa chỉ, giữ tham số khác.
    if (hasAuthParams(location.href)) history.replaceState(history.state, "", cleanAuthParams(location.href));
  }
}

// Số lần người dùng TỰ bấm "Đăng xuất" (đợt chup-mat-gon): "Chụp mặt trước" nhớ số này từ lúc chọn ảnh; gặp 401 mà
// số đã đổi thì lượt đó bị bỏ (không câu lệch, không làm mới phiên). Thư viện tự đăng xuất thì số không đổi.
let manualSignOuts = 0;

authBox.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-auth]");
  if (!btn || !authClient || authState.busy) return;
  if (btn.dataset.auth === "logout") manualSignOuts++;
  setAuth({ busy: true, error: "" });
  try {
    if (btn.dataset.auth === "login") {
      // Chuyển sang trang Google; quay về đúng trang app (Pages hoặc https://localhost:5173/).
      const { error } = await authClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectUrl(location) } });
      if (error) throw error;
      return; // trình duyệt đang chuyển trang: giữ nút ở trạng thái bận
    }
    // scope "local": chỉ đăng xuất trên máy / trình duyệt này, máy khác vẫn giữ phiên
    const { error } = await authClient.auth.signOut({ scope: "local" });
    if (error) throw error;
    setAuth({ busy: false, session: null });
  } catch (e) {
    console.error(e);
    setAuth({ busy: false, error: btn.dataset.auth === "login" ? "Không mở được trang đăng nhập Google. Thử lại sau." : "Chưa đăng xuất được. Thử lại sau." });
  }
});

// Bấm "Quay lại" từ trang Google: trình duyệt (nhất là Safari / Chrome điện thoại) lấy lại trang từ bộ nhớ (bfcache)
// kèm busy = true, nút "Đăng nhập bằng Google" sẽ mờ mãi. Trang hiện lại từ bộ nhớ thì mở khóa nút.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && authState.busy) setAuth({ busy: false });
});

// ---- Chụp mặt trước (đợt chup-mat): ảnh mặt trước → máy chủ OCR (cần đăng nhập) → T1 → tối đa 5 gợi ý ----
// Không đọc ảnh trên máy (chỉ thu nhỏ rồi gửi), không lấy dị ứng từ ảnh: thông tin + dị ứng luôn tra theo mã trên OFF.
// T1 (public/chup-mat-do/t1.mjs) và danh mục (danh-muc-vn.json) chỉ tải ở lần chọn ảnh đầu tiên được gửi đi: sau khi
// thu nhỏ ảnh (prepareImage) và sau câu hỏi gửi nguyên bản; bấm "Không gửi" thì không tải (xem loadFrontSearch).
// Đợt tu-dong vòng 4: sau T1, TỰ tìm thêm trên Open Food Facts (search.pl, src/off-search.js, một bộ cho cả phiên: cache
// + ≤ 10 lượt / phút), gộp (mergeFront mặc định, lớp chặn DEFAULT_GUARD), rồi TỰ MỞ mục 1 kèm khung xác nhận
// (showPhotoResult). OFF lỗi / hết giờ / bị giới hạn → kết quả danh mục.
let offSearchOne = null;
/** MỘT bộ tìm OFF cho cả phiên (tạo ở lần tìm đầu: mở app không đụng tới localStorage / mạng). */
function offSearch() {
  if (!offSearchOne) offSearchOne = createOffSearch();
  return offSearchOne;
}
const frontLabel = $("#frontLabel"), frontFile = $("#frontFile"), btnFrontLogin = $("#btnFrontLogin");
const frontInfo = $("#frontInfo"), frontHint = $("#frontHint"), frontMsg = $("#frontMsg");
const frontRelogin = $("#frontRelogin"), btnFrontRelogin = $("#btnFrontRelogin"), frontBox = $("#frontBox");
// Chỉ đưa 2 biến cần dùng (không truyền cả object env). Trống = máy chủ trên Azure (OCR_DEFAULT_URL).
const ocrPick = ocrServerUrl({
  VITE_OCR_SERVER_URL: import.meta.env.VITE_OCR_SERVER_URL,
  VITE_OCR_DEV_URL: import.meta.env.VITE_OCR_DEV_URL
});
if (ocrPick.warning) console.warn(ocrPick.warning);

/**
 * Dòng trạng thái của "Chụp mặt trước": chỉ đổi chữ (textContent), chữ máy chủ không bao giờ thành HTML.
 * Câu bị xóa / thay thì nút "Tới phần đăng nhập" ẩn theo (nút chỉ đi kèm câu lỗi 401; chỗ hiện nút gọi SAU sayFront).
 * isResult: câu là KẾT QUẢ tìm (lookup không từ ảnh sẽ xóa câu này), không phải câu tiến độ / lỗi gửi ảnh.
 */
function sayFront(text = "", warn = false, isResult = false) {
  frontMsg.textContent = text;
  frontMsg.classList.toggle("warn", warn);
  frontRelogin.hidden = true;
  frontMsgIsResult = isResult && text !== "";
}

/** Hiện nút theo frontButtonState(authState): hidden / loading / login / ready. */
function updateFrontButton() {
  const st = frontButtonState(authState);
  frontInfo.hidden = st === "hidden";
  frontLabel.hidden = st !== "ready";
  // Đang đăng xuất (authState.busy, vd thư viện phải làm mới phiên qua mạng trước khi xóa): khóa ô chọn ảnh (đợt cung-co).
  // setAuth gọi lại hàm này mỗi khi busy đổi; sự kiện chọn ảnh vẫn kiểm lại (frontPickBlock) vì bảng chọn ảnh có thể đã mở.
  frontFile.disabled = st !== "ready" || authState.busy;
  btnFrontLogin.hidden = st !== "login" && st !== "loading";
  btnFrontLogin.disabled = st === "loading";
  btnFrontLogin.textContent = st === "loading" ? "Đang kiểm đăng nhập…" : "Đăng nhập để dùng";
  frontHint.hidden = st !== "login";
  // Không ẩn "Tới phần đăng nhập" khi st === "ready" (đợt chup-mat-gon): TOKEN_REFRESHED gọi lại hàm này trong lúc câu
  // lỗi 401 còn hiện. Nút ẩn khi chọn ảnh mới, khi câu bị xóa / thay (sayFront) hoặc khi thành login / hidden (dưới).
  // Đăng xuất / hết phiên / không có đăng nhập: dọn như lúc ẩn (hủy lượt đang gửi, xóa gợi ý của người trước).
  // loading → ready không dọn.
  if (st === "hidden" || st === "login") {
    ++frontTurn;
    frontAbort?.abort();
    sayFront();
    frontBox.hidden = true;
    frontBox.innerHTML = "";
    clearPhotoResult(); // đợt tu-dong vòng 4: sản phẩm tự mở chưa xác nhận / "Chưa tìm thấy…" của người trước
  }
}

/**
 * Xóa kết quả "Chụp mặt trước" đang ở #result (sản phẩm tự mở CHƯA xác nhận, hoặc khối "Chưa tìm thấy…") và hủy lượt
 * tra đang chạy của nó. Sản phẩm đã bấm "Đúng" / tra bình thường thì giữ. Gọi khi chọn ảnh mới và khi đăng xuất.
 */
function clearPhotoResult() {
  if (!photoPending && !document.getElementById(PHOTO_NONE_ID)) return;
  ++current; // lượt lookup tự mở đang chờ mạng (nếu có) về muộn thì bỏ
  photoPending = null;
  shownProduct = null;
  shownLookupId = 0;
  result.innerHTML = "";
  setMsg();
}

/**
 * Cuộn tới khối tài khoản, đặt focus vào nút "Đăng nhập bằng Google"; đang có phiên thì nút "Đăng xuất";
 * không có nút nào thì chính khối (tabindex="-1"). KHÔNG mở chọn ảnh, KHÔNG gửi gì.
 */
function goToLogin() {
  scrollToEl(authBox, "center");
  const btn = authBody.querySelector('button[data-auth="login"]') || authBody.querySelector('button[data-auth="logout"]');
  (btn || authBox).focus?.({ preventScroll: true });
}
btnFrontLogin.addEventListener("click", goToLogin);
btnFrontRelogin.addEventListener("click", goToLogin);

let frontTurn = 0; // số lượt chọn ảnh, như biến current của lookup(): lượt cũ về muộn thì bỏ (đăng xuất cũng tăng)
let frontPicks = 0; // chỉ đếm số lần chọn ảnh (đăng xuất không tăng): dùng sau khi làm mới phiên lúc gặp 401
let frontAbort = null; // AbortController của lượt đang gửi (chọn ảnh khác thì hủy)
// Lượt frontTurn của "Tìm lại" ĐANG CHẠY (vòng 6, NÊN SỬA 3 vòng 5); 0 khi không có. Bấm "Đúng" lúc còn chạy thì hủy.
let retryTurn = 0;
let frontSearch = null; // { t1, products, rIndex } khi đã tải xong (dùng cho "Tìm lại")
let frontSearchPromise = null;
let frontT1Tries = 0;

/**
 * Tải T1 + danh mục (lần đầu dùng tính năng), dựng chỉ mục BM25. Giữ promise; lỗi thì xóa để lần sau tải lại
 * (import() lỗi có thể bị trình duyệt nhớ, nên lần thử lại thêm ?lan=N vào địa chỉ T1).
 */
function loadFrontSearch() {
  if (frontSearch) return Promise.resolve(frontSearch);
  if (!frontSearchPromise) {
    const n = frontT1Tries++;
    const t1Url = t1ModuleUrl() + (n ? `?lan=${n}` : "");
    const p = Promise.all([
      loadT1(t1Url).catch((e) => {
        console.error(e);
        throw new Error("Không tải được bộ tìm sản phẩm (mất mạng?). Chọn ảnh lại để thử lại.");
      }),
      loadCatalog()
    ]).then(([t1, catalog]) => {
      // Chỉ mục xếp hạng của src/front-rank.js (mặc định cho đúng gợi ý như T1 cũ, kèm idfSum cho điểm tin cậy)
      frontSearch = { t1, products: catalog.products, rIndex: buildRankIndex(t1, catalog.products) };
      return frontSearch;
    });
    frontSearchPromise = p;
    p.catch(() => { if (frontSearchPromise === p) frontSearchPromise = null; });
  }
  return frontSearchPromise;
}

/** Ảnh sản phẩm (class front-img) trong el tải lỗi thì thay bằng "chưa có ảnh" (phần tử ngay sau ảnh). */
function bindFrontImages(el) {
  el.querySelectorAll("img.front-img").forEach((img) => img.addEventListener("error", () => {
    img.hidden = true;
    if (img.nextElementSibling) img.nextElementSibling.hidden = false;
  }, { once: true }));
}

/**
 * Đợt tu-dong vòng 4: kết quả T1 (found: rankFromItems / rankFromText) → tìm thêm trên OFF → gộp → TỰ MỞ mục 1 (khung
 * xác nhận) hoặc "Chưa tìm thấy…". Luôn hiện khung "có thể nhầm" (CONFIDENCE_RULE của front-rank.js = luôn không chắc).
 * id: lượt frontTurn; lookupMark: số lượt lookup lúc bắt đầu (quét / nhập mã / bấm lịch sử trong lúc chờ → bỏ, không tự
 * mở); fromRetry: "Tìm lại" (không cuộn, không vẽ lại ô sửa chữ).
 */
async function showPhotoResult({ id, lookupMark, s, found, fromRetry = false, reencoded }) {
  const stale = () => id !== frontTurn || current !== lookupMark;
  // Vòng 5 (gợi ý 1 vòng 4): đã chọn ảnh khác / tra mã khác trong lúc chờ máy chủ OCR → thôi, KHÔNG gọi Open Food Facts.
  if (stale()) {
    if (id === frontTurn) sayFront();
    return;
  }
  // Câu tìm làm sạch như khung đo vòng 3 (≤ 2 câu = ≤ 2 lượt, chạy song song, mỗi lượt hết giờ SEARCH_TIMEOUT_MS).
  const queries = cleanQuery(found.lines, { idf: s.rIndex.index.idf });
  let off = { ok: false, kind: "none" };
  if (queries.length) {
    const ctrl = new AbortController(); // chọn ảnh khác / đăng xuất thì hủy (frontAbort)
    frontAbort = ctrl;
    sayFront(OFF_WAIT_TEXT);
    const os = offSearch();
    off = joinOffResults(await Promise.all(queries.map((q) => os.search(q, { signal: ctrl.signal }))));
    if (frontAbort === ctrl) frontAbort = null;
  }
  if (stale()) {
    if (id === frontTurn) sayFront(); // bỏ vì đã tra mã khác: xóa câu "Đang tìm…"
    return;
  }
  let merged;
  try {
    merged = mergeFront(s.t1, s.rIndex, s.products, found, off); // lớp chặn mặc định (không truyền lockTop / offMax)
  } catch (e) {
    // Chỉ lỗi "giá trị chặn sai" mới quay về kết quả T1 (vòng 5, gợi ý 3 vòng 4); lỗi khác ném tiếp cho nơi gọi.
    if (!isGuardError(e)) throw e;
    console.error(e);
    merged = mergeFront(s.t1, s.rIndex, s.products, found, null); // = đúng kết quả T1
  }
  const outcome = photoOutcome(merged);
  if (!fromRetry) {
    frontBox.innerHTML = renderFrontEdit({ lines: found.lines, reencoded });
    frontBox.hidden = false;
  }
  const note = photoMessage({ kind: outcome.kind, offFailed: queries.length > 0 && !off.ok });
  sayFront(note.text, note.warn, true);
  if (outcome.kind === "open") {
    lookup(outcome.top.code, { photo: outcome }); // vẽ khung NGAY (trước khi gọi mạng), trang sản phẩm vẽ sau
  } else {
    ++current; // lượt tra đang chạy (nếu có) về muộn thì bỏ
    photoPending = null;
    shownProduct = null;
    shownLookupId = 0; // như clearPhotoResult (vòng 6, gợi ý 4 vòng 5)
    setMsg();
    result.innerHTML = renderPhotoNone({ lines: found.lines });
  }
  // Lần chọn ảnh (không phải "Tìm lại"): cuộn ít nhất để khung xác nhận / câu "Chưa tìm thấy…" hiện trong màn hình.
  const to = afterResultScroll({ kind: outcome.kind, fromRetry });
  const target = to === "confirm" ? document.getElementById(PHOTO_CONFIRM_ID) : to === "none" ? document.getElementById(PHOTO_NONE_ID) : null;
  if (target) scrollToEl(target, "nearest");
}

/** "Đúng": bỏ dòng chưa xác nhận, thu gọn khung, báo qua role="status", lưu lịch sử. Trang chưa tải được → tra lại mã
 *  như người dùng tự chọn (lưu lịch sử khi xong). */
function confirmPhoto() {
  const p = photoPending;
  if (!p) return;
  // Vòng 6 (NÊN SỬA 3 vòng 5): "Tìm lại" còn chạy → hủy lượt đó (không để nó tự mở sản phẩm khác sau khi đã xác nhận).
  // Không có "Tìm lại": chỉ đổi #frontMsg khi đang là câu kết quả (giữ câu tiến độ của lượt khác).
  // Chọn ảnh mới thì clearPhotoResult đã xóa khung cũ (photoPending = null) nên không bấm được "Đúng" của ảnh cũ.
  const act = confirmAction({ retryRunning: retryTurn !== 0 && retryTurn === frontTurn, msgIsResult: frontMsgIsResult });
  if (act.cancelRetry) {
    frontAbort?.abort();
    ++frontTurn;
    retryTurn = 0;
  }
  if (!shownProduct || shownLookupId !== p.lookupId || p.lookupId !== current) { lookup(p.code); return; }
  photoPending = null;
  redrawAllergyAlert();
  // #frontMsg không còn nhắc kiểm tra sau khi đã xác nhận (vòng 5, NÊN SỬA 1 vòng 4).
  if (act.setMsg) {
    const m = photoFollowMessage("confirmed");
    sayFront(m.text, m.warn);
  }
  // Lưu TRƯỚC, câu báo theo kết quả (vòng 5, gợi ý 5 vòng 4): addHistory nuốt lỗi ghi (storage.js) nên đọc lại để biết.
  let saved = false;
  try {
    renderHistory(addHistory(shownProduct.code, shownProduct.name));
    saved = getHistory().some((x) => x.code === shownProduct.code);
  } catch (e) {
    console.error(e);
  }
  const box = document.getElementById(PHOTO_CONFIRM_ID);
  if (box) {
    const ask = box.querySelector(".photo-ask");
    if (ask) ask.outerHTML = renderPhotoDone(p.top);
    const others = box.querySelector(".photo-others");
    if (others) { others.hidden = true; others.innerHTML = ""; }
    box.focus({ preventScroll: true }); // nút vừa bấm đã mất: giữ focus trong khung
    const status = box.querySelector(".photo-status");
    if (status) status.textContent = confirmStatusText(saved);
  }
}

/** "Không, xem gợi ý khác": hiện tối đa 4 mục còn lại + khối "Không chắc chắn…" + 3 nút cũ. */
function showPhotoOthers(btn) {
  const p = photoPending;
  const box = document.getElementById("photoOthers");
  if (!p || !box) return;
  box.innerHTML = renderPhotoOthers(p.others);
  box.hidden = false;
  bindFrontImages(box);
  btn.setAttribute("aria-expanded", "true");
  // Danh sách mở ra ngay dưới 2 nút, thường ở mép dưới màn hình: cuộn ít nhất để mục đầu (hoặc khối) hiện trọn.
  const first = box.querySelector("button[data-front-code]") || box.querySelector(".front-unsure");
  if (first) scrollToEl(first, "nearest");
}

/**
 * Bấm trong #result / #frontBox (ủy quyền sự kiện): "Đúng" / "Không, xem gợi ý khác", gợi ý khác (data-front-code: tra
 * mã như người dùng tự chọn), 3 nút cũ ("Quét mã vạch", "Nhập số mã"; "Góp sản phẩm" là link thường), "Tìm lại".
 */
function onFrontClick(ev) {
  if (ev.target.closest("button[data-photo-yes]")) { confirmPhoto(); return; }
  const no = ev.target.closest("button[data-photo-no]");
  if (no) { showPhotoOthers(no); return; }
  const pick = ev.target.closest("button[data-front-code]");
  if (pick) { lookup(pick.dataset.frontCode); return; } // không tự chọn thay người dùng: chỉ khi bấm
  const act = ev.target.closest("button[data-front-action]");
  if (act) {
    if (act.dataset.frontAction === "scan") {
      // Bật camera NGAY trong sự kiện bấm (như nút "Bật camera"), rồi cuộn tới khung camera. App đang bận (mở camera /
      // đọc ảnh mã) thì không bật, chỉ cuộn và nhắc ở #frontMsg (chỉ đổi chữ).
      if (busy) sayFront("App đang bận, chờ xong rồi bấm Quét mã vạch lại.", true);
      else if (!scanner.running) startCam();
      scrollToEl(reader, "center");
    } else if (act.dataset.frontAction === "code") {
      scrollToEl(codeInput, "center");
      codeInput.focus({ preventScroll: true });
    }
    return;
  }
  if (!ev.target.closest("button[data-front-retry]") || !frontSearch) return;
  // "Tìm lại": chữ trong ô → cùng luồng (T1 + OFF cùng bộ tìm, có cache / giới hạn), không cuộn.
  const text = frontBox.querySelector(`#${FRONT_TEXT_ID}`)?.value || "";
  frontAbort?.abort();
  const id = ++frontTurn;
  retryTurn = id;
  showPhotoResult({ id, lookupMark: current, s: frontSearch, found: rankFromText(frontSearch.t1, frontSearch.rIndex, text), fromRetry: true })
    .catch((e) => { console.error(e); if (id === frontTurn) sayFront("Có lỗi khi tìm lại. Thử lại.", true); })
    .finally(() => { if (retryTurn === id) retryTurn = 0; });
}

frontFile.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = ""; // chọn lại đúng ảnh đó lần sau vẫn có sự kiện change
  if (!file) return;
  // Chặn trước khi làm gì (đợt cung-co): đang đăng xuất thì chỉ nhắc chờ: không gửi, không làm mới phiên, không tải
  // T1 / danh mục (manualSignOuts đã tăng nên nhánh 401 bên dưới không còn nhận ra lần đăng xuất này).
  // `!authClient` kiểm riêng, thẳng ở đây: bản build không có biến Supabase thì bundler bỏ hẳn phần dưới (nhỏ hơn ~14 KB).
  if (!authClient) { goToLogin(); return; }
  const block = frontPickBlock({ buttonState: frontButtonState(authState), appBusy: busy, authBusy: authState.busy });
  if (block === "login") { goToLogin(); return; }
  if (block === "authBusy") { sayFront("Đang đăng xuất, chờ xong rồi chọn ảnh lại.", true); return; }
  if (block === "appBusy") { sayFront("Đợi mở camera hoặc đọc ảnh mã xong rồi hãy chụp mặt trước.", true); return; }
  const outs = manualSignOuts; // nhớ NGAY lúc chọn ảnh: bấm Đăng xuất lúc ảnh đang gửi thì nhánh 401 thấy số đã đổi
  if (scanner.running) { await stopCam(); setMsg(); } // như "Chụp ảnh mã": tắt camera trước

  frontAbort?.abort(); // lượt cũ đang gửi: hủy
  const ctrl = new AbortController();
  frontAbort = ctrl;
  const id = ++frontTurn;
  const pick = ++frontPicks;
  const stale = () => id !== frontTurn;
  frontBox.hidden = true;
  frontBox.innerHTML = "";
  clearPhotoResult(); // sản phẩm tự mở chưa xác nhận / "Chưa tìm thấy…" của ảnh trước
  const lookupMark = current; // quét / nhập mã / bấm lịch sử trong lúc chờ → không tự mở (showPhotoResult)
  sayFront("Đang chuẩn bị ảnh…");

  const prep = await prepareImage(file);
  if (stale()) return;
  if (!prep.ok) { sayFront(prep.message, true); return; }
  if (prep.reencoded === false
    && !confirm("Không thu nhỏ được ảnh này trên máy, ảnh sẽ được gửi nguyên bản và có thể kèm thông tin vị trí chụp. Vẫn gửi?")) {
    sayFront("Chưa gửi ảnh. Có thể chụp lại hoặc chọn ảnh JPEG / PNG khác.");
    return; // bấm "Không gửi": không tải gì, không gửi gì
  }

  // Lần đầu dùng tính năng: tải T1 + danh mục song song với lúc gửi ảnh (không tải lúc mở app, không tải khi
  // người dùng bấm "Không gửi" ở trên).
  const searchReady = loadFrontSearch();
  searchReady.catch(() => {}); // lỗi xử lý ở dưới (tránh cảnh báo promise bị bỏ)

  // Token lấy NGAY lúc gửi (thư viện tự làm mới), chỉ giữ trong lượt này, không ghi ra console.
  let token = "";
  try {
    const { data } = await authClient.auth.getSession();
    token = data?.session?.access_token || "";
  } catch (e) {
    console.warn("Chụp mặt trước: không lấy được phiên đăng nhập", e?.name || "");
  }
  if (stale()) return;

  sayFront("Đang gửi ảnh tới máy chủ đọc chữ…");
  const r = await sendOcr({
    base: ocrPick.url,
    token,
    blob: prep.blob,
    signal: ctrl.signal,
    onSlow: () => { if (!stale()) sayFront("Máy chủ đang khởi động, có thể mất khoảng 15 giây…"); }
  });
  token = "";
  if (stale()) return;
  if (frontAbort === ctrl) frontAbort = null;
  if (!r.ok) {
    if (r.kind === "auth" && authClient) {
      // 401: thử làm mới phiên ĐÚNG 1 lần; KHÔNG tự gửi lại ảnh (không tốn thêm lượt máy chủ). Làm mới lỗi thì thư viện
      // có thể tự đăng xuất (SIGNED_OUT → updateFrontButton dọn và tăng frontTurn), nên ở đây xét frontPicks (chọn ảnh
      // khác) và manualSignOuts so với số nhớ từ lúc chọn ảnh (outs: người dùng TỰ bấm Đăng xuất từ lúc chọn ảnh, kể cả
      // khi đăng xuất xong chậm hơn lúc 401 về): một trong hai đổi thì bỏ lượt, không câu, không nút (after401View).
      // Hết phiên chỉ còn nút "Đăng nhập để dùng". Không ghi token / phiên ra console.
      const view = (signedIn) => after401View({ samePick: pick === frontPicks, manualSignOut: manualSignOuts !== outs, signedIn });
      // bỏ lượt mà vẫn là lượt chọn ảnh mới nhất (vd bấm Đăng xuất nhưng đăng xuất lỗi): xóa câu đang hiện
      const drop = () => { if (pick === frontPicks) sayFront(); };
      // Đã bấm Đăng xuất từ lúc chọn ảnh: bỏ lượt NGAY, không làm mới phiên (đo bằng Playwright: refreshSession trong
      // lúc thư viện đang đăng xuất làm phiên sống lại sau SIGNED_OUT).
      if (view(false).skip) { drop(); return; }
      sayFront("Đang kiểm lại phiên đăng nhập…");
      try {
        await authClient.auth.refreshSession();
      } catch (e) {
        console.warn("Chụp mặt trước: không làm mới được phiên đăng nhập", e?.name || "");
      }
      if (view(false).skip) { drop(); return; }
      let signedIn = false;
      try {
        const { data } = await authClient.auth.getSession();
        signedIn = !!data?.session;
      } catch (e) {
        console.warn("Chụp mặt trước: không đọc được phiên đăng nhập", e?.name || "");
      }
      const v = view(signedIn);
      if (v.skip) { drop(); return; }
      sayFront(v.text, true);
      frontRelogin.hidden = !v.showRelogin;
      return;
    }
    const err = frontErrorView(r);
    sayFront(err.text, true);
    frontRelogin.hidden = !err.showRelogin;
    return;
  }

  sayFront("Đang tìm sản phẩm khớp…");
  let s;
  try {
    s = await searchReady;
  } catch (e) {
    if (stale()) return;
    sayFront(e?.message || "Không tải được danh mục sản phẩm. Chọn ảnh lại để thử lại.", true);
    return;
  }
  if (stale()) return;
  // Đợt tu-dong vòng 4: tìm thêm trên OFF, gộp, TỰ MỞ mục 1 (khung xác nhận) hoặc "Chưa tìm thấy…", cuộn tới đó.
  // (Đợt chup-mat-gon / cung-co: màn 360×740 thì kết quả nằm dưới mép màn hình, nên cuộn ÍT NHẤT tới khung, block
  // "nearest"; không đổi focus.)
  // Vòng 5 (NÊN SỬA 2 vòng 4): lỗi bất ngờ khi tìm / gộp / vẽ không để dòng trạng thái kẹt ở "Đang tìm thêm…".
  try {
    await showPhotoResult({ id, lookupMark, s, found: rankFromItems(s.t1, s.rIndex, r.items), fromRetry: false, reencoded: prep.reencoded });
  } catch (e) {
    console.error(e);
    if (id === frontTurn) sayFront("Có lỗi khi tìm sản phẩm. Chọn ảnh lại.", true);
  }
});

// Ủy quyền sự kiện: #result (khung xác nhận, gợi ý khác, "Chưa tìm thấy…") và #frontBox (ô sửa chữ + "Tìm lại").
result.addEventListener("click", onFrontClick);
frontBox.addEventListener("click", onFrontClick);

updateFrontButton();
initAuth();

// Khu thử máy chủ OCR: CHỈ khi chạy dev (npm run dev). Bản build bỏ hẳn đoạn này và file dev-ocr.js.
if (import.meta.env.DEV) {
  import("./dev-ocr.js").then((m) => m.initDevOcr({
    anchor: authBox,
    async getAccessToken() {
      if (!authClient) return "";
      const { data } = await authClient.auth.getSession();
      return data?.session?.access_token || "";
    },
    onAuthChange(fn) { authListeners.add(fn); fn(!!authState.session); }
  })).catch((e) => console.error(e));
}
