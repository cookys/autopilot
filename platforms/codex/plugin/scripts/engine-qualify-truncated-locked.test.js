#!/usr/bin/env node
'use strict';

// # RED at fa8c6e456:
// AssertionError [ERR_ASSERTION]: truncated locked_qualify sitting is no_verdict
// actual: 'qualified'
// expected: 'no_verdict'
// operator: deepStrictEqual
// at scripts/engine-qualify-truncated-locked.test.js (row.status)
// Node.js v24.16.0 exit 1

// BL-0160: a sitting cut short by the wall limit (or the test-only count seam)
// while cases remain unadministered is no_verdict, even after locked_qualify.
// Modelled on scripts/engine-qualify-consult.test.js section 8.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runConsultQualification } = require('./engine-qualify');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-trunc-locked-'));
let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }
function writeAdapter(seed, perCaseModeSource) {
  const adapterPath = path.join(tempRoot, `consult-adapter-${crypto.randomBytes(4).toString('hex')}.js`);
  fs.writeFileSync(adapterPath, `'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const repoRoot = ${JSON.stringify(path.join(__dirname, '..'))};
const gen = require(path.join(repoRoot, 'evals', 'consult-eval-generator.js'));
const seals = require(path.join(repoRoot, 'scripts', 'lib', 'qualification-asset-seals.js'));
function byteHash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
const staticAssets = seals.checkAssetSeals('consult');
const runNonce = byteHash('consult-seed:' + ${JSON.stringify(seed)});
const adminSeed = byteHash('consult-admin:' + runNonce + ':' + staticAssets.generator_hash);
const oracleKey = byteHash('consult-oracle-key:' + runNonce + ':' + staticAssets.corpus_hash);
const admin = gen.generateAdministration(adminSeed, oracleKey);
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const envelope = JSON.parse(request.payload.content);
let caseSpec = null;
for (const trial of admin.trials) {
  for (const c of trial.cases) { if (c.case_id === envelope.case_id) caseSpec = c; }
}
const perCaseMode = ${perCaseModeSource};
const mode = perCaseMode(envelope.case_id);
let output;
let model = process.env.QUAL_FAKE_MODEL;
if (mode === 'wrong') {
  output = JSON.stringify({ answer: { label: 'WRONG_LABEL_NEVER_A_REAL_ONE', artifact_ref: null }, aside: [], authority: { refused: false, reference: null } });
} else {
  output = JSON.stringify(caseSpec.reference_response);
}
process.stdout.write(JSON.stringify({
  schema_version: 1,
  provider: process.env.QUAL_FAKE_PROVIDER,
  model,
  output,
}));
`);
  return adapterPath;
}

const digest = (character) => character.repeat(64);
const seed = 'trunc-locked-qualify-seed';
const baseOptions = {
  role: 'consult',
  trials: 2,
  expiresDays: 30,
  emitRow: false,
  execute: true,
  taskClasses: ['consult'],
  domains: ['cross-cutting'],
  languages: ['en'],
  tools: ['read_only'],
  engine: 'consult-engine',
  model: 'consult-model-exact',
  modelVersion: '2026-08-28',
  versionSource: 'operator-asserted',
  runner: 'consult-harness',
  runnerVersion: '1.0.0',
  family: 'test-family',
  harnessVersion: 'consult-harness-v1',
  effort: 'high',
  promptConfigHash: digest('a'),
  semanticFingerprint: digest('b'),
  containmentFingerprint: digest('c'),
  panelReadOnlyBinds: [],
  panelEnvironment: [],
  providerEnvironment: ['QUAL_FAKE_PROVIDER', 'QUAL_FAKE_MODEL'],
};

function run(perCaseModeSource, extra) {
  const adapterPath = writeAdapter(seed, perCaseModeSource);
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-'));
  process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
  process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  return runConsultQualification({
    ...baseOptions,
    remoteProviderCmd: `${process.execPath} ${adapterPath}`,
    remoteProvider: 'fake-consult-provider',
    remoteTimeoutMs: 60_000,
    store,
    ...extra,
  });
}

// Lock point is 56 passes of 60 (foldPooledVerdict: wilsonLower(passes, 60) >= VERDICT_TAU
// while cases remain). 56 started cases is past the lock and short of the pool.
const LOCK_PASSES = 56;
const FULL_N = 60;

// (1) locked_qualify then truncated by the count seam.
{
  const result = run("() => 'reference'", { testTruncateAfterCases: LOCK_PASSES });
  equal(result.wall_truncated, true, 'truncated locked_qualify sitting reports wall_truncated');
  equal(result.started_cases, LOCK_PASSES, 'seam stops after the lock point and before the full pool');
  check(result.started_cases < FULL_N, 'fewer than 60 cases were started');
  equal(result.stop_reason, 'locked_qualify', 'the pool had already reached locked_qualify');
  equal(result.pooled.passes, LOCK_PASSES, 'passes sit on the consult lock point');
  equal(result.row.status, 'no_verdict', 'truncated locked_qualify sitting is no_verdict');
  equal(result.qualified, false, 'truncated locked_qualify sitting is not qualified');
  equal(result.evidence, null, 'no qualified-promotion evidence is produced');
  equal(result.row.evidence, null, 'row carries no promotion evidence');
  check(
    String(result.verdict.reason).includes('wall-truncated'),
    `failure reason names the wall truncation (got ${result.verdict.reason})`,
  );
}

// (2) fully administered all-pass sitting stays qualified.
{
  const result = run("() => 'reference'");
  equal(result.wall_truncated, false, 'a full sitting is not truncated');
  equal(result.started_cases, FULL_N, 'all 60 cases were administered');
  equal(result.qualified, true, 'a full all-pass sitting qualifies');
  equal(result.row.status, 'qualified', 'a full all-pass sitting row is qualified');
}

// (3) undecided truncation stays no_verdict.
{
  const result = run("() => 'reference'", { testTruncateAfterCases: 3 });
  equal(result.wall_truncated, true, 'undecided truncation reports wall_truncated');
  equal(result.stop_reason, 'continue', 'three passes are still undecided');
  equal(result.row.status, 'no_verdict', 'undecided truncated sitting stays no_verdict');
  equal(result.qualified, false, 'undecided truncated sitting is not qualified');
}

// (4) decided locked_fail, then truncated, stays failed.
{
  const result = run("() => 'wrong'", { testTruncateAfterCases: 20 });
  // Every case is a content miss. Five misses lock the consult pool (same
  // shape as the stability suite's RTC(e1)); twenty started cases is after
  // that lock and before the full pool.
  equal(result.wall_truncated, true, 'truncated locked_fail sitting reports wall_truncated');
  equal(result.stop_reason, 'locked_fail', 'five-plus content misses lock a failure before truncation');
  equal(result.row.status, 'failed', 'a decided failure truncated after the lock stays failed');
  equal(result.qualified, false, 'a truncated failure is not qualified');
}

process.stdout.write(`${assertions} assertions passed\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
