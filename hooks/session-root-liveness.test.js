/**
 * One session-root judgement (session-mode.js readSessionRoot) and its readers. Run: node --test hooks/session-root-liveness.test.js
 *
 * Origin (peer report 2026-10-27, twgs-revival session 5eb5d332): a session that outlived its 24 h marker lost its root in
 * open-decision.js (card written to the unbound scope, stdout only the id) while the workflow snapshot still reported the
 * root. Contract:
 *   - alive = marker unexpired, OR marker expired but <live>/turn/<sid>.json is there with `since` inside one marker TTL
 *     (SessionEnd removes the turn file, so a really ended session stays expired). Never "expired counts as valid".
 *   - open-decision.js, hooks/ask-decision.js, the turn scope, the workflow snapshot, the decision ledger all ask readSessionRoot.
 *   - `open` into the unbound scope warns on stderr (scope_key + file), stdout stays the bare id.
 *   - owner-question-guard names the session root in its block message, and blocks a reply whose named card is unbound.
 * Isolation: HOME, AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_LIVE_DIR and the repo are all mkdtemp; nothing real is read or written.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const H = 3600 * 1000;

function env(t, extra = {}) {
  const e = { ...process.env, HOME: t.home, AUTOPILOT_SESSION_MODE_DIR: t.modes, AUTOPILOT_LIVE_DIR: t.live, ...extra };
  for (const k of ['AUTOPILOT_ROOT_RUN_ID', 'AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CODEX_THREAD_ID']) delete e[k];
  return { ...e, ...extra };
}

function fixture(label) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `root-live-${label}-`));
  const t = { base, home: path.join(base, 'home'), modes: path.join(base, 'modes'), live: path.join(base, 'live'), repo: path.join(base, 'repo') };
  for (const d of [t.home, t.modes, path.join(t.live, 'turn'), t.repo]) fs.mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: t.repo });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i'], { cwd: t.repo });
  return t;
}

function marker(t, sid, { expiredHoursAgo = null, root = 'root-abc' } = {}) {
  const now = Date.now();
  const exp = expiredHoursAgo === null ? now + 6 * H : now - expiredHoursAgo * H;
  fs.writeFileSync(path.join(t.modes, `${sid}.json`), JSON.stringify({
    session_id: sid, level: null, repo_root: t.repo, started_at: new Date(exp - 24 * H).toISOString(), expires_at: new Date(exp).toISOString(), root_run_id: root,
  }));
}

function turn(t, sid, hoursAgo) {
  fs.writeFileSync(path.join(t.live, 'turn', `${sid}.json`), JSON.stringify({
    schema: 'autopilot.session-turn/1', session_id: sid, state: 'ended', since: new Date(Date.now() - hoursAgo * H).toISOString(),
  }));
}

function openCard(t, sid, extra = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'open-decision.js'), 'open', '--question', 'q?', ...extra], {
    cwd: t.repo, env: env(t, { AUTOPILOT_SESSION_ID: sid }), encoding: 'utf8',
  });
  const files = fs.existsSync(path.join(t.repo, '.git', 'autopilot', 'decisions')) ? fs.readdirSync(path.join(t.repo, '.git', 'autopilot', 'decisions')).filter((f) => f.endsWith('.json')) : [];
  return { ...r, files };
}

const sm = () => require(path.join(ROOT, 'scripts', 'session-mode.js'));

test('readSessionRoot: unexpired marker is alive via marker', () => {
  const t = fixture('a'); marker(t, 's1');
  const r = sm().readSessionRoot('s1', { markerDir: t.modes, liveBase: t.live });
  assert.deepStrictEqual([r.root, r.live_via, r.expired], ['root-abc', 'marker', false]);
});

test('readSessionRoot: expired marker + recent turn file keeps the root (session outlived the TTL)', () => {
  const t = fixture('b'); marker(t, 's1', { expiredHoursAgo: 30 }); turn(t, 's1', 0.1);
  const r = sm().readSessionRoot('s1', { markerDir: t.modes, liveBase: t.live });
  assert.deepStrictEqual([r.root, r.live_via, r.expired], ['root-abc', 'turn', true]);
});

test('readSessionRoot: expired marker without a turn file (SessionEnd removed it) has no root', () => {
  const t = fixture('c'); marker(t, 's1', { expiredHoursAgo: 30 });
  const r = sm().readSessionRoot('s1', { markerDir: t.modes, liveBase: t.live });
  assert.deepStrictEqual([r.root, r.live_via], [null, null]);
});

test('readSessionRoot: expired marker with a STALE turn file (older than one TTL) has no root', () => {
  const t = fixture('d'); marker(t, 's1', { expiredHoursAgo: 60 }); turn(t, 's1', 30);
  assert.strictEqual(sm().readSessionRoot('s1', { markerDir: t.modes, liveBase: t.live }).root, null);
});

test('open-decision open: expired marker, no turn file => unbound file, stderr warning with scope_key + file, stdout only the id', () => {
  const t = fixture('e'); marker(t, 's1', { expiredHoursAgo: 30 });
  const r = openCard(t, 's1');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^d-[0-9a-f]{8}\n$/);
  assert.match(r.stderr, /UNBOUND scope/);
  assert.match(r.stderr, /scope_key=[0-9a-f]{16}\b/);
  assert.match(r.stderr, /file=\S+\.git\/autopilot\/decisions\/[0-9a-f]{16}\.json/);
  assert.strictEqual(r.files.length, 1);
  assert.ok(!r.files[0].includes('--'));
});

test('open-decision open: expired marker but live session (recent turn file) => card lands in the root scope, no warning', () => {
  const t = fixture('f'); marker(t, 's1', { expiredHoursAgo: 30 }); turn(t, 's1', 0.5);
  const r = openCard(t, 's1');
  assert.strictEqual(r.stderr, '');
  assert.deepStrictEqual(r.files.map((f) => /--root-abc\.json$/.test(f)), [true]);
});

test('open-decision open: an explicit --root-run-id never warns', () => {
  const t = fixture('g'); marker(t, 's1', { expiredHoursAgo: 30 });
  const r = openCard(t, 's1', ['--root-run-id', 'root-abc']);
  assert.strictEqual(r.stderr, '');
  assert.ok(/--root-abc\.json$/.test(r.files[0]));
});

test('workflow snapshot and open-decision agree on the root of the same expired-but-live session', () => {
  const t = fixture('h'); marker(t, 's1', { expiredHoursAgo: 30 }); turn(t, 's1', 0.2);
  const snap = require(path.join(ROOT, 'scripts', 'lib', 'workflow-snapshot.js'))
    .collect({ sessionId: 's1', cwd: t.repo, dirs: { sessionMode: t.modes, live: t.live, taskCard: path.join(t.base, 'tc'), dispatchRuns: path.join(t.base, 'dr') } });
  assert.ok(snap.lines.some((l) => /root root-abc/.test(l)), snap.lines.join('\n'));
  const r = openCard(t, 's1');
  assert.ok(/--root-abc\.json$/.test(r.files[0]));
  // and when the session is really gone, both drop it
  fs.rmSync(path.join(t.live, 'turn', 's1.json'));
  const snap2 = require(path.join(ROOT, 'scripts', 'lib', 'workflow-snapshot.js'))
    .collect({ sessionId: 's1', cwd: t.repo, dirs: { sessionMode: t.modes, live: t.live, taskCard: path.join(t.base, 'tc'), dispatchRuns: path.join(t.base, 'dr') } });
  assert.ok(!snap2.lines.some((l) => /root root-abc/.test(l)));
});

test('turn scope (UserPromptSubmit) records the root of an expired-but-live session', () => {
  const t = fixture('i'); marker(t, 's1', { expiredHoursAgo: 30 }); turn(t, 's1', 0.2);
  const code = `require(${JSON.stringify(path.join(ROOT, 'hooks', 'live-session-lib.js'))}).recordTurn({hook_event_name:'UserPromptSubmit',session_id:'s1',cwd:${JSON.stringify(t.repo)}})`;
  const r = spawnSync(process.execPath, ['-e', code], { env: env(t), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(t.live, 'turn', 's1.json'), 'utf8')).root_run_id, 'root-abc');
});

// --- owner-question-guard (step 4) ---
function guard(t, sid, assistantText) {
  const tp = path.join(t.base, 'tr.jsonl');
  fs.writeFileSync(tp, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}\n${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: assistantText }] } })}\n`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'owner-question-guard.js')], {
    input: JSON.stringify({ session_id: sid, cwd: t.repo, transcript_path: tp, stop_hook_active: false }), env: env(t, { AUTOPILOT_OWNER_QUESTION_GUARD: 'on' }), encoding: 'utf8',
  });
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

test('guard: block message carries the session root as a ready --root-run-id', () => {
  const t = fixture('j'); marker(t, 's1');
  const out = guard(t, 's1', 'push 會等你批准。');
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, / open --root-run-id root-abc --question /);
});

test('guard: no root => no --root-run-id demanded, message says the card will be unbound', () => {
  const t = fixture('k'); marker(t, 's1', { expiredHoursAgo: 30 });
  const out = guard(t, 's1', 'push 會等你批准。');
  assert.doesNotMatch(out.reason, /--root-run-id root-abc/);
  assert.match(out.reason, /沒有可用的 root/);
});

test('guard: a reply naming a card that sits in the UNBOUND scope is blocked once, pointing at close + reopen with the root', () => {
  const t = fixture('l'); marker(t, 's1', { expiredHoursAgo: 30 });
  const c = openCard(t, 's1'); // unbound (no turn file)
  const id = c.stdout.trim();
  marker(t, 's1'); // the session now has a live root (marker renewed) but the card is already unbound
  const out = guard(t, 's1', `待決卡片 ${id}，等你回覆。`);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, new RegExp(`${id}.*未綁定`));
  assert.match(out.reason, /close --id d-[0-9a-f]{8}/);
  assert.match(out.reason, /--root-run-id root-abc/);
  // a card that is bound passes silently
  const c2 = openCard(t, 's1', ['--root-run-id', 'root-abc']);
  assert.strictEqual(guard(t, 's1', `待決卡片 ${c2.stdout.trim()}，等你回覆。`), null);
});

test('ask-decision markerRoot (AskUserQuestion cards) uses the same judgement', () => {
  const t = fixture('m'); marker(t, 's1', { expiredHoursAgo: 30 }); turn(t, 's1', 0.2);
  const code = `process.stdout.write(String(require(${JSON.stringify(path.join(ROOT, 'hooks', 'ask-decision.js'))}).markerRoot('s1')))`;
  assert.strictEqual(spawnSync(process.execPath, ['-e', code], { env: env(t), encoding: 'utf8' }).stdout, 'root-abc');
  fs.rmSync(path.join(t.live, 'turn', 's1.json'));
  assert.strictEqual(spawnSync(process.execPath, ['-e', code], { env: env(t), encoding: 'utf8' }).stdout, 'null');
});

// Panel parity: the live pane (mods/live/register.ts markerAlive) and readSessionRoot judge the SAME table. The table lives in
// mods/live/live.test.ts (where the pane's side runs it through the real resolveScope); here the JS side runs it.
test('parity table of the live pane (mods/live/live.test.ts ROOT_LIVENESS_CASES) gives the same root through readSessionRoot', () => {
  const src = fs.readFileSync(path.join(ROOT, 'mods', 'live', 'live.test.ts'), 'utf8');
  const m = src.match(/ROOT_LIVENESS_CASES begin[^\n]*\nconst ROOT_LIVENESS_CASES[^=]*= (\[[\s\S]*?\n\])\n\/\/ ROOT_LIVENESS_CASES end/);
  assert.ok(m, 'table block found');
  const cases = JSON.parse(m[1]);
  assert.ok(cases.length >= 5);
  for (const c of cases) {
    const t = fixture('par');
    const now = Date.now();
    fs.writeFileSync(path.join(t.modes, 's1.json'), JSON.stringify({ session_id: 's1', level: c.level, root_run_id: 'root-abc', expires_at: new Date(now + c.marker_expires_in_h * H).toISOString() }));
    if (c.turn_since_ago_h !== null) turn(t, 's1', c.turn_since_ago_h);
    const r = sm().readSessionRoot('s1', { markerDir: t.modes, liveBase: t.live });
    assert.strictEqual(r.root !== null, c.root_alive, c.name);
  }
  // the pane's source carries the same TTL and schema the JS side uses
  const reg = fs.readFileSync(path.join(ROOT, 'mods', 'live', 'register.ts'), 'utf8');
  assert.match(reg, /MARKER_TTL_MS = 24 \* 3600 \* 1000/);
  assert.match(reg, /autopilot\.session-turn\/1/);
});

// Turn state transition (live-session-lib recordTurn): an OLD turn file + expired marker, then a new UserPromptSubmit. The turn
// file it writes and what open-decision / ask-decision decide afterwards must name the same root (no turn=null, askAfter=root).
test('turn transition: stale turn + expired marker, then UserPromptSubmit -> turn.root, ask-decision and open-decision agree', () => {
  const t = fixture('n'); marker(t, 's1', { expiredHoursAgo: 40 }); turn(t, 's1', 35);
  const code = `require(${JSON.stringify(path.join(ROOT, 'hooks', 'live-session-lib.js'))}).recordTurn({hook_event_name:'UserPromptSubmit',session_id:'s1',cwd:${JSON.stringify(t.repo)}})`;
  assert.strictEqual(spawnSync(process.execPath, ['-e', code], { env: env(t), encoding: 'utf8' }).status, 0);
  const rec = JSON.parse(fs.readFileSync(path.join(t.live, 'turn', 's1.json'), 'utf8'));
  const askCode = `process.stdout.write(String(require(${JSON.stringify(path.join(ROOT, 'hooks', 'ask-decision.js'))}).markerRoot('s1')))`;
  const ask = spawnSync(process.execPath, ['-e', askCode], { env: env(t), encoding: 'utf8' }).stdout;
  const r = openCard(t, 's1');
  assert.strictEqual(rec.root_run_id, 'root-abc');
  assert.strictEqual(ask, 'root-abc');
  assert.ok(/--root-abc\.json$/.test(r.files[0]));
  assert.strictEqual(r.stderr, '');
  // a Stop after it keeps the scope; a SessionEnd removes the file and the root is gone again once the marker is expired
  const stop = `require(${JSON.stringify(path.join(ROOT, 'hooks', 'live-session-lib.js'))}).recordTurn({hook_event_name:'Stop',session_id:'s1'})`;
  spawnSync(process.execPath, ['-e', stop], { env: env(t), encoding: 'utf8' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(t.live, 'turn', 's1.json'), 'utf8')).root_run_id, 'root-abc');
  const end = `require(${JSON.stringify(path.join(ROOT, 'hooks', 'live-session-lib.js'))}).recordTurn({hook_event_name:'SessionEnd',session_id:'s1'})`;
  spawnSync(process.execPath, ['-e', end], { env: env(t), encoding: 'utf8' });
  assert.strictEqual(spawnSync(process.execPath, ['-e', askCode], { env: env(t), encoding: 'utf8' }).stdout, 'null');
});

// A marker with no `level` key (plain session, hooks/session-turn.test.js fixture) is legal; only an unknown level is refused.
test('readSessionRoot: no level key is a plain session (keeps its root); an unknown level is refused', () => {
  const t = fixture('o');
  const w = (extra) => fs.writeFileSync(path.join(t.modes, 's1.json'), JSON.stringify({ root_run_id: 'root-abc', expires_at: new Date(Date.now() + H).toISOString(), ...extra }));
  w({});
  assert.strictEqual(sm().readSessionRoot('s1', { markerDir: t.modes, liveBase: t.live }).root, 'root-abc');
  w({ level: 'l9' });
  assert.strictEqual(sm().readSessionRoot('s1', { markerDir: t.modes, liveBase: t.live }).root, null);
});
