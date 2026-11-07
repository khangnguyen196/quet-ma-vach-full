import { test } from "node:test";
import assert from "node:assert/strict";
import { imageDownloadCounts, queryDownloadsText, fmtRank, fmtMs, unusableTestCount, downloadErrorStats } from "../tong-hop-lib.mjs";

test("fmtRank / fmtMs / queryDownloadsText", () => {
  assert.equal(fmtRank(7, 10, 15), "vị trí 1: 7/15 · 5 đầu: 10/15");
  assert.equal(fmtMs(0), "< 0,1 ms");
  assert.equal(fmtMs(0.9), "0.90 ms");
  assert.equal(fmtMs(null), "–");
  assert.equal(queryDownloadsText(null), "– (không có số, chạy trước khi thêm trường)");
  assert.equal(queryDownloadsText(55), "55");
});

test("unusableTestCount: bỏ mã dùng được và mã dòng phụ", () => {
  const cag = { items: [
    { code: "1", usable: true, manualCheck: { verdict: "khác" } },
    { code: "2", usable: true, manualCheck: { verdict: "giống" } },
    { code: "3", usable: false },
    { code: "SIDE", usable: false },
  ] };
  assert.equal(unusableTestCount(cag, "SIDE"), 2);
});

test("downloadErrorStats: lấy số lớn nhất, không âm", () => {
  assert.deepEqual(downloadErrorStats({ http429or5xx: 2, networkErrors: 0 }, { http429or5xx: 1, breakerTrips: 1 }, null), { http429or5xx: 2, networkErrors: 0, breakerTrips: 1 });
});

test("imageDownloadCounts: chạy riêng bước loo (bộ đếm loo bắt đầu từ 0) không ra số âm", () => {
  const chon = { downloadStats: { downloads: 982 } };
  const loo = { downloadStats: { downloads: 55 }, queryDownloads: 55 };
  const r = imageDownloadCounts(chon, loo);
  assert.equal(r.index, 982);
  assert.equal(r.query, 55);
});

test("imageDownloadCounts: loo.json cũ không có queryDownloads -> null (không trừ chon − loo)", () => {
  const r = imageDownloadCounts({ downloadStats: { downloads: 982 } }, { downloadStats: { downloads: 1037 } });
  assert.equal(r.query, null);
});
