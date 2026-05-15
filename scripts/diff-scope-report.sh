#!/usr/bin/env bash
# diff-scope-report.sh — v1 scope-creep candidate filter.
# Consumed by autopilot:reviewer's Scope discipline scan (Surgical Changes).
# Replaces the per-hunk LLM "which sentence implements this hunk?" pass for
# the mechanically-detectable subset.
#
# v1 covers two signals (cheap, language-agnostic):
#   - whitespace_only_file: a file whose diff vs `git diff -w` is empty
#   - unrelated_to_message: a file path not mentioned in the commit message
#
# Not yet covered (need per-language regex — v2):
#   - comment_only_hunk
#   - quote_style_swap
#   - rename_outside_task_surface
#
# The reviewer still judges residual hunks. This script is a FILTER, not a
# verdict. Output JSON is consumed by autopilot:reviewer.
#
# Usage:
#   scripts/diff-scope-report.sh                            # staged diff
#   scripts/diff-scope-report.sh --range A..B               # commit range
#   scripts/diff-scope-report.sh --message-file path/to/msg # check file-vs-message
#
# Exit 0 always (this is a report, not a gate).

set -euo pipefail

MSG_FILE=""
RANGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message-file) MSG_FILE="$2"; shift 2 ;;
    --range)        RANGE="$2";   shift 2 ;;
    -h|--help)      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -n "$RANGE" ]]; then
  DIFF_ARGS=(--diff-filter=ACMR "$RANGE")
else
  DIFF_ARGS=(--cached --diff-filter=ACMR)
fi

# Files in normal diff but not in -w diff = whitespace-only changes
mapfile -t files_normal < <(git diff "${DIFF_ARGS[@]}" --name-only 2>/dev/null | sort -u)
mapfile -t files_nows   < <(git diff -w "${DIFF_ARGS[@]}" --name-only 2>/dev/null | sort -u)

ws_only=()
for f in "${files_normal[@]:-}"; do
  found=0
  for g in "${files_nows[@]:-}"; do
    [[ "$f" == "$g" ]] && { found=1; break; }
  done
  [[ $found -eq 0 ]] && ws_only+=("$f")
done

# Files not mentioned in commit message (basename OR full path substring)
unrelated=()
if [[ -n "$MSG_FILE" && -f "$MSG_FILE" ]]; then
  msg="$(cat "$MSG_FILE")"
  for f in "${files_normal[@]:-}"; do
    base="$(basename "$f")"
    if ! grep -qF "$base" <<< "$msg" && ! grep -qF "$f" <<< "$msg"; then
      unrelated+=("$f")
    fi
  done
fi

# Emit JSON
printf '{\n'
printf '  "version": "v1",\n'
printf '  "covered_signals": ["whitespace_only_file", "unrelated_to_message"],\n'
printf '  "not_yet_covered": ["comment_only_hunk", "quote_style_swap", "rename_outside_task_surface"],\n'
printf '  "findings": [\n'

first=1
emit() {
  local file="$1" signal="$2"
  [[ $first -eq 0 ]] && printf '    ,\n'
  first=0
  printf '    {"file":"%s","signal":"%s"}\n' "$file" "$signal"
}

for f in "${ws_only[@]:-}";   do [[ -n "$f" ]] && emit "$f" "whitespace_only_file"; done
for f in "${unrelated[@]:-}"; do [[ -n "$f" ]] && emit "$f" "unrelated_to_message"; done

printf '  ],\n'
printf '  "scanned_files": %d\n' "${#files_normal[@]}"
printf '}\n'
