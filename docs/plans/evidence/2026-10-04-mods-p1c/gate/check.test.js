'use strict';

// gate/check.test.js — unit tests of check.js on hand-made capture dirs (node --test gate/check.test.js).
// Each verdict word, 來源未接, frozen / unfrozen progress, the decisions line, elapsed, plus PLANTED-RED cases: a capture
// whose band shows the wrong verdict / progress / project must FAIL.
// GATEFIX (mods P1W): +8 tests (completion needs no live run, panel surface under a dialog, band preferred, planted reds). RED before the change: 31 tests, 23 pass / 8 fail; GREEN: 31 / 31.
// GATEFIX mutation controls (run-w/land/mut-check-*.txt): done-ignores-live, panel-never, panel-free-pass, band-not-preferred, panel-substring, each red then restored.
// Result before GATEFIX: 23 tests, 23 pass. Mutation controls (each breaks one rule in check.js, the suite goes red, restored):
// compare-always-pass 2 red, decision-ignored 1, stall-ignored 1, deleted-counted 1, idle-attention-decides 1,
// frozen-needs-digest 1 (after the unfrozen receipt case carried a count), notwired-always 2.

// TURN (mods P1W): +4 tests (an active turn is 進行中 with 回合進行中, ended / absent / stale = 待命, permission attention outranks, planted reds). Mutation controls: run-w/land/mut-turn-check-*.txt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, derive, findBand } = require('./check.js');

const NOW = Date.parse('2026-10-05T10:00:00.000Z');
const IDENT = 'git-common-dir:/home/u/projects/demo/.git';
const SID = 'sess-1';
const ROOT = 'job-1';
const iso = (offMin) => new Date(NOW - offMin * 60000).toISOString();

function capture(files, bandLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatechk-'));
  const w = (n, v) => { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), typeof v === 'string' ? v : JSON.stringify(v)); };
  w('meta.json', { cell: 't', sid: SID, project_key: 'abcdef0123456789', root_run_id: ROOT, captured_at: new Date(NOW).toISOString(), captured_at_ms: NOW });
  w('marker.json', { session_id: SID, level: null, repo_identity: IDENT, project_key: 'abcdef0123456789', root_run_id: ROOT, started_at: iso(30), expires_at: iso(-600) });
  w('envelope.json', { schema: 'autopilot.runs-live/1', scope: { project_key: 'abcdef0123456789', repo_identity: IDENT, root_run_id: ROOT }, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0 } });
  for (const [n, v] of Object.entries(files || {})) { if (v === null) fs.rmSync(path.join(dir, n), { force: true }); else w(n, v); }
  w('pane.txt', `some output\n\n${(bandLines || []).join('\n')}\n> \n`);
  return dir;
}
const status = (res, name) => (res.results.find((r) => r.name === name) || {}).status;
const tasksFile = (list, first) => ({ schema: 'autopilot.session-tasks/1', session_id: SID, first_created_at: first || iso(30), tasks: list });
const t = (id, subject, st, seq) => ({ id, subject, status: st, started_seq: seq === undefined ? null : seq });
const receipt = (extra) => ({ root_run_id: ROOT, controller: { progress_receipts: [{ artifact_type: 'controller_progress_receipt', root_run_id: ROOT, issued_at: iso(20), generation: 1, ...extra }] } });

test('findBand takes the last band line and the reason line after it', () => {
  const b = findBand('x\n● 進行中 demo · — · 5m · —\nreason\n> ');
  assert.strictEqual(b.verdict, '進行中');
  assert.strictEqual(b.line2, 'reason');
  assert.strictEqual(findBand('nothing here'), null);
});

test('要你決定 by an attention permission, with the reason on line 2', () => {
  const dir = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: rm -rf /tmp/x', since: iso(2) } },
    ['▲ 要你決定 demo · — · 30m · —', '等你批准：Bash: rm -rf /tmp/x（等了 2 分）']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'reason'), 'PASS');
});
test('要你決定 by an attention question', () => {
  const dir = capture({ 'attention.json': { kind: 'question', summary: 'which db?' } }, ['▲ 要你決定 demo · — · 30m · —', '等你回答：which db?']);
  assert.strictEqual(status(run(dir), 'verdict'), 'PASS');
});
test('要你決定 by an open decision file, even with an idle attention file', () => {
  const dir = capture({ 'decision-file.json': { schema: 'autopilot.decision/1', question: '要不要強推 main？' }, 'attention.json': { kind: 'idle', summary: 'waiting' } },
    ['▲ 要你決定 demo · — · 30m · —', '要不要強推 main？']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'reason'), 'PASS');
});
test('attention idle alone is not 要你決定', () => {
  const dir = capture({ 'attention.json': { kind: 'idle', summary: 'waiting' } }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑']);
  assert.strictEqual(derive(dir).verdict, '待命');
});
test('疑似卡住 from an envelope run with stall:true', () => {
  const dir = capture({ 'envelope.json': { scope: { project_key: 'abcdef0123456789', repo_identity: IDENT }, runs: [{ run_id: 'r', alive: true, stall: true, started_at: iso(30) }], counts: { confirmed_live: 1 } } },
    ['⏸ 疑似卡住 demo · — · 30m · —', '1 個派工疑似沒有輸出']);
  assert.strictEqual(status(run(dir), 'verdict'), 'PASS');
});
test('完成待驗收 by frozen done == total (and the progress tokens)', () => {
  const dir = capture({ 'work-orders/n1-a1.json': receipt({ frozen_denominator_digest: 'sha', deliverable_count: 4, completed_deliverables: ['a', 'b', 'c', 'd'], remaining_deliverables: [] }) },
    ['✓ 完成待驗收 demo · — · 20m · 100%（4/4）', '驗收結論尚未出']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'progress'), 'PASS'); assert.strictEqual(status(r, 'elapsed'), 'PASS');
});
test('完成待驗收 by every session task completed', () => {
  const dir = capture({ 'tasks.json': tasksFile([t(1, 'a', 'completed'), t(2, 'b', 'completed'), t(3, 'gone', 'deleted')]), 'work-orders/x.json': null },
    ['✓ 完成待驗收 demo · — · 30m · 2 done*', '任務 2/2 都完成，等你驗收']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'progress'), 'PASS');
});
test('進行中 by a live run', () => {
  const dir = capture({ 'envelope.json': { scope: { project_key: 'abcdef0123456789', repo_identity: IDENT }, runs: [{ run_id: 'r', alive: true, stall: false, started_at: iso(30) }], counts: { confirmed_live: 1 } } },
    ['● 進行中 demo · — · 30m · —', '1 個派工在跑']);
  assert.strictEqual(status(run(dir), 'verdict'), 'PASS');
});
test('進行中 by a task in progress; the phase is that task, the progress is unfrozen', () => {
  const dir = capture({ 'tasks.json': tasksFile([t(1, 'done one', 'completed'), t(2, 'write the thing', 'in_progress', 1)]) },
    ['● 進行中 demo · 做：write the thing · 30m · 1 done*', '']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'phase'), 'PASS'); assert.strictEqual(status(r, 'progress'), 'PASS');
});
test('待命 when nothing is live, awaited or done', () => {
  const dir = capture({}, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑']);
  assert.strictEqual(status(run(dir), 'verdict'), 'PASS');
});
test('phase precedence: campaign receipt phase beats marker phase beats task', () => {
  const dir = capture({ 'work-orders/n.json': receipt({ phase: 'IMPLEMENTING' }), 'tasks.json': tasksFile([t(2, 'x', 'in_progress', 1)]) }, ['● 進行中 demo · 實作 · 20m · 0 done*', '']);
  assert.strictEqual(status(run(dir), 'phase'), 'PASS');
  const m = capture({ 'marker.json': { session_id: SID, level: null, repo_identity: IDENT, project_key: 'abcdef0123456789', root_run_id: ROOT, started_at: iso(30), phase: 'L-3 實作' }, 'tasks.json': tasksFile([t(2, 'x', 'in_progress', 1)]) }, ['● 進行中 demo · L-3 實作 · 30m · 0 done*', '']);
  assert.strictEqual(status(run(m), 'phase'), 'PASS');
});
test('來源未接 shows for phase and progress when the manifest names the writers and they are off', () => {
  const manifest = { schema: 'autopilot.sources/1', sources: {
    phase: { installed: false, enabled: false }, progress: { installed: false, enabled: false }, tasks: { installed: false, enabled: false }, task_status_input: { installed: false, enabled: false } } };
  const dir = capture({ 'sources.json': manifest }, ['◌ 待命 demo · 來源未接 · 30m · 來源未接', '沒有派工在跑']);
  const r = run(dir);
  assert.strictEqual(status(r, 'phase'), 'PASS'); assert.strictEqual(status(r, 'progress'), 'PASS');
});
test('a wired-but-empty source shows an em dash, not 來源未接', () => {
  const manifest = { schema: 'autopilot.sources/1', sources: { phase: { installed: true, enabled: true }, progress: { installed: true, enabled: true }, tasks: { installed: true, enabled: true }, task_status_input: { installed: true, enabled: true } } };
  const dir = capture({ 'sources.json': manifest }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑']);
  const r = run(dir);
  assert.strictEqual(status(r, 'phase'), 'PASS'); assert.strictEqual(status(r, 'progress'), 'PASS');
  const wrong = run(capture({ 'sources.json': manifest }, ['◌ 待命 demo · 來源未接 · 30m · 來源未接', '']));
  assert.strictEqual(status(wrong, 'phase'), 'FAIL');
});
test('frozen progress: percent and n/N both required; unfrozen receipt gives n done*', () => {
  const frozen = { frozen_denominator_digest: 'd', deliverable_count: 8, completed_deliverables: ['1', '2', '3', '4', '5'], remaining_deliverables: ['6', '7', '8'] };
  assert.strictEqual(status(run(capture({ 'work-orders/n.json': receipt(frozen) }, ['● 進行中 demo · 做 6 · 20m · 62.5%（5/8）', ''])), 'progress'), 'PASS');
  assert.strictEqual(status(run(capture({ 'work-orders/n.json': receipt(frozen) }, ['● 進行中 demo · 做 6 · 20m · 5/8', ''])), 'progress'), 'FAIL');
  const unfrozen = { deliverable_count: 4, completed_deliverables: ['1', '2', '3'], remaining_deliverables: ['4'] };
  assert.strictEqual(status(run(capture({ 'work-orders/n.json': receipt(unfrozen) }, ['● 進行中 demo · 做 4 · 20m · 3 done*', ''])), 'progress'), 'PASS');
  assert.strictEqual(status(run(capture({ 'work-orders/n.json': receipt(unfrozen) }, ['● 進行中 demo · 做 4 · 20m · 75%（3/4）', ''])), 'progress'), 'FAIL');
});
test('decisions line counts from the sidecar; zero counts require absence', () => {
  const sc = { schema: 'autopilot.decisions-sidecar/1', count: 3, irreversible_count: 1, undocumented_dispatches: 2, writers_wired: ['engine'] };
  const ok = run(capture({ 'decisions-sidecar.json': sc }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑 · 代你決定 3 件（1 件不可逆） · 僅 engine 自動裁決 · 2 件派工無決策紀錄']));
  assert.strictEqual(status(ok, 'decisions'), 'PASS'); assert.strictEqual(status(ok, 'undocumented'), 'PASS');
  const bad = run(capture({ 'decisions-sidecar.json': sc }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑 · 代你決定 2 件（1 件不可逆）']));
  assert.strictEqual(status(bad, 'decisions'), 'FAIL'); assert.strictEqual(status(bad, 'undocumented'), 'FAIL');
  const zero = { ...sc, count: 0, irreversible_count: 0, undocumented_dispatches: 0 };
  assert.strictEqual(status(run(capture({ 'decisions-sidecar.json': zero }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑'])), 'no-decisions-line'), 'PASS');
  assert.strictEqual(status(run(capture({ 'decisions-sidecar.json': zero }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑 · 代你決定 1 件（0 件不可逆）'])), 'no-decisions-line'), 'FAIL');
});
test('elapsed is compared within two minutes', () => {
  assert.strictEqual(status(run(capture({}, ['◌ 待命 demo · — · 31m · —', ''])), 'elapsed'), 'PASS');
  assert.strictEqual(status(run(capture({}, ['◌ 待命 demo · — · 50m · —', ''])), 'elapsed'), 'FAIL');
});
test('project name: repo directory, else 8 hex of the key for a bare repo', () => {
  assert.strictEqual(derive(capture({}, [])).tokens.find((x) => x.name === 'project').expected, 'demo');
  const bare = capture({ 'envelope.json': { scope: { project_key: 'abcdef0123456789', repo_identity: 'git-common-dir:/srv/demo.git' }, runs: [] }, 'marker.json': { session_id: SID, level: null, project_key: 'abcdef0123456789', root_run_id: ROOT, started_at: iso(30) } }, []);
  assert.strictEqual(derive(bare).tokens.find((x) => x.name === 'project').expected, 'abcdef01');
});

// ---- planted red: the band disagrees with the sources -> FAIL, never tuned away
test('PLANTED RED: band says 進行中 while an attention permission is open -> FAIL', () => {
  const dir = capture({ 'attention.json': { kind: 'permission', summary: 'Bash: x' } }, ['● 進行中 demo · — · 30m · —', '1 個派工在跑']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'FAIL'); assert.strictEqual(r.ok, false);
});
test('PLANTED RED: band says 待命 while a run is stalled -> FAIL', () => {
  const dir = capture({ 'envelope.json': { scope: { project_key: 'abcdef0123456789', repo_identity: IDENT }, runs: [{ alive: true, stall: true, started_at: iso(30) }], counts: { confirmed_live: 1 } } }, ['◌ 待命 demo · — · 30m · —', '']);
  assert.strictEqual(run(dir).ok, false);
});
test('PLANTED RED: wrong project name and wrong progress -> FAIL', () => {
  const dir = capture({ 'tasks.json': tasksFile([t(1, 'a', 'completed'), t(2, 'b', 'in_progress', 1)]) }, ['● 進行中 other · 做：b · 30m · 2 done*', '']);
  const r = run(dir);
  assert.strictEqual(status(r, 'project'), 'FAIL'); assert.strictEqual(status(r, 'progress'), 'FAIL'); assert.strictEqual(r.ok, false);
});
test('PLANTED RED: no band in the pane -> FAIL', () => {
  assert.strictEqual(run(capture({}, ['just a shell prompt'])).ok, false);
});
test('a fully matching capture is ok overall', () => {
  assert.strictEqual(run(capture({}, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑'])).ok, true);
});

// ---- GATEFIX (mods P1W W4 gate pilot): completion needs no live run; dialogs hide the band, the panel is judged then
const liveEnv = { scope: { project_key: 'abcdef0123456789', repo_identity: IDENT }, runs: [{ run_id: 'r', alive: true, stall: false, started_at: iso(30) }], counts: { confirmed_live: 1 } };
const allDoneTasks = () => tasksFile([t(1, 'a', 'completed'), t(2, 'b', 'completed')]);
test('GATEFIX: every task completed AND a live run -> 進行中 is expected (not 完成待驗收)', () => {
  const dir = capture({ 'tasks.json': allDoneTasks(), 'envelope.json': liveEnv }, ['● 進行中 demo · — · 30m · 2 done*', '1 個派工在跑']);
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(r.ok, true);
  const wrong = run(capture({ 'tasks.json': allDoneTasks(), 'envelope.json': liveEnv }, ['✓ 完成待驗收 demo · — · 30m · 2 done*', '任務 2/2 都完成，等你驗收']));
  assert.strictEqual(status(wrong, 'verdict'), 'FAIL');
});
test('GATEFIX: frozen done == total AND a live run -> 進行中; the live run ended -> 完成待驗收', () => {
  const rc = { 'work-orders/a.json': receipt({ completed_deliverables: ['a', 'b'], remaining_deliverables: [], deliverable_count: 2, frozen_denominator_digest: 'abc' }) };
  const live = run(capture({ ...rc, 'envelope.json': liveEnv }, ['● 進行中 demo · — · 20m · 100%（2/2）', '1 個派工在跑']));
  assert.strictEqual(status(live, 'verdict'), 'PASS');
  const done = run(capture({ ...rc }, ['✓ 完成待驗收 demo · — · 20m · 100%（2/2）', '驗收結論尚未出']));
  assert.strictEqual(status(done, 'verdict'), 'PASS');
});
const SIDE = (l) => `${l.padEnd(60)}│`;
const panelPane = (word, reason) => [SIDE('● Creating a file'), `${SIDE(' Do you want to proceed?')}${word}`, `${SIDE(' ❯ 1. Yes')}${reason}`, SIDE(' Esc to cancel')];
test('GATEFIX: a dialog hides the band; the top-right panel verdict + reason are judged and the surface is printed', () => {
  const dir = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: touch /tmp/gate-perm-test', since: iso(0) } },
    panelPane('要你決定', '等你批准：Bash: touch /tmp/gate-perm-test（等了 0 分）'));
  const r = run(dir);
  assert.strictEqual(r.surface, 'panel');
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'reason'), 'PASS');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(status(r, 'project'), 'SKIP'); // the panel does not carry project / phase / progress / elapsed
});
test('GATEFIX: AskUserQuestion dialog, panel surface', () => {
  const dir = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'question', summary: '請選擇 A 還是 B？', since: iso(0) } },
    panelPane('要你決定', '等你回答：請選擇 A 還是 B？（等了 0 分）'));
  const r = run(dir);
  assert.strictEqual(r.surface, 'panel'); assert.strictEqual(r.ok, true);
});
test('GATEFIX: the band wins over the panel when both are present, and says so', () => {
  const dir = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: ls', since: iso(0) } },
    [...panelPane('要你決定', '等你批准：Bash: ls（等了 0 分）'), '▲ 要你決定 demo · — · 30m · —', '等你批准：Bash: ls（等了 0 分）']);
  const r = run(dir);
  assert.strictEqual(r.surface, 'band'); assert.strictEqual(status(r, 'project'), 'PASS');
});
test('GATEFIX PLANTED RED: panel says 要你決定 but no attention / decision file is open -> FAIL (panel is never a free pass)', () => {
  const r = run(capture({}, panelPane('要你決定', '等你批准：Bash: x')));
  assert.strictEqual(r.surface, 'panel'); assert.strictEqual(status(r, 'verdict'), 'FAIL'); assert.strictEqual(r.ok, false);
});
test('GATEFIX PLANTED RED: attention open but neither band nor panel shows a verdict -> FAIL', () => {
  const r = run(capture({ 'attention.json': { kind: 'permission', summary: 'Bash: ls' } }, ['just a dialog']));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.surface, null);
});
test('GATEFIX: the panel finder ignores a bare verdict word that is not alone in its panel cell', () => {
  const dir = capture({}, [SIDE('x') + '會議記錄：要你決定 的事項', SIDE('y') + '無']);
  assert.strictEqual(run(dir).surface, null);
});

const turnF = (state, offMin, extra) => ({ schema: 'autopilot.session-turn/1', session_id: SID, state, since: iso(offMin === undefined ? 3 : offMin), project_key: null, root_run_id: null, ...extra });
test('TURN: an active turn with nothing else is 進行中 and the reason names the turn', () => {
  const dir = capture({ 'turn.json': turnF('active') }, ['● 進行中 demo · — · 30m · —', '回合進行中（3 分）']);
  assert.strictEqual(derive(dir).verdict, '進行中');
  const r = run(dir);
  assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(status(r, 'reason'), 'PASS'); assert.strictEqual(r.ok, true);
});
test('TURN: ended, absent, or older than 24 h is 待命; permission attention outranks an active turn', () => {
  assert.strictEqual(derive(capture({ 'turn.json': turnF('ended') }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({}, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': turnF('active', 25 * 60) }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': { ...turnF('active'), schema: 'x/1' } }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': turnF('active'), 'attention.json': { kind: 'permission', summary: 'Bash: ls' } }, [])).verdict, '要你決定');
});
test('GATEFIX2: an interrupted turn (turn-effective.json with the same since) is 待命; another since / schema / state keeps it 進行中', () => {
  const T = turnF('active');
  const eff = (extra) => ({ schema: 'autopilot.session-turn-effective/1', session_id: SID, state: 'ended', reason: 'interrupted', turn_since: T.since, ...extra });
  assert.strictEqual(derive(capture({ 'turn.json': T, 'turn-effective.json': eff() }, [])).verdict, '待命');
  assert.strictEqual(derive(capture({ 'turn.json': T, 'turn-effective.json': eff({ turn_since: iso(1) }) }, [])).verdict, '進行中');
  assert.strictEqual(derive(capture({ 'turn.json': T, 'turn-effective.json': eff({ schema: 'x/1' }) }, [])).verdict, '進行中');
  assert.strictEqual(derive(capture({ 'turn.json': T, 'turn-effective.json': eff({ state: 'active' }) }, [])).verdict, '進行中');
  const r = run(capture({ 'turn.json': T, 'turn-effective.json': eff() }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑']));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(run(capture({ 'turn.json': T, 'turn-effective.json': eff() }, ['● 進行中 demo · — · 30m · —', '回合進行中（3 分）'])).ok, false, 'band still 進行中 after an interrupt -> FAIL');
});
test('TURN PLANTED RED: band says 待命 while the turn is active -> FAIL; band says 進行中 with an ended turn -> FAIL', () => {
  assert.strictEqual(run(capture({ 'turn.json': turnF('active') }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑'])).ok, false);
  assert.strictEqual(run(capture({ 'turn.json': turnF('ended') }, ['● 進行中 demo · — · 30m · —', '回合進行中（3 分）'])).ok, false);
});
test('TURN PLANTED RED: active turn, band 進行中 but line 2 does not name the turn -> FAIL on reason', () => {
  const r = run(capture({ 'turn.json': turnF('active') }, ['● 進行中 demo · — · 30m · —', '沒有派工在跑']));
  assert.strictEqual(status(r, 'reason'), 'FAIL'); assert.strictEqual(r.ok, false);
});

// ---- P1W FOREMAN (mods): foremen = agents/*.json stamps; dialog surface ----
// RED before the change: see run-w/land/foreman-red-check.txt. Mutation controls: run-w/land/mut-foreman-check-*.txt.
const agentF = (id, ageS, extra) => ({ schema: 'autopilot.agent-activity/1', session_id: SID, agent_id: id, agent_type: 'general-purpose', last_tool_at: new Date(NOW - ageS * 1000).toISOString(), last_tool_name: 'Bash', ...extra });
test('FOREMAN: an un-ended agent quiet < 180 s is 進行中 and the reason names the foreman; >= 180 s is 疑似卡住 with 工頭 N 分沒有動作', () => {
  const run1 = run(capture({ 'agents/f1.json': agentF('f1', 40) }, ['● 進行中 demo · — · 30m · —', '工頭在跑：last tool: Bash（0 分前有動作）']));
  assert.strictEqual(status(run1, 'verdict'), 'PASS'); assert.strictEqual(status(run1, 'reason'), 'PASS');
  assert.strictEqual(derive(capture({ 'agents/f1.json': agentF('f1', 179) }, [])).verdict, '進行中');
  const stalled = run(capture({ 'agents/f1.json': agentF('f1', 200) }, ['⏸ 疑似卡住 demo · — · 30m · —', '工頭 3 分沒有動作']));
  assert.strictEqual(status(stalled, 'verdict'), 'PASS'); assert.strictEqual(status(stalled, 'reason'), 'PASS'); assert.strictEqual(stalled.ok, true);
  assert.strictEqual(derive(capture({ 'agents/f1.json': agentF('f1', 180) }, [])).verdict, '疑似卡住');
});
test('FOREMAN: ended, older than 24 h, foreign schema, or no last_tool_at are ignored (待命)', () => {
  const v = (files) => derive(capture(files, [])).verdict;
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 40, { ended_at: iso(0) }) }), '待命');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 25 * 3600) }), '待命');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 40, { schema: 'x/1' }) }), '待命');
  assert.strictEqual(v({ 'agents/f1.json': agentF('f1', 40, { last_tool_at: 'nope' }) }), '待命');
  assert.strictEqual(v({}), '待命');
});
test('FOREMAN: precedence — attention > envelope stall > foreman stall > 完成待驗收; a fresh foreman blocks 完成待驗收; a live run still wins the reason', () => {
  const done = { 'tasks.json': tasksFile([t('1', 'a', 'completed'), t('2', 'b', 'completed')]) };
  assert.strictEqual(derive(capture({ ...done }, [])).verdict, '完成待驗收');
  assert.strictEqual(derive(capture({ ...done, 'agents/f1.json': agentF('f1', 40) }, [])).verdict, '進行中');
  assert.strictEqual(derive(capture({ ...done, 'agents/f1.json': agentF('f1', 40, { ended_at: iso(0) }) }, [])).verdict, '完成待驗收');
  assert.strictEqual(derive(capture({ ...done, 'agents/f1.json': agentF('f1', 400) }, [])).verdict, '疑似卡住');
  assert.strictEqual(derive(capture({ 'agents/f1.json': agentF('f1', 400), 'attention.json': { kind: 'permission', summary: 'Bash: ls' } }, [])).verdict, '要你決定');
  const env = { schema: 'autopilot.runs-live/1', scope: { project_key: 'abcdef0123456789', repo_identity: IDENT, root_run_id: ROOT }, runs: [{ run_id: 'r', alive: true, stall: true, started_at: iso(30) }], counts: { confirmed_live: 1 } };
  const r = run(capture({ 'envelope.json': env, 'agents/f1.json': agentF('f1', 400) }, ['⏸ 疑似卡住 demo · — · 30m · —', '最久的派工 4m 沒有輸出']));
  assert.strictEqual(r.derived.verdict, '疑似卡住'); assert.strictEqual(status(r, 'reason'), undefined, 'the envelope stall owns the reason, no foreman reason token');
  const live = run(capture({ 'envelope.json': { ...env, runs: [{ run_id: 'r', alive: true, started_at: iso(30) }] }, 'agents/f1.json': agentF('f1', 40) }, ['● 進行中 demo · — · 30m · —', '1 個派工在跑']));
  assert.strictEqual(status(live, 'verdict'), 'PASS'); assert.strictEqual(status(live, 'reason'), undefined);
});
test('FOREMAN PLANTED RED: band says 待命 while a foreman works -> FAIL; band 進行中 but the reason does not name the foreman -> FAIL; band 進行中 for a stalled foreman -> FAIL', () => {
  assert.strictEqual(run(capture({ 'agents/f1.json': agentF('f1', 40) }, ['◌ 待命 demo · — · 30m · —', '沒有派工在跑'])).ok, false);
  assert.strictEqual(status(run(capture({ 'agents/f1.json': agentF('f1', 40) }, ['● 進行中 demo · — · 30m · —', '回合進行中（3 分）'])), 'reason'), 'FAIL');
  assert.strictEqual(run(capture({ 'agents/f1.json': agentF('f1', 400) }, ['● 進行中 demo · — · 30m · —', '工頭在跑：x（0 分前有動作）'])).ok, false);
  assert.strictEqual(status(run(capture({ 'agents/f1.json': agentF('f1', 400) }, ['⏸ 疑似卡住 demo · — · 30m · —', '最久的派工 3m 沒有輸出'])), 'reason'), 'FAIL');
});

const DIALOG = ['● Foreman: csv parser', '', ' Bash command · from the general-purpose agent', ' This command requires approval', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   4. No', ' Esc to cancel · Tab to amend'];
test('DIALOG: neither band nor panel visible but a permission dialog on screen -> judged from attention.json only; surface: dialog', () => {
  const dir = capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: git reset -q --hard', since: iso(0) } }, DIALOG);
  const r = run(dir);
  assert.strictEqual(r.surface, 'dialog'); assert.strictEqual(status(r, 'verdict'), 'PASS'); assert.strictEqual(r.ok, true);
  assert.strictEqual(status(r, 'project'), 'SKIP'); assert.strictEqual(status(r, 'reason'), 'SKIP');
  const q = run(capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'question', summary: '選哪個？', since: iso(0) } }, DIALOG));
  assert.strictEqual(q.surface, 'dialog'); assert.strictEqual(q.ok, true);
});
test('DIALOG PLANTED RED: a dialog on screen but attention.json is absent, idle, or the verdict is not 要你決定 -> FAIL; the band / panel still win when present', () => {
  const none = run(capture({}, DIALOG));
  assert.strictEqual(none.surface, 'dialog'); assert.strictEqual(none.ok, false);
  assert.strictEqual(run(capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'idle', summary: 'waiting' } }, DIALOG)).ok, false);
  const withBand = run(capture({ 'attention.json': { schema: 'autopilot.attention/1', kind: 'permission', summary: 'Bash: ls', since: iso(0) } }, ['▲ 要你決定 demo · — · 30m · —', '等你批准：Bash: ls（等了 0 分）', ...DIALOG]));
  assert.strictEqual(withBand.surface, 'band');
  assert.strictEqual(run(capture({}, ['just some output'])).surface, null, 'no dialog text, no verdict: still no surface');
});
