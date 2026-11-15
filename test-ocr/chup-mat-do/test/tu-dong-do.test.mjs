// Test phần thuần của khung đo tu-dong-do.mjs (đợt tu-dong vòng 3): bộ đếm lượt dồn theo vòng, cộng lượt OFF vào
// api_usage.json ở nhiều thư mục, trần lượt vòng / lần chạy, độ phủ. Không gọi mạng (netFetch giả, thư mục tạm).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as mod from "../tu-dong-do.mjs";

const { readLuot, addUsage, makeDiskFetch, coverage, DEFAULT_CAP, ROUND_KEY } = mod;

// Vòng 4 (gợi ý 5 của reviewer vòng 3): thư mục tạm ở ổ D (luật đợt: không ghi ổ C), xóa sau khi chạy xong.
const TMP_ROOT = "D:\\tmp\\tu-dong\\test-tmp";
const made = [];
const tmp = () => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const d = fs.mkdtempSync(path.join(TMP_ROOT, "tu-dong-do-"));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test("tmp(): thư mục tạm nằm dưới D:\\tmp\\tu-dong\\test-tmp", () => {
  assert.ok(tmp().toLowerCase().startsWith(TMP_ROOT.toLowerCase()));
});

test("addUsage: cùng thư mục viết khác hoa / thường (Windows) chỉ cộng 1 lần", () => {
  const a = tmp();
  const flip = a.replace(/^[a-z]:/i, (d) => (d === d.toUpperCase() ? d.toLowerCase() : d.toUpperCase()));
  addUsage(1, new Date("2026-11-15T05:00:00Z"), [a, flip, a.toUpperCase()]);
  const j = JSON.parse(fs.readFileSync(path.join(a, "test-ocr", "outputs", "api_usage.json"), "utf8"));
  if (process.platform === "win32") assert.deepEqual(j, { openfoodfacts: { "2026-11": 1 } });
  else assert.ok(j.openfoodfacts["2026-11"] >= 1);
});

test("roundKeyOf (--vong): mặc định vẫn vong3 (đọc được sổ cũ); số 1–99 → vongN; sai → báo lỗi", () => {
  assert.equal(typeof mod.roundKeyOf, "function");
  assert.equal(mod.roundKeyOf(undefined), "vong3");
  assert.equal(mod.roundKeyOf(null), "vong3");
  assert.equal(mod.roundKeyOf("6"), "vong6");
  assert.equal(mod.roundKeyOf("12"), "vong12");
  for (const bad of ["", "0", "-1", "6a", "vong6", "100", "1.5"]) assert.throws(() => mod.roundKeyOf(bad), /--vong/, bad);
});

test("roundKeyFromArgv (vòng 5, gợi ý 9): không có --vong → vong3; --vong thiếu số / theo sau là cờ khác → báo lỗi, không lặng lẽ dùng vong3", () => {
  assert.equal(typeof mod.roundKeyFromArgv, "function");
  assert.equal(mod.roundKeyFromArgv([]), "vong3");
  assert.equal(mod.roundKeyFromArgv(["--sets", "B"]), "vong3");
  assert.equal(mod.roundKeyFromArgv(["--vong", "5"]), "vong5");
  assert.equal(mod.roundKeyFromArgv(["--sets", "B,A", "--vong", "5", "--chi-cache"]), "vong5");
  assert.throws(() => mod.roundKeyFromArgv(["--vong"]), /--vong/);
  assert.throws(() => mod.roundKeyFromArgv(["--vong", "--chi-cache"]), /--vong/);
  assert.throws(() => mod.roundKeyFromArgv(["--sets", "B", "--vong"]), /--vong/);
  for (const bad of ["0", "abc", "1.5", "-2"]) assert.throws(() => mod.roundKeyFromArgv(["--vong", bad]), /--vong/, bad);
});

test("readLuot: đọc batDau + mọi khóa vongN, tong = tổng; chưa có file → batDau 76", () => {
  const d = tmp();
  const f = path.join(d, "luot.json");
  assert.deepEqual(readLuot(f), { batDau: 76, tong: 76 });
  fs.writeFileSync(f, JSON.stringify({ batDau: 76, vong2: 50, vong3: 7, tong: 1 }));
  assert.deepEqual(readLuot(f), { batDau: 76, vong2: 50, vong3: 7, tong: 133 });
  assert.equal(DEFAULT_CAP, 120);
  assert.equal(ROUND_KEY, "vong3");
});

test("addUsage: cộng vào api_usage.json của MỌI thư mục được truyền (bỏ trùng), giữ dịch vụ khác", () => {
  const a = tmp();
  const b = tmp();
  fs.mkdirSync(path.join(b, "test-ocr", "outputs"), { recursive: true });
  fs.writeFileSync(path.join(b, "test-ocr", "outputs", "api_usage.json"), JSON.stringify({ gemini: { "2026-11": 23 } }));
  const now = new Date("2026-11-15T05:00:00Z");
  addUsage(2, now, [a, b, a]);
  addUsage(1, now, [a, b]);
  const ja = JSON.parse(fs.readFileSync(path.join(a, "test-ocr", "outputs", "api_usage.json"), "utf8"));
  const jb = JSON.parse(fs.readFileSync(path.join(b, "test-ocr", "outputs", "api_usage.json"), "utf8"));
  assert.deepEqual(ja, { openfoodfacts: { "2026-11": 3 } });
  assert.deepEqual(jb, { gemini: { "2026-11": 23 }, openfoodfacts: { "2026-11": 3 } });
});

test("makeDiskFetch: đếm vào khóa vòng (vong3), dừng ở trần vòng và trần lần chạy, ghi cache khi 200", async () => {
  const d = tmp();
  const luotFile = path.join(d, "luot.json");
  fs.writeFileSync(luotFile, JSON.stringify({ batDau: 76, vong2: 50 }));
  let n = 0;
  const disk = makeDiskFetch({
    cacheDir: d, chiCache: false, luotFile, cap: 3, runCap: 2, gapMs: 0, usage: false, sleep: async () => {},
    netFetch: async () => { n++; return { status: 200, text: JSON.stringify({ products: [] }) }; },
  });
  await disk.fetch("https://x/a?q=1&app_name=a&app_version=1");
  await disk.fetch("https://x/a?q=2&app_name=a&app_version=1");
  await assert.rejects(disk.fetch("https://x/a?q=3"), /trần 2 lượt của lần chạy/);
  assert.equal(n, 2);
  assert.deepEqual(readLuot(luotFile), { batDau: 76, vong2: 50, vong3: 2, tong: 128 });
  // lượt đã có cache không tính
  await disk.fetch("https://x/a?q=1&app_name=b&app_version=2");
  assert.equal(disk.stats.cacheHits, 1);
  const disk2 = makeDiskFetch({ cacheDir: d, chiCache: false, luotFile, cap: 2, gapMs: 0, usage: false, sleep: async () => {}, netFetch: async () => ({ status: 200, text: "{}" }) });
  await assert.rejects(disk2.fetch("https://x/a?q=9"), /trần 2 lượt vong3/);
});

test("coverage: ảnh có ≥ 1 câu trả được / đủ câu / có kết quả khác 0", () => {
  const rows = [
    { offPer: [{ ok: true }, { ok: false }], offCount: 3 },
    { offPer: [{ ok: true }, { ok: true }], offCount: 0 },
    { offPer: [{ ok: false }], offCount: 0 },
    { offPer: [], offCount: 0 },
  ];
  assert.deepEqual(coverage(rows), { n: 4, coCau: 3, itNhat1Cau: 2, duCau: 1, khac0: 1 });
});
