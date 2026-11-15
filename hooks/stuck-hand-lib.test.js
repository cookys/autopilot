// hooks/stuck-hand-lib.test.js — the delivery half: notice only for the dispatching session, once, throttled.
// Fixtures only (fake runs dir, fake /proc, fake clock). Detection cases live in scripts/stuck-hand-check.test.js.
// Negative control: a different session id must get nothing; a second delivery must be empty.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'audit-log.js'); // the host: stuck-hand-lib has no process of its own
const MIN = 60000;
const T0 = 1800000000000;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-hook-'));
  const f = { runs: path.join(root, 'runs'), proc: path.join(root, 'proc'), live: path.join(root, 'live'), state: path.join(root, 'state.json'), log: path.join(root, 'run.log') };
  for (const d of [f.runs, f.proc, f.live]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f.log, 'x\n');
  const old = new Date(T0 / 1000 - 7200 * 1000);
  fs.utimesSync(f.log, old, old);
  fs.mkdirSync(path.join(f.proc, '4242'));
  fs.writeFileSync(path.join(f.proc, '4242', 'stat'), '4242 (a) S 1 1 1 0 -1 0 0 0 0 0 100 0 0 0 20 0 1 0 1 0 0\n');
  fs.writeFileSync(path.join(f.runs, 'r1.manifest.json'), JSON.stringify({ schema: 1, run_id: 'r1', role: 'implementer', runner: 'codex', lane: 'lane-x', session_id: 'sess-1', pid: 4242, log_path: f.log, ended_at: null }));
  return f;
}

function env(f, atMin, extra = {}) {
  // The other audit-log legs stay off so this test starts no watcher and writes no live state outside its fixture.
  return { PATH: process.env.PATH, HOME: path.dirname(f.runs), AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', AUTOPILOT_AWAITING_OWNER: 'off', AUTOPILOT_AGENT_ACTIVITY: 'off', AUTOPILOT_DISPATCH_RUNS_DIR: f.runs, AUTOPILOT_STUCK_HAND_PROC_ROOT: f.proc, AUTOPILOT_STUCK_HAND_STATE: f.state,
    AUTOPILOT_LIVE_DIR: f.live, AUTOPILOT_STUCK_HAND_NOW: String(T0 + atMin * MIN), ...extra };
}

function hook(f, atMin, sid, extra) {
  const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', env: env(f, atMin, extra), input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Read', session_id: sid }) });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}

test('(h) notice only for the matching parent session, once, throttled to 60 s', () => {
  const f = fixture();
  assert.equal(hook(f, 0, 'sess-1'), '');
  assert.equal(hook(f, 31, 'other-session'), ''); // scan happens, run is not theirs
  assert.equal(hook(f, 31.5, 'sess-1'), ''); // inside the 60 s throttle: no scan
  const msg = hook(f, 33, 'sess-1');
  assert.equal(msg, 'stuck hand: r1 (lane-x) quiet 33m — no output/commit/CPU; check: node scripts/dispatch-status.js --run r1');
  assert.equal(hook(f, 40, 'sess-1'), ''); // once
});

test('(h2) off switch: nothing scanned, nothing written', () => {
  const f = fixture();
  assert.equal(hook(f, 0, 'sess-1', { AUTOPILOT_STUCK_HAND_MINUTES: 'off' }), '');
  assert.equal(fs.existsSync(f.state), false);
});

test('(h3) a subagent fire (agent_id) is ignored', () => {
  const f = fixture();
  hook(f, 0, 'sess-1');
  const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', env: env(f, 33), input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Read', session_id: 'sess-1', agent_id: 'a1' }) });
  assert.equal(r.stdout, '');
});
