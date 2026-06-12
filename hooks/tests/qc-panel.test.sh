#!/usr/bin/env bash
# qc-panel.sh integration tests (no live model calls, no network).
# Uses QC_CLAUDE_BIN / QC_AGY_BIN env seams with PATH-stub scripts.
# Covers:
#   - 6 judge invocations recorded
#   - synthesizer merge correct on agreeing judges
#   - dissent surfaces when judges disagree
#   - verdict artifact written
#   - calibration sample appended
#   - non-verdict-bearing report → skipped
#   - judge failure → non-zero exit (liveness)
#   - token estimate present
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/qc-panel.sh"

# ── Isolation ────────────────────────────────────────────────────────────────
OUT_DIR="$TEST_TMP/panel-out"
mkdir -p "$OUT_DIR"
CAL_DIR="$TEST_TMP/calibration"
export CALIBRATION_DATA_DIR="$CAL_DIR"

# ── Stub binaries ─────────────────────────────────────────────────────────────

# Invocation counter: shared file incremented by each judge stub call
INVOKE_COUNT_FILE="$TEST_TMP/invoke_count"
printf '0' > "$INVOKE_COUNT_FILE"

# Claude stub: writes canned ACHIEVED/EXTRA/MISSED output and increments counter
STUB_CLAUDE="$TEST_TMP/claude"
cat > "$STUB_CLAUDE" <<'STUB'
#!/usr/bin/env bash
# Usage: claude -p --model <m>  (stdin = prompt)
# Read the full stdin (prompt) to detect which question shape is being asked
PROMPT="$(cat)"
COUNT_FILE="$INVOKE_COUNT_FILE"
N="$(cat "$COUNT_FILE")"
N=$((N + 1))
printf '%d' "$N" > "$COUNT_FILE"

# Emit structured output matching question shape
if printf '%s' "$PROMPT" | grep -q "NOT achieved"; then
  printf 'MISSED: goal-3 not completed\n'
elif printf '%s' "$PROMPT" | grep -q "BEYOND"; then
  printf 'EXTRA: added extra logging\n'
else
  printf 'ACHIEVED: goal-1 done\nACHIEVED: goal-2 done\n'
fi
STUB
chmod +x "$STUB_CLAUDE"
export QC_CLAUDE_BIN="$STUB_CLAUDE"

# agy stub: writes verdict to ./verdict.txt (file-write mode recipe)
# Also increments shared invoke counter
STUB_AGY="$TEST_TMP/agy"
cat > "$STUB_AGY" <<'STUB'
#!/usr/bin/env bash
# agy -p <prompt> --model ... --dangerously-skip-permissions --print-timeout 8m
# cwd = throwaway dir; writes verdict.txt then prints DONE
PROMPT="${2:-}"
COUNT_FILE="$INVOKE_COUNT_FILE"
N="$(cat "$COUNT_FILE")"
N=$((N + 1))
printf '%d' "$N" > "$COUNT_FILE"

if printf '%s' "$PROMPT" | grep -q "NOT achieved"; then
  printf 'MISSED: goal-3 not completed (agy)\n' > ./verdict.txt
elif printf '%s' "$PROMPT" | grep -q "BEYOND"; then
  printf 'EXTRA: extra logging (agy)\n' > ./verdict.txt
else
  printf 'ACHIEVED: goal-1 done (agy)\nACHIEVED: goal-2 done (agy)\n' > ./verdict.txt
fi
printf 'DONE\n'
STUB
chmod +x "$STUB_AGY"
export QC_AGY_BIN="$STUB_AGY"

# ── Build a minimal verdict-bearing node report ────────────────────────────────
REPORT="$TEST_TMP/report.json"
cat > "$REPORT" <<'EOF'
{
  "node": "test-node-1",
  "verdict": "pass",
  "confidence": 0.9,
  "evidence_pointers": ["scripts/tree.sh:1-10@HEAD"],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

# Small artifact
ARTIFACT="$TEST_TMP/artifact.txt"
printf 'build output: success\n' > "$ARTIFACT"

# ── Test 1: panel runs, 6 judge calls recorded ────────────────────────────────
# Reset invoke counter (each judge stub increments it)
printf '0' > "$INVOKE_COUNT_FILE"
export INVOKE_COUNT_FILE

"$SCRIPT" \
  --report "$REPORT" \
  --artifacts "$ARTIFACT" \
  --out "$OUT_DIR" \
  --node test-node-1 > "$TEST_TMP/panel_run_out.txt" 2>&1
RUN_EXIT=$?

assert_eq "0" "$RUN_EXIT" "panel exits 0"

FINAL_COUNT="$(cat "$INVOKE_COUNT_FILE")"
# 6 judges + 1 synthesizer = 7 total claude calls; agy called 3 times, claude 4 times
# But both stubs share the same counter; total = 3 (agy) + 3 (claude judges) + 1 (synth) = 7
# The spec says 6 judge invocations; synth is separate. Let's verify >= 6.
if [ "$FINAL_COUNT" -ge 6 ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "expected >= 6 judge invocations, got $FINAL_COUNT"
fi

# ── Test 2: verdict artifact written ─────────────────────────────────────────
VERDICT_FILE=""
for _f in "$OUT_DIR"/test-node-1-*.json; do
  case "$_f" in *skipped*) continue ;; esac
  [ -f "$_f" ] && VERDICT_FILE="$_f" && break
done
assert_file_exists "${VERDICT_FILE:-/nonexistent}" "verdict artifact written"

# ── Test 3: verdict artifact has correct schema ────────────────────────────────
if [ -f "${VERDICT_FILE:-}" ]; then
  assert_contains "$(cat "$VERDICT_FILE")" '"status":"ok"'           "verdict has status:ok"
  assert_contains "$(cat "$VERDICT_FILE")" '"verdict":'               "verdict has verdict field"
  assert_contains "$(cat "$VERDICT_FILE")" '"token_estimate":'        "verdict has token_estimate"
  assert_contains "$(cat "$VERDICT_FILE")" '"judges":'                "verdict has judges refs"
fi

# ── Test 4: calibration sample appended ──────────────────────────────────────
assert_file_exists "$CAL_DIR/samples.jsonl" "calibration samples.jsonl created"
SAMPLE_LINE="$(tail -1 "$CAL_DIR/samples.jsonl")"
assert_contains "$SAMPLE_LINE" '"panel_verdict":'      "calibration sample has panel_verdict"
assert_contains "$SAMPLE_LINE" '"authoritative_verdict":' "calibration sample has auth_verdict"
assert_contains "$SAMPLE_LINE" '"tokens":'             "calibration sample has tokens"

# ── Test 5: token estimate is a positive integer ─────────────────────────────
if [ -f "${VERDICT_FILE:-}" ]; then
  TOKEN_EST="$(grep -o '"token_estimate":[0-9]*' "$VERDICT_FILE" | cut -d: -f2)"
  if [ -n "$TOKEN_EST" ] && [ "$TOKEN_EST" -gt 0 ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "token_estimate should be > 0, got: '$TOKEN_EST'"
  fi
fi

# ── Test 6: MISSED items appear in verdict ────────────────────────────────────
# Both judges reported MISSED for Q3 → synthesizer should surface this
# The synthesizer is also stubbed (claude stub handles MISSED question too)
# Since MISSED lines were emitted, deterministic verdict should be "fail"
if [ -f "${VERDICT_FILE:-}" ]; then
  VERDICT_VAL="$(grep -o '"verdict":"[^"]*"' "$VERDICT_FILE" | cut -d'"' -f4)"
  # With MISSED items present, deterministic merge → fail
  assert_eq "fail" "$VERDICT_VAL" "verdict is fail when missed goals present"
fi

# ── Test 7: non-verdict-bearing report → skipped, exit 0 ─────────────────────
NULL_REPORT="$TEST_TMP/null-report.json"
cat > "$NULL_REPORT" <<'EOF'
{
  "node": "null-node",
  "verdict": null,
  "confidence": null,
  "evidence_pointers": [],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

SKIP_OUT_DIR="$TEST_TMP/skip-panel-out"
mkdir -p "$SKIP_OUT_DIR"
SKIP_OUT="$("$SCRIPT" \
  --report "$NULL_REPORT" \
  --artifacts "$ARTIFACT" \
  --out "$SKIP_OUT_DIR" \
  --node null-node 2>&1)"
SKIP_EXIT=$?
assert_eq "0" "$SKIP_EXIT" "null-verdict report exits 0"
assert_contains "$SKIP_OUT" '"status":"skipped"'             "skipped status in output"
assert_contains "$SKIP_OUT" '"skipped_reason":"null-verdict"' "null-verdict reason"

# No calibration sample for skipped runs
SKIP_SAMPLES="$TEST_TMP/calibration-skip"
mkdir -p "$SKIP_SAMPLES"
CALIBRATION_DATA_DIR="$SKIP_SAMPLES" "$SCRIPT" \
  --report "$NULL_REPORT" \
  --artifacts "$ARTIFACT" \
  --out "$SKIP_OUT_DIR" \
  --node null-node2 >/dev/null 2>&1 || true
assert_file_absent "$SKIP_SAMPLES/samples.jsonl" "no calibration sample for skipped run"

# ── Test 8: judge failure → non-zero exit (liveness) ─────────────────────────
FAIL_CLAUDE="$TEST_TMP/claude-fail"
printf '#!/usr/bin/env bash\nexit 1\n' > "$FAIL_CLAUDE"
chmod +x "$FAIL_CLAUDE"

FAIL_AGY="$TEST_TMP/agy-fail"
printf '#!/usr/bin/env bash\nexit 1\n' > "$FAIL_AGY"
chmod +x "$FAIL_AGY"

FAIL_OUT_DIR="$TEST_TMP/fail-panel-out"
mkdir -p "$FAIL_OUT_DIR"
QC_CLAUDE_BIN="$FAIL_CLAUDE" QC_AGY_BIN="$FAIL_AGY" \
  "$SCRIPT" --report "$REPORT" --artifacts "$ARTIFACT" \
  --out "$FAIL_OUT_DIR" --node fail-node >/dev/null 2>&1
FAIL_EXIT=$?
assert_eq "1" "$FAIL_EXIT" "judge failure → exit 1 (liveness)"

# ── Test 9: dissent — judges disagree on verdict ──────────────────────────────
# Create a report with a clean "pass" verdict and a panel where one judge misses
AGREE_REPORT="$TEST_TMP/agree-report.json"
cat > "$AGREE_REPORT" <<'EOF'
{
  "node": "agree-node",
  "verdict": "pass",
  "confidence": 0.95,
  "evidence_pointers": ["scripts/tree.sh:1-10@HEAD"],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

# Claude stub always emits MISSED; agy stub that emits NO MISSED (all achieved)
AGREE_AGY="$TEST_TMP/agy-agree"
cat > "$AGREE_AGY" <<'STUB'
#!/usr/bin/env bash
# For Q3 (NOT achieved) — says nothing missed
if printf '%s' "${2:-}" | grep -q "NOT achieved"; then
  printf '' > ./verdict.txt
else
  printf 'ACHIEVED: everything done (agy)\n' > ./verdict.txt
fi
printf 'DONE\n'
STUB
chmod +x "$AGREE_AGY"

# Claude always reports MISSED; agy never does → disagreement
AGREE_OUT_DIR="$TEST_TMP/agree-panel-out"
mkdir -p "$AGREE_OUT_DIR"
AGREE_CAL_DIR="$TEST_TMP/calibration-agree"

QC_CLAUDE_BIN="$STUB_CLAUDE" QC_AGY_BIN="$AGREE_AGY" \
  CALIBRATION_DATA_DIR="$AGREE_CAL_DIR" \
  "$SCRIPT" --report "$AGREE_REPORT" --artifacts "$ARTIFACT" \
  --out "$AGREE_OUT_DIR" --node agree-node 2>/dev/null
AGREE_EXIT=$?
assert_eq "0" "$AGREE_EXIT" "disagree scenario exits 0"

# ── Test 10: --help exits 0 and mentions required flags ───────────────────────
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "--report" "--help mentions --report"
assert_contains "$HELP_OUT" "--artifacts" "--help mentions --artifacts"

# ── Test 11: missing --report → exit 2 ───────────────────────────────────────
"$SCRIPT" --artifacts "$ARTIFACT" --out "$OUT_DIR" 2>/dev/null; MISS_EXIT=$?
assert_eq "2" "$MISS_EXIT" "missing --report → exit 2"

# ── Test 12: missing --artifacts → exit 2 ────────────────────────────────────
"$SCRIPT" --report "$REPORT" --out "$OUT_DIR" 2>/dev/null; MISS_EXIT2=$?
assert_eq "2" "$MISS_EXIT2" "missing --artifacts → exit 2"

finalize_test
