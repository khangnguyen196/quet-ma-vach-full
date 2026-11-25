# Máy chủ OCR R1 (server/) cho Azure Container Apps (1 vCPU / 2 GiB, scale tối thiểu 0, tối đa 1).
# Build + chạy thử + đẩy ghcr.io: GitHub Actions .github/workflows/server-image.yml (máy dự án không có Docker).
# Cách tạo Container App trên Azure Portal: server/AZURE.md.
#   docker build -t ocr-r1 server/        (chạy từ gốc repo; ngữ cảnh build = server/, xem .dockerignore)
#   docker run --rm -e AUTH_MODE=off -p 127.0.0.1:8080:8080 ocr-r1      (chạy thử không đăng nhập)
FROM python:3.12-slim

# Gắn ảnh ghcr.io với repo (trang package hiện link repo, GITHUB_TOKEN của repo đẩy được)
LABEL org.opencontainers.image.source="https://github.com/khangnguyen196/quet-ma-vach-full" \
      org.opencontainers.image.description="May chu OCR R1 (RapidOCR PP-OCRv6 small, khong cls) cho app quet ma vach"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Gói chạy máy chủ, ghim đúng phiên bản (không có gói test / đo)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Danh mục ứng viên (đợt kho-lon vòng 3): mức (c) = VN + 893 + th / jp / my / id / kr / cn + us, 532.732 sản phẩm Open
# Food Facts (ODbL, bản xuất 08/11/2026; LICENSES.md). Chỉ mục dựng LÚC BUILD (catalog_search.py build: mảng .npy + meta +
# dòng thô), lúc chạy nạp bằng mmap (không dựng lại: máy chủ scale về 0 thức dậy vẫn có ứng viên ngay lượt đầu).
# Vòng 4: lớp danh mục đứng TRƯỚC COPY các file máy chủ khác (sửa app.py không làm dựng lại chỉ mục ~20 giây; catalog_search.py
# chỉ cần numpy). Trước khi dựng: sha256 của file .gz phải trùng số ghi ở đây = số trong LICENSES.md (pytest
# test_sha256_danh_muc_trung_3_noi kiểm cả 3 nơi); sai thì build hỏng. Sau khi dựng (catalog_search.py verify): load_dir
# được, N == số dòng nguồn, sha256 nguồn trong meta trùng; sai thì build hỏng. Xóa .gz sau khi dựng (lớp COPY vẫn giữ
# ~14 MB trong ảnh). Thư mục đọc được bởi người dùng ocr (a+rX).
COPY catalog_search.py ./
COPY catalog/c.jsonl.gz /tmp/catalog-src/c.jsonl.gz
RUN echo "370a9ab314b3f6fc88ad7cf1fdd67011ab0a8cd57e9557d5362f8136a7bcd164  /tmp/catalog-src/c.jsonl.gz" | sha256sum -c - \
 && python catalog_search.py build /tmp/catalog-src/c.jsonl.gz /app/catalog-index \
 && python catalog_search.py verify /app/catalog-index /tmp/catalog-src/c.jsonl.gz \
 && rm -rf /tmp/catalog-src \
 && chmod -R a+rX /app/catalog-index

COPY app.py settings.py ocr_engine.py imaging.py upload.py ratelimit.py auth.py clip_engine.py kho_nhom.py LICENSES.md ./

# Model lúc build: wheel rapidocr==3.10.0 đã kèm PP-OCRv6_det_small.onnx + PP-OCRv6_rec_small.onnx trong
# site-packages/rapidocr/models. Kiểm sha256 (trùng server/README.md và MODEL_SHA256 của ocr_engine.py): sai thì build hỏng.
RUN python -c "import ocr_engine as e; p = e.model_problems(e.models_dir()); assert not p, p; print('sha256 model OK:', e.MODEL_SHA256)"

# Chạy thật: không tải model, CORS chỉ theo ALLOWED_ORIGINS (không localhost), BẮT BUỘC đăng nhập.
# AUTH_MODE=supabase là mặc định của ảnh: quên đặt SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY trên Azure thì máy chủ KHÔNG
# khởi động (an toàn hơn âm thầm cho qua). Chạy thử không đăng nhập (CI) phải tự đặt -e AUTH_MODE=off.
# OCR_THREADS=1: Container App 1 vCPU.
# MAX_PIXELS=50 MP; JPEG nhiều lượt quét (progressive, hoặc lượt quét đầu ít màu hơn ảnh) MAX_PIXELS_PROGRESSIVE=40 MP.
# Ca nặng nhất được nhận: JPEG nhiều lượt quét 40 MP, đo bằng CMYK progressive peak_wset 629 / riêng 822 MB (MiB, Windows 10;
# server/README.md mục "RAM ảnh lớn"), dưới 2 GiB của Container App. RAM thật trên Linux: workflow ghi memory.peak.
# CATALOG_PATH: thư mục chỉ mục dựng ở trên (đặt rỗng "-e CATALOG_PATH=" để tắt ứng viên: /ocr y hệt trước).
ENV PORT=8080 \
    CATALOG_PATH=/app/catalog-index \
    OCR_OFFLINE=1 \
    CORS_ALLOW_LOCALHOST=0 \
    AUTH_MODE=supabase \
    OCR_THREADS=1 \
    MAX_PIXELS=50000000 \
    MAX_PIXELS_PROGRESSIVE=40000000 \
    BODY_TIMEOUT_S=30

# Người dùng không phải root, không có thư mục nhà ghi được ngoài /tmp
RUN useradd --system --no-create-home --shell /usr/sbin/nologin ocr
USER ocr

# Nạp thử RapidOCR 1 lần BẰNG người dùng ocr (OCR_OFFLINE=1): chứng minh người dùng chạy thật đọc được model; thiếu / sai
# model hoặc thiếu thư viện hệ thống thì build hỏng ngay, lúc chạy không tải gì.
RUN python -c "import ocr_engine as e; o = e.OcrEngine(1, True); print('nạp thử OK', round(o.load_seconds, 2), 'giây')"
# Người dùng ocr nạp được chỉ mục (mmap) và tìm được: thiếu quyền đọc thì build hỏng.
RUN python -c "import catalog_search as c; x = c.CatalogIndex.load_dir('/app/catalog-index'); assert x.N > 0 and x.search_text('soda chanh 7up'), x.N; print('chỉ mục OK', x.N, 'sản phẩm')"

# Mã commit của ảnh (7 ký tự, workflow truyền --build-arg GIT_SHA=${GITHUB_SHA::7}); /health trả ở trường "commit"
# (sai dạng / không truyền -> "unknown"). Đặt SAU mọi RUN / COPY nặng: mỗi commit một giá trị, không làm mất cache các lớp trên.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

EXPOSE 8080
# Docker tự hỏi /health mỗi 30 giây (Python urllib, hạn 3 giây): không trả lời / không 200 / "ok" khác true -> "unhealthy".
# Cổng: PORT thiếu HOẶC rỗng -> 8080 (giống ${PORT:-8080} của CMD).
# Azure Container Apps KHÔNG dùng HEALTHCHECK này (nó có probe riêng); giữ cho docker run / CI.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import json, os, sys, urllib.request; r = urllib.request.urlopen('http://127.0.0.1:%s/health' % (os.environ.get('PORT') or '8080'), timeout=3); sys.exit(0 if r.status == 200 and json.load(r).get('ok') is True else 1)"]
# 0.0.0.0 CHỈ trong container (để ingress / cổng map của Docker tới được); trên máy tính dùng chay-thu.ps1 (127.0.0.1).
# Cổng đọc từ biến PORT (mặc định 8080) qua sh -c; "exec" để uvicorn là tiến trình chính (nhận tín hiệu tắt).
# 1 worker (model nạp 1 lần, ~520 MB RAM), tắt access log của uvicorn (có IP).
# --no-proxy-headers: uvicorn không tự lấy IP từ X-Forwarded-For; đứng sau ingress của Azure thì bật TRUST_PROXY=1 của app.
# --limit-concurrency 16: quá 16 kết nối / yêu cầu cùng lúc thì uvicorn tự trả 503 (dạng chữ, không CORS).
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port \"${PORT:-8080}\" --workers 1 --no-access-log --no-proxy-headers --limit-concurrency 16"]
