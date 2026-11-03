#!/usr/bin/env node
'use strict';

// Validates the bounded P3.6 A0 evidence shape. It deliberately has no
// full/partial qualification output because A0 has no Owner-Kernel authority.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ATTACK_IDS = Object.freeze([
  'protected_event_envelope_forgery',
  'direct_decision_append',
  'worker_artifact_decision_injection',
  'child_process_capability_theft',
  'policy_kernel_mutation',
  'mediated_action_bypass',
  'capability_set_drift',
  'witness_head_rewrite',
]);
const A0_OUTCOMES = new Set(['held_a0', 'not_applicable_a0', 'unknown_unproven', 'harness_error']);
const SHA256 = /^[0-9a-f]{64}$/;
// Updating the taxonomy, expected outcomes, or gate bindings is a reviewed
// source change, not a runtime report mutation. Keep this digest in lockstep
// with p36-a0-corpus.json deliberately.
const FROZEN_CORPUS_HASH = '62e7566ef308689b8de3bd56344d9dc7a63a7458e0f35470826a69cf9bf043c6';
const MAX_EVIDENCE_OUTPUT_BYTES = 65536;

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

function token(value, code) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) fail(code);
  return value;
}

function hash(value, code) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(code);
  return value;
}

function readJson(file, code) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    fail(code);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(code);
  }
}

function readCanonicalReport(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    fail('p36_a0_report_unreadable');
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('p36_a0_report_invalid_json');
  }
  if (raw !== `${canonical(value)}\n`) fail('p36_a0_report_not_canonical');
  return value;
}

function sameStrings(actual, expected, code) {
  if (!Array.isArray(actual) || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) fail(code);
}

function validateAuthority(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  if (value.owner_kernel_authority !== 'none'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'disabled'
    || value.acceptance !== 'not_available') fail(code);
  return value;
}

function validateCorpus(raw, baselineRaw) {
  const corpus = exactKeys(raw, [
    'schema_version', 'kind', 'authority_ceiling', 'qualification_prohibited',
    'baseline_fixture_canonical_hash', 'attacks', 'baseline_categories',
    'baseline_outcome', 'forbidden_aggregate_labels',
  ], 'p36_a0_corpus_shape_invalid');
  if (corpus.schema_version !== 1 || corpus.kind !== 'p36_a0_substrate_safety_corpus'
    || corpus.qualification_prohibited !== true || corpus.baseline_outcome !== 'not_evaluable_at_a0') {
    fail('p36_a0_corpus_authority_invalid');
  }
  if (digest(corpus) !== FROZEN_CORPUS_HASH) fail('p36_a0_corpus_pin_mismatch');
  exactKeys(corpus.authority_ceiling, [
    'owner_kernel_authority', 'effect_authority', 'broker_authority', 'acceptance',
  ], 'p36_a0_corpus_authority_invalid');
  validateAuthority(corpus.authority_ceiling, 'p36_a0_corpus_authority_invalid');
  hash(corpus.baseline_fixture_canonical_hash, 'p36_a0_corpus_baseline_hash_invalid');
  if (digest(baselineRaw) !== corpus.baseline_fixture_canonical_hash) fail('p36_a0_corpus_baseline_hash_mismatch');
  if (!baselineRaw || !Array.isArray(baselineRaw.categories)) fail('p36_a0_baseline_categories_invalid');
  const baselineIds = baselineRaw.categories.map((category) => category && category.id);
  sameStrings(corpus.baseline_categories, baselineIds, 'p36_a0_corpus_baseline_categories_drift');
  if (!Array.isArray(corpus.forbidden_aggregate_labels) || corpus.forbidden_aggregate_labels.length === 0) {
    fail('p36_a0_corpus_forbidden_labels_invalid');
  }
  for (const label of corpus.forbidden_aggregate_labels) token(label, 'p36_a0_corpus_forbidden_labels_invalid');
  if (!corpus.forbidden_aggregate_labels.includes('P0_PASS')
    || !corpus.forbidden_aggregate_labels.includes('full')
    || !corpus.forbidden_aggregate_labels.includes('partial')) {
    fail('p36_a0_corpus_forbidden_labels_incomplete');
  }
  if (!Array.isArray(corpus.attacks) || corpus.attacks.length !== ATTACK_IDS.length) fail('p36_a0_corpus_attack_count_invalid');
  for (let index = 0; index < corpus.attacks.length; index += 1) {
    const attack = exactKeys(corpus.attacks[index], [
      'id', 'expected_a0_outcome', 'original_semantic_status', 'a0_projection',
      'deterministic_gate', 'live_gate',
    ], 'p36_a0_corpus_attack_shape_invalid');
    if (attack.id !== ATTACK_IDS[index] || !A0_OUTCOMES.has(attack.expected_a0_outcome)
      || attack.original_semantic_status !== 'not_applicable_a0'
      || typeof attack.a0_projection !== 'string' || attack.a0_projection.length < 1
      || typeof attack.deterministic_gate !== 'string' || typeof attack.live_gate !== 'string') {
      fail('p36_a0_corpus_attack_invalid');
    }
  }
  return JSON.parse(canonical(corpus));
}

function expectedEvidenceMarker(gate) {
  return `PASS [${path.basename(gate, '.test.sh')}]`;
}

function validateAttackEvidence(attack, expected) {
  const value = exactKeys(attack, [
    'id', 'a0_outcome', 'evidence_gate', 'evidence_output', 'evidence_hash',
  ], 'p36_a0_report_attack_shape_invalid');
  if (value.id !== expected.id || value.a0_outcome !== expected.expected_a0_outcome
    || !A0_OUTCOMES.has(value.a0_outcome)
    || typeof value.evidence_gate !== 'string'
    || typeof value.evidence_output !== 'string'
    || Buffer.byteLength(value.evidence_output, 'utf8') > MAX_EVIDENCE_OUTPUT_BYTES) {
    fail('p36_a0_report_attack_invalid');
  }
  if (expected.expected_a0_outcome === 'held_a0') {
    if (expected.deterministic_gate === 'none'
      || value.evidence_gate !== expected.deterministic_gate
      || !value.evidence_output.includes(expectedEvidenceMarker(expected.deterministic_gate))) {
      fail('p36_a0_report_attack_evidence_invalid');
    }
  } else if (expected.expected_a0_outcome === 'not_applicable_a0') {
    if (expected.deterministic_gate !== 'none'
      || value.evidence_gate !== 'none'
      || value.evidence_output !== `not_applicable_a0:${expected.id}`) {
      fail('p36_a0_report_attack_evidence_invalid');
    }
  } else {
    fail('p36_a0_report_attack_invalid');
  }
  if (hash(value.evidence_hash, 'p36_a0_report_attack_evidence_invalid')
    !== digest({ id: value.id, gate: value.evidence_gate, output: value.evidence_output })) {
    fail('p36_a0_report_attack_evidence_invalid');
  }
  return value;
}

function validateReport(raw, corpus) {
  const report = exactKeys(raw, [
    'schema_version', 'kind', 'corpus_hash', 'status', 'owner_kernel_authority',
    'effect_authority', 'broker_authority', 'acceptance', 'qualification_prohibited',
    'attacks', 'baseline_categories', 'report_hash',
  ], 'p36_a0_report_shape_invalid');
  const material = { ...report };
  delete material.report_hash;
  if (report.schema_version !== 1 || report.kind !== 'p36_a0_substrate_safety_report'
    || report.corpus_hash !== digest(corpus) || report.status !== 'bounded_a0_report'
    || report.qualification_prohibited !== true || digest(material) !== hash(report.report_hash, 'p36_a0_report_hash_invalid')) {
    fail('p36_a0_report_integrity_invalid');
  }
  validateAuthority(report, 'p36_a0_report_authority_invalid');
  if (!Array.isArray(report.attacks) || report.attacks.length !== corpus.attacks.length) fail('p36_a0_report_attack_count_invalid');
  for (let index = 0; index < report.attacks.length; index += 1) {
    validateAttackEvidence(report.attacks[index], corpus.attacks[index]);
  }
  if (!Array.isArray(report.baseline_categories) || report.baseline_categories.length !== corpus.baseline_categories.length) {
    fail('p36_a0_report_baseline_count_invalid');
  }
  for (let index = 0; index < report.baseline_categories.length; index += 1) {
    const category = exactKeys(report.baseline_categories[index], ['id', 'outcome'], 'p36_a0_report_baseline_shape_invalid');
    if (category.id !== corpus.baseline_categories[index] || category.outcome !== corpus.baseline_outcome) {
      fail('p36_a0_report_baseline_invalid');
    }
  }
  if (corpus.forbidden_aggregate_labels.includes(report.status)
    || report.attacks.some((attack) => corpus.forbidden_aggregate_labels.includes(attack.a0_outcome))) {
    fail('p36_a0_report_forbidden_aggregate_label');
  }
  return JSON.parse(canonical(report));
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length || values[key] !== undefined) fail('p36_a0_cli_arguments_invalid');
    values[key] = argv[index + 1];
    index += 1;
  }
  return values;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'validate') fail('p36_a0_cli_command_invalid');
  const args = parseArgs(rest);
  if (Object.keys(args).length !== 2 || typeof args['--corpus'] !== 'string' || typeof args['--report'] !== 'string') {
    fail('p36_a0_cli_arguments_invalid');
  }
  const corpus = validateCorpus(
    readJson(args['--corpus'], 'p36_a0_corpus_unreadable'),
    readJson(path.join(__dirname, 'baseline-fixtures.json'), 'p36_a0_baseline_unreadable'),
  );
  const report = validateReport(readCanonicalReport(args['--report']), corpus);
  process.stdout.write(`${canonical(report)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || error.message || String(error)}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  ATTACK_IDS, FROZEN_CORPUS_HASH, canonical, digest, validateCorpus, validateReport,
};
