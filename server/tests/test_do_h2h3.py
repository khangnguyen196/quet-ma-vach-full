"""Phần thuần của do_h2h3.py (đợt kho-lon vòng 3, P3): đọc dòng log /ocr, p95 nearest rank, H2 = max(wset, riêng).
Dòng log lấy từ CHÍNH app.py (caplog) để đổi định dạng log thì test này đỏ."""
from __future__ import annotations

import json
import logging
import subprocess

from fastapi.testclient import TestClient

import app as app_module
import do_h2h3
from conftest import SERVER, jpeg_bytes, make_settings, multipart
from test_candidates import MINI, ItemsEngine, _gold


def test_p95_nearest_rank_30_anh():
    xs = list(range(30, 0, -1))  # 30..1
    assert do_h2h3.p95(xs) == 29  # phần tử thứ ceil(0,95 × 30) = 29
    assert do_h2h3.p95([5.0]) == 5.0 and do_h2h3.p95([]) is None


def test_h2_la_so_lon_hon():
    assert do_h2h3.h2_of({"peakWsetMB": 700.0, "peakPrivateMB": 900.5}) == 900.5
    assert do_h2h3.h2_of({"peakWsetMB": 1000.0, "peakPrivateMB": 900.5}) == 1000.0
    assert do_h2h3.h2_of({"peakWsetMB": None, "peakPrivateMB": None}) is None


def test_doc_dong_log_that_cua_app(monkeypatch, caplog):
    monkeypatch.setenv("CATALOG_PATH", str(MINI))
    app = app_module.create_app(make_settings(), engine=ItemsEngine(_gold("7up-may")["items"]))
    body, ctype = multipart([("image", "a.jpg", jpeg_bytes())])
    with caplog.at_level(logging.INFO, logger="ocr_server"), TestClient(app) as c:
        c.post("/ocr", content=body, headers={"content-type": ctype})
        c.post("/ocr", content=b"x", headers={"content-type": "text/plain"})
    rows = do_h2h3.parse_ocr_log("\n".join(r.getMessage() for r in caplog.records))
    assert len(rows) == 2
    assert rows[0][0] == 200 and isinstance(rows[0][1], float)
    assert rows[1] == (400, None)


def test_pick_level_goi_dung_ham_node():
    """Cách "chon" gọi pickLevel của kho-lon-do.mjs qua node: kiểm cách truyền tham số (số giả)."""
    levels = [{"name": L, "method": "G1", "h4": True, "h2": L != "c", "h3": True} for L in "abc"]
    # argv[1] = mức (JSON), argv[2] = đường dẫn module: argv[1] KHÔNG được là kho-lon-do.mjs (khối main của nó sẽ chạy)
    js = ("import { pathToFileURL } from 'node:url';"
          "const m = await import(pathToFileURL(process.argv[2]).href);"
          "console.log(JSON.stringify(m.pickLevel(JSON.parse(process.argv[1]))));")
    p = subprocess.run(["node", "--input-type=module", "-e", js, "--", json.dumps(levels),
                        str(SERVER.parent / "test-ocr" / "chup-mat-do" / "kho-lon-do.mjs")],
                       capture_output=True, text=True, encoding="utf-8", check=True)
    assert json.loads(p.stdout.strip().splitlines()[-1]) == {"level": "b", "stop": False, "provisional": False}
