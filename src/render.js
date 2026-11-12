// Tạo HTML cho phần kết quả. Mọi dữ liệu từ API đều qua esc().
import { NOVA_VI, NUTRIENT_ROWS, NO_NAME, ALLERGEN_VI, ALLERGEN_KEYS, matchAllergies } from "./off.js";
import { compareRows } from "./compare.js";
import { daysLeft, expiryStatus, expiryText, formatDate, sortPantry, QTY_MAX, YEAR_MIN, YEAR_MAX } from "./pantry.js";

// Giới hạn năm của ô chọn ngày, khớp với kiểm tra ở storage.js (checkDateQty vẫn kiểm lại khi lưu).
const DATE_MIN = `${YEAR_MIN}-01-01`;
const DATE_MAX = `${YEAR_MAX}-12-31`;

export const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Đổi lỗi bất kỳ thành 1 dòng chữ để hiện cho người dùng (dòng nhỏ dưới câu báo lỗi).
 * Thư viện quét có khi ném chuỗi, có khi ném Event (ảnh hỏng) thay vì Error.
 */
export function errorText(e) {
  if (e == null) return "Không có thông tin lỗi";
  if (typeof e === "string") return e;
  if (typeof Event !== "undefined" && e instanceof Event) return `Event: ${e.type}`;
  if (e instanceof Error || (typeof e === "object" && e.name)) {
    return e.message ? `${e.name}: ${e.message}` : String(e.name);
  }
  // Object thường chỉ có message (không có name), ví dụ { message: "x" }: lấy message, tránh "[object Object]".
  if (typeof e === "object" && typeof e.message === "string" && e.message) return e.message;
  return String(e);
}

// ---- Hồ sơ dị ứng (giai đoạn 3) ----
// Không bao giờ ghi sản phẩm là "an toàn": dữ liệu Open Food Facts do cộng đồng nhập, có thể thiếu.

/** Câu khi allergens_tags rỗng / thiếu (hiện cả ở khung đầu kết quả và ở mục "Chất gây dị ứng"). */
export const ALLERGY_NO_DATA = "Open Food Facts chưa có dữ liệu dị ứng cho sản phẩm này, hãy đọc nhãn trên bao bì.";

/** Câu khi có dữ liệu dị ứng mà không trùng nhóm nào trong hồ sơ (không khung đỏ, không khung vàng). */
export const ALLERGY_NEUTRAL = "Dữ liệu Open Food Facts không ghi nhóm nào trong hồ sơ của bạn. "
  + "Dữ liệu có thể thiếu hoặc ghi khác tên, hãy đọc nhãn trên bao bì.";

/** id của khung cảnh báo đầu kết quả: main.js tìm khung này để vẽ lại khi đổi hồ sơ. */
export const ALLERGY_ALERT_ID = "allergyAlert";

/** Tên tiếng Việt của danh sách khóa nhóm, nối bằng ", " (đã escape). */
const allergenNames = (keys) => keys.map((k) => esc(ALLERGEN_VI[k])).join(", ");

/**
 * 14 ô tick của khung "Hồ sơ dị ứng" (thứ tự ALLERGEN_KEYS). selected: các khóa đang chọn.
 * Mỗi ô nằm trong <label> để bấm vào chữ cũng tick được.
 */
export function renderAllergyOptions(selected = []) {
  const on = new Set(selected);
  return ALLERGEN_KEYS.map((k) =>
    `<label class="allergy-option"><input type="checkbox" name="allergy" value="${esc(k)}"${on.has(k) ? " checked" : ""}> ${esc(ALLERGEN_VI[k])}</label>`
  ).join("");
}

/**
 * Phần bên trong khung cảnh báo đầu kết quả, từ kết quả matchAllergies() của off.js.
 * profileLength = số nhóm trong hồ sơ; 0 nhóm thì trả "" (không hiện gì).
 * - danger có → khung đỏ (role="alert");
 * - traces có → khung vàng "Có thể lẫn vết";
 * - noData → câu thiếu dữ liệu trong khung xám riêng (có thể đi cùng khung vàng);
 * - có dữ liệu, không đỏ, không vàng → dòng trung tính.
 */
export function renderAllergyAlert(match, profileLength) {
  if (!profileLength) return "";
  const { danger = [], traces = [], noData = false } = match || {};
  let html = "";
  if (danger.length) {
    html += `<p class="allergy-alert danger" role="alert"><strong>Cảnh báo dị ứng:</strong> có ${allergenNames(danger)} (nhóm trong hồ sơ của bạn)</p>`;
  }
  if (traces.length) {
    html += `<p class="allergy-alert traces"><strong>Có thể lẫn vết:</strong> ${allergenNames(traces)} (nhóm trong hồ sơ của bạn)</p>`;
  }
  if (noData) {
    // Khung riêng (nền + viền, không đỏ / vàng): hàng Việt Nam hay thiếu dữ liệu dị ứng, câu này cần nổi hơn dòng trung tính.
    html += `<p class="allergy-alert nodata">${esc(ALLERGY_NO_DATA)}</p>`;
  } else if (!danger.length && !traces.length) {
    html += `<p class="allergy-note">${esc(ALLERGY_NEUTRAL)}</p>`;
  }
  return html;
}

/** Khung có id riêng chứa renderAllergyAlert(), đặt ngay đầu kết quả (trước <article>). */
export function renderAllergyBox(match, profileLength) {
  return `<div id="${ALLERGY_ALERT_ID}" class="allergy-box">${renderAllergyAlert(match, profileLength)}</div>`;
}

/**
 * Số dinh dưỡng theo kiểu Việt Nam (dấu phẩy thập phân). Số từ 1 trở lên: tối đa 1 chữ số thập phân (2,46 → "2,5").
 * Số khác 0 nhỏ hơn 1: giữ 2 chữ số có nghĩa để không thành "0" (muối 0,04 → "0,04"; 0,333 → "0,33").
 */
const fmt = (v) => {
  const n = Number(v);
  return n !== 0 && Math.abs(n) < 1
    ? n.toLocaleString("vi-VN", { maximumSignificantDigits: 2 })
    : n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
};

/** Dòng "Nhãn: giá trị" dưới tên sản phẩm; trống thì ghi "chưa có dữ liệu". */
const metaRow = (label, value) =>
  `<p class="meta"><span class="k">${esc(label)}:</span> ${value ? esc(value) : '<span class="empty">chưa có dữ liệu</span>'}</p>`;

/** Dòng "nhãn: giá trị", bỏ qua nếu trống. */
const infoRow = (label, value) =>
  value ? `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>` : "";

// ---- Khi Open Food Facts thiếu thông tin (đợt nhay-hon) ----

/** Tên miền ảnh của Open Food Facts được hiện ảnh nhãn. */
const LABEL_IMAGE_HOSTS = ["images.openfoodfacts.org", "static.openfoodfacts.org"];

/**
 * Địa chỉ ảnh nhãn (thành phần, bảng dinh dưỡng) dùng được, hoặc "" nếu không dùng được.
 * Chỉ nhận: new URL() đọc được, https:, tên miền đúng images.openfoodfacts.org hoặc static.openfoodfacts.org
 * (không nhận tên miền con lạ, không tên đăng nhập, không cổng riêng). Trả địa chỉ đã chuẩn hóa (url.href).
 * Ví dụ: labelImageUrl("https://images.openfoodfacts.org/a.jpg") → "https://images.openfoodfacts.org/a.jpg";
 * labelImageUrl("http://images.openfoodfacts.org/a.jpg") → "".
 */
export function labelImageUrl(value) {
  if (typeof value !== "string" || !value) return "";
  let url;
  try { url = new URL(value); } catch { return ""; }
  if (url.protocol !== "https:" || !LABEL_IMAGE_HOSTS.includes(url.hostname)) return "";
  if (url.username || url.password || url.port) return "";
  return url.href;
}

/**
 * Ảnh nhãn khi chưa có chữ: câu "Chưa ai nhập chữ, xem ảnh nhãn" + ảnh bấm mở tab mới (để phóng to).
 * Ảnh tải lỗi: ẩn cả khối, hiện câu thiếu dữ liệu cũ (fallbackHtml) ngay sau nó.
 */
function labelPhoto(url, alt, fallbackHtml) {
  const u = esc(url);
  return `<div class="label-photo"><p class="label-photo-note">Chưa ai nhập chữ, xem ảnh nhãn (bấm vào ảnh để phóng to).</p>
<a href="${u}" target="_blank" rel="noopener"><img src="${u}" loading="lazy" alt="${esc(alt)}" onerror="var b=this.closest('.label-photo');b.hidden=true;b.nextElementSibling.hidden=false"></a></div>${fallbackHtml.replace(/^<p /, "<p hidden ")}`;
}

/**
 * Khối "Bổ sung trên Open Food Facts" khi thiếu tên, số dinh dưỡng hoặc thành phần; đủ cả 3 thì "".
 * Link mở trang sản phẩm trên Open Food Facts (người dùng đăng nhập ở đó để sửa) + nút Chép mã như khung
 * không tìm thấy (cùng class copy-area để main.js tìm vùng báo .copy-msg).
 */
function renderContribute(p) {
  const missing = [];
  if (p.name === NO_NAME) missing.push("tên sản phẩm");
  if (!p.hasNutriments) missing.push("số dinh dưỡng");
  if (!p.ingredients) missing.push("thành phần");
  if (!missing.length) return "";
  const c = esc(p.code);
  return `<div class="contribute-box copy-area"><h3>Bổ sung trên Open Food Facts</h3>
<p>Open Food Facts còn thiếu ${esc(missing.join(", "))} của sản phẩm này. Bạn có thể tự bổ sung trên trang sản phẩm (cần tài khoản Open Food Facts).</p>
<p class="contribute"><a class="btn" href="https://world.openfoodfacts.org/product/${esc(encodeURIComponent(p.code))}" target="_blank" rel="noopener">Bổ sung trên Open Food Facts</a>
<button type="button" class="btn copy-code" data-code="${c}">Chép mã</button></p>
<p class="copy-msg" role="status" aria-live="polite"></p></div>`;
}

export function renderProduct(p) {
  // Chỉ nhận ảnh https:// (chặn "javascript:", "http://"…); không đúng thì coi như không có ảnh.
  const hasImage = typeof p.image === "string" && p.image.startsWith("https://");
  // Ảnh nhãn chỉ hiện khi chưa có chữ và địa chỉ hợp lệ (labelImageUrl)
  const ingredientsPhoto = p.ingredients ? "" : labelImageUrl(p.imageIngredients);
  const nutritionPhoto = p.hasNutriments ? "" : labelImageUrl(p.imageNutrition);
  const noNutrition = '<p class="src">Sản phẩm này chưa được ai nhập bảng dinh dưỡng.</p>';
  const noIngredients = '<p class="empty">Chưa có dữ liệu thành phần.</p>';

  const rows = NUTRIENT_ROWS.map(([key, label, unit, cls]) => {
    const v = p.nutriments[key];
    return `<tr class="${cls}"><td>${esc(label)}</td><td>${v == null ? '<span class="empty">—</span>' : fmt(v) + " " + unit}</td></tr>`;
  }).join("");

  const ns = ["a", "b", "c", "d", "e"]
    .map((g) => `<b class="${g}${p.nutriscore === g ? " on" : ""}">${g.toUpperCase()}</b>`).join("");
  const nsText = p.nutriscore
    ? `Chất lượng dinh dưỡng: ${p.nutriscore.toUpperCase()} (A tốt nhất, E kém nhất)`
    : "Chưa đủ dữ liệu để tính điểm";

  const chips = (list, cls = "") => list.map((x) => `<span class="chip ${cls}">${esc(x)}</span>`).join("");

  // Giai đoạn 2: xuất xứ / sản xuất / bảo quản – chỉ hiện dòng có dữ liệu, cả khối trống thì ẩn.
  // Ngoại lệ có chủ đích với quy tắc 'chưa có dữ liệu' của CLAUDE.md: PLAN mục 2 yêu cầu trường trống thì ẩn.
  const extra = infoRow("Xuất xứ nguyên liệu", p.origins)
    + infoRow("Nơi sản xuất", p.manufacturingPlaces)
    + infoRow("Nước bán", p.countries)
    + infoRow("Bảo quản", p.storage)
    + infoRow("Cách dùng", p.preparation)
    + infoRow("Nhãn chứng nhận", p.labels)
    + infoRow("Bao bì", p.packaging);

  return `
<article class="label">
  <div class="label-head">
    <div class="text">
      <h2>${esc(p.name)}</h2>
      ${metaRow("Thương hiệu", p.brand)}
      ${metaRow("Khối lượng", p.quantity)}
      ${metaRow("Phân loại", p.category)}
      <p class="code">Mã ${esc(p.code)} · <a href="https://world.openfoodfacts.org/product/${esc(encodeURIComponent(p.code))}" target="_blank" rel="noopener">xem trên Open Food Facts</a></p>
    </div>
    ${hasImage
      // Ảnh tải lỗi: ẩn ảnh, hiện ô "Chưa có ảnh" ngay sau nó (không để trống chỗ)
      ? `<img src="${esc(p.image)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="noimg" hidden>Chưa có ảnh</div>`
      : '<div class="noimg">Chưa có ảnh</div>'}
  </div>
  <div class="scores">
    <div><span class="k">Nutri-Score</span><div class="ns">${ns}</div><small>${esc(nsText)}</small></div>
    <div><span class="k">Mức chế biến (NOVA)</span><br><span class="nova-chip nova-${p.nova || 0}">${p.nova || "?"}</span><small>${esc(p.nova ? NOVA_VI[p.nova] : "Chưa có dữ liệu")}</small></div>
  </div>
  <table class="facts"><caption>Giá trị dinh dưỡng trên 100 g</caption><tbody>${rows}</tbody></table>
  ${p.hasNutriments ? "" : nutritionPhoto ? labelPhoto(nutritionPhoto, "Ảnh bảng dinh dưỡng trên bao bì", noNutrition) : noNutrition}
  <section class="block"><h3>Thành phần</h3>${p.ingredients ? `<p>${esc(p.ingredients)}</p>`
    : ingredientsPhoto ? labelPhoto(ingredientsPhoto, "Ảnh thành phần trên bao bì", noIngredients) : noIngredients}</section>
  <section class="block"><h3>Chất gây dị ứng</h3>
    ${p.hasAllergenData ? `<div class="chips">${chips(p.allergens)}</div>` : `<p class="empty">${esc(ALLERGY_NO_DATA)}</p>`}
    ${p.traces.length ? `<p class="src">Có thể lẫn vết: ${esc(p.traces.join(", "))}</p>` : ""}
  </section>
  <section class="block"><h3>Phụ gia${p.additives.length ? ` (${p.additives.length})` : ""}</h3>
    ${p.additives.length ? `<div class="chips">${chips(p.additives, "soft")}</div>` : '<p class="empty">Không ghi nhận phụ gia (hoặc chưa có dữ liệu).</p>'}
  </section>
  ${extra ? `<section class="block"><h3>Xuất xứ và bảo quản</h3><table class="info"><tbody>${extra}</tbody></table></section>` : ""}
  ${p.ecoscore ? `<p class="src">Green-Score (tác động môi trường): ${p.ecoscore.toUpperCase()}</p>` : ""}
  ${renderContribute(p)}
</article>`;
}

/**
 * Trang "Add a product" (thêm sản phẩm) chính thức của Open Food Facts, nơi người dùng nhập mã vạch.
 * Kiểm 06/11/2026: trang chủ world.openfoodfacts.org có link "Add a product" tới đúng địa chỉ này (HTTP 200).
 * Không dùng link cũ "…product.pl?type=add&code=<mã>": với mã CHƯA có trên Open Food Facts link đó trả
 * HTTP 404 "No product listed for barcode …" (sản phẩm phải được tạo trước). Trang này không điền sẵn mã,
 * nên câu giải thích ghi mã để người dùng nhập.
 */
export const OFF_ADD_URL = "https://world.openfoodfacts.org/cgi/product.pl?type=search_or_add&action=display";

export function renderNotFound(code) {
  const c = esc(code);
  return `<div class="notfound copy-area"><p class="big">Chưa có mã ${c} trong Open Food Facts</p>
<p>Sản phẩm này chưa được ai thêm vào. Bạn có thể tự thêm (cần tài khoản Open Food Facts và chụp bao bì; trên trang thêm sản phẩm, nhập mã ${c}), hoặc thử mã khác.</p>
<p class="contribute"><a class="btn" href="${esc(OFF_ADD_URL)}" target="_blank" rel="noopener">Góp sản phẩm này lên Open Food Facts</a>
<button type="button" class="btn copy-code" data-code="${c}">Chép mã</button></p>
<p class="copy-msg" role="status" aria-live="polite"></p></div>`;
}

/**
 * [câu chính, dòng gợi ý] của lỗi khi tra cứu (dòng gợi ý đã escape, câu chính chưa).
 * Dùng chung cho renderError (màn tra cứu) và cột lỗi ở màn So sánh, để 2 nơi cùng chữ.
 */
function errorMessages(code, kind, detail) {
  const c = esc(code);
  const status = detail?.status ? ` (HTTP ${detail.status})` : "";
  // [câu chính, dòng gợi ý]
  const MESSAGES = {
    timeout: ["Open Food Facts phản hồi chậm, thử lại.", `Tra lại mã ${c} sau ít giây.`],
    server: [`Open Food Facts đang lỗi hoặc quá tải${status}, thử lại sau.`, `Tra lại mã ${c} sau ít giây.`],
    // Trang lỗi 503 không kèm header CORS làm Safari ném "TypeError: Load failed", giống hệt mất mạng.
    network: ["Không kết nối được tới Open Food Facts",
      `Kiểm tra mạng, hoặc Open Food Facts đang quá tải; tra lại mã ${c} sau ít giây.`],
    display: ["Không hiển thị được dữ liệu sản phẩm này.",
      `Mã ${c} có trên Open Food Facts nhưng dữ liệu có dạng app chưa đọc được.`],
    unknown: ["Có lỗi bất thường khi tra cứu, thử lại.",
      `Tra lại mã ${c}; nếu vẫn lỗi, chụp lại dòng chữ nhỏ bên dưới.`]
  };
  return Object.hasOwn(MESSAGES, kind) ? MESSAGES[kind] : MESSAGES.unknown;
}

/**
 * Báo lỗi khi tra cứu.
 * kind: "timeout" | "network" | "server" | "display" | "unknown" (kind lạ hoặc rỗng cũng coi là "unknown");
 * detail: lỗi gốc (Error, chuỗi…), hiện ở dòng chữ nhỏ qua errorText().
 */
export function renderError(code, kind, detail) {
  const [main, hint] = errorMessages(code, kind, detail);
  const info = detail == null ? "" : errorText(detail);
  return `<div class="notfound"><p class="big">${esc(main)}</p>
<p>${hint}</p>${info ? `\n<p class="src">${esc(info)}</p>` : ""}</div>`;
}

// ---- So sánh 2 sản phẩm (giai đoạn 3) ----

/** Nút dưới kết quả tra (sản phẩm tìm thấy): mở màn So sánh, điền sẵn mã này vào bên A. */
export function renderCompareButton(code) {
  return `<p class="cmp-open"><button class="btn" type="button" data-compare-code="${esc(code)}">So sánh với sản phẩm khác</button></p>`;
}

/**
 * Các lựa chọn của ô <select> "Chọn từ đã quét gần đây" (từ getHistory(): [{ code, name }]).
 * Lựa chọn đầu có value rỗng (chưa chọn gì).
 */
export function renderHistoryOptions(list) {
  if (!list.length) return '<option value="">Chưa quét sản phẩm nào</option>';
  return '<option value="">Chọn từ đã quét gần đây</option>'
    + list.map((x) => `<option value="${esc(x.code)}">${esc(x.name)} (${esc(x.code)})</option>`).join("");
}

/** Ảnh nhỏ: chỉ nhận https://; không có ảnh (hoặc ảnh tải lỗi) thì ô "Chưa có ảnh" như màn tra cứu. */
function smallImage(image) {
  return typeof image === "string" && image.startsWith("https://")
    ? `<img src="${esc(image)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="noimg" hidden>Chưa có ảnh</div>`
    : '<div class="noimg">Chưa có ảnh</div>';
}

/**
 * Đầu 1 cột so sánh. side: { code, status: "ok" | "notfound" | "error", product (đã normalize, khi "ok"),
 * kind + error (khi "error") }. Khung dị ứng có class (KHÔNG có id allergyAlert: id đó chỉ dành cho màn tra cứu).
 */
function renderCompareColumn(side, letter, profile) {
  const head = `<p class="cmp-letter">Sản phẩm ${letter}</p>`;
  if (side.status === "ok") {
    const p = side.product;
    const alert = renderAllergyAlert(matchAllergies(p, profile), profile.length);
    return `${head}
  <div class="cmp-head">${smallImage(p.image)}
    <div class="text"><p class="cmp-name">${esc(p.name)}</p><p class="code">Mã ${esc(p.code)}</p></div>
  </div>
  <div class="allergy-box cmp-allergy">${alert}</div>`;
  }
  if (side.status === "notfound") return `${head}\n${renderNotFound(side.code)}`;
  // Lỗi mạng / máy chủ: câu rút gọn từ renderError (cùng chữ), không có dòng lỗi kỹ thuật nhỏ.
  const [main, hint] = errorMessages(side.code, side.kind, side.error);
  return `${head}
  <div class="notfound"><p class="big">${esc(main)}</p><p>${hint}</p></div>`;
}

/**
 * Kết quả so sánh 2 sản phẩm: 2 cột đầu (ảnh, tên, mã, khung dị ứng) + bảng 6 dòng trên 100 g / 100 ml.
 * sides: [bên A, bên B] (xem renderCompareColumn); profile: hồ sơ dị ứng (mảng khóa nhóm).
 * Chỉ hiện số, không tô màu hay in đậm bên nào lớn / nhỏ hơn; ô thiếu ghi "chưa có dữ liệu".
 */
export function renderCompare(sides, profile = []) {
  const [a, b] = sides;
  const prod = (s) => (s && s.status === "ok" ? s.product : null);
  const cell = (v, unit) => (v == null ? '<span class="empty">chưa có dữ liệu</span>' : `${fmt(v)} ${esc(unit)}`);
  const rows = compareRows(prod(a), prod(b)).map((r) =>
    `<tr><th scope="row">${esc(r.label)}</th><td>${cell(r.a, r.unit)}</td><td>${cell(r.b, r.unit)}</td></tr>`
  ).join("");
  return `
<div class="cmp-cols">
  <section class="cmp-col" aria-label="Sản phẩm A">${renderCompareColumn(a, "A", profile)}</section>
  <section class="cmp-col" aria-label="Sản phẩm B">${renderCompareColumn(b, "B", profile)}</section>
</div>
<table class="cmp-table">
  <caption>Giá trị dinh dưỡng trên 100 g / 100 ml</caption>
  <thead><tr><th scope="col"><span class="visually-hidden">Chỉ số</span></th><th scope="col">A</th><th scope="col">B</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="src">Số theo Open Food Facts (cộng đồng đóng góp, có thể thiếu hoặc sai). App không tự tính hay đổi đơn vị.</p>`;
}

/**
 * Form "Thêm vào tủ đồ" dưới kết quả tra.
 * Mã không tìm thấy thì gọi với name = "": ô tên để trống, người dùng bắt buộc nhập.
 */
export function renderAddForm({ code, name = "", brand = "" }) {
  if (name === NO_NAME) name = ""; // tên normalize() tự đặt khi API trống: không điền sẵn
  const hint = name ? "" : '<p class="hint">Chưa có tên sản phẩm này: nhập tên để dễ nhận ra trong tủ.</p>';
  return `
<form class="add-pantry" data-code="${esc(code)}" data-brand="${esc(brand)}" autocomplete="off">
  <h3>Thêm vào tủ đồ</h3>
  ${hint}
  <label>Tên món
    <input name="name" required maxlength="120" value="${esc(name)}">
  </label>
  <div class="row">
    <label>Hạn sử dụng
      <input name="expiresOn" type="date" min="${DATE_MIN}" max="${DATE_MAX}" required>
    </label>
    <label>Số lượng
      <input name="qty" type="number" min="1" max="${QTY_MAX}" step="1" value="1" inputmode="numeric" required>
    </label>
  </div>
  <button class="btn primary" type="submit">Thêm vào tủ đồ</button>
  <p class="form-msg" role="status" aria-live="polite"></p>
</form>`;
}

/**
 * Tóm tắt file vừa chọn để nhập (kết quả parseImport) + 3 nút Gộp / Thay toàn bộ / Hủy.
 * Các nút có data-import để main.js bắt sự kiện.
 */
export function renderImportSummary({ pantry, allergyProfile, skipped }) {
  return `<p class="import-summary">File có ${pantry.length} món, ${allergyProfile.length} nhóm dị ứng, bỏ ${skipped} món hỏng hoặc trùng.</p>
<div class="actions import-actions">
  <button class="btn primary" type="button" data-import="merge">Gộp vào tủ hiện tại</button>
  <button class="btn" type="button" data-import="replace">Thay toàn bộ</button>
  <button class="btn" type="button" data-import="cancel">Hủy</button>
</div>`;
}

/** Tên tiếng Việt của các nhóm trong hồ sơ, nối ", "; 0 nhóm thì "không nhóm nào" (chữ thường, chưa escape). */
export function profileNames(keys) {
  return keys.length ? keys.map((k) => ALLERGEN_VI[k]).join(", ") : "không nhóm nào";
}

/** Form sửa tại chỗ 1 món: hạn + số lượng, nút Lưu / Hủy. */
function renderEditForm(x) {
  const n = esc(x.name || "món này");
  return `
<form class="pantry-edit" data-id="${esc(x.id)}">
  <div class="row">
    <label>Hạn sử dụng
      <input name="expiresOn" type="date" min="${DATE_MIN}" max="${DATE_MAX}" required value="${esc(x.expiresOn)}">
    </label>
    <label>Số lượng
      <input name="qty" type="number" min="1" max="${QTY_MAX}" step="1" inputmode="numeric" required value="${esc(x.qty)}">
    </label>
  </div>
  <div class="actions">
    <button class="btn primary" type="submit" aria-label="Lưu ${n}">Lưu</button>
    <button class="btn" type="button" data-action="cancel" aria-label="Hủy sửa ${n}">Hủy</button>
  </div>
  <p class="form-msg" role="status" aria-live="polite"></p>
</form>`;
}

/**
 * Danh sách tủ đồ, sắp theo hạn (hết hạn trước lên đầu).
 * editingId: id món đang sửa (hiện form tại chỗ thay cho nút Sửa / Xóa).
 * today: truyền vào để test; mặc định là hôm nay.
 */
export function renderPantry(list, { editingId = null, today = new Date() } = {}) {
  if (!list.length) return '<p class="empty pantry-empty">Tủ đồ trống.</p>';
  const items = sortPantry(list).map((x) => {
    const days = daysLeft(x.expiresOn, today);
    const status = expiryStatus(days);
    const n = esc(x.name || "món này");
    const tail = x.id === editingId
      ? renderEditForm(x)
      : `<div class="actions">
    <button class="btn" type="button" data-action="edit" aria-label="Sửa ${n}">Sửa</button>
    <button class="btn" type="button" data-action="delete" aria-label="Xóa ${n}">Xóa</button>
  </div>`;
    return `
<li class="pantry-item ${status}" data-id="${esc(x.id)}">
  <p class="pi-name">${esc(x.name || "Chưa có tên")}</p>
  <p class="pi-meta">${x.code ? `Mã ${esc(x.code)} · ` : ""}Số lượng: ${esc(x.qty)}</p>
  <p class="pi-date">Hết hạn ngày ${esc(formatDate(x.expiresOn))}</p>
  <p class="pi-status">${esc(expiryText(days))}</p>
  ${tail}
</li>`;
  }).join("");
  return `<ul class="pantry-list">${items}</ul>`;
}

// ---- Tài khoản (đăng nhập Google qua Supabase, đợt dang-nhap; không bắt buộc) ----

/** Dòng giải thích dưới nút đăng nhập. */
export const AUTH_NOTE = "Đăng nhập lưu email của bạn ở Supabase để chống dùng chùa máy chủ, không dùng vào việc khác. "
  + "App đang ở chế độ thử: chỉ email được thêm vào danh sách mới đăng nhập được. "
  + "Quét mã, tủ đồ, dị ứng, so sánh, xuất / nhập vẫn dùng được không cần đăng nhập.";

/**
 * HTML khối tài khoản từ authView() (src/auth.js). Mọi email / câu lỗi qua esc().
 * Nút có data-auth="login" / "logout" (main.js bắt bằng 1 listener trên khối).
 */
export function renderAuthBox(view) {
  if (!view?.visible) return "";
  const error = view.error ? `<p class="auth-msg warn" role="status" aria-live="polite">${esc(view.error)}</p>` : "";
  const disabled = view.busy ? " disabled" : "";
  if (view.mode === "loading") {
    return `<p class="auth-status">Đang kiểm đăng nhập…</p>${error}`;
  }
  if (view.mode === "unavailable") {
    return `<p class="auth-status">Chưa tải được phần đăng nhập. Các tính năng khác vẫn dùng bình thường.</p>${error}`;
  }
  if (view.mode === "signedIn") {
    return `<p class="auth-status">Đã đăng nhập: <strong class="auth-email">${esc(view.email || "(không rõ email)")}</strong></p>
<div class="actions auth-actions"><button class="btn" type="button" data-auth="logout"${disabled}>Đăng xuất</button></div>${error}`;
  }
  return `<div class="actions auth-actions"><button class="btn" type="button" data-auth="login"${disabled}>Đăng nhập bằng Google</button></div>
<p class="auth-note">${esc(AUTH_NOTE)}</p>${error}`;
}
