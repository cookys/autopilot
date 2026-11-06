#!/usr/bin/env bash
# scratch-closeout.sh - depth-0 closeout step: reap clean, merged scratch worktrees (never from a hook).
# Usage: scratch-closeout.sh --root DIR --repo MAIN [--keep lane1,lane2] [--warn-gb N]
# Runs `reap-scratch-checkouts.js --apply`. Call it after a merge is pushed and after a full-suite run ends.
# --keep = names (top-level entries of DIR) of lanes still in flight; depth-0 builds it from its open lanes.
# Only clean worktrees whose HEAD is reachable from a main-repo ref are removed; dirty, clone, plain: untouched.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/reap-scratch-checkouts.js" "$@" --apply
