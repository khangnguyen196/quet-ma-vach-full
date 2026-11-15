"""/ocr + danh mục ứng viên sau cờ CATALOG_PATH (đợt kho-lon vòng 2, P4). Engine giả, danh mục mini của file vàng."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi.testclient import TestClient

import app as app_module
import catalog_search
from conftest import FAKE_TEXT, jpeg_bytes, make_settings, multipart

FIX = Path(__file__).resolve().parent / "fixtures"
MINI = FIX / "catalog-mini.jsonl.gz"
GOLD = json.loads((FIX / "t1-golden.json").read_text(encoding="utf-8"))
OLD_KEYS = {"items", "width", "height", "origWidth", "origHeight", "ms", "msOcr", "engine"}
CAND_KEYS = {"code", "name", "brand", "img", "text", "grp", "score"}


class ItemsEngine:
    """Engine giả trả đúng khung chữ của một câu vàng."""

    info = {"name": "fake"}

    def __init__(self, items):
        self.loaded = True
        self.items = items

    def run(self, img):
        return [dict(it) for it in self.items]


def _gold(qid):
    return next(q for q in GOLD["queries"] if q["id"] == qid)


def _post(client):
    body, ctype = multipart([("image", "anh.jpg", jpeg_bytes())])
    return client.post("/ocr", content=body, headers={"content-type": ctype})


def test_khong_bien_phan_hoi_y_het(monkeypatch):
    monkeypatch.delenv("CATALOG_PATH", raising=False)
    app = app_module.create_app(make_settings(), engine=ItemsEngine(_gold("7up-may")["items"]))
    with TestClient(app) as c:
        r = _post(c)
    assert r.status_code == 200
    assert set(r.json()) == OLD_KEYS, "không có CATALOG_PATH: không có khóa candidates"
    assert app.state.catalog is None


def test_bien_trong_cung_nhu_khong_co(monkeypatch):
    monkeypatch.setenv("CATALOG_PATH", "   ")
    app = app_module.create_app(make_settings(), engine=ItemsEngine([]))
    with TestClient(app) as c:
        assert set(_post(c).json()) == OLD_KEYS


def test_co_danh_muc_candidates_dung_thu_tu_file_vang(monkeypatch):
    monkeypatch.setenv("CATALOG_PATH", str(MINI))
    loads = []
    real = catalog_search.CatalogIndex.load.__func__

    def counting(cls, path, **kw):
        loads.append(path)
        return real(cls, path, **kw)

    monkeypatch.setattr(catalog_search.CatalogIndex, "load", classmethod(counting))
    for qid in ("7up-may", "muoi", "B-8934804025766"):
        q = _gold(qid)
        app = app_module.create_app(make_settings(), engine=ItemsEngine(q["items"]))
        with TestClient(app) as c:
            r1 = _post(c)
            r2 = _post(c)
        assert r1.status_code == 200 and r2.status_code == 200
        j = r1.json()
        assert set(j) == OLD_KEYS | {"candidates"}
        assert len(j["candidates"]) <= 10
        assert [x["code"] for x in j["candidates"]] == [h["code"] for h in q["hits"]], qid
        assert all(set(x) == CAND_KEYS for x in j["candidates"])
        for x, h in zip(j["candidates"], q["hits"]):
            assert abs(x["score"] - h["score"]) <= 1e-9 * abs(h["score"])
        assert r2.json()["candidates"] == j["candidates"]
    assert len(loads) == 3, "mỗi app (tiến trình) nạp danh mục đúng 1 lần, không nạp lại mỗi lượt /ocr"


def test_catalog_path_la_thu_muc_chi_muc_mmap(monkeypatch, tmp_path):
    """Vòng 3: CATALOG_PATH = thư mục do catalog_search.py build ghi -> nạp bằng mmap, candidates trùng file vàng."""
    out = tmp_path / "chi-muc"
    catalog_search.build_index_dir(MINI, out)
    monkeypatch.setenv("CATALOG_PATH", str(out))
    q = _gold("7up-may")
    app = app_module.create_app(make_settings(), engine=ItemsEngine(q["items"]))
    try:
        with TestClient(app) as c:
            j = _post(c).json()
        assert app.state.catalog.mmapped is True
        assert [x["code"] for x in j["candidates"]] == [h["code"] for h in q["hits"]]
    finally:
        if app.state.catalog is not None:
            app.state.catalog.close()


def test_khong_doc_duoc_chu_candidates_rong(monkeypatch):
    monkeypatch.setenv("CATALOG_PATH", str(MINI))
    app = app_module.create_app(make_settings(), engine=ItemsEngine(_gold("dung-rong-khung")["items"]))
    with TestClient(app) as c:
        j = _post(c).json()
    assert j["candidates"] == [] and j["items"] == []


def test_loi_tim_bo_khoa_candidates_van_200(caplog):
    class Broken:
        def search(self, items, k):
            raise ValueError(f"hỏng {items[0]['text']}")

    app = app_module.create_app(make_settings(), engine=_fake_engine(), catalog=Broken())
    with caplog.at_level(logging.INFO, logger="ocr_server"), TestClient(app) as c:
        r = _post(c)
    assert r.status_code == 200
    assert set(r.json()) == OLD_KEYS
    assert "lỗi khi tìm ứng viên: ValueError" in caplog.text
    assert FAKE_TEXT not in caplog.text, "log không có chữ OCR"


def test_nap_loi_ocr_van_chay(monkeypatch, caplog, tmp_path):
    monkeypatch.setenv("CATALOG_PATH", str(tmp_path / "khong-co.jsonl.gz"))
    app = app_module.create_app(make_settings(), engine=_fake_engine())
    with caplog.at_level(logging.INFO, logger="ocr_server"), TestClient(app) as c:
        r = _post(c)
    assert r.status_code == 200 and set(r.json()) == OLD_KEYS
    assert "KHÔNG nạp được danh mục" in caplog.text
    assert app.state.catalog is None


def test_attach_candidates_thuan():
    res = {"items": []}
    assert app_module.attach_candidates(None, res) is res and "candidates" not in res
    assert app_module.catalog_path_from_env({}) == ""
    assert app_module.catalog_path_from_env({"CATALOG_PATH": " D:/x.jsonl.gz "}) == "D:/x.jsonl.gz"
    assert app_module.load_catalog("") is None


def _fake_engine():
    from conftest import FakeEngine

    return FakeEngine()
