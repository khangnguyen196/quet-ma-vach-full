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
quet-ma-vach-full/
├── index.html          # trang chính
├── src/
│   ├── main.js         # nối các phần lại, xử lý sự kiện
│   ├── scanner.js      # bật/tắt camera, đọc mã từ ảnh
│   ├── off.js          # gọi Open Food Facts, đổi dữ liệu sang tiếng Việt
│   ├── render.js       # tạo HTML kết quả
│   ├── storage.js      # lịch sử + tủ đồ (localStorage)
│   ├── pantry.js       # tủ đồ: số ngày còn hạn, trạng thái, sắp xếp, định dạng ngày
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
- "Chụp ảnh mã" có lúc không đọc được ảnh mờ, chụp quá gần, hoặc khi mở trong trình duyệt của Zalo/Messenger, nên dùng Safari.
- Hàng Việt trên Open Food Facts nhiều mã có nhưng thiếu dinh dưỡng, thiếu bảo quản → luôn có trạng thái "chưa có dữ liệu" và cho nhập tay.
- Open Food Facts yêu cầu app tử tế: không gọi liên tục, cache kết quả đã tra trong localStorage.
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
- Máy chủ dự án: ổ C chỉ còn ít chỗ (05/11/2026 đo còn khoảng 4,6 GB; chủ dự án lưu ý ổ C ít chỗ), mọi thứ tải về để ở ổ D: Ollama `D:\ollama\app`, model `D:\ollama\models`, `HF_HOME` `D:\cache\hf`, `TEMP` / `TMP` `D:\tmp`, cache npm `D:\cache\npm`.

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

### Claude Code làm (mỗi việc một đợt `/dot`, theo thứ tự A → E, rồi các đợt mới: sua-nho → hsd-do → di-ung → so-sanh → pwa → hsd-app → gd4)
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
  Việc để sau: llm trả `han_su_dung` bằng chữ chép từ câu lệnh gửi cho model ("như in", "tên hạn sử dụng") hoặc câu mô tả ("06 tháng kể từ ngày sản xuất", "hiện tại"); đợt sau sửa câu lệnh `LLM_PROMPT` (vd ví dụ ngày cụ thể, không có thì để trống) (còn mở). Nhãn béo "fat" (cả luật cũ lẫn dự phòng) còn bắt "Saturated Fat" / "Trans Fat" (đã xử lý ở `sua-nho`). Nguyên nhân của 63 ô rỗng → sai ở trên: "0 g" đọc thành "09" 6 ô (8935001214274); nhãn béo lấy "00" của "Saturated Fat" 2 ô (8938501141477); HSD "200223" 3 ô (8934673818391: ngày hợp lệ nhưng OCR đọc sai, đáp án 200923); 52 ô còn lại: luật dự phòng gặp số mất dấu phẩy + g đọc thành 9 (vd "569" là 5,6 g; "1199" là 11,9 g) hoặc lấy nhầm số khác sau nhãn ("288Akcal" mất phần lẻ); đợt sau bỏ giá trị đạm / béo / carb > 100 g (đã làm ở `sua-nho`; "09" không đổi thành 0 mà để trống). Luật (7) ra "711l" ở 8936036029819 (OCR đọc rác "TỊNH: 711l 60y") (còn mở). `(?<!from )fat` chỉ chịu đúng 1 dấu cách giữa "from" và "fat" (đã xử lý ở `sua-nho`: bỏ cụm "from fat" khỏi text trước khi chạy luật béo); `find_date` chỉ xét chuỗi 6 số đầu tiên sau nhãn, sai khoảng thì không thử chuỗi kế (dùng `finditer`) (còn mở); đổi kiểm khoảng sang kiểm lịch thật (`datetime`) (còn mở). Hai việc `finditer`, kiểm lịch chưa có ca nào trong dữ liệu (text OCR của 31 mã chỉ có 3 chuỗi 6 số sau HSD / EXP: "071026", "200223", "848224"), để đợt sau. Nhãn VI 'chất béo trans' (không có chữ fat) chưa được SAT_FAT bỏ; chưa thấy trong dữ liệu (còn mở). Bảng theo dòng mất số béo tổng, có 2 cột giá trị ('Chất béo/ Fat Chất béo bão hòa/ Saturated fat 2 g 4 g') ra 2 (có từ trước đợt; chữ giống hệt bảng cột nên luật không phân biệt được) (còn mở). Nhãn 'fat' của luật béo chặt (run_extract.py, dòng beo_g) không có ranh giới từ, khớp vào 'Fatty acids' (còn mở).
  Đề xuất cho app (giai đoạn 3), **là GIẢ THUYẾT, chưa được đo**: bằng chứng hiện có rất mỏng: Tesseract (gần nhất với `tesseract.js`) đọc HSD đúng 0/9 ô với mọi extractor; ô HSD đúng duy nhất là EasyOCR (8934673300759 "071026"); llm 0/9. Trên điện thoại chỉ có `tesseract.js` (EasyOCR, Ollama không chạy trong trình duyệt). Hướng thử: chụp riêng vùng HSD rồi dùng luật regex (nhãn HSD / EXP, ngày có dấu chấm / gạch, 6 số liền). Giai đoạn 3 phải đo lại bằng `tesseract.js` trên ảnh cắt riêng vùng HSD trước khi chọn; chuỗi 6 số liền phải đổi sang ngày và kiểm hợp lệ trước khi gợi ý; người dùng luôn xác nhận / sửa trước khi lưu: ngày hợp lệ vẫn có thể đọc sai (vd "200223", đáp án 200923), nên người dùng xác nhận là bắt buộc.
- [x] **Đợt `sua-nho`** (06/11/2026). App: bấm "Sửa" trong tủ đồ thì focus ô số lượng; ô ngày có min / max theo `YEAR_MIN` / `YEAR_MAX`; backup tủ đồ hỏng không ghi trùng bất kỳ khóa `qmv-pantry-backup*` nào; `NO_NAME` export từ `off.js` (xem mục 7). test-ocr: thêm 3 luật chung cho đạm / béo / carb ở `regex` và `dict` (mỗi luật có ở text OCR của ≥ 2 sản phẩm, chi tiết và mã sản phẩm ở `test-ocr/README.md` phần B và comment trong `run_extract.py`): (a) giá trị cuối > 100 g thì để trống, không thử luật khác; (b) bỏ cụm "chất béo bão hòa / chuyển hóa", "saturated fat", "trans fat" (kể cả OCR đọc sai) kèm số đi theo, và cụm "calories from fat" (kể cả nhiều dấu cách), trước khi chạy luật béo; (c) luật dự phòng: số nguyên ≥ 2 chữ số bắt đầu bằng 0 ("09", "00") thì để trống; (d) số mất dấu phẩy + g đọc thành 9 ("569") được (a) bao, không cần code riêng. Unittest 52 → 57 (vòng 1) → 59 (vòng 2) → 60 (vòng 3; thêm test s1g có 32 subTest: 11 ca cột + 5 ca dòng, mỗi ca rx và dc; s1f bọc 5 subTest) → 61 (vòng 4; thêm s1h 7 ca × rx/dc).
  Vòng 2: SAT_FAT không ăn số béo tổng khi bảng đọc theo cột (review vòng 1); khoảng giữa nhãn và số không vượt nhãn béo khác; nhãn VI + EN liền nhau là một nhãn; 'Sắt' không bị coi là saturated; 'chất béo không bão hòa' bỏ trọn. Đo lại regex và dict: so với vòng 1 không đổi ô nào (1.364 / 1.364), nên các số dưới đây giữ nguyên.
  Vòng 3: nhãn béo tổng đứng liền nhãn bão hòa / chuyển hóa (bảng đọc theo cột, cả tiếng Việt, song ngữ, có '(g)') → giữ nhãn béo tổng, không bỏ số (review vòng 2); thử 11 ca cột + 5 ca dòng so với 45181af.
  Quyết định dieu-phoi vòng 2: sửa trong đợt theo cách giữ nhãn béo tổng; ca nào không ra được số béo tổng thì để trống, không bao giờ ra số bão hòa / chuyển hóa.
  Đo lại regex và dict sau vòng 3: so với vòng 2 không đổi ô nào (1.364 / 1.364).
  Vòng 4: khoảng giữa nhãn bão hòa / chuyển hóa và số không nhảy qua chữ (trừ 'less than'), nên bảng cột 'Chất béo / Chất béo bão hòa / Natri' không ra số bão hòa (review vòng 3); giữa 2 số của cột cho thêm '|'.
  Quyết định dieu-phoi vòng 3: không áp 'để trống mọi bảng cột' (không chặn được bảng đầy đủ, lại làm ô đúng của 8938501141040 tesseract thành rỗng); sửa gốc ở SAT_GAP. Ca biên chưa có trong 61 text thật mà review sau vòng 4 còn nêu thì ghi Việc để sau, không mở vòng sửa mới.
  Đo lại regex và dict sau vòng 4: so với vòng 3 không đổi ô nào (1.364 / 1.364).
  Quyết định dieu-phoi vòng 1: giữ assertEqual '10,84' (không nới test); thông báo chặn ngày ngoài 2000–2100 của trình duyệt chấp nhận, không làm.
  Đo lại chỉ regex và dict (1.364 ô = 2 extractor × 2 OCR × 31 mã × 11 trường, chấm bằng `match()` của `score_combo.py`; "đúng" = điểm 1, "rỗng" = không ra giá trị, "sai" = có giá trị mà điểm < 1, kể cả 46 ô `thanh_phan_dau` được điểm lẻ, không ô nào trong số đó đổi): không đổi 1.332; **sai → rỗng 29**; **sai → đúng 3**; **rỗng → sai 0, đúng → sai 0, đúng → rỗng 0**, rỗng → đúng 0, sai → sai khác 0. Chỉ tính 956 ô có đáp án: sai → rỗng 28, sai → đúng 3. Số ô mỗi luật đổi: (a) 18, (b) 8, (c) 3, 3 ô do 2 luật cùng bỏ ("1809" của 8936221043071 và "589" của 8936221044160: a + b; "00" của 8938501141477: b + c).
  % trước → sau (điểm / 239): EasyOCR + regex 30% → 31% (71 → 73); Tesseract + regex 12% → 12% (27,7 → 28,7); EasyOCR + dict 22%, Tesseract + dict 12% (không đổi). Theo trường `beo_g`: EasyOCR + regex 29% → 38%, Tesseract + regex 17% → 21%; `dam_g`, `carb_g` và mọi trường của dict không đổi (chỉ bớt số sai). `underthesea` không chạy lại (theo chủ dự án): cột underthesea trong `summary_combo.md` giữ số cũ, đã lỗi thời vì phần số dùng luật regex.
  Quyết định của dieu-phoi (06/11/2026, vòng 0): (1) "Sửa" chỉ focus ô số lượng, không select(); (2) "09" không đổi thành 0 mà để trống bằng luật số bắt đầu bằng 0 (chỉ 1 sản phẩm có "09" nên không làm luật riêng); (3) số ≥ 3 chữ số tận cùng 9 để trống nhờ luật > 100, không chèn dấu phẩy vì ô đạm "1449" của 8936017368111 sẽ thành 14,4 (đáp án 7,0); (4) underthesea không chạy lại.
- [ ] **Đợt `hsd-do`**: đo thử đọc hạn sử dụng bằng `tesseract.js` (trên ảnh cắt riêng vùng HSD, xem đề xuất ở dòng E), chưa làm tính năng app.
- [ ] **Đợt `di-ung`**: giai đoạn 3, hồ sơ dị ứng cá nhân + cảnh báo khi quét trúng.
- [ ] **Đợt `so-sanh`**: giai đoạn 3, so sánh 2 sản phẩm cạnh nhau.
- [ ] **Đợt `pwa`**: giai đoạn 3, cài lên màn hình chính.
- [ ] **Đợt `hsd-app`**: giai đoạn 3, đọc HSD từ ảnh trong app, người dùng xác nhận lại; chỉ làm khi `hsd-do` đạt ít nhất 5/9.
- [ ] **Đợt `gd4`**: giai đoạn 4, link góp sản phẩm lên Open Food Facts khi mã chưa có; đồng bộ tủ đồ giữa các máy chưa chốt cách.
