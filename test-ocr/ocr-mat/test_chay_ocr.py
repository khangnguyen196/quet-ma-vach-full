"""Test các hàm thuần của chay_ocr.py (không chạy OCR, không mạng, không cần thư viện OCR)."""
import json
import sys

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


# ---------------- vòng 3 (P1.3, P1.4) ----------------

def test_tesseract_items_bo_han_tu_do_tin_am_1():
    """Từ có độ tin -1 (Tesseract: không phải từ) BỎ hẳn, không giữ với conf null; chỉ mức từ (level 5)."""
    from chay_ocr import tesseract_items

    d = {
        "level": [4, 5, 5, 5, 5, "5"],
        "text": ["", "VISSAN", "rác", "  ", "Xúc", "xích"],
        "conf": [-1, 96, -1, 90, "-1", "88.5"],
        "left": [0, 1, 2, 3, 4, 5],
        "top": [0, 0, 0, 0, 0, 0],
        "width": [10, 10, 10, 10, 10, 10],
        "height": [5, 5, 5, 5, 5, 5],
    }
    items = tesseract_items(d)
    assert [it["text"] for it in items] == ["VISSAN", "xích"]
    assert [it["conf"] for it in items] == [0.96, 0.885]
    assert all(it["conf"] is not None for it in items)


class _Arr(list):
    def tolist(self):
        return list(self)


class _Out:
    def __init__(self, **k):
        self.__dict__.update(k)


def test_rapid_items_ket_qua_rong_va_binh_thuong():
    from chay_ocr import rapid_items

    assert rapid_items(_Out(boxes=None, txts=None, scores=None)) == []  # RapidOCROutput() rỗng: ảnh không có chữ
    det_only = rapid_items(_Out(boxes=_Arr([[[0, 0], [1, 0], [1, 1], [0, 1]]]), scores=(0.9,)))  # TextDetOutput, không txts
    assert det_only["items"] == [] and "canhBao" in det_only
    ok = rapid_items(_Out(boxes=_Arr([[[0, 0], [4, 0], [4, 2], [0, 2]]]), txts=("Omachi",), scores=(0.97,)))
    assert ok == [{"text": "Omachi", "conf": 0.97, "box": {"minX": 0.0, "minY": 0.0, "maxX": 4.0, "maxY": 2.0}}]


def test_main_loi_co_chu_empty_khong_bi_nuot(tmp_path, monkeypatch):
    """Lỗi thật (kể cả câu lỗi có chữ "empty") không bị coi là ảnh không có chữ: ghi status "loi" + câu lỗi thật."""
    import chay_ocr

    code = "8936017368111"
    photos = tmp_path / "photos"
    (photos / code).mkdir(parents=True)
    (photos / code / "front.jpg").write_bytes(b"x")

    class _Img:
        size = (10, 20)

    class _Engine:  # RapidOCR giả: ném lỗi có chữ "empty" (vd lỗi nội bộ), không phải kết quả rỗng
        def __init__(self, params):
            pass

        def __call__(self, _img):
            raise RuntimeError("The text recognize result is empty")

    import types

    monkeypatch.setitem(sys.modules, "rapidocr", types.SimpleNamespace(RapidOCR=_Engine))
    monkeypatch.setattr(chay_ocr, "load_image", lambda p: _Img())
    out = tmp_path / "ocr"
    assert chay_ocr.main(["--model", "r1", "--out", str(out), "--photos", str(photos)]) == 0
    rec = json.loads((out / f"{code}__front.json").read_text(encoding="utf-8"))
    assert rec["status"] == "loi"
    assert "result is empty" in rec["error"]
    assert "items" not in rec


def test_rapid_adapter_r1_nocls_tat_cls(monkeypatch):
    """r1-nocls: chỉ khác r1 ở Global.use_cls false (model mặc định của gói, không đổi Det / Rec)."""
    import types

    import chay_ocr

    seen = {}

    class _Engine:
        def __init__(self, params):
            seen[len(seen)] = dict(params)

    monkeypatch.setitem(sys.modules, "rapidocr", types.SimpleNamespace(RapidOCR=_Engine))
    chay_ocr.ADAPTERS["r1"](8)
    chay_ocr.ADAPTERS["r1-nocls"](8)
    r1, nocls = seen[0], seen[1]
    assert "Global.use_cls" not in r1
    assert nocls.pop("Global.use_cls") is False
    assert nocls == r1
