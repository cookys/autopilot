# shellcheck shell=bash
# resolve-config.sh — sourceable 4-tier config ladder + markdown field parser.
# No side effects at source time; functions only. Double-source is a no-op.
#
# Provides:
#   resolve_config_ladder <config_basename> <override_env_var_NAME> <no_config_source_label>
#     Sets caller-scope globals CONFIG and SOURCE. Ladder (-r each tier, first match):
#       1. ${!override_env_var_NAME} if non-empty and -r  → SOURCE=override
#       2. $PWD/.claude/<basename> (-r)                   → SOURCE=project-cwd
#       3. $REPO_ROOT/.claude/<basename> (-r)             → SOURCE=project-repo
#          (only if git toplevel of $PWD == $REPO_ROOT; else skip to 4)
#       4. $REPO_ROOT/project-config-template/<basename>  → SOURCE=template
#       5. none → CONFIG="", SOURCE=<no_config_source_label>
#     Uses caller-scope $PWD and $REPO_ROOT (no extra parameters).
#     Tier 3 is dogfood-only: it fires only when the git toplevel of $PWD is the
#     same directory as $REPO_ROOT. An installed plugin ships `.claude/`; a
#     foreign repo must never inherit the roster or stale_reaper_age_days: 14.
#
#   read_field <config_path> <key> <default> [--whitespace-empty]
#     Case-insensitive `key: value` / `- key: value` extraction; strip trailing
#     whitespace. Empty path / unreadable → default.
#     Default empty check: [[ -z "$val" ]]. With --whitespace-empty, whitespace-only
#     also falls back to default (worktree-teardown semantics).

[ -n "${_AUTOPILOT_RESOLVE_CONFIG_SH:-}" ] && return 0
_AUTOPILOT_RESOLVE_CONFIG_SH=1

# resolve_config_ladder <config_basename> <override_env_var_NAME> <no_config_source_label>
resolve_config_ladder() {
  local basename="$1"
  local override_var="$2"
  local no_config_label="$3"
  local override_val=""

  CONFIG=""
  SOURCE="$no_config_label"

  # Indirect expansion by NAME — never eval. Empty/unset → fall through.
  if [ -n "$override_var" ]; then
    override_val="${!override_var-}"
  fi

  if [[ -n "$override_val" && -r "$override_val" ]]; then
    CONFIG="$override_val"
    SOURCE="override"
  elif [[ -r "$PWD/.claude/${basename}" ]]; then
    CONFIG="$PWD/.claude/${basename}"
    SOURCE="project-cwd"
  else
    # Tier 3 is dogfood-only. Compute both sides with git toplevel + realpath
    # (pwd -P). If $PWD is not inside a git checkout, or the two differ, skip
    # to tier 4. Label stays project-repo: it is now truly the project's repo.
    _pwd_top="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)" || _pwd_top=""
    _repo_real=""
    _pwd_real=""
    if [[ -n "$REPO_ROOT" ]]; then
      _repo_real="$(cd "$REPO_ROOT" && pwd -P 2>/dev/null)" || _repo_real=""
    fi
    if [[ -n "$_pwd_top" ]]; then
      _pwd_real="$(cd "$_pwd_top" && pwd -P 2>/dev/null)" || _pwd_real=""
    fi
    if [[ -n "$_pwd_real" && -n "$_repo_real" && "$_pwd_real" == "$_repo_real" && -r "$REPO_ROOT/.claude/${basename}" ]]; then
      CONFIG="$REPO_ROOT/.claude/${basename}"
      SOURCE="project-repo"
    elif [[ -r "$REPO_ROOT/project-config-template/${basename}" ]]; then
      CONFIG="$REPO_ROOT/project-config-template/${basename}"
      SOURCE="template"
    else
      # Caller-scope globals (intentionally assigned for the resolve-*.sh consumers).
      # shellcheck disable=SC2034
      CONFIG=""
      # shellcheck disable=SC2034
      SOURCE="$no_config_label"
    fi
  fi
}

# read_field <config_path> <key> <default> [--whitespace-empty]
read_field() {
  local config_path="$1" key="$2" def="$3" flag="${4:-}"
  local val=""

  if [[ -n "$config_path" && -r "$config_path" ]]; then
    val="$(grep -iE "^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:" "$config_path" 2>/dev/null \
            | head -1 | sed -E "s/^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:[[:space:]]*//I" \
            | sed -E 's/[[:space:]]+$//')"
  fi

  if [[ "$flag" == "--whitespace-empty" ]]; then
    # empty / whitespace-only → default (worktree-teardown semantics)
    if [[ -z "${val//[[:space:]]/}" ]]; then
      val="$def"
    fi
  else
    [[ -z "$val" ]] && val="$def"
  fi
  printf '%s' "$val"
}
