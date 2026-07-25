#!/usr/bin/env bash
# Explicit self-hosted gate for P3.4b's installed root launcher.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if ! sudo -n true; then
  echo "P3.4b live launcher requires passwordless sudo on a self-hosted Linux runner." >&2
  exit 2
fi

exec env AUTOPILOT_P34B_LIVE=1 bash "$REPO_ROOT/hooks/tests/supervised-host-launcher.test.sh"
