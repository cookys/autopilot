#!/usr/bin/env bash
# hooks/tests/live-pointer.test.sh — mods plan P1a R2: ~/.autopilot/live-pointer.json written by session-mode set.
# RED at 532930ed: FAIL [live-pointer] 6 passed, 4 failed
#   - set writes pointer under fake HOME: .../home/.autopilot/live-pointer.json does not exist
#   - pointer schema: expected 'autopilot.live-pointer/1', got ''
. "$(dirname "$0")/lib.sh"

export HOME="$TEST_TMP/home"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
export AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl"
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR"
unset AUTOPILOT_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_ROOT_RUN_ID
export CLAUDE_CODE_SESSION_ID="lp-session-1"

REPO="$TEST_TMP/repo"; git init -q "$REPO"
CLI="$REPO_ROOT/scripts/session-mode.js"
PTR="$TEST_TMP/live-pointer.json"
pf() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(m[process.argv[2]]))' "$PTR" "$1" 2>/dev/null; }

assert_file_absent "$PTR" "no pointer before set"
node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1 < /dev/null
assert_file_exists "$PTR" "set writes pointer under fake HOME"
assert_eq "$(pf schema)" "autopilot.live-pointer/1" "pointer schema"
assert_eq "$(pf autopilot_home)" "$TEST_TMP" "pointer autopilot_home"
EXPECT_BASE="$(node -e 'process.stdout.write(require(process.argv[1]).resolveLiveDir().base)' "$REPO_ROOT/scripts/lib/live-state-dir.js" 2>/dev/null)"
assert_eq "$(pf live_base)" "$EXPECT_BASE" "pointer live_base == resolveLiveDir() under same env"
assert_eq "$(printf '%s' "$(pf written_at)" | grep -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T')" "1" "written_at is ISO"
assert_eq "$(find "$TEST_TMP" -maxdepth 1 -name 'live-pointer.json.tmp-*' | wc -l | tr -d ' ')" "0" "no tmp residue after success"

# atomic: forced rename failure (target is a directory) leaves no tmp file and set still succeeds (fail-open)
rm -f "$PTR"; mkdir "$PTR"
node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1 < /dev/null
assert_eq "$?" "0" "set stays fail-open when the pointer cannot be written"
assert_eq "$(find "$TEST_TMP" -maxdepth 1 -name 'live-pointer.json.tmp-*' | wc -l | tr -d ' ')" "0" "no partial/tmp file after forced failure"
rmdir "$PTR"

# readLivePointer round trip
node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1 < /dev/null
RB="$(node -e 'const p=require(process.argv[1]).readLivePointer();process.stdout.write(p?p.live_base:"none")' "$REPO_ROOT/src/status/live-pointer.js" 2>/dev/null)"
assert_eq "$RB" "$EXPECT_BASE" "readLivePointer returns the written pointer"

# isolation: marker dir overridden + a second fake HOME -> pointer lands beside the marker dir, nothing under HOME
rm -f "$PTR"
HOME2="$TEST_TMP/home2"; mkdir -p "$HOME2"
HOME="$HOME2" AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/fx/session-mode" node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1 < /dev/null
assert_file_exists "$TEST_TMP/fx/live-pointer.json" "pointer lands at <dirname of marker dir>/live-pointer.json"
assert_file_absent "$HOME2/.autopilot/live-pointer.json" "nothing written under HOME when marker dir is isolated"
assert_eq "$(find "$HOME2" -type f | wc -l | tr -d ' ')" "0" "second HOME untouched"

# default (no override): pointer under $HOME/.autopilot
HOME="$HOME2" env -u AUTOPILOT_SESSION_MODE_DIR AUTOPILOT_LIVE_DIR="$AUTOPILOT_LIVE_DIR" node -e 'require(process.argv[1]).writeLivePointer()' "$REPO_ROOT/src/status/live-pointer.js" 2>/dev/null
assert_file_exists "$HOME2/.autopilot/live-pointer.json" "default location is HOME/.autopilot"

finalize_test
