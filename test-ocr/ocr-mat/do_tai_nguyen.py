"""Đợt ocr-mat (P1.3): đo tài nguyên một lần chạy OCR bằng Python trên máy (CPU).

Chạy một lệnh OCR (lệnh đó tự ghi <mã>__front.json vào --ocr-dir), trong lúc chạy lấy mẫu RSS (bộ nhớ thật đang
dùng) của tiến trình + MỌI tiến trình con mỗi --interval giây (mặc định 0,25, tối đa 0,5). Xong thì:
  - giây/ảnh: trung vị + lớn nhất, KHÔNG tính ảnh đầu (ảnh đầu thường chậm vì khởi động); ảnh đầu ghi riêng;
    thời gian nạp model (trường loadSeconds trong file OCR, nếu có) ghi riêng;
  - RSS đỉnh của cả cây tiến trình (tổng) và của 1 tiến trình lớn nhất;
  - dung lượng model trên đĩa (--model, nhiều lần được; thư mục thì cộng mọi file).

    D:\\tmp\\ocr-mat\\venv\\Scripts\\python do_tai_nguyen.py --name easyocr --ocr-dir D:\\tmp\\ocr-mat\\ocr\\easyocr \\
        --model D:\\cache\\easyocr -- <lệnh OCR ...>

--ocr-dir phải là thư mục MỚI: đã có *__front.json thì báo lỗi, thoát mã 2, không chạy lệnh OCR; khi đọc kết quả
chỉ nhận file sửa sau lúc bắt đầu. Thoát giữa chừng (Ctrl+C, lỗi) thì kill cả cây tiến trình con.
Vòng 3 chặn thêm (đều thoát mã 2, KHÔNG chạy lệnh OCR):
  - <--out>/<--name>-tai-nguyen.json đã có (tránh lần sau ghi đè lần trước); cố ý ghi đè thì thêm --ghi-de;
  - lệnh con có "--out <x>" (hoặc "--out=<x>") mà x khác --ocr-dir sau khi chuẩn hóa đường dẫn.
Chạy xong mà không có ảnh nào (images == 0): vẫn ghi file tài nguyên để xem, in lỗi, thoát mã 3.
Dừng theo luật (bộ nhớ / thời gian / 3 ảnh đầu): thoát mã 4, kể cả khi 0 ảnh (vòng 4: in cả 2 ý, mã 4 thắng mã 3).

Ra: <--out>/<tên>-tai-nguyen.json. Thứ tự ảnh: trường "order" trong file OCR nếu có, không thì giờ sửa file.
Chỉ để đo, không thuộc app. Cần psutil (requirements.txt cùng thư mục, cài trong venv riêng ở ổ D).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

MAX_INTERVAL = 0.5


def median(values):
    """Trung vị (giữa 2 số giữa nếu chẵn); rỗng -> None."""
    a = sorted(v for v in values if v is not None)
    if not a:
        return None
    m = len(a) // 2
    return a[m] if len(a) % 2 else (a[m - 1] + a[m]) / 2


def time_stats(rows):
    """rows: [{'seconds': float, 'status': 'ok'|...}] theo thứ tự chạy. Bỏ ảnh đầu (dù ok hay lỗi), chỉ tính ảnh ok.
    Trả {'first', 'n', 'median', 'max'}: first = giây ảnh đầu (None nếu không có)."""
    if not rows:
        return {"first": None, "n": 0, "median": None, "max": None}
    first = rows[0].get("seconds")
    rest = [r["seconds"] for r in rows[1:] if r.get("status", "ok") == "ok" and isinstance(r.get("seconds"), (int, float))]
    return {"first": first, "n": len(rest), "median": median(rest), "max": max(rest) if rest else None}


def tree_rss(rss_list):
    """Tổng RSS (byte) của một lần lấy mẫu cả cây tiến trình; bỏ giá trị None (tiến trình vừa thoát)."""
    return sum(r for r in rss_list if r)


class Peak:
    """Giữ đỉnh qua các lần lấy mẫu: tổng cả cây và 1 tiến trình lớn nhất."""

    def __init__(self):
        self.total = 0
        self.proc = 0
        self.samples = 0

    def add(self, rss_list):
        vals = [r for r in rss_list if r]
        self.samples += 1
        self.total = max(self.total, tree_rss(vals))
        self.proc = max([self.proc, *vals])


def path_size(p):
    """Dung lượng (byte) của một file, hoặc mọi file trong thư mục (đệ quy). Không có -> 0."""
    p = Path(p)
    if p.is_file():
        return p.stat().st_size
    if p.is_dir():
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    return 0


def order_rows(entries):
    """entries: [(mtime, json)] -> rows theo 'order' (nếu mọi file có) hoặc mtime."""
    if entries and all(isinstance(j.get("order"), (int, float)) for _, j in entries):
        return [j for _, j in sorted(entries, key=lambda e: e[1]["order"])]
    return [j for _, j in sorted(entries, key=lambda e: e[0])]


def sample_tree(proc):
    """RSS của tiến trình + mọi con (psutil). Tiến trình thoát giữa chừng -> bỏ."""
    import psutil

    out = []
    try:
        procs = [proc, *proc.children(recursive=True)]
    except psutil.Error:
        return out
    for p in procs:
        try:
            out.append(p.memory_info().rss)
        except psutil.Error:
            pass
    return out


def read_entries(ocr_dir, since):
    """[(mtime, json)] của mọi <mã>__front.json trong ocr_dir có giờ sửa >= since (bỏ file của lần chạy cũ)."""
    entries = []
    for f in Path(ocr_dir).glob("*__front.json"):
        try:
            mtime = f.stat().st_mtime
            if mtime < since:
                continue
            entries.append((mtime, json.loads(f.read_text(encoding="utf-8"))))
        except (OSError, ValueError):
            pass
    return entries


def first3_seconds(rows):
    """Giây của 3 ảnh đầu (theo thứ tự chạy, gồm cả ảnh đầu); chưa đủ 3 ảnh -> None."""
    if len(rows) < 3:
        return None
    return [r.get("seconds") if isinstance(r.get("seconds"), (int, float)) else 0.0 for r in rows[:3]]


def stop_reason(rss_total_bytes, elapsed, first3, max_rss_mb=0, max_wall_s=0, max_3_dau_s=0):
    """Luật dừng (0 = không dùng). Trả None hoặc {'rule': 'bo-nho'|'thoi-gian'|'3-anh-dau', 'text'}."""
    if max_rss_mb and rss_total_bytes / 2**20 > max_rss_mb:
        return {"rule": "bo-nho", "text": f"RSS tổng {rss_total_bytes / 2**20:.0f} MB > {max_rss_mb:.0f} MB (luật bộ nhớ)"}
    if max_wall_s and elapsed > max_wall_s:
        return {"rule": "thoi-gian", "text": f"chạy {elapsed:.0f} giây > {max_wall_s:.0f} giây"}
    if max_3_dau_s and first3 is not None:
        m = median(first3)
        if m is not None and m > max_3_dau_s:
            return {"rule": "3-anh-dau", "text": f"3 ảnh đầu trung vị {m:.1f} giây > {max_3_dau_s:.0f} giây"}
    return None


def _sleep(seconds):
    """Chờ giữa 2 lần lấy mẫu (tách riêng để test vá hàm này, không vá time.sleep của cả tiến trình test)."""
    time.sleep(seconds)


def norm_path(p):
    """Chuẩn hóa đường dẫn để so: tuyệt đối, bỏ '.' / '..' / dấu / cuối, không phân biệt hoa thường trên Windows."""
    return os.path.normcase(os.path.abspath(os.path.normpath(str(p))))


def child_out_dirs(cmd):
    """Mọi giá trị của '--out <x>' hoặc '--out=<x>' trong lệnh con."""
    outs = []
    for i, arg in enumerate(cmd):
        if arg == "--out" and i + 1 < len(cmd):
            outs.append(cmd[i + 1])
        elif arg.startswith("--out="):
            outs.append(arg[len("--out="):])
    return outs


def kill_tree(pid):
    """Kill tiến trình pid và mọi tiến trình con (venv Python trên Windows chạy python thật là tiến trình con)."""
    import psutil

    try:
        root = psutil.Process(pid)
        procs = [*root.children(recursive=True), root]
    except psutil.Error:
        return
    for p in procs:
        try:
            p.kill()
        except psutil.Error:
            pass
    psutil.wait_procs(procs, timeout=5)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--" not in argv:
        print("Cần lệnh OCR sau dấu --", file=sys.stderr)
        return 2
    cut = argv.index("--")
    ap = argparse.ArgumentParser(description="Đo giây/ảnh, RSS đỉnh, dung lượng model của một lần chạy OCR.")
    ap.add_argument("--name", required=True)
    ap.add_argument("--ocr-dir", required=True)
    ap.add_argument("--model", action="append", default=[])
    ap.add_argument("--interval", type=float, default=0.25)
    ap.add_argument("--out", default=r"D:\tmp\ocr-mat\ket-qua")
    ap.add_argument("--ghi-de", action="store_true", help="cho phép ghi đè <out>/<name>-tai-nguyen.json đã có")
    # Luật dừng (vòng 3): 0 = không dùng
    ap.add_argument("--max-rss-mb", type=float, default=0, help="RSS tổng cả cây > số này (MB) thì dừng (luật bộ nhớ)")
    ap.add_argument("--max-wall-s", type=float, default=0, help="chạy quá số giây này thì dừng (luật ~2 giờ / model)")
    ap.add_argument("--max-3-dau-s", type=float, default=0, help="3 ảnh đầu trung vị > số giây này thì dừng (luật 120 giây)")
    a = ap.parse_args(argv[:cut])
    cmd = argv[cut + 1:]
    interval = min(a.interval, MAX_INTERVAL)

    import psutil

    old = list(Path(a.ocr_dir).glob("*__front.json"))
    if old:
        print(f"Thư mục OCR {a.ocr_dir} đã có {len(old)} file *__front.json của lần chạy cũ: "
              "kết quả sẽ lẫn file cũ. Hãy dùng một thư mục mới (không chạy lệnh OCR).", file=sys.stderr)
        return 2

    out = Path(a.out) / f"{a.name}-tai-nguyen.json"
    if out.exists() and not a.ghi_de:
        print(f"File tài nguyên {out} đã có (của lần chạy trước): chạy tiếp sẽ ghi đè. Đổi --name, "
              "hoặc thêm --ghi-de nếu cố ý ghi đè (không chạy lệnh OCR).", file=sys.stderr)
        return 2

    lech = [x for x in child_out_dirs(cmd) if norm_path(x) != norm_path(a.ocr_dir)]
    if lech:
        print(f"Lệnh OCR ghi vào --out {lech[0]} nhưng --ocr-dir là {a.ocr_dir}: kết quả sẽ không được đọc. "
              "Hãy dùng cùng một thư mục (không chạy lệnh OCR).", file=sys.stderr)
        return 2

    t0 = time.time()
    child = subprocess.Popen(cmd)
    peak = Peak()
    stopped = None
    last_check = 0.0
    try:
        try:
            proc = psutil.Process(child.pid)
        except psutil.NoSuchProcess:
            proc = None  # lệnh con thoát quá nhanh: không lấy mẫu được, vẫn ghi kết quả
        while child.poll() is None:
            if proc is not None:
                peak.add(sample_tree(proc))
            now = time.time()
            first3 = None
            if a.max_3_dau_s and now - last_check >= 5:  # đọc file OCR mỗi ~5 giây, không mỗi mẫu
                last_check = now
                first3 = first3_seconds(order_rows(read_entries(a.ocr_dir, t0 - 2)))
            stopped = stop_reason(peak.total, now - t0, first3, a.max_rss_mb, a.max_wall_s, a.max_3_dau_s)
            if stopped:
                print(f"DỪNG theo luật: {stopped['text']}", file=sys.stderr, flush=True)
                kill_tree(child.pid)
                child.wait()
                break
            _sleep(interval)
    finally:
        if child.poll() is None:  # thoát giữa chừng (Ctrl+C, lỗi): không để lệnh OCR chạy nền
            kill_tree(child.pid)
            child.wait()
    wall = time.time() - t0

    # Lớp thứ hai: file sửa trước t0 là của lần chạy cũ (làm tròn giờ của hệ tệp: lùi 2 giây cho chắc).
    rows = order_rows(read_entries(a.ocr_dir, t0 - 2))
    loads = [r.get("loadSeconds") for r in rows if isinstance(r.get("loadSeconds"), (int, float))]
    res = {
        "name": a.name,
        "cmd": cmd,
        "exitCode": child.returncode,
        "wallSeconds": round(wall, 2),
        "images": len(rows),
        "imagesOk": sum(1 for r in rows if r.get("status", "ok") == "ok"),
        "seconds": time_stats(rows),
        "loadSeconds": loads[0] if loads else None,
        "rssPeakTotalMB": round(peak.total / 2**20, 1),
        "rssPeakProcMB": round(peak.proc / 2**20, 1),
        "rssSamples": peak.samples,
        "intervalSeconds": interval,
        "modelBytes": {m: path_size(m) for m in a.model},
        "modelMB": round(sum(path_size(m) for m in a.model) / 2**20, 1),
        "luatDung": {"maxRssMB": a.max_rss_mb or None, "maxWallSeconds": a.max_wall_s or None, "max3DauSeconds": a.max_3_dau_s or None},
        "dungTheoLuat": stopped["rule"] if stopped else None,
        "dungTheoLuatBoNho": bool(stopped and stopped["rule"] == "bo-nho"),
        "dungLyDo": stopped["text"] if stopped else None,
    }
    os.makedirs(a.out, exist_ok=True)
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    s = res["seconds"]
    print(f"{a.name}: {res['imagesOk']}/{res['images']} ảnh ok; giây/ảnh (bỏ ảnh đầu) trung vị {s['median']}, lớn nhất {s['max']}; "
          f"ảnh đầu {s['first']}; nạp model {res['loadSeconds']}; RSS đỉnh {res['rssPeakTotalMB']} MB; model {res['modelMB']} MB")
    print(f"Ghi: {out}")
    # Dừng theo luật kiểm TRƯỚC "không có ảnh nào": dừng theo luật mà 0 ảnh thì in cả 2 ý, thoát mã 4.
    if stopped:
        if not rows:
            print(f"Lỗi: không có ảnh nào trong {a.ocr_dir} (images = 0) vì lệnh OCR bị dừng trước ảnh đầu.",
                  file=sys.stderr)
        print(f"Dừng theo luật ({stopped['text']}) sau {len(rows)} ảnh.", file=sys.stderr)
        return 4
    if not rows:
        print(f"Lỗi: không có ảnh nào trong {a.ocr_dir} (images = 0; mã thoát lệnh OCR {child.returncode}). "
              "Kiểm lại lệnh OCR và --ocr-dir.", file=sys.stderr)
        return 3
    return child.returncode


if __name__ == "__main__":
    sys.exit(main())
