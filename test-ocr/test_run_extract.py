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
        # "g" đọc thành "9", "4", "2" cách số, hoặc mất hẳn; đơn vị "(g)" in trước số
        # (không cần luật riêng: luật dự phòng lấy số đầu tiên sau nhãn chung "chất đạm", "chất béo", "hydrat cacbon").
        out = self.rx("Carbohydrate 2,0 9 Chất đạm 2,5 9 Chất béo 1,4 9")
        self.assertEqual((out["carb_g"], out["dam_g"], out["beo_g"]), ("2,0", "2,5", "1,4"))
        out = self.rx("Chất đạm/ Protein 3,1 4 Chất béo/ Fat 3,6 4 Carbohydrate 4,7 9 Calci 110 mg")
        self.assertEqual((out["dam_g"], out["beo_g"], out["carb_g"]), ("3,1", "3,6", "4,7"))
        out = self.rx("Chất béo 3,5 Chất đạm 2,6 2 Carbohydrat 17 Can-xi 106 mg")
        self.assertEqual((out["beo_g"], out["dam_g"], out["carb_g"]), ("3,5", "2,6", "17"))
        out = self.rx("Chất đạm (g) 0,7 lắc đều Chất béo (g) 0,4 Hydrat cacbon (g) 16,5")
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
        # Nhãn "khối lượng tịnh" đọc sai (khol / khoi iuong / kho' luong);
        # ưu tiên số sau nhãn này hơn số đầu tiên (vd "trong 90 g" của bảng dinh dưỡng).
        self.assertEqual(self.rx("Giá trị dinh dưỡng trong 90 g\nKhol luong tinh: 108 g")["khoi_luong"], "108 g")
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

    # ---- Vòng 2 (sau review): sửa luật bắt nhầm, bỏ luật chỉ thấy ở 1 sản phẩm, test giữ hành vi ----
    def test_p5i_fat_label_skips_calories_from_fat(self):
        # Nhãn béo dự phòng không lấy số sau "Calories from Fat" (năng lượng từ chất béo, không phải gam béo).
        self.assertEqual(self.rx("Calories from Fat: 20 Total Fat 2,5")["beo_g"], "2,5")
        # "Total Fat" đọc sai thành "IotalTat": không còn nhãn béo nào -> để trống, không lấy 20.
        self.assertEqual(self.rx("Calories from Fat: 20 IotalTat 96")["beo_g"], "")

    def test_p5j_rules_seen_in_one_product_removed(self):
        # Nhãn "đạm (g)" và "g đọc thành 9" sau khối lượng tịnh chỉ thấy ở 1 sản phẩm -> đã bỏ.
        self.assertEqual(self.rx("Đạm (g) 0,7 lắc đều")["dam_g"], "")
        self.assertEqual(self.rx("Khol luong tinh: 108 9")["khoi_luong"], "")

    def test_p5k_date_six_digits_must_be_valid_ddmmyy(self):
        # 6 số liền sau HSD chỉ nhận khi ddmmyy nằm trong khoảng: chỉ kiểm khoảng ngày 01-31, tháng 01-12.
        self.assertEqual(self.rx("HSD: 848224")["han_su_dung"], "")
        self.assertEqual(self.rx("HSD:071026")["han_su_dung"], "071026")

    def test_p5l_carb_two_decimals_ending_9_with_g_unit(self):
        # Có đơn vị g thì luật cũ lấy nguyên số, không cắt số 9 cuối (unglue_g chỉ dùng khi mất g).
        self.assertEqual(self.rx("Carbohydrate 18,79 g")["carb_g"], "18,79")

    def test_p5m_calories_from_fat_alone_is_not_energy(self):
        # "Calories from fat" là năng lượng từ chất béo, không phải năng lượng sản phẩm.
        self.assertEqual(self.rx("Calories from fat: 50")["nang_luong_kcal"], "")

    def test_p5n_new_rules_run_before_old_rules(self):
        # Luật (6): HSD 6 số được xét trước "ngày cuối cùng trong text".
        self.assertEqual(self.rx("HSD:071026\nIn ngày 01/02/2027")["han_su_dung"], "071026")
        # Luật (7): số sau nhãn "khối lượng tịnh" được xét trước luật cũ (số + đơn vị đầu tiên ở 15 dòng đầu).
        self.assertEqual(self.rx("Giá trị dinh dưỡng trong 100 g\nKhối lượng tịnh: 200 g")["khoi_luong"], "200 g")

    def test_p5o_date_six_digits_range_bounds(self):
        # Hai đầu của khoảng: ngày 00 / 32 và tháng 13 bị loại; 31/12 được nhận.
        self.assertEqual(self.rx("HSD: 001026")["han_su_dung"], "")
        self.assertEqual(self.rx("HSD: 321026")["han_su_dung"], "")
        self.assertEqual(self.rx("HSD: 011326")["han_su_dung"], "")
        self.assertEqual(self.rx("HSD: 311226")["han_su_dung"], "311226")
        # Giới hạn đã biết: chỉ kiểm khoảng, không kiểm lịch, nên 30/02 vẫn được nhận.
        # Đợt sau đổi sang kiểm lịch thật thì sửa ca này (30/02 phải ra "").
        self.assertEqual(self.rx("HSD: 300226")["han_su_dung"], "300226")


class GramRulesTest(unittest.TestCase):
    """Luật đợt sua-nho cho đạm / béo / carb: thà để trống còn hơn ra số sai.
    Chuỗi lấy theo text OCR thật (mã sản phẩm ghi ở từng ca)."""

    def rx(self, text):
        return run_extract.extract_regex(text)

    def dc(self, text):
        return run_extract.extract_dict(text)

    def grams(self, out):
        return (out["dam_g"], out["beo_g"], out["carb_g"])

    def test_s1a_over_100_strict_loose_dict_empty(self):
        # (a) > 100 g thì để trống, ở cả luật cũ (số + g), luật dự phòng và dict.
        self.assertEqual(self.grams(self.rx("Chất đạm 1449 g Chất béo 101 g Carbohydrat 4129 g")), ("", "", ""))
        self.assertEqual(self.grams(self.rx("Chất đạm 1449 Chất béo 1809 Carbohydrate 555584")), ("", "", ""))
        self.assertEqual(self.grams(self.dc("Chất đạm 1449 g\nChất béo 101 g\nCarbohydrate 4129 g")), ("", "", ""))
        # Đúng "> 100": 100 vẫn giữ; 100,5 bị bỏ.
        self.assertEqual(self.rx("Carbohydrate 100 g")["carb_g"], "100")
        self.assertEqual(self.rx("Carbohydrate 100,5 g")["carb_g"], "")
        self.assertEqual(self.dc("Carbohydrate 100 g")["carb_g"], "100")
        # Luật cũ ra > 100 thì để trống luôn, KHÔNG thử luật dự phòng (dù sau đó có "Protein 7,0").
        self.assertEqual(self.rx("Chất đạm 150 g Protein 7,0")["dam_g"], "")
        # Số bình thường không đổi.
        self.assertEqual(self.grams(self.rx("Chất đạm 7,0 g Chất béo 18,49 g Carbohydrat 62 g")), ("7,0", "18,49", "62"))
        self.assertEqual(self.grams(self.dc("Chất đạm 7,0 g\nChất béo 18,49 g\nCarbohydrate 62 g")), ("7,0", "18,49", "62"))

    def test_s1b_fat_label_skips_saturated_and_trans_fat(self):
        # (b) EasyOCR 8936221044160: luật cũ "chat beo" bắt 5,6 của "Chất béo bão hòal Saturated| Fat"; đáp án 10,8.
        out = self.rx("Chất béo/ Total fat: 10,84 Chất đạm/ Protein: 6,69 Chất béo bão hòal Saturated| Fat 5,6g")
        self.assertNotEqual(out["beo_g"], "5,6")
        self.assertEqual(out["beo_g"], "10,84")   # số sau "Total fat" ('4' là g đọc sai, ngoài phạm vi luật này)
        # Tesseract 8936221044160: "Chathéobaohda/sauated fat 589" (thêm biến thể số <= 100 để không nhờ luật a).
        self.assertEqual(self.rx("Chất béo/ Total fat: =\nChathéobaohda/sauated fat 589")["beo_g"], "")
        self.assertEqual(self.rx("Chất béo/ Total fat: =\nChathéobaohda/sauated fat 5,8")["beo_g"], "")
        # 8936221043071: "ChấtbéobãohòalSaturated Fat 1809".
        self.assertEqual(self.rx("Chất béol Total Fat au ChấtbéobãohòalSaturated Fat 1809 Natri")["beo_g"], "")
        self.assertEqual(self.rx("Chất béol Total Fat au ChấtbéobãohòalSaturated Fat 3,6 Natri")["beo_g"], "")
        # 8938501141477: "Saturatec 496  Fat 00".
        self.assertEqual(self.rx("Calories from Fat: 20 IotalTat 96 Daily Value 259 Saturatec 496  Fat 00")["beo_g"], "")
        self.assertEqual(self.rx("IotalTat 96 Saturatec 496  Fat 2,5")["beo_g"], "")
        # 8936016140060 / 8936079120276: "Saturated Fat" / "Trans Fat" kèm đơn vị g.
        self.assertEqual(self.rx("Trans Fat 0 g Saturated Fat 1,2 g")["beo_g"], "")
        self.assertEqual(self.rx("Chất béo bão hòa / Saturated Fat 2 g\nTổng chất béo / Total Fat 3,0 g")["beo_g"], "3,0")
        self.assertEqual(self.rx("Chất béo chuyển hóa 0 g Chất béo 7 g")["beo_g"], "7")
        self.assertEqual(self.dc("Chất béo bão hòa/Saturated fat 11 g\nNatri 130 mg")["beo_g"], "")
        # "Total Fat" / "Chất béo" đứng trước vẫn lấy đúng.
        text = "Tổng chất béo]Total Fat 3,0g 15% Chất béo bão hòa] Saturated Fat 240 mg 10%"
        self.assertEqual(self.rx(text)["beo_g"], "3,0")
        self.assertEqual(self.dc(text)["beo_g"], "3,0")
        self.assertEqual(self.rx("Total Fat 3,0g")["beo_g"], "3,0")
        self.assertEqual(self.dc("Total Fat 3,0g")["beo_g"], "3,0")

    def test_s1b2_calories_from_fat_many_spaces(self):
        # "calories from fat" bỏ cả khi có nhiều dấu cách giữa "from" và "fat".
        self.assertEqual(self.rx("Calories from   Fat: 20 IotalTat 96")["beo_g"], "")
        self.assertEqual(self.rx("Calories from   Fat: 20 Total Fat 2,5")["beo_g"], "2,5")

    def test_s1c_loose_leading_zero_integer_empty(self):
        # (c) luật dự phòng: "09", "00" (0 g đọc sai) -> trống, KHÔNG đổi thành "0".
        out = self.rx("Chất đạm protein 09 Chất béo / Fat 09")      # 8935001214274
        self.assertEqual((out["dam_g"], out["beo_g"]), ("", ""))
        self.assertEqual(self.rx("Fat 00 Cholesterol 0 9")["beo_g"], "")  # 8938501141477
        # "0" và "0,5" giữ nguyên.
        out = self.rx("Protein 0 Fat 0,5 Carbohydrate 0")
        self.assertEqual(self.grams(out), ("0", "0,5", "0"))

    def test_s1d_lost_comma_and_g_as_9_empty_not_reinserted(self):
        # (d) "569" là 5,6 g mất dấu phẩy, g đọc thành 9: để trống (nhờ luật a), không chèn dấu phẩy.
        self.assertEqual(self.rx("Chất béo 569")["beo_g"], "")
        self.assertEqual(self.rx("Carbohydrate 1199")["carb_g"], "")
        self.assertEqual(self.rx("Protein 1449")["dam_g"], "")   # 8936017368111: chèn dấu phẩy sẽ ra 14,4 (đáp án 7,0)

    def test_s1e_fat_column_table_keeps_total_fat_number(self):
        # Review vòng 1: bảng đọc theo cột (nhãn trước, số sau). Số đầu là của Total Fat, KHÔNG được ra "3" / "0".
        for text in ["Total Fat Saturated Fat Trans Fat 10g 3g 0g",
                     "Chất béo Chất béo bão hòa Chất béo trans 10g 3g 0g"]:
            for name, f in (("rx", self.rx), ("dc", self.dc)):
                with self.subTest(text=text, extractor=name):
                    beo = f(text)["beo_g"]
                    self.assertNotEqual(beo, "3")
                    self.assertIn(beo, {"10", ""})
                    self.assertEqual(beo, "10")   # giá trị thật ra
        # Cột trans đứng trước bão hòa: không được ra "0".
        for name, f in (("rx", self.rx), ("dc", self.dc)):
            with self.subTest(extractor=name):
                beo = f("Total Fat Trans Fat Saturated Fat 10g 0g 3g")["beo_g"]
                self.assertNotEqual(beo, "0")
                self.assertEqual(beo, "10")

    def test_s1f_fat_label_boundaries_iron_unsaturated_energy(self):
        # "Sắt" (iron) không phải saturated: số béo 5 vẫn lấy.
        with self.subTest(text="Sắt 2 Fat 5 g"):
            self.assertEqual(self.rx("Sắt 2 Fat 5 g")["beo_g"], "5")
        # "chất béo không bão hòa" bỏ trọn, không ăn số của dòng Natri.
        with self.subTest(text="Chất béo không bão hòa 3 g Natri 5 g"):
            self.assertEqual(self.rx("Chất béo không bão hòa 3 g Natri 5 g")["beo_g"], "")
        # Béo bão hòa trước, béo tổng sau.
        with self.subTest(text="Chất béo bão hòa 2 g Chất béo 7 g"):
            self.assertEqual(self.rx("Chất béo bão hòa 2 g Chất béo 7 g")["beo_g"], "7")
        with self.subTest(text="unsaturated fat 2 g Total Fat 6 g"):
            self.assertEqual(self.rx("unsaturated fat 2 g Total Fat 6 g")["beo_g"], "6")
        # "chuyển hóa năng lượng" trong câu quảng cáo không ăn số béo tổng.
        with self.subTest(text="hỗ trợ chuyển hóa năng lượng Chất béo 4 g"):
            self.assertEqual(self.rx("hỗ trợ chuyển hóa năng lượng Chất béo 4 g")["beo_g"], "4")

    # Review vòng 2: bảng đọc theo cột, nhãn béo tổng đứng liền nhãn bão hòa / chuyển hóa (không số giữa).
    # Giá trị thật mà code mới ra (rx, dc); mong "10", chấp nhận "" (thà để trống), KHÔNG BAO GIỜ "3" / "0".
    FAT_COLUMN_CASES = [
        ("Total Fat Saturated Fat 10g 3g", "10", "10"),
        ("Total Fat Trans Fat 10g 0g", "10", "10"),
        ("Fat Saturated Fat 10g 3g", "10", "10"),
        ("Total Fat (g) Saturated Fat (g) Trans Fat (g) 10 3 0", "10", ""),          # dc cần số + g trên dòng
        ("Chất béo Chất béo bão hòa 10g 3g", "10", "10"),
        ("Chất béo Chất béo chuyển hóa 10g 0g", "10", "10"),
        ("Chất béo Chất béo bão hòa Chất béo chuyển hóa 10g 3g 0g", "10", "10"),
        ("Chất béo (g) Chất béo bão hòa (g) Chất béo chuyển hóa (g) 10 3 0", "10", ""),   # dc cần số + g
        ("Lipid Chất béo bão hòa 10g 3g", "10", ""),            # dc không có nhãn "lipid"
        ("Chất béo / Fat Chất béo bão hòa / Saturated fat 10g 3g", "10", "10"),
        ("Tổng chất béo/Total Fat Chất béo bão hòa/Saturated Fat 10 g 3 g", "10", "10"),
    ]
    # Bảng đọc theo dòng: phải ra đúng giá trị.
    FAT_ROW_CASES = [
        ("Chất béo bão hòa 2 g", ""),                                   # bẫy: không được ra "2"
        ("Chất béo 10 g Chất béo bão hòa 3 g", "10"),
        ("Total Fat 10g Saturated Fat 3g Trans Fat 0g", "10"),
        ("Chất béo không bão hòa 3 g", ""),
        ("Chất béo/ Fat Chất béo bão hòa/ Saturated fat 2 g", ""),      # nhãn béo tổng không có số: không ra 2
    ]

    def test_s1g_fat_column_with_total_label(self):
        for text, want_rx, want_dc in self.FAT_COLUMN_CASES:
            for name, f, want in (("rx", self.rx, want_rx), ("dc", self.dc, want_dc)):
                with self.subTest(kind="cot", text=text, extractor=name):
                    beo = f(text)["beo_g"]
                    self.assertNotIn(beo, {"3", "0"})
                    self.assertIn(beo, {"10", ""})
                    self.assertEqual(beo, want)   # giá trị thật ra
        for text, want in self.FAT_ROW_CASES:
            for name, f in (("rx", self.rx), ("dc", self.dc)):
                with self.subTest(kind="dong", text=text, extractor=name):
                    self.assertEqual(f(text)["beo_g"], want)

    # Review vòng 3: khoảng giữa nhãn bão hòa / chuyển hóa và số không nhảy qua chữ (trừ "less than"), nên bảng cột
    # có nhãn chất khác (Natri, Carbohydrate…) sau nhãn bão hòa không bỏ nhầm số béo tổng, không ra số chất khác.
    # (ca, text, mong rx, mong dc, dc được phép, số không bao giờ được ra)
    SAT_GAP_CASES = [
        ("N1", "Chất béo Chất béo bão hòa Natri 10g 3g 50mg", "10", "10", {"10", ""}, {"3", "50"}),
        ("N2", "Chất béo Chất béo bão hòa Carbohydrate 10g 3g 30g", "10", "10", {"10", ""}, {"3", "30"}),
        # Bảng cột đầy đủ: béo là 8 (thứ 5); thà để trống. dc không có subTest: dict lấy số + g đầu tiên trên dòng có
        # "chat beo" nên ra "5" (của chất đạm) ở cả 45181af, 374eed2 và code mới; ngoài phạm vi SAT_GAP.
        ("N3", "Năng lượng Chất đạm Carbohydrat Đường Chất béo Chất béo bão hòa Natri "
               "200 kcal 5 g 30 g 10 g 8 g 3 g 50 mg", "", None, None, {"200", "5", "30", "10", "3", "50"}),
        ("N4", "Total Fat Saturated Fat 10 g | 3 g", "10", "10", {"10", ""}, {"3"}),
        ("N5", "Total Fat 7g Sat Fat Less than 20g 25g", "7", "7", {"7"}, {"20", "25"}),   # dạng 8938501141040
        ("N6", "Chất béo 5 g Chất béo bão hòa: 2 g", "5", "5", {"5"}, {"2"}),
        ("N7", "Chất béo bão hòa Natri 3g 50mg", "", "", {""}, {"3", "50"}),
    ]

    def test_s1h_sat_gap_no_letters(self):
        for case, text, want_rx, want_dc, allowed_dc, never in self.SAT_GAP_CASES:
            for name, f, want, allowed in (("rx", self.rx, want_rx, {want_rx}), ("dc", self.dc, want_dc, allowed_dc)):
                if want is None:
                    continue
                with self.subTest(case=case, text=text, extractor=name):
                    beo = f(text)["beo_g"]
                    self.assertNotIn(beo, never)
                    self.assertIn(beo, allowed)
                    self.assertEqual(beo, want)   # giá trị thật ra


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
