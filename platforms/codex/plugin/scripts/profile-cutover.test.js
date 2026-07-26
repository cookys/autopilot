#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');
const {
  ProfileCutoverError,
  evaluateProfileCutover,
  normalizeProfileCutoverSnapshot,
} = require('../src/engine/profile-cutover');
const PROFILE_CATALOG = require('../profiles/profile-catalog.json');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-profile-cutover-test-'));
let assertions = 0;

function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function expectCode(callback, code, message) {
  let observed = null;
  try {
    callback();
  } catch (error) {
    observed = error;
  }
  check(observed instanceof ProfileCutoverError, message);
  equal(observed.code, code, `${message}: stable error code`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function profileSource(name) {
  return {
    profile_hash: PROFILE_CATALOG.profiles[name].sha256,
    control_bytes: PROFILE_CATALOG.core.bytes + PROFILE_CATALOG.profiles[name].bytes,
  };
}

function measurement(host = 'codex') {
  return {
    host,
    deployment_identity_hash: sha256(`deployment:${host}`),
    measured_at: '2026-07-26T09:00:00.000Z',
    token_source: 'exact_tokenizer:test-model',
    guided_control_tokens: 120,
    autonomous_control_tokens: 80,
    isolation_receipt_hash: sha256(`isolation:${host}`),
    fresh_session_switch: true,
  };
}

function dogfood(index) {
  return {
    receipt_id: sha256(`dogfood:${index}`),
    task_id: `task-${index}`,
    profile_session_id: `session-${index}`,
    risk: 'low',
    profile: 'autonomous',
    status: 'completed',
    started_at: `2026-07-26T08:0${index}:00.000Z`,
    completed_at: `2026-07-26T08:1${index}:00.000Z`,
    owner_identity_hash: sha256('owner:exact'),
    owner_family: 'openai',
    reviewer_family: 'xai',
    owner_qualification_receipt_id: sha256('owner:qualification'),
    owner_qualified_at: '2026-07-26T07:00:00.000Z',
    owner_qualification_expires_at: '2026-07-27T07:00:00.000Z',
    independent_acceptance_receipt_hash: sha256(`acceptance:${index}`),
    acceptance_passed: true,
    critical_false_pass_attributed_to_reduction: false,
    reviewer_catches: index % 2,
    rework_cycles: index % 2,
    wall_time_ms: 1000 + index,
    input_tokens: 200 + index,
    output_tokens: 40 + index,
  };
}

function baseSnapshot() {
  return {
    schema_version: 1,
    observed_at: '2026-07-26T09:30:00.000Z',
    project_default: 'guided',
    candidate_default: 'adaptive',
    rollback: {
      setting: 'governance.guidance_profile',
      value: 'guided',
    },
    supported_hosts: ['codex'],
    profile_sources: {
      guided: profileSource('guided'),
      autonomous: profileSource('autonomous'),
    },
    context_measurements: [],
    effectful_guided_compatibility: {
      status: 'missing',
      receipt_hash: null,
    },
    fallback_tests: {
      identity_drift: 'pass',
      capability_expiry: 'pass',
      capability_demotion: 'pass',
      replacement_reresolution: 'pass',
      profile_change_fresh_session: 'pass',
    },
    critical_false_passes_attributed_to_reduction: 0,
    assurance_invariance: {
      high_risk_assurance_unchanged: 'unverified',
      cross_family_review: 'unverified',
    },
    dogfood_window: {
      status: 'missing',
      window_id: null,
      started_at: null,
      ended_at: null,
      dispatched_task_ids: [],
      receipt_set_hash: null,
    },
    dogfood_receipts: [],
  };
}

function eligibleSnapshot() {
  const snapshot = baseSnapshot();
  snapshot.context_measurements = [measurement()];
  snapshot.effectful_guided_compatibility = {
    status: 'observed',
    receipt_hash: sha256('effectful-guided-compatibility'),
  };
  snapshot.assurance_invariance = {
    high_risk_assurance_unchanged: 'pass',
    cross_family_review: 'pass',
  };
  snapshot.dogfood_receipts = [1, 2, 3, 4, 5].map(dogfood);
  snapshot.dogfood_window = {
    status: 'observed',
    window_id: 'dogfood-window-1',
    started_at: '2026-07-26T08:00:00.000Z',
    ended_at: '2026-07-26T08:20:00.000Z',
    dispatched_task_ids: snapshot.dogfood_receipts.map((entry) => entry.task_id),
    receipt_set_hash: sha256(canonicalJson(
      snapshot.dogfood_receipts.map((entry) => entry.receipt_id).sort(),
    )),
  };
  return snapshot;
}

function verifier(input) {
  return {
    ok: true,
    input_hash: sha256(canonicalJson(input)),
    evidence_hash: sha256(`verified:${canonicalJson(input)}`),
  };
}

const liveVerifiers = {
  contextMeasurementVerifier: verifier,
  effectfulCompatibilityVerifier: verifier,
  lifecycleGateVerifier: verifier,
  assuranceGateVerifier: verifier,
  dogfoodWindowVerifier: verifier,
  ownerQualificationVerifier: verifier,
  dogfoodReceiptVerifier: verifier,
};

function gate(decision, id) {
  return decision.gates.find((entry) => entry.id === id);
}

function runCli(args) {
  return spawnSync(process.execPath, [
    path.join(root, 'scripts', 'evaluate-profile-cutover.js'),
    ...args,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
}

function main() {
  const baseline = baseSnapshot();
  const baselineBefore = canonicalJson(baseline);
  const normalized = normalizeProfileCutoverSnapshot(baseline);
  equal(normalized.project_default, 'guided', 'snapshot keeps guided authoritative');
  equal(canonicalJson(baseline), baselineBefore, 'normalization does not mutate caller input');

  const hold = evaluateProfileCutover(baseline);
  equal(hold.decision, 'hold_guided', 'missing live evidence holds guided');
  equal(hold.recommended_default, 'guided', 'hold never recommends adaptive');
  equal(hold.authority_status, 'advisory_only', 'cutover receipt grants no authority');
  equal(hold.apply_automatically, false, 'cutover evaluator never edits configuration');
  equal(hold.rollback.setting, 'governance.guidance_profile', 'rollback names one setting');
  equal(hold.rollback.value, 'guided', 'rollback restores guided');
  equal(hold.rollback.changes_task_intent, false, 'rollback preserves task intent');
  equal(
    hold.metrics.source_control_bytes_saved,
    profileSource('guided').control_bytes - profileSource('autonomous').control_bytes,
    'canonical source-byte savings are reported',
  );
  equal(hold.metrics.exact_control_tokens_saved, null, 'bytes do not masquerade as exact tokens');
  equal(
    gate(hold, 'guided_authoritative_and_single_setting_rollback').status,
    'pass',
    'guided project default gate passes',
  );
  equal(
    gate(hold, 'exact_context_isolation_and_savings').status,
    'hold',
    'missing exact host measurements block cutover',
  );
  equal(
    gate(hold, 'effectful_guided_compatibility').status,
    'hold',
    'missing effectful guided witness blocks cutover',
  );
  equal(
    gate(hold, 'five_fresh_qualified_owner_dogfoods').status,
    'hold',
    'missing dogfood receipts block cutover',
  );
  equal(
    gate(hold, 'zero_critical_false_pass_from_profile_reduction').status,
    'pass',
    'zero observed attributable Critical false passes is retained',
  );
  equal(hold.verification_evidence_hashes.length, 0, 'disk-only evaluation has no live evidence');
  check(/^[a-f0-9]{64}$/u.test(hold.decision_id), 'decision receipt is content addressed');

  const eligibleInput = eligibleSnapshot();
  const eligible = evaluateProfileCutover(eligibleInput, liveVerifiers);
  equal(eligible.decision, 'eligible_to_enable_adaptive', 'complete live evidence can pass');
  equal(eligible.recommended_default, 'adaptive', 'passing gate recommends adaptive');
  check(eligible.gates.every((entry) => entry.status === 'pass'), 'every frozen cutover gate passes');
  equal(eligible.metrics.exact_guided_control_tokens, 120, 'guided exact tokens aggregate');
  equal(eligible.metrics.exact_autonomous_control_tokens, 80, 'autonomous exact tokens aggregate');
  equal(eligible.metrics.exact_control_tokens_saved, 40, 'exact measured savings are positive');
  equal(eligible.metrics.dogfood_tasks, 5, 'five dogfood tasks are counted');
  equal(eligible.metrics.acceptance_passed, 5, 'completion acceptance metric is retained');
  equal(eligible.metrics.reviewer_catches, 3, 'reviewer catches aggregate');
  equal(eligible.metrics.rework_cycles, 3, 'rework aggregate');
  equal(eligible.verification_evidence_hashes.length, 15, 'all live verifier receipts are bound');
  equal(eligible.apply_automatically, false, 'even an eligible receipt does not edit config');

  const fileOnly = evaluateProfileCutover(eligibleInput);
  equal(fileOnly.decision, 'hold_guided', 'serialized evidence cannot recreate live verification');
  equal(
    gate(fileOnly, 'five_fresh_qualified_owner_dogfoods').status,
    'hold',
    'serialized owner claims cannot qualify dogfood',
  );

  const four = eligibleSnapshot();
  four.dogfood_receipts.pop();
  const fourDecision = evaluateProfileCutover(four, liveVerifiers);
  equal(fourDecision.decision, 'hold_guided', 'four dogfood receipts cannot satisfy five-task gate');
  equal(
    gate(fourDecision, 'independent_dogfood_receipts').status,
    'hold',
    'four independent receipts remain insufficient',
  );
  equal(
    gate(fourDecision, 'complete_dogfood_window').status,
    'hold',
    'window manifest prevents cherry-picking four receipts from five dispatches',
  );

  const missingWindow = eligibleSnapshot();
  missingWindow.dogfood_window = baseSnapshot().dogfood_window;
  const missingWindowDecision = evaluateProfileCutover(missingWindow, liveVerifiers);
  equal(missingWindowDecision.decision, 'hold_guided', 'five receipts need a complete window');
  equal(
    gate(missingWindowDecision, 'complete_dogfood_window').status,
    'hold',
    'missing dogfood manifest blocks cutover',
  );

  const duplicate = eligibleSnapshot();
  duplicate.dogfood_receipts[4].task_id = duplicate.dogfood_receipts[0].task_id;
  duplicate.dogfood_receipts[4].profile_session_id
    = duplicate.dogfood_receipts[0].profile_session_id;
  const duplicateDecision = evaluateProfileCutover(duplicate, liveVerifiers);
  equal(duplicateDecision.decision, 'hold_guided', 'duplicate tasks/sessions cannot inflate count');
  equal(
    gate(duplicateDecision, 'five_fresh_qualified_owner_dogfoods').status,
    'hold',
    'dogfood uniqueness is enforced',
  );

  const expired = eligibleSnapshot();
  expired.dogfood_receipts[0].owner_qualification_expires_at
    = '2026-07-26T09:00:00.000Z';
  const expiredDecision = evaluateProfileCutover(expired, liveVerifiers);
  equal(expiredDecision.decision, 'hold_guided', 'expired owner qualification blocks cutover');
  equal(
    gate(expiredDecision, 'five_fresh_qualified_owner_dogfoods').status,
    'hold',
    'owner qualification must remain fresh at decision time',
  );

  const critical = eligibleSnapshot();
  critical.critical_false_passes_attributed_to_reduction = 1;
  critical.dogfood_receipts[0].critical_false_pass_attributed_to_reduction = true;
  const criticalDecision = evaluateProfileCutover(critical, liveVerifiers);
  equal(criticalDecision.decision, 'hold_guided', 'Critical false pass blocks cutover');
  equal(
    gate(criticalDecision, 'zero_critical_false_pass_from_profile_reduction').status,
    'hold',
    'Critical gate identifies attributable reduction escape',
  );

  const rejected = eligibleSnapshot();
  rejected.dogfood_receipts[0].acceptance_passed = false;
  const rejectedDecision = evaluateProfileCutover(rejected, liveVerifiers);
  equal(rejectedDecision.decision, 'hold_guided', 'failed dogfood acceptance blocks cutover');
  equal(
    gate(rejectedDecision, 'dogfood_acceptance').status,
    'hold',
    'five independent receipts must also pass acceptance',
  );

  const correlated = eligibleSnapshot();
  correlated.dogfood_receipts[0].reviewer_family = 'openai';
  const correlatedDecision = evaluateProfileCutover(correlated, liveVerifiers);
  equal(correlatedDecision.decision, 'hold_guided', 'same-family dogfood review blocks cutover');
  equal(
    gate(correlatedDecision, 'decorrelated_review').status,
    'hold',
    'review decorrelation is an explicit gate',
  );

  const heuristic = eligibleSnapshot();
  heuristic.context_measurements[0].token_source = 'heuristic_bytes_div_3.5';
  const heuristicDecision = evaluateProfileCutover(heuristic, liveVerifiers);
  equal(heuristicDecision.decision, 'hold_guided', 'heuristic tokens cannot satisfy cutover');
  equal(
    gate(heuristicDecision, 'exact_context_isolation_and_savings').status,
    'hold',
    'exact-token source is enforced',
  );

  const staleSource = baseSnapshot();
  staleSource.profile_sources.guided.control_bytes += 1;
  expectCode(
    () => evaluateProfileCutover(staleSource),
    'PROFILE_CUTOVER_SOURCE_DRIFT',
    'profile source drift fails closed',
  );

  const extra = baseSnapshot();
  extra.unexpected = true;
  expectCode(
    () => evaluateProfileCutover(extra),
    'INVALID_PROFILE_CUTOVER_SNAPSHOT',
    'unknown snapshot fields fail closed',
  );

  const inputFile = path.join(temporary, 'snapshot.json');
  fs.writeFileSync(inputFile, `${JSON.stringify(eligibleInput, null, 2)}\n`, { mode: 0o600 });
  const schemaValidation = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'validate-json-schema.js'),
    '--schema', path.join(root, 'schemas', 'profile-cutover-snapshot.schema.json'),
    '--document', inputFile,
  ], { cwd: root, encoding: 'utf8' });
  equal(schemaValidation.status, 0, 'eligible snapshot matches its public schema');
  const cli = runCli(['evaluate', '--input', inputFile]);
  equal(cli.status, 0, 'file-only advisory evaluation exits zero');
  equal(JSON.parse(cli.stdout).decision, 'hold_guided', 'CLI cannot recreate live verifiers');
  const required = runCli(['evaluate', '--input', inputFile, '--require-eligible']);
  equal(required.status, 1, 'require-eligible fails while guided is held');
  equal(JSON.parse(required.stdout).decision, 'hold_guided', 'required CLI emits its hold receipt');
  const bad = runCli(['evaluate', '--unknown']);
  equal(bad.status, 2, 'invalid CLI arguments exit two');
  equal(JSON.parse(bad.stdout).reason, 'INVALID_ARGUMENT', 'invalid CLI has stable reason');
  const help = runCli(['--help']);
  equal(help.status, 0, 'CLI help exits zero');
  check(help.stdout.includes('advisory decision receipt'), 'CLI help states advisory boundary');

  process.stdout.write(`profile cutover: ${assertions} assertions passed\n`);
}

try {
  main();
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
