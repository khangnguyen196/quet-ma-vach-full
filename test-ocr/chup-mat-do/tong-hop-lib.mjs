// Hàm thuần dùng chung cho tong-hop-v3.mjs / tong-hop-v4.mjs (định dạng số, lấy số từ file kết quả).
// Không đọc file, không gọi mạng.

/** Số lượt tải ảnh: ảnh chỉ mục (chon.downloadStats.downloads) và ảnh truy vấn bộ phụ (loo.queryDownloads, trường
 *  ghi riêng từ vòng 4). Không trừ chon − loo (chạy riêng bước loo thì bộ đếm của loo bắt đầu từ 0 -> ra số âm).
 *  loo.json cũ không có trường -> query = null. */
export function imageDownloadCounts(chon, loo) {
  const index = chon?.downloadStats?.downloads ?? null;
  const query = Number.isFinite(loo?.queryDownloads) ? loo.queryDownloads : null;
  return { index, query };
}

/** Chữ cho số lượt tải ảnh truy vấn: null -> "– (không có số, chạy trước khi thêm trường)". */
export function queryDownloadsText(n) {
  return n == null ? "– (không có số, chạy trước khi thêm trường)" : String(n);
}

/** "vị trí 1: 7/15 · 5 đầu: 10/15". */
export function fmtRank(top1, top5, n) {
  return `vị trí 1: ${top1}/${n} · 5 đầu: ${top5}/${n}`;
}

/** Thời gian ms: < 0,1 -> "< 0,1 ms", không có -> "–", còn lại 2 chữ số thập phân. */
export function fmtMs(x) {
  if (x == null || !Number.isFinite(x)) return "–";
  if (x < 0.1) return "< 0,1 ms";
  return `${x.toFixed(2)} ms`;
}

/** Số mã thử KHÔNG dùng được cho chỉ mục ảnh (chong-an-gian.json): không qua luật tự động (usable + xem tay "khác")
 *  và không phải mã dòng phụ. */
export function unusableTestCount(cag, sideCode) {
  return (cag?.items || []).filter((i) => !(i.usable && i.manualCheck?.verdict === "khác") && i.code !== sideCode).length;
}

/** Số lỗi tải ảnh tổng của nhiều downloadStats (429/5xx, lỗi mạng, cầu dao): lấy số lớn nhất mỗi trường vì bộ đếm
 *  của loo có thể gồm cả phần của chon (chạy chung tiến trình). */
export function downloadErrorStats(...stats) {
  const pick = (k) => Math.max(0, ...stats.map((s) => (Number.isFinite(s?.[k]) ? s[k] : 0)));
  return { http429or5xx: pick("http429or5xx"), networkErrors: pick("networkErrors"), breakerTrips: pick("breakerTrips") };
}
