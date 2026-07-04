#!/usr/bin/env bash
set -e
node tests/test-math.js
node tests/test-string.js
node tests/test-auth.js
# Note: test-calculator is expected to fail.
# test-formatter is the regression under investigation.
node tests/test-formatter.js
node tests/test-calculator.js
