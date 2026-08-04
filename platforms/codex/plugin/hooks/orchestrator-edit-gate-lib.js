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

const CODEX_REASON_CODES = Object.freeze({
  entryRequired: 'DEV_FLOW_ENTRY_REQUIRED',
  depthZeroMutation: 'DEPTH_ZERO_MUTATION_FORBIDDEN',
});

/**
 * Classify `git rev-parse --show-toplevel` without collapsing an execution
 * failure into the legitimate "not a repository" result. Adapters may allow
 * only the latter; missing git, timeouts, signals, and unexpected statuses are
 * fail-safe gate conditions.
 */
function classifyCodexGitProbe(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', reason: 'git probe produced no result' };
  }
  if (result.error) {
    const code = result.error.code || result.error.message || 'spawn_error';
    return { status: 'error', reason: `git probe failed (${code})` };
  }
  if (result.signal || result.status === null) {
    return {
      status: 'error',
      reason: `git probe did not complete (${result.signal || 'unknown status'})`,
    };
  }
  const stdout = String(result.stdout || '').trim();
  if (result.status === 0 && stdout) {
    return { status: 'repository', root: stdout, reason: null };
  }
  const stderr = String(result.stderr || '');
  if (result.status === 128 && /not a git repository/iu.test(stderr)) {
    return { status: 'not_repository', root: null, reason: null };
  }
  return {
    status: 'error',
    root: null,
    reason: `git probe exited unexpectedly (status ${result.status})`,
  };
}

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

/**
 * Host-neutral Codex pre-effect policy. The Codex wrapper owns payload/tool
 * translation and marker validation; this core only decides from closed facts.
 *
 * `effectCapable` is intentionally capability-based. In particular, a shell
 * tool is classified as effect-capable as a whole instead of trying to infer
 * writes from arbitrary command text. The wrapper may identify only the two
 * fixed lifecycle command boundaries needed to enter/resume Autopilot.
 */
function decideCodexPreEffect(f) {
  if (!f.inRepository || !f.effectCapable) {
    return { action: 'allow', reason: null, reasonCode: null };
  }
  if (f.lifecycleEntry) {
    return { action: 'allow', reason: null, reasonCode: null };
  }
  if (f.markerStatus !== 'valid') {
    return {
      action: 'gate',
      reasonCode: CODEX_REASON_CODES.entryRequired,
      reason: `${CODEX_REASON_CODES.entryRequired}: ${f.markerReason || 'active lifecycle marker required'}`,
    };
  }
  if (f.markerLevel === 'l3') {
    return { action: 'allow', reason: null, reasonCode: null };
  }
  if (GATED_LEVELS.has(f.markerLevel) && f.managedEngineEntry) {
    return { action: 'allow', reason: null, reasonCode: null };
  }
  if (GATED_LEVELS.has(f.markerLevel)) {
    return {
      action: 'gate',
      reasonCode: CODEX_REASON_CODES.depthZeroMutation,
      reason: `${CODEX_REASON_CODES.depthZeroMutation}: orchestrator mode (${f.markerLevel}) `
        + 'requires the existing managed Engine/campaign path',
    };
  }
  return {
    action: 'gate',
    reasonCode: CODEX_REASON_CODES.entryRequired,
    reason: `${CODEX_REASON_CODES.entryRequired}: marker level is invalid`,
  };
}

module.exports = {
  decide,
  decideCodexPreEffect,
  classifyCodexGitProbe,
  isAllowlisted,
  ALLOWLIST_PREFIXES,
  GATED_LEVELS,
  CODEX_REASON_CODES,
};
