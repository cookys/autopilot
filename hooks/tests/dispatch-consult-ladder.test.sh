#!/usr/bin/env bash
# dispatch-consult-ladder.test.sh — G1 R5 guard fix + --ladder-receipt
# (plan docs/plans/2026-09-07-unknown-escalation-ladder.md P2).
# Hermetic like dispatch-consult-hermetic.test.sh: scratch topology via
# AUTOPILOT_TOPOLOGY_FILE, scratch config via REVIEW_LOOP_CONFIG_OVERRIDE, and the
# --dispatch-author-bin seam so no transport is ever spawned.
# Proves: (1) consult_dispatch: auto with a topology-resolved seat DISPATCHES
# (before the fix the shipped default refused with switch_off); (2) off still
# refuses; (3) --ladder-receipt appends exactly one ladder row via
# decision-ledger, heterogeneous true on a topology seat and false on
# native-fallback; (4) a refusal path writes no row.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-consult.sh"
unset REVIEW_LOOP_CONFIG_OVERRIDE
unset AUTOPILOT_QUALIFICATION_OVERRIDE
Q="$TEST_TMP/q.txt"; printf 'which cache layer owns invalidation here?\n' > "$Q"
ART="$TEST_TMP/a.diff"; printf 'diff --git a/x b/x\n+line\n' > "$ART"
L="$TEST_TMP/ledger.jsonl"

TOPO="$TEST_TMP/topology.json"
cat > "$TOPO" <<'JSON'
{ "schema_version": 1, "generated_at": "2026-09-07T00:00:00.000Z", "host": "test-host",
  "consult_ladder": [ { "rung": "minimax-m3/high@agy", "engine": "minimax-m3", "effort": "high", "runner": "agy", "family": "minimax", "endpoint": "", "role_source": "consult" } ] }
JSON
TOPO_EMPTY="$TEST_TMP/topology-empty.json"
printf '%s\n' '{ "schema_version": 1, "generated_at": "2026-09-07T00:00:00.000Z", "host": "test-host", "consult_ladder": [] }' > "$TOPO_EMPTY"
CFG="$TEST_TMP/auto.md"; printf -- '- consult_dispatch: auto\n' > "$CFG"

RESP="$TEST_TMP/resp.json"
cat > "$RESP" <<'EOR'
{ "answer": { "label": "insufficient_evidence", "artifact_ref": null }, "aside": [], "authority": { "refused": true, "reference": "qc@depth-0" } }
EOR
ARGV="$TEST_TMP/argv.txt"
STUB="$TEST_TMP/author.sh"
cat > "$STUB" <<EOS
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$ARGV"
printf '{ "runner": "agy", "model": "minimax-m3", "status": "authored", "raw_log": "$RESP", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOS
chmod +x "$STUB"

# ── 1. auto + topology seat ⇒ dispatched (guard fix), advised ──
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB" 2>"$TEST_TMP/1.err")"; RC=$?
assert_eq "0" "$RC" "consult_dispatch auto with a resolved topology seat exits 0 (G1 R5 guard fix)"
assert_contains "$OUT" '"status": "advised"' "auto path reaches the transport and is advised"
assert_contains "$OUT" '"engine": "minimax-m3"' "auto path dispatches the topology-resolved engine"
assert_file_exists "$ARGV" "transport seam was invoked under auto"
assert_file_absent "$L" "no ledger row without --ladder-receipt"
rm -f "$ARGV"

# ── 2. off still refuses, no row ──
CFG_OFF="$TEST_TMP/off.md"; printf -- '- consult_dispatch: off\n' > "$CFG_OFF"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_OFF" AUTOPILOT_TOPOLOGY_FILE="$TOPO" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB" --ladder-receipt "$L" --ladder-terms cache --ladder-unknown-type why 2>/dev/null)"; RC=$?
assert_eq "2" "$RC" "off exits 2"
assert_contains "$OUT" '"status": "switch_off"' "off status unchanged"
assert_file_absent "$ARGV" "off never spawns the transport"
assert_file_absent "$L" "refusal path writes no ladder row"

# ── 3. --ladder-receipt on a topology seat ⇒ one row, heterogeneous true ──
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB" --ladder-receipt "$L" --ladder-terms cache,invalidation --ladder-unknown-type why --ladder-signals S1 --ladder-work-unit p1 2>"$TEST_TMP/3.err")"; RC=$?
assert_eq "0" "$RC" "receipt path exits 0"
assert_contains "$OUT" '"status": "advised"' "receipt path still advised"
assert_eq "1" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" "consult stdout is still exactly one JSON object"
assert_file_exists "$L" "ladder row written"
assert_eq "1" "$(wc -l < "$L" | tr -d ' ')" "exactly one ladder row"
ROW="$(tail -1 "$L")"
assert_contains "$ROW" '"kind":"ladder"' "row kind ladder"
assert_contains "$ROW" '"rung":"U1"' "row rung U1"
assert_contains "$ROW" '"heterogeneous":true' "topology seat ⇒ heterogeneous true"
assert_contains "$ROW" '"terms":["cache","invalidation"]' "terms carried"
assert_contains "$ROW" '"signal_ids":["S1"]' "signals carried"
assert_contains "$ROW" '"work_unit":"p1"' "work unit carried"
assert_contains "$ROW" '"dispatch_run_id":"consult-' "run id stamped"
rm -f "$ARGV"

# ── 4. native-fallback seat ⇒ heterogeneous false ──
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO_EMPTY" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB" --ladder-receipt "$L" --ladder-terms cache --ladder-unknown-type why --ladder-work-unit p2 2>"$TEST_TMP/4.err")"; RC=$?
assert_eq "0" "$RC" "native-fallback consult still advised (the probe, not this rail, decides whether to call it)"
assert_contains "$(tail -1 "$L")" '"heterogeneous":false' "native-fallback ⇒ heterogeneous false on the row"
assert_eq "2" "$(wc -l < "$L" | tr -d ' ')" "second row appended, never rewritten"

# ── 4b. transport failure with --ladder-receipt ⇒ one rail-failed row (budget consumed, not a climb) ──
DEAD="$TEST_TMP/dead-author.sh"; printf '#!/usr/bin/env bash\nexit 97\n' > "$DEAD"; chmod +x "$DEAD"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$DEAD" --ladder-receipt "$L" --ladder-terms cache --ladder-unknown-type why --ladder-work-unit p3 2>/dev/null)"; RC=$?
assert_eq "5" "$RC" "dead transport still exits 5"
assert_contains "$OUT" '"status": "transport_failed"' "dead transport status unchanged"
assert_eq "3" "$(wc -l < "$L" | tr -d ' ')" "a rail-failed row was appended"
assert_contains "$(tail -1 "$L")" '"reason":"rail-failed"' "row carries reason rail-failed"
assert_contains "$(tail -1 "$L")" '"rung":"U1"' "rail-failed row is at U1"

# ── 4c. qualification failure (resolver D7 refuses the seat) with --ladder-receipt ⇒ rail-failed row ──
CFG_UNQUAL="$TEST_TMP/unqual.md"; printf -- '- consult_engine: unqualified-model\n- consult_runner: codex\n- consult_effort: high\n- consult_dispatch: on\n' > "$CFG_UNQUAL"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_UNQUAL" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB" --ladder-receipt "$L" --ladder-terms cache --ladder-unknown-type why --ladder-work-unit p4 2>/dev/null)"; RC=$?
assert_eq "3" "$RC" "unqualified seat still exits 3"
assert_contains "$OUT" '"status": "qualification_failed"' "status qualification_failed unchanged"
assert_eq "4" "$(wc -l < "$L" | tr -d ' ')" "qualification failure appended a rail-failed row (budget consumed)"
assert_contains "$(tail -1 "$L")" '"reason":"rail-failed"' "row reason rail-failed"
# no --ladder-signals ⇒ empty list, never a fabricated S6
assert_contains "$(tail -1 "$L")" '"signal_ids":[]' "omitted --ladder-signals ⇒ signal_ids [] (no fabricated S6)"

# ── 5. --ladder-receipt without terms/type ⇒ advice delivered, no row, stderr says so ──
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB" --ladder-receipt "$L" 2>"$TEST_TMP/5.err")"; RC=$?
assert_eq "0" "$RC" "missing ladder metadata never fails the consult"
assert_contains "$(cat "$TEST_TMP/5.err")" "receipt NOT written" "stderr names the skipped receipt"
assert_eq "4" "$(wc -l < "$L" | tr -d ' ')" "no row without terms/type"

finalize_test
