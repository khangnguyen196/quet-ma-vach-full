"""Đọc nguồn Dockerfile / .dockerignore / requirements (đợt may-chu-2): máy không có Docker, nên kiểm bằng đọc ở đây;
build + chạy thật nằm ở workflow .github/workflows/server-image.yml (CI)."""
from __future__ import annotations

import ast
import fnmatch
import hashlib
import json
import re

from conftest import SERVER

REPO = SERVER.parent


def _dockerfile() -> str:
    return (SERVER / "Dockerfile").read_text(encoding="utf-8")


def _env(src: str) -> dict:
    """Gộp mọi lệnh ENV (dạng KEY=VALUE, nối dòng bằng "\\")."""
    out = {}
    flat = re.sub(r"\\\n", " ", src)
    for line in flat.splitlines():
        if line.startswith("ENV "):
            for k, v in re.findall(r"([A-Z_][A-Z0-9_]*)=(\S+)", line[4:]):
                out[k] = v
    return out


def _last_cmd(src: str) -> list:
    lines = [ln for ln in src.splitlines() if ln.startswith("CMD ")]
    return json.loads(lines[-1][4:])


def test_cong_8080_doc_tu_port():
    src = _dockerfile()
    env = _env(src)
    assert env["PORT"] == "8080"
    assert re.search(r"^EXPOSE 8080$", src, re.M)
    assert "8765" not in src  # cổng cũ không còn ở đâu trong Dockerfile
    cmd = _last_cmd(src)
    assert cmd[:2] == ["sh", "-c"] and len(cmd) == 3
    shell = cmd[2]
    assert shell.startswith("exec uvicorn app:app --host 0.0.0.0 ")
    assert '--port "${PORT:-8080}"' in shell
    for flag in ("--workers 1", "--no-access-log", "--no-proxy-headers", "--limit-concurrency 16"):
        assert flag in shell


def test_auth_mode_mac_dinh_supabase_va_cau_hinh_chay_that():
    env = _env(_dockerfile())
    assert env["AUTH_MODE"] == "supabase"  # quên đặt biến Supabase trên Azure thì máy chủ không khởi động
    assert env["OCR_OFFLINE"] == "1" and env["CORS_ALLOW_LOCALHOST"] == "0"
    assert env["MAX_PIXELS"] == "50000000" and env["MAX_PIXELS_PROGRESSIVE"] == "40000000"
    assert "SUPABASE_URL" not in env and "SUPABASE_PUBLISHABLE_KEY" not in env and "ALLOWED_ORIGINS" not in env


def test_nguoi_dung_khong_phai_root_va_kiem_sha256_luc_build():
    src = _dockerfile()
    assert re.search(r"^USER ocr$", src, re.M)
    assert "model_problems" in src and "MODEL_SHA256" in src
    for old in ("B1s", "CHƯA BUILD", "làm ở đợt dang-nhap"):
        assert old not in src


def test_git_sha_arg_env_dat_sau_cac_buoc_nang():
    """ARG GIT_SHA + ENV GIT_SHA=$GIT_SHA (cho /health "commit", đợt cung-co vòng 2) đứng SAU pip install, COPY mã và các
    bước RUN nặng: đổi mã commit không làm mất cache các lớp đó."""
    lines = _dockerfile().splitlines()
    arg = [i for i, ln in enumerate(lines) if re.fullmatch(r"ARG GIT_SHA=unknown", ln.strip())]
    env = [i for i, ln in enumerate(lines) if re.fullmatch(r"ENV GIT_SHA=\$GIT_SHA", ln.strip())]
    assert len(arg) == 1 and len(env) == 1, "cần đúng 1 dòng ARG GIT_SHA=unknown và 1 dòng ENV GIT_SHA=$GIT_SHA"
    assert arg[0] < env[0]
    heavy = [i for i, ln in enumerate(lines) if ln.startswith(("RUN ", "COPY "))]
    assert any("pip install" in lines[i] for i in heavy)
    assert arg[0] > max(heavy), "ARG GIT_SHA phải đứng sau mọi RUN / COPY (pip install, mã, kiểm model)"
    # không dùng GIT_SHA ở lệnh nào khác (chỉ ENV cho máy chủ đọc)
    assert sum("GIT_SHA" in ln for ln in lines if not ln.lstrip().startswith("#")) == 2


def _local_imports(path) -> set:
    """Tên module server/*.py mà file import (đọc bằng ast, gồm cả import lười trong hàm / try)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split(".")[0])
    return {n for n in names if (SERVER / f"{n}.py").is_file()}


def _app_modules() -> set:
    """app.py + mọi module server/*.py nó import, kể cả gián tiếp."""
    todo, seen = ["app"], set()
    while todo:
        m = todo.pop()
        if m in seen:
            continue
        seen.add(m)
        todo.extend(_local_imports(SERVER / f"{m}.py") - seen)
    return seen


def _copied_files(src: str) -> set:
    out = set()
    for line in re.sub(r"\\\n", " ", src).splitlines():
        if line.startswith("COPY ") and "--from" not in line:
            parts = line.split()[1:]
            out.update(parts[:-1])  # phần tử cuối là đích
    return out


def test_moi_module_app_import_deu_duoc_copy():
    """Thiếu 1 file .py mà app.py import (kể cả import lười như catalog_search trong load_catalog) thì ảnh Docker chạy
    được tới lúc gọi tới mới hỏng: bắt ngay ở đây (đợt kho-lon vòng 3)."""
    mods = _app_modules()
    assert {"app", "settings", "auth", "catalog_search"} <= mods, mods
    copied = _copied_files(_dockerfile())
    missing = sorted(f"{m}.py" for m in mods if f"{m}.py" not in copied)
    assert not missing, f"Dockerfile thiếu COPY: {missing}"


def test_local_imports_doc_ca_import_luoi(tmp_path, monkeypatch):
    f = tmp_path / "x.py"
    f.write_text("import os\ndef f():\n    from catalog_search import CatalogIndex\n    import auth\n", encoding="utf-8")
    assert _local_imports(f) == {"catalog_search", "auth"}


def test_chi_muc_dung_luc_build_va_catalog_path_mac_dinh():
    """Đợt kho-lon vòng 3: COPY danh mục mức đã chọn, RUN build + verify chỉ mục, ENV CATALOG_PATH = thư mục chỉ mục,
    người dùng ocr nạp thử; mọi bước trước ARG GIT_SHA (test_git_sha_arg_env_dat_sau_cac_buoc_nang)."""
    src = _dockerfile()
    flat = re.sub(r"\\\n", " ", src)
    copy = [ln for ln in flat.splitlines() if ln.startswith("COPY ") and "catalog/" in ln]
    assert len(copy) == 1, copy
    m = re.search(r"COPY (catalog/[a-c]\.jsonl\.gz) (\S+)", copy[0])
    assert m, copy[0]
    gz = SERVER / m.group(1)
    assert gz.is_file() and gz.stat().st_size <= 25 * 1024 * 1024, "danh mục phải có trong repo, <= 25 MiB"
    assert len(list((SERVER / "catalog").glob("*.jsonl.gz"))) == 1, "chỉ commit danh mục của mức đã chọn"
    run = next(ln for ln in flat.splitlines() if ln.startswith("RUN ") and "catalog_search.py build" in ln)
    assert f"catalog_search.py build {m.group(2)} /app/catalog-index" in run
    assert f"catalog_search.py verify /app/catalog-index {m.group(2)}" in run
    assert "rm -rf" in run and "chmod -R a+rX /app/catalog-index" in run
    assert _env(src)["CATALOG_PATH"] == "/app/catalog-index"
    lines = src.splitlines()
    user = next(i for i, ln in enumerate(lines) if ln.strip() == "USER ocr")
    assert any("load_dir('/app/catalog-index')" in ln for ln in lines[user:]), "người dùng ocr phải nạp thử chỉ mục"


_SHA_RE = re.compile(r"[0-9a-f]{64}")


def _catalog_copy(src: str) -> tuple:
    """(nguồn trong repo "catalog/x.jsonl.gz", đích trong ảnh) của dòng COPY danh mục."""
    flat = re.sub(r"\\\n", " ", src)
    m = re.search(r"^COPY (catalog/[a-c]\.jsonl\.gz) (\S+)$", flat, re.M)
    assert m, "thiếu dòng COPY catalog/<mức>.jsonl.gz <đích>"
    return m.group(1), m.group(2)


def _dockerfile_sha(src: str, dest: str) -> list:
    """sha256 ghi trong Dockerfile cho file danh mục trong ảnh: dạng echo "<sha>  <đích>" | sha256sum -c -."""
    flat = re.sub(r"\\\n", " ", src)
    pat = re.compile(r'echo\s+"([0-9a-f]{64})  ' + re.escape(dest) + r'"\s*\|\s*sha256sum\s+-c\s+-')
    return [m.group(1) for m in pat.finditer(flat)]


def _licenses_sha(rel: str) -> list:
    """sha256 trên dòng bảng của LICENSES.md nhắc file danh mục (vd `catalog/c.jsonl.gz`)."""
    rows = [ln for ln in (SERVER / "LICENSES.md").read_text(encoding="utf-8").splitlines()
            if ln.startswith("|") and f"`{rel}`" in ln]
    return [s for ln in rows for s in _SHA_RE.findall(ln)]


def test_sha256_danh_muc_trung_3_noi():
    """Kho-lon vòng 4 (NÊN SỬA 1 vòng 3): sha256 THẬT của file danh mục trong repo = số trong LICENSES.md = số Dockerfile
    kiểm bằng `sha256sum -c` (build hỏng nếu file khác). Đổi danh mục thì phải sửa cả 2 chỗ ghi."""
    src = _dockerfile()
    rel, dest = _catalog_copy(src)
    real = hashlib.sha256((SERVER / rel).read_bytes()).hexdigest()
    lic = _licenses_sha(rel)
    dock = _dockerfile_sha(src, dest)
    assert len(lic) == 1, f"LICENSES.md phải ghi đúng 1 sha256 cho {rel}: {lic}"
    assert len(dock) == 1, f"Dockerfile phải có đúng 1 lệnh echo \"<sha>  {dest}\" | sha256sum -c -: {dock}"
    assert lic[0] == real, f"LICENSES.md {lic[0]} khác sha256 thật {real}"
    assert dock[0] == real, f"Dockerfile {dock[0]} khác sha256 thật {real}"


def test_sha256sum_truoc_build_chi_muc_va_thu_tu_lop():
    """sha256sum -c đứng TRƯỚC catalog_search.py build (cùng RUN, nối &&). Gợi ý 2 vòng 3: lớp danh mục (COPY
    catalog_search.py + .gz, RUN kiểm + dựng) đứng SAU pip install và TRƯỚC COPY các file máy chủ còn lại (sửa app.py không
    làm dựng lại chỉ mục ~20 giây); vẫn trước ARG GIT_SHA."""
    src = _dockerfile()
    _, dest = _catalog_copy(src)
    flat = re.sub(r"\\\n", " ", src).splitlines()
    run = next(ln for ln in flat if ln.startswith("RUN ") and "catalog_search.py build" in ln)
    i_sum, i_build = run.find("sha256sum -c -"), run.find("catalog_search.py build")
    assert 0 <= i_sum < i_build, "sha256sum -c phải đứng trước catalog_search.py build"
    assert "&&" in run[i_sum:i_build], "build chỉ chạy khi sha256sum -c đạt (nối bằng &&)"
    idx = lambda pred: next(i for i, ln in enumerate(flat) if pred(ln))  # noqa: E731
    pip = idx(lambda ln: ln.startswith("RUN ") and "pip install" in ln)
    cs = idx(lambda ln: ln.startswith("COPY ") and ln.split()[1:-1] == ["catalog_search.py"])
    gz = idx(lambda ln: ln.startswith("COPY ") and "catalog/" in ln)
    build = flat.index(run)
    app = idx(lambda ln: ln.startswith("COPY ") and "app.py" in ln.split())
    arg = idx(lambda ln: ln.startswith("ARG GIT_SHA"))
    assert pip < cs < gz < build < app < arg, (pip, cs, gz, build, app, arg)
    assert "catalog_search.py" not in flat[app].split(), "catalog_search.py chỉ COPY một lần (lớp danh mục)"


def test_sha256_lech_thi_bat_duoc():
    """Chuỗi mẫu sai: đổi 1 ký tự sha ở Dockerfile → _dockerfile_sha ra số khác số thật (test chính bắt được)."""
    src = _dockerfile()
    rel, dest = _catalog_copy(src)
    real = hashlib.sha256((SERVER / rel).read_bytes()).hexdigest()
    bad = src.replace(real, ("0" if real[0] != "0" else "1") + real[1:])
    assert _dockerfile_sha(bad, dest) and _dockerfile_sha(bad, dest)[0] != real
    # thiếu "-c" / sai đích thì không nhận
    assert _dockerfile_sha(src.replace("sha256sum -c -", "sha256sum -"), dest) == []
    assert _dockerfile_sha(src, "/tmp/khac.jsonl.gz") == []


def test_dockerignore_khong_loai_danh_muc():
    pats = [ln.strip() for ln in (SERVER / ".dockerignore").read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.startswith("#")]
    for p in pats:
        assert not fnmatch.fnmatch("catalog/c.jsonl.gz", p.rstrip("/")) and not p.startswith("catalog"), p
    for must in ("do_khop_t1.py", "do_h2h3.py"):
        assert must in pats


def test_dockerignore_khong_lot_tests_env():
    lines = [ln.strip() for ln in (SERVER / ".dockerignore").read_text(encoding="utf-8").splitlines()]
    for must in ("tests/", ".env", ".env.*", "__pycache__/", ".venv/", "venv/"):
        assert must in lines
    assert "!.env.example" in lines  # chỉ file mẫu (không bí mật); Dockerfile không COPY nó


def test_requirements_chi_chu_ascii():
    for name in ("requirements.txt", "requirements-dev.txt"):
        data = (SERVER / name).read_bytes()
        assert max(data) < 128, f"{name} có byte > 127 (pip trên Windows đọc cp1252)"


# --- kho nhóm (đợt kho-nhom vòng 4) ---------------------------------------------------------------------------------
def test_clip_tai_luc_build_dung_nguon_va_sha256_cua_clip_engine():
    """Dockerfile tải model CLIP từ ĐÚNG MODEL_URL, kiểm ĐÚNG MODEL_SHA256 của clip_engine.py bằng sha256sum -c (nối &&,
    trước chmod), ENV CLIP_MODEL_PATH trỏ đúng file đó; lớp tải đứng sau pip install và trước COPY mã máy chủ."""
    import clip_engine

    src = _dockerfile()
    flat = re.sub(r"\\\n", " ", src).splitlines()
    run = [ln for ln in flat if ln.startswith("RUN ") and "vision_model_quantized.onnx" in ln and "urlretrieve" in ln]
    assert len(run) == 1, run
    run = run[0]
    dest = _env(src)["CLIP_MODEL_PATH"]
    assert dest == "/app/models/clip/vision_model_quantized.onnx"
    assert f"urlretrieve('{clip_engine.MODEL_URL}', '{dest}')" in run
    i_get, i_sum = run.find("urlretrieve"), run.find(f'echo "{clip_engine.MODEL_SHA256}  {dest}" | sha256sum -c -')
    i_chmod = run.find("chmod -R a+rX /app/models")
    assert 0 <= i_get < i_sum < i_chmod, (i_get, i_sum, i_chmod)
    assert "&&" in run[i_get:i_sum] and "&&" in run[i_sum:i_chmod]
    assert clip_engine.MODEL_URL.startswith("https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/")
    assert clip_engine.MODEL_INFO["revision"] in clip_engine.MODEL_URL
    idx = lambda pred: next(i for i, ln in enumerate(flat) if pred(ln))  # noqa: E731
    pip = idx(lambda ln: ln.startswith("RUN ") and "pip install" in ln)
    clip = flat.index(run)
    app = idx(lambda ln: ln.startswith("COPY ") and "app.py" in ln.split())
    assert pip < clip < app
    lines = src.splitlines()
    user = next(i for i, ln in enumerate(lines) if ln.strip() == "USER ocr")
    assert any("ClipEngine(os.environ['CLIP_MODEL_PATH'])" in ln for ln in lines[user:]), "người dùng ocr phải nạp thử CLIP"


def test_khoa_ky_kho_nhom_khong_bao_gio_o_dockerfile():
    src = _dockerfile()
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    assert "KHO_NHOM_HMAC_KEY" not in code and "KHO_NHOM_HMAC_KEY" not in _env(src)
    assert "NHOM_SONG_SONG" not in _env(src)  # mặc định nối tiếp (settings), không ghi đè trong ảnh


def test_dockerignore_bo_khung_do_kho_nhom():
    pats = [ln.strip() for ln in (SERVER / ".dockerignore").read_text(encoding="utf-8").splitlines()]
    assert "do_kho_nhom.py" in pats
