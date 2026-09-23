#!/usr/bin/env node
'use strict';

// Foreman exam runner rules from spec §9. Section 8's per-trial record
// (campaign arrays, critical_events, disposition, resit_locked, clock) is not
// a field set on any existing capability-evidence trial normalizer. This
// module refuses to start a record-writing sitting rather than widening that
// schema. Section 10 conformance puppets are not built here.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const ASSET_PATHS = Object.freeze({
  generator: 'evals/foreman-eval-generator.js',
  grader: 'evals/foreman-eval-grader.js',
  corpus: 'evals/foreman-capability-evidence-corpus.json',
  conformance: 'evals/foreman-harness-conformance.js',
});

const SCHEMA_MISMATCH = 'section 8 foreman record does not fit the capability-evidence trial schema'
  + ' (closed key sets per methodology kind; no disposition, campaigns, or critical_events fields)';

function section8FitsCapabilityEvidence() {
  return false;
}

function antiRerunDecision(priorRecords, engineId, seatConfigHash) {
  const mine = (priorRecords || []).filter((record) => record
    && record.engine_id === engineId
    && record.seat_config_hash === seatConfigHash);
  if (mine.some((record) => record.disposition === 'failed')) {
    return { refuse: true, reason: 'anti-rerun: a prior sitting for this engine and seat config has disposition failed' };
  }
  if (mine.some((record) => record.resit_locked === true)) {
    return { refuse: true, reason: 'anti-rerun: a prior sitting for this engine and seat config is resit_locked' };
  }
  const aborts = mine.filter((record) => record.disposition === 'aborted_transport');
  if (aborts.length >= 2) {
    return { refuse: true, reason: 'anti-rerun: two prior aborted_transport sittings for this engine and seat config' };
  }
  return { refuse: false, reason: null };
}

function transportAbortRecord(partial) {
  const events = partial.critical_events_before_abort || [];
  const count = typeof events === 'number' ? events : events.length;
  return {
    disposition: 'aborted_transport',
    graded: false,
    pass: null,
    fail: null,
    evidence: null,
    aborted_at_campaign_index: partial.aborted_at_campaign_index,
    critical_events_before_abort: events,
    resit_locked: count > 0,
  };
}

function classifyRunnerStop(kind) {
  if (kind === 'model_turn_timeout' || kind === 'transport_error') return 'aborted_transport';
  if (kind === 'budget_overrun' || kind === 'campaign_token_cap') return 'graded';
  if (kind === 'max_tokens_per_sitting') return 'failed';
  throw new Error(`unknown foreman runner stop: ${kind}`);
}

function evaluateForemanPreconditions(ctx) {
  const input = ctx || {};
  const pins = input.pins || {};
  const hashes = input.asset_hashes || {};
  for (const name of Object.keys(ASSET_PATHS)) {
    if (!pins[name] || !hashes[name]) {
      return { start: false, code: 'asset_pin', reason: `precondition: pinned asset ${name} is missing a hash` };
    }
    if (pins[name] !== hashes[name]) {
      return { start: false, code: 'asset_pin', reason: `precondition: asset ${name} sha256 differs from its pin` };
    }
  }
  const conformance = input.conformance_record;
  if (!conformance || conformance.harness_hash !== input.current_harness_hash) {
    return {
      start: false,
      code: 'conformance',
      reason: 'precondition: conformance record is missing or its harness_hash differs from the current harness',
    };
  }
  if (input.seat_prompt_sha256 !== input.vocabulary_scan_sha256) {
    return {
      start: false,
      code: 'seat_prompt',
      reason: 'precondition: seat_prompt_sha256 differs from the vocabulary-scan pin',
    };
  }
  const transport = input.transport || {};
  if (transport.multi_turn !== true || transport.second_session !== true) {
    return { start: false, code: 'unsupported_transport', reason: 'precondition: unsupported_transport' };
  }
  const sandbox = input.sandbox || {};
  if (sandbox.fresh !== true || sandbox.network_off !== true || sandbox.canaries !== true) {
    return {
      start: false,
      code: 'sandbox',
      reason: 'precondition: sandbox is not fresh, not network-off, or canary manifests are missing',
    };
  }
  if (input.run_nonce_source === 'caller' && input.test_mode !== true) {
    return {
      start: false,
      code: 'run_nonce',
      reason: 'precondition: run_nonce was supplied by the caller and not drawn from the host CSPRNG',
    };
  }
  const rerun = antiRerunDecision(input.prior_records, input.engine_id, input.seat_config_hash);
  if (rerun.refuse) return { start: false, code: 'anti_rerun', reason: rerun.reason };
  return {
    start: true,
    test_mode: input.test_mode === true,
    inadmissible: input.test_mode === true,
    reason: null,
  };
}

function diskForemanPreconditionContext() {
  const assetHashes = {};
  for (const [name, rel] of Object.entries(ASSET_PATHS)) {
    const absolute = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(absolute)) assetHashes[name] = null;
    else assetHashes[name] = 'present';
  }
  return {
    pins: {},
    asset_hashes: assetHashes,
    conformance_record: null,
    current_harness_hash: null,
    seat_prompt_sha256: null,
    vocabulary_scan_sha256: null,
    transport: { multi_turn: false, second_session: false },
    sandbox: { fresh: false, network_off: false, canaries: false },
    run_nonce_source: 'host_csprng',
    test_mode: false,
    prior_records: [],
    engine_id: null,
    seat_config_hash: null,
  };
}

function runForemanQualification() {
  const decision = evaluateForemanPreconditions(diskForemanPreconditionContext());
  if (!decision.start) {
    const error = new Error(`qualification precondition failed: ${decision.reason}`);
    error.code = decision.code;
    throw error;
  }
  if (!section8FitsCapabilityEvidence()) {
    const error = new Error(`qualification precondition failed: ${SCHEMA_MISMATCH}`);
    error.code = 'schema_mismatch';
    throw error;
  }
  throw new Error('foreman sitting was not started');
}

module.exports = {
  ASSET_PATHS,
  SCHEMA_MISMATCH,
  section8FitsCapabilityEvidence,
  antiRerunDecision,
  transportAbortRecord,
  classifyRunnerStop,
  evaluateForemanPreconditions,
  diskForemanPreconditionContext,
  runForemanQualification,
};
