#!/usr/bin/env bash
# Stage events written by the transition script itself (fleet progress via stage-event.js).
# RED before the helper and the four call sites: no fleet log line, or a second call, or a changed exit.
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL AUTOPILOT_PARENT_SESSION_ID
export GIT_CONFIG_COUNT=0

TASK="01M7SCEH0RR5R3X691EF024RT5"
BIN="$TEST_TMP/bin"
mkdir -p "$BIN"
FLEET_LOG="$TEST_TMP/fleet.log"
cat > "$BIN/fleet" << 'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "${FLEET_LOG:?}"
rc="${FLEET_RC:-0}"
if [ "$rc" != "0" ]; then
  echo "stub failed" >&2
  exit "$rc"
fi
if [ "$1" = "task" ] && [ "$2" = "show" ]; then
  printf '%s\n' '{"status":"open","title":"[XS] stage event"}'
fi
exit 0
EOF
chmod +x "$BIN/fleet"
export FLEET_BIN="$BIN/fleet" FLEET_LOG
export PATH="$BIN:$PATH"
MODE="$TEST_TMP/mode"
mkdir -p "$MODE"
export AUTOPILOT_SESSION_MODE_DIR="$MODE"
unset AUTOPILOT_SESSION_ID

updates() { grep -c 'task update ' "$FLEET_LOG" 2>/dev/null || true; }
reset_log() { : > "$FLEET_LOG"; export FLEET_RC=0; }

# --- check-test-outcome ---
QC_REPO="$TEST_TMP/qc-repo"
mkdir -p "$QC_REPO/scripts"
git -C "$QC_REPO" init -q -b main
git -C "$QC_REPO" config user.email t@local
git -C "$QC_REPO" config user.name t
printf 'base\n' > "$QC_REPO/scripts/stage-ev-widget.js"
printf '%s\n' 'echo scripts/stage-ev-widget.js' 'exit 0' > "$QC_REPO/scripts/stage-ev-widget.test.js"
git -C "$QC_REPO" add scripts
git -C "$QC_REPO" commit -qm base
BASE_SHA="$(git -C "$QC_REPO" rev-parse HEAD)"
printf 'changed\n' > "$QC_REPO/scripts/stage-ev-widget.js"
git -C "$QC_REPO" add scripts/stage-ev-widget.js
git -C "$QC_REPO" commit -qm change
HEAD_SHA="$(git -C "$QC_REPO" rev-parse HEAD)"
REC="$TEST_TMP/qc-record.json"
node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({schema:1, head:process.argv[2], suites:[{path:"scripts/stage-ev-widget.test.js", rc:0}]}))' "$REC" "$HEAD_SHA"

run_qc() {
  node "$REPO_ROOT/scripts/check-test-outcome.js" --root "$QC_REPO" --base "$BASE_SHA" --head "$HEAD_SHA" --rerun none --record-file "$REC" "$@"
}

reset_log
QC_OUT="$(run_qc --fleet-task "$TASK" 2>"$TEST_TMP/qc.err")"
QC_RC=$?
assert_exit_code "$QC_RC" "0" "qc pass exits 0"
assert_contains "$(cat "$FLEET_LOG")" "task update $TASK [stage:qc/pass] $HEAD_SHA" "qc pass writes [stage:qc/pass]"
BEFORE="$(updates)"
run_qc --fleet-task "$TASK" >/dev/null 2>"$TEST_TMP/qc2.err"
assert_eq "$(updates)" "$BEFORE" "qc rerun writes no second call"
reset_log
rm -f "$MODE/stage-events.json"
NO_OUT="$(node "$REPO_ROOT/scripts/check-test-outcome.js" --root "$QC_REPO" --base "$BASE_SHA" --head "$HEAD_SHA" --rerun none --record-file "$REC" 2>"$TEST_TMP/qc-none.err")"
assert_eq "$(updates)" "0" "qc with no task id writes no fleet call"
assert_not_contains "$(cat "$TEST_TMP/qc-none.err")" "stage-event:" "qc with no task id prints no stage-event line"
reset_log
export FLEET_RC=1
FAIL_ERR="$TEST_TMP/qc-fleet.err"
node "$REPO_ROOT/scripts/check-test-outcome.js" --root "$QC_REPO" --base "$BASE_SHA" --head "$HEAD_SHA" --rerun none --record-file "$REC" --fleet-task "$TASK" >"$TEST_TMP/qc-fleet.out" 2>"$FAIL_ERR"
FAIL_RC=$?
assert_exit_code "$FAIL_RC" "0" "qc fleet failure keeps exit 0"
assert_eq "$(grep -c '^stage-event: ' "$FAIL_ERR")" "1" "qc fleet failure is one stderr line"
export FLEET_RC=0

# refuse path still names qc/fail
reset_log
rm -f "$MODE/stage-events.json"
node "$REPO_ROOT/scripts/check-test-outcome.js" --root "$QC_REPO" --base "$BASE_SHA" --head "$HEAD_SHA" --rerun none --record-file "$TEST_TMP/missing-record.json" --fleet-task "$TASK" >"$TEST_TMP/qc-red.out" 2>"$TEST_TMP/qc-red.err"
RED_RC=$?
assert_exit_code "$RED_RC" "1" "qc missing record stays exit 1"
assert_contains "$(cat "$FLEET_LOG")" "task update $TASK [stage:qc/fail] $HEAD_SHA" "qc fail writes [stage:qc/fail]"

# --- land-branch ---
reset_log
rm -f "$MODE/stage-events.json"
LAND="$REPO_ROOT/scripts/land-branch.js"
BARE="$TEST_TMP/land.git"
WORK="$TEST_TMP/land"
git init -q --bare "$BARE"
git clone -q "$BARE" "$WORK"
git -C "$WORK" checkout -q -b develop
printf 'base\n' > "$WORK/a.txt"
git -C "$WORK" add a.txt
git -C "$WORK" -c user.email=t@local -c user.name=t commit -qm base
git -C "$WORK" push -q -u origin develop
git -C "$WORK" checkout -q -b feat/land
printf 'feature\n' > "$WORK/b.txt"
git -C "$WORK" add b.txt
git -C "$WORK" -c user.email=t@local -c user.name=t commit -qm feature
git -C "$WORK" checkout -q develop
printf '%s\n' 'land it' > "$TEST_TMP/body.txt"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({verdict:"SHIP-AS-IS", model:"grok-4.7", runner:"t"}))' "$TEST_TMP/review.json"
printf '%s\n' '#!/bin/bash' 'exit 0' > "$TEST_TMP/ok.sh"
chmod +x "$TEST_TMP/ok.sh"
SUITES_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "$TEST_TMP/ok.sh")"
CHECKS_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.argv.slice(1)]))' "$TEST_TMP/ok.sh")"
(
  cd "$WORK"
  LAND_BRANCH_SUITES_CMD="$SUITES_JSON" LAND_BRANCH_CHECK_CMDS="$CHECKS_JSON" \
    node "$LAND" --branch feat/land --review-json "$TEST_TMP/review.json" --fleet-task "$TASK" --body-file "$TEST_TMP/body.txt" --review-generation 1 --suites affected
) >"$TEST_TMP/land.out" 2>"$TEST_TMP/land.err"
LAND_RC=$?
MERGE_SHA="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sha)' "$TEST_TMP/land.out")"
assert_exit_code "$LAND_RC" "0" "land exits 0"
assert_contains "$(cat "$FLEET_LOG")" "task update $TASK [stage:merged] $MERGE_SHA" "land writes [stage:merged]"
BEFORE="$(updates)"
node -e 'require(process.argv[1]).emitStage({taskId:process.argv[2], stage:"merged", sha:process.argv[3], detail:process.argv[3]})' \
  "$REPO_ROOT/scripts/lib/stage-event.js" "$TASK" "$MERGE_SHA"
assert_eq "$(updates)" "$BEFORE" "merged rerun same key writes no second call"
reset_log
rm -f "$MODE/stage-events.json"
# no --fleet-task is usage for land (the flag is required). Marker-less emit is the no-id case.
node -e 'require(process.argv[1]).emitStage({stage:"merged", sha:"abc", detail:"abc"})' "$REPO_ROOT/scripts/lib/stage-event.js"
assert_eq "$(updates)" "0" "merged with no task id writes no fleet call"

export FLEET_RC=1
rm -f "$MODE/stage-events.json"
node -e 'require(process.argv[1]).emitStage({taskId:process.argv[2], stage:"merged", sha:process.argv[3], detail:process.argv[3]})' \
  "$REPO_ROOT/scripts/lib/stage-event.js" "$TASK" "$MERGE_SHA" 2>"$TEST_TMP/land-fleet.err"
LAND_FAIL_RC=$?
assert_exit_code "$LAND_FAIL_RC" "0" "land fleet failure does not change the helper exit"
assert_eq "$(grep -c '^stage-event: ' "$TEST_TMP/land-fleet.err")" "1" "land fleet failure is one stderr line"
export FLEET_RC=0

# --- dispatch-plan-review (one generation) ---
reset_log
rm -f "$MODE/stage-events.json"
PLAN_REPO="$TEST_TMP/plan-repo"
mkdir -p "$PLAN_REPO"
git -C "$PLAN_REPO" init -q
printf '%s\n' '# Plan' 'Build the slice.' > "$PLAN_REPO/plan.md"
printf '%s\n' '# Rubric' '- R1: readiness' > "$PLAN_REPO/rubric.md"
git -C "$PLAN_REPO" add plan.md rubric.md
git -C "$PLAN_REPO" -c user.email=t@local -c user.name=t commit -qm plan
READY="$REPO_ROOT/hooks/tests/fixtures/plan-review/ready.json"
MANIFEST="$TEST_TMP/manifest.json"
cat > "$MANIFEST" << 'JSON'
{
  "schema_version": 1,
  "artifact_type": "plan_review_manifest",
  "logical_plan_id": "stage-ev-plan",
  "minimum_distinct_families": 1,
  "max_attempts_per_seat": 2,
  "seats": [
    {
      "id": "architect", "runner": "codex", "model": "gpt-fixture",
      "effort": "high", "endpoint": "default", "role": "architecture",
      "family": "openai", "readiness_status": "ready",
      "qualification_status": "qualified", "required": true,
      "excluded_families": [], "fallbacks": []
    }
  ]
}
JSON
SEQ="$(node -e 'const r=process.argv[1]; process.stdout.write(JSON.stringify({architect:[r]}))' "$READY")"
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" AUTOPILOT_TEST_CN_GATE_OFF=1 \
  node "$REPO_ROOT/scripts/dispatch-plan-review.js" \
    --repo-root "$PLAN_REPO" --plan-file plan.md --rubric-file "$PLAN_REPO/rubric.md" \
    --ticket stage-ev --session-id stage-ev --generation 1 \
    --manifest-file "$MANIFEST" --state-dir "$TEST_TMP/pr-state" --fleet-task "$TASK" \
    >"$TEST_TMP/pr.out" 2>"$TEST_TMP/pr.err"
PR_RC=$?
assert_exit_code "$PR_RC" "0" "plan review generation exits 0"
assert_contains "$(cat "$FLEET_LOG")" "task update $TASK [stage:plan/review-gen1] " "plan review writes review-gen1"
assert_contains "$(cat "$FLEET_LOG")" " receipt=" "plan review line carries receipt="
assert_contains "$(cat "$FLEET_LOG")" "[stage:plan/frozen] " "plan freeze writes [stage:plan/frozen]"
assert_contains "$(cat "$FLEET_LOG")" "@" "frozen line is path@sha"
BEFORE="$(updates)"
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" AUTOPILOT_TEST_CN_GATE_OFF=1 \
  node "$REPO_ROOT/scripts/dispatch-plan-review.js" \
    --repo-root "$PLAN_REPO" --plan-file plan.md --rubric-file "$PLAN_REPO/rubric.md" \
    --ticket stage-ev --session-id stage-ev --generation 1 \
    --manifest-file "$MANIFEST" --state-dir "$TEST_TMP/pr-state" --fleet-task "$TASK" \
    >"$TEST_TMP/pr2.out" 2>"$TEST_TMP/pr2.err" || true
assert_eq "$(updates)" "$BEFORE" "plan review rerun writes no second call"
reset_log
rm -rf "$TEST_TMP/pr-state-none" "$MODE/stage-events.json"
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" AUTOPILOT_TEST_CN_GATE_OFF=1 \
  node "$REPO_ROOT/scripts/dispatch-plan-review.js" \
    --repo-root "$PLAN_REPO" --plan-file plan.md --rubric-file "$PLAN_REPO/rubric.md" \
    --ticket stage-ev-none --session-id stage-ev-none --generation 1 \
    --manifest-file "$MANIFEST" --state-dir "$TEST_TMP/pr-state-none" \
    >"$TEST_TMP/pr-none.out" 2>"$TEST_TMP/pr-none.err"
assert_eq "$(updates)" "0" "plan review with no task id writes no fleet call"
assert_not_contains "$(cat "$TEST_TMP/pr-none.err")" "stage-event:" "plan review with no task id prints no stage-event line"

export FLEET_RC=1
rm -rf "$TEST_TMP/pr-state-fail" "$MODE/stage-events.json"
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" AUTOPILOT_TEST_CN_GATE_OFF=1 \
  node "$REPO_ROOT/scripts/dispatch-plan-review.js" \
    --repo-root "$PLAN_REPO" --plan-file plan.md --rubric-file "$PLAN_REPO/rubric.md" \
    --ticket stage-ev-fail --session-id stage-ev-fail --generation 1 \
    --manifest-file "$MANIFEST" --state-dir "$TEST_TMP/pr-state-fail" --fleet-task "$TASK" \
    >"$TEST_TMP/pr-fail.out" 2>"$TEST_TMP/pr-fail.err"
PR_FAIL_RC=$?
assert_exit_code "$PR_FAIL_RC" "0" "plan review fleet failure keeps exit 0"
assert_eq "$(grep -c '^stage-event: ' "$TEST_TMP/pr-fail.err")" "1" "plan review fleet failure is one stderr line"
export FLEET_RC=0

# --- hetero-review-loop finalize ---
reset_log
rm -f "$MODE/stage-events.json"
LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER/review-p1/g1" "$TEST_TMP/hrepo"
git -C "$TEST_TMP/hrepo" init -q
git -C "$TEST_TMP/hrepo" -c user.email=t@local -c user.name=t commit -qm --allow-empty -m base
cat > "$LEDGER/review-p1/chain.json" << 'EOF'
[
  {
    "generation": 1,
    "base": "base111",
    "head": "head111",
    "implementer_engine": "claude-sonnet-5",
    "seats": [{ "id": "s0", "status": "reviewed", "engine": "gpt-5" }],
    "status": "pending"
  }
]
EOF
printf '%s\n' '{ "base": "base111", "head": "head111" }' > "$LEDGER/review-p1/g1/range.json"
printf '%s\n' '{ "findings": [ { "id": "f1", "severity": "Minor", "seat": "s0", "text": "nit" } ] }' > "$LEDGER/review-p1/g1/findings.json"
cat > "$TEST_TMP/disp.json" << 'EOF'
{
  "schema_version": 1,
  "phase": "p1",
  "generation": 1,
  "findings": [ { "id": "f1", "disposition": "refuted", "rationale": "not a bug" } ]
}
EOF
cat > "$TEST_TMP/resolve.sh" << 'EOF'
#!/bin/bash
printf '%s\n' test
exit 0
EOF
chmod +x "$TEST_TMP/resolve.sh"
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/resolve.sh"
cp -a "$LEDGER" "$TEST_TMP/ledger-pristine"
node "$REPO_ROOT/scripts/hetero-review-loop.js" finalize \
  --repo-root "$TEST_TMP/hrepo" --ledger "$LEDGER" --phase p1 --generation 1 \
  --dispositions "$TEST_TMP/disp.json" --fleet-task "$TASK" \
  >"$TEST_TMP/hr.out" 2>"$TEST_TMP/hr.err"
HR_RC=$?
assert_exit_code "$HR_RC" "0" "review finalize exits 0"
assert_contains "$(cat "$FLEET_LOG")" "task update $TASK [stage:review/gen1] " "review round writes [stage:review/gen1]"
BEFORE="$(updates)"
node "$REPO_ROOT/scripts/hetero-review-loop.js" finalize \
  --repo-root "$TEST_TMP/hrepo" --ledger "$LEDGER" --phase p1 --generation 1 \
  --dispositions "$TEST_TMP/disp.json" --fleet-task "$TASK" \
  >"$TEST_TMP/hr2.out" 2>"$TEST_TMP/hr2.err" || true
assert_eq "$(updates)" "$BEFORE" "review rerun writes no second call"
reset_log
rm -rf "$TEST_TMP/ledger-none" "$MODE/stage-events.json"
mkdir -p "$TEST_TMP/ledger-none/review-p1/g1"
cp "$TEST_TMP/ledger-pristine/review-p1/chain.json" "$TEST_TMP/ledger-none/review-p1/chain.json"
cp "$TEST_TMP/ledger-pristine/review-p1/g1/range.json" "$TEST_TMP/ledger-none/review-p1/g1/range.json"
cp "$TEST_TMP/ledger-pristine/review-p1/g1/findings.json" "$TEST_TMP/ledger-none/review-p1/g1/findings.json"
node "$REPO_ROOT/scripts/hetero-review-loop.js" finalize \
  --repo-root "$TEST_TMP/hrepo" --ledger "$TEST_TMP/ledger-none" --phase p1 --generation 1 \
  --dispositions "$TEST_TMP/disp.json" \
  >"$TEST_TMP/hr-none.out" 2>"$TEST_TMP/hr-none.err"
assert_eq "$(updates)" "0" "review with no task id writes no fleet call"
assert_not_contains "$(cat "$TEST_TMP/hr-none.err")" "stage-event:" "review with no task id prints no stage-event line"

export FLEET_RC=1
rm -rf "$TEST_TMP/ledger-fail" "$MODE/stage-events.json"
mkdir -p "$TEST_TMP/ledger-fail/review-p1/g1"
cp "$TEST_TMP/ledger-pristine/review-p1/chain.json" "$TEST_TMP/ledger-fail/review-p1/chain.json"
cp "$TEST_TMP/ledger-pristine/review-p1/g1/range.json" "$TEST_TMP/ledger-fail/review-p1/g1/range.json"
cp "$TEST_TMP/ledger-pristine/review-p1/g1/findings.json" "$TEST_TMP/ledger-fail/review-p1/g1/findings.json"
node "$REPO_ROOT/scripts/hetero-review-loop.js" finalize \
  --repo-root "$TEST_TMP/hrepo" --ledger "$TEST_TMP/ledger-fail" --phase p1 --generation 1 \
  --dispositions "$TEST_TMP/disp.json" --fleet-task "$TASK" \
  >"$TEST_TMP/hr-fail.out" 2>"$TEST_TMP/hr-fail.err"
HR_FAIL_RC=$?
assert_exit_code "$HR_FAIL_RC" "0" "review fleet failure keeps exit 0"
assert_eq "$(grep -c '^stage-event: ' "$TEST_TMP/hr-fail.err")" "1" "review fleet failure is one stderr line"
export FLEET_RC=0

# --- finish via the documented stage-advance command ---
reset_log
rm -f "$MODE/stage-events.json"
FIN_REPO="$TEST_TMP/fin"
mkdir -p "$FIN_REPO"
git -C "$FIN_REPO" init -q -b main
git -C "$FIN_REPO" config user.email t@local
git -C "$FIN_REPO" config user.name t
printf 'x\n' > "$FIN_REPO/a.txt"
git -C "$FIN_REPO" add a.txt
git -C "$FIN_REPO" commit -qm base
export AUTOPILOT_SESSION_ID="stage-ev-finish"
(
  cd "$FIN_REPO"
  node "$REPO_ROOT/scripts/session-mode.js" set --size XS --fleet-task "$TASK" >/dev/null
  node "$REPO_ROOT/scripts/stage-advance.js" --to implement >/dev/null
  node "$REPO_ROOT/scripts/stage-advance.js" --to qc-gate >/dev/null
  node "$REPO_ROOT/scripts/stage-advance.js" --to finish >"$TEST_TMP/fin.out" 2>"$TEST_TMP/fin.err"
)
FIN_RC=$?
FIN_SHA="$(git -C "$FIN_REPO" rev-parse HEAD)"
assert_exit_code "$FIN_RC" "0" "stage-advance --to finish exits 0"
assert_contains "$(cat "$FLEET_LOG")" "task update $TASK [stage:finish] $FIN_SHA" "finish writes [stage:finish]"
unset AUTOPILOT_SESSION_ID

finalize_test
