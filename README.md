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

## Build để đưa lên mạng
```
npm run build
```
Thư mục `dist/` kéo thả vào https://app.netlify.com/drop là có link HTTPS.

Kế hoạch chi tiết: xem `PLAN.md`.
