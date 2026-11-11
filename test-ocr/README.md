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
- Service worker của app: từ đợt `chup-mat-do` (08/11/2026) KHÔNG còn lưu sẵn (precache) `ocr-thu.html`, `ocr-thu/*`, `chup-mat-do.html`, `chup-mat-do/*` (`tools/sw-build.mjs`); trước đó lưu sẵn `ocr-thu*` dù không dùng tới (khoảng 47 kB lúc cài). Mỗi lần sửa trang thử vẫn đổi VERSION của app (VERSION băm mọi file của `dist/`), hiện thanh "Đã có bản mới". Không bao giờ lưu file CDN. Mở trang thì mạng trước; chỉ khi mất mạng hoặc mạng chậm quá 3 giây mà đã có bản lưu thì service worker trả `index.html` (giới hạn đã biết, quyết định vòng 0). Khi thử trên điện thoại: nếu mở `ocr-thu.html` mà thấy giao diện app thay vì trang thử thì kéo xuống để tải lại.
- Rủi ro chạy chung tên miền với app: trang thử chạy script CDN (jsDelivr, HuggingFace) trên cùng tên miền `khangnguyen196.github.io`, nên các script đó đọc / ghi được `localStorage` tủ đồ và cache `qmv-shell-*` của app. Khả năng thấp vì mọi bản đều ghim (jsDelivr theo số bản, HuggingFace theo mã commit), nhưng chưa có integrity (SRI) cho mọi file CDN: opencv.js / clipper.js qua thẻ script; các module trong import map (PaddleOCR.js, onnxruntime-web, js-yaml, tesseract.js) cần khóa integrity của import map; chưa kiểm sha256 2 file onnx (Việc để sau (e)).
- Kiểm trên máy (bản build, server tĩnh giả đường dẫn `/quet-ma-vach-full/`): `node web-ocr/ocr-thu-check.mjs --base <link> --browser chromium|webkit --shots <thư mục>` chạy các bước (a)–(h) và chụp màn hình; thư mục hiện tại là `test-ocr` có `photos/`, `outputs/`. Bước (d) đếm số lần gọi `navigator.gpu.requestAdapter()` khi "Chỉ dùng wasm" (phải 0, `navigator.gpu` bị giấu); bước (h) chỉ đọc: Content-Type của `ocr-thu.html` (text/html), `ocr-thu/regex.mjs`, `ocr-thu/text.mjs` (có "javascript") và 2 ô chọn ảnh khóa sẵn trong HTML, dùng được với `--base https://khangnguyen196.github.io/quet-ma-vach-full/` sau deploy; lỗi mạng ở (h) không làm dừng script: (h) ghi `{ ok: false, error }` (có lý do gốc thì thêm `cause`, vd `ENOTFOUND`), `ket-qua.json` của (a)–(g) vẫn được ghi, kết luận CÓ BƯỚC KHÔNG QUA. Trước khi trang sẵn sàng script ghi trạng thái 2 ô chọn ảnh và độ mờ 2 nút (`beforeReady`, ảnh `a0` nếu kịp chụp; chỉ để xem, không tính vào QUA); trang đã sẵn sàng trước lúc đo thì chỉ ghi `readyAlready`; chụp `a0` lỗi thì ghi `error` và chạy tiếp (a)–(h). Vòng 2 qua (a)–(g), vòng 3 và vòng 4 qua (a)–(h) trên Chromium và WebKit (chữ giống 100% với `outputs/paddlejs-rows-<trình duyệt>` trên 2 ảnh thử). Vòng 5 (07/11/2026, gợi ý review vòng 4; commit ac5a115 test đỏ 5/56, 8262b79 sửa, 5a095d1 tài liệu): lỗi wasm "memory access out of bounds" (mọi câu có "out of bounds") không còn bị tính là thiếu bộ nhớ, để nhánh WebGPU vẫn lùi về wasm; chụp `a0` lỗi thì ghi `error` và chạy tiếp, trang đã sẵn sàng trước lúc đo thì chỉ ghi `readyAlready`; (h) lỗi mạng ghi thêm `cause`; test web-ocr 56/56. Kết quả vòng 5: bản build trên máy (VERSION sw.js `b14535b5f0cf`) qua (a)–(h) trên Chromium và WebKit; trên Pages sau khi lên main (07/11/2026) Chromium qua (a)–(h), WebKit trượt (d) 2/2 lần với lỗi "caller is not a function. (In 'caller(handle,methodName,null,args)', 'caller' is undefined)" khi bật "Chỉ dùng wasm" (`requestAdapter` 0 lần), (a)–(c), (e)–(h) qua; ghi ở PLAN mục 8, Việc để sau ocr-c (f), chờ kết quả thử iPhone.

# Phần E – Chụp mặt trước -> nhận ra sản phẩm (đợt `chup-mat-do`)

Mục tiêu: chọn cách "chụp mặt trước sản phẩm -> tối đa 5 gợi ý -> người dùng chọn đúng -> app mở trang theo mã như khi quét". Chỉ đo, không sửa app. Bộ thử: `front.jpg` của 30 sản phẩm trong `photos/` (31 mã trong `truth.csv`, `8934673818391` không có `front.jpg`); đáp án chỉ đọc `truth.csv`. Cách thắng cho app phải: chạy được trong trình duyệt điện thoại, miễn phí, không key; đúng mã trong 5 đầu ≥ 50% số ảnh đo được, ≤ ~15 giây/ảnh trên WebKit, dung lượng tải + bộ nhớ chấp nhận được. Cách chỉ chạy trên máy tính / máy chủ xếp hạng riêng.

## Cài

Trong `test-ocr/chup-mat-do` (package.json riêng, chỉ có `@huggingface/transformers` 4.3.1 cho cách 2 / cách 3 bằng Node; không thuộc app):

- Git Bash: `npm_config_cache='D:\cache\npm' npm ci` (`node_modules` khoảng 470 MB)
- Biến môi trường cho mọi lệnh (không tải gì vào ổ C): `HF_HOME=D:\cache\hf`, `TRANSFORMERS_CACHE=D:\cache\hf`, `npm_config_cache=D:\cache\npm`, `PLAYWRIGHT_BROWSERS_PATH=D:\cache\ms-playwright`, `TEMP=TMP=D:\tmp`, `PIP_CACHE_DIR=D:\cache\pip`.
- Playwright dùng bản có sẵn ở `D:\tmp\pw` (như Phần D); OCR trong trình duyệt dùng lại `web-ocr/` (Phần D); 1d dùng venv `vietocr/.venv` (Phần D); 4b cần Ollama ở `D:\ollama` (model ở `D:\ollama\models`, `ollama pull qwen2.5vl:3b`, 3,2 GB).
- Mọi thứ tải về / kết quả thô ở `D:\tmp\chup-mat-do\` (không commit): `ocr\` (chữ OCR / JSON của từng cách), `du-lieu\` (bản xuất OFF đã lọc VN), `chi-muc\` (danh mục T1, ảnh + vector chỉ mục), `ket-qua\` (JSON kết quả, `tong-hop-v1.md` … `tong-hop-v5.md`).

## Chạy lại từng bước (trong thư mục `test-ocr`)

1. OCR 30 ảnh trong trình duyệt (1a PaddleOCR.js nối khung cùng hàng, 1b tesseract.js), có dòng + chiều cao khung: `node web-ocr/run-browser.mjs --engine paddlejs --join rows --only front --lines --browser chromium|webkit --out 'D:\tmp\chup-mat-do\ocr' --photos 'D:\quet-ma-vach-full\test-ocr\photos'` (1b: `--engine tesseractjs`); byte tải lần đầu: thêm `--mode cdn --limit 1`.
2. CORS của các API tìm kiếm OFF: `node chup-mat-do/cors-check.mjs`. Tìm OFF bằng `search.pl` (S1 / S2 / S3, lọc VN, qua trang Chromium vì OFF chặn User-Agent node): `node chup-mat-do/run-ocr-off.mjs` (vòng 2: `--tools 1d,1c,4a --stats off-stats-v2.json`). Kiểm lọc VN: `node chup-mat-do/vn-filter-check.mjs`.
3. 1d (chỉ máy tính): `D:\quet-ma-vach-full\test-ocr\vietocr\.venv\Scripts\python chup-mat-do\vietocr-bridge.py --photos D:\quet-ma-vach-full\test-ocr\photos --out D:\tmp\chup-mat-do\ocr\vietocr-1d`. 1c: `node chup-mat-do/ocrspace.mjs` (cần key, chưa chạy). 4a: `node chup-mat-do/gemini.mjs --model gemini-3.6-flash --rpm 5` (key tự đọc từ `test-ocr/.env`).
4. Dữ liệu VN từ bản xuất JSONL chính thức của OFF (13,4 GB nén, đọc luồng, chỉ giữ sản phẩm có `countries_tags` `en:vietnam`; tải nối khi đứt: thăm dò 1 byte bằng `curl -L --max-time 30`, chỉ nối khi ra 206): `node chup-mat-do/du-lieu-vn.mjs`. T1 (BM25 trên danh mục chữ VN 1.452 sản phẩm): `node chup-mat-do/t1.mjs`.
5. Cách 2 (tìm theo hình): chống ăn gian `node chup-mat-do/chong-an-gian.mjs`; chỉ mục `node chup-mat-do/chi-muc-anh.mjs --step catalog,select,download,loo,embed`; đo `node chup-mat-do/do-trinh-duyet.mjs --model clip|dinov2 --browser chromium|webkit` (chỉ mục tính bằng trình duyệt: `--build-index`); kết hợp `node chup-mat-do/rrf.mjs --model clip`. Bộ phụ mở rộng: `node chup-mat-do/mo-rong.mjs --step scan|pairs|catalog|rrf`.
6. Cách 3 (AI nhỏ trong trình duyệt, transformers.js 4.3.1, wasm): `node chup-mat-do/do-cach3.mjs --model florence|smolvlm --browser chromium|webkit --dtype q4|q8|fp16` (thử 1 ảnh: `--limit 1 --tag thu1`).
7. 4b (chỉ máy tính, Ollama CPU, tự bật / tắt `ollama serve` chỉ nghe 127.0.0.1): `node chup-mat-do/ollama-vl.mjs --model qwen2.5vl:3b`.
8. Trang thử: xuất danh mục `node chup-mat-do/xuat-danh-muc.mjs` -> `public/chup-mat-do/danh-muc-vn.json`; so bản trình duyệt với bản Node `node chup-mat-do/trang-thu-parity.mjs`; kiểm trang bằng Playwright `node chup-mat-do/trang-thu-check.mjs [--all] [--browsers chromium,webkit] [--gap 5] [--base <link>]`.
9. Bảng: `node chup-mat-do/tong-hop.mjs` (vòng 1–2), `tong-hop-v3.mjs`, `tong-hop-v4.mjs`, `tong-hop-v5.mjs` (chỉ đọc file kết quả, không gọi mạng).
10. Test (không mạng, không đọc `D:\tmp`): `node --test` trong `test-ocr/chup-mat-do`.

## Cách đo, chống ăn gian, CHỐT trước khi chạy

- Mỗi vòng ghi khối "CHỐT TRƯỚC KHI CHẠY" (luật tìm, model, kiểu số, cách chọn chỉ mục, luật dừng) vào đầu `tong-hop-v<n>.md` TRƯỚC mọi lần đo; script tổng hợp không sửa phần đó (thiếu khối CHỐT thì dừng, không ghi).
- Đúng mã vị trí 1 / trong 5 đầu: `rankOf` trên 5 kết quả đầu; mẫu số luôn ghi rõ (ảnh lỗi / không chạy tính là sai). Đúng tên / thương hiệu: `textMatch` (bỏ dấu, bỏ từ chỉ loại hàng, tỉ lệ từ chung trên đáp án ≥ 0,5 và có từ chung ≥ 3 chữ cái).
- Cách 2 không được dùng chính `front.jpg` làm ảnh chỉ mục: ảnh chỉ mục phải là ảnh mặt trước KHÁC trên OFF (khác imgid, dHash / pHash vùng giữa > 24 bit, xem tay mọi ảnh); chỉ còn 2/31 mã dùng được (bộ chính, n = 2) nên thêm bộ phụ leave-one-out 15 cặp VN và bộ phụ mở rộng 83 cặp (sản phẩm ngoài VN, chỉ tham khảo, xem tay 10 cặp: 0 cùng tấm, 6 cùng mặt khác lần chụp, 4 khác hẳn).
- 28/31 ảnh thử trùng ảnh đã có trên OFF (chữ trên ảnh cũng có trong dữ liệu OFF) nên số của cách đọc chữ + T1 có thể cao hơn thực tế.
- Giây: trung vị / lớn nhất mỗi ảnh; bộ nhớ: working set (phần đang nằm trong RAM) đỉnh của cả cây tiến trình trình duyệt (gồm trình duyệt trống), lấy mẫu 250 ms; byte tải lần đầu: cache trống, cộng byte qua mạng. Máy: Intel i7-6820HQ (4 nhân / 8 luồng), RAM 8 GB, Windows 10; WebKit = Playwright WebKit trên Windows (không phải Safari iPhone).
- Open Food Facts: `search.pl` ≤ 10 lượt / phút, có `app_name` / `app_version`, cache, cầu dao khi lỗi liền; ảnh tải từ bucket AWS dữ liệu mở, giãn ≥ 1 giây. Gemini theo luật hồ sơ (gói miễn phí, dừng ở lỗi hạn mức). Không gọi Claude / Anthropic / Azure / Google Vision.

## Kết quả (07–08/11/2026)

| Cách | Chạy trong app được không | Đúng mã vị trí 1 | Trong 5 đầu | Giây/ảnh WebKit / Chromium | Bộ nhớ | Dung lượng tải lần đầu | Cần key | Chi phí | Số lượt Gemini / OCR.space |
|---|---|---|---|---|---|---|---|---|---|
| 1a PaddleOCR.js + search.pl (S2) | có (search.pl có CORS khi trả 200; khi 503 thì không) | WebKit 1/30 · Chromium 2/30 | WebKit 2/30 · Chromium 3/30 | 5,8 / 5,3 (đọc chữ) + tìm OFF qua mạng | WS 1.198 / 1.176 MB | 18,6 / 18,7 MB | không | 0 | 0 / 0 |
| 1a + T1 (Chromium, WebKit) | có (danh mục tĩnh) | WebKit 8/30 · Chromium 10/30 | WebKit 19/30 · Chromium 19/30 | 5,8 / 5,3 (đọc chữ) + tìm < 0,1 ms | WS 1.198 / 1.176 MB | 18,6 / 18,7 MB + danh mục 37,5 KB gzip (bản đo; trang thử 47,2 KB gzip) | không | 0 | 0 / 0 |
| Trang thử (1a + T1, 30 ảnh, bản build trên máy) | có (chính là bản cho điện thoại, `chup-mat-do.html`) | WebKit 8/30 · Chromium 10/30 | WebKit 19/30 · Chromium 19/30 (top5 trùng 1a + T1 đã đo 30/30 mỗi trình duyệt) | bấm → xong, 29 ảnh sau ảnh đầu: trung vị 5,4 / 3,5, lớn nhất 8,6 / 5,5; ảnh đầu (gồm tải PaddleOCR) 10,4 / 9,8 | không đo ở lượt này (cùng PaddleOCR như 1a) | cùng file CDN như 1a (19 request) + danh mục 47,2 KB gzip | không | 0 | 0 / 0 |
| 1b tesseract.js + search.pl (S2) | có | 0/30 · 0/30 | 0/30 · 0/30 | 1,0 / 0,5 | WS 880 / 1.123 MB | 5,8 MB | không | 0 | 0 / 0 |
| 1c OCR.space | bỏ: không có key | – | – | – | – | – | có (chưa có key) | 0 | 0 / 0 |
| 1d PP-OCRv5 det + VietOCR + T1 | không (Python, máy chủ) | 10/30 (search.pl S2: 1/30) | 17/30 (search.pl S2: 1/30) | không chạy trong trình duyệt / 2,3 (CPU máy tính) | – | – (máy chủ) | không | 0 | 0 / 0 |
| 2 CLIP ViT-B/32 (tìm theo hình) | có trên Chromium; WebKit Windows cần lớp thay OffscreenCanvas | bộ chính 1/2 · bộ phụ 7/15 · bộ phụ mở rộng 38/83 | bộ chính 2/2 · bộ phụ 10/15 · bộ phụ mở rộng 60/83 | 0,90 (lớp thay) / 0,28 | WS 2.676 / 1.190 MB | 95,4 MB (thư viện 5,7 + model 89,2 + chỉ mục 0,5) | không | 0 | 0 / 0 |
| 2 DINOv2-small | có trên Chromium; WebKit cần lớp thay | bộ chính 1/2 · bộ phụ 4/15 | bộ chính 2/2 · bộ phụ 9/15 | 1,73 (lớp thay) / 0,44 | WS 3.231 / 907 MB | 30,6 MB | không | 0 | 0 / 0 |
| T1 + ảnh RRF (1a Chromium + CLIP, k = 60) | có trên Chromium (chưa ghép thành trang) | bộ chính 1/2 · bộ phụ 9/15 · bộ phụ mở rộng 54/83 | bộ chính 2/2 · bộ phụ 11/15 · bộ phụ mở rộng 73/83 | ≈ 1a + CLIP (chưa đo chung) | chưa đo chung | ≈ 18,7 + 95,4 MB | không | 0 | 0 / 0 |
| 3 Florence-2 base q4 | có trên Chromium; WebKit sập 2/2 lần | Chromium 4/30 | Chromium 7/30 | sập / 40,2 (lớn nhất 88,8) | WS tới 2.799 MB rồi sập / 2.260 MB | 339,8 MB | không | 0 | 0 / 0 |
| 3 SmolVLM-256M | bỏ: > 120 giây/ảnh mọi kiểu số (q4, q8, fp16; Chromium wasm, cả lúc máy rảnh) | – | – | – / > 120 | WS 2.316–4.435 MB (Chromium) | 266,4–521,2 MB | không | 0 | 0 / 0 |
| 4a Gemini (gemini-3.6-flash) + T1 | không (cần key, máy chủ Google) | 5/12 (search.pl S2: 0/12) | 9/12 (search.pl S2: 0/12) | – / 6,8 (gồm mạng) | – | – | có | 0 (gói miễn phí) | 23 (vòng 2; vòng 3–6 không gọi) / 0 |
| 4b qwen2.5vl:3b (Ollama) + T1 | không (máy tính, CPU) | 4/8 chạy xong · 4/10 đã thử · 4/30 tổng | 4/8 chạy xong · 4/10 đã thử · 4/30 tổng | – / 283,2 (CPU, 8 ảnh xong; luật dừng 291,4 cả 10 ảnh) | WS ollama 3.935 MB | model 3,20 GB | không | 0 | 0 / 0 |

Mẫu số: 1a / 1b / 1d / Florence / trang thử = 30 ảnh (ảnh lỗi tính sai); cách 2 và RRF: bộ chính 2 mã dùng được trên 31 (chống ăn gian), bộ phụ 15 cặp VN leave-one-out, bộ phụ mở rộng 83 cặp ngoài VN (tham khảo, chỉ mục khác chỉ mục app); 4a = 12 ảnh có kết quả (dừng vì hết hạn mức miễn phí ở 12/30); 4b ghi 3 mẫu số. Bộ nhớ trang thử không đo ở lượt 30 ảnh; số WS của 1a là của lượt đo vòng 1–2 (cả cây tiến trình, WebKit Windows có Playwright.exe nền ~0,8 GB).

Cách thắng cho app: 1a PaddleOCR.js + T1 – thắng có điều kiện. Số: trong 5 đầu 19/30 Chromium / 19/30 WebKit (63%; vị trí 1 10/30 / 8/30), trang thử 30 ảnh trên bản build ở máy cũng 19/30 / 19/30 (top5 trùng 1a + T1 đã đo 30/30); WebKit đọc chữ 5,8 giây/ảnh trung vị (trang thử bấm → xong 5,4 giây trung vị, lớn nhất 8,6; ảnh đầu 10,4 giây gồm tải PaddleOCR), dưới ngưỡng ~15 giây; tải lần đầu 18,6 MB (WebKit) + danh mục 47,2 KB gzip; bộ nhớ WS đỉnh 1.198 MB (WebKit Windows, cả cây tiến trình) / 1.176 MB (Chromium); không key; chi phí 0; trang không gọi Open Food Facts. Điều kiện: (i) 28/31 ảnh thử trùng ảnh trên Open Food Facts (chữ trên ảnh đã có trong dữ liệu OFF) nên tỉ lệ thật có thể thấp hơn; (ii) chỉ tìm được sản phẩm có trong danh mục VN 1.452 sản phẩm (bản xuất JSONL của OFF tải 08/11/2026, sản phẩm có `countries_tags` `en:vietnam`; danh mục xuất ngày 2026-11-08); sản phẩm không có trên OFF / không gắn VN thì không bao giờ ra; (iii) chưa thử iPhone / Android thật (WebKit ở đây là Playwright WebKit trên Windows); (iv) danh mục tĩnh cần xuất lại định kỳ. Trang thử WebKit 30 ảnh ra 19/30 (≥ 15/30) nên không rơi vào trường hợp "không cách nào qua ngưỡng trên WebKit".

Nếu có máy chủ: 1d PP-OCRv5 det + VietOCR + T1 (miễn phí, không giới hạn lượt) là thực tế nhất; 4a Gemini đúng cao hơn trên 12 ảnh nhưng cần key + hạn mức; 4b qwen2.5vl:3b chậm (283 giây/ảnh trên CPU) và giấy phép chỉ nghiên cứu.

## Nguồn + giấy phép

- Dữ liệu: Open Food Facts, bản xuất JSONL chính thức (https://world.openfoodfacts.org/data): cơ sở dữ liệu ODbL 1.0, nội dung DbCL 1.0, ảnh CC BY-SA 3.0. Danh mục trang thử là cơ sở dữ liệu phái sinh, phát hành theo ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/).
- PaddleOCR.js 0.4.2 (Apache-2.0), model PP-OCRv5_mobile_det + latin_PP-OCRv5_mobile_rec của PaddlePaddle (Apache-2.0); onnxruntime-web (MIT); tesseract.js (Apache-2.0).
- CLIP ViT-B/32 (Xenova/clip-vit-base-patch32, MIT); DINOv2-small (Xenova/dinov2-small, Apache-2.0); MobileCLIP bỏ vì giấy phép Apple chỉ cho nghiên cứu.
- Florence-2 base (onnx-community/Florence-2-base-ft, MIT); SmolVLM-256M-Instruct (HuggingFaceTB, Apache-2.0); transformers.js 4.3.1 (Apache-2.0).
- qwen2.5vl:3b (thư viện Ollama; model gốc Qwen/Qwen2.5-VL-3B-Instruct, "Qwen RESEARCH LICENSE AGREEMENT", chỉ nghiên cứu / phi thương mại): chỉ đo trên máy, không đưa vào app.
- VietOCR 0.3.13 (Apache-2.0), chỉ máy tính.

## Trang thử `chup-mat-do.html` (điện thoại thật)

`public/chup-mat-do.html` (+ `public/chup-mat-do/t1.mjs`, `tar.mjs`, `danh-muc-vn.json`) là trang riêng, **không có link nào từ app**, có `noindex`; Vite chép nguyên vào `dist/`; trên Pages ở `https://khangnguyen196.github.io/quet-ma-vach-full/chup-mat-do.html`. Ảnh chỉ xử lý trong trình duyệt; trang KHÔNG gọi openfoodfacts.org (link trang sản phẩm chỉ để người dùng bấm).

- Cách làm = 1a + T1: PaddleOCR.js (PP-OCRv5 mobile det + latin rec, wasm 1 luồng, thư viện + model từ jsDelivr / HuggingFace đúng bản ghim của `web-ocr/assets.js` chế độ `cdn`, như `ocr-thu.html`; giấu `navigator.gpu`) đọc chữ, nối khung cùng hàng, rồi T1 (BM25) trên danh mục tĩnh `chup-mat-do/danh-muc-vn.json` (1.452 sản phẩm VN, 194,3 KB thô / 47,2 KB gzip; chỉ code, tên, thương hiệu, chữ tìm). Không có CLIP (95 MB, tới 2,7 GB bộ nhớ).
- `t1.mjs` là bản trình duyệt của T1 (`lib.mjs` + `vn-data.mjs` là chuẩn): sửa luật thì chạy `node chup-mat-do/trang-thu-parity.mjs` (30 câu tìm của 1a Chromium: câu tìm + top5 + điểm trùng 30/30).
- Lỗi tải danh mục (mã HTTP / mạng / file hỏng), nạp PaddleOCR lỗi, ảnh không đọc được chữ nào: báo câu tiếng Việt (gán bằng `textContent`), không lỗi JS.
- Kiểm bằng Playwright: `node chup-mat-do/trang-thu-check.mjs` (mặc định build + server tĩnh trên `dist/`, 3 ảnh đầu; `--all` 30 ảnh; `--gap <giây>`; `--base <link>` không build, không dựng server). Mỗi lần chạy ghi request (0 tới openfoodfacts.org, 0 POST, chỉ cùng tên miền + jsDelivr / HuggingFace), bước service worker (tải lại `chup-mat-do.html` khi service worker điều khiển trang vẫn là trang thử; Cache Storage không có URL `chup-mat-do`, `ocr-thu`, khác tên miền) và `index.html` của app vẫn mở được.
- Kết quả trang thử 30 ảnh trên bản build ở máy (08/11/2026, `trang-thu-check.mjs --all`, Chromium 156 rồi WebKit 26.0): vị trí 1 10/30 (Chromium) / 8/30 (WebKit), trong 5 đầu 19/30 / 19/30; top5 trùng 1a + T1 đã đo (`t1.json`) 30/30 mỗi trình duyệt; giây bấm → xong (29 ảnh sau ảnh đầu) trung vị 3,5 / 5,4, lớn nhất 5,5 / 8,6, ảnh đầu (gồm tải PaddleOCR 6,7 / 5,1 giây) 9,8 / 10,4; 19 request mỗi trình duyệt (127.0.0.1, cdn.jsdelivr.net, huggingface.co, us.aws.cdn.hf.co), 0 POST, 0 tới openfoodfacts.org; bước service worker đạt cả 2 (Cache Storage 10 URL, không có trang thử / khác tên miền); `index.html` của app mở được. Console có 27 dòng cảnh báo của onnxruntime ("Removing initializer …", in ở mức error), không phải lỗi trang.
- Kiểm trên Pages sau khi lên main (3 ảnh, giãn 5 giây): `node chup-mat-do/trang-thu-check.mjs --base https://khangnguyen196.github.io/quet-ma-vach-full/ --browser chromium --gap 5 --out D:/tmp/chup-mat-do/ket-qua/trang-thu-pages-chromium.json` rồi `node chup-mat-do/trang-thu-check.mjs --base https://khangnguyen196.github.io/quet-ma-vach-full/ --browser webkit --gap 5 --out D:/tmp/chup-mat-do/ket-qua/trang-thu-pages-webkit.json` (không có `--out` thì 2 lần cùng ghi `trang-thu-pages.json`).
- Giới hạn đã biết: sửa trang thử vẫn đổi VERSION app (thanh "Đã có bản mới"); mất mạng / mạng chậm quá 3 giây thì địa chỉ trang thử có thể trả `index.html` của app (như `ocr-thu.html`; kéo xuống để tải lại); chưa có integrity (SRI) cho file CDN; chạy chung tên miền với app (script CDN đọc được `localStorage` của app, mọi bản đều ghim).

---

# Phần F – Thử nhiều model OCR cho "chụp mặt trước" (đợt `ocr-mat`)

Mục tiêu: trên đúng 30 ảnh `front.jpg` của Phần E, GIỮ NGUYÊN câu tìm + T1 + cách chấm, xem OCR nào cho nhiều mã đúng hơn 1a PaddleOCR.js mobile (19/30 trong 5 gợi ý cả 2 trình duyệt; vị trí 1 10/30 Chromium, 8/30 WebKit). Chỉ đo, không sửa app, không sửa trang thử ở vòng 1.

## Chốt trước khi đo (11/11/2026, vòng 1, commit riêng TRƯỚC mọi lần chạy OCR mới)

- Câu tìm + T1 + chấm giữ nguyên chup-mat-do: câu tìm `t1QueryFromLines` (dòng qua `usableLine`: MIN_CONF 0,5, MIN_LETTERS 3, bỏ STOP_PHRASES / số / đơn vị / từ nhiễu), T1 = `buildBm25` + `bm25Search` (BM25 k1 1,2, b 0,75) trên danh mục VN 1.452 sản phẩm (`D:\tmp\chup-mat-do\chi-muc\danh-muc-vn.json`), chấm `rankOf` (vị trí 1, trong 5 đầu) + `scoreHits` (đúng tên = `textMatch` tên hiển thị của gợi ý 1 với đáp án; đúng thương hiệu = `brandMatch`). Không đổi luật nào trong `lib.mjs` / `vn-data.mjs` / `t1.mjs`.
- Bộ chấm chung `chup-mat-do/t1-ocr.mjs`: công cụ có khung chữ thì nối khung cùng hàng bằng ĐÚNG `rowLines` của `web-ocr/lib.mjs` (cách 1a) rồi mới tạo câu tìm; không có khung thì dùng dòng công cụ trả. Độ tin quy về 0–1 (tesseract.js chia 100), công cụ không có độ tin thì `null` (không lọc theo độ tin). Mẫu số luôn 30 (mã của `truth.csv` có `front.jpg`); ảnh lỗi / thiếu / quá giờ tính sai. Hồi quy: 1a-chromium, 1a-webkit, 1d chấm lại phải trùng `t1.json` (câu tìm + top5) 30/30 mỗi bộ.
- Không tinh chỉnh theo từng ảnh. Mỗi model MỘT cấu hình chọn trước (ghi dưới đây), chỉ đổi khi chạy lỗi (ghi lý do + lỗi thật).
- Luật dừng: mỗi model ≤ ~2 giờ đồng hồ (gồm cài + chạy); 3 ảnh đầu trung vị > 120 giây/ảnh thì dừng model đó; chạy dở thì ghi "x/n chạy xong · x/30 tổng". Cả vòng ~6 giờ chạy OCR, hết giờ thì ghi phần chưa làm sang vòng sau.
- Đo bằng CPU (máy Intel i7-6820HQ 4 nhân / 8 luồng, RAM 7,8 GB, Windows 10). GPU Quadro M1000M 2 GB đời cũ: không bắt buộc, chỉ ghi thêm nếu tiện. Riêng 2b dùng WebGPU trong trình duyệt (adapter mặc định của Chrome, xem dưới).
- Đo trình duyệt như Phần D / E: `web-ocr/run-browser.mjs`, khổ 390×844, DPR 3, wasm 1 luồng (không COOP / COEP), ảnh thu cạnh dài về 1.600 px, giây đọc chữ / ảnh (trung vị + lớn nhất), working set (WS) đỉnh cả cây tiến trình (mẫu 250 ms), byte tải lần đầu (`--mode cdn --limit 1`, cache trống). Đo máy tính (Python): `ocr-mat/do_tai_nguyen.py` (giây/ảnh trung vị + lớn nhất không tính ảnh đầu, thời gian nạp model riêng, RSS đỉnh cả tiến trình con mẫu ≤ 0,5 giây, dung lượng model trên đĩa).
- Ngưỡng ĐỔI trang thử `chup-mat-do.html` sang OCR khác (cần đạt CẢ 7): (1) trong 5 gợi ý ≥ 22/30 trên CẢ Chromium và WebKit; (2) vị trí 1 ≥ 10/30 Chromium và ≥ 8/30 WebKit (không thấp hơn 1a); (3) WebKit ≤ 15 giây/ảnh trung vị; (4) tải lần đầu ≤ 150 MB; (5) WS đỉnh ≤ 2.000 MB; (6) giấy phép cho dùng; (7) thư viện + model từ CDN đúng bản ghim. WebGPU (cùng model) không phải lý do đổi trang thử.
- Ghép (P4, vòng sau): lấy 2 OCR có "trong 5 đầu" cao nhất (hòa thì vị trí 1 cao hơn, rồi nhanh hơn), hợp các cụm chữ, bỏ cụm trùng sau chuẩn hóa không dấu, rồi câu tìm như trên; thêm tổ hợp "tốt nhất trình duyệt + tốt nhất máy tính" nếu khác 2 cái trên.
- OCR.space: vòng 2 chạy `chup-mat-do/ocrspace.mjs` có sẵn theo luật chung của hồ sơ (gói miễn phí, ≤ 40 lượt / lần, giãn ≥ 3 giây, đếm vào `outputs/api_usage.json`); không có key thì bỏ, 0 lượt. Vòng 1 không gọi Gemini, OCR.space, Google Vision, Azure, Anthropic, Open Food Facts.
- Model chỉ từ nguồn chính thức (HuggingFace / GitHub của tác giả / PaddlePaddle), thư viện trình duyệt từ jsDelivr / npm đúng bản ghim; model cần đăng ký / token / đồng ý điều khoản thì bỏ. Mọi thứ tải về ở ổ D (`D:\cache\...`, `D:\tmp\ocr-mat\`), không commit model / OCR thô / kết quả thô.

Cấu hình chọn trước (vòng 1, trong trình duyệt; mọi cách: `@paddleocr/paddleocr-js` 0.4.2, onnxruntime-web 1.24.3, tham số mặc định của SDK, `--join rows --only front --lines`, như 1a):

| Cách | Model (HuggingFace PaddlePaddle, ghim mã commit) | Trình duyệt / backend |
|---|---|---|
| 2b PP-OCRv5 mobile WebGPU | như 1a: `PP-OCRv5_mobile_det_onnx` + `latin_PP-OCRv5_mobile_rec_onnx` | Chrome 157 bản cài trên máy (Playwright `channel: "chrome"`, headless, không cờ; `requestAdapter()` ra adapter thật Intel gen-9 HD 530; chỉ thêm `--enable-unsafe-webgpu` nếu adapter null); `ort=webgpu` (backend "auto" của SDK, tự lùi wasm), ghi backend thật. Đối chứng cùng Chrome 157 chạy `ort=wasm` để so giây/ảnh công bằng. WebKit Windows: không có `navigator.gpu` -> ghi "không có WebGPU" (số = 1a WebKit). Chromium headless shell 156 (máy đo của 1a): `requestAdapter()` trả null (dò 11/11/2026). |
| 2a(a) server det + server rec | `PP-OCRv5_server_det_onnx` @dcf248c4 (88,1 MB) + `PP-OCRv5_server_rec_onnx` @b70df217 (84,5 MB); Apache-2.0 | Chromium headless shell 156 + WebKit 26.0 (như 1a), wasm. `server_rec` là bộ chữ Trung / Anh (18.383 ký tự), thiếu 48/67 chữ thường có dấu tiếng Việt (thiếu cả ơ, ư; có á à ã ă â đ ê ô…) |
| 2a(b) server det + latin mobile rec | `PP-OCRv5_server_det_onnx` @dcf248c4 + `latin_PP-OCRv5_mobile_rec_onnx` (bản 1a) | như 2a(a) |
| 2c docTR trình duyệt | bỏ trước khi đo: bản trình duyệt chính thức (`mindee/doctr-tfjs-demo`, TensorFlow.js, CRNN MobileNet V2) có bộ chữ tiếng Pháp (không có ả ạ ă ơ ư đ…); mọi model nhận dạng có sẵn của docTR 1.1.0 (crnn, master, sar, vitstr, parseq, viptr) cũng bộ chữ `french`; model `Felix92/onnxtr-parseq-multilingual-v1` (ONNX, Apache-2.0) có 195 ký tự, không có chữ tiếng Việt riêng (ả ạ ầ ơ ư đ…), và chỉ có bản Python (OnnxTR), không có bản trình duyệt | – |

## Chạy (trong thư mục `test-ocr`)

- Bộ chấm T1 cho OCR bất kỳ: `node chup-mat-do/t1-ocr.mjs --dir <thư mục OCR> --name <tên> [--tool paddlejs|tesseractjs|vietocr | --scale <số>] [--so-t1 1a-chromium|1a-webkit|1d]` -> `D:\tmp\ocr-mat\ket-qua\<tên>.json` + 1 dòng bảng. Vào: mỗi ảnh `<mã>__front.json` dạng `{ items: [{ text, conf, box: { minX, minY, maxX, maxY } }] }` (có khung, nối hàng bằng `rowLines`), `{ lines: [{ text, conf }] }` hoặc `{ text }`; định dạng cũ của `paddlejs-rows-*` / `tesseractjs-*` / `vietocr-1d` đọc được luôn. `--so-t1`: so câu tìm + top5 từng ảnh với `t1.json` (lệch thì in ảnh lệch, mã thoát 1).
- OCR trong trình duyệt: `web-ocr/run-browser.mjs` như Phần D / E, thêm (chỉ thêm, mặc định giữ nguyên): `--det mobile|server`, `--rec latin|server` (model PP-OCRv5 server ONNX chính thức, ghim mã commit trong `web-ocr/assets.js`, bản trên máy ở `D:\cache\paddle-onnx\`), `--ort wasm|webgpu` (bỏ bước dò WebGPU), `--channel chrome|msedge` (Chrome / Edge bản cài trên máy), `--tag <hậu tố>` (bắt buộc khi dùng tùy chọn thêm; kết quả ở thư mục `<công cụ>-<tag>`). Ví dụ 2b: `node web-ocr/run-browser.mjs --engine paddlejs --join rows --only front --lines --browser chromium --channel chrome --ort webgpu --tag webgpu --out 'D:\tmp\ocr-mat\ocr' --photos 'D:\quet-ma-vach-full\test-ocr\photos'`.
- Đo tài nguyên OCR Python (vòng sau): venv `D:\tmp\ocr-mat\venv` (`pip install -r ocr-mat/requirements.txt`), `python ocr-mat/do_tai_nguyen.py --name <tên> --ocr-dir <thư mục> --model <đường dẫn model> -- <lệnh OCR>`.
- Test: `node --test` trong `chup-mat-do` và `web-ocr`; `python -m pytest -p no:cacheprovider ocr-mat` (venv trên).

## Kết quả vòng 1 (11/11/2026)

Hồi quy bộ chấm: chấm lại OCR thô cũ của 1a-chromium, 1a-webkit, 1d trùng `t1.json` (câu tìm + top5) 30/30 mỗi bộ (10/19, 8/19, 10/17). Thử đỏ: sửa 1 dòng chữ ("VISSAN" -> "VINAMILK") trong bản chép OCR 1a-chromium -> bộ so báo lệch đúng ảnh 8934572260543 (29/30, mã thoát 1); bản gốc -> 30/30.

| Cách | Vị trí 1 (/30) | Trong 5 đầu (/30) | Đúng tên / thương hiệu (/30) | Giây/ảnh trung vị (lớn nhất), WebKit / Chromium | Tải lần đầu | WS đỉnh (cả cây) | Giấy phép | Chạy trong app được không | Qua ngưỡng đổi trang thử |
|---|---|---|---|---|---|---|---|---|---|
| 1a PaddleOCR.js mobile + T1 (Phần E, để so; chấm lại bằng `t1-ocr.mjs`) | WebKit 8 · Chromium 10 | 19 · 19 | WebKit 14 / 10 · Chromium 16 / 11 | 5,8 (8,4) / 5,3 (9,5) | 18,6 / 18,7 MB | 1.198 / 1.176 MB | Apache-2.0 | có (đang là trang thử) | – (là mốc) |
| 1b tesseract.js + T1 (chấm lại từ OCR thô cũ, thang 100, không chạy lại OCR) | WebKit 2 · Chromium 1 | 3 · 2 | WebKit 3 / 1 · Chromium 1 / 0 | 1,0 (1,5) / 0,5 (1,2) | 5,8 MB | 880 / 1.123 MB | Apache-2.0 | có | không (5 đầu 3 / 2) |
| 2b PP-OCRv5 mobile WebGPU (Chrome 157 bản cài, adapter Intel gen-9, backend thật `webgpu`) | WebKit: không có WebGPU (`navigator.gpu` không có trên Playwright WebKit 26.0 Windows) -> như 1a · Chrome 7 | – · 19 | – · 14 / 10 | – / trung vị 2,1; lớn nhất 10,6 (ảnh đầu); lớn nhất các ảnh sau 3,0 | – / 19,5 MB (bản ort có WebGPU) | – / 2.738 MB | Apache-2.0 | có trên Chrome có WebGPU, luôn có đường lùi wasm | không (WebGPU không phải lý do đổi; vị trí 1 7 < 10; WS 2.738 > 2.000) |
| 2b đối chứng: cùng Chrome 157, `ort=wasm` | – · 7 | – · 19 | – · 14 / 10 | – / 4,3 (10,6) | – | – / 1.921 MB | Apache-2.0 | – | – |
| 2a(a) PP-OCRv5 server det + server rec (wasm) | DỪNG theo luật 3 ảnh đầu: 3/3 chạy xong · 2/30 tổng (cả 2 trình duyệt) | 3/3 chạy xong · 3/30 tổng | 2 / 2 (3 ảnh) | 149,1 (200,1) / 126,7 (170,7) — 3 ảnh đầu, > 120 | 178,4 / 178,5 MB | 2.112 / 2.120 MB (3 ảnh) | Apache-2.0 | không (quá chậm, quá nặng) | không |
| 2a(b) PP-OCRv5 server det + latin mobile rec (wasm) | WebKit DỪNG theo luật 3 ảnh đầu (120,7 > 120): 2/3 · 2/30 tổng · Chromium **16** | WebKit 3/3 · 3/30 tổng · Chromium **22** | WebKit 2 / 2 (3 ảnh) · Chromium 21 / 16 | 120,7 (155,6) 3 ảnh / 78,8 (138,3) | 101,9 / 102,0 MB | 1.945 (3 ảnh) / 2.256 MB | Apache-2.0 | không (WebKit > 120 giây/ảnh) | không (WebKit dừng; > 15 giây/ảnh; WS Chromium 2.256 > 2.000) |
| 2c docTR trình duyệt | bỏ trước khi đo (xem Chốt: bộ chữ không có tiếng Việt, không có bản trình duyệt có tiếng Việt) | – | – | – | – | – | Apache-2.0 | – | – |

Ghi chú:
- Mẫu số luôn 30, ảnh không chạy (dừng theo luật) tính sai. Giây = giây đọc chữ / ảnh (không gồm nạp model), trung vị cả các ảnh đã chạy. WS = working set đỉnh cả cây tiến trình trình duyệt (mẫu 250 ms; WebKit Windows gồm Playwright.exe nền ~0,8 GB). Tải lần đầu = byte qua mạng, cache trống, 1 ảnh (`--mode cdn --limit 1`); HuggingFace không nén file ONNX nên server det 88,1 MB + server rec 84,5 MB tải nguyên.
- 2b: chữ đọc ra bằng WebGPU giống hệt chữ đọc bằng wasm trên CÙNG Chrome 157 (30/30 ảnh; độ tin lệch tối đa 0,00005), WebGPU nhanh gấp ~2 (2,1 so với 4,3 giây/ảnh) nhưng WS cao hơn (2.738 so với 1.921 MB). So với 1a (Chromium headless shell 156) thì top5 khác ở 11/30 ảnh (8934803043891 hạng 1 -> ngoài 5; 8934673300759 1 -> 3; 8936012061321 1 -> 2; 8936025773181 1 -> 2; 8936017367107 2 -> 4; 8935039511024 ngoài 5 -> 1; 8938501141477 1 -> 1; 8936036029819, 8935001214274, 8935049511021, 8936134361040 ngoài 5 cả hai) và đối chứng wasm khác 1a ở đúng 11 ảnh đó: chỗ khác do bản trình duyệt (Chrome 157 bản đầy đủ so với headless shell 156, khác cách giải mã / thu nhỏ ảnh), không do WebGPU.
- 2a(a): `server_rec` là bộ chữ Trung / Anh 18.383 ký tự, thiếu 48/67 chữ thường có dấu tiếng Việt (thiếu ơ, ư, ả, ạ, ế…); trên 3 ảnh đã chạy vẫn ra đúng mã (vị trí 1 2/3, 5 đầu 3/3, như 1a trên 3 ảnh này) nhưng 95–200 giây/ảnh.
- 2a(b) trên Chromium tăng rõ: vị trí 1 16/30 (1a 10), trong 5 đầu 22/30 (1a 19), đúng tên 21/30 (1a 16), top5 khác 1a ở 21/30 ảnh (lên: 8936221044160 ngoài 5 -> 1, 8936036020977 ngoài 5 -> 2, 8936036027099 4 -> 1, 8936079120276 3 -> 1, 8934840000130 2 -> 1, 8935039511024 ngoài 5 -> 1, 8936134361040 ngoài 5 -> 1; xuống: 8936221043071 5 -> ngoài 5, 8936045081310 4 -> 5). Cái được là bước dò khung `server_det` (88 MB, HGNetV2) nhưng nó chậm ~15 lần trên wasm 1 luồng: 78,8 giây/ảnh Chromium, WebKit 3 ảnh đầu 120,7 giây/ảnh trung vị -> dừng theo luật. Chỉ hợp làm cách máy chủ (vòng sau đo bằng Python CPU).
- Không cách nào qua ngưỡng đổi trang thử; trang thử giữ 1a.
- Thời gian đồng hồ: P1 (bộ chấm + test + hồi quy + 1b + đo tài nguyên) 12:40–12:50; commit Chốt 12:50:42; OCR đầu tiên bắt đầu 12:52:49; 2b 12:52–12:57 (+ đo tải 14:05); 2a(a) 12:57–13:12 (dừng) + đo tải; 2a(b) 13:12–13:56 + đo tải; đo tải lần đầu 13:56–14:06. Tổng chạy OCR ~1 giờ 15 phút.
- Nguồn: PP-OCRv5 server det / rec: https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det_onnx (Apache-2.0, mã commit dcf248c4…), https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec_onnx (Apache-2.0, b70df217…), không cần đăng ký. docTR: https://github.com/mindee/doctr (1.1.0, `doctr/datasets/vocabs.py`, model nhận dạng `vocab: VOCABS["french"]`), https://github.com/mindee/doctr-tfjs-demo (`src/common/constants.ts`: VOCAB tiếng Pháp), https://huggingface.co/Felix92/onnxtr-parseq-multilingual-v1 (`config.json`, 195 ký tự).

## Chốt bổ sung (vòng 2): cấu hình model chạy trên máy tính (11/11/2026, commit riêng TRƯỚC lần chạy model Python đầu tiên)

Chỉ thêm, không đổi Chốt trên: câu tìm + T1 + chấm (`t1-ocr.mjs`), luật dừng (≤ ~2 giờ / model gồm cài + chạy; 3 ảnh đầu trung vị > 120 giây/ảnh thì dừng), đo bằng CPU giữ nguyên. Mỗi model MỘT cấu hình dưới đây, chỉ đổi khi chạy lỗi (ghi lỗi thật + lý do).

Chung cho mọi model Python:
- Máy: Intel Core i7-6820HQ (4 nhân / 8 luồng), RAM 7,8 GB, Windows 10, CPU (không dùng GPU). Số luồng: 8 (onnxruntime `intra_op_num_threads` 8 + `inter_op_num_threads` 1; PyTorch `torch.set_num_threads(8)`; Tesseract `OMP_THREAD_LIMIT` 8).
- Ảnh vào: `front.jpg` xoay theo EXIF, thu cạnh dài về 1.600 px (chỉ thu nhỏ, BICUBIC, làm tròn như `web-ocr/harness.mjs`), RGB, đưa thẳng vào thư viện (không nén JPEG lại). Model tự thu ảnh bên trong (vd Florence-2 768 × 768) thì để model tự làm, ghi rõ.
- Chạy: `ocr-mat/chay_ocr.py --model <tên> --out D:\tmp\ocr-mat\ocr\<tên>-v2` (mỗi model một hàm adapter) qua `ocr-mat/do_tai_nguyen.py` vào thư mục OCR MỚI. File mỗi ảnh: `{ code, model, status: "ok"|"loi", error?, items: [{ text, conf (0–1 hoặc null), box: {minX,minY,maxX,maxY} }], seconds, order, loadSeconds (ảnh đầu), width, height }`; công cụ không có khung ghi `{ lines: [{ text, conf }] }` hoặc `{ text }`. Chấm: `node chup-mat-do/t1-ocr.mjs --dir <thư mục> --name <tên>` (không `--tool`, độ tin đã quy 0–1 trong file).
- Python 3.12.6 (bản cài trên máy), mỗi nhóm thư viện một venv ở `D:\tmp\ocr-mat\venv-<tên>`; cache model `HF_HOME=D:\cache\hf`, `TORCH_HOME=D:\cache\torch`, `EASYOCR_MODULE_PATH=D:\cache\easyocr`, `XDG_CACHE_HOME=D:\cache`.

| Model | Thư viện (bản) | Model + nguồn chính thức + mã commit / phiên bản | Tham số | Giấy phép |
|---|---|---|---|---|
| R1 RapidOCR mặc định | `rapidocr` 3.10.0 + `onnxruntime` 1.31.1 (venv-rapid) | model có sẵn trong gói PyPI `rapidocr` 3.10.0 (RapidAI): `PP-OCRv6_det_small.onnx` + `PP-OCRv6_rec_small.onnx` + `ch_ppocr_mobile_v2.0_cls_mobile.onnx` | mặc định `config.yaml` của gói: Det `limit_side_len` 736 `limit_type` min, `thresh` 0,3, `box_thresh` 0,5, `unclip_ratio` 1,6; `use_cls` true; `text_score` 0,5; `max_side_len` 2.000 | Apache-2.0 |
| R2 RapidOCR + ONNX của 1a | như R1 | `PaddlePaddle/PP-OCRv5_mobile_det_onnx` @e6f4fa85 + `PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx` @89d3a50e (đúng bản ghim trong `web-ocr/assets.js`, file ở `D:\cache\paddle-onnx`), bộ ký tự lấy từ `character_dict` trong `inference.yml` của rec (`Det.model_path`, `Rec.model_path`, `Rec.rec_keys_path`); cls như R1 | như R1 (tiền / hậu xử lý của RapidOCR, KHÔNG phải của PaddleOCR.js: khác 1a ở cách thu ảnh dò khung, ngưỡng, có cls) | Apache-2.0 |
| R3 RapidOCR, 2a(b) trên CPU | như R1 | `PaddlePaddle/PP-OCRv5_server_det_onnx` @dcf248c4 (88,1 MB) + `latin_PP-OCRv5_mobile_rec_onnx` @89d3a50e | như R2 | Apache-2.0 |
| EasyOCR | `easyocr` 1.7.2 + `torch` 2.15.0 CPU (download.pytorch.org/whl/cpu) (venv-easyocr) | model mặc định EasyOCR tự tải lần đầu từ GitHub JaidedAI/EasyOCR (release của tác giả): dò khung CRAFT `craft_mlt_25k`, nhận dạng `latin_g2` (cho `vi` + `en`) | `Reader(['vi','en'], gpu=False)`, `readtext` tham số mặc định | Apache-2.0 |
| Tesseract | Tesseract 5.4.0.20240606 (bản Windows UB Mannheim, GitHub `UB-Mannheim/tesseract` release v5.4.0.20240606, giải nén bằng 7-Zip vào `D:\tools\tesseract` vì trình cài đòi quyền admin) + `pytesseract` 0.3.13 (venv-tess) | `tessdata` (bộ chuẩn, không phải `tessdata_best` / `tessdata_fast`) `vie` + `eng` từ GitHub `tesseract-ocr/tessdata` @ced78752 (ở `D:\cache\tessdata\ced78752`) | `lang=vie+eng`, psm mặc định (3), oem mặc định; `image_to_data`, lấy mức từ (level 5), độ tin chia 100, từ có độ tin -1 bỏ | Apache-2.0 |
| OnnxTR | `onnxtr[cpu-headless]` 0.9.0 (venv-onnxtr) | dò khung mặc định của OnnxTR (`fast_base`, tải từ GitHub release của tác giả felixdittrich92/OnnxTR) + nhận dạng `Felix92/onnxtr-parseq-multilingual-v1` @7d732994 (HuggingFace, 195 ký tự, KHÔNG có chữ Việt riêng: vẫn đo vì câu tìm T1 bỏ dấu khi so) | `ocr_predictor` mặc định (`assume_straight_pages` true, `preserve_aspect_ratio` true, không xoay trang), lấy mức từ | Apache-2.0 |
| OCeanpaRk-small-v1 | – | `ANZ-Innovation/OCeanpaRk-small-v1` @8f1e81e9: BỎ trước khi đo. Trang model là gated (phải "agree to share your Hugging Face information" và chờ duyệt; API trả `gated: manual`), metadata không ghi giấy phép (README chỉ nói "license in their metadata at the time of this release" của dữ liệu gốc) | – | không ghi |
| OCR.space (dịch vụ) | `chup-mat-do/ocrspace.mjs` có sẵn | Engine 2 (cấu hình cố định trong script) | ≤ 40 lượt / lần, ≤ 60 lượt cả đợt, giãn ≥ 3 giây; trang giá đọc 11/11/2026 (https://ocr.space/ocrapi): Free 25.000 lượt / tháng, 500 lượt / ngày / IP, file ≤ 1 MB | dịch vụ (gói Free) |

Phần nặng (P4; vòng này chỉ làm nếu còn giờ, không thì vòng 3; venv riêng `venv-<tên>`, cùng luật dừng):

| Model | Thư viện (bản) | Model + nguồn + mã commit | Tham số | Giấy phép |
|---|---|---|---|---|
| Florence-2 large | `transformers` 4.49.0 + `torch` 2.15.0 CPU, `trust_remote_code` (mã của repo tại commit ghim) | `microsoft/Florence-2-large` @21a599d4 (HuggingFace) | task `<OCR>` (chỉ chữ, không khung -> `{ text }`), `num_beams` 3, `max_new_tokens` 1024, `do_sample` false, float32; processor tự thu ảnh về 768 × 768 | MIT |
| Surya OCR | `surya-ocr` 0.23.0 (+ thư viện nó kéo theo: `transformers` ≥ 5.12.1, `torch` CPU) | nhận dạng `datalab-to/surya-ocr-2.5` @00c843e9 (HuggingFace); dò khung `text_detection/2025_05_07` (máy chủ model của tác giả models.datalab.to, mặc định của gói); `MODEL_CACHE_DIR` ở `D:\cache\datalab` | mặc định của gói (dò khung + nhận dạng, không layout), CPU | mã: Apache-2.0 (PyPI); model: OpenRAIL (bản sửa của tác giả, giới hạn dùng thương mại theo doanh thu: ghi rõ khi đo) |
| GOT-OCR2.0 | `transformers` (bản có `GotOcr2ForConditionalGeneration`, 4.49.0) + `torch` 2.15.0 CPU | `stepfun-ai/GOT-OCR-2.0-hf` @d3017ef2 (HuggingFace, bản chính thức cho transformers) | OCR thường (không `format`), `max_new_tokens` 4096, `do_sample` false, float32 -> `{ text }` | Apache-2.0 |
| PaddleOCR-VL | `transformers` (bản README model yêu cầu, ghi khi cài) + `torch` 2.15.0 CPU, `trust_remote_code` tại commit ghim | `PaddlePaddle/PaddleOCR-VL` @dae29965 (HuggingFace) | cả ảnh (không qua PP-DocLayoutV2), prompt `OCR:`, `max_new_tokens` 1024, `do_sample` false, float32 -> `{ text }` | Apache-2.0 |

## Kết quả vòng 2 (11/11/2026, model Python trên CPU)

Chấm bằng `chup-mat-do/t1-ocr.mjs` (mẫu số 30, luật như Chốt). Giây/ảnh CPU = `do_tai_nguyen.py` (bỏ ảnh đầu, 29 ảnh), nạp model riêng; RSS đỉnh = tổng cả cây tiến trình (mẫu 0,25 giây). "Đáng làm máy chủ" theo ngưỡng của Chốt bổ sung vòng 3 (dưới đây: 5 đầu ≥ 22, vị trí 1 ≥ 13, ≤ 15 giây/ảnh CPU, RSS ≤ 2.000 MB, giấy phép không điều kiện doanh thu).

| Cách | Vị trí 1 (/30) | Trong 5 đầu (/30) | Đúng tên / thương hiệu (/30) | Giây/ảnh CPU trung vị (lớn nhất) | Nạp model (giây) | RSS đỉnh | Dung lượng model | Giấy phép | Chạy trong app được không | Đáng làm máy chủ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1a PaddleOCR.js mobile (mốc, trình duyệt) | WebKit 8 · Chromium 10 | 19 · 19 | 14 / 10 · 16 / 11 | (trình duyệt) 5,8 / 5,3 | – | WS 1.198 / 1.176 MB | 12,9 MB | Apache-2.0 | có (đang là trang thử) | – |
| R1 RapidOCR mặc định (PP-OCRv6 small det + rec, cls) | 13 | 20 | 16 / 15 | 2,5 (6,7) | 3,2 | 472 MB | 30,3 MB | Apache-2.0 | chưa biết (Python); model ONNX nhỏ -> đo trong trình duyệt ở vòng 3 | không (5 đầu 20 < 22) |
| R2 RapidOCR + ONNX của 1a | 11 | 19 | 17 / 12 | 2,8 (4,1) | 1,8 | 473 MB | 12,8 MB | Apache-2.0 | (= model của 1a, khác tiền / hậu xử lý) | không (19 < 22) |
| R3 RapidOCR, 2a(b) trên CPU (server det + latin rec) | **14** | **22** | 22 / 14 | 11,2 (18,0) | 1,8 | 1.501 MB | 92,3 MB | Apache-2.0 | không (trình duyệt 79–121 giây/ảnh, vòng 1) | **CÓ** (22 ≥ 22, 14 ≥ 13, 11,2 ≤ 15, 1.501 ≤ 2.000, Apache-2.0) |
| EasyOCR 1.7.2 (vi + en) | 7 | 11 | 12 / 9 | 14,0 (31,5) | 28,1 | 2.409 MB | 94,0 MB | Apache-2.0 | không (PyTorch) | không |
| Tesseract 5.4.0 vie + eng (thư mục `tesseract-v2b`) | 1 | 1 | 3 / 0 | 1,5 (2,6) | 0,4 | 144 MB | 29,8 MB | Apache-2.0 | (tesseract.js = 1b) | không |
| OnnxTR 0.9.0 (fast_base + parseq multilingual) | 8 | 15 | 12 / 11 | 3,3 (5,8) | 42,4 | 1.427 MB | 132,6 MB | Apache-2.0 | không (không có bản trình duyệt có tiếng Việt) | không |
| Florence-2 large | dở 8/30 (phiên bị ngắt, KHÔNG do luật dừng): không dùng số này, chạy lại vòng 3 vào thư mục mới | – | – | 8 ảnh: 20,8 (34,1) | 175,0 | 3.765 MB | 1.484 MB (> 500 MB) | MIT | – | – |
| OCeanpaRk-small-v1 | bỏ (gated, xem Chốt bổ sung vòng 2) | – | – | – | – | – | – | không ghi | – | – |
| OCR.space | 0 lượt: không có `OCRSPACE_API_KEY`, không đo | – | – | – | – | – | – | dịch vụ | – | – |

Ghi chú:
- Tesseract = thư mục `tesseract-v2b`. Lần đầu (`tesseract-v2`) lỗi thật 30/30 ảnh vì đường tessdata: `--tessdata-dir "..."` đi qua shlex của pytesseract nên dấu nháy bị giữ trong đường dẫn trên Windows (`TesseractError: (1, 'Error opening data file "D:\cache\tessdata\ced78752"/vie.traineddata Please make sure the TESSDATA_PREFIX environment variable is set to your "tessdata" directory. Failed loading language 'vie' ...`). File `tesseract-tai-nguyen.json` của lần đầu bị lần sau ghi đè (lý do của sửa P1.1 vòng 3: `do_tai_nguyen.py` không cho ghi đè nếu không có `--ghi-de`). Kiểm vòng 3: `tesseract-v2b` có 0 khung độ tin null (từ độ tin -1 đã không lọt vào), nên sửa "từ có độ tin -1 bỏ hẳn" không đổi kết quả, không chạy lại.
- 2 chỗ đổi so với Chốt "khi chạy lỗi": (1) Tesseract dùng biến môi trường `TESSDATA_PREFIX` thay `--tessdata-dir` (lỗi thật ở trên); (2) Florence-2: bỏ `flash_attn` khỏi danh sách import của mã repo (thư viện chỉ chạy GPU, không dùng). Câu lỗi thật của (2) không được lưu ở vòng 2; kiểm lại vòng 3 với `transformers` 4.49.0: `get_imports` đã tự bỏ các import nằm trong khối `if is_flash_attn_2_available():` của `modeling_florence2.py` @21a599d4 (danh sách import: typing, math, torch, dataclasses, einops, timm, collections, transformers) và `check_imports` không báo lỗi khi chưa cài `flash_attn` -> bản vá (2) không đổi gì, không ảnh hưởng kết quả.
- RapidOCR: 0/30 ảnh có `items` rỗng ở `r1-v2`, `r2-v2`, `r3-v2` (kiểm vòng 3) -> sửa P1.4 (không bắt lỗi theo chữ "empty") không đổi kết quả, không chạy lại.
- R2 so với 1a (cùng 2 file ONNX, khác tiền / hậu xử lý: RapidOCR thu ảnh dò khung kiểu `min` 736, ngưỡng 0,3 / 0,5 / 1,6, có cls): 11/19 so với 10/19 (Chromium), 8/19 (WebKit); top5 khác 1a-chromium ở 17/30 ảnh (lên: 8934614031322 2 -> 1, 8935039511024 ngoài 5 -> 1; xuống: 8934840000130 2 -> ngoài 5, 8936012061321 1 -> 2, 8936045081310 4 -> 5).
- R1 so với 1a-chromium: top5 khác 24/30 ảnh; lên 5 (8936036020977 ngoài 5 -> 2; 8936036027099 4 -> 1; 8934840000130 2 -> 1; 8934614031322 2 -> 1; 8936134361040 ngoài 5 -> 1); xuống 5 (8936079120276 3 -> ngoài 5; 8934804025766 2 -> 5; 8936012061321 1 -> 5; 8936017367107 2 -> 3; 8936045081310 4 -> 5). So với 1a-webkit: top5 khác 25/30, lên 7, xuống 4 (trong đó 8935039511024 1 -> ngoài 5).
- R3 so với 2a(b) Chromium (cùng model, Python CPU 8 luồng thay wasm 1 luồng, tiền / hậu xử lý RapidOCR thay PaddleOCR.js): 14/22 so với 16/22, 11,2 so với 78,8 giây/ảnh. So với 1a-chromium: top5 khác 21/30; lên 6 (8936221043071 5 -> 1; 8936221044160 ngoài 5 -> 1; 8936036020977 ngoài 5 -> 3; 8936079120276 3 -> 1; 8934840000130 2 -> 1; 8935039511024 ngoài 5 -> 1); xuống 1 (8936012061321 1 -> 3).
- Florence-2 large vòng 2: dở 8/30 (`florence-large-v2`, mã thoát 1073807364 do phiên dừng), không dùng số này; vòng 3 chạy lại toàn bộ 30 ảnh vào `florence-large-v3`.

## Chốt bổ sung (vòng 3): đo R1 trong trình duyệt, ghép, ngưỡng nhận xét, luật dừng bộ nhớ (11/11/2026, commit riêng TRƯỚC lần chạy OCR mới đầu tiên của vòng 3)

Thêm sau khi đã thấy số vòng 1–2, trước khi đo R1 trong trình duyệt, model nặng và ghép. Chỉ thêm, không sửa Chốt trên (câu tìm + T1 + chấm, luật dừng 2 giờ / 120 giây, cấu hình từng model giữ nguyên).

- Luật dừng thêm (bộ nhớ): RSS đỉnh (tổng cả tiến trình con) > 6.000 MB thì dừng model đó (máy 7,8 GB RAM; đổi trang làm sai số giây). `do_tai_nguyen.py --max-rss-mb 6000` kill cả cây tiến trình khi vượt và ghi `dungTheoLuatBoNho`; bảng ghi "dừng theo luật bộ nhớ" + số ảnh đã chạy.
- Việc ƯU TIÊN thêm (chủ dự án yêu cầu): **R1-trình-duyệt** = đúng bộ model ONNX của R1 chạy TRONG trình duyệt, cấu hình chọn trước:
  - Thư viện: `@paddleocr/paddleocr-js` 0.4.2 (SDK có sẵn tên model `PP-OCRv6_small_det` / `PP-OCRv6_small_rec`, nạp được model tùy chọn dạng inference.onnx + inference.yml) + onnxruntime-web 1.24.3 (bản ghim trong `web-ocr/assets.js`), wasm, `numThreads` 1, không COOP / COEP.
  - Model: `PP-OCRv6_det_small.onnx` (9.929.594 byte, sha256 `090f04ab…1ff94f`) + `PP-OCRv6_rec_small.onnx` (21.234.383 byte, sha256 `6f327246…c14884`) lấy từ gói PyPI `rapidocr` 3.10.0 trong venv-rapid; trùng sha256 ghi trong `default_models.yaml` của gói và ETag của nguồn chính thức RapidAI trên ModelScope (`https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/{det,rec}/...`, có CORS `*`). `inference.yml` (tên model + tiền xử lý + bộ ký tự) lấy từ ONNX chính thức của PaddlePaddle trên HuggingFace: `PaddlePaddle/PP-OCRv6_small_det_onnx` @28fe5895 và `PaddlePaddle/PP-OCRv6_small_rec_onnx` @b8f84f0b (Apache-2.0); bộ ký tự `character_dict` của yml (18.708 ký tự) trùng hệt metadata `character` trong file ONNX của RapidOCR (kiểm 11/11/2026). File ONNX của HuggingFace khác sha256 (bản chuyển khác) nên KHÔNG dùng, chỉ dùng yml. Bản trên máy: `D:\cache\paddle-onnx\rapidocr-PP-OCRv6_small_{det,rec}\`; mode cdn: ONNX từ ModelScope, yml từ HuggingFace.
  - Tham số bám R1 (mặc định `config.yaml` của RapidOCR 3.10.0, truyền vào `PaddleOCR.create`): `textDetLimitSideLen` 736, `textDetLimitType` "min", `textDetThresh` 0,3, `textDetBoxThresh` 0,5, `textDetUnclipRatio` 1,6, `textRecScoreThresh` 0,5. **Bỏ cls** (`ch_ppocr_mobile_v2.0_cls_mobile.onnx`): PaddleOCR.js chỉ có bước xoay dòng bằng model textline orientation của nó (khác model, khác cỡ ảnh vào), không nạp cls v2.0 của RapidOCR. Đối chứng để tách ảnh hưởng của cls: chạy thêm R1 Python với `Global.use_cls` false (`chay_ocr.py --model r1-nocls`, thư mục `r1-nocls-v3`), chỉ để giải thích chênh lệch.
  - Harness (chỉ THÊM, mặc định và số cũ giữ nguyên): `node web-ocr/run-browser.mjs --engine paddlejs --join rows --only front --lines --det r1 --rec r1 --params r1 --tag r1 --browser webkit|chromium --out D:\tmp\ocr-mat\ocr --photos <ảnh>` -> thư mục `paddlejs-rows-<trình duyệt>-r1`; Chromium headless shell như 1a (Chrome 157 bản cài `--channel chrome` chỉ nếu headless shell không chạy), WebKit 26.0; khổ 390×844 DPR 3, ảnh thu cạnh dài 1.600 px như 1a / trang thử. Chấm `node chup-mat-do/t1-ocr.mjs --dir <thư mục> --name r1-trinh-duyet-<trình duyệt>` (không đổi luật).
  - Ghi: vị trí 1, trong 5 đầu, đúng tên / thương hiệu (/30), giây/ảnh trung vị (lớn nhất) WebKit / Chromium, tải lần đầu (`--mode cdn --limit 1`, MB), WS đỉnh (MB), giấy phép (PP-OCRv6: Apache-2.0; RapidOCR: Apache-2.0), chạy trong app được không, qua ngưỡng đổi trang thử không (7 điều kiện của Chốt vòng 1). Không nạp được (op không hỗ trợ, thiếu bộ chữ…) thì dừng, ghi lỗi thật. Vòng này KHÔNG sửa trang thử.
- Ghép (làm ở vòng 4, luật cố định từ giờ):
  - G1 = đúng Chốt vòng 1: 2 OCR có "trong 5 đầu" cao nhất trong mọi cách đã đo đủ 30 ảnh (cách trình duyệt tính theo trình duyệt chạy đủ 30 ảnh; 2a(b) = Chromium), hòa thì vị trí 1 cao hơn, rồi nhanh hơn.
  - G2 = đúng Chốt vòng 1: "tốt nhất trình duyệt + tốt nhất máy tính" (cùng luật chọn trong từng nhóm), nếu khác G1; trùng thì ghi "trùng G1".
  - G3 (thêm) = 1a PaddleOCR.js mobile (chấm cả 1a-chromium và 1a-webkit) + OCR máy tính tốt nhất; nếu R1-trình-duyệt đo xong: thêm G3b = R1-trình-duyệt + OCR máy tính tốt nhất.
  - Cách hợp chữ như Chốt vòng 1: hợp các cụm chữ, bỏ cụm trùng sau chuẩn hóa không dấu, rồi câu tìm như cũ.
- Ngưỡng nhận xét (chỉ để ghi kết luận, KHÔNG đổi app / trang thử, trừ ngưỡng đổi trang thử đã chốt vòng 1):
  - "Ghép có ích" = trong 5 đầu ≥ (thành phần tốt nhất) + 2 VÀ vị trí 1 không thấp hơn thành phần tốt nhất.
  - "Đáng làm máy chủ" = trong 5 đầu ≥ 22/30, vị trí 1 ≥ 13/30, ≤ 15 giây/ảnh CPU trung vị, RSS đỉnh ≤ 2.000 MB, giấy phép cho dùng không điều kiện doanh thu.
- Ghi chú cấu hình (không đổi luật): Florence-2 / GOT-OCR2.0 / PaddleOCR-VL trả `{ text }`; `t1-ocr` tách theo xuống dòng. Florence `<OCR>` thường trả một khối không xuống dòng nên câu tìm lấy từ theo thứ tự đọc. GOT tự thu ảnh về 1024 × 1024 bên trong.
- Model nặng vòng 3 (cấu hình như Chốt bổ sung vòng 2, luật dừng cũ + luật bộ nhớ): Florence-2 large chạy lại toàn bộ 30 ảnh vào `florence-large-v3`; GOT-OCR2.0 (venv-hf, `transformers` 4.49.0 có `GotOcr2ForConditionalGeneration`); Surya (venv-surya riêng, kiểm giấy phép + điều kiện tải trước khi cài); PaddleOCR-VL (venv riêng nếu cần bản `transformers` khác).

## Kết quả vòng 3 (11–12/11/2026)

Chốt bổ sung vòng 3: commit 30a8aed lúc 23:09:50 ngày 11/11/2026; lần chạy OCR mới đầu tiên (R1-trình-duyệt Chromium) bắt đầu 23:12:57.

### R1 trong trình duyệt (việc ưu tiên)

Cấu hình đúng Chốt bổ sung vòng 3 (PaddleOCR.js 0.4.2 + onnxruntime-web 1.24.3 wasm 1 luồng, ONNX PP-OCRv6 small của rapidocr 3.10.0, yml PaddlePaddle, tham số R1, không cls). Nạp được ngay, không lỗi op, 30/30 ảnh ok cả 2 trình duyệt. Giây = giây đọc chữ / ảnh theo file OCR (30 ảnh, như 1a).

| Cách | Vị trí 1 (/30) | Trong 5 đầu (/30) | Đúng tên / thương hiệu (/30) | Giây/ảnh trung vị (lớn nhất), WebKit / Chromium | Nạp (giây) | Tải lần đầu WebKit / Chromium | WS đỉnh (cả cây) WebKit / Chromium | Giấy phép | Chạy trong app được không | Qua ngưỡng đổi trang thử |
|---|---|---|---|---|---|---|---|---|---|---|
| 1a PaddleOCR.js mobile (mốc) | WebKit 8 · Chromium 10 | 19 · 19 | 14 / 10 · 16 / 11 | 5,8 (8,4) / 5,3 (9,5) | – | 18,6 / 18,7 MB | 1.198 / 1.176 MB | Apache-2.0 | có (đang là trang thử) | – |
| R1 Python (vòng 2, có cls) | 13 | 20 | 16 / 15 | CPU 2,5 (6,7) | 3,2 | – | RSS 472 MB | Apache-2.0 | – | – |
| **R1-trình-duyệt** | WebKit **13** · Chromium **14** | **21** · **22** | 14 / 13 · 16 / 15 | 7,8 (16,6) / 5,9 (12,2) | 3,9 / 3,0 (máy); 10,7 / 10,8 (cdn) | 35,7 / 37,0 MB | 1.503 / 1.055 MB | PP-OCRv6 + RapidOCR: Apache-2.0 | có (cùng SDK + onnxruntime-web như trang thử; chỉ đổi 2 file model + tham số) | **không**, thiếu 1 ảnh: (1) 5 đầu WebKit 21 < 22 (Chromium 22 đạt); (2) vị trí 1 13 ≥ 8, 14 ≥ 10 đạt; (3) WebKit 7,8 ≤ 15 giây đạt; (4) 35,7 / 37,0 ≤ 150 MB đạt; (5) WS 1.503 / 1.055 ≤ 2.000 đạt; (6) Apache-2.0 đạt; (7) thư viện jsDelivr đúng bản ghim, model ModelScope tag v3.10.0 + yml HuggingFace ghim commit đạt |

Ghi chú:
- Tải lần đầu (`--mode cdn --limit 1`, cache trống): ONNX rec 21,2–21,3 MB + det 9,9 MB (ModelScope không nén), ort wasm 2,0–2,6 MB, opencv.js 2,4–3,0 MB, 15 request, 0 lỗi. WebKit Windows: "đỉnh 1 tiến trình" theo bộ nhớ riêng (private) lên 5,8 GB nhưng WS (bộ nhớ thật đang dùng, cột so sánh của Phần D / E) 1.503 MB; nền WebKit (Playwright.exe) ~0,86 GB.
- So với 1a: Chromium top5 khác 24/30 ảnh; lên 7 (8936036020977 ngoài 5 -> 2; 8936036027099 4 -> 1; 8936079120276 3 -> 1; 8934840000130 2 -> 1; 8935039511024 ngoài 5 -> 2; 8936134361040 ngoài 5 -> 1; 8936045081310 4 -> 1), xuống 4 (8934614031322 2 -> 3; 8934804025766 2 -> 4; 8936012061321 1 -> 5; 8936017367107 2 -> 3). WebKit top5 khác 26/30; lên 8 (8936028641487 ngoài 5 -> 1; 8936036020977 ngoài 5 -> 2; 8936036027099 4 -> 2; 8936079120276 3 -> 1; 8934840000130 2 -> 1; 8934673300759 3 -> 1; 8936134361040 ngoài 5 -> 1; 8936045081310 5 -> 1), xuống 5 (8934614031322 2 -> 3; 8934804025766 2 -> 5; 8936012061321 2 -> ngoài 5; 8935039511024 1 -> 2; 8936017367107 3 -> 4).
- WebKit so với Chromium (cùng model, cùng tham số): top5 khác 9/30, WebKit kém ở 4 ảnh (8936036027099 1 -> 2; 8934804025766 4 -> 5; 8936012061321 5 -> ngoài 5; 8936017367107 3 -> 4), không ảnh nào hơn: khác do cách giải mã / thu nhỏ ảnh của 2 trình duyệt (như 1a, 2b).
- So với R1 Python (có cls): Chromium top5 khác 16/30; lên 4 (8936079120276 ngoài 5 -> 1; 8934804025766 5 -> 4; 8935039511024 ngoài 5 -> 2; 8936045081310 5 -> 1), xuống 1 (8934614031322 1 -> 3). Trong trình duyệt KHÔNG kém bản Python dù bỏ cls (xem đối chứng R1 không cls dưới).
- Đối chứng R1 Python KHÔNG cls (`r1-nocls-v3`, `Global.use_cls` false, còn lại như R1): vị trí 1 13, trong 5 đầu **22**, đúng tên / thương hiệu 17 / 15 (R1 có cls: 13 / 20). Top5 khác R1 có cls ở 4/30 ảnh: lên 8936079120276 ngoài 5 -> 1, 8935039511024 ngoài 5 -> 2; xuống 8934614031322 1 -> 3 -> bước cls (xoay dòng 180°) của RapidOCR làm HỎNG 2 ảnh, nên bỏ cls trong trình duyệt không làm kém. Chromium so với R1 không cls: top5 khác 12/30, lên 2 (8934804025766 5 -> 4; 8936045081310 5 -> 1), không xuống. Giây/ảnh của lần này (3,3 trung vị) KHÔNG dùng: chạy trùng lúc `pip install` của venv-surya (máy bận), chỉ dùng điểm.
- Kết luận R1-trình-duyệt: tốt hơn 1a rõ ở vị trí 1 (+5 / +4) và trong 5 đầu (+3 / +2), nhanh gần bằng 1a, nặng hơn 1a ~17–18 MB tải lần đầu; không qua ngưỡng đổi trang thử chỉ vì WebKit 21/30 (thiếu 1 ảnh) -> trang thử giữ 1a theo luật (vòng này không sửa trang thử).

### Model nặng trên CPU (P4)

Cấu hình như Chốt bổ sung vòng 2, luật dừng cũ + luật bộ nhớ (`do_tai_nguyen.py --max-rss-mb 6000 --max-3-dau-s 120 --max-wall-s 7000`). Giây/ảnh CPU = trung vị (lớn nhất) bỏ ảnh đầu; RSS = tổng cả cây tiến trình. "Đáng làm máy chủ" theo ngưỡng Chốt bổ sung vòng 3.

| Model | Vị trí 1 (/30) | Trong 5 đầu (/30) | Đúng tên / thương hiệu (/30) | Giây/ảnh CPU trung vị (lớn nhất) | Nạp model (giây) | RSS đỉnh | Dung lượng model | Giấy phép + nguồn | Chạy trong app được không | Đáng làm máy chủ | Thời gian đồng hồ (cài + chạy) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Florence-2 large (`florence-large-v3`, 30/30 ảnh) | **15** | 21 | 21 / 16 | 28,5 (165,7) | 92,5 | 3.752 MB | 1.484 MB (> 500 MB) | MIT, `microsoft/Florence-2-large` @21a599d4 | không (PyTorch 0,77 tỷ tham số, 1,5 GB) | không (5 đầu 21 < 22; 28,5 > 15 giây; RSS 3.752 > 2.000) | cài: 0 (venv-hf có từ vòng 2); chạy 23:47:50–00:11:43 (23,9 phút) |

Ghi chú model nặng:
- Florence-2 large: top5 khác 1a-chromium ở 23/30 ảnh; lên 7 (8936221043071 5 -> 1; 8936036020977 ngoài 5 -> 1; 8936036027099 4 -> 1; 8936079120276 3 -> 1; 8934840000130 2 -> 1; 8935039511024 ngoài 5 -> 1; 8936134361040 ngoài 5 -> 1), xuống 4 (8934614031322 2 -> 3; 8936012061321 1 -> ngoài 5; 8936025773181 1 -> 2; 8936045081310 4 -> 5). So với R3: top5 khác 23/30; lên 3 (8936036020977 3 -> 1; 8936036027099 4 -> 1; 8936134361040 ngoài 5 -> 1), xuống 5 (8936221044160 1 -> ngoài 5; 8934614031322 2 -> 3; 8936012061321 3 -> ngoài 5; 8936025773181 1 -> 2; 8936045081310 4 -> 5). Vị trí 1 cao nhất đến giờ (15) nhưng 5 đầu 21.
- Florence-2 large, giây: 3 ảnh đầu 105,7 / 165,7 / 110,8 giây (trung vị 110,8 < 120: chạy tiếp theo luật), các ảnh sau 19–94 giây, trung vị 28,5 (vòng 2, 8 ảnh: 20,8). Lúc chạy máy thiếu RAM: RAM trống 0,4–1,3 GB (máy 7,8 GB, các ứng dụng khác của máy đang mở), bộ nhớ cam kết (private) của tiến trình 6,3 GB trong khi RSS 3,75 GB -> phải đổi trang, nhất là các ảnh đầu; số giây này là cận trên.
- Sự cố khi chạy (không ảnh hưởng số trên): lần chạy Florence đầu vòng 3 (23:33–23:44) bị chạy trùng `pip install` của venv-surya / venv-vl và 1 lần GOT khởi động nhầm (chuỗi chạy nền không dừng được bằng lệnh dừng tác vụ), 76–110 giây/ảnh, 7/30 ảnh; đã dừng hết, giữ thư mục làm bằng chứng ở `florence-large-v3-huy-tranh-cpu` (không dùng), rồi chạy lại sạch toàn bộ 30 ảnh vào `florence-large-v3` (số trong bảng).
