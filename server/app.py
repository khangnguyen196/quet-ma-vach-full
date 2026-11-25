"""Máy chủ OCR nhỏ (FastAPI): POST /ocr nhận 1 ảnh, trả các khung chữ của RapidOCR R1 (không cls); GET /health.

Chạy thử trên máy (chỉ 127.0.0.1): server/chay-thu.ps1. Chi tiết, định dạng trả về, giới hạn: server/README.md.
Không lưu ảnh, không file tạm, log không có IP / tên file / chữ OCR.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
from contextlib import asynccontextmanager

from anyio import to_thread
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import ClientDisconnect

import auth
import clip_engine
import imaging
import kho_nhom
import upload
from ocr_engine import ENGINE_INFO
from ratelimit import ConcurrencyGate, DailyLimiter, QueueFull, SlidingWindowLimiter, client_ip, rate_key
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


# ---- danh mục ứng viên (đợt kho-lon vòng 2, P4): cờ tùy chọn CATALOG_PATH ----
CANDIDATES_K = 10


def catalog_path_from_env(env=None) -> str:
    """CATALOG_PATH: THƯ MỤC chỉ mục dựng sẵn (catalog_search.py build; nạp bằng mmap, ảnh Docker dùng cách này) hoặc
    file danh mục .jsonl / .jsonl.gz (dựng trong RAM lúc khởi động, cho test / thử); trống / không có = không nạp
    (/ocr trả y hệt trước)."""
    env = os.environ if env is None else env
    return str(env.get("CATALOG_PATH") or "").strip()


def load_catalog(path: str):
    """Nạp danh mục MỘT lần (lúc khởi động). Lỗi -> log tên lỗi, trả None: OCR vẫn chạy, chỉ không có candidates."""
    if not path:
        return None
    t = time.perf_counter()
    try:
        from catalog_search import CatalogIndex  # import lười: không đặt CATALOG_PATH thì không cần file này

        cat = CatalogIndex.load(path)
    except Exception as e:  # noqa: BLE001
        log.error("KHÔNG nạp được danh mục (CATALOG_PATH): %s; /ocr chạy không có candidates", type(e).__name__)
        return None
    log.info("danh mục: %d sản phẩm, %d từ, nạp %.1fs (%s)", cat.N, len(cat.vocab), time.perf_counter() - t,
             "thư mục mmap" if getattr(cat, "mmapped", False) else "dựng trong RAM")
    return cat


def attach_candidates(catalog, result: dict, timing: dict | None = None) -> dict:
    """Thêm "candidates" (<= 10 mục {code, name, brand, img, text, grp, score}) tính từ chính items OCR. Tìm lỗi -> bỏ
    khóa candidates, log chỉ tên lỗi (không chữ OCR), trả result như cũ.
    timing (dict, tùy chọn): ghi "searchMs" = số ms CHỈ của catalog.search (H3 vòng 3 đọc từ dòng log /ocr)."""
    if catalog is None:
        return result
    t = time.perf_counter()
    try:
        cands = catalog.search(result.get("items") or [], CANDIDATES_K)
        if timing is not None:
            timing["searchMs"] = (time.perf_counter() - t) * 1000
        result["candidates"] = [
            {"code": str(c["code"]), "name": str(c["name"]), "brand": str(c["brand"]), "img": str(c["img"]),
             "text": str(c["text"]), "grp": str(c["grp"]), "score": float(c["score"])}
            for c in cands
        ]
    except Exception as e:  # noqa: BLE001
        result.pop("candidates", None)
        log.error("lỗi khi tìm ứng viên: %s", type(e).__name__)
    return result


_FROM_ENV = object()  # create_app(nhom_key=…) không truyền: đọc biến KHO_NHOM_HMAC_KEY


def load_clip(path: str):
    """Nạp CLIP MỘT lần (lifespan). Lỗi -> log tên lỗi, trả None: OCR vẫn chạy, kho nhóm tắt."""
    if not path:
        return None
    t = time.perf_counter()
    try:
        eng = clip_engine.ClipEngine(path, threads=1)
    except Exception as e:  # noqa: BLE001
        log.error("KHÔNG nạp được model CLIP (CLIP_MODEL_PATH): %s; kho nhóm tắt", type(e).__name__)
        return None
    log.info("CLIP: nạp %s trong %.1fs", clip_engine.MODEL_ID, time.perf_counter() - t)
    return eng


def nhom_enabled(state) -> bool:
    """Kho nhóm BẬT chỉ khi: AUTH_MODE=supabase + khóa ký hợp lệ (cả hai -> có nhom_store) + CLIP đã nạp."""
    return state.nhom_store is not None and state.clip is not None


def nhom_match(clip, kho, img):
    """Chạy trong luồng phụ: vector CLIP của ảnh đã giải mã -> ≤ 3 ứng viên nhom. Kho rỗng / lỗi -> None (không tính
    vector). Lỗi CLIP -> None, log chỉ tên lỗi (OCR + candidates trả như cũ)."""
    if kho is None or kho.n == 0:
        return None
    try:
        return kho_nhom.top_matches(kho, clip.embed_image(img))
    except Exception as e:  # noqa: BLE001
        log.error("lỗi khi so kho nhóm: %s", type(e).__name__)
        return None


async def get_kho(store, token):
    """Nạp / lấy cache kho trong luồng phụ BỎ ĐƯỢC (abandon_on_cancel), tối đa store.timeout giây. Lỗi / hết giờ -> None."""
    try:
        return await asyncio.wait_for(to_thread.run_sync(store.get, token, abandon_on_cancel=True), store.timeout)
    except TimeoutError:
        log.warning("kho nhóm: nạp quá %.0f giây; request này coi như kho rỗng", store.timeout)
        return None
    except Exception as e:  # noqa: BLE001
        log.error("kho nhóm: lỗi %s", type(e).__name__)
        return None


def create_app(settings: Settings | None = None, engine=None, verifier=None, catalog=None, clip=None,
               nhom_key=_FROM_ENV, nhom_store=None) -> FastAPI:
    """engine: đối tượng có .run(img) -> list, .loaded, .info (test truyền engine giả); None = nạp RapidOCR lúc khởi động.
    verifier: bộ kiểm token (test truyền bản có hàm tải giả); None = tự tạo khi AUTH_MODE=supabase.
    catalog: chỉ mục danh mục có .search(items, k) (test truyền); None = nạp từ CATALOG_PATH lúc khởi động (nếu có).
    clip: đối tượng có .embed_image(img) -> vector 512 (test truyền bản giả); None = nạp từ CLIP_MODEL_PATH (nếu có).
    nhom_key: khóa ký 32 byte (test truyền); không truyền = đọc KHO_NHOM_HMAC_KEY. nhom_store: KhoStore (test truyền
    bản có hàm tải giả); None = tự tạo khi bật được."""
    settings = settings or load_settings()
    auth.check_startup(settings)  # supabase thiếu / sai biến, giá trị lạ -> ném lỗi, không khởi động
    setup_logging()
    if verifier is None:
        verifier = auth.make_verifier(settings)
    # Kho nhóm: thiếu / sai khóa hoặc không phải AUTH_MODE=supabase -> TẮT (1 dòng log, chỉ tên biến), vẫn khởi động
    if nhom_key is _FROM_ENV:
        raw = os.environ.get(kho_nhom.KEY_ENV)
        nhom_problem = kho_nhom.key_problem(raw)
        nhom_key = kho_nhom.parse_key(raw)
        del raw
    else:
        nhom_problem = None if nhom_key else f"thiếu biến {kho_nhom.KEY_ENV}"
    if nhom_key is None:
        nhom_store = None
        log.info("kho nhóm TẮT: %s", nhom_problem)
    elif settings.auth_mode != "supabase":
        nhom_store = None
        log.info("kho nhóm TẮT: cần AUTH_MODE=supabase")
    elif nhom_store is None:
        nhom_store = kho_nhom.KhoStore(settings.supabase_url, settings.supabase_publishable_key, nhom_key)
    del nhom_key  # khóa chỉ còn trong nhom_store (không gắn vào app.state)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.auth_mode == "supabase" and app.state.verifier is not None:
            await run_in_threadpool(auth.warm_up_log, app.state.verifier)  # 1 dòng log "JWKS: n khóa (…)"
        if app.state.engine is None:
            from ocr_engine import OcrEngine

            try:
                app.state.engine = OcrEngine(settings.ocr_threads, settings.ocr_offline)
            except Exception as e:
                log.error("KHÔNG KHỞI ĐỘNG được: %s", e)
                raise
        if app.state.catalog is None and app.state.catalog_path:
            app.state.catalog = await run_in_threadpool(load_catalog, app.state.catalog_path)
        if app.state.clip is None and app.state.clip_path:
            app.state.clip = await run_in_threadpool(load_clip, app.state.clip_path)
        if app.state.nhom_store is not None:
            log.info("kho nhóm %s", "BẬT" if nhom_enabled(app.state) else "TẮT: CLIP chưa nạp (CLIP_MODEL_PATH)")
        yield

    app = FastAPI(title="OCR R1", version=SERVER_VERSION, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = engine
    app.state.settings = settings
    app.state.verifier = verifier
    app.state.catalog = catalog
    app.state.catalog_path = catalog_path_from_env()
    app.state.clip = clip
    app.state.clip_path = str(os.environ.get("CLIP_MODEL_PATH") or "").strip()
    app.state.nhom_store = nhom_store
    app.state.limiter = SlidingWindowLimiter(settings.rate_limit_per_min, settings.rate_limit_max_ips)
    # giới hạn theo người dùng (user id của Supabase), cộng thêm với giới hạn theo IP
    app.state.user_limiter = SlidingWindowLimiter(settings.rate_limit_user_per_min, settings.rate_limit_max_users)
    # giới hạn mỗi người mỗi ngày UTC (trong RAM, mất khi máy chủ ngủ / khởi động lại), cộng thêm với 2 giới hạn phút
    app.state.daily_limiter = DailyLimiter(settings.daily_limit_per_user, settings.rate_limit_max_users)
    app.state.gate = ConcurrencyGate(settings.max_concurrent, settings.queue_max)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["Retry-After"],  # trang khác tên miền mới đọc được số giây chờ của 429 / 503
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        t = time.perf_counter()
        request.state.nbytes = 0
        request.state.nboxes = 0
        request.state.search_ms = None
        response = await call_next(request)
        # KHÔNG ghi IP, tên file, chữ OCR, query string: chỉ đường dẫn, mã, byte, số khung, ms tìm ứng viên, giây
        # ("tìm -" = không tìm: không có danh mục / không tới bước tìm / tìm lỗi)
        sms = request.state.search_ms
        log.info("%s %s %d %dB %d khung tìm %s %.3fs", request.method, request.url.path, response.status_code,
                 request.state.nbytes, request.state.nboxes, "-" if sms is None else f"{sms:.1f}ms",
                 time.perf_counter() - t)
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
        # commit: 7 ký tự mã commit của ảnh Docker (biến GIT_SHA), sai dạng / không có -> "unknown"
        # catalog (vòng 3): đã nạp danh mục ứng viên chưa + số sản phẩm (không lộ đường dẫn CATALOG_PATH)
        cat = request.app.state.catalog
        n = getattr(cat, "N", 0) if cat is not None else 0
        clip = request.app.state.clip
        # clip / nhom (đợt kho-nhom): model CLIP đã nạp chưa; kho nhóm bật chưa (không lộ khóa / đường dẫn)
        return {"ok": loaded, "modelLoaded": loaded, "engine": dict(ENGINE_INFO), "version": SERVER_VERSION,
                "commit": request.app.state.settings.commit,
                "catalog": {"loaded": cat is not None, "n": n if isinstance(n, int) and not isinstance(n, bool) else 0},
                "clip": {"loaded": clip is not None, "model": clip_engine.MODEL_ID if clip is not None else None},
                "nhom": {"enabled": nhom_enabled(request.app.state)}}

    async def check_limits_and_auth(request: Request, st: Settings):
        """Giới hạn IP -> kiểm token -> giới hạn theo người dùng (phút, rồi ngày UTC). -> (user_id, None) hoặc
        (None, JSONResponse lỗi). Dùng chung cho /ocr và /embed (cùng bộ đếm)."""
        # IP trước để ai gửi dồn dập token rác không làm máy chủ gọi Supabase liên tục.
        # IPv6 đếm theo mạng /64 (rate_key), IPv4 theo từng địa chỉ
        ok, retry = request.app.state.limiter.check(rate_key(client_ip(request, st.trust_proxy, st.proxy_count)))
        if not ok:
            return None, error(429, f"Gửi quá nhiều ảnh (tối đa {st.rate_limit_per_min} ảnh mỗi phút). "
                                    f"Thử lại sau {retry} giây.", {"Retry-After": str(retry)})
        try:
            user_id = await auth.check_request(st.auth_mode, request, request.app.state.verifier)
        except auth.AuthError as e:
            return None, error(e.status, e.message, e.headers)
        except Exception as e:  # noqa: BLE001 - lỗi lạ khi kiểm token (PyJWT / cryptography…): 500 NGAY ở đây để có
            # header CORS (handler Exception chung nằm ngoài CORSMiddleware). Log chỉ tên lỗi: câu lỗi có thể chứa token.
            log.error("lỗi khi kiểm đăng nhập: %s", type(e).__name__)
            return None, error(500, "Lỗi khi kiểm đăng nhập trên máy chủ.")
        if user_id is not None:
            ok, retry = request.app.state.user_limiter.check(user_id)
            if not ok:
                return None, error(429, f"Tài khoản này gửi quá nhiều ảnh (tối đa {st.rate_limit_user_per_min} ảnh mỗi "
                                        f"phút). Thử lại sau {retry} giây.", {"Retry-After": str(retry)})
            ok, retry = request.app.state.daily_limiter.check(user_id)
            if not ok:
                hours, minutes = divmod((retry + 59) // 60, 60)  # làm tròn lên tới phút
                return None, error(429, f"Tài khoản này đã gửi đủ {st.daily_limit_per_user} ảnh hôm nay (ngày tính theo "
                                        f"giờ UTC, đổi ngày lúc 7 giờ sáng giờ Việt Nam). Thử lại sau {hours} giờ "
                                        f"{minutes} phút.", {"Retry-After": str(retry)})
        return user_id, None

    @app.post("/ocr")
    async def ocr(request: Request):
        st: Settings = request.app.state.settings
        # Thứ tự: giới hạn IP -> kiểm token -> giới hạn theo người dùng (phút, rồi ngày UTC) -> model -> hàng đợi -> đọc ảnh.
        user_id, resp = await check_limits_and_auth(request, st)
        if resp is not None:
            return resp
        eng = request.app.state.engine
        if eng is None or not getattr(eng, "loaded", False):
            return error(503, "Máy chủ chưa nạp xong model OCR.", {"Retry-After": str(QUEUE_RETRY_AFTER)})
        # Giành chỗ TRƯỚC khi đọc thân ảnh: hàng đợi đầy thì 503 ngay, chưa đọc byte nào (RAM có trần:
        # tối đa MAX_CONCURRENT + QUEUE_MAX ảnh trong RAM cùng lúc).
        try:
            slot = request.app.state.gate.reserve()
        except QueueFull:
            return error(503, "Máy chủ đang bận (hàng đợi đầy). Thử lại sau ít giây.", {"Retry-After": str(QUEUE_RETRY_AFTER)})
        # Kho nhóm (đợt kho-nhom): bật thì nạp kho (cache 60 giây) NGAY, song song với lúc đọc ảnh + OCR; token đã kiểm ở
        # trên (chỉ lấp cache sau khi token hợp lệ). Tắt -> không làm gì, /ocr y hệt trước.
        kho_task = None
        if user_id is not None and nhom_enabled(request.app.state):
            token = auth.parse_bearer(request.headers.get("authorization"))
            kho_task = asyncio.ensure_future(get_kho(request.app.state.nhom_store, token))
            del token
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
            nhom = None
            clip = request.app.state.clip
            if kho_task is None:
                result = await run_in_threadpool(process, eng, data, st.max_pixels, st.max_pixels_progressive)
            elif st.nhom_parallel:
                # SONG SONG: chờ kho (thường có sẵn trong cache), rồi OCR + CLIP chạy 2 luồng cùng lúc
                kho = await kho_task
                result, nhom = await run_in_threadpool(process_parallel, eng, clip, kho, data, st.max_pixels,
                                                       st.max_pixels_progressive)
            else:
                # NỐI TIẾP: OCR xong mới tính vector (kho đã nạp song song trong lúc OCR)
                result, img = await run_in_threadpool(process_keep, eng, data, st.max_pixels, st.max_pixels_progressive)
                kho = await kho_task
                nhom = await run_in_threadpool(nhom_match, clip, kho, img)
                del img
            del data
            if request.app.state.catalog is not None:  # vẫn giữ chỗ hàng đợi: tìm ứng viên tính vào lượt này
                timing = {}
                result = await run_in_threadpool(attach_candidates, request.app.state.catalog, result, timing)
                request.state.search_ms = timing.get("searchMs")
            if nhom is not None:  # chỉ khi kho (sau lọc) có ≥ 1 dòng và tính vector được
                result["nhom"] = nhom
        except imaging.ImageError as e:
            return error(e.status, e.message)
        except Exception as e:  # noqa: BLE001 - lỗi lạ (engine…): trả 500 NGAY ở đây để có header CORS
            # (handler Exception chung nằm ngoài CORSMiddleware nên 500 từ đó không có CORS). Log chỉ tên lỗi.
            log.error("lỗi máy chủ: %s", type(e).__name__)
            return error(500, "Lỗi máy chủ, thử lại sau.")
        finally:
            slot.release()  # mọi đường ra (lỗi, 408, 413, 415, ngắt, huỷ) trả chỗ đúng 1 lần
            if kho_task is not None and not kho_task.done():
                kho_task.cancel()  # lỗi giữa chừng: bỏ lượt nạp kho (luồng phụ bỏ được, cache vẫn lấp nếu nạp xong)
        request.state.nboxes = len(result["items"])
        return result

    @app.post("/embed")
    async def embed(request: Request):
        """Vector CLIP + chữ ký HMAC cho 1 ảnh mặt trước sắp lưu vào kho nhóm (README "Hợp đồng API kho nhóm")."""
        st: Settings = request.app.state.settings
        # Tắt -> 503 ngay (không đọc token, không gọi Supabase, không tính lượt). Bật: giới hạn IP -> token -> giới hạn
        # người dùng phút + ngày (CÙNG bộ đếm với /ocr) -> hàng đợi -> đọc ảnh (≤ 2.097.152 B, vượt 413) + duong_dan
        # (thiếu / sai dạng 400, khác uid 403) -> định dạng byte (không phải JPEG / PNG 415; lệch đuôi 400) -> vector.
        if not nhom_enabled(request.app.state):
            return error(503, "Kho nhóm chưa bật trên máy chủ.")
        user_id, resp = await check_limits_and_auth(request, st)
        if resp is not None:
            return resp
        if user_id is None:  # không xảy ra: bật kho nhóm cần AUTH_MODE=supabase
            return error(500, auth.MSG_CONFIG)
        try:
            slot = request.app.state.gate.reserve()
        except QueueFull:
            return error(503, "Máy chủ đang bận (hàng đợi đầy). Thử lại sau ít giây.", {"Retry-After": str(QUEUE_RETRY_AFTER)})
        try:
            try:
                # trần ảnh = giới hạn bucket nhom-anh (2.097.152 B), không phải MAX_BYTES của /ocr (vòng 5)
                async with asyncio.timeout(st.body_timeout_s):
                    data, nbytes, fields = await upload.read_form(request, EMBED_MAX_BYTES,
                                                                  EMBED_MAX_BYTES + st.multipart_overhead,
                                                                  text_fields=(EMBED_PATH_FIELD,))
            except TimeoutError:
                secs = f"{st.body_timeout_s:g}".replace(".", ",")
                return error(408, f"Gửi ảnh quá lâu (quá {secs} giây). Kiểm tra mạng rồi thử lại.")
            except upload.UploadError as e:
                return error(e.status, e.message)
            except ClientDisconnect:
                log.info("khách ngắt kết nối khi đang gửi ảnh")
                return error(400, "Kết nối bị ngắt khi đang gửi ảnh.")
            request.state.nbytes = nbytes
            duong_dan = fields.get(EMBED_PATH_FIELD)
            if duong_dan is None:
                return error(400, f"Thiếu trường '{EMBED_PATH_FIELD}' (đường dẫn ảnh trong kho nhóm).")
            uid = kho_nhom.path_uid(duong_dan)
            if uid is None:
                return error(400, "Đường dẫn ảnh sai dạng (cần <mã tài khoản>/<mã ảnh>.jpg hoặc .png).")
            if uid != user_id:
                return error(403, "Đường dẫn ảnh phải nằm trong thư mục của chính tài khoản đang đăng nhập.")
            # vòng 5: bucket nhom-anh chỉ để JPEG / PNG ở đây; byte gửi /embed phải ĐÚNG là file sẽ tải lên (đuôi khớp)
            kind = imaging.detect_format(data)
            if kind not in ("jpeg", "png"):
                return error(415, "Kho nhóm chỉ nhận ảnh JPEG hoặc PNG.")
            if kind != kho_nhom.path_format(duong_dan):
                ext = ".jpg" if kind == "jpeg" else ".png"
                return error(400, f"Ảnh là {kind.upper()} nhưng đường dẫn không có đuôi {ext}: gửi đúng ảnh sẽ tải lên "
                                  f"kho nhóm, với đuôi khớp định dạng ảnh.")
            await slot.acquire()
            vec = await run_in_threadpool(embed_image_bytes, request.app.state.clip, data, st.max_pixels,
                                          st.max_pixels_progressive)
            del data
            ky = request.app.state.nhom_store.sign(duong_dan, vec)
        except imaging.ImageError as e:
            return error(e.status, e.message)
        except clip_engine.ClipImageError as e:
            return error(400, str(e))
        except Exception as e:  # noqa: BLE001 - lỗi lạ: 500 có CORS, log chỉ tên lỗi
            log.error("lỗi máy chủ: %s", type(e).__name__)
            return error(500, "Lỗi máy chủ, thử lại sau.")
        finally:
            slot.release()
        return {"model": clip_engine.MODEL_ID, "vec": kho_nhom.vec_to_json(vec), "ky": ky}

    return app


EMBED_PATH_FIELD = "duong_dan"
EMBED_MAX_BYTES = 2_097_152  # = file_size_limit của bucket nhom-anh (kho-nhom.sql); ảnh lớn hơn -> 413


def embed_image_bytes(clip, data, max_pixels: int, max_pixels_progressive: int | None = None):
    """Chạy trong threadpool: giải mã ĐÚNG như /ocr (imaging.decode: xoay EXIF, RGB, cạnh dài ≤ 1.600) rồi vector CLIP,
    để vector /embed và vector /ocr tính trên cùng một kiểu ảnh."""
    img, _ = imaging.decode(data, max_pixels, max_pixels_progressive=max_pixels_progressive)
    return clip.embed_image(img)


def process(engine, data, max_pixels: int, max_pixels_progressive: int | None = None) -> dict:
    """Chạy trong threadpool: giải mã + thu nhỏ + OCR. Tọa độ theo ảnh SAU khi thu nhỏ (width, height)."""
    return process_keep(engine, data, max_pixels, max_pixels_progressive)[0]


def process_parallel(engine, clip, kho, data, max_pixels: int, max_pixels_progressive: int | None = None):
    """Như process, nhưng kho có ≥ 1 dòng thì tính vector CLIP trong 1 luồng riêng CÙNG LÚC với OCR. -> (result, nhom)."""
    t0 = time.perf_counter()
    img, orig = imaging.decode(data, max_pixels, max_pixels_progressive=max_pixels_progressive)
    out = {}
    th = None
    if kho is not None and kho.n > 0:
        th = threading.Thread(target=lambda: out.__setitem__("nhom", nhom_match(clip, kho, img)), daemon=True)
        th.start()
    try:
        result = _ocr_result(engine, img, orig, t0)
    finally:
        if th is not None:
            th.join()
    return result, out.get("nhom")


def process_keep(engine, data, max_pixels: int, max_pixels_progressive: int | None = None):
    """process + giữ lại ảnh đã giải mã (để tính vector CLIP sau OCR). -> (result, ảnh PIL)."""
    t0 = time.perf_counter()
    img, orig = imaging.decode(data, max_pixels, max_pixels_progressive=max_pixels_progressive)
    return _ocr_result(engine, img, orig, t0), img


def _ocr_result(engine, img, orig, t0) -> dict:
    ow, oh = orig
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
