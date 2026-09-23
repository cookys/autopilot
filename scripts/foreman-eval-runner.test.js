#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  section8FitsCapabilityEvidence,
  antiRerunDecision,
  transportAbortRecord,
  classifyRunnerStop,
  evaluateForemanPreconditions,
  diskForemanPreconditionContext,
  runForemanQualification,
  SCHEMA_MISMATCH,
} = require('../evals/foreman-eval-runner');

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

check(section8FitsCapabilityEvidence() === true, 'section 8 foreman trial keys are on the capability-evidence schema');

const hash = 'a'.repeat(64);
const { compileForemanTrial } = require('../src/engine/capability-evidence');
const subject = { evaluated: 1, passed: 1, failed_noncritical: 0, failed_critical: 0 };
const fixtureTrial = {
  trial_index: 0,
  trial_seed_commitment: hash,
  campaigns_run: 0,
  subjects: {
    verdict_truth: subject,
    path_integrity: subject,
    trail_join: subject,
    review_coverage: subject,
    isolation: subject,
    termination: subject,
  },
  clean: { total: 3, completed: 0, false_positives: 0 },
  planted: { total: 7, correct: 0 },
  twins: { total: 4, correct: 0 },
  solvable: { total: 12, completed: 0, honest_incomplete: 0 },
  unsolvable: { total: 2, correct: 0 },
  critical_events: [],
  budget: { dispatches_used: 0, tool_calls_used: 0, tokens_used: 0 },
  campaigns: [],
};
const compiled = compileForemanTrial(fixtureTrial);
check(compiled.campaigns_run === 0 && compiled.clock === undefined, 'a fixture foreman trial compiles');
const omitted = { ...fixtureTrial };
delete omitted.budget;
assert.throws(() => compileForemanTrial(omitted), /missing budget/, 'a trial that omits a required key is rejected');
assertions += 1;

const base = {
  pins: { generator: hash, grader: hash, corpus: hash, conformance: hash },
  asset_hashes: { generator: hash, grader: hash, corpus: hash, conformance: hash },
  conformance_record: { harness_hash: hash },
  current_harness_hash: hash,
  seat_prompt_sha256: hash,
  vocabulary_scan_sha256: hash,
  transport: { multi_turn: true, second_session: true },
  sandbox: { fresh: true, network_off: true, canaries: true },
  run_nonce_source: 'host_csprng',
  test_mode: false,
  prior_records: [],
  engine_id: 'engine-a',
  seat_config_hash: hash,
};

check(evaluateForemanPreconditions(base).start === true, 'a fully pinned fresh sitting may start');

const drifted = { ...base, asset_hashes: { ...base.asset_hashes, grader: 'b'.repeat(64) } };
check(evaluateForemanPreconditions(drifted).start === false, 'a drifted grader pin refuses to start');
check(evaluateForemanPreconditions(drifted).code === 'asset_pin', 'drift is an asset pin refusal');

const noConformance = { ...base, conformance_record: null };
check(evaluateForemanPreconditions(noConformance).code === 'conformance', 'missing conformance record refuses');

const badTransport = { ...base, transport: { multi_turn: false, second_session: true } };
check(
  evaluateForemanPreconditions(badTransport).code === 'unsupported_transport',
  'a transport that cannot do multi-turn is unsupported_transport, not a graded fail',
);

const callerNonce = { ...base, run_nonce_source: 'caller', test_mode: false };
check(evaluateForemanPreconditions(callerNonce).code === 'run_nonce', 'caller-supplied nonce without test mode refuses');
const salted = evaluateForemanPreconditions({ ...base, run_nonce_source: 'caller', test_mode: true });
check(salted.start === true && salted.inadmissible === true, 'test-salt mode starts and is inadmissible');

const failedPrior = antiRerunDecision(
  [{ engine_id: 'engine-a', seat_config_hash: hash, disposition: 'failed', resit_locked: false }],
  'engine-a',
  hash,
);
check(failedPrior.refuse === true, 'a prior failed disposition locks a resit');

const locked = antiRerunDecision(
  [{ engine_id: 'engine-a', seat_config_hash: hash, disposition: 'aborted_transport', resit_locked: true }],
  'engine-a',
  hash,
);
check(locked.refuse === true, 'resit_locked refuses the next sitting');

const twoAborts = antiRerunDecision([
  { engine_id: 'engine-a', seat_config_hash: hash, disposition: 'aborted_transport', resit_locked: false },
  { engine_id: 'engine-a', seat_config_hash: hash, disposition: 'aborted_transport', resit_locked: false },
], 'engine-a', hash);
check(twoAborts.refuse === true, 'two prior transport aborts refuse a third sitting');

const otherEngine = antiRerunDecision(
  [{ engine_id: 'engine-b', seat_config_hash: hash, disposition: 'failed', resit_locked: false }],
  'engine-a',
  hash,
);
check(otherEngine.refuse === false, 'a failure under another engine id does not lock this one');

const abort = transportAbortRecord({
  aborted_at_campaign_index: 3,
  critical_events_before_abort: [{ campaign_id: 'cmp-1', code: 'FALSE_MET' }],
});
check(abort.disposition === 'aborted_transport', 'transport abort disposition is aborted_transport');
check(abort.graded === false && abort.pass === null && abort.fail === null, 'transport abort is not a graded pass or fail');
check(abort.evidence === null, 'transport abort writes no evidence record');
check(abort.resit_locked === true, 'a critical event before the abort sets resit_locked');

const cleanAbort = transportAbortRecord({ aborted_at_campaign_index: 0, critical_events_before_abort: [] });
check(cleanAbort.resit_locked === false, 'an abort with no prior critical event is not resit_locked');

check(classifyRunnerStop('model_turn_timeout') === 'aborted_transport', 'model-turn timeout aborts and is not graded');
check(classifyRunnerStop('transport_error') === 'aborted_transport', 'transport error aborts and is not graded');
check(classifyRunnerStop('budget_overrun') === 'graded', 'a candidate budget overrun stays graded');
check(classifyRunnerStop('max_tokens_per_sitting') === 'failed', 'the sitting token cap ends as failed');

const disk = diskForemanPreconditionContext();
const diskDecision = evaluateForemanPreconditions(disk);
check(diskDecision.start === true, `disk pins and conformance allow a sitting to start (${diskDecision.reason})`);
check(
  disk.test_mode === Boolean(process.env.AUTOPILOT_QUALIFY_SEED),
  'test_mode follows AUTOPILOT_QUALIFY_SEED',
);
const driftedDisk = {
  ...disk,
  asset_hashes: { ...disk.asset_hashes, generator: 'b'.repeat(64) },
};
check(evaluateForemanPreconditions(driftedDisk).code === 'asset_pin', 'a changed asset fails the pin check');
const plan = runForemanQualification({ plan: true });
check(plan.mode === 'plan' && plan.harness_hash === disk.current_harness_hash, 'plan path gets past asset pins and conformance');
check(!JSON.stringify(plan).includes('missing a hash'), 'plan path does not report a missing hash');
check(!JSON.stringify(plan).includes('foreman sitting was not started'), 'plan path starts past the sitting stub');
check(!JSON.stringify(plan).includes(SCHEMA_MISMATCH), 'schema mismatch is not reached once §9 pins match');

console.log(`${assertions} assertions passed`);
