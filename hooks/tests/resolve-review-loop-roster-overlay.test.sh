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
assert_eq "GLM-5.3" "$(printf '%s' "$STUB_JSON" | jget reviewer_engine)" "roster loop reviewer is GLM-5.3"
assert_eq "cc-shim" "$(printf '%s' "$STUB_JSON" | jget reviewer_runner)" "roster loop reviewer runner is cc-shim"
assert_eq "Qwen3.8-Max" "$(printf '%s' "$STUB_JSON" | jget verification_author_engine)" "roster VA seat is Qwen3.8-Max"
assert_eq '["gpt-6-astra","gpt-6.1-sol","gemini-4-argon-high","GLM-5.3"]' "$(printf '%s' "$STUB_JSON" | jget qc_panel)" "roster qc panel"
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
assert_eq "GLM-5.3" "$(printf '%s' "$OVR_JSON" | jget reviewer_engine)" "other group (reviewer) still from the roster"
assert_eq "$(printf '%s' "$ROSTER_JSON" | jget qc_panel)" "$(printf '%s' "$OVR_JSON" | jget qc_panel)" "other group (qc_panel) still from the roster"
assert_eq "7" "$(printf '%s' "$OVR_JSON" | jget loop_max_rounds)" "non-seat knob written in the repo file wins"
assert_eq '[{"group":"implementer","until":"2099-01-01","reason":"trial of another implementer"}]' "$(printf '%s' "$OVR_JSON" | jget roster_overrides)" "roster_overrides lists the declared group"

# 3b. an incomplete override group is refused.
INC="$TEST_TMP/incomplete.md"
printf -- '- override: implementer | until 2099-01-01 | x\n- implementer_engine: grok-4.7\n' > "$INC"
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$INC" bash "$SCRIPT" 2>&1 >/dev/null)"; rc=$?
assert_eq "3" "$rc" "override missing runner/effort exits 3"
assert_contains "$out" "missing: implementer_runner, implementer_effort" "names the missing fields"

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

finalize_test
