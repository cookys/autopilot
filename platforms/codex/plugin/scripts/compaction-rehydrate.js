#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { admitContinuation, buildCheckpoint, loadMatchingRunsFromManifestDir, resolveAuthoritativeIdentity, workOrder,
} = require('../src/engine/continuation-admission');
const {
  runPostCompactAdapter,
  admitHighWater,
  adoptOrphanLeaf,
} = require('../src/engine/controller-execution');
function usage(message) { if (message) process.stderr.write(`compaction-rehydrate: ${message}\n`);
  process.stderr.write( 'usage: compaction-rehydrate.js write|rehydrate|work-order|heartbeat|reconcile|admit|postcompact-adapter|high-water|adopt-orphan [options]\n',);
  process.exit(2);}
function parseArgs(argv) { const command = argv[0];
  if (!command || command === '-h' || command === '--help') usage();
  const out = { command, flags: {} };
  const multi = new Set(['matching-run']);
  const boolFlags = new Set([
    'strict-match', 'as-durable', 'require-reconcile', 'create-work-order',
    'bind-artifacts', 'mission-active', 'require-bound', 'transfer-owner',
    'probe-evidence-accepted', 'unresolved-debt', 'controller-dead',
    'already-adopted', 'leaf-committed',
    // Orphan adoption proofs: presence means explicit true; absence fails closed.
    'base-ancestry-ok', 'scope-ok', 'churn-ok',
  ]);
  for (let i = 1; i < argv.length; i += 1) { const arg = argv[i];
    if (!arg.startsWith('--')) usage(`unknown argument: ${arg}`);
    const key = arg.slice(2);
    if (boolFlags.has(key)) { out.flags[key] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) usage(`${arg} requires a value`);
    i += 1;
    if (multi.has(key)) { if (!Array.isArray(out.flags[key])) out.flags[key] = [];
      out.flags[key].push(value);} else { out.flags[key] = value;}}
  return out;}
function emit(obj, code) { process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(code);}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
function writeAtomic(outPath, value) { const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, resolved);
  return resolved;}
function readJsonFlag(flags, key, reasonCode) { if (!flags[key]) return null;
  try { return JSON.parse(fs.readFileSync(path.resolve(flags[key]), 'utf8'));} catch (error) { emit({ status: 'reject', reason_code: reasonCode,
      reason: `${key} is not readable JSON: ${error.message || String(error)}`, duplicate_dispatch: 0,}, 1);}
  return null;}
function commonOrDie(flags) { const gitCwd = flags['git-cwd'] || process.cwd();
  const commonDir = workOrder.resolveGitCommonDir(gitCwd);
  if (!commonDir) { emit({ status: 'reject', reason_code: 'git_common_dir_missing', reason: 'cannot resolve git-common-dir', duplicate_dispatch: 0,}, 1);}
  return { gitCwd, commonDir };}
function cmdWrite(flags) { if (!flags.out) usage('write requires --out');
  let checkpoint;
  try { checkpoint = buildCheckpoint({ root_run_id: flags['root-run-id'], phase_cursor: flags['phase-cursor'], accepted_commit: flags['accepted-commit'],
      next_action: flags['next-action'], project: flags.project, branch: flags.branch, stage: flags.stage, base_sha: flags['base-sha'],
      campaign_phase: flags['campaign-phase'], idempotency_key: flags['idempotency-key'],}, { durable: flags['as-durable'] === true });} catch (error) { emit({
      status: 'reject', reason_code: error.code || 'incomplete_checkpoint', reason: error.message || String(error), missing: error.missing || null,
      duplicate_dispatch: 0,}, 1);}
  emit({ status: 'written', path: writeAtomic(flags.out, checkpoint), checkpoint, duplicate_dispatch: 0,}, 0);}
function cmdRehydrate(flags) { let narrative = null;
  if (flags.narrative) { try { narrative = JSON.parse(flags.narrative); } catch (e) { usage(`--narrative is not valid JSON: ${e.message}`);}}
  const checkpoint = flags.checkpoint? readJsonFlag(flags, 'checkpoint', 'incomplete_checkpoint') : null;
  const durable = flags.durable? readJsonFlag(flags, 'durable', 'incomplete_checkpoint') : null;
  const resolved = resolveAuthoritativeIdentity({ durable, checkpoint, narrative });
  if (resolved.status === 'reject') emit({ ...resolved, duplicate_dispatch: 0 }, 1);
  const identity = resolved.identity;
  emit({ status: 'rehydrated', reason_code: null, reason: null, duplicate_dispatch: 0, root_run_id: identity.root_run_id, phase_cursor: identity.phase_cursor,
    accepted_commit: identity.accepted_commit, next_action: identity.next_action, authority: resolved.authority,
    narrative_ignored: resolved.narrative_ignored === true, rehydrated: identity,}, 0);}
function cmdWorkOrder(flags) { const { commonDir } = commonOrDie(flags);
  if (!flags['root-run-id'] || !flags['next-action']) { usage('work-order requires --root-run-id and --next-action');}
  const ownerPid = flags['owner-pid'] ? Number(flags['owner-pid']) : process.pid;
  const owner = workOrder.captureProcessIdentity(ownerPid);
  const result = workOrder.createOrUpdateWorkOrder(commonDir, { root_run_id: flags['root-run-id'], graph_node: flags['graph-node'] || flags.stage || 'default',
    attempt: flags.attempt ? Number(flags.attempt) : 1, role: flags.role || 'implementer', branch: flags.branch || null, base_sha: flags['base-sha'] || null,
    worktree: flags.worktree || null, phase_cursor: flags['phase-cursor'] || null, accepted_commit: flags['accepted-commit'] || null,
    next_action: flags['next-action'], owner, paths: { manifest: flags.manifest || null, ledger: flags.ledger || null, receipt: flags.receipt || null,
      mission: flags.mission || null, durable: flags.durable || null, checkpoint: flags.checkpoint || null,},}, { pid: ownerPid,
    expectedGeneration: flags['expected-generation'] != null? Number(flags['expected-generation']) : undefined, bindArtifacts: flags['bind-artifacts'] === true
      || Boolean(flags.durable || flags.mission || flags.ledger), preserveOwner: Boolean(flags['owner-pid']), updateLifecycle: !flags['owner-pid'],});
  emit({ ...result, duplicate_dispatch: 0 }, result.status === 'written' ? 0 : 1);}
function cmdHeartbeat(flags) { const { commonDir } = commonOrDie(flags);
  if (!flags['root-run-id']) usage('heartbeat requires --root-run-id');
  const graph = flags['graph-node'] || 'default';
  const attempt = flags.attempt ? Number(flags.attempt) : 1;
  const patch = {};
  if (flags['terminal-status']) patch.terminal_status = flags['terminal-status'];
  if (flags.disposition) patch.disposition = flags.disposition;
  if (flags['receipt-path']) { patch.expected_receipt = { path: flags['receipt-path'], digest: flags['receipt-digest'] || null, };
    patch.paths = { receipt: flags['receipt-path'] };}
  else if (flags['terminal-status'] || flags.disposition === 'consumed') {
    const file = workOrder.workOrderPath(commonDir, flags['root-run-id'], graph, attempt);
    const cur = workOrder.readJsonIfPresent(file); const prior = cur && cur.expected_receipt;
    if (cur && !(prior && prior.path && prior.digest)) {
      const st = flags['terminal-status'] || cur.terminal_status || 'failed';
      const rpath = file.replace(/\.json$/i, '.terminal-receipt.json');
      const body = { schema_version: 1, artifact_type: workOrder.TERMINAL_RECEIPT_ARTIFACT, root_run_id: cur.root_run_id,
        work_order_id: cur.work_order_id, terminal_status: st, recorded_at: new Date().toISOString() };
      const dig = workOrder.sha256Json(body); body.digest = dig;
      try { workOrder.writeAtomicJson(rpath, body); } catch (error) {
        emit({ status: 'reject', reason_code: 'terminal_receipt_missing', reason: `terminal receipt write failed: ${error.message}`, duplicate_dispatch: 0, }, 1);}
      patch.expected_receipt = { path: rpath, digest: dig, artifact_type: workOrder.TERMINAL_RECEIPT_ARTIFACT };
      patch.paths = { receipt: rpath }; if (!patch.terminal_status) patch.terminal_status = st;}}
  const ownerPid = flags['owner-pid'] ? Number(flags['owner-pid']) : process.pid;
  if (flags.runner === 'self' || flags['runner-pid']) {
    patch.runner = workOrder.captureProcessIdentity(flags['runner-pid'] ? Number(flags['runner-pid']) : ownerPid);}
  if (flags['transfer-owner'] && flags['owner-pid']) patch.owner = { ...workOrder.captureProcessIdentity(ownerPid), kind: 'controller' };
  const mutatesTerminal = Boolean(flags['terminal-status'] || flags.disposition || flags['receipt-path']);
  const result = workOrder.updateWorkOrderLifecycle(commonDir, { root_run_id: flags['root-run-id'], graph_node: graph, attempt,},
    patch, { pid: ownerPid, preserveOwner: Boolean(flags['owner-pid']) && !flags['transfer-owner'],
      transferOwner: Boolean(flags['transfer-owner']), bumpGeneration: mutatesTerminal,
      expectedGeneration: flags['expected-generation'] != null? Number(flags['expected-generation']) : undefined,});
  emit({ ...result, duplicate_dispatch: 0 }, result.status === 'written' ? 0 : 1);}
function cmdReconcile(flags) { const gitCwd = flags['git-cwd'] || process.cwd();
  if (!flags['root-run-id']) {
    emit({ status: 'reject', reason_code: 'root_run_id_required',
      reason: 'root_run_id is mandatory for exact-root PostCompact reconcile', duplicate_dispatch: 0,}, 1);}
  const durable = flags.durable ? readJsonFlag(flags, 'durable', 'incomplete_checkpoint') : null;
  const result = workOrder.reconcilePostCompact({ gitCwd, root_run_id: flags['root-run-id'], durable, receiptPath: flags['receipt-out'] || null,
    ttlMs: flags['ttl-ms'] != null ? Number(flags['ttl-ms']) : undefined, requireBoundEvidence: flags['require-bound'] === true,});
  emit(result, result.status === 'reconciled' ? 0 : 1);}
function cmdAdmit(flags) { const matchingRuns = [];
  if (Array.isArray(flags['matching-run'])) { for (const raw of flags['matching-run']) { try { matchingRuns.push(JSON.parse(raw)); } catch (e) {
        usage(`--matching-run is not valid JSON: ${e.message}`);}}}
  let narrative = null;
  if (flags.narrative) { try { narrative = JSON.parse(flags.narrative); } catch (e) { usage(`--narrative is not valid JSON: ${e.message}`);}}
  if (flags['manifest-dir']) { matchingRuns.push(...loadMatchingRunsFromManifestDir(flags['manifest-dir'], {}));}
  let terminalReceipt = null;
  if (flags['terminal-receipt']) { try { terminalReceipt = JSON.parse( fs.readFileSync(path.resolve(flags['terminal-receipt']), 'utf8'),);} catch (error) {
      emit({ status: 'reject', reason_code: 'terminal_receipt_missing', reason: `terminal receipt unreadable: ${error.message}`, duplicate_dispatch: 0,}, 1);}}
  const ownerPid = flags['owner-pid']? Number(flags['owner-pid']): (process.env.AUTOPILOT_CONTROLLER_PID
      ? Number(process.env.AUTOPILOT_CONTROLLER_PID) : process.pid);
  const result = admitContinuation({ identity: { root_run_id: flags['root-run-id'] || null, branch: flags.branch || null, stage: flags.stage || null,
      base_sha: flags['base-sha'] || null,}, checkpointPath: flags.checkpoint || null, durablePath: flags.durable || null, narrative, matchingRuns,
    requireIdentity: true, strictMatch: flags['strict-match'] === true, gitCwd: flags['git-cwd'] || null, expectedCommit: flags['expected-commit'] || null,
    requireCommitInRepo: Boolean(flags['git-cwd']), reconcileReceiptPath: flags['reconcile-receipt'] || null, terminalReceipt,
    terminalReceiptPath: flags['terminal-receipt'] || null, requireReconcile: flags['require-reconcile'] === true,
    missionActive: flags['mission-active'] === true, createWorkOrder: flags['create-work-order'] === true || flags['mission-active'] === true,
    claimWorkOrder: flags['create-work-order'] === true || Boolean(flags.durable)|| flags['mission-active'] === true,
    graph_node: flags['graph-node'] || flags.stage || 'default', attempt: flags.attempt ? Number(flags.attempt) : 1, role: flags.role || 'implementer',
    missionPath: flags.mission || null, ledgerPath: flags.ledger || null, manifestPath: flags.manifest || null,
    requireBoundEvidence: flags['require-bound'] === true || flags['mission-active'] === true,
    ownerPid, controllerPid: ownerPid,});
  emit(result, (result.status === 'reject' || result.status === 'not_found') ? 1 : 0);}
function readInventory(flags) {
  if (!flags.inventory) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(flags.inventory), 'utf8'));
    return Array.isArray(raw) ? raw : (Array.isArray(raw.resources) ? raw.resources : []);
  } catch (error) {
    emit({
      status: 'reject',
      reason_code: 'inventory_unreadable',
      reason: `inventory is not readable JSON: ${error.message || String(error)}`,
      duplicate_dispatch: 0,
    }, 1);
  }
}

// Host-neutral PostCompact adapter — same recovery gate as reconcile, plus
// resource-debt classification. Never wires production Codex hooks and never
// touches user-owned hook-probe files.
function cmdPostcompactAdapter(flags) {
  const gitCwd = flags['git-cwd'] || process.cwd();
  if (!flags['root-run-id']) {
    emit({
      status: 'reject',
      reason_code: 'root_run_id_required',
      reason: 'root_run_id is mandatory for PostCompact adapter',
      production_hook_wired: false,
      duplicate_dispatch: 0,
    }, 1);
  }
  const requestedGraphNode = flags['graph-node'] || null;
  const requestedAttempt = Number(flags.attempt);
  if (!isStr(requestedGraphNode)
      || !Number.isSafeInteger(requestedAttempt)
      || requestedAttempt < 1) {
    emit({
      status: 'reject',
      reason_code: 'controller_recovery_tuple_required',
      reason: 'PostCompact adapter requires --graph-node and positive --attempt',
      production_hook_wired: false,
      duplicate_dispatch: 0,
    }, 1);
  }
  const durable = flags.durable ? readJsonFlag(flags, 'durable', 'incomplete_checkpoint') : null;
  // Always locate the exact controller Work Order under root and reconstruct
  // owned inventory mechanically. Caller --inventory is only a digest cross-check.
  const {
    resolveGitCommonDir,
    listWorkOrders,
  } = require('../src/engine/work-order');
  const {
    reconstructOwnedInventory,
    sha256Json,
  } = require('../src/engine/controller-execution');
  const commonDir = resolveGitCommonDir(gitCwd);
  if (!commonDir) {
    emit({
      status: 'reject',
      reason_code: 'git_common_dir_missing',
      reason: 'PostCompact requires resolvable git-common-dir',
      production_hook_wired: false,
      duplicate_dispatch: 0,
    }, 1);
  }
  let controllerWo = null;
  try {
    const listed = listWorkOrders(commonDir, flags['root-run-id']);
    const integrity = listed.filter((e) => e.error);
    if (integrity.length > 0) {
      emit({
        status: 'reject',
        reason_code: integrity[0].error.reason_code || 'work_order_integrity',
        reason: integrity[0].error.reason || 'controller Work Order integrity failure',
        production_hook_wired: false,
        duplicate_dispatch: 0,
      }, 1);
    }
    const controllers = listed.filter((e) => e.work_order
      && e.work_order.role === 'controller'
      && isObj(e.work_order.controller)
      && e.work_order.graph_node === requestedGraphNode
      && e.work_order.attempt === requestedAttempt);
    // Controller recovery requires exactly one integrity-valid Work Order for
    // the requested root. Zero, multiple, malformed, or foreign records reject
    // before effects — empty classification must never fold to ready.
    if (controllers.length === 0) {
      emit({
        status: 'reject',
        reason_code: 'controller_work_order_missing',
        reason: 'PostCompact requires exactly one controller Work Order for root',
        production_hook_wired: false,
        duplicate_dispatch: 0,
      }, 1);
    }
    if (controllers.length > 1) {
      emit({
        status: 'reject',
        reason_code: 'controller_work_order_ambiguous',
        reason: 'ambiguous controller Work Orders under root',
        production_hook_wired: false,
        duplicate_dispatch: 0,
      }, 1);
    }
    controllerWo = controllers[0].work_order;
  } catch (error) {
    emit({
      status: 'reject',
      reason_code: 'controller_work_order_list_failed',
      reason: error.message || String(error),
      production_hook_wired: false,
      duplicate_dispatch: 0,
    }, 1);
  }
  const reconstructed = reconstructOwnedInventory({
    gitCwd,
    controller: controllerWo && controllerWo.controller,
    rootRunId: flags['root-run-id'],
    failClosedOnGitError: true,
  });
  if (reconstructed.ok === false) {
    emit({
      status: 'reject',
      reason_code: 'inventory_observation_failed',
      reason: reconstructed.reason || 'owned inventory reconstruction failed',
      production_hook_wired: false,
      duplicate_dispatch: 0,
      authority_sources: [
        'controller_work_order',
        'git_worktree_list',
        'git_status',
      ],
    }, 1);
  }
  if (flags.inventory) {
    const supplied = readInventory(flags);
    const suppliedDigest = sha256Json(supplied);
    const liveDigest = reconstructed.digest || sha256Json(reconstructed.inventory || []);
    if (suppliedDigest !== liveDigest) {
      emit({
        status: 'reject',
        reason_code: 'inventory_crosscheck_mismatch',
        reason: 'supplied --inventory digest does not match mechanical reconstruction',
        production_hook_wired: false,
        duplicate_dispatch: 0,
      }, 1);
    }
  }
  const adapterInput = {
    reconcileFn: (input) => workOrder.reconcilePostCompact(input),
    rootRunId: flags['root-run-id'],
    graphNode: requestedGraphNode,
    attempt: requestedAttempt,
    workOrderId: controllerWo.work_order_id,
    gitCwd,
    durable,
    workOrder: controllerWo,
    controller: controllerWo && controllerWo.controller,
    probeEvidenceAccepted: flags['probe-evidence-accepted'] === true,
    hookInvocationDigest: flags['hook-invocation-digest'] || null,
    hookTrigger: flags['hook-trigger'] || null,
    resourceInventory: reconstructed.inventory || [],
    inventoryDigest: reconstructed.digest || sha256Json(reconstructed.inventory || []),
  };
  const result = runPostCompactAdapter(adapterInput);
  // Receipt digest is sealed inside the adapter over the complete final body.
  // Never mutate authority_sources_checked (or any field) after sealing.
  if (isObj(result.receipt) && isStr(result.receipt.digest)) {
    const recomputed = sha256Json({
      ...result.receipt,
      digest: undefined,
    });
    if (recomputed !== result.receipt.digest) {
      emit({
        status: 'reject',
        reason_code: 'postcompact_receipt_digest_mismatch',
        reason: 'PostCompact receipt digest does not recompute after final body seal',
        production_hook_wired: false,
        duplicate_dispatch: 0,
      }, 1);
    }
  }
  if (flags['receipt-out'] && result.receipt) {
    writeAtomic(flags['receipt-out'], result.receipt);
  }
  emit(result, result.status === 'ready' ? 0 : 1);
}

function cmdHighWater(flags) {
  const currentOwned = flags['current-owned'] != null ? Number(flags['current-owned']) : 0;
  const highWater = flags['high-water'] != null ? Number(flags['high-water']) : 4;
  const unresolvedDebt = flags['unresolved-debt'] === true
    || flags['unresolved-debt'] === 'true'
    || flags['unresolved-debt'] === '1';
  const tempCapacityOk = flags['temp-capacity-ok'] !== 'false'
    && flags['temp-capacity-ok'] !== false
    && flags['temp-capacity-ok'] !== '0';
  const result = admitHighWater({
    currentOwned,
    highWater,
    unresolvedDebt,
    tempCapacityOk,
  });
  emit({
    status: result.ok ? 'admitted' : 'reject',
    ...result,
    branch_effects: 0,
    worktree_effects: 0,
    runner_effects: 0,
    duplicate_dispatch: 0,
  }, result.ok ? 0 : 1);
}

function parseExplicitBool(flags, key) {
  // Missing proof is never true. Require an explicit true/1/yes value.
  if (!Object.prototype.hasOwnProperty.call(flags, key)) return false;
  const raw = flags[key];
  if (raw === true || raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === false || raw === 'false' || raw === '0' || raw === 'no') return false;
  return false;
}

function cmdAdoptOrphan(flags) {
  // Mechanical adoption: exact repo + Work Order + leaf result references.
  // Boolean proof flags alone never authorize.
  if (parseExplicitBool(flags, 'controller-dead')
      || parseExplicitBool(flags, 'base-ancestry-ok')
      || parseExplicitBool(flags, 'scope-ok')
      || parseExplicitBool(flags, 'churn-ok')
      || parseExplicitBool(flags, 'already-adopted')) {
    // If ONLY booleans are provided without mechanical authorities, reject.
    if (!flags['git-cwd'] || !flags['work-order'] && !flags['work-order-path']) {
      emit({
        ok: false,
        status: 'stopped',
        reason_code: 'ADOPTION_BOOLEAN_FLAGS_NOT_AUTHORITY',
        reason: 'boolean proof flags alone never authorize orphan adoption',
        preserve_evidence: true,
        duplicate_mutation: 0,
      }, 1);
    }
  }
  const gitCwd = flags['git-cwd'] || flags.repo || null;
  if (!gitCwd) {
    emit({
      ok: false,
      status: 'stopped',
      reason_code: 'ADOPTION_AUTHORITY_MISSING',
      reason: 'adopt-orphan requires --git-cwd and Work Order + leaf authorities',
      preserve_evidence: true,
      duplicate_mutation: 0,
    }, 1);
  }
  let workOrder = null;
  const woPath = flags['work-order-path'] || flags['work-order'] || null;
  if (woPath) {
    try {
      workOrder = JSON.parse(fs.readFileSync(path.resolve(String(woPath)), 'utf8'));
    } catch (error) {
      emit({
        ok: false, status: 'stopped', reason_code: 'work_order_unreadable',
        reason: error.message || String(error), preserve_evidence: true, duplicate_mutation: 0,
      }, 1);
    }
  }
  if (!workOrder && flags['root-run-id'] && flags['graph-node']) {
    try {
      const { resolveGitCommonDir, listWorkOrders } = require('../src/engine/work-order');
      const common = resolveGitCommonDir(gitCwd);
      const entries = listWorkOrders(common, flags['root-run-id']);
      const hit = entries.find((e) => e.work_order
        && e.work_order.graph_node === flags['graph-node']
        && !e.error);
      if (hit) workOrder = hit.work_order;
    } catch (error) {
      emit({
        ok: false, status: 'stopped', reason_code: 'work_order_lookup_failed',
        reason: error.message || String(error), preserve_evidence: true, duplicate_mutation: 0,
      }, 1);
    }
  }
  if (!workOrder) {
    emit({
      ok: false, status: 'stopped', reason_code: 'ADOPTION_WO_MISSING',
      reason: 'exact Work Order required (--work-order-path or --root-run-id + --graph-node)',
      preserve_evidence: true, duplicate_mutation: 0,
    }, 1);
  }
  let leaf = null;
  if (flags['leaf-result']) {
    try {
      leaf = JSON.parse(fs.readFileSync(path.resolve(flags['leaf-result']), 'utf8'));
    } catch (error) {
      emit({
        status: 'reject',
        reason_code: 'leaf_result_unreadable',
        reason: error.message || String(error),
        duplicate_dispatch: 0,
      }, 1);
    }
  } else if (flags['leaf-commit']) {
    leaf = {
      committed: true,
      commit: flags['leaf-commit'],
    };
  }
  if (!leaf) {
    emit({
      ok: false, status: 'stopped', reason_code: 'LEAF_RESULT_AMBIGUOUS',
      reason: 'leaf result required (--leaf-result or --leaf-commit)',
      preserve_evidence: true, duplicate_mutation: 0,
    }, 1);
  }
  // Sealed scope/churn from Work Order / campaign contract only — CLI path/churn
  // overrides are not authority (must match sealed values if supplied for equality).
  const sealedScope = isObj(workOrder.sealed_scope) ? workOrder.sealed_scope : null;
  if (flags['allow-paths'] || flags['max-changed-files'] != null || flags['max-diff-lines'] != null) {
    let allowPaths = null;
    if (flags['allow-paths']) {
      try {
        allowPaths = JSON.parse(flags['allow-paths']);
      } catch (_e) {
        allowPaths = String(flags['allow-paths']).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    const cliScope = {
      allow_paths: allowPaths,
      max_files: flags['max-changed-files'] != null ? Number(flags['max-changed-files']) : null,
      max_diff_lines: flags['max-diff-lines'] != null ? Number(flags['max-diff-lines']) : null,
    };
    if (sealedScope) {
      // Require byte-for-byte equality with sealed scope when CLI restates it.
      const sealedPaths = Array.isArray(sealedScope.allow_paths)
        ? [...sealedScope.allow_paths].sort().join('\0') : '';
      const cliPaths = Array.isArray(cliScope.allow_paths)
        ? [...cliScope.allow_paths].sort().join('\0') : '';
      if ((cliPaths && cliPaths !== sealedPaths)
          || (cliScope.max_files != null
            && cliScope.max_files !== sealedScope.max_files)
          || (cliScope.max_diff_lines != null
            && cliScope.max_diff_lines !== sealedScope.max_diff_lines)) {
        emit({
          ok: false,
          status: 'stopped',
          reason_code: 'ADOPTION_SCOPE_OVERRIDE_REJECTED',
          reason: 'CLI scope/churn must match sealed Work Order authority exactly',
          preserve_evidence: true,
          duplicate_mutation: 0,
        }, 1);
      }
    } else {
      // No sealed scope on WO: CLI cannot invent authority.
      emit({
        ok: false,
        status: 'stopped',
        reason_code: 'ADOPTION_SCOPE_NOT_SEALED',
        reason: 'orphan adoption requires sealed_scope on the Work Order; CLI cannot supply it',
        preserve_evidence: true,
        duplicate_mutation: 0,
      }, 1);
    }
  }
  const result = adoptOrphanLeaf({
    gitCwd: path.resolve(String(gitCwd)),
    workOrder,
    leafResult: leaf,
    branch: flags.branch || workOrder.branch || null,
    baseSha: flags['base-sha'] || workOrder.base_sha || null,
    sealedScope,
    leafWorktree: flags['leaf-worktree'] || leaf.worktree || workOrder.worktree || null,
  });
  emit({
    ...result,
    duplicate_mutation: result.duplicate_mutation || 0,
  }, result.ok ? 0 : 1);
}

function main(argv) { const parsed = parseArgs(argv);
  switch (parsed.command) { case 'write': return cmdWrite(parsed.flags);
    case 'rehydrate': return cmdRehydrate(parsed.flags);
    case 'work-order': return cmdWorkOrder(parsed.flags);
    case 'heartbeat': return cmdHeartbeat(parsed.flags);
    case 'reconcile': return cmdReconcile(parsed.flags);
    case 'admit': return cmdAdmit(parsed.flags);
    case 'postcompact-adapter': return cmdPostcompactAdapter(parsed.flags);
    case 'high-water': return cmdHighWater(parsed.flags);
    case 'adopt-orphan': return cmdAdoptOrphan(parsed.flags);
    default: usage(`unknown command: ${parsed.command}`);}}
if (require.main === module) main(process.argv.slice(2));
module.exports = {
  main, cmdWrite, cmdRehydrate, cmdWorkOrder, cmdHeartbeat, cmdReconcile, cmdAdmit,
  cmdPostcompactAdapter, cmdHighWater, cmdAdoptOrphan,
};
