"""Cấu hình máy chủ OCR, đọc từ biến môi trường (tên + mặc định giống server/.env.example).

Không có bí mật nào ở đây: SUPABASE_PUBLISHABLE_KEY là khóa CÔNG KHAI (nằm cả trong app trên trình duyệt). Không đọc
JWT secret hay service_role key. Giá trị sai (không phải số, âm…) -> từ chối khởi động với câu tiếng Việt; riêng 2 biến
Supabase thì câu lỗi chỉ nêu TÊN biến, không in giá trị.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

DEFAULT_ORIGIN = "https://khangnguyen196.github.io"
LOCALHOST_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


class SettingsError(RuntimeError):
    """Cấu hình sai: máy chủ không khởi động."""


def _int(env, name, default, minimum):
    raw = env.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = int(str(raw).strip())
    except ValueError:
        raise SettingsError(f"Biến {name}={raw!r} không phải số nguyên.") from None
    if value < minimum:
        raise SettingsError(f"Biến {name}={value} phải ≥ {minimum}.")
    return value


def _float(env, name, default, minimum_exclusive):
    raw = env.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(str(raw).strip().replace(",", "."))
    except ValueError:
        raise SettingsError(f"Biến {name}={raw!r} không phải số.") from None
    if not value > minimum_exclusive or value != value or value == float("inf"):
        raise SettingsError(f"Biến {name}={value} phải là số > {minimum_exclusive:g}.")
    return value


def _flag(env, name, default=False):
    raw = env.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    s = str(raw).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    raise SettingsError(f"Biến {name}={raw!r} chỉ nhận 1 hoặc 0.")


def _text(env, name):
    raw = env.get(name)
    return "" if raw is None else str(raw).strip()


def normalize_supabase_url(url: str) -> str:
    """Bỏ khoảng trắng và "/" cuối (issuer của token = <url>/auth/v1)."""
    return str(url or "").strip().rstrip("/")


def supabase_config_problem(url: str, key: str) -> str | None:
    """Câu lỗi (tiếng Việt, CHỈ có tên biến, không có giá trị) nếu cấu hình Supabase thiếu / sai; đủ thì None."""
    url = normalize_supabase_url(url)
    key = str(key or "").strip()
    missing = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_PUBLISHABLE_KEY", key)) if not v]
    if missing:
        return ("AUTH_MODE=supabase cần đủ 2 biến SUPABASE_URL và SUPABASE_PUBLISHABLE_KEY (đang thiếu: "
                + ", ".join(missing) + "). Điền vào server/.env hoặc dùng AUTH_MODE=off để chạy thử.")
    try:
        parts = urlsplit(url)
        ok = parts.scheme == "https" and bool(parts.hostname) and not parts.query and not parts.fragment \
            and not parts.username and not any(c.isspace() for c in url)
    except ValueError:
        ok = False
    if not ok:
        return "Biến SUPABASE_URL phải là địa chỉ https://… của project Supabase (Project URL)."
    return None


@dataclass(frozen=True)
class Settings:
    ocr_threads: int = 8            # intra_op_num_threads của onnxruntime (inter_op luôn 1)
    ocr_offline: bool = False       # 1 = thiếu model thì từ chối khởi động, không tải
    max_bytes: int = 5 * 1024 * 1024  # trần dung lượng ảnh
    multipart_overhead: int = 64 * 1024  # phần đầu multipart cho phép thêm (thân = ảnh + phần này)
    max_pixels: int = 50_000_000    # trần số điểm ảnh (rộng × cao) trước khi giải mã (đo RAM ảnh lớn: server/README.md)
    # trần riêng cho JPEG progressive (libjpeg giữ hệ số DCT cả ảnh lúc giải mã: CMYK progressive 50 MP ~936 MB riêng)
    max_pixels_progressive: int = 40_000_000
    rate_limit_per_min: int = 20    # lượt /ocr mỗi IP trong 60 giây
    rate_limit_max_ips: int = 10_000  # số IP tối đa giữ trong RAM
    max_concurrent: int = 1         # số ảnh OCR cùng lúc
    queue_max: int = 4              # số yêu cầu chờ tối đa (ngoài ảnh đang chạy)
    body_timeout_s: float = 30.0    # đọc thân ảnh tối đa bấy nhiêu giây, quá -> 408 (gửi rất chậm không giữ chỗ / RAM mãi)
    trust_proxy: bool = False       # 1 = lấy IP từ X-Forwarded-For (chỉ khi đứng sau proxy của mình)
    proxy_count: int = 1            # số proxy tin cậy phía trước (lấy phần tử thứ proxy_count tính từ phải)
    auth_mode: str = "off"          # off | supabase (kiểm token Supabase, cần 2 biến dưới)
    supabase_url: str = ""          # Project URL (https://<ref>.supabase.co), đã bỏ "/" cuối
    supabase_publishable_key: str = ""  # khóa CÔNG KHAI (publishable / anon), không phải secret / service_role
    rate_limit_user_per_min: int = 10   # lượt /ocr mỗi người dùng (user id) trong 60 giây (chỉ khi AUTH_MODE=supabase)
    rate_limit_max_users: int = 10_000  # số người dùng tối đa giữ trong RAM
    cors_allow_localhost: bool = False
    allowed_origins: tuple = field(default=(DEFAULT_ORIGIN,))

    @property
    def max_body(self) -> int:
        return self.max_bytes + self.multipart_overhead

    @property
    def cors_origin_regex(self):
        return LOCALHOST_ORIGIN_REGEX if self.cors_allow_localhost else None


def load_settings(env=None) -> Settings:
    env = os.environ if env is None else env
    auth_mode = str(env.get("AUTH_MODE") or "off").strip()
    supabase_url = normalize_supabase_url(_text(env, "SUPABASE_URL"))
    supabase_key = _text(env, "SUPABASE_PUBLISHABLE_KEY")
    if auth_mode == "supabase":
        problem = supabase_config_problem(supabase_url, supabase_key)
        if problem:
            raise SettingsError(problem)
    return Settings(
        ocr_threads=_int(env, "OCR_THREADS", 8, 1),
        ocr_offline=_flag(env, "OCR_OFFLINE"),
        max_bytes=_int(env, "MAX_BYTES", 5 * 1024 * 1024, 1),
        max_pixels=_int(env, "MAX_PIXELS", 50_000_000, 1),
        max_pixels_progressive=_int(env, "MAX_PIXELS_PROGRESSIVE", 40_000_000, 1),
        rate_limit_per_min=_int(env, "RATE_LIMIT_PER_MIN", 20, 1),
        rate_limit_max_ips=_int(env, "RATE_LIMIT_MAX_IPS", 10_000, 1),
        max_concurrent=_int(env, "MAX_CONCURRENT", 1, 1),
        queue_max=_int(env, "QUEUE_MAX", 4, 0),
        body_timeout_s=_float(env, "BODY_TIMEOUT_S", 30.0, 0),
        trust_proxy=_flag(env, "TRUST_PROXY"),
        proxy_count=_int(env, "PROXY_COUNT", 1, 1),
        auth_mode=auth_mode,
        supabase_url=supabase_url,
        supabase_publishable_key=supabase_key,
        rate_limit_user_per_min=_int(env, "RATE_LIMIT_USER_PER_MIN", 10, 1),
        rate_limit_max_users=_int(env, "RATE_LIMIT_MAX_USERS", 10_000, 1),
        cors_allow_localhost=_flag(env, "CORS_ALLOW_LOCALHOST"),
    )
