"""
Cách 1d (đợt chup-mat-do): PP-OCRv5 mobile det (ONNX) + VietOCR, chỉ trên front.jpg, ra JSON có khung chữ
để chup-mat-do/run-ocr-off.mjs lấy từ khóa S2 rồi tìm Open Food Facts. Chỉ máy tính (CPU), không chạy trong app.

Dùng lại nguyên các hàm của test-ocr/vietocr/run_vietocr.py (prepare, Detector, crop, load_vietocr), không sửa file đó.
Chạy bằng venv của vietocr (ở thư mục chính của repo), trong thư mục test-ocr:
    D:\\quet-ma-vach-full\\test-ocr\\vietocr\\.venv\\Scripts\\python chup-mat-do\\vietocr-bridge.py \
        --photos D:\\quet-ma-vach-full\\test-ocr\\photos --out D:\\tmp\\chup-mat-do\\ocr\\vietocr-1d

Ra: <out>/<mã>__front.json = { status, seconds, device, lines: [{ text, h, box: [[x,y]x4] }] }
(dòng theo thứ tự đọc như order_lines; h = chiều cao khung, px trên ảnh đã thu về 1600 px).
Ảnh đã có file kết quả thì bỏ qua. Không gọi mạng.
"""
import argparse
import json
import pathlib
import sys
import time
import traceback

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "vietocr"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

import run_vietocr as rv  # noqa: E402


def ordered_lines(boxes, texts, min_overlap=0.5):
    """Như rv.order_lines nhưng giữ khung + chiều cao cho từng dòng."""
    items = []
    for box, text in zip(boxes, texts):
        if not text or not text.strip():
            continue
        items.append(dict(minX=float(box[:, 0].min()), minY=float(box[:, 1].min()), maxY=float(box[:, 1].max()),
                          text=text.strip(), box=[[round(float(x), 1), round(float(y), 1)] for x, y in box]))
    items.sort(key=lambda b: (b["minY"], b["minX"]))
    rows = []
    for b in items:
        if rows:
            row = rows[-1]
            overlap = min(b["maxY"], row["maxY"]) - max(b["minY"], row["minY"])
            hh = min(b["maxY"] - b["minY"], row["maxY"] - row["minY"])
            if hh > 0 and overlap / hh >= min_overlap:
                row["boxes"].append(b)
                row["minY"] = min(row["minY"], b["minY"])
                row["maxY"] = max(row["maxY"], b["maxY"])
                continue
        rows.append(dict(minY=b["minY"], maxY=b["maxY"], boxes=[b]))
    out = []
    for r in rows:
        for b in sorted(r["boxes"], key=lambda b: b["minX"]):
            out.append(dict(text=b["text"], h=round(b["maxY"] - b["minY"], 1), box=b["box"]))
    return out


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", default=r"D:\quet-ma-vach-full\test-ocr\photos")
    ap.add_argument("--out", default=r"D:\tmp\chup-mat-do\ocr\vietocr-1d")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-minutes", type=float, default=45, help="dừng khi hết giờ (giới hạn của vòng)")
    args = ap.parse_args()

    photos = sorted(pathlib.Path(args.photos).glob("*/front.jpg"))
    if args.limit:
        photos = photos[: args.limit]
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    device = f"CPU, torch {torch.__version__}, {torch.get_num_threads()} luồng"
    print(f"{len(photos)} ảnh front.jpg. {device}")
    start = time.perf_counter()
    t0 = time.perf_counter()
    det = rv.Detector(rv.DET_ONNX)
    rec = rv.load_vietocr()
    load_s = round(time.perf_counter() - t0, 2)
    print(f"Nạp model: {load_s} giây")
    done = 0
    for src in photos:
        if (time.perf_counter() - start) / 60 > args.max_minutes:
            print(f"DỪNG vì hết giờ ({done}/{len(photos)} ảnh)")
            break
        code = src.parent.name
        f = out / f"{code}__front.json"
        if f.exists():
            done += 1
            continue
        t = time.perf_counter()
        try:
            rgb = np.array(rv.prepare(src))
            t = time.perf_counter()  # chỉ tính bước đọc, như run_vietocr.py
            boxes = det(rgb)
            crops = [Image.fromarray(rv.crop(rgb, b)) for b in boxes]
            texts = rec.predict_batch(crops) if crops else []
            lines = ordered_lines(boxes, texts)
            status = "ok"
        except Exception as e:  # ghi lỗi, chạy tiếp
            lines, status = [], f"error: {e}"
            traceback.print_exc(limit=1)
        secs = round(time.perf_counter() - t, 2)
        f.write_text(json.dumps(dict(code=code, status=status, seconds=secs, device=device, loadSeconds=load_s,
                                     lines=lines), ensure_ascii=False), encoding="utf-8")
        done += 1
        print(f"  {code}: {secs}s {status} ({len(lines)} dòng)")
    print(f"Xong {done}/{len(photos)} ảnh, {round((time.perf_counter() - start) / 60, 1)} phút")


if __name__ == "__main__":
    main()
