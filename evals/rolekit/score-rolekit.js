#!/usr/bin/env node
'use strict';
// score-rolekit.js -- the single mechanical verdict of a rolekit prereg row. No model call. Node built-ins only.
//   score-rolekit.js --prereg prereg/<row>.json --results <results.jsonl> [--json]
// results.jsonl: one row per cell {role, task, rep, arm: A|B|C|D, seat: weak1|weak2|strong, pass: 0|1,
//   infra: bool, parse_ok: bool, kit_applied: bool, cost_usd: number}. Thresholds come from the prereg (verdict.params);
// the rule text is prereg.verdict.rule. Pilot rows give PILOT_OK / PILOT_FIX, formal rows SHIP_CANDIDATE / NOT_SHIP /
// INCONCLUSIVE_INFRA. Exit 0 always when it could score; 2 on usage or a malformed row.
const fs = require('fs');

const ARMS = ['A', 'B', 'C', 'D'];
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function binomTail(b, n) { // P(X >= b), X ~ Bin(n, 0.5)
  let p = 0;
  let c = 1; // C(n,0)
  const choose = [];
  for (let k = 0; k <= n; k += 1) { choose.push(c); c = (c * (n - k)) / (k + 1); }
  for (let k = b; k <= n; k += 1) p += choose[k];
  return p / 2 ** n;
}

function validateRows(rows) {
  rows.forEach((r, i) => {
    const ok = r && ARMS.includes(r.arm) && typeof r.role === 'string' && typeof r.task === 'string' && Number.isInteger(r.rep)
      && typeof r.seat === 'string' && typeof r.infra === 'boolean' && (r.infra || r.pass === 0 || r.pass === 1);
    if (!ok) throw new Error(`malformed row ${i}: ${JSON.stringify(r)}`);
  });
}

// per role: arm -> task -> [pass...] using primary seats (weak1 for A/B/C, strong for D)
function tables(rows, roles) {
  const prim = (r) => (r.arm === 'D' ? r.seat === 'strong' : r.seat === 'weak1');
  const out = {};
  for (const role of roles) {
    const t = {};
    for (const a of ARMS) t[a] = {};
    for (const r of rows.filter((x) => x.role === role && prim(x) && !x.infra)) (t[r.arm][r.task] = t[r.arm][r.task] || []).push(r.pass);
    const tasks = new Set(rows.filter((x) => x.role === role && prim(x)).map((x) => x.task));
    const keep = [...tasks].filter((k) => ARMS.every((a) => (t[a][k] || []).length > 0));
    out[role] = { t, keep };
  }
  return out;
}
const score = (T, a) => mean(T.keep.map((k) => mean(T.t[a][k])));

function pairs(rows, role, tasks) { // B vs C discordant counts over (task, rep) present in both, primary seat
  const get = (arm) => new Map(rows.filter((x) => x.role === role && x.arm === arm && x.seat === 'weak1' && !x.infra && tasks.includes(x.task)).map((x) => [`${x.task}#${x.rep}`, x.pass]));
  const B = get('B'); const C = get('C');
  let b = 0; let c = 0;
  for (const [k, v] of B) if (C.has(k)) { if (v === 1 && C.get(k) === 0) b += 1; if (v === 0 && C.get(k) === 1) c += 1; }
  return { b, c };
}

function scoreFormal(rows, prereg) {
  const P = prereg.verdict.params; const roles = prereg.design.roles;
  const sched = {};
  for (const r of rows) { const k = `${r.arm}/${r.seat}`; sched[k] = sched[k] || { n: 0, infra: 0 }; sched[k].n += 1; if (r.infra) sched[k].infra += 1; }
  const infraBad = Object.entries(sched).filter(([, v]) => v.infra / v.n > P.infra_arm_seat_max).map(([k, v]) => ({ arm_seat: k, infra_rate: +(v.infra / v.n).toFixed(3) }));
  if (infraBad.length) return { verdict: 'INCONCLUSIVE_INFRA', infra_over: infraBad, roles: {} };
  const tb = tables(rows, roles); const per = {};
  let nPass = 0; let nHarm = 0;
  for (const role of roles) {
    const T = tb[role]; const s = Object.fromEntries(ARMS.map((a) => [a, score(T, a)]));
    const headroom = s.D - s.A;
    const e = { n_tasks: T.keep.length, s, headroom: +headroom.toFixed(4) };
    if (!(headroom >= P.headroom_min)) { e.status = 'no_headroom'; per[role] = e; continue; }
    e.gap_closed = +((s.B - s.A) / headroom).toFixed(4);
    const { b, c } = pairs(rows, role, T.keep);
    e.discordant = { b, c, p: b > c ? +binomTail(b, b + c).toFixed(5) : 1 };
    e.B_beats_C = b > c && e.discordant.p <= P.discordant_alpha;
    e.harm = s.B - s.A <= P.harm_delta;
    e.role_pass = e.gap_closed >= P.gap_closed_min && e.B_beats_C;
    e.status = e.role_pass ? 'pass' : 'fail';
    if (e.role_pass) nPass += 1;
    per[role] = e;
  }
  for (const role of roles) { const T = tb[role]; if (T.keep.length && score(T, 'B') - score(T, 'A') <= P.harm_delta) { per[role].harm = true; nHarm += 1; } }
  return { verdict: nPass >= P.roles_pass_min && nHarm === 0 ? 'SHIP_CANDIDATE' : 'NOT_SHIP', roles_pass: nPass, roles_harm: nHarm, roles: per };
}

function scorePilot(rows, prereg) {
  const P = prereg.verdict.params; const roles = prereg.design.roles; const gates = {};
  const infra = rows.filter((r) => r.infra).length / Math.max(rows.length, 1);
  const worst = Math.max(0, ...ARMS.flatMap((a) => roles.map((ro) => { const x = rows.filter((r) => r.arm === a && r.role === ro); return x.length ? x.filter((r) => r.infra).length / x.length : 0; })));
  gates.G1 = infra <= P.infra_total_max && worst <= P.infra_arm_role_max;
  const bc = rows.filter((r) => r.arm === 'B' || r.arm === 'C');
  gates.G2 = bc.length > 0 && bc.filter((r) => r.kit_applied === true).length / bc.length >= P.kit_applied_min;
  gates.G3 = ARMS.every((a) => { const x = rows.filter((r) => r.arm === a && !r.infra); return x.length > 0 && x.filter((r) => r.parse_ok).length / x.length >= P.parse_ok_min; });
  const tb = tables(rows, roles);
  const s = Object.fromEntries(roles.map((ro) => [ro, Object.fromEntries(ARMS.map((a) => [a, score(tb[ro], a)]))]));
  const cnt = (f) => roles.filter((ro) => f(s[ro])).length;
  gates.G4 = cnt((x) => x.D - x.A > 0) >= P.roles_with_headroom_min && cnt((x) => x.A < 1) >= P.roles_below_ceiling_min && cnt((x) => x.D > 0) >= P.roles_above_floor_min;
  const spent = rows.reduce((n, r) => n + (r.cost_usd || 0), 0);
  gates.G5 = spent <= P.cost_factor_max * prereg.cost.estimate_usd_high;
  gates.G6 = 'checked outside the results file (unit tests + sentinel-calls recorded before the pilot)';
  const failing = Object.entries(gates).filter(([k, v]) => v === false).map(([k]) => k);
  const perRoleCost = Object.fromEntries(roles.map((ro) => { const x = rows.filter((r) => r.role === ro && typeof r.cost_usd === 'number'); return [ro, +(x.reduce((n, r) => n + r.cost_usd, 0) / Math.max(x.length, 1)).toFixed(4)]; }));
  return { verdict: failing.length ? 'PILOT_FIX' : 'PILOT_OK', failing_gates: failing, gates, spent_usd: +spent.toFixed(4), mean_cost_per_cell_by_role: perRoleCost, scores: s };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (!opt('--prereg') || !opt('--results')) { console.error('usage: score-rolekit.js --prereg P --results R.jsonl [--json]'); process.exit(2); }
  const prereg = JSON.parse(fs.readFileSync(opt('--prereg'), 'utf8'));
  const rows = fs.readFileSync(opt('--results'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  try { validateRows(rows); } catch (e) { console.error(`score-rolekit: ${e.message}`); process.exit(2); }
  const out = prereg.row.endsWith('pilot') ? scorePilot(rows, prereg) : scoreFormal(rows, prereg);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
if (require.main === module) main();
module.exports = { scoreFormal, scorePilot, binomTail, validateRows };
