#!/usr/bin/env node
/**
 * residue-auto-reap — SessionStart startup|resume|clear|compact (default-on; residue auto-reap R3, 3.0.0-alpha.3).
 *
 * Starts the canonical automatic reaper, `scripts/repo-residue-sweep.js reap --auto --yes --repo <repo>`, DETACHED and
 * without waiting, at most once per repo per 24 h, then returns at once: no stdout, no model context, budget < 50 ms
 * (one git process + a few stats). The sweep only removes what the contract allows (missing-dir worktrees, lease-expired
 * or integrated clean marker worktrees, long-idle archived dispatch branches); everything else is listed for the owner.
 *
 *   - Throttle: `<git-common-dir>/autopilot-residue-auto.stamp`. The hook only reads its mtime; the detached runner
 *     (hooks/residue-auto-reap-lib.js `run`, started under `flock -n <git-common-dir>/autopilot-residue-auto.lock`) re-checks
 *     and writes it under the lock, so two sessions never run two sweeps.
 *   - After the sweep, needs_human_count > 0 appends ONE advisory to `<live>/advisories/<sid>.jsonl` (P7a bridge,
 *     hooks/_shared/advisory-sink.js) pointing at the Hygiene tab. The hook itself never injects context.
 *   - Skipped when: not a git repo; cwd inside a dispatch worktree (top-level `.autopilot-worktree` marker); the stamp is
 *     younger than 24 h; flock(1) is not on PATH (one stderr line).
 *   - Opt out (default-on convention): env AUTOPILOT_HOOK_RESIDUE_AUTO_REAP=0, ~/.autopilot/config.json
 *     {"hooks":{"residue-auto-reap":false}}, or {"residue":{"auto_reap":false}} / env AUTOPILOT_RESIDUE_AUTO_REAP=0.
 *   - Test seam: AUTOPILOT_RESIDUE_AUTO_SWEEP names the sweep script to run instead of the shipped one.
 *   - Fail-open: any problem is at most ONE stderr line, exit 0, no stdout.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const lib = require('./residue-auto-reap-lib.js');

const TAG = 'residue-auto-reap';

function readPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const value = raw.trim() ? JSON.parse(raw) : {};
    return value && typeof value === 'object' ? value : {};
  } catch (_error) {
    return {};
  }
}

function run(payload) {
  if (lib.disabled()) return;
  const cwd = path.resolve(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
  const facts = lib.gitFacts(cwd);
  if (!facts) return; // not a git repo
  if (lib.insideDispatchWorktree(facts.toplevel)) return; // a dispatch worktree is a leaf, never the place to sweep from
  if (lib.stampFresh(facts.common)) return; // one run per repo per 24 h
  if (!lib.onPath('flock')) {
    process.stderr.write(`${TAG}: not run: flock(1) (util-linux) is not available on PATH\n`);
    return;
  }
  const sweep = process.env.AUTOPILOT_RESIDUE_AUTO_SWEEP || '';
  const { cmd, args } = lib.buildSpawn({
    nodeBin: process.execPath,
    common: facts.common,
    repo: lib.sweepRepo(facts),
    sid: typeof payload.session_id === 'string' ? payload.session_id : '',
    sweep,
  });
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: facts.toplevel });
  child.on('error', () => { /* flock vanished between probe and spawn: nothing to do */ });
  child.unref();
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
