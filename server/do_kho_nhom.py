"""Đo thời gian /ocr thêm và RAM đỉnh khi bật kho nhóm (đợt kho-nhom vòng 4, P3). Chỉ để đo, không thuộc app, không vào
ảnh Docker (.dockerignore). Cần psutil (requirements-dev.txt), model CLIP int8 ở D:\\tmp\\lens\\model\\clip, model R1 trong venv.

Cách đo (ghi kèm số):
- MỖI cấu hình một tiến trình máy chủ thật (uvicorn trên 127.0.0.1, 1 worker, như Dockerfile), tắt ngay khi đo xong
  (kể cả khi lỗi). OCR_THREADS=1, CLIP 1 luồng ORT; --mot-nhan (mặc định bật) ghim tiến trình máy chủ vào MỘT nhân CPU
  (psutil cpu_affinity) để giống Container App 1 vCPU (máy không có Docker nên không dùng --cpus=1 được).
- Cấu hình: goc = không CLIP, không khóa (như trước đợt); tat = có CLIP nhưng không khóa (kho nhóm tắt); noi = kho nhóm
  bật, tính vector SAU OCR; song = kho nhóm bật, CLIP song song OCR (NHOM_SONG_SONG=1).
- Kho nhóm bật: AUTH_MODE=supabase với Supabase GIẢ ở trong tiến trình (JWKS = khóa EC sinh lúc đo, token ES256 tự ký;
  REST giả trả 300 dòng vector ngẫu nhiên đã ký bằng khóa HMAC thử sinh lúc đo, không in ra). Không gọi mạng ngoài.
  Vòng 6: id dòng giả là uuid in thường (str(uuid.UUID(int=i))) để phân trang theo id như Postgres; máy chủ đo nạp thử
  kho một lần trước khi phục vụ và DỪNG nếu số dòng nạp được khác N_KHO (test tests/test_do_kho_nhom.py).
- Ảnh: 30 front.jpg bộ B (như do_h2h3.py) gửi tuần tự, rồi ảnh nặng JPEG CMYK nhiều lượt quét 40 MP. Mọi lượt phải 200.
- Thời gian = giây phía khách (gửi -> nhận xong) từng ảnh; "thêm" = so trung vị / p95 của cấu hình với tat (cùng ảnh).
- RAM đỉnh = số lớn hơn giữa peak_wset và peak_pagefile (do_rss.PeakTracker, Windows, gồm tiến trình con), đọc sau
  ảnh nặng. Trần 1.536 MiB.

- Phép đo riêng `clip` (số "thêm" của kho nhóm, vì thời gian /ocr cả lượt dao động ±1 giây): MỘT tiến trình (không
  máy chủ), ghim 1 nhân (trừ --khong-mot-nhan), CLIP 1 luồng ORT; 30 ảnh bộ B giải mã sẵn như /ocr (imaging.decode),
  kho 300 vector ngẫu nhiên đã ký bằng khóa thử sinh lúc đo; mỗi ảnh đo vector CLIP + so kho + chọn ≤ 3 món (không gồm
  giải mã, không gồm nạp kho); lượt đầu làm nóng không tính. Ghi <out>\\do-clip-them.json (trung vị / p95 / max ms, thời
  gian kiểm ký + dựng kho). Lần đo vòng 4 (26/11/2026, n = 30): trung vị 205 ms, p95 221 ms, max 266 ms.

    python do_kho_nhom.py do --cau-hinh goc|tat|noi|song [--out D:\\tmp\\kho-nhom\\do] [--ghi-de] [--khong-mot-nhan]
    python do_kho_nhom.py bang [--out D:\\tmp\\kho-nhom\\do]
    python do_kho_nhom.py clip [--out D:\\tmp\\kho-nhom\\do] [--khong-mot-nhan]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import secrets
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = 8766
BASE = f"http://127.0.0.1:{PORT}"
OUT = Path(r"D:\tmp\kho-nhom\do")
CLIP_MODEL = Path(r"D:\tmp\lens\model\clip\vision_model_quantized.onnx")
CACHE = r"D:\tmp\kho-nhom\tmp"
SB_URL = "https://do-kho-nhom.invalid"
PUB = "sb_publishable_do_kho_nhom"
SUB = "0d0d0d0d-1111-4000-8000-0000000000aa"
N_KHO = 300
RAM_MAX_MIB = 1536
CFGS = ("goc", "tat", "noi", "song")


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------- Supabase giả (dùng chung cho máy chủ đo và test) ----------------

def fake_rows(key: bytes, n: int = N_KHO) -> list:
    """n dòng nhom_anh giả (vector ngẫu nhiên seed cố định, ký bằng `key`), sắp theo id tăng dần như Postgres.
    id = str(uuid.UUID(int=i)) (uuid in thường như Postgres; so chuỗi = so uuid, nên thứ tự i = thứ tự id). Vòng 6: id cũ
    f"{i:08d}" không phải uuid làm máy chủ dừng phân trang sau trang đầu (kho > 1.000 dòng chỉ nạp 1.000)."""
    sys.path.insert(0, str(HERE))
    import numpy as np

    import kho_nhom
    from clip_engine import MODEL_ID

    rng = np.random.default_rng(20261126)
    rows = []
    for i in range(n):
        v = rng.standard_normal(512)
        v = (v / np.linalg.norm(v)).astype(np.float32)
        p = f"{SUB}/{i:08x}-2222-4333-8444-555555555555.jpg"
        rows.append({"id": str(uuid.UUID(int=i)),"san_pham_id": f"sp-{i // 3}", "duong_dan": p, "vec": kho_nhom.vec_to_json(v),
                     "model": MODEL_ID, "ky": kho_nhom.sign(key, p, MODEL_ID, v),
                     "nhom_san_pham": {"ten": f"Món {i // 3}", "thuong_hieu": None, "ma_vach": None}})
    return rows


def fake_fetch(rows: list):
    """Hàm tải giả của KhoStore: phân trang như PostgREST (order=id, limit, trang sau id=gt.<id cuối>; so chuỗi id như
    Postgres so uuid in thường), trả qua JSON như phản hồi thật."""
    from urllib.parse import parse_qs, urlsplit

    def fetch(url, headers, timeout):
        q = parse_qs(urlsplit(url).query)
        after = q["id"][0][3:] if "id" in q else None
        page = [r for r in rows if after is None or r["id"] > after][:int(q["limit"][0])]
        return 200, json.loads(json.dumps(page))

    return fetch


def count_loaded(supabase_url: str, apikey: str, key: bytes, fetch, **kw) -> int:
    """Nạp kho MỘT lần bằng một KhoStore RIÊNG (không đụng cache của máy chủ đo) -> số dòng nạp được (-1 nếu lỗi)."""
    sys.path.insert(0, str(HERE))
    import kho_nhom

    kho = kho_nhom.KhoStore(supabase_url, apikey, key, fetch=fetch, **kw).get("kiem-dem")
    return -1 if kho is None else kho.n


# ---------------- phía máy chủ (tiến trình con) ----------------

def serve(a):
    """Tiến trình con: dựng app với Supabase giả trong tiến trình, chạy uvicorn trên 127.0.0.1."""
    sys.path.insert(0, str(HERE))
    import uvicorn

    import app as app_module
    import auth
    import kho_nhom
    from settings import load_settings

    jwks = json.loads(Path(a.jwks).read_text(encoding="utf-8"))
    raw = os.environ.get(kho_nhom.KEY_ENV)
    key = kho_nhom.parse_key(raw)
    rows = fake_rows(key) if key is not None else []
    fetch = fake_fetch(rows)

    s = load_settings()
    if key is not None:
        got = count_loaded(s.supabase_url, s.supabase_publishable_key, key, fetch)
        if got != N_KHO:
            raise SystemExit(f"Supabase giả: kho nạp được {got} dòng, cần đúng {N_KHO}: dừng đo")
    v = auth.SupabaseVerifier(s.supabase_url, s.supabase_publishable_key, fetch_jwks=lambda url: (200, jwks),
                              fetch_user=lambda url, k, t: (401, None))
    store = kho_nhom.KhoStore(s.supabase_url, s.supabase_publishable_key, key, fetch=fetch) if key else None
    app = app_module.create_app(s, verifier=v, nhom_key=key, nhom_store=store)
    del raw, key
    uvicorn.run(app, host="127.0.0.1", port=PORT, workers=1, access_log=False, proxy_headers=False,
                limit_concurrency=16, log_level="warning")


# ---------------- phía đo ----------------

def make_token(out: Path):
    """Khóa EC P-256 sinh lúc đo (chỉ để đo, xóa sau): ghi JWKS công khai ra file, trả token ES256 của SUB."""
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec

    priv = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(priv.public_key()))
    jwk.update({"kid": "do-1", "alg": "ES256", "use": "sig"})
    jwks_file = out / "jwks-do.json"
    jwks_file.write_text(json.dumps({"keys": [jwk]}), encoding="utf-8")
    now = int(time.time())
    tok = jwt.encode({"sub": SUB, "aud": "authenticated", "iss": SB_URL + "/auth/v1", "exp": now + 7200, "iat": now,
                      "role": "authenticated", "is_anonymous": False}, priv, algorithm="ES256", headers={"kid": "do-1"})
    return tok, jwks_file


def server_env(cfg: str) -> dict:
    env = dict(os.environ, TEMP=CACHE, TMP=CACHE, PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1", OCR_THREADS="1",
               OCR_OFFLINE="1", AUTH_MODE="supabase", SUPABASE_URL=SB_URL, SUPABASE_PUBLISHABLE_KEY=PUB,
               RATE_LIMIT_PER_MIN="1000", RATE_LIMIT_USER_PER_MIN="1000", DAILY_LIMIT_PER_USER="0",
               MAX_PIXELS="50000000", MAX_PIXELS_PROGRESSIVE="40000000", OMP_NUM_THREADS="1")
    for k in ("CATALOG_PATH", "CLIP_MODEL_PATH", "KHO_NHOM_HMAC_KEY", "NHOM_SONG_SONG"):
        env.pop(k, None)
    if cfg != "goc":
        env["CLIP_MODEL_PATH"] = str(CLIP_MODEL)
    if cfg in ("noi", "song"):
        env["KHO_NHOM_HMAC_KEY"] = secrets.token_hex(32)  # khóa THỬ sinh lúc đo, không in, không ghi file
        env["NHOM_SONG_SONG"] = "1" if cfg == "song" else "0"
    return env


def post(path: Path, token: str, timeout: float):
    big = _load("do_anh_lon", "do-anh-lon.py")
    body, ctype = big.multipart_body(path.read_bytes(), path.name)
    req = urllib.request.Request(f"{BASE}/ocr", data=body, headers={"Content-Type": ctype,
                                                                     "Authorization": "Bearer " + token}, method="POST")
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
        j = {}
    return status, j, secs


def wait_health(server, t0: float, timeout: float = 180.0) -> dict:
    """Hỏi {BASE}/health (cổng RIÊNG của khung đo này) mỗi 0,1 s tới khi 200."""
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


def p95(xs):
    s = sorted(xs)
    return s[max(0, -(-95 * len(s) // 100) - 1)]


def cmd_do(a):
    import psutil

    h2h3 = _load("do_h2h3", "do_h2h3.py")
    big = _load("do_anh_lon", "do-anh-lon.py")
    rss = _load("do_rss_mod", "do_rss.py")
    cfg = a.cau_hinh
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    Path(CACHE).mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"do-{cfg}.json"
    if out_file.exists() and not a.ghi_de:
        raise SystemExit(f"Đã có {out_file}: thêm --ghi-de nếu thật sự muốn đo lại.")
    if big.port_listening(PORT):
        raise SystemExit(f"Cổng {PORT} đang có máy chủ khác.")
    if cfg != "goc" and not CLIP_MODEL.is_file():
        raise SystemExit(f"thiếu model CLIP {CLIP_MODEL}")
    files = h2h3.photos_b()
    heavy = h2h3.HEAVY
    token, jwks_file = make_token(out_dir)
    sha, dirty = h2h3.git_info()
    out = {"cauHinh": cfg, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "commit": sha, "dirty": dirty, "ocrThreads": 1,
           "motNhan": not a.khong_mot_nhan, "nKho": N_KHO if cfg in ("noi", "song") else 0, "photos": len(files)}
    log_path = out_file.with_suffix(".server.log")
    stop_ev = threading.Event()
    cmd = [sys.executable, str(Path(__file__).resolve()), "may-chu", "--jwks", str(jwks_file)]
    with open(log_path, "wb") as log_file:
        server = subprocess.Popen(cmd, cwd=HERE, env=server_env(cfg), stdout=log_file, stderr=subprocess.STDOUT,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        sampler = None
        try:
            if not a.khong_mot_nhan:  # ghim mọi tiến trình (mồi + python thật) vào nhân 0
                deadline = time.perf_counter() + 10
                while time.perf_counter() < deadline:
                    procs = [psutil.Process(server.pid)] + psutil.Process(server.pid).children(recursive=True)
                    for p in procs:
                        p.cpu_affinity([0])
                    if len(procs) >= 2 or server.poll() is not None:
                        break
                    time.sleep(0.05)
                out["affinity"] = [p.cpu_affinity() for p in procs]
            tracker = rss.PeakTracker(server.pid)

            def loop():
                while not stop_ev.is_set():
                    try:
                        tracker.sample()
                    except Exception:  # noqa: BLE001
                        return
                    stop_ev.wait(0.05)

            sampler = threading.Thread(target=loop, daemon=True)
            sampler.start()
            h = wait_health(server, time.perf_counter())
            body = h["body"]
            want_clip = cfg != "goc"
            want_nhom = cfg in ("noi", "song")
            if body.get("clip", {}).get("loaded") is not want_clip or body.get("nhom", {}).get("enabled") is not want_nhom:
                raise RuntimeError(f"/health clip / nhom khác mong đợi: {body.get('clip')} {body.get('nhom')}")
            out["health"] = {k: body[k] for k in ("clip", "nhom", "modelLoaded")}
            tracker.sample()
            out["sauNap"] = {k: v for k, v in tracker.result(0.05).items() if k != "pid"}
            secs, statuses, nhom_len = [], [], []
            for f in files:
                st, j, s = post(f, token, 300)
                statuses.append(st)
                secs.append(round(s, 4))
                nhom_len.append(len(j["nhom"]) if isinstance(j.get("nhom"), list) else None)
            st, j, s = post(heavy, token, 600)
            statuses.append(st)
            nhom_len.append(len(j["nhom"]) if isinstance(j.get("nhom"), list) else None)
            tracker.sample()
            out["anhNangGiay"] = round(s, 2)
            out["sauAnhNang"] = {k: v for k, v in tracker.result(0.05).items() if k != "pid"}
            out["giay30"] = secs
            out["statuses"] = statuses
            out["nhomLen"] = nhom_len
        finally:
            stop_ev.set()
            big.stop_tree(server)
            for _ in range(100):
                if not big.port_listening(PORT):
                    break
                time.sleep(0.1)
            out["tat"] = {"stopped": server.poll() is not None, "portStillListening": big.port_listening(PORT)}
            if sampler is not None:
                sampler.join(2)
            jwks_file.unlink(missing_ok=True)
    ok = len(out.get("statuses", [])) == 31 and all(x == 200 for x in out["statuses"])
    if cfg in ("noi", "song"):
        ok = ok and all(n is not None and 1 <= n <= 3 for n in out["nhomLen"])
    else:
        ok = ok and all(n is None for n in out["nhomLen"])
    out["hong"] = not ok
    w = out.get("sauAnhNang", {})
    vals = [x for x in (w.get("peakWsetMB"), w.get("peakPrivateMB")) if x is not None]
    out["ramDinhMiB"] = max(vals) if vals else None
    if out.get("giay30"):
        out["trungViGiay"] = round(statistics.median(out["giay30"]), 4)
        out["p95Giay"] = p95(out["giay30"])
    out_file.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{cfg}] trung vị {out.get('trungViGiay')} s, p95 {out.get('p95Giay')} s, RAM đỉnh {out['ramDinhMiB']} MiB, "
          f"ảnh nặng {out.get('anhNangGiay')} s, HTTP ok {ok}, nhom {set(out.get('nhomLen', []))}, tắt {out['tat']}",
          flush=True)
    return 0 if ok else 1


def cmd_clip(a):
    """Phần thêm của /ocr khi kho nhóm bật (đường nối tiếp), đo riêng trong 1 tiến trình ghim 1 nhân: vector CLIP (1 luồng)
    của ảnh đã giải mã như /ocr + so với kho 300 vector + chọn ≤ 3 món. Không gồm giải mã (đã có ở /ocr), không gồm nạp
    kho (song song với OCR, cache 60 giây). Lượt đầu (làm nóng) không tính."""
    import numpy as np
    import psutil

    sys.path.insert(0, str(HERE))
    import imaging
    import kho_nhom
    from clip_engine import ClipEngine, MODEL_ID

    if not a.khong_mot_nhan:
        psutil.Process().cpu_affinity([0])
    h2h3 = _load("do_h2h3", "do_h2h3.py")
    files = h2h3.photos_b()
    key = secrets.token_bytes(32)
    rng = np.random.default_rng(20261126)
    rows = []
    for i in range(N_KHO):
        v = rng.standard_normal(512)
        v = (v / np.linalg.norm(v)).astype(np.float32)
        p = f"{SUB}/{i:08x}-2222-4333-8444-555555555555.jpg"
        rows.append({"san_pham_id": f"sp-{i // 3}", "duong_dan": p, "vec": kho_nhom.vec_to_json(v), "model": MODEL_ID,
                     "ky": kho_nhom.sign(key, p, MODEL_ID, v), "nhom_san_pham": {"ten": f"Món {i // 3}"}})
    t = time.perf_counter()
    kho = kho_nhom.build_kho(json.loads(json.dumps(rows)), key)
    build_ms = (time.perf_counter() - t) * 1000
    assert kho.n == N_KHO
    eng = ClipEngine(str(CLIP_MODEL), threads=1)
    imgs = [imaging.decode(f.read_bytes(), 50_000_000, max_pixels_progressive=40_000_000)[0] for f in files]
    eng.embed_image(imgs[0])
    ms = []
    for img in imgs:
        t = time.perf_counter()
        out = kho_nhom.top_matches(kho, eng.embed_image(img))
        ms.append(round((time.perf_counter() - t) * 1000, 1))
        assert 1 <= len(out) <= 3
    res = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "motNhan": not a.khong_mot_nhan, "n": len(ms), "nKho": N_KHO,
           "msMoiAnh": ms, "trungViMs": statistics.median(ms), "p95Ms": p95(ms), "maxMs": max(ms),
           "dungKhoMs": round(build_ms, 1)}
    Path(a.out).mkdir(parents=True, exist_ok=True)
    (Path(a.out) / "do-clip-them.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"CLIP + so kho {N_KHO}: trung vị {res['trungViMs']} ms, p95 {res['p95Ms']} ms, max {res['maxMs']} ms "
          f"(n {len(ms)}); kiểm ký + dựng kho {res['dungKhoMs']} ms")
    return 0


def cmd_bang(a):
    res = {}
    for c in CFGS:
        f = Path(a.out) / f"do-{c}.json"
        if f.is_file():
            res[c] = json.loads(f.read_text(encoding="utf-8"))
    base = res.get("tat")
    print("| Cấu hình | n | trung vị (s) | p95 (s) | thêm trung vị so với tat (s) | thêm p95 cặp (s) | RAM đỉnh (MiB) | hỏng |")
    print("|---|---|---|---|---|---|---|---|")
    for c, r in res.items():
        add = add95 = "-"
        if base and c != "tat" and r.get("giay30") and base.get("giay30"):
            diffs = [x - y for x, y in zip(r["giay30"], base["giay30"])]
            add = f"{statistics.median(diffs):+.3f}"
            add95 = f"{p95(diffs):+.3f}"
        print(f"| {c} | {len(r.get('giay30', []))} | {r.get('trungViGiay')} | {r.get('p95Giay')} | {add} | {add95} | "
              f"{r.get('ramDinhMiB')} | {r.get('hong')} |")


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # chữ tiếng Việt khi stdout là file (Windows mặc định cp1252)
    ap =argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("do")
    d.add_argument("--cau-hinh", choices=CFGS, required=True)
    d.add_argument("--out", default=str(OUT))
    d.add_argument("--ghi-de", action="store_true")
    d.add_argument("--khong-mot-nhan", action="store_true")
    m = sub.add_parser("may-chu")
    m.add_argument("--jwks", required=True)
    b = sub.add_parser("bang")
    b.add_argument("--out", default=str(OUT))
    k = sub.add_parser("clip")
    k.add_argument("--out", default=str(OUT))
    k.add_argument("--khong-mot-nhan", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "do":
        return cmd_do(a)
    if a.cmd == "clip":
        return cmd_clip(a)
    if a.cmd == "may-chu":
        return serve(a)
    return cmd_bang(a)


if __name__ == "__main__":
    sys.exit(main())
