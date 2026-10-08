#!/usr/bin/env bash
# mods/live/run-tests.sh — run the live mod's suites (live.test.ts, load-source.test.ts) with `claude plugin test`.
#
# `claude plugin test <folder>` runs a plugin's *.test.ts files against the real engine, and a plugin loads its hooks module from the
# `modules` key of hooks/hooks.json. The suite is written for a plugin named `autopilot` ($.state refs are owner-checked) whose
# modules entry is ../mods/live/register.ts. This script builds that throwaway wrapper in a temp dir:
#
#   <tmp>/.claude-plugin/plugin.json   {"name":"autopilot",...}
#   <tmp>/hooks/hooks.json             {"modules":["../mods/live/register.ts"]}      (an ARRAY; a string names none)
#   <tmp>/mods/live/                   a COPY of this directory (a symlink is refused: path-traversal)
#
# and runs `claude plugin test <tmp>`. Nothing is written into the repo. Run solo (not in parallel with other long suites).
#
# usage: bash mods/live/run-tests.sh [extra args for `claude plugin test`]      exit code = the test run's
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/.claude-plugin" "$tmp/hooks" "$tmp/mods"
printf '%s\n' '{"name":"autopilot","version":"0.0.0","description":"throwaway wrapper for the live mod tests"}' > "$tmp/.claude-plugin/plugin.json"
printf '%s\n' '{"modules":["../mods/live/register.ts"]}' > "$tmp/hooks/hooks.json"
cp -r "$here" "$tmp/mods/live"
rm -f "$tmp/mods/live/run-tests.sh"

cd "$tmp"
timeout 600 claude plugin test "$tmp" "$@"
