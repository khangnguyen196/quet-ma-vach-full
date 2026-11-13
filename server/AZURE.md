# Đưa máy chủ OCR lên Azure Container Apps (từng bước trên Azure Portal)

Dành cho chủ dự án, làm bằng tay trên trình duyệt. Máy (Claude Code) KHÔNG chạy lệnh `az`, không đăng nhập Azure, không
giữ khóa Azure nào. Ảnh Docker do GitHub Actions build và đẩy lên `ghcr.io/khangnguyen196/quet-ma-vach-ocr` (workflow
`.github/workflows/server-image.yml`, chỉ khi lên `main`). Azure chỉ kéo ảnh công khai đó về chạy.

Gói: Azure for Students (không thẻ). Chỉ dùng phần miễn phí / credit; luôn để **scale tối thiểu 0** (mục "Chi phí").

Trong file này không có địa chỉ app, URL hay khóa Supabase thật: thay `<...>` bằng giá trị của bạn khi bấm.

## 1. GitHub: cho package thành Public

Azure kéo ảnh không cần mật khẩu chỉ khi package công khai. Làm 1 lần, SAU lần đầu workflow "Server image" trên `main`
chạy xanh (lúc đó package mới có).

1. Mở `https://github.com/khangnguyen196?tab=packages` → bấm package **quet-ma-vach-ocr**.
2. Bên phải bấm **Package settings**.
3. Kéo xuống "Danger Zone" → **Change visibility** → chọn **Public** → gõ tên package để xác nhận → bấm nút xác nhận.
4. Kiểm: mở cửa sổ ẩn danh, vào `https://github.com/users/khangnguyen196/packages/container/package/quet-ma-vach-ocr`
   thấy trang package (không bị đòi đăng nhập) là được.

Ảnh chỉ có mã máy chủ + model + giấy phép (`LICENSES.md`), không có `.env`, không có khóa nào (xem `.dockerignore`).

## 2. Tạo Container App

Vào `https://portal.azure.com` → ô tìm kiếm trên cùng gõ **Container Apps** → **Create** (hoặc **+ Create** →
**Container App**).

### Tab Basics

- **Subscription**: Azure for Students.
- **Resource group**: bấm **Create new** → `quet-ma-vach` → OK.
- **Container app name**: tên ngắn chữ thường, vd `quet-ma-vach-ocr` (tên này nằm trong địa chỉ https của app).
- **Deployment source** (nếu có hỏi): **Container image**.
- **Region**: **Southeast Asia**.
  - Azure for Students chỉ cho tạo ở một số vùng. Nếu bấm **Review + create** mà báo lỗi có chữ
    `RequestDisallowedByAzure`, `disallowed by policy` hoặc "not allowed … location", thì vùng đó bị chặn: quay lại chọn
    vùng khác gần Việt Nam (vd East Asia, Japan East, Korea Central, Central India), thử lần lượt. Danh sách vùng được
    phép xem ở Portal: tìm **Policy** → **Assignments** → mục có tên kiểu "Allowed resource deployment regions" /
    "Allowed locations" → **Parameters**.
- **Container Apps environment**: bấm **Create new**:
  - Tab Basics của môi trường: đặt tên, vd `quet-ma-vach-env`; **Environment type** (nếu có hỏi): **Consumption only**
    (Consumption, không chọn Workload profiles / Dedicated).
  - Tab **Monitoring**: **Logs destination** = **Don't save logs** (không lưu log, không tốn tiền Log Analytics).
  - Tab Networking: để mặc định (không VNet, truy cập công khai).
  - Bấm **Create** (đóng khung tạo môi trường).

### Tab Container

- Bỏ dấu **Use quickstart image** (nếu đang tích).
- **Name**: `ocr`.
- **Image source**: **Docker Hub or other registries**.
- **Image type**: **Public**.
- **Registry login server**: `ghcr.io`
- **Image and tag**: `khangnguyen196/quet-ma-vach-ocr:latest`
- **CPU and Memory**: **1 CPU core, 2 Gi memory**.
- **Environment variables** (bấm **Add** từng dòng; **Source** = Manual entry):

| Name | Value | Ghi chú |
|---|---|---|
| `AUTH_MODE` | `supabase` | ảnh đã mặc định `supabase`; ghi rõ cho dễ nhìn |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Project URL (Supabase → Project Settings → API) |
| `SUPABASE_PUBLISHABLE_KEY` | `<publishable key>` | khóa CÔNG KHAI `sb_publishable_…` (hoặc anon). KHÔNG dán secret / service_role |
| `ALLOWED_ORIGINS` | `https://khangnguyen196.github.io,https://localhost:5173` | trang được gọi máy chủ; không "/" cuối, không `*` |
| `TRUST_PROXY` | `1` | xem mục "TRUST_PROXY" dưới |
| `PROXY_COUNT` | `1` | |

  Không cần đặt `PORT` (ảnh mặc định 8080) hay `DAILY_LIMIT_PER_USER` (mặc định 200 ảnh / người / ngày UTC).

### Tab Ingress

- **Ingress**: **Enabled**.
- **Ingress traffic**: **Accepting traffic from anywhere**.
- **Ingress type**: **HTTP**.
- **Target port**: `8080`.
- (Insecure connections: để tắt; Azure tự chuyển http sang https.)

Bấm **Review + create** → **Create**. Chờ 1–3 phút tới "Your deployment is complete" → **Go to resource**.

### Đặt scale tối thiểu 0, tối đa 1 (làm ngay sau khi tạo)

Lúc tạo, Portal để mặc định 0 – 10 bản chạy. Máy chủ chỉ đúng khi CHỈ 1 bản chạy (giới hạn lượt đếm trong RAM), nên:

1. Trong Container App → menu trái **Application** → **Scale** (hoặc **Revisions and replicas** / **Scale and replicas**).
2. **Edit and deploy** → tab **Scale** (**Scale and replicas**).
3. Kéo **Min replicas** = `0`, **Max replicas** = `1` → **Create** (tạo revision mới).

## 3. Kiểm bằng trình duyệt

Container App → **Overview** → **Application Url** (dạng `https://<app>.<vùng>.azurecontainerapps.io`). Mở
`https://<app>…/health`:

- Lần đầu (máy chủ đang ngủ) chờ khoảng 20–60 giây (kéo ảnh + nạp model). Phải thấy
  `{"ok":true,"modelLoaded":true,…}`.
- Mở `https://<app>…/ocr` trên trình duyệt (GET) thấy `{"error":"Phương thức không được hỗ trợ."}` là bình thường.
- Gửi ảnh không đăng nhập phải bị **401** (kiểm ở Phần B của đợt `may-chu-2`).

Thử từ khu "Thử máy chủ OCR (chỉ khi chạy dev)": thêm vào `.env` ở gốc repo dòng
`VITE_OCR_SERVER_URL=https://<app>…` (không "/" cuối), chạy `npm run dev`, mở `https://localhost:5173`, đăng nhập.

## 4. Cập nhật khi có ảnh mới

Mỗi lần `main` có đổi trong `server/`, workflow "Server image" đẩy ảnh mới với tag `latest` (và tag mã commit).
Container App KHÔNG tự kéo lại `latest`. Để chạy ảnh mới:

1. Container App → **Application** → **Revisions and replicas** (hoặc **Containers**) → **Create new revision**
   (hoặc **Edit and deploy**).
2. Không cần đổi gì (ảnh vẫn `…:latest`) → **Create**. Revision mới kéo ảnh `latest` hiện tại.
3. Muốn chạy đúng 1 bản cụ thể: sửa **Image and tag** thành `khangnguyen196/quet-ma-vach-ocr:<7 ký tự commit>` (xem tag ở
   trang package hoặc summary của workflow).

## 5. Tạm tắt

Container App → **Overview** → nút **Stop** (Dừng). Bật lại: **Start**. Khi dừng không có bản nào chạy, không tốn gì.
(Không dùng "Max replicas = 0": theo tài liệu Microsoft, số bản tối đa nhỏ nhất là 1.)

## 6. Xóa hết

Portal → tìm **Resource groups** → `quet-ma-vach` → **Delete resource group** → gõ tên để xác nhận → **Delete**. Xóa cả
Container App lẫn môi trường. Ảnh trên ghcr.io vẫn còn (xóa ở GitHub → package → Package settings → Delete package).

## 7. Lỗi hay gặp

| Thấy gì | Vì sao | Sửa |
|---|---|---|
| Revision "Failed" / "Provisioning failed", log có `unauthorized`, `denied`, `manifest unknown` khi kéo ảnh | package trên ghcr.io còn Private, hoặc gõ sai tên ảnh / tag, hoặc workflow trên `main` chưa chạy xanh lần nào | làm mục 1; kiểm **Image and tag** = `khangnguyen196/quet-ma-vach-ocr:latest`, registry `ghcr.io` |
| Revision không chạy được, /health không trả lời, bản chạy khởi động lại liên tục | máy chủ không khởi động vì thiếu / sai `SUPABASE_URL` hoặc `SUPABASE_PUBLISHABLE_KEY` (câu lỗi chỉ nêu tên biến), dán nhầm khóa bí mật, hoặc `ALLOWED_ORIGINS` sai dạng (có `*`, có đường dẫn) | sửa biến ở **Containers** → **Edit and deploy** → tab Container → Environment variables → tạo revision mới. Xem lỗi: menu **Monitoring** → **Log stream** (xem trực tiếp lúc revision đang khởi động; không lưu lại vì đã chọn "Don't save logs") |
| Trang github.io / localhost báo "lỗi mạng", tab Network thấy lỗi CORS | nguồn của trang không có trong `ALLOWED_ORIGINS` (phải đúng `https://khangnguyen196.github.io`, không "/" cuối, không đường dẫn `/quet-ma-vach-full`) | sửa `ALLOWED_ORIGINS`, tạo revision mới |
| Lần gọi đầu rất chậm (20–60 giây) rồi các lần sau nhanh | máy chủ đang ngủ (scale về 0) nên phải bật + nạp model; ngủ lại sau khoảng 5 phút không có yêu cầu | bình thường với scale tối thiểu 0 (để không tốn tiền); app / khu thử nên chờ lâu hơn lần đầu |
| 429 "đã gửi đủ 200 ảnh hôm nay" | `DAILY_LIMIT_PER_USER` (đếm theo ngày UTC, đổi ngày lúc 7 giờ sáng giờ Việt Nam) | chờ sang ngày, hoặc đặt biến lớn hơn |
| Mọi người cùng bị 429 "tối đa 20 ảnh mỗi phút" | quên `TRUST_PROXY=1`: máy chủ thấy mọi người là cùng 1 IP (IP của proxy Azure) | đặt `TRUST_PROXY=1`, `PROXY_COUNT=1` |
| Mở địa chỉ app thấy `{"error":"Không có đường dẫn này."}` (404) | trang gốc `/` của máy chủ không có gì, 404 là đúng | dùng `/health` |

## 8. Vì sao an toàn

- **Chỉ người đăng nhập mới gửi được ảnh**: ảnh mặc định `AUTH_MODE=supabase`; `/ocr` cần token đăng nhập Supabase hợp lệ
  (ký bằng khóa của project, còn hạn, đúng project). Không token / token sai → 401. Quên đặt biến Supabase → máy chủ
  KHÔNG khởi động (không bao giờ âm thầm cho qua). Supabase lỗi → 503, không cho qua.
- **Publishable key là mã công khai**: nó nằm sẵn trong app trên trình duyệt ai cũng xem được; chỉ để gọi Supabase thay mặt
  người dùng. Máy chủ KHÔNG dùng (và không bao giờ cần) JWT secret hay service_role key; dán nhầm khóa bí mật
  (`sb_secret_…`, JWT `service_role`) thì máy chủ từ chối khởi động.
- **CORS không phải lớp bảo vệ**: chỉ trình duyệt mới tôn trọng CORS (công cụ như curl bỏ qua nó); lớp bảo vệ thật là
  token đăng nhập Supabase. Vì vậy để `https://localhost:5173` trong `ALLOWED_ORIGINS` vẫn an toàn.
- Giới hạn chống dùng chùa: 20 ảnh / phút / IP, 10 ảnh / phút / người, 200 ảnh / người / ngày UTC, 1 ảnh OCR cùng lúc +
  hàng đợi 4, ảnh tối đa 5 MB. Các giới hạn đếm trong RAM: máy chủ ngủ / khởi động lại thì về 0; chỉ đúng khi tối đa 1
  bản chạy (scale tối đa 1). Đây là lớp chống dùng chùa, không phải sổ cái.
- Không lưu ảnh, không file tạm; log không có ảnh, token, email, IP (`server/README.md`, mục "Giới hạn và an toàn").
- Không có khóa nào trong repo hay GitHub: ảnh công khai, GitHub Actions chỉ dùng `GITHUB_TOKEN`; 2 biến Supabase (đều
  công khai) chỉ đặt trên Azure.

## TRUST_PROXY (IP thật của người dùng)

Ingress của Container Apps là 1 proxy đứng trước máy chủ. Tài liệu Microsoft (Ingress in Azure Container Apps, mục
"HTTP headers", https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview, đọc 13/11/2026) ghi:
`X-Forwarded-For` "If specified in initial request, it is appended to. Only the rightmost IP is provided by Azure
Container Apps." Nghĩa là Azure **thêm IP khách vào CUỐI** header; phần bên trái do khách tự ghi, không tin được.

Máy chủ lấy phần tử thứ `PROXY_COUNT` tính từ PHẢI khi `TRUST_PROXY=1` → đặt **`TRUST_PROXY=1`, `PROXY_COUNT=1`** là lấy
đúng IP Azure ghi. Không bật thì máy chủ thấy mọi người dùng chung IP của proxy → cả app chỉ được 20 ảnh / phút (giới
hạn theo IP), người này gửi nhiều làm người khác bị 429. (uvicorn chạy `--no-proxy-headers`, nên `TRUST_PROXY` là công
tắc duy nhất.) Phần :cổng (nếu có) được bỏ (`1.2.3.4:51234` -> `1.2.3.4`, `[2001:db8::1]:443` -> `2001:db8::1`), nên
dù Azure có ghi kèm cổng thì cùng một người vẫn đếm chung 1 IP; phần tử không phải IP hợp lệ -> dùng IP socket. Phần B
vẫn nên xem Azure ghi dạng nào (không bắt buộc).

## Container Apps không dùng HEALTHCHECK của Docker

Dockerfile có `HEALTHCHECK` (gọi `/health`) cho `docker run` và CI. Azure Container Apps bỏ qua nó, tự kiểm bằng probe
riêng (mặc định kiểm cổng 8080 mở được; máy chủ chỉ mở cổng sau khi nạp xong model). Muốn kiểm kỹ hơn có thể thêm
probe HTTP `/health` cổng 8080 ở **Containers** → **Edit and deploy** → container → **Health probes** (không bắt buộc).

## Chi phí

Trang giá chính thức: https://azure.microsoft.com/en-us/pricing/details/container-apps/ (đọc 13/11/2026). Gói
Consumption: mỗi subscription mỗi tháng **miễn phí 180.000 vCPU-giây, 360.000 GiB-giây và 2 triệu yêu cầu**; app scale về
0 thì không tính tiền dùng ("Apps that scale to zero incur no usage charges"); giá "idle" (rẻ hơn) chỉ áp khi đặt số
bản tối thiểu ≥ 1.

Với 1 vCPU / 2 GiB: 180.000 vCPU-giây = **50 giờ chạy / tháng**, 360.000 GiB-giây / 2 GiB = cũng 50 giờ. Mỗi lần máy chủ
thức dậy, nó chạy thêm khoảng 5 phút sau yêu cầu cuối (cool down 300 giây, tài liệu
https://learn.microsoft.com/en-us/azure/container-apps/scale-app) rồi mới ngủ, nên tính an toàn là mỗi lần thức tốn
≥ 300 vCPU-giây + 600 GiB-giây → khoảng **600 lần thức / tháng** vẫn trong phần miễn phí (dùng liên tục thì 50 giờ).
Quá phần miễn phí thì trừ vào credit Azure for Students (không có thẻ nên không bị tính tiền ngoài credit; hết credit
thì Azure tắt tài nguyên).

**Luôn để Min replicas = 0.** Min replicas = 1 là chạy suốt 24 giờ × 30 ngày = 720 giờ, vượt xa 50 giờ miễn phí.

Xem chi phí / credit trong Portal:
- Tìm **Cost Management** → **Cost analysis** (chọn subscription Azure for Students): chi phí theo ngày / theo dịch vụ.
- Tìm **Subscriptions** → Azure for Students → **Overview**: phần credit còn lại (nếu Portal hiện); hoặc trang
  https://www.microsoftazuresponsorships.com/ (đăng nhập cùng tài khoản) → Balance.
- (Nên làm) **Cost Management** → **Budgets** → **Add**: đặt ngân sách nhỏ (vd 1 USD / tháng) kèm email cảnh báo; tạo
  budget không tốn tiền.
- Không lưu log ("Don't save logs") nên không có chi phí Log Analytics. Không thêm Container Registry của Azure (dùng
  ghcr.io công khai, miễn phí).
