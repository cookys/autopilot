#!/usr/bin/env bash
# Red-case coverage for hooks/exec-boundary.js (four-layer D3 / KR2).
. "$(dirname "$0")/lib.sh"

HOOK="$REPO_ROOT/hooks/exec-boundary.js"
run_hook() { # $1 = command string; extra env via caller
  printf '{"tool_input":{"command":%s}}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")" \
    | AUTOPILOT_HOOK_EXEC_BOUNDARY=1 node "$HOOK" 2>"$TEST_TMP/hook-err.txt"
}

# ── Disabled = no-op. Hermetic against machine-local dogfood config (evidence-discipline
# §5): the shared opt-in gate is envFlag OR configFlag — env=0 cannot beat config=true —
# so the test isolates by pointing HOME at an empty dir (no config, no env → disabled). ──
printf '{"tool_input":{"command":"sudo rm -rf /"}}' | HOME="$TEST_TMP" node "$HOOK" 2>/dev/null; EXIT=$?
assert_eq "0" "$EXIT" "hook is a no-op when not enabled"

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

# ── E2 command-segment judging (2026-11-05): rm is judged only where it is a command
# word; a later line / heredoc body / quoted data is not an rm target or an rm command. ──
# False DENY seen live: line 1 a relative-ish rm, line 2 a command whose argument is an
# absolute path; the rm argument capture used to swallow line 2.
run_hook $'rm -rf $T/k/home/.kimi-code/sessions\ntimeout 12 bash $S/run-suite.sh --x /k/proj --y'; EXIT=$?
assert_eq "0" "$EXIT" "E2: absolute path on a later line is not an rm target"
run_hook $'cat > notes.md <<\'EOF\'\nrun this: ls && rm -rf /\nEOF\nls'; EXIT=$?
assert_eq "0" "$EXIT" "E2: rm text inside a quoted-delimiter heredoc body passes"
run_hook $'cat > notes.md <<EOF\nstep one; rm -rf /\nEOF'; EXIT=$?
assert_eq "0" "$EXIT" "E2: rm text inside a bare heredoc body passes"
run_hook $'cat <<-EOF\n\tdo it | rm -rf /etc/x\n\tEOF'; EXIT=$?
assert_eq "0" "$EXIT" "E2: rm text inside a <<- heredoc body passes"
run_hook $'git commit -m "docs: the old step was\nrm -rf /\nremoved; rm -rf /etc/y"'; EXIT=$?
assert_eq "0" "$EXIT" "E2: rm text on its own line inside a quoted commit message passes"
run_hook $'printf \'%s\\n\' \'x; rm -rf /\' > note.txt'; EXIT=$?
assert_eq "0" "$EXIT" "E2: printf of rm text redirected to a file passes"
run_hook $'echo "x && rm -rf /" > note.txt'; EXIT=$?
assert_eq "0" "$EXIT" "E2: echo of rm text redirected to a file passes"
run_hook $'echo "a; rm -rf /etc/x" >> note.txt'; EXIT=$?
assert_eq "0" "$EXIT" "E2: separator inside quotes does not start a command"

# Must-still-DENY controls (a real rm outside the roots is never let through).
run_hook $'echo hi\nrm -rf /'; EXIT=$?
assert_eq "2" "$EXIT" "E2: real rm -rf / on its own line denied"
run_hook $'echo hi\nrm -rf ~/x'; EXIT=$?
assert_eq "2" "$EXIT" "E2: rm -rf ~/x on line 2 denied"
run_hook $'ls\nrm -rf $T/a /etc/x'; EXIT=$?
assert_eq "2" "$EXIT" "E2: absolute target after a skipped \$VAR target on the same rm denied"
run_hook 'cd / && rm -rf *'; EXIT=$?
assert_eq "2" "$EXIT" "E2: cd / then rm -rf * denied"
run_hook 'ls ; rm -rf /etc/x'; EXIT=$?
assert_eq "2" "$EXIT" "E2: rm after ; denied"
run_hook 'ls | rm -rf /etc/x'; EXIT=$?
assert_eq "2" "$EXIT" "E2: rm after | denied"
run_hook 'FOO=1 rm -rf /etc/x'; EXIT=$?
assert_eq "2" "$EXIT" "E2: rm after env assignment denied"
run_hook 'command rm -rf /etc/x'; EXIT=$?
assert_eq "2" "$EXIT" "E2: rm after command builtin denied"
run_hook $'cat <<EOF\nhello\nEOF\nrm -rf /etc/x'; EXIT=$?
assert_eq "2" "$EXIT" "E2: rm after a closed heredoc denied"
run_hook $'cat <<EOF\nhello'; EXIT=$?
assert_eq "0" "$EXIT" "unterminated heredoc body is data"
run_hook 'echo "$(rm -rf /etc/x)"'; EXIT=$?
assert_eq "2" "$EXIT" "E2: rm inside \$( ) within double quotes denied"

# Literal commands are read from quoted heredocs so no shell layer rewrites them.
cmd_of() { cat; }
expect_exit() { # $1 = expected exit, $2 = label; command on stdin
  local c; c="$(cmd_of)"
  run_hook "$c"; EXIT=$?
  assert_eq "$1" "$EXIT" "$2"
}

# ── Class A (g1 review): quote state across $( ) / backtick inside double quotes.
# The substitution body is a fresh command context: separators split, quotes nest.
expect_exit 2 "E2/A: rm after ; inside \"\$( )\" denied" <<'X'
echo "$(true; rm -rf /etc/x)"
X
expect_exit 2 "E2/A: rm after && inside \"\$( )\" denied" <<'X'
echo "$(true && rm -rf /etc/x)"
X
expect_exit 2 "E2/A: rm after ; inside backticks in double quotes denied" <<'X'
echo "`ls; rm -rf /etc/x`"
X
expect_exit 2 "E2/A: inner quote inside \$( ) does not close the outer string" <<'X'
echo "$(printf '"')"; rm -rf /etc/x
X
expect_exit 2 "E2/A: rm after a double-quoted \$( ) on the same line denied" <<'X'
echo "$(date)"; rm -rf /etc/x
X
expect_exit 0 "E2/A: separator inside a quoted string inside \$( ) is data" <<'X'
echo "$(printf 'a; rm -rf /etc/x')" > note.txt
X

# ── Class B (g1 review): heredoc opener misrecognised; the rest of the command was dropped.
expect_exit 2 "E2/B: here-string <<< is not a heredoc (space)" <<'X'
cat <<< hi
ls; rm -rf /etc/x
X
expect_exit 2 "E2/B: here-string <<<WORD is not a heredoc" <<'X'
cat <<<EOF
true; rm -rf /etc/x
X
expect_exit 2 "E2/B: here-string then && continuation" <<'X'
cat <<< hello &&
rm -rf /etc/x
X
expect_exit 2 "E2/B: <<\\EOF is a quoted delimiter, rest after the body still judged" <<'X'
cat <<\EOF
body
EOF
ls; rm -rf /etc/x
X
expect_exit 2 "E2/B: <<E\"OF\" delimiter, rest after the body still judged" <<'X'
cat <<E"OF"
body
EOF
ls && rm -rf /etc/x
X
expect_exit 2 "E2/B: arithmetic shift in \$(( )) is not a heredoc" <<'X'
echo $((1<<4))
ls && rm -rf /etc/x
X
expect_exit 2 "E2/B: arithmetic shift then ; and newline" <<'X'
echo $((8<<1));
rm -rf /etc/x
X
expect_exit 2 "E2/B: spaced arithmetic shift then &&" <<'X'
echo $((1 << 2)) &&
rm -rf /etc/x
X
expect_exit 2 "E2/B: unterminated heredoc rewinds and the following lines are judged" <<'X'
cat <<NOSUCHEND
ls; rm -rf /etc/x
X
expect_exit 0 "E2/B: <<\\EOF body is literal text" <<'X'
cat <<\EOF
run; rm -rf /
EOF
X
expect_exit 0 "E2/B: <<E\"OF\" body is literal text" <<'X'
cat <<E"OF"
run; rm -rf /
EOF
X

# ── Class C (g1 review): ANSI-C $'...' quoting, where \' does not close the string.
expect_exit 2 "E2/C: \$'it\\'s' is one string, rm after ; denied" <<'X'
echo $'it\'s'; rm -rf /etc/x
X
expect_exit 2 "E2/C: printf \$'it\\'s\\n' then rm denied" <<'X'
printf $'it\'s\n'; rm -rf /etc/x
X
expect_exit 2 "E2/C: \$'\\'' then rm denied" <<'X'
echo $'\'' ; rm -rf /etc/x
X
expect_exit 0 "E2/C: separator inside \$'...' is data" <<'X'
echo $'a; rm -rf /' > note.txt
X

# ── Class D (g1 review): an unquoted heredoc body runs $( ) and backticks.
expect_exit 2 "E2/D: rm inside \$( ) in a bare heredoc body denied" <<'X'
cat <<EOF
$(rm -rf /etc/x)
EOF
X
expect_exit 2 "E2/D: rm inside backticks in a bare heredoc body denied" <<'X'
cat <<EOF
text `rm -rf /etc/x` more
EOF
X
expect_exit 2 "E2/D: rm after ; inside \$( ) in a <<-EOF body denied" <<'X'
cat <<-EOF
	$(true; rm -rf /etc/x)
	EOF
X
expect_exit 0 "E2/D: \$( ) in a QUOTED heredoc body is literal text" <<'X'
cat <<'EOF'
$(rm -rf /etc/x)
EOF
X
expect_exit 0 "E2/D: harmless \$( ) plus rm prose in a bare heredoc body passes" <<'X'
cat <<EOF
today is $(date); then run: ls && rm -rf /
EOF
X

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
