"""Đọc workflow .github/workflows/server-image.yml (đợt may-chu-2 vòng 2): máy không có Docker nên workflow chỉ chạy
thật trên CI; ở đây kiểm cấu hình bằng đọc YAML."""
from __future__ import annotations

import yaml

from conftest import SERVER

WORKFLOW = SERVER.parent / ".github" / "workflows" / "server-image.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_moi_khoi_run_chay_bang_bash_co_pipefail():
    # shell: bash -> GitHub chạy "bash --noprofile --norc -eo pipefail {0}": "docker push … | tee" hỏng thì bước đỏ.
    # Không khai shell thì GitHub chạy "bash -e {0}" (không pipefail): push hỏng mà bước vẫn xanh.
    wf = _workflow()
    assert wf.get("defaults", {}).get("run", {}).get("shell") == "bash"
    for job in wf["jobs"].values():
        for step in job["steps"]:
            # không bước nào tự đổi shell (đổi thì mất pipefail của mặc định)
            assert "shell" not in step, step.get("name")
