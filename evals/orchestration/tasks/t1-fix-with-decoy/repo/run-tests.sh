#!/usr/bin/env bash
set -e
node tests/test-math.js
node tests/test-string.js
node tests/test-decoy.js
node tests/test-auth.js
node tests/test-buggy.js
