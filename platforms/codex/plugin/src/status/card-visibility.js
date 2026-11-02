'use strict';

// src/status/card-visibility.js — make sure an owner card just written to disk can actually be seen (BL cardvis).
//
// A card lives in <git-common-dir>/autopilot/decisions/. The pane reads it only through the project watcher's job page
// (`status runs --watch --render`), found by the session marker or `<live>/runs/paths`. In a repo that never opted in (no
// `.claude/*-config.md`, no marker) nothing started that watcher, so `open-decision.js open` succeeded and nobody saw the card.
//
// ensureCardVisible() is called by `open-decision.js open` after a successful write. It takes the SAME start path as
// hooks/runs-watch-autostart.js (`startWatcherDetached` -> `watchLaunchArgv`), plus the plain session marker (only created, never
// overwritten: scripts/session-mode.js ensurePlainMarker) and the live pointer.
//
//   -> { ok: true,  status: 'started' | 'busy' | 'autostart_off' }
//   -> { ok: false, reason, action }   the card will NOT show in any live panel: `reason` says why, `action` says what to do
//
// 'autostart_off' (AUTOPILOT_RUNS_WATCH_AUTOSTART=0|false|off|no, or inside a `node --test` tree) is the owner's / a test's explicit switch:
// nothing is started and nothing is reported (the same switch silences the hook). Never throws.

const fs = require('fs');
const path = require('path');

function watcherLaunchOpts({ key, scope, topLevel, env }) {
  const { stableRepoRoot } = require('./runs-watch');
  const opts = { key, cwd: stableRepoRoot(scope.repo_identity) || topLevel, env, render: true };
  // Optional tuning (tests make the watcher idle-exit in seconds); defaults are the watcher's own.
  const idle = Number(env.AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S);
  const interval = Number(env.AUTOPILOT_RUNS_WATCH_INTERVAL_S);
  if (Number.isInteger(idle) && idle > 0) opts.idleExit = idle;
  if (Number.isInteger(interval) && interval > 0) opts.interval = interval;
  return opts;
}

// What is known about the process holding the project lock. Only a POSITIVE, structural confirmation counts ('renders'):
//   1. it is the watcher's entry point: argv = node <path>/bin/autopilot.js status runs --watch ...  (watchLaunchArgv's shape),
//   2. it is THIS project's: `--project <key>` or `--project=<key>`,
//   3. it really holds the project's lock: one of /proc/<pid>/fd points at the lock file (runs-watch.js lockPathOf; the wrapper
//      `exec 9>"$LOCK"; flock -n 9 ...; exec node` leaves fd 9 on it in the node process),
//   4. and it was started with --render.
// 'no_render' = 1-3 confirmed, 4 not. 'unknown' = anything else: no /proc (not Linux), no such pid, unreadable argv or fd directory, a
// different entry point, no fd on the lock. The caller then fails loudly: the card is not known to be shown.
function holderState(pid, key, env) {
  try {
    if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    if (argv.length < 5 || path.basename(argv[1]) !== 'autopilot.js' || argv[2] !== 'status' || argv[3] !== 'runs' || argv[4] !== '--watch') return 'unknown';
    let project = null;
    for (let i = 5; i < argv.length; i += 1) {
      if (argv[i] === '--project') { project = argv[i + 1]; break; }
      if (argv[i].startsWith('--project=')) { project = argv[i].slice('--project='.length); break; }
    }
    if (project !== key) return 'unknown';
    const lock = require('./runs-watch').lockPathOf(env, key);
    let real = lock;
    try { real = fs.realpathSync(lock); } catch (_error) { /* the lock file is gone: no fd can match it */ }
    let holds = false;
    for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
      let target = null;
      try { target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch (_error) { continue; }
      if (target === lock || target === real) { holds = true; break; }
    }
    if (!holds) return 'unknown';
    return argv.includes('--render') ? 'renders' : 'no_render';
  } catch (_error) {
    return 'unknown';
  }
}

function ensureCardVisible({ cwd, sessionId = '', env = process.env } = {}) {
  try {
    const { autostartDisabled } = require('./autostart-gate');
    if (autostartDisabled(env)) return { ok: true, status: 'autostart_off' };
    const { scopeFromCwd } = require('./project-key');
    const abs = path.resolve(cwd || process.cwd());
    const scope = scopeFromCwd(abs);
    if (!scope.project_key) return { ok: false, reason: 'not inside a git repository', action: 'open the card from inside the repository' };
    const { isolatedEnv } = require('./load-source');
    const iso = isolatedEnv(env).reason;
    if (iso) {
      return { ok: false, reason: `isolated environment on the shared live directory (${iso}); no watcher is started there`, action: 'set AUTOPILOT_LIVE_DIR to a private directory, or AUTOPILOT_LOAD_SOURCE_TRUST_ENV=1 if this environment is real' };
    }
    const tmp = require('../../scripts/lib/runtime-paths').ensureTmpdir(env);
    if (!tmp.ok) return { ok: false, reason: `the temp directory cannot be used: ${tmp.reason}`, action: 'set TMPDIR to a writable directory' };
    let topLevel = abs;
    try {
      topLevel = require('child_process').execFileSync('git', ['-C', abs, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim() || abs;
    } catch (_error) { /* the cwd itself */ }
    if (sessionId) {
      try {
        require('../../scripts/session-mode').ensurePlainMarker({ sessionId, repoRoot: topLevel, scope });
      } catch (_error) { /* a marker is a convenience for the pane; the watcher's paths file also finds the project */ }
    }
    try {
      require('./live-pointer').writeLivePointer({ env });
    } catch (error) {
      return { ok: false, reason: `the live pointer cannot be written: ${error.message}`, action: 'make $HOME/.autopilot writable' };
    }
    const { startWatcherDetached } = require('./runs-watch');
    const opts = watcherLaunchOpts({ key: scope.project_key, scope, topLevel, env });
    // A holder without --render (hand-run `status runs --watch`) writes no page for the card: replace it, as the autostart hook does.
    try {
      const hook = require('../../hooks/runs-watch-autostart');
      const liveBase = require('../../scripts/lib/live-state-dir').resolveLiveDir({ env }).base;
      const w = hook.inspectWatcher(liveBase, scope.project_key, path.resolve(__dirname, '..', '..'));
      if (w && w.state === 'stale') hook.reapStale(w, scope.project_key);
    } catch (_error) { /* the start below reports 'busy' and the --render check names it */ }
    const r = startWatcherDetached(opts);
    if (r.status === 'started') return { ok: true, status: 'started' };
    if (r.status === 'busy') {
      const state = holderState(r.holder, scope.project_key, env);
      if (state === 'renders') return { ok: true, status: 'busy' };
      const who = Number.isInteger(r.holder) && r.holder > 0 ? `pid ${r.holder}` : 'an unidentified process';
      const stop = `run \`autopilot status runs --stop --project ${scope.project_key}\` and open the card again (the autostart watcher is \`autopilot status runs --watch --project ${scope.project_key} --render\`)`;
      if (state === 'no_render') return { ok: false, reason: `the project watcher (${who}) runs without --render, so it writes no page for the cards, and it could not be stopped`, action: stop };
      return { ok: false, reason: `the project lock is held by ${who}, which cannot be confirmed to be a rendering watcher of this project (no such process, unreadable or unrecognised command line, or it holds no fd on the project lock), so the card is not known to be shown`, action: stop };
    }
    if (r.status === 'flock_unavailable') return { ok: false, reason: `flock(1) is not available: ${r.message || 'util-linux flock not on PATH'}`, action: 'install util-linux (flock) so the watcher can start' };
    if (r.status === 'live_dir_unusable') return { ok: false, reason: `the live directory cannot be used: ${r.message}`, action: 'fix or unset AUTOPILOT_LIVE_DIR / XDG_RUNTIME_DIR' };
    if (r.status === 'isolated') return { ok: false, reason: `isolated environment (${r.message})`, action: 'set AUTOPILOT_LIVE_DIR to a private directory, or AUTOPILOT_LOAD_SOURCE_TRUST_ENV=1' };
    return { ok: false, reason: `the watcher did not start: ${r.message || r.status}`, action: 'run `autopilot status runs --watch --render` in the repository and read its error' };
  } catch (error) {
    return { ok: false, reason: `the watcher could not be ensured: ${error.message}`, action: 'run `autopilot status runs --watch --render` in the repository' };
  }
}

module.exports = { ensureCardVisible, watcherLaunchOpts };
