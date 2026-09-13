#!/usr/bin/env bash
# wait-dispatch-results.test.sh — the wait side of the detached-rail exit-file contract.
#
# Pins: (1) landing is the .exit file, not the .result.json; (2) a hand's non-zero exit is
# DATA, never this tool's exit; (3) timeout names exactly the keys that never landed;
# (4) a late writer is picked up by polling; (5) argv hygiene; (6) the real rail
# (dispatch-detach.sh via dispatch-author.sh's detach path is heavier — the contract is pinned
# here against dispatch-detach.sh's literal write sequence instead: tmp + rename, exit last).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/wait-dispatch-results.js"
LEDGER="$TEST_TMP/run.ledger"
RD="$LEDGER.results"
mkdir -p "$RD"

# (1)+(2): two landed hands, one failed (exit 7), one with no result.json yet
printf '0' > "$RD/r1.implement.exit"; echo '{"status":"ok"}' > "$RD/r1.implement.result.json"
printf '7' > "$RD/r2.implement.exit"
out="$(node "$SCRIPT" --ledger "$LEDGER" --expect r1.implement --expect r2.implement --timeout 0)"; rc=$?
assert_eq "$rc" "0" "landed hands → exit 0"
assert_contains "$out" '"complete":true' "complete true"
assert_contains "$out" '"key":"r2.implement","exit_code":7' "failed hand exit is data"
assert_contains "$out" '"result_present":true' "result presence reported"
assert_contains "$out" '"result_present":false' "missing result.json is reported, not hidden"

# (3): timeout names the missing keys only
out="$(node "$SCRIPT" --ledger "$LEDGER" --expect r1.implement --expect r3.implement --expect r4.review --timeout 1 --poll 0.2)"; rc=$?
assert_eq "$rc" "1" "timeout → exit 1"
assert_contains "$out" '"missing":["r3.implement","r4.review"]' "missing names r3"
assert_contains "$out" '"key":"r1.implement"' "done still lists r1"

# result.json alone is NOT landed (exit is written last by the rail)
echo '{}' > "$RD/r5.implement.result.json"
out="$(node "$SCRIPT" --ledger "$LEDGER" --expect r5.implement --timeout 0)"; rc=$?
assert_eq "$rc" "1" "result.json without .exit is not landed"

# malformed exit content: landed, exit_code null
printf 'nope' > "$RD/r6.implement.exit"
out="$(node "$SCRIPT" --ledger "$LEDGER" --expect r6.implement --timeout 0)"; rc=$?
assert_eq "$rc" "0" "malformed exit file still counts as landed"
assert_contains "$out" '"exit_code":null' "malformed → exit_code null"

# (4): late writer, in the rail's own order (tmp + rename, exit last)
( sleep 1; echo '{"late":1}' > "$RD/r7.implement.result.json.tmp" && mv "$RD/r7.implement.result.json.tmp" "$RD/r7.implement.result.json"
  printf '0' > "$RD/r7.implement.exit.tmp.$$" && mv "$RD/r7.implement.exit.tmp.$$" "$RD/r7.implement.exit" ) &
out="$(node "$SCRIPT" --ledger "$LEDGER" --expect r7.implement --timeout 10 --poll 0.2)"; rc=$?
wait
assert_eq "$rc" "0" "late landing picked up"
assert_contains "$out" '"key":"r7.implement","exit_code":0' "late key done"

# --results-dir explicit
out="$(node "$SCRIPT" --results-dir "$RD" --expect r1.implement --timeout 0)"; rc=$?
assert_eq "$rc" "0" "--results-dir works"

# (5) argv hygiene
node "$SCRIPT" --ledger "$LEDGER" --timeout 0 >/dev/null 2>&1; assert_eq "$?" "2" "no --expect → 2"
node "$SCRIPT" --expect a.b --timeout 0 >/dev/null 2>&1; assert_eq "$?" "2" "no ledger → 2"
node "$SCRIPT" --ledger "$LEDGER" --expect '../x.y' --timeout 0 >/dev/null 2>&1; assert_eq "$?" "2" "traversal key → 2"
node "$SCRIPT" --ledger "$LEDGER" --expect 'noStage' --timeout 0 >/dev/null 2>&1; assert_eq "$?" "2" "key without stage → 2"
node "$SCRIPT" --ledger "$LEDGER" --expect a.b --timeout -1 >/dev/null 2>&1; assert_eq "$?" "2" "negative timeout → 2"
node "$SCRIPT" --ledger "$LEDGER" --expect a.b --bogus >/dev/null 2>&1; assert_eq "$?" "2" "unknown flag → 2"

finalize_test
