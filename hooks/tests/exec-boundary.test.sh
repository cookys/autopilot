#!/usr/bin/env bash
# Red-case coverage for hooks/exec-boundary.js (four-layer D3 / KR2).
. "$(dirname "$0")/lib.sh"

HOOK="$REPO_ROOT/hooks/exec-boundary.js"
run_hook() { # $1 = command string; extra env via caller
  printf '{"tool_input":{"command":%s}}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")" \
    | AUTOPILOT_HOOK_EXEC_BOUNDARY=1 node "$HOOK" 2>"$TEST_TMP/hook-err.txt"
}

# ── Disabled by default (opt-in) ──
printf '{"tool_input":{"command":"sudo rm -rf /"}}' | node "$HOOK" 2>/dev/null; EXIT=$?
assert_eq "0" "$EXIT" "hook is a no-op when not opted in"

# ── E1: protected-ref force-push denied (defense-in-depth with branch-protection) ──
run_hook "git push --force origin main"; EXIT=$?
assert_eq "2" "$EXIT" "force push to main denied"
assert_contains "$(cat "$TEST_TMP/hook-err.txt")" "E1-force-push" "E1 rule named in denial"

run_hook "git push origin feat/x"; EXIT=$?
assert_eq "0" "$EXIT" "normal push to feature branch allowed"

# ── E2: recursive rm outside sanctioned roots denied; inside allowed ──
run_hook "rm -rf /etc/autopilot"; EXIT=$?
assert_eq "2" "$EXIT" "recursive rm of absolute path outside roots denied"
assert_contains "$(cat "$TEST_TMP/hook-err.txt")" "E2-recursive-rm" "E2 rule named in denial"

run_hook "rm -rf /"; EXIT=$?
assert_eq "2" "$EXIT" "rm -rf / denied"

run_hook "rm -rf build/ dist/"; EXIT=$?
assert_eq "0" "$EXIT" "relative recursive rm (inside cwd) allowed"

run_hook "rm -rf /tmp/scratch-dir"; EXIT=$?
assert_eq "0" "$EXIT" "recursive rm under /tmp allowed"

# ── E3: raw destructive SQL denied ──
run_hook "psql \"\$DSN\" -c 'DROP TABLE users'"; EXIT=$?
assert_eq "2" "$EXIT" "raw DROP TABLE denied"
assert_contains "$(cat "$TEST_TMP/hook-err.txt")" "E3-destructive-sql" "E3 rule named in denial"

# ── E4: sudo rm denied ──
run_hook "sudo rm /etc/some-file"; EXIT=$?
assert_eq "2" "$EXIT" "sudo rm denied"
assert_contains "$(cat "$TEST_TMP/hook-err.txt")" "E4-sudo-rm" "E4 rule named in denial"

# ── Live-caught false positives (2026-08-16): prose inside quoted arguments must NOT
# trigger E2/E4 — both rules match only at command position. Caught twice live during
# this plan's own D5 commit (see execution notes). ──
run_hook 'git commit -m "fix: guard E2 worktree-escaping rm -rf / E3 destructive SQL"'; EXIT=$?
assert_eq "0" "$EXIT" "E2 rule prose inside a quoted commit message passes"
run_hook 'echo "docs: never sudo rm anything here" > note.txt'; EXIT=$?
assert_eq "0" "$EXIT" "E4 prose in quoted args passes"
run_hook "true && rm -rf /etc/autopilot"; EXIT=$?
assert_eq "2" "$EXIT" "rm at command position after && still denied"

# ── Benign commands pass (allow-by-default) ──
for cmd in "ls -la" "git status" "npm test" "grep -r foo src/"; do
  run_hook "$cmd"; EXIT=$?
  assert_eq "0" "$EXIT" "benign command allowed: $cmd"
done

# ── Config override: sanctioned root + allow_sql ──
CFGDIR="$TEST_TMP/cfg-repo/.claude"; mkdir -p "$CFGDIR"
cat > "$CFGDIR/execution-boundary-config.md" <<'EOF'
sanctioned_roots: /var/lib/app-scratch
allow_sql: true
EOF
( cd "$TEST_TMP/cfg-repo" && \
  printf '{"tool_input":{"command":"rm -rf /var/lib/app-scratch/cache"}}' \
    | AUTOPILOT_HOOK_EXEC_BOUNDARY=1 node "$HOOK" 2>/dev/null ); EXIT=$?
assert_eq "0" "$EXIT" "configured sanctioned root allows recursive rm"
( cd "$TEST_TMP/cfg-repo" && \
  printf '{"tool_input":{"command":"psql -c \"DROP TABLE t\""}}' \
    | AUTOPILOT_HOOK_EXEC_BOUNDARY=1 node "$HOOK" 2>/dev/null ); EXIT=$?
assert_eq "0" "$EXIT" "allow_sql: true disables E3"

# ── Malformed input fails open (sibling convention) ──
printf 'not-json' | AUTOPILOT_HOOK_EXEC_BOUNDARY=1 node "$HOOK" 2>/dev/null; EXIT=$?
assert_eq "0" "$EXIT" "malformed input fails open"

finalize_test
