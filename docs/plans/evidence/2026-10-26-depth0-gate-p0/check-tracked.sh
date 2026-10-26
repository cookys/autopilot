#!/usr/bin/env bash
# check-tracked.sh [--selftest] : every file listed in sums.txt (paths relative to raw/) must be tracked by git,
# and `git status --ignored` for this directory must list nothing ignored. A global `*.jsonl` ignore once kept 16 raw
# files out of a commit; this check exists so that cannot pass again.
#   --selftest : negative control in a throwaway repo (ignored+untracked file must fail, after `git add -f` must pass).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check() { # <evidence dir>
  local d="$1" bad=0 p
  while read -r _ p; do
    [ -n "$p" ] || continue
    git -C "$d" ls-files --error-unmatch -- "raw/$p" > /dev/null 2>&1 || { echo "UNTRACKED: raw/$p"; bad=1; }
  done < "$d/sums.txt"
  local ign; ign="$(git -C "$d" status --ignored --porcelain -- . | grep '^!!' || true)"
  [ -z "$ign" ] || { echo "IGNORED FILES:"; echo "$ign"; bad=1; }
  return $bad
}
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)"; git -C "$T" init -q; mkdir -p "$T/ev/raw"; echo '*.jsonl' > "$T/.gitignore"
  echo x > "$T/ev/raw/hook.jsonl"; (cd "$T/ev/raw" && sha256sum hook.jsonl) > "$T/ev/sums.txt"
  if check "$T/ev" > /dev/null 2>&1; then echo "SELFTEST FAIL: ignored untracked file passed"; rm -rf "$T"; exit 1; fi
  echo "red ok: ignored untracked file rejected"
  git -C "$T" add -f ev/raw/hook.jsonl
  # still listed as ignored? (tracked files are not shown as ignored)
  check "$T/ev" > /dev/null 2>&1 || { echo "SELFTEST FAIL: tracked file rejected"; rm -rf "$T"; exit 1; }
  echo "green ok: force-added file accepted"; rm -rf "$T"; exit 0
fi
check "$HERE" && echo "all sums.txt files tracked, nothing ignored"
