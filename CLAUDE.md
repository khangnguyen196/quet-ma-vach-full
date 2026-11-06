# CLAUDE.md – Hướng dẫn cho Claude Code

## Dự án là gì
Web app quét mã vạch đồ ăn: quét mã EAN-13 trên bao bì → tra Open Food Facts → hiện dinh dưỡng, thành phần, dị ứng, xuất xứ, bảo quản. Có "tủ đồ ăn" để người dùng nhập hạn sử dụng và được nhắc. Người làm là sinh viên năm nhất, đang học lập trình, làm một mình.

Đọc `PLAN.md` để biết tính năng theo giai đoạn và checklist. Làm đúng giai đoạn đang mở, không nhảy cóc.

## Stack
- HTML + CSS + JavaScript thuần (ES modules), bundler Vite. **Không** đưa React/Vue/TypeScript vào trừ khi được yêu cầu.
- `html5-qrcode` để quét; `tesseract.js` chỉ cài khi tới giai đoạn 3.
- Dữ liệu: Open Food Facts API v2 (không cần key). Lưu trữ: localStorage.
- Lệnh: `npm run dev` (dev có HTTPS), `npm run build`, `npm run preview`, `npm test` (test node của app ở `tests/`).
- Đưa lên web: lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions (workflow "Deploy GitHub Pages", `.github/workflows/deploy.yml`) tự chạy `npm ci` + `npm run build` rồi deploy `dist/` lên GitHub Pages. Không cần build hay upload tay.

## Cấu trúc
- `src/main.js` – nối sự kiện, điều phối. Không chứa logic gọi API hay HTML dài.
- `src/scanner.js` – mọi thứ về camera / đọc ảnh.
- `src/off.js` – gọi API và hàm `normalize()` đổi dữ liệu thô sang object tiếng Việt sạch. Mọi mapping (tên dị ứng, NOVA…) nằm ở đây.
- `src/render.js` – hàm trả về chuỗi HTML từ object đã normalize. Luôn escape dữ liệu từ API bằng `esc()`.
- `src/storage.js` – đọc/ghi localStorage, bọc try/catch.
- `src/pantry.js` – tính số ngày còn hạn, trạng thái, sắp xếp, định dạng ngày (không DOM, không localStorage); `isValidItem` / `cleanItem` / `NAME_MAX` cũng ở đây.
- `src/compare.js` – so sánh 2 sản phẩm: 6 chỉ số trên 100 g / 100 ml (không DOM, không tự tính).
- `src/backup.js` – xuất / nhập tủ đồ bằng file JSON: tạo file, kiểm định dạng, gộp (không DOM).
- `src/pwa.js` – đăng ký service worker (chỉ ở bản build) + thanh "Đã có bản mới".
- `src/style.css` – màu dùng biến trên `:root`, có bản tối.
- `public/` – `manifest.webmanifest` + `icons/` (PNG), Vite chép nguyên vào `dist/`.
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

## Test nhanh
- Mã có đủ dữ liệu: `8934563163150`. Mã thiếu dữ liệu: `8934563651138`. Mã không tồn tại: `0000000000000`. Mã có dữ liệu dị ứng: `8993175532457` (allergens_tags `en:gluten, en:milk, en:soybeans`; traces_tags `en:eggs, en:milk, en:nuts, en:peanuts`, kiểm 06/11/2026).
- Link app (bản đã deploy): https://khangnguyen196.github.io/quet-ma-vach-full/ – điện thoại mở thẳng link này, đã là HTTPS thật nên không cần chấp nhận chứng chỉ.
- Bản dev trên máy (`npm run dev`): camera chỉ chạy trên HTTPS/localhost; trên điện thoại mở `https://<ip-máy-tính>:5173` và chấp nhận chứng chỉ tự ký.
