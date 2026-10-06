#!/usr/bin/env bash
# dev-update.sh — pull the latest autopilot dev clone, then remind you to reload.
#
# Dev mode symlinks the plugin cache to this clone (and registers it as a
# directory marketplace), so the entire update is `git pull` + `/reload-plugins`. This wrapper does the pull and prints the
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

# Marketplace layer: dev mode needs a DIRECTORY marketplace at this repo, so
# there is no clone to pull (a github-sourced clone made the full plugin loader
# copy a stale versioned plugin dir — 2026-10-06). Warn-only; never fails the update.
if DOCTOR_OUT="$("$REPO_DIR/scripts/dev-setup.sh" --check --harness claude 2>&1)"; then :; fi
printf '%s\n' "$DOCTOR_OUT" | grep -E '^WARN +claude +(autopilot marketplace|versioned plugin cache)' >&2 || true

# Dispatch-runs retention. `dispatch-status.js --reap` existed, was documented as the owner
# of this cleanup by lib/prune-tmp-residue.sh, and had ZERO callers — 249 manifests spanning
# two weeks had accumulated by 2026-08-18. This is dev-update rather than per-dispatch on
# purpose: the reaper can also delete a failure-kept worktree (on a definitive dead-lock
# verdict + marker + free lock), which is exactly the class prune_tmp_residue refuses to
# touch, so it does not belong on a hot path. Advisory: never fails the update.
if REAP_OUT="$(node "$REPO_DIR/scripts/dispatch-status.js" --reap --days 7 2>/dev/null)"; then
  REAPED="$(printf '%s' "$REAP_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String((j.reaped_manifests||[]).length))}catch{process.stdout.write("0")}})' 2>/dev/null || echo 0)"
  [ "${REAPED:-0}" = "0" ] || echo "Reaped $REAPED stale dispatch-run manifests (>7d, not live)."
fi

echo ""
if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "Already up to date ($AFTER) — nothing pulled."
  echo "(If a Claude Code session is still open on an older commit, run /reload-plugins to refresh it.)"
else
  echo "Updated $BEFORE → $AFTER."
  echo "Now run /reload-plugins in Claude Code to load the new version."
fi
