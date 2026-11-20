# Dot lens: tinh vector anh (onnxruntime CPU, Pillow, numpy dung ban server/requirements.txt; KHONG torch / transformers).
# Chay trong venv D:\tmp\lens\venv. File nay CHI dung chu ASCII trong code; chu thich khong dau.
#
#   python -I lens-vec.py kiem  [--model-dir D:\tmp\lens\model] [--ref D:\tmp\lens\ref] [--out D:\tmp\lens\ket-qua\kiem-tien-xu-ly.json]
#       So tien xu ly Python voi transformers.js 4.3.1 (file tham chieu do lens-js-ref.mjs ghi: pixel_values + vector cua
#       10 anh catalog ngau nhien, cung file ONNX): cos >= 0,999 moi anh, moi model.
#   python -I lens-vec.py gio   [--model-dir ...] [--anh D:\tmp\lens\anh] [--out D:\tmp\lens\ket-qua\gio-ram.json]
#       Thoi gian 1 luong (20 anh catalog: doc + tien xu ly + vector + tim tren ma tran co muc (b)), trung vi / p95 / lon
#       nhat; RAM them khi nap model (working set Windows truoc / sau nap + sau 20 anh). Khong --chi: moi model mot tien
#       trinh con (RAM khong lan), gop ve --out.
#   python -I lens-vec.py vec --model clip-fp32 --pre cat [--vao D:\tmp\lens\vec-vao-a.json] [--vec D:\tmp\lens\vec]
#        [--threads 4] [--phut 7.5]
#       Dung chi muc anh + sims tu danh sach TUONG MINH (lens-tai.mjs --vao-vec); chay noi theo phan; kiem 10 anh
#       cos(1 luong, nhieu luong) >= 0,9999 (truot -> khong ghi bo sim); meta.json ghi CUOI, mang cac truong chong an
#       gian (lens-chay.mjs kiem).
#   python -I lens-vec.py gio1600 [--anh-that D:\tmp\may-chu-loc\anh] [--out D:\tmp\lens\gio-1600.json] [--nb 42208]
#       R6 (LECH LUAT 2 (ii)): 20 anh that thu canh dai 1.600 px JPEG 90 trong bo nho; 1 luong; 3 model x cat / vien,
#       moi model mot tien trinh. Chi do gio, khong ghi vector.
# EXIF: moi lenh xoay theo EXIF (ImageOps.exif_transpose) cho ca anh chi muc lan anh truy van.
#
# Tien xu ly (giong ImageProcessor cua transformers.js tren Node, dung sharp):
#   resize = sharp affine voi noi suy bicubic (KHONG khu rang cua khi thu nho), roi lam tron ve uint8;
#   kich thuoc moi: shortest_edge -> floor(toFixed(2)) nhu get_resize_output_image_size; center_crop lech floor;
#   rescale 1/255, normalize mean / std, CHW float32.
#   Che do: "goc" = dung bo xu ly goc (CLIP / DINOv2: thu canh ngan + cat giua; SigLIP: ep 224 x 224);
#           "cat"  = thu canh ngan ve kich thuoc cat roi cat giua (moi model);
#           "vien" = them vien (mau = mean cua model) cho vuong roi thu ve kich thuoc cat.
import argparse
import ctypes
import json
import os
import hashlib
import random
import statistics
import subprocess
import sys
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

MODELS = {
    "clip-fp32": {"dir": "clip", "onnx": "vision_model.onnx", "repo": "Xenova/clip-vit-base-patch32",
                  "revision": "6b7c523703ae26e39be4b03774966f8571c7f523",
                  "sha256": "fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40",
                  "license": "MIT", "out": "image_embeds"},
    "clip-int8": {"dir": "clip", "onnx": "vision_model_quantized.onnx", "repo": "Xenova/clip-vit-base-patch32",
                  "revision": "6b7c523703ae26e39be4b03774966f8571c7f523",
                  "sha256": "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299",
                  "license": "MIT", "out": "image_embeds"},
    "siglip": {"dir": "siglip", "onnx": "vision_model.onnx", "repo": "Xenova/siglip-base-patch16-224",
               "revision": "4649052661e53c7000355844105f8a1792088239",
               "sha256": "f89d41bac7f4d4b87e010a467d93f98689d708916ed22f5a07f96fdfa26f475f",
               "license": "Apache-2.0", "out": "pooler_output"},
    "dinov2-small": {"dir": "dinov2-small", "onnx": "model.onnx", "repo": "Xenova/dinov2-small",
                     "revision": "c2bb04a51fab207c420665f1946016107bffc701",
                     "sha256": "83141175ec78b4ff9a2bb58a4c7c264ba0054d1c2e122e5a8114b79a8d4179ea",
                     "license": "Apache-2.0", "out": "cls"},
}
N_B = 44092  # so dong danh muc muc (b) (kho-lon); co ma tran tim khi do gio


def load_cfg(model_dir, name):
    with open(os.path.join(model_dir, MODELS[name]["dir"], "preprocessor_config.json"), encoding="utf-8") as f:
        return json.load(f)


def session(model_dir, name, threads=1):
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    return ort.InferenceSession(os.path.join(model_dir, MODELS[name]["dir"], MODELS[name]["onnx"]), so,
                                providers=["CPUExecutionProvider"])


def cubic_w(t, a=-0.5):
    t = np.abs(t)
    w = np.where(t <= 1, (a + 2) * t ** 3 - (a + 3) * t ** 2 + 1,
                 np.where(t < 2, a * t ** 3 - 5 * a * t ** 2 + 8 * a * t - 4 * a, 0.0))
    return w


def axis_weights(n_in, n_out, center):
    """Ma tran [n_out, n_in] noi suy bicubic Catmull-Rom (a = -0,5) tai toa do vao (khong khu rang cua).
    center False (khop sharp affine, do bang so tung diem anh voi transformers.js): toa do vao = x / ti le, diem ngoai
    bien = 0 (nen den cua affine). center True: toa do tam diem anh, lap lai mep (chi de so)."""
    scale = n_out / n_in
    x = np.arange(n_out, dtype=np.float64)
    src = (x + 0.5) / scale - 0.5 if center else x / scale
    base = np.floor(src).astype(np.int64)
    M = np.zeros((n_out, n_in), dtype=np.float64)
    rows = np.arange(n_out)
    for k in range(-1, 3):
        idx = base + k
        w = cubic_w(src - idx)
        if center:
            np.add.at(M, (rows, np.clip(idx, 0, n_in - 1)), w)
        else:
            ok = (idx >= 0) & (idx < n_in)
            np.add.at(M, (rows[ok], idx[ok]), w[ok])
    return M


def resize_float(arr, w, h, center=False):
    """Ban so thuc (chi de so): arr uint8 HxWx3 -> uint8 hxwx3."""
    H, W = arr.shape[:2]
    if (W, H) == (w, h):
        return arr
    My = axis_weights(H, h, center)
    Mx = axis_weights(W, w, center)
    f = arr.astype(np.float64)
    out = np.einsum("yh,hwc->ywc", My, f)
    out = np.einsum("xw,ywc->yxc", Mx, out)
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


TRANSFORM_SCALE = 64     # VIPS_TRANSFORM_SCALE (1 << 6): vi tri le luong tu 1/64
INTERP_SHIFT = 12        # VIPS_INTERPOLATE_SHIFT: he so nguyen x 4096


def _catmull(x):
    dx = 1.0 - x
    return np.array([-0.5 * x * dx * dx, 1 + x * x * (1.5 * x - 2.5), 1 + dx * dx * (1.5 * dx - 2.5), -0.5 * x * x * dx])


def _fixed_tables(n_in, n_out):
    xs = np.arange(n_out, dtype=np.float64) / (n_out / n_in)
    ix = np.floor(xs).astype(np.int64)
    tx = np.floor((xs - ix) * TRANSFORM_SCALE + 0.5).astype(np.int64)
    cf = np.stack([_catmull(t / TRANSFORM_SCALE) for t in tx]) * (1 << INTERP_SHIFT)
    return ix, np.trunc(cf).astype(np.int64)


def _round_shift(v):
    return (v + (1 << (INTERP_SHIFT - 1))) >> INTERP_SHIFT


def resize_affine(arr, w, h, center=False):
    """arr uint8 HxWx3 -> uint8 hxwx3 GIONG TUNG DIEM sharp affine bicubic (libvips): toa do vao = x / ti le, vi tri le
    luong tu 1/64 (lam tron), he so Catmull-Rom nguyen (x 4096, cat phan le), tinh theo hang roi theo cot co lam tron
    nguyen moi buoc, diem ngoai bien = 0. Do bang so tung diem anh voi transformers.js 4.3.1 (Node): trung 100 %.
    center True -> ban so thuc tam diem anh (chi de so)."""
    if center:
        return resize_float(arr, w, h, center=True)
    H, W = arr.shape[:2]
    if (W, H) == (w, h):
        return arr
    P = arr.astype(np.int64)
    ix, cx = _fixed_tables(W, w)
    iy, cy = _fixed_tables(H, h)

    def take(A, idx, axis):
        ok = (idx >= 0) & (idx < A.shape[axis])
        out = np.take(A, np.clip(idx, 0, A.shape[axis] - 1), axis=axis)
        shape = [1] * A.ndim
        shape[axis] = -1
        return out * ok.reshape(shape)

    R = _round_shift(sum(cx[:, k][None, :, None] * take(P, ix + k - 1, 1) for k in range(4)))
    O = _round_shift(sum(cy[:, k][:, None, None] * take(R, iy + k - 1, 0) for k in range(4)))
    return np.clip(O, 0, 255).astype(np.uint8)


def shortest_size(W, H, s):
    r = max(s / W, s / H)
    fw = int(np.floor(float(f"{W * r:.2f}")))
    fh = int(np.floor(float(f"{H * r:.2f}")))
    return fw, fh


def center_crop(arr, cw, ch):
    H, W = arr.shape[:2]
    if (W, H) == (cw, ch):
        return arr
    x0 = int(np.floor((W - cw) / 2))
    y0 = int(np.floor((H - ch) / 2))
    return arr[y0:y0 + ch, x0:x0 + cw]


def crop_size(cfg):
    c = cfg.get("crop_size") or cfg.get("size")
    return (c["width"], c["height"]) if isinstance(c, dict) and "width" in c else (224, 224)


def to_tensor(arr, cfg):
    # dung thu tu lam tron cua transformers.js: (so float64 x uint8) luu float32; roi (float64(x) - mean) / std luu float32
    x = (float(cfg.get("rescale_factor", 1 / 255)) * arr.astype(np.float64)).astype(np.float32)
    mean = np.array(cfg["image_mean"], dtype=np.float64)
    std = np.array(cfg["image_std"], dtype=np.float64)
    x = ((x.astype(np.float64) - mean) / std).astype(np.float32)
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])


def read_rgb(path):
    """MOT cach EXIF cho moi lenh (chi muc, truy van, kiem, gio): xoay theo EXIF bang ImageOps.exif_transpose roi RGB
    (goi y 8 cua code-reviewer vong 1). 10 anh tham chieu cua lenh kiem khong co the Orientation (da kiem) nen ket qua
    kiem vong 1 khong doi."""
    from PIL import ImageOps
    im = ImageOps.exif_transpose(Image.open(path))
    return np.asarray(im.convert("RGB"))


def preprocess(arr, cfg, mode, center=False):
    cw, ch = crop_size(cfg)
    if mode == "goc":
        size = cfg["size"]
        if "shortest_edge" in size:
            W, H = arr.shape[1], arr.shape[0]
            arr = resize_affine(arr, *shortest_size(W, H, size["shortest_edge"]), center=center)
        else:
            arr = resize_affine(arr, size["width"], size["height"], center=center)
        if cfg.get("do_center_crop"):
            arr = center_crop(arr, cw, ch)
        return to_tensor(arr, cfg)
    if mode == "cat":
        W, H = arr.shape[1], arr.shape[0]
        arr = resize_affine(arr, *shortest_size(W, H, min(cw, ch)), center=center)
        return to_tensor(center_crop(arr, cw, ch), cfg)
    if mode == "vien":
        H, W = arr.shape[:2]
        S = max(W, H)
        fill = np.array([round(m * 255) for m in cfg["image_mean"]], dtype=np.uint8)
        sq = np.empty((S, S, 3), dtype=np.uint8)
        sq[:] = fill
        y0, x0 = (S - H) // 2, (S - W) // 2
        sq[y0:y0 + H, x0:x0 + W] = arr
        return to_tensor(resize_affine(sq, cw, ch, center=center), cfg)
    raise ValueError(mode)


def embed(sess, name, x):
    outs = {o.name: i for i, o in enumerate(sess.get_outputs())}
    res = sess.run(None, {sess.get_inputs()[0].name: x})
    kind = MODELS[name]["out"]
    if kind == "cls":
        v = res[outs["last_hidden_state"]][0, 0]
    else:
        v = res[outs[kind]][0]
    v = v.astype(np.float64)
    return (v / (np.linalg.norm(v) or 1.0)).astype(np.float32)


def working_set_mib():
    """Working set hien tai + dinh cua tien trinh (Windows, ctypes); noi khac -> None."""
    if sys.platform != "win32":
        return None, None

    class PMC(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong), ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t)]
    c = PMC()
    c.cb = ctypes.sizeof(PMC)
    k32 = ctypes.windll.kernel32
    k32.GetCurrentProcess.restype = ctypes.c_void_p
    k32.K32GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), ctypes.c_ulong]
    k32.K32GetProcessMemoryInfo.restype = ctypes.c_int
    if not k32.K32GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb):
        return None, None
    return c.WorkingSetSize / 1048576, c.PeakWorkingSetSize / 1048576


def nearest_rank(xs, p):
    s = sorted(xs)
    k = max(0, min(len(s) - 1, int(np.ceil(p * len(s) - 1e-9)) - 1))
    return s[k]


def cmd_kiem(a):
    with open(os.path.join(a.ref, "ref.json"), encoding="utf-8") as f:
        ref = json.load(f)
    out = {"files": ref["files"], "models": {}}
    for name in MODELS:
        if name not in ref["models"]:
            continue
        cfg = load_cfg(a.model_dir, name)
        sess = session(a.model_dir, name)
        js_px = np.load(os.path.join(a.ref, f"{name}-px.npy"))
        js_vec = np.load(os.path.join(a.ref, f"{name}-vec.npy"))
        rows = []
        for center in (True, False):
            coss, pxd, ortc = [], [], []
            for i, fpath in enumerate(ref["files"]):
                x = preprocess(read_rgb(fpath), cfg, "goc", center=center)
                v = embed(sess, name, x)
                coss.append(float(np.dot(v, js_vec[i])))
                pxd.append(float(np.abs(x[0] - js_px[i]).max()))
                ortc.append(float(np.dot(embed(sess, name, js_px[i][None].astype(np.float32)), js_vec[i])))
            rows.append({"center": center, "cosMin": min(coss), "cosMedian": statistics.median(coss), "pxMaxAbs": max(pxd),
                         "ortSameInputCosMin": min(ortc), "cos": coss})
        best = max(rows, key=lambda r: r["cosMin"])
        out["models"][name] = {"variants": rows, "chosenCenter": best["center"], "cosMin": best["cosMin"], "pass": best["cosMin"] >= 0.999}
        print(f"{name:14s} cos nho nhat {best['cosMin']:.6f} (center {best['center']}; px lech max {best['pxMaxAbs']:.4f}; "
              f"cung dau vao ORT Python vs JS {best['ortSameInputCosMin']:.6f}) -> {'DAT' if best['cosMin'] >= 0.999 else 'TRUOT'}")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


def cmd_gio(a):
    if not a.chi:
        # mac dinh MOI MODEL MOT TIEN TRINH (goi y 8 cua code-reviewer vong 1): RAM / working set khong lan giua model
        merged = None
        base, ext = os.path.splitext(a.out)
        for name in MODELS:
            part = f"{base}-{name}{ext}"
            cmd = [sys.executable, "-I", os.path.abspath(__file__), "gio", "--chi", name, "--model-dir", a.model_dir,
                   "--anh", a.anh, "--out", part]
            r = subprocess.run(cmd)
            if r.returncode != 0:
                sys.exit(r.returncode)
            with open(part, encoding="utf-8") as f:
                j = json.load(f)
            if merged is None:
                merged = {**j, "models": {}, "perProcess": True}
            merged["models"].update(j["models"])
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=1)
        return
    files = sorted(os.path.join(a.anh, n) for n in os.listdir(a.anh) if n.endswith(".jpg"))
    rnd = random.Random(20261120)
    pick = rnd.sample(files, 20)
    out = {"cpu": os.environ.get("PROCESSOR_IDENTIFIER", ""), "threads": 1, "nB": N_B, "ort": ort.__version__,
           "note": "ma tran tim = vector ngau nhien co muc (b), float32; RAM = working set Windows (MiB), tru ma tran tim",
           "files": [os.path.basename(p) for p in pick], "models": {}}
    for name in [n for n in MODELS if not a.chi or n == a.chi]:
        cfg = load_cfg(a.model_dir, name)
        ws0, _ = working_set_mib()
        t0 = time.perf_counter()
        sess = session(a.model_dir, name)
        load_s = time.perf_counter() - t0
        ws1, _ = working_set_mib()
        dims = sess.get_outputs()[0].shape
        x0 = preprocess(read_rgb(pick[0]), cfg, "cat")
        d = embed(sess, name, x0).shape[0]
        rng = np.random.default_rng(1)
        mat = rng.standard_normal((N_B, d)).astype(np.float32)
        mat /= np.linalg.norm(mat, axis=1, keepdims=True)
        embed(sess, name, x0)  # lam nong
        times = {}
        for mode in ("cat", "vien"):
            ms = []
            for p in pick:
                t = time.perf_counter()
                v = embed(sess, name, preprocess(read_rgb(p), cfg, mode))
                s = mat @ v
                np.argpartition(-s, 50)[:50]
                ms.append((time.perf_counter() - t) * 1000)
            times[mode] = {"median": statistics.median(ms), "p95": nearest_rank(ms, 0.95), "max": max(ms), "n": len(ms)}
        ws2, peak = working_set_mib()
        size = os.path.getsize(os.path.join(a.model_dir, MODELS[name]["dir"], MODELS[name]["onnx"]))
        out["models"][name] = {**{k: MODELS[name][k] for k in ("repo", "revision", "sha256", "license", "onnx")}, "onnxBytes": size,
                               "dims": d, "loadS": load_s, "ramAddLoadMiB": (ws1 - ws0) if ws0 else None,
                               "ramAddAfter20MiB": (ws2 - ws0 - mat.nbytes / 1048576) if ws0 else None,
                               "peakWsMiB": peak, "searchMatMiB": mat.nbytes / 1048576, "time": times}
        print(f"{name:14s} {size / 1e6:7.1f} MB {d} chieu nap {load_s:.2f}s RAM them nap {ws1 - ws0:.0f} MiB, sau 20 anh {ws2 - ws0 - mat.nbytes / 1048576:.0f} MiB (tru ma tran) | "
              + " | ".join(f"{m}: tv {t['median']:.0f} p95 {t['p95']:.0f} max {t['max']:.0f} ms" for m, t in times.items()))
        del sess, mat
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


CHUNK = 256          # so anh chi muc moi phan (luu rieng de chay noi nhieu lan)
THREAD_CHECK_N = 10  # so anh kiem cos(1 luong, nhieu luong)
THREAD_COS_MIN = 0.9999
GUARD_KEYS = ("antiCheatSha256", "boPSha256", "excluded", "override", "hideByRow", "indexKey", "indexImgid")
TMP_SUFFIX = ".tam"


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def embed_files(sess, name, cfg, mode, files):
    return np.stack([embed(sess, name, preprocess(read_rgb(p), cfg, mode)) for p in files]).astype(np.float32)


def atomic_npy(path, arr):
    """Ghi .npy ra file tam roi doi ten (goi y 2 cua code-reviewer truoc do): dang ghi bi ngat thi khong de lai file do."""
    tmp = path + TMP_SUFFIX
    with open(tmp, "wb") as f:
        np.save(f, arr)
    os.replace(tmp, path)


def atomic_json(path, obj, indent=None):
    tmp = path + TMP_SUFFIX
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
    os.replace(tmp, path)


def save_vec_outputs(out_dir, X, sims, codes, qids, meta):
    """Ghi bo sim cua MOT bien the (NEN SUA 2 cua code-reviewer truoc do). meta.json CHI ghi khi
    meta["threadCheck"]["pass"] is True; truot -> khong ghi gi, tra False (nguoi goi thoat ma 3). Dat: xoa meta.json cu
    TRUOC (bo sim dang ghi do khong bao gio co meta hop le), ghi index.npy / sims.npy / codes.json / queries.json qua file
    tam + doi ten, meta.json ghi CUOI cung. Tra True."""
    if not (isinstance(meta.get("threadCheck"), dict) and meta["threadCheck"].get("pass") is True):
        return False
    mp = os.path.join(out_dir, "meta.json")
    if os.path.exists(mp):
        os.remove(mp)
    atomic_npy(os.path.join(out_dir, "index.npy"), X)
    atomic_npy(os.path.join(out_dir, "sims.npy"), sims)
    atomic_json(os.path.join(out_dir, "codes.json"), list(codes))
    atomic_json(os.path.join(out_dir, "queries.json"), list(qids))
    atomic_json(mp, meta, indent=1)
    return True


def cmd_vec(a):
    """Dung chi muc anh + do giong cho MOT bien the (model x tien xu ly) tu danh sach TUONG MINH (lens-tai.mjs --vao-vec):
    anh chi muc = vin["index"] (da ap chong an gian: ma bi loai co mat voi khoa danh muc + an theo hang hideByRow,
    override A / B, override bo P chi muc a), truy van = vin["queries"]. Khong quet thu muc anh. Ra
    <vec>/<model>-<pre>/<muc>/: index.npy (vector chi muc fp32), sims.npy [truy van x san pham] (hang DAY DU, an theo hang
    do lens-do.mjs simsFrom ap), codes.json, queries.json, meta.json (gom cac truong chong an gian de lens-chay.mjs kiem).
    Chay noi: vector chi muc luu theo phan (phan/idx-<k>.npy, ghi tam roi doi ten); het --phut thi thoat ma 10. Phan cu
    khac dau vao / model / so luong -> dung, thoat ma 3. Truot kiem nhieu luong -> khong ghi bo sim, thoat ma 3."""
    with open(a.vao, encoding="utf-8") as f:
        vin = json.load(f)
    name, mode = a.model, a.pre
    if name not in MODELS or mode not in ("cat", "vien"):
        sys.exit(f"model / tien xu ly la: {name} {mode}")
    level = vin["level"]
    out_dir = os.path.join(a.vec, f"{name}-{mode}", level)
    if not os.path.abspath(out_dir).upper().startswith("D:"):
        sys.exit("Chi ghi vao o D.")
    part_dir = os.path.join(out_dir, "phan")
    os.makedirs(part_dir, exist_ok=True)
    sig = {"vaoSha256": file_sha256(a.vao), "model": name, "pre": mode, "onnxSha256": MODELS[name]["sha256"], "chunk": CHUNK,
           "threads": a.threads}
    sig_file = os.path.join(part_dir, "dau.json")
    if os.path.exists(sig_file):
        with open(sig_file, encoding="utf-8") as f:
            old = json.load(f)
        if old != sig:
            print(f"Phan cu khac dau vao / model / so luong ({sig_file}): xoa thu muc phan roi chay lai.", file=sys.stderr)
            sys.exit(3)
    else:
        atomic_json(sig_file, sig)
    cfg = load_cfg(a.model_dir, name)
    onnx_path = os.path.join(a.model_dir, MODELS[name]["dir"], MODELS[name]["onnx"])
    if file_sha256(onnx_path) != MODELS[name]["sha256"]:
        sys.exit(f"sha256 file ONNX khac ban ghim: {onnx_path}")
    sess = session(a.model_dir, name, threads=a.threads)
    index = vin["index"]
    files = [x["file"] for x in index]
    for p in files:
        if not os.path.exists(p):
            sys.exit(f"thieu file anh chi muc: {p}")
    deadline = time.time() + a.phut * 60
    nchunks = (len(files) + CHUNK - 1) // CHUNK
    t0 = time.time()
    for k in range(nchunks):
        pf = os.path.join(part_dir, f"idx-{k:04d}.npy")
        if os.path.exists(pf):
            continue
        if time.time() > deadline:
            left = sum(1 for j in range(nchunks) if not os.path.exists(os.path.join(part_dir, f"idx-{j:04d}.npy")))
            print(f"Het gio: con {left}/{nchunks} phan, chay lai de lam tiep.")
            sys.exit(10)
        X = embed_files(sess, name, cfg, mode, files[k * CHUNK:(k + 1) * CHUNK])
        atomic_npy(pf, X)
        print(f"phan {k + 1}/{nchunks} ({X.shape[0]} anh), {time.time() - t0:.0f}s", flush=True)
    X = np.concatenate([np.load(os.path.join(part_dir, f"idx-{k:04d}.npy")) for k in range(nchunks)])
    if X.shape[0] != len(files):
        sys.exit(f"so vector chi muc {X.shape[0]} != {len(files)}")
    qs = [q for q in vin["queries"] if q.get("file") and os.path.exists(q["file"])]
    q_missing = [q["qid"] for q in vin["queries"] if not (q.get("file") and os.path.exists(q["file"]))]
    # kiem nhieu luong TRUOC khi tinh truy van: THREAD_CHECK_N anh chi muc dau tinh lai bang 1 luong
    s1 = session(a.model_dir, name, threads=1)
    n_chk = min(THREAD_CHECK_N, len(files))
    X1 = embed_files(s1, name, cfg, mode, files[:n_chk])
    cos = [float(np.dot(X1[i], X[i])) for i in range(n_chk)]
    thread_check = {"n": n_chk, "threads": a.threads, "cosMin": min(cos) if cos else None,
                    "pass": bool(cos) and min(cos) >= THREAD_COS_MIN}
    if not thread_check["pass"]:
        print(f"{name}-{mode} muc {level}: kiem {a.threads} luong vs 1 luong cos min {thread_check['cosMin']} -> TRUOT: "
              "khong ghi bo sim.", file=sys.stderr)
        sys.exit(3)
    Q = embed_files(sess, name, cfg, mode, [q["file"] for q in qs]) if qs else np.zeros((0, X.shape[1]), np.float32)
    sims = (Q @ X.T).astype(np.float32)
    m = MODELS[name]
    meta = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "model": name, "pre": mode, "level": level,
        **{k: m[k] for k in ("repo", "revision", "sha256", "license", "onnx")}, "onnxBytes": os.path.getsize(onnx_path),
        "dims": int(X.shape[1]), "nIndex": int(X.shape[0]), "nQueries": len(qs), "queriesMissing": q_missing,
        "exif": "ImageOps.exif_transpose (chi muc + truy van)", "threads": a.threads, "threadCheck": thread_check,
        "vaoFile": os.path.abspath(a.vao), "vaoSha256": sig["vaoSha256"], "missingIndexFiles": len(vin.get("missing", [])),
        "simsNote": "hang DAY DU; an theo hang (hideByRow) ap o lens-do.mjs simsFrom",
        **{k: vin[k] for k in GUARD_KEYS},
    }
    if not save_vec_outputs(out_dir, X, sims, [x["code"] for x in index], [q["qid"] for q in qs], meta):
        sys.exit(3)
    print(f"{name}-{mode} muc {level}: {X.shape[0]} anh chi muc, {len(qs)} truy van (thieu {len(q_missing)}), "
          f"kiem {a.threads} luong vs 1 luong cos min {thread_check['cosMin']} -> DAT. Ghi {out_dir}")
    if q_missing:
        sys.exit(3)


# ---------------- R6 o anh 1.600 px (LECH LUAT 2 (ii)) ----------------
R6_MODELS = ("clip-fp32", "clip-int8", "dinov2-small")  # 3 model x 2 tien xu ly = 6 bien the (SigLIP khong tinh, R7)
LONG_EDGE = 1600
JPEG_Q = 90         # Pillow quality 90 ~ canvas.toBlob(..., 0.9) cua prepareImage
N_SEARCH_B = 42208  # so san pham co anh o muc (b) (planList cua lens-tai.mjs)
SEED = 20261120


def fit_size(w, h, max_side=LONG_EDGE):
    """Nhu fitSize cua src/front-photo.js: thu canh dai ve max_side (khong phong to), lam tron nua len."""
    s = min(1.0, max_side / max(w, h))
    return max(1, int(np.floor(w * s + 0.5))), max(1, int(np.floor(h * s + 0.5)))


def jpeg_1600(path):
    """Anh goc -> bytes JPEG canh dai <= 1.600 px, chat luong 90, da xoay EXIF (nhu trinh duyet ve canvas), TRONG BO NHO."""
    import io
    from PIL import ImageOps
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    w, h = fit_size(*im.size)
    if (w, h) != im.size:
        im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=JPEG_Q)
    return buf.getvalue(), (w, h)


def read_rgb_bytes(b):
    """Giai ma JPEG trong bo nho + xoay EXIF (cung mot cach EXIF voi read_rgb) -> uint8 HxWx3."""
    import io
    from PIL import ImageOps
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(b)))
    return np.asarray(im.convert("RGB"))


def cpu_name():
    try:
        import winreg
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        return winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
    except Exception:
        return None


def real_photos(root):
    out = []
    for d, _, fs_ in os.walk(root):
        for n in fs_:
            if n.lower().endswith((".jpg", ".jpeg")):
                out.append(os.path.join(d, n))
    return sorted(out)


def cmd_gio1600(a):
    """R6 o anh truy van 1.600 px (LECH LUAT 2 (ii)): 20 anh that (chi de do gio; KHONG ghi vector / ten file anh ra dia),
    moi anh thu canh dai 1.600 px + JPEG chat luong 90 trong bo nho (khong tinh gio, nhu dien thoai lam); do 1 luong:
    giai ma JPEG do + xoay EXIF + tien xu ly + vector + tim tren ma tran ngau nhien co muc (b) (N_SEARCH_B x so chieu,
    float32). Moi model mot tien trinh con (RAM khong lan), ca 2 tien xu ly. Ra --out (D:\\tmp\\lens\\gio-1600.json)."""
    if not a.chi:
        merged = None
        base, ext = os.path.splitext(a.out)
        for name in R6_MODELS:
            part = f"{base}-{name}{ext}"
            cmd = [sys.executable, "-I", os.path.abspath(__file__), "gio1600", "--chi", name, "--model-dir", a.model_dir,
                   "--anh-that", a.anh_that, "--out", part, "--nb", str(a.nb)]
            r = subprocess.run(cmd)
            if r.returncode != 0:
                sys.exit(r.returncode)
            with open(part, encoding="utf-8") as f:
                j = json.load(f)
            if merged is None:
                merged = {**j, "models": {}, "perProcess": True}
            merged["models"].update(j["models"])
        merged["r6P95MaxMs"] = 1500
        merged["r6Fail"] = [f"{n}|{m}" for n, x in merged["models"].items() for m, t in x["time"].items() if not t["p95"] <= 1500]
        atomic_json(a.out, merged, indent=1)
        print(f"Ghi {a.out}; truot R6 (p95 > 1500 ms): {merged['r6Fail'] or 'khong'}")
        return
    files = real_photos(a.anh_that)
    if len(files) < 20:
        sys.exit(f"can >= 20 anh that, co {len(files)}")
    pick = random.Random(SEED).sample(files, 20)
    jpgs = [jpeg_1600(p) for p in pick]
    name = a.chi
    out = {"cpu": os.environ.get("PROCESSOR_IDENTIFIER", ""), "cpuName": cpu_name(), "logicalCpus": os.cpu_count(),
           "threads": 1, "longEdge": LONG_EDGE, "jpegQuality": 0.9, "pillowQuality": JPEG_Q, "nSearch": a.nb,
           "ort": ort.__version__, "n": len(pick), "seed": SEED, "nRealPhotos": len(files),
           "pickSha256": hashlib.sha256("\n".join(os.path.basename(p) for p in pick).encode("utf-8")).hexdigest(),
           "sizes": sorted({f"{w}x{h}" for _, (w, h) in jpgs}),
           "jpegBytesMedian": statistics.median(len(b) for b, _ in jpgs),
           "note": "gio = giai ma JPEG 1.600 px + xoay EXIF + tien xu ly + vector + tim (ma tran ngau nhien, float32, "
                   "argpartition 50); RAM = working set Windows (MiB) tru ma tran tim; anh that chi de do gio, khong ghi "
                   "vector / ten file",
           "models": {}}
    cfg = load_cfg(a.model_dir, name)
    ws0, _ = working_set_mib()
    t0 = time.perf_counter()
    sess = session(a.model_dir, name)
    load_s = time.perf_counter() - t0
    ws1, _ = working_set_mib()
    x0 = preprocess(read_rgb_bytes(jpgs[0][0]), cfg, "cat")
    d = embed(sess, name, x0).shape[0]
    rng = np.random.default_rng(1)
    mat = rng.standard_normal((a.nb, d)).astype(np.float32)
    mat /= np.linalg.norm(mat, axis=1, keepdims=True)
    embed(sess, name, x0)  # lam nong
    times = {}
    for mode in ("cat", "vien"):
        ms = []
        for b, _ in jpgs:
            t = time.perf_counter()
            v = embed(sess, name, preprocess(read_rgb_bytes(b), cfg, mode))
            s = mat @ v
            np.argpartition(-s, 50)[:50]
            ms.append((time.perf_counter() - t) * 1000)
        times[mode] = {"median": statistics.median(ms), "p95": nearest_rank(ms, 0.95), "max": max(ms), "n": len(ms),
                       "r6Pass": nearest_rank(ms, 0.95) <= 1500}
    ws2, peak = working_set_mib()
    size = os.path.getsize(os.path.join(a.model_dir, MODELS[name]["dir"], MODELS[name]["onnx"]))
    out["models"][name] = {**{k: MODELS[name][k] for k in ("repo", "revision", "sha256", "license", "onnx")}, "onnxBytes": size,
                           "dims": d, "loadS": load_s, "wsBeforeMiB": ws0, "ramAddLoadMiB": (ws1 - ws0) if ws0 else None,
                           "ramAddAfter20MiB": (ws2 - ws0 - mat.nbytes / 1048576) if ws0 else None,
                           "peakWsMiB": peak, "searchMatMiB": mat.nbytes / 1048576, "time": times}
    print(f"{name:14s} {d} chieu, nap {load_s:.2f}s, RAM them nap {ws1 - ws0:.0f} MiB, sau 20 anh {ws2 - ws0 - mat.nbytes / 1048576:.0f} MiB "
          f"(tru ma tran), dinh {peak:.0f} MiB | " + " | ".join(f"{m}: tv {t['median']:.0f} p95 {t['p95']:.0f} max {t['max']:.0f} ms" for m, t in times.items()))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    atomic_json(a.out, out, indent=1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["kiem", "gio", "vec", "gio1600"])
    ap.add_argument("--model-dir", default=r"D:\tmp\lens\model")
    ap.add_argument("--ref", default=r"D:\tmp\lens\ref")
    ap.add_argument("--anh", default=r"D:\tmp\lens\anh")
    ap.add_argument("--out", default=None)
    ap.add_argument("--chi", default=None, choices=list(MODELS), help="gio: chi do mot model (mac dinh moi model mot tien trinh)")
    ap.add_argument("--vao", default=r"D:\tmp\lens\vec-vao-a.json", help="vec: dau vao tu lens-tai.mjs --vao-vec")
    ap.add_argument("--vec", default=r"D:\tmp\lens\vec", help="vec: thu muc ra")
    ap.add_argument("--model", default=None, choices=list(MODELS), help="vec: model")
    ap.add_argument("--pre", default="cat", choices=["cat", "vien"], help="vec: tien xu ly")
    ap.add_argument("--threads", type=int, default=4, help="vec: so luong ORT khi dung chi muc")
    ap.add_argument("--phut", type=float, default=7.5, help="vec: gioi han thoi gian moi lan chay (phut)")
    ap.add_argument("--anh-that", default=r"D:\tmp\may-chu-loc\anh", help="gio1600: thu muc anh that (chi de do gio)")
    ap.add_argument("--nb", type=int, default=N_SEARCH_B, help="gio1600: so hang ma tran tim (muc (b) co anh)")
    a = ap.parse_args()
    if a.out is None:
        a.out = {"kiem": r"D:\tmp\lens\ket-qua\kiem-tien-xu-ly.json", "gio1600": r"D:\tmp\lens\gio-1600.json"}.get(
            a.cmd, r"D:\tmp\lens\ket-qua\gio-ram.json")
    if a.cmd == "vec" and not a.model:
        ap.error("vec can --model")
    if a.cmd == "gio1600" and a.chi and a.chi not in R6_MODELS:
        ap.error(f"gio1600 chi do {R6_MODELS}")
    if a.cmd in ("gio", "gio1600") and not os.path.abspath(a.out).upper().startswith("D:"):
        sys.exit("Chi ghi vao o D.")
    {"kiem": cmd_kiem, "gio": cmd_gio, "vec": cmd_vec, "gio1600": cmd_gio1600}[a.cmd](a)


if __name__ == "__main__":
    main()
