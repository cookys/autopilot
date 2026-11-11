#!/usr/bin/env node
'use strict';
// seed-claude-config.js — build a throwaway CLAUDE_CONFIG_DIR for a claude child.
//
//   node scripts/lib/seed-claude-config.js [--parent DIR] [--check]
//   node scripts/lib/seed-claude-config.js --exec [--parent DIR] [--collect-err-fd N] -- <cmd> [args...]
//   node scripts/lib/seed-claude-config.js --sweep <parent>
//
// Single-shot mode creates a fresh mode-0700 directory under --parent (default os.tmpdir()) holding ONLY a
// mode-0600 copy of `.credentials.json` from the real claude config dir (CLAUDE_CONFIG_DIR, else
// ~/.claude), and prints its absolute path on stdout. The child therefore gets native auth but
// never the operator's settings.json, projects/, hooks, plugins or history. The caller owns
// removal of the directory in single-shot mode.
//
// --exec seeds that same directory, spawns <cmd> with stdio inherited and CLAUDE_CONFIG_DIR set to
// the seeded dir, then removes the dir when the child exits, is killed, or cannot be spawned.
// After a child was actually spawned, and only when the dir still exists, it asks codeforge to
// collect usage from that dir. Collect is best-effort and never changes the child's status.
// The collect log goes to stderr unless --collect-err-fd N (3..63, only with --exec) names the fd
// the caller kept for it (dispatch passes 3 together with 3>&2). That fd is closed in the child
// before exec. SIGINT, SIGTERM and SIGHUP are forwarded to the child; the wrapper then waits,
// removes the dir, and exits with the child's status (128+N when the child died of signal N).
//
// --sweep lists <parent>/claude-config-*/.credentials.json (one absolute path per line, sorted)
// and deletes nothing. Exit 1 if any path was listed, 0 if none.
//
// SEED_TEST_PAUSE_AFTER_WRITE_MS (TEST-ONLY, honoured only when set): --exec blocks that many ms right after the
// credentials copy is written, so a test can signal the wrapper inside the seeding window. Never set in production.
//
// --check validates that the source credentials file is readable and creates nothing.
// --check combined with --exec is an error.
// Fails closed: exit 2 with a one-line stderr message when the source credentials are missing
// or the directory cannot be built (a half-built directory is removed). Node built-ins only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function fail(msg) {
  process.stderr.write(`seed-claude-config: ${msg}\n`);
  process.exit(2);
}

let parent = os.tmpdir();
let check = false;
let execMode = false;
let sweepParent = null;
let collectErrFd = null;
let cmd = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--') {
    cmd = argv.slice(i + 1);
    break;
  } else if (argv[i] === '--check') check = true;
  else if (argv[i] === '--exec') execMode = true;
  else if (argv[i] === '--sweep' && argv[i + 1]) { sweepParent = argv[i + 1]; i += 1; }
  else if (argv[i] === '--parent' && argv[i + 1]) { parent = argv[i + 1]; i += 1; }
  else if (argv[i] === '--collect-err-fd' && argv[i + 1]) {
    const raw = argv[i + 1];
    if (!/^[0-9]+$/.test(raw)) fail('--collect-err-fd requires an integer fd');
    const n = Number(raw);
    if (n < 3 || n > 63) fail('--collect-err-fd must be an fd from 3 to 63');
    collectErrFd = n;
    i += 1;
  }
  else fail(`unknown or incomplete argument "${argv[i]}"`);
}

if (execMode && check) fail('--check cannot be combined with --exec');
if (collectErrFd !== null && !execMode) fail('--collect-err-fd requires --exec');
if (sweepParent !== null && (execMode || check || cmd)) fail('--sweep cannot be combined with other modes');

if (sweepParent !== null) {
  let names = [];
  try {
    names = fs.readdirSync(sweepParent);
  } catch {
    process.exit(0);
  }
  const hits = [];
  for (const name of names) {
    if (!name.startsWith('claude-config-')) continue;
    const cred = path.join(sweepParent, name, '.credentials.json');
    try {
      fs.lstatSync(cred);
    } catch {
      continue;
    }
    hits.push(path.resolve(cred));
  }
  hits.sort();
  if (hits.length === 0) process.exit(0);
  process.stdout.write(`${hits.join('\n')}\n`);
  process.exit(1);
}

if (execMode && (!cmd || cmd.length === 0)) fail('--exec requires -- <cmd> [args...]');
if (!execMode && cmd) fail('unknown or incomplete argument "--"');

const realDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const src = path.join(realDir, '.credentials.json');
try {
  if (!fs.statSync(src).isFile()) throw new Error('not a regular file');
  fs.accessSync(src, fs.constants.R_OK);
} catch (e) {
  fail(`source credentials missing or unreadable: ${src} (${e.message})`);
}
if (check) process.exit(0);

function buildSeed(onCreated) {
  let dir = '';
  try {
    fs.mkdirSync(parent, { recursive: true });
    dir = fs.mkdtempSync(path.join(parent, 'claude-config-'));
    if (onCreated) onCreated(dir);
    fs.chmodSync(dir, 0o700);
    const dst = path.join(dir, '.credentials.json');
    fs.writeFileSync(dst, fs.readFileSync(src), { mode: 0o600 });
    fs.chmodSync(dst, 0o600);
    // Test-only (SEED_TEST_PAUSE_AFTER_WRITE_MS): block here, credentials copy on disk, so a test can signal the window.
    const pauseMs = Number(process.env.SEED_TEST_PAUSE_AFTER_WRITE_MS || 0);
    if (pauseMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);
    return dir;
  } catch (e) {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    fail(`could not seed config dir: ${e.message}`);
  }
  return '';
}

if (!execMode) {
  process.stdout.write(`${buildSeed()}\n`);
} else {
// Only this variable names the directory this process created. Removal never reads argv, env, or stdin.
// Handlers are installed BEFORE the dir exists. Seeding is synchronous, so a signal that lands in it is delivered
// right after the child is spawned and forwarded; the dir is recorded in `seeded` the moment mkdtemp returns, so
// even a failure mid-seed removes exactly that dir.
let seeded = '';
let childSpawned = false;
// Collect only after a child was spawned, and only while the dir still exists.
// The log fd is 2 unless the caller passed --collect-err-fd (dispatch pairs it with 3>&2
// so the line is not trailing text after the verdict END marker).
function collectSeeded(target) {
  if (!childSpawned) return;
  try {
    if (!fs.statSync(target).isDirectory()) return;
  } catch { return; }
  const helper = path.join(__dirname, 'codeforge-collect.sh');
  const logFd = collectErrFd === null ? 2 : collectErrFd;
  try {
    spawnSync('bash', ['-c',
      'set +e; if [ -r "$1" ]; then . "$1"; fi; if declare -F codeforge_collect_claude_dir >/dev/null 2>&1; then codeforge_collect_claude_dir "$2"; fi; exit 0',
      'codeforge-collect', helper, target], { stdio: ['ignore', 'ignore', logFd] });
  } catch { /* collect must not change the child status */ }
}
function removeSeeded() {
  const target = seeded;
  if (!target) return;
  seeded = '';
  try { collectSeeded(target); } catch { /* still remove */ }
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* idempotent */ }
}
process.on('exit', removeSeeded);

let child = null;
let settled = false;
function finish(code) {
  if (settled) return;
  settled = true;
  removeSeeded();
  process.exit(code);
}
function forward(sig) {
  if (child && child.pid) {
    try { child.kill(sig); } catch { /* already gone */ }
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => forward(sig));
}

seeded = buildSeed((d) => { seeded = d; });
const childEnv = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: seeded });

// Close the collect-log fd in the child. stdio stays inherit either way: a blind
// stdio[3]='ignore' does not close an fd the shell opened with 3>&2.
let spawnFile = cmd[0];
let spawnArgs = cmd.slice(1);
if (collectErrFd !== null) {
  spawnFile = '/bin/sh';
  spawnArgs = ['-c', `exec ${collectErrFd}>&-; exec "$@"`, '_', ...cmd];
}
child = spawn(spawnFile, spawnArgs, { stdio: 'inherit', env: childEnv });
childSpawned = Boolean(child.pid);
child.on('error', (err) => {
  const detail = err && err.code === 'ENOENT' ? `command not found: ${cmd[0]}` : `could not spawn: ${err.message}`;
  process.stderr.write(`seed-claude-config: ${detail}\n`);
  finish(127);
});
child.on('exit', (code, signal) => {
  if (signal) {
    const n = os.constants.signals[signal];
    finish(128 + (typeof n === 'number' ? n : 0));
    return;
  }
  finish(code == null ? 1 : code);
});
}
