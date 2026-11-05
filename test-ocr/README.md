# Test 4 công cụ OCR trên bao bì đồ ăn

Mục tiêu: chụp 30 sản phẩm, cho 4 công cụ OCR đọc cùng bộ ảnh, chấm xem công cụ nào lấy được **đầy đủ thông tin nhất** (tên, thương hiệu, khối lượng, thành phần, dinh dưỡng, nhà sản xuất, bảo quản, hạn sử dụng), kèm tốc độ và chi phí.

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

Mỗi sản phẩm chụp 3 ảnh, đặt vào thư mục `photos/<mã vạch>/`:

```
photos/
└── 8934563163150/
    ├── front.jpg   # mặt trước: tên, thương hiệu, khối lượng
    ├── back.jpg    # mặt sau: thành phần, bảng dinh dưỡng, bảo quản, nhà sản xuất
    └── date.jpg    # chỗ in NSX / HSD (chụp sát)
```

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
   - Ollama (cho extractor `llm` ở phần B): cài tại https://ollama.com, chạy `ollama pull qwen2.5:7b`. `.env` mặc định đã có `LLM_PROVIDER=ollama`.

## Bước 5 – Chạy

```
python run_ocr.py            # chạy mọi công cụ có sẵn, kết quả vào outputs/<công cụ>/
python run_ocr.py --tools tesseract,easyocr   # chỉ chạy vài công cụ
python score.py              # chấm điểm → outputs/results.csv và outputs/summary.md
```

`--tools claude` sẽ bị từ chối (in "không dùng" rồi bỏ qua).

Chạy lại không mất công: ảnh nào đã có file kết quả thì bỏ qua. Muốn chạy lại từ đầu thì xóa thư mục `outputs/<công cụ>` (chạy lại Google / Azure sẽ tốn thêm lượt gọi, xem bộ đếm dưới đây).

## Bộ đếm lượt gọi (Google, Azure)

Để không bao giờ bị tính tiền, `run_ocr.py` đếm số lần gọi Google và Azure theo từng tháng (giờ UTC) trong file `outputs/api_usage.json`, và chỉ dùng tới **80% mức miễn phí**:

| Dịch vụ | Mức miễn phí / tháng (nguồn, ngày đọc) | Trần của script (80%) |
|---|---|---|
| Google Cloud Vision, Document Text Detection | 1.000 lượt: "Document Text Detection 0 count to 1,000 count $0.00 (Free)" (https://cloud.google.com/vision/pricing, 05/11/2026) | 800 |
| Azure AI Vision, gói F0 | 5.000 lượt, 20 lượt / phút: "Free (F0) … 5,000 free transactions per month 20 transactions per minute" (https://azure.microsoft.com/pricing/details/cognitive-services/computer-vision/, 05/11/2026) | 4.000 (và cách nhau ít nhất 3,1 giây) |

- **Trần mỗi lần chạy (Google)**: mỗi lần chạy `run_ocr.py` gọi Google **tối đa 60 lượt** (đếm cả lượt lỗi), ngoài trần tháng 800 ở bảng trên. Nguồn: luật chi phí chủ dự án đặt ngày 05/11/2026 trong `.claude/du-an.md` ("Mỗi lần chạy thử tối đa 60 lượt"); hằng `RUN_LIMIT` trong `run_ocr.py`. Azure không có trần mỗi lần chạy (chỉ trần tháng và khoảng cách 3,1 giây).
- Trước mỗi lần gọi, script đọc lại file, cộng 1 và ghi file ngay (đếm cả lần gọi bị lỗi). Chạm trần (60 lượt của lần chạy, hoặc trần tháng) thì ngừng gọi dịch vụ đó, script vẫn chạy tiếp các công cụ khác và không báo lỗi. Mỗi ảnh còn lại chưa có kết quả được ghi 1 dòng `bỏ qua theo luật chi phí` (cột `seconds` = 0) vào `outputs/times.csv`, không tạo file `.txt`. Chạy lại sau (lần chạy mới nếu chạm trần 60 lượt, tháng sau nếu chạm trần tháng) sẽ làm tiếp đúng các ảnh đó. `score.py` không tính dòng này là lỗi và không đưa vào thời gian trung bình.
- **Không chạy 2 lần `run_ocr.py` cùng lúc** (2 cửa sổ dòng lệnh). Khi có Google / Azure sẽ chạy, script tạo file khóa `outputs/api_usage.lock` (ghi số tiến trình PID và giờ bắt đầu) và xóa khi chạy xong, kể cả khi lỗi hay bấm Ctrl+C. Nếu file khóa đã có sẵn, script in cảnh báo "đang có lần chạy khác hoặc lần trước bị tắt ngang" và **không gọi Google / Azure** lần đó (Tesseract / EasyOCR vẫn chạy). Chắc chắn không có lần chạy nào khác (ví dụ máy bị tắt ngang lúc đang chạy) thì tự xóa file `outputs/api_usage.lock` rồi chạy lại.
- Tắt tự gửi lại (retry) của thư viện: Google gọi với `retry=None`, Azure tạo client với `retry_total=0`. Nhờ vậy 1 lượt đếm = đúng 1 lần gửi, thư viện không tự gửi thêm khi gặp lỗi.
- Gọi bị lỗi thì **không ghi file kết quả** cho ảnh đó (lần sau chạy lại sẽ thử lại ảnh đó), chỉ ghi 1 dòng `error` vào `outputs/times.csv`. Google / Azure lỗi **3 lần liên tiếp** thì script in lý do và dừng gọi dịch vụ đó (3 lượt lỗi vẫn bị đếm). Sửa lỗi (key, mạng, gói…) rồi chạy lại.
- **Khoảng nghỉ đầu / cuối tháng**: script không gọi Google / Azure trong 12 giờ cuối và 12 giờ đầu mỗi tháng theo giờ UTC (từ 19:00 giờ Việt Nam ngày cuối tháng tới 19:00 giờ Việt Nam ngày 1). Lúc đó có nơi đã sang tháng mới, có nơi chưa, nên không chắc Google / Azure tính lượt gọi vào tháng nào. Script in lý do và bỏ qua dịch vụ; chạy lại sau 19:00 giờ Việt Nam ngày 1.
- File `api_usage.json` hỏng (không đọc được) thì script coi như đã chạm trần, không gọi Google / Azure, và không ghi đè file đó: hãy tự sửa lại cho đúng dạng `{"google": {"2026-11": 12}, "azure": {"2026-11": 3}}`.
- Cuối mỗi lần chạy, script in bảng: dịch vụ, tháng, đã dùng / trần tháng, lượt của lần chạy này / trần lần chạy (Google: `… / 60`, Azure: không có trần).
- Test phần đếm (không gọi Google / Azure thật, không đọc `.env`, chỉ dùng thư mục tạm; cần `pillow`, `python-dotenv`, `rapidfuzz`), trong thư mục `test-ocr`: `.venv\Scripts\python -B -m unittest -v test_run_ocr` (Windows) hoặc `.venv/bin/python -B -m unittest -v test_run_ocr` (macOS / Linux).
- File này và file khóa `api_usage.lock` **không commit** (nằm trong `outputs/`, đã có trong `.gitignore`).
- Bộ đếm chỉ biết lượt gọi từ script này, trên máy này. Dùng cùng key ở nơi khác (máy khác, trang web của Google / Azure…) thì bộ đếm không biết, phải tự cộng vào.
- **Đừng xóa file giữa tháng**: xóa là mất số đếm, script sẽ tưởng tháng này chưa gọi lần nào.
- Mức miễn phí có thể đổi: trước khi chạy nhiều, mở lại 2 trang giá trên; số mới thấp hơn thì sửa `FREE_PER_MONTH` trong `run_ocr.py`.

## Bước 6 – Đọc kết quả

`outputs/summary.md` có:
- Tổng điểm mỗi công cụ (tối đa 11 điểm × số sản phẩm).
- Tỷ lệ đúng theo từng trường: sẽ thấy ví dụ "hạn sử dụng" thường thấp nhất vì in dạng chấm (dot-matrix).
- Thời gian trung bình mỗi ảnh, số ảnh lỗi.

Chọn công cụ theo 4 tiêu chí: điểm đầy đủ thông tin, tốc độ, chi phí mỗi ảnh (cloud tính tiền sau mức miễn phí), có chạy offline không. Với app sinh viên, thường kết luận là: dùng công cụ chạy offline cho tên/thành phần, và dùng công cụ mạnh hơn, trong mức miễn phí, cho ảnh hạn sử dụng.

## Prompt dán vào Claude Code

```
Đọc README.md và truth.csv trong thư mục test-ocr. Mình đã chụp ảnh vào photos/ và điền truth.csv.
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
| 5 | `llm` | đưa text OCR cho mô hình ngôn ngữ, yêu cầu trả JSON đúng 11 trường | chịu lỗi OCR tốt nhất, hiểu ngữ cảnh | chậm; **chỉ chạy bằng Ollama trên máy** (`LLM_PROVIDER=ollama`, mặc định, miễn phí; cần cài Ollama + `ollama pull qwen2.5:7b`), không gọi Anthropic API |

Luật và từ điển làm việc trên text **đã bỏ dấu** (để chịu được OCR mất dấu), nên giá trị rút ra có thể không dấu; điểm chấm cũng bỏ dấu hai bên nên không bị thiệt.

## Chạy phần B (sau khi phần A đã có `outputs/<ocr>/`)

```
python run_extract.py                     # 5 extractor × mọi OCR đã chạy
python run_extract.py --extractors regex,dict,yake      # bỏ qua cái chậm (underthesea, llm)
python run_extract.py --ocr tesseract --extractors llm   # chỉ 1 tổ hợp (llm chạy bằng Ollama, cần Ollama đang chạy)
python score_combo.py                     # → outputs/summary_combo.md
```

## Đọc kết quả phần B

`outputs/summary_combo.md` có 3 bảng:
1. **Ma trận OCR × extractor**: mỗi ô là % thông tin rút ra đúng. Nhìn hàng để biết OCR nào tốt, nhìn cột để biết extractor nào tốt, ô cao nhất là tổ hợp nên dùng.
2. Trung bình theo extractor + giây/sản phẩm.
3. Tỷ lệ đúng theo trường của tổ hợp tốt nhất.

So với `summary.md` (phần A): phần A đo "OCR **có chứa** thông tin không", phần B đo "extractor **đưa ra** được không". Chênh lệch giữa hai bảng là phần thông tin bị mất ở bước rút trích, không phải lỗi OCR. Ví dụ OCR đọc được "Năng lượng 437 kcal" (A đúng) nhưng regex đòi "kcal" đứng ngay sau số còn OCR in "437 kcaI" (chữ I hoa) thì B sai.

Thường thấy: `regex`/`dict` đủ dùng cho khối lượng, kcal, đạm, béo khi OCR tốt; `llm` vượt trội ở tên, nhà sản xuất, bảo quản và khi OCR nhiều lỗi; `yake` thấp nhất vì nó không được thiết kế cho việc này (và đó chính là bài học của phần so sánh).

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
