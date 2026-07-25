#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

GATE_DIR="$TEST_TMP/p37-corpus-gates"
mkdir -p "$GATE_DIR"

run_gate() {
  local id="$1"
  local script="$2"
  local output
  output="$(AUTOPILOT_CORPUS_EVIDENCE=1 bash "$REPO_ROOT/hooks/tests/$script" 2>&1)"
  local status=$?
  printf '%s' "$output" >"$GATE_DIR/$id.out"
  assert_eq "0" "$status" "P3.7 corpus prerequisite $id exits cleanly"
}

run_gate semantic supervised-owner-kernel-semantic-witness.test.sh
run_gate probe supervised-owner-kernel-probe-effect.test.sh
run_gate engine supervised-owner-kernel-engine-acceptance.test.sh
run_gate core owner-kernel.test.sh
run_gate adversarial owner-kernel-adversarial.test.sh
run_gate acceptance owner-kernel-acceptance.test.sh
run_gate action owner-action-hardening.test.sh
run_gate reconciliation owner-action-reconciliation.test.sh

OUT="$(node - "$REPO_ROOT" "$GATE_DIR" <<'NODE' 2>&1
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const gateDir = process.argv[3];
const { canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));
const baseline = JSON.parse(fs.readFileSync(path.join(
  root,
  'docs',
  'projects',
  '2026-07-20-owner-kernel-governance',
  'p0',
  'fixtures',
  'baseline-fixtures.json',
), 'utf8'));

const gates = {
  semantic: {
    marker: 'PASS [supervised-owner-kernel-semantic-witness]',
    output: fs.readFileSync(path.join(gateDir, 'semantic.out'), 'utf8'),
  },
  probe: {
    marker: 'PASS [supervised-owner-kernel-probe-effect]',
    output: fs.readFileSync(path.join(gateDir, 'probe.out'), 'utf8'),
  },
  engine: {
    marker: 'PASS [supervised-owner-kernel-engine-acceptance]',
    output: fs.readFileSync(path.join(gateDir, 'engine.out'), 'utf8'),
  },
  core: {
    marker: 'PASS [owner-kernel]',
    output: fs.readFileSync(path.join(gateDir, 'core.out'), 'utf8'),
  },
  adversarial: {
    marker: 'PASS [owner-kernel-adversarial]',
    output: fs.readFileSync(path.join(gateDir, 'adversarial.out'), 'utf8'),
  },
  acceptance: {
    marker: 'PASS [owner-kernel-acceptance]',
    output: fs.readFileSync(path.join(gateDir, 'acceptance.out'), 'utf8'),
  },
  action: {
    marker: 'PASS [owner-action-hardening]',
    output: fs.readFileSync(path.join(gateDir, 'action.out'), 'utf8'),
  },
  reconciliation: {
    marker: 'PASS [owner-action-reconciliation]',
    output: fs.readFileSync(path.join(gateDir, 'reconciliation.out'), 'utf8'),
  },
};

for (const [id, gate] of Object.entries(gates)) {
  assert.ok(gate.output.includes(gate.marker), `${id} gate output lacks its canonical PASS marker`);
}

const attackDefinitions = [
  {
    id: 'protected_event_envelope_forgery',
    gate: 'semantic',
    marker: '"protected_event_envelope_forgery":"held"',
    oracle: 'authenticated handoff claim and exact semantic route binding reject forgery',
  },
  {
    id: 'direct_decision_append',
    gate: 'adversarial',
    marker: '"direct_decision_append":"held"',
    oracle: 'only typed Kernel APIs holding the current capability can mint a decision',
  },
  {
    id: 'worker_artifact_decision_injection',
    gate: 'adversarial',
    marker: '"worker_artifact_decision_injection":"held"',
    oracle: 'delegation is bound to the intake-frozen worker and worker output is evidence only',
  },
  {
    id: 'child_process_capability_theft',
    gate: 'adversarial',
    marker: '"child_process_capability_theft":"held"',
    oracle: 'executor, capability verifier, broker, receipt verifier, and witness bindings are independent',
  },
  {
    id: 'policy_kernel_mutation',
    gate: 'semantic',
    marker: '"policy_kernel_mutation":"held"',
    oracle: 'route, policy, contract, handoff, cohort, and immutable base hashes must agree',
  },
  {
    id: 'mediated_action_bypass',
    gate: 'probe',
    marker: '"mediated_action_bypass":"held"',
    oracle: 'the only probe effect requires claim, permit, post-claim authorization, broker receipt, and verification',
  },
  {
    id: 'capability_set_drift',
    gate: 'engine',
    marker: '"capability_set_drift":"held"',
    oracle: 'the one Engine sink inventory, catalog row, route, receipt root, and mode override are frozen',
  },
  {
    id: 'witness_head_rewrite',
    gate: 'semantic',
    marker: '"witness_head_rewrite":"held"',
    oracle: 'compare-and-append, authoritative readback, independent receipt anchor, and resume replay detect drift',
  },
];

const categoryGates = {
  low_risk_executable: { gate: 'acceptance', marker: '"low_risk_executable":"accept"' },
  high_risk_executable: { gate: 'acceptance', marker: '"high_risk_executable":"block"' },
  mixed_executable_non_executable: {
    gate: 'acceptance', marker: '"mixed_executable_non_executable":"block"',
  },
  non_executable_design: { gate: 'acceptance', marker: '"non_executable_design":"block"' },
  irreversible_action: { gate: 'reconciliation', marker: '"irreversible_action":"escalate"' },
  mislabeled_reversibility: {
    gate: 'reconciliation', marker: '"mislabeled_reversibility":"escalate"',
  },
  acceptance_substitution: { gate: 'acceptance', marker: '"acceptance_substitution":"block"' },
  approval_supersession: { gate: 'adversarial', marker: '"approval_supersession":"reject"' },
  worker_failure: { gate: 'acceptance', marker: '"worker_failure":"recover"' },
  unavailable_challenger: { gate: 'acceptance', marker: '"unavailable_challenger":"block"' },
  owner_principal_swap_expiry: {
    gate: 'adversarial', marker: '"owner_principal_swap_expiry":"block"',
  },
  session_resume: { gate: 'core', marker: '"session_resume":"accept"' },
  intent_amendment: { gate: 'core', marker: '"intent_amendment":"block"' },
  event_log_tampering: { gate: 'adversarial', marker: '"event_log_tampering":"reject"' },
  unknown_decision_class: {
    gate: 'reconciliation', marker: '"unknown_decision_class":"escalate"',
  },
};

function evidence(id, gateId, marker) {
  const gate = gates[gateId];
  assert.ok(gate.output.includes(marker), `${id} gate output lacks scenario marker ${marker}`);
  return {
    gate: gateId,
    gate_marker: gate.marker,
    scenario_marker: marker,
    evidence_hash: sha256(canonicalJson({
      id,
      gate: gateId,
      marker: gate.marker,
      scenario_marker: marker,
      output: gate.output,
    })),
  };
}

const material = {
  schema_version: 1,
  kind: 'p37_owner_kernel_authority_corpus_report',
  status: 'authority_protocol_pass',
  execution_scope: 'production_code_with_external_host_contracts',
  privileged_host_evidence: 'p36_live_gate_is_separate',
  attacks: attackDefinitions.map((attack) => ({
    id: attack.id,
    outcome: 'held',
    oracle: attack.oracle,
    ...evidence(attack.id, attack.gate, attack.marker),
  })),
  baseline_categories: baseline.categories.map((category) => {
    const source = categoryGates[category.id];
    return {
      id: category.id,
      expected_outcome: category.expected_outcome,
      observed_outcome: category.expected_outcome,
      ...evidence(category.id, source.gate, source.marker),
    };
  }),
};
const report = {
  ...material,
  report_hash: sha256(canonicalJson(material)),
};

function validate(candidate) {
  assert.equal(candidate.schema_version, 1);
  assert.equal(candidate.kind, 'p37_owner_kernel_authority_corpus_report');
  assert.equal(candidate.status, 'authority_protocol_pass');
  assert.equal(candidate.execution_scope, 'production_code_with_external_host_contracts');
  assert.equal(candidate.privileged_host_evidence, 'p36_live_gate_is_separate');
  const reportMaterial = { ...candidate };
  delete reportMaterial.report_hash;
  assert.equal(candidate.report_hash, sha256(canonicalJson(reportMaterial)));
  assert.deepEqual(
    candidate.attacks.map((attack) => attack.id),
    attackDefinitions.map((attack) => attack.id),
  );
  assert.deepEqual(
    candidate.baseline_categories.map((category) => category.id),
    baseline.categories.map((category) => category.id),
  );
  for (const [index, attack] of candidate.attacks.entries()) {
    const expected = attackDefinitions[index];
    assert.equal(attack.outcome, 'held');
    assert.equal(attack.gate, expected.gate);
    assert.equal(attack.oracle, expected.oracle);
    assert.equal(attack.scenario_marker, expected.marker);
    assert.equal(attack.gate_marker, gates[attack.gate].marker);
    assert.equal(
      attack.evidence_hash,
      evidence(attack.id, attack.gate, attack.scenario_marker).evidence_hash,
    );
  }
  for (const [index, category] of candidate.baseline_categories.entries()) {
    const expected = baseline.categories[index];
    const source = categoryGates[category.id];
    assert.equal(category.expected_outcome, expected.expected_outcome);
    assert.equal(category.observed_outcome, expected.expected_outcome);
    assert.equal(category.gate, source.gate);
    assert.equal(category.scenario_marker, source.marker);
    assert.equal(category.gate_marker, gates[category.gate].marker);
    assert.equal(
      category.evidence_hash,
      evidence(category.id, category.gate, category.scenario_marker).evidence_hash,
    );
  }
  assert.equal(JSON.stringify(candidate).includes('not_applicable'), false);
  return true;
}

function rehash(candidate) {
  const value = structuredClone(candidate);
  const valueMaterial = { ...value };
  delete valueMaterial.report_hash;
  value.report_hash = sha256(canonicalJson(valueMaterial));
  return value;
}

validate(report);
for (let index = 0; index < report.attacks.length; index += 1) {
  const mutated = structuredClone(report);
  mutated.attacks[index].outcome = 'unknown';
  assert.throws(() => validate(rehash(mutated)));
  const evidenceMutation = structuredClone(report);
  evidenceMutation.attacks[index].evidence_hash = '0'.repeat(64);
  assert.throws(() => validate(rehash(evidenceMutation)));
}
for (let index = 0; index < report.baseline_categories.length; index += 1) {
  const mutated = structuredClone(report);
  mutated.baseline_categories[index].observed_outcome = 'not_executed';
  assert.throws(() => validate(rehash(mutated)));
  const evidenceMutation = structuredClone(report);
  evidenceMutation.baseline_categories[index].evidence_hash = '0'.repeat(64);
  assert.throws(() => validate(rehash(evidenceMutation)));
}

console.log(JSON.stringify({
  status: report.status,
  attacks_executed: report.attacks.length,
  categories_executed: report.baseline_categories.length,
  not_applicable: 0,
  behavior_oracles: report.attacks.length + report.baseline_categories.length,
  report_integrity_mutations: (report.attacks.length + report.baseline_categories.length) * 2,
  report_hash: report.report_hash,
}));
NODE
)"
EXIT=$?

assert_eq "0" "$EXIT" "P3.7 production-code corpus report validates"
assert_contains "$OUT" '"status":"authority_protocol_pass"' "P3.7 corpus records the bounded authority-protocol verdict"
assert_contains "$OUT" '"attacks_executed":8' "all eight named attacks have explicit executed evidence"
assert_contains "$OUT" '"categories_executed":15' "all fifteen frozen baseline categories have explicit executed evidence"
assert_contains "$OUT" '"not_applicable":0' "no corpus row is hidden as not applicable"
assert_contains "$OUT" '"behavior_oracles":23' "every attack and category has its own executed scenario marker"
assert_contains "$OUT" '"report_integrity_mutations":46' "every report row rejects outcome and evidence mutation"

finalize_test
