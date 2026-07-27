#!/usr/bin/env node
'use strict';

/**
 * Bounded multi-reviewer MVP portfolio aggregator.
 *
 * The panel supplies a complete reviewer × candidate matrix. This program unions candidates by
 * stable item_id, admits every evidence-verified MUST-FIX and frozen acceptance prerequisite,
 * then solves the remaining fixed-budget portfolio deterministically. It emits backlog candidates
 * but never writes the backlog or expands the current ticket.
 *
 * Usage: node scripts/review-mvp-portfolio.js --input panel.json
 *        cat panel.json | node scripts/review-mvp-portfolio.js --input -
 */

const crypto = require('crypto');
const fs = require('fs');

const CLASSIFICATIONS = new Set(['MUST-FIX', 'CUT/FOLLOW-UP']);
const EVIDENCE_KINDS = new Set([
  'spec',
  'test',
  'verified-observation',
  'preference',
  'unsupported',
]);
const SUPPORTED_EVIDENCE_KINDS = new Set(['spec', 'test', 'verified-observation']);
const INPUT_KEYS = ['acceptance_prerequisites', 'budget', 'reviewers', 'roster', 'schema_version'];
const REVIEWER_KEYS = ['assessments', 'reviewer_id'];
const ASSESSMENT_KEYS = [
  'classification',
  'evidence',
  'evidence_kind',
  'evidence_verified',
  'follow_up',
  'item_id',
  'scores',
  'title',
];
const SCORE_KEYS = ['acceptance', 'cost', 'risk', 'value'];
const FOLLOW_UP_KEYS = ['context', 'proposed_backlog_title', 'trigger'];

function usage() {
  process.stdout.write('Usage: review-mvp-portfolio.js --input <panel.json|->\n');
}

function fail(message) {
  const error = new Error(message);
  error.validation = true;
  throw error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label, required = allowed) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const unknown = actual.filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !actual.includes(key));
  if (unknown.length > 0) fail(`${label} contains unknown fields: ${unknown.join(', ')}`);
  if (missing.length > 0) fail(`${label} is missing fields: ${missing.join(', ')}`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
  if (value !== value.trim()) fail(`${label} must not have surrounding whitespace`);
  return value;
}

function requireInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function uniqueSortedStrings(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const strings = value.map((item, index) => requireString(item, `${label}[${index}]`));
  const unique = [...new Set(strings)].sort();
  if (unique.length !== strings.length) fail(`${label} must not contain duplicates`);
  return unique;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function parseArgs(argv) {
  let inputPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    }
    if (argument === '--input') {
      if (inputPath !== null || index + 1 >= argv.length) fail('--input requires exactly one path');
      inputPath = argv[index + 1];
      index += 1;
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }
  if (inputPath === null) fail('--input is required');
  return inputPath;
}

function parseInput(inputPath) {
  let raw;
  try {
    raw = inputPath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(inputPath, 'utf8');
  } catch (error) {
    fail(`cannot read input: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`input must be valid JSON: ${error.message}`);
  }
}

function validateFollowUp(value, label) {
  assertExactKeys(value, FOLLOW_UP_KEYS, label);
  return {
    context: requireString(value.context, `${label}.context`),
    proposed_backlog_title: requireString(
      value.proposed_backlog_title,
      `${label}.proposed_backlog_title`,
    ),
    trigger: requireString(value.trigger, `${label}.trigger`),
  };
}

function validateAssessment(value, reviewerId, index) {
  const label = `assessment ${reviewerId}[${index}]`;
  const required = ASSESSMENT_KEYS.filter((key) => key !== 'follow_up');
  assertExactKeys(value, ASSESSMENT_KEYS, label, required);
  const classification = requireString(value.classification, `${label}.classification`);
  if (!CLASSIFICATIONS.has(classification)) {
    fail(`${label}.classification must be MUST-FIX or CUT/FOLLOW-UP`);
  }
  const evidenceKind = requireString(value.evidence_kind, `${label}.evidence_kind`);
  if (!EVIDENCE_KINDS.has(evidenceKind)) fail(`${label}.evidence_kind is unsupported`);
  if (typeof value.evidence_verified !== 'boolean') {
    fail(`${label}.evidence_verified must be boolean`);
  }
  if (value.evidence_verified && !SUPPORTED_EVIDENCE_KINDS.has(evidenceKind)) {
    fail(`${label} cannot verify preference or unsupported evidence`);
  }
  assertExactKeys(value.scores, SCORE_KEYS, `${label}.scores`);
  const scores = {
    acceptance: requireInteger(value.scores.acceptance, `${label}.scores.acceptance`, 0, 10),
    cost: requireInteger(value.scores.cost, `${label}.scores.cost`, 1, 10000),
    risk: requireInteger(value.scores.risk, `${label}.scores.risk`, 0, 10),
    value: requireInteger(value.scores.value, `${label}.scores.value`, 0, 10),
  };
  return {
    classification,
    evidence: requireString(value.evidence, `${label}.evidence`),
    evidence_kind: evidenceKind,
    evidence_verified: value.evidence_verified,
    follow_up: value.follow_up === undefined
      ? null
      : validateFollowUp(value.follow_up, `${label}.follow_up`),
    item_id: requireString(value.item_id, `${label}.item_id`),
    reviewer_id: reviewerId,
    scores,
    title: requireString(value.title, `${label}.title`),
  };
}

function validateAndNormalize(input) {
  assertExactKeys(input, INPUT_KEYS, 'input');
  if (input.schema_version !== 1) fail('schema_version must be 1');
  const budget = requireInteger(input.budget, 'budget', 0, 10000);
  const roster = uniqueSortedStrings(input.roster, 'roster');
  if (roster.length === 0) fail('roster must contain at least one reviewer');
  const prerequisites = uniqueSortedStrings(
    input.acceptance_prerequisites,
    'acceptance_prerequisites',
  );
  if (!Array.isArray(input.reviewers)) fail('reviewers must be an array');

  const reviewerIds = [];
  const assessmentsByReviewer = new Map();
  for (let index = 0; index < input.reviewers.length; index += 1) {
    const reviewer = input.reviewers[index];
    assertExactKeys(reviewer, REVIEWER_KEYS, `reviewers[${index}]`);
    const reviewerId = requireString(reviewer.reviewer_id, `reviewers[${index}].reviewer_id`);
    if (reviewerIds.includes(reviewerId)) fail(`duplicate reviewer block: ${reviewerId}`);
    if (!Array.isArray(reviewer.assessments) || reviewer.assessments.length === 0) {
      fail(`reviewer ${reviewerId} must provide assessments`);
    }
    reviewerIds.push(reviewerId);
    const seen = new Set();
    const assessments = reviewer.assessments.map((assessment, assessmentIndex) => {
      const normalized = validateAssessment(assessment, reviewerId, assessmentIndex);
      if (seen.has(normalized.item_id)) {
        fail(`reviewer ${reviewerId} assessed duplicate item_id ${normalized.item_id}`);
      }
      seen.add(normalized.item_id);
      return normalized;
    });
    assessmentsByReviewer.set(reviewerId, assessments);
  }
  reviewerIds.sort();
  if (!sameArray(roster, reviewerIds)) {
    fail(`reviewer roster mismatch: expected ${roster.join(',')}; got ${reviewerIds.join(',')}`);
  }

  const candidateIds = [...new Set(
    [...assessmentsByReviewer.values()].flatMap((items) => items.map((item) => item.item_id)),
  )].sort();
  for (const reviewerId of roster) {
    const assessedIds = assessmentsByReviewer.get(reviewerId).map((item) => item.item_id).sort();
    if (!sameArray(candidateIds, assessedIds)) {
      fail(`reviewer ${reviewerId} must assess the exact candidate union`);
    }
  }
  for (const prerequisite of prerequisites) {
    if (!candidateIds.includes(prerequisite)) {
      fail(`acceptance prerequisite is absent from candidate union: ${prerequisite}`);
    }
  }

  const candidates = candidateIds.map((itemId) => {
    const assessments = roster.map((reviewerId) =>
      assessmentsByReviewer.get(reviewerId).find((item) => item.item_id === itemId));
    const titles = [...new Set(assessments.map((item) => item.title))];
    if (titles.length !== 1) fail(`title mismatch for item_id ${itemId}`);
    const followUps = assessments.filter((item) => item.follow_up !== null);
    let followUp = null;
    if (followUps.length > 0) {
      if (followUps.length !== assessments.length) {
        fail(`follow_up metadata mismatch for item_id ${itemId}`);
      }
      const canonicalFollowUps = [...new Set(followUps.map((item) => canonicalJson(item.follow_up)))];
      if (canonicalFollowUps.length !== 1) {
        fail(`follow_up metadata mismatch for item_id ${itemId}`);
      }
      followUp = followUps[0].follow_up;
    }
    const acceptance = assessments.reduce((sum, item) => sum + item.scores.acceptance, 0);
    const risk = assessments.reduce((sum, item) => sum + item.scores.risk, 0);
    const value = assessments.reduce((sum, item) => sum + item.scores.value, 0);
    const aggregateScore = acceptance + risk + value;
    const cost = Math.max(...assessments.map((item) => item.scores.cost));
    const verifiedMustFix = assessments.some((item) =>
      item.classification === 'MUST-FIX'
      && item.evidence_verified
      && SUPPORTED_EVIDENCE_KINDS.has(item.evidence_kind));
    const evidenceEligible = assessments.every((item) =>
      item.evidence_verified && SUPPORTED_EVIDENCE_KINDS.has(item.evidence_kind));
    return {
      aggregate_score: aggregateScore,
      assessments,
      cost,
      evidence_eligible: evidenceEligible,
      follow_up: followUp,
      item_id: itemId,
      prerequisite: prerequisites.includes(itemId),
      score_totals: { acceptance, risk, value },
      title: titles[0],
      verified_must_fix: verifiedMustFix,
    };
  });

  return { budget, candidates, prerequisites, roster };
}

function comparePortfolio(left, right) {
  if (left.score !== right.score) return left.score > right.score ? left : right;
  if (left.ids.length !== right.ids.length) return left.ids.length < right.ids.length ? left : right;
  if (left.cost !== right.cost) return left.cost < right.cost ? left : right;
  return left.ids.join('\u0000') <= right.ids.join('\u0000') ? left : right;
}

function optimizeOptional(candidates, budget) {
  let states = new Map([[0, { cost: 0, ids: [], score: 0 }]]);
  for (const candidate of candidates) {
    const next = new Map(states);
    for (const state of states.values()) {
      const cost = state.cost + candidate.cost;
      if (cost > budget) continue;
      const proposal = {
        cost,
        ids: [...state.ids, candidate.item_id].sort(),
        score: state.score + candidate.aggregate_score,
      };
      const existing = next.get(cost);
      next.set(cost, existing === undefined ? proposal : comparePortfolio(existing, proposal));
    }
    states = next;
  }
  return [...states.values()].reduce(comparePortfolio);
}

function scoreBreakdown(candidate) {
  return {
    aggregate_score: candidate.aggregate_score,
    acceptance: candidate.score_totals.acceptance,
    risk: candidate.score_totals.risk,
    value: candidate.score_totals.value,
    conservative_cost: candidate.cost,
    reviewer_count: candidate.assessments.length,
    per_reviewer: candidate.assessments.map((item) => ({
      reviewer_id: item.reviewer_id,
      acceptance: item.scores.acceptance,
      risk: item.scores.risk,
      value: item.scores.value,
      cost: item.scores.cost,
    })),
  };
}

function aggregate(normalized) {
  const mandatory = normalized.candidates.filter((item) =>
    item.prerequisite || item.verified_must_fix);
  const mandatoryCost = mandatory.reduce((sum, item) => sum + item.cost, 0);
  if (mandatoryCost > normalized.budget) {
    fail(`mandatory MVP cost exceeds budget: ${mandatoryCost} > ${normalized.budget}`);
  }
  const optional = normalized.candidates.filter((item) =>
    !item.prerequisite && !item.verified_must_fix && item.evidence_eligible);
  const optimized = optimizeOptional(optional, normalized.budget - mandatoryCost);
  const selectedIds = new Set([...mandatory.map((item) => item.item_id), ...optimized.ids]);

  const selectedMvp = normalized.candidates
    .filter((item) => selectedIds.has(item.item_id))
    .map((item) => {
      let selection = 'score-optimized';
      if (item.prerequisite && item.verified_must_fix) {
        selection = 'acceptance-prerequisite+verified-must-fix';
      } else if (item.prerequisite) {
        selection = 'acceptance-prerequisite';
      } else if (item.verified_must_fix) {
        selection = 'verified-must-fix';
      }
      return {
        item_id: item.item_id,
        title: item.title,
        selection,
        score_breakdown: scoreBreakdown(item),
      };
    });
  const cutList = normalized.candidates
    .filter((item) => !selectedIds.has(item.item_id))
    .map((item) => ({
      item_id: item.item_id,
      title: item.title,
      reason: item.evidence_eligible
        ? 'outside-optimal-fixed-budget-portfolio'
        : 'unsupported-or-preference-only-evidence',
      score_breakdown: scoreBreakdown(item),
    }));

  const backlogCandidates = normalized.candidates
    .filter((item) =>
      !selectedIds.has(item.item_id)
      && item.evidence_eligible
      && item.follow_up !== null
      && item.score_totals.value > 0)
    .map((item) => ({
      fingerprint: sha256({
        context: item.follow_up.context,
        item_id: item.item_id,
        proposed_backlog_title: item.follow_up.proposed_backlog_title,
        trigger: item.follow_up.trigger,
      }),
      item_id: item.item_id,
      sources: item.assessments.map((assessment) => assessment.reviewer_id),
      context: item.follow_up.context,
      trigger: item.follow_up.trigger,
      proposed_backlog_title: item.follow_up.proposed_backlog_title,
      evidence: item.assessments.map((assessment) => ({
        reviewer_id: assessment.reviewer_id,
        evidence_kind: assessment.evidence_kind,
        observation: assessment.evidence,
      })),
      aggregate_score: item.aggregate_score,
      score_breakdown: scoreBreakdown(item),
    }));

  const budgetUsed = selectedMvp.reduce(
    (sum, item) => sum + item.score_breakdown.conservative_cost,
    0,
  );
  return {
    schema_version: 1,
    aggregation_policy: 'union-on-verified-must-fix+fixed-budget-score',
    roster: normalized.roster,
    selected_mvp: selectedMvp,
    cut_list: cutList,
    backlog_candidates: backlogCandidates,
    score_breakdown: {
      budget: normalized.budget,
      budget_used: budgetUsed,
      budget_remaining: normalized.budget - budgetUsed,
      selected_aggregate_score: selectedMvp.reduce(
        (sum, item) => sum + item.score_breakdown.aggregate_score,
        0,
      ),
      optimization_tiebreakers: [
        'maximum-aggregate-score',
        'fewest-items',
        'lowest-cost',
        'lexical-item-id',
      ],
    },
    terminal_condition: {
      state: selectedMvp.length === 0 ? 'NO_MVP_ITEMS_REQUIRED' : 'MVP_SELECTED',
      bounded: true,
      acceptance_prerequisites_satisfied: normalized.prerequisites.every((itemId) =>
        selectedIds.has(itemId)),
      verified_must_fix_satisfied: normalized.candidates
        .filter((item) => item.verified_must_fix)
        .every((item) => selectedIds.has(item.item_id)),
      current_scope_expanded: false,
      reason: 'Frozen prerequisites and verified MUST-FIX union selected; optional score optimum computed.',
    },
  };
}

function main() {
  try {
    const inputPath = parseArgs(process.argv.slice(2));
    const result = aggregate(validateAndNormalize(parseInput(inputPath)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`review-mvp-portfolio: ${error.message}\n`);
    process.exitCode = error.validation ? 2 : 1;
  }
}

main();
