"""Đo RAM đỉnh của tiến trình máy chủ OCR lúc đo. Chỉ để đo (psutil ở requirements-dev.txt, không vào app).

    python do_rss.py --pid <PID> --out <file.json> [--interval 0.2]

Lấy mẫu mỗi --interval giây cho tới khi tiến trình kết thúc, rồi ghi vào --out:
- peakMB / lastMB: RSS (Windows: working set) lấy mẫu, cộng các tiến trình con nếu có. Lấy mẫu nên CÓ THỂ HỤT đỉnh.
- peakWsetMB: Windows, memory_info().peak_wset = đỉnh working set THẬT do hệ điều hành ghi (không hụt vì lấy mẫu),
  cộng tiến trình con; đọc lại ở mỗi mẫu, giữ số lớn nhất đọc được trước khi tiến trình tắt. Không phải Windows -> null.
- peakPrivateMB: Windows, memory_info().peak_pagefile = đỉnh bộ nhớ riêng đã cấp (không bị hụt khi Windows thiếu RAM
  đẩy bớt trang ra khỏi working set), cộng tiến trình con. Không phải Windows -> null.
- vmHwmMB: Linux, VmHWM trong /proc/<pid>/status (đỉnh RSS thật do nhân ghi), cộng tiến trình con. Không có -> null.
Không đọc stdin, không mở cổng mạng.
"""
from __future__ import annotations

import argparse
import json
import time

import psutil

MB = 1024 * 1024


def rss_of(proc: psutil.Process) -> int:
    total = proc.memory_info().rss
    for child in proc.children(recursive=True):
        try:
            total += child.memory_info().rss
        except psutil.Error:
            pass
    return total


def peak_wset(proc: psutil.Process):
    """Đỉnh working set thật (byte) trên Windows, cộng các tiến trình con; nơi khác None.

    Cộng con vì python.exe của venv trên Windows chỉ là tiến trình mồi (~3 MB) chạy python thật làm tiến trình con.
    Tổng các đỉnh ≥ đỉnh của tổng; phần mồi gần như không đổi nên sai lệch chỉ vài MB."""
    total = getattr(proc.memory_info(), "peak_wset", None)
    if total is None:
        return None
    for child in proc.children(recursive=True):
        try:
            total += getattr(child.memory_info(), "peak_wset", 0)
        except psutil.Error:
            pass
    return total


def peak_private(proc: psutil.Process):
    """Windows: đỉnh bộ nhớ riêng đã cấp (PeakPagefileUsage = memory_info().peak_pagefile), cộng tiến trình con.

    Khác peak_wset: Windows thiếu RAM sẽ đẩy bớt trang ra (working set bị cắt), nên peak_wset có thể THẤP hơn bộ nhớ
    thật cần; peak_pagefile tính mọi trang riêng đã cấp dù đang ở RAM hay bị đẩy ra -> chặn trên an toàn hơn."""
    total = getattr(proc.memory_info(), "peak_pagefile", None)
    if total is None:
        return None
    for child in proc.children(recursive=True):
        try:
            total += getattr(child.memory_info(), "peak_pagefile", 0)
        except psutil.Error:
            pass
    return total


def _vm_hwm_one(pid: int):
    try:
        with open(f"/proc/{pid}/status", encoding="ascii", errors="replace") as f:
            for line in f:
                if line.startswith("VmHWM:"):
                    return int(line.split()[1]) * 1024  # kB
    except OSError:
        return None
    return None


def vm_hwm(proc: psutil.Process):
    """VmHWM (byte) từ /proc/<pid>/status trên Linux, cộng tiến trình con; không có -> None."""
    total = _vm_hwm_one(proc.pid)
    if total is None:
        return None
    for child in proc.children(recursive=True):
        total += _vm_hwm_one(child.pid) or 0
    return total


class PeakTracker:
    """Gom số đo của 1 tiến trình: RSS lấy mẫu + đỉnh thật (peak_wset / VmHWM) đọc mỗi lần sample()."""

    def __init__(self, pid: int):
        self.pid = pid
        self.proc = psutil.Process(pid)
        self.peak = self.last = 0
        self.samples = 0
        self.wset = None
        self.private = None
        self.hwm = None

    def sample(self):
        self.last = rss_of(self.proc)
        self.peak = max(self.peak, self.last)
        self.samples += 1
        w = peak_wset(self.proc)
        if w is not None:
            self.wset = max(self.wset or 0, w)
        p = peak_private(self.proc)
        if p is not None:
            self.private = max(self.private or 0, p)
        h = vm_hwm(self.proc)
        if h is not None:
            self.hwm = max(self.hwm or 0, h)

    def result(self, interval: float) -> dict:
        mb = lambda x: None if x is None else round(x / MB, 1)  # noqa: E731
        return {"pid": self.pid, "peakMB": mb(self.peak), "lastMB": mb(self.last), "peakWsetMB": mb(self.wset),
                "peakPrivateMB": mb(self.private), "vmHwmMB": mb(self.hwm), "samples": self.samples, "interval": interval}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pid", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--interval", type=float, default=0.2)
    a = ap.parse_args()
    tracker = None
    try:
        tracker = PeakTracker(a.pid)
        while tracker.proc.is_running() and tracker.proc.status() != psutil.STATUS_ZOMBIE:
            tracker.sample()
            time.sleep(a.interval)
    except psutil.Error:
        pass  # tiến trình đã tắt
    out = tracker.result(a.interval) if tracker else {"pid": a.pid, "peakMB": 0, "lastMB": 0, "peakWsetMB": None,
                                                      "peakPrivateMB": None, "vmHwmMB": None, "samples": 0,
                                                      "interval": a.interval}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
