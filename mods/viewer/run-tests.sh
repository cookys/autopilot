#!/usr/bin/env bash
# mods/viewer/run-tests.sh — run the viewer mod's suites: model.test.js (pure, node --test) and viewer.test.ts (through the engine, `claude plugin test`).
#
# Same wrapper idea as mods/live/run-tests.sh: a throwaway plugin named `autopilot` in a temp dir, hooks module ../mods/register.ts (the composed module: live + viewer), holding COPIES of mods/viewer and mods/live
# (the viewer imports the live mod's locale choice and colour roles: ../live/i18n, ../live/ui). Nothing is written into the repo. Run solo (not in parallel with other long suites).
#
# usage: bash mods/viewer/run-tests.sh [extra args for `claude plugin test`]      exit code = the test run's
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node --test "$here/model.test.js"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/.claude-plugin" "$tmp/hooks" "$tmp/mods"
printf '%s\n' '{"name":"autopilot","version":"0.0.0","description":"throwaway wrapper for the viewer mod tests"}' > "$tmp/.claude-plugin/plugin.json"
printf '%s\n' '{"modules":["../mods/register.ts"]}' > "$tmp/hooks/hooks.json"
cp -r "$here" "$tmp/mods/viewer"
cp -r "$here/../live" "$tmp/mods/live"
cp "$here/../register.ts" "$tmp/mods/register.ts"
rm -f "$tmp/mods/viewer/run-tests.sh" "$tmp/mods/live/run-tests.sh"
rm -f "$tmp/mods/live/"*.test.ts "$tmp/mods/live/"*.test.js # the live suites run from their own wrapper

cd "$tmp"
timeout 600 claude plugin test "$tmp" "$@"
