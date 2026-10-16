#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { runHarnessConformance } = require('../evals/foreman-harness-conformance');
const { runForemanQualification, transportAbortRecord } = require('../evals/foreman-eval-runner');

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

const record = runHarnessConformance();
check(typeof record.harness_hash === 'string' && record.harness_hash.length === 64, 'conformance record is keyed by harness_hash');
check(record.golden.passed === true, `golden puppets grade correct (${JSON.stringify(record.golden.results.filter((e) => !e.correct))})`);
check(record.golden.originals === 10 && record.golden.twins === 4, 'ten originals and four twins');
check(record.critical.passed === true, `critical puppets (${JSON.stringify(record.critical.results.filter((e) => !e.exact))})`);
check(record.noncritical.passed === true, `non-critical puppets (${JSON.stringify(record.noncritical.results.filter((e) => !e.exact))})`);
check(record.h_replay.passed === true, 'H replay is byte-identical across two runs');
check(record.host_path_write.passed === true && record.host_path_write.refused === false, 'host-path write failed inside the sandbox and was recorded');
check(record.kill_residue.passed === true && record.kill_residue.refused === false, `kill left no candidate (${record.kill_residue.reason})`);

const sitting = runForemanQualification({ test_mode: true });
check(sitting.verdict.test_mode === true && sitting.verdict.inadmissible === true, 'test-mode sitting is inadmissible');
check(sitting.verdict.evidence && sitting.verdict.evidence.trials.length === 2, 'test-mode sitting records puppet trials');
check(sitting.qualified === false, 'test mode does not qualify the seat');

const abort = runForemanQualification({
  test_mode: true,
  stop: 'transport_error',
  aborted_at_campaign_index: 1,
  critical_events_before_abort: [],
});
check(abort.verdict.pass === null && abort.verdict.fail === null, 'transport abort writes no graded pass or fail');
check(abort.verdict.evidence === null, 'transport abort writes no evidence record');
const direct = transportAbortRecord({ aborted_at_campaign_index: 1, critical_events_before_abort: [] });
check(direct.pass === null && direct.fail === null, 'abort helper stays ungraded');

const cli = spawnSync(process.execPath, ['scripts/engine-qualify.js', 'foreman'], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, AUTOPILOT_QUALIFY_SEED: 'foreman-phase3-salt' },
  encoding: 'utf8',
});
check(cli.status === 1, `engine-qualify foreman test mode records without a usage throw (${cli.status} ${cli.stderr})`);
const body = JSON.parse(cli.stdout);
check(body.test_mode === true && body.inadmissible === true, 'qualify output keeps test_mode inadmissible');
check(body.pass === true && body.evidence && body.evidence.trials.length === 2, 'qualify records the puppet campaigns');

console.log(`${assertions} assertions passed`);
