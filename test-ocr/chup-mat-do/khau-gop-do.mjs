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
// Sửa luật 2026-11-20 vòng 2 (LỆCH LUẬT, TRƯỚC mọi số của cách / ngưỡng; luật gốc b954513): cách chỉ để tham khảo không được chọn; nền G4 = mergeLocal tham số nền.
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
//      làm nóng; p95 nearest rank; nền đo bằng mergeLocal tham số nền (BASE_PARAMS) trong cùng lần chạy, ngay trước cách
//      (mergeLocal nền = serverMerge src từng mục, kiểm chéo (0)); p95 serverMerge src ghi chỉ báo. Qua khi p95 cách
//      ≤ 50 ms VÀ ≤ 2 × p95 nền.
//   G5 không đổi server/, public/ (danh mục, kho phụ), package.json, package-lock.json, src/off-search.js so với
//      36c5fd7 (git diff --quiet); lúc chạy: CONFIDENCE_RULE null / null, STRANGE_MODE null, SERVER_MERGE_OPTS,
//      DEFAULT_GUARD, SERVER_MAX như nền; câu OFF từng ca trùng nền; LÙI từng ô trùng nền.
// Mục tiêu bước 3 (chỉ xét cách qua MỌI cổng; đếm theo Ô = ảnh × (i)(ii)):
//   X = ảnh thật có nhãn mã (thư mục 1 + 2, kể cả preset) mà nền CHƯA ở vị trí 1 ("xếp hạng sai"; tính mỗi ô).
//   M1 = số ô của X ở nửa CHỈNH có mã đúng ở vị trí 1; M2 = số ô của X ở nửa CHỈNH có mã đúng trong 5;
//   M3 = số ô ảnh thật có nhãn mã ở nửa CHỈNH có mã đúng ở vị trí 1.
//   GIỮ cách khi: M1 > M1 nền (= 0) VÀ nửa GIỮ RIÊNG (ảnh thật có nhãn mã) 0 ô mất vị trí 1, 0 ô rơi khỏi 5 so với nền.
//   Chọn trong các cách được giữ theo M1 > M2 > M3 (lớn trước); hòa → cách đứng trước trong STEP3_GRID.
//   Cách được giữ mà M1 hơn nền chỉ nhờ 1 ảnh, hoặc chỉ nhờ ảnh thư mục 2 (bỏ ô thư mục 2 thì M1 không hơn nền), hoặc
//   chỉ nhờ ảnh preset, thì là "chỉ để tham khảo": KHÔNG được chọn, vẫn ghi số / tên / lý do (chỉ báo), không sửa src/,
//   không làm nền bước 4. Chọn trong các cách được giữ và KHÔNG chỉ để tham khảo theo M1 > M2 > M3; hòa → thứ tự
//   STEP3_GRID. Không còn cách nào → "không cách nào đạt ở bước 3", bước 4 đo trên nền serverMerge. Các cách chỉ để tham
//   khảo ghi PLAN.md để chủ dự án quyết ở đợt sau. Mọi số thư mục 2 ghi "chỉ để tham khảo (n ≤ 2)".
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

// ---------------- code đo (viết SAU commit luật b954513; cài đúng định nghĩa trong khối luật ở trên) ----------------
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { bm25DocScore, serverDocScore, offDoc, maxIdfOf } from "../../src/front-merge.js";
import { serverJoin } from "../../src/front-server.js";
import { frontImageUrl } from "../../src/front-search.js";
import { keyOf, rankIn, ruleBlockOf, sha256Of } from "./g2-di-qua-do.mjs";
import { splitHalves, lossRows } from "./may-chu-loc-do.mjs";

/** Commit luật và file (tự kiểm từng byte bằng git show). Luật sửa ở vòng 2 (LỆCH LUẬT, trước mọi số của cách / ngưỡng). */
export const RULE_SHA = "55fc738";
/** Commit luật gốc (vòng 1, sha256 khối 530a08ae…f8b2); chỉ để truy vết, tự kiểm dùng RULE_SHA. */
export const RULE_SHA_GOC = "b954513";
export const RULE_SHA256_GOC = "530a08ae4475cc3ab6271548c924daa8ed800145d61e1c79bb324d465fdef8b2";
export const RULE_FILE = "test-ocr/chup-mat-do/khau-gop-do.mjs";
/** sha256 (hex) của khối luật ở commit RULE_SHA. */
export const RULE_SHA256 = "8ef14602ba7d3cf5ae675794567d3b20be431a63c5a99b4de98baefc945e2965";
/** Ba chế độ chạy (đúng một cờ) → tên file ra. */
export const MODES = Object.freeze({ "--chi-nen": "nen", "--do-cach": "do", "--do-nguong": "nguong" });

/**
 * Phán tự kiểm (thuần): khối luật hiện tại (now) và ở commit luật (old), worktree dirty.
 * Trả { exitCode: 0 | 3, lines }. Khối không tìm thấy / sha256 khác RULE_SHA256 / khác từng byte commit / dirty → 3.
 */
export function selfCheck({ now, old, dirty }) {
  const lines = [];
  if (typeof now !== "string") lines.push("Tự kiểm: không tìm thấy khối luật trong file hiện tại.");
  else if (sha256Of(now) !== RULE_SHA256) lines.push(`Tự kiểm: khối luật sha256 ${sha256Of(now)} ≠ RULE_SHA256 ${RULE_SHA256}.`);
  if (typeof old !== "string") lines.push(`Tự kiểm: không đọc được khối luật ở commit ${RULE_SHA}.`);
  else if (typeof now === "string" && now !== old) lines.push(`Tự kiểm: khối luật khác từng byte commit ${RULE_SHA}.`);
  if (dirty !== false) lines.push(`Tự kiểm: worktree ${dirty === null ? "không đọc được trạng thái git" : "KHÔNG sạch"}, không đo.`);
  return lines.length ? { exitCode: 3, lines } : { exitCode: 0, lines: ["Tự kiểm: khối luật trùng, worktree sạch."] };
}

/** Cờ dòng lệnh → chế độ ("nen" | "do" | "nguong") hoặc null (không cờ / nhiều cờ). */
export function modeOf(argv) {
  const on = Object.keys(MODES).filter((f) => (argv || []).includes(f));
  return on.length === 1 ? MODES[on[0]] : null;
}

/** File ra: kiểm chéo đạt → <stem>.json, thoát 0; lệch → <stem>.loi.json, thoát 3 (không ghi file chính). */
export function resultFile(outDir, stem, allOk) {
  return allOk ? { file: path.join(outDir, `${stem}.json`), exitCode: 0 } : { file: path.join(outDir, `${stem}.loi.json`), exitCode: 3 };
}

/** Tham số gộp của một cách (null = nền). Tên lạ → lỗi. */
export function paramsOf(name) {
  if (name == null) return { ...BASE_PARAMS };
  if (!Object.hasOwn(STEP3_GRID, name)) throw new Error(`khau-gop: cách không có trong lưới: ${name}`);
  return { ...BASE_PARAMS, ...STEP3_GRID[name] };
}

// ---------------- gộp tham số (bản sao nhánh f1 của mergeFront với tùy chọn của serverMerge) ----------------
// mergeLocal(…, BASE_PARAMS) PHẢI trùng serverMerge(…).merged của src từng mục (kiểm chéo (0) lúc chạy + test).

/** Bảng mã → chỉ số trong products (mã đầu tiên), dựng một lần cho mỗi mảng products (WeakMap), dùng chung. */
const CODE_INDEX = new WeakMap();
export function codeIndexOf(products) {
  if (!Array.isArray(products)) return new Map();
  let m = CODE_INDEX.get(products);
  if (!m) {
    m = new Map();
    products.forEach((p, i) => { if (p && typeof p.code === "string" && !m.has(p.code)) m.set(p.code, i); });
    CODE_INDEX.set(products, m);
  }
  return m;
}

function catalogItem(p, score = null) {
  return { code: p.code, name: String(p.name ?? ""), brand: String(p.brand ?? ""), img: frontImageUrl(p.code, p.img), source: "catalog", vn: true, score };
}

function offItem(h, score = null) {
  const it = { code: h.code, name: String(h.name ?? ""), brand: String(h.brand ?? ""), img: String(h.img ?? ""), source: "off", vn: h.vn === true, score };
  if (h.extra === true) it.extra = true;
  return it;
}

function t1Items(products, t1Result, k) {
  const out = [];
  for (const h of t1Result?.hits || []) {
    const p = products[h?.i];
    if (!p || p.code !== h.code) continue;
    out.push(catalogItem(p, Number.isFinite(h.score) ? h.score : null));
    if (out.length >= k) break;
  }
  return out;
}

/**
 * Lớp chặn như applyGuard của front-merge.js; free (Set mã | null) = mã KHÔNG tính vào offMax và không bị gạt
 * (d-srv-max: mã trong S).
 */
export function applyGuardLocal(ranked, base, { k, lockTop, offMax, free = null }) {
  const lock = base.slice(0, Math.min(lockTop, base.length));
  const out = [...lock];
  const have = new Set(lock.map((x) => x.code));
  const spare = [];
  let offs = 0;
  for (const it of ranked) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    const counts = it.source === "off" && !(free && free.has(it.code));
    if (counts && offs >= offMax) { spare.push(it); continue; }
    if (counts) offs++;
    have.add(it.code);
    out.push(it);
  }
  for (const it of spare) {
    if (out.length >= k) break;
    if (have.has(it.code)) continue;
    have.add(it.code);
    out.push(it);
  }
  return out.slice(0, k);
}

/**
 * Bảng chấm theo mã (cùng tài liệu / cách chấm mergeLocal dùng), cho a-top* và đặc trưng bước 4:
 * scoreOf(code) → { score, matched, item | null }. Danh mục → tài liệu danh mục (mã có trong T1 thì điểm = điểm T1);
 * ngoài danh mục → mục đầu tiên cùng mã của serverJoin (bản OFF nếu có), chấm c-idf trên serverText (idf từ lạ =
 * maxIdf × idfMul) hoặc BM25 trên chữ OFF. Khớp 0 từ → điểm 0.
 */
export function scoreTable({ t1, rIndex, products }, found, joined, idfMul = 1) {
  const list = Array.isArray(products) ? products : [];
  const index = rIndex.index;
  const byCode = codeIndexOf(products);
  const query = Array.isArray(found?.query) ? found.query : [];
  const t1Score = new Map((found?.hits || []).map((h) => [h.code, h.score]));
  const unknownIdf = maxIdfOf(index) * idfMul;
  const hits = joined && joined.ok === true && Array.isArray(joined.hits) ? joined.hits : [];
  return (code) => {
    if (byCode.has(code)) {
      const i = byCode.get(code);
      const doc = index.tf[i];
      const r = doc && doc.code === code ? bm25DocScore(index, doc, query) : { score: 0, matched: 0 };
      const score = r.matched ? (t1Score.has(code) && Number.isFinite(t1Score.get(code)) ? t1Score.get(code) : r.score) : 0;
      return { score, matched: r.matched, item: catalogItem(list[i], score) };
    }
    const h = hits.find((x) => x && x.code === code);
    if (!h) return { score: 0, matched: 0, item: null };
    const r = typeof h.serverText === "string"
      ? serverDocScore(index, offDoc(t1, h.serverText), query, unknownIdf)
      : bm25DocScore(index, offDoc(t1, h.text || `${h.name ?? ""} ${h.brand ?? ""}`), query);
    const score = r.matched ? r.score : 0;
    return { score, matched: r.matched, item: offItem(h, score) };
  };
}

/**
 * Gộp MÁY theo tham số p (BASE_PARAMS = nền = serverMerge). ctx = { t1, rIndex, products }; found = rankFromItems /
 * rankFromText; off = joinOffResults(…); S = serverCandidates(…). Trả ≤ k mục (dạng mergeFront).
 */
export function mergeLocal(ctx, found, off, S, params = BASE_PARAMS, k = MERGE_K) {
  const P = { ...BASE_PARAMS, ...params };
  const server = Array.isArray(S) ? S : [];
  const joined = serverJoin(off, server); // serverJoin MỘT lần, dùng chung cho gộp và bảng điểm của a-top
  if (P.serverTop > 0) {
    // (a) k vị trí đầu = S[0..k−1] theo thứ tự S; phần sau = gộp nền (đủ lớp chặn + offPromote) với k + n, bỏ mã đã đặt
    const n = Math.min(P.serverTop, server.length);
    const rest = mergeCore(ctx, found, joined, server, P, k + n);
    const sc = scoreTable(ctx, found, joined, P.idfMul);
    const top = server.slice(0, n).map((h) => sc(h.code).item ?? offItem(h, 0));
    const have = new Set(top.map((x) => x.code));
    return [...top, ...rest.filter((x) => !have.has(x.code))].slice(0, k);
  }
  return mergeCore(ctx, found, joined, server, P, k);
}

/** Phần gộp của mergeLocal (không có a-top): joined = serverJoin(off, server) đã tính. */
function mergeCore(ctx, found, joined, server, P, k) {
  const { t1, rIndex, products } = ctx;
  const list = Array.isArray(products) ? products : [];
  const base = t1Items(list, found, k);
  if (!(joined && joined.ok === true && Array.isArray(joined.hits) && joined.hits.length)) return base;
  const index = rIndex.index;
  const byCode = codeIndexOf(products);
  const offs = [];
  const seenOff = new Set();
  for (const h of joined.hits) {
    if (!h || typeof h.code !== "string" || seenOff.has(h.code)) continue;
    seenOff.add(h.code);
    offs.push(byCode.has(h.code) ? { inCatalog: true, i: byCode.get(h.code), h } : { inCatalog: false, h });
  }
  const query = Array.isArray(found?.query) ? found.query : [];
  const unknownIdf = maxIdfOf(index) * P.idfMul;
  const docMatched = (code) => {
    const i = byCode.get(code);
    const doc = i == null ? null : index.tf[i];
    return doc && doc.code === code ? bm25DocScore(index, doc, query).matched : 0;
  };
  const cands = new Map();
  let order = 0;
  for (const it of base) cands.set(it.code, { item: it, score: it.score ?? 0, rankScore: it.score ?? 0, tier: 0, vn: true, src: 0, order: order++, matched: docMatched(it.code) });
  for (const o of offs) {
    if (o.inCatalog) {
      const p = list[o.i];
      if (cands.has(p.code)) continue;
      const doc = index.tf[o.i];
      const { score, matched } = doc && doc.code === p.code ? bm25DocScore(index, doc, query) : { score: 0, matched: 0 };
      if (matched < 1) continue;
      cands.set(p.code, { item: catalogItem(p, score), score, rankScore: score, tier: 0, vn: true, src: 0, order: order++, matched });
    } else {
      if (cands.has(o.h.code)) continue;
      const extra = o.h.extra === true;
      const { score, matched } = typeof o.h.serverText === "string"
        ? serverDocScore(index, offDoc(t1, o.h.serverText), query, unknownIdf)
        : bm25DocScore(index, offDoc(t1, o.h.text || `${o.h.name ?? ""} ${o.h.brand ?? ""}`), query);
      if (matched < 1) continue;
      cands.set(o.h.code, { item: offItem(o.h, score), score, rankScore: score - P.offGap, tier: 0, vn: o.h.vn === true, src: 1, order: order++, matched, extra });
    }
  }
  let sorted = [...cands.values()]
    .sort((a, b) => a.tier - b.tier || b.rankScore - a.rankScore || (b.vn - a.vn) || a.src - b.src || a.order - b.order);
  if (P.rrf) {
    // c-rrf: 1 / (60 + hạng trước chặn) + 1 / (60 + hạng trong S) (mã trong S); hòa → thứ tự trước chặn
    const sRank = new Map();
    server.forEach((h, j) => { if (!sRank.has(h.code)) sRank.set(h.code, j + 1); });
    sorted = sorted
      .map((c, j) => ({ c, j, r: 1 / (RRF_K + j + 1) + (sRank.has(c.item.code) ? 1 / (RRF_K + sRank.get(c.item.code)) : 0) }))
      .sort((a, b) => b.r - a.r || a.j - b.j)
      .map((x) => x.c);
  }
  const toItem = (x) => ({ ...x.item, score: x.score });
  let lockTop = P.lockTop;
  if (P.lockByScore) {
    // d-lock-diem: mục T1 giữ khóa (tiền tố) khi điểm ≥ M = điểm cao nhất của mục máy chủ ngoài danh mục khớp ≥ 2 từ
    let M = null;
    for (const c of sorted) if (c.src === 1 && !c.extra && c.matched >= LOCK_SCORE_MIN_WORDS && (M === null || c.score > M)) M = c.score;
    if (M !== null) {
      let n = 0;
      while (n < Math.min(lockTop, base.length) && (cands.get(base[n].code)?.score ?? 0) >= M) n++;
      lockTop = n;
    }
  }
  const free = P.srvFreeMax ? new Set(server.map((h) => h.code)) : null;
  const ref = base.length ? (cands.get(base[0].code)?.score ?? 0) : 0;
  let best = null;
  if (P.s1Promote > 0 && server.length) {
    // d-s1-w2: mục S hạng 1 khớp ≥ s1Promote từ, điểm ≥ điểm T1 mục 1 → vị trí 1 (thay offPromote)
    const c = cands.get(server[0].code);
    if (c && c.matched >= P.s1Promote && c.score >= ref) best = c;
  }
  if (!best && (free || P.offMax >= 1) && k >= 1) {
    let b = null;
    for (const c of sorted) if (c.src === 1 && !c.extra && c.matched >= P.promoteMinWords && (!b || c.score > b.score)) b = c;
    if (b && b.score >= ref + P.promoteGap) best = b;
  }
  if (best) {
    const counts = best.src === 1 && !(free && free.has(best.item.code));
    const rest = applyGuardLocal(sorted.filter((c) => c !== best).map(toItem), base.filter((x) => x.code !== best.item.code),
      { k: k - 1, lockTop, offMax: counts ? P.offMax - 1 : P.offMax, free });
    return [toItem(best), ...rest].slice(0, k);
  }
  return applyGuardLocal(sorted.map(toItem), base, { k, lockTop, offMax: P.offMax, free });
}

// ---------------- phán bước 3 ----------------
/**
 * r = { ab: [{ id, base, got }] (A + B, MÁY, mỗi ô), good: [{ id, base, got }] (ảnh thật nền đang đúng), s7: { "may|i",
 * "may|ii", "go|i", "go|ii": vị trí }, buldak: { i, ii: mã mục 1 }, salt: { "may|i", "may|ii", "lui|i", "lui|ii": kind },
 * foreign: { base: { top1, top5 }, got }, time: { p95, baseP95 }, srcSame, consts: {…: bool}, offSame, luiSame }.
 * Trả { gates: { G1…G5 }, fails, pass }.
 */
export function judge3(r) {
  const fails = [];
  const g = {};
  const ab = lossRows(r?.ab || []);
  g.G1 = Array.isArray(r?.ab) && r.ab.length > 0 && !ab.lostTop1.length && !ab.out5.length && r?.luiSame === true;
  if (!g.G1) fails.push(`G1 A+B: mất vị trí 1 [${ab.lostTop1.join(", ")}], rơi khỏi 5 [${ab.out5.join(", ")}], LÙI ${r?.luiSame}${r?.ab?.length ? "" : " (thiếu số)"}`);
  const gd = lossRows((r?.good || []).map((x) => ({ ...x, base: 1 })));
  g.G2 = Array.isArray(r?.good) && r.good.length > 0 && !gd.lostTop1.length;
  if (!g.G2) fails.push(`G2 ảnh thật đang đúng: mất vị trí 1 [${gd.lostTop1.join(", ")}]${r?.good?.length ? "" : " (thiếu số)"}`);
  let g3 = true;
  for (const k of ["may|i", "may|ii", "go|i", "go|ii"]) if (r?.s7?.[k] !== 1) { g3 = false; fails.push(`G3 7Up ${k}: vị trí ${r?.s7?.[k] ?? "ngoài 5"}`); }
  for (const c of CONDS) if (r?.buldak?.[c] !== BULDAK_CODE) { g3 = false; fails.push(`G3 buldak ${c}: mục 1 ${r?.buldak?.[c] ?? "rỗng"}`); }
  for (const k of ["may|i", "may|ii", "lui|i", "lui|ii"]) if (r?.salt?.[k] !== "open") { g3 = false; fails.push(`G3 muối ${k}: ${r?.salt?.[k]}`); }
  const fb = r?.foreign?.base;
  const fg = r?.foreign?.got;
  if (!fb || !fg || fg.top1 < fb.top1 || fg.top5 < fb.top5) { g3 = false; fails.push(`G3 ngoại: ${JSON.stringify(fg)} < nền ${JSON.stringify(fb)}`); }
  g.G3 = g3;
  const p95 = r?.time?.p95;
  const b95 = r?.time?.baseP95;
  g.G4 = Number.isFinite(p95) && Number.isFinite(b95) && p95 <= G4_MAX_MS && p95 <= G4_MAX_RATIO * b95;
  if (!g.G4) fails.push(`G4 thời gian gộp p95 ${p95} ms (nền ${b95} ms; trần ${G4_MAX_MS} ms và ${G4_MAX_RATIO} × nền)`);
  g.G5 = r?.srcSame === true && !!r?.consts && Object.values(r.consts).length > 0 && Object.values(r.consts).every((v) => v === true)
    && r?.offSame === true && r?.luiSame === true;
  if (!g.G5) fails.push(`G5: src/server/public ${r?.srcSame}, hằng số ${JSON.stringify(r?.consts)}, câu OFF ${r?.offSame}, LÙI ${r?.luiSame}`);
  return { gates: g, fails, pass: Object.values(g).every(Boolean) };
}

/**
 * Mục tiêu bước 3. rows = [{ id, img (số ảnh), group: "chinh" | "giu", folder, preset, base, got }] — mỗi ô ảnh thật có
 * nhãn mã (base / got = vị trí trong 5 hoặc null). Trả { M1, M2, M3, holdLost, holdOut, holdOk, m1Imgs, refOnly: [lý do] }.
 */
export function target3(rows) {
  const R = Array.isArray(rows) ? rows : [];
  const ch = R.filter((x) => x.group === "chinh");
  const X = ch.filter((x) => x.base !== 1);
  const m1 = X.filter((x) => x.got === 1);
  const hold = lossRows(R.filter((x) => x.group === "giu"));
  const m1Imgs = [...new Set(m1.map((x) => x.img))];
  const refOnly = [];
  if (m1.length) {
    if (m1Imgs.length === 1) refOnly.push("chỉ nhờ 1 ảnh");
    if (!m1.some((x) => x.folder !== "2-ma-vach-ra")) refOnly.push("chỉ nhờ ảnh thư mục 2");
    if (!m1.some((x) => !x.preset)) refOnly.push("chỉ nhờ ảnh preset");
  }
  return {
    M1: m1.length, M2: X.filter((x) => x.got != null).length, M3: ch.filter((x) => x.got === 1).length,
    holdLost: hold.lostTop1, holdOut: hold.out5, holdOk: !hold.lostTop1.length && !hold.out5.length, m1Imgs, refOnly,
  };
}

/**
 * Chọn cách bước 3 (luật sửa vòng 2): list = [{ name, pass, t: target3 }]. Giữ khi pass, M1 > baseM1 (= 0), holdOk.
 * Cách được giữ có t.refOnly khác rỗng = "chỉ để tham khảo": KHÔNG được chọn (chỉ báo). Chọn trong các cách được giữ
 * và không chỉ để tham khảo theo M1 > M2 > M3, hòa → thứ tự STEP3_GRID.
 * Trả { name | null, kept: [tên], refOnly: [{ name, reasons, M1, M2, M3 }] (theo thứ tự xếp) }.
 */
export function pickStep3(list, baseM1 = 0, order = Object.keys(STEP3_GRID)) {
  const kept = (list || []).filter((m) => m.pass && m.t.M1 > baseM1 && m.t.holdOk && order.includes(m.name));
  kept.sort((a, b) => b.t.M1 - a.t.M1 || b.t.M2 - a.t.M2 || b.t.M3 - a.t.M3 || order.indexOf(a.name) - order.indexOf(b.name));
  const isRef = (m) => Array.isArray(m.t.refOnly) && m.t.refOnly.length > 0;
  const normal = kept.filter((m) => !isRef(m));
  return {
    name: normal[0]?.name ?? null,
    kept: kept.map((m) => m.name),
    refOnly: kept.filter(isRef).map((m) => ({ name: m.name, reasons: [...m.t.refOnly], M1: m.t.M1, M2: m.t.M2, M3: m.t.M3 })),
  };
}

/** --do-nguong: mỗi đặc trưng phải có đúng want (120) giá trị A/B. Trả { ok, counts, bad: [đặc trưng] }. */
export function checkStep4Values(values, want = 120) {
  const counts = Object.fromEntries(STEP4_FEATURES.map((f) => [f, Array.isArray(values?.[f]) ? values[f].length : 0]));
  const bad = STEP4_FEATURES.filter((f) => counts[f] !== want);
  return { ok: bad.length === 0, counts, bad };
}

// ---------------- bước 4 ----------------
/**
 * Đặc trưng của mục 1 (khối luật f1–f5). m = danh sách gộp; matched = số từ khớp của mục 1; queryN = số từ khác nhau
 * của câu tìm; sCodes = mã S theo thứ tự. m rỗng → null.
 */
export function featuresOf(m, { matched, queryN, sCodes }) {
  if (!Array.isArray(m) || !m.length) return null;
  const s1 = Number.isFinite(m[0].score) ? m[0].score : 0;
  const has2 = m.length > 1;
  const s2 = has2 && Number.isFinite(m[1].score) ? m[1].score : 0;
  const j = (sCodes || []).indexOf(m[0].code);
  return {
    diem: s1,
    "ty-le": has2 && s2 > 0 ? s1 / s2 : Infinity,
    "khoang-cach": s1 - (has2 ? s2 : 0),
    "ty-le-tu": queryN > 0 ? (matched || 0) / queryN : 0,
    "hang-may-chu": j < 0 ? SERVER_K + 1 : j + 1,
  };
}

/** Phân vị nearest rank (p trong 0–1); +∞ đứng cuối; mảng rỗng → null. */
export function quantileNR(xs, p) {
  const s = (xs || []).filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length - 1e-9) - 1))];
}

/**
 * Lưới luật bước 4 từ giá trị đặc trưng của nhóm A/B: values = { đặc trưng: [số] } → [{ name, feature, p, thr, dir }]
 * (thứ tự f1 → f5, p tăng dần). f1–f4: ngưỡng phân vị p, "chưa chắc" khi < ngưỡng; f5: phân vị 100 − p, khi > ngưỡng.
 */
export function step4Rules(values) {
  const out = [];
  for (const f of STEP4_FEATURES) for (const p of STEP4_PERCENTS) {
    const lower = f !== "hang-may-chu";
    out.push({ name: `${f}-p${p}`, feature: f, p, thr: quantileNR(values?.[f] || [], (lower ? p : 100 - p) / 100), dir: lower ? "lt" : "gt" });
  }
  return out;
}

/** "Chưa chắc" theo một luật (không có đặc trưng = không xét = false). */
export function isUnsure(rule, feats) {
  if (!feats || rule?.thr == null) return false;
  const v = feats[rule.feature];
  return rule.dir === "lt" ? v < rule.thr : v > rule.thr;
}

/**
 * Phán + mục tiêu một luật bước 4. cells = [{ id, set, folder, group, cond, good (mục 1 đúng + open ở nền bước 4 và
 * thuộc tập cổng), wrongAB (ô A/B mục 1 sai), none3 (ảnh thư mục 3), img, salt, open (kind "open" ở nền bước 4), feats }].
 * Ô thư mục 3 có danh sách gộp rỗng (feats null) hoặc open === false → "không tự mở" (vốn đã không tự mở).
 * Trả { pass, gateFails: [id], tChinh, tGiu, abUnsure, abWrongUnsure, saltUnsure }.
 */
export function judge4(rule, cells) {
  const C = Array.isArray(cells) ? cells : [];
  const u = (c) => isUnsure(rule, c.feats);
  const notOpen = (c) => c.open === false || !c.feats || u(c);
  const gateFails = C.filter((c) => c.good && u(c)).map((c) => c.id);
  const imgs = (group) => {
    const by = new Map();
    for (const c of C.filter((x) => x.none3 && x.group === group)) by.set(c.img, (by.get(c.img) ?? true) && notOpen(c));
    return [...by.values()].filter(Boolean).length;
  };
  return {
    pass: gateFails.length === 0, gateFails, tChinh: imgs("chinh"), tGiu: imgs("giu"),
    abUnsure: C.filter((c) => (c.set === "A" || c.set === "B") && u(c)).length,
    abWrongUnsure: C.filter((c) => c.wrongAB && u(c)).length,
    saltUnsure: C.filter((c) => c.salt && u(c)).length,
  };
}

/** Chọn luật bước 4: giữ khi pass, tChinh ≥ 1, tGiu ≥ STEP4_HOLDOUT_MIN; tChinh lớn → abUnsure nhỏ → thứ tự lưới. */
export function pickStep4(list) {
  const order = (list || []).map((x) => x.name);
  const kept = (list || []).filter((x) => x.r.pass && x.r.tChinh >= 1 && x.r.tGiu >= STEP4_HOLDOUT_MIN);
  kept.sort((a, b) => b.r.tChinh - a.r.tChinh || a.r.abUnsure - b.r.abUnsure || order.indexOf(a.name) - order.indexOf(b.name));
  return { name: kept[0]?.name ?? null, kept: kept.map((x) => x.name) };
}

/** Thời gian (ms) trung bình mỗi lần gọi fn() của từng ô, sau warm lượt làm nóng; trả { p50, p95, n }. */
export function timeCells(cells, fn, { repeat = TIME_REPEAT, warm = TIME_WARM } = {}) {
  for (let w = 0; w < warm; w++) for (const c of cells) fn(c);
  const ms = [];
  for (const c of cells) {
    const t = process.hrtime.bigint();
    for (let r = 0; r < repeat; r++) fn(c);
    ms.push(Number(process.hrtime.bigint() - t) / 1e6 / repeat);
  }
  return { p50: quantileNR(ms, 0.5), p95: quantileNR(ms, 0.95), n: ms.length };
}

// ---------------- chạy ----------------
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const mode = modeOf(argv);
  if (!mode) {
    console.error("Cần đúng một cờ: --chi-nen (nền + kiểm chéo), --do-cach (bước 3) hoặc --do-nguong (bước 4).");
    process.exit(2);
  }
  const outDir = arg("--out", "D:\\tmp\\khau-gop\\ket-qua");
  const gocFile = arg("--goc", "D:\\tmp\\may-chu-loc\\ket-qua-goc.json");
  const nhanFile = arg("--nhan", "D:\\tmp\\may-chu-loc\\nhan.json");
  const nenFile = arg("--nen-mcl", "D:\\tmp\\may-chu-loc\\ket-qua\\nen.json");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const ocrDir = arg("--ocr", "D:\\tmp\\dong-noi-bat\\ocr");
  const { loadApp, makeDiskFetch, ROOT, SETS, LINES_7UP, TYPED_7UP } = await import("./tu-dong-do.mjs");
  const { foreignCases, MO_RONG } = await import("./tu-dong-v42-do.mjs");
  const { ALL_CODES, SALT_LINES, saltItems } = await import("./nang-t1-do.mjs");

  // ---- tự kiểm ----
  const startedAt = new Date().toISOString();
  const cp = await import("node:child_process");
  const git = (c) => { try { return cp.execSync(c, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString(); } catch { return null; } };
  const sha = git("git rev-parse HEAD")?.trim() ?? null;
  const porcelain = git("git status --porcelain");
  const dirty = porcelain === null ? null : porcelain.trim() !== "";
  const now = ruleBlockOf(fs.readFileSync(new URL(import.meta.url), "utf8"));
  const oldText = git(`git show ${RULE_SHA}:${RULE_FILE}`);
  const sc = selfCheck({ now, old: oldText === null ? null : ruleBlockOf(oldText), dirty });
  for (const l of sc.lines) (sc.exitCode ? console.error : console.log)(l);
  if (sc.exitCode) process.exit(sc.exitCode);
  const outFile = resultFile(outDir, mode, true).file;
  if (fs.existsSync(outFile) && !argv.includes("--ghi-de")) {
    console.error(`Đã có ${outFile}. Thêm --ghi-de nếu thật sự muốn ghi đè.`);
    process.exit(2);
  }
  let step3 = null;
  if (mode === "nguong") {
    const doFile = path.join(outDir, "do.json");
    if (!fs.existsSync(doFile)) { console.error(`--do-nguong cần ${doFile} (chạy --do-cach trước).`); process.exit(2); }
    step3 = JSON.parse(fs.readFileSync(doFile, "utf8"));
    if (step3.ruleSha256 !== RULE_SHA256 || step3.allOk !== true) { console.error("do.json khác RULE_SHA256 hoặc kiểm chéo lệch: không đo ngưỡng."); process.exit(3); }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const srcSame = git(`git diff --quiet ${BASE_SHA} -- src server public package.json package-lock.json`) !== null;

  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const osx = app.os;
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, ...rel.split("/"))).href);
  const fm = await imp("src/front-merge.js");
  const fx = await imp("src/front-extra.js");
  const fp = await imp("src/front-photo.js");
  const fsv = await imp("src/front-server.js");
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const ctx = { t1, rIndex, products };
  const consts = {
    confidenceNull: fr.CONFIDENCE_RULE.feature === null && fr.CONFIDENCE_RULE.threshold === null,
    strangeNull: osx.STRANGE_MODE === null,
    serverK: fsv.SERVER_MAX === SERVER_K,
    mergeOpts: JSON.stringify(fsv.SERVER_MERGE_OPTS) === JSON.stringify({ offPromote: { gap: 3, minWords: 3 }, serverIdf: true }),
    guard: fm.DEFAULT_GUARD.lockTop === 3 && fm.DEFAULT_GUARD.offMax === 1 && fm.DEFAULT_GUARD.offGap === 1
      && fm.DEFAULT_GUARD.offTopRule === null && fm.DEFAULT_GUARD.offPromote === null,
  };
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json"), "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);

  // ---- ca ----
  const goc = JSON.parse(fs.readFileSync(gocFile, "utf8"));
  const nhan = JSON.parse(fs.readFileSync(nhanFile, "utf8"));
  const nenMcl = JSON.parse(fs.readFileSync(nenFile, "utf8"));
  const halves = splitHalves(nhan.items);
  const labelOf = new Map(nhan.items.map((x) => [`${x.folder}/${x.file}`, x]));
  const halfOf = new Map(halves.map((x) => [`${x.folder}/${x.file}`, x]));
  const cases = [
    { set: "7up", kind: "may", code: CODE_7UP_DIET, input: { items: saltItems(LINES_7UP, 0.95) } },
    { set: "7up", kind: "go", code: CODE_7UP_DIET, input: { text: TYPED_7UP } },
    { set: "muoi", kind: "muoi", code: null, input: { items: saltItems(SALT_LINES, 0.9) } },
  ];
  for (const [name, code] of [["ruaypuan", RUAYPUAN_CODE], ["buldak", BULDAK_CODE]]) {
    const j = JSON.parse(fs.readFileSync(path.join(ocrDir, `${name}.json`), "utf8"));
    cases.push({ set: name, kind: "man-hinh", code, input: { items: j.items } });
  }
  for (const s of ["B", "A"]) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const code of ALL_CODES) {
      const items = bundle.items?.[code]?.items ?? null;
      cases.push({ set: s, kind: "anh", code, input: items ? { items } : null });
    }
  }
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), new Set(products.map((p) => p.code)), osx.strangeWords, idf);
  for (const f of foreign) cases.push({ set: "ngoai", kind: "ngoai", code: f.code, input: { items: saltItems(f.lines, 0.95) } });
  goc.items.forEach((it, n) => {
    const lab = labelOf.get(`${it.folder}/${it.file}`);
    if (!lab) throw new Error(`thiếu nhãn cho ảnh thật số ${n + 1}`);
    const half = halfOf.get(`${it.folder}/${it.file}`) ?? null;
    cases.push({
      set: "that", kind: `that-${n + 1}`, img: n + 1, code: lab.code && lab.code !== "none" ? lab.code : null, label: lab.code ?? null,
      preset: lab.preset === true, folder: it.folder, group: half?.group ?? null, goc: it, input: { items: it.items },
    });
  });
  const keys = new Set(cases.map(keyOf));
  if (keys.size !== cases.length) throw new Error(`khóa ca trùng: ${cases.length - keys.size}`);

  // ---- S đã lưu: ảnh thật = candidates (Python); ca khác = perCase.S của nen.json may-chu-loc + chữ từ c.jsonl.gz ----
  const need = new Set();
  for (const c of cases) if (c.set !== "that" && c.input) for (const code of nenMcl.perCase?.[keyOf(c)]?.S ?? []) need.add(code);
  const rowBy = new Map();
  const gz = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "server", "catalog", "c.jsonl.gz"))).toString("utf8");
  for (const line of gz.split("\n")) {
    const m = line && /"code":\s*"(\d+)"/.exec(line);
    if (!m || !need.has(m[1]) || rowBy.has(m[1])) continue;
    const row = JSON.parse(line);
    if (row.code === m[1]) rowBy.set(m[1], row);
  }
  const v = (x) => (x == null ? "" : x);
  for (const c of cases) {
    if (!c.input) continue;
    if (c.set === "that") { c.S = fsv.serverCandidates({ candidates: c.goc.candidates }); continue; }
    const codes = nenMcl.perCase?.[keyOf(c)]?.S;
    if (!Array.isArray(codes)) throw new Error(`thiếu S đã lưu cho ${c.set} ${c.kind}`);
    c.S = fsv.serverCandidates({
      candidates: codes.map((code, r) => {
        const x = rowBy.get(code);
        if (!x) throw new Error(`thiếu chữ ứng viên trong c.jsonl.gz (${c.set} ${c.kind})`);
        return { code, name: v(x.name), brand: v(x.brand), img: v(x.img), text: v(x.text), grp: v(x.grp), score: codes.length - r };
      }),
    });
    if (c.S.length !== codes.length) throw new Error(`S sai dạng (${c.set} ${c.kind})`);
  }

  // ---- found, câu OFF, OFF (i)(ii) ----
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1e9 });
  for (const c of cases) {
    if (!c.input) { c.found = null; c.queries = []; continue; }
    c.found = c.input.items ? fr.rankFromItems(t1, rIndex, c.input.items, FOUND_K) : fr.rankFromText(t1, rIndex, c.input.text, FOUND_K);
    c.queries = osx.cleanQuery(c.found.lines, { idf });
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.off = { i: c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" }, ii: fm.joinOffResults(per) };
    c.allOk = per.every((p) => p.ok === true);
  }
  const live = cases.filter((c) => c.found);
  const codesOf = (list) => list.map((x) => x.code);
  const sameArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const called = (c) => c.queries.length > 0;

  /** MÁY của một cách (tên null = nền: serverMerge của src); LÙI luôn photoMerge của src. */
  const mayOf = (c, cond, name) => {
    if (!c.S.length) return fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called: called(c) }).merged;
    return name == null ? fsv.serverMerge(ctx, c.found, c.off[cond], c.S, { called: called(c) }).merged : mergeLocal(ctx, c.found, c.off[cond], c.S, paramsOf(name));
  };
  const runMethod = (name) => {
    const out = {};
    for (const c of live) {
      const r = { may: {}, lui: {}, kind: {}, shown: {}, items: {} };
      for (const cond of CONDS) {
        const mm = mayOf(c, cond, name);
        const ml = fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called: called(c) }).merged;
        r.items[cond] = mm;
        r.may[cond] = codesOf(mm);
        r.lui[cond] = codesOf(ml);
        const om = fp.photoOutcome(mm);
        r.kind[`may|${cond}`] = om.kind;
        r.kind[`lui|${cond}`] = fp.photoOutcome(ml).kind;
        r.shown[cond] = om.kind === "open" ? [om.top, ...om.others].map((x) => x.code) : [];
      }
      out[keyOf(c)] = r;
    }
    return out;
  };
  const base = runMethod(null);
  const posOf = (res, c, p, cond) => (c.code ? rankIn(res[keyOf(c)]?.[p]?.[cond] ?? [], c.code, MERGE_K) : null);

  // ---- kiểm chéo ----
  // (0) mergeLocal tham số nền = serverMerge src (cả mục) mọi ô có S
  const check0 = { cells: 0, same: 0, diff: [] };
  for (const c of live) for (const cond of CONDS) {
    if (!c.S.length) continue;
    check0.cells++;
    if (sameArr(mergeLocal(ctx, c.found, c.off[cond], c.S, BASE_PARAMS), base[keyOf(c)].items[cond])) check0.same++;
    else check0.diff.push(`${c.set} ${c.img ?? c.kind} ${cond}`);
  }
  check0.ok = check0.cells > 0 && check0.same === check0.cells;
  // (1) nền MÁY A/B = perCase.may của nen.json may-chu-loc (thêm: LÙI = perCase.lui)
  const check1 = { cells: 0, may: 0, lui: 0, diff: [], mclAllOk: nenMcl.allOk === true, mclMode: nenMcl.mode, mclSha: nenMcl.sha };
  for (const c of live.filter((x) => x.set === "A" || x.set === "B")) for (const cond of CONDS) {
    check1.cells++;
    const saved = nenMcl.perCase?.[keyOf(c)];
    if (sameArr(saved?.may?.[cond] ?? null, base[keyOf(c)].may[cond])) check1.may++; else check1.diff.push(`${c.set} ${cond} MÁY`);
    if (sameArr(saved?.lui?.[cond] ?? null, base[keyOf(c)].lui[cond])) check1.lui++; else check1.diff.push(`${c.set} ${cond} LÙI`);
  }
  check1.ok = check1.cells === 120 && check1.may === 120 && check1.lui === 120 && check1.mclAllOk && check1.mclMode === "chi-nen";
  // (2) 22 ảnh thật: (ii) top 5 + tự mở + kind = ket-qua-goc; S = perCase.S của nen.json
  const real = cases.filter((c) => c.set === "that");
  const check2 = { n: real.length, top5: 0, autoOpen: 0, kind: 0, S: 0, diff: [] };
  for (const c of real) {
    const r = base[keyOf(c)];
    const g = c.goc.app;
    if (sameArr(r.shown.ii, g.top5.map((x) => x.code))) check2.top5++; else check2.diff.push(`ảnh ${c.img} top5`);
    const auto = r.kind["may|ii"] === "open" ? r.shown.ii[0] : null;
    if ((g.autoOpen?.code ?? null) === auto) check2.autoOpen++; else check2.diff.push(`ảnh ${c.img} tự mở`);
    if (g.kind === r.kind["may|ii"]) check2.kind++; else check2.diff.push(`ảnh ${c.img} kind`);
    if (sameArr(codesOf(c.S), nenMcl.perCase?.[keyOf(c)]?.S ?? null)) check2.S++; else check2.diff.push(`ảnh ${c.img} S`);
  }
  check2.ok = real.length === 22 && [check2.top5, check2.autoOpen, check2.kind, check2.S].every((x) => x === 22);
  // (3) LÙI = photoMerge src (gọi lại độc lập, cả mục)
  const check3 = { cells: 0, same: 0, diff: [] };
  for (const c of live) for (const cond of CONDS) {
    check3.cells++;
    const a = fx.photoMerge({ t1, rIndex, products, xi }, c.found, c.off[cond], { called: called(c) }).merged;
    if (sameArr(codesOf(a), base[keyOf(c)].lui[cond])) check3.same++; else check3.diff.push(`${c.set} ${c.img ?? c.kind} ${cond}`);
  }
  check3.ok = check3.cells > 0 && check3.same === check3.cells;

  // ---- bảng nền ----
  const groups = {
    A: (c) => c.set === "A", B: (c) => c.set === "B",
    "that1-chinh": (c) => c.set === "that" && c.folder === "1-ra-dung" && c.group === "chinh" && c.code,
    "that1-giu": (c) => c.set === "that" && c.folder === "1-ra-dung" && c.group === "giu" && c.code,
    "that2-chinh (chỉ để tham khảo, n ≤ 2)": (c) => c.set === "that" && c.folder === "2-ma-vach-ra" && c.group === "chinh" && c.code,
    "that2-giu (chỉ để tham khảo, n ≤ 2)": (c) => c.set === "that" && c.folder === "2-ma-vach-ra" && c.group === "giu" && c.code,
    "7up": (c) => c.set === "7up", buldak: (c) => c.set === "buldak", "ruaypuan (chỉ báo)": (c) => c.set === "ruaypuan", ngoai: (c) => c.set === "ngoai",
  };
  const tableOf = (res) => Object.fromEntries(Object.entries(groups).map(([name, fn]) => {
    const rs = cases.filter(fn);
    const row = { n: rs.length };
    for (const cond of CONDS) row[cond] = { top1: rs.filter((c) => posOf(res, c, "may", cond) === 1).length, top5: rs.filter((c) => posOf(res, c, "may", cond) != null).length };
    return [name, row];
  }));
  const salt = cases.find((c) => c.set === "muoi");
  const none3 = (res) => Object.fromEntries(real.filter((c) => c.label === "none").map((c) => [`anh-${c.img}`, { nhom: c.group, ...Object.fromEntries(CONDS.map((cond) => [cond, res[keyOf(c)].kind[`may|${cond}`]])) }]));
  const baseTable = tableOf(base);
  const baseSalt = base[keyOf(salt)].kind;
  const baseNone = none3(base);
  // (4) bảng nền = bảng nền may-chu-loc (PLAN.md)
  const WANT = { A: [13, 19], B: [14, 19], "that1-chinh": [3, 4], "that1-giu": [5, 6], "that2-chinh (chỉ để tham khảo, n ≤ 2)": [0, 0], "that2-giu (chỉ để tham khảo, n ≤ 2)": [0, 0], "7up": [2, 2], buldak: [1, 1], ngoai: [5, 6] };
  const check4 = { diff: [] };
  for (const [g, [t1w, t5w]] of Object.entries(WANT)) for (const cond of CONDS) {
    const got = baseTable[g][cond];
    if (got.top1 !== t1w || got.top5 !== t5w) check4.diff.push(`${g} ${cond}: ${got.top1}/${got.top5} ≠ ${t1w}/${t5w}`);
  }
  if (!Object.values(baseSalt).every((k) => k === "open") || Object.keys(baseSalt).length !== 4) check4.diff.push(`muối ${JSON.stringify(baseSalt)}`);
  const noneVals = Object.values(baseNone);
  if (noneVals.length !== 6 || !noneVals.every((x) => x.i === "open" && x.ii === "open")) check4.diff.push(`thư mục 3 ${JSON.stringify(baseNone)}`);
  check4.ok = check4.diff.length === 0;
  const checks = { "0": check0, "1": check1, "2": check2, "3": check3, "4": check4 };
  const allOk = Object.values(checks).every((x) => x.ok);

  // ---- ảnh thật theo ô (vị trí MÁY nền) ----
  const realRows = (res) => real.filter((c) => c.code).flatMap((c) => CONDS.map((cond) => ({
    id: `anh-${c.img}|${cond}`, img: c.img, group: c.group, folder: c.folder, preset: c.preset, base: posOf(base, c, "may", cond), got: posOf(res, c, "may", cond),
  })));
  const realBase = Object.fromEntries(real.map((c) => [`anh-${c.img}`, {
    thuMuc: c.folder, nhom: c.group, nhan: c.label === "none" ? "none" : c.code ? "mã" : "null", preset: c.preset,
    sRank: c.code ? rankIn(codesOf(c.S), c.code, SERVER_K) : null,
    ...Object.fromEntries(CONDS.map((cond) => [cond, { pos: posOf(base, c, "may", cond), kind: base[keyOf(c)].kind[`may|${cond}`] }])),
  }]));
  const baseTarget = target3(realRows(base));

  // ---- thời gian gộp (G4) ----
  const timeSet = live.filter((c) => c.S.length && (c.set === "A" || c.set === "B" || c.set === "that")).flatMap((c) => CONDS.map((cond) => ({ c, cond })));
  // G4 (luật sửa vòng 2): nền = mergeLocal tham số nền (timeOf(null)); serverMerge src chỉ báo (timeSrc)
  const timeOf = (name) => { const p = paramsOf(name); return timeCells(timeSet, ({ c, cond }) => mergeLocal(ctx, c.found, c.off[cond], c.S, p)); };
  const timeSrc = () => timeCells(timeSet, ({ c, cond }) => fsv.serverMerge(ctx, c.found, c.off[cond], c.S, { called: called(c) }));
  const srcTime = timeSrc();
  const baseTime = timeOf(null);

  const coverage = Object.fromEntries(["B", "A", "that", "7up", "muoi", "ruaypuan", "buldak", "ngoai"].map((s) => {
    const rs = cases.filter((c) => c.set === s && c.found);
    return [s, { n: rs.length, coCau: rs.filter((c) => c.queries.length).length, duCau: rs.filter((c) => c.queries.length && c.allOk).length }];
  }));
  const out = {
    at: new Date().toISOString(), startedAt, mode, sha, dirty, srcSame, baseSha: BASE_SHA, ruleSha: RULE_SHA, ruleSha256: RULE_SHA256,
    consts, cacheOnly: true, azureCalls: 0, ocrRerun: false, serverRerun: false, sFrom: { that: gocFile, other: nenFile },
    splitCount: Object.fromEntries(FOLDERS.map((f) => [f, { giu: halves.filter((x) => x.folder === f && x.group === "giu").length, chinh: halves.filter((x) => x.folder === f && x.group === "chinh").length }])),
    coverage, checks, allOk, baseTable, baseSalt, baseNone, realBase, baseTarget, time: { base: baseTime, src: srcTime, baseIs: "mergeLocal(BASE_PARAMS)", cells: timeSet.length, repeat: TIME_REPEAT, warm: TIME_WARM },
    perCase: Object.fromEntries(live.map((c) => [c.set === "that" ? `anh-${c.img}` : keyOf(c), { may: base[keyOf(c)].may, lui: base[keyOf(c)].lui }])),
  };

  const f = (x) => (x == null ? "-" : x);
  console.log(`sha ${sha} dirty ${dirty}; src/server/public trùng ${BASE_SHA}: ${srcSame}; hằng số ${JSON.stringify(consts)}`);
  console.log(`Chia nửa: ${JSON.stringify(out.splitCount)}`);
  console.log(`Độ phủ OFF (đủ câu / có câu / số ca): ${Object.entries(coverage).map(([s, x]) => `${s} ${x.duCau}/${x.coCau}/${x.n}`).join(" | ")}`);
  console.log(`Kiểm chéo (0) ${check0.ok ? "ĐẠT" : "LỆCH"}: mergeLocal nền = serverMerge src ${check0.same}/${check0.cells} ô ${check0.diff.slice(0, 8).join(", ")}`);
  console.log(`Kiểm chéo (1) ${check1.ok ? "ĐẠT" : "LỆCH"}: A/B nền = nen.json may-chu-loc MÁY ${check1.may}/${check1.cells}, LÙI ${check1.lui}/${check1.cells} (nen.json ${check1.mclMode}, allOk ${check1.mclAllOk}, sha ${String(check1.mclSha).slice(0, 7)}) ${check1.diff.slice(0, 8).join(", ")}`);
  console.log(`Kiểm chéo (2) ${check2.ok ? "ĐẠT" : "LỆCH"}: 22 ảnh thật (ii) top5 ${check2.top5}/22, tự mở ${check2.autoOpen}/22, kind ${check2.kind}/22, S ${check2.S}/22 ${check2.diff.join(", ")}`);
  console.log(`Kiểm chéo (3) ${check3.ok ? "ĐẠT" : "LỆCH"}: LÙI = photoMerge src ${check3.same}/${check3.cells}`);
  console.log(`Kiểm chéo (4) ${check4.ok ? "ĐẠT" : "LỆCH"}: bảng nền = may-chu-loc ${check4.diff.join("; ")}`);
  console.log("NỀN (MÁY; vị trí 1 / trong 5 theo (i) | (ii)):");
  for (const [k, x] of Object.entries(baseTable)) console.log(`  ${k.padEnd(40)} n ${x.n}: (i) ${x.i.top1}/${x.i.top5} | (ii) ${x.ii.top1}/${x.ii.top5}`);
  console.log(`  muối kind ${JSON.stringify(baseSalt)}; ảnh thư mục 3 kind ${JSON.stringify(baseNone)}`);
  console.log(`  mục tiêu nền ${JSON.stringify({ M1: baseTarget.M1, M2: baseTarget.M2, M3: baseTarget.M3 })}; thời gian gộp nền mergeLocal (Node, ${timeSet.length} ô × ${TIME_REPEAT} lần) p50 ${baseTime.p50?.toFixed(3)} ms, p95 ${baseTime.p95?.toFixed(3)} ms; serverMerge src (chỉ báo) p50 ${srcTime.p50?.toFixed(3)} ms, p95 ${srcTime.p95?.toFixed(3)} ms`);
  if (!allOk) {
    const bad = resultFile(outDir, mode, false);
    fs.writeFileSync(bad.file, JSON.stringify(out, null, 1), "utf8");
    console.error(`KIỂM CHÉO LỆCH: dừng báo, không đo. Ghi ${bad.file} (không ghi ${outFile}).`);
    process.exit(bad.exitCode);
  }

  const foreignOf = (res) => {
    const t = { top1: 0, top5: 0 };
    for (const c of cases.filter((x) => x.set === "ngoai")) for (const cond of CONDS) {
      const p = posOf(res, c, "may", cond);
      if (p === 1) t.top1++;
      if (p != null) t.top5++;
    }
    return t;
  };

  if (mode === "do") {
    const methods = {};
    const baseForeign = foreignOf(base);
    const goodBase = realRows(base).filter((x) => x.base === 1);
    for (const name of Object.keys(STEP3_GRID)) {
      const res = runMethod(name);
      const ab = [];
      for (const c of live.filter((x) => x.set === "A" || x.set === "B")) for (const cond of CONDS) ab.push({ id: `${c.set}|${c.code}|${cond}`, base: posOf(base, c, "may", cond), got: posOf(res, c, "may", cond) });
      const rr = realRows(res);
      const good = rr.filter((x) => goodBase.some((g) => g.id === x.id));
      const s7 = {};
      for (const c of cases.filter((x) => x.set === "7up")) for (const cond of CONDS) s7[`${c.kind}|${cond}`] = posOf(res, c, "may", cond);
      const bu = cases.find((x) => x.set === "buldak");
      const buldak = Object.fromEntries(CONDS.map((cond) => [cond, res[keyOf(bu)].may[cond][0] ?? null]));
      let offSame = true;
      let luiSame = true;
      for (const c of live) {
        if (!sameArr(osx.cleanQuery(c.found.lines, { idf }), c.queries)) offSame = false;
        for (const cond of CONDS) if (!sameArr(res[keyOf(c)].lui[cond], base[keyOf(c)].lui[cond])) luiSame = false;
      }
      const ts = timeSrc(); // chỉ báo
      const tb = timeOf(null); // nền G4 = mergeLocal tham số nền, ngay trước cách
      const tm = timeOf(name);
      const verdict = judge3({ ab, good, s7, buldak, salt: res[keyOf(salt)].kind, foreign: { base: baseForeign, got: foreignOf(res) }, time: { p95: tm.p95, baseP95: tb.p95 }, srcSame, consts, offSame, luiSame });
      methods[name] = { table: tableOf(res), t: target3(rr), verdict, time: { base: tb, method: tm, src: ts }, noneKinds: none3(res), realPos: Object.fromEntries(rr.map((x) => [x.id, x.got])) };
      process.stdout.write(".");
    }
    console.log("");
    const pick = pickStep3(Object.entries(methods).map(([name, x]) => ({ name, pass: x.verdict.pass, t: x.t })), baseTarget.M1);
    const refTxt = pick.refOnly.map((x) => `${x.name} (M ${x.M1}/${x.M2}/${x.M3}; ${x.reasons.join(", ")})`).join("; ");
    const conclusion = (pick.name
      ? `CHỌN ${pick.name} (${JSON.stringify({ M1: methods[pick.name].t.M1, M2: methods[pick.name].t.M2, M3: methods[pick.name].t.M3 })})`
      : "KHÔNG CÁCH NÀO ĐẠT ở bước 3: không giữ gì (bước 4 đo trên nền serverMerge)")
      + (pick.refOnly.length ? `; chỉ để tham khảo (không được chọn): ${refTxt}` : "");
    for (const [name, x] of Object.entries(methods)) console.log(`${name.padEnd(12)} M ${x.t.M1}/${x.t.M2}/${x.t.M3} giữ riêng ${x.t.holdOk ? "ok" : "MẤT"} p95 cách ${x.time.method.p95?.toFixed(3)} / nền mergeLocal ${x.time.base.p95?.toFixed(3)} / serverMerge src ${x.time.src.p95?.toFixed(3)} ms | ${x.verdict.pass ? "QUA" : "TRƯỢT " + Object.entries(x.verdict.gates).filter(([, ok]) => !ok).map(([g]) => g).join(",")}${x.t.refOnly.length ? ` | refOnly: ${x.t.refOnly.join(", ")}` : ""}`);
    for (const [name, x] of Object.entries(methods)) if (!x.verdict.pass) console.log(`  ${name}: ${x.verdict.fails.join(" | ")}`);
    console.log(`== Kết luận bước 3: ${conclusion}`);
    Object.assign(out, { methods, pick, conclusion });
  }

  if (mode === "nguong") {
    const chosen = step3?.pick?.name ?? null;
    if (chosen != null && !Object.hasOwn(STEP3_GRID, chosen)) { console.error(`do.json chọn cách lạ ${chosen}`); process.exit(3); }
    if (chosen != null && (step3?.pick?.refOnly || []).some((x) => x?.name === chosen)) { console.error(`do.json chọn cách chỉ để tham khảo ${chosen}`); process.exit(3); }
    const res = chosen == null ? base : runMethod(chosen);
    const idfMul = paramsOf(chosen).idfMul;
    const cells = [];
    for (const c of live.filter((x) => x.S.length)) for (const cond of CONDS) {
      const m = res[keyOf(c)].items[cond];
      const joined = serverJoin(c.off[cond], c.S);
      const st = scoreTable(ctx, c.found, joined, idfMul);
      const feats = featuresOf(m, { matched: m.length ? st(m[0].code).matched : 0, queryN: new Set(c.found.query).size, sCodes: codesOf(c.S) });
      const open = res[keyOf(c)].kind[`may|${cond}`] === "open";
      const right = c.code != null && m[0]?.code === c.code;
      const gateSet = c.set === "A" || c.set === "B" || c.set === "7up" || c.set === "buldak" || c.set === "ngoai" || (c.set === "that" && c.code);
      cells.push({
        id: `${c.set === "that" ? `anh-${c.img}` : `${c.set}|${c.kind}|${c.code ?? ""}`}|${cond}`, set: c.set, folder: c.folder ?? null, group: c.group ?? null, cond,
        img: c.img ?? null, good: gateSet && open && right, wrongAB: (c.set === "A" || c.set === "B") && !right, none3: c.set === "that" && c.label === "none",
        salt: c.set === "muoi", open, feats,
      });
    }
    const abVals = Object.fromEntries(STEP4_FEATURES.map((fe) => [fe, cells.filter((x) => (x.set === "A" || x.set === "B") && x.feats).map((x) => x.feats[fe])]));
    const vc = checkStep4Values(abVals, 120);
    console.log(`Kiểm số giá trị A/B mỗi đặc trưng (= 120) ${vc.ok ? "ĐẠT" : "LỆCH"}: ${JSON.stringify(vc.counts)}`);
    if (!vc.ok) {
      const bad = resultFile(outDir, mode, false);
      fs.writeFileSync(bad.file, JSON.stringify({ ...out, step3Pick: chosen, valueCheck: vc, cells }, null, 1), "utf8");
      console.error(`SỐ GIÁ TRỊ A/B LỆCH (${vc.bad.join(", ")}): dừng báo, không chọn ngưỡng. Ghi ${bad.file} (không ghi ${outFile}).`);
      process.exit(bad.exitCode);
    }
    out.valueCheck = vc;
    const rules = step4Rules(abVals).map((ru) => ({ ...ru, r: judge4(ru, cells) }));
    const pick = pickStep4(rules);
    const conclusion = pick.name ? `CHỌN ngưỡng ${pick.name}` : "KHÔNG NGƯỠNG NÀO ĐẠT ở bước 4: không giữ gì";
    for (const ru of rules) console.log(`${ru.name.padEnd(18)} ngưỡng ${f(ru.thr)} | ${ru.r.pass ? "QUA" : "TRƯỢT"} chỉnh ${ru.r.tChinh}/3 giữ ${ru.r.tGiu}/3 A/B chuyển ${ru.r.abUnsure} (sai ${ru.r.abWrongUnsure}) muối ${ru.r.saltUnsure}`);
    console.log(`== Nền bước 4: ${chosen ?? "serverMerge"}; kết luận bước 4: ${conclusion}`);
    Object.assign(out, { step3Pick: chosen, rules, pick, conclusion, cells });
  }

  out.offStats = disk.stats;
  out.offNetCalls = disk.stats.calls;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  console.log(`OFF: lượt mạng ${disk.stats.calls}, cache ${disk.stats.cacheHits}, thiếu cache ${disk.stats.notCached}; Azure 0. Ghi: ${outFile}`);
}
