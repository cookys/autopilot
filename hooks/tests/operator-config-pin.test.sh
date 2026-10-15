#!/usr/bin/env bash
# operator-config-pin.test.sh — BL-0180 guard: the suite never reads the host's operator config.
#
# resolve-dispatch-topology.js and run-approval.js read $AUTOPILOT_CONFIG_FILE (default
# ~/.autopilot/config.json). Two pins keep a host config (topology.exclude_seats, run_approval.mode)
# out of the suites: hooks/tests/lib.sh (every suite that sources it, including a lone run) and
# hooks/tests/run.sh (L1 node --test and the suites that do not source lib.sh).
#   1. lib.sh pin  — a child that sources lib.sh with a POISONED config path and a poisoned HOME
#      must end up pointing at an empty `{}` inside its own TEST_TMP.
#   2. run.sh pin  — under run.sh (AUTOPILOT_TEST_RUN_GUARD=1) the variable must already be set to
#      an empty `{}` that is not the host file. Standalone this case SKIPs: nothing pinned it.
# Negative controls (shown red, then green, in the BL-0180 change): drop the export from lib.sh ->
# case 1 red; drop the export from run.sh -> case 2 red when run through `run.sh operator-config-pin`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# Case 2 first: it must look at the variable as run.sh handed it over, before anything here sets one.
if [ "${AUTOPILOT_TEST_RUN_GUARD:-}" = "1" ]; then
  f="${AUTOPILOT_CONFIG_FILE:-}"
  if [ -z "$f" ]; then
    bad "2: run.sh left AUTOPILOT_CONFIG_FILE unset (host ~/.autopilot/config.json would be read)"
  elif [ "$f" = "$HOME/.autopilot/config.json" ]; then
    bad "2: run.sh pinned AUTOPILOT_CONFIG_FILE to the host file ($f)"
  elif [ "$(tr -d '[:space:]' <"$f" 2>/dev/null)" != "{}" ]; then
    bad "2: run.sh pin file $f is not an empty {} (got: $(head -c 120 "$f" 2>/dev/null))"
  else
    ok "2: run.sh pinned AUTOPILOT_CONFIG_FILE to an empty {}"
  fi
else
  echo "SKIP [operator-config-pin] case 2: not under hooks/tests/run.sh (AUTOPILOT_TEST_RUN_GUARD unset)"
fi

# Case 1: lib.sh pins even when the caller exports a poisoned path and HOME holds a poisoned config.
mkdir -p "$SCRATCH/home/.autopilot"
POISON='{"topology":{"exclude_seats":["gpt-5.6-sol","claude-opus","kimi"]},"run_approval":{"mode":"ask-once"}}'
printf '%s\n' "$POISON" >"$SCRATCH/home/.autopilot/config.json"
out="$(env HOME="$SCRATCH/home" AUTOPILOT_CONFIG_FILE="$SCRATCH/home/.autopilot/config.json" \
  bash -c '. "$1/hooks/tests/lib.sh"; printf "%s\n" "$AUTOPILOT_CONFIG_FILE"; tr -d "[:space:]" <"$AUTOPILOT_CONFIG_FILE"' _ "$ROOT" 2>&1)"
path="$(printf '%s\n' "$out" | sed -n 1p)"
body="$(printf '%s\n' "$out" | tail -n 1)"
if [ "$path" = "$SCRATCH/home/.autopilot/config.json" ] || [ -z "$path" ]; then
  bad "1: lib.sh left AUTOPILOT_CONFIG_FILE on the poisoned/host path (path='$path')"
elif [ "$body" != "{}" ]; then
  bad "1: lib.sh pin file is not an empty {} (got: $body)"
else
  ok "1: lib.sh pinned a poisoned AUTOPILOT_CONFIG_FILE to an empty {}"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
