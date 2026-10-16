#!/usr/bin/env bash
set -e
out=$(node cli.js)
echo "$out" | grep -q 'widget: 59.97' || { echo "FAIL: text report"; exit 1; }
echo "PASS"
