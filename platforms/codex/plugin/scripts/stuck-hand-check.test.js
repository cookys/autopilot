// scripts/stuck-hand-check.test.js — fixtures only: fake runs dir, fake /proc root, fake clock, throwaway git repo.
// Negative controls: (c)(d)(e)(f)(g) must NOT report; (a) must. Run with
//   env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node scripts/stuck-hand-check.test.js < /dev/null
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHECK = path.join(__dirname, 'stuck-hand-check.js');
const MIN = 60000;
const T0 = 1800000000000;
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...GIT_ENV } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function fixture(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-hand-'));
  const f = {
    root,
    runs: path.join(root, 'runs'),
    proc: path.join(root, 'proc'),
    wt: path.join(root, 'wt'),
    log: path.join(root, 'run.log'),
    live: path.join(root, 'live'),
    state: path.join(root, 'state.json'),
  };
  for (const d of [f.runs, f.proc, f.wt, f.live]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  git(f.wt, 'init', '-q');
  fs.writeFileSync(path.join(f.wt, 'a.txt'), 'a');
  git(f.wt, 'add', '-A');
  git(f.wt, 'commit', '-q', '-m', 'one');
  fs.writeFileSync(f.log, 'start\n');
  // Pin every mtime into the past so a scan at fake time T0 sees stable values.
  const old = new Date(T0 / 1000 - 7200 * 1000);
  fs.utimesSync(f.log, old, old);
  fs.utimesSync(path.join(f.wt, 'a.txt'), old, old);
  setCpu(f, 4242, 100);
  f.manifest = (over = {}) => fs.writeFileSync(path.join(f.runs, 'r1.manifest.json'), JSON.stringify({
    schema: 1, run_id: 'r1', role: 'implementer', runner: 'codex', model: 'm', lane: 'lane-x', session_id: 'sess-1',
    pid: 4242, log_path: f.log, worktree: f.wt, started_at: 'x', ended_at: null, ...extra, ...over,
  }));
  f.manifest();
  return f;
}

function setCpu(f, pid, ticks) {
  const d = path.join(f.proc, String(pid));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'stat'), `${pid} (a b) S 1 1 1 0 -1 0 0 0 0 0 ${ticks} 0 0 0 20 0 1 0 1 0 0\n`);
}

function env(f, atMin, extra = {}) {
  return { PATH: process.env.PATH, ...GIT_ENV, AUTOPILOT_DISPATCH_RUNS_DIR: f.runs, AUTOPILOT_STUCK_HAND_PROC_ROOT: f.proc,
    AUTOPILOT_STUCK_HAND_STATE: f.state, AUTOPILOT_LIVE_DIR: f.live, AUTOPILOT_STUCK_HAND_NOW: String(T0 + atMin * MIN), ...extra };
}

function check(f, atMin, extra) {
  const r = spawnSync(process.execPath, [CHECK, '--json'], { encoding: 'utf8', env: env(f, atMin, extra), input: '' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('(a) quiet 31 min on output, commit and cpu -> stuck and newly_reported', () => {
  const f = fixture();
  assert.deepEqual(check(f, 0).stuck, []);
  const r = check(f, 31);
  assert.equal(r.stuck.length, 1);
  assert.equal(r.stuck[0].run_id, 'r1');
  assert.equal(r.stuck[0].lane, 'lane-x');
  assert.equal(r.stuck[0].quiet_minutes, 31);
  assert.deepEqual(r.newly_reported, ['r1']);
});

test('(b) second scan: still stuck, not newly reported', () => {
  const f = fixture();
  check(f, 0);
  check(f, 31);
  const r = check(f, 40);
  assert.equal(r.stuck.length, 1);
  assert.deepEqual(r.newly_reported, []);
});

test('(c) output grew -> not stuck', () => {
  const f = fixture();
  check(f, 0);
  fs.appendFileSync(f.log, 'more output\n');
  assert.deepEqual(check(f, 31).stuck, []);
});

test('(d) cpu grew -> not stuck', () => {
  const f = fixture();
  check(f, 0);
  setCpu(f, 4242, 160);
  assert.deepEqual(check(f, 31).stuck, []);
});

test('(d2) a child process burning cpu keeps the parent alive', () => {
  const f = fixture();
  check(f, 0);
  const d = path.join(f.proc, '5000');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'stat'), '5000 (c) S 4242 1 1 0 -1 0 0 0 0 0 7 0 0 0 20 0 1 0 1 0 0\n');
  assert.deepEqual(check(f, 31).stuck, []);
});

test('(e) new commit -> not stuck', () => {
  const f = fixture();
  check(f, 0);
  fs.writeFileSync(path.join(f.wt, 'b.txt'), 'b');
  git(f.wt, 'add', '-A');
  git(f.wt, 'commit', '-q', '-m', 'two');
  const old = new Date(T0 / 1000 - 7200 * 1000);
  fs.utimesSync(path.join(f.wt, 'b.txt'), old, old); // isolate the commit signal from the mtime signal
  assert.deepEqual(check(f, 31).stuck, []);
});

test('(f) 29 minutes quiet -> not stuck', () => {
  const f = fixture();
  check(f, 0);
  assert.deepEqual(check(f, 29).stuck, []);
});

test('(f2) --minutes knob and env knob move the threshold', () => {
  const f = fixture();
  check(f, 0, { AUTOPILOT_STUCK_HAND_MINUTES: '10' });
  assert.equal(check(f, 11, { AUTOPILOT_STUCK_HAND_MINUTES: '10' }).stuck.length, 1);
});

test('(f3) process gone counts as no cpu', () => {
  const f = fixture();
  check(f, 0);
  fs.rmSync(path.join(f.proc, '4242', 'stat'));
  fs.rmdirSync(path.join(f.proc, '4242'));
  assert.equal(check(f, 31).stuck.length, 1);
});

test('(g) ended run is ignored', () => {
  const f = fixture();
  check(f, 0);
  f.manifest({ ended_at: '2026-01-01T00:00:00Z' });
  const r = check(f, 60);
  assert.deepEqual(r.stuck, []);
  assert.deepEqual(r.newly_reported, []);
});
