# Test 4 công cụ OCR trên bao bì đồ ăn

Mục tiêu: bộ 30 sản phẩm (ảnh tự chụp hoặc lấy từ Open Food Facts), cho 4 công cụ OCR đọc cùng bộ ảnh, chấm xem công cụ nào lấy được **đầy đủ thông tin nhất** (tên, thương hiệu, khối lượng, thành phần, dinh dưỡng, nhà sản xuất, bảo quản, hạn sử dụng), kèm tốc độ và chi phí.

**Bộ ảnh hiện tại:** ảnh và `truth.csv` của bộ hiện tại lấy từ Open Food Facts (ảnh CC BY-SA, dữ liệu ODbL); nguồn và tác giả từng ảnh ở `photos/NGUON.csv` (chỉ có trên máy, không commit).

## 4 công cụ

| # | Công cụ | Kiểu | Cần gì | Tiếng Việt |
|---|---|---|---|---|
| 1 | Tesseract (qua `pytesseract`) | mã nguồn mở, chạy offline | cài Tesseract + file `vie.traineddata` | có, trung bình |
| 2 | EasyOCR | mã nguồn mở, chạy offline (Python) | `pip install easyocr`, lần đầu tải model ~100 MB | có |
| 3 | Google Cloud Vision (Document Text) | dịch vụ đám mây, chỉ dùng mức miễn phí | tài khoản Google Cloud, file key JSON | tốt |
| 4 | Azure AI Vision (Read) | dịch vụ đám mây, chỉ dùng gói F0 miễn phí | tài khoản Azure, endpoint + key | tốt |

Không có key của dịch vụ nào thì script tự bỏ qua dịch vụ đó, vẫn chạy được các công cụ còn lại.

**Không dùng Claude.** Dự án không gọi bất kỳ API nào của Claude / Anthropic (không có mức miễn phí). Công cụ "claude" đã bị gỡ khỏi `run_ocr.py`: chạy `--tools claude` chỉ in "không dùng" rồi bỏ qua. Không điền `ANTHROPIC_API_KEY`. Google và Azure chỉ dùng trong mức miễn phí, có bộ đếm lượt gọi (xem "Bộ đếm lượt gọi" bên dưới).

## Bước 1 – Chọn 30 sản phẩm

Chọn đa dạng để kết quả công bằng, ví dụ: 6 mì/phở gói, 5 snack, 5 nước uống (lon, chai), 4 sữa/sữa chua, 4 gia vị (nước mắm, tương ớt, hạt nêm), 3 bánh kẹo, 3 đồ hộp/đông lạnh. Cố tình lấy vài món bao bì bóng, chữ nhỏ, bao bì cong (lon) để thấy công cụ nào chịu được ảnh khó.

## Bước 2 – Chụp ảnh

Mỗi sản phẩm 3 ảnh (thêm `date.jpg` nếu có ảnh chỗ in hạn sử dụng), đặt vào thư mục `photos/<mã vạch>/`:

```
photos/
├── NGUON.csv              # nguồn, giấy phép, tác giả từng ảnh (không commit)
├── 8936017368111/
│   ├── front.jpg          # mặt trước: tên, thương hiệu, khối lượng
│   ├── ingredients.jpg    # thành phần (thường có cả bảo quản, nhà sản xuất)
│   ├── nutrition.jpg      # bảng dinh dưỡng
│   └── date.jpg           # (nếu có) chỗ in NSX / HSD, chụp sát
└── hsd-01/
    └── date.jpg           # ảnh HSD không rõ mã vạch
```

- Tự chụp thì có thể gộp thành phần + dinh dưỡng của mặt sau vào 1 ảnh `back.jpg` thay cho `ingredients.jpg` và `nutrition.jpg`.
- Ảnh hạn sử dụng không biết mã vạch thì để trong `photos/hsd-01/date.jpg`, `hsd-02/`…; `truth.csv` thêm dòng chỉ có `code` (`hsd-01`…) và `han_su_dung`. Ảnh HSD của sản phẩm có mã nhưng không có 3 ảnh kia thì để `photos/<mã>/date.jpg` và dòng `truth.csv` chỉ có `code` + `han_su_dung`.

Cách chụp: đủ sáng, tránh bóng đèn phản chiếu, chụp thẳng góc, chữ chiếm gần hết khung, giữ máy yên. **Cả 4 công cụ dùng đúng bộ ảnh này**, không chụp lại cho từng công cụ.

## Bước 3 – Điền đáp án đúng (`truth.csv`)

Mở `truth.csv`, mỗi sản phẩm 1 dòng, chép đúng theo bao bì:

| cột | ví dụ | ghi chú |
|---|---|---|
| code | 8934563163150 | trùng tên thư mục ảnh |
| ten | Mì chay Hảo Hảo | |
| thuong_hieu | Acecook | |
| khoi_luong | 75g | |
| thanh_phan_dau | bột mì;dầu cọ;muối | 3 thành phần đầu, cách nhau bằng `;` |
| nang_luong_kcal | 437 | chỉ số |
| dam_g | 8.7 | |
| beo_g | 17 | |
| carb_g | 61 | |
| nha_san_xuat | Công ty CP Acecook Việt Nam | |
| bao_quan | nơi khô ráo thoáng mát | 1 cụm ngắn đúng chữ trên bao bì |
| han_su_dung | 12/05/2027 | đúng định dạng in trên gói |

Ô nào bao bì không in thì để trống, script sẽ không chấm ô đó.

## Bước 4 – Cài đặt

1. Python 3.10 trở lên.
2. Tesseract: Windows tải bộ cài tại https://github.com/UB-Mannheim/tesseract/wiki (khi cài tick thêm ngôn ngữ Vietnamese); macOS `brew install tesseract tesseract-lang`; Ubuntu `sudo apt install tesseract-ocr tesseract-ocr-vie`.
   Kiểm đã có tiếng Việt: chạy `tesseract --list-langs` (Windows PowerShell: `& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs`), danh sách phải có `vie` (và `eng`); `run_ocr.py` đọc với `vie+eng`. Không có `vie` thì tải `vie.traineddata` từ https://github.com/tesseract-ocr/tessdata rồi chép vào thư mục `tessdata` của Tesseract (Windows: `C:\Program Files\Tesseract-OCR\tessdata`, cần quyền quản trị).
3. Trong thư mục `test-ocr`:
   ```
   python -m venv .venv
   .venv\Scripts\activate        (Windows)   |   source .venv/bin/activate   (macOS/Linux)
   pip install -r requirements.txt
   copy .env.example .env         (Windows)   |   cp .env.example .env
   ```
4. Điền key vào `.env` (có cái nào điền cái đó; không có thì bỏ trống, script tự bỏ qua dịch vụ đó):
   - Google: trang giá chính thức https://cloud.google.com/vision/pricing (đọc ngày 05/11/2026) ghi "Document Text Detection 0 count to 1,000 count $0.00 (Free)", tức 1.000 ảnh miễn phí mỗi tháng. Trang giá **không ghi** có phải bật billing (thanh toán) hay không. Cách làm: tạo project tại https://console.cloud.google.com, bật Cloud Vision API, tạo service account, tải file JSON, ghi đường dẫn vào `GOOGLE_APPLICATION_CREDENTIALS`. **Nếu Google đòi bật billing hoặc gắn thẻ thì KHÔNG làm, bỏ qua Google** (để trống key, script tự bỏ qua).
   - Azure: trang giá chính thức https://azure.microsoft.com/pricing/details/cognitive-services/computer-vision/ (đọc ngày 05/11/2026) ghi gói "Free (F0) … 5,000 free transactions per month 20 transactions per minute". Tạo resource "Azure AI Vision" tại https://portal.azure.com, **chỉ chọn gói F0 (Free)**, chép Endpoint và Key. Trang giá không ghi có cần thẻ hay không; **nếu bị đòi thẻ hoặc chỉ có gói trả phí thì bỏ qua Azure** (Azure for Students thường không cần thẻ, nhưng phải tự kiểm lúc đăng ký).
   - Claude: **không dùng**, không cần key (dự án không gọi API Claude / Anthropic).
   - Ollama (cho extractor `llm` ở phần B): dùng bản zip độc lập, không cần bộ cài và không đặt biến môi trường hệ thống. Tải `ollama-windows-amd64.zip` ở https://github.com/ollama/ollama/releases (kiểm SHA256 theo file `sha256sum.txt` cùng bản), giải nén vào `D:\ollama\app` (máy ổ C ít chỗ thì để mọi thứ ở ổ D). Bật Ollama và để cửa sổ này mở. `OLLAMA_MODELS` là thư mục chứa model; `OLLAMA_CONTEXT_LENGTH=8192` cho model đọc được text OCR dài mà không bị cắt.
     - Git Bash:
       ```
       OLLAMA_MODELS='D:\ollama\models' OLLAMA_CONTEXT_LENGTH=8192 /d/ollama/app/ollama.exe serve
       ```
     - Windows PowerShell (`$env:` chỉ có tác dụng trong cửa sổ PowerShell đó, đóng cửa sổ là mất):
       ```
       $env:OLLAMA_MODELS='D:\ollama\models'; $env:OLLAMA_CONTEXT_LENGTH='8192'; D:\ollama\app\ollama.exe serve
       ```
     Tải model ở một cửa sổ khác (khoảng 2 GB), cũng phải đặt `OLLAMA_MODELS` như trên:
     - Git Bash: `OLLAMA_MODELS='D:\ollama\models' /d/ollama/app/ollama.exe pull qwen2.5:3b`
     - Windows PowerShell: `$env:OLLAMA_MODELS='D:\ollama\models'; D:\ollama\app\ollama.exe pull qwen2.5:3b`

     Máy RAM nhiều (16 GB trở lên) mới dùng `qwen2.5:7b` (đặt `OLLAMA_MODEL=qwen2.5:7b`). `.env` mặc định đã có `LLM_PROVIDER=ollama`; model mặc định là `qwen2.5:3b`; `OLLAMA_TIMEOUT` là số giây chờ mỗi sản phẩm (mặc định 180, máy chậm đặt 600).

## Bước 5 – Chạy

```
python run_ocr.py            # chạy mọi công cụ có sẵn, kết quả vào outputs/<công cụ>/
python run_ocr.py --tools tesseract,easyocr   # chỉ chạy vài công cụ
python score.py              # chấm điểm → outputs/results.csv và outputs/summary.md
```

`--tools claude` sẽ bị từ chối (in "không dùng" rồi bỏ qua).

Ghi log ra file trong Windows PowerShell 5.1 bằng `>` (vd `python score.py > log.txt`) có thể làm méo chữ tiếng Việt trong file log. Muốn đọc kết quả thì mở `outputs/summary.md`, hoặc chạy `[Console]::OutputEncoding = [Text.UTF8Encoding]::new()` trước.

Chạy lại không mất công: ảnh nào đã có file kết quả thì bỏ qua. Muốn chạy lại từ đầu thì xóa thư mục `outputs/<công cụ>` rồi chạy lại ngay; chưa chạy lại thì công cụ đó hiện 0 điểm vì `times.csv` còn dòng cũ (chạy lại Google / Azure sẽ tốn thêm lượt gọi, xem bộ đếm dưới đây).

## Bộ đếm lượt gọi (Google, Azure)

Để không bao giờ bị tính tiền, `run_ocr.py` đếm số lần gọi Google và Azure theo từng tháng (giờ UTC) trong file `outputs/api_usage.json`, và chỉ dùng tới **80% mức miễn phí**:

| Dịch vụ | Mức miễn phí / tháng (nguồn, ngày đọc) | Trần của script (80%) |
|---|---|---|
| Google Cloud Vision, Document Text Detection | 1.000 lượt: "Document Text Detection 0 count to 1,000 count $0.00 (Free)" (https://cloud.google.com/vision/pricing, 05/11/2026) | 800 |
| Azure AI Vision, gói F0 | 5.000 lượt, 20 lượt / phút: "Free (F0) … 5,000 free transactions per month 20 transactions per minute" (https://azure.microsoft.com/pricing/details/cognitive-services/computer-vision/, 05/11/2026) | 4.000 (và cách nhau ít nhất 3,1 giây) |

- **Trần mỗi lần chạy (Google)**: mỗi lần chạy `run_ocr.py` gọi Google **tối đa 60 lượt** (đếm cả lượt lỗi), ngoài trần tháng 800 ở bảng trên. Nguồn: luật chi phí chủ dự án đặt ngày 05/11/2026 trong `.claude/du-an.md` ("Mỗi lần chạy thử tối đa 60 lượt"); hằng `RUN_LIMIT` trong `run_ocr.py`. Azure không có trần mỗi lần chạy (chỉ trần tháng và khoảng cách 3,1 giây).
- Trước mỗi lần gọi, script đọc lại file, cộng 1 và ghi file ngay (đếm cả lần gọi bị lỗi). Ghi qua file tạm `api_usage.json.tmp` rồi thay file cũ; ghi hoặc thay bị lỗi thì script xóa file tạm và dừng bằng lỗi đó, `api_usage.json` cũ giữ nguyên. Chạm trần (60 lượt của lần chạy, hoặc trần tháng) thì ngừng gọi dịch vụ đó, script vẫn chạy tiếp các công cụ khác và không báo lỗi. Mỗi ảnh còn lại chưa có kết quả được ghi 1 dòng `bỏ qua theo luật chi phí` (cột `seconds` = 0) vào `outputs/times.csv`, không tạo file `.txt`. Chạy lại sau (lần chạy mới nếu chạm trần 60 lượt, tháng sau nếu chạm trần tháng) sẽ làm tiếp đúng các ảnh đó. `score.py` không tính dòng này là lỗi và không đưa vào thời gian trung bình; số ảnh còn bị bỏ qua hiện ở cột "Ảnh bỏ qua (luật chi phí)" của `summary.md`.
- **Không chạy 2 lần `run_ocr.py` cùng lúc** (2 cửa sổ dòng lệnh). Khi có Google / Azure sẽ chạy, script tạo file khóa `outputs/api_usage.lock` (ghi số tiến trình PID và giờ bắt đầu) và xóa khi chạy xong, kể cả khi lỗi hay bấm Ctrl+C. Nếu file khóa đã có sẵn, script in cảnh báo "đang có lần chạy khác hoặc lần trước bị tắt ngang" và **không gọi Google / Azure** lần đó (Tesseract / EasyOCR vẫn chạy). Chắc chắn không có lần chạy nào khác (ví dụ máy bị tắt ngang lúc đang chạy) thì tự xóa file `outputs/api_usage.lock` rồi chạy lại.
- Tắt tự gửi lại (retry) của thư viện: Google gọi với `retry=None`, Azure tạo client với `retry_total=0`. Nhờ vậy 1 lượt đếm = đúng 1 lần gửi, thư viện không tự gửi thêm khi gặp lỗi.
- Gọi bị lỗi thì **không ghi file kết quả** cho ảnh đó (lần sau chạy lại sẽ thử lại ảnh đó), chỉ ghi 1 dòng `error` vào `outputs/times.csv`. Google / Azure lỗi **3 lần liên tiếp** thì script in lý do và dừng gọi dịch vụ đó (3 lượt lỗi vẫn bị đếm). Sửa lỗi (key, mạng, gói…) rồi chạy lại.
- **Khoảng nghỉ đầu / cuối tháng**: script không gọi Google / Azure trong 12 giờ cuối và 12 giờ đầu mỗi tháng theo giờ UTC (từ 19:00 giờ Việt Nam ngày cuối tháng tới 19:00 giờ Việt Nam ngày 1). Lúc đó có nơi đã sang tháng mới, có nơi chưa, nên không chắc Google / Azure tính lượt gọi vào tháng nào. Script in lý do và bỏ qua dịch vụ; chạy lại sau 19:00 giờ Việt Nam ngày 1.
- File `api_usage.json` hỏng (không đọc được) thì script coi như đã chạm trần, không gọi Google / Azure, và không ghi đè file đó: hãy tự sửa lại cho đúng dạng `{"google": {"2026-11": 12}, "azure": {"2026-11": 3}}`.
- Cuối mỗi lần chạy, script in bảng: dịch vụ, tháng, đã dùng / trần tháng, lượt của lần chạy này / trần lần chạy (Google: `… / 60`, Azure: không có trần).
- Test phần đếm, hàm `found()` của `score.py`, phần đọc times.csv, danh sách công cụ, in tiếng Việt khi ghi ra file (không gọi Google / Azure thật, không đọc `.env`, chỉ dùng thư mục tạm; cần `pillow`, `python-dotenv`, `rapidfuzz`), trong thư mục `test-ocr`: `.venv\Scripts\python -B -m unittest -v test_run_ocr test_run_extract` (Windows) hoặc `.venv/bin/python -B -m unittest -v test_run_ocr test_run_extract` (macOS / Linux). `test_run_extract` thử `run_extract.py` / `score_combo.py` của phần B (không gọi Ollama thật).
- File này và file khóa `api_usage.lock` **không commit** (nằm trong `outputs/`, đã có trong `.gitignore`).
- Bộ đếm chỉ biết lượt gọi từ script này, trên máy này. Dùng cùng key ở nơi khác (máy khác, trang web của Google / Azure…) thì bộ đếm không biết, phải tự cộng vào.
- **Đừng xóa file giữa tháng**: xóa là mất số đếm, script sẽ tưởng tháng này chưa gọi lần nào.
- Mức miễn phí có thể đổi: trước khi chạy nhiều, mở lại 2 trang giá trên; số mới thấp hơn thì sửa `FREE_PER_MONTH` trong `run_ocr.py`.

## Bước 6 – Đọc kết quả

`outputs/summary.md` có:
- Tổng điểm mỗi công cụ (tối đa 11 điểm × số sản phẩm).
- Tỷ lệ đúng theo từng trường: sẽ thấy ví dụ "hạn sử dụng" thường thấp nhất vì in dạng chấm (dot-matrix).
- Thời gian trung bình mỗi ảnh, số ảnh lỗi, số ảnh bỏ qua theo luật chi phí (cột "Ảnh bỏ qua (luật chi phí)").
- `outputs/times.csv` được ghi nối thêm qua nhiều lần chạy, nên `score.py` chỉ đọc **dòng cuối của mỗi ảnh** (theo công cụ, mã, tên ảnh): ảnh lần trước lỗi hoặc bị bỏ qua, lần sau ok thì chỉ tính là ok, thời gian chỉ tính một lần.
- `score.py` coi là công cụ OCR: thư mục con của `outputs/` và tên công cụ có dòng trong `outputs/times.csv` (công cụ bị bỏ qua hết theo luật chi phí hoặc lỗi hết chưa có thư mục nhưng vẫn hiện, điểm 0), trừ thư mục không phải công cụ OCR (hằng `NOT_OCR_DIRS`: `extract` do `run_extract.py` ở phần B tạo, `hsd-js` của phần C, `web-ocr` của phần D) và tên bắt đầu bằng dấu chấm. Ở bảng theo trường, công cụ chưa có file `.txt` nào hiện "–" ở mọi trường (chưa đọc được ảnh nào, khác với đọc mà sai = 0).

Chọn công cụ theo 4 tiêu chí: điểm đầy đủ thông tin, tốc độ, chi phí mỗi ảnh (cloud tính tiền sau mức miễn phí), có chạy offline không. Với app sinh viên, thường kết luận là: dùng công cụ chạy offline cho tên/thành phần, và dùng công cụ mạnh hơn, trong mức miễn phí, cho ảnh hạn sử dụng.

## Prompt dán vào Claude Code

```
Đọc README.md và truth.csv trong thư mục test-ocr. Ảnh đã có trong photos/ (nguồn ở photos/NGUON.csv) và truth.csv đã điền.
Giúp mình: (1) không mở .env; chạy script và báo công cụ nào bị bỏ qua vì thiếu key / chạm trần (không gọi API Claude / Anthropic),
(2) chạy python run_ocr.py rồi python score.py,
(3) đọc outputs/summary.md và viết nhận xét ngắn bằng tiếng Việt: công cụ nào tốt nhất về độ đầy đủ, trường nào
hay sai, công cụ nào nên dùng cho app quét mã vạch (ưu tiên miễn phí, chạy trên điện thoại). Nếu script lỗi thì sửa
và nói rõ đã sửa gì.
```

---

# Phần B – 5 keyword extractor và tổ hợp OCR × extractor

OCR chỉ cho ra một đống chữ. Bước thứ hai là **rút trích**: từ đống chữ đó lấy ra đúng 11 trường. Phần B so 5 cách rút trích, chạy trên **mọi** kết quả OCR của phần A, nên ra được ma trận 4 × 5 = 20 tổ hợp (4 công cụ OCR × 5 extractor).

| # | Extractor | Cách hoạt động | Mạnh | Yếu |
|---|---|---|---|---|
| 1 | `regex` | luật viết tay: tìm chữ "thành phần:", "kcal", "HSD"… rồi lấy giá trị đứng sau | nhanh, miễn phí, dễ sửa | không biết thương hiệu; OCR sai một chữ là trượt |
| 2 | `dict` | từ điển (`dict/brands.txt`, `ingredients.txt`, `storage.txt`) + so khớp mờ bằng rapidfuzz | chịu được OCR mất dấu, sai vài ký tự | chỉ biết những gì có trong từ điển; bạn phải bổ sung |
| 3 | `yake` | keyword extractor thống kê thật sự: trả về 40 cụm từ "nổi bật" nhất | không cần dạy gì | không gắn được cụm từ với trường nào; chấm bằng cách xem giá trị đúng có nằm trong 40 cụm không |
| 4 | `underthesea` | NLP tiếng Việt: tách từ + NER nhận diện tên tổ chức (cho nhà sản xuất, thương hiệu), số dùng luật | hiểu tên riêng tiếng Việt | chậm, model nặng, NER học từ báo chí nên bao bì có thể lạ |
| 5 | `llm` | đưa text OCR cho mô hình ngôn ngữ, yêu cầu trả JSON đúng 11 trường | chịu lỗi OCR tốt nhất, hiểu ngữ cảnh | chậm; **chỉ chạy bằng Ollama trên máy** (`LLM_PROVIDER=ollama`, mặc định, miễn phí; cần Ollama bản zip ở `D:\ollama\app`, model ở `D:\ollama\models`, `ollama pull qwen2.5:3b`; `qwen2.5:7b` chỉ khi máy RAM nhiều), không gọi Anthropic API |

Luật và từ điển làm việc trên text **đã bỏ dấu** (để chịu được OCR mất dấu), nên giá trị rút ra có thể không dấu; điểm chấm cũng bỏ dấu hai bên nên không bị thiệt.

## Chạy phần B (sau khi phần A đã có `outputs/<ocr>/`)

```
python run_extract.py                     # 5 extractor × mọi OCR đã chạy
python run_extract.py --extractors regex,dict,yake      # bỏ qua cái chậm (underthesea, llm)
python run_extract.py --ocr tesseract --extractors llm   # chỉ 1 tổ hợp (llm chạy bằng Ollama, cần Ollama đang chạy)
python score_combo.py                     # → outputs/summary_combo.md
```

- Chạy lại không mất công: sản phẩm đã có file kết quả `outputs/extract/<ocr>__<extractor>/<mã>.json` với `_status` là `ok` thì bỏ qua; file kết quả lỗi (vd Ollama quá giờ) sẽ được chạy lại ở lần sau.
- `llm` (Ollama): `OLLAMA_MODEL` chọn model (mặc định `qwen2.5:3b`), `OLLAMA_TIMEOUT` là số giây chờ mỗi sản phẩm (mặc định 180; máy chậm đặt 600). Ollama phải đang chạy (`ollama.exe serve`, xem Bước 4).
- Thứ tự ghép text các ảnh của một sản phẩm: `front`, `ingredients`, `nutrition`, `back`, `date`.
- `regex` (và `underthesea`, vì dùng `regex` cho số) có thêm 7 luật chịu lỗi OCR lặp lại (mỗi luật có ở text OCR của ≥ 2 sản phẩm):
  (1) nhãn "năng lượng" / "calories" đọc sai (`nang iuong`, `galories`…), bỏ "calories from fat";
  (2) kcal đọc sai, mất hoặc in trước số (`75,3kca]`, `(kcal) 72,4`);
  (3) bỏ mức tham chiếu "nhu cầu năng lượng 2000 kcal";
  (4) đạm / béo / carb mất đơn vị g hoặc g đọc thành 9 / 4 / 2: lấy số đầu tiên sau nhãn rõ ràng (nhãn béo "fat" không tính "calories from fat"); "(g)" in trước số cũng được nhờ luật này, không cần luật riêng;
  (5) "7,09" là 7,0 g (chữ g dính sau số thập phân đọc thành 9; rủi ro: số thật như 18,49 mà mất g thì thành 18,4);
  (6) hạn in liền 6 số (ddmmyy) sau HSD / EXP, chỉ kiểm khoảng ngày 01–31, tháng 01–12 (không kiểm lịch: 30/02 vẫn nhận; năm không kiểm; chỉ xét chuỗi 6 số đầu tiên sau nhãn), ngoài khoảng thì bỏ;
  (7) số sau nhãn "khối lượng tịnh" đọc sai (`khol luong`, `khoi iuong`, `tjnh`).
  Đợt `sua-nho` (06/11/2026) thêm 3 luật cho đạm / béo / carb, áp cho cả `regex` và `dict`, theo nguyên tắc "thà để trống còn hơn ra số sai" (mã sản phẩm làm bằng chứng ghi trong comment của `run_extract.py`):
  (a) giá trị cuối (sau luật cũ, luật dự phòng, (5)) > 100 g thì để trống, không thử luật khác (vd "1449", "1809", "4129", "555584");
  (b) nhãn béo không lấy số của "chất béo bão hòa / chuyển hóa", "saturated fat", "trans fat", kể cả OCR đọc sai (`chatbeobaohoalsaturated fat`, `chatheobaohda/sauated fat`, `saturatec 496  fat`): bỏ khỏi text cả cụm nhãn lẫn số đi kèm trước khi chạy luật béo, như (3); "Total Fat" / "Chất béo" đứng trước vẫn giữ. Cụm "calories from fat" cũng được bỏ trước (chịu nhiều dấu cách giữa "from" và "fat").
  Vòng 2 của (b) (sau review): khoảng giữa nhãn bão hòa / chuyển hóa và số không được vượt qua nhãn béo khác (fat, béo, trans, sat, total, lipid); nhãn VI bão hòa nối liền nhãn EN bão hòa (`chat beo bao hoal saturated| fat`, `chatheobaohda/sauated fat`) là một nhãn song ngữ, vẫn bỏ kèm số; bảng đọc theo cột (nhãn bão hòa và chuyển hóa liền nhau, không có số giữa, vd "Total Fat Saturated Fat Trans Fat 10g 3g 0g") thì chỉ bỏ các nhãn, không bỏ số nào, nên ra 10 chứ không ra 3. "sat" phải đứng đầu từ ("Sắt 2 Fat 5 g" vẫn ra 5); "chất béo không bão hòa" bỏ trọn. Không đổi ô nào trong 1.364 ô đã đo;
  Vòng 3: nhãn béo tổng đứng liền nhãn bão hòa / chuyển hóa (bảng theo cột, kể cả có "(g)") → giữ nhãn béo tổng, chỉ bỏ nhãn bão hòa / chuyển hóa, không bỏ số (vd "Chất béo Chất béo bão hòa 10g 3g" ra 10, không ra 3); chỉ coi là cột khi ngay sau các nhãn có ≥ 2 số liền nhau, nên "Chất béo/ Fat Chất béo bão hòa/ Saturated fat 2 g" vẫn để trống. Không đổi ô nào trong 1.364 ô đã đo;
  Vòng 4: khoảng giữa nhãn bão hòa / chuyển hóa và số chỉ gồm dấu cách / dấu câu (cộng 'less than'), không nhảy qua chữ → bảng cột 'Chất béo / Chất béo bão hòa / Natri 10g 3g 50mg' ra 10, không ra 3; giữa 2 số của cột cho thêm '|'. Đo lại regex và dict: so với vòng 3 không đổi ô nào (1.364 / 1.364), điểm / 239 giữ nguyên (EasyOCR + regex 73; Tesseract + regex 28,7; EasyOCR + dict 52,5; Tesseract + dict 29); ô `beo_g` của 8938501141040 vẫn là 7 (Tesseract + regex), trống (Tesseract + dict), 65 (EasyOCR + regex), 0 (EasyOCR + dict); Ca biên còn mở (nhãn bão hòa kèm '(g)', chữ rác giữa nhãn và số, dict ra số chất đạm ở bảng cột đầy đủ): xem PLAN.md dòng E.
  (c) luật dự phòng (không có đơn vị g): số nguyên ≥ 2 chữ số bắt đầu bằng 0 ("09", "00": "0 g" đọc sai) thì để trống, không đổi thành 0;
  (d) số mất dấu phẩy + g đọc thành 9 ("569" là 5,6 g; "1199" là 11,9 g): để trống, không chèn dấu phẩy (ô đạm "1449" của 8936017368111 sẽ thành 14,4, đáp án 7,0). Không cần code riêng: số nguyên ≥ 3 chữ số không bắt đầu bằng 0 mà tận cùng 9 thì ≥ 109, nên (a) đã bỏ.
  Thứ tự so với luật cũ: (1), (2), (4), (5) chỉ dùng khi luật cũ không ra gì; (3) bỏ mức tham chiếu khỏi text trước khi chạy mọi luật năng lượng; (6) được xét trước "ngày cuối cùng trong text" và áp cả cho `dict`; (7) được xét trước luật cũ (số + đơn vị đầu tiên ở 15 dòng đầu). Đã bỏ 2 luật vì chỉ thấy ở 1 sản phẩm: nhãn "đạm (g)" (8936025773181) và "g đọc thành 9" sau khối lượng tịnh (8936036027099). Sửa luật xong thì xóa `outputs/extract/*__regex`, `*__dict`, `*__underthesea` rồi chạy lại.
- Cột giây/sản phẩm trong `summary_combo.md` tính cả file kết quả lỗi (vd Ollama quá giờ cũng được tính số giây đã chờ).

## Đọc kết quả phần B

`outputs/summary_combo.md` có 3 bảng:
1. **Ma trận OCR × extractor**: mỗi ô là % thông tin rút ra đúng. Nhìn hàng để biết OCR nào tốt, nhìn cột để biết extractor nào tốt, ô cao nhất là tổ hợp nên dùng.
2. Trung bình theo extractor + giây/sản phẩm.
3. Tỷ lệ đúng theo trường của tổ hợp tốt nhất.

So với `summary.md` (phần A): phần A đo "OCR **có chứa** thông tin không", phần B đo "extractor **đưa ra** được không". Chênh lệch giữa hai bảng là phần thông tin bị mất ở bước rút trích, không phải lỗi OCR. Ví dụ OCR đọc được "Năng lượng 437 kcal" (A đúng) nhưng regex đòi "kcal" đứng ngay sau số còn OCR in "437 kcaI" (chữ I hoa) thì B sai.

Đợt `ocr-b` thấy: `regex` mạnh ở kcal, carb, đạm khi OCR tốt; `dict` mạnh ở thương hiệu, bảo quản; `llm` khá đều các trường (trừ HSD) và giữ được nhiều thông tin nhất khi OCR nhiều lỗi. `yake` **không** thấp nhất: EasyOCR + yake 26% (hơn dict 22%), Tesseract + yake 15% (cao nhất hàng Tesseract). Lý do thấy rõ trong `score_combo.py`: với yake, mỗi trường lấy điểm cao nhất trong cả 40 cụm từ (các extractor khác chỉ đưa 1 giá trị), và trường chữ chấm bằng `partial_ratio`, nên một cụm ngắn nằm trong đáp án cũng tính đúng (vd "NGON NGUYÊN" cho tên "Koreno vị ngon nguyên bản"). Vì vậy yake cao ở `ten` (76% / 34%) nhưng 0% ở mọi trường số và HSD: điểm yake không có nghĩa là yake dùng được cho app.

Kết quả đợt `ocr-b` (05/11/2026, 31 mã, 239 điểm, sau khi sửa luật regex ở vòng 2):

| OCR \ extractor | dict | llm | regex | underthesea | yake |
|---|---|---|---|---|---|
| easyocr | 22% | **37%** | 30% | 30% | 26% |
| tesseract | 12% | 13% | 12% | 11% | 15% |

- EasyOCR + `llm` (qwen2.5:3b qua Ollama) 37% là cao nhất nhưng mất khoảng 129 giây mỗi sản phẩm trên CPU; EasyOCR + `regex` 30% gần như tức thì (trước sửa luật 16%; Tesseract + regex 7% → 12%).
- So với trước sửa luật (1.434 ô của regex / dict / underthesea × 2 OCR): rỗng → đúng 81 ô, sai → đúng 6, đúng → sai 0, đúng → rỗng 0, rỗng → sai 63 ô (số sai thay cho ô trống, chủ yếu đạm / béo). Nguyên nhân của 63 ô: 6 ô "0 g" đọc thành "09"; 2 ô "00" của "Saturated Fat"; 3 ô HSD "200223" hợp lệ nhưng đọc sai; 52 ô còn lại: mất dấu phẩy + g đọc thành 9 (vd "569" là 5,6 g; "1199" là 11,9 g) hoặc lấy nhầm số khác sau nhãn ("288Akcal" mất phần lẻ). Đợt `sua-nho` đã thêm luật (a)–(c) ở trên cho các ô này.
- Sau đợt `sua-nho` (06/11/2026, chỉ chạy lại `regex` và `dict`; 1.364 ô = 2 extractor × 2 OCR × 31 mã × 11 trường): sai → rỗng 29 ô, sai → đúng 3 ô, đúng → sai 0, đúng → rỗng 0, rỗng → sai 0, còn lại không đổi. EasyOCR + regex 30% → 31% (71 → 73 điểm), Tesseract + regex 12% (27,7 → 28,7 điểm), dict không đổi (22% / 12%); `beo_g` EasyOCR + regex 29% → 38%, Tesseract + regex 17% → 21%. Cột `underthesea` trong `summary_combo.md` giữ số cũ (không chạy lại), đã lỗi thời vì phần số của underthesea dùng luật regex.
- Mất thông tin ở bước rút trích (OCR đã đọc được mà extractor ra sai / rỗng): EasyOCR + regex 71% → 48%, EasyOCR + llm 36%, yake 79–81%.
- `han_su_dung` gần như không đọc được: 1/9 ô ở EasyOCR + regex / dict / underthesea, Tesseract 0/9 với mọi extractor, llm 0/9. Cách đọc HSD cho giai đoạn 3 (`tesseract.js`) mới là giả thuyết, phải đo lại.

Bảng theo trường, 3 mốc (trước sửa luật / vòng 1 / vòng 2), đếm từng ô và bảng mất thông tin đầy đủ ở PLAN.md mục 8, dòng E.

## Prompt dán vào Claude Code cho phần B

```
Phần A đã chạy xong, outputs/<ocr>/ đã có. Đọc phần B trong README.md.
(1) Chạy python run_extract.py --extractors regex,dict,yake,underthesea rồi python run_extract.py --extractors llm
(llm chỉ chạy bằng Ollama trên máy, LLM_PROVIDER=ollama; không gọi API Claude / Anthropic; Ollama chưa chạy thì bỏ qua
và nói rõ), (2) chạy python score_combo.py, (3) đọc outputs/summary_combo.md và
outputs/results_combo.csv, viết nhận xét tiếng Việt: tổ hợp OCR + extractor nào tốt nhất, extractor nào mất nhiều
thông tin nhất dù OCR đã đọc được, trường nào yếu, và đề xuất tổ hợp cho app (ưu tiên miễn phí). Nếu thấy luật
regex/dict trượt vì lỗi OCR lặp đi lặp lại (vd 'kcaI', 'Thanh phan'), sửa luật trong run_extract.py, chạy lại và
nói đã sửa gì. Không sửa truth.csv.
```

---

# Phần C – Đo đọc HSD bằng tesseract.js

Thí nghiệm cho giai đoạn 3 (CHƯA đưa vào app): trên điện thoại chỉ có `tesseract.js` (Tesseract bản WebAssembly), nên đo xem nó đọc được hạn sử dụng (HSD) không khi người dùng chụp riêng vùng in HSD. Code ở `hsd-js/`, có `package.json` riêng (không thêm gói nào vào `package.json` của app).

## Cài

Trong thư mục `test-ocr/hsd-js` (máy ổ C ít chỗ: cache npm và dữ liệu ngôn ngữ để ở ổ D):

- Git Bash: `npm_config_cache='D:\cache\npm' npm install`
- Windows PowerShell: `$env:npm_config_cache='D:\cache\npm'; npm install`

Cài `tesseract.js` 7.0.0 và `jimp` 1.6.1 (xử lý ảnh thuần JavaScript; `node_modules` khoảng 80 MB). Lần chạy đầu, `tesseract.js` tự tải dữ liệu ngôn ngữ `vie` và `eng` (khoảng 6,6 MB) về `D:\cache\tesseract-js` (đổi bằng `--cache`), lần sau đọc từ đó.

## Cắt vùng HSD

- `hsd-js/crops.csv` ghi khung cắt cho 9 ô `han_su_dung` của `truth.csv`: `code, file_nguon, x, y, w, h, ghi_chu` (chỉ tọa độ, không có ảnh). Tọa độ tính trên ảnh đã xoay theo EXIF (như trình duyệt hiển thị). 6 mã có `date.jpg`; 3 mã không có (8936017368111, 8934673300759, 8936017367107) thì lấy dòng in HSD trên `front.jpg` / `ingredients.jpg`. Không tìm thấy vùng HSD thì ghi "không tìm thấy" (mã đó tính sai ở cả 2 cách).
- Khung bao dòng in HSD, chừa lề 10–20 px khi được; dòng NSX nằm riêng thì loại ra. Chữ in nghiêng làm khung chữ nhật không tách hẳn NSX thì ghi rõ ở `ghi_chu`. Khung chỉ cắt, không xoay: 2 ô chữ in dọc vẫn để dọc.
- Khung được chọn và commit TRƯỚC khi chạy OCR lần đầu (không chỉnh khung theo kết quả).
- `node hsd-js/crop.mjs` cắt ra `photos/<mã>/hsd/crop.jpg`. Ảnh cắt nằm trong **thư mục con `hsd/`**, không đặt thẳng trong `photos/<mã>/`, vì `run_ocr.py` đọc mọi `photos/*/*.jpg`: ảnh cắt sẽ lẫn vào bộ ảnh OCR của phần A (sau khi cắt, `run_ocr.py` vẫn thấy 96 ảnh). Ảnh cắt không commit (`photos/` đã gitignore).

## Chạy

Thư mục hiện tại là `test-ocr` (nơi có `photos/`, `truth.csv`, `outputs/`):

```
node hsd-js/crop.mjs      # cắt ảnh theo crops.csv
node hsd-js/hsd.mjs       # đọc 2 cách, ghi outputs/hsd-js/results.csv và summary.md
```

Tham số (mặc định tính từ thư mục hiện tại): `--photos photos`, `--truth truth.csv`, `--out outputs/hsd-js`, `--crops <hsd-js>/crops.csv`, `--cache D:\cache\tesseract-js`. `truth.csv` chỉ đọc.

2 cách, cùng một hàm rút ngày `parseExpiry` (`hsd-js/parse.mjs`):

- (a) đọc thẳng: ảnh cắt nguyên, ngôn ngữ `vie+eng`, PSM (cách chia trang) mặc định, không giới hạn ký tự.
- (b) xám + `normalize` + `contrast 0.3` của jimp, phóng 3 lần (2 lần nếu cạnh dài sau khi phóng 3 lần > 3000 px), `eng`, PSM 7 (đọc 1 dòng), chỉ nhận `0123456789/.-`. (b) không đọc được nhãn chữ (HSD, EXP…) và tháng bằng chữ.

`parseExpiry`, luật đặt trước: (1) ngày ngay sau nhãn HSD / EXP / Hạn sử dụng / BB / Best before; (2) ngày có dấu `/ . -` (cho khoảng trắng quanh dấu) hoặc tháng viết tắt tiếng Anh ("05 / Oct / 2021"); (3) 6 số liền ddmmyy. Ngày ngay sau nhãn NSX / MFG / MFD / Ngày sản xuất / Ngày SX bị bỏ. Cùng mức nhiều ngày thì lấy ngày muộn nhất. Ngày phải có thật trên lịch (30/02 bỏ, 29/02 chỉ năm nhuận), năm 2 số thành 20yy, năm ngoài 2000–2100 bỏ.

Test (không cần ảnh, không chạy OCR): trong `test-ocr/hsd-js` chạy `npm test` (16 test `node:test`).

## Kết quả (06/11/2026, đợt `gd3-a`)

| Cách | Đúng | Tạo worker | ms / ảnh TB | ms / ảnh lớn nhất |
|---|---|---|---|---|
| (a) đọc thẳng, vie+eng | **2/9** | 400 ms (lần đầu kèm tải dữ liệu: 1.235 ms) | 492 | 1.530 |
| (b) xám + tương phản + phóng, eng, PSM 7, chỉ số | **1/9** | 275 ms | 399 | 1.015 |

ms / ảnh = tiền xử lý + recognize. Máy đo: Intel Core i7-6820HQ 2,7 GHz (8 luồng), RAM 7,8 GB, Windows 10, Node 24.20.0, tesseract.js 7.0.0, jimp 1.6.1. Điện thoại sẽ chậm hơn.

| Mã | Ảnh nguồn | Kiểu in | (a) | (b) |
|---|---|---|---|---|
| 8934673300759 | front.jpg | chấm kim nhòe thành nét liền | đúng | đúng |
| 8936017367107 | ingredients.jpg | chữ in thường, tháng bằng chữ | đúng | sai: chỉ nhận số nên mất "Oct" ("05//2021") |
| 8936028641487 | date.jpg | chấm kim | sai: chữ rác | sai: "- 1 1 1 2" |
| 8936221044160 | date.jpg | chấm kim | sai: chữ rác | sai: "- . ." |
| 8934588022111 | date.jpg | chấm kim, nghiêng, nắp lon | sai: chữ rác | sai: rỗng |
| 8936012061321 | date.jpg | chấm kim | sai: chữ rác | sai: rỗng |
| 8934673818391 | date.jpg | chấm kim, ảnh nhòe | sai: "#00977 Bl 51" | sai: "2009770" (đáp án 200923) |
| 8936017368111 | front.jpg | chấm kim, in dọc, ảnh nhỏ | sai: chữ rác | sai: "3" |
| 8935001214274 | date.jpg | in dọc, mờ | sai: chữ rác | sai: rỗng |

Nhận xét: `tesseract.js` chỉ đọc được chữ nét liền; 5 ô in chấm kim (dot-matrix: chữ ghép từ các chấm rời) không ô nào ra ngày, 2 ô chữ in dọc cũng không (ảnh cắt không xoay). Cách (b) 1/9, chưa đạt mốc 5/9 để làm tính năng đọc HSD trong app (`hsd-app`, PLAN.md mục 8).

---

# Phần D – OCR trong trình duyệt (đợt `ocr-c`)

Mục tiêu: tìm OCR đọc chữ bao bì tốt hơn mà **chạy được trong trình duyệt điện thoại** (Safari iOS, Chrome Android), để sau này làm tính năng "chụp bao bì điền nháp". Chỉ đo, chưa sửa app. Đo trên máy tính bằng Playwright: WebKit (đại diện Safari iOS) và Chromium (đại diện Chrome Android), khổ điện thoại 390×844, deviceScaleFactor 3. Trang thử trên điện thoại thật: `public/ocr-thu.html` (mục cuối).

| Công cụ (tên trong `outputs/`) | Chạy ở đâu | Gói / model |
|---|---|---|
| `paddlejs-rows-chromium`, `paddlejs-rows-webkit` (**cách chính**) | trong trình duyệt | `@paddleocr/paddleocr-js` 0.4.2 (SDK chính thức của PaddlePaddle, kiểm `npm view` 07/11/2026), onnxruntime-web 1.24.3 (wasm), OpenCV.js 4.10; model ONNX chính thức trên HuggingFace: `PaddlePaddle/PP-OCRv5_mobile_det_onnx` + `PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx` (cố định theo mã commit trong `web-ocr/assets.js`). Các khung chữ cùng hàng nối thành 1 dòng (`rowLines`). |
| `paddlejs-chromium`, `paddlejs-webkit` (để so) | trong trình duyệt | như trên, nhưng mỗi khung chữ 1 dòng (`orderLines`, cách của vòng 1) |
| `tesseractjs-chromium`, `tesseractjs-webkit` | trong trình duyệt | `tesseract.js` 7.0.0, `vie+eng` (giống `run_ocr.py`), PSM 3; dữ liệu ngôn ngữ `@tesseract.js-data/vie@1.0.0`, `@tesseract.js-data/eng@1.0.0` (`4.0.0_best_int`) |
| `paddle-vietocr` | máy chủ (Python), KHÔNG chạy trong trình duyệt | cùng file ONNX PP-OCRv5 mobile det (onnxruntime CPU) + VietOCR `vgg_transformer` 0.3.13 (PyTorch CPU) |

Lưu ý model latin của PaddleOCR: bảng chữ của `latin_PP-OCRv5_mobile_rec` có 836 ký tự nhưng **thiếu 45/71 chữ có dấu tiếng Việt** (mọi chữ ở khối Unicode "Latin Extended Additional": ả ạ ầ ẩ ậ ề ế ệ ỉ ị ọ ộ ờ ợ ủ ụ ừ ữ ự ỳ…; có ă â đ ê ô ơ ư à á ã è é ì í ò ó õ ù ú ý). Chữ thiếu bị bỏ hẳn khi đọc ("Thành phần" ra "Thành phn", "Nạc" ra "Nc"): ô tên / thành phần mất dấu, số không ảnh hưởng. PP-OCRv6 (small / tiny) cũng thiếu 44–48/71. VietOCR có đủ.

## Cài

Trong `test-ocr/web-ocr` (cache npm ở ổ D):

- Git Bash: `npm_config_cache='D:\cache\npm' npm ci`
- Windows PowerShell: `$env:npm_config_cache='D:\cache\npm'; npm ci`

`node_modules` khoảng 226 MB (onnxruntime-web 133 MB vì có nhiều bản wasm). Playwright KHÔNG cài vào đây: dùng bản có sẵn ở `D:\tmp\pw` (1.56.1).

File tải về một lần (không commit; `.gitignore` bỏ `*.onnx`, `*.traineddata*`):
- `D:\cache\paddle-onnx\PP-OCRv5_mobile_det_onnx\inference.onnx` + `inference.yml` (4,8 MB) và `D:\cache\paddle-onnx\latin_PP-OCRv5_mobile_rec_onnx\inference.onnx` + `inference.yml` (8,0 MB): tải ở `https://huggingface.co/<repo>/resolve/<mã commit>/<file>` (repo, mã commit, sha256 ở `web-ocr/assets.js`).
- `D:\cache\web-ocr\tessdata\vie.traineddata.gz`, `eng.traineddata.gz` (4,2 MB): tải ở `https://cdn.jsdelivr.net/npm/@tesseract.js-data/<vie|eng>@1.0.0/4.0.0_best_int/<lang>.traineddata.gz` (sha256 giống hệt bản jsDelivr).

VietOCR: venv riêng ở thư mục chính `test-ocr/vietocr/.venv` (khoảng 925 MB vì có torch CPU), trong `test-ocr`:

```
python -m venv vietocr\.venv
set PYTHONUTF8=1
set PIP_CACHE_DIR=D:\cache\pip
vietocr\.venv\Scripts\python -m pip install -r vietocr\requirements.txt
vietocr\.venv\Scripts\python -m pip install --no-deps vietocr==0.3.13
```

`PYTHONUTF8=1` vì `requirements.txt` có chữ tiếng Việt (thiếu thì pip trên Windows báo UnicodeDecodeError). `vietocr` cài `--no-deps` vì gói ghim bản cũ chỉ cần khi huấn luyện (imgaug 0.4.0 không chạy với numpy 2). Trọng số và cấu hình tải ở `https://vocr.vn/data/vietocr/` vào `D:\cache\vietocr` (`base.yml`, `vgg-transformer.yml`, `vgg_transformer.pth` 152 MB, sha256 `380512193a8b…ea59`); script đặt `cnn.pretrained = False` nên không tải thêm trọng số ImageNet.

## Chạy

Thư mục hiện tại là `test-ocr` (nơi có `photos/`, `outputs/`), giống `run_ocr.py`:

```
node web-ocr/run-browser.mjs --engine paddlejs --join rows --browser chromium   # 96 ảnh -> outputs/paddlejs-rows-chromium
node web-ocr/run-browser.mjs --engine paddlejs --join rows --browser webkit
node web-ocr/run-browser.mjs --engine paddlejs --browser chromium               # cách cũ mỗi khung 1 dòng (để so)
node web-ocr/run-browser.mjs --engine tesseractjs --browser chromium
node web-ocr/run-browser.mjs --engine paddlejs --join rows --browser chromium --mode cdn --limit 1   # byte tải lần đầu
node web-ocr/run-browser.mjs --report        # outputs/web-ocr/metrics.csv + tai-lan-dau.md
vietocr\.venv\Scripts\python vietocr\run_vietocr.py
python score.py
python run_extract.py --ocr paddlejs-rows-chromium,paddlejs-rows-webkit --extractors regex,dict
python score_combo.py
node web-ocr/so-sanh.mjs                     # outputs/web-ocr/so-sanh.md (sinh hoàn toàn bằng script)
node web-ocr/regex-parity.mjs                # luật regex bản JS của trang thử khớp bản Python
```

`--join rows` chỉ dùng cho `paddlejs`, ghi vào thư mục / tên công cụ riêng (`paddlejs-rows-<trình duyệt>`); không bao giờ ghi lẫn vào thư mục của cách không nối.

Biến môi trường:
- `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright` (WebKit 26.0, bản 2215 của Playwright 1.56.1).
- `PW_CHROMIUM` = đường dẫn `chrome-headless-shell.exe` có sẵn (`%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1248\chrome-headless-shell-win64\`, Chromium 156; không tải trình duyệt mới).
- `PLAYWRIGHT_MODULE` (mặc định `D:\tmp\pw\node_modules\playwright\index.mjs`).
- Tuỳ chọn: `PHOTOS_DIR`, `PADDLE_ONNX_DIR`, `TESSDATA_DIR` (cho `serve.mjs`); `PADDLE_DET_ONNX`, `VIETOCR_DIR` (cho `run_vietocr.py`).
- `TEMP` = `TMP` = `D:\tmp` (ổ C ít chỗ).

Kết quả ghi giống phần A: `outputs/<công cụ>/<mã>__<ảnh>.txt` + dòng `outputs/times.csv`; chạy lại thì ảnh đã có file kết quả được bỏ qua. Mỗi lần chạy ghi `outputs/web-ocr/runs/<công cụ>-<mode>.json` (giây nạp, backend, bộ nhớ, byte tải); lần chạy không đọc ảnh nào vì ảnh đã có hết thì KHÔNG ghi đè file này (in cảnh báo), lần có ảnh bỏ qua thì cột `note` của `metrics.csv` ghi rõ. Mode `cdn` chỉ ghi file json. `score.py` và `run_extract.py` (khi không truyền `--ocr`) không coi `outputs/hsd-js`, `outputs/web-ocr`, `extract` là công cụ OCR (hằng `NOT_OCR_DIRS` của `score.py`). Test (không cần trình duyệt): trong `web-ocr` chạy `npm test` (56 test `node:test`; có test chặn nâng bản tesseract.js khỏi 7.0.0, thiếu `node_modules/tesseract.js` thì test FAIL với câu "chạy npm ci trong test-ocr/web-ocr trước": nâng bản thì kiểm lại cách lách `tessLangObjects` ở mục dưới); VietOCR: trong `vietocr` chạy `.venv\Scripts\python -B -m unittest -v test_run_vietocr` (venv ở thư mục chính).

## Cách làm và cách đo

- `serve.mjs`: server tĩnh ở 127.0.0.1, **không gửi COOP / COEP** (như GitHub Pages), nên `crossOriginIsolated = false`, không có SharedArrayBuffer, wasm chạy **1 luồng** (`numThreads: 1`). Đã kiểm trong trang: `crossOriginIsolated` = false ở cả 2 trình duyệt.
- WebGPU: `harness.html` gọi `navigator.gpu.requestAdapter()` trước; chỉ khi trả adapter mới dùng onnxruntime-web bản có WebGPU (`ort.min.mjs`, backend "auto", có đường lùi wasm), không thì bản chỉ wasm (`ort.wasm.min.mjs`, nhẹ hơn). Đo được: Chromium headless có `navigator.gpu` nhưng `requestAdapter()` trả null (cả khi bật cờ SwiftShader); WebKit Windows không có `navigator.gpu`. **Backend thật: wasm ở cả 2.** Safari iOS 26 có WebGPU, nên trên iPhone thật trang sẽ tải bản WebGPU: wasm JSEP 25 MB, jsDelivr nén còn khoảng 3,4 MB thay cho 2,0–2,6 MB của bản chỉ wasm, **tổng tải lần đầu khoảng 19 MB, sát ngưỡng 20 MB**; tốc độ có thể khác, chưa đo. Đã thử đường này bằng một WebGPU giả trong Chromium: trang tải `ort.min.mjs` + `ort-wasm-simd-threaded.jsep.wasm`, tạo phiên WebGPU lỗi thì tự lùi về wasm và đọc được.
- PaddleOCR.js chạy ở luồng chính (không bật `worker`), tham số mặc định của SDK (det: limit_side_len 64 kiểu min, max 4000, thresh 0,3, box_thresh 0,6, unclip 1,5). SDK chỉ nhận model dạng 1 file `.tar`; HuggingFace có 2 file rời, nên `harness.mjs` truyền `fetch` riêng: tải `inference.onnx` + `inference.yml` rồi gói tar ngay trong trình duyệt (`makeTar` trong `lib.mjs`). Gói `@techstark/opencv-js` và `clipper-lib` không có bản ES module, nên import map trỏ tới 2 file nhỏ trong `web-ocr/shims/` (nạp bằng thẻ `<script>`).
- **Dữ liệu ngôn ngữ tesseract.js ghim `@1.0.0`** (từ vòng 2): chế độ `cdn` không dùng `langPath` (để trống thì tesseract.js tự lấy `@tesseract.js-data/<lang>/4.0.0_best_int` = bản mới nhất; một đường dẫn chung thì không ghim được bản cho 2 gói `vie`, `eng`). Trang tự tải 2 file `…/vie@1.0.0/4.0.0_best_int/vie.traineddata.gz`, `…/eng@1.0.0/…` rồi đưa byte cho `createWorker([{ code, data }])`. tesseract.js 7.0.0 có lỗi: bước khởi tạo ghép tên ngôn ngữ bằng `l.data` thay vì `l.code` (`src/worker-script/index.js`, hàm `initialize`), nên `tessLangObjects` (`lib.mjs`) cho `data` là getter: lần sao chép đầu (nạp ngôn ngữ) trả byte, lần sau (khởi tạo) trả tên. Chế độ `local` giữ `langPath` = `D:\cache\web-ocr\tessdata`.
- Tiền xử lý: ảnh vẽ ra canvas như trình duyệt hiển thị (đã xoay theo EXIF; bộ ảnh hiện tại không ảnh nào có EXIF xoay), thu cạnh dài về 1600 px. Khác `run_ocr.py` một chút: `run_ocr.py` lưu ảnh đã thu nhỏ ra JPEG chất lượng 90 rồi mới đọc, còn web-ocr và VietOCR đọc thẳng ảnh đã thu nhỏ trong bộ nhớ (không nén lại). Cách thu nhỏ của canvas khác PIL và khác nhau giữa 2 trình duyệt, nên chữ đọc ra không giống hệt: Paddle giống hệt 19/96 file giữa Chromium và WebKit, tesseract.js 37/96 (tesseract.js còn dùng bản core khác: Chromium `relaxedsimd`, WebKit `simd`).
- Giây/ảnh: chỉ bước đọc (`predict` / `recognize`), không tính nạp model và chuẩn bị ảnh, giống `times.csv` của phần A. Ghi trung bình (TB), **trung vị** và **p90** (90% số ảnh đọc nhanh hơn số này; nội suy như `numpy.percentile`): vài ảnh chữ dày rất chậm kéo trung bình lên, và 2 lần chạy cùng cách trên máy này có thể lệch khoảng 30% (máy làm việc khác cùng lúc).
- **Chữ Paddle**: sắp khung theo cạnh trên, gom thành hàng khi khung chồng chiều dọc với hàng đang xét ≥ 50% chiều cao nhỏ hơn, trong hàng trái sang phải (`groupRows` trong `web-ocr/lib.mjs`). Cách chính `rowLines`: các khung cùng hàng nối thành 1 dòng (cách nhau 1 dấu cách), để nhãn và số bảng dinh dưỡng ("Protein" / "17,14g") nằm cùng dòng cho luật regex. Cách cũ `orderLines`: mỗi khung 1 dòng (`run_vietocr.py` dùng bản Python giống hệt).
- **Bộ nhớ** (ước lượng trên Windows, iPhone có thể khác nhiều): mỗi (công cụ × trình duyệt) mở một trình duyệt MỚI (`launchServer` để biết số tiến trình); MỘT tiến trình PowerShell chạy suốt lần đo, mỗi 250 ms lấy `PrivateMemorySize64` (bộ nhớ đã cam kết riêng) và `WorkingSet64` (đang nằm trong RAM) của cả cây tiến trình con (cây tính lại mỗi 2 giây bằng `Win32_Process`). Mức nền: trung vị tổng private khi mở trang trống 3 giây, **đếm từ khi có mẫu đầu tiên** (PowerShell khởi động mất khoảng 0,7–0,9 giây; json ghi `firstSampleMs`, `baselineSamples`, thường 9–10 mẫu). Ghi thêm đỉnh của 1 tiến trình, đỉnh tổng; Chromium ghi JS heap (CDP `Performance.getMetrics`, không tính bộ nhớ wasm). Private của WebKit rất lớn (5–7 GB) vì JavaScriptCore giữ sẵn vùng nhớ ảo cho wasm, nên so working set. Mức nền của WebKit (858 MB private) chủ yếu là tiến trình `Playwright.exe` của bản WebKit Windows. Lấy mẫu bằng `Get-CimInstance` / `Process` cũng tốn một chút CPU, nên giây/ảnh đo được có thể chậm hơn thật một ít.
- **Byte tải lần đầu**: mode `cdn`, trình duyệt mới (cache trống), 1 ảnh; cộng `request.sizes().responseBodySize` (byte qua mạng, đã nén) và độ dài body sau giải nén của mọi request ra mạng (kể cả request của worker), không tính file của máy (trang đo, ảnh thử). Từ vòng 2: chờ mọi bộ xử lý `requestfinished` lấy cỡ xong (`Promise.allSettled`) rồi mới đóng trình duyệt; mục nào vẫn không đo được thì liệt kê ở `unmeasured` và cột `note` (vòng 2: 0 mục). jsDelivr phục vụ được file lớn nhất của onnxruntime-web (wasm JSEP 25 MB, asyncify 27 MB: HTTP 200, nén còn 3,4–3,8 MB); bản đang dùng (wasm 12,4 MB) nén còn 2,0–2,6 MB tùy lần (jsDelivr lúc nén brotli, lúc gzip).

## Kết quả (07/11/2026, vòng 2; máy Intel Core i7-6820HQ 4 nhân 8 luồng, RAM 7,8 GB, Windows 10)

96 ảnh / 31 mã / 239 điểm. Không công cụ nào lỗi hay sập: 96/96 ảnh ok ở cả 7 công cụ mới (`paddlejs-rows-*` đo ở vòng 2, còn lại ở vòng 1). Bảng đầy đủ do script sinh: `outputs/web-ocr/so-sanh.md`; số đo chi tiết: `outputs/web-ocr/metrics.csv`; từng file tải lần đầu: `outputs/web-ocr/tai-lan-dau.md`.

| Công cụ | % A | % B regex | % B dict | giây/ảnh Chromium: TB (trung vị, p90) | giây/ảnh WebKit: TB (trung vị, p90) | bộ nhớ đỉnh 1 tiến trình, working set (MB) Chromium / WebKit | MB tải lần đầu (qua mạng) | chạy được cả 2 trình duyệt? |
|---|---|---|---|---|---|---|---|---|
| **PaddleOCR.js nối khung cùng hàng** (`paddlejs-rows`, cách chính) | **62%** | **36% / 37%** | **42%** | 5,7 (4,9; 10,4) | 7,8 (6,7; 13,2) | 1.439 / 1.299 | 18,1 | có |
| PaddleOCR.js mỗi khung 1 dòng (`paddlejs`, để so) | 62% | 19% / 20% | 25% | 6,9 (5,8; 12,5) | 11,7 (10,6; 20,1) | 1.099 / 1.190 | 18,1 / 17,4 | có |
| tesseract.js 7 (vie+eng) | 25% / 20% | 10% | 12% | 1,5 (1,0; 3,4) | 2,5 (1,6; 5,2) | 1.004 / 694 | 5,8 | có |
| PP-OCRv5 det + VietOCR (Python) | **74%** | 25% | 28% | 9,3 trên CPU máy tính | không chạy trong trình duyệt | – | – (model khoảng 157 MB) | không chạy trong trình duyệt |
| EasyOCR (ocr-a, số cũ) | 45% | 31% | 22% | 13,7 trên CPU máy tính | không chạy trong trình duyệt | – | – | không chạy trong trình duyệt |
| Tesseract (ocr-a, số cũ) | 20% | 12% | 12% | 1,3 trên CPU máy tính | không chạy trong trình duyệt | – | – | không chạy trong trình duyệt |

Ô có "a / b" là Chromium / WebKit. Lớn nhất: `paddlejs-rows` 14,6 giây (Chromium) / 19,5 giây (WebKit). Giây nạp từ CDN (vòng 2, mạng nhanh): `paddlejs-rows` 11,1 s (Chromium) / 6,6 s (WebKit), tesseract.js 2,3 / 4,5 s; vòng 1 cùng file mất 27–149 s (mạng chậm), nên chỉ coi là ví dụ. Nạp từ máy (không qua mạng): Paddle 2–3 s, tesseract.js 1 s.

Tải lần đầu của PaddleOCR.js (qua mạng / sau giải nén, kB): `ort-wasm-simd-threaded.wasm` 2.624–2.627 / 12.362 (jsDelivr; vòng 1 WebKit 2.016), `opencv.js` 2.448 / 10.378, rec ONNX 8.047 / 8.042 và det ONNX 4.830 / 4.827 (HuggingFace, không nén), `clipper.js` 47 / 204, `js-yaml.mjs` 18 / 104. tesseract.js (dữ liệu `@1.0.0`): `tesseract-core-*-lstm.wasm.js` 1.374–1.376 / 3.899–3.906, `eng.traineddata.gz` 2.953–2.957, `vie.traineddata.gz` 1.423–1.425, `worker.min.js` 32–33 / 111.

Đánh giá theo ngưỡng (do `so-sanh.mjs` sinh, ngưỡng: trên cả 2 trình duyệt ≥ 30% B regex, ≤ 10 giây/ảnh TB, ≤ 20 MB tải lần đầu; "sát ngưỡng" = cách ngưỡng ≤ 15%):
- PaddleOCR.js nối khung cùng hàng: **đạt cả 3** (trên máy tính; tốc độ WebKit vẫn chờ thử iPhone theo quyết định vòng 1): B regex 36% / 37%, 5,7 / 7,8 giây, 18,1 MB; tải lần đầu sát ngưỡng (18,1 MB; trên máy có WebGPU khoảng 19 MB).
- PaddleOCR.js mỗi khung 1 dòng: không đạt (B regex 19–20%, WebKit 11,7 giây).
- tesseract.js: không đạt B regex (10%), đạt tốc độ và tải.

Nhận xét:
- Nối khung cùng hàng không đổi % A (cùng chữ, chỉ khác cách xuống dòng) nhưng nâng B regex từ 19–20% lên 36–37% (hơn EasyOCR + regex 31%) và B dict lên 42% (tổ hợp tốt nhất phần B, hơn EasyOCR + llm 37%). Theo trường (regex, Chromium / WebKit): đạm 0–4% lên 46–50%, béo 8% lên 54%, carb 8% lên 65–69%, kcal 69–73% lên 85–88%; nhà sản xuất giảm 42% xuống 17–25% (dòng nối thêm chữ của khung bên cạnh), tên 21% xuống 17%; thành phần 11–13% (thiếu chữ có dấu).
- WebKit lần này 7,8 giây/ảnh (vòng 1 cùng model: 8,6 khi thử nối hàng, 11,7 khi mỗi khung 1 dòng): số giây/ảnh trên máy này dao động khoảng 30% giữa các lần chạy; WebKit Windows cũng không phải Safari iOS. Kết luận về tốc độ trên iPhone phải thử máy thật (trang `ocr-thu.html`).
- Bộ nhớ: khi đọc ảnh 1600 px, tiến trình trang dùng 1,1–1,4 GB working set tùy lần chạy; private gần như không đổi (~1.040–1.060 MB, số của Chromium; WebKit private 5–7 GB vì giữ sẵn vùng nhớ ảo). Bộ nhớ wasm không trả lại sau khi phình, rủi ro Safari iOS đóng trang trên iPhone ít RAM; phải thử iPhone thật.
- tesseract.js nhanh và nhẹ (5,8 MB) nhưng chỉ ngang Tesseract Python (20–25%).
- VietOCR (máy chủ) cao nhất phần A (74%): phần nhận dạng tiếng Việt còn nhiều chỗ để lên nếu có model đủ dấu; không dùng được trong app tĩnh (không có máy chủ).

## Trang thử `ocr-thu.html` (điện thoại thật)

`public/ocr-thu.html` (+ `public/ocr-thu/regex.mjs`, `text.mjs`) là trang riêng, **không có link nào từ app**, có `noindex`. Vite chép nguyên vào `dist/` (không vào bundle, không thêm gì vào `package.json` của app); trên Pages ở `https://khangnguyen196.github.io/quet-ma-vach-full/ocr-thu.html`. Ảnh chỉ xử lý trong trình duyệt, không gửi đi đâu.

- Thư viện + model tải từ CDN, đúng bản cố định của `web-ocr/assets.js` chế độ `cdn` (jsDelivr theo số bản, HuggingFace theo mã commit, dữ liệu tesseract `@1.0.0`; test `ocr-thu.test.mjs` kiểm mọi URL của trang). wasm 1 luồng. WebGPU chỉ khi có `navigator.gpu` VÀ `requestAdapter()` trả adapter trong 3 giây; mọi trường hợp khác (gồm "Chỉ dùng wasm") trang giấu `navigator.gpu` (`hideGpu`) trước khi nạp SDK, vì SDK PaddleOCR lúc khởi tạo luôn gọi `requestAdapter()` không giới hạn giờ, kể cả backend wasm (máy có `requestAdapter()` treo thì trang treo theo); lỗi khi khởi tạo / đọc bằng WebGPU thì tự lùi về wasm; ô "Chỉ dùng wasm" (trang tải lại với `?wasm=1`, bản `ort.wasm.min.mjs` như lúc đo). Hiện backend thật đã dùng.
- 2 nút "Chụp ảnh" (camera sau) và "Chọn từ thư viện" (khóa đến khi trang sẵn sàng, trông mờ khi đang khóa nhờ CSS `.btn:has(input:disabled)`; trang mở lỗi thì vẫn khóa); ảnh xoay theo EXIF, thu cạnh dài về 1600 px. Nút "Đọc bằng PaddleOCR" (nối khung cùng hàng như `paddlejs-rows`) và "Đọc bằng tesseract.js (để so)" (chỉ tải khi bấm; đọc xong tắt worker để trả bộ nhớ).
- Hiện: chữ đọc được, 11 ô regex (trống ghi "chưa đọc được"; ô "Thương hiệu" ghi rõ luật regex không rút ô này), giây tải model, giây đọc, backend, cỡ ảnh sau thu nhỏ, crossOriginIsolated, byte đã tải (từ Resource Timing; CDN không gửi `Timing-Allow-Origin` thì ghi "không đo được"; file do worker tự tải không tính), trình duyệt. Nút "Chép kết quả" chép một đoạn tóm tắt để dán lại.
- Thiếu bộ nhớ: `RangeError` có chữ "alloc" / "memory" / "buffer" (RangeError khác như "Maximum call stack size exceeded" thì không; RangeError lỗi vị trí có "bounds" / "out of range" như "Start offset -1 is outside the bounds of the buffer" cũng không, để nhánh WebGPU vẫn lùi về wasm), hoặc lỗi có chữ "memory", "OOM", "allocate"… thì báo "Trang thiếu bộ nhớ khi đọc ảnh…". Trước khi đọc đặt cờ `sessionStorage` `ocr-thu-dang-doc`, đọc xong thì xóa; mở lại trang mà còn cờ thì báo "Trang vừa bị đóng giữa chừng, có thể do thiếu bộ nhớ". Không dùng `localStorage`.
- Luật regex: `regex.mjs` là bản JS của `extract_regex` (Python là chuẩn). Regex JS khác Python ở `\d`, `\w`, `\b`, `\s` (JS chỉ hiểu ASCII), `.`, `$`, `(?P<…>)`, nên `pyRegex` đổi các chỗ đó theo nghĩa Python và giữ nguyên chuỗi mẫu. `node web-ocr/regex-parity.mjs` so bản JS với mọi `outputs/extract/<ocr>__regex/<mã>.json`: vòng 2 khớp 100% (9 OCR × 31 sản phẩm = 279 lượt, 3.069 ô, lệch 0). Sửa luật regex thì sửa `run_extract.py` trước, chép sang `regex.mjs`, chạy lại script này. Cần Safari 16.4+ / Chrome 89+ (import map, lookbehind).
- Service worker của app lưu sẵn cả `ocr-thu.html`, `ocr-thu/*.mjs` (không dùng tới: `routeFor` bỏ qua `ocr-thu/*.mjs`, mất mạng thì service worker trả `index.html`; chỉ tốn khoảng 47 kB lúc cài (3 file, vòng 3) và mỗi lần sửa trang thử làm đổi VERSION của app, hiện thanh "Đã có bản mới") nhưng không bao giờ lưu file CDN. Mở trang thì mạng trước; chỉ khi mất mạng hoặc mạng chậm quá 3 giây mà đã có bản lưu thì service worker trả `index.html` (giới hạn đã biết, quyết định vòng 0). Khi thử trên điện thoại: nếu mở `ocr-thu.html` mà thấy giao diện app thay vì trang thử thì kéo xuống để tải lại.
- Rủi ro chạy chung tên miền với app: trang thử chạy script CDN (jsDelivr, HuggingFace) trên cùng tên miền `khangnguyen196.github.io`, nên các script đó đọc / ghi được `localStorage` tủ đồ và cache `qmv-shell-*` của app. Khả năng thấp vì mọi bản đều ghim (jsDelivr theo số bản, HuggingFace theo mã commit), nhưng chưa có integrity (SRI) cho mọi file CDN: opencv.js / clipper.js qua thẻ script; các module trong import map (PaddleOCR.js, onnxruntime-web, js-yaml, tesseract.js) cần khóa integrity của import map; chưa kiểm sha256 2 file onnx (Việc để sau (e)).
- Kiểm trên máy (bản build, server tĩnh giả đường dẫn `/quet-ma-vach-full/`): `node web-ocr/ocr-thu-check.mjs --base <link> --browser chromium|webkit --shots <thư mục>` chạy các bước (a)–(h) và chụp màn hình; thư mục hiện tại là `test-ocr` có `photos/`, `outputs/`. Bước (d) đếm số lần gọi `navigator.gpu.requestAdapter()` khi "Chỉ dùng wasm" (phải 0, `navigator.gpu` bị giấu); bước (h) chỉ đọc: Content-Type của `ocr-thu.html` (text/html), `ocr-thu/regex.mjs`, `ocr-thu/text.mjs` (có "javascript") và 2 ô chọn ảnh khóa sẵn trong HTML, dùng được với `--base https://khangnguyen196.github.io/quet-ma-vach-full/` sau deploy; lỗi mạng ở (h) không làm dừng script: (h) ghi `{ ok: false, error }` (có lý do gốc thì thêm `cause`, vd `ENOTFOUND`), `ket-qua.json` của (a)–(g) vẫn được ghi, kết luận CÓ BƯỚC KHÔNG QUA. Trước khi trang sẵn sàng script ghi trạng thái 2 ô chọn ảnh và độ mờ 2 nút (`beforeReady`, ảnh `a0` nếu kịp chụp; chỉ để xem, không tính vào QUA); trang đã sẵn sàng trước lúc đo thì chỉ ghi `readyAlready`; chụp `a0` lỗi thì ghi `error` và chạy tiếp (a)–(h). Vòng 2 qua (a)–(g), vòng 3 và vòng 4 qua (a)–(h) trên Chromium và WebKit (chữ giống 100% với `outputs/paddlejs-rows-<trình duyệt>` trên 2 ảnh thử). Vòng 5 (07/11/2026, gợi ý review vòng 4; commit ac5a115 test đỏ 5/56, 8262b79 sửa, 5a095d1 tài liệu): lỗi wasm "memory access out of bounds" (mọi câu có "out of bounds") không còn bị tính là thiếu bộ nhớ, để nhánh WebGPU vẫn lùi về wasm; chụp `a0` lỗi thì ghi `error` và chạy tiếp, trang đã sẵn sàng trước lúc đo thì chỉ ghi `readyAlready`; (h) lỗi mạng ghi thêm `cause`; test web-ocr 56/56. Kết quả vòng 5: bản build trên máy (VERSION sw.js `b14535b5f0cf`) qua (a)–(h) trên Chromium và WebKit; trên Pages sau khi lên main (07/11/2026) Chromium qua (a)–(h), WebKit trượt (d) 2/2 lần với lỗi "caller is not a function. (In 'caller(handle,methodName,null,args)', 'caller' is undefined)" khi bật "Chỉ dùng wasm" (`requestAdapter` 0 lần), (a)–(c), (e)–(h) qua; ghi ở PLAN mục 8, Việc để sau ocr-c (f), chờ kết quả thử iPhone.
