# Quét mã vạch đồ ăn

Quét mã vạch trên bao bì → xem dinh dưỡng, thành phần, dị ứng (dữ liệu Open Food Facts).

## Chạy thử
```
npm install
cp .env.example .env
npm run dev
```
Máy tính: mở `https://localhost:5173`. Điện thoại cùng Wi-Fi: mở địa chỉ `https://192.168.x.x:5173` mà terminal in ra, chấp nhận chứng chỉ tự ký.

## Build để đưa lên mạng
```
npm run build
```
Thư mục `dist/` kéo thả vào https://app.netlify.com/drop là có link HTTPS.

Kế hoạch chi tiết: xem `PLAN.md`.
