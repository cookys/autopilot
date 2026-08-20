#!/usr/bin/env bash
set -e
out=$(node cli.js "a  b c")
[ "$out" = '["a","b","c"]' ] || { echo "FAIL: parse"; exit 1; }
echo "PASS"
