#!/usr/bin/env bash
# qc-panel.sh — Shell wrapper delegating to qc-panel.js.

exec node "$(dirname "$0")/qc-panel.js" "$@"
