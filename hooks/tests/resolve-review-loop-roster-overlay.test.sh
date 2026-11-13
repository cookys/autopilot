#!/usr/bin/env bash
# Tests for the roster overlay in resolve-review-loop.sh (scripts/lib/roster-overlay.js):
# the template is the only roster, a repo file overlays it by whole group.
#   * a stub with no seat fields resolves to the roster, field by field
#   * one override group comes from the repo, every other group from the roster
#   * a legacy full copy (seat fields outside an override block) exits 3 and prints the fix
#   * an unreadable template exits 3
#   * negative control: with the outside-block check broken, the legacy copy is accepted
. "$(dirname "$0")/lib.sh"

unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR AUTOPILOT_QUALIFICATION_OVERRIDE
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
TEMPLATE="$REPO_ROOT/project-config-template/review-loop-config.md"

# jq-free field read from the resolver's JSON.
jget() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=d[process.argv[1]];process.stdout.write(typeof v==="string"?v:JSON.stringify(v));' "$1"; }

# 1. roster resolved straight from the template (no repo file in the way).
ROSTER_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "template alone resolves"

# 2. empty stub -> roster values, field by field.
STUB="$TEST_TMP/stub.md"
printf '# stub\n\n- loop_max_rounds: 5\n' > "$STUB"
STUB_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$STUB" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "stub with no seat fields resolves"
for k in reviewer_engine reviewer_effort reviewer_runner reviewer_endpoint \
         implementer_engine implementer_effort implementer_runner \
         verification_author_present verification_author_engine verification_author_runner verification_author_effort \
         qc_panel min_panel_size qc_panel_aggregation consult_engine discuss_engine; do
  assert_eq "$(printf '%s' "$ROSTER_JSON" | jget "$k")" "$(printf '%s' "$STUB_JSON" | jget "$k")" "stub follows the roster for $k"
done
assert_eq "Qwen3.8-27B-QUASAR-NVFP4" "$(printf '%s' "$STUB_JSON" | jget reviewer_engine)" "roster loop reviewer is the local qwen"
assert_eq "anthropic-compatible" "$(printf '%s' "$STUB_JSON" | jget reviewer_runner)" "roster loop reviewer runner is anthropic-compatible"
assert_eq "default" "$(printf '%s' "$STUB_JSON" | jget reviewer_effort)" "roster loop reviewer effort is default"
assert_eq "qwen_local" "$(printf '%s' "$STUB_JSON" | jget reviewer_endpoint)" "roster loop reviewer endpoint is qwen_local"
assert_eq '["gemini-4-hydrogen-high","GLM-5.3","claude-opus-5-5-medium"]' "$(printf '%s' "$STUB_JSON" | jget reviewer_fallback_preference)" "reviewer fallback order follows the picker: hydrogen, then GLM, then agyclaude; never codex (PM 01M7AHAM)"
assert_eq "GLM-5.3" "$(printf '%s' "$STUB_JSON" | jget verification_author_engine)" "roster VA seat is GLM-5.3"
assert_eq "cc-shim" "$(printf '%s' "$STUB_JSON" | jget verification_author_runner)" "roster VA runner is cc-shim"
assert_eq "glm" "$(printf '%s' "$STUB_JSON" | jget verification_author_endpoint)" "roster VA endpoint is glm"
assert_eq '["gpt-6-astra","gpt-6.1-sol","GLM-5.3","gemini-4-carbon-high"]' "$(printf '%s' "$STUB_JSON" | jget qc_panel)" "roster qc panel"
assert_eq "[]" "$(printf '%s' "$STUB_JSON" | jget roster_overrides)" "no override declared -> roster_overrides is empty"
assert_eq "$STUB" "$(printf '%s' "$STUB_JSON" | jget config_path)" "config_path still names the repo file"

# 3. one override group (implementer): that group from the repo, the others from the roster.
OVR="$TEST_TMP/override.md"
cat > "$OVR" <<'EOF'
# one override
- loop_max_rounds: 7
- override: implementer | until 2099-01-01 | trial of another implementer
- implementer_engine: grok-4.7
- implementer_effort: low
- implementer_runner: grok
EOF
OVR_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$OVR" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "one override group resolves"
assert_eq "grok-4.7" "$(printf '%s' "$OVR_JSON" | jget implementer_engine)" "override group comes from the repo (engine)"
assert_eq "grok" "$(printf '%s' "$OVR_JSON" | jget implementer_runner)" "override group comes from the repo (runner)"
assert_eq "Qwen3.8-27B-QUASAR-NVFP4" "$(printf '%s' "$OVR_JSON" | jget reviewer_engine)" "other group (reviewer) still from the roster"
assert_eq "$(printf '%s' "$ROSTER_JSON" | jget qc_panel)" "$(printf '%s' "$OVR_JSON" | jget qc_panel)" "other group (qc_panel) still from the roster"
assert_eq "7" "$(printf '%s' "$OVR_JSON" | jget loop_max_rounds)" "non-seat knob written in the repo file wins"
assert_eq '[{"group":"implementer","until":"2099-01-01","reason":"trial of another implementer","expired":false}]' "$(printf '%s' "$OVR_JSON" | jget roster_overrides)" "roster_overrides lists the declared group"

# 3d. autopilot's own config inherits the GLM-5.3@cc-shim/glm VA seat from the roster (no VA override).
VA_CFG="$REPO_ROOT/.claude/review-loop-config.md"
VA_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$VA_CFG" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "autopilot's own config resolves"
assert_eq "GLM-5.3@cc-shim/glm" "$(printf '%s' "$VA_JSON" | jget verification_author_engine)@$(printf '%s' "$VA_JSON" | jget verification_author_runner)/$(printf '%s' "$VA_JSON" | jget verification_author_endpoint)" "autopilot's own config inherits GLM-5.3@cc-shim/glm VA from roster"

# 3e. negative: retired qoderclicn runner on verification_author_runner is rejected.
QOD_OVR="$TEST_TMP/qoder-va-override.md"
cat > "$QOD_OVR" <<'EOF'
- override: verification_author | until 2099-01-01 | retired qoderclicn test
- verification_author_engine: Qwen3.8-Max
- verification_author_effort: high
- verification_author_runner: qoderclicn
EOF
qod_out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$QOD_OVR" bash "$SCRIPT" 2>&1 >/dev/null)"; qod_rc=$?
assert_eq "3" "$qod_rc" "retired qoderclicn verification_author_runner exits 3"
assert_contains "$qod_out" "qoderclicn" "retired qoderclicn rejection names the runner"

# 3b. an incomplete override group is refused.
INC="$TEST_TMP/incomplete.md"
printf -- '- override: implementer | until 2099-01-01 | x\n- implementer_engine: grok-4.7\n' > "$INC"
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$INC" bash "$SCRIPT" 2>&1 >/dev/null)"; rc=$?
assert_eq "3" "$rc" "override missing runner/effort exits 3"
assert_contains "$out" "missing: implementer_runner, implementer_effort" "names the missing fields"

# 3c. until dates: expired still applies (TTL reminds, never blocks), the until day itself is not expired,
# a date that does not exist and a bad format are input errors, an empty override block is refused.
ovr_file() {  # ovr_file <name> <until-part>
  printf -- '- override: implementer | %s | ttl case\n- implementer_engine: grok-4.7\n- implementer_effort: low\n- implementer_runner: grok\n' "$2" > "$TEST_TMP/$1.md"
}
ovr_file expired "until 2000-01-01"
EXP_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/expired.md" bash "$SCRIPT" 2>"$TEST_TMP/expired.err")"; rc=$?
assert_eq "0" "$rc" "an expired override does not block (exit 0)"
assert_eq "grok-4.7" "$(printf '%s' "$EXP_JSON" | jget implementer_engine)" "an expired override still applies"
assert_contains "$(printf '%s' "$EXP_JSON" | jget roster_overrides)" '"expired":true' "expired override reports expired:true"
assert_contains "$(cat "$TEST_TMP/expired.err")" "override for implementer expired on 2000-01-01" "expired override prints a warning on stderr"
TODAY_UTC="$(node -e 'process.stdout.write(new Date().toISOString().slice(0,10))')"
ovr_file today "until $TODAY_UTC"
TODAY_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/today.md" bash "$SCRIPT" 2>"$TEST_TMP/today.err")"; rc=$?
assert_eq "0" "$rc" "an override whose until day is today resolves"
assert_contains "$(printf '%s' "$TODAY_JSON" | jget roster_overrides)" '"expired":false' "the until day itself is not expired"
assert_not_contains "$(cat "$TEST_TMP/today.err")" "expired on" "no expiry warning on the until day"
assert_contains "$(printf '%s' "$OVR_JSON" | jget roster_overrides)" '"expired":false' "a future date is not expired"
ovr_file nodate "until 2026-02-31"
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/nodate.md" bash "$SCRIPT" 2>&1 >/dev/null)"; rc=$?
assert_eq "3" "$rc" "a date that does not exist (02-31) exits 3"
assert_contains "$out" "does not exist" "says the date does not exist"
ovr_file month13 "until 2026-13-01"
REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/month13.md" bash "$SCRIPT" >/dev/null 2>&1; rc=$?
assert_eq "3" "$rc" "month 13 exits 3"
ovr_file badfmt "until 06/11/2026"
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/badfmt.md" bash "$SCRIPT" 2>&1 >/dev/null)"; rc=$?
assert_eq "3" "$rc" "a malformed until exits 3"
assert_contains "$out" 'must be "until YYYY-MM-DD"' "says what shape until takes"
printf -- '- override: implementer | until 2099-01-01 | empty block\n' > "$TEST_TMP/emptyblock.md"
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/emptyblock.md" bash "$SCRIPT" 2>&1 >/dev/null)"; rc=$?
assert_eq "3" "$rc" "an empty override block exits 3"
assert_contains "$out" "override for implementer has no fields" "says the block has no fields"

# 3d. the template's fenced brain_seat_identity_file example is not a pin: a stub repo must not inherit it
# (SOURCE=override would otherwise seat an incumbent brain from the roster's example line).
assert_eq "null" "$(printf '%s' "$STUB_JSON" | jget brain_seat)" "stub repo: no brain seat from the roster's fenced example"
BRAIN="$TEST_TMP/brain.md"; printf -- '- brain_seat_identity_file: .claude/brain-seat-identity.json\n' > "$BRAIN"
BRAIN_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN" bash "$SCRIPT" 2>/dev/null)"
assert_contains "$(printf '%s' "$BRAIN_JSON" | jget brain_seat)" '"seat_class":"incumbent"' "a repo that writes the pin itself still seats the brain"

# 4. legacy full copy: seat fields outside an override block -> exit 3 with the fix.
LEG="$TEST_TMP/legacy.md"
cat > "$LEG" <<'EOF'
- reviewer_engine: gpt-5.5
- reviewer_effort: high
- reviewer_runner: codex
- qc_panel: gpt-5.5, claude-opus
- qc_panel_runners: codex, claude-native
- qc_panel_efforts: high, high
- loop_max_rounds: 5
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$LEG" bash "$SCRIPT" 2>&1 >/dev/null)"; rc=$?
assert_eq "3" "$rc" "legacy full copy exits 3"
assert_contains "$out" "seat fields outside an override block: reviewer_engine" "names the offending fields"
assert_contains "$out" "Fix: delete those lines" "prints the fix"
assert_contains "$out" "- override: reviewer | until YYYY-MM-DD" "prints the override shape"

# 5. template unreadable -> exit 3, nothing silently built in. A copy of the plugin tree without the roster.
PLUG="$TEST_TMP/plug"
mkdir -p "$PLUG/scripts/lib"
for f in "$REPO_ROOT"/scripts/*; do
  [ -f "$f" ] && [ "$(basename "$f")" != resolve-review-loop.sh ] && ln -s "$f" "$PLUG/scripts/$(basename "$f")"
done
for f in "$REPO_ROOT"/scripts/lib/*; do
  [ -f "$f" ] && [ "$(basename "$f")" != roster-overlay.js ] && ln -s "$f" "$PLUG/scripts/lib/$(basename "$f")"
done
cp "$SCRIPT" "$PLUG/scripts/resolve-review-loop.sh"
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$STUB" bash "$PLUG/scripts/resolve-review-loop.sh" 2>&1 >/dev/null)"; rc=$?
assert_eq "3" "$rc" "missing template exits 3"
assert_contains "$out" "roster template unreadable" "says the roster is unreadable"

# 6. negative control: break the outside-block check in a copy of the lib; the legacy copy must then be
# accepted (proves step 4 measures the check and not something else).
mkdir -p "$PLUG/project-config-template"
cp "$TEMPLATE" "$PLUG/project-config-template/review-loop-config.md"
cp "$REPO_ROOT/scripts/lib/roster-overlay.js" "$PLUG/scripts/lib/roster-overlay.js"
sed_mutate "$PLUG/scripts/lib/roster-overlay.js" 's/if (outside.length) {/if (false \&\& outside.length) {/'
REVIEW_LOOP_CONFIG_OVERRIDE="$LEG" bash "$PLUG/scripts/resolve-review-loop.sh" >/dev/null 2>&1; rc=$?
assert_eq "0" "$rc" "broken outside-block check accepts the legacy copy (negative control is red on the broken lib)"
REVIEW_LOOP_CONFIG_OVERRIDE="$LEG" bash "$SCRIPT" >/dev/null 2>&1; rc=$?
assert_eq "3" "$rc" "the real lib still refuses it"

# 7. TEST-ONLY knob REVIEW_LOOP_ROSTER_TEMPLATE: a fixture roster (the real template with patched fields,
# built by lib/roster-fixture.js) replaces the roster; the repo file still goes through the overlay rules.
printf -- '- reviewer_engine: fixture-reviewer\n- reviewer_runner: codex\n- reviewer_effort: low\n' > "$TEST_TMP/patch.md"
node "$REPO_ROOT/hooks/tests/lib/roster-fixture.js" build "$TEST_TMP/patch.md" "$TEST_TMP/fixture-roster.md"
FX_JSON="$(REVIEW_LOOP_ROSTER_TEMPLATE="$TEST_TMP/fixture-roster.md" REVIEW_LOOP_CONFIG_OVERRIDE="$STUB" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "fixture roster through the knob resolves"
assert_eq "fixture-reviewer" "$(printf '%s' "$FX_JSON" | jget reviewer_engine)" "the knob's roster supplies the patched seat"
assert_eq "$(printf '%s' "$ROSTER_JSON" | jget qc_panel)" "$(printf '%s' "$FX_JSON" | jget qc_panel)" "unpatched groups still equal the real roster"
REVIEW_LOOP_ROSTER_TEMPLATE="$TEST_TMP/fixture-roster.md" REVIEW_LOOP_CONFIG_OVERRIDE="$LEG" bash "$SCRIPT" >/dev/null 2>&1; rc=$?
assert_eq "3" "$rc" "a legacy full copy is still refused when the roster comes from the knob"

# 8. production caller: check-contract-schema.js passes the template itself through REVIEW_LOOP_CONFIG_OVERRIDE.
node "$REPO_ROOT/scripts/check-contract-schema.js" >/dev/null 2>&1 </dev/null; rc=$?
assert_eq "0" "$rc" "check-contract-schema.js exits 0 at the tip"

finalize_test
