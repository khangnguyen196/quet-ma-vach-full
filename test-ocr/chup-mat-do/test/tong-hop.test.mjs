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

// ---- vòng 5 (g1, g2, NÊN SỬA 1, g4) ----
import { downloadErrorsByStep, rankCell, nameBrandCell, bitRange, runTimeText } from "../tong-hop-lib.mjs";

test("downloadErrorsByStep: ghi số lỗi riêng từng bước (không lấy số lớn nhất), bỏ bước không có số", () => {
  const r = downloadErrorsByStep({ chon: { http429or5xx: 2, networkErrors: 0 }, loo: { http429or5xx: 1, breakerTrips: 1 }, cap: null });
  assert.deepEqual(r, [
    { step: "chon", http429or5xx: 2, networkErrors: 0, breakerTrips: 0 },
    { step: "loo", http429or5xx: 1, networkErrors: 0, breakerTrips: 1 },
  ]);
});

test("rankCell / nameBrandCell: lượt chưa chạy được ảnh nào in '–' (không in 0/1)", () => {
  assert.equal(rankCell({ n: 1, ok: 0, top1: 0, top5: 0 }), "–");
  assert.equal(rankCell(null), "–");
  assert.equal(rankCell({ n: 30, ok: 30, top1: 4, top5: 7 }), "vị trí 1: 4/30 · 5 đầu: 7/30");
  assert.equal(nameBrandCell({ n: 1, ok: 0, nameOk: 0, brandOk: 0 }), "–");
  assert.equal(nameBrandCell({ n: 5, ok: 5, nameOk: 3, brandOk: 4 }), "tên 3/5 · thương hiệu 4/5");
});

test("bitRange: khoảng bit min–max và số cặp ≤ 30 bit", () => {
  assert.deepEqual(bitRange([{ distance: 26 }, { distance: 31 }, { distance: 30 }, { distance: null }]), { min: 26, max: 31, le30: 2, n: 3 });
  assert.equal(bitRange([]), null);
});

test("runTimeText: giờ bắt đầu / kết thúc từ startedAt + wallSeconds; không có giờ thì ghi rõ", () => {
  assert.equal(runTimeText({ startedAt: "2026-11-07T21:53:25.304Z", wallSeconds: 152 }), "2026-11-07T21:53:25Z → 2026-11-07T21:55:57Z");
  assert.equal(runTimeText({ startedAt: "2026-11-07T21:53:25.304Z" }), "2026-11-07T21:53:25Z → (không có giờ kết thúc)");
  assert.equal(runTimeText({}), "(không có giờ, chạy trước khi thêm trường)");
});
