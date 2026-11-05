// Tạo HTML cho phần kết quả. Mọi dữ liệu từ API đều qua esc().
import { NOVA_VI, NUTRIENT_ROWS } from "./off.js";
import { daysLeft, expiryStatus, expiryText, formatDate, sortPantry } from "./pantry.js";

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

const fmt = (v) => Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 });

/** Dòng "Nhãn: giá trị" dưới tên sản phẩm; trống thì ghi "chưa có dữ liệu". */
const metaRow = (label, value) =>
  `<p class="meta"><span class="k">${esc(label)}:</span> ${value ? esc(value) : '<span class="empty">chưa có dữ liệu</span>'}</p>`;

/** Dòng "nhãn: giá trị", bỏ qua nếu trống. */
const infoRow = (label, value) =>
  value ? `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>` : "";

export function renderProduct(p) {
  // Chỉ nhận ảnh https:// (chặn "javascript:", "http://"…); không đúng thì coi như không có ảnh.
  const hasImage = typeof p.image === "string" && p.image.startsWith("https://");

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
  ${!p.hasNutriments ? '<p class="src">Sản phẩm này chưa được ai nhập bảng dinh dưỡng.</p>' : ""}
  <section class="block"><h3>Thành phần</h3>${p.ingredients ? `<p>${esc(p.ingredients)}</p>` : '<p class="empty">Chưa có dữ liệu thành phần.</p>'}</section>
  <section class="block"><h3>Chất gây dị ứng</h3>
    ${p.allergens.length ? `<div class="chips">${chips(p.allergens)}</div>` : '<p class="empty">Không ghi nhận chất gây dị ứng (hoặc chưa có dữ liệu).</p>'}
    ${p.traces.length ? `<p class="src">Có thể lẫn vết: ${esc(p.traces.join(", "))}</p>` : ""}
  </section>
  <section class="block"><h3>Phụ gia${p.additives.length ? ` (${p.additives.length})` : ""}</h3>
    ${p.additives.length ? `<div class="chips">${chips(p.additives, "soft")}</div>` : '<p class="empty">Không ghi nhận phụ gia (hoặc chưa có dữ liệu).</p>'}
  </section>
  ${extra ? `<section class="block"><h3>Xuất xứ và bảo quản</h3><table class="info"><tbody>${extra}</tbody></table></section>` : ""}
  ${p.ecoscore ? `<p class="src">Green-Score (tác động môi trường): ${p.ecoscore.toUpperCase()}</p>` : ""}
</article>`;
}

export function renderNotFound(code) {
  return `<div class="notfound"><p class="big">Chưa có mã ${esc(code)} trong Open Food Facts</p>
<p>Sản phẩm này chưa được ai thêm vào. Bạn có thể <a href="https://world.openfoodfacts.org/cgi/product.pl?type=add&code=${esc(code)}" target="_blank" rel="noopener">tự thêm bằng cách chụp bao bì</a>, hoặc thử mã khác.</p></div>`;
}

/**
 * Báo lỗi khi tra cứu.
 * kind: "timeout" | "network" | "server" | "display" | "unknown" (kind lạ hoặc rỗng cũng coi là "unknown");
 * detail: lỗi gốc (Error, chuỗi…), hiện ở dòng chữ nhỏ qua errorText().
 */
export function renderError(code, kind, detail) {
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
  const [main, hint] = Object.hasOwn(MESSAGES, kind) ? MESSAGES[kind] : MESSAGES.unknown;
  const info = detail == null ? "" : errorText(detail);
  return `<div class="notfound"><p class="big">${esc(main)}</p>
<p>${hint}</p>${info ? `\n<p class="src">${esc(info)}</p>` : ""}</div>`;
}

// Tên off.js normalize() đặt khi sản phẩm không có tên
const NO_NAME = "Sản phẩm chưa có tên";

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
      <input name="expiresOn" type="date" required>
    </label>
    <label>Số lượng
      <input name="qty" type="number" min="1" step="1" value="1" inputmode="numeric" required>
    </label>
  </div>
  <button class="btn primary" type="submit">Thêm vào tủ đồ</button>
  <p class="form-msg" role="status" aria-live="polite"></p>
</form>`;
}

/** Form sửa tại chỗ 1 món: hạn + số lượng, nút Lưu / Hủy. */
function renderEditForm(x) {
  const n = esc(x.name || "món này");
  return `
<form class="pantry-edit" data-id="${esc(x.id)}">
  <div class="row">
    <label>Hạn sử dụng
      <input name="expiresOn" type="date" required value="${esc(x.expiresOn)}">
    </label>
    <label>Số lượng
      <input name="qty" type="number" min="1" step="1" inputmode="numeric" required value="${esc(x.qty)}">
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
