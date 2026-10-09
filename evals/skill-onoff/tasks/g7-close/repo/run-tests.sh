#!/usr/bin/env bash
set -e
out=$(node cli.js World)
[ "$out" = 'Hello, World!' ] || { echo "FAIL: greet"; exit 1; }
echo "PASS"
