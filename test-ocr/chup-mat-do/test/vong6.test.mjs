// Test vòng 6 (không mạng, không đọc D:\tmp): sửa theo code-reviewer vòng 5 + gợi ý rẻ (g1, g5).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { summarize4b } from "../ollama-parse.mjs";
import { triedDonePlanned, progressRankCell, nameBrandDoneCell, mediansText4b, manualCheckCounts } from "../tong-hop-lib.mjs";
import { probeArgs, resumePlan } from "../tai-noi.mjs";
import { catalogMeta, ODBL_URL } from "../xuat-danh-muc.mjs";
import { ocrItems } from "../../../public/chup-mat-do/t1.mjs";

const PUBLIC = new URL("../../../public/", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, PUBLIC), "utf8");

// 10 ảnh đã thử, 8 chạy xong (2 quá giờ), như 4b-qwen2.5vl-3b.json
const ok = (seconds, extra = {}) => ({ status: "ok", seconds, top1: false, inTop5: false, nameOk: false, brandOk: false, parsedOk: true, ...extra });
const RESULTS = [
  ok(210), ok(294, { brandOk: true }), ok(275, { nameOk: true, brandOk: true }),
  { status: "lỗi: quá 300 giây", seconds: 300, top1: false, inTop5: false },
  { status: "lỗi: quá 300 giây", seconds: 300, top1: false, inTop5: false },
  ok(293, { top1: true, inTop5: true, brandOk: true }), ok(238, { top1: true, inTop5: true, brandOk: true }),
  ok(246, { top1: true, inTop5: true, brandOk: true }), ok(290), ok(292, { top1: true, inTop5: true, nameOk: true, brandOk: true }),
];

// ---------- NÊN SỬA 1: bảng 4b tách "đã thử / chạy xong / dự kiến" ----------
test("summarize4b: đã thử 10, chạy xong 8, dự kiến 30; trung vị ảnh xong và trung vị luật dừng (cả 10 ảnh) tách riêng", () => {
  const s = summarize4b(RESULTS, 30);
  assert.equal(s.tried, 10);
  assert.equal(s.ok, 8);
  assert.equal(s.planned, 30);
  assert.equal(s.top1, 4);
  assert.equal(s.top5, 4);
  assert.equal(s.nameOk, 2);
  assert.equal(s.brandOk, 6);
  assert.equal(s.secondsMedian, (275 + 290) / 2, "trung vị 8 ảnh chạy xong");
  assert.equal(s.secondsMedianAll, (290 + 292) / 2, "trung vị luật dừng: cả 10 ảnh đã thử, ảnh quá giờ tính 300 giây");
  assert.equal(s.top1Of30, "4/30");
  assert.equal(s.top5Of30, "4/30");
});

test("bảng 4b: cột Đã thử / xong / dự kiến, ô vị trí 1 / 5 đầu ghi 3 mẫu số + số chưa chạy, tên / thương hiệu /8 chạy xong", () => {
  const s = summarize4b(RESULTS, 30);
  assert.equal(triedDonePlanned(s), "10 / 8 / 30");
  assert.equal(progressRankCell("vị trí 1", s.top1, s), "vị trí 1: 4/8 chạy xong · 4/10 đã thử · 4/30 tổng (20 chưa chạy)");
  assert.equal(progressRankCell("5 đầu", s.top5, s), "5 đầu: 4/8 chạy xong · 4/10 đã thử · 4/30 tổng (20 chưa chạy)");
  assert.equal(nameBrandDoneCell(s), "tên 2/8 chạy xong · thương hiệu 6/8 chạy xong");
  const m = mediansText4b(s);
  assert.match(m, /trung vị 282,5 giây tính 8 ảnh chạy xong/);
  assert.match(m, /trung vị luật dừng 291,0 giây tính cả 10 ảnh đã thử/);
});

test("bảng 4b: chưa chạy xong ảnh nào -> '–' (không in 0/0)", () => {
  const s = summarize4b([{ status: "lỗi: quá 300 giây", seconds: 300 }], 30);
  assert.equal(triedDonePlanned(s), "1 / 0 / 30");
  assert.equal(progressRankCell("vị trí 1", s.top1, s), "–");
  assert.equal(nameBrandDoneCell(s), "–");
});

// ---------- NÊN SỬA 2: lệnh thăm dò theo chuyển hướng + có giới hạn giờ ----------
test("probeArgs: có -L (theo chuyển hướng) và --max-time 30", () => {
  const a = probeArgs("https://x/y.gz", 7);
  assert.ok(a.includes("-L"), "thiếu -L");
  const i = a.indexOf("--max-time");
  assert.ok(i >= 0, "thiếu --max-time");
  assert.equal(a[i + 1], "30");
  assert.equal(a.at(-1), "https://x/y.gz");
});

test("resumePlan: 302 (chuyển hướng chưa theo) -> tải lại từ đầu; 206 -> nối", () => {
  assert.equal(resumePlan(302, 1000), "tu-dau");
  assert.equal(resumePlan(206, 1000), "noi");
});

test("du-lieu-vn.mjs dùng probeArgs của tai-noi.mjs (không tự dựng tham số curl thăm dò)", () => {
  const src = fs.readFileSync(new URL("../du-lieu-vn.mjs", import.meta.url), "utf8");
  assert.match(src, /spawn\("curl", probeArgs\(/);
  assert.doesNotMatch(src, /"-r", `\$\{n\}-\$\{n\}`/);
});

// ---------- NÊN SỬA 3: giấy phép ODbL ----------
test("catalogMeta: có giayPhepUrl ODbL 1.0 và câu cơ sở dữ liệu phái sinh", () => {
  const m = catalogMeta({ withNameBrand: true, count: 1452, date: "2026-11-08" });
  assert.equal(ODBL_URL, "https://opendatacommons.org/licenses/odbl/1-0/");
  assert.equal(m.giayPhepUrl, ODBL_URL);
  assert.ok(Object.values(m).includes("Cơ sở dữ liệu phái sinh từ Open Food Facts, phát hành theo ODbL 1.0"));
  assert.equal(m.soSanPham, 1452);
  assert.equal(m.ngayXuat, "2026-11-08");
  assert.match(m.giayPhep, /ODbL 1\.0/);
});

test("danh-muc-vn.json: meta có giayPhepUrl ODbL 1.0", () => {
  const cat = JSON.parse(read("chup-mat-do/danh-muc-vn.json"));
  assert.equal(cat.meta.giayPhepUrl, "https://opendatacommons.org/licenses/odbl/1-0/");
  assert.ok(Object.values(cat.meta).includes("Cơ sở dữ liệu phái sinh từ Open Food Facts, phát hành theo ODbL 1.0"));
});

test("chup-mat-do.html chân trang: link tới file danh mục + link ODbL 1.0 mở tab mới an toàn", () => {
  const html = read("chup-mat-do.html");
  const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
  assert.match(footer, /<a href="chup-mat-do\/danh-muc-vn\.json"[^>]*>chup-mat-do\/danh-muc-vn\.json<\/a>/);
  assert.match(footer, /<a href="https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\/" target="_blank" rel="noopener">[^<]*ODbL 1\.0[^<]*<\/a>/);
  assert.match(footer.replace(/\s+/g, " "), /là dữ liệu phái sinh từ Open Food Facts, phát hành theo giấy phép/);
});

// ---------- g1: lỗi tải danh mục / đọc chữ / nạp PaddleOCR ra câu tiếng Việt ----------
test("ocrItems: kết quả predict rỗng / thiếu items -> mảng rỗng (không lỗi JS)", () => {
  assert.deepEqual(ocrItems(undefined), []);
  assert.deepEqual(ocrItems(null), []);
  assert.deepEqual(ocrItems([]), []);
  assert.deepEqual(ocrItems([{}]), []);
  assert.deepEqual(ocrItems([{ items: null }]), []);
  const items = [{ text: "A" }];
  assert.equal(ocrItems([{ items }]), items);
});

test("chup-mat-do.html: kiểm r.ok khi tải danh mục, câu lỗi tiếng Việt cho danh mục / đọc chữ / nạp PaddleOCR", () => {
  const html = read("chup-mat-do.html");
  const js = html.slice(html.indexOf("<script>"));
  assert.match(js, /fetch\("\.\/chup-mat-do\/danh-muc-vn\.json"\)/);
  assert.match(js, /if \(!r\.ok\)/);
  assert.match(js, /Không tải được danh mục sản phẩm \(mã " \+ r\.status \+ "\)\. Kiểm mạng rồi tải lại trang\./);
  assert.match(js, /Không tải được danh mục sản phẩm \(lỗi mạng hoặc file hỏng\)\. Kiểm mạng rồi tải lại trang\./);
  assert.match(js, /Không đọc được chữ nào trong ảnh\./);
  assert.match(js, /t1\.ocrItems\(/);
  assert.match(js, /Không tải được PaddleOCR[^"]*tải lại trang rồi thử lại/);
});

// ---------- g5: số "cùng tấm" của xem tay ----------
test("manualCheckCounts: đếm theo nhóm cố định, nhóm không có cặp nào ghi 0", () => {
  const c = manualCheckCounts([{ verdict: "khác hẳn" }, { verdict: "cùng mặt, khác lần chụp" }, { verdict: "khác hẳn" }, {}]);
  assert.deepEqual(c, { "cùng tấm": 0, "cùng mặt, khác lần chụp": 1, "khác hẳn": 2, "chưa xem": 1 });
});

// ---------- P2: trang-thu-check.mjs --base / --all / --gap + bước service worker (phần thuần) ----------
import { parseCheckArgs, pickImages, runStats, compareTop5, cacheCheck } from "../trang-thu-check.mjs";

test("parseCheckArgs: mặc định build + server tĩnh, 3 ảnh, gap 0; --base thì không build; --all, --gap 5, --browser", () => {
  const d = parseCheckArgs([]);
  assert.equal(d.base, null);
  assert.equal(d.build, true);
  assert.equal(d.all, false);
  assert.equal(d.gapSeconds, 0);
  assert.deepEqual(d.browsers, ["chromium", "webkit"]);
  assert.match(d.out, /trang-thu-local\.json$/);
  const a = parseCheckArgs(["--all", "--no-build"]);
  assert.equal(a.all, true);
  assert.equal(a.build, false);
  assert.match(a.out, /trang-thu-local-30\.json$/);
  const p = parseCheckArgs(["--base", "https://khangnguyen196.github.io/quet-ma-vach-full", "--browser", "webkit", "--gap", "5"]);
  assert.equal(p.base, "https://khangnguyen196.github.io/quet-ma-vach-full/", "thêm / cuối");
  assert.equal(p.build, false, "có --base thì không build");
  assert.deepEqual(p.browsers, ["webkit"]);
  assert.equal(p.gapSeconds, 5);
  assert.match(p.out, /trang-thu-pages\.json$/);
  assert.deepEqual(parseCheckArgs(["--browsers", "chromium,webkit"]).browsers, ["chromium", "webkit"]);
  assert.throws(() => parseCheckArgs(["--gap", "-1"]), /gap/);
  assert.throws(() => parseCheckArgs(["--base", "ftp://x/"]), /base/);
});

test("pickImages: theo thứ tự truth.csv, bỏ mã không có ảnh; mặc định 3 ảnh đầu, --all lấy hết", () => {
  const truth = ["1", "2", "3", "4", "5"].map((code) => ({ code }));
  const has = (c) => c !== "2";
  assert.deepEqual(pickImages(truth, has, false).map((t) => t.code), ["1", "3", "4"]);
  assert.deepEqual(pickImages(truth, has, true).map((t) => t.code), ["1", "3", "4", "5"]);
});

test("runStats: x/n vị trí 1 và 5 đầu, giây trung vị / lớn nhất tách ảnh đầu (có tải model); ảnh lỗi tính sai", () => {
  const runs = [
    { code: "a", seconds: 20, rank: null, inTop5: false },
    { code: "b", seconds: 4, rank: 1, inTop5: true },
    { code: "c", seconds: 6, rank: 3, inTop5: true },
    { code: "d", seconds: 90, error: "Timeout", inTop5: false },
    { code: "e", seconds: 5, rank: 1, inTop5: true },
  ];
  const s = runStats(runs);
  assert.equal(s.top1, "2/5");
  assert.equal(s.top5, "3/5");
  assert.equal(s.errors, 1);
  assert.equal(s.firstSeconds, 20);
  assert.equal(s.restMedianSeconds, 5.5, "trung vị 4 ảnh sau (ảnh lỗi tính giây thật)");
  assert.equal(s.restMaxSeconds, 90);
});

test("compareTop5: số ảnh top5 trang thử trùng top5 T1 đã đo; ảnh lệch ghi mã", () => {
  const runs = [{ code: "a", top5: ["1", "2"] }, { code: "b", top5: ["3"] }, { code: "c", error: "x" }];
  const ref = [{ ma: "a", top5: ["1", "2"] }, { ma: "b", top5: ["4"] }, { ma: "c", top5: [] }];
  assert.deepEqual(compareTop5(runs, ref), { same: 1, n: 3, diff: ["b", "c"] });
});

test("cacheCheck: Cache Storage không được có URL chup-mat-do / ocr-thu / khác tên miền", () => {
  const base = "http://127.0.0.1:5000/";
  const ok = cacheCheck(["http://127.0.0.1:5000/index.html", "http://127.0.0.1:5000/assets/index-1.js"], base);
  assert.deepEqual(ok, { total: 2, chupMatDo: [], ocrThu: [], foreign: [], ok: true });
  const bad = cacheCheck(["http://127.0.0.1:5000/chup-mat-do.html", "http://127.0.0.1:5000/ocr-thu/regex.mjs", "https://cdn.jsdelivr.net/npm/x@1/a.js"], base);
  assert.deepEqual(bad.chupMatDo, ["chup-mat-do.html"]);
  assert.deepEqual(bad.ocrThu, ["ocr-thu/regex.mjs"]);
  assert.deepEqual(bad.foreign, ["https://cdn.jsdelivr.net/npm/x@1/a.js"]);
  assert.equal(bad.ok, false);
});
