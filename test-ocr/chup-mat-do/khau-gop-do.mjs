// Đợt khau-gop: KHUNG ĐO "sửa khâu gộp của app" (đường MÁY = serverMerge của src/front-server.js) cho Chụp mặt trước,
// và ngưỡng "chưa chắc" (không tự mở). CHỈ đo trong Node, KHÔNG sửa src/ server/ public/ tests/.
// Commit đầu tiên của file này CHỈ có khối luật (comment) + hằng số; code đo viết SAU commit đó.
// Dữ liệu ảnh thật / nhãn / kết quả đều NGOÀI git (D:\tmp\may-chu-loc, D:\tmp\khau-gop); file này không chứa mã nhãn /
// tên ảnh thật (ảnh thật gọi bằng số thứ tự).
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC — commit riêng "test(khau-gop): luật đo chốt trước" TRƯỚC mọi dòng code đo và TRƯỚC mọi lần chạy một
// cách / một ngưỡng trên ca thật. Viết lúc 2026-11-20 (giờ commit thật + sha ghi ở PLAN.md mục đợt khau-gop). Không sửa
// khối này sau khi thấy số của bất kỳ cách / ngưỡng nào; buộc phải sửa thì ghi "LỆCH LUẬT" ở PLAN.md và dừng báo.
// Lúc viết khối này ĐÃ thấy: chẩn đoán khâu gộp 22 ảnh thật + bảng đặc trưng mục 1 ở nền (D:\tmp\khau-gop\chan-doan-gop.*,
// ngoài git); CHƯA thấy số của cách / ngưỡng nào.
// ===================================================================================================================
// Nền = mã ở 36c5fd7 (BASE_SHA): đường MÁY = serverMerge (G2 + c-idf: lockTop 3, offMax 1, offGap 1, offPromote
//   { gap 3, minWords 3 }, serverIdf true); đường LÙI = photoMerge + kho phụ 893 ("Tìm lại" cũng đi LÙI).
// Đầu vào (không chạy lại OCR / máy chủ):
//   found = rankFromItems / rankFromText của src trên danh mục 1.452 (k 5); câu OFF = cleanQuery của src.
//   S (10 ứng viên máy chủ) = ĐÃ LƯU: ảnh thật = candidates của D:\tmp\may-chu-loc\ket-qua-goc.json (máy chủ Python trên
//     máy, chỉ mục c-v5); ca khác = perCase.S của D:\tmp\may-chu-loc\ket-qua\nen.json (chỉ mục JS mức (c), may-chu-loc đã
//     kiểm Node = Python), chữ ứng viên (name / brand / img / text / grp) đọc từ server/catalog/c.jsonl.gz; mọi S qua
//     serverCandidates của src. Đợt này không đổi máy chủ nên S không đổi theo cách.
//   OFF: (i) lỗi hết (mọi câu lỗi mạng); (ii) cache đĩa D:\tmp\tu-dong\cache-off (câu thiếu cache = lỗi). 0 lượt OFF
//     thật, 0 lượt Azure. Hạn chế: app thật lúc chụp có OFF thật nên có thể khác.
// Ca (ô = ca × điều kiện OFF (i)(ii)):
//   A / B: 60 ảnh bộ A / B (D:\tmp\tu-dong\ocr\bo-a-30.json, bo-b-30.json).
//   22 ảnh thật (nhãn D:\tmp\may-chu-loc\nhan.json): chia nửa ĐÚNG luật may-chu-loc (trong mỗi thư mục xếp MỌI file kể
//     cả nhãn null theo tên tăng dần, vị trí lẻ = GIỮ RIÊNG, chẵn = CHỈNH; sau khi chia mới bỏ nhãn null). Nhãn "none" =
//     không có dữ liệu. Ảnh nhãn chọn sẵn chưa bấm xác nhận (preset) tính như ảnh có nhãn, đánh dấu.
//   7Up Diet 8934588752117 chữ máy + câu gõ (khóa ca có kind); muối Co.op (ca dựng); buldak.jpg 8801073250574;
//     ruaypuan.jpg (CHỈ BÁO); 6 ca ngoại dựng (foreignCases).
//
// ---- BƯỚC 3: cách sửa khâu gộp (đo TRƯỚC bước 4) ----
// Mọi cách chỉ đổi đường MÁY (S có ≥ 1 mục); found, câu OFF, OFF, S, đường LÙI giữ như nền. Cách cài bằng một hàm gộp
//   tham số trong khung đo (mergeLocal); mergeLocal với tham số nền PHẢI trùng serverMerge của src từng mục ở mọi ô
//   (kiểm chéo, lệch → dừng). Tham số nền: lockTop 3, offMax 1, offGap 1, promoteGap 3, promoteMinWords 3, idfMul 1,
//   serverTop 0, rrf false, srvFreeMax false, lockByScore false, s1Promote 0.
// Lưới chốt sẵn (STEP3_GRID; thứ tự khai báo = thứ tự ĐƠN GIẢN dùng khi hòa; không thêm cách sau khi thấy số):
//   (b) nới / bỏ lớp chặn, từng tham số riêng: b-lock2 / b-lock1 / b-lock0 (lockTop 2 / 1 / 0); b-max2 / b-max3
//       (offMax 2 / 3); b-gap0 / b-gap1 (offPromote gap 0 / 1, minWords 3); b-mw2 / b-mw1 (offPromote minWords 2 / 1,
//       gap 3; khung đo cho minWords 1 dù src đòi ≥ 2).
//   (c) c-idf0.5 / c-idf0.75 / c-idf1.25: idf của từ ngoài từ vựng 1.452 khi chấm mục máy chủ = maxIdf × 0,5 / 0,75 /
//       1,25 (nền × 1; cả điểm và số từ khớp tính lại theo idf này).
//   (a) a-top1 / a-top2 / a-top3: giữ thứ tự máy chủ cho top k: k vị trí đầu = S[0..k−1] theo thứ tự S (bỏ qua lockTop /
//       offMax / số từ khớp cho k mục này; mã trong danh mục 1.452 hiện bản danh mục, ngoài danh mục hiện như serverJoin:
//       bản OFF nếu mã có ở OFF, không thì bản S; điểm gắn vào mục = điểm khi chấm như nền, mục khớp 0 từ → 0); 5 − k chỗ sau = danh sách gộp NỀN tính với k = 5 + k (đủ lớp chặn +
//       offPromote như nền), bỏ mã đã đặt, lấy theo thứ tự tới đủ 5.
//   (c) c-rrf: sau khi chấm và xếp như nền (thứ tự trước chặn: tier, rankScore, vn, nguồn, thứ tự vào), điểm xếp mới =
//       1 / (60 + hạng trong danh sách trước chặn) + (mã trong S ? 1 / (60 + hạng trong S) : 0); xếp lại theo điểm này
//       giảm dần (hòa → thứ tự trước chặn); lớp chặn lockTop 3 / offMax 1 và offPromote (chọn theo điểm c-idf, ref =
//       điểm T1 mục 1) giữ như nền.
//   (d) từ bảng chẩn đoán vòng 1 (bước nào đẩy mã đúng xuống):
//       d-srv-max (một ảnh thật bị offMax 1 đẩy 5 → 7 vì 2 mục máy chủ tranh 1 chỗ): mục máy chủ (mã trong S) KHÔNG tính
//         vào offMax và không bị gạt; chỉ mục OFF ngoài S / kho phụ (extra) tính; mục được offPromote đẩy là mục máy
//         chủ nên phần sau dùng offMax nguyên.
//       d-lock-diem (một ảnh thật mục 1 là T1 điểm 5,39 bị khóa trên mục máy chủ điểm 20,61): mục T1 trong lockTop chỉ
//         giữ khóa khi điểm ≥ M, M = điểm c-idf cao nhất của mục máy chủ ngoài danh mục (nguồn OFF, không extra) khớp ≥ 2
//         từ (không có mục như vậy → khóa như nền); khóa là TIỀN TỐ: mục T1 đầu tiên không đạt thì nó và các mục T1 sau
//         mất khóa và xếp chung theo điểm; offMax / offPromote như nền.
//       d-s1-w2 (mã đúng ở hạng 1 trong S thì app đều đúng, nhưng lockTop đẩy 1 → 4 và chỉ offPromote cứu): mục S hạng 1
//         (có trong danh sách sau khi chấm) khớp ≥ 2 từ và điểm ≥ điểm T1 mục 1 → vị trí 1 (thay cho offPromote, chỉ một
//         mục được đẩy); không đạt → offPromote như nền; mục đẩy là mục OFF / máy chủ thì tính vào offMax như nền.
//   Ghép (liệt kê hết, không thêm): g-max-lock = d-srv-max + d-lock-diem; g-max-s1 = d-srv-max + d-s1-w2.
// Cổng bước 3 (MÁY, (i) và (ii); "nền" = serverMerge cùng ca, cùng điều kiện, cùng lần chạy; mọi cổng phải qua):
//   G1 A + B 60 ảnh: 0 ô mất vị trí 1, 0 ô rơi khỏi 5 so với nền; LÙI (photoMerge) giống hệt nền mọi ô (theo cách dựng).
//   G2 ảnh thật có nhãn mã mà nền ĐANG ĐÚNG ở vị trí 1 (8 ảnh, cả chỉnh và giữ riêng): 0 ô mất vị trí 1.
//   G3 7Up Diet vị trí 1 ở 4 ô (chữ máy / câu gõ × (i)(ii)); buldak vị trí 1 ở (i)(ii); muối Co.op photoOutcome kind
//      "open" ở MÁY (i)(ii) và LÙI (i)(ii); 6 ca ngoại: tổng số ô vị trí 1 và tổng số ô trong 5 (trên 12 ô) không giảm.
//   G4 thời gian gộp MÁY mỗi ô (Node): mỗi ô của A/B (120) + ảnh thật (44) chạy hàm gộp 20 lần lấy trung bình, sau 2 lượt
//      làm nóng; p95 nearest rank; nền đo trong cùng lần chạy, ngay trước cách. Qua khi p95 cách ≤ 50 ms VÀ ≤ 2 × p95 nền.
//   G5 không đổi server/, public/ (danh mục, kho phụ), package.json, package-lock.json, src/off-search.js so với
//      36c5fd7 (git diff --quiet); lúc chạy: CONFIDENCE_RULE null / null, STRANGE_MODE null, SERVER_MERGE_OPTS,
//      DEFAULT_GUARD, SERVER_MAX như nền; câu OFF từng ca trùng nền; LÙI từng ô trùng nền.
// Mục tiêu bước 3 (chỉ xét cách qua MỌI cổng; đếm theo Ô = ảnh × (i)(ii)):
//   X = ảnh thật có nhãn mã (thư mục 1 + 2, kể cả preset) mà nền CHƯA ở vị trí 1 ("xếp hạng sai"; tính mỗi ô).
//   M1 = số ô của X ở nửa CHỈNH có mã đúng ở vị trí 1; M2 = số ô của X ở nửa CHỈNH có mã đúng trong 5;
//   M3 = số ô ảnh thật có nhãn mã ở nửa CHỈNH có mã đúng ở vị trí 1.
//   GIỮ cách khi: M1 > M1 nền (= 0) VÀ nửa GIỮ RIÊNG (ảnh thật có nhãn mã) 0 ô mất vị trí 1, 0 ô rơi khỏi 5 so với nền.
//   Chọn trong các cách được giữ theo M1 > M2 > M3 (lớn trước); hòa → cách đứng trước trong STEP3_GRID.
//   Cách được chọn mà M1 hơn nền CHỈ nhờ 1 ảnh, hoặc chỉ nhờ ảnh thư mục 2 (bỏ ô thư mục 2 thì M1 không hơn nền), hoặc
//   chỉ nhờ ảnh preset → vẫn chọn theo luật nhưng ghi rõ "chỉ để tham khảo". Mọi số thư mục 2 ghi "chỉ để tham khảo
//   (n ≤ 2)".
//
// ---- BƯỚC 4: ngưỡng "chưa chắc" (đo SAU bước 3, trên kết quả gộp MÁY của cách bước 3 được chọn; không có cách nào được
//   chọn → trên nền serverMerge; gọi là "nền bước 4") ----
// Ý: "chưa chắc" → không tự mở, hiện "Chưa chắc chắn" + gợi ý + 3 nút (Quét mã vạch, Nhập số mã, Góp sản phẩm). Chỉ áp
//   cho đường MÁY; đường LÙI và "Tìm lại" không đổi (chưa đo).
// Đặc trưng của mục 1 (m = danh sách gộp, m[0] = mục 1; ô không có mục 1 → không xét, vốn đã không tự mở):
//   f1 diem = điểm mục 1 (điểm gộp gắn vào mục: BM25 / c-idf);
//   f2 ty-le = điểm mục 1 / điểm mục 2 (không có mục 2 hoặc điểm mục 2 ≤ 0 → +∞);
//   f3 khoang-cach = điểm mục 1 − điểm mục 2 (không có mục 2 → điểm mục 1);
//   f4 ty-le-tu = số từ khác nhau của câu tìm T1 khớp tài liệu mục 1 (đúng cách chấm của gộp: danh mục → tài liệu danh
//      mục; máy chủ ngoài danh mục → c-idf trên chữ bản S với idf từ lạ của cách; OFF → offDoc) / số từ khác nhau của câu
//      tìm (câu rỗng → 0);
//   f5 hang-may-chu = hạng mã mục 1 trong S (1–10; không có = 11).
// Ngưỡng (STEP4_GRID; 5 giá trị mỗi đặc trưng, mỗi luật MỘT đặc trưng, không ghép): tính trên 120 giá trị = 60 ảnh A/B ×
//   (i)(ii) ở nền bước 4 (phân vị nearest rank; +∞ đứng cuối):
//   f1–f4: ngưỡng = phân vị p ∈ {10, 20, 30, 40, 50} %; "chưa chắc" khi giá trị < ngưỡng (bằng ngưỡng = chắc).
//   f5 (nhỏ = tốt): ngưỡng = phân vị (100 − p) % (tức phân vị p của −hạng); "chưa chắc" khi hạng > ngưỡng.
//   Chốt cách tính, không chốt số; không chỉnh ngưỡng sau khi xem ca âm.
// Cổng bước 4 (mọi ô (i)(ii) ở nền bước 4 có kind "open" và mục 1 đúng phải còn "chắc", tức vẫn tự mở): ảnh thật có nhãn
//   mã đang đúng ở vị trí 1 (8 ảnh ở nền serverMerge), mọi ảnh A/B đang đúng ở vị trí 1, 7Up (2 ca), buldak, các ca ngoại
//   đang đúng ở vị trí 1. Muối Co.op là CA ÂM (chỉ báo; chuyển sang "chưa chắc" là tốt), KHÔNG phải cổng.
// Mục tiêu bước 4: T = số ảnh thư mục 3 (6 ảnh "không có dữ liệu") KHÔNG tự mở (chưa chắc ở cả (i) và (ii)); nền T = 0.
//   Chọn trên nửa CHỈNH (3 ảnh): T chỉnh lớn nhất, phải ≥ 1; chỉ GIỮ khi nửa GIỮ RIÊNG cũng có T giữ ≥ 1 (≥ 1 / 3 ảnh).
//   Hòa → luật ít can thiệp hơn (ít ô A/B bị chuyển sang "chưa chắc" hơn); hòa nữa → thứ tự f1 → f5, rồi p nhỏ trước.
//   Chỉ báo: số ô A/B có mục 1 SAI được chuyển sang "chưa chắc"; muối.
// Bài học nang-t1 (13/11/2026): luật rel ≥ 0,2468 đúng 0,93 ở nhóm chỉnh nhưng chỉ 0,40 ở nhóm giữ riêng và báo "chắc"
//   sai ca muối Co.op → ngưỡng chọn trên ít ảnh rất dễ "khớp" nhóm chỉnh; vì vậy bắt buộc nửa giữ riêng cũng giảm.
//
// Không cách nào đạt ở cả bước 3 và bước 4 → không đổi code app, chỉ ghi PLAN.md.
// Chỉ dùng dữ liệu app đã có (candidates: code, name, brand, text, score; T1 1.452; OFF). Không đổi máy chủ.
// Cờ: --chi-nen (nền + kiểm chéo → nen.json), --do-cach (bước 3 → do.json), --do-nguong (bước 4, đọc do.json cùng
//   RULE_SHA256 để biết cách bước 3 được chọn → nguong.json). Ra D:\tmp\khau-gop\ket-qua\. Đúng một cờ; file ra đã có →
//   dừng (trừ --ghi-de). Kiểm chéo lệch → <tên>.loi.json (KHÔNG ghi file chính), thoát mã 3.
// Kiểm chéo bắt buộc (mọi cờ): (0) mergeLocal tham số nền = serverMerge src mọi ô; (1) nền MÁY A/B = perCase.may của
//   nen.json may-chu-loc 120 / 120 ô; (2) 22 ảnh thật top 5 + món tự mở + kind ở (ii) = ket-qua-goc.json 22 / 22, S ảnh thật
//   = perCase.S của nen.json 22 / 22; (3) LÙI = photoMerge src mọi ô; (4) bảng nền = bảng nền may-chu-loc (A 13/19,
//   B 14/19, thư mục 1 chỉnh 3/4, giữ 5/6, 7Up 2/2, buldak 1/1, ngoại 5/6, muối open, 6 ảnh thư mục 3 open).
// Tự kiểm: khối luật kiểm bằng sha256 (RULE_SHA256, đặt ngoài khối sau commit luật) và so từng byte với commit luật
//   (git show); đo chỉ chạy khi worktree sạch và khối luật trùng; lệch → thoát mã 3.
// ===================================================================================================================
export const BASE_SHA = "36c5fd7";
export const SERVER_K = 10;
export const FOUND_K = 5;
export const MERGE_K = 5;
export const CONDS = Object.freeze(["i", "ii"]);
export const FOLDERS = Object.freeze(["1-ra-dung", "2-ma-vach-ra", "3-khong-ra"]);
export const CODE_7UP_DIET = "8934588752117";
export const BULDAK_CODE = "8801073250574";
export const RUAYPUAN_CODE = "8852052150101";
export const RRF_K = 60;
export const G4_MAX_MS = 50;
export const G4_MAX_RATIO = 2;
export const TIME_REPEAT = 20;
export const TIME_WARM = 2;
export const BASE_PARAMS = Object.freeze({
  lockTop: 3, offMax: 1, offGap: 1, promoteGap: 3, promoteMinWords: 3, idfMul: 1,
  serverTop: 0, rrf: false, srvFreeMax: false, lockByScore: false, s1Promote: 0,
});
export const LOCK_SCORE_MIN_WORDS = 2;
export const STEP3_GRID = Object.freeze({
  "b-lock2": { lockTop: 2 }, "b-lock1": { lockTop: 1 }, "b-lock0": { lockTop: 0 },
  "b-max2": { offMax: 2 }, "b-max3": { offMax: 3 },
  "b-gap0": { promoteGap: 0 }, "b-gap1": { promoteGap: 1 },
  "b-mw2": { promoteMinWords: 2 }, "b-mw1": { promoteMinWords: 1 },
  "c-idf0.5": { idfMul: 0.5 }, "c-idf0.75": { idfMul: 0.75 }, "c-idf1.25": { idfMul: 1.25 },
  "a-top1": { serverTop: 1 }, "a-top2": { serverTop: 2 }, "a-top3": { serverTop: 3 },
  "c-rrf": { rrf: true },
  "d-srv-max": { srvFreeMax: true }, "d-lock-diem": { lockByScore: true }, "d-s1-w2": { s1Promote: 2 },
  "g-max-lock": { srvFreeMax: true, lockByScore: true }, "g-max-s1": { srvFreeMax: true, s1Promote: 2 },
});
export const STEP4_FEATURES = Object.freeze(["diem", "ty-le", "khoang-cach", "ty-le-tu", "hang-may-chu"]);
export const STEP4_PERCENTS = Object.freeze([10, 20, 30, 40, 50]);
export const STEP4_HOLDOUT_MIN = 1;
// ===================================================================================================================
// HẾT KHỐI LUẬT
// ===================================================================================================================
