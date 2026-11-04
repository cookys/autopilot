#!/usr/bin/env node
'use strict';
// score-rolekit.js -- the single mechanical verdict of a rolekit prereg row. No model call. Node built-ins only.
//   score-rolekit.js --prereg prereg/<row>.json --results <results.jsonl> [--tasks tasks/manifest.json] [--evidence evidence.json] [--json]
// results.jsonl: one row per cell {role, task, rep, arm: A|B|C|D, seat: weak1|weak2|strong, pass: 0|1,
//   infra: bool, parse_ok: bool, kit_applied: bool, cost_usd: number}.
// The rows are checked against the FROZEN SCHEDULE (arm x seat x role x task x rep, derived from prereg.design and the
// frozen task manifest): a row outside the schedule or a duplicate row is refused (exit 2); a scheduled cell with no row
// counts as infra in every rate. All decisions use exact integer/rational arithmetic (BigInt); the rounded numbers in the
// output are display only. Thresholds come from prereg.verdict.params (decimal numbers, read as exact decimals).
// Pilot rows give PILOT_OK / PILOT_FIX, formal rows SHIP_CANDIDATE / NOT_SHIP / INCONCLUSIVE_INFRA.
// Exit 0 when it could score; 2 on usage, a refused row, or a task set that does not match the design.
const fs = require('fs');

const ARMS = ['A', 'B', 'C', 'D'];

// ---- exact rationals (BigInt)
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; };
function fr(n, d = 1n) { n = BigInt(n); d = BigInt(d); if (d === 0n) throw new Error('zero denominator'); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; }
const add = (x, y) => fr(x.n * y.d + y.n * x.d, x.d * y.d);
const sub = (x, y) => fr(x.n * y.d - y.n * x.d, x.d * y.d);
const mul = (x, y) => fr(x.n * y.n, x.d * y.d);
const cmp = (x, y) => { const l = x.n * y.d; const r = y.n * x.d; return l < r ? -1 : l > r ? 1 : 0; };
const disp = (x) => Number(x.n) / Number(x.d);
function dec(v) { // exact decimal from a number or string such as 0.15, "-0.10", 5
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v));
  if (!m) throw new Error(`threshold is not a plain decimal: ${v}`);
  const frac = m[3] || '';
  return fr(BigInt(`${m[1]}${m[2]}${frac}`), 10n ** BigInt(frac.length));
}
function tailAtMost(b, n, alpha) { // P(X >= b), X ~ Bin(n, 1/2), <= alpha, exactly
  let c = 1n; let tail = 0n;
  for (let k = 0; k <= n; k += 1) { if (k >= b) tail += c; c = (c * BigInt(n - k)) / BigInt(k + 1); }
  return { ok: tail * alpha.d <= alpha.n * (2n ** BigInt(n)), p: Number(tail) / 2 ** n };
}

// ---- schedule
function schedule(prereg, taskMap) {
  const keys = [];
  for (const arm of prereg.design.arms) for (const seat of arm.seats) {
    const reps = prereg.design.reps[arm.id][seat];
    for (const role of prereg.design.roles) {
      const tasks = taskMap[role] || [];
      if (tasks.length !== prereg.design.tasks_by_role[role]) throw new Error(`task set for ${role} has ${tasks.length} tasks but the design says ${prereg.design.tasks_by_role[role]} (task set not frozen)`);
      for (const task of tasks) for (let rep = 0; rep < reps; rep += 1) keys.push(`${arm.id}|${seat}|${role}|${task}|${rep}`);
    }
  }
  return keys;
}
const rowKey = (r) => `${r.arm}|${r.seat}|${r.role}|${r.task}|${r.rep}`;
function validateRows(rows, sched) {
  const seen = new Set(); const want = new Set(sched);
  rows.forEach((r, i) => {
    const ok = r && typeof r === 'object' && ARMS.includes(r.arm) && typeof r.role === 'string' && typeof r.task === 'string' && Number.isInteger(r.rep)
      && typeof r.seat === 'string' && typeof r.infra === 'boolean' && (r.infra || r.pass === 0 || r.pass === 1);
    if (!ok) throw new Error(`malformed row ${i}: ${JSON.stringify(r)}`);
    const k = rowKey(r);
    if (!want.has(k)) throw new Error(`row ${i} is not in the frozen schedule: ${k}`);
    if (seen.has(k)) throw new Error(`duplicate row ${i}: ${k}`);
    seen.add(k);
  });
  return seen;
}

// ---- per-role tables over the primary seats (weak1 for A/B/C, strong for D); infra and missing cells are not scored
function tables(rows, prereg, taskMap) {
  const prim = (arm, seat) => (arm === 'D' ? seat === 'strong' : seat === 'weak1');
  const out = {};
  for (const role of prereg.design.roles) {
    const t = Object.fromEntries(ARMS.map((a) => [a, {}]));
    for (const r of rows) if (r.role === role && prim(r.arm, r.seat) && !r.infra) (t[r.arm][r.task] = t[r.arm][r.task] || []).push(r.pass);
    const keep = (taskMap[role] || []).filter((k) => ARMS.every((a) => (t[a][k] || []).length > 0));
    out[role] = { t, keep };
  }
  return out;
}
function score(T, a) { // exact mean over kept tasks of the mean over reps; null when nothing is kept
  if (!T.keep.length) return null;
  let acc = fr(0);
  for (const k of T.keep) { const xs = T.t[a][k]; acc = add(acc, fr(xs.reduce((p, q) => p + q, 0), xs.length)); }
  return mul(acc, fr(1, T.keep.length));
}
function pairs(rows, role, tasks) {
  const get = (arm) => new Map(rows.filter((x) => x.role === role && x.arm === arm && x.seat === 'weak1' && !x.infra && tasks.includes(x.task)).map((x) => [`${x.task}#${x.rep}`, x.pass]));
  const B = get('B'); const C = get('C'); let b = 0; let c = 0;
  for (const [k, v] of B) if (C.has(k)) { if (v === 1 && C.get(k) === 0) b += 1; if (v === 0 && C.get(k) === 1) c += 1; }
  return { b, c };
}
function infraCounts(rows, sched, filter) { // scheduled cells matching filter(key parts) and how many are infra or missing
  const have = new Map(rows.map((r) => [rowKey(r), r]));
  let n = 0; let bad = 0;
  for (const k of sched) { const [arm, seat, role] = k.split('|'); if (!filter({ arm, seat, role })) continue; n += 1; const r = have.get(k); if (!r || r.infra) bad += 1; }
  return { n, bad };
}
const rateOver = (c, limit) => c.bad * Number(limit.d) > Number(limit.n) * c.n; // bad/n > limit, exact for the small integers here

function scoreFormal(rows, prereg, taskMap) {
  const P = prereg.verdict.params; const roles = prereg.design.roles;
  const sched = schedule(prereg, taskMap); validateRows(rows, sched);
  const lim = dec(P.infra_arm_seat_max);
  const infraBad = [];
  for (const arm of prereg.design.arms) for (const seat of arm.seats) {
    const c = infraCounts(rows, sched, (k) => k.arm === arm.id && k.seat === seat);
    if (rateOver(c, lim)) infraBad.push({ arm_seat: `${arm.id}/${seat}`, infra_or_missing: c.bad, scheduled: c.n });
  }
  if (infraBad.length) return { verdict: 'INCONCLUSIVE_INFRA', infra_over: infraBad, roles: {} };
  const tb = tables(rows, prereg, taskMap); const per = {};
  const headroomMin = dec(P.headroom_min); const gapMin = dec(P.gap_closed_min); const alpha = dec(P.discordant_alpha); const harmDelta = dec(P.harm_delta);
  let nPass = 0; let nHarm = 0;
  for (const role of roles) {
    const T = tb[role]; const s = Object.fromEntries(ARMS.map((a) => [a, score(T, a)]));
    if (!T.keep.length) { per[role] = { status: 'no_scorable_tasks', n_tasks: 0 }; continue; }
    const headroom = sub(s.D, s.A);
    const e = { n_tasks: T.keep.length, s: Object.fromEntries(ARMS.map((a) => [a, disp(s[a])])), headroom: disp(headroom) };
    e.harm = cmp(sub(s.B, s.A), harmDelta) <= 0;
    if (e.harm) nHarm += 1;
    if (cmp(headroom, headroomMin) < 0) { e.status = 'no_headroom'; per[role] = e; continue; }
    e.gap_closed = disp(mul(sub(s.B, s.A), fr(headroom.d, headroom.n)));
    const gapOk = cmp(sub(s.B, s.A), mul(gapMin, headroom)) >= 0;
    const { b, c } = pairs(rows, role, T.keep);
    const tail = b > c ? tailAtMost(b, b + c, alpha) : { ok: false, p: 1 };
    e.discordant = { b, c, p: tail.p };
    e.B_beats_C = tail.ok;
    e.role_pass = gapOk && e.B_beats_C;
    e.status = e.role_pass ? 'pass' : 'fail';
    if (e.role_pass) nPass += 1;
    per[role] = e;
  }
  return { verdict: nPass >= P.roles_pass_min && nHarm === 0 ? 'SHIP_CANDIDATE' : 'NOT_SHIP', roles_pass: nPass, roles_harm: nHarm, roles: per };
}

// ---- G6 evidence: produced by collect-evidence.js from a real run of the unit tests, re-checked here
const REQUIRED_GRADERS = ['reviewer', 'implementer', 'verifier', 'planner', 'debugger', 'explorer', 'score-rolekit', 'compile-kit', 'stamp-rolekit'];
function evidenceProblems(ev, prereg) {
  const p = [];
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(ev)) return ['evidence is not an object'];
  if (ev.schema_version !== 1) p.push('schema_version');
  if (ev.row !== prereg.row) p.push('row');
  if (!/^[0-9a-f]{40}$/.test(String(ev.head_sha))) p.push('head_sha');
  const u = ev.unit_tests;
  if (!isObj(u) || !Number.isInteger(u.tests) || u.tests <= 0 || u.pass !== u.tests || u.fail !== 0) p.push('unit_tests (tests>0, pass==tests, fail==0)');
  const n = ev.negative_controls;
  if (!isObj(n) || !Array.isArray(n.graders_red) || REQUIRED_GRADERS.some((g) => !n.graders_red.includes(g))) p.push(`negative_controls.graders_red must list ${REQUIRED_GRADERS.join(',')}`);
  if (!Number.isInteger(ev.sentinel_calls) || ev.sentinel_calls !== 0) p.push('sentinel_calls must be the integer 0');
  return p;
}

function scorePilot(rows, prereg, taskMap, evidence) {
  const P = prereg.verdict.params; const roles = prereg.design.roles; const gates = {}; const why = {};
  const sched = schedule(prereg, taskMap); validateRows(rows, sched);
  const all = infraCounts(rows, sched, () => true);
  let worstOver = false;
  for (const arm of ARMS) for (const role of roles) { const c = infraCounts(rows, sched, (k) => k.arm === arm && k.role === role); if (c.n && rateOver(c, dec(P.infra_arm_role_max))) worstOver = true; }
  gates.G1 = !rateOver(all, dec(P.infra_total_max)) && !worstOver;
  const have = new Map(rows.map((r) => [rowKey(r), r]));
  const bcKeys = sched.filter((k) => /^[BC]\|/.test(k));
  const kitOk = bcKeys.filter((k) => have.get(k) && have.get(k).kit_applied === true).length;
  const kmin = dec(P.kit_applied_min);
  gates.G2 = bcKeys.length > 0 && kitOk * Number(kmin.d) >= Number(kmin.n) * bcKeys.length;
  gates.G3 = ARMS.every((a) => { const x = rows.filter((r) => r.arm === a && !r.infra); const pm = dec(P.parse_ok_min); return x.length > 0 && x.filter((r) => r.parse_ok === true).length * Number(pm.d) >= Number(pm.n) * x.length; });
  const tb = tables(rows, prereg, taskMap);
  const s = Object.fromEntries(roles.map((ro) => [ro, Object.fromEntries(ARMS.map((a) => [a, score(tb[ro], a)]))]));
  const scored = roles.filter((ro) => s[ro].A && s[ro].D);
  gates.G4 = scored.filter((ro) => cmp(s[ro].D, s[ro].A) > 0).length >= P.roles_with_headroom_min
    && scored.filter((ro) => cmp(s[ro].A, fr(1)) < 0).length >= P.roles_below_ceiling_min
    && scored.filter((ro) => cmp(s[ro].D, fr(0)) > 0).length >= P.roles_above_floor_min;
  // G5: every submitted row needs a finite non-negative cost; the total is compared in integer micro-USD
  const badCost = rows.filter((r) => typeof r.cost_usd !== 'number' || !Number.isFinite(r.cost_usd) || r.cost_usd < 0).length;
  const spentMicro = rows.reduce((n, r) => n + (Number.isFinite(r.cost_usd) && r.cost_usd >= 0 ? Math.round(r.cost_usd * 1e6) : 0), 0);
  const limitMicro = mul(dec(P.cost_factor_max), fr(Math.round(prereg.cost.estimate_usd_high * 1e6)));
  gates.G5 = badCost === 0 && rows.length > 0 && fr(spentMicro).n * limitMicro.d <= limitMicro.n * 1n;
  if (badCost) why.G5 = `${badCost} row(s) without a finite non-negative cost_usd`;
  const ev = evidence === undefined ? ['no evidence input (--evidence)'] : evidenceProblems(evidence, prereg);
  gates.G6 = ev.length === 0;
  if (ev.length) why.G6 = ev;
  const failing = Object.entries(gates).filter(([, v]) => v === false).map(([k]) => k);
  const perRoleCost = Object.fromEntries(roles.map((ro) => { const x = rows.filter((r) => r.role === ro && Number.isFinite(r.cost_usd)); return [ro, x.length ? +(x.reduce((n, r) => n + r.cost_usd, 0) / x.length).toFixed(4) : null]; }));
  return { verdict: failing.length ? 'PILOT_FIX' : 'PILOT_OK', failing_gates: failing, why, gates, spent_usd: spentMicro / 1e6, mean_cost_per_cell_by_role: perRoleCost, scores: Object.fromEntries(roles.map((ro) => [ro, Object.fromEntries(ARMS.map((a) => [a, s[ro][a] ? disp(s[ro][a]) : null]))])) };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (!opt('--prereg') || !opt('--results')) { console.error('usage: score-rolekit.js --prereg P --results R.jsonl [--tasks tasks/manifest.json] [--evidence E.json]'); process.exit(2); }
  try {
    const prereg = JSON.parse(fs.readFileSync(opt('--prereg'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(opt('--tasks') || require('path').join(__dirname, 'tasks/manifest.json'), 'utf8'));
    const taskMap = {};
    for (const t of man.tasks) (taskMap[t.role] = taskMap[t.role] || []).push(t.id);
    const rows = fs.readFileSync(opt('--results'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const evidence = opt('--evidence') ? JSON.parse(fs.readFileSync(opt('--evidence'), 'utf8')) : undefined;
    const out = prereg.row.endsWith('pilot') ? scorePilot(rows, prereg, taskMap, evidence) : scoreFormal(rows, prereg, taskMap);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } catch (e) { console.error(`score-rolekit: ${e.message}`); process.exit(2); }
}
if (require.main === module) main();
module.exports = { add, sub, mul, scoreFormal, scorePilot, schedule, validateRows, evidenceProblems, tailAtMost, dec, fr, cmp, REQUIRED_GRADERS };
