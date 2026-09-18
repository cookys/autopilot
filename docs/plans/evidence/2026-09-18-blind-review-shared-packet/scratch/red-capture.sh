#!/usr/bin/env bash
# RED capture: run <cand>'s versions of the named test files against a detached checkout of <base>.
# Usage: red-capture.sh <base> <cand> <outdir> <test...>
set -u
BASE="$1"; CAND="$2"; OUT="$3"; shift 3
WT=$(mktemp -d /tmp/autopilot-red-XXXXXX)
git -C /home/cookys/projects/autopilot worktree add --detach "$WT" "$BASE" >/dev/null 2>&1 || { echo "worktree add failed"; exit 1; }
mkdir -p "$OUT"
for t in "$@"; do
  name=$(basename "$t" .test.sh)
  git -C /home/cookys/projects/autopilot show "$CAND:$t" > "$WT/$t"
  ( cd "$WT" && env -u AUTOPILOT_SESSION_ID bash "$t" > "$OUT/red-$name.log" 2>&1; echo "rc=$?" >> "$OUT/red-$name.log" )
  { echo "# $t from $CAND run at base $BASE (detached checkout)"; grep -E '^FAIL|^rc=' "$OUT/red-$name.log" | head -40; } > "$OUT/red-$name.txt"
done
cd /; git -C /home/cookys/projects/autopilot worktree remove --force "$WT" >/dev/null 2>&1
echo "rc=0" > "$OUT/red.done"
