#!/usr/bin/env bash
# T3 oracle.sh — outcomes measure

set -eu

# 1. Behavioral check: is the bug fixed in lib/validator.js?
bug_fixed=0
if [ -f "lib/validator.js" ]; then
  if node -e '
const { validateEmail } = require("./lib/validator");
if (validateEmail("user@domain") !== false) process.exit(1);
if (validateEmail("user@domain.com") !== true) process.exit(1);
if (validateEmail("invalid") !== false) process.exit(1);
' 2>/dev/null; then
    bug_fixed=1
  else
    echo "Fail reason: validateEmail behavior incorrect on test probes" >&2
  fi
else
  echo "Fail reason: lib/validator.js not found" >&2
fi

# 2. Discrimination check: does candidate tests fail on original buggy code?
discrimination_ok=0
BASE_COMMIT=$(git rev-list --max-parents=0 HEAD 2>/dev/null | head -1)
if [ -n "$BASE_COMMIT" ]; then
  # Make a temp directory for perturbation check
  TEST_TMP_DIR=$(mktemp -d -t "t3-perturb-XXXXXX")
  cleanup_tmp() {
    rm -rf "$TEST_TMP_DIR"
  }
  trap cleanup_tmp EXIT
  
  # Copy current candidate tree
  cp -r . "$TEST_TMP_DIR"/
  
  # Revert lib/validator.js to base version in the temp copy
  git show "$BASE_COMMIT:lib/validator.js" > "$TEST_TMP_DIR/lib/validator.js"
  
  # Run candidate tests on the buggy tree; it MUST fail
  set +e
  (
    cd "$TEST_TMP_DIR"
    bash run-tests.sh >/dev/null 2>&1
  )
  RUN_STATUS=$?
  set -e
  if [ $RUN_STATUS -ne 0 ]; then
    discrimination_ok=1
  else
    echo "Fail reason: test suite did not fail when the bug was re-introduced" >&2
  fi
else
  echo "Warning: no git base commit found, skipping discrimination check" >&2
fi

# 3. Tests pass check
tests_passed=0
if [ -f "run-tests.sh" ]; then
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  else
    echo "Fail reason: candidate test suite failed on fixed code" >&2
  fi
else
  echo "Fail reason: run-tests.sh not found" >&2
fi

# Final outcome
if [ $bug_fixed -eq 1 ] && [ $discrimination_ok -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: bug_fixed=$bug_fixed, discrimination_ok=$discrimination_ok, tests_passed=$tests_passed" >&2
  exit 1
fi
