# Kế hoạch: App quét mã vạch đồ ăn

Quét mã vạch trên gói mì, chai nước, hộp bánh… → hiện thành phần, dinh dưỡng, chất gây dị ứng, xuất xứ, bảo quản. Người dùng nhập hạn sử dụng để app nhắc đồ sắp hết hạn.

## 1. Mục tiêu

- Chạy được trên điện thoại qua trình duyệt (không cần cài app).
- Dữ liệu sản phẩm lấy từ Open Food Facts (miễn phí, không cần key).
- Hoàn thành từng giai đoạn, mỗi giai đoạn xong là có bản dùng được.

## 2. Tính năng theo giai đoạn

### Giai đoạn 1 – Tra cứu (xong 05/11/2026)
- [x] Quét mã bằng camera (html5-qrcode)
- [x] Chụp ảnh mã vạch rồi đọc (dự phòng khi camera không mở được)
- [x] Nhập số mã vạch bằng tay
- [x] Gọi Open Food Facts, hiện: tên, thương hiệu, khối lượng, ảnh, Nutri-Score, NOVA, bảng dinh dưỡng/100 g, thành phần, dị ứng, phụ gia
- [x] Trạng thái: đang tra, không tìm thấy, lỗi mạng
- [x] Lịch sử quét (localStorage, 10 mã gần nhất)

> Ghi chú: giai đoạn 1 xong 05/11/2026: trên iPhone Safari (link Pages) nhập mã, "Bật camera", "Chụp ảnh mã" đều đạt (chủ dự án xác nhận). Trước đó iPhone không đọc được mã khi chụp gần; app đã thu nhỏ ảnh về 1600/1000 px và thử xoay 90° trước khi đọc.

### Giai đoạn 2 – Thông tin thêm + Tủ đồ ăn (xong 05/11/2026)
- [x] Hiện xuất xứ nguyên liệu, nơi sản xuất, nước bán, bảo quản, cách dùng, nhãn chứng nhận (halal, organic…) – trường nào trống thì ẩn
- [x] Nút "Thêm vào tủ đồ" sau khi tra: nhập hạn sử dụng (ô chọn ngày) + số lượng
- [x] Trang "Tủ đồ": danh sách sản phẩm, sắp theo ngày hết hạn, tô màu: còn > 7 ngày (bình thường), ≤ 7 ngày (vàng), đã hết hạn (đỏ)
- [x] Xóa / sửa món trong tủ
- [x] Lưu bằng localStorage (chưa cần tài khoản)

> Ghi chú: giai đoạn 2 xong 05/11/2026: chủ dự án thử tủ đồ trên iPhone Safari (link Pages) đạt cả 12 bước. Bấm "Sửa" thì bảng chọn ngày tự bật, tạm chấp nhận (xem mục 7).

### Giai đoạn 3 – Thông minh hơn
- [ ] Đọc hạn sử dụng từ ảnh bằng OCR (tesseract.js), người dùng xác nhận lại (đã đo ở gd3-a: tesseract.js cách (b) 1/9, chưa đạt 5/9, xem mục 8 dòng hsd-do). **Tạm hoãn (06/11/2026):** không đo thêm, chưa làm hsd-app; gd3-a đọc thẳng 2/9, xử lý ảnh 1/9, dưới ngưỡng 5/9; chữ in chấm kim và chữ dọc không đọc được; người dùng nhập hạn bằng tay.
- [x] Hồ sơ dị ứng cá nhân (chọn: sữa, đậu nành, gluten…) → cảnh báo đỏ ngay khi quét trúng (06/11/2026, đợt gd3-a)
- [x] So sánh 2 sản phẩm cạnh nhau (calo, đường, muối) (06/11/2026, đợt hoan-thien): màn So sánh hiện 6 chỉ số trên 100 g / 100 ml (năng lượng, đường, muối, chất béo, chất béo bão hòa, đạm), ô trống ghi "chưa có dữ liệu", mỗi cột có cảnh báo dị ứng theo hồ sơ; dùng cache tra cứu, không gọi Open Food Facts dồn dập.
- [x] PWA: cài lên màn hình chính, có icon, mở nhanh (06/11/2026, đợt hoan-thien): manifest, icon tự vẽ (tools/make-icons.mjs), apple-touch-icon; service worker sinh lúc build chỉ giữ giao diện (mở nhanh, mở được khi mất mạng), không giữ dữ liệu Open Food Facts; có bản mới thì hiện thanh "Đã có bản mới. Tải lại".

### Giai đoạn 4 – Nếu còn thời gian
- [x] Xuất / nhập tủ đồ bằng file JSON (tủ đồ + hồ sơ dị ứng) để chuyển giữa các máy (06/11/2026, đợt hoan-thien). Chủ dự án chọn xuất / nhập file thay máy chủ (05/11/2026); máy chủ Node + Express + SQLite để sau nếu cần.
- [x] Đóng góp ngược lên Open Food Facts khi mã chưa có (mở link thêm sản phẩm) (06/11/2026, đợt hoan-thien): nút mở trang 'Add a product' chính thức, người dùng tự nhập mã.

## 3. Công nghệ

| Phần | Chọn | Lý do |
|---|---|---|
| Giao diện | HTML + CSS + JavaScript thuần, bundler Vite | Đơn giản, không phải học framework, build ra 1 thư mục tĩnh |
| Quét mã | `html5-qrcode` ("Bật camera") + `zxing-wasm` (chỉ cho "Chụp ảnh mã") | html5-qrcode chạy trên trình duyệt, hỗ trợ EAN-13 (mã hàng hóa); zxing-wasm (thêm 06/11/2026, chủ dự án đồng ý) đọc được ảnh bao bì thật nhăn / xoay dọc mà html5-qrcode trượt, wasm tự host, chỉ tải khi chọn ảnh, lỗi thì quay về html5-qrcode |
| Dữ liệu | Open Food Facts API v2 | Miễn phí, có CORS, có hàng Việt Nam phổ biến |
| OCR (giai đoạn 3) | `tesseract.js` | Chạy trên trình duyệt, không cần server |
| Lưu trữ | localStorage → sau này SQLite | Bắt đầu nhanh, nâng cấp sau |
| Deploy | GitHub Pages hoặc Netlify | Miễn phí, có HTTPS (camera bắt buộc HTTPS) |

## 4. Cấu trúc thư mục

```
quet-ma-vach-full/
├── index.html          # trang chính
├── src/
│   ├── main.js         # nối các phần lại, xử lý sự kiện
│   ├── scanner.js      # bật/tắt camera (html5-qrcode), đọc mã từ ảnh (zxing-wasm trước, html5-qrcode dự phòng)
│   ├── zxing-reader.js # bọc zxing-wasm, chỉ import động khi chọn ảnh; wasm lấy từ file của app (không CDN)
│   ├── barcode.js      # chọn mã từ kết quả zxing-wasm, ghép dòng lỗi "đã thử những gì" (không DOM)
│   ├── off.js          # gọi Open Food Facts, đổi dữ liệu sang tiếng Việt
│   ├── render.js       # tạo HTML kết quả
│   ├── storage.js      # lịch sử + tủ đồ (localStorage)
│   ├── pantry.js       # tủ đồ: số ngày còn hạn, trạng thái, sắp xếp, định dạng ngày; isValidItem / cleanItem / NAME_MAX
│   ├── compare.js      # so sánh 2 sản phẩm: 6 chỉ số trên 100 g / 100 ml (không DOM)
│   ├── backup.js       # xuất / nhập tủ đồ (file JSON): tạo file, kiểm định dạng, gộp
│   ├── pwa.js          # đăng ký service worker + thanh "Đã có bản mới"
│   └── style.css
├── tests/              # test node của app (node:test, không thư viện), chạy: npm test
├── test-ocr/           # so sánh OCR + cách tách thông tin (Python, xem test-ocr/README.md)
│   └── hsd-js/         # thí nghiệm đọc hạn sử dụng bằng tesseract.js (package.json riêng)
├── public/             # manifest.webmanifest + icons/ (PNG do tools/make-icons.mjs vẽ), chép nguyên vào dist/
├── tools/
│   ├── make-icons.mjs  # vẽ icon PWA, chạy một lần: node tools/make-icons.mjs
│   └── sw-build.mjs    # ghép mã sw.js; sw.js sinh lúc build bằng plugin trong vite.config.js (không sửa tay dist/)
├── .env.example        # mẫu biến môi trường (copy thành .env)
├── vite.config.js
├── package.json
├── CLAUDE.md           # hướng dẫn cho Claude Code
└── PLAN.md             # file này
```

## 5. API Open Food Facts

Tra 1 sản phẩm theo mã vạch:

```
GET https://world.openfoodfacts.org/api/v2/product/{MÃ}.json?fields=product_name,brands,...&app_name=quet-ma-vach-full&app_version=0.1.0
```

Định danh app bằng app_name / app_version trên URL (05/11/2026). Tài liệu chính thức (openfoodfacts.github.io/openfoodfacts-server/api/, mục Authentication) nêu 2 tham số này cho lệnh ghi; lệnh đọc dùng User-Agent mà trình duyệt không đặt được, nên app gửi bằng tham số URL (suy rộng), không thêm header.

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

Đã xong (repo + GitHub Pages), giữ để cài lại máy.

1. Cài Node.js (bản LTS) nếu chưa có: https://nodejs.org (cần 20.19+ trong dòng 20, hoặc 22.12+; xem README)
2. Mở terminal trong thư mục `quet-ma-vach-full`, chạy:
   ```
   npm install
   cp .env.example .env
   npm run dev
   ```
3. Terminal hiện 2 địa chỉ. Trên máy tính mở `https://localhost:5173`. Trên điện thoại (cùng Wi-Fi) mở địa chỉ `https://192.168.x.x:5173`, trình duyệt báo chứng chỉ không tin cậy → bấm "Nâng cao" → "Tiếp tục" (chỉ khi dev).
4. Bấm "Bật camera", quét thử gói mì. Nếu ra kết quả là giai đoạn 1 xong phần khung.
5. Tạo repo GitHub, commit lần đầu. Mỗi tính năng làm xong thì tick vào checklist ở mục 2 và commit.
6. Khi muốn cho người khác dùng: đưa lên GitHub Pages theo mục "Đưa lên GitHub Pages" trong README: lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions tự build + deploy. Cách khác: `npm run build` rồi kéo thả thư mục `dist/` vào Netlify Drop.

## 7. Vấn đề đã biết

- Camera chỉ mở được trên HTTPS hoặc localhost → dev dùng `@vitejs/plugin-basic-ssl`, deploy dùng Netlify/GitHub Pages.
- iPhone: Safari chỉ cho mở camera sau khi người dùng bấm nút (không tự bật khi vào trang).
- "Chụp ảnh mã" (sua-cuoi, 06/11/2026) đọc bằng zxing-wasm trước (đọc được bao bì thật nhăn / xoay dọc), không được thì thử tiếp html5-qrcode như cũ (4 lượt: 1600 / 1000 px, xoay 90°). zxing-wasm chỉ tải khi chọn ảnh; mất mạng hoặc không tải được file wasm thì vẫn đọc bằng html5-qrcode. Vẫn có lúc không đọc được ảnh mờ, chụp quá gần, lóa, hoặc khi mở trong trình duyệt của Zalo/Messenger (nên dùng Safari); khi đó app báo: "Không đọc được mã vạch trong ảnh. Giữ máy cách mã 15–20 cm (gần quá iPhone không lấy nét), để mã nằm ngang và chiếm khoảng nửa khung, tránh lóa đèn. Hoặc bấm “Bật camera”, hoặc nhập số bên dưới.", dòng chữ nhỏ ghi đã thử những gì (vd "zxing-wasm: không thấy mã; html5-qrcode: NotFoundException (đã thử 4 lần)").
- Hàng Việt trên Open Food Facts nhiều mã có nhưng thiếu dinh dưỡng, thiếu bảo quản → luôn có trạng thái "chưa có dữ liệu" và cho nhập tay.
- Open Food Facts yêu cầu app tử tế: không gọi liên tục. App cache kết quả đã tra trong bộ nhớ của trang (`src/off.js`, tối đa 30 mã, 10 phút; giữ cả "không tìm thấy", lỗi không giữ; 2 lượt cùng mã đang chạy dùng chung 1 lần gọi), không dùng localStorage để không giữ dữ liệu Open Food Facts lâu trên máy và không làm đầy bộ nhớ; tải lại trang là cache mất (hoan-thien, 06/11/2026).
- Trang demo chạy bên trong Claude bị chặn gọi internet; dự án thật chạy bằng Vite thì gọi API bình thường.
- Đã xử lý (gd2, 05/11/2026): thương hiệu, khối lượng, phân loại trống thì hiện "chưa có dữ liệu"; không có ảnh (hoặc ảnh tải lỗi) thì hiện ô "Chưa có ảnh". Khối "Xuất xứ và bảo quản" vẫn ẩn dòng trống (PLAN mục 2 yêu cầu), đây là ngoại lệ có chủ đích.
- Đã xử lý: app tách loại lỗi khi tra cứu. HTTP 404 (hoặc `status` khác 1) → "không tìm thấy"; 5xx/429 → "Open Food Facts đang lỗi hoặc quá tải (HTTP …)"; HTTP 200 mà JSON hỏng → cùng câu đó nhưng không kèm mã HTTP; quá 9 giây → "phản hồi chậm"; fetch bị từ chối → "Không kết nối được tới Open Food Facts", gợi ý "Kiểm tra mạng, hoặc Open Food Facts đang quá tải" (Safari không phân biệt được mất mạng với trang lỗi 503 thiếu CORS); lỗi dữ liệu khi hiển thị → "Không hiển thị được dữ liệu"; lỗi khác không rõ loại (ví dụ lỗi lập trình) → "Có lỗi bất thường khi tra cứu", nhờ chụp lại dòng chữ nhỏ. Dưới câu báo có dòng nhỏ `tên lỗi: nội dung lỗi`, và lỗi luôn được ghi ra console. Lưu ý: mã `0000000000000` được trả HTTP 200 kèm `{status: 0}`, không phải 404.
- iPhone Safari báo "Không kết nối được" với 8934563163150 dù mở thẳng URL API ra JSON: chưa tìm ra nguyên nhân chắc chắn. Đã đo trên máy tính: URL app gọi trả 200 trong 0,7–0,9 giây, có header CORS; dữ liệu đúng kiểu. Giả thuyết mạnh nhất: lúc đó Open Food Facts trả trang lỗi 503 không kèm header CORS (đã thấy với API search, 11/2026) → Safari chặn và ném `TypeError: Load failed`, app không biết là 503 nên báo mất mạng. Cần thử lại trên iPhone và đọc dòng lỗi nhỏ để chốt. 05/11/2026 không gặp lại (chủ dự án tra trên iPhone); vẫn chưa rõ nguyên nhân nên giữ mở.
- Đã xử lý (05/11/2026): app gửi app_name / app_version cho Open Food Facts; muốn bỏ thì xóa 2 tham số trong src/off.js.
- Lịch sử chỉ lưu mã tìm thấy; chốt: giữ như hiện tại (chủ dự án, 05/11/2026).
- Quyết định tủ đồ (gd2, 05/11/2026): (1) mã không tìm thấy vẫn thêm vào tủ được, tên bắt buộc nhập tay (lỗi mạng / máy chủ thì không có form thêm); (2) logic hạn sử dụng (số ngày còn lại, trạng thái, sắp xếp, định dạng ngày) nằm ở `src/pantry.js`, không đụng giao diện và localStorage; (3) còn 0 ngày tính là vàng (sắp hết hạn), chữ "Hạn cuối là hôm nay".
- Lỗi có từ trước: tắt camera trong khoảng 50 ms sau khi bật thì html5-qrcode ném 'play() request was interrupted' (scanner.js, chưa sửa).
- Đã xử lý (sua-nho, 06/11/2026): render.js không còn chép tay chuỗi 'Sản phẩm chưa có tên': `src/off.js` export hằng `NO_NAME`, `normalize()` và `render.js` dùng chung.
- Đã xử lý (sua-nho, 06/11/2026): bấm "Sửa" trong tủ đồ thì con trỏ vào ô số lượng (`input[name="qty"]`, chỉ focus, không chọn sẵn chữ) thay cho ô ngày, để iPhone không tự bật bảng chọn ngày (05/11/2026 tạm chấp nhận; cần thử lại trên iPhone).
- Đã xử lý (sua-nho, 06/11/2026, gợi ý reviewer gd2): ô chọn ngày ở form thêm và form sửa có `min="2000-01-01"` `max="2100-12-31"` lấy từ `YEAR_MIN` / `YEAR_MAX` của `src/pantry.js`; `storage.js` vẫn kiểm lại khi lưu như cũ.
- Đã xử lý (sua-nho, 06/11/2026, gợi ý reviewer gd2): sao lưu tủ đồ hỏng không ghi trùng: đã có bản giống hệt ở `qmv-pantry-backup` hoặc bất kỳ khóa `qmv-pantry-backup-…` nào thì không ghi; vẫn không bao giờ ghi đè backup cũ, lỗi ghi vẫn báo "Không lưu được tủ đồ".
- Cảnh báo dị ứng chỉ dựa trên tag 'en:' của Open Food Facts; dữ liệu có thể thiếu hoặc ghi khác tên, app không bao giờ ghi 'an toàn'.
- Máy chủ dự án: ổ C chỉ còn ít chỗ (05/11/2026 đo còn khoảng 4,6 GB; chủ dự án lưu ý ổ C ít chỗ), mọi thứ tải về để ở ổ D: Ollama `D:\ollama\app`, model `D:\ollama\models`, `HF_HOME` `D:\cache\hf`, `TEMP` / `TMP` `D:\tmp`, cache npm `D:\cache\npm`.
- Service worker (PWA, hoan-thien 06/11/2026): `dist/sw.js` sinh lúc build (`tools/sw-build.mjs` + plugin trong `vite.config.js`), chỉ giữ giao diện (cache tên `qmv-shell-<phiên bản>`), không bao giờ giữ request khác tên miền (Open Food Facts, ảnh sản phẩm, Google Fonts). Mở trang luôn hỏi mạng trước (bỏ qua bộ nhớ đệm HTTP), mất mạng mới dùng bản đã lưu; deploy bản mới thì tab đang mở hiện thanh "Đã có bản mới. Tải lại"; thanh chỉ hiện khi file JS / CSS của trang không còn trong cache bản mới (trang đã là bản mới thì không hiện).
- Service worker: cách gỡ nếu hỏng.
  (a) Người dùng: iPhone: Cài đặt → Safari → Nâng cao → Dữ liệu trang web → xóa `khangnguyen196.github.io` / `github.io`. **Cảnh báo: việc này xóa luôn tủ đồ và hồ sơ dị ứng, hãy bấm "Xuất tủ đồ" trước.** App đã thêm vào màn hình chính: xóa app khỏi màn hình chính rồi thêm lại. Chrome (máy tính / Android): DevTools → Application → Service workers → Unregister (hoặc mở `chrome://serviceworker-internals`).
  (b) Người làm app: deploy một `sw.js` "tự hủy" thay cho bản đang hỏng (sửa plugin trong `vite.config.js` để emit đoạn này), mọi máy tải bản mới sẽ tự gỡ:
  ```js
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      for (const name of await caches.keys()) if (name.startsWith("qmv-shell-")) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
    })());
  });
  ```
  Đồng thời sửa initPwa() trong src/pwa.js để không đăng ký sw.js nữa (hoặc gọi navigator.serviceWorker.getRegistrations() rồi unregister()); nếu không, mỗi lần mở app lại đăng ký rồi tự hủy.
  Lưu ý: trên iPhone, app mở từ màn hình chính có thể có bộ nhớ riêng, khác Safari, nên tủ đồ ở 2 nơi không tự chung; dùng "Xuất tủ đồ" / "Nhập tủ đồ" để chuyển.

## 8. Việc cần làm tiếp (cập nhật 06/11/2026)

Trạng thái: giai đoạn 1 đã lên https://khangnguyen196.github.io/quet-ma-vach-full/ (repo https://github.com/khangnguyen196/quet-ma-vach-full); giai đoạn 2 (xuất xứ / bảo quản, tủ đồ) lên main trong đợt `gd2` (05/11/2026) và đạt khi chủ dự án thử trên iPhone Safari (05/11/2026). Lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions tự build + deploy. Đợt `khoi-dong`, `sua-va-dua-len` và `chi-phi-1` (trần 60 lượt Google mỗi lần chạy, 800 lượt/tháng; app gửi app_name/app_version; main cb5f449) đã đóng. Quy tắc làm việc (toàn quyền, chỉ dùng mức miễn phí, không dùng API Claude/Anthropic) nằm trong `.claude/du-an.md`.

### Chủ dự án tự làm (máy không làm thay được)
- [x] Thử tủ đồ trên iPhone Safari ở link app: tra mã, thêm vào tủ (chọn hạn, số lượng), mở "Tủ đồ", sửa, xóa, tải lại trang vẫn còn; chạm đúp "Thêm vào tủ đồ" chỉ thêm 1 món; bấm "Sửa" xem bảng chọn ngày có tự bật không. (05/11/2026: đạt 12 bước; bấm Sửa thì bảng chọn ngày tự bật, tạm chấp nhận)
- [x] Trước đợt `anh-mang`: thêm vào `.claude/du-an.md` ngoại lệ cho Claude Code điền `test-ocr/truth.csv` một lần (hồ sơ đang cấm sửa truth.csv). (05/11/2026: chủ dự án đã thêm, du-an.md dòng 59)
- [x] Thử nút "Bật camera" trên iPhone ở link app. (05/11/2026: đạt, giai đoạn 1 xong)
- [x] Xác nhận lịch sử chỉ lưu mã tìm thấy, xem mục 7. (05/11/2026: giữ như hiện tại)
- [x] Cài Tesseract kèm tiếng Việt (05/11/2026: chủ dự án đã chép `vie.traineddata`, `--list-langs` ra `eng`, `osd`, `vie`; đợt `ocr-a` chạy Tesseract `vie+eng` đủ 96 ảnh): `winget install --id UB-Mannheim.TesseractOCR -e --interactive` (giữ lệnh để cài lại máy), ở bước chọn thành phần tick Vietnamese trong "Additional language data". Kiểm (gõ trong PowerShell): `& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs` (phải có `eng` và `vie`). Gõ `tesseract --list-langs` (không kèm đường dẫn) mà báo không tìm thấy thì bỏ dấu `#` ở dòng `TESSERACT_CMD` trong `test-ocr\.env`. (05/11/2026: Tesseract v5.4.0 đã cài, dòng `TESSERACT_CMD` đã bật, nhưng bộ cài **chưa có `vie`**: `--list-langs` chỉ ra `eng`, `osd`. Đợt `anh-mang` đã tải `vie.traineddata` từ https://github.com/tesseract-ocr/tessdata vào `C:\Users\LTC\tessdata` (kèm `eng`, `osd`), chạy thử `--tessdata-dir C:\Users\LTC\tessdata -l vie` ra chữ tiếng Việt; chép vào `C:\Program Files\Tesseract-OCR\tessdata` bị từ chối vì cần quyền quản trị. **Chủ dự án bổ sung (đã làm):** mở PowerShell bằng "Run as administrator", gõ `Copy-Item "C:\Users\LTC\tessdata\vie.traineddata" "C:\Program Files\Tesseract-OCR\tessdata\"`, rồi kiểm lại `--list-langs` phải có `vie`. Không đặt `TESSDATA_PREFIX`.)
- [x] (Tùy chọn) Lấy key Azure gói F0 (hết lượt chỉ báo lỗi, không trừ tiền) hoặc Google Vision khi tài khoản chưa nâng cấp trả phí, tự điền `test-ocr/.env`. Không key vẫn chạy so sánh được với công cụ miễn phí. (05/11/2026, đợt `ocr-a`: `run_ocr.py` báo thiếu key cả Google lẫn Azure, nên 2 dịch vụ này chưa được so; có key thì chạy `python run_ocr.py --tools google,azure` rồi `python score.py`, ảnh Tesseract / EasyOCR đã có kết quả sẽ không chạy lại.) (05/11/2026: chủ dự án chốt không lấy key Google/Azure (app là trang tĩnh công khai, key để trong app sẽ lộ), bỏ việc này)
- [x] Kiểm Claude Code đăng nhập bằng gói Claude (Pro/Max) hay API key (`/status`); API key nghĩa là đang tốn tiền. (05/11/2026: gói Team, không phải API key)
- [x] Thử toàn bộ app trên iPhone sau đợt hoan-thien (06/11/2026): 10 bước chỉ điện thoại làm được, đạt 9/10; trượt "Chụp ảnh mã" với bao bì thật (NotFoundException sau 4 lần thử). Sửa trong đợt `sua-cuoi`.

### Claude Code làm (mỗi việc một đợt `/dot`, theo thứ tự A → E, rồi các đợt mới: sua-nho → hsd-do + di-ung (gộp trong đợt gd3-a) → hoan-thien (so-sanh + pwa + gd4 phần không máy chủ) → chủ dự án thử iPhone toàn bộ app → sua-cuoi; hsd-app tạm hoãn)
- [x] **A. Đợt `plan-sua`** (05/11/2026): sửa chữ PLAN.md, CLAUDE.md, README.md (diễn đạt "lên main" theo chế độ C, cập nhật theo chủ dự án), lên main.
- [x] **B. Đợt `anh-mang`** (05/11/2026: 30 sản phẩm × 3 ảnh front / ingredients / nutrition + 6 ảnh hạn sử dụng `date.jpg`, tất cả từ Open Food Facts, không cần Wikimedia Commons; `truth.csv` 31 dòng (30 sản phẩm + 1 dòng chỉ có `code` + `han_su_dung`); bỏ dòng mẫu 8934563163150 vì ảnh thành phần là nhãn xuất khẩu tiếng Pháp, bảng dinh dưỡng bị cắt ở mép, ảnh 'nutrition' thật ra là mặt trước. Cách đặt ảnh HSD đã chốt: có mã thì `photos/<mã>/date.jpg`, mã ngoài 30 món thì thêm dòng `truth.csv` chỉ có `code` + `han_su_dung`, không rõ mã thì `photos/hsd-NN/date.jpg`): lấy ảnh giấy phép mở từ Open Food Facts (ảnh hạn sử dụng thêm từ Wikimedia Commons) vào `test-ocr/photos/<mã vạch>/`; Claude Code điền `test-ocr/truth.csv` (chủ dự án cho phép 1 lần, cần ngoại lệ trong hồ sơ trước) và bổ sung `test-ocr/dict/brands.txt`; cập nhật `test-ocr/README.md` theo cách lấy ảnh mới (README đó còn ghi "chụp 30 sản phẩm", "Mình đã chụp ảnh…"). Ảnh hạn sử dụng từ Wikimedia Commons thường không phải đúng sản phẩm có mã vạch đó, nên cách đặt vào `photos/<mã>/` cho khớp `truth.csv` sẽ chốt trong đợt này. Cảnh báo: repo công khai; `test-ocr/photos/` đã có trong `test-ocr/.gitignore`; không bao giờ `git add -f` ảnh.
- [x] **C. Đợt `gd2`** (05/11/2026, lên main và test Pages trong cùng đợt): giai đoạn 2 ở mục 2 (xuất xứ/bảo quản, tủ đồ ăn, hạn sử dụng). Sửa luôn vấn đề ở mục 7: thương hiệu, khối lượng, phân loại, ảnh phải hiện "chưa có dữ liệu" khi trống. Thêm comment ở `src/off.js`: APP_NAME là tên repo, không phải tên trong package.json. Lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions tự build + deploy; chờ deploy xong, test trên link Pages bằng Chromium + WebKit, báo cáo kèm danh sách chủ dự án thử trên iPhone.
- [x] **D. Đợt `ocr-a`** (05/11/2026). Kết quả trên 96 ảnh / 31 mã (`outputs/summary.md`, không commit): **EasyOCR 45% đầy đủ** (108/239 điểm, 13,7 giây/ảnh trên CPU), **Tesseract 20%** (47/239 điểm, 1,3 giây/ảnh); 0 ảnh lỗi, 0 ảnh bỏ qua. **Google và Azure bị bỏ qua: `test-ocr/.env` chưa có key** (script báo "thiếu key"), nên lượt gọi tháng 2026-11: Google 0 / 800, Azure 0 / 4.000; lần chạy Google thứ 2 không chạy. EasyOCR 1.7.2 + torch 2.15.0 bản CPU: `.venv` tăng từ 260 MB lên 1.209 MB, model EasyOCR tải lần đầu 94 MB (`C:\Users\LTC\.EasyOCR`). Trường yếu nhất: `ten` (EasyOCR 14%, Tesseract 0%), `han_su_dung` (11% cả hai, chỉ 9 ô), `nha_san_xuat` (8% / 17%, 12 ô); `bao_quan` chỉ 12 ô. Điểm số còn "ăn may": 23 ô số có giá trị 1 chữ số (vd 0, 2), EasyOCR được 17, Tesseract 14. Đã sửa: `score.py` chỉ tính dòng cuối mỗi ảnh trong `times.csv`, bỏ thư mục `outputs/extract`, thêm cột "Ảnh bỏ qua (luật chi phí)"; `found()` bỏ `or "0"` thừa; summary hiện cả công cụ chỉ có dòng trong `times.csv` (vd Google bị bỏ qua hết theo luật chi phí, chưa có thư mục `outputs/google`); `run_ocr.py` / `score.py` in tiếng Việt được khi ghi ra file (`score.py > file`); `save_usage()` xóa `api_usage.json.tmp` khi ghi lỗi; siết test_7, đổi tên class test thành `PaidServiceUsageTest`. Quyết định của dieu-phoi (05/11/2026): (1) chấm bằng `score.py` của worktree, chạy ở thư mục chính (ảnh, `.env`, `outputs` chỉ có ở đó); (2) không siết cách chấm "ăn may", không bỏ 4 ảnh trùng, để đợt sau; (3) Google chạy tối đa 2 lần (≤ 60 + ≤ 36 lượt), tổng tháng ≤ 96. Quyết định của dieu-phoi (05/11/2026, vòng 2): (4) sửa lỗi in tiếng Việt khi ghi ra file ở `run_ocr.py` và `score.py` ngay trong `ocr-a`, `run_extract.py` / `score_combo.py` để `ocr-b`; (5) công cụ chỉ có dòng trong `times.csv` (bị bỏ qua hết) vẫn hiện trong `summary.md` với điểm 0. Việc gốc: xem lịch sử git của PLAN.md. Ghi chú chấm điểm (05/11/2026): (1) `found()` trong `score.py` đã sửa trong đợt `anh-mang` (dieu-phoi quyết định sửa ngay thay vì chỉ ghi chú, vì lỗi làm ô HSD 19.09.20 của bộ dữ liệu mới luôn 0 điểm): ngày có dấu chấm tận cùng 0 (vd 19.09.20) không còn bị cắt thành 19.09.2; giá trị bắt đầu bằng dấu chấm (vd `.0`, `.00`) không còn thành mẫu rỗng khớp mọi text (`0.0` vốn đã chấm như số 0, có test giữ). (2) Chấm số còn dễ được điểm "ăn may": "0", "2" khớp mọi số đứng riêng; "7.0" khớp cả "7.5" (sau số được phép ".5"). Để đợt sau (quyết định (2) ở trên). (3) 4 mã có `ingredients.jpg` trùng `nutrition.jpg` (8934588022111, 8935049501503, 8936028641487, 8936036029819): `run_ocr.py` đọc 2 lần; có thể bỏ trùng để tiết kiệm lượt. (4) Bộ có 96 ảnh, trần Google 60 lượt mỗi lần chạy → một lần chạy Google không đọc hết; phần dư ghi "bỏ qua theo luật chi phí" hoặc chia nhiều lần, tổng tháng ≤ 800. (5) Tên ghép nhiều khối chữ (vd "Mì khoai tây Omachi xốt Bò hầm") có thể khó đạt ngưỡng khớp 85 → đọc điểm cột `ten` có lưu ý.
- [x] **E. Đợt `ocr-b`** (05/11/2026, vòng 1–3; vòng 3 chỉ sửa chữ + thêm test). Kết quả `outputs/summary_combo.md` (không commit), 31 mã, 239 điểm, % thông tin rút ra đúng, sau khi sửa luật regex (vòng 2):

  | OCR \ extractor | dict | llm | regex | underthesea | yake |
  |---|---|---|---|---|---|
  | easyocr | 22% | **37%** | 30% | 30% | 26% |
  | tesseract | 12% | 13% | 12% | 11% | 15% |

  **Tổ hợp tốt nhất: EasyOCR + `llm` 37%**; nhanh và miễn phí nhất: EasyOCR + `regex` 30%. Giây / sản phẩm: regex 0,00; dict 0,01; yake 0,04; underthesea 0,11; llm 128,9 (EasyOCR) / 85,3 (Tesseract), TB 107,1. Số giây llm trong `summary_combo.md` tính cả file lỗi; đợt này 62/62 file llm ok, 0 file lỗi. llm: Ollama 0.40.14 bản zip (SHA256 khớp) ở `D:\ollama\app`, model `qwen2.5:3b` (1.841 MB) ở `D:\ollama\models`, `OLLAMA_CONTEXT_LENGTH=8192` (không lần nào bị cắt, dài nhất 2.457 token), `OLLAMA_TIMEOUT=600`; Ollama đã tắt sau đợt. Vòng 2 chỉ chạy lại regex / dict / underthesea; kết quả llm và yake giữ nguyên từ vòng 1 (md5 124 file không đổi).

  % đúng theo trường (vòng 2; trong ngoặc là số ô có đáp án):

  | trường | easy+dict | easy+llm | easy+regex | easy+underthesea | easy+yake | tess+dict | tess+llm | tess+regex | tess+underthesea | tess+yake |
  |---|---|---|---|---|---|---|---|---|---|---|
  | ten (29) | 17 | 21 | 14 | 14 | 76 | 3 | 10 | 3 | 3 | 34 |
  | thuong_hieu (29) | 45 | 38 | 0 | 0 | 52 | 17 | 10 | 0 | 0 | 17 |
  | khoi_luong (18) | 17 | 22 | 22 | 22 | 0 | 11 | 17 | 17 | 17 | 0 |
  | thanh_phan_dau (28) | 55 | 52 | 39 | 39 | 52 | 36 | 32 | 20 | 20 | 49 |
  | nang_luong_kcal (26) | 27 | 77 | 88 | 88 | 0 | 4 | 12 | 12 | 12 | 0 |
  | dam_g (26) | 0 | 27 | 27 | 27 | 0 | 0 | 12 | 8 | 8 | 0 |
  | beo_g (24) | 0 | 33 | 29 | 29 | 0 | 4 | 8 | 17 | 17 | 0 |
  | carb_g (26) | 0 | 38 | 50 | 50 | 0 | 0 | 12 | 19 | 19 | 0 |
  | nha_san_xuat (12) | 0 | 42 | 0 | 0 | 33 | 33 | 17 | 17 | 8 | 50 |
  | bao_quan (12) | 67 | 25 | 8 | 8 | 50 | 42 | 8 | 17 | 17 | 8 |
  | han_su_dung (9) | 11 | 0 | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |

  `han_su_dung` yếu nhất: tốt nhất 11% (1/9 ô: EasyOCR đọc "071026" của 8934673300759, regex / dict / underthesea lấy được); Tesseract 0/9 ô với mọi extractor; llm 0/9 với cả hai OCR.

  3 mốc (% và điểm / 239): trước sửa luật → vòng 1 → vòng 2. Sửa và chấm trên cùng 31 mã nên số sau sửa hơi lạc quan.

  | tổ hợp | trước sửa luật | vòng 1 | vòng 2 |
  |---|---|---|---|
  | easyocr + regex | 16% (38) | 30% (72) | 30% (71) |
  | easyocr + underthesea | 16% (38) | 30% (72) | 30% (71) |
  | easyocr + dict | 22% (51,5) | 22% (52,5) | 22% (52,5) |
  | tesseract + regex | 7% (17,7) | 12% (28,7) | 12% (27,7) |
  | tesseract + underthesea | 7% (16,7) | 12% (27,7) | 11% (26,7) |
  | tesseract + dict | 12% (29) | 12% (29) | 12% (29) |
  | llm, yake (cả hai OCR) | 37% / 13%, 26% / 15% (không đổi qua 3 mốc) | 37% / 13%, 26% / 15% | như vòng 1 |

  Đếm từng ô (1.434 ô của regex / dict / underthesea × 2 OCR), trước sửa luật → vòng 2 (giá trị trước sửa luật lấy bằng code 9b931eb chạy lại trong bộ nhớ, khớp 1.434/1.434 ô với kết quả đã lưu): 1.282 ô không đổi; **rỗng → đúng 81**, **sai → đúng 6**; **rỗng → sai 63** (đạm 26, béo 22, carb 6, kcal 6, HSD 3: trước để trống, giờ ra số sai như "1449", "569", không mất điểm nhưng hiện sai thay vì "chưa có dữ liệu"); sai → sai khác giá trị 2 (khối lượng 8936036029819 "30g" thành "711l"); **đúng → sai 0, đúng → rỗng 0**. Vòng 1 → vòng 2: 9 ô đổi: đúng → rỗng 4 (`dam_g` của 8936025773181 × regex / underthesea × 2 OCR, do bỏ nhãn "dam (g)", đúng dự kiến); sai → rỗng 3 (HSD "848224" của 8936012061321, EasyOCR, không phải ngày hợp lệ); sai → sai 2 (`beo_g` 8938501141477 EasyOCR: "20" của "Calories from Fat" thành "00" của "Saturated Fat", đáp án 2,5). `khoi_luong` của 8936036027099 không giảm dù bỏ "g đọc thành 9": text ảnh khác của mã này có sẵn "108 g". Tesseract + underthesea 12% → 11%: mất 1 điểm dam_g (27,7 → 26,7), vừa qua ngưỡng làm tròn.

  Mất thông tin ở bước rút trích (ô OCR đã có thông tin theo `results.csv` phần A, nhưng extractor ra sai / rỗng), vòng 2, trong ngoặc là trước sửa luật:

  | tổ hợp | ô OCR có | rút đúng | mất | % mất |
  |---|---|---|---|---|
  | easyocr + llm | 102 | 63 | 37 | 36% |
  | easyocr + regex | 102 | 53 (30) | 49 (72) | 48% (71%) |
  | easyocr + underthesea | 102 | 53 (30) | 49 (72) | 48% (71%) |
  | easyocr + dict | 102 | 28 (27) | 69 (70) | 68% (69%) |
  | easyocr + yake | 102 | 17 | 81 | 79% |
  | tesseract + llm | 42 | 18 | 23 | 55% |
  | tesseract + regex | 42 | 20 (11) | 21 (30) | 50% (71%) |
  | tesseract + underthesea | 42 | 19 (10) | 22 (31) | 52% (74%) |
  | tesseract + dict | 42 | 12 | 29 | 69% |
  | tesseract + yake | 42 | 6 | 34 | 81% |

  "Rút đúng" + "mất" có thể nhỏ hơn "ô OCR có" vì ô được điểm lẻ (khớp một phần) không vào cột nào.

  Luật regex (trong `extract_regex`, `underthesea` dùng lại; mỗi luật có ở text OCR của ≥ 2 sản phẩm). Thứ tự chạy so với luật cũ: (1), (2), (4), (5) chỉ dùng khi luật cũ không ra gì; (3) bỏ mức tham chiếu 2000 kcal khỏi text trước khi chạy mọi luật năng lượng (cũ lẫn mới); (6) HSD 6 số được xét trước "ngày cuối cùng trong text" và áp cả cho `dict`; (7) số sau nhãn "khối lượng tịnh" được xét trước luật cũ (số + đơn vị đầu tiên ở 15 dòng đầu).
  (1) nhãn "năng lượng" đọc sai (`nang iuong`, `nang ivong`, `nang luqng`) và "calories" đọc sai (`galories`, `calorios`, `galones`), bỏ "calories from fat";
  (2) năng lượng: kcal đọc sai / mất / in trước số (`75,3kca]`, `(kcal) 72,4`, `calories-kcal: 150`);
  (3) bỏ mức tham chiếu "nhu cầu năng lượng 2000 kcal";
  (4) đạm / béo / carb: "g" đọc thành 9 / 4 / 2 hoặc mất: lấy số đầu tiên sau nhãn rõ ràng (chất đạm, protein, chất béo, lipid, carbohydrat, hydrat cacbon, glucid; nhãn béo "fat" bỏ "calories from fat": `(?<!from )fat`);
  (5) "g" dính sau số thập phân đọc thành "9" (`7,09` là 7,0 g); rủi ro: số thật 2 chữ số thập phân tận cùng 9 mà mất chữ g thì bị cắt (18,49 thành 18,4);
  (6) HSD in liền 6 số (ddmmyy) sau nhãn HSD / EXP, chỉ kiểm khoảng ngày 01–31, tháng 01–12 (không kiểm lịch: 30/02 vẫn nhận; năm không kiểm; chỉ xét chuỗi 6 số đầu tiên sau nhãn), ngoài khoảng thì bỏ;
  (7) số sau nhãn "khối lượng tịnh" (chịu `khol luong`, `khoi iuong`, `kho' luong`, `tjnh`).
  Đã bỏ ở vòng 2 vì chỉ thấy ở 1 sản phẩm: nhãn "dam (g)" (8936025773181) và "g đọc thành 9" sau khối lượng tịnh (8936036027099, "TỊNH: 108 9"). "(g) in trước số" không phải luật riêng: có sẵn nhờ "số đầu tiên sau nhãn" của (4).
  Không sửa `dict/*.txt`, `truth.csv`. Đã sửa thêm: `IMAGE_ORDER` thêm `ingredients`, `nutrition`; file kết quả lỗi được chạy lại; `OLLAMA_TIMEOUT` (mặc định 180, quá 86400 cũng về 180); model mặc định `qwen2.5:3b`; `run_extract.py` / `score_combo.py` in tiếng Việt được khi ghi ra file; `score.py` hiện "–" cho công cụ chưa có file .txt.
  Quyết định của dieu-phoi (05/11/2026, ocr-b vòng 0): (1) dùng qwen2.5:3b, không thử 7b: RAM 7,8 GB tổng, rảnh ~0,9 GB, không đạt điều kiện "RAM đủ"; (2) `run_extract.py` chạy lại file kết quả có `_status` lỗi, timeout Ollama đổi bằng `OLLAMA_TIMEOUT` (mặc định 180, chạy thật dùng 600); (3) chạy script bản worktree, cwd thư mục chính `test-ocr`, không sửa `dict/*.txt` trong đợt; (4) làm cả 6 gợi ý của reviewer ocr-a. Quyết định của người điều khiển (05/11/2026, vòng 1): thử 1 mã mất 301,5 giây (gồm nạp model lần đầu), sát mốc 300 giây, nên chạy llm cho EasyOCR trước; giây TB thật 128,9 ≤ 300 và ước tổng thời gian llm khoảng 2,3 giờ (ước tính lúc quyết định) ≤ trần 5 giờ, nên chạy thêm llm cho Tesseract; thực tế khoảng 1,8 giờ (EasyOCR 66,5 phút + Tesseract 44 phút).
  Quyết định của dieu-phoi (05/11/2026, ocr-b vòng 1, sau review): (5) bỏ nhãn 'dam (g)' và 'g đọc thành 9' của khối lượng vì chỉ thấy ở 1 sản phẩm (8936025773181, 8936036027099); (6) nhãn béo dự phòng bỏ 'calories from fat'; (7) HSD 6 số liền chỉ nhận ngày hợp lệ ddmmyy (chỉ kiểm khoảng); (8) không chạy lại llm (Ollama đã tắt, kết quả llm vòng 1 giữ nguyên, md5 không đổi).
  Quyết định của dieu-phoi (05/11/2026, ocr-b vòng 2, sau review): (9) vòng 3 chỉ sửa chữ + thêm ca test biên HSD, không chạy lại extractor (hành vi code không đổi, md5 summary_combo.md giữ nguyên); HSD 6 số giữ kiểm khoảng, kiểm lịch thật để đợt sau; (?<!from )fat nhiều dấu cách và finditer để đợt sau.
  Quyết định của chủ dự án (05/11/2026): không lấy key Google / Azure; tủ đồ đạt trên iPhone; ổ C ít chỗ, đồ tải về để ở ổ D.
  Việc để sau: llm trả `han_su_dung` bằng chữ chép từ câu lệnh gửi cho model ("như in", "tên hạn sử dụng") hoặc câu mô tả ("06 tháng kể từ ngày sản xuất", "hiện tại"); đợt sau sửa câu lệnh `LLM_PROMPT` (vd ví dụ ngày cụ thể, không có thì để trống) (còn mở). Nhãn béo "fat" (cả luật cũ lẫn dự phòng) còn bắt "Saturated Fat" / "Trans Fat" (đã xử lý ở `sua-nho`). Nguyên nhân của 63 ô rỗng → sai ở trên: "0 g" đọc thành "09" 6 ô (8935001214274); nhãn béo lấy "00" của "Saturated Fat" 2 ô (8938501141477); HSD "200223" 3 ô (8934673818391: ngày hợp lệ nhưng OCR đọc sai, đáp án 200923); 52 ô còn lại: luật dự phòng gặp số mất dấu phẩy + g đọc thành 9 (vd "569" là 5,6 g; "1199" là 11,9 g) hoặc lấy nhầm số khác sau nhãn ("288Akcal" mất phần lẻ); đợt sau bỏ giá trị đạm / béo / carb > 100 g (đã làm ở `sua-nho`; "09" không đổi thành 0 mà để trống). Luật (7) ra "711l" ở 8936036029819 (OCR đọc rác "TỊNH: 711l 60y") (còn mở). `(?<!from )fat` chỉ chịu đúng 1 dấu cách giữa "from" và "fat" (đã xử lý ở `sua-nho`: bỏ cụm "from fat" khỏi text trước khi chạy luật béo); `find_date` chỉ xét chuỗi 6 số đầu tiên sau nhãn, sai khoảng thì không thử chuỗi kế (dùng `finditer`) (còn mở); đổi kiểm khoảng sang kiểm lịch thật (`datetime`) (còn mở). Hai việc `finditer`, kiểm lịch chưa có ca nào trong dữ liệu (text OCR của 31 mã chỉ có 3 chuỗi 6 số sau HSD / EXP: "071026", "200223", "848224"), để đợt sau. Nhãn VI 'chất béo trans' (không có chữ fat) chưa được SAT_FAT bỏ; chưa thấy trong dữ liệu (còn mở). Bảng theo dòng mất số béo tổng, có 2 cột giá trị ('Chất béo/ Fat Chất béo bão hòa/ Saturated fat 2 g 4 g') ra 2 (có từ trước đợt; chữ giống hệt bảng cột nên luật không phân biệt được) (còn mở). Nhãn 'fat' của luật béo chặt (run_extract.py, dòng beo_g) không có ranh giới từ, khớp vào 'Fatty acids' (còn mở). Nhãn bão hòa / chuyển hóa có '(g)' / '(mg)' đứng sau ('Chất béo (g) Chất béo bão hòa (g) 3') không bỏ được số, regex ra số bão hòa (như trước đợt; 61 text thật chưa có; cách sửa gợi ý: cho UNIT_PAREN vào SAT_GAP như NEAR, thêm subTest, đo lại) (còn mở). Chữ rác OCR giữa nhãn bão hòa và số (vạch '|' đọc thành 'l' / 'i', vd 'Saturated Fat l 3g') làm SAT_GAP dừng, giữ số bão hòa (61 text thật chưa có) (còn mở). dict lấy số + g đầu tiên trên dòng có nhãn béo (number_on_line): bảng cột đầy đủ ('… Chất đạm … Chất béo … 5 g …') ra số chất đạm (có từ trước đợt; s1h N3 chỉ thử rx) (còn mở).
  Đề xuất cho app (giai đoạn 3), **là GIẢ THUYẾT, chưa được đo**: bằng chứng hiện có rất mỏng: Tesseract (gần nhất với `tesseract.js`) đọc HSD đúng 0/9 ô với mọi extractor; ô HSD đúng duy nhất là EasyOCR (8934673300759 "071026"); llm 0/9. Trên điện thoại chỉ có `tesseract.js` (EasyOCR, Ollama không chạy trong trình duyệt). Hướng thử: chụp riêng vùng HSD rồi dùng luật regex (nhãn HSD / EXP, ngày có dấu chấm / gạch, 6 số liền). Giai đoạn 3 phải đo lại bằng `tesseract.js` trên ảnh cắt riêng vùng HSD trước khi chọn; chuỗi 6 số liền phải đổi sang ngày và kiểm hợp lệ trước khi gợi ý; người dùng luôn xác nhận / sửa trước khi lưu: ngày hợp lệ vẫn có thể đọc sai (vd "200223", đáp án 200923), nên người dùng xác nhận là bắt buộc.
- [x] **Đợt `sua-nho`** (06/11/2026). App: bấm "Sửa" trong tủ đồ thì focus ô số lượng; ô ngày có min / max theo `YEAR_MIN` / `YEAR_MAX`; backup tủ đồ hỏng không ghi trùng bất kỳ khóa `qmv-pantry-backup*` nào; `NO_NAME` export từ `off.js` (xem mục 7). test-ocr: thêm 3 luật chung cho đạm / béo / carb ở `regex` và `dict` (mỗi luật có ở text OCR của ≥ 2 sản phẩm, chi tiết và mã sản phẩm ở `test-ocr/README.md` phần B và comment trong `run_extract.py`): (a) giá trị cuối > 100 g thì để trống, không thử luật khác; (b) bỏ cụm "chất béo bão hòa / chuyển hóa", "saturated fat", "trans fat" (kể cả OCR đọc sai) kèm số đi theo, và cụm "calories from fat" (kể cả nhiều dấu cách), trước khi chạy luật béo; (c) luật dự phòng: số nguyên ≥ 2 chữ số bắt đầu bằng 0 ("09", "00") thì để trống; (d) số mất dấu phẩy + g đọc thành 9 ("569") được (a) bao, không cần code riêng. Unittest 52 → 57 (vòng 1) → 59 (vòng 2) → 60 (vòng 3; thêm test s1g có 32 subTest: 11 ca cột + 5 ca dòng, mỗi ca rx và dc; s1f bọc 5 subTest) → 61 (vòng 4; thêm s1h 7 ca, 13 subTest: N3 chỉ rx).
  Vòng 2: SAT_FAT không ăn số béo tổng khi bảng đọc theo cột (review vòng 1); khoảng giữa nhãn và số không vượt nhãn béo khác; nhãn VI + EN liền nhau là một nhãn; 'Sắt' không bị coi là saturated; 'chất béo không bão hòa' bỏ trọn. Đo lại regex và dict: so với vòng 1 không đổi ô nào (1.364 / 1.364), nên các số dưới đây giữ nguyên.
  Vòng 3: nhãn béo tổng đứng liền nhãn bão hòa / chuyển hóa (bảng đọc theo cột, cả tiếng Việt, song ngữ, có '(g)') → giữ nhãn béo tổng, không bỏ số (review vòng 2); thử 11 ca cột + 5 ca dòng so với 45181af.
  Quyết định dieu-phoi vòng 2: sửa trong đợt theo cách giữ nhãn béo tổng; ca nào không ra được số béo tổng thì để trống, không bao giờ ra số bão hòa / chuyển hóa.
  Đo lại regex và dict sau vòng 3: so với vòng 2 không đổi ô nào (1.364 / 1.364).
  Vòng 4: khoảng giữa nhãn bão hòa / chuyển hóa và số không nhảy qua chữ (trừ 'less than'), nên bảng cột 'Chất béo / Chất béo bão hòa / Natri' không ra số bão hòa (review vòng 3); giữa 2 số của cột cho thêm '|'.
  Quyết định dieu-phoi vòng 3: không áp 'để trống mọi bảng cột' (không chặn được bảng đầy đủ, lại làm ô đúng của 8938501141040 tesseract thành rỗng); sửa gốc ở SAT_GAP. Ca biên chưa có trong 61 text thật mà review sau vòng 4 còn nêu thì ghi Việc để sau, không mở vòng sửa mới.
  Đo lại regex và dict sau vòng 4: so với vòng 3 không đổi ô nào (1.364 / 1.364).
  Quyết định dieu-phoi vòng 4: NÊN SỬA 1 (nhãn bão hòa kèm '(g)') và GỢI Ý 1, 3 của review vòng 4 ghi Việc để sau (dòng E), không mở vòng sửa code mới; vòng 5 chỉ sửa chữ rồi lên main.
  Quyết định dieu-phoi vòng 1: giữ assertEqual '10,84' (không nới test); thông báo chặn ngày ngoài 2000–2100 của trình duyệt chấp nhận, không làm.
  Đo lại chỉ regex và dict (1.364 ô = 2 extractor × 2 OCR × 31 mã × 11 trường, chấm bằng `match()` của `score_combo.py`; "đúng" = điểm 1, "rỗng" = không ra giá trị, "sai" = có giá trị mà điểm < 1, kể cả 46 ô `thanh_phan_dau` được điểm lẻ, không ô nào trong số đó đổi): không đổi 1.332; **sai → rỗng 29**; **sai → đúng 3**; **rỗng → sai 0, đúng → sai 0, đúng → rỗng 0**, rỗng → đúng 0, sai → sai khác 0. Chỉ tính 956 ô có đáp án: sai → rỗng 28, sai → đúng 3. Số ô mỗi luật đổi: (a) 18, (b) 8, (c) 3, 3 ô do 2 luật cùng bỏ ("1809" của 8936221043071 và "589" của 8936221044160: a + b; "00" của 8938501141477: b + c).
  % trước → sau (điểm / 239): EasyOCR + regex 30% → 31% (71 → 73); Tesseract + regex 12% → 12% (27,7 → 28,7); EasyOCR + dict 22%, Tesseract + dict 12% (không đổi). Theo trường `beo_g`: EasyOCR + regex 29% → 38%, Tesseract + regex 17% → 21%; `dam_g`, `carb_g` và mọi trường của dict không đổi (chỉ bớt số sai). `underthesea` không chạy lại (theo chủ dự án): cột underthesea trong `summary_combo.md` giữ số cũ, đã lỗi thời vì phần số dùng luật regex.
  Quyết định của dieu-phoi (06/11/2026, vòng 0): (1) "Sửa" chỉ focus ô số lượng, không select(); (2) "09" không đổi thành 0 mà để trống bằng luật số bắt đầu bằng 0 (chỉ 1 sản phẩm có "09" nên không làm luật riêng); (3) số ≥ 3 chữ số tận cùng 9 để trống nhờ luật > 100, không chèn dấu phẩy vì ô đạm "1449" của 8936017368111 sẽ thành 14,4 (đáp án 7,0); (4) underthesea không chạy lại.
- [x] **Đợt `hsd-do`** (06/11/2026, gộp trong đợt gd3-a): đo thử đọc hạn sử dụng bằng `tesseract.js` (trên ảnh cắt riêng vùng HSD, xem đề xuất ở dòng E), chưa làm tính năng app. Code ở `test-ocr/hsd-js/` (cách chạy, bảng kết quả: `test-ocr/README.md` phần C); kết quả chi tiết `test-ocr/outputs/hsd-js/summary.md` (không commit). **Kết quả trên 9 ô `han_su_dung`: (a) đọc thẳng 2/9, (b) xám + tương phản + phóng to, chỉ nhận số 1/9.** ms mỗi ảnh (tiền xử lý + recognize) trung bình / lớn nhất: (a) 492 / 1.530, (b) 399 / 1.015; tạo worker (a) 400 ms, (b) 275 ms (dữ liệu ngôn ngữ đã có trong cache; lần đầu tải `vie` + `eng` 6,6 MB: (a) 1.235 ms). Máy đo: Intel Core i7-6820HQ 2,7 GHz (8 luồng), RAM 7,8 GB, Windows 10, Node 24.20.0; tesseract.js 7.0.0 (core 7.0.0), jimp 1.6.1; điện thoại sẽ chậm hơn. Đúng: 8934673300759 "HSD:071026" (cả (a) và (b)) và 8936017367107 "before : 05 / Oct / 2021" (chỉ (a); (b) chỉ nhận số nên mất "Oct", ra "05//2021"); cả 2 là chữ nét liền (ô đầu in chấm kim nhưng nhòe thành nét liền). Sai: 5 ô in chấm kim (dot-matrix: chữ ghép từ các chấm rời) 8936028641487, 8936221044160, 8934588022111, 8936012061321, 8934673818391 đều không ra ngày: (a) ra chữ rác, (b) ra rỗng hoặc vài số rời ("- 1 1 1 2"), 8934673818391 (b) đọc sai số "2009770" (đáp án 200923); 2 ô chữ in dọc (ảnh cắt không xoay) 8936017368111 (ảnh nhỏ, cột chữ rộng ~35 px) và 8935001214274 (mờ) ra rác / rỗng. **Đề xuất: chưa làm `hsd-app`** vì (b) 1/9 < 5/9; giữ nhập hạn bằng tay. Nếu muốn thử lại thì phải xử lý được chữ chấm kim (vd làm mờ / nối chấm trước khi đọc) và chữ in dọc (xoay ảnh), đo lại trên bộ ảnh lớn hơn 9 ô.
  Quyết định của dieu-phoi (06/11/2026, gd3-a vòng 0): (1) xử lý ảnh bằng jimp (thuần JS), không dùng sharp; (2) (a) vie+eng, PSM mặc định, không whitelist; (b) eng, PSM 7, chỉ nhận 0123456789/.-, phóng 3 lần (2 lần nếu cạnh dài sau khi phóng 3 lần > 3000 px); bỏ ngày sau nhãn NSX / MFG; nhiều ngày cùng mức thì lấy ngày muộn nhất; nhận tháng viết tắt tiếng Anh; (3) ảnh cắt ở photos/<mã>/hsd/crop.jpg vì run_ocr.py đọc mọi photos/*/*.jpg; khung cắt chọn và commit trước khi chạy OCR; (4) chia 2 vòng: vòng 1 hsd-do, vòng 2 di-ung + kiểm tra / lên main / kiểm web một lần ở cuối.
- [x] **Đợt `di-ung`** (06/11/2026, gộp trong đợt gd3-a): giai đoạn 3, hồ sơ dị ứng cá nhân + cảnh báo khi quét trúng. Khung "Hồ sơ dị ứng" (đóng sẵn, 14 ô tick) ở màn Tra cứu, lưu ở khóa localStorage `qmv-allergy-profile` (mảng khóa nhóm, vd `["milk","peanuts"]`). 4 kiểu khung đầu kết quả: đỏ "Cảnh báo dị ứng: có …" (allergens_tags trùng hồ sơ), vàng "Có thể lẫn vết: …" (traces_tags trùng, trừ nhóm đã đỏ), câu thiếu dữ liệu (allergens_tags rỗng / thiếu), dòng trung tính (có dữ liệu, không đỏ / vàng); hồ sơ 0 nhóm thì không có khung. Câu thiếu dữ liệu ở đầu kết quả có khung riêng (nền + viền, không đỏ / vàng), nổi hơn dòng trung tính; tag rỗng trong *_tags không tính là có dữ liệu. Test app: `npm test` 32 test (`tests/allergy.test.js`); Playwright trên `npm run preview` (Chromium + WebKit) đạt mọi ca. Mã thật có dữ liệu dị ứng: 8993175532457 (Nabati Wafer Cheese Cream Wafer, bán ở Việt Nam), lúc kiểm 06/11/2026: allergens_tags `en:gluten, en:milk, en:soybeans`, traces_tags `en:eggs, en:milk, en:nuts, en:peanuts`; 8934563163150: allergens_tags `en:celery, en:gluten, en:soybeans`, traces_tags rỗng; 8934563651138: cả 2 rỗng. Quyết định của dieu-phoi (06/11/2026, gd3-a vòng 0): (1) hồ sơ lưu ngay khi tick, có dòng báo đã lưu, lưu lỗi thì báo rõ (không báo đã lưu); (2) allergens_tags rỗng thì luôn ghi 'Open Food Facts chưa có dữ liệu dị ứng cho sản phẩm này, hãy đọc nhãn trên bao bì' (kể cả khi traces_tags có); có dữ liệu mà không trùng hồ sơ thì dòng trung tính 'Dữ liệu Open Food Facts không ghi nhóm nào trong hồ sơ của bạn. Dữ liệu có thể thiếu hoặc ghi khác tên, hãy đọc nhãn trên bao bì.'; không bao giờ ghi 'an toàn' / 'không có chất gây dị ứng'; (3) chỉ so tag 'en:' có trong ALLERGEN_VI; (4) off.js đổi import.meta.env thành import.meta.env?. để test bằng node, URL / fields / app_name / app_version không đổi, kiểm bản build vẫn gọi đúng URL; (5) đổi hồ sơ chỉ vẽ lại khung cảnh báo, không vẽ lại cả kết quả (giữ chữ đang gõ trong form tủ đồ).
  Quyết định của dieu-phoi (06/11/2026, gd3-a vòng 1): (1) lưu hồ sơ lỗi thì vẫn giữ lựa chọn trong phiên đang mở để cảnh báo vẫn chạy, câu báo nói rõ chưa lưu được và tải lại trang sẽ mất, không bao giờ báo đã lưu; (2) allergens_tags rỗng mà traces_tags trùng hồ sơ thì hiện cả câu thiếu dữ liệu và khung vàng; dòng trung tính chỉ hiện khi có dữ liệu dị ứng và không có khung đỏ / vàng; (3) test app bằng node:test có sẵn ở tests/, không thêm thư viện, giả localStorage bằng object tự viết; package.json chỉ thêm script test.
  Quyết định của dieu-phoi (06/11/2026, gd3-a vòng 2): sửa GỢI Ý 1 (khung riêng cho câu thiếu dữ liệu), GỢI Ý 2 (bỏ tag rỗng), GỢI Ý 5 (sửa chữ PLAN) trong vòng 3 trước khi lên main; GỢI Ý 3, 4 ghi Việc để sau.
  Việc để sau (di-ung): role="alert" của khung đỏ nằm trong #result aria-live="polite", trình đọc màn hình có thể đọc 2 lần, cần thử VoiceOver; mở 2 tab thì hồ sơ không tự đồng bộ (chưa nghe sự kiện storage); chưa kiểm Open Food Facts có trả tag 'en:none' không (nếu có thì chip hiện chữ 'none' tiếng Anh) (còn mở).
  Việc để sau (gd3-a, còn mở): (1) test "không ghi an toàn" thêm ca tag rỗng; (2) nền khung xám (câu thiếu dữ liệu) ở bản tối hơi gần nền trang; (3) tag có khoảng trắng hai đầu hoặc chỉ "en:"; (4) VoiceOver có thể đọc cảnh báo đỏ 2 lần; (5) mở 2 tab thì hồ sơ không tự đồng bộ; (6) tag en:none; (7) npm test cần Node 21+ trong khi README ghi Node 20.19 chạy được.
  gd3-a lên main 06/11/2026, deploy run 42166930257 xanh, kiểm Pages Chromium + WebKit đạt.
- Quyết định của chủ dự án (06/11/2026): làm xong hết tính năng rồi thử iPhone một lần, gom lỗi vào đợt sua-cuoi; đồng bộ tủ đồ giữa các máy chọn xuất / nhập file JSON thay máy chủ (05/11/2026), máy chủ Node + Express + SQLite để sau nếu cần; đọc HSD từ ảnh tạm hoãn.
- [x] **Đợt `so-sanh`** (06/11/2026, đợt hoan-thien): giai đoạn 3, so sánh 2 sản phẩm cạnh nhau. Màn "So sánh" (nút trên thanh đầu trang, hoặc nút "So sánh với sản phẩm khác" dưới kết quả tra, điền sẵn bên A): chọn 2 mã (nhập hoặc chọn từ đã quét gần đây), 2 cột ảnh / tên / mã / khung dị ứng theo hồ sơ + bảng 6 chỉ số trên 100 g / 100 ml, ô trống ghi "chưa có dữ liệu"; tra lần lượt, dùng cache trong bộ nhớ của trang (30 mã, 10 phút), so lại cặp vừa so không gọi mạng. `npm test` 107 test (sau vòng 3 đợt hoan-thien).
  Quyết định của dieu-phoi (06/11/2026, hoan-thien vòng 0): (1) cache tra cứu trong bộ nhớ của trang (không localStorage): tối đa 30 mã, 10 phút, giữ cả 'không tìm thấy', lỗi không giữ, 2 lượt cùng mã đang chạy dùng chung 1 lần gọi; (2) so sánh chỉ hiện số, không tô / in đậm bên nào hơn, không tự tính (không đổi kJ ra kcal, natri ra muối); khung dị ứng 2 cột không dùng id allergyAlert, vẽ lại mỗi lần mở màn So sánh; mã tra ở màn So sánh không vào lịch sử; (3) sw.js sinh lúc build bằng plugin nhỏ trong vite.config.js (không thêm gói), mã phiên bản theo nội dung file build; trang lấy từ mạng trước và bỏ qua bộ nhớ đệm HTTP, mất mạng mới dùng bản đã lưu; file assets lấy từ cache trước; không đụng request khác tên miền (Open Food Facts, Google Fonts); (4) có bản mới thì hiện thanh 'Đã có bản mới. Tải lại', không tự tải lại, không hiện ở lần cài đầu; (5) nhập 'Thay toàn bộ' hỏi xác nhận (nói rõ hồ sơ dị ứng sẽ thành gì) và chép tủ cũ sang khóa `qmv-pantry-backup-<thời điểm>` trước khi thay; chép lỗi thì không đổi gì; (6) vòng 1: docs + so sánh + góp sản phẩm + xuất / nhập; vòng 2: PWA + docs cuối + kiểm tra cuối; code-reviewer một lần trên d2531b0..HEAD sau vòng code cuối; lên main, deploy, kiểm Pages một lần ở cuối đợt.
- [x] **Đợt `pwa`** (06/11/2026, đợt hoan-thien): giai đoạn 3, cài lên màn hình chính. `public/manifest.webmanifest` (start_url / scope / id `/quet-ma-vach-full/`), icon tự vẽ bằng `tools/make-icons.mjs` (chỉ module có sẵn của Node, không thêm gói), apple-touch-icon nền kín cho iPhone; service worker sinh lúc build chỉ giữ giao diện, không giữ dữ liệu Open Food Facts; bản mới hiện thanh "Đã có bản mới. Tải lại" (xem mục 7, có cách gỡ). `npm test` 107 test (thêm `tests/sw.test.js`, `tests/pwa.test.js`).
- [ ] **Đợt `hsd-app`**: giai đoạn 3, đọc HSD từ ảnh trong app, người dùng xác nhận lại. Tạm hoãn (06/11/2026): không đo thêm; gd3-a đọc thẳng 2/9, xử lý ảnh 1/9, dưới ngưỡng 5/9; chữ in chấm kim và chữ dọc không đọc được; người dùng nhập hạn bằng tay.
- [x] **Đợt `gd4`** (06/11/2026, đợt hoan-thien; phần không cần máy chủ): giai đoạn 4, link góp sản phẩm lên Open Food Facts khi mã chưa có (nút mở trang 'Add a product' chính thức, người dùng tự nhập mã); "Xuất tủ đồ" tải file `tu-do-YYYY-MM-DD.json` (tủ đồ + hồ sơ dị ứng), "Nhập tủ đồ" kiểm định dạng rồi hỏi Gộp / Thay toàn bộ / Hủy (Thay toàn bộ hỏi xác nhận, chép tủ cũ sang khóa `qmv-pantry-backup-<thời điểm>`). Máy chủ Node + Express + SQLite để sau nếu cần. `npm test` 107 test.
  Quyết định của dieu-phoi (06/11/2026, hoan-thien vòng 1): (1) link góp sản phẩm dùng trang 'Add a product' chính thức https://world.openfoodfacts.org/cgi/product.pl?type=search_or_add&action=display, không điền sẵn mã; nguồn: mã nguồn openfoodfacts-server cgi/product_multilingual.pl: type=add với mã chưa có trả 404 'No product listed for barcode', còn type=search_or_add&action=process&code=… tạo luôn sản phẩm rỗng trên Open Food Facts nên không dùng làm link; form 'Add a product' không nhận mã điền sẵn; câu giải thích ghi mã để người dùng tự nhập; (2) 'Thay toàn bộ' khi tủ đang rỗng không chép bản dự phòng; (3) món trùng id trong file bị bỏ, câu tóm tắt ghi 'món hỏng hoặc trùng'; (4) giữ dòng chú thích nhỏ cuối màn So sánh; (5) manifest start_url / scope / id '/quet-ma-vach-full/'; kiểm trên máy bằng bản build phục vụ dưới /quet-ma-vach-full/.
  Quyết định của dieu-phoi (06/11/2026, hoan-thien vòng 2): (1) sửa thanh 'Đã có bản mới' hiện thừa ở lần mở đầu sau deploy: chỉ hiện khi file JS / CSS của trang không còn trong cache bản mới; (2) bấm 'So sánh với sản phẩm khác' thì xóa kết quả so sánh cũ; (3) số dinh dưỡng nhỏ hơn 1 hiện 2 chữ số có nghĩa (muối 0,04 g thay vì 0 g), áp dụng cả màn tra cứu và So sánh; (4) các gợi ý reviewer còn lại để sau.
  Việc để sau (hoan-thien, còn mở): (a) nút "Chép mã" cạnh nút góp sản phẩm (trang Open Food Facts không điền sẵn mã) (đã làm ở sua-cuoi vòng 1); (b) màn So sánh: bấm So sánh liên tiếp với mã khác nhau thì lượt cũ vẫn gọi mạng nốt (2 lần gọi có thể sát nhau); (c) mở app khi sóng yếu: trang chờ mạng không giới hạn thời gian, cân nhắc chờ tối đa khoảng 3 giây rồi dùng bản đã lưu; (d) manifest + icon nằm trong cache nhưng service worker không dùng: chọn lấy từ cache trước cho icons/ + manifest, hoặc bỏ khỏi danh sách lưu sẵn; (e) mỗi lần 'Thay toàn bộ' thêm 1 khóa qmv-pantry-backup-<thời điểm>, chưa có cách dọn / giới hạn; (f) test node chưa phủ phần điều khiển màn So sánh (main.js); (g) cache giả trong tests/sw.test.js không đổi './index.html' ra địa chỉ đầy đủ (đang dựa vào Playwright); (h) deploy chỉ đổi index.html (JS / CSS giữ nguyên) thì tab đang mở không hiện thanh bản mới (lần mở sau vẫn ra bản mới); (i) `pageAssetUrls` (src/pwa.js) lọc thêm origin: chỉ xét file JS / CSS cùng tên miền app; (j) test `whenActivated` kiểm có gỡ listener `statechange`; (k) PLAN mục 7, câu thanh bản mới: ghi rõ "kiểm sau khi bản mới kích hoạt xong"; (l) kiểm thật thanh bản mới 5f / 5k trên Pages ở lần deploy đầu của sua-cuoi ((i)–(l) là 4 GỢI Ý của reviewer vòng 3).
  hoan-thien lên main 06/11/2026 (bafe694), deploy run 42182193081, kiểm Pages Chromium + WebKit đạt.
  Bước sau: Chủ dự án thử iPhone toàn bộ app (danh sách ở báo cáo cuối đợt hoan-thien) → gom lỗi vào đợt sua-cuoi.
- [ ] **Đợt `sua-cuoi`** (06/11/2026, đang làm): sửa lỗi sau lần chủ dự án thử iPhone toàn bộ app.
  Kết quả thử iPhone (06/11/2026): chủ dự án thử 10 bước chỉ điện thoại làm được, đạt 9/10; trượt "Chụp ảnh mã" với bao bì thật (NotFoundException sau 4 lần thử). Claude (chat) thử 2 ảnh thật gói Lay's 8936079121822 (một ảnh vạch bị nhăn, một ảnh xoay dọc): zxing-cpp đọc được cả 2 ở mọi góc; ZXing-js (thư viện html5-qrcode dùng để đọc ảnh, như app đang dùng) trượt ảnh nhăn kể cả bật TRY_HARDER.
  Quyết định của chủ dự án (06/11/2026): thêm `zxing-wasm` (bản WebAssembly của zxing-cpp) chỉ cho nút "Chụp ảnh mã" (lý do như trên); "Bật camera" giữ html5-qrcode; file wasm tự host cùng app, chỉ tải khi người dùng chọn ảnh, không vào bộ nhớ đệm cài sẵn (precache) của service worker.
  Quyết định của dieu-phoi (06/11/2026, sua-cuoi vòng 0): (1) 2 vòng code (vòng 1: zxing-wasm + nút "Chép mã"; vòng 2: UPCitemdb + việc để sau + kiểm cuối) rồi lên main, kiểm Pages một lần; (2) việc để sau làm: hoan-thien (a), (b), (c), (d), (e), (g); gd3-a (1), (2), (3), (5), (6); gd3-a (7) chỉ tick vì README đã ghi Node 21+; để nguyên: hoan-thien (f), (h), VoiceOver (gd3-a (4)), việc để sau di-ung / ocr-b; hoan-thien (b) chỉ còn ca lượt cũ đang dở lần gọi A → giãn ≥ 1 giây giữa 2 lần gọi mạng của màn So sánh, kể cả khác lượt; hoan-thien (e) chỉ xóa bản cũ sau khi đã ghi xong bản mới, giữ 5 khóa `qmv-pantry-backup-<thời điểm>` mới nhất, không bao giờ xóa `qmv-pantry-backup` gốc; (3) kiểm thanh bản mới 5f bằng hồ sơ trình duyệt mồi bản bafe694 trước khi push; sau deploy mở lại khi mất mạng rồi bật mạng + `registration.update()`; (4) UPCitemdb: chỉ làm khi có ≥ 7/34 mã, ≤ 40 lượt / ngày, giãn ≥ 12 giây giữa 2 lượt, gặp 429 thì dừng; (5) xoay ±15° bằng canvas chỉ thêm khi đo thấy đọc thêm được ≥ 1 ảnh nghiêng, và chỉ chạy sau khi các lượt khác trượt.
  Vòng 1 (06/11/2026, nhánh `sua-cuoi`, chưa lên main): (1) "Chụp ảnh mã" đọc bằng `zxing-wasm` 3.1.6 trước (ảnh thu về cạnh dài 1600 px; tùy chọn `formats` EAN13 / EAN8 / UPCA / UPCE, `tryHarder`, `tryRotate`, `tryInvert`, `tryDownscale`, `maxNumberOfSymbols: 1`), không tải được / lỗi / không thấy mã thì html5-qrcode 4 lượt như cũ, cuối cùng xoay ảnh ±15° rồi đọc lại bằng zxing-wasm; mã UPC-A zxing-wasm trả 13 số có số 0 đầu được đổi về 12 số như camera; câu lỗi mới (mục 7). (2) Nút "Chép mã" cạnh nút góp sản phẩm (màn tra cứu + cột So sánh): `navigator.clipboard`, không được thì ô chỉ đọc chọn sẵn mã + `execCommand("copy")`, báo "Đã chép" hoặc "Không chép được, hãy tự chép mã …". (3) `npm test` 107 → 127 test (`tests/barcode.test.js` 14, `tests/copy-code.test.js` 4, `tests/sw.test.js` thêm 2).
  Kích thước bản build (thô / gzip): chunk JS zxing `assets/zxing-reader-*.js` 36,2 / 13,1 kB (≤ 200 kB gzip nên vẫn lưu sẵn trong service worker); `assets/zxing_reader-*.wasm` 946,9 / 411,1 kB (KHÔNG lưu sẵn: `precacheList` trong `tools/sw-build.mjs` bỏ mọi file .wasm, chỉ tải khi chọn ảnh); `sw.js` 3,0 / 1,4 kB; JS chính 372,7 → 377,1 kB (gzip 114,0 → 115,4 kB).
  Đo "Chụp ảnh mã" (Playwright đưa ảnh vào ô chọn ảnh của bản build phục vụ dưới /quet-ma-vach-full/, Open Food Facts bị chặn trả 404 giả; máy đo Intel Core i7-6820HQ 2,7 GHz, RAM 7,8 GB, Windows 10; Chromium 156 headless shell, WebKit 26; điện thoại sẽ chậm hơn). Cách cũ = bản build bafe694, cách mới = nhánh sua-cuoi. 2 ảnh thật gói Lay's (ảnh chụp màn hình khung xem trước 828×1792) + 2 bản phóng lên ~12 MP (2355×5096): **cũ 0/4 (cả 2 trình duyệt, NotFoundException sau 4 lần thử), mới 4/4 ra 8936079121822 (cả 2 trình duyệt)**, 44–303 ms. Bộ 55 ảnh tổng hợp (5 mã: 8934563163150, 8936079121822, 8993175532457, EAN-8 96385074, UPC-A 036000291452; 11 kiểu × 5 mã, JPEG; ảnh và script ở `D:\tmp\sua-cuoi`, không vào git):

  | nhóm (5 ảnh mỗi nhóm) | cũ Chromium | cũ WebKit | mới Chromium | mới WebKit |
  |---|---|---|---|---|
  | gốc, mờ, nghiêng 10° / 15° / 20°, cong, nếp nhăn, lóa, mã nhỏ 25–40% ở 12 MP, xoay dọc + nếp nhăn (10 nhóm) | 50/50 | 50/50 | 50/50 | 50/50 |
  | 12 MP ghép (nghiêng 15° + mờ + lóa) | 3/5 | 3/5 | 5/5 | 5/5 |
  | **tổng** | **53/55** | **53/55** | **55/55** | **55/55** |
  | ms TB / lớn nhất | 256 / 693 | 622 / 1.763 | 81 / 872 | 143 / 1.876 |

  Bộ ảnh tổng hợp chưa đủ khó để tách 2 cách (html5-qrcode cũng đọc được); khác biệt rõ là ở ảnh thật nhăn / xoay dọc. Trước khi thêm lượt xoay ±15° cách mới cũng 53/55 (2 ảnh "12 MP ghép" trượt cả zxing-wasm lẫn html5-qrcode); lượt xoay đọc thêm đúng 2 ảnh đó nên được thêm (quyết định (5)). Ảnh không có mã (12 MP): báo lỗi sau 703 ms (Chromium) / 1.449 ms (WebKit), cách cũ 471 / 1.157 ms.
  Kiểm wasm (Chromium + WebKit): trang mới mở chưa chọn ảnh 0 request .wasm; chọn ảnh thì wasm tải từ `assets/` cùng tên miền app, 0 request tới jsDelivr / unpkg / CDN khác; mất mạng (đã mở app một lần, chưa chọn ảnh) app vẫn mở, chọn ảnh thật thì báo lỗi "zxing-wasm: không tải được", nút mở lại (Chromium 400 ms; WebKit giả mất mạng bằng tắt server 5,5 giây), ảnh dễ vẫn đọc bằng html5-qrcode; có mạng lại thì zxing-wasm tải lại được không cần tải lại trang; chặn riêng .wasm khi có mạng: như mất mạng (427 / 1.050 ms).
