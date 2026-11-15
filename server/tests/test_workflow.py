"""Đọc workflow .github/workflows/server-image.yml (đợt may-chu-2 vòng 2): máy không có Docker nên workflow chỉ chạy
thật trên CI; ở đây kiểm cấu hình bằng đọc YAML."""
from __future__ import annotations

import re

import yaml

from conftest import SERVER

WORKFLOW = SERVER.parent / ".github" / "workflows" / "server-image.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _steps() -> list:
    return [step for job in _workflow()["jobs"].values() for step in job["steps"]]


def test_moi_khoi_run_chay_bang_bash_co_pipefail():
    # shell: bash -> GitHub chạy "bash --noprofile --norc -eo pipefail {0}": "docker push … | tee" hỏng thì bước đỏ.
    # Không khai shell thì GitHub chạy "bash -e {0}" (không pipefail): push hỏng mà bước vẫn xanh.
    wf = _workflow()
    assert wf.get("defaults", {}).get("run", {}).get("shell") == "bash"
    for job in wf["jobs"].values():
        for step in job["steps"]:
            # không bước nào tự đổi shell (đổi thì mất pipefail của mặc định)
            assert "shell" not in step, step.get("name")


# --- Luật "ống | được phép hỏng phải có || true" (đợt cung-co vòng 2) ---------------------------------------------
# Với pipefail, lệnh hỏng ở bất kỳ đâu trong ống "a | b" làm bước đỏ. Ống nào được phép hỏng (theo comment trong
# workflow) phải ghi "|| true"; ống không được phép hỏng thì KHÔNG được có "|| true" (che lỗi). Mỗi ống trong workflow
# phải được phân loại ở đây (khóa = đầu dòng lệnh, sau khi bỏ khoảng trắng): ống mới chưa phân loại -> test đỏ, buộc
# người sửa workflow quyết định. Bước "if: failure()" / "always()" (in log, dọn dẹp) thì mọi ống đều được phép hỏng.
PIPES = {
    "docker push": False,       # đẩy ảnh: hỏng thì bước phải đỏ (tee không được che lỗi)
    "got=$(curl": False,        # so commit / catalog của /health: hỏng thì bước phải đỏ
    "n_want=$(gzip": False,     # số dòng danh mục trong repo (kho-lon vòng 3): hỏng thì bước phải đỏ
    "digest=$(grep": True,      # không tìm thấy digest thì vẫn xanh (ảnh đã đẩy xong)
}
_PIPE = re.compile(r"(?<!\|)\|(?!\|)")


def _command_lines(script: str) -> list:
    """Dòng lệnh của 1 khối run: nối dòng kết thúc bằng "\\", bỏ comment (# đầu dòng hoặc sau khoảng trắng), bỏ nội
    dung heredoc (<<'X' … X: là mã Python, không phải lệnh shell)."""
    out, buf, heredoc = [], "", None
    for raw in script.splitlines():
        if heredoc is not None:
            if raw.strip() == heredoc:
                heredoc = None
            continue
        line = re.sub(r"(^|\s)#.*$", "", raw).rstrip()
        if line.endswith("\\"):
            buf += line[:-1] + " "
            continue
        line, buf = (buf + line).strip(), ""
        # "<<" đứng riêng (không phải "<<<" here-string), tên bắt đầu bằng chữ / "_" (không phải "<<2" số học)
        m = re.search(r"(?<!<)<<(?!<)-?\s*['\"]?([A-Za-z_]\w*)['\"]?", line)
        if m:
            heredoc = m.group(1)
        if line:
            out.append(line)
    return out


def _pipe_lines() -> list:
    """[(tên bước, dòng lệnh, bước chỉ chạy khi hỏng / luôn chạy?)] cho mọi dòng có ống "|" (không tính "||")."""
    out = []
    for step in _steps():
        cleanup = bool(re.search(r"\b(failure|always)\(\)", str(step.get("if", ""))))
        for line in _command_lines(step.get("run", "")):
            if _PIPE.search(line):
                out.append((step.get("name"), line, cleanup))
    return out


def test_ong_duoc_phep_hong_phai_co_or_true():
    lines = _pipe_lines()
    assert lines, "workflow phải có ít nhất 1 ống (docker push | tee)"
    seen = set()
    for name, line, cleanup in lines:
        keys = [k for k in PIPES if line.startswith(k)]
        if cleanup:
            may_fail = True
        else:
            assert len(keys) == 1, f"bước {name!r}: ống chưa phân loại trong PIPES (được phép hỏng hay không?): {line}"
            may_fail = PIPES[keys[0]]
            seen.add(keys[0])
        if may_fail:
            assert "|| true" in line, f"bước {name!r}: ống được phép hỏng phải có '|| true': {line}"
        else:
            assert "|| true" not in line, f"bước {name!r}: ống KHÔNG được phép hỏng lại có '|| true' (che lỗi): {line}"
    assert seen == set(PIPES), f"PIPES có mục không còn trong workflow: {set(PIPES) - seen}"


def test_command_lines_bo_comment_heredoc_noi_dong():
    script = ("a | b  # comment | có ống\n"
              "# cả dòng comment | ống\n"
              "python3 - <<'PY'\nx = 1 | 2\nPY\n"
              "c \\\n  | d || true\n"
              "echo \"### tiêu đề\"\n"
              # "<<<" (here-string) và "<<" số học không mở heredoc: các dòng sau vẫn là lệnh (vòng 3)
              "cmd <<<\"$x\"\n"
              "e | f\n"
              "tr a b <<< abc\n"
              "i | j\n"
              "echo $((1<<2))\n"
              "g | h || true\n")
    got = [" ".join(line.split()) for line in _command_lines(script)]
    assert got == ["a | b", "python3 - <<'PY'", "c | d || true", 'echo "### tiêu đề"',
                   'cmd <<<"$x"', "e | f", "tr a b <<< abc", "i | j", "echo $((1<<2))", "g | h || true"]


# --- /health "commit" (đợt cung-co vòng 2) -------------------------------------------------------------------------
def _step(pred) -> tuple:
    steps = _steps()
    i = next(k for k, s in enumerate(steps) if pred(s))
    return i, steps[i]


def test_build_truyen_git_sha_7_ky_tu():
    _, build = _step(lambda s: "docker build" in s.get("run", ""))
    assert re.search(r'--build-arg\s+"?GIT_SHA="?\$\{GITHUB_SHA::7\}"?\s', build["run"]), build["run"]


def test_buoc_so_commit_cua_health_truoc_khi_day_anh():
    i, check = _step(lambda s: "/health" in s.get("run", "") and "commit" in s.get("run", "")
                     and "GITHUB_SHA::7" in s.get("run", ""))
    run = check["run"]
    assert "if" not in check, "bước so commit phải chạy trên MỌI nhánh"
    assert re.search(r'!=\s*"\$\{GITHUB_SHA::7\}"', run) and "exit 1" in run, run
    steps = _steps()
    build = next(k for k, s in enumerate(steps) if "docker build" in s.get("run", ""))
    push = next(k for k, s in enumerate(steps) if "docker push" in s.get("run", ""))
    assert build < i < push


# --- danh mục ứng viên (đợt kho-lon vòng 3) -------------------------------------------------------------------------
def test_buoc_kiem_catalog_sau_health_truoc_khi_day():
    i, check = _step(lambda s: "catalog" in s.get("run", "") and "/health" in s.get("run", "")
                     and "n_want" in s.get("run", ""))
    run = check["run"]
    assert "if" not in check, "bước kiểm catalog phải chạy trên MỌI nhánh"
    assert "gzip -dc server/catalog/*.jsonl.gz | grep -c ." in run
    assert '"True $n_want"' in run and "exit 1" in run and "CATALOG_N=" in run
    steps = _steps()
    health = next(k for k, s in enumerate(steps) if "STARTUP_SECONDS" in s.get("run", "") and "docker run -d" in s.get("run", ""))
    push = next(k for k, s in enumerate(steps) if "docker push" in s.get("run", ""))
    assert health < i < push


def test_chu_png_phai_co_candidates_la_danh_sach():
    _, step = _step(lambda s: "chu.png" in s.get("run", "") and "/ocr" in s.get("run", ""))
    assert 'j.get("candidates")' in step["run"] and "isinstance(cands, list)" in step["run"]


def test_anh_nang_40mp_sinh_trong_container_rieng_truoc_do_ram():
    i, step = _step(lambda s: "nang.jpg" in s.get("run", ""))
    run = step["run"]
    assert "docker run --rm" in run and "8000, 5000" in run and 'convert("CMYK")' in run and "progressive=True" in run
    assert "0x0112] = 6" in run and '[ "$code" = "200" ]' in run
    assert "secrets" not in run and "if" not in step
    ram = next(k for k, s in enumerate(_steps()) if "memory.peak" in s.get("run", ""))
    assert i < ram, "ảnh nặng phải gửi trước bước đọc memory.peak"


def test_summary_co_catalog_n_va_day_chi_tren_main():
    _, step = _step(lambda s: "memory.peak" in s.get("run", ""))
    for must in ("Cỡ ảnh", "memory.peak", "STARTUP_SECONDS", "CATALOG_N"):
        assert must in step["run"], must
    for s in _steps():
        if "docker push" in s.get("run", "") or "docker/login-action" in str(s.get("uses", "")):
            assert s.get("if") == "github.ref == 'refs/heads/main'", s.get("name")
    assert "secrets." not in WORKFLOW.read_text(encoding="utf-8").replace("secrets.GITHUB_TOKEN", "")
