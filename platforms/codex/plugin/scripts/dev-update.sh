#!/usr/bin/env bash
# dev-update.sh — pull the latest autopilot dev clone, then remind you to reload.
#
# Dev mode symlinks the plugin cache to this clone, so the entire update is
# `git pull` + `/reload-plugins`. This wrapper does the pull and prints the
# reload reminder (Claude Code, not a shell, owns /reload-plugins) plus a quick
# behind/ahead summary. It is the daily-update companion to dev-setup.sh.
#
# Usage:
#   cd ~/projects/autopilot && ./scripts/dev-update.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

if [[ ! -d .git ]]; then
  echo "Error: $REPO_DIR is not a git work tree — dev-update only applies to a dev-mode clone." >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
BEFORE="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"

echo "Pulling latest on $BRANCH (in $REPO_DIR)…"
git pull --ff-only

AFTER="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"

echo ""
if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "Already up to date ($AFTER) — nothing pulled."
  echo "(If a Claude Code session is still open on an older commit, run /reload-plugins to refresh it.)"
else
  echo "Updated $BEFORE → $AFTER."
  echo "Now run /reload-plugins in Claude Code to load the new version."
fi
