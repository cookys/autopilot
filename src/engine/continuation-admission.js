'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const workOrder = require('./work-order');
const ARTIFACT_TYPE = 'continuation_checkpoint';
const DURABLE_ARTIFACT_TYPE = 'continuation_durable_tracker';
const SCHEMA_VERSION = 1;
const TERMINAL_CAMPAIGN_PHASES = new Set([ 'terminal_ready', 'terminal_follow_up', 'terminal_stop', 'merged', 'dead', 'quarantined', 'stale_ignored',]);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isGitSha = (v) => typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v);
const isPhaseCursor = (v) => typeof v === 'string' && /^\d+\/\d+$/.test(v);
function baseResult(extra = {}) { return { status: 'reject', action: 'fail_closed', reason_code: null, reason: null, missing: null,
    duplicate_dispatch: 0, root_run_id: null, phase_cursor: null, accepted_commit: null, next_action: null,
    attached_run_id: null, rehydrated: null, authority: null,...extra,};}
function checkpointMissingFields(checkpoint) { if (!isObj(checkpoint)) return ['checkpoint'];
  const m = [];
  if (checkpoint.schema_version !== SCHEMA_VERSION) m.push('schema_version');
  if (checkpoint.artifact_type !== ARTIFACT_TYPE&& checkpoint.artifact_type !== DURABLE_ARTIFACT_TYPE) { m.push('artifact_type');}
  if (!isStr(checkpoint.root_run_id)) m.push('root_run_id');
  if (!isPhaseCursor(checkpoint.phase_cursor)) m.push('phase_cursor');
  if (!isStr(checkpoint.next_action)) m.push('next_action');
  if (!(checkpoint.accepted_commit === 'none' || isGitSha(checkpoint.accepted_commit))) { m.push('accepted_commit');}
  return m;}
const isCompleteCheckpoint = (c) => checkpointMissingFields(c).length === 0;
function canonicalIdentityBody(fields) { const body = { schema_version: SCHEMA_VERSION, artifact_type: fields.artifact_type || ARTIFACT_TYPE,
    root_run_id: fields.root_run_id, phase_cursor: fields.phase_cursor, accepted_commit: fields.accepted_commit,
    next_action: fields.next_action, campaign_phase: isStr(fields.campaign_phase) ? fields.campaign_phase : null,
    project: isStr(fields.project) ? fields.project : null, branch: isStr(fields.branch) ? fields.branch : null,
    stage: isStr(fields.stage) ? fields.stage : null, base_sha: isStr(fields.base_sha) ? fields.base_sha : null,
    idempotency_key: isStr(fields.idempotency_key) ? fields.idempotency_key : null,};
  if (isObj(fields.artifact_digests)) body.artifact_digests = fields.artifact_digests;
  if (isObj(fields.artifact_paths)) body.artifact_paths = fields.artifact_paths;
  return body;}
const checkpointDigest = (f) => crypto.createHash('sha256').update(JSON.stringify(canonicalIdentityBody(f)), 'utf8').digest('hex');
function buildCheckpoint(fields, options = {}) { if (!isObj(fields)) throw new TypeError('buildCheckpoint requires a plain object');
  const artifactType = options.durable === true? DURABLE_ARTIFACT_TYPE: (fields.artifact_type || ARTIFACT_TYPE);
  const checkpoint = { schema_version: SCHEMA_VERSION, artifact_type: artifactType, root_run_id: fields.root_run_id,
    phase_cursor: fields.phase_cursor, accepted_commit: fields.accepted_commit, next_action: fields.next_action, campaign_phase: isStr(fields.campaign_phase)
      ? fields.campaign_phase : null,};
  for (const k of ['project', 'branch', 'stage', 'base_sha', 'idempotency_key']) { if (isStr(fields[k])) checkpoint[k] = fields[k];}
  if (isObj(fields.artifact_digests)) checkpoint.artifact_digests = fields.artifact_digests;
  if (isObj(fields.artifact_paths)) checkpoint.artifact_paths = fields.artifact_paths;
  const missing = checkpointMissingFields(checkpoint);
  if (missing.length > 0) { const err = new Error(`incomplete continuation checkpoint: missing ${missing.join(',')}`);
    err.code = 'incomplete_checkpoint';
    err.missing = missing;
    throw err;}
  checkpoint.digest = checkpointDigest(checkpoint);
  return checkpoint;}
function rehydrateCheckpoint(checkpoint) { const missing = checkpointMissingFields(checkpoint);
  if (missing.length > 0) { return baseResult({
      status: 'reject', reason_code: 'incomplete_checkpoint', reason: `incomplete continuation checkpoint: missing ${missing.join(',')}`, missing,});}
  if (!isStr(checkpoint.digest)) { return baseResult({
      status: 'reject', reason_code: 'checkpoint_digest_mismatch', reason: 'continuation checkpoint requires digest',});}
  if (checkpoint.digest !== checkpointDigest(checkpoint)) { return baseResult({ status: 'reject', reason_code: 'checkpoint_digest_mismatch',
      reason: 'continuation checkpoint digest does not match authoritative fields',});}
  const rehydrated = { root_run_id: checkpoint.root_run_id, phase_cursor: checkpoint.phase_cursor,
    accepted_commit: checkpoint.accepted_commit, next_action: checkpoint.next_action, project: checkpoint.project || null, branch: checkpoint.branch || null,
    stage: checkpoint.stage || null, base_sha: checkpoint.base_sha || null,
    campaign_phase: checkpoint.campaign_phase || null, idempotency_key: checkpoint.idempotency_key || null,
    digest: checkpoint.digest || checkpointDigest(checkpoint), artifact_type: checkpoint.artifact_type,};
  return {...baseResult({ status: 'rehydrated', action: 'rehydrate', reason_code: null, reason: null,
      root_run_id: rehydrated.root_run_id, phase_cursor: rehydrated.phase_cursor,
      accepted_commit: rehydrated.accepted_commit, next_action: rehydrated.next_action, rehydrated,
      authority: checkpoint.artifact_type === DURABLE_ARTIFACT_TYPE? 'durable_tracker' : 'checkpoint',}),};}
function loadJsonFile(filePath, reasonCode) { if (!isStr(filePath)) { return {
      ok: false, result: baseResult({ status: 'reject', reason_code: reasonCode, reason: 'path is required', missing: ['path'],}),};}
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) { return {
      ok: false, result: baseResult({ status: 'reject', reason_code: reasonCode, reason: `file not found: ${resolved}`, missing: ['path'],}),};}
  try { return { ok: true, value: JSON.parse(fs.readFileSync(resolved, 'utf8')), path: resolved };} catch (error) { return {
      ok: false, result: baseResult({ status: 'reject', reason_code: reasonCode,
        reason: `file is not valid JSON: ${error.message || String(error)}`, missing: ['path'],}),};}}
function loadCheckpointFile(filePath) { const loaded = loadJsonFile(filePath, 'incomplete_checkpoint');
  if (!loaded.ok) return loaded.result;
  return rehydrateCheckpoint(loaded.value);}
function normalizeIdentityFields(source) { if (!isObj(source)) return null;
  return { root_run_id: source.root_run_id || source.rootRunId || null, phase_cursor: source.phase_cursor || source.phaseCursor || null,
    accepted_commit: source.accepted_commit || source.acceptedCommit || null,
    next_action: source.next_action || source.nextAction || null, project: source.project || null,
    branch: source.branch || null, stage: source.stage || null, base_sha: source.base_sha || source.baseSha || null,
    campaign_phase: source.campaign_phase || source.campaignPhase || null, artifact_type: source.artifact_type || null,};}
function hydrateDurableOrCheckpoint(raw) {
  if (!isObj(raw)) return { ok: false, result: baseResult({ status: 'reject', reason_code: 'incomplete_checkpoint', reason: 'durable/checkpoint missing' }) };
  const hydrated = rehydrateCheckpoint(raw); // digest-bound; 16/34→99/99 tamper fails closed
  if (hydrated.status === 'reject') return { ok: false, result: hydrated };
  return { ok: true, identity: hydrated.rehydrated, authority: hydrated.authority };
}
function resolveAuthoritativeIdentity(input = {}) { const durableSources = [];
  if (Array.isArray(input.durableSources)) {
    for (const src of input.durableSources) {
      if (!isObj(src)) continue;
      if (src.artifact_type === ARTIFACT_TYPE || src.artifact_type === DURABLE_ARTIFACT_TYPE
          || isStr(src.digest) || isStr(src.phase_cursor)) {
        const h = hydrateDurableOrCheckpoint(src);
        if (!h.ok) return h.result;
        durableSources.push({ ...h.identity, artifact_type: h.identity.artifact_type || DURABLE_ARTIFACT_TYPE });
      } else {
        const norm = normalizeIdentityFields(src);
        if (norm && isStr(norm.root_run_id)) durableSources.push(norm);
      }
    }
  }
  if (isObj(input.durable)) {
    const h = hydrateDurableOrCheckpoint(input.durable);
    if (!h.ok) return h.result;
    durableSources.push({ ...h.identity, artifact_type: h.identity.artifact_type || DURABLE_ARTIFACT_TYPE });
  }
  if (durableSources.length > 1) { const sets = ['root_run_id', 'phase_cursor', 'accepted_commit', 'next_action']
      .map((k) => new Set(durableSources.map((s) => s[k]).filter(isStr)));
    if (sets.some((s) => s.size > 1)) { return baseResult({
        status: 'reject', reason_code: 'ambiguous_tracker', reason: 'durable tracker sources disagree on continuation identity fields',});}}
  let durable = durableSources.length > 0 ? { ...durableSources[0] } : null;
  if (durable) { for (const extra of durableSources.slice(1)) { for (const key of Object.keys(extra)) {
        if (!isStr(durable[key]) && isStr(extra[key])) durable[key] = extra[key];}}}
  let checkpoint = null;
  if (isObj(input.checkpoint)) { const hydrated = rehydrateCheckpoint(input.checkpoint);
    if (hydrated.status === 'reject') return hydrated;
    checkpoint = hydrated.rehydrated;}
  const narrative = normalizeIdentityFields(input.narrative) || null;
  const base = durable || checkpoint || null;
  if (!base) {
    if (narrative && isStr(narrative.root_run_id) && input.allowNarrativeOnly === true) return { status: 'resolved', authority: 'narrative', identity: narrative, narrative_ignored: false };
    return baseResult({ status: 'reject', reason_code: 'incomplete_checkpoint', reason: 'no durable tracker or complete checkpoint available for rehydration',
      missing: ['durable', 'checkpoint'],});}
  const identity = { ...base };
  if (durable) { for (const key of [ 'root_run_id', 'phase_cursor', 'accepted_commit', 'next_action',
      'project', 'branch', 'stage', 'base_sha', 'campaign_phase',]) { if (isStr(durable[key])) identity[key] = durable[key];}}
  const narrativeIgnored = Boolean( narrative && ( (isStr(narrative.phase_cursor) && identity.phase_cursor&& narrative.phase_cursor !== identity.phase_cursor)
      || (isStr(narrative.next_action) && identity.next_action&& narrative.next_action !== identity.next_action)
      || (isStr(narrative.root_run_id) && identity.root_run_id&& narrative.root_run_id !== identity.root_run_id)),);
  if (!isPhaseCursor(identity.phase_cursor) || !isStr(identity.next_action)|| !(identity.accepted_commit === 'none' || isGitSha(identity.accepted_commit))
      || !isStr(identity.root_run_id)) { return baseResult({
      status: 'reject', reason_code: 'incomplete_checkpoint', reason: 'resolved continuation identity is incomplete',
      missing: checkpointMissingFields({ schema_version: SCHEMA_VERSION, artifact_type: ARTIFACT_TYPE, ...identity,}),
      root_run_id: identity.root_run_id || null,});}
  return { status: 'resolved', authority: durable ? 'durable' : 'checkpoint', identity, narrative_ignored: narrativeIgnored, rehydrated: identity,};}
function observeGitCommit(cwd, ref) { if (!isStr(cwd) || !isStr(ref)) return null;
  try { return execFileSync('git', ['-C', cwd, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],}).trim();
  } catch (_e) { return null; }}
function rejectCommit(identity, reason) { return { ok: false, result: baseResult({ status: 'reject', reason_code: 'accepted_commit_drift', reason,
      root_run_id: identity.root_run_id, phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit, next_action: identity.next_action,}),
  };}
function checkAcceptedCommit(identity, options = {}) { if (!identity || identity.accepted_commit === 'none') return { ok: true };
  const accepted = identity.accepted_commit;
  if (!isGitSha(accepted)) return rejectCommit(identity, 'accepted_commit is not a git sha or "none"');
  const observed = isStr(options.observedCommit)? options.observedCommit: (isStr(options.gitCwd) ? observeGitCommit(options.gitCwd, accepted) : accepted);
  if (options.requireCommitInRepo === true && isStr(options.gitCwd)&& !observeGitCommit(options.gitCwd, accepted)) {
    return rejectCommit(identity, `accepted_commit ${accepted} is not present in git repository`);}
  const drift = (a, b) => isStr(a) && isStr(b)&& a.toLowerCase() !== b.toLowerCase()&& !a.toLowerCase().startsWith(b.toLowerCase())
    && !b.toLowerCase().startsWith(a.toLowerCase());
  if (drift(options.expectedCommit, accepted)) return rejectCommit(identity, `accepted_commit ${accepted} drifts from observed git ${options.expectedCommit}`);
  if (options.strictObserved === true && drift(observed, accepted)) return rejectCommit(identity, `accepted_commit ${accepted} drifts from observed ${observed}`);
  return { ok: true };}
function normalizeRunRecord(run) { if (!isObj(run)) return null;
  const runId = run.run_id || run.runId || null, rootRunId = run.root_run_id || run.rootRunId || runId;
  if (!isStr(runId) || !isStr(rootRunId)) return null;
  const finalStatus = run.final_status === undefined || run.final_status === null? null : String(run.final_status);
  const endedAt = run.ended_at === undefined || run.ended_at === null ? null : run.ended_at;
  const raw = isObj(run.owner) ? run.owner : { pid: run.pid || run.owner_pid || null,
    process_start_time: run.process_start_time || run.owner_process_start_time || null, pgid: run.pgid || null, sid: run.sid || null,};
  const owner = { pid: raw.pid != null ? Number(raw.pid) : null, process_start_time: raw.process_start_time != null ? Number(raw.process_start_time) : null,
    pgid: raw.pgid != null ? Number(raw.pgid) : null, sid: raw.sid != null ? Number(raw.sid) : null,};
  const open = finalStatus === null || finalStatus === '' || finalStatus === 'null';
  const active = open && workOrder.isProcessLiveStrict(owner); // pid-only never active
  const incomplete_identity = open && Number.isInteger(owner.pid) && owner.pid > 0 && !workOrder.isCompleteIdentity(owner);
  const er = isObj(run.expected_receipt) ? run.expected_receipt : null;
  return { run_id: runId, root_run_id: rootRunId, stage: run.stage || null, branch: run.branch || null, base: run.base || null,
    base_sha: run.base_sha || run.baseSha || null, final_status: active ? null : (finalStatus || 'stale'), ended_at: endedAt, active, incomplete_identity,
    terminal: !active && finalStatus !== null && finalStatus !== '' && finalStatus !== 'null', owner, authority: run.authority || null,
    work_order_path: run.work_order_path || null, lease_path: run.lease_path || null,
    ledger_path: (isObj(run.paths) && run.paths.ledger) || run.ledger_path || null, expected_receipt: er,
    terminal_receipt: isObj(run.terminal_receipt) ? run.terminal_receipt : null,
    terminal_receipt_path: run.terminal_receipt_path || run.receipt_path || (isObj(run.paths) && run.paths.receipt) || (er && er.path) || null,};}
function authenticateCheckpointEvidence(checkpoint, options = {}) {
  if (!isObj(checkpoint)) return { ok: false, reason_code: 'unauthenticated_evidence', reason: 'checkpoint missing' };
  if (isStr(checkpoint.digest) && checkpoint.digest !== checkpointDigest(checkpoint)) {
    return { ok: false, reason_code: 'checkpoint_digest_mismatch', reason: 'self-digest mismatch', };}
  if (!isStr(checkpoint.digest) && (checkpoint.artifact_type === ARTIFACT_TYPE || checkpoint.artifact_type === DURABLE_ARTIFACT_TYPE)) {
    return { ok: false, reason_code: 'checkpoint_digest_mismatch', reason: 'continuation tracker requires self-digest', };}
  const digests = isObj(checkpoint.artifact_digests) ? checkpoint.artifact_digests : {};
  const paths = isObj(checkpoint.artifact_paths) ? { ...checkpoint.artifact_paths }
    : (isObj(options.artifactPaths) ? { ...options.artifactPaths } : {});
  // durablePath verifies on-disk body; mere path presence is NOT bound evidence.
  if (isStr(options.durablePath) && !isStr(paths.durable) && checkpoint.artifact_type === DURABLE_ARTIFACT_TYPE) {
    paths.durable = options.durablePath; }
  const hasBound = ( (isStr(digests.mission) && isStr(paths.mission)) || (isStr(digests.ledger) && isStr(paths.ledger))
    || (isStr(digests.durable) && isStr(paths.durable)) || (options.workOrderBound === true));
  if (options.requireBoundEvidence === true && !hasBound) { return { ok: false, reason_code: 'unauthenticated_evidence',
      reason: 'caller checkpoint digest is not bound to Mission/ledger/tracker artifacts',};}
  for (const key of ['mission', 'ledger', 'durable']) {
    if (isStr(paths[key]) && isStr(digests[key]) && workOrder.sha256File(paths[key]) !== digests[key]) {
      return { ok: false, reason_code: 'artifact_digest_mismatch', reason: `${key} digest mismatch`, };}}
  if (isStr(options.durablePath) && checkpoint.artifact_type === DURABLE_ARTIFACT_TYPE && isStr(checkpoint.digest)) {
    const onDisk = workOrder.readJsonIfPresent(options.durablePath);
    if (!onDisk || !isStr(onDisk.digest) || onDisk.digest !== checkpoint.digest || onDisk.digest !== checkpointDigest(onDisk)
        || (isStr(onDisk.phase_cursor) && isStr(checkpoint.phase_cursor) && onDisk.phase_cursor !== checkpoint.phase_cursor)) {
      return { ok: false, reason_code: 'checkpoint_digest_mismatch',
        reason: 'durablePath on-disk tracker self-digest/phase does not match admitted body', };}}
  return { ok: true, bound: hasBound };}
function requireReconcileReceipt(input = {}) { const commonDir = input.commonDir|| (input.gitCwd ? workOrder.resolveGitCommonDir(input.gitCwd) : null);
  const rootRunId = input.root_run_id || null;
  const missionActive = input.missionActive === true|| input.requireReconcile === true
    || (Array.isArray(input.missionWorkOrders) && input.missionWorkOrders.length > 0);
  if (!isStr(commonDir)) {
    if (missionActive) { return { required: true, ok: false, commonDir: null, nonterminal: [],
        reason_code: 'git_common_dir_missing', reason: 'mission/reconcile requires git-common-dir',};}
    return { required: false, ok: true, commonDir: null, nonterminal: [] };}
  if (missionActive && !isStr(rootRunId)) { return { required: true, ok: false, commonDir, nonterminal: [],
      reason_code: 'root_run_id_required', reason: 'root_run_id mandatory for exact-root reconcile enumeration',};}
  const nonterminal = isStr(rootRunId) ? workOrder.listNonterminalWorkOrders(commonDir, rootRunId) : [];
  const required = nonterminal.length > 0 || missionActive;
  if (!required) return { required: false, ok: true, commonDir, nonterminal };
  let receipt = input.reconcileReceipt || null;
  if (!receipt && isStr(input.reconcileReceiptPath)) { receipt = workOrder.readJsonIfPresent(input.reconcileReceiptPath);}
  if (!receipt && isStr(rootRunId)) { receipt = workOrder.readJsonIfPresent(workOrder.reconcileReceiptPath(commonDir, rootRunId));}
  // Cross-root receipts never attach/consume; same-root needs digest/freshness/class match.
  const validated = workOrder.validateReconcileReceipt(receipt, { root_run_id: rootRunId, commonDir,});
  if (!validated.ok) { return { required: true, ok: false, commonDir, nonterminal, reason_code: validated.reason_code || 'reconcile_receipt_missing',
      reason: validated.reason || 'fresh PostCompact reconcile receipt required', receipt: null,};}
  if (isStr(rootRunId) && isStr(validated.receipt.root_run_id) && validated.receipt.root_run_id !== rootRunId) {
    return { required: true, ok: false, commonDir, nonterminal, reason_code: 'reconcile_receipt_mismatch',
      reason: 'reconcile receipt root_run_id mismatch', receipt: null,};}
  return { required: true, ok: true, commonDir, nonterminal, receipt: validated.receipt };}
function runMatchesIdentity(run, identity, _options = {}) { if (!run || !identity || !isStr(identity.root_run_id)) return false;
  if (run.root_run_id !== identity.root_run_id) return false;
  if (isStr(identity.stage) && run.stage !== identity.stage) return false;
  if (isStr(identity.branch) && run.branch !== identity.branch) return false;
  if (isStr(identity.base_sha) && (run.base_sha || run.base) !== identity.base_sha) return false;
  return true;}
function attachResult(extra) { return { status: 'attach', action: 'attach_active', reason_code: null, duplicate_dispatch: 0,
    narrative_ignored: true, classification: 'attach_active',...extra,};}
function consumeSuccess(extra) { return { status: 'consume', action: 'consume_terminal', reason_code: null, duplicate_dispatch: 0,
    classification: 'consume_terminal', success: true, narrative_ignored: true,...extra,};}
function consumeFailure(extra) { return baseResult({
    status: 'reject', action: 'consume_terminal', reason_code: 'terminal_failure', classification: 'consume_terminal',...extra,});}
function admitFromReconcileReceipt(receipt, rootRunId) { const classes = receipt.classifications || [];
  const id = receipt.identity || {};
  const attach = classes.find((c) => c.classification === 'attach_active');
  if (attach) { return attachResult({ reason: 'PostCompact reconcile: attach_active work order', root_run_id: id.root_run_id || rootRunId,
      phase_cursor: id.phase_cursor || null, accepted_commit: id.accepted_commit || null,
      next_action: id.next_action || null, attached_run_id: attach.work_order_id, reconcile_receipt: receipt, rehydrated: id, authority: 'work_order',});}
  const consume = classes.find((c) => c.classification === 'consume_terminal');
  if (consume) { if (consume.success !== true) { return consumeFailure({
        reason: `terminal work order failed with status=${consume.terminal_status}; refuse re-dispatch`,
        root_run_id: rootRunId || receipt.root_run_id, phase_cursor: id.phase_cursor || null,
        accepted_commit: id.accepted_commit || null, next_action: id.next_action || null,
        attached_run_id: consume.work_order_id, terminal_status: consume.terminal_status, reconcile_receipt: receipt, authority: 'work_order',});}
    return consumeSuccess({ reason: `consume terminal work order status=${consume.terminal_status}`,
      root_run_id: rootRunId || receipt.root_run_id, phase_cursor: id.phase_cursor || null,
      accepted_commit: id.accepted_commit || null, next_action: id.next_action || null,
      attached_run_id: consume.work_order_id, terminal_status: consume.terminal_status, reconcile_receipt: receipt, authority: 'work_order',});}
  const orphan = classes.find((c) => c.classification === 'orphan_blocked');
  if (orphan) { return baseResult({ status: 'reject', reason_code: 'orphan_blocked',
      reason: orphan.reason || 'work order orphan_blocked', root_run_id: rootRunId, reconcile_receipt: receipt,});}
  return null; // stale_dispositioned only → fall through
}
function admitContinuation(input = {}) { const identityInput = isObj(input.identity) ? input.identity : {};
  const requireIdentity = input.requireIdentity !== false;
  const rootRunId = identityInput.root_run_id || null;
  const commonDir = input.commonDir|| (input.gitCwd ? workOrder.resolveGitCommonDir(input.gitCwd) : null);
  const reconcileGate = requireReconcileReceipt({ commonDir, gitCwd: input.gitCwd, root_run_id: rootRunId, reconcileReceipt: input.reconcileReceipt,
    reconcileReceiptPath: input.reconcileReceiptPath, missionActive: input.missionActive === true, requireReconcile: input.requireReconcile === true,});
  if (reconcileGate.required && !reconcileGate.ok) { return baseResult({
      status: 'reject', reason_code: reconcileGate.reason_code, reason: reconcileGate.reason, root_run_id: rootRunId,});}
  if (reconcileGate.required && reconcileGate.receipt) { const early = admitFromReconcileReceipt(reconcileGate.receipt, rootRunId);
    if (early) return early;}
  let checkpoint = null;
  if (isStr(input.checkpointPath)) { const loaded = loadJsonFile(input.checkpointPath, 'incomplete_checkpoint');
    if (!loaded.ok) return loaded.result;
    checkpoint = loaded.value;} else if (input.checkpoint != null) { checkpoint = input.checkpoint;}
  let durable = isObj(input.durable) ? input.durable : null;
  if (isStr(input.durablePath)) { const loaded = loadJsonFile(input.durablePath, 'incomplete_checkpoint');
    if (!loaded.ok) return loaded.result;
    durable = loaded.value;}
  if (checkpoint) { const h = rehydrateCheckpoint(checkpoint);
    if (h.status === 'reject') return h;
    checkpoint = { ...checkpoint, ...h.rehydrated, digest: h.rehydrated.digest };}
  if (durable) { const h = rehydrateCheckpoint(durable);
    if (h.status === 'reject') return h;
    durable = { ...durable, ...h.rehydrated, digest: h.rehydrated.digest };}
  if (checkpoint && !durable) { const auth = authenticateCheckpointEvidence(checkpoint, { requireBoundEvidence: input.requireBoundEvidence === true
        || reconcileGate.required === true|| input.missionActive === true,
      artifactPaths: input.artifactPaths, durablePath: input.durablePath, workOrderBound: false,});
    if (!auth.ok) { return baseResult({ status: 'reject', reason_code: auth.reason_code, reason: auth.reason, root_run_id: rootRunId,});}}
  if (durable) {
    // Bound only under mission/reconcile/flag; workOrderBound after validated receipt (no path free-pass).
    const requireBound = input.requireBoundEvidence === true || reconcileGate.required === true || input.missionActive === true;
    const auth = authenticateCheckpointEvidence(durable, { requireBoundEvidence: requireBound, durablePath: input.durablePath,
      workOrderBound: Boolean(reconcileGate.required && reconcileGate.ok && reconcileGate.receipt), artifactPaths: input.artifactPaths,});
    if (!auth.ok) { return baseResult({ status: 'reject', reason_code: auth.reason_code, reason: auth.reason, root_run_id: rootRunId,});}
    // durablePath vs live WO phase: 16/34→99/99 never dispatch_new.
    if (isStr(input.durablePath) && isStr(commonDir) && isStr(durable.root_run_id)) {
      for (const entry of workOrder.listWorkOrders(commonDir, durable.root_run_id)) {
        const live = entry.work_order;
        if (!live || entry.error) continue;
        if (isStr(live.phase_cursor) && isStr(durable.phase_cursor) && live.phase_cursor !== durable.phase_cursor) {
          return baseResult({ status: 'reject', reason_code: 'checkpoint_digest_mismatch',
            reason: `durablePath phase ${durable.phase_cursor} disagrees with work-order phase ${live.phase_cursor}`,
            root_run_id: durable.root_run_id, phase_cursor: live.phase_cursor,});}}}
  }
  const hasDurableOrCheckpoint = Boolean( durable|| (Array.isArray(input.durableSources) && input.durableSources.length > 0)|| checkpoint,);
  let resolved;
  let identity;
  if (hasDurableOrCheckpoint) { resolved = resolveAuthoritativeIdentity({ durable, durableSources: input.durableSources, checkpoint,
      narrative: input.narrative, allowNarrativeOnly: input.allowNarrativeOnly === true,});
    if (resolved.status === 'reject') { return { ...resolved, root_run_id: rootRunId || resolved.root_run_id || null, attached_run_id: null, };}
    identity = resolved.identity;} else if (reconcileGate.receipt && reconcileGate.receipt.identity) {
    resolved = { status: 'resolved', authority: 'work_order', narrative_ignored: true };
    identity = { root_run_id: reconcileGate.receipt.identity.root_run_id || rootRunId, phase_cursor: reconcileGate.receipt.identity.phase_cursor || null,
      accepted_commit: reconcileGate.receipt.identity.accepted_commit || null, next_action: reconcileGate.receipt.identity.next_action || null,
      branch: identityInput.branch || null, stage: identityInput.stage || null, base_sha: identityInput.base_sha || null, campaign_phase: null,};} else {
    resolved = { status: 'resolved', authority: 'identity', narrative_ignored: false };
    identity = { root_run_id: rootRunId, phase_cursor: null, accepted_commit: null, next_action: null,
      branch: identityInput.branch || null, stage: identityInput.stage || null, base_sha: identityInput.base_sha || null, campaign_phase: null,};}
  const effectiveRoot = identity.root_run_id || rootRunId || null;
  if (requireIdentity && !isStr(effectiveRoot)) { return baseResult({ status: 'not_found', action: 'not_found', reason_code: 'not_found',
      reason: 'continuation identity root_run_id is absent', phase_cursor: identity.phase_cursor,
      accepted_commit: identity.accepted_commit, next_action: identity.next_action, rehydrated: identity, authority: resolved.authority,});}
  if (isStr(identity.campaign_phase) && TERMINAL_CAMPAIGN_PHASES.has(identity.campaign_phase)) { return baseResult({
      status: 'reject', reason_code: 'terminal_state', reason: `campaign phase ${identity.campaign_phase} is terminal; refuse re-dispatch`,
      root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor,
      accepted_commit: identity.accepted_commit, next_action: identity.next_action, rehydrated: identity, authority: resolved.authority,});}
  if (identity.accepted_commit === 'none' || isGitSha(identity.accepted_commit)) { const commitCheck = checkAcceptedCommit(identity, {
      gitCwd: input.gitCwd || null, observedCommit: input.observedCommit || null,
      expectedCommit: input.expectedCommit || null, requireCommitInRepo: input.requireCommitInRepo === true
        || (isStr(input.gitCwd) && isGitSha(identity.accepted_commit)), strictObserved: input.strictObserved === true,});
    if (!commitCheck.ok) return { ...commitCheck.result, rehydrated: identity, authority: resolved.authority };}
  if (isStr(commonDir) && isStr(effectiveRoot)) { for (const entry of workOrder.listWorkOrders(commonDir, effectiveRoot)) {
      const classified = workOrder.classifyWorkOrder(entry.work_order, {
        gitCwd: input.gitCwd || null, workOrderPath: entry.path, terminalReceipt: input.terminalReceipt || null,
        requireBoundEvidence: input.requireBoundEvidence !== false,});
      if (classified.classification === 'attach_active') { return attachResult({
          reason: 'durable work order active (PID/start/PGID/SID); attach instead of re-dispatch',
          root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor || entry.work_order.phase_cursor,
          accepted_commit: identity.accepted_commit || entry.work_order.accepted_commit, next_action: identity.next_action || entry.work_order.next_action,
          attached_run_id: entry.work_order.work_order_id, work_order: entry.work_order,
          rehydrated: identity, authority: 'work_order', narrative_ignored: resolved.narrative_ignored === true,});}
      if (classified.classification === 'consume_terminal') { if (classified.success === false) { return consumeFailure({
            reason: `terminal work order status=${classified.terminal_status}; refuse masked resume`,
            root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit, next_action: identity.next_action,
            attached_run_id: entry.work_order.work_order_id, terminal_status: classified.terminal_status, authority: 'work_order',});}
        return consumeSuccess({ reason: 'consume validated terminal receipt', root_run_id: effectiveRoot,
          phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
          next_action: identity.next_action, attached_run_id: entry.work_order.work_order_id,
          terminal_status: classified.terminal_status, rehydrated: identity, authority: 'work_order', narrative_ignored: resolved.narrative_ignored === true,
        });}
      if (classified.classification === 'orphan_blocked') { return baseResult({ status: 'reject', reason_code: classified.reason_code || 'orphan_blocked',
          reason: classified.reason, root_run_id: effectiveRoot, classification: 'orphan_blocked', authority: 'work_order',});}}}
  const matchIdentity = { root_run_id: effectiveRoot, stage: identityInput.stage || identity.stage || null,
    branch: identityInput.branch || identity.branch || null, base_sha: identityInput.base_sha || identity.base_sha || null,};
  const runs = Array.isArray(input.matchingRuns)? input.matchingRuns.map(normalizeRunRecord).filter(Boolean) : [];
  const sameRoot = runs.filter((r) => r.root_run_id === effectiveRoot);
  const matches = sameRoot.filter((run) => runMatchesIdentity(run, matchIdentity));
  const wantsBind = isStr(matchIdentity.stage) || isStr(matchIdentity.branch) || isStr(matchIdentity.base_sha);
  if (matches.length === 0 && wantsBind && sameRoot.length > 0) {
    return baseResult({ status: 'reject', reason_code: 'orphan_blocked', classification: 'orphan_blocked',
      reason: 'matching-run stage/branch/base missing or mismatch vs requested bindings; orphan_blocked',
      root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
      next_action: identity.next_action, rehydrated: identity, attached_run_id: sameRoot[0].run_id,});}
  if (matches.length === 0 && requireIdentity && input.strictMatch === true) { return baseResult({
      status: 'not_found', action: 'not_found', reason_code: 'not_found',
      reason: `no active or terminal run matches root_run_id=${effectiveRoot}`, root_run_id: effectiveRoot,
      phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
      next_action: identity.next_action, rehydrated: identity, authority: resolved.authority,});}
  const badId = matches.find((r) => r.incomplete_identity);
  if (badId) { return baseResult({ status: 'reject', reason_code: 'orphan_blocked', classification: 'orphan_blocked',
      reason: 'matching run process identity incomplete (need pid+start+PGID/SID); orphan_blocked',
      root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
      next_action: identity.next_action, rehydrated: identity, attached_run_id: badId.run_id,});}
  const activeMatches = matches.filter((run) => run.active);
  if (activeMatches.length > 1) { const ids = new Set(activeMatches.map((run) => run.run_id));
    if (ids.size > 1) { return baseResult({
        status: 'reject', reason_code: 'ambiguous_tracker', reason: 'multiple active matching runs for the same continuation identity',
        root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor,
        accepted_commit: identity.accepted_commit, next_action: identity.next_action, rehydrated: identity, authority: resolved.authority,});}}
  const active = activeMatches[0];
  if (active) { // classifyWorkOrder bar: strict live identity + owned lease + live ledger
    const lp = active.lease_path || (active.work_order_path ? workOrder.leasePathFor(active.work_order_path) : null);
    const lease = lp ? workOrder.readJsonIfPresent(lp) : null;
    const owned = Boolean(lease && workOrder.isCompleteIdentity(lease) && workOrder.isProcessLive(lease)
      && ['pid', 'process_start_time', 'pgid', 'sid'].every((k) => Number(lease[k]) === Number(active.owner[k])));
    let led = false;
    if (isStr(active.ledger_path)) { try { led = Date.now() - fs.statSync(active.ledger_path).mtimeMs < 15 * 60 * 1000; } catch (_e) { /* */ }}
    if (!owned || !led) { return baseResult({ status: 'reject', reason_code: owned ? 'ledger_not_live' : 'lock_not_owned',
        classification: 'orphan_blocked', reason: 'attach_active requires owned lease+live ledger; matching-run process alone fails closed',
        root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
        next_action: identity.next_action, rehydrated: identity, attached_run_id: active.run_id,});}
    return attachResult({ reason: 'active matching run with strict identity+owned lease+ledger; attach',
      root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit, next_action: identity.next_action,
      attached_run_id: active.run_id, matching_run: active, rehydrated: identity,
      authority: resolved.authority, narrative_ignored: resolved.narrative_ignored === true,});}
  const terminal = matches.find((run) => run.terminal);
  if (terminal) {
    // Normalize matching-run expected_receipt and validate exact path+digest (no self-derive).
    const er = isObj(terminal.expected_receipt) ? terminal.expected_receipt
      : (isObj(input.expectedReceipt) ? input.expectedReceipt : null);
    if (!isObj(er) || !isStr(er.path) || !isStr(er.digest)) {
      return baseResult({ status: 'reject', reason_code: 'terminal_receipt_missing',
        reason: 'terminal matching run requires expected_receipt.path+digest', root_run_id: effectiveRoot, attached_run_id: terminal.run_id,});}
    let receipt = input.terminalReceipt || terminal.terminal_receipt || null;
    if (!receipt) { const loaded = workOrder.readJsonStrict(er.path);
      if (!loaded.ok || !loaded.value) { return baseResult({ status: 'reject', reason_code: 'terminal_receipt_missing',
          reason: (loaded && loaded.reason) || 'terminal receipt missing', root_run_id: effectiveRoot, attached_run_id: terminal.run_id,});}
      receipt = loaded.value;}
    const validated = workOrder.validateTerminalReceipt(receipt, {
      work_order_id: terminal.run_id, root_run_id: effectiveRoot, terminal_status: terminal.final_status, expected_receipt: er,},
    { receiptPath: er.path });
    if (!validated.ok) { return baseResult({ status: 'reject', reason_code: validated.reason_code, reason: validated.reason,
        root_run_id: effectiveRoot, attached_run_id: terminal.run_id,});}
    if (validated.success === false) { return consumeFailure({ reason: `terminal status=${validated.terminal_status}; refuse masked resume`,
        root_run_id: effectiveRoot, attached_run_id: terminal.run_id, terminal_status: validated.terminal_status,});}
    return consumeSuccess({ reason: 'consume validated terminal receipt for matching run', root_run_id: effectiveRoot,
      phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
      next_action: identity.next_action, attached_run_id: terminal.run_id, matching_run: terminal,
      terminal_status: validated.terminal_status, rehydrated: identity, authority: resolved.authority,
      narrative_ignored: resolved.narrative_ignored === true,});}
  if (isStr(commonDir) && isStr(effectiveRoot)&& input.claimWorkOrder !== false&& (hasDurableOrCheckpoint || input.createWorkOrder === true
        || input.missionActive === true || reconcileGate.required === true)) { const claimOwner = isObj(input.owner)? input.owner
      : (input.ownerPid || input.controllerPid? workOrder.captureProcessIdentity(Number(input.ownerPid || input.controllerPid))
        : workOrder.captureProcessIdentity(process.pid));
    const claim = workOrder.claimDispatchCas(commonDir, { root_run_id: effectiveRoot, graph_node: input.graph_node || identity.stage || 'default',
      attempt: input.attempt || 1, role: input.role || 'implementer', branch: matchIdentity.branch,
      base_sha: matchIdentity.base_sha, worktree: input.worktree || null, paths: { manifest: input.manifestPath || null, ledger: input.ledgerPath || null,
        receipt: input.receiptPath || null, mission: input.missionPath || null, durable: input.durablePath || null, checkpoint: input.checkpointPath || null,},
      phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
      next_action: identity.next_action || 'dispatch', artifact_digests: input.artifactDigests || {},}, {
      owner: claimOwner, pid: claimOwner.pid, reconcileReceipt: reconcileGate.receipt || input.reconcileReceipt || null,
      reconcileReceiptPath: input.reconcileReceiptPath, expectedGeneration: input.expectedGeneration,
      expectedCasToken: input.expectedCasToken, gitCwd: input.gitCwd || null,
      bindArtifacts: Boolean(input.durablePath || input.missionPath || identity.accepted_commit),});
    if (claim.status === 'reject') { return baseResult({ status: 'reject', reason_code: claim.reason_code, reason: claim.reason, root_run_id: effectiveRoot,
        phase_cursor: identity.phase_cursor, accepted_commit: identity.accepted_commit,
        next_action: identity.next_action, rehydrated: identity, authority: resolved.authority,});}
    if (claim.status === 'attach' || claim.status === 'consume') { return { status: claim.status === 'attach' ? 'attach' : 'consume', action: claim.action,
        reason_code: claim.reason_code, reason: claim.reason, duplicate_dispatch: 0, root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor,
        accepted_commit: identity.accepted_commit, next_action: identity.next_action, attached_run_id: claim.work_order_id, classification: claim.action,
        terminal_status: claim.terminal_status || null, rehydrated: identity, authority: 'work_order',
        narrative_ignored: resolved.narrative_ignored === true, work_order: claim.work_order || null,};}
    return { status: 'admit', action: 'dispatch_new', reason_code: null,
      reason: 'CAS claimed durable work order; admit new dispatch once', duplicate_dispatch: 0, root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor,
      accepted_commit: identity.accepted_commit, next_action: identity.next_action, attached_run_id: null, rehydrated: identity, authority: resolved.authority,
      narrative_ignored: resolved.narrative_ignored === true, work_order: claim.work_order || null, work_order_path: claim.path || null,};}
  if (hasDurableOrCheckpoint) { return { status: 'admit', action: 'dispatch_new', reason_code: null,
      reason: 'rehydrated continuation identity with no matching run; admit new dispatch once',
      duplicate_dispatch: 0, root_run_id: effectiveRoot, phase_cursor: identity.phase_cursor,
      accepted_commit: identity.accepted_commit, next_action: identity.next_action, attached_run_id: null,
      rehydrated: identity, authority: resolved.authority, narrative_ignored: resolved.narrative_ignored === true,};}
  if (!isStr(effectiveRoot) && requireIdentity) { return baseResult({ status: 'not_found', action: 'not_found', reason_code: 'not_found',
      reason: 'continuation identity root_run_id is absent', rehydrated: null, authority: resolved.authority,});}
  return { status: 'admit', action: 'dispatch_new', reason_code: null,
    reason: 'no continuation checkpoint or matching run; admit new dispatch', duplicate_dispatch: 0,
    root_run_id: effectiveRoot, phase_cursor: null, accepted_commit: null, next_action: null,
    attached_run_id: null, rehydrated: null, authority: resolved.authority, narrative_ignored: false,};}
function loadMatchingRunsFromManifestDir(manifestDir, identity = {}) { if (!isStr(manifestDir) || !fs.existsSync(manifestDir)) return [];
  let names;
  try { names = fs.readdirSync(manifestDir); } catch (_e) { return []; }
  const runs = [];
  for (const name of names) { if (!name.endsWith('.manifest.json')) continue;
    try { const parsed = JSON.parse(fs.readFileSync(path.join(manifestDir, name), 'utf8'));
      const normalized = normalizeRunRecord(parsed);
      if (!normalized) continue;
      if (identity && isStr(identity.root_run_id)&& !runMatchesIdentity(normalized, identity)) continue;
      runs.push(normalized);} catch (_e) { /* skip corrupt */ }}
  return runs;}
module.exports = { ARTIFACT_TYPE, DURABLE_ARTIFACT_TYPE, SCHEMA_VERSION, TERMINAL_CAMPAIGN_PHASES, admitContinuation, authenticateCheckpointEvidence, buildCheckpoint, checkAcceptedCommit, checkpointDigest, checkpointMissingFields, isCompleteCheckpoint, loadCheckpointFile, loadMatchingRunsFromManifestDir, normalizeRunRecord, observeGitCommit, rehydrateCheckpoint, requireReconcileReceipt, resolveAuthoritativeIdentity, runMatchesIdentity, workOrder };
