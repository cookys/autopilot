#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED_D3_CLAIM_IDS = Object.freeze([
  'cap-v1-430668690653dfaa807c370070e20db0cae56634bdbeb1af14ffadef7a72c992',
  'cap-v1-9a47acdde2782ec994dab242cd49e89fd91e07119b192ffc79bfacfe380fe1d3',
  'cap-v1-e29582334b4a6d781ab7afd726cc5e9e182ac557ef35df3cba9dd193c8215913',
  'cap-v1-fc256b975399387ae0c903f2700c449dc90ea8949d9c669bab9523c28683931e',
]);
const PAYLOAD_KEYS = Object.freeze([
  'cwd',
  'hook_event_name',
  'model',
  'session_id',
  'transcript_path',
  'trigger',
  'turn_id',
]);
const MAX_PAYLOAD_BYTES = 64 * 1024;

function block(code, message) {
  process.stderr.write(`post-compact: ${code}: ${message}\n`);
  process.exit(2);
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function topLevelObjectKeys(text) {
  const keys = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let expectingKey = false;
  let stringStart = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
        if (depth === 1 && expectingKey) {
          const raw = text.slice(stringStart, index + 1);
          keys.push(JSON.parse(raw));
          expectingKey = false;
        }
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      stringStart = index;
    } else if (char === '{') {
      depth += 1;
      if (depth === 1) expectingKey = true;
    } else if (char === '}') {
      depth -= 1;
    } else if (depth === 1 && char === ',') {
      expectingKey = true;
    } else if (depth === 1 && char === ':') {
      expectingKey = false;
    }
  }
  return keys;
}

function validateClaims(pluginRoot) {
  const validator = path.join(pluginRoot, 'scripts', 'platform-capability-claims.js');
  const receipt = process.env.AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT
    ? path.resolve(process.env.AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT)
    : path.join(
      pluginRoot,
      'docs',
      'projects',
      '2026-08-04-platform-capability-trigger-activation',
      'evidence',
      'platform-capabilities.json',
    );
  const validation = spawnSync(process.execPath, [
    validator,
    'validate-consumer',
    '--receipt', receipt,
    '--consumer', 'D3',
    '--emit-claim-ids',
    '--reprobe',
  ], { encoding: 'utf8', cwd: pluginRoot });
  if (validation.status !== 0) {
    block('d3_claim_validation_failed', 'exact D3 capability claims did not revalidate');
  }
  let emitted;
  try {
    emitted = JSON.parse(String(validation.stdout || '').trim());
  } catch (_error) {
    block('d3_claim_output_invalid', 'D3 claim validator did not emit a JSON array');
  }
  if (!Array.isArray(emitted)
      || JSON.stringify(emitted) !== JSON.stringify(REQUIRED_D3_CLAIM_IDS)) {
    block('d3_claim_set_mismatch', 'implemented Codex contracts differ from canonical D3 claim IDs');
  }
}

function readPayload() {
  const chunks = [];
  let size = 0;
  const fd = 0;
  const buffer = Buffer.alloc(8192);
  for (;;) {
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
    if (bytes === 0) break;
    size += bytes;
    if (size > MAX_PAYLOAD_BYTES) block('invalid_payload', 'payload exceeds 64 KiB');
    chunks.push(Buffer.from(buffer.subarray(0, bytes)));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_error) {
    block('invalid_payload', 'payload is not valid JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    block('invalid_payload', 'payload must be an object');
  }
  const lexicalKeys = topLevelObjectKeys(raw);
  if (new Set(lexicalKeys).size !== lexicalKeys.length) {
    block('invalid_payload', 'payload contains duplicate fields');
  }
  const actualKeys = Object.keys(payload).sort();
  const requiredKeys = [...PAYLOAD_KEYS].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(requiredKeys)) {
    block('invalid_payload', 'payload fields do not match the official PostCompact contract');
  }
  for (const key of ['cwd', 'hook_event_name', 'model', 'session_id', 'turn_id', 'trigger']) {
    if (typeof payload[key] !== 'string' || payload[key].length === 0) {
      block('invalid_payload', `${key} must be a non-empty string`);
    }
  }
  if (payload.transcript_path !== null
      && (typeof payload.transcript_path !== 'string' || payload.transcript_path.length === 0)) {
    block('invalid_payload', 'transcript_path must be a non-empty string or null');
  }
  if (payload.hook_event_name !== 'PostCompact') {
    block('invalid_payload', 'hook_event_name must equal PostCompact');
  }
  if (payload.trigger !== 'manual' && payload.trigger !== 'auto') {
    block('invalid_payload', 'trigger must equal manual or auto');
  }
  return payload;
}

function gitOutput(args, cwd) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) block('git_identity_unavailable', 'cannot resolve PostCompact Git identity');
  return String(result.stdout || '').trim();
}

function resolveControllerIdentity(pluginRoot, cwd) {
  const workOrder = require(path.join(pluginRoot, 'src', 'engine', 'work-order'));
  let eventCwd;
  try {
    eventCwd = fs.realpathSync(cwd);
  } catch (_error) {
    block('invalid_identity', 'payload cwd does not resolve');
  }
  const gitRoot = fs.realpathSync(gitOutput(['rev-parse', '--show-toplevel'], eventCwd));
  const commonDir = fs.realpathSync(workOrder.resolveGitCommonDir(gitRoot));
  const registry = workOrder.workOrdersRoot(commonDir);
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(registry, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') block('controller_identity_missing', 'no durable Work Order registry exists');
    block('controller_identity_unreadable', 'durable Work Order registry is unreadable');
  }
  const rootIds = new Set();
  for (const rootEntry of rootEntries) {
    if (!rootEntry.isDirectory()) continue;
    const rootDirectory = path.join(registry, rootEntry.name);
    for (const fileEntry of fs.readdirSync(rootDirectory, { withFileTypes: true })) {
      if (!fileEntry.isFile() || !/-a[1-9][0-9]*\.json$/.test(fileEntry.name)) continue;
      const loaded = workOrder.readJsonStrict(path.join(rootDirectory, fileEntry.name));
      if (!loaded.ok || !loaded.value) {
        block('controller_identity_unreadable', 'a candidate Work Order is unreadable');
      }
      if (loaded.value.artifact_type === workOrder.WORK_ORDER_ARTIFACT
          && typeof loaded.value.root_run_id === 'string') {
        rootIds.add(loaded.value.root_run_id);
      }
    }
  }
  const candidates = [];
  for (const rootRunId of rootIds) {
    let records;
    try {
      records = workOrder.listWorkOrders(commonDir, rootRunId);
    } catch (_error) {
      block('controller_identity_unreadable', 'Work Order listing failed integrity validation');
    }
    if (records.some((record) => record.error)) {
      block('controller_identity_unreadable', 'Work Order integrity validation failed');
    }
    for (const record of records) {
      const candidate = record.work_order;
      if (!candidate || candidate.role !== 'controller' || typeof candidate.worktree !== 'string') continue;
      let candidateWorktree;
      try {
        candidateWorktree = fs.realpathSync(candidate.worktree);
      } catch (_error) {
        continue;
      }
      if (candidateWorktree === gitRoot) candidates.push(candidate);
    }
  }
  if (candidates.length !== 1) {
    block(
      candidates.length === 0 ? 'controller_identity_missing' : 'controller_identity_ambiguous',
      'PostCompact requires exactly one controller Work Order for the current worktree',
    );
  }
  const identity = candidates[0];
  if (identity.root_run_id.length === 0
      || identity.graph_node.length === 0
      || !Number.isSafeInteger(identity.attempt)
      || identity.attempt < 1) {
    block('controller_identity_invalid', 'controller root/node/attempt identity is incomplete');
  }
  return { commonDir, gitRoot, workOrder, identity };
}

function run() {
  const pluginRootRaw = process.env.PLUGIN_ROOT;
  if (!pluginRootRaw) block('plugin_root_missing', 'PLUGIN_ROOT is required');
  let pluginRoot;
  try {
    pluginRoot = fs.realpathSync(pluginRootRaw);
  } catch (_error) {
    block('plugin_root_invalid', 'PLUGIN_ROOT does not resolve');
  }
  validateClaims(pluginRoot);
  const payload = readPayload();
  const resolved = resolveControllerIdentity(pluginRoot, payload.cwd);
  const invocationDigest = sha256Json({
    session_id: payload.session_id,
    turn_id: payload.turn_id,
    trigger: payload.trigger,
  });
  const adapter = path.join(pluginRoot, 'scripts', 'compaction-rehydrate.js');
  const child = spawnSync(process.execPath, [
    adapter,
    'postcompact-adapter',
    '--git-cwd', resolved.gitRoot,
    '--root-run-id', resolved.identity.root_run_id,
    '--graph-node', resolved.identity.graph_node,
    '--attempt', String(resolved.identity.attempt),
    '--hook-invocation-digest', invocationDigest,
    '--hook-trigger', payload.trigger,
  ], { encoding: 'utf8', cwd: resolved.gitRoot });
  if (child.status !== 0) {
    block('reconcile_failed', 'shared PostCompact reconciliation authority rejected');
  }
  let result;
  try {
    result = JSON.parse(String(child.stdout || '').trim());
  } catch (_error) {
    block('adapter_output_invalid', 'shared PostCompact adapter returned invalid output');
  }
  const receipt = result?.reconcile?.receipt;
  const receiptPath = result?.reconcile?.receipt_path;
  if (result?.status !== 'ready'
      || receipt?.hook_invocation_digest !== invocationDigest
      || receipt?.hook_trigger !== payload.trigger
      || typeof receiptPath !== 'string') {
    block('reconcile_receipt_invalid', 'shared PostCompact adapter did not return the exact sealed hook receipt');
  }
  const persisted = resolved.workOrder.readJsonStrict(receiptPath);
  const validated = persisted.ok
    ? resolved.workOrder.validateReconcileReceipt(persisted.value, {
      root_run_id: resolved.identity.root_run_id,
      commonDir: resolved.commonDir,
    }) : { ok: false };
  if (!validated.ok
      || persisted.value.digest !== receipt.digest
      || persisted.value.hook_invocation_digest !== invocationDigest) {
    block('reconcile_receipt_invalid', 'persisted reconciliation receipt failed validation');
  }
}

run();
