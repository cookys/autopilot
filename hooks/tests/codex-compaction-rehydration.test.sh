#!/usr/bin/env bash
# Replay the recorded 16/34 compaction incident: rehydrate authoritative
# root/phase/accepted-commit/next-action, attach instead of re-dispatch, and
# fail closed on incomplete or absent identities.
. "$(dirname "$0")/lib.sh"

RH="$REPO_ROOT/scripts/compaction-rehydrate.js"
CK="$TEST_TMP/continuation-16-34.json"
MANIFEST_DIR="$TEST_TMP/dispatch-runs"
mkdir -p "$MANIFEST_DIR"

# --- write complete 16/34 checkpoint ---
WRITE="$(node "$RH" write \
  --out "$CK" \
  --root-run-id "root-mission-16-34" \
  --phase-cursor "16/34" \
  --accepted-commit "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  --next-action "continue portfolio phase 16 of 34" \
  --branch "feat/runtime-convergence" \
  --stage "implement" \
  --base-sha "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
  --project "runtime-convergence-mvp" \
  --idempotency-key "compact-16-34")"
assert_eq "$(jq -r .status <<<"$WRITE")" "written" "checkpoint write ok"
assert_file_exists "$CK" "checkpoint file exists"
assert_eq "$(jq -r .phase_cursor "$CK")" "16/34" "phase cursor 16/34 persisted"

# --- rehydrate authoritative fields ---
REHYDRATE="$(node "$RH" rehydrate --checkpoint "$CK")"
assert_eq "$(jq -r .status <<<"$REHYDRATE")" "rehydrated" "rehydrate status"
assert_eq "$(jq -r .root_run_id <<<"$REHYDRATE")" "root-mission-16-34" "root run rehydrated"
assert_eq "$(jq -r .phase_cursor <<<"$REHYDRATE")" "16/34" "phase cursor rehydrated to 16/34"
assert_eq "$(jq -r .accepted_commit <<<"$REHYDRATE")" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "accepted commit rehydrated"
assert_eq "$(jq -r .next_action <<<"$REHYDRATE")" "continue portfolio phase 16 of 34" "next action rehydrated"
assert_eq "$(jq -r .duplicate_dispatch <<<"$REHYDRATE")" "0" "rehydrate reports zero duplicate dispatch"

# --- first admit with no matching run: admit new once at 16/34 ---
ADMIT1="$(node "$RH" admit \
  --checkpoint "$CK" \
  --root-run-id "root-mission-16-34" \
  --branch "feat/runtime-convergence" \
  --stage "implement" \
  --base-sha "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
  --manifest-dir "$MANIFEST_DIR")"
assert_eq "$(jq -r .status <<<"$ADMIT1")" "admit" "first admit allows one dispatch"
assert_eq "$(jq -r .action <<<"$ADMIT1")" "dispatch_new" "first action is dispatch_new"
assert_eq "$(jq -r .phase_cursor <<<"$ADMIT1")" "16/34" "admit preserves 16/34"
assert_eq "$(jq -r .duplicate_dispatch <<<"$ADMIT1")" "0" "first admit duplicate_dispatch=0"

# Simulate the first dispatch by writing an active matching manifest.
cat > "$MANIFEST_DIR/run-16-34.manifest.json" <<'EOF'
{
  "schema": 1,
  "run_id": "run-16-34-active",
  "root_run_id": "root-mission-16-34",
  "role": "implementer",
  "branch": "feat/runtime-convergence",
  "base": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "stage": "implement",
  "final_status": null,
  "ended_at": null
}
EOF

# --- second admit: attach existing, zero duplicate dispatch ---
ADMIT2="$(node "$RH" admit \
  --checkpoint "$CK" \
  --root-run-id "root-mission-16-34" \
  --branch "feat/runtime-convergence" \
  --stage "implement" \
  --base-sha "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
  --manifest-dir "$MANIFEST_DIR")"
assert_eq "$(jq -r .status <<<"$ADMIT2")" "attach" "second admit attaches existing run"
assert_eq "$(jq -r .action <<<"$ADMIT2")" "attach_existing" "action is attach_existing"
assert_eq "$(jq -r .attached_run_id <<<"$ADMIT2")" "run-16-34-active" "attaches the active run"
assert_eq "$(jq -r .phase_cursor <<<"$ADMIT2")" "16/34" "attach still at 16/34"
assert_eq "$(jq -r .duplicate_dispatch <<<"$ADMIT2")" "0" "attach records zero duplicate dispatch"

# --- terminal matching run → resume ---
cat > "$MANIFEST_DIR/run-16-34.manifest.json" <<'EOF'
{
  "schema": 1,
  "run_id": "run-16-34-done",
  "root_run_id": "root-mission-16-34",
  "role": "implementer",
  "branch": "feat/runtime-convergence",
  "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "stage": "implement",
  "final_status": "committed",
  "ended_at": "2026-07-28T12:00:00Z"
}
EOF
ADMIT3="$(node "$RH" admit \
  --checkpoint "$CK" \
  --root-run-id "root-mission-16-34" \
  --branch "feat/runtime-convergence" \
  --stage "implement" \
  --manifest-dir "$MANIFEST_DIR")"
assert_eq "$(jq -r .status <<<"$ADMIT3")" "resume" "terminal matching run resumes"
assert_eq "$(jq -r .action <<<"$ADMIT3")" "resume_terminal" "action is resume_terminal"
assert_eq "$(jq -r .phase_cursor <<<"$ADMIT3")" "16/34" "resume still at 16/34"
assert_eq "$(jq -r .duplicate_dispatch <<<"$ADMIT3")" "0" "resume zero duplicate dispatch"

# --- incomplete checkpoint fails closed ---
INCOMPLETE="$TEST_TMP/incomplete.json"
printf '%s\n' '{"schema_version":1,"artifact_type":"continuation_checkpoint","root_run_id":"x"}' > "$INCOMPLETE"
set +e
INC_OUT="$(node "$RH" rehydrate --checkpoint "$INCOMPLETE" 2>/dev/null)"
INC_RC=$?
set -e
assert_eq "$INC_RC" "1" "incomplete rehydrate exits 1"
assert_eq "$(jq -r .status <<<"$INC_OUT")" "reject" "incomplete rejects"
assert_eq "$(jq -r .reason_code <<<"$INC_OUT")" "incomplete_checkpoint" "incomplete reason_code"
assert_eq "$(jq -r .duplicate_dispatch <<<"$INC_OUT")" "0" "incomplete still zero dispatch"

# --- absent identity remains not_found under strict match ---
set +e
NF_OUT="$(node "$RH" admit --root-run-id "no-such-root" --strict-match --manifest-dir "$MANIFEST_DIR" 2>/dev/null)"
NF_RC=$?
set -e
assert_eq "$NF_RC" "1" "absent id exits 1"
assert_eq "$(jq -r .status <<<"$NF_OUT")" "not_found" "absent id is not_found"
assert_eq "$(jq -r .reason_code <<<"$NF_OUT")" "not_found" "not_found reason_code"

# --- engine pre-dispatch attach short-circuit ---
ENGINE_OUT="$(node - "$REPO_ROOT" "$CK" <<'NODE'
'use strict';
const path = require('path');
const { AutopilotEngine } = require(path.join(process.argv[2], 'src', 'engine', 'autopilot-engine'));
const engine = new AutopilotEngine({
  cwd: process.argv[2],
  implementationDispatcher: () => {
    throw new Error('dispatcher must not run when attach is selected');
  },
});
const result = engine.implementTask({
  promptFile: path.join(process.argv[2], 'scripts', 'compaction-rehydrate.js'),
  branch: 'feat/runtime-convergence',
  base: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  roster: {
    implementer_runner: 'fixture',
    implementer_engine: 'fixture',
    implementer_effort: 'low',
  },
  continuationCheckpointPath: process.argv[3],
  continuationMatchingRuns: [{
    run_id: 'engine-attach-run',
    root_run_id: 'root-mission-16-34',
    branch: 'feat/runtime-convergence',
    base_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    stage: 'implement',
    final_status: null,
  }],
  env: {
    AUTOPILOT_ROOT_RUN_ID: 'root-mission-16-34',
  },
  implementationOptions: {
    env: {
      AUTOPILOT_ROOT_RUN_ID: 'root-mission-16-34',
    },
  },
});
process.stdout.write(JSON.stringify({
  status: result.status,
  phase: result.phase,
  phase_cursor: result.phase_cursor,
  duplicate_dispatch: result.duplicate_dispatch,
  attached_run_id: result.attached_run_id,
}));
NODE
)"
assert_eq "$(jq -r .status <<<"$ENGINE_OUT")" "attached" "engine attaches instead of dispatching"
assert_eq "$(jq -r .phase_cursor <<<"$ENGINE_OUT")" "16/34" "engine resumes phase 16/34"
assert_eq "$(jq -r .duplicate_dispatch <<<"$ENGINE_OUT")" "0" "engine zero duplicate dispatch"
assert_eq "$(jq -r .attached_run_id <<<"$ENGINE_OUT")" "engine-attach-run" "engine attaches named run"

finalize_test
