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

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hooks"
HOOKS_JSON="$HOOK_DIR/hooks.json"
BACKUP="$HOOK_DIR/hooks.json.capture-backup"

case "${1:-status}" in
  enable)
    if [ -f "$BACKUP" ]; then
      echo "ERROR: capture mode already enabled ($BACKUP exists)." >&2
      echo "  Run 'disable' first, or delete the backup manually." >&2
      exit 1
    fi
    cp "$HOOKS_JSON" "$BACKUP"
    jq '
      .hooks.PreToolUse |= map(
        if .matcher == "Bash" then
          .hooks += [{"type":"command","command":"node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js pre-bash"}]
        elif .matcher == "Read" then
          .hooks += [{"type":"command","command":"node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js pre-read"}]
        else . end
      ) |
      .hooks.PostToolUse |= map(
        if .matcher == "Bash" then
          .hooks += [{"type":"command","command":"node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js post-bash"}]
        elif .matcher == ".*" then
          .hooks += [{"type":"command","command":"node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js post-star"}]
        else . end
      )
    ' "$BACKUP" > "$HOOKS_JSON"
    echo "ENABLED — hooks.json wired with capture-payload entries."
    echo ""
    echo "Next: open a NEW terminal and run:"
    echo "  AUTOPILOT_CAPTURE_PAYLOAD=1 claude"
    echo "Then in fresh claude, run any tool. Captures land at:"
    echo "  ~/.autopilot/payloads/<ts>-<pid>-<marker>.json"
    echo ""
    echo "Done? Run: $0 disable"
    ;;

  disable)
    if [ ! -f "$BACKUP" ]; then
      echo "ERROR: no backup found ($BACKUP) — nothing to restore." >&2
      exit 1
    fi
    mv "$BACKUP" "$HOOKS_JSON"
    echo "DISABLED — hooks.json restored from backup."
    ;;

  status)
    if [ -f "$BACKUP" ]; then
      echo "Capture mode: ENABLED"
      echo "Backup at: $BACKUP"
      echo "Payloads:  ~/.autopilot/payloads/"
      ls -la ~/.autopilot/payloads/ 2>/dev/null || echo "  (no captures yet)"
    else
      echo "Capture mode: DISABLED"
    fi
    ;;

  *)
    echo "Usage: $0 enable|disable|status" >&2
    exit 1
    ;;
esac
