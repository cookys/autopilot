#!/usr/bin/env bash
# Red-case coverage for scripts/next-pick.js (autonomous-brain P5, KR6/R6).
# Proves: deterministic replay from the materialized record, ask-first rows are
# never auto-picked, user preference outranks system signals among eligible
# candidates, and BACKLOG parsing extracts machine-readable fields.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/next-pick.js"

cat > "$TEST_TMP/candidates.json" <<'JSON'
[
 {"title":"Old small system-favored fix","effort":"S","tags":[],"class":"standard-impl","age_days":40,"source":"s1"},
 {"title":"User-preferred mechanical unit","effort":"M","tags":[],"class":"mechanical-impl","age_days":2,"source":"s2"},
 {"title":"Big refactor","effort":"L","tags":[],"class":"standard-impl","age_days":90,"source":"s3"},
 {"title":"Board-tagged thing","effort":"S","tags":["board"],"class":"standard-impl","age_days":90,"source":"s4"},
 {"title":"Deep perf mystery","effort":"M","tags":[],"class":"hard-problem","age_days":10,"source":"s5"}
]
JSON
cat > "$TEST_TMP/prefs.json" <<'JSON'
{"class_weights":{"mechanical-impl":10,"standard-impl":5,"hard-problem":8}}
JSON

# ── KR6: user preference outranks system signals (older+smaller loses to weight) ──
OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json")"
assert_exit_code "$?" "0" "pick succeeds"
PICKED="$(printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).pick.title))")"
assert_eq "User-preferred mechanical unit" "$PICKED" "preference weight beats staleness+effort"

# ── ask-first rows never picked, each with a machine-readable reason ──
assert_contains "$OUT" '"Big refactor"' "L row is queued ask-first"
assert_contains "$OUT" '"effort L"' "L reason named"
assert_contains "$OUT" '"Board-tagged thing"' "board row queued ask-first"
assert_contains "$OUT" '"board tag"' "board reason named"
assert_contains "$OUT" '"Deep perf mystery"' "hard-problem row queued ask-first"
assert_contains "$OUT" "pinned to depth-0" "hard-problem reason named"

# ── deterministic replay: same materialized inputs → byte-identical result ──
OUT2="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json")"
assert_eq "$OUT" "$OUT2" "replay from the same record is byte-identical"

# ── ledger append carries the pick-record (replay never reads live state) ──
L="$TEST_TMP/ledger.jsonl"
node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" --ledger "$L" --decision-id d-pick-1 --round 2 >/dev/null
assert_exit_code "$?" "0" "pick with ledger append succeeds"
ROW="$(node "$REPO_ROOT/scripts/decision-ledger.js" query --ledger "$L" --kind pick --json)"
assert_contains "$ROW" "d-pick-1" "pick row landed in the ledger"
assert_contains "$ROW" "candidates_digest" "pick-record materialized in the ledger"

# ── zero eligible candidates → pick null, exit 0 (empty queue is not an error) ──
printf '[{"title":"Only big things","effort":"H","tags":[],"class":"standard-impl","age_days":1,"source":"s"}]\n' > "$TEST_TMP/only-big.json"
OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/only-big.json" --preferences "$TEST_TMP/prefs.json")"
assert_exit_code "$?" "0" "empty eligible set is not an error"
assert_contains "$OUT" '"pick": null' "pick is null"

# ── parse: BACKLOG fixture → machine fields ──
cat > "$TEST_TMP/backlog.md" <<'EOF'
## Active entries

### Small cleanup thing
- **Trigger**: whenever.
- **Context**: c.
- **Effort**: S.
- **Source**: here.

### Giant migration
- **Trigger**: someday.
- **Context**: c.
- **Effort**: L (research-to-ship 全程)
- **Source**: there.

### Needs the Board
- **Trigger**: t.
- **Context**: c.
- **Effort**: Board decision (then S per slice)。
- **Source**: board thread.
EOF
P="$(node "$SCRIPT" parse --backlog "$TEST_TMP/backlog.md")"
assert_contains "$P" '"Small cleanup thing"' "row parsed"
assert_contains "$P" '"effort": "S"' "S token extracted"
assert_contains "$P" '"effort": "L"' "L token extracted"
assert_contains "$P" '"board"' "board tag detected from Effort text"

# ── Brain-seat gating on the auto-pick path (P7/KR4, brain-seat-exam-suite P4) ──
cat > "$TEST_TMP/brain-status-norec.json" <<'JSON'
{"schema_version":1,"artifact_type":"brain_seat_status","status":"no_record","strikes_since_pass":0}
JSON
cat > "$TEST_TMP/brain-status-requal.json" <<'JSON'
{"schema_version":1,"artifact_type":"brain_seat_status","status":"requalification_required","strikes_since_pass":3}
JSON
cat > "$TEST_TMP/brain-status-ok.json" <<'JSON'
{"schema_version":1,"artifact_type":"brain_seat_status","status":"qualified","strikes_since_pass":0}
JSON
cat > "$TEST_TMP/brain-override.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"any","runner":"any","role":"owner","reason":"test","expires":"2999-01-01"}]}
JSON

# candidate + no standing → refusal naming both legal paths, exit 1
BS_OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-norec.json" --seat-class candidate 2>/dev/null)"; BS_RC=$?
assert_eq "1" "$BS_RC" "candidate seat without standing refuses the auto-pick"
assert_contains "$BS_OUT" "brain_seat_refused" "refusal artifact is machine-readable"
assert_contains "$BS_OUT" "engine-qualify.sh brain" "refusal names the standing-exam path"
assert_contains "$BS_OUT" "qualification-override" "refusal names the override path"

# requalification_required behaves exactly like absence for a candidate
node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-requal.json" --seat-class candidate >/dev/null 2>&1
assert_eq "1" "$?" "requalification_required refuses a candidate (no silent third path)"

# the override still admits (two-path rule), loudly
BS_OVR_ERR="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-requal.json" --seat-class candidate \
  --qualification-override "$TEST_TMP/brain-override.json" 2>&1 >/dev/null)"; BS_OVR_RC=$?
assert_eq "0" "$BS_OVR_RC" "override admits a candidate with no standing"
assert_contains "$BS_OVR_ERR" "EVIDENCE-FREE" "override admission is loudly labelled"

# incumbent + no standing → advisory annotation, pick proceeds
BS_INC="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-norec.json" --seat-class incumbent 2>/dev/null)"; BS_INC_RC=$?
assert_eq "0" "$BS_INC_RC" "incumbent seat proceeds (Board 2026-08-16 advisory semantics)"
assert_contains "$BS_INC" '"admission": "advisory"' "incumbent admission is recorded as advisory"

# qualified standing → admitted, no annotation
BS_OK="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-ok.json" --seat-class incumbent 2>/dev/null)"
assert_contains "$BS_OK" '"admission": "admitted"' "standing pass admits cleanly"

finalize_test
