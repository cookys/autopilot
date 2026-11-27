#!/usr/bin/env bash
# _worker_has_busy_descendant must look through a sudo containment wrapper (sudo_private_ns): the sudo parent and
# the worker body are not "busy"; a tool under the worker is. Fleet-Task 01M88GP63J9GTMXM23MNW5HSRK.
. "$(dirname "$0")/lib.sh"
eval "$(sed -n '/^_worker_has_busy_descendant() {/,/^}/p' "$REPO_ROOT/scripts/dispatch-hetero.sh")"
BASH_BIN="$(command -v bash)"
ln -s "$BASH_BIN" "$TEST_TMP/sudo"
ln -s "$BASH_BIN" "$TEST_TMP/workerbody"
F="$TEST_TMP/f"; mkfifo "$F"

# sudo -> worker body that only waits (no tool): not busy
"$TEST_TMP/sudo" -c "\"$TEST_TMP/workerbody\" -c 'read -t 25 _ <> \"$F\"; :'; :" & SP=$!
sleep 1
_worker_has_busy_descendant "$SP"; assert_eq "$?" 1 "sudo wrapper plus idle worker body is not busy"

# sudo -> worker body -> running tool: busy
"$TEST_TMP/sudo" -c "\"$TEST_TMP/workerbody\" -c 'sleep 25; :'; :" & SP2=$!
sleep 1
_worker_has_busy_descendant "$SP2"; assert_eq "$?" 0 "tool under the worker body is busy"

pkill -P "$SP" 2>/dev/null; pkill -P "$SP2" 2>/dev/null
kill "$SP" "$SP2" 2>/dev/null
finalize_test
