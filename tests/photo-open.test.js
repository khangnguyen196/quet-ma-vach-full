// Đợt tu-dong vòng 4: "Chụp mặt trước" TỰ MỞ sản phẩm xếp đầu.
// Phần thuần: photoOutcome / photoMessage / isUnconfirmed / afterResultScroll (kind) của src/front-photo.js,
// joinOffResults của src/front-merge.js; phần HTML: khung "Nhận ra tự động…", dòng dị ứng chưa xác nhận, gợi ý khác,
// "Chưa tìm thấy…", ô sửa chữ (render.js). Không DOM, không gọi mạng. Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as render from "../src/render.js";
// import động + catch: chưa có hàm thì từng test đỏ riêng (thử đỏ / xanh), không phải lỗi cả file
const fp = await import("../src/front-photo.js").catch(() => ({}));
const fm = await import("../src/front-merge.js").catch(() => ({}));

const IMG = "https://images.openfoodfacts.org/images/products/893/458/875/2117/front_en.7.200.jpg";
const item = (code, extra = {}) => ({ code, name: "Sản phẩm " + code, brand: "Hãng " + code, img: "", source: "catalog", vn: true, score: 1, ...extra });
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const ASK = "Nhận ra tự động từ ảnh, có thể nhầm. Có phải sản phẩm này?";
const UNCONFIRMED = "Sản phẩm nhận ra từ ảnh, chưa xác nhận: kiểm tra tên trên bao bì trước khi tin cảnh báo dị ứng";
const NONE = "Chưa tìm thấy sản phẩm này trong dữ liệu Open Food Facts";

// ---------------------------------------------------------------------------
// Phần thuần
// ---------------------------------------------------------------------------

describe("photoOutcome: kết quả gộp → mở mục 1 / chưa tìm thấy", () => {
  test("≥ 1 mục → open, top = mục 1, others = tối đa 4 mục sau (giữ thứ tự)", () => {
    const merged = ["1000000000001", "1000000000002", "1000000000003", "1000000000004", "1000000000005", "1000000000006"].map((c) => item(c));
    const o = fp.photoOutcome(merged);
    assert.equal(o.kind, "open");
    assert.equal(o.top.code, "1000000000001");
    assert.deepEqual(o.others.map((x) => x.code), ["1000000000002", "1000000000003", "1000000000004", "1000000000005"]);
  });

  test("đúng 1 mục → open, others rỗng", () => {
    const o = fp.photoOutcome([item("8934588752117")]);
    assert.equal(o.kind, "open");
    assert.deepEqual(o.others, []);
  });

  test("0 mục / không phải mảng → none, top null, others rỗng", () => {
    for (const m of [[], null, undefined, "x", { length: 1 }]) {
      assert.deepEqual(fp.photoOutcome(m), { kind: "none", top: null, others: [] }, JSON.stringify(m));
    }
  });

  test("mục có mã không phải 8–14 chữ số bị bỏ (không mở, không vẽ)", () => {
    const o = fp.photoOutcome([item("abc"), item("123"), null, item("8934588752117"), item("8934588022111")]);
    assert.equal(o.top.code, "8934588752117");
    assert.deepEqual(o.others.map((x) => x.code), ["8934588022111"]);
    assert.equal(fp.photoOutcome([item("x1")]).kind, "none");
  });
});

describe("photoMessage: câu #frontMsg sau khi tìm", () => {
  test("OFF lỗi (đã gọi, không câu nào trả được) → câu ngắn 'Không tìm thêm được…', không cảnh báo đỏ", () => {
    for (const kind of ["open", "none"]) {
      const m = fp.photoMessage({ kind, offFailed: true });
      assert.equal(m.text, "Không tìm thêm được trên Open Food Facts, đang dùng danh mục trong app.");
      assert.equal(m.warn, false);
    }
  });

  test("OFF được / không gọi: mở → câu trung tính; không có → câu 'Chưa tìm thấy…'", () => {
    // Đổi expected (vòng 5, NÊN SỬA 1 vòng 4): câu cũ "Đã mở sản phẩm khớp nhất bên dưới. Hãy kiểm tra…" nói sai khi trang
    // sản phẩm lỗi / người dùng đã tra mã khác / đã bấm "Đúng" → câu trung tính, không khẳng định trang đang hiện.
    const open = fp.photoMessage({ kind: "open", offFailed: false });
    assert.equal(open.text, "Đã tìm xong, xem kết quả bên dưới.");
    assert.doesNotMatch(open.text, /Đã mở sản phẩm khớp nhất|kiểm tra/i);
    assert.equal(open.warn, false);
    const none = fp.photoMessage({ kind: "none", offFailed: false });
    assert.match(none.text, new RegExp(NONE));
    assert.equal(none.warn, false);
  });

  test("hằng câu chờ OFF", () => {
    assert.equal(fp.OFF_WAIT_TEXT, "Đang tìm thêm trên Open Food Facts…");
    assert.equal(fp.OFF_FAIL_TEXT, "Không tìm thêm được trên Open Food Facts, đang dùng danh mục trong app.");
  });
});

describe("extraWaitMessage: câu chờ kho phụ khi OFF đã xong mà kho phụ chưa xong (vòng 8, gợi ý 1 vòng 7)", () => {
  const WAIT = "Đang tải thêm dữ liệu sản phẩm, lần đầu có thể lâu hơn…";
  test("hằng câu chờ kho phụ: khác câu chờ OFF, không nhắc Open Food Facts", () => {
    assert.equal(fp.EXTRA_WAIT_TEXT, WAIT);
    assert.notEqual(fp.EXTRA_WAIT_TEXT, fp.OFF_WAIT_TEXT);
    assert.doesNotMatch(fp.EXTRA_WAIT_TEXT, /Open Food Facts/);
  });
  test("kho phụ chưa xong + lượt chưa cũ → câu chờ", () => {
    assert.equal(fp.extraWaitMessage({ extraDone: false, stale: false }), WAIT);
  });
  test("kho phụ đã xong (kể cả trước OFF) / lượt đã cũ → không câu (null)", () => {
    assert.equal(fp.extraWaitMessage({ extraDone: true, stale: false }), null);
    assert.equal(fp.extraWaitMessage({ extraDone: false, stale: true }), null);
    assert.equal(fp.extraWaitMessage({ extraDone: true, stale: true }), null);
  });
  test("giá trị lạ (không phải boolean) → không câu (null), không ném", () => {
    for (const a of [undefined, null, {}, { extraDone: 0, stale: false }, { extraDone: false }, { extraDone: "no", stale: "no" }]) {
      assert.equal(fp.extraWaitMessage(a), null, JSON.stringify(a));
    }
  });
});

describe("photoFollowMessage: #frontMsg sau khi lượt tự mở xong / bị thay (vòng 5, NÊN SỬA 1 vòng 4)", () => {
  test("trang sản phẩm tự mở lỗi / không có trên OFF → câu tương ứng (cảnh báo)", () => {
    assert.deepEqual(fp.photoFollowMessage("openFailed"), { text: "Không mở được trang sản phẩm khớp nhất, xem bên dưới.", warn: true });
  });
  test("tra mã không từ ảnh / đã bấm Đúng → xóa câu", () => {
    assert.deepEqual(fp.photoFollowMessage("notPhoto"), { text: "", warn: false });
    assert.deepEqual(fp.photoFollowMessage("confirmed"), { text: "", warn: false });
  });
  test("không câu nào còn nhắc 'Hãy kiểm tra' / 'Đã mở sản phẩm khớp nhất'", () => {
    for (const k of ["openFailed", "notPhoto", "confirmed", "x", undefined]) {
      assert.doesNotMatch(fp.photoFollowMessage(k).text, /Hãy kiểm tra|Đã mở sản phẩm khớp nhất/);
    }
    assert.deepEqual(fp.photoFollowMessage("x"), { text: "", warn: false });
  });
});

describe("isUnconfirmed: cờ 'chưa xác nhận' theo LƯỢT TRA đã vẽ (vòng 5, gợi ý 2 vòng 4)", () => {
  // Đổi expected (vòng 5, gợi ý 2 vòng 4): tham số 2 là số lượt tra (lookup) của sản phẩm đang hiện, không còn là mã;
  // cờ không phụ thuộc mã có đúng 8–14 chữ số (OFF trả mã dạng lạ thì dòng dị ứng vẫn hiện).
  test("đang chờ xác nhận đúng lượt đang hiện → true; khác lượt / không chờ → false", () => {
    assert.equal(fp.isUnconfirmed({ code: "8934588752117", lookupId: 3 }, 3), true);
    assert.equal(fp.isUnconfirmed({ code: "8934588752117", lookupId: 3 }, 4), false);
    assert.equal(fp.isUnconfirmed(null, 3), false);
    assert.equal(fp.isUnconfirmed(undefined, undefined), false);
    assert.equal(fp.isUnconfirmed({ code: "8934588752117" }, undefined), false, "thiếu lượt → không coi là đang chờ");
    assert.equal(fp.isUnconfirmed({ lookupId: 0 }, 0), false, "lượt 0 = chưa tra lần nào");
  });
  test("mã dạng lạ (không phải 8–14 chữ số) vẫn 'chưa xác nhận'", () => {
    for (const code of ["abc", "", "0012-345", "123456789012345678"]) {
      assert.equal(fp.isUnconfirmed({ code, lookupId: 7 }, 7), true, code);
    }
  });
});

describe("confirmStatusText: câu sau khi bấm 'Đúng' theo kết quả lưu lịch sử (vòng 5, gợi ý 5 vòng 4)", () => {
  test("lưu được / không lưu được", () => {
    assert.equal(fp.confirmStatusText(true), "Đã xác nhận, đã lưu vào lịch sử tra cứu.");
    assert.equal(fp.confirmStatusText(false), "Đã xác nhận (chưa lưu được vào lịch sử).");
  });
});

describe("confirmAction: bấm 'Đúng' (vòng 6, NÊN SỬA 3 vòng 5)", () => {
  test("lượt 'Tìm lại' còn chạy → hủy lượt đó + ghi câu đã xác nhận", () => {
    assert.deepEqual(fp.confirmAction({ retryRunning: true, msgIsResult: false }), { cancelRetry: true, setMsg: true });
    assert.deepEqual(fp.confirmAction({ retryRunning: true, msgIsResult: true }), { cancelRetry: true, setMsg: true });
  });
  test("không có lượt 'Tìm lại': chỉ đổi #frontMsg khi đang là câu KẾT QUẢ (không xóa câu tiến độ của lượt ảnh mới)", () => {
    assert.deepEqual(fp.confirmAction({ retryRunning: false, msgIsResult: true }), { cancelRetry: false, setMsg: true });
    assert.deepEqual(fp.confirmAction({ retryRunning: false, msgIsResult: false }), { cancelRetry: false, setMsg: false });
  });
  test("thiếu / sai kiểu → không hủy, không đổi câu (chỉ true mới tính)", () => {
    assert.deepEqual(fp.confirmAction(), { cancelRetry: false, setMsg: false });
    assert.deepEqual(fp.confirmAction({ retryRunning: 1, msgIsResult: "x" }), { cancelRetry: false, setMsg: false });
  });
});

describe("afterResultScroll: thêm kind của luồng tự mở (vòng 4)", () => {
  test("lần chọn ảnh: open → 'confirm' (khung xác nhận), none → 'none' (câu Chưa tìm thấy)", () => {
    assert.equal(fp.afterResultScroll({ kind: "open", fromRetry: false }), "confirm");
    assert.equal(fp.afterResultScroll({ kind: "none", fromRetry: false }), "none");
  });
  test("'Tìm lại' → null (không cuộn)", () => {
    assert.equal(fp.afterResultScroll({ kind: "open", fromRetry: true }), null);
    assert.equal(fp.afterResultScroll({ kind: "none", fromRetry: true }), null);
  });
  test("không có kind: giữ luật cũ theo hits (test cũ không đổi)", () => {
    assert.equal(fp.afterResultScroll({ hits: [1] }), "hit");
    assert.equal(fp.afterResultScroll({ hits: [] }), "unsure");
  });
});

describe("joinOffResults: gộp kết quả các câu tìm OFF của một ảnh", () => {
  const h = (code) => ({ code, name: code, brand: "", img: "", vn: false, text: code });
  test("nối theo thứ tự câu, bỏ mã trùng; ok khi ≥ 1 câu trả được", () => {
    const r = fm.joinOffResults([{ ok: true, hits: [h("1"), h("2")] }, { ok: false, kind: "network" }, { ok: true, hits: [h("2"), h("3")] }]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.hits.map((x) => x.code), ["1", "2", "3"]);
  });
  test("mọi câu lỗi → { ok: false, kind của câu đầu }", () => {
    const r = fm.joinOffResults([{ ok: false, kind: "timeout" }, { ok: false, kind: "limited" }]);
    assert.equal(r.ok, false);
    assert.equal(r.kind, "timeout");
  });
  test("không có câu nào → { ok: false, kind: 'none' } (không coi là lỗi mạng)", () => {
    assert.deepEqual(fm.joinOffResults([]), { ok: false, kind: "none" });
    assert.deepEqual(fm.joinOffResults(null), { ok: false, kind: "none" });
  });
  test("phần tử lạ (null, ok mà không có mảng hits) bị bỏ qua, không ném", () => {
    const r = fm.joinOffResults([null, { ok: true }, { ok: true, hits: [h("9")] }]);
    assert.deepEqual(r.hits.map((x) => x.code), ["9"]);
  });
});

// ---------------------------------------------------------------------------
// HTML (render.js)
// ---------------------------------------------------------------------------

describe("renderPhotoConfirm: khung 'Nhận ra tự động từ ảnh, có thể nhầm'", () => {
  const top = item("8934588752117", { name: "Soda Chanh - Diet 7Up", brand: "PepsiCo", img: IMG, source: "off" });

  test("câu nguyên văn + ảnh có alt + tên + hãng + 2 nút Đúng / Không, xem gợi ý khác", () => {
    const html = render.renderPhotoConfirm(top);
    assert.ok(text(html).includes(ASK), text(html));
    assert.match(html, new RegExp(`<img[^>]*src="${IMG.replace(/[./]/g, "\\$&")}"[^>]*alt="[^"]+"`));
    assert.ok(text(html).includes("Soda Chanh - Diet 7Up"));
    assert.ok(text(html).includes("PepsiCo"));
    assert.match(html, /<button[^>]*type="button"[^>]*data-photo-yes[^>]*>Đúng<\/button>/);
    assert.match(html, /<button[^>]*type="button"[^>]*data-photo-no[^>]*>Không, xem gợi ý khác<\/button>/);
    assert.match(html, new RegExp(`id="${render.PHOTO_CONFIRM_ID}"`));
  });

  test("có dòng trạng thái role=\"status\" cố định (báo khi bấm Đúng) và chỗ trống cho gợi ý khác (ẩn)", () => {
    const html = render.renderPhotoConfirm(top);
    assert.match(html, /role="status"/);
    assert.match(html, /class="photo-others"[^>]*hidden/);
  });

  test("escape tên / hãng; ảnh lạ (không phải images.openfoodfacts.org) → 'chưa có ảnh', không có <img>", () => {
    const html = render.renderPhotoConfirm(item("8934588752117", { name: "<b>x</b>", brand: "\"y\"", img: "https://evil.example/a.jpg" }));
    assert.ok(!html.includes("<b>x</b>"));
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
    assert.ok(!html.includes("evil.example"));
    assert.ok(!/<img/.test(html));
    assert.match(text(html), /chưa có ảnh/);
  });

  test("tên / hãng trống → 'chưa có dữ liệu'", () => {
    const html = render.renderPhotoConfirm(item("8934588752117", { name: "", brand: "" }));
    assert.match(text(html), /chưa có dữ liệu/);
  });
});

describe("renderPhotoDone: khung thu gọn sau khi bấm Đúng", () => {
  test("ghi 'Đã xác nhận' + tên, không còn nút Đúng / Không", () => {
    const html = render.renderPhotoDone(item("8934588752117", { name: "Soda <Chanh>" }));
    assert.match(text(html), /Đã xác nhận/);
    assert.ok(html.includes("Soda &lt;Chanh&gt;"));
    assert.ok(!/data-photo-yes|data-photo-no/.test(html));
  });
});

describe("renderPhotoOthers: gợi ý khác (tối đa 4) + khối Không chắc chắn + 3 nút cũ", () => {
  const others = ["8934588022111", "8934588023064", "8934563163150", "8934563651138", "8934572260543"].map((c, k) => item(c, { img: k === 0 ? IMG : "" }));

  test("tối đa 4 mục, mỗi mục là nút data-front-code có ảnh / tên / hãng, rồi khối 'Không chắc chắn…' + 3 nút", () => {
    const html = render.renderPhotoOthers(others);
    const codes = [...html.matchAll(/data-front-code="(\d+)"/g)].map((m) => m[1]);
    assert.deepEqual(codes, others.slice(0, 4).map((x) => x.code));
    assert.ok(text(html).includes("Hãng 8934588022111"));
    assert.match(html, /<img[^>]*class="front-img"[^>]*alt="[^"]+"/);
    assert.ok(html.indexOf("data-front-code") < html.indexOf(render.FRONT_UNSURE_TEXT));
    assert.match(html, /data-front-action="scan"[^>]*>Quét mã vạch</);
    assert.match(html, /data-front-action="code"[^>]*>Nhập số mã</);
    assert.ok(html.includes(`aria-label="${render.FRONT_ADD_LABEL}"`));
    assert.ok(html.includes(`>${render.FRONT_ADD_TEXT}</a>`));
  });

  test("không còn mục nào → chỉ khối + 3 nút", () => {
    const html = render.renderPhotoOthers([]);
    assert.ok(!html.includes("data-front-code"));
    assert.ok(html.includes(render.FRONT_UNSURE_TEXT));
    assert.match(html, /data-front-action="scan"/);
  });

  test("mã không phải 8–14 chữ số bị bỏ; chữ được escape", () => {
    const html = render.renderPhotoOthers([item("12ab"), item("8934588022111", { name: "<i>a</i>" })]);
    assert.deepEqual([...html.matchAll(/data-front-code="([^"]+)"/g)].map((m) => m[1]), ["8934588022111"]);
    assert.ok(!html.includes("<i>a</i>"));
  });
});

describe("renderPhotoNone: 0 kết quả", () => {
  test("câu nguyên văn 'Chưa tìm thấy…' + chữ đọc được + 3 nút cũ (Quét mã vạch, Nhập số mã, Góp sản phẩm)", () => {
    const html = render.renderPhotoNone({ lines: ["COOP", "Select <x>"] });
    assert.ok(text(html).includes(NONE), text(html));
    assert.ok(text(html).includes("COOP"));
    assert.ok(html.includes("Select &lt;x&gt;"));
    assert.match(html, /data-front-action="scan"[^>]*>Quét mã vạch</);
    assert.match(html, /data-front-action="code"[^>]*>Nhập số mã</);
    assert.ok(html.includes(`>${render.FRONT_ADD_TEXT}</a>`));
    assert.match(html, new RegExp(`id="${render.PHOTO_NONE_ID}"`));
  });

  test("không đọc được chữ nào → ghi rõ, vẫn có 3 nút", () => {
    const html = render.renderPhotoNone({ lines: [] });
    assert.match(text(html), /Không đọc được chữ nào/);
    assert.match(html, /data-front-action="scan"/);
  });
});

describe("renderAllergyAlert / renderAllergyBox: dòng 'chưa xác nhận'", () => {
  const match = { danger: ["milk"], traces: [], noData: false };

  test("unconfirmed → có dòng nguyên văn, đứng TRƯỚC cảnh báo; không có thì như cũ", () => {
    const on = render.renderAllergyAlert(match, 2, { unconfirmed: true });
    assert.ok(text(on).includes(UNCONFIRMED), text(on));
    assert.ok(on.indexOf(UNCONFIRMED) < on.indexOf("Cảnh báo dị ứng"));
    assert.equal(render.renderAllergyAlert(match, 2), render.renderAllergyAlert(match, 2, { unconfirmed: false }));
    assert.ok(!render.renderAllergyAlert(match, 2).includes(UNCONFIRMED));
  });

  test("hồ sơ 0 nhóm mà chưa xác nhận → vẫn có dòng (an toàn hơn), xác nhận rồi thì rỗng như cũ", () => {
    assert.ok(render.renderAllergyAlert(match, 0, { unconfirmed: true }).includes(UNCONFIRMED));
    assert.equal(render.renderAllergyAlert(match, 0), "");
  });

  test("renderAllergyBox truyền cờ xuống", () => {
    assert.ok(render.renderAllergyBox(match, 1, { unconfirmed: true }).includes(UNCONFIRMED));
    assert.ok(!render.renderAllergyBox(match, 1).includes(UNCONFIRMED));
  });

  test("hằng câu", () => {
    assert.equal(render.ALLERGY_UNCONFIRMED, UNCONFIRMED);
    assert.equal(render.PHOTO_ASK_TEXT, ASK);
    assert.equal(render.PHOTO_NONE_TEXT, NONE);
  });
});

describe("renderCompare: sản phẩm tự mở chưa xác nhận → dòng 'chưa xác nhận' ở khối dị ứng màn So sánh (vòng 5, gợi ý 6)", () => {
  const prod = (code) => ({ code, name: "SP " + code, image: "", allergenKeys: ["milk"], traceKeys: [], hasAllergenData: true, nutriments: {} });
  const sides = [{ code: "8934588752117", status: "ok", product: prod("8934588752117") }, { code: "8934588022111", status: "ok", product: prod("8934588022111") }];
  const cols = (html) => html.split('aria-label="Sản phẩm B"');

  test("mã chưa xác nhận ở cột A → dòng ở cột A, không ở cột B", () => {
    const [a, b] = cols(render.renderCompare(sides, ["milk"], { unconfirmedCode: "8934588752117" }));
    assert.ok(text(a).includes(UNCONFIRMED), text(a));
    assert.ok(!text(b).includes(UNCONFIRMED));
  });
  test("hồ sơ 0 nhóm vẫn có dòng ở cột chưa xác nhận (như màn tra cứu)", () => {
    const [a] = cols(render.renderCompare(sides, [], { unconfirmedCode: "8934588752117" }));
    assert.ok(text(a).includes(UNCONFIRMED));
  });
  test("không truyền / mã khác / không phải chuỗi → như cũ (không có dòng)", () => {
    for (const opts of [undefined, {}, { unconfirmedCode: "1" }, { unconfirmedCode: null }]) {
      assert.ok(!render.renderCompare(sides, ["milk"], opts).includes(UNCONFIRMED), JSON.stringify(opts));
    }
    assert.equal(render.renderCompare(sides, ["milk"]), render.renderCompare(sides, ["milk"], { unconfirmedCode: null }));
  });
});

describe("renderFrontEdit: ô sửa chữ để phía dưới, không bắt buộc", () => {
  test("<details> đóng sẵn 'Sửa chữ đọc được' chứa textarea + Tìm lại; có dòng nguồn ODbL", () => {
    const html = render.renderFrontEdit({ lines: ["Up", "Soda <chanh>"] });
    assert.match(html, /<details class="front-edit">\s*<summary>Sửa chữ đọc được<\/summary>/);
    assert.ok(!/<details[^>]*\bopen\b/.test(html), "phải đóng sẵn");
    const m = html.match(/<textarea[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/);
    assert.equal(m[1], render.FRONT_TEXT_ID);
    assert.equal(m[2], "Up\nSoda &lt;chanh&gt;");
    assert.match(html, /data-front-retry[^>]*>Tìm lại</);
    assert.match(html, /odbl/i);
  });
  test("ảnh gửi nguyên bản → có câu báo", () => {
    assert.match(render.renderFrontEdit({ lines: [], reencoded: false }), /gửi nguyên bản/);
    assert.ok(!/gửi nguyên bản/.test(render.renderFrontEdit({ lines: [] })));
  });
});
