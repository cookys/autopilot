#!/usr/bin/env bash
# hooks/tests/qualification-defaults.test.sh — schemas/official-qualification-defaults.schema.json
# and scripts/build-qualification-defaults.js (the generator that derives
# references/official-qualification-defaults.json from a scorecard store + a
# selection recipe). Never touches ~/.autopilot: every build/check run below
# points --store at a fixture built under $TEST_TMP.
. "$(dirname "$0")/lib.sh"

BUILD="$REPO_ROOT/scripts/build-qualification-defaults.js"
SCHEMA="$REPO_ROOT/schemas/official-qualification-defaults.schema.json"
ARTIFACT="$REPO_ROOT/references/official-qualification-defaults.json"
VALIDATOR="$REPO_ROOT/scripts/validate-json-schema.js"

# --- isolation self-check (evidence-discipline §9): the store env vars this
# test's build/check calls rely on must actually point inside TEST_TMP, not at
# the real ~/.autopilot — a var that is set but never checked is
# indistinguishable from one nobody wired up.
case "$ENGINE_SCORECARD_DIR" in
  "$TEST_TMP"/*) : ;;
  *) fail "isolation: ENGINE_SCORECARD_DIR ($ENGINE_SCORECARD_DIR) is not inside TEST_TMP ($TEST_TMP)" ;;
esac
# ENGINE_CAPABILITY_DIR matters MORE here than the scorecard var: this file does
# a destructive, non-append fs.writeFileSync into
# $ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl when it builds its fixture
# capability store. Guarding only the var we read and not the one we overwrite
# is how ~/.autopilot/engine-capability/*.test-residue-quarantined-* got made.
case "$ENGINE_CAPABILITY_DIR" in
  "$TEST_TMP"/*) : ;;
  *) fail "isolation: ENGINE_CAPABILITY_DIR ($ENGINE_CAPABILITY_DIR) is not inside TEST_TMP ($TEST_TMP)" ;;
esac
# Byte-fingerprint the real user-local stores; re-checked at the end of the run.
REAL_SCORECARD="$HOME/.autopilot/engine-scorecard/scorecard.jsonl"
REAL_CAPABILITY="$HOME/.autopilot/engine-capability/qualification-evidence.jsonl"
fingerprint() { if [ -f "$1" ]; then wc -c <"$1" | tr -d " "; else echo absent; fi; }
REAL_SCORECARD_BEFORE=$(fingerprint "$REAL_SCORECARD")
REAL_CAPABILITY_BEFORE=$(fingerprint "$REAL_CAPABILITY")

# --- Fixture store -----------------------------------------------------------
# 4 real rows lifted verbatim out of the committed artifact's defaults[].row
# (implementer x2 incl. one FAILED, reviewer, verification_author), each given
# a synthetic sequential event_id — the generator strips `row.event_id` before
# shipping (it is the destination's to assign), so it must be re-added to turn
# a shipped row back into a scorecard row.
FIXTURE_STORE="$TEST_TMP/fixture-store"
mkdir -p "$FIXTURE_STORE"
# Every committed row carries evidence.source === 'internal_eval', which means
# the generator ALSO requires the qualifier-store ANCHOR wrapper to resolve in
# a capability store (readCapabilityEvidenceRows / the `capability_evidence`
# anchor check at build-qualification-defaults.js:260-273) — a scorecard row
# does not travel alone. lib.sh already redirects ENGINE_CAPABILITY_DIR into
# $TEST_TMP, so writing the matching wrapper rows there (keyed by each row's
# own evidence_store.event_id, untouched by the synthetic event_id below)
# satisfies that anchor check without touching the real ~/.autopilot store.
node - "$ARTIFACT" "$FIXTURE_STORE/scorecard.jsonl" "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl" <<'NODE'
const fs = require('fs');
const [, , artifactPath, scorecardOut, capabilityOut] = process.argv;
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const byOfficialEventId = (id) => artifact.defaults.find(
  (d) => d.evidence_pointers.official_event_id === id,
);
const officialEventIds = [143, 144, 141, 142];
const syntheticIds = [901, 902, 903, 904];
const scorecardRows = [];
const capabilityRows = [];
officialEventIds.forEach((officialEventId, index) => {
  const entry = byOfficialEventId(officialEventId);
  if (!entry) {
    throw new Error(`fixture setup: no default entry for official_event_id ${officialEventId}`);
  }
  // The artifact ships capability_score as a lossless decimal STRING (see §1);
  // a real scorecard store holds a NUMBER. Convert back exactly as
  // adopt-qualification-defaults.js does, so this fixture is a faithful store.
  scorecardRows.push({
    ...entry.row,
    capability_score: Number(entry.row.capability_score),
    event_id: syntheticIds[index],
  });
  if (entry.capability_evidence) capabilityRows.push(entry.capability_evidence);
});
fs.writeFileSync(scorecardOut, `${scorecardRows.map((row) => JSON.stringify(row)).join('\n')}\n`);
fs.writeFileSync(capabilityOut, `${capabilityRows.map((row) => JSON.stringify(row)).join('\n')}\n`);
NODE

FIXTURE_RECIPE="$TEST_TMP/fixture-recipe.json"
cat > "$FIXTURE_RECIPE" <<'JSON'
{
  "schema_version": 1,
  "artifact_type": "official_qualification_defaults_recipe",
  "recipe_version": "test-fixture-1",
  "entries": [
    { "event_id": 901, "role": "implementer", "evidence_bundle": "docs/plans/evidence/2026-08-22-implementer-qualification-suite/grok-qualify" },
    { "event_id": 902, "role": "implementer", "evidence_bundle": "docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify" },
    { "event_id": 903, "role": "reviewer", "evidence_bundle": "docs/plans/evidence/2026-08-17-roster-qualification/sol-codex-qualify" },
    { "event_id": 904, "role": "verification_author", "evidence_bundle": "docs/plans/evidence/2026-08-18-verification-author-suite/dogfood" }
  ]
}
JSON

# --- 1. the REAL committed bytes validate against the committed schema --------
# No sanitized copy, no substitution: this is the artifact as shipped.
#
# History (depth-0 panel F3): an earlier cut asserted that the validator exits 2
# (UNSUPPORTED_JSON_NUMBER) on the real artifact and called that green, while the
# build validated a COPY with fractional capability_score values replaced by 0.
# The gate therefore never saw the shipped bytes. validate-json-schema.js
# rejects EVERY non-integer numeric literal in its document preflight, before any
# schema keyword runs — that restriction is deliberate (lossless round-trip), so
# the artifact changed instead of the validator: capability_score now ships as a
# lossless decimal STRING and adoption converts it back with Number().
REAL_OUT=$(node "$VALIDATOR" --schema "$SCHEMA" --document "$ARTIFACT" 2>&1)
REAL_EXIT=$?
assert_exit_code "$REAL_EXIT" 0 "the REAL committed artifact bytes validate against the committed schema: $REAL_OUT"

# The property that keeps it that way: not one non-integer numeric literal
# anywhere in the shipped artifact. If a future field reintroduces one, this
# goes red here rather than silently re-hollowing the gate.
NONINT=$(node -e '
  const fs = require("fs");
  const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bad = [];
  (function walk(v, p) {
    if (typeof v === "number") { if (!Number.isSafeInteger(v)) bad.push(p + "=" + v); return; }
    if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], p + "/" + k);
  })(doc, "");
  process.stdout.write(String(bad.length) + (bad.length ? " " + bad.slice(0, 3).join(" ") : ""));
' "$ARTIFACT")
assert_eq "$NONINT" "0" "the shipped artifact contains no non-integer numeric literal"

# And the string form is lossless: every score round-trips through Number()
# back to cases_passed/cases_total exactly.
ROUNDTRIP=$(node -e '
  const fs = require("fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  let bad = 0;
  for (const e of a.defaults) {
    if (typeof e.capability_score !== "string") { bad += 1; continue; }
    if (String(Number(e.capability_score)) !== e.capability_score) bad += 1;
    if (e.row.capability_score !== e.capability_score) bad += 1;
  }
  process.stdout.write(String(bad));
' "$ARTIFACT")
assert_eq "$ROUNDTRIP" "0" "every capability_score is a lossless decimal string, mirrored in row"

# F1 (depth-0 panel): the dead digest field is gone and must not come back.
HAS_DIGEST=$(node -e '
  const fs = require("fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String("store_projection_sha256" in a));
' "$ARTIFACT")
assert_eq "$HAS_DIGEST" "false" "no store_projection_sha256 (written-and-never-read digest, ADR-0001)"

SANITIZED="$ARTIFACT"

# --- 2. schema teeth: planted negative on the disclosure contract ------------
# The whole point of `administration`'s required-list is the Board-fixed
# disclosure contract (build-qualification-defaults.js DISCLOSURE_FIELDS) —
# deleting one field must fail closed.
TOOTHLESS="$TEST_TMP/artifact-missing-field.json"
node - "$SANITIZED" "$TOOTHLESS" <<'NODE'
const fs = require('fs');
const [, , src, dst] = process.argv;
const doc = JSON.parse(fs.readFileSync(src, 'utf8'));
delete doc.defaults[0].administration.runner_version;
fs.writeFileSync(dst, JSON.stringify(doc, null, 2));
NODE
TOOTH_OUT=$(node "$VALIDATOR" --schema "$SCHEMA" --document "$TOOTHLESS" 2>&1)
TOOTH_EXIT=$?
assert_exit_code "$TOOTH_EXIT" 1 "deleting a required disclosure field must fail schema validation"
assert_contains "$TOOTH_OUT" "runner_version is required" "error must name the missing disclosure field"

# --- 3. determinism: same store + same recipe -> byte-identical artifact -----
node "$BUILD" build --store "$FIXTURE_STORE" --capability-store "$ENGINE_CAPABILITY_DIR" --recipe "$FIXTURE_RECIPE" \
  --out "$TEST_TMP/a.json" --repo-root "$REPO_ROOT" >/dev/null
BUILD_A_EXIT=$?
node "$BUILD" build --store "$FIXTURE_STORE" --capability-store "$ENGINE_CAPABILITY_DIR" --recipe "$FIXTURE_RECIPE" \
  --out "$TEST_TMP/b.json" --repo-root "$REPO_ROOT" >/dev/null
BUILD_B_EXIT=$?
assert_exit_code "$BUILD_A_EXIT" 0 "first fixture build must succeed"
assert_exit_code "$BUILD_B_EXIT" 0 "second fixture build must succeed"
if cmp -s "$TEST_TMP/a.json" "$TEST_TMP/b.json"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "determinism: two builds over the identical store+recipe produced different bytes"
fi

# --- 4. --check passes on a fresh build, fails after a hand-edit -------------
CHECK_OK_OUT=$(node "$BUILD" --check --store "$FIXTURE_STORE" --capability-store "$ENGINE_CAPABILITY_DIR" --recipe "$FIXTURE_RECIPE" \
  --artifact "$TEST_TMP/a.json" --repo-root "$REPO_ROOT" 2>&1)
CHECK_OK_EXIT=$?
assert_exit_code "$CHECK_OK_EXIT" 0 "--check must pass on a freshly built artifact: $CHECK_OK_OUT"

# Flip one byte (a digit inside store_projection_sha256) — still valid JSON,
# still wrong content — and re-check.
node - "$TEST_TMP/a.json" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const marker = '"seat_hash": "';
const start = text.indexOf(marker);
if (start === -1) throw new Error('marker not found');
const digitIndex = start + marker.length;
const digit = text[digitIndex];
const flipped = digit === '0' ? '1' : '0';
fs.writeFileSync(file, text.slice(0, digitIndex) + flipped + text.slice(digitIndex + 1));
NODE
CHECK_FAIL_OUT=$(node "$BUILD" --check --store "$FIXTURE_STORE" --capability-store "$ENGINE_CAPABILITY_DIR" --recipe "$FIXTURE_RECIPE" \
  --artifact "$TEST_TMP/a.json" --repo-root "$REPO_ROOT" 2>&1)
CHECK_FAIL_EXIT=$?
assert_exit_code "$CHECK_FAIL_EXIT" 1 "--check must fail after a hand-edit"
assert_contains "$CHECK_FAIL_OUT" "the artifact is DERIVED" "remedy message must warn against hand-editing"
assert_contains "$CHECK_FAIL_OUT" "do not hand-edit it" "remedy message must name the remedy"

# --- 5. recipe fail-closed: event id not in the store ------------------------
BAD_RECIPE="$TEST_TMP/recipe-unknown-event.json"
cat > "$BAD_RECIPE" <<'JSON'
{
  "schema_version": 1,
  "artifact_type": "official_qualification_defaults_recipe",
  "recipe_version": "test-fixture-unknown-event",
  "entries": [
    { "event_id": 999, "role": "implementer", "evidence_bundle": "docs/plans/evidence/2026-08-22-implementer-qualification-suite/grok-qualify" }
  ]
}
JSON
UNKNOWN_OUT=$(node "$BUILD" build --store "$FIXTURE_STORE" --capability-store "$ENGINE_CAPABILITY_DIR" --recipe "$BAD_RECIPE" \
  --out "$TEST_TMP/unused.json" --repo-root "$REPO_ROOT" 2>&1)
UNKNOWN_EXIT=$?
assert_exit_code "$UNKNOWN_EXIT" 1 "recipe naming an event id absent from the store must fail closed"
assert_contains "$UNKNOWN_OUT" "999" "error must name the missing event id"

# --- 6. evidence-bundle cross-check fail-closed -------------------------------
# Point event 901's entry (grok-4.5/grok/implementer, from grok-qualify) at a
# DIFFERENT real bundle (agy-flash-qualify, gemini-3.7-flash-high/agy) whose
# own emitted row disagrees on engine/runner/status — the recipe now points
# this row at the wrong bundle.
MISMATCH_RECIPE="$TEST_TMP/recipe-bundle-mismatch.json"
cat > "$MISMATCH_RECIPE" <<'JSON'
{
  "schema_version": 1,
  "artifact_type": "official_qualification_defaults_recipe",
  "recipe_version": "test-fixture-bundle-mismatch",
  "entries": [
    { "event_id": 901, "role": "implementer", "evidence_bundle": "docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify" }
  ]
}
JSON
MISMATCH_OUT=$(node "$BUILD" build --store "$FIXTURE_STORE" --capability-store "$ENGINE_CAPABILITY_DIR" --recipe "$MISMATCH_RECIPE" \
  --out "$TEST_TMP/unused2.json" --repo-root "$REPO_ROOT" 2>&1)
MISMATCH_EXIT=$?
assert_exit_code "$MISMATCH_EXIT" 1 "a recipe entry pointed at a disagreeing bundle must fail closed"
assert_contains "$MISMATCH_OUT" "evidence-bundle mismatch" "error must name the cross-check failure"
assert_contains "$MISMATCH_OUT" "engine" "error must name the disagreeing field (engine)"

# --- 6b. capability-store anchor fail-closed ----------------------------------
# Event 901's row carries internal_eval evidence anchored at capability-evidence
# event 92 (its evidence_store.event_id) — same store row, same recipe, but a
# capability store that does NOT hold that anchor wrapper. The generator must
# refuse to ship a default no consumer could record (build-qualification-defaults.js
# fails closed at the `capabilityRows.get(anchor.event_id)` check).
MISSING_CAP_DIR="$TEST_TMP/capability-store-missing-anchor"
mkdir -p "$MISSING_CAP_DIR"
: > "$MISSING_CAP_DIR/qualification-evidence.jsonl"
MISSING_ANCHOR_RECIPE="$TEST_TMP/recipe-single-901.json"
cat > "$MISSING_ANCHOR_RECIPE" <<'JSON'
{
  "schema_version": 1,
  "artifact_type": "official_qualification_defaults_recipe",
  "recipe_version": "test-fixture-missing-anchor",
  "entries": [
    { "event_id": 901, "role": "implementer", "evidence_bundle": "docs/plans/evidence/2026-08-22-implementer-qualification-suite/grok-qualify" }
  ]
}
JSON
MISSING_ANCHOR_OUT=$(node "$BUILD" build --store "$FIXTURE_STORE" --capability-store "$MISSING_CAP_DIR" --recipe "$MISSING_ANCHOR_RECIPE" \
  --out "$TEST_TMP/unused3.json" --repo-root "$REPO_ROOT" 2>&1)
MISSING_ANCHOR_EXIT=$?
assert_exit_code "$MISSING_ANCHOR_EXIT" 1 "a scorecard row whose capability-evidence anchor is absent from the capability store must fail closed"
assert_contains "$MISSING_ANCHOR_OUT" "capability-evidence event 92" "error must name the anchoring capability event id"

# --- 7. seat_hash parity — the load-bearing check -----------------------------
# For >=2 committed entries, the artifact's own seat_hash, an INDEPENDENTLY
# re-derived hash (inline node, no require() of the generator), and
# `engine-scorecard.js seat-status`'s own seat_hash (run against the fixture
# store, which holds each seat's row) must all three agree. This must go red
# if any of the three derivations drifts from the others.
PARITY_OUT=$(node - "$ARTIFACT" "$REPO_ROOT/scripts/engine-scorecard.js" "$FIXTURE_STORE" <<'NODE'
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const [, , artifactPath, scorecardScript, storeDir] = process.argv;
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

// Independent canonical-JSON + sha256, matching the two-line algorithm at
// engine-scorecard.js:1424 (seatIdentityHash) without requiring either that
// file or scripts/build-qualification-defaults.js.
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function seatHash(engine, runner, role) {
  const canonical = canon({ engine: String(engine), runner: String(runner), role: String(role) });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const checkOfficialEventIds = [143, 141]; // grok-4.5/grok/implementer, gpt-5.6-sol/codex-cli/reviewer
const results = [];
for (const officialEventId of checkOfficialEventIds) {
  const entry = artifact.defaults.find((d) => d.evidence_pointers.official_event_id === officialEventId);
  if (!entry) throw new Error(`no default entry for official_event_id ${officialEventId}`);
  const independent = seatHash(entry.seat.engine, entry.seat.runner, entry.seat.role);
  const cliOut = execFileSync(process.execPath, [
    scorecardScript, 'seat-status',
    '--engine', entry.seat.engine,
    '--runner', entry.seat.runner,
    '--role', entry.seat.role,
  ], {
    env: { ...process.env, ENGINE_SCORECARD_DIR: storeDir },
    encoding: 'utf8',
  });
  const cli = JSON.parse(cliOut).seat_hash;
  results.push({
    official_event_id: officialEventId,
    artifact_seat_hash: entry.seat_hash,
    independent_seat_hash: independent,
    cli_seat_hash: cli,
    agree: entry.seat_hash === independent && independent === cli,
  });
}
process.stdout.write(JSON.stringify(results));
NODE
)
PARITY_EXIT=$?
assert_exit_code "$PARITY_EXIT" 0 "seat_hash parity harness must run cleanly: $PARITY_OUT"
assert_contains "$PARITY_OUT" '"agree":true' "at least one seat must show three-way seat_hash agreement"
if echo "$PARITY_OUT" | node -e '
let s = "";
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  const rows = JSON.parse(s);
  process.exit(rows.length >= 2 && rows.every((r) => r.agree) ? 0 : 1);
});
'; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "seat_hash parity: not every checked seat agreed across artifact / independent derivation / engine-scorecard.js seat-status ($PARITY_OUT)"
fi

# --- the real user-local stores were never touched ---------------------------
assert_eq "$(fingerprint "$REAL_SCORECARD")" "$REAL_SCORECARD_BEFORE" \
  "isolation: the real scorecard store is byte-unchanged"
assert_eq "$(fingerprint "$REAL_CAPABILITY")" "$REAL_CAPABILITY_BEFORE" \
  "isolation: the real capability evidence store is byte-unchanged"

finalize_test
