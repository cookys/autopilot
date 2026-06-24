#!/bin/bash
# toggle-payload-capture — one-shot helper for capturing real Claude Code
# hook payload via capture-payload.js (Tier B diagnostic).
#
# Usage:
#   scripts/toggle-payload-capture.sh enable    # wire capture into hooks.json
#   scripts/toggle-payload-capture.sh disable   # restore hooks.json from backup
#   scripts/toggle-payload-capture.sh status    # show which mode is active
#
# Workflow:
#   1. scripts/toggle-payload-capture.sh enable
#   2. (open new terminal)  AUTOPILOT_CAPTURE_PAYLOAD=1 claude
#   3. (in fresh claude)    run ANY tool — single Bash is enough
#   4. (back in shell)      ls ~/.autopilot/payloads/
#   5. scripts/toggle-payload-capture.sh disable
#
# Wires capture-payload.js into 4 matchers with distinct markers:
#   PreToolUse  Bash      → pre-bash
#   PreToolUse  Read      → pre-read
#   PostToolUse Bash      → post-bash
#   PostToolUse .*        → post-star
#
# Why distinct markers: lets us cross-check whether `.*` matcher gets the
# same payload shape as specific matchers (relevant to BACKLOG bug 2-B).

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/toggle-payload-capture.js" "$@"
