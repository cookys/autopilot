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

process.stdout.write(`PASS [capability-evidence] ${passed} assertions\n`);
NODE

assert_exit_code "$NODE_STATUS" "0" "capability evidence contract passes all assertions"
finalize_test
