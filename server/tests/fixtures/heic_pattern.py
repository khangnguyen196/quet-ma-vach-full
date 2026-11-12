"""Hình vẽ dùng chung cho tao_heic.py (tạo ảnh HEIC) và test HEIC: 64 × 48, KHÔNG đối xứng (khối đỏ ở góc trên trái,
vạch xanh chéo, nền khối màu) để xoay 1 lần / 2 lần / không xoay đều ra ảnh khác nhau."""
from __future__ import annotations

from PIL import Image, ImageDraw

SIZE = (64, 48)


def heic_pattern() -> Image.Image:
    w, h = SIZE
    img = Image.new("RGB", SIZE, (40, 60, 200))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w // 2 - 1, h // 2 - 1], fill=(230, 30, 30))
    d.rectangle([w // 2, h // 2, w - 1, h - 1], fill=(250, 220, 40))
    d.rectangle([4, h - 12, 20, h - 4], fill=(20, 200, 60))
    d.line([(w - 1, 0), (w // 2, h // 2)], fill=(255, 255, 255), width=3)
    return img
