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
#
# An empty collect (no transcript under HOME, the target, or the codex home)
# must not replace a non-empty summary.json / usage-sessions.json when HOME's
# transcript dir ($HOME/.claude/projects) does not exist. That is the fake-HOME
# case: codeforge would write 0 rows over the live dir it actually resolves
# (a non-tmpfs AUTOPILOT_LIVE_DIR is ignored, same as codeforge). One stderr
# line, no paths. A real zero after that transcript dir exists still collects.

# fstype of dir, or of its nearest existing ancestor. findmnt's full stdout
# (trimmed) wins; a multi-line answer is kept so it does not equal "tmpfs".
# Otherwise the longest matching prefix in /proc/mounts.
_cf_fstype() {
  local p="$1" fs
  [ -n "$p" ] || return 1
  while [ ! -e "$p" ]; do
    [ "$p" = "/" ] && break
    p="$(dirname -- "$p")"
  done
  if fs="$(findmnt -T "$p" -o FSTYPE -n 2>/dev/null)"; then
    fs="${fs#"${fs%%[![:space:]]*}"}"
    fs="${fs%"${fs##*[![:space:]]}"}"
    if [ -n "$fs" ]; then
      printf '%s' "$fs"
      return 0
    fi
  fi
  awk -v target="$p" '
    {
      mp = $2; fs = $3
      gsub(/\\040/, " ", mp)
      n = length(mp)
      if (n < 1) next
      if (index(target, mp) != 1) next
      if (target != mp && substr(target, n + 1, 1) != "/") next
      if (n > best) { best = n; out = fs }
    }
    END { if (best > 0) print out }
  ' /proc/mounts
}

_cf_is_ram() {
  local fs
  fs="$(_cf_fstype "$1")" || return 1
  [ "$fs" = tmpfs ] || [ "$fs" = ramfs ]
}

# codeforge resolve_live_base order. A candidate counts only on tmpfs/ramfs.
_cf_resolve_live_base() {
  local uid dir
  uid="$(id -u)"
  if [ -n "${AUTOPILOT_LIVE_DIR:-}" ] && _cf_is_ram "${AUTOPILOT_LIVE_DIR}"; then
    printf '%s\n' "${AUTOPILOT_LIVE_DIR}"
    return 0
  fi
  if [ -n "${XDG_RUNTIME_DIR:-}" ] && _cf_is_ram "${XDG_RUNTIME_DIR}/autopilot"; then
    printf '%s\n' "${XDG_RUNTIME_DIR}/autopilot"
    return 0
  fi
  dir="/dev/shm/autopilot-${uid}"
  if _cf_is_ram "$dir"; then
    printf '%s\n' "$dir"
    return 0
  fi
  dir="/tmp/autopilot-${uid}"
  if _cf_is_ram "$dir"; then
    printf '%s\n' "$dir"
    return 0
  fi
  if [ -n "${HOME:-}" ]; then
    printf '%s\n' "${HOME}/.autopilot"
  else
    printf '%s\n' ".autopilot"
  fi
}

_cf_has_claude_jsonl() {
  local root="$1"
  [ -n "$root" ] && [ -d "$root/projects" ] || return 1
  find -P "$root/projects" -type f -name '*.jsonl' -print -quit 2>/dev/null | grep -q .
}

_cf_has_codex_jsonl() {
  local root="$1"
  [ -n "$root" ] && [ -d "$root/sessions" ] || return 1
  find -P "$root/sessions" -type f -name 'rollout-*.jsonl' -print -quit 2>/dev/null | grep -q .
}

# 0 when this collect would add no transcript. 1 when HOME's transcript dir
# exists (a real zero is allowed) or any scanned root has a transcript file.
_cf_collect_would_be_empty() {
  local real="$1" codex
  if [ -n "${HOME:-}" ] && [ -d "$HOME/.claude/projects" ]; then
    return 1
  fi
  _cf_has_claude_jsonl "$real" && return 1
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
    _cf_has_claude_jsonl "$CLAUDE_CONFIG_DIR" && return 1
  fi
  if [ -n "${HOME:-}" ]; then
    _cf_has_claude_jsonl "$HOME/.claude" && return 1
  fi
  codex="${CODEX_HOME:-}"
  if [ -z "$codex" ] && [ -n "${HOME:-}" ]; then
    codex="$HOME/.codex"
  fi
  _cf_has_codex_jsonl "$codex" && return 1
  return 0
}

# 0 when summary days, summary codex_sessions, or usage-sessions rows is a
# non-empty array, or a present file is not readable as that JSON. 1 when
# both files are absent or every present array has length 0.
_cf_usage_nonempty() {
  local dir="$1/codeforge/usage"
  local s="$dir/summary.json" u="$dir/usage-sessions.json" out days codex rows
  [ -e "$s" ] || [ -e "$u" ] || return 1
  out="$(python3 -c '
import json, sys
def length(path, key):
    try:
        with open(path, "r", encoding="utf-8") as f:
            j = json.load(f)
    except FileNotFoundError:
        return "0"
    except Exception:
        return "bad"
    if not isinstance(j, dict):
        return "bad"
    if key not in j:
        return "0"
    v = j[key]
    if not isinstance(v, list):
        return "bad"
    return str(len(v))
s, u = sys.argv[1], sys.argv[2]
print(length(s, "days"), length(s, "codex_sessions"), length(u, "rows"))
' "$s" "$u" 2>/dev/null)" || out="bad bad bad"
  read -r days codex rows <<EOF
$out
EOF
  case "$days $codex $rows" in
    *bad*) return 0 ;;
  esac
  [ "${days:-0}" -gt 0 ] 2>/dev/null && return 0
  [ "${codex:-0}" -gt 0 ] 2>/dev/null && return 0
  [ "${rows:-0}" -gt 0 ] 2>/dev/null && return 0
  return 1
}

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
  if _cf_collect_would_be_empty "$real"; then
    if _cf_usage_nonempty "$(_cf_resolve_live_base)"; then
      echo "codeforge-collect: skipped empty collect; transcript dir missing, leaving non-empty usage in place" >&2
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
