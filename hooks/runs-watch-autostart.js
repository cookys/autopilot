#!/usr/bin/env node
/**
 * runs-watch-autostart — SessionStart + UserPromptSubmit (default-on, Tier A). Mods plan P1W W1c.
 *
 * Gives a session in an OPTED-IN git repo the live band: write the live pointer and ensure the ONE project
 * watcher, through the same launch path `session-mode.js set` uses (`startWatcherDetached` →
 * `watchLaunchArgv`, lock form ii in src/status/runs-watch.js). Without this only `/l3../l6` `set` started a
 * watcher, so dev-flow and plain sessions showed `no pointer` / `no project`.
 *
 *   - Scope (never every git repo on the host): start only when the repo opted in — it has autopilot project
 *     config (`.claude/*-config.md`, what `onboard` writes, e.g. dispatch-config.md; looked up in the work tree
 *     and in the main checkout) OR an unexpired session-mode marker exists for its project_key OR
 *     AUTOPILOT_RUNS_WATCH_AUTOSTART=1 forces it. =0 disables. Non-git cwd: silent no-op.
 *   - Lifetime: the watcher idle-exits on its own. It counts a session as live while a session-mode marker is
 *     unexpired or `<live>/tasks|attention/<sid>.json` of this project was updated within the idle window.
 *     A dev-flow session has no marker, so this hook ALSO runs on UserPromptSubmit and re-ensures cheaply
 *     (foreground `flock -n` probe; spawn only when free; one spawn attempt per prompt).
 *   - SessionEnd does NOT stop the watcher (other sessions may share it); idle-exit handles it.
 *   - Never blocks: one 5 s-bounded probe, the watcher itself is detached (nohup, own session).
 *   - Fail-open: any problem is at most ONE stderr line, exit 0, no stdout.
 *   - Optional tuning: AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S / AUTOPILOT_RUNS_WATCH_INTERVAL_S (positive integers).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TAG = 'runs-watch-autostart';

function readPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const value = raw.trim() ? JSON.parse(raw) : {};
    return value && typeof value === 'object' ? value : {};
  } catch (_error) {
    return {};
  }
}

let topLevelMemo = null; // one `git rev-parse --show-toplevel` per invocation
function topLevel(cwd) {
  if (topLevelMemo !== null) return topLevelMemo;
  try {
    topLevelMemo = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim() || cwd;
  } catch (_error) {
    topLevelMemo = cwd;
  }
  return topLevelMemo;
}

// Opt-in rule (see header). `.claude/*-config.md` in the work tree or in the main checkout (a linked worktree
// whose config is untracked still belongs to an onboarded project).
function hasProjectConfig(cwd) {
  const dirs = new Set([topLevel(cwd)]);
  try {
    const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
    if (common) dirs.add(path.dirname(common));
  } catch (_error) { /* top level only */ }
  for (const dir of dirs) {
    try {
      if (fs.readdirSync(path.join(dir, '.claude')).some((n) => /-config\.md$/.test(n))) return true;
    } catch (_error) { /* no .claude dir */ }
  }
  return false;
}

function optedIn(cwd, key, root) {
  if (process.env.AUTOPILOT_RUNS_WATCH_AUTOSTART === '1') return true;
  if (hasProjectConfig(cwd)) return true;
  try {
    return require(path.join(root, 'src/status/runs-watch')).unexpiredMarkers(process.env, key, Date.now()).length > 0;
  } catch (_error) {
    return false;
  }
}

// Zero-spawn fast path (UserPromptSubmit runs this inside advisory-relay.js's process (via awaiting-owner.js onUserPromptSubmit); mods P1W PERF): a
// per-cwd cache `<live>/autostart/<sha1(cwd)>.json` {cwd, project_key} written after the opt-in check
// passed once. With it, "is the watcher alive" is: envelope writer.pid + /proc/<pid>/cmdline naming
// `status runs --watch --project <key>` — no git, no flock, no runs-watch require. Anything doubtful
// (no cache, no envelope, dead pid, other cmdline) falls through to the full path below.
function cacheFile(base, cwd) {
  return path.join(base, 'autostart', `${require('crypto').createHash('sha1').update(cwd).digest('hex').slice(0, 16)}.json`);
}

function watcherAliveFast(base, cwd) {
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile(base, cwd), 'utf8'));
    if (!cached || cached.cwd !== cwd || !/^[0-9a-f]{16}$/.test(cached.project_key)) return false;
    const env = JSON.parse(fs.readFileSync(path.join(base, 'runs', `${cached.project_key}.json`), 'utf8'));
    const pid = env && env.writer && env.writer.pid;
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    const at = argv.indexOf('--project');
    return ` ${argv.join(' ')} `.includes(' status runs --watch ') && at !== -1 && argv[at + 1] === cached.project_key;
  } catch (_error) {
    return false;
  }
}

function writeCache(base, cwd, key) {
  try {
    const file = cacheFile(base, cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ cwd, project_key: key }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (_error) { /* cache is an optimisation only */ }
}

function run(payload) {
  if (process.env.AUTOPILOT_RUNS_WATCH_AUTOSTART === '0') return;
  const cwd = path.resolve(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
  const root = path.resolve(__dirname, '..');
  let base = null;
  try { base = require('./live-session-lib.js').liveBase(); } catch (_error) { /* no fast path */ }
  // The pointer must still exist too (a deleted pointer is restored by the full path).
  if (base && watcherAliveFast(base, cwd)
    && fs.existsSync(require(path.join(root, 'src/status/live-pointer')).pointerPath())) return;
  const { scopeFromCwd } = require(path.join(root, 'src/status/project-key'));
  const scope = scopeFromCwd(cwd);
  if (!scope.project_key) return; // not a git repo: nothing to watch
  if (!optedIn(cwd, scope.project_key, root)) return; // not an autopilot project: never start a watcher for it
  if (base) writeCache(base, cwd, scope.project_key);
  try {
    require(path.join(root, 'src/status/live-pointer')).writeLivePointer();
  } catch (error) {
    process.stderr.write(`${TAG}: live pointer not written: ${error.message}\n`);
  }
  const { startWatcherDetached } = require(path.join(root, 'src/status/runs-watch'));
  const opts = { key: scope.project_key, cwd: topLevel(cwd), env: process.env, render: true };
  // Optional tuning (tests use it to make the watcher idle-exit in seconds); defaults are the watcher's own.
  const idle = Number(process.env.AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S);
  const interval = Number(process.env.AUTOPILOT_RUNS_WATCH_INTERVAL_S);
  if (Number.isInteger(idle) && idle > 0) opts.idleExit = idle;
  if (Number.isInteger(interval) && interval > 0) opts.interval = interval;
  const r = startWatcherDetached(opts);
  if (r.status === 'flock_unavailable') {
    process.stderr.write(`${TAG}: watcher not started: flock(1) (util-linux) is not available on PATH\n`);
  } else if (r.status === 'error') {
    process.stderr.write(`${TAG}: watcher not started: ${r.message}\n`);
  }
  // 'busy' (a watcher already holds the lock) and 'started' are both silent: the normal outcomes.
}

module.exports = { run };

if (require.main === module) {
  try {
    run(readPayload());
  } catch (error) {
    process.stderr.write(`${TAG}: ${error.message}\n`);
  }
  process.exit(0);
}
