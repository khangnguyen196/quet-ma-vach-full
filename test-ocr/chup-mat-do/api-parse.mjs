// Phần thuần (không mạng) của 1c OCR.space và 4a Gemini: đọc kết quả, câu hỏi cố định, phân loại lỗi.

/** Kết quả OCR.space (isOverlayRequired=true) -> { ok, lines: [{ text, h, box: [x0, y0, x1, y1] }], error, quota }.
 *  h = MaxHeight của dòng (px trên ảnh gửi đi). */
export function parseOcrSpace(json) {
  const errMsg = [].concat(json?.ErrorMessage ?? [], json?.ErrorDetails ?? []).filter(Boolean).join(" | ");
  const quota = /maximum|limit|quota|exceed|too many|upto/i.test(errMsg);
  if (!json || json.IsErroredOnProcessing || !Array.isArray(json.ParsedResults)) {
    return { ok: false, lines: [], error: errMsg || `OCRExitCode ${json?.OCRExitCode}`, quota };
  }
  const lines = [];
  for (const pr of json.ParsedResults) {
    for (const l of pr?.TextOverlay?.Lines || []) {
      const ws = l.Words || [];
      const box = ws.length
        ? [Math.min(...ws.map((w) => w.Left)), Math.min(...ws.map((w) => w.Top)),
          Math.max(...ws.map((w) => w.Left + w.Width)), Math.max(...ws.map((w) => w.Top + w.Height))]
        : null;
      const text = String(l.LineText ?? "").trim();
      if (text) lines.push({ text, h: Number(l.MaxHeight) || (box ? box[3] - box[1] : null), box });
    }
  }
  return { ok: true, lines, error: null, quota: false };
}

/** Câu hỏi Gemini CỐ ĐỊNH (viết trước khi chạy, không gợi ý tên sản phẩm nào). */
export function geminiPrompt() {
  return [
    "Đây là ảnh chụp mặt trước bao bì một sản phẩm thực phẩm / đồ uống bán ở Việt Nam.",
    "Chỉ dựa vào chữ và hình NHÌN THẤY trên ảnh, trả về đúng một object JSON với các khóa:",
    '{"ten": tên sản phẩm in trên bao bì (giữ dấu tiếng Việt nếu có), "thuong_hieu": thương hiệu,',
    '"loai": loại sản phẩm (vd đồ uống, bánh, gia vị), "dung_tich_khoi_luong": dung tích hoặc khối lượng in trên bao bì,',
    '"tu_khoa": mảng 3–6 từ khóa ngắn để tìm sản phẩm này trên Open Food Facts}.',
    "Không đọc được trường nào thì để null (tu_khoa thì mảng rỗng). Không đoán thông tin không có trên ảnh. Chỉ trả JSON.",
  ].join("\n");
}

/** Đọc JSON từ phản hồi generateContent. Không đọc được -> null. */
export function parseGeminiJson(resp) {
  const text = (resp?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) return null;
  const m = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/g, ""));
  if (!m) return null;
  let o;
  try {
    o = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const str = (x) => (typeof x === "string" && x.trim() ? x.trim() : null);
  return {
    ten: str(o.ten),
    thuong_hieu: str(o.thuong_hieu),
    loai: str(o.loai),
    dung_tich_khoi_luong: str(o.dung_tich_khoi_luong),
    tu_khoa: Array.isArray(o.tu_khoa) ? o.tu_khoa.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [],
  };
}

/** Phân loại lỗi Gemini: "rate" (429 theo phút: chờ 60 giây thử lại 1 lần), "daily" (hết hạn mức ngày: ngừng),
 *  "billing" (đòi thanh toán / FAILED_PRECONDITION / PERMISSION_DENIED billing: ngừng ngay), "other". */
export function classifyGeminiError(status, body) {
  const st = String(body?.error?.status ?? "");
  const msg = String(body?.error?.message ?? "");
  if (/billing|payment|prepay|credit/i.test(msg) || st === "FAILED_PRECONDITION") return "billing";
  if (status === 429 || st === "RESOURCE_EXHAUSTED") {
    if (/per ?day|PerDay|daily/i.test(msg)) return "daily";
    return "rate";
  }
  return "other";
}
