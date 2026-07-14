#!/usr/bin/env node
/**
 * orchestrator-edit-gate — PreToolUse Edit|Write|NotebookEdit (opt-in,
 * default-off; v2.32.27)
 *
 * A1 of the depth-0 economics plan: in /l4 /l5 /l6 sessions (marker set by
 * scripts/session-mode.js at level entry), depth-0 editing product files is a
 * protocol violation — deny (block mode) or warn (default) and redirect to
 * dispatch. Born of the 2026-07-14 transcript study: nominal /l5 sessions did
 * 48–54 inline depth-0 Edits, stuffing work products into the longest-lived,
 * most-reread context ("pure orchestration" existed only in prose).
 *
 * Identity: payload `agent_id` PRESENCE = subagent (SPIKE-1, CC 2.1.208) —
 * foremen/workers pass; depth-0 doesn't. Territory: realpath containment in
 * marker.repo_root, or a `.autopilot-worktree` marker above the target
 * (worktrees are WORKER territory — gated for depth-0, WHERE-not-WHO).
 * Allowlist: docs/projects/, docs/plans/, .claude/, .autopilot/.
 *
 * Modes (env AUTOPILOT_ORCH_EDIT_GATE_MODE or ~/.autopilot/config.json
 * orchestrator_edit_gate.mode): warn (default) | block | off.
 * Declared limits: Bash-mediated writes are NOT caught (write-regex rejected
 * 3-for-3 by the design panel); backstop is the E1 post-hoc manifest gate
 * (BACKLOG). Enable: {"hooks":{"orchestrator-edit-gate":true}} or
 * AUTOPILOT_HOOK_ORCHESTRATOR_EDIT_GATE=1. Fail-open: any error ⇒ exit 0.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isEnabled } = require('./_shared/opt-in');
const { decide, isAllowlisted } = require('./orchestrator-edit-gate-lib.js');
const { readMarker } = require('../scripts/session-mode.js');

function gateMode() {
  const env = process.env.AUTOPILOT_ORCH_EDIT_GATE_MODE;
  if (env === 'block' || env === 'warn' || env === 'off') return env;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.autopilot', 'config.json'), 'utf8'));
    const m = cfg && cfg.orchestrator_edit_gate && cfg.orchestrator_edit_gate.mode;
    if (m === 'block' || m === 'warn' || m === 'off') return m;
  } catch { /* defaults */ }
  return 'warn';
}

function targetPath(payload) {
  const ti = payload.tool_input || {};
  return ti.file_path || ti.notebook_path || null;
}

// Realpath of the deepest EXISTING ancestor (the file itself may not exist yet
// for Write) — symlink-safe containment without requiring the target to exist.
function resolveReal(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...tail.reverse()); } catch { /* keep walking up */ }
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p);
    tail.push(path.basename(cur));
    cur = parent;
  }
}

function contains(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hasWorktreeMarkerAbove(target) {
  let cur = path.dirname(target);
  for (let i = 0; i < 40; i++) {
    try { fs.accessSync(path.join(cur, '.autopilot-worktree')); return true; } catch { /* not here */ }
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
  return false;
}

(function main() {
  let exitCode = 0;
  try {
    if (!isEnabled('orchestrator-edit-gate')) process.exit(0);
    const mode = gateMode();
    if (mode === 'off') process.exit(0);

    let payload = {};
    // fd 0, not '/dev/stdin' (ENXIO under piped spawns, #6305).
    try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

    const marker = readMarker(); // null when absent/expired/corrupt — fail-open
    if (!marker) process.exit(0);

    const rawTarget = targetPath(payload);
    if (!rawTarget) process.exit(0);
    const target = resolveReal(rawTarget);
    const repoRoot = resolveReal(marker.repo_root);
    const inRepoRoot = contains(repoRoot, target);

    const d = decide({
      markerLevel: marker.level,
      isSubagent: Boolean(payload.agent_id), // SPIKE-1 identity
      inRepoRoot,
      inDispatchWorktree: !inRepoRoot && hasWorktreeMarkerAbove(target),
      allowlisted: inRepoRoot && isAllowlisted(path.relative(repoRoot, target)),
    });

    if (d.action === 'gate') {
      if (mode === 'block') {
        process.stderr.write(`${d.reason}\n`);
        exitCode = 2; // PreToolUse exit 2 ⇒ deny the tool call
      } else {
        process.stderr.write(`[orchestrator-edit-gate warn] ${d.reason}\n`);
      }
    }
  } catch (e) {
    try { process.stderr.write(`orchestrator-edit-gate error (fail-open): ${e.message}\n`); } catch { /* ignore */ }
    exitCode = 0;
  }
  process.exit(exitCode);
})();
