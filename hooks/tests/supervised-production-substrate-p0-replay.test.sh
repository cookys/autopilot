#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CORPUS="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/p36-a0-corpus.json"
VALIDATOR="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/p36-a0-corpus.js"
REPORT="$TEST_TMP/p36-a0-report.json"

P35_OUT="$(PYTHONDONTWRITEBYTECODE=1 bash "$REPO_ROOT/hooks/tests/supervised-p35-durable-handoff.test.sh")"
P35_STATUS=$?
P36_TRANSPORT_OUT="$(PYTHONDONTWRITEBYTECODE=1 bash "$REPO_ROOT/hooks/tests/supervised-production-substrate-durable-transport.test.sh")"
P36_TRANSPORT_STATUS=$?
P36_RECOVERY_OUT="$(PYTHONDONTWRITEBYTECODE=1 bash "$REPO_ROOT/hooks/tests/supervised-production-substrate-recovery.test.sh")"
P36_RECOVERY_STATUS=$?
P36_HOST_OUT="$(PYTHONDONTWRITEBYTECODE=1 bash "$REPO_ROOT/hooks/tests/supervised-production-substrate-durable-host.test.sh")"
P36_HOST_STATUS=$?

assert_eq "$P35_STATUS" "0" "P0-A0 replay relies on the pinned P3.5d handoff oracle"
assert_eq "$P36_TRANSPORT_STATUS" "0" "P0-A0 replay relies on the peer-before-frame transport oracle"
assert_eq "$P36_RECOVERY_STATUS" "0" "P0-A0 replay relies on the independent receipt-anchor rewrite oracle"
assert_eq "$P36_HOST_STATUS" "0" "P0-A0 replay relies on the root-installed snapshot oracle"

REPORT_BUILD_OUT="$(node - "$CORPUS" "$VALIDATOR" "$REPORT" "$P35_OUT" "$P36_TRANSPORT_OUT" "$P36_RECOVERY_OUT" "$P36_HOST_OUT" <<'NODE'
const fs = require('fs');
const path = require('path');

const [corpusPath, validatorPath, reportPath, p35, transport, recovery, host] = process.argv.slice(2);
const baselinePath = path.join(path.dirname(corpusPath), 'baseline-fixtures.json');
const validator = require(validatorPath);
const corpus = validator.validateCorpus(
  JSON.parse(fs.readFileSync(corpusPath, 'utf8')),
  JSON.parse(fs.readFileSync(baselinePath, 'utf8')),
);
const evidenceOutput = {
  protected_event_envelope_forgery: p35,
  direct_decision_append: transport,
  worker_artifact_decision_injection: 'not_applicable_a0:worker_artifact_decision_injection',
  child_process_capability_theft: host,
  policy_kernel_mutation: host,
  mediated_action_bypass: recovery,
  capability_set_drift: 'not_applicable_a0:capability_set_drift',
  witness_head_rewrite: recovery,
};
const material = {
  schema_version: 1,
  kind: 'p36_a0_substrate_safety_report',
  corpus_hash: validator.digest(corpus),
  status: 'bounded_a0_report',
  owner_kernel_authority: 'none',
  effect_authority: 'none',
  broker_authority: 'disabled',
  acceptance: 'not_available',
  qualification_prohibited: true,
  attacks: corpus.attacks.map((attack) => {
    const evidence_gate = attack.expected_a0_outcome === 'held_a0' ? attack.deterministic_gate : 'none';
    const evidence_output = evidenceOutput[attack.id];
    return {
      id: attack.id,
      a0_outcome: attack.expected_a0_outcome,
      evidence_gate,
      evidence_output,
      evidence_hash: validator.digest({ id: attack.id, gate: evidence_gate, output: evidence_output }),
    };
  }),
  baseline_categories: corpus.baseline_categories.map((id) => ({ id, outcome: 'not_evaluable_at_a0' })),
};
const report = { ...material, report_hash: validator.digest(material) };
validator.validateReport(report, corpus);
fs.writeFileSync(reportPath, `${validator.canonical(report)}\n`, { mode: 0o600 });
process.stdout.write('p36_a0_corpus_report_built=true\n');
NODE
)"
REPORT_BUILD_STATUS=$?
assert_eq "$REPORT_BUILD_STATUS" "0" "P0-A0 replay builds a bounded canonical report from focused evidence"
assert_contains "$REPORT_BUILD_OUT" "p36_a0_corpus_report_built=true" "P0-A0 report builder records every frozen attack and baseline category"

VALIDATION_OUT="$(node "$VALIDATOR" validate --corpus "$CORPUS" --report "$REPORT")"
VALIDATION_STATUS=$?
assert_eq "$VALIDATION_STATUS" "0" "P0-A0 report validator accepts only the frozen bounded taxonomy"
assert_contains "$VALIDATION_OUT" '"status":"bounded_a0_report"' "P0-A0 report has no aggregate production-pass status"
assert_contains "$VALIDATION_OUT" '"qualification_prohibited":true' "P0-A0 report explicitly prohibits host qualification"
assert_not_contains "$VALIDATION_OUT" '"P0_PASS"' "P0-A0 report cannot claim a full P0 pass"
assert_not_contains "$VALIDATION_OUT" '"full"' "P0-A0 report cannot claim full qualification"
assert_not_contains "$VALIDATION_OUT" '"partial"' "P0-A0 report cannot claim partial qualification"

MUTATION_OUT="$(node - "$CORPUS" "$VALIDATOR" "$REPORT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const [corpusPath, validatorPath, reportPath] = process.argv.slice(2);
const validator = require(validatorPath);
const corpus = validator.validateCorpus(
  JSON.parse(fs.readFileSync(corpusPath, 'utf8')),
  JSON.parse(fs.readFileSync(path.join(path.dirname(corpusPath), 'baseline-fixtures.json'), 'utf8')),
);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
function rehash(value) {
  const material = { ...value };
  delete material.report_hash;
  return { ...material, report_hash: validator.digest(material) };
}
function rejected(mutator) {
  const candidate = structuredClone(report);
  mutator(candidate);
  assert.throws(() => validator.validateReport(rehash(candidate), corpus));
}
rejected((candidate) => { candidate.status = 'P0_PASS'; });
rejected((candidate) => { candidate.effect_authority = 'available'; });
rejected((candidate) => { candidate.baseline_categories.pop(); });
rejected((candidate) => { candidate.attacks[0].a0_outcome = 'full'; });
rejected((candidate) => { candidate.attacks[0].evidence_gate = 'none'; });
rejected((candidate) => { candidate.attacks[0].evidence_hash = '0'.repeat(64); });
const mutatedCorpus = structuredClone(corpus);
mutatedCorpus.attacks[2].expected_a0_outcome = 'held_a0';
mutatedCorpus.attacks[2].deterministic_gate = 'none';
mutatedCorpus.attacks[2].live_gate = 'none';
assert.throws(() => validator.validateCorpus(mutatedCorpus, JSON.parse(
  fs.readFileSync(path.join(path.dirname(corpusPath), 'baseline-fixtures.json'), 'utf8'),
)));
console.log('p36_a0_corpus_mutations_rejected=true');
NODE
)"
MUTATION_STATUS=$?
assert_eq "$MUTATION_STATUS" "0" "P0-A0 corpus negative controls reject aggregate and authority inflation"
assert_contains "$MUTATION_OUT" "p36_a0_corpus_mutations_rejected=true" "P0-A0 taxonomy mutation oracle is live"

finalize_test
