// "Thêm vào kho nhóm" (đợt kho-nhom vòng 7): chuẩn bị ảnh, gửi máy chủ tính vector (/embed), GHI Supabase.
// Thuần: nhận client supabase-js (authClient của main.js), fetch, token, địa chỉ máy chủ làm tham số; không import thư
// viện, không gọi mạng lúc nạp. Hợp đồng /embed: server/README.md mục "Hợp đồng API kho nhóm".
// Luật ghi (chốt ở vòng 7):
// - Gửi /embed cho TẤT CẢ ảnh TRƯỚC (nối tiếp); một ảnh lỗi → dừng, KHÔNG ghi gì vào Supabase.
// - Rồi mới insert nhom_san_pham, rồi từng ảnh: tải lên bucket nhom-anh (CÙNG Blob đã gửi /embed, upsert: false) +
//   insert nhom_anh (vec, model, ky máy chủ trả).
// - Lỗi giữa chừng → dọn: xóa các file đã tải rồi xóa dòng sản phẩm (nhom_anh xóa theo cascade).
// - KHÔNG dùng update / upsert ở đâu cả (không ghi đè dữ liệu / ảnh đã có).
import { fitSize, DAILY_RETRY_MIN_S } from "./front-photo.js";
import { nhomImagePath, newUuid } from "./nhom-add.js";

/** Cỡ tối đa một ảnh (byte) = giới hạn bucket nhom-anh của server/kho-nhom.sql = giới hạn /embed. */
export const NHOM_IMAGE_MAX_BYTES = 2097152;
/** Số ảnh mỗi món (trigger của SQL chặn quá 3). */
export const NHOM_IMAGES_MAX = 3;
/** Chất lượng JPEG lần đầu / lần mã hóa lại khi ảnh còn quá 2 MB. */
export const NHOM_JPEG_QUALITY = 0.9;
export const NHOM_JPEG_QUALITY_SMALL = 0.8;
/** Hết giờ một lượt /embed (như /ocr: máy chủ ngủ dậy mất ~15 giây). */
export const EMBED_TIMEOUT_MS = 45000;
/** model máy chủ trả (MODEL_ID của server/clip_engine.py; CHECK cột model của SQL). */
export const NHOM_MODEL = "clip-vit-b32-int8-cat";
const NHOM_BUCKET = "nhom-anh";
const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

const NOT_DECODED = "Máy không đọc được ảnh này (vd ảnh HEIC trên máy tính). Hãy chụp lại hoặc chọn ảnh JPEG / PNG.";
const TOO_BIG = "Ảnh vẫn lớn hơn 2 MB sau khi thu nhỏ. Hãy chụp lại hoặc chọn ảnh khác.";

/**
 * Mã hóa JPEG có giới hạn cỡ (thuần, test bằng node): encode(q) → Promise<Blob | null>. Thử 0,9; lớn hơn 2 MB thì thử
 * lại 0,8; vẫn lớn hơn → { ok: false, message }. encode trả null / ném → { ok: false, message } (không đọc được ảnh).
 * Ví dụ: await encodeWithLimit(async (q) => blobCuaCanvas(q)) → { ok: true, blob, quality: 0.9 }
 */
export async function encodeWithLimit(encode, maxBytes = NHOM_IMAGE_MAX_BYTES) {
  for (const quality of [NHOM_JPEG_QUALITY, NHOM_JPEG_QUALITY_SMALL]) {
    let blob = null;
    try {
      blob = await encode(quality);
    } catch {
      blob = null;
    }
    if (!blob || typeof blob.size !== "number") return { ok: false, message: NOT_DECODED };
    if (blob.size <= maxBytes) return { ok: true, blob, quality };
  }
  return { ok: false, message: TOO_BIG };
}

/**
 * (Cần trình duyệt.) Ảnh người dùng chọn → { ok: true, blob (image/jpeg ≤ 2 MB), width, height } | { ok: false, message }.
 * Giải mã bằng <img>.decode() (trình duyệt tự xoay theo EXIF), thu cạnh dài ≤ 1.600 (fitSize của front-photo.js), JPEG
 * 0,9 (bỏ EXIF / GPS); > 2 MB thì 0,8. KHÔNG giải mã được (vd HEIC trên máy tính) → lỗi, KHÔNG gửi file gốc (/embed chỉ
 * nhận JPEG / PNG ≤ 2 MB, và file gốc còn EXIF / GPS).
 */
export async function prepareNhomImage(file) {
  if (!file) return { ok: false, message: "Chưa chọn ảnh." };
  let url = "";
  let canvas = null;
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const { width, height } = fitSize(img.naturalWidth, img.naturalHeight);
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    const c = canvas;
    const r = await encodeWithLimit((q) => new Promise((resolve) => c.toBlob(resolve, "image/jpeg", q)));
    return r.ok ? { ok: true, blob: r.blob, width, height } : r;
  } catch {
    return { ok: false, message: NOT_DECODED };
  } finally {
    if (canvas) canvas.width = 0; // trả bộ nhớ canvas sớm (điện thoại yếu)
    if (url) URL.revokeObjectURL(url);
  }
}

/** Số giây trong Retry-After (chỉ dạng số nguyên); không có / sai → null. */
function retryAfterOf(res) {
  const s = String(res?.headers?.get?.("Retry-After") ?? "").trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

/** <base>/embed khi base là địa chỉ http(s):// có tên máy; sai → "". */
function embedEndpoint(base) {
  if (typeof base !== "string") return "";
  const b = base.trim().replace(/\/+$/, "");
  let u;
  try { u = new URL(b); } catch { return ""; }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) return "";
  return b + "/embed";
}

/** Phản hồi 200 của /embed đúng dạng? model đúng, vec 512 số hữu hạn, ky 64 ký tự hex thường. */
function embedBodyOk(b) {
  return !!b && typeof b === "object" && b.model === NHOM_MODEL
    && Array.isArray(b.vec) && b.vec.length === 512 && b.vec.every((x) => typeof x === "number" && Number.isFinite(x))
    && typeof b.ky === "string" && /^[0-9a-f]{64}$/.test(b.ky);
}

const fail = (kind, extra = {}) => ({ ok: false, kind, ...extra });

/**
 * Gửi MỘT ảnh tới <baseUrl>/embed (multipart: image = blob, duong_dan = path) kèm Bearer token, hết giờ 45 giây.
 * Trả { ok: true, model, vec, ky } hoặc { ok: false, kind, retryAfter? }. kind:
 * notReady (404: máy chủ cũ chưa có /embed; 503 "Kho nhóm chưa bật"), busy (503 khác: hàng đợi đầy / Supabase lỗi),
 * auth (401 hoặc token rỗng: không gọi mạng), rate / daily (429 theo Retry-After như sendOcr), tooBig (413),
 * badType (415), bad (400 / 403), timeout, aborted (signal của người gọi), network, other (phản hồi sai dạng, mã lạ,
 * tham số sai: không gọi mạng).
 * Ví dụ: await sendEmbed({ baseUrl, token, blob, path: "<uid>/<uuid>.jpg" }) → { ok: true, model, vec: [512 số], ky }
 */
export async function sendEmbed({
  baseUrl, token, blob, path, fetch: fetchImpl = globalThis.fetch, signal, timeoutMs = EMBED_TIMEOUT_MS
} = {}) {
  const tok = typeof token === "string" ? token.trim() : "";
  if (!tok) return fail("auth");
  const endpoint = embedEndpoint(baseUrl);
  if (!endpoint) return fail("other");
  if (typeof Blob === "undefined" || !(blob instanceof Blob)) return fail("other");
  if (typeof path !== "string" || !PATH_RE.test(path)) return fail("other");
  if (signal?.aborted) return fail("aborted");
  const fd = new FormData();
  fd.append("image", blob, "anh.jpg");
  fd.append("duong_dan", path);

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    const res = await fetchImpl(endpoint, { method: "POST", headers: { Authorization: "Bearer " + tok }, body: fd, signal: ctrl.signal });
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      if (ctrl.signal.aborted) throw e;
      body = null;
    }
    const st = res.status;
    if (st === 200) return embedBodyOk(body) ? { ok: true, model: body.model, vec: body.vec, ky: body.ky } : fail("other", { status: 200 });
    const retryAfter = retryAfterOf(res);
    if (st === 404) return fail("notReady", { status: st });
    if (st === 503) {
      const msg = body && typeof body.error === "string" ? body.error : "";
      return fail(/chưa bật/i.test(msg) ? "notReady" : "busy", { status: st, retryAfter });
    }
    if (st === 401) return fail("auth", { status: st });
    if (st === 429) return fail(retryAfter != null && retryAfter > DAILY_RETRY_MIN_S ? "daily" : "rate", { status: st, retryAfter });
    if (st === 413) return fail("tooBig", { status: st });
    if (st === 415) return fail("badType", { status: st });
    if (st === 400 || st === 403) return fail("bad", { status: st });
    return fail("other", { status: st });
  } catch {
    if (timedOut) return fail("timeout");
    if (signal?.aborted) return fail("aborted");
    return fail("network");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

/** Lỗi Postgres của trigger giới hạn (300 món / 3 ảnh / 300 ảnh mỗi người): mã 23514 (check_violation), không đọc câu lỗi. */
const isLimitError = (e) => !!e && typeof e === "object" && (e.code === "23514" || e.code === "check_violation");

/** Ảnh hợp lệ để lưu: Blob image/jpeg, 1 byte – 2 MB. */
const imageOk = (im) => !!im && typeof Blob !== "undefined" && im.blob instanceof Blob && im.blob.type === "image/jpeg"
  && im.blob.size > 0 && im.blob.size <= NHOM_IMAGE_MAX_BYTES;

/**
 * Lưu một món vào kho nhóm. client: supabase-js đã đăng nhập; uid: id người dùng của phiên (session.user.id);
 * row: nhomRowFromForm(…).row; images: [{ blob }] (1–3 ảnh, prepareNhomImage); embed({ blob, path }) → kết quả sendEmbed.
 * cancelled(): người gọi đã hủy (vd đăng xuất) → dừng ở bước kế (đã ghi thì dọn). newId: chỉ test truyền.
 * Thứ tự CHỐT: (1) kiểm ảnh (sai → không gọi gì); (2) /embed MỌI ảnh, nối tiếp (lỗi → dừng, không ghi gì);
 * (3) insert nhom_san_pham → id; (4) mỗi ảnh: tải lên bucket (CÙNG Blob, upsert: false) rồi insert nhom_anh;
 * (5) lỗi ở (3)–(4) → xóa file đã tải + xóa dòng sản phẩm.
 * Trả { ok: true, id } hoặc { ok: false, kind, step, cleaned }: kind = kind của /embed (notReady, auth…) | limit (trigger
 * giới hạn, mã 23514) | db | upload | badImages | badInput | cancelled; step = "check" | "embed" | "product" | "upload" |
 * "image"; cleaned = true khi KHÔNG còn gì dở trên Supabase (chưa ghi gì, hoặc dọn xong), false khi dọn lỗi.
 */
export async function saveNhomProduct({ client, uid, row, images, embed, cancelled = () => false, newId = newUuid } = {}) {
  const list = Array.isArray(images) ? images : [];
  if (!list.length || list.length > NHOM_IMAGES_MAX || !list.every(imageOk)) return fail("badImages", { step: "check", cleaned: true });
  if (!row || typeof row !== "object" || typeof embed !== "function" || !client) return fail("badInput", { step: "check", cleaned: true });
  let paths;
  try {
    paths = list.map(() => nhomImagePath(uid, newId()));
  } catch {
    return fail("badInput", { step: "check", cleaned: true });
  }

  // (2) /embed cho TẤT CẢ ảnh trước, nối tiếp; chưa ghi gì nên lỗi / hủy ở đây không cần dọn.
  const embeds = [];
  for (let i = 0; i < list.length; i++) {
    if (cancelled()) return fail("cancelled", { step: "embed", cleaned: true });
    let r;
    try {
      r = await embed({ blob: list[i].blob, path: paths[i] });
    } catch {
      r = fail("other");
    }
    if (!r?.ok) return fail(r?.kind || "other", { step: "embed", cleaned: true, retryAfter: r?.retryAfter ?? null });
    embeds.push(r);
  }
  if (cancelled()) return fail("cancelled", { step: "embed", cleaned: true });

  // (3) dòng sản phẩm
  let id = null;
  try {
    const { data, error } = await client.from("nhom_san_pham").insert(row).select("id").single();
    if (error || !data || typeof data.id !== "string") return fail(isLimitError(error) ? "limit" : "db", { step: "product", cleaned: true });
    id = data.id;
  } catch {
    return fail("db", { step: "product", cleaned: true });
  }

  // (4) ảnh: tải lên rồi ghi dòng nhom_anh; lỗi → (5) dọn
  const uploaded = [];
  const cleanup = async (kind, step) => {
    let cleaned = true;
    try {
      if (uploaded.length) {
        const { error } = await client.storage.from(NHOM_BUCKET).remove(uploaded);
        if (error) cleaned = false;
      }
    } catch {
      cleaned = false;
    }
    try {
      const { error } = await client.from("nhom_san_pham").delete().eq("id", id);
      if (error) cleaned = false;
    } catch {
      cleaned = false;
    }
    return fail(kind, { step, cleaned });
  };
  for (let i = 0; i < list.length; i++) {
    if (cancelled()) return cleanup("cancelled", "upload");
    try {
      const { error } = await client.storage.from(NHOM_BUCKET).upload(paths[i], list[i].blob, { contentType: "image/jpeg", upsert: false });
      if (error) return cleanup("upload", "upload");
    } catch {
      return cleanup("upload", "upload");
    }
    uploaded.push(paths[i]);
    try {
      const e = embeds[i];
      const { error } = await client.from("nhom_anh").insert({ san_pham_id: id, duong_dan: paths[i], vec: e.vec, model: e.model, ky: e.ky });
      if (error) return cleanup(isLimitError(error) ? "limit" : "db", "image");
    } catch {
      return cleanup("db", "image");
    }
  }
  return { ok: true, id };
}

/**
 * Kết quả saveNhomProduct (lỗi) / prepareNhomImage → câu tiếng Việt cho #nhomAddMsg. ok → "Đã thêm vào kho nhóm.".
 * cleaned false (dọn lỗi) → nói rõ món có thể đã lưu dở.
 */
export function nhomSaveText(r) {
  if (r?.ok) return "Đã thêm vào kho nhóm.";
  const dirty = r?.cleaned === false ? " Món có thể đã lưu dở (dọn không xong), hãy báo người quản lý kho nhóm." : "";
  const retry = Number.isFinite(r?.retryAfter) && r.retryAfter > 0 ? r.retryAfter : null;
  switch (r?.kind) {
    case "notReady": return "Máy chủ chưa bật kho nhóm, chưa lưu gì. Thử lại sau.";
    case "limit": return "Đã chạm giới hạn kho nhóm (300 món, 300 ảnh mỗi người, 3 ảnh mỗi món)." + dirty;
    case "auth": return "Phiên đăng nhập đã hết hạn hoặc máy chủ không nhận, chưa lưu gì. Hãy đăng nhập lại rồi lưu lại.";
    case "cancelled": return "Đã dừng lưu vì bạn đã đăng xuất." + (r?.cleaned === false ? dirty : " Chưa lưu gì.");
    case "rate": return `Gửi nhanh quá, chờ ${retry != null ? `${retry} giây` : "ít giây"} rồi lưu lại. Chưa lưu gì.`;
    case "daily": return "Bạn đã dùng hết lượt máy chủ hôm nay (đổi ngày lúc 7 giờ sáng). Chưa lưu gì.";
    case "busy": return "Máy chủ đang bận, chưa lưu gì. Thử lại sau ít giây.";
    case "tooBig": return "Ảnh quá lớn (tối đa 2 MB), chưa lưu gì. Chọn ảnh khác.";
    case "badType": return "Máy chủ chỉ nhận ảnh JPEG hoặc PNG, chưa lưu gì. Chọn ảnh khác.";
    case "timeout": return "Máy chủ không trả lời kịp, chưa lưu gì. Thử lại.";
    case "network": return "Không kết nối được máy chủ, chưa lưu gì. Kiểm tra mạng rồi thử lại.";
    case "badImages": return "Cần 1–3 ảnh mặt trước (JPEG ≤ 2 MB).";
    case "upload": return "Không tải được ảnh lên kho nhóm." + (dirty || " Chưa lưu gì, thử lại sau.");
    case "db": return "Không ghi được vào kho nhóm." + (dirty || " Chưa lưu gì, thử lại sau.");
    default: return "Chưa lưu được vào kho nhóm. Thử lại sau." + dirty;
  }
}
