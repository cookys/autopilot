#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SOURCE_ROOT="$REPO_ROOT"
git clone -q --no-local "$SOURCE_ROOT" "$TEST_TMP/hermetic-repo"
git -C "$SOURCE_ROOT" diff --binary HEAD | git -C "$TEST_TMP/hermetic-repo" apply
REPO_ROOT="$TEST_TMP/hermetic-repo"

STATUS_OUT="$TEST_TMP/status-human.out"
node - "$REPO_ROOT" >"$STATUS_OUT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { runStatusCli } = require(path.join(root, 'src/status/cli'));
const receipt = {
  can_close: false,
  product_merged: true,
  consumer_updated: false,
  pushed: false,
  zero_residue: true,
  failed_predicates: ['consumer_updated_false', 'pushed_false'],
};
process.exitCode = runStatusCli(
  ['task', '--root-run-id', 'root-1'],
  { collectTask: () => receipt },
);
NODE
assert_eq "0" "$?" "status task human rendering succeeds"
FIRST="$(sed -n '1p' "$STATUS_OUT")"
assert_contains "$FIRST" "NOT DONE" "human status starts NOT DONE"
assert_contains "$FIRST" "product_merged=true" "product merge label is independent"
assert_contains "$FIRST" "consumer_updated=false" "consumer label is independent"
assert_contains "$FIRST" "pushed=false" "push label is independent"
assert_contains "$FIRST" "zero_residue=true" "residue label is independent"
assert_contains "$(cat "$STATUS_OUT")" "Blocker: consumer_updated_false" \
  "only the first current blocker is reported"
assert_contains "$(cat "$STATUS_OUT")" "Next action:" "human status gives an exact next action"

MARKER_DIR="$TEST_TMP/markers"
export AUTOPILOT_SESSION_MODE_DIR="$MARKER_DIR"
export CLAUDE_CODE_SESSION_ID="lsm-p4"
node "$REPO_ROOT/scripts/session-mode.js" set --level l6 --repo-root "$REPO_ROOT" >/dev/null
OUT="$(node "$REPO_ROOT/scripts/session-mode.js" clear 2>&1)"; RC=$?
assert_eq "1" "$RC" "L6 marker clear blocks without task close receipt"
assert_contains "$OUT" "close blocked" "marker gate explains the block"

node - "$REPO_ROOT" "$TEST_TMP/close.json" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalDigest } = require(path.join(process.argv[2], 'src/engine/campaign-verification'));
const common = fs.realpathSync(execFileSync(
  'git',
  ['-C', process.argv[2], 'rev-parse', '--path-format=absolute', '--git-common-dir'],
  { encoding: 'utf8' },
).trim());
const body = {
  schema_version: 1,
  artifact_type: 'task_status_receipt',
  issued_at: new Date().toISOString(),
  repo_identity: `git-common-dir:${common}`,
  root_run_id: 'root-1',
  goal: 'close fixture',
  phase: 'terminal',
  candidate_commit: null,
  candidate_tree_sha: null,
  acceptance_verdict: 'accepted',
  accepted_blockers: [],
  deferred_count: 1,
  active_owned_worktrees: 0,
  active_owned_branches: 0,
  integration_target: { ref: 'refs/heads/develop', observed_sha: null },
  product_merged: true,
  consumer_updated: false,
  pushed: false,
  zero_residue: true,
  mission_terminal: true,
  campaigns_terminal: true,
  evidence: {
    mission: { status: 'valid' },
    campaigns: { status: 'valid' },
    lifecycle: { status: 'valid' },
    integration: { status: 'valid' },
    merge_preflight: { status: 'valid' },
    merge_execution: { status: 'valid', execution_status: 'complete' },
    merge_provenance: { status: 'valid' },
  },
  can_merge: true,
  can_close: true,
  failed_predicates: [],
};
fs.writeFileSync(process.argv[3], JSON.stringify({
  ...body,
  receipt_digest: canonicalDigest(body),
}));
NODE
node "$REPO_ROOT/scripts/session-mode.js" clear \
  --task-status-receipt "$TEST_TMP/close.json" --root-run-id root-1 >/dev/null
assert_eq "0" "$?" "fresh can_close receipt clears L6 marker"
node "$REPO_ROOT/scripts/session-mode.js" clear >/dev/null
assert_eq "0" "$?" "marker clear stays idempotent after terminal close"
node "$REPO_ROOT/scripts/session-mode.js" clear \
  --task-status-receipt "$TEST_TMP/close.json" --root-run-id root-1 >/dev/null
assert_eq "0" "$?" "explicit close receipt is validated when the marker is absent"
OUT="$(node "$REPO_ROOT/scripts/session-mode.js" clear \
  --task-status-receipt "$TEST_TMP/close.json" --root-run-id wrong-root 2>&1)"; RC=$?
assert_eq "1" "$RC" "explicit close receipt mismatch blocks when the marker is absent"
assert_contains "$OUT" "root_run_id mismatch" "absent-marker validation reports the binding mismatch"

node "$REPO_ROOT/scripts/session-mode.js" set \
  --level l6 --repo-root "$REPO_ROOT" --ttl-hours 0 >/dev/null
node "$REPO_ROOT/scripts/session-mode.js" clear \
  --task-status-receipt "$TEST_TMP/close.json" --root-run-id root-1 >/dev/null
assert_eq "0" "$?" "explicit close receipt is validated with an expired marker"

node - "$TEST_TMP/close.json" "$TEST_TMP/tampered-close.json" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.goal = 'tampered after sealing';
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
OUT="$(node "$REPO_ROOT/scripts/session-mode.js" clear \
  --task-status-receipt "$TEST_TMP/tampered-close.json" --root-run-id root-1 2>&1)"; RC=$?
assert_eq "1" "$RC" "expired-marker clear still validates the receipt digest"
assert_contains "$OUT" "digest is invalid" "expired-marker validation rejects a tampered receipt"

cp "$REPO_ROOT/docs/BACKLOG.md" "$TEST_TMP/BACKLOG.md"
node - "$TEST_TMP/candidates.json" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const material = {
  context: 'A process crash can interrupt merge receipt publication.',
  item_id: 'durable-wal',
  proposed_backlog_title: 'Durable merge crash receipt',
  trigger: 'When a caller-owned durable receipt path is standardized.',
};
const fingerprint = crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
const scoreBreakdown = {
  aggregate_score: 7,
  acceptance: 0,
  risk: 3,
  value: 4,
  conservative_cost: 8,
  reviewer_count: 2,
  per_reviewer: [
    { reviewer_id: 'review-a', acceptance: 0, risk: 1, value: 2, cost: 4 },
    { reviewer_id: 'review-b', acceptance: 0, risk: 2, value: 2, cost: 8 },
  ],
};
fs.writeFileSync(process.argv[2], JSON.stringify({
  schema_version: 1,
  aggregation_policy: 'union-on-verified-must-fix+fixed-budget-score',
  roster: ['review-a', 'review-b'],
  selected_mvp: [],
  cut_list: [{
    item_id: material.item_id,
    title: 'Preserve merge receipt across a crash',
    reason: 'outside-optimal-fixed-budget-portfolio',
    score_breakdown: scoreBreakdown,
  }],
  backlog_candidates: [{
    fingerprint,
    item_id: material.item_id,
    proposed_backlog_title: material.proposed_backlog_title,
    context: material.context,
    trigger: material.trigger,
    sources: ['review-a', 'review-b'],
    aggregate_score: 7,
    score_breakdown: scoreBreakdown,
    evidence: [
      { reviewer_id: 'review-a', evidence_kind: 'verified-observation', observation: 'No WAL path exists.' },
      { reviewer_id: 'review-b', evidence_kind: 'spec', observation: 'P3 omits storage authority.' },
    ],
  }],
  score_breakdown: {
    budget: 0,
    budget_used: 0,
    budget_remaining: 0,
    selected_aggregate_score: 0,
    optimization_tiebreakers: [
      'maximum-aggregate-score',
      'fewest-items',
      'lowest-cost',
      'lexical-item-id',
    ],
  },
  terminal_condition: {
    state: 'NO_MVP_ITEMS_REQUIRED',
    bounded: true,
    acceptance_prerequisites_satisfied: true,
    verified_must_fix_satisfied: true,
    current_scope_expanded: false,
    reason: 'Frozen prerequisites and verified MUST-FIX union selected; optional score optimum computed.',
  },
}));
NODE

ADMIT1="$(node "$REPO_ROOT/scripts/admit-backlog-follow-ups.js" \
  --input "$TEST_TMP/candidates.json" --backlog "$TEST_TMP/BACKLOG.md" \
  --current-ticket seq19)"
assert_contains "$ADMIT1" '"current_ticket_reopened": false' \
  "backlog admission never reopens the current ticket"
FINGERPRINT="$(node -e "const v=require('$TEST_TMP/candidates.json');process.stdout.write(v.backlog_candidates[0].fingerprint)")"
assert_contains "$ADMIT1" "\"$FINGERPRINT\"" \
  "evidence-backed candidate is admitted"
COUNT1="$(grep -c "autopilot-follow-up:$FINGERPRINT" "$TEST_TMP/BACKLOG.md")"
node "$REPO_ROOT/scripts/admit-backlog-follow-ups.js" \
  --input "$TEST_TMP/candidates.json" --backlog "$TEST_TMP/BACKLOG.md" \
  --current-ticket seq19 >/dev/null
COUNT2="$(grep -c "autopilot-follow-up:$FINGERPRINT" "$TEST_TMP/BACKLOG.md")"
assert_eq "1" "$COUNT1" "candidate is written once"
assert_eq "$COUNT1" "$COUNT2" "repeat admission is fingerprint-idempotent"
assert_contains "$(cat "$TEST_TMP/BACKLOG.md")" "**Source**: review-a; review-b" \
  "admitted entry records sources"
assert_contains "$(cat "$TEST_TMP/BACKLOG.md")" "**Context**:" \
  "admitted entry records context"
assert_contains "$(cat "$TEST_TMP/BACKLOG.md")" "**Trigger**:" \
  "admitted entry records trigger"
sed -i 's/A process crash can interrupt merge receipt publication./tampered context/' \
  "$TEST_TMP/BACKLOG.md"
OUT="$(node "$REPO_ROOT/scripts/admit-backlog-follow-ups.js" \
  --input "$TEST_TMP/candidates.json" --backlog "$TEST_TMP/BACKLOG.md" \
  --current-ticket seq19 2>&1)"; RC=$?
assert_eq "2" "$RC" "same fingerprint with changed backlog content fails closed"
assert_contains "$OUT" "fingerprint content conflict" "fingerprint conflict is explicit"

cp "$REPO_ROOT/docs/BACKLOG.md" "$TEST_TMP/portfolio-BACKLOG.md"
node - "$TEST_TMP/candidates.json" "$TEST_TMP/malformed-portfolio.json" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.terminal_condition.acceptance_prerequisites_satisfied = false;
value.terminal_condition.verified_must_fix_satisfied = false;
value.score_breakdown.optimization_tiebreakers = [];
delete value.backlog_candidates[0].evidence[0].reviewer_id;
value.backlog_candidates[0].evidence[1].unexpected = true;
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
PORTFOLIO_BACKLOG_BEFORE="$(sha256sum "$TEST_TMP/portfolio-BACKLOG.md" | cut -d' ' -f1)"
PORTFOLIO_ADMISSION="$(node "$REPO_ROOT/scripts/admit-backlog-follow-ups.js" \
  --input "$TEST_TMP/malformed-portfolio.json" \
  --backlog "$TEST_TMP/portfolio-BACKLOG.md" --current-ticket seq20)"
assert_eq "0" "$?" "fingerprint-valid malformed portfolio is rejected without crashing"
assert_contains "$PORTFOLIO_ADMISSION" '"reason": "noncanonical_artifact"' \
  "false terminal proofs and malformed nested portfolio fields reject the artifact"
PORTFOLIO_BACKLOG_AFTER="$(sha256sum "$TEST_TMP/portfolio-BACKLOG.md" | cut -d' ' -f1)"
assert_eq "$PORTFOLIO_BACKLOG_BEFORE" "$PORTFOLIO_BACKLOG_AFTER" \
  "noncanonical portfolio does not mutate backlog"

cp "$REPO_ROOT/docs/BACKLOG.md" "$TEST_TMP/campaign-BACKLOG.md"
node - "$TEST_TMP/malformed-campaign.json" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const body = {
  schema_version: 1,
  artifact_type: 'implementation_campaign_terminal',
  status: 'follow_up',
  candidate_tree_sha: 'a'.repeat(40),
  verification_receipt_digest: 'b'.repeat(64),
  repair_generations: 0,
  final_panel_count: 1,
  follow_up: [{
    id: 'missing-authority',
    source: 'review-a',
    evidence: { classification: 'actionable', digest: 'c'.repeat(64) },
    disposition: {
      disposition: 'follow-up',
      context: 'Nested required fields are absent.',
      trigger: 'When schema admission is enforced.',
      proposed_backlog_title: 'Must not admit missing nested fields',
    },
  }, {
    id: 'extra-evidence-key',
    claim: 'Evidence carries an undeclared nested key.',
    severity: '🟡',
    source: 'review-b',
    evidence: {
      classification: 'actionable',
      digest: 'd'.repeat(64),
      unexpected: true,
    },
    adjudication_authority: {
      authority: 'depth-0',
      actor_id: 'root',
      review_digest: 'e'.repeat(64),
    },
    disposition: {
      disposition: 'follow-up',
      context: 'Nested additional properties must fail closed.',
      trigger: 'When the campaign receipt is schema-checked.',
      proposed_backlog_title: 'Must not admit extra nested fields',
    },
  }],
  rejected_findings: [],
  unresolved_final_findings: [],
  trace: ['terminal'],
};
body.receipt_digest = crypto.createHash('sha256').update(canonical(body)).digest('hex');
fs.writeFileSync(process.argv[2], JSON.stringify(body));
NODE
CAMPAIGN_BACKLOG_BEFORE="$(sha256sum "$TEST_TMP/campaign-BACKLOG.md" | cut -d' ' -f1)"
CAMPAIGN_ADMISSION="$(node "$REPO_ROOT/scripts/admit-backlog-follow-ups.js" \
  --input "$TEST_TMP/malformed-campaign.json" \
  --backlog "$TEST_TMP/campaign-BACKLOG.md" --current-ticket seq20)"
assert_eq "0" "$?" "digest-valid malformed campaign is rejected without crashing"
assert_eq "2" "$(printf '%s' "$CAMPAIGN_ADMISSION" | node -e \
  'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(String(JSON.parse(s).rejected.filter(x=>x.reason==="noncanonical_artifact").length)))')" \
  "both malformed nested campaign findings are rejected"
CAMPAIGN_BACKLOG_AFTER="$(sha256sum "$TEST_TMP/campaign-BACKLOG.md" | cut -d' ' -f1)"
assert_eq "$CAMPAIGN_BACKLOG_BEFORE" "$CAMPAIGN_BACKLOG_AFTER" \
  "noncanonical campaign does not mutate backlog"

finalize_test
