"""Đo RAM đỉnh của máy chủ OCR khi nhận ẢNH LỚN (ảnh tổng hợp ~50 MP, nhẹ < 5 MB). Chỉ để đo, không thuộc app.
Chỉ dùng thư viện đã có trong venv (Pillow, psutil của requirements-dev.txt).

    # 1) tạo 4 ảnh (không commit; mặc định D:\\tmp\\may-chu-1\\anh-lon)
    python do-anh-lon.py tao [--dir D:\\tmp\\may-chu-1\\anh-lon]
    # 2) đo 1 ảnh, 1 số luồng mỗi lệnh (--repeat lần, mỗi lần 1 máy chủ mới; mặc định 2, ghi số lớn nhất)
    python do-anh-lon.py do --image jpeg-rgb --threads 8 --out D:\\tmp\\may-chu-1\\ket-qua\\anh-lon\\moi-t8-jpeg-rgb.json
        [--code-dir <thư mục server cần đo, mặc định thư mục chứa file này>] [--port 8765] [--warm <ảnh khởi động>]

Mỗi lần "do": bật uvicorn trên 127.0.0.1 (cùng cờ như chay-thu.ps1), chờ /health, gửi 1 ảnh khởi động (ảnh thật
front.jpg, để bộ nhớ của onnxruntime đã nở như lúc chạy thật), rồi gửi ĐÚNG 1 ảnh lớn, rồi TẮT máy chủ (kể cả khi lỗi)
và kiểm cổng đã đóng. RAM: RSS lấy mẫu mỗi 0,05 giây + peak_wset (Windows, đỉnh working set thật) + peak_pagefile
(Windows, đỉnh bộ nhớ riêng đã cấp, không hụt khi Windows thiếu RAM cắt working set) / VmHWM (Linux), ghi riêng sau
ảnh khởi động và sau ảnh lớn (xem do_rss.py).
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
D = r"D:\tmp\may-chu-1"
DEFAULT_DIR = Path(D) / "anh-lon"
DEFAULT_WARM = Path(r"D:\quet-ma-vach-full\test-ocr\photos\8934572260543\front.jpg")
W, H = 8000, 6250  # 50.000.000 điểm (ảnh 48 MP của điện thoại ~8064 × 6048 = 48,8 MP)
IMAGES = {
    "jpeg-rgb": "jpeg-rgb-50mp.jpg",          # (i) JPEG RGB, không tag xoay
    "jpeg-rgb-xoay6": "jpeg-rgb-50mp-xoay6.jpg",  # (ii) JPEG RGB, orientation 6
    "jpeg-cmyk-xoay6": "jpeg-cmyk-50mp-xoay6.jpg",  # (iii) JPEG CMYK, orientation 6
    "png-rgb": "png-rgb-50mp.png",            # (iv) PNG RGB
}
MAX_FILE = 5 * 1024 * 1024


def gradient_rgb():
    from PIL import Image

    g = Image.linear_gradient("L")  # 256 × 256, đen -> trắng theo chiều dọc
    r = g.resize((W, H))
    gg = g.rotate(90).resize((W, H))
    b = Image.new("L", (W, H), 90)
    return Image.merge("RGB", (r, gg, b))


def make_images(out_dir: Path):
    from PIL import Image

    out_dir.mkdir(parents=True, exist_ok=True)
    exif6 = Image.Exif()
    exif6[0x0112] = 6
    rgb = gradient_rgb()
    rgb.save(out_dir / IMAGES["jpeg-rgb"], "JPEG", quality=90)
    rgb.save(out_dir / IMAGES["jpeg-rgb-xoay6"], "JPEG", quality=90, exif=exif6.tobytes())
    rgb.convert("CMYK").save(out_dir / IMAGES["jpeg-cmyk-xoay6"], "JPEG", quality=90, exif=exif6.tobytes())
    # PNG: dải màu chỉ theo chiều ngang (mọi hàng giống nhau) để file nhỏ
    row = Image.linear_gradient("L").rotate(90).resize((W, 1))
    Image.merge("RGB", (row, row.point(lambda v: 255 - v), Image.new("L", (W, 1), 60))).resize((W, H)).save(
        out_dir / IMAGES["png-rgb"], "PNG", optimize=False)
    for key, name in IMAGES.items():
        p = out_dir / name
        with Image.open(p) as im:
            info = f"{im.format} {im.mode} {im.size[0]}×{im.size[1]} orientation={im.getexif().get(0x0112, 1)}"
        size = p.stat().st_size
        flag = "" if size < MAX_FILE else "  QUÁ 5 MB, không dùng được"
        print(f"{key}: {p} {size / 1024 / 1024:.2f} MB, {info}{flag}")


def multipart_body(data: bytes, filename: str):
    b = uuid.uuid4().hex
    head = (f"--{b}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n"
            f"Content-Type: application/octet-stream\r\n\r\n").encode()
    return head + data + f"\r\n--{b}--\r\n".encode(), f"multipart/form-data; boundary={b}"


def post_image(base: str, path: Path, timeout: float):
    body, ctype = multipart_body(path.read_bytes(), path.name)
    req = urllib.request.Request(f"{base}/ocr", data=body, headers={"Content-Type": ctype}, method="POST")
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, payload = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, payload = e.code, e.read()
    secs = time.perf_counter() - t
    try:
        j = json.loads(payload)
    except ValueError:
        j = {"raw": payload[:200].decode("utf-8", "replace")}
    return status, j, secs


def stop_tree(server: subprocess.Popen):
    """Tắt máy chủ + tiến trình con (python.exe của venv trên Windows chỉ là tiến trình mồi, python thật là con)."""
    import psutil

    try:
        procs = psutil.Process(server.pid).children(recursive=True)
    except psutil.Error:
        procs = []
    for p in procs:
        try:
            p.terminate()
        except psutil.Error:
            pass
    if server.poll() is None:
        server.terminate()
    psutil.wait_procs(procs, timeout=10)
    try:
        server.wait(10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(10)
    for p in procs:
        try:
            if p.is_running():
                p.kill()
        except psutil.Error:
            pass


def port_listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def measure(a, runs: list):
    """1 lần: bật máy chủ mới, ảnh khởi động, 1 ảnh lớn, tắt. Thêm kết quả vào runs và ghi file (kể cả khi lỗi)."""
    sys.path.insert(0, str(HERE))
    from do_rss import PeakTracker

    img = Path(a.dir) / IMAGES[a.image]
    if not img.exists():
        raise SystemExit(f"Chưa có ảnh {img}: chạy 'python do-anh-lon.py tao' trước.")
    if port_listening(a.port):
        raise SystemExit(f"Cổng {a.port} đang có máy chủ khác: tắt nó trước khi đo.")
    code_dir = Path(a.code_dir).resolve()
    env = dict(os.environ, TEMP=rf"{D}\tmp", TMP=rf"{D}\tmp", PIP_CACHE_DIR=rf"{D}\pip-cache", HF_HOME=rf"{D}\hf",
               MODELSCOPE_CACHE=rf"{D}\ms", PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1", OCR_THREADS=str(a.threads),
               OCR_OFFLINE="1", AUTH_MODE="off", RATE_LIMIT_PER_MIN="1000")
    env.pop("MAX_PIXELS", None)  # đo với MAX_PIXELS MẶC ĐỊNH của mã đang đo
    base = f"http://127.0.0.1:{a.port}"
    cmd = [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(a.port), "--workers", "1",
           "--no-access-log", "--no-proxy-headers", "--limit-concurrency", "16"]
    out = {"image": a.image, "file": str(img), "fileMB": round(img.stat().st_size / 1024 / 1024, 2), "threads": a.threads,
           "codeDir": str(code_dir), "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    log_path = Path(a.out).with_suffix(".server.log")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    stop = threading.Event()
    with open(log_path, "wb") as log_file:
        server = subprocess.Popen(cmd, cwd=code_dir, env=env, stdout=log_file, stderr=subprocess.STDOUT,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        sampler = None
        try:
            tracker = PeakTracker(server.pid)

            def loop():
                while not stop.is_set():
                    try:
                        tracker.sample()
                    except Exception:  # noqa: BLE001 - tiến trình đã tắt
                        return
                    stop.wait(a.interval)

            sampler = threading.Thread(target=loop, daemon=True)
            sampler.start()
            t0 = time.perf_counter()
            while True:
                if server.poll() is not None:
                    raise RuntimeError(f"máy chủ tắt khi đang khởi động (mã {server.returncode}), xem {log_path}")
                if time.perf_counter() - t0 > 90:
                    raise RuntimeError("máy chủ không lên sau 90 giây")
                try:
                    with urllib.request.urlopen(f"{base}/health", timeout=1) as r:
                        if json.loads(r.read()).get("modelLoaded"):
                            break
                except OSError:
                    pass
                time.sleep(0.1)
            print(f"[{a.image} t{a.threads}] máy chủ lên sau {time.perf_counter() - t0:.1f} s", flush=True)
            st, j, secs = post_image(base, Path(a.warm), a.timeout)
            tracker.sample()
            out["warm"] = {"status": st, "seconds": round(secs, 2), **{k: v for k, v in tracker.result(a.interval).items() if k != "pid"}}
            print(f"[{a.image} t{a.threads}] ảnh khởi động: HTTP {st}, {secs:.1f} s, RSS đỉnh {out['warm']['peakMB']} MB, "
                  f"peak_wset {out['warm']['peakWsetMB']} MB, riêng đỉnh {out['warm']['peakPrivateMB']} MB", flush=True)
            st, j, secs = post_image(base, img, a.timeout)
            tracker.sample()
            res = tracker.result(a.interval)
            out["big"] = {"status": st, "seconds": round(secs, 2), "error": j.get("error"),
                          "size": [j.get("width"), j.get("height"), j.get("origWidth"), j.get("origHeight")],
                          "boxes": len(j.get("items", [])) if isinstance(j.get("items"), list) else None,
                          **{k: v for k, v in res.items() if k != "pid"}}
            print(f"[{a.image} t{a.threads}] ảnh lớn: HTTP {st}, {secs:.1f} s, cỡ {out['big']['size']}, "
                  f"RSS đỉnh {res['peakMB']} MB, peak_wset {res['peakWsetMB']} MB, riêng đỉnh {res['peakPrivateMB']} MB, "
                  f"VmHWM {res['vmHwmMB']}", flush=True)
        finally:
            stop.set()
            stop_tree(server)
            if sampler is not None:
                sampler.join(2)
            for _ in range(100):  # chờ cổng đóng tối đa 10 giây
                if not port_listening(a.port):
                    break
                time.sleep(0.1)
            out["serverStopped"] = server.poll() is not None
            out["portStillListening"] = port_listening(a.port)
            print(f"[{a.image} t{a.threads}] máy chủ đã tắt: {'có' if out['serverStopped'] else 'KHÔNG'}; "
                  f"cổng {a.port} còn nghe: {'CÓ' if out['portStillListening'] else 'không'}", flush=True)
            runs.append(out)
            write_runs(a.out, runs)


def write_runs(path, runs):
    """Ghi mọi lần chạy + số lớn nhất của ảnh lớn qua các lần (Windows thiếu RAM có thể cắt working set -> lấy lớn nhất)."""
    big = [r["big"] for r in runs if "big" in r]
    mx = {k: max((b[k] for b in big if b.get(k) is not None), default=None)
          for k in ("peakMB", "peakWsetMB", "peakPrivateMB", "vmHwmMB", "seconds")}
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"runs": runs, "maxBig": mx, "statuses": [b["status"] for b in big]}, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("tao")
    t.add_argument("--dir", default=str(DEFAULT_DIR))
    d = sub.add_parser("do")
    d.add_argument("--image", required=True, choices=sorted(IMAGES))
    d.add_argument("--threads", type=int, default=8)
    d.add_argument("--out", required=True)
    d.add_argument("--dir", default=str(DEFAULT_DIR))
    d.add_argument("--code-dir", default=str(HERE))
    d.add_argument("--port", type=int, default=8765)
    d.add_argument("--warm", default=str(DEFAULT_WARM))
    d.add_argument("--interval", type=float, default=0.05)
    d.add_argument("--timeout", type=float, default=180)
    d.add_argument("--repeat", type=int, default=2, help="số lần đo lại (mỗi lần 1 máy chủ mới), ghi số lớn nhất")
    a = ap.parse_args()
    if a.cmd == "tao":
        make_images(Path(a.dir))
    else:
        runs = []
        for k in range(a.repeat):
            print(f"--- lần {k + 1}/{a.repeat}", flush=True)
            measure(a, runs)


if __name__ == "__main__":
    main()
