"""RAM có trần khi nhiều ảnh gửi cùng lúc: giành chỗ trong hàng đợi TRƯỚC khi đọc thân ảnh, đọc thân có hạn giờ (408),
khách ngắt giữa chừng không ra 500, và mọi đường ra đều trả chỗ (gate.inside về 0).

Dùng lời gọi ASGI thô (tự viết receive) để điều khiển từng khúc thân yêu cầu: biết máy chủ có đọc thân hay chưa, gửi
treo giữa chừng, ngắt giữa chừng. Mọi lời gọi bọc asyncio.wait_for để test không bao giờ treo.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading

import httpx
import pytest

from conftest import FakeEngine, jpeg_bytes, multipart

GUARD_S = 10  # trần giờ cho mỗi test bất đồng bộ
BOUNDARY = "----bienranhgioi7MA4YWxk"
CTYPE = f"multipart/form-data; boundary={BOUNDARY}"


def scope_for(headers: dict, client=("198.51.100.60", 1)):
    return {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1",
        "method": "POST", "scheme": "http", "path": "/ocr", "raw_path": b"/ocr", "query_string": b"", "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": client, "server": ("test", 80),
    }


async def asgi_post(app, receive, headers=None, client=("198.51.100.60", 1)):
    """Gọi app ASGI trực tiếp với receive tự viết -> (mã, json). Lỗi không bắt được trong app thì ném ra."""
    sent = []

    async def send(msg):
        sent.append(msg)

    await app(scope_for(headers or {"content-type": CTYPE}, client), receive, send)
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, json.loads(body)


def body_head() -> bytes:
    """Phần đầu multipart tới ngay trước dữ liệu ảnh (thân chưa trọn)."""
    whole, _ = multipart([("image", "a.jpg", b"")], boundary=BOUNDARY)
    return whole.split(b"\r\n\r\n", 1)[0] + b"\r\n\r\n" + b"\xff\xd8\xff"


async def _forever():
    await asyncio.Event().wait()


# ---------------- (a) hàng đợi đầy -> 503 mà KHÔNG đọc thân ----------------

def test_hang_doi_day_503_khong_doc_than_anh(make_app):
    block = threading.Event()
    eng = FakeEngine(block=block)
    app = make_app(engine=eng, max_concurrent=1, queue_max=4)
    body, ctype = multipart([("image", "a.jpg", jpeg_bytes())], boundary=BOUNDARY)
    read = {"called": False}

    async def receive_sixth():
        read["called"] = True  # máy chủ hỏi tới thân yêu cầu
        return {"type": "http.request", "body": body, "more_body": False}

    async def go():
        transport = httpx.ASGITransport(app=app, client=("198.51.100.61", 1))
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=GUARD_S) as c:
            first = [asyncio.create_task(c.post("/ocr", content=body, headers={"content-type": ctype})) for _ in range(5)]
            try:
                await asyncio.to_thread(eng.started.acquire, True, 5)  # ảnh đầu đang OCR (bị chặn)
                for _ in range(250):
                    if app.state.gate.inside == 5:
                        break
                    await asyncio.sleep(0.02)
                assert app.state.gate.inside == 5
                sixth = await asgi_post(app, receive_sixth, client=("198.51.100.62", 1))
            finally:
                block.set()
            rest = await asyncio.gather(*first)
        return sixth, rest

    (status, j), rest = asyncio.run(asyncio.wait_for(go(), GUARD_S))
    assert status == 503 and "hàng đợi đầy" in j["error"]
    assert read["called"] is False, "máy chủ đã đọc thân ảnh dù hàng đợi đầy"
    assert [r.status_code for r in rest] == [200] * 5
    assert app.state.gate.inside == 0


# ---------------- (b) gửi treo giữa chừng -> 408, trả chỗ ----------------

def test_gui_treo_giua_chung_408_va_tra_cho(make_app):
    app = make_app(body_timeout_s=0.3)
    msgs = iter([{"type": "http.request", "body": body_head(), "more_body": True}])

    async def receive():
        for m in msgs:
            return m
        await _forever()  # khách không gửi thêm byte nào

    status, j = asyncio.run(asyncio.wait_for(asgi_post(app, receive), GUARD_S))
    assert status == 408
    assert "quá 0,3 giây" in j["error"]
    assert app.state.gate.inside == 0


# ---------------- (c) ngắt giữa chừng -> không 500, trả chỗ ----------------

def test_khach_ngat_giua_chung_khong_500_va_tra_cho(make_app, caplog):
    caplog.set_level(logging.INFO, logger="ocr_server")
    app = make_app()
    msgs = iter([{"type": "http.request", "body": body_head(), "more_body": True}, {"type": "http.disconnect"}])

    async def receive():
        for m in msgs:
            return m
        await _forever()

    status, j = asyncio.run(asyncio.wait_for(asgi_post(app, receive), GUARD_S))
    assert status != 500 and status == 400
    assert "ngắt" in j["error"]
    assert app.state.gate.inside == 0
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "ngắt kết nối" in text
    assert not any(r.exc_info for r in caplog.records), "có traceback trong log"


# ---------------- (d) sau mỗi lỗi, chỗ đã trả ----------------

async def _apost(app, body, ctype, headers=None):
    transport = httpx.ASGITransport(app=app, client=("198.51.100.63", 1))
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=GUARD_S) as c:
        h = {"content-type": ctype}
        h.update(headers or {})
        return await c.post("/ocr", content=body, headers=h)


@pytest.mark.parametrize("case", ["400-khong-multipart", "400-thieu-image", "413-content-length", "413-than-vuot",
                                  "415-khong-phai-anh", "413-qua-diem-anh", "200"])
def test_moi_loi_deu_tra_cho(make_app, case):
    app = make_app(max_bytes=1000, max_pixels=10_000)
    if case == "400-khong-multipart":
        args, want = (jpeg_bytes(), "image/jpeg"), 400
    elif case == "400-thieu-image":
        args, want = multipart([("anh", "a.jpg", jpeg_bytes())]), 400
    elif case == "413-content-length":
        body, ctype = multipart([("image", "a.jpg", b"\xff\xd8\xff" + b"x" * 70_000)])  # > MAX_BYTES + 64 KB
        args, want = (body, ctype, {"content-length": str(len(body))}), 413
    elif case == "413-than-vuot":
        args, want = multipart([("image", "a.jpg", b"\xff\xd8\xff" + b"x" * 1001)]), 413
    elif case == "415-khong-phai-anh":
        args, want = multipart([("image", "a.jpg", "chữ, không phải ảnh".encode())]), 415
    elif case == "413-qua-diem-anh":
        args, want = multipart([("image", "a.jpg", jpeg_bytes(200, 100))]), 413
    else:
        args, want = multipart([("image", "a.jpg", jpeg_bytes(20, 10))]), 200
    r = asyncio.run(asyncio.wait_for(_apost(app, *args), GUARD_S))
    assert r.status_code == want, r.text
    assert app.state.gate.inside == 0


def test_slot_tra_dung_mot_lan():
    from ratelimit import ConcurrencyGate, QueueFull

    async def go():
        gate = ConcurrencyGate(1, 1)
        a = gate.reserve()
        b = gate.reserve()
        with pytest.raises(QueueFull):
            gate.reserve()
        await a.acquire()
        waiting = asyncio.create_task(b.acquire())
        await asyncio.sleep(0.01)
        assert not waiting.done()  # b chờ khóa
        a.release()
        a.release()  # gọi lần 2 không trả thêm
        await asyncio.wait_for(waiting, 1)
        assert gate.inside == 1
        b.release()
        assert gate.inside == 0 and gate._sem._value == 1
        # huỷ lúc đang chờ khóa: chỉ trả chỗ
        c, d = gate.reserve(), gate.reserve()
        await c.acquire()
        t = asyncio.create_task(d.acquire())
        await asyncio.sleep(0.01)
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t
        d.release()
        c.release()
        assert gate.inside == 0 and gate._sem._value == 1

    asyncio.run(asyncio.wait_for(go(), GUARD_S))
