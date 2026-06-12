#!/usr/bin/env bash
# calibration.sh integration tests.
# Covers: add-sample appends valid JSONL; report computes agreement rate;
# false_pass_on_critical counted; graduation unmet on small samples;
# run-known-bad with stubbed panel-cmd; corpus integrity check.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/calibration.sh"
KNOWN_BAD_DIR="$REPO_ROOT/evals/known-bad"

# Per-test CALIBRATION_DATA_DIR isolation (never touch ~/.autopilot)
CAL_DIR="$TEST_TMP/calibration"
export CALIBRATION_DATA_DIR="$CAL_DIR"

# ── 1. --help exits 0 ──────────────────────────────────────────────────────────
OUT="$("$SCRIPT" --help 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "--help exit code"
assert_contains "$OUT" "add-sample" "--help mentions add-sample"
assert_contains "$OUT" "report" "--help mentions report"

# ── 2. add-sample appends valid JSONL ─────────────────────────────────────────
"$SCRIPT" add-sample --panel-verdict pass --authoritative-verdict pass \
  --outcome ok --class minor --tokens 100 --source test-src-1
assert_file_exists "$CAL_DIR/samples.jsonl" "samples.jsonl created"

LINE="$(tail -1 "$CAL_DIR/samples.jsonl")"
assert_contains "$LINE" '"panel_verdict":"pass"'    "panel_verdict written"
assert_contains "$LINE" '"authoritative_verdict":"pass"' "auth_verdict written"
assert_contains "$LINE" '"agreed":true'             "agreed=true when both pass"
assert_contains "$LINE" '"class":"minor"'           "class written"
assert_contains "$LINE" '"tokens":100'              "tokens written"
assert_contains "$LINE" '"source":"test-src-1"'     "source written"

# ── 3. add-sample: disagreement → agreed=false ────────────────────────────────
"$SCRIPT" add-sample --panel-verdict pass --authoritative-verdict fail \
  --class critical
LINE2="$(tail -1 "$CAL_DIR/samples.jsonl")"
assert_contains "$LINE2" '"agreed":false' "agreed=false when verdicts differ"

# ── 4. report: agreement rate 1/2 = 0.5 ──────────────────────────────────────
REPORT="$("$SCRIPT" report)"
assert_contains "$REPORT" '"sample_count": 2'   "sample_count correct"
assert_contains "$REPORT" '"agreement_rate": 0.5000' "agreement_rate 0.5000"

# ── 5. false_pass_on_critical counted ────────────────────────────────────────
# sample 2 was panel=pass, auth=fail, class=critical → false_pass_on_critical=1
assert_contains "$REPORT" '"false_pass_on_critical": 1' "false_pass_on_critical=1"

# ── 6. per_class breakdown ─────────────────────────────────────────────────────
assert_contains "$REPORT" '"critical":' "per_class has critical"
# critical: 1 total, 0 agreed
assert_contains "$REPORT" '"total": 1, "agreed": 0' "critical total/agreed"

# ── 7. graduation unmet on 2 samples (need 50) ────────────────────────────────
assert_contains "$REPORT" '"met": false' "graduation not met"
assert_contains "$REPORT" '"unmet_reasons"' "unmet_reasons present"
assert_contains "$REPORT" '50 samples' "unmet: sample count reason"

# ── 8. agreement rate 4/5 = 0.80 ─────────────────────────────────────────────
# Build a fresh data dir with 5 samples: 4 agree, 1 disagree
CAL_DIR2="$TEST_TMP/calibration2"
CALIBRATION_DATA_DIR="$CAL_DIR2" "$SCRIPT" add-sample --panel-verdict pass --authoritative-verdict pass
CALIBRATION_DATA_DIR="$CAL_DIR2" "$SCRIPT" add-sample --panel-verdict pass --authoritative-verdict pass
CALIBRATION_DATA_DIR="$CAL_DIR2" "$SCRIPT" add-sample --panel-verdict fail --authoritative-verdict fail
CALIBRATION_DATA_DIR="$CAL_DIR2" "$SCRIPT" add-sample --panel-verdict fail --authoritative-verdict fail
CALIBRATION_DATA_DIR="$CAL_DIR2" "$SCRIPT" add-sample --panel-verdict pass --authoritative-verdict fail

REPORT2="$(CALIBRATION_DATA_DIR="$CAL_DIR2" "$SCRIPT" report)"
assert_contains "$REPORT2" '"sample_count": 5'      "5 sample_count"
assert_contains "$REPORT2" '"agreement_rate": 0.8000' "agreement rate 0.8000"

# ── 9. report: graduation still unmet (need 50) ──────────────────────────────
assert_contains "$REPORT2" '"met": false' "graduation not met at 5 samples"

# ── 10. run-known-bad: stubbed panel-cmd that always says pass ────────────────
# A panel cmd that always returns pass (worst case: misses all defects)
ALWAYS_PASS_CMD="printf '{\"verdict\":\"pass\"}'"
CAL_DIR3="$TEST_TMP/calibration3"
RESULT="$(CALIBRATION_DATA_DIR="$CAL_DIR3" "$SCRIPT" run-known-bad --panel-cmd "$ALWAYS_PASS_CMD" 2>/dev/null)"
assert_contains "$RESULT" '"false_passes"' "run-known-bad returns false_passes"
# All 10 known-bad diffs are defects → panel=pass means all are false passes
FALSE_PASSES="$(printf '%s' "$RESULT" | grep -o '"false_passes":[0-9]*' | cut -d: -f2)"
assert_eq "10" "$FALSE_PASSES" "all 10 diffs generate false passes with always-pass panel"

# ── 11. run-known-bad: stubbed panel-cmd that always says fail ────────────────
# A panel cmd that always returns fail (catches all defects)
ALWAYS_FAIL_CMD="printf '{\"verdict\":\"fail\"}'"
CAL_DIR4="$TEST_TMP/calibration4"
RESULT2="$(CALIBRATION_DATA_DIR="$CAL_DIR4" "$SCRIPT" run-known-bad --panel-cmd "$ALWAYS_FAIL_CMD" 2>/dev/null)"
FALSE_PASSES2="$(printf '%s' "$RESULT2" | grep -o '"false_passes":[0-9]*' | cut -d: -f2)"
assert_eq "0" "$FALSE_PASSES2" "zero false passes with always-fail panel"

# ── 12. corpus integrity: every .diff has a parseable .expected.json sidecar ──
DIFFS_FOUND=0
SIDECARS_MISSING=0
SIDECARS_MISSING_FILES=""
for diff_file in "$KNOWN_BAD_DIR"/*.diff; do
  [ -f "$diff_file" ] || continue
  DIFFS_FOUND=$((DIFFS_FOUND + 1))
  base="$(basename "$diff_file" .diff)"
  expected="$KNOWN_BAD_DIR/$base.expected.json"
  if [ ! -f "$expected" ]; then
    SIDECARS_MISSING=$((SIDECARS_MISSING + 1))
    SIDECARS_MISSING_FILES="$SIDECARS_MISSING_FILES $base"
    continue
  fi
  # Parseable: must contain "class" and "defect" keys
  cls="$(grep -o '"class":"[^"]*"' "$expected" | cut -d'"' -f4)"
  defect="$(grep -o '"defect":"[^"]*"' "$expected" | cut -d'"' -f4)"
  [ -n "$cls" ]    || fail "corpus: $base.expected.json missing 'class' field"
  [ -n "$defect" ] || fail "corpus: $base.expected.json missing 'defect' field"
  # class must be one of critical|major|minor
  case "$cls" in
    critical|major|minor) ;;
    *) fail "corpus: $base.expected.json class='$cls' not in {critical,major,minor}" ;;
  esac
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))  # count one pass per valid sidecar
done

assert_eq "0" "$SIDECARS_MISSING" "all .diff files have .expected.json sidecars (missing:$SIDECARS_MISSING_FILES)"
# At least 10 diffs in corpus
if [ "$DIFFS_FOUND" -ge 10 ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "corpus: expected >= 10 .diff files, found $DIFFS_FOUND"
fi

# ── 13. add-sample validation: bad verdict → exit 1 ──────────────────────────
"$SCRIPT" add-sample --panel-verdict bad --authoritative-verdict pass 2>/dev/null; ADD_EXIT=$?
assert_eq "1" "$ADD_EXIT" "invalid panel-verdict exits 1"

# ── 14. run-known-bad: --panel-cmd required ───────────────────────────────────
"$SCRIPT" run-known-bad 2>/dev/null; RKB_EXIT=$?
assert_eq "1" "$RKB_EXIT" "run-known-bad without --panel-cmd exits 1"

finalize_test
