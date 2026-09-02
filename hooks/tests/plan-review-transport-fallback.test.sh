#!/usr/bin/env bash
# plan-review-transport-fallback.test.sh — contract for a seat's optional, frozen
# `transport_fallback`: retrying the SAME logical reviewer over a second authorized pipe.
#
# The property under test is a boundary, not a feature: a transport event must be able to change
# WHICH PIPE was used and nothing else. Every case below either proves the retry happened for a
# transport-class reason, or proves it did NOT happen for a reason that only looks like one.
#
# Read-only posture for the cursor rail itself (`-p --trust --mode ask`, scratch cwd, no salvage
# from stderr) is already pinned by hooks/tests/dispatch-review-author-cursor.test.sh and is NOT
# re-asserted here — the fallback reaches the engine through that same dispatch-author.sh rail, so
# duplicating those assertions would create a second place to keep in sync.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
. "$SELF_DIR/lib.sh"

REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
SCHEMA_CHECK="$REPO_ROOT/scripts/validate-json-schema.js"
MANIFEST_SCHEMA="$REPO_ROOT/schemas/plan-review-manifest.schema.json"

PLAN_REPO="$TEST_TMP/plan-repo"
PLAN_FILE="$PLAN_REPO/plan.md"
RUBRIC_FILE="$PLAN_REPO/rubric.md"
STATE_DIR="$TEST_TMP/state"

mkdir -p "$PLAN_REPO"
git -C "$PLAN_REPO" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' >"$PLAN_FILE"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' >"$RUBRIC_FILE"

READY="$TEST_TMP/ready.json";  printf '{"verdict":"READY","findings":[]}'  > "$READY"
STOPF="$TEST_TMP/stop.json";   printf '{"verdict":"STOP","findings":[]}'   > "$STOPF"
EMPTY="$TEST_TMP/empty.raw";   : > "$EMPTY"
GARBAGE="$TEST_TMP/garbage.raw"; printf 'not json at all' > "$GARBAGE"

json_field() {
  node -e '
const doc = JSON.parse(process.argv[1]);
const value = process.argv[2].split(".").reduce((acc, k) => (acc === undefined || acc === null ? acc : acc[k]), doc);
process.stdout.write(value === undefined || value === null ? "null" : (typeof value === "object" ? JSON.stringify(value) : String(value)));
' "$1" "$2" 2>/dev/null
}

# One seat, so the panel arithmetic is unambiguous and a family change would be visible.
# `fallbacks: []` on purpose: every retry in this file must be attributable to the transport
# fallback and never to a semantic substitution.
write_manifest() {
  local out="$1" logical="$2" fallback_json="$3"
  node - "$out" "$logical" "$fallback_json" <<'NODE'
const fs = require('fs');
const [out, logical, fallbackJson] = process.argv.slice(2);
const seat = {
  id: 'architect', runner: 'codex', model: 'gpt-fixture',
  effort: 'high', endpoint: 'default', role: 'architecture',
  family: 'openai', readiness_status: 'ready',
  qualification_status: 'qualified', required: true,
  excluded_families: [], fallbacks: [],
};
if (fallbackJson !== 'none') seat.transport_fallback = JSON.parse(fallbackJson);
fs.writeFileSync(out, `${JSON.stringify({
  schema_version: 1,
  artifact_type: 'plan_review_manifest',
  logical_plan_id: logical,
  minimum_distinct_families: 1,
  max_attempts_per_seat: 2,
  seats: [seat],
}, null, 2)}\n`);
NODE
}

run_manifest() {
  local ticket="$1" manifest="$2" responses="$3"
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$responses" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket "$ticket" --session-id "session-$ticket" --generation 1 \
      --manifest-file "$manifest" --state-dir "$STATE_DIR"
}

# seat sequence: attempt 1 then attempt 2, each {file, classification}
sequence() {
  node -e '
const [f1, c1, f2, c2] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  architect: [{ file: f1, classification: c1 }, { file: f2, classification: c2 }],
}));' "$@"
}

QUALIFIED_FALLBACK='{"runner":"cursor","model":"cursor-grok-4.6-xhigh","endpoint":"default","qualification_status":"qualified"}'

# ── 1. KR1: a manifest with no transport_fallback is byte-identical to before ─────────
NOFB="$TEST_TMP/m-nofb.json"
write_manifest "$NOFB" nofb-plan none
node "$SCHEMA_CHECK" --schema "$MANIFEST_SCHEMA" --document "$NOFB" >/dev/null 2>&1
assert_exit_code "$?" "0" "a manifest without transport_fallback still matches the closed schema"
OUT="$(run_manifest nofb "$NOFB" "$(sequence "$READY" success "$READY" success)")"; EXIT=$?
assert_exit_code "$EXIT" "0" "no-fallback manifest executes unchanged"
assert_eq "$(json_field "$OUT" verdict)" "READY" "no-fallback manifest reaches its verdict"
assert_not_contains "$OUT" 'transport_retry' "an absent field materializes nothing in the artifact"
assert_not_contains "$OUT" 'actual_transport' "an absent field adds no per-attempt transport record"
# The drift that the two "no transport_retry / no actual_transport" assertions above do NOT catch:
# a field emitted on EVERY attempt would change the artifact bytes of every manifest written
# before this feature existed, which is what KR1 forbids. Pin the key's absence directly.
assert_not_contains "$OUT" 'logical_identity' \
  "a seat with no declared fallback emits no logical_identity — legacy artifact bytes do not drift"

# ── 2. the manifest shape is closed around the new field ─────────────────────────────
BADFB="$TEST_TMP/m-badfb.json"
write_manifest "$BADFB" badfb-plan '{"runner":"cursor","model":"cursor-grok-4.6-xhigh","endpoint":"default","qualification_status":"qualified","family":"xai"}'
node "$SCHEMA_CHECK" --schema "$MANIFEST_SCHEMA" --document "$BADFB" >/dev/null 2>&1
assert_exit_code "$?" "1" "a transport_fallback carrying a family is rejected by the schema"
OUT="$(run_manifest badfb "$BADFB" "$(sequence "$READY" success "$READY" success)" 2>&1)"; EXIT=$?
# exit 2 is this rail's existing manifest-shape rejection code (same as the fifth-seat case).
assert_exit_code "$EXIT" "2" "the runtime rejects it too, not only the schema"
assert_contains "$OUT" "invalid shape" "the rejection names the shape"

UNKNOWN_RUNNER="$TEST_TMP/m-unknown.json"
write_manifest "$UNKNOWN_RUNNER" unknown-plan '{"runner":"not-a-runner","model":"x","endpoint":"default","qualification_status":"qualified"}'
OUT="$(run_manifest unknownrunner "$UNKNOWN_RUNNER" "$(sequence "$READY" success "$READY" success)" 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "an unknown fallback runner is refused at freeze time"
assert_contains "$OUT" "invalid transport fallback" "the refusal names the transport fallback"

# ── 3. the core behavior: a transport-class failure retries the SAME seat ─────────────
# Every non-success runner-envelope outcome must arm the retry. Looping the set is the point:
# a future outcome added to the enum but not to TRANSPORT_CLASS_FAILURES shows up here.
for CLASS in exit_failure timeout quota unavailable interrupted; do
  M="$TEST_TMP/m-$CLASS.json"
  write_manifest "$M" "retry-$CLASS-plan" "$QUALIFIED_FALLBACK"
  OUT="$(run_manifest "retry-$CLASS" "$M" "$(sequence "$EMPTY" "$CLASS" "$READY" success)")"; EXIT=$?
  assert_exit_code "$EXIT" "0" "$CLASS: the retry over the second transport reaches a verdict"
  assert_eq "$(json_field "$OUT" verdict)" "READY" "$CLASS: the verdict is the seat's, not a substitute's"
  assert_eq "$(json_field "$OUT" attempts.1.actual_transport.runner)" "cursor" \
    "$CLASS: attempt 2 records the actual transport"
  assert_eq "$(json_field "$OUT" attempts.1.actual_transport.reason)" "transport_$CLASS" \
    "$CLASS: the reason names the transport failure that armed it"
  # KR2/KR4: the logical identity is untouched — this is what makes it a transport event.
  assert_eq "$(json_field "$OUT" attempts.1.logical_identity.model)" "gpt-fixture" \
    "$CLASS: the logical model is unchanged on the retry attempt"
  assert_eq "$(json_field "$OUT" attempts.1.logical_identity.family)" "openai" \
    "$CLASS: the logical family is unchanged — decorrelation math cannot move"
  assert_eq "$(json_field "$OUT" attempts.1.target_id)" "architect" \
    "$CLASS: the seat is still itself; no substitution occurred"
done

# ── 4. KR5: a seat that ANSWERED never falls back ────────────────────────────────────
# `success` transport whose payload does not parse is a semantic/parser problem. Retrying it on a
# different pipe would be asking a different question because the first one was inconvenient.
NOFALL="$TEST_TMP/m-nofall.json"
write_manifest "$NOFALL" nofall-plan "$QUALIFIED_FALLBACK"
OUT="$(run_manifest nofall "$NOFALL" "$(sequence "$GARBAGE" success "$READY" success)")"; EXIT=$?
assert_not_contains "$(json_field "$OUT" attempts.1)" 'actual_transport' \
  "a parse failure over a healthy transport does not arm the fallback"

# ── 5. an UNQUALIFIED fallback is never used ─────────────────────────────────────────
# The pair (runner, model) must be qualified for the seat's role. A frozen manifest that records
# `unqualified` is a manifest that says "do not route here", and a transport failure is not an
# override for that.
UNQUAL="$TEST_TMP/m-unqual.json"
write_manifest "$UNQUAL" unqual-plan '{"runner":"cursor","model":"cursor-grok-4.6-xhigh","endpoint":"default","qualification_status":"unqualified"}'
OUT="$(run_manifest unqual "$UNQUAL" "$(sequence "$EMPTY" timeout "$READY" success)")"; EXIT=$?
assert_not_contains "$(json_field "$OUT" attempts.1)" 'actual_transport' \
  "an unqualified transport fallback is never dispatched to"

# ── 6. both transports exhausted → exactly today's terminal state, no new one ────────
BOTH="$TEST_TMP/m-both.json"
write_manifest "$BOTH" both-plan "$QUALIFIED_FALLBACK"
OUT="$(run_manifest both "$BOTH" "$(sequence "$EMPTY" timeout "$EMPTY" unavailable)")"; EXIT=$?
assert_exit_code "$EXIT" "4" "both transports failing still exits 4"
assert_eq "$(json_field "$OUT" transport_status)" "transport_exhausted" \
  "the terminal state is the pre-existing transport_exhausted, not a new one"
assert_eq "$(json_field "$OUT" semantic_verdict)" "null" \
  "an exhausted fallback never fabricates a semantic verdict"

# ── 7. KR3: a fallback costs an ATTEMPT, never a semantic generation ─────────────────
# The round that used its fallback is still generation 1, and the generation counter is untouched.
GEN="$TEST_TMP/m-gen.json"
write_manifest "$GEN" gen-plan "$QUALIFIED_FALLBACK"
OUT="$(run_manifest gencount "$GEN" "$(sequence "$EMPTY" timeout "$READY" success)")"; EXIT=$?
assert_exit_code "$EXIT" "0" "the fallback round completes"
assert_eq "$(json_field "$OUT" generation)" "1" "a transport retry does not advance the generation"
assert_eq "$(json_field "$OUT" attempts.1.attempt)" "2" "it is recorded as the seat's second ATTEMPT"
assert_eq "$(node -e 'const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.attempts.length))' "$OUT")" "2" \
  "the seat used exactly two attempts, the frozen per-seat cap"

# ── 8. one authorized transport, one retry — never a third pipe ──────────────────────
# The fallback arms once. A second transport failure must not re-arm it (there is no third
# transport to reach for, and the attempt cap is frozen at 2 anyway) — this pins that the arming
# is guarded by `!transportRetry` rather than re-evaluated on every attempt.
ONCE="$TEST_TMP/m-once.json"
write_manifest "$ONCE" once-plan "$QUALIFIED_FALLBACK"
OUT="$(run_manifest once "$ONCE" "$(sequence "$EMPTY" timeout "$EMPTY" timeout)")"; EXIT=$?
assert_exit_code "$EXIT" "4" "a second transport failure exhausts the seat"
assert_eq "$(json_field "$OUT" attempts.1.actual_transport.runner)" "cursor" \
  "attempt 2 still went down the authorized second transport"

finalize_test
