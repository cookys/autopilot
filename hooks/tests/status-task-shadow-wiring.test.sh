#!/usr/bin/env bash
# Proves the shadow observer is actually WIRED into `status task`, not merely present.
#
# This suite exists because the module shipped once with zero callers while its commit
# message claimed it had one. A component with no caller is indistinguishable from a
# component that was never written, and unit tests on the module itself cannot tell the
# difference — they pass either way. Only an end-to-end run can.
. "$(dirname "$0")/lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export AUTOPILOT_TASK_STATUS_DIR="$WORK/task-status"
export AUTOPILOT_DIVERGENCE_STORE="$WORK/divergence.jsonl"
mkdir -p "$AUTOPILOT_TASK_STATUS_DIR"

RUN_ID="shadow-wiring-probe"
cat > "$AUTOPILOT_TASK_STATUS_DIR/$RUN_ID.json" <<JSON
{ "root_run_id": "$RUN_ID", "repo": ".", "goal": "shadow wiring probe", "phase": "probe",
  "mission": { "state": null, "terminal_receipt": null },
  "campaigns": [], "lifecycle_receipt_path": null,
  "integration": { "target_ref": "refs/heads/develop", "consumer_ref": null,
                   "remote_ref": null, "push_required": false, "required_consumer_update": false },
  "merge_preflight": null, "merge_execution": null, "merge_provenance": null }
JSON

# The status answer itself must be produced, and produced unchanged by the observer.
OUT="$(cd "$REPO_ROOT" && node bin/autopilot.js status task --root-run-id "$RUN_ID" --json 2>"$WORK/err.txt")"
RC=$?
assert_eq "$RC" "0" "status task must still succeed with the observer wired in"
assert_contains "$OUT" '"root_run_id"' "the authoritative receipt must still be emitted"

# The decisive assertion: an observation reached the store. If the wiring is removed or
# the require path breaks, this file stays absent and this line fails.
assert_file_exists "$AUTOPILOT_DIVERGENCE_STORE" "the observer must have recorded an observation"

ROW="$(tail -1 "$AUTOPILOT_DIVERGENCE_STORE")"
SHAPE="$(printf '%s' "$ROW" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log([o.entry_path,o.kind,typeof o.shadow_decision,typeof o.legacy_decision,o.run_id].join('|'))})")"
assert_eq "$SHAPE" "/status-task|paired|string|string|$RUN_ID" "the observation must be a paired row carrying both decisions and the run id"

# A second run appends rather than replaces — the store is an accumulating record.
(cd "$REPO_ROOT" && node bin/autopilot.js status task --root-run-id "$RUN_ID" --json >/dev/null 2>&1)
COUNT="$(grep -c . "$AUTOPILOT_DIVERGENCE_STORE")"
assert_eq "$COUNT" "2" "each status task call must append one observation"

# The monitor must be able to read what the observer wrote — one row shape, not two.
SUMMARY="$(cd "$REPO_ROOT" && node scripts/divergence-monitor.js report --path /status-task --store "$AUTOPILOT_DIVERGENCE_STORE" --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log([o.samples,o.corrupt_rows].join('|'))})")"
assert_eq "$SUMMARY" "2|0" "the monitor must parse the observer's rows as samples, with no corruption"

# A broken store location must not break status task: shadow is fail-open by design.
# Use a real read-only directory, not a /proc path — /proc has special semantics that made
# node spin instead of failing fast, which would have tested the harness, not the property.
RO_DIR="$WORK/readonly"
mkdir -p "$RO_DIR" && chmod 0500 "$RO_DIR"
AUTOPILOT_DIVERGENCE_STORE="$RO_DIR/store.jsonl" \
  bash -c "cd '$REPO_ROOT' && node bin/autopilot.js status task --root-run-id '$RUN_ID' --json >/dev/null 2>&1"
RO_RC=$?
chmod 0700 "$RO_DIR"
assert_eq "$RO_RC" "0" "an unwritable observation store must not fail the authoritative answer"

finalize_test
