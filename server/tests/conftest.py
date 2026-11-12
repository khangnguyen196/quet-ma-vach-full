"""Chung cho test máy chủ: thêm server/ vào sys.path, engine giả, tạo ảnh trong RAM."""
from __future__ import annotations

import io
import os
import random
import sys
import threading
from dataclasses import replace
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parent.parent
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from PIL import Image  # noqa: E402

from settings import Settings  # noqa: E402

ORIGIN = "https://khangnguyen196.github.io"
FAKE_TEXT = "CHU-OCR-GIA-bi-mat-123"


class FakeEngine:
    """Engine giả: trả 1 khung chữ cố định theo cỡ ảnh; block (threading.Event) để thử hàng đợi."""

    info = {"name": "fake"}

    def __init__(self, block: threading.Event | None = None):
        self.loaded = True
        self.block = block
        self.calls = 0
        self.started = threading.Semaphore(0)

    def run(self, img):
        self.calls += 1
        self.started.release()
        if self.block is not None:
            self.block.wait(30)
        w, h = img.size
        poly = [[1.0, 2.0], [w - 1.0, 2.0], [w - 1.0, 12.0], [1.0, 12.0]]
        return [{"text": FAKE_TEXT, "poly": poly, "score": 0.9, "box": {"minX": 1.0, "minY": 2.0, "maxX": w - 1.0, "maxY": 12.0}, "conf": 0.9}]


def make_settings(**kw) -> Settings:
    return replace(Settings(), **kw)


@pytest.fixture
def make_app():
    import app as app_module

    def _make(engine=None, **kw):
        return app_module.create_app(make_settings(**kw), engine=engine if engine is not None else FakeEngine())

    return _make


def jpeg_bytes(w=64, h=48, color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def png_bytes(w=64, h=48, color=(30, 200, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


def noise_png(target_bytes: int) -> bytes:
    """PNG nhiễu (nén không được) cỡ ~target_bytes."""
    side = int((target_bytes / 3) ** 0.5) + 1
    rnd = random.Random(1234)
    img = Image.frombytes("RGB", (side, side), rnd.randbytes(side * side * 3))
    buf = io.BytesIO()
    img.save(buf, "PNG", compress_level=0)
    return buf.getvalue()


def multipart(fields, boundary="----bienranhgioi7MA4YWxk") -> tuple[bytes, str]:
    """fields: [(tên, tên file hoặc None, bytes)] -> (thân, Content-Type)."""
    out = io.BytesIO()
    for name, filename, data in fields:
        out.write(f"--{boundary}\r\n".encode())
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename is not None:
            disp += f'; filename="{filename}"'
        out.write(disp.encode() + b"\r\n")
        if filename is not None:
            out.write(b"Content-Type: application/octet-stream\r\n")
        out.write(b"\r\n" + data + b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


@pytest.fixture(autouse=True)
def _no_env_leak(monkeypatch):
    # test không phụ thuộc biến môi trường của máy
    for k in ("AUTH_MODE", "CORS_ALLOW_LOCALHOST", "TRUST_PROXY", "OCR_OFFLINE", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY",
              "RATE_LIMIT_USER_PER_MIN", "RATE_LIMIT_MAX_USERS"):
        monkeypatch.delenv(k, raising=False)
    yield


os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
