#!/usr/bin/env bash
# AGY Gemini 3.5 Flash High was used as the test author fallback after GLM, Claude, and MiniMax write rails were unavailable.
# Verification Author Resolver Test Cases (Unit R1)
# Direct translation of the frozen spec.

. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# Hermetic test environment
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR

json_get() { # json key -> raw json value
  local json="$1" key="$2"
  export JSON_VALUE="$json"
  node - "$key" <<'NODE'
const fs = require('fs');
const payload = process.env.JSON_VALUE || '';
const key = process.argv[2];
if (!payload) process.exit(0);
try {
  const parsed = JSON.parse(payload);
  const value = parsed && parsed[key];
  if (value === undefined) process.exit(0);
  // Strings are returned RAW (unquoted) so assertions can compare to a bare value
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
} catch (e) {
  process.exit(0);
}
NODE
  unset JSON_VALUE
}

# 1. Complete author tuple resolves exact five config fields plus verification_author_family=zhipu,
#    implementer_family=openai, nonempty config_path, parseable JSON, and working `--field verification_author_engine`.
CFG1="$TEST_TMP/config1.md"
cat <<EOF > "$CFG1"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: TESTEP
- implementer_engine: gpt-5.3-codex-spark
EOF

JSON1="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG1" bash "$SCRIPT" 2>/dev/null)"
EXIT1=$?
assert_eq "0" "$EXIT1" "Case 1 exit code"

JSON_ENV="$JSON1" node -e 'JSON.parse(process.env.JSON_ENV)' 2>/dev/null
assert_eq "0" "$?" "Case 1 JSON is valid"

# Check JSON fields
assert_eq "true" "$(json_get "$JSON1" verification_author_present)" "Case 1 present"
assert_eq "glm-5.2" "$(json_get "$JSON1" verification_author_engine)" "Case 1 engine"
assert_eq "cc-shim" "$(json_get "$JSON1" verification_author_runner)" "Case 1 runner"
assert_eq "high" "$(json_get "$JSON1" verification_author_effort)" "Case 1 effort"
assert_eq "TESTEP" "$(json_get "$JSON1" verification_author_endpoint)" "Case 1 endpoint"
assert_eq "zhipu" "$(json_get "$JSON1" verification_author_family)" "Case 1 verification_author_family"
assert_eq "openai" "$(json_get "$JSON1" implementer_family)" "Case 1 implementer_family"
assert_eq "$CFG1" "$(json_get "$JSON1" config_path)" "Case 1 config_path"

# Check --field verification_author_engine
FIELD1="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG1" bash "$SCRIPT" --field verification_author_engine 2>/dev/null)"
EXIT_FIELD1=$?
assert_eq "0" "$EXIT_FIELD1" "Case 1 --field exit code"
assert_eq "glm-5.2" "$FIELD1" "Case 1 --field verification_author_engine"


# 2. present=false with empty tuple remains a valid unauthorized state and does not choose a model.
CFG2="$TEST_TMP/config2.md"
cat <<EOF > "$CFG2"
- verification_author_present: false
- verification_author_engine:
- verification_author_runner:
- verification_author_effort:
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

JSON2="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG2" bash "$SCRIPT" 2>/dev/null)"
EXIT2=$?
assert_eq "0" "$EXIT2" "Case 2 exit code"

JSON_ENV="$JSON2" node -e 'JSON.parse(process.env.JSON_ENV)' 2>/dev/null
assert_eq "0" "$?" "Case 2 JSON is valid"

assert_eq "false" "$(json_get "$JSON2" verification_author_present)" "Case 2 present"
assert_eq "" "$(json_get "$JSON2" verification_author_engine)" "Case 2 engine empty"
assert_eq "" "$(json_get "$JSON2" verification_author_runner)" "Case 2 runner empty"
assert_eq "" "$(json_get "$JSON2" verification_author_effort)" "Case 2 effort empty"
assert_eq "" "$(json_get "$JSON2" verification_author_endpoint)" "Case 2 endpoint empty"


# 3. present=true with only engine set exits 3 with an incomplete-tuple diagnostic.
CFG3="$TEST_TMP/config3.md"
cat <<EOF > "$CFG3"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner:
- verification_author_effort:
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

OUT3="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG3" bash "$SCRIPT" 2>&1)"
EXIT3=$?
assert_eq "3" "$EXIT3" "Case 3 exit code (incomplete tuple)"
assert_contains "$OUT3" "incomplete" "Case 3 output identifies incomplete state"
assert_contains "$OUT3" "verification" "Case 3 output mentions verification"
assert_contains "$OUT3" "tuple" "Case 3 output mentions tuple"


# 4. present=false with a nonempty engine exits 3 as inconsistent.
CFG4="$TEST_TMP/config4.md"
cat <<EOF > "$CFG4"
- verification_author_present: false
- verification_author_engine: glm-5.2
- verification_author_runner:
- verification_author_effort:
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

OUT4="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG4" bash "$SCRIPT" 2>&1)"
EXIT4=$?
assert_eq "3" "$EXIT4" "Case 4 exit code (inconsistent present=false)"
assert_contains "$OUT4" "inconsistent" "Case 4 output identifies inconsistent state"
assert_contains "$OUT4" "verification" "Case 4 output mentions verification"
assert_contains "$OUT4" "present" "Case 4 output mentions present"


# 5. Unknown author engine surfaces family=unknown, never a guessed known family.
CFG5="$TEST_TMP/config5.md"
cat <<EOF > "$CFG5"
- verification_author_present: true
- verification_author_engine: unknown-spec-engine-name
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

JSON5="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG5" bash "$SCRIPT" 2>/dev/null)"
EXIT5=$?
assert_eq "0" "$EXIT5" "Case 5 exit code"

JSON_ENV="$JSON5" node -e 'JSON.parse(process.env.JSON_ENV)' 2>/dev/null
assert_eq "0" "$?" "Case 5 JSON is valid"

assert_eq "unknown-spec-engine-name" "$(json_get "$JSON5" verification_author_engine)" "Case 5 engine"
assert_eq "unknown" "$(json_get "$JSON5" verification_author_family)" "Case 5 verification_author_family is unknown"

finalize_test
