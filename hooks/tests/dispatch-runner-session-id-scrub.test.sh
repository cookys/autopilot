#!/usr/bin/env bash
# dispatch-runner-session-id-scrub.test.sh — a dispatch rail launches its runner as a CHILD session,
# so the caller's explicit AUTOPILOT_SESSION_ID must never reach it: session-mode.js getSessionId()
# prefers that variable, and a child that inherits it writes its marker (size/stage/root_run_id)
# over the PARENT session's. Every case exports AUTOPILOT_SESSION_ID=parent-x, launches a stub
# runner through the real rail, and asserts the stub's own env dump (a) exists — the stub really ran,
# so absence is not vacuous — and (b) does not carry the variable.
#
#   1  dispatch-hetero.sh  --runner cc-shim            (run_worker choke point)
#   2  dispatch-review.sh  --runner claude-native
#   3  dispatch-author.sh  --runner claude-native      (also the transport dispatch-consult rides)
#   4  dispatch-foreman.sh (kimi stub; AUTOPILOT_* allowlist + --env-passthrough)
#   5  dispatch-explore.sh --runner codex
#   6  the rail's own job-root lookup still sees the binding (legit read is preserved)
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH CLAUDE_CODE_SESSION_ID 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL

export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_SESSION_ID="parent-x"
export AUTOPILOT_SETTLE_MS=0
export DISPATCH_QUIET=1

SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
printf 'secret.env\n' > "$SBX/.gitignore"
git -C "$SBX" add .gitignore && git -C "$SBX" -c user.email=t@t -c user.name=t commit -q -m gitignore
PROMPT="$TEST_TMP/prompt.txt"; echo "create ok.txt" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+def f(): return x[::1]\n' > "$DIFF"

# A claude-shaped stub: dumps its own env, drains stdin, prints something harmless.
make_stub() { # <path> <env-dump-file>
  cat > "$1" <<EOF
#!/usr/bin/env bash
env | LC_ALL=C sort > "$2"
cat >/dev/null 2>&1 || true
echo "stub ran"
EOF
  chmod +x "$1"
}
# check_scrubbed <label> <dump>
check_scrubbed() {
  assert_file_exists "$2" "$1: the stub runner actually ran (env dump exists)"
  assert_contains "$(cat "$2" 2>/dev/null)" "PATH=" "$1: env dump is a real env"
  assert_not_contains "$(cat "$2" 2>/dev/null)" "AUTOPILOT_SESSION_ID" "$1: child runner does NOT see AUTOPILOT_SESSION_ID"
  assert_not_contains "$(cat "$2" 2>/dev/null)" "parent-x" "$1: parent id value absent from child env"
}

# ================================================================= 1 dispatch-hetero (cc-shim)
H_DUMP="$TEST_TMP/hetero.env"
make_stub "$TEST_TMP/hetero-claude" "$H_DUMP"
mkdir -p "$TEST_TMP/hetero-bin"; ln -sf "$TEST_TMP/hetero-claude" "$TEST_TMP/hetero-bin/claude"
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
(cd "$SBX" && PATH="$TEST_TMP/hetero-bin:$PATH" DISPATCH_DETACH=0 \
  bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model mini --endpoint TESTEP \
  --branch feat/sid-scrub --prompt-file "$PROMPT" >"$TEST_TMP/hetero.out" 2>&1)
check_scrubbed "1 hetero cc-shim" "$H_DUMP"

# ================================================================= 2 dispatch-review (claude-native)
R_DUMP="$TEST_TMP/review.env"
make_stub "$TEST_TMP/review-claude" "$R_DUMP"
bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner claude-native --model claude-fable-5 \
  --diff-file "$DIFF" --bin "$TEST_TMP/review-claude" >"$TEST_TMP/review.out" 2>&1
check_scrubbed "2 review claude-native" "$R_DUMP"

# ================================================================= 3 dispatch-author (claude-native)
A_DUMP="$TEST_TMP/author.env"
make_stub "$TEST_TMP/author-claude" "$A_DUMP"
printf 'Return a small JSON object.\n' > "$TEST_TMP/author-prompt.txt"
(cd "$SBX" && bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner claude-native --model claude-fable-5 \
  --prompt-file "$TEST_TMP/author-prompt.txt" --bin "$TEST_TMP/author-claude" --timeout 10s \
  >"$TEST_TMP/author.out" 2>&1)
check_scrubbed "3 author claude-native" "$A_DUMP"

# ================================================================= 4 dispatch-foreman (kimi stub)
FSD="$TEST_TMP/foreman-stub"; mkdir -p "$FSD" "$TEST_TMP/foreman-bin"
cat > "$TEST_TMP/foreman-bin/kimi" <<'STUB'
#!/usr/bin/env bash
env | LC_ALL=C sort >> "$KIMI_STUB_DIR/env.all"
echo '{"role":"meta","type":"system.version","version":"0.41.0"}'
printf 'done: x\nnot done: (none)\n' > "$KIMI_STUB_REPORT_DIR/REPORT.md"
printf '{"role":"assistant","content":"DONE"}\n'
STUB
chmod +x "$TEST_TMP/foreman-bin/kimi"
echo "brief" > "$TEST_TMP/brief.md"; echo "plan" > "$TEST_TMP/plan.md"
# Both ways the variable could be handed over: the AUTOPILOT_* allowlist and an explicit passthrough.
(cd "$SBX" && PATH="$TEST_TMP/foreman-bin:$PATH" KIMI_STUB_DIR="$FSD" KIMI_STUB_REPORT_DIR="$TEST_TMP/foreman-run" \
  AUTOPILOT_KEEP_ME=kept \
  bash "$REPO_ROOT/scripts/dispatch-foreman.sh" --brief-file "$TEST_TMP/brief.md" --plan-file "$TEST_TMP/plan.md" \
  --run-id sidscrub --run-dir "$TEST_TMP/foreman-run" --poll 0.2 --env-passthrough AUTOPILOT_SESSION_ID \
  --env-passthrough AUTOPILOT_KEEP_ME >"$TEST_TMP/foreman.out" 2>&1)
check_scrubbed "4 foreman" "$FSD/env.all"
assert_contains "$(cat "$FSD/env.all" 2>/dev/null)" "AUTOPILOT_KEEP_ME=kept" "4 foreman: other AUTOPILOT_* still pass the allowlist (the exclusion is targeted)"

# ================================================================= 5 dispatch-explore (codex)
E_DUMP="$TEST_TMP/explore.env"
cat > "$TEST_TMP/explore-codex" <<EOF
#!/usr/bin/env bash
env | LC_ALL=C sort > "$E_DUMP"
echo "stub ran"
EOF
chmod +x "$TEST_TMP/explore-codex"
echo "explore the repo" > "$TEST_TMP/explore-prompt.txt"
(cd "$SBX" && bash "$REPO_ROOT/scripts/dispatch-explore.sh" --runner codex --model gpt-5.5 \
  --prompt-file "$TEST_TMP/explore-prompt.txt" --repo "$SBX" --bin "$TEST_TMP/explore-codex" --timeout 30s --no-probe \
  >"$TEST_TMP/explore.out" 2>&1)
check_scrubbed "5 explore codex" "$E_DUMP"

# ================================================================= 6 legit read preserved
# session-mode.js itself must still honour the explicit binding when a caller sets it (that is the
# managed/controller contract; only the CHILD-runner spawn is scrubbed).
SID_OUT="$(AUTOPILOT_SESSION_ID=parent-x node -e 'console.log(require(process.argv[1]).getSessionId())' "$REPO_ROOT/scripts/session-mode.js" 2>/dev/null)"
assert_eq "$SID_OUT" "parent-x" "6: session-mode getSessionId() still prefers AUTOPILOT_SESSION_ID for its own caller"

finalize_test
