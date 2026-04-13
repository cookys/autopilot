#!/usr/bin/env bash
# Regression test: hooks.json must be valid JSON
set -euo pipefail

HOOKS_FILE="$(cd "$(dirname "$0")/../../hooks" && pwd)/hooks.json"

echo "=== hooks.json Validity Test ==="

if ! command -v jq &>/dev/null; then
  echo "  SKIP: jq not installed"
  exit 0
fi

if jq . "$HOOKS_FILE" > /dev/null 2>&1; then
  echo "  PASS: hooks.json is valid JSON"
  exit 0
else
  echo "  FAIL: hooks.json is NOT valid JSON"
  jq . "$HOOKS_FILE" 2>&1 | head -5
  exit 1
fi
