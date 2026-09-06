#!/usr/bin/env bash
# Test for dirty-protected-paths.js — turn-end uncommitted-work reminder (Stop). Warn-only:
# every case must exit 0 and never emit a Stop `decision`.
. "$(dirname "$0")/lib.sh"

export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
mkdir -p "$AUTOPILOT_LIVE_DIR"
# The live-dir resolver rejects non-RAM candidates; the ssd fallback is HOME-based, and HOOK_HOME
# is TEST_TMP-scoped, so state never leaks between cases or into the real ~/.autopilot.

REPO="$TEST_TMP/repo"
mkdir -p "$REPO/src" "$REPO/docs" "$REPO/.claude"
git -C "$REPO" init -q
git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
printf 'base\n' > "$REPO/src/base.js"; printf 'doc\n' > "$REPO/docs/a.md"
printf -- '- mode: warn\n- protected_paths: src/, hooks/\n' > "$REPO/.claude/qc-gate-config.md"
git -C "$REPO" add -A && git -C "$REPO" commit -qm init

payload() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$1" "$REPO"; }
# Every turn for these tests: interval 0 unless a case sets it.
export AUTOPILOT_DIRTY_TREE_INTERVAL_MINUTES=0

# 1. clean tree → silent
run_hook dirty-protected-paths.js "$(payload s1)"
assert_eq 0 "$__RUN_EXIT" "clean-exit"
assert_eq "" "$__RUN_STDOUT" "clean tree: silent"

# 2. one small protected change → below both thresholds → silent
printf 'x\n' >> "$REPO/src/base.js"
run_hook dirty-protected-paths.js "$(payload s1)"
assert_eq "" "$__RUN_STDOUT" "one small change: below thresholds, silent"

# 3. three protected files → files threshold → reminder, no decision
printf 'a\n' > "$REPO/src/a.js"; printf 'b\n' > "$REPO/src/b.js"
run_hook dirty-protected-paths.js "$(payload s1)"
assert_eq 0 "$__RUN_EXIT" "files-threshold exit 0"
assert_contains "$__RUN_STDOUT" '"systemMessage"' "files threshold: systemMessage emitted"
assert_contains "$__RUN_STDOUT" "3 uncommitted file(s)" "files threshold: counts the three protected files"
assert_contains "$__RUN_STDOUT" "protected paths (src/, hooks/)" "reminder names the protected paths"
assert_contains "$__RUN_STDOUT" "nothing is blocked" "reminder says it is advisory"
assert_not_contains "$__RUN_STDOUT" '"decision"' "never emits a Stop decision"
assert_contains "$__RUN_STDERR" "dirty-tree reminder" "same line mirrored on stderr"

# 4. unprotected churn does not count: many docs files, protected below threshold
rm -f "$REPO/src/a.js" "$REPO/src/b.js"
for i in 1 2 3 4 5; do printf 'd\n' > "$REPO/docs/d$i.md"; done
run_hook dirty-protected-paths.js "$(payload s1)"
assert_eq "" "$__RUN_STDOUT" "unprotected files are not counted"

# 5. one big untracked protected file → lines threshold
seq 1 200 > "$REPO/src/big.js"
run_hook dirty-protected-paths.js "$(payload s1)"
assert_contains "$__RUN_STDOUT" '"systemMessage"' "lines threshold: reminder"
assert_contains "$__RUN_STDOUT" "~201 line(s)" "lines threshold: counts numstat + untracked lines"

# 6. interval dedupe: default 30 min → second call in the same session is silent, new session fires
unset AUTOPILOT_DIRTY_TREE_INTERVAL_MINUTES
run_hook dirty-protected-paths.js "$(payload s2)"
assert_contains "$__RUN_STDOUT" '"systemMessage"' "interval: first reminder for session s2"
run_hook dirty-protected-paths.js "$(payload s2)"
assert_eq "" "$__RUN_STDOUT" "interval: second call within 30 min is silent"
run_hook dirty-protected-paths.js "$(payload s3)"
assert_contains "$__RUN_STDOUT" '"systemMessage"' "interval: state is per session"
export AUTOPILOT_DIRTY_TREE_INTERVAL_MINUTES=0

# 7. knobs: raise thresholds via env → silent
AUTOPILOT_DIRTY_TREE_MIN_FILES=50 AUTOPILOT_DIRTY_TREE_MIN_LINES=5000 run_hook dirty-protected-paths.js "$(payload s4)"
assert_eq "" "$__RUN_STDOUT" "env thresholds respected"

# 8. opt-out
AUTOPILOT_DIRTY_TREE_REMINDER=false run_hook dirty-protected-paths.js "$(payload s5)"
assert_eq "" "$__RUN_STDOUT" "opt-out env silences"

# 9. no qc-gate config → whole tree counts (docs churn now counts)
rm "$REPO/.claude/qc-gate-config.md"
run_hook dirty-protected-paths.js "$(payload s6)"
assert_contains "$__RUN_STDOUT" "whole tree counted" "no config: whole tree counted and said so"

# 10. not a git repo → silent; garbage stdin → silent, exit 0
mkdir -p "$TEST_TMP/plain"
run_hook dirty-protected-paths.js "$(printf '{"session_id":"s7","cwd":"%s"}' "$TEST_TMP/plain")"
assert_eq 0 "$__RUN_EXIT" "non-repo exit 0"
assert_eq "" "$__RUN_STDOUT" "non-repo: silent"
run_hook dirty-protected-paths.js 'not json'
assert_eq 0 "$__RUN_EXIT" "garbage stdin exit 0 (fail-open)"
assert_eq "" "$__RUN_STDOUT" "garbage stdin: silent"

finalize_test
