#!/usr/bin/env bash
# post-merge-suite.sh — full affected run after a merge. Start it in the background; it never pushes or reverts.
#
# Usage:
#   scripts/post-merge-suite.sh --merged <sha> --base <sha> --notify <fleet address> [--out <dir>]
#
# In a detached worktree of <merged>, runs
#   node scripts/affected-suites.js --base <base> --head <merged> --run --jobs <nproc/2>
# (the copy inside that worktree when it exists, otherwise this repo's script with --root).
# Every red is rerun once, alone, in a detached worktree of <base>. A red that is green on base
# (or absent there) is NEW. Writes <out>/post-merge.json:
#   {merged, base, selected, red, new_red:[paths], wall_s}
# When new_red is non-empty, runs
#   fleet send <notify> "post-merge NEW red on <short>: <paths>; revert with git revert -m 1 <merged>"
# If the fleet binary is not on PATH, prints that line and exits 4.
# Exit: 0 no new red, 1 new red, 2 usage or a run that produced no rc lines, 4 fleet absent.
# Contract: this header. Called by the lane right after a merge (CLAUDE.md Process rules).

set -u

MERGED= BASE= NOTIFY= OUT=
while [ $# -gt 0 ]; do
  case "$1" in
    --merged) MERGED=${2:-}; shift 2 ;;
    --base) BASE=${2:-}; shift 2 ;;
    --notify) NOTIFY=${2:-}; shift 2 ;;
    --out) OUT=${2:-}; shift 2 ;;
    --help|-h) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "post-merge-suite: unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$MERGED" ] || [ -z "$BASE" ] || [ -z "$NOTIFY" ]; then
  echo "post-merge-suite: need --merged <sha> --base <sha> --notify <address>" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "post-merge-suite: not in a git repo" >&2; exit 2; }
if [ -z "$OUT" ]; then OUT=$ROOT; fi
mkdir -p "$OUT"

full_m=$(git -C "$ROOT" rev-parse "$MERGED") || exit 2
full_b=$(git -C "$ROOT" rev-parse "$BASE") || exit 2
short=$(git -C "$ROOT" rev-parse --short "$full_m")
jobs=$(nproc 2>/dev/null || echo 2)
jobs=$((jobs / 2))
if [ "$jobs" -lt 1 ]; then jobs=1; fi

tmp=$(mktemp -d)
wt=$tmp/merged
basewt=$tmp/base
cleanup() {
  git -C "$ROOT" worktree remove --force "$wt" >/dev/null 2>&1 || true
  git -C "$ROOT" worktree remove --force "$basewt" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

git -C "$ROOT" worktree add --detach "$wt" "$full_m" >/dev/null || { echo "post-merge-suite: worktree add failed for $full_m" >&2; exit 2; }

start=$(date +%s)
log=$tmp/run.out
if [ -f "$wt/scripts/affected-suites.js" ]; then
  node "$wt/scripts/affected-suites.js" --base "$full_b" --head "$full_m" --run --jobs "$jobs" >"$log" 2>"$tmp/run.err"
  st=$?
else
  node "$SCRIPT_ROOT/scripts/affected-suites.js" --root "$wt" --base "$full_b" --head "$full_m" --run --jobs "$jobs" >"$log" 2>"$tmp/run.err"
  st=$?
fi
cat "$log"

declare -A RC
order=()
while IFS= read -r line; do
  case "$line" in
    rc=*)
      rest=${line#rc=}
      code=${rest%% *}
      path=${rest#* }
      if [ -z "${RC[$path]+x}" ]; then order+=("$path"); fi
      RC[$path]=$code
      ;;
  esac
done <"$log"

if [ "${#order[@]}" -eq 0 ] && [ "$st" -ne 0 ]; then
  cat "$tmp/run.err" >&2
  exit "$st"
fi

red=()
for p in "${order[@]+"${order[@]}"}"; do
  if [ "${RC[$p]}" -ne 0 ]; then red+=("$p"); fi
done

new_red=()
if [ "${#red[@]}" -gt 0 ]; then
  git -C "$ROOT" worktree add --detach "$basewt" "$full_b" >/dev/null || { echo "post-merge-suite: worktree add failed for $full_b" >&2; exit 2; }
  for p in "${red[@]}"; do
    if [ ! -f "$basewt/$p" ]; then new_red+=("$p"); continue; fi
    (
      cd "$basewt" || exit 99
      if [[ "$p" == *.test.js ]]; then node --test "$p"; else bash "$p"; fi
    ) >"$tmp/base.out" 2>"$tmp/base.err"
    brc=$?
    if [ "$brc" -eq 0 ]; then new_red+=("$p"); fi
  done
fi

end=$(date +%s)
wall=$((end - start))
: >"$tmp/red.list"
: >"$tmp/new.list"
if [ "${#red[@]}" -gt 0 ]; then printf '%s\n' "${red[@]}" >"$tmp/red.list"; fi
if [ "${#new_red[@]}" -gt 0 ]; then printf '%s\n' "${new_red[@]}" >"$tmp/new.list"; fi

node - "$OUT/post-merge.json" "$full_m" "$full_b" "$wall" "${#order[@]}" "$tmp/red.list" "$tmp/new.list" <<'JS'
const fs = require('fs');
const [out, merged, base, wall, selected, redFile, newFile] = process.argv.slice(2);
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
fs.writeFileSync(out, JSON.stringify({
  merged, base, selected: Number(selected), red: lines(redFile), new_red: lines(newFile), wall_s: Number(wall),
}) + '\n');
JS

if [ "${#new_red[@]}" -gt 0 ]; then
  paths=$(IFS=' '; echo "${new_red[*]}")
  line="post-merge NEW red on ${short}: ${paths}; revert with git revert -m 1 ${full_m}"
  if ! command -v fleet >/dev/null 2>&1; then
    printf '%s\n' "$line"
    exit 4
  fi
  fleet send "$NOTIFY" "$line"
  exit 1
fi
exit 0
