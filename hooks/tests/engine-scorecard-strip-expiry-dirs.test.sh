#!/usr/bin/env bash
# BL-0339: strip-expiry rewrites both the scorecard directory and the capability
# directory. Overriding exactly one of them used to leave the other on the real
# ~/.autopilot store and write it.
#
# Negative control (shown red before the guard, sandbox HOME, only
# ENGINE_SCORECARD_DIR set, no --dry-run): exit 0, stderr empty, the default
# capability pins.jsonl lost its expires field and a .bak-strip-expiry file was
# written beside it. After the guard the same invocation exits non-zero, names
# the split, and leaves both files byte-identical. One override of either
# directory, including ENGINE_CAPABILITY_FILE and an env var that points at the
# default path, is the broken case. Both overridden, or neither, still migrates.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESC="$ROOT/scripts/engine-scorecard.js"
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR"' EXIT
SANDBOX_HOME="$TESTDIR/home"
mkdir -p "$SANDBOX_HOME"

REAL_HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
size_of() { if [ -f "$1" ]; then stat -c%s "$1"; else echo 0; fi; }
REAL_SC="$REAL_HOME/.autopilot/engine-scorecard/scorecard.jsonl"
REAL_PINS="$REAL_HOME/.autopilot/engine-capability/pins.jsonl"
REAL_EV="$REAL_HOME/.autopilot/engine-capability/qualification-evidence.jsonl"
REAL_SC_BEFORE="$(size_of "$REAL_SC")"
REAL_PINS_BEFORE="$(size_of "$REAL_PINS")"
REAL_EV_BEFORE="$(size_of "$REAL_EV")"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }
sha_of() { sha256sum "$1" | awk '{print $1}'; }

plant_legacy() { # scorecard_dir capability_dir
  mkdir -p "$1" "$2"
  printf '%s\n' '{"expires":"2099-01-01","engine":"canary"}' > "$1/scorecard.jsonl"
  printf '%s\n' '{"expires":null,"engine":"canary","role":"implementer"}' > "$2/pins.jsonl"
}

# run_strip OUT [KEY=VAL...] -- [extra node args...]
# The three store selectors start unset; assignments after that are the override.
run_strip() {
  local out="$1"
  shift
  local envargs=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    envargs+=("$1")
    shift
  done
  if [ "${1:-}" = "--" ]; then
    shift
  fi
  env -u ENGINE_SCORECARD_DIR -u ENGINE_CAPABILITY_DIR -u ENGINE_CAPABILITY_FILE \
    -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$SANDBOX_HOME" \
    "${envargs[@]}" \
    node "$ESC" strip-expiry "$@" >"$out.out" 2>"$out.err"
  printf '%s' "$?" >"$out.rc"
}

reset_defaults() { rm -rf "$SANDBOX_HOME/.autopilot"; }

# label out scorecard.jsonl pins.jsonl
assert_refused() {
  local label="$1" out="$2" sc="$3" pins="$4"
  local rc msg sc_after pins_after backups
  rc="$(cat "$out.rc")"
  msg="$(cat "$out.err" "$out.out")"
  sc_after="$(sha_of "$sc")"
  pins_after="$(sha_of "$pins")"
  backups="$(find "$(dirname "$sc")" "$(dirname "$pins")" -name '*.bak-strip-expiry-*' -print 2>/dev/null || true)"
  if [ "$rc" != "0" ] \
    && grep -q "exactly one of the two store directories is overridden" <<<"$msg" \
    && grep -q "nothing written" <<<"$msg" \
    && [ "$sc_after" = "$5" ] && [ "$pins_after" = "$6" ] \
    && [ -z "$backups" ]; then
    ok "$label"
  else
    bad "$label: rc=$rc sc_same=$([ "$sc_after" = "$5" ] && echo yes || echo no) pins_same=$([ "$pins_after" = "$6" ] && echo yes || echo no) backups=${backups:-none} msg=$(printf '%s' "$msg" | tr '\n' ' ')"
  fi
}

# --- one override: scorecard copy, capability left on the default store -------
reset_defaults
A_SC="$TESTDIR/a-sc"
A_CAP="$SANDBOX_HOME/.autopilot/engine-capability"
plant_legacy "$A_SC" "$A_CAP"
A_SC_SHA="$(sha_of "$A_SC/scorecard.jsonl")"
A_PINS_SHA="$(sha_of "$A_CAP/pins.jsonl")"
run_strip "$TESTDIR/a" "ENGINE_SCORECARD_DIR=$A_SC" --
assert_refused "one override ENGINE_SCORECARD_DIR is refused and writes nothing" \
  "$TESTDIR/a" "$A_SC/scorecard.jsonl" "$A_CAP/pins.jsonl" "$A_SC_SHA" "$A_PINS_SHA"

# same split, dry-run: still refused, still no write
reset_defaults
A2_SC="$TESTDIR/a2-sc"
A2_CAP="$SANDBOX_HOME/.autopilot/engine-capability"
plant_legacy "$A2_SC" "$A2_CAP"
A2_SC_SHA="$(sha_of "$A2_SC/scorecard.jsonl")"
A2_PINS_SHA="$(sha_of "$A2_CAP/pins.jsonl")"
run_strip "$TESTDIR/a2" "ENGINE_SCORECARD_DIR=$A2_SC" -- --dry-run
assert_refused "one override ENGINE_SCORECARD_DIR --dry-run is refused and writes nothing" \
  "$TESTDIR/a2" "$A2_SC/scorecard.jsonl" "$A2_CAP/pins.jsonl" "$A2_SC_SHA" "$A2_PINS_SHA"

# --- one override: capability copy, scorecard left on the default store ------
reset_defaults
B_SC="$SANDBOX_HOME/.autopilot/engine-scorecard"
B_CAP="$TESTDIR/b-cap"
plant_legacy "$B_SC" "$B_CAP"
B_SC_SHA="$(sha_of "$B_SC/scorecard.jsonl")"
B_PINS_SHA="$(sha_of "$B_CAP/pins.jsonl")"
run_strip "$TESTDIR/b" "ENGINE_CAPABILITY_DIR=$B_CAP" --
assert_refused "one override ENGINE_CAPABILITY_DIR is refused and writes nothing" \
  "$TESTDIR/b" "$B_SC/scorecard.jsonl" "$B_CAP/pins.jsonl" "$B_SC_SHA" "$B_PINS_SHA"

# ENGINE_CAPABILITY_FILE selects the capability directory the same way.
reset_defaults
C_SC="$SANDBOX_HOME/.autopilot/engine-scorecard"
C_CAP="$TESTDIR/c-cap"
plant_legacy "$C_SC" "$C_CAP"
: > "$C_CAP/capability.jsonl"
C_SC_SHA="$(sha_of "$C_SC/scorecard.jsonl")"
C_PINS_SHA="$(sha_of "$C_CAP/pins.jsonl")"
run_strip "$TESTDIR/c" "ENGINE_CAPABILITY_FILE=$C_CAP/capability.jsonl" --
assert_refused "one override ENGINE_CAPABILITY_FILE is refused and writes nothing" \
  "$TESTDIR/c" "$C_SC/scorecard.jsonl" "$C_CAP/pins.jsonl" "$C_SC_SHA" "$C_PINS_SHA"

# Both env vars set, but the capability value IS the default store: still a split.
reset_defaults
D_SC="$TESTDIR/d-sc"
D_CAP="$SANDBOX_HOME/.autopilot/engine-capability"
plant_legacy "$D_SC" "$D_CAP"
D_SC_SHA="$(sha_of "$D_SC/scorecard.jsonl")"
D_PINS_SHA="$(sha_of "$D_CAP/pins.jsonl")"
run_strip "$TESTDIR/d" "ENGINE_SCORECARD_DIR=$D_SC" "ENGINE_CAPABILITY_DIR=$D_CAP" --
assert_refused "ENGINE_CAPABILITY_DIR pointing at the real store is still one override" \
  "$TESTDIR/d" "$D_SC/scorecard.jsonl" "$D_CAP/pins.jsonl" "$D_SC_SHA" "$D_PINS_SHA"

# --- both overridden: the legacy row migrates, the default store is untouched -
reset_defaults
E_SC="$TESTDIR/e-sc"
E_CAP="$TESTDIR/e-cap"
E_DEF_SC="$SANDBOX_HOME/.autopilot/engine-scorecard"
E_DEF_CAP="$SANDBOX_HOME/.autopilot/engine-capability"
plant_legacy "$E_SC" "$E_CAP"
mkdir -p "$E_DEF_SC" "$E_DEF_CAP"
printf '%s\n' '{"engine":"untouched-default"}' > "$E_DEF_SC/scorecard.jsonl"
printf '%s\n' '{"engine":"untouched-default"}' > "$E_DEF_CAP/pins.jsonl"
E_DEF_SC_SHA="$(sha_of "$E_DEF_SC/scorecard.jsonl")"
E_DEF_PINS_SHA="$(sha_of "$E_DEF_CAP/pins.jsonl")"
run_strip "$TESTDIR/e" "ENGINE_SCORECARD_DIR=$E_SC" "ENGINE_CAPABILITY_DIR=$E_CAP" --
E_RC="$(cat "$TESTDIR/e.rc")"
E_LEFT="$(grep -h '"expires' "$E_SC/scorecard.jsonl" "$E_CAP/pins.jsonl" || true)"
if [ "$E_RC" = "0" ] && grep -q '"already_migrated":false' "$TESTDIR/e.out" \
  && [ -z "$E_LEFT" ] \
  && [ "$(sha_of "$E_DEF_SC/scorecard.jsonl")" = "$E_DEF_SC_SHA" ] \
  && [ "$(sha_of "$E_DEF_CAP/pins.jsonl")" = "$E_DEF_PINS_SHA" ]; then
  ok "both directories overridden: legacy expiry is stripped and the default store is untouched"
else
  bad "both overridden: rc=$E_RC left=$E_LEFT out=$(cat "$TESTDIR/e.out") err=$(cat "$TESTDIR/e.err")"
fi

# --- neither overridden: the sandbox default stores migrate -------------------
reset_defaults
F_SC="$SANDBOX_HOME/.autopilot/engine-scorecard"
F_CAP="$SANDBOX_HOME/.autopilot/engine-capability"
plant_legacy "$F_SC" "$F_CAP"
run_strip "$TESTDIR/f" --
F_RC="$(cat "$TESTDIR/f.rc")"
F_LEFT="$(grep -h '"expires' "$F_SC/scorecard.jsonl" "$F_CAP/pins.jsonl" || true)"
if [ "$F_RC" = "0" ] && grep -q '"already_migrated":false' "$TESTDIR/f.out" && [ -z "$F_LEFT" ]; then
  ok "neither directory overridden: the default stores migrate"
else
  bad "neither overridden: rc=$F_RC left=$F_LEFT out=$(cat "$TESTDIR/f.out") err=$(cat "$TESTDIR/f.err")"
fi

REAL_SC_AFTER="$(size_of "$REAL_SC")"
REAL_PINS_AFTER="$(size_of "$REAL_PINS")"
REAL_EV_AFTER="$(size_of "$REAL_EV")"
if [ "$REAL_SC_AFTER" = "$REAL_SC_BEFORE" ] && [ "$REAL_PINS_AFTER" = "$REAL_PINS_BEFORE" ] \
  && [ "$REAL_EV_AFTER" = "$REAL_EV_BEFORE" ]; then
  ok "the operator real scorecard and capability stores were not written"
else
  bad "operator real store size changed (scorecard $REAL_SC_BEFORE->$REAL_SC_AFTER pins $REAL_PINS_BEFORE->$REAL_PINS_AFTER evidence $REAL_EV_BEFORE->$REAL_EV_AFTER)"
fi

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
