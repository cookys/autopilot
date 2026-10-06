#!/usr/bin/env node
/**
 * session-mode.js — orchestrator-mode marker CLI (A1/A2 support, v2.32.27).
 *
 * Written by depth-0 at /l3 /l4 /l5 /l6 entry; read by the orchestrator-edit-gate
 * and context-budget hooks. One marker file per session id. The marker is the per-session RECORD
 * (mods P1W MARKER, plan R5.6): `level: null` is a PLAIN session (no orchestrator mode) — written by the
 * SessionStart ensure in hooks/runs-watch-autostart.js for opted-in repos and by `set` without --level.
 * Every mode reader treats level:null exactly like an absent marker (readMarker() returns null for it);
 * the fields meant to be read from a plain record are project_key, root_run_id, size, stage, started_at.
 * level ∈ {l3,l4,l5,l6} is unchanged; any other non-null level is still an invalid marker:
 *   ${AUTOPILOT_SESSION_MODE_DIR:-~/.autopilot/session-mode}/<session-id>.json
 *   { session_id, level, repo_root, started_at, expires_at, entry_level?, fallback_reason?,
 *     mission_routing?, repo_identity?, project_key?, root_run_id?, campaign_roots?, size?, urgent?, bug?, base_ref?, stage?, ... }
 *   (level is null for a plain session. A plain session is ONE JOB like any other (mods P1W PLAINROOT, plan R5.7):
 *   `set` and the SessionStart ensure assign root_run_id with the same rule as `set --level` — explicit --root-run-id
 *   > AUTOPILOT_ROOT_RUN_ID > a minted `job-<ts>-<rand>` (resolveJobRoot, the only minting site). The ensure never
 *   overwrites, so compact/resume keep the root; an EXPIRED marker is replaced by a new marker with a NEW root.
 *   repo_identity/project_key/root_run_id are additive, null when underivable; `set` also writes
 *   ~/.autopilot/live-pointer.json — src/status/live-pointer.js)
 *   size/urgent/bug/base_ref (stage-graph P2a, plan §2.9): `set --size XS|S|M|L|XL [--urgent] [--bug] [--base-ref <sha>]`
 *   without --level creates a plain marker or merges into the live one (level preserved), under the marker lock;
 *   --size only moves up; base_ref defaults to `git merge-base HEAD develop|main|master` (null + stderr note when
 *   underivable). stage/stage_set_at/unit/review_families/high_risk are written by scripts/stage-advance.js.
 *   campaign_roots (mods P1W SCOPE, `bind-campaign-root`): the Mission roots of the campaigns this /l5-/l6 session
 *   launched (<= 8, newest last). The engine's sealed Mission root can never equal the marker's job root (the marker is
 *   set before prepare/grant mint the mission), so this is the only link from a session to the campaign it runs; the
 *   watcher and the band read the union {root_run_id} + campaign_roots.
 *   The marker carries no phase fields (removed in stage-graph P2b, plan §0.7) and the old phase flag is a usage error;
 *   the work position is `stage`/`stage_set_at`/`unit`, written by scripts/stage-advance.js.
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
 *   node scripts/session-mode.js set --level l3|l4|l5|l6 [--entry-level l3|l4|l5|l6]
 *     [--fallback none|solo|precondition_failed] [--repo-root <dir>] [--ttl-hours N]
 *   node scripts/session-mode.js set [--level none] [--repo-root <dir>] [--ttl-hours N] [--root-run-id <id>]
 *     (no --level, or --level none: write a PLAIN-session marker, level null, replacing this session's plain or
 *     expired marker — exit 2 when an unexpired l3-l6 marker exists (use `clear`); no Mission routing, no entry_level. `status` prints it as level "none" with active:false.)
 *   node scripts/session-mode.js bind-campaign-root --root <id> (--repo-identity <git-common-dir:...> | --repo-root <dir>)
 *     (record <id> in THIS session's own marker `campaign_roots`: locked, atomic, idempotent, newest last, <= 8. Refuses
 *     (exit 3, one stderr line, marker untouched) unless the marker exists, is unexpired, is level l5/l6 and its repo
 *     identity equals the given one; exit 2 for a usage error or an unsafe id. Never creates or scans other markers.)
 *   node scripts/session-mode.js clear [--task-status-receipt <file> --root-run-id <id>]
 *   node scripts/session-mode.js retire --session <id> --integration-receipt <file>
 *     [--integration-ref <ref>] [--lineage <adoption-key>] [--repo-root <dir>]
 *   node scripts/session-mode.js status
 *
 * retire (v2.36.48): retire ANOTHER session's managed marker for this repo once its
 * deliverable is integrated. The marker-to-campaign bridge in dispatch-hetero.sh scans
 * every marker in the directory and refuses a live one whose graph digest differs from
 * the sealed campaign's — correct as a concurrency guard, but a finished deliverable's
 * marker used to have no exit short of its 24h TTL (or hand deletion, which is
 * gate-input deletion). `retire` re-derives completion instead of trusting a claim
 * (ADR-0001): the marker's graph digest names a Mission lineage in the repo's
 * registry; that lineage holds a claim for `unit_id`; the receipt from
 * `scripts/record-integration.js` names that claim's branch as source_ref; and git
 * proves source_sha ⊂ accepted_sha ⊂ --integration-ref (default develop). Only then
 * is the marker unlinked. A marker records only its graph digest, so when a re-adopted
 * plan left two lineages on one digest the verb fails closed until --lineage names the
 * integrated one (reviewer MUST-FIX, 2026-09-15).
 * Exit: 0 ok / 2 usage-or-invalid-args.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalDigest } = require('../src/engine/campaign-verification');
const { admitMissionRouting } = require('./mission-routing-admission');
const { scopeFromCwd } = require('../src/status/project-key');
const { writeLivePointer } = require('../src/status/live-pointer');
const { withWriteLock } = require('./lib/jsonl-store');

const LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);
const DEFAULT_TTL_HOURS = 24;
const PHASE_LOCK_TIMEOUT_MS = 8000;
const CAMPAIGN_ROOTS_MAX = 8;
const CAMPAIGN_ROOT_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DEV_FLOW_ADMISSION_REJECTION_CODE = 'DEV_FLOW_ADMISSION_REQUIRED_OR_STALE';
const ROUTING_KEYS = Object.freeze([
  'status',
  'admitted',
  'would_block',
  'prior_marker_status',
  'admission',
]);
const ADMISSION_KEYS = Object.freeze([
  'schema_version',
  'artifact_type',
  'authority_status',
  'repo_identity',
  'mission_policy_digest',
  'mission_graph_digest',
  'sources_digest',
  'deliverable_count',
  'source_authoring_unit_count',
  'critical_path',
  'batch_count',
  'reservation_totals',
  'admission_digest',
]);
const RESERVATION_KEYS = Object.freeze([
  'campaigns',
  'wall_seconds',
  'tool_calls',
  'engine_attempts',
  'external_wait_seconds',
  'canonical_changed_files',
  'output_bytes',
]);
const MISSION_NOOP_KEYS = Object.freeze([
  'schema_version',
  'artifact_type',
  'admission_digest',
  'noop_adoptions',
  'noop_short_circuit',
  'dispatcher_called',
  'mutation_attempts',
  'gate_attempts',
  'resources_created',
  'digest',
]);
const NOOP_ADOPTION_KEYS = Object.freeze([
  'graph_node_id',
  'dispatcher_called',
  'mutation_attempts',
  'gate_attempts',
  'resources_created',
  'noop_receipt_digest',
  'noop_receipt',
  'source_work_order_id',
  'source_work_order_digest',
]);

function markerDir() {
  return process.env.AUTOPILOT_SESSION_MODE_DIR
    || path.join(os.homedir(), '.autopilot', 'session-mode');
}

function normalizeSessionId(raw) {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

// The portable explicit binding remains first for managed/controller callers.
// A host may provide CODEX_THREAD_ID, but the Codex lifecycle shell bridge is
// not assumed or claimed; cwd remains the final fallback for an unbound caller.
function getSessionId() {
  const raw = process.env.AUTOPILOT_SESSION_ID
    || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.env.CODEX_THREAD_ID
    || process.cwd();
  return normalizeSessionId(raw);
}

function markerPath() {
  return path.join(markerDir(), `${getSessionId()}.json`);
}

// The ORCHESTRATOR marker: null for absent, expired, corrupt, and for a plain-session record (level null).
// Every mode gate reads this one, so "plain session" == "no marker" for them by construction.
function readMarker() {
  const m = readSessionRecord();
  return m && m.level !== null ? m : null;
}

// The per-session record: an orchestrator marker (l3-l6) OR a plain-session marker (level null), unexpired.
// For callers that read the record's own fields (root_run_id, project_key, size, stage) rather than the mode.
// No argument: the env-keyed session (getSessionId). A hook, which gets the session id in its payload, passes it.
function readSessionRecord(sessionId) {
  try {
    const file = sessionId === undefined ? markerPath() : path.join(markerDir(), `${normalizeSessionId(sessionId)}.json`);
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!m || typeof m !== 'object') return null;
    if (m.level !== null && !LEVELS.has(m.level)) return null;
    if (!m.expires_at || Date.parse(m.expires_at) <= Date.now()) return null; // expired ⇒ fail-open
    return m;
  } catch {
    return null; // absent or corrupt ⇒ fail-open
  }
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function verifyMissionRoutingProjection(marker, expected) {
  const reject = (reason) => ({ valid: false, reason });
  if (!exactKeys(expected, [
    'repo_identity',
    'mission_policy_digest',
    'mission_graph_digest',
  ])) {
    return reject('expected Mission projection identity is invalid');
  }
  const routing = marker && marker.mission_routing;
  if (!exactKeys(routing, ROUTING_KEYS)) return reject('marker Mission routing shape is invalid');
  if (routing.status !== 'READY' || routing.admitted !== true || routing.would_block !== false) {
    return reject('marker Mission routing is not an enforced READY admission');
  }
  const admission = routing.admission;
  if (!exactKeys(admission, ADMISSION_KEYS)) return reject('marker Mission admission shape is invalid');
  if (!exactKeys(admission.reservation_totals, RESERVATION_KEYS)) {
    return reject('marker Mission reservation shape is invalid');
  }
  const { admission_digest: admissionDigest, ...body } = admission;
  if (!/^[a-f0-9]{64}$/u.test(admissionDigest || '')
      || canonicalDigest(body) !== admissionDigest) {
    return reject('marker Mission admission digest is invalid');
  }
  if (admission.schema_version !== 1
      || admission.artifact_type !== 'mission_routing_admission'
      || admission.authority_status !== 'enforce') {
    return reject('marker Mission admission authority is invalid');
  }
  for (const field of [
    'repo_identity',
    'mission_policy_digest',
    'mission_graph_digest',
  ]) {
    if (admission[field] !== expected[field]) {
      return reject(`marker Mission ${field} does not match campaign projection`);
    }
  }
  let missionNoop = null;
  if (Object.prototype.hasOwnProperty.call(marker, 'mission_noop')) {
    missionNoop = marker.mission_noop;
    if (!exactKeys(missionNoop, MISSION_NOOP_KEYS)) {
      return reject('marker Mission no-op shape is invalid');
    }
    const { digest, ...noopBody } = missionNoop;
    const allDeliverablesNoop = Array.isArray(missionNoop.noop_adoptions)
      && missionNoop.noop_adoptions.length > 0
      && missionNoop.noop_adoptions.length === admission.deliverable_count;
    if (!/^[a-f0-9]{64}$/u.test(digest || '')
        || canonicalDigest(noopBody) !== digest
        || missionNoop.schema_version !== 1
        || missionNoop.artifact_type !== 'mission_noop_adoption_set'
        || missionNoop.admission_digest !== admissionDigest
        || !Array.isArray(missionNoop.noop_adoptions)
        || missionNoop.noop_adoptions.some((item) => (
          !exactKeys(item, NOOP_ADOPTION_KEYS)
          || typeof item.graph_node_id !== 'string'
          || item.dispatcher_called !== false
          || item.mutation_attempts !== 0
          || item.gate_attempts !== 0
          || item.resources_created !== 0
          || !/^[a-f0-9]{64}$/u.test(item.noop_receipt_digest || '')
          || !item.noop_receipt
          || typeof item.noop_receipt !== 'object'
          || Array.isArray(item.noop_receipt)
          || item.noop_receipt.artifact_type !== 'noop_receipt'
          || item.noop_receipt.digest !== item.noop_receipt_digest
          || canonicalDigest(Object.fromEntries(
            Object.entries(item.noop_receipt).filter(([key]) => key !== 'digest'),
          )) !== item.noop_receipt_digest
          || typeof item.source_work_order_id !== 'string'
          || item.source_work_order_id.length === 0
          || !/^[a-f0-9]{64}$/u.test(item.source_work_order_digest || '')
        ))
        || missionNoop.noop_short_circuit
          !== (missionNoop.noop_adoptions.length > 0)
        || (allDeliverablesNoop
          ? (missionNoop.dispatcher_called !== false
            || missionNoop.mutation_attempts !== 0
            || missionNoop.gate_attempts !== 0
            || missionNoop.resources_created !== 0)
          : (missionNoop.dispatcher_called !== null
            || missionNoop.mutation_attempts !== null
            || missionNoop.gate_attempts !== null
            || missionNoop.resources_created !== null))) {
      return reject('marker Mission no-op digest/bindings are invalid');
    }
  }
  return {
    valid: true,
    admission_digest: admissionDigest,
    mission_noop: missionNoop,
  };
}

function devFlowAdmissionRejection(reason) {
  return {
    status: 'blocked',
    phase: 'dev_flow_admission',
    rejection_code: DEV_FLOW_ADMISSION_REJECTION_CODE,
    reason,
    dispatcher_called: false,
    model_calls: 0,
    mutation_attempts: 0,
    resources_created: 0,
  };
}

function readCampaignAuthority(campaignContract, repoRoot) {
  let contract = campaignContract;
  if (typeof campaignContract === 'string') {
    const absolute = path.isAbsolute(campaignContract)
      ? campaignContract : path.resolve(repoRoot, campaignContract);
    try {
      contract = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      return { error: `sealed campaign is unreadable: ${error.message}` };
    }
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { error: 'sealed campaign is malformed' };
  }
  const runtime = contract.mission_runtime || contract.campaign_projection;
  const repoIdentity = contract.repo_identity
    || (contract.campaign_projection && contract.campaign_projection.repo_identity);
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)
      || typeof repoIdentity !== 'string'
      || !SHA256.test(runtime.mission_policy_digest || '')
      || !SHA256.test(runtime.mission_graph_digest || '')) {
    return { error: 'sealed campaign Mission projection is malformed' };
  }
  return {
    repo_identity: repoIdentity,
    mission_policy_digest: runtime.mission_policy_digest,
    mission_graph_digest: runtime.mission_graph_digest,
  };
}

// The sealed Mission root of a campaign contract (path or object), or null when it carries none / an unsafe one.
// Kept apart from readCampaignAuthority on purpose: verifyMissionRoutingProjection demands that object's EXACT key set.
function campaignRootRunId(campaignContract, repoRoot) {
  let contract = campaignContract;
  if (typeof campaignContract === 'string') {
    try {
      contract = JSON.parse(fs.readFileSync(path.resolve(repoRoot || process.cwd(), campaignContract), 'utf8'));
    } catch { return null; }
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return null;
  const runtime = contract.mission_runtime || contract.campaign_projection;
  const root = runtime && typeof runtime === 'object' ? runtime.root_run_id : null;
  return isSafeCampaignRoot(root) ? root : null;
}

// Where managed admission applies at all.
//
// Admission binds a sealed session marker to the campaign's Mission projection,
// so it can only judge a campaign that carries one. dispatch-hetero.sh already
// draws that line: it runs admission only once a strict projection is bound and
// routes everything else to the session-mode gate. Callers that ran admission
// on every managed campaign rejected bounded non-Mission ones at the door
// permanently, because the closed contract schema gives them nowhere to put a
// projection -- a deny that no fixture and no caller could ever satisfy.
//
// A contract this cannot read is left to campaign intake rather than answered
// here. That is not a bypass: intake validates the contract before any
// dispatch, so an unreadable one reaches no effect either way, and it names the
// problem in the campaign's own vocabulary instead of reporting a stale session
// marker for a campaign nobody can even parse.
function campaignCarriesMissionProjection(campaignContract, repoRoot) {
  if (campaignContract === null || campaignContract === undefined || campaignContract === '') {
    return false;
  }
  let contract = campaignContract;
  if (typeof campaignContract === 'string') {
    const absolute = path.isAbsolute(campaignContract)
      ? campaignContract : path.resolve(repoRoot || process.cwd(), campaignContract);
    try {
      contract = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (_error) {
      return false;
    }
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return false;
  return Boolean(contract.mission_runtime || contract.campaign_projection);
}

function validateManagedDevFlowAdmission({
  repoRoot,
  effectiveLevel,
  campaignContract,
  markerFile = markerPath(),
  now = Date.now(),
} = {}) {
  const reject = (reason) => ({ valid: false, reason });
  let stat;
  try {
    stat = fs.lstatSync(markerFile);
  } catch (error) {
    return reject(error.code === 'ENOENT'
      ? 'session marker absent'
      : `session marker malformed: ${error.message}`);
  }
  if (!stat.isFile()) return reject('session marker malformed: marker is not a regular file');
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  } catch (error) {
    return reject(`session marker malformed: ${error.message}`);
  }
  if (marker && typeof marker === 'object' && !Array.isArray(marker) && marker.level === null) {
    return reject('session marker absent'); // a plain-session record is not an orchestrator marker
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)
      || !LEVELS.has(marker.level)
      || typeof marker.session_id !== 'string'
      || !marker.session_id
      || normalizeSessionId(marker.session_id) !== marker.session_id
      || typeof marker.repo_root !== 'string' || !path.isAbsolute(marker.repo_root)) {
    return reject('session marker malformed: identity fields are invalid');
  }
  if (marker.session_id !== getSessionId()) {
    return reject('session marker session mismatch');
  }
  const startedAt = Date.parse(marker.started_at);
  const expiresAt = Date.parse(marker.expires_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt) || startedAt > now) {
    return reject('session marker malformed: timestamps are invalid');
  }
  if (expiresAt <= now) return reject('session marker expired');
  if (!LEVELS.has(effectiveLevel) || marker.level !== effectiveLevel) {
    return reject(`session marker level mismatch: marker=${marker.level} effective=${effectiveLevel || 'absent'}`);
  }
  const currentRepoIdentity = markerRepoIdentity(path.resolve(repoRoot || process.cwd()));
  const markerIdentity = markerRepoIdentity(marker.repo_root);
  if (!currentRepoIdentity || !markerIdentity || markerIdentity !== currentRepoIdentity) {
    return reject('session marker repository mismatch');
  }
  const campaign = readCampaignAuthority(campaignContract, path.resolve(repoRoot || process.cwd()));
  if (campaign.error) {
    return reject(`session marker Mission projection mismatch: ${campaign.error}`);
  }
  if (campaign.repo_identity !== currentRepoIdentity) {
    return reject('session marker repository mismatch: sealed campaign identity differs');
  }
  const projection = verifyMissionRoutingProjection(marker, campaign);
  if (!projection.valid) {
    return reject(`session marker Mission projection mismatch: ${projection.reason}`);
  }
  const sourcesDigest = marker.mission_routing.admission.sources_digest;
  if (!SHA256.test(sourcesDigest || '')) {
    return reject('session marker Mission projection mismatch: sources_digest is invalid');
  }
  return {
    valid: true,
    marker_level: marker.level,
    repo_identity: currentRepoIdentity,
    mission_policy_digest: campaign.mission_policy_digest,
    mission_graph_digest: campaign.mission_graph_digest,
    sources_digest: sourcesDigest,
    admission_digest: projection.admission_digest,
  };
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

// Valueless flags (stage-graph P2a): `--urgent` / `--bug` take no value, so they must not swallow the next token.
const BOOLEAN_FLAGS = new Set(['--urgent', '--bug']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (BOOLEAN_FLAGS.has(argv[i])) args[argv[i].slice(2)] = true;
    else if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
    else args._.push(argv[i]);
  }
  return args;
}

// Start the project watcher (mods plan P1a "誰起 watcher"). Fail-open: every outcome is at most one
// stderr line; the marker is already written and `set`'s exit code never depends on this.
// AUTOPILOT_RUNS_WATCH_AUTOSTART=0 disables it (hooks/tests/lib.sh exports 0 for every suite).
// stderr, not stdout: stdout is the marker JSON that callers parse.
function startProjectWatcher(marker, repoRoot) {
  if (!marker.project_key || process.env.AUTOPILOT_RUNS_WATCH_AUTOSTART === '0') return;
  try {
    const { startWatcherDetached } = require('../src/status/runs-watch');
    const r = startWatcherDetached({ key: marker.project_key, cwd: repoRoot, env: process.env, render: true });
    if (r.status === 'busy') {
      process.stderr.write(`session-mode: watcher already running for project ${marker.project_key} (pid ${r.holder === null || r.holder === undefined ? 'unknown' : r.holder}); not starting another\n`);
    } else if (r.status === 'flock_unavailable') {
      process.stderr.write('session-mode: watcher not started: flock(1) (util-linux) is not available on PATH\n');
    } else if (r.status === 'error') {
      process.stderr.write(`session-mode: watcher not started: ${r.message}\n`);
    }
  } catch (error) {
    process.stderr.write(`session-mode: watcher not started: ${error.message}\n`);
  }
}

// True only when the environment names a session. getSessionId() falls back to the cwd for an unbound caller, which
// is fine for reading but must never decide that a marker belongs to this process when something WRITES to it.
function hasExplicitSessionId(env = process.env) {
  return Boolean(env.AUTOPILOT_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || env.CODEX_THREAD_ID);
}

function isSafeCampaignRoot(root) {
  return typeof root === 'string' && CAMPAIGN_ROOT_ID.test(root) && root !== '.' && root !== '..';
}

// Record a campaign's Mission root in the calling session's OWN marker (mods P1W SCOPE). Everything is judged under
// the marker lock on a fresh read, so a concurrent writer cannot make a refused bind land. -> { ok, ... } | { ok:false, code, reason }.
function bindCampaignRoot({ root, repoIdentity, now = Date.now() } = {}) {
  const refuse = (code, reason) => ({ ok: false, code, reason });
  if (!isSafeCampaignRoot(root)) return refuse(2, 'invalid --root: want 1-128 characters of [A-Za-z0-9._-]');
  if (typeof repoIdentity !== 'string' || !repoIdentity) return refuse(2, 'bind-campaign-root needs --repo-identity or --repo-root');
  if (!hasExplicitSessionId()) return refuse(3, 'no session id in the environment; nothing bound');
  const file = markerPath();
  const timeoutMs = Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) > 0
    ? Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) : PHASE_LOCK_TIMEOUT_MS;
  if (!fs.existsSync(file)) return refuse(3, 'no session marker for this session; nothing bound');
  let outcome = null;
  try {
    withWriteLock({ storeDir: markerDir(), lockFile: `${file}.lock`, name: 'session-mode marker', timeoutMs }, () => {
      let current;
      try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { outcome = refuse(3, 'session marker unreadable; nothing bound'); return; }
      if (!current || typeof current !== 'object' || Array.isArray(current)) { outcome = refuse(3, 'session marker malformed; nothing bound'); return; }
      if (current.session_id !== getSessionId()) { outcome = refuse(3, 'session marker belongs to another session; nothing bound'); return; }
      const expires = Date.parse(current.expires_at);
      if (!Number.isFinite(expires) || expires <= now) { outcome = refuse(3, 'session marker expired; nothing bound'); return; }
      if (current.level !== 'l5' && current.level !== 'l6') { outcome = refuse(3, `session marker level ${current.level === null ? 'none' : current.level} is below l5; nothing bound`); return; }
      const markerIdentity = typeof current.repo_identity === 'string' && current.repo_identity
        ? current.repo_identity
        : (typeof current.repo_root === 'string' && path.isAbsolute(current.repo_root) ? markerRepoIdentity(current.repo_root) : null);
      if (!markerIdentity || markerIdentity !== repoIdentity) { outcome = refuse(3, 'session marker repository differs from the campaign repository; nothing bound'); return; }
      if (root === current.root_run_id) { outcome = { ok: true, changed: false, campaign_roots: Array.isArray(current.campaign_roots) ? current.campaign_roots : [] }; return; }
      const prior = Array.isArray(current.campaign_roots) ? current.campaign_roots.filter(isSafeCampaignRoot) : [];
      if (prior.length > 0 && prior[prior.length - 1] === root && prior.length === (current.campaign_roots || []).length) {
        outcome = { ok: true, changed: false, campaign_roots: prior };
        return;
      }
      const roots = [...prior.filter((r) => r !== root), root].slice(-CAMPAIGN_ROOTS_MAX);
      const next = { ...current, campaign_roots: roots };
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
      fs.renameSync(tmp, file);
      outcome = { ok: true, changed: true, campaign_roots: roots };
    });
  } catch (error) {
    return refuse(1, `campaign root not bound: ${error.message}`);
  }
  return outcome || refuse(3, 'session marker unavailable; nothing bound');
}

function cmdBindCampaignRoot(args) {
  let repoIdentity = typeof args['repo-identity'] === 'string' ? args['repo-identity'] : '';
  if (!repoIdentity && typeof args['repo-root'] === 'string' && args['repo-root']) {
    try { repoIdentity = markerRepoIdentity(path.resolve(args['repo-root'])) || ''; } catch { repoIdentity = ''; }
  }
  const result = bindCampaignRoot({ root: args.root, repoIdentity });
  if (!result.ok) {
    process.stderr.write(`session-mode: bind-campaign-root: ${result.reason}\n`);
    return result.code;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, changed: result.changed, marker_path: markerPath(), campaign_roots: result.campaign_roots })}\n`);
  return 0;
}

// The phase flag was removed in stage-graph P2b (plan §0.7). Hard usage error naming the replacement; no alias.
const PHASE_REMOVED_MESSAGE = '--phase was removed (stage-graph P2b): the marker no longer carries phase/phase_set_at. ' + // stage-vocab-allow
  'Use `node scripts/stage-advance.js --to <node> [--unit kind:i/N:label]` to record the work position';

// The one job-root rule (mods P1W W1f + PLAINROOT): explicit --root-run-id > AUTOPILOT_ROOT_RUN_ID (campaign / mission
// roots stay untouched) > a freshly minted `job-<ts>-<rand>`. Used by `set --level`, plain `set` and the SessionStart ensure.
function resolveJobRoot({ explicit = '', now = Date.now(), env = process.env } = {}) {
  return explicit || env.AUTOPILOT_ROOT_RUN_ID
    || `job-${Math.floor(now / 1000)}-${require('crypto').randomBytes(4).toString('hex')}`;
}

// A plain-session marker (level null): the per-session record without orchestrator mode. No Mission routing,
// no entry_level. root_run_id is decided by the caller through resolveJobRoot (every plain marker has a job root).
function buildPlainMarker({ sessionId, repoRoot, scope, now, ttlHours = DEFAULT_TTL_HOURS, rootRunId = null }) {
  const marker = {
    session_id: sessionId,
    level: null,
    repo_root: repoRoot,
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlHours * 3600 * 1000).toISOString(),
    repo_identity: scope && scope.repo_identity ? scope.repo_identity : null,
    project_key: scope && scope.project_key ? scope.project_key : null,
    root_run_id: rootRunId || null,
  };
  return marker;
}

function writeMarkerFile(file, marker) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
  fs.renameSync(tmp, file); // atomic on same fs
}

// SessionStart ensure (hooks/runs-watch-autostart.js). Rule: create a plain marker for `sessionId` ONLY when no
// unexpired marker of any kind exists for it; NEVER overwrite one (compact / resume / startup with a live l3-l6
// or plain marker leave the bytes alone). An EXPIRED marker (parseable, expires_at in the past) is replaced;
// an unreadable or malformed one is left untouched (not ours to destroy; fail-open). Takes the same
// <marker>.lock as the `set --size` init so a concurrent writer cannot interleave.
// -> 'created' | 'replaced_expired' | 'kept' | 'kept_unreadable' | 'skipped' (no usable session id).
function ensurePlainMarker({ sessionId, repoRoot, scope, now = Date.now(), dir = markerDir() }) {
  const sid = normalizeSessionId(sessionId);
  if (!sid) return 'skipped';
  const file = path.join(dir, `${sid}.json`);
  let result = 'kept';
  fs.mkdirSync(dir, { recursive: true });
  withWriteLock({ storeDir: dir, lockFile: `${file}.lock`, name: 'session-mode marker', timeoutMs: 2000 }, () => {
    let state = 'absent';
    try {
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      const valid = m && typeof m === 'object' && !Array.isArray(m) && (m.level === null || LEVELS.has(m.level));
      const exp = valid ? Date.parse(m.expires_at) : NaN;
      state = !valid || !Number.isFinite(exp) ? 'unreadable' : (exp <= now ? 'expired' : 'live');
    } catch (error) {
      state = error.code === 'ENOENT' ? 'absent' : 'unreadable';
    }
    if (state === 'live') { result = 'kept'; return; }
    if (state === 'unreadable') { result = 'kept_unreadable'; return; }
    const rootRunId = resolveJobRoot({ now });
    writeMarkerFile(file, buildPlainMarker({ sessionId: sid, repoRoot, scope, now, rootRunId }));
    result = state === 'expired' ? 'replaced_expired' : 'created';
  });
  return result;
}

function cmdSetPlain(args) {
  // A plain `set` is a record, not an exit from orchestrator mode: it never replaces this session's unexpired
  // l3-l6 marker (that would drop an l5/l6 session's mode without its close evidence). `clear` is the exit.
  const live = readMarker();
  if (live) {
    process.stderr.write(
      `session-mode: refusing plain \`set\`: this session has an unexpired ${live.level} marker; ` +
      'run `clear` (with its close-evidence rules) to leave orchestrator mode first\n',
    );
    return 2;
  }
  const ttlHours = args['ttl-hours'] !== undefined ? Number(args['ttl-hours']) : DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttlHours) || ttlHours < 0) {
    process.stderr.write(`session-mode: invalid --ttl-hours "${args['ttl-hours']}"\n`);
    return 2;
  }
  const repoRoot = path.resolve(args['repo-root'] || gitToplevel());
  let scope = { repo_identity: null, project_key: null };
  try { scope = scopeFromCwd(repoRoot); } catch (_error) { /* fail-open: fields stay null */ }
  const explicitRoot = typeof args['root-run-id'] === 'string' && /^[A-Za-z0-9._-]+$/.test(args['root-run-id'])
    ? args['root-run-id'] : '';
  const marker = buildPlainMarker({
    sessionId: getSessionId(),
    repoRoot,
    scope,
    now: Date.now(),
    ttlHours,
    rootRunId: resolveJobRoot({ explicit: explicitRoot, now: Date.now() }),
  });
  writeMarkerFile(markerPath(), marker);
  try { writeLivePointer(); } catch (_error) { /* fail-open: pointer is advisory for the mod */ }
  startProjectWatcher(marker, repoRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, marker_path: markerPath(), ...marker }, null, 2)}\n`);
  return 0;
}

// ---- stage-graph P2a: size / urgent / bug / base_ref init fields (plan §2.9) --------------------------------
const SIZES = Object.freeze(['XS', 'S', 'M', 'L', 'XL']);
const INIT_FLAGS = ['size', 'urgent', 'bug', 'base-ref'];
const BASE_REF_SHA = /^[0-9a-f]{7,64}$/u;
// Default-branch candidates, same order as scripts/resolve-review-loop.sh probe_diff_bytes (develop, then main);
// master and the origin/* spellings are added so a clone without a local develop still resolves.
const DEFAULT_BRANCHES = Object.freeze(['develop', 'main', 'master', 'origin/develop', 'origin/main']);

// The merge-base of HEAD and the first default-branch candidate that resolves; null when none does.
function defaultBaseRef(repoRoot) {
  for (const branch of DEFAULT_BRANCHES) {
    try {
      const sha = execFileSync('git', ['-C', repoRoot, 'merge-base', 'HEAD', branch], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (BASE_REF_SHA.test(sha)) return sha;
    } catch (_error) { /* try the next candidate */ }
  }
  return null;
}

function hasInitFlags(args) {
  return INIT_FLAGS.some((k) => Object.prototype.hasOwnProperty.call(args, k));
}

function parseInit(args) {
  const init = {};
  if (Object.prototype.hasOwnProperty.call(args, 'size')) {
    if (!SIZES.includes(args.size)) return { error: `invalid --size "${args.size}" (want ${SIZES.join('|')})` };
    init.size = args.size;
  }
  if (args.urgent === true) init.urgent = true;
  if (args.bug === true) init.bug = true;
  if (Object.prototype.hasOwnProperty.call(args, 'base-ref')) {
    if (typeof args['base-ref'] !== 'string' || !BASE_REF_SHA.test(args['base-ref'])) {
      return { error: `invalid --base-ref "${args['base-ref']}" (want a 7-64 char lowercase hex commit sha)` };
    }
    init.baseRef = args['base-ref'];
  }
  return { init };
}

// Merge the init fields into `marker` (mutates). `prior` is the marker being merged into (null on create):
// urgent/bug only ever turn ON; base_ref survives a merge unless --base-ref is given (a size bump must not
// move the diff base); a missing base_ref is derived once and stderr says so when it cannot be.
function applyInitFields(marker, init, repoRoot, prior) {
  if (init.size) marker.size = init.size;
  if (init.urgent) marker.urgent = true;
  else if (typeof marker.urgent !== 'boolean') marker.urgent = false;
  if (init.bug) marker.bug = true;
  else if (typeof marker.bug !== 'boolean') marker.bug = false;
  if (init.baseRef) marker.base_ref = init.baseRef;
  else if (!prior || typeof prior.base_ref !== 'string') {
    marker.base_ref = defaultBaseRef(repoRoot);
    if (marker.base_ref === null) {
      process.stderr.write(
        `session-mode: could not derive base_ref (merge-base of HEAD with ${DEFAULT_BRANCHES.join('|')} failed in ${repoRoot}); ` +
        'stored base_ref: null (the size-bump check is skipped until one is set with --base-ref)\n',
      );
    }
  }
  return marker;
}

// `set --size/--urgent/--bug/--base-ref` without an orchestrator level: create-if-absent
// (plain marker, level null) / merge-if-present (level and every other field preserved), under the marker
// lock + atomic rename. --size is upward-only against an existing marker's size.
function cmdSetInit(args) {
  const parsed = parseInit(args);
  if (parsed.error) { process.stderr.write(`session-mode: ${parsed.error}\n`); return 2; }
  const { init } = parsed;
  const ttlHours = args['ttl-hours'] !== undefined ? Number(args['ttl-hours']) : DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttlHours) || ttlHours < 0) {
    process.stderr.write(`session-mode: invalid --ttl-hours "${args['ttl-hours']}"\n`);
    return 2;
  }
  const repoRoot = path.resolve(args['repo-root'] || gitToplevel());
  const timeoutMs = Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) > 0
    ? Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) : PHASE_LOCK_TIMEOUT_MS;
  const file = markerPath();
  fs.mkdirSync(markerDir(), { recursive: true });
  let result = null; // { marker, created } | { refusal }
  try {
    withWriteLock({ storeDir: markerDir(), lockFile: `${file}.lock`, name: 'session-mode marker', timeoutMs }, () => {
      const current = readSessionRecord();
      if (current) {
        if (init.size && SIZES.includes(current.size) && SIZES.indexOf(init.size) < SIZES.indexOf(current.size)) {
          result = { refusal: `refusing --size ${init.size}: the marker is already ${current.size} and size only moves up (XS<S<M<L<XL)` };
          return;
        }
        const next = applyInitFields({ ...current }, init, repoRoot, current);
        writeMarkerFile(file, next);
        result = { marker: next, created: false };
        return;
      }
      let scope = { repo_identity: null, project_key: null };
      try { scope = scopeFromCwd(repoRoot); } catch (_error) { /* fail-open: fields stay null */ }
      const now = Date.now();
      const explicitRoot = typeof args['root-run-id'] === 'string' && /^[A-Za-z0-9._-]+$/.test(args['root-run-id'])
        ? args['root-run-id'] : '';
      const marker = applyInitFields(buildPlainMarker({
        sessionId: getSessionId(), repoRoot, scope, now, ttlHours,
        rootRunId: resolveJobRoot({ explicit: explicitRoot, now }),
      }), init, repoRoot, null);
      writeMarkerFile(file, marker);
      result = { marker, created: true };
    });
  } catch (error) {
    process.stderr.write(`session-mode: marker not written: ${error.message}\n`);
    return 1;
  }
  if (!result) { process.stderr.write('session-mode: marker not written\n'); return 1; }
  if (result.refusal) { process.stderr.write(`session-mode: ${result.refusal}\n`); return 2; }
  if (result.created) {
    try { writeLivePointer(); } catch (_error) { /* fail-open: pointer is advisory for the mod */ }
    startProjectWatcher(result.marker, result.marker.repo_root);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, marker_path: file, ...result.marker }, null, 2)}\n`);
  return 0;
}

function cmdSet(args) {
  const hasLevel = Object.prototype.hasOwnProperty.call(args, 'level');
  if (Object.prototype.hasOwnProperty.call(args, 'phase')) {
    process.stderr.write(`session-mode: ${PHASE_REMOVED_MESSAGE}\n`);
    return 2;
  }
  // Stage-graph P2a: size/urgent/bug/base-ref without an orchestrator level is the create-or-merge init
  // (an existing marker keeps its level).
  if ((!hasLevel || args.level === 'none') && hasInitFlags(args)) return cmdSetInit(args);
  if (!hasLevel || args.level === 'none') return cmdSetPlain(args);
  const level = args.level;
  const initParsed = parseInit(args);
  if (initParsed.error) {
    process.stderr.write(`session-mode: ${initParsed.error}\n`);
    return 2;
  }
  if (!LEVELS.has(level)) {
    process.stderr.write(`session-mode: invalid --level "${level}" (want l3|l4|l5|l6, or none for a plain session)\n`);
    return 2;
  }
  const ttlHours = args['ttl-hours'] !== undefined ? Number(args['ttl-hours']) : DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttlHours) || ttlHours < 0) {
    process.stderr.write(`session-mode: invalid --ttl-hours "${args['ttl-hours']}"\n`);
    return 2;
  }
  const repoRoot = path.resolve(args['repo-root'] || gitToplevel());
  let missionRouting;
  try {
    missionRouting = admitMissionRouting({
      repoRoot,
      entryLevel: args['entry-level'] || level,
      fallback: args.fallback || 'none',
      markerFile: markerPath(),
      // Ordinary production: no allowTestCallerEvidence; registry-only evidence.
    });
  } catch (error) {
    process.stderr.write(`session-mode: Mission routing rejected: ${error.message}\n`);
    return 2;
  }
  if (missionRouting.route.effective_level !== level) {
    process.stderr.write(
      `session-mode: --level ${level} disagrees with Mission route effective level ` +
      `${missionRouting.route.effective_level}\n`,
    );
    return 2;
  }
  // Surface ordinary zero-spend no-op adoption on the marker for consumers.
  const now = Date.now();
  const marker = {
    session_id: getSessionId(),
    level,
    repo_root: repoRoot,
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlHours * 3600 * 1000).toISOString(),
  };
  // Additive scope fields (mods plan §2.8 write (2)); null when identity cannot be derived.
  let scope = { repo_identity: null, project_key: null };
  try { scope = scopeFromCwd(repoRoot); } catch (_error) { /* fail-open: fields stay null */ }
  marker.repo_identity = scope.repo_identity;
  marker.project_key = scope.project_key;
  // Job root (mods P1W W1f): explicit --root-run-id > AUTOPILOT_ROOT_RUN_ID (campaign/mission roots
  // stay untouched) > a freshly minted `job-<ts>-<rand>`. The dispatch rails read it back via
  // `session-mode.js root` so ad-hoc dispatches from one session share one lineage root.
  const explicitRoot = typeof args['root-run-id'] === 'string' && /^[A-Za-z0-9._-]+$/.test(args['root-run-id'])
    ? args['root-run-id'] : '';
  marker.root_run_id = resolveJobRoot({ explicit: explicitRoot, now });
  if (missionRouting.status !== 'LEGACY') {
    marker.entry_level = missionRouting.route.entry_level;
    marker.fallback_reason = missionRouting.route.fallback_reason;
    // mission_routing shape is frozen for verifyMissionRoutingProjection exactKeys.
    marker.mission_routing = {
      status: missionRouting.status,
      admitted: missionRouting.admitted,
      would_block: missionRouting.would_block,
      prior_marker_status: missionRouting.marker.status,
      admission: missionRouting.admission,
    };
    // Ordinary zero-spend no-op surface — sibling of mission_routing, not inside it.
    //
    // Emitted ONLY when there is an admission to bind it to. `admitMissionRouting`
    // returns `admission: null` on the SHADOW routing-failure path (shadow mode is
    // deliberately observe-only: mission-routing-admission.js throws under
    // `enforce` but returns a non-fatal `shadowFailure` otherwise). Dereferencing
    // `admission.admission_digest` there turned that deliberately-non-blocking
    // outcome into a hard TypeError that wrote no marker at all — strictly worse
    // than `off` mode. Omitting the surface is the correct degradation, not a
    // silent loss: `mission_noop` is optional to `verifyMissionRoutingProjection`
    // (hasOwnProperty-gated), and that verifier already rejects any marker whose
    // routing is not a READY/admitted/non-blocking admission — so a SHADOW marker
    // could never have supplied a usable no-op set anyway. Fabricating a digest
    // over a non-existent admission would be the only alternative, and that would
    // assert provenance nothing produced.
    // Oracle (incl. the negative control that keeps this from degrading into
    // "never emit mission_noop"): hooks/tests/session-mode.test.sh cases 11-12.
    if (missionRouting.admission) {
      const noopBody = {
        schema_version: 1,
        artifact_type: 'mission_noop_adoption_set',
        admission_digest: missionRouting.admission.admission_digest,
        noop_adoptions: Array.isArray(missionRouting.noop_adoptions)
          ? missionRouting.noop_adoptions : [],
        noop_short_circuit: missionRouting.noop_short_circuit === true,
        dispatcher_called: missionRouting.dispatcher_called,
        mutation_attempts: missionRouting.mutation_attempts,
        gate_attempts: missionRouting.gate_attempts,
        resources_created: missionRouting.resources_created,
      };
      marker.mission_noop = {
        ...noopBody,
        digest: canonicalDigest(noopBody),
      };
    }
  }
  if (hasInitFlags(args)) applyInitFields(marker, initParsed.init, repoRoot, null);
  fs.mkdirSync(markerDir(), { recursive: true });
  const tmp = `${markerPath()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
  fs.renameSync(tmp, markerPath()); // atomic on same fs
  try { writeLivePointer(); } catch (_error) { /* fail-open: pointer is advisory for the mod */ }
  startProjectWatcher(marker, repoRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, marker_path: markerPath(), ...marker }, null, 2)}\n`);
  return 0;
}

// One source for repo identity: scopeFromCwd() (task-runtime.js repoIdentity underneath). The former
// inline copy ran the same `git -C <dir> rev-parse --path-format=absolute --git-common-dir` + realpath,
// so main worktree, linked worktree and symlinked cwd derive identical values (pinned by
// hooks/tests/session-mode-watcher.test.sh); null for a non-repo directory.
function markerRepoIdentity(repoRoot) {
  return scopeFromCwd(repoRoot).repo_identity;
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
    'merge_provenance',
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

function retireFail(reason) {
  process.stderr.write(`session-mode: retire refused: ${reason}\n`);
  return 1;
}

function gitOk(repoRoot, args) {
  try {
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function cmdRetire(args) {
  const sessionId = args.session;
  const receiptFile = args['integration-receipt'];
  const integrationRef = args['integration-ref'] || 'develop';
  const repoRoot = args['repo-root'] ? path.resolve(args['repo-root']) : gitToplevel();
  if (!sessionId || !receiptFile) {
    process.stderr.write('session-mode: retire requires --session <id> and --integration-receipt <file>\n');
    return 2;
  }
  const target = path.join(markerDir(), `${normalizeSessionId(sessionId)}.json`);
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    return retireFail(`marker unreadable: ${error.message}`);
  }
  if (!marker || typeof marker !== 'object' || !LEVELS.has(marker.level)
      || typeof marker.repo_root !== 'string') {
    return retireFail('marker malformed');
  }
  let markerRepo;
  let thisRepo;
  try {
    markerRepo = fs.realpathSync(marker.repo_root);
    thisRepo = fs.realpathSync(repoRoot);
  } catch (error) {
    return retireFail(`repo_root unresolved: ${error.message}`);
  }
  if (markerRepo !== thisRepo) return retireFail('marker belongs to a different repository');
  const managed = marker.level === 'l5' || marker.level === 'l6'
    || (marker.level === 'l3' && ['l4', 'l5', 'l6'].includes(marker.entry_level));
  if (!managed) return retireFail('marker is not a managed (l5/l6 or degraded-from-l4+) marker; nothing for the bridge to refuse');
  const admission = marker.mission_routing && marker.mission_routing.admission;
  const graphDigest = admission && admission.mission_graph_digest;
  if (!SHA256.test(graphDigest || '')) return retireFail('marker carries no Mission graph digest');

  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(path.resolve(receiptFile), 'utf8'));
  } catch (error) {
    return retireFail(`integration receipt unreadable: ${error.message}`);
  }
  const edge = receipt && receipt.artifact_type === 'merge_execution_receipt'
    && receipt.status === 'complete' && Array.isArray(receipt.edges) && receipt.edges[0];
  if (!edge || edge.status !== 'executed'
      || !/^[a-f0-9]{40}$/u.test(edge.source_sha || '')
      || !/^[a-f0-9]{40}$/u.test(edge.accepted_sha || '')
      || typeof edge.source_ref !== 'string' || typeof edge.unit_id !== 'string') {
    return retireFail('integration receipt is not a complete merge_execution_receipt from record-integration.js');
  }

  // Bind the receipt to the marker through the Mission registry: the graph digest
  // names a lineage, the lineage holds a claim for unit_id, and that claim's branch
  // is the receipt's source_ref.
  let commonDir;
  try {
    commonDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    return retireFail(`git common dir unresolved: ${error.message}`);
  }
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(path.join(commonDir, 'autopilot', 'mission', 'registry.json'), 'utf8'));
  } catch (error) {
    return retireFail(`Mission registry unreadable: ${error.message}`);
  }
  let lineages = Object.entries((registry && registry.missions) || {})
    .filter(([, entry]) => entry && entry.mission_graph_digest === graphDigest);
  if (lineages.length === 0) return retireFail('no Mission lineage was prepared for the marker graph digest');
  // A marker records only the graph digest, not its lineage; a re-adopted plan (same
  // graph, reworded intent) yields a second lineage with the same digest. Do not pick
  // one silently: the operator names it with --lineage <adoption-key>.
  if (args.lineage) {
    lineages = lineages.filter(([key]) => key === args.lineage);
    if (lineages.length === 0) return retireFail('--lineage names no Mission lineage with the marker graph digest');
  } else if (lineages.length > 1) {
    return retireFail(`marker graph digest is shared by ${lineages.length} Mission lineages (${lineages.map(([key]) => key.slice(0, 12)).join(', ')}); pass --lineage <adoption-key> to name the integrated one`);
  }
  let bound = null;
  for (const [adoptionKey] of lineages) {
    let state;
    try {
      state = JSON.parse(fs.readFileSync(path.join(commonDir, 'autopilot', 'mission', 'states', `${adoptionKey}.json`), 'utf8'));
    } catch {
      continue;
    }
    for (const claim of Object.values((state && state.claims) || {})) {
      const branch = claim && claim.campaign_contract_draft && claim.campaign_contract_draft.branch;
      if (claim && claim.graph_node_id === edge.unit_id && typeof branch === 'string'
          && `refs/heads/${branch}` === edge.source_ref) {
        bound = { adoptionKey, claim_id: claim.claim_id, branch };
        break;
      }
    }
    if (bound) break;
  }
  if (!bound) return retireFail('integration receipt unit_id/source_ref match no claim of the marker lineage');

  // Git re-derivation: both commits exist, source ⊂ accepted ⊂ integration ref.
  if (!gitOk(repoRoot, ['cat-file', '-e', `${edge.source_sha}^{commit}`])) return retireFail('receipt source_sha does not resolve');
  if (!gitOk(repoRoot, ['cat-file', '-e', `${edge.accepted_sha}^{commit}`])) return retireFail('receipt accepted_sha does not resolve');
  if (integrationRef.startsWith('-')) return retireFail('integration ref must be a ref name, not an option');
  if (!gitOk(repoRoot, ['rev-parse', '--verify', '-q', '--end-of-options', `${integrationRef}^{commit}`])) return retireFail(`integration ref ${integrationRef} does not resolve`);
  if (!gitOk(repoRoot, ['merge-base', '--is-ancestor', edge.source_sha, edge.accepted_sha])) return retireFail('source_sha is not an ancestor of accepted_sha');
  if (!gitOk(repoRoot, ['merge-base', '--is-ancestor', '--end-of-options', edge.accepted_sha, integrationRef])) return retireFail(`accepted_sha is not an ancestor of ${integrationRef}`);

  try {
    fs.unlinkSync(target);
  } catch (error) {
    return retireFail(`marker unlink failed: ${error.message}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    retired: target,
    session_id: marker.session_id,
    lineage: bound.adoptionKey,
    graph_node_id: edge.unit_id,
    claim_id: bound.claim_id,
    branch: bound.branch,
    accepted_sha: edge.accepted_sha,
    integration_ref: integrationRef,
  }, null, 2)}\n`);
  return 0;
}

function cmdStatus() {
  const m = readSessionRecord();
  // A plain-session record is not an orchestrator mode: active:false, level "none" (the file keeps null).
  const out = !m
    ? { active: false, marker_path: markerPath() }
    : (m.level === null
      ? { active: false, marker_path: markerPath(), ...m, level: 'none' }
      : { active: true, marker_path: markerPath(), ...m });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

// Prints the active marker's job root (empty when no live marker / no root). Rails call this
// to pick the lineage root for an ad-hoc dispatch; always exit 0 so a missing marker is silent.
function cmdRoot() {
  const m = readSessionRecord();
  process.stdout.write(m && typeof m.root_run_id === 'string' ? `${m.root_run_id}\n` : '\n');
  return 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (cmd) {
    case 'set': return cmdSet(args);
    case 'clear': return cmdClear(args);
    case 'retire': return cmdRetire(args);
    case 'bind-campaign-root': return cmdBindCampaignRoot(args);
    case 'status': return cmdStatus();
    case 'root': return cmdRoot();
    default:
      process.stderr.write(
        'Usage: session-mode.js set [--level none] [--root-run-id <id>] (plain session) | ' +
        'set --level l3|l4|l5|l6 [--entry-level l3|l4|l5|l6] ' +
        '[--fallback none|solo|precondition_failed] [--repo-root <dir>] [--ttl-hours N] [--root-run-id <id>] | ' +
        'set --size XS|S|M|L|XL [--urgent] [--bug] [--base-ref <sha>] (create-or-merge; size only moves up) | ' +
        'clear | retire --session <id> --integration-receipt <file> [--integration-ref <ref>] | bind-campaign-root --root <id> (--repo-identity <id> | --repo-root <dir>) | status | root\n',
      );
      return 2;
  }
}

if (require.main === module) process.exit(main());
module.exports = {
  DEV_FLOW_ADMISSION_REJECTION_CODE,
  devFlowAdmissionRejection,
  readMarker,
  readSessionRecord,
  ensurePlainMarker,
  resolveJobRoot,
  getSessionId,
  normalizeSessionId,
  markerPath,
  markerRepoIdentity,
  validateManagedDevFlowAdmission,
  campaignCarriesMissionProjection,
  campaignRootRunId,
  bindCampaignRoot,
  hasExplicitSessionId,
  validateCloseReceipt,
  verifyMissionRoutingProjection,
  LEVELS,
  SIZES,
  markerDir,
  writeMarkerFile,
  defaultBaseRef,
  PHASE_LOCK_TIMEOUT_MS,
};
