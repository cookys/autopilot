#!/usr/bin/env bash
# install-hooks.sh — point git at .githooks/ for repo-tracked git hooks.
#
# Makes git run the scripts in .githooks/ on their git events (mode below):
#   - pre-commit : version/agent-body drift gate (blocks the commit on drift)
#   - pre-push   : qc-gate anti-skip forcing function — blocks/warns a push whose
#                  range touches a protected path without QC-Verdict evidence
#                  (strength per .claude/qc-gate-config.md → scripts/resolve-qc-gate.sh)
#   - post-merge : release-ritual advisory (prints merge SHA + preflight status
#                  when a merge lands on develop/main; never blocks, never commits)
#
# Why not .git/hooks/? Those aren't tracked. By committing hooks to .githooks/
# and pointing git at them, everyone who runs this script gets the same checks.
#
# Two install modes, chosen automatically:
#   - lab mode: the GLOBAL core.hooksPath is the lab hooks dir (it holds _lab_chain).
#     A local core.hooksPath would shadow lab's own commit audit, so this mode does
#     NOT set one (and unsets a stale local .githooks one). Instead it writes one
#     bridge per hook into <git-common-dir>/hooks/<name>, which lab chains to after
#     its own checks; each bridge execs .githooks/<name>. A pre-existing hook there
#     that is not our bridge (git-lfs, pre-commit framework, ...) is left alone and
#     reported, and the script exits 1.
#   - plain mode (no lab): sets the local `core.hooksPath .githooks`.
# Verify either mode with a negative control: stage a line naming a host and
# commit; the pre-commit leak-guard must block it.
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

# Ensure all hook scripts are executable
chmod +x .githooks/*

BRIDGE_MARK='# autopilot-githooks-bridge v1'
global_hp="$(git config --global --get core.hooksPath 2>/dev/null || true)"
case "$global_hp" in "~/"*) global_hp="$HOME/${global_hp#\~/}" ;; esac

if [ -n "$global_hp" ] && [ -f "$global_hp/_lab_chain" ]; then
  # lab mode
  if [ "$(git config --local --get core.hooksPath 2>/dev/null || true)" = ".githooks" ]; then
    git config --local --unset core.hooksPath
    echo "removed local core.hooksPath .githooks (it shadowed the lab hooks)"
  fi
  common="$(git rev-parse --git-common-dir)"
  mkdir -p "$common/hooks"
  skipped=0
  for src in .githooks/*; do
    [ -f "$src" ] || continue
    name="${src##*/}"
    dest="$common/hooks/$name"
    if [ -e "$dest" ] && ! grep -qF "$BRIDGE_MARK" "$dest"; then
      echo "SKIPPED: $dest exists and is not an autopilot bridge; .githooks/$name will NOT run" >&2
      skipped=1
      continue
    fi
    printf '#!/bin/sh\n%s\n# Lab chains to .git/hooks/<name>; run the repo-tracked hook from .githooks/.\nexec "$(git rev-parse --show-toplevel)/.githooks/%s" "$@"\n' "$BRIDGE_MARK" "$name" > "$dest"
    chmod 755 "$dest"
    echo "bridge: $dest -> .githooks/$name"
  done
  echo "installed (lab mode): global core.hooksPath = $global_hp, local core.hooksPath unset"
  [ "$skipped" -eq 0 ] || exit 1
else
  git config core.hooksPath .githooks
  echo "installed (plain mode): git core.hooksPath = $(git config core.hooksPath)"
fi

echo "hooks present: $(ls .githooks/ | tr '\n' ' ')"
echo ""
echo "verify: stage a line naming a host and commit; the pre-commit leak-guard must block it"
