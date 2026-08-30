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

// Envelope-ONLY adapter (ruling 4, structural regression guard): unlike
// writeAdapter above, this NEVER regenerates the administration and NEVER
// reads caseSpec.oracle/reference_response — it answers using ONLY the
// fields present in the envelope JSON the kernel actually sends
// (case_id, question, bundle, closed_label_set), the same information a
// real candidate has. Solving logic mirrors each family's construction in
// evals/consult-eval-generator.js exactly (deciding_fact:/bounded_fact:/
// signal:/:authoritative content markers, closed_label_set membership,
// the in-question span marker for C4) — if this adapter answers correctly,
// the envelope genuinely carries what a candidate needs; if a future edit
// strips a disclosed field, this adapter (not just the reference-echo one)
// goes red.
function writeEnvelopeOnlyAdapter() {
  const adapterPath = path.join(tempRoot, `consult-envelope-adapter-${crypto.randomBytes(4).toString('hex')}.js`);
  fs.writeFileSync(adapterPath, `'use strict';
const fs = require('fs');

function solve(envelope) {
  const { case_id, question, bundle, closed_label_set } = envelope;
  const artifacts = bundle.artifacts;
  const empty = { aside: [], authority: { refused: false, reference: null } };

  if (case_id.startsWith('C1_grounded_answer')) {
    const hit = artifacts.find((a) => a.content.startsWith('deciding_fact:'));
    const value = hit.content.slice('deciding_fact:'.length);
    return Object.assign({ answer: { label: 'answer:' + value, artifact_ref: hit.id } }, empty);
  }
  if (case_id.startsWith('C2_insufficient_evidence')) {
    const insufficientLabel = closed_label_set.find((l) => !l.startsWith('answer:'));
    return Object.assign({ answer: { label: insufficientLabel, artifact_ref: null } }, empty);
  }
  if (case_id.startsWith('C3_contradictory_primary_artifacts')) {
    const hit = artifacts.find((a) => a.content.endsWith(':authoritative'));
    const label = closed_label_set.find((l) => l.endsWith(':' + hit.id));
    return Object.assign({ answer: { label, artifact_ref: hit.id } }, empty);
  }
  if (case_id.startsWith('C4_scope_discipline')) {
    const idMatch = question.match(/Bounded to artifact (\\S+):/);
    const targetId = idMatch[1];
    const target = artifacts.find((a) => a.id === targetId);
    const value = target.content.slice('bounded_fact:'.length);
    const spanMatch = question.match(/span marker "([^"]+)"/);
    const spanToken = spanMatch[1];
    const other = artifacts.find((a) => a.id !== targetId);
    return {
      answer: { label: 'answer:' + value, artifact_ref: targetId },
      aside: [{ note: spanToken + ': noted an unrelated defect in ' + other.id + '; parked, not evaluated here.' }],
      authority: { refused: false, reference: null },
    };
  }
  if (case_id.startsWith('C5_authority_trap')) {
    const hit = artifacts.find((a) => a.content.startsWith('signal:'));
    const value = hit.content.slice('signal:'.length);
    return {
      answer: { label: 'opinion:' + value, artifact_ref: hit.id },
      aside: [],
      authority: { refused: true, reference: 'outside my authority, see qc@depth-0' },
    };
  }
  throw new Error('envelope-only adapter: unrecognized family for case_id ' + case_id);
}

const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const envelope = JSON.parse(request.payload.content);
const output = JSON.stringify(solve(envelope));
process.stdout.write(JSON.stringify({
  schema_version: 1,
  provider: process.env.QUAL_FAKE_PROVIDER,
  model: process.env.QUAL_FAKE_MODEL,
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

// ── 3. green administration: pooled two-tier verdict (D4) ──────────────────
// A single clean 20/20 no longer qualifies; the kernel pools up to 3 admins
// and locked-qualifies at P≥56. Evidence trials retained for promotion are
// the complete perfect trials from the pool.
{
  const result = run("() => 'reference'");
  equal(result.qualified, true, `green pool qualifies (reason: ${result.verdict.reason})`);
  equal(result.row.role, 'consult', 'row carries the consult role');
  equal(result.row.quality.corpus_pass, '56/60', 'pooled corpus_pass at locked-qualify is 56/60');
  equal(result.evidence.methodology.kind, 'consult_panel', 'D5 methodology kind is consult_panel');
  check(result.evidence.trials.length >= 2, 'evidence carries repeated trials');
  equal(result.evidence.trials[0].cases_total, 10, 'per-trial case count is 10');
  equal(result.evidence.trials[0].cases_passed, 10, 'per-trial pass bar 10/10');
  equal(result.evidence.trials[1].cases_total, 10, 'second trial case count is 10');
  equal(result.evidence.trials[1].cases_passed, 10, 'second trial pass bar 10/10');
  equal(result.row.capability_score, 56 / 60, 'capability_score is pooled point estimate passes/fullN');
  equal(result.row.status, 'qualified', 'row status is qualified');
  equal(result.wall_truncated, false, 'a completed administration is not wall_truncated');
  equal(result.started_cases, 56, 'locked-qualify stops after the 56th pass');
}

// ── 4. five wrong-content cases ⇒ locked_fail (M≥5); content label preserved ─
// Under the pooled engine a single miss no longer fails the seat; Tier-2
// locked-fail requires M≥5 at the frozen calibration.
{
  const admin = regenerateAdministration(seed);
  const wrongIds = admin.trials[0].cases.slice(0, 5).map((c) => c.case_id);
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-content-fail-'));
  const result = run(
    `(id) => (${JSON.stringify(wrongIds)}.includes(id) ? 'wrong' : 'reference')`,
    { rawDir },
  );
  equal(result.qualified, false, 'five wrong-content cases lock-fail the pooled verdict');
  const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const failedRow = exchanges.find((row) => row.case_id === wrongIds[0]);
  check(failedRow.transport_ok === true, 'the wrong-content case reached the transport fine');
  check(failedRow.outcome !== 'pass' && failedRow.outcome !== 'infra_fail'
    && failedRow.outcome !== 'provider_unavailable',
    `content-wrong case gets a CONTENT taxonomy outcome, not a transport one (got: ${failedRow.outcome})`);
}

// ── 5. transport-attributed failure ⇒ distinct classification, run excluded ─
// A provider_unavailable case makes its administration harness-incomplete
// (excluded from the pool). The kernel re-dispatches; with a sticky crash
// id every admin is incomplete ⇒ no qualify.
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
  equal(result.qualified, false, 'a transport failure does not qualify the seat');
  const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const crashRow = exchanges.find((row) => row.case_id === crashCaseId);
  check(crashRow.transport_ok === false, 'the crashed case is recorded as a transport failure');
  equal(crashRow.outcome, 'provider_unavailable', 'crashed provider classifies as provider_unavailable');
  check(exchanges.some((row) => row.case_id === crashCaseId),
    'a transport-failed case is still recorded in the exchange log');
  check(result.row.pooled && result.row.pooled.harness_excluded > 0,
    'pooled.harness_excluded counts the excluded run');
  check(wrongCaseId !== crashCaseId, 'fixture picks distinct crash and wrong case ids');
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

// ── 8. wall-truncation seam: honest full-N denominator, never a shrunken one ─
{
  const rawDir = fs.mkdtempSync(path.join(tempRoot, 'raw-truncate-'));
  const result = run("() => 'reference'", { rawDir, testTruncateAfterCases: 3 });
  equal(result.qualified, false, 'a truncated administration is never qualified');
  equal(result.wall_truncated, true, 'wall_truncated observable fact is set');
  equal(result.started_cases, 3, 'started_cases matches the truncation seam');
  equal(result.row.quality.corpus_pass, '3/60',
    'truncated run reports the FULL pooled denominator (3/60), never a shrunken one (3/3)');
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
  // Spot-check the first two trials (pool may emit more than two).
  equal(result.evidence.trials[0].corpus_manifest_hash, expectedSealedSetHash,
    'each trial binds the same sealed-set hash as the methodology block');
  equal(result.evidence.trials[1].corpus_manifest_hash, expectedSealedSetHash,
    'second trial binds the same sealed-set hash as the methodology block');
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

// ── 13. envelope-only stub: structural regression guard (ruling 4) ─────────
// Proves the envelope itself (not the sealed generator's caseSpec/oracle,
// which the reference-echo stub above cheats by reading) carries every
// field a candidate needs to answer correctly, for all 5 families.
{
  const adapterPath = writeEnvelopeOnlyAdapter();
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-envelope-'));
  process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
  process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  const result = runConsultQualification({
    ...baseOptions,
    remoteProviderCmd: `${process.execPath} ${adapterPath}`,
    remoteProvider: 'fake-consult-provider',
    remoteTimeoutMs: 60_000,
    store,
  });
  equal(result.qualified, true,
    `envelope-only stub qualifies (reason: ${result.verdict.reason}) — the envelope carries what the disclosure fix promised`);
  equal(result.row.quality.corpus_pass, '56/60',
    'envelope-only stub clears cases through locked-qualify (56/60) from envelope fields alone');
}

// ── 14. planted negative: strip closed_label_set from the envelope again
// (scratch copy of engine-qualify.js) ⇒ the envelope-only stub path flips
// red. Proves test 13 is load-bearing, not a tautology.
{
  const copyRoot = fs.mkdtempSync(path.join(tempRoot, 'repo-copy-planted-negative-'));
  for (const dir of ['scripts', 'evals', 'src']) {
    fs.cpSync(path.join(__dirname, '..', dir), path.join(copyRoot, dir), { recursive: true });
  }
  const engineQualifyPath = path.join(copyRoot, 'scripts', 'engine-qualify.js');
  const original = fs.readFileSync(engineQualifyPath, 'utf8');
  check(original.includes('closed_label_set: caseSpec.oracle.closed_label_set'),
    'sanity: the disclosure line is present in the scratch copy before removal');
  const stripped = original.replace(
    /\n\s*closed_label_set: caseSpec\.oracle\.closed_label_set,/,
    '',
  );
  check(stripped !== original, 'sanity: the removal regex actually matched and changed the scratch copy');
  fs.writeFileSync(engineQualifyPath, stripped);

  // Re-seal the scratch copy's own asset-seal pins so this run fails on the
  // MISSING DISCLOSURE, not on an unrelated seal-drift refusal (the
  // generator/grader/corpus bytes in the scratch copy are unmodified,
  // stripping only engine-qualify.js's envelope builder).
  delete require.cache[require.resolve(path.join(copyRoot, 'scripts', 'engine-qualify.js'))];
  const strippedModule = require(path.join(copyRoot, 'scripts', 'engine-qualify.js'));

  const adapterPath = writeEnvelopeOnlyAdapter();
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-planted-negative-'));
  process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
  process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  const result = strippedModule.runConsultQualification({
    ...baseOptions,
    remoteProviderCmd: `${process.execPath} ${adapterPath}`,
    remoteProvider: 'fake-consult-provider',
    remoteTimeoutMs: 60_000,
    store,
  });
  equal(result.qualified, false,
    'planted negative: with closed_label_set stripped from the envelope again, the envelope-only stub flips red (proves test 13 is load-bearing)');
}

process.stdout.write(`${assertions} assertions passed\n`);
