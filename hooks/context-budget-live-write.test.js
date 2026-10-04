/**
 * Tests for context-budget's live-context-file writer (mods P1W W2f): when the host status line
 * does not write `<live>/context/<sid>.json` (absent or older than the reader's 120 s bound),
 * the PostToolUse hook writes it from the transcript's last usage row. Never overwrites a fresh
 * status-line file; never touches another session's file; window comes from a status line that
 * once existed, else the >200K observation, else unknown (pct null, tokens still written).
 * Run: node --test hooks/context-budget-live-write.test.js
 *
 * RED-first record (before the writer existed, 12 tests): pass 6 / fail 6 — the cases that
 * assert a file gets written/replaced/refreshed fail; the negative controls (fresh untouched,
 * knob off, malformed, subagent, mode off) pass vacuously on the old hook, which is why each
 * guarded rule also has a mutation control (see run-w/w2f/mut-*.txt). (The other-sid test was
 * RED too: its own sid file was never written.)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'context-budget.js');
const SID = 'w2f-session-aaaa';

function shm(prefix) {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  return fs.mkdtempSync(path.join(base, prefix));
}

// Real transcript shape: assistant rows with message.usage + timestamp, plus user/system noise.
function transcript(usage, extraLines = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2f-tr-'));
  const p = path.join(dir, 't.jsonl');
  const row = (u) => JSON.stringify({
    type: 'assistant', timestamp: '2026-10-05T01:00:00.000Z',
    message: { role: 'assistant', model: 'claude-opus-5-5', usage: {
      input_tokens: u[0], cache_read_input_tokens: u[1], cache_creation_input_tokens: u[2], output_tokens: 10,
    } },
  });
  const lines = [JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }), row([1, 1, 1]), row(usage),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok' } }), ...extraLines];
  fs.writeFileSync(p, `${lines.join('\n')}\n`);
  return p;
}

function env(live, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w2f-home-'));
  return {
    ...process.env,
    HOME: home,
    AUTOPILOT_LIVE_DIR: live,
    AUTOPILOT_CONTEXT_BUDGET_DIR: path.join(home, 'state'),
    ...extra,
  };
}
function run(live, tp, extraEnv, payloadExtra = {}) {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify({ transcript_path: tp, session_id: SID, ...payloadExtra }),
    encoding: 'utf8', env: env(live, extraEnv),
  });
}
const fileOf = (live, sid = SID) => path.join(live, 'context', `${sid}.json`);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function putFile(live, obj, sid = SID, ageMs = 0) {
  fs.mkdirSync(path.join(live, 'context'), { recursive: true });
  const rec = { ...obj, written_at: new Date(Date.now() - ageMs).toISOString() };
  fs.writeFileSync(fileOf(live, sid), JSON.stringify(rec));
  return fs.readFileSync(fileOf(live, sid), 'utf8');
}
const statusLineRec = (size, total = 50000) => ({
  schema_version: 1, session_id: SID, cc_version: '2.1.263',
  model: { id: 'claude-opus-5[1m]', display_name: 'Opus 5 (1M context)' },
  context_window: { context_window_size: size, used_percentage: 5, total_input_tokens: total },
});

test('missing file, small context, no window source ⇒ written with tokens, pct null, window_source unknown', () => {
  const live = shm('w2f-live-');
  const r = run(live, transcript([2, 60000, 1000]));
  assert.strictEqual(r.status, 0, r.stderr);
  const f = readJson(fileOf(live));
  assert.strictEqual(f.schema_version, 1);
  assert.strictEqual(f.session_id, SID);
  assert.strictEqual(f.writer, 'context-budget');
  assert.strictEqual(f.window_source, 'unknown');
  assert.strictEqual(f.context_window.total_input_tokens, 61002);
  assert.strictEqual(f.context_window.used_percentage, null);
  assert.strictEqual(f.context_window.context_window_size, null);
  assert.deepStrictEqual(f.context_window.current_usage,
    { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 60000 });
  assert.ok(Number.isFinite(Date.parse(f.written_at)));
  assert.strictEqual(fs.statSync(fileOf(live)).mode & 0o777, 0o600);
});

test('observed tokens > 200000 ⇒ window 1M, window_source observed, pct computed', () => {
  const live = shm('w2f-live-');
  const r = run(live, transcript([2, 388327, 2023]));
  assert.strictEqual(r.status, 0, r.stderr);
  const f = readJson(fileOf(live));
  assert.strictEqual(f.window_source, 'observed');
  assert.strictEqual(f.context_window.context_window_size, 1000000);
  assert.strictEqual(f.context_window.total_input_tokens, 390352);
  assert.strictEqual(f.context_window.used_percentage, 39);
});

test('fresh status-line file ⇒ left byte-identical', () => {
  const live = shm('w2f-live-');
  const before = putFile(live, statusLineRec(1000000), SID, 5000);
  const r = run(live, transcript([2, 388327, 2023]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(fileOf(live), 'utf8'), before);
});

test('stale status-line file ⇒ replaced; its window is kept as window_source statusline', () => {
  const live = shm('w2f-live-');
  putFile(live, statusLineRec(1000000), SID, 300000);
  const r = run(live, transcript([2, 100000, 500]));
  assert.strictEqual(r.status, 0, r.stderr);
  const f = readJson(fileOf(live));
  assert.strictEqual(f.writer, 'context-budget');
  assert.strictEqual(f.window_source, 'statusline');
  assert.strictEqual(f.context_window.context_window_size, 1000000);
  assert.strictEqual(f.context_window.total_input_tokens, 100502);
  assert.strictEqual(f.context_window.used_percentage, 10);
  assert.ok(Date.now() - Date.parse(f.written_at) < 60000, 'fresh written_at');
});

test('window remembered across calls: status line once fresh, then gone ⇒ statusline window persists after our own writes', () => {
  const live = shm('w2f-live-');
  const e = env(live);
  const tp = transcript([2, 100000, 500]);
  putFile(live, statusLineRec(1000000), SID, 5000); // fresh: hook records knownWindow, writes nothing
  const call = () => spawnSync('node', [HOOK], { input: JSON.stringify({ transcript_path: tp, session_id: SID }), encoding: 'utf8', env: e });
  assert.strictEqual(call().status, 0);
  fs.rmSync(fileOf(live)); // status line stopped and file vanished
  assert.strictEqual(call().status, 0);
  const f = readJson(fileOf(live));
  assert.strictEqual(f.window_source, 'statusline');
  assert.strictEqual(f.context_window.context_window_size, 1000000);
});

test('our own fresh file is refreshed (tokens move) and never mistaken for a status-line window', () => {
  const live = shm('w2f-live-');
  putFile(live, { ...statusLineRec(1000000, 1), writer: 'context-budget', window_source: 'observed' }, SID, 1000);
  // 160k with a (self-written) 1M window must NOT be attributed to "(statusline)" nor skip the T2 unknown path
  const r = run(live, transcript([2, 160000, 1000]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /\(statusline\)/);
  assert.match(r.stderr, /context window is unknown/, 'self-written 1M window must not silence the unknown-window path');
  const f = readJson(fileOf(live));
  assert.strictEqual(f.context_window.total_input_tokens, 161002);
});

test('malformed / usage-less transcript ⇒ no file, exit 0', () => {
  const live = shm('w2f-live-');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2f-bad-'));
  const bad = path.join(dir, 'bad.jsonl');
  fs.writeFileSync(bad, '{not json\n\u0000\u0001garbage\n');
  const r = run(live, bad);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(fileOf(live)));
  const r2 = run(live, path.join(dir, 'missing.jsonl'));
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.ok(!fs.existsSync(fileOf(live)));
});

test('knob off (env AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE=off) ⇒ nothing written', () => {
  const live = shm('w2f-live-');
  const r = run(live, transcript([2, 60000, 1000]), { AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE: 'off' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(fileOf(live)));
});

test('knob off (config context_budget.live_write=false) ⇒ nothing written', () => {
  const live = shm('w2f-live-');
  const e = env(live);
  fs.mkdirSync(path.join(e.HOME, '.autopilot'), { recursive: true });
  fs.writeFileSync(path.join(e.HOME, '.autopilot', 'config.json'), JSON.stringify({ context_budget: { live_write: false } }));
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ transcript_path: transcript([2, 60000, 1000]), session_id: SID }), encoding: 'utf8', env: e });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(fileOf(live)));
});

test('another session\'s file is never touched (fresh, stale, or ours), and only this sid gets a file', () => {
  const live = shm('w2f-live-');
  const stale = putFile(live, statusLineRec(200000), 'other-stale', 900000);
  const fresh = putFile(live, statusLineRec(1000000), 'other-fresh', 1000);
  const r = run(live, transcript([2, 60000, 1000]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(fileOf(live, 'other-stale'), 'utf8'), stale);
  assert.strictEqual(fs.readFileSync(fileOf(live, 'other-fresh'), 'utf8'), fresh);
  assert.deepStrictEqual(fs.readdirSync(path.join(live, 'context')).sort(), ['other-fresh.json', 'other-stale.json', `${SID}.json`]);
});

test('subagent fire (agent_id) ⇒ no file', () => {
  const live = shm('w2f-live-');
  const r = run(live, transcript([2, 60000, 1000]), {}, { agent_id: 'a1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(fileOf(live)));
});

test('context_budget mode off ⇒ nothing written (hook fully off)', () => {
  const live = shm('w2f-live-');
  const r = run(live, transcript([2, 60000, 1000]), { AUTOPILOT_CONTEXT_BUDGET_MODE: 'off' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(fileOf(live)));
});
