#!/usr/bin/env bash
# usage: accept-row2.sh <row>   (wave 2: base = w/int; spec = w-common + the whole wave-2 brief + row name)
# depth-0 acceptance check for one P1W wave-2 row: scope, trailer, then a per-row review of w/int..HEAD
set -u
ROW=$1
SP=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad
B=/home/cookys/projects/autopilot/docs/plans/evidence/2026-10-04-mods-p1c/briefs-p1w
P=$SP/p1c; W=$P/wt-$ROW; OUT=$P/run-w/$ROW; mkdir -p $OUT
cd $W
HEAD=$(git rev-parse --short HEAD); BASE=$(git rev-parse --short w/int)
echo "row=$ROW head=$HEAD base=$BASE commits=$(git rev-list --count $BASE..HEAD) dirty=$(git status --short | wc -l)"
git log --format='%h %s' $BASE..HEAD | cut -c1-120
git log -1 --format=%B | tail -1
git diff --stat $BASE..HEAD | tail -1
echo "--- files:"; git diff --name-only $BASE..HEAD | sed 's/^/  /'
echo "--- mutation outputs: $(ls $OUT/mut-* 2>/dev/null | wc -l)"
{
  cat $B/w-common.md
  echo; echo "Wave-2 brief (this diff implements row: $ROW; judge it against that row's section and the shared contracts):"
  cat $B/w-rows-wave2.md
  printf '\nYou have no tools; judge from the diff.\n'
} > $OUT/review.spec
$SP/rv.sh $P/clone $BASE $HEAD $OUT/review.spec $OUT/row 2>&1 | cut -c1-3000
