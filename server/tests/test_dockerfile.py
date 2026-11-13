"""Đọc nguồn Dockerfile / .dockerignore / requirements (đợt may-chu-2): máy không có Docker, nên kiểm bằng đọc ở đây;
build + chạy thật nằm ở workflow .github/workflows/server-image.yml (CI)."""
from __future__ import annotations

import json
import re

from conftest import SERVER

REPO = SERVER.parent


def _dockerfile() -> str:
    return (SERVER / "Dockerfile").read_text(encoding="utf-8")


def _env(src: str) -> dict:
    """Gộp mọi lệnh ENV (dạng KEY=VALUE, nối dòng bằng "\\")."""
    out = {}
    flat = re.sub(r"\\\n", " ", src)
    for line in flat.splitlines():
        if line.startswith("ENV "):
            for k, v in re.findall(r"([A-Z_][A-Z0-9_]*)=(\S+)", line[4:]):
                out[k] = v
    return out


def _last_cmd(src: str) -> list:
    lines = [ln for ln in src.splitlines() if ln.startswith("CMD ")]
    return json.loads(lines[-1][4:])


def test_cong_8080_doc_tu_port():
    src = _dockerfile()
    env = _env(src)
    assert env["PORT"] == "8080"
    assert re.search(r"^EXPOSE 8080$", src, re.M)
    assert "8765" not in src  # cổng cũ không còn ở đâu trong Dockerfile
    cmd = _last_cmd(src)
    assert cmd[:2] == ["sh", "-c"] and len(cmd) == 3
    shell = cmd[2]
    assert shell.startswith("exec uvicorn app:app --host 0.0.0.0 ")
    assert '--port "${PORT:-8080}"' in shell
    for flag in ("--workers 1", "--no-access-log", "--no-proxy-headers", "--limit-concurrency 16"):
        assert flag in shell


def test_auth_mode_mac_dinh_supabase_va_cau_hinh_chay_that():
    env = _env(_dockerfile())
    assert env["AUTH_MODE"] == "supabase"  # quên đặt biến Supabase trên Azure thì máy chủ không khởi động
    assert env["OCR_OFFLINE"] == "1" and env["CORS_ALLOW_LOCALHOST"] == "0"
    assert env["MAX_PIXELS"] == "50000000" and env["MAX_PIXELS_PROGRESSIVE"] == "40000000"
    assert "SUPABASE_URL" not in env and "SUPABASE_PUBLISHABLE_KEY" not in env and "ALLOWED_ORIGINS" not in env


def test_nguoi_dung_khong_phai_root_va_kiem_sha256_luc_build():
    src = _dockerfile()
    assert re.search(r"^USER ocr$", src, re.M)
    assert "model_problems" in src and "MODEL_SHA256" in src
    for old in ("B1s", "CHƯA BUILD", "làm ở đợt dang-nhap"):
        assert old not in src


def test_dockerignore_khong_lot_tests_env():
    lines = [ln.strip() for ln in (SERVER / ".dockerignore").read_text(encoding="utf-8").splitlines()]
    for must in ("tests/", ".env", ".env.*", "__pycache__/", ".venv/", "venv/"):
        assert must in lines
    assert "!.env.example" in lines  # chỉ file mẫu (không bí mật); Dockerfile không COPY nó


def test_requirements_chi_chu_ascii():
    for name in ("requirements.txt", "requirements-dev.txt"):
        data = (SERVER / name).read_bytes()
        assert max(data) < 128, f"{name} có byte > 127 (pip trên Windows đọc cp1252)"
