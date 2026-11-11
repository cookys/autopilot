#!/usr/bin/env bash
# codeforge_collect_claude_dir <dir>
#
# One best-effort `codeforge usage collect` for a throwaway CLAUDE_CONFIG_DIR,
# after the claude child has exited and before that directory is removed.
# Always returns 0 so a caller under `set -e` keeps its own exit status.
#
# Skips (no log) when AUTOPILOT_CODEFORGE_COLLECT=off, the argument is empty,
# the directory does not exist, realpath cannot resolve it, the resolved path
# is the caller's real $HOME/.claude, or this process already collected that
# real path. A missing `codeforge` or a non-zero collect logs one stderr
# line and continues. Never passes --quiet, CODEFORGE_DATA_DIR, or account args.
# Any symlink in the path is resolved first: codeforge silently skips a path
# that still contains one.

codeforge_collect_claude_dir() {
  local dir="${1:-}" real home_claude
  [ "${AUTOPILOT_CODEFORGE_COLLECT:-}" = "off" ] && return 0
  [ -n "$dir" ] || return 0
  # GNU realpath without -e still prints a missing child whose parent exists.
  [ -d "$dir" ] || return 0
  real="$(realpath -- "$dir" 2>/dev/null)" || return 0
  if [ -n "${HOME:-}" ]; then
    home_claude="$(realpath -- "$HOME/.claude" 2>/dev/null)" || home_claude=""
    if [ -n "$home_claude" ] && [ "$real" = "$home_claude" ]; then
      return 0
    fi
  fi
  # One attempt per real path in this process, including a failed attempt.
  if [ -n "${_CODEFORGE_COLLECTED_REAL:-}" ] && printf '%s\n' "$_CODEFORGE_COLLECTED_REAL" | grep -Fxq -- "$real"; then
    return 0
  fi
  if [ -n "${_CODEFORGE_COLLECTED_REAL:-}" ]; then
    _CODEFORGE_COLLECTED_REAL="${_CODEFORGE_COLLECTED_REAL}
${real}"
  else
    _CODEFORGE_COLLECTED_REAL="$real"
  fi
  if ! command -v codeforge >/dev/null 2>&1; then
    echo "codeforge-collect: codeforge not on PATH" >&2
    return 0
  fi
  # A parent CODEFORGE_DATA_DIR must not steer this invocation.
  if ! env -u CODEFORGE_DATA_DIR codeforge usage collect --claude-dir "$real" >/dev/null 2>&1; then
    echo "codeforge-collect: usage collect failed" >&2
  fi
  return 0
}
