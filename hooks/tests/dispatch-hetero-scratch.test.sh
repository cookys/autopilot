#!/usr/bin/env bash
# Restricted operator scratch isolation uses a stub Kimi runner only.
. "$(dirname "$0")/lib.sh"

TEST_NAME="dispatch-hetero-scratch"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_TEST_CN_GATE_OFF=0
export AUTOPILOT_ENDPOINT_MINIMAX_URL=https://api.minimax.example/v1
export AUTOPILOT_ENDPOINT_MINIMAX_TOKEN=fixture-token
export DISPATCH_DETACH=0 DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin" "$TEST_TMP/repo" "$TEST_TMP/runs"
git -C "$TEST_TMP/repo" init -q
git -C "$TEST_TMP/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
git -C "$TEST_TMP/repo" branch -m develop

STUB="$TEST_TMP/bin/claude"
cat > "$STUB" <<'STUB'
#!/usr/bin/env bash
pwd > "$STUB_CWD"
printf '%s\n' * > "$STUB_FILES"
printf 'scratch output\n' > produced.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
STUB
chmod +x "$STUB"
export STUB_CWD="$TEST_TMP/cwd" STUB_FILES="$TEST_TMP/files"

run_dispatch() {
  local tag="$1"; shift
  (cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-$tag" \
    "$SCRIPT" --no-verify-tip --context-window off --runner cc-shim --endpoint minimax \
      --model MiniMax-M2.5 --branch "feat/scratch-$tag" \
      --prompt-file "$TEST_TMP/$tag.md" "$@" >"$TEST_TMP/$tag.out" 2>"$TEST_TMP/$tag.err")
}

printf 'Create produced.txt with one line.\n' > "$TEST_TMP/allowed.md"
run_dispatch allowed --scratch
RC=$?
[ "$RC" -eq 0 ] || { cat "$TEST_TMP/allowed.out" "$TEST_TMP/allowed.err" >&2; }
assert_exit_code "$RC" 0 "scratch dispatch exits successfully"
assert_file_exists "$STUB_CWD" "stub records worker cwd"
WORKER_CWD="$(cat "$STUB_CWD")"
case "$WORKER_CWD" in *"$TEST_TMP/repo"*) fail "worker cwd is inside the repository" ;; esac
if git -C "$WORKER_CWD" rev-parse --show-toplevel >/dev/null 2>&1; then fail "worker cwd is inside a git tree"; fi
assert_contains "$(cat "$STUB_FILES")" "brief.md" "worker scratch initially contains the brief"
assert_eq "1" "$(git -C "$TEST_TMP/repo" show feat/scratch-allowed:produced.txt | wc -l | tr -d ' ')" "produced output was committed"
MF="$(printf '%s\n' "$TEST_TMP/runs-allowed"/*.manifest.json)"
assert_file_exists "$MF" "scratch dispatch writes a manifest"
assert_eq "1" "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scratch; process.stdout.write(String(s.files))' "$MF")" "manifest records captured scratch file count"

printf 'Create produced.txt.\n' > "$TEST_TMP/plain.md"
run_dispatch plain
RC=$?
assert_exit_code "$RC" 2 "non-scratch restricted dispatch is refused"
assert_contains "$(cat "$TEST_TMP/plain.out")$(cat "$TEST_TMP/plain.err")" \
  "restricted_operator_private_workdir" "non-scratch refusal identifies private workdir"

printf 'Contact service.internal before editing.\n' > "$TEST_TMP/private.md"
run_dispatch private --scratch
RC=$?
assert_exit_code "$RC" 2 "private host brief is refused"
assert_contains "$(cat "$TEST_TMP/private.out")$(cat "$TEST_TMP/private.err")" \
  "restricted_operator_brief_scan" "private host refusal identifies brief scan"

finalize_test
