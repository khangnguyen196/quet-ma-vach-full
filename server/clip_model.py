"""Nguồn tải model CLIP ViT-B/32 int8 của kho nhóm (đợt kho-nhom vòng 5).

Tách khỏi clip_engine.py để clip_engine.py giữ ĐÚNG bản mốc vector bfc32a0 (khung đo test-ocr/chup-mat-do/kho-nhom-do.mjs
đòi clip_engine.py không đổi từ mốc đó). Máy chủ lúc chạy KHÔNG dùng file này (không tải gì): chỉ Dockerfile (tải lúc
build) và test_dockerfile.py (kiểm Dockerfile dùng đúng URL + sha256) đọc. sha256 / revision / tên file: MODEL_SHA256,
MODEL_INFO của clip_engine.py.
"""
from __future__ import annotations

from clip_engine import MODEL_INFO, MODEL_SHA256

# Nguồn tải ghim theo revision (Dockerfile tải lúc build rồi sha256sum -c với MODEL_SHA256; test_dockerfile.py kiểm trùng)
MODEL_URL = ("https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/6b7c523703ae26e39be4b03774966f8571c7f523"
             "/onnx/vision_model_quantized.onnx")
MODEL_BYTES = 89_117_001

__all__ = ["MODEL_URL", "MODEL_BYTES", "MODEL_SHA256", "MODEL_INFO"]
