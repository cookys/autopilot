#!/usr/bin/env bash
# BL-0316: the paid slash-entry probe in preflight-release.sh is opt-in.
# A fake `claude` on PATH logs its argv; the probe's real calls use `-p`.
. "$(dirname "$0")/lib.sh"

PF="$REPO_ROOT/scripts/preflight-release.sh"
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
LOG="$TEST_TMP/called.log"
cat > "$BIN/claude" <<SH
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$LOG"
exit 97
SH
chmod +x "$BIN/claude"

run_pf() { # <args...> ; env from caller; sets OUT RC and resets LOG
  : > "$LOG"
  OUT=$(cd "$REPO_ROOT" && PATH="$BIN:$PATH" ENGINE_CAPABILITY_DIR="$TEST_TMP/cap" AUTOPILOT_STRIKE_WRITER=off \
        AUTOPILOT_DISPATCH_MANIFEST=0 SLASH_PROBE_TIMEOUT=20 bash "$PF" "$@" 2>&1); RC=$?
}
paid_calls() { grep -c -- '-p' "$LOG" || true; }

# (a) default: full run, no paid call, summary says NOT RUN, probe check does not fail
run_pf
assert_eq "$(paid_calls)" "0" "(a) default full run makes no claude -p call"
assert_contains "$OUT" "NOT RUN (paid LLM probes; pass --with-slash-probe at release)" "(a) check line says NOT RUN"
assert_contains "$OUT" "slash-entry probe: NOT RUN" "(a) summary marks the probe as not run"
assert_eq "$RC" "0" "(a) default run rc is 0"
case "$OUT" in *"✗ slash-entry"*) fail "(a) probe check reported failed" ;; esac

# (a2) --only-slash-probe without opt-in: NOT RUN, rc 0, no paid call
run_pf --only-slash-probe
assert_eq "$RC" "0" "(a2) --only-slash-probe without opt-in rc"
assert_eq "$(paid_calls)" "0" "(a2) no claude call"
assert_contains "$OUT" "NOT RUN" "(a2) NOT RUN printed"

# (b) flag: fake claude is called with -p
run_pf --only-slash-probe --with-slash-probe
[ "$(paid_calls)" -gt 0 ] || fail "(b) --with-slash-probe did not call claude -p"
# env equivalent
AUTOPILOT_SLASH_PROBE_RELEASE=1 run_pf --only-slash-probe
[ "$(paid_calls)" -gt 0 ] || fail "(b) AUTOPILOT_SLASH_PROBE_RELEASE=1 did not call claude -p"

# (c) SKIP env wins over the flag
AUTOPILOT_SKIP_SLASH_PROBE=1 run_pf --only-slash-probe --with-slash-probe
assert_eq "$(paid_calls)" "0" "(c) SKIP env beats flag: no claude call"
assert_contains "$OUT" "SKIPPED by AUTOPILOT_SKIP_SLASH_PROBE=1" "(c) skip reason printed"

finalize_test
