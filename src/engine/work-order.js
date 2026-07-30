'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const WORK_ORDER_SCHEMA = 2;
const WORK_ORDER_ARTIFACT = 'work_order';
const RECONCILE_ARTIFACT = 'postcompact_reconcile_receipt';
const RECONCILE_SCHEMA = 1;
const TERMINAL_RECEIPT_ARTIFACT = 'l6_engine_result_receipt';
const RECEIPT_DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLASSIFICATIONS = Object.freeze([ 'attach_active', 'consume_terminal', 'orphan_blocked', 'stale_dispositioned',]);
const TERMINAL_STATUSES = new Set([ 'success', 'failed', 'aborted', 'blocked', 'boundary_rejected',
  'terminal_ready', 'terminal_follow_up', 'terminal_stop', 'merged', 'dead', 'quarantined', 'stale_ignored',]);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const nowIso = (d = new Date()) => d.toISOString();
const sha256Text = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const sha256Json = (v) => sha256Text(JSON.stringify(v));
function sha256File(p) { if (!isStr(p) || !fs.existsSync(p)) return null;
  return sha256Text(fs.readFileSync(p));}
const safeId = (s) => String(s).replace(/[^A-Za-z0-9._:-]/g, '_');
function resolveGitCommonDir(cwd) { if (!isStr(cwd)) return null;
  try { const out = execFileSync( 'git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },).trim();
    return out ? fs.realpathSync(out) : null;} catch (_e) { return null; }}
const workOrdersRoot = (cd) => path.join(cd, 'autopilot', 'work-orders');
function workOrderPath(cd, rootRunId, graphNode, attempt) { const att = Number.isInteger(attempt) ? attempt : 1;
  return path.join(workOrdersRoot(cd), safeId(rootRunId), `${safeId(graphNode || 'default')}-a${att}.json`);}
function reconcileReceiptPath(cd, rootRunId) { return path.join(workOrdersRoot(cd), safeId(rootRunId), 'reconcile-receipt.json');}
function readProcessStartTime(pid) { if (!Number.isInteger(pid) || pid <= 0) return null;
  try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const startTicks = Number(fields[19]);
    const btime = Number((fs.readFileSync('/proc/stat', 'utf8').split('\n').find((l) => l.startsWith('btime ')) || '').split(/\s+/)[1]);
    const ticks = Number(String(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout || '').trim());
    if (Number.isFinite(startTicks) && Number.isFinite(btime) && Number.isFinite(ticks) && ticks > 0) return Math.floor(btime + (startTicks / ticks));
  } catch (_e) {  }
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],});
  if (r.error || r.status !== 0) return null;
  const parsed = Date.parse(String(r.stdout || '').trim());
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;}
// /proc stat after ')': state ppid pgrp session; state Z = zombie (not live).
function readPgidSid(pid) { if (!Number.isInteger(pid) || pid <= 0) return { pgid: null, sid: null, state: null };
  try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const pgid = Number(fields[2]); const sid = Number(fields[3]);
    return { pgid: Number.isInteger(pgid) ? pgid : null, sid: Number.isInteger(sid) ? sid : null, state: fields[0] || null,};
  } catch (_e) {
    const pg = Number(String(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).stdout || '').trim());
    const sd = Number(String(spawnSync('ps', ['-o', 'sid=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).stdout || '').trim());
    return { pgid: Number.isInteger(pg) ? pg : null, sid: Number.isInteger(sd) ? sd : null, state: null,};}}
function captureProcessIdentity(pid = process.pid) { const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return { pid: null, process_start_time: null, pgid: null, sid: null };
  const { pgid, sid } = readPgidSid(n);
  return { pid: n, process_start_time: readProcessStartTime(n), pgid, sid };}
function isProcessLive(identity) { if (!identity || !Number.isInteger(identity.pid) || identity.pid <= 0) return false;
  try { process.kill(identity.pid, 0); } catch (e) { if (e.code !== 'EPERM') return false;}
  const live = readPgidSid(identity.pid);
  if (live.state === 'Z') return false; // zombie /proc is not attachable
  if (identity.process_start_time != null && Number(identity.process_start_time) > 0) {
    const observed = readProcessStartTime(identity.pid);
    if (observed != null && Number(observed) !== Number(identity.process_start_time)) return false;}
  if (identity.pgid != null && live.pgid != null && Number(identity.pgid) !== Number(live.pgid)) return false;
  if (identity.sid != null && live.sid != null && Number(identity.sid) !== Number(live.sid)) return false;
  return true;}
function writeAtomicJson(filePath, value) { const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, resolved);
  return resolved;}
function readJsonIfPresent(filePath) { if (!isStr(filePath) || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_e) { return null; }}
function readJsonStrict(filePath) { if (!isStr(filePath) || !fs.existsSync(filePath)) return { ok: true, value: null, path: filePath };
  try { return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')), path: filePath };} catch (error) { return {
      ok: false, path: filePath, reason_code: 'work_order_unreadable', reason: `unreadable JSON: ${error.message || String(error)}`,};}}
const lockPathFor = (f) => `${f}.lock`;
const leasePathFor = (f) => `${f}.lease`;
const rootCasLockPath = (cd, r) => path.join(workOrdersRoot(cd), safeId(r), '.root-cas.lock');
function writeOwnedLease(workOrderFile, identity) { if (!isStr(workOrderFile) || !identity || !Number.isInteger(identity.pid)) return null;
  const payload = { schema_version: 1, pid: identity.pid, process_start_time: identity.process_start_time,
    pgid: identity.pgid, sid: identity.sid, nonce: crypto.randomBytes(12).toString('hex'), created_at: nowIso(),};
  writeAtomicJson(leasePathFor(workOrderFile), payload);
  return payload;}
function releaseOwnedLease(workOrderFile) { try { fs.unlinkSync(leasePathFor(workOrderFile)); } catch (_e) {  }}
function withWorkOrderLock(file, fn, timeoutMs = 2000) { const owner = captureProcessIdentity(process.pid);
  const lock = acquireWorkOrderLock(file, owner, timeoutMs);
  if (!lock.ok) return { ok: false, ...lock };
  try { return { ok: true, value: fn() }; } finally { releaseWorkOrderLock(file, lock.lock); }}
function acquireWorkOrderLock(workOrderFile, ownerIdentity, timeoutMs = 2000) { const lockFile = lockPathFor(workOrderFile);
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const started = Date.now();
  const payload = { schema_version: 1, pid: ownerIdentity.pid, process_start_time: ownerIdentity.process_start_time,
    pgid: ownerIdentity.pgid, sid: ownerIdentity.sid, nonce: crypto.randomBytes(16).toString('hex'), created_at: nowIso(),};
  while (Date.now() - started < timeoutMs) { try { const fd = fs.openSync(lockFile, 'wx');
      try { fs.writeFileSync(fd, `${JSON.stringify(payload)}\n`); } finally { fs.closeSync(fd); }
      return { ok: true, lock: payload, path: lockFile };} catch (error) {
      if (error.code !== 'EEXIST') return { ok: false, reason_code: 'lock_error', reason: error.message };
      const existing = readJsonIfPresent(lockFile);
      if (existing && !isProcessLive(existing)) { try { fs.unlinkSync(lockFile); } catch (_e) {  }
        continue;}
      spawnSync('sleep', ['0.02'], { stdio: 'ignore' });}}
  return { ok: false, reason_code: 'lock_busy', reason: 'work order lock busy' };}
function releaseWorkOrderLock(workOrderFile, lock) { const lockFile = lockPathFor(workOrderFile);
  const existing = readJsonIfPresent(lockFile);
  if (!existing) return;
  if (lock && existing.nonce && lock.nonce && existing.nonce !== lock.nonce) return;
  try { fs.unlinkSync(lockFile); } catch (_e) {  }}
function workOrderMissingFields(wo) { if (!isObj(wo)) return ['work_order'];
  const m = [];
  if (wo.schema_version !== WORK_ORDER_SCHEMA) m.push('schema_version');
  if (wo.artifact_type !== WORK_ORDER_ARTIFACT) m.push('artifact_type');
  if (!isStr(wo.work_order_id)) m.push('work_order_id');
  if (!isStr(wo.root_run_id)) m.push('root_run_id');
  if (!isStr(wo.graph_node)) m.push('graph_node');
  if (!Number.isInteger(wo.attempt) || wo.attempt < 1) m.push('attempt');
  if (!isStr(wo.role)) m.push('role');
  if (!isObj(wo.owner) || !Number.isInteger(wo.owner.pid)) m.push('owner');
  if (!isObj(wo.paths)) m.push('paths');
  if (!isStr(wo.next_action)) m.push('next_action');
  if (!isStr(wo.heartbeat_at)) m.push('heartbeat_at');
  if (!Number.isInteger(wo.generation) || wo.generation < 1) m.push('generation');
  return m;}
function computeArtifactDigests(paths = {}, fields = {}) { const d = {};
  if (isStr(paths.mission)) d.mission = sha256File(paths.mission);
  else if (isStr(fields.mission_digest)) d.mission = fields.mission_digest;
  if (isStr(paths.ledger)) d.ledger = sha256File(paths.ledger);
  else if (isStr(fields.ledger_digest)) d.ledger = fields.ledger_digest;
  if (isStr(paths.durable)) d.durable = sha256File(paths.durable);
  if (isStr(paths.checkpoint)) d.checkpoint = sha256File(paths.checkpoint);
  if (isStr(fields.accepted_commit) && fields.accepted_commit !== 'none') { d.accepted_commit = fields.accepted_commit;}
  return d;}
function workOrderCanonicalBody(wo) { return { schema_version: wo.schema_version, artifact_type: wo.artifact_type, work_order_id: wo.work_order_id,
    root_run_id: wo.root_run_id, graph_node: wo.graph_node, attempt: wo.attempt, role: wo.role,
    generation: wo.generation, owner: wo.owner, runner: wo.runner, branch: wo.branch, base_sha: wo.base_sha, worktree: wo.worktree, paths: wo.paths,
    artifact_digests: wo.artifact_digests || {}, phase_cursor: wo.phase_cursor, campaign_phase: wo.campaign_phase ?? null,
    accepted_commit: wo.accepted_commit, next_action: wo.next_action, terminal_status: wo.terminal_status,
    disposition: wo.disposition, expected_receipt: wo.expected_receipt, cas_token: wo.cas_token,};}
const workOrderDigest = (wo) => sha256Json(workOrderCanonicalBody(wo));
function buildWorkOrder(fields = {}, options = {}) { const owner = isObj(fields.owner)? fields.owner: captureProcessIdentity(fields.owner_pid || process.pid);
  const now = nowIso();
  const attempt = Number.isInteger(fields.attempt) ? fields.attempt : 1;
  const graphNode = fields.graph_node || fields.graphNode || 'default';
  const rootRunId = fields.root_run_id || fields.rootRunId;
  const emptyRunner = { pid: null, process_start_time: null, pgid: null, sid: null };
  const wo = { schema_version: WORK_ORDER_SCHEMA, artifact_type: WORK_ORDER_ARTIFACT,
    work_order_id: fields.work_order_id || `wo-${rootRunId}-${graphNode}-a${attempt}`, root_run_id: rootRunId, graph_node: graphNode, attempt,
    role: fields.role || 'implementer', generation: Number.isInteger(fields.generation) ? fields.generation : 1,
    owner: { pid: owner.pid, process_start_time: owner.process_start_time, pgid: owner.pgid, sid: owner.sid, kind: owner.kind || 'controller',},
    runner: isObj(fields.runner) ? { pid: fields.runner.pid ?? null, process_start_time: fields.runner.process_start_time ?? null,
      pgid: fields.runner.pgid ?? null, sid: fields.runner.sid ?? null,} : emptyRunner,
    branch: fields.branch || null, base_sha: fields.base_sha || fields.baseSha || null,
    worktree: fields.worktree || null, paths: { manifest: fields.paths?.manifest || fields.manifest_path || null,
      ledger: fields.paths?.ledger || fields.ledger_path || null, receipt: fields.paths?.receipt || fields.receipt_path || null,
      mission: fields.paths?.mission || fields.mission_path || null, checkpoint: fields.paths?.checkpoint || fields.checkpoint_path || null,
      durable: fields.paths?.durable || fields.durable_path || null,}, artifact_digests: isObj(fields.artifact_digests) ? { ...fields.artifact_digests } : {},
    phase_cursor: fields.phase_cursor || null, campaign_phase: fields.campaign_phase ?? null,
    accepted_commit: fields.accepted_commit || null,
    next_action: fields.next_action, heartbeat_at: fields.heartbeat_at || now,
    created_at: fields.created_at || now, updated_at: now, terminal_status: fields.terminal_status ?? null,
    disposition: fields.disposition ?? null, expected_receipt: isObj(fields.expected_receipt) ? fields.expected_receipt : null,
    cas_token: fields.cas_token || crypto.randomBytes(16).toString('hex'),};
  if (options.bindArtifacts === true) { wo.artifact_digests = { ...wo.artifact_digests, ...computeArtifactDigests(wo.paths, fields) };}
  if (isObj(wo.expected_receipt) && isStr(wo.expected_receipt.path) && !isStr(wo.expected_receipt.digest)&& fs.existsSync(wo.expected_receipt.path)) {
    const loaded = readJsonStrict(wo.expected_receipt.path);
    if (loaded.ok && isObj(loaded.value)) { const body = { ...loaded.value }; delete body.digest;
      wo.expected_receipt = { ...wo.expected_receipt, digest: sha256Json(body) };}}
  const missing = workOrderMissingFields(wo);
  if (missing.length > 0) { const err = new Error(`incomplete work order: missing ${missing.join(',')}`);
    err.code = 'incomplete_work_order'; err.missing = missing; throw err;}
  wo.digest = workOrderDigest(wo);
  if (fields.disposition_receipt != null) wo.disposition_receipt = fields.disposition_receipt;
  return wo;}
function validateBoundArtifacts(wo, options = {}) { if (!isObj(wo)) return { ok: false, reason_code: 'incomplete_work_order', reason: 'work order missing' };
  const digests = wo.artifact_digests || {};
  const paths = wo.paths || {};
  if (options.requireBoundEvidence !== false) { const has = ( (isStr(digests.mission) && isStr(paths.mission))|| (isStr(digests.ledger) && isStr(paths.ledger))
      || (isStr(digests.durable) && isStr(paths.durable))|| (isStr(wo.accepted_commit) && wo.accepted_commit !== 'none'));
    if (!has) { return { ok: false, reason_code: 'unauthenticated_evidence',
        reason: 'checkpoint/digest is not bound to Mission, ledger, durable tracker, or Git',};}}
  for (const key of ['mission', 'ledger', 'durable', 'checkpoint']) { if (isStr(paths[key]) && isStr(digests[key]) && sha256File(paths[key]) !== digests[key]) {
      return { ok: false, reason_code: 'artifact_digest_mismatch', reason: `${key} artifact digest mismatch`, };}}
  if (options.gitCwd && isStr(wo.accepted_commit) && wo.accepted_commit !== 'none') { try { execFileSync(
        'git', ['-C', options.gitCwd, 'rev-parse', '--verify', `${wo.accepted_commit}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },);
    } catch (_e) { return { ok: false, reason_code: 'accepted_commit_drift', reason: `accepted_commit ${wo.accepted_commit} not present in git`, };}}
  return { ok: true };}
function isTerminalWorkOrder(wo) { if (!wo) return false;
  if (isStr(wo.disposition)&& ['consumed', 'stale_dispositioned', 'attached'].includes(wo.disposition)&& isStr(wo.terminal_status)) { return true;}
  return isStr(wo.terminal_status) && TERMINAL_STATUSES.has(wo.terminal_status);}
function isNonterminalWorkOrder(wo) { if (!wo) return false;
  if (workOrderMissingFields(wo).length > 0) return true;
  if (isStr(wo.disposition) && ['consumed', 'stale_dispositioned'].includes(wo.disposition)) return false;
  if (isTerminalWorkOrder(wo) && wo.disposition === 'consumed') return false;
  return !isTerminalWorkOrder(wo) || !isStr(wo.disposition);}
function ledgerLooksLive(ledgerPath) { if (!isStr(ledgerPath) || !fs.existsSync(ledgerPath)) return null;
  try { return Date.now() - fs.statSync(ledgerPath).mtimeMs < 15 * 60 * 1000; } catch (_e) { return null; }}
function isCompleteIdentity(id) { return Boolean( id && Number.isInteger(id.pid) && id.pid > 0
    && id.process_start_time != null && Number(id.process_start_time) > 0&& id.pgid != null && Number.isInteger(Number(id.pgid))
    && id.sid != null && Number.isInteger(Number(id.sid)),);}
function isProcessLiveStrict(id) { return isCompleteIdentity(id) && isProcessLive(id); }
function lockOwnedBy(lock, identity) {
  if (!lock || !isCompleteIdentity(identity) || !isCompleteIdentity(lock)) return false;
  if (!isProcessLive(lock)) return false;
  return Number(lock.pid) === Number(identity.pid)
    && Number(lock.process_start_time) === Number(identity.process_start_time)
    && Number(lock.pgid) === Number(identity.pgid)
    && Number(lock.sid) === Number(identity.sid);}
function assessWorktreeClean(wo, options = {}) { const wt = isStr(wo.worktree) ? wo.worktree : (options.worktree || null);
  if (!isStr(wt)) return { clean: null, reason_code: 'worktree_unknown' };
  if (!fs.existsSync(wt)) return { clean: null, reason_code: 'worktree_unknown' };
  try { const porcelain = execFileSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],}).trim();
    if (porcelain.length > 0) return { clean: false, reason_code: 'worktree_dirty' };
    return { clean: true, reason_code: null };} catch (_e) { return { clean: null, reason_code: 'worktree_unknown' };}}
function assessUniqueCommittedMutation(wo, options = {}) {
  const wt = isStr(wo.worktree) ? wo.worktree : (options.worktree || options.gitCwd || null);
  if (!isStr(wt) || !fs.existsSync(wt)) return { unique: null, reason_code: 'worktree_unknown' };
  const base = isStr(wo.base_sha) ? wo.base_sha : (isStr(options.base_sha) ? options.base_sha : null);
  if (!isStr(base)) return { unique: null, reason_code: 'base_unknown' };
  try {
    const head = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const baseFull = execFileSync('git', ['-C', wt, 'rev-parse', `${base}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (head.toLowerCase() === baseFull.toLowerCase()) return { unique: false, reason_code: null, head, base: baseFull };
    const headTree = execFileSync('git', ['-C', wt, 'rev-parse', `${head}^{tree}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const baseTree = execFileSync('git', ['-C', wt, 'rev-parse', `${baseFull}^{tree}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (headTree === baseTree) return { unique: false, reason_code: null, head, base: baseFull, equivalent: true };
    try {
      execFileSync('git', ['-C', wt, 'merge-base', '--is-ancestor', baseFull, head], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { unique: true, reason_code: 'head_ahead', head, base: baseFull };
    } catch (_e) {
      return { unique: true, reason_code: 'head_ahead', head, base: baseFull, diverged: true };
    }
  } catch (_e) { return { unique: null, reason_code: 'worktree_unknown' }; }}
function validateTerminalReceipt(receipt, wo, options = {}) {
  if (!isObj(receipt)) return { ok: false, reason_code: 'terminal_receipt_missing', reason: 'receipt missing' };
  if (!isObj(wo)) return { ok: false, reason_code: 'terminal_receipt_invalid', reason: 'work order required' };
  if (receipt.schema_version !== 1) { return { ok: false, reason_code: 'terminal_receipt_invalid', reason: 'exact schema_version=1 required' };}
  const expected = wo.expected_receipt;
  const expectedArtifact = TERMINAL_RECEIPT_ARTIFACT;
  if (!isStr(receipt.artifact_type) || receipt.artifact_type !== expectedArtifact) {
    return { ok: false, reason_code: 'terminal_receipt_invalid',
      reason: `exact artifact_type=${expectedArtifact} required (got ${receipt.artifact_type || 'missing'})`, };}
  if (!isStr(receipt.terminal_status)) {
    return { ok: false, reason_code: 'terminal_receipt_invalid', reason: 'exact terminal_status required (status alias rejected)' };}
  if (!isStr(receipt.root_run_id) || receipt.root_run_id !== wo.root_run_id) {
    return { ok: false, reason_code: 'terminal_receipt_mismatch', reason: 'receipt root_run_id missing or mismatch' };}
  if (!isStr(receipt.work_order_id) || receipt.work_order_id !== wo.work_order_id) {
    return { ok: false, reason_code: 'terminal_receipt_mismatch', reason: 'receipt work_order_id missing or mismatch' };}
  if (isStr(wo.terminal_status) && receipt.terminal_status !== wo.terminal_status) {
    return { ok: false, reason_code: 'terminal_receipt_mismatch', reason: `receipt terminal_status ${receipt.terminal_status} != work order ${wo.terminal_status}` };
  }
  if (!isObj(expected) || !isStr(expected.digest) || !isStr(expected.path)) {
    return { ok: false, reason_code: 'terminal_receipt_invalid', reason: 'expected_receipt.path+digest required (no self-derive)' };}
  const receiptPath = options.receiptPath || expected.path;
  if (!isStr(receiptPath) || path.resolve(receiptPath) !== path.resolve(expected.path)) {
    return { ok: false, reason_code: 'terminal_receipt_mismatch', reason: 'terminal receipt path binding mismatch' };}
  const body = { ...receipt }; delete body.digest;
  const computed = sha256Json(body);
  if (computed !== expected.digest) { return { ok: false, reason_code: 'terminal_receipt_digest_mismatch', reason: 'terminal receipt digest mismatch' };}
  if (!isStr(receipt.digest) || receipt.digest !== computed) {
    return { ok: false, reason_code: 'terminal_receipt_digest_mismatch', reason: 'terminal receipt digest missing or tampered' };}
  const status = receipt.terminal_status;
  const success = status === 'success' || status === 'merged' || status === 'terminal_ready';
  return { ok: true, success, terminal_status: status, digest: computed };}
function classifyWorkOrder(wo, options = {}) { if (options.parseError) { return {
      classification: 'orphan_blocked', reason_code: options.parseError.reason_code || 'work_order_unreadable',
      reason: options.parseError.reason || 'work order unreadable', work_order_id: null,};}
  if (!isObj(wo) || workOrderMissingFields(wo).length > 0) { return { classification: 'orphan_blocked', reason_code: 'incomplete_work_order',
      reason: 'work order incomplete or unreadable', work_order_id: wo && wo.work_order_id || null,};}
  if (!isStr(wo.digest) || wo.digest !== workOrderDigest(wo)) { return { classification: 'orphan_blocked', reason_code: 'work_order_digest_mismatch',
      reason: isStr(wo.digest) ? 'work order digest mismatch (tampered)' : 'work order digest missing', work_order_id: wo.work_order_id,};}
  if (wo.disposition === 'stale_dispositioned') { return { classification: 'stale_dispositioned', reason_code: null, idempotent: true,
      reason: 'work order already stale_dispositioned', work_order_id: wo.work_order_id, disposition_receipt: wo.disposition_receipt || null,};}
  const bind = validateBoundArtifacts(wo, options);
  if (!bind.ok && options.skipBindCheck !== true) {
    return { classification: 'orphan_blocked', reason_code: bind.reason_code, reason: bind.reason, work_order_id: wo.work_order_id, };}
  if (wo.disposition === 'consumed' || isTerminalWorkOrder(wo) || isStr(wo.terminal_status)) {
    const receiptPath = isObj(wo.expected_receipt) && isStr(wo.expected_receipt.path)
      ? wo.expected_receipt.path : null;
    let receipt = options.terminalReceipt || null;
    if (!receipt && receiptPath) { const loaded = readJsonStrict(receiptPath);
      if (!loaded.ok) { return { classification: 'orphan_blocked', reason_code: 'terminal_receipt_missing',
          reason: loaded.reason, work_order_id: wo.work_order_id, terminal_status: wo.terminal_status,};}
      receipt = loaded.value;}
    if (!receipt || !receiptPath) { return { classification: 'orphan_blocked', reason_code: 'terminal_receipt_missing',
        reason: 'consumed/terminal work order requires expected_receipt.path and a validated terminal receipt',
        work_order_id: wo.work_order_id, terminal_status: wo.terminal_status,};}
    const validated = validateTerminalReceipt(receipt, wo, { receiptPath });
    if (!validated.ok) { return { classification: 'orphan_blocked', reason_code: validated.reason_code, reason: validated.reason,
        work_order_id: wo.work_order_id, terminal_status: wo.terminal_status,};}
    return { classification: 'consume_terminal', reason_code: null,
      idempotent: wo.disposition === 'consumed',
      reason: `consume terminal status=${validated.terminal_status}`,
      work_order_id: wo.work_order_id, terminal_status: validated.terminal_status,
      terminal_receipt: receipt, success: validated.success === true,};}
  const ownerLive = isProcessLiveStrict(wo.owner);
  const runnerLive = wo.runner ? isProcessLiveStrict(wo.runner) : false;
  const lockFile = options.workOrderPath ? lockPathFor(options.workOrderPath) : null;
  const leaseFile = options.workOrderPath ? leasePathFor(options.workOrderPath) : null;
  const lock = lockFile ? readJsonIfPresent(lockFile) : null;
  const lease = leaseFile ? readJsonIfPresent(leaseFile) : null;
  const lockLive = Boolean(lock && isProcessLive(lock));
  const ownedLock = (ownerLive && (lockOwnedBy(lock, wo.owner) || lockOwnedBy(lease, wo.owner)))
    || (runnerLive && (lockOwnedBy(lock, wo.runner) || lockOwnedBy(lease, wo.runner)));
  const ledgerLive = ledgerLooksLive(wo.paths?.ledger);
  if (lockLive && !ownerLive && !runnerLive) { return { classification: 'orphan_blocked', reason_code: 'lock_without_process',
      reason: 'mutation lock alone cannot attach_active without live owner/runner identity', work_order_id: wo.work_order_id,};}
  if (ownerLive || runnerLive) { if (ledgerLive !== true) { return { classification: 'orphan_blocked', reason_code: 'ledger_not_live',
        reason: 'attach_active requires declared ledger freshness; missing/stale ledger cannot attach', work_order_id: wo.work_order_id,};}
    if (!ownedLock) { return { classification: 'orphan_blocked', reason_code: 'lock_not_owned',
        reason: 'attach_active requires durable owned lock/lease; live identity+ledger without lock orphan_blocks', work_order_id: wo.work_order_id,};}
    return { classification: 'attach_active', reason_code: null,
      reason: 'live PID/start/PGID/SID + owned lease/lock + fresh ledger', work_order_id: wo.work_order_id,
      owner_live: ownerLive, runner_live: runnerLive, lock_live: lockLive, ledger_live: true,};}
  const wt = assessWorktreeClean(wo, options);
  if (wt.clean !== true) {
    return { classification: 'orphan_blocked',
      reason_code: wt.clean === false ? 'worktree_dirty' : (wt.reason_code || 'stale_active_ambiguous'),
      reason: wt.clean === false ? 'dead owner with dirty worktree; refuse auto stale_disposition'
        : 'dead owner with unknown/missing worktree or no clean proof; orphan_blocked',
      work_order_id: wo.work_order_id,};}
  const mut = assessUniqueCommittedMutation(wo, options);
  if (mut.unique === true) {
    return { classification: 'orphan_blocked', reason_code: mut.reason_code || 'head_ahead',
      reason: 'dead owner with unique committed mutation (head-ahead/diverged); refuse auto stale_disposition',
      work_order_id: wo.work_order_id,};}
  if (mut.unique == null) {
    return { classification: 'orphan_blocked', reason_code: mut.reason_code || 'worktree_unknown',
      reason: 'dead owner cannot prove absence of unique committed mutation; orphan_blocked',
      work_order_id: wo.work_order_id,};}
  if (options.autoDispositionStale !== false) { return {
      classification: 'stale_dispositioned', reason_code: null,
      reason: 'owner/runner dead; worktree clean; no unique committed mutation; stale work order dispositioned',
      work_order_id: wo.work_order_id, owner_live: false, runner_live: false,};}
  return { classification: 'orphan_blocked', reason_code: 'stale_active_ambiguous',
    reason: 'dead owner; auto stale disposition disabled', work_order_id: wo.work_order_id,};}
function listWorkOrders(commonDir, rootRunId = null) {
  if (!isStr(commonDir)) return [];
  if (!isStr(rootRunId)) return [];
  const root = workOrdersRoot(commonDir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const roots = [path.join(root, safeId(rootRunId))];
  for (const dir of roots) { if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) { if (!name.endsWith('.json') || name === 'reconcile-receipt.json' || name.endsWith('.lock')) continue;
      if (name.startsWith('.') || name.endsWith('.lease')) continue;
      const file = path.join(dir, name);
      const parsed = readJsonStrict(file);
      if (!parsed.ok) { out.push({ path: file, work_order: null, error: parsed }); continue; }
      const wo = parsed.value;
      if (!isObj(wo)) { out.push({ path: file, work_order: null, error: { reason_code: 'work_order_unreadable', reason: 'not an object' } });
        continue;}
      if (wo.artifact_type !== WORK_ORDER_ARTIFACT) {
        out.push({ path: file, work_order: wo, error: { reason_code: 'work_order_artifact_type', reason: `artifact_type ${wo.artifact_type} is not work_order` } });
        continue;}
      if (wo.schema_version !== WORK_ORDER_SCHEMA) {
        out.push({ path: file, work_order: wo, error: { reason_code: 'incomplete_work_order', reason: 'work order schema_version is not v2' } });
        continue;}
      if (isStr(rootRunId) && wo.root_run_id !== rootRunId) {
        out.push({ path: file, work_order: wo, error: { reason_code: 'work_order_root_mismatch', reason: `safeId collision: wo.root_run_id=${wo.root_run_id} != ${rootRunId}` } });
        continue;}
      if (!isStr(wo.digest)) {
        out.push({ path: file, work_order: wo, error: { reason_code: 'work_order_digest_missing', reason: 'work order digest missing' } });
        continue;}
      if (wo.digest !== workOrderDigest(wo)) {
        out.push({ path: file, work_order: wo, error: { reason_code: 'work_order_digest_mismatch', reason: 'work order digest mismatch' } });
        continue;}
      out.push({ path: file, work_order: wo });}}
  return out;}
function listNonterminalWorkOrders(cd, root = null) { return listWorkOrders(cd, root).filter((e) => { if (e.error) return true;
    return isNonterminalWorkOrder(e.work_order);});}
function hasNonterminalWorkOrders(cd, rootRunId) { if (!isStr(cd) || !isStr(rootRunId)) return false;
  return listNonterminalWorkOrders(cd, rootRunId).length > 0;}
function resolveOwner(fields, options) { const ownerPid = options.pid|| (isObj(fields.owner) && fields.owner.pid)|| process.pid;
  if (isObj(fields.owner) && fields.owner.pid) { const pid = Number(fields.owner.pid);
    const ps = readPgidSid(pid);
    return { pid, process_start_time: fields.owner.process_start_time != null? fields.owner.process_start_time: readProcessStartTime(pid),
      pgid: fields.owner.pgid != null ? fields.owner.pgid : ps.pgid,
      sid: fields.owner.sid != null ? fields.owner.sid : ps.sid, kind: fields.owner.kind || 'controller',};}
  return captureProcessIdentity(ownerPid);}
function createOrUpdateWorkOrder(commonDir, fields, options = {}) { const owner = resolveOwner(fields, options);
  const attempt = Number.isInteger(fields.attempt) ? fields.attempt : 1;
  const graphNode = fields.graph_node || 'default';
  const file = workOrderPath(commonDir, fields.root_run_id, graphNode, attempt);
  const lockResult = acquireWorkOrderLock(file, owner, options.lockTimeoutMs || 2000);
  if (!lockResult.ok) return { status: 'reject', reason_code: lockResult.reason_code, reason: lockResult.reason };
  try { const existing = readJsonIfPresent(file);
    if (existing && options.expectedGeneration != null&& existing.generation !== options.expectedGeneration) { return {
        status: 'reject', reason_code: 'cas_conflict',
        reason: `work order generation ${existing.generation} != expected ${options.expectedGeneration}`, work_order: existing, path: file,};}
    if (existing && options.expectedCasToken&& existing.cas_token !== options.expectedCasToken) {
      return { status: 'reject', reason_code: 'cas_conflict', reason: 'work order cas_token mismatch', work_order: existing, path: file, };}
    const nextGen = existing? (existing.generation || 0) + (options.bumpGeneration === false ? 0 : 1): 1;
    const base = existing ? { ...existing, ...fields } : fields;
    const explicitOwner = isObj(fields.owner) && Number.isInteger(fields.owner.pid) ? fields.owner : null;
    const keepOwner = options.preserveOwner && existing && !options.transferOwner;
    const wo = buildWorkOrder({...base, generation: options.forceGeneration || nextGen,
      owner: keepOwner ? existing.owner : (explicitOwner || owner),
      created_at: existing?.created_at, cas_token: options.rotateCasToken? crypto.randomBytes(16).toString('hex'): (existing?.cas_token || fields.cas_token),
    }, { bindArtifacts: options.bindArtifacts !== false });
    if (options.updateLifecycle !== false) { wo.owner = { ...wo.owner, ...owner, kind: 'controller' };
      wo.heartbeat_at = nowIso(); wo.updated_at = wo.heartbeat_at; wo.digest = workOrderDigest(wo);}
    // Controller discipline state is schema-2 optional and outside the digest body.
    if (isObj(fields.controller)) wo.controller = fields.controller;
    else if (existing && isObj(existing.controller) && fields.controller === undefined) {
      wo.controller = existing.controller;
    }
    writeAtomicJson(file, wo);
    if (wo.disposition === 'consumed' || wo.disposition === 'stale_dispositioned') releaseOwnedLease(file);
    else { const leaseId = isCompleteIdentity(wo.runner) && isProcessLiveStrict(wo.runner) ? wo.runner
        : (isCompleteIdentity(wo.owner) ? wo.owner : owner);
      writeOwnedLease(file, leaseId);}
    return { status: 'written', path: file, work_order: wo, created: !existing };} finally { releaseWorkOrderLock(file, lockResult.lock);}}
function updateWorkOrderLifecycle(commonDir, ref, patch = {}, options = {}) { const file = ref.path || workOrderPath(
    commonDir, ref.root_run_id, ref.graph_node || 'default', ref.attempt || 1,);
  const current = readJsonIfPresent(file);
  if (!current) return { status: 'reject', reason_code: 'not_found', reason: `work order not found: ${file}` };
  const owner = captureProcessIdentity(options.pid || process.pid);
  const preserveOwner = options.preserveOwner === true;
  const fields = {...current,...patch, owner: preserveOwner? (patch.owner || current.owner): (patch.owner || {...current.owner,...owner,
        kind: patch.owner_kind || current.owner?.kind || 'controller',}),
    runner: patch.runner !== undefined ? patch.runner : current.runner, heartbeat_at: nowIso(), expected_receipt: patch.expected_receipt !== undefined
      ? patch.expected_receipt : current.expected_receipt, terminal_status: patch.terminal_status !== undefined
      ? patch.terminal_status : current.terminal_status, disposition: patch.disposition !== undefined? patch.disposition : current.disposition,};
  if (isObj(patch.paths)) fields.paths = { ...current.paths, ...patch.paths };
  const mutatesIdentity = patch.terminal_status !== undefined|| patch.disposition !== undefined|| patch.expected_receipt !== undefined
    || patch.runner !== undefined|| isObj(patch.paths)|| patch.branch !== undefined|| patch.worktree !== undefined;
  return createOrUpdateWorkOrder(commonDir, fields, {...options,
    expectedGeneration: options.expectedGeneration ?? current.generation, bumpGeneration: options.bumpGeneration != null? options.bumpGeneration
      : mutatesIdentity, bindArtifacts: options.bindArtifacts === true, preserveOwner,
    transferOwner: options.transferOwner === true, updateLifecycle: !preserveOwner || options.transferOwner === true,});}
function reconcileReceiptCanonical(receipt) { return { schema_version: receipt.schema_version, artifact_type: receipt.artifact_type,
    issued_at: receipt.issued_at, fresh_until: receipt.fresh_until, git_common_dir: receipt.git_common_dir,
    root_run_id: receipt.root_run_id, classifications: receipt.classifications, identity: receipt.identity, authority: receipt.authority,};}
const reconcileReceiptDigest = (r) => sha256Json(reconcileReceiptCanonical(r));
function mergeIdentityField(identity, src, keys) { if (!isObj(src)) return;
  for (const key of keys) { if (isStr(src[key])) identity[key] = src[key];}}
function reconcilePostCompact(input = {}) { const commonDir = input.commonDir || (input.gitCwd ? resolveGitCommonDir(input.gitCwd) : null);
  if (!isStr(commonDir)) { return { status: 'reject', reason_code: 'git_common_dir_missing',
      reason: 'cannot resolve git-common-dir for durable work orders', duplicate_dispatch: 0,};}
  const rootRunId = input.root_run_id || null;
  // root_run_id mandatory — never global-scan work orders across roots.
  if (!isStr(rootRunId)) { return { status: 'reject', reason_code: 'root_run_id_required',
      reason: 'root_run_id is mandatory for exact-root PostCompact reconcile', duplicate_dispatch: 0,};}
  const casFile = rootCasLockPath(commonDir, rootRunId);
  const casOwner = captureProcessIdentity(process.pid);
  const casLock = acquireWorkOrderLock(casFile, casOwner, input.lockTimeoutMs || 5000);
  if (!casLock.ok) { return { status: 'reject', reason_code: casLock.reason_code, reason: casLock.reason, duplicate_dispatch: 0 };}
  try { const entries = listWorkOrders(commonDir, rootRunId);
    const classifications = [];
    const identity = { root_run_id: rootRunId, phase_cursor: null, accepted_commit: null, next_action: null };
    const idKeys = ['phase_cursor', 'accepted_commit', 'next_action'];
    for (const entry of entries) { const wo = entry.work_order;
      const classified = classifyWorkOrder(wo, { gitCwd: input.gitCwd || null, workOrderPath: entry.path, parseError: entry.error || null,
        terminalReceipt: input.terminalReceipts && wo ? input.terminalReceipts[wo.work_order_id] : null,
        requireBoundEvidence: input.requireBoundEvidence !== false, autoDispositionStale: input.autoDispositionStale !== false,});
      let boundWo = wo;
      if (classified.classification === 'stale_dispositioned' && wo && !classified.idempotent) { const dr = {
          schema_version: 1, artifact_type: 'work_order_disposition_receipt', disposition: 'stale_dispositioned',
          work_order_id: wo.work_order_id, root_run_id: wo.root_run_id, generation: wo.generation,
          work_order_digest: wo.digest || workOrderDigest(wo), issued_at: nowIso(),};
        dr.digest = sha256Json({ ...dr, digest: undefined });
        const upd = updateWorkOrderLifecycle(commonDir, { path: entry.path }, {
          disposition: 'stale_dispositioned', terminal_status: wo.terminal_status || 'aborted', disposition_receipt: dr,
        }, { expectedGeneration: wo.generation, bindArtifacts: false });
        if (upd.work_order) boundWo = upd.work_order;
        releaseOwnedLease(entry.path);}
      if (classified.classification === 'consume_terminal' && wo && !classified.idempotent) {
        const upd = updateWorkOrderLifecycle(commonDir, { path: entry.path }, {
          disposition: 'consumed', terminal_status: classified.terminal_status || wo.terminal_status,
        }, { expectedGeneration: wo.generation, bindArtifacts: false });
        if (upd.work_order) boundWo = upd.work_order;
        releaseOwnedLease(entry.path);}
      if (classified.classification === 'attach_active' && wo) { for (const k of idKeys) { if (!identity[k] && wo[k]) identity[k] = wo[k]; }
        if (!identity.root_run_id) identity.root_run_id = wo.root_run_id;
        const upd = updateWorkOrderLifecycle(commonDir, { path: entry.path }, { disposition: null }, {
          expectedGeneration: wo.generation, bumpGeneration: false, bindArtifacts: false, preserveOwner: true,});
        if (upd.work_order) boundWo = upd.work_order;
        else { const locked = withWorkOrderLock(entry.path, () => { const live = readJsonIfPresent(entry.path) || { ...wo };
            const hb = nowIso();
            live.heartbeat_at = hb; live.updated_at = hb; live.disposition = null;
            live.digest = workOrderDigest(live);
            writeAtomicJson(entry.path, live);
            writeOwnedLease(entry.path, live.owner);
            return live;});
          if (locked.ok) boundWo = locked.value;}}
      const gen = boundWo && Number.isInteger(boundWo.generation) ? boundWo.generation : null;
      const dig = boundWo ? (isStr(boundWo.digest) ? boundWo.digest : workOrderDigest(boundWo)) : null;
      classifications.push({...classified, path: entry.path,
        work_order_id: (boundWo && boundWo.work_order_id) || classified.work_order_id || null,
        root_run_id: (boundWo && boundWo.root_run_id) || rootRunId || null,
        phase_cursor: boundWo && boundWo.phase_cursor || null,
        next_action: boundWo && boundWo.next_action || null, accepted_commit: boundWo && boundWo.accepted_commit || null,
        attempt: boundWo && boundWo.attempt || null, generation: gen, work_order_digest: dig,});}
    mergeIdentityField(identity, input.durable, idKeys);
    if (!isStr(identity.root_run_id) && isStr(input.durable?.root_run_id)) identity.root_run_id = input.durable.root_run_id;
    mergeIdentityField(identity, input.mission, idKeys);
    if (!isStr(identity.root_run_id) && isStr(input.mission?.root_run_id)) identity.root_run_id = input.mission.root_run_id;
    if (isStr(rootRunId)) identity.root_run_id = rootRunId;
    const issuedAt = new Date();
    const ttl = Number.isInteger(input.ttlMs) ? input.ttlMs : RECEIPT_DEFAULT_TTL_MS;
    const receipt = { schema_version: RECONCILE_SCHEMA, artifact_type: RECONCILE_ARTIFACT, issued_at: issuedAt.toISOString(),
      fresh_until: new Date(issuedAt.getTime() + ttl).toISOString(), git_common_dir: commonDir,
      root_run_id: identity.root_run_id || rootRunId, classifications, identity, authority: ['work_order', 'process_identity', 'ledger', 'git', 'mission'],};
    receipt.digest = reconcileReceiptDigest(receipt);
    const outPath = input.receiptPath|| (identity.root_run_id? reconcileReceiptPath(commonDir, identity.root_run_id)
        : path.join(workOrdersRoot(commonDir), 'reconcile-receipt.json'));
    writeAtomicJson(outPath, receipt);
    const blocked = classifications.some((c) => c.classification === 'orphan_blocked');
    const hasAttach = classifications.some((c) => c.classification === 'attach_active');
    const hasConsume = classifications.some((c) => c.classification === 'consume_terminal');
    const hasStale = classifications.some((c) => c.classification === 'stale_dispositioned');
    return { status: blocked ? 'reject' : 'reconciled', reason_code: blocked ? 'orphan_blocked' : null,
      reason: blocked ? 'one or more work orders classified orphan_blocked' : 'postcompact reconcile complete',
      action: hasAttach ? 'attach_active' : hasConsume ? 'consume_terminal': hasStale ? 'stale_dispositioned' : 'reconciled',
      classifications, identity, receipt, receipt_path: outPath, duplicate_dispatch: 0,};} finally { if (casFile) releaseWorkOrderLock(casFile, casLock.lock);}
}
function validateReconcileReceipt(receipt, options = {}) {
  if (!isObj(receipt)) return { ok: false, reason_code: 'reconcile_receipt_missing', reason: 'reconcile receipt is required' };
  if (receipt.schema_version !== RECONCILE_SCHEMA || receipt.artifact_type !== RECONCILE_ARTIFACT) {
    return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'reconcile receipt schema/artifact_type invalid', };}
  if (!isStr(receipt.digest) || receipt.digest !== reconcileReceiptDigest(receipt)) {
    return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'reconcile receipt digest mismatch (forged or tampered)', };}
  if (!isStr(receipt.fresh_until) || Date.parse(receipt.fresh_until) < Date.now()) {
    return { ok: false, reason_code: 'reconcile_receipt_stale', reason: 'reconcile receipt is stale' };}
  // Fail-closed cross-root: never accept a receipt scoped to a different root_run_id.
  // Terminal/parent (same-root) receipts still pass when roots match; do not soften this.
  if (isStr(options.root_run_id) && receipt.root_run_id !== options.root_run_id) {
    return { ok: false, reason_code: 'reconcile_receipt_mismatch', reason: 'reconcile receipt root_run_id mismatch', };}
  if (isStr(options.commonDir) && isStr(receipt.git_common_dir)) { let left = options.commonDir;
    let right = receipt.git_common_dir;
    try { left = fs.realpathSync(left); } catch (_e) {  }
    try { right = fs.realpathSync(right); } catch (_e) {  }
    if (left !== right) { return { ok: false, reason_code: 'reconcile_receipt_mismatch', reason: 'reconcile receipt git_common_dir mismatch', };}}
  if (!Array.isArray(receipt.classifications)) {
    return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'reconcile receipt classifications missing', };}
  const rootRunId = options.root_run_id || receipt.root_run_id || null;
  const commonDir = options.commonDir || null;
  const validateBody = () => {
    const liveEntries = (isStr(commonDir) && isStr(rootRunId)) ? listWorkOrders(commonDir, rootRunId) : [];
    if (liveEntries.length > 0 && receipt.classifications.length === 0) {
      return { ok: false, reason_code: 'reconcile_receipt_mismatch',
        reason: 'empty classifications while schema-2 work orders exist for root; refuse dispatch_new', };}
    const liveByPath = new Map();
    for (const entry of liveEntries) {
      const key = path.resolve(entry.path);
      if (liveByPath.has(key)) {
        return { ok: false, reason_code: 'reconcile_receipt_mismatch', reason: 'duplicate live work order path under root' };}
      liveByPath.set(key, entry);}
    const seenPaths = new Set();
    const seenIds = new Set();
    for (const c of receipt.classifications) {
      if (!CLASSIFICATIONS.includes(c.classification)) {
        return { ok: false, reason_code: 'reconcile_receipt_forged', reason: `invalid classification ${c.classification}` };}
      if (c.classification === 'orphan_blocked') {
        return { ok: false, reason_code: 'orphan_blocked', reason: c.reason || 'work order orphan_blocked' };}
      if (!isStr(c.path)) {
        return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'classification path omitted' };}
      const resolvedPath = path.resolve(c.path);
      if (seenPaths.has(resolvedPath)) {
        return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'duplicate classification path' };}
      seenPaths.add(resolvedPath);
      if (isStr(c.work_order_id)) {
        if (seenIds.has(c.work_order_id)) {
          return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'duplicate classification work_order_id' };}
        seenIds.add(c.work_order_id);}
      if (isStr(rootRunId) && isStr(c.root_run_id) && c.root_run_id !== rootRunId) {
        return { ok: false, reason_code: 'reconcile_receipt_mismatch', reason: 'classification root_run_id is foreign to receipt root' };}
      if (isStr(commonDir) && isStr(rootRunId) && !liveByPath.has(resolvedPath)) {
        return { ok: false, reason_code: 'reconcile_receipt_mismatch',
          reason: 'classification path is foreign/extra vs current root work order set', };}
      if (!Number.isInteger(c.generation)) {
        return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'classification generation omitted' };}
      if (!isStr(c.work_order_digest)) {
        return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'classification work_order_digest omitted' };}
      if (!isStr(c.work_order_id)) {
        return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'classification work_order_id omitted' };}
      if (!isStr(c.root_run_id)) {
        return { ok: false, reason_code: 'reconcile_receipt_forged', reason: 'classification root_run_id omitted' };}
      if (!fs.existsSync(c.path)) {
        return { ok: false, reason_code: 'reconcile_receipt_stale', reason: 'reconcile receipt references nonexistent work order path' };}
      if (!isStr(commonDir)) continue;
      const locked = withWorkOrderLock(c.path, () => {
        const liveParsed = readJsonStrict(c.path);
        if (!liveParsed.ok) {
          return { ok: false, reason_code: 'reconcile_receipt_stale', reason: 'reconcile receipt references unreadable work order' };}
        const live = liveParsed.value;
        if (!isObj(live) || live.artifact_type !== WORK_ORDER_ARTIFACT || live.schema_version !== WORK_ORDER_SCHEMA) {
          return { ok: false, reason_code: 'reconcile_receipt_stale', reason: 'live path is not a schema-2 work order' };}
        if (live.root_run_id !== c.root_run_id || live.root_run_id !== rootRunId) {
          return { ok: false, reason_code: 'reconcile_receipt_mismatch', reason: 'classification root_run_id does not match live work order' };}
        if (live.work_order_id !== c.work_order_id) {
          return { ok: false, reason_code: 'reconcile_receipt_mismatch', reason: 'classification work_order_id does not match live work order' };}
        if (live.generation !== c.generation) {
          return { ok: false, reason_code: 'reconcile_receipt_stale',
            reason: `receipt generation ${c.generation} != live work order ${live.generation}`, };}
        // Always canonicalize current schema-2 body — never trust stored digest alone.
        const liveDig = workOrderDigest(live);
        if (!isStr(live.digest) || live.digest !== liveDig) {
          return { ok: false, reason_code: 'work_order_digest_mismatch',
            reason: isStr(live.digest) ? 'live work order digest mismatch (tampered)' : 'live work order digest missing', };}
        if (liveDig !== c.work_order_digest) {
          return { ok: false, reason_code: 'reconcile_receipt_stale', reason: 'receipt work_order_digest does not match live work order' };}
        // Re-classify live WO; reject relabelled stale/consume/attach classifications.
        const reclass = classifyWorkOrder(live, {
          gitCwd: options.gitCwd || null, workOrderPath: c.path, skipBindCheck: options.skipBindCheck === true,
          requireBoundEvidence: options.requireBoundEvidence, autoDispositionStale: false,});
        if (reclass.classification !== c.classification) {
          return { ok: false, reason_code: 'reconcile_receipt_stale',
            reason: `receipt classification ${c.classification} relabelled vs live ${reclass.classification}`, };}
        return { ok: true };
      }, options.lockTimeoutMs || 2000);
      if (!locked.ok) {
        return { ok: false, reason_code: locked.reason_code || 'lock_busy', reason: locked.reason || 'cannot lock work order for receipt validation' };}
      if (locked.value && locked.value.ok === false) return locked.value;}
    if (isStr(commonDir) && isStr(rootRunId)) {
      for (const [livePath, entry] of liveByPath) {
        if (!seenPaths.has(livePath)) {
          return { ok: false, reason_code: 'reconcile_receipt_mismatch',
            reason: `receipt missing classification for live work order ${entry.work_order && entry.work_order.work_order_id || livePath}`, };}}}
    return { ok: true, receipt };
  };
  if (options.rootLockHeld === true || !isStr(commonDir) || !isStr(rootRunId)) return validateBody();
  const casFile = rootCasLockPath(commonDir, rootRunId);
  const casOwner = captureProcessIdentity(process.pid);
  const casLock = acquireWorkOrderLock(casFile, casOwner, options.lockTimeoutMs || 2000);
  if (!casLock.ok) {
    return { ok: false, reason_code: casLock.reason_code || 'lock_busy', reason: casLock.reason || 'cannot acquire root CAS lock for receipt validation' };}
  try { return validateBody(); } finally { releaseWorkOrderLock(casFile, casLock.lock); }}
function claimDispatchCas(commonDir, fields, options = {}) { const owner = isObj(options.owner)? options.owner
    : captureProcessIdentity(options.pid || process.pid);
  const rootRunId = fields.root_run_id;
  if (!isStr(rootRunId)) { return { status: 'reject', reason_code: 'incomplete_work_order', reason: 'root_run_id required for CAS', duplicate_dispatch: 0, };}
  const casFile = rootCasLockPath(commonDir, rootRunId);
  const rootLock = acquireWorkOrderLock(casFile, owner, options.lockTimeoutMs || 5000);
  if (!rootLock.ok) { return { status: 'reject', reason_code: rootLock.reason_code, reason: rootLock.reason, duplicate_dispatch: 0, };}
  try { const nonterminal = listNonterminalWorkOrders(commonDir, rootRunId);
    if (nonterminal.length > 0) { const receipt = options.reconcileReceipt|| (options.reconcileReceiptPath? readJsonIfPresent(options.reconcileReceiptPath)
          : readJsonIfPresent(reconcileReceiptPath(commonDir, rootRunId)));
      const validated = validateReconcileReceipt(receipt, { root_run_id: rootRunId, commonDir, rootLockHeld: true,
        lockTimeoutMs: options.lockTimeoutMs,});
      if (!validated.ok) { return { status: 'reject', reason_code: validated.reason_code, reason: validated.reason, duplicate_dispatch: 0, };}
      const attach = validated.receipt.classifications.find((c) => c.classification === 'attach_active');
      if (attach) { return { status: 'attach', action: 'attach_active', reason_code: null,
          reason: 'active work order; attach instead of re-dispatch', duplicate_dispatch: 0,
          work_order_id: attach.work_order_id, classification: attach, receipt: validated.receipt,};}
      const consume = validated.receipt.classifications.find((c) => c.classification === 'consume_terminal');
      if (consume) { return { status: 'consume', action: 'consume_terminal', reason_code: null,
          reason: consume.reason || 'consume terminal work order', duplicate_dispatch: 0, work_order_id: consume.work_order_id, classification: consume,
          terminal_status: consume.terminal_status, success: consume.success === true, receipt: validated.receipt,};}
      const blockers = validated.receipt.classifications.filter((c) => ( c.classification === 'attach_active' || c.classification === 'orphan_blocked'));
      if (blockers.length > 0) { return { status: 'reject', reason_code: 'nonterminal_work_orders_open',
          reason: 'new dispatch blocked until nonterminal work orders are attached or dispositioned', duplicate_dispatch: 0,};}}
    const file = workOrderPath( commonDir, rootRunId, fields.graph_node || 'default', fields.attempt || 1,);
    const existingParsed = readJsonStrict(file);
    if (!existingParsed.ok) { return { status: 'reject', reason_code: existingParsed.reason_code, reason: existingParsed.reason, duplicate_dispatch: 0, };}
    const existing = existingParsed.value;
    // Exact tuple always blocks overwrite: active, current, consumed tombstone, or stale tombstone.
    if (existing && existing.artifact_type === WORK_ORDER_ARTIFACT) {
      const classified = classifyWorkOrder(existing, {
        workOrderPath: file, gitCwd: options.gitCwd || null, requireBoundEvidence: options.bindArtifacts !== false,
        terminalReceipt: options.terminalReceipt || null,});
      if (classified.classification === 'attach_active') { return { status: 'attach', action: 'attach_active', reason_code: null,
          reason: 'exact work order tuple already active; refuse second dispatch_new',
          duplicate_dispatch: 0, work_order_id: existing.work_order_id, work_order: existing, path: file,};}
      if (classified.classification === 'consume_terminal') { return {
          status: 'consume', action: 'consume_terminal', reason_code: null, reason: classified.reason, duplicate_dispatch: 0,
          work_order_id: existing.work_order_id, terminal_status: classified.terminal_status,
          success: classified.success === true, work_order: existing, path: file,};}
      if (classified.classification === 'stale_dispositioned'
          || existing.disposition === 'stale_dispositioned' || existing.disposition === 'consumed') {
        return { status: 'reject', reason_code: 'cas_conflict',
          reason: 'exact work order tombstone (consumed/stale) blocks dispatch_new overwrite',
          duplicate_dispatch: 0, work_order: existing, path: file, action: 'fail_closed',};}
      return { status: 'reject', reason_code: classified.reason_code || 'cas_conflict',
        reason: classified.reason || 'exact work order exists; refuse second dispatch_new', duplicate_dispatch: 0, work_order: existing, path: file,};}
    const written = createOrUpdateWorkOrder(commonDir, { root_run_id: rootRunId, graph_node: fields.graph_node || 'default',
      attempt: fields.attempt || 1, role: fields.role || 'implementer', branch: fields.branch,
      base_sha: fields.base_sha, worktree: fields.worktree || null, paths: fields.paths || {},
      phase_cursor: fields.phase_cursor, accepted_commit: fields.accepted_commit,
      next_action: fields.next_action || 'dispatch', artifact_digests: fields.artifact_digests, expected_receipt: fields.expected_receipt || null, owner,}, {
      pid: owner.pid, expectedGeneration: options.expectedGeneration, expectedCasToken: options.expectedCasToken,
      bindArtifacts: options.bindArtifacts !== false, rotateCasToken: true, preserveOwner: true, updateLifecycle: false,});
    if (written.status === 'reject') return { ...written, duplicate_dispatch: 0, action: 'fail_closed' };
    return { status: 'claimed', action: 'dispatch_new', reason_code: null,
      reason: 'CAS claimed work order for new dispatch', duplicate_dispatch: 0, work_order: written.work_order, path: written.path,};} finally {
    releaseWorkOrderLock(casFile, rootLock.lock);}}
module.exports = { WORK_ORDER_SCHEMA, WORK_ORDER_ARTIFACT, RECONCILE_ARTIFACT, RECONCILE_SCHEMA,
  TERMINAL_RECEIPT_ARTIFACT, CLASSIFICATIONS,
  TERMINAL_STATUSES, resolveGitCommonDir, workOrdersRoot, workOrderPath, reconcileReceiptPath,
  captureProcessIdentity, isProcessLive, readProcessStartTime, readPgidSid, buildWorkOrder, workOrderDigest,
  workOrderMissingFields, createOrUpdateWorkOrder, updateWorkOrderLifecycle, listWorkOrders,
  listNonterminalWorkOrders, hasNonterminalWorkOrders, classifyWorkOrder, validateBoundArtifacts,
  validateTerminalReceipt, reconcilePostCompact, validateReconcileReceipt, reconcileReceiptDigest,
  claimDispatchCas, sha256File, sha256Json, writeAtomicJson, readJsonIfPresent, readJsonStrict,
  isTerminalWorkOrder, isNonterminalWorkOrder, isCompleteIdentity, isProcessLiveStrict,
  assessWorktreeClean, assessUniqueCommittedMutation, acquireWorkOrderLock, releaseWorkOrderLock,
  rootCasLockPath, leasePathFor, writeOwnedLease, releaseOwnedLease,};
