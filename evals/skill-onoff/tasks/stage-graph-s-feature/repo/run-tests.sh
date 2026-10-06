#!/usr/bin/env bash
set -e
out=$(node cli.js greet alice)
[ "$out" = "hello alice" ] || { echo "FAIL: greet"; exit 1; }
out=$(node cli.js greet)
[ "$out" = "hello world" ] || { echo "FAIL: default name"; exit 1; }
echo "PASS"
