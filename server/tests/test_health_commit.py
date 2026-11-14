"""/health có trường `commit` (đợt cung-co vòng 2): 7 ký tự mã commit của ảnh Docker, lấy từ biến GIT_SHA (Dockerfile
ARG GIT_SHA, workflow server-image.yml truyền --build-arg GIT_SHA=${GITHUB_SHA::7}). Thiếu / sai dạng -> "unknown"
(không bao giờ trả nguyên chuỗi lạ từ biến môi trường)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import settings as settings_module


@pytest.mark.parametrize("raw, expected", [
    ("a295a86", "a295a86"),
    ("0123456", "0123456"),
    ("", "unknown"),
    (None, "unknown"),
    ("A295A86", "unknown"),  # chữ hoa: git in chữ thường, chữ hoa là sai dạng
    ("a295a8", "unknown"),
    ("a295a86x", "unknown"),
    ("a295a86\n", "unknown"),
    (" a295a86", "unknown"),
    ("../../", "unknown"),
    ("unknown", "unknown"),
    ("g295a86", "unknown"),
])
def test_commit_from_env(raw, expected):
    assert settings_module.commit_from_env(raw) == expected


def test_load_settings_doc_git_sha():
    assert settings_module.load_settings({"GIT_SHA": "a295a86"}).commit == "a295a86"
    assert settings_module.load_settings({"GIT_SHA": "../../"}).commit == "unknown"
    assert settings_module.load_settings({}).commit == "unknown"


def test_health_co_commit_va_giu_version(make_app):
    with TestClient(make_app(commit="a295a86")) as c:
        body = c.get("/health").json()
    assert body["commit"] == "a295a86"
    assert body["version"] == "0.1.0"


def test_health_commit_mac_dinh_unknown(make_app):
    with TestClient(make_app()) as c:
        assert c.get("/health").json()["commit"] == "unknown"
