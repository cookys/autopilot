#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# Pin config path so resolver evaluates the template config deterministically.
export REVIEW_LOOP_CONFIG_OVERRIDE="$REPO_ROOT/project-config-template/review-loop-config.md"

# Create the validator script
cat <<'JS' > "$TEST_TMP/validate-parity.js"
const path = require('path');
const fs = require('fs');
const root = process.argv[2];
const isScorecard = process.argv[3] === 'true';
const isDensity = process.argv[4] === 'true';

// Extract REVIEW_LOOP_FIELDS from src/engine/resolve-review-loop.js
const jsPath = path.join(root, 'src', 'engine', 'resolve-review-loop.js');
const fileContent = fs.readFileSync(jsPath, 'utf8');
const match = fileContent.match(/const REVIEW_LOOP_FIELDS = \s*\[([\s\S]*?)\];/);
if (!match) {
  console.error("Could not find REVIEW_LOOP_FIELDS in resolve-review-loop.js");
  process.exit(2);
}
const REVIEW_LOOP_FIELDS = match[1]
  .split(',')
  .map(s => s.trim().replace(/['"]/g, ''))
  .filter(Boolean);

// Import validateReviewLoopConfig from the module
const { validateReviewLoopConfig } = require(jsPath);

const stdout = fs.readFileSync(0, 'utf8');
let parsed;
try {
  parsed = JSON.parse(stdout);
} catch (e) {
  console.error("parse-failed: " + e.message);
  process.exit(2);
}

const emittedKeys = Object.keys(parsed);
const expectedKeys = new Set(REVIEW_LOOP_FIELDS);

// Documented allowlist of conditional keys that are known to the JS side.
// The shell script only emits scorecard keys when --check-scorecard is passed.
// Density keys are emitted only when density scaling is enabled.
const conditionalAllowlist = ['reviewer_qualified', 'fallback_ladder'];
const optionalKnownFields = ['capability_tier', 'density_scaled', 'density_source', 'verify_first'];
if (isScorecard) {
  for (const k of conditionalAllowlist) {
    expectedKeys.add(k);
  }
}
if (isDensity) {
  for (const k of optionalKnownFields) {
    expectedKeys.add(k);
  }
}

const unknownEmitted = emittedKeys.filter(k => !expectedKeys.has(k) && !optionalKnownFields.includes(k));
const missingEmitted = Array.from(expectedKeys).filter(k => !emittedKeys.includes(k));

if (unknownEmitted.length > 0 || missingEmitted.length > 0) {
  if (unknownEmitted.length > 0) {
    console.error("shell emits keys unknown to JS: " + unknownEmitted.join(', '));
  }
  if (missingEmitted.length > 0) {
    console.error("missing keys in shell output: " + missingEmitted.join(', '));
  }
  process.exit(1);
}

try {
  validateReviewLoopConfig(parsed);
} catch (e) {
  console.error("validation-failed: " + e.message);
  process.exit(3);
}

console.log("parity-ok");
process.exit(0);
JS

# Case A: Normal resolve and parity validation
NORMAL_OUT="$("$REPO_ROOT/scripts/resolve-review-loop.sh")"
EXIT_NORMAL=$?
assert_eq "$EXIT_NORMAL" "0" "resolve-review-loop exits 0 on normal config"

VALIDATE_NORMAL="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" <<< "$NORMAL_OUT")"
EXIT_VALIDATE=$?
assert_eq "$EXIT_VALIDATE" "0" "JS-side validator accepts normal config and matches fields exactly"
assert_contains "$VALIDATE_NORMAL" "parity-ok" "normal validation returns parity-ok"


# Case B: --check-scorecard resolve and parity validation
SCORECARD_OUT="$("$REPO_ROOT/scripts/resolve-review-loop.sh" --check-scorecard)"
EXIT_SCORECARD=$?
assert_eq "$EXIT_SCORECARD" "0" "resolve-review-loop exits 0 with --check-scorecard"

VALIDATE_SCORECARD="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "true" <<< "$SCORECARD_OUT")"
EXIT_VALIDATE_SCORECARD=$?
assert_eq "$EXIT_VALIDATE_SCORECARD" "0" "JS-side validator accepts scorecard config and matches fields exactly"
assert_contains "$VALIDATE_SCORECARD" "parity-ok" "scorecard validation returns parity-ok"

# Case B2: density-scaling conditional fields are known to the JS-side validator
DENSITY_STORE="$TEST_TMP/contract-density-empty-scorecard"
mkdir -p "$DENSITY_STORE"
DENSITY_OUT="$(ENGINE_SCORECARD_DIR="$DENSITY_STORE" "$REPO_ROOT/scripts/resolve-review-loop.sh" --scale-by-capability)"
EXIT_DENSITY=$?
assert_eq "$EXIT_DENSITY" "0" "resolve-review-loop exits 0 with --scale-by-capability"

VALIDATE_DENSITY="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" "true" <<< "$DENSITY_OUT")"
EXIT_VALIDATE_DENSITY=$?
assert_eq "$EXIT_VALIDATE_DENSITY" "0" "JS-side validator accepts density conditional fields and matches fields exactly"
assert_contains "$VALIDATE_DENSITY" "parity-ok" "density validation returns parity-ok"

# Case B3: high-tier density scaling emits verify_first=true and capped rounds, accepted by JS
DENSITY_HIGH_STORE="$TEST_TMP/contract-density-high-scorecard"
mkdir -p "$DENSITY_HIGH_STORE"
RECIMPL_HIGH_JSON="$DENSITY_HIGH_STORE/rec.json"
cat > "$RECIMPL_HIGH_JSON" <<'JSON'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
ENGINE_SCORECARD_DIR="$DENSITY_HIGH_STORE" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$RECIMPL_HIGH_JSON" > /dev/null
DENSITY_HIGH_OUT="$(ENGINE_SCORECARD_DIR="$DENSITY_HIGH_STORE" "$REPO_ROOT/scripts/resolve-review-loop.sh" --scale-by-capability --diff-lines 0 --protected-path 0 --oracle-available 1 --security-surface 0)"
EXIT_DENSITY_HIGH=$?
assert_eq "$EXIT_DENSITY_HIGH" "0" "resolve-review-loop exits 0 with --scale-by-capability and high-tier implementer"

assert_eq "$(node -e 'const fs = require("fs"); const obj = JSON.parse(fs.readFileSync(0, "utf8")); console.log(obj.capability_tier);' <<< "$DENSITY_HIGH_OUT")" "high" "high-tier scorecard row emits capability_tier=high"
assert_eq "$(node -e 'const fs = require("fs"); const obj = JSON.parse(fs.readFileSync(0, "utf8")); console.log(obj.review_risk);' <<< "$DENSITY_HIGH_OUT")" "low" "high-tier density case exercises low-risk path"
assert_eq "$(node -e 'const fs = require("fs"); const obj = JSON.parse(fs.readFileSync(0, "utf8")); console.log(String(obj.verify_first));' <<< "$DENSITY_HIGH_OUT")" "true" "high-tier low-risk density scaling emits verify_first=true"
assert_eq "$(node -e 'const fs = require("fs"); const obj = JSON.parse(fs.readFileSync(0, "utf8")); console.log(String(obj.loop_max_rounds));' <<< "$DENSITY_HIGH_OUT")" "2" "high-tier low-risk density scaling caps loop_max_rounds at 2"

VALIDATE_DENSITY_HIGH="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" "true" <<< "$DENSITY_HIGH_OUT")"
EXIT_VALIDATE_DENSITY_HIGH=$?
assert_eq "$EXIT_VALIDATE_DENSITY_HIGH" "0" "JS-side validator accepts high-tier density fields and matches fields exactly"
assert_contains "$VALIDATE_DENSITY_HIGH" "parity-ok" "high-tier density validation returns parity-ok"

# Case C: reviewer_runner enum parity for direct Anthropic-compatible reviewer.
AC_CFG="$TEST_TMP/review-loop-anthropic-compatible.md"
printf -- '- reviewer_runner: anthropic-compatible\n- reviewer_engine: MiniMax-M3\n' > "$AC_CFG"
AC_ERR="$TEST_TMP/review-loop-anthropic-compatible.stderr"
AC_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AC_CFG" "$REPO_ROOT/scripts/resolve-review-loop.sh" 2>"$AC_ERR")"
EXIT_AC=$?
assert_eq "$EXIT_AC" "0" "resolve-review-loop exits 0 with anthropic-compatible reviewer_runner"
AC_ERR_LOWER="$(tr '[:upper:]' '[:lower:]' < "$AC_ERR")"
assert_not_contains "$AC_ERR_LOWER" "error" "anthropic-compatible shell resolve does not emit error"
assert_not_contains "$AC_ERR_LOWER" "block" "anthropic-compatible shell resolve does not emit block"

AC_RUNNER="$(node -e 'const fs = require("fs"); const obj = JSON.parse(fs.readFileSync(0, "utf8")); console.log(obj.reviewer_runner);' <<< "$AC_OUT")"
assert_eq "$AC_RUNNER" "anthropic-compatible" "shell preserves anthropic-compatible reviewer_runner"

AC_JS_RUNNER="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AC_CFG" node -e '
const { resolveReviewLoopJson } = require("./src/engine/resolve-review-loop.js");
const resolved = resolveReviewLoopJson([]);
if (resolved.error || resolved.parseError || resolved.status !== 0) {
  console.error(JSON.stringify({
    status: resolved.status,
    error: resolved.error && resolved.error.message,
    parseError: resolved.parseError && resolved.parseError.message,
    stderr: resolved.stderr,
  }));
  process.exit(1);
}
console.log(resolved.result.reviewer_runner);
')"
EXIT_AC_JS=$?
assert_eq "$EXIT_AC_JS" "0" "JS module resolves anthropic-compatible reviewer_runner without error"
assert_eq "$AC_JS_RUNNER" "$AC_RUNNER" "JS module preserves same reviewer_runner as shell"

VALIDATE_AC="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" <<< "$AC_OUT")"
EXIT_VALIDATE_AC=$?
assert_eq "$EXIT_VALIDATE_AC" "0" "JS-side validator accepts anthropic-compatible reviewer_runner"
assert_contains "$VALIDATE_AC" "parity-ok" "anthropic-compatible validation returns parity-ok"


# Case D: Negative check - unknown key added
TAMPERED_UNKNOWN="$(node -e 'const obj = JSON.parse(process.argv[1]); obj.bogus_key = "unexpected_value"; console.log(JSON.stringify(obj));' "$NORMAL_OUT")"

VALIDATE_UNKNOWN="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" <<< "$TAMPERED_UNKNOWN" 2>&1)"
EXIT_UNKNOWN=$?

assert_eq "$EXIT_UNKNOWN" "1" "JS-side validator rejects unknown key"
assert_contains "$VALIDATE_UNKNOWN" "shell emits keys unknown to JS: bogus_key" "validation error lists bogus_key"


# Case E: Negative check - missing key
TAMPERED_MISSING="$(node -e 'const obj = JSON.parse(process.argv[1]); delete obj.reviewer_engine; console.log(JSON.stringify(obj));' "$NORMAL_OUT")"

VALIDATE_MISSING="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" <<< "$TAMPERED_MISSING" 2>&1)"
EXIT_MISSING=$?

assert_eq "$EXIT_MISSING" "1" "JS-side validator rejects missing key"
assert_contains "$VALIDATE_MISSING" "missing keys in shell output: reviewer_engine" "validation error lists missing reviewer_engine"

finalize_test
