// Đợt lens: phần CHẠY của khung đo lens-do.mjs (khối luật + phần thuần ở lens-do.mjs). Chỉ đọc file đã tính, không gọi
// mạng (OFF chỉ cache đĩa, chiCache), 0 lượt Azure, không chạy lại OCR. Gọi qua `node lens-do.mjs <cờ>`.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import {
  selfCheck, modeOf, methodGrid, serverTier, isUnsureU, appTier, cellOf, judgeR, targetsM, pickMethod, pickModel, earlyGate,
  percentiles, loadSims, qidOf, indexBytesInt8, RULE_SHA, RULE_FILE, RULE_SHA256, METHOD_COUNT, SERVER_K, FOUND_K, CONDS,
  FOLDERS, CODE_7UP_DIET, BULDAK_CODE, RUAYPUAN_CODE, GOOD_IMGS, WRONG_IMGS, MODEL_VARIANTS, PRE_ORDER, R6_P95_MS,
} from "./lens-do.mjs";
import { ruleBlockOf, keyOf, rankIn } from "./g2-di-qua-do.mjs";
import { splitHalves } from "./may-chu-loc-do.mjs";
import { mergeLocal, scoreTable, BASE_PARAMS } from "./khau-gop-do.mjs";
import { planList, readCatalog, LEVEL_FILES } from "./lens-tai.mjs";
import { serverJoin } from "../../src/front-server.js";

/** RAM máy chủ hiện có (H2 đợt kho-lon vòng 3, Windows, mức (c), MiB) — nền cho ước R6 RAM. */
export const SERVER_RAM_BASE_MIB = 835.3;
export const MAIN_ROOT_PHOTOS = "D:\\quet-ma-vach-full\\test-ocr\\photos";

export async function runMain(argv, selfUrl) {
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const mode = modeOf(argv);
  if (!mode) {
    console.error("Cần đúng một cờ: --chi-nen, --chon-model, --cong hoặc --do.");
    process.exit(2);
  }
  const outDir = arg("--out", "D:\\tmp\\lens\\ket-qua");
  const vecDir = arg("--vec", "D:\\tmp\\lens\\vec");
  const lensDir = arg("--lens", "D:\\tmp\\lens");
  const gocFile = arg("--goc", "D:\\tmp\\may-chu-loc\\ket-qua-goc.json");
  const nhanFile = arg("--nhan", "D:\\tmp\\may-chu-loc\\nhan.json");
  const nenMclFile = arg("--nen-mcl", "D:\\tmp\\may-chu-loc\\ket-qua\\nen.json");
  const nenKgFile = arg("--nen-kg", "D:\\tmp\\khau-gop\\ket-qua\\nen.json");
  const cacheDir = arg("--cache", "D:\\tmp\\tu-dong\\cache-off");
  const ocrDir = arg("--ocr", "D:\\tmp\\dong-noi-bat\\ocr");
  const { loadApp, makeDiskFetch, ROOT, SETS, LINES_7UP, TYPED_7UP } = await import("./tu-dong-do.mjs");
  const { foreignCases, MO_RONG } = await import("./tu-dong-v42-do.mjs");
  const { ALL_CODES, SALT_LINES, saltItems } = await import("./nang-t1-do.mjs");

  // ---- tự kiểm ----
  const startedAt = new Date().toISOString();
  const cp = await import("node:child_process");
  const git = (c) => { try { return cp.execSync(c, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString(); } catch { return null; } };
  const sha = git("git rev-parse HEAD")?.trim() ?? null;
  const porcelain = git("git status --porcelain");
  const dirty = porcelain === null ? null : porcelain.trim() !== "";
  const now = ruleBlockOf(fs.readFileSync(new URL(selfUrl), "utf8"));
  const oldText = RULE_SHA ? git(`git show ${RULE_SHA}:${RULE_FILE}`) : null;
  const sc = selfCheck({ now, old: oldText === null ? null : ruleBlockOf(oldText), dirty });
  for (const l of sc.lines) (sc.exitCode ? console.error : console.log)(l);
  if (sc.exitCode) process.exit(sc.exitCode);
  const outFile = path.join(outDir, `${mode}.json`);
  if (fs.existsSync(outFile) && !argv.includes("--ghi-de")) {
    console.error(`Đã có ${outFile}. Thêm --ghi-de nếu thật sự muốn ghi đè.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // ---- app + ca (như khau-gop-do.mjs) ----
  const app = await loadApp();
  const { t1, fr, catalog, rIndex } = app;
  const osx = app.os;
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, ...rel.split("/"))).href);
  const fm = await imp("src/front-merge.js");
  const fx = await imp("src/front-extra.js");
  const fsv = await imp("src/front-server.js");
  const products = catalog.products;
  const idf = rIndex.index.idf;
  const ctx = { t1, rIndex, products };
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "chup-mat-do", "kho-phu-893.json"), "utf8"));
  const xi = fx.buildExtraIndex(t1, store.products);
  const goc = JSON.parse(fs.readFileSync(gocFile, "utf8"));
  const nhan = JSON.parse(fs.readFileSync(nhanFile, "utf8"));
  const nenMcl = JSON.parse(fs.readFileSync(nenMclFile, "utf8"));
  const nenKg = JSON.parse(fs.readFileSync(nenKgFile, "utf8"));
  const halves = splitHalves(nhan.items);
  const labelOf = new Map(nhan.items.map((x) => [`${x.folder}/${x.file}`, x]));
  const halfOf = new Map(halves.map((x) => [`${x.folder}/${x.file}`, x]));
  const cases = [
    { set: "7up", kind: "may", code: CODE_7UP_DIET, input: { items: saltItems(LINES_7UP, 0.95) } },
    { set: "7up", kind: "go", code: CODE_7UP_DIET, input: { text: TYPED_7UP } },
    { set: "muoi", kind: "muoi", code: null, input: { items: saltItems(SALT_LINES, 0.9) } },
  ];
  for (const [name, code] of [["ruaypuan", RUAYPUAN_CODE], ["buldak", BULDAK_CODE]]) {
    const j = JSON.parse(fs.readFileSync(path.join(ocrDir, `${name}.json`), "utf8"));
    cases.push({ set: name, kind: "man-hinh", code, input: { items: j.items }, file: path.join(ocrDir, "anh", `${name}.jpg`) });
  }
  for (const s of ["B", "A"]) {
    const bundle = JSON.parse(fs.readFileSync(SETS[s].file, "utf8"));
    for (const code of ALL_CODES) {
      const items = bundle.items?.[code]?.items ?? null;
      cases.push({ set: s, kind: "anh", code, input: items ? { items } : null, file: path.join(MAIN_ROOT_PHOTOS, code, "front.jpg") });
    }
  }
  const foreign = foreignCases(JSON.parse(fs.readFileSync(arg("--mo-rong", MO_RONG), "utf8")), new Set(products.map((p) => p.code)), osx.strangeWords, idf);
  for (const f of foreign) cases.push({ set: "ngoai", kind: "ngoai", code: f.code, input: { items: saltItems(f.lines, 0.95) } });
  goc.items.forEach((it, n) => {
    const lab = labelOf.get(`${it.folder}/${it.file}`);
    if (!lab) throw new Error(`thiếu nhãn cho ảnh thật số ${n + 1}`);
    const half = halfOf.get(`${it.folder}/${it.file}`) ?? null;
    cases.push({
      set: "that", kind: `that-${n + 1}`, img: n + 1, code: lab.code && lab.code !== "none" ? lab.code : null, label: lab.code ?? null,
      preset: lab.preset === true, folder: it.folder, group: half?.group ?? null, goc: it, input: { items: it.items },
      file: path.join(path.dirname(nhanFile), "anh", it.folder, it.file),
    });
  });
  const keys = new Set(cases.map(keyOf));
  if (keys.size !== cases.length) throw new Error(`khóa ca trùng: ${cases.length - keys.size}`);

  // ---- chữ ứng viên từ c.jsonl.gz (S đã lưu + mọi mã có thể vào S từ ảnh) ----
  const gz = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "server", "catalog", "c.jsonl.gz"))).toString("utf8");
  const rowBy = new Map();
  for (const line of gz.split("\n")) {
    const m = line && /"code":\s*"(\d+)"/.exec(line);
    if (!m || rowBy.has(m[1])) continue;
    rowBy.set(m[1], line);
  }
  const rowOfCode = (code) => { const l = rowBy.get(code); return l ? JSON.parse(l) : null; };
  const v = (x) => (x == null ? "" : x);
  const sOf = (codes) => fsv.serverCandidates({
    candidates: codes.map((code, r) => {
      const x = rowOfCode(code);
      if (!x) throw new Error("thiếu chữ ứng viên trong c.jsonl.gz");
      return { code, name: v(x.name), brand: v(x.brand), img: v(x.img), text: v(x.text), grp: v(x.grp), score: codes.length - r };
    }),
  });
  for (const c of cases) {
    if (!c.input) continue;
    if (c.set === "that") { c.S = fsv.serverCandidates({ candidates: c.goc.candidates }); continue; }
    const codes = nenMcl.perCase?.[keyOf(c)]?.S;
    if (!Array.isArray(codes)) throw new Error(`thiếu S đã lưu cho ${c.set} ${c.kind}`);
    c.S = sOf(codes);
    if (c.S.length !== codes.length) throw new Error(`S sai dạng (${c.set} ${c.kind})`);
  }

  // ---- found, câu OFF, OFF (i)(ii) ----
  const disk = makeDiskFetch({ cacheDir, chiCache: true, netFetch: null, usage: false });
  const off = osx.createOffSearch({ fetchImpl: disk.fetch, storage: null, timeoutMs: 30000, limit: 1e9 });
  for (const c of cases) {
    if (!c.input) { c.found = null; c.queries = []; continue; }
    c.found = c.input.items ? fr.rankFromItems(t1, rIndex, c.input.items, FOUND_K) : fr.rankFromText(t1, rIndex, c.input.text, FOUND_K);
    c.queries = osx.cleanQuery(c.found.lines, { idf });
    const per = c.queries.length ? await Promise.all(c.queries.map((q) => off.search(q))) : [];
    c.off = { i: c.queries.length ? { ok: false, kind: "network" } : { ok: false, kind: "none" }, ii: fm.joinOffResults(per) };
    c.called = c.queries.length > 0;
    c.qid = qidOf(c);
  }
  const live = cases.filter((c) => c.found);
  const codesOf = (list) => list.map((x) => x.code);
  const sameArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** A0 (nền app) trên S: S rỗng → photoMerge (LÙI). */
  const a0 = (c, S, cond) => (S.length ? fsv.serverMerge(ctx, c.found, c.off[cond], S, { called: c.called }).merged
    : fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called: c.called }).merged);
  const base = new Map();
  for (const c of live) {
    const r = { may: {}, lui: {}, cell: {} };
    for (const cond of CONDS) {
      const mm = a0(c, c.S, cond);
      r.may[cond] = codesOf(mm);
      r.lui[cond] = codesOf(fx.photoMerge({ ...ctx, xi }, c.found, c.off[cond], { called: c.called }).merged);
      r.items = { ...(r.items || {}), [cond]: mm };
      r.cell[cond] = cellOf(mm, c.code, false);
    }
    base.set(keyOf(c), r);
  }

  // ---- kiểm chéo nền ----
  const ck = {};
  const k0 = { cells: 0, same: 0, diff: [] };
  for (const c of live) for (const cond of CONDS) {
    if (!c.S.length) continue;
    k0.cells++;
    if (sameArr(mergeLocal(ctx, c.found, c.off[cond], c.S, BASE_PARAMS), base.get(keyOf(c)).items[cond])) k0.same++; else k0.diff.push(`${c.set} ${c.img ?? c.kind} ${cond}`);
  }
  k0.ok = k0.cells > 0 && k0.same === k0.cells;
  ck.mergeLocal = k0;
  const kc = { cells: 0, may: 0, lui: 0, missing: 0, diff: [], kgAllOk: nenKg.allOk === true, kgMode: nenKg.mode, kgRuleSha256: nenKg.ruleSha256 };
  for (const c of live) {
    const k = c.set === "that" ? `anh-${c.img}` : keyOf(c);
    const saved = nenKg.perCase?.[k];
    if (!saved) { kc.missing++; kc.diff.push(`${k} thiếu`); continue; }
    for (const cond of CONDS) {
      kc.cells++;
      if (sameArr(saved.may?.[cond], base.get(keyOf(c)).may[cond])) kc.may++; else kc.diff.push(`${k} ${cond} MÁY`);
      if (sameArr(saved.lui?.[cond], base.get(keyOf(c)).lui[cond])) kc.lui++; else kc.diff.push(`${k} ${cond} LÙI`);
    }
  }
  kc.ok = kc.missing === 0 && kc.cells === Object.keys(nenKg.perCase || {}).length * 2 && kc.may === kc.cells && kc.lui === kc.cells && kc.kgAllOk && kc.kgMode === "nen";
  ck.khauGop = kc;
  const posOf = (c, cond) => base.get(keyOf(c)).cell[cond];
  const tab = {};
  for (const [name, fn] of Object.entries({
    A: (c) => c.set === "A", B: (c) => c.set === "B", "7up": (c) => c.set === "7up", buldak: (c) => c.set === "buldak",
  })) {
    const rs = live.filter(fn);
    tab[name] = Object.fromEntries(CONDS.map((cond) => [cond, { top1: rs.filter((c) => posOf(c, cond).top1).length, top5: rs.filter((c) => posOf(c, cond).pos != null).length }]));
  }
  const real = live.filter((c) => c.set === "that");
  const good = real.filter((c) => c.code && CONDS.every((cond) => posOf(c, cond).top1)).map((c) => c.img);
  const none3 = real.filter((c) => c.label === "none");
  const kt = { diff: [] };
  const WANT = { A: [13, 19], B: [14, 19], "7up": [2, 2], buldak: [1, 1] };
  for (const [g, [a, b]] of Object.entries(WANT)) for (const cond of CONDS) if (tab[g][cond].top1 !== a || tab[g][cond].top5 !== b) kt.diff.push(`${g} ${cond} ${tab[g][cond].top1}/${tab[g][cond].top5} ≠ ${a}/${b}`);
  if (!sameArr(good, [...GOOD_IMGS])) kt.diff.push(`ảnh thật đúng vị trí 1 ${JSON.stringify(good)} ≠ ${JSON.stringify(GOOD_IMGS)}`);
  if (none3.length !== 6 || !none3.every((c) => CONDS.every((cond) => posOf(c, cond).auto))) kt.diff.push("6 ảnh thư mục 3 không tự mở hết");
  const wrongNow = real.filter((c) => c.code && !CONDS.every((cond) => posOf(c, cond).top1)).map((c) => c.img);
  if (!sameArr(wrongNow, [...WRONG_IMGS])) kt.diff.push(`ảnh thật đang sai có nhãn ${JSON.stringify(wrongNow)} ≠ ${JSON.stringify(WRONG_IMGS)}`);
  kt.ok = kt.diff.length === 0;
  ck.bang = kt;
  const allOk = Object.values(ck).every((x) => x.ok);
  const split = Object.fromEntries(FOLDERS.map((f) => [f, { giu: halves.filter((x) => x.folder === f && x.group === "giu").length, chinh: halves.filter((x) => x.folder === f && x.group === "chinh").length }]));
  console.log(`sha ${sha} dirty ${dirty}; chia nửa ${JSON.stringify(split)}`);
  console.log(`Kiểm chéo mergeLocal(BASE) = serverMerge src: ${k0.ok ? "ĐẠT" : "LỆCH"} ${k0.same}/${k0.cells} ${k0.diff.slice(0, 5).join(", ")}`);
  console.log(`Kiểm chéo nền = khau-gop nen.json từng ô: ${kc.ok ? "ĐẠT" : "LỆCH"} MÁY ${kc.may}/${kc.cells}, LÙI ${kc.lui}/${kc.cells}, thiếu ${kc.missing} (khau-gop allOk ${kc.kgAllOk}, mode ${kc.kgMode}) ${kc.diff.slice(0, 8).join(", ")}`);
  console.log(`Bảng nền: ${JSON.stringify(tab)}; ảnh thật đúng vị trí 1 ${JSON.stringify(good)}; đang sai ${JSON.stringify(wrongNow)}; thư mục 3 tự mở ${none3.filter((c) => CONDS.every((cond) => posOf(c, cond).auto)).length}/6 → ${kt.ok ? "ĐẠT" : "LỆCH " + kt.diff.join("; ")}`);
  const out = { at: new Date().toISOString(), startedAt, mode, sha, dirty, ruleSha: RULE_SHA, ruleSha256: RULE_SHA256, checks: ck, allOk, split, baseTable: tab, good, wrong: wrongNow, cacheOnly: true, azureCalls: 0 };
  if (!allOk) {
    const bad = path.join(outDir, `${mode}.loi.json`);
    fs.writeFileSync(bad, JSON.stringify(out, null, 1), "utf8");
    console.error(`KIỂM CHÉO NỀN LỆCH: dừng báo, không đo. Ghi ${bad}.`);
    process.exit(3);
  }

  if (mode === "nen") {
    // bộ ca cho lens-vec.py (truy vấn ảnh) + tóm tắt ca (không có ảnh / dữ liệu cá nhân, chỉ đường dẫn ngoài git)
    const queries = [];
    const seenQ = new Set();
    for (const c of live) if (c.qid && !seenQ.has(c.qid)) { seenQ.add(c.qid); queries.push({ qid: c.qid, file: c.file, exists: fs.existsSync(c.file) }); }
    const ca = {
      at: new Date().toISOString(), sha, ruleSha256: RULE_SHA256, queries,
      cases: live.map((c) => ({ key: keyOf(c), set: c.set, kind: c.kind, img: c.img ?? null, folder: c.folder ?? null, group: c.group ?? null, preset: c.preset ?? false, label: c.set === "that" ? (c.label === "none" ? "none" : c.code ? "ma" : "null") : null, qid: c.qid, S: codesOf(c.S), base: Object.fromEntries(CONDS.map((cond) => [cond, base.get(keyOf(c)).may[cond]])) })),
    };
    fs.writeFileSync(path.join(lensDir, "ca.json"), JSON.stringify(ca, null, 1), "utf8");
    out.queries = queries.length;
    out.queriesMissing = queries.filter((q) => !q.exists).map((q) => q.qid);
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
    console.log(`Bộ ca: ${live.length} ca, ${queries.length} truy vấn ảnh (thiếu file ${out.queriesMissing.length}). Ghi ${path.join(lensDir, "ca.json")} + ${outFile}. OFF lượt mạng ${disk.stats.calls}.`);
    return;
  }

  // ---- dữ liệu ảnh ----
  const ac = JSON.parse(fs.readFileSync(path.join(lensDir, "chong-an-gian.json"), "utf8"));
  if (ac.complete !== true || (ac.items || []).length !== 30) { console.error("chong-an-gian.json chưa đủ 30 mã A / B (chạy lại lens-tai.mjs --chong-an-gian): không đo."); process.exit(3); }
  const excluded = new Set(ac.excluded || []);
  const abCodes = [...new Set(live.filter((c) => c.set === "A" || c.set === "B").map((c) => c.code))];
  const realLab = real.filter((c) => c.code);
  const variantDirs = (level) => {
    const out2 = [];
    for (const vname of MODEL_VARIANTS) for (const pre of PRE_ORDER) {
      const d = path.join(vecDir, `${vname}-${pre}`, level);
      if (fs.existsSync(path.join(d, "meta.json"))) out2.push({ variant: vname, pre, dir: d });
    }
    return out2;
  };
  const imgTop5 = (sims, code, qid) => { const r = sims.rowOf(qid); return r ? rankIn(r.ranked, code, 5) : null; };

  if (mode === "chon-model") {
    const nB = planList(readCatalog(LEVEL_FILES.b)).items.length;
    const vs = [];
    for (const vd of variantDirs("a")) {
      const sims = loadSims(vd.dir);
      const inIdx = new Set(sims.codes);
      const abMeas = abCodes.filter((code) => !excluded.has(code) && inIdx.has(code));
      const abTop5 = abMeas.filter((code) => imgTop5(sims, code, `ab-${code}`) != null).length;
      const realCh = realLab.filter((c) => c.group === "chinh");
      const realTop5 = realCh.filter((c) => imgTop5(sims, c.code, c.qid) != null).length;
      const m = sims.meta;
      vs.push({ variant: vd.variant, pre: vd.pre, license: m.license, onnxBytes: m.onnxBytes, p95: m.timing?.p95, ramMiB: m.ramAddMiB, dims: m.dims, r7Bytes: indexBytesInt8(nB, m.dims), abTop5, abMeas: abMeas.length, realTop5, realCh: realCh.length });
    }
    const pick = pickModel(vs);
    Object.assign(out, { variants: vs, pick, nB });
    for (const x of vs) console.log(`${(x.variant + "|" + x.pre).padEnd(20)} A/B top5 ${x.abTop5}/${x.abMeas} ảnh thật chỉnh top5 ${x.realTop5}/${x.realCh} p95 ${x.p95} ms R7 ${x.r7Bytes} B (${x.license})`);
    console.log(`== Chọn biến thể: ${pick.name ?? "KHÔNG CÓ (mọi biến thể trượt R6 / R7)"}; loại ${JSON.stringify(pick.dropped)}`);
  }

  if (mode === "cong") {
    const cm = JSON.parse(fs.readFileSync(path.join(outDir, "chon-model.json"), "utf8"));
    if (cm.ruleSha256 !== RULE_SHA256 || !cm.pick?.name) { console.error("chon-model.json khác RULE_SHA256 hoặc chưa chọn biến thể."); process.exit(3); }
    const [vname, pre] = cm.pick.name.split("|");
    const sims = loadSims(path.join(vecDir, `${vname}-${pre}`, "a"));
    const inIdx = new Set(sims.codes);
    const ab = abCodes.map((code) => ({ code, measurable: !excluded.has(code) && inIdx.has(code), pos: imgTop5(sims, code, `ab-${code}`) }));
    const byImg = new Map(real.map((c) => [c.img, c]));
    const wrong = WRONG_IMGS.map((n) => { const c = byImg.get(n); return { img: n, inIndex: inIdx.has(c.code), pos: imgTop5(sims, c.code, c.qid) }; });
    const lensTop1 = (c) => sims.rowOf(c.qid)?.lens?.top1 ?? null;
    const g = earlyGate({ ab, wrong, none3: none3.map((c) => ({ img: c.img, top1: lensTop1(c) })), good: GOOD_IMGS.map((n) => ({ img: n, top1: lensTop1(byImg.get(n)) })) });
    Object.assign(out, { variant: cm.pick.name, gate: g, wrong, ab: ab.map((x) => ({ measurable: x.measurable, pos: x.pos })) });
    console.log(`Cổng dừng sớm (${cm.pick.name}, mức a): G3 ${g.G3} (${g.detail.abHit5}/${g.detail.abMeasurable} = ${(g.detail.rate * 100).toFixed(1)} %), G1 ${g.G1} (${g.detail.g1n}/${g.detail.wrongInIndex} ảnh sai có mã trong chỉ mục), G2 ${g.G2} (${g.detail.g2n}/6 dưới ${g.detail.minGood}) → ${g.pass ? "ĐI TIẾP (b)" : "DỪNG, không tải (b)"}`);
  }

  if (mode === "do") {
    const level = arg("--muc", "b");
    const cm = JSON.parse(fs.readFileSync(path.join(outDir, "chon-model.json"), "utf8"));
    const cg = JSON.parse(fs.readFileSync(path.join(outDir, "cong.json"), "utf8"));
    if (cm.ruleSha256 !== RULE_SHA256 || cg.ruleSha256 !== RULE_SHA256 || !cg.gate?.pass) { console.error("Chưa qua cổng dừng sớm / khác RULE_SHA256: không đo."); process.exit(3); }
    const [vname, pre] = cm.pick.name.split("|");
    const sims = loadSims(path.join(vecDir, `${vname}-${pre}`, `${level}-int8`));
    const meta = sims.meta;
    const abCells = live.filter((c) => c.set === "A" || c.set === "B");
    const tops = abCells.map((c) => sims.rowOf(c.qid)?.lens).filter(Boolean);
    const taus = percentiles(tops.map((l) => l.top1));
    const mus = percentiles(tops.map((l) => l.margin));
    const grid = methodGrid(taus, mus);
    if (grid.length !== METHOD_COUNT) throw new Error(`lưới ${grid.length} ≠ ${METHOD_COUNT}`);
    // S mới theo tầng máy chủ (mỗi ca, mỗi S) + A0 trên S đó
    const sNew = new Map();
    for (const c of live) {
      const row = c.qid ? sims.rowOf(c.qid) : null;
      for (const s of [...new Set(grid.map((g) => g.s))]) {
        const codes = row ? serverTier(s, codesOf(c.S), row.ranked.slice(0, SERVER_K)) : codesOf(c.S);
        const S = s === "S0" || !row ? c.S : sOf(codes);
        const m0 = Object.fromEntries(CONDS.map((cond) => [cond, s === "S0" || !row ? base.get(keyOf(c)).items[cond] : a0(c, S, cond)]));
        sNew.set(`${keyOf(c)}|${s}`, { S, m0 });
      }
    }
    const chuOf = (c, S, cond, m) => (m.length ? scoreTable(ctx, c.found, serverJoin(c.off[cond], S))(m[0].code).matched : 0);
    // nhớ m + số từ khớp mục 1 theo (S, A, ca, ô, có lens): U chỉ đổi cờ "không chắc", không đổi m
    const memo = new Map();
    const evalCells = (g, { noLens = false } = {}) => {
      const res = new Map();
      for (const c of live) {
        const row = !noLens && c.qid ? sims.rowOf(c.qid) : null;
        const sn = sNew.get(`${keyOf(c)}|${noLens ? "S0" : g.s}`);
        const r = {};
        for (const cond of CONDS) {
          const mk = `${noLens ? "S0" : g.s}|${g.a.id}|${keyOf(c)}|${cond}|${row ? 1 : 0}`;
          if (!memo.has(mk)) {
            const mm = appTier(ctx, c, sn.S, cond, g.a, row ? { lens: row.lens, simOf: row.simOf, base0: sn.m0[cond] } : { lens: null, simOf: null, base0: sn.m0[cond] });
            memo.set(mk, { m: mm, chu: row ? chuOf(c, sn.S, cond, mm) : 0 });
          }
          const { m, chu } = memo.get(mk);
          const unsure = row ? isUnsureU(g.u, row.lens, chu) : false;
          r[cond] = { m: codesOf(m), cell: cellOf(m, c.code, unsure) };
        }
        res.set(keyOf(c), r);
      }
      return res;
    };
    const verdictOf = (res, extra) => {
      const ab = abCells.flatMap((c) => CONDS.map((cond) => ({ id: `${c.set}|${c.code}|${cond}`, base: posOf(c, cond), got: res.get(keyOf(c))[cond].cell })));
      const byImg = new Map(real.map((c) => [c.img, c]));
      const goodR = GOOD_IMGS.flatMap((n) => CONDS.map((cond) => ({ id: `anh-${n}|${cond}`, got: res.get(keyOf(byImg.get(n)))[cond].cell })));
      const s7 = live.filter((c) => c.set === "7up").flatMap((c) => CONDS.map((cond) => ({ id: `${c.kind}|${cond}`, got: res.get(keyOf(c))[cond].cell })));
      const bu = live.find((c) => c.set === "buldak");
      const buldak = CONDS.map((cond) => ({ id: cond, top1Code: res.get(keyOf(bu))[cond].m[0] ?? null, auto: res.get(keyOf(bu))[cond].cell.auto }));
      const noImgSame = live.filter((c) => !c.qid).every((c) => CONDS.every((cond) => sameArr(res.get(keyOf(c))[cond].m, base.get(keyOf(c)).may[cond]) && res.get(keyOf(c))[cond].cell.auto === posOf(c, cond).auto));
      return judgeR({ ab, good: goodR, s7, buldak, noImgSame, ...extra });
    };
    const rowsOf = (res) => real.filter((c) => c.group && (c.code || c.label === "none")).flatMap((c) => CONDS.map((cond) => ({
      id: `anh-${c.img}|${cond}`, img: c.img, group: c.group, folder: c.folder, preset: c.preset, label: c.code ? "ma" : "none", base: posOf(c, cond), got: res.get(keyOf(c))[cond].cell,
    })));
    const r5yBy = new Map();
    for (const s of [...new Set(grid.map((g) => g.s))]) {
      const res = evalCells({ s, a: { id: "A0" }, u: { id: "U0" } });
      r5yBy.set(s, verdictOf(res, { r5x: true, r5y: { pass: true }, r6: { p95: 0, ramMiB: 0 }, r7: { bytes: 0 } }));
    }
    const r6 = { p95: meta.timing?.p95, ramMiB: SERVER_RAM_BASE_MIB + (meta.ramAddMiB ?? Infinity) + (meta.indexBytes ?? Infinity) / 1048576 };
    const r7 = { bytes: meta.indexBytes };
    const methods = [];
    for (const g of grid) {
      const res = evalCells(g);
      const resX = evalCells(g, { noLens: true });
      const r5x = live.every((c) => CONDS.every((cond) => sameArr(resX.get(keyOf(c))[cond].m, base.get(keyOf(c)).may[cond]) && resX.get(keyOf(c))[cond].cell.auto === posOf(c, cond).auto));
      const r5y = { pass: r5yBy.get(g.s).gates.R1 && r5yBy.get(g.s).gates.R2 && r5yBy.get(g.s).gates.R3 && r5yBy.get(g.s).gates.R4 };
      const verdict = verdictOf(res, { r5x, r5y, r6, r7 });
      methods.push({ name: g.name, verdict, t: targetsM(rowsOf(res)) });
    }
    const pick = pickMethod(methods);
    const baseT = targetsM(rowsOf(evalCells({ s: "S0", a: { id: "A0" }, u: { id: "U0" } })));
    Object.assign(out, {
      variant: cm.pick.name, level, taus, mus, methodCount: grid.length, r6, r7, baseTarget: { M1: baseT.M1, M2: baseT.M2, M3: baseT.M3 }, pick,
      passCount: methods.filter((x) => x.verdict.pass).length,
      methods: methods.map((x) => ({ name: x.name, pass: x.verdict.pass, gates: x.verdict.gates, M: [x.t.M1, x.t.M2, x.t.M3], holdOk: x.t.holdOk, refOnly: x.t.refOnly })),
      int8Loss: meta.int8Loss ?? null,
    });
    console.log(`τ ${JSON.stringify(taus)} μ ${JSON.stringify(mus)}; ${grid.length} cách; qua R1–R7 ${out.passCount}; nền M ${JSON.stringify(out.baseTarget)}; R6 ${JSON.stringify(r6)} (p95 ≤ ${R6_P95_MS}); R7 ${r7.bytes} B`);
    console.log(`== Kết luận: ${pick.name ? `CHỌN ${pick.name}` : "KHÔNG CÁCH NÀO ĐẠT"}; chỉ để tham khảo: ${JSON.stringify(pick.refOnly.slice(0, 10))}`);
  }

  out.offStats = disk.stats;
  out.offNetCalls = disk.stats.calls;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1), "utf8");
  console.log(`OFF lượt mạng ${disk.stats.calls} (chỉ cache), Azure 0. Ghi: ${outFile}`);
}
