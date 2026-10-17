#!/usr/bin/env bash
# run-grid.sh: the pre-registered order, 3 cells at a time. Detach with setsid nohup; read cells/_grid.log for GRID_DONE.
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$(dirname "$HERE")/cells/_grid.log"
{
  for rep in 1 2; do
    for sc in s1 s2 s3 s4 s5; do
      echo "$sc inc $rep loc"; echo "$sc full $rep loc"
    done
    [ "$rep" = 1 ] && for sc in s2 s3 s4 s5; do echo "$sc inc 1 raw"; done
  done
} | xargs -P 3 -L 1 bash -c '"$0/launch-cell.sh" "$1" "$2" "$3" "$4"; echo "cell $1 $2 $3 $4 finished $(date +%T)" >> "'"$LOG"'"' "$HERE"
echo "GRID_DONE $(date +%T)" >> "$LOG"
