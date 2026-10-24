#!/usr/bin/env bash
# Structural guard behind review_fresh_context=on (BL-0111, coordinator ruling C).
#
# The key's "on" promise is "a reviewer never continues an existing provider session". The review
# rail has no resume entry point, and this test is what proves it: dispatch-review.sh is run for
# each runner against a FAKE binary that records its argv, and no recorded argument may be a
# session-continuation flag, while claude-family runs must carry a --session-id that differs per run.
# If a resume entry is ever added to a review path, this test goes red and the key must then refuse
# it at dispatch (see project-config-template/review-loop-config.md, review_fresh_context).
#
# A grep over the review-dispatch sources backs the runtime check for argv builders the fake-binary
# runs cannot reach (the hetero-review-loop.js seat argv, review-fanout.js).
. "$(dirname "$0")/lib.sh"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"

DR="$REPO_ROOT/scripts/dispatch-review.sh"

# Fake runner: append every invocation's argv (one arg per line, runs separated) to $FAKE_ARGV_LOG.
FAKEBIN="$TEST_TMP/fakebin"; mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/fake-runner" <<'EOF'
#!/usr/bin/env bash
{ echo "--- argv"; for a in "$@"; do printf '%s\n' "$a"; done; } >> "$FAKE_ARGV_LOG"
cat > /dev/null 2>&1 || true
echo "VERDICT: SHIP-AS-IS"
exit 0
EOF
chmod +x "$FAKEBIN/fake-runner"
printf 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' > "$TEST_TMP/review.diff"
export AUTOPILOT_ENDPOINT_GUARDEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_GUARDEP_TOKEN="t"

RESUME_RE='^(--resume|--continue|resume|--resume-session|--session|--fork-session)$|^--resume=|^--continue='
# claude's short forms (-c continue, -r resume) are session flags; for codex -c is a config override,
# so the short forms only count on claude-family argv.
CLAUDE_SHORT_RE='^(-c|-r)$'

run_runner() { # <script> <runner> <model> <log>
  local script="$1" runner="$2" model="$3" log="$4"
  local -a ep=()
  [ "$runner" = cc-shim ] && ep=(--endpoint GUARDEP)
  FAKE_ARGV_LOG="$log" AUTOPILOT_SETTLE_MS=1 AUTOPILOT_GROK_EFFORT_PROBE="${AUTOPILOT_GROK_EFFORT_PROBE:-0}" timeout 120 bash "$script" --runner "$runner" --model "$model" \
    --effort high --diff-file "$TEST_TMP/review.diff" --timeout 60s --bin "$FAKEBIN/fake-runner" \
    ${ep[@]+"${ep[@]}"} >/dev/null 2>&1 < /dev/null
}
resume_hits() { # <log> <runner>
  {
    grep -E "$RESUME_RE" "$1" 2>/dev/null
    case "$2" in claude-native|cc-shim) grep -E "$CLAUDE_SHORT_RE" "$1" 2>/dev/null ;; esac
  } | sort -u | tr '\n' ' '
}

# "Observed" means the REAL review launch reached the fake binary, judged by an argument only that
# launch carries (an effort probe or --version call must not count): grok --prompt-file, codex exec,
# claude family --setting-sources.
launched() { # <log> <runner>
  case "$2" in
    grok) grep -qx -e '--prompt-file' "$1" ;;
    codex) grep -qx 'exec' "$1" ;;
    claude-native|cc-shim) grep -qx -e '--setting-sources' "$1" ;;
  esac
}

SEEN_RUNNERS=0
for spec in "claude-native:claude-haiku" "cc-shim:GLM-5.2" "codex:gpt-5.5" "grok:grok-4.5"; do
  runner="${spec%%:*}"; model="${spec#*:}"
  LOG="$TEST_TMP/argv-$runner.log"; : > "$LOG"
  run_runner "$DR" "$runner" "$model" "$LOG"
  if launched "$LOG" "$runner"; then
    SEEN_RUNNERS=$((SEEN_RUNNERS + 1))
    assert_eq "" "$(resume_hits "$LOG" "$runner")" "review rail ($runner): no session-continuation argument reaches the runner"
  else
    fail "review rail ($runner): the fake binary was never invoked, so the guard could not observe this runner's argv"
  fi
done
assert_eq "4" "$SEEN_RUNNERS" "guard observed the argv of all four runners (claude-native, cc-shim, codex, grok)"

# claude-family runners mint a brand-new --session-id on every dispatch
for runner in claude-native cc-shim; do
  model=claude-haiku; [ "$runner" = cc-shim ] && model=GLM-5.2
  L1="$TEST_TMP/sid1-$runner.log"; L2="$TEST_TMP/sid2-$runner.log"; : > "$L1"; : > "$L2"
  run_runner "$DR" "$runner" "$model" "$L1"; run_runner "$DR" "$runner" "$model" "$L2"
  S1="$(grep -A1 '^--session-id$' "$L1" | tail -1)"; S2="$(grep -A1 '^--session-id$' "$L2" | tail -1)"
  [ -n "$S1" ] && [ -n "$S2" ] || fail "review rail ($runner): no --session-id recorded in one of the runs"
  assert_neq "$S1" "$S2" "review rail ($runner): --session-id differs between two dispatches"
done

# Source-level backstop for argv builders the runtime runs above do not execute.
SRC_HITS="$(grep -nE -e '--resume|--continue|exec resume|resume-session' \
  "$REPO_ROOT/scripts/dispatch-review.sh" "$REPO_ROOT/scripts/hetero-review-loop.js" \
  "$REPO_ROOT/scripts/lib/review-fanout.js" "$REPO_ROOT/scripts/qc-panel.js" \
  "$REPO_ROOT/scripts/dispatch-plan-review.js" "$REPO_ROOT/scripts/dispatch-author.sh" 2>/dev/null | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(#|//)')"
assert_eq "" "$SRC_HITS" "review dispatch sources contain no resume/continue flag (comment lines excluded)"

# NEGATIVE CONTROL 1: a grok launch pointed at a nonexistent binary must NOT count as observed
# (the effort probe alone, if it ran, would otherwise make the guard look satisfied).
MUTG="$TEST_TMP/mutg"; mkdir -p "$MUTG"; cp -r "$REPO_ROOT/scripts" "$MUTG/scripts"
for d in src schemas references .claude-plugin; do [ -e "$REPO_ROOT/$d" ] && ln -s "$REPO_ROOT/$d" "$MUTG/$d"; done
sed_mutate "$MUTG/scripts/dispatch-review.sh" 's|"\$GROK_BIN" --prompt-file|/nonexistent/grok --prompt-file|'
LOGG="$TEST_TMP/argv-mutg.log"; : > "$LOGG"
AUTOPILOT_GROK_EFFORT_PROBE=1 run_runner "$MUTG/scripts/dispatch-review.sh" grok grok-4.5 "$LOGG"
if launched "$LOGG" grok; then fail "negative control: a grok launch to /nonexistent/grok still counted as observed"; else pass_msg=1; assert_eq "no" "no" "negative control: grok launch to a nonexistent binary is not counted as observed"; fi

# NEGATIVE CONTROL 2: a copy of the rail whose claude argv gains --resume must turn the guard red.
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp -r "$REPO_ROOT/scripts" "$MUT/scripts"
for d in src schemas references .claude-plugin; do [ -e "$REPO_ROOT/$d" ] && ln -s "$REPO_ROOT/$d" "$MUT/$d"; done
sed_mutate "$MUT/scripts/dispatch-review.sh" 's|exec "\$2" -p \${5:+--session-id "\$5"}|exec "$2" -p --resume 00000000-0000-4000-8000-000000000000 ${5:+--session-id "$5"}|'
LOGM="$TEST_TMP/argv-mut.log"; : > "$LOGM"
run_runner "$MUT/scripts/dispatch-review.sh" claude-native claude-haiku "$LOGM"
assert_contains "$(resume_hits "$LOGM" claude-native)" "--resume" "negative control: a --resume added to the claude argv is caught by the guard"

finalize_test
