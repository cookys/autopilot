#!/usr/bin/env bash
# resolve-worktree-teardown.sh — resolve the per-project worktree-teardown config → JSON.
# Single source of truth consulted by dispatch-hetero.sh (reap_worktree).
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
#   5. Safe built-in defaults: teardown_hook=""
#
# Output: JSON {teardown_hook, max_leaf_worktrees_per_root, source}
#   teardown_hook        — path to project hook (empty = none); validated at exec time
#   source ∈ {override, project-cwd, project-repo, template, safe-default}
#
# Garbage / missing fields → safe defaults (hook empty).
# Removed keys (stale_reaper_age_days, reaper_scope; removed at 3.0.0, BL-0115) present in the
# resolved config are rejected, not ignored.
# Exit codes:
#   0  success (JSON or --field value on stdout)
#   2  usage / bad argument / removed config key present

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Safe built-in defaults (all-off seam)
DEF_HOOK=""
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
MAX_LEAVES="$(read_field "$CONFIG" max_leaf_worktrees_per_root "$DEF_MAX_LEAVES" --whitespace-empty)"

# --- removed keys: reject loudly (no compat shim) ---
for _k in stale_reaper_age_days reaper_scope; do
  if [ -n "$CONFIG" ] && [ -r "$CONFIG" ] && grep -Eq "^[[:space:]]*[-*]?[[:space:]]*\`?${_k}\`?[[:space:]]*:" "$CONFIG"; then
    echo "error: '${_k}' in ${CONFIG} was removed at 3.0.0 (BL-0115) together with 'dispatch-hetero.sh --gc'; delete the line. The automatic reaper is 'node scripts/repo-residue-sweep.js reap --auto --yes' (run by the SessionStart hook)." >&2
    exit 2
  fi
done

# --- validate; fall back safe-default on garbage ---
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
    max_leaf_worktrees_per_root) printf '%s\n' "$MAX_LEAVES" ;;
    source) printf '%s\n' "$SOURCE" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "teardown_hook": "%s", "max_leaf_worktrees_per_root": %s, "source": "%s" }\n' \
  "$(json_escape "$HOOK")" "$MAX_LEAVES" "$SOURCE"
