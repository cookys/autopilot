#!/usr/bin/env bash
# Retired / unknown runner rungs in a per-host topology file: resolve-review-loop.sh skips them with one
# warning instead of exit 3 (2026-11-14: a retired qoderclicn rung killed every dispatch-consult);
# scripts/topology-prune.js --check/--fix cleans the file; --lint keeps the registry and the known-runner
# map in step. Temp topology only; the real ~/.autopilot is never read or written.
. "$(dirname "$0")/lib.sh"

RRL="$REPO_ROOT/scripts/resolve-review-loop.sh"
PRUNE="$REPO_ROOT/scripts/topology-prune.js"
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
EMPTY_CFG="$TEST_TMP/empty.md"
: > "$EMPTY_CFG"
TOPO="$TEST_TMP/topology.json"

write_topo() { printf '%s' "$1" > "$TOPO"; }
resolve() { # resolve <stdout-file> <stderr-file>; sets RC
  AUTOPILOT_TOPOLOGY_FILE="$TOPO" REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$RRL" >"$1" 2>"$2" </dev/null
  RC=$?
}
jget() { node -e 'let v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }

RETIRED_TOPO='{"schema_version":1,"runners_installed":{"codex":"/x","qoderclicn":null},"implementer_ladder":[{"engine":"Qwen3.8-Max","effort":"high","runner":"qoderclicn"},{"engine":"gpt-6.1-sol","effort":"low","runner":"codex"}],"reviewer_ladder":[],"consult_ladder":[{"engine":"Qwen3.8-Max","effort":"high","runner":"qoderclicn","endpoint":""}],"discuss_ladder":[],"plan_review_panel":[]}'

# 1. a retired runner's rung is skipped with one warning; the valid rung survives
write_topo "$RETIRED_TOPO"
resolve "$TEST_TMP/o1" "$TEST_TMP/e1"
assert_exit_code "$RC" 0 "retired rung: resolver exits 0 (was 3)"
assert_contains "$(cat "$TEST_TMP/e1")" "resolve-review-loop: ⚠ skipped rung Qwen3.8-Max/high@qoderclicn: runner qoderclicn retired (topology $TOPO)" "retired rung: warn line names rung, runner, word and path"
assert_contains "$(jget "$TEST_TMP/o1" implementer_ladder)" '"runner":"codex"' "retired rung: the valid rung stays in the ladder"
assert_not_contains "$(jget "$TEST_TMP/o1" implementer_ladder)" "qoderclicn" "retired rung: skipped rung is not in the ladder"

# 2. a runner that is not in the registry either is skipped as unknown
write_topo "${RETIRED_TOPO//qoderclicn/mysteryrunner}"
resolve "$TEST_TMP/o2" "$TEST_TMP/e2"
assert_exit_code "$RC" 0 "unknown runner: resolver exits 0"
assert_contains "$(cat "$TEST_TMP/e2")" "skipped rung Qwen3.8-Max/high@mysteryrunner: runner mysteryrunner unknown" "unknown runner: word is unknown"

# 3. a ladder emptied by skips is not silent: the warning names the skipped rungs
assert_contains "$(cat "$TEST_TMP/e1")" "consult_ladder emptied by skipped rungs (Qwen3.8-Max/high@qoderclicn)" "emptied ladder: message lists the skipped rungs"
assert_eq "native-fallback" "$(jget "$TEST_TMP/o1" consult_resolved_from)" "emptied consult ladder: falls back to native like an empty ladder always did"

# 4. genuinely malformed input keeps its old behaviour: a known runner with a bad effort is still exit 3
write_topo '{"implementer_ladder":[{"engine":"x","effort":"bogus","runner":"codex"}]}'
resolve "$TEST_TMP/o4" "$TEST_TMP/e4"
assert_exit_code "$RC" 3 "bad effort on a known runner: still exit 3"
write_topo '{not json'
resolve "$TEST_TMP/o4b" "$TEST_TMP/e4b"
assert_not_contains "$(cat "$TEST_TMP/e4b")" "skipped rung" "unparseable topology: no skip warning (handled by the existing no-topology path)"

# 5. unknown keys in the runner-binary map are ignored silently
write_topo '{"runners_installed":{"qoderclicn":null,"zzz":"/y"},"implementer_ladder":[],"consult_ladder":[]}'
resolve "$TEST_TMP/o5" "$TEST_TMP/e5"
assert_exit_code "$RC" 0 "runners_installed with retired/unknown keys: exit 0"
assert_not_contains "$(cat "$TEST_TMP/e5")" "qoderclicn" "runners_installed keys produce no warning"

# 6. prune --check lists leftovers and exits 1
write_topo "$RETIRED_TOPO"
ORIG="$(cat "$TOPO")"
CHK="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO" node "$PRUNE" --check)"; RC=$?
assert_exit_code "$RC" 1 "prune --check with leftovers exits 1"
assert_contains "$CHK" "topology_retired: 3 leftovers (Qwen3.8-Max/high@qoderclicn, Qwen3.8-Max/high@qoderclicn, runners_installed.qoderclicn)" "prune --check lists the leftovers"

# 7. prune --fix: backup identical to the original, file cleaned, audit line carries the restore command
FIX="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO" node "$PRUNE" --fix)"; RC=$?
assert_exit_code "$RC" 0 "prune --fix exits 0"
BAK="$(printf '%s' "$FIX" | sed -n 's/.*backup \([^;]*\); restore.*/\1/p')"
assert_file_exists "$BAK" "prune --fix wrote a backup"
assert_eq "$ORIG" "$(cat "$BAK")" "backup equals the original byte for byte"
assert_contains "$FIX" "restore: cp $BAK $TOPO" "audit line carries the restore command"
assert_not_contains "$(cat "$TOPO")" "qoderclicn" "pruned file has no retired rung or runners_installed key"
assert_contains "$(cat "$TOPO")" '"runner": "codex"' "pruned file keeps the valid rung"

# 8. second --fix is clean and writes no new backup; --check is clean too
N1="$(find "$TEST_TMP" -maxdepth 1 -name 'topology.json.bak.*' | wc -l)"
AUTOPILOT_TOPOLOGY_FILE="$TOPO" node "$PRUNE" --fix > "$TEST_TMP/fix2"
N2="$(find "$TEST_TMP" -maxdepth 1 -name 'topology.json.bak.*' | wc -l)"
assert_eq "topology_retired: clean" "$(cat "$TEST_TMP/fix2")" "second --fix reports clean"
assert_eq "$N1" "$N2" "second --fix writes no new backup"
AUTOPILOT_TOPOLOGY_FILE="$TOPO" node "$PRUNE" --check >/dev/null; RC=$?
assert_exit_code "$RC" 0 "prune --check on the pruned file exits 0"

# 9. lint: the live tree is clean; a retired name put back into a TEMP copy of the known-runner map goes red
node "$PRUNE" --lint >/dev/null; RC=$?
assert_exit_code "$RC" 0 "lint passes on the repo"
sed "s/^  codex: 'codex',/  codex: 'codex',\n  qoderclicn: 'qoderclicn',/" "$REPO_ROOT/scripts/lib/runner-binary.js" > "$TEST_TMP/runner-binary-bad.js"
LINT="$(node "$PRUNE" --lint --runner-binary "$TEST_TMP/runner-binary-bad.js")"; RC=$?
assert_exit_code "$RC" 1 "lint fails when a retired runner is back in the known list"
assert_contains "$LINT" "qoderclicn still in the known-runner map" "lint names the runner"

finalize_test
