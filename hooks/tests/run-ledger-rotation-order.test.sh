#!/usr/bin/env bash
# Ledger rotation carry must keep journal append order (writer keep-first).
#
# T1 (RED at base 9fa7ac1a): ".1 journals in append order" /
#   "live journals in append order" — expected
#   ["intake:<id>","campaign-event:zz-1","campaign-event:mm-2","campaign-event:aa-3"]
#   got group_by order
#   ["campaign-event:zz-1","campaign-event:aa-3","campaign-event:mm-2","intake:<id>"]
# T2 (RED at base 9fa7ac1a): "projectCampaign does not throw:
#   event input artifact must match the prior output artifact"
# T3 (preservation, green at base): latest leased stage once in live;
#   query-latest generation/nonce unchanged.
. "$(dirname "$0")/lib.sh"

RL="$REPO_ROOT/scripts/run-ledger.sh"
LR="$TEST_TMP/rotation-order.jsonl"
META="$TEST_TMP/fixture-meta.json"
SCRATCH="$TEST_TMP/scratch-git"

REAL_DATE="$(command -v date)"
mkdir -p "$TEST_TMP/bin"
cat > "$TEST_TMP/bin/date" <<EOF
#!/bin/sh
if [ "\$#" -eq 2 ] && [ "\$1" = "-u" ] && [ "\$2" = "+%Y-%m-%dT%H:%M:%SZ" ]; then
  printf '%s\n' "2026-09-16T12:00:00Z"
  exit 0
fi
exec "$REAL_DATE" "\$@"
EOF
chmod +x "$TEST_TMP/bin/date"
export PATH="$TEST_TMP/bin:$PATH"

git init -q "$SCRATCH"
git -C "$SCRATCH" config user.email "rot-order@example.test"
git -C "$SCRATCH" config user.name "rot-order"
printf 'fixture\n' > "$SCRATCH/README"
git -C "$SCRATCH" add README
git -C "$SCRATCH" commit -q -m "candidate"

# Rotation OFF while building (RUN_LEDGER_MAX_BYTES=0).
RUN_LEDGER_MAX_BYTES=0 RUN_LEDGER_MAX_ROTATIONS=8 \
node - "$REPO_ROOT" "$TEST_TMP" "$LR" "$SCRATCH" "$META" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp, ledger, repo, metaPath] = process.argv.slice(2);
const {
  campaignLedgerContract,
  openCampaignLedger,
} = require(path.join(root, 'hooks', 'tests', 'lib', 'implementation-campaign-ledger-fixture'));
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const intake = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const verification = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const lineage = require(path.join(root, 'src', 'engine', 'repair-lineage-cleanup'));
function repairLineageFor({ icc, campaignId, branch, worktree, worktreeInstanceId, candidate }) {
  return {
    lineage_id: campaignId,
    branch,
    worktree,
    provider_session_id: null,
    provider_session_reused: false,
    provider_session_non_reuse_reason: 'fixture_never_dispatched_a_provider',
    worktree_reused: false,
    worktree_instance_id: worktreeInstanceId,
    cleanup_epoch: 1,
    cleanup_receipt_id: null,
    generation: 0,
    inherited_churn: 0,
    delta_churn: 2,
    retention_owner: campaignId,
    retention_reason: 'implementation-campaign-repair-lineage',
    retention_expires_at: 2000000000,
    terminal_worktree_disposition: 'active',
    transcript_reused: false,
    transcript_source_digest: icc.canonicalDigest({ fixture: 'transcript-source' }),
    review_input_mode: 'full_diff_generation',
    new_input_bytes: 17,
    new_input_tokens: 23,
    input_token_measurement: 'provider_reported',
    finding_occurrences: [],
    accepted_invariant_ids: [`acceptance:${icc.canonicalDigest({ fixture: 'acceptance' })}`],
    accepted_invariants: ['the campaign ledger projects to a terminal-ready phase'],
    accepted_invariants_source_commit: candidate,
    accepted_invariants_digest: icc.canonicalDigest({
      schema: 1,
      assertions: ['the campaign ledger projects to a terminal-ready phase'],
      source_commit: candidate,
    }),
    prior_review_finding_ids: [],
    previous_repair_finding_count: null,
    non_reduction_rounds: 0,
    repair_scope_paths: ['src/value.txt'],
    repair_scope_seal: null,
  };
}

const env = { RUN_LEDGER_MAX_BYTES: '0', RUN_LEDGER_MAX_ROTATIONS: '8' };
const base = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = 'campaign/rot-order';
const tree = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const contract = campaignLedgerContract({
  repoIdentity: `git-common-dir:${tmp}/git-common`,
  ticket: 'rot-order-t1',
  baseSha: base,
  branch,
});
const opened = openCampaignLedger({
  root, repo, ledger, contract,
  startedAt: '2026-09-16T12:00:00.000Z',
  env,
});
const campaignId = opened.campaignId;
const writerFence = verification.createWriterFence({
  campaignId,
  stageIdentity: 'campaign-implementation',
  candidateCommit: base,
  candidateTreeSha: tree,
  implementationResult: {
    status: 'committed',
    implementation: { commit: base },
    implementationResult: { error: null, signal: null, status: 0 },
  },
});
const repairLineage = repairLineageFor({
  icc,
  campaignId,
  branch,
  worktree: repo,
  worktreeInstanceId: lineage.worktreeInstanceId(repo),
  candidate: base,
});

let control = opened.control;
const observedAt = '2026-09-16T12:00:00.000Z';
const append = (input) => {
  const appended = intake.appendCampaignEvent({ repo, campaignControl: control, ...input });
  control = { ...control, initial_state: appended.state };
  return appended;
};

append({
  observedAt,
  idempotencyKey: 'campaign-event:zz-1',
  eventType: icc.CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: { sealed_contract: true },
});
append({
  observedAt,
  idempotencyKey: 'campaign-event:mm-2',
  eventType: icc.CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  usage: { changed_files: 1, churn: 2 },
  payload: {
    scope_check_passed: true,
    scope_check_digest: icc.canonicalDigest({ fixture: 'scope-check' }),
  },
  artifactReference: {
    kind: 'git_candidate',
    commit: base,
    tree_sha: tree,
    branch,
    base,
    writer_fence: writerFence,
    repair_lineage: repairLineage,
  },
});
const evidenceDigest = icc.canonicalDigest({ fixture: 'vertical-evidence' });
const third = append({
  observedAt,
  idempotencyKey: 'campaign-event:aa-3',
  eventType: icc.CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
  generation: 0,
  stageIdentity: 'campaign-verification:0',
  payload: { passed: true, evidence_digest: evidenceDigest },
  artifactReference: { kind: 'verification_receipt', digest: evidenceDigest },
});

fs.writeFileSync(metaPath, JSON.stringify({
  campaignId,
  generation: opened.generation,
  nonce: opened.nonce,
  last_output_artifact_digest: third.state.last_output_artifact_digest,
  expected_phase: third.state.phase,
  event_count: third.state.event_count,
  expected_keys: [
    `intake:${campaignId}`,
    'campaign-event:zz-1',
    'campaign-event:mm-2',
    'campaign-event:aa-3',
  ],
}));
NODE

assert_file_exists "$META" "fixture meta written"
CAMPAIGN_ID="$(jq -r .campaignId "$META")"
GEN="$(jq -r .generation "$META")"
NONCE="$(jq -r .nonce "$META")"
EXPECTED_DIGEST="$(jq -r .last_output_artifact_digest "$META")"
EXPECTED_PHASE="$(jq -r .expected_phase "$META")"
EXPECTED_COUNT="$(jq -r .event_count "$META")"
EXPECTED_KEYS="$(jq -c .expected_keys "$META")"

# Precondition: three event rows share one journal ts; lex-sorted rotation
# roots differ from append order (else fixture not discriminating).
PRE="$(jq -s -c --arg cid "$CAMPAIGN_ID" '
  [ .[] | select(.kind=="journal" and .op=="campaign_event" and .run_id==$cid) ]
  | {
      ts_unique: ([.[].ts] | unique),
      append_roots: [
        .[] | (. | del(._rotation_carry, ._rotation_root) | tojson | @base64)
      ]
    }
    | . + {sorted_roots: (.append_roots | sort)}
' "$LR")"
assert_eq "$(jq -r '.ts_unique | length' <<<"$PRE")" "1" "three journal ts values are identical"
assert_eq "$(jq -r '.ts_unique[0]' <<<"$PRE")" "2026-09-16T12:00:00Z" "pinned iso_ts via date shim"
SORTED="$(jq -c .sorted_roots <<<"$PRE")"
APPEND="$(jq -c .append_roots <<<"$PRE")"
if [ "$SORTED" = "$APPEND" ]; then
  fail "fixture not discriminating"
fi

PRE_LATEST="$(bash "$RL" query-latest --ledger "$LR" --run-id "$CAMPAIGN_ID" --stage campaign)"
assert_eq "$(jq -r .generation <<<"$PRE_LATEST")" "$GEN" "pre-rotation generation"
assert_eq "$(jq -r .nonce <<<"$PRE_LATEST")" "$NONCE" "pre-rotation nonce"

journal_keys() {
  local file="$1"
  jq -s -c --arg cid "$CAMPAIGN_ID" '
    [ .[] | select(.kind=="journal" and .run_id==$cid) | .idempotency_key ]
  ' "$file"
}

assert_all_carry() {
  local file="$1" label="$2"
  local leftover
  leftover="$(jq -s -c --arg cid "$CAMPAIGN_ID" '
    [ .[]
      | select(.kind=="journal" and .run_id==$cid)
      | select(._rotation_carry != true)
    ]
  ' "$file")"
  assert_eq "$leftover" "[]" "$label: every intake/event copy is _rotation_carry:true"
}

assert_unique_roots() {
  local file="$1" label="$2"
  local ok
  ok="$(jq -s -r --arg cid "$CAMPAIGN_ID" '
    [ .[] | select(.kind=="journal" and .run_id==$cid) | ._rotation_root ]
    | (length == (unique | length))
  ' "$file")"
  assert_eq "$ok" "true" "$label: each _rotation_root exactly once"
}

# T1: two real heartbeats with bytes=1 rotations=1 → two rotations, GC originals.
export RUN_LEDGER_MAX_BYTES=1
export RUN_LEDGER_MAX_ROTATIONS=1
HB1="$(bash "$RL" stage-heartbeat --ledger "$LR" --run-id "$CAMPAIGN_ID" --stage campaign \
  --generation "$GEN" --nonce "$NONCE" --pid $$)"
assert_eq "$(jq -r .kind <<<"$HB1")" "heartbeat" "first heartbeat after bytes=1"
HB2="$(bash "$RL" stage-heartbeat --ledger "$LR" --run-id "$CAMPAIGN_ID" --stage campaign \
  --generation "$GEN" --nonce "$NONCE" --pid $$)"
assert_eq "$(jq -r .kind <<<"$HB2")" "heartbeat" "second heartbeat forces second rotation"
assert_file_exists "$LR.1" "rotation produced .1"

for seg in "$LR.1" "$LR"; do
  [ -f "$seg" ] || fail "missing segment $seg"
  assert_all_carry "$seg" "$(basename "$seg")"
  assert_unique_roots "$seg" "$(basename "$seg")"
done
assert_eq "$(journal_keys "$LR.1")" "$EXPECTED_KEYS" ".1 journals in append order"
assert_eq "$(journal_keys "$LR")" "$EXPECTED_KEYS" "live journals in append order"

SNAP_KEYS="$(bash "$RL" snapshot --ledger "$LR" | jq -s -c --arg cid "$CAMPAIGN_ID" '
  [ .[] | select(.kind=="journal" and .run_id==$cid) ]
  | reduce .[] as $j ({seen:{}, out:[]};
      ($j._rotation_root // ($j | del(._rotation_carry, ._rotation_root) | tojson | @base64)) as $r
      | if .seen[$r] then . else .seen[$r] = true | .out += [$j.idempotency_key] end)
  | .out
')"
assert_eq "$SNAP_KEYS" "$EXPECTED_KEYS" "snapshot first-occurrence dedupe yields append order"

# T2: projectCampaign on carry-only snapshot.
PROJ="$(node - "$REPO_ROOT" "$LR" "$CAMPAIGN_ID" "$EXPECTED_DIGEST" "$EXPECTED_PHASE" "$EXPECTED_COUNT" <<'NODE'
'use strict';
const path = require('path');
const [root, ledger, campaignId, digest, phase, count] = process.argv.slice(2);
const { loadRows, projectCampaign } = require(path.join(root, 'src', 'campaign', 'cli'));
try {
  const stateWrap = projectCampaign(loadRows(ledger), campaignId);
  const state = stateWrap && stateWrap.state;
  process.stdout.write(JSON.stringify({
    ok: true,
    phase: state && state.phase,
    event_count: state && state.event_count,
    last_output_artifact_digest: state && state.last_output_artifact_digest,
    expected_phase: phase,
    expected_count: Number(count),
    expected_digest: digest,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: String(error.message || error) }));
  process.exit(0);
}
NODE
)"
if [ "$(jq -r .ok <<<"$PROJ")" != "true" ]; then
  fail "projectCampaign does not throw: $(jq -r .message <<<"$PROJ")"
fi
assert_eq "$(jq -r .ok <<<"$PROJ")" "true" "projectCampaign does not throw"
assert_eq "$(jq -r .phase <<<"$PROJ")" "$EXPECTED_PHASE" "state.phase after VERTICAL_VERIFIED"
assert_eq "$(jq -r .event_count <<<"$PROJ")" "$EXPECTED_COUNT" "state.event_count === 3"
assert_eq "$(jq -r .last_output_artifact_digest <<<"$PROJ")" "$EXPECTED_DIGEST" \
  "last_output_artifact_digest matches third appendCampaignEvent"

# T3 preservation: latest leased stage once in live; query-latest unchanged.
LEASED_LIVE="$(jq -s --arg cid "$CAMPAIGN_ID" '
  [.[] | select(.kind=="stage" and .run_id==$cid and .stage=="campaign" and .state=="leased")] | length
' "$LR")"
assert_eq "$LEASED_LIVE" "1" "latest leased stage row present exactly once in live"
POST_LATEST="$(bash "$RL" query-latest --ledger "$LR" --run-id "$CAMPAIGN_ID" --stage campaign)"
assert_eq "$(jq -r .generation <<<"$POST_LATEST")" "$GEN" "query-latest generation preserved"
assert_eq "$(jq -r .nonce <<<"$POST_LATEST")" "$NONCE" "query-latest nonce preserved"

finalize_test
