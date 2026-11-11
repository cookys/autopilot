#!/usr/bin/env bash
# qc-panel-codex-quota-fallback.test.sh — integration tests for runtime codex quota seat substitution
. "$(dirname "$0")/lib.sh"

DRIVER="$REPO_ROOT/scripts/hetero-review-loop.js"
CHECKER="$REPO_ROOT/scripts/check-phase-review-receipt.js"

SCRATCH_REPO="$TEST_TMP/repo"
mkdir -p "$SCRATCH_REPO/scripts"
(
  cd "$SCRATCH_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "base line" > app.js
  git add app.js
  git commit -q -m "base"
)
PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
(
  cd "$SCRATCH_REPO"
  git checkout -q -b work
  echo "feature line" >> app.js
  git add app.js
  git commit -q -m "feat: add feature line"
)

cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
chmod +x "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
cp "$REPO_ROOT/scripts/check-dispatch-suppression.sh" "$SCRATCH_REPO/scripts/check-dispatch-suppression.sh"
chmod +x "$SCRATCH_REPO/scripts/check-dispatch-suppression.sh"

# Isolated config and capability store (no real operator config or paid calls)
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/config.json"
echo '{}' > "$AUTOPILOT_CONFIG_FILE"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-store"
mkdir -p "$ENGINE_CAPABILITY_DIR"

STUB_DISPATCH="$TEST_TMP/stub-dispatch-review.sh"
cat << 'STUB_EOF' > "$STUB_DISPATCH"
#!/usr/bin/env bash
RUNNER=""
MODEL=""
EFFORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner) RUNNER="$2"; shift 2 ;;
    --model)  MODEL="$2"; shift 2 ;;
    --effort) EFFORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -n "${CALL_LOG:-}" ]; then
  printf 'seat=%s runner=%s model=%s effort=%s\n' "${STUB_SEAT_ID:-}" "$RUNNER" "$MODEL" "$EFFORT" >> "$CALL_LOG"
fi

if [ "$RUNNER" = "codex" ]; then
  case "${CODEX_FAIL_MODE:-quota}" in
    quota)
      printf '{"runner":"codex","model":"%s","status":"no_verdict","verdict":null,"findings":"","no_finding_proof":null,"raw_log":null,"error":"You'\''ve hit your usage limit. Please try again later.","usage":null}\n' "$MODEL"
      exit 1
      ;;
    http429)
      printf '{"runner":"codex","model":"%s","status":"no_verdict","verdict":null,"findings":"","no_finding_proof":null,"raw_log":null,"error":"HTTP 429 Too Many Requests: rate limit reached","usage":null}\n' "$MODEL"
      exit 1
      ;;
    non_quota)
      printf '{"runner":"codex","model":"%s","status":"no_verdict","verdict":null,"findings":"","no_finding_proof":null,"raw_log":null,"error":"seat_idle_timeout: reviewer produced no output","usage":null}\n' "$MODEL"
      exit 1
      ;;
  esac
fi

if [ "${SUBSTITUTE_FAIL:-0}" = "1" ] && { [ "$RUNNER" = "grok" ] || [ "$RUNNER" = "agy" ]; }; then
  printf '{"runner":"%s","model":"%s","status":"no_verdict","verdict":null,"findings":"","no_finding_proof":null,"raw_log":null,"error":"HTTP 429 Too Many Requests","usage":null}\n' "$RUNNER" "$MODEL"
  exit 1
fi

printf '{"runner":"%s","model":"%s","status":"reviewed","verdict":"SHIP-AS-IS","findings":"","no_finding_proof":"checked=app.js; evidence=feature line clean; conclusion=safe","raw_log":null,"error":null,"usage":null}\n' "$RUNNER" "$MODEL"
exit 0
STUB_EOF
chmod +x "$STUB_DISPATCH"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$STUB_DISPATCH"

EMPTY_DISP="$TEST_TMP/empty-dispositions.json"
echo '{"dispositions":[],"resolutions":[]}' > "$EMPTY_DISP"

# ─── Case 1: codex quota error -> grok-4.7@grok (effort high) substitutes once, Chinese line emitted, receipt validates ───
LEDGER1="$TEST_TMP/ledger1"
CALL_LOG1="$TEST_TMP/calls1.log"
: > "$CALL_LOG1"
C1_STDERR="$TEST_TMP/c1.stderr"
C1_STDOUT=$(CALL_LOG="$CALL_LOG1" CODEX_FAIL_MODE=quota node "$DRIVER" collect \
  --implementer-engine claude-sonnet-5 \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER1" \
  --phase p1 \
  --generation 1 \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --seats "gpt-5.6-sol/max@codex,claude-fable-5-1/high@claude-native" 2>"$C1_STDERR"); C1_RC=$?
assert_exit_code "$C1_RC" "0" "case 1: collect exits 0 when substitute succeeds"
assert_contains "$(cat "$C1_STDERR")" "codex 額度用完，由 grok-4.7@grok 代打" "case 1: collect stderr carries verbatim Traditional Chinese notice"
assert_contains "$C1_STDOUT" "codex 額度用完，由 grok-4.7@grok 代打" "case 1: collect stdout summary carries verbatim notice"
assert_contains "$C1_STDOUT" '"reason": "quota_exhausted"' "case 1: machine-readable summary records quota_exhausted reason"
assert_contains "$(cat "$CALL_LOG1")" "seat=s0 runner=codex model=gpt-5.6-sol effort=max" "case 1: original codex seat ran first"
assert_contains "$(cat "$CALL_LOG1")" "seat=s0 runner=grok model=grok-4.7 effort=high" "case 1: grok-4.7@grok ran with effort high"

# Verify seat-s0.json and chain.json record original_seat, substitute, and reason
SEAT0_JSON=$(cat "$LEDGER1/review-p1/g1/seat-s0.json")
assert_contains "$SEAT0_JSON" '"engine": "gpt-5.6-sol"' "case 1: seat-s0.json records original_seat engine"
assert_contains "$SEAT0_JSON" '"engine": "grok-4.7"' "case 1: seat-s0.json records substitute engine"
assert_contains "$SEAT0_JSON" '"reason": "quota_exhausted"' "case 1: seat-s0.json records reason"

F1_STDERR="$TEST_TMP/f1.stderr"
F1_STDOUT=$(node "$DRIVER" finalize \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER1" \
  --phase p1 \
  --generation 1 \
  --branch work \
  --dispositions "$EMPTY_DISP" 2>"$F1_STDERR"); F1_RC=$?
assert_exit_code "$F1_RC" "0" "case 1: finalize exits 0"
assert_contains "$(cat "$F1_STDERR")" "codex 額度用完，由 grok-4.7@grok 代打" "case 1: finalize stderr carries verbatim notice"
assert_contains "$F1_STDOUT" '"verdict": "SHIP-AS-IS"' "case 1: finalize verdict is SHIP-AS-IS"
assert_contains "$(cat "$LEDGER1/receipt-p1.json")" "codex 額度用完，由 grok-4.7@grok 代打" "case 1: receipt-p1.json carries verbatim notice"

CHK1_OUT=$(node "$CHECKER" --repo-root "$SCRATCH_REPO" --receipt "$LEDGER1/receipt-p1.json" --branch work 2>&1); CHK1_RC=$?
assert_exit_code "$CHK1_RC" "0" "case 1: check-phase-review-receipt validates substituted receipt"

# ─── Case 2: implementer is grok-4.7 (xai) -> skips grok-4.7@grok, substitutes gemini-4-carbon-high@agy (effort high) ───
LEDGER2="$TEST_TMP/ledger2"
CALL_LOG2="$TEST_TMP/calls2.log"
: > "$CALL_LOG2"
C2_STDERR="$TEST_TMP/c2.stderr"
C2_STDOUT=$(CALL_LOG="$CALL_LOG2" CODEX_FAIL_MODE=http429 node "$DRIVER" collect \
  --implementer-engine grok-4.7 \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER2" \
  --phase p1 \
  --generation 1 \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --seats "gpt-5.6-sol/max@codex,claude-fable-5-1/high@claude-native" 2>"$C2_STDERR"); C2_RC=$?
assert_exit_code "$C2_RC" "0" "case 2: collect exits 0 via second substitute when implementer is xai"
assert_not_contains "$(cat "$CALL_LOG2")" "runner=grok" "case 2: grok substitute skipped due to implementer family"
assert_contains "$(cat "$CALL_LOG2")" "seat=s0 runner=agy model=gemini-4-carbon-high effort=high" "case 2: gemini-4-carbon-high@agy ran with effort high"
assert_contains "$(cat "$C2_STDERR")" "codex 額度用完，由 gemini-4-carbon-high@agy 代打" "case 2: stderr carries gemini-4-carbon-high@agy notice"
assert_contains "$C2_STDOUT" '"reason": "rate_limited"' "case 2: summary records rate_limited reason for HTTP 429"

# ─── Case 3: another panel seat already xai in 2-seat panel -> skips grok-4.7@grok, uses gemini-4-carbon-high@agy ───
LEDGER3="$TEST_TMP/ledger3"
CALL_LOG3="$TEST_TMP/calls3.log"
: > "$CALL_LOG3"
C3_STDERR="$TEST_TMP/c3.stderr"
C3_STDOUT=$(CALL_LOG="$CALL_LOG3" CODEX_FAIL_MODE=quota node "$DRIVER" collect \
  --implementer-engine claude-sonnet-5 \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER3" \
  --phase p1 \
  --generation 1 \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --seats "gpt-5.6-sol/max@codex,grok-4.6/high@grok" 2>"$C3_STDERR"); C3_RC=$?
assert_exit_code "$C3_RC" "0" "case 3: collect exits 0 via gemini substitute when xai already in 2-seat panel"
assert_not_contains "$(cat "$CALL_LOG3")" "seat=s0 runner=grok" "case 3: s0 did not substitute to grok when s1 is already xai"
assert_contains "$(cat "$CALL_LOG3")" "seat=s0 runner=agy model=gemini-4-carbon-high effort=high" "case 3: s0 substituted to gemini-4-carbon-high@agy"
assert_contains "$(cat "$C3_STDERR")" "codex 額度用完，由 gemini-4-carbon-high@agy 代打" "case 3: stderr carries gemini-4-carbon-high@agy notice"

# ─── Case 4: non-quota codex failure -> NO substitution, preserves seat_gap ───
LEDGER4="$TEST_TMP/ledger4"
CALL_LOG4="$TEST_TMP/calls4.log"
: > "$CALL_LOG4"
C4_OUT=$(CALL_LOG="$CALL_LOG4" CODEX_FAIL_MODE=non_quota node "$DRIVER" collect \
  --implementer-engine claude-sonnet-5 \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER4" \
  --phase p1 \
  --generation 1 \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --seats "gpt-5.6-sol/max@codex,claude-fable-5-1/high@claude-native" 2>&1); C4_RC=$?
assert_exit_code "$C4_RC" "1" "case 4: non-quota codex failure still exits 1 (seat_gap)"
assert_not_contains "$C4_OUT" "代打" "case 4: non-quota failure emits no substitution notice"
assert_not_contains "$(cat "$CALL_LOG4")" "runner=grok" "case 4: non-quota failure does not invoke grok substitute"
assert_not_contains "$(cat "$CALL_LOG4")" "runner=agy" "case 4: non-quota failure does not invoke agy substitute"

# ─── Case 5: substitute also fails -> re-runs at most ONCE (no cascade), exits 1 (seat_gap) ───
LEDGER5="$TEST_TMP/ledger5"
CALL_LOG5="$TEST_TMP/calls5.log"
: > "$CALL_LOG5"
C5_OUT=$(CALL_LOG="$CALL_LOG5" CODEX_FAIL_MODE=quota SUBSTITUTE_FAIL=1 node "$DRIVER" collect \
  --implementer-engine claude-sonnet-5 \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER5" \
  --phase p1 \
  --generation 1 \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --seats "gpt-5.6-sol/max@codex,claude-fable-5-1/high@claude-native" 2>&1); C5_RC=$?
assert_exit_code "$C5_RC" "1" "case 5: failed substitute exits 1 (seat_gap)"
assert_contains "$(cat "$CALL_LOG5")" "seat=s0 runner=grok model=grok-4.7 effort=high" "case 5: first eligible substitute ran once"
assert_not_contains "$(cat "$CALL_LOG5")" "seat=s0 runner=agy" "case 5: does not cascade to a second re-run after substitute fails"

# ─── Negative control: mutant with empty qc_panel.codex_quota_substitutes blocks substitution on Case 1 shape ───
EMPTY_SUB_CFG="$TEST_TMP/empty-sub-config.json"
echo '{"qc_panel":{"codex_quota_substitutes":[]}}' > "$EMPTY_SUB_CFG"
LEDGER_NC="$TEST_TMP/ledger-nc"
NC_OUT=$(AUTOPILOT_CONFIG_FILE="$EMPTY_SUB_CFG" CODEX_FAIL_MODE=quota node "$DRIVER" collect \
  --implementer-engine claude-sonnet-5 \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER_NC" \
  --phase p1 \
  --generation 1 \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --seats "gpt-5.6-sol/max@codex,claude-fable-5-1/high@claude-native" 2>&1); NC_RC=$?
assert_exit_code "$NC_RC" "1" "negative control: disabling substitutes turns codex quota failure red (seat_gap)"

finalize_test
