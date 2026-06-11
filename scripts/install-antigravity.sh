#!/usr/bin/env bash
# install-antigravity.sh — register autopilot as an Antigravity (`agy`) plugin.
#
# verified-against: agy 1.0.1 empirical, 2026-05-29 (NOT the codelabs walkthrough —
# that described a loose ~/.gemini/antigravity/skills/ path which is NOT how agy's
# plugin mechanism works; see references/multi-agent-portability.md).
#
# Real agy plugin model (agy 1.0.1):
#   - `agy plugin validate <path>`  → reads ROOT plugin.json; reports skills/agents/hooks
#   - `agy plugin install <path>`   → imports the repo as a claude-code-source plugin
#                                      (reads .claude-plugin/plugin.json for source detection)
#   - `agy plugin list`             → shows the imports registry
#   - `agy plugin uninstall <name>` → removes it
#
# This script validates then installs. Idempotent-ish: if already imported,
# agy install re-imports (no error). Uninstall with: agy plugin uninstall autopilot
#
# DATA-LOSS GUARD (mechanism confirmed by sandboxed repro 2026-06-11; still
# present in agy 1.0.7): `agy plugin install` follows a symlinked destination
# `~/.gemini/config/plugins/<name>` — if that symlink points back at the source
# repo, the install self-copies and ZERO-TRUNCATES the source (open+truncate
# "dest" = the source itself, read back empty). 1497+ files destroyed in repro.
# See references/multi-agent-portability.md § "Verified by Spike (agy 1.0.5
# headless dispatch)". Guards below: the symlink check is NEVER bypassable;
# dirty/unpushed checks can be bypassed with --skip-git-checks (e.g. for a
# tarball source). --preflight-only runs the guards and exits (used by tests).
#
# Additionally, the install is EXPORT-THEN-INSTALL: agy is pointed at a
# sacrificial `git archive HEAD` export (no .git, no path back to the real
# checkout), never at the live repo — so even an installer bug we haven't
# guarded against cannot touch the working copy. --export-only creates the
# export, prints its path, and exits (test seam / manual inspection).

set -euo pipefail

REPO="${AUTOPILOT_REPO_OVERRIDE:-$(cd "$(dirname "$0")/.." && pwd)}"

PREFLIGHT_ONLY=0
SKIP_GIT_CHECKS=0
EXPORT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --preflight-only) PREFLIGHT_ONLY=1 ;;
    --skip-git-checks) SKIP_GIT_CHECKS=1 ;;
    --export-only) EXPORT_ONLY=1 ;;
    *) echo "ERROR: unknown argument: $arg (known: --preflight-only, --skip-git-checks, --export-only)" >&2; exit 1 ;;
  esac
done

PLUGIN_NAME="autopilot"
DEST="$HOME/.gemini/config/plugins/$PLUGIN_NAME"

# Guard 1 (NEVER bypassable): symlinked destination = confirmed kill condition.
if [ -L "$DEST" ]; then
  echo "ERROR: $DEST is a SYMLINK (-> $(readlink "$DEST"))." >&2
  echo "       agy plugin install follows it and self-copy-truncates the TARGET" >&2
  echo "       (confirmed data-loss bug, agy <= 1.0.7). Refusing to proceed." >&2
  echo "       Inspect the link target, then remove the symlink itself:" >&2
  echo "         rm $DEST    # removes the link only, never the target" >&2
  exit 1
fi

# Guards 2+3 (bypassable with --skip-git-checks): the install copies this repo
# wholesale; if anything goes wrong, recovery = restore from git. So require a
# clean, fully-pushed state — or better, run from a sacrificial clone:
#   git clone <repo> /tmp/autopilot-install && /tmp/autopilot-install/scripts/install-antigravity.sh
if [ "$SKIP_GIT_CHECKS" = "0" ]; then
  if ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: $REPO is not a git repository — cannot verify it is recoverable." >&2
    echo "       Use --skip-git-checks only if you accept the risk." >&2
    exit 1
  fi
  if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
    echo "ERROR: $REPO has uncommitted changes. Commit/stash first (recovery from" >&2
    echo "       the 2026-06-11 incident was only possible because everything was" >&2
    echo "       committed and pushed), or install from a sacrificial clone." >&2
    exit 1
  fi
  if [ -n "$(git -C "$REPO" log --branches --not --remotes --oneline 2>/dev/null | head -1)" ]; then
    echo "ERROR: $REPO has unpushed commits. Push first, or install from a" >&2
    echo "       sacrificial clone (--skip-git-checks to override)." >&2
    exit 1
  fi
fi

if [ "$PREFLIGHT_ONLY" = "1" ]; then
  echo "preflight OK: dest is not a symlink; repo state safe."
  exit 0
fi

if [ "$EXPORT_ONLY" = "0" ] && ! command -v agy >/dev/null 2>&1; then
  echo "ERROR: agy (Antigravity CLI) not found on PATH." >&2
  echo "       Install Antigravity first: https://antigravity.google/" >&2
  exit 1
fi

# Root plugin.json is required by `agy plugin validate` (verified: removing it
# yields 'Error: missing plugin.json'). Fail early with a clear message.
if [ ! -f "$REPO/plugin.json" ]; then
  echo "ERROR: $REPO/plugin.json missing — agy validate requires the root manifest." >&2
  echo "       Run: node scripts/sync-version.js --check  (and re-sync if it reports drift)" >&2
  exit 1
fi

# --- export-then-install: never hand agy the live repo ---
# agy is pointed at a sacrificial `git archive` export (no .git, no path back
# to the real checkout), so even an unguarded-against installer state cannot
# touch the working repo. Falls back to direct install only for a non-git
# source under --skip-git-checks (export impossible there).
SRC="$REPO"
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  EXPORT_DIR="$(mktemp -d -t autopilot-agy-export-XXXXXX)"
  git -C "$REPO" archive HEAD | tar -x -C "$EXPORT_DIR"
  SRC="$EXPORT_DIR"
  echo "export: installing from sacrificial copy $SRC (HEAD of $REPO, no .git)"
else
  echo "WARNING: non-git source — installing directly from $REPO (no export possible)." >&2
fi

if [ "$EXPORT_ONLY" = "1" ]; then
  echo "$SRC"
  exit 0
fi

echo "== validate =="
agy plugin validate "$SRC"

echo ""
echo "== install =="
agy plugin install "$SRC"

[ "$SRC" != "$REPO" ] && rm -rf "$SRC"

echo ""
echo "== verify =="
agy plugin list
echo ""
echo "autopilot registered as an agy plugin. To remove: agy plugin uninstall autopilot"
