#!/usr/bin/env bash
# Restricted operator scratch isolation uses stub Claude only.
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
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin" "$TEST_TMP/repo" "$TEST_TMP/runs" "$TEST_TMP/operator-home/.claude"
printf '{}\n' > "$TEST_TMP/operator-home/.claude/.credentials.json"
export HOME="$TEST_TMP/operator-home" CLAUDE_CONFIG_DIR="$TEST_TMP/operator-home/.claude"
git -C "$TEST_TMP/repo" init -q
git -C "$TEST_TMP/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
git -C "$TEST_TMP/repo" branch -m develop

STUB="$TEST_TMP/bin/claude"
cat > "$STUB" <<'STUB'
#!/usr/bin/env bash
pwd > "$STUB_CWD"
printf 'called\n' >> "$STUB_CALLS"
printf '%s\n' * > "$STUB_FILES"
printf '%s\n' "$HOME" "$CLAUDE_CONFIG_DIR" > "$STUB_ENV"
printf 'bad gitfile\n' > .git
mkdir -p nested/.git
printf 'nested metadata\n' > nested/.git/config
ln -s "$STUB_OUTSIDE" outside-link
printf 'normal nested file\n' > nested/normal.txt
printf 'scratch output\n' > produced.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
STUB
chmod +x "$STUB"
export STUB_CWD="$TEST_TMP/cwd" STUB_FILES="$TEST_TMP/files" STUB_ENV="$TEST_TMP/env" STUB_OUTSIDE="$TEST_TMP/outside" STUB_CALLS="$TEST_TMP/calls"
printf 'outside secret\n' > "$STUB_OUTSIDE"
mkdir -p "$REPO_ROOT/skills/scratch-fixture"
printf 'Contact skill-only.private before editing.\n' > "$REPO_ROOT/skills/scratch-fixture/SKILL.md"
cleanup_scratch_fixture() { rm -f -- "$REPO_ROOT/skills/scratch-fixture/SKILL.md"; rmdir "$REPO_ROOT/skills/scratch-fixture" 2>/dev/null || true; }
trap cleanup_scratch_fixture EXIT

run_dispatch() {
  local tag="$1"; shift
  (cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" TMPDIR=/tmp AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-$tag" \
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
assert_not_contains "$(cat "$STUB_FILES")" "claude-config" "worker dir excludes config sibling"
SCRATCH_ROOT="${WORKER_CWD%/work}"
assert_contains "$(cat "$STUB_ENV")" "$SCRATCH_ROOT/home" "Claude HOME is throwaway in scratch parent"
assert_contains "$(cat "$STUB_ENV")" "$SCRATCH_ROOT/claude-config-" "Claude config is throwaway in scratch parent"
assert_file_absent "$WORKER_CWD/../real-home" "scratch config does not reference real home"
assert_eq "1" "$(git -C "$TEST_TMP/repo" show feat/scratch-allowed:produced.txt | wc -l | tr -d ' ')" "produced output was committed"
MF="$(printf '%s\n' "$TEST_TMP/runs-allowed"/*.manifest.json)"
assert_file_exists "$MF" "scratch dispatch writes a manifest"
assert_eq "2" "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scratch; process.stdout.write(String(s.files))' "$MF")" "manifest records captured scratch file count"
git -C "$TEST_TMP/repo" rev-parse --show-toplevel >/dev/null 2>&1 || fail "scratch collection preserves worktree git metadata"
assert_eq "1" "$(git -C "$TEST_TMP/repo" show feat/scratch-allowed:nested/normal.txt | wc -l | tr -d ' ')" "normal nested scratch file was committed"
assert_eq "true" "$(node -e 'const cp=require("child_process");const r=cp.spawnSync("git",["-C",process.argv[1],"ls-tree","-r","--name-only","feat/scratch-allowed"],{encoding:"utf8"});if(r.status!==0)process.exit(2);process.stdout.write(String(!r.stdout.split("\n").some(x=>x.endsWith("/.git")||x===".git"||x==="outside-link")))' "$TEST_TMP/repo")" "scratch git metadata and symlink are absent from commit"
REJECTED="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scratch.rejected_manifest||"")' "$MF")"
assert_file_exists "$REJECTED" "rejected-path manifest is recorded"
assert_contains "$(cat "$REJECTED")" ".git" "manifest records git metadata rejection"
assert_contains "$(cat "$REJECTED")" "symlink" "manifest records symlink rejection"

for refused in agy grok codex qoderclicn opencode cursor kimi; do
  printf 'stub prompt\n' > "$TEST_TMP/refuse-$refused.md"
  before_scratch="$(find /tmp/autopilot-local-sbx-$(id -u) -maxdepth 1 -type d -name 'dispatch-hetero-scratch-*' 2>/dev/null | wc -l | tr -d ' ')"
  (cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-refuse-$refused" \
    "$SCRIPT" --no-verify-tip --context-window off --runner "$refused" --model "test-$refused" --branch "feat/refuse-$refused" \
      --prompt-file "$TEST_TMP/refuse-$refused.md" --scratch >"$TEST_TMP/refuse-$refused.out" 2>"$TEST_TMP/refuse-$refused.err")
  RC=$?
  assert_exit_code "$RC" 2 "$refused scratch runner is refused"
  assert_contains "$(cat "$TEST_TMP/refuse-$refused.out")$(cat "$TEST_TMP/refuse-$refused.err")" "WORKER_CWD" "$refused refusal explains runner constraint"
  after_scratch="$(find /tmp/autopilot-local-sbx-$(id -u) -maxdepth 1 -type d -name 'dispatch-hetero-scratch-*' 2>/dev/null | wc -l | tr -d ' ')"
  assert_eq "$before_scratch" "$after_scratch" "$refused refusal creates no scratch directory"
done


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

printf 'Clean public brief.\n' > "$TEST_TMP/skill-private.md"
run_dispatch skill-private --scratch --skill-mode prompt --skill scratch-fixture
RC=$?
assert_exit_code "$RC" 2 "skill-pack-only private marker is refused"
assert_contains "$(cat "$TEST_TMP/skill-private.out")$(cat "$TEST_TMP/skill-private.err")" \
  "restricted_operator_brief_scan" "final assembled skill prompt is scanned"
assert_eq "1" "$(wc -l < "$STUB_CALLS" | tr -d ' ')" "skill-only private marker is blocked before Claude starts"

printf 'Create kimi-produced.txt.\n' > "$TEST_TMP/kimi.md"
(cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" TMPDIR=/tmp AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-kimi-bin" \
  "$SCRIPT" --no-verify-tip --context-window off --runner kimi --kimi-bin "$TEST_TMP/bin/kimi" --model MiniMax-M2.5 \
    --branch feat/scratch-kimi-bin --prompt-file "$TEST_TMP/kimi.md" --scratch >"$TEST_TMP/kimi.out" 2>"$TEST_TMP/kimi.err")
RC=$?
assert_exit_code "$RC" 2 "kimi-bin passes scratch runner gate but existing local stop blocks spawn"
assert_contains "$(cat "$TEST_TMP/kimi.out")$(cat "$TEST_TMP/kimi.err")" "kimi_local_stopped" "kimi-bin is not refused for ignoring WORKER_CWD"

finalize_test
