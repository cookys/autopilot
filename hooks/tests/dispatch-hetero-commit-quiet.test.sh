#!/usr/bin/env bash
# Commit-quiescence supervision (--commit-quiet-secs) for dispatch-hetero.sh implement stage.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
for _git_cfg_i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  unset "GIT_CONFIG_KEY_${_git_cfg_i}" "GIT_CONFIG_VALUE_${_git_cfg_i}"
done
unset _git_cfg_i

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_GROK_EFFORT_PROBE=0

DEFAULT_CAP_ISOLATION_DIR="$TEST_TMP/engine-capability-default"
mkdir -p "$DEFAULT_CAP_ISOLATION_DIR"
export ENGINE_CAPABILITY_DIR="$DEFAULT_CAP_ISOLATION_DIR"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"
EMPTY_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION_MODE_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR"

json_get() {
  echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(o[process.argv[1]]===undefined?'':String(o[process.argv[1]]))}catch(e){console.log('')}})" "$2"
}

last_json() {
  printf '%s\n' "$1" | grep '^{' | tail -n 1
}

# Stub grok: MODE=commit_sleep (idle, no child process) | commit_busy (a 12s foreground tool child, then a
# second commit) | commit_chatter | dirty_sleep.
install_stub() {
  local dest="$1"
  {
    echo '#!/usr/bin/env bash'
    sed -n '/^if \[ "\${1:-}" = "--list-models" \]/,/^esac$/p' hooks/tests/dispatch-hetero-wall-timeout.test.sh
    cat <<'BODY'
echo "$$" > "$HETERO_TEST_PIDFILE"
case "$HETERO_TEST_MODE" in
  commit_sleep) echo ok > ok.txt; git add ok.txt; git -c user.email=t@t -c user.name=t commit -q -m c; read -t 120 _ <> "$HETERO_TEST_PIDFILE.fifo" ;;
  commit_busy) echo ok > ok.txt; git add ok.txt; git -c user.email=t@t -c user.name=t commit -q -m c; sleep 12; echo second > second.txt; git add second.txt; git -c user.email=t@t -c user.name=t commit -q -m second ;;
  commit_chatter) echo ok > ok.txt; git add ok.txt; git -c user.email=t@t -c user.name=t commit -q -m c; while :; do echo tick; sleep 1; done ;;
  dirty_sleep) echo ok > ok.txt; sleep 120 ;;
  late_commit) trap 'date +%s > "$HETERO_TEST_PIDFILE.term"; exit 0' TERM; read -t 12 _ <> "$HETERO_TEST_PIDFILE.fifo"; echo ok > ok.txt; git add ok.txt; git -c user.email=t@t -c user.name=t commit -q -m c; date +%s > "$HETERO_TEST_PIDFILE.commit"; read -t 120 _ <> "$HETERO_TEST_PIDFILE.fifo" ;;
  orphan_sleep) git checkout -q --orphan other; git rm -rfq . 2>/dev/null; git -c user.email=t@t -c user.name=t commit -q --allow-empty -m orphan; read -t 120 _ <> "$HETERO_TEST_PIDFILE.fifo" ;;
esac
exit 0
BODY
  } > "$dest"
  chmod +x "$dest"
}

run_case() { # mode extra-args... ; sets OUT ELAPSED PIDF
  local mode="$1"; shift
  local stub="$TEST_TMP/stub-$mode" runs="$TEST_TMP/runs-$mode"
  PIDF="$TEST_TMP/$mode.pid"; : > "$PIDF"; mkdir -p "$runs"; rm -f "$PIDF.fifo"; mkfifo "$PIDF.fifo"
  install_stub "$stub"
  local start; start="$(date +%s)"
  OUT="$(cd "$SBX" && timeout 90 env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    HETERO_TEST_PIDFILE="$PIDF" HETERO_TEST_MODE="$mode" \
    "$SCRIPT" --runner grok --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch "feat/cq-$mode-$RANDOM" --prompt-file "$PROMPT" --timeout 60s "$@" 2>&1)" || true
  ELAPSED=$(( $(date +%s) - start ))
}
no_child() { local p; p="$(cat "$PIDF" 2>/dev/null)"; [ -n "$p" ] || fail "$1: no pidfile"; ! kill -0 "$p" 2>/dev/null || fail "$1: stub $p still alive"; }

run_case commit_sleep --commit-quiet-secs 3
J="$(last_json "$OUT")"
[ "$ELAPSED" -lt 40 ] || fail "commit_sleep took ${ELAPSED}s"
assert_eq "$(json_get "$J" status)" committed "commit_sleep status"
assert_eq "$(json_get "$J" note)" ended_after_commit_quiet "commit_sleep note"
assert_eq "$(json_get "$J" timed_out)" false "commit_sleep timed_out"
no_child commit_sleep

# A running tool (descendant process) is not "done": 12s of silent child work, then a second
# commit, must survive a 3s quiet window (regression: 134s kill of a 180s foreground test run).
run_case commit_busy --commit-quiet-secs 3 --timeout 60s
J="$(last_json "$OUT")"
assert_eq "$(json_get "$J" note)" "" "busy tool no note"
assert_eq "$(json_get "$J" timed_out)" false "busy tool not timed out"
assert_eq "$(json_get "$J" files_changed)" 2 "busy tool second commit kept"

# Detached path: the flag and the supervisor must cross the setsid re-exec boundary.
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$TEST_TMP/ledger" >/dev/null
run_case commit_sleep --commit-quiet-secs 3 --timeout 40s --ledger "$TEST_TMP/ledger" --run-id detached --stage implement
J="$(last_json "$OUT")"
[ "$ELAPSED" -lt 35 ] || fail "detached commit_sleep took ${ELAPSED}s"
assert_eq "$(json_get "$J" status)" committed "detached status"
assert_eq "$(json_get "$J" note)" ended_after_commit_quiet "detached note"
assert_eq "$(json_get "$J" timed_out)" false "detached timed_out"
no_child commit_sleep

# Quiet long BEFORE the commit must not pre-load the counter: the worker is only ended after
# N full seconds of eligibility (commit landed, tree clean) have elapsed (regression e7ba248c).
rm -f "$TEST_TMP/late_commit.pid.commit" "$TEST_TMP/late_commit.pid.term"
HETERO_COMMIT_QUIET_POLL=1 run_case late_commit --commit-quiet-secs 5 --timeout 60s
J="$(last_json "$OUT")"
assert_eq "$(json_get "$J" note)" ended_after_commit_quiet "late commit note"
CT="$(cat "$TEST_TMP/late_commit.pid.commit" 2>/dev/null || echo 0)"
TT="$(cat "$TEST_TMP/late_commit.pid.term" 2>/dev/null || echo 0)"
[ "$CT" -gt 0 ] && [ "$TT" -gt 0 ] || fail "late_commit: missing commit/term stamps ($CT/$TT)"
[ $((TT - CT)) -ge 5 ] || fail "late_commit ended $((TT - CT))s after commit, want >= 5"

# An orphan HEAD (not a descendant of BASE) is not an advance (regression efc6bb63).
run_case orphan_sleep --commit-quiet-secs 3 --timeout 12s
J="$(last_json "$OUT")"
assert_eq "$(json_get "$J" note)" "" "orphan no note"
assert_eq "$(json_get "$J" timed_out)" true "orphan times out"

run_case commit_chatter --commit-quiet-secs 3 --timeout 12s
J="$(last_json "$OUT")"
assert_eq "$(json_get "$J" note)" "" "chatter no note"
assert_eq "$(json_get "$J" timed_out)" true "chatter times out (not stopped early)"

run_case dirty_sleep --commit-quiet-secs 3 --timeout 12s
J="$(last_json "$OUT")"
assert_eq "$(json_get "$J" note)" "" "dirty no note"
assert_eq "$(json_get "$J" timed_out)" true "dirty times out"

run_case commit_sleep --commit-quiet-secs 0 --timeout 12s
J="$(last_json "$OUT")"
assert_eq "$(json_get "$J" note)" "" "disabled no note"
assert_eq "$(json_get "$J" timed_out)" true "disabled times out"

finalize_test
