'use strict';

// src/status/load-source.js — the plugin load-source fact the runs watcher publishes (P7b, plan Owner addendum A1).
//
//   <live>/load-source.json   schema autopilot.load-source/1   (live dir resolved by scripts/lib/live-state-dir.js: tmpfs)
//
// Machine-wide, not per scope: the plugin cache belongs to the user, so every project's band reads the same file.
// Shape: { schema, checked_at, plugin_version, source: "dev"|"cache:<semver>"|"unknown", source_basis,
//          marketplace: "directory"|"github"|…|"missing", marketplace_path, marketplace_is_dev, dev_link_ok,
//          behind_upstream: int|null, flags: [...], stale_cache_dirs: [{ dir, in_use_pids, alive }] }
// The detection itself is scripts/lib/load-source.js (shared with `scripts/dev-setup.sh --check`). The watcher does not
// know which claude pid is "the" session, so `source` here is the conservative any-alive-pid reading; the band narrows it
// with the session pid when it has one (mods/live/model.ts loadSourceFor). It re-checks at most every CHECK_S seconds
// (the behind-upstream probe spawns git) and rewrites an unchanged file at most every REWRITE_S seconds.
//
// Isolation guard (2026-10): the file is machine-global but the claude dir it is derived from comes from the watcher's own
// environment. A watcher started from a sandboxed test terminal (`HOME=<tmp> CLAUDE_CONFIG_DIR=<tmp> claude ...`) that still
// shares the real live dir would overwrite the real file with "source: unknown / marketplace: missing". So `isolatedEnv(env)`
// answers "is this environment not the machine's real user?" and, when it is AND AUTOPILOT_LIVE_DIR is unset (= the live dir
// is shared), the publisher writes nothing and `startWatcherDetached` / runs-watch-autostart start no watcher.
//   isolated  <=>  HOME differs from os.userInfo().homedir, OR CLAUDE_CONFIG_DIR is set and is not <real home>/.claude.
// Trade-off: an owner who globally sets CLAUDE_CONFIG_DIR elsewhere is also "isolated" and gets no load-source publishing
// (and no autostart watcher); set AUTOPILOT_LOAD_SOURCE_TRUST_ENV=1 to declare the environment real. An explicit
// AUTOPILOT_LIVE_DIR is an isolation request already, so publishing into it proceeds as before.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectLoadSource } = require('../../scripts/lib/load-source');

const SCHEMA = 'autopilot.load-source/1';
const CHECK_S = 30;
const REWRITE_S = 60;

function claudeDirOf(env) {
  return (env && env.CLAUDE_CONFIG_DIR) || path.join((env && env.HOME) || os.homedir(), '.claude');
}

function realHome() {
  try { return os.userInfo().homedir; } catch (_error) { return os.homedir(); }
}

// { isolated, reason } — reason is null unless isolated AND the live dir is shared (the case that must not write).
function isolatedEnv(env = process.env) {
  if (env.AUTOPILOT_LOAD_SOURCE_TRUST_ENV === '1') return { isolated: false, reason: null };
  const home = realHome();
  let reason = null;
  if (env.HOME && path.resolve(env.HOME) !== path.resolve(home)) {
    reason = `HOME ${env.HOME} is not the real home ${home}`;
  } else if (env.CLAUDE_CONFIG_DIR && path.resolve(env.CLAUDE_CONFIG_DIR) !== path.join(home, '.claude')) {
    reason = `CLAUDE_CONFIG_DIR ${env.CLAUDE_CONFIG_DIR} is not ${path.join(home, '.claude')}`;
  }
  return { isolated: reason !== null, reason: env.AUTOPILOT_LIVE_DIR ? null : reason };
}

function createLoadSourcePublisher({ live, env = process.env, repoDir, writeAtomic, log = () => {}, detect = detectLoadSource }) {
  const file = path.join(live, 'load-source.json');
  let checkedMs = null;
  let stable = null;
  let wroteMs = null;
  let skipLogged = false;

  function publish({ nowMs }) {
    const iso = isolatedEnv(env);
    if (iso.reason) {
      if (!skipLogged) { skipLogged = true; log(`load-source not published: isolated environment on a shared live dir (${iso.reason}); set AUTOPILOT_LOAD_SOURCE_TRUST_ENV=1 to override`); }
      return false;
    }
    if (checkedMs !== null && nowMs - checkedMs < CHECK_S * 1000 && fs.existsSync(file)) return false;
    checkedMs = nowMs;
    let fact;
    try { fact = detect({ claudeDir: claudeDirOf(env), repoDir }); } catch (error) { log(`load-source detect failed: ${error.message}`); return false; }
    const body = JSON.stringify(fact);
    if (stable === body && wroteMs !== null && nowMs - wroteMs < REWRITE_S * 1000 && fs.existsSync(file)) return false;
    try {
      writeAtomic(file, `${JSON.stringify({ schema: SCHEMA, checked_at: new Date(nowMs).toISOString(), ...fact }, null, 2)}\n`);
      stable = body;
      wroteMs = nowMs;
      return true;
    } catch (error) { log(`load-source write failed: ${error.message}`); return false; }
  }

  return { publish, file };
}

module.exports = { SCHEMA, CHECK_S, REWRITE_S, claudeDirOf, isolatedEnv, createLoadSourcePublisher };
