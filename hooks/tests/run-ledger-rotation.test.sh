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

# Deterministic rename barrier: while the writer holds the exclusive ledger
# lock with the live file temporarily renamed, a reader must wait rather than
# assemble a mixed segment list.
LOCK_FILE="${LR}.locks/ledger.lock"
RENAMED="$TEST_TMP/rename-held"
WRITER_READY="$TEST_TMP/writer-ready"
WRITER_RELEASE="$TEST_TMP/writer-release"
READER_DONE="$TEST_TMP/reader-done"
NODE_READER_DONE="$TEST_TMP/node-reader-done"
(
  exec 9>"$LOCK_FILE"
  flock -x 9
  mv "$LR" "$RENAMED"
  touch "$WRITER_READY"
  while [ ! -f "$WRITER_RELEASE" ]; do sleep 0.01; done
  mv "$RENAMED" "$LR"
  flock -u 9
) &
WRITER_PID=$!
while [ ! -f "$WRITER_READY" ]; do sleep 0.01; done
(
  bash "$RL" query-latest --ledger "$LR" --run-id camp-rot --stage campaign \
    > "$TEST_TMP/barrier-reader.json"
  touch "$READER_DONE"
) &
READER_PID=$!
(
  node - "$REPO_ROOT" "$LR" <<'NODE' > "$TEST_TMP/node-barrier-reader.json"
const path = require('path');
const [root, ledger] = process.argv.slice(2);
const { loadRows } = require(path.join(root, 'src', 'campaign', 'cli'));
const rows = loadRows(ledger);
process.stdout.write(JSON.stringify(rows.findLast(
  (row) => row.kind === 'stage' && row.run_id === 'camp-rot' && row.stage === 'campaign',
)));
NODE
  touch "$NODE_READER_DONE"
) &
NODE_READER_PID=$!
sleep 0.05
assert_file_absent "$READER_DONE" "reader waits across rename barrier"
assert_file_absent "$NODE_READER_DONE" "Node campaign reader waits across rename barrier"
touch "$WRITER_RELEASE"
wait "$WRITER_PID"
wait "$READER_PID"
wait "$NODE_READER_PID"
assert_eq "$(jq -r .state "$TEST_TMP/barrier-reader.json")" "committed" "reader sees coherent post-rename state"
assert_eq "$(jq -r .state "$TEST_TMP/node-barrier-reader.json")" "committed" "Node campaign reader sees coherent post-rename state"

# Directive readers use the same coherent snapshot lock.
DL="$TEST_TMP/directive-barrier.jsonl"
bash "$RL" init --ledger "$DL" >/dev/null
D_ACQ="$(bash "$RL" stage-acquire --ledger "$DL" --run-id directive-run --stage implement --pid $$)"
bash "$RL" directive-send --ledger "$DL" --run-id directive-run --stage implement \
  --text "coherent" --directive-id directive-1 >/dev/null
D_LOCK="${DL}.locks/ledger.lock"
D_RENAMED="$TEST_TMP/directive-rename-held"
D_READY="$TEST_TMP/directive-writer-ready"
D_RELEASE="$TEST_TMP/directive-writer-release"
D_DONE="$TEST_TMP/directive-reader-done"
(
  exec 8>"$D_LOCK"
  flock -x 8
  mv "$DL" "$D_RENAMED"
  touch "$D_READY"
  while [ ! -f "$D_RELEASE" ]; do sleep 0.01; done
  mv "$D_RENAMED" "$DL"
  flock -u 8
) &
D_WRITER_PID=$!
while [ ! -f "$D_READY" ]; do sleep 0.01; done
(
  bash "$RL" directive-poll --ledger "$DL" --run-id directive-run --stage implement \
    > "$TEST_TMP/directive-reader.json"
  touch "$D_DONE"
) &
D_READER_PID=$!
sleep 0.05
assert_file_absent "$D_DONE" "directive reader waits across rename barrier"
touch "$D_RELEASE"
wait "$D_WRITER_PID"
wait "$D_READER_PID"
assert_eq "$(jq 'length' "$TEST_TMP/directive-reader.json")" "1" "directive reader sees coherent post-rename snapshot"

finalize_test
