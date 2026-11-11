"""Test các hàm thuần của chay_ocr.py (không chạy OCR, không mạng, không cần thư viện OCR)."""
import json

from chay_ocr import fit_size, keys_from_yml, main, make_item, norm_conf, poly_to_box, rel_box_to_points, round_half_up, sample_codes


def test_fit_size_thu_canh_dai_ve_1600_nhu_harness():
    assert fit_size(4000, 3000) == (1600, 1200)
    assert fit_size(3000, 4000) == (1200, 1600)
    assert fit_size(1000, 800) == (1000, 800)  # chỉ thu nhỏ, không phóng to
    assert fit_size(1600, 1600) == (1600, 1600)
    # làm tròn 0,5 lên như Math.round (Python round(2.5) = 2)
    assert fit_size(3200, 5) == (1600, 3)
    assert round_half_up(2.5) == 3 and round_half_up(2.4) == 2
    assert fit_size(100000, 1) == (1600, 1)  # ít nhất 1 px


def test_poly_to_box():
    assert poly_to_box([[10, 20], [110, 18], [112, 60], [8, 62]]) == {"minX": 8.0, "minY": 18.0, "maxX": 112.0, "maxY": 62.0}
    assert poly_to_box([]) is None
    assert poly_to_box(None) is None
    assert poly_to_box([["a", 1]]) is None


def test_norm_conf():
    assert norm_conf(0.93) == 0.93
    assert norm_conf(91, 100.0) == 0.91
    assert norm_conf("87.5", 100.0) == 0.875
    assert norm_conf(-1, 100.0) is None  # tesseract: -1 = không phải từ
    assert norm_conf(None) is None
    assert norm_conf("x") is None
    assert norm_conf(float("nan")) is None


def test_make_item():
    it = make_item(" VISSAN ", 95, [[0, 0], [10, 0], [10, 5], [0, 5]], scale=100.0)
    assert it == {"text": "VISSAN", "conf": 0.95, "box": {"minX": 0.0, "minY": 0.0, "maxX": 10.0, "maxY": 5.0}}
    assert make_item("   ", 0.9, [[0, 0], [1, 1]]) is None
    assert make_item("A", 0.9, []) is None
    assert make_item("A", None, [[0, 0], [1, 1]])["conf"] is None


def test_rel_box_to_points():
    pts = rel_box_to_points(((0.1, 0.2), (0.5, 0.4)), 1000, 500)
    assert poly_to_box(pts) == {"minX": 100.0, "minY": 100.0, "maxX": 500.0, "maxY": 200.0}


def test_keys_from_yml_giu_ky_tu_dac_biet():
    yml = "PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - '0'\n  - a\n  - ''''\n  - '\"'\n  - ơ\n  - ' '\n"
    assert keys_from_yml(yml) == ["0", "a", "'", '"', "ơ", " "]


def test_sample_codes_giu_thu_tu_truth():
    rows = [{"code": "3"}, {"code": "1"}, {"code": "2"}]
    assert sample_codes(rows, lambda c: c != "1") == ["3", "2"]


def test_main_chan_thu_muc_cu(tmp_path, capsys):
    (tmp_path / "x__front.json").write_text(json.dumps({"status": "ok"}), encoding="utf-8")
    assert main(["--model", "r1", "--out", str(tmp_path)]) == 2
    assert "thư mục mới" in capsys.readouterr().err
