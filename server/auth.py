"""Chỗ kiểm token đăng nhập (để sẵn, CHƯA làm).

AUTH_MODE=off (mặc định): cho qua mọi yêu cầu (chạy thử trên máy).
AUTH_MODE=supabase: CHƯA cài đặt (làm ở đợt dang-nhap, Supabase + Google) -> từ chối khởi động; nếu vì lý do nào đó
vẫn vào được hàm kiểm thì trả 501. Giá trị khác -> từ chối khởi động. Không bao giờ âm thầm cho qua.
"""
from __future__ import annotations

KNOWN_MODES = ("off", "supabase")


class AuthConfigError(RuntimeError):
    pass


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def check_startup(mode: str) -> None:
    if mode == "off":
        return
    if mode == "supabase":
        raise AuthConfigError("AUTH_MODE=supabase chưa cài đặt, làm ở đợt dang-nhap. Dùng AUTH_MODE=off để chạy thử.")
    raise AuthConfigError(f"AUTH_MODE={mode!r} không hợp lệ (chỉ nhận: off; supabase làm ở đợt dang-nhap).")


def check_request(mode: str, request) -> None:
    """Gọi ở đầu mỗi yêu cầu /ocr. off -> cho qua; còn lại -> ném AuthError (không bao giờ cho qua)."""
    if mode == "off":
        return
    if mode == "supabase":
        raise AuthError(501, "Đăng nhập (AUTH_MODE=supabase) chưa cài đặt, làm ở đợt dang-nhap.")
    raise AuthError(500, "Cấu hình đăng nhập sai trên máy chủ.")
