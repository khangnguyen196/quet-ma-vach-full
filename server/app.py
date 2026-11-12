"""Máy chủ OCR nhỏ (FastAPI): POST /ocr nhận 1 ảnh, trả các khung chữ của RapidOCR R1 (không cls); GET /health.

Chạy thử trên máy (chỉ 127.0.0.1): server/chay-thu.ps1. Chi tiết, định dạng trả về, giới hạn: server/README.md.
Không lưu ảnh, không file tạm, log không có IP / tên file / chữ OCR.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import ClientDisconnect

import auth
import imaging
import upload
from ocr_engine import ENGINE_INFO
from ratelimit import ConcurrencyGate, QueueFull, SlidingWindowLimiter, client_ip
from settings import Settings, load_settings

SERVER_VERSION = "0.1.0"
QUEUE_RETRY_AFTER = 5  # giây gợi ý chờ khi hàng đợi đầy

log = logging.getLogger("ocr_server")


def setup_logging():
    """Log riêng: chỉ thời gian + thông điệp (đường dẫn, mã, byte, số khung, giây). Tắt access log của uvicorn (có IP)."""
    logging.getLogger("uvicorn.access").disabled = True
    if not log.handlers:
        h = logging.StreamHandler(sys.stderr)
        h.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        log.addHandler(h)
    log.setLevel(logging.INFO)


def error(status: int, message: str, headers=None) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status, headers=headers)


def create_app(settings: Settings | None = None, engine=None) -> FastAPI:
    """engine: đối tượng có .run(img) -> list, .loaded, .info (test truyền engine giả); None = nạp RapidOCR lúc khởi động."""
    settings = settings or load_settings()
    auth.check_startup(settings.auth_mode)  # supabase / giá trị lạ -> ném lỗi, không khởi động
    setup_logging()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.engine is None:
            from ocr_engine import OcrEngine

            try:
                app.state.engine = OcrEngine(settings.ocr_threads, settings.ocr_offline)
            except Exception as e:
                log.error("KHÔNG KHỞI ĐỘNG được: %s", e)
                raise
        yield

    app = FastAPI(title="OCR R1", version=SERVER_VERSION, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = engine
    app.state.settings = settings
    app.state.limiter = SlidingWindowLimiter(settings.rate_limit_per_min, settings.rate_limit_max_ips)
    app.state.gate = ConcurrencyGate(settings.max_concurrent, settings.queue_max)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        t = time.perf_counter()
        request.state.nbytes = 0
        request.state.nboxes = 0
        response = await call_next(request)
        # KHÔNG ghi IP, tên file, chữ OCR, query string: chỉ đường dẫn, mã, byte, số khung, giây
        log.info("%s %s %d %dB %d khung %.3fs", request.method, request.url.path, response.status_code,
                 request.state.nbytes, request.state.nboxes, time.perf_counter() - t)
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        msg = {404: "Không có đường dẫn này.", 405: "Phương thức không được hỗ trợ."}.get(exc.status_code, "Yêu cầu không hợp lệ.")
        return error(exc.status_code, msg)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return error(422, "Yêu cầu không hợp lệ.")

    @app.exception_handler(Exception)
    async def server_error(request, exc):
        log.error("lỗi máy chủ: %s", type(exc).__name__)
        return error(500, "Lỗi máy chủ, thử lại sau.")

    @app.get("/health")
    async def health(request: Request):
        eng = request.app.state.engine
        loaded = bool(eng is not None and getattr(eng, "loaded", False))
        return {"ok": loaded, "modelLoaded": loaded, "engine": dict(ENGINE_INFO), "version": SERVER_VERSION}

    @app.post("/ocr")
    async def ocr(request: Request):
        st: Settings = request.app.state.settings
        try:
            auth.check_request(st.auth_mode, request)
        except auth.AuthError as e:
            return error(e.status, e.message)
        ok, retry = request.app.state.limiter.check(client_ip(request, st.trust_proxy, st.proxy_count))
        if not ok:
            return error(429, f"Gửi quá nhiều ảnh (tối đa {st.rate_limit_per_min} ảnh mỗi phút). Thử lại sau {retry} giây.",
                         {"Retry-After": str(retry)})
        eng = request.app.state.engine
        if eng is None or not getattr(eng, "loaded", False):
            return error(503, "Máy chủ chưa nạp xong model OCR.", {"Retry-After": str(QUEUE_RETRY_AFTER)})
        # Giành chỗ TRƯỚC khi đọc thân ảnh: hàng đợi đầy thì 503 ngay, chưa đọc byte nào (RAM có trần:
        # tối đa MAX_CONCURRENT + QUEUE_MAX ảnh trong RAM cùng lúc).
        try:
            slot = request.app.state.gate.reserve()
        except QueueFull:
            return error(503, "Máy chủ đang bận (hàng đợi đầy). Thử lại sau ít giây.", {"Retry-After": str(QUEUE_RETRY_AFTER)})
        try:
            try:
                async with asyncio.timeout(st.body_timeout_s):
                    data, nbytes = await upload.read_image(request, st.max_bytes, st.max_body)
            except TimeoutError:
                secs = f"{st.body_timeout_s:g}".replace(".", ",")
                return error(408, f"Gửi ảnh quá lâu (quá {secs} giây). Kiểm tra mạng rồi thử lại.")
            except upload.UploadError as e:
                return error(e.status, e.message)
            except ClientDisconnect:
                # khách đóng kết nối giữa chừng: không phải lỗi máy chủ, 1 dòng log, không traceback
                log.info("khách ngắt kết nối khi đang gửi ảnh")
                return error(400, "Kết nối bị ngắt khi đang gửi ảnh.")
            request.state.nbytes = nbytes
            await slot.acquire()  # chờ khóa OCR (ảnh đã nằm trong RAM, đã tính vào chỗ đã giành)
            result = await run_in_threadpool(process, eng, data, st.max_pixels)
        except imaging.ImageError as e:
            return error(e.status, e.message)
        finally:
            slot.release()  # mọi đường ra (lỗi, 408, 413, 415, ngắt, huỷ) trả chỗ đúng 1 lần
        request.state.nboxes = len(result["items"])
        return result

    return app


def process(engine, data, max_pixels: int) -> dict:
    """Chạy trong threadpool: giải mã + thu nhỏ + OCR. Tọa độ theo ảnh SAU khi thu nhỏ (width, height)."""
    t0 = time.perf_counter()
    img, (ow, oh) = imaging.decode(data, max_pixels)
    t1 = time.perf_counter()
    items = engine.run(img)
    t2 = time.perf_counter()
    w, h = img.size
    return {
        "items": items,
        "width": w,
        "height": h,
        "origWidth": ow,
        "origHeight": oh,
        "ms": round((t2 - t0) * 1000, 1),
        "msOcr": round((t2 - t1) * 1000, 1),
        "engine": dict(ENGINE_INFO),
    }


app = create_app()
