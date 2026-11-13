"""CORS đọc danh sách nguồn từ ALLOWED_ORIGINS (đợt may-chu-2): đọc, chuẩn hóa, từ chối dạng sai; preflight thật."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from conftest import FakeEngine
import settings
from settings import DEFAULT_ORIGIN, SettingsError, load_settings


def parse_allowed_origins(raw):
    # tra lúc chạy (không import tên): trên settings.py cũ từng test đỏ riêng, không phải lỗi thu thập
    return settings.parse_allowed_origins(raw)

AZ_ORIGINS = "https://khangnguyen196.github.io,https://localhost:5173"


@pytest.mark.parametrize("raw", [None, "", "   ", ",", " , ,"])
def test_trong_hoac_khong_dat_chi_github_io(raw):
    assert parse_allowed_origins(raw) == (DEFAULT_ORIGIN,)
    env = {} if raw is None else {"ALLOWED_ORIGINS": raw}
    assert load_settings(env).allowed_origins == (DEFAULT_ORIGIN,)


@pytest.mark.parametrize("raw, expected", [
    ("https://a.example", ("https://a.example",)),
    ("https://a.example/", ("https://a.example",)),
    (" https://a.example ,  http://b.example:8080/ ", ("https://a.example", "http://b.example:8080")),
    (AZ_ORIGINS, ("https://khangnguyen196.github.io", "https://localhost:5173")),
    ("https://a.example,,https://b.example,", ("https://a.example", "https://b.example")),
    ("https://a.example,https://a.example/", ("https://a.example",)),  # trùng thì giữ 1
    ("HTTPS://A.Example", ("https://a.example",)),  # trình duyệt gửi chữ thường
    ("https://a.example:443,http://b.example:80", ("https://a.example", "http://b.example")),  # cổng mặc định bỏ
    ("http://127.0.0.1:5173", ("http://127.0.0.1:5173",)),
])
def test_doc_nhieu_dang(raw, expected):
    assert parse_allowed_origins(raw) == expected
    assert load_settings({"ALLOWED_ORIGINS": raw}).allowed_origins == expected


@pytest.mark.parametrize("bad", [
    "*", "https://a.example,*", "ftp://x", "https://a.example/path", "https://a.example/?q=1", "https://a.example#x",
    "https://user@a.example", "https://user:pw@a.example", "a.example", "//a.example", "https://", "https://:8080",
    "https://a.example:abc", "https://a.example:99999", "https://a b.example", "null", "https://*.example",
])
def test_tu_choi_dang_sai(bad):
    with pytest.raises(SettingsError) as e:
        load_settings({"ALLOWED_ORIGINS": bad})
    assert "ALLOWED_ORIGINS" in str(e.value)


def _app(env):
    import app as app_module

    return app_module.create_app(load_settings(env), engine=FakeEngine())


def _preflight(c, origin):
    return c.options("/ocr", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                      "Access-Control-Request-Headers": "content-type, authorization"})


def test_preflight_nguon_duoc_phep_co_header_nguon_la_khong_co():
    with TestClient(_app({"ALLOWED_ORIGINS": "https://a.example, https://localhost:5173/"})) as c:
        for ok in ("https://a.example", "https://localhost:5173"):
            r = _preflight(c, ok)
            assert r.status_code == 200
            assert r.headers.get("access-control-allow-origin") == ok
        # github.io KHÔNG còn khi ALLOWED_ORIGINS đặt danh sách khác (danh sách thay mặc định, không cộng)
        for bad in (DEFAULT_ORIGIN, "https://evil.example", "http://localhost:5173", "https://a.example.evil.example"):
            r = _preflight(c, bad)
            assert "access-control-allow-origin" not in r.headers
            assert c.get("/health", headers={"Origin": bad}).headers.get("access-control-allow-origin") is None


def test_cors_allow_localhost_cong_them_voi_allowed_origins():
    """CORS_ALLOW_LOCALHOST=1 (chay-thu.ps1) CỘNG thêm localhost (mọi cổng) vào ALLOWED_ORIGINS, không thay."""
    with TestClient(_app({"ALLOWED_ORIGINS": "https://a.example", "CORS_ALLOW_LOCALHOST": "1"})) as c:
        for ok in ("https://a.example", "http://localhost:5173", "http://127.0.0.1:8080"):
            assert _preflight(c, ok).headers.get("access-control-allow-origin") == ok
        assert "access-control-allow-origin" not in _preflight(c, "https://evil.example").headers
