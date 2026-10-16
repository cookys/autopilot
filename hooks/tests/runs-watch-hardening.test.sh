#!/usr/bin/env bash
# BL-0109: (1) the autostart gate accepts 0/false/off/no and is off by default under `node --test`; (2) startWatcherDetached
# reports a missing nohup/sh up front instead of returning 'started' for an async spawn that then fails.
# Negative controls: gate always-enabled -> cases 1-3 red; no PATH preflight -> case 4 red (it returns 'started').
. "$(dirname "$0")/lib.sh"
trap 'cleanup_test_tmp' EXIT

gate() { # <env assignments as node object source> -> true|false
  node -e 'const {autostartDisabled}=require(process.argv[1]+"/src/status/autostart-gate"); process.stdout.write(String(autostartDisabled('"$1"')))' "$REPO_ROOT"; }
assert_eq "$(gate '{AUTOPILOT_RUNS_WATCH_AUTOSTART:"0"}')" "true" "0 disables"
assert_eq "$(gate '{AUTOPILOT_RUNS_WATCH_AUTOSTART:"Off"}')" "true" "off (any case) disables"
assert_eq "$(gate '{NODE_TEST_CONTEXT:"child-v8"}')" "true" "unset under node --test is disabled"
assert_eq "$(gate '{}')" "false" "unset outside a test runner stays enabled"
assert_eq "$(gate '{NODE_TEST_CONTEXT:"child-v8",AUTOPILOT_RUNS_WATCH_AUTOSTART:""}')" "false" "empty string is an explicit enable even under node --test"
assert_eq "$(gate '{AUTOPILOT_RUNS_WATCH_AUTOSTART:"1"}')" "false" "1 enables"

# 4. missing nohup -> error up front
BIN="$TEST_TMP/bin"; mkdir -p "$BIN" "$TEST_TMP/live"; chmod 700 "$TEST_TMP/live"
ln -s "$(command -v flock)" "$BIN/flock"; printf "#!/bin/sh\nexit 0\n" > "$BIN/true"; chmod +x "$BIN/true"
out="$(PATH="$BIN" AUTOPILOT_LIVE_DIR="$TEST_TMP/live" HOME="$TEST_TMP" "$(command -v node)" -e '
  const r = require(process.argv[1] + "/src/status/runs-watch").startWatcherDetached({ key: "0123456789abcdef", cwd: process.argv[2], env: process.env });
  process.stdout.write(r.status + ":" + (r.message || ""));
' "$REPO_ROOT" "$TEST_TMP")"
assert_eq "$out" "error:nohup is not on PATH" "a missing nohup is reported before spawning"
finalize_test
