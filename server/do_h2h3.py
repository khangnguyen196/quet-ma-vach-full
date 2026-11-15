"""Đo H2 (RAM đỉnh) / H3 (thời gian tìm ứng viên) / khởi động của máy chủ OCR với danh mục mức (a) (b) (c) + mốc
không danh mục (đợt kho-lon vòng 3, P3 / P4). Chỉ để đo, không thuộc app (psutil của requirements-dev.txt).

=====================================================================================================================
CÁCH ĐỌC SỐ H2 / H3 — CHỐT TRƯỚC (commit riêng "test(kho-lon): cách đo H2 / H3 chốt trước" TRƯỚC lần chạy đo đầu tiên;
không đổi cách đọc số sau khi thấy số; thấy cách đọc sai thì ghi lệch, không sửa)
=====================================================================================================================
Tiến trình đo: MỘT tiến trình máy chủ thật cho mỗi cấu hình: uvicorn app:app trên 127.0.0.1 (cùng cờ như Dockerfile:
  --workers 1 --no-access-log --no-proxy-headers --limit-concurrency 16), AUTH_MODE=off, OCR_THREADS=1, OCR_OFFLINE=1
  (model R1 thật trong venv), MAX_PIXELS=50.000.000, MAX_PIXELS_PROGRESSIVE=40.000.000 (như Dockerfile),
  RATE_LIMIT_PER_MIN=1000 (chỉ để 31 ảnh tuần tự không chạm giới hạn phút), CATALOG_PATH = THƯ MỤC chỉ mục dựng sẵn
  của mức (catalog_search.py build; nạp bằng mmap) — mốc: không đặt CATALOG_PATH.
Trong MỘT lần sống của tiến trình: bật -> chờ /health 200 (modelLoaded true; mức: catalog.loaded true và catalog.n ==
  N của meta chỉ mục) -> 30 ảnh bộ B (front.jpg GỐC của đúng 30 mã trong D:\\tmp\\tu-dong\\ocr\\bo-b-30.json, ảnh ở
  D:\\quet-ma-vach-full\\test-ocr\\photos\\<mã>\\front.jpg, gửi tuần tự theo thứ tự mã trong file) -> ảnh nặng nhất được
  nhận (JPEG nhiều lượt quét CMYK 40 MP, orientation 6 của do-anh-lon.py: D:\\tmp\\may-chu-1\\anh-lon\\
  jpeg-cmyk-prog-40mp-xoay6.jpg) -> tắt (kể cả khi lỗi). Mọi lượt /ocr phải trả 200; có lượt khác 200 thì lần đo HỎNG
  (không có số H2 / H3, không chọn mức đó).
H2 = số LỚN HƠN giữa peakWsetMB và peakPrivateMB (do_rss.PeakTracker: Windows peak_wset / peak_pagefile, gồm cả tiến
  trình con; MiB = 1024 × 1024 byte) đọc lần cuối ngay sau ảnh nặng, trước khi tắt. Ngưỡng: H2 <= 1.536 MiB.
H3 = p95 (nearest rank: phần tử thứ ceil(0,95 × 30) = 29 sau khi sắp tăng dần) của thời gian CHỈ phần tìm ứng viên
  (catalog.search, đo trong tiến trình máy chủ bằng time.perf_counter, app.py ghi vào dòng log "/ocr" dạng
  "tìm <ms>ms", 1 chữ số thập phân; không ghi chữ OCR) trên 30 ảnh bộ B (KHÔNG tính ảnh nặng). Thiếu số ở ảnh nào
  ("tìm -") thì H3 không đo được (coi như trượt). Ngưỡng: H3 <= 1,0 s (1.000 ms). Mốc không có H3.
Khởi động = giây từ lúc bật tiến trình (Popen) tới lần đầu /health trả 200 (hỏi mỗi 0,1 s), 3 lần riêng (mỗi lần 1
  tiến trình mới, bật -> 200 -> tắt), lấy TRUNG VỊ. Đo cho mốc, (a) (b) (c) nạp bằng thư mục mmap, và (a) (b) (c) nạp
  bằng .jsonl.gz (dựng trong RAM) để so. "RSS sau nạp" = RSS lấy mẫu (gồm tiến trình con) ngay khi /health 200 ở lần
  đo H2.
Chỉ là số Windows (máy dự án, Windows 10, 8 GB); số Linux trên CI (memory.peak của workflow) chỉ để tham khảo.
Áp luật chọn mức: gọi ĐÚNG pickLevel của test-ocr/chup-mat-do/kho-lon-do.mjs (node) với cách đã chọn + H4 của từng
  mức từ D:\\tmp\\kho-lon\\ket-qua\\v2-do-abc.json và h2 / h3 = qua / trượt đo ở đây (lệnh "chon").
=====================================================================================================================

    python do_h2h3.py do --cau-hinh moc|a|b|c [--out D:\\tmp\\kho-lon\\v3] [--ghi-de]      (H2 + H3 + RSS sau nạp)
    python do_h2h3.py khoi-dong --cau-hinh moc|a|b|c|a-gz|b-gz|c-gz [--lan 3] [--ghi-de]
    python do_h2h3.py chon [--out D:\\tmp\\kho-lon\\v3]                                   (bảng + pickLevel)
File ra (không ghi đè nếu đã có, trừ khi --ghi-de): <out>\\h2h3-<cấu hình>.json, khoi-dong-<cấu hình>.json, chon.json;
log máy chủ cạnh đó (.server.log). Mỗi file ghi mã commit + dirty + giờ chạy.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import re
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
CHI_MUC = Path(r"D:\tmp\kho-lon\chi-muc")
DANH_MUC = Path(r"D:\tmp\kho-lon\danh-muc")
OUT = Path(r"D:\tmp\kho-lon\v3")
BO_B = Path(r"D:\tmp\tu-dong\ocr\bo-b-30.json")
PHOTOS = Path(r"D:\quet-ma-vach-full\test-ocr\photos")
HEAVY = Path(r"D:\tmp\may-chu-1\anh-lon\jpeg-cmyk-prog-40mp-xoay6.jpg")
V2 = Path(r"D:\tmp\kho-lon\ket-qua\v2-do-abc.json")
CACHE = r"D:\tmp\kho-lon\cache"
RAM_MAX_MIB = 1536
SEARCH_P95_MAX_MS = 1000.0
LEVELS = ("a", "b", "c")
CONFIGS = ("moc",) + LEVELS + tuple(f"{L}-gz" for L in LEVELS)
LOG_OCR = re.compile(r"POST /ocr (\d{3}) \d+B \d+ khung tìm (-|[\d.]+ms) [\d.]+s")


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def p95(xs):
    """Nearest rank, như quantile của kho-lon-do.mjs."""
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, math.ceil(0.95 * len(s)) - 1))] if s else None


def h2_of(res: dict):
    vals = [v for v in (res.get("peakWsetMB"), res.get("peakPrivateMB")) if v is not None]
    return max(vals) if vals else None


def parse_ocr_log(text: str) -> list[tuple[int, float | None]]:
    """Các dòng log POST /ocr theo thứ tự -> [(mã HTTP, ms tìm | None)]."""
    out = []
    for m in LOG_OCR.finditer(text):
        ms = None if m.group(2) == "-" else float(m.group(2)[:-2])
        out.append((int(m.group(1)), ms))
    return out


def catalog_env(cfg: str) -> str | None:
    if cfg == "moc":
        return None
    if cfg.endswith("-gz"):
        return str(DANH_MUC / f"{cfg[0]}.jsonl.gz")
    return str(CHI_MUC / cfg)


def expected_n(cfg: str):
    if cfg == "moc":
        return None
    meta = json.loads((CHI_MUC / cfg[0] / "meta.json").read_text(encoding="utf-8"))
    return meta["N"]


def git_info():
    try:
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True,
                               check=True).stdout.strip() != ""
        return sha, dirty
    except (OSError, subprocess.CalledProcessError):
        return None, None


def server_env(cfg: str) -> dict:
    env = dict(os.environ, TEMP=CACHE, TMP=CACHE, PIP_CACHE_DIR=CACHE, HF_HOME=r"D:\tmp\may-chu-1\hf",
               MODELSCOPE_CACHE=r"D:\tmp\may-chu-1\ms", PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1", OCR_THREADS="1",
               OCR_OFFLINE="1", AUTH_MODE="off", RATE_LIMIT_PER_MIN="1000", MAX_PIXELS="50000000",
               MAX_PIXELS_PROGRESSIVE="40000000")
    env.pop("CATALOG_PATH", None)
    cp = catalog_env(cfg)
    if cp:
        env["CATALOG_PATH"] = cp
    return env


def start_server(cfg: str, log_file):
    cmd = [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(PORT), "--workers", "1",
           "--no-access-log", "--no-proxy-headers", "--limit-concurrency", "16"]
    return subprocess.Popen(cmd, cwd=HERE, env=server_env(cfg), stdout=log_file, stderr=subprocess.STDOUT,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def wait_health(server, t0: float, timeout: float = 180.0) -> dict:
    """Hỏi /health mỗi 0,1 s tới khi 200; trả {seconds, body}."""
    while True:
        if server.poll() is not None:
            raise RuntimeError(f"máy chủ tắt khi khởi động (mã {server.returncode})")
        if time.perf_counter() - t0 > timeout:
            raise RuntimeError(f"máy chủ không lên sau {timeout:.0f} giây")
        try:
            with urllib.request.urlopen(f"{BASE}/health", timeout=1) as r:
                if r.status == 200:
                    return {"seconds": time.perf_counter() - t0, "body": json.loads(r.read())}
        except OSError:
            pass
        time.sleep(0.1)


def stop(server, big):
    big.stop_tree(server)
    for _ in range(100):
        if not big.port_listening(PORT):
            break
        time.sleep(0.1)
    return {"stopped": server.poll() is not None, "portStillListening": big.port_listening(PORT)}


def check_health(cfg: str, body: dict):
    if not body.get("modelLoaded"):
        raise RuntimeError("/health: model chưa nạp")
    n = expected_n(cfg)
    cat = body.get("catalog") or {}
    if n is None:
        if cat.get("loaded"):
            raise RuntimeError("mốc mà catalog.loaded true")
    elif not (cat.get("loaded") is True and cat.get("n") == n):
        raise RuntimeError(f"/health catalog {cat} khác mong đợi (loaded true, n {n})")


def photos_b() -> list[Path]:
    codes = list(json.loads(BO_B.read_text(encoding="utf-8"))["items"])
    files = [PHOTOS / c / "front.jpg" for c in codes]
    missing = [str(f) for f in files if not f.is_file()]
    if len(files) != 30 or missing:
        raise SystemExit(f"cần đúng 30 ảnh bộ B, thiếu: {missing}")
    return files


def guard_out(path: Path, overwrite: bool):
    if path.exists() and not overwrite:
        raise SystemExit(f"Đã có {path}: thêm --ghi-de nếu thật sự muốn đo lại (không ghi đè số cũ).")


def cmd_do(a):
    cfg = a.cau_hinh
    if cfg.endswith("-gz"):
        raise SystemExit("đo H2 / H3 chỉ cho mốc và thư mục chỉ mục (a / b / c)")
    big = _load("do_anh_lon", "do-anh-lon.py")
    rss = _load("do_rss_mod", "do_rss.py")
    out_file = Path(a.out) / f"h2h3-{cfg}.json"
    guard_out(out_file, a.ghi_de)
    if big.port_listening(PORT):
        raise SystemExit(f"Cổng {PORT} đang có máy chủ khác: tắt nó trước khi đo.")
    files = photos_b()
    if not HEAVY.is_file():
        raise SystemExit(f"thiếu ảnh nặng {HEAVY}: chạy do-anh-lon.py tao")
    sha, dirty = git_info()
    out = {"cauHinh": cfg, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "commit": sha, "dirty": dirty,
           "catalogPath": catalog_env(cfg), "ocrThreads": 1, "photos": len(files), "heavy": HEAVY.name}
    log_path = out_file.with_suffix(".server.log")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    stop_ev = threading.Event()
    with open(log_path, "wb") as log_file:
        t0 = time.perf_counter()
        server = start_server(cfg, log_file)
        sampler = None
        try:
            tracker = rss.PeakTracker(server.pid)

            def loop():
                while not stop_ev.is_set():
                    try:
                        tracker.sample()
                    except Exception:  # noqa: BLE001 - tiến trình đã tắt
                        return
                    stop_ev.wait(0.05)

            sampler = threading.Thread(target=loop, daemon=True)
            sampler.start()
            h = wait_health(server, t0)
            tracker.sample()
            check_health(cfg, h["body"])
            out["khoiDongGiay"] = round(h["seconds"], 2)
            out["health"] = h["body"]
            out["sauNap"] = {k: v for k, v in tracker.result(0.05).items() if k != "pid"}
            statuses = []
            for f in files:
                st, j, secs = big.post_image(BASE, f, 300)
                statuses.append(st)
            tracker.sample()
            out["sau30"] = {k: v for k, v in tracker.result(0.05).items() if k != "pid"}
            st, j, secs = big.post_image(BASE, HEAVY, 600)
            statuses.append(st)
            tracker.sample()
            res = tracker.result(0.05)
            out["sauAnhNang"] = {k: v for k, v in res.items() if k != "pid"}
            out["anhNang"] = {"status": st, "seconds": round(secs, 2), "serverMs": j.get("ms"),
                              "size": [j.get("width"), j.get("height"), j.get("origWidth"), j.get("origHeight")]}
            out["statuses"] = statuses
        finally:
            stop_ev.set()
            out["tat"] = stop(server, big)
            if sampler is not None:
                sampler.join(2)
    log = log_path.read_text(encoding="utf-8", errors="replace")
    rows = parse_ocr_log(log)
    out["logOcr"] = len(rows)
    ok_all = len(out.get("statuses", [])) == 31 and all(s == 200 for s in out["statuses"]) and len(rows) == 31
    search = [ms for _, ms in rows[:30]]
    out["timMs30"] = search
    out["h2MiB"] = h2_of(out.get("sauAnhNang", {})) if ok_all else None
    out["h2Qua"] = None if out["h2MiB"] is None else out["h2MiB"] <= RAM_MAX_MIB
    if cfg == "moc":
        out["h3P95Ms"], out["h3Qua"] = None, None
    elif ok_all and all(ms is not None for ms in search):
        out["h3P95Ms"] = p95(search)
        out["h3Qua"] = out["h3P95Ms"] <= SEARCH_P95_MAX_MS
        out["timMsMax"] = max(search)
    else:
        out["h3P95Ms"], out["h3Qua"] = None, False
    out["hong"] = not ok_all
    out_file.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{cfg}] H2 {out['h2MiB']} MiB ({'qua' if out['h2Qua'] else 'TRƯỢT'}), H3 p95 {out['h3P95Ms']} ms, "
          f"khởi động {out.get('khoiDongGiay')} s, RSS sau nạp {out.get('sauNap', {}).get('lastMB')} MB, "
          f"HTTP {out.get('statuses')}, tắt {out['tat']}; ghi {out_file}", flush=True)
    return 0 if ok_all else 1


def cmd_khoi_dong(a):
    cfg = a.cau_hinh
    big = _load("do_anh_lon", "do-anh-lon.py")
    out_file = Path(a.out) / f"khoi-dong-{cfg}.json"
    guard_out(out_file, a.ghi_de)
    if big.port_listening(PORT):
        raise SystemExit(f"Cổng {PORT} đang có máy chủ khác: tắt nó trước khi đo.")
    sha, dirty = git_info()
    runs = []
    out_file.parent.mkdir(parents=True, exist_ok=True)
    for k in range(a.lan):
        log_path = out_file.with_name(f"khoi-dong-{cfg}-{k + 1}.server.log")
        with open(log_path, "wb") as log_file:
            t0 = time.perf_counter()
            server = start_server(cfg, log_file)
            try:
                h = wait_health(server, t0)
                check_health(cfg if not cfg.endswith("-gz") else cfg[0], h["body"])
                runs.append(round(h["seconds"], 2))
            finally:
                tat = stop(server, big)
        print(f"[{cfg}] lần {k + 1}: /health 200 sau {runs[-1]} s; tắt {tat}", flush=True)
    out = {"cauHinh": cfg, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "commit": sha, "dirty": dirty,
           "catalogPath": catalog_env(cfg), "lan": runs, "trungViGiay": statistics.median(runs)}
    out_file.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{cfg}] trung vị {out['trungViGiay']} s; ghi {out_file}", flush=True)
    return 0


def dir_bytes(p: Path) -> int:
    return sum(f.stat().st_size for f in p.iterdir() if f.is_file())


def cmd_chon(a):
    od = Path(a.out)
    out_file = od / "chon.json"
    guard_out(out_file, a.ghi_de)
    v2 = json.loads(V2.read_text(encoding="utf-8"))
    rows = {}
    for cfg in ("moc",) + LEVELS:
        m = json.loads((od / f"h2h3-{cfg}.json").read_text(encoding="utf-8"))
        kd = json.loads((od / f"khoi-dong-{cfg}.json").read_text(encoding="utf-8"))
        r = {"h2MiB": m["h2MiB"], "h2Qua": m["h2Qua"], "h3P95Ms": m["h3P95Ms"], "h3Qua": m["h3Qua"],
             "rssSauNapMB": m["sauNap"]["lastMB"], "khoiDongThuMucGiay": kd["trungViGiay"], "hong": m["hong"]}
        if cfg != "moc":
            gz = json.loads((od / f"khoi-dong-{cfg}-gz.json").read_text(encoding="utf-8"))
            r["khoiDongGzGiay"] = gz["trungViGiay"]
            r["chiMucBytes"] = dir_bytes(CHI_MUC / cfg)
            r["cach"] = v2["levels"][cfg]["chosen"]
            r["h4Qua"] = v2["levels"][cfg]["h4"]["pass"]
        rows[cfg] = r
    levels = [{"name": L, "method": rows[L]["cach"], "h4": rows[L]["h4Qua"], "h2": rows[L]["h2Qua"] is True,
               "h3": rows[L]["h3Qua"] is True} for L in LEVELS]
    # argv[1] = mức (JSON), argv[2] = đường dẫn module: argv[1] KHÔNG được là kho-lon-do.mjs (khối main của nó sẽ chạy)
    js = ("import { pathToFileURL } from 'node:url';"
          "const m = await import(pathToFileURL(process.argv[2]).href);"
          "console.log(JSON.stringify(m.pickLevel(JSON.parse(process.argv[1]))));")
    p = subprocess.run(["node", "--input-type=module", "-e", js, "--", json.dumps(levels),
                        str(ROOT / "test-ocr" / "chup-mat-do" / "kho-lon-do.mjs")],
                       capture_output=True, text=True, encoding="utf-8", check=True, cwd=ROOT)
    pick = json.loads(p.stdout.strip().splitlines()[-1])
    sha, dirty = git_info()
    out = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "commit": sha, "dirty": dirty, "rows": rows,
           "pickLevelInput": levels, "pick": pick,
           "ketLuan": f"mức ({pick['level']}) + cách {rows[pick['level']]['cach']}" if pick.get("level") else
           ("DỪNG HỎI CHỦ DỰ ÁN" if pick.get("stop") else "không mức nào qua")}
    out_file.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for cfg, r in rows.items():
        print(cfg, json.dumps(r, ensure_ascii=False))
    print("pickLevel:", json.dumps(pick), "->", out["ketLuan"])
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("do")
    d.add_argument("--cau-hinh", required=True, choices=("moc",) + LEVELS)
    k = sub.add_parser("khoi-dong")
    k.add_argument("--cau-hinh", required=True, choices=CONFIGS)
    k.add_argument("--lan", type=int, default=3)
    c = sub.add_parser("chon")
    for p in (d, k, c):
        p.add_argument("--out", default=str(OUT))
        p.add_argument("--ghi-de", action="store_true")
    a = ap.parse_args(argv)
    return {"do": cmd_do, "khoi-dong": cmd_khoi_dong, "chon": cmd_chon}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
