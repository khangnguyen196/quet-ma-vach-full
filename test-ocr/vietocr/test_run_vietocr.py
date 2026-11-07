"""
Test nhỏ cho run_vietocr.py (không nạp model thật: Detector và VietOCR được thay bằng bản giả).

Chạy trong thư mục test-ocr/vietocr, bằng venv riêng của VietOCR (vietocr/.venv, cài theo test-ocr/README.md Phần D):
    .venv\\Scripts\\python -B -m unittest -v test_run_vietocr        (Windows)
    .venv/bin/python -B -m unittest -v test_run_vietocr              (macOS / Linux)
"""
import csv
import io
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

import numpy as np
from PIL import Image

import run_vietocr


def box(x, y, w, h):
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)


class OrderLinesTest(unittest.TestCase):
    """Cùng các ca với test 'thứ tự dòng Paddle' trong web-ocr/test/lib.test.mjs (orderLines)."""

    def test_top_down_left_right(self):
        items = [(box(300, 12, 100, 30), "Phải"), (box(10, 10, 100, 30), "Trái"),
                 (box(10, 100, 200, 30), "Dòng 2"), (box(10, 55, 50, 30), "Giữa")]
        self.assertEqual(run_vietocr.order_lines(items), ["Trái", "Phải", "Giữa", "Dòng 2"])

    def test_overlap_below_half_is_new_row_and_empty_boxes_dropped(self):
        items = [(box(200, 0, 100, 30), "A"), (box(0, 20, 100, 30), "B"), (box(0, 200, 10, 10), "  ")]
        self.assertEqual(run_vietocr.order_lines(items), ["A", "B"])
        self.assertEqual(run_vietocr.order_lines([(box(200, 0, 100, 30), "A"), (box(0, 10, 100, 30), "B")]), ["B", "A"])
        self.assertEqual(run_vietocr.order_lines([]), [])


class BrokenImageTest(unittest.TestCase):
    def test_broken_image_writes_error_row_and_continues(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = pathlib.Path(tmp.name)
        (root / "photos" / "1").mkdir(parents=True)
        (root / "photos" / "1" / "a_hong.jpg").write_bytes(b"khong phai anh")
        Image.new("RGB", (40, 20), "white").save(root / "photos" / "1" / "b_tot.jpg")
        cwd = os.getcwd()
        os.chdir(root)
        self.addCleanup(os.chdir, cwd)

        class FakeDet:
            def __init__(self, path):
                pass

            def __call__(self, rgb):
                return [box(0, 0, 10, 5)]

        class FakeRec:
            def predict_batch(self, crops):
                return ["chữ"] * len(crops)

        with mock.patch.object(run_vietocr, "Detector", FakeDet), \
                mock.patch.object(run_vietocr, "load_vietocr", lambda: FakeRec()), \
                mock.patch.object(sys, "argv", ["run_vietocr.py"]), \
                mock.patch.object(sys, "stdout", io.StringIO()), mock.patch.object(sys, "stderr", io.StringIO()):
            run_vietocr.main()
        with open(root / "outputs" / "times.csv", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual([(r["code"], r["image"]) for r in rows], [("1", "a_hong"), ("1", "b_tot")])
        self.assertTrue(rows[0]["status"].startswith("error:"))
        self.assertEqual(rows[1]["status"], "ok")
        self.assertEqual((root / "outputs" / "paddle-vietocr" / "1__b_tot.txt").read_text(encoding="utf-8"), "chữ")


if __name__ == "__main__":
    unittest.main()
