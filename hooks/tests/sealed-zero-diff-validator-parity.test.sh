#!/usr/bin/env bash
# sealed-zero-diff-validator-parity.test.sh — D2 A06 corpus parity across the
# three production consumers of the shared sealed zero-diff validator:
#   1. src/engine/sealed-zero-diff-validator.js (canonical)
#   2. src/engine/campaign-dispatch-projection.js::validateZeroDiffReceipt
#   3. scripts/dispatch-contract.js (via validateZeroDiffReceiptForContract)
# Plus CLI-mode used by scripts/dispatch-hetero.sh admission/postcheck.
. "$(dirname "$0")/lib.sh"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.argv[2];
const {
  validateReceipt,
  validateZeroDiffReceipt,
  validateZeroDiffReceiptForContract,
  sha256Json,
} = require(path.join(root, 'src', 'engine', 'sealed-zero-diff-validator'));
const projection = require(path.join(root, 'src', 'engine', 'campaign-dispatch-projection'));

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildValidReceipt(overrides = {}) {
  const acceptance = [{ argv: ['true'], exit: 0 }];
  const acceptanceDigest = sha256Json(acceptance.map((e) => ({ argv: e.argv, exit: e.exit })));
  const pathDigests = { 'docs/README.md': sha('hello') };
  const body = {
    schema_version: 1,
    artifact_type: 'campaign_zero_diff_receipt',
    base_sha: 'a'.repeat(40),
    acceptance_digest: acceptanceDigest,
    campaign_contract_digest: 'b'.repeat(64),
    strict_dispatch_digest: 'c'.repeat(64),
    campaign_id: 'campaign-v1-' + 'd'.repeat(64),
    mission_lineage_id: 'lineage-v1-' + 'e'.repeat(64),
    mission_policy_digest: 'f'.repeat(64),
    mission_graph_digest: '1'.repeat(64),
    graph_node_id: 'next-touch-debt-retirement',
    mission_noop_receipt_digest: '2'.repeat(64),
    source_work_order_id: 'wo-1',
    source_work_order_digest: '3'.repeat(64),
    path_byte_digests: pathDigests,
    candidate_zero_change: true,
    ...overrides,
  };
  delete body.digest;
  const digest = sha256Json(body);
  return { ...body, digest };
}

const projectionCtx = {
  base: 'a'.repeat(40),
  campaignProjection: {
    campaign_id: 'campaign-v1-' + 'd'.repeat(64),
    campaign_contract_sha256: 'b'.repeat(64),
    strict_dispatch_sha256: 'c'.repeat(64),
    mission_lineage_id: 'lineage-v1-' + 'e'.repeat(64),
    mission_policy_digest: 'f'.repeat(64),
    mission_graph_digest: '1'.repeat(64),
    graph_node_id: 'next-touch-debt-retirement',
  },
  acceptance: [{ argv: ['true'], exit: 0 }],
  requiredChangePaths: [],
  outputPaths: ['docs/README.md'],
};

const contract = {
  campaign_projection: projectionCtx.campaignProjection,
  acceptance: projectionCtx.acceptance,
  output: {
    paths: ['docs/README.md'],
    required_change_paths: [],
    zero_diff_receipt: null,
  },
};

function verdictsFor(receipt) {
  const shared = validateReceipt(receipt, projectionCtx);
  let projOk = true;
  let projCode = 'ok';
  try {
    projection.validateZeroDiffReceipt(receipt, projectionCtx);
  } catch (err) {
    projOk = false;
    projCode = err.message || 'throw';
  }
  const contractErrors = [];
  const contractOk = validateZeroDiffReceiptForContract(receipt, {
    ...contract,
    output: { ...contract.output, zero_diff_receipt: receipt },
  }, contractErrors);

  // CLI used by dispatch-hetero
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szd-'));
  const cpath = path.join(tmp, 'contract.json');
  fs.writeFileSync(cpath, JSON.stringify({
    ...contract,
    output: { ...contract.output, zero_diff_receipt: receipt },
  }));
  const cli = spawnSync('node', [
    path.join(root, 'src', 'engine', 'sealed-zero-diff-validator.js'),
    'validate', '--contract', cpath, '--base', projectionCtx.base, '--print-ok',
  ], { encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });

  return {
    shared: shared.ok,
    sharedCode: shared.code,
    projection: projOk,
    contract: contractOk,
    cli: cli.status === 0,
    cliOut: (cli.stdout || '').trim(),
  };
}

// Case 1: valid receipt — all consumers accept
{
  const receipt = buildValidReceipt();
  const v = verdictsFor(receipt);
  assert.strictEqual(v.shared, true, 'shared accepts valid');
  assert.strictEqual(v.projection, true, 'projection accepts valid');
  assert.strictEqual(v.contract, true, 'contract accepts valid');
  assert.strictEqual(v.cli, true, 'cli accepts valid');
  assert.strictEqual(v.cliOut, 'ok');
  console.log('PASS: valid receipt accepted by all consumers');
}

// Case 2: body/path mutation — digest forged
{
  const receipt = buildValidReceipt();
  receipt.path_byte_digests = { 'docs/README.md': sha('tampered') };
  // keep old digest → forged
  const v = verdictsFor(receipt);
  assert.strictEqual(v.shared, false, 'shared rejects forged');
  assert.strictEqual(v.projection, false, 'projection rejects forged');
  assert.strictEqual(v.contract, false, 'contract rejects forged');
  assert.strictEqual(v.cli, false, 'cli rejects forged');
  console.log('PASS: forged digest rejected by all consumers');
}

// Case 3: acceptance mutation
{
  const receipt = buildValidReceipt();
  const ctx = {
    ...projectionCtx,
    acceptance: [{ argv: ['false'], exit: 1 }],
  };
  const shared = validateReceipt(receipt, ctx);
  assert.strictEqual(shared.ok, false, 'acceptance mismatch fails shared');
  assert.strictEqual(shared.code, 'acceptance_mismatch');
  let threw = false;
  try {
    projection.validateZeroDiffReceipt(receipt, ctx);
  } catch (_e) { threw = true; }
  assert.strictEqual(threw, true, 'projection rejects acceptance mismatch');
  console.log('PASS: acceptance mutation rejected');
}

// Case 4: projection / campaign binding mismatch
{
  const receipt = buildValidReceipt({ campaign_id: 'campaign-v1-' + '9'.repeat(64) });
  // recompute digest after override
  const body = { ...receipt }; delete body.digest;
  receipt.digest = sha256Json(body);
  const v = verdictsFor(receipt);
  assert.strictEqual(v.shared, false, 'shared rejects foreign campaign');
  assert.strictEqual(v.projection, false, 'projection rejects foreign campaign');
  assert.strictEqual(v.contract, false, 'contract rejects foreign campaign');
  assert.strictEqual(v.cli, false, 'cli rejects foreign campaign');
  console.log('PASS: foreign campaign binding rejected');
}

// Case 5: path set mutation
{
  const receipt = buildValidReceipt({
    path_byte_digests: { 'docs/OTHER.md': sha('x') },
  });
  const body = { ...receipt }; delete body.digest;
  receipt.digest = sha256Json(body);
  const v = verdictsFor(receipt);
  assert.strictEqual(v.shared, false, 'shared rejects path set mismatch');
  assert.strictEqual(v.projection, false, 'projection rejects path set mismatch');
  assert.strictEqual(v.contract, false, 'contract rejects path set mismatch');
  console.log('PASS: path set mutation rejected');
}

// Case 6: throw-mode wrapper returns cloned receipt
{
  const receipt = buildValidReceipt();
  const out = validateZeroDiffReceipt(receipt, projectionCtx);
  assert.strictEqual(out.digest, receipt.digest);
  assert.notStrictEqual(out, receipt);
  console.log('PASS: throw-mode wrapper returns clone');
}

console.log('sealed-zero-diff-validator-parity: all cases passed');
NODE

assert_eq "$?" "0" "parity node suite exit 0"
finalize_test
