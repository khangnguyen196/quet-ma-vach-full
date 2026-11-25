# Test tinh server/kho-nhom.sql (dot kho-nhom): chi doc file, khong can Postgres / Supabase.
# Thu that RLS bang Postgres tren may (PGlite) lam ngoai git (D:\tmp\kho-nhom\pg), xem bao cao dot.
import re
from pathlib import Path

SQL_PATH = Path(__file__).resolve().parents[1] / "kho-nhom.sql"
SRC_OFF = Path(__file__).resolve().parents[2] / "src" / "off.js"


def sql_text():
    return SQL_PATH.read_text(encoding="utf-8")


def code_only(text):
    """Bo comment '--' (file khong dung chuoi co '--' ben trong)."""
    return "\n".join(line.split("--", 1)[0] for line in text.splitlines())


def policies(text):
    """[(ten, bang, lenh, vai tro, than)] cua moi 'create policy'."""
    out = []
    pat = re.compile(r"create policy (\w+) on ([\w.]+)\s+for (\w+) to (\w+)(.*?);", re.S | re.I)
    for m in pat.finditer(code_only(text)):
        out.append((m.group(1), m.group(2), m.group(3).lower(), m.group(4), m.group(5)))
    return out


def test_khong_co_khoa_bi_mat_hay_vai_tro_quan_tri():
    low = sql_text().lower()
    assert "service_role" not in low
    assert "sb_secret" not in low
    code = code_only(sql_text()).lower()
    assert "security definer" not in code  # comment co nhac "khong security definer"
    assert "bypassrls" not in low


def test_rls_bat_ca_hai_bang():
    code = code_only(sql_text())
    for t in ("nhom_san_pham", "nhom_anh"):
        assert re.search(rf"alter table public\.{t} enable row level security;", code), t


def test_anon_bi_thu_het_quyen_va_khong_co_policy_cho_anon():
    code = code_only(sql_text())
    for t in ("nhom_san_pham", "nhom_anh"):
        assert re.search(rf"revoke all on public\.{t} from anon;", code), t
    assert not re.search(r"\bto\s+(anon|public)\b", code, re.I)
    assert not re.search(r"grant [^;]* to anon", code, re.I)
    for name, _, _, role, _ in policies(sql_text()):
        assert role == "authenticated", name


def test_du_policy():
    ps = {(t, c): (n, body) for n, t, c, _, body in policies(sql_text())}
    for t in ("public.nhom_san_pham", "public.nhom_anh"):
        for c in ("select", "insert", "update", "delete"):
            assert (t, c) in ps, (t, c)
    # them / sua / xoa chi cua minh
    assert "nguoi_them = (select auth.uid())" in ps[("public.nhom_san_pham", "insert")][1]
    assert "nguoi_them = (select auth.uid())" in ps[("public.nhom_san_pham", "update")][1]
    assert "nguoi_them = (select auth.uid())" in ps[("public.nhom_san_pham", "delete")][1]
    for c in ("insert", "update"):
        body = ps[("public.nhom_anh", c)][1]
        assert "split_part(duong_dan, '/', 1) = (select auth.uid())::text" in body, c
        assert "sp.nguoi_them = (select auth.uid())" in body, c
    # storage: doc / them / xoa, KHONG co update
    st = [(n, c, body) for n, t, c, _, body in policies(sql_text()) if t == "storage.objects"]
    assert sorted(c for _, c, _ in st) == ["delete", "insert", "select"]
    for _, _, body in st:
        assert "bucket_id = 'nhom-anh'" in body
    ins = next(b for _, c, b in st if c == "insert")
    assert "(storage.foldername(name))[1] = (select auth.uid())::text" in ins
    # moi policy co 'drop policy if exists' truoc (chay lai duoc)
    for n, t, _, _, _ in policies(sql_text()):
        assert f"drop policy if exists {n} on {t};" in sql_text(), n


def test_bucket_rieng_tu():
    code = code_only(sql_text())
    m = re.search(r"insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*"
                  r"values \('nhom-anh', 'nhom-anh', (\w+), (\d+), array\[([^\]]*)\]\)\s*on conflict \(id\) do update", code)
    assert m
    assert m.group(1) == "false"
    assert int(m.group(2)) <= 5 * 1024 * 1024
    assert [x.strip().strip("'") for x in m.group(3).split(",")] == ["image/jpeg", "image/png", "image/webp"]
    assert "public = excluded.public" in code


def test_idempotent():
    code = code_only(sql_text())
    assert "create table if not exists public.nhom_san_pham" in code
    assert "create table if not exists public.nhom_anh" in code
    assert not re.search(r"create table (?!if not exists)", code)
    assert not re.search(r"create index (?!if not exists)", code)
    assert not re.search(r"create function", code)  # chi 'create or replace function'
    for trg in ("nhom_san_pham_truoc_sua", "nhom_anh_gioi_han"):
        assert f"drop trigger if exists {trg}" in code


def test_di_ung_dung_14_ma_cua_off_js():
    off = SRC_OFF.read_text(encoding="utf-8")
    block = re.search(r"export const ALLERGEN_VI = \{(.*?)\};", off, re.S).group(1)
    keys = re.findall(r"(?:^|,)\s*\"?([\w-]+)\"?\s*:", block)
    assert len(keys) == 14
    m = re.search(r"di_ung <@ array\[(.*?)\]::text\[\]", code_only(sql_text()), re.S)
    assert m
    in_sql = [x.strip().strip("'") for x in m.group(1).replace("\n", " ").split(",")]
    assert in_sql == keys


def test_rang_buoc_cot():
    code = code_only(sql_text())
    assert "char_length(btrim(ten)) between 1 and 200" in code
    assert "ma_vach ~ '^[0-9]{8,14}$'" in code
    assert "array_length(v, 1) = 512" in code and "array_ndims(v) = 1" in code
    assert r"'^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'" in code
    assert "pg_column_size(dinh_duong) <= 8192" in code
    assert "nguon in ('tay', 'off', 'ocr-mat-sau')" in code
    assert "if n_sp >= 3 then" in code and "if n_nguoi >= 300 then" in code
    assert "references public.nhom_san_pham (id) on delete cascade" in code


def test_khoi_kiem_va_khoi_go():
    text = sql_text()
    assert "KIỂM SAU KHI CHẠY" in text
    assert "GỠ" in text
    go = text[text.index("-- GỠ"):]
    # khoi go nam trong comment: khong co cau lenh chay duoc
    assert code_only(go).strip() == ""


# ---------------- vong 2 (review vong 1) ----------------
def _func_body(code, name):
    m = re.search(rf"create or replace function public\.{name}\((.*?)\)(.*?)\$\$(.*?)\$\$;", code, re.S)
    assert m, name
    return m.group(1), m.group(2), m.group(3)


def test_a_ham_kiem_vector():
    code = code_only(sql_text())
    args, head, body = _func_body(code, "nhom_vec_hop_le")
    assert args.strip() == "v real[]"
    assert re.search(r"returns boolean\s+language sql\s+immutable\s+set search_path = ''", head)
    # tao TRUOC bang nhom_anh
    assert code.index("create or replace function public.nhom_vec_hop_le") < code.index("create table if not exists public.nhom_anh")
    # luon true / false: toan bo than boc trong coalesce(..., false)
    b = " ".join(body.split())
    assert b.startswith("select coalesce(") and b.endswith(", false );")
    for part in ("v is not null", "array_ndims(v) = 1", "array_length(v, 1) = 512", "array_position(v, null) is null",
                 "'NaN'::real", "'Infinity'::real", "'-Infinity'::real",
                 "sum(x.f::double precision * x.f::double precision)", "- 1) < 1e-3"):
        assert part in b, part
    assert "abs(sqrt(" in b
    # CHECK cua cot vec goi ham
    assert re.search(r"vec\s+real\[\] not null check \(public\.nhom_vec_hop_le\(vec\)\)", code)


def test_b_model_trung_model_id_cua_clip_engine():
    eng = (Path(__file__).resolve().parents[1] / "clip_engine.py").read_text(encoding="utf-8")
    model_id = re.search(r'^MODEL_ID = "([^"]+)"', eng, re.M).group(1)
    m = re.search(r"model\s+text not null check \(model = '([^']+)'\)", code_only(sql_text()))
    assert m and m.group(1) == model_id == "clip-vit-b32-int8-cat"


def test_c_cot_ky():
    text = sql_text()
    assert re.search(r"ky\s+text not null unique check \(ky ~ '\^\[0-9a-f\]\{64\}\$'\)", code_only(text))
    assert "chữ ký HMAC-SHA256 do máy chủ cấp khi tính vector; máy chủ bỏ mọi dòng chữ ký sai;" in text
    assert "khóa chỉ máy chủ giữ, không bao giờ ở app / SQL" in text


def test_d_ten_toi_da_200_ky_tu_ke_ca_khoang_trang():
    assert "check (char_length(ten) <= 200 and char_length(btrim(ten)) between 1 and 200)" in code_only(sql_text())


def test_e_trigger_300_mon_moi_nguoi():
    code = code_only(sql_text())
    _, head, body = _func_body(code, "nhom_san_pham_gioi_han")
    assert "security definer" not in head
    assert "set search_path = ''" in head
    assert "pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nhom_san_pham:' || new.nguoi_them::text))" in body
    assert "if n_mon >= 300 then" in body
    assert "Mỗi người chỉ được thêm tối đa 300 món vào kho nhóm." in sql_text()
    assert re.search(r"create trigger nhom_san_pham_gioi_han\s+before insert on public\.nhom_san_pham\s+"
                     r"for each row execute function public\.nhom_san_pham_gioi_han\(\);", code)
    assert "drop trigger if exists nhom_san_pham_gioi_han on public.nhom_san_pham;" in code


def test_f_storage_toi_da_300_file_moi_nguoi():
    st = {c: body for n, t, c, _, body in policies(sql_text()) if t == "storage.objects"}
    ins = re.sub(r"\s+\)", ")", re.sub(r"\(\s+", "(", " ".join(st["insert"].split())))
    # vong 3: dem qua ham (tranh de quy policy), khong con cau con doc storage.objects trong than policy
    assert "and public.nhom_anh_so_file() < 300" in ins
    assert "from storage.objects" not in ins.lower()
    _, _, body = _func_body(code_only(sql_text()), "nhom_anh_so_file")
    assert ("select count(*) from storage.objects o where o.bucket_id = 'nhom-anh' and "
            "(storage.foldername(o.name))[1] = (select auth.uid())::text") in " ".join(body.split())
    text = sql_text()
    assert "ai có tài khoản Google cũng đăng nhập được" in text
    assert "chặn (không cho tải thêm) chứ không tính tiền" in text


def test_g_xoa_file_truoc_va_k7_k6():
    text = sql_text()
    assert "app phải xóa file trong bucket TRƯỚC rồi mới xóa món (xóa món chỉ xóa dòng nhom_anh, không xóa file)" in text
    kiem = text[text.index("-- KIỂM SAU KHI CHẠY"):text.index("-- GỠ")]
    assert "Chạy riêng từng câu K1–K8 (chạy cả file thì SQL Editor chỉ hiện kết quả câu cuối)" in kiem
    assert "(K6) Trigger. Mong đợi 3 dòng" in kiem
    assert "'nhom_anh_gioi_han', 'nhom_san_pham_gioi_han', 'nhom_san_pham_truoc_sua'" in kiem
    k7 = kiem[kiem.index("(K7)"):kiem.index("(K8)")]
    assert "Mong đợi 0 dòng" in k7
    k7code = " ".join(code_only(k7).split())
    assert ("where o.bucket_id = 'nhom-anh' and not exists (select 1 from public.nhom_anh a "
            "where a.duong_dan = o.name)") in k7code
    # khoi KIEM chi doc: chi co cau select
    stmts = [s.strip() for s in code_only(kiem).split(";") if s.strip()]
    assert len(stmts) == 8 and all(s.lower().startswith("select") for s in stmts)


def test_i_khoi_go_co_ham_va_trigger_moi():
    go = sql_text()[sql_text().index("-- GỠ"):]
    for line in ("-- drop function if exists public.nhom_vec_hop_le(real[]);",
                 "-- drop function if exists public.nhom_san_pham_gioi_han();",
                 "-- drop trigger if exists nhom_san_pham_gioi_han on public.nhom_san_pham;"):
        assert line in go, line
    # bo bang nhom_anh truoc ham kiem vector (CHECK phu thuoc ham)
    assert go.index("drop table if exists public.nhom_anh;") < go.index("drop function if exists public.nhom_vec_hop_le")


def test_goi_y_policy_xoa_storage_va_update_san_pham():
    ps = {(t, c): body for n, t, c, _, body in policies(sql_text())}
    xoa = " ".join(ps[("storage.objects", "delete")].split())
    assert "using (bucket_id = 'nhom-anh' and (storage.foldername(name))[1] = (select auth.uid())::text)" in xoa
    upd = " ".join(ps[("public.nhom_san_pham", "update")].split())
    assert "using (nguoi_them = (select auth.uid())) with check (nguoi_them = (select auth.uid()))" in upd


# ---------------- vong 3 (review vong 2) ----------------
def test_j_ham_dem_file_storage():
    code = code_only(sql_text())
    args, head, body = _func_body(code, "nhom_anh_so_file")
    assert args.strip() == ""
    assert re.search(r"returns bigint\s+language sql\s+stable\s+set search_path = ''", head)
    assert "security definer" not in head
    # tao TRUOC policy them
    assert code.index("create or replace function public.nhom_anh_so_file") < code.index("create policy nhom_anh_storage_them")
    assert "revoke execute on function public.nhom_anh_so_file() from public, anon;" in code
    assert "grant execute on function public.nhom_anh_so_file() to authenticated;" in code
    # KHONG revoke quyen goi ham kiem vector (CHECK can)
    assert not re.search(r"revoke [^;]*nhom_vec_hop_le", code, re.I)
    assert ("dùng hàm có set search_path để Postgres không gộp câu đếm vào policy "
            "(tránh lỗi đệ quy policy trên storage.objects)").lower() in sql_text().lower()


def test_k_cot_ky_unique_va_cach_ky():
    text = sql_text()
    assert re.search(r"ky\s+text not null unique check", code_only(text))
    i = text.index("Cách ký (máy chủ làm ở vòng endpoint)")
    cmt = " ".join(line.strip().lstrip("-").strip() for line in text[i:text.index("ky          text")].splitlines())
    assert ('HMAC-SHA256(khóa máy chủ, "kho-nhom-v1" || 0x00 || duong_dan (UTF-8) || 0x00 || model (UTF-8) || 0x00 '
            "|| 512 số float32 little-endian của vec)") in cmt
    assert "hex thường 64 ký tự" in cmt and "Không ký chuỗi JSON" in cmt
    assert "Máy chủ kiểm lại khi nạp kho và bỏ dòng sai" in cmt
    assert "duong_dan" in cmt and "float32" in cmt


def test_l_k8_va_khoi_go_vong_3():
    text = sql_text()
    kiem = text[text.index("-- KIỂM SAU KHI CHẠY"):text.index("-- GỠ")]
    assert "(K8) Hàm của kho nhóm. Mong đợi đúng 5 dòng" in kiem
    k8code = " ".join(code_only(kiem[kiem.index("(K8)"):]).split())
    for f in ("nhom_vec_hop_le", "nhom_san_pham_truoc_sua", "nhom_san_pham_gioi_han", "nhom_anh_gioi_han", "nhom_anh_so_file"):
        assert f"'{f}'" in k8code, f
    assert "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'" in k8code
    go = text[text.index("-- GỠ"):]
    assert "-- drop function if exists public.nhom_anh_so_file();" in go
    assert "delete from storage.buckets" not in go
    assert "xóa hết ảnh rồi xóa bucket nhom-anh bằng Dashboard → Storage" in go
    # drop function sau cac drop policy storage (policy phu thuoc ham)
    assert go.index("drop policy if exists nhom_anh_storage_them") < go.index("drop function if exists public.nhom_anh_so_file")