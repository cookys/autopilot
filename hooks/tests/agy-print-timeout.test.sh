#!/usr/bin/env bash
# agy-print-timeout.test.sh — agy parses --print-timeout as a Go duration and rejects a bare number
# ("time: missing unit in duration"). Every rail that forwards its own --timeout to agy must go through
# lib/agy-timeout.sh: a bare number becomes "<n>s", a unit-carrying value passes unchanged, anything
# else is refused BEFORE agy is spawned. Stub agy only (hooks/tests/lib/agy-stdin-adapter.js, which
# also rejects a unitless --print-timeout the way the real CLI does); no real agy, no paid call.
#   1. lib function: table of accepted / rejected values
#   2. dispatch-author / dispatch-review / dispatch-hetero / dispatch-explore with `--timeout 900`:
#      the stub's argv carries `--print-timeout 900s`
#   3. a unit value (9m) is forwarded unchanged; an invalid value is refused with the agy never spawned
# Negative control: with agy_print_timeout made a pass-through, sections 1 and 2 go red.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AGY_STUB_MODELS="$(printf 'gemini-3.7-flash-high\tGemini 3.7 Flash (High)\ngemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)')"
export DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/dispatch-runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"

LIB="${AGY_PRINT_TIMEOUT_LIB:-$REPO_ROOT/scripts/lib/agy-timeout.sh}"
# shellcheck source=/dev/null
. "$LIB"

# --- 1. the lib function ------------------------------------------------------
check_ok() { # input expected
  local out; out="$(agy_print_timeout "$1")"; local rc=$?
  assert_eq "0" "$rc" "lib: '$1' accepted"
  assert_eq "$2" "$out" "lib: '$1' -> '$2'"
}
check_bad() { # input
  local out; out="$(agy_print_timeout "$1")"; local rc=$?
  assert_neq "0" "$rc" "lib: '$1' refused"
  assert_contains "$out" "invalid --timeout value for agy" "lib: '$1' has a clear reason"
}
check_ok 900 900s
check_ok 5 5s
check_ok 900s 900s
check_ok 9m 9m
check_ok 1h30m 1h30m
check_ok 1.5h 1.5h
check_ok 250ms 250ms
check_ok 0 0s
check_ok .5s .5s
check_ok 1.s 1.s
check_ok 250µs 250µs
check_ok 250μs 250μs
check_ok 250us 250us
check_ok 1.5h30m.5s 1.5h30m.5s
check_ok 100ns 100ns
check_bad 1.5
check_bad .
check_bad .s
check_bad -1s
check_bad -.5s
check_bad +5s
check_bad " 5s"
check_bad "5s "
check_bad 5s10
check_bad ""
check_bad abc
check_bad -5
check_bad "10 m"
check_bad 1d
check_bad 9x
check_bad "9m;rm"

# --- 2/3. the rails -----------------------------------------------------------
STUB="$TEST_TMP/agy-stub"
printf '#!/usr/bin/env bash\necho "stub ok"\n' > "$STUB"; chmod +x "$STUB"
make_agy_stub_versioned "$STUB"
mk_stub() { # name VAR=val...  -> wrapper path (the rails scrub env, so controls are baked in)
  local name="$1" w="$TEST_TMP/stub-$1"; shift
  { printf '#!/usr/bin/env bash\n'; for kv in "$@"; do printf 'export %s\n' "$(printf '%q' "$kv")"; done
    printf 'case " $* " in *" --print= "*) : > %q;; esac\n' "$TEST_TMP/called-$name"; printf 'exec %q "$@"\n' "$STUB"; } > "$w"
  chmod +x "$w"; printf '%s' "$w"
}
mk_sbx() { mkdir -p "$1"; git -C "$1" init -q -b develop; git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base; }
rail_text() { # name -> rail stdout plus every existing file whose absolute path it printed
  local f="$R/$1.out" p
  cat "$f" 2>/dev/null
  grep -aoE '/[A-Za-z0-9_./-]+' "$f" 2>/dev/null | sort -u | while read -r p; do [ -f "$p" ] && [ "$p" != "$f" ] && head -c 200000 "$p" 2>/dev/null; done
}
run_case() { local n="$1"; shift; ( "$@" > "$R/$n.out" 2>&1; echo $? > "$R/$n.rc" ) < /dev/null & }
R="$TEST_TMP/r"; mkdir -p "$R"
SMALL="$TEST_TMP/small.txt"; echo "write a plan" > "$SMALL"
DIFFSMALL="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFFSMALL"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"; REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"; EXPLORE="$REPO_ROOT/scripts/dispatch-explore.sh"
M=gemini-3.7-flash-high
for n in h900 h9m hbad; do mk_sbx "$TEST_TMP/sbx-$n"; done
mk_sbx "$TEST_TMP/sbx-x"

run_case a900 env "$AUTHOR" --runner agy --model $M --prompt-file "$SMALL" --timeout 900 --bin "$(mk_stub a900 AGY_STUB_CAPTURE=1)"
run_case a9m  env "$AUTHOR" --runner agy --model $M --prompt-file "$SMALL" --timeout 9m --bin "$(mk_stub a9m AGY_STUB_CAPTURE=1)"
run_case abad env "$AUTHOR" --runner agy --model $M --prompt-file "$SMALL" --timeout 9x --bin "$(mk_stub abad AGY_STUB_CAPTURE=1)"
run_case r900 env "$REVIEW" --runner agy --model $M --diff-file "$DIFFSMALL" --timeout 900 --bin "$(mk_stub r900 AGY_STUB_CAPTURE=1 AGY_STUB_RESULT=error)"
run_case r9m  env "$REVIEW" --runner agy --model $M --diff-file "$DIFFSMALL" --timeout 9m --bin "$(mk_stub r9m AGY_STUB_CAPTURE=1 AGY_STUB_RESULT=error)"
run_case rbad env "$REVIEW" --runner agy --model $M --diff-file "$DIFFSMALL" --timeout 9x --bin "$(mk_stub rbad AGY_STUB_CAPTURE=1 AGY_STUB_RESULT=error)"
run_case h900 env -C "$TEST_TMP/sbx-h900" "$HETERO" --branch t/h900 --prompt-file "$SMALL" --timeout 900 --agy-bin "$(mk_stub h900 AGY_STUB_CAPTURE=1)" --model $M --runner agy
run_case h9m  env -C "$TEST_TMP/sbx-h9m"  "$HETERO" --branch t/h9m  --prompt-file "$SMALL" --timeout 9m  --agy-bin "$(mk_stub h9m AGY_STUB_CAPTURE=1)" --model $M --runner agy
run_case hbad env -C "$TEST_TMP/sbx-hbad" "$HETERO" --branch t/hbad --prompt-file "$SMALL" --timeout 9x  --agy-bin "$(mk_stub hbad AGY_STUB_CAPTURE=1)" --model $M --runner agy
# detached child (ledger coords => dispatch-hetero re-execs into a setsid child with an allow-listed function set):
# an invalid --timeout must fail closed with the clear precondition JSON, not "command not found".
LEDGER_SH="$REPO_ROOT/scripts/run-ledger.sh"
mk_sbx "$TEST_TMP/sbx-dbad"; mkdir -p "$TEST_TMP/dbad"
bash "$LEDGER_SH" init --ledger "$TEST_TMP/dbad/ledger.jsonl" >/dev/null
run_case dbad env -C "$TEST_TMP/sbx-dbad" DISPATCH_HEARTBEAT_SECS=1 "$HETERO" --branch t/dbad --prompt-file "$SMALL" --timeout 9x --agy-bin "$(mk_stub dbad AGY_STUB_CAPTURE=1)" --model $M --runner agy --ledger "$TEST_TMP/dbad/ledger.jsonl" --run-id rdb --stage implement
run_case d900 env -C "$TEST_TMP/sbx-dbad" DISPATCH_HEARTBEAT_SECS=1 "$HETERO" --branch t/d900 --prompt-file "$SMALL" --timeout 900 --agy-bin "$(mk_stub d900 AGY_STUB_CAPTURE=1)" --model $M --runner agy --ledger "$TEST_TMP/dbad/ledger.jsonl" --run-id rd9 --stage implement
# explore runs agy straight (no bwrap), so a recording stub on a side channel is enough.
EXREC="$TEST_TMP/explore-argv"
EXSTUB="$TEST_TMP/explore-stub"
printf '#!/usr/bin/env bash\nprintf "%%s|" "$@" >> %q\ncat >/dev/null\n' "$EXREC" > "$EXSTUB"; chmod +x "$EXSTUB"
EXBAD="$TEST_TMP/explore-bad-stub"
printf '#!/usr/bin/env bash\n: > %q\n' "$TEST_TMP/called-exbad" > "$EXBAD"; chmod +x "$EXBAD"
if command -v script >/dev/null 2>&1; then
  run_case e900 env -C "$TEST_TMP/sbx-x" "$EXPLORE" --runner agy --model x --prompt-file "$SMALL" --bin "$EXSTUB" --no-probe --timeout 900
  run_case ebad env -C "$TEST_TMP/sbx-x" "$EXPLORE" --runner agy --model x --prompt-file "$SMALL" --bin "$EXBAD" --no-probe --timeout 9x
fi
wait

argv_of() { grep -a -o 'AGY-STUB bytes=[^]]*\]' <<<"$(rail_text "$1")" | head -1; }
for rail in a r h; do
  case $rail in a) label=author;; r) label=review;; h) label=hetero;; esac
  assert_contains "$(argv_of ${rail}900)" "|--print-timeout|900s|" "$label: --timeout 900 reaches agy as 900s"
  assert_contains "$(argv_of ${rail}9m)" "|--print-timeout|9m|" "$label: --timeout 9m reaches agy unchanged"
  assert_contains "$(cat "$R/${rail}bad.out")" "invalid --timeout value for agy" "$label: --timeout 9x refused with a clear reason"
  [ ! -e "$TEST_TMP/called-${rail}bad" ] && pass_ok=1 || pass_ok=0
  assert_eq "1" "$pass_ok" "$label: agy never spawned for an invalid --timeout"
done
assert_contains "$(cat "$R/dbad.out")" "invalid --timeout value for agy" "detached hetero: invalid --timeout fails closed with the clear reason"
assert_not_contains "$(cat "$R/dbad.out")" "command not found" "detached hetero: no 'command not found' in the child"
assert_contains "$(cat "$R/dbad.out")" '"status": "precondition_failed"' "detached hetero: typed precondition_failed"
assert_contains "$(argv_of d900)$(cat "$R/d900.out")" "--print-timeout|900s|" "detached hetero: --timeout 900 reaches agy as 900s"
[ ! -e "$TEST_TMP/called-dbad" ] && pass_ok=1 || pass_ok=0
assert_eq "1" "$pass_ok" "detached hetero: agy never spawned for an invalid --timeout"
if command -v script >/dev/null 2>&1; then
  assert_contains "$(cat "$EXREC" 2>/dev/null)" "--print-timeout|900s|" "explore: --timeout 900 reaches agy as 900s"
  assert_contains "$(cat "$R/ebad.out")" "invalid --timeout value for agy" "explore: --timeout 9x refused with a clear reason"
  [ ! -e "$TEST_TMP/called-exbad" ] && pass_ok=1 || pass_ok=0
  assert_eq "1" "$pass_ok" "explore: agy never spawned for an invalid --timeout"
fi

finalize_test
