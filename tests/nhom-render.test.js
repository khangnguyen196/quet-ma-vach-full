// HTML món nhóm (đợt kho-nhom vòng 6, src/render.js). Chuỗi vàng tests/fixtures/nhom-render-vang.json sinh bằng
// render.js TRƯỚC vòng 6 (commit 024bc5d) với cùng đầu vào: nhom rỗng thì HTML phải GIỐNG HỆT cũ.
// Chạy: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderPhotoOthers, renderPhotoNone, renderPhotoConfirm, renderPhotoShell, renderAllergyAlert, renderNhomHits,
  renderNhomProduct, renderNhomShell, renderNhomError, renderNhomLoading, nhomImageOk, ALLERGY_UNCONFIRMED, renderNhomAddForm,
  NHOM_NOTE_TEXT, NHOM_HITS_TEXT, NHOM_ALLERGY_NO_DATA, ALLERGY_NO_DATA, ALLERGY_NEUTRAL, NHOM_ALLERGY_NEUTRAL
} from "../src/render.js";
import { nhomProductView } from "../src/front-nhom.js";

const VANG = JSON.parse(readFileSync(new URL("./fixtures/nhom-render-vang.json", import.meta.url), "utf8"));
const OTHERS = [
  { code: "8934563163150", name: "Bánh <b>", brand: 'Hãng "A"', img: "https://images.openfoodfacts.org/images/products/893/456/316/3150/front_vi.3.200.jpg" },
  { code: "8934563651138", name: "", brand: "", img: "" },
];
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M = (n, extra = {}) => ({ san_pham_id: ID(n), ten: `Món ${n}`, thuong_hieu: "Hãng N", ma_vach: null, diem: 0.7123, ...extra });
const SB = "https://abcd.supabase.co";

describe("nhom rỗng → HTML GIỐNG HỆT trước vòng 6 (chuỗi vàng)", () => {
  test("renderPhotoOthers", () => {
    assert.equal(renderPhotoOthers(OTHERS), VANG.others);
    assert.equal(renderPhotoOthers(OTHERS, []), VANG.others);
    assert.equal(renderPhotoOthers(OTHERS, undefined), VANG.others);
    assert.equal(renderPhotoOthers([], []), VANG.othersEmpty);
  });
  test("renderPhotoNone", () => {
    const lines = ["Bánh <script>", " ", "ABC"];
    assert.equal(renderPhotoNone({ lines }), VANG.none);
    assert.equal(renderPhotoNone({ lines, nhom: [] }), VANG.none);
    assert.equal(renderPhotoNone({ lines: [], nhom: [] }), VANG.noneEmpty);
  });
  test("renderPhotoConfirm / renderPhotoShell / renderAllergyAlert (không truyền nhom)", () => {
    assert.equal(renderPhotoConfirm(OTHERS[0]), VANG.confirm);
    assert.equal(renderPhotoShell(OTHERS[0]), VANG.shell);
    assert.equal(renderAllergyAlert({ danger: [], traces: [], noData: true }, 2, { unconfirmed: true }), VANG.alert);
    assert.equal(renderAllergyAlert({ danger: [], traces: [], noData: false }, 2), VANG.alert2);
  });
  test("mục nhom xấu (id sai, tên rỗng) bị bỏ → vẫn y hệt cũ", () => {
    const bad = [M(1, { san_pham_id: "x" }), M(2, { ten: "  " }), null];
    assert.equal(renderNhomHits(bad), "");
    assert.equal(renderPhotoOthers(OTHERS, bad), VANG.others);
    assert.equal(renderPhotoNone({ lines: ["Bánh <script>", " ", "ABC"], nhom: bad }), VANG.none);
  });
});

describe("khối món nhóm", () => {
  test("renderNhomHits: ≤ 3 nút, data-nhom-id / data-nhom-diem, nhãn 'Do nhóm thêm', không hiện điểm ra chữ", () => {
    const html = renderNhomHits([M(1), M(2, { thuong_hieu: null }), M(3), M(4)]);
    assert.equal((html.match(/data-nhom-id=/g) || []).length, 3);
    assert.match(html, new RegExp(NHOM_HITS_TEXT));
    assert.match(html, /data-nhom-id="00000000-0000-4000-8000-000000000001" data-nhom-diem="0.7123"/);
    assert.equal((html.match(/Do nhóm thêm/g) || []).length, 3);
    assert.doesNotMatch(html.replace(/data-nhom-diem="[^"]*"/g, ""), /0[.,]7123|71[.,]2/);
    assert.equal((html.match(/class="front-brand"/g) || []).length, 2); // món 2 không có thương hiệu
    assert.match(html, /<button type="button" class="front-hit nhom-hit"/);
  });
  test("esc: tên / thương hiệu chứa <script>, <img onerror>, dấu nháy → thành chữ", () => {
    const html = renderNhomHits([M(1, { ten: '<img src=x onerror="alert(1)">', thuong_hieu: "<script>alert('x')</script>" })]);
    assert.doesNotMatch(html, /<img|<script/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  });
  test("gợi ý khác: ≤ 4 mục cũ → khối món nhóm → khối 'Không chắc chắn…'", () => {
    const html = renderPhotoOthers(OTHERS, [M(1)]);
    const iOld = html.indexOf('data-front-code="8934563651138"');
    const iNhom = html.indexOf("data-nhom-id=");
    const iUnsure = html.indexOf('class="front-unsure"');
    assert.ok(iOld > 0 && iNhom > iOld && iUnsure > iNhom);
    // không có mục cũ: khối món nhóm rồi khối "Không chắc chắn…"
    const h2 = renderPhotoOthers([], [M(1)]);
    assert.ok(h2.indexOf("data-nhom-id=") < h2.indexOf('class="front-unsure"'));
  });
  test("'Chưa tìm thấy…': khối món nhóm ngay sau câu Chưa tìm thấy", () => {
    const html = renderPhotoNone({ lines: ["ABC"], nhom: [M(1)] });
    const big = html.indexOf("Chưa tìm thấy sản phẩm này trong dữ liệu Open Food Facts</p>");
    const nhom = html.indexOf('<div class="nhom-hits">');
    const read = html.indexOf("Chữ đọc được trên ảnh");
    assert.ok(big > 0 && nhom > big && read > nhom);
    assert.equal(html.slice(big, nhom), "Chưa tìm thấy sản phẩm này trong dữ liệu Open Food Facts</p>\n");
  });
});

describe("trang món nhóm", () => {
  const ROW = {
    id: ID(5), ten: 'Bánh <img src=x onerror="alert(1)">', thuong_hieu: "Hãng 'B'", khoi_luong: "200 g", ma_vach: "8934563163150",
    thanh_phan: "Bột mì <b>đậm</b>", dinh_duong: { "energy-kcal_100g": 450, proteins_100g: 7.5, salt_100g: 0.04, la: 9 },
    di_ung: ["milk", "gluten"], nguon: "tay", tao_luc: "2026-11-20T03:00:00Z"
  };
  test("dòng đầu 'Do nhóm thêm, hãy kiểm nhãn' luôn có (role note, không đỏ), esc mọi chữ", () => {
    for (const v of [nhomProductView(ROW), nhomProductView({}), nhomProductView(null)]) {
      const html = renderNhomProduct(v, {});
      assert.ok(html.startsWith(`<p class="nhom-note" role="note">${NHOM_NOTE_TEXT}</p>`));
      assert.doesNotMatch(html.slice(0, 80), /role="alert"|danger/);
    }
    const html = renderNhomProduct(nhomProductView(ROW), {});
    assert.doesNotMatch(html, /<img src=x|<b>đậm/);
    assert.match(html, /Bánh &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(html, /Hãng &#39;B&#39;/);
    assert.match(html, /Bột mì &lt;b&gt;đậm&lt;\/b&gt;/);
    assert.match(html, /450 kcal/);
    assert.match(html, /0,04 g/);
    assert.match(html, /Người trong nhóm tự nhập/);
    assert.match(html, /Thêm vào kho nhóm ngày 20\/11\/2026/);
    assert.match(html, /<span class="chip">Gluten<\/span><span class="chip">Sữa<\/span>/);
  });
  test("trường trống → 'chưa có dữ liệu'", () => {
    const html = renderNhomProduct(nhomProductView({ id: ID(1), ten: "Món" }), {});
    assert.ok((html.match(/chưa có dữ liệu/g) || []).length >= 5); // thương hiệu, khối lượng, mã vạch, nguồn, dinh dưỡng, thành phần
    assert.match(html, new RegExp(NHOM_ALLERGY_NO_DATA));
    assert.doesNotMatch(html, /<img/);
  });
  test("dị ứng: hồ sơ trùng → khung đỏ; unconfirmed → dòng ALLERGY_UNCONFIRMED; người dùng tự chọn → không có dòng", () => {
    const v = nhomProductView(ROW);
    const a = renderNhomProduct(v, { profile: ["milk"], unconfirmed: true });
    assert.match(a, /id="allergyAlert"/);
    assert.match(a, /role="alert"><strong>Cảnh báo dị ứng:<\/strong> có Sữa/);
    assert.ok(a.includes(ALLERGY_UNCONFIRMED));
    const b = renderNhomProduct(v, { profile: ["milk"], unconfirmed: false });
    assert.ok(!b.includes(ALLERGY_UNCONFIRMED));
    // hồ sơ 0 nhóm + chưa xác nhận: vẫn có dòng nhắc
    assert.ok(renderNhomProduct(v, { profile: [], unconfirmed: true }).includes(ALLERGY_UNCONFIRMED));
    // không có dữ liệu dị ứng: câu của NHÓM, không phải câu Open Food Facts
    const c = renderNhomProduct(nhomProductView({ id: ID(1), ten: "Món" }), { profile: ["milk"] });
    assert.ok(c.includes(NHOM_ALLERGY_NO_DATA) && !c.includes(ALLERGY_NO_DATA));
    const d = renderNhomProduct(nhomProductView({ id: ID(1), ten: "Món", di_ung: ["fish"] }), { profile: ["milk"] });
    assert.ok(d.includes(NHOM_ALLERGY_NEUTRAL) && !d.includes(ALLERGY_NEUTRAL));
  });
  test("ảnh: chỉ https + đúng host Supabase; sai host / http / javascript: bị bỏ; có alt", () => {
    const ok = `${SB}/storage/v1/object/sign/nhom-anh/a/b.jpg?token=t`;
    assert.equal(nhomImageOk(ok, SB), ok);
    for (const bad of [
      "https://evil.example/x.jpg", "http://abcd.supabase.co/x.jpg", "javascript:alert(1)", "https://abcd.supabase.co.evil.io/x.jpg",
      "https://u:p@abcd.supabase.co/x.jpg", "https://abcd.supabase.co:8443/x.jpg", "", null, 5,
    ]) assert.equal(nhomImageOk(bad, SB), "", String(bad));
    assert.equal(nhomImageOk(ok, ""), "");
    assert.equal(nhomImageOk(ok, "http://abcd.supabase.co"), "");
    const v = nhomProductView(ROW);
    const good = renderNhomProduct(v, { imgUrl: ok, supabaseUrl: SB });
    assert.match(good, /<img src="https:\/\/abcd\.supabase\.co\/storage\/v1\/object\/sign\/nhom-anh\/a\/b\.jpg\?token=t" alt="Ảnh mặt trước Bánh &lt;img/);
    const bad = renderNhomProduct(v, { imgUrl: "https://evil.example/x.jpg", supabaseUrl: SB });
    assert.doesNotMatch(bad, /<img/);
    assert.match(bad, /<div class="noimg">Chưa có ảnh<\/div>/);
  });
  test("vòng 7: nhomImageOk đòi đường dẫn URL ký của bucket nhom-anh (đúng máy nhưng sai đường dẫn → '')", () => {
    for (const bad of [
      `${SB}/storage/v1/object/public/nhom-anh/a/b.jpg`, `${SB}/storage/v1/object/sign/bucket-khac/a/b.jpg?token=t`,
      `${SB}/x.jpg`, `${SB}/`, `${SB}/storage/v1/object/sign/nhom-anhx/a.jpg`, `${SB}/rest/v1/nhom_anh?select=*`,
      `${SB}/storage/v1/object/sign/nhom-anh`,
    ]) assert.equal(nhomImageOk(bad, SB), "", bad);
    const ok = `${SB}/storage/v1/object/sign/nhom-anh/00000000-0000-4000-8000-000000000001/x.jpg?token=t`;
    assert.equal(nhomImageOk(ok, SB), ok);
  });
  test("vòng 7: ảnh trang món nhóm KHÔNG có loading=\"lazy\" (URL ký sống ngắn, ảnh ở đầu trang)", () => {
    const ok = `${SB}/storage/v1/object/sign/nhom-anh/a/b.jpg?token=t`;
    const html = renderNhomProduct(nhomProductView(ROW), { imgUrl: ok, supabaseUrl: SB });
    assert.match(html, /<img src="/);
    assert.doesNotMatch(html, /loading=/);
  });
  test("vòng 7: có mã vạch 8–14 số → nút 'Tra mã này trên Open Food Facts' (data-nhom-lookup); không mã → không nút", () => {
    const html = renderNhomProduct(nhomProductView(ROW), {});
    assert.match(html, /<button type="button" class="btn" data-nhom-lookup="8934563163150">Tra mã này trên Open Food Facts<\/button>/);
    assert.equal((html.match(/data-nhom-lookup=/g) || []).length, 1);
    for (const ma of [null, "", "1234567", "123456789012345", "12345678a", '1"><b>']) {
      const h = renderNhomProduct(nhomProductView({ ...ROW, ma_vach: ma }), {});
      assert.doesNotMatch(h, /data-nhom-lookup|Tra mã này trên Open Food Facts/, String(ma));
    }
    assert.doesNotMatch(renderNhomProduct({ code: '1"><b>' }, {}), /data-nhom-lookup/);
    assert.match(renderNhomProduct({ code: "12345678" }, {}), /data-nhom-lookup="12345678"/);
  });
  test("vòng 7: renderNhomAddForm: giá trị điền sẵn qua esc(), maxlength khớp SQL, 8 ô dinh dưỡng, 14 ô dị ứng, lỗi cạnh ô", () => {
    const vals = {
      ten: 'Bánh <img src=x onerror="window.__xss=1">', thuong_hieu: "Hãng 'B' & \"C\"", khoi_luong: "75 g", ma_vach: "8934563163150",
      thanh_phan: "</textarea><script>window.__xss=1</script>", dinh_duong: { fat_100g: "1,5", "energy-kcal_100g": 450, la: "9" },
      di_ung: ["milk", "gluten", "constructor"], nguon: "off"
    };
    const html = renderNhomAddForm(vals, { ten: "Cần nhập <b>tên</b>.", fat_100g: "Sai" }, { previews: [{ url: "blob:https://x/1", name: "a<b>.jpg" }, { url: "javascript:alert(1)" }] });
    assert.ok(!html.includes("<img src=x") && !html.includes("<script>") && !html.includes("</textarea><script"));
    assert.match(html, /name="ten" maxlength="200" value="Bánh &lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;" required/);
    assert.match(html, /value="Hãng &#39;B&#39; &amp; &quot;C&quot;"/);
    assert.match(html, /<textarea id="nhomAdd-thanh_phan" name="thanh_phan" rows="4" maxlength="5000">&lt;\/textarea&gt;&lt;script&gt;/);
    assert.match(html, /name="thuong_hieu" maxlength="200"/);
    assert.match(html, /name="khoi_luong" maxlength="200"/);
    // vòng 9 (NÊN SỬA 1): ô mã vạch đủ chỗ cho mã dán có dấu cách ("8 934563 163150" = 15 ký tự), không bị cắt
    const ml = Number(/name="ma_vach" maxlength="(\d+)" value="8934563163150" inputmode="numeric"/.exec(html)?.[1]);
    assert.ok(ml >= 20, `maxlength ô ma_vach = ${ml}, cần ≥ 20`);
    assert.equal((html.match(/name="dd:/g) || []).length, 8);
    assert.match(html, /name="dd:fat_100g" inputmode="decimal" maxlength="20" value="1,5" autocomplete="off" aria-invalid="true"/);
    assert.match(html, /name="dd:energy-kcal_100g" inputmode="decimal" maxlength="20" value="450"/);
    assert.equal((html.match(/name="di_ung"/g) || []).length, 14);
    assert.equal((html.match(/name="di_ung" value="[^"]+" checked/g) || []).length, 2);
    assert.match(html, /<input type="hidden" name="nguon" value="off">/);
    assert.match(html, /Nguồn: Lấy từ Open Food Facts lúc thêm/);
    assert.match(html, /<p class="field-err" id="nhomAddErr-ten">Cần nhập &lt;b&gt;tên&lt;\/b&gt;\.<\/p>/);
    assert.match(html, /aria-invalid="true" aria-describedby="nhomAddErr-ten"/);
    // ảnh xem trước: chỉ URL blob:, có alt, tên file esc
    assert.equal((html.match(/<img /g) || []).length, 1);
    assert.match(html, /<img src="blob:https:\/\/x\/1" width="72" height="72" alt="Ảnh mặt trước 1: a&lt;b&gt;\.jpg">/);
    assert.match(html, /<input id="nhomAddFiles" type="file" accept="image\/\*" multiple>/);
    assert.match(html, /Lấy thông tin từ Open Food Facts/);
    assert.match(html, /Chụp ảnh mã vạch/);
    assert.match(html, /Chụp mặt sau để máy đọc chữ/);
    assert.match(html, /data-nhom-add="save">Lưu vào kho nhóm/);
    assert.match(html, /data-nhom-add="cancel">Hủy/);
    // mặc định: form trống, nguồn tay; saving khóa nút Lưu
    const empty = renderNhomAddForm();
    assert.match(empty, /name="nguon" value="tay"/);
    assert.doesNotMatch(empty, /checked|field-err|aria-invalid/);
    assert.match(renderNhomAddForm({}, {}, { saving: true }), /data-nhom-add="save" disabled/);
    assert.match(renderNhomAddForm({ nguon: "xyz" }), /name="nguon" value="tay"/);
  });
  test("khung tự mở món nhóm + câu chờ / lỗi", () => {
    const sh = renderNhomShell(M(1, { ten: "<b>x</b>", ma_vach: "8934563163150" }));
    assert.match(sh, /id="photoConfirm"/);
    assert.match(sh, /Nhận ra tự động từ ảnh, có thể nhầm\. Có phải sản phẩm này\?/);
    assert.match(sh, /data-photo-yes/);
    assert.match(sh, /data-photo-no/);
    assert.match(sh, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(sh, /Mã 8934563163150/);
    assert.match(sh, /Do nhóm thêm/);
    assert.ok(sh.includes(`<div class="photo-body">${renderNhomLoading()}</div>`));
    assert.doesNotMatch(renderNhomShell(M(1)), /front-code/); // không có mã vạch: không có dòng mã
    assert.match(renderNhomError(), /Không tải được món của nhóm\. Thử lại sau\./);
    assert.doesNotMatch(renderNhomError(), /warn|danger|role="alert"/);
  });
});
