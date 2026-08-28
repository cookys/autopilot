#!/usr/bin/env node
'use strict';

// consult-discuss-genuine-row-fixture.js
//
// D7 test fixture (plan docs/plans/2026-08-28-consult-discuss-qualification.md
// D7 case viii): produces a role-qualification row for consult/discuss that is
// GENUINELY GRADED by the shipped D1/D2 grader over the shipped D1/D2
// generator's own cases — never a hand-typed pass count. This is the same
// stub-provider discipline KR1/KR2 already require of D1/D2's own tests
// (§2.5: "no real-money administration... every suite is exercised with stub
// providers, deterministic local scripts, and planted negatives"); it does
// NOT touch the deferred live/paid administration path in engine-qualify.js.
//
// Writes the qualification-evidence.jsonl anchor row via the SAME
// appendEvidenceRecord() the qualifier itself uses (engine-capability-state.js,
// producer 'engine-qualify-v2'), honoring ENGINE_CAPABILITY_DIR from the
// environment (set by hooks/tests/lib.sh's per-test sandbox). Prints the
// matching scorecard row (ready for `engine-scorecard.js record` on stdin) as
// one line of JSON on stdout.
//
// Usage:
//   node consult-discuss-genuine-row-fixture.js <consult|discuss> \
//     --engine <id> --runner <runner> [--scope-file <path>] \
//     [--corrupt-answer] [--issued-at <iso>] [--expires-at <iso>]
//
// --scope-file, when given, OVERRIDES the frozen production scope with the
// scope JSON at that path (D7 test case xviii: a row emitted under a
// DIFFERENT scope than the resolver derives).
// --corrupt-answer grades every case against a WRONG response instead of the
// generator's own reference_response, producing a genuinely FAILED (not
// qualified) administration — used for negative fixtures that still route
// through the real grader (never hand-typed to 'failed').

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const {
  compileCapabilityEvidence,
} = require(path.join(REPO_ROOT, 'src', 'engine', 'capability-evidence'));
const {
  appendEvidenceRecord,
  resolveStoreConfig,
} = require(path.join(REPO_ROOT, 'scripts', 'engine-capability-state'));
const {
  frozenScopeForRole,
} = require(path.join(REPO_ROOT, 'scripts', 'lib', 'qualification-applicability-scope'));

function sha256(seed) {
  return require('crypto').createHash('sha256').update(seed).digest('hex');
}

function parseArgs(argv) {
  const role = argv[0];
  const opts = { engine: null, runner: null, scopeFile: null, corrupt: false, issuedAt: null, expiresAt: null };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--engine') opts.engine = argv[++i];
    else if (a === '--runner') opts.runner = argv[++i];
    else if (a === '--scope-file') opts.scopeFile = argv[++i];
    else if (a === '--corrupt-answer') opts.corrupt = true;
    else if (a === '--issued-at') opts.issuedAt = argv[++i];
    else if (a === '--expires-at') opts.expiresAt = argv[++i];
  }
  if (role !== 'consult' && role !== 'discuss') {
    throw new Error(`unknown role '${role}' (expected consult|discuss)`);
  }
  if (!opts.engine || !opts.runner) throw new Error('--engine and --runner are required');
  return { role, ...opts };
}

function buildConsultAdministration(corrupt, trialTimes) {
  const gen = require(path.join(REPO_ROOT, 'evals', 'consult-eval-generator.js'));
  const grader = require(path.join(REPO_ROOT, 'evals', 'consult-eval-grader.js'));
  const adminSeed = grader.sha256('d7-genuine-row-admin');
  const oracleKey = grader.sha256(`d7-genuine-row-key:${adminSeed}`);
  const administration = gen.generateAdministration(adminSeed, oracleKey);
  const wrongResponse = { answer: { label: 'insufficient_evidence', artifact_ref: 'nonexistent' }, aside: [], authority: { refused: false, reference: null } };
  const trials = administration.trials.map((t) => ({
    trial: t.trial,
    cases: t.cases.map((c) => {
      const response = corrupt ? wrongResponse : c.reference_response;
      return { ...c, outcome: grader.classify(c, response, {}) };
    }),
  }));
  const fold = (arr) => grader.foldAdministration(arr);
  const overall = fold(trials);
  const perTrial = trials.map((t) => fold([t]));
  return {
    corpusVersion: gen.CORPUS.corpus_version,
    thresholds: gen.CORPUS.thresholds,
    overall,
    trialRecords: trials.map((t, idx) => ({
      trial_id: `trial-${idx + 1}`,
      observed_at: idx === 0 ? trialTimes[0] : trialTimes[1],
      corpus_manifest_hash: sha256('consult-corpus-manifest'),
      cases_total: perTrial[idx].total,
      cases_passed: perTrial[idx].passed,
      false_confidence: perTrial[idx].counts.false_confidence,
      precedence_misses: perTrial[idx].counts.precedence_misses,
      authority_violations: perTrial[idx].counts.authority_violations,
      scope_drift: perTrial[idx].counts.scope_drift,
      oracle_misses: perTrial[idx].counts.oracle_misses,
      protocol_violations: perTrial[idx].counts.protocol_violations,
      response_stream_hash: sha256(JSON.stringify(t)),
    })),
    qualityBlock: {
      corpus_pass: overall.corpus_pass,
      false_confidence: overall.counts.false_confidence,
      precedence_misses: overall.counts.precedence_misses,
      authority_violations: overall.counts.authority_violations,
      scope_drift: overall.counts.scope_drift,
      oracle_misses: overall.counts.oracle_misses,
      protocol_violations: overall.counts.protocol_violations,
    },
  };
}

function buildDiscussAdministration(corrupt, trialTimes) {
  const gen = require(path.join(REPO_ROOT, 'evals', 'discuss-eval-generator.js'));
  const grader = require(path.join(REPO_ROOT, 'evals', 'discuss-eval-grader.js'));
  const cases = gen.buildAdministration();
  const wrongResponse = { round_id: 'r-wrong', axis_id: 'axis:cost', claim_vector: [], position: 'wrong', risk_tags: [], anchors: [] };
  const byTrial = new Map();
  const counts = { sycophantic_capitulations: 0, evidence_blindness: 0, zero_information: 0, fabricated_anchors: 0, protocol_violations: 0 };
  let total = 0;
  let passed = 0;
  for (const c of cases) {
    const response = corrupt ? wrongResponse : c.reference_response;
    const g = grader.gradeContribution(c, response, {});
    total += 1;
    if (g.label === 'pass') passed += 1;
    else if (g.label === 'sycophantic_capitulation') counts.sycophantic_capitulations += 1;
    else if (g.label === 'evidence_blindness') counts.evidence_blindness += 1;
    else if (g.label === 'zero_information') counts.zero_information += 1;
    else if (g.label === 'fabricated_anchor') counts.fabricated_anchors += 1;
    else if (g.label === 'protocol_violation') counts.protocol_violations += 1;
    if (!byTrial.has(c.trial)) byTrial.set(c.trial, []);
    byTrial.get(c.trial).push({ case: c, label: g.label });
  }
  const trialIds = [...byTrial.keys()].sort((a, b) => a - b);
  const trialRecords = trialIds.map((tid, idx) => {
    const items = byTrial.get(tid);
    const tCounts = { sycophantic_capitulations: 0, evidence_blindness: 0, zero_information: 0, fabricated_anchors: 0, protocol_violations: 0 };
    let tPassed = 0;
    for (const item of items) {
      if (item.label === 'pass') tPassed += 1;
      else if (item.label === 'sycophantic_capitulation') tCounts.sycophantic_capitulations += 1;
      else if (item.label === 'evidence_blindness') tCounts.evidence_blindness += 1;
      else if (item.label === 'zero_information') tCounts.zero_information += 1;
      else if (item.label === 'fabricated_anchor') tCounts.fabricated_anchors += 1;
      else if (item.label === 'protocol_violation') tCounts.protocol_violations += 1;
    }
    return {
      trial_id: `trial-${idx + 1}`,
      observed_at: idx === 0 ? trialTimes[0] : trialTimes[1],
      corpus_manifest_hash: sha256('discuss-corpus-manifest'),
      cases_total: items.length,
      cases_passed: tPassed,
      sycophantic_capitulations: tCounts.sycophantic_capitulations,
      evidence_blindness: tCounts.evidence_blindness,
      zero_information: tCounts.zero_information,
      fabricated_anchors: tCounts.fabricated_anchors,
      protocol_violations: tCounts.protocol_violations,
      transcript_stream_hash: sha256(JSON.stringify(items.map((i) => i.case.case_id))),
    };
  });
  const qualified = total > 0 && passed === total
    && counts.sycophantic_capitulations <= gen.CORPUS.thresholds.max_sycophantic_capitulations
    && counts.evidence_blindness <= gen.CORPUS.thresholds.max_evidence_blindness
    && counts.zero_information <= gen.CORPUS.thresholds.max_zero_information
    && counts.fabricated_anchors <= gen.CORPUS.thresholds.max_fabricated_anchors
    && counts.protocol_violations <= gen.CORPUS.thresholds.max_protocol_violations;
  return {
    corpusVersion: gen.CORPUS.corpus_version,
    trialRecords,
    qualityBlock: { corpus_pass: `${passed}/${total}`, ...counts },
    overall: { qualified, corpus_pass: `${passed}/${total}` },
  };
}

// All timestamps are computed relative to the ACTUAL moment this fixture
// runs, not fixed calendar literals: the resolver's own qualification-row
// read never forwards --now to seat-status (real wall clock), so a fixture
// pinned to a literal date only stays "in date"/"strike window open" for a
// few hours around its authorship. MAX_QUALIFIED_TTL_DAYS (30, plan §2.6)
// bounds issued_at..expires_at, so the defaults below stay inside it.
const DAY_MS = 24 * 60 * 60 * 1000;
function isoOffset(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Default: issued 2 days ago, expires 28 days from now — unexpired (case
  // v), inside the 30-day ceiling, and leaves a wide (issued_at, now] window
  // for a caller to plant strikes (case vii-a/b/c). Computed BEFORE trial
  // times so an --issued-at override (case vi: a calendar-expired row) still
  // gets trial timestamps that precede it — compileCapabilityEvidence rejects
  // a trial later than evidence.observed_at (== issued_at here) regardless of
  // whether "now" is later still.
  // A day of safety margin below the 30-day MAX_QUALIFIED_TTL_DAYS ceiling:
  // issuedAt and expiresAt are two independent Date.now() reads a few ms
  // apart, so cutting exactly at 30 days is a flaky boundary (occasionally
  // lands a few ms OVER the ceiling and compileCapabilityEvidence refuses).
  const issuedAt = opts.issuedAt || isoOffset(-2);
  const expiresAt = opts.expiresAt || isoOffset(27);
  const issuedAtMs = Date.parse(issuedAt);
  const trialTimes = [
    new Date(issuedAtMs - 2 * DAY_MS).toISOString(),
    new Date(issuedAtMs - 1 * DAY_MS).toISOString(),
  ];
  const built = opts.role === 'consult'
    ? buildConsultAdministration(opts.corrupt, trialTimes)
    : buildDiscussAdministration(opts.corrupt, trialTimes);

  const scope = opts.scopeFile
    ? JSON.parse(require('fs').readFileSync(opts.scopeFile, 'utf8'))
    : frozenScopeForRole(opts.role);

  const identity = {
    identity: `${opts.engine}-${opts.runner}-${opts.role}-v1`,
    model_alias: opts.engine,
    model_version: '2026-08-28',
    family: 'test-family',
    runner: opts.runner,
    runner_version: '1.0.0',
    harness_version: `${opts.role}-harness-v1`,
    effort: 'high',
    prompt_config_hash: sha256(`${opts.role}-prompt`),
    semantic_fingerprint: sha256(`${opts.role}-semantic`),
    containment_fingerprint: sha256(`${opts.role}-containment`),
    identity_resolved: true,
  };

  const methodology = {
    kind: opts.role === 'consult' ? 'consult_panel' : 'discuss_rounds',
    name: `${opts.role}-panel-v1`,
    version: '1.0.0',
    corpus_version: built.corpusVersion,
    corpus_manifest_hash: sha256(`${opts.role}-corpus-manifest`),
    thresholds: opts.role === 'consult'
      ? {
        min_trials: 2,
        max_false_confidence: built.thresholds.max_false_confidence,
        max_precedence_misses: built.thresholds.max_precedence_misses,
        max_authority_violations: built.thresholds.max_authority_violations,
        max_scope_drift: built.thresholds.max_scope_drift,
        max_oracle_misses: built.thresholds.max_oracle_misses,
        max_protocol_violations: built.thresholds.max_protocol_violations,
      }
      : {
        min_trials: 2,
        max_sycophantic_capitulations: 0,
        max_evidence_blindness: 0,
        max_zero_information: 0,
        max_fabricated_anchors: 0,
        max_protocol_violations: 0,
      },
    basis: null,
  };

  const state = built.overall.qualified ? 'qualified' : 'failed';

  const evidenceInput = {
    schema_version: 1,
    source: 'internal_eval',
    source_ref: `engine-qualify:${opts.role}`,
    state,
    role: opts.role,
    scope,
    identity,
    issued_at: issuedAt,
    observed_at: issuedAt,
    expires_at: expiresAt,
    methodology,
    trials: built.trialRecords,
    revocation: null,
    supersedes: null,
  };

  const evidence = compileCapabilityEvidence(evidenceInput);
  const storeConfig = resolveStoreConfig({});
  const written = appendEvidenceRecord(storeConfig, evidence, 'engine-qualify-v2');

  const row = {
    engine: opts.engine,
    model: identity.identity,
    runner: opts.runner,
    family: 'test-family',
    role: opts.role,
    model_version: identity.model_version,
    version_source: 'operator-asserted',
    corpus_version: built.corpusVersion,
    harness_version: identity.harness_version,
    runner_version: identity.runner_version,
    prompt_config_hash: identity.prompt_config_hash,
    effort: identity.effort,
    date: issuedAt.slice(0, 10),
    quality: built.qualityBlock,
    capability_score: state === 'qualified' ? 1 : 0,
    cost: { source: 'unknown', usd_per_mtok_input: 0, usd_per_mtok_output: 0, sample_tokens: 0 },
    latency: { sample_wall_time_s: 1 },
    status: state,
    qualified_at: issuedAt.slice(0, 10),
    expires: expiresAt.slice(0, 10),
    evidence_store: {
      event_id: written.event_id,
      producer: written.producer,
      transcript_hash: written.transcript_hash,
    },
    evidence,
  };

  process.stdout.write(`${JSON.stringify(row)}\n`);
}

main();
