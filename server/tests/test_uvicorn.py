"""Test qua uvicorn THẬT (không phải ASGITransport): máy chủ chạy trong luồng nền trên 127.0.0.1, cổng trống ngẫu nhiên,
engine giả. Luôn có hạn giờ, luôn tắt máy chủ trong finally và kiểm cổng đã đóng.

Cấu hình uvicorn ở đây = đúng các cờ của 3 lệnh chạy (chay-thu.ps1, Dockerfile, do-30-anh.mjs); test cuối file đọc nguồn
để chắc 3 lệnh đó vẫn có các cờ này.
"""
from __future__ import annotations

import json
import socket
import subprocess
import sys
import threading
import time
from contextlib import contextmanager

import httpx
import uvicorn

from conftest import SERVER, FakeEngine, jpeg_bytes, multipart

# Giống cờ CLI "--no-proxy-headers --limit-concurrency 16" của 3 lệnh chạy
UVICORN_FLAGS = {"proxy_headers": False, "limit_concurrency": 16}
COMMAND_FILES = ["chay-thu.ps1", "Dockerfile", "do-30-anh.mjs"]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def port_listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


@contextmanager
def real_server(app, **flags):
    """Bật uvicorn.Server trong luồng nền; tắt (should_exit) trong finally, chờ tối đa 10 giây."""
    port = free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, log_level="warning",
                            access_log=False, lifespan="on", **flags)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name=f"uvicorn-test-{port}", daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            if not thread.is_alive():
                raise RuntimeError("uvicorn không lên được")
            if time.monotonic() > deadline:
                raise TimeoutError("uvicorn không lên sau 10 giây")
            time.sleep(0.02)
        yield port
    finally:
        server.should_exit = True
        thread.join(10)
    assert not thread.is_alive(), "uvicorn chưa tắt sau 10 giây"


def test_x_forwarded_for_khong_lach_duoc_gioi_han_luot_qua_uvicorn_that(make_app):
    """Gửi từ 127.0.0.1 với X-Forwarded-For khác nhau mỗi lần: uvicorn không được thay IP -> lần 3 phải 429."""
    app = make_app(rate_limit_per_min=2)
    body, ctype = multipart([("image", "a.jpg", jpeg_bytes())])
    with real_server(app, **UVICORN_FLAGS) as port:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10) as c:
            codes = [c.post("/ocr", content=body, headers={"content-type": ctype, "x-forwarded-for": f"10.0.0.{i}"}).status_code
                     for i in (1, 2, 3)]
    assert not port_listening(port), "cổng còn nghe sau khi tắt máy chủ"
    assert codes == [200, 200, 429]


def _healthcheck_code() -> str:
    """Lấy đoạn python -c của HEALTHCHECK trong Dockerfile (dòng CMD ngay sau HEALTHCHECK)."""
    lines = (SERVER / "Dockerfile").read_text(encoding="utf-8").splitlines()
    i = next(k for k, line in enumerate(lines) if line.startswith("HEALTHCHECK"))
    cmd = lines[i + 1].strip()
    assert cmd.startswith("CMD ")
    arr = json.loads(cmd[4:])
    assert arr[:2] == ["python", "-c"]
    return arr[2]


def test_healthcheck_cua_dockerfile_chay_duoc_voi_may_chu_that(make_app):
    code = _healthcheck_code()
    assert "127.0.0.1:8765/health" in code and "timeout=3" in code
    loaded = make_app()
    not_loaded_engine = FakeEngine()
    not_loaded_engine.loaded = False
    not_loaded = make_app(engine=not_loaded_engine)
    results = []
    for app in (loaded, not_loaded):
        with real_server(app, **UVICORN_FLAGS) as port:
            p = subprocess.run([sys.executable, "-c", code.replace("8765", str(port))], capture_output=True, timeout=20)
            results.append(p.returncode)
        assert not port_listening(port)
    assert results == [0, 1]  # model đã nạp -> khỏe; chưa nạp (ok=false) -> không khỏe


def test_ba_lenh_chay_deu_co_no_proxy_headers_va_limit_concurrency_16():
    for name in COMMAND_FILES:
        src = (SERVER / name).read_text(encoding="utf-8-sig")
        assert "--no-proxy-headers" in src, f"{name} thiếu --no-proxy-headers"
        flat = src.replace('"', "").replace(", ", " ")  # Dockerfile CMD ["--limit-concurrency", "16"], mjs mảng chuỗi
        assert "--limit-concurrency 16" in flat, f"{name} thiếu --limit-concurrency 16"
