"""Giới hạn lượt theo IP (cửa sổ trượt 60 giây, trong RAM) + cổng đồng thời (1 ảnh chạy, hàng đợi có trần).

IP lấy từ socket. X-Forwarded-For CHỈ dùng khi TRUST_PROXY=1 (máy chủ đứng sau proxy của mình): lấy phần tử thứ
PROXY_COUNT tính từ PHẢI (proxy cuối cùng của mình ghi IP nó thấy vào cuối danh sách; phần bên trái do khách tự ghi,
không tin). Header thiếu / ngắn hơn PROXY_COUNT -> dùng IP socket.
"""
from __future__ import annotations

import asyncio
import math
import time
from collections import OrderedDict, deque

WINDOW_SECONDS = 60.0


def client_ip(request, trust_proxy: bool, proxy_count: int = 1) -> str:
    sock = request.client.host if request.client else "unknown"
    if not trust_proxy:
        return sock
    raw = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) >= proxy_count:
        return parts[-proxy_count]
    return sock


class SlidingWindowLimiter:
    """Mỗi IP giữ thời điểm các lượt trong 60 giây gần nhất. Dọn IP hết hạn; giữ tối đa max_ips IP
    (đầy mà dọn xong vẫn đầy thì bỏ IP ít dùng gần đây nhất) để RAM không phình."""

    def __init__(self, per_min: int, max_ips: int = 10_000, clock=time.monotonic):
        self.per_min = per_min
        self.max_ips = max_ips
        self.clock = clock
        self._hits: OrderedDict[str, deque] = OrderedDict()

    def __len__(self):
        return len(self._hits)

    def _purge(self, now: float):
        for ip in [ip for ip, q in self._hits.items() if not q or now - q[-1] >= WINDOW_SECONDS]:
            del self._hits[ip]

    def check(self, ip: str):
        """(cho qua?, số giây nên chờ). Cho qua thì ghi lượt luôn."""
        now = self.clock()
        q = self._hits.get(ip)
        if q is None:
            if len(self._hits) >= self.max_ips:
                self._purge(now)
                while len(self._hits) >= self.max_ips:
                    self._hits.popitem(last=False)
            q = self._hits[ip] = deque()
        self._hits.move_to_end(ip)
        while q and now - q[0] >= WINDOW_SECONDS:
            q.popleft()
        if len(q) >= self.per_min:
            retry = max(1, math.ceil(WINDOW_SECONDS - (now - q[0])))
            return False, retry
        q.append(now)
        return True, 0


class QueueFull(Exception):
    pass


class ConcurrencyGate:
    """Tối đa max_concurrent việc chạy cùng lúc, thêm tối đa queue_max việc chờ; đầy -> QueueFull (503)."""

    def __init__(self, max_concurrent: int = 1, queue_max: int = 4):
        self.capacity = max_concurrent + queue_max
        self._sem = asyncio.Semaphore(max_concurrent)
        self.inside = 0  # đang chạy + đang chờ

    async def __aenter__(self):
        if self.inside >= self.capacity:
            raise QueueFull()
        self.inside += 1
        try:
            await self._sem.acquire()
        except BaseException:
            self.inside -= 1
            raise
        return self

    async def __aexit__(self, *exc):
        self._sem.release()
        self.inside -= 1
        return False
