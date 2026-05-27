#!/usr/bin/env bash
# install-antigravity.sh — link autopilot's skills/ into the user's global
# Antigravity skill directory so `agy` discovers them.
#
# verified-against: codelabs walkthrough 2026-05-22; antigravity.google/docs/skills
# Path is from a Google codelabs tutorial, not a stable spec — re-verify
# with `agy --version` if Google updates the CLI.
#
# What this does:
#   1. Locate user's Antigravity skills root: ~/.gemini/antigravity/skills/
#   2. Symlink autopilot/skills → <skills-root>/autopilot
#
# Idempotent: if the symlink already points to autopilot, exits 0 with a
# no-op message. If the destination exists but is something else, exits 2
# without touching it.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -s)" in
  Linux|Darwin) ;;
  *)
    echo "ERROR: this is the POSIX installer; for Windows use install-antigravity.ps1" >&2
    exit 1
    ;;
esac

DEST_ROOT="$HOME/.gemini/antigravity/skills"
LINK="$DEST_ROOT/autopilot"
TARGET="$REPO/skills"

mkdir -p "$DEST_ROOT"

if [ -L "$LINK" ]; then
  current="$(readlink "$LINK")"
  if [ "$current" = "$TARGET" ]; then
    echo "OK: already installed ($LINK -> $TARGET)"
    exit 0
  fi
  echo "ERROR: $LINK is a symlink to '$current' (expected '$TARGET')" >&2
  echo "       Remove it manually if you want this installer to overwrite." >&2
  exit 2
elif [ -e "$LINK" ]; then
  echo "ERROR: $LINK exists and is not a symlink" >&2
  echo "       Remove it manually if you want this installer to overwrite." >&2
  exit 2
fi

ln -s "$TARGET" "$LINK"
echo "installed: $LINK -> $TARGET"
echo ""
echo "verify (if agy is installed):"
echo "  agy skills list 2>/dev/null | grep -E 'autopilot|finish-flow|dev-flow'"
