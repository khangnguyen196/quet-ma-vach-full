# Máy chủ OCR R1 (server/) – để SAU NÀY đưa lên Azure B1s. CHƯA BUILD (máy chủ dự án không có Docker), chỉ kiểm bằng đọc.
#   docker build -t ocr-r1 server/        (chạy từ gốc repo; ngữ cảnh build = server/, xem .dockerignore)
#   docker run --rm -p 127.0.0.1:8765:8765 ocr-r1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Gói chạy máy chủ, ghim đúng phiên bản (không có gói test / đo)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py settings.py ocr_engine.py imaging.py upload.py ratelimit.py auth.py LICENSES.md ./

# Model lúc build: wheel rapidocr==3.10.0 đã kèm PP-OCRv6_det_small.onnx + PP-OCRv6_rec_small.onnx trong
# site-packages/rapidocr/models. Kiểm sha256 (trùng server/README.md và MODEL_SHA256 của ocr_engine.py): sai thì build hỏng.
RUN python -c "import ocr_engine as e; p = e.model_problems(e.models_dir()); assert not p, p; print('sha256 model OK:', e.MODEL_SHA256)"

# Chạy thật: không tải model, chỉ CORS github.io (không localhost), đăng nhập tắt (AUTH_MODE=supabase làm ở đợt dang-nhap)
# MAX_PIXELS=50 MP; JPEG nhiều lượt quét (progressive, hoặc lượt quét đầu ít màu hơn ảnh) MAX_PIXELS_PROGRESSIVE=40 MP.
# Ca nặng nhất được nhận: JPEG nhiều lượt quét 40 MP, đo bằng CMYK progressive peak_wset 629 / riêng 822 MB (MiB; loại không
# progressive ở 40 MP chưa đo, ước tương đương), Windows 10 máy 8 GB. 78 MB chỉ là biên so với 900 MB, CHƯA phải biên trên
# B1s: 30 ảnh thật đã 549 MB peak_wset, B1s 1 GiB còn HĐH + Docker (chưa đo). Lần đầu lên B1s nên đặt MAX_PIXELS=24000000,
# MAX_PIXELS_PROGRESSIVE=20000000, bật swap, đo VmHWM rồi mới nâng dần (server/README.md, mục "RAM ảnh lớn").
ENV OCR_OFFLINE=1 \
    CORS_ALLOW_LOCALHOST=0 \
    AUTH_MODE=off \
    OCR_THREADS=1 \
    MAX_PIXELS=50000000 \
    MAX_PIXELS_PROGRESSIVE=40000000 \
    BODY_TIMEOUT_S=30

# Người dùng không phải root, không có thư mục nhà ghi được ngoài /tmp
RUN useradd --system --no-create-home --shell /usr/sbin/nologin ocr
USER ocr

# Nạp thử RapidOCR 1 lần BẰNG người dùng ocr (OCR_OFFLINE=1): chứng minh người dùng chạy thật đọc được model; thiếu / sai
# model hoặc thiếu thư viện hệ thống thì build hỏng ngay, lúc chạy không tải gì. (Chưa build lần nào để kiểm.)
RUN python -c "import ocr_engine as e; o = e.OcrEngine(1, True); print('nạp thử OK', round(o.load_seconds, 2), 'giây')"

EXPOSE 8765
# Docker tự hỏi /health mỗi 30 giây (Python urllib, hạn 3 giây): không trả lời / không 200 / "ok" khác true -> "unhealthy".
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import json, sys, urllib.request; r = urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3); sys.exit(0 if r.status == 200 and json.load(r).get('ok') is True else 1)"]
# 0.0.0.0 CHỈ trong container (để cổng map của Docker tới được); trên máy tính dùng chay-thu.ps1 (127.0.0.1).
# 1 worker (model nạp 1 lần, ~520 MB RAM), tắt access log của uvicorn (có IP).
# --no-proxy-headers: uvicorn không tự lấy IP từ X-Forwarded-For; đứng sau proxy của mình thì bật TRUST_PROXY=1 của app.
# --limit-concurrency 16: quá 16 kết nối / yêu cầu cùng lúc thì uvicorn tự trả 503 (dạng chữ, không CORS).
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1", "--no-access-log", "--no-proxy-headers", "--limit-concurrency", "16"]
