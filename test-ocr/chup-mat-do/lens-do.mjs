// Đợt lens: KHUNG ĐO "so ảnh kiểu Google Lens" cho Chụp mặt trước: máy chủ thêm tín hiệu độ giống ảnh (vector ảnh chụp so
// ảnh mặt trước Open Food Facts) vào 10 ứng viên, app dùng độ giống ảnh để xếp / biết lúc "không chắc".
// CHỈ đo trong Node, KHÔNG sửa src/ server/ public/ tests/. Độ giống ảnh do lens-vec.py (venv D:\tmp\lens\venv) tính sẵn
// ra file; khung đo CHỈ ĐỌC file đã tính, KHÔNG gọi mạng khi đo (OFF chỉ cache đĩa, 0 lượt Azure, không chạy lại OCR).
// Ảnh thật / nhãn / ảnh tải về / vector đều NGOÀI git (D:\tmp\may-chu-loc, D:\tmp\lens); file này không chứa mã nhãn /
// tên file ảnh thật (ảnh thật gọi bằng số thứ tự #n theo thứ tự ket-qua-goc.json của may-chu-loc).
//
//   node --max-old-space-size=6144 test-ocr/chup-mat-do/lens-do.mjs (--chi-nen | --chon-model | --cong | --do) [--ghi-de]
//        [--out D:\tmp\lens\ket-qua] [--vec D:\tmp\lens\vec] [--muc a|b]
//   --chi-nen     dựng bộ ca (D:\tmp\lens\ca.json) + nền "chỉ chữ" + kiểm chéo với khau-gop nen.json → <out>/nen.json.
//   --chon-model  chọn model + tiền xử lý trên chỉ mục (a), chỉ ảnh → <out>/chon-model.json.
//   --cong        cổng dừng sớm G1–G3 trên chỉ mục (a), model đã chọn, chỉ ảnh → <out>/cong.json.
//   --do          đo mọi cách của lưới trên chỉ mục (b) (bản sẽ đóng gói) → <out>/do.json.
//   Đúng một cờ; file ra đã có → dừng (trừ --ghi-de). Kiểm chéo lệch → <stem>.loi.json, thoát mã 3.
//
// ===================================================================================================================
// LUẬT CHỐT TRƯỚC — commit riêng "test(lens): luật chốt trước" TRƯỚC mọi phép tính độ giống ảnh (vector, cosine) trên
// ca có nhãn. Viết lúc 2026-11-20 (giờ commit thật + sha ghi ở PLAN.md mục đợt lens). Không sửa khối này sau khi thấy số
// của bất kỳ cách / model nào; buộc phải sửa thì ghi "LỆCH LUẬT" ở PLAN.md và dừng báo.
// Lúc viết khối này ĐÃ thấy: bảng nền khau-gop / may-chu-loc (chỉ chữ); kết quả CLIP / DINOv2 cũ của chup-mat-do (chỉ mục
// 1.452, ảnh OFF). CHƯA tính vector / độ giống ảnh nào cho ca có nhãn của đợt này.
// ===================================================================================================================
// ---- Ca (ô = ca × điều kiện OFF (i) lỗi hết / (ii) cache đĩa D:\tmp\tu-dong\cache-off, như khau-gop) ----
//   A / B: 60 ảnh (30 mã × 2 bộ chữ, D:\tmp\tu-dong\ocr\bo-a-30.json, bo-b-30.json). Ảnh truy vấn của mã X (cả A và B) =
//     test-ocr/photos/X/front.jpg của thư mục chính (ảnh OFF, imgid trong photos/NGUON.csv).
//   22 ảnh thật (D:\tmp\may-chu-loc: nhan.json, ocr, ket-qua-goc.json): thư mục 1 = 13, thư mục 2 = 3, thư mục 3 = 6
//     ("không có dữ liệu", nhãn "none"). Chia nửa ĐÚNG như khau-gop-do.mjs (splitHalves của may-chu-loc-do.mjs: trong mỗi
//     thư mục xếp MỌI file kể cả nhãn null theo tên tăng dần, vị trí lẻ = GIỮ RIÊNG, chẵn = CHỈNH). Ảnh preset đánh dấu.
//   7Up Diet 8934588752117 (2 ca chữ: chữ máy + câu gõ; KHÔNG có ảnh); buldak.jpg 8801073250574; ruaypuan.jpg
//     8852052150101 (CHỈ BÁO); muối Co.op (ca chữ, không ảnh, nhóm "không có dữ liệu", CHỈ BÁO); 6 ca ngoại (ca chữ dựng,
//     không ảnh).
//   found / câu OFF / OFF / S chữ (10 ứng viên máy chủ đã lưu) = ĐÚNG như khau-gop-do.mjs.
// ---- Nền "chỉ chữ" = S0 + A0, không U = serverMerge của src (đường MÁY), photoMerge (đường LÙI khi S rỗng). ----
//   Kiểm chéo bắt buộc trước mọi cách: nền trùng D:\tmp\khau-gop\ket-qua\nen.json TỪNG Ô (MÁY + LÙI mọi ca), bảng nền
//   A 13/19, B 14/19 (vị trí 1 / trong 5 ở (i) và (ii)), 8 ảnh thật đúng vị trí 1 (#1 #3 #6 #7 #8 #9 #12 #13), 6 ảnh thư
//   mục 3 tự mở, 7Up 2/2, buldak 1/1; mergeLocal(BASE_PARAMS) của khau-gop = serverMerge src mọi ô. Lệch → dừng báo.
// ---- Tín hiệu ảnh (lens-vec.py tính, ra <vec>/<biến thể>/<mức>/: sims.npy float32 [truy vấn × sản phẩm], codes.json,
//   queries.json, meta.json) ----
//   Chỉ mục ảnh = MỘT ảnh mặt trước OFF / sản phẩm (khóa `img` của danh mục kho-lon mức (a) hoặc (b), tải bằng
//     lens-tai.mjs); sản phẩm không có ảnh tải được thì không có trong chỉ mục. Vector chuẩn hóa L2, độ giống = cosine.
//   sim(q, mã) = cosine; hạng ảnh toàn cục = xếp mọi sản phẩm của chỉ mục theo sim giảm dần (hòa → thứ tự codes.json).
//   lens(q) = { top1Code, top1 = sim hạng 1, margin = sim hạng 1 − sim hạng 2 }. Ca không có ảnh → lens null, nhánh ảnh
//     TẮT: mọi cách phải cho kết quả GIỐNG HỆT nền từng ô (kiểm lúc chạy; lệch = cách trượt).
//   CHỐNG ĂN GIAN (A / B): chỉ mục KHÔNG chứa chính ảnh đo. Với mỗi mã A / B: ứng viên = khóa ảnh của danh mục rồi các
//     front_xx khác (OFF API sản phẩm, app_name, giãn ≥ 1 giây, ≤ 60 lượt); nhận ứng viên đầu tiên có imgid KHÁC imgid
//     ảnh đo VÀ khoảng cách dHash / pHash vùng giữa (cropHashSet / compareHashSets của lib.mjs: 100 / 90 / 80 / 70 %,
//     min của 2 mã băm) > 24 bit. Không có → mã "loại khỏi đo ảnh": sản phẩm bị ẨN trên hàng của chính truy vấn ab-<mã>
//     (mọi mức, mọi chỗ dùng độ giống: hạng ảnh toàn cục, lens, sim ứng viên, S1/S2/S3, τ/μ): trên hàng đó mã coi như
//     không có ảnh. Mọi truy vấn khác (ab khác, ảnh thật, buldak, ruaypuan, bộ P) thấy chỉ mục đầy đủ, mã dùng khóa ảnh
//     danh mục (LỆCH LUẬT 2). Ca vẫn
//     chạy mọi cách (kiểm "không hại"); R1 áp cho cả 60. Ảnh thật / buldak / ruaypuan: chỉ mục dùng ảnh OFF bình thường;
//     ảnh thật có dHash so ảnh chỉ mục của mã đúng ≤ 10 bit → ghi chú "có thể trùng ảnh" (chỉ báo).
// ---- Hai tầng cách (lưới cố định; tổng số cách ghi ở METHOD_COUNT; không thêm cách sau khi thấy số) ----
//   TẦNG MÁY CHỦ (≤ 10 ứng viên S; chữ ứng viên đọc từ server/catalog/c.jsonl.gz; qua serverCandidates của src):
//     S0 chỉ chữ (S đã lưu).
//     S1 chỉ ảnh: 10 mã đầu theo hạng ảnh toàn cục.
//     S2-w RRF k = 60: điểm = 1 / (60 + hạng trong S0) [mã có trong S0] + w / (60 + hạng ảnh) [mã trong 10 ảnh đầu];
//       xếp giảm dần, hòa → hạng S0 nhỏ trước (không có = ∞) rồi hạng ảnh nhỏ trước; lấy 10; w ∈ {0,5; 1; 2}.
//     S3-k giữ chữ, thay vị trí cuối: m = số mã trong k mã ảnh đầu CHƯA có trong S0 (k ∈ {1, 2, 3}); S = S0[0 .. min(|S0|,
//       10 − m)) + m mã đó theo hạng ảnh.
//     Máy chủ trả kèm (mọi tầng trừ khi máy chủ cũ): sim từng ứng viên và lens(q).
//   TẦNG APP (m = danh sách 5 mục):
//     A0 serverMerge của src trên S (lưu ý: serverMerge tự chấm lại theo chữ, bỏ mục khớp 0 từ, không dùng thứ tự S;
//       lockTop 3). S rỗng → photoMerge (đường LÙI) như nền.
//     A1-τ-μ đẩy theo ảnh: m0 = A0; nếu lens.top1Code có trong S, lens.top1 ≥ τ, lens.margin ≥ μ và m0[0] khác mã đó:
//       mục 1 = mục hiển thị của mã đó (bản danh mục 1.452 nếu có; không thì mục cùng mã của serverJoin (bản OFF nếu có);
//       không thì bản S; điểm = điểm chấm chữ như khau-gop scoreTable, khớp 0 từ → 0); 4 mục sau = mergeLocal(BASE_PARAMS
//       nhưng offMax = 0 nếu mục 1 có source "off", ngược lại 1) bỏ mã đó, lấy 4 (vượt lockTop, tính vào offMax). Không
//       đạt điều kiện → m = A0.
//     A2-w RRF trong app: hạng chữ = vị trí trong A0 (1–5); hạng ảnh = thứ tự các mục S có sim theo sim giảm dần (hòa →
//       thứ tự S); điểm = 1 / (60 + hạng chữ) + w / (60 + hạng ảnh) (thiếu hạng = không cộng); hòa → hạng chữ nhỏ trước
//       (thiếu = ∞) rồi hạng ảnh; lấy 5; mục lấy từ A0 nếu có, không thì mục hiển thị như A1; w ∈ {0,5; 1; 2}.
//   NGƯỠNG "KHÔNG CHẮC" U (không tự mở; vẫn hiện danh sách gợi ý; chỉ khi có lens): chu = số từ câu tìm T1 khớp tài liệu
//     mục 1 (scoreTable của khau-gop: cùng cách chấm của gộp).
//     U0 không dùng ngưỡng.
//     U-sim-τ: lens.top1 < τ.   U-gap-μ: lens.margin < μ.   U-simchu-τ: lens.top1 < τ VÀ chu < 2.
//     U-or-τ-μ (nguyên văn prompt): lens.top1 < τ HOẶC lens.margin < μ HOẶC (lens.top1 < τ VÀ chu < 2) (mệnh đề 3 nằm
//       trong mệnh đề 1, ghi đủ cho đúng nguyên văn; vì vậy U-simchu tách riêng thành một họ).
//   τ, μ KHÔNG dùng nhãn: τ ∈ phân vị {10, 25, 50, 75, 90} % của lens.top1, μ ∈ phân vị {10, 25, 50, 75, 90} % của
//     lens.margin, tính trên 60 ô ảnh A / B (30 mã × 2 bộ; đã chống ăn gian; mã bị loại vẫn tính với chỉ mục đã ẩn mã trên hàng đó)
//     của chỉ mục đang đo; phân vị nearest rank (quantileNR của khau-gop).
//   Số cách: tầng máy chủ 8 (S0, S1, S2 × 3, S3 × 3) × tầng app 29 (A0, A1 × 25, A2 × 3) × U 41 (U0, U-sim × 5, U-gap × 5,
//     U-simchu × 5, U-or × 25) = 9.512 cách. Thứ tự khai báo (dùng khi hòa, "đơn giản / nhẹ hơn" trước): S0, S3-1, S3-2,
//     S3-3, S2-0.5, S2-1, S2-2, S1; A0, A2-0.5, A2-1, A2-2, A1 (τ tăng, rồi μ tăng); U0, U-sim, U-gap, U-simchu, U-or (τ
//     tăng, μ tăng); thứ tự cách = (S, A, U) theo thứ tự từ điển.
//   Nền = S0 + A0 + U0.
// ---- Vị trí và tự mở ----
//   "đúng vị trí 1" của một ô = m[0] là mã đúng VÀ photoOutcome(m).kind = "open" VÀ ô KHÔNG bị U đánh "không chắc".
//   "trong 5" = mã đúng trong m (5 mục), kể cả ô "không chắc". "tự mở" = kind "open" VÀ không "không chắc".
// ---- Cổng (mọi cổng phải qua; "nền" = cùng ca, cùng ô, cùng lần chạy) ----
//   R1 60 ảnh A / B × (i)(ii) = 120 ô: 0 ô mất vị trí 1 (ô bị U đánh "không chắc" mà nền đang đúng vị trí 1 = MẤT vị trí
//      1), 0 ô rơi khỏi 5.
//   R2 8 ảnh thật nền đang đúng (#1 #3 #6 #7 #8 #9 #12 #13) × (i)(ii): giữ vị trí 1 (đúng định nghĩa trên: vẫn tự mở).
//   R3 7Up Diet (2 ca × (i)(ii)): giữ vị trí 1. Mọi ca không ảnh (7Up, muối, 6 ca ngoại): GIỐNG HỆT nền từng ô.
//   R4 buldak.jpg (i)(ii): m[0] = 8801073250574, tự mở.
//   R5 tương thích: (x) tầng app của cách + máy chủ KHÔNG trả lens (S = S0, không sim, lens null) = nền từng ô;
//      (y) app cũ (A0 = serverMerge src, U0) + S của tầng máy chủ của cách: R1–R4 vẫn qua.
//   R6 thời gian thêm (tiền xử lý + vector ảnh + tìm trên chỉ mục cỡ mức (b)), onnxruntime 1 luồng trên máy này (ghi CPU),
//      20 ảnh: p95 (nearest rank) ≤ 1.500 ms. (Số CI --cpus=1 là cổng ở bước máy chủ sau.) RAM toàn máy chủ ≤ 1.536 MiB
//      (vòng này chỉ ước: RAM máy chủ hiện có + RAM thêm khi nạp model + cỡ chỉ mục; đo kiểu do_h2h3 ở bước máy chủ).
//      Số R6 dùng cho bước chọn model (1) và cho cổng R6 (LỆCH LUẬT 2) = số đo trên ảnh truy vấn thu cạnh dài 1.600 px,
//      JPEG chất lượng 0,9 (như prepareImage), máy rảnh; thiếu số của biến thể → không chọn (thoát mã 3).
//   R7 chỉ mục chọn (mức (b), dạng sẽ đóng gói, gồm vector + mã) ≤ 25.000.000 byte.
// ---- Mục tiêu (chỉ xét cách qua R1–R7; đếm theo Ô = ảnh × (i)(ii); "nửa chỉnh" / "nửa giữ riêng" như trên) ----
//   M1 số ô ảnh thật CÓ nhãn mã (thư mục 1 + 2, kể cả preset) ở nửa CHỈNH đúng vị trí 1 — tăng.
//   M2 số ô như trên có mã đúng trong 5 — tăng.
//   M3 số ô ảnh thư mục 3 ở nửa CHỈNH bị tự mở — giảm.
//   Nửa GIỮ RIÊNG không được mất ô nào so với nền: 0 ô có nhãn mã mất vị trí 1 / rơi khỏi 5, 0 ô thư mục 3 thêm tự mở.
//   "Cách đạt" = qua R1–R7 VÀ hơn nền ở ít nhất một M (nửa chỉnh) VÀ không kém nền ở M nào VÀ nửa giữ riêng 0 ô mất VÀ
//     không "chỉ để tham khảo". "Chỉ để tham khảo" (không được chọn, vẫn ghi): hợp các ảnh làm cách hơn nền (ảnh có ô
//     mới đúng vị trí 1 / mới vào 5 / thư mục 3 thôi tự mở, nửa chỉnh) chỉ có 1 ảnh, hoặc chỉ gồm ảnh thư mục 2, hoặc
//     chỉ gồm ảnh preset.
//   Chọn: M1 lớn → M2 lớn → M3 nhỏ → thứ tự khai báo. Không cách nào đạt → không đổi src / server, chỉ ghi PLAN.md.
//   n nhỏ (22 ảnh thật, 60 ảnh A / B), chỉ để tham khảo.
// ---- Chọn model (trên chỉ mục (a), chỉ ảnh, chỉ mục fp32 của vector model) ----
//   Ứng viên: CLIP ViT-B/32 (Xenova/clip-vit-base-patch32, model fp32 và model int8), SigLIP bản nhỏ nhất có ONNX sẵn
//     (Apache-2.0), DINOv2-small (Apache-2.0, đối chứng). MobileCLIP loại vì giấy phép. Repo + revision + sha256 ghim ở
//     P2 (lens-vec.py), không đổi sau khi thấy số.
//   Tiền xử lý: "cat" (thu cạnh ngắn rồi cắt giữa, như bộ xử lý gốc) / "vien" (thêm viền cho vuông rồi thu); chọn MỘT theo
//     cùng thứ tự với model (biến thể = model × tiền xử lý, 8 biến thể).
//   BỘ P (LỆCH LUẬT 1): P = mã A / B đo được (có ảnh thay hợp lệ, có trong chỉ mục (a); đếm 1 lần mỗi mã; ảnh truy vấn =
//     ảnh đo, ảnh chỉ mục = ảnh thay) ∪ cặp VN leave-one-out của D:\tmp\chup-mat-do\chi-muc\loo.json có mã trong danh mục
//     (a) và không trùng mã A / B. Ảnh truy vấn của cặp = ảnh queryImgid. Ảnh chỉ mục của mã đó: giữ khóa danh mục nếu
//     imgid KHÁC queryImgid và mã băm vùng giữa (cách của lens: sharp xám, cạnh 256, cropHashSet / compareHashSets) > 24
//     bit; không thì dùng ảnh indexImgid (override), cũng phải > 24 bit; không đạt thì bỏ cặp. Truy vấn P chỉ dùng cho G3
//     và chọn model, KHÔNG vào R1–R5 / M.
//     (LỆCH LUẬT 2) Ảnh chỉ mục riêng (override) của bộ P chỉ áp ở chỉ mục (a); override chống ăn gian của mã A / B
//     (8935049501503 → front_ru.17) áp mọi mức như cũ.
//   Thứ tự chọn: (1) qua R6 (p95 1 luồng ≤ 1.500 ms) và R7 ước ở mức (b) (số sản phẩm có ảnh mức (b) × số chiều × 1 byte
//     int8 + 2 byte thang / vector + mã ≤ 25.000.000 byte); (2) ảnh thật nửa CHỈNH có nhãn mã (thư mục 1 + 2) mà mã có
//     trong chỉ mục (a): số ảnh có mã đúng trong top 5 chỉ ảnh — lớn; (3) bộ P top 5 chỉ ảnh: số mã P có mã đúng trong 5
//     hạng ảnh đầu — lớn; (4) hòa → giấy phép Apache-2.0 trước, rồi model nhẹ hơn (cỡ file ONNX nhỏ), rồi "cat" trước
//     "vien".
// ---- CỔNG DỪNG SỚM (sau chỉ mục (a) 6.930 sp, biến thể đã chọn, chỉ ảnh) ----
//   Đi tiếp mức (b) khi G3 VÀ (G1 HOẶC G2):
//   G3 (LỆCH LUẬT 1) bộ P: |P| ≥ 10 → G3 = tỉ lệ mã P có mã đúng trong 5 hạng ảnh đầu ≥ 50 %. |P| < 10 → G3 = "không đủ
//      mẫu", KHÔNG chặn (cổng = G1 HOẶC G2), ghi rõ.
//   G1 trong 7 ảnh thật đang sai có nhãn (#2 #4 #5 #10 #11 #15 #16) mà mã đúng có trong chỉ mục ảnh (a) (có trong (a) + có
//      ảnh OFF tải được), ≥ 2 ảnh có mã đúng trong 5 hạng ảnh đầu.
//   G2 ≥ 2 / 6 ảnh thư mục 3 có lens.top1 < lens.top1 nhỏ nhất của 8 ảnh đang đúng.
//   Không đạt → không tải (b), không đổi src / server, ghi kết quả vào PLAN.md. Cổng là điều kiện CẦN; (b) chỉ thêm hàng
//   gây nhiễu cho hàng VN.
// ---- Đo cuối ở chỉ mục (b) (bản sẽ đóng gói: vector int8 đối xứng theo từng vector, thang float16) ----
//   Ghi mất mát top-k của int8 so fp32 (hạng 1 / trong 5 / trong 10 chỉ ảnh mọi truy vấn). Chỉ mục commit MỘT lần sau khi
//   chọn.
// Tự kiểm: khối luật kiểm bằng sha256 (RULE_SHA256, đặt ngoài khối) và (khi đã có RULE_SHA) so từng byte với commit luật;
//   đo chỉ chạy khi worktree sạch và khối luật trùng; lệch → thoát mã 3.
// ---- LỆCH LUẬT 1 (vòng 2, viết 2026-11-20 khoảng 23:4x +0700, TRƯỚC mọi phép tính độ giống ảnh trên ca có nhãn) ----
//   Lý do: chống ăn gian loại gần cả bộ A / B (ảnh mặt trước duy nhất trên OFF chính là ảnh đo; vài mã có ảnh khác nhưng
//   mã băm gần ảnh đo), nên G3 cũ ("≥ 50 % mã A / B đo được") và bước (2) chọn model cũ ("A / B top 5") chỉ còn dựa trên
//   1–2 mã. dieu-phoi quyết ở vòng 2 sửa đúng 3 điểm: (i) thêm BỘ P (mục "Chọn model"); (ii) G3 tính trên bộ P, |P| < 10
//   thì không chặn; (iii) thứ tự chọn model xét ảnh thật nửa chỉnh trước, bộ P sau. Mọi phần khác giữ nguyên (R1 cho cả
//   60 ảnh với sản phẩm bị loại xóa khỏi chỉ mục; τ / μ theo phân vị trên 60 ô A / B; G1, G2; lưới 9.512 cách). Khối
//   cũ: commit 81d04e5, sha256 d0d5a1ffa510a5dae2a411cdf76fdbd4a9f328d9e7f5c77208db830d72db165a.
// ---- LỆCH LUẬT 2 (vòng 2 lượt 2b-1, viết 2026-11-21 khoảng 00:0x +0700, TRƯỚC mọi phép tính độ giống ảnh trên ca có
//   nhãn: D:\tmp\lens\vec chưa tồn tại) ----
//   Lý do: ảnh thật #1 (1 trong 8 ảnh đang đúng) có mã đúng thuộc 29 mã A / B bị loại; câu cũ "sản phẩm BỊ XÓA khỏi chỉ
//   mục ảnh (mọi mức)" mâu thuẫn với "Ảnh thật / buldak / ruaypuan: chỉ mục dùng ảnh OFF bình thường" (xóa thì #1 mất mã
//   đúng khỏi chỉ mục, đo trong tình huống app thật không gặp). dieu-phoi quyết sửa đúng 3 điểm: (i) mã bị loại chỉ bị ẨN
//   trên hàng của chính truy vấn ab-<mã>, truy vấn khác thấy chỉ mục đầy đủ (mục CHỐNG ĂN GIAN; dòng τ / μ đổi "đã xóa
//   mã" thành "đã ẩn mã trên hàng đó"; câu "R1 cho cả 60 ảnh với sản phẩm bị loại xóa khỏi chỉ mục" trong đoạn LỆCH LUẬT
//   1 giữ nguyên văn, từ nay đọc là "ẩn trên hàng ab-<mã>"); (ii) số R6 cho bước chọn model (1) và cổng R6 = số đo ảnh
//   1.600 px JPEG 0,9, máy rảnh, thiếu số → không chọn (thoát mã 3) (mục R6); (iii) override ảnh của bộ P chỉ ở mức (a),
//   override A / B mọi mức (mục BỘ P). Mọi phần khác giữ nguyên. Khối trước: commit 4424292, sha256
//   e4a6753fd856a9585ac040263a4c62de58e280d5e68773e91391b9d06a02211a.
// ===================================================================================================================
export const SERVER_K = 10;
export const MERGE_K = 5;
export const FOUND_K = 5;
export const RRF_K = 60;
export const CONDS = Object.freeze(["i", "ii"]);
export const FOLDERS = Object.freeze(["1-ra-dung", "2-ma-vach-ra", "3-khong-ra"]);
export const CODE_7UP_DIET = "8934588752117";
export const BULDAK_CODE = "8801073250574";
export const RUAYPUAN_CODE = "8852052150101";
export const GOOD_IMGS = Object.freeze([1, 3, 6, 7, 8, 9, 12, 13]);
export const WRONG_IMGS = Object.freeze([2, 4, 5, 10, 11, 15, 16]);
export const HASH_OK_MIN = 25;
export const REAL_DUP_MAX = 10;
export const OFF_CALLS_MAX = 60;
export const PERCENTS = Object.freeze([10, 25, 50, 75, 90]);
export const S_GRID = Object.freeze(["S0", "S3-1", "S3-2", "S3-3", "S2-0.5", "S2-1", "S2-2", "S1"]);
export const A_W = Object.freeze([0.5, 1, 2]);
export const S2_W = Object.freeze([0.5, 1, 2]);
export const S3_K = Object.freeze([1, 2, 3]);
export const U_FAMILIES = Object.freeze(["U-sim", "U-gap", "U-simchu", "U-or"]);
export const CHU_MIN = 2;
export const METHOD_COUNT = 9512;
export const R6_P95_MS = 1500;
export const R6_RAM_MIB = 1536;
export const R7_MAX_BYTES = 25000000;
export const TIME_N = 20;
export const G3_MIN_RATE = 0.5;
export const G3_P_MIN = 10;
export const G3_SMALL = "khong-du-mau";
export const G1_MIN = 2;
export const G2_MIN = 2;
export const MODEL_VARIANTS = Object.freeze(["clip-fp32", "clip-int8", "siglip", "dinov2-small"]);
export const PRE_ORDER = Object.freeze(["cat", "vien"]);
// ===================================================================================================================
// HẾT KHỐI LUẬT
// ===================================================================================================================

// ---------------- code đo (cài đúng định nghĩa trong khối luật ở trên) ----------------
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serverJoin } from "../../src/front-server.js";
import { photoOutcome } from "../../src/front-photo.js";
import { sha256Of, rankIn } from "./g2-di-qua-do.mjs";
import { mergeLocal, scoreTable, quantileNR, BASE_PARAMS } from "./khau-gop-do.mjs";

/**
 * Commit của khối luật đang dùng (LỆCH LUẬT 2, "test(lens): LỆCH LUẬT 2 — ẩn mã bị loại theo hàng, R6 1.600 px, override
 * bộ P chỉ mức a", 2026-11-21 00:01:51 +0700); tự kiểm so từng byte khối luật bằng git show.
 */
export const RULE_SHA = "a7b1208";
export const RULE_FILE = "test-ocr/chup-mat-do/lens-do.mjs";
/** sha256 (hex) của khối luật (ruleBlockOf) — bản LỆCH LUẬT 2. */
export const RULE_SHA256 = "10ec71685d573a62562f33fd224c6ba722b3bb9664c81866f24b7b3c9cfeb11a";
/** Khối luật LỆCH LUẬT 1 (trước LỆCH LUẬT 2): commit 4424292 (2026-11-20 23:42:03 +0700); test kiểm bằng git show. */
export const PREV_RULE_SHA = "4424292";
export const PREV_RULE_SHA256 = "e4a6753fd856a9585ac040263a4c62de58e280d5e68773e91391b9d06a02211a";
/** Khối luật GỐC (trước LỆCH LUẬT 1): commit 81d04e5 (2026-11-20 22:44:37 +0700), sha256 dưới đây; test kiểm bằng git show. */
export const OLD_RULE_SHA = "81d04e5";
export const OLD_RULE_SHA256 = "d0d5a1ffa510a5dae2a411cdf76fdbd4a9f328d9e7f5c77208db830d72db165a";
export const MODES = Object.freeze({ "--chi-nen": "nen", "--chon-model": "chon-model", "--cong": "cong", "--cong-chi-bao": "cong-chi-bao", "--do": "do" });

/** Tự kiểm (thuần): now = khối luật hiện tại, old = khối ở commit luật (RULE_SHA null → không so), dirty. */
export function selfCheck({ now, old, dirty }, { ruleSha = RULE_SHA, ruleSha256 = RULE_SHA256 } = {}) {
  const lines = [];
  if (typeof now !== "string") lines.push("Tự kiểm: không tìm thấy khối luật trong file hiện tại.");
  else if (sha256Of(now) !== ruleSha256) lines.push(`Tự kiểm: khối luật sha256 ${sha256Of(now)} ≠ RULE_SHA256 ${ruleSha256}.`);
  if (ruleSha != null) {
    if (typeof old !== "string") lines.push(`Tự kiểm: không đọc được khối luật ở commit ${ruleSha}.`);
    else if (typeof now === "string" && now !== old) lines.push(`Tự kiểm: khối luật khác từng byte commit ${ruleSha}.`);
  }
  if (dirty !== false) lines.push(`Tự kiểm: worktree ${dirty === null ? "không đọc được trạng thái git" : "KHÔNG sạch"}, không đo.`);
  return lines.length ? { exitCode: 3, lines } : { exitCode: 0, lines: ["Tự kiểm: khối luật trùng, worktree sạch."] };
}

/** Cờ dòng lệnh → chế độ hoặc null (không cờ / nhiều cờ). */
export function modeOf(argv) {
  const on = Object.keys(MODES).filter((f) => (argv || []).includes(f));
  return on.length === 1 ? MODES[on[0]] : null;
}

// ---------------- lưới cách ----------------
/** Phân vị PERCENTS (nearest rank) của mảng số. */
export function percentiles(xs) {
  return PERCENTS.map((p) => quantileNR(xs, p / 100));
}

/**
 * Lưới cách đủ (theo thứ tự khai báo) từ τ (5 số) và μ (5 số), τ[i] / μ[j] là phân vị PERCENTS[i] / PERCENTS[j]. Tên
 * cách mang CHỈ SỐ PHÂN VỊ (vd "A1-τp25-μp50"), không mang giá trị, để 2 phân vị cùng giá trị không cho 2 cách trùng tên
 * (gợi ý 10 của code-reviewer vòng 1). Trả [{ name, s, a, u }].
 */
export function methodGrid(taus, mus) {
  if (taus.length !== PERCENTS.length || mus.length !== PERCENTS.length) throw new Error(`lens: cần ${PERCENTS.length} τ và ${PERCENTS.length} μ`);
  const tp = (i) => `τp${PERCENTS[i]}`;
  const mp = (j) => `μp${PERCENTS[j]}`;
  const A = [{ id: "A0" }, ...A_W.map((w) => ({ id: `A2-${w}`, kind: "A2", w }))];
  taus.forEach((tau, i) => mus.forEach((mu, j) => A.push({ id: `A1-${tp(i)}-${mp(j)}`, kind: "A1", tau, mu })));
  const U = [{ id: "U0" }];
  taus.forEach((tau, i) => U.push({ id: `U-sim-${tp(i)}`, kind: "U-sim", tau }));
  mus.forEach((mu, j) => U.push({ id: `U-gap-${mp(j)}`, kind: "U-gap", mu }));
  taus.forEach((tau, i) => U.push({ id: `U-simchu-${tp(i)}`, kind: "U-simchu", tau }));
  taus.forEach((tau, i) => mus.forEach((mu, j) => U.push({ id: `U-or-${tp(i)}-${mp(j)}`, kind: "U-or", tau, mu })));
  const out = [];
  for (const s of S_GRID) for (const a of A) for (const u of U) out.push({ name: `${s}|${a.id}|${u.id}`, s, a, u });
  return out;
}

/** RRF có trọng số: lists = [{ codes, w }]; điểm = Σ w / (k + hạng); hòa → hạng ở danh sách 1 (thiếu = ∞) rồi danh sách 2… */
export function rrfFuse(lists, k = RRF_K) {
  const ranks = new Map();
  lists.forEach((l, li) => (l.codes || []).forEach((c, j) => {
    if (!ranks.has(c)) ranks.set(c, lists.map(() => Infinity));
    const r = ranks.get(c);
    if (r[li] === Infinity) r[li] = j + 1;
  }));
  const score = (r) => r.reduce((s, x, li) => (x === Infinity ? s : s + lists[li].w / (k + x)), 0);
  return [...ranks.entries()]
    .map(([c, r]) => ({ c, r, s: score(r) }))
    .sort((a, b) => b.s - a.s || a.r.reduce((d, x, i) => d || (x === b.r[i] ? 0 : x - b.r[i]), 0))
    .map((x) => x.c);
}

/** Tầng máy chủ: tên (S_GRID) + mã S0 (theo thứ tự) + mã ảnh (hạng toàn cục, ≥ 10) → mã S mới (≤ 10). */
export function serverTier(s, s0, imgCodes) {
  const S0 = (s0 || []).slice(0, SERVER_K);
  const I = (imgCodes || []).slice(0, SERVER_K);
  if (s === "S0") return [...S0];
  if (s === "S1") return [...I];
  let m;
  if ((m = /^S2-(.+)$/.exec(s))) return rrfFuse([{ codes: S0, w: 1 }, { codes: I, w: Number(m[1]) }]).slice(0, SERVER_K);
  if ((m = /^S3-(\d)$/.exec(s))) {
    const add = I.slice(0, Number(m[1])).filter((c) => !S0.includes(c));
    return [...S0.slice(0, Math.min(S0.length, SERVER_K - add.length)), ...add];
  }
  throw new Error(`lens: tầng máy chủ lạ ${s}`);
}

/** Hạng ảnh toàn cục: sims (mảng số theo codes) → mã theo sim giảm dần (hòa → thứ tự codes), cắt n. */
export function imageRank(codes, sims, n = Infinity) {
  const idx = Array.from(codes, (_, i) => i).sort((a, b) => sims[b] - sims[a] || a - b);
  return idx.slice(0, Math.min(n, idx.length)).map((i) => codes[i]);
}

/** lens(q) từ hạng ảnh + bảng sim (Map mã → sim). < 2 sản phẩm → null. */
export function lensOf(ranked, simOf) {
  if (!ranked || ranked.length < 2) return null;
  const top1 = simOf.get(ranked[0]);
  return { top1Code: ranked[0], top1, margin: top1 - simOf.get(ranked[1]) };
}

/** "Không chắc" theo U (lens null → không bao giờ). chu = số từ khớp của mục 1. */
export function isUnsureU(u, lens, chu) {
  if (!u || u.id === "U0" || !lens) return false;
  const sim = lens.top1 < u.tau;
  if (u.kind === "U-sim") return sim;
  if (u.kind === "U-gap") return lens.margin < u.mu;
  if (u.kind === "U-simchu") return sim && chu < CHU_MIN;
  if (u.kind === "U-or") return sim || lens.margin < u.mu || (sim && chu < CHU_MIN);
  throw new Error(`lens: U lạ ${u.id}`);
}

/**
 * Tầng app. ctx = { t1, rIndex, products }; c = { found, off: { i, ii }, called }; S = serverCandidates; cond; a = mục
 * tầng app; lens / simOf (Map mã → sim) có thể null (máy chủ không trả lens). base0 = A0 đã tính (serverMerge src) để
 * tránh tính lại. Trả m (≤ 5 mục).
 */
export function appTier(ctx, c, S, cond, a, { lens, simOf, base0 }) {
  const m0 = base0;
  if (!a || a.id === "A0" || !S.length) return m0;
  const off = c.off[cond];
  const display = (code) => {
    const st = scoreTable(ctx, c.found, serverJoin(off, S));
    const s = S.find((h) => h.code === code);
    return st(code).item ?? { code, name: String(s?.name ?? ""), brand: String(s?.brand ?? ""), img: String(s?.img ?? ""), source: "off", vn: false, score: 0 };
  };
  if (a.kind === "A1") {
    if (!lens || !S.some((h) => h.code === lens.top1Code) || !(lens.top1 >= a.tau) || !(lens.margin >= a.mu)) return m0;
    if (m0[0]?.code === lens.top1Code) return m0;
    const it = display(lens.top1Code);
    const rest = mergeLocal(ctx, c.found, off, S, { ...BASE_PARAMS, offMax: it.source === "off" ? 0 : 1 }, MERGE_K)
      .filter((x) => x.code !== lens.top1Code).slice(0, MERGE_K - 1);
    return [it, ...rest];
  }
  if (a.kind === "A2") {
    if (!simOf) return m0;
    const withSim = S.map((h, j) => ({ code: h.code, j, s: simOf.get(h.code) })).filter((x) => Number.isFinite(x.s))
      .sort((x, y) => y.s - x.s || x.j - y.j).map((x) => x.code);
    const order = rrfFuse([{ codes: m0.map((x) => x.code), w: 1 }, { codes: withSim, w: a.w }]).slice(0, MERGE_K);
    const byCode = new Map(m0.map((x) => [x.code, x]));
    return order.map((code) => byCode.get(code) ?? display(code));
  }
  throw new Error(`lens: tầng app lạ ${a.id}`);
}

/** Ô của một cách: { codes (5), open, unsure, pos (vị trí 1–5 hay null), top1 (đúng vị trí 1 theo định nghĩa) }. */
export function cellOf(m, code, unsure) {
  const codes = (m || []).slice(0, MERGE_K).map((x) => x.code);
  const open = photoOutcome(m).kind === "open";
  const pos = code ? rankIn(codes, code, MERGE_K) : null;
  return { codes, open, unsure: !!unsure, pos, top1: pos === 1 && open && !unsure, auto: open && !unsure };
}

// ---------------- phán ----------------
/**
 * r = { ab: [{ id, base, got }] (base / got = { top1, pos }), good: [{ id, got }], s7: [{ id, got }], buldak: [{ id, top1Code,
 *   auto }], noImgSame (bool), r5x (bool), r5y ({ pass }), r6 ({ p95, ramMiB }), r7 ({ bytes }) }. Trả { gates, fails, pass }.
 */
export function judgeR(r) {
  const g = {};
  const fails = [];
  const ab = r?.ab || [];
  const lost = ab.filter((x) => x.base.top1 && !x.got.top1).map((x) => x.id);
  const out5 = ab.filter((x) => x.base.pos != null && x.got.pos == null).map((x) => x.id);
  g.R1 = ab.length === 120 && !lost.length && !out5.length;
  if (!g.R1) fails.push(`R1 A/B (${ab.length} ô): mất vị trí 1 [${lost.join(", ")}], rơi khỏi 5 [${out5.join(", ")}]`);
  const good = r?.good || [];
  const gl = good.filter((x) => !x.got.top1).map((x) => x.id);
  g.R2 = good.length === GOOD_IMGS.length * CONDS.length && !gl.length;
  if (!g.R2) fails.push(`R2 ảnh thật đang đúng (${good.length} ô): mất [${gl.join(", ")}]`);
  const s7 = r?.s7 || [];
  g.R3 = s7.length === 4 && s7.every((x) => x.got.top1) && r?.noImgSame === true;
  if (!g.R3) fails.push(`R3 7Up ${JSON.stringify(s7.map((x) => [x.id, x.got.top1]))}, ca không ảnh giống hệt nền ${r?.noImgSame}`);
  const bu = r?.buldak || [];
  g.R4 = bu.length === 2 && bu.every((x) => x.top1Code === BULDAK_CODE && x.auto);
  if (!g.R4) fails.push(`R4 buldak ${JSON.stringify(bu)}`);
  g.R5 = r?.r5x === true && r?.r5y?.pass === true;
  if (!g.R5) fails.push(`R5 (x) ${r?.r5x} (y) ${r?.r5y?.pass}`);
  g.R6 = Number.isFinite(r?.r6?.p95) && r.r6.p95 <= R6_P95_MS && Number.isFinite(r?.r6?.ramMiB) && r.r6.ramMiB <= R6_RAM_MIB;
  if (!g.R6) fails.push(`R6 p95 ${r?.r6?.p95} ms (≤ ${R6_P95_MS}), RAM ước ${r?.r6?.ramMiB} MiB (≤ ${R6_RAM_MIB})`);
  g.R7 = Number.isFinite(r?.r7?.bytes) && r.r7.bytes <= R7_MAX_BYTES;
  if (!g.R7) fails.push(`R7 chỉ mục ${r?.r7?.bytes} byte (≤ ${R7_MAX_BYTES})`);
  return { gates: g, fails, pass: Object.values(g).every(Boolean) };
}

/**
 * Mục tiêu. rows = ô ảnh thật [{ id, img, group, folder, preset, label ("ma" | "none"), base: cell, got: cell }].
 * Trả { M1, M2, M3, base: { M1, M2, M3 }, holdOk, holdLoss: [id], gainImgs: [img], refOnly: [lý do] }.
 */
export function targetsM(rows) {
  const R = Array.isArray(rows) ? rows : [];
  const ch = R.filter((x) => x.group === "chinh");
  const lab = (xs) => xs.filter((x) => x.label === "ma");
  const n3 = (xs) => xs.filter((x) => x.label === "none");
  const count = (xs, f) => xs.filter(f).length;
  const M = (side) => ({
    M1: count(lab(ch), (x) => x[side].top1), M2: count(lab(ch), (x) => x[side].pos != null), M3: count(n3(ch), (x) => x[side].auto),
  });
  const got = M("got");
  const base = M("base");
  const hold = R.filter((x) => x.group === "giu");
  const holdLoss = [
    ...lab(hold).filter((x) => (x.base.top1 && !x.got.top1) || (x.base.pos != null && x.got.pos == null)).map((x) => x.id),
    ...n3(hold).filter((x) => !x.base.auto && x.got.auto).map((x) => x.id),
  ];
  const gainRows = [
    ...lab(ch).filter((x) => (x.got.top1 && !x.base.top1) || (x.got.pos != null && x.base.pos == null)),
    ...n3(ch).filter((x) => x.base.auto && !x.got.auto),
  ];
  const gainImgs = [...new Set(gainRows.map((x) => x.img))];
  const refOnly = [];
  if (gainRows.length) {
    if (gainImgs.length === 1) refOnly.push("chỉ nhờ 1 ảnh");
    if (gainRows.every((x) => x.folder === "2-ma-vach-ra")) refOnly.push("chỉ nhờ ảnh thư mục 2");
    if (gainRows.every((x) => x.preset)) refOnly.push("chỉ nhờ ảnh preset");
  }
  return { ...got, base, holdOk: holdLoss.length === 0, holdLoss, gainImgs, refOnly };
}

/** "Cách đạt" (không xét chỉ để tham khảo): qua cổng, hơn nền ở ≥ 1 M, không kém M nào, giữ riêng 0 ô mất. */
export function achieves(verdict, t) {
  const better = t.M1 > t.base.M1 || t.M2 > t.base.M2 || t.M3 < t.base.M3;
  const notWorse = t.M1 >= t.base.M1 && t.M2 >= t.base.M2 && t.M3 <= t.base.M3;
  return verdict.pass && better && notWorse && t.holdOk;
}

/** Chọn cách: list = [{ name, verdict, t }] theo thứ tự khai báo. Trả { name | null, ok: [tên], refOnly: [{ name, reasons }] }. */
export function pickMethod(list) {
  const L = list || [];
  const ok = L.filter((x) => achieves(x.verdict, x.t));
  const isRef = (x) => x.t.refOnly.length > 0;
  const normal = ok.filter((x) => !isRef(x));
  const order = new Map(L.map((x, i) => [x.name, i]));
  normal.sort((a, b) => b.t.M1 - a.t.M1 || b.t.M2 - a.t.M2 || a.t.M3 - b.t.M3 || order.get(a.name) - order.get(b.name));
  return { name: normal[0]?.name ?? null, ok: ok.map((x) => x.name), refOnly: ok.filter(isRef).map((x) => ({ name: x.name, reasons: [...x.t.refOnly] })) };
}

/** Ước cỡ chỉ mục int8 (byte): n × (dims + 2) + mã (13 byte + xuống dòng). */
export function indexBytesInt8(n, dims) {
  return n * (dims + 2) + n * 14;
}

/**
 * Chọn biến thể model (LỆCH LUẬT 1 (iii)). vs = [{ variant (MODEL_VARIANTS), pre, license, onnxBytes, p95, ramMiB, r7Bytes,
 * realTop5 (ảnh thật nửa chỉnh có nhãn mã, mã trong chỉ mục (a), mã đúng trong top 5 chỉ ảnh), pTop5 (mã bộ P có mã đúng
 * trong 5 hạng ảnh đầu) }]. Thứ tự: R6 + R7 → realTop5 lớn → pTop5 lớn → Apache-2.0 → ONNX nhỏ → "cat" → thứ tự model.
 * Trả { name | null, ranked: [variant|pre], dropped: [{ name, why }] }.
 */
export function pickModel(vs) {
  const dropped = [];
  const ok = [];
  for (const v of vs || []) {
    const name = `${v.variant}|${v.pre}`;
    if (!Number.isInteger(v.realTop5) || !Number.isInteger(v.pTop5)) throw new Error(`lens: ${name} thiếu realTop5 / pTop5`);
    const why = [];
    if (!(Number.isFinite(v.p95) && v.p95 <= R6_P95_MS)) why.push(`R6 p95 ${v.p95}`);
    if (!(Number.isFinite(v.r7Bytes) && v.r7Bytes <= R7_MAX_BYTES)) why.push(`R7 ${v.r7Bytes}`);
    if (why.length) dropped.push({ name, why: why.join(", ") }); else ok.push({ ...v, name });
  }
  const apache = (l) => (/apache-2\.0/i.test(String(l ?? "")) ? 0 : 1);
  ok.sort((a, b) => b.realTop5 - a.realTop5 || b.pTop5 - a.pTop5 || apache(a.license) - apache(b.license)
    || a.onnxBytes - b.onnxBytes || PRE_ORDER.indexOf(a.pre) - PRE_ORDER.indexOf(b.pre) || MODEL_VARIANTS.indexOf(a.variant) - MODEL_VARIANTS.indexOf(b.variant));
  return { name: ok[0]?.name ?? null, ranked: ok.map((x) => x.name), dropped };
}

/**
 * Cổng dừng sớm (LỆCH LUẬT 1 (ii)). p = [{ id, code, pos (hạng ảnh của mã đúng hoặc null) }] (bộ P, mỗi mã 1 lần);
 * wrong = [{ img, inIndex, pos }] (7 ảnh đang sai); none3 = [{ img, top1 }]; good = [{ img, top1 }].
 * G3: |P| ≥ G3_P_MIN → tỉ lệ trúng top 5 ≥ 50 % (true / false); |P| < G3_P_MIN → G3_SMALL ("không đủ mẫu", không chặn).
 * pass = (G3 true hoặc G3_SMALL) VÀ (G1 HOẶC G2).
 */
export function earlyGate({ p, wrong, none3, good }) {
  const P = p || [];
  const ids = new Set(P.map((x) => x.code));
  if (ids.size !== P.length) throw new Error("lens: bộ P có mã trùng (mỗi mã đếm 1 lần)");
  const hit = P.filter((x) => Number.isInteger(x.pos) && x.pos >= 1 && x.pos <= 5).length;
  const rate = P.length ? hit / P.length : null;
  const G3 = P.length >= G3_P_MIN ? rate >= G3_MIN_RATE : G3_SMALL;
  const inIdx = (wrong || []).filter((x) => x.inIndex);
  const g1n = inIdx.filter((x) => x.pos != null && x.pos <= 5).length;
  const G1 = g1n >= G1_MIN;
  const { G2, g2n, minGood, g2Why } = gateG2(good, none3);
  const g3Ok = G3 === true || G3 === G3_SMALL;
  return {
    G1, G2, G3, pass: g3Ok && (G1 || G2),
    detail: { pN: P.length, pHit5: hit, rate, g3Note: G3 === G3_SMALL ? `|P| = ${P.length} < ${G3_P_MIN}: G3 không đủ mẫu, không chặn (cổng = G1 HOẶC G2)` : null, wrongInIndex: inIdx.length, g1n, minGood, g2n, g2Why },
  };
}

/** Số ảnh thư mục 3 ("không có dữ liệu") của bộ ảnh thật. */
export const NONE3_N = 6;

/**
 * G2 (NÊN SỬA 4 của code-reviewer vòng 1): đủ 8 ảnh đang đúng + 6 ảnh thư mục 3 và MỌI top1 là số hữu hạn; thiếu / null /
 * NaN → G2 = false kèm lý do (trước đây null < số = đúng trong JS làm cổng mở nhầm). Trả { G2, g2n, minGood, g2Why }.
 */
export function gateG2(good, none3) {
  const G = good || [];
  const N = none3 || [];
  const bad = [...G, ...N].filter((x) => !Number.isFinite(x?.top1)).map((x) => `#${x?.img}`);
  let g2Why = null;
  if (G.length !== GOOD_IMGS.length) g2Why = `cần ${GOOD_IMGS.length} ảnh đang đúng, có ${G.length}`;
  else if (N.length !== NONE3_N) g2Why = `cần ${NONE3_N} ảnh thư mục 3, có ${N.length}`;
  else if (bad.length) g2Why = `top1 không phải số hữu hạn: ${bad.join(" ")}`;
  if (g2Why) return { G2: false, g2n: null, minGood: null, g2Why };
  const minGood = Math.min(...G.map((x) => x.top1));
  const g2n = N.filter((x) => x.top1 < minGood).length;
  return { G2: g2n >= G2_MIN, g2n, minGood, g2Why: null };
}

/** imgid biết được: chuỗi / số khác rỗng. */
export function knownImgid(x) {
  return (typeof x === "string" || typeof x === "number") && String(x).trim() !== "";
}

/** Chọn ảnh chỉ mục thay cho mã A / B (chống ăn gian). cands = [{ key ("front_xx.rev"), imgid, distance | null }] theo
 *  thứ tự ứng viên. imgid ảnh đo HOẶC ứng viên không rõ (null / rỗng) → từ chối ứng viên "không biết imgid" (NÊN SỬA 1
 *  của code-reviewer vòng 1: không để chỉ mã băm bảo vệ). Trả { chosen | null, rejected: [{ key, reason }] }. */
export function chooseSubstitute(cands, testImgid) {
  const rejected = [];
  const seen = new Set();
  const testKnown = knownImgid(testImgid);
  for (const c of cands || []) {
    if (!testKnown) { rejected.push({ key: c.key, reason: "không biết imgid ảnh đo" }); continue; }
    if (!knownImgid(c.imgid)) { rejected.push({ key: c.key, reason: "không biết imgid" }); continue; }
    if (String(c.imgid) === String(testImgid)) { rejected.push({ key: c.key, reason: "cùng imgid" }); continue; }
    if (seen.has(String(c.imgid))) { rejected.push({ key: c.key, reason: "trùng imgid ứng viên trước" }); continue; }
    seen.add(String(c.imgid));
    if (!Number.isFinite(c.distance)) { rejected.push({ key: c.key, reason: "không có mã băm" }); continue; }
    if (c.distance < HASH_OK_MIN) { rejected.push({ key: c.key, reason: `gần ảnh đo ${c.distance} bit (≤ 24)` }); continue; }
    return { chosen: c, rejected };
  }
  return { chosen: null, rejected };
}

/** Đọc .npy float32 (C order, little-endian) → { shape, data: Float32Array }. */
export function parseNpy(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.readUInt8(0) !== 0x93 || b.toString("latin1", 1, 6) !== "NUMPY") throw new Error("không phải file .npy");
  const major = b.readUInt8(6);
  const hlen = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8);
  const off = major === 1 ? 10 : 12;
  const header = b.toString("latin1", off, off + hlen);
  if (!/'descr':\s*'<f4'/.test(header)) throw new Error(`npy: chỉ đọc '<f4' (${header})`);
  if (/'fortran_order':\s*True/.test(header)) throw new Error("npy: không đọc fortran_order");
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const start = off + hlen;
  const n = shape.reduce((a, x) => a * x, 1);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = b.readFloatLE(start + 4 * i);
  return { shape, data };
}

/**
 * Một hàng độ giống SAU KHI ẨN (LỆCH LUẬT 2 (i)): codes / sims = hàng ĐẦY ĐỦ của sims.npy; hidden = mã bị ẩn trên hàng
 * này (mã bị loại X trên hàng ab-X). Mã ẩn coi như không có ảnh: không có trong hạng ảnh, không có trong simOf (sim ứng
 * viên = không có), không tính vào lens. Hạng: sim giảm dần, hòa → thứ tự codes (như imageRank). Trả { ranked, simOf, lens }.
 */
export function rowView(codes, sims, hidden) {
  const hid = new Set(hidden || []);
  const keep = [];
  for (let j = 0; j < codes.length; j++) if (!hid.has(codes[j])) keep.push(j);
  keep.sort((a, b) => sims[b] - sims[a] || a - b);
  const ranked = keep.map((j) => codes[j]);
  const simOf = new Map(keep.map((j) => [codes[j], sims[j]]));
  return { ranked, simOf, lens: lensOf(ranked, simOf) };
}

/**
 * Bộ sim từ nội dung đã đọc (thuần, để test không cần file): meta (meta.json), codes, queries, npy (Buffer sims.npy).
 * ĐÂY LÀ CHỖ DUY NHẤT dùng hàng sims.npy: rowOf(qid) lấy hàng đầy đủ rồi áp meta.hideByRow[qid] (rowView) trước khi xếp
 * hạng / tính lens / sim ứng viên. hideByRow sai dạng → ném lỗi. Trả { meta, codes, queries, rowOf(qid) } (qid không có
 * hàng → null).
 */
export function simsFrom({ meta, codes, queries, npy }) {
  const { shape, data } = parseNpy(npy);
  if (shape[0] !== queries.length || shape[1] !== codes.length) throw new Error(`sims.npy ${shape} ≠ ${queries.length} × ${codes.length}`);
  const hide = meta?.hideByRow ?? {};
  if (!hide || typeof hide !== "object" || Array.isArray(hide)) throw new Error("meta.hideByRow phải là object { qid: [mã] }");
  for (const [q, v] of Object.entries(hide)) if (!Array.isArray(v)) throw new Error(`meta.hideByRow[${q}] phải là mảng mã`);
  const qi = new Map(queries.map((q, i) => [q, i]));
  const cache = new Map();
  const rowOf = (qid) => {
    if (!qi.has(qid)) return null;
    if (!cache.has(qid)) {
      const i = qi.get(qid);
      const sims = data.subarray(i * codes.length, (i + 1) * codes.length);
      cache.set(qid, rowView(codes, sims, Object.hasOwn(hide, qid) ? hide[qid] : []));
    }
    return cache.get(qid);
  };
  return { meta, codes, queries, rowOf };
}

/** Bộ sim của một biến thể / mức: dir chứa sims.npy, codes.json, queries.json, meta.json (đọc file rồi simsFrom). */
export function loadSims(dir) {
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  return simsFrom({ meta: rd("meta.json"), codes: rd("codes.json"), queries: rd("queries.json"), npy: fs.readFileSync(path.join(dir, "sims.npy")) });
}

/** Mức chỉ mục hợp lệ. */
export const LEVELS = Object.freeze(["a", "b"]);
const IMG_KEY_RE = /^front_[a-z]{2,3}\.\d{1,6}$/;

/** hideByRow chuẩn của chống ăn gian (LỆCH LUẬT 2 (i)): mỗi mã bị loại X → { "ab-X": [X] }. */
export function hideByRowOf(excluded) {
  return Object.fromEntries([...(excluded || [])].sort().map((c) => [`ab-${c}`, [c]]));
}

/**
 * Điều chỉ mục ảnh PHẢI thỏa theo chống ăn gian (NÊN SỬA 5 vòng 1 + LỆCH LUẬT 2), dựng từ NỘI DUNG file
 * chong-an-gian.json (acText) và bo-p.json (bopText, null = chưa có), theo MỨC chỉ mục (level "a" | "b"). catalogImg =
 * (mã) → khóa img danh mục của mức đó (Map / object / hàm; null = không kiểm khóa của mã bị loại). Trả { level,
 * antiCheatSha256, boPSha256, excluded, hideByRow, excludedKey: { mã bị loại: khóa danh mục | null } (khi có
 * catalogImg), override: { mã: khóa ảnh chỉ mục bắt buộc } (ảnh thay A / B mọi mức + ảnh chỉ mục bộ P CHỈ ở mức a),
 * guard: [{ code, queryImgid, qid }] (ảnh truy vấn có imgid OFF: mọi mã A / B + bộ P ở mức a), mustHave: [mã bộ P ở mức a] }.
 */
export function guardWant(acText, bopText, { level = "a", catalogImg = null } = {}) {
  if (!LEVELS.includes(level)) throw new Error(`lens: mức lạ ${level}`);
  const ac = JSON.parse(acText);
  const bop = bopText == null ? null : JSON.parse(bopText);
  const P = level === "a" ? bop?.items || [] : []; // LỆCH LUẬT 2 (iii): bộ P chỉ ở mức (a)
  const override = { ...(ac.override || {}) };
  const guard = [];
  const seen = new Set();
  const add = (g) => { const k = `${g.code}|${g.queryImgid}`; if (!seen.has(k)) { seen.add(k); guard.push(g); } };
  for (const x of ac.items || []) add({ code: x.code, queryImgid: x.testImgid ?? null, qid: `ab-${x.code}` });
  for (const p of P) {
    if (Object.hasOwn(override, p.code) && override[p.code] !== p.index?.key) override[p.code] = `XUNG-DOT:${override[p.code]}|${p.index?.key}`;
    else override[p.code] = p.index?.key;
    add({ code: p.code, queryImgid: p.query?.imgid ?? null, qid: p.qid });
  }
  const excluded = [...(ac.excluded || [])];
  const keyOf = catalogImg == null ? null : typeof catalogImg === "function" ? catalogImg : catalogImg instanceof Map ? (c) => catalogImg.get(c) : (c) => catalogImg[c];
  const excludedKey = keyOf ? Object.fromEntries(excluded.map((c) => { const k = keyOf(c); return [c, typeof k === "string" && IMG_KEY_RE.test(k) ? k : null]; })) : null;
  return {
    level, antiCheatSha256: sha256Of(acText), boPSha256: bopText == null ? null : sha256Of(bopText), excluded,
    hideByRow: hideByRowOf(excluded), excludedKey, override, guard, mustHave: P.map((p) => p.code),
  };
}

/** Mã code có bị ẩn trên hàng qid theo meta.hideByRow không. */
function hiddenOn(hideByRow, qid, code) {
  const v = hideByRow && Object.hasOwn(hideByRow, qid) ? hideByRow[qid] : null;
  return Array.isArray(v) && v.includes(code);
}

/**
 * Kiểm chỉ mục ảnh (meta.json + codes.json do lens-vec.py ghi) đã áp đúng chống ăn gian (LỆCH LUẬT 2): meta ghi đúng
 * sha256 chong-an-gian.json / bo-p.json, đúng excluded / override / hideByRow; (i) mọi mã bị loại CÓ trong chỉ mục (khi
 * danh mục mức đó có khóa ảnh; dùng khóa danh mục) VÀ bị ẩn trên đúng hàng ab-<mã>, không hàng nào khác ẩn gì; (ii) mọi
 * mã có override dùng đúng khóa override (meta.indexKey); (iii) ảnh truy vấn A / B / P nằm trong chỉ mục (cùng mã + cùng
 * imgid) CHỈ được phép khi mã đó bị ẩn trên hàng của chính truy vấn đó (imgid ảnh chỉ mục phải biết, meta.indexImgid);
 * mã bộ P (mức a) phải có trong chỉ mục. expect = { model, pre, level } (thư mục đang đọc; NÊN SỬA 2): meta.threadCheck.pass
 * === true, meta.queriesMissing rỗng, meta.missingIndexFiles === 0, meta.model / pre / level khớp. Trả mảng lỗi (rỗng = đạt).
 */
export function checkIndexGuard(meta, codes, want, expect = null) {
  const errs = [];
  const m = meta || {};
  const w = want || {};
  const inIdx = new Set(codes || []);
  const sortedJson = (o) => JSON.stringify(Object.entries(o || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  if (!w.antiCheatSha256 || m.antiCheatSha256 !== w.antiCheatSha256) errs.push(`meta.antiCheatSha256 ${m.antiCheatSha256} ≠ chong-an-gian.json ${w.antiCheatSha256}`);
  if (m.boPSha256 !== w.boPSha256) errs.push(`meta.boPSha256 ${m.boPSha256} ≠ bo-p.json ${w.boPSha256}`);
  if (m.level !== w.level) errs.push(`meta.level ${m.level} ≠ mức đang kiểm ${w.level}`);
  if (JSON.stringify([...(m.excluded || [])].sort()) !== JSON.stringify([...(w.excluded || [])].sort())) errs.push("meta.excluded khác chong-an-gian.json");
  if (sortedJson(m.override) !== sortedJson(w.override)) errs.push(`meta.override khác chong-an-gian.json + bo-p.json (mức ${w.level})`);
  for (const [c, k] of Object.entries(w.override || {})) if (String(k).startsWith("XUNG-DOT:")) errs.push(`override mâu thuẫn cho ${c}: ${k}`);
  // (i) ẩn theo hàng
  const hide = m.hideByRow;
  if (!hide || typeof hide !== "object" || Array.isArray(hide)) errs.push("meta.hideByRow thiếu / sai dạng");
  else {
    if (sortedJson(Object.fromEntries(Object.entries(hide).map(([q, v]) => [q, Array.isArray(v) ? [...v].sort() : v]))) !== sortedJson(w.hideByRow)) errs.push("meta.hideByRow khác chong-an-gian.json");
    const exc = new Set(w.excluded || []);
    for (const [q, v] of Object.entries(hide)) {
      const mm = /^ab-(\d+)$/.exec(q);
      if (!mm) { errs.push(`(i) ẩn trên hàng không phải A / B: ${q}`); continue; }
      for (const c of Array.isArray(v) ? v : []) if (c !== mm[1] || !exc.has(c)) errs.push(`(i) ẩn sai: mã ${c} trên hàng ${q}`);
    }
  }
  const keyOfIdx = m.indexKey || {};
  for (const c of w.excluded || []) {
    if (!hiddenOn(hide, `ab-${c}`, c)) errs.push(`(i) mã bị loại ${c} không bị ẩn trên hàng ab-${c}`);
    const ek = w.excludedKey ? w.excludedKey[c] : undefined;
    if (ek === null) { if (inIdx.has(c)) errs.push(`(i) mã bị loại ${c} không có khóa ảnh ở danh mục mức ${w.level} mà vẫn có trong chỉ mục`); continue; }
    if (!inIdx.has(c)) { errs.push(`(i) mã bị loại ${c} vắng khỏi chỉ mục (phải có, dùng khóa ảnh danh mục)`); continue; }
    if (ek !== undefined && keyOfIdx[c] !== ek) errs.push(`(i) mã bị loại ${c} dùng ảnh ${keyOfIdx[c]} thay vì khóa danh mục ${ek}`);
  }
  // (ii) override
  for (const [c, k] of Object.entries(w.override || {})) if (inIdx.has(c) && keyOfIdx[c] !== k) errs.push(`(ii) ${c} dùng ảnh ${keyOfIdx[c]} thay vì ${k}`);
  // (iii) ảnh truy vấn trong chỉ mục chỉ khi bị ẩn trên chính hàng đó
  const imgidOfIdx = m.indexImgid || {};
  for (const g of w.guard || []) {
    if (!inIdx.has(g.code) || hiddenOn(hide, g.qid, g.code)) continue;
    if (!knownImgid(g.queryImgid)) { errs.push(`(iii) không biết imgid ảnh truy vấn ${g.qid}`); continue; }
    const ii = imgidOfIdx[g.code];
    if (!knownImgid(ii)) errs.push(`(iii) không biết imgid ảnh chỉ mục của ${g.code}`);
    else if (String(ii) === String(g.queryImgid)) errs.push(`(iii) ảnh truy vấn ${g.qid} nằm trong chỉ mục (cùng mã + imgid ${ii}) mà không bị ẩn trên hàng đó`);
  }
  const miss = (w.mustHave || []).filter((c) => !inIdx.has(c));
  if (miss.length) errs.push(`mã bộ P không có trong chỉ mục: ${miss.join(" ")}`);
  // NÊN SỬA 2: bộ sim phải là bản đạt kiểm luồng, đủ truy vấn, đủ ảnh chỉ mục, đúng thư mục
  if (expect) {
    if (m.threadCheck?.pass !== true) errs.push("meta.threadCheck.pass không phải true (bộ sim trượt kiểm nhiều luồng)");
    if (!Array.isArray(m.queriesMissing) || m.queriesMissing.length) errs.push(`meta.queriesMissing không rỗng: ${JSON.stringify(m.queriesMissing)}`);
    if (m.missingIndexFiles !== 0) errs.push(`meta.missingIndexFiles = ${m.missingIndexFiles} (phải 0)`);
    for (const k of ["model", "pre", "level"]) if (m[k] !== expect[k]) errs.push(`meta.${k} ${m[k]} ≠ thư mục ${expect[k]}`);
  }
  return errs;
}

// ---------------- kiểm đầu vào trước mọi phán (NÊN SỬA 3–5 của code-reviewer trước đo) ----------------
/**
 * 6 biến thể PHẢI có bộ sim (model × tiền xử lý; tên model như MODEL_VARIANTS / lens-vec.py MODELS). SigLIP không tính
 * vector: R7 ước ở mức (b) (42.208 sp có ảnh × (768 + 2 + 14) byte) = 33,1 MB > 25 MB, ghi vào dropped của --chon-model.
 */
export const VEC_VARIANTS = Object.freeze([
  "clip-fp32|cat", "clip-fp32|vien", "clip-int8|cat", "clip-int8|vien", "dinov2-small|cat", "dinov2-small|vien",
]);
export const NO_VEC_VARIANTS = Object.freeze(PRE_ORDER.map((pre) => Object.freeze({ name: `siglip|${pre}`, why: "R7 ước 33,1 MB > 25 MB" })));

/**
 * Thư mục bộ sim của 6 biến thể ở một mức: <vecDir>/<model>-<pre>/<level>. hasMeta(dir) → có meta.json (mặc định
 * fs.existsSync). Thiếu bất kỳ biến thể nào → exitCode 3 (không lặng lẽ bỏ khỏi bảng). Trả { exitCode, dirs: [{ variant,
 * pre, name, dir }], missing: [tên] }.
 */
export function variantPlan(vecDir, level, hasMeta = (d) => fs.existsSync(path.join(d, "meta.json"))) {
  const dirs = [];
  const missing = [];
  for (const name of VEC_VARIANTS) {
    const [variant, pre] = name.split("|");
    const dir = path.join(vecDir, `${variant}-${pre}`, level);
    if (hasMeta(dir)) dirs.push({ variant, pre, name, dir }); else missing.push(name);
  }
  return { exitCode: missing.length ? 3 : 0, dirs, missing };
}

/** Cạnh dài / chất lượng JPEG của ảnh truy vấn khi đo R6 (LỆCH LUẬT 2 (ii), như prepareImage của app). */
export const R6_LONG_EDGE = 1600;
export const R6_JPEG_QUALITY = 0.9;

/**
 * Số R6 của một biến thể từ file đo 1.600 px (gio-1600.json của lens-vec.py gio1600; NÊN SỬA 5): kiểm file đúng loại
 * (cạnh dài 1.600, JPEG 0,9, 1 luồng, ≥ 20 ảnh) và có số hữu hạn; thiếu / sai → ném lỗi (người gọi thoát mã 3).
 * NÊN SỬA 1 của code-reviewer trước đo lần 2: file phải có chứng cứ (at, vecPySha256), ma trận tìm ≥ R6_N_SEARCH hàng
 * (cỡ mức (b)), sha256 file ONNX thật sự đã đo (models[variant].onnxSha256) trùng bản ghim trong file và trùng
 * onnxSha256 truyền vào (sha256 trong meta.json của bộ sim; bỏ trống = không so). Trả { p95, median, max, n, ramAddMiB,
 * peakMiB, at, vecPySha256, gitHead, nSearch, onnxSha256 }.
 * Vòng 3 (theo review sau cổng): opts.requireOnnx (lens-chay luôn bật, gợi ý 1) → onnxSha256 PHẢI là chuỗi 64 hex,
 * undefined / sai dạng → ném (trước đây bỏ qua so sánh lặng lẽ); opts.vecPySha256 (sha lens-vec.py đang chạy, --do truyền)
 * → file giờ phải đo bằng đúng bản đó; opts.requireClean → file giờ phải có gitDirty === false (NÊN SỬA 3).
 */
export function r6From(gio, variant, pre, onnxSha256 = null, { requireOnnx = false, vecPySha256 = null, requireClean = false } = {}) {
  const g = gio || {};
  if (requireOnnx && !HEX64.test(onnxSha256 ?? "")) throw new Error(`lens: sha256 ONNX của bộ sim (${onnxSha256}) không phải chuỗi 64 hex`);
  if (vecPySha256 != null && !HEX64.test(vecPySha256)) throw new Error(`lens: sha256 lens-vec.py hiện tại (${vecPySha256}) không phải chuỗi 64 hex`);
  if (g.longEdge !== R6_LONG_EDGE || g.jpegQuality !== R6_JPEG_QUALITY || g.threads !== 1) throw new Error(`lens: file giờ không phải số đo ${R6_LONG_EDGE} px JPEG ${R6_JPEG_QUALITY} 1 luồng`);
  if (typeof g.at !== "string" || !g.at || !/^[0-9a-f]{64}$/.test(g.vecPySha256 ?? "")) throw new Error("lens: file giờ thiếu chứng cứ (at / vecPySha256): đo lại bằng lens-vec.py gio1600");
  if (!(Number.isInteger(g.nSearch) && g.nSearch >= R6_N_SEARCH)) throw new Error(`lens: file giờ đo trên ma trận tìm ${g.nSearch} hàng < ${R6_N_SEARCH} (mức (b))`);
  const m = g.models?.[variant];
  const t = m?.time?.[pre];
  if (!t || !Number.isFinite(t.p95) || !Number.isFinite(t.median) || !Number.isFinite(t.max) || !(t.n >= TIME_N)) throw new Error(`lens: thiếu số R6 1.600 px của ${variant}|${pre}`);
  if (!Number.isFinite(m.ramAddAfter20MiB)) throw new Error(`lens: thiếu RAM thêm (1.600 px) của ${variant}`);
  if (!/^[0-9a-f]{64}$/.test(m.onnxSha256 ?? "") || m.onnxSha256 !== m.sha256) throw new Error(`lens: sha256 ONNX đã đo của ${variant} (${m.onnxSha256}) khác bản ghim ${m.sha256}`);
  if (onnxSha256 != null && m.onnxSha256 !== onnxSha256) throw new Error(`lens: sha256 ONNX đo giờ của ${variant} (${m.onnxSha256}) khác meta bộ sim ${onnxSha256}`);
  if (vecPySha256 != null && g.vecPySha256 !== vecPySha256) throw new Error(`lens: file giờ đo bằng lens-vec.py ${g.vecPySha256} khác lens-vec.py hiện tại ${vecPySha256}: đo lại gio1600`);
  if (requireClean && g.gitDirty !== false) throw new Error(`lens: file giờ đo khi worktree không chắc sạch (gitDirty ${g.gitDirty}): đo lại gio1600 trên worktree sạch`);
  return { p95: t.p95, median: t.median, max: t.max, n: t.n, ramAddMiB: m.ramAddAfter20MiB, peakMiB: m.peakWsMiB ?? null, at: g.at, vecPySha256: g.vecPySha256, gitHead: g.gitHead ?? null, nSearch: g.nSearch, onnxSha256: m.onnxSha256 };
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Chứng cứ bản code của một bộ vector (NÊN SỬA 3 của code-reviewer sau cổng): meta.vecPySha256 === sha256 lens-vec.py
 * đang chạy (vecPySha256) VÀ meta.gitDirty === false. Chỉ áp cho bộ (b) và bộ int8 (--do); bộ (a) đã chốt không áp.
 * vecPySha256 sai dạng → ném. Trả mảng lỗi (rỗng = đạt).
 */
export function vecMetaErrors(meta, { vecPySha256, what }) {
  if (!HEX64.test(vecPySha256 ?? "")) throw new Error(`lens: sha256 lens-vec.py hiện tại (${vecPySha256}) không phải chuỗi 64 hex`);
  const m = meta || {};
  const errs = [];
  if (!HEX64.test(m.vecPySha256 ?? "")) errs.push(`bộ ${what}: meta.vecPySha256 thiếu / sai dạng (${m.vecPySha256}): dựng lại bằng lens-vec.py hiện tại`);
  else if (m.vecPySha256 !== vecPySha256) errs.push(`bộ ${what}: meta.vecPySha256 ${m.vecPySha256} khác lens-vec.py hiện tại ${vecPySha256}`);
  if (m.gitDirty !== false) errs.push(`bộ ${what}: meta.gitDirty ${m.gitDirty} (phải false: dựng trên worktree sạch)`);
  return errs;
}

/** Cách lượng tử của chỉ mục sẽ đóng gói (khối luật: "vector int8 đối xứng theo từng vector, thang float16"; cài ở vòng 3). */
export const INT8_QUANT = "int8-sym-perVector-scaleF16-invNorm";
/** Khóa bắt buộc của meta.int8Loss (lens-vec.py int8). */
export const INT8_LOSS_KEYS = Object.freeze(["n", "fp32", "int8", "changed", "top10OverlapMean", "maxAbsSimDiff"]);

/**
 * Kiểm meta bộ int8 (A4): quant đúng chuỗi, indexBytes === indexBytesInt8(nIndex, dims), int8Loss đủ khóa và số hữu hạn,
 * fp32Sha256 === sha256 index.npy của bộ (b) (fp32Sha256 truyền vào, tính trên file thật). Trả mảng lỗi.
 */
export function int8MetaErrors(meta, { fp32Sha256 }) {
  const m = meta || {};
  const errs = [];
  if (m.quant !== INT8_QUANT) errs.push(`int8: meta.quant ${m.quant} ≠ ${INT8_QUANT}`);
  if (!Number.isInteger(m.nIndex) || !Number.isInteger(m.dims) || m.nIndex <= 0 || m.dims <= 0) errs.push(`int8: meta.nIndex / dims sai (${m.nIndex} / ${m.dims})`);
  else if (!Number.isInteger(m.indexBytes)) errs.push(`int8: thiếu meta.indexBytes (${m.indexBytes})`);
  else if (m.indexBytes !== indexBytesInt8(m.nIndex, m.dims)) errs.push(`int8: meta.indexBytes ${m.indexBytes} ≠ indexBytesInt8(${m.nIndex}, ${m.dims}) = ${indexBytesInt8(m.nIndex, m.dims)}`);
  const L = m.int8Loss;
  const fin = (x) => Number.isFinite(x);
  const tri = (o) => o && typeof o === "object" && ["top1", "top5", "top10"].every((k) => Number.isInteger(o[k]));
  if (!L || typeof L !== "object") errs.push("int8: thiếu meta.int8Loss");
  else {
    const miss = INT8_LOSS_KEYS.filter((k) => !Object.hasOwn(L, k) || L[k] == null);
    if (miss.length) errs.push(`int8: meta.int8Loss thiếu ${miss.join(" ")}`);
    else if (!Number.isInteger(L.n) || !tri(L.fp32) || !tri(L.int8) || !tri(L.changed) || !fin(L.top10OverlapMean) || !fin(L.maxAbsSimDiff)) errs.push("int8: meta.int8Loss có số sai dạng / không hữu hạn");
  }
  if (!HEX64.test(fp32Sha256 ?? "")) errs.push(`int8: không có sha256 index.npy của bộ fp32 (${fp32Sha256})`);
  else if (m.fp32Sha256 !== fp32Sha256) errs.push(`int8: meta.fp32Sha256 ${m.fp32Sha256} ≠ sha256 index.npy của bộ fp32 ${fp32Sha256}`);
  return errs;
}

/**
 * Kiểm đầu vào của --do (A1 + A4, chạy TRƯỚC τ / μ và mọi phán): bộ (b) fp32 và bộ int8 cùng đúng bản lens-vec.py hiện
 * tại + worktree sạch (vecMetaErrors), bộ int8 đủ khóa (int8MetaErrors), int8 dựng từ đúng bộ (b) (model / pre / level /
 * sha256 ONNX / vaoSha256 / nIndex / dims trùng). Trả { exitCode (0 | 3), errs }.
 */
export function doInputCheck({ bMeta, int8Meta, fp32Sha256, vecPySha256 }) {
  const errs = [...vecMetaErrors(bMeta, { vecPySha256, what: "(b) fp32" }), ...vecMetaErrors(int8Meta, { vecPySha256, what: "int8" }), ...int8MetaErrors(int8Meta, { fp32Sha256 })];
  for (const k of ["model", "pre", "level", "sha256", "vaoSha256", "nIndex", "dims"]) if ((int8Meta || {})[k] !== (bMeta || {})[k]) errs.push(`int8: meta.${k} ${(int8Meta || {})[k]} ≠ bộ fp32 ${(bMeta || {})[k]}`);
  if ((bMeta || {}).level !== "b") errs.push(`bộ fp32: meta.level ${(bMeta || {}).level} ≠ b`);
  return { exitCode: errs.length ? 3 : 0, errs };
}

/** 5 ảnh thật của G1 có mã đúng trong chỉ mục (a) (cong.json: #11, #16 không có trong (a)); chỉ dùng cho --cong-chi-bao. */
export const G1_IMGS = Object.freeze([2, 4, 5, 10, 15]);

/**
 * Chỉ báo cổng (A5, NÊN SỬA 2 (e)): row = rowView (hàng SAU KHI ẨN), code = mã đúng. Trả { rank, sim, sim5, sim6, ties
 * (số mã KHÁC có sim bằng đúng sim mã đúng), rankMin / rankMax (khoảng hạng của mã đúng nếu xếp hòa theo mọi thứ tự),
 * tieCrosses5 (rankMin ≤ 5 < rankMax), note }. Mã không có trên hàng → rank null.
 */
export function tieInfo(row, code) {
  const ranked = row?.ranked || [];
  const simOf = row?.simOf || new Map();
  const at = (k) => (ranked.length >= k ? simOf.get(ranked[k - 1]) : null);
  const base = { sim5: at(5), sim6: at(6) };
  if (!simOf.has(code)) return { rank: null, sim: null, ...base, ties: null, rankMin: null, rankMax: null, tieCrosses5: false, note: "mã đúng không có trên hàng (không có trong chỉ mục / bị ẩn)" };
  const s = simOf.get(code);
  let gt = 0;
  let eq = 0;
  for (const v of simOf.values()) { if (v > s) gt++; else if (v === s) eq++; }
  const rankMin = gt + 1;
  const rankMax = gt + eq;
  const tieCrosses5 = rankMin <= 5 && rankMax > 5;
  return {
    rank: ranked.indexOf(code) + 1, sim: s, ...base, ties: eq - 1, rankMin, rankMax, tieCrosses5,
    note: tieCrosses5 ? "cổng phụ thuộc thứ tự hòa (luật cho phép: hòa theo codes.json)" : null,
  };
}
/** Số hàng tối thiểu của ma trận tìm khi đo R6 (số sản phẩm có ảnh ở mức (b), planList của lens-tai.mjs). */
export const R6_N_SEARCH = 42208;

/**
 * Trước mọi phán (NÊN SỬA 3): mọi qid của ca có ảnh (A / B, ảnh thật, buldak, ruaypuan) và của bộ P phải có hàng sim;
 * abQids (một phần tử mỗi Ô A / B, 60 = 30 mã × 2 bộ) phải đủ abN và mỗi hàng có lens (sau khi ẩn). Trả { exitCode,
 * errs, tops (lens của từng ô A / B, theo thứ tự abQids) }.
 */
export function rowCheck(rowOf, { qids = [], abQids = null, abN = 60 } = {}) {
  const errs = [];
  const miss = [...new Set(qids)].filter((q) => !rowOf(q));
  if (miss.length) errs.push(`thiếu hàng sim cho truy vấn: ${miss.join(" ")}`);
  let tops = null;
  // gợi ý 4 của code-reviewer trước đo lần 2: lens có thì top1 / margin phải là số hữu hạn (NaN / null → mã 3)
  const finiteLens = (l) => Number.isFinite(l?.top1) && Number.isFinite(l?.margin);
  const badLens = [...new Set(qids)].filter((q) => { const l = rowOf(q)?.lens; return l != null && !finiteLens(l); });
  if (abQids) {
    tops = abQids.map((q) => rowOf(q)?.lens ?? null);
    if (abQids.length !== abN) errs.push(`ô A / B có ${abQids.length} (phải ${abN})`);
    const noLens = abQids.filter((q, i) => !tops[i]);
    if (noLens.length) errs.push(`ô A / B không có lens: ${[...new Set(noLens)].join(" ")}`);
    for (const [i, q] of abQids.entries()) if (tops[i] && !finiteLens(tops[i]) && !badLens.includes(q)) badLens.push(q);
  }
  if (badLens.length) errs.push(`lens.top1 / margin không hữu hạn: ${badLens.join(" ")}`);
  return { exitCode: errs.length ? 3 : 0, errs, tops };
}

/** Mã truy vấn ảnh của một ca (null = ca không có ảnh). */
export function qidOf(c) {
  if (c.set === "A" || c.set === "B") return `ab-${c.code}`;
  if (c.set === "that") return `that-${c.img}`;
  if (c.set === "buldak" || c.set === "ruaypuan") return c.set;
  return null;
}

// ---------------- chạy ----------------
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  // KHÔNG await ở cấp module: lens-chay.mjs import lại file này (vòng import), await ở đây sẽ treo.
  import("./lens-chay.mjs").then(({ runMain }) => runMain(process.argv.slice(2), import.meta.url)).catch((e) => { console.error(e); process.exit(1); });
}
