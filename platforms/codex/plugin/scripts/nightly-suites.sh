#!/usr/bin/env bash
# Run the eval suites outside the merge gate and emit one summary line.
set -u

tmp=""
trap 'rm -f "${tmp:-}"' EXIT
tmp="$(mktemp "${TMPDIR:-/tmp}/autopilot-nightly-suites.XXXXXX")" || exit 2
node scripts/affected-suites.js --run --only-glob 'evals/**' >"$tmp" 2>&1
rc=$?
summary="$(sed -n '/^summary:/p' "$tmp" | tail -n 1)"
[ -n "$summary" ] || summary='summary unavailable'
printf 'nightly eval suites: %s; exit=%s\n' "$summary" "$rc"
exit "$rc"
