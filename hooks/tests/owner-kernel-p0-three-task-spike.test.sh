#!/usr/bin/env bash
# P0 three-task spike controls: durable ledger, independent-family review, and transcript-free resume.

set -uo pipefail

TEST_NAME="owner-kernel-p0-three-task-spike"
. "$(dirname "$0")/lib.sh"

SPIKE="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/supervised-three-task-spike.js"
MANIFEST="$TEST_TMP/task-specs.json"
AUTHOR="$TEST_TMP/author"
WORK="$TEST_TMP/work"

cp "$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/spike/task-specs.json" "$MANIFEST"

node - "$SPIKE" "$AUTHOR" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const { canonical } = require(process.argv[2]);
const root = process.argv[3];
const rows = {
  'low-status': {
    runner: 'grok',
    model: 'grok-4.5',
    value: { task: 'low-status', status: 'complete', checks: ['hash'] },
  },
  'medium-boundary': {
    runner: 'anthropic-compatible',
    model: 'MiniMax-M3',
    value: { task: 'medium-boundary', mediation: 'required', controls: ['broker', 'receipt'] },
  },
  'medium-resume': {
    runner: 'anthropic-compatible',
    model: 'GLM-5.2',
    value: { task: 'medium-resume', approval: 'required', evidence: ['ledger', 'receipt'] },
  },
};
fs.mkdirSync(`${root}/provenance`, { recursive: true });
for (const [id, row] of Object.entries(rows)) {
  const text = canonical(row.value) + '\n';
  fs.writeFileSync(`${root}/${id}.json`, text);
  fs.writeFileSync(`${root}/provenance/${id}.json`, JSON.stringify({
    task_id: id,
    status: 'authored',
    runner: row.runner,
    model: row.model,
    family: ({ 'grok:grok-4.5': 'grok', 'anthropic-compatible:MiniMax-M3': 'minimax', 'anthropic-compatible:GLM-5.2': 'glm' })[`${row.runner}:${row.model}`],
    normalized_output_sha256: crypto.createHash('sha256').update(text).digest('hex'),
  }) + '\n');
}
NODE

run_spike() {
  local stderr="$TEST_TMP/spike.stderr"
  __SPIKE_OUT=$(node "$SPIKE" "$@" 2>"$stderr")
  __SPIKE_EXIT=$?
  __SPIKE_ERR=$(<"$stderr")
}

BAD_BASELINE_MANIFEST="$TEST_TMP/task-specs.bad-baseline.json"
cp "$MANIFEST" "$BAD_BASELINE_MANIFEST"
node - "$BAD_BASELINE_MANIFEST" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.baseline_mandatory_review_dispatches = 60;
fs.writeFileSync(file, JSON.stringify(manifest) + '\n');
NODE
run_spike prepare \
  --workspace "$TEST_TMP/bad-baseline-work" \
  --manifest "$BAD_BASELINE_MANIFEST" \
  --author-content-dir "$AUTHOR" \
  --author-provenance-dir "$AUTHOR/provenance"
assert_exit_code "$__SPIKE_EXIT" "1" "caller cannot inflate the fixed review baseline"
assert_contains "$__SPIKE_ERR" 'spike_baseline_must_match_frozen_contract' "review baseline is a frozen P0 contract"

run_spike prepare \
  --workspace "$WORK" \
  --manifest "$MANIFEST" \
  --author-content-dir "$AUTHOR" \
  --author-provenance-dir "$AUTHOR/provenance"
assert_exit_code "$__SPIKE_EXIT" "0" "prepare completes the first two mediated tasks"
assert_contains "$__SPIKE_OUT" '"open_approvals": [' "prepare leaves the medium approval open"
assert_file_exists "$WORK/ledger/events.jsonl" "minimum durable ledger exists"
assert_file_exists "$WORK/tasks/low-status/receipts/receipts.jsonl" "worker-external receipt root exists"

# A later process must not recover from the original prompt/author directory or task manifest.
mv "$MANIFEST" "$TEST_TMP/task-specs.hidden.json"
mv "$AUTHOR" "$TEST_TMP/author.hidden"
run_spike resume --workspace "$WORK" --task medium-resume
assert_exit_code "$__SPIKE_EXIT" "1" "resume fails closed without a new approval reference"
assert_contains "$__SPIKE_ERR" '--approval-file_required' "missing approval is explicit"

OPERATOR_KEY="$TEST_TMP/operator.key"
APPROVAL="$TEST_TMP/approval.json"
BAD_APPROVAL="$TEST_TMP/approval.bad.json"
node - "$OPERATOR_KEY" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
fs.writeFileSync(process.argv[2], crypto.randomBytes(32), { mode: 0o600 });
fs.chmodSync(process.argv[2], 0o600);
NODE

run_spike approve \
  --workspace "$WORK" \
  --task medium-resume \
  --operator-key-file "$OPERATOR_KEY" \
  --out "$WORK/approval.json"
assert_exit_code "$__SPIKE_EXIT" "1" "approval output cannot be placed inside the evidence workspace"
assert_contains "$__SPIKE_ERR" 'approval_output_must_be_outside_workspace' "approval output path is externally anchored"

ln -s "$WORK" "$TEST_TMP/work-link"
run_spike approve \
  --workspace "$WORK" \
  --task medium-resume \
  --operator-key-file "$OPERATOR_KEY" \
  --out "$TEST_TMP/work-link/approval.json"
assert_exit_code "$__SPIKE_EXIT" "1" "approval output cannot enter the workspace through an intermediate symlink"
assert_contains "$__SPIKE_ERR" 'approval_output_contains_symlink_component' "approval output rejects intermediate symlinks"

chmod 0644 "$OPERATOR_KEY"
run_spike approve \
  --workspace "$WORK" \
  --task medium-resume \
  --operator-key-file "$OPERATOR_KEY" \
  --out "$TEST_TMP/approval.bad-perms.json"
assert_exit_code "$__SPIKE_EXIT" "1" "operator key with group or other access is rejected"
assert_contains "$__SPIKE_ERR" 'operator_key_permissions_too_open' "operator key must remain owner-only"
chmod 0600 "$OPERATOR_KEY"

run_spike approve \
  --workspace "$WORK" \
  --task medium-resume \
  --operator-key-file "$OPERATOR_KEY" \
  --out "$APPROVAL"
assert_exit_code "$__SPIKE_EXIT" "0" "operator creates a ledger-bound external approval"
assert_file_exists "$APPROVAL" "approval is external to the evidence workspace"

chmod 0644 "$APPROVAL"
run_spike resume \
  --workspace "$WORK" \
  --task medium-resume \
  --approval-file "$APPROVAL" \
  --operator-key-file "$OPERATOR_KEY"
assert_exit_code "$__SPIKE_EXIT" "1" "group- or world-readable approval record is rejected"
assert_contains "$__SPIKE_ERR" 'approval_file_permissions_too_open' "approval record must remain owner-only"
chmod 0600 "$APPROVAL"

node - "$APPROVAL" "$BAD_APPROVAL" <<'NODE'
const fs = require('fs');
const approval = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
approval.signature = '0'.repeat(64);
fs.writeFileSync(process.argv[3], JSON.stringify(approval) + '\n', { mode: 0o600 });
NODE
run_spike resume \
  --workspace "$WORK" \
  --task medium-resume \
  --approval-file "$BAD_APPROVAL" \
  --operator-key-file "$OPERATOR_KEY"
assert_exit_code "$__SPIKE_EXIT" "1" "forged approval cannot resume a protected effect"
assert_contains "$__SPIKE_ERR" 'approval_signature_invalid' "approval signature is fail closed"

run_spike resume \
  --workspace "$WORK" \
  --task medium-resume \
  --approval-file "$APPROVAL" \
  --operator-key-file "$OPERATOR_KEY"
assert_exit_code "$__SPIKE_EXIT" "0" "new process resumes from durable evidence plus verified operator approval"
assert_contains "$__SPIKE_OUT" '"reconstructed_from_ledger_only": true' "resume provenance is recorded"
assert_contains "$__SPIKE_OUT" '"external_operator_approval_verified": true' "operator approval is recorded"
run_spike verify --workspace "$WORK"
assert_exit_code "$__SPIKE_EXIT" "0" "all three protected effects verify after resume"
assert_contains "$__SPIKE_OUT" '"effect_completed": true' "verification sees mediated effects"

node - "$TEST_TMP/reviews" <<'NODE'
const fs = require('fs');
const root = process.argv[2];
fs.mkdirSync(root, { recursive: true });
for (const id of ['low-status', 'medium-boundary', 'medium-resume']) {
  const identities = {
    'low-status': { runner: 'grok', model: 'grok-4.5' },
    'medium-boundary': { runner: 'grok', model: 'grok-4.5' },
    'medium-resume': { runner: 'qoderclicn', model: 'Qwen3.8-Max-Preview' },
  };
  fs.writeFileSync(`${root}/${id}.json`, JSON.stringify({
    ...identities[id],
    status: 'reviewed',
    verdict: 'SHIP-AS-IS',
    findings: 'fixture review passed',
  }) + '\n');
}
fs.writeFileSync(`${root}/bad.json`, JSON.stringify({
  runner: 'cc-shim',
  model: 'MiniMax-M3',
  status: 'reviewed',
  verdict: 'FIX-THEN-SHIP',
  findings: 'fixture review rejected',
}) + '\n');
NODE

run_spike record-review \
  --workspace "$WORK" \
  --task low-status \
  --review-file "$TEST_TMP/reviews/low-status.json"
assert_exit_code "$__SPIKE_EXIT" "1" "same-family reviewer is rejected"
assert_contains "$__SPIKE_ERR" 'reviewer_not_independent_family' "family independence is enforced"

run_spike record-review \
  --workspace "$WORK" \
  --task low-status \
  --review-file "$TEST_TMP/reviews/bad.json"
assert_exit_code "$__SPIKE_EXIT" "1" "negative reviewer verdict cannot accept a task"
assert_contains "$__SPIKE_ERR" 'independent_review_not_accepted' "review verdict is fail closed"

node - "$TEST_TMP/reviews/low-status.json" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const review = JSON.parse(fs.readFileSync(file, 'utf8'));
review.runner = 'cc-shim';
review.model = 'MiniMax-M3';
fs.writeFileSync(file, JSON.stringify(review) + '\n');
NODE

run_spike record-review \
  --workspace "$WORK" \
  --task low-status \
  --review-file "$TEST_TMP/reviews/low-status.json"
assert_exit_code "$__SPIKE_EXIT" "0" "independent review accepts low-risk artifact"
assert_contains "$(cat "$WORK/review-inputs/low-status.diff")" '"descriptor_content_sha256"' "review packet exposes the descriptor content hash bound to the artifact"
run_spike record-review \
  --workspace "$WORK" \
  --task medium-boundary \
  --review-file "$TEST_TMP/reviews/medium-boundary.json"
assert_exit_code "$__SPIKE_EXIT" "0" "independent review accepts medium boundary artifact"
run_spike record-review \
  --workspace "$WORK" \
  --task medium-resume \
  --review-file "$TEST_TMP/reviews/medium-resume.json"
assert_exit_code "$__SPIKE_EXIT" "0" "independent review accepts resumed artifact"

run_spike adjudicate --workspace "$WORK"
assert_exit_code "$__SPIKE_EXIT" "0" "adjudication accepts only verified and independently reviewed tasks"
assert_contains "$__SPIKE_OUT" '"review_dispatch_reduction": 0.5' "three challenges reduce the six-dispatch baseline by 50 percent"
assert_contains "$__SPIKE_OUT" '"transcript_free_resume": true' "adjudication retains cross-session evidence"
assert_file_exists "$WORK/summaries/acceptance.json" "durable acceptance summary exists"

cp -a "$WORK" "$TEST_TMP/profile-tamper"
node - "$TEST_TMP/profile-tamper/tasks/low-status/receipts/receipts.jsonl" <<'NODE'
require('fs').appendFileSync(process.argv[2], JSON.stringify({ forged: true }) + '\n');
NODE
run_spike verify --workspace "$TEST_TMP/profile-tamper"
assert_exit_code "$__SPIKE_EXIT" "1" "profile receipt-root tampering is detected"
assert_contains "$__SPIKE_ERR" 'profile_receipt_length_invalid' "receipt root cannot be silently rewritten"

cp -a "$WORK" "$TEST_TMP/ledger-tamper"
node - "$TEST_TMP/ledger-tamper/ledger/events.jsonl" <<'NODE'
require('fs').appendFileSync(process.argv[2], JSON.stringify({ forged: true }) + '\n');
NODE
run_spike verify --workspace "$TEST_TMP/ledger-tamper"
assert_exit_code "$__SPIKE_EXIT" "1" "minimum ledger tampering is detected"
assert_contains "$__SPIKE_ERR" 'ledger_receipt_length_mismatch' "ledger receipt mismatch fails closed"

finalize_test
