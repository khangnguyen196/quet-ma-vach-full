# CLAUDE.md – Hướng dẫn cho Claude Code

## Dự án là gì
Web app quét mã vạch đồ ăn: quét mã EAN-13 trên bao bì → tra Open Food Facts → hiện dinh dưỡng, thành phần, dị ứng, xuất xứ, bảo quản. Có "tủ đồ ăn" để người dùng nhập hạn sử dụng và được nhắc. Người làm là sinh viên năm nhất, đang học lập trình, làm một mình.

Đọc `PLAN.md` để biết tính năng theo giai đoạn và checklist. Làm đúng giai đoạn đang mở, không nhảy cóc.

## Stack
- HTML + CSS + JavaScript thuần (ES modules), bundler Vite. **Không** đưa React/Vue/TypeScript vào trừ khi được yêu cầu.
- `html5-qrcode`: dự phòng cho "Bật camera" và "Chụp ảnh mã" khi không tải được zxing-wasm; `tesseract.js` chỉ cài khi tới giai đoạn 3.
- `zxing-wasm` cho nút "Chụp ảnh mã" (chủ dự án đồng ý 06/11/2026: bao bì thật nhăn / xoay dọc thì html5-qrcode đọc ảnh trượt) và giải mã khung hình "Bật camera" (chủ dự án đồng ý 07/11/2026 nếu đo thấy tốt hơn; đợt `nhay-hon` đo camera giả: 20% → 81% ra mã trong 5 giây). File wasm tự host trong `dist/assets` (không tải từ CDN), chỉ tải khi người dùng chọn ảnh hoặc bấm "Bật camera", không vào danh sách lưu sẵn (precache) của service worker; không tải được thì quay về html5-qrcode.
- Dữ liệu: Open Food Facts API v2 (không cần key). Lưu trữ: localStorage.
- Lệnh: `npm run dev` (dev có HTTPS), `npm run build`, `npm run preview`, `npm test` (test node của app ở `tests/`).
- Đưa lên web: lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions (workflow "Deploy GitHub Pages", `.github/workflows/deploy.yml`) tự chạy `npm ci` + `npm run build` rồi deploy `dist/` lên GitHub Pages. Không cần build hay upload tay.

## Cấu trúc
- `src/main.js` – nối sự kiện, điều phối. Không chứa logic gọi API hay HTML dài.
- `src/scanner.js` – mọi thứ về camera / đọc ảnh. Camera: tự mở (getUserMedia + `<video>`), hiện hình ngay, chờ wasm sau (chữ "Đang tải bộ đọc mã…"); mỗi ~120 ms cắt vùng giữa khung hình ở độ phân giải thật rồi giải mã bằng BarcodeDetector (nếu có; ném lỗi thì bỏ, vẫn đọc bằng zxing-wasm) + zxing-wasm; có biến đếm lượt (`session`) để lượt giải mã dở không gọi onCode sau khi tắt; tắt thì dừng mọi track, `srcObject = null`; không có zxing-wasm thì html5-qrcode. Ảnh: zxing-wasm trước, html5-qrcode dự phòng. Đèn pin / phóng to: `trackInfo()`, `applyTrack()`.
- `src/zxing-reader.js` – bọc zxing-wasm (chỉ import động khi chọn ảnh hoặc bấm "Bật camera"; `readCodes` cho ảnh, `prepareReader` + `readCameraCodes` cho camera); wasm lấy từ file của app, không từ CDN; chờ tải wasm tối đa 10 giây (`ZXING_LOAD_TIMEOUT_MS`), hết giờ thì scanner.js đọc bằng html5-qrcode, lần tải dở chạy tiếp cho lần chụp sau, tải lỗi thật thì xóa để lần sau tải lại.
- `src/barcode.js` – chọn mã từ kết quả zxing-wasm, ghép dòng lỗi "đã thử những gì", `raceTimeout`, `ZXING_LOAD_TIMEOUT_MS`, `makeZxingTimeoutError` / `isZxingTimeout` (lỗi hết giờ tải wasm có cờ `timeout`, scanner.js kiểm cờ, không so câu lỗi) (thuần, không DOM, không import thư viện).
- `src/camera.js` – phần thuần của "Bật camera": `cameraConstraints` (camera sau, 1280×720), `cameraCrop` (vùng giải mã 92% × 60% phần nhìn thấy), `pickCameraCode` / `confirmCode` / `detectorCode` (mã dài trước, mã 8 số đọc 2 lần trong 1 giây hoặc ở 2 khung giải mã liền nhau mới nhận: `CONFIRM_WINDOW_MS`), `cameraControls` / `nextZoom` / `zoomLabel` (nút đèn pin / phóng to chỉ khi máy hỗ trợ) (không DOM).
- `src/off.js` – gọi API và hàm `normalize()` đổi dữ liệu thô sang object tiếng Việt sạch. Mọi mapping (tên dị ứng, NOVA…) nằm ở đây.
- `src/render.js` – hàm trả về chuỗi HTML từ object đã normalize. Luôn escape dữ liệu từ API bằng `esc()`.
- `src/storage.js` – đọc/ghi localStorage, bọc try/catch.
- `src/pantry.js` – tính số ngày còn hạn, trạng thái, sắp xếp, định dạng ngày (không DOM, không localStorage); `isValidItem` / `cleanItem` / `NAME_MAX` cũng ở đây.
- `src/compare.js` – so sánh 2 sản phẩm: 6 chỉ số trên 100 g / 100 ml, thời gian chờ giữa 2 lần gọi mạng (`compareWaitMs`) (không DOM, không tự tính).
- `src/backup.js` – xuất / nhập tủ đồ bằng file JSON: tạo file, kiểm định dạng, gộp (không DOM).
- `src/pwa.js` – đăng ký service worker (chỉ ở bản build) + thanh "Đã có bản mới".
- `src/style.css` – màu dùng biến trên `:root`, có bản tối.
- `public/` – `manifest.webmanifest` + `icons/` (PNG), Vite chép nguyên vào `dist/`.
- `public/ocr-thu.html` (+ `public/ocr-thu/regex.mjs`, `text.mjs`) – trang THỬ OCR riêng (đợt ocr-c), không có link từ app, noindex; PaddleOCR.js + tesseract.js và model tải từ CDN (jsDelivr, HuggingFace) đúng bản cố định của `test-ocr/web-ocr/assets.js`, không vào bundle / package.json của app. `regex.mjs` là bản JS của `extract_regex` (Python là chuẩn; sửa luật thì chạy `test-ocr/web-ocr/regex-parity.mjs`).
- `test-ocr/` – so sánh OCR (Python, `test-ocr/README.md`); `test-ocr/web-ocr/` đo OCR trong trình duyệt bằng Playwright (package.json riêng), `test-ocr/vietocr/` PP-OCRv5 det + VietOCR (venv riêng, chỉ để so mức máy chủ). Không thuộc app.
- `tools/` – `make-icons.mjs` (vẽ icon, chạy một lần: `node tools/make-icons.mjs`), `sw-build.mjs` (ghép mã sw.js). `sw.js` sinh lúc build bằng plugin trong `vite.config.js`; không sửa tay trong `dist/`.

## Quy ước
- Giao diện, thông báo lỗi, comment: **tiếng Việt**. Tên biến, hàm, file: tiếng Anh.
- Giải thích ngắn gọn bằng tiếng Việt khi sửa code; khi dùng kỹ thuật mới (async/await, module, localStorage…) thì cho 1 ví dụ nhỏ trước rồi mới áp dụng vào dự án.
- Mỗi lần thay đổi: nhỏ, chạy được, mô tả rõ phải test gì trên điện thoại.
- Không bịa dữ liệu sản phẩm. Trường API trống thì hiện "chưa có dữ liệu", không đoán.
- Không commit `.env`. Chỉ sửa `.env.example` khi thêm biến mới.
- Không đổi thư viện quét hay cách gọi API nếu chưa hỏi.
- Giữ số dependency tối thiểu; cài thêm gói thì nói lý do.
- Service worker không bao giờ cache request khác tên miền (Open Food Facts, Google Fonts): chỉ giữ giao diện của app.
- Xuống dòng LF cho mọi file text (.gitattributes) để VERSION build trên máy giống bản trên Pages.

## Test nhanh
- Mã có đủ dữ liệu: `8934563163150`. Mã thiếu dữ liệu: `8934563651138`. Mã không tồn tại: `0000000000000`. Mã có dữ liệu dị ứng: `8993175532457` (allergens_tags `en:gluten, en:milk, en:soybeans`; traces_tags `en:eggs, en:milk, en:nuts, en:peanuts`, kiểm 06/11/2026).
- Link app (bản đã deploy): https://khangnguyen196.github.io/quet-ma-vach-full/ – điện thoại mở thẳng link này, đã là HTTPS thật nên không cần chấp nhận chứng chỉ.
- Bản dev trên máy (`npm run dev`): camera chỉ chạy trên HTTPS/localhost; trên điện thoại mở `https://<ip-máy-tính>:5173` và chấp nhận chứng chỉ tự ký.
