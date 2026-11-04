#!/usr/bin/env bash
set -e
node tests/test-math.js
node tests/test-utils.js
node tests/test-parser.js
node tests/test-config.js
