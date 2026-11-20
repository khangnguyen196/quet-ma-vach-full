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
  assert.equal((src.match(/r6From\(gio1600, variant, pre, onnxSha256\)/g) || []).length, 1, "r6From nhận sha ONNX meta");
});

test("lens-vec.py (gợi ý 2): chữ ký chạy nối có số luồng; file phần ghi tạm rồi đổi tên; hideByRow vào meta; không còn đọc file giờ 400 px", () => {
  assert.match(SRC, /sig = \{[^}]*"threads": a\.threads\}/s);
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
