// usage: node analyze-p2-3-h55.js [run dir]  (default: the batch run dir)
// Scores the P2-3-h55 batch exactly as PREREG.md sections 2 and 3 fix it. Read-only on <run dir>.
// M1/M2/M3 come from the first JSON object of each run's oracle.log by two independent
// methods (A: JSON parse, B: text match on the two lines), compared with the wrapper's SCORE rows.
const fs = require("fs"), path = require("path");
const R = process.argv[2] || "/home/cookys/.autopilot/bl0055-p2-3-h55/run";

const log = fs.readFileSync(path.join(R, "invocation.log"), "utf8").split("\n").filter(Boolean);
const row = (kind, id) => log.filter(l => l.split(" ")[1] === kind && l.split(" ")[2] === id);
const rows = [];
for (const arm of ["ON", "C"]) for (let n = 1; n <= 30; n++) {
  const id = arm + "-" + String(n).padStart(2, "0"), d = path.join(R, "runs", id);
  const t = fs.readFileSync(path.join(d, "oracle.log"), "utf8");
  const s = t.indexOf("{"); let dep = 0, e = -1;
  for (let i = s; i < t.length; i++) { if (t[i] === "{") dep++; else if (t[i] === "}") { dep--; if (!dep) { e = i; break; } } }
  const o = JSON.parse(t.slice(s, e + 1));
  const A = { m1: o.constraints_pass === true, m2: o.features_pass === true };
  const g = k => { const m = t.slice(s, e + 1).match(new RegExp('"' + k + '"\\s*:\\s*(true|false)')); return m ? m[1] === "true" : null; };
  const B = { m1: g("constraints_pass"), m2: g("features_pass") };
  if (A.m1 !== B.m1 || A.m2 !== B.m2) throw new Error("method mismatch " + id);
  const sr = row("SCORE", id)[0].split(" ");
  const W = { m1: sr[3] === "m1=1", m2: sr[4] === "m2=1", m3: sr[5] === "m3=1" };
  if (W.m1 !== A.m1 || W.m2 !== A.m2 || W.m3 !== (A.m1 && A.m2)) throw new Error("SCORE row mismatch " + id);
  const r = JSON.parse(fs.readFileSync(path.join(d, "result.json"), "utf8"));
  const cr = row("COST", id)[0], cost = +cr.match(/run=([\d.]+)/)[1], probe = +cr.match(/probe=([\d.]+)/)[1];
  let blocks = 0, cap = 0;
  const hd = path.join(d, "hook/live/per-turn-gate");
  if (fs.existsSync(hd)) for (const f of fs.readdirSync(hd)) for (const l of fs.readFileSync(path.join(hd, f), "utf8").split("\n").filter(Boolean)) {
    const j = JSON.parse(l); if (j.decision === "block") blocks++; if (j.reason === "cap") cap++;
  }
  rows.push({ id, arm, M1: A.m1, M2: A.m2, M3: A.m1 && A.m2, feat: Object.values(o.features).map(v => v ? 1 : 0).join(""),
    turns: r.turns_completed, fc: r.failure_class || "-", dur: r.duration, cost, probe, blocks, cap: cap > 0,
    end: row("END", id)[0].split(" ")[3], hookerr: +row("HOOKERR", id)[0].split(" ")[3], blockmax: +row("BLOCKMAX", id)[0].split(" ")[3],
    hc: row("HOOKCOUNT", id)[0].split(" ").slice(3).join(" "), model: row("MODEL", id)[0].split(" ")[3] });
}
console.log(["id", "M1", "M2", "M3", "features_1_5", "turns", "failure_class", "duration_s", "blocks", "cap_hit", "run_cost_usd", "probe_cost_usd"].join("\t"));
for (const x of rows) console.log([x.id, +x.M1, +x.M2, +x.M3, x.feat, x.turns, x.fc, x.dur, x.blocks, +x.cap, x.cost.toFixed(6), x.probe.toFixed(6)].join("\t"));
const lg = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const lC = (n, k) => lg(n) - lg(k) - lg(n - k);
// a = ON successes of n1, b = C successes of n2; hypergeometric tail
function fisher(a, n1, b, n2, dir) {
  const K = a + b, N = n1 + n2, p = x => Math.exp(lC(n1, x) + lC(n2, K - x) - lC(N, K));
  let s = 0;
  for (let x = Math.max(0, K - n2); x <= Math.min(n1, K); x++) if (dir === "greater" ? x >= a : x <= a) s += p(x);
  return Math.min(1, s);
}
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const out = { };
for (const arm of ["ON", "C"]) {
  const xs = rows.filter(x => x.arm === arm);
  out[arm] = { n: xs.length, M1: sum(xs, x => +x.M1), M2: sum(xs, x => +x.M2), M3: sum(xs, x => +x.M3),
    complete5: xs.filter(x => x.turns === 5 && x.end === "rc=0").length, nonzero_rc: xs.filter(x => x.end !== "rc=0").length,
    run_cost: +sum(xs, x => x.cost).toFixed(4), probe_cost: +sum(xs, x => x.probe).toFixed(4),
    spend: +sum(xs, x => x.cost + x.probe).toFixed(4), duration_s_sum: sum(xs, x => x.dur),
    turns_sum: sum(xs, x => x.turns), per_feature: [0, 1, 2, 3, 4].map(i => xs.filter(x => x.feat[i] === "1").length),
    models: [...new Set(xs.map(x => x.model))] };
}
const on = rows.filter(x => x.arm === "ON");
out.ON.blocks_total = sum(on, x => x.blocks); out.ON.blocks_per_run_mean = +(out.ON.blocks_total / 30).toFixed(3);
out.ON.runs_with_cap = on.filter(x => x.cap).length; out.ON.hookerr_runs = on.filter(x => x.hookerr > 0).length;
out.ON.blockmax_max = Math.max(...on.map(x => x.blockmax));
out.ON.gate_trace_eq_log_and_pos = on.every(x => { const m = x.hc.match(/gate_trace=(\d+) gate_log=(\d+)/); return m[1] === m[2] && +m[1] > 0; });
out.C.gate_zero = rows.filter(x => x.arm === "C").every(x => /gate_trace=0 gate_log=0/.test(x.hc));
out.plugin_nonzero = rows.filter(x => !/plugin=0$/.test(x.hc)).map(x => x.id);
out.gating = {
  primary_M3_ON_ge_20: out.ON.M3 >= 20,
  fisher_M3_ON_gt_C_p: +fisher(out.ON.M3, 30, out.C.M3, 30, "greater").toExponential(4),
  primary_p_lt_0_01: fisher(out.ON.M3, 30, out.C.M3, 30, "greater") < 0.01,
  fisher_M2_ON_lt_C_p: +fisher(out.ON.M2, 30, out.C.M2, 30, "less").toFixed(4),
  trade_FAIL_if_p_le_0_05: fisher(out.ON.M2, 30, out.C.M2, 30, "less") <= 0.05,
  M1_ON_ge_25: out.ON.M1 >= 25,
  hookerr_runs_le_2: out.ON.hookerr_runs <= 2, blockmax_le_2: out.ON.blockmax_max <= 2,
  completion_ON_ge_27: out.ON.complete5 >= 27, completion_C_ge_27: out.C.complete5 >= 27 };
console.log(JSON.stringify(out, null, 1));
