#!/usr/bin/env node
'use strict';

// Never touch the real ~/.autopilot: the durable evidence log goes to a temp dir.
const fs = require('fs');
const os = require('os');
process.env.AUTOPILOT_FOREMAN_EVIDENCE_DIR = fs.mkdtempSync(require('path').join(os.tmpdir(), 'foreman-evidence-test-'));
process.on('exit', () => { try { require('fs').rmSync(process.env.AUTOPILOT_FOREMAN_EVIDENCE_DIR, { recursive: true, force: true }); } catch { /* already gone */ } });

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { runHarnessConformance, NON_CRITICAL_CODES } = require('../evals/foreman-harness-conformance');
const { CRITICAL_CODES } = require('../evals/foreman-eval-grader');
const runnerModule = require('../evals/foreman-eval-runner');
const { runForemanQualification, transportAbortRecord } = runnerModule;

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

// Spec section 10 / backlog item 6: every puppet, the restart replay, the write
// probe and the kill probe go through runner.driveCampaign. Count the calls.
const realDrive = runnerModule.driveCampaign;
let driveCalls = 0;
runnerModule.driveCampaign = (...args) => {
  driveCalls += 1;
  return realDrive(...args);
};
const record = runHarnessConformance();
runnerModule.driveCampaign = realDrive;
const expectedDrives = 14 + CRITICAL_CODES.size + NON_CRITICAL_CODES.length + 2 + 1 + 1;
check(driveCalls === expectedDrives, `conformance drives ${expectedDrives} campaigns through the runner (got ${driveCalls})`);
const everyResult = [
  ...record.golden.results,
  ...record.critical.results,
  ...record.noncritical.results,
];
check(everyResult.every((entry) => entry.driven_by === 'runner.driveCampaign'), 'every puppet result says it was driven by the runner');
check(record.h_replay.driven_by === 'runner.driveCampaign', 'the restart replay was driven by the runner');
check(record.host_path_write.driven_by === 'runner.driveCampaign' && record.host_path_write.zone_write_seen === true, 'the write probe acted through the shell tool and the zone write was seen');
check(record.kill_residue.driven_by === 'runner.driveCampaign' && record.kill_residue.exit_status === 124, 'the kill probe acted through the shell tool and got exit 124');
check(record.critical.results.length === CRITICAL_CODES.size, 'one puppet per critical code');
check(record.asset_hashes.sandbox && record.asset_hashes.sandbox.length === 64, 'the sandbox module is part of the harness hash');
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

// Runner guard: a test-mode process with no evidence-dir override must refuse
// the real default path instead of writing to it.
const guardEnv = { ...process.env, AUTOPILOT_QUALIFY_SEED: 'guard-probe' };
delete guardEnv.AUTOPILOT_FOREMAN_EVIDENCE_DIR;
const guard = spawnSync(process.execPath, ['-e', `
  const runner = require(process.cwd() + '/evals/foreman-eval-runner');
  try { runner.appendEvidenceRow({ type: 'probe' }); console.log('WROTE'); }
  catch (error) { console.log(error.code); }
  console.log(JSON.stringify(runner.loadPriorRecords('e', 'h')));
`], { cwd: path.resolve(__dirname, '..'), env: guardEnv, encoding: 'utf8' });
check(guard.stdout.split('\n')[0] === 'evidence_dir_unsafe', `test mode without an override refuses the real evidence dir (${guard.stdout} ${guard.stderr})`);
check(guard.stdout.split('\n')[1] === '[]', 'test mode reads no real prior records');

console.log(`${assertions} assertions passed`);
