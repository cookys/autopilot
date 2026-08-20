'use strict';

/**
 * sealed-zero-diff-validator.js — single production validator for sealed
 * zero-diff receipts (D2 A06).
 *
 * Consumed by:
 *   - scripts/dispatch-contract.js (contract preflight)
 *   - src/engine/campaign-dispatch-projection.js (engine projection)
 *   - scripts/dispatch-hetero.sh (strict admission / postcheck via CLI)
 *
 * Modes:
 *   validateReceipt(receipt, context) → { ok: true, receipt } | { ok: false, code, errors }
 *   CLI: node sealed-zero-diff-validator.js validate --receipt <json|path> [--contract <path>]
 *        [--base <sha>] [--repo <dir>] [--verify-bytes]
 */

const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');

const SHA256 = /^[0-9a-f]{64}$/;
const GIT40 = /^[0-9a-f]{40}$/;

const ZERO_DIFF_RECEIPT_KEYS = [
  'schema_version',
  'artifact_type',
  'base_sha',
  'acceptance_digest',
  'campaign_contract_digest',
  'strict_dispatch_digest',
  'campaign_id',
  'mission_lineage_id',
  'mission_policy_digest',
  'mission_graph_digest',
  'graph_node_id',
  'mission_noop_receipt_digest',
  'source_work_order_id',
  'source_work_order_digest',
  'path_byte_digests',
  'candidate_zero_change',
  'digest',
];

const ARTIFACT_TYPES = new Set([
  'campaign_zero_diff_receipt',
  'controller_zero_diff_receipt',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

/**
 * Validate a sealed zero-diff receipt.
 *
 * @param {object} receipt
 * @param {object} [context]
 * @param {object} [context.campaignProjection] — campaign_projection fields to bind
 * @param {Array}  [context.acceptance] — contract.acceptance entries
 * @param {string[]} [context.requiredChangePaths]
 * @param {string[]} [context.outputPaths]
 * @param {string} [context.base] — expected base_sha
 * @param {string} [context.repo] — if set with verifyBytes, check path digests via git show
 * @param {boolean} [context.verifyBytes]
 * @param {string} [context.missionNoopReceiptDigest]
 * @param {string} [context.missionNoopGraphNode]
 * @param {'errors'|'throw'|'code'} [context.mode='code']
 * @returns {{ok:true,receipt:object}|{ok:false,code:string,errors:string[]}}
 */
function validateReceipt(receipt, context = {}) {
  const errors = [];
  const fail = (code, msg) => {
    if (msg) errors.push(msg);
    return { ok: false, code, errors: errors.length ? errors : [code] };
  };

  if (!isPlainObject(receipt)) {
    return fail('bad_shape', 'zeroDiffReceipt must be an object');
  }

  const actualKeys = Object.keys(receipt).sort();
  const expectedKeys = [...ZERO_DIFF_RECEIPT_KEYS].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    return fail('bad_shape', 'zeroDiffReceipt fields do not match the frozen schema');
  }

  if (receipt.schema_version !== 1) {
    return fail('bad_shape', 'zeroDiffReceipt.schema_version must be 1');
  }
  if (!ARTIFACT_TYPES.has(receipt.artifact_type)) {
    return fail('bad_shape', 'zeroDiffReceipt.artifact_type unsupported');
  }
  if (receipt.candidate_zero_change !== true) {
    return fail('bad_shape', 'zeroDiffReceipt.candidate_zero_change must be true');
  }
  if (!nonEmptyString(receipt.base_sha) || !GIT40.test(receipt.base_sha)) {
    return fail('bad_shape', 'zeroDiffReceipt.base_sha must be 40-hex git object id');
  }
  if (!nonEmptyString(receipt.digest) || !SHA256.test(receipt.digest)) {
    return fail('bad_shape', 'zeroDiffReceipt.digest must be 64-hex sha256');
  }

  for (const field of [
    'acceptance_digest',
    'campaign_contract_digest',
    'strict_dispatch_digest',
    'mission_policy_digest',
    'mission_graph_digest',
    'mission_noop_receipt_digest',
    'source_work_order_digest',
  ]) {
    if (!nonEmptyString(receipt[field]) || !SHA256.test(receipt[field])) {
      return fail('bad_shape', `zeroDiffReceipt.${field} must be 64-hex sha256`);
    }
  }
  for (const field of [
    'campaign_id',
    'mission_lineage_id',
    'graph_node_id',
    'source_work_order_id',
  ]) {
    if (!nonEmptyString(receipt[field])) {
      return fail('bad_shape', `zeroDiffReceipt.${field} must be non-empty string`);
    }
  }

  if (!isPlainObject(receipt.path_byte_digests)) {
    return fail('bad_shape', 'zeroDiffReceipt.path_byte_digests must be an object');
  }

  const body = { ...receipt };
  delete body.digest;
  if (sha256Json(body) !== receipt.digest) {
    return fail('forged', 'zeroDiffReceipt digest mismatch');
  }

  if (context.base && receipt.base_sha !== context.base) {
    return fail('stale_base', 'zeroDiffReceipt.base_sha does not match context.base');
  }

  const projection = context.campaignProjection || context.projection || {};
  if (isPlainObject(projection) && Object.keys(projection).length > 0) {
    for (const [receiptKey, projectionKey, code] of [
      ['campaign_id', 'campaign_id', 'foreign_campaign'],
      ['campaign_contract_digest', 'campaign_contract_sha256', 'foreign_contract'],
      ['strict_dispatch_digest', 'strict_dispatch_sha256', 'foreign_strict'],
      ['mission_lineage_id', 'mission_lineage_id', 'foreign_lineage'],
      ['mission_policy_digest', 'mission_policy_digest', 'foreign_policy'],
      ['mission_graph_digest', 'mission_graph_digest', 'foreign_graph'],
      ['graph_node_id', 'graph_node_id', 'foreign_node'],
    ]) {
      if (Object.prototype.hasOwnProperty.call(projection, projectionKey)
          && receipt[receiptKey] !== projection[projectionKey]) {
        return fail(code, `zeroDiffReceipt.${receiptKey} does not bind campaign_projection`);
      }
    }
  }

  if (context.missionNoopReceiptDigest
      && receipt.mission_noop_receipt_digest !== context.missionNoopReceiptDigest) {
    return fail('foreign_mission_noop', 'mission_noop_receipt_digest mismatch');
  }
  if (context.missionNoopGraphNode
      && receipt.graph_node_id !== context.missionNoopGraphNode) {
    return fail('foreign_marker_node', 'graph_node_id does not match mission noop marker');
  }

  if (Array.isArray(context.acceptance)) {
    const acceptance = context.acceptance.map((entry) => ({
      argv: entry.argv,
      exit: entry.exit,
    }));
    if (sha256Json(acceptance) !== receipt.acceptance_digest) {
      return fail('acceptance_mismatch', 'zeroDiffReceipt.acceptance_digest mismatch');
    }
  }

  // When callers supply path lists (including empty), enforce exact set parity.
  if (Array.isArray(context.requiredChangePaths) || Array.isArray(context.outputPaths)) {
    const required = Array.isArray(context.requiredChangePaths) ? context.requiredChangePaths : [];
    const outputs = Array.isArray(context.outputPaths) ? context.outputPaths : [];
    const relevant = [...new Set([...required, ...outputs])].sort();
    const receiptPaths = Object.keys(receipt.path_byte_digests).sort();
    if (JSON.stringify(receiptPaths) !== JSON.stringify(relevant)) {
      return fail('path_set_mismatch', 'zeroDiffReceipt path-byte set does not match sealed output paths');
    }
  }

  for (const [relativePath, digest] of Object.entries(receipt.path_byte_digests)) {
    if (!nonEmptyString(digest) || !SHA256.test(digest)) {
      return fail(
        'bad_shape',
        `zeroDiffReceipt.path_byte_digests.${relativePath} must be 64-hex sha256`,
      );
    }
  }

  if (context.verifyBytes && context.repo && nonEmptyString(context.base || receipt.base_sha)) {
    const baseSha = context.base || receipt.base_sha;
    for (const relativePath of Object.keys(receipt.path_byte_digests).sort()) {
      let bytes;
      try {
        bytes = execFileSync('git', [
          '-C', context.repo, 'show', `${baseSha}:${relativePath}`,
        ], { encoding: null, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (_err) {
        return fail('path_missing', `path missing at base: ${relativePath}`);
      }
      if (sha256Bytes(bytes) !== receipt.path_byte_digests[relativePath]) {
        return fail('byte_digest_mismatch', `byte digest mismatch: ${relativePath}`);
      }
    }
  }

  // Postcheck mode: recompute digests from a live worktree (zero-change candidate).
  if (context.verifyWorktree && nonEmptyString(context.worktree)) {
    const pathMod = require('path');
    for (const relativePath of Object.keys(receipt.path_byte_digests).sort()) {
      const abs = pathMod.join(context.worktree, relativePath);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return fail('path_missing', `path missing in worktree: ${relativePath}`);
      }
      const live = sha256Bytes(fs.readFileSync(abs));
      if (live !== receipt.path_byte_digests[relativePath]) {
        return fail('byte_digest_mismatch', `worktree byte digest mismatch: ${relativePath}`);
      }
    }
  }

  if (context.mode === 'throw' && errors.length) {
    throw new TypeError(errors[0]);
  }

  return { ok: true, receipt: JSON.parse(JSON.stringify(receipt)), code: 'ok', errors: [] };
}

/**
 * Throw-mode wrapper matching campaign-dispatch-projection::validateZeroDiffReceipt.
 */
function validateZeroDiffReceipt(receipt, context = {}) {
  const result = validateReceipt(receipt, {
    ...context,
    campaignProjection: context.campaignProjection,
    acceptance: context.acceptance,
    requiredChangePaths: context.requiredChangePaths,
    outputPaths: context.outputPaths,
    base: context.base,
  });
  if (!result.ok) {
    throw new TypeError(result.errors[0] || result.code || 'zeroDiffReceipt invalid');
  }
  return result.receipt;
}

/**
 * Accumulate-errors wrapper for dispatch-contract.js validateSchema.
 * Pushes human-readable errors into the provided errors array; returns boolean ok.
 */
function validateZeroDiffReceiptForContract(receipt, contract, errors) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    errors.push('output.zero_diff_receipt: expected object');
    return false;
  }
  const projection = contract.campaign_projection || {};
  const outputPaths = Array.isArray(contract.output && contract.output.paths)
    ? contract.output.paths : [];
  const requiredPaths = Array.isArray(contract.output && contract.output.required_change_paths)
    ? contract.output.required_change_paths : [];
  const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];

  const result = validateReceipt(receipt, {
    campaignProjection: projection,
    acceptance,
    requiredChangePaths: requiredPaths,
    outputPaths,
  });
  if (result.ok) return true;
  for (const msg of result.errors) {
    const prefixed = msg.startsWith('output.zero_diff_receipt')
      ? msg
      : `output.zero_diff_receipt: ${msg}`;
    errors.push(prefixed);
  }
  return false;
}

// CLI entry for shell consumers (dispatch-hetero.sh)
function main(argv) {
  const args = argv.slice(2);
  if (args[0] === 'validate' || args[0] === '--validate') {
    let receiptPath = null;
    let contractPath = null;
    let base = null;
    let repo = null;
    let worktree = null;
    let verifyBytes = false;
    let verifyWorktree = false;
    let printOk = false;
    let missionNoopDigest = '';
    let missionNoopNode = '';
    for (let i = 1; i < args.length; i += 1) {
      const a = args[i];
      if (a === '--receipt') receiptPath = args[++i];
      else if (a === '--contract') contractPath = args[++i];
      else if (a === '--base') base = args[++i];
      else if (a === '--repo') repo = args[++i];
      else if (a === '--worktree') { worktree = args[++i]; verifyWorktree = true; }
      else if (a === '--verify-bytes') verifyBytes = true;
      else if (a === '--print-ok') printOk = true;
      else if (a === '--mission-noop-digest') missionNoopDigest = args[++i];
      else if (a === '--mission-noop-node') missionNoopNode = args[++i];
    }
    if (!receiptPath && !contractPath) {
      process.stderr.write('usage: sealed-zero-diff-validator.js validate --receipt <file> | --contract <file>\n');
      process.exit(2);
    }
    let receipt;
    let contract = null;
    if (contractPath) {
      contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
      receipt = contract && contract.output && contract.output.zero_diff_receipt;
      if (!receipt) {
        // Canonical soft-no-op token for dispatch-hetero equality branch
        // (must match the `missing_sealed_receipt` exclusion there — not a
        // fail-closed forged/stale/foreign rejection).
        process.stdout.write('missing_sealed_receipt');
        process.exit(3);
      }
    } else {
      receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    }
    const context = {
      base: base || undefined,
      repo: repo || undefined,
      worktree: worktree || undefined,
      verifyBytes,
      verifyWorktree,
      missionNoopReceiptDigest: missionNoopDigest || undefined,
      missionNoopGraphNode: missionNoopNode || undefined,
    };
    if (contract) {
      context.campaignProjection = contract.campaign_projection || {};
      context.acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : [];
      context.requiredChangePaths = Array.isArray(contract.output && contract.output.required_change_paths)
        ? contract.output.required_change_paths : [];
      context.outputPaths = Array.isArray(contract.output && contract.output.paths)
        ? contract.output.paths : [];
    }
    const result = validateReceipt(receipt, context);
    if (result.ok) {
      process.stdout.write(printOk ? 'ok' : receipt.digest);
      process.exit(0);
    }
    process.stdout.write(result.code || 'verify_failed');
    process.exit(2);
  }
  process.stderr.write('usage: sealed-zero-diff-validator.js validate ...\n');
  process.exit(2);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  ZERO_DIFF_RECEIPT_KEYS,
  ARTIFACT_TYPES,
  validateReceipt,
  validateZeroDiffReceipt,
  validateZeroDiffReceiptForContract,
  sha256Json,
  sha256Bytes,
};
