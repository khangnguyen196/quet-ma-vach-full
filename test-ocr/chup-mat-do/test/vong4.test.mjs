// Test vòng 4 (không gọi mạng): ứng viên bộ phụ mở rộng, câu tìm / chấm cách 3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extCandidate, extCandidateFromLine, extRankCompare, extPair, buildBm25 } from "../vn-data.mjs";
import { florenceLines, cach3Query, scoreCach3 } from "../cach3.mjs";

const prod = (code, countries, fronts, extra = {}) => ({
  code,
  countries_tags: countries,
  product_name: `Snack ${code}`,
  images: { selected: { front: Object.fromEntries(fronts.map(([lang, id]) => [lang, { imgid: id, rev: "1" }])) } },
  ...extra,
});

test("extCandidate: bỏ sản phẩm VN, mã thử, < 2 ảnh mặt trước khác imgid; nhóm theo nước ưu tiên", () => {
  const tests = new Set(["111"]);
  assert.equal(extCandidate(prod("1", ["en:vietnam", "en:thailand"], [["en", "1"], ["th", "2"]]), tests), null);
  assert.equal(extCandidate(prod("111", ["en:thailand"], [["en", "1"], ["th", "2"]]), tests), null);
  assert.equal(extCandidate(prod("2", ["en:thailand"], [["en", "1"], ["th", "1"]]), tests), null);
  const a = extCandidate(prod("3", ["en:france", "en:japan"], [["en", "4"], ["ja", "5"]]), tests);
  assert.equal(a.group, 0);
  assert.deepEqual(a.priorityTags, ["en:japan"]);
  const b = extCandidate(prod("4", ["en:france"], [["en", "4"], ["fr", "5"]]), tests);
  assert.equal(b.group, 1);
});

test("extCandidateFromLine: chỉ đọc dòng có nước ưu tiên khi priorityOnly", () => {
  const line = JSON.stringify(prod("5", ["en:france"], [["en", "1"], ["fr", "2"]]));
  assert.equal(extCandidateFromLine(line), null);
  assert.equal(extCandidateFromLine(line, new Set(), { priorityOnly: false }).group, 1);
  assert.equal(extCandidateFromLine(JSON.stringify(prod("6", ["en:china"], [["en", "1"], ["zh", "2"]]))).code, "6");
});

test("extRankCompare: nhóm ưu tiên trước, rồi unique_scans_n, completeness giảm dần, mã tăng dần", () => {
  const rows = [
    { code: "9", group: 1, unique_scans_n: 999 },
    { code: "2", group: 0, unique_scans_n: 5, completeness: 0.5 },
    { code: "1", group: 0, unique_scans_n: 5, completeness: 0.5 },
    { code: "3", group: 0, unique_scans_n: 10 },
  ];
  assert.deepEqual(rows.sort(extRankCompare).map((r) => r.code), ["3", "1", "2", "9"]);
});

test("extPair: ảnh chỉ mục = front đầu tiên, ảnh truy vấn = front đầu tiên khác imgid", () => {
  assert.deepEqual(extPair({ code: "7", fronts: [{ imgid: "3" }, { imgid: "3" }, { imgid: "8" }] }), { code: "7", indexImgid: "3", queryImgid: "8" });
  assert.equal(extPair({ code: "7", fronts: [{ imgid: "3" }] }), null);
});

test("florenceLines / cach3Query: bỏ thẻ đặc biệt, bỏ '|', bỏ số / đơn vị", () => {
  assert.deepEqual(florenceLines("</s><s>Omachi Xot Bo</s>"), [{ text: "Omachi Xot Bo" }]);
  assert.deepEqual(cach3Query("florence", "</s><s>Omachi 80g</s>"), ["omachi"]);
  assert.deepEqual(cach3Query("smolvlm", "Omachi | Mì khoai tây 80 g"), ["omachi", "mi", "khoai", "tay"]);
});

test("scoreCach3: T1 trên danh mục + đúng tên / thương hiệu cho S", () => {
  const index = buildBm25([{ code: "1", text: "Omachi mì khoai tây xốt bò hầm" }, { code: "2", text: "Hảo Hảo tôm chua cay" }]);
  const truth = { code: "1", ten: "Mì khoai tây Omachi xốt Bò hầm", thuong_hieu: "Omachi" };
  const s = scoreCach3("smolvlm", "Omachi | Mì khoai tây xốt bò hầm", truth, index);
  assert.equal(s.rank, 1);
  assert.equal(s.brandOk, true);
  assert.equal(s.nameOk, true);
  const f = scoreCach3("florence", "", truth, index);
  assert.equal(f.inTop5, false);
  assert.equal(f.nameOk, undefined);
});
