#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

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
const nitpick = {
  context: 'A reviewer prefers a cosmetic rename.',
  item_id: 'nitpick-rename',
  proposed_backlog_title: 'Cosmetic rename',
  trigger: 'Never automatically.',
};
const nitpickFingerprint = crypto.createHash('sha256')
  .update(JSON.stringify(nitpick))
  .digest('hex');
fs.writeFileSync(process.argv[2], JSON.stringify({
  backlog_candidates: [{
    fingerprint,
    item_id: material.item_id,
    proposed_backlog_title: material.proposed_backlog_title,
    context: material.context,
    trigger: material.trigger,
    sources: ['review-a', 'review-b'],
    aggregate_score: 7,
    score_breakdown: {
      aggregate_score: 7,
      acceptance: 0,
      risk: 3,
      value: 4,
      conservative_cost: 8,
      reviewer_count: 2,
      per_reviewer: [],
    },
    evidence: [
      { reviewer_id: 'review-a', evidence_kind: 'verified-observation', observation: 'No WAL path exists.' },
      { reviewer_id: 'review-b', evidence_kind: 'spec', observation: 'P3 omits storage authority.' },
    ],
  }, {
    fingerprint: 'b'.repeat(64),
    item_id: 'rename',
    proposed_backlog_title: 'Preference-only rename',
    context: 'A reviewer prefers another label.',
    trigger: 'Never automatically.',
    sources: ['review-c'],
    aggregate_score: 2,
    score_breakdown: {
      aggregate_score: 2,
      acceptance: 0,
      risk: 0,
      value: 2,
      conservative_cost: 1,
      reviewer_count: 1,
      per_reviewer: [],
    },
    evidence: [
      { reviewer_id: 'review-c', evidence_kind: 'preference', observation: 'I prefer it.' },
    ],
  }, {
    fingerprint: nitpickFingerprint,
    item_id: nitpick.item_id,
    proposed_backlog_title: nitpick.proposed_backlog_title,
    context: nitpick.context,
    trigger: nitpick.trigger,
    sources: ['review-d'],
    aggregate_score: 3,
    score_breakdown: {
      aggregate_score: 3,
      acceptance: 0,
      risk: 0,
      value: 3,
      conservative_cost: 1,
      reviewer_count: 1,
      per_reviewer: [],
    },
    evidence: [
      {
        reviewer_id: 'review-d',
        evidence_kind: 'verified-observation',
        observation: 'The current name is functional.',
      },
    ],
    classification: 'nitpick',
  }],
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
assert_contains "$ADMIT1" '"unsupported_evidence"' "preference-only candidate is rejected"
assert_contains "$ADMIT1" '"noncanonical_candidate"' \
  "nitpick/unknown classification cannot bypass canonical portfolio shape"
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

finalize_test
