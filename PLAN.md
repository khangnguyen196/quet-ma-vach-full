# Kế hoạch: App quét mã vạch đồ ăn

Quét mã vạch trên gói mì, chai nước, hộp bánh… → hiện thành phần, dinh dưỡng, chất gây dị ứng, xuất xứ, bảo quản. Người dùng nhập hạn sử dụng để app nhắc đồ sắp hết hạn.

## 1. Mục tiêu

- Chạy được trên điện thoại qua trình duyệt (không cần cài app).
- Dữ liệu sản phẩm lấy từ Open Food Facts (miễn phí, không cần key).
- Hoàn thành từng giai đoạn, mỗi giai đoạn xong là có bản dùng được.

## 2. Tính năng theo giai đoạn

### Giai đoạn 1 – Tra cứu (đã có demo, chuyển vào code dự án)
- [x] Quét mã bằng camera (html5-qrcode)
- [x] Chụp ảnh mã vạch rồi đọc (dự phòng khi camera không mở được)
- [x] Nhập số mã vạch bằng tay
- [x] Gọi Open Food Facts, hiện: tên, thương hiệu, khối lượng, ảnh, Nutri-Score, NOVA, bảng dinh dưỡng/100 g, thành phần, dị ứng, phụ gia
- [x] Trạng thái: đang tra, không tìm thấy, lỗi mạng
- [x] Lịch sử quét (localStorage, 10 mã gần nhất)

> Ghi chú: các mục trên tick theo code (đợt khoi-dong). Camera và chụp ảnh chưa thử trên điện thoại thật (xem mục 6 bước 4). 11/2026: iPhone báo không đọc được mã cả khi chụp gần; app thu nhỏ ảnh về 1600/1000 px và thử xoay 90° trước khi đọc; chờ thử lại trên iPhone, nút Bật camera chưa thử trên iPhone.

### Giai đoạn 2 – Thông tin thêm + Tủ đồ ăn
- [ ] Hiện xuất xứ nguyên liệu, nơi sản xuất, nước bán, bảo quản, cách dùng, nhãn chứng nhận (halal, organic…) – trường nào trống thì ẩn
- [ ] Nút "Thêm vào tủ đồ" sau khi tra: nhập hạn sử dụng (ô chọn ngày) + số lượng
- [ ] Trang "Tủ đồ": danh sách sản phẩm, sắp theo ngày hết hạn, tô màu: còn > 7 ngày (bình thường), ≤ 7 ngày (vàng), đã hết hạn (đỏ)
- [ ] Xóa / sửa món trong tủ
- [ ] Lưu bằng localStorage (chưa cần tài khoản)

### Giai đoạn 3 – Thông minh hơn
- [ ] Đọc hạn sử dụng từ ảnh bằng OCR (tesseract.js), người dùng xác nhận lại
- [ ] Hồ sơ dị ứng cá nhân (chọn: sữa, đậu nành, gluten…) → cảnh báo đỏ ngay khi quét trúng
- [ ] So sánh 2 sản phẩm cạnh nhau (calo, đường, muối)
- [ ] PWA: cài lên màn hình chính, có icon, mở nhanh

### Giai đoạn 4 – Nếu còn thời gian
- [ ] Backend nhỏ (Node + Express + SQLite) để đăng nhập và đồng bộ tủ đồ giữa các máy
- [ ] Đóng góp ngược lên Open Food Facts khi mã chưa có (mở link thêm sản phẩm)

## 3. Công nghệ

| Phần | Chọn | Lý do |
|---|---|---|
| Giao diện | HTML + CSS + JavaScript thuần, bundler Vite | Đơn giản, không phải học framework, build ra 1 thư mục tĩnh |
| Quét mã | `html5-qrcode` | Chạy trên trình duyệt, hỗ trợ EAN-13 (mã hàng hóa), có hàm đọc từ ảnh |
| Dữ liệu | Open Food Facts API v2 | Miễn phí, có CORS, có hàng Việt Nam phổ biến |
| OCR (giai đoạn 3) | `tesseract.js` | Chạy trên trình duyệt, không cần server |
| Lưu trữ | localStorage → sau này SQLite | Bắt đầu nhanh, nâng cấp sau |
| Deploy | GitHub Pages hoặc Netlify | Miễn phí, có HTTPS (camera bắt buộc HTTPS) |

## 4. Cấu trúc thư mục

```
quet-ma-vach/
├── index.html          # trang chính
├── src/
│   ├── main.js         # nối các phần lại, xử lý sự kiện
│   ├── scanner.js      # bật/tắt camera, đọc mã từ ảnh
│   ├── off.js          # gọi Open Food Facts, đổi dữ liệu sang tiếng Việt
│   ├── render.js       # tạo HTML kết quả
│   ├── storage.js      # lịch sử + tủ đồ (localStorage)
│   └── style.css
├── public/             # icon, manifest (giai đoạn 3)
├── .env.example        # mẫu biến môi trường (copy thành .env)
├── vite.config.js
├── package.json
├── CLAUDE.md           # hướng dẫn cho Claude Code
└── PLAN.md             # file này
```

## 5. API Open Food Facts

Tra 1 sản phẩm theo mã vạch:

```
GET https://world.openfoodfacts.org/api/v2/product/{MÃ}.json?fields=product_name,brands,...
```

- Tìm thấy: `{ "status": 1, "product": { ... } }`
- Không có: `{ "status": 0 }` (HTTP 404, hoặc HTTP 200 với mã như `0000000000000`)

Trường hay dùng và ý nghĩa:

| Trường | Ý nghĩa |
|---|---|
| `product_name`, `product_name_vi` | tên (ưu tiên bản tiếng Việt nếu có) |
| `brands`, `quantity`, `categories` | thương hiệu, khối lượng, phân loại |
| `image_front_url` | ảnh mặt trước |
| `nutriscore_grade` | a–e, hoặc `unknown` |
| `nova_group` | 1–4, 4 = siêu chế biến |
| `ecoscore_grade` | Green-Score a–e |
| `ingredients_text`, `ingredients_text_vi` | thành phần |
| `allergens_tags`, `traces_tags` | dị ứng, có thể lẫn vết (dạng `en:gluten`) |
| `additives_tags` | phụ gia (dạng `en:e621`) |
| `nutriments` | `energy-kcal_100g`, `fat_100g`, `saturated-fat_100g`, `carbohydrates_100g`, `sugars_100g`, `fiber_100g`, `proteins_100g`, `salt_100g` |
| `origins` | xuất xứ nguyên liệu |
| `manufacturing_places` | nơi sản xuất |
| `countries` | nước bán |
| `conservation_conditions` | điều kiện bảo quản |
| `preparation` | cách dùng / chế biến |
| `labels` | nhãn: halal, organic, no GMO… |
| `packaging` | bao bì |

Mã mẫu để test: `8934563163150` (mì chay Hảo Hảo, có đủ dinh dưỡng), `8934563651138` (Hao Hao, thiếu dữ liệu: không có bảng dinh dưỡng, không có thành phần – kiểm 11/2026), dự phòng `8934637212531` (Cholimex Tomato Sauce, cũng thiếu như vậy – kiểm 11/2026). Mã cũ `8934563612146` (Handy Hảo Hảo) nay đã đủ dữ liệu trên Open Food Facts, không dùng để test "thiếu dữ liệu" nữa.

Lưu ý: **hạn sử dụng không có trong API** (mã vạch giống nhau cho mọi gói). Người dùng tự nhập hoặc OCR từ ảnh.

## 6. Bắt đầu – làm theo thứ tự

1. Cài Node.js (bản LTS) nếu chưa có: https://nodejs.org (cần 20.19+ trong dòng 20, hoặc 22.12+; xem README)
2. Mở terminal trong thư mục `quet-ma-vach`, chạy:
   ```
   npm install
   cp .env.example .env
   npm run dev
   ```
3. Terminal hiện 2 địa chỉ. Trên máy tính mở `https://localhost:5173`. Trên điện thoại (cùng Wi-Fi) mở địa chỉ `https://192.168.x.x:5173`, trình duyệt báo chứng chỉ không tin cậy → bấm "Nâng cao" → "Tiếp tục" (chỉ khi dev).
4. Bấm "Bật camera", quét thử gói mì. Nếu ra kết quả là giai đoạn 1 xong phần khung.
5. Tạo repo GitHub, commit lần đầu. Mỗi tính năng làm xong thì tick vào checklist ở mục 2 và commit.
6. Khi muốn cho người khác dùng: đưa lên GitHub Pages theo mục "Đưa lên GitHub Pages" trong README (push `main` là tự build và deploy), hoặc `npm run build` rồi kéo thả thư mục `dist/` vào Netlify Drop.

## 7. Vấn đề đã biết

- Camera chỉ mở được trên HTTPS hoặc localhost → dev dùng `@vitejs/plugin-basic-ssl`, deploy dùng Netlify/GitHub Pages.
- iPhone: Safari chỉ cho mở camera sau khi người dùng bấm nút (không tự bật khi vào trang).
- Hàng Việt trên Open Food Facts nhiều mã có nhưng thiếu dinh dưỡng, thiếu bảo quản → luôn có trạng thái "chưa có dữ liệu" và cho nhập tay.
- Open Food Facts yêu cầu app tử tế: không gọi liên tục, cache kết quả đã tra trong localStorage.
- Trang demo chạy bên trong Claude bị chặn gọi internet; dự án thật chạy bằng Vite thì gọi API bình thường.
- Thương hiệu, khối lượng, phân loại, ảnh đang bị ẩn khi API trống, chưa hiện "chưa có dữ liệu" như quy tắc CLAUDE.md (sửa ở giai đoạn sau).
- Đã xử lý: app tách loại lỗi khi tra cứu. HTTP 404 (hoặc `status` khác 1) → "không tìm thấy"; 5xx/429 → "Open Food Facts đang lỗi hoặc quá tải (HTTP …)"; HTTP 200 mà JSON hỏng → cùng câu đó nhưng không kèm mã HTTP; quá 9 giây → "phản hồi chậm"; fetch bị từ chối → "Không kết nối được tới Open Food Facts", gợi ý "Kiểm tra mạng, hoặc Open Food Facts đang quá tải" (Safari không phân biệt được mất mạng với trang lỗi 503 thiếu CORS); lỗi dữ liệu khi hiển thị → "Không hiển thị được dữ liệu"; lỗi khác không rõ loại (ví dụ lỗi lập trình) → "Có lỗi bất thường khi tra cứu", nhờ chụp lại dòng chữ nhỏ. Dưới câu báo có dòng nhỏ `tên lỗi: nội dung lỗi`, và lỗi luôn được ghi ra console. Lưu ý: mã `0000000000000` được trả HTTP 200 kèm `{status: 0}`, không phải 404.
- iPhone Safari báo "Không kết nối được" với 8934563163150 dù mở thẳng URL API ra JSON: chưa tìm ra nguyên nhân chắc chắn. Đã đo trên máy tính: URL app gọi trả 200 trong 0,7–0,9 giây, có header CORS; dữ liệu đúng kiểu. Giả thuyết mạnh nhất: lúc đó Open Food Facts trả trang lỗi 503 không kèm header CORS (đã thấy với API search, 11/2026) → Safari chặn và ném `TypeError: Load failed`, app không biết là 503 nên báo mất mạng. Cần thử lại trên iPhone và đọc dòng lỗi nhỏ để chốt.
- Lịch sử chỉ lưu mã tìm thấy; mã không có trên Open Food Facts thì không vào lịch sử (hiện tại như vậy; chờ chủ dự án xác nhận có muốn lưu cả mã không tìm thấy không).
