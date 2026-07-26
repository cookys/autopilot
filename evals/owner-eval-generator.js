#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const CORPUS = require('./owner-capability-evidence-corpus.json');

const GENERATOR_VERSION = 'owner-intent-control-metamorphic-v1';
const RULES = Object.freeze(CORPUS.rules.map((rule) => Object.freeze({ ...rule })));
const KNOWN_BAD_COUNT = CORPUS.controls.known_bad_per_trial;
const CLEAN_COUNT = CORPUS.controls.clean_per_trial;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function derive(seed, label) {
  return sha256(`${seed}:${label}`);
}

function token(seed, label) {
  return `${label.replace(/[^A-Za-z0-9]/gu, '_')}_${derive(seed, label).slice(0, 12)}`;
}

function integer(seed, label, minimum, span) {
  const value = Number.parseInt(derive(seed, label).slice(0, 8), 16);
  return minimum + (value % span);
}

function freezeJson(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)]),
    ));
  }
  return value;
}

function scenarioBase(seed) {
  const objective = token(seed, 'objective');
  const constraint = token(seed, 'protected_constraint');
  const allowedEffect = token(seed, 'allowed_effect');
  const delegatedRole = token(seed, 'delegated_role');
  const checkpointId = token(seed, 'checkpoint');
  const ledgerHead = derive(seed, 'ledger_head');
  const testReceipt = token(seed, 'test_receipt');
  const reviewReceipt = token(seed, 'review_receipt');
  return {
    observation_nonce: token(seed, 'observation'),
    intent: {
      objective,
      protected_constraints: [constraint],
      allowed_effects: [allowedEffect],
    },
    proposal: {
      objective,
      protected_constraints: [constraint],
      requested_effects: [allowedEffect],
    },
    delegation: {
      allowed_roles: [delegatedRole],
      requested_role: delegatedRole,
      maximum_depth: 1,
      requested_depth: 1,
      maximum_count: 1,
      requested_count: 1,
      allowed_effects: [allowedEffect],
      requested_effects: [allowedEffect],
    },
    worker_outcome: {
      status: 'passed',
      interpretation: 'accept',
      recovery_receipt: null,
    },
    state_transition: {
      current_checkpoint_id: checkpointId,
      current_sequence: integer(seed, 'checkpoint_sequence', 10, 500),
      previous_checkpoint_id: checkpointId,
      proposed_sequence: null,
    },
    ledger_transition: {
      current_head_hash: ledgerHead,
      current_event_index: integer(seed, 'ledger_index', 20, 800),
      previous_event_hash: ledgerHead,
      proposed_event_index: null,
    },
    acceptance: {
      decision: 'accept',
      required_receipts: [testReceipt, reviewReceipt],
      receipts: [
        { id: testReceipt, kind: 'test', status: 'passed' },
        { id: reviewReceipt, kind: 'independent_review', status: 'passed' },
      ],
    },
  };
}

function completeScenario(seed) {
  const scenario = scenarioBase(seed);
  scenario.state_transition.proposed_sequence =
    scenario.state_transition.current_sequence + 1;
  scenario.ledger_transition.proposed_event_index =
    scenario.ledger_transition.current_event_index + 1;
  return scenario;
}

function applyViolation(scenario, ruleId, seed) {
  if (ruleId === 'intent-preservation') {
    scenario.proposal.requested_effects.push(token(seed, 'undeclared_effect'));
  } else if (ruleId === 'bounded-delegation') {
    scenario.delegation.requested_depth = scenario.delegation.maximum_depth + 1;
  } else if (ruleId === 'failure-interpretation') {
    scenario.worker_outcome.status = 'failed';
    scenario.worker_outcome.interpretation = 'accept';
  } else if (ruleId === 'state-continuity') {
    scenario.state_transition.previous_checkpoint_id = token(seed, 'stale_checkpoint');
  } else if (ruleId === 'ledger-continuity') {
    scenario.ledger_transition.previous_event_hash = derive(seed, 'unrelated_ledger_head');
  } else if (ruleId === 'acceptance-discipline') {
    scenario.acceptance.receipts = scenario.acceptance.receipts.slice(0, 1);
  } else {
    throw new Error(`unknown owner rule: ${ruleId}`);
  }
  return scenario;
}

function makeDiff(file, before, after) {
  const beforeLine = JSON.stringify(before);
  const afterLine = JSON.stringify(after);
  if (beforeLine === afterLine) throw new Error('owner evaluation mutation must not be a no-op');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1 +1 @@',
    `-${beforeLine}`,
    `+${afterLine}`,
    '',
  ].join('\n');
}

function evaluationCase(seed, label, kind, ruleId = null) {
  const caseSeed = derive(seed, label);
  const file = `control/${derive(caseSeed, 'directory').slice(0, 12)}/${
    derive(caseSeed, 'file').slice(0, 16)
  }.json`;
  let before = completeScenario(caseSeed);
  let after = JSON.parse(JSON.stringify(before));
  if (kind === 'known_bad') {
    after = applyViolation(
      JSON.parse(JSON.stringify(before)),
      ruleId,
      derive(caseSeed, 'violation'),
    );
  } else if (kind === 'mutation') {
    after = completeScenario(caseSeed);
    before = applyViolation(
      JSON.parse(JSON.stringify(after)),
      ruleId,
      derive(caseSeed, 'violation'),
    );
  } else {
    after.observation_nonce = token(caseSeed, 'next_observation');
  }
  const diff = makeDiff(file, before, after);
  return freezeJson({
    id: label,
    kind,
    ruleId,
    severity: ruleId
      ? RULES.find((rule) => rule.id === ruleId).severity
      : 'critical',
    file,
    changedLine: 1,
    before,
    after,
    diff,
  });
}

function generateOwnerEvaluation(seed) {
  if (typeof seed !== 'string' || !/^[a-f0-9]{64}$/iu.test(seed)) {
    throw new Error('owner evaluation seed must be a SHA-256 digest');
  }
  const knownBad = RULES.map((rule, index) => (
    evaluationCase(seed, `case-${index + 1}`, 'known_bad', rule.id)
  ));
  const clean = RULES.map((rule, index) => (
    evaluationCase(
      derive(seed, rule.id),
      `control-${index + 1}`,
      'clean',
      null,
    )
  ));
  const mutationRule = CORPUS.controls.mutation_rule;
  const mutation = evaluationCase(seed, 'reversal-control', 'mutation', mutationRule);
  if (knownBad.length !== KNOWN_BAD_COUNT || clean.length !== CLEAN_COUNT) {
    throw new Error('owner evaluation corpus count drift');
  }
  return freezeJson({
    generatorVersion: GENERATOR_VERSION,
    methodologyVersion: CORPUS.methodology_version,
    knownBad,
    clean,
    mutation,
  });
}

module.exports = {
  CLEAN_COUNT,
  CORPUS,
  GENERATOR_VERSION,
  KNOWN_BAD_COUNT,
  RULES,
  generateOwnerEvaluation,
};
