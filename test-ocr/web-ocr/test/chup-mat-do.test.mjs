// Phần thêm cho đợt chup-mat-do: dòng kèm chiều cao chữ, lọc ảnh front, bộ nhớ từng ảnh.
import test from "node:test";
import assert from "node:assert/strict";
import { rowLineInfo, tessLineInfo, onlyImages, imagePeak, rowLines, groupRows } from "../lib.mjs";

const box = (x, y, w, h, text, score) => ({ poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text, score });

test("rowLineInfo: cùng hàng như rowLines, h = khung cao nhất, conf = trung bình score", () => {
  const items = [box(0, 0, 50, 40, "OMACHI", 0.9), box(60, 5, 30, 30, "MÌ", 0.7), box(0, 100, 80, 12, "80 g", 0.5)];
  const info = rowLineInfo(items);
  assert.deepEqual(info.map((l) => l.text), rowLines(items));
  assert.equal(info[0].h, 40);
  assert.ok(Math.abs(info[0].conf - 0.8) < 1e-12);
  assert.equal(info[1].h, 12);
  assert.equal(rowLineInfo([box(0, 0, 10, 10, "x")])[0].conf, null);
});

test("groupRows vẫn trả mảng chuỗi như trước", () => {
  assert.deepEqual(groupRows([box(0, 0, 10, 10, "b"), box(-20, 0, 10, 10, "a")]), [["a", "b"]]);
});

test("tessLineInfo: lấy dòng từ blocks, bỏ dòng trống", () => {
  const blocks = [{ paragraphs: [{ lines: [
    { text: "OMACHI\n", confidence: 91, bbox: { x0: 0, y0: 10, x1: 100, y1: 50 } },
    { text: "  ", confidence: 10, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
  ] }] }];
  assert.deepEqual(tessLineInfo(blocks), [{ text: "OMACHI", h: 40, conf: 91 }]);
  assert.deepEqual(tessLineInfo(null), []);
});

test("onlyImages: chỉ ảnh có tên cho trước", () => {
  const photos = [{ code: "1", image: "front" }, { code: "1", image: "back" }];
  assert.deepEqual(onlyImages(photos, "front"), [{ code: "1", image: "front" }]);
  assert.equal(onlyImages(photos, "").length, 2);
});

test("imagePeak: đỉnh tổng working set / private và đỉnh 1 tiến trình", () => {
  const s = [
    { procs: [{ ws: 10, private: 100 }, { ws: 30, private: 5 }] },
    { procs: [{ ws: 25, private: 50 }] },
  ];
  assert.deepEqual(imagePeak(s), { samples: 2, peakTotalWs: 40, peakTotalPrivate: 105, peakProcWs: 30 });
  assert.deepEqual(imagePeak([]), { samples: 0, peakTotalWs: null, peakTotalPrivate: null, peakProcWs: null });
});
