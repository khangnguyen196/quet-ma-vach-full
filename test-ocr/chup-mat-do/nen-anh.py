"""
Nén front.jpg cho các API ảnh (đợt chup-mat-do vòng 2), dùng PIL có sẵn trong venv vietocr (không cài thêm):
  - 1c OCR.space: cạnh dài <= 1600 px, file <= 1 MB (giới hạn gói miễn phí).
  - 4a Gemini: cạnh dài <= 1024 px.
Xoay theo EXIF, lưu JPEG; quá 1 MB thì giảm chất lượng từng bước (90 -> 50).

    D:\\quet-ma-vach-full\\test-ocr\\vietocr\\.venv\\Scripts\\python chup-mat-do\\nen-anh.py \
        --photos D:\\quet-ma-vach-full\\test-ocr\\photos --out D:\\tmp\\chup-mat-do\\anh-nen
Ra: <out>/1600/<mã>.jpg, <out>/1024/<mã>.jpg
"""
import argparse
import io
import pathlib

from PIL import Image, ImageOps

MAX_BYTES = 1_000_000


def save(img, side, dst):
    im = img.copy()
    im.thumbnail((side, side))
    for q in (90, 85, 80, 70, 60, 50):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True)
        if buf.tell() <= MAX_BYTES:
            break
    dst.write_bytes(buf.getvalue())
    return im.size, buf.tell(), q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", default=r"D:\quet-ma-vach-full\test-ocr\photos")
    ap.add_argument("--out", default=r"D:\tmp\chup-mat-do\anh-nen")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    for side in (1600, 1024):
        (out / str(side)).mkdir(parents=True, exist_ok=True)
    for src in sorted(pathlib.Path(args.photos).glob("*/front.jpg")):
        img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        for side in (1600, 1024):
            size, n, q = save(img, side, out / str(side) / f"{src.parent.name}.jpg")
            print(f"{src.parent.name} {side}: {size[0]}x{size[1]} {n} byte q{q}")


if __name__ == "__main__":
    main()
