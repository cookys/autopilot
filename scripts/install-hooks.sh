#!/usr/bin/env bash
# install-hooks.sh — point git at .githooks/ for repo-tracked pre-commit gates.
#
# Sets `git config core.hooksPath .githooks` (local to this clone) so the
# pre-commit script in .githooks/ runs on every commit.
#
# Why not .git/hooks/? Those aren't tracked. By committing hooks to .githooks/
# and setting core.hooksPath, everyone who runs this script gets the same
# pre-commit checks.
#
# Required git version: 2.9+ (for core.hooksPath support).
#
# Usage:
#   ./scripts/install-hooks.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# Require git 2.9+ for core.hooksPath
git_version=$(git --version | awk '{print $3}')
git_major=$(echo "$git_version" | cut -d. -f1)
git_minor=$(echo "$git_version" | cut -d. -f2)
if [ "$git_major" -lt 2 ] || { [ "$git_major" -eq 2 ] && [ "$git_minor" -lt 9 ]; }; then
  echo "ERROR: git $git_version too old; requires 2.9+ for core.hooksPath" >&2
  exit 1
fi

git config core.hooksPath .githooks

# Ensure all hook scripts are executable
chmod +x .githooks/*

current=$(git config core.hooksPath)
echo "installed: git core.hooksPath = $current"
echo "hooks present: $(ls .githooks/ | tr '\n' ' ')"
echo ""
echo "verify: a no-op commit will run the pre-commit gate"
echo "  git commit --allow-empty -m test  # should run sync-version.js --check"
