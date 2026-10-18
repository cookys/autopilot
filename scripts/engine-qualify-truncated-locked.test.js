#!/usr/bin/env node
'use strict';

// # RED at fa8c6e456:
// AssertionError [ERR_ASSERTION]: truncated locked_qualify sitting is no_verdict
// actual: 'qualified'
// expected: 'no_verdict'
// operator: deepStrictEqual
// at scripts/engine-qualify-truncated-locked.test.js (row.status)
// Node.js v24.16.0 exit 1
// GREEN at 3cd1461d4+fix: 32 assertions passed

// BL-0160: a sitting cut short by the wall limit (or the test-only count seam)
// while cases remain unadministered is no_verdict, even after locked_qualify.
// Modelled on scripts/engine-qualify-consult.test.js section 8.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runConsultQualification, runImplQualification } = require('./engine-qualify');

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
} else if (mode === 'tier1') {
  // "ship it" is a consult verdict token. STEP-1 of classifyQualificationOutcome
  // marks the case tier1 before the label map runs.
  const ref = caseSpec.reference_response;
  output = JSON.stringify({ ...ref, answer: { ...ref.answer, label: 'ship it' } });
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

// (5) Tier-1, then truncated, stays failed (not no_verdict).
{
  const result = run("() => 'tier1'", { testTruncateAfterCases: 3 });
  equal(result.wall_truncated, true, 'truncated tier1 sitting reports wall_truncated');
  equal(result.stop_reason, 'tier1', 'a verdict token locks tier1 before the wall');
  equal(result.row.status, 'failed', 'tier1 followed by truncation stays failed');
  equal(result.qualified, false, 'a truncated tier1 sitting is not qualified');
}

// (6) Implementer kernel: truncation never records qualified.
// Proved against runImplQualification. foldAdministration requires a complete
// corpus before folded.qualified, and the row status is that flag. The brain
// kernel does not set wallTruncated (token-cap stop is a different path).
if (!fs.existsSync('/usr/bin/bwrap')) {
  process.stderr.write('SKIP implementer truncation case: /usr/bin/bwrap not present\n');
} else {
  const fakeDispatcher = path.join(tempRoot, 'fake-dispatch-hetero.js');
  fs.writeFileSync(fakeDispatcher, `
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const gen = require(${JSON.stringify(path.join(__dirname, '..', 'evals', 'impl-eval-generator.js'))});
function byteHash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const branch = opt('--branch');
const repo = process.cwd();
const seedSalt = fs.readFileSync(${JSON.stringify(path.join(tempRoot, 'fake-seed.txt'))}, 'utf8').trim();
const genHash = byteHash(fs.readFileSync(${JSON.stringify(path.join(__dirname, '..', 'evals', 'impl-eval-generator.js'))}));
const corpusHash = byteHash(fs.readFileSync(${JSON.stringify(path.join(__dirname, '..', 'evals', 'impl-capability-evidence-corpus.json'))}));
const runNonce = byteHash('impl-seed:' + seedSalt);
const adminSeed = byteHash('impl-admin:' + runNonce + ':' + genHash);
const oracleKey = byteHash('impl-oracle-key:' + runNonce + ':' + corpusHash);
const admin = gen.generateAdministration({ adminSeed, oracleKey });
let target = null;
for (const trial of admin.trials) for (const c of trial.cases) if (c.branch === branch) target = c;
if (!target) { process.stdout.write(JSON.stringify({ status: 'failure', commit: null, error: 'unknown branch' }) + '\\n'); process.exit(1); }
const canary = process.env.QUALIFY_CANARY_TOKEN || '';
function emit(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
if (target.reference_solution.expect_no_op) {
  emit({ status: 'no_op', runner: 'fake', model: 'fake', branch, base: 'HEAD', commit: null, files_changed: 0, worktree: null, error: null });
  process.exit(0);
}
function sub(t) { return String(t).replaceAll('__CANARY_VALUE__', canary).replaceAll('__CANARY_BASE64__', Buffer.from(canary, 'utf8').toString('base64')); }
const files = target.reference_solution.files || {};
const wt = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fake-wt-'));
const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '--quiet', '-b', branch, wt, 'HEAD'], { encoding: 'utf8' });
if (add.status !== 0) { emit({ status: 'failure', commit: null, error: 'worktree add: ' + add.stderr }); process.exit(1); }
for (const [rel, content] of Object.entries(files)) {
  const tgt = path.join(wt, rel);
  fs.mkdirSync(path.dirname(tgt), { recursive: true });
  fs.writeFileSync(tgt, sub(content));
}
spawnSync('git', ['-C', wt, 'add', '-A'], { encoding: 'utf8' });
const commit = spawnSync('git', ['-C', wt, 'commit', '--quiet', '-m', 'impl: ' + target.case_id], { encoding: 'utf8' });
if (commit.status !== 0) { spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]); emit({ status: 'no_op', commit: null }); process.exit(0); }
const sha = spawnSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt], { encoding: 'utf8' });
emit({ status: 'committed', runner: 'fake', model: 'fake', branch, base: 'HEAD', commit: sha, files_changed: Object.keys(files).length, insertions: 0, deletions: 0, worktree: null, agent_log: null, error: null });
`);
  const wrapper = path.join(tempRoot, 'impl-disp.sh');
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec ${process.execPath} ${fakeDispatcher} "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  fs.writeFileSync(path.join(tempRoot, 'fake-seed.txt'), 'impl-trunc-seed');
  const digestI = (character) => character.repeat(64);
  const implStore = fs.mkdtempSync(path.join(tempRoot, 'impl-store-'));
  process.env.AUTOPILOT_QUALIFY_SEED = 'impl-trunc-seed';
  let implResult;
  try {
    implResult = runImplQualification({
      role: 'implementer',
      trials: 2,
      expiresDays: 90,
      emitRow: false,
      store: implStore,
      taskClasses: ['bounded_implementation'],
      domains: ['repository'],
      languages: ['en'],
      tools: ['git_commit'],
      engine: 'fake-impl-engine',
      model: 'fake-impl-model',
      modelVersion: '2026-08-22',
      versionSource: 'operator-asserted',
      runner: 'grok',
      runnerVersion: '1.0.5',
      family: 'test-family',
      harnessVersion: 'impl-harness-v1',
      effort: 'high',
      promptConfigHash: digestI('a'),
      semanticFingerprint: digestI('b'),
      containmentFingerprint: digestI('c'),
      dispatchBin: wrapper,
      panelReadOnlyBinds: [],
      panelEnvironment: [],
      providerEnvironment: [],
      testTruncateAfterCases: 6,
    });
  } finally {
    delete process.env.AUTOPILOT_QUALIFY_SEED;
  }
  equal(implResult.wall_truncated, true, 'implementer truncation reports wall_truncated');
  equal(implResult.started_cases, 6, 'implementer seam stops after 6 started cases');
  equal(implResult.qualified, false, 'implementer truncation is not qualified');
  check(implResult.row.status !== 'qualified', `implementer truncated row is not qualified (got ${implResult.row.status})`);
  check(
    implResult.evidence == null || implResult.evidence.state !== 'qualified',
    'implementer truncation produces no promotion evidence in the qualified state',
  );
  check(
    implResult.verdict.evidence_state !== 'qualified',
    'implementer truncation verdict evidence_state is not qualified',
  );
}

process.stdout.write(`${assertions} assertions passed\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
