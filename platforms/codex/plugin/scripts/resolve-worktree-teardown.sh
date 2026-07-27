#!/usr/bin/env bash
# resolve-worktree-teardown.sh — resolve the per-project worktree-teardown config → JSON.
# Single source of truth consulted by dispatch-hetero.sh (reap_worktree / --gc).
# Sibling of resolve-qc-gate.sh (same 4-level precedence chain).
#
# Usage:
#   scripts/resolve-worktree-teardown.sh                  # emit resolved config JSON
#   scripts/resolve-worktree-teardown.sh --field <key>    # emit just one field (raw)
#
# Order of precedence (first existing file wins):
#   1. $WORKTREE_TEARDOWN_CONFIG_OVERRIDE
#   2. $PWD/.claude/worktree-teardown-config.md       (consuming project's cwd)
#   3. $REPO_ROOT/.claude/worktree-teardown-config.md (autopilot's own repo, dogfood)
#   4. project-config-template/worktree-teardown-config.md  (shipped default)
#   5. Safe built-in defaults: teardown_hook="", stale_reaper_age_days=0,
#      reaper_scope=marker-only
#
# Output: JSON {teardown_hook, stale_reaper_age_days, reaper_scope,
#               max_leaf_worktrees_per_root, source}
#   teardown_hook        — path to project hook (empty = none); validated at exec time
#   stale_reaper_age_days — integer; 0 = --gc disabled (default)
#   reaper_scope         — marker-only (default); only marker-bearing worktrees are
#                          eligible for --gc (unmarked recovery is CLI --reap-unmarked)
#   source ∈ {override, project-cwd, project-repo, template, safe-default}
#
# Garbage / missing fields → safe defaults (hook empty, age 0, scope marker-only).
# Exit codes:
#   0  success (JSON or --field value on stdout) — data-mode always
#   2  usage / bad argument

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Safe built-in defaults (all-off seam)
DEF_HOOK=""
DEF_AGE="0"
DEF_SCOPE="marker-only"
DEF_MAX_LEAVES="4"

FIELD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --field) FIELD="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# shellcheck source=lib/json-emit.sh
. "$(dirname "$0")/lib/json-emit.sh"
# shellcheck source=lib/resolve-config.sh
. "$(dirname "$0")/lib/resolve-config.sh"

# --- locate the config file (4-tier -r ladder) ---
resolve_config_ladder "worktree-teardown-config.md" "WORKTREE_TEARDOWN_CONFIG_OVERRIDE" "safe-default"

HOOK="$(read_field "$CONFIG" teardown_hook "$DEF_HOOK" --whitespace-empty)"
AGE="$(read_field "$CONFIG" stale_reaper_age_days "$DEF_AGE" --whitespace-empty)"
SCOPE="$(read_field "$CONFIG" reaper_scope "$DEF_SCOPE" --whitespace-empty)"
MAX_LEAVES="$(read_field "$CONFIG" max_leaf_worktrees_per_root "$DEF_MAX_LEAVES" --whitespace-empty)"

# --- validate; fall back safe-default on garbage ---
# age: non-negative integer only
if ! [[ "$AGE" =~ ^[0-9]+$ ]]; then
  AGE="$DEF_AGE"
fi
# scope: allowlist
case "$SCOPE" in
  marker-only) ;;
  *) SCOPE="$DEF_SCOPE" ;;
esac
if ! [[ "$MAX_LEAVES" =~ ^[0-9]+$ ]] \
   || [ "$MAX_LEAVES" -lt 1 ] || [ "$MAX_LEAVES" -gt 32 ]; then
  MAX_LEAVES="$DEF_MAX_LEAVES"
fi
# hook: strip accidental surrounding quotes; reject control chars → empty
HOOK="${HOOK#\"}"; HOOK="${HOOK%\"}"
HOOK="${HOOK#\'}"; HOOK="${HOOK%\'}"
case "$HOOK" in
  *[[:cntrl:]]*) HOOK="$DEF_HOOK" ;;
esac

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    teardown_hook) printf '%s\n' "$HOOK" ;;
    stale_reaper_age_days) printf '%s\n' "$AGE" ;;
    reaper_scope) printf '%s\n' "$SCOPE" ;;
    max_leaf_worktrees_per_root) printf '%s\n' "$MAX_LEAVES" ;;
    source) printf '%s\n' "$SOURCE" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "teardown_hook": "%s", "stale_reaper_age_days": %s, "reaper_scope": "%s", "max_leaf_worktrees_per_root": %s, "source": "%s" }\n' \
  "$(json_escape "$HOOK")" "$AGE" "$SCOPE" "$MAX_LEAVES" "$SOURCE"
