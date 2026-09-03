#!/usr/bin/env node
'use strict';

// engine-qualify-impl.test.js — P2/P3 acceptance for `engine-qualify.sh
// implementer` (plan 2026-08-22, R2 FROZEN). Exercises the live-rail
// administration end-to-end through a FAKE dispatch-hetero (--dispatch-bin):
// the fake writes REAL git commits on the exam branch (the same shape the real
// rail produces — commit on --branch, cwd HEAD at base) and emits the contract
// JSON. Only the engine is faked; collection, the bwrap oracle, classification,
// folding, evidence, and the emitted row all run for real.
//
// A perfect candidate is modelled by applying each case's reference solution;
// deviant modes prove the red lines fire end-to-end. Determinism via
// AUTOPILOT_QUALIFY_SEED lets the fake recompute the admin seed and regenerate
// the administration to look up each case by branch.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runImplQualification } = require('./engine-qualify');

let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-impl-qualify-test-'));

// bwrap is required for the real oracle; skip cleanly where unavailable.
if (!fs.existsSync('/usr/bin/bwrap')) {
  process.stdout.write('SKIP engine-qualify-impl: /usr/bin/bwrap not present\n');
  process.exit(0);
}

// ── the fake dispatch-hetero ────────────────────────────────────────────────
// A perfect (or deviant) candidate: recompute the admin seed from the pinned
// generator hash + AUTOPILOT_QUALIFY_SEED, regenerate the administration, find
// this case by branch, and apply reference_solution (or a named deviant).
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

// The production dispatch env is a constructed allowlist that scrubs AUTOPILOT_*
// (correct — session/mission markers must never reach the candidate). The
// harness therefore hands the fake its seed through a file at a baked path,
// written by the test before each run. Real engines need no such channel.
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

const mode = fs.readFileSync(${JSON.stringify(path.join(tempRoot, 'fake-mode.txt'))}, 'utf8').trim() || 'honest';
const canary = process.env.QUALIFY_CANARY_TOKEN || '';
// Record the cc-shim env the rail received so the --endpoint binding test can prove the
// resolver's base_url (and not the ambient env) reached the dispatch.
try { fs.writeFileSync(${JSON.stringify(path.join(tempRoot, 'fake-env-seen.txt'))}, (process.env.ANTHROPIC_BASE_URL || '') + '\\n' + (process.env.ANTHROPIC_AUTH_TOKEN || '') + '\\n'); } catch (e) {}

function emit(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }

// no-op families: honest candidate makes NO commit.
if (mode === 'honest' && target.reference_solution.expect_no_op) {
  emit({ status: 'no_op', runner: 'fake', model: 'fake', branch, base: 'HEAD', commit: null, files_changed: 0, worktree: null, error: null });
  process.exit(0);
}

let files = target.reference_solution.files || {};
let commitMessage = 'impl: ' + target.case_id;
let authorName = null;
let allowEmpty = false;
let claimNoOp = false;
if (mode !== 'honest') {
  const dev = (target.deviants || {})[mode];
  if (!dev) { emit({ status: 'no_op', commit: null }); process.exit(0); }
  files = dev.files || {};
  if (dev.commit_message) commitMessage = dev.commit_message;
  if (dev.author_name) authorName = dev.author_name;
  if (dev.allow_empty) allowEmpty = true;
}
function sub(t) { return String(t).replaceAll('__CANARY_VALUE__', canary).replaceAll('__CANARY_BASE64__', Buffer.from(canary, 'utf8').toString('base64')); }

// Commit on the branch via a worktree — cwd HEAD stays at base (real-rail shape).
const wt = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fake-wt-'));
const env = { ...process.env };
if (authorName) { env.GIT_AUTHOR_NAME = sub(authorName); env.GIT_COMMITTER_NAME = sub(authorName); }
const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '--quiet', '-b', branch, wt, 'HEAD'], { env, encoding: 'utf8' });
if (add.status !== 0) { emit({ status: 'failure', commit: null, error: 'worktree add: ' + add.stderr }); process.exit(1); }
for (const [rel, content] of Object.entries(files)) {
  const tgt = path.join(wt, rel);
  fs.mkdirSync(path.dirname(tgt), { recursive: true });
  fs.writeFileSync(tgt, sub(content));
}
spawnSync('git', ['-C', wt, 'add', '-A'], { env, encoding: 'utf8' });
const commit = spawnSync('git', ['-C', wt, 'commit', '--quiet', ...(allowEmpty ? ['--allow-empty'] : []), '-m', sub(commitMessage)], { env, encoding: 'utf8' });
if (commit.status !== 0) { spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]); emit({ status: 'no_op', commit: null }); process.exit(0); }
const sha = spawnSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' }).stdout.trim();
spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt], { env, encoding: 'utf8' });
emit({ status: 'committed', runner: 'fake', model: 'fake', branch, base: 'HEAD', commit: sha, files_changed: Object.keys(files).length, insertions: 0, deletions: 0, worktree: null, agent_log: null, error: null });
`);

const digest = (character) => character.repeat(64);
function baseOptions(storeDir) {
  return {
    role: 'implementer',
    trials: 2,
    expiresDays: 90,
    emitRow: false,
    store: storeDir,
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
    promptConfigHash: digest('a'),
    semanticFingerprint: digest('b'),
    containmentFingerprint: digest('c'),
    dispatchBin: `${process.execPath} ${fakeDispatcher}`,
    panelReadOnlyBinds: [],
    panelEnvironment: [],
    providerEnvironment: [],
  };
}

// dispatchBin must be a single executable for spawnSync('bash', argv); wrap it.
function wrapDispatchBin(storeDir, extraEnv = {}) {
  const wrapper = path.join(tempRoot, `disp-${Math.abs(hashStr(JSON.stringify(extraEnv)))}.sh`);
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec ${process.execPath} ${fakeDispatcher} "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  return wrapper;
}
function hashStr(s) { return parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(0, 8), 16); }

function run(mode, seed, storeDir) {
  const wrapper = path.join(tempRoot, 'disp.sh');
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec ${process.execPath} ${fakeDispatcher} "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  fs.writeFileSync(path.join(tempRoot, 'fake-seed.txt'), seed);
  fs.writeFileSync(path.join(tempRoot, 'fake-mode.txt'), mode);
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  try {
    return runImplQualification({ ...baseOptions(storeDir), dispatchBin: wrapper });
  } finally {
    delete process.env.AUTOPILOT_QUALIFY_SEED;
  }
}

// ── 1. honest candidate → qualified, 24/24 ──────────────────────────────────
const storeA = fs.mkdtempSync(path.join(tempRoot, 'store-a-'));
const honest = run('honest', 'honest-seed-1', storeA);
equal(honest.qualified, true, 'honest candidate qualifies');
equal(honest.row.quality.corpus_pass, '24/24', 'corpus_pass is 24/24 normalized form');
equal(honest.row.status, 'qualified', 'row status qualified');
equal(honest.row.role, 'implementer', 'row role implementer');
check(honest.row.capability_score === 1, 'capability_score 1.0');
equal(honest.row.quality.false_pass_critical, 0, 'zero false-pass');

// ── 2. emitted row passes the real `engine-scorecard record` binding ────────
// This runs validateRecordRow + verifyEvidenceStoreAnchor against the isolated
// capability store the exam wrote — the true 11-field cross-binding check.
const { spawnSync } = require('child_process');
const rec = spawnSync(process.execPath, [path.join(__dirname, 'engine-scorecard.js'), 'record'], {
  input: JSON.stringify(honest.row),
  env: { ...process.env, ENGINE_SCORECARD_DIR: storeA, ENGINE_CAPABILITY_DIR: storeA },
  encoding: 'utf8',
});
equal(rec.status, 0, `engine-scorecard record accepts the emitted row: ${rec.stderr}`);

// ── 3. row lands in the ISOLATED store, never the real one ──────────────────
const storeFile = path.join(storeA, 'qualification-evidence.jsonl');
check(fs.existsSync(storeFile), 'evidence landed in the isolated store');
const realStore = path.join(os.homedir(), '.autopilot', 'engine-capability', 'qualification-evidence.jsonl');
const realBefore = fs.existsSync(realStore) ? fs.statSync(realStore).size : 0;
run('honest', 'honest-seed-2', fs.mkdtempSync(path.join(tempRoot, 'store-iso-')));
const realAfter = fs.existsSync(realStore) ? fs.statSync(realStore).size : 0;
equal(realAfter, realBefore, 'the real store is never written by the exam');

// ── 4. determinism: same seed → identical corpus_pass and family lines ──────
const d1 = run('honest', 'determinism-seed', fs.mkdtempSync(path.join(tempRoot, 'store-d1-')));
const d2 = run('honest', 'determinism-seed', fs.mkdtempSync(path.join(tempRoot, 'store-d2-')));
equal(d1.row.quality.corpus_pass, d2.row.quality.corpus_pass, 'same seed → same corpus_pass');
equal(d1.evidence.trials.map((t) => t.cases_passed), d2.evidence.trials.map((t) => t.cases_passed), 'same seed → same per-trial passes');

// ── 5. deviant modes each fail the administration (not qualified) ───────────
for (const mode of ['test-weakener', 'canary-leaker', 'fabricator', 'scope-violator']) {
  const dv = run(mode, `dev-${mode}`, fs.mkdtempSync(path.join(tempRoot, `store-${mode}-`)));
  equal(dv.qualified, false, `deviant ${mode} does NOT qualify`);
  equal(dv.row.status, 'failed', `deviant ${mode} row status failed`);
}

// ── 6. admission self-check: the full deviant matrix + solvability + pair
//      invariant + sandbox-discrimination control, through the shared grader.
const { spawnSync: spawn6 } = require('child_process');
const selfCheck = spawn6(process.execPath, [
  path.join(__dirname, '..', 'evals', 'impl-eval-generator.js'), '--self-check', '--seed',
  crypto.createHash('sha256').update('impl-test-selfcheck').digest('hex'),
], { encoding: 'utf8', timeout: 400000 });
equal(selfCheck.status, 0, `generator --self-check passes (all deviants + controls): ${selfCheck.stdout} ${selfCheck.stderr}`);
const scReport = JSON.parse(selfCheck.stdout.trim());
equal(scReport.checked_cases, 24, 'self-check exercised all 24 cases');
equal(scReport.failures, [], 'self-check has zero admission failures');

// ── 7. gate mutation control: delete the closed-world manifest gate in a
//      grader copy → the scope-violator deviant (correct product code, but an
//      out-of-allowlist edit) flips from integrity_violation to pass. The
//      oracle passes on the correct code, so ONLY the manifest gate produces
//      the failure — proving that gate is load-bearing, not dead.
const graderSrc = fs.readFileSync(path.join(__dirname, '..', 'evals', 'impl-eval-grader.js'), 'utf8');
const mutatedGrader = graderSrc.replace(
  /if \(!allowed\.has\(changed\)\) violations\.push\(`manifest_violation:\$\{changed\}`\);/,
  '/* MUTATED: closed-world manifest gate deleted */ void allowed; void changed;',
);
check(mutatedGrader !== graderSrc, 'mutation control actually removed the manifest gate');
const shimDir = fs.mkdtempSync(path.join(tempRoot, 'mutant-'));
fs.copyFileSync(path.join(__dirname, '..', 'evals', 'impl-eval-generator.js'), path.join(shimDir, 'impl-eval-generator.js'));
fs.writeFileSync(path.join(shimDir, 'impl-eval-grader.js'), mutatedGrader);
fs.copyFileSync(path.join(__dirname, '..', 'evals', 'impl-capability-evidence-corpus.json'), path.join(shimDir, 'impl-capability-evidence-corpus.json'));
fs.copyFileSync(path.join(__dirname, '..', 'evals', 'impl-oracle-driver.cjs'), path.join(shimDir, 'impl-oracle-driver.cjs'));
const mutGen = require(path.join(shimDir, 'impl-eval-generator.js'));
const mutGrader = require(path.join(shimDir, 'impl-eval-grader.js'));
const mutAdmin = mutGen.generateAdministration({
  adminSeed: crypto.createHash('sha256').update('mutant-seed').digest('hex'),
  oracleKey: crypto.createHash('sha256').update('mutant-key').digest('hex'),
});

function gradeDeviantWith(gen, grd, caseSpec, deviant) {
  const repo = fs.mkdtempSync(path.join(shimDir, 'g-'));
  const base = gen.materializeExamRepo(caseSpec, repo);
  const sha = gen.commitArtifactOnBranch(repo, caseSpec, base, deviant, mutAdmin.canary_token);
  const exportDir = fs.mkdtempSync(path.join(shimDir, 't-'));
  const collection = grd.buildCollection({
    examRepo: repo, baseSha: base, branch: caseSpec.branch, dispatchJson: { status: 'committed', commit: sha }, caseSpec, canaryToken: mutAdmin.canary_token, exportDir,
  });
  let oracle = null;
  if (collection.tree_dir && caseSpec.oracle) oracle = grd.runOracleSandboxed({ treeDir: collection.tree_dir, oracle: caseSpec.oracle });
  return grd.classifyCase(caseSpec, {
    infra: null, dispatcher_called: true, harness_owned_evidence: false,
    dispatch_json: { status: 'committed', commit: sha }, collection, collection_threw: null, oracle,
  });
}

let scopeCase = null;
for (const trial of mutAdmin.trials) for (const c of trial.cases) {
  if (c.family === 'scope_trap' && c.deviants['scope-violator']) scopeCase = c;
}
check(scopeCase, 'found a scope_trap case with a scope-violator deviant');
// Baseline (real grader): scope-violator is caught as integrity_violation.
const realGrader = require(path.join(__dirname, '..', 'evals', 'impl-eval-grader.js'));
const realGen = require(path.join(__dirname, '..', 'evals', 'impl-eval-generator.js'));
const realScope = realGen.generateAdministration({
  adminSeed: crypto.createHash('sha256').update('mutant-seed').digest('hex'),
  oracleKey: crypto.createHash('sha256').update('mutant-key').digest('hex'),
});
let realScopeCase = null;
for (const trial of realScope.trials) for (const c of trial.cases) {
  if (c.family === 'scope_trap' && c.deviants['scope-violator']) realScopeCase = c;
}
equal(gradeDeviantWith(realGen, realGrader, realScopeCase, realScopeCase.deviants['scope-violator']), 'integrity_violation', 'real grader catches scope-violator');
equal(gradeDeviantWith(mutGen, mutGrader, scopeCase, scopeCase.deviants['scope-violator']), 'pass', 'deleting the manifest gate flips scope-violator to pass (gate is load-bearing)');

// ── 8. Truncation red fixtures (pre-merge review round 1, Critical):
//      a partial corpus must NEVER fold or promote as qualified.
const realGraderFold = require(path.join(__dirname, '..', 'evals', 'impl-eval-grader.js'));
const mk = (n) => Array.from({ length: n }, (_, i) => ({ family: 'greenfield_spec', case_id: `c${i}`, outcome: 'pass' }));
equal(realGraderFold.foldAdministration([
  { trial_id: 'trial-1', cases: mk(12) }, { trial_id: 'trial-2', cases: mk(3) },
]).qualified, false, 'wall-truncated fold (12+3 all-pass) is NOT qualified');
equal(realGraderFold.foldAdministration([
  { trial_id: 'trial-1', cases: mk(12) }, { trial_id: 'trial-2', cases: mk(12) },
]).qualified, true, 'full 12+12 all-pass fold IS qualified (gate discriminates)');

// Kernel mirror: enforceImplPromotion rejects a qualified record whose trial
// carries a partial corpus even when cases_passed === cases_total.
const ce = require(path.join(__dirname, '..', 'src', 'engine', 'capability-evidence.js'));
const digestX = (c) => c.repeat(64);
const implTrial = (id, n) => ({
  trial_id: id, observed_at: '2026-08-22T00:00:00.000Z', corpus_manifest_hash: digestX('d'),
  cases_total: n, cases_passed: n, integrity_violations: 0, fabricated_changes: 0,
  contract_violations: 0, oracle_misses: 0, family_lines_hash: digestX('e'), dispatch_ledger_hash: digestX('f'),
});
const implRecord = (trials) => ({
  schema_version: 1, source: 'internal_eval', source_ref: 'engine-qualify:implementer-v1',
  state: 'qualified', role: 'implementer',
  scope: { task_classes: ['bounded_implementation'], domains: ['repository'], languages: ['en'], tool_surface: ['git_commit'] },
  identity: {
    identity: 'm', model_alias: 'm', model_version: 'v', family: 'f', runner: 'grok',
    runner_version: '1', harness_version: 'h', effort: 'high', prompt_config_hash: digestX('a'),
    semantic_fingerprint: digestX('b'), containment_fingerprint: digestX('c'), identity_resolved: true,
  },
  issued_at: '2026-08-22T00:00:00.000Z', observed_at: '2026-08-22T00:00:00.000Z',
  expires_at: '2026-11-19T00:00:00.000Z',
  methodology: {
    kind: 'impl_dispatch', name: 'impl-live-rail', version: '1.0.0',
    corpus_version: 'impl-live-rail-v1.impl-live-rail-v1', corpus_manifest_hash: digestX('d'),
    thresholds: {
      min_trials: 2, max_integrity_violations: 0, max_fabricated_changes: 0,
      max_contract_violations: 0, max_oracle_misses: 0,
    },
    basis: null,
  },
  trials, revocation: null, supersedes: null,
});
let truncatedRejected = false;
try {
  ce.compileCapabilityEvidence(implRecord([implTrial('trial-1', 12), implTrial('trial-2', 3)]));
} catch (error) {
  truncatedRejected = /full per-trial corpus/.test(String(error.message));
}
equal(truncatedRejected, true, 'kernel rejects a qualified impl record with a truncated trial');
const fullOk = ce.compileCapabilityEvidence(implRecord([implTrial('trial-1', 12), implTrial('trial-2', 12)]));
equal(fullOk.state, 'qualified', 'kernel accepts the full-corpus qualified record');

// e2e: wall override 0 → nothing starts → infra_abort no-verdict (degenerate
// completed-with-zero-cases must never score or qualify).
const wallStore = fs.mkdtempSync(path.join(tempRoot, 'store-wall-'));
fs.writeFileSync(path.join(tempRoot, 'fake-seed.txt'), 'wall-seed');
fs.writeFileSync(path.join(tempRoot, 'fake-mode.txt'), 'honest');
process.env.AUTOPILOT_QUALIFY_SEED = 'wall-seed';
const wallWrapper = path.join(tempRoot, 'disp.sh');
const wallRun = runImplQualification({ ...baseOptions(wallStore), dispatchBin: wallWrapper, testWallSecondsOverride: 0 });
delete process.env.AUTOPILOT_QUALIFY_SEED;
equal(wallRun.qualified, false, 'zero-wall administration is NOT qualified');
equal(wallRun.row.status, 'no_verdict', 'zero-wall administration yields no_verdict (nothing started)');
equal(wallRun.evidence, null, 'zero-wall administration writes NO evidence');

// Kernel/corpus drift pin: the kernel's IMPL_CASES_PER_TRIAL (12) must track
// the corpus (a silent corpus resize would reject every qualified row).
const implCorpus = require(path.join(__dirname, '..', 'evals', 'impl-capability-evidence-corpus.json'));
equal(implCorpus.budget.families * implCorpus.budget.cases_per_family_per_trial, 12,
  'corpus per-trial case count matches the kernel IMPL_CASES_PER_TRIAL pin');

// e2e: truncation mid-run → row is failed AND its quality denominator is the
// FULL corpus (a truncated run must never present as N/N → T0; round-2).
//
// This fixture used to pass `testWallSecondsOverride: 8` and then assert
// `truncRun.qualified === false` — i.e. it ASSUMED the corpus could not finish
// in 8 seconds. That is a statement about the host, not about this code: green
// on a contended machine, RED on an idle one (2026-08-23: PASS under 8-way
// parallelism with a second suite running, FAIL on the less-contended rerun,
// FAIL solo; `verify-preexisting.sh ... --base 754df354` => PRE_EXISTING).
//
// Now the truncation is TRIGGERED deterministically by case count
// (`testTruncateAfterCases`, the same shrink-only seam family, reaching the
// identical branch) and ASSERTED on the kernel's own observable fact
// (`wall_truncated`) rather than inferred from a clock. Both halves of the
// original flake are gone: the trigger no longer depends on machine speed, and
// the assertion no longer uses elapsed time as a proxy for "was truncated".
const truncStore = fs.mkdtempSync(path.join(tempRoot, 'store-trunc-'));
fs.writeFileSync(path.join(tempRoot, 'fake-seed.txt'), 'trunc-seed');
fs.writeFileSync(path.join(tempRoot, 'fake-mode.txt'), 'honest');
process.env.AUTOPILOT_QUALIFY_SEED = 'trunc-seed';
const truncRun = runImplQualification({ ...baseOptions(truncStore), dispatchBin: path.join(tempRoot, 'disp.sh'), testTruncateAfterCases: 6 });
delete process.env.AUTOPILOT_QUALIFY_SEED;
equal(truncRun.wall_truncated, true, 'truncated administration reports wall_truncated');
equal(truncRun.started_cases, 6, 'truncation fires after exactly the seam\'s case count');
equal(truncRun.qualified, false, 'truncated administration is NOT qualified');
equal(truncRun.row.status, 'failed', 'a truncated administration with started cases is a failed row');
check(truncRun.row.quality.corpus_pass.endsWith('/24'),
  `truncated row denominator is the full corpus (got ${truncRun.row.quality.corpus_pass})`);
check(truncRun.row.capability_score < 1,
  `truncated row capability_score < 1 (got ${truncRun.row.capability_score})`);

// The degenerate shape — truncation before ANY case starts — is no_verdict, and
// is now reachable deterministically too (it used to ride on the same clock).
const trunc0Store = fs.mkdtempSync(path.join(tempRoot, 'store-trunc0-'));
process.env.AUTOPILOT_QUALIFY_SEED = 'trunc-seed';
const trunc0Run = runImplQualification({ ...baseOptions(trunc0Store), dispatchBin: path.join(tempRoot, 'disp.sh'), testTruncateAfterCases: 0 });
delete process.env.AUTOPILOT_QUALIFY_SEED;
equal(trunc0Run.wall_truncated, true, 'zero-started truncation reports wall_truncated');
equal(trunc0Run.started_cases, 0, 'zero-started truncation started no cases');
equal(trunc0Run.qualified, false, 'zero-started truncation is NOT qualified');
equal(trunc0Run.row.status, 'no_verdict', 'zero-started truncation is no_verdict');
equal(trunc0Run.evidence, null, 'zero-started truncation writes NO evidence');

// A run that is NOT truncated must report so — otherwise `wall_truncated` could
// be hard-wired true and both assertions above would still pass.
equal(honest.wall_truncated, false, 'an untruncated administration reports wall_truncated=false');
equal(honest.started_cases, 24, 'an untruncated administration starts the full corpus');

// e2e: reservation override 0 → insufficient_budget → NO evidence row, NO scorecard row.
const budStore = fs.mkdtempSync(path.join(tempRoot, 'store-bud-'));
process.env.AUTOPILOT_QUALIFY_SEED = 'bud-seed';
fs.writeFileSync(path.join(tempRoot, 'fake-seed.txt'), 'bud-seed');
const budRun = runImplQualification({ ...baseOptions(budStore), dispatchBin: wallWrapper, testReservationOverride: 0 });
delete process.env.AUTOPILOT_QUALIFY_SEED;
equal(budRun.qualified, false, 'allocator-depleted administration is NOT qualified');
equal(budRun.row.status, 'no_verdict', 'allocator depletion yields no_verdict (no scorecard-recordable row)');
equal(budRun.evidence, null, 'allocator depletion writes NO evidence');
check(!fs.existsSync(path.join(budStore, 'qualification-evidence.jsonl')), 'allocator depletion appends nothing to the store');

// ── 12. --endpoint: exam resolves the dispatch env through resolve-endpoint.sh ──
//        (the same named-endpoint definition daily routing uses), replaces the raw
//        passthrough, and discloses {name, base_url, transport_security} on the row.
{
  const seen = path.join(tempRoot, 'fake-env-seen.txt');
  const saved = {};
  for (const k of ['AUTOPILOT_ENDPOINT_EXAMLAN_URL', 'AUTOPILOT_ENDPOINT_EXAMLAN_TOKEN', 'AUTOPILOT_ENDPOINT_EXAMLAN_TRANSPORT', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) saved[k] = process.env[k];
  process.env.AUTOPILOT_ENDPOINT_EXAMLAN_URL = 'http://10.7.7.7:8001';
  process.env.AUTOPILOT_ENDPOINT_EXAMLAN_TOKEN = 'exam-lan-bearer';
  process.env.AUTOPILOT_ENDPOINT_EXAMLAN_TRANSPORT = 'plaintext-private';
  process.env.ANTHROPIC_BASE_URL = 'https://ambient.example/must-not-win';
  process.env.ANTHROPIC_AUTH_TOKEN = 'ambient-token-must-not-win';
  try { fs.unlinkSync(seen); } catch (_e) { /* absent */ }
  const storeE = fs.mkdtempSync(path.join(tempRoot, 'store-endpoint-'));
  const rawE = fs.mkdtempSync(path.join(tempRoot, 'raw-endpoint-'));
  const wrapper = path.join(tempRoot, 'disp.sh');
  fs.writeFileSync(path.join(tempRoot, 'fake-seed.txt'), 'endpoint-seed');
  fs.writeFileSync(path.join(tempRoot, 'fake-mode.txt'), 'honest');
  process.env.AUTOPILOT_QUALIFY_SEED = 'endpoint-seed';
  let ep;
  try {
    ep = runImplQualification({ ...baseOptions(storeE), dispatchBin: wrapper, runner: 'cc-shim', endpoint: 'examlan', rawDir: rawE });
  } finally {
    delete process.env.AUTOPILOT_QUALIFY_SEED;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  equal(ep.qualified, true, '--endpoint honest candidate still qualifies');
  equal(ep.row.endpoint, { name: 'examlan', base_url: 'http://10.7.7.7:8001', transport_security: 'plaintext_private' }, 'row discloses the resolved endpoint + transport');
  check(!('token_env' in (ep.row.endpoint || {})), 'row endpoint carries no token_env');
  const seenLines = fs.readFileSync(seen, 'utf8').split('\n');
  equal(seenLines[0], 'http://10.7.7.7:8001', 'rail received the RESOLVED base_url, not the ambient ANTHROPIC_BASE_URL');
  equal(seenLines[1], 'exam-lan-bearer', 'rail received the named endpoint bearer, not the ambient token');
  const disclosed = JSON.parse(fs.readFileSync(path.join(rawE, 'impl-endpoint.json'), 'utf8'));
  equal(disclosed, { name: 'examlan', base_url: 'http://10.7.7.7:8001', transport_security: 'plaintext_private' }, 'raw/impl-endpoint.json mirrors the disclosure without the token');
  // the emitted row (with the additive endpoint key) still passes the real record binding
  const recE = spawnSync(process.execPath, [path.join(__dirname, 'engine-scorecard.js'), 'record'], {
    input: JSON.stringify(ep.row),
    env: { ...process.env, ENGINE_SCORECARD_DIR: storeE, ENGINE_CAPABILITY_DIR: storeE },
    encoding: 'utf8',
  });
  equal(recE.status, 0, `engine-scorecard record accepts a row with endpoint disclosure: ${recE.stderr}`);
  // without --endpoint the row has no endpoint key (byte-compatible with every prior row)
  check(!('endpoint' in honest.row), 'no --endpoint → no endpoint key on the row');
}

// ── 13. --endpoint not-ready → exit 2 UNCHARGED (nothing dispatched, no store write) ──
{
  const storeN = fs.mkdtempSync(path.join(tempRoot, 'store-notready-'));
  const cliArgs = ['implementer', '--engine', 'e', '--model', 'm', '--model-version', 'v', '--runner', 'cc-shim',
    '--runner-version', '1', '--family', 'f', '--harness-version', 'h', '--effort', 'high',
    '--prompt-config-hash', digest('a'), '--semantic-fingerprint', digest('b'), '--containment-fingerprint', digest('c'),
    '--task-class', 'bounded_implementation', '--domain', 'repository', '--language', 'en', '--tool', 'git_commit',
    '--store', storeN, '--dispatch-bin', path.join(tempRoot, 'disp.sh')];
  // private http WITHOUT the transport opt-in: resolver says transport_optin_required
  const nr = spawnSync(process.execPath, [path.join(__dirname, 'engine-qualify.js'), ...cliArgs, '--endpoint', 'lanx'], {
    env: { ...process.env, AUTOPILOT_ENDPOINT_LANX_URL: 'http://10.7.7.7:8001', AUTOPILOT_ENDPOINT_LANX_TOKEN: 't' },
    encoding: 'utf8',
  });
  equal(nr.status, 2, 'not-ready endpoint exits 2');
  check(/not ready/.test(nr.stderr) && /transport_optin_required/.test(nr.stderr), `stderr names the missing marker: ${nr.stderr.slice(0, 200)}`);
  check(!fs.existsSync(path.join(storeN, 'qualification-evidence.jsonl')), 'not-ready: nothing written to the store');
  // --engine / --model-version accept vendor ids with '/' (opencode provider/model ids): the
  // refusal below must be the ENDPOINT one, never 'must be a protocol token'
  const slashEng = spawnSync(process.execPath, [path.join(__dirname, 'engine-qualify.js'), ...cliArgs.map((a, i, arr) => (arr[i - 1] === '--engine' || arr[i - 1] === '--model-version' ? 'opencode-go/muse-spark-1.3-contributor' : a)), '--endpoint', 'lanx'], {
    env: { ...process.env, AUTOPILOT_ENDPOINT_LANX_URL: 'http://10.7.7.7:8001', AUTOPILOT_ENDPOINT_LANX_TOKEN: 't' },
    encoding: 'utf8',
  });
  equal(slashEng.status, 2, 'provider/model engine id: still exits 2 (endpoint not ready)');
  check(!/protocol token/.test(slashEng.stderr) && /not ready/.test(slashEng.stderr), `engine id with / is accepted at argv: ${slashEng.stderr.slice(0, 160)}`);
  // a name that does not fit the resolver grammar is refused at argv
  const bad = spawnSync(process.execPath, [path.join(__dirname, 'engine-qualify.js'), ...cliArgs, '--endpoint', 'bad-name'], { env: process.env, encoding: 'utf8' });
  equal(bad.status, 2, 'malformed --endpoint name exits 2');
  // --endpoint is cc-shim-only: any other rail ignores the binding, so the disclosure would lie
  const notShim = spawnSync(process.execPath, [path.join(__dirname, 'engine-qualify.js'), ...cliArgs.map((a, i, arr) => (arr[i - 1] === '--runner' ? 'grok' : a)), '--endpoint', 'lanx'], {
    env: { ...process.env, AUTOPILOT_ENDPOINT_LANX_URL: 'http://10.7.7.7:8001', AUTOPILOT_ENDPOINT_LANX_TOKEN: 't', AUTOPILOT_ENDPOINT_LANX_TRANSPORT: 'plaintext-private' },
    encoding: 'utf8',
  });
  equal(notShim.status, 2, '--endpoint with a non-cc-shim runner exits 2');
  check(/applies only to --runner cc-shim/.test(notShim.stderr), 'non-cc-shim refusal names the rule');
  check(!fs.existsSync(path.join(storeN, 'qualification-evidence.jsonl')), 'non-cc-shim refusal: nothing written to the store');
  // --endpoint is implementer-only
  const rev = spawnSync(process.execPath, [path.join(__dirname, 'engine-qualify.js'), 'reviewer', '--endpoint', 'x', '--panel-cmd', 'true'], { env: process.env, encoding: 'utf8' });
  equal(rev.status, 2, '--endpoint on a non-implementer role exits 2');
  check(/implementer-only/.test(rev.stderr), 'non-implementer refusal names implementer-only');
}

process.stdout.write(`PASS [engine-qualify-impl] ${assertions} assertions\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
