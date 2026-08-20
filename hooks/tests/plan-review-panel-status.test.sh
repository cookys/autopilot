#!/usr/bin/env bash
# Panel-level progress view (v2.34.31): dispatch-plan-review writes a panel manifest at
# every seat transition; dispatch-status --panels/--panel renders it. Red-green carrier:
# the seam-driven run below leaves NO panel manifest on pre-change dispatch-plan-review.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
STATUS="$REPO_ROOT/scripts/dispatch-status.js"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/plan-review"
PLAN_REPO="$TEST_TMP/repo"; STATE_DIR="$TEST_TMP/state"
RUNS_DIR="$TEST_TMP/runs"; export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
PLAN_FILE="$PLAN_REPO/plan.md"; RUBRIC_FILE="$PLAN_REPO/rubric.md"
MANIFEST="$TEST_TMP/manifest.json"
mkdir -p "$PLAN_REPO" "$RUNS_DIR"
git -C "$PLAN_REPO" init -q
printf '%s\n' '# Plan' 'Build the slice.' >"$PLAN_FILE"
printf '%s\n' '# Rubric' '- R1: readiness' >"$RUBRIC_FILE"
cat >"$MANIFEST" <<'JSON'
{
  "schema_version": 1, "artifact_type": "plan_review_manifest",
  "logical_plan_id": "panel-fixture-plan", "minimum_distinct_families": 2,
  "max_attempts_per_seat": 2,
  "seats": [
    {"id": "architect", "runner": "codex", "model": "gpt-fixture", "effort": "high",
     "endpoint": "default", "role": "architecture", "family": "openai",
     "readiness_status": "ready", "qualification_status": "qualified", "required": true,
     "excluded_families": [], "fallbacks": []},
    {"id": "skeptic", "runner": "qoderclicn", "model": "qwen-fixture", "effort": "high",
     "endpoint": "default", "role": "skeptic", "family": "qwen",
     "readiness_status": "ready", "qualification_status": "qualified", "required": true,
     "excluded_families": [], "fallbacks": []}
  ]
}
JSON

jf() { node -e 'let v=JSON.parse(process.argv[1]);for(const p of process.argv[2].split("."))v=v[p];process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }

# ── 1. lifecycle unit (lib direct) ──
node - "$REPO_ROOT" "$RUNS_DIR" <<'NODE'
const { createPanelManifest } = require(`${process.argv[2]}/scripts/lib/plan-review-panel.js`);
const h = createPanelManifest({
  ticket: 'unit', logicalPlanId: 'lp', generation: 1, sessionKey: 'ffff0000'.repeat(8),
  startedAt: '2026-08-21T00:00:00Z', deadlineAt: '2026-08-21T02:00:00Z',
  seats: [{ id: 'a' }, { id: 'b' }],
});
h.seatStart('a', 'a', 1);
h.seatSettle('a', { status: 'done', transportStatus: 'success' });
h.seatStart('b', 'b', 1);
h.seatStart('b', 'b', 2);              // retry keeps in_flight, bumps attempt
h.seatSettle('b', { status: 'failed', transportStatus: 'transport_exhausted' });
h.end('CONDITIONAL');
process.stdout.write(h.file);
NODE
UNIT_FILE="$RUNS_DIR/$(ls "$RUNS_DIR" | grep '^panel-ffff0000' | head -1)"
assert_file_exists "$UNIT_FILE" "lifecycle manifest exists"
U="$(cat "$UNIT_FILE")"
assert_eq "$(jf "$U" verdict)" "CONDITIONAL" "end() records verdict"
assert_eq "$(jf "$U" seats.0.status)" "done" "seat a settled done"
assert_eq "$(jf "$U" seats.1.status)" "failed" "seat b settled failed"
assert_eq "$(jf "$U" seats.1.attempt)" "2" "retry bumped attempt"
assert_neq "" "$(jf "$U" ended_at)" "ended_at stamped"

# ── 2. red-green integration: a real seam run writes a panel manifest ──
READY="$FIXTURES/ready.json"
SEQ=$(node -e 'process.stdout.write(JSON.stringify({architect:[process.argv[1]],skeptic:[process.argv[1]]}))' "$READY")
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" \
  node "$SCRIPT" \
    --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
    --ticket panel-t --session-id session-1 --generation 1 \
    --manifest-file "$MANIFEST" --state-dir "$STATE_DIR" >/dev/null
assert_eq "$?" "0" "seam run exits 0"
PANEL_FILE=$(ls "$RUNS_DIR" | grep -v '^panel-ffff0000' | grep '^panel-' | head -1)
assert_neq "" "$PANEL_FILE" "panel manifest written by dispatch-plan-review (RED on pre-change code)"
P="$(cat "$RUNS_DIR/$PANEL_FILE")"
assert_eq "$(jf "$P" artifact_type)" "plan_review_panel_manifest" "artifact type"
assert_eq "$(jf "$P" seats.0.status)" "done" "architect done"
assert_eq "$(jf "$P" seats.1.status)" "done" "skeptic done"
assert_neq "" "$(jf "$P" ended_at)" "run end stamped"
assert_neq "null" "$(jf "$P" verdict)" "verdict recorded"

# ── 3. renderer ──
LIST=$(node "$STATUS" --panels)
assert_eq "$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$LIST")" "2" "--panels lists both panels"
assert_eq "$(node -e 'const l=JSON.parse(process.argv[1]);console.log(l.every(p=>Number.isInteger(p.seats_done)&&Array.isArray(p.seats)))' "$LIST")" "true" "every row carries derived counts + seats"
ONE=$(node "$STATUS" --panel "$RUNS_DIR/$PANEL_FILE")
assert_eq "$(jf "$ONE" seats_done)" "2" "--panel single view seat count"
assert_eq "$(jf "$ONE" deadline_remaining_seconds)" "null" "ended panel has null remaining"
node "$STATUS" --panel zzz-no-such >/dev/null 2>&1; assert_eq "$?" "3" "unknown prefix exits 3"

# ── 4. review-round pins (2026-08-21 FIX-THEN-SHIP round 1) ──
# (4a) best-effort negative control: unwritable runs dir must not fail the review
RO_RUNS="$TEST_TMP/ro-runs"; mkdir -p "$RO_RUNS"; chmod 500 "$RO_RUNS"
STATE_DIR2="$TEST_TMP/state2"
AUTOPILOT_DISPATCH_RUNS_DIR="$RO_RUNS" \
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" \
  node "$SCRIPT" \
    --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
    --ticket panel-ro --session-id session-ro --generation 1 \
    --manifest-file "$MANIFEST" --state-dir "$STATE_DIR2" >/dev/null 2>&1
assert_eq "$?" "0" "unwritable runs dir: review still exits 0 (best-effort guarantee, RED if flush() loses its try/catch)"
chmod 700 "$RO_RUNS"
assert_neq "" "$(find "$STATE_DIR2" -name 'generation-01.json' | head -1)" "review artifact still produced under unwritable runs dir"

# (4b) opt-out: AUTOPILOT_DISPATCH_MANIFEST=0 writes nothing
OPTOUT_RUNS="$TEST_TMP/optout-runs"; mkdir -p "$OPTOUT_RUNS"
OUT_OPT=$(AUTOPILOT_DISPATCH_RUNS_DIR="$OPTOUT_RUNS" AUTOPILOT_DISPATCH_MANIFEST=0 node - "$REPO_ROOT" <<'NODE'
const { createPanelManifest } = require(`${process.argv[2]}/scripts/lib/plan-review-panel.js`);
const h = createPanelManifest({ ticket: 't', logicalPlanId: 'l', generation: 1,
  sessionKey: 'aa'.repeat(32), startedAt: 'x', deadlineAt: 'x', seats: [{ id: 'a' }] });
h.seatStart('a', 'a', 1); h.end('X');
process.stdout.write(String(h.file));
NODE
)
assert_eq "$OUT_OPT" "null" "opt-out returns null file handle"
assert_eq "$(ls "$OPTOUT_RUNS" | wc -l)" "0" "opt-out writes zero files"

# (4c) dead owner: in_flight downgrades to in_flight_stale, owner_alive=false
STALE="$RUNS_DIR/panel-deadbeef-g1-4194305.manifest.json"
node -e '
const fs=require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({schema_version:1,artifact_type:"plan_review_panel_manifest",ticket:"t",logical_plan_id:"l",generation:1,pid:4194305,started_at:"2026-08-19T00:00:00Z",deadline_at:"2026-08-19T02:00:00Z",updated_at:"2026-08-19T00:10:00Z",ended_at:null,verdict:null,seats:[{seat_id:"s",target_id:"s",status:"in_flight",attempt:1,started_at:"2026-08-19T00:00:00Z",ended_at:null,transport_status:null}]}));
' "$STALE"
ST=$(node "$STATUS" --panel "$STALE")
assert_eq "$(jf "$ST" owner_alive)" "false" "dead pid → owner_alive false"
assert_eq "$(jf "$ST" seats.0.status)" "in_flight_stale" "dead pid → in_flight_stale"
assert_eq "$(node -e 'const d=JSON.parse(process.argv[1]);console.log(Number.isInteger(d.in_flight.elapsed_seconds)&&d.in_flight.elapsed_seconds>0)' "$ST")" "true" "in_flight elapsed_seconds derived as positive integer"

# (4c2) pid=0 (probe n/a) → owner_alive null, seat stays in_flight (three-state, not fail-open)
NA="$RUNS_DIR/panel-0000na00-g1-0.manifest.json"
node -e '
const fs=require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({schema_version:1,artifact_type:"plan_review_panel_manifest",ticket:"t",logical_plan_id:"l",generation:1,pid:0,started_at:"2026-08-19T00:00:00Z",deadline_at:"2026-08-19T02:00:00Z",updated_at:"2026-08-19T00:10:00Z",ended_at:null,verdict:null,seats:[{seat_id:"s",target_id:"s",status:"in_flight",attempt:1,started_at:"2026-08-19T00:00:00Z",ended_at:null,transport_status:null}]}));
' "$NA"
NAOUT=$(node "$STATUS" --panel "$NA")
assert_eq "$(jf "$NAOUT" owner_alive)" "null" "unknowable pid → owner_alive null (not fail-open true)"
assert_eq "$(jf "$NAOUT" seats.0.status)" "in_flight" "unknowable pid does not downgrade the seat"

# (4c3) ambiguous prefix (2 matches) → exit 3
node "$STATUS" --panel panel- >/dev/null 2>&1
assert_eq "$?" "3" "ambiguous prefix (multiple matches) exits 3"

# (4f) panel.end(null) on controlled-error path (pins MUST-FIX 2; RED if the catch loses it)
BADDISP="$TEST_TMP/bad-disposition.json"
node -e '
const fs=require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({schema_version:1,logical_plan_id:"panel-fixture-plan",generation:1,findings:[{fingerprint:"0".repeat(64),disposition:"accepted_blocker",rationale:"x"}]}));
' "$BADDISP"
ERR_RUNS="$TEST_TMP/err-runs"; mkdir -p "$ERR_RUNS"
AUTOPILOT_DISPATCH_RUNS_DIR="$ERR_RUNS" \
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" \
  node "$SCRIPT" \
    --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
    --ticket panel-err --session-id session-err --generation 1 \
    --disposition-file "$BADDISP" \
    --manifest-file "$MANIFEST" --state-dir "$TEST_TMP/state3" >/dev/null 2>&1
ERR_RC=$?
assert_neq "0" "$ERR_RC" "unknown-fingerprint disposition run fails (controlled error)"
ERR_PANEL=$(ls "$ERR_RUNS" | grep '^panel-' | head -1)
if [ -n "$ERR_PANEL" ]; then
  assert_neq "null" "$(jf "$(cat "$ERR_RUNS/$ERR_PANEL")" ended_at)" "failed run's panel is ended (no phantom-live panel)"
else
  assert_neq "" "$ERR_PANEL" "controlled-error run left a panel manifest to inspect"
fi

# (4d) --list never shows panel manifests
LISTOUT=$(node "$STATUS" --list --dir "$RUNS_DIR")
assert_not_contains "$LISTOUT" "panel-" "--list excludes panel manifests (no run_id:null ghost rows)"

# (4e) --panel on a JSON scalar file → clean exit 3, no stack trace
printf 'null' > "$TEST_TMP/null.manifest.json"
node "$STATUS" --panel "$TEST_TMP/null.manifest.json" >/dev/null 2>&1
assert_eq "$?" "3" "scalar JSON panel file → clean exit 3"

finalize_test
