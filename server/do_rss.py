"""Đo RAM (RSS) đỉnh của tiến trình máy chủ OCR lúc đo 30 ảnh. Chỉ để đo (psutil ở requirements-dev.txt, không vào app).

    python do_rss.py --pid <PID> --out <file.json> [--interval 0.2]

Lấy mẫu RSS của tiến trình (cộng các tiến trình con nếu có) mỗi --interval giây cho tới khi tiến trình kết thúc,
rồi ghi { peakMB, lastMB, samples, interval } vào --out. Không đọc stdin, không mở cổng mạng.
"""
from __future__ import annotations

import argparse
import json
import time

import psutil


def rss_of(proc: psutil.Process) -> int:
    total = proc.memory_info().rss
    for child in proc.children(recursive=True):
        try:
            total += child.memory_info().rss
        except psutil.Error:
            pass
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pid", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--interval", type=float, default=0.2)
    a = ap.parse_args()
    peak = last = 0
    samples = 0
    try:
        proc = psutil.Process(a.pid)
        while proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE:
            last = rss_of(proc)
            peak = max(peak, last)
            samples += 1
            time.sleep(a.interval)
    except psutil.Error:
        pass  # tiến trình đã tắt
    mb = 1024 * 1024
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"pid": a.pid, "peakMB": round(peak / mb, 1), "lastMB": round(last / mb, 1), "samples": samples, "interval": a.interval}, f)


if __name__ == "__main__":
    main()
