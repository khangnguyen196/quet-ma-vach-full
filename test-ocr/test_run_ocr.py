"""
Test nhỏ cho phần đếm lượt gọi Google và Azure trong run_ocr.py (trần lần chạy, trần tháng, bộ đếm hỏng, ghi bộ đếm),
phần đọc times.csv và danh sách công cụ trong score.py, hàm found() so khớp giá trị trong score.py,
và in tiếng Việt khi stdout / stderr là file cp1252 (score.main(), run_ocr.main() với Tesseract giả).
KHÔNG gọi Google / Azure thật: hàm OCR Google / Azure được thay bằng hàm giả, mọi file ghi vào thư mục tạm.

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


class PaidServiceUsageTest(unittest.TestCase):
    """Bộ đếm lượt gọi dịch vụ trả phí (Google, Azure) của run_ocr.py, trên thư mục tạm.
    Mặc định chạy run_ocr.main() với --tools google và hàm Google giả; test Azure tự vá thêm hàm Azure giả và --tools azure."""

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
        save_calls = []

        def broken_save(usage):
            save_calls.append(usage)
            raise OSError("lỗi ghi giả")

        with mock.patch.object(run_ocr, "save_usage", broken_save):
            # Lỗi phải đúng là lỗi của broken_save (không phải OSError khác ở chỗ khác)
            with self.assertRaisesRegex(OSError, "lỗi ghi giả"):
                self.run_main()
        self.assertEqual(len(save_calls), 1)
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

    def test_10_save_usage_replace_error_cleans_tmp(self):
        # os.replace lỗi: save_usage ném lại đúng lỗi đó, xóa file .tmp, bộ đếm cũ giữ nguyên từng byte.
        self.out.mkdir()
        usage_file = self.out / "api_usage.json"
        old = json.dumps({"google": {run_ocr.month_key(): 5}}).encode("utf-8")
        usage_file.write_bytes(old)
        with mock.patch.object(run_ocr.os, "replace", side_effect=OSError("lỗi thay giả")):
            with self.assertRaisesRegex(OSError, "lỗi thay giả"):
                run_ocr.save_usage({"google": {run_ocr.month_key(): 6}})
        self.assertFalse((self.out / "api_usage.json.tmp").exists())
        self.assertEqual(usage_file.read_bytes(), old)

    def test_13b_run_ocr_main_prints_vietnamese_to_cp1252_stdout(self):
        # Như `python run_ocr.py > file` trên Windows: stdout và stderr là file mã hóa cp1252.
        # Tesseract giả (không gọi OCR thật): ảnh thứ 2 ném lỗi có chữ tiếng Việt để traceback ra stderr.
        self.make_photos(2)
        tess_calls = []

        def fake_tesseract(path):
            tess_calls.append(path)
            if len(tess_calls) == 2:
                raise RuntimeError("lỗi giả tiếng Việt")
            return "chữ giả"

        raw_out, raw_err = io.BytesIO(), io.BytesIO()
        out = io.TextIOWrapper(raw_out, encoding="cp1252")
        err = io.TextIOWrapper(raw_err, encoding="cp1252")
        with mock.patch.dict(run_ocr.TOOLS, {"tesseract": (fake_tesseract, lambda: True)}), \
                mock.patch.object(sys, "argv", ["run_ocr.py", "--tools", "tesseract"]), \
                mock.patch.object(sys, "stdout", out), mock.patch.object(sys, "stderr", err):
            run_ocr.main()   # không được lỗi UnicodeEncodeError
        out.flush()
        err.flush()
        self.assertEqual(len(tess_calls), 2)
        self.assertEqual(self.calls, 0)   # không gọi Google
        self.assertIn("Có 2 ảnh của 2 sản phẩm.", raw_out.getvalue().decode("utf-8"))
        self.assertIn("lỗi giả tiếng Việt", raw_err.getvalue().decode("utf-8"))

    def test_10b_save_usage_write_error_cleans_tmp(self):
        # Ghi file tạm lỗi giữa chừng (đã ghi được một phần): save_usage ném lại đúng lỗi đó, xóa file .tmp,
        # bộ đếm cũ giữ nguyên từng byte.
        self.out.mkdir()
        usage_file = self.out / "api_usage.json"
        old = json.dumps({"google": {run_ocr.month_key(): 5}}).encode("utf-8")
        usage_file.write_bytes(old)
        written = []

        def broken_write_text(path, data, *args, **kwargs):
            written.append(path)
            with open(path, "w", encoding="utf-8") as f:
                f.write(data[:5])   # ghi dở
            raise OSError("lỗi ghi giả")

        with mock.patch.object(pathlib.Path, "write_text", broken_write_text):
            with self.assertRaisesRegex(OSError, "lỗi ghi giả"):
                run_ocr.save_usage({"google": {run_ocr.month_key(): 6}})
        self.assertEqual([p.name for p in written], ["api_usage.json.tmp"])
        self.assertFalse((self.out / "api_usage.json.tmp").exists())
        self.assertEqual(usage_file.read_bytes(), old)


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


class LastRowTest(unittest.TestCase):
    """score.py chỉ tính dòng CUỐI của mỗi ảnh trong times.csv (run_ocr.py ghi nối thêm qua nhiều lần chạy)."""

    def write_times(self, rows):
        p = pathlib.Path(self.tmp.name) / "times.csv"
        with open(p, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["tool", "code", "image", "seconds", "status"])
            w.writerows(rows)
        return p

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_11a_error_then_ok(self):
        p = self.write_times([["google", "1", "front", 3.0, "error: lỗi giả"],
                              ["google", "1", "front", 2.0, "ok"]])
        times, errors = score.read_times(p)
        self.assertEqual(errors["google"], 0)
        self.assertEqual(times["google"], [2.0])

    def test_11b_ok_then_error(self):
        p = self.write_times([["google", "1", "front", 2.0, "ok"],
                              ["google", "1", "front", 3.0, "error: lỗi giả"]])
        times, errors = score.read_times(p)
        self.assertEqual(errors["google"], 1)
        self.assertEqual(times["google"], [3.0])

    def test_11c_skip_then_ok(self):
        p = self.write_times([["google", "1", "front", 0, SKIP],
                              ["google", "1", "front", 2.0, "ok"]])
        times, errors = score.read_times(p)
        self.assertEqual(errors["google"], 0)
        self.assertEqual(times["google"], [2.0])
        self.assertEqual(score.read_skipped(p)["google"], 0)

    def test_11d_only_skip(self):
        p = self.write_times([["google", "1", "front", 0, SKIP]])
        times, errors = score.read_times(p)
        self.assertEqual(score.read_skipped(p)["google"], 1)
        self.assertEqual(times["google"], [])
        self.assertEqual(errors["google"], 0)

    def test_11e_list_tools_ignores_extract_and_dot_dirs(self):
        out = pathlib.Path(self.tmp.name) / "outputs"
        for name in ["tesseract", "google", "extract", ".cache"]:
            (out / name).mkdir(parents=True)
        (out / "times.csv").write_text("", encoding="utf-8")   # file, không phải thư mục
        self.assertEqual(score.list_tools(out), ["google", "tesseract"])


class ScoreMainTest(unittest.TestCase):
    """Danh sách công cụ của score.py lấy cả từ times.csv, và score.main() chạy trên thư mục tạm.
    Công cụ trả phí bị bỏ qua hết theo luật chi phí thì không có thư mục outputs/<công cụ>/, chỉ có dòng trong times.csv."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = pathlib.Path(self.tmp.name)
        self.out = root / "outputs"
        (self.out / "tesseract").mkdir(parents=True)
        (self.out / "tesseract" / "1__front.txt").write_text("Mì gói 75g", encoding="utf-8")
        with open(self.out / "times.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["tool", "code", "image", "seconds", "status"])
            w.writerow(["tesseract", "1", "front", 1.5, "ok"])
            w.writerow(["google", "1", "front", 0, SKIP])
            w.writerow(["google", "1", "back", 0, SKIP])
        with open(root / "truth.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["code"] + score.FIELDS)
            w.writerow(["1", "Mì gói", "", "75g"] + [""] * (len(score.FIELDS) - 3))
        # score.py đọc truth.csv và outputs/ theo đường dẫn tương đối: chạy trong thư mục tạm
        cwd = os.getcwd()
        os.chdir(root)
        self.addCleanup(os.chdir, cwd)

    def run_score(self, stdout):
        """Chạy score.main() với stdout cho trước (stderr cũng thay, để main() không đổi stderr thật của test)."""
        with mock.patch.object(sys, "stdout", stdout), mock.patch.object(sys, "stderr", io.StringIO()):
            score.main()   # không được ném lỗi / SystemExit
        return (self.out / "summary.md").read_text(encoding="utf-8")

    def test_12a_all_tools_includes_tool_only_in_times_csv(self):
        self.assertFalse((self.out / "google").exists())
        self.assertEqual(score.all_tools(self.out), ["google", "tesseract"])

    def test_12b_summary_has_tool_only_in_times_csv(self):
        summary = self.run_score(io.StringIO())
        rows = [[c.strip() for c in line.strip("|").split("|")] for line in summary.splitlines() if line.startswith("|")]
        # Bảng xếp hạng: Hạng | Công cụ | Điểm | % đầy đủ | Giây/ảnh | Ảnh lỗi | Ảnh bỏ qua
        google = [cells for cells in rows if len(cells) == 7 and cells[1] == "google"]
        self.assertEqual(len(google), 1, summary)
        self.assertEqual(google[0][1:], ["google", "0.0", "0%", "?", "0", "2"])

    def test_13a_score_main_prints_vietnamese_to_cp1252_stdout(self):
        # Như `python score.py > file` trên Windows: stdout là file mã hóa cp1252 (không có chữ "ế", "ả"…).
        raw = io.BytesIO()
        out = io.TextIOWrapper(raw, encoding="cp1252")
        self.run_score(out)   # không được lỗi UnicodeEncodeError
        out.flush()
        self.assertIn("Kết quả", raw.getvalue().decode("utf-8"))


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
        # Giá trị bắt đầu bằng dấu chấm (vd `.0`) không được thành mẫu rỗng (mẫu rỗng khớp mọi text).
        self.assertEqual(score.found(".0", "Năng lượng 12 kcal"), 0.0)


if __name__ == "__main__":
    unittest.main()
