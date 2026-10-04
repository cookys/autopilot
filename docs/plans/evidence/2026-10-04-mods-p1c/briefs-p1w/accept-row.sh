#!/usr/bin/env bash
# usage: accept-row.sh <row> <section-title-in-brief-file> <brief-file>
# depth-0 acceptance check for one P1W row: scope, trailer, then a per-row review of base..HEAD
set -u
ROW=$1; SECTION=$2; BRIEF=$3
SP=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad
SC=/tmp/claude-1000/-home-cookys-projects-autopilot/25298c65-eec4-41f0-9ec8-d04360cb1303/scratchpad
P=$SP/p1c; W=$P/wt-$ROW; OUT=$P/run-w/$ROW; mkdir -p $OUT
cd $W
HEAD=$(git rev-parse --short HEAD)
BASE=$(git merge-base HEAD refs/remotes/main/develop 2>/dev/null)
case $ROW in w1a|w1i) BASE=$(git rev-parse --short p1c/r);; esac
echo "row=$ROW head=$HEAD base=$(git rev-parse --short $BASE) commits=$(git rev-list --count $BASE..HEAD) dirty=$(git status --short | wc -l)"
git log --format='%h %s' $BASE..HEAD | cut -c1-120
git log -1 --format=%B | tail -1; git log -1 --format=%ae
git diff --stat $BASE..HEAD | tail -1
echo "--- files:"; git diff --name-only $BASE..HEAD | sed 's/^/  /'
echo "--- mutation outputs: $(ls $OUT/mut-* 2>/dev/null | wc -l)"
# spec = common rules + this row's section of the brief + plan G1 folds
{
  cat $SC/w-common.md
  awk -v t="$SECTION" 'index($0,t)==1{f=1;print;next} f&&/^## /{f=0} f' "$BRIEF"
  echo; echo "Plan G1 folds that apply (binding):"
  awk '/G1 處置（R5.1/{f=1} f&&/^### P2 /{f=0} f' /home/cookys/projects/autopilot/docs/plans/2026-10-03-mods-visible-dispatch.md
  printf '\nYou have no tools; judge from the diff.\n'
} > $OUT/review.spec
$SP/rv.sh $P/clone $BASE $HEAD $OUT/review.spec $OUT/row 2>&1 | cut -c1-1500
