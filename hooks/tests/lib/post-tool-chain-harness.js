#!/usr/bin/env node
'use strict';
/**
 * post-tool-chain differential harness (BL-0241 guard-port Phase 1; plan docs/plans/2026-10-23-guard-port.md).
 *
 * Compares three arms on equal isolated sandboxes (own HOME, TMPDIR, XDG/AUTOPILOT_LIVE_DIR, cwd, env):
 *   orig   the five observers AND all the code they load (hooks/, src/, scripts/ minus hooks/tests) extracted from the pinned sha with git archive, run as separate processes
 *   cur    the five observers as in this tree (export refactor + unchanged CLI wrapper), separate processes
 *   chain  hooks/post-tool-chain.js (one process)
 * Host-visible oracle for a call (plan Phase 1): the five standalone stdout streams concatenated in
 * registration order (pure additionalContext objects merged into one, BL-0304: see hostStdout), stderr likewise, exit = highest of the five. Exit code, stdout and stderr are compared
 * RAW, and so are state files: nothing the observers wrote is rewritten before comparing. Volatile values (clock,
 * hostname, pid) are frozen identically in every process of every arm by ptc-freeze.js (--require via NODE_OPTIONS),
 * and every arm runs in the SAME sandbox paths (recreated before each run), so the bytes are equal by construction.
 * The sandbox lives at ONE fixed absolute path (/tmp/ptc-fixed-sandbox, live dir /dev/shm/ptc-fixed-live), the same on
 * every host and in every arm and run, so the golden file stores the observers' real bytes: no placeholder, no
 * expansion. The three resource paths and the one lock file are CONSTANTS of this file: no environment variable or option
 * changes them, so no second spelling of a resource exists (tests that need other paths run a mutated COPY of this file).
 * The kernel serialises runs: the harness re-executes itself under flock(1) on that one lock file (released by the kernel
 * when the holder dies, SIGKILL included), in its own process group, and the holder proves the lock is its own (inherited
 * descriptor holds it, a fresh descriptor is refused) before it deletes whatever a previous holder may have left.
 *
 * Modes:
 *   check [--chain DIR] [--no-orig] [--overlap-n N]   permanent test: cur == golden, chain == golden,
 *                                                    (orig == golden when the pinned sha is present),
 *   --no-freeze                                      run without ptc-freeze.js (negative control: must go red)
 *                                                    overlapping-call cases; exit 1 on any difference
 *   gen-golden                                       (re)write the golden file from the ORIG arm
 *   serial-orig-vs-cur                               orig vs cur only, no golden
 * `--chain DIR`: directory holding post-tool-chain.js (+ -lib) to test instead of hooks/ (negative controls).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const HOOKS = path.join(REPO, 'hooks');
const GOLDEN = path.join(REPO, 'hooks', 'tests', 'fixtures', 'post-tool-chain', 'golden.json');
const { MEMBERS } = require(path.join(HOOKS, 'post-tool-chain-lib.js'));
const ORIG_REF = '1b4923736'; // BL-0304: re-pinned to the commit whose failure-escalation emits additionalContext (was e5691fb6c)

// ---------- args ----------
// Fixed umask: default-created files/dirs get the same modes on every host (the golden stores modes).
process.umask(0o022);
const args = process.argv.slice(2);
const mode = args[0] || 'check';
function opt(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const chainDir = path.resolve(opt('--chain', HOOKS));
const useOrig = !args.includes('--no-orig');
const overlapN = Number(opt('--overlap-n', '12'));
const onlyOverlap = args.includes('--only-overlap');
const onlyFixtures = opt('--only', '') ? opt('--only', '').split(',') : null; // negative controls name the fixture(s) their mutation must break
const onlyCase = opt('--case', '');
const selected = () => FIXTURES.filter((f) => !onlyFixtures || onlyFixtures.includes(f.name));
const FREEZE = path.join(__dirname, 'ptc-freeze.js');
const freezeOn = !args.includes('--no-freeze');

// ---------- early exit handling, lock, sandbox ----------
function die(msg) { console.error('post-tool-chain-harness: ' + msg); process.exit(2); }

// Resource paths and the lock file: constants (the golden includes them). Nothing in the environment or on the command line
// can change them; the old override variables are refused so a stale use fails loudly instead of being ignored.
const SANDBOX_ROOT = '/tmp/ptc-fixed-sandbox';
const SCRATCH_ROOT = '/tmp/ptc-fixed-scratch';
const LIVE_ROOT = '/dev/shm/ptc-fixed-live';
const LOCK_FILE = '/tmp/ptc-fixed-harness.lock';
for (const v of ['PTC_FIXED_PARENT', 'PTC_FIXED_SHM', 'PTC_LOCK_FILE', 'PTC_FLOCK_HELD']) {
  if (process.env[v] !== undefined) die(`${v} is no longer accepted: the sandbox, scratch, live and lock paths are fixed constants. Tests that need other paths run a relocated copy of this file.`);
}
// Environment/option inventory (none of these touches a resource path or the lock): PTC_LOCK_WAIT_SEC (how long to wait for the
// lock), PTC_TRACE_FILE (append start/end lines), PTC_TEST_DELAY_AFTER_LOCK_MS (holder sleeps after it starts),
// PTC_TEST_DRAIN_MS (how long the outer waits for the group before SIGKILL), PTC_PID (read by ptc-freeze in the CHILDREN, set
// by this file); options --chain/--no-orig/--only/--case/--overlap-n/--only-overlap/--no-freeze/--tag/mode select what is
// compared or labelled; --under-flock is set by the outer run and is VERIFIED (assertIHoldTheLock), not trusted.
const LOCK_WAIT_SEC = Number(process.env.PTC_LOCK_WAIT_SEC || 900);
const DRAIN_MS = Number(process.env.PTC_TEST_DRAIN_MS || 30000);
const underFlock = args.includes('--under-flock');

function checkParent(dir, what) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    const real = fs.realpathSync(dir);
    if (real !== dir) die(`${dir} (${what}) is behind a symlink here (realpath ${real}); the golden needs the literal path`);
  } catch (e) {
    die(`cannot use ${dir} (${what}): missing or not writable (${e.code || e.message}). The differential test needs a writable /tmp and /dev/shm.`);
  }
}
checkParent(path.dirname(SANDBOX_ROOT), 'sandbox and scratch parent');
checkParent(path.dirname(LIVE_ROOT), 'live-state parent');
checkParent(path.dirname(LOCK_FILE), 'lock file parent');

// A relocated COPY of this file (tests) must never share a path with the OFFICIAL set: the official run wipes its resources
// and a copy's lock is a different lock. So every copy, and the official file itself, compares its four canonical paths with
// the official four, written below in a form a path-rewriting copy does not rewrite: the set must be exactly the official one,
// or share no path with it (no equal, ancestor or descendant relation to ANY official path).
const OFFICIAL = {
  sandbox: '/tmp/' + 'ptc-fixed-sandbox', scratch: '/tmp/' + 'ptc-fixed-scratch',
  live: '/dev/shm/' + 'ptc-fixed-live', lock: '/tmp/' + 'ptc-fixed-harness.lock',
};
const canon = (p) => {
  try { return fs.realpathSync(p); } catch { /* not created yet: canonical parent + name */ }
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch { return path.resolve(p); }
};
{
  const mine = { sandbox: SANDBOX_ROOT, scratch: SCRATCH_ROOT, live: LIVE_ROOT, lock: LOCK_FILE };
  const related = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  const keys = Object.keys(OFFICIAL);
  const isOfficial = keys.every((k) => canon(mine[k]) === canon(OFFICIAL[k]));
  if (!isOfficial) {
    for (const k of keys) for (const o of keys) {
      if (related(canon(mine[k]), canon(OFFICIAL[o]))) {
        die(`${mine[k]} (${k}) overlaps the official ${o} path ${OFFICIAL[o]} (equal, ancestor or descendant) without being the official set: a copy must live elsewhere`);
      }
    }
  }
}

if (!underFlock) {
  // Re-run this very command under flock(1) on the one lock file. flock(1) forks its command, so the whole chain is started
  // in its OWN PROCESS GROUP and every signal we get goes to that group; we then wait for the group to be empty.
  const probe = spawnSync('flock', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) die('flock(1) (util-linux) is required to serialise harness runs on the fixed sandbox paths and was not found on PATH');
  console.error(`post-tool-chain-harness: taking ${LOCK_FILE} (waits up to ${LOCK_WAIT_SEC} s if another run holds it)`);
  const child = spawn('flock', ['-E', '75', '-w', String(LOCK_WAIT_SEC), LOCK_FILE, process.execPath, ...process.argv.slice(1), '--under-flock'], {
    stdio: 'inherit', detached: true,
  });
  let signalled = 0;
  const NUM = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };
  for (const sig of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    process.on(sig, () => { if (!signalled) signalled = NUM[sig]; try { process.kill(-child.pid, sig); } catch { /* group already gone */ } });
  }
  const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch { return false; } };
  child.on('close', (code, sigName) => {
    // flock may be gone while the holder is still cleaning up: wait until nothing is left in the group
    const t0 = Date.now();
    let killed = false;
    const finish = () => {
      if (code === 75 && !signalled) die(`could not get ${LOCK_FILE} within ${LOCK_WAIT_SEC} s: another harness run holds the fixed sandbox`);
      process.exit(signalled ? 128 + signalled : code === null ? 128 + (NUM[sigName] || 15) : code);
    };
    const tick = () => {
      if (!groupAlive()) return finish();
      if (!killed && Date.now() - t0 > DRAIN_MS) { killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
      // after SIGKILL keep polling until the group is really empty; give up loudly, never exit as if it were clean
      if (killed && Date.now() - t0 > DRAIN_MS + 10000) { console.error('post-tool-chain-harness: cannot reap the lock-holding process group after SIGKILL'); process.exit(3); }
      return setTimeout(tick, 20);
    };
    tick();
  });
  child.on('error', (e) => die(`cannot start flock: ${e.message}`));
  // park: the child's exit ends us. (Top-level `return` is legal in a CommonJS module.)
  setInterval(() => {}, 1 << 30);
  return;
}

// ---- from here on this process was started by the flock chain ----
if (process.env.PTC_TEST_DELAY_AFTER_LOCK_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.PTC_TEST_DELAY_AFTER_LOCK_MS));
// --under-flock is only a claim; prove the lock is OURS, not merely held by someone: (1) a fresh open file description on the
// lock file must be refused (somebody holds it), and (2) the descriptor flock(1) handed down to us must hold it (flock -n on
// that very descriptor succeeds). A forged flag while another process holds the lock fails (2); with nobody holding it, (1).
function assertIHoldTheLock() {
  const fresh = spawnSync('flock', ['-n', LOCK_FILE, 'true']);
  if (fresh.error) die(`cannot run flock to verify the lock: ${fresh.error.message}`);
  if (fresh.status === 0) die(`--under-flock was given but ${LOCK_FILE} is held by nobody: start the harness without it so it takes the lock itself`);
  let fd = -1;
  for (const n of fs.readdirSync('/proc/self/fd')) {
    try { if (fs.readlinkSync(`/proc/self/fd/${n}`) === LOCK_FILE) { fd = Number(n); break; } } catch { /* fd closed meanwhile */ }
  }
  if (fd < 0) die(`--under-flock was given but this process has no descriptor on ${LOCK_FILE}: the lock is held by someone else, not by this run`);
  const stdio = Array.from({ length: fd + 1 }, (_, i) => (i === fd ? fd : 'ignore'));
  const mine = spawnSync('flock', ['-n', String(fd)], { stdio });
  if (mine.status !== 0) die(`the inherited descriptor ${fd} does not hold ${LOCK_FILE}: refusing to touch the fixed paths`);
}
assertIHoldTheLock();
// Holding the lock means nobody else uses these resources: remove whatever a killed predecessor left.
const wipe = () => { for (const d of [SANDBOX_ROOT, SCRATCH_ROOT, LIVE_ROOT]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } };
wipe();
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
process.on('exit', wipe);
// Children the harness started asynchronously (overlap runs). On a signal they are killed and AWAITED (at most 5 s) before
// the wipe, so none can write a file back after it.
const liveChildren = new Set();
const TRACE = process.env.PTC_TRACE_FILE;
const trace = (what) => { if (TRACE) { try { fs.appendFileSync(TRACE, `${what} ${process.pid} ${process.hrtime.bigint()}\n`); } catch { /* tracing is best effort */ } } };
trace('start');
process.on('exit', () => trace('end'));
let stopping = false;
for (const [sig, n] of [['SIGHUP', 1], ['SIGINT', 2], ['SIGTERM', 15]]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    trace('signal-' + n);
    const closes = [...liveChildren].map((c) => new Promise((res) => c.once('close', res)));
    for (const c of liveChildren) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
    Promise.race([Promise.all(closes), new Promise((res) => setTimeout(res, 5000))]).then(() => process.exit(128 + n));
  });
}
const BASE = SCRATCH_ROOT; // orig-tree scratch only; not part of any compared byte

// hooks dir for the orig arm: hooks/, src/ and scripts/ (minus hooks/tests) extracted from ORIG_REF with `git archive`
// into a scratch root; no symlink may remain in it (checked below), so no byte of HEAD code is loaded.
function buildOrigTree() {
  const rev = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', `${ORIG_REF}^{commit}`], { encoding: 'utf8' });
  if (rev.status !== 0) return null;
  const root = path.join(BASE, 'orig');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  // INDEPENDENCE (BL-0304): every line of code the orig arm runs comes out of ORIG_REF, not out of the tree under test: the
  // whole of hooks/ (observers and everything they require: _shared/, lib/, *-lib.js), src/ and scripts/ are extracted
  // from the pinned commit. Nothing is linked to HEAD; hooks/tests (this harness, the golden, ptc-freeze.js) is excluded.
  const ex = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" -- hooks src scripts ":(exclude)hooks/tests" | tar -x -C "$3"', 'sh', REPO, ORIG_REF, root], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (ex.status !== 0) return null;
  // proof, not trust: no symlink may exist anywhere in the orig tree (a link would lead back to HEAD code or data)
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isSymbolicLink()) die(`orig tree contains a symlink (${p}): the orig arm must run only code extracted from ${ORIG_REF}`); if (e.isDirectory()) walk(p); } };
  walk(root);
  for (const stem of MEMBERS) if (!fs.existsSync(path.join(root, 'hooks', `${stem}.js`))) return null;
  return path.join(root, 'hooks');
}

// The sandbox is recreated empty before every run (arms run one after another).
function newSandbox() {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  for (const d of ['home', 'tmp', 'cwd', 'run']) fs.mkdirSync(path.join(SANDBOX_ROOT, d), { recursive: true });
  fs.rmSync(LIVE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(LIVE_ROOT, { recursive: true, mode: 0o700 });
  const root = SANDBOX_ROOT;
  return { root, home: path.join(root, 'home'), tmp: path.join(root, 'tmp'), cwd: path.join(root, 'cwd'), live: LIVE_ROOT };
}

function sbEnv(sb, extra) {
  const env = {
    PATH: process.env.PATH,
    HOME: sb.home,
    TMPDIR: sb.tmp,
    XDG_RUNTIME_DIR: path.join(sb.root, 'run'),
    AUTOPILOT_LIVE_DIR: sb.live,
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_REVIEW_SERVER_AUTOSTART: '0',
    GIT_CEILING_DIRECTORIES: path.dirname(SANDBOX_ROOT),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    LC_ALL: 'C.UTF-8',
  };
  if (freezeOn) env.NODE_OPTIONS = `--require=${FREEZE}`;
  return Object.assign(env, extra || {});
}

// Lossless storage of arbitrary bytes: UTF-8 text when the bytes survive a decode/encode round trip, base64 otherwise
// (field name + '_b64'). Equal bytes always give equal encodings and different bytes never do, so comparing encodings is
// comparing bytes; a decode is only ever used to make a human-readable message.
function encBytes(buf, name) {
  const t = buf.toString('utf8');
  return Buffer.from(t, 'utf8').equals(buf) ? { [name]: t } : { [name + '_b64']: buf.toString('base64') };
}
function decBytes(obj, name) { return name in obj ? Buffer.from(obj[name], 'utf8') : Buffer.from(obj[name + '_b64'], 'base64'); }

// ---------- state snapshot (raw) ----------
// Nothing is rewritten: names and contents are what the observers wrote (the sandbox path is fixed, so the sha1 of the
// cwd that names the intent record is fixed too).
function snapshot(sb) {
  const out = {};
  const roots = [[sb.root, ''], [sb.live, 'LIVE:']];
  for (const [r, prefix] of roots) {
    (function walk(dir) {
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      ents.sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const e of ents) {
        if (e.name === '.git') continue; // git's own tree (sample hooks, description, config) is git-version state, not hook state
        const full = path.join(dir, e.name);
        const rel = prefix + path.relative(r, full);
        let st;
        try { st = fs.lstatSync(full); } catch { continue; }
        const mode = (st.mode & 0o777).toString(8);
        if (e.isDirectory()) { out[rel + '/'] = { mode }; walk(full); }
        else if (e.isFile()) {
          let buf = null;
          try { buf = fs.readFileSync(full); } catch { /* unreadable: recorded as such */ }
          out[rel] = buf === null ? { mode, unreadable: true } : Object.assign({ mode }, encBytes(buf, 'content'));
        } else out[rel] = { mode, kind: 'other' };
      }
    })(r);
  }
  return out;
}

// ---------- fixtures ----------
const KB = 1024;
function post(tool, input, extra) {
  return JSON.stringify(Object.assign({
    hook_event_name: 'PostToolUse', session_id: 'sess-ptc', tool_name: tool, tool_input: input,
    tool_response: 'ok',
  }, extra || {}));
}
const bashOk = (cmd) => post('Bash', { command: cmd }, { exit_code: 0, tool_response: 'fine' });
const bashFail = (cmd, extra) => post('Bash', { command: cmd }, Object.assign({ exit_code: 1, tool_response: 'boom' }, extra || {}));

function seedReload(sb, { changed }) {
  // cwd watch file with a fixed mtime; the state remembers an older (or the same) mtime
  const watch = path.join(sb.cwd, '.claude', 'dispatch-config.md');
  fs.mkdirSync(path.dirname(watch), { recursive: true });
  fs.writeFileSync(watch, 'cfg');
  fs.utimesSync(watch, 1700000000, 1700000000);
  const st = fs.statSync(watch).mtimeMs;
  const stateDir = path.join(sb.home, '.claude', 'plugins');
  fs.mkdirSync(stateDir, { recursive: true });
  const state = {
    [path.join(sb.home, '.claude/plugins/installed_plugins.json')]: null,
    [watch]: changed ? st - 5000 : st,
    [path.join(sb.cwd, '.claude/settings.local.json')]: null,
  };
  fs.writeFileSync(path.join(stateDir, '.reload-watch-state.json'), JSON.stringify(state, null, 2));
}
function seedFailureCount(sb, n, sessionId) {
  const dir = path.join(sb.home, '.autopilot');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const h = crypto.createHash('md5').update(sessionId).digest('hex').slice(0, 8);
  fs.writeFileSync(path.join(dir, `.failure_count_${h}`), String(n), { mode: 0o600 });
}

// Creates a pending permission/question attention entry through the real awaiting-owner CLI in the sandbox.
function seedAttention(sb, tool, input) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'awaiting-owner.js')], {
    input: JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 'sess-ptc', cwd: sb.cwd, tool_name: tool, tool_input: input }),
    cwd: sb.cwd, env: sbEnv(sb),
  });
  if (r.status !== 0) throw new Error('seedAttention failed: ' + r.stderr);
}

const HUGE = 'error ENOENT fatal: '.repeat(80 * KB / 20 * 16); // ~1.28 MB

const FIXTURES = [
  { name: 'quiet-bash-success', steps: [bashOk('echo ok')] },
  { name: 'bash-fail-escalation-ladder', steps: [1, 2, 3, 4, 5, 6].map((i) => bashFail(`false ${i}`)) },
  { name: 'bash-fail-then-reset', steps: [bashFail('false'), bashFail('false'), bashOk('true'), bashFail('false')] },
  { name: 'bash-fail-pattern-exit0', steps: [post('Bash', { command: 'x' }, { exit_code: 0, tool_output: 'Traceback (most recent call last)' }), post('Bash', { command: 'x' }, { tool_result: { exitCode: 3 } })] },
  { name: 'reload-first-run-silent', steps: [post('Read', { file_path: '/x' })] },
  { name: 'reload-change-emits', setup: (sb) => seedReload(sb, { changed: true }), steps: [post('Read', { file_path: '/x' }), post('Read', { file_path: '/x' })] },
  { name: 'reload-and-failure-both-emit', setup: (sb) => { seedReload(sb, { changed: true }); seedFailureCount(sb, 1, 'sess-ptc'); }, steps: [bashFail('false')] },
  { name: 'none-emit-read', setup: (sb) => seedReload(sb, { changed: false }), steps: [post('Read', { file_path: '/x' }, { tool_response: 'all good' })] },
  { name: 'empty-stdin', steps: [''] },
  { name: 'invalid-json', steps: ['not json {'] },
  { name: 'json-null', steps: ['null'] },
  { name: 'non-utf8-bytes', steps: [Buffer.from([0x7b, 0xff, 0xfe, 0x7d])] },
  { name: 'huge-payload', steps: [post('Bash', { command: 'cat big' }, { exit_code: 1, tool_response: HUGE })] },
  { name: 'ask-user-question-live-state', steps: [post('AskUserQuestion', { questions: [{ question: 'q?' }] })] },
  { name: 'attention-pending-resolved-by-posttool', setup: (sb) => seedAttention(sb, 'AskUserQuestion', { questions: [{ question: 'q?' }] }), steps: [post('AskUserQuestion', { questions: [{ question: 'q?' }] }, { cwd: '/x' })] },
  { name: 'bash-secret-redaction-multiline', steps: [bashOk('echo "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"\nsecond line')] },
  { name: 'log-error-keyword-read', steps: [post('Read', { file_path: '/x' }, { tool_response: 'permission denied while reading' }), post('Edit', { file_path: '/y' }, { is_error: true, tool_response: 'x' })] },
  { name: 'intent-disable-flag-active', setup: (sb) => { const d = path.join(sb.home, '.autopilot'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'intent-capture.disabled'), JSON.stringify({ disabled_at: '2026-01-01T00:00:00.000Z', reason: 'x', plugin_version: 'unknown' })); }, steps: [bashOk('echo hi')] },
  { name: 'intent-breaker-trips', setup: (sb) => { const d = path.join(sb.home, '.autopilot'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.intent-capture-failures'), '9'); fs.writeFileSync(path.join(d, 'intent'), 'not a dir'); }, steps: [bashOk('echo hi'), bashOk('echo again')] },
  { name: 'home-dot-claude-is-a-file', setup: (sb) => { fs.writeFileSync(path.join(sb.home, '.claude'), 'file'); }, steps: [post('Bash', { command: 'echo err' }, { exit_code: 0, tool_response: 'error: nope' })] },
  { name: 'transcript-fallback', env: { CLAUDE_CODE_SESSION_ID: 'dddd0000-1111-2222-3333-444455556666' }, setup: (sb) => { const t = path.join(sb.home, '.claude', 'projects', '-enc'); fs.mkdirSync(t, { recursive: true }); fs.writeFileSync(path.join(t, 'dddd0000-1111-2222-3333-444455556666.jsonl'), [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'echo from-transcript' } }] } }), JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'error: failed', is_error: true }] } })].join('\n') + '\n'); }, steps: ['', ''] },
  { name: 'no-session-id-ppid-hash', steps: [JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'f' }, exit_code: 2 }), JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'f' }, exit_code: 2 })] },
  { name: 'intent-env-opt-out', env: { AUTOPILOT_INTENT_CAPTURE: 'false' }, steps: [bashOk('echo hi')] },
  { name: 'literal-timestamp-hostname-pid-in-user-text', steps: [post('Bash', { command: 'echo "2026-01-01T00:00:00.123Z build-host-1 f.4242.tmp"' }, { exit_code: 0, tool_response: 'error: at 2026-02-02T02:02:02.222Z on build-host-1' })] },
  { name: 'user-error-text-with-heading-shaped-line', steps: [post('Read', { file_path: '/x' }, { tool_response: 'error: first\n### 2026-03-03T03:03:03.333Z\n**Tool:** not-a-heading\nlast' })] },
  { name: 'user-error-text-embeds-terminator-and-heading', steps: [post('Read', { file_path: '/x' }, { tool_response: 'error: before\n```\n**Solution:** (fill in after fix)\n\n---\n### 2026-03-03T03:03:03.333Z\n**Tool:** fake\n**Input:** `{}`\n```\nafter' })] },
  { name: 'user-text-with-placeholder-lookalikes-and-sandbox-path', steps: [post('Bash', { command: 'echo "<ROOT> <LIVE> <CWDSHA1> <CWDSHA12> <TS> <HOST> /tmp/ptc-fixed-sandbox/home /dev/shm/ptc-fixed-live"' }, { exit_code: 1, tool_response: 'error: <ROOT>/x <CWDSHA12> /tmp/ptc-fixed-sandbox/cwd <LIVE>' })] },
  { name: 'lone-surrogate-escape-in-error-text', steps: ['{"hook_event_name":"PostToolUse","session_id":"s","tool_name":"Read","tool_input":{"file_path":"/x"},"tool_response":"error: bad \\ud800 byte"}'] },
  { name: 'git-cwd-branch', setup: (sb) => { const env = sbEnv(sb, { GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' }); spawnSync('git', ['init', '-q', '-b', 'main', sb.cwd], { env }); spawnSync('git', ['-C', sb.cwd, 'commit', '-q', '--allow-empty', '-m', 'i'], { env }); }, steps: [bashOk('echo hi')] },
];

// ---------- running ----------
function observerPath(dir, stem) { return path.join(dir, `${stem}.js`); }

function spawnOnce(script, argv, input, sb, extraEnv) {
  const r = spawnSync(process.execPath, [script, ...argv], {
    input, cwd: sb.cwd, env: sbEnv(sb, extraEnv), maxBuffer: 1 << 27, timeout: 60000,
  });
  return { code: r.status === null ? -1 : r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0) };
}

// one call = the five observers as separate processes, in registration order
function runSeparate(dir, input, sb, extraEnv) {
  return MEMBERS.map((stem) => Object.assign({ hook: stem }, spawnOnce(observerPath(dir, stem), [], input, sb, extraEnv)));
}
// BL-0304 host-visible stdout: the host parses stdout only when it is ONE JSON object, so the observers' pure
// {hookSpecificOutput:{hookEventName,additionalContext}} objects (reload-watch, failure-escalation) are one object
// whose texts are joined by "\n"; any other stdout stays in order in front of it. Deliberately NOT the chain's own code
// (independent re-derivation): this file parses with plain JSON.parse and builds the object itself.
function pureContext(buf) {
  let o;
  try { o = JSON.parse(buf.toString('utf8')); } catch { return null; }
  const h = o && typeof o === 'object' && Object.keys(o).length === 1 ? o.hookSpecificOutput : null;
  if (!h || typeof h !== 'object' || Object.keys(h).sort().join() !== 'additionalContext,hookEventName') return null;
  return typeof h.additionalContext === 'string' && typeof h.hookEventName === 'string' ? h : null;
}
function hostStdout(bufs) {
  const rest = [], ctx = [];
  for (const b of bufs) { const h = b.length ? pureContext(b) : null; if (h) ctx.push({ b, h }); else rest.push(b); }
  if (ctx.length === 1) rest.push(ctx[0].b);
  else if (ctx.length > 1) {
    const ev = [...new Set(ctx.map((c) => c.h.hookEventName))];
    if (ev.length === 1) rest.push(Buffer.from(JSON.stringify({ hookSpecificOutput: { hookEventName: ev[0], additionalContext: ctx.map((c) => c.h.additionalContext).join('\n') } }) + '\n'));
    else for (const c of ctx) rest.push(c.b);
  }
  return Buffer.concat(rest);
}
function aggregate(per) {
  return {
    code: Math.max(...per.map((p) => p.code)),
    stdout: hostStdout(per.map((p) => p.stdout)),
    stderr: Buffer.concat(per.map((p) => p.stderr)),
  };
}
function runChainCall(input, sb, extraEnv, argv) {
  return spawnOnce(path.join(chainDir, 'post-tool-chain.js'), argv || [], input, sb, extraEnv);
}

function runFixture(fx, arm, origDir) {
  const sb = newSandbox();
  if (fx.setup) fx.setup(sb);
  const steps = [];
  for (const input of fx.steps) {
    if (arm === 'chain' || arm === 'chain-rev') {
      const r = runChainCall(input, sb, fx.env, arm === 'chain-rev' ? MEMBERS.slice().reverse() : []);
      steps.push({ agg: r });
    } else {
      const per = runSeparate(arm === 'orig' ? origDir : HOOKS, input, sb, fx.env);
      steps.push({ per, agg: aggregate(per) });
    }
  }
  const state = snapshot(sb);
  return { steps, state, sb };
}

// Golden bytes are the observers' real bytes (encBytes: text when lossless, base64 otherwise), compared as bytes.
function aggJson(a) { return Object.assign({ code: a.code }, encBytes(a.stdout, 'stdout'), encBytes(a.stderr, 'stderr')); }
function toGolden(res) {
  return {
    steps: res.steps.map((s) => ({ per: s.per ? s.per.map((p) => Object.assign({ hook: p.hook }, aggJson(p))) : undefined, agg: aggJson(s.agg) })),
    state: res.state,
  };
}

// ---------- comparison ----------
const problems = [];
function bad(msg) { problems.push(msg); }
function cmpAgg(label, got, want, sb) {
  // want: golden aggJson (templated text). Raw byte compare against the expansion.
  if (got.code !== want.code) bad(`${label}: exit ${got.code} != ${want.code}`);
  const wo = decBytes(want, 'stdout'), we = decBytes(want, 'stderr');
  if (!got.stdout.equals(wo)) bad(`${label}: stdout bytes differ (${got.stdout.length} vs ${wo.length})`);
  if (!got.stderr.equals(we)) bad(`${label}: stderr bytes differ (${got.stderr.length} vs ${we.length})`);
}
function cmpState(label, got, want) {
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const k of [...keys].sort()) {
    const a = got[k], b = want[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) bad(`${label}: state differs at ${k}: ${a === undefined ? 'missing' : 'present'} vs ${b === undefined ? 'missing' : 'present'}${a && b ? ` (${JSON.stringify(a).slice(0, 160)} != ${JSON.stringify(b).slice(0, 160)})` : ''}`);
  }
}

// ---------- overlapping calls ----------
function perms(a) { if (a.length <= 1) return [a]; const o = []; a.forEach((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).forEach((p) => o.push([x, ...p]))); return o; }

function outcomeKey(perCall, state) { return JSON.stringify({ calls: perCall.map((a) => aggJson(a)), state }); }

const OVERLAP_CASES = [
  { name: 'two-failing-bash-same-session', sem: { fc: { init: 0, inc: 2, reset: false }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, calls: () => [bashFail('false a'), bashFail('false b')] },
  { name: 'fail-and-success-same-session', sem: { fc: { init: 1, inc: 1, reset: true }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, setup: (sb) => seedFailureCount(sb, 1, 'sess-ptc'), calls: () => [bashFail('false'), bashOk('true')] },
  { name: 'three-failing-bash-same-session', sem: { fc: { init: 0, inc: 3, reset: false }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 3, reset: false } }, calls: () => [bashFail('false a'), bashFail('false b'), bashFail('false c')] },
  { name: 'intent-breaker-pair', sem: { ifail: { init: 8, inc: 2, reset: false }, tc: { init: 0, inc: 2, reset: false }, optional: [/^home\/\.autopilot\/intent-capture\.disabled$/] }, setup: (sb) => { const d = path.join(sb.home, '.autopilot'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.intent-capture-failures'), '8'); fs.writeFileSync(path.join(d, 'intent'), 'not a dir'); }, calls: () => [bashOk('echo 1'), bashOk('echo 2')] },
  { name: 'reload-change-pair', sem: { ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, setup: (sb) => seedReload(sb, { changed: true }), calls: () => [post('Read', { file_path: '/a' }), post('Read', { file_path: '/b' })] },
  { name: 'same-cwd-intent-and-log-pair', sem: { ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, calls: () => [post('Read', { file_path: '/a' }, { tool_response: 'error one' }), post('Bash', { command: 'echo two' }, { exit_code: 0, tool_response: 'error two' })] },
];

function serialOutcome(oc, order, calls, origOrCur) {
  const sb = newSandbox();
  if (oc.setup) oc.setup(sb);
  const perCall = new Array(calls.length);
  for (const idx of order) {
    perCall[idx] = aggregate(runSeparate(origOrCur, calls[idx], sb, { PTC_PID: String(4242 + 10 * idx) }));
  }
  return outcomeKey(perCall, snapshot(sb));
}

function runConcurrent(oc, calls, side) {
  const sb = newSandbox();
  if (oc.setup) oc.setup(sb);
  const procs = []; // {call, hook, child, chunks}
  const t0 = process.hrtime.bigint();
  const spawnTimes = [];
  calls.forEach((input, ci) => {
    const scripts = side === 'chain' ? [{ hook: 'chain', file: path.join(chainDir, 'post-tool-chain.js') }] : MEMBERS.map((stem) => ({ hook: stem, file: path.join(HOOKS, `${stem}.js`) }));
    for (const s of scripts) {
      const child = spawn(process.execPath, [s.file], { cwd: sb.cwd, env: sbEnv(sb, { PTC_PID: String(4242 + 10 * ci) }), stdio: ['pipe', 'pipe', 'pipe'] });
      spawnTimes.push(process.hrtime.bigint() - t0);
      const rec = { call: ci, hook: s.hook, out: [], err: [], code: null };
      child.stdout.on('data', (d) => rec.out.push(d));
      child.stderr.on('data', (d) => rec.err.push(d));
      rec.done = new Promise((res) => child.on('close', (c) => { rec.code = c === null ? -1 : c; res(); }));
      rec.child = child;
      liveChildren.add(child);
      child.on('close', () => liveChildren.delete(child));
      procs.push(rec);
    }
  });
  return { sb, procs, calls, spawnTimes, t0 };
}

// Blocks until every child is parked reading fd 0 (kernel wait channel shows a pipe read), i.e. node start-up
// and module loading are done; falls back to a fixed 6 s ceiling. Releasing then is a tight loop of stdin writes.
async function waitParked(run) {
  // x86_64 Linux: /proc/<pid>/syscall begins "0 0x0 " while the main thread sits in read(0, ...). Elsewhere the
  // wait channel names a pipe/socket wait. No /proc at all: a flat 1.5 s settle (overlap is then best-effort).
  const hasProc = fs.existsSync('/proc/self/syscall') || fs.existsSync('/proc/self/wchan');
  if (!hasProc) { await new Promise((r) => setTimeout(r, 1500)); return; }
  const deadline = Date.now() + 6000;
  const rd = (pid, f) => { try { return fs.readFileSync(`/proc/${pid}/${f}`, 'utf8'); } catch { return ''; } };
  const parked = (pid) => /^0 0x0 /.test(rd(pid, 'syscall')) || /pipe|unix_stream|sk_wait/.test(rd(pid, 'wchan'));
  while (Date.now() < deadline && !run.procs.every((p) => parked(p.child.pid))) await new Promise((r) => setTimeout(r, 15));
}

async function releaseAndCollect(run) {
  await waitParked(run);
  const rel0 = process.hrtime.bigint();
  const relTimes = [];
  for (const p of run.procs) { p.child.stdin.end(run.calls[p.call]); relTimes.push(process.hrtime.bigint() - rel0); }
  await Promise.all(run.procs.map((p) => p.done));
  const perCall = run.calls.map((_, ci) => aggregate(run.procs.filter((p) => p.call === ci).map((p) => ({ code: p.code, stdout: Buffer.concat(p.out), stderr: Buffer.concat(p.err) }))));
  return { perCall, state: snapshot(run.sb), spreadUs: Number(relTimes[relTimes.length - 1]) / 1000 };
}

async function sample(oc, side, n, stats) {
  const keys = [];
  for (let i = 0; i < n; i++) {
    const run = runConcurrent(oc, oc.calls(), side);
    const res = await releaseAndCollect(run);
    stats.spreads.push(res.spreadUs);
    keys.push(outcomeKey(res.perCall, res.state));
  }
  return keys;
}

// Acceptance for overlapping calls (plan Phase 1, replaced by depth-0 ruling 2026-10-25: INVARIANTS instead of
// "equals some serial order"). Reason: the separate-process baseline itself loses updates on shared counters when
// calls overlap tightly (failure counters, the intent-capture breaker counter, reload-watch state): it is not a
// serial outcome in 70-100% of tight-overlap samples (reported as baseline_non_serial). The chain runs the same
// hook bodies and only removes concurrency between ONE call's own hooks, so each schedule it produces is one the
// baseline can produce; what must hold is an invariant of every such outcome. Observed set O = every serial
// outcome plus the baseline's own 2n samples. A chain outcome FAILS when any of these breaks:
//   per call:  exit code, stdout and stderr are each a value seen in O (few values: empty / escalation text);
//   per path:  the path exists in the chain outcome if it exists in every outcome of O (except a path the case declares
//              optional: the breaker's flag file exists only if no update was lost), and no path appears that
//              never appears in O (lock / tmp residue);
//   mode:      the file/dir mode is one seen in O for that path;
//   content:   a counter file holds an integer inside the range REACHABLE FROM THE CALLS' OPERATIONS (rangeOf: each case declares
//              init / number of +1 calls / whether some call resets to 0), not a range padded around what was sampled; a JSON object file parses,
//              has a key set seen in O, and the intent record's tool_count_session obeys the tool counter's range while every other field
//              equals a value seen in O; any other text file has the same line count range as O and every line
//              a line seen in O.
function collect(keys) {
  const out = new Map(), perPath = new Map();
  let outcomes = 0;
  for (const k of keys) {
    outcomes++;
    const o = JSON.parse(k);
    o.calls.forEach((c, i) => { for (const f of ['code', 'stdout', 'stderr']) { const n = `call${i}.${f}`; if (!out.has(n)) out.set(n, new Set()); out.get(n).add(JSON.stringify(c[f])); } });
    for (const [pth, e] of Object.entries(o.state)) { if (!perPath.has(pth)) perPath.set(pth, []); perPath.get(pth).push(e); }
  }
  return { out, perPath, outcomes };
}
// Reachable range of a counter from the operations of the overlapping calls (ruling: no free-floating slack).
//   init:  value before the group;  inc: number of calls that do read-modify-write "+1";
//   reset: some call writes 0 (a success branch).
// Every written value is (a value read) + 1 with the value read in {init, anything written earlier, 0 for a read of
// a file caught mid-rewrite}, so no value exceeds init + inc; without a reset op every write is >= 1, so the file
// is >= 1 whenever some call increments and stays init when none does. With a reset op the file may end at 0.
function rangeOf({ init, inc, reset }) {
  return { lo: reset ? 0 : (inc > 0 ? 1 : init), hi: init + inc };
}
const COUNTER_FILES = [
  [/^home\/\.autopilot\/\.failure_count_[0-9a-f]{8}$/, 'fc'],        // failure-escalation: failing Bash +1, success -> 0
  [/^home\/\.autopilot\/\.intent-capture-failures$/, 'ifail'],       // intent-capture: failed record write +1, success -> 0
  [/^tmp\/claude-intent-tool-count-[0-9a-f]{12}$/, 'tc'],                  // intent-capture tool counter: +1 per call
];
function counterKind(pth) { const m = COUNTER_FILES.find(([re]) => re.test(pth)); return m ? m[1] : null; }

function contentProblem(pth, content, observed, sem) {
  const vals = observed.map((e) => e.content).filter((c) => typeof c === 'string');
  if (vals.length === 0) return null;
  const isInt = (c) => /^\d+$/.test(c);
  if (vals.every(isInt)) {
    if (!isInt(content)) return `${pth}: counter content "${String(content).slice(0, 40)}" is not an integer`;
    const v = Number(content);
    const kind = counterKind(pth);
    if (kind) {
      if (!sem[kind]) return `${pth}: a ${kind} counter file exists but the case declares no operations for it`;
      const r = rangeOf(sem[kind]);
      if (v < r.lo || v > r.hi) return `${pth}: counter ${v} outside the range [${r.lo}, ${r.hi}] reachable from these calls' operations (${JSON.stringify(sem[kind])})`;
      return null;
    }
    return vals.includes(content) ? null : `${pth}: unmodelled numeric file holds ${v}, never observed`;
  }
  const parse = (c) => { try { const o = JSON.parse(c); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; } };
  if (vals.every((c) => parse(c) !== null)) {
    const o = parse(content);
    if (o === null) return `${pth}: content is no longer a JSON object`;
    const objs = vals.map(parse);
    const keySig = (x) => JSON.stringify(Object.keys(x).sort());
    if (!objs.some((x) => keySig(x) === keySig(o))) return `${pth}: key set ${keySig(o)} never observed`;
    for (const [key, v] of Object.entries(o)) {
      const seen = objs.filter((x) => key in x).map((x) => x[key]);
      if (key === 'tool_count_session' && /\/intent\//.test(pth)) { // the tool counter's value after this call's +1
        if (!sem.tc) return `${pth}: tool_count_session present but the case declares no tc operations`;
        const r = rangeOf(sem.tc);
        if (typeof v !== 'number' || v < Math.max(1, r.lo) || v > r.hi) return `${pth}: tool_count_session=${JSON.stringify(v)} outside [${Math.max(1, r.lo)}, ${r.hi}]`;
      } else if (!seen.some((x) => JSON.stringify(x) === JSON.stringify(v))) return `${pth}: field ${key}=${JSON.stringify(v).slice(0, 80)} never observed`;
    }
    return null;
  }
  const lines = (c) => c.split('\n');
  const counts = vals.map((c) => lines(c).length);
  const seenLines = new Set(vals.flatMap(lines));
  const l = lines(content);
  if (l.length < Math.min(...counts) || l.length > Math.max(...counts)) return `${pth}: ${l.length} lines outside observed [${Math.min(...counts)}, ${Math.max(...counts)}]`;
  const stray = l.find((x) => !seenLines.has(x));
  return stray === undefined ? null : `${pth}: line never observed: ${stray.slice(0, 80)}`;
}
function judge(keys, acc, sem) {
  const failing = [];
  // Dead-declaration guard: each counter the case declares must match at least one state file in the observed set,
  // otherwise its range is never applied (a regex that stopped matching would silently weaken the check).
  for (const kind of ['fc', 'ifail', 'tc']) {
    if (sem[kind] && ![...acc.perPath.keys()].some((pth) => counterKind(pth) === kind)) failing.push(`declared ${kind} counter matches no state file (dead declaration)`);
  }
  for (const k of keys) {
    const o = JSON.parse(k);
    o.calls.forEach((c, i) => { for (const f of ['code', 'stdout', 'stderr']) { const n = `call${i}.${f}`; if (!acc.out.has(n) || !acc.out.get(n).has(JSON.stringify(c[f]))) failing.push(`${n} = ${JSON.stringify(c[f]).slice(0, 120)}`); } });
    for (const [pth, observed] of acc.perPath) {
      if (observed.length === acc.outcomes && !(pth in o.state) && !(sem.optional || []).some((re) => re.test(pth))) failing.push(`${pth}: missing (present in every observed outcome)`);
    }
    for (const [pth, e] of Object.entries(o.state)) {
      const observed = acc.perPath.get(pth);
      if (!observed) { failing.push(`${pth}: path never seen in serial/baseline`); continue; }
      if (!observed.some((x) => x.mode === e.mode)) failing.push(`${pth}: mode ${e.mode} (observed ${[...new Set(observed.map((x) => x.mode))].join(',')})`);
      if (e.content_b64 !== undefined && !observed.some((x) => x.content_b64 !== undefined)) failing.push(`${pth}: content is no longer valid UTF-8 text (observed outcomes are text)`);
      if (typeof e.content === 'string') { const pr = contentProblem(pth, e.content, observed, sem); if (pr) failing.push(pr); }
    }
  }
  return { failing };
}

async function runOverlap() {
  const report = [];
  for (const oc of OVERLAP_CASES.filter((c) => !onlyCase || c.name === onlyCase)) {
    const calls = oc.calls();
    const serial = [];
    for (const order of perms(calls.map((_, i) => i))) serial.push(serialOutcome(oc, order, calls, HOOKS));
    const stats = { spreads: [] };
    const baseKeys = await sample(oc, 'separate', overlapN * 2, stats);
    const chainKeys = await sample(oc, 'chain', overlapN, stats);
    const serialSet = new Set(serial);
    const verdict = judge(chainKeys, collect([...serial, ...baseKeys]), oc.sem);
    const sp = stats.spreads.slice().sort((a, b) => a - b);
    report.push({ case: oc.name, serial_outcomes: serialSet.size, baseline_n: baseKeys.length, baseline_non_serial: baseKeys.filter((k) => !serialSet.has(k)).length, chain_n: chainKeys.length, chain_non_serial: chainKeys.filter((k) => !serialSet.has(k)).length, chain_failing_components: verdict.failing.length, release_spread_us_p50: Math.round(sp[Math.floor(sp.length / 2)]), release_spread_us_max: Math.round(sp[sp.length - 1]) });
    if (verdict.failing.length > 0) bad(`overlap ${oc.name}: ${[...new Set(verdict.failing)].slice(0, 4).join(' | ')}`);
  }
  return report;
}

// ---------- main ----------
// The serial corpus is synchronous (spawnSync); a signal handler only runs when the event loop turns, so every fixture
// starts with a turn. Without it a TERM waits for the whole corpus and the cleanup misses its window.
const yieldToSignals = () => new Promise((res) => setImmediate(res));

async function main() {
  const origDir = useOrig ? buildOrigTree() : null;
  if (mode === 'gen-golden') {
    if (!origDir) { console.error('gen-golden needs the pinned sha in this clone'); process.exit(2); }
    const golden = { source_ref: ORIG_REF, source_sha: spawnSync('git', ['-C', REPO, 'rev-parse', ORIG_REF], { encoding: 'utf8' }).stdout.trim(), fixtures: {} };
    for (const fx of FIXTURES) { await yieldToSignals(); golden.fixtures[fx.name] = toGolden(runFixture(fx, 'orig', origDir)); }
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n');
    console.log(`golden written: ${GOLDEN} (${FIXTURES.length} fixtures, source ${golden.source_sha})`);
    return;
  }
  if (mode === 'serial-orig-vs-cur') {
    for (const fx of selected()) {
      await yieldToSignals();
      const a = toGolden(runFixture(fx, 'orig', origDir));
      const b = toGolden(runFixture(fx, 'cur', origDir));
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        bad(`${fx.name}: orig != cur`);
        if (process.env.PTC_DEBUG) {
          a.steps.forEach((s, i) => { if (JSON.stringify(s) !== JSON.stringify(b.steps[i])) console.error('step', i, JSON.stringify(s).slice(0, 700), '\nVS\n', JSON.stringify(b.steps[i]).slice(0, 700)); });
          cmpState(`${fx.name} orig-vs-cur`, b.state, a.state);
        }
      }
    }
  } else if (!onlyOverlap) {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    for (const fx of selected()) {
      await yieldToSignals();
      const want = golden.fixtures[fx.name];
      if (!want) { bad(`${fx.name}: missing from golden`); continue; }
      const arms = ['cur', 'chain', 'chain-rev'];
      if (origDir) arms.unshift('orig');
      for (const arm of arms) {
        const res = runFixture(fx, arm, origDir);
        res.steps.forEach((s, i) => {
          let wantAgg = want.steps[i].agg;
          if (arm === 'chain-rev') {
            // members are independent: the reversed chain's streams are the per-hook golden streams, reversed
            const rev = want.steps[i].per.slice().reverse();
            wantAgg = Object.assign({ code: Math.max(...rev.map((x) => x.code)) }, encBytes(hostStdout(rev.map((x) => decBytes(x, 'stdout'))), 'stdout'), encBytes(Buffer.concat(rev.map((x) => decBytes(x, 'stderr'))), 'stderr'));
          }
          cmpAgg(`${fx.name}[${i}] ${arm} aggregate`, s.agg, wantAgg, res.sb);
          if (arm !== 'chain' && arm !== 'chain-rev') s.per.forEach((p, j) => cmpAgg(`${fx.name}[${i}] ${arm} ${p.hook}`, p, want.steps[i].per[j], res.sb));
        });
        cmpState(`${fx.name} ${arm}`, res.state, want.state);
      }
    }
    console.log(`serial corpus: ${selected().length} fixtures, arms ${origDir ? 'orig,' : '(orig skipped: pinned sha absent) '}cur,chain,chain-rev`);
  }
  if (mode === 'check' && overlapN > 0) {
    const rep = await runOverlap();
    console.log('overlap report ' + JSON.stringify(rep));
  }
  if (problems.length) {
    console.error(`HARNESS RED: ${problems.length} difference(s)`);
    for (const p of problems.slice(0, 40)) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('HARNESS GREEN');
}

main().catch((e) => { console.error('harness error: ' + (e && e.stack || e)); process.exit(2); });
