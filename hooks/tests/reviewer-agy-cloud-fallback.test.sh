#!/usr/bin/env bash
# agy reviewer post-failure cloud retreat. An agy gemini-4-carbon-* seat whose
# effective policy is cloud-fallback (unset resolves to cloud-fallback + the argon
# rung of the same tier) re-runs ONCE after a no_verdict classified
# quota_exhausted, rate_limited or unavailable. Not an endpoint probe:
# AUTOPILOT_ENDPOINT_PREPROBE stays off (lib.sh default) and must not disable it.
# No real model: a fake agy behind the stdin adapter, counted by a bwrap wrapper
# outside the sandbox.
. "$(dirname "$0")/lib.sh"
scrub_session_env
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  REVIEW_LOOP_CONFIG_OVERRIDE AUTOPILOT_QUALIFICATION_OVERRIDE AUTOPILOT_AGY_REVIEW_RETREATED \
  AUTOPILOT_AGY_RETREAT_SERVED_BY AUTOPILOT_AGY_RETREAT_LOG_ROW 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1
export AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"
: > "$AUTOPILOT_ENDPOINTS_ENV"
# lib.sh pins this off. The retreat must still run.
[ "${AUTOPILOT_ENDPOINT_PREPROBE:-}" = "off" ] || fail "preprobe default is not off"

command -v bwrap >/dev/null 2>&1 || fail "bwrap is required"
REAL_BWRAP="$(command -v bwrap)"

REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
DIFF="$TEST_TMP/diff.txt"
printf 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' > "$DIFF"

CARBON="gemini-4-carbon-high"
ARGON="gemini-4-argon-high"
SERVED="gemini-4-argon-high/high@agy"

# Population B: these roster lines pin the switches so the fixture never rides a changed default.
write_cfg() { # $1 path, $2 extra reviewer lines (may be empty)
  {
    printf '%s\n' "- on_engine_unavailable: ask"
    printf '%s\n' "- override: reviewer | until 2099-01-01 | agy carbon retreat"
    # Population B sees only a markdown-list line at column 0 (git grep). A
    # printf of the same text does not match. The heredoc also writes the pins
    # into the fixture so the seat never rides a changed consult/discuss default.
    cat <<'PIN'
- consult_dispatch: off
- discuss_dispatch: off
PIN
    printf '%s\n' "- reviewer_engine: $CARBON"
    printf '%s\n' "- reviewer_runner: agy"
    printf '%s\n' "- reviewer_effort: high"
    [ -n "${2:-}" ] && printf '%s\n' "$2"
  } > "$1"
}
CFG_DEFAULT="$TEST_TMP/reviewer-default.md"
write_cfg "$CFG_DEFAULT" ""
CFG_ASK="$TEST_TMP/reviewer-ask.md"
write_cfg "$CFG_ASK" "- reviewer_on_engine_unavailable: ask
- reviewer_cloud_fallback_rung: gemini-4-argon-high/high@agy"

jget() {
  node -e 'let v=JSON.parse(process.argv[1]); for (const k of process.argv[2].split(".")) v = v == null ? v : v[k]; process.stdout.write(v === null || v === undefined ? "null" : (typeof v === "object" ? JSON.stringify(v) : String(v)));' "$1" "$2"
}
json_line() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
row_count() {
  if [ -f "$1/cloud-fallbacks.jsonl" ]; then
    grep -c . "$1/cloud-fallbacks.jsonl" || true
  else
    printf '0\n'
  fi
}
line_count() {
  if [ -f "$1" ]; then
    grep -c . "$1" || true
  else
    printf '0\n'
  fi
}

STUB="$TEST_TMP/agy-retreat-stub"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
model=""
agent=""
prompt=""
prev=""
for a in "$@"; do
  [ "$prev" = --model ] && model="$a"
  [ "$prev" = --agent ] && agent="$a"
  [ "$prev" = -p ] && prompt="$a"
  prev="$a"
done
limited=0
case "$model" in
  *carbon*)
    case "${AGY_CASE:-retreat}" in
      ship) ;;
      garbage) ;;
      *) limited=1 ;;
    esac
    ;;
  *argon*)
    [ "${AGY_CASE:-retreat}" = "both-limited" ] && limited=1
    ;;
esac
if [ "$limited" -eq 1 ]; then
  echo "rate limit: reviewer unavailable for this attempt" >&2
  exit 1
fi
agy_app="${HOME:-}/.gemini/antigravity-cli"
if [ -z "$agent" ] || ! grep -qx 'tools: \[\]' "$agy_app/agents/$agent/agent.md" 2>/dev/null; then
  echo "agy stub: review not run under a tool-less agent (--agent '$agent')" >&2
  exit 3
fi
mkdir -p "$agy_app/log" "$agy_app/brain/conv-1/.system_generated/logs"
echo 'I0924 cli_setting_manager.go:92] CLI settings initialized' > "$agy_app/log/cli-stub.log"
{
  echo '{"step_index":0,"type":"USER_INPUT","content":"prompt"}'
  echo '{"step_index":2,"type":"PLANNER_RESPONSE","content":"answer"}'
} > "$agy_app/brain/conv-1/.system_generated/logs/transcript.jsonl"
if [ "${AGY_CASE:-retreat}" = "garbage" ] && [[ "$model" == *carbon* ]]; then
  response_text='plain text with no verdict frame'
else
  begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  [ -n "$begin" ] && [ -n "$end" ] || { echo "agy stub: frame markers missing" >&2; exit 4; }
  response_text="$(printf '%s\n' "$begin" "VERDICT: SHIP-AS-IS" "FINDINGS: none" \
    "NO-FINDING-PROOF: checked=fixture diff and acceptance criteria; evidence=the changed slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed" \
    "$end")"
fi
# Exact agy envelope keys. Plain text is wrapped without usage and dispatch-status rejects it.
RESPONSE="$response_text" node -e '
  process.stdout.write(JSON.stringify({
    conversation_id: "fixture",
    duration_seconds: 1,
    num_turns: 1,
    response: process.env.RESPONSE,
    status: "SUCCESS",
    usage: {
      cache_read_tokens: 7,
      input_tokens: 101,
      output_tokens: 23,
      thinking_tokens: 11,
      total_tokens: 142
    }
  }));
'
exit 0
EOF
chmod +x "$STUB"
make_agy_stub_versioned "$STUB"

WRAP="$TEST_TMP/bwrap-wrap"
mkdir -p "$WRAP"
cat > "$WRAP/bwrap" <<EOF
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "\${BWRAP_LOG:?}"
exec ${REAL_BWRAP} "\$@"
EOF
chmod +x "$WRAP/bwrap"

# review_run <config> <tag> <AGY_CASE>
# sets RUN_OUT, RUN_RC, RUN_ERR, RUN_CAP, RUN_LOG
review_run() {
  local cfg="$1" tag="$2" agy_case="$3"
  RUN_CAP="$TEST_TMP/cap-$tag"
  mkdir -p "$RUN_CAP"
  RUN_LOG="$TEST_TMP/bwrap-$tag.log"
  : > "$RUN_LOG"
  local out="$TEST_TMP/out-$tag" err="$TEST_TMP/err-$tag"
  set +e
  REVIEW_LOOP_CONFIG_OVERRIDE="$cfg" ENGINE_CAPABILITY_DIR="$RUN_CAP" \
    AGY_CASE="$agy_case" BWRAP_LOG="$RUN_LOG" PATH="$WRAP:$PATH" \
    "$REVIEW" --runner agy --model "$CARBON" --effort high \
      --diff-file "$DIFF" --context-window off --timeout 30s --bin "$STUB" \
      >"$out" 2>"$err" < /dev/null
  RUN_RC=$?
  set -uo pipefail
  RUN_OUT="$(json_line "$(cat "$out")")"
  RUN_ERR="$err"
}

# (1) carbon rate-limited, argon ships. Policy fields omitted: the resolver default.
review_run "$CFG_DEFAULT" "retreat" "retreat"
assert_eq "$RUN_RC" "0" "retreat: exit 0"
assert_eq "$(jget "$RUN_OUT" status)" "reviewed" "retreat: status reviewed"
assert_eq "$(jget "$RUN_OUT" runner)" "agy" "retreat: runner stays agy"
assert_eq "$(jget "$RUN_OUT" model)" "$ARGON" "retreat: model is the argon rung"
assert_eq "$(jget "$RUN_OUT" verdict)" "SHIP-AS-IS" "retreat: argon verdict is accepted"
assert_eq "$(jget "$RUN_OUT" served_by)" "$SERVED" "retreat: served_by is the argon rung"
assert_eq "$(line_count "$RUN_LOG")" "2" "retreat: exactly 2 agy invocations"
assert_eq "$(grep -c -- '--model '"$CARBON" "$RUN_LOG" || true)" "1" "retreat: one carbon invocation"
assert_eq "$(grep -c -- '--model '"$ARGON" "$RUN_LOG" || true)" "1" "retreat: one argon invocation"
assert_contains "$(cat "$RUN_ERR")" "retreating once to cloud rung $SERVED" "retreat: stderr names the rung"
assert_eq "$(grep -c 'retreating once' "$RUN_ERR" || true)" "1" "retreat: one retreat line"
assert_eq "$(row_count "$RUN_CAP")" "1" "retreat: one cloud-fallbacks row"
RETREAT_ROW="$([ -f "$RUN_CAP/cloud-fallbacks.jsonl" ] && head -n 1 "$RUN_CAP/cloud-fallbacks.jsonl" || printf '%s' '{}')"
assert_eq "$(jget "$RETREAT_ROW" error_class)" "rate_limited" "retreat: row error_class"
assert_eq "$(jget "$RETREAT_ROW" from_runner)" "agy" "retreat: row from_runner"
assert_eq "$(jget "$RETREAT_ROW" from_endpoint)" "null" "retreat: row from_endpoint is null"
assert_eq "$(jget "$RETREAT_ROW" to_rung)" "$SERVED" "retreat: row to_rung"
assert_eq "$(jget "$RETREAT_ROW" served_by)" "$SERVED" "retreat: row served_by"
assert_eq "$(jget "$RETREAT_ROW" probe)" "null" "retreat: row probe is null"
assert_eq "$(jget "$RETREAT_ROW" outcome)" "reviewed" "retreat: row outcome is the final status"
FIRST_LOG="$(sed -n 's/^dispatch-review: agy retreat kept first-attempt raw log //p' "$RUN_ERR" | tail -n 1)"
SECOND_LOG="$(jget "$RUN_OUT" raw_log)"
assert_file_exists "$FIRST_LOG" "retreat: first raw log kept"
assert_file_exists "$SECOND_LOG" "retreat: second raw log kept"
assert_neq "$FIRST_LOG" "$SECOND_LOG" "retreat: the two raw logs are different files"
assert_contains "$(head -n 1 "$SECOND_LOG")" "$FIRST_LOG" "retreat: second log names the first"

# (2) carbon returns a normal verdict: one invocation, no retreat.
review_run "$CFG_DEFAULT" "ship" "ship"
assert_eq "$RUN_RC" "0" "ship: exit 0"
assert_eq "$(jget "$RUN_OUT" status)" "reviewed" "ship: status reviewed"
assert_eq "$(jget "$RUN_OUT" model)" "$CARBON" "ship: model stays carbon"
assert_eq "$(jget "$RUN_OUT" served_by)" "null" "ship: no served_by"
assert_eq "$(line_count "$RUN_LOG")" "1" "ship: exactly 1 agy invocation"
assert_not_contains "$(cat "$RUN_ERR")" "retreating once" "ship: no retreat line"
assert_eq "$(row_count "$RUN_CAP")" "0" "ship: no cloud-fallbacks row"

# (3) non-availability failure (garbage output): no retreat.
review_run "$CFG_DEFAULT" "garbage" "garbage"
assert_eq "$RUN_RC" "1" "garbage: exit 1"
assert_eq "$(jget "$RUN_OUT" status)" "no_verdict" "garbage: status no_verdict"
assert_eq "$(jget "$RUN_OUT" model)" "$CARBON" "garbage: model stays carbon"
assert_eq "$(jget "$RUN_OUT" served_by)" "null" "garbage: no served_by"
assert_eq "$(line_count "$RUN_LOG")" "1" "garbage: exactly 1 agy invocation"
assert_not_contains "$(cat "$RUN_ERR")" "retreating once" "garbage: no retreat line"
assert_eq "$(row_count "$RUN_CAP")" "0" "garbage: no cloud-fallbacks row"

# (4) argon also rate-limited: failure, two invocations, no third.
# The result schema has no "failure" status; a failed review is no_verdict, exit 1.
review_run "$CFG_DEFAULT" "both" "both-limited"
assert_eq "$RUN_RC" "1" "both limited: exit 1"
assert_eq "$(jget "$RUN_OUT" status)" "no_verdict" "both limited: status no_verdict"
assert_eq "$(jget "$RUN_OUT" model)" "$ARGON" "both limited: landed on the argon rung"
assert_eq "$(jget "$RUN_OUT" served_by)" "$SERVED" "both limited: served_by names the rung"
assert_eq "$(line_count "$RUN_LOG")" "2" "both limited: exactly 2 agy invocations, no third"
assert_eq "$(grep -c 'retreating once' "$RUN_ERR" || true)" "1" "both limited: one retreat line"
assert_eq "$(row_count "$RUN_CAP")" "1" "both limited: one cloud-fallbacks row"
BOTH_ROW="$([ -f "$RUN_CAP/cloud-fallbacks.jsonl" ] && head -n 1 "$RUN_CAP/cloud-fallbacks.jsonl" || printf '%s' '{}')"
assert_eq "$(jget "$BOTH_ROW" outcome)" "no_verdict" "both limited: row outcome is no_verdict"
assert_eq "$(jget "$BOTH_ROW" error_class)" "rate_limited" "both limited: row error_class"

# (5) policy explicitly ask: the rate limit does not retreat.
review_run "$CFG_ASK" "ask" "retreat"
assert_eq "$RUN_RC" "1" "ask: exit 1"
assert_eq "$(jget "$RUN_OUT" status)" "no_verdict" "ask: status no_verdict"
assert_eq "$(jget "$RUN_OUT" model)" "$CARBON" "ask: model stays carbon"
assert_eq "$(jget "$RUN_OUT" served_by)" "null" "ask: no served_by"
assert_eq "$(line_count "$RUN_LOG")" "1" "ask: exactly 1 agy invocation"
assert_not_contains "$(cat "$RUN_ERR")" "retreating once" "ask: no retreat line"
assert_eq "$(row_count "$RUN_CAP")" "0" "ask: no cloud-fallbacks row"

finalize_test
