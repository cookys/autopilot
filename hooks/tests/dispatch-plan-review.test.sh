#!/usr/bin/env bash
# Durable heterogeneous plan-review session controller: P1-P4 contract.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
SCHEMA_CHECK="$REPO_ROOT/scripts/validate-json-schema.js"
ARTIFACT_SCHEMA="$REPO_ROOT/schemas/plan-review-artifact.schema.json"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/plan-review"
PLAN_REPO="$TEST_TMP/repo"
STATE_DIR="$TEST_TMP/state"
PLAN_FILE="$PLAN_REPO/plan.md"
RUBRIC_FILE="$PLAN_REPO/rubric.md"
MANIFEST="$TEST_TMP/manifest.json"
ARTIFACT_SCHEMA_INDEX=0

mkdir -p "$PLAN_REPO"
git -C "$PLAN_REPO" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' >"$PLAN_FILE"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' '- R2: immediate integrity' >"$RUBRIC_FILE"

cat >"$MANIFEST" <<'JSON'
{
  "schema_version": 1,
  "artifact_type": "plan_review_manifest",
  "logical_plan_id": "prs-fixture-plan",
  "minimum_distinct_families": 3,
  "max_attempts_per_seat": 2,
  "seats": [
    {
      "id": "architect", "runner": "codex", "model": "gpt-fixture",
      "effort": "high", "endpoint": "default", "role": "architecture",
      "family": "openai", "readiness_status": "ready",
      "qualification_status": "qualified", "required": true,
      "excluded_families": [], "fallbacks": []
    },
    {
      "id": "operations", "runner": "grok", "model": "grok-fixture",
      "effort": "high", "endpoint": "default", "role": "operations",
      "family": "xai", "readiness_status": "ready",
      "qualification_status": "qualified", "required": true,
      "excluded_families": ["xai"],
      "fallbacks": [{
        "id": "operations_fallback", "runner": "claude-native",
        "model": "claude-fixture", "effort": "high", "endpoint": "default",
        "role": "operations", "family": "anthropic",
        "readiness_status": "ready", "qualification_status": "qualified"
      }]
    },
    {
      "id": "skeptic", "runner": "qoderclicn", "model": "qwen-fixture",
      "effort": "high", "endpoint": "default", "role": "skeptic",
      "family": "qwen", "readiness_status": "ready",
      "qualification_status": "qualified", "required": true,
      "excluded_families": [], "fallbacks": []
    },
    {
      "id": "product", "runner": "agy", "model": "gemini-fixture",
      "effort": "high", "endpoint": "default", "role": "product",
      "family": "google", "readiness_status": "ready",
      "qualification_status": "qualified", "required": false,
      "excluded_families": [], "fallbacks": []
    }
  ]
}
JSON

json_field() {
  node -e '
let value = JSON.parse(process.argv[1]);
for (const part of process.argv[2].split(".")) {
  if (value === null || typeof value !== "object" || !(part in value)) process.exit(2);
  value = value[part];
}
process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
' "$1" "$2"
}

json_length() {
  node -e '
const value = JSON.parse(process.argv[1]);
let selected = value;
for (const part of process.argv[2].split(".")) selected = selected[part];
if (!Array.isArray(selected)) process.exit(2);
process.stdout.write(String(selected.length));
' "$1" "$2"
}

assert_artifact_schema() {
  local artifact="$1" message="$2"
  ARTIFACT_SCHEMA_INDEX=$((ARTIFACT_SCHEMA_INDEX + 1))
  local artifact_file="$TEST_TMP/artifact-$ARTIFACT_SCHEMA_INDEX.json"
  printf '%s\n' "$artifact" >"$artifact_file"
  local schema_out
  schema_out="$(node "$SCHEMA_CHECK" --schema "$ARTIFACT_SCHEMA" --document "$artifact_file" 2>&1)"
  assert_exit_code "$?" "0" "$message: $schema_out"
}

sequence() {
  node -e '
const entries = process.argv.slice(1);
const out = {};
for (const entry of entries) {
  const [seat, ...files] = entry.split("=");
  out[seat] = files.join("=").split(",");
}
process.stdout.write(JSON.stringify(out));
' "$@"
}

run_manifest() {
  local ticket="$1" generation="$2" manifest="$3" responses="$4"
  local disposition="${5:-}" now="${6:-}"
  local args=(
    --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE"
    --ticket "$ticket" --session-id "session-$generation" --generation "$generation"
    --manifest-file "$manifest" --state-dir "$STATE_DIR"
  )
  [ -z "$disposition" ] || args+=(--disposition-file "$disposition")
  [ -z "$now" ] || args+=(--now "$now")
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$responses" \
    node "$SCRIPT" "${args[@]}"
}

run_manifest_options() {
  local ticket="$1" generation="$2" manifest="$3" responses="$4"
  shift 4
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$responses" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket "$ticket" --session-id "session-$generation" --generation "$generation" \
      --manifest-file "$manifest" --state-dir "$STATE_DIR" "$@"
}

copy_manifest() {
  local logical_id="$1" output="$2"
  node - "$MANIFEST" "$output" "$logical_id" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = process.argv[4];
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
}

READY="$FIXTURES/ready.json"
BLOCKER="$FIXTURES/blocker.json"
# Soft duplicate of blocker.json: same fingerprint fields, non-blocking admission.
# Generated under TEST_TMP so it stays outside sealed plan-review output_paths.
BLOCKER_SOFT="$TEST_TMP/blocker-soft.json"
node - "$BLOCKER" "$BLOCKER_SOFT" <<'NODE'
const fs = require('fs');
const hard = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const soft = {
  verdict: 'CONDITIONAL',
  findings: hard.findings.map((finding) => ({
    ...finding,
    severity: 'non-blocking',
    evidence: 'section 2 could later gain a durable authority boundary',
    repair: 'consider binding the logical plan later',
    blocks_next_slice_or_immediate_integrity: false,
    cannot_defer_to_spike: false,
  })),
};
fs.writeFileSync(process.argv[3], `${JSON.stringify(soft)}\n`);
NODE
SUGGESTION="$FIXTURES/suggestion.json"
PROSE="$FIXTURES/prose-ready.txt"
AMBIGUOUS="$FIXTURES/ambiguous.txt"
ALL_READY="$(sequence \
  "architect=$READY" "operations=$READY" "skeptic=$READY" "product=$READY")"

# P1: the closed manifest schema and runtime accept 1/2/4 seats, reject five and duplicate IDs.
node "$SCHEMA_CHECK" --schema "$REPO_ROOT/schemas/plan-review-manifest.schema.json" \
  --document "$MANIFEST" >/dev/null
assert_exit_code "$?" "0" "four-seat manifest matches closed schema"

for width in 1 2; do
  SMALL="$TEST_TMP/manifest-$width.json"
  node - "$MANIFEST" "$SMALL" "$width" <<'NODE'
const fs = require('fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.logical_plan_id = `width-${process.argv[4]}`;
source.seats = source.seats.slice(0, Number(process.argv[4]));
source.minimum_distinct_families = Number(process.argv[4]);
fs.writeFileSync(process.argv[3], `${JSON.stringify(source, null, 2)}\n`);
NODE
  RESP="$(sequence "architect=$READY" "operations=$READY")"
  OUT="$(run_manifest "width-$width" 1 "$SMALL" "$RESP")"; EXIT=$?
  assert_exit_code "$EXIT" "0" "$width-seat manifest executes"
  assert_eq "$(json_field "$OUT" verdict)" "READY" "$width-seat manifest is READY"
  assert_artifact_schema "$OUT" "$width-seat READY artifact matches schema"
done

FIVE="$TEST_TMP/five.json"
node - "$MANIFEST" "$FIVE" <<'NODE'
const fs = require('fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.logical_plan_id = 'five';
source.seats.push({ ...source.seats[0], id: 'fifth', family: 'fifth-family' });
fs.writeFileSync(process.argv[3], `${JSON.stringify(source, null, 2)}\n`);
NODE
OUT="$(run_manifest five 1 "$FIVE" "$ALL_READY" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "fifth seat is rejected"
assert_contains "$OUT" "manifest identity or limits" "fifth-seat rejection is explicit"

DUP="$TEST_TMP/duplicate.json"
node - "$MANIFEST" "$DUP" <<'NODE'
const fs = require('fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.logical_plan_id = 'duplicate';
source.seats[1].id = source.seats[0].id;
fs.writeFileSync(process.argv[3], `${JSON.stringify(source, null, 2)}\n`);
NODE
OUT="$(run_manifest duplicate 1 "$DUP" "$ALL_READY" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "duplicate seat ID is rejected"
assert_contains "$OUT" "duplicate manifest seat id" "duplicate seat diagnosis is explicit"

# P2: one prose-wrapped object is semantic success in attempt 1.
PROSE_SEQUENCE="$(sequence \
  "architect=$PROSE" "operations=$READY" "skeptic=$READY" "product=$READY")"
PROSE_MANIFEST="$TEST_TMP/prose-manifest.json"
copy_manifest prose-plan "$PROSE_MANIFEST"
OUT="$(run_manifest prose 1 "$PROSE_MANIFEST" "$PROSE_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "0" "single prose-wrapped JSON recovers"
assert_eq "$(json_field "$OUT" attempts.0.parser_status)" "extracted" "normalizer records extraction"
assert_eq "$(json_field "$OUT" generation)" "1" "extraction does not consume generation 2"

# Ambiguous JSON retries once and terminates transport_exhausted, never semantic STOP.
AMBIGUOUS_SEQUENCE="$(sequence \
  "architect=$AMBIGUOUS,$AMBIGUOUS" "operations=$READY" "skeptic=$READY" "product=$READY")"
AMBIGUOUS_MANIFEST="$TEST_TMP/ambiguous-manifest.json"
copy_manifest ambiguous-plan "$AMBIGUOUS_MANIFEST"
OUT="$(run_manifest ambiguous 1 "$AMBIGUOUS_MANIFEST" "$AMBIGUOUS_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "4" "ambiguous response exhausts two attempts"
assert_eq "$(json_field "$OUT" transport_status)" "transport_exhausted" "transport exhaustion is explicit"
assert_eq "$(json_field "$OUT" semantic_verdict)" "null" "transport failure is not semantic STOP"
assert_eq "$(json_field "$OUT" attempts.1.attempt)" "2" "retry remains generation-1 attempt 2"
assert_artifact_schema "$OUT" "transport-exhausted artifact matches schema"

# Fallback is allowed only from the frozen manifest and preserves family count.
FALLBACK_SEQUENCE="$(sequence \
  "architect=$READY" "operations=$AMBIGUOUS" \
  "operations_fallback=$READY" "skeptic=$READY" "product=$READY")"
FALLBACK_MANIFEST="$TEST_TMP/fallback-manifest.json"
copy_manifest fallback-plan "$FALLBACK_MANIFEST"
OUT="$(run_manifest fallback 1 "$FALLBACK_MANIFEST" "$FALLBACK_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "0" "declared qualified fallback recovers attempt 2"
assert_eq "$(json_field "$OUT" substitutions.0.to_id)" "operations_fallback" "substitution is recorded"
assert_eq "$(json_field "$OUT" attempts.2.attempt)" "2" "fallback consumes the second seat attempt"
assert_eq "$(json_field "$OUT" generation)" "1" "fallback does not create another generation"

# P3/P4: four seats, one retry and duplicate blocker reports produce one finding.
PANEL_SEQUENCE="$(sequence \
  "architect=$BLOCKER" "operations=$AMBIGUOUS" \
  "operations_fallback=$BLOCKER" "skeptic=$SUGGESTION" "product=$READY")"
PANEL_MANIFEST="$TEST_TMP/panel-manifest.json"
copy_manifest prs-fixture-plan "$PANEL_MANIFEST"
OUT="$(run_manifest panel 1 "$PANEL_MANIFEST" "$PANEL_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "0" "four-seat generation returns bounded adjudication request"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" "blocker candidate is conditional"
assert_eq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" "depth-0 disposition is mandatory"
assert_eq "$(json_field "$OUT" findings.0.provenance.1.seat_id)" "operations" "duplicate provenance is retained"
assert_eq "$(json_field "$OUT" findings.0.duplicate_reports.0.disposition)" "duplicate" "duplicate report has disposition"
assert_eq "$(json_field "$OUT" accepted_blocker_count)" "0" "reviewer cannot self-accept blocker"
assert_eq "$(json_field "$OUT" repair_authorized)" "false" "unadjudicated blocker cannot authorize repair"
assert_eq "$(json_field "$OUT" backlog_candidates.0.disposition)" "null" "nonblocking suggestion is backlog-only"
assert_artifact_schema "$OUT" "adjudication artifact matches schema"

FINGERPRINT="$(json_field "$OUT" findings.0.fingerprint)"
DISPOSITION="$TEST_TMP/disposition.json"
cat >"$DISPOSITION" <<JSON
{
  "schema_version": 1,
  "logical_plan_id": "prs-fixture-plan",
  "generation": 1,
  "findings": [{
    "fingerprint": "$FINGERPRINT",
    "disposition": "accepted_blocker",
    "rationale": "verified against frozen R1 and blocks the next slice"
  }]
}
JSON

GEN2_SEQUENCE="$(sequence \
  "architect=$READY" "operations=$READY" "skeptic=$READY" "product=$READY")"
OUT="$(run_manifest panel 2 "$PANEL_MANIFEST" "$GEN2_SEQUENCE" "$DISPOSITION")"; EXIT=$?
assert_exit_code "$EXIT" "0" "accepted blocker authorizes generation 2"
assert_eq "$(json_field "$OUT" generation)" "2" "repair review is generation 2"
assert_eq "$(json_field "$OUT" terminal)" "true" "generation 2 is terminal"
assert_eq "$(json_field "$OUT" verdict)" "READY" "clean generation 2 is READY"
assert_artifact_schema "$OUT" "generation-2 artifact matches schema"
OUT="$(run_manifest panel 2 "$PANEL_MANIFEST" "$GEN2_SEQUENCE" "$DISPOSITION" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "3" "terminal logical plan cannot reacquire"
assert_contains "$OUT" "already terminal" "terminal cap is durable"

# Same logical plan under a new ticket returns the canonical ticket; no reset.
ALT="$TEST_TMP/alt-ticket.json"
node - "$PANEL_MANIFEST" "$ALT" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(run_manifest reset-attempt 1 "$ALT" "$ALL_READY" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "3" "new ticket cannot reset logical plan"
assert_contains "$OUT" "canonical ticket panel" "reset rejection identifies canonical ticket"

# Manifest mutation after generation 1 is frozen drift evidence.
DRIFT="$TEST_TMP/drift.json"
node - "$MANIFEST" "$DRIFT" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'drift-plan';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
DRIFT_SEQUENCE="$(sequence \
  "architect=$BLOCKER" "operations=$READY" "skeptic=$READY" "product=$READY")"
OUT="$(run_manifest drift 1 "$DRIFT" "$DRIFT_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "0" "drift fixture opens generation 1"
node - "$DRIFT" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
value.seats[0].model = 'mutated-model';
fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(run_manifest drift 2 "$DRIFT" "$GEN2_SEQUENCE" "$DISPOSITION" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "3" "post-freeze manifest mutation is rejected"
assert_contains "$OUT" "drifted" "manifest drift is diagnosed"

# Legacy chair/deep flags remain a compatibility translation.
OUT="$(
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE="$READY" \
  AUTOPILOT_PLAN_REVIEW_DEEP_RESPONSE_FILE="$READY" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket legacy --session-id legacy --generation 1 \
      --runner claude-native --model claude-fixture --effort high \
      --deep-runner codex --deep-model gpt-fixture --deep-effort max \
      --state-dir "$STATE_DIR"
)"
EXIT=$?
assert_exit_code "$EXIT" "0" "legacy two-seat flags remain supported"
assert_eq "$(json_field "$OUT" verdict)" "READY" "legacy compatibility result is READY"

# Runtime validation stays at least as strict as the published manifest schema.
for mode in long-logical long-model excluded-type excluded-count excluded-long excluded-duplicate; do
  INVALID_MANIFEST="$TEST_TMP/invalid-$mode.json"
  node - "$MANIFEST" "$INVALID_MANIFEST" "$mode" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mode = process.argv[4];
value.logical_plan_id = `invalid-${mode}`;
if (mode === 'long-logical') value.logical_plan_id = 'x'.repeat(257);
if (mode === 'long-model') value.seats[0].model = 'm'.repeat(257);
if (mode === 'excluded-type') value.seats[0].excluded_families = [42];
if (mode === 'excluded-count') {
  value.seats[0].excluded_families = Array.from({ length: 17 }, (_, index) => `f${index}`);
}
if (mode === 'excluded-long') value.seats[0].excluded_families = ['f'.repeat(129)];
if (mode === 'excluded-duplicate') value.seats[0].excluded_families = ['same', 'same'];
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
  SCHEMA_OUT="$(node "$SCHEMA_CHECK" \
    --schema "$REPO_ROOT/schemas/plan-review-manifest.schema.json" \
    --document "$INVALID_MANIFEST" 2>&1)"; SCHEMA_EXIT=$?
  assert_neq "$SCHEMA_EXIT" "0" "$mode is rejected by the manifest schema"
  OUT="$(run_manifest "invalid-$mode" 1 "$INVALID_MANIFEST" "$ALL_READY" 2>&1)"; EXIT=$?
  assert_exit_code "$EXIT" "2" "$mode is rejected by runtime validation"
done

# Empty/whitespace plans fail before any state, claim, or dispatch is created.
EMPTY_PLAN="$TEST_TMP/empty-plan.md"
EMPTY_STATE="$TEST_TMP/empty-state"
printf ' \n\t\n' >"$EMPTY_PLAN"
OUT="$(
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$ALL_READY" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$EMPTY_PLAN" --rubric-file "$RUBRIC_FILE" \
      --ticket empty-plan --session-id empty-plan --generation 1 \
      --manifest-file "$MANIFEST" --state-dir "$EMPTY_STATE" 2>&1
)"
EXIT=$?
assert_exit_code "$EXIT" "2" "empty plan is rejected"
assert_contains "$OUT" "non-whitespace content" "empty-plan rejection is explicit"
assert_file_absent "$EMPTY_STATE" "empty plan spends no durable session state"

# Multiple substitutions coordinate against the actual panel, not the original primaries.
MULTI_FAMILY="$TEST_TMP/multi-family.json"
node - "$MANIFEST" "$MULTI_FAMILY" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'multi-family';
value.minimum_distinct_families = 4;
const fallback = (id, family) => ({
  id,
  runner: 'cc-shim',
  model: `${id}-model`,
  effort: 'high',
  endpoint: 'default',
  role: 'review',
  family,
  readiness_status: 'ready',
  qualification_status: 'qualified',
});
value.seats[0].readiness_status = 'unavailable';
value.seats[0].fallbacks = [fallback('architect_alt', 'anthropic')];
value.seats[1].readiness_status = 'unavailable';
value.seats[1].fallbacks = [
  fallback('operations_same', 'anthropic'),
  fallback('operations_alt', 'meta'),
];
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
MULTI_SEQUENCE="$(sequence \
  "architect_alt=$READY" "operations_alt=$READY" "skeptic=$READY" "product=$READY")"
OUT="$(run_manifest multi-family 1 "$MULTI_FAMILY" "$MULTI_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "0" "coordinated substitutions retain four families"
assert_eq "$(json_field "$OUT" substitutions.0.to_id)" "architect_alt" \
  "first unavailable seat uses its declared fallback"
assert_eq "$(json_field "$OUT" substitutions.1.to_id)" "operations_alt" \
  "second seat skips the now-correlated fallback"
assert_eq "$(json_field "$OUT" reviewer_verdicts.1.family)" "meta" \
  "artifact binds the actual family selected"
assert_eq "$(json_field "$OUT" verdict)" "READY" "family-safe replacement panel may be READY"
assert_artifact_schema "$OUT" "multi-substitution artifact matches schema"

# Optional exhaustion cannot produce READY when it drops the panel below its family floor.
OPTIONAL_FAMILY="$TEST_TMP/optional-family.json"
node - "$MANIFEST" "$OPTIONAL_FAMILY" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'optional-family';
value.seats = value.seats.slice(0, 3);
value.minimum_distinct_families = 3;
value.seats[2].required = false;
value.seats[2].readiness_status = 'unavailable';
value.seats[2].fallbacks = [];
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
OPTIONAL_SEQUENCE="$(sequence "architect=$READY" "operations=$READY")"
OUT="$(run_manifest optional-family 1 "$OPTIONAL_FAMILY" "$OPTIONAL_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "4" "optional exhaustion below family floor is transport-terminal"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" \
  "optional exhaustion cannot publish READY"
assert_eq "$(json_field "$OUT" policy_reason)" "panel_family_diversity_exhausted" \
  "family-floor failure has a stable reason"
assert_eq "$(json_field "$OUT" transport_status)" "transport_exhausted" \
  "family-floor failure is transport exhaustion"
assert_eq "$(json_field "$OUT" semantic_verdict)" "null" \
  "transport exhaustion cannot publish a semantic verdict"
assert_artifact_schema "$OUT" "family-diversity exhaustion artifact matches schema"

# Duplicate fingerprints with conflicting blocker classifications must merge
# conservatively: seat order cannot downgrade a valid candidate_blocker.
DEDUP_SOFT_FIRST="$TEST_TMP/dedupe-soft-first.json"
DEDUP_HARD_FIRST="$TEST_TMP/dedupe-hard-first.json"
node - "$MANIFEST" "$DEDUP_SOFT_FIRST" "$DEDUP_HARD_FIRST" <<'NODE'
const fs = require('fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.seats = source.seats.slice(0, 2);
source.minimum_distinct_families = 2;
for (const [file, id] of [
  [process.argv[3], 'dedupe-soft-first'],
  [process.argv[4], 'dedupe-hard-first'],
]) {
  const value = { ...source, logical_plan_id: id, seats: source.seats.map((seat) => ({ ...seat })) };
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
NODE
# Soft (non-blocker) first, hard blocker second.
SOFT_FIRST="$(sequence "architect=$BLOCKER_SOFT" "operations=$BLOCKER")"
OUT="$(run_manifest dedupe-soft-first 1 "$DEDUP_SOFT_FIRST" "$SOFT_FIRST")"; EXIT=$?
assert_exit_code "$EXIT" "0" "soft-then-hard duplicate panel returns"
assert_eq "$(json_field "$OUT" findings.0.candidate_blocker)" "true" \
  "later blocker admission cannot be suppressed by earlier soft report"
assert_eq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" \
  "conservatively merged blocker still requires depth-0 adjudication"
assert_eq "$(json_length "$OUT" findings)" "1" "duplicate fingerprint remains one finding"
# Hard blocker first, soft second — same admission result (seat-order independent).
HARD_FIRST="$(sequence "architect=$BLOCKER" "operations=$BLOCKER_SOFT")"
OUT="$(run_manifest dedupe-hard-first 1 "$DEDUP_HARD_FIRST" "$HARD_FIRST")"; EXIT=$?
assert_exit_code "$EXIT" "0" "hard-then-soft duplicate panel returns"
assert_eq "$(json_field "$OUT" findings.0.candidate_blocker)" "true" \
  "earlier blocker admission survives a later soft report"
assert_eq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" \
  "seat-reversed merge still requires depth-0 adjudication"
assert_eq "$(json_length "$OUT" findings)" "1" "reversed seat order still dedupes once"

# One frozen wall deadline is recomputed before every seat and before READY publication.
DEADLINE_MANIFEST="$TEST_TMP/deadline.json"
copy_manifest deadline-plan "$DEADLINE_MANIFEST"
MUST_NOT_READ="$TEST_TMP/must-not-dispatch.json"
DEADLINE_SEQUENCE="$(node - "$READY" "$MUST_NOT_READ" <<'NODE'
const [ready, missing] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  architect: [{ file: ready, delay_ms: 2100 }],
  operations: [missing],
  skeptic: [missing],
  product: [missing],
}));
NODE
)"
OUT="$(run_manifest_options deadline 1 "$DEADLINE_MANIFEST" "$DEADLINE_SEQUENCE" \
  --max-wall-seconds 2 --timeout 2s)"; EXIT=$?
assert_exit_code "$EXIT" "3" "shared panel deadline is terminal"
assert_eq "$(json_field "$OUT" policy_reason)" "wall_clock_expired" \
  "deadline expiry cannot publish READY"
assert_eq "$(json_length "$OUT" attempts)" "1" \
  "later seats receive no multiplied wall allowance"
assert_artifact_schema "$OUT" "wall-clock policy artifact matches schema"

repo_identity() {
  node - "$PLAN_REPO" <<'NODE'
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = process.argv[2];
const run = spawnSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
const raw = run.stdout.trim();
const common = path.isAbsolute(raw) ? raw : path.resolve(repo, raw);
process.stdout.write(`git-common-dir:${fs.realpathSync(common)}`);
NODE
}

logical_key() {
  node - "$1" "$2" <<'NODE'
const crypto = require('crypto');
process.stdout.write(crypto.createHash('sha256')
  .update(`${process.argv[2]}\0${process.argv[3]}`).digest('hex'));
NODE
}

session_key() {
  node - "$1" "$2" <<'NODE'
const crypto = require('crypto');
process.stdout.write(crypto.createHash('sha256')
  .update(`${process.argv[2]}\0${process.argv[3]}`).digest('hex'));
NODE
}

directory_inode() {
  node -e 'process.stdout.write(String(require("fs").lstatSync(process.argv[1]).ino))' "$1"
}

PROC_START="$(
  node - "$$" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const { spawnSync } = require('child_process');
const pid = process.argv[2];
if (fs.existsSync('/proc/self/stat')) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  process.stdout.write(raw.slice(raw.lastIndexOf(') ') + 2).trim().split(/\s+/)[19]);
} else {
  const observed = spawnSync('ps', ['-o', 'lstart=', '-p', pid], { encoding: 'utf8' });
  process.stdout.write(crypto.createHash('sha256')
    .update(`ps-lstart:${observed.stdout.trim()}`).digest('hex'));
}
NODE
)"
REPO_ID="$(repo_identity)"

# A live PID+start+nonce+inode lock is never reaped.
LIVE_LOCK_MANIFEST="$TEST_TMP/live-lock.json"
node - "$MANIFEST" "$LIVE_LOCK_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'live-lock';
value.seats = value.seats.slice(0, 1);
value.minimum_distinct_families = 1;
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
LIVE_KEY="$(logical_key "$REPO_ID" live-lock)"
LIVE_LOCK="$STATE_DIR/logical/$LIVE_KEY.lock"
mkdir -p "$LIVE_LOCK"
LIVE_INODE="$(directory_inode "$LIVE_LOCK")"
cat >"$LIVE_LOCK/owner.json" <<JSON
{"pid":$$,"process_start":"$PROC_START","nonce":"11111111111111111111111111111111","lock_inode":"$LIVE_INODE"}
JSON
OUT="$(run_manifest live-lock 1 "$LIVE_LOCK_MANIFEST" "$(sequence "architect=$READY")" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "3" "live durable lock blocks acquisition"
assert_contains "$OUT" "durable identity is busy" "live lock is not reaped"
assert_file_exists "$LIVE_LOCK/owner.json" "live lock remains owned"
rm -rf "$LIVE_LOCK"

# A correctly bound dead owner lock is reaped and the acquisition proceeds.
DEAD_LOCK_MANIFEST="$TEST_TMP/dead-lock.json"
node - "$LIVE_LOCK_MANIFEST" "$DEAD_LOCK_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'dead-lock';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
DEAD_KEY="$(logical_key "$REPO_ID" dead-lock)"
DEAD_LOCK="$STATE_DIR/logical/$DEAD_KEY.lock"
mkdir -p "$DEAD_LOCK"
DEAD_INODE="$(directory_inode "$DEAD_LOCK")"
cat >"$DEAD_LOCK/owner.json" <<JSON
{"pid":2147483647,"process_start":"1","nonce":"22222222222222222222222222222222","lock_inode":"$DEAD_INODE"}
JSON
OUT="$(run_manifest dead-lock 1 "$DEAD_LOCK_MANIFEST" "$(sequence "architect=$READY")")"
EXIT=$?
assert_exit_code "$EXIT" "0" "proven dead lock owner is recovered"
assert_file_absent "$DEAD_LOCK" "recovered lock is released after completion"
assert_artifact_schema "$OUT" "dead-lock recovery artifact matches schema"

# An unverifiable lock owner (inode mismatch / unprovable identity) is never reaped.
UNVERIFIABLE_LOCK_MANIFEST="$TEST_TMP/unverifiable-lock.json"
node - "$LIVE_LOCK_MANIFEST" "$UNVERIFIABLE_LOCK_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'unverifiable-lock';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
UNVERIFIABLE_KEY="$(logical_key "$REPO_ID" unverifiable-lock)"
UNVERIFIABLE_LOCK="$STATE_DIR/logical/$UNVERIFIABLE_KEY.lock"
mkdir -p "$UNVERIFIABLE_LOCK"
cat >"$UNVERIFIABLE_LOCK/owner.json" <<JSON
{"pid":2147483647,"process_start":"1","nonce":"33333333333333333333333333333333","lock_inode":"0"}
JSON
OUT="$(run_manifest unverifiable-lock 1 "$UNVERIFIABLE_LOCK_MANIFEST" "$(sequence "architect=$READY")" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "3" "unverifiable lock owner blocks acquisition"
assert_contains "$OUT" "unverifiable" "unverifiable lock is diagnosed"
assert_file_exists "$UNVERIFIABLE_LOCK/owner.json" "unverifiable lock is not reaped"
rm -rf "$UNVERIFIABLE_LOCK"

# A crash after durable claim acquisition never redispatches; recovery terminally
# exhausts the exact claim while retaining the original clock and claim journal.
CLAIM_MANIFEST="$TEST_TMP/claim-crash.json"
node - "$LIVE_LOCK_MANIFEST" "$CLAIM_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'claim-crash';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
CLAIM_SEQUENCE="$(sequence "architect=$READY")"
OUT="$(
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_TEST_PLAN_REVIEW_CRASH_AT=after_claim \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$CLAIM_SEQUENCE" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket claim-crash --session-id claim-crash-1 --generation 1 \
      --manifest-file "$CLAIM_MANIFEST" --state-dir "$STATE_DIR" 2>&1
)"
EXIT=$?
assert_exit_code "$EXIT" "86" "test seam crashes after the durable claim"
CLAIM_STATE="$STATE_DIR/$(session_key "$REPO_ID" claim-crash)/state.json"
CLAIM_DEADLINE_BEFORE="$(json_field "$(cat "$CLAIM_STATE")" deadline_at)"
NO_REDISPATCH="$(sequence "architect=$MUST_NOT_READ")"
OUT="$(run_manifest claim-crash 1 "$CLAIM_MANIFEST" "$NO_REDISPATCH")"; EXIT=$?
assert_exit_code "$EXIT" "4" "dead active claim recovers as transport exhaustion"
assert_eq "$(json_field "$OUT" policy_reason)" "orphaned_active_claim_transport_exhausted" \
  "orphan claim has a stable terminal reason"
assert_eq "$(json_length "$OUT" attempts)" "0" "orphan recovery performs no hidden redispatch"
assert_eq "$(json_length "$(cat "$CLAIM_STATE")" claims)" "1" \
  "crash recovery does not reset or duplicate claim attempts"
assert_eq "$(json_field "$(cat "$CLAIM_STATE")" claims.0.status)" "transport-exhausted" \
  "original claim is terminally journaled"
assert_eq "$(json_field "$(cat "$CLAIM_STATE")" claims.0.attempt_count)" "2" \
  "unknown in-flight work conservatively consumes the frozen seat attempt ceiling"
assert_eq "$(json_field "$(cat "$CLAIM_STATE")" deadline_at)" "$CLAIM_DEADLINE_BEFORE" \
  "crash recovery preserves the original absolute deadline"
assert_artifact_schema "$OUT" "orphaned-claim artifact matches schema"

# An active claim whose owner cannot be proven live or dead fails closed.
UNVERIFIABLE_CLAIM_MANIFEST="$TEST_TMP/unverifiable-claim.json"
node - "$LIVE_LOCK_MANIFEST" "$UNVERIFIABLE_CLAIM_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'unverifiable-claim';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_TEST_PLAN_REVIEW_CRASH_AT=after_claim \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$CLAIM_SEQUENCE" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket unverifiable-claim --session-id unverifiable-claim-1 --generation 1 \
      --manifest-file "$UNVERIFIABLE_CLAIM_MANIFEST" --state-dir "$STATE_DIR" 2>&1
)"
EXIT=$?
assert_exit_code "$EXIT" "86" "test seam crashes after unverifiable-claim fixture claim"
UNVERIFIABLE_CLAIM_STATE="$STATE_DIR/$(session_key "$REPO_ID" unverifiable-claim)/state.json"
node - "$UNVERIFIABLE_CLAIM_STATE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!state.active_claim || !state.active_claim.owner) process.exit(2);
// Corrupt the binding so liveness cannot be proven without silently reaping.
state.active_claim.owner.session_inode = '0';
fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
NODE
OUT="$(run_manifest unverifiable-claim 1 "$UNVERIFIABLE_CLAIM_MANIFEST" "$NO_REDISPATCH" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "3" "unverifiable active claim fails closed"
assert_contains "$OUT" "unverifiable" "unverifiable claim is diagnosed"
assert_eq "$(json_field "$(cat "$UNVERIFIABLE_CLAIM_STATE")" active_claim.owner.session_inode)" "0" \
  "unverifiable claim is not silently cleared"
assert_eq "$(json_field "$(cat "$UNVERIFIABLE_CLAIM_STATE")" terminal)" "false" \
  "unverifiable claim does not invent a terminal transport exhaustion"

# Controlled post-claim failures must abort the claim honestly so a retry is
# never misclassified as orphaned transport exhaustion.
POST_CLAIM_MANIFEST="$TEST_TMP/post-claim-error.json"
node - "$LIVE_LOCK_MANIFEST" "$POST_CLAIM_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'post-claim-error';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
MISSING_RAW="/no/such/plan-review-raw-log-$$.json"
POST_CLAIM_BAD="$(sequence "architect=$MISSING_RAW")"
OUT="$(run_manifest post-claim-error 1 "$POST_CLAIM_MANIFEST" "$POST_CLAIM_BAD" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "2" "unreadable post-claim raw-log is a controlled error"
assert_contains "$OUT" "not readable" "unreadable raw-log is diagnosed"
POST_CLAIM_STATE="$STATE_DIR/$(session_key "$REPO_ID" post-claim-error)/state.json"
assert_file_exists "$POST_CLAIM_STATE" "controlled failure still leaves durable state"
assert_eq "$(json_field "$(cat "$POST_CLAIM_STATE")" active_claim)" "null" \
  "controlled post-claim failure clears the active claim"
assert_eq "$(json_field "$(cat "$POST_CLAIM_STATE")" claims.0.status)" "aborted" \
  "controlled failure journals an aborted claim, not in-flight"
assert_eq "$(json_field "$(cat "$POST_CLAIM_STATE")" terminal)" "false" \
  "controlled input/transport path failure does not invent terminality"
OUT="$(run_manifest post-claim-error 1 "$POST_CLAIM_MANIFEST" "$(sequence "architect=$READY")")"
EXIT=$?
assert_exit_code "$EXIT" "0" "retry after controlled abort redispatches cleanly"
assert_eq "$(json_field "$OUT" verdict)" "READY" "retry is not false orphan transport exhaustion"
assert_neq "$(json_field "$OUT" policy_reason)" "orphaned_active_claim_transport_exhausted" \
  "retry must not publish orphaned transport exhaustion"
# Invalid disposition identity/shape fails closed and must not strand a claim either.
BAD_DISPOSITION="$TEST_TMP/bad-disposition.json"
cat >"$BAD_DISPOSITION" <<'JSON'
{
  "schema_version": 1,
  "logical_plan_id": "post-claim-error",
  "generation": 1,
  "findings": [{
    "fingerprint": "not-a-valid-sha256-fingerprint-value-xxxxxxxxxxxx",
    "disposition": "accepted_blocker",
    "rationale": "invalid fingerprint shape"
  }]
}
JSON
DISPOSITION_TICKET_MANIFEST="$TEST_TMP/disposition-abort.json"
node - "$LIVE_LOCK_MANIFEST" "$DISPOSITION_TICKET_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'disposition-abort';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
# Rewrite disposition to match this ticket's logical plan id for the shape-invalid case.
node - "$BAD_DISPOSITION" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
value.logical_plan_id = 'disposition-abort';
fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(run_manifest disposition-abort 1 "$DISPOSITION_TICKET_MANIFEST" \
  "$(sequence "architect=$READY")" "$BAD_DISPOSITION" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "2" "invalid disposition input is controlled failure"
assert_contains "$OUT" "disposition" "invalid disposition is diagnosed"
DISP_STATE="$STATE_DIR/$(session_key "$REPO_ID" disposition-abort)/state.json"
assert_file_exists "$DISP_STATE" "invalid disposition still leaves durable state"
assert_eq "$(json_field "$(cat "$DISP_STATE")" active_claim)" "null" \
  "invalid disposition does not leave an active claim"
assert_eq "$(json_field "$(cat "$DISP_STATE")" claims.0.status)" "aborted" \
  "invalid disposition aborts the claim instead of orphaning it"
assert_eq "$(json_field "$(cat "$DISP_STATE")" terminal)" "false" \
  "invalid disposition does not invent a terminal orphan"
OUT="$(run_manifest disposition-abort 1 "$DISPOSITION_TICKET_MANIFEST" \
  "$(sequence "architect=$READY")")"; EXIT=$?
assert_exit_code "$EXIT" "0" "retry after invalid disposition is not orphan exhaustion"
assert_eq "$(json_field "$OUT" verdict)" "READY" "clean retry after disposition abort succeeds"

# Initialization crash leaves a provable session identity, not a poisoned or
# stealable logical index. The canonical ticket alone can resume it.
ORPHAN_MANIFEST="$TEST_TMP/orphan-index.json"
node - "$LIVE_LOCK_MANIFEST" "$ORPHAN_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'orphan-index';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_TEST_PLAN_REVIEW_CRASH_AT=after_session_init \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$CLAIM_SEQUENCE" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket orphan-original --session-id orphan-1 --generation 1 \
      --manifest-file "$ORPHAN_MANIFEST" --state-dir "$STATE_DIR" 2>&1
)"
EXIT=$?
assert_exit_code "$EXIT" "86" "test seam crashes between session initialization and index commit"
ORPHAN_KEY="$(logical_key "$REPO_ID" orphan-index)"
assert_file_absent "$STATE_DIR/logical/$ORPHAN_KEY.json" \
  "crash point precedes logical index publication"
OUT="$(run_manifest orphan-steal 1 "$ORPHAN_MANIFEST" "$NO_REDISPATCH" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "3" "new ticket cannot steal an orphaned initialized session"
assert_contains "$OUT" "canonical ticket orphan-original" \
  "orphan scan recovers the original canonical ticket"
assert_file_exists "$STATE_DIR/logical/$ORPHAN_KEY.json" \
  "proven orphan is durably rebound to its original ticket"
OUT="$(run_manifest orphan-original 1 "$ORPHAN_MANIFEST" "$CLAIM_SEQUENCE")"; EXIT=$?
assert_exit_code "$EXIT" "0" "original ticket resumes after orphan recovery"
assert_eq "$(json_field "$OUT" verdict)" "READY" "recovered original session completes"

SAME_TICKET_DIFFERENT_PLAN="$TEST_TMP/same-ticket-different-plan.json"
node - "$ORPHAN_MANIFEST" "$SAME_TICKET_DIFFERENT_PLAN" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'different-logical-plan';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(run_manifest orphan-original 1 "$SAME_TICKET_DIFFERENT_PLAN" "$NO_REDISPATCH" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "3" "one ticket cannot initialize a second logical plan"
assert_contains "$OUT" "logical plan already bound" \
  "same-ticket/different-plan conflict is explicit"
DIFFERENT_KEY="$(logical_key "$REPO_ID" different-logical-plan)"
assert_file_absent "$STATE_DIR/logical/$DIFFERENT_KEY.json" \
  "failed same-ticket binding does not poison a new logical index"

# Caller max-generations=1 is an irreversible tightening, not ignored metadata.
CAP_MANIFEST="$TEST_TMP/cap-one.json"
node - "$LIVE_LOCK_MANIFEST" "$CAP_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'cap-one';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
CAP_BLOCKER_SEQUENCE="$(sequence "architect=$BLOCKER")"
OUT="$(run_manifest_options cap-one 1 "$CAP_MANIFEST" "$CAP_BLOCKER_SEQUENCE" \
  --max-generations 1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "unadjudicated blocker at caller cap is conditional"
assert_eq "$(json_field "$OUT" terminal)" "true" "caller generation cap is terminal"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" \
  "reviewer prose cannot become STOP authority at caller cap"
assert_eq "$(json_field "$OUT" policy_reason)" "generation_cap_requires_depth_0_adjudication" \
  "caller cap preserves depth-0 adjudication authority"
assert_eq "$(json_field "$OUT" next_generation)" "null" "caller cap cannot schedule generation 2"
assert_artifact_schema "$OUT" "caller-cap artifact matches schema"
CAP_FINGERPRINT="$(json_field "$OUT" findings.0.fingerprint)"

CAP_ACCEPT_MANIFEST="$TEST_TMP/cap-one-accepted.json"
node - "$CAP_MANIFEST" "$CAP_ACCEPT_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'cap-one-accepted';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
CAP_DISPOSITION="$TEST_TMP/cap-one-disposition.json"
cat >"$CAP_DISPOSITION" <<JSON
{
  "schema_version": 1,
  "logical_plan_id": "cap-one-accepted",
  "generation": 1,
  "findings": [{
    "fingerprint": "$CAP_FINGERPRINT",
    "disposition": "accepted_blocker",
    "rationale": "depth-0 accepted the frozen-rubric blocker"
  }]
}
JSON
OUT="$(run_manifest_options cap-one-accepted 1 "$CAP_ACCEPT_MANIFEST" \
  "$CAP_BLOCKER_SEQUENCE" --max-generations 1 --disposition-file "$CAP_DISPOSITION")"
EXIT=$?
assert_exit_code "$EXIT" "3" "accepted blocker controls STOP at caller cap"
assert_eq "$(json_field "$OUT" verdict)" "STOP" "only adjudicated blocker gains STOP authority"
assert_eq "$(json_field "$OUT" policy_reason)" "generation_cap_with_accepted_blockers" \
  "accepted cap blocker has a stable reason"
assert_artifact_schema "$OUT" "accepted caller-cap artifact matches schema"

# A ceiling frozen at one cannot be broadened after an initialization crash.
CAP_FREEZE_MANIFEST="$TEST_TMP/cap-freeze.json"
node - "$CAP_MANIFEST" "$CAP_FREEZE_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'cap-freeze';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_TEST_PLAN_REVIEW_CRASH_AT=after_session_init \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$CLAIM_SEQUENCE" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket cap-freeze --session-id cap-freeze --generation 1 \
      --manifest-file "$CAP_FREEZE_MANIFEST" --state-dir "$STATE_DIR" \
      --max-generations 1 2>&1
)"
EXIT=$?
assert_exit_code "$EXIT" "86" "cap-freeze fixture crashes after initialization"
OUT="$(run_manifest_options cap-freeze 1 "$CAP_FREEZE_MANIFEST" "$NO_REDISPATCH" \
  --max-generations 2 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "3" "resume cannot broaden frozen generation ceiling"
assert_contains "$OUT" "cannot broaden" "generation broadening rejection is explicit"
OUT="$(run_manifest_options cap-freeze 1 "$CAP_FREEZE_MANIFEST" "$CLAIM_SEQUENCE" \
  --max-generations 1)"; EXIT=$?
assert_exit_code "$EXIT" "0" "original tightened ceiling remains executable"

# Generation 2 is always terminal, but raw reviewer blockers remain candidates:
# they require depth-0 adjudication and cannot self-promote to STOP or generation 3.
GEN2_AUTH_MANIFEST="$TEST_TMP/gen2-authority.json"
node - "$CAP_MANIFEST" "$GEN2_AUTH_MANIFEST" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.logical_plan_id = 'gen2-authority';
fs.writeFileSync(process.argv[3], `${JSON.stringify(value, null, 2)}\n`);
NODE
OUT="$(run_manifest gen2-authority 1 "$GEN2_AUTH_MANIFEST" "$CAP_BLOCKER_SEQUENCE")"
EXIT=$?
assert_exit_code "$EXIT" "0" "generation-1 blocker awaits adjudication"
GEN2_AUTH_FINGERPRINT="$(json_field "$OUT" findings.0.fingerprint)"
GEN2_AUTH_DISPOSITION="$TEST_TMP/gen2-authority-disposition.json"
cat >"$GEN2_AUTH_DISPOSITION" <<JSON
{
  "schema_version": 1,
  "logical_plan_id": "gen2-authority",
  "generation": 1,
  "findings": [{
    "fingerprint": "$GEN2_AUTH_FINGERPRINT",
    "disposition": "accepted_blocker",
    "rationale": "authorizes one bounded repair generation"
  }]
}
JSON
cp "$PLAN_FILE" "$TEST_TMP/plan-before-gen2.md"
printf '%s\n' 'Small repair.' >>"$PLAN_FILE"
OUT="$(run_manifest gen2-authority 2 "$GEN2_AUTH_MANIFEST" \
  "$CAP_BLOCKER_SEQUENCE" "$GEN2_AUTH_DISPOSITION")"; EXIT=$?
cp "$TEST_TMP/plan-before-gen2.md" "$PLAN_FILE"
assert_exit_code "$EXIT" "0" "raw generation-2 blocker is terminal conditional"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" \
  "generation-2 reviewer cannot self-authorize STOP"
assert_eq "$(json_field "$OUT" terminal)" "true" "generation 2 remains the hard terminal cap"
assert_eq "$(json_field "$OUT" policy_reason)" "generation_cap_requires_depth_0_adjudication" \
  "generation-2 candidate is handed to depth-0"
assert_eq "$(json_field "$OUT" next_generation)" "null" "generation 3 is never scheduled"
assert_neq "$(json_field "$OUT" growth_ratio.numerator)" \
  "$(json_field "$OUT" growth_ratio.denominator)" \
  "non-integral plan growth is represented as a lossless rational"
assert_artifact_schema "$OUT" "generation-2 candidate artifact matches schema"

OUT="$(run_manifest_options impossible-generation 3 "$GEN2_AUTH_MANIFEST" "$NO_REDISPATCH" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "3" "generation 3 is rejected before dispatch"
assert_contains "$OUT" "generation exceeds hard cap 2" "generation-3 rejection is explicit"

# partial-depth0-disposition: every blocker candidate needs a disposition.
# Mixed accepted + undispositioned must not authorize generation 2.
BLOCKER_B="$TEST_TMP/blocker-b.json"
node - "$BLOCKER" "$BLOCKER_B" <<'NODE'
const fs = require('fs');
const hard = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const second = {
  verdict: 'STOP',
  findings: hard.findings.map((finding) => ({
    ...finding,
    affected_surface: 'section 3 generation cap',
    claim: 'the next slice can schedule generation 3 by prose',
    evidence: 'section 3 omits a hard terminal generation cap',
    evidence_reference: 'plan:section-3',
    repair: 'bind generation 2 as the hard terminal cap',
  })),
};
fs.writeFileSync(process.argv[3], `${JSON.stringify(second)}\n`);
NODE
PARTIAL_MANIFEST="$TEST_TMP/partial-disposition.json"
copy_manifest partial-disposition "$PARTIAL_MANIFEST"
PARTIAL_SEQUENCE="$(sequence \
  "architect=$BLOCKER" "operations=$BLOCKER_B" "skeptic=$READY" "product=$READY")"
OUT="$(run_manifest partial-disposition 1 "$PARTIAL_MANIFEST" "$PARTIAL_SEQUENCE")"
EXIT=$?
assert_exit_code "$EXIT" "0" "two distinct blocker candidates open adjudication"
assert_eq "$(json_length "$OUT" findings)" "2" "two candidate blockers survive dedupe"
FP_A="$(json_field "$OUT" findings.0.fingerprint)"
FP_B="$(json_field "$OUT" findings.1.fingerprint)"
assert_neq "$FP_A" "$FP_B" "distinct blocker surfaces yield distinct fingerprints"
PARTIAL_ACCEPT_MANIFEST="$TEST_TMP/partial-disposition-accept.json"
copy_manifest partial-disposition-accept "$PARTIAL_ACCEPT_MANIFEST"
PARTIAL_DISPOSITION="$TEST_TMP/partial-disposition-decisions.json"
cat >"$PARTIAL_DISPOSITION" <<JSON
{
  "schema_version": 1,
  "logical_plan_id": "partial-disposition-accept",
  "generation": 1,
  "findings": [{
    "fingerprint": "$FP_A",
    "disposition": "accepted_blocker",
    "rationale": "verified blocker for surface A only; B left undispositioned"
  }]
}
JSON
OUT="$(run_manifest partial-disposition-accept 1 "$PARTIAL_ACCEPT_MANIFEST" \
  "$PARTIAL_SEQUENCE" "$PARTIAL_DISPOSITION")"
EXIT=$?
assert_exit_code "$EXIT" "0" "partial disposition still returns a bounded artifact"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" \
  "partial disposition remains conditional"
assert_eq "$(json_field "$OUT" terminal)" "false" \
  "partial disposition is nonterminal pending remaining candidates"
assert_eq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" \
  "unresolved candidates still require depth-0 adjudication"
assert_eq "$(json_field "$OUT" repair_authorized)" "false" \
  "accepted-plus-undispositioned cannot authorize generation 2"
assert_eq "$(json_field "$OUT" accepted_blocker_count)" "1" \
  "accepted count records the dispositioned blocker only"
assert_artifact_schema "$OUT" "partial-disposition artifact matches schema"
# Gen2 with the same incomplete disposition must fail closed (not authorize).
OUT="$(run_manifest partial-disposition-accept 2 "$PARTIAL_ACCEPT_MANIFEST" \
  "$ALL_READY" "$PARTIAL_DISPOSITION" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "3" "generation 2 rejects incomplete disposition set"
assert_contains "$OUT" "every blocker candidate" \
  "incomplete disposition diagnosis is explicit"

# All-rejected complete disposition terminates CONDITIONAL; no further adjudication.
REJECT_RUN_MANIFEST="$TEST_TMP/reject-all-run.json"
copy_manifest reject-all-run "$REJECT_RUN_MANIFEST"
REJECT_ALL_DISPOSITION="$TEST_TMP/reject-all-decisions.json"
cat >"$REJECT_ALL_DISPOSITION" <<JSON
{
  "schema_version": 1,
  "logical_plan_id": "reject-all-run",
  "generation": 1,
  "findings": [
    {
      "fingerprint": "$FP_A",
      "disposition": "rejected",
      "rationale": "does not block next-slice integrity under frozen rubric"
    },
    {
      "fingerprint": "$FP_B",
      "disposition": "rejected",
      "rationale": "duplicate concern already out of scope for this slice"
    }
  ]
}
JSON
OUT="$(run_manifest reject-all-run 1 "$REJECT_RUN_MANIFEST" \
  "$PARTIAL_SEQUENCE" "$REJECT_ALL_DISPOSITION")"; EXIT=$?
assert_exit_code "$EXIT" "0" "complete all-rejected disposition executes"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" \
  "all-rejected complete disposition is conditional"
assert_eq "$(json_field "$OUT" terminal)" "true" \
  "all-rejected complete disposition is terminal"
assert_neq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" \
  "fully dispositioned zero-accept does not request further adjudication"
assert_eq "$(json_field "$OUT" repair_authorized)" "false" \
  "all-rejected disposition cannot authorize generation 2"
assert_eq "$(json_field "$OUT" accepted_blocker_count)" "0" \
  "all-rejected leaves zero accepted blockers"
assert_eq "$(json_field "$OUT" next_generation)" "null" \
  "all-rejected does not schedule generation 2"
assert_artifact_schema "$OUT" "all-rejected disposition artifact matches schema"

# all-rejected-ready-leak: READY seat verdicts alongside blocker findings must not
# leak terminal READY after a complete zero-accept disposition. READY is reserved
# for runs that never produced blocker candidates.
READY_WITH_BLOCKER="$TEST_TMP/ready-with-blocker.json"
node - "$BLOCKER" "$READY_WITH_BLOCKER" <<'NODE'
const fs = require('fs');
const hard = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const readyBlocker = { ...hard, verdict: 'READY' };
fs.writeFileSync(process.argv[3], `${JSON.stringify(readyBlocker)}\n`);
NODE
READY_BLOCKER_SEQUENCE="$(sequence \
  "architect=$READY_WITH_BLOCKER" "operations=$READY" "skeptic=$READY" "product=$READY")"
READY_LEAK_MANIFEST="$TEST_TMP/ready-leak.json"
copy_manifest ready-leak "$READY_LEAK_MANIFEST"
OUT="$(run_manifest ready-leak 1 "$READY_LEAK_MANIFEST" "$READY_BLOCKER_SEQUENCE")"
EXIT=$?
assert_exit_code "$EXIT" "0" "ready-with-blocker panel opens adjudication"
assert_eq "$(json_field "$OUT" findings.0.candidate_blocker)" "true" \
  "ready-verdict seat still admits a blocker candidate"
FP_READY_LEAK="$(json_field "$OUT" findings.0.fingerprint)"
READY_LEAK_RUN_MANIFEST="$TEST_TMP/ready-leak-run.json"
copy_manifest ready-leak-run "$READY_LEAK_RUN_MANIFEST"
READY_LEAK_DISPOSITION="$TEST_TMP/ready-leak-decisions.json"
cat >"$READY_LEAK_DISPOSITION" <<JSON
{
  "schema_version": 1,
  "logical_plan_id": "ready-leak-run",
  "generation": 1,
  "findings": [{
    "fingerprint": "$FP_READY_LEAK",
    "disposition": "rejected",
    "rationale": "does not block next-slice integrity under frozen rubric"
  }]
}
JSON
OUT="$(run_manifest ready-leak-run 1 "$READY_LEAK_RUN_MANIFEST" \
  "$READY_BLOCKER_SEQUENCE" "$READY_LEAK_DISPOSITION")"; EXIT=$?
assert_exit_code "$EXIT" "0" "all-rejected ready-with-blocker disposition executes"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" \
  "rejected blocker candidates never leak READY despite READY seat verdicts"
assert_eq "$(json_field "$OUT" terminal)" "true" \
  "zero-accept after blocker candidates is terminal"
assert_neq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" \
  "complete zero-accept does not re-open depth-0 adjudication"
assert_eq "$(json_field "$OUT" repair_authorized)" "false" \
  "zero-accept after blockers cannot authorize generation 2"
assert_eq "$(json_field "$OUT" accepted_blocker_count)" "0" \
  "ready-leak rejection leaves zero accepted blockers"
assert_eq "$(json_field "$OUT" next_generation)" "null" \
  "ready-leak rejection does not schedule generation 2"
assert_artifact_schema "$OUT" "ready-leak disposition artifact matches schema"

# all-rejected-gen2-coverage: exercise the real post-generation-1 authorization
# gate. Gen1 without dispositions, then gen2 with complete rejections must
# terminate CONDITIONAL without dispatching generation-2 reviewers.
GEN2_REJECT_MANIFEST="$TEST_TMP/gen2-reject-gate.json"
copy_manifest gen2-reject-gate "$GEN2_REJECT_MANIFEST"
OUT="$(run_manifest gen2-reject-gate 1 "$GEN2_REJECT_MANIFEST" "$PARTIAL_SEQUENCE")"
EXIT=$?
assert_exit_code "$EXIT" "0" "generation 1 without disposition opens the gate path"
assert_eq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" \
  "generation 1 without disposition requires depth-0 adjudication"
assert_eq "$(json_field "$OUT" terminal)" "false" \
  "generation 1 without disposition is nonterminal"
assert_eq "$(json_field "$OUT" repair_authorized)" "false" \
  "generation 1 without disposition does not authorize repair"
assert_eq "$(json_field "$OUT" next_generation)" "2" \
  "generation 1 without disposition names generation 2 as next"
FP_GATE_A="$(json_field "$OUT" findings.0.fingerprint)"
FP_GATE_B="$(json_field "$OUT" findings.1.fingerprint)"
GEN2_REJECT_DISPOSITION="$TEST_TMP/gen2-reject-decisions.json"
cat >"$GEN2_REJECT_DISPOSITION" <<JSON
{
  "schema_version": 1,
  "logical_plan_id": "gen2-reject-gate",
  "generation": 1,
  "findings": [
    {
      "fingerprint": "$FP_GATE_A",
      "disposition": "rejected",
      "rationale": "does not block next-slice integrity under frozen rubric"
    },
    {
      "fingerprint": "$FP_GATE_B",
      "disposition": "rejected",
      "rationale": "duplicate concern already out of scope for this slice"
    }
  ]
}
JSON
# If generation 2 dispatched reviewers, the sequence would be consumed; an empty
# attempts array proves the zero-accept gate terminated before panel dispatch.
OUT="$(run_manifest gen2-reject-gate 2 "$GEN2_REJECT_MANIFEST" \
  "$ALL_READY" "$GEN2_REJECT_DISPOSITION")"; EXIT=$?
assert_exit_code "$EXIT" "0" "generation 2 with complete rejections executes"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" \
  "post-gen1 complete zero-accept terminates conditional"
assert_eq "$(json_field "$OUT" terminal)" "true" \
  "post-gen1 complete zero-accept is terminal"
assert_eq "$(json_field "$OUT" policy_reason)" "no_accepted_blocker_authorizes_generation_2" \
  "post-gen1 zero-accept uses the generation-2 authorization gate"
assert_neq "$(json_field "$OUT" policy_reason)" "depth_0_adjudication_required" \
  "complete rejections do not re-open depth-0 adjudication at generation 2"
assert_eq "$(json_field "$OUT" repair_authorized)" "false" \
  "complete rejections do not authorize repair"
assert_eq "$(json_field "$OUT" accepted_blocker_count)" "0" \
  "generation-2 zero-accept gate leaves zero accepted blockers"
assert_eq "$(json_field "$OUT" next_generation)" "null" \
  "generation-2 zero-accept does not schedule another generation"
assert_eq "$(json_length "$OUT" attempts)" "0" \
  "generation-2 zero-accept does not dispatch reviewer attempts"
assert_artifact_schema "$OUT" "generation-2 zero-accept gate artifact matches schema"

finalize_test
