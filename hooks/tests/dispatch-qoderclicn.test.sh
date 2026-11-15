#!/usr/bin/env bash
# qoderclicn is explicit-only. A stub via --qoder-bin records argv and stdin.
# Never invokes the real qoderclicn binary.
export AUTOPILOT_TEST_CN_GATE_OFF=1
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
export AUTOPILOT_CONTEXT_WINDOW_GATE=off
export AUTOPILOT_SETTLE_MS=0
export DISPATCH_QUIET=1
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
mkdir -p "$ENGINE_CAPABILITY_DIR"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
printf 'qoder stub prompt token ALPHA\n' > "$PROMPT"
DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

has_arg() { # file needle
  grep -qxF -- "$2" "$1"
}

# Implementer stub: one argv per line, stdin bytes saved. Exit 0 with no edit.
STUB="$TEST_TMP/qoder-stub"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${QODER_ARGV_FILE:?}"
cat > "${QODER_STDIN_FILE:?}"
exit 0
EOF
chmod +x "$STUB"

# Reviewer stub: argv + a well-formed verdict frame echoed from the stdin prompt.
RSTUB="$TEST_TMP/qoder-review-stub"
cat > "$RSTUB" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${QODER_ARGV_FILE:?}"
prompt="$(cat)"
printf '%s' "$prompt" > "${QODER_STDIN_FILE:?}"
begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
if [ "${QODER_STUB_MODE:-pass}" = "subst" ]; then
  echo 'Model "qwen" is not available right now; using auto instead' >&2
fi
printf '%s\n' "$begin" \
  "VERDICT: SHIP-AS-IS" \
  "FINDINGS: none" \
  "NO-FINDING-PROOF: checked=diff and supplied acceptance criteria; evidence=the changed slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed" \
  "$end"
exit 0
EOF
chmod +x "$RSTUB"

ARGV="$TEST_TMP/impl.argv"
STDIN="$TEST_TMP/impl.stdin"
rm -f "$ARGV" "$STDIN"
OUT="$(cd "$SBX" && timeout 90 env QODER_ARGV_FILE="$ARGV" QODER_STDIN_FILE="$STDIN" \
  "$HETERO" --no-verify-tip --runner qoderclicn --model qwen3-coder --effort high \
  --qoder-bin "$STUB" --branch "feat/qoder-$RANDOM" --prompt-file "$PROMPT" --timeout 30s \
  2>&1)" || true
assert_file_exists "$ARGV" "implementer stub was invoked"
for flag in -p --model -w --reasoning-effort --dangerously-skip-permissions --no-session-persistence; do
  has_arg "$ARGV" "$flag" || fail "implementer argv missing $flag"
done
has_arg "$ARGV" "--config-dir" && fail "implementer argv has --config-dir without --qoder-config-dir"
has_arg "$ARGV" "qwen3-coder" || fail "implementer argv missing model"
has_arg "$ARGV" "high" || fail "implementer argv missing effort"
assert_contains "$(cat "$STDIN")" "qoder stub prompt token ALPHA" "implementer prompt is on stdin"
assert_not_contains "$(cat "$ARGV")" "-o" "implementer argv has no -o json"

CFG="$TEST_TMP/qoder-cfg"
mkdir -p "$CFG"
ARGV2="$TEST_TMP/impl2.argv"
STDIN2="$TEST_TMP/impl2.stdin"
rm -f "$ARGV2" "$STDIN2"
OUT="$(cd "$SBX" && timeout 90 env QODER_ARGV_FILE="$ARGV2" QODER_STDIN_FILE="$STDIN2" \
  "$HETERO" --no-verify-tip --runner qoderclicn --model qwen3-coder --effort high \
  --qoder-bin "$STUB" --qoder-config-dir "$CFG" --branch "feat/qoder-cfg-$RANDOM" \
  --prompt-file "$PROMPT" --timeout 30s 2>&1)" || true
assert_file_exists "$ARGV2" "implementer stub invoked with config dir"
has_arg "$ARGV2" "--config-dir" || fail "implementer argv missing --config-dir"
has_arg "$ARGV2" "$CFG" || fail "implementer argv missing config dir path"

OUT="$(cd "$SBX" && timeout 30 "$HETERO" --no-verify-tip --runner auto --model Qwen3-Coder \
  --branch "feat/qoder-auto-$RANDOM" --prompt-file "$PROMPT" 2>&1)" || true
assert_contains "$OUT" "auto-routing cannot route Qwen model id 'Qwen3-Coder' (no Qwen cloud runner) — pass --runner cc-shim --endpoint <name> explicitly" \
  "auto + qwen still dies with the fail-closed message"

OUT="$(cd "$SBX" && timeout 30 "$HETERO" --no-verify-tip --runner qoderclicn --model qwen3-coder \
  --qoder-bin "$TEST_TMP/no-such-qoderclicn" --branch "feat/qoder-miss-$RANDOM" \
  --prompt-file "$PROMPT" 2>&1)" || true
assert_contains "$OUT" "qoder binary not found: $TEST_TMP/no-such-qoderclicn (install Qoder CLI CN or pass --qoder-bin)" \
  "missing qoder binary names the precondition"

RARGV="$TEST_TMP/rev.argv"
RSTDIN="$TEST_TMP/rev.stdin"
rm -f "$RARGV" "$RSTDIN"
OUT="$(timeout 90 env QODER_ARGV_FILE="$RARGV" QODER_STDIN_FILE="$RSTDIN" QODER_STUB_MODE=pass \
  "$REVIEW" --runner qoderclicn --model qwen3-coder --effort high --diff-file "$DIFF" \
  --qoder-bin "$RSTUB" --timeout 30s 2>&1)" || true
EXIT=$?
assert_file_exists "$RARGV" "reviewer stub was invoked"
for flag in -p --model -w --reasoning-effort --dangerously-skip-permissions --no-session-persistence; do
  has_arg "$RARGV" "$flag" || fail "reviewer argv missing $flag"
done
has_arg "$RARGV" "--tools" || fail "reviewer argv missing --tools"
# --tools "" is an empty argv element
grep -qxF -- '--tools' "$RARGV" || fail "reviewer argv missing --tools flag"
awk 'prev=="--tools" && $0=="" { found=1 } { prev=$0 } END { exit !found }' "$RARGV" \
  || fail "reviewer --tools is not the empty allow-list"
has_arg "$RARGV" "--config-dir" && fail "reviewer argv has --config-dir without the flag"
grep -qxF -- '-o' "$RARGV" && fail "reviewer argv must not pass -o json"
assert_contains "$(cat "$RSTDIN")" "AUTOPILOT-REVIEW-" "reviewer prompt is on stdin"
assert_eq "0" "$EXIT" "reviewer stub output parses"
assert_contains "$OUT" '"status": "reviewed"' "reviewer status reviewed"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "reviewer parses SHIP-AS-IS"
assert_contains "$OUT" '"runner": "qoderclicn"' "reviewer runner provenance"

RARGV3="$TEST_TMP/rev3.argv"
RSTDIN3="$TEST_TMP/rev3.stdin"
rm -f "$RARGV3" "$RSTDIN3"
OUT="$(timeout 90 env QODER_ARGV_FILE="$RARGV3" QODER_STDIN_FILE="$RSTDIN3" \
  "$REVIEW" --runner qoderclicn --model qwen3-coder --diff-file "$DIFF" \
  --qoder-bin "$RSTUB" --qoder-config-dir "$CFG" --timeout 30s 2>&1)" || true
assert_file_exists "$RARGV3" "reviewer stub invoked with config dir"
has_arg "$RARGV3" "--config-dir" || fail "reviewer argv missing --config-dir"
has_arg "$RARGV3" "$CFG" || fail "reviewer argv missing config dir path"

OUT="$(timeout 30 "$REVIEW" --runner qoderclicn --model qwen3-coder --diff-file "$DIFF" \
  --qoder-bin "$TEST_TMP/no-such-qoderclicn" --timeout 15s 2>&1)" || true
assert_contains "$OUT" "qoder binary not found: $TEST_TMP/no-such-qoderclicn (Qoder CLI CN)" \
  "review missing binary names the precondition"

finalize_test
