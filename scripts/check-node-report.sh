#!/usr/bin/env bash
# check-node-report.sh — Shell wrapper delegating to check-node-report.js.

exec node "$(dirname "$0")/check-node-report.js" "$@"
