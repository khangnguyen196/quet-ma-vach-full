"""Giới hạn lượt theo IP / người dùng (cửa sổ trượt 60 giây, trong RAM), giới hạn lượt mỗi người mỗi ngày UTC
(DailyLimiter, trong RAM) + cổng đồng thời (1 ảnh chạy, hàng đợi có trần, giành chỗ
trước khi đọc thân ảnh).

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


DAY_SECONDS = 86400


class DailyLimiter:
    """Số lượt mỗi người dùng trong NGÀY UTC hiện tại (đổi ngày lúc 00:00 UTC), trong RAM.

    per_day = 0 -> tắt (luôn cho qua, không giữ gì). Giữ tối đa max_users người: đầy thì bỏ người của ngày cũ trước,
    vẫn đầy thì bỏ người ít dùng gần nhất. clock = giờ thật dạng epoch giây (time.time; test thay bằng đồng hồ giả).
    Mất hết khi máy chủ khởi động lại / ngủ (scale về 0); chỉ đúng khi 1 bản chạy. Lớp chống dùng chùa, không phải sổ cái.
    """

    def __init__(self, per_day: int, max_users: int = 10_000, clock=time.time):
        self.per_day = per_day
        self.max_users = max_users
        self.clock = clock
        self._users: OrderedDict[str, list] = OrderedDict()  # user id -> [ngày UTC (số ngày từ 1970), số lượt]

    def __len__(self):
        return len(self._users)

    def check(self, user_id: str):
        """(cho qua?, số giây tới 00:00 UTC nếu bị chặn). Cho qua thì ghi lượt luôn."""
        if self.per_day <= 0:
            return True, 0
        now = self.clock()
        day = int(now // DAY_SECONDS)
        entry = self._users.get(user_id)
        if entry is None:
            if len(self._users) >= self.max_users:
                for uid in [u for u, (d, _) in self._users.items() if d != day]:
                    del self._users[uid]
                while len(self._users) >= self.max_users:
                    self._users.popitem(last=False)
            entry = self._users[user_id] = [day, 0]
        self._users.move_to_end(user_id)
        if entry[0] != day:
            entry[0], entry[1] = day, 0
        if entry[1] >= self.per_day:
            retry = max(1, math.ceil((day + 1) * DAY_SECONDS - now))
            return False, retry
        entry[1] += 1
        return True, 0


class QueueFull(Exception):
    pass


class ConcurrencyGate:
    """Tối đa max_concurrent việc chạy OCR cùng lúc, tổng số yêu cầu đang giữ chỗ (đang tải ảnh lên + đang chờ + đang
    chạy) tối đa capacity = max_concurrent + queue_max; đầy -> QueueFull (503).

    Hai bước, để RAM có trần: reserve() giành chỗ NGAY (chưa đọc thân ảnh; đầy thì 503 luôn), rồi mới đọc ảnh, rồi
    `await slot.acquire()` chờ khóa OCR. Mọi đường ra gọi slot.release() trong finally (gọi nhiều lần cũng chỉ trả 1 lần).

    Ghi chú cho người sau: OCR chạy bằng run_in_threadpool, KHÔNG huỷ được giữa chừng (luồng chạy tới khi xong dù khách
    đã ngắt). Khóa OCR chỉ nhả khi OCR xong thật, nên không bao giờ có 2 ảnh OCR cùng lúc. Đừng "sửa" thành huỷ luồng /
    nhả khóa sớm khi yêu cầu bị huỷ: OCR cũ vẫn đang chạy trong luồng, nhả sớm là 2 ảnh chạy song song, vượt RAM.
    Huỷ lúc đang CHỜ khóa (chưa giành được) thì acquire() ném CancelledError, release() chỉ trả chỗ.
    """

    def __init__(self, max_concurrent: int = 1, queue_max: int = 4):
        self.capacity = max_concurrent + queue_max
        self._sem = asyncio.Semaphore(max_concurrent)
        self.inside = 0  # số chỗ đang giữ: đang tải lên + đang chờ khóa + đang chạy

    def reserve(self) -> "Slot":
        """Giành 1 chỗ ngay (không chờ). Đầy -> QueueFull."""
        if self.inside >= self.capacity:
            raise QueueFull()
        self.inside += 1
        return Slot(self)


class Slot:
    """1 chỗ trong ConcurrencyGate: acquire() chờ khóa OCR; release() trả khóa (nếu đã giành) + trả chỗ, đúng 1 lần."""

    def __init__(self, gate: ConcurrencyGate):
        self._gate = gate
        self._locked = False
        self._released = False

    async def acquire(self):
        await self._gate._sem.acquire()
        self._locked = True

    def release(self):
        if self._released:
            return
        self._released = True
        if self._locked:
            self._locked = False
            self._gate._sem.release()
        self._gate.inside -= 1
