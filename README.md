# Quét mã vạch đồ ăn

Quét mã vạch trên bao bì → xem dinh dưỡng, thành phần, dị ứng (dữ liệu Open Food Facts).

## Dùng app
Mở https://khangnguyen196.github.io/quet-ma-vach-full/ bằng Safari (iPhone) hoặc Chrome (Android, máy tính). Không nên mở trong trình duyệt của Zalo / Messenger.

- **Quét mã** (3 cách): "Bật camera" rồi đưa mã vạch vào khung; "Chụp ảnh mã" (giữ máy cách mã 15–20 cm, để mã nằm ngang và chiếm khoảng nửa khung, tránh lóa đèn); hoặc gõ số mã vạch rồi bấm "Tra cứu".
- **Hồ sơ dị ứng**: ở màn Tra cứu, mở khung "Hồ sơ dị ứng" và tick các nhóm bạn bị dị ứng (lưu ngay trên máy). Khi tra, khung đỏ là Open Food Facts ghi sản phẩm có nhóm đó, khung vàng là "có thể lẫn vết". App không bao giờ báo sản phẩm "an toàn": dữ liệu có thể thiếu hoặc sai, **luôn đọc nhãn trên bao bì**.
- **Tủ đồ**: sau khi tra, bấm "Thêm vào tủ đồ", chọn hạn sử dụng và số lượng. Màn "Tủ đồ" xếp theo hạn: màu đỏ là đã hết hạn, màu vàng là còn 7 ngày trở xuống (kể cả hạn cuối là hôm nay). Sửa / xóa ngay trong danh sách.
- **So sánh 2 sản phẩm**: bấm "So sánh" ở đầu trang (hoặc "So sánh với sản phẩm khác" dưới kết quả tra), nhập 2 mã hoặc chọn từ "đã quét gần đây". App hiện năng lượng, đường, muối, chất béo, chất béo bão hòa, đạm trên 100 g / 100 ml và cảnh báo dị ứng cho mỗi sản phẩm (app không tự tính).
- **Cài lên màn hình chính**: iPhone: Safari → nút Chia sẻ → "Thêm vào MH chính". Android (Chrome): menu ⋮ → "Thêm vào màn hình chính" (hoặc "Cài đặt ứng dụng"). Đã mở app một lần có mạng thì lúc mất mạng vẫn mở được giao diện (tủ đồ, hồ sơ dị ứng); tra sản phẩm vẫn cần mạng. Có bản mới thì đầu trang hiện "Đã có bản mới." kèm nút "Tải lại".
- **Chuyển tủ đồ sang máy khác**: trong màn "Tủ đồ", "Xuất tủ đồ" tải về file `tu-do-YYYY-MM-DD.json` (tủ đồ + hồ sơ dị ứng); sang máy kia bấm "Nhập tủ đồ", chọn file, rồi chọn "Gộp vào tủ hiện tại" hoặc "Thay toàn bộ" (tủ cũ được chép bản dự phòng trên máy). Dữ liệu chỉ nằm trên máy và trong file, không gửi đi đâu. Trên iPhone, app mở từ màn hình chính giữ dữ liệu riêng với Safari: dùng Xuất / Nhập để chuyển giữa 2 nơi.
- **Dữ liệu sản phẩm** lấy từ Open Food Facts (cộng đồng đóng góp, có thể thiếu hoặc sai; trường trống ghi "chưa có dữ liệu", app không đoán). Mã chưa có thì bấm "Góp sản phẩm này lên Open Food Facts" (cần tài khoản Open Food Facts; trang đó không điền sẵn mã, bấm "Chép mã" để dán vào).

## Chạy thử
Cần Node.js bản 20.19 trở lên trong dòng 20, hoặc bản 22.12 trở lên. Node 21 và 22.0 đến 22.11 không chạy được (Vite 7 đòi vậy). Dễ nhất: cài bản LTS mới nhất từ https://nodejs.org. Kiểm tra bằng lệnh: `node -v`
```
npm install
cp .env.example .env
npm run dev
```
Máy tính: mở `https://localhost:5173`. Điện thoại cùng Wi-Fi: mở địa chỉ `https://192.168.x.x:5173` mà terminal in ra, chấp nhận chứng chỉ tự ký.

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
- Service worker (`sw.js`) sinh lúc `npm run build`, không sửa tay trong `dist/`. Hỏng thì xem cách gỡ ở `PLAN.md` mục 7.
- Icon do `tools/make-icons.mjs` tự vẽ; đổi hình thì chạy lại: `node tools/make-icons.mjs` (ra 4 file PNG trong `public/icons/`).

## Đưa lên GitHub Pages
- Repo trên GitHub phải để công khai (public).
- Vào Settings → Pages → Source chọn **GitHub Actions**, làm việc này TRƯỚC khi push nhánh `main` có file `.github/workflows/deploy.yml`.
- Push nhánh `main` lên đầu tiên (để `main` là nhánh mặc định), rồi mới push nhánh khác.
- Nếu lần chạy đầu báo đỏ vì chưa bật Pages: bật xong vào tab Actions bấm Re-run.
- Từ đó mỗi lần lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions tự build + deploy: workflow chạy `npm ci` + `npm run build` rồi đưa `dist/` lên Pages; xem tiến độ ở tab Actions.
- Link app có dạng https://khangnguyen196.github.io/quet-ma-vach-full/

Kế hoạch chi tiết: xem `PLAN.md`.
