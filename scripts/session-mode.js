#!/usr/bin/env node
/**
 * session-mode.js — orchestrator-mode marker CLI (A1/A2 support, v2.32.27).
 *
 * Written by depth-0 at /l3 /l4 /l5 /l6 entry; read by the orchestrator-edit-gate
 * and context-budget hooks. One marker file per session id:
 *   ${AUTOPILOT_SESSION_MODE_DIR:-~/.autopilot/session-mode}/<session-id>.json
 *   { session_id, level, repo_root, started_at, expires_at, entry_level?, fallback_reason?,
 *     mission_routing? }
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

const LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);
const DEFAULT_TTL_HOURS = 24;
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
    case 'retire': return cmdRetire(args);
    case 'status': return cmdStatus();
    default:
      process.stderr.write(
        'Usage: session-mode.js set --level l3|l4|l5|l6 [--entry-level l3|l4|l5|l6] ' +
        '[--fallback none|solo|precondition_failed] [--repo-root <dir>] [--ttl-hours N] | ' +
        'clear | retire --session <id> --integration-receipt <file> [--integration-ref <ref>] | status\n',
      );
      return 2;
  }
}

if (require.main === module) process.exit(main());
module.exports = {
  DEV_FLOW_ADMISSION_REJECTION_CODE,
  devFlowAdmissionRejection,
  readMarker,
  getSessionId,
  normalizeSessionId,
  markerPath,
  markerRepoIdentity,
  validateManagedDevFlowAdmission,
  campaignCarriesMissionProjection,
  validateCloseReceipt,
  verifyMissionRoutingProjection,
  LEVELS,
};
