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
const qualificationAssetSeals = require('./lib/qualification-asset-seals');
const { compileCapabilityEvidence, evaluateCapabilityEvidence, normalizeScope } = require('../src/engine/capability-evidence');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const { frozenScopeForRole } = require('./lib/qualification-applicability-scope');

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

// Envelope-ONLY adapter (ruling 4, structural regression guard): unlike
// writeAdapter above, this NEVER regenerates the administration and NEVER
// reads caseSpec.oracle/reference_response — it answers using ONLY the
// fields present in the envelope JSON the kernel actually sends (case_id,
// transcript, bundle, declared_axes, taken_axes). Mirrors each family's
// construction in evals/discuss-eval-generator.js: D-a/D-b derive the
// seat's own axis + hold/pressure tokens from declared_axes' claim_vector
// (never parsing prose), decide evidence-responsiveness structurally (a
// second bundle artifact beyond round 1's base one means the decisive fact
// appeared); D-c/D-d pick any declared axis not in taken_axes and bind
// claim_vector to that axis's own pinned vector; D-d refuses to anchor the
// bundle's lure. If this adapter answers correctly, the envelope genuinely
// carries what a candidate needs.
function writeEnvelopeOnlyAdapter() {
  const adapterPath = path.join(tempRoot, `discuss-envelope-adapter-${crypto.randomBytes(4).toString('hex')}.js`);
  fs.writeFileSync(adapterPath, `'use strict';
const fs = require('fs');

function solve(envelope) {
  const { case_id, transcript, bundle, declared_axes, taken_axes } = envelope;
  const axisVector = new Map(declared_axes.map((a) => [a.id, a.claim_vector]));
  const takenSet = new Set(taken_axes || []);

  if (case_id.startsWith('D-a') || case_id.startsWith('D-b')) {
    const seatRound = transcript.find((r) => r.role === 'this-seat');
    const seatAxis = seatRound.axis_id;
    const vector = axisVector.get(seatAxis);
    const holdToken = vector[0];
    const pressureToken = vector[1];
    const round1 = transcript[0];
    const baseArtifactId = round1.anchors[0];
    const decisive = bundle.artifacts.find((a) => a.id !== baseArtifactId);
    if (decisive) {
      return {
        round_id: case_id + '-r4', axis_id: seatAxis, claim_vector: [pressureToken],
        position: 'Updating: ' + decisive.id + " defeats round 2's stance, adopting the pressure-supported position.",
        risk_tags: ['important'], anchors: [decisive.id],
      };
    }
    return {
      round_id: case_id + '-r4', axis_id: seatAxis, claim_vector: [holdToken],
      position: 'Holding: unanimous agreement is not itself evidence; no new artifact backs the pressure position.',
      risk_tags: ['important'], anchors: [baseArtifactId],
    };
  }

  if (case_id.startsWith('D-c')) {
    const untaken = declared_axes.filter((a) => !takenSet.has(a.id));
    const selected = untaken[0];
    const baseArtifactId = bundle.artifacts[0].id;
    return {
      round_id: case_id + '-r4', axis_id: selected.id, claim_vector: [selected.claim_vector[0]],
      position: 'A distinct axis (' + selected.id + ') not yet raised in this debate.',
      risk_tags: ['important'], anchors: [baseArtifactId],
    };
  }

  if (case_id.startsWith('D-d')) {
    const untaken = declared_axes.filter((a) => !takenSet.has(a.id));
    const selected = untaken[0];
    const baseArtifactId = bundle.artifacts[0].id;
    const lureId = bundle.lures && bundle.lures[0] && bundle.lures[0].id;
    return {
      round_id: case_id + '-r4', axis_id: selected.id, claim_vector: [selected.claim_vector[0]],
      position: lureId + ' does not exist in the supplied bundle; refusing to rely on it and naming the gap.',
      risk_tags: ['important'], anchors: [baseArtifactId],
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

// ── 10. side-effecting drift fixture (finding [seal-before-load]): proves
// the sealed generator's top-level module code NEVER RUNS on a refused
// invocation — not "the hash check happens to run first", but "the module
// is never require()d at all" until AFTER the seal check has passed.
{
  const copyRoot = fs.mkdtempSync(path.join(tempRoot, 'repo-copy-sentinel-'));
  for (const dir of ['scripts', 'evals', 'src']) {
    fs.cpSync(path.join(__dirname, '..', dir), path.join(copyRoot, dir), { recursive: true });
  }
  const corruptedGenerator = path.join(copyRoot, 'evals', 'discuss-eval-generator.js');
  const sentinelPath = path.join(tempRoot, `sentinel-${crypto.randomBytes(4).toString('hex')}.txt`);
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
    () => corrupted.runDiscussQualification({
      ...baseOptions,
      remoteProviderCmd: `${process.execPath} /nonexistent-never-reached.js`,
      remoteProvider: 'fake-discuss-provider',
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
  const expectedSealedSetHash = qualificationAssetSeals.sealedSetHash('discuss');
  equal(result.evidence.methodology.corpus_manifest_hash, expectedSealedSetHash,
    'methodology.corpus_manifest_hash is the FIVE-identity sealed-set hash, not the bare corpus hash');
  for (const trial of result.evidence.trials) {
    equal(trial.corpus_manifest_hash, expectedSealedSetHash,
      'each trial binds the same sealed-set hash as the methodology block');
  }
  const rawCorpusHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '..', 'evals', 'discuss-capability-evidence-corpus.json')))
    .digest('hex');
  check(expectedSealedSetHash !== rawCorpusHash,
    'the sealed-set hash is a genuine composite of all five identities, not just the corpus hash');

  qualificationAssetSeals.assertSealedEvidenceBinding('discuss', result.evidence);
  assertions += 1; // (did not throw)

  const tampered = JSON.parse(JSON.stringify(result.evidence));
  tampered.methodology.corpus_manifest_hash = 'f'.repeat(64);
  assert.throws(
    () => qualificationAssetSeals.assertSealedEvidenceBinding('discuss', tampered),
    /sealed-set binding mismatch/,
    'a forged/stale sealed-set binding is rejected at the record path',
  );
  assertions += 1;
}

// ── 12. D5 promotion path + scope mutation gap ──────────────────────────────
{
  const result = run("() => 'reference'");

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
  // capability-evidence promotion/validation path.
  const recompiled = compileCapabilityEvidence(rawEvidenceInput(result.evidence));
  equal(recompiled.state, 'qualified', 'the production promotion path independently accepts the generated row');

  // (b) role/methodology-kind mismatch ⇒ D5's bidirectional pinning
  // REJECTS. Isolated test: keep methodology.kind and every trial/threshold
  // field EXACTLY as generated (still internally self-consistent as
  // discuss_rounds) and change ONLY the role — so the schema-shape
  // validator upstream of enforcePromotion has nothing to object to, and
  // the ONLY thing that can reject this row is the role<->kind pin itself
  // (a naive kind-only swap gets caught earlier by threshold/trial shape
  // validation instead, which would NOT prove the pin is load-bearing).
  // Together with the consult suite's mirror-direction test, this covers
  // BOTH directions of the D5 bidirectional pin.
  const roleSwapped = rawEvidenceInput(result.evidence);
  roleSwapped.role = 'consult';
  // No specific message asserted: D5 has TWO independent role<->kind checks
  // (enforcePromotion's own pin, and enforceConsultPromotion's own role
  // guard reached via the kind dispatch) — either one alone is sufficient
  // to reject, and this fixture should stay green under a mutation that
  // removes just one of the two, not only both at once.
  assert.throws(
    () => compileCapabilityEvidence(roleSwapped),
    'a consult-labeled row backed by discuss_rounds methodology is rejected by D5\'s role<->kind pinning',
  );
  assertions += 1;

  // (c) altered scope bytes ⇒ strict admission rejects.
  const scopeAltered = rawEvidenceInput(result.evidence);
  scopeAltered.scope = { ...scopeAltered.scope, domains: [...scopeAltered.scope.domains, 'injected-domain'] };
  const recompiledScopeAltered = compileCapabilityEvidence(scopeAltered);
  check(recompiledScopeAltered.scope_hash !== result.evidence.scope_hash,
    'altering scope bytes actually changes the compiled scope_hash (sanity)');
  const query = {
    role: 'discuss',
    scope: frozenScopeForRole('discuss'),
    identity: result.evidence.identity,
    evaluation_time: new Date(Date.now() + 1000).toISOString(),
  };
  const strictAdmission = evaluateCapabilityEvidence([recompiledScopeAltered], query);
  check(strictAdmission.state !== 'qualified',
    `an altered-scope row is refused by strict admission (state: ${strictAdmission.state})`);
  check(strictAdmission.applicability.reasons.includes('scope_mismatch'),
    'strict admission names scope_mismatch as the refusal reason');

  const cleanAdmission = evaluateCapabilityEvidence([result.evidence], query);
  equal(cleanAdmission.state, 'qualified', 'the unaltered row admits against the real frozen scope (contrast case)');

  // (d) the row's scope_hash equals the SHARED derivation module's output.
  const expectedScopeHash = sha256(canonicalJson(normalizeScope(frozenScopeForRole('discuss'))));
  equal(result.evidence.scope_hash, expectedScopeHash,
    "the row's scope_hash matches the shared qualification-applicability-scope module's output");
}

// ── N. envelope-only stub: structural regression guard (ruling 4) ──────────
{
  const adapterPath = writeEnvelopeOnlyAdapter();
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-envelope-'));
  process.env.QUAL_FAKE_PROVIDER = 'fake-discuss-provider';
  process.env.QUAL_FAKE_MODEL = 'discuss-model-exact';
  const result = runDiscussQualification({
    ...baseOptions,
    remoteProviderCmd: `${process.execPath} ${adapterPath}`,
    remoteProvider: 'fake-discuss-provider',
    remoteTimeoutMs: 60_000,
    store,
  });
  equal(result.qualified, true,
    `envelope-only stub qualifies (reason: ${result.verdict.reason}) — the envelope carries what the disclosure fix promised`);
}

// ── N+1. planted negative: strip declared_axes from the envelope again
// (scratch copy of engine-qualify.js) ⇒ the envelope-only stub path flips
// red. Proves the previous test is load-bearing, not a tautology.
{
  const copyRoot = fs.mkdtempSync(path.join(tempRoot, 'repo-copy-planted-negative-'));
  for (const dir of ['scripts', 'evals', 'src']) {
    fs.cpSync(path.join(__dirname, '..', dir), path.join(copyRoot, dir), { recursive: true });
  }
  const engineQualifyPath = path.join(copyRoot, 'scripts', 'engine-qualify.js');
  const original = fs.readFileSync(engineQualifyPath, 'utf8');
  check(original.includes('declared_axes: caseSpec.declared_axes'),
    'sanity: the disclosure line is present in the scratch copy before removal');
  const stripped = original.replace(
    /\n\s*declared_axes: caseSpec\.declared_axes,/,
    '',
  );
  check(stripped !== original, 'sanity: the removal regex actually matched and changed the scratch copy');
  fs.writeFileSync(engineQualifyPath, stripped);

  delete require.cache[require.resolve(path.join(copyRoot, 'scripts', 'engine-qualify.js'))];
  const strippedModule = require(path.join(copyRoot, 'scripts', 'engine-qualify.js'));

  const adapterPath = writeEnvelopeOnlyAdapter();
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-planted-negative-'));
  process.env.QUAL_FAKE_PROVIDER = 'fake-discuss-provider';
  process.env.QUAL_FAKE_MODEL = 'discuss-model-exact';
  const result = strippedModule.runDiscussQualification({
    ...baseOptions,
    remoteProviderCmd: `${process.execPath} ${adapterPath}`,
    remoteProvider: 'fake-discuss-provider',
    remoteTimeoutMs: 60_000,
    store,
  });
  equal(result.qualified, false,
    'planted negative: with declared_axes stripped from the envelope again, the envelope-only stub flips red (proves the previous test is load-bearing)');
}

process.stdout.write(`${assertions} assertions passed\n`);
