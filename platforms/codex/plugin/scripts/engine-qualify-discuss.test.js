#!/usr/bin/env node
'use strict';

// engine-qualify-discuss.test.js — LIVE (non-`--plan`) administration
// acceptance for `engine-qualify.sh discuss` (plan docs/plans/2026-08-28-
// consult-discuss-qualification.md D3/D7, wired under the Board's
// administration-wave authorization — docs/plans/evidence/2026-08-28-consult-
// discuss-qualify/PROPOSAL.md "Board decision — 2026-08-28 (authorization)").
//
// Stub transport ONLY — no paid provider is ever invoked here. See
// engine-qualify-consult.test.js for the shared design rationale; discuss's
// generator (evals/discuss-eval-generator.js `buildAdministration()`) is
// deliberately UNSEEDED (a fixed 16-case enumeration), unlike consult's
// seeded corpus, so the mock candidate needs no seed at all to regenerate
// it — it just requires the same generator module directly.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDiscussQualification } = require('./engine-qualify');
const gen = require('../evals/discuss-eval-generator');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-discuss-qualify-test-'));
let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }

function writeAdapter(perCaseModeSource) {
  const adapterPath = path.join(tempRoot, `discuss-adapter-${crypto.randomBytes(4).toString('hex')}.js`);
  fs.writeFileSync(adapterPath, `'use strict';
const fs = require('fs');
const path = require('path');
const repoRoot = ${JSON.stringify(path.join(__dirname, '..'))};
const gen = require(path.join(repoRoot, 'evals', 'discuss-eval-generator.js'));
const cases = gen.buildAdministration();
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const envelope = JSON.parse(request.payload.content);
let caseSpec = null;
for (const c of cases) { if (c.case_id === envelope.case_id) caseSpec = c; }
const perCaseMode = ${perCaseModeSource};
const mode = perCaseMode(envelope.case_id);
if (mode === 'crash') { process.stderr.write('simulated provider crash\\n'); process.exit(1); }
let output;
let model = process.env.QUAL_FAKE_MODEL;
if (mode === 'wrong') {
  output = JSON.stringify({
    round_id: caseSpec.reference_response.round_id,
    axis_id: 'not-a-declared-axis',
    claim_vector: ['not-a-real-token'],
    position: 'deliberately wrong contribution',
    risk_tags: ['minor'],
    anchors: [],
  });
} else if (mode === 'bad-identity') {
  output = JSON.stringify(caseSpec.reference_response);
  model = 'not-the-configured-model';
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
const baseOptions = {
  role: 'discuss',
  trials: 2,
  expiresDays: 30,
  emitRow: false,
  execute: true,
  taskClasses: ['discuss'],
  domains: ['cross-cutting'],
  languages: ['en'],
  tools: ['read_only'],
  engine: 'discuss-engine',
  model: 'discuss-model-exact',
  modelVersion: '2026-08-28',
  versionSource: 'operator-asserted',
  runner: 'discuss-harness',
  runnerVersion: '1.0.0',
  family: 'test-family',
  harnessVersion: 'discuss-harness-v1',
  effort: 'high',
  promptConfigHash: digest('a'),
  semanticFingerprint: digest('b'),
  containmentFingerprint: digest('c'),
  panelReadOnlyBinds: [],
  panelEnvironment: [],
  providerEnvironment: ['QUAL_FAKE_PROVIDER', 'QUAL_FAKE_MODEL'],
};

function run(perCaseModeSource, extra) {
  const adapterPath = writeAdapter(perCaseModeSource);
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-'));
  process.env.QUAL_FAKE_PROVIDER = 'fake-discuss-provider';
  process.env.QUAL_FAKE_MODEL = 'discuss-model-exact';
  return runDiscussQualification({
    ...baseOptions,
    remoteProviderCmd: `${process.execPath} ${adapterPath}`,
    remoteProvider: 'fake-discuss-provider',
    remoteTimeoutMs: 60_000,
    store,
    ...extra,
  });
}

// ── 1. no --execute ⇒ refuses, names the flag and the authorization ────────
{
  assert.throws(
    () => runDiscussQualification({ ...baseOptions, execute: false }),
    (error) => error.message.includes('--execute')
      && error.message.includes('PROPOSAL.md')
      && error.message.includes('Board decision'),
    'refusal without --execute names the flag and cites the Board authorization',
  );
  assertions += 1;
}

// ── 2. local (--panel-cmd) transport refused — no identity binding ─────────
{
  assert.throws(
    () => runDiscussQualification({
      ...baseOptions,
      panelCmd: '/bin/true',
      panelReadOnlyBinds: [],
    }),
    /case-broker transport/,
    'local --panel-cmd transport is refused (no identity binding)',
  );
  assertions += 1;
}

// ── 3. green administration: every case answers its own reference ──────────
{
  const result = run("() => 'reference'");
  equal(result.qualified, true, `green administration qualifies (reason: ${result.verdict.reason})`);
  equal(result.row.role, 'discuss', 'row carries the discuss role');
  equal(result.row.quality.corpus_pass, '16/16', 'aggregate pass bar 16/16');
  equal(result.evidence.methodology.kind, 'discuss_rounds', 'D5 methodology kind is discuss_rounds');
  check(result.evidence.trials.length === 2, 'evidence carries both trials');
  for (const trial of result.evidence.trials) {
    equal(trial.cases_total, 8, 'per-trial case count is 8');
    equal(trial.cases_passed, 8, 'per-trial pass bar 8/8');
  }
  equal(result.row.capability_score, 1, 'capability_score is 1.0 on a clean administration');
  equal(result.row.status, 'qualified', 'row status is qualified');
  equal(result.wall_truncated, false, 'a completed administration is not wall_truncated');
  equal(result.started_cases, 16, 'all 16 cases started');
}

// ── 4. one wrong-content case ⇒ not qualified, outcome is a content label ──
{
  const cases = gen.buildAdministration();
  const targetCaseId = cases[0].case_id;
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-content-fail-'));
  const result = run(
    `(id) => (id === ${JSON.stringify(targetCaseId)} ? 'wrong' : 'reference')`,
    { rawDir },
  );
  equal(result.qualified, false, 'one wrong-content case fails the administration');
  const exchanges = fs.readFileSync(path.join(rawDir, 'discuss-exchanges.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const failedRow = exchanges.find((row) => row.case_id === targetCaseId);
  check(failedRow.transport_ok === true, 'the wrong-content case reached the transport fine');
  check(failedRow.outcome !== 'pass' && failedRow.outcome !== 'infra_fail'
    && failedRow.outcome !== 'provider_unavailable',
    `content-wrong case gets a CONTENT taxonomy outcome, not a transport one (got: ${failedRow.outcome})`);
}

// ── 5. transport-attributed failure ⇒ distinct classification, never skipped ─
{
  const cases = gen.buildAdministration();
  const crashCaseId = cases[0].case_id;
  const wrongCaseId = cases[1].case_id;
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-transport-fail-'));
  const result = run(
    `(id) => {
      if (id === ${JSON.stringify(crashCaseId)}) return 'crash';
      if (id === ${JSON.stringify(wrongCaseId)}) return 'wrong';
      return 'reference';
    }`,
    { rawDir },
  );
  equal(result.qualified, false, 'a transport failure fails the administration');
  const exchanges = fs.readFileSync(path.join(rawDir, 'discuss-exchanges.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const crashRow = exchanges.find((row) => row.case_id === crashCaseId);
  const wrongRow = exchanges.find((row) => row.case_id === wrongCaseId);
  check(crashRow.transport_ok === false, 'the crashed case is recorded as a transport failure');
  equal(crashRow.outcome, 'provider_unavailable', 'crashed provider classifies as provider_unavailable');
  check(crashRow.outcome !== wrongRow.outcome,
    'transport-attributed failure is classified DISTINCTLY from a content-quality failure in the same run');
  check(!['provider_unavailable', 'infra_fail'].includes(wrongRow.outcome),
    'the wrong-content case (transport ok) never lands on a transport-taxonomy outcome');
  const totalCasesRecorded = result.evidence.trials.reduce((sum, t) => sum + t.cases_total, 0);
  equal(totalCasesRecorded, 16, 'a transport-failed case is still counted — never silently skipped');
}

// ── 6. identity mismatch ⇒ fail-closed, classified as a transport failure ──
{
  const cases = gen.buildAdministration();
  const mismatchCaseId = cases[0].case_id;
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-identity-mismatch-'));
  const result = run(
    `(id) => (id === ${JSON.stringify(mismatchCaseId)} ? 'bad-identity' : 'reference')`,
    { rawDir },
  );
  equal(result.qualified, false, 'an identity-mismatched case fails the administration (fail-closed)');
  const exchanges = fs.readFileSync(path.join(rawDir, 'discuss-exchanges.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const mismatchRow = exchanges.find((row) => row.case_id === mismatchCaseId);
  check(mismatchRow.transport_ok === false, 'provider identity mismatch is a transport failure');
  check(mismatchRow.transport_error && mismatchRow.transport_error.includes('provider_identity_mismatch'),
    'the transport error names provider_identity_mismatch');
  equal(mismatchRow.outcome, 'provider_unavailable', 'identity mismatch classifies as provider_unavailable');
}

// ── 7. trial-count precondition ─────────────────────────────────────────────
{
  assert.throws(
    () => runDiscussQualification({ ...baseOptions, trials: 3 }),
    /requires exactly 2 trials/,
    'trial-count precondition',
  );
  assertions += 1;
}

// ── 8. wall-truncation seam: honest denominator, never a shrunken one ──────
{
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-truncate-'));
  const result = run("() => 'reference'", { rawDir, testTruncateAfterCases: 3 });
  equal(result.qualified, false, 'a truncated administration is never qualified');
  equal(result.wall_truncated, true, 'wall_truncated observable fact is set');
  equal(result.started_cases, 3, 'started_cases matches the truncation seam');
  equal(result.row.quality.corpus_pass, '3/16',
    'truncated run reports the FULL corpus denominator (3/16), never a shrunken one (3/3)');
}

// ── 9. seal-drift refusal (KR7/D4): live path refuses on a corrupted asset ──
{
  const copyRoot = fs.mkdtempSync(path.join(tempRoot, 'repo-copy-'));
  for (const dir of ['scripts', 'evals', 'src']) {
    fs.cpSync(path.join(__dirname, '..', dir), path.join(copyRoot, dir), { recursive: true });
  }
  const corruptedGenerator = path.join(copyRoot, 'evals', 'discuss-eval-generator.js');
  fs.appendFileSync(corruptedGenerator, '\n// drift\n');
  delete require.cache[require.resolve(path.join(copyRoot, 'scripts', 'engine-qualify.js'))];
  const corrupted = require(path.join(copyRoot, 'scripts', 'engine-qualify.js'));
  assert.throws(
    () => corrupted.runDiscussQualification({
      ...baseOptions,
      remoteProviderCmd: `${process.execPath} /nonexistent-never-reached.js`,
      remoteProvider: 'fake-discuss-provider',
    }),
    /drifted from its pinned hash/,
    'a corrupted generator refuses BEFORE any provider call (seal check runs first)',
  );
  assertions += 1;
}

process.stdout.write(`${assertions} assertions passed\n`);
