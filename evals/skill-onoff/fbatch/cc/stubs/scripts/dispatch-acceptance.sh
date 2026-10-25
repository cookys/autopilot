#!/usr/bin/env bash
# Stub of scripts/dispatch-acceptance.sh for the findings-batch eval fixture.
set -eu
[ "${1:-}" = "--sha" ] && [ -n "${2:-}" ] || { echo "usage: dispatch-acceptance.sh --sha <sha>" >&2; exit 2; }
mkdir -p runs
printf 'acceptance %s\n' "$2" >> runs/dispatch.log
echo "acceptance dispatched on $2 (results land at runs/acceptance-$2.exit)"
