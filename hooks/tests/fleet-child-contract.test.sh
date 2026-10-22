#!/usr/bin/env bash
# BL-0251 -- a claude child a rail launches declares itself to fleet: child_session_mint (scripts/lib/repo-identity.sh)
# exports FLEET_LIFETIME=ephemeral (always, an inherited durable is overridden), FLEET_PARENT (the launching CC session
# id when no FLEET_PARENT is inherited) and FLEET_ROLE (review-seat for dispatch-review, hand for author/hetero).
# Seams: a stub claude that dumps its environment; no fleet binary is ever called and no fleet message is sent.
# RED at 7d6c745be: 1 passed, 19 failed (stub claude env has FLEET_LIFETIME/FLEET_PARENT/FLEET_ROLE all empty for author, review, hetero; durable stays durable; mint unit prints "||").
. "$(dirname "$0")/lib.sh"
export AUTOPILOT_TEST_ALLOW_HETERO_SEAMS=1
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-fcc-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1 AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID \
  AUTOPILOT_CHILD_SESSION_ID AUTOPILOT_SESSION_MODE_DIR FLEET_LIFETIME FLEET_PARENT FLEET_ROLE \
  GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL 2>/dev/null || true

AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX/.claude"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
SBX="$(cd "$SBX" && pwd -P)"
P="pppppppp-1111-2222-3333-444444444444"
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"
DUMPS="$TEST_TMP/dumps"; mkdir -p "$DUMPS"
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "claude 9.9.9 (test stub)"; exit 0; fi
env | LC_ALL=C sort > "${STUB_DUMP:?}"
[ -t 0 ] || timeout 2 cat >/dev/null 2>&1 || true
echo "ok"
exit 0
EOS
chmod +x "$BINDIR/claude"

# run_rail <tag> <extra env assignment> <cmd...>: launcher is session P; dump = the stub claude's environment
run_rail() {
  local tag="$1" extra="$2"; shift 2
  E_DUMP="$DUMPS/$tag.env"; rm -f "$E_DUMP"
  mkdir -p "$TEST_TMP/m-$tag" "$TEST_TMP/r-$tag"
  ( cd "$SBX" && timeout 120 env -u REPO_ROOT -u CONSUMING_REPO_ROOT "$extra" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/r-$tag" \
      AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/m-$tag" STUB_DUMP="$E_DUMP" \
      ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$P" \
      "$@" >"$E_DUMP.out" 2>&1 ) || true
}
dv() { grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-; }
# check <label> <role> <dump>
check() {
  local label="$1" role="$2" d="$3"
  if [ ! -f "$d" ]; then fail "$label: the stub claude never ran (not_run): $(tail -c 300 "$d.out" 2>/dev/null | tr '\n' ' ')"; return; fi
  eq "ephemeral" "$(dv "$d" FLEET_LIFETIME)" "$label: FLEET_LIFETIME == ephemeral"
  eq "$P" "$(dv "$d" FLEET_PARENT)" "$label: FLEET_PARENT == the launching session"
  eq "$role" "$(dv "$d" FLEET_ROLE)" "$label: FLEET_ROLE == $role"
}

run_rail author-native X_UNUSED=1 "$AUTHOR" --runner claude-native --model claude-haiku --prompt-file "$PROMPT" --bin "$BINDIR/claude" --timeout 60s
check "author claude-native" hand "$E_DUMP"
run_rail author-ccshim X_UNUSED=1 "$AUTHOR" --runner cc-shim --model MiniMax-M3 --prompt-file "$PROMPT" --bin "$BINDIR/claude" --timeout 60s
check "author cc-shim" hand "$E_DUMP"
run_rail review-native X_UNUSED=1 "$REVIEW" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude"
check "review claude-native" review-seat "$E_DUMP"
run_rail review-ccshim X_UNUSED=1 "$REVIEW" --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file "$DIFF" --bin "$BINDIR/claude"
check "review cc-shim" review-seat "$E_DUMP"
run_rail hetero X_UNUSED=1 bash "$HETERO" --runner cc-shim --model MiniMax-M3 --effort high --branch feat/fcc-h --prompt-file "$PROMPT" --run-id fcc-h
check "hetero cc-shim" hand "$E_DUMP"
# an inherited durable lifetime never survives: a child is never promoted to durable
run_rail review-durable FLEET_LIFETIME=durable "$REVIEW" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude"
check "review with inherited FLEET_LIFETIME=durable" review-seat "$E_DUMP"
# an inherited FLEET_PARENT (a fleet address) wins over the CC session id
run_rail review-parent FLEET_PARENT=ns/courier/member "$REVIEW" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude"
eq "ns/courier/member" "$(dv "$E_DUMP" FLEET_PARENT)" "inherited FLEET_PARENT is kept"

# the mint function itself: role argument, default role, idempotence
out="$(env -u FLEET_ROLE -u FLEET_PARENT -u FLEET_LIFETIME CLAUDE_CODE_SESSION_ID="$P" bash -c '. "$1"; child_session_mint; echo "$FLEET_LIFETIME|$FLEET_PARENT|$FLEET_ROLE"; child_session_mint x; echo "$FLEET_ROLE"' _ "$REPO_ROOT/scripts/lib/repo-identity.sh")"
eq "ephemeral|$P|child"$'\n'"x" "$out" "child_session_mint: defaults and role argument"

finalize_test
