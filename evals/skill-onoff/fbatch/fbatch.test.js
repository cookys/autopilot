'use strict';
// Stub-model test suite for the findings-batch row. No spend, no model call.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const L = require('./lib');

const RUN = path.join(__dirname, '..', 'run-fbatch-campaign.js');
const run = (args) => cp.spawnSync('node', [RUN, ...args], { encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fbatch-'));
const arms = L.loadArms();

test('--dry-run needs --results, then lists 40 cells without spend', () => {
  assert.strictEqual(run(['--dry-run']).status, 2);
  const r = run(['--dry-run', '--results', path.join(tmp(), 'r.jsonl')]);
  assert.strictEqual(r.status, 0);
  const j = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(j.cells_total, 40);
  assert.strictEqual(j.cost_estimate_usd, 9.8);
});
test('--dry-run exits 1 when the estimate exceeds ONOFF_MAX_USD', () => {
  const r = cp.spawnSync('node', [RUN, '--dry-run', '--results', path.join(tmp(), 'r.jsonl')], { encoding: 'utf8', env: { ...process.env, ONOFF_MAX_USD: '5' } });
  assert.strictEqual(r.status, 1);
});
test('--pilot is 6 cells; --pilot rejects --reps', () => {
  const j = JSON.parse(run(['--dry-run', '--pilot', '--results', path.join(tmp(), 'r.jsonl')]).stdout.trim().split('\n').pop());
  assert.strictEqual(j.cells_total, 6);
  assert.strictEqual(run(['--dry-run', '--pilot', '--reps', '2', '--results', 'x']).status, 2);
});
test('--check-arms passes on the shipped arms and fails on a mutated copy', () => {
  assert.strictEqual(run(['--check-arms']).status, 0);
  const d = tmp(); fs.cpSync(path.join(__dirname, 'arms'), d, { recursive: true });
  fs.appendFileSync(path.join(d, 'base', 'finish-flow-row.md'), '\nextra\n');
  fs.appendFileSync(path.join(d, 'base', 'code-review.md'), '\n');
  fs.appendFileSync(path.join(d, 'change', 'hetero-impl-loop.md'), '\n');
  fs.writeFileSync(path.join(d, 'change', 'stray.md'), 'x');
  assert.strictEqual(run(['--check-arms', '--arms-dir', d]).status, 2);
});
test('--check-arms rejects a change arm that asks a subagent to write a FINDINGS file', () => {
  const d = tmp(); fs.cpSync(path.join(__dirname, 'arms'), d, { recursive: true });
  fs.appendFileSync(path.join(d, 'change', 'code-review.md'), '\n- Each lane writes FINDINGS.md.\n');
  const r = run(['--check-arms', '--arms-dir', d]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stdout, /instructs a FINDINGS file/);
});
test('change arm says findings return as text and never asks for a FINDINGS write', () => {
  assert.match(arms.change['code-review.md'], /as text/);
  assert.match(arms.change['code-review.md'], /Never ask a Claude subagent to write a FINDINGS file/);
});

test('negative control 1: the planted stoplane arm scores m_early_repair true in T1', () => {
  const m = L.stubCell('fb-mid-batch', 'stoplane', L.armText(L.stoplaneArm(arms.base))).markers;
  assert.strictEqual(m.m_early_repair, true);
  assert.strictEqual(m.m_waited, false);
});
test('negative control 2: already-landed fixture scores m_waited true under base', () => {
  const m = L.stubCell('fb-mid-batch', 'base', L.armText(arms.base), L.FIXTURES['fb-mid-batch-already-landed']).markers;
  assert.strictEqual(m.m_waited, true);
});
test('negative control 3: guard text removed -> m_merge_blocked false; with it, true in both arms', () => {
  const fx = L.FIXTURES['fb-critical-guard'];
  for (const a of ['base', 'change']) assert.strictEqual(L.stubCell('fb-critical-guard', a, L.armText(arms[a]), fx).markers.m_merge_blocked, true);
  assert.strictEqual(L.stubCell('fb-critical-guard', 'change', L.armText(arms.change), L.guardRemoved(fx)).markers.m_merge_blocked, false);
  assert.strictEqual(L.negativeControls(arms).all_red_as_designed, true);
});
test('a dead marker (always-true detector) is caught: controls fail when the arms never stop the lane', () => {
  // swap base for change: neither arm stops the lane, so control 2 still holds but a stoplane arm built on
  // change text keeps the explicit "does not stop" override and scores no early repair -> control 1 red.
  const nc = L.negativeControls({ base: arms.change, change: arms.change });
  assert.strictEqual(nc.stoplane_scores_early_repair, false);
  assert.strictEqual(nc.all_red_as_designed, false);
});

test('honest arms: base behaves as the stop-line, change batches and waits on exit', () => {
  const b = (t) => L.stubCell(t, 'base', L.armText(arms.base)).markers;
  const c = (t) => L.stubCell(t, 'change', L.armText(arms.change)).markers;
  assert.strictEqual(b('fb-mid-batch').m_waited, false);
  assert.strictEqual(c('fb-mid-batch').m_waited, true);
  assert.strictEqual(b('fb-pool').m_single_round, false);
  assert.strictEqual(b('fb-pool').m_serial_repairs, true);
  assert.strictEqual(c('fb-pool').m_single_round, true);
  assert.strictEqual(b('fb-deadman').m_waited_on_exit, false);
  assert.strictEqual(c('fb-deadman').m_waited_on_exit, true);
  assert.strictEqual(c('fb-critical-guard').m_merge_blocked, true);
});

test('Fisher numbers the plan cites', () => {
  assert.ok(Math.abs(L.fisherOneSided(5, 5, 2, 5) - 21 / 252) < 1e-12); // 0.083
  assert.ok(Math.abs(L.fisherOneSided(4, 5, 1, 5) - 26 / 252) < 1e-12); // 0.103
  assert.strictEqual(L.fisherOneSided(5, 5, 0, 5).toFixed(4), '0.0040');
});

// hand-built grids: counts of true per (task.marker.arm); everything else minimal-valid
function grid(spec, o = {}) {
  const rows = [];
  const reps = 5;
  for (const task of L.TASKS) for (const arm of ['base', 'change']) for (let rep = 1; rep <= reps; rep++) {
    const markers = {};
    for (const m of L.MARKERS[task]) {
      const k = `${task}.${m}.${arm}`;
      const want = spec[k] === undefined ? (m === 'm_merge_blocked' || m === 'm_waited_on_exit' ? 5 : 0) : spec[k];
      markers[m] = rep <= want;
    }
    rows.push({ row: 'findings-batch', task_id: task, arm, rep, failure_class: null, skill_invoked: o.noSkill ? rep > 3 : true, markers });
  }
  return rows;
}
const OK = { all_red_as_designed: true };
const eff = { 'fb-mid-batch.m_waited.change': 5, 'fb-mid-batch.m_waited.base': 2, 'fb-pool.m_single_round.change': 5, 'fb-pool.m_single_round.base': 2 };

test('verdict: PASS at the 5/5-vs-2/5 shape, Fisher 0.083 reported', () => {
  const v = L.verdict(grid(eff), OK);
  assert.strictEqual(v.verdict, 'PASS');
  assert.ok(Math.abs(v.fisher.t1_m_waited - 21 / 252) < 1e-12);
});
test('verdict: 4/5 vs 1/5 passes, 4/5 vs 2/5 fails (V3 shape)', () => {
  const s = (c, b) => ({ ...eff, 'fb-mid-batch.m_waited.change': c, 'fb-mid-batch.m_waited.base': b, 'fb-pool.m_single_round.change': c, 'fb-pool.m_single_round.base': b });
  assert.strictEqual(L.verdict(grid(s(4, 1)), OK).verdict, 'PASS');
  assert.strictEqual(L.verdict(grid(s(4, 2)), OK).verdict, 'FAIL');
  assert.strictEqual(L.verdict(grid(s(5, 3)), OK).verdict, 'FAIL');
});
test('verdict: V3 needs BOTH T1 and T2', () => {
  assert.strictEqual(L.verdict(grid({ ...eff, 'fb-pool.m_single_round.change': 3 }), OK).verdict, 'FAIL');
});
test('verdict: V2 pre-condition met -> NOT NEEDED', () => {
  const v = L.verdict(grid({ ...eff, 'fb-mid-batch.m_waited.base': 4, 'fb-pool.m_single_round.base': 4 }), OK);
  assert.strictEqual(v.verdict, 'NOT NEEDED');
  assert.strictEqual(L.verdict(grid({ ...eff, 'fb-mid-batch.m_waited.base': 4 }), OK).verdict, 'FAIL'); // only one half
});
test('verdict: any T3 miss in change is NOT-SHIP regardless of V3', () => {
  const v = L.verdict(grid({ ...eff, 'fb-critical-guard.m_merge_blocked.change': 4 }), OK);
  assert.strictEqual(v.verdict, 'NOT-SHIP');
  assert.strictEqual(L.verdict(grid({ ...eff, 'fb-critical-guard.m_merge_blocked.base': 4 }), OK).verdict, 'NOT-SHIP');
});
test('verdict: T4 change may be at most one below base', () => {
  assert.strictEqual(L.verdict(grid({ ...eff, 'fb-deadman.m_waited_on_exit.base': 5, 'fb-deadman.m_waited_on_exit.change': 4 }), OK).verdict, 'PASS');
  assert.strictEqual(L.verdict(grid({ ...eff, 'fb-deadman.m_waited_on_exit.base': 5, 'fb-deadman.m_waited_on_exit.change': 3 }), OK).verdict, 'NOT-SHIP');
});
test('verdict: V1 skill_invoked < 0.9, a red control, an infra row, or a partial grid never score content', () => {
  assert.strictEqual(L.verdict(grid(eff, { noSkill: true }), OK).verdict, 'INVALID');
  assert.strictEqual(L.verdict(grid(eff), { all_red_as_designed: false }).verdict, 'INVALID');
  const rows = grid(eff); rows[0].failure_class = 'infra';
  assert.strictEqual(L.verdict(rows, OK).verdict, 'INCOMPLETE'); // the infra row also leaves its cell short
  rows.push({ ...rows[0], failure_class: null }); // refilled cell + the infra row still present
  assert.strictEqual(L.verdict(rows, OK).verdict, 'INVALID');
  assert.strictEqual(L.verdict(grid(eff).slice(0, 20), OK).verdict, 'INCOMPLETE');
});

test('verdict: missing scored marker m_waited in some T1 cells is INCOMPLETE, never PASS', () => {
  const s = { ...eff, 'fb-mid-batch.m_waited.change': 4, 'fb-mid-batch.m_waited.base': 1, 'fb-pool.m_single_round.change': 4, 'fb-pool.m_single_round.base': 1 };
  const rows = grid(s);
  assert.strictEqual(L.verdict(rows, OK).verdict, 'PASS'); // control: full grid
  const holed = rows.map((r) => {
    if (r.task_id !== 'fb-mid-batch' || r.rep !== 5) return r;
    const markers = { ...r.markers }; delete markers.m_waited; // m_early_repair still reaches reps
    return { ...r, markers };
  });
  assert.strictEqual(L.verdict(holed, OK).verdict, 'INCOMPLETE');
});

test('end to end stub run: PASS with honest arms; pilot is not scored', () => {
  const d = tmp(); const res = path.join(d, 'r.jsonl');
  const r = run(['--results', res, '--runner', 'stub']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout.trim().split('\n').pop()).verdict, 'PASS');
  assert.strictEqual(fs.readFileSync(res, 'utf8').trim().split('\n').length, 40);
  const p = run(['--results', path.join(d, 'p.jsonl'), '--pilot', '--runner', 'stub']);
  assert.strictEqual(p.status, 0);
  assert.match(p.stdout, /not scored/);
});
test('--runner cc refuses in P0 (no spend path exists)', () => {
  assert.strictEqual(run(['--results', path.join(tmp(), 'r.jsonl'), '--runner', 'cc']).status, 2);
});
