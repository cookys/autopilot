#!/usr/bin/env bash
set -e
node tests/test-math.js
node tests/test-string.js
node tests/test-auth.js
node tests/test-formatter.js
node tests/test-validator.js
