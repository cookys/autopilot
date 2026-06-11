#!/usr/bin/env bash
# dispatch-hetero.sh integration test — exercises the full worktree flow with a
# PATH-stubbed fake `agy` (no network, no real Antigravity needed). Covers:
# preconditions (exit 2), committed path (exit 0, worktree auto-removed,
# branch survives), no_commit path (exit 1, worktree kept).
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

# --- stub agy: does nothing (agent produced no commit) ---
STUB_NOOP="$TEST_TMP/agy-noop"
printf '#!/usr/bin/env bash\necho "did nothing"\n' > "$STUB_NOOP"
chmod +x "$STUB_NOOP"

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

# 6. no_commit path: stub does nothing → exit 1, worktree KEPT for inspection
OUT="$(cd "$SBX" && "$SCRIPT" --branch feat/empty --prompt-file "$PROMPT" --agy-bin "$STUB_NOOP" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "no_commit exit code"
assert_contains "$OUT" '"status": "no_commit"' "no_commit status"
KEPT_WT="$(printf '%s' "$OUT" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
assert_neq "" "$KEPT_WT" "no_commit keeps worktree path in JSON"
assert_file_exists "$KEPT_WT/.git" "kept worktree exists on disk"
# cleanup the kept worktree so the sandbox tears down cleanly
git -C "$SBX" worktree remove --force "$KEPT_WT" >/dev/null 2>&1 || true

finalize_test
