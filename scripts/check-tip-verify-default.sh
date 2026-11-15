#!/usr/bin/env bash
# check-tip-verify-default.sh — does each repo have a default tip-verify command?
#
# For each <repo-dir>[@<ref>] (ref defaults to HEAD), read
# .claude/quality-gate-config.md at that ref with `git show` and pass the bytes
# through scripts/lib/tip-verify-repo-default.js. The repo name is the basename
# of `git remote get-url origin` minus a trailing .git, else the toplevel
# directory basename (the same rule as dispatch-hetero.sh).
#
# One stdout line per argument:
#   OK <repo> <json-array>
#   NONE <repo> <reason>
# reason is one word: not-a-repo, bad-ref, missing-config, no-command, reader-error.
# A <word> placeholder is not a command (no-command when nothing else remains).
# A whole line that is one inline span is a command. Exit 0 when every repo is
# OK, 1 otherwise.
#
# --update-grace removes from scripts/lib/tip-verify-grace.json (next to this
# script) every listed repo that printed OK. It never adds an entry. After the
# edit it prints `remaining <N>`. A missing grace file stays missing and the
# count is 0. Unlisted names are left as they are.
#
# --help prints usage only.
#
# Usage: check-tip-verify-default.sh [--update-grace] <repo-dir>[@<ref>] ...
# Exit: 0 all OK · 1 any NONE, bad grace file, or no repo argument.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
READER="$SCRIPT_DIR/lib/tip-verify-repo-default.js"
GRACE="$SCRIPT_DIR/lib/tip-verify-grace.json"
USAGE='usage: check-tip-verify-default.sh [--update-grace] <repo-dir>[@<ref>] ...'

update=0
specs=()
for a in "$@"; do
  case "$a" in
    --help|-h) printf '%s\n' "$USAGE"; exit 0 ;;
    --update-grace) update=1 ;;
    --) ;;
    -*) printf '%s\n' "$USAGE" >&2; exit 1 ;;
    *) specs+=("$a") ;;
  esac
done
if [ "${#specs[@]}" -eq 0 ]; then
  printf '%s\n' "$USAGE" >&2
  exit 1
fi

trap 'rm -f "${tmp:-}"' EXIT
tmp="$(mktemp)"

rc=0
ok=()
for spec in "${specs[@]}"; do
  dir="$spec"
  ref="HEAD"
  if [ ! -d "$dir" ] && [[ "$spec" == *@* ]]; then
    dir="${spec%@*}"
    ref="${spec##*@}"
  fi
  url="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)"
  name="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.repoName(process.argv[2] || "", process.argv[3] || ""))' \
    "$READER" "$url" "$top" 2>/dev/null || true)"
  if [ -z "$name" ]; then
    name="$(basename "$dir")"
  fi
  if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf 'NONE %s %s\n' "$name" "not-a-repo"
    rc=1
    continue
  fi
  if [ -z "$ref" ] || ! git -C "$dir" rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
    printf 'NONE %s %s\n' "$name" "bad-ref"
    rc=1
    continue
  fi
  if ! git -C "$dir" show "${ref}:.claude/quality-gate-config.md" >"$tmp" 2>/dev/null; then
    printf 'NONE %s %s\n' "$name" "missing-config"
    rc=1
    continue
  fi
  json="$(node "$READER" "$tmp")" || {
    printf 'NONE %s %s\n' "$name" "reader-error"
    rc=1
    continue
  }
  if [ -z "$json" ] || [ "$json" = "[]" ]; then
    printf 'NONE %s %s\n' "$name" "no-command"
    rc=1
    continue
  fi
  printf 'OK %s %s\n' "$name" "$json"
  ok+=("$name")
done

if [ "$update" -eq 1 ]; then
  rem="$(node -e 'const m=require(process.argv[1]); process.stdout.write(String(m.removeFromGrace(process.argv[2], process.argv.slice(3))))' \
    "$READER" "$GRACE" ${ok[@]+"${ok[@]}"} )" || {
    printf '%s\n' 'check-tip-verify-default: grace file is not a repos list' >&2
    exit 1
  }
  printf 'remaining %s\n' "$rem"
fi
exit "$rc"
