#!/usr/bin/env bash
# resolve-review-loop-consult-discuss-switch.test.sh — D6 acceptance surface
# (docs/plans/2026-08-28-consult-discuss-qualification.md § D6). Covers the
# eight D6 assertions (1-4b, 5-7) plus concrete mirror parity. Assertion 6
# ("behavioral parity through the real wrapper entry points") drives
# scripts/dispatch-consult.sh (D8) and scripts/dispatch-discuss.js (D9)
# directly against a fail-hard shadow dispatch-author.sh, now that both Wave-2
# wrappers exist.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
JS_MODULE="$REPO_ROOT/src/engine/resolve-review-loop.js"
SHIPPED_TEMPLATE="$REPO_ROOT/project-config-template/review-loop-config.md"
export REPO_ROOT

# Hermetic, SHARED ambient state for every resolve in this file (default-off
# parity must not depend on the host machine's real ~/.autopilot state, or on
# ordering/caching side effects between the OLD and NEW resolve calls below).
unset REVIEW_LOOP_CONFIG_OVERRIDE
CAP_DIR="$TEST_TMP/engine-capability-shared"
SCORECARD_DIR="$TEST_TMP/engine-scorecard-shared"
mkdir -p "$CAP_DIR" "$SCORECARD_DIR"
export ENGINE_CAPABILITY_DIR="$CAP_DIR"
export ENGINE_SCORECARD_DIR="$SCORECARD_DIR"
unset ENGINE_CAPABILITY_FILE

json_get() { # json key -> raw json value
  local json="$1" key="$2"
  export JSON_VALUE="$json"
  node - "$key" <<'NODE'
const payload = process.env.JSON_VALUE || '';
const key = process.argv[2];
if (!payload) process.exit(0);
const parsed = JSON.parse(payload);
const value = parsed && parsed[key];
if (value === undefined) process.exit(0);
process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
NODE
  unset JSON_VALUE
}

# ── fixture: PRE-D6 resolver + shipped template, from a PINNED commit ──────
# resolve-review-loop.sh shells out to sibling scripts by $SCRIPT_DIR-relative
# path (e.g. engine-capability-state.js for brain_seat status) — copying ONLY
# the lib/ files it directly sources would leave those siblings missing,
# making brain_seat/capability_warnings resolve through the "probe
# unavailable" fallback instead of the real probe and manufacturing a fake
# parity failure that has nothing to do with D6. Copy the WHOLE scripts/ tree
# (confirmed unchanged vs the pre-D6 baseline except resolve-review-loop.sh
# itself — git status shows no other script file modified) so every sibling
# is present and identical to what the NEW resolver uses, then overwrite just
# resolve-review-loop.sh with the genuine pre-D6 content. This isolates the
# comparison to exactly the one file D6 changed.
#
# The pre-D6 baseline is NOT re-derived from `origin/develop` on every run —
# that ref is moving: once this branch merges, origin/develop itself carries
# D6, and a post-merge re-run of this test would diff the new resolver
# against itself, silently testing nothing (cross-family review finding,
# 2026-08-28). It is also not fetch-guaranteed in a shallow checkout, and the
# prior `git show ... 2>/dev/null` swallowed any such failure, letting an
# empty "old" file diff falsely clean or falsely fail. Instead, the baseline
# is a pair of golden fixture files checked in alongside this test, generated
# ONCE from the actual pre-D6 commit and frozen permanently:
#   git show 308529c15dadb9689689adf3db366a81a048ffaa:scripts/resolve-review-loop.sh \
#     > hooks/tests/fixtures/pre-consult-discuss-resolve-review-loop.sh
#   git show 308529c15dadb9689689adf3db366a81a048ffaa:project-config-template/review-loop-config.md \
#     > hooks/tests/fixtures/pre-consult-discuss-review-loop-config.md
# 308529c15dadb9689689adf3db366a81a048ffaa is this branch's parent commit
# immediately before D6 landed (95bf81bf~1), which at authorship time also
# equals `git merge-base origin/develop HEAD` — i.e. the frozen fork point,
# not a moving branch tip.
OLD_FIXTURE_SCRIPT="$REPO_ROOT/hooks/tests/fixtures/pre-consult-discuss-resolve-review-loop.sh"
OLD_FIXTURE_TEMPLATE="$REPO_ROOT/hooks/tests/fixtures/pre-consult-discuss-review-loop-config.md"
if [ ! -s "$OLD_FIXTURE_SCRIPT" ]; then
  echo "FATAL: pinned pre-D6 baseline fixture missing or empty: $OLD_FIXTURE_SCRIPT" >&2
  exit 1
fi
if [ ! -s "$OLD_FIXTURE_TEMPLATE" ]; then
  echo "FATAL: pinned pre-D6 baseline fixture missing or empty: $OLD_FIXTURE_TEMPLATE" >&2
  exit 1
fi

OLD_ROOT="$TEST_TMP/pre-d6-baseline"
mkdir -p "$OLD_ROOT"
cp -R "$REPO_ROOT/scripts" "$OLD_ROOT/scripts"
cp -R "$REPO_ROOT/src" "$OLD_ROOT/src"
cp "$OLD_FIXTURE_SCRIPT" "$OLD_ROOT/scripts/resolve-review-loop.sh"
chmod +x "$OLD_ROOT/scripts/resolve-review-loop.sh"
cp "$OLD_FIXTURE_TEMPLATE" "$OLD_ROOT/old-template.md"
OLD_SCRIPT="$OLD_ROOT/scripts/resolve-review-loop.sh"
OLD_TEMPLATE="$OLD_ROOT/old-template.md"

assert_file_exists "$OLD_SCRIPT" "pinned pre-D6 resolve-review-loop.sh staged for parity baseline"
assert_file_exists "$OLD_TEMPLATE" "pinned pre-D6 shipped template staged for parity baseline"

OLD_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$OLD_TEMPLATE" bash "$OLD_SCRIPT" 2>/dev/null)"; OLD_EXIT=$?
NEW_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" bash "$SCRIPT" 2>/dev/null)"; NEW_EXIT=$?
assert_eq "0" "$OLD_EXIT" "pinned pre-D6 resolver exits 0 on the old shipped template"
assert_eq "0" "$NEW_EXIT" "this branch's resolver exits 0 on the shipped template"

# For the byte-for-byte KEY/VALUE parity comparison (1-3), resolve the OLD
# (pinned pre-D6) resolver against the SAME physical config file as the NEW
# resolver — the current branch's shipped template. The old resolver has no
# case arm for consult_dispatch/discuss_dispatch, so it silently ignores those
# two extra lines exactly as it would for any field it doesn't know about;
# using the same file eliminates an incidental config_path difference that
# would otherwise be an artifact of comparing two different physical files,
# not a real behavioral difference. OLD_JSON (resolved against OLD_TEMPLATE,
# the genuine pre-widening file) is kept for the migration-negative (§5) below.
OLD_JSON_PARITY="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" bash "$OLD_SCRIPT" 2>/dev/null)"
export OLD_JSON OLD_JSON_PARITY NEW_JSON
PARITY_OUT="$(node <<'NODE'
const oldJson = JSON.parse(process.env.OLD_JSON_PARITY);
const newJson = JSON.parse(process.env.NEW_JSON);
const problems = [];

// (2) every key present in the OLD output is present in the NEW output with a
// byte-identical value.
for (const [key, oldVal] of Object.entries(oldJson)) {
  if (!(key in newJson)) { problems.push(`missing-in-new:${key}`); continue; }
  const newVal = newJson[key];
  if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
    problems.push(`value-drift:${key}`);
  }
}

// (3) the only added keys are exactly consult_dispatch and discuss_dispatch,
// both "off".
const oldKeys = new Set(Object.keys(oldJson));
const addedKeys = Object.keys(newJson).filter((k) => !oldKeys.has(k)).sort();
const expectedAdded = ['consult_dispatch', 'discuss_dispatch'];
if (JSON.stringify(addedKeys) !== JSON.stringify(expectedAdded)) {
  problems.push(`unexpected-added-keys:${addedKeys.join(',')}`);
}
if (newJson.consult_dispatch !== 'off') problems.push('consult_dispatch-not-off');
if (newJson.discuss_dispatch !== 'off') problems.push('discuss_dispatch-not-off');

console.log(problems.length === 0 ? 'parity-ok' : problems.join('\n'));
NODE
)"
assert_eq "parity-ok" "$PARITY_OUT" "default-off parity: pre-existing keys byte-identical, only consult_dispatch/discuss_dispatch added (both off)"

# ── 4. Per-fixture parity across Population A ───────────────────────────────
# Population A — complete roster objects passed to validateReviewLoopConfig
# (fail-closed JS validator). The extractor is two real greps, re-run here so a
# newly added roster object fails loudly instead of silently widening the
# population. Pinned inventory (verified against the live repo at D6
# authorship, 2026-08-28):
#   direct validateReviewLoopConfig callers:
#     hooks/tests/contract-parity.test.sh, hooks/tests/autopilot-engine.test.sh
#   complete JSON roster literals (git grep -l '"reviewer_engine"' -- hooks/ evals/):
#     hooks/tests/autopilot-cli.test.sh, hooks/tests/resolve-review-loop.test.sh,
#     hooks/tests/review-loop-runner.test.sh,
#     evals/clean/11-review-loop-tier-fields.diff (+ .expected.json + codex mirrors)
#
# RECOUNTED 2026-08-28 (round-2 cross-family review, tuple-integrity fix):
# round-1 (54270a1f) added hooks/tests/fixtures/pre-consult-discuss-resolve-review-loop.sh,
# a frozen pre-D6 baseline copy of resolve-review-loop.sh whose printf'd JSON
# construction literally contains the string "reviewer_engine" — it also
# matches this grep, same false-positive class as the evals diff above (a
# frozen historical/pinned copy, never itself fed through
# validateReviewLoopConfig as a live literal). Raw bound moves 6 -> 7.
#
# RECOUNTED AGAIN 2026-08-28 (D7 landing, Wave 2): D7's own gate test added
# hooks/tests/fixtures/pre-d7-resolve-review-loop.sh, the SAME frozen-baseline
# class as the pre-D6 fixture above (a pinned pre-D7 copy of
# resolve-review-loop.sh whose printf'd JSON construction literally contains
# "reviewer_engine" — never fed through validateReviewLoopConfig as a live
# literal). Raw bound moves 7 -> 8.
#
# NOTE ON evals/clean/11-review-loop-tier-fields.diff: this file is a FROZEN
# git-diff snapshot of a 2026 v2.32.23 commit (schema state that predates even
# consult_engine/discuss_engine), consumed ONLY by scripts/calibration.sh's
# clean-corpus stub-pattern scan (completeness-scan.sh) — never parsed as a
# live roster object, never fed through validateReviewLoopConfig. The raw grep
# still matches it (its text contains the literal string "reviewer_engine"
# inside an old schema hunk), exactly the false-positive class the plan itself
# names for Population B's blanket grep. Verified: `grep -rln
# '11-review-loop-tier-fields' hooks/ scripts/ evals/` names only
# scripts/calibration.sh (clean-set runner) plus its own result artifacts —
# no consumer runs it through the schema validator. Editing its diff hunks to
# inject unrelated fields would corrupt a historical diff for no functional
# gain, so it is EXCLUDED from the per-object parity/migration-negative subset
# below while still being counted in the raw pinned bound.
# Excluded from every population grep below: this test file itself. Its own
# fixture strings/comments legitimately contain "reviewer_engine:",
# "consult_dispatch:" etc., and once committed a naive git-grep would count
# itself as a 27th population member, permanently breaking the pinned counts.
SELF="hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh"
POP_A_RAW_COUNT="$(
  { git -C "$REPO_ROOT" grep -l "validateReviewLoopConfig" -- hooks/ ":!$SELF" 2>/dev/null;
    git -C "$REPO_ROOT" grep -l '"reviewer_engine"' -- hooks/ evals/ ":!$SELF" 2>/dev/null; } \
    | sort -u | wc -l | tr -d '[:space:]'
)"
assert_eq "8" "$POP_A_RAW_COUNT" "Population A raw extractor union is pinned at 8 files (direct callers + JSON-literal grep, incl. the frozen pre-D6 and pre-D7 resolver fixtures)"

# Per-object parity subset: files whose roster literal is genuinely fed through
# validateReviewLoopConfig, either directly (JS payload) or via the live
# resolver/CLI (which always carries current fields). For the three
# hand-maintained JS-literal fixtures, parity means the literal itself was
# widened with the two new keys (both "off") — checked structurally here;
# hooks/tests/autopilot-engine.test.sh additionally re-asserts this at runtime
# via its own fixture_field_drift guard (REVIEW_LOOP_FIELDS vs literal keys).
assert_contains "$(cat "$REPO_ROOT/hooks/tests/autopilot-engine.test.sh")" \
  $'  consult_dispatch: \'off\',\n  discuss_dispatch: \'off\',' \
  "autopilot-engine.test.sh validPayload literal carries consult_dispatch/discuss_dispatch: off"
assert_contains "$(cat "$REPO_ROOT/hooks/tests/review-loop-runner.test.sh")" \
  $'  consult_dispatch: \'off\',\n  discuss_dispatch: \'off\',' \
  "review-loop-runner.test.sh payload literal carries consult_dispatch/discuss_dispatch: off"
assert_contains "$(cat "$REPO_ROOT/hooks/tests/resolve-review-loop.test.sh")" \
  '"discuss_endpoint":"consult_dispatch":"discuss_dispatch":"allow_same_runner_dual_seat"' \
  "resolve-review-loop.test.sh EXPECTED_KEYS pins consult_dispatch/discuss_dispatch in schema order"

# contract-parity.test.sh and autopilot-cli.test.sh build their roster object
# by calling the LIVE resolver/CLI (never a static literal), so they inherit
# parity by construction; assert the real call-site wiring directly (per
# review-log repair [2]: "D6 fixture enumeration + real call-site smoke").
CLI_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" node "$REPO_ROOT/bin/autopilot.js" engine review-loop 2>&1)"; CLI_EXIT=$?
assert_eq "0" "$CLI_EXIT" "engine review-loop CLI (autopilot-cli.test.sh's real call site) exits 0 on the shipped template"
assert_contains "$CLI_OUT" '"consult_dispatch": "off"' "engine review-loop CLI surfaces consult_dispatch: off"
assert_contains "$CLI_OUT" '"discuss_dispatch": "off"' "engine review-loop CLI surfaces discuss_dispatch: off"
CONTRACT_PARITY_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" bash "$SCRIPT")"
export CONTRACT_PARITY_JSON
CONTRACT_PARITY_OUT="$(node -e '
const path = require("path");
const { validateReviewLoopConfig } = require(path.join(process.env.REPO_ROOT, "src", "engine", "resolve-review-loop.js"));
try {
  validateReviewLoopConfig(JSON.parse(process.env.CONTRACT_PARITY_JSON));
  console.log("validated-ok");
} catch (e) {
  console.log("validate-failed:" + e.message);
}
')"
assert_eq "validated-ok" "$CONTRACT_PARITY_OUT" "contract-parity.test.sh's real validateReviewLoopConfig call site accepts the widened live output"

# ── Population B — shell-resolved partial roster configs (default-off only) ─
# RECOUNTED 2026-08-28 (round-2, tuple-integrity fix): round-1 (54270a1f) also
# added hooks/tests/fixtures/pre-consult-discuss-review-loop-config.md, a
# frozen pre-D6 shipped-template copy whose `- reviewer_engine: ...` line
# matches this same grep — same frozen-fixture false-positive class as above.
# Bound moves 26 -> 27.
POP_B_COUNT="$(git -C "$REPO_ROOT" grep -l 'reviewer_engine:' -- hooks/ ":!$SELF" 2>/dev/null | wc -l | tr -d '[:space:]')"
assert_eq "27" "$POP_B_COUNT" "Population B file bound is pinned at 27 (git grep -l 'reviewer_engine:' -- hooks/, incl. the round-1 frozen pre-D6 template fixture)"
# Markdown-list-style declaration only (`- consult_dispatch: on`) — NOT a bare
# substring match, which would also hit Population A's JS object-literal keys
# (`consult_dispatch: 'off',`, no leading dash) that legitimately reference the
# same field name for an unrelated reason (already covered above).
# EXCLUDED (Wave 2, D8/D9 landing): hooks/tests/dispatch-consult.test.sh and
# hooks/tests/dispatch-discuss.test.sh legitimately carry their own
# `- consult_dispatch: on` / `- discuss_dispatch: on` roster fixtures — those
# wrappers' OWN acceptance tests exercising the switch-on path, not a member
# of "Population B" (pre-existing, unrelated hooks/ roster configs that
# should all still resolve to the off default). Same false-positive class as
# SELF's own exclusion above.
DISPATCH_CONSULT_TEST="hooks/tests/dispatch-consult.test.sh"
DISPATCH_DISCUSS_TEST="hooks/tests/dispatch-discuss.test.sh"
POP_B_EXPLICIT_SWITCH="$(git -C "$REPO_ROOT" grep -lE '^\s*-\s*(consult|discuss)_dispatch\s*:' -- hooks/ ":!$SELF" ":!$DISPATCH_CONSULT_TEST" ":!$DISPATCH_DISCUSS_TEST" 2>/dev/null | wc -l | tr -d '[:space:]')"
assert_eq "0" "$POP_B_EXPLICIT_SWITCH" "none of Population B's 26 partial roster configs set consult_dispatch/discuss_dispatch explicitly — they all resolve via the off default"

# ── 4b. Schema three-way equality ───────────────────────────────────────────
SCHEMA_3WAY_OUT="$(node <<'NODE'
const path = require('path');
const schema = require(path.join(process.env.REPO_ROOT, 'schemas', 'review-loop-contract.schema.json'));
const propertyKeys = new Set(Object.keys(schema.properties));
const fieldOrder = new Set(schema['x-field-order']);
const required = new Set(schema.required);
const ALWAYS_ON_EXCEPTIONS = new Set(['brain_seat']);
const problems = [];
for (const k of propertyKeys) if (!fieldOrder.has(k)) problems.push(`props-not-in-order:${k}`);
for (const k of fieldOrder) if (!propertyKeys.has(k)) problems.push(`order-not-in-props:${k}`);
for (const k of fieldOrder) {
  if (ALWAYS_ON_EXCEPTIONS.has(k)) continue;
  if (!required.has(k)) problems.push(`order-not-required:${k}`);
}
for (const k of required) {
  if (!fieldOrder.has(k) || ALWAYS_ON_EXCEPTIONS.has(k)) problems.push(`required-not-always-on:${k}`);
}
if (!propertyKeys.has('consult_dispatch') || !required.has('consult_dispatch')) problems.push('consult_dispatch-not-three-way');
if (!propertyKeys.has('discuss_dispatch') || !required.has('discuss_dispatch')) problems.push('discuss_dispatch-not-three-way');
console.log(problems.length === 0 ? 'three-way-ok' : problems.join('\n'));
NODE
)"
assert_eq "three-way-ok" "$SCHEMA_3WAY_OUT" "schema properties == x-field-order == required for the always-on field set, incl. consult_dispatch/discuss_dispatch"

CONTRACT_SCHEMA_OUT="$(node "$REPO_ROOT/scripts/check-contract-schema.js" 2>&1)"; CONTRACT_SCHEMA_EXIT=$?
assert_eq "0" "$CONTRACT_SCHEMA_EXIT" "check-contract-schema.js exits 0 on canonical schema/shell"
assert_contains "$CONTRACT_SCHEMA_OUT" "three-way equality" "check-contract-schema.js runs the three-way equality assertion"

# ── 5. Migration negative ───────────────────────────────────────────────────
# A pre-widening roster JSON (resolved by the pinned pre-D6 commit's OWN resolver against
# its own template — genuinely lacks consult_dispatch/discuss_dispatch) fed to
# the NEW src/engine/resolve-review-loop.js must fail loudly naming the
# missing field, never a silent pass, never a default-filled success.
export OLD_JSON
MIGRATION_OUT="$(node <<'NODE'
const path = require('path');
const { validateReviewLoopConfig } = require(path.join(process.env.REPO_ROOT, 'src', 'engine', 'resolve-review-loop.js'));
const oldJson = JSON.parse(process.env.OLD_JSON);
try {
  validateReviewLoopConfig(oldJson);
  console.log('SILENTLY-PASSED');
} catch (e) {
  console.log(e.message);
}
NODE
)"
assert_contains "$MIGRATION_OUT" "missing field: consult_dispatch" "pre-widening roster JSON fails loudly, naming the missing consult_dispatch field"
assert_not_contains "$MIGRATION_OUT" "SILENTLY-PASSED" "migration negative never silently passes"

# ── 6. Behavioral parity through the real wrapper entry points ─────────────
# scripts/dispatch-consult.sh (D8) and scripts/dispatch-discuss.js (D9) have
# now landed (Wave 2 of docs/plans/2026-08-28-consult-discuss-qualification.md).
# Both wrappers own switch resolution themselves (round-2 finding [6]), so
# there is a real entry point to drive here: invoke each directly, with the
# shipped (both-off) template, against a fail-hard shadow dispatch-author.sh
# that records an invocation marker and exits 99 if ever spawned. Both must
# exit non-zero BEFORE any transport spawn.
SHADOW_AUTHOR_MARKER="$TEST_TMP/step6-shadow-invoked"
SHADOW_AUTHOR_BIN="$TEST_TMP/step6-shadow-dispatch-author.sh"
cat > "$SHADOW_AUTHOR_BIN" <<EOF
#!/usr/bin/env bash
echo "SHADOW INVOKED" >> "$SHADOW_AUTHOR_MARKER"
exit 99
EOF
chmod +x "$SHADOW_AUTHOR_BIN"

STEP6_Q="$TEST_TMP/step6-question.txt"
printf 'a bounded question\n' > "$STEP6_Q"
STEP6_ARTIFACT="$TEST_TMP/step6-artifact.diff"
printf 'diff --git a/x b/x\n+line\n' > "$STEP6_ARTIFACT"
CONSULT_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" "$REPO_ROOT/scripts/dispatch-consult.sh" \
  --question-file "$STEP6_Q" --artifact "$STEP6_ARTIFACT" --dispatch-author-bin "$SHADOW_AUTHOR_BIN" 2>&1 >/dev/null)"
CONSULT_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" "$REPO_ROOT/scripts/dispatch-consult.sh" \
  --question-file "$STEP6_Q" --artifact "$STEP6_ARTIFACT" --dispatch-author-bin "$SHADOW_AUTHOR_BIN" >/dev/null 2>&1; echo $?)"
assert_neq "0" "$CONSULT_EXIT" "shipped-template (consult_dispatch off) dispatch-consult.sh exits non-zero"
assert_contains "$CONSULT_OUT" "consult_dispatch" "dispatch-consult.sh off-path message names consult_dispatch"
assert_file_absent "$SHADOW_AUTHOR_MARKER" "dispatch-consult.sh with the shipped template never spawns the shadow transport"

STEP6_BUNDLE="$TEST_TMP/step6-bundle.json"
cat > "$STEP6_BUNDLE" <<'JSON'
{"round_id":"r1","question":"a bounded question","transcript":[],
 "artifacts":[{"id":"a1","kind":"diff","text":"diff --git a/x b/x\n+line"}],
 "axes":[{"id":"ax1","claim_vector":["c1"]}],"taken_axes":[]}
JSON
DISCUSS_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" node "$REPO_ROOT/scripts/dispatch-discuss.js" \
  --bundle-file "$STEP6_BUNDLE" --dispatch-author-bin "$SHADOW_AUTHOR_BIN" 2>&1 >/dev/null)"
DISCUSS_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" node "$REPO_ROOT/scripts/dispatch-discuss.js" \
  --bundle-file "$STEP6_BUNDLE" --dispatch-author-bin "$SHADOW_AUTHOR_BIN" >/dev/null 2>&1; echo $?)"
assert_neq "0" "$DISCUSS_EXIT" "shipped-template (discuss_dispatch off) dispatch-discuss.js exits non-zero"
assert_contains "$DISCUSS_OUT" "discuss_dispatch" "dispatch-discuss.js off-path message names discuss_dispatch"
assert_file_absent "$SHADOW_AUTHOR_MARKER" "dispatch-discuss.js with the shipped template never spawns the shadow transport"

# ── 7. Exit codes unchanged across existing admission fixtures ─────────────
EXIT_TEMPLATE_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "0" "$EXIT_TEMPLATE_JSON" "shipped-template resolve exit code unchanged (0)"

BAD_ENUM_CFG="$TEST_TMP/bad-enum.md"
printf -- '- allow_same_runner_dual_seat: not-a-real-value\n' > "$BAD_ENUM_CFG"
REVIEW_LOOP_CONFIG_OVERRIDE="$BAD_ENUM_CFG" bash "$SCRIPT" >/dev/null 2>&1
assert_eq "3" "$?" "pre-existing invalid-enum admission fixture (allow_same_runner_dual_seat) still exits 3, unchanged"

DUAL_SEAT_CFG="$TEST_TMP/dual-seat.md"
printf -- '- implementer_runner: codex\n- allow_same_runner_dual_seat: off\n' > "$DUAL_SEAT_CFG"
REVIEW_LOOP_CONFIG_OVERRIDE="$DUAL_SEAT_CFG" bash "$SCRIPT" >/dev/null 2>&1
assert_eq "3" "$?" "pre-existing dual-seat admission fixture still exits 3, unchanged"

HELP_EXIT="$(bash "$SCRIPT" --help >/dev/null 2>&1; echo $?)"
assert_eq "0" "$HELP_EXIT" "--help exit code unchanged (0)"

BOGUS_EXIT="$(bash "$SCRIPT" --bogus x >/dev/null 2>&1; echo $?)"
assert_eq "2" "$BOGUS_EXIT" "unknown-flag exit code unchanged (2)"

# Explicit unknown value on the new switches is exit 3 (D6 design: fail-closed).
BAD_CONSULT_CFG="$TEST_TMP/bad-consult-dispatch.md"
printf -- '- consult_dispatch: maybe\n' > "$BAD_CONSULT_CFG"
REVIEW_LOOP_CONFIG_OVERRIDE="$BAD_CONSULT_CFG" bash "$SCRIPT" >/dev/null 2>&1
assert_eq "3" "$?" "explicit invalid consult_dispatch value exits 3"
BAD_DISCUSS_CFG="$TEST_TMP/bad-discuss-dispatch.md"
printf -- '- discuss_dispatch: maybe\n' > "$BAD_DISCUSS_CFG"
REVIEW_LOOP_CONFIG_OVERRIDE="$BAD_DISCUSS_CFG" bash "$SCRIPT" >/dev/null 2>&1
assert_eq "3" "$?" "explicit invalid discuss_dispatch value exits 3"

# ── Mirror parity, made concrete ────────────────────────────────────────────
CODEX_SCHEMA="$REPO_ROOT/platforms/codex/plugin/schemas/review-loop-contract.schema.json"
CODEX_SHELL="$REPO_ROOT/platforms/codex/plugin/scripts/resolve-review-loop.sh"
CODEX_TEMPLATE="$REPO_ROOT/platforms/codex/plugin/project-config-template/review-loop-config.md"
assert_file_exists "$CODEX_SCHEMA" "codex mirror schema exists"
assert_file_exists "$CODEX_SHELL" "codex mirror resolver exists"

MIRROR_SCHEMA_OUT="$(node <<'NODE'
const path = require('path');
const canonical = require(path.join(process.env.REPO_ROOT, 'schemas', 'review-loop-contract.schema.json'));
const mirror = require(path.join(process.env.REPO_ROOT, 'platforms', 'codex', 'plugin', 'schemas', 'review-loop-contract.schema.json'));
const problems = [];
for (const field of ['consult_dispatch', 'discuss_dispatch']) {
  const cProp = canonical.properties[field];
  const mProp = mirror.properties[field];
  if (!mProp) { problems.push(`missing-in-mirror:${field}`); continue; }
  if (JSON.stringify([...cProp.enum].sort()) !== JSON.stringify([...(mProp.enum || [])].sort())) {
    problems.push(`enum-drift:${field}`);
  }
  if (canonical['x-field-order'].indexOf(field) !== mirror['x-field-order'].indexOf(field)) {
    problems.push(`field-order-position-drift:${field}`);
  }
  if (canonical.required.indexOf(field) !== mirror.required.indexOf(field)) {
    problems.push(`required-position-drift:${field}`);
  }
}
console.log(problems.length === 0 ? 'mirror-schema-ok' : problems.join('\n'));
NODE
)"
assert_eq "mirror-schema-ok" "$MIRROR_SCHEMA_OUT" "codex mirror schema carries both fields with identical enum, x-field-order position, and required position"

CODEX_MIRROR_3WAY_OUT="$(node "$REPO_ROOT/platforms/codex/plugin/scripts/check-contract-schema.js" 2>&1)"; CODEX_MIRROR_3WAY_EXIT=$?
assert_eq "0" "$CODEX_MIRROR_3WAY_EXIT" "codex mirror check-contract-schema.js exits 0 (same three-way equality check, run against the mirror)"

CODEX_SHELL_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_TEMPLATE" bash "$CODEX_SHELL" 2>/dev/null)"; CODEX_SHELL_EXIT=$?
assert_eq "0" "$CODEX_SHELL_EXIT" "codex mirror resolver exits 0 on its own shipped template"
assert_eq "off" "$(json_get "$CODEX_SHELL_JSON" consult_dispatch)" "codex mirror resolver emits consult_dispatch: off on the shipped template"
assert_eq "off" "$(json_get "$CODEX_SHELL_JSON" discuss_dispatch)" "codex mirror resolver emits discuss_dispatch: off on the shipped template"

# ── 8. Switch-on requires a non-empty seat tuple (tuple integrity, not D7 ───
# qualification) — cross-family review finding, round 2, 2026-08-28: both
# switches previously accepted `on` with a wholly-empty seat tuple, silently
# no-op'ing an enabled rail. Plan §4 D6: "On + an empty seat tuple ⇒ exit 3".
ON_EMPTY_CONSULT_CFG="$TEST_TMP/on-empty-consult.md"
printf -- '- consult_dispatch: on\n' > "$ON_EMPTY_CONSULT_CFG"
ON_EMPTY_CONSULT_ERR="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_EMPTY_CONSULT_CFG" bash "$SCRIPT" 2>&1 >/dev/null)"
ON_EMPTY_CONSULT_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_EMPTY_CONSULT_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$ON_EMPTY_CONSULT_EXIT" "consult_dispatch=on with a wholly-empty consult seat tuple exits 3"
assert_contains "$ON_EMPTY_CONSULT_ERR" "consult_dispatch=on requires consult_engine, consult_runner, and consult_effort" \
  "consult_dispatch=on + empty tuple error names the switch and the missing seat fields"

ON_EMPTY_DISCUSS_CFG="$TEST_TMP/on-empty-discuss.md"
printf -- '- discuss_dispatch: on\n' > "$ON_EMPTY_DISCUSS_CFG"
ON_EMPTY_DISCUSS_ERR="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_EMPTY_DISCUSS_CFG" bash "$SCRIPT" 2>&1 >/dev/null)"
ON_EMPTY_DISCUSS_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_EMPTY_DISCUSS_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$ON_EMPTY_DISCUSS_EXIT" "discuss_dispatch=on with a wholly-empty discuss seat tuple exits 3"
assert_contains "$ON_EMPTY_DISCUSS_ERR" "discuss_dispatch=on requires discuss_engine, discuss_runner, and discuss_effort" \
  "discuss_dispatch=on + empty tuple error names the switch and the missing seat fields"

# Partial tuple (engine set, runner/effort still empty) + switch on must also
# exit 3 — caught earlier by the pre-existing wholly-empty-or-full tuple
# self-consistency check (line ~437-455), which fires before the new
# switch-on check is ever reached for a partial (as opposed to wholly-empty)
# tuple. Different message, same fail-closed outcome — not just the
# wholly-empty case silently passing.
ON_PARTIAL_CONSULT_CFG="$TEST_TMP/on-partial-consult.md"
printf -- '- consult_engine: gpt-5.6\n- consult_dispatch: on\n' > "$ON_PARTIAL_CONSULT_CFG"
ON_PARTIAL_CONSULT_ERR="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_PARTIAL_CONSULT_CFG" bash "$SCRIPT" 2>&1 >/dev/null)"
ON_PARTIAL_CONSULT_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_PARTIAL_CONSULT_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$ON_PARTIAL_CONSULT_EXIT" "consult_dispatch=on with only consult_engine set (runner/effort empty) exits 3"
assert_contains "$ON_PARTIAL_CONSULT_ERR" "consult tuple must be wholly empty or include engine, runner, and effort" \
  "consult_dispatch=on + partial tuple error names the consult tuple integrity requirement"

# ── 9. Switch-on with a fully-populated seat tuple resolves fine at the ────
# tuple-integrity layer (D7's role-qualification gate — role evidence or a
# matching operator override — now DOES exist and DOES run for this seat;
# an unexpired override isolates the tuple-integrity assertion from D7's own
# admission matrix, which hooks/tests/resolve-review-loop-consult-discuss-
# gate.test.sh covers case-by-case).
ON_FULL_OVR="$TEST_TMP/on-full-override.json"
cat > "$ON_FULL_OVR" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"gpt-5.6","runner":"codex","role":"consult","reason":"tuple-integrity fixture","operator":"cookys","expires":"2099-01-01"},
  {"engine":"gpt-5.6","runner":"codex","role":"discuss","reason":"tuple-integrity fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON

ON_FULL_CONSULT_CFG="$TEST_TMP/on-full-consult.md"
printf -- '- consult_engine: gpt-5.6\n- consult_runner: codex\n- consult_effort: high\n- consult_dispatch: on\n' > "$ON_FULL_CONSULT_CFG"
ON_FULL_CONSULT_JSON="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$ON_FULL_OVR" REVIEW_LOOP_CONFIG_OVERRIDE="$ON_FULL_CONSULT_CFG" bash "$SCRIPT" 2>/dev/null)"; ON_FULL_CONSULT_EXIT=$?
assert_eq "0" "$ON_FULL_CONSULT_EXIT" "consult_dispatch=on with a fully-populated consult seat tuple + override does not exit 3 at the tuple-integrity layer"
assert_eq "on" "$(json_get "$ON_FULL_CONSULT_JSON" consult_dispatch)" "fully-populated consult_dispatch=on resolves with consult_dispatch: on in the output"

ON_FULL_DISCUSS_CFG="$TEST_TMP/on-full-discuss.md"
printf -- '- discuss_engine: gpt-5.6\n- discuss_runner: codex\n- discuss_effort: high\n- discuss_dispatch: on\n' > "$ON_FULL_DISCUSS_CFG"
ON_FULL_DISCUSS_JSON="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$ON_FULL_OVR" REVIEW_LOOP_CONFIG_OVERRIDE="$ON_FULL_DISCUSS_CFG" bash "$SCRIPT" 2>/dev/null)"; ON_FULL_DISCUSS_EXIT=$?
assert_eq "0" "$ON_FULL_DISCUSS_EXIT" "discuss_dispatch=on with a fully-populated discuss seat tuple + override does not exit 3 at the tuple-integrity layer"
assert_eq "on" "$(json_get "$ON_FULL_DISCUSS_JSON" discuss_dispatch)" "fully-populated discuss_dispatch=on resolves with discuss_dispatch: on in the output"

# Without the override (and without a qualification row), the SAME
# fully-populated tuple now correctly exits 3 — the D7 vacuum this plan
# closes (plan §0a): switch on + no evidence + no override refuses for
# EVERY runner, not only the declarative UNQUALIFIED_RUNNERS list.
ON_FULL_CONSULT_NOEVIDENCE_EXIT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ON_FULL_CONSULT_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$ON_FULL_CONSULT_NOEVIDENCE_EXIT" "consult_dispatch=on with a fully-populated tuple but NO evidence and NO override exits 3 (D7's vacuum-closing gate)"

# ── 10. JS validator mirrors the same switch-on ⇒ tuple check ──────────────
export ON_FULL_CONSULT_JSON
JS_ON_EMPTY_OUT="$(node <<'NODE'
const path = require('path');
const { validateReviewLoopConfig } = require(path.join(process.env.REPO_ROOT, 'src', 'engine', 'resolve-review-loop.js'));
const base = JSON.parse(process.env.ON_FULL_CONSULT_JSON);
base.consult_dispatch = 'on';
base.consult_engine = '';
base.consult_runner = '';
base.consult_effort = '';
try {
  validateReviewLoopConfig(base);
  console.log('SILENTLY-PASSED');
} catch (e) {
  console.log(e.message);
}
NODE
)"
assert_contains "$JS_ON_EMPTY_OUT" "consult_dispatch=on" "JS validator rejects consult_dispatch=on with an emptied-out consult tuple, naming the switch"
assert_not_contains "$JS_ON_EMPTY_OUT" "SILENTLY-PASSED" "JS validator never silently accepts consult_dispatch=on with an empty tuple"

JS_ON_FULL_OUT="$(node <<'NODE'
const path = require('path');
const { validateReviewLoopConfig } = require(path.join(process.env.REPO_ROOT, 'src', 'engine', 'resolve-review-loop.js'));
const value = JSON.parse(process.env.ON_FULL_CONSULT_JSON);
try {
  validateReviewLoopConfig(value);
  console.log('validated-ok');
} catch (e) {
  console.log('validate-failed:' + e.message);
}
NODE
)"
assert_eq "validated-ok" "$JS_ON_FULL_OUT" "JS validator accepts the real fully-populated consult_dispatch=on resolver output"

finalize_test
