#!/usr/bin/env bash
# A plan-review seat whose runner fails must say why. Two real failures once came back as a bare
# exit 3 with nothing else: codex refused the model ("gpt-5.5 not supported with ChatGPT account")
# and a MiniMax seat had no MINIMAX_API_KEY. Everything here is a shim on PATH plus FAKE- tokens;
# no live model, no network, and the real endpoint credential file is never read.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
PLAN_REPO="$TEST_TMP/repo"
STATE_DIR="$TEST_TMP/state"
BIN_DIR="$TEST_TMP/bin"
CALLS="$TEST_TMP/runner-calls"
mkdir -p "$PLAN_REPO" "$BIN_DIR"
git -C "$PLAN_REPO" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' >"$PLAN_REPO/plan.md"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' >"$PLAN_REPO/rubric.md"

# The endpoint credential file and the credential env vars are pinned away from the host.
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"
unset MINIMAX_API_KEY AUTOPILOT_MINIMAX_BASE_URL ANTHROPIC_COMPATIBLE_AUTH_TOKEN ANTHROPIC_COMPATIBLE_BASE_URL
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

# codex shim: answers --version/--help like the real one, refuses the model on a real run.
cat >"$BIN_DIR/codex" <<'SHIM'
#!/usr/bin/env bash
[ "${1:-}" = "--version" ] && { echo "codex-cli 0.test.0"; exit 0; }
for a in "$@"; do [ "$a" = "--help" ] && { echo "Usage: codex exec [--output-last-message PATH]"; exit 0; }; done
echo run >> "$SHIM_CALLS"
cat >/dev/null
echo "ERROR: gpt-5.5 not supported with ChatGPT account $SHIM_TOKEN" >&2
exit 1
SHIM
# claude shim for the cc-shim runner: only records that it was started.
cat >"$BIN_DIR/claude" <<'SHIM'
#!/usr/bin/env bash
echo run >> "$SHIM_CALLS"
exit 0
SHIM
chmod +x "$BIN_DIR/codex" "$BIN_DIR/claude"
export SHIM_CALLS="$CALLS"
export SHIM_TOKEN="sk-""FAKE0123456789abcdefghijklmnop"

manifest() { # <file> <id> <runner> <model> <endpoint>
  cat >"$1" <<JSON
{ "schema_version": 1, "artifact_type": "plan_review_manifest", "logical_plan_id": "$2",
  "minimum_distinct_families": 1, "max_attempts_per_seat": 2,
  "seats": [ { "id": "chair", "runner": "$3", "model": "$4", "effort": "high", "endpoint": "$5",
    "role": "chair", "family": "fixture", "readiness_status": "ready",
    "qualification_status": "qualified", "required": true, "excluded_families": [], "fallbacks": [] } ] }
JSON
}

run_review() { # <manifest> <ticket>
  PATH="$BIN_DIR:$PATH" node "$SCRIPT" --repo-root "$PLAN_REPO" --plan-file "$PLAN_REPO/plan.md" \
    --rubric-file "$PLAN_REPO/rubric.md" --ticket "$2" --session-id "s-$2" --generation 1 \
    --manifest-file "$1" --state-dir "$STATE_DIR" --timeout 60s </dev/null 2>"$TEST_TMP/review.stderr"
}

# 1. dispatch-author itself: the codex stderr line reaches the result JSON (it used to be dropped).
printf 'prompt\n' >"$TEST_TMP/prompt.txt"
: >"$CALLS"
AOUT="$(cd "$PLAN_REPO" && PATH="$BIN_DIR:$PATH" DISPATCH_QUIET=1 DISPATCH_DETACH=0 "$AUTHOR" --runner codex \
  --model gpt-5.5 --prompt-file "$TEST_TMP/prompt.txt" --repo-root "$PLAN_REPO" --timeout 60s </dev/null 2>/dev/null)"
assert_contains "$AOUT" 'gpt-5.5 not supported with ChatGPT account' "dispatch-author: codex stderr line is in the result"
assert_not_contains "$AOUT" "$SHIM_TOKEN" "dispatch-author: the token-shaped string is redacted"

# 2. plan review: the failed codex seat's attempt record and the dispatcher's stderr carry the line.
manifest "$TEST_TMP/m-codex.json" staleconf-codex codex gpt-5.5 default
: >"$CALLS"
OUT="$(run_review "$TEST_TMP/m-codex.json" staleconf-codex)"
ERR="$(cat "$TEST_TMP/review.stderr")"
assert_contains "$OUT" 'gpt-5.5 not supported with ChatGPT account' "plan-review: artifact attempt carries the runner error"
assert_contains "$ERR" 'gpt-5.5 not supported with ChatGPT account' "plan-review: dispatcher stderr carries the runner error"
assert_contains "$ERR" 'seat chair' "plan-review: stderr names the seat"
assert_not_contains "$OUT$ERR" "$SHIM_TOKEN" "plan-review: redacted in artifact and stderr"

# 3. MiniMax seat without MINIMAX_API_KEY fails before the run, names seat/engine/model/variable.
manifest "$TEST_TMP/m-minimax.json" staleconf-minimax cc-shim MiniMax-M3 minimax
: >"$CALLS"
OUT="$(run_review "$TEST_TMP/m-minimax.json" staleconf-minimax)"
ERR="$(cat "$TEST_TMP/review.stderr")"
assert_eq "$(wc -l <"$CALLS" | tr -d ' ')" "0" "minimax: the runner was never invoked"
for needle in 'MINIMAX_API_KEY' 'chair' 'cc-shim' 'MiniMax-M3'; do
  assert_contains "$OUT" "$needle" "minimax: artifact names $needle"
  assert_contains "$ERR" "$needle" "minimax: dispatcher stderr names $needle"
done

finalize_test
