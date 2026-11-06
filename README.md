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
