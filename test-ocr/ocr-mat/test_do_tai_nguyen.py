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


def test_main_chan_thu_muc_da_co_file_cu(tmp_path, capsys):
    """Thư mục OCR đã có *__front.json của lần chạy cũ -> báo lỗi, thoát mã 2, KHÔNG chạy lệnh OCR."""
    ocr = tmp_path / "ocr"
    ocr.mkdir()
    (ocr / "cu__front.json").write_text(json.dumps({"order": 0, "seconds": 1.0, "status": "ok"}), encoding="utf-8")
    dau = tmp_path / "da-chay.txt"
    script = "import pathlib,sys;pathlib.Path(sys.argv[1]).write_text('x')"
    code = main(["--name", "cu", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--", sys.executable, "-c", script, str(dau)])
    assert code == 2
    assert not dau.exists()  # lệnh OCR không được chạy
    assert not (tmp_path / "cu-tai-nguyen.json").exists()
    err = capsys.readouterr().err
    assert "1 file" in err and "thư mục mới" in err


def test_doc_ket_qua_bo_file_cu_hon_t0(tmp_path):
    """Lớp thứ hai: khi đọc kết quả chỉ nhận file có giờ sửa >= t0 (file cũ lọt vào giữa chừng không được tính)."""
    import os

    from do_tai_nguyen import read_entries

    cu = tmp_path / "cu__front.json"
    cu.write_text(json.dumps({"order": 0, "seconds": 1.0}), encoding="utf-8")
    os.utime(cu, (1_000_000, 1_000_000))
    moi = tmp_path / "moi__front.json"
    moi.write_text(json.dumps({"order": 1, "seconds": 2.0}), encoding="utf-8")
    t0 = moi.stat().st_mtime - 1
    entries = read_entries(tmp_path, t0)
    assert [j["seconds"] for _, j in entries] == [2.0]


def test_main_lenh_con_thoat_ngay(tmp_path, monkeypatch):
    """Lệnh con thoát trước khi psutil kịp mở (NoSuchProcess) -> script không lỗi, vẫn ghi kết quả."""
    import psutil

    def khong_co(pid):
        raise psutil.NoSuchProcess(pid)

    monkeypatch.setattr(psutil, "Process", khong_co)
    ocr = tmp_path / "ocr"
    code = main(["--name", "nhanh", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--", sys.executable, "-c", "pass"])
    assert code == 3  # vòng 3: không có ảnh nào -> mã 3 (xem test_main_khong_anh_nao_thoat_3)
    r = json.loads((tmp_path / "nhanh-tai-nguyen.json").read_text(encoding="utf-8"))
    assert r["images"] == 0
    assert r["exitCode"] == 0


def test_main_thoat_giua_chung_kill_tien_trinh_con(tmp_path, monkeypatch):
    """Ctrl+C (KeyboardInterrupt) giữa vòng lấy mẫu -> tiến trình con bị kill, không chạy nền."""
    import subprocess

    import do_tai_nguyen

    tao = []
    goc = subprocess.Popen

    def popen(*a, **k):
        p = goc(*a, **k)
        tao.append(p)
        return p

    def ngat(_):
        raise KeyboardInterrupt

    monkeypatch.setattr(do_tai_nguyen.subprocess, "Popen", popen)
    # vá hàm _sleep riêng của do_tai_nguyen (không vá time.sleep của cả tiến trình test)
    monkeypatch.setattr(do_tai_nguyen, "_sleep", ngat)
    ocr = tmp_path / "ocr"
    try:
        main(["--name", "ngat", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--", sys.executable, "-c", "import time; time.sleep(60)"])
        raise AssertionError("phải ném KeyboardInterrupt")
    except KeyboardInterrupt:
        pass
    assert len(tao) == 1
    assert tao[0].wait(timeout=10) is not None  # đã thoát (bị kill), không còn chạy nền


# ---------------- vòng 3 (P1.1): chặn kết quả lặng lẽ sai / bị ghi đè ----------------

GHI_1_FILE = (
    "import json,sys,pathlib;d=pathlib.Path(sys.argv[1]);d.mkdir(parents=True,exist_ok=True);"
    "(d/'a__front.json').write_text(json.dumps({'order':0,'seconds':1.0,'status':'ok'}))"
)


def test_main_khong_anh_nao_thoat_3(tmp_path, capsys):
    """(a) Lệnh OCR chạy xong mà không ghi ảnh nào (images == 0) -> báo lỗi tiếng Việt, mã 3, vẫn ghi file tài nguyên."""
    ocr = tmp_path / "ocr"
    code = main(["--name", "rong", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--", sys.executable, "-c", "pass"])
    assert code == 3
    r = json.loads((tmp_path / "rong-tai-nguyen.json").read_text(encoding="utf-8"))
    assert r["images"] == 0
    assert "không có ảnh nào" in capsys.readouterr().err


def test_main_chan_ghi_de_file_tai_nguyen(tmp_path, capsys):
    """(b) <out>/<name>-tai-nguyen.json đã có -> mã 2, KHÔNG chạy lệnh OCR, file cũ giữ nguyên."""
    ocr = tmp_path / "ocr"
    cu = tmp_path / "trung-tai-nguyen.json"
    cu.write_text('{"cu": true}', encoding="utf-8")
    code = main(["--name", "trung", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--", sys.executable, "-c", GHI_1_FILE, str(ocr)])
    assert code == 2
    assert not (ocr / "a__front.json").exists()  # lệnh OCR không được chạy
    assert cu.read_text(encoding="utf-8") == '{"cu": true}'
    assert "--ghi-de" in capsys.readouterr().err


def test_main_ghi_de_co_chu_y(tmp_path):
    """(b) Có cờ --ghi-de -> chạy và ghi đè file tài nguyên cũ."""
    ocr = tmp_path / "ocr"
    cu = tmp_path / "trung-tai-nguyen.json"
    cu.write_text('{"cu": true}', encoding="utf-8")
    code = main(["--name", "trung", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--ghi-de", "--",
                 sys.executable, "-c", GHI_1_FILE, str(ocr)])
    assert code == 0
    r = json.loads(cu.read_text(encoding="utf-8"))
    assert r["images"] == 1


def test_main_chan_out_cua_lenh_con_khac_ocr_dir(tmp_path, capsys):
    """(c) Lệnh con có --out <x> mà x khác --ocr-dir -> mã 2, không chạy (kết quả sẽ không được đọc)."""
    ocr = tmp_path / "ocr"
    khac = tmp_path / "khac"
    dau = tmp_path / "da-chay.txt"
    script = "import pathlib,sys;pathlib.Path(sys.argv[1]).write_text('x')"
    for out_args in (["--out", str(khac)], [f"--out={khac}"]):
        code = main(["--name", "lech", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--",
                     sys.executable, "-c", script, str(dau), *out_args])
        assert code == 2
        assert not dau.exists()
        assert not (tmp_path / "lech-tai-nguyen.json").exists()
        assert "--ocr-dir" in capsys.readouterr().err


def test_main_out_cua_lenh_con_trung_ocr_dir_sau_chuan_hoa(tmp_path):
    """(c) --out của lệnh con viết khác dạng (thêm '/./', dấu / cuối) nhưng cùng thư mục -> chạy bình thường."""
    ocr = tmp_path / "ocr"
    viet_khac = str(tmp_path) + "/./ocr/"
    code = main(["--name", "khop", "--ocr-dir", str(ocr), "--out", str(tmp_path), "--",
                 sys.executable, "-c", GHI_1_FILE, str(ocr), "--out", viet_khac])
    assert code == 0
    assert json.loads((tmp_path / "khop-tai-nguyen.json").read_text(encoding="utf-8"))["images"] == 1
