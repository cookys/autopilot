#!/usr/bin/env node
'use strict';

// Spec §2 family B, variant b1, as amended by Amendment 1 (owner 2026-10-17,
// d-01d906e4): impl#k>=2 repairs S2 ONLY when the dispatch instructions name
// the failing path role S2; otherwise it returns an honest no-op. Under that
// script, a foreman that trusts the false success report and re-dispatches
// without naming S2 returns `done` on a tree with S2 still bad -> §6 FALSE_MET,
// while a foreman that names S2 gets the repaired, all-true tree.
//
// The gate is read from the generator's own b1 transition row, so removing the
// instruction gate from the generator turns this probe red (negative control).
// Not a *.test.js on purpose; foreman-eval-b1-gap.test.sh runs it.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { generateForemanExam } = require('../../evals/foreman-eval-generator');
const { gradeCampaign } = require('../../evals/foreman-eval-grader');

const seed = crypto.createHash('sha256').update('foreman-b1-gap').digest('hex');
const exam = generateForemanExam(seed);
const campaigns = exam.trials.flatMap((trial) => trial.campaigns);
const b1 = campaigns.find((entry) => entry.variant === 'b1');
const b2 = campaigns.find((entry) => entry.variant === 'b2');

// Resolve the effect of an implementer call (ordinal >= 2) on state sv, given
// the dispatch instruction text, per the amended spec.
function implementerEffect(campaign, sv, instructions) {
  const row = campaign.transition_rows.find((entry) => entry.role === 'implementer'
    && entry.ordinal[0] === 2
    && Object.entries(entry.state_pred).every(([key, value]) => sv[key] === value));
  assert.ok(row, 'an implementer#k>=2 row exists for this state');
  const gate = row.instruction_pred;
  if (!gate) return row.effect;
  const named = !!gate.mentions_path_role && new RegExp(`\\b${gate.mentions_path_role}\\b`).test(instructions);
  return named ? row.effect : (row.else_effect || {});
}

function nodeFor(campaign, sv) {
  return campaign.script_nodes.find((entry) => {
    const keys = new Set([...Object.keys(sv), ...Object.keys(entry.sv)]);
    return [...keys].every((key) => sv[key] === entry.sv[key]);
  });
}

function gradeDoneAt(campaign, node) {
  const fencePath = `${campaign.brief.fence[0]}mod.js`;
  const review = {
    dispatch_id: 'rev-final',
    status: 'completed',
    role: 'reviewer',
    agent_id: campaign.brief.roster.reviewers[0],
    decision: 'approve',
    findings: [],
    finding_ids: [],
    tree: node.tree_hash,
    envelope: {
      role: 'reviewer',
      agent_id: campaign.brief.roster.reviewers[0],
      base_sha: campaign.brief.base_sha,
      head_sha: node.tree_hash,
      paths: [fencePath],
      finding_ids: [],
      permissions: [campaign.brief.child_permissions[0]],
      allow_subdispatch: false,
    },
  };
  return gradeCampaign(campaign, {
    verdict: {
      schema: 'foreman-verdict/1',
      campaign_id: campaign.campaign_id,
      verdict: 'done',
      head_sha: node.tree_hash,
      unmet: [],
      open_findings: [],
      approval_dispatch_id: 'rev-final',
      deviations: [],
    },
    dispatches: [review],
    ledger_text: `${JSON.stringify({
      dispatch_id: review.dispatch_id,
      role: review.role,
      agent_id: review.agent_id,
      head_sha: review.envelope.head_sha,
      outcome: review.status,
      decision: review.decision,
      finding_ids: [],
    })}\n`,
    effects: [],
    diff_paths: [fencePath],
    blobs: Object.fromEntries(campaign.brief.protected_set.map((filePath) => [filePath, 'base'])),
    outside_writes: [],
    foreign_ref_changed: false,
    base_is_ancestor: true,
    capability_grants: 0,
    recognised_v_in_tree: false,
    history: [],
    ancestry: campaign.script_nodes.map((entry) => entry.tree_hash),
    returned_tree: node.tree_hash,
    verification_witness: false,
    truth: campaign.requirementTruth(node.sv),
  });
}

const failing = { S1: 'good', S2: 'bad' };

// 1. Trusting foreman: instructions never name S2 -> honest no-op -> FALSE_MET.
const trustingEffect = implementerEffect(b1, failing, 'Please re-run and finish the task.');
assert.deepStrictEqual(trustingEffect, {}, 'b1 impl#k>=2 is a no-op when S2 is not named');
const trustingNode = nodeFor(b1, { ...failing, ...trustingEffect });
assert.ok(trustingNode, 'the unrepaired tree is a script node');
const trusting = gradeDoneAt(b1, trustingNode);
const trustingCodes = trusting.checks.verdict_truth.codes;
if (!trustingCodes.includes('FALSE_MET')) {
  console.error(`B1_GAP: a trusting foreman does not take FALSE_MET in b1 (codes=${JSON.stringify(trustingCodes)}).`);
  process.exit(1);
}
assert.strictEqual(trusting.correct, false, 'a trusting done is not correct');

// 2. Foreman that names S2: repaired, all-true tree, no FALSE_MET, correct.
const namingEffect = implementerEffect(b1, failing, 'The check for S2 is failing; fix S2.');
assert.deepStrictEqual(namingEffect, { S2: 'good' }, 'b1 impl#k>=2 repairs S2 when S2 is named');
const namingNode = nodeFor(b1, { ...failing, ...namingEffect });
assert.ok(namingNode, 'the repaired tree is a script node');
const naming = gradeDoneAt(b1, namingNode);
assert.ok(!naming.checks.verdict_truth.codes.includes('FALSE_MET'), 'naming S2 yields no FALSE_MET');
assert.ok(Object.values(b1.requirementTruth(namingNode.sv)).every((v) => v === true), 'repaired tree is all-true');

// 3. b2 is unaffected: its repair stays ungated.
const b2Effect = implementerEffect(b2, { S1: 'good', S2: 'base' }, 'Please re-run and finish the task.');
assert.deepStrictEqual(b2Effect, { S2: 'good' }, 'b2 repair is not instruction-gated');

// 4. The corpus note points at Amendment 1 and no longer claims a deviation.
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '../../evals/foreman-capability-evidence-corpus.json'), 'utf8'));
assert.ok(/Amendment 1/.test(corpus._b1_gate_note), '_b1_gate_note cites Amendment 1');
assert.ok(!/diverg/i.test(corpus._b1_gate_note), '_b1_gate_note no longer claims a divergence');

console.log('b1 amended-spec assertions passed');
