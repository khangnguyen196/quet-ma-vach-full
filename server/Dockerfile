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

COPY app.py settings.py ocr_engine.py imaging.py upload.py ratelimit.py auth.py ./

# Model lúc build: wheel rapidocr==3.10.0 đã kèm PP-OCRv6_det_small.onnx + PP-OCRv6_rec_small.onnx trong
# site-packages/rapidocr/models. Bước này kiểm sha256 (trùng server/README.md và MODEL_SHA256 của ocr_engine.py) rồi
# nạp RapidOCR 1 lần với OCR_OFFLINE=1: thiếu / sai model thì build hỏng ngay, lúc chạy không tải gì.
RUN python -c "import ocr_engine as e; p = e.model_problems(e.models_dir()); assert not p, p; print('sha256 model OK:', e.MODEL_SHA256)" \
 && python -c "import ocr_engine as e; o = e.OcrEngine(1, True); print('nạp thử OK', round(o.load_seconds, 2), 'giây')"

# Chạy thật: không tải model, chỉ CORS github.io (không localhost), đăng nhập tắt (AUTH_MODE=supabase làm ở đợt dang-nhap)
ENV OCR_OFFLINE=1 \
    CORS_ALLOW_LOCALHOST=0 \
    AUTH_MODE=off \
    OCR_THREADS=1

# Người dùng không phải root, không có thư mục nhà ghi được ngoài /tmp
RUN useradd --system --no-create-home --shell /usr/sbin/nologin ocr
USER ocr

EXPOSE 8765
# 0.0.0.0 CHỈ trong container (để cổng map của Docker tới được); trên máy tính dùng chay-thu.ps1 (127.0.0.1).
# 1 worker (model nạp 1 lần, ~520 MB RAM), tắt access log của uvicorn (có IP).
# --no-proxy-headers: uvicorn không tự lấy IP từ X-Forwarded-For; đứng sau proxy của mình thì bật TRUST_PROXY=1 của app.
# --limit-concurrency 16: quá 16 kết nối / yêu cầu cùng lúc thì uvicorn tự trả 503 (dạng chữ, không CORS).
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1", "--no-access-log", "--no-proxy-headers", "--limit-concurrency", "16"]
