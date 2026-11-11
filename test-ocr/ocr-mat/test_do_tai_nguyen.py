"""Test các hàm thuần của do_tai_nguyen.py (không chạy OCR, không mạng)."""
import json
import sys

from do_tai_nguyen import Peak, median, order_rows, path_size, time_stats, tree_rss, main


def test_median():
    assert median([]) is None
    assert median([3, 1, 2]) == 2
    assert median([4, 1, 3, 2]) == 2.5
    assert median([None, 5]) == 5


def test_time_stats_bo_anh_dau_va_anh_loi():
    rows = [
        {"seconds": 30.0, "status": "ok"},  # ảnh đầu: chậm vì khởi động, không tính
        {"seconds": 2.0, "status": "ok"},
        {"seconds": 9.0, "status": "lỗi"},  # ảnh lỗi không tính giây
        {"seconds": 4.0},  # không ghi status = ok
        {"seconds": 3.0, "status": "ok"},
    ]
    s = time_stats(rows)
    assert s == {"first": 30.0, "n": 3, "median": 3.0, "max": 4.0}
    assert time_stats([]) == {"first": None, "n": 0, "median": None, "max": None}
    assert time_stats([{"seconds": 5.0}]) == {"first": 5.0, "n": 0, "median": None, "max": None}


def test_tree_rss_va_peak():
    assert tree_rss([100, None, 50]) == 150
    p = Peak()
    p.add([100, 200])  # tổng 300
    p.add([250, None])  # tiến trình con vừa thoát
    p.add([])
    assert p.total == 300
    assert p.proc == 250
    assert p.samples == 3


def test_path_size(tmp_path):
    (tmp_path / "a.onnx").write_bytes(b"x" * 10)
    sub = tmp_path / "thu-muc-con"  # không dùng "con": tên thiết bị dành riêng của Windows
    sub.mkdir()
    (sub / "b.bin").write_bytes(b"y" * 5)
    assert path_size(tmp_path / "a.onnx") == 10
    assert path_size(tmp_path) == 15
    assert path_size(tmp_path / "khong-co") == 0


def test_order_rows():
    e = [(3.0, {"code": "c", "order": 1}), (1.0, {"code": "a", "order": 2}), (2.0, {"code": "b", "order": 0})]
    assert [r["code"] for r in order_rows(e)] == ["b", "c", "a"]
    # thiếu order ở 1 file -> theo giờ sửa file
    e2 = [(3.0, {"code": "c"}), (1.0, {"code": "a", "order": 2})]
    assert [r["code"] for r in order_rows(e2)] == ["a", "c"]


def test_main_chay_lenh_that(tmp_path):
    """Chạy một lệnh Python nhỏ (ghi 3 file OCR giả) để kiểm cả luồng: lấy mẫu RSS, đọc file, ghi JSON."""
    ocr = tmp_path / "ocr"
    ocr.mkdir()
    script = (
        "import json,sys,time,pathlib;d=pathlib.Path(sys.argv[1]);"
        "[ (d/f'{i}__front.json').write_text(json.dumps({'order':i,'seconds':s,'status':'ok','loadSeconds':1.5})) or time.sleep(0.3)"
        " for i,s in enumerate([9.0,1.0,2.0]) ]"
    )
    code = main(["--name", "gia", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--interval", "2", "--", sys.executable, "-c", script, str(ocr)])
    assert code == 0
    r = json.loads((tmp_path / "gia-tai-nguyen.json").read_text(encoding="utf-8"))
    assert r["images"] == 3
    assert r["seconds"] == {"first": 9.0, "n": 2, "median": 1.5, "max": 2.0}
    assert r["loadSeconds"] == 1.5
    assert r["intervalSeconds"] == 0.5  # --interval bị chặn ở 0,5 giây
    assert r["rssSamples"] >= 1
    assert r["rssPeakTotalMB"] > 0
