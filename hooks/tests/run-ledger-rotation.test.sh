#!/usr/bin/env bash
# Force ledger rotation during an active lease and prove the rotation-aware
# oldest-to-live view keeps stage/lease/journal readable (heartbeat cannot
# observe a world without its lease).
. "$(dirname "$0")/lib.sh"

RL="$REPO_ROOT/scripts/run-ledger.sh"
LR="$TEST_TMP/rot-active.jsonl"

# Small max-bytes forces rotation; generous max rotations keeps the active lease
# inside the retained segment window (GC of active-referenced rows is separate).
export RUN_LEDGER_MAX_BYTES=600
export RUN_LEDGER_MAX_ROTATIONS=8

bash "$RL" init --ledger "$LR" >/dev/null

ACQUIRE="$(bash "$RL" stage-acquire --ledger "$LR" --run-id camp-rot --stage campaign \
  --pid $$ --resources "campaign:camp-rot")"
GEN="$(jq -r .generation <<<"$ACQUIRE")"
NONCE="$(jq -r .nonce <<<"$ACQUIRE")"
assert_eq "$(jq -r .state <<<"$ACQUIRE")" "leased" "acquire yields leased"

# Journal intake-style payload bound to the live lease (must survive rotation).
bash "$RL" journal-add --ledger "$LR" --run-id camp-rot --stage campaign \
  --generation "$GEN" --nonce "$NONCE" \
  --idempotency-key "intake-camp-rot" --op campaign_intake \
  --payload '{"schema_version":1,"artifact_type":"fixture_intake","campaign_id":"camp-rot"}' \
  >/dev/null

# Force at least one rotation with a few pad acquires (each row ~270 bytes).
for i in 1 2 3 4 5 6; do
  bash "$RL" stage-acquire --ledger "$LR" --run-id "pad-$i" --stage "st$i" --pid $$ >/dev/null
done

assert_file_exists "$LR.1" "rotation produced a .1 segment"

# Lease may have left the live file — that is the hazard under test.
LIVE_LEASE_COUNT="$(grep -c '"run_id":"camp-rot"' "$LR" 2>/dev/null || true)"
LIVE_LEASE_COUNT="${LIVE_LEASE_COUNT:-0}"
SEG_LEASE_COUNT=0
for seg in "$LR".[0-9]*; do
  [ -f "$seg" ] || continue
  c="$(grep -c '"run_id":"camp-rot"' "$seg" 2>/dev/null || true)"
  c="${c:-0}"
  SEG_LEASE_COUNT=$((SEG_LEASE_COUNT + c))
done
if [ "$LIVE_LEASE_COUNT" -eq 0 ]; then
  if [ "$SEG_LEASE_COUNT" -gt 0 ]; then
    assert_eq "1" "1" "camp-rot rows live in rotated segment(s)"
  else
    assert_eq "1" "0" "camp-rot rows live in rotated segment(s)"
  fi
fi

# query-latest must still see the campaign lease (rotation-aware view).
LATEST="$(bash "$RL" query-latest --ledger "$LR" --run-id camp-rot --stage campaign)"
assert_eq "$(jq -r .state <<<"$LATEST")" "leased" "query-latest finds leased stage after rotation"
assert_eq "$(jq -r .generation <<<"$LATEST")" "$GEN" "generation preserved across rotation"
assert_eq "$(jq -r .nonce <<<"$LATEST")" "$NONCE" "nonce preserved across rotation"

# Heartbeat must succeed: cannot fail with "no stage row" after rotation.
HB="$(bash "$RL" stage-heartbeat --ledger "$LR" --run-id camp-rot --stage campaign \
  --generation "$GEN" --nonce "$NONCE" --pid $$)"
assert_eq "$(jq -r .kind <<<"$HB")" "heartbeat" "heartbeat succeeds with lease in rotated segment"
assert_eq "$(jq -r .generation <<<"$HB")" "$GEN" "heartbeat generation matches lease"

# After heartbeat-only live content, lease is still not on live alone.
LIVE_STAGE_AFTER="$(jq -s '[.[] | select(.kind=="stage" and .run_id=="camp-rot")] | length' "$LR" 2>/dev/null || echo 0)"
if [ "${LIVE_STAGE_AFTER:-0}" -eq 0 ]; then
  # Live may only have the heartbeat row — multi-segment view still binds lease.
  LIVE_KINDS="$(jq -s -c '[.[].kind] | unique' "$LR")"
  assert_contains "$LIVE_KINDS" "heartbeat" "live segment can hold heartbeat without stage after rotation"
fi
CROSS="$(bash "$RL" query-latest --ledger "$LR" --run-id camp-rot --stage campaign)"
assert_eq "$(jq -r .state <<<"$CROSS")" "leased" "cross-segment view still leased after heartbeat"

# Journal idempotency key in rotated segment is still visible (last-write / applied).
AGAIN="$(bash "$RL" journal-add --ledger "$LR" --run-id camp-rot --stage campaign \
  --generation "$GEN" --nonce "$NONCE" \
  --idempotency-key "intake-camp-rot" --op campaign_intake \
  --payload '{"schema_version":1,"artifact_type":"fixture_intake","campaign_id":"camp-rot"}')"
assert_eq "$(jq -r .status <<<"$AGAIN")" "already_applied" "journal idempotency survives rotation"

# Transition still sees the stage history across segments.
TRANS="$(bash "$RL" stage-transition --ledger "$LR" --run-id camp-rot --stage campaign \
  --generation "$GEN" --nonce "$NONCE" --to-state committed)"
assert_eq "$(jq -r .state <<<"$TRANS")" "committed" "stage-transition finds lease after rotation"

# Absent run stays empty / not found.
MISSING="$(bash "$RL" query-latest --ledger "$LR" --run-id does-not-exist --stage campaign)"
assert_eq "$(jq -r 'keys|length' <<<"$MISSING")" "0" "absent run_id remains empty object"

finalize_test
