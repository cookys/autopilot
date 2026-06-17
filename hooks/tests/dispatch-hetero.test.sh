#!/usr/bin/env bash
# dispatch-hetero.sh integration test — exercises the full worktree flow with a
# PATH-stubbed fake `agy` (no network, no real Antigravity, NO live LLM). Covers:
# preconditions (exit 2), committed path (exit 0, worktree auto-removed,
# branch survives), and the four no-/abnormal-commit outcomes split by exit code:
#   (a) exit 0 + commit          → success     (status committed, exit 0)
#   (b) non-zero exit + commit   → failure     (status failure,   exit 1)
#   (c) exit 0 + no commit       → no_op        (status no_op,      exit 1)
#   (d) timeout/non-zero + none  → QUESTION_SUSPECTED (status question_suspected, exit 1)
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"

# --- sandbox git repo (never touch the real repo with worktrees/branches) ---
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"

# --- stub agy: commits one file (ignores all flags, like a cooperative agent) ---
STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: smoke"
echo "self-report: DONE"
EOF
chmod +x "$STUB_OK"

# --- stub agy (c): clean exit, no commit → no_op ---
STUB_NOOP="$TEST_TMP/agy-noop"
printf '#!/usr/bin/env bash\necho "did nothing"\nexit 0\n' > "$STUB_NOOP"
chmod +x "$STUB_NOOP"

# --- stub agy (d): non-zero exit (proxy for timeout/stall), no commit → question_suspected ---
STUB_QUESTION="$TEST_TMP/agy-question"
printf '#!/usr/bin/env bash\necho "Which file should I edit?"\nexit 124\n' > "$STUB_QUESTION"
chmod +x "$STUB_QUESTION"

# --- stub agy (b): commits cleanly then exits non-zero → failure (NOT success) ---
STUB_FAIL_COMMIT="$TEST_TMP/agy-fail-commit"
cat > "$STUB_FAIL_COMMIT" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: committed then errored"
echo "post-commit error" >&2
exit 3
EOF
chmod +x "$STUB_FAIL_COMMIT"

# 1. --help exits 0 and mentions the worktree rail
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "worktree" "--help mentions worktree"

# 2. missing --branch → precondition_failed, exit 2
OUT="$(cd "$SBX" && "$SCRIPT" --prompt-file "$PROMPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --branch exit code"
assert_contains "$OUT" '"status": "precondition_failed"' "missing --branch status"

# 3. missing agy binary → precondition_failed, exit 2
OUT="$(cd "$SBX" && "$SCRIPT" --branch t1 --prompt-file "$PROMPT" --agy-bin /nonexistent-agy 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing binary exit code"
assert_contains "$OUT" "not found" "missing binary error text"

# 4. committed path: stub commits → exit 0, JSON committed, branch survives, worktree removed
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/smoke --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "committed path exit code"
assert_contains "$OUT" '"status": "committed"' "committed status"
assert_contains "$OUT" '"files_changed": 1' "committed diff stat"
assert_contains "$OUT" '"worktree": null' "worktree auto-removed on success"
BRANCH_EXISTS="$(git -C "$SBX" rev-parse --verify --quiet refs/heads/feat/smoke >/dev/null && echo yes || echo no)"
assert_eq "yes" "$BRANCH_EXISTS" "branch survives for review/merge"
SMOKE_CONTENT="$(git -C "$SBX" show feat/smoke:ok.txt)"
assert_eq "ok" "$SMOKE_CONTENT" "artifact verifiable from branch"

# 5. duplicate branch → precondition_failed (exit 2)
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/smoke --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "duplicate branch exit code"
assert_contains "$OUT" "branch already exists" "duplicate branch error"

# 5b. dirty path: stub commits then leaves an unstaged file → exit 1, status dirty, worktree kept
STUB_DIRTY="$TEST_TMP/agy-dirty"
cat > "$STUB_DIRTY" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: partial"
echo leftover > unstaged.txt
EOF
chmod +x "$STUB_DIRTY"
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/dirty --prompt-file "$PROMPT" --agy-bin "$STUB_DIRTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "dirty path exit code"
assert_contains "$OUT" '"status": "dirty"' "dirty status"
DIRTY_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
assert_file_exists "$DIRTY_WT/unstaged.txt" "dirty worktree kept with unstaged file"
git -C "$SBX" worktree remove --force "$DIRTY_WT" >/dev/null 2>&1 || true

# 5c. --keep-worktree: success still keeps the worktree, JSON carries its path
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/keep --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --keep-worktree 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "keep-worktree exit code"
assert_contains "$OUT" '"status": "committed"' "keep-worktree committed status"
KEEP_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
assert_file_exists "$KEEP_WT/ok.txt" "kept worktree present on success"
git -C "$SBX" worktree remove --force "$KEEP_WT" >/dev/null 2>&1 || true

# 6 (case c). no_op path: stub exits 0 with no commit → exit 1, status no_op, worktree KEPT
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/empty --prompt-file "$PROMPT" --agy-bin "$STUB_NOOP" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "no_op exit code"
assert_contains "$OUT" '"status": "no_op"' "no_op status (exit 0, no commit)"
KEPT_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
assert_neq "" "$KEPT_WT" "no_op keeps worktree path in JSON"
assert_file_exists "$KEPT_WT/.git" "kept worktree exists on disk"
git -C "$SBX" worktree remove --force "$KEPT_WT" >/dev/null 2>&1 || true

# 7 (case d). question_suspected: stub exits non-zero (proxy for timeout/stall) with no commit
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/question --prompt-file "$PROMPT" --agy-bin "$STUB_QUESTION" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "question_suspected exit code"
assert_contains "$OUT" '"status": "question_suspected"' "question_suspected status (non-zero exit, no commit)"
assert_contains "$OUT" "clarifying question" "question_suspected error hints at the cause"
assert_not_contains "$OUT" '"status": "no_op"' "abnormal-exit no-commit is NOT collapsed into no_op"
Q_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
git -C "$SBX" worktree remove --force "$Q_WT" >/dev/null 2>&1 || true

# 8 (case b). failure: stub commits cleanly but exits non-zero → NOT scored success (KR1)
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/failcommit --prompt-file "$PROMPT" --agy-bin "$STUB_FAIL_COMMIT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "failure (clean commit + non-zero exit) exit code"
assert_contains "$OUT" '"status": "failure"' "failure status"
assert_not_contains "$OUT" '"status": "committed"' "non-zero exit with clean commit is NEVER committed/success"
F_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
git -C "$SBX" worktree remove --force "$F_WT" >/dev/null 2>&1 || true

finalize_test
