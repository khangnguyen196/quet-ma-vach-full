-- Kho sản phẩm của nhóm (đợt kho-nhom) — SQL cho Supabase (gói miễn phí).
-- CHỦ DỰ ÁN tự chạy trong Supabase Dashboard → SQL Editor (máy KHÔNG chạy file này trên Supabase thật).
-- Chạy lại nhiều lần được (idempotent): create … if not exists, drop policy if exists rồi create, on conflict cho bucket.
-- Không dùng khóa bí mật / vai trò quản trị; mọi quyền đi qua RLS với token của chính người dùng.
--
-- Gồm:
--   1. Bảng public.nhom_san_pham: thông tin món do nhóm nhập (tên, thương hiệu, khối lượng, mã vạch, thành phần,
--      dinh dưỡng, dị ứng, nguồn, người thêm, thời gian).
--   2. Bảng public.nhom_anh: ảnh mặt trước (đường dẫn trong bucket) + vector ảnh CLIP 512 số (độ dài 1, đúng model)
--      + chữ ký HMAC của máy chủ (cột ky). Hàm public.nhom_vec_hop_le kiểm vector.
--   3. Trigger: cập nhật sua_luc; giới hạn ≤ 300 món / người, ≤ 3 ảnh / sản phẩm và ≤ 300 ảnh / người
--      (bảo vệ gói miễn phí).
--   4. RLS: chỉ người đã đăng nhập đọc; ai đăng nhập cũng thêm được; chỉ người thêm sửa / xóa món của mình.
--   5. Bucket ảnh riêng tư "nhom-anh" (≤ 2 MB / ảnh, jpeg / png / webp) + policy trên storage.objects
--      (policy thêm đếm file qua hàm public.nhom_anh_so_file).
--   Cuối file: khối "KIỂM SAU KHI CHẠY" (chạy được, kết quả mong đợi ghi trong comment) và khối "GỠ" (trong comment).

-- ===================================================================================================================
-- 1. Bảng sản phẩm của nhóm
-- ===================================================================================================================
create table if not exists public.nhom_san_pham (
  id          uuid primary key default gen_random_uuid(),
  nguoi_them  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- tên: tối đa 200 ký tự kể cả khoảng trắng, và sau khi bỏ khoảng trắng hai đầu còn 1–200 ký tự
  ten         text not null check (char_length(ten) <= 200 and char_length(btrim(ten)) between 1 and 200),
  thuong_hieu text check (thuong_hieu is null or char_length(thuong_hieu) <= 200),
  khoi_luong  text check (khoi_luong is null or char_length(khoi_luong) <= 200),
  ma_vach     text check (ma_vach is null or ma_vach ~ '^[0-9]{8,14}$'),
  thanh_phan  text check (thanh_phan is null or char_length(thanh_phan) <= 5000),
  -- dinh dưỡng: null hoặc object JSON, cỡ lưu ≤ 8 KB
  dinh_duong  jsonb check (dinh_duong is null or (jsonb_typeof(dinh_duong) = 'object' and pg_column_size(dinh_duong) <= 8192)),
  -- dị ứng: đúng 14 mã nhóm src/off.js đang map (ALLERGEN_VI / ALLERGEN_KEYS), không mã nào khác
  di_ung      text[] not null default '{}' check (di_ung <@ array[
                'gluten', 'milk', 'eggs', 'nuts', 'peanuts', 'soybeans', 'fish', 'crustaceans', 'molluscs',
                'celery', 'mustard', 'sesame-seeds', 'lupin', 'sulphur-dioxide-and-sulphites'
              ]::text[] and array_position(di_ung, null) is null),
  -- nguồn thông tin: tay = người dùng gõ; off = lấy từ Open Food Facts; ocr-mat-sau = máy chủ đọc chữ mặt sau
  nguon       text not null default 'tay' check (nguon in ('tay', 'off', 'ocr-mat-sau')),
  tao_luc     timestamptz not null default now(),
  sua_luc     timestamptz not null default now()
);

create index if not exists nhom_san_pham_nguoi_them_idx on public.nhom_san_pham (nguoi_them);
create index if not exists nhom_san_pham_ma_vach_idx on public.nhom_san_pham (ma_vach) where ma_vach is not null;

-- ===================================================================================================================
-- 2. Bảng ảnh + vector
-- ===================================================================================================================
-- XÓA MÓN: app phải xóa file trong bucket TRƯỚC rồi mới xóa món (xóa món chỉ xóa dòng nhom_anh, không xóa file).
-- Khóa ngoại "on delete cascade" chỉ xóa dòng nhom_anh; file trong bucket nhom-anh vẫn còn (file mồ côi, chiếm chỗ).
-- Câu K7 ở khối KIỂM tìm file mồ côi.
--
-- Vector ảnh KHÔNG tin app: máy chủ tính vector từ ảnh rồi ký HMAC-SHA256 (cột ky); máy chủ bỏ mọi dòng chữ ký sai.
-- Hàm dưới đây là lớp chặn thêm trong SQL: vector phải đúng 512 số hữu hạn, độ dài (chuẩn L2) ≈ 1.
-- Luôn trả true / false, không bao giờ NULL (CHECK coi NULL là qua, nên mọi nhánh đi qua coalesce(…, false)).
create or replace function public.nhom_vec_hop_le(v real[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    v is not null
    and array_ndims(v) = 1
    and array_length(v, 1) = 512
    and array_position(v, null) is null
    and not exists (
      select 1 from unnest(v) as x(f)
      where x.f = 'NaN'::real or x.f = 'Infinity'::real or x.f = '-Infinity'::real
    )
    and abs(sqrt((select sum(x.f::double precision * x.f::double precision) from unnest(v) as x(f))) - 1) < 1e-3,
    false
  );
$$;

create table if not exists public.nhom_anh (
  id          uuid primary key default gen_random_uuid(),
  san_pham_id uuid not null references public.nhom_san_pham (id) on delete cascade,
  nguoi_them  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- đường dẫn trong bucket nhom-anh: "<uid người thêm>/<uuid ảnh>.<đuôi>"
  duong_dan   text not null unique check (duong_dan ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  -- vector ảnh CLIP ViT-B/32: 1 chiều, 512 số, không null / NaN / vô cực, độ dài ≈ 1 (xem nhom_vec_hop_le)
  vec         real[] not null check (public.nhom_vec_hop_le(vec)),
  -- đúng MODEL_ID của server/clip_engine.py
  model       text not null check (model = 'clip-vit-b32-int8-cat'),
  -- chữ ký HMAC-SHA256 do máy chủ cấp khi tính vector; máy chủ bỏ mọi dòng chữ ký sai;
  -- khóa chỉ máy chủ giữ, không bao giờ ở app / SQL
  -- Cách ký (máy chủ làm ở vòng endpoint):
  --   HMAC-SHA256(khóa máy chủ, "kho-nhom-v1" || 0x00 || duong_dan (UTF-8) || 0x00 || model (UTF-8) || 0x00
  --               || 512 số float32 little-endian của vec)
  --   ghi hex thường 64 ký tự. Không ký chuỗi JSON. Máy chủ kiểm lại khi nạp kho và bỏ dòng sai.
  --   Chữ ký phủ duong_dan (chứa uid, duy nhất) nên không chép được cặp vec + ky sang dòng của người khác.
  -- unique: lớp chặn rẻ (chữ ký đã phủ duong_dan nên dữ liệu đúng không bao giờ trùng).
  ky          text not null unique check (ky ~ '^[0-9a-f]{64}$'),
  tao_luc     timestamptz not null default now()
);

create index if not exists nhom_anh_san_pham_id_idx on public.nhom_anh (san_pham_id);
create index if not exists nhom_anh_nguoi_them_idx on public.nhom_anh (nguoi_them);

-- ===================================================================================================================
-- 3. Trigger
-- ===================================================================================================================
-- 3a. sua_luc tự cập nhật; tao_luc và nguoi_them không đổi được khi sửa.
create or replace function public.nhom_san_pham_truoc_sua()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sua_luc := now();
  new.tao_luc := old.tao_luc;
  new.nguoi_them := old.nguoi_them;
  return new;
end;
$$;

drop trigger if exists nhom_san_pham_truoc_sua on public.nhom_san_pham;
create trigger nhom_san_pham_truoc_sua
  before update on public.nhom_san_pham
  for each row execute function public.nhom_san_pham_truoc_sua();

-- 3b. Giới hạn số món: ≤ 300 món / người. Cùng kiểu 3c: KHÔNG security definer (policy SELECT cho người đăng nhập đọc
-- mọi dòng nên đếm thấy đủ), khóa theo người thêm để 2 lần thêm cùng lúc không vượt. Chỉ cần lúc thêm: trigger 3a
-- không cho đổi nguoi_them khi sửa.
create or replace function public.nhom_san_pham_gioi_han()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n_mon integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nhom_san_pham:' || new.nguoi_them::text));
  select count(*) into n_mon from public.nhom_san_pham sp
    where sp.nguoi_them = new.nguoi_them;
  if n_mon >= 300 then
    raise exception 'Mỗi người chỉ được thêm tối đa 300 món vào kho nhóm.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists nhom_san_pham_gioi_han on public.nhom_san_pham;
create trigger nhom_san_pham_gioi_han
  before insert on public.nhom_san_pham
  for each row execute function public.nhom_san_pham_gioi_han();

-- 3c. Giới hạn số ảnh: ≤ 3 ảnh / sản phẩm, ≤ 300 ảnh / người.
-- Chạy với quyền của người gọi (KHÔNG security definer): policy SELECT cho người đăng nhập đọc mọi dòng nhom_anh nên
-- đếm thấy đủ. Khóa theo người thêm (pg_advisory_xact_lock) để 2 lần thêm cùng lúc không vượt giới hạn.
create or replace function public.nhom_anh_gioi_han()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n_sp    integer;
  n_nguoi integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nhom_anh:' || new.nguoi_them::text));
  select count(*) into n_sp from public.nhom_anh a
    where a.san_pham_id = new.san_pham_id and a.id is distinct from new.id;
  if n_sp >= 3 then
    raise exception 'Mỗi sản phẩm chỉ được tối đa 3 ảnh.' using errcode = 'check_violation';
  end if;
  select count(*) into n_nguoi from public.nhom_anh a
    where a.nguoi_them = new.nguoi_them and a.id is distinct from new.id;
  if n_nguoi >= 300 then
    raise exception 'Mỗi người chỉ được thêm tối đa 300 ảnh vào kho nhóm.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists nhom_anh_gioi_han on public.nhom_anh;
create trigger nhom_anh_gioi_han
  before insert or update of san_pham_id, nguoi_them on public.nhom_anh
  for each row execute function public.nhom_anh_gioi_han();

-- ===================================================================================================================
-- 4. Quyền + RLS
-- ===================================================================================================================
alter table public.nhom_san_pham enable row level security;
alter table public.nhom_anh enable row level security;

-- Khách chưa đăng nhập (anon) không có quyền gì; người đăng nhập có quyền bảng, RLS lọc từng dòng.
revoke all on public.nhom_san_pham from anon;
revoke all on public.nhom_anh from anon;
grant select, insert, update, delete on public.nhom_san_pham to authenticated;
grant select, insert, update, delete on public.nhom_anh to authenticated;

-- 4a. nhom_san_pham
drop policy if exists nhom_san_pham_doc on public.nhom_san_pham;
create policy nhom_san_pham_doc on public.nhom_san_pham
  for select to authenticated
  using (true);

drop policy if exists nhom_san_pham_them on public.nhom_san_pham;
create policy nhom_san_pham_them on public.nhom_san_pham
  for insert to authenticated
  with check (nguoi_them = (select auth.uid()));

drop policy if exists nhom_san_pham_sua on public.nhom_san_pham;
create policy nhom_san_pham_sua on public.nhom_san_pham
  for update to authenticated
  using (nguoi_them = (select auth.uid()))
  with check (nguoi_them = (select auth.uid()));

drop policy if exists nhom_san_pham_xoa on public.nhom_san_pham;
create policy nhom_san_pham_xoa on public.nhom_san_pham
  for delete to authenticated
  using (nguoi_them = (select auth.uid()));

-- 4b. nhom_anh: chỉ gắn ảnh vào món của chính mình, đường dẫn phải nằm trong thư mục của chính mình.
drop policy if exists nhom_anh_doc on public.nhom_anh;
create policy nhom_anh_doc on public.nhom_anh
  for select to authenticated
  using (true);

drop policy if exists nhom_anh_them on public.nhom_anh;
create policy nhom_anh_them on public.nhom_anh
  for insert to authenticated
  with check (
    nguoi_them = (select auth.uid())
    and split_part(duong_dan, '/', 1) = (select auth.uid())::text
    and exists (select 1 from public.nhom_san_pham sp where sp.id = san_pham_id and sp.nguoi_them = (select auth.uid()))
  );

-- Sửa ảnh: cùng điều kiện như thêm (chặn đổi san_pham_id sang món của người khác / đổi đường dẫn sang thư mục khác).
drop policy if exists nhom_anh_sua on public.nhom_anh;
create policy nhom_anh_sua on public.nhom_anh
  for update to authenticated
  using (nguoi_them = (select auth.uid()))
  with check (
    nguoi_them = (select auth.uid())
    and split_part(duong_dan, '/', 1) = (select auth.uid())::text
    and exists (select 1 from public.nhom_san_pham sp where sp.id = san_pham_id and sp.nguoi_them = (select auth.uid()))
  );

drop policy if exists nhom_anh_xoa on public.nhom_anh;
create policy nhom_anh_xoa on public.nhom_anh
  for delete to authenticated
  using (nguoi_them = (select auth.uid()));

-- ===================================================================================================================
-- 5. Bucket ảnh riêng tư + policy storage
-- ===================================================================================================================
-- Ảnh app thu nhỏ cạnh dài ≤ 1.600 px, JPEG 0,9 (thường 80–300 KB): giới hạn 2 MB / ảnh là đủ.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nhom-anh', 'nhom-anh', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Đọc: mọi người đã đăng nhập (để thấy ảnh món của nhóm).
drop policy if exists nhom_anh_storage_doc on storage.objects;
create policy nhom_anh_storage_doc on storage.objects
  for select to authenticated
  using (bucket_id = 'nhom-anh');

-- Số file của người đang đăng nhập trong bucket nhom-anh (policy thêm bên dưới dùng).
-- Dùng hàm có set search_path để Postgres không gộp câu đếm vào policy (tránh lỗi đệ quy policy trên storage.objects):
-- câu con đọc storage.objects nằm thẳng trong policy của chính storage.objects thì chỉ cần một policy SELECT nào đó
-- trên storage.objects có câu con (kể cả của bucket khác) là mọi lần tải ảnh báo "infinite recursion detected in policy".
-- Chạy với quyền của người gọi (KHÔNG security definer): policy đọc cho thấy mọi file nhom-anh nên đếm đủ.
-- Chỉ người đăng nhập được gọi.
create or replace function public.nhom_anh_so_file()
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*) from storage.objects o
  where o.bucket_id = 'nhom-anh' and (storage.foldername(o.name))[1] = (select auth.uid())::text
$$;

revoke execute on function public.nhom_anh_so_file() from public, anon;
grant execute on function public.nhom_anh_so_file() to authenticated;

-- Thêm: chỉ vào thư mục mang uid của chính mình, tên đúng dạng "<uid>/<uuid>.<jpg|png|webp>", và thư mục đó đang có
-- dưới 300 file (đếm cả file chưa có dòng nhom_anh, nên tải file mà không thêm dòng cũng không vượt được 300 file).
-- Rủi ro còn lại: ai có tài khoản Google cũng đăng nhập được, nên nhiều tài khoản vẫn làm đầy được 1 GB storage;
-- gói miễn phí của Supabase chặn (không cho tải thêm) chứ không tính tiền. Đếm không khóa: tải song song cùng lúc
-- có thể vượt 300 vài file.
drop policy if exists nhom_anh_storage_them on storage.objects;
create policy nhom_anh_storage_them on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'nhom-anh'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and public.nhom_anh_so_file() < 300
  );

-- Xóa: theo THƯ MỤC ĐẦU = uid (chọn cách này thay vì owner_id): policy thêm đã ép mọi ảnh của một người nằm trong thư
-- mục uid của người đó, nên thư mục đầu chính là người thêm; cách này không phụ thuộc cột owner_id (có thể trống nếu
-- ảnh được tải bằng đường khác) và cùng một luật với policy thêm, dễ kiểm.
drop policy if exists nhom_anh_storage_xoa on storage.objects;
create policy nhom_anh_storage_xoa on storage.objects
  for delete to authenticated
  using (bucket_id = 'nhom-anh' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Không có policy UPDATE: không ai ghi đè / đổi tên ảnh đã tải (muốn đổi ảnh thì xóa rồi tải ảnh mới).

-- ===================================================================================================================
-- KIỂM SAU KHI CHẠY (chỉ đọc; chạy riêng từng câu trong SQL Editor, so với kết quả mong đợi ở comment)
-- ===================================================================================================================
-- Chạy riêng từng câu K1–K8 (chạy cả file thì SQL Editor chỉ hiện kết quả câu cuối).
-- (K1) RLS bật cả 2 bảng. Mong đợi 2 dòng, cột rls = true:
--      nhom_anh | true
--      nhom_san_pham | true
select c.relname, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('nhom_san_pham', 'nhom_anh')
order by c.relname;

-- (K2) Policy 2 bảng. Mong đợi 8 dòng, mọi dòng roles = {authenticated}:
--      nhom_anh | nhom_anh_doc | SELECT ; nhom_anh_sua | UPDATE ; nhom_anh_them | INSERT ; nhom_anh_xoa | DELETE
--      nhom_san_pham | nhom_san_pham_doc | SELECT ; …_sua | UPDATE ; …_them | INSERT ; …_xoa | DELETE
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename in ('nhom_san_pham', 'nhom_anh')
order by tablename, policyname;

-- (K3) Policy storage. Mong đợi 3 dòng, roles = {authenticated}, KHÔNG có dòng UPDATE:
--      nhom_anh_storage_doc | SELECT ; nhom_anh_storage_them | INSERT ; nhom_anh_storage_xoa | DELETE
--      (policy them dùng hàm nhom_anh_so_file để đếm file, xem K8).
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'nhom_anh_storage_%'
order by policyname;

-- (K4) Bucket. Mong đợi 1 dòng: nhom-anh | false | 2097152 | {image/jpeg,image/png,image/webp}
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'nhom-anh';

-- (K5) Khách (anon) không có quyền bảng. Mong đợi 0 dòng.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name in ('nhom_san_pham', 'nhom_anh');

-- (K6) Trigger. Mong đợi 3 dòng: nhom_anh_gioi_han (trên nhom_anh), nhom_san_pham_gioi_han và
--      nhom_san_pham_truoc_sua (trên nhom_san_pham).
select tgname, tgrelid::regclass as bang
from pg_trigger
where tgname in ('nhom_anh_gioi_han', 'nhom_san_pham_gioi_han', 'nhom_san_pham_truoc_sua')
order by tgname;

-- (K7) File mồ côi: file trong bucket nhom-anh không có dòng nhom_anh nào cùng duong_dan. Mong đợi 0 dòng
--      (ngay lúc có người đang thêm ảnh thì có thể thấy tạm 1 file: app tải file trước rồi mới thêm dòng).
select o.name, o.created_at
from storage.objects o
where o.bucket_id = 'nhom-anh'
  and not exists (select 1 from public.nhom_anh a where a.duong_dan = o.name)
order by o.name;

-- (K8) Hàm của kho nhóm. Mong đợi đúng 5 dòng, cột security_definer = false, cột cau_hinh = {search_path=""}:
--      nhom_anh_gioi_han ; nhom_anh_so_file ; nhom_san_pham_gioi_han ; nhom_san_pham_truoc_sua ; nhom_vec_hop_le
select p.proname, p.prosecdef as security_definer, p.proconfig as cau_hinh
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('nhom_vec_hop_le', 'nhom_san_pham_truoc_sua', 'nhom_san_pham_gioi_han', 'nhom_anh_gioi_han',
                    'nhom_anh_so_file')
order by p.proname;

-- ===================================================================================================================
-- GỠ (để trong comment; chỉ chạy khi muốn bỏ hẳn kho nhóm — MẤT HẾT dữ liệu kho nhóm, không lấy lại được)
-- ===================================================================================================================
-- Bước 1: xóa hết ảnh rồi xóa bucket nhom-anh bằng Dashboard → Storage.
-- Bước 2 (SQL Editor sẽ hỏi xác nhận vì có lệnh drop):
-- drop policy if exists nhom_anh_storage_doc on storage.objects;
-- drop policy if exists nhom_anh_storage_them on storage.objects;
-- drop policy if exists nhom_anh_storage_xoa on storage.objects;
-- drop function if exists public.nhom_anh_so_file();
-- drop trigger if exists nhom_san_pham_gioi_han on public.nhom_san_pham;
-- drop table if exists public.nhom_anh;
-- drop table if exists public.nhom_san_pham;
-- drop function if exists public.nhom_anh_gioi_han();
-- drop function if exists public.nhom_san_pham_gioi_han();
-- drop function if exists public.nhom_san_pham_truoc_sua();
-- drop function if exists public.nhom_vec_hop_le(real[]);
