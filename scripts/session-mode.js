#!/usr/bin/env node
/**
 * session-mode.js — orchestrator-mode marker CLI (A1/A2 support, v2.32.27).
 *
 * Written by depth-0 at /l3 /l4 /l5 /l6 entry; read by the orchestrator-edit-gate
 * and context-budget hooks. One marker file per session id:
 *   ${AUTOPILOT_SESSION_MODE_DIR:-~/.autopilot/session-mode}/<session-id>.json
 *   { level, repo_root, started_at, expires_at }
 *
 * Design notes (see docs/plans/2026-07-14-context-budget-orchestrator-gate.md):
 * - Host-stable path (~/.autopilot, NOT $TMPDIR) — docker-exec contexts see the
 *   same marker (Gemini panel finding).
 * - set OVERWRITES: /l3 re-entry after an /l5 run in the same session records
 *   level:l3, so the gate goes no-op instead of denying inline edits (MiniMax
 *   stale-marker-vs-mode-change finding).
 * - TTL (default 24h): expired ⇒ status active:false — fail-open, a crashed
 *   session can never block a later one.
 * - Atomic write via tmp+rename; corrupt marker reads as active:false.
 *
 * Usage:
 *   node scripts/session-mode.js set --level l3|l4|l5|l6 [--repo-root <dir>] [--ttl-hours N]
 *   node scripts/session-mode.js clear [--task-status-receipt <file> --root-run-id <id>]
 *   node scripts/session-mode.js status
 * Exit: 0 ok / 2 usage-or-invalid-args.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalDigest } = require('../src/engine/campaign-verification');

const LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);
const DEFAULT_TTL_HOURS = 24;

function markerDir() {
  return process.env.AUTOPILOT_SESSION_MODE_DIR
    || path.join(os.homedir(), '.autopilot', 'session-mode');
}

// Same fallback chain as hooks/suggest-compact.js — hook-side and CLI-side must
// derive the SAME id or the marker is invisible to the gate.
function getSessionId() {
  const raw = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.cwd();
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function markerPath() {
  return path.join(markerDir(), `${getSessionId()}.json`);
}

function readMarker() {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(), 'utf8'));
    if (!m || typeof m !== 'object' || !LEVELS.has(m.level)) return null;
    if (!m.expires_at || Date.parse(m.expires_at) <= Date.now()) return null; // expired ⇒ fail-open
    return m;
  } catch {
    return null; // absent or corrupt ⇒ fail-open
  }
}

function gitToplevel() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
    else args._.push(argv[i]);
  }
  return args;
}

function cmdSet(args) {
  const level = args.level;
  if (!LEVELS.has(level)) {
    process.stderr.write(`session-mode: invalid --level "${level}" (want l3|l4|l5|l6)\n`);
    return 2;
  }
  const ttlHours = args['ttl-hours'] !== undefined ? Number(args['ttl-hours']) : DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttlHours) || ttlHours < 0) {
    process.stderr.write(`session-mode: invalid --ttl-hours "${args['ttl-hours']}"\n`);
    return 2;
  }
  const now = Date.now();
  const marker = {
    level,
    repo_root: path.resolve(args['repo-root'] || gitToplevel()),
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlHours * 3600 * 1000).toISOString(),
  };
  fs.mkdirSync(markerDir(), { recursive: true });
  const tmp = `${markerPath()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
  fs.renameSync(tmp, markerPath()); // atomic on same fs
  process.stdout.write(`${JSON.stringify({ ok: true, marker_path: markerPath(), ...marker }, null, 2)}\n`);
  return 0;
}

function markerRepoIdentity(repoRoot) {
  try {
    const common = execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return `git-common-dir:${fs.realpathSync(common)}`;
  } catch (_error) {
    return null;
  }
}

function validateCloseReceipt(file, rootRunId, marker = readMarker()) {
  if (!file || !rootRunId) return 'l5/l6 clear requires --task-status-receipt and --root-run-id';
  let value;
  try {
    value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    return `task-status receipt unavailable: ${error.message}`;
  }
  if (!value || value.schema_version !== 1 || value.artifact_type !== 'task_status_receipt') {
    return 'task-status receipt has the wrong contract';
  }
  const required = [
    'issued_at', 'repo_identity', 'goal', 'phase', 'candidate_commit',
    'candidate_tree_sha', 'acceptance_verdict', 'accepted_blockers', 'deferred_count',
    'active_owned_worktrees', 'active_owned_branches', 'integration_target',
    'product_merged', 'consumer_updated', 'pushed', 'zero_residue',
    'mission_terminal', 'campaigns_terminal', 'evidence', 'can_merge',
    'failed_predicates',
  ];
  const evidenceKeys = [
    'mission', 'campaigns', 'lifecycle', 'integration', 'merge_preflight', 'merge_execution',
  ];
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
      || !Array.isArray(value.accepted_blockers)
      || !Array.isArray(value.failed_predicates)
      || value.failed_predicates.length !== 0
      || value.acceptance_verdict !== 'accepted'
      || value.mission_terminal !== true
      || value.campaigns_terminal !== true
      || value.product_merged !== true
      || value.zero_residue !== true
      || !value.evidence
      || typeof value.evidence !== 'object'
      || evidenceKeys.some((key) => (
        !value.evidence[key] || value.evidence[key].status !== 'valid'
      ))
      || value.evidence.merge_execution.execution_status !== 'complete') {
    return 'task-status receipt is not a complete closeout receipt';
  }
  if (value.root_run_id !== rootRunId) return 'task-status receipt root_run_id mismatch';
  const expectedIdentity = marker && marker.repo_root
    ? markerRepoIdentity(marker.repo_root)
    : null;
  if (!expectedIdentity || value.repo_identity !== expectedIdentity) {
    return 'task-status receipt repository binding mismatch';
  }
  if (value.can_close !== true) return 'task-status receipt can_close is not true';
  if (typeof value.issued_at !== 'string'
      || !Number.isFinite(Date.parse(value.issued_at))
      || Math.abs(Date.now() - Date.parse(value.issued_at)) > 5 * 60 * 1000) {
    return 'task-status receipt is stale';
  }
  const { receipt_digest: receiptDigest, ...body } = value;
  if (!/^[a-f0-9]{64}$/u.test(receiptDigest || '')
      || canonicalDigest(body) !== receiptDigest) {
    return 'task-status receipt digest is invalid';
  }
  return null;
}

function cmdClear(args) {
  const marker = readMarker();
  const explicitCloseReceipt = args['task-status-receipt'] !== undefined
    || args['root-run-id'] !== undefined;
  if (explicitCloseReceipt || (marker && (marker.level === 'l5' || marker.level === 'l6'))) {
    const bindingMarker = marker || { repo_root: gitToplevel() };
    const reason = validateCloseReceipt(
      args['task-status-receipt'],
      args['root-run-id'],
      bindingMarker,
    );
    if (reason) {
      process.stderr.write(`session-mode: close blocked: ${reason}\n`);
      return 1;
    }
  }
  try {
    fs.unlinkSync(markerPath());
  } catch (error) {
    if (error.code !== 'ENOENT') {
      process.stderr.write(`session-mode: marker clear failed: ${error.message}\n`);
      return 1;
    }
  }
  if (fs.existsSync(markerPath())) {
    process.stderr.write('session-mode: marker clear failed: marker still exists\n');
    return 1;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, cleared: markerPath() }, null, 2)}\n`);
  return 0;
}

function cmdStatus() {
  const m = readMarker();
  const out = m
    ? { active: true, marker_path: markerPath(), ...m }
    : { active: false, marker_path: markerPath() };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (cmd) {
    case 'set': return cmdSet(args);
    case 'clear': return cmdClear(args);
    case 'status': return cmdStatus();
    default:
      process.stderr.write('Usage: session-mode.js set --level l3|l4|l5|l6 [--repo-root <dir>] [--ttl-hours N] | clear | status\n');
      return 2;
  }
}

if (require.main === module) process.exit(main());
module.exports = {
  readMarker,
  getSessionId,
  markerPath,
  validateCloseReceipt,
  LEVELS,
};
