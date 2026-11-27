#!/usr/bin/env bash
# Target repository pre-commit is checked in a disposable worktree after capture.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
export HOME="$TEST_TMP/home" CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_GROK_EFFORT_PROBE=0 AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/capability"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"
export TMPDIR="$TEST_TMP/tmp"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$ENGINE_CAPABILITY_DIR" "$AUTOPILOT_LIVE_DIR" "$AUTOPILOT_DISPATCH_RUNS_DIR" "$TMPDIR"
export ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN=t

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf 'make a small edit\n' > "$PROMPT"
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/grok" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then
  printf 'Available models\n\ncursor-grok-4.6-high - Grok 4.6 (high)\n'
  exit 0
fi
if [ "${1:-}" = "--version" ]; then echo stub; exit 0; fi
cat >/dev/null
printf '%s\n' "${STUB_CONTENT:-clean edit}" > result.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
STUB
chmod +x "$BINDIR/grok"

json_field() {
  node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8")); let v=o; for(const k of process.argv[1].split("."))v=v==null?undefined:v[k]; process.stdout.write(v===undefined?"<absent>":JSON.stringify(v));' "$1"
}
last_json() { printf '%s\n' "$1" | sed -n '/^{/h; ${x;p;}' ; }
new_target() {
  TARGET="$TEST_TMP/target-$1"
  mkdir -p "$TARGET"
  git -C "$TARGET" init -q -b develop
  git -C "$TARGET" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
}
run_case() { # case-name + environment assignments in RUN_ENV array
  local name="$1"; shift
  local branch="feat/tpc-$name-$RANDOM" out rc=0
  out="$(cd "$TARGET" && timeout 30 env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
    PATH="$BINDIR:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-$name" \
    AUTOPILOT_WORKTREE_ROOT="$TEST_TMP/wts-$name" STUB_CONTENT="${CONTENT:-clean edit}" \
    "$@" "$SCRIPT" --no-verify-tip --runner grok --pin-reason "test fixture" --model cursor-grok-4.6 --grok-bin "$BINDIR/grok" \
    --branch "$branch" --prompt-file "$PROMPT" --timeout 15s 2>"$TEST_TMP/$name.err")" || rc=$?
  OUT="$out"; RC="$rc"; JSON="$(last_json "$OUT")"
  [ -n "$JSON" ] || fail "$name: missing result JSON (rc=$RC) stderr=$(cat "$TEST_TMP/$name.err")"
  BRANCH="$branch"
}
check_result() {
  assert_eq "$(printf '%s' "$JSON" | json_field status)" "\"$1\"" "$3 status"
  assert_eq "$(printf '%s' "$JSON" | json_field target_precommit.status)" "\"$2\"" "$3 target_precommit.status"
}

# Negative control: force the check off. The same forbidden change then commits, proving the
# hook fixture detects the exact violation this check must block.
new_target negative
mkdir -p "$TARGET/.git/hooks"
cat > "$TARGET/.git/hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
git diff --cached --name-only -z | xargs -0 -r grep -l FORBIDDEN >/dev/null && exit 1
HOOK
chmod +x "$TARGET/.git/hooks/pre-commit"
AUTOPILOT_TARGET_PRECOMMIT_TEST_SKIP=1 CONTENT=FORBIDDEN run_case negative
assert_eq "$(printf '%s' "$JSON" | json_field status)" '"committed"' "negative control bypass allows forbidden staged content"
assert_eq "$(printf '%s' "$JSON" | json_field target_precommit.status)" '"skipped"' "negative control bypass is visible"
echo "NEGATIVE CONTROL RED: bypassed target hook; FORBIDDEN commit status=$(printf '%s' "$JSON" | json_field status)"

# (a) A failing hook keeps the captured commit and does not dirty the target checkout.
new_target forbidden
mkdir -p "$TARGET/.git/hooks"
cat > "$TARGET/.git/hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
git diff --cached --name-only -z | xargs -0 -r grep -l FORBIDDEN >/dev/null && exit 1
HOOK
chmod +x "$TARGET/.git/hooks/pre-commit"
CONTENT=FORBIDDEN run_case forbidden
check_result target_precommit_failed fail forbidden
assert_eq "$(printf '%s' "$JSON" | json_field target_precommit.rc)" '1' "forbidden rc"
case "$(printf '%s' "$JSON" | json_field error)" in *pre-commit*".git/hooks/pre-commit"*) : ;; *) fail "failure result does not name hook: $(printf '%s' "$JSON" | json_field error)" ;; esac
assert_eq "$(git -C "$TARGET" show-ref --verify --quiet "refs/heads/$BRANCH" && echo true || echo false)" 'true' "forbidden branch commit remains"
assert_eq "$(git -C "$TARGET" status --porcelain)" '' "forbidden main checkout clean"
MANIFEST="$(rg --files "$TEST_TMP/runs-forbidden" 2>/dev/null | head -n 1)"
[ -n "$MANIFEST" ] || fail "forbidden manifest missing"
assert_eq "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify(o.target_precommit && o.target_precommit.status));' "$MANIFEST")" '"fail"' "forbidden manifest status"

# (b) Passing target hook leaves dispatch success unchanged.
new_target passing
mkdir -p "$TARGET/.git/hooks"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TARGET/.git/hooks/pre-commit"; chmod +x "$TARGET/.git/hooks/pre-commit"
run_case passing
check_result committed pass passing
assert_eq '"pass"' "$(printf '%s' "$JSON" | json_field target_precommit.status)" "passing hook status"

# (c) No executable target hook is explicitly recorded as absent.
new_target absent
run_case absent
assert_eq '"absent"' "$(printf '%s' "$JSON" | json_field target_precommit.status)" "absent hook status"

# (d) A hook exceeding the configured 2 s bound times out promptly.
new_target timeout
mkdir -p "$TARGET/.git/hooks"
printf '#!/usr/bin/env bash\nsleep 8\n' > "$TARGET/.git/hooks/pre-commit"; chmod +x "$TARGET/.git/hooks/pre-commit"
start=$(date +%s)
AUTOPILOT_TARGET_PRECOMMIT_TIMEOUT_S=2 run_case timeout
elapsed=$(( $(date +%s) - start ))
assert_eq '"timeout"' "$(printf '%s' "$JSON" | json_field target_precommit.status)" "timeout status"
assert_eq "$(printf '%s' "$JSON" | json_field target_precommit.rc)" '124' "timeout rc"
assert_eq '"target_precommit_failed"' "$(printf '%s' "$JSON" | json_field status)" "timeout run status"
[ "$elapsed" -lt 15 ] || fail "timeout case exceeded wall cap (${elapsed}s)"

# (e) Hook build output stays confined to the disposable worktree.
new_target artifact
mkdir -p "$TARGET/.git/hooks"
printf '#!/usr/bin/env bash\necho built > build-artifact.txt\nexit 0\n' > "$TARGET/.git/hooks/pre-commit"; chmod +x "$TARGET/.git/hooks/pre-commit"
run_case artifact
assert_eq '"pass"' "$(printf '%s' "$JSON" | json_field target_precommit.status)" "artifact hook pass"
assert_file_absent "$TARGET/build-artifact.txt" "target checkout has no hook artifact"
WT="$(printf '%s' "$JSON" | json_field worktree | tr -d '"')"
[ -z "$WT" ] || assert_file_absent "$WT/build-artifact.txt" "dispatch worktree has no hook artifact"

# (f) Explicit opt-out must not execute the hook.
new_target skipped
mkdir -p "$TARGET/.git/hooks"
printf '#!/usr/bin/env bash\necho ran > %q\n' "$TEST_TMP/hook-marker" > "$TARGET/.git/hooks/pre-commit"; chmod +x "$TARGET/.git/hooks/pre-commit"
AUTOPILOT_TARGET_PRECOMMIT=off run_case skipped
assert_eq '"skipped"' "$(printf '%s' "$JSON" | json_field target_precommit.status)" "opt-out status"
assert_file_absent "$TEST_TMP/hook-marker" "opt-out hook not run"

# Config-file opt-out works too; a relative core.hooksPath resolves from the target checkout.
new_target config
mkdir -p "$TARGET/.custom-hooks"
git -C "$TARGET" config core.hooksPath .custom-hooks
printf '#!/usr/bin/env bash\nexit 0\n' > "$TARGET/.custom-hooks/pre-commit"; chmod +x "$TARGET/.custom-hooks/pre-commit"
printf '{"target_precommit":"on"}\n' > "$TEST_TMP/target-config.json"
AUTOPILOT_CONFIG_FILE="$TEST_TMP/target-config.json" run_case config
assert_eq '"pass"' "$(printf '%s' "$JSON" | json_field target_precommit.status)" "config opt-in status"
assert_eq '".custom-hooks/pre-commit"' "$(printf '%s' "$JSON" | json_field target_precommit.hook)" "relative hooksPath resolves at target root"

finalize_test
