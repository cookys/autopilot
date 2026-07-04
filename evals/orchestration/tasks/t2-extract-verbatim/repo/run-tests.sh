#!/usr/bin/env bash
set -e
node tests/test-helper.js
node tests/test-format.js
bash tests/test-process.sh
