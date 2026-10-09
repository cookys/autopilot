'use strict';

// gate/check.test.js — unit tests of check.js on hand-made capture dirs (node --test gate/check.test.js).
// P7 rewrite (stage-graph P7 work package 3a): the band is ONE line (` │ ` separators, last segment ⓘ), judged slot by slot against the
// P7 contract. Sections: the verdict precedence (kept from W4: attention / stall / foreman / completion / live work / turn / root set),
// the one-line band at 209 / 120 / 80 columns with rich and sparse facts, one planted FAIL per slot, the width-table ABSENT rule,
// the non-ok line, the panel / dialog surfaces, and the final summary line. Mutation proofs of check.js are recorded in the P7 report
// (each mutation turns named tests red; restored afterwards).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, derive, findBand, findNonOk, classify, displayWidth, summary } = require('./check.js');

const NOW = Date.parse('2026-10-05T10:00:00.000Z');
const IDENT = 'git-common-dir:/home/u/projects/demo/.git';
const SID = 'sess-1';
const ROOT = 'job-1';
const PK = 'abcdef0123456789';
const iso = (offMin) => new Date(NOW - offMin * 60000).toISOString();

const baseEnvelope = (over) => ({ schema: 'autopilot.runs-live/1', scope: { project_key: PK, repo_identity: IDENT, root_run_id: ROOT }, published_at: iso(0), valid_for_s: 180, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0 }, ...(over || {}) });

// capture(files, paneLines, meta): a capture dir with a fresh quiet envelope and a bare marker; `files[name] = null` removes a file
function capture(files, paneLines, metaOver) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatechk-'));
  const w = (n, v) => { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), typeof v === 'string' ? v : JSON.stringify(v)); };
  w('meta.json', { cell: 'l5-t', mode: 'l5', sid: SID, project_key: PK, root_run_id: ROOT, captured_at: new Date(NOW).toISOString(), captured_at_ms: NOW, window_width: 209, ...(metaOver || {}) });
  w('marker.json', { session_id: SID, level: null, repo_identity: IDENT, project_key: PK, root_run_id: ROOT, started_at: iso(30), expires_at: iso(-600) });
  w('envelope.json', baseEnvelope());
  for (const [n, v] of Object.entries(files || {})) { if (v === null) fs.rmSync(path.join(dir, n), { force: true }); else w(n, v); }
  w('pane.txt', `some output\n\n${(paneLines || []).join('\n')}\n> \n`);
  return dir;
}
const status = (res, name) => (res.results.find((r) => r.name === name) || {}).status;
const tasksFile = (list) => ({ schema: 'autopilot.session-tasks/1', session_id: SID, first_created_at: iso(30), tasks: list });
const t = (id, subject, st, seq) => ({ id, subject, status: st, started_seq: seq === undefined ? null : seq });
const receipt = (extra) => ({ root_run_id: ROOT, controller: { progress_receipts: [{ artifact_type: 'controller_progress_receipt', root_run_id: ROOT, issued_at: iso(20), generation: 1, ...extra }] } });

// ---- rich facts: every slot present at 209
const richMarker = (over) => ({ session_id: SID, level: 'l5', repo_identity: IDENT, project_key: PK, root_run_id: ROOT, started_at: iso(30), expires_at: iso(-600),
  size: 'M', urgent: true, stage: 'implement', stage_set_at: iso(3), unit: { kind: 'deliverable', index: 3, total: 5, label: 'x' }, review_families: ['a', 'b'], ...(over || {}) });
const richFiles = (over) => ({
  'marker.json': richMarker(),
  'envelope.json': baseEnvelope({ runs: [{ run_id: 'r1', alive: true, stall: false, started_at: iso(30) }, { run_id: 'r2', alive: true, stall: true, started_at: iso(30) }],
    counts: { confirmed_live: 2, exited: 0, unknown: 0 }, host_today_brain_usd: 123.4, brain_cap_usd: 150 }),
  'review.json': { schema: 'autopilot.review/1', project_key: PK, code: { generation: 2 }, plan: { generation: 1 } },
  'qc.json': { schema: 'autopilot.qc-status/1', scope: { project_key: PK, root_run_id: null }, state: 'ok' },
  'decisions-sidecar.json': { schema: 'autopilot.decisions-sidecar/1', count: 3, irreversible_count: 1, undocumented_dispatches: 1, ladder: { rung: 'U2', at: iso(5) } },
  'load-source.json': { schema: 'autopilot.load-source/1', source: 'dev', behind_upstream: 3, flags: [] },
  'residue.json': { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 2, by_class: { 'clean-integrated': 1, 'missing-dir': 1, other: 4 } },
  ...(over || {}),
});
const RICH_209 = '⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R2 ⟲ · QC ✓ │ ◆3 ?1 U2 │ $123/150 │ dev ↓3 · wt 2 │ ⓘ';
const RICH_120 = '⏸ 疑似卡住 │ M!·l5 ▸ implement │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ ⓘ';
const RICH_80 = '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ';
const rich = (line, width, over) => capture(richFiles(over), [line], { window_width: width });

// ---- the band at three widths, rich facts
test('RICH 209: every slot is judged PASS, the summary is PASS <mode> fields=10', () => {
  const r = run(rich(RICH_209, 209));
  for (const n of ['verdict', 'position', 'unit', 'dispatch', 'review', 'decisions', 'spend', 'hygiene', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.fields, 10);
  assert.strictEqual(summary(r), 'PASS l5 fields=10');
  assert.strictEqual(r.derived.columns, 204);
});
test('RICH 120 (bodyColumns 115): hygiene, spend, decisions, review and the ◷ age are ABSENT; the rest PASS', () => {
  const r = run(rich(RICH_120, 120));
  for (const n of ['hygiene', 'spend', 'decisions', 'review']) assert.strictEqual(status(r, n), 'ABSENT', n);
  for (const n of ['verdict', 'position', 'unit', 'dispatch', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.derived.columns, 115);
});
test('RICH 80 (bodyColumns 75): only verdict, the unit bar (no k/N, no 族), dispatch and ⓘ', () => {
  const r = run(rich(RICH_80, 80));
  assert.strictEqual(status(r, 'position'), 'ABSENT');
  for (const n of ['verdict', 'unit', 'dispatch', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(summary(r), 'PASS l5 fields=10');
});
test('RICH 80: a k/N or 族 left on the bar FAILs the unit slot', () => {
  assert.strictEqual(status(run(rich('⏸ 疑似卡住 │ ▰▰▰▱▱ 3/5 │ ⚙2 ⏸1 │ ⓘ', 80)), 'unit'), 'FAIL');
});

// ---- sparse facts: empty slots are left out, never a doubled separator
const SPARSE = { 'marker.json': richMarker({ size: 'S', urgent: false, level: null, stage: 'plan', unit: undefined, review_families: [], stage_set_at: iso(10) }), 'envelope.json': baseEnvelope() };
test('SPARSE 209: verdict + position + ⓘ only; the other slots are ABSENT with the empty reason', () => {
  const r = run(capture(SPARSE, ['◌ 待命 │ S ▸ plan ◷10m │ ⓘ']));
  for (const n of ['unit', 'dispatch', 'review', 'decisions', 'spend', 'hygiene']) assert.strictEqual(status(r, n), 'ABSENT', n);
  for (const n of ['verdict', 'position', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(summary(r), 'PASS l5 fields=10');
});
test('SPARSE 120 and 80 pass the same facts (position gone at 80)', () => {
  assert.strictEqual(run(capture(SPARSE, ['◌ 待命 │ S ▸ plan │ ⓘ'], { window_width: 120 })).ok, true);
  const r80 = run(capture(SPARSE, ['◌ 待命 │ ⓘ'], { window_width: 80 }));
  assert.strictEqual(r80.ok, true); assert.strictEqual(status(r80, 'position'), 'ABSENT');
});
test('SPARSE: a doubled separator / an empty slot drawn FAILs the layout', () => {
  assert.strictEqual(status(run(capture(SPARSE, ['◌ 待命 │ S ▸ plan ◷10m │  │ ⓘ'])), 'layout'), 'FAIL');
});
test('SPARSE: a level-less marker with no size draws no leading separator (▸ stage); level null omits ·level', () => {
  const files = { 'marker.json': richMarker({ size: undefined, urgent: false, level: null, stage: 'plan', unit: undefined, review_families: [], stage_set_at: undefined }) };
  assert.strictEqual(run(capture(files, ['◌ 待命 │ ▸ plan │ ⓘ'])).ok, true);
  const lvl = { 'marker.json': richMarker({ size: 'L', urgent: false, level: 'l4', stage: 'plan', unit: undefined, review_families: [], stage_set_at: undefined }) };
  assert.strictEqual(run(capture(lvl, ['◌ 待命 │ L·l4 ▸ plan │ ⓘ'])).ok, true);
});

// ---- one planted FAIL per slot: ONE mutated fact, the rich band no longer matches
function mutated(over, line) { return run(rich(line || RICH_209, 209, over)); }
test('PLANTED RED verdict: the stalled run is gone, so the band must say 進行中 (it says 疑似卡住)', () => {
  const r = mutated({ 'envelope.json': baseEnvelope({ runs: [{ alive: true, stall: false }, { alive: true, stall: false }], counts: { confirmed_live: 2 }, host_today_brain_usd: 123.4, brain_cap_usd: 150 }) });
  assert.strictEqual(status(r, 'verdict'), 'FAIL'); assert.strictEqual(r.ok, false);
});
test('PLANTED RED position: another stage in the marker', () => {
  const r = mutated({ 'marker.json': richMarker({ stage: 'verify' }) });
  assert.deepStrictEqual(r.failed, ['position']);
});
test('PLANTED RED position age: ◷ tolerance is +-2 min (5m passes against 3m, 6m fails)', () => {
  assert.strictEqual(status(run(rich(RICH_209.replace('◷3m', '◷5m'), 209)), 'position'), 'PASS');
  assert.strictEqual(status(run(rich(RICH_209.replace('◷3m', '◷6m'), 209)), 'position'), 'FAIL');
  assert.strictEqual(status(run(rich(RICH_209.replace(' ◷3m', ''), 209)), 'position'), 'FAIL', 'a missing age FAILs');
});
test('PLANTED RED unit: the marker unit index moved on', () => {
  const r = mutated({ 'marker.json': richMarker({ unit: { kind: 'deliverable', index: 4, total: 5, label: 'x' } }) });
  assert.deepStrictEqual(r.failed, ['unit']);
});
test('PLANTED RED unit 族: the review family count changed', () => {
  assert.deepStrictEqual(mutated({ 'marker.json': richMarker({ review_families: ['a', 'b', 'c'] }) }).failed, ['unit']);
});
test('PLANTED RED dispatch: one more live run in the envelope counts', () => {
  const r = mutated({ 'envelope.json': baseEnvelope({ runs: [{ alive: true, stall: true }], counts: { confirmed_live: 3 }, host_today_brain_usd: 123.4, brain_cap_usd: 150 }) });
  assert.deepStrictEqual(r.failed, ['dispatch']);
});
test('PLANTED RED review: another review round', () => {
  assert.deepStrictEqual(mutated({ 'review.json': { schema: 'autopilot.review/1', project_key: PK, code: { generation: 3 } } }).failed, ['review']);
});
test('PLANTED RED review QC chip: qc owed while the band says QC ✓', () => {
  assert.deepStrictEqual(mutated({ 'qc.json': { schema: 'autopilot.qc-status/1', scope: { project_key: PK, root_run_id: null }, state: 'owed' } }).failed, ['review']);
});
test('PLANTED RED decisions: the sidecar count changed', () => {
  assert.deepStrictEqual(mutated({ 'decisions-sidecar.json': { count: 4, undocumented_dispatches: 1, ladder: { rung: 'U2', at: iso(5) } } }).failed, ['decisions']);
});
test('PLANTED RED decisions rung: the latest ladder rung is another one', () => {
  assert.deepStrictEqual(mutated({ 'decisions-sidecar.json': { count: 3, undocumented_dispatches: 1, ladder: { rung: 'U4', at: iso(5) } } }).failed, ['decisions']);
});
test('PLANTED RED spend: brain-tier spend in the envelope changed', () => {
  const r = mutated({ 'envelope.json': baseEnvelope({ runs: [{ alive: true, stall: false }, { alive: true, stall: true }], counts: { confirmed_live: 2 }, host_today_brain_usd: 140, brain_cap_usd: 150 }) });
  assert.deepStrictEqual(r.failed, ['spend']);
});
test('PLANTED RED hygiene: more reapable worktrees in the residue fact', () => {
  assert.deepStrictEqual(mutated({ 'residue.json': { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 3, by_class: { 'clean-integrated': 2, 'missing-dir': 1 } } }).failed, ['hygiene']);
});
test('PLANTED RED hygiene chip: behind upstream changed in load-source', () => {
  assert.deepStrictEqual(mutated({ 'load-source.json': { schema: 'autopilot.load-source/1', source: 'dev', behind_upstream: 5, flags: [] } }).failed, ['hygiene']);
});
test('PLANTED RED ⓘ: the band is drawn without the info button', () => {
  const r = run(rich(RICH_209.replace(' │ ⓘ', ''), 209));
  assert.strictEqual(status(r, 'ⓘ'), 'FAIL'); assert.strictEqual(r.ok, false);
});
test('residue.json whose reapable count disagrees with by_class is a note (the D3 definition)', () => {
  const r = mutated({ 'residue.json': { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 2, by_class: { 'clean-integrated': 1, 'missing-dir': 0 } } });
  assert.ok(r.derived.notes.some((n) => n.includes('inconsistent')));
});
test('facts of another project or schema are not facts (a foreign residue / qc / review draws nothing)', () => {
  const r = mutated({ 'residue.json': { schema: 'autopilot.residue/1', project_key: 'other', reapable_worktrees: 2 }, 'qc.json': { schema: 'autopilot.qc-status/1', scope: { project_key: 'other' }, state: 'ok' } },
    '⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R2 ⟲ │ ◆3 ?1 U2 │ $123/150 │ dev ↓3 │ ⓘ');
  assert.strictEqual(r.ok, true);
});

// ---- spend / hygiene / unit specifics
test('spend is empty when the brain spend is not published', () => {
  const files = richFiles({ 'envelope.json': baseEnvelope({ runs: [{ alive: true, stall: false }, { alive: true, stall: true }], counts: { confirmed_live: 2 } }) });
  const r = run(capture(files, ['⏸ 疑似卡住 │ M!·l5 ▸ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 │ R2 ⟲ · QC ✓ │ ◆3 ?1 U2 │ dev ↓3 · wt 2 │ ⓘ']));
  assert.strictEqual(status(r, 'spend'), 'ABSENT'); assert.strictEqual(r.ok, true);
});
test('hygiene chip forms: cache copy, unknown source, marketplace warning, no chip but wt', () => {
  const hy = (ls, res, line) => run(capture(richFiles({ 'load-source.json': ls, 'residue.json': res }), [RICH_209.replace('dev ↓3 · wt 2', line)]));
  const noRes = { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 0, by_class: {} };
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'cache:2.36.36', flags: [] }, noRes, 'cache 2.36.36 ⚠'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'unknown', flags: [] }, noRes, 'src ? ⚠'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'dev', flags: ['marketplace_not_this_repo'] }, noRes, 'dev ⚠'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy(null, { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 4, by_class: { 'clean-integrated': 4 } }, 'wt 4'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'dev', flags: [] }, noRes, 'dev'), 'hygiene'), 'PASS');
});
test('unit bar scales to 10 cells when N > 10, and 5/20 puts the current cell at ceil(5*10/20)=3', () => {
  const files = { 'marker.json': richMarker({ stage: undefined, unit: { kind: 'deliverable', index: 5, total: 20, label: 'x' }, review_families: [] }), 'envelope.json': baseEnvelope() };
  const r = run(capture(files, ['◌ 待命 │ ▰▰▰▱▱▱▱▱▱▱ 5/20 │ ⓘ']));
  assert.strictEqual(status(r, 'unit'), 'PASS');
  assert.strictEqual(status(run(capture(files, ['◌ 待命 │ ▰▰▰▰▱▱▱▱▱▱ 5/20 │ ⓘ'])), 'unit'), 'FAIL');
});
test('a long stage name is cut with … exactly as far as needed (never below 2 cells); an uncut or wrongly cut stage FAILs', () => {
  const long = 'x'.repeat(220);
  const files = richFiles({ 'marker.json': richMarker({ stage: long }) });
  // expected cut, worked out by hand: the line with the 9-cell stage `implement` is W cells; 204 columns (209 - 5) are available
  const stageW = 204 - (displayWidth(RICH_209) - displayWidth('implement'));
  const exact = `${'x'.repeat(stageW - 1)}…`;
  const r = run(capture(files, [RICH_209.replace('implement', exact)]));
  assert.ok(r.derived.over > 0); assert.strictEqual(status(r, 'position'), 'PASS'); assert.strictEqual(status(r, 'layout'), 'PASS');
  assert.strictEqual(displayWidth(RICH_209.replace('implement', exact)), 204);
  for (const bad of [`${'x'.repeat(40)}…`, 'x…', '…', `${'x'.repeat(stageW)}…`]) {
    assert.strictEqual(status(run(capture(files, [RICH_209.replace('implement', bad)])), 'position'), 'FAIL', `stage "${bad.slice(0, 12)}…" must FAIL`);
  }
  const uncut = run(capture(files, [RICH_209.replace('implement', long)]));
  assert.strictEqual(status(uncut, 'layout'), 'FAIL'); assert.strictEqual(uncut.ok, false);
});
test('GATEFIX content after the ⓘ on the band row FAILs the layout; the engine [-] toggle and a docked pane border do not', () => {
  const ok = '● 進行中 │ ⓘ';
  const lay = (row, meta) => status(run(capture({ 'turn.json': turnF('active') }, [row], meta)), 'layout');
  assert.strictEqual(lay(ok), 'PASS');
  assert.strictEqual(lay(`${ok}      [-]`), 'PASS');
  assert.strictEqual(lay(`${ok} │ garbage`), 'FAIL');
  assert.strictEqual(lay(`${ok}  garbage [-]`), 'FAIL');
  // a docked pane: the border at the dock cell is fine, a `│` anywhere else is content
  const docked = dockedPane(ok, 40, 12);
  assert.strictEqual(status(run(capture({ 'turn.json': turnF('active') }, docked)), 'layout'), 'PASS');
  const forged = docked.map((l) => l.replace(`${ok}`, `${ok} │ garbage`));
  assert.strictEqual(status(run(capture({ 'turn.json': turnF('active') }, forged)), 'layout'), 'FAIL');
});
test('GATEFIX layout rules: slots out of priority order FAIL, a duplicated slot FAILs, each by its own rule', () => {
  const files = richFiles();
  const layout = (line) => { const r = run(capture(files, [line], { window_width: 209 })); return r.results.find((x) => x.name === 'layout'); };
  assert.strictEqual(layout(RICH_209).status, 'PASS');
  const swapped = '⏸ 疑似卡住 │ ▰▰▰▱▱ 3/5 ·2族 │ M!·l5 ▸ implement ◷3m │ ⚙2 ⏸1 │ R2 ⟲ · QC ✓ │ ◆3 ?1 U2 │ $123/150 │ dev ↓3 · wt 2 │ ⓘ';
  const o = layout(swapped); assert.strictEqual(o.status, 'FAIL'); assert.match(o.detail, /out of priority order/);
  const dup = RICH_209.replace(' │ ⚙2 ⏸1 │', ' │ ⚙2 ⏸1 │ ⚙2 ⏸1 │');
  const d = layout(dup); assert.strictEqual(d.status, 'FAIL'); assert.match(d.detail, /second dispatch/);
});
test('GATEFIX classify: the verdict below 2 cells is the glyph alone or glyph + …', () => {
  assert.strictEqual(classify('●', 0), 'verdict'); assert.strictEqual(classify('●…', 0), 'verdict'); assert.strictEqual(classify('● 進行…', 0), 'verdict');
  assert.strictEqual(classify('x…', 0), null);
});

// ---- the width-table ABSENT rule
test('WIDTH TABLE: a slot the table removed at this width is FAIL if drawn (hygiene at 119 columns of body, spend at 139, review at 119, position at 79)', () => {
  const at = (line, bodyColumns) => run(capture(richFiles(), [line], { body_columns: bodyColumns }));
  assert.strictEqual(status(at(RICH_209, 159), 'hygiene'), 'FAIL', 'hygiene < 160');
  assert.strictEqual(status(at(RICH_209, 139), 'spend'), 'FAIL', 'spend < 140');
  assert.strictEqual(status(at(RICH_209, 139), 'decisions'), 'FAIL', 'decisions < 140');
  assert.strictEqual(status(at(RICH_209, 119), 'review'), 'FAIL', 'review < 120');
  assert.strictEqual(status(at(RICH_209, 79), 'position'), 'FAIL', 'position < 80');
  assert.strictEqual(status(at(RICH_209, 79), 'unit'), 'FAIL', 'k/N and 族 < 80');
});
test('WIDTH TABLE: exact thresholds — all slots at 160, no hygiene at 159, no spend/decisions at 139, no review/age at 119, no k/N at 79', () => {
  const rows = (b) => derive(capture(richFiles(), [], { body_columns: b })).slots;
  assert.strictEqual(rows(160).hygiene.state, 'present'); assert.strictEqual(rows(159).hygiene.state, 'width');
  assert.strictEqual(rows(140).spend.state, 'present'); assert.strictEqual(rows(139).spend.state, 'width'); assert.strictEqual(rows(139).decisions.state, 'width');
  assert.strictEqual(rows(120).review.state, 'present'); assert.strictEqual(rows(119).review.state, 'width');
  assert.ok(rows(120).position.text.includes('◷')); assert.ok(!rows(119).position.text.includes('◷'));
  assert.strictEqual(rows(80).position.state, 'present'); assert.strictEqual(rows(79).position.state, 'width');
  assert.strictEqual(rows(79).unit.text, '▰▰▰▱▱');
});
test('WIDTH: the window width is read from meta (bodyColumns = window - 5); --body-columns / meta.body_columns override it', () => {
  assert.strictEqual(derive(capture(richFiles(), [], { window_width: 120 })).columns, 115);
  assert.strictEqual(derive(capture(richFiles(), [], { window_width: 120, body_columns: 90 })).columns, 90);
  assert.strictEqual(derive(capture(richFiles(), [], { window_width: undefined }), {}).columns >= 0, true, 'no width recorded: falls back to the widest pane line');
  assert.strictEqual(derive(capture(richFiles(), [], { window_width: 120 }), { bodyColumns: 300 }).columns, 300);
});
test('displayWidth: CJK is 2 cells, the band glyphs are 1', () => {
  assert.strictEqual(displayWidth('疑似卡住'), 8); assert.strictEqual(displayWidth('▰▱⚙⏸◆ⓘ│▸◷⟲'), 10);
});

// ---- the non-ok line
test('NON-OK: no envelope -> one line `<reason> │ ⓘ`; a band drawn instead FAILs, a slot-bearing line FAILs', () => {
  const files = { 'envelope.json': null };
  const ok = run(capture(files, ['no project · run: autopilot status runs --watch │ ⓘ']));
  assert.strictEqual(status(ok, 'nonok'), 'PASS'); assert.strictEqual(status(ok, 'ⓘ'), 'PASS'); assert.strictEqual(ok.ok, true);
  assert.strictEqual(summary(ok), 'PASS l5 fields=2');
  assert.strictEqual(run(capture(files, ['◌ 待命 │ ⓘ'])).ok, false);
  assert.strictEqual(status(run(capture(files, ['no project │ extra │ ⓘ'])), 'nonok'), 'FAIL');
});
test('NON-OK: a stale envelope is the non-ok line; a fresh envelope drawn as the non-ok line FAILs verdict', () => {
  const stale = { 'envelope.json': baseEnvelope({ published_at: iso(10) }) };
  assert.strictEqual(run(capture(stale, ['stale · run: autopilot status runs --watch │ ⓘ'])).ok, true);
  const r = run(capture({}, ['stale · run: autopilot status runs --watch │ ⓘ']));
  assert.strictEqual(status(r, 'verdict'), 'FAIL'); assert.strictEqual(r.ok, false);
});

// ---- the summary line
function cli(dir, args) {
  const p = spawnSync(process.execPath, [path.join(__dirname, 'check.js'), dir, ...(args || [])], { encoding: 'utf8' });
  return { code: p.status, lines: p.stdout.trimEnd().split('\n'), stdout: p.stdout, stderr: p.stderr };
}
test('SUMMARY: the last line is exactly `PASS <mode> fields=<n>` / `FAIL <mode> fields=<n> failed=<slots>`; exit 0 / 1 / 2', () => {
  const pass = cli(rich(RICH_209, 209));
  assert.strictEqual(pass.lines[pass.lines.length - 1], 'PASS l5 fields=10'); assert.strictEqual(pass.code, 0);
  assert.ok(pass.lines.some((l) => /^PASS spend expected \$123\/150 got \$123\/150 \[.+\]$/.test(l)));
  assert.ok(pass.lines.some((l) => /^surface: band$/.test(l)));
  assert.ok(pass.lines.some((l) => /^width: bodyColumns=204 \[.*window_width 209 - 5.*\]$/.test(l)));
  const fail = cli(rich(RICH_209.replace('$123/150', '$99/150').replace('3/5', '4/5'), 209));
  assert.strictEqual(fail.lines[fail.lines.length - 1], 'FAIL l5 fields=10 failed=unit,spend'); assert.strictEqual(fail.code, 1);
  assert.ok(fail.lines.some((l) => /^FAIL spend expected \$123\/150 got \$99\/150 /.test(l)));
  const absent = cli(rich(RICH_120, 120));
  assert.ok(absent.lines.some((l) => /^ABSENT hygiene expected absent \(removed by the width table \(bodyColumns 115 < 160\)\) got absent /.test(l)));
  assert.strictEqual(cli('/nonexistent/dir').code, 2);
  assert.strictEqual(cli(rich(RICH_209, 209), ['--body-columns', 'x']).code, 2);
});
test('SUMMARY: the mode comes from meta.mode, else the cell prefix; --json carries the same summary', () => {
  assert.strictEqual(cli(capture(SPARSE, ['◌ 待命 │ S ▸ plan ◷10m │ ⓘ'], { mode: 'dev-flow' })).lines.pop(), 'PASS dev-flow fields=10');
  assert.strictEqual(cli(capture(SPARSE, ['◌ 待命 │ S ▸ plan ◷10m │ ⓘ'], { mode: undefined, cell: 'l6-idle' })).lines.pop(), 'PASS l6 fields=10');
  const j = JSON.parse(cli(rich(RICH_209, 209), ['--json']).stdout);
  assert.strictEqual(j.summary, 'PASS l5 fields=10'); assert.strictEqual(j.body_columns, 204);
});

// ---- pane reading
test('findBand takes the last band line up to ⓘ; a docked pane to its right is not part of it; a transcript mention is not a band', () => {
  const b = findBand('x\n● 進行中 │ ⚙1 │ ⓘ      │ pane text\n> ');
  assert.strictEqual(b.verdict, '進行中'); assert.strictEqual(b.text, '● 進行中 │ ⚙1 │ ⓘ');
  assert.strictEqual(findBand('we saw ● 進行中 earlier in the log'), null);
  assert.strictEqual(findBand('nothing here'), null);
  assert.strictEqual(findNonOk('no project │ ⓘ').kind, 'nonok');
  assert.strictEqual(classify('R3 ⟲', 3), 'review'); assert.strictEqual(classify('garbage', 3), null);
});

// ---- verdict precedence (kept from W4), judged through the one-line band
test('要你決定 by an attention permission / question, or an open decision file even with an idle attention file', () => {
  const perm = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: rm -rf /tmp/x', since: iso(2) } }, ['▲ 要你決定 │ ⓘ']);
  assert.strictEqual(status(run(perm), 'verdict'), 'PASS');
  assert.strictEqual(derive(capture({ 'attention.json': { kind: 'question', summary: 'which db?' } }, [])).verdict, '要你決定');
  assert.strictEqual(derive(capture({ 'decision-file.json': { schema: 'autopilot.decision/1', question: '要不要強推 main？' }, 'attention.json': { kind: 'idle', summary: 'waiting' } }, [])).verdict, '要你決定');
  assert.strictEqual(derive(capture({ 'attention.json': { kind: 'idle', summary: 'waiting' } }, [])).verdict, '待命');
});
test('疑似卡住 from an envelope run with stall:true', () => {
  const dir = capture({ 'envelope.json': baseEnvelope({ runs: [{ run_id: 'r', alive: true, stall: true, started_at: iso(30) }], counts: { confirmed_live: 1 } }) }, ['⏸ 疑似卡住 │ ⚙1 ⏸1 │ ⓘ']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'dispatch'), 'PASS'); assert.strictEqual(r.ok, true);
});
test('完成待驗收 by frozen done == total, or every session task completed (deleted ones never count)', () => {
  const frozen = capture({ 'work-orders/n1-a1.json': receipt({ frozen_denominator_digest: 'sha', deliverable_count: 4, completed_deliverables: ['a', 'b', 'c', 'd'], remaining_deliverables: [] }) }, ['✓ 完成待驗收 │ ⓘ']);
  assert.strictEqual(status(run(frozen), 'verdict'), 'PASS');
  const tasks = capture({ 'tasks.json': tasksFile([t(1, 'a', 'completed'), t(2, 'b', 'completed'), t(3, 'gone', 'deleted')]) }, ['✓ 完成待驗收 │ ⓘ']);
  assert.strictEqual(status(run(tasks), 'verdict'), 'PASS');
});
test('進行中 by a live run or a task in progress; 待命 when nothing is live', () => {
  assert.strictEqual(status(run(capture({ 'envelope.json': baseEnvelope({ runs: [{ run_id: 'r', alive: true, stall: false }], counts: { confirmed_live: 1 } }) }, ['● 進行中 │ ⚙1 │ ⓘ'])), 'verdict'), 'PASS');
  assert.strictEqual(derive(capture({ 'tasks.json': tasksFile([t(1, 'x', 'completed'), t(2, 'y', 'in_progress', 1)]) }, [])).verdict, '進行中');
  assert.strictEqual(status(run(capture({}, ['◌ 待命 │ ⓘ'])), 'verdict'), 'PASS');
});
test('PLANTED RED: band 進行中 while an attention permission is open; band 待命 while a run is stalled; no band at all', () => {
  const a = run(capture({ 'attention.json': { kind: 'permission', summary: 'Bash: x' } }, ['● 進行中 │ ⓘ']));
  assert.strictEqual(status(a, 'verdict'), 'FAIL'); assert.strictEqual(a.ok, false);
  assert.strictEqual(run(capture({ 'envelope.json': baseEnvelope({ runs: [{ alive: true, stall: true }], counts: { confirmed_live: 1 } }) }, ['◌ 待命 │ ⓘ'])).ok, false);
  const none = run(capture({}, ['just a shell prompt']));
  assert.strictEqual(none.ok, false); assert.strictEqual(none.surface, null); assert.match(summary(none), /^FAIL l5 fields=1 failed=verdict$/);
});
test('GATEFIX: every task completed AND a live run -> 進行中 (completion needs no live run)', () => {
  const files = { 'tasks.json': tasksFile([t(1, 'a', 'completed'), t(2, 'b', 'completed')]), 'envelope.json': baseEnvelope({ runs: [{ run_id: 'r', alive: true, stall: false }], counts: { confirmed_live: 1 } }) };
  assert.strictEqual(status(run(capture(files, ['● 進行中 │ ⚙1 │ ⓘ'])), 'verdict'), 'PASS');
  assert.strictEqual(status(run(capture(files, ['✓ 完成待驗收 │ ⚙1 │ ⓘ'])), 'verdict'), 'FAIL');
});

// ---- surfaces: a dialog hides the band, the panel (or only attention.json) is judged
const SIDE = (l) => `${l.padEnd(60)}│`;
const panelPane = (word, reason) => [SIDE('● Creating a file'), `${SIDE(' Do you want to proceed?')}${word}`, `${SIDE(' ❯ 1. Yes')}${reason}`, SIDE(' Esc to cancel')];
test('SURFACE panel: verdict + reason judged, the slots SKIP and are not counted; a panel with no open attention FAILs', () => {
  const dir = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: touch /tmp/gate-perm-test', since: iso(0) } },
    panelPane('要你決定', '等你批准：Bash: touch /tmp/gate-perm-test（等了 0 分）'));
  const r = run(dir);
  assert.strictEqual(r.surface, 'panel'); assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'reason'), 'PASS');
  assert.strictEqual(status(r, 'position'), 'SKIP'); assert.strictEqual(r.fields, 2); assert.strictEqual(summary(r), 'PASS l5 fields=2');
  const bad = run(capture({}, panelPane('要你決定', '等你批准：Bash: x')));
  assert.strictEqual(bad.surface, 'panel'); assert.strictEqual(status(bad, 'verdict'), 'FAIL'); assert.strictEqual(bad.ok, false);
});
test('SURFACE band wins over the panel; no verdict and no dialog is no surface', () => {
  const dir = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: ls', since: iso(0) } },
    [...panelPane('要你決定', '等你批准：Bash: ls（等了 0 分）'), '▲ 要你決定 │ ⓘ']);
  assert.strictEqual(run(dir).surface, 'band');
  assert.strictEqual(run(capture({}, [SIDE('x') + '會議記錄：要你決定 的事項', SIDE('y') + '無'])).surface, null);
});
const DIALOG = ['● Foreman: csv parser', '', ' Bash command · from the general-purpose agent', ' This command requires approval', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   4. No', ' Esc to cancel · Tab to amend'];
test('SURFACE dialog: judged from attention.json alone; absent / idle attention FAILs', () => {
  const r = run(capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: git reset', since: iso(0) } }, DIALOG));
  assert.strictEqual(r.surface, 'dialog'); assert.strictEqual(r.ok, true); assert.strictEqual(status(r, 'unit'), 'SKIP');
  assert.strictEqual(run(capture({}, DIALOG)).ok, false);
  assert.strictEqual(run(capture({ 'attention.json': { kind: 'idle', summary: 'waiting' } }, DIALOG)).ok, false);
});

// ---- turn, foremen, root set (verdict derivation, unchanged from W4)
const turnF = (state, offMin, extra) => ({ schema: 'autopilot.session-turn/1', session_id: SID, state, since: iso(offMin === undefined ? 3 : offMin), project_key: null, root_run_id: null, ...extra });
test('TURN: active = 進行中; ended, absent, older than 24 h or a foreign schema = 待命; permission outranks; an interrupted turn (same since) = 待命', () => {
  assert.strictEqual(derive(capture({ 'turn.json': turnF('active') }, [])).verdict, '進行中');
  assert.strictEqual(derive(capture({ 'turn.json': turnF('ended') }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': turnF('active', 25 * 60) }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': { ...turnF('active'), schema: 'x/1' } }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': turnF('active'), 'attention.json': { kind: 'permission', summary: 'Bash: ls' } }, [])).verdict, '要你決定');
  const T = turnF('active');
  const eff = (extra) => ({ schema: 'autopilot.session-turn-effective/1', session_id: SID, state: 'ended', reason: 'interrupted', turn_since: T.since, ...extra });
  assert.strictEqual(derive(capture({ 'turn.json': T, 'turn-effective.json': eff() }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': T, 'turn-effective.json': eff({ turn_since: iso(1) }) }, [])).verdict, '進行中');
});
const agentF = (id, ageS, extra) => ({ schema: 'autopilot.agent-activity/1', session_id: SID, agent_id: id, agent_type: 'general-purpose', last_tool_at: new Date(NOW - ageS * 1000).toISOString(), last_tool_name: 'Bash', ...extra });
test('FOREMAN: an un-ended agent quiet < 180 s is 進行中, >= 180 s is 疑似卡住 and counts one stalled dispatch (⏸1); ended / stale / foreign are ignored', () => {
  const v = (files) => derive(capture(files, [])).verdict;
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 179) }), '進行中');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 180) }), '疑似卡住');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 40, { ended_at: iso(0) }) }), '待命');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 25 * 3600) }), '待命');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 40, { schema: 'x/1' }) }), '待命');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 40, { last_tool_name: null }) }), '進行中');
  const r = run(capture({ 'agents/f1.json': agentF('f1', 400) }, ['⏸ 疑似卡住 │ ⏸1 │ ⓘ']));
  assert.strictEqual(status(r, 'dispatch'), 'PASS'); assert.strictEqual(r.ok, true);
});
test('FOREMAN: precedence — a fresh foreman blocks 完成待驗收; a stalled one outranks it; attention outranks a stalled foreman', () => {
  const done = { 'tasks.json': tasksFile([t('1', 'a', 'completed'), t('2', 'b', 'completed')]) };
  assert.strictEqual(derive(capture(done, [])).verdict, '完成待驗收');
  assert.strictEqual(derive(capture({ ...done, 'agents/f1.json': agentF('f1', 40) }, [])).verdict, '進行中');
  assert.strictEqual(derive(capture({ ...done, 'agents/f1.json': agentF('f1', 400) }, [])).verdict, '疑似卡住');
  assert.strictEqual(derive(capture({ 'agents/f1.json': agentF('f1', 400), 'attention.json': { kind: 'permission', summary: 'Bash: ls' } }, [])).verdict, '要你決定');
});
const CAMP = 'mission-1';
const CAMP0 = 'mission-0';
const markerWith = (roots) => ({ session_id: SID, level: 'l5', repo_identity: IDENT, project_key: PK, root_run_id: ROOT, started_at: iso(30), expires_at: iso(-600), campaign_roots: roots });
const env = (root, over) => ({ schema: 'autopilot.runs-live/1', scope: { project_key: PK, repo_identity: IDENT, root_run_id: root }, published_at: iso(0), valid_for_s: 180, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0 }, ...(over || {}) });
const liveRow = (id, over) => ({ run_id: id, alive: true, stall: false, started_at: iso(30), ...(over || {}) });
const frozenReceipt = (root, extra) => ({ root_run_id: root, controller: { progress_receipts: [{ artifact_type: 'controller_progress_receipt', root_run_id: root, issued_at: iso(20), generation: 1, frozen_denominator_digest: 'sha', deliverable_count: 4, completed_deliverables: ['a', 'b', 'c', 'd'], remaining_deliverables: [], ...(extra || {}) }] } });
const camp = (files, roots) => ({ 'marker.json': markerWith(roots || [CAMP]), ...files });
const liveC = { runs: [liveRow('c1')], counts: { confirmed_live: 1, exited: 0, unknown: 0 } };
test('SCOPE: a live / stalled run under a fresh campaign root counts, and the dispatch slot sums the root set', () => {
  assert.strictEqual(derive(capture(camp({ [`envelope--${CAMP}.json`]: env(CAMP, liveC) }), [])).verdict, '進行中');
  assert.strictEqual(derive(capture(camp({ [`envelope--${CAMP}.json`]: env(CAMP, { runs: [liveRow('c1', { stall: true })], counts: { confirmed_live: 1 } }) }), [])).verdict, '疑似卡住');
  const both = capture(camp({ 'envelope.json': env(ROOT, { runs: [liveRow('j1')], counts: { confirmed_live: 2 } }), [`envelope--${CAMP}.json`]: env(CAMP, liveC) }), ['● 進行中 │ ⚙3 │ ⓘ']);
  assert.strictEqual(status(run(both), 'dispatch'), 'PASS');
  assert.strictEqual(status(run(capture(camp({ 'envelope.json': env(ROOT, { runs: [liveRow('j1')], counts: { confirmed_live: 2 } }), [`envelope--${CAMP}.json`]: env(CAMP, liveC) }), ['● 進行中 │ ⚙2 │ ⓘ'])), 'dispatch'), 'FAIL');
});
test('SCOPE: a stale or missing extra envelope contributes nothing; an unsafe campaign root is ignored', () => {
  assert.strictEqual(derive(capture(camp({ [`envelope--${CAMP}.json`]: env(CAMP, { ...liveC, published_at: iso(60) }) }), [])).verdict, '待命');
  assert.strictEqual(derive(capture(camp({ [`envelope--${CAMP}.json`]: env(CAMP, { ...liveC, published_at: undefined }) }), [])).verdict, '待命');
  assert.strictEqual(derive(capture(camp({}), [])).verdict, '待命');
  assert.strictEqual(derive(capture(camp({ 'envelope--../x.json': env('x', liveC) }, ['../x', 42, '', ROOT, 'a/b']), [])).verdict, '待命');
});
test('SCOPE: campaign terminal (frozen 4/4, no live run) is 完成待驗收; the job root live review after it is 進行中', () => {
  const fr = { [`envelope--${CAMP}.json`]: env(CAMP), [`campaign-work-orders/${CAMP}/n1-a1.json`]: frozenReceipt(CAMP) };
  assert.strictEqual(derive(capture(camp(fr), [])).verdict, '完成待驗收');
  assert.strictEqual(derive(capture(camp({ ...fr, 'envelope.json': env(ROOT, liveC) }), [])).verdict, '進行中');
  const older = camp({ [`envelope--${CAMP0}.json`]: env(CAMP0), [`envelope--${CAMP}.json`]: env(CAMP), [`campaign-work-orders/${CAMP0}/n1-a1.json`]: frozenReceipt(CAMP0) }, [CAMP0, CAMP]);
  assert.strictEqual(derive(capture(older, [])).verdict, '完成待驗收');
});
test('SCOPE: decisions are summed over the fresh root set; the latest ladder rung by time wins', () => {
  const sc = (count, undoc, ladder) => ({ schema: 'autopilot.decisions-sidecar/1', count, irreversible_count: 0, undocumented_dispatches: undoc, ...(ladder ? { ladder } : {}) });
  const files = camp({ 'decisions-sidecar.json': sc(1, 0, { rung: 'U1', at: iso(20) }), [`envelope--${CAMP}.json`]: env(CAMP), [`decisions-sidecar--${CAMP}.json`]: sc(2, 3, { rung: 'U3', at: iso(5) }) });
  assert.strictEqual(status(run(capture(files, ['◌ 待命 │ ◆3 ?3 U3 │ ⓘ'])), 'decisions'), 'PASS');
  assert.strictEqual(status(run(capture(files, ['◌ 待命 │ ◆3 ?3 U1 │ ⓘ'])), 'decisions'), 'FAIL');
  const stale = camp({ 'decisions-sidecar.json': sc(1, 0), [`envelope--${CAMP}.json`]: env(CAMP, { published_at: iso(60) }), [`decisions-sidecar--${CAMP}.json`]: sc(2, 3) });
  assert.strictEqual(status(run(capture(stale, ['◌ 待命 │ ◆1 │ ⓘ'])), 'decisions'), 'PASS', 'a stale extra root adds nothing');
});

// ---- overflow fallback (contract section 2): unit bar, then ⏸ count, then ⚙ count, then the verdict word; expected lines = mods/live/live.test.ts "P7 fix B"
const FALLBACK = [
  [40, '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ'], [30, '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ'], [29, '⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⓘ'], [21, '⏸ 疑似卡住 │ ⚙2 │ ⓘ'],
  [20, '⏸ 疑似卡住 │ ⚙2 │ ⓘ'], [18, '⏸ 疑似卡住 │ ⓘ'], [12, '⏸ 疑似… │ ⓘ'],
];
for (const [cols, line] of FALLBACK) {
  test(`FALLBACK bodyColumns ${cols}: ${line}`, () => {
    const r = run(capture(richFiles(), [line], { body_columns: cols }));
    assert.strictEqual(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === 'FAIL')));
    assert.ok(displayWidth(line) <= cols);
    assert.strictEqual(status(r, 'layout'), 'PASS');
  });
}
test('FALLBACK: the steps are judged in order — the bar still drawn at 29, the ⏸ count at 21, the ⚙ count at 18, a full verdict word at 12 all FAIL', () => {
  const bad = (cols, line, slot) => assert.strictEqual(status(run(capture(richFiles(), [line], { body_columns: cols })), slot), slot === 'layout' ? 'FAIL' : 'FAIL', `${cols} ${slot}`);
  bad(29, '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ', 'layout');
  bad(29, '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 │ ⓘ', 'unit');
  bad(21, '⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⓘ', 'dispatch');
  bad(18, '⏸ 疑似卡住 │ ⚙2 │ ⓘ', 'dispatch');
  bad(12, '⏸ 疑似卡住 │ ⓘ', 'layout');
  bad(12, '⏸ 疑似卡住 │ ⓘ', 'verdict');
  // the fallback is not an excuse when the line fits: at 30 the bar must stay
  assert.strictEqual(status(run(capture(richFiles(), ['⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⓘ'], { body_columns: 30 })), 'unit'), 'FAIL');
  // the glyph and ⓘ are never removed
  assert.strictEqual(run(capture(richFiles(), ['⏸ 疑似… │'], { body_columns: 12 })).ok, false);
  const glyph = run(capture(richFiles(), ['⏸ │ ⓘ'], { body_columns: 5 }));
  assert.strictEqual(status(glyph, 'verdict'), 'PASS');
});
test('FALLBACK: the stage is cut first (never below 2 cells), then the fallback; findBand reads a shortened verdict', () => {
  assert.strictEqual(findBand('x\n⏸ 疑似… │ ⓘ').verdict, '疑似卡住'.length ? '疑似卡住' : '');
  assert.strictEqual(findBand('⏸ │ ⓘ').verdict, '疑似卡住');
  assert.strictEqual(findBand('⏸1 │ ⓘ'), null);
});

// ---- docked pane: bodyColumns from the transcript column
function dockedPane(bandLine, column, rows) {
  const pad = (txt) => txt + ' '.repeat(Math.max(0, column - displayWidth(txt)));
  const body = [];
  for (let i = 0; i < rows; i += 1) body.push(`${pad(`transcript row ${i}`)}│ pane row ${i}`);
  return [...body, `${pad(bandLine)}│ pane footer`];
}
test('DOCK: a pane column in pane.txt gives bodyColumns = transcript column - 5 and says so; it beats window - 5, loses to meta.body_columns / --body-columns', () => {
  const pane = dockedPane(RICH_120, 120, 10);
  const dir = capture(richFiles(), pane, { window_width: 209 });
  const d = derive(dir);
  assert.strictEqual(d.columns, 115); assert.match(d.columnsHow, /^docked pane: transcript column 120 cells .*10 rows.* - 5$/);
  const r = run(dir);
  assert.strictEqual(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === 'FAIL'))); assert.strictEqual(status(r, 'hygiene'), 'ABSENT');
  // without the dock rule the full 209 band would be expected: the narrow band FAILs on the window rule
  assert.strictEqual(run(capture(richFiles(), [RICH_120], { window_width: 209 })).ok, false);
  assert.strictEqual(derive(capture(richFiles(), pane, { window_width: 209, body_columns: 90 })).columns, 90);
  assert.strictEqual(derive(dir, { bodyColumns: 77 }).columns, 77);
  assert.strictEqual(cli(dir).lines.find((l) => l.startsWith('width:')).includes('docked pane'), true);
});
test('DOCK: fewer than six border rows, or a border left of cell 20, is not a dock', () => {
  assert.match(derive(capture(richFiles(), dockedPane(RICH_209, 120, 4), { window_width: 209 })).columnsHow, /^meta\.window_width/);
  assert.match(derive(capture(richFiles(), dockedPane(RICH_209, 10, 12), { window_width: 209 })).columnsHow, /^meta\.window_width/);
});

// ---- P7 gate fixes (first real-machine batch): captures copied from gate/runs into gate/fixtures
const FIX = path.join(__dirname, 'fixtures');
// a scratch copy of a fixture, optionally without the driver's body_columns key (so the dock detector decides)
function fixture(name, dropBodyColumns) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatefix-'));
  for (const f of fs.readdirSync(path.join(FIX, name))) fs.copyFileSync(path.join(FIX, name, f), path.join(dir, f));
  if (dropBodyColumns) { const m = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); delete m.body_columns; delete m.body_columns_note; fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m)); }
  return dir;
}
test('GATEFIX question dialog at 80 columns (real capture): no band, no panel -> surface dialog judged from attention.json', () => {
  const r = run(fixture('ask-w80'));
  assert.strictEqual(r.surface, 'dialog'); assert.strictEqual(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === 'FAIL')));
  assert.strictEqual(status(r, 'verdict'), 'PASS');
  // the dialog is judged against attention.json: an idle attention file under the same question dialog still FAILs
  const dir = fixture('ask-w80'); fs.writeFileSync(path.join(dir, 'attention.json'), JSON.stringify({ kind: 'idle', summary: 'x' }));
  assert.strictEqual(run(dir).ok, false);
});
test('GATEFIX reason is cut by DISPLAY width with a trailing ellipsis (real capture w120): a display-width prefix of label + summary passes', () => {
  const r = run(fixture('perm-w120'));
  assert.strictEqual(r.surface, 'panel'); assert.strictEqual(status(r, 'reason'), 'PASS', JSON.stringify(r.results.filter((x) => x.status === 'FAIL')));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(status(run(fixture('perm-w209')), 'reason'), 'PASS');
  // a wrong drawn reason, an uncut one that is not the full text, and a bare label still FAIL
  const bad = (drawn) => { const d = fixture('perm-w120'); const p = path.join(d, 'pane.txt'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('等你批准：Bash: printf \'\\n測試字：這是一行測試文…').join(drawn)); return status(run(d), 'reason'); };
  assert.strictEqual(bad('等你批准：Bash: rm -rf /…'), 'FAIL');
  assert.strictEqual(bad('等你批准：Bash: printf'), 'FAIL');
  assert.strictEqual(bad('等你批准：…'), 'FAIL');
});
test('GATEFIX dock detector: the boxed 80-column panel is not a dock (bodyColumns 75); the 209 dock is still found at cell 119; w120 at 70', () => {
  const d80 = derive(fixture('idle-w80', true));
  assert.strictEqual(d80.columns, 75); assert.match(d80.columnsHow, /^meta\.window_width 80/);
  assert.strictEqual(derive(fixture('perm-w80', true)).columns, 75);
  assert.strictEqual(derive(fixture('perm-w209', true)).columns, 114); assert.match(derive(fixture('perm-w209', true)).columnsHow, /transcript column 119 cells/);
  assert.strictEqual(derive(fixture('perm-w120', true)).columns, 65);
  assert.strictEqual(require('./check.js').dockOf(fs.readFileSync(path.join(FIX, 'idle-w80', 'pane.txt'), 'utf8')), null);
});
test('GATEFIX no scope (real l4-idle capture, run ended with session-mode clear): no marker and no envelope -> the bare verdict band or the no-project line passes, anything else FAILs', () => {
  const r = run(fixture('l4-idle-w120'));
  assert.strictEqual(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === 'FAIL'))); assert.strictEqual(status(r, 'no-scope'), 'PASS');
  const withBand = (band) => { const d = fixture('l4-idle-w120'); const p = path.join(d, 'pane.txt'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('◌ 待命 │ ⓘ').join(band)); return run(d); };
  assert.strictEqual(withBand('no project · run: autopilot status runs --watch │ ⓘ').ok, true);
  assert.strictEqual(withBand('● 進行中 │ ⓘ').ok, false); // the derived verdict is 待命
  assert.strictEqual(withBand('◌ 待命 │ ⚙1 │ ⓘ').ok, false); // no facts back a slot
});
