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
// The shell script only emits them when --check-scorecard is passed.
const conditionalAllowlist = ['reviewer_qualified', 'fallback_ladder'];
if (isScorecard) {
  for (const k of conditionalAllowlist) {
    expectedKeys.add(k);
  }
}

const unknownEmitted = emittedKeys.filter(k => !expectedKeys.has(k));
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


# Case C: Negative check - unknown key added
TAMPERED_UNKNOWN="$(node -e 'const obj = JSON.parse(process.argv[1]); obj.bogus_key = "unexpected_value"; console.log(JSON.stringify(obj));' "$NORMAL_OUT")"

VALIDATE_UNKNOWN="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" <<< "$TAMPERED_UNKNOWN" 2>&1)"
EXIT_UNKNOWN=$?

assert_eq "$EXIT_UNKNOWN" "1" "JS-side validator rejects unknown key"
assert_contains "$VALIDATE_UNKNOWN" "shell emits keys unknown to JS: bogus_key" "validation error lists bogus_key"


# Case D: Negative check - missing key
TAMPERED_MISSING="$(node -e 'const obj = JSON.parse(process.argv[1]); delete obj.reviewer_engine; console.log(JSON.stringify(obj));' "$NORMAL_OUT")"

VALIDATE_MISSING="$(node "$TEST_TMP/validate-parity.js" "$REPO_ROOT" "false" <<< "$TAMPERED_MISSING" 2>&1)"
EXIT_MISSING=$?

assert_eq "$EXIT_MISSING" "1" "JS-side validator rejects missing key"
assert_contains "$VALIDATE_MISSING" "missing keys in shell output: reviewer_engine" "validation error lists missing reviewer_engine"

finalize_test
