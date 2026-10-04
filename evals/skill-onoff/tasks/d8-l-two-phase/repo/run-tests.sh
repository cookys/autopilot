#!/usr/bin/env bash
set -e
out=$(node cli.js "a  b c")
[ "$out" = '["a","b","c"]' ] || { echo "FAIL: baseline"; exit 1; }
if grep -rq 'runHooks' lib/ 2>/dev/null; then
  out=$(node cli.js "a b")
  [ "$out" = '["a","b"]' ] || { echo "FAIL: default output changed"; exit 1; }
fi
echo "PASS"
