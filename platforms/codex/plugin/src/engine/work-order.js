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
const SHA256 = /^[0-9a-f]{64}$/;
const DISPOSITION_RECEIPT_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'disposition',
  'work_order_id',
  'root_run_id',
  'graph_node',
  'attempt',
  'generation',
  'work_order_digest',
  'cas_token',
  'observation_digest',
  'issued_at',
  'digest',
]);
const CONTROLLER_TERMINAL_RECEIPT_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'terminal_status',
  'root_run_id',
  'work_order_id',
  'graph_node',
  'campaign_id',
  'accepted_commit',
  'controller_digest',
  'frozen_denominator_digest',
  'issued_at',
  'digest',
]);
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
function readProcessParentPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const ppid = Number(fields[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  } catch (_error) {
    const result = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ppid = Number(String(result.stdout || '').trim());
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  }
}
function captureProcessParentage(pid = process.pid, maxDepth = 8) {
  const owner = captureProcessIdentity(pid);
  const relationships = [];
  let child = owner;
  const seen = new Set();
  for (let depth = 0; depth < maxDepth && isCompleteIdentity(child); depth += 1) {
    if (seen.has(child.pid)) break;
    seen.add(child.pid);
    const parentPid = readProcessParentPid(child.pid);
    if (!Number.isInteger(parentPid) || parentPid <= 0 || parentPid === child.pid) break;
    const parent = captureProcessIdentity(parentPid);
    if (!isCompleteIdentity(parent)) break;
    relationships.push({ child, parent });
    child = parent;
    if (parent.pid === 1) break;
  }
  const body = {
    schema_version: 1,
    owner,
    relationships,
    observed_at: nowIso(),
  };
  return { ...body, digest: sha256Json(body) };
}
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
function normalizeSealedScope(scope) {
  if (!isObj(scope)) {
    const err = new Error('sealed_scope must be an object');
    err.code = 'sealed_scope_invalid';
    throw err;
  }
  const keys = Object.keys(scope).sort();
  const expected = ['allow_paths', 'max_diff_lines', 'max_files'];
  if (keys.length !== expected.length
      || keys.some((key, index) => key !== expected[index])) {
    const err = new Error('sealed_scope must contain exactly allow_paths, max_files, and max_diff_lines');
    err.code = 'sealed_scope_invalid';
    throw err;
  }
  const normalizedPaths = Array.isArray(scope.allow_paths)
    ? scope.allow_paths.map((entry) => (
      isStr(entry) && entry.endsWith('/') ? entry.slice(0, -1) : entry
    ))
    : [];
  if (!Array.isArray(scope.allow_paths)
      || normalizedPaths.length === 0
      || normalizedPaths.some((entry) => (
        !isStr(entry)
        || path.isAbsolute(entry)
        || entry.includes('\\')
        || entry.split('/').some((part) => part === '' || part === '.' || part === '..')
      ))
      || new Set(normalizedPaths).size !== normalizedPaths.length
      || !Number.isSafeInteger(scope.max_files)
      || scope.max_files < 1
      || !Number.isSafeInteger(scope.max_diff_lines)
      || scope.max_diff_lines < 1) {
    const err = new Error('sealed_scope paths and churn limits are invalid');
    err.code = 'sealed_scope_invalid';
    throw err;
  }
  return {
    allow_paths: normalizedPaths,
    max_files: scope.max_files,
    max_diff_lines: scope.max_diff_lines,
  };
}
function computeArtifactDigests(paths = {}, fields = {}) { const d = {};
  if (isStr(paths.mission)) d.mission = sha256File(paths.mission);
  else if (isStr(fields.mission_digest)) d.mission = fields.mission_digest;
  if (isStr(paths.manifest)) d.manifest = sha256File(paths.manifest);
  if (isStr(paths.receipt)) d.receipt = sha256File(paths.receipt);
  if (isStr(paths.ledger)) {
    d.ledger = sha256File(paths.ledger);
    d.ledger_history = controllerLedgerHistoryDigest(paths.ledger);
  }
  else if (isStr(fields.ledger_digest)) d.ledger = fields.ledger_digest;
  if (isStr(paths.durable)) d.durable = sha256File(paths.durable);
  if (isStr(paths.checkpoint)) d.checkpoint = sha256File(paths.checkpoint);
  if (isStr(fields.accepted_commit) && fields.accepted_commit !== 'none') { d.accepted_commit = fields.accepted_commit;}
  return d;}
function controllerLedgerFiles(ledgerPath) {
  if (!isStr(ledgerPath)) return [];
  let maxRotations = Number(process.env.RUN_LEDGER_MAX_ROTATIONS || 4);
  if (!Number.isSafeInteger(maxRotations) || maxRotations < 1 || maxRotations > 64) {
    maxRotations = 4;
  }
  const files = [];
  for (let index = maxRotations; index >= 1; index -= 1) {
    const segment = `${ledgerPath}.${index}`;
    if (fs.existsSync(segment)) files.push(segment);
  }
  if (fs.existsSync(ledgerPath)) files.push(ledgerPath);
  return files;
}
function controllerLedgerHistoryDigest(ledgerPath) {
  const files = controllerLedgerFiles(ledgerPath);
  if (files.length === 0) return null;
  try {
    const segments = files.map((file) => {
      const bytes = fs.readFileSync(file);
      return {
        segment: path.basename(file),
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    });
    return sha256Json(segments);
  } catch (_error) {
    return null;
  }
}
function observeControllerLedger(ledgerPath, wo, options = {}) {
  if (!isStr(ledgerPath) || !isObj(wo) || !isObj(wo.controller)) {
    return {
      ok: false,
      reason_code: 'controller_ledger_missing',
      reason: 'controller recovery requires a bound ledger path and controller Work Order',
    };
  }
  const files = controllerLedgerFiles(ledgerPath);
  if (files.length === 0) {
    return {
      ok: false,
      reason_code: 'controller_ledger_missing',
      reason: 'controller recovery ledger and rotations are missing',
    };
  }
  const rows = [];
  let previousAt = null;
  try {
    for (const file of files) {
      if (!fs.statSync(file).isFile()) {
        return {
          ok: false,
          reason_code: 'controller_ledger_invalid',
          reason: `controller ledger segment is not a regular file: ${file}`,
        };
      }
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim());
      for (const line of lines) {
        const row = JSON.parse(line);
        const parsedAt = isStr(row && row.at) ? Date.parse(row.at) : NaN;
        if (!isObj(row)
            || row.schema_version !== 1
            || row.event !== 'controller_heartbeat'
            || row.root_run_id !== wo.root_run_id
            || row.work_order_id !== wo.work_order_id
            || !SHA256.test(row.controller_digest || '')
            || !isStr(row.at)
            || !row.at.endsWith('Z')
            || !Number.isFinite(parsedAt)
            || (previousAt != null && parsedAt < previousAt)) {
          return {
            ok: false,
            reason_code: 'controller_ledger_invalid',
            reason: 'controller ledger contains a foreign, malformed, or non-monotonic event',
          };
        }
        previousAt = parsedAt;
        rows.push({
          ...row,
          segment: path.basename(file),
        });
      }
    }
  } catch (error) {
    return {
      ok: false,
      reason_code: 'controller_ledger_invalid',
      reason: `controller ledger history is unreadable: ${error.message || String(error)}`,
    };
  }
  const latest = rows.at(-1) || null;
  if (!latest || latest.controller_digest !== wo.controller.controller_digest) {
    return {
      ok: false,
      reason_code: 'controller_ledger_mismatch',
      reason: 'latest controller ledger event does not bind the current controller digest',
    };
  }
  const historyDigest = controllerLedgerHistoryDigest(ledgerPath);
  if (!SHA256.test(historyDigest || '')) {
    return {
      ok: false,
      reason_code: 'controller_ledger_invalid',
      reason: 'controller ledger history digest is unavailable',
    };
  }
  const age = Date.now() - Date.parse(latest.at);
  const fresh = age >= -60_000 && age < 15 * 60 * 1000;
  if (options.requireFresh === true && !fresh) {
    return {
      ok: false,
      reason_code: 'ledger_not_live',
      reason: 'latest controller ledger event is not fresh',
      history_digest: historyDigest,
      event_count: rows.length,
    };
  }
  return {
    ok: true,
    fresh,
    latest,
    event_count: rows.length,
    segment_count: files.length,
    history_digest: historyDigest,
  };
}
function normalizeControllerForDigest(controller) {
  // Legacy schema-2 Work Orders omit the controller property entirely.
  // Explicit null/primitives are NOT legacy and must fail closed when validated.
  if (controller === undefined) return undefined;
  if (!isObj(controller)) return { __invalid: true, value: controller };
  return { ...controller };
}
function workOrderCanonicalBody(wo) {
  const body = {
    schema_version: wo.schema_version,
    artifact_type: wo.artifact_type,
    work_order_id: wo.work_order_id,
    root_run_id: wo.root_run_id,
    graph_node: wo.graph_node,
    attempt: wo.attempt,
    role: wo.role,
    generation: wo.generation,
    owner: wo.owner,
    runner: wo.runner,
    branch: wo.branch,
    base_sha: wo.base_sha,
    worktree: wo.worktree,
    paths: wo.paths,
    artifact_digests: wo.artifact_digests || {},
    phase_cursor: wo.phase_cursor,
    campaign_phase: wo.campaign_phase ?? null,
    accepted_commit: wo.accepted_commit,
    next_action: wo.next_action,
    terminal_status: wo.terminal_status,
    disposition: wo.disposition,
    expected_receipt: wo.expected_receipt,
    cas_token: wo.cas_token,
  };
  // Controller is inside the canonical Work Order body whenever the property is
  // present. Legacy compatibility applies only when the property is absent.
  if (Object.prototype.hasOwnProperty.call(wo, 'controller')) {
    body.controller = normalizeControllerForDigest(wo.controller);
  }
  // A disposition receipt is authority, not telemetry.  Legacy Work Orders
  // genuinely omit the property; whenever present it is sealed by the parent
  // Work Order digest so it cannot be swapped after stale disposition.
  if (Object.prototype.hasOwnProperty.call(wo, 'disposition_receipt')) {
    body.disposition_receipt = wo.disposition_receipt;
  }
  // Scope/churn is optional only for genuine legacy Work Orders. When present,
  // it is a closed canonical authority field covered by the Work Order digest.
  if (Object.prototype.hasOwnProperty.call(wo, 'sealed_scope')) {
    body.sealed_scope = wo.sealed_scope;
  }
  return body;
}
const workOrderDigest = (wo) => sha256Json(workOrderCanonicalBody(wo));
function validateControllerBinding(controller) {
  // Genuinely absent property → legacy. Explicit null is present and rejected.
  if (controller === undefined) {
    return { ok: true, legacy: true };
  }
  if (controller === null) {
    return {
      ok: false,
      reason_code: 'controller_null_forbidden',
      reason: 'explicit controller:null is not a legacy Work Order; reject',
    };
  }
  if (!isObj(controller)) {
    return { ok: false, reason_code: 'controller_malformed', reason: 'controller must be an object when present' };
  }
  if (!isStr(controller.controller_digest)) {
    return { ok: false, reason_code: 'controller_digest_missing', reason: 'controller.controller_digest required when controller is present' };
  }
  let recompute;
  try {
    const { controllerStateDigest } = require('./controller-execution');
    recompute = controllerStateDigest(controller);
  } catch (_e) {
    const body = { ...controller };
    delete body.controller_digest;
    recompute = sha256Json(body);
  }
  if (controller.controller_digest !== recompute) {
    return {
      ok: false,
      reason_code: 'controller_digest_mismatch',
      reason: 'controller.controller_digest does not match controller body',
    };
  }
  return { ok: true, legacy: false };
}
function validateDispositionReceipt(receipt, workOrder, options = {}) {
  const prior = isObj(options.priorWorkOrder) ? options.priorWorkOrder : null;
  if (!isObj(receipt)
      || Object.keys(receipt).length !== DISPOSITION_RECEIPT_KEYS.size
      || Object.keys(receipt).some((key) => !DISPOSITION_RECEIPT_KEYS.has(key))
      || receipt.schema_version !== 1
      || receipt.artifact_type !== 'work_order_disposition_receipt'
      || receipt.disposition !== 'stale_dispositioned'
      || receipt.disposition !== workOrder.disposition
      || receipt.work_order_id !== workOrder.work_order_id
      || receipt.root_run_id !== workOrder.root_run_id
      || receipt.graph_node !== workOrder.graph_node
      || receipt.attempt !== workOrder.attempt
      || !Number.isInteger(receipt.generation)
      || receipt.generation !== workOrder.generation - 1
      || !SHA256.test(receipt.work_order_digest || '')
      || !isStr(receipt.cas_token)
      || receipt.cas_token !== workOrder.cas_token
      || !SHA256.test(receipt.observation_digest || '')
      || typeof receipt.issued_at !== 'string'
      || !receipt.issued_at.endsWith('Z')
      || !Number.isFinite(Date.parse(receipt.issued_at))
      || !SHA256.test(receipt.digest || '')) {
    return {
      ok: false,
      reason_code: 'disposition_receipt_invalid',
      reason: 'stored disposition receipt is not the exact prior-generation stale-disposition authority',
    };
  }
  if (prior
      && (receipt.work_order_id !== prior.work_order_id
        || receipt.root_run_id !== prior.root_run_id
        || receipt.graph_node !== prior.graph_node
        || receipt.attempt !== prior.attempt
        || receipt.generation !== prior.generation
        || receipt.work_order_digest !== prior.digest
        || receipt.cas_token !== prior.cas_token)) {
    return {
      ok: false,
      reason_code: 'disposition_receipt_replay',
      reason: 'disposition receipt does not bind the exact prior Work Order generation/digest/CAS tuple',
    };
  }
  const receiptBody = { ...receipt };
  delete receiptBody.digest;
  if (receipt.digest !== sha256Json(receiptBody)) {
    return {
      ok: false,
      reason_code: 'disposition_receipt_digest_mismatch',
      reason: 'stored disposition receipt digest mismatch',
    };
  }
  return { ok: true };
}
function validateStoredWorkOrderIntegrity(existing) {
  if (!isObj(existing)) {
    return { ok: false, reason_code: 'work_order_unreadable', reason: 'existing work order is not an object' };
  }
  if (!isStr(existing.digest)) {
    return {
      ok: false,
      reason_code: 'work_order_digest_missing',
      reason: 'existing work order digest is missing',
    };
  }
  if (existing.digest !== workOrderDigest(existing)) {
    return {
      ok: false,
      reason_code: 'work_order_digest_mismatch',
      reason: 'existing work order digest mismatch; refuse silent reseal of tampered authority',
    };
  }
  if (Object.prototype.hasOwnProperty.call(existing, 'controller')) {
    const bind = validateControllerBinding(existing.controller);
    if (!bind.ok) {
      return {
        ok: false,
        reason_code: bind.reason_code,
        reason: `existing controller binding invalid: ${bind.reason}`,
      };
    }
  }
  if (existing.disposition === 'stale_dispositioned'
      && !Object.prototype.hasOwnProperty.call(existing, 'disposition_receipt')) {
    return {
      ok: false,
      reason_code: 'disposition_receipt_missing',
      reason: 'stale_dispositioned Work Order requires its closed prior-generation receipt',
    };
  }
  if (Object.prototype.hasOwnProperty.call(existing, 'disposition_receipt')) {
    const validated = validateDispositionReceipt(existing.disposition_receipt, existing);
    if (!validated.ok) return validated;
  }
  if (existing.disposition === 'consumed') {
    if (Object.prototype.hasOwnProperty.call(existing, 'disposition_receipt')) {
      return {
        ok: false,
        reason_code: 'terminal_receipt_invalid',
        reason: 'consumed Work Order cannot reuse a stale-disposition receipt',
      };
    }
    const expectedPath = isObj(existing.expected_receipt)
      && isStr(existing.expected_receipt.path)
      ? existing.expected_receipt.path : null;
    if (!expectedPath) {
      return {
        ok: false,
        reason_code: 'terminal_receipt_missing',
        reason: 'consumed Work Order requires exact expected_receipt authority',
      };
    }
    const loaded = readJsonStrict(expectedPath);
    if (!loaded.ok || !isObj(loaded.value)) {
      return {
        ok: false,
        reason_code: loaded.reason_code || 'terminal_receipt_missing',
        reason: loaded.reason || 'consumed Work Order terminal receipt is missing',
      };
    }
    const terminal = validateTerminalReceipt(loaded.value, existing, {
      receiptPath: expectedPath,
    });
    if (!terminal.ok) return terminal;
  }
  if (Object.prototype.hasOwnProperty.call(existing, 'sealed_scope')) {
    try {
      const normalized = normalizeSealedScope(existing.sealed_scope);
      if (JSON.stringify(normalized) !== JSON.stringify(existing.sealed_scope)) {
        return {
          ok: false,
          reason_code: 'sealed_scope_invalid',
          reason: 'stored sealed_scope is not in canonical closed form',
        };
      }
    } catch (error) {
      return {
        ok: false,
        reason_code: error.code || 'sealed_scope_invalid',
        reason: error.message || String(error),
      };
    }
  }
  return { ok: true };
}
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
  if (Object.prototype.hasOwnProperty.call(fields, 'sealed_scope')) {
    wo.sealed_scope = normalizeSealedScope(fields.sealed_scope);
  }
  if (options.bindArtifacts === true) { wo.artifact_digests = { ...wo.artifact_digests, ...computeArtifactDigests(wo.paths, fields) };}
  if (isObj(wo.expected_receipt) && isStr(wo.expected_receipt.path) && !isStr(wo.expected_receipt.digest)&& fs.existsSync(wo.expected_receipt.path)) {
    const loaded = readJsonStrict(wo.expected_receipt.path);
    if (loaded.ok && isObj(loaded.value)) { const body = { ...loaded.value }; delete body.digest;
      wo.expected_receipt = { ...wo.expected_receipt, digest: sha256Json(body) };}}
  // Controller is optional only when the property is absent (legacy schema-2).
  // Explicit null/malformed controllers are rejected.
  if (Object.prototype.hasOwnProperty.call(fields, 'controller')) {
    if (fields.controller === null) {
      const err = new Error('explicit controller:null is not legacy; refuse');
      err.code = 'controller_null_forbidden';
      throw err;
    }
    if (!isObj(fields.controller)) {
      const err = new Error('controller must be an object when present');
      err.code = 'controller_malformed';
      throw err;
    }
    const { controllerStateDigest } = require('./controller-execution');
    const ctrl = { ...fields.controller };
    // Missing digest may be computed for a freshly built controller. A present
    // but mismatched digest is tampering — never silently reseal.
    if (!isStr(ctrl.controller_digest)) {
      ctrl.controller_digest = controllerStateDigest(ctrl);
    } else if (ctrl.controller_digest !== controllerStateDigest(ctrl)) {
      const err = new Error('controller.controller_digest does not match controller body');
      err.code = 'controller_digest_mismatch';
      throw err;
    }
    const bind = validateControllerBinding(ctrl);
    if (!bind.ok) {
      const err = new Error(bind.reason);
      err.code = bind.reason_code;
      throw err;
    }
    wo.controller = ctrl;
  }
  if (fields.disposition_receipt != null) {
    wo.disposition_receipt = fields.disposition_receipt;
    const validated = validateDispositionReceipt(wo.disposition_receipt, wo);
    if (!validated.ok) {
      const err = new Error(validated.reason);
      err.code = validated.reason_code;
      throw err;
    }
  }
  const missing = workOrderMissingFields(wo);
  if (missing.length > 0) { const err = new Error(`incomplete work order: missing ${missing.join(',')}`);
    err.code = 'incomplete_work_order'; err.missing = missing; throw err;}
  wo.digest = workOrderDigest(wo);
  return wo;}
function validateBoundArtifacts(wo, options = {}) { if (!isObj(wo)) return { ok: false, reason_code: 'incomplete_work_order', reason: 'work order missing' };
  const digests = wo.artifact_digests || {};
  const paths = wo.paths || {};
  if (options.requireBoundEvidence !== false) { const has = ( (isStr(digests.mission) && isStr(paths.mission))|| (isStr(digests.ledger) && isStr(paths.ledger))
      || (isStr(digests.durable) && isStr(paths.durable))|| (isStr(wo.accepted_commit) && wo.accepted_commit !== 'none'));
    if (!has) { return { ok: false, reason_code: 'unauthenticated_evidence',
        reason: 'checkpoint/digest is not bound to Mission, ledger, durable tracker, or Git',};}}
  for (const key of ['mission', 'manifest', 'receipt', 'ledger', 'durable', 'checkpoint']) { if (isStr(paths[key]) && isStr(digests[key]) && sha256File(paths[key]) !== digests[key]) {
      return { ok: false, reason_code: 'artifact_digest_mismatch', reason: `${key} artifact digest mismatch`, };}}
  if (isStr(paths.ledger) && isStr(digests.ledger_history)
      && controllerLedgerHistoryDigest(paths.ledger) !== digests.ledger_history) {
    return {
      ok: false,
      reason_code: 'artifact_digest_mismatch',
      reason: 'ledger rotation-history digest mismatch',
    };
  }
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
function ledgerLooksLive(ledgerPath, wo = null) {
  if (!isStr(ledgerPath)) return null;
  // Legacy non-controller continuation records retain the historical freshness
  // rule. Controller attach authority is stronger: scan the same oldest→live
  // rotation set as run-ledger and require an exact final root/controller event.
  if (!isObj(wo) || !isObj(wo.controller)) {
    if (!fs.existsSync(ledgerPath)) return null;
    try { return Date.now() - fs.statSync(ledgerPath).mtimeMs < 15 * 60 * 1000; } catch (_e) { return null; }
  }
  const observed = observeControllerLedger(ledgerPath, wo, { requireFresh: true });
  return observed.ok === true;
}
function isCompleteIdentity(id) { return Boolean( id && Number.isInteger(id.pid) && id.pid > 0
    && id.process_start_time != null && Number(id.process_start_time) > 0&& id.pgid != null && Number.isInteger(Number(id.pgid))
    && id.sid != null && Number.isInteger(Number(id.sid)),);}
function isProcessLiveStrict(id) {
  // Incomplete identity is not live — but never treat process-table failure as dead.
  if (!isCompleteIdentity(id)) return false;
  try {
    if (fs.existsSync('/proc')) {
      try {
        fs.accessSync('/proc', fs.constants.R_OK);
      } catch (error) {
        const err = new Error(`process table unreadable: ${error.message || String(error)}`);
        err.code = 'PROCESS_TABLE_UNREADABLE';
        throw err;
      }
    }
    return isProcessLive(id);
  } catch (error) {
    if (error && error.code === 'PROCESS_TABLE_UNREADABLE') throw error;
    const err = new Error(
      `process death unknown (table/identity probe failed): ${error.message || String(error)}`,
    );
    err.code = 'PROCESS_TABLE_UNREADABLE';
    throw err;
  }
}
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
function identityFullyAbsent(identity) {
  if (!isObj(identity)) return true;
  return ['pid', 'process_start_time', 'pgid', 'sid']
    .every((key) => identity[key] === null || identity[key] === undefined);
}
function observeStaleDispositionAuthority(wo, options = {}) {
  if (!isObj(wo) || !isCompleteIdentity(wo.owner)) {
    return {
      ok: false,
      reason_code: 'owner_identity_incomplete',
      reason: 'stale disposition requires a complete owner process identity',
    };
  }
  const runnerAbsent = identityFullyAbsent(wo.runner);
  if (!runnerAbsent && !isCompleteIdentity(wo.runner)) {
    return {
      ok: false,
      reason_code: 'runner_identity_incomplete',
      reason: 'stale disposition requires a complete runner identity or an exactly absent runner',
    };
  }
  let ownerLive;
  let runnerLive = false;
  try {
    ownerLive = isProcessLiveStrict(wo.owner);
    if (!runnerAbsent) runnerLive = isProcessLiveStrict(wo.runner);
  } catch (error) {
    return {
      ok: false,
      reason_code: 'process_identity_unknown',
      reason: error.message || String(error),
    };
  }
  if (ownerLive || runnerLive) {
    return {
      ok: false,
      reason_code: 'work_order_process_live',
      reason: 'a live owner or runner forbids stale disposition',
    };
  }
  const authorityFile = options.workOrderPath || null;
  const observeFence = (kind, file, ignore = false) => {
    if (ignore || !isStr(file) || !fs.existsSync(file)) {
      // The lock acquired for this very CAS transition is not prior authority.
      // Normalize it to absent so a pre-lock observation can be re-derived
      // byte-for-byte while the exact transition lock is held.
      return { ok: true, state: 'absent', identity_digest: null };
    }
    const parsed = readJsonStrict(file);
    if (!parsed.ok || !isCompleteIdentity(parsed.value)) {
      return {
        ok: false,
        reason_code: `${kind}_authority_unknown`,
        reason: `${kind} authority is unreadable or has incomplete process identity`,
      };
    }
    let live;
    try {
      live = isProcessLiveStrict(parsed.value);
    } catch (error) {
      return {
        ok: false,
        reason_code: `${kind}_authority_unknown`,
        reason: error.message || String(error),
      };
    }
    if (live) {
      return {
        ok: false,
        reason_code: `${kind}_live`,
        reason: `live ${kind} authority forbids stale disposition`,
      };
    }
    return {
      ok: true,
      state: 'dead',
      identity_digest: sha256Json({
        pid: parsed.value.pid,
        process_start_time: parsed.value.process_start_time,
        pgid: parsed.value.pgid,
        sid: parsed.value.sid,
      }),
    };
  };
  const mutationLock = observeFence(
    'lock',
    authorityFile ? lockPathFor(authorityFile) : null,
    options.ignoreMutationLock === true,
  );
  if (!mutationLock.ok) return mutationLock;
  const lease = observeFence(
    'lease',
    authorityFile ? leasePathFor(authorityFile) : null,
  );
  if (!lease.ok) return lease;
  const worktree = assessWorktreeClean(wo, options);
  if (worktree.clean !== true) {
    return {
      ok: false,
      reason_code: worktree.reason_code || 'worktree_unknown',
      reason: worktree.clean === false
        ? 'registered worktree is dirty'
        : 'registered worktree cleanliness is unknown',
    };
  }
  const mutation = assessUniqueCommittedMutation(wo, options);
  if (mutation.unique !== false) {
    return {
      ok: false,
      reason_code: mutation.reason_code
        || (mutation.unique === true ? 'head_ahead' : 'worktree_unknown'),
      reason: mutation.unique === true
        ? 'registered worktree has a unique committed mutation'
        : 'absence of unique committed mutation cannot be proved',
    };
  }
  let exactWorktree;
  try {
    exactWorktree = fs.realpathSync(wo.worktree);
  } catch (error) {
    return {
      ok: false,
      reason_code: 'worktree_unknown',
      reason: `registered worktree cannot be resolved: ${error.message || String(error)}`,
    };
  }
  const observation = {
    schema_version: 1,
    root_run_id: wo.root_run_id,
    work_order_id: wo.work_order_id,
    graph_node: wo.graph_node,
    attempt: wo.attempt,
    generation: wo.generation,
    work_order_digest: wo.digest,
    cas_token: wo.cas_token,
    owner_identity_digest: sha256Json(wo.owner),
    runner_state: runnerAbsent ? 'absent' : 'dead',
    runner_identity_digest: runnerAbsent ? null : sha256Json(wo.runner),
    lock_state: mutationLock.state,
    lock_identity_digest: mutationLock.identity_digest,
    lease_state: lease.state,
    lease_identity_digest: lease.identity_digest,
    worktree: exactWorktree,
    clean: true,
    unique_committed_mutation: false,
    head: mutation.head || null,
    base: mutation.base || null,
  };
  return {
    ok: true,
    observation,
    observation_digest: sha256Json(observation),
  };
}
function sameProcessIdentity(left, right) {
  return isCompleteIdentity(left)
    && isCompleteIdentity(right)
    && Number(left.pid) === Number(right.pid)
    && Number(left.process_start_time) === Number(right.process_start_time)
    && Number(left.pgid) === Number(right.pgid)
    && Number(left.sid) === Number(right.sid);
}
function validateControllerProcessParentage(parentage, owner) {
  if (!isObj(parentage)
      || parentage.schema_version !== 1
      || !sameProcessIdentity(parentage.owner, owner)
      || !Array.isArray(parentage.relationships)
      || parentage.relationships.length === 0
      || !isStr(parentage.observed_at)
      || !parentage.observed_at.endsWith('Z')
      || !Number.isFinite(Date.parse(parentage.observed_at))
      || !SHA256.test(parentage.digest || '')) {
    return {
      ok: false,
      reason_code: 'controller_parentage_invalid',
      reason: 'controller recovery requires a complete digest-bound owner/parent chain',
    };
  }
  const body = { ...parentage };
  delete body.digest;
  if (sha256Json(body) !== parentage.digest) {
    return {
      ok: false,
      reason_code: 'controller_parentage_invalid',
      reason: 'controller process parentage digest mismatch',
    };
  }
  let expectedChild = owner;
  for (const relationship of parentage.relationships) {
    if (!isObj(relationship)
        || !sameProcessIdentity(relationship.child, expectedChild)
        || !isCompleteIdentity(relationship.parent)) {
      return {
        ok: false,
        reason_code: 'controller_parentage_invalid',
        reason: 'controller process parent chain is incomplete or disconnected',
      };
    }
    expectedChild = relationship.parent;
  }
  let ownerLive;
  try {
    ownerLive = isProcessLiveStrict(owner);
  } catch (error) {
    return {
      ok: false,
      reason_code: 'process_identity_unknown',
      reason: error.message || String(error),
    };
  }
  if (ownerLive) {
    const observedParentPid = readProcessParentPid(owner.pid);
    const firstParent = parentage.relationships[0].parent;
    if (observedParentPid !== firstParent.pid
        || !sameProcessIdentity(captureProcessIdentity(observedParentPid), firstParent)) {
      return {
        ok: false,
        reason_code: 'controller_parentage_drift',
        reason: 'live controller parent relationship no longer matches the sealed chain',
      };
    }
  }
  return {
    ok: true,
    owner_live: ownerLive === true,
    relationship_count: parentage.relationships.length,
    digest: parentage.digest,
  };
}
function observeRegisteredControllerWorktree(wo, options = {}) {
  const gitCwd = options.gitCwd || wo.worktree;
  if (!isStr(gitCwd) || !isStr(wo.worktree) || !fs.existsSync(wo.worktree)) {
    return {
      ok: false,
      reason_code: 'controller_worktree_missing',
      reason: 'controller recovery requires an existing registered Work Order worktree',
    };
  }
  let expectedPath;
  let commonDir;
  let records;
  try {
    expectedPath = fs.realpathSync(wo.worktree);
    commonDir = resolveGitCommonDir(gitCwd);
    if (!isStr(commonDir) || resolveGitCommonDir(expectedPath) !== commonDir) {
      throw new Error('worktree git-common-dir does not match recovery repository');
    }
    const porcelain = execFileSync(
      'git',
      ['-C', gitCwd, 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    records = [];
    let current = null;
    for (const line of porcelain.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) records.push(current);
        current = { path: line.slice('worktree '.length), branch: null, head: null };
      } else if (current && line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length);
      } else if (current && line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line === '' && current) {
        records.push(current);
        current = null;
      }
    }
    if (current) records.push(current);
  } catch (error) {
    return {
      ok: false,
      reason_code: 'controller_worktree_observation_failed',
      reason: `controller Git worktree observation failed: ${error.message || String(error)}`,
    };
  }
  const matches = records.filter((record) => {
    try {
      return fs.realpathSync(record.path) === expectedPath;
    } catch (_error) {
      return path.resolve(record.path) === path.resolve(expectedPath);
    }
  });
  if (matches.length !== 1) {
    return {
      ok: false,
      reason_code: 'controller_worktree_registration_mismatch',
      reason: 'controller Work Order path must match exactly one registered Git worktree',
    };
  }
  const record = matches[0];
  if (isStr(wo.branch) && wo.branch !== 'HEAD' && record.branch !== wo.branch) {
    return {
      ok: false,
      reason_code: 'controller_worktree_branch_mismatch',
      reason: `registered controller branch ${record.branch || 'detached'} != ${wo.branch}`,
    };
  }
  try {
    const head = execFileSync('git', ['-C', expectedPath, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const tree = execFileSync('git', ['-C', expectedPath, 'rev-parse', 'HEAD^{tree}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const status = execFileSync('git', ['-C', expectedPath, 'status', '--porcelain=v1'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (record.head !== head) {
      return {
        ok: false,
        reason_code: 'controller_worktree_head_mismatch',
        reason: 'registered worktree HEAD disagrees with direct Git observation',
      };
    }
    if (!isStr(wo.base_sha)) {
      return {
        ok: false,
        reason_code: 'controller_base_missing',
        reason: 'controller Work Order requires an immutable frozen base for recovery',
      };
    }
    const base = execFileSync('git', ['-C', expectedPath, 'rev-parse', `${wo.base_sha}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const baseTree = execFileSync('git', ['-C', expectedPath, 'rev-parse', `${base}^{tree}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const dirty = status.length > 0;
    const unique = head !== base && tree !== baseTree;
    const observation = {
      path: expectedPath,
      git_common_dir: commonDir,
      branch: record.branch,
      head,
      tree,
      base,
      base_tree: baseTree,
      dirty,
      unique,
      status_digest: sha256Text(status),
    };
    return {
      ok: dirty === false && unique === false,
      reason_code: dirty
        ? 'controller_worktree_dirty'
        : (unique ? 'controller_worktree_unique' : null),
      reason: dirty
        ? 'dirty controller worktree remains owned and blocks automatic attach'
        : (unique
          ? 'controller worktree has unique committed mutation and requires adoption'
          : null),
      observation,
      digest: sha256Json(observation),
    };
  } catch (error) {
    return {
      ok: false,
      reason_code: 'controller_worktree_observation_failed',
      reason: `controller worktree tip/tree/status observation failed: ${error.message || String(error)}`,
    };
  }
}
function validateControllerIndexArtifact(value, {
  artifactType,
  workOrder,
  expectedEntries,
}) {
  if (!isObj(value)
      || value.schema_version !== 1
      || value.artifact_type !== artifactType
      || value.root_run_id !== workOrder.root_run_id
      || value.graph_node !== workOrder.graph_node
      || value.attempt !== workOrder.attempt
      || value.work_order_id !== workOrder.work_order_id
      || value.controller_digest !== workOrder.controller.controller_digest
      || !Array.isArray(value.entries)
      || JSON.stringify(value.entries) !== JSON.stringify(expectedEntries)
      || !isStr(value.written_at)
      || !value.written_at.endsWith('Z')
      || !Number.isFinite(Date.parse(value.written_at))) {
    return {
      ok: false,
      reason_code: 'controller_index_mismatch',
      reason: `${artifactType} does not exactly bind the current Work Order/controller entries`,
    };
  }
  return { ok: true };
}
function validateControllerRecoveryAuthority(wo, options = {}) {
  if (!isObj(wo)
      || wo.role !== 'controller'
      || !isObj(wo.controller)
      || wo.root_run_id !== options.rootRunId
      || wo.graph_node !== options.graphNode
      || wo.attempt !== options.attempt
      || (isStr(options.workOrderId) && wo.work_order_id !== options.workOrderId)) {
    return {
      ok: false,
      reason_code: 'controller_work_order_mismatch',
      reason: 'controller recovery Work Order does not match the exact root/node/attempt/id tuple',
    };
  }
  const integrity = validateStoredWorkOrderIntegrity(wo);
  if (!integrity.ok) return integrity;
  const paths = wo.paths || {};
  const digests = wo.artifact_digests || {};
  for (const key of ['durable', 'checkpoint', 'ledger', 'manifest', 'receipt']) {
    if (!isStr(paths[key]) || !isStr(digests[key])) {
      return {
        ok: false,
        reason_code: 'controller_authority_incomplete',
        reason: `controller recovery requires bound ${key} path+digest`,
      };
    }
  }
  if (!isStr(digests.ledger_history)) {
    return {
      ok: false,
      reason_code: 'controller_authority_incomplete',
      reason: 'controller recovery requires a bound rotation-aware ledger history digest',
    };
  }
  const bound = validateBoundArtifacts(wo, {
    gitCwd: options.gitCwd || wo.worktree,
    requireBoundEvidence: true,
  });
  if (!bound.ok) return bound;
  const readArtifact = (key) => {
    const loaded = readJsonStrict(paths[key]);
    if (!loaded.ok || !isObj(loaded.value)) {
      return {
        ok: false,
        reason_code: loaded.reason_code || 'controller_authority_unreadable',
        reason: loaded.reason || `controller ${key} authority is unreadable`,
      };
    }
    return { ok: true, value: loaded.value };
  };
  const durableLoaded = readArtifact('durable');
  if (!durableLoaded.ok) return durableLoaded;
  const durable = durableLoaded.value;
  if (durable.schema_version !== 1
      || durable.artifact_type !== 'controller_durable_state'
      || durable.root_run_id !== wo.root_run_id
      || durable.graph_node !== wo.graph_node
      || durable.attempt !== wo.attempt
      || durable.work_order_id !== wo.work_order_id
      || durable.campaign_id !== wo.root_run_id
      || durable.icc_campaign_id !== wo.root_run_id
      || durable.controller_digest !== wo.controller.controller_digest
      || !isStr(durable.written_at)
      || !Number.isFinite(Date.parse(durable.written_at))) {
    return {
      ok: false,
      reason_code: 'controller_durable_mismatch',
      reason: 'controller durable state does not bind the exact Work Order/controller tuple',
    };
  }
  const checkpointLoaded = readArtifact('checkpoint');
  if (!checkpointLoaded.ok) return checkpointLoaded;
  const checkpoint = checkpointLoaded.value;
  if (checkpoint.schema_version !== 1
      || checkpoint.artifact_type !== 'controller_checkpoint'
      || checkpoint.root_run_id !== wo.root_run_id
      || checkpoint.graph_node !== wo.graph_node
      || checkpoint.attempt !== wo.attempt
      || checkpoint.work_order_id !== wo.work_order_id
      || !isObj(checkpoint.controller)
      || checkpoint.controller.controller_digest !== wo.controller.controller_digest
      || JSON.stringify(checkpoint.controller) !== JSON.stringify(wo.controller)
      || !isStr(checkpoint.written_at)
      || !Number.isFinite(Date.parse(checkpoint.written_at))) {
    return {
      ok: false,
      reason_code: 'controller_checkpoint_mismatch',
      reason: 'controller checkpoint does not contain the exact current controller body',
    };
  }
  const manifestLoaded = readArtifact('manifest');
  if (!manifestLoaded.ok) return manifestLoaded;
  const manifestValidated = validateControllerIndexArtifact(manifestLoaded.value, {
    artifactType: 'controller_dispatch_manifest_index',
    workOrder: wo,
    expectedEntries: Array.isArray(wo.controller.dispatch_records)
      ? wo.controller.dispatch_records : [],
  });
  if (!manifestValidated.ok) return manifestValidated;
  const resultLoaded = readArtifact('receipt');
  if (!resultLoaded.ok) return resultLoaded;
  const resultValidated = validateControllerIndexArtifact(resultLoaded.value, {
    artifactType: 'controller_dispatch_result_index',
    workOrder: wo,
    expectedEntries: Array.isArray(wo.controller.resource_inventory)
      ? wo.controller.resource_inventory : [],
  });
  if (!resultValidated.ok) return resultValidated;
  const ledger = observeControllerLedger(paths.ledger, wo, { requireFresh: false });
  if (!ledger.ok) return ledger;
  if (ledger.history_digest !== digests.ledger_history) {
    return {
      ok: false,
      reason_code: 'controller_ledger_mismatch',
      reason: 'controller ledger history does not match Work Order authority',
    };
  }
  const parentage = validateControllerProcessParentage(
    wo.controller.process_parentage,
    wo.owner,
  );
  if (!parentage.ok) return parentage;
  if (isObj(wo.runner) && wo.runner.pid != null && !isCompleteIdentity(wo.runner)) {
    return {
      ok: false,
      reason_code: 'controller_runner_identity_incomplete',
      reason: 'controller runner identity is partially observed',
    };
  }
  const worktree = observeRegisteredControllerWorktree(wo, options);
  if (!worktree.ok) return worktree;
  const authoritySources = [
    'controller_work_order',
    'controller_durable_state',
    'controller_checkpoint',
    'rotation_aware_ledger',
    'dispatch_manifest_index',
    'dispatch_result_index',
    'process_identity_parentage',
    'git_worktree_list',
    'git_head_tree_status',
  ];
  let mission = null;
  const missionRequired = isStr(durable.mission_lineage_id)
    || isStr(durable.mission_claim_id)
    || isStr(durable.mission_graph_digest);
  if (missionRequired) {
    if (!isStr(paths.mission) || !isStr(digests.mission)) {
      return {
        ok: false,
        reason_code: 'controller_mission_authority_missing',
        reason: 'Mission-backed controller recovery requires a bound canonical Mission state',
      };
    }
    if (durable.mission_state_authority !== 'canonical_file_store') {
      return {
        ok: false,
        reason_code: 'controller_mission_authority_noncanonical',
        reason: 'controller recovery requires the canonical file-backed Mission state, not a copied snapshot',
      };
    }
    const missionLoaded = readJsonStrict(paths.mission);
    if (!missionLoaded.ok || !isObj(missionLoaded.value)) {
      return {
        ok: false,
        reason_code: 'controller_mission_authority_invalid',
        reason: missionLoaded.reason || 'canonical Mission state is unreadable',
      };
    }
    const state = missionLoaded.value;
    let stateDigest;
    try {
      const {
        stateHash,
        validateMissionState,
      } = require('./mission-convergence');
      validateMissionState(state);
      stateDigest = stateHash(state);
    } catch (error) {
      return {
        ok: false,
        reason_code: 'controller_mission_authority_invalid',
        reason: `canonical Mission state validation failed: ${error.message || String(error)}`,
      };
    }
    const claim = isObj(state.claims) ? state.claims[durable.mission_claim_id] : null;
    if (stateDigest !== durable.mission_state_digest
        || state.mission_lineage_id !== durable.mission_lineage_id
        || state.mission_policy_digest !== durable.mission_policy_digest
        || state.mission_graph_digest !== durable.mission_graph_digest
        || state.task_authority_id !== durable.task_authority_id
        || state.repo_identity !== durable.repo_identity
        || !isObj(claim)
        || claim.claim_id !== durable.mission_claim_id
        || !isStr(durable.mission_campaign_id)
        || claim.campaign_id !== durable.mission_campaign_id
        || claim.graph_node_id !== wo.graph_node
        || claim.graph_attempt !== wo.attempt
        || durable.graph_attempt !== wo.attempt
        || claim.mission_lineage_id !== durable.mission_lineage_id
        || !isObj(state.graph_progress)
        || !isObj(state.graph_progress[wo.graph_node])
        || state.graph_progress[wo.graph_node].active_claim_id !== claim.claim_id
        || claim.terminal === true
        || claim.released === true
        || claim.reconciled === true) {
      return {
        ok: false,
        reason_code: 'controller_mission_authority_mismatch',
        reason: 'Mission state/claim does not exactly bind the active controller tuple',
      };
    }
    mission = {
      state_digest: stateDigest,
      claim_id: claim.claim_id,
      campaign_id: claim.campaign_id,
      graph_node_id: claim.graph_node_id,
      graph_attempt: claim.graph_attempt,
    };
    authoritySources.push('canonical_mission_state_claim');
  }
  const observation = {
    root_run_id: wo.root_run_id,
    graph_node: wo.graph_node,
    attempt: wo.attempt,
    work_order_id: wo.work_order_id,
    work_order_digest: wo.digest,
    controller_digest: wo.controller.controller_digest,
    ledger_history_digest: ledger.history_digest,
    ledger_event_count: ledger.event_count,
    owner_live: parentage.owner_live,
    process_parentage_digest: parentage.digest,
    worktree_digest: worktree.digest,
    mission,
    authority_sources_checked: authoritySources,
  };
  return {
    ok: true,
    classification: 'attach_active',
    recovery: true,
    observation,
    observation_digest: sha256Json(observation),
    authority_sources_checked: authoritySources,
  };
}
function buildControllerTerminalReceipt({
  terminalStatus,
  rootRunId,
  workOrderId,
  graphNode,
  campaignId,
  acceptedCommit = null,
  controller,
  issuedAt = nowIso(),
} = {}) {
  if (!TERMINAL_STATUSES.has(terminalStatus)) {
    throw new Error(`unsupported controller terminal_status: ${terminalStatus || 'missing'}`);
  }
  if (![rootRunId, workOrderId, graphNode, campaignId].every(isStr)) {
    throw new Error(
      'controller terminal receipt requires root_run_id, work_order_id, graph_node, and campaign_id',
    );
  }
  if (acceptedCommit !== null && !isStr(acceptedCommit)) {
    throw new Error('controller terminal receipt accepted_commit must be a string or null');
  }
  const frozenDigest = isObj(controller)
    && isObj(controller.frozen_denominator)
    ? controller.frozen_denominator.digest : null;
  if (!isObj(controller)
      || !SHA256.test(controller.controller_digest || '')
      || !SHA256.test(frozenDigest || '')) {
    throw new Error(
      'controller terminal receipt requires digest-bound controller and frozen denominator',
    );
  }
  if (!isStr(issuedAt)
      || !issuedAt.endsWith('Z')
      || !Number.isFinite(Date.parse(issuedAt))) {
    throw new Error('controller terminal receipt issued_at must be a UTC timestamp');
  }
  const body = {
    schema_version: 1,
    artifact_type: TERMINAL_RECEIPT_ARTIFACT,
    terminal_status: terminalStatus,
    root_run_id: rootRunId,
    work_order_id: workOrderId,
    graph_node: graphNode,
    campaign_id: campaignId,
    accepted_commit: acceptedCommit,
    controller_digest: controller.controller_digest,
    frozen_denominator_digest: frozenDigest,
    issued_at: issuedAt,
  };
  return { ...body, digest: sha256Json(body) };
}
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
  if (wo.role === 'controller') {
    const keys = Object.keys(receipt);
    const controller = isObj(wo.controller) ? wo.controller : null;
    const expectedAcceptedCommit = isStr(wo.accepted_commit)
      ? wo.accepted_commit
      : (controller && isStr(controller.accepted_commit)
        ? controller.accepted_commit : null);
    const expectedFrozenDigest = controller
      && isObj(controller.frozen_denominator)
      && isStr(controller.frozen_denominator.digest)
      ? controller.frozen_denominator.digest : null;
    if (keys.length !== CONTROLLER_TERMINAL_RECEIPT_KEYS.size
        || keys.some((key) => !CONTROLLER_TERMINAL_RECEIPT_KEYS.has(key))
        || receipt.graph_node !== wo.graph_node
        || receipt.campaign_id !== wo.root_run_id
        || !controller
        || receipt.controller_digest !== controller.controller_digest
        || receipt.frozen_denominator_digest !== expectedFrozenDigest
        || receipt.accepted_commit !== expectedAcceptedCommit
        || !isStr(receipt.issued_at)
        || !receipt.issued_at.endsWith('Z')
        || !Number.isFinite(Date.parse(receipt.issued_at))) {
      return {
        ok: false,
        reason_code: 'terminal_receipt_mismatch',
        reason: 'controller terminal receipt must exactly bind controller, graph, campaign, commit, denominator, and closed fields',
      };
    }
  }
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
  const integrity = validateStoredWorkOrderIntegrity(wo);
  if (!integrity.ok) { return { classification: 'orphan_blocked', reason_code: integrity.reason_code,
      reason: integrity.reason, work_order_id: wo.work_order_id,};}
  if (wo.disposition === 'stale_dispositioned') {
    const fresh = observeStaleDispositionAuthority(wo, {
      ...options,
      ignoreMutationLock: false,
    });
    if (!fresh.ok) {
      return {
        classification: 'orphan_blocked',
        reason_code: fresh.reason_code,
        reason: fresh.reason,
        work_order_id: wo.work_order_id,
      };
    }
    return {
      classification: 'stale_dispositioned',
      reason_code: null,
      idempotent: true,
      reason: 'work order already stale_dispositioned with fresh dead/clean/no-unique authority',
      work_order_id: wo.work_order_id,
      disposition_receipt: wo.disposition_receipt,
      stale_observation_digest: fresh.observation_digest,
    };
  }
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
  const ledgerLive = ledgerLooksLive(wo.paths?.ledger, wo);
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
  if (options.autoDispositionStale !== false) {
    const fresh = observeStaleDispositionAuthority(wo, options);
    if (!fresh.ok) {
      return {
        classification: 'orphan_blocked',
        reason_code: fresh.reason_code,
        reason: fresh.reason,
        work_order_id: wo.work_order_id,
      };
    }
    return {
      classification: 'stale_dispositioned', reason_code: null,
      reason: 'owner/runner dead; worktree clean; no unique committed mutation; stale work order dispositioned',
      work_order_id: wo.work_order_id, owner_live: false, runner_live: false,
      stale_observation: fresh.observation,
      stale_observation_digest: fresh.observation_digest,
    };
  }
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
      const integrity = validateStoredWorkOrderIntegrity(wo);
      if (!integrity.ok) {
        out.push({ path: file, work_order: wo, error: {
          reason_code: integrity.reason_code,
          reason: integrity.reason,
        } });
        continue;
      }
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
  try {
    // Strict read: missing may create; malformed JSON must stop (never become null→overwrite).
    const parsed = readJsonStrict(file);
    if (!parsed.ok) {
      return {
        status: 'reject',
        reason_code: parsed.reason_code || 'work_order_unreadable',
        reason: parsed.reason || 'existing Work Order authority is unreadable JSON',
        path: file,
      };
    }
    const existing = parsed.value;
    if (!existing && options.expectedWorkOrderDigest != null) {
      return {
        status: 'reject',
        reason_code: 'cas_conflict',
        reason: 'expected existing work order is missing',
        path: file,
      };
    }
    if (existing) {
      // Never silently reseal a tampered stored Work Order / controller.
      const integrity = validateStoredWorkOrderIntegrity(existing);
      if (!integrity.ok) {
        return {
          status: 'reject',
          reason_code: integrity.reason_code,
          reason: integrity.reason,
          work_order: existing,
          path: file,
        };
      }
      // Existing controller-bearing Work Orders require full CAS on every mutation
      // (including lifecycle). Legacy applies only when controller is truly absent.
      const existingHasController = Object.prototype.hasOwnProperty.call(existing, 'controller');
      if (existingHasController) {
        if (options.expectedGeneration == null
            || options.expectedCasToken == null
            || options.expectedControllerDigest == null) {
          return {
            status: 'reject',
            reason_code: 'cas_incomplete',
            reason: 'existing controller-bearing Work Order requires expectedGeneration, expectedCasToken, and expectedControllerDigest',
            work_order: existing,
            path: file,
          };
        }
      }
      if (options.expectedGeneration != null && existing.generation !== options.expectedGeneration) {
        return {
          status: 'reject', reason_code: 'cas_conflict',
          reason: `work order generation ${existing.generation} != expected ${options.expectedGeneration}`,
          work_order: existing, path: file,
        };
      }
      if (options.expectedWorkOrderDigest != null
          && existing.digest !== options.expectedWorkOrderDigest) {
        return {
          status: 'reject',
          reason_code: 'cas_conflict',
          reason: 'work order digest CAS mismatch',
          work_order: existing,
          path: file,
        };
      }
      if (options.expectedCasToken != null && existing.cas_token !== options.expectedCasToken) {
        return {
          status: 'reject', reason_code: 'cas_conflict',
          reason: 'work order cas_token mismatch', work_order: existing, path: file,
        };
      }
      if (options.expectedControllerDigest != null) {
        const priorCtrlDigest = isObj(existing.controller)
          ? existing.controller.controller_digest : null;
        if (priorCtrlDigest !== options.expectedControllerDigest) {
          return {
            status: 'reject',
            reason_code: 'cas_conflict',
            reason: 'controller digest CAS mismatch',
            work_order: existing,
            path: file,
          };
        }
      }
    }
    const targetDisposition = fields.disposition !== undefined
      ? fields.disposition : (existing && existing.disposition);
    const targetTerminalStatus = fields.terminal_status !== undefined
      ? fields.terminal_status : (existing && existing.terminal_status);
    if (!existing
        && (targetDisposition === 'stale_dispositioned'
          || targetDisposition === 'consumed')) {
      return {
        status: 'reject',
        reason_code: 'lifecycle_transition_authority_missing',
        reason: 'a new Work Order cannot be created directly as a stale/consumed tombstone',
        path: file,
      };
    }
    if (existing
        && (existing.disposition === 'stale_dispositioned'
          || existing.disposition === 'consumed')
        && targetDisposition !== existing.disposition) {
      return {
        status: 'reject',
        reason_code: 'lifecycle_tombstone_immutable',
        reason: 'stale/consumed Work Order tombstones cannot be reopened or rewritten',
        work_order: existing,
        path: file,
      };
    }
    const enteringStale = Boolean(
      existing
      && existing.disposition !== 'stale_dispositioned'
      && targetDisposition === 'stale_dispositioned',
    );
    const enteringConsumed = Boolean(
      existing
      && existing.disposition !== 'consumed'
      && targetDisposition === 'consumed',
    );
    if (existing
        && !enteringStale
        && targetDisposition !== 'consumed'
        && isStr(targetTerminalStatus)
        && TERMINAL_STATUSES.has(targetTerminalStatus)
        && (!isStr(existing.terminal_status)
          || !TERMINAL_STATUSES.has(existing.terminal_status))) {
      return {
        status: 'reject',
        reason_code: 'terminal_transition_authority_missing',
        reason: 'entering a terminal status requires the exact consumed disposition and terminal receipt',
        work_order: existing,
        path: file,
      };
    }
    if (enteringStale) {
      const prospective = {
        ...existing,
        ...fields,
        disposition: 'stale_dispositioned',
        generation: existing.generation + (options.bumpGeneration === false ? 0 : 1),
        cas_token: existing.cas_token,
      };
      const receipt = fields.disposition_receipt;
      const validated = validateDispositionReceipt(receipt, prospective, {
        priorWorkOrder: existing,
      });
      if (!validated.ok) {
        return {
          status: 'reject',
          reason_code: validated.reason_code,
          reason: validated.reason,
          work_order: existing,
          path: file,
        };
      }
      const observed = observeStaleDispositionAuthority(existing, {
        ...options,
        workOrderPath: file,
        ignoreMutationLock: true,
      });
      if (!observed.ok) {
        return {
          status: 'reject',
          reason_code: observed.reason_code,
          reason: observed.reason,
          work_order: existing,
          path: file,
        };
      }
      if (receipt.observation_digest !== observed.observation_digest) {
        return {
          status: 'reject',
          reason_code: 'disposition_observation_mismatch',
          reason: 'stale disposition receipt does not match the fresh write-time mechanical observation',
          work_order: existing,
          path: file,
        };
      }
    }
    if (enteringConsumed
        && fields.disposition_receipt !== null
        && fields.disposition_receipt !== undefined) {
      return {
        status: 'reject',
        reason_code: 'terminal_receipt_invalid',
        reason: 'consumed transition cannot use a stale-disposition receipt',
        work_order: existing,
        path: file,
      };
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'controller') && fields.controller === null) {
      return {
        status: 'reject',
        reason_code: 'controller_null_forbidden',
        reason: 'explicit controller:null is not legacy; refuse',
        path: file,
      };
    }
    const nextGen = existing? (existing.generation || 0) + (options.bumpGeneration === false ? 0 : 1): 1;
    const base = existing ? { ...existing, ...fields } : fields;
    // When fields omit controller, preserve existing controller on the merge base.
    if (existing && !Object.prototype.hasOwnProperty.call(fields, 'controller')
        && Object.prototype.hasOwnProperty.call(existing, 'controller')) {
      base.controller = existing.controller;
    }
    const explicitOwner = isObj(fields.owner) && Number.isInteger(fields.owner.pid) ? fields.owner : null;
    const keepOwner = options.preserveOwner && existing && !options.transferOwner;
    let wo;
    try {
      wo = buildWorkOrder({...base, generation: options.forceGeneration || nextGen,
        owner: keepOwner ? existing.owner : (explicitOwner || owner),
        created_at: existing?.created_at, cas_token: options.rotateCasToken? crypto.randomBytes(16).toString('hex'): (existing?.cas_token || fields.cas_token),
      }, { bindArtifacts: options.bindArtifacts !== false });
    } catch (error) {
      return {
        status: 'reject',
        reason_code: error.code || 'incomplete_work_order',
        reason: error.message || String(error),
        path: file,
      };
    }
    const nextIntegrity = validateStoredWorkOrderIntegrity(wo);
    if (!nextIntegrity.ok) {
      return {
        status: 'reject',
        reason_code: nextIntegrity.reason_code,
        reason: nextIntegrity.reason,
        work_order: existing || null,
        path: file,
      };
    }
    if (options.updateLifecycle !== false) { wo.owner = { ...wo.owner, ...owner, kind: 'controller' };
      wo.heartbeat_at = nowIso(); wo.updated_at = wo.heartbeat_at; wo.digest = workOrderDigest(wo);}
    // Recompute digest after lifecycle owner bind (controller already in body).
    wo.digest = workOrderDigest(wo);
    writeAtomicJson(file, wo);
    if (wo.disposition === 'consumed' || wo.disposition === 'stale_dispositioned') releaseOwnedLease(file);
    else { const leaseId = isCompleteIdentity(wo.runner) && isProcessLiveStrict(wo.runner) ? wo.runner
        : (isCompleteIdentity(wo.owner) ? wo.owner : owner);
      writeOwnedLease(file, leaseId);}
    return { status: 'written', path: file, work_order: wo, created: !existing };} finally { releaseWorkOrderLock(file, lockResult.lock);}}
function updateWorkOrderLifecycle(commonDir, ref, patch = {}, options = {}) { const file = ref.path || workOrderPath(
    commonDir, ref.root_run_id, ref.graph_node || 'default', ref.attempt || 1,);
  const parsed = readJsonStrict(file);
  if (!parsed.ok) {
    return {
      status: 'reject',
      reason_code: parsed.reason_code || 'work_order_unreadable',
      reason: parsed.reason || `work order unreadable: ${file}`,
      path: file,
    };
  }
  const current = parsed.value;
  if (!current) return { status: 'reject', reason_code: 'not_found', reason: `work order not found: ${file}` };
  const owner = captureProcessIdentity(options.pid || process.pid);
  const terminalDisposition = patch.disposition === 'stale_dispositioned'
    || patch.disposition === 'consumed';
  const preserveOwner = terminalDisposition || options.preserveOwner === true;
  const fields = {...current,...patch, owner: preserveOwner? (patch.owner || current.owner): (patch.owner || {...current.owner,...owner,
        kind: patch.owner_kind || current.owner?.kind || 'controller',}),
    runner: patch.runner !== undefined ? patch.runner : current.runner, heartbeat_at: nowIso(), expected_receipt: patch.expected_receipt !== undefined
      ? patch.expected_receipt : current.expected_receipt, terminal_status: patch.terminal_status !== undefined
      ? patch.terminal_status : current.terminal_status, disposition: patch.disposition !== undefined? patch.disposition : current.disposition,};
  if (isObj(patch.paths)) fields.paths = { ...current.paths, ...patch.paths };
  const mutatesIdentity = patch.terminal_status !== undefined|| patch.disposition !== undefined|| patch.expected_receipt !== undefined
    || patch.runner !== undefined|| isObj(patch.paths)|| patch.branch !== undefined|| patch.worktree !== undefined
    || Object.prototype.hasOwnProperty.call(patch, 'controller');
  // Controller-bearing records always require full CAS (generation/token/digest).
  const hasController = Object.prototype.hasOwnProperty.call(current, 'controller')
    || Object.prototype.hasOwnProperty.call(fields, 'controller');
  return createOrUpdateWorkOrder(commonDir, fields, {...options,
    expectedGeneration: options.expectedGeneration ?? current.generation,
    expectedCasToken: options.expectedCasToken != null
      ? options.expectedCasToken
      : (hasController ? current.cas_token : options.expectedCasToken),
    expectedControllerDigest: options.expectedControllerDigest != null
      ? options.expectedControllerDigest
      : (isObj(current.controller) ? current.controller.controller_digest : options.expectedControllerDigest),
    bumpGeneration: options.bumpGeneration != null? options.bumpGeneration
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
    if (input.controllerRecovery === true) {
      const graphNode = input.graph_node || null;
      const attempt = Number(input.attempt);
      const workOrderId = input.work_order_id || null;
      if (!isStr(graphNode) || !Number.isSafeInteger(attempt) || attempt < 1
          || !isStr(workOrderId)) {
        return {
          status: 'reject',
          reason_code: 'controller_recovery_tuple_required',
          reason: 'controller recovery requires exact root/node/attempt/work_order_id',
          classifications: [],
          duplicate_dispatch: 0,
        };
      }
      const integrityFailures = entries.filter((entry) => entry.error);
      if (integrityFailures.length > 0) {
        const failure = integrityFailures[0];
        return {
          status: 'reject',
          reason_code: failure.error.reason_code || 'controller_work_order_integrity',
          reason: failure.error.reason || 'controller Work Order integrity failure',
          classifications: [],
          duplicate_dispatch: 0,
        };
      }
      const matches = entries.filter((entry) => entry.work_order
        && entry.work_order.role === 'controller'
        && entry.work_order.root_run_id === rootRunId
        && entry.work_order.graph_node === graphNode
        && entry.work_order.attempt === attempt
        && entry.work_order.work_order_id === workOrderId);
      if (matches.length !== 1) {
        return {
          status: 'reject',
          reason_code: matches.length === 0
            ? 'controller_work_order_missing'
            : 'controller_work_order_ambiguous',
          reason: matches.length === 0
            ? 'exact controller Work Order root/node/attempt/id tuple is missing'
            : 'multiple exact controller Work Orders matched recovery tuple',
          classifications: [],
          duplicate_dispatch: 0,
        };
      }
      const match = matches[0];
      const observed = validateControllerRecoveryAuthority(match.work_order, {
        rootRunId,
        graphNode,
        attempt,
        workOrderId,
        gitCwd: input.gitCwd || match.work_order.worktree,
      });
      const classification = {
        classification: observed.ok ? 'attach_active' : 'orphan_blocked',
        reason_code: observed.ok ? null : observed.reason_code,
        reason: observed.ok
          ? 'controller authority is mechanically recoverable before owner transfer'
          : observed.reason,
        recovery: observed.ok === true,
        recovery_observation_digest: observed.observation_digest || null,
        path: match.path,
        work_order_id: match.work_order.work_order_id,
        root_run_id: match.work_order.root_run_id,
        graph_node: match.work_order.graph_node,
        attempt: match.work_order.attempt,
        generation: match.work_order.generation,
        work_order_digest: match.work_order.digest,
      };
      const identity = {
        root_run_id: rootRunId,
        phase_cursor: match.work_order.phase_cursor || null,
        accepted_commit: match.work_order.accepted_commit || null,
        next_action: match.work_order.next_action || null,
      };
      const issuedAt = new Date();
      const ttl = Number.isInteger(input.ttlMs) ? input.ttlMs : RECEIPT_DEFAULT_TTL_MS;
      const authority = observed.ok
        ? observed.authority_sources_checked
        : ['controller_work_order'];
      const receipt = {
        schema_version: RECONCILE_SCHEMA,
        artifact_type: RECONCILE_ARTIFACT,
        issued_at: issuedAt.toISOString(),
        fresh_until: new Date(issuedAt.getTime() + ttl).toISOString(),
        git_common_dir: commonDir,
        root_run_id: rootRunId,
        classifications: [classification],
        identity,
        authority,
      };
      receipt.digest = reconcileReceiptDigest(receipt);
      return {
        status: observed.ok ? 'reconciled' : 'reject',
        reason_code: observed.ok ? null : observed.reason_code,
        reason: classification.reason,
        action: observed.ok ? 'attach_active' : 'orphan_blocked',
        classifications: [classification],
        identity,
        receipt,
        receipt_path: null,
        authority_sources_checked: authority,
        recovery_observation: observed.observation || null,
        duplicate_dispatch: 0,
      };
    }
    const classifications = [];
    const identity = { root_run_id: rootRunId, phase_cursor: null, accepted_commit: null, next_action: null };
    const idKeys = ['phase_cursor', 'accepted_commit', 'next_action'];
    for (const entry of entries) { const wo = entry.work_order;
      let classified = classifyWorkOrder(wo, { gitCwd: input.gitCwd || null, workOrderPath: entry.path, parseError: entry.error || null,
        terminalReceipt: input.terminalReceipts && wo ? input.terminalReceipts[wo.work_order_id] : null,
        requireBoundEvidence: input.requireBoundEvidence !== false, autoDispositionStale: input.autoDispositionStale !== false,});
      let boundWo = wo;
      if (classified.classification === 'stale_dispositioned' && wo && !classified.idempotent) { const dr = {
          schema_version: 1, artifact_type: 'work_order_disposition_receipt', disposition: 'stale_dispositioned',
          work_order_id: wo.work_order_id, root_run_id: wo.root_run_id,
          graph_node: wo.graph_node, attempt: wo.attempt, generation: wo.generation,
          work_order_digest: wo.digest || workOrderDigest(wo), cas_token: wo.cas_token,
          observation_digest: classified.stale_observation_digest, issued_at: nowIso(),};
        dr.digest = sha256Json(dr);
        const upd = updateWorkOrderLifecycle(commonDir, { path: entry.path }, {
          disposition: 'stale_dispositioned', terminal_status: wo.terminal_status || 'aborted', disposition_receipt: dr,
        }, {
          expectedGeneration: wo.generation,
          expectedCasToken: wo.cas_token,
          expectedControllerDigest: isObj(wo.controller)
            ? wo.controller.controller_digest : undefined,
          bindArtifacts: false,
          preserveOwner: true,
          gitCwd: input.gitCwd || wo.worktree || null,
        });
        if (upd.work_order) {
          boundWo = upd.work_order;
        } else {
          classified = {
            classification: 'orphan_blocked',
            reason_code: upd.reason_code || 'stale_disposition_failed',
            reason: upd.reason || 'stale disposition write rejected',
            work_order_id: wo.work_order_id,
          };
        }}
      if (classified.classification === 'consume_terminal' && wo && !classified.idempotent) {
        const upd = updateWorkOrderLifecycle(commonDir, { path: entry.path }, {
          disposition: 'consumed', terminal_status: classified.terminal_status || wo.terminal_status,
        }, {
          expectedGeneration: wo.generation,
          expectedCasToken: wo.cas_token,
          expectedControllerDigest: isObj(wo.controller)
            ? wo.controller.controller_digest : undefined,
          bindArtifacts: false,
          preserveOwner: true,
          gitCwd: input.gitCwd || wo.worktree || null,
        });
        if (upd.work_order) {
          boundWo = upd.work_order;
        } else {
          classified = {
            classification: 'orphan_blocked',
            reason_code: upd.reason_code || 'terminal_consumption_failed',
            reason: upd.reason || 'terminal consumption write rejected',
            work_order_id: wo.work_order_id,
            terminal_status: wo.terminal_status,
          };
        }}
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
    const genericAuthority = new Set(['work_order', 'artifact_binding']);
    if (classifications.some((item) => item.classification === 'attach_active')) {
      genericAuthority.add('process_identity');
      genericAuthority.add('owned_lock');
      genericAuthority.add('rotation_aware_ledger');
    }
    if (classifications.some((item) => item.classification === 'stale_dispositioned')) {
      genericAuthority.add('process_identity');
      genericAuthority.add('git_worktree_status');
    }
    if (classifications.some((item) => item.classification === 'consume_terminal')) {
      genericAuthority.add('terminal_receipt');
    }
    const receipt = { schema_version: RECONCILE_SCHEMA, artifact_type: RECONCILE_ARTIFACT, issued_at: issuedAt.toISOString(),
      fresh_until: new Date(issuedAt.getTime() + ttl).toISOString(), git_common_dir: commonDir,
      root_run_id: identity.root_run_id || rootRunId, classifications, identity,
      authority: [...genericAuthority].sort(),};
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
    const allLiveEntries = (isStr(commonDir) && isStr(rootRunId))
      ? listWorkOrders(commonDir, rootRunId) : [];
    if (options.controllerRecovery === true && allLiveEntries.some((entry) => entry.error)) {
      const failed = allLiveEntries.find((entry) => entry.error);
      return {
        ok: false,
        reason_code: failed.error.reason_code || 'work_order_integrity',
        reason: failed.error.reason || 'root contains an integrity-invalid Work Order',
      };
    }
    const liveEntries = options.controllerRecovery === true
      ? allLiveEntries.filter((entry) => entry.work_order
        && entry.work_order.role === 'controller'
        && entry.work_order.graph_node === options.graph_node
        && entry.work_order.attempt === options.attempt
        && entry.work_order.work_order_id === options.work_order_id)
      : allLiveEntries;
    if (options.controllerRecovery === true && liveEntries.length !== 1) {
      return {
        ok: false,
        reason_code: liveEntries.length === 0
          ? 'controller_work_order_missing'
          : 'controller_work_order_ambiguous',
        reason: 'controller recovery receipt must map to exactly one live Work Order tuple',
      };
    }
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
        if (!isStr(live.digest)) {
          return {
            ok: false,
            reason_code: 'work_order_digest_missing',
            reason: 'live work order digest missing',
          };
        }
        if (live.digest !== liveDig) {
          return { ok: false, reason_code: 'work_order_digest_mismatch',
            reason: 'live work order digest mismatch (tampered)', };}
        if (liveDig !== c.work_order_digest) {
          return { ok: false, reason_code: 'reconcile_receipt_stale', reason: 'receipt work_order_digest does not match live work order' };}
        // Re-classify live WO. Recovery attach is a distinct read-only mechanical
        // observation: a dead prior owner is never relabelled live, and the exact
        // observation digest must recompute before the receipt can authorize CAS
        // owner transfer.
        const reclass = c.recovery === true
          ? validateControllerRecoveryAuthority(live, {
            rootRunId,
            graphNode: c.graph_node,
            attempt: c.attempt,
            workOrderId: c.work_order_id,
            gitCwd: options.gitCwd || live.worktree || null,
          })
          : classifyWorkOrder(live, {
            gitCwd: options.gitCwd || null, workOrderPath: c.path, skipBindCheck: options.skipBindCheck === true,
            requireBoundEvidence: options.requireBoundEvidence, autoDispositionStale: false,});
        if (c.recovery === true) {
          if (reclass.ok !== true
              || reclass.classification !== c.classification
              || !SHA256.test(c.recovery_observation_digest || '')
              || reclass.observation_digest !== c.recovery_observation_digest) {
            return {
              ok: false,
              reason_code: 'reconcile_receipt_stale',
              reason: 'controller recovery observation no longer recomputes exactly',
            };
          }
          return { ok: true };
        }
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
      next_action: fields.next_action || 'dispatch', artifact_digests: fields.artifact_digests,
      expected_receipt: fields.expected_receipt || null,
      ...(Object.prototype.hasOwnProperty.call(fields, 'sealed_scope')
        ? { sealed_scope: fields.sealed_scope } : {}),
      owner,}, {
      pid: owner.pid, expectedGeneration: options.expectedGeneration, expectedCasToken: options.expectedCasToken,
      bindArtifacts: options.bindArtifacts !== false, rotateCasToken: true, preserveOwner: true, updateLifecycle: false,});
    if (written.status === 'reject') return { ...written, duplicate_dispatch: 0, action: 'fail_closed' };
    return { status: 'claimed', action: 'dispatch_new', reason_code: null,
      reason: 'CAS claimed work order for new dispatch', duplicate_dispatch: 0, work_order: written.work_order, path: written.path,};} finally {
    releaseWorkOrderLock(casFile, rootLock.lock);}}
module.exports = { WORK_ORDER_SCHEMA, WORK_ORDER_ARTIFACT, RECONCILE_ARTIFACT, RECONCILE_SCHEMA,
  TERMINAL_RECEIPT_ARTIFACT, CLASSIFICATIONS,
  TERMINAL_STATUSES, resolveGitCommonDir, workOrdersRoot, workOrderPath, reconcileReceiptPath,
  captureProcessIdentity, captureProcessParentage, isProcessLive, readProcessStartTime, readPgidSid, buildWorkOrder, workOrderDigest,
  workOrderCanonicalBody, validateControllerBinding, validateStoredWorkOrderIntegrity,
  workOrderMissingFields, createOrUpdateWorkOrder, updateWorkOrderLifecycle, listWorkOrders,
  listNonterminalWorkOrders, hasNonterminalWorkOrders, classifyWorkOrder, validateBoundArtifacts,
  validateTerminalReceipt, reconcilePostCompact, validateReconcileReceipt, reconcileReceiptDigest,
  buildControllerTerminalReceipt,
  claimDispatchCas, sha256File, sha256Json, writeAtomicJson, readJsonIfPresent, readJsonStrict,
  isTerminalWorkOrder, isNonterminalWorkOrder, isCompleteIdentity, isProcessLiveStrict,
  assessWorktreeClean, assessUniqueCommittedMutation, acquireWorkOrderLock, releaseWorkOrderLock,
  withWorkOrderLock,
  validateControllerRecoveryAuthority, observeControllerLedger, controllerLedgerHistoryDigest,
  observeRegisteredControllerWorktree, validateControllerProcessParentage,
  rootCasLockPath, leasePathFor, writeOwnedLease, releaseOwnedLease,};
