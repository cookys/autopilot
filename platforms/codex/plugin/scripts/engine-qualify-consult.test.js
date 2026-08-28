#!/usr/bin/env node
'use strict';

// engine-qualify-consult.test.js — LIVE (non-`--plan`) administration
// acceptance for `engine-qualify.sh consult` (plan docs/plans/2026-08-28-
// consult-discuss-qualification.md D3/D7, wired under the Board's
// administration-wave authorization — docs/plans/evidence/2026-08-28-consult-
// discuss-qualify/PROPOSAL.md "Board decision — 2026-08-28 (authorization)").
//
// Stub transport ONLY — no paid provider is ever invoked here. A mock
// "candidate" script regenerates the SAME sealed administration (via the
// AUTOPILOT_QUALIFY_SEED-derived seeds, exactly like the kernel does) and
// answers each case by looking up its own `reference_response` — this tests
// the WIRING (seal check -> broker dispatch -> identity binding -> grading
// -> folding -> evidence compilation -> record), not the exam's difficulty
// (that is D1's own admission-gate self-check, covered by
// hooks/tests/engine-qualify-consult.test.sh).

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runConsultQualification } = require('./engine-qualify');
const gen = require('../evals/consult-eval-generator');
const qualificationAssetSeals = require('./lib/qualification-asset-seals');
const { compileCapabilityEvidence, evaluateCapabilityEvidence, normalizeScope } = require('../src/engine/capability-evidence');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const { frozenScopeForRole } = require('./lib/qualification-applicability-scope');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-consult-qualify-test-'));
let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }

function byteHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

// Regenerates the exact administration the kernel will generate for a given
// AUTOPILOT_QUALIFY_SEED — same derivation formula as
// runConsultDiscussQualification in engine-qualify.js.
function regenerateAdministration(seed) {
  const staticAssets = qualificationAssetSeals.checkAssetSeals('consult');
  const runNonce = byteHash(`consult-seed:${seed}`);
  const adminSeed = byteHash(`consult-admin:${runNonce}:${staticAssets.generator_hash}`);
  const oracleKey = byteHash(`consult-oracle-key:${runNonce}:${staticAssets.corpus_hash}`);
  return gen.generateAdministration(adminSeed, oracleKey);
}

// Builds a provider adapter script. `perCaseMode(case_id)` returns one of:
//   'reference'  — answer with the case's own reference_response (correct)
//   'wrong'      — answer with a deliberately wrong (but well-formed) response
//   'crash'      — the provider process exits non-zero (transport failure)
//   'bad-identity' — the provider reports a model id that does not match
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
if (mode === 'crash') { process.stderr.write('simulated provider crash\\n'); process.exit(1); }
let output;
let model = process.env.QUAL_FAKE_MODEL;
if (mode === 'wrong') {
  output = JSON.stringify({ answer: { label: 'WRONG_LABEL_NEVER_A_REAL_ONE', artifact_ref: null }, aside: [], authority: { refused: false, reference: null } });
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
const seed = 'consult-kernel-test-seed';
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

// ── 1. no --execute ⇒ refuses, names the flag and the authorization ────────
{
  assert.throws(
    () => runConsultQualification({ ...baseOptions, execute: false }),
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
    () => runConsultQualification({
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
  equal(result.row.role, 'consult', 'row carries the consult role');
  equal(result.row.quality.corpus_pass, '20/20', 'aggregate pass bar 20/20');
  equal(result.evidence.methodology.kind, 'consult_panel', 'D5 methodology kind is consult_panel');
  check(result.evidence.trials.length === 2, 'evidence carries both trials');
  for (const trial of result.evidence.trials) {
    equal(trial.cases_total, 10, 'per-trial case count is 10');
    equal(trial.cases_passed, 10, 'per-trial pass bar 10/10');
  }
  equal(result.row.capability_score, 1, 'capability_score is 1.0 on a clean administration');
  equal(result.row.status, 'qualified', 'row status is qualified');
  equal(result.wall_truncated, false, 'a completed administration is not wall_truncated');
  equal(result.started_cases, 20, 'all 20 cases started');
}

// ── 4. one wrong-content case ⇒ not qualified, outcome is a content label ──
{
  const admin = regenerateAdministration(seed);
  const targetCaseId = admin.trials[0].cases[0].case_id;
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-content-fail-'));
  const result = run(
    `(id) => (id === ${JSON.stringify(targetCaseId)} ? 'wrong' : 'reference')`,
    { rawDir },
  );
  equal(result.qualified, false, 'one wrong-content case fails the administration');
  const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const failedRow = exchanges.find((row) => row.case_id === targetCaseId);
  check(failedRow.transport_ok === true, 'the wrong-content case reached the transport fine');
  check(failedRow.outcome !== 'pass' && failedRow.outcome !== 'infra_fail'
    && failedRow.outcome !== 'provider_unavailable',
    `content-wrong case gets a CONTENT taxonomy outcome, not a transport one (got: ${failedRow.outcome})`);
}

// ── 5. transport-attributed failure ⇒ distinct classification, never skipped ─
{
  const admin = regenerateAdministration(seed);
  const crashCaseId = admin.trials[0].cases[0].case_id;
  const wrongCaseId = admin.trials[0].cases[1].case_id;
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
  const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const crashRow = exchanges.find((row) => row.case_id === crashCaseId);
  const wrongRow = exchanges.find((row) => row.case_id === wrongCaseId);
  check(crashRow.transport_ok === false, 'the crashed case is recorded as a transport failure');
  equal(crashRow.outcome, 'provider_unavailable', 'crashed provider classifies as provider_unavailable');
  check(crashRow.outcome !== wrongRow.outcome,
    'transport-attributed failure is classified DISTINCTLY from a content-quality failure in the same run');
  check(!['provider_unavailable', 'infra_fail'].includes(wrongRow.outcome),
    'the wrong-content case (transport ok) never lands on a transport-taxonomy outcome');
  // never skipped: both cases appear in the exchange log and in cases_total.
  const totalCasesRecorded = result.evidence.trials.reduce((sum, t) => sum + t.cases_total, 0);
  equal(totalCasesRecorded, 20, 'a transport-failed case is still counted — never silently skipped');
}

// ── 6. identity mismatch ⇒ fail-closed, classified as a transport failure ──
{
  const admin = regenerateAdministration(seed);
  const mismatchCaseId = admin.trials[0].cases[0].case_id;
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-identity-mismatch-'));
  const result = run(
    `(id) => (id === ${JSON.stringify(mismatchCaseId)} ? 'bad-identity' : 'reference')`,
    { rawDir },
  );
  equal(result.qualified, false, 'an identity-mismatched case fails the administration (fail-closed)');
  const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
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
    () => runConsultQualification({ ...baseOptions, trials: 3 }),
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
  equal(result.row.quality.corpus_pass, '3/20',
    'truncated run reports the FULL corpus denominator (3/20), never a shrunken one (3/3)');
}

// ── 9. seal-drift refusal (KR7/D4): live path refuses on a corrupted asset ──
{
  const copyRoot = fs.mkdtempSync(path.join(tempRoot, 'repo-copy-'));
  for (const dir of ['scripts', 'evals', 'src']) {
    fs.cpSync(path.join(__dirname, '..', dir), path.join(copyRoot, dir), { recursive: true });
  }
  const corruptedGenerator = path.join(copyRoot, 'evals', 'consult-eval-generator.js');
  fs.appendFileSync(corruptedGenerator, '\n// drift\n');
  delete require.cache[require.resolve(path.join(copyRoot, 'scripts', 'engine-qualify.js'))];
  const corrupted = require(path.join(copyRoot, 'scripts', 'engine-qualify.js'));
  assert.throws(
    () => corrupted.runConsultQualification({
      ...baseOptions,
      remoteProviderCmd: `${process.execPath} /nonexistent-never-reached.js`,
      remoteProvider: 'fake-consult-provider',
    }),
    /drifted from its pinned hash/,
    'a corrupted generator refuses BEFORE any provider call (seal check runs first)',
  );
  assertions += 1;
}

// ── 10. side-effecting drift fixture (finding [seal-before-load]): proves
// the sealed generator's top-level module code NEVER RUNS on a refused
// invocation — not "the hash check happens to run first", but "the module
// is never require()d at all" until AFTER the seal check has passed.
{
  const copyRoot = fs.mkdtempSync(path.join(tempRoot, 'repo-copy-sentinel-'));
  for (const dir of ['scripts', 'evals', 'src']) {
    fs.cpSync(path.join(__dirname, '..', dir), path.join(copyRoot, dir), { recursive: true });
  }
  const corruptedGenerator = path.join(copyRoot, 'evals', 'consult-eval-generator.js');
  const sentinelPath = path.join(tempRoot, `sentinel-${crypto.randomBytes(4).toString('hex')}.txt`);
  // Top-level (module-init-time) side effect — runs the instant this file
  // is require()d, before any of its exported functions are ever called.
  fs.appendFileSync(corruptedGenerator, `
// drift + side-effecting sentinel (test-injected)
require('fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'module-top-level-code-executed');
`);
  delete require.cache[require.resolve(path.join(copyRoot, 'scripts', 'engine-qualify.js'))];
  check(!fs.existsSync(sentinelPath), 'sentinel does not exist before anything runs (sanity)');

  const corrupted = require(path.join(copyRoot, 'scripts', 'engine-qualify.js'));
  check(!fs.existsSync(sentinelPath),
    'requiring engine-qualify.js alone does not execute the sealed generator\'s top-level code (no eager require)');

  assert.throws(
    () => corrupted.runConsultQualification({
      ...baseOptions,
      remoteProviderCmd: `${process.execPath} /nonexistent-never-reached.js`,
      remoteProvider: 'fake-consult-provider',
    }),
    /drifted from its pinned hash/,
    'a corrupted generator still refuses via seal drift',
  );
  assertions += 1;
  check(!fs.existsSync(sentinelPath),
    'the refused invocation NEVER executed the corrupted generator\'s top-level code — proves seal-before-load');
}

// ── 11. evidence-asset-binding: the persisted evidence binds ALL FIVE
// sealed identities (one canonical digest), not just the corpus manifest
// hash alone — and the record-path guard refuses a mismatched binding.
{
  const result = run("() => 'reference'");
  const expectedSealedSetHash = qualificationAssetSeals.sealedSetHash('consult');
  equal(result.evidence.methodology.corpus_manifest_hash, expectedSealedSetHash,
    'methodology.corpus_manifest_hash is the FIVE-identity sealed-set hash, not the bare corpus hash');
  for (const trial of result.evidence.trials) {
    equal(trial.corpus_manifest_hash, expectedSealedSetHash,
      'each trial binds the same sealed-set hash as the methodology block');
  }
  // Sanity: it is genuinely a DIFFERENT value than the raw corpus.json hash
  // alone — proving this is a real composite, not an accidental passthrough.
  const rawCorpusHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '..', 'evals', 'consult-capability-evidence-corpus.json')))
    .digest('hex');
  check(expectedSealedSetHash !== rawCorpusHash,
    'the sealed-set hash is a genuine composite of all five identities, not just the corpus hash');

  // Record-path guard accepts a FRESH, correctly-bound row.
  qualificationAssetSeals.assertSealedEvidenceBinding('consult', result.evidence);
  assertions += 1; // (did not throw)

  // Record-path guard REJECTS a row whose sealed-set binding has been
  // tampered/forged (or gone stale against the currently pinned assets).
  const tampered = JSON.parse(JSON.stringify(result.evidence));
  tampered.methodology.corpus_manifest_hash = 'f'.repeat(64);
  assert.throws(
    () => qualificationAssetSeals.assertSealedEvidenceBinding('consult', tampered),
    /sealed-set binding mismatch/,
    'a forged/stale sealed-set binding is rejected at the record path',
  );
  assertions += 1;
}

// ── 12. D5 promotion path + scope mutation gap ──────────────────────────────
{
  const result = run("() => 'reference'");

  // Only the INPUT fields compileCapabilityEvidence expects — the computed
  // fields (evidence_id/evidence_hash/scope_hash/identity_hash/
  // grant_identity_hash/trial_set_hash) are recomputed from these and
  // VALIDATED against any caller-supplied value, so a raw clone used for
  // mutation must drop them first or a stale hash throws for the wrong reason.
  function rawEvidenceInput(evidence) {
    const {
      schema_version, source, source_ref, state, role, scope, identity,
      issued_at, observed_at, expires_at, methodology, trials, revocation, supersedes,
    } = JSON.parse(JSON.stringify(evidence));
    return {
      schema_version, source, source_ref, state, role, scope, identity,
      issued_at, observed_at, expires_at, methodology, trials, revocation, supersedes,
    };
  }

  // (a) The generated qualified row passes through the PRODUCTION
  // capability-evidence promotion/validation path (compileCapabilityEvidence
  // calls enforcePromotion internally) — re-compiled directly here, not
  // merely inferred from the kernel's own earlier success.
  const recompiled = compileCapabilityEvidence(rawEvidenceInput(result.evidence));
  equal(recompiled.state, 'qualified', 'the production promotion path independently accepts the generated row');

  // (b) role/methodology-kind mismatch ⇒ D5's bidirectional pinning
  // REJECTS. Isolated test: keep methodology.kind and every trial/threshold
  // field EXACTLY as generated (still internally self-consistent as
  // consult_panel) and change ONLY the role — so the schema-shape validator
  // upstream of enforcePromotion has nothing to object to, and the ONLY
  // thing that can reject this row is the role<->kind pin itself (a naive
  // kind-only swap gets caught earlier by threshold/trial shape validation
  // instead, which would NOT prove the pin is load-bearing).
  const roleSwapped = rawEvidenceInput(result.evidence);
  roleSwapped.role = 'discuss';
  // No specific message asserted: D5 has TWO independent role<->kind checks
  // (enforcePromotion's own pin, and enforceDiscussPromotion's own role
  // guard reached via the kind dispatch) — either one alone is sufficient
  // to reject, and this fixture should stay green under a mutation that
  // removes just one of the two, not only both at once.
  assert.throws(
    () => compileCapabilityEvidence(roleSwapped),
    'a discuss-labeled row backed by consult_panel methodology is rejected by D5\'s role<->kind pinning',
  );
  assertions += 1;

  // (c) altered scope bytes ⇒ strict admission (evaluateCapabilityEvidence,
  // the same lookup path the D7 gate uses) rejects — the altered row does
  // not admit against the seat's REAL frozen scope.
  const scopeAltered = rawEvidenceInput(result.evidence);
  scopeAltered.scope = { ...scopeAltered.scope, domains: [...scopeAltered.scope.domains, 'injected-domain'] };
  const recompiledScopeAltered = compileCapabilityEvidence(scopeAltered);
  check(recompiledScopeAltered.scope_hash !== result.evidence.scope_hash,
    'altering scope bytes actually changes the compiled scope_hash (sanity)');
  const query = {
    role: 'consult',
    scope: frozenScopeForRole('consult'),
    identity: result.evidence.identity,
    evaluation_time: new Date(Date.now() + 1000).toISOString(),
  };
  const strictAdmission = evaluateCapabilityEvidence([recompiledScopeAltered], query);
  check(strictAdmission.state !== 'qualified',
    `an altered-scope row is refused by strict admission (state: ${strictAdmission.state})`);
  check(strictAdmission.applicability.reasons.includes('scope_mismatch'),
    'strict admission names scope_mismatch as the refusal reason');

  // Sanity/contrast: the UNALTERED row, queried against the SAME frozen
  // scope, DOES admit — proving (c) is about the alteration, not a broken query.
  const cleanAdmission = evaluateCapabilityEvidence([result.evidence], query);
  equal(cleanAdmission.state, 'qualified', 'the unaltered row admits against the real frozen scope (contrast case)');

  // (d) the row's scope_hash equals the SHARED derivation module's output —
  // never a re-derivation of scope bytes by hand in this test.
  const expectedScopeHash = sha256(canonicalJson(normalizeScope(frozenScopeForRole('consult'))));
  equal(result.evidence.scope_hash, expectedScopeHash,
    "the row's scope_hash matches the shared qualification-applicability-scope module's output");
}

process.stdout.write(`${assertions} assertions passed\n`);
