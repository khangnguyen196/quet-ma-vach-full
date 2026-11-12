"""Kiểm token đăng nhập Supabase cho POST /ocr (đợt dang-nhap).

AUTH_MODE=off (mặc định): cho qua mọi yêu cầu (chạy thử trên máy, test).
AUTH_MODE=supabase: mọi yêu cầu phải có "Authorization: Bearer <access token của Supabase>". Giá trị khác -> từ chối
khởi động. Không bao giờ âm thầm cho qua.

Hai đường kiểm, chọn theo "alg" trong phần đầu token (đọc CHƯA kiểm, chỉ để chọn đường):
- ES256 / RS256 (có kid): kiểm chữ ký TẠI MÁY bằng khóa công khai JWKS của project (<SUPABASE_URL>/auth/v1/.well-known/
  jwks.json, giữ trong RAM 10 phút). Thuật toán lấy THEO KHÓA (kty / crv / alg của JWK), phải trùng alg của token.
- HS256 (project còn dùng khóa đối xứng cũ): KHÔNG có JWT secret ở máy chủ, nên hỏi Supabase GET /auth/v1/user; kết quả
  hợp lệ lưu tạm tối đa 60 giây (khóa = sha256 của token). User id lấy từ phản hồi của Supabase.
- alg khác (none, HS384 / 512, PS*, lạ) -> 401.
Không đọc JWT secret hay service_role key. Supabase lỗi / không trả lời -> 503, KHÔNG cho qua.
Không bao giờ ghi token, email, sub vào log hay câu lỗi.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict

import jwt
from starlette.concurrency import run_in_threadpool

from settings import normalize_supabase_url, supabase_config_problem

KNOWN_MODES = ("off", "supabase")

MAX_TOKEN_LEN = 4096          # token dài hơn -> 401, không xử lý
HTTP_TIMEOUT_S = 5.0          # hạn giờ mỗi lần gọi Supabase
JWKS_MAX_BYTES = 64 * 1024    # đọc JWKS tối đa
USER_MAX_BYTES = 64 * 1024    # đọc phản hồi /user tối đa
JWKS_TTL_S = 600.0            # giữ JWKS trong RAM 10 phút
JWKS_UNKNOWN_KID_GAP_S = 60.0  # kid lạ: tải lại JWKS tối đa 1 lần mỗi 60 giây
JWKS_FAIL_BACKOFF_S = 5.0     # tải JWKS lỗi: 5 giây sau mới thử lại (giữa chừng trả 503 ngay)
USER_CACHE_TTL_S = 60.0       # lưu tạm kết quả /user hợp lệ
USER_CACHE_MAX = 1000
LEEWAY_S = 30                 # lệch đồng hồ cho exp / iat / nbf
RETRY_AFTER_S = 5             # Retry-After của 503
AUDIENCE = "authenticated"
ASYMMETRIC = ("ES256", "RS256")

_TOKEN_RE = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
_BEARER_RE = re.compile(r"Bearer +(\S+)", re.IGNORECASE)

log = logging.getLogger("ocr_server.auth")

MSG_MISSING = "Cần đăng nhập để dùng máy chủ OCR (thiếu token đăng nhập)."
MSG_INVALID = "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại."
MSG_UPSTREAM = "Chưa kiểm được đăng nhập (máy chủ đăng nhập không trả lời). Thử lại sau ít giây."
MSG_CONFIG = "Cấu hình đăng nhập sai trên máy chủ."


class AuthConfigError(RuntimeError):
    pass


class AuthError(Exception):
    def __init__(self, status: int, message: str, headers: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.headers = headers


class UpstreamError(Exception):
    """Gọi Supabase lỗi (mạng, hết giờ, phản hồi hỏng / quá lớn). Câu lỗi chỉ là tên loại lỗi, không có URL / token."""


def _unauthorized(message: str = MSG_INVALID, missing: bool = False) -> AuthError:
    challenge = "Bearer" if missing else 'Bearer error="invalid_token"'
    return AuthError(401, message, {"WWW-Authenticate": challenge})


def _unavailable() -> AuthError:
    return AuthError(503, MSG_UPSTREAM, {"Retry-After": str(RETRY_AFTER_S)})


# ---------------- gọi Supabase bằng urllib (thay được bằng hàm giả trong test) ----------------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Không đi theo chuyển hướng (3xx -> coi như lỗi): chỉ nói chuyện với đúng địa chỉ đã cấu hình."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def http_get_json(url: str, headers: dict, timeout: float, max_bytes: int):
    """GET -> (mã HTTP, JSON đã đọc hoặc None nếu không phải JSON). Lỗi mạng / hết giờ / quá max_bytes -> UpstreamError."""
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "qmv-ocr-server", **headers})
    # Lưu ý: timeout của urllib tính theo TỪNG lần đọc / kết nối của socket, không phải tổng thời gian cả yêu cầu
    # (máy chủ nhả từng chút có thể kéo dài hơn timeout; rủi ro thấp vì chỉ gọi đúng địa chỉ Supabase đã cấu hình).
    try:
        try:
            resp = _opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            resp = e  # 4xx / 5xx / 3xx: vẫn có mã + thân
        with resp:
            status = resp.status if hasattr(resp, "status") and resp.status is not None else resp.code
            body = resp.read(max_bytes + 1)
    except (urllib.error.URLError, http.client.HTTPException, OSError, TimeoutError, ValueError, AttributeError) as e:
        raise UpstreamError(type(e).__name__) from None
    if len(body) > max_bytes:
        raise UpstreamError("phản hồi quá lớn")
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        data = None
    return status, data


def default_fetch_jwks(url: str, timeout: float = HTTP_TIMEOUT_S):
    return http_get_json(url, {}, timeout, JWKS_MAX_BYTES)


def default_fetch_user(url: str, apikey: str, token: str, timeout: float = HTTP_TIMEOUT_S):
    return http_get_json(url, {"apikey": apikey, "Authorization": "Bearer " + token}, timeout, USER_MAX_BYTES)


# ---------------- đọc header ----------------

def parse_bearer(header_value) -> str:
    """'Bearer <token>' -> token. Thiếu / sai dạng / quá dài / không đủ 3 phần -> AuthError 401."""
    if header_value is None or not str(header_value).strip():
        raise _unauthorized(MSG_MISSING, missing=True)
    raw = str(header_value)
    if len(raw) > MAX_TOKEN_LEN + 16:
        raise _unauthorized()
    m = _BEARER_RE.fullmatch(raw.strip())
    if not m:
        raise _unauthorized()
    token = m.group(1)
    if len(token) > MAX_TOKEN_LEN or not _TOKEN_RE.fullmatch(token):
        raise _unauthorized()
    return token


def _key_alg(jwk: dict):
    """Thuật toán theo KHÓA: EC P-256 -> ES256, RSA -> RS256 (alg ghi trong JWK nếu có phải trùng). Khác -> None (bỏ)."""
    if not isinstance(jwk, dict) or not isinstance(jwk.get("kid"), str) or not jwk["kid"]:
        return None
    if jwk.get("use") not in (None, "sig"):
        return None
    kty = jwk.get("kty")
    if kty == "EC" and jwk.get("crv") == "P-256":
        expected = "ES256"
    elif kty == "RSA":
        expected = "RS256"
    else:
        return None  # oct (khóa đối xứng), OKP, đường cong khác: không bao giờ dùng
    if jwk.get("alg") is not None and jwk.get("alg") != expected:
        return None
    return expected


def parse_jwks(data) -> dict:
    """JWKS (dict) -> {kid: (alg, khóa công khai)}. Sai dạng -> UpstreamError; khóa không dùng được thì bỏ qua."""
    if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
        raise UpstreamError("JWKS sai dạng")
    keys = {}
    for jwk in data["keys"]:
        alg = _key_alg(jwk)
        if alg is None:
            continue
        try:
            keys[jwk["kid"]] = (alg, jwt.PyJWK(jwk, algorithm=alg).key)
        except Exception:  # noqa: BLE001 - JWK hỏng: bỏ khóa đó
            continue
    return keys


class SupabaseVerifier:
    """Kiểm access token của Supabase. Hàm verify() CHẶN (gọi mạng): gọi trong threadpool.

    fetch_jwks(url) -> (mã HTTP, JSON); fetch_user(url, apikey, token) -> (mã HTTP, JSON); lỗi mạng thì ném.
    clock: đồng hồ đơn điệu (lưu tạm, hạn tải lại); wall: giờ thật (so với exp của token).
    """

    def __init__(self, supabase_url: str, publishable_key: str, fetch_jwks=None, fetch_user=None,
                 clock=time.monotonic, wall=time.time, timeout: float = HTTP_TIMEOUT_S):
        base = normalize_supabase_url(supabase_url)
        self.issuer = base + "/auth/v1"
        self.jwks_url = self.issuer + "/.well-known/jwks.json"
        self.user_url = self.issuer + "/user"
        self._apikey = publishable_key
        self._timeout = timeout
        self._fetch_jwks = fetch_jwks or (lambda url: default_fetch_jwks(url, self._timeout))
        self._fetch_user = fetch_user or (lambda url, k, t: default_fetch_user(url, k, t, self._timeout))
        self._clock = clock
        self._wall = wall
        self._jwks_lock = threading.Lock()
        self._keys = None            # {kid: (alg, key)} của lần tải thành công gần nhất
        self._fetched_at = None      # lúc tải thành công gần nhất
        self._unknown_kid_at = None  # lúc tải lại gần nhất vì kid lạ
        self._fail_until = None      # tải lỗi: tới lúc này mới thử lại
        self._user_lock = threading.Lock()
        self._user_cache: OrderedDict[str, tuple[str, float]] = OrderedDict()

    # ---- JWKS ----

    def _refresh(self, now: float) -> None:
        """Tải JWKS (đang giữ _jwks_lock). Lỗi -> UpstreamError (không cho qua)."""
        if self._fail_until is not None and now < self._fail_until:
            raise UpstreamError("đang chờ thử lại")
        try:
            status, data = self._fetch_jwks(self.jwks_url)
            if status != 200:
                raise UpstreamError(f"HTTP {status}")
            keys = parse_jwks(data)
        except UpstreamError as e:
            self._fail_until = now + JWKS_FAIL_BACKOFF_S
            log.warning("JWKS: tải lỗi (%s)", e)
            raise
        except Exception as e:  # noqa: BLE001 - OSError, TimeoutError, lỗi lạ của hàm tải
            self._fail_until = now + JWKS_FAIL_BACKOFF_S
            log.warning("JWKS: tải lỗi (%s)", type(e).__name__)
            raise UpstreamError(type(e).__name__) from None
        self._fail_until = None
        self._keys = keys
        self._fetched_at = now

    def warm_up(self) -> list:
        """Tải JWKS 1 lần lúc khởi động. Trả danh sách alg của các khóa dùng được. Lỗi -> UpstreamError."""
        with self._jwks_lock:
            self._refresh(self._clock())
            return sorted(alg for alg, _ in self._keys.values())

    def _key_for(self, kid: str):
        with self._jwks_lock:
            now = self._clock()
            fetched_now = False
            if self._keys is None or now - self._fetched_at >= JWKS_TTL_S:
                self._refresh(now)
                fetched_now = True
            if kid in self._keys:
                return self._keys[kid]
            if not fetched_now and (self._unknown_kid_at is None or now - self._unknown_kid_at >= JWKS_UNKNOWN_KID_GAP_S):
                self._unknown_kid_at = now
                self._refresh(now)
                if kid in self._keys:
                    return self._keys[kid]
        raise _unauthorized()

    def _verify_jwks(self, token: str, alg: str, kid) -> str:
        if not isinstance(kid, str) or not kid:
            raise _unauthorized()
        try:
            key_alg, key = self._key_for(kid)
        except UpstreamError:
            raise _unavailable() from None
        if key_alg != alg:
            raise _unauthorized()
        try:
            payload = jwt.decode(token, key=key, algorithms=[key_alg], audience=AUDIENCE, issuer=self.issuer,
                                 leeway=LEEWAY_S, options={"require": ["exp", "sub", "aud", "iss"]})
        except jwt.PyJWTError:
            raise _unauthorized() from None
        sub = payload.get("sub")
        if not isinstance(sub, str) or not sub:
            raise _unauthorized()
        if payload.get("is_anonymous") is True:
            raise _unauthorized()
        return sub

    # ---- /auth/v1/user ----

    def _cache_ttl(self, token: str) -> float:
        """min(60 giây, thời gian còn lại tới exp của token nếu đọc được). <= 0 -> không lưu."""
        try:
            exp = jwt.decode(token, options={"verify_signature": False}).get("exp")
        except jwt.PyJWTError:
            exp = None
        if isinstance(exp, (int, float)) and not isinstance(exp, bool):
            return min(USER_CACHE_TTL_S, exp - self._wall())
        return USER_CACHE_TTL_S

    def _verify_user(self, token: str) -> str:
        h = hashlib.sha256(token.encode()).hexdigest()
        now = self._clock()
        with self._user_lock:
            hit = self._user_cache.get(h)
            if hit is not None:
                if now < hit[1]:
                    return hit[0]
                del self._user_cache[h]
        try:
            status, data = self._fetch_user(self.user_url, self._apikey, token)
        except Exception as e:  # noqa: BLE001 - mạng, hết giờ, lỗi lạ
            log.warning("/user: gọi lỗi (%s)", type(e).__name__)
            raise _unavailable() from None
        if status in (401, 403):
            raise _unauthorized()
        if status != 200:
            log.warning("/user: HTTP %s", status)
            raise _unavailable()
        uid = data.get("id") if isinstance(data, dict) else None
        if not isinstance(uid, str) or not uid:
            log.warning("/user: phản hồi thiếu id")
            raise _unavailable()
        if data.get("is_anonymous") is True:
            raise _unauthorized()
        ttl = self._cache_ttl(token)
        if ttl > 0:
            with self._user_lock:
                now = self._clock()
                self._user_cache[h] = (uid, now + ttl)
                self._user_cache.move_to_end(h)
                if len(self._user_cache) > USER_CACHE_MAX:
                    for k in [k for k, (_, until) in self._user_cache.items() if until <= now]:
                        del self._user_cache[k]
                    while len(self._user_cache) > USER_CACHE_MAX:
                        self._user_cache.popitem(last=False)
        return uid

    # ---- chung ----

    def verify(self, token: str) -> str:
        """token (đã qua parse_bearer) -> user id. Sai -> AuthError 401; Supabase lỗi -> AuthError 503."""
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise _unauthorized() from None
        alg = header.get("alg")
        if alg in ASYMMETRIC:
            return self._verify_jwks(token, alg, header.get("kid"))
        if alg == "HS256":
            return self._verify_user(token)
        raise _unauthorized()


# ---------------- gắn vào app ----------------

def check_startup(settings) -> None:
    """Gọi trong create_app. off -> được; supabase thiếu / sai 2 biến -> AuthConfigError (câu chỉ có tên biến);
    giá trị khác -> AuthConfigError."""
    mode = settings.auth_mode
    if mode == "off":
        return
    if mode == "supabase":
        problem = supabase_config_problem(settings.supabase_url, settings.supabase_publishable_key)
        if problem:
            raise AuthConfigError(problem)
        return
    raise AuthConfigError(f"AUTH_MODE={mode!r} không hợp lệ (chỉ nhận: off, supabase).")


def make_verifier(settings):
    """AUTH_MODE=supabase -> SupabaseVerifier dùng urllib thật; off -> None."""
    if settings.auth_mode != "supabase":
        return None
    return SupabaseVerifier(settings.supabase_url, settings.supabase_publishable_key)


def warm_up_log(verifier) -> None:
    """Lúc khởi động: tải JWKS 1 lần, ghi 1 dòng log (không URL). Lỗi thì vẫn khởi động (yêu cầu cần JWKS sẽ 503)."""
    try:
        algs = verifier.warm_up()
    except UpstreamError as e:
        log.warning("JWKS: chưa tải được lúc khởi động (%s); token ES256 / RS256 sẽ nhận 503 tới khi tải được", e)
        return
    detail = ", ".join(algs) if algs else "không có khóa bất đối xứng: project dùng HS256, kiểm qua /auth/v1/user"
    log.info("JWKS: %d khóa (%s)", len(algs), detail)


async def check_request(mode: str, request, verifier) -> str | None:
    """Gọi ở /ocr sau giới hạn IP. off -> None (cho qua). supabase -> user id, hoặc ném AuthError (401 / 503).
    Còn lại (cấu hình sai lọt qua khởi động) -> AuthError 500, không bao giờ cho qua."""
    if mode == "off":
        return None
    if mode != "supabase" or verifier is None:
        raise AuthError(500, MSG_CONFIG)
    token = parse_bearer(request.headers.get("authorization"))
    return await run_in_threadpool(verifier.verify, token)
