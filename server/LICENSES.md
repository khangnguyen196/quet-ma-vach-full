# Giấy phép – máy chủ OCR (server/)

Lấy từ metadata của các gói ĐÃ CÀI trong venv `D:\tmp\may-chu-1\venv` (12/11/2026), không đoán. Lệnh đã dùng:

```powershell
D:\tmp\may-chu-1\venv\Scripts\python -c "from importlib.metadata import distributions as D; [print(d.metadata['Name'], d.version, d.metadata.get('License-Expression') or d.metadata.get('License'), [c for c in (d.metadata.get_all('Classifier') or []) if c.startswith('License ::')], [f.name for f in (d.files or []) if 'licen' in f.name.lower()]) for d in D()]"
```

và đọc tay các file `LICENSE*` / `MODEL_LICENSES.md` / `LICENSES_bundled.txt` trong thư mục `*.dist-info` tương ứng.

## Model

| Model | File | sha256 | Giấy phép | Nguồn |
|---|---|---|---|---|
| PP-OCRv6 small det | `PP-OCRv6_det_small.onnx` (9.929.594 byte) | `090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f` | Apache-2.0 | PaddleOCR (Baidu), RapidOCR đổi sang ONNX; nằm sẵn trong wheel `rapidocr==3.10.0` (`rapidocr/models/`); ghi ở `rapidocr-3.10.0.dist-info/licenses/MODEL_LICENSES.md` mục 6 |
| PP-OCRv6 small rec | `PP-OCRv6_rec_small.onnx` (21.234.383 byte) | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` | Apache-2.0 | như trên |

`MODEL_LICENSES.md` của RapidOCR: mã RapidOCR thuộc RapidOCR Authors, trọng số model thuộc Baidu / PaddleOCR, cả hai phát hành theo Apache-2.0; phân phối lại thì kèm bản Apache-2.0 và giữ ghi chú nguồn. Model cls (`ch_ppocr_mobile_v2.0_cls_mobile.onnx`, Apache-2.0) có trong wheel nhưng máy chủ KHÔNG dùng (`Global.use_cls=False`).

## Gói Python chạy máy chủ (`requirements.txt`)

| Gói | Phiên bản | Giấy phép (metadata) | Ghi chú |
|---|---|---|---|
| rapidocr | 3.10.0 | Apache-2.0 | kèm `MODEL_LICENSES.md` |
| onnxruntime | 1.31.1 | MIT License | |
| opencv-python-headless | 5.0.0.93 | Apache 2.0 | `LICENSE-3RD-PARTY.txt`: kèm FFmpeg (LGPL, `opencv_videoio_ffmpeg*.dll` trên Windows) và vài thư viện khác (bản Linux: libvpx, bzip2, OpenSSL…); máy chủ không dùng phần video |
| numpy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | |
| pillow | 13.0.0 | MIT-CMU | |
| pi_heif | 1.4.0 | BSD-3-Clause (mã); classifier LGPLv3 | `LICENSES_bundled.txt`: bản wheel kèm libheif 1.x + libde265 (LGPLv3, thư viện động). KHÔNG kèm x265 |
| fastapi | 0.162.5 | MIT | |
| starlette | 1.10.0 | BSD-3-Clause | |
| uvicorn | 0.54.0 | BSD-3-Clause | |
| python-multipart | 0.0.33 | Apache-2.0 | |
| pydantic | 2.14.3 | MIT | |
| pydantic_core | 2.50.4 | MIT | |
| annotated-doc | 0.0.6 | MIT | |
| annotated-types | 0.8.0 | MIT | |
| anyio | 4.16.0 | MIT | |
| h11 | 0.16.0 | MIT | |
| click | 8.5.1 | BSD-3-Clause | |
| typing_extensions | 4.16.0 | PSF-2.0 | |
| typing-inspection | 0.4.5 | MIT | |
| opentelemetry-api | 1.45.2 | Apache-2.0 | fastapi kéo theo |
| omegaconf | 2.4.0 | BSD License (classifier) | kèm `LICENSE-antlr4` |
| PyYAML | 6.0.3 | MIT | |
| pyclipper | 1.4.0 | MIT | |
| shapely | 2.2.0 | BSD-3-Clause | kèm `LICENSE_GEOS` (GEOS: LGPL-2.1) |
| colorlog | 6.12.0 | MIT License | |
| colorama | 0.4.6 | BSD License (classifier) | |
| tqdm | 4.70.1 | MPL-2.0 AND MIT | |
| requests | 2.34.2 | Apache-2.0 | rapidocr dùng để tải model (máy chủ không tải khi OCR_OFFLINE=1) |
| urllib3 | 2.8.0 | MIT | |
| certifi | 2026.10.23 | MPL-2.0 | |
| charset-normalizer | 3.5.2 | MIT | |
| idna | 3.20 | BSD-3-Clause | |
| flatbuffers | 25.12.19 | Apache 2.0 | |
| protobuf | 7.36.2 | 3-Clause BSD License | |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause | |
| six | 1.17.0 | MIT | |

## Gói chỉ để test / đo (`requirements-dev.txt`, không vào Docker image)

| Gói | Phiên bản | Giấy phép |
|---|---|---|
| pytest | 9.2.0 | MIT |
| httpx | 0.28.1 | BSD-3-Clause |
| httpcore | 1.0.9 | BSD-3-Clause |
| iniconfig | 2.3.1 | MIT |
| pluggy | 1.7.0 | MIT |
| Pygments | 2.21.0 | BSD-2-Clause |
| psutil | 7.2.2 | BSD-3-Clause |

## HEIC: vì sao pi-heif, không pillow-heif

Đã tải 2 wheel `cp312-win_amd64` về `D:\tmp\may-chu-1\heif-dl` (chỉ đọc metadata) và wheel `pi_heif` bản `manylinux_2_28_x86_64` (cho Docker):

- `pillow_heif-1.8.1`: kèm `libx265-*.dll` (~22 MB) — x265 là GPL → không dùng.
- `pi_heif-1.4.0`: chỉ kèm `libheif` + `libde265` (+ runtime gcc trên Windows), `LICENSES_bundled.txt` ghi cả hai LGPLv3; bản Linux cũng chỉ có `libheif-*.so` + `libde265-*.so`. Đọc được HEIC, không ghi được (máy chủ chỉ cần đọc).

Không có pi-heif (gói không cài được) thì máy chủ trả 415 "Máy chủ chưa hỗ trợ HEIC" cho ảnh HEIC; JPEG / PNG vẫn chạy.

Ảnh HEIC trong `tests/fixtures/` là hình tự vẽ (không có giấy phép ảnh nào vướng), tạo một lần bằng `pillow-heif` trong venv
TẠM ngoài repo (`tests/fixtures/tao_heic.py`); `pillow-heif` không nằm trong requirements, không vào image, không phân phối.

## Khi đưa image Docker lên registry công khai

File này được chép vào image (`Dockerfile` `COPY LICENSES.md`, `.dockerignore` có `!LICENSES.md`); thư mục `*.dist-info`
trong image cũng giữ file LICENSE của từng gói. **Đẩy image lên registry công khai (Docker Hub, GHCR công khai…) là PHÂN
PHỐI**: khi đó phải kèm văn bản giấy phép và chỉ nơi lấy mã nguồn của các thư viện LGPL nằm trong image: libheif +
libde265 (LGPL-3.0, trong wheel `pi_heif`), FFmpeg (LGPL, trong wheel `opencv-python-headless`), GEOS (LGPL-2.1, trong
`shapely`). Chạy image riêng trên máy ảo của mình (không cho người khác tải image) thì không phải phân phối.
