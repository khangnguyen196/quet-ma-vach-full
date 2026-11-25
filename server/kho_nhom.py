"""Kho sản phẩm của nhóm (đợt kho-nhom, vòng 4): ký / kiểm vector ảnh bằng HMAC, nạp kho từ Supabase, so độ giống.

- Khóa ký: biến KHO_NHOM_HMAC_KEY = đúng 64 ký tự hex (32 byte), khóa HMAC = bytes.fromhex(giá trị). Thiếu / sai dạng ->
  tính năng kho nhóm TẮT (log 1 dòng chỉ nêu TÊN biến, không bao giờ in giá trị), máy chủ vẫn khởi động.
- Cách ký (trùng comment cột ky của server/kho-nhom.sql):
    HMAC-SHA256(khóa, b"kho-nhom-v1" + 0x00 + duong_dan (UTF-8) + 0x00 + model (UTF-8) + 0x00 + 512 số float32 little-endian)
  ghi hex thường 64 ký tự; kiểm bằng hmac.compare_digest. Chữ ký phủ duong_dan (chứa uid) nên không chép được cặp vec + ky
  sang đường dẫn khác.
- Vector KHÔNG tin app: chỉ vector máy chủ tính + ký (POST /embed) mới được dùng; nạp kho thì bỏ mọi dòng sai chữ ký /
  sai model / vector sai dạng.
- Nạp kho: GET <SUPABASE_URL>/rest/v1/nhom_anh?select=…&order=id theo trang ≤ 1.000 dòng, tối đa 10 trang, bằng
  publishable key + token của CHÍNH người gửi (qua RLS; không bao giờ service_role). Cache dùng chung 60 giây (RLS cho mọi
  người đăng nhập thấy cùng dữ liệu), chỉ lấp sau khi token đã kiểm hợp lệ (app.py gọi sau auth). Lỗi / hết giờ (≤ 3 giây)
  -> None (request đó coi như kho rỗng); lỗi chỉ nhớ 2 giây.
Log không chứa token, khóa, đường dẫn ảnh, tên món, vector: chỉ số dòng và lý do bỏ.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import math
import os
import re
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import quote

import numpy as np

from clip_engine import DIMS, MODEL_ID

log = logging.getLogger("ocr_server.kho_nhom")

KEY_ENV = "KHO_NHOM_HMAC_KEY"
DOMAIN = b"kho-nhom-v1"
SEP = b"\x00"
_KEY_RE = re.compile(r"[0-9a-fA-F]{64}")
_KY_RE = re.compile(r"[0-9a-f]{64}")
# đường dẫn trong bucket nhom-anh: "<uid>/<uuid ảnh>.<jpg|png|webp>" (trùng CHECK cột duong_dan của kho-nhom.sql)
PATH_RE = re.compile(r"([0-9a-f-]{36})/[0-9a-f-]{36}\.(jpg|png|webp)")
PATH_MAX = 128
NORM_TOL = 1e-3  # |chuẩn L2 − 1| < 1e-3 (trùng hàm nhom_vec_hop_le của SQL)

PAGE_SIZE = 1000
MAX_PAGES = 10
CACHE_TTL_S = 60.0
FAIL_TTL_S = 2.0          # lỗi chỉ nhớ 2 giây (không gọi Supabase dồn dập khi nó đang hỏng)
FETCH_TIMEOUT_S = 3.0     # tổng thời gian nạp kho tối đa cho 1 request
PAGE_MAX_BYTES = 16 * 1024 * 1024  # 1.000 dòng × 512 số ~ 6 MB chữ: trần 16 MB mỗi trang
TOP_K = 3
SELECT = "id,san_pham_id,duong_dan,vec,model,ky,nhom_san_pham(ten,thuong_hieu,ma_vach)"


# ---------------- khóa ----------------

def parse_key(raw) -> bytes | None:
    """Giá trị biến KHO_NHOM_HMAC_KEY -> 32 byte, hoặc None nếu thiếu / sai dạng (không phải đúng 64 ký tự hex)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not _KEY_RE.fullmatch(s):
        return None
    return bytes.fromhex(s)


def key_problem(raw) -> str | None:
    """Câu lý do (chỉ có TÊN biến, không có giá trị) khi khóa thiếu / sai dạng; đúng thì None."""
    if raw is None or not str(raw).strip():
        return f"thiếu biến {KEY_ENV}"
    if parse_key(raw) is None:
        return f"biến {KEY_ENV} sai dạng (cần đúng 64 ký tự hex)"
    return None


def key_from_env(env=None) -> bytes | None:
    env = os.environ if env is None else env
    return parse_key(env.get(KEY_ENV))


# ---------------- ký / kiểm ----------------

def as_vec32(vec) -> np.ndarray:
    """-> mảng float32 (512,) chép riêng; sai dạng -> ValueError."""
    v = np.asarray(vec, dtype=np.float32).reshape(-1)
    if v.shape != (DIMS,):
        raise ValueError("vector phải đúng 512 số")
    return v


def message(duong_dan: str, model: str, vec) -> bytes:
    return (DOMAIN + SEP + str(duong_dan).encode("utf-8") + SEP + str(model).encode("utf-8") + SEP
            + as_vec32(vec).astype("<f4").tobytes())


def sign(key: bytes, duong_dan: str, model: str, vec) -> str:
    """Chữ ký hex thường 64 ký tự."""
    return hmac.new(key, message(duong_dan, model, vec), hashlib.sha256).hexdigest()


def verify(key: bytes, duong_dan, model, vec, ky) -> bool:
    if not isinstance(ky, str) or not _KY_RE.fullmatch(ky) or not isinstance(duong_dan, str) or not isinstance(model, str):
        return False
    try:
        want = sign(key, duong_dan, model, vec)
    except ValueError:
        return False
    return hmac.compare_digest(want, ky)


def vec_to_json(vec) -> list:
    """float32 -> list số JSON. float(float32) là float64 BẰNG ĐÚNG giá trị float32 (float64 chứa trọn float32), json in
    repr ngắn nhất của float64 đó, nên đọc lại (float64) rồi đổi float32 ra ĐÚNG số đã ký."""
    return [float(x) for x in as_vec32(vec)]


def vec_from_json(raw) -> np.ndarray | None:
    """Mảng số từ JSON (Supabase in real[] kiểu Postgres float4, hoặc số float64 của float32) -> float32 (512,) chuẩn ≈ 1.
    Sai dạng (không phải list 512 số, có bool / chuỗi / null, không hữu hạn, chuẩn lệch 1) -> None."""
    if not isinstance(raw, list) or len(raw) != DIMS:
        return None
    for x in raw:
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            return None
    with np.errstate(over="ignore", invalid="ignore"):
        v = np.asarray(raw, dtype=np.float64).astype(np.float32)
    if not np.all(np.isfinite(v)):
        return None
    n = math.sqrt(float(np.dot(v.astype(np.float64), v.astype(np.float64))))
    if not abs(n - 1.0) < NORM_TOL:
        return None
    return v


def path_uid(duong_dan) -> str | None:
    """'<uid>/<uuid>.<đuôi>' đúng dạng -> uid; sai dạng -> None."""
    if not isinstance(duong_dan, str) or len(duong_dan) > PATH_MAX:
        return None
    m = PATH_RE.fullmatch(duong_dan)
    return m.group(1) if m else None


# ---------------- kho ----------------

@dataclass
class Kho:
    """Kho đã lọc: mat (n, 512) float32, row_pid[i] = san_pham_id của dòng i, products[pid] = {ten, thuong_hieu, ma_vach}."""
    mat: np.ndarray
    row_pid: list
    products: dict
    dropped: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.row_pid)


def empty_kho() -> Kho:
    return Kho(np.zeros((0, DIMS), dtype=np.float32), [], {})


def _opt_text(x):
    return x if isinstance(x, str) else None


def build_kho(rows, key: bytes) -> Kho:
    """Dòng JSON của PostgREST -> Kho. Bỏ dòng: model khác MODEL_ID ("model"); vec sai dạng / chuẩn ("vec"); ky sai dạng
    hoặc HMAC sai, duong_dan sai dạng ("ky"); thiếu san_pham_id / tên món ("san_pham"); không phải object ("dang")."""
    dropped = {"model": 0, "vec": 0, "ky": 0, "san_pham": 0, "dang": 0}
    vecs, row_pid, products = [], [], {}
    for r in rows:
        if not isinstance(r, dict):
            dropped["dang"] += 1
            continue
        if r.get("model") != MODEL_ID:
            dropped["model"] += 1
            continue
        v = vec_from_json(r.get("vec"))
        if v is None:
            dropped["vec"] += 1
            continue
        if path_uid(r.get("duong_dan")) is None or not verify(key, r.get("duong_dan"), MODEL_ID, v, r.get("ky")):
            dropped["ky"] += 1
            continue
        pid = r.get("san_pham_id")
        sp = r.get("nhom_san_pham")
        if not isinstance(pid, str) or not pid or not isinstance(sp, dict) or not isinstance(sp.get("ten"), str) \
                or not sp["ten"].strip():
            dropped["san_pham"] += 1
            continue
        vecs.append(v)
        row_pid.append(pid)
        products.setdefault(pid, {"ten": sp["ten"], "thuong_hieu": _opt_text(sp.get("thuong_hieu")),
                                  "ma_vach": _opt_text(sp.get("ma_vach"))})
    mat = np.stack(vecs).astype(np.float32) if vecs else np.zeros((0, DIMS), dtype=np.float32)
    return Kho(mat, row_pid, products, {k: c for k, c in dropped.items() if c})


def top_matches(kho: Kho, vec, k: int = TOP_K) -> list:
    """Độ giống = tích vô hướng (2 vector đều chuẩn 1 = cos). Mỗi sản phẩm lấy ảnh giống nhất; ≤ k mục giảm dần
    (bằng điểm thì sản phẩm xuất hiện trước trong kho trước). diem làm tròn 4 số."""
    if kho is None or kho.n == 0:
        return []
    sims = kho.mat @ as_vec32(vec)
    best, order = {}, []
    for i, s in enumerate(sims.tolist()):
        pid = kho.row_pid[i]
        if pid not in best:
            order.append(pid)
            best[pid] = s
        elif s > best[pid]:
            best[pid] = s
    rank = sorted(range(len(order)), key=lambda j: (-best[order[j]], j))
    out = []
    for j in rank[:k]:
        pid = order[j]
        p = kho.products[pid]
        out.append({"san_pham_id": pid, "ten": p["ten"], "thuong_hieu": p["thuong_hieu"], "ma_vach": p["ma_vach"],
                    "diem": round(float(best[pid]), 4)})
    return out


def default_fetch(url: str, headers: dict, timeout: float):
    """GET JSON bằng urllib (không theo chuyển hướng); lỗi mạng / hết giờ -> auth.UpstreamError."""
    import auth

    return auth.http_get_json(url, headers, timeout, PAGE_MAX_BYTES)


class KhoStore:
    """Nạp + giữ kho dùng chung. get(token) CHẶN (gọi mạng): gọi trong luồng phụ. -> Kho (có thể rỗng) hoặc None (lỗi)."""

    def __init__(self, supabase_url: str, apikey: str, key: bytes, fetch=None, clock=time.monotonic,
                 ttl: float = CACHE_TTL_S, fail_ttl: float = FAIL_TTL_S, timeout: float = FETCH_TIMEOUT_S,
                 page_size: int = PAGE_SIZE, max_pages: int = MAX_PAGES):
        self.base = str(supabase_url).strip().rstrip("/") + "/rest/v1/nhom_anh"
        self._apikey = apikey
        self._key = key
        self._fetch = fetch or default_fetch
        self._clock = clock
        self.ttl = ttl
        self.fail_ttl = fail_ttl
        self.timeout = timeout
        self.page_size = page_size
        self.max_pages = max_pages
        self._lock = threading.Lock()
        self._cache = None  # (Kho, hạn)
        self._fail_until = None
        self.fetches = 0  # số lượt nạp (test đếm)

    def sign(self, duong_dan: str, vec) -> str:
        """Chữ ký của vector máy chủ vừa tính (POST /embed), model = MODEL_ID."""
        return sign(self._key, duong_dan, MODEL_ID, vec)

    def page_url(self, page: int) -> str:
        return (f"{self.base}?select={quote(SELECT, safe=',()')}&order=id"
                f"&limit={self.page_size}&offset={page * self.page_size}")

    def _fresh(self, now):
        c = self._cache
        return c[0] if c is not None and now < c[1] else None

    def get(self, token: str):
        now = self._clock()
        hit = self._fresh(now)
        if hit is not None:
            return hit
        if not self._lock.acquire(timeout=self.timeout):
            return None
        try:
            now = self._clock()
            hit = self._fresh(now)
            if hit is not None:
                return hit
            if self._fail_until is not None and now < self._fail_until:
                return None
            try:
                kho = self._load(token, now + self.timeout)
            except Exception as e:  # noqa: BLE001 - mạng, hết giờ, phản hồi lạ: chỉ ghi tên lỗi
                self._fail_until = self._clock() + self.fail_ttl
                # KhoLoadError / UpstreamError: câu chỉ có mã HTTP / tên lỗi; lỗi khác: chỉ tên loại lỗi
                reason = str(e) if type(e).__name__ in ("KhoLoadError", "UpstreamError") else type(e).__name__
                log.warning("kho nhóm: nạp lỗi (%s); request này coi như kho rỗng", reason)
                return None
            self._fail_until = None
            self._cache = (kho, self._clock() + self.ttl)
            drop = ", ".join(f"{k} {c}" for k, c in sorted(kho.dropped.items())) or "0"
            log.info("kho nhóm: nạp %d dòng (%d sản phẩm), bỏ: %s", kho.n, len(kho.products), drop)
            return kho
        finally:
            self._lock.release()

    def _load(self, token: str, deadline: float) -> Kho:
        self.fetches += 1
        headers = {"apikey": self._apikey, "Authorization": "Bearer " + token}
        rows = []
        for page in range(self.max_pages):
            left = deadline - self._clock()
            if left <= 0:
                raise KhoLoadError("hết giờ")
            status, data = self._fetch(self.page_url(page), headers, left)
            if status not in (200, 206):
                raise KhoLoadError(f"HTTP {status}")
            if not isinstance(data, list):
                raise KhoLoadError("phản hồi không phải danh sách")
            rows.extend(data)
            if len(data) < self.page_size:
                break
        else:
            log.warning("kho nhóm: chạm trần %d trang (%d dòng), chỉ dùng phần đã nạp", self.max_pages, len(rows))
        return build_kho(rows, self._key)


class KhoLoadError(RuntimeError):
    """Nạp kho lỗi (câu chỉ có mã HTTP / lý do, không URL, không token)."""
