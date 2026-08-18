#!/usr/bin/env bash
set -e
out=$(node server.js --port 3000)
[ "$out" = "listening on 3000" ] || { echo "FAIL: happy path"; exit 1; }
echo "PASS"
