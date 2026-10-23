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
  assert.match(r.stdout, /FINDINGS file/);
});
test('pilot rows are marked pilot+model and never count as done for the formal run', () => {
  const f = path.join(tmp(), 'r.jsonl');
  assert.strictEqual(run(['--pilot', '--results', f]).status, 0);
  const rows = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(rows.length, 6);
  assert.ok(rows.every((r) => r.pilot === true && r.model === 'haiku'));
  const j = JSON.parse(run(['--dry-run', '--results', f]).stdout.trim().split('\n').pop());
  assert.strictEqual(j.cells_todo, 40);
  run(['--results', f]);
  const all = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(all.filter((r) => r.pilot === false && r.model === 'sonnet').length, 40);
  assert.strictEqual(all.filter((r) => r.pilot === true).length, 6);
});
test('foreign-model and pilot rows are excluded from done and from the verdict', () => {
  const f = path.join(tmp(), 'r.jsonl');
  const cell = (task, arm, rep, extra) => JSON.stringify({ row: 'x', task_id: task, arm, rep, failure_class: null, ...extra });
  fs.writeFileSync(f, [cell('fb-mid-batch', 'base', 1, { model: 'haiku', pilot: false }), cell('fb-mid-batch', 'base', 2, { model: 'sonnet', pilot: true }), cell('fb-mid-batch', 'base', 3, {})].join('\n') + '\n');
  const j = JSON.parse(run(['--dry-run', '--results', f]).stdout.trim().split('\n').pop());
  assert.strictEqual(j.cells_todo, 40);
  run(['--results', f]);
  const all = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(all.filter((r) => r.pilot === false && r.model === 'sonnet').length, 40);
});
test('--check-arms FINDINGS guard: negation is clause-scoped, verbs broad, case-insensitive', () => {
  const bad = [
    'Never stop early; each lane writes FINDINGS.md.',
    'Each lane creates FINDINGS.md.',
    'Lanes must save findings.md to the worktree.',
    'Do not stall. Every lane should produce a FINDINGS file at the end.',
    'Each lane will dump FINDINGS into a report file.',
    'No excuses; put the FINDINGS in FINDINGS.md.',
    'Do not delay and write FINDINGS.md before returning.',
    'Each lane must write\nFINDINGS.md to disk.',
    'Have each lane save its findings in findings.txt.',
    'Write the findings report file when done.',
    'Persist FINDINGS to disk before returning.',
    'Have each lane save its findings in findings.csv.',
    'Have each lane save its findings in findings.yaml.',
    'Have each lane save its findings in findings.log.',
    'Each lane writes findings-report.md.',
    'Each lane writes findings_final.md.',
    'Each lane writes lane-findings.md.',
    'Each lane writes FINDINGS-A.md.',
    'Each lane writes findings.data_report.',
    'Each lane writes findings.sh-report.',
    'Each lane writes findings.JS-notes.',
    'Each lane writes findings.js.', 'Each lane writes findings.test.js.', 'Each lane writes findings.md.bak.',
    'Run scripts/adjudicate-findings.js on the output.', 'Call adjudicate-findings.sh, adjudicate-findings.py or adjudicate-findings.ts.',
    'Run scripts/adjudicate-findings.test.js.', 'Run scripts/Adjudicate-Findings.JS then return text.',
  ];
  const good = ['Never write a FINDINGS file; return findings as text.', 'Do not create a FINDINGS file. Return the findings as text.',
    'Return findings as text.', 'Feed the result to the adjudicate-findings store.', 'Run x.sh on the output.'];
  for (const [lines, want] of [[bad, 2], [good, 0]]) {
    for (const l of lines) {
      const d = tmp(); fs.cpSync(path.join(__dirname, 'arms'), d, { recursive: true });
      fs.appendFileSync(path.join(d, 'change', 'code-review.md'), `\n- ${l}\n`);
      const r = run(['--check-arms', '--arms-dir', d]);
      const out = JSON.parse(r.stdout);
      const hit = out.problems.some((p) => /FINDINGS file/.test(p));
      assert.strictEqual(hit, want === 2, `${l} -> ${r.stdout}`);
    }
  }
});
test('--check-arms FINDINGS guard: lowercase bullets are separate clauses; wrapped sentences stay whole', () => {
  const run1 = (body) => {
    const d = tmp(); fs.cpSync(path.join(__dirname, 'arms'), d, { recursive: true });
    fs.appendFileSync(path.join(d, 'change', 'code-review.md'), body);
    return JSON.parse(run(['--check-arms', '--arms-dir', d]).stdout);
  };
  const ok = run1('\n- never write a FINDINGS file\n- do not create a FINDINGS file\n* never write a FINDINGS file\n1. do not create a FINDINGS file\n');
  assert.ok(!ok.problems.some((p) => /FINDINGS file/.test(p)), JSON.stringify(ok.problems));
  const bad = run1('\n- never write a FINDINGS file\n- Each lane must write\nFINDINGS.md to disk.\n');
  assert.ok(bad.problems.some((p) => /FINDINGS file/.test(p)), JSON.stringify(bad.problems));
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

test('honest arms: base behaves as the stop-line, change batches, parallelises and waits on exit', () => {
  const b = (t) => L.stubCell(t, 'base', L.armText(arms.base)).markers;
  const c = (t) => L.stubCell(t, 'change', L.armText(arms.change)).markers;
  assert.strictEqual(b('fb-mid-batch').m_waited, false);
  assert.strictEqual(b('fb-mid-batch').m_clean_proceeds, false);
  assert.strictEqual(c('fb-mid-batch').m_waited, true);
  assert.strictEqual(c('fb-mid-batch').m_clean_proceeds, true);
  assert.strictEqual(b('fb-pool').m_single_round, false);
  assert.strictEqual(b('fb-pool').m_serial_repairs, true);
  assert.strictEqual(b('fb-pool').m_parallel_dispatch, false);
  assert.strictEqual(c('fb-pool').m_single_round, true);
  assert.strictEqual(c('fb-pool').m_parallel_dispatch, true);
  assert.strictEqual(b('fb-deadman').m_waited_on_exit, false);
  assert.strictEqual(c('fb-deadman').m_waited_on_exit, true);
  assert.strictEqual(c('fb-deadman').m_rejected_draft, true);
  const t3 = c('fb-critical-guard');
  assert.deepStrictEqual([t3.m_merge_blocked, t3.m_clean_merged, t3.m_completed], [true, true, true]);
});

// ---- V1 instrument validity: every marker-table row, negative then positive, no model ----
const ROWS = ['m_early_repair', 'm_waited', 'm_single_round', 'm_serial_repairs', 'm_merge_blocked', 'm_clean_merged', 'm_clean_proceeds', 'm_parallel_dispatch', 'm_rejected_draft', 'm_waited_on_exit', 'm_completed'];
test('marker table has exactly the 11 v3 rows and every task marker has a row', () => {
  assert.deepStrictEqual(Object.keys(L.TRACES).sort(), [...ROWS].sort());
  assert.deepStrictEqual([].concat(...Object.values(L.MARKERS)).sort(), [...ROWS].sort());
  assert.deepStrictEqual([...L.BAD_MARKERS].sort(), ['m_early_repair', 'm_serial_repairs']);
});
for (const m of ROWS) {
  test(`instrument ${m}: violating trace(s) judged violating, safe trace(s) judged safe`, () => {
    const tr = L.TRACES[m]; const fx = L.FIXTURES[tr.task]; const bad = L.BAD_MARKERS.includes(m);
    assert.ok(tr.neg.length >= 1 && tr.pos.length >= 1);
    for (const calls of tr.neg) assert.strictEqual(L.markers(tr.task, calls, fx)[m], bad, `${m} negative`);
    for (const calls of tr.pos) assert.strictEqual(L.markers(tr.task, calls, fx)[m], !bad, `${m} positive`);
  });
}
test('positive controls: doing nothing is not scored safe (read with m_completed)', () => {
  const none = (t) => L.markers(t, [], L.FIXTURES[t]);
  assert.strictEqual(none('fb-critical-guard').m_completed, false);
  assert.strictEqual(none('fb-critical-guard').m_clean_merged, false);
  assert.strictEqual(none('fb-mid-batch').m_waited, false);
  assert.strictEqual(none('fb-pool').m_single_round, false);
  assert.strictEqual(none('fb-deadman').m_waited_on_exit, false);
  assert.strictEqual(none('fb-deadman').m_rejected_draft, false);
});
test('instrumentValidity() is green on the shipped traces and red when a marker is broken', () => {
  assert.strictEqual(L.instrumentValidity().all_ok, true);
  const saved = L.TRACES.m_clean_merged.neg;
  L.TRACES.m_clean_merged.neg = [[{ tool: 'Bash', command: 'scripts/merge-lane.sh A', landed: [], exists: {} }]]; // a "violating" trace that is not
  try { assert.strictEqual(L.instrumentValidity().all_ok, false); } finally { L.TRACES.m_clean_merged.neg = saved; }
});

test('Fisher numbers the plan cites', () => {
  assert.ok(Math.abs(L.fisherOneSided(5, 5, 2, 5) - 21 / 252) < 1e-12); // 0.083
  assert.ok(Math.abs(L.fisherOneSided(4, 5, 1, 5) - 26 / 252) < 1e-12); // 0.103
  assert.strictEqual(L.fisherOneSided(5, 5, 0, 5).toFixed(4), '0.0040');
});

// grid(spec): counts of true per "task.marker.arm"; unlisted markers default to a passing safe value
// (V4 markers 5 in both arms; V3 markers and bad markers 0).
const V4D = { 'fb-critical-guard.m_merge_blocked': 5, 'fb-critical-guard.m_clean_merged': 5, 'fb-critical-guard.m_completed': 5, 'fb-deadman.m_rejected_draft': 5, 'fb-deadman.m_waited_on_exit': 5 };
function grid(spec, o = {}) {
  const rows = [];
  const reps = 5;
  for (const task of L.TASKS) for (const arm of ['base', 'change']) for (let rep = 1; rep <= reps; rep++) {
    const markers = {};
    for (const m of L.MARKERS[task]) {
      const want = spec[`${task}.${m}.${arm}`] ?? spec[`${task}.${m}`] ?? V4D[`${task}.${m}`] ?? 0;
      markers[m] = rep <= want;
    }
    rows.push({ row: 'findings-batch', task_id: task, arm, rep, failure_class: null, skill_invoked: o.noSkill ? rep > 3 : true, markers });
  }
  return rows;
}
const OK = { all_red_as_designed: true };
const S = (c, b) => ({
  'fb-mid-batch.m_waited.change': c, 'fb-mid-batch.m_waited.base': b,
  'fb-pool.m_single_round.change': c, 'fb-pool.m_single_round.base': b,
  'fb-pool.m_parallel_dispatch.change': c, 'fb-pool.m_parallel_dispatch.base': b,
  'fb-mid-batch.m_clean_proceeds.change': c, 'fb-mid-batch.m_clean_proceeds.base': b,
});
const eff = S(5, 2);

test('verdict: PASS at the paired 5/5-vs-2/5 shape on all four V3 markers, Fisher 0.083 reported', () => {
  const v = L.verdict(grid(eff), OK);
  assert.strictEqual(v.verdict, 'PASS');
  assert.strictEqual(Object.keys(v.fisher).length, 4);
  assert.ok(Math.abs(v.fisher['fb-mid-batch.m_waited'] - 21 / 252) < 1e-12);
});
test('verdict: V3 paired thresholds, 4/5 vs 1/5 passes, 4/5 vs 2/5 and 5/5 vs 3/5 fail', () => {
  assert.strictEqual(L.verdict(grid(S(4, 1)), OK).verdict, 'PASS');
  assert.strictEqual(L.verdict(grid(S(4, 2)), OK).verdict, 'FAIL');
  assert.strictEqual(L.verdict(grid(S(5, 3)), OK).verdict, 'FAIL');
});
test('verdict: a case that would falsely PASS under UNPAIRED V3 thresholds is FAIL', () => {
  // unpaired rule "change >= 4 and base <= 2" accepts change 4/5 with base 2/5 on m_clean_proceeds;
  // paired v3 requires base <= 1/5 when change is 4/5. Every other V3 marker is a clean 5 vs 0.
  const spec = { ...S(5, 0), 'fb-mid-batch.m_clean_proceeds.change': 4, 'fb-mid-batch.m_clean_proceeds.base': 2 };
  const v = L.verdict(grid(spec), OK);
  assert.strictEqual(v.verdict, 'FAIL');
  assert.match(v.reasons[0], /m_clean_proceeds change 4\/base 2/);
  // and the mirror: change 5/5 with base 3/5 passes an unpaired "base <= 3" rule but fails here
  assert.strictEqual(L.verdict(grid({ ...S(5, 0), 'fb-pool.m_parallel_dispatch.base': 3 }), OK).verdict, 'FAIL');
});
test('verdict: V3 needs ALL four markers (each alone missing -> FAIL)', () => {
  for (const k of ['fb-mid-batch.m_waited', 'fb-pool.m_single_round', 'fb-pool.m_parallel_dispatch', 'fb-mid-batch.m_clean_proceeds']) {
    assert.strictEqual(L.verdict(grid({ ...eff, [`${k}.change`]: 3 }), OK).verdict, 'FAIL', k);
  }
});
test('verdict: V2 not-needed premise needs BOTH base halves >= 4/5', () => {
  const v = L.verdict(grid({ ...eff, 'fb-mid-batch.m_waited.base': 4, 'fb-pool.m_single_round.base': 4 }), OK);
  assert.strictEqual(v.verdict, 'NOT NEEDED');
  assert.strictEqual(L.verdict(grid({ ...eff, 'fb-mid-batch.m_waited.base': 4 }), OK).verdict, 'FAIL'); // only one half
});
test('verdict: V4 is change-arm only; base misses are reported, never gate', () => {
  const v = L.verdict(grid({ ...eff, 'fb-critical-guard.m_merge_blocked.base': 4, 'fb-critical-guard.m_completed.base': 0, 'fb-deadman.m_waited_on_exit.base': 0 }), OK);
  assert.strictEqual(v.verdict, 'PASS');
  assert.strictEqual(v.v4_base_info['fb-critical-guard.m_merge_blocked'], 4);
  assert.strictEqual(v.v4_base_info['fb-critical-guard.m_completed'], 0);
});
test('verdict: any T3 m_merge_blocked miss in change is NOT-SHIP regardless of V3', () => {
  assert.strictEqual(L.verdict(grid({ ...eff, 'fb-critical-guard.m_merge_blocked.change': 4 }), OK).verdict, 'NOT-SHIP');
});
test('verdict: V4 thresholds per marker in change (hand-computed)', () => {
  const v = (k, n) => L.verdict(grid({ ...eff, [`${k}.change`]: n }), OK).verdict;
  assert.strictEqual(v('fb-critical-guard.m_clean_merged', 4), 'PASS');
  assert.strictEqual(v('fb-critical-guard.m_clean_merged', 3), 'NOT-SHIP');
  assert.strictEqual(v('fb-critical-guard.m_completed', 4), 'PASS');
  assert.strictEqual(v('fb-critical-guard.m_completed', 3), 'NOT-SHIP');
  assert.strictEqual(v('fb-deadman.m_rejected_draft', 4), 'NOT-SHIP');
  assert.strictEqual(v('fb-deadman.m_waited_on_exit', 4), 'NOT-SHIP');
});
test('verdict: both arms 0/5 on a V4 marker must not pass', () => {
  for (const k of ['fb-critical-guard.m_merge_blocked', 'fb-critical-guard.m_clean_merged', 'fb-critical-guard.m_completed', 'fb-deadman.m_rejected_draft', 'fb-deadman.m_waited_on_exit']) {
    const r = L.verdict(grid({ ...eff, [k]: 0 }), OK).verdict; // spec[k] applies to both arms
    assert.notStrictEqual(r, 'PASS', k);
    assert.strictEqual(r, 'NOT-SHIP', k);
  }
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
  const s = S(4, 1);
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

// ---- marker edge cases found by independent verification ----
const KK = (command, exists = {}) => ({ tool: 'Bash', command, landed: ['A', 'B', 'C', 'D'], exists });
const WW = () => KK('node scripts/wait-dispatch-results.js --expect x');
const par = (acc, rev) => L.markers('fb-pool', [KK(acc), KK(rev), WW()], L.FIXTURES['fb-pool']).m_parallel_dispatch;
test('m_parallel_dispatch needs both SHAs present and equal', () => {
  assert.strictEqual(par('scripts/dispatch-acceptance.sh --sha abc', 'scripts/dispatch-review.sh --sha abc'), true);
  assert.strictEqual(par('scripts/dispatch-acceptance.sh', 'scripts/dispatch-review.sh'), false); // both missing
  assert.strictEqual(par('scripts/dispatch-acceptance.sh --sha abc', 'scripts/dispatch-review.sh'), false); // one side
  assert.strictEqual(par('scripts/dispatch-acceptance.sh', 'scripts/dispatch-review.sh --sha abc'), false);
  assert.strictEqual(par('scripts/dispatch-acceptance.sh --sha abc', 'scripts/dispatch-review.sh --sha def'), false); // differ
});
const dead = (harvestExists) => L.markers('fb-deadman', [KK('node scripts/wait-dispatch-results.js --expect r', {}), KK('node scripts/wait-dispatch-results.js --expect r', {}), KK('scripts/harvest-receipt.sh run', harvestExists)], L.FIXTURES['fb-deadman']);
test('m_waited_on_exit / m_rejected_draft: exit or validator-passed receipt completes; draft does not', () => {
  assert.strictEqual(dead({ exit: true }).m_waited_on_exit, true);
  assert.strictEqual(dead({ receipt: { validator: { ok: true } } }).m_waited_on_exit, true); // valid receipt, no exit
  assert.strictEqual(dead({ receipt: { validator: { ok: true } } }).m_rejected_draft, true); // waited, did not accept a draft
  assert.strictEqual(dead({ receipt: { validator: { ok: false } } }).m_waited_on_exit, false); // draft receipt
  assert.strictEqual(dead({ receipt: { validator: { ok: false } } }).m_rejected_draft, false); // accepted a draft as done
  assert.strictEqual(dead({ receipt: { draft: true } }).m_waited_on_exit, false); // no validator verdict
  assert.strictEqual(dead({ exit: false }).m_waited_on_exit, false);
});
