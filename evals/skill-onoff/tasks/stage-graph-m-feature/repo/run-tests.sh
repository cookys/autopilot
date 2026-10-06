#!/usr/bin/env bash
set -e
out=$(node cli.js list)
echo "$out" | grep -q "^apple" || { echo "FAIL: list shows apple"; exit 1; }
echo "PASS"
