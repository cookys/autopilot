'use strict';

// gate/check.test.js — unit tests of check.js on hand-made capture dirs (node --test gate/check.test.js).
// TUI v2 (2026-10-10): the band grammar is groups joined by ` │ ` (the dispatch count and the review round / QC chip share one group), the wide band
// carries the stage walk, a 10-cell spend bar and the verdict's reason, `⚑N` replaces `wt N`, and every word comes in two locales (zh-TW, en). The cases
// below are written against the contract's width table (>= 160 / 120-159 / 80-119 / < 80), not against the mod.
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
  'residue.json': { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 2, by_class: { 'clean-integrated': 1, 'missing-dir': 1, other: 4 }, needs_human_count: 2, needs_human: [] },
  'stage.json': { schema: 'autopilot.stage-walk/1', sid: SID, walk: ['spec', 'plan', 'implement', 'verify', 'finish'], nodes: ['spec', 'plan', 'implement', 'verify', 'finish'], current: 'implement' },
  ...(over || {}),
});
// the rich world draws a 要你決定-less 疑似卡住 (one stalled run, no age published), so the wide band carries the reason `有 1 個派工疑似沒有輸出`
const RICH_209 = '⏸ 疑似卡住 有 1 個派工疑似沒有輸出 │ M!·l5 ●─●─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 ⟲R2 QC✓ │ ◆3 ?1 U2 │ $123 ▰▰▰▰▰▰▰▰▱▱ 82% │ dev↓3 ⚑2 │ ⓘ';
const RICH_209_NR = RICH_209.replace(' 有 1 個派工疑似沒有輸出', ''); // the same line without the reason phrase (what a line too tight for it looks like)
const RICH_MID = '⏸ 疑似卡住 │ M!·l5 ▸ implement │ ▰▰▰▱▱ 3/5 │ ⚙2 ⏸1 ⟲R2 QC✓ │ $123 ▰▰▰▰▱ │ ⚑2 │ ⓘ'; // 120-159
const RICH_120 = '⏸ 疑似卡住 │ ▰▰▰▱▱ │ ⚙2 ⏸1 QC✓ │ $▰▰▱ │ ⚑2 │ ⓘ'; // 80-119: no position, no k/N, no round, no amount; `⚑N` (the owner reminder) stays
const RICH_80 = '⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⚑2 │ ⓘ'; // < 80: verdict, dispatch, ⚑N
const rich = (line, width, over) => capture(richFiles(over), [line], { window_width: width });

// ---- the band at four tiers, rich facts
test('RICH 209: every slot is judged PASS, the summary is PASS <mode> fields=11 (the reason phrase is the 11th)', () => {
  const r = run(rich(RICH_209, 209));
  for (const n of ['verdict', 'position', 'unit', 'dispatch', 'review', 'decisions', 'spend', 'hygiene', 'reason', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.fields, 11);
  assert.strictEqual(summary(r), 'PASS l5 fields=11');
  assert.strictEqual(r.derived.columns, 204);
});
test('RICH 130 (bodyColumns 125, 120-159): no walk, age, families, decisions, chip, percent or reason; `▸ stage`, k/N, ⟲R QC, 5-cell bar, ⚑N', () => {
  const r = run(rich(RICH_MID, 130));
  assert.strictEqual(status(r, 'decisions'), 'ABSENT'); assert.strictEqual(status(r, 'reason'), undefined);
  for (const n of ['verdict', 'position', 'unit', 'dispatch', 'review', 'spend', 'hygiene', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.derived.columns, 125); assert.strictEqual(r.ok, true);
});
test('RICH 120 (bodyColumns 115, 80-119): no position, no k/N, no round, no amount, no decisions; the bars, QC, `⚑N` stay', () => {
  const r = run(rich(RICH_120, 120));
  for (const n of ['position', 'decisions']) assert.strictEqual(status(r, n), 'ABSENT', n);
  for (const n of ['verdict', 'unit', 'dispatch', 'review', 'spend', 'hygiene', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.results.find((x) => x.name === 'hygiene').expected, '⚑2');
  assert.strictEqual(r.results.find((x) => x.name === 'review').expected, 'QC✓');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.derived.columns, 115);
});
test('RICH 80 (bodyColumns 75, < 80): only verdict, dispatch, `⚑N` and ⓘ', () => {
  const r = run(rich(RICH_80, 80));
  for (const n of ['position', 'unit', 'review', 'spend', 'decisions']) assert.strictEqual(status(r, n), 'ABSENT', n);
  for (const n of ['verdict', 'dispatch', 'hygiene', 'ⓘ', 'layout']) assert.strictEqual(status(r, n), 'PASS', n);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(summary(r), 'PASS l5 fields=10');
});
test('RICH 120: a k/N, a round or an amount left on the small band FAILs its slot', () => {
  assert.strictEqual(status(run(rich(RICH_120.replace('▰▰▰▱▱', '▰▰▰▱▱ 3/5'), 120)), 'unit'), 'FAIL');
  assert.strictEqual(status(run(rich(RICH_120.replace('QC✓', '⟲R2 QC✓'), 120)), 'review'), 'FAIL');
  assert.strictEqual(status(run(rich(RICH_120.replace('$▰▰▱', '$123 ▰▰▱'), 120)), 'spend'), 'FAIL');
});

// ---- the English table: the same rich world, words in en
const RICH_209_EN = '⏸ Stalled 1 dispatch looks silent │ M!·l5 ●─●─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2fam │ ⚙2 ⏸1 ⟲R2 QC✓ │ ◆3 ?1 U2 │ $123 ▰▰▰▰▰▰▰▰▱▱ 82% │ dev↓3 ⚑2 │ ⓘ';
const RICH_MID_EN = '⏸ Stalled │ M!·l5 ▸ implement │ ▰▰▰▱▱ 3/5 │ ⚙2 ⏸1 ⟲R2 QC✓ │ $123 ▰▰▰▰▱ │ ⚑2 │ ⓘ';
test('EN 209: the verdict word, the reason phrase and the `fam` word come from the en table; the locale follows the drawn verdict word', () => {
  const r = run(rich(RICH_209_EN, 209));
  assert.strictEqual(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === 'FAIL')));
  assert.strictEqual(r.derived.locale, 'en'); assert.strictEqual(r.derived.verdict, 'Stalled');
  assert.strictEqual(status(r, 'reason'), 'PASS'); assert.strictEqual(r.fields, 11);
  assert.strictEqual(r.derived.reasonSlot.known.full, '1 dispatch looks silent'); // plural: one dispatch
  // an en capture judged as zh-TW (forced) FAILs: the words differ
  assert.strictEqual(run(rich(RICH_209_EN, 209), { locale: 'zh-TW' }).ok, false);
  // meta.locale decides when the band cannot (a bare glyph band)
  assert.strictEqual(derive(capture(richFiles(), [], { locale: 'en' })).verdict, 'Stalled');
});
test('EN 130: the mid tier in en', () => {
  assert.strictEqual(run(rich(RICH_MID_EN, 130)).ok, true);
});
test('EN verdict words: Needs you / Stalled / Awaiting acceptance / Running / Idle, each found by findBand with its locale', () => {
  for (const [mark, word, kind] of [['▲', 'Needs you', 'decide'], ['⏸', 'Stalled', 'stalled'], ['✓', 'Awaiting acceptance', 'waiting'], ['●', 'Running', 'running'], ['◌', 'Idle', 'idle']]) {
    const b = findBand(`x\n${mark} ${word} │ ⓘ`);
    assert.strictEqual(b.verdict, word); assert.strictEqual(b.locale, 'en'); assert.strictEqual(b.kind, kind);
  }
  assert.strictEqual(findBand('▲ 要你決定 │ ⓘ').locale, 'zh-TW');
  assert.strictEqual(findBand('we were Running earlier in the log'), null);
});
// a reason as the band draws it: the longest prefix of `text` within `n` cells, ending in `…` when it was cut
const clip = (text, n) => { if (displayWidth(text) <= n) return text; let out = ''; let w = 0; for (const ch of text) { const cw = displayWidth(ch); if (w + cw > n - 1) break; out += ch; w += cw; } return `${out}…`; };
test('EN reason phrase: the attention summary with the en wait suffix, a clipped prefix, and the wide-only rule', () => {
  const short = { 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'ls', since: iso(5) } };
  assert.strictEqual(status(run(capture(short, ['▲ Needs you waiting for your approval: ls (waited 5 min) │ ⓘ'])), 'reason'), 'PASS');
  const long = { 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: rm -rf build', since: iso(5) } };
  const clipped = clip('waiting for your approval: Bash: rm -rf build (waited 5 min)', 48);
  assert.strictEqual(displayWidth(clipped), 48);
  assert.strictEqual(status(run(capture(long, [`▲ Needs you ${clipped} │ ⓘ`])), 'reason'), 'PASS'); // clipped by cells
  assert.strictEqual(status(run(capture(long, ['▲ Needs you waiting for your approval: Bash: something else │ ⓘ'])), 'reason'), 'FAIL');
  assert.strictEqual(status(run(capture(long, ['▲ Needs you waiting for your approval: Bash: rm -rf build (waited 5 min) │ ⓘ'])), 'reason'), 'FAIL', 'wider than 48 cells: the band never draws it whole');
  assert.strictEqual(status(run(capture(long, ['▲ Needs you │ ⓘ'])), 'reason'), 'FAIL', 'wide and roomy: the reason must be drawn');
  // below 160 the reason must be absent, and a drawn one FAILs
  assert.strictEqual(status(run(capture(long, ['▲ Needs you │ ⓘ'], { body_columns: 150 })), 'reason'), undefined);
  assert.strictEqual(status(run(capture(long, [`▲ Needs you ${clipped} │ ⓘ`], { body_columns: 150 })), 'reason'), 'FAIL');
});
test('reason phrase: at most 48 cells (a wider one FAILs), a clipped one passes, and a decision file question is the reason too', () => {
  const att = { 'attention.json': { schema: 'autopilot.attention/1', kind: 'question', summary: '要不要把這個很長很長很長很長很長很長很長很長很長很長很長很長的 plan 拆開來分段做？', since: iso(1) } };
  const fullText = '等你回答：要不要把這個很長很長很長很長很長很長很長很長很長很長很長很長的 plan 拆開來分段做？（等了 1 分）';
  assert.strictEqual(status(run(capture(att, [`▲ 要你決定 ${fullText} │ ⓘ`])), 'reason'), 'FAIL'); // wider than 48 cells
  const clipped = clip(fullText, 48);
  assert.ok(displayWidth(clipped) <= 48);
  assert.strictEqual(status(run(capture(att, [`▲ 要你決定 ${clipped} │ ⓘ`])), 'reason'), 'PASS');
  const dec = { 'decision-file.json': { schema: 'autopilot.decision/1', question: '要不要強推 main？' } };
  assert.strictEqual(status(run(capture(dec, ['▲ 要你決定 要不要強推 main？ │ ⓘ'])), 'reason'), 'PASS');
  // the room rule: with the line already at the budget there is no room, so none is drawn and none is expected
  const d = derive(capture(att, [], { body_columns: 160 }));
  assert.strictEqual(d.reasonSlot.applies, true);
  assert.strictEqual(derive(capture(att, [], { body_columns: 159 })).reasonSlot.applies, false);
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
test('SPARSE 130 and 100 pass the same facts (the position is `▸ stage` at 130, gone below 120)', () => {
  assert.strictEqual(run(capture(SPARSE, ['◌ 待命 │ S ▸ plan │ ⓘ'], { window_width: 130 })).ok, true);
  const r100 = run(capture(SPARSE, ['◌ 待命 │ ⓘ'], { window_width: 100 }));
  assert.strictEqual(r100.ok, true); assert.strictEqual(status(r100, 'position'), 'ABSENT');
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
test('PLANTED RED walk: the diagram must show the current node where the marker says (`◐` at the wrong node FAILs; no walk file draws `▸ stage`)', () => {
  assert.deepStrictEqual(mutated({ 'stage.json': { schema: 'autopilot.stage-walk/1', walk: ['spec', 'plan', 'implement', 'verify', 'finish'], current: 'verify' } }, RICH_209.replace('●─●─◐─○─○', '●─●─●─◐─○')).failed, ['position']);
  const noWalk = mutated({ 'stage.json': null }, RICH_209.replace('●─●─◐─○─○', '▸'));
  assert.strictEqual(status(noWalk, 'position'), 'PASS'); // a missing walk file: the plain `▸ implement ◷3m` form
  assert.strictEqual(status(mutated({ 'stage.json': null }), 'position'), 'FAIL'); // ... and the diagram drawn without a walk file FAILs
  // a walk of 10 nodes is too long for the band: `▸ stage`
  const long = Array.from({ length: 10 }, (_x, i) => (i === 4 ? 'implement' : `n${i}`));
  assert.strictEqual(status(mutated({ 'stage.json': { schema: 'autopilot.stage-walk/1', walk: long, current: 'implement' } }, RICH_209.replace('●─●─◐─○─○', '▸')), 'position'), 'PASS');
  // the current stage is not on the walk: no diagram
  assert.strictEqual(status(mutated({ 'stage.json': { schema: 'autopilot.stage-walk/1', walk: ['a', 'b', 'c'], current: 'implement' } }, RICH_209.replace('●─●─◐─○─○', '▸')), 'position'), 'PASS');
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
  // the dispatch count shares its group with the review part: a review part drawn apart (its own ` │ `) is a second group
  assert.strictEqual(status(run(rich(RICH_209.replace('⚙2 ⏸1 ⟲R2 QC✓', '⚙2 ⏸1 │ ⟲R2 QC✓'), 209)), 'layout'), 'PASS', 'two segments classify fine; priority order is what is judged');
});
test('PLANTED RED review: another review round', () => {
  assert.deepStrictEqual(mutated({ 'review.json': { schema: 'autopilot.review/1', project_key: PK, code: { generation: 3 } } }).failed, ['review']);
});
test('PLANTED RED review QC chip: qc owed while the band says QC✓', () => {
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
test('spend bar cells and percent: round(ratio * cells) filled of 10, round(ratio * 100) %', () => {
  const sp = (brain, cap) => derive(capture(richFiles({ 'envelope.json': baseEnvelope({ runs: [{ alive: true, stall: true }], counts: { confirmed_live: 2 }, host_today_brain_usd: brain, brain_cap_usd: cap }) }), [], { body_columns: 209 })).slots.spend.text;
  assert.strictEqual(sp(60, 100), '$60 ▰▰▰▰▰▰▱▱▱▱ 60%');
  assert.strictEqual(sp(12, 100), '$12 ▰▱▱▱▱▱▱▱▱▱ 12%');
  assert.strictEqual(sp(160, 150), '$160 ▰▰▰▰▰▰▰▰▰▰ 107%'); // over the cap: the bar is full, the percent is honest
  assert.strictEqual(sp(0, 150), '$0 ▱▱▱▱▱▱▱▱▱▱ 0%');
});
test('PLANTED RED hygiene: a different needs_human_count in the residue fact', () => {
  assert.deepStrictEqual(mutated({ 'residue.json': { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 2, by_class: { 'clean-integrated': 1, 'missing-dir': 1 }, needs_human_count: 3, needs_human: [] } }).failed, ['hygiene']);
});
test('residue auto-reap R4: ⚑N is needs_human_count, never the reapable count (a band drawing ⚑<reapable> fails; no needs_human_count draws no ⚑)', () => {
  const hy = (res, line) => run(capture(richFiles({ 'residue.json': res }), [RICH_209.replace('dev↓3 ⚑2', line)]));
  const reapOnly = { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 5, by_class: { 'clean-integrated': 5 } };
  assert.strictEqual(status(hy(reapOnly, 'dev↓3 ⚑5'), 'hygiene'), 'FAIL');
  assert.strictEqual(status(hy(reapOnly, 'dev↓3'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy({ ...reapOnly, needs_human_count: 0, needs_human: [] }, 'dev↓3'), 'hygiene'), 'PASS');
});
test('PLANTED RED hygiene chip: behind upstream changed in load-source', () => {
  assert.deepStrictEqual(mutated({ 'load-source.json': { schema: 'autopilot.load-source/1', source: 'dev', behind_upstream: 5, flags: [] } }).failed, ['hygiene']);
});
test('PLANTED RED ⓘ: the band is drawn without the info button', () => {
  const r = run(rich(RICH_209.replace(' │ ⓘ', ''), 209));
  assert.strictEqual(status(r, 'ⓘ'), 'FAIL'); assert.strictEqual(r.ok, false);
});
test('residue.json whose needs_human list is longer than its count is a note', () => {
  const e = { kind: 'branch', branch: 'b', class: 'x', age_days: 1, bytes: null, reason: null, command: 'c' };
  const r = mutated({ 'residue.json': { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 2, by_class: {}, needs_human_count: 2, needs_human: [e, e, e] } });
  assert.ok(r.derived.notes.some((n) => n.includes('inconsistent')));
});
test('facts of another project or schema are not facts (a foreign residue / qc / review draws nothing)', () => {
  const r = mutated({ 'residue.json': { schema: 'autopilot.residue/1', project_key: 'other', reapable_worktrees: 2 }, 'qc.json': { schema: 'autopilot.qc-status/1', scope: { project_key: 'other' }, state: 'ok' } },
    '⏸ 疑似卡住 有 1 個派工疑似沒有輸出 │ M!·l5 ●─●─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 ⟲R2 │ ◆3 ?1 U2 │ $123 ▰▰▰▰▰▰▰▰▱▱ 82% │ dev↓3 │ ⓘ');
  assert.strictEqual(r.ok, true);
});

// ---- spend / hygiene / unit specifics
test('spend is empty when the brain spend is not published', () => {
  const files = richFiles({ 'envelope.json': baseEnvelope({ runs: [{ alive: true, stall: false }, { alive: true, stall: true }], counts: { confirmed_live: 2 } }) });
  const r = run(capture(files, ['⏸ 疑似卡住 有 1 個派工疑似沒有輸出 │ M!·l5 ●─●─◐─○─○ implement ◷3m │ ▰▰▰▱▱ 3/5 ·2族 │ ⚙2 ⏸1 ⟲R2 QC✓ │ ◆3 ?1 U2 │ dev↓3 ⚑2 │ ⓘ']));
  assert.strictEqual(status(r, 'spend'), 'ABSENT'); assert.strictEqual(r.ok, true);
});
test('hygiene chip forms: cache copy, unknown source, marketplace warning, no chip but wt', () => {
  const hy = (ls, res, line) => run(capture(richFiles({ 'load-source.json': ls, 'residue.json': res }), [RICH_209.replace('dev↓3 ⚑2', line)]));
  const noRes = { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 0, by_class: {}, needs_human_count: 0 };
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'cache:2.36.36', flags: [] }, noRes, 'cache 2.36.36 ⚠'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'unknown', flags: [] }, noRes, 'src ? ⚠'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'dev', flags: ['marketplace_not_this_repo'] }, noRes, 'dev ⚠'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy(null, { schema: 'autopilot.residue/1', project_key: PK, reapable_worktrees: 0, by_class: {}, needs_human_count: 4 }, '⚑4'), 'hygiene'), 'PASS');
  assert.strictEqual(status(hy({ schema: 'autopilot.load-source/1', source: 'dev', flags: [] }, noRes, 'dev'), 'hygiene'), 'PASS');
});
test('the behind-upstream arrow follows the chip name without a space (`dev↓3`, never `dev ↓3`)', () => {
  assert.strictEqual(status(run(rich(RICH_209.replace('dev↓3', 'dev ↓3'), 209)), 'hygiene'), 'FAIL');
  assert.strictEqual(derive(capture(richFiles(), [], { body_columns: 209 })).slots.hygiene.text, 'dev↓3 ⚑2');
});
test('unit bar scales to 10 cells when N > 10, and 5/20 puts the current cell at ceil(5*10/20)=3', () => {
  const files = { 'marker.json': richMarker({ stage: undefined, unit: { kind: 'deliverable', index: 5, total: 20, label: 'x' }, review_families: [] }), 'envelope.json': baseEnvelope() };
  const r = run(capture(files, ['◌ 待命 │ ▰▰▰▱▱▱▱▱▱▱ 5/20 │ ⓘ']));
  assert.strictEqual(status(r, 'unit'), 'PASS');
  assert.strictEqual(status(run(capture(files, ['◌ 待命 │ ▰▰▰▰▱▱▱▱▱▱ 5/20 │ ⓘ'])), 'unit'), 'FAIL');
});
test('a long stage name is cut with … exactly as far as needed (never below 2 cells); an uncut or wrongly cut stage FAILs', () => {
  const long = 'x'.repeat(220);
  const files = richFiles({ 'marker.json': richMarker({ stage: long }), 'stage.json': { schema: 'autopilot.stage-walk/1', walk: ['spec', 'plan', long, 'verify', 'finish'], current: long } });
  // expected cut, worked out by hand: the line with the 9-cell stage `implement` is W cells; 204 columns (209 - 5) are available
  const stageW = 204 - (displayWidth(RICH_209_NR) - displayWidth('implement'));
  const exact = `${'x'.repeat(stageW - 1)}…`;
  const r = run(capture(files, [RICH_209_NR.replace('implement', exact)])); // a line this tight has no room for the reason phrase
  assert.ok(r.derived.over > 0); assert.strictEqual(status(r, 'position'), 'PASS'); assert.strictEqual(status(r, 'layout'), 'PASS');
  assert.strictEqual(displayWidth(RICH_209_NR.replace('implement', exact)), 204);
  for (const bad of [`${'x'.repeat(40)}…`, 'x…', '…', `${'x'.repeat(stageW)}…`]) {
    assert.strictEqual(status(run(capture(files, [RICH_209_NR.replace('implement', bad)])), 'position'), 'FAIL', `stage "${bad.slice(0, 12)}…" must FAIL`);
  }
  const uncut = run(capture(files, [RICH_209_NR.replace('implement', long)]));
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
  const swapped = '⏸ 疑似卡住 有 1 個派工疑似沒有輸出 │ ▰▰▰▱▱ 3/5 ·2族 │ M!·l5 ●─●─◐─○─○ implement ◷3m │ ⚙2 ⏸1 ⟲R2 QC✓ │ ◆3 ?1 U2 │ $123 ▰▰▰▰▰▰▰▰▱▱ 82% │ dev↓3 ⚑2 │ ⓘ';
  const o = layout(swapped); assert.strictEqual(o.status, 'FAIL'); assert.match(o.detail, /out of priority order/);
  const dup = RICH_209.replace(' │ ⚙2 ⏸1 ⟲R2 QC✓ │', ' │ ⚙2 ⏸1 ⟲R2 QC✓ │ ⚙2 ⏸1 │');
  const d = layout(dup); assert.strictEqual(d.status, 'FAIL'); assert.match(d.detail, /second dispatch/);
});
test('GATEFIX classify: the verdict below 2 cells is the glyph alone or glyph + …', () => {
  assert.strictEqual(classify('●', 0), 'verdict'); assert.strictEqual(classify('●…', 0), 'verdict'); assert.strictEqual(classify('● 進行…', 0), 'verdict');
  assert.strictEqual(classify('x…', 0), null);
  assert.strictEqual(classify('▲ Needs you pick adapter A or B', 0), 'verdict'); // the reason phrase rides on the verdict segment
});

// ---- the width-table ABSENT rule
test('WIDTH TABLE: a part the table removed at this width is FAIL if drawn (the chip < 160, decisions < 160, position < 120, round < 120, k/N < 120, spend < 80)', () => {
  const at = (line, bodyColumns) => run(capture(richFiles(), [line], { body_columns: bodyColumns }));
  assert.strictEqual(status(at(RICH_209_NR, 159), 'hygiene'), 'FAIL', 'the chip < 160 (only `⚑N` may be drawn)');
  assert.strictEqual(status(at(RICH_MID, 159), 'hygiene'), 'PASS', '`⚑N` alone survives < 160');
  assert.strictEqual(status(at(RICH_80, 79), 'hygiene'), 'PASS', '`⚑N` survives < 80 (the owner reminder is never dropped)');
  assert.strictEqual(status(at(RICH_209_NR, 159), 'decisions'), 'FAIL', 'decisions < 160');
  assert.strictEqual(status(at(RICH_MID, 119), 'position'), 'FAIL', 'position < 120');
  assert.strictEqual(status(at(RICH_MID, 119), 'review'), 'FAIL', 'the round < 120 (QC stays)');
  assert.strictEqual(status(at(RICH_120, 119), 'review'), 'PASS', 'QC alone at 80-119');
  assert.strictEqual(status(at(RICH_120, 79), 'spend'), 'FAIL', 'spend < 80');
  assert.strictEqual(status(at(RICH_120, 79), 'unit'), 'FAIL', 'the unit bar < 80');
  assert.strictEqual(status(at(RICH_120, 79), 'review'), 'FAIL', 'QC < 80');
});
test('WIDTH TABLE: exact thresholds — all at 160, no chip/decisions/walk at 159, no position/round/k-n at 119, no unit/review/spend at 79', () => {
  const rows = (b) => derive(capture(richFiles(), [], { body_columns: b })).slots;
  assert.strictEqual(rows(160).hygiene.text, 'dev↓3 ⚑2'); assert.strictEqual(rows(159).hygiene.text, '⚑2'); assert.strictEqual(rows(80).hygiene.text, '⚑2'); assert.strictEqual(rows(79).hygiene.text, '⚑2'); assert.strictEqual(rows(30).hygiene.state, 'present');
  assert.strictEqual(rows(160).decisions.state, 'present'); assert.strictEqual(rows(159).decisions.state, 'width');
  assert.strictEqual(rows(160).spend.text, '$123 ▰▰▰▰▰▰▰▰▱▱ 82%'); assert.strictEqual(rows(159).spend.text, '$123 ▰▰▰▰▱'); assert.strictEqual(rows(120).spend.text, '$123 ▰▰▰▰▱');
  assert.strictEqual(rows(119).spend.text, '$▰▰▱'); assert.strictEqual(rows(80).spend.text, '$▰▰▱'); assert.strictEqual(rows(79).spend.state, 'width');
  assert.strictEqual(rows(120).review.text, '⟲R2 QC✓'); assert.strictEqual(rows(119).review.text, 'QC✓'); assert.strictEqual(rows(80).review.text, 'QC✓'); assert.strictEqual(rows(79).review.state, 'width');
  assert.strictEqual(rows(160).position.text, 'M!·l5 ●─●─◐─○─○ implement ◷3m'); assert.strictEqual(rows(159).position.text, 'M!·l5 ▸ implement'); assert.strictEqual(rows(120).position.state, 'present'); assert.strictEqual(rows(119).position.state, 'width');
  assert.strictEqual(rows(160).unit.text, '▰▰▰▱▱ 3/5 ·2族'); assert.strictEqual(rows(159).unit.text, '▰▰▰▱▱ 3/5'); assert.strictEqual(rows(120).unit.text, '▰▰▰▱▱ 3/5'); assert.strictEqual(rows(119).unit.text, '▰▰▰▱▱');
  assert.strictEqual(rows(80).unit.text, '▰▰▰▱▱'); assert.strictEqual(rows(79).unit.state, 'width');
  assert.strictEqual(rows(30).dispatch.state, 'present');
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
test('NON-OK in zh-TW: the state texts come from the zh table; a residue reminder is `⚑N`', () => {
  const files = { 'envelope.json': null };
  assert.strictEqual(run(capture(files, ['沒有專案 · 請執行：autopilot status runs --watch │ ⓘ'])).ok, true);
  assert.strictEqual(run(capture(files, ['沒有專案 · ⚑3 · 請執行：autopilot status runs --watch │ ⓘ'])).ok, true);
  assert.strictEqual(run(capture(files, ['no project · ⚑3 · run: autopilot status runs --watch │ ⓘ'])).ok, true);
  assert.strictEqual(status(run(capture({ 'envelope.json': baseEnvelope({ published_at: iso(10) }) }, ['資料過舊 · 上次發佈 18:00 · 請執行：autopilot status runs --watch │ ⓘ'])), 'nonok'), 'PASS');
});
test('GATEFIX NON-OK: content after the ⓘ on the non-ok line FAILs; the [-] toggle does not', () => {
  const files = { 'envelope.json': null };
  assert.strictEqual(status(run(capture(files, ['no project · run: x │ ⓘ      [-]'])), 'nonok'), 'PASS');
  assert.strictEqual(status(run(capture(files, ['no project · run: x │ ⓘ │ garbage'])), 'nonok'), 'FAIL');
  assert.strictEqual(status(run(capture(files, ['no project · run: x │ ⓘ garbage'])), 'nonok'), 'FAIL');
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
  assert.strictEqual(pass.lines[pass.lines.length - 1], 'PASS l5 fields=11'); assert.strictEqual(pass.code, 0);
  assert.ok(pass.lines.some((l) => /^PASS spend expected \$123 ▰▰▰▰▰▰▰▰▱▱ 82% got \$123 ▰▰▰▰▰▰▰▰▱▱ 82% \[.+\]$/.test(l)));
  assert.ok(pass.lines.some((l) => /^surface: band$/.test(l)));
  assert.ok(pass.lines.some((l) => /^width: bodyColumns=204 \[.*window_width 209 - 5.*\]$/.test(l)));
  const fail = cli(rich(RICH_209.replace('$123 ▰▰▰▰▰▰▰▰▱▱ 82%', '$99 ▰▰▰▰▰▰▱▱▱▱ 66%').replace('3/5', '4/5'), 209));
  assert.strictEqual(fail.lines[fail.lines.length - 1], 'FAIL l5 fields=11 failed=unit,spend'); assert.strictEqual(fail.code, 1);
  assert.ok(fail.lines.some((l) => /^FAIL spend expected \$123 ▰▰▰▰▰▰▰▰▱▱ 82% got \$99 ▰▰▰▰▰▰▱▱▱▱ 66% /.test(l)));
  const absent = cli(rich(RICH_120, 120));
  assert.ok(absent.lines.some((l) => /^ABSENT position expected absent \(removed by the width table \(bodyColumns 115 < 120\)\) got absent /.test(l)));
  const lowest = cli(rich(RICH_80, 80));
  assert.ok(lowest.lines.some((l) => /^ABSENT spend expected absent \(removed by the width table \(bodyColumns 75 < 80\)\) got absent /.test(l)));
  assert.ok(cli(rich(RICH_209_EN, 209), ['--locale', 'en']).lines.some((l) => /^PASS verdict expected ⏸ Stalled got ⏸ Stalled /.test(l)));
  assert.strictEqual(cli('/nonexistent/dir').code, 2);
  assert.strictEqual(cli(rich(RICH_209, 209), ['--body-columns', 'x']).code, 2);
});
test('SUMMARY: the mode comes from meta.mode, else the cell prefix; --json carries the same summary', () => {
  assert.strictEqual(cli(capture(SPARSE, ['◌ 待命 │ S ▸ plan ◷10m │ ⓘ'], { mode: 'dev-flow' })).lines.pop(), 'PASS dev-flow fields=10');
  assert.strictEqual(cli(capture(SPARSE, ['◌ 待命 │ S ▸ plan ◷10m │ ⓘ'], { mode: undefined, cell: 'l6-idle' })).lines.pop(), 'PASS l6 fields=10');
  const j = JSON.parse(cli(rich(RICH_209, 209), ['--json']).stdout);
  assert.strictEqual(j.summary, 'PASS l5 fields=11'); assert.strictEqual(j.body_columns, 204);
});

// ---- pane reading
test('findBand takes the last band line up to ⓘ; a docked pane to its right is not part of it; a transcript mention is not a band', () => {
  const b = findBand('x\n● 進行中 │ ⚙1 │ ⓘ      │ pane text\n> ');
  assert.strictEqual(b.verdict, '進行中'); assert.strictEqual(b.text, '● 進行中 │ ⚙1 │ ⓘ');
  assert.strictEqual(findBand('we saw ● 進行中 earlier in the log'), null);
  assert.strictEqual(findBand('nothing here'), null);
  assert.strictEqual(findNonOk('no project │ ⓘ').lineKind, 'nonok');
  assert.strictEqual(classify('⟲R3 QC✓', 3), 'review'); assert.strictEqual(classify('⚙2 ⏸1 ⟲R3 QC▲', 3), 'dispatch'); assert.strictEqual(classify('$▰▰▱', 5), 'spend'); assert.strictEqual(classify('⚑3', 6), 'hygiene'); assert.strictEqual(classify('garbage', 3), null);
});

// ---- verdict precedence (kept from W4), judged through the one-line band
test('要你決定 by an attention permission / question, or an open decision file even with an idle attention file', () => {
  const perm = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: rm -rf /tmp/x', since: iso(2) } }, ['▲ 要你決定 │ ⓘ']);
  assert.strictEqual(status(run(perm), 'verdict'), 'PASS');
  assert.strictEqual(derive(capture({ 'attention.json': { kind: 'question', summary: 'which db?' } }, [])).verdict, '要你決定');
  assert.strictEqual(derive(capture({ 'decision-file.json': { schema: 'autopilot.decision/1', question: '要不要強推 main？' }, 'attention.json': { kind: 'idle', summary: 'waiting' } }, [])).verdict, '要你決定');
  assert.strictEqual(derive(capture({ 'attention.json': { kind: 'idle', summary: 'waiting' } }, [])).verdict, '待命');
});
test('疑似卡住 from an envelope run with stall:true; the quietest dispatch names itself in the wide-band reason', () => {
  const dir = capture({ 'envelope.json': baseEnvelope({ runs: [{ run_id: 'r', alive: true, stall: true, started_at: iso(30), last_event_age_s: 600 }, { run_id: 'q', alive: true, stall: true, last_event_age_s: 1800 }], counts: { confirmed_live: 2 } }) }, ['⏸ 疑似卡住 最久的派工 30m 沒有輸出 │ ⚙2 ⏸2 │ ⓘ']);
  const r2 = run(dir);
  assert.strictEqual(status(r2, 'reason'), 'PASS', JSON.stringify(r2.results)); assert.strictEqual(status(r2, 'dispatch'), 'PASS');
  assert.strictEqual(status(run(capture({ 'envelope.json': baseEnvelope({ runs: [{ run_id: 'r', alive: true, stall: true, last_event_age_s: 600 }], counts: { confirmed_live: 1 } }) }, ['⏸ 疑似卡住 最久的派工 30m 沒有輸出 │ ⚙1 ⏸1 │ ⓘ'])), 'reason'), 'FAIL', 'the age comes from the rows: 10 m, not 30');
});
test('疑似卡住 from an envelope run with stall:true (no age published: the count phrase)', () => {
  const dir = capture({ 'envelope.json': baseEnvelope({ runs: [{ run_id: 'r', alive: true, stall: true, started_at: iso(30) }], counts: { confirmed_live: 1 } }) }, ['⏸ 疑似卡住 有 1 個派工疑似沒有輸出 │ ⚙1 ⏸1 │ ⓘ']);
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
  const r = run(capture({ 'agents/f1.json': agentF('f1', 400) }, ['⏸ 疑似卡住 工頭 6 分沒有動作 │ ⏸1 │ ⓘ'])); // 400 s = 6 min: the foreman's own reason phrase
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

// ---- overflow fallback (contract section 2): unit bar, then ⏸ count, then ⚙ count, then the verdict word; `⚑N` and ⓘ stay; expected lines = mods/live/live.test.ts "P7 fix B"
const FALLBACK = [
  [40, '⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⚑2 │ ⓘ'], [27, '⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⚑2 │ ⓘ'], [26, '⏸ 疑似卡住 │ ⚙2 │ ⚑2 │ ⓘ'], [24, '⏸ 疑似卡住 │ ⚙2 │ ⚑2 │ ⓘ'],
  [23, '⏸ 疑似卡住 │ ⚑2 │ ⓘ'], [19, '⏸ 疑似卡住 │ ⚑2 │ ⓘ'], [18, '⏸ 疑似卡… │ ⚑2 │ ⓘ'], [12, '⏸ … │ ⚑2 │ ⓘ'],
];
for (const [cols, line] of FALLBACK) {
  test(`FALLBACK bodyColumns ${cols}: ${line}`, () => {
    const r = run(capture(richFiles(), [line], { body_columns: cols }));
    assert.strictEqual(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === 'FAIL')));
    assert.ok(displayWidth(line) <= cols);
    assert.strictEqual(status(r, 'layout'), 'PASS');
  });
}
test('FALLBACK: the steps are judged in order — the ⏸ count still drawn at 26, the ⚙ count at 23, a full verdict word at 18 all FAIL', () => {
  const bad = (cols, line, slot) => assert.strictEqual(status(run(capture(richFiles(), [line], { body_columns: cols })), slot), 'FAIL', `${cols} ${slot}`);
  bad(26, '⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⚑2 │ ⓘ', 'layout');
  bad(26, '⏸ 疑似卡住 │ ⚙2 ⏸1 │ ⚑2 │ ⓘ', 'dispatch');
  bad(23, '⏸ 疑似卡住 │ ⚙2 │ ⚑2 │ ⓘ', 'dispatch');
  bad(18, '⏸ 疑似卡住 │ ⚑2 │ ⓘ', 'layout');
  bad(18, '⏸ 疑似卡住 │ ⚑2 │ ⓘ', 'verdict');
  // the fallback is not an excuse when the line fits: at 27 the dispatch part stays whole
  assert.strictEqual(status(run(capture(richFiles(), ['⏸ 疑似卡住 │ ⚙2 │ ⚑2 │ ⓘ'], { body_columns: 27 })), 'dispatch'), 'FAIL');
  // the glyph, `⚑N` and ⓘ are never removed
  assert.strictEqual(run(capture(richFiles(), ['⏸ … │ ⚑2'], { body_columns: 12 })).ok, false);
  assert.strictEqual(status(run(capture(richFiles(), ['⏸ … │ ⓘ'], { body_columns: 12 })), 'hygiene'), 'FAIL');
});
test('FALLBACK: the stage is cut first (never below 2 cells), then the fallback; findBand reads a shortened verdict', () => {
  assert.strictEqual(findBand('x\n⏸ 疑似… │ ⓘ').verdict, '疑似卡住');
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
  assert.strictEqual(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === 'FAIL'))); assert.strictEqual(status(r, 'hygiene'), 'PASS'); // docked: the chip goes, `⚑2` stays
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
  // the replacement keeps the dock border where it was (the spaces after the ⓘ absorb the width change), so the tail is judged on its own merit
  const withBand = (band) => { const d = fixture('l4-idle-w120'); const p = path.join(d, 'pane.txt'); const old = '◌ 待命 │ ⓘ'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(new RegExp(old + '( +)'), (_m, sp) => band + ' '.repeat(Math.max(1, sp.length - (displayWidth(band) - displayWidth(old)))))); return run(d); };
  assert.strictEqual(withBand('no project · run: autopilot status runs --watch │ ⓘ').ok, true);
  assert.strictEqual(withBand('● 進行中 │ ⓘ').ok, false); // the derived verdict is 待命
  assert.strictEqual(withBand('◌ 待命 │ ⚙1 │ ⓘ').ok, false); // no facts back a slot
  // the tail after the ⓘ is judged on this path too: the engine's [-] toggle passes, anything else FAILs
  assert.strictEqual(withBand('◌ 待命 │ ⓘ').ok, true); // the real capture: spaces, the [-] toggle, the dock border
  assert.strictEqual(withBand('◌ 待命 │ ⓘ garbage').ok, false);
  assert.strictEqual(withBand('no project · run: autopilot status runs --watch │ ⓘ │ garbage').ok, false);
  assert.strictEqual(status(withBand('◌ 待命 │ ⓘ garbage'), 'no-scope'), 'FAIL');
});

// widths.sh with a stub tmux and a stub capture.sh that writes TWO lines (the second after the first was read): under pipefail a
// `| head -n 1` made capture.sh die of SIGPIPE and the good capture was reported as failed. Takes ~6 s (the sweep's minimum redraw wait).
test('GATEFIX widths.sh: a capture.sh that writes after its first line is a good capture (no SIGPIPE under pipefail)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatew-'));
  fs.copyFileSync(path.join(__dirname, 'widths.sh'), path.join(dir, 'widths.sh'));
  const sh = (n, body) => { fs.writeFileSync(path.join(dir, n), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 }); };
  fs.mkdirSync(path.join(dir, 'cap'));
  sh('capture.sh', `echo "${dir}/cap"; sleep 0.5; echo "second line"`);
  sh('screenshot.sh', 'exit 0');
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'tmux'), `#!/usr/bin/env bash
case "$1" in
  display) cat "${dir}/w" 2>/dev/null || echo 100 ;;
  resize-window) while [ $# -gt 0 ]; do [ "$1" = -x ] && echo "$2" > "${dir}/w"; shift; done ;;
esac
exit 0
`, { mode: 0o755 });
  const p = spawnSync('bash', [path.join(dir, 'widths.sh'), 'cell', 'target'], { encoding: 'utf8', env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, GATE_WIDTHS: '100', GATE_REDRAW_S: '6' } });
  assert.strictEqual(p.status, 0, p.stderr);
  assert.strictEqual(p.stdout.trim(), `100 ${dir}/cap`);
});

// capture.sh settle loop: the band lags the facts by up to one poll, so a capture that check.js FAILs is repeated (pane first, facts after) within a
// bounded budget. Stub tmux + a stub checker that FAILs N times, then PASSes; the superseded captures are removed, the last is kept either way.
function settleRun(failTimes, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  fs.copyFileSync(path.join(__dirname, 'capture.sh'), path.join(dir, 'capture.sh'));
  fs.mkdirSync(path.join(dir, 'bin')); fs.mkdirSync(path.join(dir, 'home'));
  fs.writeFileSync(path.join(dir, 'bin', 'tmux'), '#!/usr/bin/env bash\ncase "$1" in\n  capture-pane) echo "◌ 待命 │ ⓘ" ;;\n  display) echo "100 100" ;;\nesac\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'checker.sh'), `#!/usr/bin/env bash\nn=$(cat "${dir}/calls" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/calls"\n[ $n -le ${failTimes} ] && exit 1\nexit 0\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: path.join(dir, 'home'), PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, GATE_OUT: path.join(dir, 'runs'), GATE_CHECK_CMD: path.join(dir, 'checker.sh'), GATE_SETTLE_STEP_S: '1', ...extraEnv };
  const p = spawnSync('bash', [path.join(dir, 'capture.sh'), 'cell', 'target'], { encoding: 'utf8', env });
  const caps = fs.existsSync(path.join(dir, 'runs', 'cell')) ? fs.readdirSync(path.join(dir, 'runs', 'cell')) : [];
  const calls = Number(fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8') : 0);
  const kept = caps.length === 1 ? JSON.parse(fs.readFileSync(path.join(dir, 'runs', 'cell', caps[0], 'meta.json'), 'utf8')) : null;
  return { p, caps, calls, kept };
}
test('GATEFIX capture.sh settle: a FAILing capture is repeated until the band catches up; only the passing capture is kept', () => {
  const r = settleRun(2, { GATE_BAND_WAIT_S: '30' });
  assert.strictEqual(r.p.status, 0, r.p.stderr);
  assert.strictEqual(r.calls, 3); assert.strictEqual(r.caps.length, 1);
  assert.strictEqual(r.kept.settle_attempt, 3);
  assert.strictEqual(r.p.stdout.split('\n')[0], path.join(path.dirname(r.p.stdout.split('\n')[0]), r.caps[0])); // first line = the kept capture dir (widths.sh reads it)
  assert.ok(!/did not settle/.test(r.p.stderr));
});
test('GATEFIX capture.sh settle: the wait is bounded; a band that never matches keeps the last capture and says so', () => {
  const r = settleRun(99, { GATE_BAND_WAIT_S: '4' });
  assert.strictEqual(r.p.status, 0, r.p.stderr);
  assert.ok(r.calls >= 2 && r.calls <= 4, `attempts ${r.calls}`); assert.strictEqual(r.caps.length, 1);
  assert.match(r.p.stderr, /band did not settle within 4s/);
});
test('GATEFIX capture.sh settle: GATE_BAND_WAIT_S=0 captures once and never runs the checker', () => {
  const r = settleRun(99, { GATE_BAND_WAIT_S: '0' });
  assert.strictEqual(r.p.status, 0, r.p.stderr); assert.strictEqual(r.calls, 0); assert.strictEqual(r.caps.length, 1);
  assert.strictEqual(r.kept.settle_attempt, 1);
});
test('GATEFIX capture.sh settle: a leading zero in the settle knobs is decimal (08 is not an invalid octal)', () => {
  const r = settleRun(99, { GATE_BAND_WAIT_S: '08', GATE_SETTLE_STEP_S: '09' });
  assert.strictEqual(r.p.status, 0, r.p.stderr); assert.strictEqual(r.calls, 1); assert.strictEqual(r.caps.length, 1);
  assert.match(r.p.stderr, /band did not settle within 8s/);
});
