# Máy chủ OCR R1 (server/)

Máy chủ nhỏ (FastAPI + uvicorn) chạy **RapidOCR R1** bằng Python, đúng cấu hình `r1-nocls` đã đo ở `test-ocr/ocr-mat`
(rapidocr 3.10.0, onnxruntime 1.31.1, PP-OCRv6 small det + rec của gói, **không cls**, inter_op 1, intra_op = `OCR_THREADS`).
Nhận 1 ảnh mặt trước bao bì, trả các khung chữ để T1 (tìm sản phẩm) dùng.

**KHÔNG thuộc app**: không nằm trong bản build GitHub Pages (`npm run build` không đụng tới `server/`), không thêm gì vào
`package.json` của app. **Chưa đưa lên Azure, chưa có đăng nhập** (`AUTH_MODE=supabase` làm ở đợt `dang-nhap`).
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

Script đặt biến ổ D, `CORS_ALLOW_LOCALHOST=1`, rồi chạy `uvicorn app:app --host 127.0.0.1 --port 8765 --workers 1 --no-access-log`.
**Chỉ 127.0.0.1** (không 0.0.0.0, không mở ra mạng ngoài). Tắt: Ctrl+C. Kiểm đã tắt:
`Get-NetTCPConnection -LocalPort 8765 -State Listen` không ra gì.

Thử nhanh: `curl.exe -F "image=@D:\quet-ma-vach-full\test-ocr\photos\8934572260543\front.jpg" http://127.0.0.1:8765/ocr`

## Biến môi trường (mặc định ở `.env.example`, không có bí mật)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `OCR_THREADS` | 8 | luồng onnxruntime (intra_op); inter_op luôn 1 |
| `OCR_OFFLINE` | 0 | 1 = thiếu / sai model thì từ chối khởi động, không tải (Dockerfile bật) |
| `MAX_BYTES` | 5242880 | trần dung lượng ảnh (5 MB); thân yêu cầu được thêm 64 KB cho phần đầu multipart |
| `MAX_PIXELS` | 60000000 | trần điểm ảnh (rộng × cao) trước khi giải mã |
| `RATE_LIMIT_PER_MIN` | 20 | lượt `/ocr` mỗi IP trong 60 giây (cửa sổ trượt, trong RAM) |
| `RATE_LIMIT_MAX_IPS` | 10000 | số IP tối đa giữ trong RAM (dọn IP hết hạn, đầy thì bỏ IP cũ nhất) |
| `MAX_CONCURRENT` | 1 | số ảnh OCR cùng lúc |
| `QUEUE_MAX` | 4 | số yêu cầu chờ thêm; đầy -> 503 + `Retry-After` |
| `TRUST_PROXY` | 0 | 1 = lấy IP từ `X-Forwarded-For` (chỉ khi đứng sau proxy của mình) |
| `PROXY_COUNT` | 1 | lấy phần tử thứ `PROXY_COUNT` tính từ PHẢI của `X-Forwarded-For` (phần bên trái khách tự ghi được, không tin) |
| `AUTH_MODE` | off | `off` cho qua; `supabase` chưa làm -> từ chối khởi động ("chưa cài đặt, làm ở đợt dang-nhap"); giá trị lạ -> từ chối khởi động |
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
| 400 | không phải multipart, thiếu trường `image`, ảnh rỗng, 2 file trở lên, multipart hỏng / chưa trọn |
| 413 | ảnh > 5 MB (Content-Length khai lớn -> từ chối trước khi đọc; thân thật vượt -> dừng đọc ngay), quá `MAX_PIXELS`, bom điểm ảnh của Pillow |
| 415 | không phải JPEG / PNG / HEIC (vd file chữ đặt đuôi .jpg), ảnh hỏng; HEIC khi không có pi-heif |
| 422 | yêu cầu không hợp lệ khác |
| 429 | quá `RATE_LIMIT_PER_MIN` lượt / phút / IP, có `Retry-After` |
| 501 | `AUTH_MODE=supabase` lọt vào hàm kiểm (bình thường đã từ chối khởi động) |
| 503 | hàng đợi đầy hoặc chưa nạp xong model, có `Retry-After` |

## Giới hạn và an toàn

- 5 MB / ảnh, 60 MP, 20 ảnh / phút / IP, 1 ảnh OCR cùng lúc + hàng đợi 4.
- **Không file tạm**: không dùng `request.form()` của Starlette (nó đặt file vào `SpooledTemporaryFile` 1 MB rồi ghi ra đĩa
  và đọc hết thân rồi mới trả), mà tách multipart theo luồng bằng `MultipartParser` của python-multipart, giữ ảnh trong RAM,
  đếm byte theo khúc (`upload.py`). Không ghi ảnh ra đĩa ở đâu cả.
- **CORS**: chỉ khớp chính xác `https://khangnguyen196.github.io` (+ localhost khi `CORS_ALLOW_LOCALHOST=1`); origin lạ / `null`
  không có `Access-Control-Allow-Origin`; không credentials; GET, POST, OPTIONS; header Content-Type, Authorization.
- **Log**: tắt access log của uvicorn (có IP). Log riêng chỉ có thời gian, phương thức, đường dẫn, mã, số byte, số khung chữ, giây.
  Không IP, không tên file, không chữ OCR.
- **HEIC**: dùng `pi-heif` (chỉ đọc; libheif + libde265, LGPLv3), không dùng `pillow-heif` (kèm x265, GPL). Chi tiết `LICENSES.md`.
- Không có khóa / token / mật khẩu nào trong code.

## Test

```powershell
cd server
D:\tmp\may-chu-1\venv\Scripts\python -m pytest -q --basetemp D:\tmp\may-chu-1\pytest-tmp              # engine giả (66 test)
D:\tmp\may-chu-1\venv\Scripts\python -m pytest -q -m real_model --basetemp D:\tmp\may-chu-1\pytest-tmp # model thật (2 test)
```

(nhớ đặt biến ổ D ở mục Cài.) Lượt thường bỏ test `real_model` (pytest in "2 deselected", không skip ẩn); thiếu model thì
test `real_model` FAIL.

## Đo 30 ảnh

```powershell
node server\do-30-anh.mjs --threads 8 --name may-chu-t8
node server\do-30-anh.mjs --threads 1 --name may-chu-t1
```

Công cụ tự bật uvicorn trên 127.0.0.1:8765 (cổng phải đang trống), gửi tuần tự 30 ảnh `front.jpg` (mã của `truth.csv` có
ảnh, thứ tự `truth.csv`), rồi TẮT máy chủ (kể cả khi lỗi) và in cổng còn nghe hay không. Trong lượt đo đặt
`RATE_LIMIT_PER_MIN=1000` (30 ảnh liền nhau chạm trần 20 / phút). RAM đỉnh đo bằng `do_rss.py` (psutil, mỗi 0,2 giây).
Chấm 2 đường: (A) như ocr-mat (`t1-ocr.mjs`: `{ text, conf, box }`), (B) như trang thử (`public/chup-mat-do/t1.mjs` trên
`poly` / `score`, danh mục `public/chup-mat-do/danh-muc-vn.json`). So từng khung với `D:\tmp\ocr-mat\ocr\r1-nocls-v4`
(chữ trùng, box ≤ 0,5 px, conf ≤ 1e-4) và câu tìm + top5 với `D:\tmp\ocr-mat\ket-qua\r1-nocls-v4.json`.
Kết quả ở `D:\tmp\may-chu-1\ket-qua\` (không commit); số đã đo ghi ở `PLAN.md` mục 8 (đợt may-chu-1).

## Docker (để sau, chưa build)

`Dockerfile`: `python:3.12-slim`, `pip install --no-cache-dir -r requirements.txt`, bước build kiểm sha256 model + nạp thử
RapidOCR với `OCR_OFFLINE=1`, chạy bằng người dùng không phải root, `OCR_OFFLINE=1`, `CORS_ALLOW_LOCALHOST=0`,
`OCR_THREADS=1` (B1s 1 vCPU), uvicorn 1 worker `--no-access-log`. Host `0.0.0.0` **chỉ trong container**; trên máy tính dùng
`chay-thu.ps1` (127.0.0.1). `.dockerignore` bỏ venv, tests, `__pycache__`, `.env*`, công cụ đo.

## Giấy phép

Xem `LICENSES.md` (từng gói theo metadata đã cài + model PP-OCRv6 Apache-2.0).
