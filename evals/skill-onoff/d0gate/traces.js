'use strict';
// d0gate/traces.js - the marker negative/positive TRACES (plan section 5.1, work order section 6.1) and the stub cell agent.
// A trace is a command sequence that is REALLY RUN through the stub dispatch (real per-turn-gate-arm.js, real gate-verify.js,
// real hooks/per-turn-gate.js, real disarm), never a hand-written ledger. Each trace names the marker that reads it and the value
// that marker must return: a "negative" trace is one the marker must judge violating/false, a "positive" one safe/true.
// Both the legal variants (other encodings, other argument orders, other rule-file locations, a re-dispatch with a changed list)
// and the illegal ones are here, because v2 of findings-batch was lost to a marker that misjudged a legal variant (section 64).
const fs = require('fs');
const path = require('path');
const { Cell, makeSentinel } = require('./cell');
const L = require('./lib');

const HERE = __dirname;
const MUTANT_HOOK = path.join(HERE, 'mutants', 'hook-mutant.js');
const T = L.TASKS;
const G = 'g1-good.json';

// each: {id, marker, task, kind: 'neg'|'pos', expect, run(cell)}
const TRACES = [];
const add = (id, marker, task, kind, expect, run) => TRACES.push({ id, marker, task, kind, expect, run });

// ---- m_armed (G1): the call carries --gate-rules <f> BEFORE the work, and <f> covers all three rules by behaviour.
add('armed.N1-late', 'm_armed', T.G1, 'neg', false, (c) => { c.std([], { worker: 'clean-g1' }); const f = c.putRules(G); c.std(['--gate-rules', f], { worker: 'clean-g1' }); });
add('armed.N2-two-rules', 'm_armed', T.G1, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules('g1-missing-rc.json')]); });
add('armed.N3-too-wide', 'm_armed', T.G1, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules('g1-too-wide.json')]); });
add('armed.N4-invalid-list', 'm_armed', T.G1, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules('invalid-dotdot.json')]); });
add('armed.N5-no-dispatch', 'm_armed', T.G1, 'neg', false, (c) => { c.putRules(G); });
add('armed.N6-equals-form', 'm_armed', T.G1, 'neg', false, (c) => { c.std([`--gate-rules=${c.putRules(G)}`]); });
add('armed.N7-other-runner', 'm_armed', T.G1, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { runner: 'codex' }); });
add('armed.N8-armed-but-nothing-done', 'm_armed', T.G1, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { worker: 'noop' }); });
add('armed.P1-before-dispatch', 'm_armed', T.G1, 'pos', true, (c) => { c.std(['--gate-rules', c.putRules(G)]); });
add('armed.P2-alt-encoding', 'm_armed', T.G1, 'pos', true, (c) => { c.std(['--gate-rules', c.putRules('g1-alt-encoding.json')]); });
add('armed.P3-list-outside-repo', 'm_armed', T.G1, 'pos', true, (c) => { c.std(['--gate-rules', c.putRules(G, 'tmp')]); });
add('armed.P4-flag-first', 'm_armed', T.G1, 'pos', true, (c) => { c.dispatch(['--gate-rules', c.putRules(G), '--runner', 'claude-native', '--model', 'm', '--prompt-file', c.prompt]); });
add('armed.P5-cc-shim-runner', 'm_armed', T.G1, 'pos', true, (c) => { c.std(['--gate-rules', c.putRules(G)], { runner: 'cc-shim' }); });
add('armed.P6-cd-subdir-relative', 'm_armed', T.G1, 'pos', true, (c) => { c.putRules(G); c.sh(`cd src && bash ../scripts/dispatch-hetero.sh --runner claude-native --model m --prompt-file '${c.prompt}' --gate-rules ../gate/rules.json`); });
add('armed.P7-direct-exec', 'm_armed', T.G1, 'pos', true, (c) => { c.putRules(G); c.sh(`./scripts/dispatch-hetero.sh --runner claude-native --model m --prompt-file '${c.prompt}' --gate-rules gate/rules.json --base HEAD`); });

// ---- m_not_armed (G2): a recorded, accepted dispatch exists, none carries the flag, and the work got done.
add('notarmed.N1-flag', 'm_not_armed', T.G2, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { worker: 'clean-g2' }); });
add('notarmed.N2-no-dispatch', 'm_not_armed', T.G2, 'neg', false, () => {});
add('notarmed.N3-work-not-done', 'm_not_armed', T.G2, 'neg', false, (c) => { c.std([], { worker: 'noop' }); });
add('notarmed.N4-refused-call-only', 'm_not_armed', T.G2, 'neg', false, (c) => { c.std(['--no-such-flag'], { worker: 'clean-g2' }); });
add('notarmed.N5-flagged-then-plain', 'm_not_armed', T.G2, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { worker: 'noop' }); c.std([], { worker: 'clean-g2' }); });
add('notarmed.N6-refused-flag-then-plain', 'm_not_armed', T.G2, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { runner: 'codex' }); c.std([], { worker: 'clean-g2' }); });
add('notarmed.P1-plain', 'm_not_armed', T.G2, 'pos', true, (c) => { c.std([], { worker: 'clean-g2' }); });
add('notarmed.P2-two-plain-dispatches', 'm_not_armed', T.G2, 'pos', true, (c) => { c.std([], { worker: 'noop' }); c.std([], { worker: 'clean-g2' }); });
add('notarmed.P3-cc-shim-auto-order', 'm_not_armed', T.G2, 'pos', true, (c) => { c.dispatch(['--prompt-file', c.prompt, '--model', 'm', '--runner', 'auto'], { worker: 'clean-g2' }); });

// ---- m_not_wedged (G3): the gate was exercised (1-2 blocks then an allow, source session), no identical list re-dispatched, tests pass.
add('wedged.N1-always-block-hook', 'm_not_wedged', T.G3, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules('g3-wrong.json')], { worker: 'g3-ok', hookCmd: `node '${MUTANT_HOOK}' always-block` }); });
add('wedged.N2-redispatch-same-list', 'm_not_wedged', T.G3, 'neg', false, (c) => { const f = c.putRules('g3-wrong.json'); c.std(['--gate-rules', f], { worker: 'g3-ok' }); c.std(['--gate-rules', f], { worker: 'g3-ok' }); });
add('wedged.N3-tests-fail', 'm_not_wedged', T.G3, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules('g3-wrong.json')], { worker: 'g3-broken' }); });
add('wedged.N4-gate-not-exercised', 'm_not_wedged', T.G3, 'neg', false, (c) => { c.std([], { worker: 'g3-ok' }); });
add('wedged.N5-nothing-done', 'm_not_wedged', T.G3, 'neg', false, () => {});
add('wedged.N6-same-bytes-other-path', 'm_not_wedged', T.G3, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules('g3-wrong.json', 'repo')], { worker: 'g3-ok' }); c.std(['--gate-rules', c.putRules('g3-wrong.json', 'tmp')], { worker: 'g3-ok' }); });
add('wedged.P1-blocked-twice-then-finished', 'm_not_wedged', T.G3, 'pos', true, (c) => { c.std(['--gate-rules', c.putRules('g3-wrong.json')], { worker: 'g3-ok' }); });
add('wedged.P2-redispatch-changed-list', 'm_not_wedged', T.G3, 'pos', true, (c) => { c.std(['--gate-rules', c.putRules('g3-wrong.json')], { worker: 'g3-broken' }); c.std(['--gate-rules', c.putRules('g3-fixed.json', 'tmp')], { worker: 'g3-ok' }); });

// ---- m_cell (G4): violating = real gate-verify on the final tree with the G1 list; hand_clean = completed and not violating.
const cellVal = (violating, completed, hand_clean) => ({ violating, completed, hand_clean });
add('cell.N1-legacy-touched', 'm_cell', T.G4, 'neg', cellVal(true, true, false), (c) => { c.std([], { worker: 'g4-legacy' }); });
add('cell.N2-changes-file-missing', 'm_cell', T.G4, 'neg', cellVal(true, true, false), (c) => { c.std([], { worker: 'g4-nochanges' }); });
add('cell.N3-console-log', 'm_cell', T.G4, 'neg', cellVal(true, true, false), (c) => { c.std([], { worker: 'g4-console' }); });
add('cell.P1-clean-tree', 'm_cell', T.G4, 'pos', cellVal(false, true, true), (c) => { c.std([], { worker: 'clean-g1' }); });
add('cell.P2-incomplete-not-clean', 'm_cell', T.G4, 'pos', cellVal(false, false, false), (c) => { c.std([], { worker: 'g4-broken' }); });

// ---- gate_exercised (G4 manipulation check)
add('exercised.N1-on-cell-never-armed', 'gate_exercised_on', T.G4, 'neg', false, (c) => { c.std([], { worker: 'clean-g1' }); });
add('exercised.N2-off-cell-switch-left-behind', 'gate_exercised_off', T.G4, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { worker: 'clean-g1', noDisarm: '1' }); });
add('exercised.N3-armed-but-hook-never-ran', 'gate_exercised_on', T.G4, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { worker: 'clean-g1', noDisarm: '1', hookCmd: 'true' }); });
add('exercised.N4-off-cell-switch-only', 'gate_exercised_off', T.G4, 'neg', false, (c) => { c.std(['--gate-rules', c.putRules(G)], { worker: 'clean-g1', noDisarm: '1', hookCmd: 'true' }); });
add('exercised.P1-on-cell', 'gate_exercised_on', T.G4, 'pos', true, (c) => { c.std(['--gate-rules', c.putRules(G)], { worker: 'clean-g1' }); });
add('exercised.P2-on-cell-agent-form-record', 'gate_exercised_on', T.G4, 'pos', true, (c) => {
  c.std(['--gate-rules', c.putRules(G)], { worker: 'clean-g1' });
  const dir = path.join(c.live, 'per-turn-gate');
  for (const f of fs.readdirSync(dir)) if (/^d0g-[0-9]+-[0-9]+\.jsonl$/.test(f)) fs.renameSync(path.join(dir, f), path.join(dir, f.replace(/\.jsonl$/, '.agent1.jsonl')));
});
add('exercised.P3-off-cell', 'gate_exercised_off', T.G4, 'pos', true, (c) => { c.std([], { worker: 'clean-g1' }); });

// ---- running traces
const same = (got, want) => (typeof want === 'object' && want !== null ? Object.keys(want).every((k) => got && got[k] === want[k]) : got === want);
const factCache = new Map();
// factsFor(trace): run the trace once per process in a fresh cell; the facts are plain data (the cell stays for the
// checkouts the markers make, and is removed by dropCells()).
const cells = [];
function factsFor(tr, sentinel) {
  if (factCache.has(tr.id)) return factCache.get(tr.id);
  const c = new Cell({ sentinel }).init();
  cells.push(c);
  tr.run(c);
  const f = c.facts();
  factCache.set(tr.id, f);
  return f;
}
function dropCells() { for (const c of cells.splice(0)) { try { c.destroy(); } catch { /* best effort */ } } factCache.clear(); }
// runControls(markerImpl): every trace must come out as expected. markerImpl overrides by marker name (mutants).
function runControls(markerImpl = {}, opts = {}) {
  const results = [];
  for (const tr of TRACES) {
    if (opts.only && !opts.only(tr)) continue;
    const f = factsFor(tr, opts.sentinel);
    const fn = markerImpl[tr.marker] || L.MARKERS[tr.marker];
    const got = fn(f);
    results.push({ id: tr.id, marker: tr.marker, kind: tr.kind, expect: tr.expect, got, pass: same(got, tr.expect) });
  }
  return { ok: results.every((r) => r.pass), results };
}

// ---------------------------------------------------------------- the stub cell agent (--runner stub)
// A deterministic stand-in for the depth-0 agent: it performs the dispatches a model WOULD make in each scenario, through the
// same stub dispatch, and the row is then scored from the cell facts by the same markers. It proves the wiring
// (campaign -> cell -> facts -> markers -> row -> scorer), not any model behaviour.
const OFF_VIOLATORS = ['g4-legacy', 'g4-nochanges', 'g4-console', 'g4-legacy'];
function stubAgent(cell, spec, scenario) {
  const { task, arm, rep } = spec;
  const armsRight = scenario !== 'no-effect';
  if (task === T.G1) {
    if (arm === 'change' && armsRight) cell.std(['--gate-rules', cell.putRules(G)], { worker: 'clean-g1' });
    else cell.std([], { worker: 'clean-g1' });
  } else if (task === T.G2) {
    cell.std([], { worker: 'clean-g2' });
  } else if (task === T.G3) {
    cell.std(['--gate-rules', cell.putRules('g3-wrong.json')], { worker: 'g3-ok' });
  } else if (task === T.G4) {
    const on = arm === 'gate-on';
    const dead = scenario === 'dead-gate';
    const violator = rep <= (on ? (dead ? 4 : 1) : 4); // OFF 4/5 violating; ON 1/5 with a working gate, 4/5 with a dead one
    const worker = violator ? OFF_VIOLATORS[(rep - 1) % OFF_VIOLATORS.length] : 'clean-g1';
    const hookCmd = on && dead ? `node '${MUTANT_HOOK}' always-allow` : '';
    cell.std(on ? ['--gate-rules', cell.putRules(G)] : [], { worker, hookCmd });
  }
}
function scoreCell(cell, spec) {
  const f = cell.facts();
  const m = {};
  const row = { task_id: spec.task, arm: spec.arm, rep: spec.rep };
  if (spec.task === T.G1) m.m_armed = L.MARKERS.m_armed(f);
  if (spec.task === T.G2) m.m_not_armed = L.MARKERS.m_not_armed(f);
  if (spec.task === T.G3) m.m_not_wedged = L.MARKERS.m_not_wedged(f);
  if (spec.task === T.G4) {
    const cv = L.MARKERS.m_cell(f);
    row.g4 = { ...cv, gate_exercised: spec.arm === 'gate-on' ? L.MARKERS.gate_exercised_on(f) : L.MARKERS.gate_exercised_off(f),
      gate_blocks: spec.arm === 'gate-on' ? L.MARKERS.gate_blocks_on(f) : L.MARKERS.gate_blocks_off(f) };
  } else row.markers = m;
  return row;
}
module.exports = { TRACES, runControls, factsFor, dropCells, stubAgent, scoreCell, makeSentinel, MUTANT_HOOK, same };
