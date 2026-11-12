# Máy chủ OCR R1 (server/)

Máy chủ nhỏ (FastAPI + uvicorn) chạy **RapidOCR R1** bằng Python, đúng cấu hình `r1-nocls` đã đo ở `test-ocr/ocr-mat`
(rapidocr 3.10.0, onnxruntime 1.31.1, PP-OCRv6 small det + rec của gói, **không cls**, inter_op 1, intra_op = `OCR_THREADS`).
Nhận 1 ảnh mặt trước bao bì, trả các khung chữ để T1 (tìm sản phẩm) dùng.

**KHÔNG thuộc app**: không nằm trong bản build GitHub Pages (`npm run build` không đụng tới `server/`), không thêm gì vào
`package.json` của app. **Chưa đưa lên Azure.** Đăng nhập: `AUTH_MODE=supabase` kiểm token Supabase (đợt `dang-nhap`,
mục "Đăng nhập" dưới đây); mặc định `off`.
**Dockerfile chưa build** (máy không có Docker), mới kiểm bằng đọc.

## Cài (Windows, mọi thứ ở ổ D)

Ổ C gần đầy: trước MỌI lệnh `pip` / `python` / `pytest` đặt cache và file tạm sang ổ D.

```powershell
$env:PIP_CACHE_DIR = "D:\tmp\may-chu-1\pip-cache"
$env:TEMP = "D:\tmp\may-chu-1\tmp"; $env:TMP = $env:TEMP
$env:HF_HOME = "D:\tmp\may-chu-1\hf"; $env:MODELSCOPE_CACHE = "D:\tmp\may-chu-1\ms"
py -3.12 -m venv D:\tmp\may-chu-1\venv
D:\tmp\may-chu-1\venv\Scripts\python -m pip install -r server\requirements.txt
D:\tmp\may-chu-1\venv\Scripts\python -m pip install -r server\requirements-dev.txt   # chỉ để test / đo
```

venv đã cài đủ cả hai file: ~321 MB. Model nằm sẵn trong wheel `rapidocr==3.10.0` (`site-packages\rapidocr\models\`),
không phải tải thêm.

### sha256 model (máy chủ kiểm lúc khởi động, Dockerfile kiểm lúc build)

| File | Byte | sha256 |
|---|---|---|
| `PP-OCRv6_det_small.onnx` | 9.929.594 | `090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f` |
| `PP-OCRv6_rec_small.onnx` | 21.234.383 | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` |

Trùng 2 file của `D:\tmp\ocr-mat\venv-rapid` (bộ đã đo 13 / 22 ở ocr-mat). Thiếu / sai mà `OCR_OFFLINE=1` thì máy chủ từ chối
khởi động với câu tiếng Việt (không tải lúc chạy).

## Chạy thử trên máy tính

```powershell
powershell -ExecutionPolicy Bypass -File server\chay-thu.ps1            # 127.0.0.1:8765, OCR_THREADS=8
powershell -ExecutionPolicy Bypass -File server\chay-thu.ps1 -Threads 1 # giống máy 1 vCPU
```

Có `server\.env` thì script đọc các dòng `KEY=VALUE` trước (bỏ dòng trống / `#`, bỏ BOM, bỏ dấu nháy bao ngoài), CHỈ đặt
biến chưa có trong môi trường, không in tên hay giá trị nào (chỉ in số biến đã đặt). `-NoEnvFile`: bỏ qua file;
`-EnvFile <đường dẫn>`: đọc file khác (vd chạy từ worktree: `-EnvFile D:\quet-ma-vach-full\server\.env`).
Sau đó `AUTH_MODE` vẫn trống thì đặt `off`, rồi in đúng 1 dòng `AUTH_MODE=<giá trị>` (không in biến nào khác). Script đặt
biến ổ D, `OCR_THREADS` (theo `-Threads`), `CORS_ALLOW_LOCALHOST=1`, rồi chạy
`uvicorn app:app --host 127.0.0.1 --port 8765 --workers 1 --no-access-log --no-proxy-headers --limit-concurrency 16`.
**Chỉ 127.0.0.1** (không 0.0.0.0, không mở ra mạng ngoài). Tắt: Ctrl+C. Kiểm đã tắt:
`Get-NetTCPConnection -LocalPort 8765 -State Listen` không ra gì.

Thử nhanh: `curl.exe -F "image=@D:\quet-ma-vach-full\test-ocr\photos\8934572260543\front.jpg" http://127.0.0.1:8765/ocr`

## Biến môi trường (mặc định ở `.env.example`, không có bí mật)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `OCR_THREADS` | 8 | luồng onnxruntime (intra_op); inter_op luôn 1 |
| `OCR_OFFLINE` | 0 | 1 = thiếu / sai model thì từ chối khởi động, không tải (Dockerfile bật) |
| `MAX_BYTES` | 5242880 | trần dung lượng ảnh (5 MB); thân yêu cầu được thêm 64 KB cho phần đầu multipart |
| `MAX_PIXELS` | 50000000 | trần điểm ảnh (rộng × cao) trước khi giải mã (50 MP: nhận ảnh 48 MP của điện thoại; đo RAM ở mục "RAM ảnh lớn") |
| `MAX_PIXELS_PROGRESSIVE` | 40000000 | trần RIÊNG cho JPEG nhiều lượt quét: progressive, hoặc lượt quét đầu ít màu hơn ảnh (kiểm từ phần đầu file, trước khi giải mã; quá -> 413). JPEG CMYK progressive 50 MP vượt 900 MB bộ nhớ riêng, 40 MP thì 822 MB (mục "RAM ảnh lớn") |
| `RATE_LIMIT_PER_MIN` | 20 | lượt `/ocr` mỗi IP trong 60 giây (cửa sổ trượt, trong RAM) |
| `RATE_LIMIT_MAX_IPS` | 10000 | số IP tối đa giữ trong RAM (dọn IP hết hạn, đầy thì bỏ IP cũ nhất) |
| `MAX_CONCURRENT` | 1 | số ảnh OCR cùng lúc |
| `QUEUE_MAX` | 4 | số yêu cầu giữ chỗ thêm (đang tải ảnh lên hoặc đang chờ); đầy -> 503 + `Retry-After`, chưa đọc thân ảnh |
| `BODY_TIMEOUT_S` | 30 | đọc thân ảnh tối đa bấy nhiêu giây (số thực > 0); quá -> 408, trả chỗ |
| `TRUST_PROXY` | 0 | 1 = lấy IP từ `X-Forwarded-For` (chỉ khi đứng sau proxy của mình) |
| `PROXY_COUNT` | 1 | lấy phần tử thứ `PROXY_COUNT` tính từ PHẢI của `X-Forwarded-For` (phần bên trái khách tự ghi được, không tin) |
| `AUTH_MODE` | off | `off` cho qua (chạy thử, test); `supabase` = `/ocr` phải có token đăng nhập Supabase (mục "Đăng nhập"), thiếu / sai `SUPABASE_URL` hoặc `SUPABASE_PUBLISHABLE_KEY` -> từ chối khởi động (câu lỗi chỉ nêu tên biến, không in giá trị); giá trị lạ -> từ chối khởi động |
| `SUPABASE_URL` | (trống) | Project URL `https://<ref>.supabase.co` (phải https) |
| `SUPABASE_PUBLISHABLE_KEY` | (trống) | publishable key: khóa CÔNG KHAI (app trên trình duyệt cũng có). Máy chủ KHÔNG dùng JWT secret / service_role |
| `RATE_LIMIT_USER_PER_MIN` | 10 | lượt `/ocr` mỗi người dùng (user id) trong 60 giây, cộng thêm với giới hạn theo IP |
| `RATE_LIMIT_MAX_USERS` | 10000 | số người dùng tối đa giữ trong RAM |
| `CORS_ALLOW_LOCALHOST` | 0 | 1 = cho thêm `http(s)://localhost` / `127.0.0.1` (mọi cổng) |

## API

### `GET /health`

```json
{ "ok": true, "modelLoaded": true, "engine": { "name": "rapidocr", "version": "3.10.0", "model": "PP-OCRv6 small det+rec, no cls" }, "version": "0.1.0" }
```

Không chạy OCR, không trả biến môi trường. Vẫn trả lời khi đang OCR (OCR chạy trong threadpool).

### `POST /ocr`

`multipart/form-data`, đúng 1 trường file tên `image` (JPEG / PNG / HEIC, nhận theo chữ ký nội dung, không theo đuôi
hay Content-Type). Trả:

```json
{
  "items": [
    { "text": "VISSAN",
      "poly": [[270.0, 251.0], [692.0, 249.0], [693.0, 340.0], [271.0, 342.0]],
      "score": 0.99996,
      "box": { "minX": 270.0, "minY": 249.0, "maxX": 693.0, "maxY": 342.0 },
      "conf": 0.99996 }
  ],
  "width": 947, "height": 1600, "origWidth": 2076, "origHeight": 3508,
  "ms": 1366.3, "msOcr": 1161.5,
  "engine": { "name": "rapidocr", "version": "3.10.0", "model": "PP-OCRv6 small det+rec, no cls" }
}
```

(khung đầu của ảnh `8934572260543`, OCR_THREADS=8; bản thật có 4 khung.)

- `items[]`: `text`, `poly` (nguyên 4 góc RapidOCR trả), `score` 0–1 = **đúng dạng phần tử `items` của PaddleOCR.js**, nên
  trang thử sau này gọi `t1.ocrItems([{ items }])` -> `rowLineInfo` -> `t1QueryFromLines` mà không đổi T1. Thêm `box`
  (min / max của poly, = `poly_to_box` của ocr-mat) và `conf` (= `norm_conf`) để chấm lại đúng cách của `ocr-mat`
  (`t1-ocr.mjs` đọc `{ text, conf, box }`). Ảnh không có chữ -> `items: []` (200, không lỗi).
- **Tọa độ theo ảnh SAU khi thu nhỏ** (cạnh dài 1.600 px, BICUBIC, như `fit_size` / `load_image` của ocr-mat và trang thử):
  `width` / `height` là cỡ ảnh đó; `origWidth` / `origHeight` là cỡ gốc sau khi xoay theo EXIF. Muốn vẽ lên ảnh gốc thì nhân
  `origWidth / width`.
- `ms`: tổng trên máy chủ (giải mã + thu nhỏ + OCR); `msOcr`: riêng OCR. Số là float thường, chữ UTF-8.

### Lỗi

Mọi lỗi trả JSON `{ "error": "<câu tiếng Việt>" }`, không kèm traceback.

| Mã | Khi nào |
|---|---|
| 400 | không phải multipart, thiếu trường `image`, ảnh rỗng, 2 file trở lên, multipart hỏng / chưa trọn; khách ngắt kết nối giữa chừng (1 dòng log, không traceback) |
| 408 | gửi thân ảnh quá `BODY_TIMEOUT_S` giây (mạng quá chậm / gửi treo) |
| 413 | ảnh > 5 MB (Content-Length khai lớn -> từ chối trước khi đọc; thân thật vượt -> dừng đọc ngay), quá `MAX_PIXELS`, JPEG nhiều lượt quét quá `MAX_PIXELS_PROGRESSIVE`, bom điểm ảnh của Pillow |
| 415 | không phải JPEG / PNG / HEIC (vd file chữ đặt đuôi .jpg), ảnh hỏng; HEIC khi không có pi-heif |
| 422 | yêu cầu không hợp lệ khác |
| 401 | (`AUTH_MODE=supabase`) thiếu token, token sai / hết hạn / alg không nhận; có `WWW-Authenticate: Bearer` |
| 429 | quá `RATE_LIMIT_PER_MIN` lượt / phút / IP, hoặc quá `RATE_LIMIT_USER_PER_MIN` lượt / phút / người dùng; có `Retry-After` |
| 500 | lỗi lạ trong lúc xử lý ảnh (JSON "Lỗi máy chủ, thử lại sau.", có CORS, log chỉ tên lỗi); lỗi lạ trong lúc kiểm token ("Lỗi khi kiểm đăng nhập trên máy chủ.", có CORS, log chỉ tên lỗi, không bao giờ cho qua); cấu hình đăng nhập sai lọt qua bước khởi động ("Cấu hình đăng nhập sai trên máy chủ.", không bao giờ cho qua) |
| 503 | hàng đợi đầy, chưa nạp xong model, hoặc (`AUTH_MODE=supabase`) chưa kiểm được token vì Supabase lỗi / không trả lời; có `Retry-After` (JSON, có CORS). Riêng khi quá 16 kết nối cùng lúc (`--limit-concurrency 16`) thì chính uvicorn trả 503 dạng chữ `Service Unavailable`, KHÔNG có CORS (trang trên github.io chỉ thấy "lỗi mạng") |

## Đăng nhập (`AUTH_MODE=supabase`, đợt `dang-nhap`)

Mục đích: chống dùng chùa máy chủ OCR. App đăng nhập Google qua Supabase rồi gửi access token trong header
`Authorization: Bearer <token>`; máy chủ kiểm token, không lưu gì về người dùng (không email, không token trong log).

**Bật**: điền `server/.env` (chép từ `.env.example`): `AUTH_MODE=supabase`, `SUPABASE_URL=https://<ref>.supabase.co`,
`SUPABASE_PUBLISHABLE_KEY=<publishable key>` (khóa công khai, lấy ở Supabase → Project Settings → API Keys). Rồi chạy
`server\chay-thu.ps1` như trên. Thiếu / sai 1 trong 2 biến thì máy chủ không khởi động (câu lỗi chỉ nêu tên biến).
Dán nhầm khóa BÍ MẬT vào `SUPABASE_PUBLISHABLE_KEY` (tiền tố `sb_secret_`, hoặc JWT có `role = service_role`) cũng không
khởi động (app trên trình duyệt cũng bỏ qua đăng nhập với khóa như vậy); khi đó đổi khóa bí mật đó trên Supabase.
Phía app: biến `VITE_*` trong `.env` hoặc GitHub Variables mà chứa khóa bí mật thì `npm run dev` / `npm run build` dừng
với lỗi chỉ nêu tên biến (plugin `qmv-chan-khoa-bi-mat` trong `vite.config.js`), nên GitHub Actions không deploy khóa đó.

Lưu ý khi dùng `server\.env` với `chay-thu.ps1`:
- Script in `AUTH_MODE=<giá trị>` lúc chạy: thấy `off` mà định bật đăng nhập thì kiểm lại `-EnvFile` (chạy từ worktree
  thì file `.env` nằm ở thư mục chính).
- Dòng `KEY=` (giá trị rỗng) vẫn được đếm là "biến mới" và đặt biến rỗng (máy chủ coi rỗng như chưa điền).
- `OCR_THREADS` và `CORS_ALLOW_LOCALHOST` do script tự đặt SAU khi đọc file (theo tham số `-Threads`, và luôn 1), nên ghi
  trong `.env` không có tác dụng: đổi bằng tham số script.

**Chủ dự án tự kiểm với project thật** (máy không làm thay vì không được đọc `server\.env`), chạy từ thư mục chính
`D:\quet-ma-vach-full` sau khi `main` đã có đợt `dang-nhap`:
0. Cập nhật thư mục chính (chạy ở `D:\quet-ma-vach-full`).
   Tắt npm run dev / máy chủ đang chạy ở thư mục chính (Ctrl+C) trước khi chạy npm ci (npm ci xóa node_modules,
   Windows khóa file nếu đang chạy).
   Chạy từng dòng; dòng nào báo lỗi thì dừng, không chạy dòng sau:
   ```
   git switch main
   git pull --ff-only
   git log -5 --oneline
   npm ci
   D:\tmp\may-chu-1\venv\Scripts\python -m pip install -r server\requirements.txt
   ```
   Lệnh `git log -5 --oneline`: trong 5 dòng phải thấy commit của đợt dang-nhap (vd "docs(dang-nhap): …"); nếu main đã có đợt mới hơn thì dùng `git log --oneline --grep dang-nhap -1`.
   (thư mục chính không tự cập nhật khi nhánh lên `origin/main`; `node_modules` ở đó chưa có `@supabase/supabase-js`;
   venv chưa có PyJWT / cryptography).
   Kiểm Supabase → Authentication → URL Configuration → Redirect URLs có `https://localhost:5173/` (thiếu thì Supabase
   đưa về trang Pages, bước 3 thất bại).
1. `powershell -ExecutionPolicy Bypass -File server\chay-thu.ps1` → thấy `AUTH_MODE=supabase` và 1 dòng log
   `JWKS: n khóa (…)` (ghi lại n và alg: ES256 / RS256, hay "project dùng HS256").
2. Cửa sổ khác: `curl.exe -i -F "image=@test-ocr\photos\8934572260543\front.jpg" http://127.0.0.1:8765/ocr` → **401**
   (không token); thêm `-H "Authorization: Bearer abc"` → **401**.
3. `npm run dev`, mở `https://localhost:5173`, đăng nhập Google (email trong danh sách thử), dùng khu "Thử máy chủ OCR
   (chỉ khi chạy dev)" ở cuối trang chọn 1 ảnh → **200** + chữ. Đăng xuất rồi thử lại → khu thử ẩn.
4. Tắt cả hai (Ctrl+C), kiểm cổng 8765 / 5173 đã đóng.
Lúc khởi động máy chủ tải JWKS 1 lần và ghi 1 dòng log `JWKS: n khóa (ES256 …)` (không có địa chỉ); tải lỗi thì vẫn
khởi động, yêu cầu cần JWKS sẽ nhận 503 tới khi tải được. KHÔNG cần (và không bao giờ đọc) JWT secret / service_role.

**Hai đường kiểm** (chọn theo `alg` trong phần đầu token, đọc chưa kiểm, chỉ để chọn đường):

| alg của token | Cách kiểm |
|---|---|
| `ES256`, `RS256` (có `kid`) | Kiểm chữ ký **tại máy** bằng khóa công khai JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, urllib, hạn giờ 5 giây, đọc tối đa 64 KB, giữ trong RAM 10 phút). Thuật toán lấy THEO KHÓA (`kty` / `crv` / `alg` của JWK: EC P-256 -> ES256, RSA -> RS256; khóa `oct` không bao giờ dùng), phải trùng `alg` của token. Bắt buộc `exp`, `sub`, `aud = authenticated`, `iss = <SUPABASE_URL>/auth/v1`, lệch giờ tối đa 30 giây; `is_anonymous = true` -> 401. `kid` lạ -> tải lại JWKS tối đa 1 lần mỗi 60 giây (có khóa, nhiều yêu cầu cùng lúc chỉ tải 1 lần), vẫn không có -> 401 |
| `HS256` (project còn dùng khóa đối xứng cũ) | Máy chủ không có secret nên hỏi Supabase `GET /auth/v1/user` (header `apikey` = publishable key, hạn giờ 5 giây). 200 + có `id` -> hợp lệ, user id lấy TỪ PHẢN HỒI; 401 / 403 -> 401. Kết quả hợp lệ lưu tạm trong RAM: khóa = sha256(token), hạn = min(60 giây, `exp` của token), tối đa 1.000 mục; kết quả sai không lưu |
| khác (`none`, `HS384`, `HS512`, `PS*`, lạ) | 401 ngay, không gọi mạng |

- **401** (`WWW-Authenticate: Bearer`): thiếu header, không phải `Bearer <token>`, token dài hơn 4.096 ký tự / không đủ 3
  phần, chữ ký sai, hết hạn, sai `iss` / `aud`, thiếu `sub`, tài khoản ẩn danh.
- **429**: quá `RATE_LIMIT_USER_PER_MIN` (mặc định 10) ảnh / phút cho MỘT người dùng (đếm theo user id, độc lập với IP;
  giới hạn theo IP vẫn chạy trước).
- **503** (`Retry-After: 5`): tải JWKS lỗi mạng / 5xx / JSON hỏng, hoặc `/auth/v1/user` trả 429 / 5xx / lỗi mạng / hết
  giờ. **Không bao giờ cho qua khi chưa kiểm được.** Tải JWKS lỗi thì 5 giây sau mới thử lại (giữa chừng trả 503 ngay).
- **Thứ tự**: giới hạn IP -> kiểm token -> giới hạn người dùng -> model đã nạp -> hàng đợi -> đọc ảnh. IP trước để token rác
  gửi dồn dập không làm máy chủ gọi Supabase liên tục; token sai không bị tính vào lượt của người dùng.
- Gọi mạng (JWKS, `/user`) chạy trong threadpool, không chặn vòng sự kiện.
- **Giới hạn đã biết**: token đã đăng xuất (hoặc tài khoản bị xoá) VẪN qua tới khi token hết hạn (~1 giờ, mặc định của
  Supabase) với đường JWKS, vì kiểm tại máy không hỏi Supabase; đường `/user` thì chậm tối đa 60 giây (lưu tạm).
- Test: `tests/test_auth.py` (khóa ES256 / RS256 tự sinh, JWKS / `/user` giả, đồng hồ giả, 4 test urllib thật với
  `http.server` trên 127.0.0.1: tải được, hết giờ, JWKS trả 302 không đi theo, JWKS > 64 KB; không test nào gọi Internet).

## Giới hạn và an toàn

- 5 MB / ảnh, 50 MP (JPEG nhiều lượt quét 40 MP), 20 ảnh / phút / IP (+ 10 ảnh / phút / người dùng khi `AUTH_MODE=supabase`), 1 ảnh OCR cùng lúc + hàng đợi 4, đọc thân ảnh tối đa 30 giây.
- **Thứ tự trong `/ocr`**: giới hạn lượt theo IP -> kiểm token (chỉ `AUTH_MODE=supabase`) -> giới hạn lượt theo người
  dùng (chỉ `supabase`) -> (model đã nạp?) -> **giành chỗ** trong hàng đợi (tối đa
  `MAX_CONCURRENT + QUEUE_MAX` = 5 chỗ; đầy -> 503 ngay, CHƯA đọc byte thân nào) -> đọc thân ảnh (tối đa `BODY_TIMEOUT_S`
  giây, quá -> 408) -> chờ khóa OCR -> OCR. Mọi đường ra (400 / 408 / 413 / 415 / ngắt kết nối / huỷ / 500) trả chỗ đúng
  1 lần (`try/finally`, `ratelimit.Slot.release`). Vì vậy RAM cho ảnh đang nhận có trần: tối đa 5 ảnh × 5 MB, dù gửi
  song song hay gửi thật chậm. Ảnh nhận về giữ nguyên `bytearray` (không chép sang `bytes`); lúc giải mã Pillow đọc qua
  `io.BytesIO` (chép thêm 1 bản ≤ 5 MB, chỉ 1 ảnh mỗi lúc vì giải mã nằm trong khóa OCR).
- **uvicorn `--limit-concurrency 16`** (cả 3 lệnh chạy): quá 16 kết nối / yêu cầu cùng lúc thì uvicorn tự trả 503 dạng
  chữ, không CORS. Lớp chặn thô phía trước hàng đợi của app.
- OCR chạy trong threadpool, không huỷ được giữa chừng: khách ngắt khi đang OCR thì OCR vẫn chạy tới xong rồi mới nhả khóa
  (cố ý: không bao giờ 2 ảnh OCR cùng lúc). Ghi chú ở `ratelimit.py`.
- **Không file tạm**: không dùng `request.form()` của Starlette (nó đặt file vào `SpooledTemporaryFile` 1 MB rồi ghi ra đĩa
  và đọc hết thân rồi mới trả), mà tách multipart theo luồng bằng `MultipartParser` của python-multipart, giữ ảnh trong RAM,
  đếm byte theo khúc (`upload.py`). Không ghi ảnh ra đĩa ở đâu cả.
- **IP cho giới hạn lượt**: cả 3 lệnh chạy uvicorn (`chay-thu.ps1`, `Dockerfile`, `do-30-anh.mjs`) có `--no-proxy-headers`.
  Thiếu cờ này, uvicorn mặc định tin `127.0.0.1` và tự thay IP bằng `X-Forwarded-For` trước khi app thấy, nên ai gửi từ
  localhost kèm `X-Forwarded-For` khác nhau mỗi lần là lách được giới hạn lượt (đã thử: 3 lần đều 200). Với cờ này,
  `TRUST_PROXY` của app là công tắc DUY NHẤT để dùng `X-Forwarded-For`. Test: `tests/test_uvicorn.py` (chạy uvicorn thật).
- **CORS**: chỉ khớp chính xác `https://khangnguyen196.github.io` (+ localhost khi `CORS_ALLOW_LOCALHOST=1`); origin lạ / `null`
  không có `Access-Control-Allow-Origin`; không credentials; GET, POST, OPTIONS; header Content-Type, Authorization;
  `Access-Control-Expose-Headers: Retry-After` (trang github.io đọc được số giây chờ của 429 / 503).
- **Log**: tắt access log của uvicorn (có IP). Log riêng chỉ có thời gian, phương thức, đường dẫn, mã, số byte, số khung chữ, giây.
  Không IP, không tên file, không chữ OCR. Lỗi lạ trong lúc OCR: `/ocr` tự bắt, log 1 dòng "lỗi máy chủ: <tên lỗi>" (không
  chi tiết), trả 500 JSON CÓ header CORS (trang trên github.io đọc được câu lỗi). Riêng lỗi 500 lạ ở chỗ khác (ngoài phần
  `/ocr` đã bọc) đi qua bộ xử lý lỗi chung của Starlette: khách vẫn nhận JSON không traceback, nhưng log `uvicorn.error`
  trên máy chủ CÓ THỂ in traceback (không có IP, không ra ngoài; chỉ người xem log máy chủ thấy).
- **HEIC**: dùng `pi-heif` (chỉ đọc; libheif + libde265, LGPLv3), không dùng `pillow-heif` (kèm x265, GPL). Chi tiết `LICENSES.md`.
  Đã thử với 2 ảnh HEIC TỰ VẼ 64 × 48 (`tests/fixtures/khong-xoay.heic`, `xoay6.heic` có orientation 6 / hộp irot):
  `/ocr` trả 200, cỡ đã xoay (48 × 64) đọc được trước khi giải mã, xoay đúng 1 lần (`tests/test_heic.py`).
  **Chưa thử với ảnh iPhone thật** (ảnh thật có thể có lưới ô / ảnh phụ / HDR mà ảnh tự vẽ không có).
- Không có khóa / token / mật khẩu nào trong code.

## Test

```powershell
cd server
D:\tmp\may-chu-1\venv\Scripts\python -m pytest -q --basetemp D:\tmp\may-chu-1\pytest-tmp              # engine giả + uvicorn thật (319 test)
D:\tmp\may-chu-1\venv\Scripts\python -m pytest -q -m real_model --basetemp D:\tmp\may-chu-1\pytest-tmp # model thật (2 test)
```

(nhớ đặt biến ổ D ở mục Cài.) Lượt thường bỏ test `real_model` (pytest in "2 deselected", không skip ẩn); thiếu model thì
test `real_model` FAIL.

- `tests/test_uvicorn.py` chạy uvicorn THẬT trong luồng nền (127.0.0.1, cổng trống ngẫu nhiên, hạn giờ 10 giây, tắt trong
  `finally`, kiểm cổng đã đóng). `tests/test_gate.py` gọi ASGI thô để điều khiển từng khúc thân yêu cầu (gửi treo, ngắt
  giữa chừng); mọi lời gọi bọc `asyncio.wait_for`.
- Ảnh HEIC test (`tests/fixtures/*.heic`, tự vẽ, < 2 KB mỗi ảnh) tạo một lần bằng venv TẠM có `pillow-heif` (KHÔNG vào
  requirements, không phân phối; máy chủ chỉ dùng `pi-heif` để đọc):

```powershell
py -3.12 -m venv D:\tmp\may-chu-1\venv-heic-tao
D:\tmp\may-chu-1\venv-heic-tao\Scripts\python -m pip install pillow-heif   # 12/11/2026: pillow_heif 1.8.1
D:\tmp\may-chu-1\venv-heic-tao\Scripts\python server\tests\fixtures\tao_heic.py
```

## Đo 30 ảnh

```powershell
node server\do-30-anh.mjs --threads 8 --name may-chu-t8
node server\do-30-anh.mjs --threads 1 --name may-chu-t1
```

Công cụ tự bật uvicorn trên 127.0.0.1:8765 (cổng phải đang trống), gửi tuần tự 30 ảnh `front.jpg` (mã của `truth.csv` có
ảnh, thứ tự `truth.csv`), rồi TẮT máy chủ (kể cả khi lỗi) và in cổng còn nghe hay không. Trong lượt đo đặt
`RATE_LIMIT_PER_MIN=1000` (30 ảnh liền nhau chạm trần 20 / phút). RAM đỉnh đo bằng `do_rss.py` (psutil): RSS lấy mẫu mỗi
0,2 giây, cộng `peak_wset` (Windows, đỉnh thật không hụt vì lấy mẫu), `peak_pagefile` (Windows, bộ nhớ riêng đã cấp) và
`VmHWM` (Linux); cộng cả tiến trình con (python.exe của venv trên Windows chỉ là tiến trình mồi).
Chấm 2 đường: (A) như ocr-mat (`t1-ocr.mjs`: `{ text, conf, box }`), (B) như trang thử (`public/chup-mat-do/t1.mjs` trên
`poly` / `score`, danh mục `public/chup-mat-do/danh-muc-vn.json`). So từng khung với `D:\tmp\ocr-mat\ocr\r1-nocls-v4`
(chữ trùng, box ≤ 0,5 px, conf ≤ 1e-4) và câu tìm + top5 với `D:\tmp\ocr-mat\ket-qua\r1-nocls-v4.json`.
Kết quả ở `D:\tmp\may-chu-1\ket-qua\` (không commit); số đã đo ghi ở `PLAN.md` mục 8 (đợt may-chu-1).

## RAM ảnh lớn (`MAX_PIXELS`)

Giải mã (`imaging.decode`) giữ ĐÚNG điểm ảnh như chuỗi cũ `exif_transpose(img).convert("RGB")` rồi thu BICUBIC (test
`tests/test_imaging.py` so từng byte ở mode RGB / RGBA / L / P / CMYK, hướng EXIF 1..8), nhưng ít bản chép hơn: đổi màu
trước và chỉ khi `mode != "RGB"`, rồi xoay tại chỗ (`exif_transpose(..., in_place=True)`; không có tag xoay thì không chép).
Pillow giữ ảnh RGB / CMYK 4 byte / điểm, nên ảnh 50 MP ~191 MB mỗi bản: mã cũ tới 3 bản cùng lúc, mã mới 1 bản (không xoay)
hoặc 2 bản trong lúc xoay.

Đo bằng `do-anh-lon.py` (12/11/2026, Windows 10, máy 8 GB đang chạy app khác, Python 3.12, venv như trên): 4 ảnh tổng hợp
8000 × 6250 = 50 MP (JPEG RGB không xoay 1,05 MB; JPEG RGB orientation 6 1,05 MB; JPEG CMYK orientation 6 2,71 MB; PNG RGB
0,15 MB), mỗi ảnh / mỗi số luồng 1 lệnh, mỗi lệnh 2 lần (mỗi lần 1 máy chủ mới: 1 ảnh khởi động `front.jpg` rồi đúng 1 ảnh
lớn), ghi số lớn nhất. MB = MiB. **peak_wset** = đỉnh working set thật do Windows ghi (không hụt vì lấy mẫu); **RSS đỉnh** =
lấy mẫu mỗi 0,05 giây; **riêng đỉnh** = `peak_pagefile` (bộ nhớ riêng đã cấp, gồm cả phần onnxruntime giữ chỗ mà chưa dùng,
nên luôn cao hơn; ~540 MB ngay sau ảnh khởi động).

| Ảnh 50 MP | Luồng | Mã cũ (d14346d, 60 MP): peak_wset / RSS đỉnh / riêng đỉnh | Mã mới (50 MP): peak_wset / RSS đỉnh / riêng đỉnh |
|---|---|---|---|
| JPEG RGB | 1 | 737 / 642 / 930 | 441 / 395 / 635 |
| JPEG RGB xoay 6 | 1 | 737 / 616 / 930 | 548 / 531 / 740 |
| JPEG CMYK xoay 6 | 1 | 739 / 709 / 932 | 548 / 539 / 740 |
| PNG RGB | 1 | 735 / 697 / 928 | 440 / 435 / 633 |
| JPEG RGB | 8 | 740 / 712 / 933 | 444 / 443 / 638 |
| JPEG RGB xoay 6 | 8 | 740 / 674 / 933 | 551 / 539 / 743 |
| JPEG CMYK xoay 6 | 8 | 743 / 699 / 936 | 552 / 551 / 745 |
| PNG RGB | 8 | 738 / 716 / 932 | 444 / 402 / 638 |

Mọi lần đều HTTP 200.

**Vòng 3: ảnh có thể nặng hơn** (đo cùng cách, 12/11/2026, lúc đo máy còn ~1,5 GB RAM trống). JPEG progressive buộc
libjpeg giữ hệ số DCT của cả ảnh lúc giải mã (2 byte / điểm / kênh), cộng thêm vào ảnh đã giải mã. Ảnh: JPEG RGB
progressive 4:4:4 orientation 6 (1,10 MB), JPEG CMYK progressive orientation 6 (1,31 MB), cả hai 8000 × 6250 = 50 MP;
HEIC 8000 × 6000 = 48 MP orientation 6 (0,86 MB, hộp irot; tạo bằng `do-anh-lon.py tao --heic` trong venv tạm có
pillow-heif, rồi xoá venv). Cột "giây" = phía khách / phía máy chủ (giải mã + thu nhỏ + OCR) / riêng OCR.

| Ảnh | Luồng | Mã chưa có trần riêng: peak_wset / RSS đỉnh / riêng đỉnh | HTTP | giây |
|---|---|---|---|---|
| JPEG CMYK progressive xoay 6, 50 MP | 1 | 738 / 698 / 931 | 200 | 6,1 / 6,1 / 4,3 |
| JPEG CMYK progressive xoay 6, 50 MP | 8 | **743 / 705 / 936** | 200 | 3,6 / 3,6 / 1,8 |
| JPEG CMYK progressive, 50 MP, sau 5 ảnh `front.jpg` thật | 8 | 741 / 696 / 934 | 200 | 3,5 / 3,5 / 1,6 |
| JPEG RGB progressive 4:4:4 xoay 6, 50 MP | 1 | 642 / 635 / 835 | 200 | 5,5 / 5,5 / 4,3 |
| JPEG RGB progressive 4:4:4 xoay 6, 50 MP | 8 | 647 / 594 / 840 | 200 | 3,0 / 2,9 / 1,8 |
| HEIC xoay 6, 48 MP | 1 | 498 / 490 / 689 | 200 | 6,4 / 6,4 / 4,2 |
| HEIC xoay 6, 48 MP | 8 | 503 / 408 / 694 | 200 | 4,0 / 4,0 / 1,8 |
| JPEG CMYK progressive xoay 6, 40 MP (8000 × 5000) | 1 | 625 / 617 / 818 | 200 | 6,5 / 6,4 / 4,7 |
| JPEG CMYK progressive xoay 6, 40 MP | 8 | 629 / 609 / 822 | 200 | 3,0 / 3,0 / 1,5 |
| JPEG CMYK progressive xoay 6, 30 MP (7500 × 4000) | 8 | 513 / 490 / 705 | 200 | 2,5 / 2,5 / 1,4 |

JPEG CMYK progressive 50 MP vượt 900 MB bộ nhớ riêng, nên có **trần riêng `MAX_PIXELS_PROGRESSIVE` = 40 MP** (mức lớn
nhất trong 40 / 30 MP đạt cả hai ngưỡng: riêng < 900 MB và peak_wset < 800 MB). `imaging.decode` kiểm cỡ + cờ progressive
của Pillow (đọc từ phần đầu file) TRƯỚC `img.load()`; quá -> 413 "Ảnh JPEG progressive quá nhiều điểm ảnh…" (test
`tests/test_progressive.py`, có kiểm `load()` không được gọi). Trên mã cuối: 2 ảnh progressive 50 MP -> 413 sau 0,1 giây,
RAM giữ như sau ảnh khởi động (349 / 543 MB); CMYK progressive 40 MP vẫn 200 (626 / 819 MB). JPEG thường, PNG, HEIC giữ
`MAX_PIXELS` = 50 MP (JPEG thường 50 MP riêng 745 MB, không sát ngưỡng nên không hạ trần chung).

**Vòng 4: JPEG nhiều lượt quét không progressive.** JPEG SOF0 / SOF1 mà lượt quét đầu (SOS) chứa ít màu hơn ảnh
(mỗi màu một lượt, "non-interleaved") cũng bị libjpeg coi là nhiều lượt quét (`has_multiple_scans`) và giữ hệ số DCT của
cả ảnh như progressive, nhưng Pillow không đặt cờ progressive cho loại này (CMYK loại này 50 MP ước ~936 MB riêng, RGB
~840 MB; chưa đo vì máy không có `jpegtran` / `cjpeg`). Nên trần riêng áp cho mọi JPEG **nhiều lượt quét**: cờ progressive
HOẶC số màu của lượt quét đầu (byte Ns của SOS đầu tiên, dò bằng `_jpeg_first_scan_components`) nhỏ hơn số màu của ảnh
(`img.layers` = byte Nf của SOF) HOẶC dò không được (an toàn trước). Chỉ dò khi ảnh vượt trần riêng. Câu 413 mới: "Ảnh này
quá nhiều điểm ảnh cho máy chủ (loại JPEG này tối đa 40.000.000 điểm). Hãy chụp lại bằng camera hoặc chọn ảnh nhỏ hơn."
Bị chặn trước `load()` (test byte tự ghép trong `tests/test_progressive.py`). 208 ảnh JPEG có sẵn (ảnh đo + ảnh
`test-ocr`) đều interleaved hoặc progressive, không ảnh thường nào bị chặn nhầm.

**Biên an toàn** (mã cuối; MB ở đây là MiB, chia 1024²). Trần: JPEG nhiều lượt quét (progressive, hoặc lượt quét đầu ít
màu hơn ảnh) tối đa 40 MP; các loại khác (JPEG thường, PNG, HEIC) 50 MP.
- Ca nặng nhất được nhận: JPEG nhiều lượt quét tới 40 MP, đo bằng JPEG CMYK progressive 40 MP (8 luồng) peak_wset 629 MB,
  bộ nhớ riêng 822 MB. JPEG không progressive nhưng nhiều lượt quét ở 40 MP chưa đo, ước tương đương.
- 78 MB (900 − 822) chỉ là biên so với ngưỡng 900 MB đặt cho đợt này, **chưa phải biên trên B1s**: riêng 30 ảnh thật
  (lượt `may-chu-t8-v3`) đã peak_wset 549 MB (riêng 743 MB), mà B1s 1 GiB còn phải chứa hệ điều hành + Docker (chưa đo).
  Đo trên Windows 10 máy 8 GB; **Linux / B1s chưa đo** (`do_rss.py` ghi thêm `VmHWM` khi chạy trên Linux).
- Khuyến nghị lần đầu lên B1s: `MAX_PIXELS=24000000`, `MAX_PIXELS_PROGRESSIVE=20000000`, bật swap, đo `VmHWM`, rồi mới
  nâng dần. Ảnh vẫn được thu về 1.600 px nên trần thấp không làm giảm chất lượng đọc chữ, chỉ từ chối ảnh quá to.
- Loại ảnh đã đo: JPEG baseline RGB/CMYK, JPEG progressive RGB 4:4:4/CMYK, PNG RGB, HEIC 48 MP (ảnh tự vẽ). Chưa đo: PNG
  RGBA / LA / 16 bit 50 MP (ước như JPEG CMYK baseline, khoảng 745 MB riêng), PNG interlaced, JPEG nhiều lượt quét không
  progressive, HEIC iPhone thật.

```powershell
D:\tmp\may-chu-1\venv\Scripts\python server\do-anh-lon.py tao     # tạo ảnh JPEG / PNG ở D:\tmp\may-chu-1\anh-lon (không commit)
# HEIC 48 MP: venv tạm có pillow-heif (như mục Test), rồi: D:\tmp\may-chu-1\venv-heic-tao\Scripts\python server\do-anh-lon.py tao --heic
# --real-before 5: gửi 5 ảnh front.jpg thật trước ảnh lớn
D:\tmp\may-chu-1\venv\Scripts\python server\do-anh-lon.py do --image jpeg-cmyk-xoay6 --threads 8 --out D:\tmp\may-chu-1\ket-qua\anh-lon\moi-t8-jpeg-cmyk-xoay6.json
# đo mã cũ: --code-dir <thư mục server/ của commit cũ, chép bằng git archive ra D:\tmp> (không checkout trong worktree)
```

## Docker (để sau, chưa build)

`Dockerfile`: `python:3.12-slim`, `pip install --no-cache-dir -r requirements.txt`, bước build kiểm sha256 model, chuyển
sang người dùng không phải root `ocr` rồi MỚI nạp thử RapidOCR với `OCR_OFFLINE=1` (chứng minh người dùng chạy thật đọc
được model), `OCR_OFFLINE=1`, `CORS_ALLOW_LOCALHOST=0`, `OCR_THREADS=1` (B1s 1 vCPU), `MAX_PIXELS=50000000`, `MAX_PIXELS_PROGRESSIVE=40000000`,
`BODY_TIMEOUT_S=30`, `HEALTHCHECK` gọi `/health` bằng Python urllib (hạn 3 giây, cần `"ok": true`; test
`test_healthcheck_cua_dockerfile_chay_duoc_voi_may_chu_that` chạy đúng câu lệnh đó với uvicorn thật), uvicorn 1 worker
`--no-access-log --no-proxy-headers --limit-concurrency 16`. Host `0.0.0.0` **chỉ trong container**; trên máy tính dùng
`chay-thu.ps1` (127.0.0.1). `.dockerignore` bỏ venv, tests, `__pycache__`, `.env*`, công cụ đo, `*.md` trừ `LICENSES.md`
(được chép vào image).

## Giấy phép

Xem `LICENSES.md` (từng gói theo metadata đã cài + model PP-OCRv6 Apache-2.0).
