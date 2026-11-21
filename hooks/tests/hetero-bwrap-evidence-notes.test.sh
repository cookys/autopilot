#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
if ! command -v bwrap >/dev/null || ! bwrap --ro-bind / / -- true < /dev/null 2>/dev/null; then
  echo 'SKIP: bwrap is not usable on this host'
  exit 0
fi
export AUTOPILOT_TEST_CN_GATE_OFF=1 DISPATCH_QUIET=1 AUTOPILOT_ENDPOINT_PREPROBE=off
export HOME="$TEST_TMP/home" CLAUDE_CONFIG_DIR="$TEST_TMP/config" TMPDIR="$TEST_TMP/tmp"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs" AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
export ANTHROPIC_BASE_URL=http://127.0.0.1:9/v1 ANTHROPIC_AUTH_TOKEN=t
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$TMPDIR" "$AUTOPILOT_DISPATCH_RUNS_DIR" "$AUTOPILOT_SESSION_MODE_DIR" "$ENGINE_CAPABILITY_DIR" "$AUTOPILOT_LIVE_DIR" "$TEST_TMP/bin" "$TEST_TMP/repo" "$TEST_TMP/wts"
git -C "$TEST_TMP/repo" init -q -b develop
echo base > "$TEST_TMP/repo/tracked"
git -C "$TEST_TMP/repo" add tracked
git -C "$TEST_TMP/repo" -c user.name=t -c user.email=t@t commit -qm base
cat > "$TEST_TMP/bin/claude" <<'STUB'
#!/usr/bin/env bash
cat >/dev/null
printf 'stub evidence text\n' > "$AUTOPILOT_EVIDENCE_NOTES" || printf 'stub evidence text\n' > evidence-notes.md
echo edited >> tracked
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
STUB
chmod +x "$TEST_TMP/bin/claude"
echo 'edit tracked' > "$TEST_TMP/prompt"
rc=0
(cd "$TEST_TMP/repo" && env -u REPO_ROOT -u CONSUMING_REPO_ROOT PATH="$TEST_TMP/bin:$PATH" "$REPO_ROOT/scripts/dispatch-hetero.sh" --no-verify-tip --runner cc-shim --model MiniMax-M3 --prompt-file "$TEST_TMP/prompt" --context-window off --branch fix/evidence --sandbox bwrap --worktree-parent "$TEST_TMP/wts" --keep-worktree --retain-owner test --retain-reason test --retain-until 4070908800 > "$TEST_TMP/out" 2> "$TEST_TMP/err") || rc=$?
[ "$rc" -eq 0 ] || cat "$TEST_TMP/err" "$TEST_TMP/out"
assert_eq 0 "$rc" 'dispatch succeeds'
assert_eq '' "$(git -C "$TEST_TMP/repo" ls-tree -r --name-only fix/evidence | rg '(^|/)evidence-notes\.md$' || true)" 'notes absent from committed tree'
assert_eq '' "$(rg --files --hidden "$TEST_TMP/wts" -g evidence-notes.md || true)" 'notes absent from worktree'
assert_contains "$(git -C "$TEST_TMP/repo" log -1 --format=%B fix/evidence)" 'stub evidence text' 'commit body contains notes'
finalize_test
