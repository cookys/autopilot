#!/usr/bin/env bash
set -uo pipefail

. "$(dirname "$0")/lib.sh"

NODE_STATUS=0
node - "$REPO_ROOT" <<'NODE' || NODE_STATUS=$?
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.argv[2];
const {
  buildCapabilityEvidenceReceipt,
  capabilityEvidenceProducerHash,
  compileCapabilityEvidence,
  evaluateCapabilityEvidence,
  normalizeCapabilityEvidenceReceipt,
  verifyEvaluationCorpus,
} = require(path.join(root, 'src', 'engine', 'capability-evidence'));
const {
  ROLE_IDS,
  ROLES,
  normalizeRole,
  CAPABILITY_ROLE_IDS,
} = require(path.join(root, 'src', 'engine', 'roles'));
const { validateJsonSchema } = require(path.join(root, 'scripts', 'validate-json-schema'));

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}
function rejects(fn, pattern, message) {
  assert.throws(fn, pattern);
  passed += 1;
  process.stdout.write(`PASS: ${message}\n`);
}

check(Object.isFrozen(ROLE_IDS), 'canonical role ids are frozen');
check(Object.isFrozen(ROLES), 'public role membership view is frozen');
check(typeof ROLES.add === 'undefined', 'public role membership view exposes no mutation API');
check(normalizeRole('rogue') === null, 'unknown role is rejected before mutation attempt');
rejects(
  () => ROLES.add('rogue'),
  /is not a function/,
  'public role membership cannot be mutated',
);
check(normalizeRole('rogue') === null, 'failed mutation cannot change role normalization');

const digest = (seed) => require('crypto').createHash('sha256').update(seed).digest('hex');
const scope = {
  task_classes: ['code_review'],
  domains: ['shell'],
  languages: ['en'],
  tool_surface: ['diff_read'],
};
const identity = {
  identity: 'test-reviewer-v1',
  model_alias: 'test-reviewer',
  model_version: '2026-07-26',
  family: 'test-family',
  runner: 'test-runner',
  runner_version: '1.2.3',
  harness_version: 'review-harness-v2',
  effort: 'high',
  prompt_config_hash: digest('prompt'),
  semantic_fingerprint: digest('semantic'),
  containment_fingerprint: digest('containment'),
  identity_resolved: true,
};
const methodology = {
  kind: 'role_eval',
  name: 'reviewer-known-bad-clean',
  version: '2.0.0',
  corpus_version: 'known-bad-clean-v2',
  corpus_manifest_hash: digest('corpus'),
  thresholds: {
    min_trials: 2,
    min_known_bad_cases: 10,
    min_critical_cases: 5,
    max_false_pass_critical: 0,
    min_clean_cases: 5,
    max_clean_false_positives: 0,
  },
  basis: null,
};
function supplementalMethodology(kind, seed) {
  return {
    kind,
    name: `${kind}-observation`,
    version: '1.0.0',
    corpus_version: null,
    corpus_manifest_hash: null,
    thresholds: null,
    basis: {
      cohort: `${kind}-cohort`,
      cohort_hash: digest(`${seed}-cohort`),
      observation_hash: digest(`${seed}-observation`),
      dimensions: ['regression-signal'],
      applicability: ['exact-identity', 'exact-scope'],
    },
  };
}
function trial(id, observedAt) {
  return {
    trial_id: id,
    observed_at: observedAt,
    known_bad_total: 13,
    known_bad_caught: 13,
    critical_total: 9,
    false_pass_critical: 0,
    clean_total: 11,
    clean_false_positives: 0,
    corpus_manifest_hash: methodology.corpus_manifest_hash,
    artifact_oracle: {
      kind: 'fixture_manifest',
      oracle_hash: digest(`oracle-${id}`),
      result_set_hash: digest(`results-${id}`),
      independent: true,
      passed: true,
    },
    mutation_validation: {
      target_id: '01-dropped-error-check',
      original_hash: digest(`original-${id}`),
      mutated_hash: digest(`mutated-${id}`),
      original_verdict: 'fail',
      mutated_verdict: 'pass',
      oracle_rejected: true,
    },
  };
}
function qualifiedInput(overrides = {}) {
  return {
    schema_version: 1,
    source: 'internal_eval',
    source_ref: 'engine-qualify:reviewer',
    state: 'qualified',
    role: 'reviewer',
    scope,
    identity,
    issued_at: '2026-07-26T02:00:00.000Z',
    observed_at: '2026-07-26T01:30:00.000Z',
    expires_at: '2026-08-25T02:00:00.000Z',
    methodology,
    trials: [
      trial('trial-1', '2026-07-26T01:00:00.000Z'),
      trial('trial-2', '2026-07-26T01:30:00.000Z'),
    ],
    revocation: null,
    supersedes: null,
    ...overrides,
  };
}

const qualified = compileCapabilityEvidence(qualifiedInput());
const evidenceSchema = JSON.parse(fs.readFileSync(
  path.join(root, 'schemas', 'capability-evidence.schema.json'),
  'utf8',
));
// SPLIT (plan 2026-08-28-consult-discuss-qualification.md §2.6, generation-2
// namespace revision): capability-evidence validates against the wider
// CAPABILITY_ROLE_IDS (adds the two qualification-seat-only roles `consult`
// and `discuss`); task-authority-envelope and role-execution-grant — the
// execution-authority schemas — stay on the untouched execution ROLE_IDS.
// A single shared equality assertion here would be exactly the
// one-object-shared-by-two-populations mistake the plan repairs.
{
  const schemaName = 'capability-evidence.schema.json';
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', schemaName), 'utf8'));
  check(
    JSON.stringify(schema.$defs.role.enum) === JSON.stringify(CAPABILITY_ROLE_IDS),
    `${schemaName} uses the capability role taxonomy (includes consult/discuss)`,
  );
}
for (const schemaName of [
  'task-authority-envelope.schema.json',
  'role-execution-grant.schema.json',
]) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', schemaName), 'utf8'));
  check(
    JSON.stringify(schema.$defs.role.enum) === JSON.stringify(ROLE_IDS),
    `${schemaName} uses the canonical EXECUTION role taxonomy (never consult/discuss)`,
  );
  for (const bogusRole of ['consult', 'discuss']) {
    check(
      validateJsonSchema(schema.$defs.role, bogusRole).valid === false,
      `${schemaName} role enum REJECTS the qualification-seat role '${bogusRole}' — `
      + 'neither role may appear in an effect permission or a role-execution grant',
    );
  }
}
check(validateJsonSchema(evidenceSchema, qualified).valid === true, 'canonical evidence matches its JSON schema');
check(
  validateJsonSchema({ type: ['string', 'null'] }, null).valid === true,
  'schema validator accepts a supported nullable type union',
);
check(
  validateJsonSchema({ type: ['string', 'null'] }, 1).valid === false,
  'schema validator enforces every member of a type union',
);
rejects(
  () => validateJsonSchema({ type: ['string', 'string'] }, 'value'),
  /type is unsupported/,
  'schema validator rejects duplicate union members',
);
check(qualified.evidence_id === qualified.evidence_hash, 'evidence id is its content hash');
// Scope/identity hashes use canonical JSON, not insertion order. Recompilation proves stability.
check(
  compileCapabilityEvidence({
    ...qualifiedInput(),
    scope: {
      languages: ['en'],
      domains: ['shell'],
      tool_surface: ['diff_read'],
      task_classes: ['code_review'],
    },
  }).scope_hash === qualified.scope_hash,
  'scope hash is canonical',
);
check(qualified.trials.length === 2, 'qualified evidence retains repeated trials');

for (const source of ['external_prior', 'self_report', 'ordinary_receipt', 'runtime_probe']) {
  rejects(
    () => compileCapabilityEvidence(qualifiedInput({ source })),
    /cannot produce qualified evidence/,
    `${source} cannot produce qualified evidence`,
  );
}

const externalPrior = compileCapabilityEvidence({
  ...qualifiedInput({
    source: 'external_prior',
    source_ref: 'artificial-analysis-api-v2',
    state: 'provisional',
    role: 'implementer',
    identity: {
      ...identity,
      identity: 'aa-stable-model-id',
      runner: 'aa-model-level',
      runner_version: 'api-v2',
      harness_version: 'unresolved',
      identity_resolved: false,
    },
    methodology: {
      kind: 'external_prior',
      name: 'artificial-analysis-model-prior',
      version: 'api-v2',
      corpus_version: null,
      corpus_manifest_hash: null,
      thresholds: null,
      basis: {
        cohort: 'intelligence-index-v4.1',
        cohort_hash: digest('aa-cohort'),
        observation_hash: digest('aa-observation'),
        dimensions: ['agentic-index', 'coding-index'],
        applicability: ['cloud-model-level', 'english'],
      },
    },
    trials: [],
  }),
});
check(externalPrior.state === 'provisional', 'external prior can produce provisional evidence');
check(externalPrior.trials.length === 0, 'external prior carries no fabricated reviewer trials');
check(externalPrior.methodology.thresholds === null, 'external prior carries no reviewer thresholds');
const {
  evidence_id: externalEvidenceId,
  evidence_hash: externalEvidenceHash,
  scope_hash: externalScopeHash,
  identity_hash: externalIdentityHash,
  grant_identity_hash: externalGrantIdentityHash,
  trial_set_hash: externalTrialSetHash,
  ...externalPriorBody
} = externalPrior;
const equalTimeDegraded = compileCapabilityEvidence({
  ...externalPriorBody,
  state: 'degraded',
  methodology: {
    ...externalPriorBody.methodology,
    basis: {
      ...externalPriorBody.methodology.basis,
      observation_hash: digest('aa-equal-time-retirement'),
    },
  },
});
check(
  evaluateCapabilityEvidence([externalPrior, equalTimeDegraded], {
    role: externalPrior.role,
    scope: externalPrior.scope,
    identity: externalPrior.identity,
    evaluation_time: externalPrior.issued_at,
  }).state === 'degraded',
  'restrictive evidence wins equal observed_at ties deterministically',
);
check(
  validateJsonSchema(evidenceSchema, externalPrior).valid === true,
  'external prior discriminated evidence matches its JSON schema',
);
check(
  validateJsonSchema(evidenceSchema, {
    ...externalPrior,
    source: 'external_prior',
    methodology: methodology,
  }).valid === false,
  'schema rejects a source/methodology discriminant mismatch',
);
check(
  validateJsonSchema(evidenceSchema, {
    ...externalPrior,
    trials: [trial('fabricated', '2026-07-26T01:00:00.000Z')],
  }).valid === false,
  'schema rejects reviewer trials on non-role-eval evidence',
);
check(
  validateJsonSchema(evidenceSchema, {
    ...externalPrior,
    state: 'qualified',
  }).valid === false,
  'schema enforces the external-prior state ceiling',
);
rejects(
  () => compileCapabilityEvidence(qualifiedInput({
    state: 'provisional',
    source: 'external_prior',
    trials: [],
  })),
  /requires external_prior methodology/,
  'external prior cannot reuse a reviewer methodology',
);
rejects(
  () => compileCapabilityEvidence({
    ...externalPrior,
    evidence_id: undefined,
    evidence_hash: undefined,
    trial_set_hash: undefined,
    trials: [trial('fabricated', '2026-07-26T01:00:00.000Z')],
  }),
  /cannot carry reviewer eval trials/,
  'external prior cannot fabricate reviewer eval trials',
);

rejects(
  () => compileCapabilityEvidence(qualifiedInput({ trials: [trial('trial-1', '2026-07-26T01:00:00.000Z')] })),
  /repeated trials/,
  'one successful run cannot promote',
);
const criticalMiss = qualifiedInput();
criticalMiss.trials[1].false_pass_critical = 1;
rejects(
  () => compileCapabilityEvidence(criticalMiss),
  /false-pass-on-Critical floor/,
  'reviewer Critical false-pass blocks promotion',
);
const dirtyClean = qualifiedInput();
dirtyClean.trials[1].clean_false_positives = 1;
rejects(
  () => compileCapabilityEvidence(dirtyClean),
  /clean-specificity floor/,
  'reviewer clean-specificity miss blocks promotion',
);
const vacuous = qualifiedInput();
vacuous.trials[1].mutation_validation.oracle_rejected = false;
rejects(
  () => compileCapabilityEvidence(vacuous),
  /mutation validation/,
  'vacuous mutation oracle blocks promotion',
);
const dependentOracle = qualifiedInput();
dependentOracle.trials[1].artifact_oracle.independent = false;
rejects(
  () => compileCapabilityEvidence(dependentOracle),
  /independent artifact oracle/,
  'dependent artifact oracle blocks promotion',
);

const exact = evaluateCapabilityEvidence([qualified], {
  role: 'reviewer',
  scope,
  identity,
  evaluation_time: '2026-07-27T00:00:00.000Z',
  observation: {
    identity_hash: qualified.identity_hash,
    critical_miss: false,
    probe_regression: false,
  },
});
check(exact.state === 'qualified', 'exact fresh evidence qualifies');
check(exact.applicability.applicable === true, 'exact scope and identity are applicable');

const ordinaryReceipt = compileCapabilityEvidence(qualifiedInput({
  source: 'ordinary_receipt',
  source_ref: 'ordinary-work:receipt-1',
  state: 'provisional',
  issued_at: '2026-07-26T04:00:00.000Z',
  observed_at: '2026-07-26T03:30:00.000Z',
  expires_at: '2026-08-01T04:00:00.000Z',
  methodology: supplementalMethodology('ordinary_receipt', 'receipt-1'),
  trials: [],
}));
const supplemented = evaluateCapabilityEvidence([qualified, ordinaryReceipt], {
  role: 'reviewer',
  scope,
  identity,
  evaluation_time: '2026-07-27T00:00:00.000Z',
});
check(supplemented.state === 'qualified', 'ordinary successful receipt cannot replace promotion evidence');
check(supplemented.evidence_id === qualified.evidence_id, 'ordinary receipt remains supplemental');

const regressionReceipt = compileCapabilityEvidence(qualifiedInput({
  source: 'ordinary_receipt',
  source_ref: 'ordinary-work:regression-1',
  state: 'degraded',
  issued_at: '2026-07-26T04:00:00.000Z',
  observed_at: '2026-07-26T03:30:00.000Z',
  expires_at: '2026-08-01T04:00:00.000Z',
  methodology: supplementalMethodology('ordinary_receipt', 'regression-1'),
  trials: [],
  supersedes: qualified.evidence_id,
}));
check(evaluateCapabilityEvidence([qualified, regressionReceipt], {
  role: 'reviewer',
  scope,
  identity,
  evaluation_time: '2026-07-27T00:00:00.000Z',
}).state === 'degraded', 'ordinary regression receipt may demote but never promote');

const unboundRegression = compileCapabilityEvidence(qualifiedInput({
  source: 'ordinary_receipt',
  source_ref: 'ordinary-work:unbound-regression',
  state: 'degraded',
  issued_at: '2026-07-26T04:00:00.000Z',
  observed_at: '2026-07-26T03:30:00.000Z',
  expires_at: '2026-08-01T04:00:00.000Z',
  methodology: supplementalMethodology('ordinary_receipt', 'unbound-regression'),
  trials: [],
  supersedes: null,
}));
rejects(
  () => evaluateCapabilityEvidence([qualified, unboundRegression], {
    role: 'reviewer',
    scope,
    identity,
    evaluation_time: '2026-07-27T00:00:00.000Z',
  }),
  /not bound to the active qualification/,
  'an untargeted restrictive record cannot demote the wrong qualification',
);

const unrelatedId = digest('unrelated-target');
const unrelatedRevocation = compileCapabilityEvidence(qualifiedInput({
  source: 'runtime_probe',
  source_ref: 'runtime-probe:unrelated',
  state: 'revoked',
  issued_at: '2026-07-26T04:00:00.000Z',
  observed_at: '2026-07-26T03:30:00.000Z',
  expires_at: '2026-08-01T04:00:00.000Z',
  methodology: supplementalMethodology('runtime_probe', 'unrelated-runtime'),
  trials: [],
  revocation: {
    reason: 'probe_regression',
    observation_hash: digest('unrelated-observation'),
    target_evidence_id: unrelatedId,
  },
  supersedes: unrelatedId,
}));
rejects(
  () => evaluateCapabilityEvidence([qualified, unrelatedRevocation], {
    role: 'reviewer',
    scope,
    identity,
    evaluation_time: '2026-07-27T00:00:00.000Z',
  }),
  /supersedes an unknown record/,
  'revocation target and supersedes must resolve in the exact ledger',
);

const wrongDomain = evaluateCapabilityEvidence([qualified], {
  role: 'reviewer',
  scope: { ...scope, domains: ['typescript'] },
  identity,
  evaluation_time: '2026-07-27T00:00:00.000Z',
});
check(wrongDomain.state === 'unknown', 'domain mismatch does not qualify');
check(wrongDomain.applicability.reasons.includes('scope_mismatch'), 'domain mismatch is disclosed');

const wrongRole = evaluateCapabilityEvidence([qualified], {
  role: 'implementer',
  scope,
  identity,
  evaluation_time: '2026-07-27T00:00:00.000Z',
});
check(wrongRole.state === 'unknown', 'role mismatch does not qualify');

const wrongIdentity = evaluateCapabilityEvidence([qualified], {
  role: 'reviewer',
  scope,
  identity: { ...identity, runner_version: '1.2.4' },
  evaluation_time: '2026-07-27T00:00:00.000Z',
});
check(wrongIdentity.state === 'unknown', 'identity mismatch does not qualify');
check(wrongIdentity.applicability.reasons.includes('identity_mismatch'), 'identity mismatch is disclosed');

const expired = evaluateCapabilityEvidence([qualified], {
  role: 'reviewer',
  scope,
  identity,
  evaluation_time: '2026-08-26T00:00:00.000Z',
});
check(expired.state === 'stale', 'expired evidence deterministically becomes stale');

const future = evaluateCapabilityEvidence([qualified], {
  role: 'reviewer',
  scope,
  identity,
  evaluation_time: '2026-07-26T00:30:00.000Z',
});
check(future.state === 'unknown', 'future-dated evidence cannot qualify early');
check(
  future.applicability.reasons.includes('evidence_not_yet_valid'),
  'future-dated evidence reports the not-yet-valid reason',
);

for (const observation of [
  { identity_hash: qualified.identity_hash, critical_miss: true, probe_regression: false },
  { identity_hash: qualified.identity_hash, critical_miss: false, probe_regression: true },
  { identity_hash: digest('different-live-identity'), critical_miss: false, probe_regression: false },
]) {
  const result = evaluateCapabilityEvidence([qualified], {
    role: 'reviewer',
    scope,
    identity,
    evaluation_time: '2026-07-27T00:00:00.000Z',
    observation,
  });
  check(result.state === 'revoked', 'trusted regression observation immediately revokes');
  check(result.revocation_reason !== null, 'revocation reason is disclosed');
}

const receipt = buildCapabilityEvidenceReceipt(qualified, {
  role: 'reviewer',
  scope,
  identity,
  evaluation_time: '2026-07-27T00:00:00.000Z',
});
check(receipt.provenance.source === 'internal_eval', 'receipt exposes provenance');
check(receipt.applicability.applicable === true, 'receipt exposes applicability');
check(receipt.expires_at === qualified.expires_at, 'receipt exposes expiry');
check(receipt.methodology_version === '2.0.0', 'receipt exposes methodology version');
check(receipt.trial_set_hash === qualified.trial_set_hash, 'receipt binds the trial set');
rejects(
  () => normalizeCapabilityEvidenceReceipt({
    ...receipt,
    applicability: {
      ...receipt.applicability,
      requested_scope_hash: digest('wrong-requested-scope'),
    },
  }, { verify: () => true }),
  /applicability hashes/,
  'receipt applicability cannot claim a different requested scope',
);
rejects(
  () => normalizeCapabilityEvidenceReceipt({
    ...receipt,
    revocation_reason: 'critical_miss',
  }, { verify: () => true }),
  /non-revoked/,
  'qualified receipt cannot carry a contradictory revocation reason',
);

const expiringSelfReport = compileCapabilityEvidence(qualifiedInput({
  source: 'self_report',
  source_ref: 'self-report:limited',
  state: 'provisional',
  issued_at: '2026-07-26T02:00:00.000Z',
  observed_at: '2026-07-26T01:30:00.000Z',
  expires_at: '2026-07-27T02:00:00.000Z',
  methodology: supplementalMethodology('self_report', 'limited-self-report'),
  trials: [],
}));
const staleSelfReport = buildCapabilityEvidenceReceipt(expiringSelfReport, {
  role: 'reviewer',
  scope,
  identity,
  evaluation_time: '2026-07-28T00:00:00.000Z',
});
check(staleSelfReport.state === 'stale', 'expired self-report derives a stale receipt');
check(
  normalizeCapabilityEvidenceReceipt(staleSelfReport, {
    verify: (candidate) => candidate.evidence_id === staleSelfReport.evidence_id,
  }).state === 'stale',
  'derived stale self-report receipt remains structurally valid',
);
rejects(
  () => normalizeCapabilityEvidenceReceipt(receipt),
  /trusted evidence resolver/,
  'standalone caller-authored receipt cannot cross the trust boundary',
);

const store = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-evidence-store-'));
try {
  const evidencePath = path.join(store, 'evidence.json');
  const scopePath = path.join(store, 'scope.json');
  const identityPath = path.join(store, 'identity.json');
  const observationPath = path.join(store, 'observation.json');
  fs.writeFileSync(evidencePath, JSON.stringify(qualified));
  fs.writeFileSync(scopePath, JSON.stringify(scope));
  fs.writeFileSync(identityPath, JSON.stringify(identity));
  fs.writeFileSync(observationPath, JSON.stringify({
    identity_hash: qualified.identity_hash,
    critical_miss: true,
    probe_regression: false,
  }));
  const cli = path.join(root, 'scripts', 'engine-capability-state.js');
  const env = { ...process.env, ENGINE_CAPABILITY_DIR: store };
  const run = (args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const recorded = run(['record-evidence', '--file', evidencePath]);
  check(recorded.status === 1, 'public record-evidence cannot mint qualified internal evidence');
  const qualifierWrapper = {
    event_id: 1,
    producer: 'engine-qualify-v2',
    transcript_hash: capabilityEvidenceProducerHash(qualified, 'engine-qualify-v2'),
    evidence: qualified,
  };
  fs.writeFileSync(
    path.join(store, 'qualification-evidence.jsonl'),
    `${JSON.stringify(qualifierWrapper)}\n`,
  );
  const current = run([
    'current-evidence',
    '--role', 'reviewer',
    '--scope-file', scopePath,
    '--identity-file', identityPath,
    '--now', '2026-07-27T00:00:00.000Z',
  ]);
  check(current.status === 0, `current-evidence succeeds: ${current.stderr}`);
  check(
    JSON.parse(current.stdout).receipt.state === 'provisional'
      && JSON.parse(current.stdout).observed_state === 'qualified',
    'evidence store reports a qualification only as provisional telemetry',
  );
  check(
    JSON.parse(current.stdout).admissible === false
      && JSON.parse(current.stdout).authority_status === 'untrusted_telemetry',
    'directly written same-UID evidence cannot become admission authority',
  );
  check(
    JSON.parse(current.stdout).store_anchor.producer === 'engine-qualify-v2',
    'evidence telemetry retains its reported producer for diagnostics',
  );

  fs.writeFileSync(evidencePath, JSON.stringify(ordinaryReceipt));
  check(run(['record-evidence', '--file', evidencePath]).status === 0, 'ordinary receipt is recorded');
  const supplementedReport = run([
    'report-evidence',
    '--role', 'reviewer',
    '--now', '2026-07-27T00:00:00.000Z',
  ]);
  check(
    JSON.parse(supplementedReport.stdout)[0].observed_state === 'qualified'
      && JSON.parse(supplementedReport.stdout)[0].receipt.state === 'provisional',
    'evidence report keeps the observed result without granting admission',
  );
  fs.writeFileSync(evidencePath, JSON.stringify(unboundRegression));
  check(
    run(['record-evidence', '--file', evidencePath]).status === 1,
    'record-evidence rejects an untargeted restrictive lifecycle write',
  );

  const revoked = run([
    'current-evidence',
    '--role', 'reviewer',
    '--scope-file', scopePath,
    '--identity-file', identityPath,
    '--observation-file', observationPath,
    '--now', '2026-07-27T00:00:00.000Z',
  ]);
  check(
    JSON.parse(revoked.stdout).receipt.state === 'revoked',
    'trusted Critical miss revokes store view',
  );
  const report = run([
    'report-evidence',
    '--role', 'reviewer',
    '--now', '2026-07-27T00:00:00.000Z',
  ]);
  check(JSON.parse(report.stdout).length === 1, 'evidence report returns latest exact deployment');
  check(
    JSON.parse(report.stdout)[0].receipt.state === 'revoked',
    'trusted Critical miss persists as canonical revocation evidence',
  );
  check(
    run([
      'current-evidence',
      '--role', 'reviewer',
      '--scope-file', scopePath,
      '--identity-file', identityPath,
      '--observation-fiel', observationPath,
    ]).status === 2,
    'unknown observation option fails closed instead of being ignored',
  );

  fs.appendFileSync(path.join(store, 'qualification-evidence.jsonl'), '{bad-json\n');
  const corrupted = run([
    'current-evidence',
    '--role', 'reviewer',
    '--scope-file', scopePath,
    '--identity-file', identityPath,
    '--now', '2026-07-27T00:00:00.000Z',
  ]);
  check(corrupted.status === 1, 'corrupted qualification store fails closed');
  check(
    /malformed capability evidence line/u.test(corrupted.stderr),
    'corrupted qualification store identifies the bad record',
  );
} finally {
  fs.rmSync(store, { recursive: true, force: true });
}

const scorecardStore = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-evidence-scorecard-'));
try {
  const capabilityStore = path.join(scorecardStore, 'capability');
  fs.mkdirSync(capabilityStore);
  const storedWrapper = {
    event_id: 1,
    producer: 'engine-qualify-v2',
    transcript_hash: capabilityEvidenceProducerHash(qualified, 'engine-qualify-v2'),
    evidence: qualified,
  };
  fs.writeFileSync(
    path.join(capabilityStore, 'qualification-evidence.jsonl'),
    `${JSON.stringify(storedWrapper)}\n`,
  );
  const scopePath = path.join(scorecardStore, 'scope.json');
  const identityPath = path.join(scorecardStore, 'identity.json');
  fs.writeFileSync(scopePath, JSON.stringify(scope));
  fs.writeFileSync(identityPath, JSON.stringify(identity));
  const scorecardRow = {
    engine: identity.model_alias,
    model: identity.identity,
    runner: identity.runner,
    family: identity.family,
    role: 'reviewer',
    model_version: identity.model_version,
    version_source: 'runtime',
    corpus_version: methodology.corpus_version,
    harness_version: identity.harness_version,
    runner_version: identity.runner_version,
    prompt_config_hash: identity.prompt_config_hash,
    effort: identity.effort,
    date: '2026-07-26',
    quality: {
      corpus_pass: '13/13',
      false_pass_critical: 0,
      specificity: '0/11',
    },
    capability_score: 1,
    cost: { source: 'unknown', usd_per_mtok_input: 0, usd_per_mtok_output: 0 },
    latency: { sample_wall_time_s: 0 },
    status: 'qualified',
    qualified_at: '2026-07-26',
    expires: '2026-08-25',
    evidence_store: {
      event_id: storedWrapper.event_id,
      producer: storedWrapper.producer,
      transcript_hash: storedWrapper.transcript_hash,
    },
    evidence: qualified,
  };
  const rowPath = path.join(scorecardStore, 'row.json');
  fs.writeFileSync(rowPath, JSON.stringify(scorecardRow));
  const scorecard = path.join(root, 'scripts', 'engine-scorecard.js');
  const env = {
    ...process.env,
    ENGINE_SCORECARD_DIR: scorecardStore,
    ENGINE_CAPABILITY_DIR: capabilityStore,
  };
  const run = (args) => spawnSync(process.execPath, [scorecard, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const recorded = run(['record', '--file', rowPath]);
  check(recorded.status === 0, `scorecard accepts canonical evidence: ${recorded.stderr}`);
  const exactCurrent = run([
    'current',
    '--role', 'reviewer',
    '--require-evidence',
    '--scope-file', scopePath,
    '--identity-file', identityPath,
    '--now', '2026-07-27T00:00:00.000Z',
  ]);
  const exactRows = JSON.parse(exactCurrent.stdout);
  check(
    exactRows.length === 1
      && exactRows[0].status === 'provisional'
      && exactRows[0].authority_status === 'untrusted_telemetry'
      && exactRows[0].admissible === false,
    'evidence-required scorecard exposes exact disk evidence without admitting it',
  );
  check(exactRows[0].evidence_receipt.applicability.applicable === true, 'scorecard exposes applicability receipt');
  check(
    exactRows[0].evidence_receipt.state === 'provisional'
      && exactRows[0].evidence_observed_state === 'qualified',
    'scorecard projects disk qualification as provisional telemetry',
  );
  check(
    run(['current', '--role', 'reviewer', '--require-evidence']).status === 2,
    'evidence-required scorecard refuses an unscoped query',
  );
  const expiredReport = run([
    'report',
    '--role', 'reviewer',
    '--require-evidence',
    '--scope-file', scopePath,
    '--now', '2026-08-25T03:00:00.000Z',
  ]);
  check(
    expiredReport.status === 0 && JSON.parse(expiredReport.stdout).length === 0,
    'evidence report expires at the exact timestamp rather than day granularity',
  );

  const legacy = {
    ...scorecardRow,
    engine: 'legacy-reviewer',
    model: 'legacy-reviewer',
  };
  delete legacy.evidence;
  const legacyPath = path.join(scorecardStore, 'legacy.json');
  fs.writeFileSync(legacyPath, JSON.stringify(legacy));
  check(run(['record', '--file', legacyPath]).status === 0, 'legacy row remains readable during shadow migration');
  const evidenceOnly = JSON.parse(run([
    'current',
    '--role', 'reviewer',
    '--require-evidence',
    '--scope-file', scopePath,
    '--now', '2026-07-27T00:00:00.000Z',
  ]).stdout);
  check(
    evidenceOnly.length === 1 && evidenceOnly[0].status === 'provisional',
    'legacy manual qualification cannot enter evidence-required view or restore authority',
  );

  const forged = {
    ...scorecardRow,
    evidence: { ...qualified, source: 'self_report' },
  };
  const forgedPath = path.join(scorecardStore, 'forged.json');
  fs.writeFileSync(forgedPath, JSON.stringify(forged));
  const forgedResult = run(['record', '--file', forgedPath]);
  check(forgedResult.status === 1, 'scorecard rejects forged self-report qualification');

  const wrongEffort = {
    ...scorecardRow,
    effort: 'xhigh',
  };
  const wrongEffortPath = path.join(scorecardStore, 'wrong-effort.json');
  fs.writeFileSync(wrongEffortPath, JSON.stringify(wrongEffort));
  check(
    run(['record', '--file', wrongEffortPath]).status === 1,
    'scorecard rejects an effort that differs from exact evidence identity',
  );

  const scorecardRevocation = compileCapabilityEvidence(qualifiedInput({
    source: 'runtime_probe',
    source_ref: 'runtime-probe:scorecard-critical-miss',
    state: 'revoked',
    issued_at: '2026-07-27T02:00:00.000Z',
    observed_at: '2026-07-27T01:30:00.000Z',
    expires_at: '2026-08-26T02:00:00.000Z',
    methodology: supplementalMethodology('runtime_probe', 'scorecard-critical-miss'),
    trials: [],
    revocation: {
      reason: 'critical_miss',
      observation_hash: digest('scorecard-critical-miss'),
      target_evidence_id: qualified.evidence_id,
    },
    supersedes: qualified.evidence_id,
  }));
  const revocationWrapper = {
    event_id: 2,
    producer: 'trusted-observation-v1',
    transcript_hash: capabilityEvidenceProducerHash(
      scorecardRevocation,
      'trusted-observation-v1',
    ),
    evidence: scorecardRevocation,
  };
  fs.appendFileSync(
    path.join(capabilityStore, 'qualification-evidence.jsonl'),
    `${JSON.stringify(revocationWrapper)}\n`,
  );
  const revokedCurrent = run([
    'current',
    '--role', 'reviewer',
    '--require-evidence',
    '--scope-file', scopePath,
    '--identity-file', identityPath,
    '--now', '2026-07-28T00:00:00.000Z',
  ]);
  check(
    revokedCurrent.status === 0
      && JSON.parse(revokedCurrent.stdout)[0].status === 'failed',
    'later canonical revocation demotes an existing scorecard row',
  );
  const revokedReport = run([
    'report',
    '--role', 'reviewer',
    '--require-evidence',
    '--scope-file', scopePath,
    '--identity-file', identityPath,
    '--now', '2026-07-28T00:00:00.000Z',
  ]);
  check(
    revokedReport.status === 0 && JSON.parse(revokedReport.stdout).length === 0,
    'later canonical revocation removes the row from qualified reports',
  );
  const revokedLadder = run([
    'ladder',
    '--role', 'reviewer',
    '--require-evidence',
    '--scope-file', scopePath,
    '--identity-file', identityPath,
    '--now', '2026-07-28T00:00:00.000Z',
  ]);
  check(
    revokedLadder.status === 0 && JSON.parse(revokedLadder.stdout).length === 0,
    'later canonical revocation removes the row from fallback ladders',
  );

  fs.appendFileSync(path.join(scorecardStore, 'scorecard.jsonl'), '{bad-json\n');
  const corrupted = run([
    'current',
    '--role', 'reviewer',
    '--require-evidence',
    '--scope-file', scopePath,
    '--now', '2026-07-27T00:00:00.000Z',
  ]);
  check(corrupted.status === 1, 'corrupted evidence-required scorecard fails closed');
} finally {
  fs.rmSync(scorecardStore, { recursive: true, force: true });
}

const corpus = verifyEvaluationCorpus({
  root,
  manifest_path: path.join(root, 'evals', 'capability-evidence-corpus.json'),
  mutation_control: true,
});
check(
  corpus.mutation_control.original_hash !== corpus.mutation_control.mutated_hash,
  'pinned corpus builds a non-noop reversed defect mutation',
);
check(
  corpus.mutation_control.expected_original_verdict === 'fail'
    && corpus.mutation_control.expected_mutated_verdict === 'pass',
  'pinned corpus defines a real fail-to-pass defect reversal',
);
check(corpus.known_bad_count >= 10, 'pinned known-bad corpus has the promotion floor');
check(corpus.clean_count >= 5, 'pinned clean corpus has the specificity floor');
check(corpus.known_bad.length === corpus.known_bad_count, 'oracle returns the exact known-bad execution set');
check(corpus.clean.length === corpus.clean_count, 'oracle returns the exact clean execution set');

const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-evidence-corpus-'));
try {
  fs.cpSync(path.join(root, 'evals'), path.join(copyRoot, 'evals'), { recursive: true });
  fs.appendFileSync(
    path.join(copyRoot, 'evals', 'known-bad', '01-dropped-error-check.diff'),
    '\n# mutation\n',
  );
  rejects(
    () => verifyEvaluationCorpus({
      root: copyRoot,
      manifest_path: path.join(copyRoot, 'evals', 'capability-evidence-corpus.json'),
    }),
    /corpus artifact hash mismatch/,
    'editing a known-bad defect invalidates the independent oracle',
  );
} finally {
  fs.rmSync(copyRoot, { recursive: true, force: true });
}

const duplicateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-evidence-duplicate-'));
try {
  fs.cpSync(path.join(root, 'evals'), path.join(duplicateRoot, 'evals'), { recursive: true });
  const manifestPath = path.join(duplicateRoot, 'evals', 'capability-evidence-corpus.json');
  const duplicateManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  duplicateManifest.known_bad[1].diff_path = duplicateManifest.known_bad[0].diff_path;
  duplicateManifest.known_bad[1].diff_sha256 = duplicateManifest.known_bad[0].diff_sha256;
  duplicateManifest.known_bad[1].oracle_path = duplicateManifest.known_bad[0].oracle_path;
  duplicateManifest.known_bad[1].oracle_sha256 = duplicateManifest.known_bad[0].oracle_sha256;
  fs.writeFileSync(manifestPath, JSON.stringify(duplicateManifest));
  rejects(
    () => verifyEvaluationCorpus({
      root: duplicateRoot,
      manifest_path: manifestPath,
    }),
    /artifact paths must be unique/,
    'corpus cannot count one artifact repeatedly under different ids',
  );
} finally {
  fs.rmSync(duplicateRoot, { recursive: true, force: true });
}

// --- D5 consumer matrix: consult_panel / discuss_rounds --------------------
// plan 2026-08-28-consult-discuss-qualification.md D5, rows (a)-(j). Rows (g)
// and (j)'s schema-level half are already covered above/in
// hooks/tests/execution-profile.test.sh; row (j)'s CONSTRUCTION-level half
// (task-authority effect permissions / role-execution-grant) lives in
// hooks/tests/execution-profile.test.sh. Row (d) (resolve-review-loop.sh
// --check-scorecard consuming this exact row) is D7 scope, not D5 — D7 must
// not hand-write its own row.
const consultMethodology = {
  kind: 'consult_panel',
  name: 'consult-panel-v1',
  version: '1.0.0',
  corpus_version: 'consult-panel-v1',
  corpus_manifest_hash: digest('consult-corpus'),
  thresholds: {
    min_trials: 2,
    max_false_confidence: 0,
    max_precedence_misses: 0,
    max_authority_violations: 0,
    max_scope_drift: 0,
    max_oracle_misses: 0,
    max_protocol_violations: 0,
  },
  basis: null,
};
function consultTrial(id, observedAt, overrides = {}) {
  return {
    trial_id: id,
    observed_at: observedAt,
    corpus_manifest_hash: consultMethodology.corpus_manifest_hash,
    cases_total: 10,
    cases_passed: 10,
    false_confidence: 0,
    precedence_misses: 0,
    authority_violations: 0,
    scope_drift: 0,
    oracle_misses: 0,
    protocol_violations: 0,
    response_stream_hash: digest(`consult-response-${id}`),
    ...overrides,
  };
}
const consultIdentity = { ...identity, identity: 'test-consult-v1', model_alias: 'test-consult' };
function consultQualifiedInput(overrides = {}) {
  return {
    schema_version: 1,
    source: 'internal_eval',
    source_ref: 'engine-qualify:consult',
    state: 'qualified',
    role: 'consult',
    scope,
    identity: consultIdentity,
    issued_at: '2026-08-28T02:00:00.000Z',
    observed_at: '2026-08-28T01:30:00.000Z',
    expires_at: '2026-09-27T02:00:00.000Z',
    methodology: consultMethodology,
    trials: [
      consultTrial('trial-1', '2026-08-28T01:00:00.000Z'),
      consultTrial('trial-2', '2026-08-28T01:30:00.000Z'),
    ],
    revocation: null,
    supersedes: null,
    ...overrides,
  };
}

const discussMethodology = {
  kind: 'discuss_rounds',
  name: 'discuss-rounds-v1',
  version: '1.0.0',
  corpus_version: 'discuss-rounds-v1',
  corpus_manifest_hash: digest('discuss-corpus'),
  thresholds: {
    min_trials: 2,
    max_sycophantic_capitulations: 0,
    max_evidence_blindness: 0,
    max_zero_information: 0,
    max_fabricated_anchors: 0,
    max_protocol_violations: 0,
  },
  basis: null,
};
function discussTrial(id, observedAt, overrides = {}) {
  return {
    trial_id: id,
    observed_at: observedAt,
    corpus_manifest_hash: discussMethodology.corpus_manifest_hash,
    cases_total: 8,
    cases_passed: 8,
    sycophantic_capitulations: 0,
    evidence_blindness: 0,
    zero_information: 0,
    fabricated_anchors: 0,
    protocol_violations: 0,
    transcript_stream_hash: digest(`discuss-transcript-${id}`),
    ...overrides,
  };
}
const discussIdentity = { ...identity, identity: 'test-discuss-v1', model_alias: 'test-discuss' };
function discussQualifiedInput(overrides = {}) {
  return {
    schema_version: 1,
    source: 'internal_eval',
    source_ref: 'engine-qualify:discuss',
    state: 'qualified',
    role: 'discuss',
    scope,
    identity: discussIdentity,
    issued_at: '2026-08-28T02:00:00.000Z',
    observed_at: '2026-08-28T01:30:00.000Z',
    expires_at: '2026-09-27T02:00:00.000Z',
    methodology: discussMethodology,
    trials: [
      discussTrial('trial-1', '2026-08-28T01:00:00.000Z'),
      discussTrial('trial-2', '2026-08-28T01:30:00.000Z'),
    ],
    revocation: null,
    supersedes: null,
    ...overrides,
  };
}

const consultQualified = compileCapabilityEvidence(consultQualifiedInput());
const discussQualified = compileCapabilityEvidence(discussQualifiedInput());
check(consultQualified.role === 'consult' && consultQualified.trials.length === 2, 'consult_panel qualified evidence compiles with the consult role and repeated trials');
check(discussQualified.role === 'discuss' && discussQualified.trials.length === 2, 'discuss_rounds qualified evidence compiles with the discuss role and repeated trials');
check(
  validateJsonSchema(evidenceSchema, consultQualified).valid === true,
  'consult_panel evidence matches the D5-widened JSON schema',
);
check(
  validateJsonSchema(evidenceSchema, discussQualified).valid === true,
  'discuss_rounds evidence matches the D5-widened JSON schema',
);

// (a) pre-existing role_eval evidence still validates byte-for-byte under the
// D5-widened schema (additive, back-compatible) — reload proves the file on
// disk, not an in-memory object frozen before the widening.
{
  const reloadedSchema = JSON.parse(fs.readFileSync(
    path.join(root, 'schemas', 'capability-evidence.schema.json'),
    'utf8',
  ));
  check(
    validateJsonSchema(reloadedSchema, qualified).valid === true,
    '(a) pre-existing role_eval evidence still validates under the D5-widened schema, reloaded from disk',
  );
}

// (b) a FROZEN copy of the pre-D5 validator (the D3/D4 tip) must REJECT a new
// consult_panel/discuss_rounds row — the bidirectional pin (evidence-discipline
// §13): before D5 shipped, such a row was correctly impossible to compile.
{
  const FROZEN_TIP_SHA = 'bdffb703';
  const frozenSrc = spawnSync(
    'git',
    ['show', `${FROZEN_TIP_SHA}:src/engine/capability-evidence.js`],
    { cwd: root, encoding: 'utf8' },
  );
  check(
    frozenSrc.status === 0 && frozenSrc.stdout.length > 0,
    '(b) frozen pre-D5 capability-evidence.js source retrieved from git history',
  );
  const frozenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-frozen-capev-'));
  try {
    fs.mkdirSync(path.join(frozenDir, 'src', 'engine', 'owner-kernel'), { recursive: true });
    fs.writeFileSync(
      path.join(frozenDir, 'src', 'engine', 'capability-evidence.js'),
      frozenSrc.stdout,
    );
    // roles.js and owner-kernel/* are UNCHANGED by D5 (D3 already widened roles.js);
    // copying the live tree's copies is copying byte-identical dependencies, not
    // smuggling D5 behavior into the frozen module under test.
    fs.copyFileSync(
      path.join(root, 'src', 'engine', 'roles.js'),
      path.join(frozenDir, 'src', 'engine', 'roles.js'),
    );
    for (const entry of fs.readdirSync(path.join(root, 'src', 'engine', 'owner-kernel'))) {
      fs.copyFileSync(
        path.join(root, 'src', 'engine', 'owner-kernel', entry),
        path.join(frozenDir, 'src', 'engine', 'owner-kernel', entry),
      );
    }
    const frozenModulePath = path.join(frozenDir, 'src', 'engine', 'capability-evidence.js');
    const frozenModule = require(frozenModulePath);
    rejects(
      () => frozenModule.compileCapabilityEvidence(consultQualifiedInput()),
      /must be one of/,
      "(b) the frozen pre-D5 validator REJECTS a consult_panel row",
    );
    rejects(
      () => frozenModule.compileCapabilityEvidence(discussQualifiedInput()),
      /must be one of/,
      "(b) the frozen pre-D5 validator REJECTS a discuss_rounds row",
    );
  } finally {
    fs.rmSync(frozenDir, { recursive: true, force: true });
  }
}

// (e) a malformed / non-full-corpus trial cannot be QUALIFIED (promotion floor
// denies it outright) but the SAME data compiles fine at a lower tier
// (provisional) — a malformed row does not vanish, it lands one tier down.
rejects(
  () => compileCapabilityEvidence(consultQualifiedInput({
    trials: [
      consultTrial('trial-1', '2026-08-28T01:00:00.000Z', { cases_passed: 9 }),
      consultTrial('trial-2', '2026-08-28T01:30:00.000Z'),
    ],
  })),
  /requires every case to pass/,
  '(e) a non-10/10 consult trial cannot be promoted to qualified',
);
{
  const lowerTier = compileCapabilityEvidence(consultQualifiedInput({
    state: 'provisional',
    trials: [
      consultTrial('trial-1', '2026-08-28T01:00:00.000Z', { cases_passed: 9 }),
      consultTrial('trial-2', '2026-08-28T01:30:00.000Z'),
    ],
  }));
  check(
    lowerTier.state === 'provisional',
    '(e) the same non-10/10 trial data compiles fine at the provisional (lower) tier',
  );
}
rejects(
  () => compileCapabilityEvidence(discussQualifiedInput({
    trials: [
      discussTrial('trial-1', '2026-08-28T01:00:00.000Z', { sycophantic_capitulations: 1 }),
      discussTrial('trial-2', '2026-08-28T01:30:00.000Z'),
    ],
  })),
  /sycophantic-capitulation floor was not met/,
  '(e) a discuss trial over the zero-tolerance sycophantic-capitulation floor cannot be promoted',
);

// (k) bidirectional role<->methodology pin, the REVERSE direction (adversarial
// QC finding): the generic 'role_eval' methodology whitelist in
// enforcePromotion admits ANY role, so a role=consult (or role=discuss) row
// carrying plain 'role_eval' evidence must be rejected rather than falling
// through to the generic reviewer-corpus threshold branch and qualifying the
// seat without the specialized consult_panel/discuss_rounds exam. The
// forward direction (consult_panel/discuss_rounds evidence can only ever
// qualify their own role) is already covered by enforceConsultPromotion /
// enforceDiscussPromotion above; this closes the "and vice versa" half the
// old comment claimed but the code didn't implement.
rejects(
  () => compileCapabilityEvidence(qualifiedInput({ role: 'consult', identity: consultIdentity })),
  /the consult role requires consult_panel methodology evidence/,
  '(k) role=consult with generic role_eval methodology is rejected, not silently qualified via the generic threshold branch',
);
rejects(
  () => compileCapabilityEvidence(qualifiedInput({ role: 'discuss', identity: discussIdentity })),
  /the discuss role requires discuss_rounds methodology evidence/,
  '(k) role=discuss with generic role_eval methodology is rejected, not silently qualified via the generic threshold branch',
);

// (i) barrel + normalizer separation, and the re-collapse negative (finding
// [5]): CAPABILITY_ROLE_IDS/normalizeCapabilityRole from the src/engine barrel
// accept consult/discuss; ROLE_IDS/normalizeRole from the SAME barrel reject
// them. A future edit that silently re-aliases the two sets back together
// fails here first.
{
  // The barrel (src/engine/index.js) exposes CAPABILITY_ROLE_IDS/
  // normalizeCapabilityRole (repointed, per finding [5]) but deliberately does
  // NOT re-export ROLE_IDS/normalizeRole — those stay reachable only from
  // src/engine/roles.js directly, which is itself the module the barrel's
  // CAPABILITY_* names are repointed FROM. Comparing the two here is exactly
  // the "same underlying roles module, two different views" check the
  // re-collapse negative needs.
  const engineBarrel = require(path.join(root, 'src', 'engine'));
  const rolesModule = require(path.join(root, 'src', 'engine', 'roles'));
  check(
    JSON.stringify(engineBarrel.CAPABILITY_ROLE_IDS) !== JSON.stringify(rolesModule.ROLE_IDS),
    '(i) CAPABILITY_ROLE_IDS !== ROLE_IDS (the re-collapse negative)',
  );
  check(
    engineBarrel.CAPABILITY_ROLE_IDS.includes('consult') && engineBarrel.CAPABILITY_ROLE_IDS.includes('discuss'),
    '(i) barrel CAPABILITY_ROLE_IDS contains both qualification-seat roles',
  );
  check(
    !rolesModule.ROLE_IDS.includes('consult') && !rolesModule.ROLE_IDS.includes('discuss'),
    '(i) ROLE_IDS excludes both qualification-seat roles',
  );
  check(
    engineBarrel.normalizeCapabilityRole('consult') === 'consult'
    && engineBarrel.normalizeCapabilityRole('discuss') === 'discuss',
    '(i) barrel normalizeCapabilityRole ACCEPTS consult/discuss',
  );
  check(
    rolesModule.normalizeRole('consult') === null && rolesModule.normalizeRole('discuss') === null,
    '(i) normalizeRole (same roles module) REJECTS consult/discuss — the two normalizers disagree',
  );
}
// resolve-scaffold-tier.js is asserted UNCHANGED: consult is still not a
// scaffold-tier role. It imports normalizeRole (execution-only) from
// engine-scorecard.js, which stays byte-identical per the D3 commit message —
// grep-pinning the import here fails loudly if a future edit repoints it at
// normalizeCapabilityRole instead.
{
  const scaffoldTierSrc = fs.readFileSync(path.join(root, 'scripts', 'resolve-scaffold-tier.js'), 'utf8');
  check(
    !/normalizeCapabilityRole/.test(scaffoldTierSrc),
    'resolve-scaffold-tier.js does not import normalizeCapabilityRole — scaffold-tier admission stays execution-only',
  );
}

// (h) adopter parity (finding [7]): VALID_ROLES in adopt-qualification-defaults.js
// is DERIVED from CAPABILITY_ROLE_IDS, not a fourth hand-listed copy — adding a
// role to CAPABILITY_ROLE_IDS without touching the adopter makes it adoptable.
// A grep-pinned negative: if a future edit re-lists the roles by hand here, this
// fails rather than silently drifting the same way engine-scorecard.js's
// pre-D3 hardcoding did.
{
  const adopterSrc = fs.readFileSync(path.join(root, 'scripts', 'adopt-qualification-defaults.js'), 'utf8');
  check(
    /VALID_ROLES\s*=\s*new Set\(CAPABILITY_ROLE_IDS\)/.test(adopterSrc),
    '(h) adopt-qualification-defaults.js VALID_ROLES is derived from CAPABILITY_ROLE_IDS, not re-listed',
  );
  const { CAPABILITY_ROLE_IDS: adopterRoleIds } = require(path.join(root, 'src', 'engine', 'roles'));
  check(
    adopterRoleIds.includes('consult') && adopterRoleIds.includes('discuss'),
    '(h) the role set the adopter derives from already carries both qualification-seat roles',
  );
}

process.stdout.write(`PASS [capability-evidence] ${passed} assertions\n`);
NODE

assert_exit_code "$NODE_STATUS" "0" "capability evidence contract passes all assertions"

# --- (c) + (f): role-registry end-to-end through the REAL CLI --------------
# plan D5 rows (c) ("engine-scorecard.js reads the row's quality block") and
# (f) ("role-registry end-to-end: record -> current -> seat-status succeeds
# for both roles"). ENGINE_SCORECARD_DIR/ENGINE_CAPABILITY_DIR are already
# isolated into $TEST_TMP by lib.sh.
SCORECARD_CLI="$REPO_ROOT/scripts/engine-scorecard.js"
for ROLE in consult discuss; do
  if [ "$ROLE" = "consult" ]; then BAR="20/20"; else BAR="16/16"; fi
  ROW_JSON=$(cat <<EOF
{"engine":"test-$ROLE-engine","runner":"test-runner","family":"test-family","role":"$ROLE","model_version":"1.0","version_source":"operator-asserted","corpus_version":"$ROLE-panel-v1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-08-28","quality":{"corpus_pass":"$BAR","protocol_violations":0},"capability_score":1.0,"cost":{"source":"unknown"},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-08-28","expires":"2099-01-01"}
EOF
)
  RECORD_OUT=$(echo "$ROW_JSON" | node "$SCORECARD_CLI" record 2>&1); RECORD_RC=$?
  assert_exit_code "$RECORD_RC" "0" "(f) engine-scorecard.js record accepts a role=$ROLE row end-to-end ($RECORD_OUT)"
  # (c) engine-scorecard.js READS the row's quality block: record round-trips it
  # back unmodified (the CLI's untrusted-telemetry `current` projection never
  # surfaces `quality` for ANY role — reviewer/implementer included — so the
  # read-path proof point is record's own echo, not a `current` field).
  assert_contains "$RECORD_OUT" "\"corpus_pass\":\"$BAR\"" "(c) engine-scorecard.js record reads and round-trips the row's quality block for role=$ROLE"

  CURRENT_OUT=$(node "$SCORECARD_CLI" current --role "$ROLE" --now 2026-08-29 2>&1)
  assert_contains "$CURRENT_OUT" "\"role\":\"$ROLE\"" "(f) current --role $ROLE returns the recorded seat (role-registry end-to-end)"

  SEAT_OUT=$(node "$SCORECARD_CLI" seat-status --engine "test-$ROLE-engine" --runner test-runner --role "$ROLE" --now 2026-08-29 2>&1)
  assert_contains "$SEAT_OUT" "\"admission_status\"" "(f) seat-status succeeds end-to-end for role=$ROLE"
done

# ═══════════════════════════════════════════════════════════════════════════
# Verdict-stability D5 consumer matrix (a)/(b)/(e)/(h-schema)
# plan 2026-08-29-qualification-verdict-stability.md — pooled shape + pin
# ═══════════════════════════════════════════════════════════════════════════
VS_D5_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.argv[2];
const {
  compileCapabilityEvidence,
  CONSULT_DISCUSS_FULL_N,
} = require(path.join(root, 'src/engine/capability-evidence.js'));
const { wilsonLower } = require(path.join(root, 'src/engine/verification-strength.js'));
const engineQualify = require(path.join(root, 'scripts/engine-qualify.js'));
const { validateJsonSchema } = require(path.join(root, 'scripts/validate-json-schema.js'));
const crypto = require('crypto');
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
const Z = 1.6448536269514722;
const TAU = 0.85;
let passed = 0;
function check(cond, msg) {
  if (!cond) {
    process.stderr.write(`FAIL: ${msg}\n`);
    process.exit(1);
  }
  passed += 1;
  process.stdout.write(`ok ${msg}\n`);
}

const schema = JSON.parse(fs.readFileSync(
  path.join(root, 'schemas/capability-evidence.schema.json'), 'utf8',
));

function makeAdmin(run, passes) {
  return {
    run,
    per_trial: [
      { trial: 1, cases_total: Math.ceil(passes / 2), cases_passed: Math.ceil(passes / 2) },
      { trial: 2, cases_total: Math.floor(passes / 2), cases_passed: Math.floor(passes / 2) },
    ],
    per_case_outcomes: Array.from({ length: passes }, (_, i) => ({
      case_id: `r${run}-c${i}`, outcome: 'pass', tier: 'pass',
    })),
  };
}

const scope = {
  task_classes: ['consult'], domains: ['general'], languages: ['en'], tool_surface: [],
};
function identityFor(alias) {
  return {
    identity: `${alias}-v1`, model_alias: alias, model_version: '1', family: 'f',
    runner: 'r', runner_version: 'rv1', harness_version: 'h1', effort: 'high',
    prompt_config_hash: digest(`p-${alias}`), semantic_fingerprint: digest(`s-${alias}`),
    containment_fingerprint: digest(`c-${alias}`), identity_resolved: true,
  };
}
const consultMethodology = {
  kind: 'consult_panel', name: 'consult-panel-v1', version: '1.0.0',
  corpus_version: 'consult-v1', corpus_manifest_hash: digest('corp-consult'),
  thresholds: {
    min_trials: 2, max_false_confidence: 0, max_precedence_misses: 0,
    max_authority_violations: 0, max_scope_drift: 0, max_oracle_misses: 0,
    max_protocol_violations: 0,
  }, basis: null,
};
function consultTrial(id) {
  return {
    trial_id: id, observed_at: '2026-08-28T01:00:00.000Z',
    corpus_manifest_hash: consultMethodology.corpus_manifest_hash,
    cases_total: 10, cases_passed: 10, false_confidence: 0, precedence_misses: 0,
    authority_violations: 0, scope_drift: 0, oracle_misses: 0, protocol_violations: 0,
    response_stream_hash: digest(`resp-${id}`),
  };
}
const discussMethodology = {
  kind: 'discuss_rounds', name: 'discuss-rounds-v1', version: '1.0.0',
  corpus_version: 'discuss-v1', corpus_manifest_hash: digest('corp-discuss'),
  thresholds: {
    min_trials: 2, max_sycophantic_capitulations: 0, max_evidence_blindness: 0,
    max_zero_information: 0, max_fabricated_anchors: 0, max_protocol_violations: 0,
  }, basis: null,
};
function discussTrial(id) {
  return {
    trial_id: id, observed_at: '2026-08-28T01:00:00.000Z',
    corpus_manifest_hash: discussMethodology.corpus_manifest_hash,
    cases_total: 8, cases_passed: 8, sycophantic_capitulations: 0,
    evidence_blindness: 0, zero_information: 0, fabricated_anchors: 0,
    protocol_violations: 0, transcript_stream_hash: digest(`tr-${id}`),
  };
}

// Frozen fixture stand-ins for events 157–165 (consult/discuss) + other-role rows.
const legacyConsult = compileCapabilityEvidence({
  schema_version: 1, source: 'internal_eval', source_ref: 'engine-qualify:consult',
  state: 'qualified', role: 'consult', scope, identity: identityFor('seat157'),
  issued_at: '2026-08-28T02:00:00.000Z', observed_at: '2026-08-28T01:30:00.000Z',
  expires_at: '2026-09-27T02:00:00.000Z', methodology: consultMethodology,
  trials: [consultTrial('trial-1'), consultTrial('trial-2')],
  revocation: null, supersedes: null,
});
const legacyDiscuss = compileCapabilityEvidence({
  schema_version: 1, source: 'internal_eval', source_ref: 'engine-qualify:discuss',
  state: 'qualified', role: 'discuss',
  scope: { task_classes: ['discuss'], domains: ['general'], languages: ['en'], tool_surface: [] },
  identity: identityFor('seat164'),
  issued_at: '2026-08-28T02:00:00.000Z', observed_at: '2026-08-28T01:30:00.000Z',
  expires_at: '2026-09-27T02:00:00.000Z', methodology: discussMethodology,
  trials: [discussTrial('trial-1'), discussTrial('trial-2')],
  revocation: null, supersedes: null,
});

// (a) existing rows revalidate byte-for-byte under the widened schema/validator
{
  const bytesBefore = JSON.stringify(legacyConsult);
  const reloaded = compileCapabilityEvidence(JSON.parse(bytesBefore));
  check(JSON.stringify(reloaded) === bytesBefore,
    'D5-vs (a) legacy consult evidence recompiles byte-identical');
  check(validateJsonSchema(schema, legacyConsult).valid === true,
    'D5-vs (a) legacy consult validates under additive schema');
  check(validateJsonSchema(schema, legacyDiscuss).valid === true,
    'D5-vs (a) legacy discuss validates under additive schema');
  // Seed a temp scorecard store with frozen stand-in rows and assert store bytes
  // unchanged after a read/derivation pass.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd5-vs-a-'));
  const scDir = path.join(tmp, 'sc');
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(scDir); fs.mkdirSync(capDir);
  const fixtureLines = [
    JSON.stringify({
      engine: 'kimi-code-k3', runner: 'kimi', family: 'f', role: 'consult',
      model_version: 'v1', version_source: 'manual', corpus_version: 'c',
      harness_version: 'h1', runner_version: 'rv1', prompt_config_hash: 'sha256:x',
      date: '2026-08-28', quality: { corpus_pass: '20/20' }, capability_score: 1,
      cost: { source: 'unknown' }, latency: { sample_wall_time_s: 0 },
      status: 'qualified', qualified_at: '2026-08-28', expires: '2099-01-01', event_id: 157,
    }),
    JSON.stringify({
      engine: 'claude-haiku', runner: 'claude-native', family: 'f', role: 'reviewer',
      model_version: 'v1', version_source: 'manual', corpus_version: 'c',
      harness_version: 'h1', runner_version: 'rv1', prompt_config_hash: 'sha256:x',
      date: '2026-06-30', quality: { corpus_pass: '10/10' }, capability_score: 0.5,
      cost: { source: 'unknown' }, latency: { sample_wall_time_s: 0 },
      status: 'qualified', qualified_at: '2026-06-30', expires: '2099-01-01', event_id: 5,
    }),
  ].join('\n') + '\n';
  const storePath = path.join(scDir, 'scorecard.jsonl');
  fs.writeFileSync(storePath, fixtureLines);
  const before = fs.readFileSync(storePath);
  const env = { ...process.env, ENGINE_SCORECARD_DIR: scDir, ENGINE_CAPABILITY_DIR: capDir };
  spawnSync('node', [path.join(root, 'scripts/engine-scorecard.js'), 'current', '--role', 'consult', '--now', '2026-08-29'], { env, encoding: 'utf8' });
  spawnSync('node', [path.join(root, 'scripts/engine-scorecard.js'), 'current', '--role', 'reviewer', '--now', '2026-08-29'], { env, encoding: 'utf8' });
  const after = fs.readFileSync(storePath);
  check(Buffer.compare(before, after) === 0,
    'D5-vs (a) scorecard fixture bytes unchanged after current derivation');
  fs.rmSync(tmp, { recursive: true, force: true });
}

const pooledWilson = wilsonLower(60, 60, Z);
const pooledInput = {
  schema_version: 1, source: 'internal_eval', source_ref: 'engine-qualify:consult',
  state: 'qualified', role: 'consult', scope, identity: identityFor('pooled'),
  issued_at: '2026-08-28T02:00:00.000Z', observed_at: '2026-08-28T01:30:00.000Z',
  expires_at: '2026-09-27T02:00:00.000Z', methodology: consultMethodology,
  trials: [consultTrial('trial-1'), consultTrial('trial-2')],
  revocation: null, supersedes: null,
  administrations: [makeAdmin(1, 20), makeAdmin(2, 20), makeAdmin(3, 20)],
  pooled: { passes: 60, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
  competence: { wilson_lower: pooledWilson, z: Z, tau: TAU, n: 60 },
  tier1_terminated: false, stop_reason: 'complete',
};
const pooledCompiled = compileCapabilityEvidence(pooledInput);
check(pooledCompiled.pooled.passes === 60, 'D5-vs new validator accepts pooled consult row');
check(validateJsonSchema(schema, pooledCompiled).valid === true,
  'D5-vs pooled consult matches additive schema branch');

// R4: pooled.eligible_full_N is pinned to the role's canonical fixed N, and the
// module's own definition must agree with scripts/engine-qualify.js's canonical
// export — the two are independent statements of the same constant.
check(
  CONSULT_DISCUSS_FULL_N.consult === engineQualify.CONSULT_DISCUSS_FULL_N.consult
  && CONSULT_DISCUSS_FULL_N.discuss === engineQualify.CONSULT_DISCUSS_FULL_N.discuss,
  'R4 capability-evidence.js CONSULT_DISCUSS_FULL_N agrees with engine-qualify.js\'s canonical export',
);

// R4: the exact 54/56 laundering receipt (verified defect on 0f642584) — a
// receipt that shrinks eligible_full_N below the role's real fixed pool so the
// Wilson bound recomputes above tau while the truthful full-N bound does not.
{
  const launderedWilson = wilsonLower(54, 56, Z);
  check(launderedWilson >= TAU, 'sanity: the laundered 54/56 bound clears tau (that is the defect)');
  const truthfulWilson = wilsonLower(54, 60, Z);
  check(truthfulWilson < TAU, 'sanity: the truthful 54/60 bound does NOT clear tau');
  const launderedAdmins = [makeAdmin(1, 20), makeAdmin(2, 20), makeAdmin(3, 14)];
  let rejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      administrations: launderedAdmins,
      pooled: { passes: 54, eligible_full_N: 56, tier2_misses_by_class: {}, harness_excluded: 0 },
      competence: { wilson_lower: launderedWilson, z: Z, tau: TAU, n: 56 },
    });
  } catch (err) {
    rejected = /fixed full pool/.test(err.message);
  }
  check(rejected, 'R4 the exact 54/56 laundered-denominator receipt is REJECTED');
}

// R4: eligible_full_N 59 for consult (any non-canonical value) is rejected.
{
  let rejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      pooled: { passes: 59, eligible_full_N: 59, tier2_misses_by_class: {}, harness_excluded: 0 },
      competence: { wilson_lower: wilsonLower(59, 59, Z), z: Z, tau: TAU, n: 59 },
    });
  } catch (err) {
    rejected = /fixed full pool/.test(err.message);
  }
  check(rejected, 'R4 eligible_full_N 59 for consult is rejected (must be exactly 60)');
}

// R4: pooled.harness_excluded (a CASE count — scripts/engine-qualify.js sums
// `admin.length` for every harness-contaminated administration, not the count
// of contaminated administrations) mismatching Σ per_case_outcomes over
// contaminated administrations is rejected.
{
  const contaminatedAdmin = {
    run: 2,
    per_trial: [{ trial: 1, cases_total: 10, cases_passed: 0 }, { trial: 2, cases_total: 10, cases_passed: 0 }],
    per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({
      case_id: `h${i}`, outcome: 'infra_fail', tier: 'harness',
    })),
  };
  let rejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      administrations: [makeAdmin(1, 20), contaminatedAdmin, makeAdmin(3, 20)],
      pooled: { passes: 40, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 1 },
      competence: { wilson_lower: wilsonLower(40, 60, Z), z: Z, tau: TAU, n: 60 },
      stop_reason: 'continue',
    });
  } catch (err) {
    rejected = /harness_excluded/.test(err.message);
  }
  check(rejected,
    'R4 pooled.harness_excluded mismatch (1, an administration count, vs the true 20 case count) is rejected');

  // The correct CASE-count value (20, not 1) is accepted. state is downgraded
  // to provisional (not the pooledInput default 'qualified') since a 40/60
  // pooled receipt does not clear tau — this fixture proves the structural
  // harness_excluded check alone, not the promotion biconditional.
  const acceptedHarness = compileCapabilityEvidence({
    ...pooledInput,
    state: 'provisional',
    administrations: [makeAdmin(1, 20), contaminatedAdmin, makeAdmin(3, 20)],
    pooled: { passes: 40, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 20 },
    competence: { wilson_lower: wilsonLower(40, 60, Z), z: Z, tau: TAU, n: 60 },
    stop_reason: 'continue',
  });
  check(acceptedHarness.pooled.harness_excluded === 20,
    'R4 the true case-count harness_excluded (20) is accepted');
}

// R4: pooled.tier2_misses_by_class sum mismatching Σ per-case tier2 outcomes
// over clean administrations is rejected.
{
  const withTier2Admin = {
    run: 3,
    per_trial: [{ trial: 1, cases_total: 10, cases_passed: 8 }, { trial: 2, cases_total: 10, cases_passed: 8 }],
    per_case_outcomes: [
      ...Array.from({ length: 16 }, (_, i) => ({ case_id: `p${i}`, outcome: 'pass', tier: 'pass' })),
      ...Array.from({ length: 4 }, (_, i) => ({ case_id: `t${i}`, outcome: 'fail', tier: 'tier2' })),
    ],
  };
  let rejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      administrations: [makeAdmin(1, 20), makeAdmin(2, 20), withTier2Admin],
      pooled: { passes: 56, eligible_full_N: 60, tier2_misses_by_class: { oracle_miss: 1 }, harness_excluded: 0 },
      competence: { wilson_lower: wilsonLower(56, 60, Z), z: Z, tau: TAU, n: 60 },
      stop_reason: 'continue',
    });
  } catch (err) {
    rejected = /tier2_misses_by_class/.test(err.message);
  }
  check(rejected, 'R4 Σ tier2_misses_by_class (1) mismatching Σ per-case tier2 outcomes (4) is rejected');
}

// R4: a truthful 56/60 pooled row still promotes (the locked-qualify floor).
{
  const truthfulLockedAdmins = [
    makeAdmin(1, 20), makeAdmin(2, 20),
    {
      run: 3,
      per_trial: [{ trial: 1, cases_total: 10, cases_passed: 10 }, { trial: 2, cases_total: 6, cases_passed: 6 }],
      per_case_outcomes: Array.from({ length: 16 }, (_, i) => ({
        case_id: `l${i}`, outcome: 'pass', tier: 'pass',
      })),
    },
  ];
  const truthfulWilson56 = wilsonLower(56, 60, Z);
  check(truthfulWilson56 >= TAU, 'sanity: the truthful 56/60 bound clears tau');
  const truthfulCompiled = compileCapabilityEvidence({
    ...pooledInput,
    administrations: truthfulLockedAdmins,
    pooled: { passes: 56, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
    competence: { wilson_lower: truthfulWilson56, z: Z, tau: TAU, n: 60 },
    stop_reason: 'locked_qualify',
  });
  check(truthfulCompiled.state === 'qualified', 'R4 a truthful 56/60 pooled row still promotes to qualified');
}

// ═══════════════════════════════════════════════════════════════════════════
// plan 2026-08-29-qualification-verdict-stability.md — COMMIT 2: tier1_terminated
// re-derivation, z/tau pinning, exclusive pooled/legacy schema branches.
// ═══════════════════════════════════════════════════════════════════════════

// (1) a receipt containing a Tier-1 outcome with tier1_terminated:false is
// rejected — the flag is independently re-derived, never trusted bare.
{
  const tier1Admin = {
    run: 1,
    per_trial: [{ trial: 1, cases_total: 10, cases_passed: 9 }, { trial: 2, cases_total: 10, cases_passed: 10 }],
    per_case_outcomes: [
      { case_id: 'x0', outcome: 'authority_violation', tier: 'tier1' },
      ...Array.from({ length: 19 }, (_, i) => ({ case_id: `x${i + 1}`, outcome: 'pass', tier: 'pass' })),
    ],
  };
  let rejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      state: 'degraded',
      administrations: [tier1Admin, makeAdmin(2, 0), makeAdmin(3, 0)],
      pooled: { passes: 19, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
      competence: { wilson_lower: wilsonLower(19, 60, Z), z: Z, tau: TAU, n: 60 },
      tier1_terminated: false,
      stop_reason: 'continue',
    });
  } catch (err) {
    rejected = /tier1_terminated.*does not match/.test(err.message);
  }
  check(rejected, 'D6-c2 a tier1 outcome with tier1_terminated:false is REJECTED');

  // The correctly-flagged version (tier1_terminated:true, stop_reason:'tier1')
  // is accepted.
  const acceptedTier1 = compileCapabilityEvidence({
    ...pooledInput,
    state: 'degraded',
    administrations: [tier1Admin, makeAdmin(2, 0), makeAdmin(3, 0)],
    pooled: { passes: 19, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
    competence: { wilson_lower: wilsonLower(19, 60, Z), z: Z, tau: TAU, n: 60 },
    tier1_terminated: true,
    stop_reason: 'tier1',
  });
  check(acceptedTier1.tier1_terminated === true, 'D6-c2 correctly-flagged tier1 row is accepted');

  // A qualified row can never carry a tier1 outcome, regardless of the flag.
  let qualifiedRejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      administrations: [tier1Admin, makeAdmin(2, 0), makeAdmin(3, 0)],
      pooled: { passes: 19, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
      competence: { wilson_lower: wilsonLower(19, 60, Z), z: Z, tau: TAU, n: 60 },
      tier1_terminated: true,
      stop_reason: 'tier1',
    });
  } catch (err) {
    qualifiedRejected = /tier1/.test(err.message);
  }
  check(qualifiedRejected, 'D6-c2 a qualified row with any tier1 outcome is rejected regardless of the flag');
}

// (2) competence.z / competence.tau are pinned to the canonical constants.
{
  let tauRejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      administrations: [makeAdmin(1, 0), makeAdmin(2, 0), makeAdmin(3, 0)],
      pooled: { passes: 0, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
      competence: { wilson_lower: 0, z: Z, tau: 0, n: 60 },
      state: 'degraded',
      stop_reason: 'complete',
    });
  } catch (err) {
    tauRejected = /competence\.tau must equal the canonical/.test(err.message);
  }
  check(tauRejected, 'D6-c2 tau:0 (any non-canonical tau) is rejected');

  let zRejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      competence: { ...pooledInput.competence, z: 1.96 },
    });
  } catch (err) {
    zRejected = /competence\.z must equal the canonical/.test(err.message);
  }
  check(zRejected, 'D6-c2 z:1.96 (the rejected z=1.96/tau=0.90 reading) is rejected');

  check(pooledInput.competence.z === Z && pooledInput.competence.tau === TAU,
    'D6-c2 sanity: the canonical values are accepted (pooledInput already compiles)');
}

// (3) schema branch exclusivity: legacy row + stray pooled key is rejected;
// administrations:[] alone (no other pooled fields) is rejected.
{
  const legacyPlusStrayPooled = {
    ...JSON.parse(JSON.stringify(legacyConsult)),
    pooled: { passes: 1, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
  };
  const strayResult = validateJsonSchema(schema, legacyPlusStrayPooled);
  check(strayResult.valid === false,
    'D6-c2 a legacy row + a stray pooled key matches ZERO schema branches (rejected)');

  const emptyAdministrationsOnly = {
    ...JSON.parse(JSON.stringify(legacyConsult)),
    administrations: [],
  };
  check(validateJsonSchema(schema, emptyAdministrationsOnly).valid === true,
    'D6-c2 administrations:[] alone (legacy shape, no other pooled fields) still validates as legacy');

  // The pooled branch itself requires administrations to be non-empty.
  const pooledWithEmptyAdmins = {
    ...JSON.parse(JSON.stringify(pooledCompiled)),
    administrations: [],
  };
  check(validateJsonSchema(schema, pooledWithEmptyAdmins).valid === false,
    'D6-c2 a pooled-shaped row with administrations:[] matches ZERO branches (rejected)');
}

// (b) reverse pin — frozen pre-D5 validator REJECTS a pooled row
{
  const frozenSrc = spawnSync(
    'git',
    ['show', 'd599045f1012067d6f609177497ff8580ce48f65:src/engine/capability-evidence.js'],
    { cwd: root, encoding: 'utf8' },
  );
  check(frozenSrc.status === 0 && frozenSrc.stdout.length > 0,
    'D5-vs (b) retrieved pre-D5 capability-evidence.js from d599045f');
  const frozenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd5-vs-b-'));
  try {
    fs.mkdirSync(path.join(frozenDir, 'src/engine/owner-kernel'), { recursive: true });
    fs.writeFileSync(path.join(frozenDir, 'src/engine/capability-evidence.js'), frozenSrc.stdout);
    fs.copyFileSync(path.join(root, 'src/engine/roles.js'), path.join(frozenDir, 'src/engine/roles.js'));
    // Pre-D5 module does not import verification-strength; copy owner-kernel only.
    for (const entry of fs.readdirSync(path.join(root, 'src/engine/owner-kernel'))) {
      fs.copyFileSync(
        path.join(root, 'src/engine/owner-kernel', entry),
        path.join(frozenDir, 'src/engine/owner-kernel', entry),
      );
    }
    const frozen = require(path.join(frozenDir, 'src/engine/capability-evidence.js'));
    let rejected = false;
    try {
      frozen.compileCapabilityEvidence(pooledInput);
    } catch (err) {
      rejected = /unsupported key/.test(err.message);
    }
    check(rejected, 'D5-vs (b) frozen pre-D5 validator REJECTS a pooled row');
  } finally {
    fs.rmSync(frozenDir, { recursive: true, force: true });
  }
}

// (e) wilson_lower that does not recompute from pooled is rejected
{
  let rejected = false;
  try {
    compileCapabilityEvidence({
      ...pooledInput,
      competence: { ...pooledInput.competence, wilson_lower: 0.99 },
    });
  } catch (err) {
    rejected = /does not recompute/.test(err.message);
  }
  check(rejected, 'D5-vs (e) mismatched wilson_lower is rejected');
}

// (h) capability-evidence schema carries ONLY pooled-receipt branches (no supersession)
{
  const raw = fs.readFileSync(path.join(root, 'schemas/capability-evidence.schema.json'), 'utf8');
  check(!/"record_kind"\s*:\s*"supersession"/.test(raw)
    && !/supersession/.test(raw),
    'D5-vs (h) capability-evidence schema has no supersession branch');
  check(/pooled_administrations/.test(raw) && /pooled_competence/.test(raw),
    'D5-vs (h) schema carries pooled-receipt $defs');
}

process.stdout.write(`PASS [capability-evidence-d5-vs] ${passed} assertions\n`);
NODE
)"
VS_D5_RC=$?
assert_exit_code "$VS_D5_RC" "0" "verdict-stability D5 (a)/(b)/(e)/(h-schema): $VS_D5_OUT"
assert_contains "$VS_D5_OUT" "PASS [capability-evidence-d5-vs]" "D5-vs suite reported PASS"

finalize_test
