#!/usr/bin/env bash
# dispatch-review.sh opencode: descendants must not survive the child (reparent orphan) and
# the whole process group is reaped even when there is no session launcher. Stubs only.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"
export DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0

# PATH without the session launcher (symlink farm of every PATH executable except it).
SL=set; SL="${SL}sid"
NOSL_BIN="$TEST_TMP/nosl-bin"; mkdir -p "$NOSL_BIN"
IFS=: read -ra _pdirs <<< "$PATH"
for _d in "${_pdirs[@]}"; do
  [ -d "$_d" ] || continue
  for _f in "$_d"/*; do
    _b="${_f##*/}"; [ "$_b" = "$SL" ] && continue
    [ -x "$_f" ] && [ ! -e "$NOSL_BIN/$_b" ] && ln -s "$_f" "$NOSL_BIN/$_b"
  done
done
_OLD_PATH="$PATH"; PATH="$NOSL_BIN"
[ -z "$(type -P "$SL")" ]; _nos=$?
PATH="$_OLD_PATH"
assert_eq "0" "$_nos" "launcher-less PATH really lacks it"

# (1) root exits on its own, leaving a background grandchild (optionally after a quota event).
GC_PID_FILE="$TEST_TMP/orphan-gc.pid"; export GC_PID_FILE
STUB_ORPHAN="$TEST_TMP/opencode-orphan"
cat > "$STUB_ORPHAN" <<'SEOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "export" ]; then printf '{"credential":"fixture"}'; exit 0; fi
if [ "$1" = "auth" ]; then exit 0; fi
sleep 300 &
echo $! > "$GC_PID_FILE"
sleep 1
if [ -n "$STUB_ORPHAN_QUOTA" ]; then
  echo '{"type":"error","error":{"name":"APIError","data":{"message":"You exceeded your current quota (insufficient_quota)"}}}'
fi
exit 1
SEOF
chmod +x "$STUB_ORPHAN"
for MODE in with without; do
  for Q in "" 1; do
    rm -f "$GC_PID_FILE"
    P="$PATH"; [ "$MODE" = without ] && P="$NOSL_BIN"
    PATH="$P" STUB_ORPHAN_QUOTA="$Q" "$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_ORPHAN" --timeout 60s >/dev/null 2>&1 < /dev/null
    GPID="$(cat "$GC_PID_FILE" 2>/dev/null)"; sleep 0.5
    [ -n "$GPID" ]; assert_eq "0" "$?" "orphan $MODE launcher quota=${Q:-0}: grandchild pid recorded"
    kill -0 "$GPID" 2>/dev/null; assert_eq "1" "$?" "orphan $MODE launcher quota=${Q:-0}: grandchild gone after child exit"
    [ -n "$GPID" ] && kill -KILL "$GPID" 2>/dev/null
  done
done

# (2) root keeps forking while being killed: no straggler may survive (tree-kill path).
FORK_PID_FILE="$TEST_TMP/fork.pids"; export FORK_PID_FILE
STUB_FORK="$TEST_TMP/opencode-forker"
cat > "$STUB_FORK" <<'SEOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "export" ]; then printf '{"credential":"fixture"}'; exit 0; fi
if [ "$1" = "auth" ]; then exit 0; fi
echo '{"type":"error","error":{"name":"APIError","data":{"message":"You exceeded your current quota (insufficient_quota)"}}}'
n=0
while [ "$n" -lt 400 ]; do
  sleep 300 &
  echo $! >> "$FORK_PID_FILE"
  n=$((n + 1))
  sleep 0.005
done
wait
SEOF
chmod +x "$STUB_FORK"
for i in 1 2 3; do
  : > "$FORK_PID_FILE"
  OUT="$(PATH="$NOSL_BIN" "$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_FORK" --timeout 60s 2>&1 < /dev/null)"
  assert_contains "$OUT" 'engine_quota_exhausted' "forker $i: quota detected"
  sleep 0.5
  ALIVE=0
  while read -r p; do
    [ -n "$p" ] && kill -0 "$p" 2>/dev/null && { ALIVE=$((ALIVE + 1)); kill -KILL "$p" 2>/dev/null; }
  done < "$FORK_PID_FILE"
  assert_eq "0" "$ALIVE" "forker $i: no forked descendant survives the tree kill"
done

# (3) no launcher: root forks a grandchild and exits IMMEDIATELY (no sleep) -> grandchild must not survive.
STUB_IMM="$TEST_TMP/opencode-immediate"
cat > "$STUB_IMM" <<'SEOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "export" ]; then printf '{"credential":"fixture"}'; exit 0; fi
if [ "$1" = "auth" ]; then exit 0; fi
sleep 300 > /dev/null 2>&1 < /dev/null &
echo $! > "$GC_PID_FILE"
exit 1
SEOF
chmod +x "$STUB_IMM"
for i in 1 2 3 4 5 6; do
  rm -f "$GC_PID_FILE"
  PATH="$NOSL_BIN" "$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_IMM" --timeout 60s >/dev/null 2>&1 < /dev/null
  GPID="$(cat "$GC_PID_FILE" 2>/dev/null)"; sleep 0.3
  [ -n "$GPID" ]; assert_eq "0" "$?" "immediate-exit $i: grandchild pid recorded"
  kill -0 "$GPID" 2>/dev/null; assert_eq "1" "$?" "immediate-exit $i: grandchild gone though root exited at once"
  [ -n "$GPID" ] && kill -KILL "$GPID" 2>/dev/null
done

# (4) no launcher: TERM / INT to dispatch-review reap the child AND its grandchild, and a bystander
# process outside the group (an unrelated sleep) is never signalled (PID-reuse safety).
CH_PID_FILE="$TEST_TMP/hang-child.pid"; export CH_PID_FILE
STUB_HANG="$TEST_TMP/opencode-hang-gc"
cat > "$STUB_HANG" <<'SEOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "export" ]; then printf '{"credential":"fixture"}'; exit 0; fi
if [ "$1" = "auth" ]; then exit 0; fi
echo $$ > "$CH_PID_FILE"
sleep 300 &
echo $! > "$GC_PID_FILE"
wait
SEOF
chmod +x "$STUB_HANG"
for SIG in TERM INT; do
  EXPECT_RC=130
  rm -f "$CH_PID_FILE" "$GC_PID_FILE"
  sleep 300 > /dev/null 2>&1 < /dev/null &
  BYSTANDER=$!
  set -m
  PATH="$NOSL_BIN" "$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_HANG" --timeout 120s >/dev/null 2>&1 < /dev/null &
  DR_PID=$!
  set +m
  for _ in $(seq 1 50); do [ -s "$GC_PID_FILE" ] && break; sleep 0.2; done
  CPID="$(cat "$CH_PID_FILE" 2>/dev/null)"; GPID="$(cat "$GC_PID_FILE" 2>/dev/null)"
  [ -n "$CPID" ] && [ -n "$GPID" ]; assert_eq "0" "$?" "$SIG no launcher: child and grandchild recorded"
  kill -"$SIG" "$DR_PID" 2>/dev/null
  for _ in $(seq 1 50); do kill -0 "$DR_PID" 2>/dev/null || break; sleep 0.2; done   # bounded: at most 10 s
  kill -0 "$DR_PID" 2>/dev/null; assert_eq "1" "$?" "$SIG no launcher: dispatch-review exited within 10 s"
  if kill -0 "$DR_PID" 2>/dev/null; then kill -KILL "$DR_PID" 2>/dev/null; fi
  wait "$DR_PID" 2>/dev/null; DR_RC=$?
  assert_eq "$DR_RC" "$EXPECT_RC" "$SIG no launcher: exit status"
  sleep 0.3
  kill -0 "$CPID" 2>/dev/null; assert_eq "1" "$?" "$SIG no launcher: child gone"
  kill -0 "$GPID" 2>/dev/null; assert_eq "1" "$?" "$SIG no launcher: grandchild gone"
  kill -0 "$BYSTANDER" 2>/dev/null; assert_eq "0" "$?" "$SIG no launcher: unrelated process outside the group is still alive"
  [ -n "$GPID" ] && kill -KILL "$GPID" 2>/dev/null
  [ -n "$CPID" ] && kill -KILL "$CPID" 2>/dev/null
  kill -KILL "$BYSTANDER" 2>/dev/null; wait "$BYSTANDER" 2>/dev/null
done

# (5) bystander survives a quota kill and a normal exit too.
for MODE in quota plain; do
  sleep 300 > /dev/null 2>&1 < /dev/null &
  BYSTANDER=$!
  if [ "$MODE" = quota ]; then STUB="$STUB_FORK"; else STUB="$STUB_IMM"; fi
  : > "$FORK_PID_FILE"; rm -f "$GC_PID_FILE"
  PATH="$NOSL_BIN" "$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB" --timeout 60s >/dev/null 2>&1 < /dev/null
  sleep 0.3
  kill -0 "$BYSTANDER" 2>/dev/null; assert_eq "0" "$?" "$MODE no launcher: unrelated process outside the group untouched"
  GPID="$(cat "$GC_PID_FILE" 2>/dev/null)"; [ -n "$GPID" ] && kill -KILL "$GPID" 2>/dev/null
  while read -r p; do [ -n "$p" ] && kill -KILL "$p" 2>/dev/null; done < "$FORK_PID_FILE"
  kill -KILL "$BYSTANDER" 2>/dev/null; wait "$BYSTANDER" 2>/dev/null
done
finalize_test
