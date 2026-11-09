#!/usr/bin/env bash
# agy-bind-symlink.test.sh — agy 1.5.2 turns ~/.gemini/antigravity-cli/agents into a symlink to
# ~/.gemini/config/agents. bwrap cannot --bind onto a symlink ("Can't bind mount ... No such file or
# directory"), so the review never started agy (rc=1 / no_verdict). dispatch-review must resolve the
# mount target first (lib/agy-timeout.sh agy_bind_target) and fail closed when it resolves outside
# $HOME/.gemini. Stub agy only; every HOME here is a mktemp sandbox.
#   1. symlink -> $FAKEHOME/.gemini/config/agents (dangling): the stub IS called (bwrap bound the real path)
#   2. symlink -> outside $HOME/.gemini: precondition_failed, stub NOT called, reason names the target
#   3. real-HOME guard: with the guard armed and HOME equal to the armed real-home value (a path string
#      inside the sandbox, nothing real is touched) the rail refuses before agy; a different HOME passes
# Negative controls: AGY_BIND_SCRIPTS_DIR=<scripts dir of the pre-fix commit> turns 1 red (bwrap fails,
# stub not called) and case 3 red (no guard in the old rails).
# Skipped when bwrap is missing or cannot create a namespace.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AGY_STUB_MODELS="$(printf 'gemini-3.7-flash-high\tGemini 3.7 Flash (High)')"
export DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/dispatch-runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"

if ! command -v bwrap >/dev/null 2>&1; then
  echo "SKIP [agy-bind-symlink] bwrap not installed: the symlink bind failure only exists under bwrap"
  finalize_test; exit 0
fi
if ! bwrap --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1; then
  echo "SKIP [agy-bind-symlink] bwrap cannot create a namespace on this host"
  finalize_test; exit 0
fi

SCRIPTS="${AGY_BIND_SCRIPTS_DIR:-$REPO_ROOT/scripts}"
REVIEW="$SCRIPTS/dispatch-review.sh"
M=gemini-3.7-flash-high
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"

STUB="$TEST_TMP/agy-stub"
printf '#!/usr/bin/env bash\necho "stub ok"\n' > "$STUB"; chmod +x "$STUB"
make_agy_stub_versioned "$STUB"
mk_stub() { # name -> wrapper that records a call marker when agy is actually started
  local name="$1" w="$TEST_TMP/stub-$1"
  { printf '#!/usr/bin/env bash\n'; printf 'export AGY_STUB_CAPTURE=1 AGY_STUB_RESULT=error\n'; printf 'exec %q "$@"\n' "$STUB"; } > "$w"
  chmod +x "$w"; printf '%s' "$w"
}
mk_home() { # name target-kind -> prints fake HOME; antigravity-cli/agents is a symlink
  local h="$TEST_TMP/home-$1" kind="$2"
  mkdir -p "$h/.gemini/antigravity-cli/log" "$h/.gemini/antigravity-cli/brain" "$h/.gemini/antigravity-cli/crashes"
  case "$kind" in
    inside)  ln -s "$h/.gemini/config/agents" "$h/.gemini/antigravity-cli/agents" ;;   # dangling, agy 1.5.2 shape
    outside) mkdir -p "$TEST_TMP/elsewhere-$1"; ln -s "$TEST_TMP/elsewhere-$1" "$h/.gemini/antigravity-cli/agents" ;;
    plain)   mkdir -p "$h/.gemini/antigravity-cli/agents" ;;
  esac
  printf '%s' "$h"
}
run_review() { # name home [extra env...] -> out file $TEST_TMP/out-<name>
  local n="$1" h="$2"; shift 2
  env -i PATH="$PATH" HOME="$h" TMPDIR="$TEST_TMP" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
    AUTOPILOT_ACCOUNTS_DIR="$AUTOPILOT_ACCOUNTS_DIR" AUTOPILOT_LIVE_DIR="$AUTOPILOT_LIVE_DIR" AUTOPILOT_STRIKE_WRITER=off AUTOPILOT_SESSION_MODE_DIR="$AUTOPILOT_SESSION_MODE_DIR" AGY_STUB_MODELS="$AGY_STUB_MODELS" \
    DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_DISPATCH_RUNS_DIR="$AUTOPILOT_DISPATCH_RUNS_DIR" "$@" \
    "$REVIEW" --runner agy --model "$M" --diff-file "$DIFF" --timeout 60 --bin "$(mk_stub "$n")" \
    < /dev/null > "$TEST_TMP/out-$n" 2>&1
  echo $? > "$TEST_TMP/rc-$n"
}
called() { # name -> yes when the stub left its AGY-STUB capture line in the rail output or a file it names
  local f="$TEST_TMP/out-$1" t
  t="$(cat "$f"; grep -aoE '/[A-Za-z0-9_./-]+' "$f" | sort -u | while read -r p; do [ -f "$p" ] && [ "$p" != "$f" ] && head -c 200000 "$p"; done)"
  if grep -aq 'AGY-STUB bytes=' <<<"$t"; then echo yes; else echo no; fi
}

# 1. dangling symlink to a path inside $HOME/.gemini
H1="$(mk_home inside inside)"
run_review inside "$H1"
assert_eq "yes" "$(called inside)" "symlinked agents/ (inside ~/.gemini): the agy stub was started (bwrap bound the resolved path)"
assert_not_contains "$(cat "$TEST_TMP/out-inside")" "Can't bind mount" "symlinked agents/: no bwrap bind failure"
[ -d "$H1/.gemini/config/agents" ] && ok=1 || ok=0
assert_eq "1" "$ok" "symlinked agents/: the real target directory was created, the link left in place"

# 2. symlink leaving $HOME/.gemini: fail closed
H2="$(mk_home outside outside)"
run_review outside "$H2"
assert_eq "no" "$(called outside)" "agents/ symlinked outside ~/.gemini: agy never started"
assert_contains "$(cat "$TEST_TMP/out-outside")" "outside" "agents/ symlinked outside ~/.gemini: reason says outside"
assert_contains "$(cat "$TEST_TMP/out-outside")" "precondition_failed" "agents/ symlinked outside ~/.gemini: precondition_failed"
[ -z "$(/bin/ls -A "$TEST_TMP/elsewhere-outside")" ] && ok=1 || ok=0
assert_eq "1" "$ok" "agents/ symlinked outside ~/.gemini: the outside directory was not touched"

# 3. real-HOME guard. The "real home" is only a path string inside the sandbox; nothing real is read or written.
H3="$(mk_home guard plain)"
run_review guard "$H3" AUTOPILOT_TEST_REAL_HOME="$H3"
assert_eq "no" "$(called guard)" "HOME equal to the armed real home: agy never started"
assert_contains "$(cat "$TEST_TMP/out-guard")" "real HOME" "HOME equal to the armed real home: reason names the real HOME"
H4="$(mk_home guardok plain)"
run_review guardok "$H4" AUTOPILOT_TEST_REAL_HOME="$H3"
assert_eq "yes" "$(called guardok)" "disposable HOME with the guard armed: agy starts"
# unarmed (production shape): no guard
run_review unarmed "$H3"
assert_eq "yes" "$(called unarmed)" "guard unarmed (production): agy starts with any HOME"

finalize_test
