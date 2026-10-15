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
#   6  the rail's own job-root lookup still sees the binding: cases 1-3 also assert the manifest's
#      root_run_id is the PARENT session's job root, reachable ONLY through AUTOPILOT_SESSION_ID here
#      (no CLAUDE_CODE_SESSION_ID), so moving a rail's unset before its job-root lookup goes red
#   7  dispatch-hetero run_worker: all six launch branches, each forced and asserted separately
#      (cgroup, setsid --wait, plain+setsid, plain no-setsid, detached+setsid, detached no-setsid)
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
LIVE_FIX="$(mktemp -d -p /dev/shm autopilot-test-sidscrub-XXXXXX)"; chmod 700 "$LIVE_FIX"
export AUTOPILOT_LIVE_DIR="$LIVE_FIX"
trap 'rm -rf "$LIVE_FIX"; cleanup_test_tmp' EXIT
RUNS="$TEST_TMP/runs"; mkdir -p "$RUNS"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS"

SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
printf 'secret.env\n' > "$SBX/.gitignore"
git -C "$SBX" add .gitignore && git -C "$SBX" -c user.email=t@t -c user.name=t commit -q -m gitignore
PROMPT="$TEST_TMP/prompt.txt"; echo "create ok.txt" > "$PROMPT"
# The parent session's marker. It is addressable ONLY through AUTOPILOT_SESSION_ID (CLAUDE_CODE_SESSION_ID
# is unset above), so a rail whose job-root lookup no longer sees the variable mints its own root instead.
AUTOPILOT_SESSION_ID=parent-x node "$REPO_ROOT/scripts/session-mode.js" set --level l3 --repo-root "$SBX" >/dev/null 2>&1
MROOT="$(node -e 'process.stdout.write(String(require(process.argv[1]).root_run_id||""))' "$AUTOPILOT_SESSION_MODE_DIR/parent-x.json" 2>/dev/null)"
case "$MROOT" in job-*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) ;; *) fail "setup: parent marker minted a job root (got '$MROOT')" ;; esac
mroot_of() { node -e 'process.stdout.write(String(require(process.argv[1]).root_run_id))' "$RUNS/$1.manifest.json" 2>/dev/null; }
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
  # dispatch-tree 3b rule 3: the parent's id legitimately reaches the child, but ONLY as AUTOPILOT_PARENT_SESSION_ID
  # (read-only provenance); under any other name it would be a write target for the child's own marker.
  # ...and its value is the launcher's write target (here the explicit binding), resolved before the rail's own scrub:
  # a rail that resolves it after `unset AUTOPILOT_SESSION_ID` hands the child the cwd id instead.
  assert_contains "$(cat "$2" 2>/dev/null)" "AUTOPILOT_PARENT_SESSION_ID=parent-x" "$1: AUTOPILOT_PARENT_SESSION_ID == the launcher's write target (parent-x)"
  assert_not_contains "$(grep -v '^AUTOPILOT_PARENT_SESSION_ID=' "$2" 2>/dev/null)" "parent-x" "$1: parent id value absent from child env (outside AUTOPILOT_PARENT_SESSION_ID)"
}

# ================================================================= 1 dispatch-hetero (cc-shim)
make_hstub() { # env dump path comes from $SID_DUMP so one stub serves every forced branch
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
env | LC_ALL=C sort > "$SID_DUMP"
cat >/dev/null 2>&1 || true
echo "stub ran"
EOF
  chmod +x "$1"
}
make_hstub "$TEST_TMP/hetero-claude"
mkdir -p "$TEST_TMP/hetero-bin"; ln -sf "$TEST_TMP/hetero-claude" "$TEST_TMP/hetero-bin/claude"
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
REAL_SETSID="$(command -v setsid)"
# Knobs that force a run_worker branch: a failing systemd-run => HAVE_CGROUP=0; a setsid shim whose --help
# lacks --wait => HAVE_SETSID=0 while a plain `setsid env ...` still works; HETERO_TEST_NO_SETSID=1 => no setsid.
NOCG_BIN="$TEST_TMP/nocg-bin"; mkdir -p "$NOCG_BIN"
printf '#!/usr/bin/env bash\nexit 1\n' > "$NOCG_BIN/systemd-run"; chmod +x "$NOCG_BIN/systemd-run"
NOWAIT_BIN="$TEST_TMP/nowait-bin"; mkdir -p "$NOWAIT_BIN"
cp "$NOCG_BIN/systemd-run" "$NOWAIT_BIN/systemd-run"
cat > "$NOWAIT_BIN/setsid" <<EOF
#!/usr/bin/env bash
[ "\${1:-}" = "--help" ] && { echo "usage: setsid [options] program"; exit 0; }
exec "$REAL_SETSID" "\$@"
EOF
chmod +x "$NOWAIT_BIN/setsid"
HN=0
# hetero_case <label> <PATH prefix or ""> <detached 0|1> [extra env assignment]
hetero_case() {
  local label="$1" pfx="$2" detached="$3" extra="${4:-X_UNUSED=1}"
  HN=$((HN+1)); local id="sid-h$HN" dump="$TEST_TMP/hetero-$HN.env" led="$TEST_TMP/hetero-ledger-$HN.jsonl"
  local -a coords=(); local detach_flag=0
  if [ "$detached" = 1 ]; then
    bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$led" >/dev/null
    coords=(--ledger "$led" --run-id "$id" --stage implement); detach_flag=1
  else
    coords=(--run-id "$id")
  fi
  (cd "$SBX" && env "$extra" SID_DUMP="$dump" DISPATCH_DETACH="$detach_flag" \
    PATH="${pfx:+$pfx:}$TEST_TMP/hetero-bin:$PATH" \
    bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model mini --endpoint TESTEP \
    --branch "feat/$id" --prompt-file "$PROMPT" "${coords[@]}" >"$TEST_TMP/hetero-$HN.out" 2>&1)
  check_scrubbed "$label" "$dump"
}
hetero_case "1a hetero cgroup/default branch" "" 0
assert_eq "$(mroot_of sid-h1)" "$MROOT" "1a hetero: manifest root_run_id is the parent session's job root"
# 1b is the `setsid --wait` branch: dispatch-hetero only takes it when the host's setsid exists AND
# its --help mentions --wait (HAVE_SETSID). Without that it silently runs the plain no-setsid branch
# under a label that claims otherwise, so skip it visibly like 1c and 4 (BL-0184).
if [ -n "$REAL_SETSID" ] && "$REAL_SETSID" --help 2>&1 | grep -q -- --wait; then
  hetero_case "1b hetero setsid --wait branch" "$NOCG_BIN" 0
else
  echo "SKIP [dispatch-runner-session-id-scrub] 1b hetero setsid --wait branch: no setsid with --wait on this host"
fi
# 1c wraps the host's real setsid in a shim; a host without one has nothing to wrap (BL-0135).
if [ -n "$REAL_SETSID" ]; then
  hetero_case "1c hetero plain+setsid branch" "$NOWAIT_BIN" 0
else
  echo "SKIP [dispatch-runner-session-id-scrub] 1c hetero plain+setsid branch: no setsid on this host"
fi
hetero_case "1d hetero plain no-setsid branch" "$NOCG_BIN" 0 HETERO_TEST_NO_SETSID=1
hetero_case "1e hetero detached+setsid branch" "" 1
hetero_case "1f hetero detached no-setsid branch" "" 1 HETERO_TEST_NO_SETSID=1

# ================================================================= 2 dispatch-review (claude-native)
R_DUMP="$TEST_TMP/review.env"
make_stub "$TEST_TMP/review-claude" "$R_DUMP"
bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner claude-native --model claude-fable-5 \
  --diff-file "$DIFF" --bin "$TEST_TMP/review-claude" --run-id sid-review >"$TEST_TMP/review.out" 2>&1
check_scrubbed "2 review claude-native" "$R_DUMP"
assert_eq "$(mroot_of sid-review)" "$MROOT" "2 review: manifest root_run_id is the parent session's job root (lookup still saw the binding)"

# 2b: the in-process (non-claude) runner branch is covered by child_session_apply_env, not by an `env` wrapper.
# claude-native above is covered by the explicit env, so only a codex runner turns red when that call is removed.
R2_DUMP="$TEST_TMP/review-codex.env"
cat > "$TEST_TMP/review-codex" <<EOF2
#!/usr/bin/env bash
env | LC_ALL=C sort > "$R2_DUMP"
echo "stub ran"
EOF2
chmod +x "$TEST_TMP/review-codex"
bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-5.5 \
  --diff-file "$DIFF" --bin "$TEST_TMP/review-codex" --run-id sid-review-codex >"$TEST_TMP/review-codex.out" 2>&1
check_scrubbed "2b review codex (in-process runner)" "$R2_DUMP"

# ================================================================= 3 dispatch-author (claude-native)
A_DUMP="$TEST_TMP/author.env"
make_stub "$TEST_TMP/author-claude" "$A_DUMP"
printf 'Return a small JSON object.\n' > "$TEST_TMP/author-prompt.txt"
(cd "$SBX" && bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner claude-native --model claude-fable-5 \
  --prompt-file "$TEST_TMP/author-prompt.txt" --bin "$TEST_TMP/author-claude" --timeout 10s --run-id sid-author \
  >"$TEST_TMP/author.out" 2>&1)
check_scrubbed "3 author claude-native" "$A_DUMP"
assert_eq "$(mroot_of sid-author)" "$MROOT" "3 author: manifest root_run_id is the parent session's job root (lookup still saw the binding)"

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
# dispatch-foreman.sh refuses to run without setsid (process-group containment), so the case needs one.
if [ -n "$REAL_SETSID" ]; then
  (cd "$SBX" && PATH="$TEST_TMP/foreman-bin:$PATH" KIMI_STUB_DIR="$FSD" KIMI_STUB_REPORT_DIR="$TEST_TMP/foreman-run" \
    AUTOPILOT_KEEP_ME=kept \
    bash "$REPO_ROOT/scripts/dispatch-foreman.sh" --brief-file "$TEST_TMP/brief.md" --plan-file "$TEST_TMP/plan.md" \
    --run-id sidscrub --run-dir "$TEST_TMP/foreman-run" --poll 0.2 --env-passthrough AUTOPILOT_SESSION_ID \
    --env-passthrough AUTOPILOT_KEEP_ME >"$TEST_TMP/foreman.out" 2>&1)
  check_scrubbed "4 foreman" "$FSD/env.all"
  assert_contains "$(cat "$FSD/env.all" 2>/dev/null)" "AUTOPILOT_KEEP_ME=kept" "4 foreman: other AUTOPILOT_* still pass the allowlist (the exclusion is targeted)"
else
  echo "SKIP [dispatch-runner-session-id-scrub] 4 foreman: no setsid on this host"
fi

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

finalize_test
