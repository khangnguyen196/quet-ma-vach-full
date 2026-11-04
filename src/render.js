// Tạo HTML cho phần kết quả. Mọi dữ liệu từ API đều qua esc().
import { NOVA_VI, NUTRIENT_ROWS } from "./off.js";

export const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmt = (v) => Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 });

/** Dòng "nhãn: giá trị", bỏ qua nếu trống. */
const infoRow = (label, value) =>
  value ? `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>` : "";

export function renderProduct(p) {
  const meta = [p.brand, p.quantity, p.category].filter(Boolean).join(" – ");
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

  // Giai đoạn 2: xuất xứ / sản xuất / bảo quản – chỉ hiện dòng có dữ liệu
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
      ${meta ? `<p class="meta">${esc(meta)}</p>` : ""}
      <p class="code">Mã ${esc(p.code)} · <a href="https://world.openfoodfacts.org/product/${esc(encodeURIComponent(p.code))}" target="_blank" rel="noopener">xem trên Open Food Facts</a></p>
    </div>
    ${hasImage ? `<img src="${esc(p.image)}" alt="" onerror="this.remove()">` : ""}
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
 * detail: lỗi gốc (Error), hiện name: message ở dòng chữ nhỏ.
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
  const info = detail == null ? ""
    : typeof detail === "object" ? `${detail.name}: ${detail.message}` : String(detail);
  return `<div class="notfound"><p class="big">${esc(main)}</p>
<p>${hint}</p>${info ? `\n<p class="src">${esc(info)}</p>` : ""}</div>`;
}
