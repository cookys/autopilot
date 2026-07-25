#!/usr/bin/env bash
# Explicit self-hosted gate for P3.4a's privileged mechanism probe.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if ! sudo -n true; then
  echo "P3.4 live preflight requires passwordless sudo on a self-hosted Linux runner." >&2
  exit 2
fi

exec env AUTOPILOT_P34_LIVE=1 bash "$REPO_ROOT/hooks/tests/supervised-host-preflight.test.sh"
