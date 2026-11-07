// Kết quả XEM TAY ảnh ứng viên chỉ mục cách 2 (chống ăn gian), chong-an-gian.mjs đọc file này.
// MANUAL[mã][imgid] = { verdict: "trùng" (cùng tấm chụp với front.jpg, chỉ khác khung cắt) | "khác", note }.
// Ghi bằng tay sau khi mở cả hai ảnh ra xem (front.jpg và ảnh ứng viên .400.jpg / .full.jpg ở D:\tmp\chup-mat-do\anh-off).
// Xem tay KHÔNG gỡ được luật tự động: ứng viên ≤ HASH_DUP bit vẫn bị loại dù xem tay ghi "khác".
// Xem ngày 08/11/2026 (lam-viec vòng 2).
export const MANUAL = {
  8934803043891: {
    12: { verdict: "khác", note: "nền khác (front.jpg: rổ nhựa đỏ, ngón tay trái; imgid 12: nền tối, tay phải, có nhãn dán trắng góc dưới), góc chụp và vệt bóng nilon khác" },
    1: { verdict: "khác", note: "nền chăn xám, có nhãn dán trắng 'PLC Pillows Chocolate', không có tay; khác tấm chụp" },
  },
  8935049501503: {
    3: { verdict: "khác", note: "ảnh lon chụp thẳng trên nền trắng, chữ 'uống / cùng' thấy rõ; front.jpg chụp nghiêng trên bàn mây, nền mờ; khác tấm chụp" },
  },
  8936012061321: {
    1: { verdict: "trùng", note: "cùng vân gỗ, cùng nếp gấp góc trên trái hộp, cùng góc nghiêng và ánh sáng; chỉ khác khung cắt / độ phân giải" },
  },
  8934572260543: {
    1: {
      verdict: "khác",
      note: "so bản to 2224×4026: imgid 1 chữ 'LỘ' và huy hiệu Mai Quế Lộ rõ, ít bóng; front.jpg có mảng bóng nilon nhăn lớn che 'LỘ' và huy hiệu, có vết mực trên quai, mép trên cắt khác (imgid 1 thấy thêm một gói khác phía trên). Cùng gói hàng nhưng khác tấm chụp. Vẫn bị luật tự động loại (pHash 10 bit ≤ 10)",
    },
  },
  8936036023633: {
    2: { verdict: "trùng", note: "luật tự động: dHash 0 bit, pHash 0 bit ở khung 100 % (điều phối đã xem: cùng tấm chụp, khác khung cắt)" },
  },
};
