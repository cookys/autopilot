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

function main() {
  if (process.env.AUTOPILOT_RUNS_WATCH_AUTOSTART === '0') return;
  const payload = readPayload();
  const cwd = path.resolve(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
  const root = path.resolve(__dirname, '..');
  const { scopeFromCwd } = require(path.join(root, 'src/status/project-key'));
  const scope = scopeFromCwd(cwd);
  if (!scope.project_key) return; // not a git repo: nothing to watch
  if (!optedIn(cwd, scope.project_key, root)) return; // not an autopilot project: never start a watcher for it
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

try {
  main();
} catch (error) {
  process.stderr.write(`${TAG}: ${error.message}\n`);
}
process.exit(0);
