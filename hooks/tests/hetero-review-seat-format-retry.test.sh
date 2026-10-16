#!/usr/bin/env bash
# hetero-review-seat-format-retry.test.sh — BL-0197: a seat whose answer breaks an output rule
# is re-asked ONCE on its own; the round is not voided for it. Rules are unchanged: only the
# re-ask is new. Covers (1) dispatch-review.sh marking format rejects, (2) the retry notice in
# the prompt, (3) hetero-review-loop collect retrying only the format-rejected seat.
. "$(dirname "$0")/lib.sh"

DR="$REPO_ROOT/scripts/dispatch-review.sh"
LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"

# ─── (1)+(2) dispatch-review.sh: format_reject marker and retry notice ───
cat > "$TEST_TMP/diff.txt" <<'EOF'
diff --git a/x.js b/x.js
--- a/x.js
+++ b/x.js
@@ -1 +1 @@
-const a = 1
+const a = 2
EOF

# Fake runner: reads the prompt, answers according to $FAKE_MODE, records the prompt.
cat > "$TEST_TMP/fake-runner.sh" <<'EOF'
#!/usr/bin/env bash
prompt=""
i=1
while [ "$i" -le "$#" ]; do
  arg="${!i}"
  if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
    ni=$((i+1)); na="${!ni}"
    if [ -n "$na" ] && [ -f "$na" ]; then prompt="$(cat "$na")"; else prompt="$na"; fi
    break
  fi
  i=$((i+1))
done
[ -z "$prompt" ] && prompt="$(cat)"
[ -n "${PROMPT_CAPTURE_FILE:-}" ] && printf '%s' "$prompt" > "$PROMPT_CAPTURE_FILE"
begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
case "${FAKE_MODE:-ok}" in
  missing_evidence)
    printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=the diff and its contract; conclusion=nothing blocking remains\n%s\n' "$begin" "$end" ;;
  ok)
    printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=the diff and its contract; evidence=assignment changed in the captured diff; conclusion=nothing blocking remains\n%s\n' "$begin" "$end" ;;
  empty) : ;;
esac
EOF
chmod +x "$TEST_TMP/fake-runner.sh"

run_dr() { FAKE_MODE="$1" PROMPT_CAPTURE_FILE="${2:-$TEST_TMP/p.txt}" bash "$DR" --runner codex --model gpt-test --diff-file "$TEST_TMP/diff.txt" --bin "$TEST_TMP/fake-runner.sh" 2>/dev/null; }

OUT=$(run_dr missing_evidence); RC=$?
assert_eq "$RC" "1" "dr: missing evidence= is a no_verdict"
assert_contains "$OUT" '"format_reject": true' "dr: a missing proof field is marked format_reject"
OUT=$(run_dr empty); RC=$?
assert_eq "$RC" "1" "dr: empty answer is a no_verdict"
assert_not_contains "$OUT" 'format_reject' "dr: an empty answer is not a format reject (no retry)"
OUT=$(run_dr ok); RC=$?
assert_eq "$RC" "0" "dr: well-formed answer is reviewed"
assert_not_contains "$OUT" 'format_reject' "dr: a reviewed result carries no format_reject"

AUTOPILOT_REVIEW_RETRY_NOTE="NO-FINDING-PROOF must contain non-empty checked, evidence, and conclusion fields" run_dr ok "$TEST_TMP/p-note.txt" > /dev/null
assert_contains "$(cat "$TEST_TMP/p-note.txt")" "Retry notice: your previous answer to this same review was discarded because: NO-FINDING-PROOF must contain" "dr: retry note appears in the prompt"
run_dr ok "$TEST_TMP/p-plain.txt" > /dev/null
assert_not_contains "$(cat "$TEST_TMP/p-plain.txt")" "Retry notice" "dr: no retry note without the env"

# ─── (3) hetero-review-loop collect ───
SCRATCH_REPO="$TEST_TMP/repo"
mkdir -p "$SCRATCH_REPO/scripts"
(
  cd "$SCRATCH_REPO"
  git init -q; git config user.email t@example.com; git config user.name T
  echo a > file.txt; git add file.txt; git commit -q -m c1
  echo b > file.txt; git add file.txt; git commit -q -m c2
)
BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
(cd "$SCRATCH_REPO" && git checkout -q -b work && echo w >> file.txt && git commit -q -am c3)
cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/"

# Stateful stub dispatcher. Per-seat mode: STUB_MODE_<seat>; calls counted in $STUB_COUNT_DIR.
cat > "$SCRATCH_REPO/scripts/dispatch-review.sh" <<'EOF'
#!/usr/bin/env bash
n_file="$STUB_COUNT_DIR/$STUB_SEAT_ID"
n=$(( $(cat "$n_file" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$n_file"
[ -n "${AUTOPILOT_REVIEW_RETRY_NOTE:-}" ] && echo "$AUTOPILOT_REVIEW_RETRY_NOTE" > "$STUB_COUNT_DIR/$STUB_SEAT_ID.note"
VAR="STUB_MODE_${STUB_SEAT_ID}"
mode="${!VAR:-ok}"
good='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
fmt='{"status": "no_verdict", "verdict": null, "findings": "", "no_finding_proof": null, "error": "NO-FINDING-PROOF must contain non-empty checked, evidence, and conclusion fields", "format_reject": true}'
tr='{"status": "no_verdict", "verdict": null, "findings": "", "no_finding_proof": null, "error": "runner timed out"}'
case "$mode" in
  ok) echo "$good" ;;
  fmt_then_ok) if [ "$n" -eq 1 ]; then echo "$fmt"; exit 1; else echo "$good"; fi ;;
  fmt_always) echo "$fmt"; exit 1 ;;
  transport) echo "$tr"; exit 1 ;;
esac
EOF
chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"
unset STUB_SEAT_RESPONSE STUB_RESPONSE_s0 STUB_RESPONSE_s1

collect() { # <phase> <loop script>
  rm -rf "$TEST_TMP/counts-$1"; mkdir -p "$TEST_TMP/counts-$1"
  STUB_COUNT_DIR="$TEST_TMP/counts-$1" node "${2:-$LOOP}" collect --repo-root "$SCRATCH_REPO" --ledger "$TEST_TMP/ledger" \
    --phase "$1" --generation 1 --branch work --phase-base "$BASE" --seats "m1/low@codex,m2/med@agy" 2>&1
}

# T1: s1 breaks format once, then answers properly -> round survives, only s1 re-asked.
export STUB_MODE_s0=ok STUB_MODE_s1=fmt_then_ok
T1=$(collect t1); T1_RC=$?
assert_exit_code "$T1_RC" "0" "retry: format-rejected seat re-asked once and the round is not seat_gap"
assert_eq "$(cat "$TEST_TMP/counts-t1/s1")" "2" "retry: failing seat dispatched twice"
assert_eq "$(cat "$TEST_TMP/counts-t1/s0")" "1" "retry: healthy seat dispatched once (not re-run)"
assert_contains "$(cat "$TEST_TMP/counts-t1/s1.note")" "evidence" "retry: second ask carries the previous failure reason"
assert_file_absent "$TEST_TMP/counts-t1/s0.note" "retry: healthy seat got no retry note"
assert_contains "$(cat "$TEST_TMP/ledger/review-t1/g1/seat-s1.json")" '"format_retry"' "retry: ledger seat artifact records the retry"
assert_contains "$(cat "$TEST_TMP/ledger/review-t1/g1/seat-s1.json")" '"outcome": "reviewed"' "retry: ledger records the outcome"
assert_contains "$T1" "format retry 1/1" "retry: log line names the seat attempt"

# T2: both attempts fail format -> failure recorded exactly as before (seat_gap), only one extra ask.
export STUB_MODE_s1=fmt_always
T2=$(collect t2); T2_RC=$?
assert_exit_code "$T2_RC" "1" "retry: two format failures still void the round"
assert_eq "$(cat "$TEST_TMP/counts-t2/s1")" "2" "retry: at most one re-ask"
assert_contains "$(cat "$TEST_TMP/ledger/review-t2/chain.json")" '"reason": "seat_gap"' "retry: second failure is a seat_gap as today"
assert_contains "$(cat "$TEST_TMP/ledger/review-t2/g1/seat-s1.json")" '"outcome": "still_rejected"' "retry: ledger records the second failure"

# T3: transport failure -> no re-ask.
export STUB_MODE_s1=transport
T3=$(collect t3); T3_RC=$?
assert_exit_code "$T3_RC" "1" "retry: transport failure still gaps the round"
assert_eq "$(cat "$TEST_TMP/counts-t3/s1")" "1" "retry: transport failure is not re-asked"
assert_not_contains "$(cat "$TEST_TMP/ledger/review-t3/g1/seat-s1.json")" 'format_retry' "retry: no retry record for a transport failure"

# Negative control: remove the re-ask branch and T1 must go red.
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp -r "$REPO_ROOT/scripts" "$MUT/scripts"; ln -s "$REPO_ROOT/src" "$MUT/src"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const o = "while (attempts < FORMAT_RETRY_LIMIT && isFormatReject(result)) {";
  const s = fs.readFileSync(f, "utf8"); if (s.split(o).length !== 2) { console.error("MUTATION TARGET NOT UNIQUE"); process.exit(3); }
  fs.writeFileSync(f, s.replace(o, () => "while (false) {"));' "$MUT/scripts/hetero-review-loop.js" || fail "mutation setup failed"
export STUB_MODE_s1=fmt_then_ok
TM=$(collect tm "$MUT/scripts/hetero-review-loop.js"); TM_RC=$?
assert_exit_code "$TM_RC" "1" "negative control: without the re-ask branch the same input voids the round"
assert_eq "$(cat "$TEST_TMP/counts-tm/s1")" "1" "negative control: without the re-ask branch the seat is asked once"

finalize_test
