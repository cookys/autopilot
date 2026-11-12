#!/usr/bin/env bash
# BL-0433: a harness that starts its own tmux -L server and a recorded child must tear both down
# on exit (kill-server on that socket, kill only that pid). Never pkill.
. "$(dirname "$0")/lib.sh"

HELPER="$REPO_ROOT/scripts/lib/test-tmux-claude-teardown.sh"
CHECK="$REPO_ROOT/scripts/check-test-tmux-claude-teardown.js"
command -v tmux >/dev/null || fail "tmux is required"
command -v node >/dev/null || fail "node is required"

SOCKS=""
PIDS=""
note_sock() { SOCKS="$SOCKS $1"; }
note_pid() { PIDS="$PIDS $1"; }
cleanup_mine() {
  local s p
  for s in $SOCKS; do
    env -u TMUX tmux -L "$s" kill-server >/dev/null 2>&1 || true
  done
  for p in $PIDS; do
    kill -- "$p" >/dev/null 2>&1 || true
  done
  cleanup_test_tmp
}
trap cleanup_mine EXIT

server_up() { env -u TMUX tmux -L "$1" ls >/dev/null 2>&1; }
pid_up() { kill -0 -- "$1" 2>/dev/null; }

# $1 helper $2 socket $3 pidfile $4 hold(0|1) -> harness exit code
run_harness() {
  env -u TMUX -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HELPER="$1" SOCK="$2" PIDFILE="$3" HOLD="$4" \
    bash -c '
      set -u
      . "$HELPER"
      ap_arm_tmux_claude_teardown "$SOCK"
      command tmux -L "$SOCK" -f /dev/null new-session -d -s h sleep 300
      sleep 300 >/dev/null 2>&1 &
      echo $! > "$PIDFILE"
      ap_record_claude_pid "$(cat "$PIDFILE")"
      if [ "$HOLD" = 1 ]; then sleep 30; fi
    '
}

strip_body() {
  sed '/# BEGIN TEARDOWN BODY/,/# END TEARDOWN BODY/c\
  return 0' "$HELPER" > "$1"
}

# --- 1. negative control: teardown body replaced with `return 0` leaves both alive ---
NEG_SOCK="aptdn$$"
NEG_PIDF="$TEST_TMP/neg.pid"
note_sock "$NEG_SOCK"
strip_body "$TEST_TMP/broken-helper.sh"
run_harness "$TEST_TMP/broken-helper.sh" "$NEG_SOCK" "$NEG_PIDF" 0
neg_rc=$?
assert_exit_code "$neg_rc" 0 "broken helper harness exits 0"
assert_file_exists "$NEG_PIDF" "broken helper recorded a pid"
NEG_PID="$(cat "$NEG_PIDF")"
note_pid "$NEG_PID"
if server_up "$NEG_SOCK"; then
  assert_eq up up "negative control: private tmux server still up without teardown"
else
  fail "negative control vacuous: server was already dead without teardown"
fi
if pid_up "$NEG_PID"; then
  assert_eq up up "negative control: recorded pid still alive without teardown"
else
  fail "negative control vacuous: recorded pid was already dead without teardown"
fi
env -u TMUX tmux -L "$NEG_SOCK" kill-server >/dev/null 2>&1 || true
kill -- "$NEG_PID" >/dev/null 2>&1 || true

# --- 2. real helper: both are gone after the harness exits ---
OK_SOCK="aptdo$$"
OK_PIDF="$TEST_TMP/ok.pid"
note_sock "$OK_SOCK"
run_harness "$HELPER" "$OK_SOCK" "$OK_PIDF" 0
ok_rc=$?
assert_exit_code "$ok_rc" 0 "armed harness exits 0"
assert_file_exists "$OK_PIDF" "armed harness recorded a pid"
OK_PID="$(cat "$OK_PIDF")"
note_pid "$OK_PID"
i=0
while [ "$i" -lt 20 ]; do
  server_up "$OK_SOCK" || pid_up "$OK_PID" || break
  i=$((i + 1))
  sleep 0.05
done
if server_up "$OK_SOCK"; then
  fail "armed harness left its tmux server up ($OK_SOCK)"
else
  assert_eq down down "armed harness: private tmux server is gone"
fi
if pid_up "$OK_PID"; then
  fail "armed harness left the recorded pid alive ($OK_PID)"
else
  assert_eq dead dead "armed harness: recorded pid is dead"
fi

# --- 3. TERM runs the same trap ---
TERM_SOCK="aptdt$$"
TERM_PIDF="$TEST_TMP/term.pid"
note_sock "$TERM_SOCK"
env -u TMUX -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
  HELPER="$HELPER" SOCK="$TERM_SOCK" PIDFILE="$TERM_PIDF" \
  bash -c '
    set -u
    . "$HELPER"
    ap_arm_tmux_claude_teardown "$SOCK"
    command tmux -L "$SOCK" -f /dev/null new-session -d -s h sleep 300
    sleep 300 >/dev/null 2>&1 &
    echo $! > "$PIDFILE"
    ap_record_claude_pid "$(cat "$PIDFILE")"
    sleep 30
  ' &
TERM_HARNESS=$!
i=0
while [ "$i" -lt 50 ]; do
  [ -s "$TERM_PIDF" ] && server_up "$TERM_SOCK" && break
  i=$((i + 1))
  sleep 0.05
done
assert_file_exists "$TERM_PIDF" "TERM harness wrote a pid"
TERM_PID="$(cat "$TERM_PIDF" 2>/dev/null || true)"
note_pid "$TERM_PID"
kill -TERM -- "$TERM_HARNESS" 2>/dev/null || true
wait "$TERM_HARNESS" 2>/dev/null || true
i=0
while [ "$i" -lt 20 ]; do
  server_up "$TERM_SOCK" || { [ -n "$TERM_PID" ] && pid_up "$TERM_PID"; } || break
  i=$((i + 1))
  sleep 0.05
done
if server_up "$TERM_SOCK"; then
  fail "TERM left the private tmux server up"
else
  assert_eq down down "TERM: private tmux server is gone"
fi
if [ -n "$TERM_PID" ] && pid_up "$TERM_PID"; then
  fail "TERM left the recorded pid alive ($TERM_PID)"
else
  assert_eq dead dead "TERM: recorded pid is dead"
fi

# helper code (comments stripped) must not call the pattern killer
ban='p''kill'
helper_code="$(sed -e 's/^[[:space:]]*#.*//' -e '/^[[:space:]]*$/d' "$HELPER")"
assert_not_contains "$helper_code" "$ban" "helper code does not call the pattern killer"

# --- 4. scanner: broken fixture is red, armed fixture is green, repo is clean ---
FX="$TEST_TMP/fx"
mkdir -p "$FX/scripts" "$FX/packs" "$FX/docs/plans/evidence/2026-10-04-mods-p1c/gate" "$FX/references"
printf '%s\n' 'tmux -L modscrollfix -f /dev/null new-session -d -s s -- claude --plugin-dir /tmp/plug' > "$FX/scripts/bad.sh"
printf '%s\n' "$ban -f claude" 'ap_arm_tmux_claude_teardown modscrollfix' 'ap_record_claude_pid "$pid"' \
  'tmux -L modscrollfix new-session -d -s s sleep 1' > "$FX/scripts/pattern.sh"
printf '%s\n' 'ap_arm_tmux_claude_teardown modscrollfix' 'ap_record_claude_pid "$pid"' \
  'tmux -L modscrollfix -f /dev/null new-session -d -s s -- claude --plugin-dir /tmp/plug' > "$FX/scripts/good.sh"
mkdir -p "$FX/scripts/packs"
printf '%s\n' 'tmux -L hidden new-session -d -s s sleep 1' > "$FX/scripts/packs/skipped.sh"
printf '%s\n' '# tmux -L commented new-session -d' 'echo ok' > "$FX/scripts/comment.sh"
printf '%s\n' 'no phrases here' > "$FX/docs/plans/evidence/2026-10-04-mods-p1c/gate/DRIVER.md"

bad_out="$(node "$CHECK" --root "$FX" 2>"$TEST_TMP/bad.err")"
bad_rc=$?
assert_exit_code "$bad_rc" 1 "broken fixture: checker exits 1"
assert_contains "$(cat "$TEST_TMP/bad.err")" "missing_arm scripts/bad.sh" "broken fixture: missing_arm"
assert_contains "$(cat "$TEST_TMP/bad.err")" "missing_claude_pid scripts/bad.sh" "broken fixture: missing_claude_pid"
assert_contains "$(cat "$TEST_TMP/bad.err")" "pkill_by_pattern scripts/pattern.sh" "pattern-kill fixture is refused"
assert_contains "$(cat "$TEST_TMP/bad.err")" "runbook_missing_phrase docs/plans/evidence/2026-10-04-mods-p1c/gate/DRIVER.md ap_arm_tmux_claude_teardown" "runbook without the arm call is refused"
assert_contains "$bad_out" '"scanned":4' "packs/ and the comment-only file are not starters; four sh files scanned"
# good.sh is a starter that is armed, so it is not a finding. bad and pkill are.
assert_not_contains "$(cat "$TEST_TMP/bad.err")" "missing_arm scripts/good.sh" "armed fixture is not missing_arm"

# drop the broken runbook and the bad scripts: a root whose only starter is armed is clean
rm -f "$FX/scripts/bad.sh" "$FX/scripts/pattern.sh" "$FX/docs/plans/evidence/2026-10-04-mods-p1c/gate/DRIVER.md"
good_out="$(node "$CHECK" --root "$FX" 2>"$TEST_TMP/good.err")"
good_rc=$?
assert_exit_code "$good_rc" 0 "armed-only fixture: checker exits 0"
assert_eq "$(cat "$TEST_TMP/good.err")" "" "armed-only fixture: no findings"
assert_contains "$good_out" '"ok":true' "armed-only fixture: ok true"

# real tree. scanned must match an independent find, and must not be zero.
indep="$(find "$REPO_ROOT/scripts" "$REPO_ROOT/hooks" "$REPO_ROOT/mods" "$REPO_ROOT/skills" "$REPO_ROOT/evals" "$REPO_ROOT/tools" "$REPO_ROOT/bin" \
  -type f \( -name '*.sh' -o -name '*.bash' \) \
  ! -path '*/packs/*' ! -path '*/fixtures/*' ! -path '*/fixture/*' ! -path '*/stubs/*' ! -path '*/mutants/*' \
  ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/results/*' ! -path '*/results-archive/*' \
  2>/dev/null | wc -l | tr -d ' ')"
repo_out="$(node "$CHECK" 2>"$TEST_TMP/repo.err")"
repo_rc=$?
assert_exit_code "$repo_rc" 0 "repo scan exits 0"
assert_eq "$(cat "$TEST_TMP/repo.err")" "" "repo scan: no findings"
scanned="$(node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.scanned))})' <<<"$repo_out")"
assert_eq "$scanned" "$indep" "repo scan count matches an independent find"
assert_neq "$scanned" "0" "repo scan is not an empty walk"
assert_contains "$repo_out" '"ok":true' "repo scan ok"

finalize_test
