#!/usr/bin/env bash
# resolve-review-loop-consult-discuss-switch.test.sh — D6 acceptance surface
# (docs/plans/2026-08-28-consult-discuss-qualification.md § D6). Covers the
# eight D6 assertions (1-4b, 5-7) plus concrete mirror parity. Assertion 6
# ("behavioral parity through the real wrapper entry points" —
# scripts/dispatch-consult.sh / dispatch-discuss.js) is EXPLICITLY DEFERRED:
# those two scripts are D8/D9, Wave 2, and do not exist in this Wave-1 worktree.
# See the DEFERRED-TO-WAVE-2 marker below.
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

# ── fixture: origin/develop's PRE-D6 resolver + shipped template ───────────
# resolve-review-loop.sh shells out to sibling scripts by $SCRIPT_DIR-relative
# path (e.g. engine-capability-state.js for brain_seat status) — copying ONLY
# the lib/ files it directly sources would leave those siblings missing,
# making brain_seat/capability_warnings resolve through the "probe
# unavailable" fallback instead of the real probe and manufacturing a fake
# parity failure that has nothing to do with D6. Copy the WHOLE scripts/ tree
# (confirmed unchanged vs origin/develop except resolve-review-loop.sh itself
# — git status shows no other script file modified) so every sibling is
# present and identical to what the NEW resolver uses, then overwrite just
# resolve-review-loop.sh with the genuine origin/develop content. This
# isolates the comparison to exactly the one file D6 changed.
OLD_ROOT="$TEST_TMP/origin-develop"
mkdir -p "$OLD_ROOT"
cp -R "$REPO_ROOT/scripts" "$OLD_ROOT/scripts"
cp -R "$REPO_ROOT/src" "$OLD_ROOT/src"
git -C "$REPO_ROOT" show origin/develop:scripts/resolve-review-loop.sh > "$OLD_ROOT/scripts/resolve-review-loop.sh" 2>/dev/null
chmod +x "$OLD_ROOT/scripts/resolve-review-loop.sh"
git -C "$REPO_ROOT" show origin/develop:project-config-template/review-loop-config.md > "$OLD_ROOT/old-template.md" 2>/dev/null
OLD_SCRIPT="$OLD_ROOT/scripts/resolve-review-loop.sh"
OLD_TEMPLATE="$OLD_ROOT/old-template.md"

assert_file_exists "$OLD_SCRIPT" "origin/develop resolve-review-loop.sh extracted for parity baseline"
assert_file_exists "$OLD_TEMPLATE" "origin/develop shipped template extracted for parity baseline"

OLD_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$OLD_TEMPLATE" bash "$OLD_SCRIPT" 2>/dev/null)"; OLD_EXIT=$?
NEW_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$SHIPPED_TEMPLATE" bash "$SCRIPT" 2>/dev/null)"; NEW_EXIT=$?
assert_eq "0" "$OLD_EXIT" "origin/develop resolver exits 0 on the old shipped template"
assert_eq "0" "$NEW_EXIT" "this branch's resolver exits 0 on the shipped template"

# For the byte-for-byte KEY/VALUE parity comparison (1-3), resolve the OLD
# (origin/develop) resolver against the SAME physical config file as the NEW
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
assert_eq "6" "$POP_A_RAW_COUNT" "Population A raw extractor union is pinned at 6 files (direct callers + JSON-literal grep)"

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
POP_B_COUNT="$(git -C "$REPO_ROOT" grep -l 'reviewer_engine:' -- hooks/ ":!$SELF" 2>/dev/null | wc -l | tr -d '[:space:]')"
assert_eq "26" "$POP_B_COUNT" "Population B file bound is pinned at 26 (git grep -l 'reviewer_engine:' -- hooks/)"
# Markdown-list-style declaration only (`- consult_dispatch: on`) — NOT a bare
# substring match, which would also hit Population A's JS object-literal keys
# (`consult_dispatch: 'off',`, no leading dash) that legitimately reference the
# same field name for an unrelated reason (already covered above).
POP_B_EXPLICIT_SWITCH="$(git -C "$REPO_ROOT" grep -lE '^\s*-\s*(consult|discuss)_dispatch\s*:' -- hooks/ ":!$SELF" 2>/dev/null | wc -l | tr -d '[:space:]')"
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
# A pre-widening roster JSON (resolved by origin/develop's OWN resolver against
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

# ── 6. DEFERRED-TO-WAVE-2 ───────────────────────────────────────────────────
# scripts/dispatch-consult.sh and scripts/dispatch-discuss.js are D8/D9 (Wave
# 2 of docs/plans/2026-08-28-consult-discuss-qualification.md) and do not
# exist in this Wave-1 worktree. D6 step 6 ("Behavioral parity through the
# real wrapper entry points" — invoke both wrappers directly with a
# PATH-shadowed dispatch-author.sh that exits 99 if spawned; both switches off
# => both wrappers exit non-zero with zero transport spawns) cannot be
# implemented for real without fabricating those scripts, which is explicitly
# out of scope here. This assertion is left UNCOVERED on purpose — do not
# stub dispatch-consult.sh / dispatch-discuss.js to fake it green.
assert_file_absent "$REPO_ROOT/scripts/dispatch-consult.sh" \
  "DEFERRED-TO-WAVE-2: dispatch-consult.sh does not exist yet (D8) — step-6 wrapper assertion not implemented here"
assert_file_absent "$REPO_ROOT/scripts/dispatch-discuss.js" \
  "DEFERRED-TO-WAVE-2: dispatch-discuss.js does not exist yet (D9) — step-6 wrapper assertion not implemented here"

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

finalize_test
