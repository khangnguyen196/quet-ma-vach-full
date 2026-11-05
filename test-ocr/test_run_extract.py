"""
Test nhỏ cho run_extract.py (phần B) và score_combo.py:
thứ tự ghép text các ảnh, chạy lại file kết quả lỗi, timeout và model mặc định khi gọi Ollama,
in tiếng Việt khi stdout / stderr là file cp1252.
KHÔNG gọi Ollama thật (requests được thay bằng module giả), không đọc .env, mọi file ghi vào thư mục tạm.

Chạy (trong thư mục test-ocr):
    .venv\\Scripts\\python -B -m unittest -v test_run_extract        (Windows)
    .venv/bin/python -B -m unittest -v test_run_extract              (macOS / Linux)
"""
import io, json, os, pathlib, sys, tempfile, types, unittest
from unittest import mock

# Cô lập: thay module dotenv bằng module giả TRƯỚC khi import run_extract, để không file .env nào bị đọc.
_fake_dotenv = types.ModuleType("dotenv")
_fake_dotenv.load_dotenv = lambda *args, **kwargs: False
sys.modules["dotenv"] = _fake_dotenv

import run_extract   # noqa: E402
import score_combo   # noqa: E402


class TmpDirCase(unittest.TestCase):
    """Chạy trong thư mục tạm (run_extract / score_combo đọc outputs/, truth.csv theo đường dẫn tương đối)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.out = self.root / "outputs"
        cwd = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, cwd)

    def write_ocr(self, tool, code, image, text):
        d = self.out / tool
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{code}__{image}.txt").write_text(text, encoding="utf-8")


class ProductTextTest(TmpDirCase):
    def test_e1_image_order_front_ingredients_nutrition_date(self):
        # Tạo file theo thứ tự lộn xộn; product_text phải ghép front -> ingredients -> nutrition -> date.
        for image in ["date", "nutrition", "front", "ingredients"]:
            self.write_ocr("tesseract", "1", image, image.upper())
        text = run_extract.product_text(self.out / "tesseract", "1")
        self.assertEqual(text.splitlines(), ["FRONT", "INGREDIENTS", "NUTRITION", "DATE"])


class RerunTest(TmpDirCase):
    def test_e2_rerun_error_files_keep_ok_files(self):
        # 1.json lỗi -> chạy lại; 2.json ok -> giữ nguyên từng byte; 3.json hỏng (không đọc được) -> chạy lại.
        for code in ["1", "2", "3"]:
            self.write_ocr("tesseract", code, "front", f"chữ {code}")
        ext_dir = self.out / "extract" / "tesseract__gia"
        ext_dir.mkdir(parents=True)
        (ext_dir / "1.json").write_text(json.dumps({"_seconds": 1.0, "_status": "error: lỗi cũ"}), encoding="utf-8")
        ok_bytes = json.dumps({"ten": "cũ", "_seconds": 2.0, "_status": "ok"}, ensure_ascii=False).encode("utf-8")
        (ext_dir / "2.json").write_bytes(ok_bytes)
        (ext_dir / "3.json").write_text("{hong", encoding="utf-8")
        calls = []

        def fake_extract(text):
            calls.append(text)
            return {"ten": "mới"}

        with mock.patch.dict(run_extract.EXTRACTORS, {"gia": (fake_extract, lambda: True)}), \
                mock.patch.object(sys, "argv", ["run_extract.py", "--ocr", "tesseract", "--extractors", "gia"]), \
                mock.patch.object(sys, "stdout", io.StringIO()), mock.patch.object(sys, "stderr", io.StringIO()):
            run_extract.main()
        self.assertEqual(sorted(calls), ["chữ 1", "chữ 3"])
        self.assertEqual((ext_dir / "2.json").read_bytes(), ok_bytes)
        for code in ["1", "3"]:
            data = json.loads((ext_dir / f"{code}.json").read_text(encoding="utf-8"))
            self.assertEqual(data["_status"], "ok")
            self.assertEqual(data["ten"], "mới")


class FakeResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return {"response": '{"ten": "Mì gói"}'}


class OllamaCallTest(unittest.TestCase):
    """extract_llm gửi đúng timeout và model tới Ollama (requests.post giả, không gọi thật)."""

    def call_llm(self, env_extra):
        posts = []

        def fake_post(url, **kwargs):
            posts.append(kwargs)
            return FakeResponse()

        fake_requests = types.ModuleType("requests")
        fake_requests.post = fake_post
        env = {k: v for k, v in os.environ.items() if k not in ("OLLAMA_TIMEOUT", "OLLAMA_MODEL", "LLM_PROVIDER")}
        env["LLM_PROVIDER"] = "ollama"
        env.update(env_extra)
        with mock.patch.dict(sys.modules, {"requests": fake_requests}), mock.patch.dict(os.environ, env, clear=True):
            data = run_extract.extract_llm("chữ OCR")
        self.assertEqual(data, {"ten": "Mì gói"})
        self.assertEqual(len(posts), 1)
        return posts[0]

    def test_e3a_timeout_from_env(self):
        self.assertEqual(self.call_llm({"OLLAMA_TIMEOUT": "600"})["timeout"], 600)

    def test_e3b_timeout_default_180(self):
        # Không đặt, rỗng, không phải số (kể cả nan, inf), <= 0 -> 180 giây.
        self.assertEqual(self.call_llm({})["timeout"], 180)
        for bad in ["", "  ", "abc", "0", "-5", "nan", "inf", "-inf"]:
            with self.subTest(OLLAMA_TIMEOUT=bad):
                self.assertEqual(self.call_llm({"OLLAMA_TIMEOUT": bad})["timeout"], 180)

    def test_e3c_timeout_over_one_day_uses_180(self):
        # Quá 1 ngày (86400 giây, vd 1e308) -> 180; đúng 86400 vẫn giữ.
        self.assertEqual(self.call_llm({"OLLAMA_TIMEOUT": "86400"})["timeout"], 86400)
        for big in ["86401", "1e308"]:
            with self.subTest(OLLAMA_TIMEOUT=big):
                self.assertEqual(self.call_llm({"OLLAMA_TIMEOUT": big})["timeout"], 180)

    def test_e4_default_model_qwen25_3b(self):
        self.assertEqual(self.call_llm({})["json"]["model"], "qwen2.5:3b")
        self.assertEqual(self.call_llm({"OLLAMA_MODEL": "qwen2.5:7b"})["json"]["model"], "qwen2.5:7b")


class OutputEncodingTest(TmpDirCase):
    """Như `python run_extract.py > file` / `python score_combo.py > file` trên Windows: stdout, stderr là file cp1252."""

    def cp1252_streams(self):
        raw_out, raw_err = io.BytesIO(), io.BytesIO()
        return raw_out, raw_err, io.TextIOWrapper(raw_out, encoding="cp1252"), io.TextIOWrapper(raw_err, encoding="cp1252")

    def test_e5a_run_extract_main_prints_vietnamese_to_cp1252(self):
        self.write_ocr("tesseract", "1", "front", "chữ")

        def fake_extract(text):
            raise RuntimeError("lỗi giả tiếng Việt")

        raw_out, raw_err, out, err = self.cp1252_streams()
        with mock.patch.dict(run_extract.EXTRACTORS, {"gia": (fake_extract, lambda: True)}), \
                mock.patch.object(sys, "argv", ["run_extract.py", "--extractors", "gia"]), \
                mock.patch.object(sys, "stdout", out), mock.patch.object(sys, "stderr", err):
            run_extract.main()   # không được lỗi UnicodeEncodeError
        out.flush()
        err.flush()
        self.assertIn("Xong. Chạy tiếp", raw_out.getvalue().decode("utf-8"))
        self.assertIn("lỗi giả tiếng Việt", raw_err.getvalue().decode("utf-8"))

    def test_e5b_score_combo_main_prints_vietnamese_to_cp1252(self):
        fields = score_combo.FIELDS
        (self.root / "truth.csv").write_text(
            "code," + ",".join(fields) + "\n1,Mì gói,,75g" + "," * (len(fields) - 3) + "\n", encoding="utf-8")
        d = self.out / "extract" / "tesseract__regex"
        d.mkdir(parents=True)
        (d / "1.json").write_text(json.dumps({"ten": "mi goi", "_seconds": 0.1, "_status": "ok"}), encoding="utf-8")
        raw_out, raw_err, out, err = self.cp1252_streams()
        with mock.patch.object(sys, "stdout", out), mock.patch.object(sys, "stderr", err):
            score_combo.main()   # không được lỗi UnicodeEncodeError
        out.flush()
        self.assertIn("Kết quả tổ hợp", raw_out.getvalue().decode("utf-8"))
        self.assertTrue((self.out / "summary_combo.md").exists())


if __name__ == "__main__":
    unittest.main()
