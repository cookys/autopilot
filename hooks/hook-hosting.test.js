/**
 * Tests for the PERF + STAMP row (mods P1W): the live-state PostToolUse / UserPromptSubmit work runs inside
 * an existing default-on process (audit-log.js hosts awaiting-owner's PostToolUse + the subagent stamp;
 * advisory-relay.js hosts awaiting-owner's UserPromptSubmit work and the runs-watch-autostart ensure)
 * instead of spawning its own.
 *
 * RED record (base w/int 8666aba4, this file copied into that tree): see the report (run-w/perf/red.txt).
 *
 * INT4 hygiene: every temp dir carries a per-run tag; autostart is OFF unless a case drives it; afterEach/after kill the
 * watchers of this run (environ AUTOPILOT_LIVE_DIR check) and rm its dirs; the LAST test fails if anything survives
 * (mutation: teardown dropped -> that test red, run-w/int4/mut-no-teardown.txt).
 *
 * Run: node --test hooks/hook-hosting.test.js      (HOSTING_ROOT=<tree> to aim it at another tree)
 */
'use strict';

const test = require('node:test');
const { afterEach, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = process.env.HOSTING_ROOT || path.join(__dirname, '..');
const AUDIT = path.join(ROOT, 'hooks', 'audit-log.js');
const ATTN = path.join(ROOT, 'hooks', 'awaiting-owner.js');
const RELAY = path.join(ROOT, 'hooks', 'advisory-relay.js');
const SID = 'host-session-0001';
const HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;

// Per-run tag in every temp name: teardown and the final self-check key on it (mods P1W INT4). Before this, each run left
// one detached `status runs --watch --render --idle-exit 3600` plus hh-live/hh-home/hh-repo dirs behind (~1,000 runs/day).
const RUN = crypto.randomBytes(4).toString('hex');
const SHM = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const LIVE_PREFIX = path.join(SHM, `hh-live-${RUN}-`);
const created = [];   // every temp dir this run made, removed by teardown
const track = (d) => { created.push(d); return d; };
function shm(prefix) {
  const d = track(fs.mkdtempSync(path.join(SHM, `${prefix}${RUN}-`)));
  fs.chmodSync(d, 0o700);
  return d;
}
function tmp(prefix) { return track(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${RUN}-`))); }
// Watchers this run's cases started: every process whose environ AUTOPILOT_LIVE_DIR is one of OUR live dirs. The environ
// check is the safety rule (never signal a pid we cannot tie to this run); it covers both the nohup sh wrapper and node.
function ownPids(prefix = LIVE_PREFIX) {
  const out = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const env = fs.readFileSync(`/proc/${name}/environ`, 'utf8').split('\0');
      const l = env.find((e) => e.startsWith('AUTOPILOT_LIVE_DIR='));
      if (l && l.slice('AUTOPILOT_LIVE_DIR='.length).startsWith(prefix)) out.push(Number(name));
    } catch { /* gone or not ours to read */ }
  }
  return out;
}
function stopWatchers(prefix = LIVE_PREFIX) {
  let pids = ownPids(prefix);
  for (let i = 0; i < 20 && pids.length; i++) {
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    pids = ownPids(prefix);
    if (pids.length) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}
function teardown() {
  stopWatchers();
  while (created.length) fs.rmSync(created.pop(), { recursive: true, force: true });
}
afterEach(teardown);
after(teardown);   // safety net: a failing self-check still leaves nothing behind

// Autostart is OFF for every case unless it drives autostart itself (mk({ autostart: true }) / upsFixture): a hook run
// that reaches the full path starts a real detached watcher.
function mk(extra = {}) {
  const { autostart, ...rest } = extra;
  const live = shm('hh-live-');
  const home = tmp('hh-home-');
  const env = { ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, ...rest };
  if (autostart) delete env.AUTOPILOT_RUNS_WATCH_AUTOSTART; else env.AUTOPILOT_RUNS_WATCH_AUTOSTART = '0';
  return { live, home, env };
}
function run(script, payload, env) {
  const r = spawnSync('node', [script], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `exit 0 expected, got ${r.status}: ${r.stderr}`);
  return r;
}
const post = (over = {}) => ({
  session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: os.tmpdir(),
  tool_input: { command: 'ls' }, tool_response: { stdout: 'ok' }, ...over,
});
const agentsDir = (live) => path.join(live, 'agents', SID);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function seedAttention(live, tool = 'Bash') {
  fs.mkdirSync(path.join(live, 'attention'), { recursive: true });
  fs.writeFileSync(path.join(live, 'attention', `${SID}.json`), JSON.stringify({
    schema: 'autopilot.attention/1', session_id: SID, project_key: null, kind: 'permission', tool_name: tool,
    summary: `${tool}: ls`, since: new Date().toISOString(), updated_at: new Date().toISOString(),
  }));
}
const attnFile = (live) => path.join(live, 'attention', `${SID}.json`);
const entries = (event, tool) => {
  const out = [];
  for (const g of HOOKS[event] || []) {
    const m = g.matcher;
    if (!m || m === '*' || new RegExp(`^(?:${m})$`).test(tool || '')) for (const h of g.hooks) out.push(h.command);
  }
  return out;
};

// ---------- wiring: process counts ----------

test('wiring: PostToolUse(Bash) spawns no awaiting-owner process; audit-log is the default-on host', () => {
  const cmds = entries('PostToolUse', 'Bash');
  assert.ok(!cmds.some((c) => c.includes('/hooks/awaiting-owner.js')), 'awaiting-owner must not be a PostToolUse process');
  assert.ok(cmds.some((c) => c.includes('/hooks/audit-log.js')), 'host hook stays wired on PostToolUse .*');
  assert.strictEqual(cmds.length, 7, `7 default-on PostToolUse processes (was 8 with awaiting-owner): ${cmds.join(' | ')}`);
});

test('wiring: UserPromptSubmit spawns ONE process (advisory-relay, timeout 10); autostart + awaiting-owner are hosted; SessionStart keeps its own autostart', () => {
  const ups = entries('UserPromptSubmit', null);
  assert.deepStrictEqual(ups.map((c) => path.basename(c.split(' ')[1])), ['advisory-relay.js']);
  const g = HOOKS.UserPromptSubmit.find((x) => x.hooks.some((h) => h.command.includes('/hooks/advisory-relay.js')));
  assert.strictEqual(g.hooks[0].timeout, 10);
  assert.ok(HOOKS.SessionStart.some((x) => x.hooks.some((h) => h.command.includes('/hooks/runs-watch-autostart.js'))));
});

// ---------- hosted PostToolUse: awaiting-owner behaviour identical ----------

test('host: audit-log ends a pending permission wait for the SAME tool, leaves a different tool, knob off keeps it', () => {
  const a = mk();
  seedAttention(a.live, 'Bash');
  run(AUDIT, post({ tool_name: 'Read' }), a.env);
  assert.ok(fs.existsSync(attnFile(a.live)), 'a different tool must not end the wait');
  run(AUDIT, post(), { ...a.env, AUTOPILOT_AWAITING_OWNER: 'off' });
  assert.ok(fs.existsSync(attnFile(a.live)), 'AUTOPILOT_AWAITING_OWNER=off disables the hosted work');
  run(AUDIT, post(), a.env);
  assert.ok(!fs.existsSync(attnFile(a.live)), 'same tool ends the wait');
});

test('host: no attention pending -> no lock, no file of any kind is created (hot path is one stat)', () => {
  const a = mk();
  run(AUDIT, post(), a.env);
  assert.deepStrictEqual(fs.readdirSync(a.live), [], 'nothing written for a depth-0 call with no pending wait');
});

test('host: another session\'s attention file is untouched', () => {
  const a = mk();
  seedAttention(a.live, 'Bash');
  run(AUDIT, post({ session_id: 'other-session-9999' }), a.env);
  assert.ok(fs.existsSync(attnFile(a.live)));
});

test('host: garbage / empty stdin and missing session_id exit 0 silently', () => {
  const a = mk();
  for (const input of ['', 'not json', '{}', JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })]) {
    const r = spawnSync('node', [AUDIT], { input, encoding: 'utf8', env: a.env });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  }
  assert.deepStrictEqual(fs.readdirSync(a.live), []);
});

test('standalone awaiting-owner.js still handles PostToolUse (direct invocation unchanged)', () => {
  const a = mk();
  seedAttention(a.live, 'Bash');
  run(ATTN, post(), a.env);
  assert.ok(!fs.existsSync(attnFile(a.live)));
});

// ---------- STAMP ----------

test('stamp: subagent tool call writes agents/<sid>/<agent_id>.json with the exact shape', () => {
  const a = mk();
  const before = Date.now();
  run(AUDIT, post({ agent_id: 'agent-abc', agent_type: 'general-purpose', tool_name: 'Grep' }), a.env);
  const f = path.join(agentsDir(a.live), 'agent-abc.json');
  const j = readJ(f);
  assert.deepStrictEqual(Object.keys(j).sort(), ['agent_id', 'agent_type', 'last_tool_at', 'last_tool_name', 'schema', 'session_id']);
  assert.strictEqual(j.schema, 'autopilot.agent-activity/1');
  assert.strictEqual(j.session_id, SID);
  assert.strictEqual(j.agent_id, 'agent-abc');
  assert.strictEqual(j.agent_type, 'general-purpose');
  assert.strictEqual(j.last_tool_name, 'Grep');
  assert.ok(Date.parse(j.last_tool_at) >= before - 1000 && Date.parse(j.last_tool_at) <= Date.now() + 1000);
  assert.deepStrictEqual(fs.readdirSync(agentsDir(a.live)), ['agent-abc.json'], 'no tmp residue, no lock');
});

test('stamp: absent agent_type is null; no agent_id -> no write', () => {
  const a = mk();
  run(AUDIT, post({ agent_id: 'agent-x' }), a.env);
  assert.strictEqual(readJ(path.join(agentsDir(a.live), 'agent-x.json')).agent_type, null);
  const b = mk();
  run(AUDIT, post(), b.env);
  assert.ok(!fs.existsSync(path.join(b.live, 'agents')));
  run(AUDIT, post({ agent_id: '' }), b.env);
  assert.ok(!fs.existsSync(path.join(b.live, 'agents')));
});

test('stamp: last writer wins; separate agents get separate files; sessions are separate dirs', () => {
  const a = mk();
  run(AUDIT, post({ agent_id: 'a1', tool_name: 'Read' }), a.env);
  run(AUDIT, post({ agent_id: 'a1', tool_name: 'Edit' }), a.env);
  run(AUDIT, post({ agent_id: 'a2', tool_name: 'Bash' }), a.env);
  run(AUDIT, post({ agent_id: 'a1', session_id: 'other-session-9999' }), a.env);
  assert.strictEqual(readJ(path.join(agentsDir(a.live), 'a1.json')).last_tool_name, 'Edit');
  assert.deepStrictEqual(fs.readdirSync(agentsDir(a.live)).sort(), ['a1.json', 'a2.json']);
  assert.ok(fs.existsSync(path.join(a.live, 'agents', 'other-session-9999', 'a1.json')));
});

test('stamp: AUTOPILOT_AGENT_ACTIVITY=off writes nothing but the attention end still works', () => {
  const a = mk({ AUTOPILOT_AGENT_ACTIVITY: 'off' });
  seedAttention(a.live, 'Bash');
  run(AUDIT, post({ agent_id: 'a1' }), a.env);
  assert.ok(!fs.existsSync(path.join(a.live, 'agents')));
  assert.ok(!fs.existsSync(attnFile(a.live)), 'awaiting-owner work is independent of the stamp knob');
});

test('stamp: AUTOPILOT_AWAITING_OWNER=off does not disable the stamp (separate knobs)', () => {
  const a = mk({ AUTOPILOT_AWAITING_OWNER: 'off' });
  run(AUDIT, post({ agent_id: 'a1' }), a.env);
  assert.ok(fs.existsSync(path.join(agentsDir(a.live), 'a1.json')));
});

test('stamp: a subagent\'s Task/Agent-named tool event is stamped as liveness only, never as attention', () => {
  const a = mk();
  run(AUDIT, post({ agent_id: 'a1', tool_name: 'Task' }), a.env);
  assert.strictEqual(readJ(path.join(agentsDir(a.live), 'a1.json')).last_tool_name, 'Task');
  assert.ok(!fs.existsSync(path.join(a.live, 'attention')));
});

test('stamp: unsafe ids are sanitised into the file name (no path traversal)', () => {
  const a = mk();
  run(AUDIT, post({ agent_id: '../../evil/x' }), a.env);
  assert.deepStrictEqual(fs.readdirSync(agentsDir(a.live)), ['______evil_x.json']);
  assert.ok(!fs.existsSync(path.join(a.live, 'evil')));
});

test('stamp: fail-open when the live dir is unwritable (exit 0, <= 1 stderr line each)', () => {
  const a = mk();
  fs.writeFileSync(path.join(a.live, 'agents'), 'a file where the dir should be');
  const r = run(AUDIT, post({ agent_id: 'a1' }), a.env);
  assert.ok(r.stderr.split('\n').filter(Boolean).length <= 2, r.stderr);
  assert.strictEqual(r.stdout, '');
});

test('stamp: SessionEnd removes the session\'s stamp dir', () => {
  const a = mk();
  run(AUDIT, post({ agent_id: 'a1' }), a.env);
  assert.ok(fs.existsSync(agentsDir(a.live)));
  run(ATTN, { session_id: SID, hook_event_name: 'SessionEnd', cwd: os.tmpdir() }, a.env);
  assert.ok(!fs.existsSync(agentsDir(a.live)));
});

// ---------- UserPromptSubmit fast path ----------

function shimBin(dir, names) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const real = (n) => execFileSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).trim();
  for (const n of names) {
    fs.writeFileSync(path.join(bin, n), `#!/bin/sh\necho ${n} >> "${path.join(dir, 'calls.log')}"\nexec ${real(n)} "$@"\n`, { mode: 0o755 });
  }
  return bin;
}
const calls = (dir) => { try { return fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const KEY = 'abcdef0123456789';

function fakeWatcher() {
  // argv carries `status runs --watch --project <KEY>`, exactly what isWatcherFor() checks
  const p = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)', 'status', 'runs', '--watch', '--project', KEY], { stdio: 'ignore', detached: true });
  p.unref();
  return p;
}
function seedAutostart(live, cwd, pid) {
  const name = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(live, 'autostart'), { recursive: true });
  fs.writeFileSync(path.join(live, 'autostart', `${name}.json`), JSON.stringify({ cwd, project_key: KEY }));
  fs.mkdirSync(path.join(live, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(live, 'runs', `${KEY}.json`), JSON.stringify({ schema: 'x', writer: { pid } }));
}
const ups = (cwd) => ({ session_id: SID, hook_event_name: 'UserPromptSubmit', cwd, prompt: 'hi' });

function upsFixture() {
  const a = mk({ autostart: true });
  const cwd = fs.realpathSync(tmp('hh-repo-'));
  execFileSync('git', ['-C', cwd, 'init', '-q']);
  // Opted in (mods P1W MARKER): a repo that is not opted in is now rejected WITHOUT spawning git, so tests that
  // exercise the full path (git runs) need the project config the opt-in rule looks for.
  fs.mkdirSync(path.join(cwd, '.claude'));
  fs.writeFileSync(path.join(cwd, '.claude', 'dispatch-config.md'), '# cfg\n');
  const bin = shimBin(a.live, ['git', 'flock']); // installed AFTER the repo is set up: only hook calls are logged
  fs.rmSync(path.join(a.live, 'calls.log'), { force: true });
  a.env.PATH = `${bin}:${process.env.PATH}`;
  // the pointer file lives under the autopilot home derived from the marker dir
  a.env.AUTOPILOT_SESSION_MODE_DIR = path.join(a.home, '.autopilot', 'session-mode');
  fs.mkdirSync(path.join(a.home, '.autopilot'), { recursive: true });
  fs.writeFileSync(path.join(a.home, '.autopilot', 'live-pointer.json'), '{}');
  return { a, cwd };
}

test('ups fast path (advisory-relay host): watcher alive + cached scope -> no git, no flock, no start (one process)', () => {
  const { a, cwd } = upsFixture();
  const w = fakeWatcher();
  try {
    seedAutostart(a.live, cwd, w.pid);
    const r = run(RELAY, ups(cwd), a.env);
    assert.deepStrictEqual(calls(a.live), [], 'neither git nor flock may run on the fast path');
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.stderr, '');
  } finally {
    try { process.kill(w.pid, 'SIGKILL'); } catch { /* gone */ }
  }
});

test('ups fast path falls through to the full path when the pid is dead, the cmdline differs, or the pointer is gone', () => {
  const { a, cwd } = upsFixture();
  // dead pid
  seedAutostart(a.live, cwd, 2 ** 22 + 12345);
  run(RELAY, ups(cwd), { ...a.env, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0' });
  assert.deepStrictEqual(calls(a.live), [], 'knob 0 never reaches git/flock');
  run(RELAY, ups(cwd), a.env);
  assert.ok(calls(a.live).includes('git'), 'dead watcher pid -> full path (git runs)');
  // pid alive but not a watcher for this key
  fs.rmSync(path.join(a.live, 'calls.log'), { force: true });
  const other = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)', 'status', 'runs', '--watch', '--project', 'ffffffffffffffff'], { stdio: 'ignore', detached: true });
  other.unref();
  try {
    seedAutostart(a.live, cwd, other.pid);
    run(RELAY, ups(cwd), a.env);
    assert.ok(calls(a.live).includes('git'), 'foreign cmdline -> full path');
  } finally {
    try { process.kill(other.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  // pointer deleted. The two full-path runs above started REAL watchers (`--render`), and every watcher tick rewrites
  // the live pointer: left running, one could restore the pointer between the rm below and the relay run (the
  // load-only flake of this case). Stop this case's watchers first so nothing can race the deletion.
  stopWatchers(a.live);
  fs.rmSync(path.join(a.live, 'calls.log'), { force: true });
  const w = fakeWatcher();
  try {
    seedAutostart(a.live, cwd, w.pid);
    fs.rmSync(path.join(a.home, '.autopilot', 'live-pointer.json'));
    run(RELAY, ups(cwd), a.env);
    assert.ok(calls(a.live).includes('git'), 'missing live pointer -> full path');
  } finally {
    try { process.kill(w.pid, 'SIGKILL'); } catch { /* gone */ }
  }
});

test('ups: awaiting-owner knob off still runs the autostart ensure; autostart knob 0 still ends attention', () => {
  const { a, cwd } = upsFixture();
  seedAttention(a.live, 'Bash');
  run(RELAY, ups(cwd), { ...a.env, AUTOPILOT_AWAITING_OWNER: 'off', AUTOPILOT_RUNS_WATCH_AUTOSTART: '0' });
  assert.ok(fs.existsSync(attnFile(a.live)), 'awaiting-owner off keeps attention');
  run(RELAY, ups(cwd), { ...a.env, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0' });
  assert.ok(!fs.existsSync(attnFile(a.live)), 'UserPromptSubmit ends attention');
  // knob off for awaiting-owner, autostart enabled: the full path is reached (git runs)
  fs.rmSync(path.join(a.live, 'calls.log'), { force: true });
  run(RELAY, ups(cwd), { ...a.env, AUTOPILOT_AWAITING_OWNER: 'off' });
  assert.ok(calls(a.live).includes('git'));
});

test('ups host: relay still drains its queue; hosted work runs even when the relay knob is off; a hosted failure never changes the output', () => {
  const { a, cwd } = upsFixture();
  seedAttention(a.live, 'Bash');
  fs.mkdirSync(path.join(a.live, 'advisory-queue'), { recursive: true });
  const q = path.join(a.live, 'advisory-queue', `${SID}.jsonl`);
  fs.writeFileSync(q, `${JSON.stringify({ ts: new Date().toISOString(), text: 'queued advice' })}\n`);
  const off = run(RELAY, ups(cwd), { ...a.env, AUTOPILOT_ADVISORY_RELAY: 'off', AUTOPILOT_RUNS_WATCH_AUTOSTART: '0' });
  assert.strictEqual(off.stdout, '', 'relay off emits nothing');
  assert.ok(fs.existsSync(q), 'relay off leaves the queue untouched');
  assert.ok(!fs.existsSync(attnFile(a.live)), 'hosted awaiting-owner work still ended the wait');
  const on = run(RELAY, ups(cwd), { ...a.env, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0' });
  assert.match(JSON.parse(on.stdout).hookSpecificOutput.additionalContext, /queued advice/);
  // hosted job fails (live dir is a file) -> relay output unchanged, exit 0
  const b = mk();
  fs.rmSync(b.live, { recursive: true });
  fs.writeFileSync(b.live, 'not a dir');
  const r = run(RELAY, ups(cwd), { ...b.env, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0' });
  assert.strictEqual(r.stdout, '');
});

test('ups: non-git cwd stays a silent no-op through the host', () => {
  const a = mk({ autostart: true });   // drives the autostart path (a non-git cwd must never start anything)
  const cwd = tmp('hh-nogit-');
  const r = run(RELAY, ups(cwd), a.env);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.stderr, '');
  assert.ok(!fs.existsSync(path.join(a.live, 'autostart')));
});

// ---------- liveBase parity ----------

test('liveBase() (no findmnt fork) resolves to the same base as resolveLiveDir()', () => {
  const a = mk();
  const code = (envOverride) => {
    const r = spawnSync('node', ['-e', `
      const lib=require(${JSON.stringify(path.join(ROOT, 'hooks', 'live-session-lib.js'))});
      const {resolveLiveDir}=require(${JSON.stringify(path.join(ROOT, 'scripts', 'lib', 'live-state-dir.js'))});
      const one=(f)=>{try{return f();}catch(e){return 'refused:'+e.code;}};
      process.stdout.write(JSON.stringify([one(()=>lib.liveBase()), one(()=>resolveLiveDir({warn(){}}).base)]));`], { encoding: 'utf8', env: envOverride });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  // XDG_RUNTIME_DIR pinned to a scratch dir: the no-override case must not touch the real store.
  const base = { ...process.env, XDG_RUNTIME_DIR: a.live };
  for (const env of [{ ...base }, { ...base, AUTOPILOT_LIVE_DIR: a.live }]) {
    const [fast, slow] = code(env);
    assert.strictEqual(fast, slow);
  }
  // An override that cannot be honoured is refused by BOTH (never a different directory): mods P1W LIVEDIR.
  const [fast, slow] = code({ ...base, AUTOPILOT_LIVE_DIR: '/nonexistent-root-xyz/live' });
  assert.strictEqual(fast, 'refused:LIVE_DIR_REFUSED');
  assert.strictEqual(slow, 'refused:LIVE_DIR_REFUSED');
});

// ---------- residue self-check (mods P1W INT4): keep this LAST ----------

test('residue: no watcher of this run survives and none of this run\'s temp dirs remain', () => {
  // afterEach has torn down every earlier case; whatever is left here was leaked by a case.
  assert.deepStrictEqual(ownPids(), [], 'a watcher whose AUTOPILOT_LIVE_DIR is under this run\'s prefix survived');
  assert.deepStrictEqual(created, [], 'temp dirs were not removed by teardown');
  const left = [...fs.readdirSync(SHM), ...fs.readdirSync(os.tmpdir())].filter((n) => n.includes(`-${RUN}-`));
  assert.deepStrictEqual(left, [], 'this run\'s temp dirs remain on disk');
});
