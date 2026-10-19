#!/usr/bin/env bash
# mods/roundtable/run-tests.sh — model.test.js and lint.test.js under node --test, then roundtable.test.ts through the engine.
# Throwaway plugin named autopilot; hooks module is the composed mods/register.ts. Copies mods/roundtable, mods/live and mods/viewer.
# usage: bash mods/roundtable/run-tests.sh [extra args for claude plugin test]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node --test "$here/model.test.js" "$here/lint.test.js"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/.claude-plugin" "$tmp/hooks" "$tmp/mods"
printf '%s\n' '{"name":"autopilot","version":"0.0.0","description":"throwaway wrapper for the roundtable mod tests"}' > "$tmp/.claude-plugin/plugin.json"
printf '%s\n' '{"modules":["../mods/register.ts"]}' > "$tmp/hooks/hooks.json"
cp -r "$here" "$tmp/mods/roundtable"
cp -r "$here/../live" "$tmp/mods/live"
cp -r "$here/../viewer" "$tmp/mods/viewer"
cp "$here/../register.ts" "$tmp/mods/register.ts"
rm -f "$tmp/mods/roundtable/run-tests.sh" "$tmp/mods/live/run-tests.sh" "$tmp/mods/viewer/run-tests.sh"
rm -f "$tmp/mods/live/"*.test.ts "$tmp/mods/live/"*.test.js
rm -f "$tmp/mods/viewer/"*.test.ts "$tmp/mods/viewer/"*.test.js

cd "$tmp"
timeout 600 claude plugin test "$tmp" "$@"
