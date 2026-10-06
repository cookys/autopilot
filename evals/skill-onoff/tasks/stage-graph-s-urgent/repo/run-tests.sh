#!/usr/bin/env bash
set -e
out=$(node cli.js --no-color build)
echo "$out" | grep -q "== jobtool v1 ==" || { echo "FAIL: banner"; exit 1; }
echo "$out" | grep -q "run: build" || { echo "FAIL: run line"; exit 1; }
echo "PASS"
