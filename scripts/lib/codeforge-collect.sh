#!/usr/bin/env bash
# codeforge_collect_claude_dir <dir>
#
# One best-effort `codeforge usage collect` for a throwaway CLAUDE_CONFIG_DIR,
# after the claude child has exited and before that directory is removed.
# Always returns 0 so a caller under `set -e` keeps its own exit status.
#
# Skips (no log) when AUTOPILOT_CODEFORGE_COLLECT=off, the argument is empty,
# realpath cannot resolve it, or the resolved path is the caller's real
# $HOME/.claude. A missing `codeforge` or a non-zero collect logs one stderr
# line and continues. Never passes --quiet, CODEFORGE_DATA_DIR, or account args.
# Any symlink in the path is resolved first: codeforge silently skips a path
# that still contains one.

codeforge_collect_claude_dir() {
  local dir="${1:-}" real home_claude
  [ "${AUTOPILOT_CODEFORGE_COLLECT:-}" = "off" ] && return 0
  [ -n "$dir" ] || return 0
  real="$(realpath -- "$dir" 2>/dev/null)" || return 0
  if [ -n "${HOME:-}" ]; then
    home_claude="$(realpath -- "$HOME/.claude" 2>/dev/null)" || home_claude=""
    if [ -n "$home_claude" ] && [ "$real" = "$home_claude" ]; then
      return 0
    fi
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
