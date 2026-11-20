// Test lens-vec.py (đợt lens, NÊN SỬA 2 + gợi ý 2 của code-reviewer trước đo): bộ sim ghi qua file tạm rồi đổi tên,
// meta.json CHỈ ghi khi kiểm nhiều luồng đạt và ghi CUỐI (xóa meta cũ trước), chữ ký chạy nối có số luồng, file phần ghi
// tạm. Gọi hàm THẬT save_vec_outputs bằng Python của venv đợt lens (D:\tmp\lens\venv); máy không có venv thì skip CÓ lý do.
// Thư mục thử ở D:\tmp\lens-tam (ổ D), xóa sau khi chạy. Không đọc ảnh, không tính vector.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PY = "D:\\tmp\\lens\\venv\\Scripts\\python.exe";
const VEC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lens-vec.py");
const SRC = fs.readFileSync(VEC, "utf8");

/** Chạy save_vec_outputs trong thư mục mới; kịch bản: "pass" | "fail" | "pass-old-meta" | "crash-old-meta". */
function runSave(kind) {
  const dir = path.join("D:\\tmp\\lens-tam", `test-ghi-${process.pid}-${kind}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const py = String.raw`
import importlib.util, json, os, sys
import numpy as np
spec = importlib.util.spec_from_file_location("lens_vec", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
out, kind = sys.argv[2], sys.argv[3]
if kind.endswith("old-meta"):
    with open(os.path.join(out, "meta.json"), "w") as f: json.dump({"cu": True}, f)
X = np.ones((3, 4), np.float32); S = np.zeros((2, 3), np.float32)
meta = {"model": "clip-fp32", "threadCheck": {"pass": kind != "fail"}}
class Boom:
    def __array__(self, *a, **k): raise RuntimeError("ngat giua chung")
try:
    r = m.save_vec_outputs(out, X, Boom() if kind.startswith("crash") else S, ["a", "b", "c"], ["q1", "q2"], meta)
except RuntimeError:
    r = "crash"
print(json.dumps({"r": r, "files": sorted(os.listdir(out))}))
`;
  try {
    return JSON.parse(execFileSync(PY, ["-I", "-c", py, VEC, dir, kind], { encoding: "utf8" }).trim().split("\n").pop());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("lens-vec.py save_vec_outputs: meta.json chỉ khi kiểm luồng đạt, ghi cuối; file tạm đổi tên; ngắt giữa chừng không để meta hợp lệ", (t) => {
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const ok = runSave("pass");
  assert.equal(ok.r, true);
  assert.deepEqual(ok.files, ["codes.json", "index.npy", "meta.json", "queries.json", "sims.npy"], "đủ file, không còn .tam");
  const fail = runSave("fail");
  assert.equal(fail.r, false);
  assert.deepEqual(fail.files, [], "trượt kiểm luồng → không ghi gì (không có meta.json)");
  assert.equal(runSave("pass-old-meta").r, true);
  // ngắt khi đang ghi sims.npy: meta.json cũ đã bị xóa TRƯỚC → thư mục không còn bộ sim "hợp lệ"
  const crash = runSave("crash-old-meta");
  assert.equal(crash.r, "crash");
  assert.ok(!crash.files.includes("meta.json"), `meta.json cũ phải bị xóa trước khi ghi: ${crash.files}`);
  assert.ok(!crash.files.includes("sims.npy"), "sims.npy dở không được đổi tên thành file thật");
});

test("lens-vec.py gio1600 (NÊN SỬA 1 + gợi ý 2, lần 2): tiến trình con BLAS 1 luồng; ghi at / sha lens-vec.py / git HEAD / sha ONNX đã đo", (t) => {
  const g = SRC.slice(SRC.indexOf("def cmd_gio1600("), SRC.indexOf("def main("));
  assert.match(g, /subprocess\.run\(cmd, env=child_env\(\)\)/, "tiến trình con nhận env 1 luồng");
  for (const k of ['merged["at"]', 'merged["vecPySha256"] = file_sha256(', 'merged["gitHead"], merged["gitDirty"] = git_state(', '"onnxSha256": onnx_sha', 'out["childEnv"]']) assert.ok(g.includes(k), `thiếu ${k}`);
  // sha ONNX tính TRƯỚC khi nạp phiên, lệch bản ghim → dừng
  assert.ok(g.indexOf("onnx_sha = file_sha256(onnx_path)") < g.indexOf("sess = session("));
  assert.match(g, /if onnx_sha != MODELS\[name\]\["sha256"\]:\n\s+sys\.exit/);
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const py = String.raw`
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("lens_vec", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
e = m.child_env()
print(json.dumps({"env": {k: e.get(k) for k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")}, "path": "PATH" in e or "Path" in e,
                  "git": m.git_state(os.path.dirname(sys.argv[1])), "nogit": m.git_state("D:\\")}))
`;
  const r = JSON.parse(execFileSync(PY, ["-I", "-c", py, VEC], { encoding: "utf8" }).trim().split("\n").pop());
  assert.deepEqual(r.env, { OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1" });
  assert.equal(r.path, true, "giữ biến môi trường khác");
  assert.match(r.git[0] ?? "", /^[0-9a-f]{40}$/);
  assert.equal(typeof r.git[1], "boolean");
  assert.deepEqual(r.nogit, [null, null], "không có git → null");
});

test("lens-chay ghi gio1600Sha256 vào MỌI file kết quả (đặt trong out trước mọi nhánh ghi)", () => {
  const src = fs.readFileSync(path.join(path.dirname(VEC), "lens-chay.mjs"), "utf8");
  const iOut = src.indexOf("const out = {");
  assert.ok(iOut > 0);
  assert.match(src.slice(iOut, src.indexOf("\n", iOut)), /gio1600Sha256: gio1600Text === null \? null : sha256OfText\(gio1600Text\)/);
  // out tạo TRƯỚC mọi writeFileSync (loi.json, nen, chon-model, cong, do)
  const firstWrite = src.indexOf("fs.writeFileSync(");
  assert.ok(iOut < firstWrite);
  assert.equal((src.match(/r6From\(gio1600, variant, pre, onnxSha256, opts\)/g) || []).length, 1, "r6From nhận sha ONNX meta (+ tùy chọn kiểm của vòng 3)");
});

test("lens-vec.py (gợi ý 2): chữ ký chạy nối có số luồng; file phần ghi tạm rồi đổi tên; hideByRow vào meta; không còn đọc file giờ 400 px", () => {
  assert.match(SRC, /sig = \{[^}]*"threads": a\.threads,/s); // vòng 3 A': sau threads còn vecPySha256 + gitHead
  assert.match(SRC, /atomic_npy\(pf, X\)/);
  assert.doesNotMatch(SRC, /np\.save\(pf/);
  // mọi .npy ghi qua atomic_npy (np.save chỉ có MỘT chỗ: vào file tạm, rồi os.replace)
  assert.equal((SRC.match(/np\.save\(/g) || []).length, 1);
  const an = SRC.slice(SRC.indexOf("def atomic_npy("), SRC.indexOf("def atomic_json("));
  assert.match(an, /np\.save\(f, arr\)[\s\S]*os\.replace\(tmp, path\)/);
  const sv = SRC.slice(SRC.indexOf("def save_vec_outputs("), SRC.indexOf("def cmd_vec("));
  for (const f of ["index.npy", "sims.npy"]) assert.match(sv, new RegExp(`atomic_npy\\(os\\.path\\.join\\(out_dir, "${f.replace(".", "\\.")}"\\)`));
  for (const f of ["codes.json", "queries.json"]) assert.match(sv, new RegExp(`atomic_json\\(os\\.path\\.join\\(out_dir, "${f.replace(".", "\\.")}"\\)`));
  assert.match(sv, /atomic_json\(mp, meta, indent=1\)\n\s+return True/, "meta.json ghi cuối cùng");
  assert.match(SRC, /GUARD_KEYS = \([^)]*"hideByRow"/);
  assert.doesNotMatch(SRC, /a\.gio\b/, "vec không chép số giờ 400 px vào meta (R6 lấy từ gio-1600.json)");
  // kiểm luồng đứng TRƯỚC khi tính truy vấn / ghi bộ sim
  const v = SRC.slice(SRC.indexOf("def cmd_vec("), SRC.indexOf("# ---------------- R6"));
  assert.ok(v.indexOf('if not thread_check["pass"]') < v.indexOf("save_vec_outputs("));
  assert.ok(v.indexOf('if not thread_check["pass"]') < v.indexOf("sims = (Q @ X.T)"));
});

// ---------------- vòng 3 (A1, A4): chứng cứ vector + lệnh int8 ----------------
/** Chạy đoạn Python với module lens-vec.py nạp sẵn là `m`; trả JSON dòng cuối. */
function runPy(body, ...args) {
  const py = `import importlib.util, json, os, sys\nimport numpy as np\nspec = importlib.util.spec_from_file_location("lens_vec", sys.argv[1])\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n${body}`;
  return JSON.parse(execFileSync(PY, ["-I", "-c", py, VEC, ...args], { encoding: "utf8" }).trim().split("\n").pop());
}

test("A1 lens-vec.py: provenance() = sha256 lens-vec.py đang chạy + git HEAD + bẩn / sạch; vec ghi 3 khóa vào meta.json", (t) => {
  const v = SRC.slice(SRC.indexOf("def cmd_vec("), SRC.indexOf("# ---------------- R6"));
  assert.match(v, /\*\*p0,/, "meta của vec mang provenance() lúc đầu lượt (vòng 3 A')");
  assert.match(v, /save_vec_outputs\(out_dir, X, sims, \[x\["code"\] for x in index\], \[q\["qid"\] for q in qs\], meta, qvec=Q\)/, "vec lưu vector truy vấn (qvec.npy) cho lệnh int8");
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const r = runPy(`p = m.provenance()\nprint(json.dumps({"p": p, "sha": m.file_sha256(sys.argv[1])}))`);
  assert.deepEqual(Object.keys(r.p).sort(), ["gitDirty", "gitHead", "vecPyPath", "vecPySha256"], "vòng 3 A': thêm đường dẫn file chạy");
  assert.equal(r.p.vecPySha256, r.sha);
  assert.match(r.p.gitHead, /^[0-9a-f]{40}$/);
  assert.equal(typeof r.p.gitDirty, "boolean");
});

test("A4 lens-vec.py int8: q = clip(round(v·127/max|v|)), c = fp16(1/‖q‖); sim int8 ≈ cosine với vector giải lượng tử (≤ 1e-3)", (t) => {
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const r = runPy(String.raw`
rng = np.random.default_rng(7)
X = rng.standard_normal((50, 16)).astype(np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
Q = rng.standard_normal((6, 16)).astype(np.float32); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
q, c = m.quantize_int8(X)
S8 = m.int8_sims(Q, q, c)
D = q.astype(np.float64); cos = (Q.astype(np.float64) @ D.T) / np.linalg.norm(D, axis=1)[None, :]
deq = q.astype(np.float64) * c.astype(np.float64)[:, None]
print(json.dumps({"dt": [str(q.dtype), str(c.dtype), str(S8.dtype)], "maxq": int(np.abs(q).max(axis=1).min()), "err": float(np.abs(S8 - cos).max()),
  "errDeq": float(np.abs(S8 - Q.astype(np.float64) @ deq.T).max()), "errFp32": float(np.abs(S8 - Q @ X.T).max()),
  "rule": bool(np.array_equal(q, np.clip(np.rint(X.astype(np.float64) * 127 / np.abs(X).max(axis=1, keepdims=True)), -127, 127).astype(np.int8))),
  "zero": [int(v) for v in m.quantize_int8(np.zeros((1, 4), np.float32))[0][0]]}))`);
  assert.deepEqual(r.dt, ["int8", "float16", "float32"]);
  assert.equal(r.maxq, 127, "mỗi vector có phần tử lớn nhất = ±127");
  assert.ok(r.err <= 1e-3, `|sim int8 − cosine(q)| ${r.err}`);
  assert.ok(r.errDeq <= 1e-5, `sim int8 = tích với vector giải lượng tử q·c (${r.errDeq})`);
  assert.ok(r.errFp32 < 0.05, `gần sim fp32 (${r.errFp32})`);
  assert.equal(r.rule, true, "đúng công thức q");
  assert.deepEqual(r.zero, [0, 0, 0, 0], "vector 0 không chia cho 0");
});

test("A4 lens-vec.py int8 (chạy lệnh thật trên bộ (b) giả): ghi b-int8 đủ file, meta đủ khóa, indexBytes đúng, int8Loss; thiếu qvec / truth → mã 3", async (t) => {
  if (!fs.existsSync(PY)) { t.skip(`không có Python của venv đợt lens (${PY})`); return; }
  const { parseNpy, doInputCheck, indexBytesInt8, INT8_QUANT, checkIndexGuard } = await import("../lens-do.mjs");
  const root = path.join("D:\\tmp\\lens-tam", `test-int8-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  try {
    const mk = runPy(String.raw`
root = sys.argv[2]; b = os.path.join(root, "clip-fp32-cat", "b"); os.makedirs(b)
rng = np.random.default_rng(3)
X = rng.standard_normal((40, 8)).astype(np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
Q = np.vstack([X[1] + 0.05 * rng.standard_normal(8), X[2] + 0.05 * rng.standard_normal(8), rng.standard_normal(8)]).astype(np.float32); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
codes = [str(1111111111000 + i) for i in range(40)]; qids = ["ab-" + codes[1], "that-1", "buldak"]
vao = os.path.join(root, "vec-vao-b.json")
with open(vao, "w", encoding="utf-8") as f: json.dump({"level": "b", "truth": {"ab-" + codes[1]: codes[1], "that-1": codes[2], "buldak": "9999999999999"}}, f)
meta = {"model": "clip-fp32", "pre": "cat", "level": "b", "sha256": "e" * 64, "dims": 8, "nIndex": 40, "nQueries": 3, "queriesMissing": [], "missingIndexFiles": 0,
        "threadCheck": {"pass": True}, "vaoFile": vao, "vaoSha256": m.file_sha256(vao), "hideByRow": {"ab-" + codes[1]: [codes[1]]}, "excluded": [codes[1]], "override": {},
        "antiCheatSha256": "1" * 64, "boPSha256": None, "indexKey": {}, "indexImgid": {}, **m.provenance()}
assert m.save_vec_outputs(b, X, (Q @ X.T).astype(np.float32), codes, qids, meta, qvec=Q)
print(json.dumps({"b": b, "files": sorted(os.listdir(b))}))`, root);
    assert.deepEqual(mk.files, ["codes.json", "index.npy", "meta.json", "queries.json", "qvec.npy", "sims.npy"]);
    // vòng 3 A': lệnh int8 dừng mã 3 khi checkout chứa file chạy bẩn → chạy BẢN SAO lens-vec.py trong repo git tạm sạch
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    const vecCopy = path.join(repo, "lens-vec.py");
    fs.copyFileSync(VEC, vecCopy);
    fs.writeFileSync(path.join(repo, ".gitignore"), "__pycache__/\n", "utf8");
    const git = (...a) => execFileSync("git", ["-c", "user.name=lens-test", "-c", "user.email=lens-test@example.invalid", ...a], { cwd: repo, stdio: "ignore" });
    git("init", "-q"); git("add", "-A"); git("commit", "-q", "-m", "ban sao");
    const run = (...extra) => { try { execFileSync(PY, ["-I", vecCopy, "int8", "--model", "clip-fp32", "--pre", "cat", "--muc", "b", "--vec", root, ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return 0; } catch (e) { return e.status; } };
    assert.equal(run(), 0);
    const d8 = path.join(root, "clip-fp32-cat", "b-int8");
    assert.deepEqual(fs.readdirSync(d8).sort(), ["codes.json", "index-int8.npy", "meta.json", "queries.json", "scale-f16.npy", "sims.npy"], "không còn file .tam");
    const m8 = JSON.parse(fs.readFileSync(path.join(d8, "meta.json"), "utf8"));
    const bm = JSON.parse(fs.readFileSync(path.join(mk.b, "meta.json"), "utf8"));
    assert.equal(m8.quant, INT8_QUANT);
    assert.equal(m8.indexBytes, indexBytesInt8(40, 8));
    assert.equal(m8.level, "b");
    for (const k of ["model", "pre", "sha256", "vaoSha256", "hideByRow", "excluded", "override", "threadCheck", "antiCheatSha256", "indexKey", "indexImgid"]) assert.deepEqual(m8[k], bm[k], k);
    const crypto = await import("node:crypto");
    const fpSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(mk.b, "index.npy"))).digest("hex");
    assert.equal(m8.fp32Sha256, fpSha);
    // int8Loss: ab-<mã 1> bị ẩn trên hàng → không tính; buldak mã không có trong chỉ mục → không tính; còn that-1
    assert.equal(m8.int8Loss.n, 1);
    assert.deepEqual(Object.keys(m8.int8Loss.fp32), ["top1", "top5", "top10"]);
    assert.ok(m8.int8Loss.maxAbsSimDiff > 0 && m8.int8Loss.maxAbsSimDiff < 0.05);
    // sims.npy int8 đọc được bằng parseNpy (float32) và đúng cỡ
    const s = parseNpy(fs.readFileSync(path.join(d8, "sims.npy")));
    assert.deepEqual(s.shape, [3, 40]);
    const fsha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    const lst = (d) => ({ codes: fsha(path.join(d, "codes.json")), queries: fsha(path.join(d, "queries.json")) });
    const dc = doInputCheck({ bMeta: bm, int8Meta: m8, fp32Sha256: fpSha, vecPySha256: m8.vecPySha256, bListSha256: lst(mk.b), int8ListSha256: lst(d8), int8FileSha256: { index: fsha(path.join(d8, "index-int8.npy")), scale: fsha(path.join(d8, "scale-f16.npy")) } });
    assert.equal(dc.errs.filter((e) => !/gitDirty/.test(e)).length, 0, dc.errs.join("; "));
    assert.ok(Array.isArray(checkIndexGuard(m8, JSON.parse(fs.readFileSync(path.join(d8, "codes.json"), "utf8")), { level: "b", excluded: [], hideByRow: {}, override: {} }, { model: "clip-fp32", pre: "cat", level: "b" })));
    // thiếu qvec.npy → mã 3, không ghi meta mới
    fs.rmSync(path.join(mk.b, "qvec.npy"));
    fs.rmSync(d8, { recursive: true });
    assert.equal(run(), 3);
    assert.ok(!fs.existsSync(path.join(d8, "meta.json")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
