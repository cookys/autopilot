#!/usr/bin/env bash
set -e
out=$(node cli.js greet alice)
[ "$out" = "hello alice" ] || { echo "FAIL: greet"; exit 1; }
echo "PASS"
