import { test } from "node:test";
import assert from "node:assert/strict";
import { imageDownloadCounts } from "../tong-hop-lib.mjs";

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
