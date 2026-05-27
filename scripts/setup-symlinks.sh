#!/usr/bin/env bash
# setup-symlinks.sh — ensure repo-tracked symlinks exist and point correctly.
#
# Required because git tracks symlinks as symlinks ONLY on systems where
# `core.symlinks=true` (Linux/macOS/WSL default; Windows requires Dev Mode +
# `git config --global core.symlinks=true` BEFORE clone). When a Windows user
# clones without that, symlinks become plain text files containing the target
# path — worse than missing because tools try to read them as content.
#
# This script:
# 1. Detects existing entries (symlink? plain file? missing?)
# 2. Recreates symlinks where targets differ or entries are not symlinks
# 3. Is idempotent — safe to re-run
#
# Called automatically by scripts/dev-setup.sh; can be run manually after
# clone on any platform.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# Format: "<link path relative to repo>:<target relative to link's parent>"
declare -a LINKS=(
  ".agents/skills:../skills"   # cross-agent intersection path (Codex + Antigravity + OpenCode native)
)

for entry in "${LINKS[@]}"; do
  link="${entry%%:*}"
  target="${entry##*:}"
  link_dir="$(dirname "$link")"
  mkdir -p "$link_dir"

  if [ -L "$link" ]; then
    current="$(readlink "$link")"
    if [ "$current" = "$target" ]; then
      echo "OK   $link -> $target (already correct)"
      continue
    fi
    echo "FIX  $link: stale symlink ($current -> $target)"
    rm "$link"
  elif [ -e "$link" ]; then
    # Plain file or directory — Windows non-Dev-Mode artifact, or user override.
    echo "WARN $link exists as $(file -b "$link"); replacing with symlink" >&2
    rm -rf "$link"
  else
    echo "NEW  $link -> $target"
  fi

  ln -s "$target" "$link"
done

echo ""
echo "verify: readlink .agents/skills    # should print '../skills'"
