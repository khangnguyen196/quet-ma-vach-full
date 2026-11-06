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
- `score.py` coi là công cụ OCR: thư mục con của `outputs/` và tên công cụ có dòng trong `outputs/times.csv` (công cụ bị bỏ qua hết theo luật chi phí hoặc lỗi hết chưa có thư mục nhưng vẫn hiện, điểm 0), trừ `extract` (do `run_extract.py` ở phần B tạo) và tên bắt đầu bằng dấu chấm. Ở bảng theo trường, công cụ chưa có file `.txt` nào hiện "–" ở mọi trường (chưa đọc được ảnh nào, khác với đọc mà sai = 0).

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
