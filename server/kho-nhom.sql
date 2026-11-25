-- Kho sản phẩm của nhóm (đợt kho-nhom) — SQL cho Supabase (gói miễn phí).
-- CHỦ DỰ ÁN tự chạy trong Supabase Dashboard → SQL Editor (máy KHÔNG chạy file này trên Supabase thật).
-- Chạy lại nhiều lần được (idempotent): create … if not exists, drop policy if exists rồi create, on conflict cho bucket.
-- Không dùng khóa bí mật / vai trò quản trị; mọi quyền đi qua RLS với token của chính người dùng.
--
-- Gồm:
--   1. Bảng public.nhom_san_pham: thông tin món do nhóm nhập (tên, thương hiệu, khối lượng, mã vạch, thành phần,
--      dinh dưỡng, dị ứng, nguồn, người thêm, thời gian).
--   2. Bảng public.nhom_anh: ảnh mặt trước (đường dẫn trong bucket) + vector ảnh CLIP 512 số.
--   3. Trigger: cập nhật sua_luc; giới hạn ≤ 3 ảnh / sản phẩm và ≤ 300 ảnh / người (bảo vệ gói miễn phí).
--   4. RLS: chỉ người đã đăng nhập đọc; ai đăng nhập cũng thêm được; chỉ người thêm sửa / xóa món của mình.
--   5. Bucket ảnh riêng tư "nhom-anh" (≤ 2 MB / ảnh, jpeg / png / webp) + policy trên storage.objects.
--   Cuối file: khối "KIỂM SAU KHI CHẠY" (chạy được, kết quả mong đợi ghi trong comment) và khối "GỠ" (trong comment).

-- ===================================================================================================================
-- 1. Bảng sản phẩm của nhóm
-- ===================================================================================================================
create table if not exists public.nhom_san_pham (
  id          uuid primary key default gen_random_uuid(),
  nguoi_them  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ten         text not null check (char_length(btrim(ten)) between 1 and 200),
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
create table if not exists public.nhom_anh (
  id          uuid primary key default gen_random_uuid(),
  san_pham_id uuid not null references public.nhom_san_pham (id) on delete cascade,
  nguoi_them  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- đường dẫn trong bucket nhom-anh: "<uid người thêm>/<uuid ảnh>.<đuôi>"
  duong_dan   text not null unique check (duong_dan ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  -- vector ảnh CLIP ViT-B/32: đúng 1 chiều, 512 số, không có null / NaN
  vec         real[] not null check (
                array_ndims(vec) = 1 and array_length(vec, 1) = 512
                and array_position(vec, null) is null and not ('NaN'::real = any (vec))
              ),
  model       text not null check (char_length(model) between 1 and 100),
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

-- 3b. Giới hạn số ảnh: ≤ 3 ảnh / sản phẩm, ≤ 300 ảnh / người.
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

-- Thêm: chỉ vào thư mục mang uid của chính mình, tên đúng dạng "<uid>/<uuid>.<jpg|png|webp>".
drop policy if exists nhom_anh_storage_them on storage.objects;
create policy nhom_anh_storage_them on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'nhom-anh'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
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

-- (K6) Trigger. Mong đợi 2 dòng: nhom_anh_gioi_han (trên nhom_anh) và nhom_san_pham_truoc_sua (trên nhom_san_pham).
select tgname, tgrelid::regclass as bang
from pg_trigger
where tgname in ('nhom_anh_gioi_han', 'nhom_san_pham_truoc_sua')
order by tgname;

-- ===================================================================================================================
-- GỠ (để trong comment; chỉ chạy khi muốn bỏ hẳn kho nhóm — MẤT HẾT dữ liệu kho nhóm, không lấy lại được)
-- ===================================================================================================================
-- Bước 1: xóa hết ảnh trong bucket "nhom-anh" bằng Dashboard → Storage (Supabase không cho xóa thẳng bảng
--         storage.objects bằng SQL), rồi xóa bucket ở đó hoặc chạy: delete from storage.buckets where id = 'nhom-anh';
-- Bước 2:
-- drop policy if exists nhom_anh_storage_doc on storage.objects;
-- drop policy if exists nhom_anh_storage_them on storage.objects;
-- drop policy if exists nhom_anh_storage_xoa on storage.objects;
-- drop table if exists public.nhom_anh;
-- drop table if exists public.nhom_san_pham;
-- drop function if exists public.nhom_anh_gioi_han();
-- drop function if exists public.nhom_san_pham_truoc_sua();
