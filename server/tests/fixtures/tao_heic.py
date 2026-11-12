"""Tạo 2 ảnh HEIC nhỏ TỰ VẼ cho test (không phải ảnh của ai, không vướng giấy phép ảnh).

Chạy bằng venv TẠM có pillow-heif (KHÔNG vào requirements; pillow-heif kèm x265 GPL nên chỉ dùng làm công cụ tạo, không
phân phối; máy chủ đọc HEIC bằng pi-heif):

    py -3.12 -m venv D:\\tmp\\may-chu-1\\venv-heic-tao
    D:\\tmp\\may-chu-1\\venv-heic-tao\\Scripts\\python -m pip install pillow-heif     # 12/11/2026: pillow_heif 1.8.1, pillow 13.0.0
    D:\\tmp\\may-chu-1\\venv-heic-tao\\Scripts\\python server\\tests\\fixtures\\tao_heic.py

Ra server/tests/fixtures/:
- khong-xoay.heic: hoa văn 64 × 48, không xoay;
- xoay6.heic: CÙNG điểm ảnh, kèm EXIF orientation 6 (pillow-heif chuyển thành hộp irot của HEIF, libheif xoay lúc đọc).
Lưu không mất dữ liệu (quality=-1) + chroma 4:4:4 để điểm ảnh đọc ra so được từng byte với hình vẽ trong test.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from heic_pattern import heic_pattern  # noqa: E402  (cùng hình vẽ với test)


def main():
    import pillow_heif

    pillow_heif.register_heif_opener()
    img = heic_pattern()
    exif6 = Image.Exif()
    exif6[0x0112] = 6
    img.save(HERE / "khong-xoay.heic", format="HEIF", quality=-1, chroma="444")
    img.save(HERE / "xoay6.heic", format="HEIF", quality=-1, chroma="444", exif=exif6.tobytes())
    for name in ("khong-xoay.heic", "xoay6.heic"):
        p = HERE / name
        print(name, p.stat().st_size, "byte")


if __name__ == "__main__":
    main()
