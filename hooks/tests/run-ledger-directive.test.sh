#!/usr/bin/env bash
# run-ledger.sh directive channel (Phase 2 nudge/directive) contract test.
# Independent, adversarial harness — authored by the depth-0 orchestrator, never
# trusting the implementer's own green (delegate-selftest-false-green guard).
. "$(dirname "$0")/lib.sh"

RL="$REPO_ROOT/scripts/run-ledger.sh"
L="$TEST_TMP/ledger.jsonl"
RID="R1"

jqr() { printf '%s' "$1" | jq -r "$2" 2>/dev/null; }

bash "$RL" init --ledger "$L" >/dev/null
ACQ="$(bash "$RL" stage-acquire --ledger "$L" --run-id "$RID" --stage implement --pid $$)"
GEN="$(jqr "$ACQ" .generation)"
NON="$(jqr "$ACQ" .nonce)"

# --- 1. send refuses when the target stage has no live lease ----------------------
OUT="$(bash "$RL" directive-send --ledger "$L" --run-id "$RID" --stage review --text hi 2>&1)"; RC=$?
assert_neq "$RC" "0" "send refuses (nonzero) when no leased stage exists"
assert_contains "$OUT" "no live lease" "send refusal names the missing lease"

# --- 2. send on a leased stage binds the current lease generation+nonce -----------
DTEXT=$'careful: quotes " and\nnewline'   # control chars must survive JSONL escaping
D="$(bash "$RL" directive-send --ledger "$L" --run-id "$RID" --stage implement --text "$DTEXT" --from depth-0)"
DID="$(jqr "$D" .directive_id)"
assert_eq "$(jqr "$D" .kind)" "directive" "send emits a directive row"
assert_eq "$(jqr "$D" .generation)" "$GEN" "directive binds the lease generation"
assert_eq "$(jqr "$D" .nonce)" "$NON" "directive binds the lease nonce"
assert_eq "$(jqr "$D" .from)" "depth-0" "directive carries --from"
assert_neq "$DID" "" "directive gets an id"

# JSONL integrity: control chars escaped, ledger still parses as a whole.
assert_eq "$(jq -s 'length' "$L" 2>/dev/null || printf ERR)" "2" "ledger stays valid JSONL after control-char text"
assert_eq "$(bash "$RL" directive-poll --ledger "$L" --run-id "$RID" --stage implement | jq -r '.[0].text')" "$DTEXT" "text round-trips through the ledger verbatim"

# --- 3. poll returns only pending (un-acked) directives ---------------------------
POLL="$(bash "$RL" directive-poll --ledger "$L" --run-id "$RID" --stage implement)"
assert_eq "$(jqr "$POLL" 'length')" "1" "poll returns the one pending directive"
assert_eq "$(jqr "$POLL" '.[0].directive_id')" "$DID" "poll returns the right directive id"
# stage filter: a different stage sees nothing
assert_eq "$(bash "$RL" directive-poll --ledger "$L" --run-id "$RID" --stage other | jq -r 'length')" "0" "poll stage filter excludes other stages"

# --- 4. ack on a live matching lease → delivered; poll then empty; idempotent ------
ACK="$(bash "$RL" directive-ack --ledger "$L" --run-id "$RID" --directive-id "$DID" --by supervisor)"
assert_eq "$(jqr "$ACK" .status)" "delivered" "ack on live matching lease → delivered"
assert_eq "$(bash "$RL" directive-poll --ledger "$L" --run-id "$RID" --stage implement | jq -r 'length')" "0" "delivered directive no longer pending"
# exactly one terminal row for this directive
TERMS="$(jq -s --arg d "$DID" '[.[]|select((.kind=="directive_delivered" or .kind=="directive_expired") and .directive_id==$d)]|length' "$L")"
assert_eq "$TERMS" "1" "exactly one terminal ack row after delivery"
ACK2="$(bash "$RL" directive-ack --ledger "$L" --run-id "$RID" --directive-id "$DID")"
assert_eq "$(jqr "$ACK2" .status)" "already_acked" "second ack is idempotent (already_acked)"
TERMS2="$(jq -s --arg d "$DID" '[.[]|select((.kind=="directive_delivered" or .kind=="directive_expired") and .directive_id==$d)]|length' "$L")"
assert_eq "$TERMS2" "1" "no second terminal row written on re-ack"

# --- 5. stale_generation: directive bound to gen N, lease bumped to N+1 ------------
D2="$(bash "$RL" directive-send --ledger "$L" --run-id "$RID" --stage implement --text nudge2)"
DID2="$(jqr "$D2" .directive_id)"
bash "$RL" stage-acquire --ledger "$L" --run-id "$RID" --stage implement --pid $$ >/dev/null   # bump generation
ACK_STALE="$(bash "$RL" directive-ack --ledger "$L" --run-id "$RID" --directive-id "$DID2")"
assert_eq "$(jqr "$ACK_STALE" .status)" "expired" "generation-advanced directive → expired"
assert_eq "$(jqr "$ACK_STALE" .reason)" "stale_generation" "stale expiry reason is stale_generation"

# --- 6. run_ended expiry (shutdown path) ------------------------------------------
D3="$(bash "$RL" directive-send --ledger "$L" --run-id "$RID" --stage implement --text nudge3)"
DID3="$(jqr "$D3" .directive_id)"
ACK_RE="$(bash "$RL" directive-ack --ledger "$L" --run-id "$RID" --directive-id "$DID3" --reason run_ended --by supervisor)"
assert_eq "$(jqr "$ACK_RE" .status)" "expired" "run_ended ack → expired"
assert_eq "$(jqr "$ACK_RE" .reason)" "run_ended" "run_ended reason recorded"

# --- 7. malformed / fail-closed inputs --------------------------------------------
bash "$RL" directive-send --ledger "$L" --run-id "$RID" --stage implement >/dev/null 2>&1
assert_neq "$?" "0" "send without --text is rejected"
bash "$RL" directive-ack --ledger "$L" --run-id "$RID" --directive-id "$DID3" --reason bogus >/dev/null 2>&1
assert_neq "$?" "0" "ack with an out-of-enum --reason is rejected"
bash "$RL" directive-ack --ledger "$L" --run-id "$RID" --directive-id does-not-exist >/dev/null 2>&1
assert_neq "$?" "0" "ack on an unknown directive-id is rejected"

# --- 8. directive-list is an alias for directive-poll -----------------------------
D4="$(bash "$RL" directive-send --ledger "$L" --run-id "$RID" --stage implement --text nudge4)"
assert_eq "$(bash "$RL" directive-list --ledger "$L" --run-id "$RID" --stage implement | jq -r 'length')" "1" "directive-list alias returns pending like directive-poll"

# --- 9. byte-compat: existing subcommands still produce their expected shape -------
# (the directive change is purely additive — existing paths must be untouched.)
Q="$(bash "$RL" query-latest --ledger "$L" --run-id "$RID" --stage implement)"
assert_eq "$(jqr "$Q" .kind)" "stage" "query-latest still returns the stage row unchanged"
assert_eq "$(jqr "$(bash "$RL" init --ledger "$L")" .status)" "exists" "init on an existing ledger still reports exists"

# --- 10. poll on an absent ledger is a clean empty array --------------------------
assert_eq "$(bash "$RL" directive-poll --ledger "$TEST_TMP/nope.jsonl" --run-id X | jq -r 'length')" "0" "poll on absent ledger → []"

# --- 11. nonce fencing (QC fix): same generation, DIFFERENT nonce ⇒ expired --------
# A fenced/replaced writer can present the same generation under a new nonce; the
# delivered branch must compare BOTH. Simulated by appending a forged leased row
# (same gen, different nonce) — the exact shape a fencing race would leave.
LN="$TEST_TMP/nonce.jsonl"
bash "$RL" init --ledger "$LN" >/dev/null
NACQ="$(bash "$RL" stage-acquire --ledger "$LN" --run-id RN --stage implement --pid $$)"
NGEN="$(jqr "$NACQ" .generation)"
ND="$(bash "$RL" directive-send --ledger "$LN" --run-id RN --stage implement --text fenced)"
NDID="$(jqr "$ND" .directive_id)"
printf '%s\n' "$(jq -nc --argjson gen "$NGEN" '{kind:"stage",ts:"2026-07-15T00:00:00Z",run_id:"RN",stage:"implement",state:"leased",generation:$gen,nonce:"deadbeefdeadbeef",pid:1,start_time:1,heartbeat_ts:1,git_ref:"",git_sha:"",worktree:"",resources:"",reason:"acquire"}')" >> "$LN"
NACK="$(bash "$RL" directive-ack --ledger "$LN" --run-id RN --directive-id "$NDID")"
assert_eq "$(jqr "$NACK" .status)" "expired" "same-generation different-nonce lease → expired"
assert_eq "$(jqr "$NACK" .reason)" "stale_generation" "nonce mismatch records stale_generation"

# --- 12. rotation survival (QC fix): a rotated-out directive stays visible ---------
# RUN_LEDGER_MAX_BYTES rotation must not silently drop a pending directive: poll/ack
# scan the rotated ${ledger}.N segments too, so the directive still terminalizes.
LR="$TEST_TMP/rot.jsonl"
(
  export RUN_LEDGER_MAX_BYTES=600
  bash "$RL" init --ledger "$LR" >/dev/null
  bash "$RL" stage-acquire --ledger "$LR" --run-id RR --stage implement --pid $$ >/dev/null
  bash "$RL" directive-send --ledger "$LR" --run-id RR --stage implement --text survive-rotation > "$TEST_TMP/rot-directive.json"
  for s in a b c d e; do bash "$RL" stage-acquire --ledger "$LR" --run-id RR --stage "st$s" --pid $$ >/dev/null; done
)
RDID="$(jq -r .directive_id "$TEST_TMP/rot-directive.json")"
assert_file_exists "$LR.1" "rotation actually happened (segment file exists)"
assert_eq "$(grep -c '"kind":"directive"' "$LR" 2>/dev/null || true)" "0" "directive row rotated out of the live ledger (the hazard is real)"
RPOLL="$(bash "$RL" directive-poll --ledger "$LR" --run-id RR --stage implement)"
assert_eq "$(jqr "$RPOLL" 'length')" "1" "poll still sees the rotated-out directive"
assert_eq "$(jqr "$RPOLL" '.[0].directive_id')" "$RDID" "rotated directive id intact"
RACK="$(bash "$RL" directive-ack --ledger "$LR" --run-id RR --directive-id "$RDID" --reason run_ended)"
assert_eq "$(jqr "$RACK" .status)" "expired" "rotated directive still terminalizes"
assert_eq "$(bash "$RL" directive-poll --ledger "$LR" --run-id RR --stage implement | jq -r 'length')" "0" "terminal ack row in the live ledger hides the rotated directive"

finalize_test
