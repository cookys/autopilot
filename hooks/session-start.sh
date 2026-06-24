#!/usr/bin/env bash
# Autopilot SessionStart hook — delegate to pure Node.js implementation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "${SCRIPT_DIR}/session-start.js" "$@"
