// Kho sản phẩm của nhóm: ĐỌC dữ liệu từ Supabase (đợt kho-nhom vòng 6). Thuần: nhận client supabase-js (authClient của
// main.js, đã đăng nhập) làm tham số, không import thư viện, không gọi mạng lúc nạp. CHỈ ĐỌC (RLS: người đăng nhập đọc
// mọi món); vòng 7 mới thêm hàm ghi. Mọi lỗi (mạng, RLS, dữ liệu lạ, client thiếu hàm) → { ok: false } / null, không ném.
import { isNhomId } from "./front-nhom.js";

/** Cột đọc của bảng nhom_san_pham (server/kho-nhom.sql); KHÔNG đọc nguoi_them (không cần để hiển thị). */
export const NHOM_COLUMNS = "id,ten,thuong_hieu,khoi_luong,ma_vach,thanh_phan,dinh_duong,di_ung,nguon,tao_luc";
/** Bucket ảnh riêng tư của kho nhóm và thời hạn URL ký (giây). */
export const NHOM_BUCKET = "nhom-anh";
export const NHOM_SIGN_SECONDS = 600;
// đường dẫn trong bucket: "<uid>/<uuid ảnh>.<jpg|png|webp>" (CHECK cột duong_dan của kho-nhom.sql)
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/**
 * Một món nhóm theo id → { ok: true, row } hoặc { ok: false } (id sai dạng, lỗi, không có dòng).
 * Ví dụ: await fetchNhomProduct(client, "0d0d…") → { ok: true, row: { id, ten, … } }
 */
export async function fetchNhomProduct(client, id) {
  if (!isNhomId(id)) return { ok: false };
  try {
    const { data, error } = await client.from("nhom_san_pham").select(NHOM_COLUMNS).eq("id", id).maybeSingle();
    if (error || !data || typeof data !== "object" || Array.isArray(data) || data.id !== id) return { ok: false };
    return { ok: true, row: data };
  } catch {
    return { ok: false };
  }
}

/**
 * URL ký (NHOM_SIGN_SECONDS giây) của ảnh đầu tiên của món (nhom_anh theo san_pham_id, tao_luc tăng dần, 1 dòng), hoặc
 * null (không có ảnh, lỗi, đường dẫn sai dạng). render.js còn kiểm URL (https, đúng host Supabase) trước khi vẽ.
 */
export async function nhomImageUrl(client, id) {
  if (!isNhomId(id)) return null;
  try {
    const { data, error } = await client.from("nhom_anh").select("duong_dan").eq("san_pham_id", id)
      .order("tao_luc", { ascending: true }).limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    const path = data[0]?.duong_dan;
    if (typeof path !== "string" || !PATH_RE.test(path)) return null;
    const res = await client.storage.from(NHOM_BUCKET).createSignedUrl(path, NHOM_SIGN_SECONDS);
    const url = res?.data?.signedUrl;
    if (res?.error || typeof url !== "string" || !url) return null;
    return url;
  } catch {
    return null;
  }
}
