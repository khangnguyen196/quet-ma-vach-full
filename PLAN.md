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

### Giai đoạn 2 – Thông tin thêm + Tủ đồ ăn
- [x] Hiện xuất xứ nguyên liệu, nơi sản xuất, nước bán, bảo quản, cách dùng, nhãn chứng nhận (halal, organic…) – trường nào trống thì ẩn
- [x] Nút "Thêm vào tủ đồ" sau khi tra: nhập hạn sử dụng (ô chọn ngày) + số lượng
- [x] Trang "Tủ đồ": danh sách sản phẩm, sắp theo ngày hết hạn, tô màu: còn > 7 ngày (bình thường), ≤ 7 ngày (vàng), đã hết hạn (đỏ)
- [x] Xóa / sửa món trong tủ
- [x] Lưu bằng localStorage (chưa cần tài khoản)

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
- Việc nhỏ để sau: render.js chép tay chuỗi 'Sản phẩm chưa có tên' từ off.js; nên export hằng từ off.js.

## 8. Việc cần làm tiếp (cập nhật 05/11/2026)

Trạng thái: giai đoạn 1 đã lên https://khangnguyen196.github.io/quet-ma-vach-full/ (repo https://github.com/khangnguyen196/quet-ma-vach-full); giai đoạn 2 (xuất xứ / bảo quản, tủ đồ) lên main trong đợt `gd2` (05/11/2026). Lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions tự build + deploy. Đợt `khoi-dong`, `sua-va-dua-len` và `chi-phi-1` (trần 60 lượt Google mỗi lần chạy, 800 lượt/tháng; app gửi app_name/app_version; main cb5f449) đã đóng. Quy tắc làm việc (toàn quyền, chỉ dùng mức miễn phí, không dùng API Claude/Anthropic) nằm trong `.claude/du-an.md`.

### Chủ dự án tự làm (máy không làm thay được)
- [ ] Thử tủ đồ trên iPhone Safari ở link app: tra mã, thêm vào tủ (chọn hạn, số lượng), mở "Tủ đồ", sửa, xóa, tải lại trang vẫn còn; chạm đúp "Thêm vào tủ đồ" chỉ thêm 1 món; bấm "Sửa" xem bảng chọn ngày có tự bật không.
- [x] Trước đợt `anh-mang`: thêm vào `.claude/du-an.md` ngoại lệ cho Claude Code điền `test-ocr/truth.csv` một lần (hồ sơ đang cấm sửa truth.csv). (05/11/2026: chủ dự án đã thêm, du-an.md dòng 59)
- [x] Thử nút "Bật camera" trên iPhone ở link app. (05/11/2026: đạt, giai đoạn 1 xong)
- [x] Xác nhận lịch sử chỉ lưu mã tìm thấy, xem mục 7. (05/11/2026: giữ như hiện tại)
- [ ] Cài Tesseract kèm tiếng Việt: `winget install --id UB-Mannheim.TesseractOCR -e --interactive` (giữ lệnh để cài lại máy), ở bước chọn thành phần tick Vietnamese trong "Additional language data". Kiểm (gõ trong PowerShell): `& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs` (phải có `eng` và `vie`). Gõ `tesseract --list-langs` (không kèm đường dẫn) mà báo không tìm thấy thì bỏ dấu `#` ở dòng `TESSERACT_CMD` trong `test-ocr\.env`. (05/11/2026: Tesseract v5.4.0 đã cài, dòng `TESSERACT_CMD` đã bật, nhưng bộ cài **chưa có `vie`**: `--list-langs` chỉ ra `eng`, `osd`. Đợt `anh-mang` đã tải `vie.traineddata` từ https://github.com/tesseract-ocr/tessdata vào `C:\Users\LTC\tessdata` (kèm `eng`, `osd`), chạy thử `--tessdata-dir C:\Users\LTC\tessdata -l vie` ra chữ tiếng Việt; chép vào `C:\Program Files\Tesseract-OCR\tessdata` bị từ chối vì cần quyền quản trị. **Chủ dự án bổ sung:** mở PowerShell bằng "Run as administrator", gõ `Copy-Item "C:\Users\LTC\tessdata\vie.traineddata" "C:\Program Files\Tesseract-OCR\tessdata\"`, rồi kiểm lại `--list-langs` phải có `vie`. Không đặt `TESSDATA_PREFIX`.)
- [ ] (Tùy chọn) Lấy key Azure gói F0 (hết lượt chỉ báo lỗi, không trừ tiền) hoặc Google Vision khi tài khoản chưa nâng cấp trả phí, tự điền `test-ocr/.env`. Không key vẫn chạy so sánh được với công cụ miễn phí.
- [x] Kiểm Claude Code đăng nhập bằng gói Claude (Pro/Max) hay API key (`/status`); API key nghĩa là đang tốn tiền. (05/11/2026: gói Team, không phải API key)

### Claude Code làm (mỗi việc một đợt `/dot`, theo thứ tự A → F)
- [x] **A. Đợt `plan-sua`** (05/11/2026): sửa chữ PLAN.md, CLAUDE.md, README.md (diễn đạt "lên main" theo chế độ C, cập nhật theo chủ dự án), lên main.
- [x] **B. Đợt `anh-mang`** (05/11/2026: 30 sản phẩm × 3 ảnh front / ingredients / nutrition + 6 ảnh hạn sử dụng `date.jpg`, tất cả từ Open Food Facts, không cần Wikimedia Commons; `truth.csv` 31 dòng (30 sản phẩm + 1 dòng chỉ có `code` + `han_su_dung`); bỏ dòng mẫu 8934563163150 vì ảnh thành phần là nhãn xuất khẩu tiếng Pháp, bảng dinh dưỡng bị cắt ở mép, ảnh 'nutrition' thật ra là mặt trước. Cách đặt ảnh HSD đã chốt: có mã thì `photos/<mã>/date.jpg`, mã ngoài 30 món thì thêm dòng `truth.csv` chỉ có `code` + `han_su_dung`, không rõ mã thì `photos/hsd-NN/date.jpg`): lấy ảnh giấy phép mở từ Open Food Facts (ảnh hạn sử dụng thêm từ Wikimedia Commons) vào `test-ocr/photos/<mã vạch>/`; Claude Code điền `test-ocr/truth.csv` (chủ dự án cho phép 1 lần, cần ngoại lệ trong hồ sơ trước) và bổ sung `test-ocr/dict/brands.txt`; cập nhật `test-ocr/README.md` theo cách lấy ảnh mới (README đó còn ghi "chụp 30 sản phẩm", "Mình đã chụp ảnh…"). Ảnh hạn sử dụng từ Wikimedia Commons thường không phải đúng sản phẩm có mã vạch đó, nên cách đặt vào `photos/<mã>/` cho khớp `truth.csv` sẽ chốt trong đợt này. Cảnh báo: repo công khai; `test-ocr/photos/` đã có trong `test-ocr/.gitignore`; không bao giờ `git add -f` ảnh.
- [x] **C. Đợt `gd2`** (05/11/2026, lên main và test Pages trong cùng đợt): giai đoạn 2 ở mục 2 (xuất xứ/bảo quản, tủ đồ ăn, hạn sử dụng). Sửa luôn vấn đề ở mục 7: thương hiệu, khối lượng, phân loại, ảnh phải hiện "chưa có dữ liệu" khi trống. Thêm comment ở `src/off.js`: APP_NAME là tên repo, không phải tên trong package.json. Lên main (chế độ C: git push từ nhánh của đợt sang main, không commit thẳng main) thì GitHub Actions tự build + deploy; chờ deploy xong, test trên link Pages bằng Chromium + WebKit, báo cáo kèm danh sách chủ dự án thử trên iPhone.
- [ ] **D. Đợt `ocr-a`** (sau `anh-mang`): sửa `test-ocr/score.py` chỉ tính kết quả cuối của mỗi ảnh, bỏ qua thư mục extract; siết test_7, sửa docstring / tên class test nói cả Google lẫn Azure, dọn `api_usage.json.tmp` sót lại; chạy `run_ocr.py` rồi `score.py`; easyocr được cài luôn theo hồ sơ (tải ~257 MB, sau cài ~600–900 MB); công cụ thiếu (vd thiếu key) thì bỏ qua và ghi rõ. Ra `outputs/summary.md`: OCR nào đầy đủ nhất, trường nào hay sai, số lượt gọi Google/Azure đã dùng trong tháng. Lưu ý (05/11/2026): `run_ocr.py` gọi Tesseract với `vie+eng` nhưng `C:\Program Files\Tesseract-OCR\tessdata` chưa có `vie` (xem mục "Chủ dự án tự làm" ở trên); chủ dự án chưa chép thì Tesseract sẽ báo lỗi thiếu ngôn ngữ. Không đặt `TESSDATA_PREFIX`. Ghi chú chấm điểm (05/11/2026): (1) `found()` trong `score.py` đã sửa trong đợt `anh-mang` (dieu-phoi quyết định sửa ngay thay vì chỉ ghi chú, vì lỗi làm ô HSD 19.09.20 của bộ dữ liệu mới luôn 0 điểm): ngày có dấu chấm tận cùng 0 (vd 19.09.20) không còn bị cắt thành 19.09.2; giá trị chỉ gồm 0 và dấu chấm (vd `.0`) không còn thành mẫu rỗng khớp mọi text (`0.0` vốn đã chấm như số 0, có test giữ). (2) Chấm số còn dễ được điểm "ăn may": "0", "2" khớp mọi số đứng riêng; "7.0" khớp cả "7.5" (sau số được phép ".5"). Cân nhắc siết khi làm `ocr-a`. (3) 4 mã có `ingredients.jpg` trùng `nutrition.jpg` (8934588022111, 8935049501503, 8936028641487, 8936036029819): `run_ocr.py` đọc 2 lần; có thể bỏ trùng để tiết kiệm lượt. (4) Bộ có 96 ảnh, trần Google 60 lượt mỗi lần chạy → một lần chạy Google không đọc hết; phần dư ghi "bỏ qua theo luật chi phí" hoặc chia nhiều lần, tổng tháng ≤ 800. (5) Tên ghép nhiều khối chữ (vd "Mì khoai tây Omachi xốt Bò hầm") có thể khó đạt ngưỡng khớp 85 → đọc điểm cột `ten` có lưu ý.
- [ ] **E. Đợt `ocr-b`** (sau `ocr-a`): chạy `run_extract.py` với regex, dict, yake, underthesea, llm (llm chỉ qua Ollama, được tự cài Ollama + qwen2.5:7b nếu máy đủ chỗ) rồi `score_combo.py`; sửa luật regex/dict nếu trượt vì lỗi OCR lặp lại. Ghi chú: `run_extract.py` có `IMAGE_ORDER = ["front", "back", "date"]`, cần thêm `ingredients`, `nutrition` (tên ảnh mới từ đợt `anh-mang`, hiện bị xếp sau `date` khi ghép text). Ra `outputs/summary_combo.md` và đề xuất tổ hợp OCR + extractor cho app (miễn phí, chạy trên điện thoại).
- [ ] **F. Giai đoạn 3** (sau `ocr-b`): dùng kết quả `ocr-a` / `ocr-b` để chọn cách đọc hạn sử dụng từ ảnh (`tesseract.js`), rồi làm các mục giai đoạn 3 ở mục 2.
