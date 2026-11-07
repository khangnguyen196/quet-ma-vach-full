// Hàm thuần dùng chung cho tong-hop-v3.mjs / tong-hop-v4.mjs (định dạng số, lấy số từ file kết quả).
// Không đọc file, không gọi mạng.

/** Số lượt tải ảnh: ảnh chỉ mục (chon.downloadStats) và ảnh truy vấn bộ phụ. */
export function imageDownloadCounts(chon, loo) {
  const index = chon?.downloadStats?.downloads ?? null;
  const query = (loo?.downloadStats?.downloads ?? 0) - (index ?? 0);
  return { index, query };
}
