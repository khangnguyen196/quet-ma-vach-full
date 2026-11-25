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
    assert "array_length(vec, 1) = 512" in code and "array_ndims(vec) = 1" in code
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
