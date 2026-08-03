#!/usr/bin/env bash
# Deterministic bounded multi-reviewer MVP portfolio aggregation.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/review-mvp-portfolio.js"
INPUT="$TEST_TMP/panel.json"
REORDERED="$TEST_TMP/panel-reordered.json"

write_panel() {
  local path="$1"
  node - "$path" <<'NODE'
const fs = require('fs');
const out = process.argv[2];
const assessment = (item_id, title, classification, evidence, evidence_kind,
  evidence_verified, acceptance, risk, value, cost, follow_up = undefined) => ({
  item_id,
  title,
  classification,
  evidence,
  evidence_kind,
  evidence_verified,
  scores: { acceptance, risk, value, cost },
  ...(follow_up ? { follow_up } : {}),
});
const docsFollowUp = {
  context: 'The MVP works, but operator recovery remains manual.',
  trigger: 'When the second operator adopts the workflow.',
  proposed_backlog_title: 'Automate operator recovery guidance',
};
const preferenceFollowUp = {
  context: 'One reviewer prefers a different label.',
  trigger: 'If user research rejects the current wording.',
  proposed_backlog_title: 'Rename the status label',
};
const reviewers = [
  {
    reviewer_id: 'reviewer-b',
    assessments: [
      assessment('guard', 'Reject unsafe input', 'MUST-FIX',
        'The malformed fixture reaches the mutation path.', 'test', true, 10, 10, 9, 2),
      assessment('core', 'Ship the core vertical slice', 'CUT/FOLLOW-UP',
        'Frozen acceptance A1 names this path.', 'spec', true, 10, 8, 9, 3),
      assessment('fast', 'Add the fast-path cache', 'CUT/FOLLOW-UP',
        'Benchmark B2 saves 40 percent wall time.', 'test', true, 6, 4, 8, 2),
      assessment('fleet', 'Add the fleet cache', 'CUT/FOLLOW-UP',
        'Benchmark B3 reports the same total benefit.', 'test', true, 6, 4, 8, 2),
      assessment('pair-a', 'Add cache half A', 'CUT/FOLLOW-UP',
        'Profile P2 attributes half the cache benefit here.', 'verified-observation',
        true, 3, 2, 4, 1),
      assessment('pair-b', 'Add cache half B', 'CUT/FOLLOW-UP',
        'Profile P2 attributes the other half here.', 'verified-observation',
        true, 3, 2, 4, 1),
      assessment('docs', 'Automate recovery guidance', 'CUT/FOLLOW-UP',
        'Runbook probe requires three manual recovery steps.', 'verified-observation',
        true, 4, 5, 7, 4, docsFollowUp),
      assessment('paint', 'Rename the status label', 'CUT/FOLLOW-UP',
        'I prefer a shorter word.', 'preference', false, 1, 0, 4, 1, preferenceFollowUp),
    ],
  },
  {
    reviewer_id: 'reviewer-a',
    assessments: [
      assessment('paint', 'Rename the status label', 'CUT/FOLLOW-UP',
        'No acceptance evidence supports a rename.', 'unsupported', false, 0, 0, 1, 1,
        preferenceFollowUp),
      assessment('docs', 'Automate recovery guidance', 'CUT/FOLLOW-UP',
        'The recovery drill records manual operator intervention.', 'test',
        true, 5, 6, 8, 3, docsFollowUp),
      assessment('fast', 'Add the fast-path cache', 'CUT/FOLLOW-UP',
        'Profile P1 identifies the same repeated query.', 'verified-observation',
        true, 5, 5, 8, 2),
      assessment('fleet', 'Add the fleet cache', 'CUT/FOLLOW-UP',
        'Profile P1 assigns the same total score.', 'verified-observation',
        true, 5, 5, 8, 2),
      assessment('pair-a', 'Add cache half A', 'CUT/FOLLOW-UP',
        'Benchmark B4 measures half the fast-path benefit.', 'test', true, 3, 2, 4, 1),
      assessment('pair-b', 'Add cache half B', 'CUT/FOLLOW-UP',
        'Benchmark B4 measures the other half.', 'test', true, 3, 2, 4, 1),
      assessment('core', 'Ship the core vertical slice', 'MUST-FIX',
        'Acceptance A1 is impossible without this item.', 'spec', true, 10, 9, 10, 3),
      assessment('guard', 'Reject unsafe input', 'CUT/FOLLOW-UP',
        'Security rubric S1 requires malformed-input rejection.', 'spec', true, 9, 10, 8, 2),
    ],
  },
];
fs.writeFileSync(out, JSON.stringify({
  schema_version: 1,
  roster: ['reviewer-a', 'reviewer-b'],
  budget: 7,
  acceptance_prerequisites: ['core'],
  reviewers,
}, null, 2));
NODE
}

write_panel "$INPUT"

# RED before implementation: the focused contract must not silently pass without the aggregator.
node --check "$SCRIPT"
assert_exit_code "$?" "0" "aggregator syntax is valid"

OUT="$(node "$SCRIPT" --input "$INPUT")"; EXIT=$?
assert_exit_code "$EXIT" "0" "valid complete panel produces a bounded portfolio"

node - "$OUT" <<'NODE'
const assert = require('assert');
const result = JSON.parse(process.argv[2]);
assert.deepStrictEqual(result.selected_mvp.map((item) => item.item_id), ['core', 'fast', 'guard']);
assert.strictEqual(result.selected_mvp.find((item) => item.item_id === 'guard').selection,
  'verified-must-fix');
assert.strictEqual(result.selected_mvp.find((item) => item.item_id === 'core').selection,
  'acceptance-prerequisite+verified-must-fix');
assert.strictEqual(result.selected_mvp.find((item) => item.item_id === 'fast').selection,
  'score-optimized');
assert.deepStrictEqual(result.cut_list.map((item) => item.item_id),
  ['docs', 'fleet', 'paint', 'pair-a', 'pair-b']);
assert.strictEqual(result.cut_list.find((item) => item.item_id === 'paint').reason,
  'unsupported-or-preference-only-evidence');
assert.strictEqual(result.score_breakdown.budget, 7);
assert.strictEqual(result.score_breakdown.budget_used, 7);
assert.strictEqual(result.terminal_condition.state, 'MVP_SELECTED');
assert.strictEqual(result.terminal_condition.acceptance_prerequisites_satisfied, true);
assert.strictEqual(result.terminal_condition.verified_must_fix_satisfied, true);
assert.deepStrictEqual(result.backlog_candidates.map((item) => item.item_id), ['docs']);
assert.match(result.backlog_candidates[0].fingerprint, /^[a-f0-9]{64}$/u);
assert.deepStrictEqual(result.backlog_candidates[0].sources, ['reviewer-a', 'reviewer-b']);
assert.strictEqual(result.backlog_candidates[0].trigger,
  'When the second operator adopts the workflow.');
assert.ok(result.backlog_candidates[0].aggregate_score > 0);
NODE
assert_exit_code "$?" "0" "union, mandatory findings, scoring, cuts, and backlog contract hold"

# Reviewer and assessment order cannot change the normalized portfolio or fingerprint.
node - "$INPUT" "$REORDERED" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.reviewers.reverse();
for (const reviewer of value.reviewers) reviewer.assessments.reverse();
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
REORDERED_OUT="$(node "$SCRIPT" --input "$REORDERED")"; EXIT=$?
assert_exit_code "$EXIT" "0" "reordered complete panel remains valid"
assert_eq "$OUT" "$REORDERED_OUT" "aggregation is byte-deterministic across input order"

run_invalid() {
  local name="$1" transform="$2" expected="$3"
  local invalid="$TEST_TMP/$name.json"
  node - "$INPUT" "$invalid" "$transform" <<'NODE'
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
Function('input', process.argv[4])(input);
fs.writeFileSync(process.argv[3], JSON.stringify(input));
NODE
  local stdout_file="$TEST_TMP/$name.stdout" stderr_file="$TEST_TMP/$name.stderr"
  node "$SCRIPT" --input "$invalid" >"$stdout_file" 2>"$stderr_file"
  local rc=$?
  assert_exit_code "$rc" "2" "$name fails closed"
  assert_contains "$(cat "$stderr_file")" "$expected" "$name reports its validation boundary"
}

run_invalid "roster-mismatch" \
  "input.roster = ['reviewer-a', 'reviewer-c'];" \
  "reviewer roster mismatch"
run_invalid "missing-assessment" \
  "input.reviewers[0].assessments.pop();" \
  "must assess the exact candidate union"
run_invalid "budget-too-small" \
  "input.budget = 4;" \
  "mandatory MVP cost exceeds budget"
run_invalid "unknown-score" \
  "delete input.reviewers[0].assessments[0].scores.value;" \
  "scores is missing fields: value"
run_invalid "follow-up-drift" \
  "input.reviewers[0].assessments.find((x) => x.item_id === 'docs').follow_up.trigger = 'different';" \
  "follow_up metadata mismatch"

echo "All review MVP portfolio tests passed."
