// Test vòng 3 lượt A' đợt lens (theo review mốc 4): (A'1) chữ ký chạy nối của lens-vec.py vec có sha lens-vec.py + git
// HEAD, worktree bẩn đầu lượt vec / int8 → mã 3, cuối lượt provenance phải trùng đầu lượt; (A'2) ảnh 404 ở mức (b) =
// "không có ảnh" (unavailable404), mã bị loại / A / B / bộ P không được nằm trong đó; (A'3) int8 n = 0 → mã 3, ghi nTruth +
// số bỏ theo lý do; (A'4) doInputCheck so sha codes.json / queries.json và sha file int8, lens-chay --do gói lỗi bằng stop.
// Gọi code THẬT (hàm của lens-do.mjs / lens-tai.mjs, lens-vec.py bằng Python của venv đợt lens). Python chạy trên BẢN SAO
// lens-vec.py trong một repo git tạm sạch ở D:\tmp\lens-tam (provenance tính trên repo chứa file chạy), xóa sau khi chạy.
// Dữ liệu giả (mã 1111…), không đọc ảnh thật.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkIndexGuard, guardWant, int8MetaErrors, doInputCheck, INT8_QUANT, INT8_LOSS_KEYS, indexBytesInt8,
} from "../lens-do.mjs";
import { buildVecInput, vecInputReady } from "../lens-tai.mjs";

const PY = "D:\\tmp\\lens\\venv\\Scripts\\python.exe";
const VEC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lens-vec.py");
const TAM = "D:\\tmp\\lens-tam";
const H = (ch) => ch.repeat(64);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Repo git tạm sạch chứa bản sao lens-vec.py; trả { dir, file, commit(msg), git(...args) }. */
function cleanRepo(tag) {
  const dir = path.join(TAM, `repo-${process.pid}-${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "lens-vec.py");
  fs.copyFileSync(VEC, file);
  fs.writeFileSync(path.join(dir, ".gitignore"), "__pycache__/\n", "utf8"); // import module từ test sinh .pyc
  const git =(...a) => execFileSync("git", ["-c", "user.name=lens-test", "-c", "user.email=lens-test@example.invalid", ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  const commit = (msg) => { git("add", "-A"); git("commit", "-q", "-m", msg); };
  commit("bản sao lens-vec.py");
  return { dir, file, git, commit };
}

/** Chạy lens-vec.py (bản sao) với tham số; trả { status, err }. */
function runVecPy(file, args) {
  const r = spawnSync(PY, ["-I", file, ...args], { encoding: "utf8" });
  return { status: r.status, err: `${r.stderr}${r.stdout}` };
}

test("A'1 lens-vec.py vec: dau.json cũ có vecPySha256 / gitHead khác → mã 3; worktree bẩn đầu lượt vec / int8 → mã 3 trước khi nhúng ảnh", (t) => {
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const repo = cleanRepo("sig");
  const work = path.join(TAM, `vec-${process.pid}-sig`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const vao = path.join(work, "vec-vao-b.json");
    fs.writeFileSync(vao, JSON.stringify({ level: "b", index: [], queries: [] }), "utf8");
    // model dir không tồn tại → lượt 1 ghi dau.json rồi dừng (mã 1) ở chỗ nạp cấu hình model, không nhúng ảnh nào
    const args = ["vec", "--model", "clip-fp32", "--pre", "cat", "--vao", vao, "--vec", work, "--model-dir", path.join(work, "khong-co-model")];
    const r1 = runVecPy(repo.file, args);
    assert.notEqual(r1.status, 3, `lượt 1 không được dừng vì chữ ký: ${r1.err}`);
    const sigFile = path.join(work, "clip-fp32-cat", "b", "phan", "dau.json");
    const sig = JSON.parse(fs.readFileSync(sigFile, "utf8"));
    assert.equal(sig.vecPySha256, sha(fs.readFileSync(repo.file)), "chữ ký có sha lens-vec.py đang chạy");
    assert.match(sig.gitHead ?? "", /^[0-9a-f]{40}$/, "chữ ký có git HEAD");
    // lens-vec.py đổi (đã commit, repo sạch) → phần cũ không được dùng lại
    fs.appendFileSync(repo.file, "\n# doi tien xu ly giua hai luot (gia)\n");
    repo.commit("đổi lens-vec.py");
    const r2 = runVecPy(repo.file, args);
    assert.equal(r2.status, 3, `sha lens-vec.py khác chữ ký cũ → mã 3 (${r2.err})`);
    assert.match(r2.err, /Phan cu khac/);
    // repo bẩn đầu lượt → mã 3, báo rõ, kể cả khi chữ ký mới
    fs.rmSync(path.join(work, "clip-fp32-cat"), { recursive: true, force: true });
    fs.appendFileSync(repo.file, "\n# sua do chua commit\n");
    const r3 = runVecPy(repo.file, args);
    assert.equal(r3.status, 3, `worktree bẩn → mã 3 (${r3.err})`);
    assert.match(r3.err, /gitDirty True/);
    assert.ok(!fs.existsSync(sigFile), "dừng TRƯỚC khi ghi chữ ký / nhúng ảnh");
    const r4 = runVecPy(repo.file, ["int8", "--model", "clip-fp32", "--pre", "cat", "--muc", "b", "--vec", work]);
    assert.equal(r4.status, 3, `int8 khi bẩn → mã 3 (${r4.err})`);
    assert.match(r4.err, /gitDirty True/);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("A'1 lens-vec.py: provenance có đường dẫn file chạy; require_same_provenance thoát mã 3 khi file / HEAD / bẩn đổi giữa lượt", (t) => {
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const repo = cleanRepo("prov");
  try {
    const py = String.raw`
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("lens_vec", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
p0 = m.start_provenance("thu")
same = m.require_same_provenance(p0, "thu") == p0
with open(sys.argv[1], "a", encoding="utf-8") as f: f.write("\n# doi giua luot\n")
try:
    m.require_same_provenance(p0, "thu"); code = 0
except SystemExit as e:
    code = e.code
print(json.dumps({"p0": p0, "same": same, "code": code}))`;
    const r = JSON.parse(execFileSync(PY, ["-I", "-c", py, repo.file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop());
    assert.deepEqual(Object.keys(r.p0).sort(), ["gitDirty", "gitHead", "vecPyPath", "vecPySha256"]);
    assert.equal(path.resolve(r.p0.vecPyPath), path.resolve(repo.file), "ghi đường dẫn file chạy (gợi ý 5)");
    assert.equal(r.p0.gitDirty, false);
    assert.equal(r.same, true);
    assert.equal(r.code, 3, "file đổi giữa lượt → mã 3");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("A'1 lens-vec.py (nguồn): vec / int8 gọi start_provenance đầu lượt, require_same_provenance trước khi ghi meta; meta dùng provenance đầu lượt", () => {
  const src = fs.readFileSync(VEC, "utf8");
  const v = src.slice(src.indexOf("def cmd_vec("), src.indexOf("# ---------------- R6"));
  assert.match(v, /p0 = start_provenance\("vec"\)/);
  assert.ok(v.indexOf("start_provenance(") < v.indexOf("sig = {"), "kiểm bẩn trước chữ ký");
  assert.ok(v.indexOf("start_provenance(") < v.indexOf("embed_files("), "kiểm bẩn trước khi nhúng ảnh");
  assert.match(v, /sig = \{[^}]*"vecPySha256": p0\["vecPySha256"\], "gitHead": p0\["gitHead"\]/s);
  assert.ok(v.indexOf("require_same_provenance(p0") < v.indexOf("save_vec_outputs("), "cuối lượt so provenance trước khi ghi bộ sim");
  assert.match(v, /\*\*p0,/);
  assert.doesNotMatch(v, /\*\*provenance\(\)/);
  const i8 = src.slice(src.indexOf("def cmd_int8("), src.indexOf("def main("));
  assert.match(i8, /p0 = start_provenance\("int8"\)/);
  assert.ok(i8.indexOf("start_provenance(") < i8.indexOf("np.load("));
  assert.ok(i8.indexOf("require_same_provenance(p0") < i8.indexOf("atomic_json(mp, meta8"));
  assert.doesNotMatch(i8, /\*\*provenance\(\)/);
});

// ---------------- A'2: ảnh 404 ở mức (b) ----------------
const rows = [
  { code: "1111111111111", img: "front_vi.3" }, { code: "2222222222222", img: "front_vi.4" }, { code: "3333333333333", img: "front_en.5" },
  { code: "4444444444444", img: "front_th.6" }, { code: "6666666666666", img: "front_th.7" },
];
const ac = {
  items: [
    { code: "1111111111111", testImgid: "3", chosen: "front_fr.7", candidates: [{ key: "front_fr.7", imgid: "12" }] },
    { code: "2222222222222", testImgid: "1", chosen: null, catalogImg: "front_vi.4", candidates: [{ key: "front_vi.4", imgid: "9", fromCatalog: true }] },
  ],
  excluded: ["2222222222222"], override: { "1111111111111": "front_fr.7" },
};
const files = { "1111111111111|front_fr.7": "D:\\a1.jpg", "2222222222222|front_vi.4": "D:\\a2.jpg", "3333333333333|front_en.5": "D:\\c3.jpg" };
const fileOf = (c, k) => files[`${c}|${k}`] ?? null;

test("A'2 buildVecInput mức (b): mã 404 thường → KHÔNG vào chỉ mục, ghi unavailable404 (không phải missing); thiếu file không 404 → missing", () => {
  const v = buildVecInput({ level: "b", rows, fileOf, ac, bop: null, queries: [], missing404: new Set(["4444444444444"]) });
  assert.deepEqual(v.index.map((x) => x.code), ["1111111111111", "2222222222222", "3333333333333"]);
  assert.deepEqual(v.unavailable404, ["4444444444444"]);
  assert.deepEqual(v.missing, [{ code: "6666666666666", key: "front_th.7" }], "thiếu file mà không 404 vẫn là missing");
  assert.deepEqual(v.unavailable404Blocked, []);
  // không truyền missing404 (mức a / như cũ) → mã 404 vẫn là missing
  const old = buildVecInput({ level: "b", rows, fileOf, ac, bop: null, queries: [] });
  assert.deepEqual(old.unavailable404, []);
  assert.equal(old.missing.length, 2);
  // mã bị loại 404 → unavailable404Blocked (runVecInput thoát mã 3); mã A / B có override (ảnh thay có file) không bị bỏ
  const blk = buildVecInput({ level: "b", rows, fileOf: (c, k) => (c === "2222222222222" ? null : fileOf(c, k)), ac, bop: null, queries: [], missing404: new Set(["2222222222222", "1111111111111"]) });
  assert.deepEqual(blk.unavailable404, ["2222222222222"]);
  assert.deepEqual(blk.unavailable404Blocked, ["2222222222222"]);
  assert.ok(blk.index.some((x) => x.code === "1111111111111"), "override A / B có file → vẫn vào chỉ mục dù khóa danh mục 404");
});

test("A'2 vecInputReady: --vao-vec b chỉ khi downloaded + 404 = withImg (đúng cỡ mức b)", () => {
  assert.equal(vecInputReady({ withImg: 10, downloaded: 8, missing404: ["a", "b"] }, 10), null);
  assert.match(vecInputReady({ withImg: 10, downloaded: 7, missing404: ["a", "b"] }, 10), /chưa tải xong/);
  assert.match(vecInputReady({ withImg: 9, downloaded: 7, missing404: ["a", "b"] }, 10), /withImg/);
  assert.match(vecInputReady({ withImg: 10, downloaded: 7, missing404: ["a", "a", "b"] }, 10), /chưa tải xong/, "404 trùng không đếm hai lần");
  assert.match(vecInputReady(null, 10), /tai-tong-b/);
  assert.match(vecInputReady({ withImg: 10, downloaded: 8 }, 10), /tai-tong-b/);
});

test("A'2 checkIndexGuard mức (b): unavailable404 ghi + sha tai-tong-b.json; mã bị loại / A / B trong 404 → lỗi; mã 404 trong chỉ mục → lỗi; thiếu file không 404 → lỗi", () => {
  const taiText = JSON.stringify({ withImg: 4, downloaded: 3, missing404: ["4444444444444"] });
  const cat = Object.fromEntries(rows.map((r) => [r.code, r.img]));
  const w = guardWant(JSON.stringify(ac), null, { level: "b", catalogImg: cat, tai404Text: taiText });
  assert.equal(w.tai404Sha256, sha(taiText));
  assert.deepEqual(w.missing404, ["4444444444444"]);
  const codes = ["1111111111111", "2222222222222", "3333333333333"];
  const meta = {
    level: "b", antiCheatSha256: w.antiCheatSha256, boPSha256: null, excluded: ["2222222222222"], override: { "1111111111111": "front_fr.7" },
    hideByRow: { "ab-2222222222222": ["2222222222222"] }, indexKey: { "1111111111111": "front_fr.7", "2222222222222": "front_vi.4", "3333333333333": "front_en.5" },
    indexImgid: { "1111111111111": "12", "2222222222222": "9" }, threadCheck: { pass: true }, queriesMissing: [], missingIndexFiles: 0,
    model: "clip-fp32", pre: "cat", unavailable404: ["4444444444444"], tai404Sha256: w.tai404Sha256,
  };
  const ex = { model: "clip-fp32", pre: "cat", level: "b" };
  assert.deepEqual(checkIndexGuard(meta, codes, w, ex), []);
  const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `thiếu lỗi ${re}: ${errs.join(" | ")}`);
  // mã bị loại nằm trong unavailable404 → lỗi rõ
  has(checkIndexGuard({ ...meta, unavailable404: ["4444444444444", "2222222222222"] }, codes.filter((c) => c !== "2222222222222"), w, ex), /404: mã 2222222222222 .*bị loại/);
  // mã A / B (có truy vấn ảnh) nằm trong unavailable404 → lỗi
  has(checkIndexGuard({ ...meta, unavailable404: ["4444444444444", "1111111111111"] }, codes, w, ex), /404: mã 1111111111111/);
  // mã bộ P (mức a) trong unavailable404 → lỗi
  const bop = { items: [{ qid: "p-3333333333333", code: "3333333333333", query: { imgid: "4" }, index: { key: "front_en.5", imgid: "7" } }] };
  const wa = guardWant(JSON.stringify(ac), JSON.stringify(bop), { level: "a", catalogImg: cat });
  has(checkIndexGuard({ ...meta, level: "a", boPSha256: wa.boPSha256, override: wa.override, unavailable404: ["3333333333333"] }, codes, wa, null), /404: mã 3333333333333/);
  // mã 404 vẫn có trong chỉ mục → lỗi
  has(checkIndexGuard(meta, [...codes, "4444444444444"], w, ex), /404: mã 4444444444444 .*vẫn có trong chỉ mục/);
  // mã trong unavailable404 mà tai-tong-b.json không ghi 404 → lỗi; mã 404 của tai-tong bị bỏ lặng lẽ → lỗi
  has(checkIndexGuard({ ...meta, unavailable404: ["4444444444444", "6666666666666"] }, codes, w, ex), /6666666666666 .*không có trong missing404/);
  has(checkIndexGuard({ ...meta, unavailable404: [] }, codes, w, ex), /4444444444444 .*vắng cả chỉ mục lẫn unavailable404/);
  // sha tai-tong-b.json khác / thiếu → lỗi; mức (b) thiếu tai-tong-b.json khi kiểm → lỗi
  has(checkIndexGuard({ ...meta, tai404Sha256: H("0") }, codes, w, ex), /tai404Sha256/);
  has(checkIndexGuard({ ...meta, unavailable404: undefined }, codes, w, ex), /unavailable404/);
  has(checkIndexGuard(meta, codes, guardWant(JSON.stringify(ac), null, { level: "b", catalogImg: cat }), ex), /tai-tong-b\.json/);
  // thiếu file không 404 vẫn chặn
  has(checkIndexGuard({ ...meta, missingIndexFiles: 1 }, codes, w, ex), /missingIndexFiles = 1/);
});

test("A'2 lens-tai --vao-vec b: đọc tai-tong-b.json, đòi tải xong, chặn mã được bảo vệ trong 404, ghi unavailable404 + tai404Sha256; lens-vec.py chép vào meta", () => {
  const src = fs.readFileSync(new URL("../lens-tai.mjs", import.meta.url), "utf8");
  const r = src.slice(src.indexOf("function runVecInput("));
  assert.match(r, /vecInputReady\(/);
  assert.match(r, /unavailable404Blocked\.length/);
  assert.match(r, /unavailable404: v\.unavailable404/);
  assert.match(r, /tai404Sha256:/);
  assert.ok(r.indexOf("vecInputReady(") < r.indexOf("writeFileSync("), "kiểm tải xong trước khi ghi file đầu vào");
  const py = fs.readFileSync(VEC, "utf8");
  const v = py.slice(py.indexOf("def cmd_vec("), py.indexOf("# ---------------- R6"));
  assert.match(v, /"unavailable404": vin\.get\("unavailable404", \[\]\)/);
  assert.match(v, /"tai404Sha256": vin\.get\("tai404Sha256"\)/);
  const chay = fs.readFileSync(new URL("../lens-chay.mjs", import.meta.url), "utf8");
  assert.match(chay, /tai404Text/);
});

// ---------------- A'3 + A'4: int8 ----------------
/** Dựng bộ (b) giả bằng save_vec_outputs của bản sao lens-vec.py; truthKind "ok" | "an-het". */
function fakeB(repoFile, root, truthKind) {
  const py = String.raw`
import importlib.util, json, os, sys
import numpy as np
spec = importlib.util.spec_from_file_location("lens_vec", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root, kind = sys.argv[2], sys.argv[3]
b = os.path.join(root, "clip-fp32-cat", "b"); os.makedirs(b)
rng = np.random.default_rng(3)
X = rng.standard_normal((40, 8)).astype(np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
Q = np.vstack([X[1] + 0.05 * rng.standard_normal(8), X[2] + 0.05 * rng.standard_normal(8), rng.standard_normal(8)]).astype(np.float32); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
codes = [str(1111111111000 + i) for i in range(40)]; qids = ["ab-" + codes[1], "that-1", "buldak"]
truth = {"ab-" + codes[1]: codes[1], "that-1": codes[2], "buldak": "9999999999999"}
hide = {"ab-" + codes[1]: [codes[1]]}
if kind == "an-het":
    hide["that-1"] = [codes[2]]
vao = os.path.join(root, "vec-vao-b.json")
with open(vao, "w", encoding="utf-8") as f: json.dump({"level": "b", "truth": truth}, f)
meta = {"model": "clip-fp32", "pre": "cat", "level": "b", "sha256": "e" * 64, "dims": 8, "nIndex": 40, "nQueries": 3, "queriesMissing": [], "missingIndexFiles": 0,
        "threadCheck": {"pass": True}, "vaoFile": vao, "vaoSha256": m.file_sha256(vao), "hideByRow": hide, "excluded": [codes[1]], "override": {},
        "antiCheatSha256": "1" * 64, "boPSha256": None, "indexKey": {}, "indexImgid": {}, "unavailable404": [], "tai404Sha256": "2" * 64, **m.provenance()}
assert m.save_vec_outputs(b, X, (Q @ X.T).astype(np.float32), codes, qids, meta, qvec=Q)
print(json.dumps({"b": b}))`;
  return JSON.parse(execFileSync(PY, ["-I", "-c", py, repoFile, root, truthKind], { encoding: "utf8" }).trim().split("\n").pop());
}

test("A'3 + A'4 lens-vec.py int8: ghi nTruth + số bỏ theo lý do, sha index-int8.npy / scale-f16.npy; n = 0 → mã 3, không ghi meta", (t) => {
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const repo = cleanRepo("int8");
  const root = path.join(TAM, `int8-${process.pid}-v3b`);
  fs.rmSync(root, { recursive: true, force: true });
  try {
    const run = () => runVecPy(repo.file, ["int8", "--model", "clip-fp32", "--pre", "cat", "--muc", "b", "--vec", root]);
    const mk = fakeB(repo.file, root, "ok");
    const r = run();
    assert.equal(r.status, 0, r.err);
    const d8 = path.join(root, "clip-fp32-cat", "b-int8");
    const m8 = JSON.parse(fs.readFileSync(path.join(d8, "meta.json"), "utf8"));
    // ab-<mã 1> bị ẩn (hidden), buldak mã không có trong chỉ mục (notInIndex), that-1 tính được
    assert.equal(m8.int8Loss.n, 1);
    assert.equal(m8.int8Loss.nTruth, 3);
    assert.deepEqual(m8.int8Loss.skipped, { noTruth: 0, notInIndex: 1, hidden: 1 });
    assert.equal(m8.index8Sha256, sha(fs.readFileSync(path.join(d8, "index-int8.npy"))));
    assert.equal(m8.scaleSha256, sha(fs.readFileSync(path.join(d8, "scale-f16.npy"))));
    assert.equal(m8.gitDirty, false);
    assert.equal(path.resolve(m8.vecPyPath), path.resolve(repo.file));
    assert.deepEqual(int8MetaErrors(m8, { fp32Sha256: sha(fs.readFileSync(path.join(mk.b, "index.npy"))) }), []);
    // mọi truy vấn có mã đúng bị ẩn / không có trong chỉ mục → n = 0 → mã 3, không có meta
    fs.rmSync(root, { recursive: true, force: true });
    fakeB(repo.file, root, "an-het");
    const r0 = run();
    assert.equal(r0.status, 3, r0.err);
    assert.match(r0.err, /int8Loss n = 0/);
    assert.ok(!fs.existsSync(path.join(d8, "meta.json")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

const L = () => ({ n: 2, nTruth: 4, skipped: { noTruth: 1, notInIndex: 1, hidden: 1 }, fp32: { top1: 1, top5: 2, top10: 2 }, int8: { top1: 1, top5: 2, top10: 2 }, changed: { top1: 0, top5: 0, top10: 0 }, top10OverlapMean: 1, maxAbsSimDiff: 0.0004 });
const bM = () => ({ model: "clip-fp32", pre: "cat", level: "b", sha256: H("e"), vaoSha256: H("f"), nIndex: 3, dims: 4, vecPySha256: H("a"), gitHead: "c".repeat(40), gitDirty: false });
const iM = (loss = L()) => ({ ...bM(), quant: INT8_QUANT, fp32Sha256: H("d"), indexBytes: indexBytesInt8(3, 4), int8Loss: loss, index8Sha256: H("6"), scaleSha256: H("7") });
const lists = () => ({ codes: H("3"), queries: H("4") });
const okArgs = () => ({ bMeta: bM(), int8Meta: iM(), fp32Sha256: H("d"), vecPySha256: H("a"), bListSha256: lists(), int8ListSha256: lists(), int8FileSha256: { index: H("6"), scale: H("7") } });

test("A'3 int8MetaErrors: n ≥ 1, có nTruth + skipped và cộng khớp; n = 0 → lỗi", () => {
  assert.deepEqual([...INT8_LOSS_KEYS], ["n", "nTruth", "skipped", "fp32", "int8", "changed", "top10OverlapMean", "maxAbsSimDiff"]);
  assert.deepEqual(int8MetaErrors(iM(), { fp32Sha256: H("d") }), []);
  const bad = (loss, re) => { const e = int8MetaErrors(iM(loss), { fp32Sha256: H("d") }); assert.ok(e.some((x) => re.test(x)), `${re}: ${e.join(" | ")}`); };
  bad({ ...L(), n: 0, nTruth: 2 }, /n = 0/);
  bad({ ...L(), nTruth: undefined }, /thiếu nTruth/);
  bad({ ...L(), skipped: { noTruth: 1, notInIndex: 1 } }, /skipped/);
  bad({ ...L(), nTruth: 5 }, /không khớp/);
});

test("A'4 doInputCheck: sha codes.json / queries.json của (b) và int8 phải trùng; sha file int8 trùng meta; thiếu → mã 3", () => {
  const ok = doInputCheck(okArgs());
  assert.deepEqual([ok.exitCode, ok.errs], [0, []]);
  const cases = {
    "codes.json khác": { int8ListSha256: { ...lists(), codes: H("5") } },
    "queries.json khác": { int8ListSha256: { ...lists(), queries: H("5") } },
    "thiếu sha danh sách (b)": { bListSha256: null },
    "index-int8.npy khác meta": { int8FileSha256: { index: H("8"), scale: H("7") } },
    "scale-f16.npy khác meta": { int8FileSha256: { index: H("6"), scale: H("8") } },
    "thiếu sha file int8": { int8FileSha256: null },
    "meta int8 thiếu index8Sha256": { int8Meta: { ...iM(), index8Sha256: undefined } },
  };
  for (const [why, o] of Object.entries(cases)) {
    const r = doInputCheck({ ...okArgs(), ...o });
    assert.equal(r.exitCode, 3, why);
  }
});

test("A'4 lens-chay --do (nguồn): sha lens-vec.py null → stop; doInputCheck trong try → stop; r6Of(requireClean) ngay sau doInputCheck, trước vòng r5yBy", () => {
  const src = fs.readFileSync(new URL("../lens-chay.mjs", import.meta.url), "utf8");
  const d = src.slice(src.indexOf('if (mode === "do")'), src.indexOf("out.offStats"));
  assert.match(d, /if \(!HEX64_RE\.test\(vecPySha \?\? ""\)\) stop\(/);
  assert.ok(d.indexOf("HEX64_RE.test(vecPySha") < d.indexOf("vecMetaErrors") || !d.includes("vecMetaErrors"));
  assert.match(d, /try \{\n(?:.*\n){0,3}\s*dc = doInputCheck\(/, "doInputCheck trong try");
  assert.match(d, /\} catch \(e\) \{ stop\("KHÔNG KIỂM ĐƯỢC ĐẦU VÀO --do"/);
  const iDc = d.indexOf("doInputCheck(");
  const iR6 = d.indexOf("r6Of(vname, pre, meta.sha256");
  assert.ok(iDc > 0 && iR6 > iDc, "r6Of sau doInputCheck");
  assert.ok(iR6 < d.indexOf("const r5yBy"), "r6Of trước vòng r5yBy nặng");
  assert.ok(iR6 < d.indexOf("percentiles("), "r6Of trước τ / μ");
  assert.match(d, /int8FileSha256: \{ index: fileSha\(path\.join\(i8Dir, "index-int8\.npy"\)\), scale: fileSha\(path\.join\(i8Dir, "scale-f16\.npy"\)\) \}/);
});
