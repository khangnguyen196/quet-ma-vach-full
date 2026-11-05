"""
Test nhỏ cho phần đếm lượt gọi Google trong run_ocr.py, phần đọc times.csv trong score.py và hàm found() so khớp giá trị trong score.py.
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
        self.addCleanup(self.tmp.cleanup)
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

    def test_1_stops_at_60_calls(self):
        images = self.make_photos(65)
        self.run_main()
        self.assertEqual(self.calls, 60)
        self.assertEqual(self.month_count(), 60)
        self.assertEqual(self.skipped(), images[60:])
        self.assert_no_txt(images[60:])
        self.assertEqual(len(list((self.out / "google").glob("*.txt"))), 60)
        self.assertFalse((self.out / "api_usage.lock").exists())

    def test_2_failed_calls_are_counted(self):
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

    def test_3_month_cap_800(self):
        images = self.make_photos(65)
        self.out.mkdir()
        (self.out / "api_usage.json").write_text(json.dumps({"google": {run_ocr.month_key(): 790}}), encoding="utf-8")
        self.run_main()
        self.assertEqual(self.calls, 10)
        self.assertEqual(self.month_count(), 800)
        self.assertEqual(self.skipped(), images[10:])
        self.assertEqual(len(self.skipped()), 55)
        self.assert_no_txt(images[10:])

    def test_4_month_edge_keeps_old_behavior(self):
        self.make_photos(65)
        with mock.patch.object(run_ocr, "near_month_edge", lambda now: True):
            self.run_main()
        self.assertEqual(self.calls, 0)
        self.assertEqual(self.skipped(), [])
        self.assertFalse((self.out / "google").exists())
        self.assertFalse((self.out / "api_usage.json").exists())

    def test_6_bad_usage_file_keeps_old_behavior(self):
        # Bộ đếm hỏng: không gọi Google, không ghi dòng bỏ qua (giữ cách cũ), file bộ đếm giữ nguyên từng byte.
        self.make_photos(5)
        self.out.mkdir()
        usage = self.out / "api_usage.json"
        usage.write_bytes(b"{hong")
        self.run_main()   # không được ném lỗi
        self.assertEqual(self.calls, 0)
        self.assertEqual(self.skipped(), [])
        self.assertEqual(usage.read_bytes(), b"{hong")
        self.assertFalse((self.out / "google").exists())
        self.assertFalse((self.out / "api_usage.lock").exists())

    def test_7_save_usage_error_does_not_count_or_call(self):
        # Ghi bộ đếm tháng bị lỗi: script dừng bằng lỗi đó, chưa gọi Google lượt nào, bộ đếm lần chạy không tăng,
        # file khóa vẫn được xóa.
        self.make_photos(5)

        def broken_save(usage):
            raise OSError("lỗi ghi giả")

        with mock.patch.object(run_ocr, "save_usage", broken_save):
            with self.assertRaises(OSError):
                self.run_main()
        self.assertEqual(self.calls, 0)
        self.assertEqual(run_ocr.run_calls.get("google", 0), 0)
        self.assertFalse((self.out / "api_usage.lock").exists())

    def test_8_azure_month_cap_writes_skip_rows(self):
        # Azure đã ở trần tháng: không gọi lượt nào, mọi ảnh có dòng "bỏ qua theo luật chi phí" với tool azure.
        images = self.make_photos(5)
        self.out.mkdir()
        usage = {"azure": {run_ocr.month_key(): run_ocr.cap("azure")}}
        (self.out / "api_usage.json").write_text(json.dumps(usage), encoding="utf-8")
        azure_calls = []

        def fake_azure(path):
            azure_calls.append(path)
            return "chữ giả"

        with mock.patch.dict(run_ocr.TOOLS, {"azure": (fake_azure, lambda: True)}), \
                mock.patch.dict(os.environ, {"AZURE_VISION_ENDPOINT": "gia", "AZURE_VISION_KEY": "gia"}), \
                mock.patch.object(run_ocr, "wait_for_azure", lambda: None), \
                mock.patch.object(sys, "argv", ["run_ocr.py", "--tools", "azure"]):
            self.run_main()
        self.assertEqual(azure_calls, [])
        rows = self.times_rows()
        self.assertEqual(len(rows), 5)
        self.assertEqual([(r["tool"], r["code"], r["image"], r["status"]) for r in rows],
                         [("azure", code, name, SKIP) for code, name in images])
        self.assertEqual(list(self.out.glob("**/*.txt")), [])
        self.assertEqual(json.loads((self.out / "api_usage.json").read_text(encoding="utf-8")), usage)
        self.assertFalse((self.out / "api_usage.lock").exists())


class ReadTimesTest(unittest.TestCase):
    def test_5_read_times_skips_cost_rows(self):
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

    def test_5b_read_times_missing_file(self):
        with tempfile.TemporaryDirectory() as d:
            times, errors = score.read_times(pathlib.Path(d) / "khong_co.csv")
        self.assertEqual(dict(times), {})
        self.assertEqual(dict(errors), {})


class FoundTest(unittest.TestCase):
    """Hàm found() của score.py: so khớp giá trị số (ngày, số thập phân) trong text OCR."""

    def test_9a_date_with_dots_ending_in_zero(self):
        self.assertEqual(score.found("19.09.20", "HSD:19.09.20"), 1.0)

    def test_9b_date_missing_last_digit(self):
        self.assertEqual(score.found("19.09.20", "HSD:19.09.2"), 0.0)

    def test_9c_two_dates_in_text(self):
        self.assertEqual(score.found("11.01.24", "HSD:11.01.24 NSX:12.05.23"), 1.0)

    def test_9d_date_without_dots(self):
        self.assertEqual(score.found("280920", "HSD: 280920"), 1.0)

    def test_9e_decimal_zero_keeps_old_behavior(self):
        self.assertEqual(score.found("7.0", "Chất đạm 7 g"), 1.0)
        self.assertEqual(score.found("7.0", "Chất đạm 7,0 g"), 1.0)

    def test_9f_decimal_comma(self):
        self.assertEqual(score.found("346.4", "346,4 kcal"), 1.0)

    def test_9g_zero_value_not_match_everything(self):
        self.assertEqual(score.found("0.0", "Năng lượng 12 kcal"), 0.0)

    def test_9h_value_never_becomes_empty_pattern(self):
        # Giá trị chỉ gồm 0 và dấu chấm không được thành mẫu rỗng (mẫu rỗng khớp mọi text).
        self.assertEqual(score.found(".0", "Năng lượng 12 kcal"), 0.0)


if __name__ == "__main__":
    unittest.main()
