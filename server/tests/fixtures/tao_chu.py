"""Tạo ảnh thử chu.png TỰ VẼ (vài dòng chữ in) cho test real_model và cho workflow server-image (CI gửi ảnh này vào
container). test-ocr/photos bị gitignore nên CI không có ảnh thật; ảnh này không phải ảnh của ai, không vướng giấy phép.

Chạy bằng venv máy chủ (chỉ cần Pillow, đã có trong requirements.txt):

    D:\\tmp\\may-chu-1\\venv\\Scripts\\python server\\tests\\fixtures\\tao_chu.py

Ra server/tests/fixtures/chu.png (PNG xám, < 50 KB). Font: font mặc định có sẵn trong Pillow (ImageFont.load_default),
không phụ thuộc font của máy.
"""
from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent
CHU_PNG = HERE / "chu.png"
LINES = ["VISSAN 2026", "SUA TUOI 180", "OCR THU CI"]
# chữ test / workflow kiểm phải có trong kết quả OCR (chữ in hoa, so trên chữ OCR đã .upper())
CHU_PNG_WORDS = ["VISSAN", "2026", "SUA", "TUOI", "OCR"]


def draw():
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("L", (960, 420), 255)
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=80)
    for i, line in enumerate(LINES):
        d.text((40, 30 + i * 125), line, fill=0, font=font)
    return img


def main():
    draw().save(CHU_PNG, "PNG", optimize=True)
    print(CHU_PNG.name, CHU_PNG.stat().st_size, "byte")


if __name__ == "__main__":
    main()
