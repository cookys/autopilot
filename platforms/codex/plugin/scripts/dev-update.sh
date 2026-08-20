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

# Also refresh the Claude Code marketplace clone — session start resolves the
# plugin VERSION from its catalog, so leaving it stale silently loads an old
# skill set even with the dev symlink + registry correct (2026-07-17 lesson:
# a 6/4-frozen clone fed 2.17.2 to a session on a 2.32.46 repo). Best-effort:
# a dirty/absent clone warns but never fails the repo update.
MKT_DIR="$HOME/.claude/plugins/marketplaces/autopilot"
if [[ -d "$MKT_DIR/.git" ]]; then
  if git -C "$MKT_DIR" diff --quiet && git -C "$MKT_DIR" diff --cached --quiet; then
    if git -C "$MKT_DIR" pull --ff-only >/dev/null 2>&1; then
      echo "Marketplace clone refreshed ($(git -C "$MKT_DIR" rev-parse --short HEAD))."
    else
      echo "WARN: marketplace clone pull failed ($MKT_DIR) — session start may resolve a stale version." >&2
    fi
  else
    echo "WARN: marketplace clone has local changes ($MKT_DIR) — not pulled; clean it or session start may resolve a stale version." >&2
  fi
else
  echo "(No Claude Code marketplace clone at $MKT_DIR — skipping that layer.)"
fi

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
