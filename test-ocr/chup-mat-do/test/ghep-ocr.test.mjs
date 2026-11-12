// Test đợt ocr-mat vòng 4 (không mạng, không đọc D:\tmp): ghép chữ của 2 OCR (ghep-ocr.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ghep from "../ghep-ocr.mjs";
import { pickOrder, mergeLines, mergeOcr, lineKey } from "../ghep-ocr.mjs";
import { ocrLines, queryFromOcr } from "../t1-ocr.mjs";

const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

test("khóa = normalizeText: bỏ dấu, đ -> d, thường, gộp khoảng trắng", () => {
  assert.equal(lineKey("  Mì  KHOAI-Tây  "), "mi khoai tay");
  assert.equal(lineKey("ĐẬU phộng"), "dau phong");
  assert.equal(lineKey("!!! ..."), "");
});

test("bỏ dòng B trùng A sau chuẩn hóa không dấu; A giữ nguyên, kể cả dòng trùng trong A", () => {
  const a = [{ text: "Mì Khoai Tây", conf: 0.9 }, { text: "OMACHI", conf: 0.8 }, { text: "omachi", conf: 0.7 }];
  const b = [{ text: "mi khoai tay", conf: 0.99 }, { text: "Xốt bò hầm", conf: 0.6 }, { text: "ômachi", conf: 0.95 }];
  assert.deepEqual(mergeLines(a, b), [
    { text: "Mì Khoai Tây", conf: 0.9 },
    { text: "OMACHI", conf: 0.8 },
    { text: "omachi", conf: 0.7 },
    { text: "Xốt bò hầm", conf: 0.6 },
  ]);
});

test("thứ tự: mọi dòng A trước, rồi dòng B mới theo thứ tự của B; dòng B trùng nhau chỉ lấy lần đầu; khóa rỗng của B bỏ", () => {
  const a = [{ text: "VISSAN", conf: 0.99 }, { text: "...", conf: 0.9 }];
  const b = [{ text: "Lạp xưởng", conf: 0.8 }, { text: "---" }, { text: "MAI QUẾ" }, { text: "lap xuong", conf: 0.5 }];
  assert.deepEqual(mergeLines(a, b), [
    { text: "VISSAN", conf: 0.99 },
    { text: "...", conf: 0.9 }, // dòng của A giữ hết, kể cả khóa rỗng
    { text: "Lạp xưởng", conf: 0.8 },
    { text: "MAI QUẾ" }, // không có độ tin -> không ghi conf
  ]);
});

test("chọn A / B: 5 đầu cao hơn, hòa thì vị trí 1 cao hơn, rồi nhanh hơn, rồi bên ghi trước", () => {
  const k = (name, top5, top1, sec) => ({ name, summary: { top5, top1, secondsMedian: sec } });
  assert.deepEqual(Object.values(pickOrder(k("x", 19, 10, 5), k("y", 23, 16, 64))).map((v) => v.name), ["y", "x"]);
  assert.deepEqual(Object.values(pickOrder(k("x", 22, 16, 78), k("y", 22, 14, 5))).map((v) => v.name), ["x", "y"]);
  assert.deepEqual(Object.values(pickOrder(k("x", 22, 14, 11.2), k("y", 22, 14, 5.9))).map((v) => v.name), ["y", "x"]);
  assert.deepEqual(Object.values(pickOrder(k("x", 22, 14, 5), k("y", 22, 14, 5))).map((v) => v.name), ["x", "y"]);
});

test("một bên lỗi / thiếu -> dùng nguyên bên kia; giây = tổng giây có", () => {
  const ok = { status: "ok", lines: [{ text: "Omachi", conf: 0.9 }], seconds: 3 };
  const loi = { status: "loi", error: "hết bộ nhớ", seconds: 5 };
  const r1 = mergeOcr(loi, ok);
  assert.equal(r1.status, "ok");
  assert.deepEqual(r1.lines, [{ text: "Omachi", conf: 0.9 }]);
  assert.equal(r1.seconds, 8);
  const r2 = mergeOcr(ok, undefined);
  assert.equal(r2.status, "ok");
  assert.deepEqual(r2.lines, [{ text: "Omachi", conf: 0.9 }]);
  assert.equal(r2.seconds, 3);
});

test("cả hai lỗi -> status loi (bộ chấm tính sai)", () => {
  const r = mergeOcr({ status: "loi", error: "a" }, undefined);
  assert.equal(r.status, "loi");
  assert.ok(r.error.includes("cả hai"));
});

test("khung nối hàng trước khi ghép (đúng ocrLines của t1-ocr), độ tin theo thang từng bên", () => {
  const a = { items: [
    { text: "QUẾ", conf: 0.9, box: box(300, 102, 380, 150) },
    { text: "VISSAN", conf: 0.99, box: box(100, 10, 300, 60) },
    { text: "LẠP XƯỞNG", conf: 0.8, box: box(10, 100, 150, 148) },
    { text: "MAI", conf: 0.7, box: box(160, 98, 290, 146) },
  ], seconds: 2 };
  const b = { lines: [{ text: "lap xuong mai que", conf: 90 }, { text: "Thịt heo", conf: 80 }], seconds: 4 };
  const r = mergeOcr(a, b, { scaleA: 1, scaleB: 100 });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.lines.map((l) => l.text), ["VISSAN", "LẠP XƯỞNG MAI QUẾ", "Thịt heo"]);
  assert.equal(r.lines[2].conf, 0.8);
  assert.equal(r.seconds, 6);
  // đúng hàng của ocrLines
  assert.deepEqual(r.lines.slice(0, 2), ocrLines(a));
});

test("chỉ có chữ ({ text }) tách theo xuống dòng như ocrLines; ghép A với chính A ra đúng câu tìm của A", () => {
  const a = { text: "Mì Omachi\nKhoai tây\nOMACHI" };
  const r = mergeOcr(a, a);
  assert.deepEqual(r.lines, [{ text: "Mì Omachi" }, { text: "Khoai tây" }, { text: "OMACHI" }]);
  assert.deepEqual(queryFromOcr(r), queryFromOcr(a));
  const k = { items: [{ text: "OMACHI", conf: 0.6, box: box(0, 0, 100, 40) }, { text: "Bò hầm", conf: null, box: box(0, 60, 100, 90) }] };
  assert.deepEqual(queryFromOcr(mergeOcr(k, k)), queryFromOcr(k));
});

// ---------- thu-r1 P3 (6): file kết quả hỏng -> câu tiếng Việt kèm tên file, mã thoát 2 ----------
test("parseResultJson: JSON hỏng -> lỗi tiếng Việt có tên file, exitCode 2; JSON đúng -> object", () => {
  assert.equal(typeof ghep.parseResultJson, "function", "chưa có parseResultJson");
  assert.deepEqual(ghep.parseResultJson('{"a":1}', "x.json"), { a: 1 });
  assert.throws(() => ghep.parseResultJson("{hỏng", "ket-qua/x.json"), (e) => {
    assert.match(e.message, /^File kết quả ket-qua\/x\.json không đọc được \(JSON hỏng: /);
    assert.equal(e.exitCode, 2);
    return true;
  });
});

test("ghep-ocr.mjs (dòng lệnh): file kết quả --x hỏng -> báo tiếng Việt kèm tên file, mã thoát 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghep-hong-"));
  try {
    fs.writeFileSync(path.join(dir, "x.json"), "{ không phải JSON", "utf8");
    fs.writeFileSync(path.join(dir, "y.json"), JSON.stringify({ dir: dir, scale: 1, summary: {}, items: [] }), "utf8");
    const script = fileURLToPath(new URL("../ghep-ocr.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [script, "--x", "x", "--y", "y", "--name", "thu", "--ket-qua", dir, "--out-root", dir], { encoding: "utf8" });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /File kết quả .*x\.json không đọc được \(JSON hỏng: /);
    assert.ok(!fs.existsSync(path.join(dir, "ghep-thu")), "không tạo thư mục ghép khi file kết quả hỏng");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
