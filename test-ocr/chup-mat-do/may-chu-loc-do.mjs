// Đợt may-chu-loc vòng 2: KHUNG ĐO "máy chủ ghép câu tìm tốt hơn" (bỏ dòng rác / dòng nổi bật / từ ở chữ to nặng điểm
// hơn) cho 10 ứng viên máy chủ của Chụp mặt trước. CHỈ đo trong Node, KHÔNG sửa src/ server/ public/ tests/.
// Commit đầu tiên của file này CHỈ có khối luật (comment) + hằng số; code đo viết SAU commit đó.
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC — commit riêng "test(may-chu-loc): luật đo chốt trước" TRƯỚC mọi dòng code đo và TRƯỚC mọi lần chạy
// một cách trên ca thật. Viết lúc 2026-11-20 (giờ commit thật + sha ghi ở PLAN.md mục đợt may-chu-loc). Không sửa khối
// này sau khi thấy số của bất kỳ cách nào; buộc phải sửa thì ghi "LỆCH LUẬT" ở PLAN.md và dừng báo.
// Lúc viết khối này ĐÃ thấy: chẩn đoán 22 ảnh thật (nguyên nhân, hạng mã nhãn ở nền), CHƯA thấy số của cách nào.
// ===================================================================================================================
// Nền = mã ở da1ca3b (BASE_SHA): app gộp đường máy chủ bằng serverMerge = G2 + c-idf (serverIdf true).
// Hai đường (OFF cùng câu như nền):
//   MÁY: found = T1 trên danh mục 1.452 của app (rankFromItems / rankFromText, KHÔNG đổi, k 5); S = 10 ứng viên trên
//     danh mục mức (c) (server/catalog/c.jsonl.gz, chỉ mục JS buildRankIndex = catalog_search.py, khớp Python) theo
//     cách đang đo, qua serverCandidates; S có ≥ 1 mục → serverMerge của src (G2 + c-idf), S rỗng → photoMerge + kho
//     phụ 893 (như app); rồi photoOutcome. Cách CHỈ đổi câu tìm / cách tìm 10 ứng viên của máy chủ (S).
//   LÙI: photoMerge + kho phụ 893 của src (không đổi): chỉ kiểm giống hệt nền từng ô.
// Điều kiện OFF: (i) lỗi (mọi câu lỗi mạng); (ii) cache đĩa D:\tmp\tu-dong\cache-off (câu thiếu cache = lỗi).
//   0 lượt OFF thật, 0 lượt Azure, không chạy lại OCR.
// Câu tìm nền của máy chủ = t1QueryFromLines(rowLineInfo(items), từ vựng + bí danh của (c)) (= row_line_info /
//   usable_line / t1_query_from_lines của server/catalog_search.py).
//
// Lưới chốt sẵn = ĐÚNG lưới 89 cách của dong-noi-bat-do.mjs (methodGrid / METHOD_ORDER), chỉ áp cho S:
//   (a) bỏ dòng rác (filterRows trên hàng rowLineInfo): a-c70, a-c80, a-url, a-so, a-ui, a-tong, a-tong-c70,
//       a-tong-c80 (tiêu chí như dong-noi-bat). Lọc làm câu tìm rỗng → dùng mọi hàng (giống nền từng ca).
//   (b) dòng nổi bật: b-h1..3, b-hoa1..3; RRF hằng số 60 với danh sách tìm cả câu (sâu 10), như dong-noi-bat.
//   (c) từ ở chữ to nặng điểm hơn: c-0.5, c-1, c-2 (trọng số 1 + β × max(0, cao / m − 1), m = trung vị dưới).
//   (a)+(b), (a)+(c): mọi biến thể (a) × mọi ô (b) / (c) (lọc hàng trước, rồi (b) / (c) trên khung của hàng còn lại).
//   Không thêm cách sau khi thấy số.
// "CHIỀU CAO" ở (b) và (c) = CHIỀU CAO KHUNG CHỮ (item box), KHÔNG phải h của hàng rowLineInfo (h hàng = khung cao
//   nhất của hàng; chẩn đoán thấy nhiều khung chữ dọc / chữ to làm cả ảnh thành 1 hàng cao 660–697 px):
//   cao(khung) = cạnh ngắn của tứ giác poly = min((|p0p1| + |p2p3|) / 2, (|p1p2| + |p3p0|) / 2) (không phụ thuộc chữ
//     xoay dọc); poly không đủ 4 điểm → maxY − minY.
//   Đơn vị xét là TỪNG KHUNG (không phải hàng): mỗi khung của các hàng dùng (sau (a)) là một "dòng" { text: chữ khung,
//     h: cao(khung), conf: score khung }; (b) xếp các khung này (usableLine, câu tìm riêng khác rỗng; "hoa" thêm điều
//     kiện in hoa + 1–3 từ) theo cao giảm dần, hòa → khung đứng trước theo thứ tự hàng rồi minX; lấy k khung, mỗi khung
//     tìm riêng; (c) trọng số từ = lớn nhất trên các khung có từ đó trong câu tìm riêng của khung, m = trung vị dưới cao
//     của các khung có câu tìm riêng khác rỗng; từ không nằm trong khung nào → trọng số 1.
//   Không có khung (câu gõ) → (b)(c) như nền.
//   Điểm gắn vào S: (a) BM25 câu đã lọc; (b) BM25 câu đầy đủ của tài liệu; (c) BM25 không trọng số (như dong-noi-bat).
//
// Ca (ô = ca × điều kiện OFF (i)(ii)):
//   A / B: 60 ảnh bộ A / B (D:\tmp\tu-dong\ocr\bo-a-30.json, bo-b-30.json; mã đúng như cũ).
//   22 ảnh thật (D:\tmp\may-chu-loc\ket-qua-goc.json, nhãn D:\tmp\may-chu-loc\nhan.json, NGOÀI git): chia theo luật
//     vòng 0: trong mỗi thư mục xếp MỌI file (kể cả nhãn null) theo tên tăng dần (so chuỗi), vị trí lẻ (1, 3, 5…) = GIỮ
//     RIÊNG, chẵn = CHỈNH; sau khi chia mới bỏ ảnh nhãn null. Nhãn "none" = không có dữ liệu. Ảnh nhãn chọn sẵn (preset)
//     tính như ảnh có nhãn (ghi "chưa xác nhận"). Khung đo tính lại phép chia từ nhan.json lúc chạy.
//   7Up chữ máy + câu gõ (khóa ca có kind); muối Co.op; buldak.jpg; ruaypuan.jpg (D:\tmp\dong-noi-bat\ocr\); 6 ca ngoại
//     dựng (foreignCases như g2-di-qua); ca tổng hợp chèn rác (injectJunk trên A / B; CHỈ BÁO); 70 ca dò (pickProbes;
//     CHỈ BÁO).
//
// Cổng (MÁY, (i) và (ii); "nền" = nền cùng ca, cùng điều kiện, cùng lần chạy):
//   C1 A + B: 0 ảnh mất vị trí 1, 0 ảnh mới rơi khỏi 5 so với nền (lossOf).
//   C2 22 ảnh thật có nhãn mã (cả CHỈNH và GIỮ RIÊNG, kể cả preset): 0 ô mà nền có nhãn ở vị trí 1 bị mất vị trí 1; 0 ô
//      mà nền có nhãn trong 5 bị rơi khỏi 5. Ảnh nền ngoài 5 không xét ở C2. Ảnh "none": chỉ báo (kind không đổi vì
//      CONFIDENCE_RULE luôn không chắc).
//   C3 7Up Diet 8934588752117 vị trí 1 ở 4 ô (chữ máy / câu gõ × (i)(ii)); buldak 8801073250574 vị trí 1 ở (i)(ii);
//      muối Co.op photoOutcome kind "open" ở MÁY (i)(ii) và LÙI (i)(ii); 6 ca ngoại: tổng số ô vị trí 1 và tổng số ô
//      trong 5 (trên 12 ô) không giảm so với nền.
//   C4 S ≤ 10 mục ở mọi ca; (a) lọc hết dòng → quay về mọi dòng: S và found trùng nền từng ca đó.
//   C5 Không đổi src/, server/, public/, package.json, package-lock.json so với da1ca3b (git diff --quiet); lúc chạy:
//      CONFIDENCE_RULE { feature: null, threshold: null }, STRANGE_MODE null, SERVER_MERGE_OPTS / DEFAULT_GUARD như nền
//      (G2 / c-idf, danh mục, kho phụ, dependency không đổi); câu OFF (cleanQuery) từng ca trùng nền; danh sách 5 mã LÙI
//      từng ô trùng nền.
//   C6 H3 ước p95 ≤ 200 ms: H3 ước = 23,5 ms × p95_Node(cách) / p95_Node(nền) (p95 nearest rank thời gian tạo S trên 30
//      ảnh bộ B, như dong-noi-bat); H2 ước = 835,3 MiB ≤ 1.536 MiB (không cách nào thêm cấu trúc dữ liệu lớn).
// Mục tiêu (chỉ xét cách qua MỌI cổng), thứ tự ưu tiên (lớn hơn trước):
//   M1 = số ô MÁY trong 5 của tập T = {ruaypuan 8852052150101} ∪ {ảnh thư mục 2 GIỮ RIÊNG có nhãn mã} ((i)(ii));
//   M2 = số ô MÁY vị trí 1 của cùng tập T;
//   M3 (hòa) = số ô MÁY trong 5 của ảnh nhóm CHỈNH thư mục 1 + 2 có nhãn mã, chỉ tính ô mà nền chưa ở vị trí 1;
//   hòa nữa → cách đơn giản hơn theo METHOD_ORDER của dong-noi-bat (a < c < b < (a)+(c) < (a)+(b), trong nhóm theo thứ
//   tự liệt kê). Cách được chọn mà M1 KHÔNG hơn M1 nền → không giữ gì ("không cách nào đạt").
//   Mọi số thư mục 2 ghi "chỉ để tham khảo (n ≤ 2)".
// Không cách nào đạt → đề xuất số ảnh cần thêm loại thư mục 2 ("quét sản phẩm không ra nhưng quét mã vạch ra"):
//   (1) phép thử dấu một phía (McNemar chính xác), α = 0,05, 0 ảnh hỏng: cần ≥ 5 ảnh được cách sửa (0,5^5 = 0,031 ≤
//       0,05) ⇒ số ảnh ≈ ⌈5 / p⌉, p = tỷ lệ ảnh loại 2 mà cách tốt nhất sửa được (ước từ nhóm chỉnh + chẩn đoán); không
//       ước được → bảng p = 0,2 / 0,3 / 0,5 → 25 / 17 / 10 ảnh;
//   (2) ước tỷ lệ ±15 điểm % ở độ tin 95%: n ≈ ⌈1,96² · p(1 − p) / 0,15²⌉ (p = 0,5 → 43). Ghi cả hai.
// Tự kiểm: khối luật kiểm bằng sha256 (RULE_SHA256, đặt ngoài khối sau commit luật) và so từng byte với commit luật
//   (git show); đo chỉ chạy khi worktree sạch và khối luật trùng; lệch → thoát mã 3.
// ===================================================================================================================
export const BASE_SHA = "da1ca3b";
export const SERVER_K = 10;
export const FOUND_K = 5;
export const MERGE_K = 5;
export const CONDS = Object.freeze(["i", "ii"]);
export const FOLDERS = Object.freeze(["1-ra-dung", "2-ma-vach-ra", "3-khong-ra"]);
export const CODE_7UP_DIET = "8934588752117";
export const BULDAK_CODE = "8801073250574";
export const RUAYPUAN_CODE = "8852052150101";
export const H3_PY_BASE_MS = 23.5;
export const H3_MAX_MS = 200;
export const H2_EST_MIB = 835.3;
export const H2_MAX_MIB = 1536;
export const SIGN_MIN_FIXED = 5;
export const P_TABLE = Object.freeze([0.2, 0.3, 0.5]);
export const Z95 = 1.96;
export const MARGIN = 0.15;
// ===================================================================================================================
// HẾT KHỐI LUẬT
// ===================================================================================================================
