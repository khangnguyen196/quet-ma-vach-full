# Dot kho-nhom: tinh vector anh cho khung do nguong (kho-nhom-do.mjs). Goi DUNG bo tinh cua may chu
# (server/clip_engine.py: CLIP ViT-B/32 int8, tien xu ly "cat" cua lens-vec.py, chuan L2, 1 luong).
# Chay trong venv may chu (D:\tmp\may-chu-1\venv: onnxruntime + numpy + pillow). File nay CHI dung chu ASCII.
#
#   python -I kho-nhom-vec.py [--bang D:\tmp\kho-nhom\dinh-danh.json] [--model D:\tmp\lens\model\clip\vision_model_quantized.onnx]
#                             [--out D:\tmp\kho-nhom\vec\vec.json]
#
# Moi anh (kho, anh hoi, anh OFF, anh bien doi P2) qua cung buoc nhu app TRUOC khi tinh vector: xoay EXIF, canh dai
# <= 1600 px (fitSize cua src/front-photo.js, Pillow LANCZOS nhu lens-vec.py jpeg_1600), JPEG chat luong 90, giai ma lai.
# P2: bien doi lam tren anh goc da xoay EXIF (danh sach + tham so co dinh, khop P2_TRANSFORMS cua kho-nhom-do.mjs).
# Worktree ban -> dung (ma 3). Ra file JSON: meta (sha256 model / file nay / clip_engine.py / bang dinh danh, git HEAD) +
# vec {id anh: [512]} + p2 {id anh that: {bien doi: [512]}}.
import argparse
import hashlib
import io
import json
import os
import random
import subprocess
import sys
import time

from PIL import Image, ImageEnhance, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "server"))
import clip_engine  # noqa: E402  (server/clip_engine.py)

LONG_EDGE = 1600
JPEG_QUALITY = 90
P2_SEED = 20261125
P2_TRANSFORMS = ["cat-giua-85", "cat-lech-90", "xoay+6", "xoay-6", "sang-0.7", "sang-1.3", "tuong-phan-0.7", "thu-50", "jpeg-40"]


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fit_size(w, h, max_side=LONG_EDGE):
    """Nhu fitSize cua src/front-photo.js: thu canh dai ve max_side (khong phong to), lam tron nua len."""
    s = min(1.0, max_side / max(w, h))
    return max(1, int(w * s + 0.5)), max(1, int(h * s + 0.5))


def app_jpeg(im):
    """PIL RGB -> bytes JPEG nhu app (canh dai <= 1600, chat luong 90)."""
    w, h = fit_size(*im.size)
    if (w, h) != im.size:
        im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue()


def open_rgb(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def transform(im, name):
    w, h = im.size
    if name == "cat-giua-85":
        cw, ch = int(round(w * 0.85)), int(round(h * 0.85))
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        return im.crop((x0, y0, x0 + cw, y0 + ch))
    if name == "cat-lech-90":
        return im.crop((w - int(round(w * 0.9)), h - int(round(h * 0.9)), w, h))
    if name in ("xoay+6", "xoay-6"):
        return im.rotate(6 if name == "xoay+6" else -6, resample=Image.BICUBIC, expand=False, fillcolor=(128, 128, 128))
    if name.startswith("sang-"):
        return ImageEnhance.Brightness(im).enhance(float(name[5:]))
    if name == "tuong-phan-0.7":
        return ImageEnhance.Contrast(im).enhance(0.7)
    if name == "thu-50":
        return im.resize((max(1, w // 2), max(1, h // 2)), Image.LANCZOS)
    if name == "jpeg-40":
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=40)
        return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    raise ValueError(name)


def git_state():
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        st = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        return head, st.strip() != ""
    except Exception:
        return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bang", default=r"D:\tmp\kho-nhom\dinh-danh.json")
    ap.add_argument("--model", default=r"D:\tmp\lens\model\clip\vision_model_quantized.onnx")
    ap.add_argument("--out", default=r"D:\tmp\kho-nhom\vec\vec.json")
    a = ap.parse_args()
    if not os.path.abspath(a.out).upper().startswith("D:"):
        sys.exit("Chi ghi vao o D.")
    head, dirty = git_state()
    if dirty is not False:
        print("Worktree chua sach: commit roi chay lai.", file=sys.stderr)
        sys.exit(3)
    random.seed(P2_SEED)  # bien doi khong ngau nhien; seed ghi de co dinh neu sau nay them bien doi ngau nhien
    eng = clip_engine.ClipEngine(a.model, threads=1)
    with open(a.bang, encoding="utf-8") as f:
        table = json.load(f)
    vec, p2 = {}, {}
    t0 = time.time()
    for x in table["images"]:
        im = open_rgb(x["file"])
        vec[x["id"]] = [float(v) for v in eng.embed_bytes(app_jpeg(im))]
        if x["nhom"] == "that":
            p2[x["id"]] = {t: [float(v) for v in eng.embed_bytes(app_jpeg(transform(im, t)))] for t in P2_TRANSFORMS}
    meta = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "modelSha256": eng.model_sha256, "modelPath": os.path.abspath(a.model),
        "pre": "cat", "longEdge": LONG_EDGE, "jpegQuality": JPEG_QUALITY, "p2Seed": P2_SEED, "p2Transforms": P2_TRANSFORMS,
        "idTableSha256": file_sha256(a.bang), "vecPySha256": file_sha256(os.path.abspath(__file__)),
        "clipEngineSha256": file_sha256(clip_engine.__file__), "gitHead": head, "gitDirty": dirty,
        "nImages": len(vec), "nP2": sum(len(v) for v in p2.values()), "seconds": round(time.time() - t0, 1),
    }
    h2, d2 = git_state()
    if (h2, d2) != (head, dirty):
        print("Ban code doi giua luot: khong ghi.", file=sys.stderr)
        sys.exit(3)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tam"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "vec": vec, "p2": p2}, f)
    os.replace(tmp, a.out)
    print(f"{meta['nImages']} anh + {meta['nP2']} anh P2, {meta['seconds']} s. Ghi {a.out}")


if __name__ == "__main__":
    main()
