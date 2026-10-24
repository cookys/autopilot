#!/usr/bin/env bash
# BL-0293: dispatch-review.sh --idle-timeout. A seat whose capture output stops growing is killed
# (whole process group, no orphan) and reported no_verdict / seat_idle_timeout; a slow but steady
# seat is left alone; with the knob unset nothing changes. Stub grok only, no model is called.
# Every case is bounded by `timeout`. The negative control swaps the watcher for a no-op and must
# lose the idle verdict (so the assertions above it cannot pass without the real check).
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"
export DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0
unset AUTOPILOT_REVIEW_IDLE_TIMEOUT AUTOPILOT_IDLE_WATCH_SCRIPT

GC_PID_FILE="$TEST_TMP/gc.pid"; DONE_FILE="$TEST_TMP/done"; export GC_PID_FILE DONE_FILE
STUB="$TEST_TMP/grok-idle"
cat > "$STUB" <<'SEOF'
#!/usr/bin/env bash
case " $* " in *" --prompt-file "*) ;; *) exit 0 ;; esac
case "$STUB_MODE" in
  stall)
    echo "thinking..."
    sleep 301 > /dev/null 2>&1 < /dev/null &
    echo $! > "$GC_PID_FILE"
    wait ;;
  slow) for i in 1 2 3 4 5 6 7 8; do echo "step $i"; sleep 1; done; : > "$DONE_FILE" ;;
esac
exit 0
SEOF
chmod +x "$STUB"

run_seat() { # <mode> <extra args...>; sets OUT RC ELAPSED
  local mode="$1"; shift
  rm -f "$GC_PID_FILE" "$DONE_FILE"
  local t0=$SECONDS
  OUT="$(STUB_MODE="$mode" env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID timeout 90 "$SCRIPT" --runner grok --model fixture --diff-file "$DIFF" --bin "$STUB" "$@" 2>/dev/null < /dev/null)"
  RC=$?; ELAPSED=$((SECONDS - t0))
}
alive() { local p; p="$(cat "$GC_PID_FILE" 2>/dev/null)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }
reap() { local p; p="$(cat "$GC_PID_FILE" 2>/dev/null)"; [ -n "$p" ] && kill -KILL "$p" 2>/dev/null; return 0; }

GNU_TIMEOUT=/usr/bin/gnutimeout   # real GNU coreutils timeout (setpgid(0,0), no --foreground): the uutils one on this host is not the reference
GNU_BIN="$TEST_TMP/gnu-bin"; mkdir -p "$GNU_BIN"
[ -x "$GNU_TIMEOUT" ] && ln -sf "$GNU_TIMEOUT" "$GNU_BIN/timeout"
W="$REPO_ROOT/scripts/lib/idle-watch.sh"

run_suite() { # <label>  (PATH decides which timeout the rail and the watcher run under)
L="$1"
# (1) stall after some output: killed at the idle window, correct code, no orphan, well before the wall cap.
run_seat stall --timeout 60s --idle-timeout 2s
assert_contains "$OUT" '"status": "no_verdict"' "$L: stalled seat is no_verdict"
assert_contains "$OUT" 'seat_idle_timeout' "reason code is seat_idle_timeout"
assert_eq "1" "$RC" "no_verdict exit code"
[ "$ELAPSED" -lt 30 ]; assert_eq "0" "$?" "killed near the idle window, not the 60s wall cap (took ${ELAPSED}s)"
sleep 0.5
alive; assert_eq "1" "$?" "grandchild of the killed seat is gone (no orphan)"; reap

# (2) steady slow output (8s total, 1s gaps) under a 3s idle window: never killed.
run_seat slow --timeout 60s --idle-timeout 3s
assert_not_contains "$OUT" 'seat_idle_timeout' "slow but steady seat is not idle-killed"
assert_file_exists "$DONE_FILE" "slow seat ran to completion"

# (3) knob unset: same stall is NOT idle-killed; it runs to the wall cap.
run_seat stall --timeout 4s
assert_not_contains "$OUT" 'seat_idle_timeout' "unset knob: no idle verdict"
assert_contains "$OUT" '"status": "no_verdict"' "unset knob: wall cap still fails closed"
[ "$ELAPSED" -ge 4 ]; assert_eq "0" "$?" "unset knob: waited for the wall cap (took ${ELAPSED}s)"
sleep 0.3; reap

# (4) env spelling is the same knob; a bad value is a precondition failure.
AUTOPILOT_REVIEW_IDLE_TIMEOUT=2 run_seat stall --timeout 60s
assert_contains "$OUT" 'seat_idle_timeout' "env AUTOPILOT_REVIEW_IDLE_TIMEOUT works"
sleep 0.3; reap
run_seat stall --timeout 10s --idle-timeout bogus
assert_contains "$OUT" 'precondition_failed' "bad --idle-timeout is a precondition failure"

# (5) NEGATIVE CONTROL: a watcher that never kills loses the idle verdict, so (1) depends on the check.
NOOP="$TEST_TMP/noop-watch.sh"
printf '#!/usr/bin/env bash\nshift 3\nexec "$@"\n' > "$NOOP"; chmod +x "$NOOP"
AUTOPILOT_IDLE_WATCH_SCRIPT="$NOOP" run_seat stall --timeout 4s --idle-timeout 1s
assert_not_contains "$OUT" 'seat_idle_timeout' "negative control: without the real watcher the stall is not reported idle"
sleep 0.3; reap


# (7) wall clock first with the knob set: timeout's own 124 survives (reason carries rc=124, not 137), no orphan.
run_seat stall --timeout 3s --idle-timeout 600s
assert_contains "$OUT" 'rc=124' "$L: wall-cap TERM path keeps exit 124"
assert_not_contains "$OUT" 'seat_idle_timeout' "$L: wall cap first is not an idle verdict"
sleep 0.5; alive; assert_eq "1" "$?" "$L: wall-cap path leaves no orphan"; reap

# (8) watcher under this timeout: exits 125 itself (the marker hides the code from the rail output).
M="$TEST_TMP/w.marker"; : > "$M"; rm -f "$GC_PID_FILE"
timeout 30 bash "$W" 1 "$M" -- bash -c 'echo hi; sleep 302 > /dev/null 2>&1 < /dev/null & echo $! > "$0"; wait' "$GC_PID_FILE" > "$TEST_TMP/w.out" 2>&1 < /dev/null
assert_eq "125" "$?" "$L: watcher itself exits 125 on idle"
sleep 0.5; alive; assert_eq "1" "$?" "$L: watcher leaves no orphan"; reap
}

run_suite uutils
if [ -x "$GNU_BIN/timeout" ]; then
  _P="$PATH"; PATH="$GNU_BIN:$PATH"
  "$GNU_BIN/timeout" --version | head -1 | grep -q GNU; assert_eq "0" "$?" "GNU timeout really is GNU"
  run_suite gnu
  # NEGATIVE CONTROL for the group fix: the previous watcher (kills its own group) must fail (8) under GNU timeout.
  git -C "$REPO_ROOT" show 7908fced9:scripts/lib/idle-watch.sh > "$TEST_TMP/old-watch.sh" 2>/dev/null
  M="$TEST_TMP/old.marker"; : > "$M"; rm -f "$GC_PID_FILE"
  timeout 30 bash "$TEST_TMP/old-watch.sh" 1 "$M" -- bash -c 'echo hi; sleep 303 > /dev/null 2>&1 < /dev/null & echo $! > "$0"; wait' "$GC_PID_FILE" > /dev/null 2>&1 < /dev/null
  assert_neq "125" "$?" "negative control: the group-killing watcher loses its own exit code under GNU timeout"
  sleep 0.3; reap
  PATH="$_P"
else
  echo "SKIP gnu: $GNU_TIMEOUT not present"
fi
finalize_test
