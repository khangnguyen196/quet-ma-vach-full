"""Đọc thân yêu cầu POST /ocr (multipart/form-data) HOÀN TOÀN TRONG RAM, không file tạm.

Vì sao không dùng request.form() của Starlette: FormParser / MultiPartParser của Starlette 1.10.0 đặt mỗi file vào
SpooledTemporaryFile(max_size=spool_max_size = 1 MB) -> ảnh > 1 MB bị ghi ra file tạm trên đĩa; và nó đọc HẾT thân
yêu cầu rồi mới trả, không dừng sớm khi vượt trần. Ở đây dùng thẳng bộ tách luồng (streaming) MultipartParser của
python-multipart (chỉ gọi callback, không tự tạo file), giữ phần "image" trong bytearray, đếm byte theo từng khúc:
- Content-Length > trần thân (MAX_BYTES + phần đầu multipart) -> 413 trước khi đọc;
- thân thật vượt trần (dù Content-Length thiếu / sai) hoặc phần ảnh vượt MAX_BYTES -> dừng đọc ngay, 413.
"""
from __future__ import annotations

from python_multipart.exceptions import FormParserError
from python_multipart.multipart import MultipartParser, parse_options_header

IMAGE_FIELD = "image"
MAX_PARTS = 16


class UploadError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _mb(n: int) -> str:
    return f"{n / (1024 * 1024):g} MB".replace(".", ",")


class _Collector:
    """Callback cho MultipartParser: giữ dữ liệu phần "image", các phần khác chỉ đếm."""

    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        self.parts = []  # [{name, filename, size}]
        self.image = None  # bytearray của phần image (nếu có)
        self.image_count = 0
        self.file_count = 0
        self.ended = False
        self._cur = None
        self._hname = b""
        self._hvalue = b""
        self._disposition = b""

    def callbacks(self):
        return {
            "on_part_begin": self.on_part_begin,
            "on_header_field": self.on_header_field,
            "on_header_value": self.on_header_value,
            "on_header_end": self.on_header_end,
            "on_headers_finished": self.on_headers_finished,
            "on_part_data": self.on_part_data,
            "on_part_end": self.on_part_end,
            "on_end": self.on_end,
        }

    def on_part_begin(self):
        if len(self.parts) >= MAX_PARTS:
            raise UploadError(400, "Yêu cầu có quá nhiều phần. Chỉ gửi 1 ảnh trong trường 'image'.")
        self._cur = {"name": None, "filename": None, "size": 0, "is_image": False}
        self._disposition = b""

    def on_header_field(self, data, start, end):
        self._hname += data[start:end]

    def on_header_value(self, data, start, end):
        self._hvalue += data[start:end]

    def on_header_end(self):
        if self._hname.strip().lower() == b"content-disposition":
            self._disposition = self._hvalue
        self._hname = b""
        self._hvalue = b""

    def on_headers_finished(self):
        _, opts = parse_options_header(self._disposition)
        name = opts.get(b"name")
        if name is None:
            raise UploadError(400, "Phần multipart thiếu tên trường.")
        cur = self._cur
        cur["name"] = name.decode("utf-8", "replace")
        has_file = b"filename" in opts
        if has_file:
            self.file_count += 1
        if cur["name"] == IMAGE_FIELD:
            self.image_count += 1
            if self.image_count > 1:
                raise UploadError(400, "Chỉ gửi 1 ảnh mỗi lần.")
            cur["is_image"] = True
            self.image = bytearray()
        if self.file_count > 1:
            raise UploadError(400, "Chỉ gửi 1 ảnh mỗi lần.")

    def on_part_data(self, data, start, end):
        n = end - start
        cur = self._cur
        cur["size"] += n
        if cur["is_image"]:
            if cur["size"] > self.max_bytes:
                raise UploadError(413, f"Ảnh quá lớn (tối đa {_mb(self.max_bytes)}).")
            self.image += data[start:end]

    def on_part_end(self):
        self.parts.append(self._cur)
        self._cur = None

    def on_end(self):
        self.ended = True


def boundary_of(content_type: str):
    ctype, opts = parse_options_header(content_type or "")
    if ctype != b"multipart/form-data":
        return None
    b = opts.get(b"boundary")
    return b if b else None


async def read_image(request, max_bytes: int, max_body: int):
    """-> (bytes của ảnh, số byte thân đã đọc). Ném UploadError (400 / 413)."""
    boundary = boundary_of(request.headers.get("content-type", ""))
    if boundary is None:
        raise UploadError(400, "Cần gửi ảnh dạng multipart/form-data trong trường 'image'.")
    raw_len = request.headers.get("content-length")
    if raw_len is not None:
        try:
            declared = int(raw_len)
        except ValueError:
            raise UploadError(400, "Content-Length không hợp lệ.") from None
        if declared > max_body:
            raise UploadError(413, f"Ảnh quá lớn (tối đa {_mb(max_bytes)}).")
    col = _Collector(max_bytes)
    try:
        parser = MultipartParser(boundary, col.callbacks())
    except (FormParserError, ValueError):
        raise UploadError(400, "Ranh giới multipart không hợp lệ.") from None
    total = 0
    try:
        async for chunk in request.stream():
            if not chunk:
                continue
            total += len(chunk)
            if total > max_body:
                raise UploadError(413, f"Ảnh quá lớn (tối đa {_mb(max_bytes)}).")
            parser.write(chunk)
        parser.finalize()
    except UploadError:
        raise
    except FormParserError:
        raise UploadError(400, "Dữ liệu multipart bị hỏng.") from None
    if not col.ended:
        raise UploadError(400, "Dữ liệu multipart chưa trọn (thiếu phần kết thúc).")
    if col.image_count == 0:
        raise UploadError(400, "Thiếu trường 'image' chứa ảnh.")
    if not col.image:
        raise UploadError(400, "Ảnh rỗng (0 byte).")
    return bytes(col.image), total
