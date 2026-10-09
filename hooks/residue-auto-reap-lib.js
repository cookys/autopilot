'use strict';
/**
 * residue-auto-reap-lib — the logic behind hooks/residue-auto-reap.js (SessionStart, default-on), plus the detached
 * runner the hook starts. Contract: docs/plans/evidence/2026-10-09-residue-auto-reap/contract.md R3.
 *
 * Two roles in one file (a `-lib.js` name keeps check-hook-inventory from counting it as a hook):
 *   - helpers the hook calls (`disabled`, `gitFacts`, `stampFresh`, `buildSpawn`): cheap, no sweep work;
 *   - the runner, `node residue-auto-reap-lib.js run --repo <main worktree> --common <git-common-dir> --sid <sid>
 *     [--sweep <sweep.js>]`, started detached by the hook under `flock -n <common>/autopilot-residue-auto.lock`. Under that
 *     lock it re-checks the 24 h stamp, writes the stamp, runs `repo-residue-sweep.js reap --auto --yes --repo <repo>`,
 *     then (needs_human_count > 0) appends ONE advisory through the P7a bridge (hooks/_shared/advisory-sink.js). The
 *     advisory can only exist after the sweep ends, which is why this is a wrapper and not the hook itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { loadResidueConfig } = require('../scripts/lib/residue-config.js');

const STEM = 'residue-auto-reap';
const STAMP_NAME = 'autopilot-residue-auto.stamp';
const LOCK_NAME = 'autopilot-residue-auto.lock';
const RESULT_NAME = 'autopilot-residue-auto.json';
const THROTTLE_MS = 24 * 60 * 60 * 1000;
const SWEEP_TIMEOUT_MS = 10 * 60 * 1000;
const OFF_WORDS = ['0', 'false', 'off', 'no'];

function isOff(v) {
  if (v === false || v === 0) return true;
  return typeof v === 'string' && OFF_WORDS.includes(v.trim().toLowerCase());
}

function userConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || os.homedir(), '.autopilot', 'config.json'), 'utf8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (_error) {
    return {};
  }
}

// Default-on disable convention: an explicitly negative value switches the hook off; absent / garbage leaves it on.
//   hook-specific knobs: env AUTOPILOT_HOOK_RESIDUE_AUTO_REAP=0 | ~/.autopilot/config.json {"hooks":{"residue-auto-reap":false}}
//   residue.auto_reap: decided by scripts/lib/residue-config.js, the same chain and env as the sweep
//   (defaults -> ~/.autopilot/config.json residue -> env AUTOPILOT_RESIDUE_AUTO_REAP=0|1).
function disabled(env = process.env, cfg = userConfig(), home) {
  if (isOff(env.AUTOPILOT_HOOK_RESIDUE_AUTO_REAP)) return true;
  if (cfg.hooks && typeof cfg.hooks === 'object' && isOff(cfg.hooks[STEM])) return true;
  return !loadResidueConfig({ env, home: home || env.HOME || os.homedir() }).auto_reap;
}

// One git process: { toplevel, common } or null (not a repo / git missing).
function gitFacts(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).split('\n').filter(Boolean);
    if (out.length < 2) return null;
    return { toplevel: out[0], common: out[1] };
  } catch (_error) {
    return null;
  }
}

// A dispatch worktree carries a schema-2 `.autopilot-worktree` marker at its top.
function insideDispatchWorktree(toplevel) {
  try {
    return fs.statSync(path.join(toplevel, '.autopilot-worktree')).isFile();
  } catch (_error) {
    return false;
  }
}

// The sweep excludes the checkout it is pointed at, so it is pointed at the MAIN worktree (src/status/residue.js does the same).
function sweepRepo(facts) {
  return path.basename(facts.common) === '.git' ? path.dirname(facts.common) : facts.toplevel;
}

function stampFresh(common, nowMs = Date.now()) {
  try {
    return nowMs - fs.statSync(path.join(common, STAMP_NAME)).mtimeMs < THROTTLE_MS;
  } catch (_error) {
    return false;
  }
}

function onPath(bin, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, bin), fs.constants.X_OK); return true; } catch (_error) { /* next */ }
  }
  return false;
}

// The detached command: flock -n <lock> node <this file> run ...  (lock busy => flock exits at once, no second sweep).
function buildSpawn({ nodeBin, common, repo, sid, sweep }) {
  const args = ['-n', path.join(common, LOCK_NAME), nodeBin, __filename, 'run', '--repo', repo, '--common', common, '--sid', sid];
  if (sweep) args.push('--sweep', sweep);
  return { cmd: 'flock', args };
}

function advisoryText(result) {
  const n = result.needs_human_count;
  const bytes = Number(result.needs_human_bytes);
  let size = '';
  if (Number.isFinite(bytes) && bytes > 0) {
    size = bytes >= 1073741824 ? `, ${(bytes / 1073741824).toFixed(1)} GB` : `, ${Math.max(1, Math.round(bytes / 1048576))} MB`;
  }
  return `${n} worktree/branch leftover${n === 1 ? '' : 's'} need you${size}. Open the Hygiene tab of the live pane for what and the exact commands.`;
}

function runOnce({ repo, common, sid, sweep, nodeBin = process.execPath, nowMs = Date.now, writeAdvisory }) {
  if (stampFresh(common, nowMs())) return { ran: false, reason: 'throttled' };
  const started = nowMs();
  const stamp = path.join(common, STAMP_NAME);
  const tmp = `${stamp}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ at: new Date(started).toISOString(), sid, pid: process.pid })}\n`);
  fs.renameSync(tmp, stamp); // claimed before the sweep: a failing sweep is not retried by every later session
  const r = spawnSync(nodeBin, [sweep, 'reap', '--auto', '--yes', '--repo', repo], {
    stdio: 'ignore', timeout: SWEEP_TIMEOUT_MS, cwd: repo,
  });
  if (r.error || r.status !== 0) return { ran: true, ok: false, status: r.status };
  let result;
  try { result = JSON.parse(fs.readFileSync(path.join(common, RESULT_NAME), 'utf8')); } catch (_error) { return { ran: true, ok: false, status: 'no-result' }; }
  if (!result || result.schema !== 'autopilot.residue-auto/1') return { ran: true, ok: false, status: 'bad-result' };
  const ranAt = Date.parse(result.ran_at);
  if (!Number.isFinite(ranAt) || ranAt < started - 1000) return { ran: true, ok: false, status: 'stale-result' }; // not THIS run's file
  if (Number.isInteger(result.needs_human_count) && result.needs_human_count > 0 && sid) {
    const write = writeAdvisory || require('./_shared/advisory-sink.js').writeAdvisory;
    write({ sid, kind: 'residue', severity: 'info', text: advisoryText(result) });
    return { ran: true, ok: true, advisory: true };
  }
  return { ran: true, ok: true, advisory: false };
}

function argValue(argv, name) {
  const at = argv.indexOf(name);
  return at !== -1 && at + 1 < argv.length ? argv[at + 1] : '';
}

module.exports = {
  STEM, STAMP_NAME, LOCK_NAME, RESULT_NAME, THROTTLE_MS,
  disabled, gitFacts, insideDispatchWorktree, sweepRepo, stampFresh, onPath, buildSpawn, advisoryText, runOnce,
};

if (require.main === module && process.argv[2] === 'run') {
  try {
    const argv = process.argv.slice(3);
    const repo = argValue(argv, '--repo');
    const common = argValue(argv, '--common');
    if (repo && common) {
      runOnce({
        repo, common, sid: argValue(argv, '--sid'),
        sweep: argValue(argv, '--sweep') || path.resolve(__dirname, '..', 'scripts', 'repo-residue-sweep.js'),
      });
    }
  } catch (error) {
    process.stderr.write(`${STEM}: ${error.message}\n`);
  }
  process.exit(0);
}
