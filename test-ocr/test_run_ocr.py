"""
Test nhỏ cho phần đếm lượt gọi Google trong run_ocr.py và phần đọc times.csv trong score.py.
KHÔNG gọi Google / Azure thật: hàm OCR Google được thay bằng hàm giả, mọi file ghi vào thư mục tạm.

Chạy (trong thư mục test-ocr):
    .venv\\Scripts\\python -B -m unittest -v test_run_ocr        (Windows)
    .venv/bin/python -B -m unittest -v test_run_ocr              (macOS / Linux)
Chỉ cần pillow, python-dotenv, rapidfuzz (không cần thư viện Google / Azure).
"""
import csv, io, json, os, pathlib, sys, tempfile, types, unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

# Cô lập: thay module dotenv bằng module giả TRƯỚC khi import run_ocr, để không file .env nào bị đọc.
_fake_dotenv = types.ModuleType("dotenv")
_fake_dotenv.load_dotenv = lambda *args, **kwargs: False
sys.modules["dotenv"] = _fake_dotenv

from PIL import Image   # noqa: E402
import run_ocr          # noqa: E402
import score            # noqa: E402

SKIP = "bỏ qua theo luật chi phí"


class GoogleRunLimitTest(unittest.TestCase):
    """Chạy run_ocr.main() với --tools google trên thư mục tạm, hàm Google giả."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.photos, self.out = root / "photos", root / "outputs"
        self.calls = 0
        self.fail_pattern = None   # hàm (số thứ tự lượt gọi, từ 1) -> True nếu lượt đó ném lỗi
        paths = {
            "PHOTOS": self.photos,
            "WORK": root / "work",
            "OUT": self.out,
            "USAGE": self.out / "api_usage.json",
            "LOCK": self.out / "api_usage.lock",
        }
        env = {k: v for k, v in os.environ.items() if k not in ("AZURE_VISION_ENDPOINT", "AZURE_VISION_KEY")}
        env["GOOGLE_APPLICATION_CREDENTIALS"] = "gia"
        patches = [mock.patch.object(run_ocr, name, value) for name, value in paths.items()]
        patches += [
            mock.patch.object(run_ocr, "near_month_edge", lambda now: False),
            # Vá thẳng mục TOOLS["google"]: TOOLS giữ tham chiếu tới hàm cũ, vá tên ocr_google là không đủ
            mock.patch.dict(run_ocr.TOOLS, {"google": (self.fake_google, lambda: True)}),
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(sys, "argv", ["run_ocr.py", "--tools", "google"]),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def fake_google(self, path):
        self.calls += 1
        if self.fail_pattern and self.fail_pattern(self.calls):
            raise RuntimeError(f"lỗi giả lượt {self.calls}")
        return f"chữ giả {path.name}"

    def make_photos(self, n):
        """Tạo n ảnh nhỏ: photos/<mã>/front.jpg, mỗi mã 1 ảnh. Trả danh sách (mã, tên) theo thứ tự run_ocr đọc."""
        for i in range(n):
            d = self.photos / f"{8930000000000 + i}"
            d.mkdir(parents=True)
            Image.new("RGB", (8, 8), "white").save(d / "front.jpg", "JPEG")
        return [(p.parent.name, p.stem) for p in sorted(self.photos.glob("*/*"))]

    def run_main(self):
        buf = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(buf):   # traceback lượt lỗi giả in ra stderr
            run_ocr.main()   # không được ném lỗi / SystemExit
        return buf.getvalue()

    def month_count(self):
        data = json.loads((self.out / "api_usage.json").read_text(encoding="utf-8"))
        return data["google"][run_ocr.month_key()]

    def times_rows(self):
        with open(self.out / "times.csv", encoding="utf-8", newline="") as f:
            return list(csv.DictReader(f))

    def skipped(self):
        return [(r["code"], r["image"]) for r in self.times_rows() if r["status"] == SKIP]

    def assert_no_txt(self, images):
        for code, name in images:
            self.assertFalse((self.out / "google" / f"{code}__{name}.txt").exists(), f"{code}/{name} không được có file .txt")

    def test_1_dung_o_60_luot(self):
        images = self.make_photos(65)
        self.run_main()
        self.assertEqual(self.calls, 60)
        self.assertEqual(self.month_count(), 60)
        self.assertEqual(self.skipped(), images[60:])
        self.assert_no_txt(images[60:])
        self.assertEqual(len(list((self.out / "google").glob("*.txt"))), 60)
        self.assertFalse((self.out / "api_usage.lock").exists())

    def test_2_luot_loi_van_bi_dem(self):
        images = self.make_photos(65)
        self.fail_pattern = lambda n: n % 3 != 0   # lỗi, lỗi, được, lỗi, lỗi, được… (tối đa 2 lỗi liên tiếp)
        self.run_main()
        self.assertEqual(self.calls, 60)
        self.assertEqual(self.month_count(), 60)
        rows = self.times_rows()
        self.assertEqual(sum(r["status"].startswith("error") for r in rows), 40)
        self.assertEqual(sum(r["status"] == "ok" for r in rows), 20)
        self.assertEqual(self.skipped(), images[60:])
        self.assert_no_txt(images[60:])

    def test_3_cham_tran_thang_800(self):
        images = self.make_photos(65)
        self.out.mkdir()
        (self.out / "api_usage.json").write_text(json.dumps({"google": {run_ocr.month_key(): 790}}), encoding="utf-8")
        self.run_main()
        self.assertEqual(self.calls, 10)
        self.assertEqual(self.month_count(), 800)
        self.assertEqual(self.skipped(), images[10:])
        self.assertEqual(len(self.skipped()), 55)
        self.assert_no_txt(images[10:])

    def test_4_ranh_gioi_thang_giu_hanh_vi_cu(self):
        self.make_photos(65)
        with mock.patch.object(run_ocr, "near_month_edge", lambda now: True):
            self.run_main()
        self.assertEqual(self.calls, 0)
        self.assertEqual(self.skipped(), [])
        self.assertFalse((self.out / "google").exists())
        self.assertFalse((self.out / "api_usage.json").exists())


class ReadTimesTest(unittest.TestCase):
    def test_5_score_read_times(self):
        self.assertEqual(score.SKIP_STATUS, run_ocr.SKIP_STATUS)
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "times.csv"
            with open(p, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["tool", "code", "image", "seconds", "status"])
                w.writerow(["google", "1", "front", 2.0, "ok"])
                w.writerow(["google", "1", "back", 4.0, "error: lỗi giả"])
                w.writerow(["google", "2", "front", 0, SKIP])
                w.writerow(["google", "2", "back", 0, SKIP])
                w.writerow(["tesseract", "1", "front", 1.5, "ok"])
            times, errors = score.read_times(p)
        self.assertEqual(errors["google"], 1)
        self.assertEqual(errors["tesseract"], 0)
        self.assertEqual(sorted(times["google"]), [2.0, 4.0])   # dòng bỏ qua không vào thời gian trung bình
        self.assertEqual(times["tesseract"], [1.5])

    def test_5b_read_times_khong_co_file(self):
        with tempfile.TemporaryDirectory() as d:
            times, errors = score.read_times(pathlib.Path(d) / "khong_co.csv")
        self.assertEqual(dict(times), {})
        self.assertEqual(dict(errors), {})


if __name__ == "__main__":
    unittest.main()
