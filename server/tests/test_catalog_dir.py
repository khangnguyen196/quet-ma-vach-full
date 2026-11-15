"""Chỉ mục dựng sẵn ra THƯ MỤC + nạp bằng mmap (đợt kho-lon vòng 3, P1).

build_index_dir(danh mục .jsonl.gz, thư mục) ghi mảng numpy (.npy) + meta JSON + dòng thô; CatalogIndex.load_dir(thư mục)
nạp bằng np.load(mmap_mode="r") + mmap. Kết quả tìm phải TRÙNG bản dựng trong RAM (CatalogIndex.load) và file vàng của T1
JS (mã, chỉ số, thứ tự; điểm lệch tương đối <= 1e-9).
"""
from __future__ import annotations

import gc
import gzip
import hashlib
import json
import math
import shutil
from pathlib import Path

import numpy as np
import pytest

import catalog_search as cs

FIX = Path(__file__).resolve().parent / "fixtures"
MINI = FIX / "catalog-mini.jsonl.gz"
GOLD = json.loads((FIX / "t1-golden.json").read_text(encoding="utf-8"))
REL_TOL = 1e-9


def _lines(q):
    return cs.row_line_info(q["items"]) if "items" in q else cs.lines_from_text(q.get("text"))


def _release(*cats):
    """Windows: phải đóng mmap / bỏ mọi tham chiếu mảng trước khi xóa thư mục."""
    for c in cats:
        if c is not None:
            c.close()
    gc.collect()


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("chi-muc") / "mini"
    meta = cs.build_index_dir(MINI, out)
    yield out, meta
    gc.collect()
    shutil.rmtree(out, ignore_errors=False)


@pytest.fixture(scope="module")
def pair(built):
    ram = cs.CatalogIndex.load(MINI)
    disk = cs.CatalogIndex.load_dir(built[0])
    yield ram, disk
    _release(disk)


def test_thu_muc_co_du_file_va_meta(built):
    out, meta = built
    for name in cs.INDEX_ARRAYS:
        assert (out / f"{name}.npy").is_file(), name
    assert (out / cs.INDEX_META).is_file() and (out / cs.INDEX_LINES).is_file()
    m = json.loads((out / cs.INDEX_META).read_text(encoding="utf-8"))
    assert m == meta
    assert m["format"] == cs.INDEX_FORMAT
    assert m["N"] == GOLD["meta"]["n"] and len(m["vocab"]) == GOLD["meta"]["vocab"]
    assert m["k1"] == cs.BM25_K1 and m["b"] == cs.BM25_B
    assert m["sha256Source"] == hashlib.sha256(MINI.read_bytes()).hexdigest()
    raw = gzip.decompress(MINI.read_bytes())
    assert (out / cs.INDEX_LINES).read_bytes() == raw, "dòng thô = bản chưa nén của nguồn"
    assert m["sha256Raw"] == hashlib.sha256(raw).hexdigest()


def test_mang_nap_bang_mmap(pair):
    _, disk = pair
    for name in ("indices", "tf", "indptr", "idf", "lens", "starts", "ends"):
        arr = getattr(disk, name if name not in ("starts", "ends") else f"_{name}")
        assert isinstance(arr, np.memmap), f"{name} phải là mmap (không chép vào RAM)"
    assert disk.mmapped is True


def test_chi_so_trung_ban_ram(pair):
    ram, disk = pair
    assert disk.N == ram.N and disk.vocab == ram.vocab and disk.alias_df == ram.alias_df
    assert disk.avgdl == ram.avgdl and disk.postings == ram.postings
    for name in ("indices", "tf", "indptr", "idf", "lens"):
        assert np.array_equal(np.asarray(getattr(disk, name)), getattr(ram, name)), name
    assert np.array_equal(np.asarray(disk._starts), ram._starts) and np.array_equal(np.asarray(disk._ends), ram._ends)


@pytest.mark.parametrize("q", GOLD["queries"], ids=[q["id"] for q in GOLD["queries"]])
def test_load_dir_trung_ram_va_file_vang(pair, q):
    ram, disk = pair
    k = GOLD["meta"]["k"]
    rd = disk.rank_lines(_lines(q), k)
    rr = ram.rank_lines(_lines(q), k)
    assert rd["query"] == rr["query"] == q["query"]
    got = [(disk.row(i)["code"], i) for i, _ in rd["hits"]]
    assert got == [(ram.row(i)["code"], i) for i, _ in rr["hits"]], "load_dir khác bản dựng trong RAM"
    assert got == [(h["code"], h["i"]) for h in q["hits"]], "load_dir khác file vàng"
    for (i, s), (_, s2), h in zip(rd["hits"], rr["hits"], q["hits"]):
        assert math.isclose(s, s2, rel_tol=REL_TOL, abs_tol=0.0)
        assert math.isclose(s, h["score"], rel_tol=REL_TOL, abs_tol=0.0)


def test_search_tra_cung_dang(pair):
    ram, disk = pair
    q = next(x for x in GOLD["queries"] if x["id"] == "7up-may")
    assert disk.search(q["items"]) == ram.search(q["items"])
    assert disk.search([]) == [] and disk.search_text("") == []


def test_load_nhan_ca_thu_muc(built):
    cat = cs.CatalogIndex.load(built[0])
    try:
        assert cat.mmapped and cat.N == GOLD["meta"]["n"]
    finally:
        _release(cat)


def test_row_none_thanh_chuoi_rong(tmp_path):
    src = tmp_path / "x.jsonl"
    src.write_text(json.dumps({"code": "8930000000001", "name": "Ca phe sua", "brand": None, "img": None,
                               "text": "Ca phe sua", "grp": "vn"}) + "\n", encoding="utf-8")
    ram = cs.CatalogIndex.load(src)
    assert ram.row(0) == {"code": "8930000000001", "name": "Ca phe sua", "brand": "", "img": "", "text": "Ca phe sua",
                          "grp": "vn"}
    out = tmp_path / "idx"
    cs.build_index_dir(src, out)
    disk = cs.CatalogIndex.load_dir(out)
    try:
        assert disk.row(0) == ram.row(0)
        assert disk.search_text("ca phe")[0]["brand"] == ""
    finally:
        _release(disk)
    shutil.rmtree(out)  # Windows: xóa được sau khi đóng


def test_verify_dung_va_sai(built, tmp_path):
    out, _ = built
    assert cs.verify_index_dir(out, MINI) == []
    # nguồn khác (thiếu 1 dòng) -> sai N và sai sha256
    raw = gzip.decompress(MINI.read_bytes()).split(b"\n")
    other = tmp_path / "khac.jsonl"
    other.write_bytes(b"\n".join(raw[1:]))
    probs = cs.verify_index_dir(out, other)
    assert any("N" in p for p in probs) and any("sha256" in p for p in probs)


def test_lenh_build_va_verify(tmp_path):
    out = tmp_path / "cli"
    assert cs.main(["build", str(MINI), str(out)]) == 0
    assert cs.main(["verify", str(out), str(MINI)]) == 0
    other = tmp_path / "khac.jsonl"
    other.write_bytes(gzip.decompress(MINI.read_bytes()).split(b"\n", 1)[1])
    assert cs.main(["verify", str(out), str(other)]) == 1
    gc.collect()


def _files_bytes(d: Path) -> dict:
    return {p.relative_to(d).as_posix(): p.read_bytes() for p in sorted(d.rglob("*")) if p.is_file()}


def test_dung_2_lan_trung_tung_byte(tmp_path):
    """Kho-lon vòng 4 (gợi ý 6 vòng 3): dựng chỉ mục 2 lần từ cùng nguồn → cùng danh sách file, trùng từng byte mọi file
    (ảnh Docker dựng lại ra cùng chỉ mục; meta không chứa giờ / đường dẫn máy)."""
    one, two = tmp_path / "lan1", tmp_path / "lan2"
    m1 = cs.build_index_dir(MINI, one)
    m2 = cs.build_index_dir(MINI, two)
    assert m1 == m2
    f1, f2 = _files_bytes(one), _files_bytes(two)
    assert sorted(f1) == sorted(f2) and len(f1) >= len(cs.INDEX_ARRAYS) + 2
    diff = [name for name in f1 if f1[name] != f2[name]]
    assert diff == [], f"khác byte: {diff}"
    gc.collect()


def test_mang_sai_thi_lech(tmp_path):
    """Đổi 1 mảng trong thư mục (lens sai) -> kết quả khác file vàng: chứng minh test so thật, không so chính nó."""
    out = tmp_path / "sai"
    cs.build_index_dir(MINI, out)
    lens = np.load(out / "lens.npy")
    np.save(out / "lens.npy", lens + 3.0)
    disk = cs.CatalogIndex.load_dir(out)
    try:
        bad = 0
        for q in GOLD["queries"]:
            r = disk.rank_lines(_lines(q), GOLD["meta"]["k"])
            if [s for _, s in r["hits"]] != pytest.approx([h["score"] for h in q["hits"]], rel=REL_TOL):
                bad += 1
        assert bad > 0
    finally:
        _release(disk)


def test_thu_muc_rong_hoac_thieu_file_bao_loi(tmp_path):
    with pytest.raises(FileNotFoundError):
        cs.CatalogIndex.load_dir(tmp_path / "khong-co")
    out = tmp_path / "thieu"
    cs.build_index_dir(MINI, out)
    (out / "idf.npy").unlink()
    with pytest.raises(FileNotFoundError):
        cs.CatalogIndex.load_dir(out)
    gc.collect()


def test_meta_format_la_bao_loi(tmp_path):
    out = tmp_path / "fmt"
    cs.build_index_dir(MINI, out)
    m = json.loads((out / cs.INDEX_META).read_text(encoding="utf-8"))
    m["format"] = 999
    (out / cs.INDEX_META).write_text(json.dumps(m), encoding="utf-8")
    with pytest.raises(ValueError):
        cs.CatalogIndex.load_dir(out)
    gc.collect()
