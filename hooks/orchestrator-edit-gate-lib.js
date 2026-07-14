// orchestrator-edit-gate-lib.js — pure decision core for the orchestrator-edit
// gate. Wrapper owns IO (stdin, marker read, realpath, stderr, exit codes).
//
// Decision model (docs/plans/2026-07-14-context-budget-orchestrator-gate.md):
// in /l4 /l5 /l6 sessions, DEPTH-0 editing product files is a protocol
// violation — the work belongs in dispatched workers. Identity comes from the
// hook payload: subagent fires carry `agent_id` (SPIKE-1, CC 2.1.208); depth-0
// fires don't. Position (repo / dispatch worktree / outside) decides territory;
// an allowlist keeps tracking/config paths editable.

'use strict';

// Paths (relative to repo_root) depth-0 may always edit: project tracking,
// session config/state, plan docs. Deliberately NARROW — a generic
// '**/handoff*.md' rule was rejected (GPT-OSS panel finding: it doubles as a
// bypass by planting a handoff-named file in product territory).
const ALLOWLIST_PREFIXES = [
  'docs/projects/',
  'docs/plans/',
  '.claude/',
  '.autopilot/',
];

const GATED_LEVELS = new Set(['l4', 'l5', 'l6']);

function isAllowlisted(relPath) {
  const p = String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
  return ALLOWLIST_PREFIXES.some((pre) => p.startsWith(pre));
}

/**
 * Pure gate decision.
 * @param {object} f  flags resolved by the wrapper:
 *   markerLevel: 'l3'|'l4'|'l5'|'l6'|null  (null = no live marker)
 *   isSubagent: boolean   (payload agent_id present — SPIKE-1 identity)
 *   inRepoRoot: boolean   (realpath-contained in marker.repo_root)
 *   inDispatchWorktree: boolean  (a `.autopilot-worktree` marker above target)
 *   allowlisted: boolean  (isAllowlisted of repo-relative path)
 * @returns {{action: 'allow'|'gate', reason: string|null}}
 */
function decide(f) {
  if (!f.markerLevel || !GATED_LEVELS.has(f.markerLevel)) return { action: 'allow', reason: null };
  if (f.isSubagent) return { action: 'allow', reason: null }; // workers/foremen edit freely
  if (f.inRepoRoot && f.allowlisted) return { action: 'allow', reason: null };
  if (!f.inRepoRoot && !f.inDispatchWorktree) return { action: 'allow', reason: null }; // scratch etc.
  // depth-0 editing product territory (repo) or worker territory (worktree —
  // WHERE-not-WHO: worktree paths are NOT a depth-0 backdoor).
  return {
    action: 'gate',
    reason:
      `orchestrator mode (${f.markerLevel}): depth-0 must not edit ` +
      `${f.inDispatchWorktree ? 'a dispatch worktree' : 'product files'} inline — ` +
      'dispatch this edit instead (dispatch-hetero.sh / Agent tool). ' +
      'Escape hatches (user-held): re-enter with --solo, or set ' +
      '~/.autopilot/config.json {"hooks":{"orchestrator-edit-gate":false}}.',
  };
}

module.exports = { decide, isAllowlisted, ALLOWLIST_PREFIXES, GATED_LEVELS };
