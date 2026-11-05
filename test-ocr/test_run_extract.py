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


class RegexOcrRulesTest(unittest.TestCase):
    """Luật regex chịu lỗi OCR lặp lại (đợt ocr-b, P5). Chuỗi lỗi giả lập theo kiểu lỗi thấy ở >= 2 sản phẩm thật."""

    def rx(self, text):
        return run_extract.extract_regex(text)

    def test_p5a_energy_unit_garbled_missing_or_before_number(self):
        # kcal đọc sai ("kca]"), in trước số ("(kcal) 72,4", "calories-kcal: 150").
        self.assertEqual(self.rx("Năng lượng / Energy 75,3kca] Chất đạm 1,2")["nang_luong_kcal"], "75,3")
        self.assertEqual(self.rx("Năng lượng (kcal) 72,4 và sử dụng")["nang_luong_kcal"], "72,4")
        self.assertEqual(self.rx("Calories-kcal ()*: 150 (630) Calories from fat: 50")["nang_luong_kcal"], "150")

    def test_p5b_energy_label_misread(self):
        # "năng lượng" đọc thành "nang iuong" / "nang ivong" / "nang luqng"; "calories" thành "galories" / "calorios".
        self.assertEqual(self.rx("Nang iuong (kcal) 63,6 dam")["nang_luong_kcal"], "63,6")
        self.assertEqual(self.rx("galories 120 calories from fac 60")["nang_luong_kcal"], "120")
        self.assertEqual(self.rx("Calorios 140 cacrecfomn fa50")["nang_luong_kcal"], "140")

    def test_p5c_energy_ignores_reference_intake_2000_kcal(self):
        # "% giá trị ... tính trên nhu cầu năng lượng 2000 kcal" là mức tham chiếu, không phải năng lượng sản phẩm.
        text = "170 kcal\nPhần trăm giá trị dinh dưỡng tính trên nhu cầu năng lượng 2000 kcal"
        self.assertEqual(self.rx(text)["nang_luong_kcal"], "170")
        text2 = "tính trên nhu caunăng lượng 2 000 kcal.\nGiá trị dinh dưỡng: 510 kcal"
        self.assertEqual(self.rx(text2)["nang_luong_kcal"], "510")

    def test_p5d_nutrient_unit_g_read_as_digit_or_missing(self):
        # "g" đọc thành "9", "4", "2" cách số, hoặc mất hẳn; đơn vị "(g)" in trước số.
        out = self.rx("Carbohydrate 2,0 9 Chất đạm 2,5 9 Chất béo 1,4 9")
        self.assertEqual((out["carb_g"], out["dam_g"], out["beo_g"]), ("2,0", "2,5", "1,4"))
        out = self.rx("Chất đạm/ Protein 3,1 4 Chất béo/ Fat 3,6 4 Carbohydrate 4,7 9 Calci 110 mg")
        self.assertEqual((out["dam_g"], out["beo_g"], out["carb_g"]), ("3,1", "3,6", "4,7"))
        out = self.rx("Chất béo 3,5 Chất đạm 2,6 2 Carbohydrat 17 Can-xi 106 mg")
        self.assertEqual((out["beo_g"], out["dam_g"], out["carb_g"]), ("3,5", "2,6", "17"))
        out = self.rx("Đạm (g) 0,7 lắc đều Chất béo (g) 0,4 Hydrat cacbon (g) 16,5")
        self.assertEqual((out["dam_g"], out["beo_g"], out["carb_g"]), ("0,7", "0,4", "16,5"))

    def test_p5e_nutrient_g_glued_as_9_after_decimal(self):
        # "7,0g" đọc thành "7,09": bỏ số 9 cuối của số thập phân khi không có đơn vị g.
        out = self.rx("Protein 7,09 Lipid 14,49 Carbohydrate 47,29 Năng lượng 346,4 kcal")
        self.assertEqual((out["dam_g"], out["beo_g"], out["carb_g"]), ("7,0", "14,4", "47,2"))
        self.assertEqual(self.rx("Carbohydrat/ Carbohydrate: 41,29 Natri: 1735 mg")["carb_g"], "41,2")

    def test_p5f_date_six_digits_after_hsd(self):
        # Hạn in liền 6 số (ddmmyy) sau nhãn HSD / EXP, có khi xuống dòng.
        self.assertEqual(self.rx("HSD:071026 L 20:17-07")["han_su_dung"], "071026")
        self.assertEqual(self.rx("NSX 01/02/2025\nHSD / EXP:\n200223 08:33 NSX / PRD:")["han_su_dung"], "200223")

    def test_p5g_net_weight_label_misread(self):
        # Nhãn "khối lượng tịnh" đọc sai (khol / khoi iuong / kho' luong), "g" đọc thành "9";
        # ưu tiên số sau nhãn này hơn số đầu tiên (vd "trong 90 g" của bảng dinh dưỡng).
        self.assertEqual(self.rx("Giá trị dinh dưỡng trong 90 g\nKhol luong tinh: 108 9")["khoi_luong"], "108 g")
        self.assertEqual(self.rx("Trong 100 ml\nKhoi iuong tinh: 33 g/ 1,16 oz")["khoi_luong"], "33 g")

    def test_p5h_clean_text_unchanged(self):
        # Text sạch (không lỗi OCR): kết quả giống hệt code cũ.
        text = ("Mì ăn liền vị bò\nKhối lượng tịnh: 75g\nThành phần: bột mì, dầu thực vật, muối.\n"
                "Giá trị dinh dưỡng trong 100 g: Năng lượng 450 kcal, Chất đạm 9,5 g, Chất béo 18,49 g, "
                "Carbohydrat 62 g.\nCalories from fat 160 kcal\n"
                "Hướng dẫn bảo quản: nơi khô ráo, thoáng mát.\nSản xuất bởi: Công ty TNHH Thực phẩm ABC\n"
                "NSX: 01/02/2025 HSD: 01/08/2025")
        self.assertEqual(self.rx(text), {
            "ten": "mi an lien vi bo", "thuong_hieu": "", "khoi_luong": "75g",
            "thanh_phan_dau": ["bot mi", "dau thuc vat", "muoi"], "nang_luong_kcal": "450",
            "dam_g": "9,5", "beo_g": "18,49", "carb_g": "62",
            "nha_san_xuat": "cong ty tnhh thuc pham abc", "bao_quan": "noi kho rao, thoang mat.",
            "han_su_dung": "01/08/2025"})
        # Không nhãn HSD: vẫn lấy ngày cuối cùng như cũ.
        self.assertEqual(self.rx("Ngày sản xuất 01.02.2025\nDùng tốt nhất trước 01.02.2026")["han_su_dung"], "01.02.2026")


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
