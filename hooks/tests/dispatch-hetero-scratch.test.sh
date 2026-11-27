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
export AUTOPILOT_CN_WORK_TIER=T0
export AUTOPILOT_ENDPOINT_MINIMAX_URL=https://api.minimax.example
export AUTOPILOT_ENDPOINT_MINIMAX_TOKEN=fixture-token
export DISPATCH_DETACH=0 DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin" "$TEST_TMP/repo" "$TEST_TMP/runs" "$TEST_TMP/operator-home/.claude"
printf '{}\n' > "$TEST_TMP/operator-home/.claude/.credentials.json"
export HOME="$TEST_TMP/operator-home" CLAUDE_CONFIG_DIR="$TEST_TMP/operator-home/.claude"
git -C "$TEST_TMP/repo" init -q
git -C "$TEST_TMP/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
git -C "$TEST_TMP/repo" branch -m develop
printf 'repo-owned README\n' > "$TEST_TMP/repo/README.md"
printf 'private source marker one two three four five six seven eight nine ten\n' > "$TEST_TMP/repo/SOURCE.txt"  # shingle index needs >= 8 words of tracked text
git -C "$TEST_TMP/repo" add README.md SOURCE.txt
git -C "$TEST_TMP/repo" -c user.email=t@t -c user.name=t commit -q -m 'base README'

STUB="$TEST_TMP/bin/claude"
cat > "$STUB" <<'STUB'
#!/usr/bin/env bash
pwd > "$STUB_CWD"
printf 'called\n' >> "$STUB_CALLS"
printf '%s\n' * > "$STUB_FILES"
printf '%s\n' "$HOME" "$CLAUDE_CONFIG_DIR" > "$STUB_ENV"
if [ "${STUB_MODE:-}" = regression ]; then
  printf 'worker README\n' > README.md
  printf 'worker output\n' > worker-output.txt
  printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
  exit 0
fi
if [ "${STUB_MODE:-}" = no-write ]; then
  printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
  exit 0
fi
(
  shopt -s globstar dotglob nullglob
  for reachable in ../**/*; do [ -f "$reachable" ] && printf '%s\n' "$reachable"; done
) > "$STUB_REACHABLE"
if [ -n "${STUB_WAIT_DIR:-}" ]; then
  printf '%s\n' "$PWD" > "$STUB_WAIT_DIR/worker-cwd"
  while [ ! -e "$STUB_WAIT_DIR/release" ]; do sleep 0.1; done
fi
printf 'bad gitfile\n' > .git
mkdir -p nested/.git
printf 'nested metadata\n' > nested/.git/config
ln -s "$STUB_OUTSIDE" outside-link
printf 'hardlinked fixture\n' > hardlink-source.txt
ln hardlink-source.txt hardlink-copy.txt
printf 'normal nested file\n' > nested/normal.txt
printf 'scratch output\n' > produced.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
STUB
chmod +x "$STUB"
export STUB_CWD="$TEST_TMP/cwd" STUB_FILES="$TEST_TMP/files" STUB_ENV="$TEST_TMP/env" STUB_OUTSIDE="$TEST_TMP/outside" STUB_CALLS="$TEST_TMP/calls" STUB_REACHABLE="$TEST_TMP/reachable"
printf 'fixture credential\n' > "$TEST_TMP/operator-home/.claude/.credentials.json"
printf 'fixture config marker\n' > "$TEST_TMP/operator-home/.claude/config-marker.json"
printf 'outside fixture\n' > "$STUB_OUTSIDE"
mkdir -p "$REPO_ROOT/skills/scratch-fixture"
printf 'Contact skill-only.private before editing.\n' > "$REPO_ROOT/skills/scratch-fixture/SKILL.md"
cleanup_scratch_fixture() { rm -rf -- "$XDG_RUNTIME_DIR"; rm -f -- "$REPO_ROOT/skills/scratch-fixture/SKILL.md"; rmdir "$REPO_ROOT/skills/scratch-fixture" 2>/dev/null || true; }
trap cleanup_scratch_fixture EXIT

# The restricted-operator gate takes only the clean-sandbox brief template and one --source-repo (d-38676fad).
# The shingle index lives on a tmpfs runtime dir; a bare shell has no XDG_RUNTIME_DIR, so the suite brings its own.
XDG_RUNTIME_DIR="$(mktemp -d /dev/shm/autopilot-test-scratch-XXXXXX)"; export XDG_RUNTIME_DIR
# The sandbox HOME hides the real fleet store, so the Fleet-Task open check would say not_found; probe- callers are exempt.
export AUTOPILOT_DISPATCH_ROLE=probe-dispatch-hetero-scratch
write_brief() { printf 'Brief-Class: clean-sandbox\nTask: %s\nInputs: None.\nOutput: One file.\nLimits: None.\n' "$2" > "$1"; }

run_dispatch() {
  local tag="$1"; shift
  (cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" TMPDIR=/tmp AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-$tag" \
    "$SCRIPT" --no-verify-tip --context-window off --runner cc-shim --pin-reason "test fixture" --endpoint minimax \
      --model MiniMax-M2.5 --branch "feat/scratch-$tag" --source-repo "$TEST_TMP/repo" --scaffold-tier off \
      --prompt-file "$TEST_TMP/$tag.md" "$@" >"$TEST_TMP/$tag.out" 2>"$TEST_TMP/$tag.err")
}

write_brief "$TEST_TMP/regression.md" 'Overwrite README and create one file.'
STUB_MODE=regression run_dispatch regression --scratch
RC=$?
assert_exit_code "$RC" 0 "scratch README regression dispatch exits successfully"
REGRESSION_COMMIT="$(git -C "$TEST_TMP/repo" rev-parse feat/scratch-regression)"
REGRESSION_PARENTS="$(git -C "$TEST_TMP/repo" rev-list --parents -n1 "$REGRESSION_COMMIT" | wc -w | tr -d ' ')"
assert_eq "1" "$REGRESSION_PARENTS" "scratch commit has no parent"
REGRESSION_TREE="$(git -C "$TEST_TMP/repo" ls-tree -r --name-only "$REGRESSION_COMMIT" | sort | tr '\n' ' ')"
assert_eq "README.md worker-output.txt " "$REGRESSION_TREE" "scratch commit contains exactly worker files"
assert_eq "repo-owned README" "$(git -C "$TEST_TMP/repo" show develop:README.md)" "base README remains unchanged"
assert_eq "worker README" "$(git -C "$TEST_TMP/repo" show "$REGRESSION_COMMIT:README.md")" "scratch commit references worker README"
REGRESSION_MANIFEST="$(printf '%s\n' "$TEST_TMP/runs-regression"/*.manifest.json)"
assert_eq "orphan" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scratch.base)' "$REGRESSION_MANIFEST")" "scratch manifest records orphan base"

write_brief "$TEST_TMP/no-write.md" 'Write nothing.'
STUB_MODE=no-write run_dispatch no-write --scratch
RC=$?
assert_exit_code "$RC" 1 "empty scratch dispatch keeps its existing no-op exit code"
assert_contains "$(cat "$TEST_TMP/no-write.out")" '"status": "no_op"' "empty scratch dispatch remains no_op"

write_brief "$TEST_TMP/allowed.md" 'Create produced.txt with one line.'
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
assert_contains "$(cat "$STUB_ENV")" "$SCRATCH_ROOT/claude-config-empty" "Claude config is empty throwaway config in scratch parent"
assert_file_absent "$WORKER_CWD/../real-home" "scratch config does not reference real home"
assert_not_contains "$(cat "$STUB_REACHABLE")" ".credentials.json" "worker cannot reach fixture credentials"
assert_not_contains "$(cat "$STUB_REACHABLE")" "config-marker.json" "worker cannot reach fixture Claude config"
assert_file_absent "$SCRATCH_ROOT/claude-config-empty/.credentials.json" "fixture credentials are never copied into scratch"
assert_file_absent "$SCRATCH_ROOT/claude-config-empty/config-marker.json" "fixture config is never copied into scratch"
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
assert_contains "$(cat "$REJECTED")" "hardlink-copy.txt" "manifest records hardlink rejection path"
assert_contains "$(cat "$REJECTED")" "hardlink" "manifest records hardlink rejection reason"
assert_file_absent "$TEST_TMP/repo/hardlink-copy.txt" "hardlinked file is not collected"

# The detached child keeps scratch alive after the caller exits, then owns cleanup.
DETACH_WAIT="$TEST_TMP/detach-wait"
mkdir -p "$DETACH_WAIT"
export STUB_WAIT_DIR="$DETACH_WAIT"
write_brief "$TEST_TMP/detached.md" 'Create detached output.'
(cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" TMPDIR=/tmp DISPATCH_DETACH=1 \
  AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-detached" \
  "$SCRIPT" --no-verify-tip --context-window off --runner cc-shim --pin-reason "test fixture" --endpoint minimax \
    --model MiniMax-M2.5 --branch feat/scratch-detached --source-repo "$TEST_TMP/repo" --scaffold-tier off --prompt-file "$TEST_TMP/detached.md" --scratch \
    >"$TEST_TMP/detached.out" 2>"$TEST_TMP/detached.err") &
DETACH_PARENT=$!
for _ in $(seq 1 300); do [ -f "$DETACH_WAIT/worker-cwd" ] && break; sleep 0.1; done
assert_file_exists "$DETACH_WAIT/worker-cwd" "detached worker reached scratch"
DETACH_CWD="$(cat "$DETACH_WAIT/worker-cwd")"
DETACH_SCRATCH="${DETACH_CWD%/work}"
kill -TERM "$DETACH_PARENT" 2>/dev/null || true
wait "$DETACH_PARENT" 2>/dev/null || true
assert_file_exists "$DETACH_SCRATCH/work/brief.md" "parent exit leaves scratch available to child"
: > "$DETACH_WAIT/release"
for _ in $(seq 1 300); do [ ! -e "$DETACH_SCRATCH" ] && break; sleep 0.1; done
assert_file_absent "$DETACH_SCRATCH" "detached child removes scratch on completion"
unset STUB_WAIT_DIR

for refused in agy grok codex qoderclicn opencode cursor kimi claude-native; do
  printf 'stub prompt\n' > "$TEST_TMP/refuse-$refused.md"
  scratch_parent="/tmp/autopilot-local-sbx-$(id -u)"
  shopt -s nullglob
  scratch_dirs=("$scratch_parent"/dispatch-hetero-scratch-*)
  before_scratch="${#scratch_dirs[@]}"
  (cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-refuse-$refused" \
    "$SCRIPT" --no-verify-tip --context-window off --runner "$refused" --pin-reason "test fixture" --model "test-$refused" --branch "feat/refuse-$refused" \
      --prompt-file "$TEST_TMP/refuse-$refused.md" --scratch >"$TEST_TMP/refuse-$refused.out" 2>"$TEST_TMP/refuse-$refused.err")
  RC=$?
  assert_exit_code "$RC" 2 "$refused scratch runner is refused"
  assert_contains "$(cat "$TEST_TMP/refuse-$refused.out")$(cat "$TEST_TMP/refuse-$refused.err")" "WORKER_CWD" "$refused refusal explains runner constraint"
  scratch_dirs=("$scratch_parent"/dispatch-hetero-scratch-*)
  after_scratch="${#scratch_dirs[@]}"
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

write_brief "$TEST_TMP/skill-private.md" 'Clean public brief.'
CALLS_BEFORE_SKILL_PRIVATE="$(wc -l < "$STUB_CALLS" | tr -d ' ')"
run_dispatch skill-private --scratch --skill-mode prompt --skill scratch-fixture
RC=$?
assert_exit_code "$RC" 2 "skill-pack-only private marker is refused"
assert_contains "$(cat "$TEST_TMP/skill-private.out")$(cat "$TEST_TMP/skill-private.err")" \
  "restricted_operator_brief_scan" "final assembled skill prompt is scanned"
assert_eq "$CALLS_BEFORE_SKILL_PRIVATE" "$(wc -l < "$STUB_CALLS" | tr -d ' ')" "skill-only private marker is blocked before Claude starts"

write_brief "$TEST_TMP/kimi.md" 'Create kimi-produced.txt.'
(cd "$TEST_TMP/repo" && PATH="$TEST_TMP/bin:$PATH" TMPDIR=/tmp AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-kimi-bin" \
  "$SCRIPT" --no-verify-tip --context-window off --runner kimi --pin-reason "test fixture" --kimi-bin "$TEST_TMP/bin/kimi" --model MiniMax-M2.5 \
    --branch feat/scratch-kimi-bin --source-repo "$TEST_TMP/repo" --scaffold-tier off --prompt-file "$TEST_TMP/kimi.md" --scratch >"$TEST_TMP/kimi.out" 2>"$TEST_TMP/kimi.err")
RC=$?
assert_exit_code "$RC" 2 "kimi-bin passes scratch runner gate but existing local stop blocks spawn"
assert_contains "$(cat "$TEST_TMP/kimi.out")$(cat "$TEST_TMP/kimi.err")" "kimi_local_stopped" "kimi-bin is not refused for ignoring WORKER_CWD"

finalize_test
