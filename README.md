# Quét mã vạch đồ ăn

Quét mã vạch trên bao bì → xem dinh dưỡng, thành phần, dị ứng (dữ liệu Open Food Facts).

## Chạy thử
Cần Node.js bản 20.19 trở lên trong dòng 20, hoặc bản 22.12 trở lên. Node 21 và 22.0 đến 22.11 không chạy được (Vite 7 đòi vậy). Dễ nhất: cài bản LTS mới nhất từ https://nodejs.org. Kiểm tra bằng lệnh: `node -v`
```
npm install
cp .env.example .env
npm run dev
```
Máy tính: mở `https://localhost:5173`. Điện thoại cùng Wi-Fi: mở địa chỉ `https://192.168.x.x:5173` mà terminal in ra, chấp nhận chứng chỉ tự ký.

## Hồ sơ dị ứng
Ở màn Tra cứu, mở khung "Hồ sơ dị ứng" và tick các nhóm bạn bị dị ứng (sữa, đậu phộng, gluten…). Tick là lưu ngay trên máy này (localStorage), tải lại trang vẫn còn. Khi tra một sản phẩm, đầu kết quả có khung đỏ nếu Open Food Facts ghi sản phẩm có nhóm trong hồ sơ, khung vàng nếu "có thể lẫn vết", hoặc một câu nhắc khi Open Food Facts chưa có dữ liệu dị ứng. Cảnh báo chỉ dựa trên dữ liệu cộng đồng của Open Food Facts, có thể thiếu hoặc sai: **không thay cho việc đọc nhãn trên bao bì**, app không bao giờ ghi sản phẩm là an toàn.

## So sánh 2 sản phẩm
Bấm "So sánh" ở đầu trang (hoặc "So sánh với sản phẩm khác" dưới kết quả tra, mã đang xem được điền sẵn bên A). Nhập 2 mã hoặc chọn từ "đã quét gần đây". App hiện 2 cột cạnh nhau: năng lượng, đường, muối, chất béo, chất béo bão hòa, đạm trên 100 g / 100 ml, kèm cảnh báo dị ứng theo hồ sơ cho mỗi sản phẩm. Ô Open Food Facts chưa có ghi "chưa có dữ liệu" (app không tự tính hay đoán). Mã vừa tra được nhớ trong 10 phút nên so lại không gọi Open Food Facts lần nữa.

## Xuất / Nhập tủ đồ (chuyển sang máy khác)
Trong màn "Tủ đồ": "Xuất tủ đồ" tải về file `tu-do-YYYY-MM-DD.json` (gồm tủ đồ và hồ sơ dị ứng). Sang máy khác, "Nhập tủ đồ" chọn file đó, app kiểm đúng định dạng rồi hỏi: "Gộp vào tủ hiện tại" (món đã có giữ nguyên), "Thay toàn bộ" (hỏi xác nhận, tủ cũ được chép bản dự phòng trên máy) hoặc "Hủy". Dữ liệu chỉ nằm trên máy và trong file, không gửi đi đâu. Lưu ý: trên iPhone, app mở từ màn hình chính có thể có bộ nhớ riêng, khác Safari, nên tủ đồ ở 2 nơi không tự chung; dùng Xuất / Nhập để chuyển.

## Thêm vào màn hình chính (PWA)
- iPhone: mở link app bằng Safari → nút Chia sẻ (ô vuông có mũi tên lên) → "Thêm vào MH chính" → Thêm.
- Android (Chrome): mở link app → menu ⋮ → "Thêm vào màn hình chính" (hoặc "Cài đặt ứng dụng").
- Sau khi đã mở app một lần có mạng, lúc mất mạng vẫn mở được giao diện (tủ đồ, hồ sơ dị ứng chạy từ bộ nhớ máy); tra cứu sản phẩm vẫn cần mạng.
- Khi có bản mới, đầu trang hiện "Đã có bản mới." kèm nút "Tải lại" (app không tự tải lại để không mất chữ đang gõ).
- Icon do `tools/make-icons.mjs` tự vẽ; đổi hình thì chạy lại: `node tools/make-icons.mjs` (ra 4 file PNG trong `public/icons/`).
- Service worker (`sw.js`) sinh lúc `npm run build`, không sửa tay trong `dist/`. Hỏng thì xem cách gỡ ở `PLAN.md` mục 7.

## Test
```
npm test
```
Chạy test node của app trong `tests/` (dùng `node:test` có sẵn, không cần cài thêm gì; cần Node 21 trở lên vì lệnh dùng mẫu `tests/*.test.js`).

## Build để đưa lên mạng
```
npm run build
```
Thư mục `dist/` kéo thả vào https://app.netlify.com/drop là có link HTTPS (cách thay thế, không cần GitHub).

## Đưa lên GitHub Pages
- Repo trên GitHub phải để công khai (public).
- Vào Settings → Pages → Source chọn **GitHub Actions**, làm việc này TRƯỚC khi push nhánh `main` có file `.github/workflows/deploy.yml`.
- Push nhánh `main` lên đầu tiên (để `main` là nhánh mặc định), rồi mới push nhánh khác.
- Nếu lần chạy đầu báo đỏ vì chưa bật Pages: bật xong vào tab Actions bấm Re-run.
- Từ đó mỗi lần lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions tự build + deploy: workflow chạy `npm ci` + `npm run build` rồi đưa `dist/` lên Pages; xem tiến độ ở tab Actions.
- Link app có dạng https://khangnguyen196.github.io/quet-ma-vach-full/

Kế hoạch chi tiết: xem `PLAN.md`.
